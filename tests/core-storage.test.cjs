const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');
const KEY = 'etf-exit-planner-standalone-v1';

function boot({raw = null, denied = false} = {}) {
  const calls = {reads: 0, writes: 0}, storage = new Map(raw === null ? [] : [[KEY, raw]]);
  const elements = new Map(), element = key => {
    if(!elements.has(key)) elements.set(key, {textContent:'',value:'',placeholder:'',hidden:false,replaceChildren(){}});
    return elements.get(key);
  };
  const top = {style: {setProperty() {}}, querySelector: () => ({offsetTop: 0})};
  const context = vm.createContext({
    document: {getElementById:element, querySelectorAll: () => [], querySelector: () => top,addEventListener(){}},
    localStorage: {
      getItem(key) { calls.reads++; if (denied) throw Error('storage blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { calls.writes++; storage.set(key, String(value)); }
    },
    addEventListener() {}, crypto: {randomUUID: () => 'synthetic-id'}
  });
  vm.runInContext(source('ma-ladder.js') + '\n' + source('data-validation.js') + '\n' + source('core.js'), context);
  const snapshot = () => JSON.parse(vm.runInContext('JSON.stringify(state)', context));
  const loadError = () => vm.runInContext('typeof plannerLoadError === "string" ? plannerLoadError : ""', context);
  return {context, calls, storage, snapshot, loadError,element};
}

test('localStorage 읽기가 차단되어도 플래너가 열리고 저장 차단 사유를 보존한다', () => {
  const h = boot({denied: true});
  assert.equal(h.calls.reads, 1);
  assert.equal(h.calls.writes, 0);
  assert.deepEqual(h.snapshot().plans, []);
  assert.match(h.loadError(), /불러오|읽|저장/);
  assert.equal(vm.runInContext('plannerLoadedRaw', h.context), null);
});

for (const [name, raw] of [
  ['깨진 JSON', '{"plans":['],
  ['null 종목', JSON.stringify({plans: [null], futures: {}})],
  ['null 루트', 'null'],
  ['범위를 벗어난 회차', JSON.stringify({plans: [{id: 'synthetic', stages: 1000000000}], futures: {}})]
]) {
  test(`${name} 저장 기록은 검증 오류로 격리하고 원문을 보존한다`, () => {
    const h = boot({raw});
    assert.deepEqual(h.snapshot().plans, []);
    assert.ok(h.loadError(), '정상 빈 기록처럼 취급하면 다음 자동 저장이 원문을 덮어쓴다');
    assert.equal(vm.runInContext('plannerLoadedRaw', h.context), raw);
    assert.equal(vm.runInContext('hadStoredState', h.context), true);
    assert.equal(h.storage.get(KEY), raw);
    assert.equal(h.calls.writes, 0);
  });
}

test('저장 기록이 없는 첫 실행은 오류 없이 기본 상태를 메모리에서 만든다', () => {
  const h = boot();
  assert.equal(h.loadError(), '');
  assert.equal(vm.runInContext('hadStoredState', h.context), false);
  assert.equal(h.snapshot().tab, 'plans');
  assert.deepEqual(h.snapshot().plans, []);
  assert.equal(h.calls.writes, 0);
});

test('유효한 옛 기록은 숫자 문자열·알 수 없는 호환 필드를 보존하며 선택 필드를 만들지 않는다', () => {
  const legacy = {
    plans: [{id: 'synthetic', ticker: 'TEST', checked: [true, false], holdings: [{name: '가상 계정', shares: '2'}], note: '가상 메모', futureField: {keep: 1}}],
    futures: {positions: [{month: 202612, contracts: '1', price: '1400'}], levels: []},
    actions: {}, selectedPlan: 'synthetic', tab: 'plans', futureSetting: {keep: true}
  };
  const raw = JSON.stringify(legacy), h = boot({raw}), data = h.snapshot();
  assert.equal(h.loadError(), '');
  assert.deepEqual(data.plans, legacy.plans);
  assert.deepEqual(data.futures.positions, legacy.futures.positions);
  assert.deepEqual(data.futureSetting, legacy.futureSetting);
  for (const key of ['rebuy', 'alerts']) assert.equal(Object.hasOwn(data, key), false);
  for (const key of ['rebuy', 'rollSpread', 'lossPrice']) assert.equal(Object.hasOwn(data.futures, key), false);
  assert.equal(h.storage.get(KEY), raw);
  assert.equal(h.calls.writes, 0);
});

test('core와 sync를 함께 열면 손상 원문은 자동 저장·동기화에서 보호되고 명시적 백업 복원 뒤에만 다시 저장한다', async () => {
  const raw='{"plans":[', h=boot({raw}), alerts=[];
  h.storage.set('etf-planner-data-repo','example/private-data');
  h.storage.set('etf-planner-github-token','synthetic-token');
  Object.assign(h.context,{
    setTimeout(){},clearTimeout(){},setInterval(){},fxEntry:()=>null,btcEntry:()=>null,priceCollectionLate:()=>false,render(){},
    confirm:()=>true,alert:message=>alerts.push(message),fetch:()=>{throw Error('quarantined records must not make network requests');}
  });
  vm.runInContext(source('repo-security.js')+'\n'+source('sync.js'),h.context);
  await vm.runInContext('startSync()',h.context);
  assert.equal(vm.runInContext('save()',h.context),false);
  assert.equal(h.calls.writes,0);assert.equal(h.storage.get(KEY),raw);
  assert.match(h.element('syncStatus').textContent,/기록.*불러오지 못/);
  let downloaded;h.context.downloadText=text=>{downloaded=text;};h.element('exportBtn').onclick();
  assert.equal(downloaded,raw,'깨진 JSON도 변형 없이 다운로드한다');
  const restored={plans:[{id:'restored',stages:2}],futures:{positions:[]},actions:{}};
  const restore=()=>h.element('importInput').onchange({target:{files:[{text:async()=>JSON.stringify(restored)}],value:'synthetic.json'}});
  const set=h.context.localStorage.setItem;h.context.localStorage.setItem=()=>{throw Error('synthetic quota');};
  downloaded=null;await restore();assert.equal(downloaded,raw);assert.ok(h.loadError());assert.equal(h.storage.get(KEY),raw);assert.match(alerts.at(-1),/복원 실패/);
  h.context.localStorage.setItem=set;
  await restore();assert.equal(h.loadError(),'');assert.equal(vm.runInContext('plannerLoadedRaw',h.context),null);
  assert.equal(h.snapshot().plans[0].id,'restored');assert.equal(JSON.parse(h.storage.get(KEY)).plans[0].id,'restored');
  assert.equal(vm.runInContext('save()',h.context),true);
});

function localWriter(h){
  Object.assign(h.context,{setTimeout(){},clearTimeout(){},setInterval(){},render(){}});
  h.context.document.createElement=()=>({append(){}});
  vm.runInContext(source('repo-security.js')+'\n'+source('assets-calc.js')+'\n'+source('sync.js'),h.context);
  return code=>vm.runInContext(code,h.context);
}

test('실행 중 다른 탭이 손상시킨 원문도 다음 저장에서 격리하고 현재 원문을 보존한다',()=>{
  const h=boot(),run=localWriter(h),raw='{"plans":[';h.storage.set(KEY,raw);
  assert.equal(run('save()'),false);assert.equal(h.storage.get(KEY),raw);assert.equal(run('plannerLoadedRaw'),raw);assert.ok(h.loadError());
});

test('실행 중 저장소 읽기가 실패하면 앞서 읽은 원문을 현재 기록의 복구본으로 쓰지 않는다',()=>{
  const h=boot({raw:JSON.stringify({plans:[],futures:{positions:[]},actions:{}})}),run=localWriter(h);
  h.context.localStorage.getItem=key=>{if(key===KEY)throw Error('synthetic denied');return h.storage.get(key)??null;};
  assert.equal(run('save()'),false);assert.equal(run('plannerLoadedRaw'),null);assert.equal(h.calls.writes,0);
});

test('storage 이벤트 전의 다른 탭 입력도 실제 저장 직전에 병합한다',()=>{
  const raw=JSON.stringify({plans:[{id:'synthetic',stages:2,note:'initial'}],futures:{positions:[]},actions:{}}),h=boot({raw}),run=localWriter(h),other=h.snapshot();
  other.plans[0].note='other tab';h.storage.set(KEY,JSON.stringify(other));run('state.actions.buyNote="this tab";save()');
  const disk=JSON.parse(h.storage.get(KEY));assert.equal(disk.plans[0].note,'other tab');assert.equal(disk.actions.buyNote,'this tab');
});

test('다른 탭과 같은 칸의 충돌 복구본을 쓰지 못하면 최신 로컬 원문을 덮어쓰지 않는다',()=>{
  const raw=JSON.stringify({plans:[{id:'synthetic',stages:2,note:'initial'}],futures:{positions:[]},actions:{}}),h=boot({raw}),run=localWriter(h),other=h.snapshot();
  other.plans[0].note='other tab';const current=JSON.stringify(other);h.storage.set(KEY,current);
  const set=h.context.localStorage.setItem;h.context.localStorage.setItem=(key,value)=>{if(key==='etf-planner-sync-recovery')throw Error('synthetic full');set(key,value);};
  assert.throws(()=>run('state.plans[0].note="this tab";save()'),/synthetic full/);assert.equal(h.storage.get(KEY),current);
});

test('필수 복구본 보관도 깨진 기존 복구 원문을 빈 목록으로 덮어쓰지 않는다',()=>{
  const h=boot(),run=localWriter(h),key='etf-planner-sync-recovery',raw='{"broken":';h.storage.set(key,raw);
  assert.throws(()=>run('backupRecord(dataSnapshot(),"synthetic")'));assert.equal(h.storage.get(key),raw);
});
