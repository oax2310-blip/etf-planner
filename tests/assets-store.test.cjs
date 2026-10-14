const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),KEY='etf-planner-assets-v1',BASE='etf-planner-assets-sync-base:example/private-data';
const fake=()=>({version:1,allocation:{savedAt:'2026-01-01',classes:[],cash:[],groups:[{id:'g',items:[{id:'a',amount:100,target:10,buyPlan:{stages:[{id:'s',amount:30}]}}]}]},ledger:{savedAt:'2026-01-01',years:[]}});
function setup(initial,fetcher,shared){
  const storage=shared||new Map(initial?[[KEY,JSON.stringify(initial)]]:[]),listeners=new Map();
  const collection={id:'',dispatches:[]};
  storage.set('etf-planner-collection-request-token','fake-issues-token');
  storage.set('etf-planner-collection-data-repo','example/private-data');
  const context={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    TextEncoder,TextDecoder,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
    AbortController,crypto:require('node:crypto').webcrypto,setTimeout:(fn,ms)=>{if(ms===5000)queueMicrotask(fn);return 1;},clearTimeout(){},setInterval(){},document:{hidden:false,addEventListener(){}},addEventListener:(type,fn)=>listeners.set(type,fn),
    async fetch(url,options){
      if(url.endsWith('/issues/123'))return new Response(JSON.stringify({state:'open'}));
      if(url.endsWith('/issues')){const body=JSON.parse(options.body);collection.id=JSON.parse(body.body).request_id;collection.dispatches.push(body);return new Response(JSON.stringify({number:123}),{status:201});}
      const r=await (fetcher||(()=>{throw Error('unexpected network call');}))(url,options);
      if(url.endsWith('/contents/etf-planner-prices.json')&&r.ok&&collection.id){
        try{const d=await r.clone().json();return new Response(JSON.stringify({...d,collectionRequests:[{id:collection.id,failed:false}]}),{status:r.status,headers:r.headers});}catch{}
      }
      return r;
    }};
  const code=['js/repo-security.js','js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/price-collection.js','js/assets-store.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  const store=vm.runInNewContext(`${code}\nassetStore`,context);
  return {store,storage,context,collection,event:()=>listeners.get('storage')?.({key:KEY})};
}
const clone=v=>JSON.parse(JSON.stringify(v));
const milestoneDoc=()=>({...fake(),savings:{savedAt:'2026-01-01',startYear:2025,startAge:31,actual:[{ym:'2025-12',total:1000}],scenarios:[{id:'base',name:'가상 계획',salary:100}],milestoneRecord:{ym:'2031-01',age:37}}});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const contents=doc=>json({sha:'remote-sha',encoding:'base64',content:Buffer.from(JSON.stringify(doc)).toString('base64')});
function connect(storage){storage.set('etf-planner-data-repo','example/private-data');storage.set('etf-planner-github-token','fake-test-token');}

test('잘못된 자산 백업은 현재 종목·체결·복구본을 바꾸기 전에 거부한다',()=>{
  const original=fake(),h=setup(original),before=[...h.storage];
  const incoming=fake();incoming.allocation.groups[0].items[0].target='"><img src=x onerror="synthetic()">';
  assert.throws(()=>h.store.restore(incoming),/기록 형식/);assert.deepEqual(clone(h.store.doc),original);assert.deepEqual([...h.storage],before);
});

test('악성 자산 동기화 JSON은 기존 구역과 원격 데이터를 덮어쓰지 않는다',async()=>{
  const original=fake(),incoming=fake();incoming.allocation.groups[0].items='not-a-list';let writes=0;
  const h=setup(original,(url,options)=>{if(options?.method==='PUT')writes++;return url.endsWith('/repos/example/private-data')?json({private:true}):contents(incoming);});
  connect(h.storage);await h.store.sync();assert.equal(writes,0);assert.equal(h.store.status.state,'error');
  assert.deepEqual(clone(h.store.doc),original);assert.deepEqual(JSON.parse(h.storage.get(KEY)),original);
});

test('공유 자산 기록: 입력 없이 열면 기존 분할매수·목표·동기화 스냅샷을 바꾸지 않는다',()=>{
  const original=fake(),{store,storage}=setup(original);store.start();
  assert.deepEqual(JSON.parse(storage.get(KEY)),original);
  assert.equal(store.status.state,'off');
  assert.equal(storage.has(BASE),false);
});

test('종목별 시작 이동평균선은 기존 저장 키로 새로고침·백업·복원·동기화 후 유지하고 옛 체결과 다른 종목을 보존한다',async()=>{
  const original=fake(),item=original.allocation.groups[0].items[0];
  item.buyPlan={lines:{names:['25선','32선'],end:13000,budget:50},buys:{'25선:0':{shares:7,plannedShares:10,plannedActual:10,actual:7,price:10000}}};
  original.allocation.trades={'buy:a:25선:0':{qty:7,price:10000,value:7,items:[{id:'a',shares:7}]}};
  original.allocation.groups[0].items.push({id:'b',buyPlan:{lines:{names:['25주선'],budget:20}}});
  const first=setup(original);first.store.doc.allocation.groups[0].items[0].buyPlan.lines={names:['150선','20일선'],startLine:'150선',budget:50};first.store.saveSection('allocation');
  const saved=JSON.parse(first.storage.get(KEY)),second=setup(null,null,first.storage);second.store.start();
  assert.deepEqual(clone(second.store.doc),saved,'새로고침 후 전체 기록 유지');
  const plan=second.store.doc.allocation.groups[0].items[0].buyPlan;
  assert.equal(plan.lines.startLine,'150선');assert.deepEqual(clone(plan.buys),original.allocation.groups[0].items[0].buyPlan.buys);
  assert.equal(plan.lines.names.at(-1),'20일선','직접 입력한 종료선은 기존 names에 저장·복원');
  assert.deepEqual(clone(second.store.doc.allocation.trades),original.allocation.trades);
  assert.deepEqual(clone(second.store.doc.allocation.groups[0].items[1]),original.allocation.groups[0].items[1]);
  const restore=setup(fake());restore.store.restore(saved);assert.deepEqual(clone(restore.store.doc.allocation.groups),saved.allocation.groups);
  const remote=setup(null,url=>url.endsWith('/repos/example/private-data')?json({private:true}):contents(saved));connect(remote.storage);await remote.store.sync();
  assert.equal(remote.store.status.state,'done');
  assert.deepEqual(clone(remote.store.doc.allocation),saved.allocation);
});

test('저축 최단 기록: 조회는 생성·초기화하지 않고 더 빠른 기록의 명시적 저장만 허용한다',()=>{
  const original=milestoneDoc(),first=setup(original);first.store.start();
  assert.deepEqual(JSON.parse(first.storage.get(KEY)),original);
  for(const record of [{ym:'2032-01',age:38},{ym:'2031-01',age:99},{ym:'2031-13',age:37},null])assert.equal(first.store.saveSavingsMilestone(record),false);
  assert.deepEqual(JSON.parse(first.storage.get(KEY)),original);
  assert.equal(first.store.saveSavingsMilestone({ym:'2030-12',age:36,total:500000000,actual:false}),true);
  const saved=JSON.parse(first.storage.get(KEY));assert.deepEqual(saved.savings.milestoneRecord,{ym:'2030-12',age:36});
  assert.deepEqual(saved.savings.actual,original.savings.actual);assert.deepEqual(saved.savings.scenarios,original.savings.scenarios);
  assert.deepEqual(saved.allocation,original.allocation);assert.deepEqual(saved.ledger,original.ledger);
  const reloaded=setup(null,null,first.storage);reloaded.store.start();assert.deepEqual(clone(reloaded.store.doc.savings.milestoneRecord),saved.savings.milestoneRecord);
  const empty=milestoneDoc();delete empty.savings.milestoneRecord;const fresh=setup(empty);fresh.store.start();
  assert.equal(Object.hasOwn(fresh.store.doc.savings,'milestoneRecord'),false,'불러오기에서 개인 기준 기록을 기본값으로 만들지 않는다');
  assert.equal(fresh.store.saveSavingsMilestone({ym:'2032-04'}),true);assert.deepEqual(clone(fresh.store.doc.savings.milestoneRecord),{ym:'2032-04'});
});

test('저축 최단 기록: 다른 탭의 빠른 기록과 최신 입력을 유지하고 옛 백업 복원으로 기록이 늦어지지 않는다',()=>{
  const original=milestoneDoc(),first=setup(original),second=setup(null,null,first.storage);first.store.start();second.store.start();
  assert.equal(first.store.saveSavingsMilestone({ym:'2030-12',age:36}),true);
  second.store.doc.savings.scenarios[0].salary=200;second.store.saveSection('savings');first.event();
  assert.deepEqual(clone(first.store.doc.savings.milestoneRecord),{ym:'2030-12',age:36});assert.equal(first.store.doc.savings.scenarios[0].salary,200);
  assert.equal(second.store.saveSavingsMilestone({ym:'2031-01',age:37}),false);
  assert.equal(first.store.saveSavingsMilestone({ym:'2030-11',age:36}),true);
  assert.equal(second.store.saveSavingsMilestone({ym:'2030-10',age:36}),true,'이벤트를 아직 못 받은 탭도 최신 저장 데이터를 합친다');
  assert.equal(second.store.doc.savings.scenarios[0].salary,200);assert.deepEqual(JSON.parse(second.storage.get(KEY)).savings.milestoneRecord,{ym:'2030-10',age:36});
  assert.equal(second.store.restore(original),true);assert.deepEqual(clone(second.store.doc.savings.milestoneRecord),{ym:'2030-10',age:36});
  const earlier=clone(original);earlier.savings.milestoneRecord={ym:'2030-09',age:36};second.store.restore(earlier);
  assert.deepEqual(clone(second.store.doc.savings.milestoneRecord),earlier.savings.milestoneRecord);
});

test('저축 최단 기록: 브라우저 저장 실패 시 저장 성공으로 표시하거나 기존 기록을 바꾸지 않는다',()=>{
  const original=milestoneDoc(),{store,storage,context}=setup(original),before=storage.get(KEY);
  context.localStorage.setItem=()=>{throw Error('quota');};
  assert.equal(store.saveSavingsMilestone({ym:'2030-12',age:36}),false);
  assert.deepEqual(clone(store.doc),original);assert.equal(storage.get(KEY),before);assert.equal(store.status.state,'error');assert.match(store.status.message,/최단 기록.*저장하지 못했습니다/);
});

test('저축 최단 기록: 최신 가정과 더 빠른 기록을 비공개 저장소에 함께 동기화하고 재실행 후 보존한다',async()=>{
  const original=milestoneDoc(),remote=clone(original);remote.savings.savedAt='2099-01-01';remote.savings.scenarios[0].salary=300;
  let uploaded;const {store,storage}=setup(original,async(url,options)=>{
    if(url.endsWith('/repos/example/private-data'))return json({private:true});
    if(url.endsWith('/contents/etf-planner-prices.json'))return new Response(null,{status:404});
    if(options.method==='PUT'){uploaded=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString());return json({content:{sha:'new'}});}
    return contents(remote);
  });
  storage.set(BASE,JSON.stringify(original));connect(storage);
  assert.equal(store.saveSavingsMilestone({ym:'2030-12',age:36}),true);await store.sync();
  assert.equal(store.status.state,'done');assert.deepEqual(uploaded.savings.milestoneRecord,{ym:'2030-12',age:36});assert.equal(uploaded.savings.scenarios[0].salary,300);
  assert.deepEqual(uploaded.savings.actual,original.savings.actual);assert.deepEqual(uploaded.allocation,original.allocation);
  const reloaded=setup(uploaded);reloaded.store.start();assert.deepEqual(clone(reloaded.store.doc.savings.milestoneRecord),uploaded.savings.milestoneRecord);
});

test('무이자 조건은 따로 저장·동기화하며 저축 기록과 다른 페이지의 변경을 보존한다',async()=>{
  const original={...fake(),savings:{savedAt:'2026-01-01',actual:[],scenarios:[{id:'s',name:'기존 계획'}]}},first=setup(original),second=setup(null,null,first.storage);
  first.store.start();second.store.start();assert.equal(first.store.doc.installments,undefined);
  first.store.doc.installments={price:3600000,returnRate:3,netAssets:10000000,startYm:'2026-12',methods:{once:{discountRate:10,fixedDiscount:20000,fee:1000},m12:{months:18,rewardCap:5000},m36:{months:48,rewardsEnabled:false,discountEnabled:true,discountRate:1,discountCap:10000}}};first.store.saveSection('installments');second.event();
  assert.equal(second.store.doc.installments.price,3600000);
  assert.equal(second.store.doc.installments.methods.m12.months,18);assert.equal(second.store.doc.installments.methods.m36.months,48);
  assert.equal(second.store.doc.installments.startYm,'2026-12');
  assert.equal(second.store.doc.installments.netAssets,10000000);assert.equal(second.store.doc.installments.methods.m36.discountEnabled,true);
  assert.deepEqual(clone(first.store.doc.savings),original.savings);
  second.store.doc.allocation.groups[0].items[0].target=20;second.store.saveSection('allocation');first.event();
  assert.equal(first.store.doc.installments.methods.m36.rewardsEnabled,false);assert.equal(first.store.doc.allocation.groups[0].items[0].target,20);
  assert.equal(first.store.recovery().length,0);
  let uploaded;
  const synced=setup(clone(first.store.doc),async(url,options)=>{
    if(url.endsWith('/repos/example/private-data'))return json({private:true});
    if(url.endsWith('/contents/etf-planner-prices.json'))return new Response(null,{status:404});
    if(options.method==='PUT'){uploaded=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString());return json({content:{sha:'new'}});}
    return contents(original);
  });
  connect(synced.storage);await synced.store.sync();
  assert.equal(synced.store.status.state,'done');assert.equal(uploaded.installments.price,3600000);assert.deepEqual(uploaded.savings,original.savings);
  assert.deepEqual(uploaded.installments,clone(first.store.doc.installments));
  const reloaded=setup(uploaded);reloaded.store.start();assert.deepEqual(clone(reloaded.store.doc.installments),uploaded.installments);
  reloaded.store.doc.installments.methods.m12.months=6;reloaded.store.saveSection('installments');
  assert.equal(reloaded.store.restore(uploaded),true);
  assert.deepEqual(clone(reloaded.store.doc.installments.methods),uploaded.installments.methods);assert.equal(reloaded.store.doc.installments.startYm,'2026-12');
  assert.equal(reloaded.store.doc.installments.netAssets,10000000);
  for(const section of ['savings','allocation']){
    const {savedAt,...restored}=clone(reloaded.store.doc[section]),{savedAt:backupAt,...backup}=uploaded[section];
    assert.deepEqual(restored,backup,'복원 시 저장 시각만 갱신하고 다른 구역의 내용은 보존');
  }
});

test('저축 시나리오 삭제를 동기화하면서 실제 기록·별도 계산 조건·다른 구역의 입력을 보존한다',async()=>{
  const original={...fake(),savings:{savedAt:'2026-01-01',actual:[{ym:'2026-01',total:1000}],scenarios:[{id:'easy',name:'이지'},{id:'hard',name:'하드'},{id:'deleted',name:'삭제 대상'}]},installments:{savedAt:'2026-01-01',price:1000,returnRate:3}};
  const remote=clone(original);remote.savings.scenarios.pop();remote.savings.savedAt='2099-01-01';let uploaded;
  const {store,storage}=setup(original,async(url,options)=>{
    if(url.endsWith('/repos/example/private-data'))return json({private:true});
    if(url.endsWith('/contents/etf-planner-prices.json'))return new Response(null,{status:404});
    if(options.method==='PUT'){uploaded=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString());return json({content:{sha:'new'}});}
    return contents(remote);
  });
  storage.set(BASE,JSON.stringify(original));connect(storage);
  store.doc.allocation.groups[0].items[0].target=20;store.saveSection('allocation');await store.sync();
  assert.equal(store.status.state,'done');assert.deepEqual(clone(store.doc.savings),remote.savings);
  assert.deepEqual(uploaded.savings,remote.savings);assert.deepEqual(uploaded.installments,original.installments);
  assert.equal(uploaded.allocation.groups[0].items[0].target,20);assert.equal(store.recovery().length,0);
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

test('즉시 읽은 공유 시세는 분할매수 평가에 반영하고 자산 기록·체결 내역은 보존한다',()=>{
  const original=fake(),{store,storage}=setup(original);connect(storage);
  const cfg=store.config(),events=[];store.subscribe(type=>events.push(type));
  const prices={updatedAt:'2026-01-02T07:00:00Z',stocks:{AAA:{kind:'해외',close:123,asOf:'2026-01-02',daily:[[1,2,3]]}},fx:{USDKRW:{close:1400,asOf:'2026-01-02'}}};
  assert.equal(store.acceptPrices(cfg,prices,'"p1"'),true);
  assert.equal(store.prices.stocks.AAA.close,123);assert.equal(store.prices.fx.close,1400);
  assert.equal(store.prices.stocks.AAA.daily,undefined);
  assert.ok(events.includes('change'));assert.deepEqual(clone(store.doc),original);
  assert.deepEqual(JSON.parse(storage.get(KEY)),original);assert.equal(storage.has(BASE),false);
  assert.equal(store.acceptPrices(cfg,prices,'"p2"'),false,'ETag만 바뀌면 평가 화면을 다시 그리지 않는다');
  assert.equal(store.prices.etag,'"p2"');
  assert.equal(store.acceptPrices({...cfg,token:'old-fake-token'},{...prices,stocks:{}},'"old"'),false);
  assert.equal(store.prices.stocks.AAA.close,123,'이전 연결 응답은 무시');
  assert.equal(store.acceptPrices(cfg,null),true);assert.equal(store.prices,null);
});

test('배당용 125개월선을 시세 캐시에 남기고 평균선만 바뀌어도 갱신을 알린다',()=>{
  const original=fake(),{store,storage}=setup(original);connect(storage);const cfg=store.config();
  const quote={updatedAt:'2026-01-02',stocks:{},fx:{USDKRW:{close:1800,asOf:'2026-01-02',ma:{'125개월선':1320,'125일선':1700},maAsOf:'2026-01-02'}}};
  store.acceptPrices(cfg,quote,'p1');
  assert.equal(store.prices.fx.ma['125개월선'],1320);assert.equal(store.prices.fx.close,1800);
  assert.equal(store.prices.fx.ma['125일선'],undefined);
  assert.equal(store.acceptPrices(cfg,{...quote,fx:{USDKRW:{...quote.fx.USDKRW,ma:{'125개월선':1340},maStale:true}}},'p2'),true);
  assert.equal(store.prices.fx.ma['125개월선'],1340);assert.equal(store.prices.fx.maAsOf,'2026-01-02');assert.equal(store.prices.fx.maStale,true);
  assert.deepEqual(JSON.parse(storage.get(KEY)),original,'평균선 수집은 개인 손익 기록을 바꾸지 않는다');
});

test('평균선을 버리던 옛 캐시는 ETag 없이 다시 받고 새 캐시는 ETag를 유지한다',async()=>{
  const original=fake(),storage=new Map([[KEY,JSON.stringify(original)],['etf-planner-assets-prices',JSON.stringify({repo:'example/private-data',etag:'same',stocks:{},fx:{close:1800}})]]);
  const asks=[],quote={updatedAt:'2026-01-02',stocks:{},fx:{USDKRW:{close:1800,asOf:'2026-01-02',ma:{'125개월선':1320}}}};
  const {store}=setup(null,async(url,options)=>{
    if(url.endsWith('/repos/example/private-data'))return json({private:true});
    if(url.endsWith('/contents/etf-planner-prices.json')){asks.push(options.headers);return asks.length===1?new Response(JSON.stringify(quote),{headers:{ETag:'same'}}):new Response(null,{status:304});}
    if(url.endsWith('/contents/etf-planner-assets.json'))return contents(original);
    throw Error('unexpected request');
  },storage);connect(storage);
  await store.sync();await store.sync();
  assert.equal(asks[0]['If-None-Match'],undefined);assert.equal(asks[1]['If-None-Match'],'same');
  assert.equal(store.prices.fx.ma['125개월선'],1320);assert.deepEqual(clone(store.doc),original);
});

const quotes=close=>({updatedAt:'2026-01-02T07:00:00Z',stocks:{AAA:{kind:'해외',close,asOf:'2026-01-02'}},fx:{USDKRW:{close:1400,asOf:'2026-01-02'}}});
const priceReply=close=>new Response(JSON.stringify(quotes(close)),{headers:{ETag:'"same-etag"'}});
test('실제 ETF 시세가 없으면 파일을 읽어도 완료로 표시하지 않고 중복 계좌는 한 종목으로 안내한다',async()=>{
  const original=fake();original.allocation.groups[0].items=[
    {id:'a',ticker:'AAA',tradeTicker:'900002',shares:12,amount:0},
    {id:'b',ticker:'AAA',tradeTicker:'900002',shares:7,amount:0},
    {id:'zero',ticker:'AAA',tradeTicker:'900003',shares:0,amount:100},
  ];
  let doc=quotes(150);
  const {store,storage}=setup(original,async()=>json(doc));connect(storage);
  await store.refreshPrices();
  assert.match(store.priceMessage,/시세 없음 1종목.*900002/);assert.doesNotMatch(store.priceMessage,/불러오기 완료|900003/);
  await store.refreshPrices();assert.match(store.priceMessage,/시세 없음 1종목/,'같은 파일을 다시 읽어도 누락 상태를 숨기지 않는다');
  doc={...doc,stocks:{...doc.stocks,'900002':{kind:'국내',close:8000,asOf:'2026-01-02'}}};
  await store.refreshPrices();assert.match(store.priceMessage,/시세 불러오기 완료/);
  assert.deepEqual(JSON.parse(storage.get(KEY)),original,'시세 확인으로 주수·금액·체결 기록을 바꾸지 않는다');
});

test('자동 시세 조회 실패도 완료로 표시하지 않으며 유효한 직접 입력 가격은 평가 가능으로 처리한다',async()=>{
  const original=fake();original.allocation.groups[0].items=[{id:'a',ticker:'AAA',tradeTicker:'900002',shares:12,amount:0}];
  const doc={...quotes(150),stocks:{...quotes(150).stocks,'900002':{error:'fake quote failure'}}};
  const {store,storage}=setup(original,async()=>json(doc));connect(storage);
  await store.refreshPrices();assert.match(store.priceMessage,/시세 없음 1종목.*900002/);assert.doesNotMatch(store.priceMessage,/불러오기 완료/);
  store.doc.allocation.groups[0].items[0].tradePrice=8000;
  store.doc.allocation.groups[0].items[0].tradePriceAt='2026-01-02T00:00:00Z';
  await store.refreshPrices();assert.match(store.priceMessage,/시세 불러오기 완료/);
});

test('자산 시세 즉시 불러오기는 수집 결과를 반영하고 보유량·금액·체결 기록을 보존한다',async()=>{
  const original=fake(),asks=[],events=[],{store,storage,collection}=setup(original,async(url,options)=>{asks.push({url,options});return priceReply(150);});
  connect(storage);store.acceptPrices(store.config(),quotes(100),'"same-etag"');store.subscribe(type=>events.push(type));
  await store.refreshPrices();
  assert.equal(asks.length,1);assert.ok(asks[0].url.endsWith('/contents/etf-planner-prices.json'));
  assert.equal(collection.dispatches.length,1);assert.equal(collection.dispatches[0].title,'ETF price collection');
  assert.equal(asks[0].options.headers['If-None-Match'],undefined);assert.equal(asks[0].options.method,undefined);
  assert.equal(store.prices.stocks.AAA.close,150);assert.equal(store.prices.fx.close,1400);
  assert.equal(JSON.parse(storage.get('etf-planner-assets-prices')).stocks.AAA.close,150);
  assert.deepEqual(clone(store.doc),original);assert.deepEqual(JSON.parse(storage.get(KEY)),original);assert.equal(storage.has(BASE),false);
  assert.ok(events.includes('change'));assert.match(store.priceMessage,/시세 불러오기 완료.*최근 수집/);assert.equal(store.priceRefreshing,false);
  events.length=0;await store.refreshPrices();assert.ok(!events.includes('change'),'같은 시세면 평가 화면을 다시 그리지 않는다');
});

test('새 자산 종목의 저장 대기를 먼저 처리하고 동기화가 실패하면 수집을 요청하지 않는다',async()=>{
  const original=fake();let remote=clone(original);
  const h=setup(original,async(url,options)=>{
    if(url.endsWith('/repos/example/private-data'))return json({private:true});
    if(url.endsWith('/contents/etf-planner-prices.json'))return priceReply(150);
    if(options.method==='PUT'){remote=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString());return json({content:{sha:'new-sha'}});}
    return contents(remote);
  });
  connect(h.storage);h.store.doc.allocation.groups[0].items[0].ticker='AAA';h.store.saveSection('allocation');
  const fetch=h.context.fetch;h.context.fetch=async(url,options)=>{
    if(url.endsWith('/issues'))assert.equal(remote.allocation.groups[0].items[0].ticker,'AAA');
    return fetch(url,options);
  };
  await h.store.refreshPrices();assert.equal(h.collection.dispatches.length,1);assert.match(h.store.priceMessage,/시세 불러오기 완료/);
  const failed=setup(original,async()=>json({message:'failure'},500));connect(failed.storage);
  failed.store.saveSection('allocation');await failed.store.refreshPrices();assert.equal(failed.collection.dispatches.length,0);
  assert.match(failed.store.priceMessage,/먼저 자산 기록 동기화/);assert.equal(failed.store.priceRefreshing,false);
});

test('자산 수동 시세 조회 실패는 마지막 시세를 유지하고 다시 시도할 수 있다',async()=>{
  let reply=()=>new Response('',{status:500});
  const {store,storage}=setup(fake(),async()=>reply());connect(storage);store.acceptPrices(store.config(),quotes(100),'"cached"');
  const cached=storage.get('etf-planner-assets-prices'),original=storage.get(KEY);
  for(const failed of [()=>new Response('',{status:500}),()=>new Response('broken JSON'),()=>json({stocks:[]}),()=>{throw new TypeError('Failed to fetch');}]){
    reply=failed;await store.refreshPrices();assert.equal(storage.get('etf-planner-assets-prices'),cached);assert.equal(store.prices.stocks.AAA.close,100);
    assert.match(store.priceMessage,/시세 확인 실패/);assert.equal(store.priceRefreshing,false);assert.equal(storage.get(KEY),original);
  }
  reply=()=>priceReply(150);await store.refreshPrices();assert.equal(store.prices.stocks.AAA.close,150);assert.match(store.priceMessage,/시세 불러오기 완료/);
});

test('자산 시세 수집은 연결 전 요청하지 않고 수집 결과가 없으면 마지막 시세를 유지한다',async()=>{
  let requests=0;const {store,storage}=setup(fake(),async()=>{requests++;return new Response('',{status:404});});
  await store.refreshPrices();assert.equal(requests,0);assert.match(store.priceMessage,/연결해 주세요/);
  connect(storage);store.acceptPrices(store.config(),quotes(100));const cached=storage.get('etf-planner-assets-prices');await store.refreshPrices();
  assert.equal(requests,60);assert.equal(store.prices.stocks.AAA.close,100);assert.equal(storage.get('etf-planner-assets-prices'),cached);
  assert.match(store.priceMessage,/수집 완료를 아직 확인하지 못했습니다/);assert.doesNotMatch(store.priceMessage,/불러오기 완료/);assert.equal(store.priceRefreshing,false);
});

test('자산 시세 수동 조회 중 중복 클릭과 자동 동기화는 요청을 겹치지 않는다',async()=>{
  let release,requests=0;const {store,storage}=setup(fake(),async()=>{requests++;await new Promise(resolve=>release=resolve);return priceReply(150);});connect(storage);
  const work=store.refreshPrices();assert.equal(store.priceRefreshing,true);assert.match(store.priceMessage,/수집/);
  for(let i=0;i<20&&!release;i++)await Promise.resolve();
  await store.refreshPrices();await store.sync();assert.equal(requests,1);assert.equal(store.status.again,true);
  release();await work;assert.equal(store.priceRefreshing,false);assert.equal(store.status.state,'pending');
  let finish;const syncing=setup(fake(),async()=>{await new Promise(resolve=>finish=resolve);return json({private:false});});connect(syncing.storage);
  const syncWork=syncing.store.sync();assert.equal(syncing.store.status.busy,true);
  await syncing.store.refreshPrices();assert.equal(syncing.store.priceRefreshing,false,'기록 동기화 중에는 시세 단독 조회를 시작하지 않는다');finish();await syncWork;
});

test('자산 수동 시세 조회 중 연결을 바꾸면 이전 시세·404·오류 응답은 적용하지 않는다',async()=>{
  for(const reply of [()=>priceReply(150),()=>new Response('',{status:404}),()=>new Response('',{status:500})]){
    let release;const {store,storage}=setup(fake(),async()=>{await new Promise(resolve=>release=resolve);return reply();});connect(storage);
    store.acceptPrices(store.config(),quotes(100),'"cached"');const cached=storage.get('etf-planner-assets-prices'),work=store.refreshPrices();
    for(let i=0;i<20&&!release;i++)await Promise.resolve();
    storage.set('etf-planner-github-token','different-fake-token');release();await work;
    assert.equal(storage.get('etf-planner-assets-prices'),cached);assert.equal(store.prices.stocks.AAA.close,100);
    assert.match(store.priceMessage,/연결 설정이 바뀌었습니다/);assert.equal(store.priceRefreshing,false);
  }
});
