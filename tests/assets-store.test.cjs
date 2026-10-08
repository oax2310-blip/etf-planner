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
  const code=['js/ma-ladder.js','js/assets-calc.js','js/assets-store.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
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

test('자산 시세 즉시 불러오기는 ETag 없이 시세 파일만 읽고 보유량·금액·체결 기록을 보존한다',async()=>{
  const original=fake(),asks=[],events=[],{store,storage}=setup(original,async(url,options)=>{asks.push({url,options});return priceReply(150);});
  connect(storage);store.acceptPrices(store.config(),quotes(100),'"same-etag"');store.subscribe(type=>events.push(type));
  await store.refreshPrices();
  assert.equal(asks.length,1);assert.ok(asks[0].url.endsWith('/contents/etf-planner-prices.json'));
  assert.equal(asks[0].options.headers['If-None-Match'],undefined);assert.equal(asks[0].options.method,undefined);
  assert.equal(store.prices.stocks.AAA.close,150);assert.equal(store.prices.fx.close,1400);
  assert.equal(JSON.parse(storage.get('etf-planner-assets-prices')).stocks.AAA.close,150);
  assert.deepEqual(clone(store.doc),original);assert.deepEqual(JSON.parse(storage.get(KEY)),original);assert.equal(storage.has(BASE),false);
  assert.ok(events.includes('change'));assert.match(store.priceMessage,/시세 불러오기 완료.*최근 수집/);assert.equal(store.priceRefreshing,false);
  events.length=0;await store.refreshPrices();assert.ok(!events.includes('change'),'같은 시세면 평가 화면을 다시 그리지 않는다');
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

test('자산 시세 조회는 연결 전 요청하지 않고 시세 파일이 없으면 완료로 표시하지 않는다',async()=>{
  let requests=0;const {store,storage}=setup(fake(),async()=>{requests++;return new Response('',{status:404});});
  await store.refreshPrices();assert.equal(requests,0);assert.match(store.priceMessage,/연결해 주세요/);
  connect(storage);store.acceptPrices(store.config(),quotes(100));await store.refreshPrices();
  assert.equal(requests,1);assert.equal(store.prices,null);assert.equal(storage.has('etf-planner-assets-prices'),false);
  assert.match(store.priceMessage,/시세 파일이 없어/);assert.doesNotMatch(store.priceMessage,/완료/);assert.equal(store.priceRefreshing,false);
});

test('자산 시세 수동 조회 중 중복 클릭과 자동 동기화는 요청을 겹치지 않는다',async()=>{
  let release,requests=0;const {store,storage}=setup(fake(),async()=>{requests++;await new Promise(resolve=>release=resolve);return priceReply(150);});connect(storage);
  const work=store.refreshPrices();assert.equal(store.priceRefreshing,true);assert.match(store.priceMessage,/불러오는 중/);
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
    storage.set('etf-planner-github-token','different-fake-token');release();await work;
    assert.equal(storage.get('etf-planner-assets-prices'),cached);assert.equal(store.prices.stocks.AAA.close,100);
    assert.match(store.priceMessage,/연결 설정이 바뀌었습니다/);assert.equal(store.priceRefreshing,false);
  }
});
