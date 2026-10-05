const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),KEY='etf-planner-assets-v1',BASE='etf-planner-assets-sync-base:example/private-data';
const fake=()=>({version:1,allocation:{savedAt:'2026-01-01',classes:[],cash:[],groups:[{id:'g',items:[{id:'a',amount:100,target:10,buyPlan:{stages:[{id:'s',amount:30}]}}]}]},ledger:{savedAt:'2026-01-01',years:[]}});
function setup(initial,fetcher,shared){
  const storage=shared||new Map(initial?[[KEY,JSON.stringify(initial)]]:[]),listeners=new Map();
  const context={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    TextEncoder,TextDecoder,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
    setTimeout:()=>1,clearTimeout(){},setInterval(){},document:{hidden:false,addEventListener(){}},addEventListener:(type,fn)=>listeners.set(type,fn),
    fetch:fetcher||(()=>{throw Error('unexpected network call');})};
  const code=['js/assets-calc.js','js/assets-store.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  const store=vm.runInNewContext(`${code}\nassetStore`,context);
  return {store,storage,event:()=>listeners.get('storage')?.({key:KEY})};
}
const clone=v=>JSON.parse(JSON.stringify(v));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const contents=doc=>json({sha:'remote-sha',encoding:'base64',content:Buffer.from(JSON.stringify(doc)).toString('base64')});
function connect(storage){storage.set('etf-planner-data-repo','example/private-data');storage.set('etf-planner-github-token','fake-test-token');}

test('공유 자산 기록: 입력 없이 열면 기존 분할매수·목표·동기화 스냅샷을 바꾸지 않는다',()=>{
  const original=fake(),{store,storage}=setup(original);store.start();
  assert.deepEqual(JSON.parse(storage.get(KEY)),original);
  assert.equal(store.status.state,'off');
  assert.equal(storage.has(BASE),false);
});

test('플래너와 자산 페이지의 변경을 같은 기록에서 맞추고 다른 구역과 체결 기록을 보존한다',()=>{
  const original=fake(),first=setup(original),second=setup(null,null,first.storage);first.store.start();second.store.start();
  first.store.doc.allocation.groups[0].items[0].buyPlan.stages[0].done=true;
  first.store.doc.allocation.groups[0].items[0].buyPlan.stages[0].actual=25;
  first.store.saveSection('allocation');second.event();
  assert.equal(second.store.doc.allocation.groups[0].items[0].buyPlan.stages[0].actual,25);
  assert.equal(second.store.recovery().length,0,'다른 페이지만 바꾼 기록은 충돌로 보관하지 않는다');
  second.store.doc.allocation.groups[0].items[0].target=12;
  second.store.saveSection('allocation');first.event();
  assert.equal(first.store.doc.allocation.groups[0].items[0].target,12);
  assert.equal(first.store.doc.allocation.groups[0].items[0].buyPlan.stages[0].actual,25);
  const newer={...clone(JSON.parse(first.storage.get(KEY))),ledger:{savedAt:'2099-01-01',years:[{year:2099,accounts:[],months:[]}]}};
  first.storage.set(KEY,JSON.stringify(newer));
  first.store.doc.allocation.groups[0].items[0].buyPlan.stages.push({id:'s2',amount:40});first.store.saveSection('allocation');
  assert.equal(JSON.parse(first.storage.get(KEY)).ledger.years[0].year,2099,'다른 구역의 더 최신 기록도 보존');
});

test('분할매수 저장도 공개 데이터 저장소에는 업로드하지 않는다',async()=>{
  let writes=0;const original=fake(),{store,storage}=setup(original,async(url,options)=>{if(options.method==='PUT')writes++;return json({private:false});});
  connect(storage);store.doc.allocation.groups[0].items[0].buyPlan.stages[0].done=true;store.saveSection('allocation');await store.sync();
  assert.equal(writes,0);assert.equal(store.status.state,'error');assert.match(store.status.message,/공개 저장소/);
  assert.equal(JSON.parse(storage.get(KEY)).allocation.groups[0].items[0].buyPlan.stages[0].done,true,'실패해도 기기 기록 유지');
});

test('분할매수 기기 간 동기화는 저장 중 409를 다시 병합하고 다른 구역을 덮어쓰지 않는다',async()=>{
  const original=fake();let remote=clone(original),writes=0;
  const {store,storage}=setup(original,async(url,options)=>{
    if(url.endsWith('/repos/example/private-data'))return json({private:true});
    if(url.endsWith('/etf-planner-prices.json'))return new Response('',{status:404});
    if(options.method==='PUT'){
      writes++;
      if(writes===1){remote.ledger={savedAt:'2026-01-02',years:[{year:2026,accounts:[],months:[{m:1,pnl:100}]}]};return new Response('',{status:409});}
      remote=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString());return json({content:{sha:'saved-sha'}});
    }
    return contents(remote);
  });
  connect(storage);storage.set(BASE,JSON.stringify(original));
  const stage=store.doc.allocation.groups[0].items[0].buyPlan.stages[0];stage.done=true;stage.actual=25;store.saveSection('allocation');
  await store.sync();
  assert.equal(writes,2);assert.equal(store.status.state,'done');
  assert.equal(remote.allocation.groups[0].items[0].buyPlan.stages[0].actual,25);
  assert.equal(remote.ledger.years[0].months[0].pnl,100);
  assert.deepEqual(JSON.parse(storage.get(BASE)),remote);
});

test('분할매수·자산 JSON 복원은 기존 기록을 보관하고 체결 기록까지 복원한다',()=>{
  const {store,storage}=setup(fake()),incoming=fake();incoming.allocation.groups[0].items[0].buyPlan.stages[0]={id:'s',amount:30,actual:20,done:true};
  assert.equal(store.restore(incoming),true);
  assert.equal(JSON.parse(storage.get(KEY)).allocation.groups[0].items[0].buyPlan.stages[0].actual,20);
  assert.equal(store.recovery().length,2);
  assert.equal(store.restore({version:2}),false);
});
