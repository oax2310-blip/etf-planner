const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../valuation.html'), 'utf8');
const source = html.slice(html.indexOf('  // 가정 저장:'), html.indexOf('  // Page-scoped structured action'));
if (!source.includes('function applyAssumptions(')) throw Error('가정 저장 구현을 찾지 못했습니다.');

const CURRENT = 'etf-planner-valuation-current-v1';
const LIST = 'etf-planner-valuation-scenarios-v1';

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

function page({storage = new Map(), defaults = {}, confirmAnswer = true, brokenStorage = false} = {}) {
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
  let timer = null;
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
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; },
    Date, JSON, Number, String, Object, Array, Set
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
  return {context, el, storage, confirms, renders, adjust, clickPreset, submit, listAction, fire, presetButtons,
    flush: () => { const fn = timer; timer = null; if (fn) fn(); },
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
