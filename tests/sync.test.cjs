const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const initialSnapshot = dataSnapshot();'), html.indexOf('    function selected(){'));
if (!source.includes('async function syncNow()')) throw Error('동기화 구현을 찾지 못했습니다.');

const REPO = 'me/data';
const FILE = `/repos/${REPO}/contents/etf-planner-data.json`;
const empty = () => ({plans: [], futures: {positions: []}, actions: {}});
const snap = value => JSON.stringify({plans: value.plans, futures: value.futures, actions: value.actions});
const b64 = text => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');

// 가짜 GitHub API: 파일 sha가 다르면 409로 거절한다(실제 GitHub과 같은 동시 저장 보호).
function harness({local = empty(), remote = null, base = '', hadStoredState = true, stored = {}, connect = true, isPrivate = true, failStatus = 0} = {}) {
  const items = new Map(Object.entries(stored));
  if (connect) {
    items.set('etf-planner-data-repo', REPO);
    items.set('etf-planner-github-token', 'test-token');
    if (base) items.set('etf-planner-sync-base:' + REPO, base);
  }
  const elements = new Map();
  let version = 1;
  const server = {file: remote ? {sha: 'sha-1', text: JSON.stringify(remote, null, 2)} : null, writes: 0, requests: 0, auth: [], puts: [], beforePut: null};
  const element = name => {
    if (!elements.has(name)) elements.set(name, {textContent: '', value: '', placeholder: '', hidden: false, showModal() { this.open = true; }, close() { this.open = false; if (this.onclose) this.onclose(); }});
    return elements.get(name);
  };
  const reply = (status, body) => ({ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return typeof body === 'string' ? body : JSON.stringify(body); }});
  const context = vm.createContext({
    state: structuredClone(local), STORAGE_KEY: 'test-state', hadStoredState,
    localStorage: {getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key)},
    document: {getElementById: element, addEventListener() {}, hidden: false},
    Date, URLSearchParams, JSON, TextEncoder, TextDecoder, Uint8Array, String, btoa, atob,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    normalize() {}, render() {}, id: () => 'test-id', confirm: () => false,
    async fetch(url, options = {}) {
      server.requests++; server.auth.push(options.headers?.Authorization);
      assert.equal(options.cache, 'no-store', '캐시된 응답을 쓰면 다른 기기 변경을 놓친다');
      if (failStatus) return reply(failStatus, {message: 'fail'});
      const path = new URL(url).pathname;
      if (path === `/repos/${REPO}`) return reply(200, {private: isPrivate});
      if (path !== FILE) throw Error(`예상하지 못한 요청: ${url}`);
      if (options.method === 'PUT') {
        if (server.beforePut) { const hook = server.beforePut; server.beforePut = null; hook(); }
        const body = JSON.parse(options.body);
        server.puts.push(body);
        if ((server.file && body.sha !== server.file.sha) || (!server.file && body.sha)) return reply(409, {message: 'sha mismatch'});
        server.file = {sha: `sha-${++version}`, text: Buffer.from(body.content, 'base64').toString('utf8')};
        server.writes++;
        return reply(server.writes === 1 && !body.sha ? 201 : 200, {content: {sha: server.file.sha}});
      }
      if (!server.file) return reply(404, {message: 'Not Found'});
      return reply(200, {sha: server.file.sha, encoding: 'base64', content: b64(server.file.text)});
    }
  });
  vm.runInContext(source, context);
  const remoteData = () => server.file && JSON.parse(server.file.text);
  return {context, server, items, elements, remoteData, restored: () => vm.runInContext('restored', context), run: () => vm.runInContext('syncNow()', context), status: () => element('syncStatus').textContent};
}
const waitFor = async (check) => { for (let i = 0; i < 50 && !check(); i++) await Promise.resolve(); };

test('기존 기기에서 처음 연결하면 현재 기록을 저장소에 올린다', async () => {
  const local = {plans: [{id: 'abc'}], futures: {positions: []}, actions: {}};
  const h = harness({local});
  await h.restored();
  assert.equal(h.server.writes, 1, h.status());
  assert.deepEqual(h.remoteData(), local);
  assert.equal(h.server.puts[0].sha, undefined);
  assert.match(h.status(), /동기화 완료/);
});

test('페이지를 열면 버튼 없이 다른 기기에서 바꾼 기록을 가져온다', async () => {
  const local = empty();
  const remote = {plans: [{id: 'other-device'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote, base: snap(local)});
  await h.restored();
  assert.equal(h.server.writes, 0);
  assert.deepEqual(JSON.parse(h.items.get('test-state')).plans, remote.plans);
  assert.ok(h.server.auth.every(a => a === 'Bearer test-token'));
});

test('아무것도 입력하지 않은 새 기기는 묻지 않고 저장소 기록을 가져온다', async () => {
  const remote = {plans: [{id: 'saved'}], futures: {positions: []}, actions: {}};
  const h = harness({remote});
  await h.restored();
  assert.equal(h.server.writes, 0);
  assert.equal(h.elements.get('conflictDialog')?.open, undefined);
  assert.deepEqual(JSON.parse(h.items.get('test-state')).plans, remote.plans);
});

test('저장소가 그대로인 동안 이 기기 수정만 현재 sha로 올린다', async () => {
  const old = empty();
  const local = {plans: [{id: 'buy'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote: old, base: snap(old)});
  await h.restored();
  assert.equal(h.server.writes, 1);
  assert.equal(h.server.puts[0].sha, 'sha-1');
  assert.deepEqual(h.remoteData().plans, local.plans);
});

test('양쪽 다 바뀌면 묻고, 나중에 결정하면 어느 쪽도 덮어쓰지 않는다', async () => {
  const local = {plans: [{id: 'device'}], futures: {positions: []}, actions: {}};
  const remote = {plans: [{id: 'repo'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote, base: snap(empty())});
  const work = h.restored();
  await waitFor(() => h.elements.get('conflictLater')?.onclick);
  h.elements.get('conflictLater').onclick();
  await work;
  assert.equal(h.server.writes, 0);
  assert.deepEqual(h.remoteData().plans, remote.plans);
  assert.match(h.status(), /이 기기에만/);
});

test('저장소 기록을 고르면 이 기기 기록을 복구용으로 남긴다', async () => {
  const local = {plans: [{id: 'device'}], futures: {positions: []}, actions: {}};
  const remote = {plans: [{id: 'repo'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote});
  const work = h.restored();
  await waitFor(() => h.elements.get('keepRemote')?.onclick);
  h.elements.get('keepRemote').onclick();
  await work;
  assert.deepEqual(JSON.parse(h.items.get('test-state')).plans, remote.plans);
  assert.deepEqual(JSON.parse(h.items.get('etf-planner-sync-recovery')).plans, local.plans);
  assert.equal(h.server.writes, 0);
});

test('이 기기 기록을 고르면 저장소 기록을 복구용으로 남기고 올린다', async () => {
  const local = {plans: [{id: 'device'}], futures: {positions: []}, actions: {}};
  const remote = {plans: [{id: 'repo'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote});
  const work = h.restored();
  await waitFor(() => h.elements.get('keepLocal')?.onclick);
  h.elements.get('keepLocal').onclick();
  await work;
  assert.deepEqual(h.remoteData().plans, local.plans);
  assert.deepEqual(JSON.parse(h.items.get('etf-planner-sync-recovery')).plans, remote.plans);
});

test('올리는 순간 다른 기기가 먼저 저장했으면(409) 덮어쓰지 않는다', async () => {
  const old = empty();
  const local = {plans: [{id: 'mine'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote: old, base: snap(old)});
  h.server.beforePut = () => { h.server.file = {sha: 'sha-other', text: JSON.stringify({plans: [{id: 'other'}], futures: {positions: []}, actions: {}})}; };
  await h.restored();
  assert.equal(h.server.writes, 0);
  assert.deepEqual(h.remoteData().plans, [{id: 'other'}]);
  assert.equal(vm.runInContext('sync.again', h.context), true);
  assert.match(h.status(), /다른 기기 저장 확인/);
});

test('공개 저장소에는 기록을 올리지 않는다', async () => {
  const h = harness({local: {plans: [{id: 'private'}], futures: {positions: []}, actions: {}}, isPrivate: false});
  await h.restored();
  assert.equal(h.server.writes, 0);
  assert.match(h.status(), /공개 저장소/);
});

test('토큰이 틀리면(401) 기록은 기기에 남기고 반복 요청하지 않는다', async () => {
  const h = harness({local: {plans: [{id: 'keep'}], futures: {positions: []}, actions: {}}, failStatus: 401});
  await h.restored();
  assert.equal(h.server.writes, 0);
  assert.match(h.status(), /토큰/);
  assert.equal(vm.runInContext('sync.failed', h.context), true);
  assert.equal(JSON.parse(vm.runInContext('dataSnapshot()', h.context)).plans[0].id, 'keep');
});

test('처음 연결한 저장소가 예전 저장소와 다르면 묻기 전에는 올리지 않는다', async () => {
  const h = harness({local: {plans: [{id: 'personal'}], futures: {positions: []}, actions: {}}, stored: {'etf-planner-last-data-repo': 'me/old'}});
  await h.restored();
  assert.equal(h.server.writes, 0);
  assert.match(h.status(), /다른 저장소 확인 전/);
});

test('한글 기록이 저장소를 거쳐도 그대로 돌아온다', async () => {
  const local = {plans: [{id: 'k', title: '달러선물 월물교체 · ₩ −1,000원', note: '메모 ✓'}], futures: {positions: []}, actions: {}};
  const h = harness({local});
  await h.restored();
  assert.deepEqual(h.remoteData(), local);
  const other = harness({remote: h.remoteData()});
  await other.restored();
  assert.deepEqual(JSON.parse(other.items.get('test-state')).plans, local.plans);
});

test('연결하지 않은 기기는 아무 요청도 하지 않는다', async () => {
  const h = harness({connect: false, local: {plans: [{id: 'solo'}], futures: {positions: []}, actions: {}}});
  await h.restored();
  assert.equal(h.server.requests, 0);
});

test('연결 해제하면 이 기기에서 토큰을 지운다', async () => {
  const h = harness({remote: empty(), base: snap(empty())});
  await h.restored();
  h.elements.get('disconnectRepo').onclick();
  assert.equal(h.items.has('etf-planner-github-token'), false);
  assert.equal(vm.runInContext('connected()', h.context), false);
  assert.match(h.status(), /이 기기에만/);
});
