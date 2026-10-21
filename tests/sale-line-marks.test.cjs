const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 분할매도 회차표의 이평선 위치 줄(plans.js planLineMarks). 가짜 종목·가격·수량만 사용한다.
const read=f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8');
const today=new Date().toISOString().slice(0,10);
const MA={'25선':103,'60일선':100,'80일선':97.5,'125일선':93,'150일선':92.9,'25주선':94,'25개월선':80,'32개월선':76};
const quote=(ma=MA,close=101)=>({updatedAt:new Date().toISOString(),stocks:{AAA:{kind:'해외',asOf:today,close,ma}},futures:{}});
// 회차 기준가 100·95·90·85·80(하락 매도), 회차마다 2주
const plan=(extra={})=>({id:'p1',ticker:'AAA',title:'가상 ETF',currency:'USD',startLabel:'60일선',startAuto:true,endLabel:'25개월선',startPrice:100,endPrice:80,stages:5,checked:Array(5).fill(false),holdings:[{name:'가상 ETF',shares:10}],note:'',fx:1300,...extra});
function draw(p,prices=quote()){
  const els={};
  const el=id=>els[id]??={id,value:'',dataset:{},style:{},innerHTML:'',textContent:'',events:{},addEventListener(kind,handler){this.events[kind]=handler;},
    setCustomValidity(){},querySelectorAll:()=>[],querySelector:()=>el('inner'),classList:{toggle(){}},close(){},showModal(){},focus(){},append(){}};
  el('planForm').elements={};
  const ctx=vm.createContext({$:el,$$:()=>[],addEventListener(){},save(){},render(){},onEdit(){},alert(){},
    document:{createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:0})}),createElement:()=>({value:'',dataset:{},setAttribute(){},append(){},focus(){}})},
    state:{plans:[p],futures:{positions:[]},selectedPlan:p.id},PENCIL:'✎',memoCount:()=>'',id:()=>'p1',
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),
    priceText:(v,c)=>c==='USD'?`$${v}`:`${v}원`,fxText:v=>`≈₩${v}`,
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),priceData:prices});
  for(const f of ['ma-ladder.js','prices.js','assets-calc.js','stock-names.js','item-search.js','rebuy.js','trade-alerts.js','plans.js'])vm.runInContext(read(f),ctx);
  const before=JSON.stringify(ctx.state);ctx.renderPlans();
  assert.equal(JSON.stringify(ctx.state),before,'선 줄을 그려도 기록은 바뀌지 않는다');
  const rows=els.planMain.innerHTML.match(/<div id="saleRows">[\s\S]*<\/div>(?=<div class="completed-fold-empty">|<\/section>)/)?.[0]||'';
  // 표 순서: 선 줄은 '|선 이름 가격', 회차는 'N회 가격'
  return [...rows.matchAll(/<div class="sale-line-mark([^"]*)"[^>]*>(.*?)<\/div>|<span class="purchase-round"><b>(\d+회)<\/b>[\s\S]*?<span class="price[^"]*">([^<]+)<\/span>/g)]
    .map(m=>m[3]?`${m[3]} ${m[4]}`:`|${m[1].trim()?`(${m[1].trim()}) `:''}${[...m[2].matchAll(/<b>([^<]+)<\/b>([^<]+)/g)].map(x=>`${x[1]} ${x[2]}`).join(', ')}`);
}

test('같은 간격 회차는 그대로 두고 시작·종료 기준가 사이의 일·주·월선을 처음 닿는 회차 앞에 보인다',()=>{
  assert.deepEqual(draw(plan()),['1회 $100','|80일선 $97.5','2회 $95','|25주선 $94, 125일선 $93, 150일선 $92.9','3회 $90','4회 $85','5회 $80'],
    '시작선(60일선)·종료선(25개월선)·60분봉 25선·범위 밖 32개월선은 빼고, 같은 회차 앞의 선은 가까운 순서로 한 줄');
  assert.deepEqual(draw(plan({stages:3,checked:[false,false,false]}),quote({...MA,'80일선':90})),['1회 $100','|25주선 $94, 125일선 $93, 150일선 $92.9, 80일선 $90','2회 $90','3회 $80'],'회차 기준가와 같은 선은 그 회차 앞');
});

test('상승 계획은 회차 기준가가 선 이상이 되는 회차 앞에 두고, 시세가 없거나 기준가가 없으면 선 줄이 없다',()=>{
  const up=plan({startLabel:'직접',startAuto:undefined,endLabel:'32개월선',startPrice:70,endPrice:90,stages:3,checked:[false,false,false]});
  assert.deepEqual(draw(up,quote({...MA,'32개월선':90})),['1회 $70','|25월선 $80','2회 $80','3회 $90'],'월선은 N월선으로 보이고 종료선(32개월선)은 뺀다');
  assert.deepEqual(draw(plan(),null),['1회 $100','2회 $95','3회 $90','4회 $85','5회 $80']);
  const waiting=plan({startPrice:undefined});
  assert.equal(draw(waiting).some(x=>x.startsWith('|')),false);
});

test('바로 다음 회차가 매도 완료면 선 줄도 완료로 표시해 완료 회차와 함께 접힌다',()=>{
  const p=plan({checked:[true,true,false,false,false],fills:{0:{price:100,plannedQty:2,qty:2},1:{price:95,plannedQty:2,qty:2}}});
  assert.deepEqual(draw(p).filter(x=>x.startsWith('|')),['|(done) 80일선 $97.5','|25주선 $94, 125일선 $93, 150일선 $92.9']);
  assert.match(fs.readFileSync(path.join(__dirname,'../css/purchases.css'),'utf8'),/\.purchase-table\.hide-completed \.sale-line-mark\.done\{display:none\}/);
});
