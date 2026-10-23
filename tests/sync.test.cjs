const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = ['repo-security.js','data-validation.js','price-collection.js','sync.js'].map(f=>fs.readFileSync(require('node:path').join(__dirname, '../js',f), 'utf8')).join('\n');
const pricesSource = fs.readFileSync(require('node:path').join(__dirname, '../js/ma-ladder.js'), 'utf8') + '\n;\n' + fs.readFileSync(require('node:path').join(__dirname, '../js/prices.js'), 'utf8'); // 브라우저처럼 시세 채우기(prices.js)도 함께
if (!source.includes('async function syncNow(')) throw Error('동기화 구현을 찾지 못했습니다.');

const REPO = 'me/data';
const FILE = `/repos/${REPO}/contents/etf-planner-data.json`;
const PRICE_FILE = `/repos/${REPO}/contents/etf-planner-prices.json`;
const empty = () => ({plans: [], futures: {positions: []}, actions: {}});
const snap = value => JSON.stringify({plans: value.plans, futures: value.futures, actions: value.actions});
const b64 = text => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');

// 가짜 GitHub API: 파일 sha가 다르면 409로 거절한다(실제 GitHub과 같은 동시 저장 보호).
// 시세 파일(prices)은 있으면 ETag와 함께 돌려주고, 같은 ETag로 물으면 304. priceStatus를 주면 시세 파일 요청만 그 상태로 실패.
function harness({local = empty(), remote = null, base = '', hadStoredState = true, stored = {}, connect = true, isPrivate = true, failStatus = 0, prices = null, priceStatus = 0, includeHistory = false, historyEvents = []} = {}) {
  const items = new Map(Object.entries(stored));
  if (connect) {
    items.set('etf-planner-data-repo', REPO);
    items.set('etf-planner-github-token', 'test-token');
    items.set('etf-planner-collection-request-token','fake-issues-token');
    items.set('etf-planner-collection-data-repo',REPO);
    if (base) items.set('etf-planner-sync-base:' + REPO, base);
  }
  const elements = new Map();
  let version = 1;
  const server = {file: remote ? {sha: 'sha-1', text: JSON.stringify(remote, null, 2)} : null, writes: 0, requests: 0, auth: [], puts: [], beforePut: null,
    prices: prices && {etag: '"p1"', text: JSON.stringify(prices)}, priceStatus, priceAsks: [], dispatches: [], requestId: ''};
  const element = name => {
    if (!elements.has(name)) elements.set(name, {textContent: '', value: '', placeholder: '', hidden: false, showModal() { this.open = true; }, close() { this.open = false; if (this.onclose) this.onclose(); }, replaceChildren(...children) { this.children = children; }});
    return elements.get(name);
  };
  const reply = (status, body, headers = {}) => ({ok: status >= 200 && status < 300, status, headers: {get: name => headers[name.toLowerCase()] ?? null}, async json() { return body; }, async text() { return typeof body === 'string' ? body : JSON.stringify(body); }});
  const context = vm.createContext({
    state: structuredClone(local), STORAGE_KEY: 'test-state', hadStoredState,
    localStorage: {getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key)},
    $: element, $$:()=>[], esc:value=>String(value??""), document: {addEventListener() {}, hidden: false, createElement: () => ({children: [], append(...c) { this.children.push(...c); }})},
    Date, URLSearchParams, JSON, TextEncoder, TextDecoder, Uint8Array, String, btoa, atob, AbortController,crypto:require('node:crypto').webcrypto,
    setTimeout: (fn,ms) => {if(ms===5000)queueMicrotask(fn);return 1;}, clearTimeout() {}, setInterval() {},
    normalize() {}, render() {}, id: () => 'test-id', confirm: () => false,
    async fetch(url, options = {}) {
      server.requests++; server.auth.push(options.headers?.Authorization);
      assert.equal(options.cache, 'no-store', '캐시된 응답을 쓰면 다른 기기 변경을 놓친다');
      if (failStatus) return reply(failStatus, {message: 'fail'});
      const path = new URL(url).pathname;
      if(path==='/repos/oax2310-blip/etf-planner-data/issues'){
        assert.equal(options.method,'POST');const body=JSON.parse(options.body);server.dispatches.push(body);server.requestId=JSON.parse(body.body).request_id;
        return reply(201,{number:123});
      }
      if(path==='/repos/oax2310-blip/etf-planner-data/issues/123')return reply(200,{state:'open'});
      if (path === `/repos/${REPO}`) return reply(200, {private: isPrivate});
      if (includeHistory && path === `/repos/${REPO}/contents/etf-planner-alert-state.json`) return reply(200, {history:historyEvents});
      if (path === PRICE_FILE) {
        assert.equal(options.method ?? 'GET', 'GET', '시세 파일은 읽기만 한다');
        server.priceAsks.push(options.headers?.['If-None-Match'] ?? null);
        if (server.priceStatus) return reply(server.priceStatus, {message: 'fail'});
        if (!server.prices) return reply(404, {message: 'Not Found'});
        if (options.headers?.['If-None-Match'] === server.prices.etag) return reply(304, '');
        const doc=JSON.parse(server.prices.text);
        return reply(200, server.requestId?{...doc,collectionRequests:[{id:server.requestId,failed:false}]}:doc, {etag: server.prices.etag});
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
  if(includeHistory)for(const name of ['alert-history-store.js','alert-history.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js',name),'utf8'),context);
  vm.runInContext(source, context);
  vm.runInContext(pricesSource, context);
  vm.runInContext('var restored = startSync();', context); // js/start.js처럼 모든 파일을 불러온 뒤 시작
  const remoteData = () => server.file && JSON.parse(server.file.text);
  return {context, server, items, elements, remoteData, restored: () => vm.runInContext('restored', context), run: () => vm.runInContext('syncNow()', context), status: () => element('syncStatus').textContent};
}
const waitFor = async (check) => { for (let i = 0; i < 200 && !check(); i++) await Promise.resolve(); };

test('악성·잘못된 백업은 현재 기록·복구본·원격 저장을 변경하기 전에 거부한다',async()=>{
  const local={...empty(),plans:[{id:'original',stages:2,note:'보존할 가상 메모'}]};
  for(const bad of [
    {...empty(),plans:[{stages:'<img src=x onerror="synthetic()">'}]},
    {...empty(),plans:[{stages:2,holdings:'not-a-list'}]},
    {...empty(),futures:{positions:[null]}},
    JSON.parse('{"plans":[],"futures":{},"__proto__":{"polluted":true}}')
  ]){
    const h=harness({local,connect:false,stored:{'test-state':JSON.stringify(local),'etf-planner-sync-recovery':'existing recovery'}});
    const alerts=[];h.context.alert=message=>alerts.push(message);const before=[...h.items];
    const file={files:[{text:async()=>JSON.stringify(bad)}],value:'synthetic.json'};
    await h.elements.get('importInput').onchange({target:file});
    assert.deepEqual(h.context.state,local);assert.deepEqual([...h.items],before);assert.equal(h.server.writes,0);
    assert.match(alerts[0],/복원 실패/);assert.equal(file.value,'');
  }
});

test('정상 옛 백업을 가져오고 저장·동기화·내려받기·재복원해도 선택 필드와 체결을 보존한다',async()=>{
  const incoming={...empty(),plans:[{id:'legacy',stages:'2',checked:[true,false],holdings:[{name:'예시',shares:4}],note:'문자 < > & 메모',fills:{0:{plannedQty:2,qty:2,price:100}}}],rebuy:{items:[{id:'r',stages:[{name:'25분봉',price:100}],cuts:[null]}]}};
  const h=harness({connect:false});h.context.alert=()=>{};h.context.confirm=()=>true;
  const restore=async value=>h.elements.get('importInput').onchange({target:{files:[{text:async()=>JSON.stringify(value)}],value:'backup.json'}});
  await restore(incoming);assert.deepEqual(JSON.parse(h.items.get('test-state')),incoming);
  let downloaded;h.context.downloadJson=value=>{downloaded=JSON.parse(JSON.stringify(value));};h.elements.get('exportBtn').onclick();
  delete downloaded.exportedAt;assert.deepEqual(downloaded,incoming);
  h.items.set('etf-planner-data-repo',REPO);h.items.set('etf-planner-github-token','test-token');h.context.loadConfig();await h.run();
  assert.deepEqual(h.remoteData(),incoming);await restore(downloaded);assert.deepEqual(JSON.parse(h.items.get('test-state')),incoming);
});

test('JSON 복원은 백업 시각·계획 수를 보여 주고 확인해야 바꾸며, 바꾸기 전 기록을 복구본 목록에 남긴다',async()=>{
  const local={...empty(),plans:[{id:'now',stages:2},{id:'now2',stages:2}]},backup={...empty(),plans:[{id:'old',stages:2}],exportedAt:'2026-09-01T05:20:00Z'};
  const h=harness({local,connect:false,stored:{'test-state':JSON.stringify(local)}}),asked=[],alerts=[];h.context.alert=m=>alerts.push(m);
  const restore=async(value,answer)=>{h.context.confirm=m=>{asked.push(m);return answer;};await h.elements.get('importInput').onchange({target:{files:[{text:async()=>JSON.stringify(value)}],value:'backup.json'}});};
  await restore(backup,false);
  assert.match(asked[0],/백업 파일: 2026\. 9\. 1\..* 백업 · 계획 1개 · 달러선물 0개 월물/);assert.match(asked[0],/지금 기록: 계획 2개/);
  assert.deepEqual(h.context.state,local);assert.equal(h.items.get('etf-planner-sync-recovery'),undefined,'취소하면 아무것도 바꾸지 않는다');assert.equal(alerts.length,0);
  await restore(backup,true);
  assert.deepEqual(JSON.parse(h.items.get('test-state')).plans,backup.plans);assert.equal(JSON.parse(h.items.get('test-state')).exportedAt,undefined,'백업 시각은 기록에 넣지 않는다');
  const kept=JSON.parse(h.items.get('etf-planner-sync-recovery'));
  assert.equal(kept.length,1);assert.deepEqual(kept[0].plans,local.plans);assert.equal(kept[0].recoveryReason,'JSON 복원 전 이 기기 기록');
  // 받은 복구본은 그대로 다시 복원할 수 있다
  await restore(kept[0],true);assert.deepEqual(JSON.parse(h.items.get('test-state')).plans,local.plans);
  assert.equal(JSON.parse(h.items.get('test-state')).recoveryReason,undefined);
});

test('복구본은 최근 5개까지 목록으로 남기고 옛 한 개 형식도 이어 받으며, 항목마다 내려받을 수 있다',async()=>{
  const old={...empty(),plans:[{id:'legacy-recovery'}],recoveryReason:'옛 복구본',exportedAt:'2026-10-01T00:00:00Z'};
  const h=harness({connect:false,stored:{'etf-planner-sync-recovery':JSON.stringify(old)}});
  const box=h.elements.get('syncRecoveryList');assert.equal(box.hidden,false);assert.equal(box.children.length,2,'제목 + 옛 복구본 1개');
  for(let i=0;i<6;i++)h.context.backupRecord(JSON.stringify({...empty(),plans:[{id:'r'+i}]}),'시험 보관');
  const list=JSON.parse(h.items.get('etf-planner-sync-recovery'));
  assert.deepEqual(list.map(r=>r.plans[0].id),['r1','r2','r3','r4','r5'],'오래된 것부터 지운다');
  assert.equal(box.children.length,6);assert.match(box.children[1].textContent,/시험 보관 · 계획 1개/);
  let downloaded;h.context.downloadJson=v=>{downloaded=v;};box.children[1].children[0].onclick();assert.equal(downloaded.plans[0].id,'r5','맨 위가 최근 것');
  // 저장 공간이 모자라면 오래된 복구본을 줄여서라도 남기고, 하나도 못 남기면 예외(덮어쓰기 중단)
  const setItem=h.context.localStorage.setItem;h.context.localStorage.setItem=(k,v)=>{if(k==='etf-planner-sync-recovery'&&JSON.parse(v).length>2)throw Error('full');setItem(k,v);};
  h.context.backupRecord(JSON.stringify({...empty(),plans:[{id:'r6'}]}),'시험 보관');
  assert.deepEqual(JSON.parse(h.items.get('etf-planner-sync-recovery')).map(r=>r.plans[0].id),['r5','r6']);
  h.context.localStorage.setItem=()=>{throw Error('full');};
  assert.throws(()=>h.context.backupRecord(JSON.stringify(empty()),'시험 보관'),/full/);
});

test('잘못된 원격 JSON은 이 기기의 기록·동기화 기준·원격 기록을 보존하고 오류를 표시한다',async()=>{
  const local={...empty(),plans:[{id:'local',stages:2}]};
  const remote={...empty(),plans:[{id:'malicious',stages:'<img src=x onerror="synthetic()">'}]};
  const h=harness({local,remote,base:snap(local),stored:{'test-state':JSON.stringify(local)}});await h.restored();
  assert.equal(h.server.writes,0);assert.deepEqual(h.context.state,local);assert.equal(h.items.get('test-state'),JSON.stringify(local));
  assert.equal(h.items.get('etf-planner-sync-base:'+REPO),snap(local));assert.deepEqual(h.remoteData(),remote);
  assert.match(h.status(),/기록 형식/);
  assert.throws(()=>h.context.applyRemote(JSON.stringify(remote)),/기록 형식/);assert.deepEqual(h.context.state,local);
});

test('백업 복원·원격 적용 중 브라우저 저장이 실패하면 메모리의 기존 기록도 유지한다',async()=>{
  const local={...empty(),plans:[{id:'original',stages:2}]},incoming={...empty(),plans:[{id:'new',stages:2}]};
  const h=harness({local,connect:false,stored:{'test-state':JSON.stringify(local)}}),before=[...h.items];
  h.context.localStorage.setItem=()=>{throw Error('synthetic storage full');};h.context.alert=()=>{};h.context.confirm=()=>true;
  await h.elements.get('importInput').onchange({target:{files:[{text:async()=>JSON.stringify(incoming)}],value:'backup.json'}});
  assert.deepEqual(h.context.state,local);assert.deepEqual([...h.items],before);
  assert.throws(()=>h.context.applyRemote(JSON.stringify(incoming)),/synthetic storage full/);
  assert.deepEqual(h.context.state,local);assert.deepEqual([...h.items],before);
});

const historyEvent = (eventId,extra={}) => ({eventId,ticker:'TEST',line:'분할매수 2차',ruleId:'trade:buy:one:round',name:'예제 ETF',price:101,ma:100,currency:'USD',condition:'up',trigger:'reach',occurredAt:'2026-10-14T01:00:00Z',observedAt:'2026-10-14T00:59:59Z',...extra});
test('새 발송 이력은 기존 비공개 플래너 파일과 JSON 백업·복원으로 왕복한다',async()=>{
  const local=empty(),h=harness({local,remote:local,base:snap(local),includeHistory:true,historyEvents:[historyEvent('new')]});
  await h.restored();assert.equal(h.remoteData().alertHistory.items[0].id,'new');assert.equal(h.remoteData().alertHistory.items[0].price,101);
  const saved=JSON.parse(h.items.get('test-state'));assert.deepEqual(saved.alertHistory,h.remoteData().alertHistory);assert.deepEqual(h.remoteData().plans,[]);
  h.context.markAlertHistoryRead('new');await h.run();assert.ok(h.remoteData().alertHistory.items[0].readAt);
  const file={files:[{text:async()=>JSON.stringify(h.remoteData())}],value:'backup.json'};
  h.context.alert=()=>{};await h.elements.get('importInput').onchange({target:file});assert.equal(file.value,'');assert.equal(h.context.state.alertHistory.items[0].id,'new');
});
test('기기별 읽음·삭제·새 알림만 달라도 거래 충돌 없이 병합하고 삭제 이력은 재발송 파일에서 살리지 않는다',async()=>{
  const local={...empty(),alertHistory:{items:[{...historyEvent('one'),id:'one',readAt:'2026-10-14T02:00:00Z'}],deletedIds:['deleted']}},remote={...empty(),alertHistory:{items:[{...historyEvent('two'),id:'two'},{...historyEvent('deleted'),id:'deleted'}],deletedIds:[]}};
  const h=harness({local,remote,base:snap(empty()),includeHistory:true,historyEvents:[historyEvent('deleted')]});await h.restored();
  assert.equal(vm.runInContext("sync.blocked",h.context),false);assert.deepEqual(h.remoteData().alertHistory.items.map(item=>item.id).sort(),['one','two']);assert.ok(h.remoteData().alertHistory.items.find(item=>item.id==='one').readAt);
  assert.deepEqual(h.remoteData().alertHistory.deletedIds,['deleted']);
});
test('알림 클릭이 먼저 도착해도 원격 플래너 파일에서 복원되는 내역을 읽음으로 유지한다',async()=>{
  const remote={...empty(),alertHistory:{items:[{...historyEvent('remote'),id:'remote'}],deletedIds:[]}},h=harness({remote,includeHistory:true,hadStoredState:false});
  h.context.noteAlertHistoryRead('remote');await h.restored();assert.ok(h.context.state.alertHistory.items[0].readAt);assert.ok(h.remoteData().alertHistory.items[0].readAt);
});

test('알림 조건과 휴대폰 구독을 다른 기기에서 손실 없이 가져온다', async () => {
  const local=empty(), remote={...empty(),alerts:{rules:[{id:'rule-1',ticker:'AAA',period:60,unit:'일선',tolerancePct:0.5,enabled:true}],subscriptions:[{id:'device-1',subscription:{endpoint:'https://fcm.googleapis.com/test-only',keys:{p256dh:'fake-public-key',auth:'fake-auth'}}}]}};
  const h=harness({local,remote,base:snap(local)});
  await h.restored();
  assert.deepEqual(JSON.parse(h.items.get('test-state')).alerts,remote.alerts);
  assert.deepEqual(JSON.parse(vm.runInContext('dataSnapshot()',h.context)).alerts,remote.alerts);
  assert.equal(h.server.writes,0);
});

test('알림을 설정한 기기는 새 빈 기기로 취급하지 않는다', async () => {
  const alerts={rules:[{id:'alert-1',ticker:'AAA',period:20,unit:'주선',tolerancePct:0.5,enabled:true}]};
  const h=harness({local:{...empty(),alerts}});
  await h.restored();
  assert.deepEqual(h.remoteData().alerts,alerts);
  assert.equal(vm.runInContext('isBlank(dataSnapshot())',h.context),false);
});

test('시세를 기다리는 달러선물 자동 매수 설정도 빈 기기로 보지 않고 다른 기기로 보낸다', async () => {
  const local=empty();local.futures.buyPlan={startLine:'32일선',endPrice:1380,contracts:7,units:['선','일선','개월선']};
  const h=harness({local});await h.restored();
  assert.equal(vm.runInContext('isBlank(dataSnapshot())',h.context),false);
  assert.deepEqual(h.remoteData().futures.buyPlan,local.futures.buyPlan);
  const other=harness({remote:h.remoteData(),hadStoredState:false});await other.restored();
  assert.deepEqual(JSON.parse(other.items.get('test-state')).futures.buyPlan,local.futures.buyPlan);
});

test('달러 손절·재매수만 설정한 기기도 빈 기기로 보지 않고 체결 기록을 다른 기기로 보낸다', async () => {
  const local=empty();local.futures.rebuy={lowPrice:1400,floorPrice:1300,contracts:20,cuts:[{contracts:3,price:1399.7,targetPrice:1400}],stages:[{name:'25분봉',price:0,done:true,contracts:1,execPrice:1399.8}],notify:{buys:true}};
  const h=harness({local});await h.restored();
  assert.equal(vm.runInContext('isBlank(dataSnapshot())',h.context),false);
  assert.deepEqual(h.remoteData().futures.rebuy,local.futures.rebuy);
  const other=harness({remote:h.remoteData(),hadStoredState:false});await other.restored();
  assert.deepEqual(JSON.parse(other.items.get('test-state')).futures.rebuy,local.futures.rebuy);
});

test('달러선물 회차별 알림 선택과 미입력 회차를 다른 기기에 그대로 보낸다', async () => {
  const local=empty();local.futures.levels=[{days:25,price:1400,contracts:3,notify:true,tranches:[
    {slot:0,completed:false,notify:false},{slot:1,completed:false,notify:true},{slot:2,completed:false},
  ]}];
  const h=harness({local});await h.restored();
  assert.deepEqual(h.remoteData().futures.levels,local.futures.levels);
  const other=harness({remote:h.remoteData(),hadStoredState:false});await other.restored();
  assert.deepEqual(JSON.parse(other.items.get('test-state')).futures.levels,local.futures.levels);
});

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
  assert.deepEqual(JSON.parse(h.items.get('etf-planner-sync-recovery')).at(-1).plans, local.plans);
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
  assert.deepEqual(JSON.parse(h.items.get('etf-planner-sync-recovery')).at(-1).plans, remote.plans);
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

test('연결할 때 fine-grained 토큰(github_pat_)만 저장하고 classic 토큰은 거부한다', async () => {
  const fine = 'github_pat_' + 'A1'.repeat(20), issues = 'github_pat_' + 'B2'.repeat(20);
  for (const [data, request, saved] of [['ghp_' + 'x'.repeat(36), '', false], [fine, 'ghp_' + 'y'.repeat(36), false], [fine, fine, false], [fine, issues, true]]) {
    const h = harness({connect: false});
    await h.restored();
    const el = name => h.context.$(name);
    el('dataRepo').value = REPO; el('githubToken').value = data; el('collectionToken').value = request;
    el('connectRepo').onclick();
    assert.equal(h.items.get('etf-planner-github-token') === data, saved, h.status());
    assert.equal(h.items.has('etf-planner-collection-request-token'), saved);
    if (!saved) { assert.match(h.status(), /github_pat_|각각 발급/); assert.equal(h.server.requests, 0, '거부한 토큰으로 요청하지 않는다'); }
  }
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

test('시세 줄에 비트코인(BTC-USD) 달러 가격을 보여 주고 종목 수에서는 뺀다', async () => {
  const local = withPlan(plan());
  const btc = {kind: '코인', market: 'Coinbase', asOf: '2026-09-30', close: 65432.1, ma: {'60일선': 60000}, daily: [['2026-09-30', 1, 2, 0, 65432.1, 3]]};
  const h = harness({local, remote: local, base: snap(local), prices: {...PRICES, stocks: {...PRICES.stocks, 'BTC-USD': btc}}});
  await h.restored();
  const text = h.elements.get('priceStatus').textContent;
  assert.match(text, /종목 1개/);
  assert.match(text, /비트코인 \$65,432\.10 \(2026-09-30 UTC/);
  assert.deepEqual(statePlan(h), filledPlan(), '비트코인이 있어도 다른 종목 채우기는 같다');
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
  assert.deepEqual([cached.format, cached.stocks.AAA.closes.D], [4, [130.5]]);
  await h.run();
  assert.deepEqual(h.server.priceAsks, [null, '"p1"'], '새 형식이면 다시 ETag로 묻는다');
  assert.equal(h.server.writes, 0);
});

test('현물 환율 도입으로 옛 시세 캐시를 다시 받고, 다른 기기와 같은 값으로 채워 충돌하지 않는다', async () => {
  const before = withPlan(plan({fx: 1398.2, auto: {at: AT, fx: 1398.2}}));
  const spot = {kind: '현물환율', asOf: '2026-09-30', close: 1388.456, ma: {}};
  const prices = {...PRICES, fx: {USDKRW: spot}};
  const filled = {...plan({fx: 1388.46}), endPrice: 90.1, auto: {at: AT, fx: 1388.46, endPrice: 90.1}};
  const oldCache = {...PRICES, format: 2, etag: '"p1"'};
  const h = harness({local: {...before, plans: [{...before.plans[0], note: '이 기기 메모'}]}, remote: withPlan(filled), base: snap(before),
    prices, stored: {'etf-planner-prices': JSON.stringify(oldCache)}});
  await h.restored();
  assert.deepEqual(h.server.priceAsks, [null], '시세 파일 ETag가 같아도 형식 2는 다시 받는다');
  assert.equal(h.elements.get('conflictDialog')?.open, undefined, h.status());
  assert.equal(statePlan(h).fx, 1388.46);
  assert.equal(statePlan(h).note, '이 기기 메모');
  assert.equal(h.server.writes, 1);
  const cached = JSON.parse(h.items.get('etf-planner-prices'));
  assert.deepEqual([cached.format, cached.fx.USDKRW], [4, spot]);
  assert.match(h.elements.get('priceStatus').textContent, /현물 환율 1388.46원/);
  await h.run();
  assert.deepEqual(h.server.priceAsks, [null, '"p1"']);
  assert.equal(h.server.writes, 1, '같은 현물 환율로 반복해서 저장하지 않는다');
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

test('시세 즉시 불러오기는 수집을 요청한 뒤 새 결과로 기준가와 공유 시세를 반영한다', async () => {
  const local=withPlan(plan()),h=harness({local,remote:local,base:snap(local),prices:PRICES});
  await h.restored();
  const next={...PRICES,updatedAt:'2026-09-30T14:10:00+09:00',stocks:{AAA:{...PRICES.stocks.AAA,close:140,ma:{'25개월선':95}}}};
  h.server.prices={etag:'"p1"',text:JSON.stringify(next)}; // 서버의 ETag가 같아도 수동 조회는 실제 파일을 받는다.
  const accepted=[];h.context.assetStore={acceptPrices:(...args)=>accepted.push(args)};
  const requests=h.server.requests,writes=h.server.writes;
  await h.elements.get('refreshPricesBtn').onclick();
  assert.equal(h.server.requests,requests+3,'실제 수집을 요청하고 그 결과를 읽는다');
  assert.equal(h.server.dispatches.length,1);assert.equal(h.server.dispatches[0].title,'ETF price collection');
  assert.equal(h.server.priceAsks.at(-1),null);
  assert.equal(statePlan(h).endPrice,95);
  assert.equal(JSON.parse(h.items.get('test-state')).plans[0].endPrice,95);
  assert.equal(JSON.parse(h.items.get('etf-planner-prices')).stocks.AAA.close,140);
  assert.equal(accepted.length,1);assert.equal(accepted[0][1].stocks.AAA.close,140);
  assert.equal(h.server.writes,writes,'기록 업로드는 기존 동기화가 처리한다');
  assert.equal(h.elements.get('refreshPricesBtn').disabled,false);
  assert.match(h.elements.get('priceRefreshStatus').textContent,/시세 불러오기 완료.*최근 수집/);
});

test('새로 추가한 플래너 종목은 저장 대기 타이머보다 먼저 동기화한 뒤 수집한다',async()=>{
  const local=withPlan(plan()),h=harness({local,remote:local,base:snap(local),prices:PRICES});await h.restored();
  h.context.state.plans.push({...plan(),id:'new-plan',ticker:'BBB'});vm.runInContext('save()',h.context);
  const fetch=h.context.fetch;h.context.fetch=async(url,options)=>{
    if(url.endsWith('/issues'))assert.ok(h.remoteData().plans.some(p=>p.ticker==='BBB'),'수집 작업이 새 종목을 볼 수 있게 먼저 저장한다');
    return fetch(url,options);
  };
  await h.elements.get('refreshPricesBtn').onclick();assert.equal(h.server.dispatches.length,1);
  assert.match(h.elements.get('priceRefreshStatus').textContent,/시세 불러오기 완료/);
});

test('메인 시세 버튼도 공유 자산의 실제 ETF 시세 누락을 완료 대신 안내한다', async () => {
  const local=withPlan(plan()),h=harness({local,remote:local,base:snap(local),prices:PRICES});await h.restored();
  const message='시세 없음 1종목 (900002) · 다음 시세 수집 후 다시 불러와 주세요.';
  h.context.assetStore={acceptPrices(){},missingPriceMessage:message};
  const writes=h.server.writes;
  await h.elements.get('refreshPricesBtn').onclick();
  assert.equal(h.elements.get('priceRefreshStatus').textContent,message);
  assert.equal(h.elements.get('priceRefreshStatus').className,'warning');
  assert.doesNotMatch(h.elements.get('priceRefreshStatus').textContent,/불러오기 완료/);
  h.context.assetStore.missingPriceMessage='';
  await h.elements.get('refreshPricesBtn').onclick();
  assert.match(h.elements.get('priceRefreshStatus').textContent,/시세 불러오기 완료/);
  assert.equal(h.server.writes,writes);
});

test('시세 즉시 불러오기 실패는 마지막 시세·기준가를 유지하고 다시 누를 수 있다', async () => {
  const local=withPlan(plan()),h=harness({local,remote:local,base:snap(local),prices:PRICES});await h.restored();
  const cached=h.items.get('etf-planner-prices'),before=statePlan(h);
  h.server.priceStatus=500;
  await h.elements.get('refreshPricesDialogBtn').onclick();
  assert.equal(h.items.get('etf-planner-prices'),cached);assert.deepEqual(statePlan(h),before);
  assert.match(h.elements.get('priceRefreshStatus').textContent,/시세 확인 실패/);
  assert.equal(h.elements.get('refreshPricesBtn').disabled,false);
  h.server.priceStatus=0;await h.elements.get('refreshPricesBtn').onclick();
  assert.match(h.elements.get('priceRefreshStatus').textContent,/시세 불러오기 완료/);
});

test('시세 즉시 불러오기 중 중복 클릭과 자동 동기화는 조회를 겹치지 않는다', async () => {
  const h=harness({remote:empty(),base:snap(empty()),prices:PRICES});await h.restored();
  const fetch=h.context.fetch,requests=h.server.requests;let release;
  let held=false;h.context.fetch=async(...args)=>{if(!held){held=true;await new Promise(resolve=>release=resolve);}return fetch(...args);};
  const work=h.elements.get('refreshPricesBtn').onclick();
  assert.equal(h.elements.get('refreshPricesBtn').disabled,true);
  assert.equal(h.elements.get('refreshPricesDialogBtn').disabled,true);
  assert.match(h.elements.get('refreshPricesBtn').textContent,/불러오는 중/);
  await h.elements.get('refreshPricesDialogBtn').onclick();await h.run();
  assert.equal(h.server.requests,requests);
  release();await work;
  assert.equal(h.server.requests,requests+3);
  assert.equal(h.elements.get('refreshPricesBtn').disabled,false);
  assert.equal(vm.runInContext('sync.again',h.context),true,'자동 동기화는 다음 순서로 대기한다');
});

test('연결 전 시세 버튼은 설정을 열고, 수집 결과가 없으면 마지막 시세를 유지한다', async () => {
  const off=harness({connect:false});await off.restored();
  await off.elements.get('refreshPricesBtn').onclick();
  assert.equal(off.server.requests,0);assert.equal(off.elements.get('syncDialog').open,true);
  assert.match(off.elements.get('priceRefreshStatus').textContent,/연결해 주세요/);
  const h=harness({remote:empty(),base:snap(empty()),prices:PRICES});await h.restored();
  const cached=h.items.get('etf-planner-prices');h.server.prices=null;await h.elements.get('refreshPricesBtn').onclick();
  assert.equal(h.items.get('etf-planner-prices'),cached);
  assert.match(h.elements.get('priceRefreshStatus').textContent,/수집 완료를 아직 확인하지 못했습니다/);
  assert.doesNotMatch(h.elements.get('priceRefreshStatus').textContent,/불러오기 완료/);
});

test('시세를 받는 동안 연결이 바뀌면 이전 저장소 응답을 적용하지 않는다', async () => {
  const h=harness({remote:empty(),base:snap(empty()),prices:PRICES});await h.restored();
  const cached=h.items.get('etf-planner-prices'),fetch=h.context.fetch;let release;
  h.context.fetch=async(...args)=>{await new Promise(resolve=>release=resolve);return fetch(...args);};
  const work=h.elements.get('refreshPricesBtn').onclick();
  vm.runInContext('sync.token=""',h.context);release();await work;
  assert.equal(h.items.get('etf-planner-prices'),cached);
  assert.match(h.elements.get('priceRefreshStatus').textContent,/연결 설정이 바뀌었습니다/);
});

test('수동 시세 조회가 끝나도 입력 중인 메모를 다시 그려 지우지 않는다', async () => {
  const local=withPlan(plan()),h=harness({local,remote:local,base:snap(local),prices:PRICES});await h.restored();
  h.server.prices={etag:'"p2"',text:JSON.stringify({...PRICES,updatedAt:'2026-09-30T14:10:00+09:00'})};
  let renders=0;h.context.render=()=>renders++;h.context.document.activeElement={tagName:'TEXTAREA',value:'입력 중인 가상 메모'};
  await h.elements.get('refreshPricesBtn').onclick();
  assert.equal(renders,0);assert.equal(vm.runInContext('sync.redraw',h.context),true);
  h.context.document.activeElement=null;vm.runInContext('redrawIdle()',h.context);assert.equal(renders,1);
});

test('부분 손절·재매수 수량·고정 예정량·완료 상태는 기존 비공개 저장소로 왕복한다', async () => {
  const local={...empty(),rebuy:{items:[{id:'round-trip',name:'테스트 ETF',lowPrice:10000,shares:100,cuts:[{shares:3,price:9900,plannedShares:10,partial:true}],planned:[['25선',0]],stages:[{name:'25선',price:9900,buys:[{shares:1,price:9900,plannedShares:3,partial:true}]}]}]}};
  const h=harness({local});await h.restored();assert.deepEqual(h.remoteData().rebuy,local.rebuy);
  const other=harness({remote:h.remoteData(),hadStoredState:false});await other.restored();
  assert.deepEqual(JSON.parse(other.items.get('test-state')).rebuy,local.rebuy);assert.equal(other.server.writes,0);
  vm.runInContext('state.rebuy.items[0].cuts[0].shares=10;delete state.rebuy.items[0].cuts[0].partial;state.rebuy.items[0].stages[0].buys[0].shares=3;delete state.rebuy.items[0].stages[0].buys[0].partial;save();',other.context);
  await other.run();const final=harness({remote:other.remoteData(),hadStoredState:false});await final.restored();
  assert.deepEqual(JSON.parse(final.items.get('test-state')).rebuy,other.remoteData().rebuy);
  assert.equal(final.remoteData().rebuy.items[0].cuts[0].shares,10);assert.equal(final.remoteData().rebuy.items[0].stages[0].buys[0].shares,3);
  assert.equal(Object.hasOwn(final.remoteData().rebuy.items[0].stages[0].buys[0],'partial'),false);
});

test('60회 이후의 손절 설정·부분 체결 기록은 다른 기기로 그대로 복원된다', async()=>{
  const cuts=Array(100).fill(null);cuts[99]={shares:3,price:2000,plannedShares:10,partial:true};
  const local={...empty(),rebuy:{items:[{id:'long-rounds',name:'테스트 ETF',lowPrice:10000,shares:1000,stepPct:0.8,sellPct:1,steps:100,cuts,stages:[{name:'25선',price:2100}]}]}};
  const h=harness({local});await h.restored();assert.deepEqual(h.remoteData().rebuy,local.rebuy);
  const other=harness({remote:h.remoteData(),hadStoredState:false});await other.restored();assert.equal(other.server.writes,0);assert.deepEqual(JSON.parse(other.items.get('test-state')).rebuy,local.rebuy);
});
