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
  const form=node('planForm');form.elements=fields;form.reportValidity=()=>Object.values(fields).every(f=>!f.validityMessage);
  const ctx=vm.createContext({$:node,$$:()=>[],addEventListener(){},state:{plans:[],futures:{positions:[]}},save(){},render(){},
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),
    priceData:{updatedAt:'2026-10-02T12:00:00Z',stocks:{'BTC-USD':{kind:'코인',asOf:'2026-10-02',close:60000,ma:{'25개월선':50000}},
      BTC:{kind:'해외',asOf:'2026-10-02',close:30,ma:{}}}},
    id:()=> 'test-plan',FormData:class{constructor(f){this.fields=f.elements;}get(key){return this.fields[key]?.disabled?null:this.fields[key]?.value;}}});
  for(const file of ['prices.js','plans.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx);
  const api=vm.runInContext('({sharesAt,sharesLeft,hasPlanShares,planQuantity,planQuote,planLive,planSalePct,saleShares,stageWorth,planTrade,planLink})',ctx);
  return {ctx,api,fields,node,submit:()=>form.events.submit({target:form,preventDefault(){}})};
}

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
