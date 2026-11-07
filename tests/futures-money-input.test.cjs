// 가상 종목·월물·금액으로 실제 템플릿, 공용 입력 이벤트, 저장 콜백을 함께 실행한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const uiDom=require('./helpers/ui-dom.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const future=()=>({targetPrice:1480,baselinePnl:-12345,positions:[{month:'202612',contracts:8,settlementPrice:1354.91}],note:'',
  levels:[{days:0,unit:'',label:'가상 기준',price:1354.91,confirmed:true,contracts:2,tranches:[{price:1354.91,completed:false},{price:1355.91,completed:true,executionPrice:1355.91,mergedMonth:'202612'}]}],
  rebuy:{lowPrice:1400,floorPrice:1300,currentPrice:1350,contracts:8,sellPct:50,steps:2,cuts:[],stages:[{name:'25선',price:1320},{name:'32선',price:1330},{name:'42선',price:1340}]}});
const etf=()=>({id:'example',name:'가상 ETF',ticker:'EXAMPLE',lowPrice:15000,currentPrice:14000,shares:200,stepPct:1,sellPct:10,steps:3,
  cuts:[{shares:100,price:14000}],stages:[{name:'25선',price:11000},{name:'32선',price:12000},{name:'42선',price:13000},{name:'60선',price:15000}],
  range:{startLine:'25선',lastLine:'42선',names:['25선','32선','42선'],lastRound:3,targetPct:100},note:''});
function setup(f=future(),r=etf(),prices=null){
  const dom=uiDom(),document=dom.document;
  dom.parse('<form id="planForm"><input name="startPrice" type="text" value="999"></form>');
  dom.parse(read('index.html').match(/<dialog id="rebuyStagesDialog"[\s\S]*?<\/dialog>/)[0]);
  const stored=new Map(),state={plans:[],futures:f,rebuy:{items:[r]},selectedRebuy:r.id};
  const c=vm.createContext({document,state,priceData:prices,contractSize:10000,PENCIL:'',
    $:document.getElementById.bind(document),$$:document.querySelectorAll.bind(document),
    esc:v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
    shown:v=>Number.isFinite(Number(v))?String(Math.round(Number(v)*1e4)/1e4):'',
    money:v=>`${Math.round(v||0)}원`,priceText:(v,c)=>`${c==='USD'?'$':''}${v}`,fxText:v=>String(v),memoCount:()=>'',
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),usd:new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
    matchMedia:()=>({matches:false}),id:()=> 'example-id',confirm:()=>true,alert:msg=>{throw Error(msg);},Event:class{constructor(type){this.type=type;}},
    save:()=>stored.set('etf-exit-planner-standalone-v1',JSON.stringify(state)),
  });
  c.onEdit=(sel,set,redraw)=>document.querySelectorAll(sel).forEach(el=>el.onchange=()=>{if(set(el.value,el)!==false)c.save();redraw?.();});
  for(const file of ['money-input.js','ma-ladder.js','prices.js','assets-calc.js','stock-names.js','item-search.js','rebuy.js','futures.js','futures-plan.js','futures-rebuy.js','trade-alerts.js','data-validation.js'])vm.runInContext(read('js/'+file),c);
  vm.runInContext('futureRebuyExpanded=true',c);
  const el=id=>document.getElementById(id),input=sel=>{const node=document.querySelector(sel);assert.ok(node,sel);return node;};
  const submit=id=>el(id).onsubmit({preventDefault(){},currentTarget:el(id)});
  return {c,f,r,el,input,stored,submit,document,type:(s,v)=>dom.type(typeof s==='string'?input(s):s,v),change:(s,v)=>dom.change(typeof s==='string'?input(s):s,v),saved:()=>JSON.parse(stored.get('etf-exit-planner-standalone-v1'))};
}
function moneyAttrs(input,min='0',step='any'){
  assert.equal(input.type,'text');assert.equal(input.inputMode,'decimal');assert.equal(input.getAttribute('autocomplete'),'off');assert.equal(input.hasAttribute('data-money'),true);
  assert.equal(input.getAttribute('data-money-min'),min);assert.equal(input.getAttribute('data-money-step'),step);
}
function rejected(r,selector,submit,values=['-1','bad','1e3']){
  const before=JSON.stringify(r.c.state);
  for(const bad of values){const node=r.input(selector);node.value=bad;submit(node);assert.equal(JSON.stringify(r.c.state),before,`${selector}: ${bad}`);assert.ok(node.validationMessage,`${selector}: ${bad}`);}
}

test('달러선물 카드의 환율·평균가·체결가·음수 금액은 숫자로 저장하고 다시 그릴 때 쉼표를 보인다',()=>{
  const r=setup();r.c.renderFutures();
  for(const [selector,get,raw] of [
    ['#ftarget',()=>r.f.targetPrice,'12345'],['#flossPrice',()=>r.f.lossPrice,'1354.91'],
    ['[data-key="settlementPrice"]',()=>r.f.positions[0].settlementPrice,'1354.91'],
    ['[data-tranche-price="0:0"]',()=>r.f.levels[0].tranches[0].price,'1354.91'],
    ['[data-future-exec="0:1"]',()=>r.f.levels[0].tranches[1].executionPrice,'1354.91'],
    ['#fpnl',()=>r.f.baselinePnl,'-12345'],['#frollSpread',()=>r.f.rollSpread,'-1354.91']
  ]){
    const node=r.input(selector);assert.equal(node.hasAttribute('data-money'),true);
    if(['#fpnl','#frollSpread'].includes(selector))assert.equal(node.inputMode,'numeric');
    r.type(node,raw);assert.equal(node.value,r.c.moneyInputText(raw));r.change(node);
    assert.equal(get(),Number(raw));assert.equal(typeof get(),'number');assert.match(r.input(selector).value,/,/);
    assert.equal(typeof r.saved().futures.targetPrice,'number');
    rejected(r,selector,x=>r.change(x),['#ftarget','#fpnl','#frollSpread'].includes(selector)?['bad','1e3']:['-1','bad','1e3']);
  }
  // 0.1 단위의 기준은 최초 value이며, min이 없는 목표 환율에 기존 음수 제한을 새로 만들지 않는다.
  rejected(r,'#ftarget',x=>r.change(x),['1354.91']);
  assert.equal(r.input('[data-key="contracts"]').type,'number');assert.equal(r.input('[data-key="contracts"]').step,'1');
});

test('달러선물 빈 선택값은 삭제하고 누적 손익·미매수가는 0, 목표 환율은 기존값을 유지한다',()=>{
  const r=setup();r.f.lossPrice=1400;r.f.rollSpread=-0.5;r.c.renderFutures();
  for(const selector of ['#flossPrice','#frollSpread','#fpnl','[data-tranche-price="0:0"]','#ftarget']){r.type(selector,'');r.change(selector);}
  assert.equal(Object.hasOwn(r.f,'lossPrice'),false);assert.equal(Object.hasOwn(r.f,'rollSpread'),false);
  assert.equal(r.f.baselinePnl,0);assert.equal(r.f.levels[0].tranches[0].price,0);assert.equal(r.f.targetPrice,1480);
});

test('달러선물 계획의 수동 기준가·자동 종료가는 숫자로 저장·재표시하고 숨긴 가격은 검사하지 않는다',()=>{
  const prices={updatedAt:"2026-11-06T00:00:00Z",stocks:{},futures:{"202612":{kind:"선물",asOf:"2026-11-06",close:1350,ma:{"25일선":1300,"60일선":1400}}}};
  const r=setup(future(),etf(),prices);r.c.openFuturePlanDialog();
  moneyAttrs(r.input('[data-future-plan-price="0"]'));r.type('[data-future-plan-price="0"]','12345');r.submit('futurePlanForm');
  assert.equal(r.f.levels[0].price,12345);r.c.openFuturePlanDialog();assert.equal(r.input('[data-future-plan-price="0"]').value,'12,345');
  rejected(r,'[data-future-plan-price="0"]',()=>r.submit('futurePlanForm'));
  r.type('[data-future-plan-price="0"]','12345');r.change('#futurePlanMode','auto');
  moneyAttrs(r.el('futureAutoEnd'),'0.0001');r.type('#futureAutoEnd','12345');r.submit('futurePlanForm');
  assert.equal(r.f.buyPlan.endPrice,12345);assert.equal(typeof r.f.buyPlan.endPrice,'number');
  r.c.openFuturePlanDialog();assert.equal(r.el('futureAutoEnd').value,'12,345');
  rejected(r,'#futureAutoEnd',()=>r.submit('futurePlanForm'),['0','bad']);
  r.type('#futureAutoEnd','-1');r.el('futureAutoEndPeriod').value='60';r.change('#futureAutoEndUnit','일선');r.submit('futurePlanForm');
  assert.equal(r.f.buyPlan.endLine,'60일선');assert.equal(r.el('futureAutoEnd').disabled,true);assert.equal(r.el('futureAutoEndPeriod').type,'number');
});

test('달러선물 손절 기준의 신저점·하단·현재 환율은 쉼표를 읽고, 닫기·재열기와 빈 값·잠긴 칸을 보존한다',()=>{
  const r=setup();r.c.openFutureRebuyDialog();
  for(const [key,raw] of [['lowPrice','12345'],['floorPrice','1354.91'],['currentPrice','1354.91']]){
    const selector=`[data-fr-field="${key}"]`;moneyAttrs(r.input(selector));r.type(selector,raw);r.submit('futureRebuyForm');
    assert.equal(r.f.rebuy[key],Number(raw));r.c.openFutureRebuyDialog();assert.match(r.input(selector).value,/,/);rejected(r,selector,()=>r.submit('futureRebuyForm'));r.type(selector,raw);
  }
  const before=JSON.stringify(r.f);r.submit('futureRebuyForm');assert.equal(JSON.stringify(r.f),before,'변경 없는 저장은 필드를 만들지 않음');
  r.c.openFutureRebuyDialog();r.type('[data-fr-field="floorPrice"]','-1');r.change('#frFloorUnit','일선');r.submit('futureRebuyForm');
  assert.equal(r.f.rebuy.floorLine,'60일선');assert.equal(r.input('[data-fr-field="floorPrice"]').disabled,true);
});

test('달러선물 재매수 종료 기준은 가격 모드만 쉼표를 쓰며 기간 전환·자동 모드가 가격 검사를 남기지 않는다',()=>{
  const r=setup();r.c.openFutureRebuyStartDialog('average');r.change('#futureRebuyEndUnit','direct');moneyAttrs(r.el('futureRebuyEndPrice'),'0.0001');
  r.type('#futureRebuyEndPrice','1354.91');assert.equal(r.el('futureRebuyEndPrice').value,'1,354.91');r.submit('futureRebuyStartForm');assert.equal(r.f.rebuy.endPrice,1354.91);
  r.c.openFutureRebuyStartDialog('average');assert.equal(r.el('futureRebuyEndPrice').value,'1,354.91');
  rejected(r,'#futureRebuyEndPrice',()=>r.submit('futureRebuyStartForm'),['0','bad']);r.type('#futureRebuyEndPrice','1354.91');
  r.change('#futureRebuyEndUnit','일선');assert.equal(r.el('futureRebuyEndPrice').hasAttribute('data-money'),false);assert.equal(r.el('futureRebuyEndPrice').type,'number');
  r.type('#futureRebuyEndPrice','60');r.change('#futureRebuyEndUnit','direct');assert.equal(r.el('futureRebuyEndPrice').value,'1,354.91','가격을 복구할 때 number 칸의 쉼표 삭제를 피함');
  r.type('#futureRebuyEndPrice','-1');r.change('#futureRebuyEndUnit','auto');r.submit('futureRebuyStartForm');assert.equal(Object.hasOwn(r.f.rebuy,'endPrice'),false);
});

test('직접 재매수의 두 환율은 0.01 단위를 검증하고 숫자로 저장·재표시한다',()=>{
  const f=future();f.rebuy.cuts=[{contracts:4,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}];
  const r=setup(f);r.c.openFutureDirectRebuyDialog();
  for(const id of ['futureDirectStart','futureDirectEnd'])moneyAttrs(r.el(id),'0.01','0.01');
  r.type('#futureDirectStart','1354.91');r.type('#futureDirectEnd','12345');r.submit('futureDirectRebuyForm');
  assert.equal(r.f.rebuy.directPlan.startPrice,1354.91);assert.equal(r.f.rebuy.directPlan.endPrice,12345);
  r.c.openFutureDirectRebuyDialog();assert.equal(r.el('futureDirectStart').value,'1,354.91');assert.equal(r.el('futureDirectEnd').value,'12,345');
  for(const id of ['futureDirectStart','futureDirectEnd']){const node=r.el(id),valid=node.value;rejected(r,'#'+id,()=>r.submit('futureDirectRebuyForm'),['0','1354.911','bad']);r.type(node,valid);}
  assert.equal(r.el('futureDirectRounds').type,'number');assert.equal(r.el('futureDirectQty').type,'number');
});

test('ETF 손절 설정의 가격과 읽기 전용 현재가는 쉼표를 보이고 신저점 빈 값은 기존처럼 0이다',()=>{
  const r=setup();r.c.renderRebuy();r.el('rRules').onclick();moneyAttrs(r.el('rLow'));assert.equal(r.el('rCurrent').value,'14,000');assert.equal(r.el('rCurrent').readOnly,true);
  r.type('#rLow','1354.91');r.submit('rebuyRuleForm');assert.equal(r.r.lowPrice,1354.91);r.el('rRules').onclick();assert.equal(r.el('rLow').value,'1,354.91');
  rejected(r,'#rLow',()=>r.submit('rebuyRuleForm'));r.type('#rLow','');r.submit('rebuyRuleForm');assert.equal(r.r.lowPrice,0);
});

test('ETF 재매수 단계 창의 다섯 가격은 그 form 안에서만 숫자로 저장하고 자동 계산·재열기도 쉼표를 보인다',()=>{
  for(const key of ['startPrice','lastPrice','nextPrice','price1','price2']){
    const r=setup();r.c.openRebuyStages();const form=r.el('rebuyStagesForm'),node=form.elements[key];moneyAttrs(node);
    // 같은 이름의 분할매도 창 값을 섞지 않는다.
    r.document.activeElement=node;r.type(node,'12345');assert.equal(node.value,'12,345');r.submit('rebuyStagesForm');
    assert.equal(r.el('planForm').elements.startPrice.value,'999');
    const stages=r.saved().rebuy.items[0].stages;
    assert.ok(stages.some(s=>s.price===12345||s.prices?.includes(12345)),key);
    r.document.activeElement=null;r.c.openRebuyStages();assert.equal(r.el('rebuyStagesForm').elements[key].value,'12,345',key);
    const before=JSON.stringify(r.c.state);r.el('rebuyStagesForm').elements[key].value='-1';r.submit('rebuyStagesForm');assert.equal(JSON.stringify(r.c.state),before,key);assert.ok(r.el('rebuyStagesForm').elements[key].validationMessage);
  }
});

test('ETF·달러선물의 회차 가격 수정은 실제 입력 처리에서 숫자로 계산하며 빈 선택 체결가는 기존대로 null이다',()=>{
  for(const kind of ['ETF','선물'])for(const key of ['base','cut','exec']){
    const f=future(),item=etf();f.rebuy.cuts=[{contracts:4,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}];
    if(key==='exec'){item.stages[0].buys=[{shares:1,price:11000}];f.rebuy.stages[0].buys=[{contracts:1,price:1320,month:'202612'}];}
    const r=setup(f,item);r.c[kind==='ETF'?'renderRebuy':'renderFutures']();
    const selector=kind==='ETF'?{base:'[data-stage-price="1"]',cut:'[data-cut-price="0"]',exec:'[data-tranche-exec="0:0"]'}[key]:{base:'[data-fbuy-price="1"]',cut:'[data-fcut-price="0"]',exec:'[data-fbuy-exec="0:0"]'}[key];
    moneyAttrs(r.input(selector));r.type(selector,'1354.91');r.change(selector);
    const source=kind==='ETF'?item:f.rebuy,value=key==='base'?source.stages[1].price:key==='cut'?source.cuts[0].price:source.stages[0].buys[0].price;
    assert.equal(value,1354.91,`${kind} ${key}`);assert.match(r.input(selector).value,/,/);rejected(r,selector,x=>r.change(x));
    if(key==='base'){r.type(selector,'');r.change(selector);assert.equal(source.stages[1].price,0);}
    if(kind==='ETF'&&key==='cut'){r.type(selector,'');r.change(selector);assert.equal(source.cuts[0].price,null);}
  }
});
