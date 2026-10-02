const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../js/sync.js'), 'utf8');
const pricesSource = fs.readFileSync(require('node:path').join(__dirname, '../js/prices.js'), 'utf8'); // 브라우저처럼 시세 채우기(prices.js)도 함께
if (!source.includes('async function syncNow()')) throw Error('동기화 구현을 찾지 못했습니다.');

const REPO = 'me/data';
const FILE = `/repos/${REPO}/contents/etf-planner-data.json`;
const PRICE_FILE = `/repos/${REPO}/contents/etf-planner-prices.json`;
const empty = () => ({plans: [], futures: {positions: []}, actions: {}});
const snap = value => JSON.stringify({plans: value.plans, futures: value.futures, actions: value.actions});
const b64 = text => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');

// 가짜 GitHub API: 파일 sha가 다르면 409로 거절한다(실제 GitHub과 같은 동시 저장 보호).
// 시세 파일(prices)은 있으면 ETag와 함께 돌려주고, 같은 ETag로 물으면 304. priceStatus를 주면 시세 파일 요청만 그 상태로 실패.
function harness({local = empty(), remote = null, base = '', hadStoredState = true, stored = {}, connect = true, isPrivate = true, failStatus = 0, prices = null, priceStatus = 0} = {}) {
  const items = new Map(Object.entries(stored));
  if (connect) {
    items.set('etf-planner-data-repo', REPO);
    items.set('etf-planner-github-token', 'test-token');
    if (base) items.set('etf-planner-sync-base:' + REPO, base);
  }
  const elements = new Map();
  let version = 1;
  const server = {file: remote ? {sha: 'sha-1', text: JSON.stringify(remote, null, 2)} : null, writes: 0, requests: 0, auth: [], puts: [], beforePut: null,
    prices: prices && {etag: '"p1"', text: JSON.stringify(prices)}, priceStatus, priceAsks: []};
  const element = name => {
    if (!elements.has(name)) elements.set(name, {textContent: '', value: '', placeholder: '', hidden: false, showModal() { this.open = true; }, close() { this.open = false; if (this.onclose) this.onclose(); }});
    return elements.get(name);
  };
  const reply = (status, body, headers = {}) => ({ok: status >= 200 && status < 300, status, headers: {get: name => headers[name.toLowerCase()] ?? null}, async json() { return body; }, async text() { return typeof body === 'string' ? body : JSON.stringify(body); }});
  const context = vm.createContext({
    state: structuredClone(local), STORAGE_KEY: 'test-state', hadStoredState,
    localStorage: {getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key)},
    $: element, document: {addEventListener() {}, hidden: false},
    Date, URLSearchParams, JSON, TextEncoder, TextDecoder, Uint8Array, String, btoa, atob,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    normalize() {}, render() {}, id: () => 'test-id', confirm: () => false,
    async fetch(url, options = {}) {
      server.requests++; server.auth.push(options.headers?.Authorization);
      assert.equal(options.cache, 'no-store', '캐시된 응답을 쓰면 다른 기기 변경을 놓친다');
      if (failStatus) return reply(failStatus, {message: 'fail'});
      const path = new URL(url).pathname;
      if (path === `/repos/${REPO}`) return reply(200, {private: isPrivate});
      if (path === PRICE_FILE) {
        assert.equal(options.method ?? 'GET', 'GET', '시세 파일은 읽기만 한다');
        server.priceAsks.push(options.headers?.['If-None-Match'] ?? null);
        if (server.priceStatus) return reply(server.priceStatus, {message: 'fail'});
        if (!server.prices) return reply(404, {message: 'Not Found'});
        if (options.headers?.['If-None-Match'] === server.prices.etag) return reply(304, '');
        return reply(200, server.prices.text, {etag: server.prices.etag});
      }
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
  vm.runInContext(pricesSource, context);
  vm.runInContext('var restored = startSync();', context); // index.html 맨 끝처럼 모든 파일을 불러온 뒤 시작
  const remoteData = () => server.file && JSON.parse(server.file.text);
  return {context, server, items, elements, remoteData, restored: () => vm.runInContext('restored', context), run: () => vm.runInContext('syncNow()', context), status: () => element('syncStatus').textContent};
}
const waitFor = async (check) => { for (let i = 0; i < 200 && !check(); i++) await Promise.resolve(); };

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

test('손절 후 재매수 기록도 저장소에 올리고 다른 기기에서 가져온다', async () => {
  const local = {plans: [], futures: {positions: []}, actions: {}, rebuy: {name: '니프티50', lowPrice: 10000, cuts: [{shares: 5, price: 9900}]}};
  const h = harness({local});
  await h.restored();
  assert.equal(h.server.writes, 1, h.status());
  assert.deepEqual(h.remoteData().rebuy, local.rebuy);
  const other = harness({remote: h.remoteData()});
  await other.restored();
  assert.equal(other.server.writes, 0);
  assert.deepEqual(JSON.parse(other.items.get('test-state')).rebuy, local.rebuy);
});

test('손절 후 재매수 기록이 없으면 스냅샷이 예전 형식과 같다', async () => {
  const h = harness({remote: empty(), base: snap(empty())});
  await h.restored();
  assert.equal(vm.runInContext('dataSnapshot()', h.context), snap(empty()));
  assert.equal(h.server.writes, 0);
});

test('손절 후 재매수만 입력한 기기는 빈 기기로 보지 않고 저장소 기록으로 덮어쓰기 전에 묻는다', async () => {
  const local = {...empty(), rebuy: {lowPrice: 10000}};
  const remote = {plans: [{id: 'repo'}], futures: {positions: []}, actions: {}};
  const h = harness({local, remote});
  const work = h.restored();
  await waitFor(() => h.elements.get('conflictLater')?.onclick);
  h.elements.get('conflictLater').onclick();
  await work;
  assert.equal(h.server.writes, 0);
  assert.deepEqual(vm.runInContext('state.rebuy', h.context), local.rebuy);
});

// 시세 자동 채우기(데이터 저장소 etf-planner-prices.json). 종목 코드·가격은 모두 가짜 값.
const AT = '2026-09-30T13:28:09+09:00';
const PRICES = {updatedAt: AT, stocks: {AAA: {kind: '해외', market: 'NAS', asOf: '2026-09-29', close: 130.5, ma: {'60일선': 120.4567, '25개월선': 90.1}, daily: [['2026-09-29', 1, 2, 0, 130.5, 10]]}}, futures: {}};
const plan = extra => ({id: 'p1', ticker: 'AAA', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 100, endPrice: 80, stages: 30, ...extra});
const withPlan = p => ({plans: [p], futures: {positions: []}, actions: {}});
const filledPlan = extra => plan({endPrice: 90.1, ...extra, auto: {at: AT, endPrice: 90.1}}); // 시작 기준가는 직접 정하는 값이라 채우지 않는다
const statePlan = h => JSON.parse(vm.runInContext('dataSnapshot()', h.context)).plans[0];

test('시세 파일의 이동평균으로 기준가를 채우고 저장소에도 올린다', async () => {
  const local = withPlan(plan());
  const h = harness({local, remote: local, base: snap(local), prices: PRICES});
  await h.restored();
  assert.deepEqual(statePlan(h), filledPlan());
  assert.equal(h.server.writes, 1, h.status());
  assert.deepEqual(h.remoteData().plans[0], filledPlan());
  assert.match(h.status(), /동기화 완료/);
  const cached = JSON.parse(h.items.get('etf-planner-prices'));
  assert.equal(cached.stocks.AAA.daily, undefined, '봉 기록은 이 기기에 두지 않는다');
  assert.deepEqual(cached.stocks.AAA.closes, {D: [130.5], W: [130.5]}, '종가만 둔다(새로 고른 기준선 계산용)');
  assert.equal(cached.etag, '"p1"');
  assert.match(h.elements.get('priceStatus').textContent, /종목 1개/);
});

test('다른 기기가 같은 시세로 먼저 채워 올렸어도 이 기기 수정과 기록 차이 창이 뜨지 않는다', async () => {
  const before = withPlan(plan());
  const local = withPlan(plan({note: '이 기기 메모'}));
  const h = harness({local, remote: withPlan(filledPlan()), base: snap(before), prices: PRICES});
  await h.restored();
  assert.equal(h.elements.get('conflictDialog')?.open, undefined, h.status());
  assert.equal(h.server.writes, 1);
  assert.deepEqual(h.remoteData().plans[0], {...plan({note: '이 기기 메모'}), endPrice: 90.1, auto: {at: AT, endPrice: 90.1}});
});

test('다른 기기 기록을 가져올 때도 시세를 채우고, 채운 기록을 올린다', async () => {
  const before = withPlan(plan());
  const remote = withPlan(plan({note: '다른 기기 메모'}));
  const h = harness({local: before, remote, base: snap(before), prices: PRICES});
  await h.restored();
  assert.deepEqual(statePlan(h), {...plan({note: '다른 기기 메모'}), endPrice: 90.1, auto: {at: AT, endPrice: 90.1}});
  assert.equal(h.server.writes, 1);
  assert.deepEqual(h.remoteData().plans[0], statePlan(h));
});

test('직접 고친 기준가는 다음 시세 갱신까지 두고, 시세가 바뀌면 덮어쓴다(바뀌지 않은 시세는 304로 다시 받지 않음)', async () => {
  const local = withPlan(filledPlan({endPrice: 88}));
  const h = harness({local, remote: local, base: snap(local), prices: PRICES});
  await h.restored();
  assert.equal(statePlan(h).endPrice, 88);
  assert.equal(h.server.writes, 0);
  await h.run();
  assert.deepEqual(h.server.priceAsks, [null, '"p1"']);
  assert.equal(statePlan(h).endPrice, 88);
  const next = {...PRICES, updatedAt: '2026-09-30T14:10:00+09:00', stocks: {AAA: {...PRICES.stocks.AAA, ma: {'60일선': 125, '25개월선': 91}}}};
  h.server.prices = {etag: '"p2"', text: JSON.stringify(next)};
  await h.run();
  assert.deepEqual([statePlan(h).startPrice, statePlan(h).endPrice], [100, 91]);
  assert.deepEqual(statePlan(h).auto, {at: '2026-09-30T14:10:00+09:00', endPrice: 91});
  assert.equal(h.server.writes, 1);
  assert.equal(h.remoteData().plans[0].endPrice, 91);
});

test('이 기기에 둔 시세가 옛 형식(종가 없음)이면 ETag 없이 다시 받는다', async () => {
  const local = withPlan(filledPlan());
  const old = {updatedAt: AT, stocks: {AAA: {kind: '해외', asOf: '2026-09-29', close: 130.5, ma: PRICES.stocks.AAA.ma}}, futures: {}, etag: '"p1"'};
  const h = harness({local, remote: local, base: snap(local), prices: PRICES, stored: {'etf-planner-prices': JSON.stringify(old)}});
  await h.restored();
  assert.deepEqual(h.server.priceAsks, [null]);
  const cached = JSON.parse(h.items.get('etf-planner-prices'));
  assert.deepEqual([cached.format, cached.stocks.AAA.closes.D], [2, [130.5]]);
  await h.run();
  assert.deepEqual(h.server.priceAsks, [null, '"p1"'], '새 형식이면 다시 ETag로 묻는다');
  assert.equal(h.server.writes, 0);
});

test('늦게 읽은 옛 시세로는 다른 기기가 채운 새 시세를 되돌리지 않는다', async () => {
  const newer = withPlan(plan({endPrice: 91, auto: {at: '2026-10-01T09:10:00+09:00', endPrice: 91}}));
  const h = harness({local: newer, remote: newer, base: snap(newer), prices: PRICES});
  await h.restored();
  assert.equal(statePlan(h).endPrice, 91);
  assert.equal(h.server.writes, 0);
});

test('시세 파일을 읽지 못해도 기록 동기화는 그대로 하고 알림만 남긴다', async () => {
  const old = empty();
  const local = withPlan(plan());
  const h = harness({local, remote: old, base: snap(old), priceStatus: 500});
  await h.restored();
  assert.equal(h.server.writes, 1);
  assert.deepEqual(h.remoteData().plans[0], plan());
  assert.match(h.status(), /동기화 완료/);
  assert.match(h.elements.get('priceStatus').textContent, /시세 확인 실패/);
});
