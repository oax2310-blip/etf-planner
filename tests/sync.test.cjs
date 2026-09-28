const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const initialSnapshot = dataSnapshot();'), html.indexOf('    function selected(){'));
if (!source.includes('async function syncNow()')) throw Error('동기화 구현을 찾지 못했습니다.');

function harness({local = {plans: [], futures: {positions: []}, actions: {}}, remote = null, base = '', hadStoredState = true} = {}) {
  const items = new Map();
  const elements = new Map();
  const server = {body: remote, writes: 0};
  const snapshot = value => JSON.stringify(value);
  const element = name => {
    if (!elements.has(name)) elements.set(name, {textContent: '', value: '', hidden: false, showModal() { this.open = true; }, close() { this.open = false; if (this.onclose) this.onclose(); }});
    return elements.get(name);
  };
  const context = vm.createContext({
    state: structuredClone(local), STORAGE_KEY: 'test-state', GOOGLE_CLIENT_ID: '', hadStoredState,
    localStorage: {getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value)},
    document: {getElementById: element, addEventListener() {}, hidden: false},
    Date, URLSearchParams, JSON, crypto: {randomUUID: () => 'test-id'},
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    normalize() {}, render() {}, id: () => 'test-id', confirm: () => false,
    async fetch(url, options = {}) {
      const ok = body => ({ok: true, status: 200, async json() { return body; }});
      if (url.includes('/about?')) return ok({user: {emailAddress: 'me@example.com'}});
      if (url.includes('uploadType=media')) {server.body = JSON.parse(options.body); server.writes++; return ok({id: 'file-id'});}
      if (url.includes('uploadType=multipart')) {
        const match = options.body.match(/\r\n\r\n(\{[^\r]*\})\r\n--[^\r]*--$/);
        assert.ok(match, 'multipart upload contains JSON media');
        server.body = JSON.parse(match[1]); server.writes++; return ok({id: 'file-id'});
      }
      if (url.includes('/drive/v3/files?')) return ok({files: server.body ? [{id: 'file-id'}] : []});
      if (url.includes('alt=media')) return ok(server.body);
      throw Error(`예상하지 못한 요청: ${url}`);
    }
  });
  vm.runInContext(source, context);
  vm.runInContext(`sync.token='test-token';sync.expires=Date.now()+600000;sync.email='me@example.com';sync.base=${JSON.stringify(base)};`, context);
  return {context, server, items, elements, snapshot, run: () => vm.runInContext('syncNow()', context), status: () => element('syncStatus').textContent};
}

test('기존 기기에서 처음 연결하면 현재 기록을 드라이브에 올린다', async () => {
  const local = {plans: [{id: 'abc'}], futures: {positions: []}, actions: {}};
  const h = harness({local});
  await h.run();
  assert.equal(h.server.writes, 1, h.status());
  assert.deepEqual(h.server.body, local);
  assert.match(h.status(), /동기화 완료/);
});

test('다른 기기에서 바꾼 기록을 현재 기기로 가져온다', async () => {
  const local = {plans: [], futures: {positions: []}, actions: {}};
  const remote = {plans: [{id: 'new'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote, base: JSON.stringify(local)});
  await h.run();
  assert.equal(h.server.writes, 0);
  assert.deepEqual(JSON.parse(h.items.get('test-state')).plans, remote.plans);
});

test('드라이브가 그대로인 동안 로컬 수정만 업로드한다', async () => {
  const old = {plans: [], futures: {positions: []}, actions: {}};
  const local = {plans: [{id: 'buy'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote: old, base: JSON.stringify(old)});
  await h.run();
  assert.equal(h.server.writes, 1);
  assert.deepEqual(h.server.body.plans, local.plans);
});

test('동시 변경은 묻고, 나중에 결정하면 어느 쪽도 덮어쓰지 않는다', async () => {
  const local = {plans: [{id: 'device'}], futures: {positions: []}, actions: {}};
  const remote = {plans: [{id: 'drive'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote, base: JSON.stringify({plans: [], futures: {positions: []}, actions: {}})});
  const work = h.run();
  for (let i = 0; i < 25 && !h.elements.get('conflictLater')?.onclick; i++) await Promise.resolve();
  assert.ok(h.elements.get('conflictLater')?.onclick, h.status());
  h.elements.get('conflictLater').onclick();
  await work;
  assert.equal(h.server.writes, 0);
  assert.deepEqual(h.server.body.plans, remote.plans);
  assert.match(h.status(), /이 기기에만/);
});

test('만료된 권한에서는 로컬 기록을 유지한다', async () => {
  const h = harness();
  vm.runInContext('sync.expires=0', h.context);
  await h.run();
  assert.equal(h.server.writes, 0);
  assert.match(h.status(), /다시 연결/);
});

test('드라이브 기록을 선택하면 로컬 사본이 JSON 복원 가능한 형태로 남는다', async () => {
  const local = {plans: [{id: 'device'}], futures: {positions: []}, actions: {}};
  const remote = {plans: [{id: 'drive'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote});
  const work = h.run();
  for (let i = 0; i < 25 && !h.elements.get('keepDrive')?.onclick; i++) await Promise.resolve();
  assert.ok(h.elements.get('keepDrive')?.onclick, h.status());
  h.elements.get('keepDrive').onclick();
  await work;
  assert.deepEqual(JSON.parse(h.items.get('test-state')).plans, remote.plans);
  assert.deepEqual(JSON.parse(h.items.get('etf-planner-sync-recovery')).plans, local.plans);
  assert.equal(h.server.writes, 0);
});

test('다른 구글 계정의 빈 드라이브에 기존 기록을 자동 업로드하지 않는다', async () => {
  const h = harness({local: {plans: [{id: 'personal'}], futures: {positions: []}, actions: {}}});
  h.items.set('etf-planner-last-google-account', 'other@example.com');
  await h.run();
  assert.equal(h.server.writes, 0);
  assert.match(h.status(), /다른 계정 확인 전/);
});
