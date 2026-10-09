const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 가짜 시세·수량만 사용한다. 실제 분할매도 파일의 실시간 입력과 저장 핸들러도 실행한다.
function load(){
  const nodes=new Map(),node=name=>{
    if(!nodes.has(name))nodes.set(name,{value:'',dataset:{},readOnly:false,textContent:'',events:{},validityMessage:'',
      addEventListener(kind,handler){this.events[kind]=handler;},setCustomValidity(message){this.validityMessage=message;},
      querySelectorAll:()=>[],querySelector:()=>node('close'),classList:{toggle(){}},close(){},showModal(){}});
    return nodes.get(name);
  };
  const fields=Object.fromEntries(Object.entries({ticker:'비트코인',title:'테스트 계획',cardName:'',currency:'USD',shares:'0.01234567',
    fx:'1000',startUnit:'',startN:'60',startLabel:'직접',startPrice:'60000',endN:'25',endUnit:'개월선',endPrice:'50000',stages:'3',salePct:'100',valueKrw:''})
    .map(([key,value])=>[key,Object.assign(node('field:'+key),{value})]));
  const form=node('planForm');form.elements=fields;form.reportValidity=()=>Object.values(fields).every(f=>!f.validityMessage&&(!f.required||f.disabled||f.readOnly||String(f.value??'')!==''));
  form.reset=()=>{for(const [key,value] of Object.entries({ticker:'',title:'',cardName:'',currency:'USD',shares:'',fx:'1354.91',startUnit:'',startN:'60',startLabel:'60일선',startPrice:'',endN:'25',endUnit:'개월선',endPrice:'',stages:'30',salePct:'100',valueKrw:''}))fields[key].value=value;};
  const ctx=vm.createContext({$:node,$$:()=>[],addEventListener(){},state:{plans:[],futures:{positions:[]}},save(){},render(){},
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),
    priceData:{updatedAt:'2026-10-02T12:00:00Z',stocks:{'BTC-USD':{kind:'코인',asOf:'2026-10-02',close:60000,ma:{'25개월선':50000}},
      BTC:{kind:'해외',asOf:'2026-10-02',close:30,ma:{}}}},
    id:()=> 'test-plan',priceText:v=>String(v),fxText:v=>String(v),esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),FormData:class{constructor(f){this.fields=f.elements;}get(key){return this.fields[key]?.disabled?null:this.fields[key]?.value;}}});
  for(const file of ['ma-ladder.js','prices.js','assets-calc.js','plans.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx);
  const api=vm.runInContext('({sharesAt,sharesLeft,hasPlanShares,planQuantity,planQuote,planLive,planSalePct,saleShares,stagePrice,stageWorth,planTrade,planLink,planStageProgress,recordPlanFill,planQuantityProgress,planSourceQuantityProgress,planSaleExecution,planSaleAccountView,recordPlanQuantity,planSaleRow,planLinkedSaleSchedule,movePlanSalePriority,recordPlanGroupFill,planAllocOptions,fillPlanAllocTicker,openPlanDialog,applyTrade,revertTrade,rescaleTrade})',ctx);
  return {ctx,api,fields,node,submit:()=>form.events.submit({target:form,preventDefault(){}})};
}

test('자동 기준가는 시세 없이 저장·수정하고 두 기준가를 채운 뒤에만 체결할 수 있다',()=>{
  const {ctx,api,fields,node,submit}=load();ctx.priceData=null;
  fields.ticker.value='AAA';fields.shares.value='10';fields.startUnit.value='일선';fields.startPrice.value='';fields.endPrice.value='';
  api.planLive();assert.equal(fields.startPrice.required,false);assert.equal(fields.endPrice.required,false);
  assert.equal(node('startNote').textContent,'다음 시세 수집 때 자동');assert.equal(node('endNote').textContent,'다음 시세 수집 때 자동');
  submit();assert.equal(ctx.state.plans.length,1);
  const p=ctx.state.plans[0];assert.equal(p.startAuto,true);assert.equal('startPrice' in p,false);assert.equal('endPrice' in p,false);
  assert.equal(api.stagePrice(p,0),null);assert.equal(api.stagePrice(p,2),null);
  assert.match(api.planSaleRow(p,0,''),/data-stage="0"[^>]* disabled/);
  assert.match(api.planSaleRow(p,0,''),/data-sale-filled="0"[^>]* disabled/);
  api.recordPlanQuantity(p,0,1,()=>{});assert.equal(p.fills,undefined);assert.equal(p.checked[0],false);
  api.openPlanDialog(p);assert.equal(fields.startPrice.value,'');assert.equal(fields.endPrice.value,'');
  const prices={updatedAt:'2026-10-09T01:00:00Z',stocks:{AAA:{kind:'해외',asOf:'2026-10-09',close:105,ma:{'60일선':110}}}};
  assert.equal(ctx.fillPrices({plans:[p]},prices),true);assert.equal(p.startPrice,110);assert.equal(api.stagePrice(p,1),null);
  api.recordPlanQuantity(p,0,1,()=>{});assert.equal(p.fills,undefined);
  prices.stocks.AAA.ma['25개월선']=90;
  assert.equal(ctx.fillPrices({plans:[p]},prices),true);assert.equal(p.endPrice,90);assert.equal(api.stagePrice(p,1),100);
  api.recordPlanQuantity(p,0,1,()=>{});assert.equal(p.fills[0].qty,1);assert.equal(p.fills[0].price,110);
});

test('시작 기준선이 직접이면 시작 기준가만 필수이며 자동 모드와 전환해도 검증을 갱신한다',()=>{
  const {ctx,api,fields,submit}=load();ctx.priceData=null;
  fields.ticker.value='AAA';fields.shares.value='10';fields.startPrice.value='';fields.endPrice.value='';
  submit();assert.equal(ctx.state.plans.length,0);assert.equal(fields.startPrice.required,true);assert.equal(fields.endPrice.required,false);
  fields.startUnit.value='주선';api.planLive();assert.equal(fields.startPrice.required,false);
  fields.startUnit.value='';api.planLive();assert.equal(fields.startPrice.required,true);
  fields.startPrice.value='100';submit();const p=ctx.state.plans[0];assert.equal(p.startPrice,100);assert.equal('endPrice' in p,false);assert.equal('startAuto' in p,false);
});

test('이미 있는 자동 시세는 빈 칸을 바로 채우고 직접 고친 기준가는 같은 시세에서 유지한다',()=>{
  const {ctx,api,fields,submit}=load();
  ctx.priceData={updatedAt:'2026-10-09T01:00:00Z',stocks:{AAA:{kind:'해외',asOf:'2026-10-09',close:105,ma:{'60일선':110,'25개월선':90}}}};
  fields.ticker.value='AAA';fields.shares.value='10';fields.startUnit.value='일선';fields.startPrice.value='';fields.endPrice.value='';
  api.planLive();assert.equal(fields.startPrice.value,110);assert.equal(fields.endPrice.value,90);
  fields.startPrice.value='107';fields.endPrice.value='87';submit();const p=ctx.state.plans[0];
  assert.equal(p.startPrice,107);assert.equal(p.endPrice,87);assert.equal(ctx.fillPrices({plans:[p]},ctx.priceData),false);
  api.openPlanDialog(p);fields.startPrice.value='';delete ctx.priceData.stocks.AAA.ma['60일선'];submit();
  assert.equal('startPrice' in p,false);assert.equal('startPrice' in p.auto,false);
  ctx.priceData.stocks.AAA.ma['60일선']=110;assert.equal(ctx.fillPrices({plans:[p]},ctx.priceData),true);assert.equal(p.startPrice,110);
});

test('평가액만 있는 계획의 빈 자동 기준가는 회차 금액을 0으로 계산하지 않는다',()=>{
  const {ctx,api,fields,submit}=load();ctx.priceData=null;
  fields.ticker.value='AAA';fields.shares.value='';fields.valueKrw.value='100';fields.startUnit.value='일선';fields.startPrice.value='';fields.endPrice.value='';
  submit();const p=ctx.state.plans[0];assert.equal(api.stageWorth(p,null),null);assert.equal(api.planQuantityProgress(p,0).target,null);
  api.recordPlanQuantity(p,0,1,()=>{});assert.equal(p.fills,undefined);
});

function linkedPlanDialog(){
  const r=load(),allocation={classes:[],cash:[],cashFx:1200,groups:[
    {id:'a',name:'가상 계좌 A',items:[{id:'domestic-a',name:'가상 국내 ETF',ticker:'A123456',shares:10},
      {id:'tracking-a',name:'가상 추종 ETF',ticker:'aaa',tradeTicker:'111111',shares:8},
      {id:'coin',name:'가상 비트코인',ticker:'비트코인',shares:0.12345678},
      {id:'no-code',name:'코드 없음',amount:10},{id:'invalid-code',name:'잘못된 코드',ticker:'??'}]},
    {id:'b',name:'가상 계좌 B',items:[{id:'domestic-b',name:'가상 국내 ETF',ticker:'123456',shares:5},
      {id:'tracking-b',name:'가상 추종 ETF',ticker:'AAA',tradeTicker:'222222',amount:20},
      {id:'direct',name:'가상 직접 보유 ETF',ticker:'AAA',shares:3}]}
  ]};
  const quote=(kind,close)=>({kind,close,asOf:'2026-10-09',ma:{'25개월선':close*.8}});
  Object.assign(r.ctx.priceData.stocks,{'123456':quote('국내',10000),AAA:quote('해외',100)});
  r.ctx.priceData.fx={USDKRW:quote('현물환율',1500)};
  r.ctx.assetStore={doc:{version:1,allocation},prices:{fx:{close:1200},stocks:{...r.ctx.priceData.stocks,'111111':quote('국내',10000),'222222':quote('국내',20000)}}};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/alloc-link.js'),'utf8'),r.ctx);
  return {...r,allocation};
}

test('분할매도 추가 창은 코드 입력 전부터 연결 종목을 보여 주고 같은 기준 코드를 한 번만 표시한다',()=>{
  const r=linkedPlanDialog(),before=JSON.stringify([r.ctx.state,r.allocation]);r.api.openPlanDialog();
  assert.equal(r.fields.ticker.value,'');assert.equal(r.node('planAllocHold').hidden,true);
  const options=r.api.planAllocOptions();assert.deepEqual(Array.from(options,o=>o.ticker),['123456','AAA','BTC-USD']);
  assert.equal(options[0].accounts.size,2);assert.equal(options[1].accounts.size,2);
  assert.equal(r.node('planAllocTicker').disabled,false);assert.match(r.node('planAllocTicker').innerHTML,/2개 계좌/);
  assert.equal(JSON.stringify([r.ctx.state,r.allocation]),before,'창을 열어도 원본 기록은 바꾸지 않는다');
});

test('연결 종목 선택은 국내 코드·통화·여러 계좌 수량·기준가를 채우며 저장 전에는 자산과 계획을 바꾸지 않는다',()=>{
  const r=linkedPlanDialog();r.api.openPlanDialog();const before=JSON.stringify([r.ctx.state,r.allocation]),assetsBefore=JSON.stringify(r.allocation);
  const picker=r.node('planAllocTicker');picker.value='123456';r.node('planForm').events.input({target:picker});
  assert.equal(picker.value,'123456','select의 input 이벤트가 뒤따르는 change 선택을 지우지 않는다');
  picker.onchange({target:picker});
  assert.equal(r.fields.ticker.value,'123456');assert.equal(r.fields.title.value,'가상 국내 ETF');
  assert.equal(r.fields.currency.value,'KRW');assert.equal(r.fields.currency.disabled,false);
  assert.equal(Number(r.fields.shares.value),15);assert.equal(Number(r.fields.valueKrw.value),15);
  assert.equal(Number(r.fields.fx.value),1500);assert.equal(Number(r.fields.endPrice.value),8000);
  assert.equal(r.fields.startPrice.value,'','직접 시작 기준가는 새로 만들지 않는다');
  assert.equal(JSON.stringify([r.ctx.state,r.allocation]),before);
  r.fields.startPrice.value='11000';r.submit();assert.equal(r.ctx.state.plans.length,1);
  const p=r.ctx.state.plans[0];assert.equal(p.ticker,'123456');assert.equal(p.currency,'KRW');assert.equal(p.holdings[0].shares,15);
  assert.equal(p.valueKrw,null);assert.equal(JSON.stringify(r.allocation),assetsBefore,'계획 저장은 자산 보유량을 바꾸지 않는다');
});

test('추종 ETF와 직접 보유를 함께 불러올 때 기준 종목과 달러 통화를 쓰고 거래 단위가 다른 주수를 합치지 않는다',()=>{
  const r=linkedPlanDialog();r.api.openPlanDialog();r.api.fillPlanAllocTicker('123456');r.api.fillPlanAllocTicker('AAA');
  assert.equal(r.fields.ticker.value,'AAA');assert.equal(r.fields.currency.value,'USD');assert.equal(r.fields.shares.value,'');
  assert.equal(r.fields.valueKrw.readOnly,false);assert.equal(Number(r.fields.valueKrw.value),64,'추종 ETF 8만원+20만원과 직접 보유 36만원');
  assert.equal(Number(r.fields.endPrice.value),80);r.fields.startPrice.value='110';r.submit();
  const p=r.ctx.state.plans[0];assert.equal(p.ticker,'AAA');assert.equal(p.holdings.length,0);assert.equal(p.valueKrw,64);assert.equal(p.valueBase,100);
});

test('연결 비트코인은 소수 수량과 USD 고정을 유지하고 다른 종목을 고르면 통화를 다시 선택할 수 있다',()=>{
  const r=linkedPlanDialog();r.api.openPlanDialog();r.api.fillPlanAllocTicker('BTC-USD');
  assert.equal(r.fields.ticker.value,'BTC-USD');assert.equal(r.fields.currency.value,'USD');assert.equal(r.fields.currency.disabled,true);
  assert.equal(Number(r.fields.shares.value),0.12345678);assert.equal(r.fields.shares.step,'0.00000001');
  r.api.fillPlanAllocTicker('123456');assert.equal(r.fields.currency.value,'KRW');assert.equal(r.fields.currency.disabled,false);assert.equal(r.fields.shares.step,'1');
});

test('연결 종목이 없으면 수동 입력을 유지하며 목록 이름은 HTML로 해석하지 않는다',()=>{
  const r=linkedPlanDialog();r.allocation.groups=[];r.api.openPlanDialog();
  assert.equal(r.node('planAllocTicker').disabled,true);assert.match(r.node('planAllocPickerHint').textContent,/자산 배분에 종목과 코드/);
  r.fields.ticker.value='MANUAL';r.api.fillPlanAllocTicker('AAA');assert.equal(r.fields.ticker.value,'MANUAL');
  r.allocation.groups=[{id:'a',items:[{id:'x',ticker:'AAA',name:'<img onerror="bad">',shares:2}]}];r.api.planLive();
  assert.match(r.node('planAllocTicker').innerHTML,/&lt;img/);assert.doesNotMatch(r.node('planAllocTicker').innerHTML,/<img/);
  assert.match(r.node('planAllocTicker').innerHTML,/직접 입력/);
});

test('매도 완료 체크와 부분 체결 기록이 있으면 연결 종목 선택으로 계획 보유량을 바꿀 수 없다',()=>{
  for(const recorded of [{checked:[true,false]},{checked:[false,false],fills:{0:{plannedQty:5,qty:2,price:10000}}}]){
    const r=linkedPlanDialog(),p={id:'locked',ticker:'123456',title:'기존 계획',currency:'KRW',holdings:[{shares:10}],startLabel:'직접',endLabel:'25개월선',startPrice:11000,endPrice:8000,stages:2,valueKrw:null,fx:1200,...recorded};
    r.ctx.state.plans=[p];r.api.openPlanDialog(p);const before=JSON.stringify([r.fields.ticker.value,r.fields.shares.value,r.fields.title.value,p,r.allocation]);
    assert.equal(r.node('planAllocTicker').disabled,true);r.api.fillPlanAllocTicker('AAA');
    assert.equal(JSON.stringify([r.fields.ticker.value,r.fields.shares.value,r.fields.title.value,p,r.allocation]),before);
  }
});

test('주식 정수 배분을 유지하고 비트코인은 최소 단위 합계가 보유 수량과 같다',()=>{
  const {api}=load();
  assert.deepEqual(Array.from({length:3},(_,i)=>api.sharesAt(10,i,3)),[4,3,3]);
  for(const [shares,stages] of [[0.01234567,3],[0.12345678,30],[2.00000001,250],[0.00000001,250],[21000000,250]]){
    const units=Array.from({length:stages},(_,i)=>Math.round(api.sharesAt(shares,i,stages,8)*1e8));
    assert.equal(units.reduce((s,n)=>s+n,0),Math.round(shares*1e8));
    assert.ok(Math.max(...units)-Math.min(...units)<=1);
    assert.ok(units.every(n=>n>=0));
  }
});

test('완료 체크의 남은 비트코인 수량을 정확히 빼고 전량 완료 시 0으로 표시한다',()=>{
  const {api}=load(),p={ticker:'BTC-USD',holdings:[{shares:0.01234567}],stages:3,checked:[false,false,false]};
  assert.equal(api.sharesLeft(p),0.01234567);
  p.checked[1]=true;assert.equal(api.sharesLeft(p),0.00823045);
  p.checked.fill(true);assert.equal(api.sharesLeft(p),0);
  assert.equal(api.planQuantity(0.00000001,p),'0.00000001 BTC');
  assert.equal(api.planQuantity(0.01234567,p),'0.01234567 BTC');
  assert.equal(api.planQuantity(12,{ticker:'BTC'}),'12주');
});

test('비트코인 소수점 입력은 평가액을 계산하고 원래 정밀도로 BTC-USD에 저장한다',()=>{
  const {api,ctx,fields,node,submit}=load();fields.currency.value='KRW';fields.endPrice.value='1';api.planLive();
  assert.equal(fields.currency.value,'USD');assert.equal(fields.currency.disabled,true);
  assert.equal(fields.endPrice.value,50000,'USD로 전환한 뒤 달러 기준가를 채운다');
  assert.equal(fields.shares.step,'0.00000001');assert.equal(fields.shares.inputMode,'decimal');
  assert.equal(node('sharesLabel').textContent,'보유 수량 (BTC)');assert.equal(fields.valueKrw.readOnly,true);
  assert.equal(Number(fields.valueKrw.value),74.1);
  submit();assert.equal(ctx.state.plans.length,1);
  const p=ctx.state.plans[0];assert.equal(p.ticker,'BTC-USD');assert.equal(p.currency,'USD');assert.equal(p.holdings[0].shares,0.01234567);assert.equal(p.valueKrw,null);
  assert.equal(p.valueBase,undefined);
  assert.equal(api.planQuote('비트코인','USD').kind,'코인');assert.equal(api.planQuote('BTC-USD','KRW'),null);
  assert.equal(api.planQuote('BTC','USD').kind,'해외');
});

test('정밀도 초과·잘못된 수량은 저장을 막고 수정하면 정상적으로 저장한다',()=>{
  const {ctx,fields,api,submit}=load();
  for(const shares of [0.000000001,0.012345678,Infinity,-1,NaN])assert.equal(api.hasPlanShares('BTC-USD',shares),false);
  fields.shares.value='0.012345678';submit();assert.equal(ctx.state.plans.length,0);assert.match(fields.shares.validityMessage,/8자리/);
  fields.ticker.value='AAA';fields.shares.value='1.5';submit();assert.equal(ctx.state.plans.length,0);assert.match(fields.shares.validityMessage,/정수/);
  assert.equal(fields.shares.step,'1');assert.equal(fields.shares.inputMode,'numeric');
  fields.shares.value='10';fields.currency.value='KRW';submit();assert.equal(ctx.state.plans[0].holdings[0].shares,10);
  assert.equal(fields.currency.disabled,false);assert.equal(ctx.state.plans[0].currency,'KRW','일반 종목의 원화 선택은 유지한다');
  assert.equal(fields.shares.validityMessage,'');
});

test('수량을 비운 평가액 계획은 직접 입력과 현재 시세 기준 가격을 저장한다',()=>{
  const {ctx,fields,submit}=load();fields.shares.value='';fields.valueKrw.value='100';submit();
  const p=ctx.state.plans[0];assert.equal(p.holdings.length,0);assert.equal(p.valueKrw,100);assert.equal(p.valueBase,60000);
});

test('매도 비중은 보유 수량을 최소 단위로 내림해 그만큼만 회차에 나누고 나머지는 남긴다',()=>{
  const {api}=load();
  assert.equal(api.planSalePct({}),100);assert.equal(api.planSalePct({salePct:100}),100);assert.equal(api.planSalePct({salePct:50}),50);
  for(const v of [0,-5,101,33.5,'abc',null])assert.equal(api.planSalePct({salePct:v}),100,'잘못된 값은 전량으로 본다');
  assert.equal(api.saleShares(15,{ticker:'AAA',salePct:50}),7,'주식은 정한 비중보다 더 팔지 않게 내림');
  assert.equal(api.saleShares(15,{ticker:'AAA'}),15);
  assert.equal(api.saleShares(0.01234567,{ticker:'BTC-USD',salePct:50}),0.00617283);
  const p={ticker:'AAA',salePct:50,holdings:[{shares:15}],stages:3,checked:[false,false,false]};
  assert.deepEqual(Array.from({length:3},(_,i)=>api.sharesAt(api.saleShares(15,p),i,3)),[3,2,2]);
  p.checked.fill(true);assert.equal(api.sharesLeft(p),8,'계획을 다 끝내도 매도하지 않은 수량은 남는다');
  const btc={ticker:'BTC-USD',salePct:30,holdings:[{shares:0.01234567}],stages:3,checked:[true,true,true]};
  assert.equal(api.sharesLeft(btc),0.00864197,'남긴 수량은 보유 − 매도(0.0037037 BTC)로 소수점 오차 없이');
  const value={ticker:'AAA',valueKrw:300,valueBase:100,startPrice:100,stages:3,salePct:50};
  assert.equal(api.stageWorth(value,100),50,'평가액만 넣은 계획은 평가액의 비중만 나눈다');
});

test('수정 창의 매도 비중은 100%면 저장하지 않고 아래면 저장하며 매도·남김 수량을 보여 준다',()=>{
  const {ctx,api,fields,node,submit}=load();
  fields.ticker.value='AAA';fields.shares.value='15';fields.salePct.value='50';api.planLive();
  assert.equal(node('saleNote').textContent,'7주 매도 · 8주 남김');
  submit();assert.equal(ctx.state.plans[0].salePct,50);
  vm.runInContext('editingId=state.plans[0].id',ctx);fields.salePct.value='100';api.planLive();assert.equal(node('saleNote').textContent,'');
  submit();assert.equal(ctx.state.plans.length,1);assert.equal('salePct' in ctx.state.plans[0],false,'100%는 필드를 지운다');
  vm.runInContext('editingId=state.plans[0].id',ctx);fields.salePct.value='';submit();assert.equal('salePct' in ctx.state.plans[0],false,'비우면 전량');
});

test('매도 비중이 잘못됐거나 매도할 수량이 없으면 저장을 막는다',()=>{
  const {ctx,fields,api,submit}=load();fields.ticker.value='AAA';
  for(const v of ['0','101','12.5']){fields.salePct.value=v;submit();assert.equal(ctx.state.plans.length,0);assert.match(fields.salePct.validityMessage,/1~100/);}
  fields.shares.value='1';fields.salePct.value='50';submit();assert.equal(ctx.state.plans.length,0);assert.match(fields.salePct.validityMessage,/매도할 수량/);
  fields.shares.value='';fields.valueKrw.value='100';api.planLive();assert.equal(fields.salePct.validityMessage,'');
  submit();assert.equal(ctx.state.plans[0].salePct,50);
});

test('자산 배분 연동: 회차 체결은 매도 비중을 적용한 회차 수량 × 회차 기준가, 평가액만 넣은 계획은 회차 매도액',()=>{
  const {api}=load(), plain=v=>JSON.parse(JSON.stringify(v));
  const shares={ticker:'005380',currency:'KRW',holdings:[{name:'테스트',shares:10}],stages:3,startPrice:300,endPrice:200,checked:[false,false,false],salePct:50};
  assert.deepEqual(plain(api.planTrade(shares,0)),{sign:-1,qty:2,price:300,currency:'KRW',value:null},'10주의 50% = 5주를 3회로(2·2·1)');
  assert.deepEqual(plain(api.planTrade(shares,2)),{sign:-1,qty:1,price:200,currency:'KRW',value:null});
  const btc={ticker:'BTC-USD',currency:'USD',holdings:[{shares:0.01234567}],stages:3,startPrice:60000,endPrice:50000,checked:[false,false,false]};
  assert.equal(api.planTrade(btc,1).qty,0.00411522);
  const value={ticker:'SOXX',currency:'USD',holdings:[],valueKrw:300,valueBase:100,stages:3,startPrice:100,endPrice:80,checked:[false,false,false]};
  assert.deepEqual(plain(api.planTrade(value,2)),{sign:-1,qty:null,price:80,currency:'USD',value:80},'300만원 ÷ 3회 × 80/100');
  let committed=0,drawn=0;
  api.planLink('check',{commit:()=>{committed++;return 'k';},redraw:()=>{drawn++;}});
  assert.deepEqual([committed,drawn,api.planLink('line','SOXX'),api.planLink('holding','SOXX')],[1,1,'',null],'자산 배분 연동이 없으면 체크만');
});

function partialSale({bitcoin=false,valueOnly=false}={}){
  const {api,ctx}=load(),ticker=bitcoin?'BTC-USD':'111111',qty=bitcoin?0.02:20;
  const p={id:'sale',title:'가상 매도 계획',ticker,currency:'KRW',holdings:valueOnly?[]:[{shares:qty}],valueKrw:valueOnly?20:null,startPrice:10000,endPrice:9000,stages:2,checked:[false,false]};
  const it={id:'asset',ticker,...(valueOnly?{amount:20}:{shares:qty})},alloc={groups:[{items:[it]}]},prices={stocks:{[ticker]:{kind:bitcoin?'코인':'국내',close:10000,asOf:'2026-01-02'}}};
  ctx.state.plans=[p];ctx.assetStore={doc:{allocation:alloc},prices,saveSection(){}};ctx.allocLink={
    check(o){const key=o.commit();if(key)api.applyTrade(alloc,prices,key,o.trade,o.label,[{id:it.id,unit:valueOnly?'amount':'shares',n:valueOnly?o.trade.value:o.trade.qty}]);o.redraw?.();},
    rescale(key,trade){api.rescaleTrade(alloc,key,trade);},uncheck(key){api.revertTrade(alloc,key);}
  };
  return {api,p,it,alloc,prices,fill:n=>api.recordPlanFill(p,0,n,()=>{}),fillQuantity:n=>api.recordPlanQuantity(p,0,n,()=>{})};
}

function accountSale(){
  const {api,ctx}=load(),p={id:'sale',title:'가상 기준 ETF',ticker:'AAA',currency:'USD',fx:1500,holdings:[{shares:4}],startPrice:100,endPrice:90,stages:2,checked:[false,false],sellAccountId:'isa',sellTargetId:'isa-etf'};
  const isa={id:'isa-etf',name:'가상 추종 ETF',ticker:'111111',shares:100},pension={id:'pension-etf',name:'가상 추종 ETF',ticker:'222222',shares:80},alloc={groups:[{id:'isa',name:'예시 ISA',items:[isa]},{id:'pension',name:'예시 연저펀',items:[pension]}]};
  const prices={fx:{close:1500},stocks:{'111111':{kind:'국내',close:10000,asOf:'2026-10-08'},'222222':{kind:'국내',close:15000,asOf:'2026-10-08'}}};
  ctx.priceData.stocks.AAA={kind:'해외',close:100,asOf:'2026-10-08'};
  ctx.state.plans=[p];ctx.assetStore={doc:{allocation:alloc},prices,saveSection(){}};ctx.allocLink={
    check(o){assert.equal(o.ownId,o.targetId);const key=o.commit();if(key)api.applyTrade(alloc,prices,key,{...o.trade,ticker:o.ticker},o.label,o.picks||[{id:o.targetId,unit:'shares',n:o.trade.qty}]);o.redraw?.();},
    rescale(key,trade){api.rescaleTrade(alloc,key,trade);},uncheck(key){api.revertTrade(alloc,key);}
  };
  return {api,ctx,p,isa,pension,alloc,prices,fill:(i,n)=>api.recordPlanQuantity(p,i,n,()=>{})};
}

test('매도 계좌 선택: 기준 2주를 기존 계좌 ETF 30주로 환산하고 부분 체결·추가·취소를 해당 항목에만 반영한다',()=>{
  const r=accountSale(),before=JSON.stringify([r.p,r.alloc]);
  assert.equal(r.api.planQuantityProgress(r.p,0).target,30);assert.equal(r.api.planSaleExecution(r.p,0).ticker,'111111');assert.equal(JSON.stringify([r.p,r.alloc]),before);
  r.fill(0,12);assert.equal(r.isa.shares,88);assert.equal(r.pension.shares,80);assert.equal(r.p.checked[0],false);
  assert.equal(r.api.planQuantityProgress(r.p,0).remaining,18);assert.equal(r.api.sharesLeft(r.p),3.2,'기준 수량 환산도 소수부를 보존');
  assert.equal(r.alloc.trades['sell:sale:0'].items[0].id,'isa-etf');assert.equal(r.alloc.trades['sell:sale:0'].qty,12);
  r.prices.stocks['111111'].close=20000;r.ctx.priceData.stocks.AAA.close=200;r.p.fx=2000;r.p.startPrice=200;
  assert.equal(r.api.planQuantityProgress(r.p,0).target,30);assert.equal(r.p.fills[0].execution.price,10000);
  for(const n of [31,1.5,-1,NaN]){r.fill(0,n);assert.equal(r.isa.shares,88);}
  r.fill(0,30);assert.equal(r.isa.shares,70);assert.equal(r.p.checked[0],true);assert.equal(r.pension.shares,80);
  r.fill(0,0);assert.equal(r.isa.shares,100);assert.equal(r.p.fills,undefined);assert.equal(r.alloc.trades,undefined);
});

test('평가액 추종 ETF 매도: 회차당 기준 ETF 1주 미만이어도 실제 ETF 주수로 환산한 뒤 내림한다',()=>{
  const r=accountSale();Object.assign(r.p,{holdings:[],valueKrw:300,valueBase:100,stages:30,checked:Array(30).fill(false)});r.isa.shares=1000;
  const before=JSON.stringify([r.p,r.alloc]);
  assert.equal(r.api.planSourceQuantityProgress(r.p,0).target,0,'기준 ETF를 직접 팔면 정수 주수로 내림');
  assert.deepEqual(Array.from({length:30},(_,i)=>r.api.planQuantityProgress(r.p,i).target),Array(30).fill(10),'10만원씩 30회 → 실제 ETF 10주씩');
  assert.ok(Math.abs(r.api.planSaleExecution(r.p,0).sourceQty-2/3)<1e-12);
  assert.equal(JSON.stringify([r.p,r.alloc]),before,'조회로 저장 기록을 바꾸지 않는다');
  r.ctx.priceData.stocks.AAA.close=120;
  assert.equal(r.api.planQuantityProgress(r.p,0).target,12,'기준 현재가를 반영');
  delete r.ctx.priceData.stocks.AAA;
  assert.equal(r.api.planQuantityProgress(r.p,0).target,10,'시세가 없으면 회차 기준가로 환산');
  assert.equal(r.api.planQuantityProgress(r.p,29).target,9);
  r.p.salePct=50;assert.equal(r.api.planQuantityProgress(r.p,0).target,5);
  r.isa.shares=3;assert.equal(r.api.planQuantityProgress(r.p,0).target,3,'보유량 한도 유지');
  delete r.prices.stocks['111111'];assert.equal(r.api.planQuantityProgress(r.p,0).target,null,'실제 ETF 시세 없이는 계산하지 않는다');
});

test('평가액 추종 ETF 매도: 부분 체결·수량 고정·추가 체결·취소가 실제 ETF 주수로 동작한다',()=>{
  const r=accountSale();Object.assign(r.p,{holdings:[],valueKrw:20,valueBase:100});
  assert.equal(r.api.planQuantityProgress(r.p,0).target,10);
  r.fill(0,4);assert.equal(r.isa.shares,96);assert.equal(r.pension.shares,80);assert.equal(r.p.checked[0],false);
  assert.equal(r.p.fills[0].value,4);assert.equal(r.api.planQuantityProgress(r.p,0).remaining,6);
  r.ctx.priceData.stocks.AAA.close=200;r.prices.stocks['111111'].close=20000;r.p.fx=2000;r.p.startPrice=200;
  assert.equal(r.api.planQuantityProgress(r.p,0).target,10);assert.equal(r.p.fills[0].execution.price,10000);
  r.fill(0,10);assert.equal(r.isa.shares,90);assert.equal(r.p.checked[0],true);
  r.fill(0,0);assert.equal(r.isa.shares,100);assert.equal(r.p.fills,undefined);assert.equal(r.alloc.trades,undefined);
});

test('연결된 직접 보유 종목은 실제 보유량을 쓰고 옛 체결 기록은 기준 ETF 단위를 유지한다',()=>{
  const r=accountSale();Object.assign(r.p,{holdings:[],valueKrw:20,valueBase:100});r.isa.ticker='AAA';
  assert.equal(r.api.planQuantityProgress(r.p,0).target,50,'연결된 실제 보유 100주를 2회로 나눈다');
  r.isa.ticker='111111';r.p.checked[0]=true;
  assert.equal(r.api.planQuantityProgress(r.p,0).target,0,'옛 완료 회차는 기준 ETF 단위 유지');
  r.p.checked[0]=false;delete r.p.sellTargetId;delete r.p.sellAccountId;
  assert.equal(r.api.planQuantityProgress(r.p,0).target,0);
});

test('계좌를 바꿔도 이미 체결한 회차는 원래 계좌에 남고 새 회차만 새 계좌 ETF를 사용한다',()=>{
  const r=accountSale();r.fill(0,12);r.p.sellAccountId='pension';r.p.sellTargetId='pension-etf';
  assert.equal(r.api.planQuantityProgress(r.p,0).execution.targetId,'isa-etf');assert.equal(r.api.planQuantityProgress(r.p,1).target,20,'환산은 두 ETF의 현재가를 사용하고 회차 기준가는 유지');
  r.fill(1,9);assert.equal(r.pension.shares,71);assert.equal(r.isa.shares,88);
  r.fill(0,30);assert.equal(r.isa.shares,70);assert.equal(r.pension.shares,71);
  r.fill(0,0);r.fill(1,0);assert.equal(r.isa.shares,100);assert.equal(r.pension.shares,80);
});

test('매도 ETF 시세·보유 부족·계좌 미선택·삭제를 처리하고 일반 기준 ETF 기록을 바꾸지 않는다',()=>{
  const r=accountSale();r.isa.shares=5;assert.equal(r.api.planQuantityProgress(r.p,0).target,5);assert.equal(r.api.planSaleExecution(r.p,0).capped,true);
  r.isa.shares=0;assert.equal(r.api.planQuantityProgress(r.p,0).target,0);r.fill(0,1);assert.equal(r.p.fills,undefined);
  r.isa.shares=100;delete r.prices.stocks['111111'];assert.equal(r.api.planQuantityProgress(r.p,0).target,null);r.fill(0,1);assert.equal(r.isa.shares,100);
  r.isa.ticker='AAA';r.isa.tradeTicker='111111';r.isa.tradePrice=10000;r.isa.tradePriceAt='2026-10-08';assert.equal(r.api.planQuantityProgress(r.p,0).target,50);
  delete r.p.sellTargetId;assert.equal(r.api.planQuantityProgress(r.p,0).target,50,'기준 티커가 연결됐으면 계좌 선택 없이 포함');
  delete r.p.sellAccountId;assert.equal(r.api.planQuantityProgress(r.p,0).target,50);
  r.isa.ticker='111111';assert.equal(r.api.planQuantityProgress(r.p,0).target,2,'연결 없는 기존 계획은 그대로');
  r.p.sellTargetId='gone';assert.equal(r.api.planQuantityProgress(r.p,0).target,null);
  r.p.checked[0]=true;assert.equal(r.api.planQuantityProgress(r.p,0).target,2,'옛 완료 회차는 기준 ETF 단위 유지');
});

test('분할매도: 계획 10주 중 7주만 체결하면 7주만 빼고 3주는 미완료로 남긴다',()=>{
  const {api,p,it,alloc,fill}=partialSale();const before=JSON.stringify(p);api.planStageProgress(p,0);assert.equal(JSON.stringify(p),before);
  fill(7);assert.equal(it.shares,13);assert.equal(api.sharesLeft(p),13);assert.equal(p.checked[0],false);
  assert.equal(p.fills[0].plannedQty,10);assert.equal(api.planStageProgress(p,0).remaining,3);
  assert.equal(alloc.trades['sell:sale:0'].qty,7);
  fill(9);assert.equal(it.shares,11,'추가 2주만 차감');
  fill(10);assert.equal(it.shares,10);assert.equal(p.checked[0],true);
  fill(7);assert.equal(it.shares,13,'완료 체결량 정정도 차이만 복원');assert.equal(p.checked[0],false);
  fill(0);assert.equal(it.shares,20);assert.equal(api.sharesLeft(p),20);
  assert.equal(p.fills,undefined);assert.equal(alloc.trades,undefined);
});

test('분할매도: 부분 체결 뒤 가격이 바뀌어도 원래 주문 수량·가격을 유지한다',()=>{
  const {api,p,it,fill}=partialSale();fill(7);p.startPrice=20000;
  assert.equal(api.planStageProgress(p,0).remaining,3);assert.equal(api.planStageProgress(p,0).trade.price,10000);
  for(const n of [11,7.5,-1,NaN,Infinity]){fill(n);assert.equal(it.shares,13);}
  fill(10);assert.equal(it.shares,10);
  const small={...p,holdings:[{shares:1}],stages:3,checked:[false,false,false]};delete small.fills;
  assert.equal(api.planStageProgress(small,1).target,0,'수량 0주 회차와 보유량 미입력은 구분');
});

test('분할매도: 비트코인 부분 체결·잔량·취소를 소수점 8자리로 정확히 처리한다',()=>{
  const {api,p,it,fill}=partialSale({bitcoin:true});fill(0.007);
  assert.equal(it.shares,0.013);assert.equal(api.sharesLeft(p),0.013);assert.equal(api.planStageProgress(p,0).remaining,0.003);
  fill(0.007000001);assert.equal(it.shares,0.013,'최소 단위보다 작은 수량은 거부');
  fill(0.01);assert.equal(it.shares,0.01);assert.equal(p.checked[0],true);
  fill(0);assert.equal(it.shares,0.02);
});

test('분할매도: 평가액만 있는 계획도 부분 체결액과 남은 금액을 분리한다',()=>{
  const {api,p,it,fill}=partialSale({valueOnly:true});fill(7);
  assert.equal(it.amount,13);assert.equal(api.planStageProgress(p,0).remaining,3);assert.equal(p.checked[0],false);
  p.startPrice=20000;assert.equal(api.planStageProgress(p,0).target,10,'첫 체결 때 예정액도 고정');
  fill(10);assert.equal(it.amount,10);assert.equal(p.checked[0],true);
  fill(0);assert.equal(it.amount,20);
});

test('분할매도: 연결된 금액 보유 항목도 실제 ETF 주수로 입력하고 금액을 자동 계산한다',()=>{
  const {api,p,it,fillQuantity}=partialSale({valueOnly:true});
  assert.equal(api.planQuantityProgress(p,0).target,10);
  fillQuantity(7);assert.equal(it.amount,13);assert.equal(p.fills[0].execution.qty,7);assert.equal(p.fills[0].execution.plannedQty,10);
  assert.equal(api.planQuantityProgress(p,0).remaining,3);assert.equal(p.checked[0],false);
  assert.match(api.planSaleRow(p,0,''),/누적 체결 수량 \(주\)/);assert.doesNotMatch(api.planSaleRow(p,0,''),/금액 \(만원\)/);
  p.fx=2000;fillQuantity(10);assert.equal(it.amount,10);assert.equal(p.checked[0],true);
  fillQuantity(0);assert.equal(it.amount,20);
  p.startPrice=18000;
  assert.equal(api.planQuantityProgress(p,0).target,10,'매도 기준가 변경으로 실제 보유량을 다시 환산하지 않는다');
  fillQuantity(10);assert.equal(p.checked[0],true);assert.equal(it.amount,10);
});

function groupSale({stages=7,a=53,b=34,native=0,salePct=100}={}){
  const r=accountSale();Object.assign(r.p,{holdings:[],valueKrw:12,stages,checked:Array(stages).fill(false),salePct});
  Object.assign(r.isa,{ticker:'AAA',tradeTicker:'111111',shares:a});Object.assign(r.pension,{ticker:'AAA',tradeTicker:'111111',shares:b});
  r.native={id:'direct',name:'가상 직접 보유',ticker:'AAA',shares:native};r.alloc.groups.push({id:'direct-account',name:'예시 일반 계좌',items:[r.native]});
  r.member=(i,id,n)=>r.api.recordPlanGroupFill(r.p,i,new Map([[id,n]]),false,()=>{});
  r.finish=i=>{const e=r.api.planSaleExecution(r.p,i);r.api.recordPlanGroupFill(r.p,i,new Map(e.rows.map(row=>[row.targetId,row.plannedQty])),true,()=>{});};
  return r;
}

test('통합 매도: 여러 계좌의 같은 ETF 주수 전체를 균등 배분하고 평가액·선택 계좌로 제한하지 않는다',()=>{
  const r=groupSale(),before=JSON.stringify([r.p,r.alloc]),targets=Array.from({length:7},(_,i)=>r.api.planQuantityProgress(r.p,i).target);
  assert.equal(targets.reduce((n,v)=>n+v,0),87);assert.ok(Math.max(...targets)-Math.min(...targets)<=1);
  const schedule=r.api.planLinkedSaleSchedule(r.p);
  assert.equal(schedule.rows.find(x=>x.targetId===r.isa.id).planned.reduce((n,v)=>n+v,0),53);
  assert.equal(schedule.rows.find(x=>x.targetId===r.pension.id).planned.reduce((n,v)=>n+v,0),34);
  assert.equal(JSON.stringify([r.p,r.alloc]),before,'조회·화면 계산으로 저장 필드를 만들지 않는다');
  r.p.fx=2000;r.ctx.priceData.stocks.AAA.close=250;r.prices.stocks['111111'].close=20000;r.p.valueKrw=1;
  assert.deepEqual(Array.from({length:7},(_,i)=>r.api.planQuantityProgress(r.p,i).target),targets);
  assert.match(r.api.planSaleAccountView(r.p),/87주 보유/);assert.doesNotMatch(r.api.planSaleAccountView(r.p),/id="saleAccount"/);
  for(let i=0;i<7;i++)r.finish(i);
  assert.deepEqual([r.isa.shares,r.pension.shares,r.native.shares],[0,0,0]);assert.ok(r.p.checked.every(Boolean));
});

test('통합 매도: 계좌별 부분 체결·정정·전체 완료·취소가 해당 계좌에 정확히 반영된다',()=>{
  const r=groupSale(),i=4,e=r.api.planSaleExecution(r.p,i),a=e.rows.find(x=>x.targetId===r.isa.id).plannedQty,b=e.rows.find(x=>x.targetId===r.pension.id).plannedQty;
  r.member(i,r.isa.id,3);assert.deepEqual([r.isa.shares,r.pension.shares],[50,34]);assert.equal(r.p.checked[i],false);
  assert.deepEqual(JSON.parse(JSON.stringify(r.alloc.trades[`sell:sale:${i}`].items.map(x=>[x.id,x.shares]))),[[r.isa.id,-3]]);
  r.member(i,r.pension.id,2);assert.deepEqual([r.isa.shares,r.pension.shares],[50,32]);
  r.member(i,r.isa.id,1);assert.deepEqual([r.isa.shares,r.pension.shares],[52,32]);
  const locked=r.api.planSaleExecution(r.p,i);r.p.fx=2000;r.prices.stocks['111111'].close=30000;r.p.startPrice=150;
  assert.equal(r.api.planSaleExecution(r.p,i).rows.find(x=>x.targetId===r.isa.id).price,locked.rows.find(x=>x.targetId===r.isa.id).price);
  r.finish(i);assert.deepEqual([r.isa.shares,r.pension.shares],[53-a,34-b]);assert.equal(r.p.checked[i],true);
  assert.equal(Array.from({length:7},(_,i)=>r.api.planQuantityProgress(r.p,i).target).reduce((n,v)=>n+v,0),87,'고정 회차와 남은 회차의 합계 보존');
  r.api.recordPlanQuantity(r.p,i,0,()=>{});assert.deepEqual([r.isa.shares,r.pension.shares],[53,34]);assert.equal(r.p.fills,undefined);assert.equal(r.alloc.trades,undefined);
});

test('통합 매도 우선순위: 앞 계좌를 소진한 뒤 다음 계좌로 넘어가고 변경은 보유 자산을 바꾸지 않는다',()=>{
  const r=groupSale(),before=JSON.stringify(r.alloc),first=r.api.planSaleExecution(r.p,0);
  assert.deepEqual(Array.from(first.rows,x=>x.plannedQty),[13,0,0]);
  const boundary=r.api.planSaleExecution(r.p,4);assert.deepEqual(Array.from(boundary.rows,x=>x.plannedQty),[3,10,0]);
  r.api.movePlanSalePriority(r.p,r.pension.id,-1,()=>{});
  assert.deepEqual(Array.from(r.p.sellPriority),[r.pension.id,r.isa.id,r.native.id]);
  assert.equal(JSON.stringify(r.alloc),before,'순서를 바꾸는 동작은 자산·체결 기록을 바꾸지 않는다');
  assert.deepEqual(Array.from(r.api.planSaleExecution(r.p,0).rows,x=>x.plannedQty),[13,0,0]);
  assert.equal(r.api.planSaleExecution(r.p,0).rows[0].targetId,r.pension.id);
  assert.deepEqual(Array.from(r.api.planSaleExecution(r.p,2).rows,x=>x.plannedQty),[9,4,0]);
  for(let i=0;i<7;i++)r.finish(i);
  assert.deepEqual([r.isa.shares,r.pension.shares],[0,0]);
});

test('통합 매도 우선순위: 매도 비중은 같은 코드의 합계에 적용하고 우선 계좌부터 목표를 채운다',()=>{
  const r=groupSale({a:11,b:11,native:5,salePct:50,stages:3});
  assert.deepEqual(Array.from(r.api.planLinkedSaleSchedule(r.p).rows,x=>x.quota),[11,0,2]);
  r.api.movePlanSalePriority(r.p,r.pension.id,-1,()=>{});
  assert.deepEqual(Array.from(r.api.planLinkedSaleSchedule(r.p).rows,x=>x.quota),[11,0,2]);
  assert.deepEqual(Array.from(r.api.planSaleExecution(r.p,0).rows,x=>[x.targetId,x.plannedQty]),[[r.pension.id,5],[r.isa.id,0],[r.native.id,0]]);
  for(let i=0;i<3;i++)r.finish(i);
  assert.deepEqual([r.isa.shares,r.pension.shares,r.native.shares],[11,0,3]);
});

test('통합 매도 우선순위: 일부 체결 후 순서를 바꿔도 고정 회차와 매도 비중의 합계를 보존한다',()=>{
  const r=groupSale({a:11,b:11,salePct:50,stages:3});r.member(0,r.isa.id,2);
  const locked=JSON.stringify(r.p.fills[0]),assets=JSON.stringify(r.alloc);
  r.api.movePlanSalePriority(r.p,r.pension.id,-1,()=>{});
  assert.equal(JSON.stringify(r.p.fills[0]),locked);assert.equal(JSON.stringify(r.alloc),assets);
  const schedule=r.api.planLinkedSaleSchedule(r.p);
  assert.equal(schedule.rows.find(x=>x.targetId===r.isa.id).quota,4);
  assert.equal(schedule.rows.find(x=>x.targetId===r.pension.id).quota,7);
  assert.equal(Array.from({length:3},(_,i)=>r.api.planQuantityProgress(r.p,i).target).reduce((a,b)=>a+b,0),11);
  for(let i=0;i<3;i++)r.finish(i);
  assert.deepEqual([r.isa.shares,r.pension.shares],[7,4]);
  for(let i=0;i<3;i++)r.api.recordPlanQuantity(r.p,i,0,()=>{});
  assert.deepEqual([r.isa.shares,r.pension.shares],[11,11]);
});

test('통합 매도 우선순위: 실제 ETF 코드가 달라도 전체 종목을 한 순서로 배정한다',()=>{
  const r=groupSale({a:20,b:15,native:5,stages:4});r.pension.tradeTicker='222222';
  r.api.movePlanSalePriority(r.p,r.native.id,-1,()=>{});r.api.movePlanSalePriority(r.p,r.native.id,-1,()=>{});
  r.api.movePlanSalePriority(r.p,r.pension.id,-1,()=>{});
  const planned=Array.from({length:4},(_,i)=>Array.from(r.api.planSaleExecution(r.p,i).rows,x=>x.plannedQty));
  assert.deepEqual(planned,[[5,5,0],[0,10,0],[0,0,10],[0,0,10]]);
  for(let i=0;i<4;i++)r.finish(i);
  assert.deepEqual([r.isa.shares,r.pension.shares,r.native.shares],[0,0,0]);
});

test('통합 매도 우선순위: 새 연결 종목은 마지막에 추가하며 삭제·중복 id와 이름 변경에도 자산 id 순서를 유지한다',()=>{
  const r=groupSale();r.p.sellPriority=['removed',r.pension.id,r.pension.id,r.isa.id];
  r.isa.name=r.pension.name='같은 종목 이름';r.alloc.groups[0].name=r.alloc.groups[1].name='같은 계좌 이름';
  const extra={id:'new',name:'새 보유',ticker:'AAA',tradeTicker:'111111',shares:6};r.alloc.groups.unshift({id:'new-account',items:[extra]});
  const before=JSON.stringify(r.p),rows=r.api.planLinkedSaleSchedule(r.p).rows;
  assert.deepEqual(Array.from(rows,x=>x.targetId),[r.pension.id,r.isa.id,extra.id,r.native.id]);
  assert.equal(rows.find(x=>x.targetId===extra.id).planned.reduce((a,b)=>a+b,0),6);
  assert.equal(JSON.stringify(r.p),before,'불러온 순서는 조회할 때 수정하지 않는다');
  r.api.movePlanSalePriority(r.p,r.pension.id,-1,()=>{});assert.equal(JSON.stringify(r.p),before,'첫 종목의 올리기는 저장하지 않는다');
});

test('통합 매도 우선순위: 경계 회차에서 한 계좌의 잔량만 체결해도 다음 계좌와 완료 상태를 유지한다',()=>{
  const r=groupSale(),e=r.api.planSaleExecution(r.p,4),first=e.rows.find(x=>x.targetId===r.isa.id);
  r.member(4,first.targetId,first.plannedQty);
  assert.deepEqual([r.isa.shares,r.pension.shares],[50,34]);assert.equal(r.p.checked[4],false);
  const pending=r.api.planSaleExecution(r.p,4).rows.find(x=>x.targetId===r.pension.id);
  r.member(4,pending.targetId,pending.plannedQty);assert.equal(r.p.checked[4],true);
  r.member(4,first.targetId,0);assert.deepEqual([r.isa.shares,r.pension.shares],[53,24]);assert.equal(r.p.checked[4],false);
});

test('통합 매도: 나중에 직접 매수한 기준 종목과 다른 계좌의 추종 ETF도 미체결 회차에 자동 포함한다',()=>{
  const r=groupSale();r.member(0,r.isa.id,3);const locked=JSON.stringify(r.p.fills[0].execution);
  r.native.shares=5;
  r.extra={id:'new-account-etf',name:'추가 계좌 ETF',ticker:'AAA',tradeTicker:'111111',shares:9};r.alloc.groups.push({id:'new',name:'추가 계좌',items:[r.extra]});
  const schedule=r.api.planLinkedSaleSchedule(r.p);
  assert.equal(schedule.rows.find(x=>x.targetId===r.native.id).planned.reduce((n,v)=>n+v,0),5);
  assert.equal(schedule.rows.find(x=>x.targetId===r.extra.id).planned.reduce((n,v)=>n+v,0),9);
  assert.equal(JSON.stringify(r.p.fills[0].execution),locked,'이미 체결한 회차의 계좌·계획은 바꾸지 않는다');
  r.finish(0);for(let i=1;i<7;i++)r.finish(i);
  assert.deepEqual([r.isa.shares,r.pension.shares,r.native.shares,r.extra.shares],[0,0,0,0]);
});

test('통합 매도: 같은 ETF 여러 계좌의 매도 비중을 한 번 내림하고 다른 기준 티커는 제외한다',()=>{
  const r=groupSale({a:11,b:11,native:5,salePct:50,stages:3});r.alloc.groups.push({id:'other',items:[{id:'other-etf',ticker:'BBB',tradeTicker:'111111',shares:10}]});
  const schedule=r.api.planLinkedSaleSchedule(r.p);
  assert.equal(schedule.rows.filter(x=>x.ticker==='111111').reduce((n,r)=>n+r.quota,0),11,'계좌별 5주+5주가 아니라 합계 22주의 50%');
  assert.equal(schedule.rows.find(x=>x.targetId===r.native.id).quota,2);
  assert.equal(schedule.rows.some(x=>x.targetId==='other-etf'),false);
  for(let i=0;i<3;i++)r.finish(i);
  assert.equal(r.isa.shares+r.pension.shares,11);assert.equal(r.native.shares,3);assert.equal(r.alloc.groups.at(-1).items[0].shares,10);
});

test('통합 매도: 가격·환율 누락은 체결을 막고 보유량 초과·종목 삭제는 추가 차감을 막는다',()=>{
  const r=groupSale({native:5}),e=r.api.planSaleExecution(r.p,0),a=e.rows.find(x=>x.targetId===r.isa.id).plannedQty;
  for(const n of [a+1,1.5,-1,NaN])r.member(0,r.isa.id,n);assert.equal(r.p.fills,undefined);
  delete r.prices.stocks['111111'];r.member(0,r.isa.id,1);assert.equal(r.isa.shares,53);assert.equal(r.p.fills,undefined);
  r.p.fx=0;r.member(6,r.native.id,1);assert.equal(r.native.shares,5);
  r.p.fx=1500;r.prices.stocks['111111']={kind:'국내',close:10000,asOf:'2026-10-08'};r.member(0,r.isa.id,3);
  r.isa.shares=1;r.member(0,r.isa.id,a);assert.equal(r.isa.shares,1,'추가 체결이 실제 남은 보유량보다 크면 막는다');
  r.alloc.groups[0].items=[];r.finish(0);assert.equal(r.pension.shares,34,'삭제된 체결 계좌가 있는 전체 체크는 다른 계좌도 바꾸지 않는다');
});

test('통합 매도: 수량 없는 회차도 완료할 수 있고 전량 완료 뒤 취소하면 원래 계좌에 복원된다',()=>{
  const r=groupSale({a:2,b:1,stages:7});for(let i=0;i<7;i++)r.finish(i);
  assert.ok(r.p.checked.every(Boolean));assert.equal(r.isa.shares+r.pension.shares,0);
  for(let i=0;i<7;i++)r.api.recordPlanQuantity(r.p,i,0,()=>{});
  assert.deepEqual([r.isa.shares,r.pension.shares],[2,1]);assert.equal(r.alloc.trades,undefined);
});

test('통합 매도: 옛 단일 계좌 체결은 유지하고 아직 체결하지 않은 회차부터 전체 계좌 잔량을 나눈다',()=>{
  const r=accountSale();r.fill(0,12);const old=JSON.stringify(r.p.fills[0]);
  Object.assign(r.isa,{ticker:'AAA',tradeTicker:'111111'});Object.assign(r.pension,{ticker:'AAA',tradeTicker:'222222'});
  assert.equal(r.api.planQuantityProgress(r.p,0).target,30);assert.equal(JSON.stringify(r.p.fills[0]),old);
  const next=r.api.planSaleExecution(r.p,1);assert.equal(next.rows.find(x=>x.targetId===r.isa.id).plannedQty,70);assert.equal(next.rows.find(x=>x.targetId===r.pension.id).plannedQty,80);
  r.fill(0,30);r.api.recordPlanQuantity(r.p,1,150,()=>{});assert.deepEqual([r.isa.shares,r.pension.shares],[0,0]);
});

test('분할매도: 수량 없는 옛 금액 체결도 이미 차감한 주수를 읽고 차이만 정정한다',()=>{
  const {api,p,it,alloc,prices,fillQuantity}=partialSale({valueOnly:true});
  delete it.amount;it.shares=20;
  p.fills={0:{plannedValue:10,value:7.58,price:10000}};
  api.applyTrade(alloc,prices,'sell:sale:0',{sign:-1,value:7.58,price:10000,currency:'KRW'},'옛 체결',[{id:'asset',unit:'shares',n:8}]);
  const before=JSON.stringify(alloc);assert.equal(api.planQuantityProgress(p,0).amount,8);assert.equal(JSON.stringify(alloc),before);
  fillQuantity(9);assert.equal(it.shares,11,'이미 차감한 8주에서 추가 1주만 차감');
  fillQuantity(0);assert.equal(it.shares,20);
});
