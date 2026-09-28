const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../valuation.html'), 'utf8');
const source = html.slice(html.indexOf('  // 가정 저장:'), html.indexOf('  // Page-scoped structured action'));
if (!source.includes('function applyAssumptions(')) throw Error('가정 저장 구현을 찾지 못했습니다.');

const CURRENT = 'etf-planner-valuation-current-v1';
const LIST = 'etf-planner-valuation-scenarios-v1';
const DELETED = 'etf-planner-valuation-deleted-v1';
const REPO = 'me/data';
const FILE = `/repos/${REPO}/contents/etf-planner-scenarios.json`;
const b64 = text => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
const reply = (status, body) => ({ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return typeof body === 'string' ? body : JSON.stringify(body); }});

// 가짜 GitHub API: 파일 sha가 다르면 409로 거절한다(실제 GitHub과 같은 동시 저장 보호).
function githubServer({remote = null, isPrivate = true, raw = null} = {}) {
  let version = 1;
  const server = {file: remote || raw ? {sha: 'sha-1', text: raw ?? JSON.stringify(remote, null, 2)} : null, puts: [], requests: 0, beforePut: null,
    data() { return this.file && JSON.parse(this.file.text); }};
  server.fetch = async (url, options = {}) => {
    server.requests++;
    assert.equal(options.cache, 'no-store', '캐시된 응답을 쓰면 다른 기기 변경을 놓친다');
    assert.equal(options.headers?.Authorization, 'Bearer test-token');
    const path = new URL(url).pathname;
    if (path === `/repos/${REPO}`) return reply(200, {private: isPrivate});
    if (path !== FILE) throw Error(`예상하지 못한 요청: ${url}`);
    if (options.method === 'PUT') {
      if (server.beforePut) { const hook = server.beforePut; server.beforePut = null; hook(); }
      const body = JSON.parse(options.body);
      server.puts.push(body);
      if ((server.file && body.sha !== server.file.sha) || (!server.file && body.sha)) return reply(409, {message: 'sha mismatch'});
      server.file = {sha: `sha-${++version}`, text: Buffer.from(body.content, 'base64').toString('utf8')};
      return reply(200, {content: {sha: server.file.sha}});
    }
    if (!server.file) return reply(404, {message: 'Not Found'});
    return reply(200, {sha: server.file.sha, encoding: 'base64', content: b64(server.file.text)});
  };
  return server;
}
const connectedStorage = (entries = {}) => new Map([['etf-planner-data-repo', REPO], ['etf-planner-github-token', 'test-token'], ...Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])]);

// 계산기 입력칸 몇 개만 흉내 낸 가짜 DOM. 범위 입력은 브라우저처럼 min·max로 잘라 준다.
function control(id, {type = 'range', value, min = 0, max = 1000, options}) {
  if (type === 'select') {
    let current = options.find(o => o.selected).value;
    return {id, tagName: 'SELECT', options: options.map(o => ({value: o.value, defaultSelected: !!o.selected})), checkValidity: () => current !== '',
      get value() { return current; }, set value(v) { current = options.some(o => o.value === String(v)) ? String(v) : ''; }};
  }
  let current = String(value);
  return {id, tagName: 'INPUT', defaultValue: String(value),
    checkValidity: () => type === 'range' || (current !== '' && Number(current) >= min && Number(current) <= max),
    get value() { return current; },
    set value(v) { current = type === 'range' ? String(Math.min(max, Math.max(min, Number(v)))) : String(v); }};
}

function page({storage = new Map(), defaults = {}, confirmAnswer = true, brokenStorage = false, server = null} = {}) {
  const controls = [
    control('robotM', {value: defaults.robotM ?? 80, max: 160}),
    control('evShare', {value: defaults.evShare ?? 5, max: 15}),
    control('batYear', {type: 'select', options: [{value: '2030'}, {value: '2035', selected: true}, {value: '2040'}]}),
    control('batCarM', {type: 'number', value: 80, min: 20, max: 150}),
    control('bc-lg-ev', {type: 'number', value: 8, max: 100}),
    control('humnUnits', {value: 100, max: 120}),
    control('terPE', {value: 20, max: 40})
  ];
  const elements = new Map(controls.map(c => [c.id, c]));
  const listeners = {};
  const on = target => (type, fn) => { (target.listeners[type] ||= []).push(fn); };
  const generic = id => {
    const node = {id, textContent: '', value: '', hidden: false, open: false, listeners: {}, children: [], dataset: {}, attributes: {},
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
      append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
      setAttribute(k, v) { this.attributes[k] = v; }, closest() { return null; }};
    node.addEventListener = on(node);
    return node;
  };
  const el = id => { if (!elements.has(id)) elements.set(id, generic(id)); return elements.get(id); };
  const button = (attr, key) => {
    const b = {dataset: {[attr]: key}, active: key === 'base'};
    b.classList = {toggle: (name, on) => { b.active = on; }};
    return b;
  };
  const presetButtons = {'[data-preset]': ['low', 'base', 'high'].map(k => button('preset', k)), '[data-battery-preset]': ['low', 'base', 'high'].map(k => button('batteryPreset', k))};
  const confirms = [];
  const timers = new Map();
  let timerId = 0;
  const renders = {count: 0};
  const context = vm.createContext({
    el, ids: ['robotM', 'evShare'], batteryInputs: ['batYear', 'batCarM'], companyInputIds: ['bc-lg-ev'], groupInputIds: [], humnControlIds: ['humnUnits'], terControlIds: ['terPE'],
    sdiPresetLabels: {low: '보수적 시나리오', base: '기본 시나리오', high: '낙관적 시나리오'},
    batteryPresetLabels: {low: '보수적 가정', base: '기본 가정', high: '낙관적 가정'},
    render() { renders.count++; }, renderHumn() {}, renderBatteryEtfs() {},
    localStorage: {
      getItem: key => { if (brokenStorage) throw Error('blocked'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (brokenStorage) throw Error('blocked'); storage.set(key, String(value)); }
    },
    document: {
      hidden: false,
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
      querySelector: sel => { const base = sel.replace('.active', ''); return presetButtons[base]?.find(b => b.active) || null; },
      querySelectorAll: sel => presetButtons[sel] || [],
      createElement: () => generic('')
    },
    window: {addEventListener() {}},
    confirm: message => { confirms.push(message); return confirmAnswer; },
    crypto: {randomUUID: (() => { let n = 0; return () => `id-${++n}`; })()},
    setTimeout: (fn, ms) => { timers.set(++timerId, {fn, ms}); return timerId; }, clearTimeout: id => { timers.delete(id); }, setInterval() {},
    fetch: server ? server.fetch : async () => { throw Error('연결하지 않았는데 GitHub에 요청했다'); },
    Date, JSON, Number, String, Object, Array, Set, Map, Error, TextEncoder, TextDecoder, Uint8Array, btoa, atob, URL
  });
  vm.runInContext(source, context);
  const fire = (type, target) => (listeners[type] || []).forEach(fn => fn({target, preventDefault() {}}));
  // 계산기 쪽 입력 처리처럼 프리셋 선택을 풀고 input 이벤트를 보낸다.
  const adjust = (id, value) => {
    el(id).value = value;
    const preset = ['robotM', 'evShare'].includes(id) ? '[data-preset]' : ['batYear', 'batCarM', 'bc-lg-ev'].includes(id) ? '[data-battery-preset]' : null;
    if (preset) presetButtons[preset].forEach(b => { b.active = false; });
    fire('input', el(id));
  };
  const clickPreset = (sel, key) => { presetButtons[sel].forEach(b => { b.active = b.dataset[sel === '[data-preset]' ? 'preset' : 'batteryPreset'] === key; }); fire('click', {closest: () => ({})}); };
  const submit = name => { el('scenarioName').value = name; el('scenarioForm').listeners.submit[0]({preventDefault() {}}); };
  const listAction = (action, index = 0) => {
    const row = el('scenarioList').children[index];
    const btn = row.children[1].children.find(b => b.dataset.scenarioAction === action);
    el('scenarioList').listeners.click[0]({target: {closest: () => btn}});
  };
  const saveFn = vm.runInContext('saveAssumptions', context);
  const settle = async () => { for (let i = 0; i < 100 && vm.runInContext('scenarioSync.busy', context); i++) await new Promise(r => setImmediate(r)); };
  return {context, el, storage, confirms, renders, adjust, clickPreset, submit, listAction, fire, presetButtons, timers,
    // 자동 저장 대기만 실행한다. 동기화 예약은 pendingSync로 확인하고 sync()로 직접 돌린다.
    flush: () => { for (const [id, t] of timers) if (t.fn === saveFn) { timers.delete(id); t.fn(); } },
    pendingSync: () => [...timers.values()].some(t => t.fn !== saveFn),
    // 진행 중인 동기화(저장 창 열기 등)가 끝나기를 기다린 뒤 한 번 더 동기화한다.
    sync: async () => { await settle(); await vm.runInContext('syncScenarios()', context); await settle(); },
    ready: () => vm.runInContext('scenarioSyncReady', context),
    stored: key => JSON.parse(storage.get(key)),
    list: () => el('scenarioList').children.map(row => row.children[0].children[0].textContent)};
}

test('조정한 가정은 다시 열어도 복원되고 바꾸지 않은 값은 새 기본값을 따른다', () => {
  const first = page();
  first.adjust('robotM', 120);
  first.adjust('bc-lg-ev', 12);
  first.flush();
  first.el('batYear').value = '2040';
  first.fire('change', first.el('batYear'));
  assert.deepEqual({...first.stored(CURRENT).values}, {robotM: 120, 'bc-lg-ev': 12, batYear: 2040});
  assert.equal(first.el('saveState').textContent, '조정 3개 · 자동 저장됨');

  const reopened = page({storage: first.storage, defaults: {evShare: 6}});
  assert.equal(reopened.el('robotM').value, '120');
  assert.equal(reopened.el('batYear').value, '2040');
  assert.equal(reopened.el('bc-lg-ev').value, '12');
  assert.equal(reopened.el('evShare').value, '6', '저장하지 않은 입력은 페이지의 새 기본값을 따라야 한다');
  assert.equal(reopened.el('presetLabel').textContent, '직접 조정');
  assert.equal(reopened.el('batteryPresetLabel').textContent, '직접 조정');
  assert.ok(reopened.presetButtons['[data-preset]'].every(b => !b.active));
  assert.ok(reopened.renders.count > 0, '복원 후 다시 계산해야 한다');
});

test('프리셋을 누르면 선택한 프리셋 이름까지 복원한다', () => {
  const first = page();
  first.el('evShare').value = 8;
  first.clickPreset('[data-preset]', 'high');
  const reopened = page({storage: first.storage});
  assert.equal(reopened.el('presetLabel').textContent, '낙관적 시나리오');
  assert.equal(reopened.el('batteryPresetLabel').textContent, '기본 가정');
  assert.equal(reopened.el('evShare').value, '8');
  assert.ok(reopened.presetButtons['[data-preset]'].find(b => b.dataset.preset === 'high').active);
});

test('입력 중인 빈칸이나 범위 밖 값은 저장하지 않고 직전 값을 유지한다', () => {
  const h = page();
  h.adjust('batCarM', 90); h.flush();
  h.adjust('batCarM', ''); h.flush();
  assert.equal(h.stored(CURRENT).values.batCarM, 90);
  h.adjust('batCarM', 5); h.flush();
  assert.equal(h.stored(CURRENT).values.batCarM, 90);
  const reopened = page({storage: h.storage});
  assert.equal(reopened.el('batCarM').value, '90');
});

test('저장된 값이 현재 입력 범위를 벗어나면 기본값으로 연다', () => {
  const storage = new Map([[CURRENT, JSON.stringify({values: {batCarM: 999, batYear: 2050, robotM: 'x'}, presets: {sdi: 'base', battery: 'base'}})]]);
  const h = page({storage});
  assert.equal(h.el('batCarM').value, '80');
  assert.equal(h.el('batYear').value, '2035');
  assert.equal(h.el('robotM').value, '80');
});

test('이름을 붙여 저장하고 불러오고 덮어쓰고 삭제한다', () => {
  const h = page();
  h.submit('   ');
  assert.equal(h.el('savesStatus').textContent, '저장할 이름을 입력하세요.');
  assert.equal(h.storage.get(LIST), undefined);

  h.adjust('robotM', 150); h.adjust('humnUnits', 60); h.flush();
  h.submit('로봇 낙관');
  assert.deepEqual(h.list(), ['로봇 낙관']);
  assert.deepEqual({...h.stored(LIST)[0].values}, {robotM: 150, humnUnits: 60});

  h.adjust('robotM', 40); h.adjust('humnUnits', 100); h.flush();
  h.submit('로봇 보수');
  assert.deepEqual(h.list(), ['로봇 보수', '로봇 낙관']);
  assert.deepEqual({...h.stored(LIST)[0].values}, {robotM: 40});

  h.adjust('robotM', 70); h.flush();
  h.submit('로봇 낙관');
  assert.equal(h.confirms.length, 1, '같은 이름은 덮어쓰기 전에 묻는다');
  assert.deepEqual(h.list(), ['로봇 낙관', '로봇 보수']);
  assert.deepEqual({...h.stored(LIST)[0].values}, {robotM: 70});
  assert.equal(h.stored(LIST)[0].id, 'id-1', '덮어써도 같은 저장본으로 남는다');

  h.adjust('humnUnits', 30); h.flush();
  h.listAction('load', 1);
  assert.equal(h.confirms.length, 2, '저장본에 없는 조정값이 있으면 불러오기 전에 묻는다');
  assert.equal(h.el('robotM').value, '40');
  assert.equal(h.el('humnUnits').value, '100');
  assert.deepEqual({...h.stored(CURRENT).values}, {robotM: 40});
  assert.equal(h.el('savesDialog').open, false);

  h.listAction('delete', 1);
  assert.deepEqual(h.list(), ['로봇 낙관']);
  assert.equal(h.stored(LIST).length, 1);
});

test('저장 목록에 없는 조정값을 바꾸기 전에 묻고, 취소하면 그대로 둔다', () => {
  const storage = new Map([[LIST, JSON.stringify([{id: 'a', name: '저장본', savedAt: '', values: {robotM: 10}, presets: {sdi: '', battery: 'base'}}])]]);
  const h = page({storage, confirmAnswer: false});
  h.el('openSaves').listeners.click[0]();
  h.adjust('robotM', 120); h.flush();
  h.listAction('load');
  assert.equal(h.confirms.length, 1);
  assert.equal(h.el('robotM').value, '120');
  h.el('resetAssumptions').listeners.click[0]();
  assert.equal(h.el('robotM').value, '120');
});

test('기본값으로 되돌리면 모든 조정과 프리셋 표시가 처음으로 돌아간다', () => {
  const h = page();
  h.adjust('robotM', 120); h.adjust('batYear', '2030'); h.flush();
  h.submit('보관');
  h.el('resetAssumptions').listeners.click[0]();
  assert.equal(h.confirms.length, 0, '저장본에 있는 조정값이면 묻지 않는다');
  assert.equal(h.el('robotM').value, '80');
  assert.equal(h.el('batYear').value, '2035');
  assert.equal(h.el('presetLabel').textContent, '기본 시나리오');
  assert.equal(h.el('batteryPresetLabel').textContent, '기본 가정');
  assert.deepEqual({...h.stored(CURRENT).values}, {});
  assert.equal(h.el('saveState').textContent, '기본값');
});

test('저장 기록이 깨졌거나 저장소를 쓸 수 없어도 기본값으로 연다', () => {
  const broken = page({storage: new Map([[CURRENT, '{bad'], [LIST, '"x"']])});
  assert.equal(broken.el('robotM').value, '80');
  assert.equal(broken.el('saveState').textContent, '기본값');

  const blocked = page({brokenStorage: true});
  blocked.adjust('robotM', 120); blocked.flush();
  assert.equal(blocked.el('saveState').textContent, '저장 안 됨');
  assert.match(blocked.el('currentSummary').textContent, /저장할 수 없습니다/);
});

// ── 기기 간 동기화 (메인 플래너에서 연결한 비공개 데이터 저장소의 etf-planner-scenarios.json) ──
const T1 = '2026-09-01T00:00:00.000Z', T2 = '2026-09-02T00:00:00.000Z', T3 = '2026-09-03T00:00:00.000Z';
const saved = (values, savedAt, presets = {sdi: '', battery: 'base'}) => ({values, presets, savedAt});
const scenario = (id, name, savedAt, values = {robotM: 10}) => ({id, name, savedAt, values, presets: {sdi: '', battery: 'base'}});
const remoteFile = ({current = null, scenarios = [], deleted = {}} = {}) => ({version: 1, current, scenarios, deleted});

test('연결하지 않은 기기는 GitHub에 요청하지 않고 연결 방법을 안내한다', async () => {
  const h = page();
  await h.ready();
  h.adjust('robotM', 120); h.flush();
  assert.equal(h.pendingSync(), false);
  assert.equal(h.el('scenarioSyncStatus').textContent, '연결 안 됨');
  assert.equal(h.el('scenarioSyncOff').hidden, false);
  assert.equal(h.el('scenarioSyncNow').hidden, true);
  assert.equal(h.el('saveState').textContent, '조정 1개 · 자동 저장됨');
});

test('처음 연결하면 이 기기의 현재 조정값과 저장본을 저장소에 새로 올린다', async () => {
  const server = githubServer();
  const h = page({server, storage: connectedStorage({[CURRENT]: saved({robotM: 120}, T1), [LIST]: [scenario('a', '낙관', T1)]})});
  await h.ready();
  assert.equal(server.puts.length, 1);
  assert.equal(server.puts[0].sha, undefined);
  assert.deepEqual(server.data(), remoteFile({current: saved({robotM: 120}, T1), scenarios: [scenario('a', '낙관', T1)]}));
  assert.match(h.el('scenarioSyncStatus').textContent, /^동기화 완료/);
  assert.equal(h.el('saveState').textContent, '조정 1개 · 동기화됨');
  assert.equal(h.el('scenarioSyncRepo').textContent, REPO);
});

test('다른 기기에서 나중에 바꾼 조정값을 화면에 가져오고 저장본은 합친다', async () => {
  const server = githubServer({remote: remoteFile({current: saved({robotM: 40, humnUnits: 60}, T2, {sdi: 'high', battery: 'base'}), scenarios: [scenario('b', '보수', T2)]})});
  const h = page({server, storage: connectedStorage({[CURRENT]: saved({robotM: 120}, T1), [LIST]: [scenario('a', '낙관', T1)]})});
  await h.ready();
  assert.equal(h.el('robotM').value, '40');
  assert.equal(h.el('humnUnits').value, '60');
  assert.equal(h.el('presetLabel').textContent, '낙관적 시나리오');
  assert.equal(h.stored(CURRENT).savedAt, T2, '가져온 조정값은 다른 기기의 변경 시각을 유지한다');
  assert.deepEqual(h.stored(LIST).map(s => s.name), ['보수', '낙관']);
  assert.deepEqual(server.data().scenarios.map(s => s.id), ['b', 'a']);
  assert.deepEqual(server.data().current.values, {humnUnits: 60, robotM: 40});
});

test('이 기기에서 나중에 바꾼 조정값은 저장소에 올리고 다른 기기의 저장본은 지우지 않는다', async () => {
  const server = githubServer({remote: remoteFile({current: saved({robotM: 40}, T1), scenarios: [scenario('b', '보수', T1)]})});
  const h = page({server, storage: connectedStorage({[CURRENT]: saved({robotM: 120}, T2)})});
  await h.ready();
  assert.equal(h.el('robotM').value, '120');
  assert.deepEqual(server.data().current, saved({robotM: 120}, T2));
  assert.deepEqual(server.data().scenarios.map(s => s.id), ['b']);
  assert.deepEqual(h.stored(LIST).map(s => s.id), ['b']);
});

test('열어 보기만 한 기기는 다른 기기의 조정값을 기본값으로 덮어쓰지 않는다', async () => {
  const server = githubServer({remote: remoteFile({current: saved({robotM: 40}, T1)})});
  const h = page({server, storage: connectedStorage()});
  h.el('openSaves').listeners.click[0]();  // 첫 동기화가 끝나기 전에 저장 창을 연다
  h.clickPreset('[data-preset]', 'base');
  await h.ready();
  assert.equal(h.el('robotM').value, '40');
  assert.equal(server.puts.length, 0);
  assert.equal(h.stored(CURRENT).savedAt, T1);
});

test('조정값을 바꾸면 잠시 뒤 동기화하고, 바뀐 것이 없으면 다시 쓰지 않는다', async () => {
  const server = githubServer({remote: remoteFile()});
  const h = page({server, storage: connectedStorage()});
  await h.ready();
  assert.equal(server.puts.length, 0);
  h.adjust('robotM', 120); h.flush();
  assert.equal(h.pendingSync(), true);
  assert.equal(h.el('saveState').textContent, '조정 1개 · 동기화 대기', '올리기 전에는 동기화됨으로 보이지 않는다');
  assert.equal([...h.timers.values()].find(t => t.ms >= 1000)?.ms, 5000, '슬라이더를 움직이는 동안 커밋이 쌓이지 않게 모아서 올린다');
  await h.sync();
  assert.equal(server.puts.length, 1);
  assert.deepEqual(server.data().current.values, {robotM: 120});
  assert.equal(h.el('saveState').textContent, '조정 1개 · 동기화됨');
  await h.sync();
  assert.equal(server.puts.length, 1);
});

test('이름 붙인 저장본과 삭제가 다른 기기로 전파되고 삭제한 저장본은 되살아나지 않는다', async () => {
  const server = githubServer({remote: remoteFile({scenarios: [scenario('a', '낙관', T1)]})});
  const phone = page({server, storage: connectedStorage()});
  await phone.ready();
  phone.adjust('robotM', 150); phone.flush();
  phone.submit('로봇 1.5억');
  assert.equal(phone.pendingSync(), true);
  await phone.sync();
  assert.deepEqual(server.data().scenarios.map(s => s.name), ['로봇 1.5억', '낙관']);

  // PC는 예전 목록(낙관)을 들고 있다가 휴대폰에서 지운 기록을 받는다.
  const pc = page({server, storage: connectedStorage({[LIST]: [scenario('a', '낙관', T1)]})});
  await pc.ready();
  pc.el('openSaves').listeners.click[0]();
  await pc.ready();
  pc.listAction('delete', pc.list().indexOf('낙관'));
  assert.ok(pc.stored(DELETED).a);
  await pc.sync();
  assert.deepEqual(server.data().scenarios.map(s => s.name), ['로봇 1.5억']);
  assert.ok(server.data().deleted.a);

  await phone.sync();
  assert.deepEqual(phone.stored(LIST).map(s => s.name), ['로봇 1.5억'], '휴대폰에서도 지워진다');
  assert.equal(server.puts.length, 2, '지운 저장본을 다시 올리지 않는다');
});

test('올리는 사이 다른 기기가 먼저 저장하면(409) 다시 읽어 합친 뒤 올린다', async () => {
  const server = githubServer({remote: remoteFile({scenarios: [scenario('b', '보수', T1)]})});
  server.beforePut = () => {
    server.file = {sha: 'sha-other', text: JSON.stringify(remoteFile({scenarios: [scenario('c', '다른 기기', T3), scenario('b', '보수', T1)]}))};
  };
  const h = page({server, storage: connectedStorage({[LIST]: [scenario('a', '낙관', T2)]})});
  await h.ready();
  assert.equal(server.puts.length, 2);
  assert.equal(server.puts[1].sha, 'sha-other');
  assert.deepEqual(server.data().scenarios.map(s => s.id), ['c', 'a', 'b']);
  assert.match(h.el('scenarioSyncStatus').textContent, /^동기화 완료/);
});

test('공개 저장소나 알 수 없는 파일에는 올리지 않고 이 기기 기록을 지킨다', async () => {
  const pub = githubServer({isPrivate: false});
  const a = page({server: pub, storage: connectedStorage({[LIST]: [scenario('a', '낙관', T1)]})});
  await a.ready();
  assert.equal(pub.puts.length, 0);
  assert.equal(a.el('scenarioSyncStatus').textContent, '동기화 오류 · 이 기기에는 저장됨');
  assert.match(a.el('scenarioSyncError').textContent, /공개 저장소/);
  assert.equal(a.el('saveState').textContent, '기본값 · 동기화 오류');

  const broken = githubServer({raw: 'not json'});
  const b = page({server: broken, storage: connectedStorage({[LIST]: [scenario('a', '낙관', T1)]})});
  await b.ready();
  assert.equal(broken.puts.length, 0);
  assert.match(b.el('scenarioSyncError').textContent, /덮어쓰지 않았습니다/);
  assert.deepEqual(b.stored(LIST).map(s => s.id), ['a']);
});

test('한글 이름이 저장소를 거쳐도 그대로 돌아온다', async () => {
  const server = githubServer();
  const a = page({server, storage: connectedStorage()});
  await a.ready();
  a.adjust('robotM', 150); a.flush();
  a.submit('로봇 1억 대 · 낙관 🚀');
  await a.sync();
  const b = page({server, storage: connectedStorage()});
  await b.ready();
  assert.deepEqual(b.stored(LIST).map(s => s.name), ['로봇 1억 대 · 낙관 🚀']);
  assert.equal(b.el('robotM').value, '150');
});
