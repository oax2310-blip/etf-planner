const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 분할매도 비트코인 회차표(plans.js planRowPrice·planSaleRow): 매도 수량을 체결 칸 위에 BTC 소수로 쌓아 보인다. 가짜 종목·가격·수량만 사용한다.
const read=f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8');
const today=new Date().toISOString().slice(0,10);
function load(plan){
  const els={},handlers={};
  const el=id=>els[id]??={id,value:'',dataset:{},style:{},innerHTML:'',textContent:'',events:{},addEventListener(kind,handler){this.events[kind]=handler;},
    setCustomValidity(){},querySelectorAll:()=>[],querySelector:()=>el('inner'),classList:{toggle(){}},close(){},showModal(){},focus(){},append(){}};
  el('planForm').elements={};
  const ctx=vm.createContext({$:el,$$:()=>[],addEventListener(){},save(){},render(){},onEdit:(sel,set)=>{handlers[sel]=set;},alert(){},
    document:{createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:0})}),createElement:()=>({value:'',dataset:{},setAttribute(){},append(){},focus(){}})},
    state:{plans:[plan],futures:{positions:[]},selectedPlan:plan.id},PENCIL:'',memoCount:()=>'',id:()=>'p1',
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),usd:new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
    priceText:(v,c)=>c==='USD'?`$${v}`:`${v}원`,fxText:v=>`≈₩${v}`,
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    priceData:{updatedAt:new Date().toISOString(),stocks:{'BTC-USD':{kind:'코인',asOf:today,close:61000,ma:{}},AAA:{kind:'해외',asOf:today,close:610,ma:{}}},futures:{}}});
  for(const f of ['ma-ladder.js','prices.js','assets-calc.js','stock-names.js','item-search.js','rebuy.js','trade-alerts.js','plans.js'])vm.runInContext(read(f),ctx);
  const draw=()=>{ctx.renderPlans();return els.planMain.innerHTML;};
  return {ctx,draw,row:i=>(draw().match(/<div class="purchase-row[^"]*"><label class="check"[\s\S]*?(?=<div class="purchase-row|<\/div><\/section>)/g)||[])[i]||'',
    fill:(i,v)=>{draw();handlers['#planMain [data-sale-filled]'](v,{dataset:{saleFilled:String(i)}});}};
}
// 0.0108402 BTC를 30회로 → 회차마다 0.00036134 BTC
const btc=(extra={})=>({id:'btc',title:'가상 비트코인',ticker:'BTC-USD',currency:'USD',fx:1000,startLabel:'직접',endLabel:'직접',startPrice:60000,endPrice:50000,stages:30,checked:Array(30).fill(false),holdings:[{name:'가상 비트코인',shares:0.0108402}],note:'',...extra});

test('비트코인 회차표는 매도·체결을 한 칸(머리 BTC)에 쌓고 수량은 BTC 소수 그대로, 기준가 칸은 센트 없이 보이며 기록은 바꾸지 않는다',()=>{
  const p=btc(),before=JSON.stringify(p),{draw,row}=load(p),html=draw();
  assert.match(html,/sale-table hide-completed btc" id="saleTable"/);
  assert.match(html,/<div class="purchase-table-head"><span>회차<\/span><span>기준가<\/span><span>매도 \/ 체결 <small>BTC<\/small><\/span><span>알림<\/span><span>상태<\/span><\/div>/);
  assert.match(row(0),/class="purchase-qty">0\.00036134<\/div><div class="purchase-fill"><input type="number" min="0" max="0\.00036134" step="0\.00000001" inputmode="decimal" data-sale-filled="0" value="0"/);
  assert.match(row(0),/aria-label="1회 매도 누적 체결 수량 \(BTC\)"/);
  assert.match(row(1),/<span class="price">\$59,655<\/span><span class="krw">≈₩59655172\.41/,'기준가 칸은 센트를 빼고 반올림($59,655.17), 원화 환산은 원래 가격');
  assert.equal(JSON.stringify(p),before,'화면 표시만 바꾼다');
});

test('부분 체결 회차는 수량 자리에 남은 BTC를 보이고 체결은 BTC 소수로 저장한다',()=>{
  const p=btc(),{row,fill}=load(p);
  fill(0,'0.00012');assert.equal(p.fills[0].qty,0.00012);assert.equal(p.checked[0],false);
  assert.match(row(0),/<small>부분 체결<\/small>[\s\S]*class="purchase-qty"><small class="qty-left">남은<\/small>0\.00024134<\/div>[\s\S]*value="0\.00012"/);
  for(const v of ['0.00036135','0.000361345','-1'])fill(0,v);assert.equal(p.fills[0].qty,0.00012,'회차 수량 초과·1 sat 미만·음수는 거절');
  fill(0,'0.00036134');assert.equal(p.fills[0].qty,0.00036134);assert.equal(p.checked[0],true);
  assert.match(row(0),/class="purchase-qty">0\.00036134<\/div>/);
  fill(0,'0');assert.equal(p.fills,undefined);assert.equal(p.checked[0],false);
});

test('주식 회차표와 진행 카드 등 다른 표시는 그대로',()=>{
  const p=btc({id:'stock',ticker:'AAA',startPrice:600,endPrice:500,holdings:[{name:'가상 ETF',shares:60}]}),{draw,row,fill}=load(p);
  assert.doesNotMatch(draw(),/ btc"|qty-left|매도 \/ 체결/);
  assert.match(draw(),/<span>매도<\/span><span>체결<\/span>/);
  assert.match(row(1),/<span class="price[^"]*">\$596\.551724137931<\/span>/,'주식 기준가는 원래 표시(priceText) 그대로');
  assert.match(row(0),/class="purchase-qty">2주<\/div>[\s\S]*max="2" step="1" inputmode="numeric" data-sale-filled="0" value="0"/);
  fill(0,'1');assert.equal(p.fills[0].qty,1);
  const t=load(btc());t.fill(0,'0.00012');
  assert.match(t.draw(),/0\.00012 BTC 매도, 0\.00024134 BTC 남음/,'진행 카드는 단위까지 그대로');
});
