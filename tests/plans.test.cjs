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
    fx:'1000',startUnit:'',startN:'60',startLabel:'직접',startPrice:'60000',endN:'25',endUnit:'개월선',endPrice:'50000',stages:'3',valueKrw:''})
    .map(([key,value])=>[key,Object.assign(node('field:'+key),{value})]));
  const form=node('planForm');form.elements=fields;form.reportValidity=()=>Object.values(fields).every(f=>!f.validityMessage);
  const ctx=vm.createContext({$:node,$$:()=>[],addEventListener(){},state:{plans:[],futures:{positions:[]}},save(){},render(){},
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),
    priceData:{updatedAt:'2026-10-02T12:00:00Z',stocks:{'BTC-USD':{kind:'코인',asOf:'2026-10-02',close:60000,ma:{'25개월선':50000}},
      BTC:{kind:'해외',asOf:'2026-10-02',close:30,ma:{}}}},
    id:()=> 'test-plan',FormData:class{constructor(f){this.fields=f.elements;}get(key){return this.fields[key]?.value;}}});
  for(const file of ['prices.js','plans.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx);
  const api=vm.runInContext('({sharesAt,sharesLeft,hasPlanShares,planQuantity,planQuote,planLive})',ctx);
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
  const {api,ctx,fields,node,submit}=load();api.planLive();
  assert.equal(fields.shares.step,'0.00000001');assert.equal(fields.shares.inputMode,'decimal');
  assert.equal(node('sharesLabel').textContent,'보유 수량 (BTC)');assert.equal(fields.valueKrw.readOnly,true);
  assert.equal(Number(fields.valueKrw.value),74.1);
  submit();assert.equal(ctx.state.plans.length,1);
  const p=ctx.state.plans[0];assert.equal(p.ticker,'BTC-USD');assert.equal(p.holdings[0].shares,0.01234567);assert.equal(p.valueKrw,null);
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
  fields.shares.value='10';submit();assert.equal(ctx.state.plans[0].holdings[0].shares,10);
  assert.equal(fields.shares.validityMessage,'');
});

test('수량을 비운 평가액 계획은 직접 입력과 현재 시세 기준 가격을 저장한다',()=>{
  const {ctx,fields,submit}=load();fields.shares.value='';fields.valueKrw.value='100';submit();
  const p=ctx.state.plans[0];assert.equal(p.holdings.length,0);assert.equal(p.valueKrw,100);assert.equal(p.valueBase,60000);
});
