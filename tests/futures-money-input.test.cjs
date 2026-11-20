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
    save:(next=c.state)=>{stored.set('etf-exit-planner-standalone-v1',JSON.stringify(next));c.state=next;return true;},
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

function openNewStopPlan({unlinked=false,legacy=false,mode='fresh'}={}){
  const f=future();
  f.rebuy.contracts=12;
  f.rebuy.cuts=[{contracts:4,price:1399,targetPrice:1400,month:'202612',settlementPrice:1450}];
  if(legacy){
    f.rebuy.returns=[{done:true,contracts:3,execPrice:1325}];
  }else{
    f.rebuy.stages[0].buys=[{contracts:3,price:1325,partial:true,plannedQty:4,...(unlinked?{}:{month:'202612'})}];
  }
  f.rebuy.notify={cuts:true,buys:true};
  const r=setup(f),archive=[];
  r.c.absorbPlanner=()=>false;
  r.c.dataSnapshot=()=>JSON.stringify(r.c.state);
  r.c.backupRecord=(snapshot,reason)=>archive.push({snapshot:JSON.parse(snapshot),reason});
  r.c.renderFutures();
  r.el('frEdit').onclick();
  assert.equal(r.input('[data-fr-field="lowPrice"]').disabled,false);
  r.el('frNewPlan').onclick();
  assert.equal(r.el('frNewMode').value,'continue','기본은 평균 손절가·미복원 이어가기');
  if(mode!=='continue')r.change('#frNewMode',mode);
  return {...r,archive,enterPrices(){r.type('[data-fr-field="lowPrice"]','1380');r.type('[data-fr-field="floorPrice"]','1280');}};
}

test('재매수 중 손절 기준 수정 창은 보관 없이 바로 저장하고 체결·재매수 기록은 그대로 둔다',()=>{
  const f=future();f.rebuy.contracts=12;
  f.rebuy.cuts=[{contracts:4,price:1399,targetPrice:1400,month:'202612',settlementPrice:1450}];
  f.rebuy.stages[0].buys=[{contracts:3,price:1325,month:'202612'}];
  const r=setup(f),archive=[];r.c.backupRecord=(snapshot,reason)=>archive.push(reason);r.c.renderFutures();
  const cuts=JSON.stringify(f.rebuy.cuts),stages=JSON.stringify(f.rebuy.stages),tranches=JSON.stringify(plain(r.c.futureRebuySummary(f).tranches));
  r.el('frEdit').onclick();
  assert.match(r.el('futureRebuyDialog').innerHTML,/손절 기준 수정<\/h2>/);
  for(const key of ['lowPrice','floorPrice','contracts','sellPct','steps'])assert.equal(r.input(`[data-fr-field="${key}"]`).disabled,false,key);
  assert.equal(r.el('frFloorUnit').disabled,false);
  assert.match(r.el('futureRebuyDialog').innerHTML,/class="dialog-foot"><button[^>]*id="frNewPlan"[^>]*>새 손절 계획</,'새 손절 계획 버튼은 아래 버튼 줄에 남긴다');
  assert.doesNotMatch(r.el('futureRebuyDialog').innerHTML,/새 신저점으로 손절을 처음부터/,'버튼 설명 문구는 없앤다');
  r.type('[data-fr-field="lowPrice"]','1380');r.type('[data-fr-field="floorPrice"]','1280');r.type('[data-fr-field="steps"]','3');
  r.submit('futureRebuyForm');
  const saved=r.saved().futures.rebuy;
  assert.deepEqual([saved.lowPrice,saved.floorPrice,saved.steps],[1380,1280,3]);
  assert.equal(JSON.stringify(saved.cuts),cuts);assert.equal(JSON.stringify(saved.stages),stages);
  assert.equal(JSON.stringify(plain(r.c.futureRebuySummary(r.saved().futures).tranches)),tranches,'남은 재매수 회차는 그대로');
  assert.deepEqual(archive,[],'보관 기록을 만들지 않는다');assert.equal(r.el('futureRebuyDialog').open,false);
  r.el('frEdit').onclick();r.type('[data-fr-field="contracts"]','7');r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/이미 손절한 4계약보다 작아집니다/);assert.equal(r.saved().futures.rebuy.contracts,12);
});

test('이어서 새 손절은 평균 손절가·미복원 계약·재매수 계획을 유지하고 늘어난 보유로 손절 회차를 1회부터 다시 짠다',()=>{
  // 이탈 전 14계약에서 4계약 손절·1계약 재매수 뒤 추가매수로 20계약이 된 경우: 신저점 1,350 → 하단 1,280까지 20계약의 72%를 다시 손절한다.
  const f=future();f.positions[0].contracts=20;Object.assign(f.rebuy,{contracts:14,steps:5,notify:{cuts:true,buys:true}});
  f.rebuy.cuts=[{contracts:2,price:1399.5,targetPrice:1400,month:'202612',settlementPrice:1450},{contracts:2,price:1374.8,targetPrice:1375,month:'202612',settlementPrice:1450}];
  f.rebuy.stages[0].buys=[{contracts:1,price:1321,month:'202612'}];
  const r=setup(f),archive=[];r.c.absorbPlanner=()=>false;r.c.dataSnapshot=()=>JSON.stringify(r.c.state);r.c.backupRecord=(snapshot,reason)=>archive.push(reason);
  const before=r.c.futureRebuySummary(f),stages=JSON.stringify(f.rebuy.stages),cuts=JSON.stringify(f.rebuy.cuts),tranches=JSON.stringify(plain(before.tranches));
  assert.deepEqual([before.sold,before.rebought,before.rest],[4,1,3]);
  const base=r.c.futureContinueStopBase({...f,rebuy:{...f.rebuy,floorLine:'60일선',auto:{floorPrice:1300}}}).rebuy;
  for(const key of ['lowPrice','floorPrice','floorLine','contracts','sellPct','steps'])assert.equal(Object.hasOwn(base,key),false,`이어가기는 옛 손절 기준 ${key}를 비운다`);
  assert.equal(Object.hasOwn(base.auto,'floorPrice'),false);assert.equal(base.currentPrice,1350,'현재 환율은 유지');
  r.c.renderFutures();r.el('frEdit').onclick();r.el('frNewPlan').onclick();
  assert.equal(r.input('[data-fr-field="contracts"]').value,'20','늘어난 현재 보유로 시작한다');
  assert.match(r.el('futureRebuyDialog').innerHTML,/id="frSubmit"[^>]*>이어서 시작</);
  r.type('[data-fr-field="lowPrice"]','1350');r.type('[data-fr-field="floorPrice"]','1280');r.type('[data-fr-field="sellPct"]','72');r.type('[data-fr-field="steps"]','5');
  r.submit('futureRebuyForm');
  const live=r.c.state.futures,g=r.saved().futures,s=r.c.futureRebuySummary(g);
  assert.deepEqual(plain(g.rebuy.cutRestart),{at:2,rebought:1});
  assert.deepEqual([g.rebuy.lowPrice,g.rebuy.floorPrice,g.rebuy.contracts,g.rebuy.sellPct,g.rebuy.steps],[1350,1280,20,72,5]);
  assert.equal(JSON.stringify(g.rebuy.cuts),cuts,'지난 손절 기록은 그대로');assert.equal(JSON.stringify(g.rebuy.stages),stages,'재매수 단계·체결은 그대로');
  assert.deepEqual(g.rebuy.notify,{cuts:true,buys:true},'알림 설정도 이어 간다');assert.deepEqual(archive,['달러선물 손절 이어서 시작 전']);
  assert.deepEqual([s.sold,s.cutSold,s.rebought,s.rest,s.sellAvg,s.goal,s.held],[4,0,1,3,before.sellAvg,14,20]);
  assert.equal(JSON.stringify(plain(s.tranches)),tranches,'남은 재매수 회차·계약은 그대로');
  assert.deepEqual(plain(s.cuts.map(c=>[c.k,c.round,c.price,c.qty])),[[3,1,1350,3],[4,2,1332.5,3],[5,3,1315,2],[6,4,1297.5,3],[7,5,1280,3]],'20계약 × 72% = 14계약을 신저점부터 1회로 다시 나눈다');
  r.c.renderFutures();
  assert.match(r.el('futureRebuyPanel').innerHTML,/이전 손절 4계약은 평균 손절가와 남은 재매수에 이어서 반영합니다/);
  assert.match(r.el('futureRebuyPanel').innerHTML,/data-fcut="2"[^>]*aria-label="1회 손절 완료"/,'cuts 위치 2의 회차를 1회로 보인다');
  // 새로 손절한 계약은 평균 손절가와 남은 재매수에 더한다.
  assert.notEqual(r.c.setFutureCutChecked(live,2,true),false);
  const after=r.c.futureRebuySummary(live);
  assert.deepEqual([after.sold,after.cutSold,after.rest,after.held],[7,3,6,17]);
  assert.ok(Math.abs(after.sellAvg-(before.sellAvg*4+1350*3)/7)<1e-9,'평균 손절가는 지난 손절과 새 손절의 계약 가중평균');
  const rules=plain(r.c.buildTradeAlertRules({futures:live},null)).filter(x=>x.id.includes(':cut:'));
  assert.equal(rules[0].id.endsWith(':cut:3'),true,'알림 키는 cuts 위치라 지난 손절 알림 이력과 겹치지 않는다');assert.match(JSON.stringify(rules[0]),/달러선물 손절 2회/);
  // 손절 목표는 이번 계획에서 판 계약과만 비교한다(지난 4계약은 세지 않는다).
  assert.notEqual(r.c.setFutureRebuyField(live,'sellPct','20'),false);assert.equal(r.c.futureRebuySummary(live).goal,4);
  assert.equal(r.c.setFutureRebuyField(live,'sellPct','10'),false,'목표 2계약 < 이번 계획에서 판 3계약');
});

test('보관 후 새 손절 계획은 이전 체결 원본과 현재 보유·정산손익을 보존하고 새 손절 회차만 시작한다',()=>{
  const r=openNewStopPlan(),before=plain(r.c.state);
  assert.equal(r.input('[data-fr-field="contracts"]').value,'8');
  assert.match(r.el('frNewGoal').textContent,/손절 목표 4계약 · 4회/);
  assert.match(r.el('futureRebuyDialog').innerHTML,/손절 4계약 · 재매수 3계약 · 미복원 1계약/);
  assert.match(r.el('futureRebuyDialog').innerHTML,/새 계획의 알림은 꺼진 상태로 시작합니다\. 분할 손절 표에서 알림을 켜세요\./);
  r.enterPrices();r.type('[data-fr-field="steps"]','2');
  assert.match(r.el('frNewGoal').textContent,/손절 목표 4계약 · 2회/);
  r.submit('futureRebuyForm');
  assert.deepEqual(r.archive.map(x=>x.snapshot),[before]);
  const {rebuy,...savedFutures}=r.saved().futures;
  const {rebuy:oldRebuy,...oldFutures}=before.futures;
  assert.deepEqual(savedFutures,oldFutures);
  assert.deepEqual(r.archive[0].snapshot.futures.rebuy,oldRebuy);
  assert.equal(rebuy.contracts,8);assert.equal(rebuy.currentPrice,1350);
  assert.deepEqual([rebuy.lowPrice,rebuy.floorPrice,rebuy.steps],[1380,1280,2]);
  assert.equal(Object.hasOwn(rebuy,'notify'),false);
  const s=r.c.futureRebuySummary(r.saved().futures);
  assert.equal(s.started,false);assert.equal(s.rest,0);
  assert.deepEqual(plain(s.cuts.map(c=>[c.price,c.qty])),[[1380,2],[1280,2]]);
  assert.equal(r.el('futureRebuyDialog').open,false);
});

test('새 손절 계획 취소 또는 손절 목표 0계약은 현재 계획과 보관 기록을 유지한다',()=>{
  const r=openNewStopPlan(),before=plain(r.c.state);
  r.enterPrices();r.type('[data-fr-field="sellPct"]','0');r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/1계약 이상/);
  assert.equal(r.el('futureRebuyDialog').open,true);
  r.input('[data-close-future-rebuy]').onclick();
  assert.equal(r.el('futureRebuyDialog').open,false);
  assert.deepEqual(plain(r.c.state),before);assert.deepEqual(r.archive,[]);assert.equal(r.stored.size,0);
});

for(const options of [{unlinked:true},{legacy:true}])test(`새 손절 계획은 보유 미반영 ${options.legacy?'옛 복귀':'부분 재매수'} 기록이 있으면 전환을 막는다`,()=>{
  const r=openNewStopPlan(options),before=plain(r.c.state);
  assert.match(r.el('futureRebuyDialog').innerHTML,/보유 미반영 체결/);
  assert.equal(r.input('#futureRebuyForm button[type="submit"]').disabled,true);
  r.enterPrices();r.submit('futureRebuyForm');
  assert.deepEqual(plain(r.c.state),before);assert.deepEqual(r.archive,[]);assert.equal(r.stored.size,0);
  r.change('#frNewMode','continue');assert.equal(r.input('#futureRebuyForm button[type="submit"]').disabled,false,'이어가기는 기록을 그대로 두므로 시작할 수 있다');
});

function refreshStopPlanPrices(r){
  r.c.priceData={updatedAt:'2026-11-19T02:00:00Z',stocks:{},futures:{'202612':{asOf:'2026-11-19',close:1361.5,ma:{'25선':1317}}}};
  assert.equal(r.c.fillPrices(r.c.state,r.c.priceData),true);
  assert.equal(r.c.state.futures.rebuy.currentPrice,1361.5);
  assert.equal(r.c.state.futures.rebuy.stages[0].price,1317);
}

test('새 손절 기준을 입력하는 동안 시세만 바뀌면 최신 시세를 반영해 전환한다',()=>{
  const r=openNewStopPlan();
  r.enterPrices();refreshStopPlanPrices(r);
  const refreshed=plain(r.c.state);
  r.submit('futureRebuyForm');
  assert.equal(r.el('futureRebuyError').textContent,'');
  assert.equal(r.el('futureRebuyDialog').open,false);
  assert.deepEqual(r.archive.map(x=>x.snapshot),[refreshed]);
  assert.equal(r.saved().futures.rebuy.currentPrice,1361.5);
  assert.deepEqual(r.saved().futures.positions,refreshed.futures.positions);
});

test('새 손절 기준을 입력하는 동안 시세와 다른 탭의 보유가 함께 바뀌면 전환을 막는다',()=>{
  const r=openNewStopPlan();
  refreshStopPlanPrices(r);
  r.c.absorbPlanner=()=>{r.c.state.futures.positions[0].contracts=9;return true;};
  r.enterPrices();r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/달러선물 기록이 바뀌었습니다/);
  assert.equal(r.c.state.futures.positions[0].contracts,9);
  assert.equal(r.c.state.futures.rebuy.lowPrice,1400);assert.deepEqual(r.archive,[]);assert.equal(r.stored.size,0);
});

test('새 손절 기준을 입력하는 동안 시세와 재매수 체결 환율이 함께 바뀌면 전환을 막는다',()=>{
  const r=openNewStopPlan();
  refreshStopPlanPrices(r);
  r.c.state.futures.rebuy.stages[0].buys[0].price=1326;
  r.enterPrices();r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/달러선물 기록이 바뀌었습니다/);
  assert.equal(r.c.state.futures.rebuy.stages[0].buys[0].price,1326);
  assert.deepEqual(r.archive,[]);assert.equal(r.stored.size,0);
});

test('이전 손절 계획을 보관하지 못하면 새 계획을 저장하지 않는다',()=>{
  const r=openNewStopPlan(),before=plain(r.c.state);
  r.c.backupRecord=()=>{throw Error('quota');};
  r.enterPrices();r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/보관하지 못했습니다/);
  assert.equal(r.el('futureRebuyDialog').open,true);
  assert.deepEqual(plain(r.c.state),before);assert.equal(r.stored.size,0);
});

test('새 손절 계획 저장에 실패하면 기존 계획을 유지하고 다시 시도할 때 같은 보관본을 중복 생성하지 않는다',()=>{
  const r=openNewStopPlan(),before=plain(r.c.state),save=r.c.save;
  r.c.save=()=>false;
  r.enterPrices();r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/저장하지 못했습니다/);
  assert.equal(r.el('futureRebuyDialog').open,true);assert.deepEqual(plain(r.c.state),before);
  assert.deepEqual(r.archive.map(x=>x.snapshot),[before]);
  r.c.save=save;r.submit('futureRebuyForm');
  assert.deepEqual(r.archive.map(x=>x.snapshot),[before]);
  assert.equal(r.saved().futures.rebuy.lowPrice,1380);
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

test('목표환율 이평선 선택은 선 이름과 대체값만 저장하고 시세를 따라가며 월봉 부족만 현물로 보완한다',()=>{
  const prices={updatedAt:'2026-11-13T01:00:00Z',futures:{'202612':{kind:'달러선물',close:1400,asOf:'2026-11-13',ma:{'25일선':1451.2345}}},fx:{USDKRW:{kind:'현물환율',close:1400,asOf:'2026-11-13',ma:{'25일선':1300,'25개월선':1420.125}}}};
  const r=setup(future(),etf(),prices);r.c.renderFutures();const before=JSON.stringify(r.f);r.c.renderFutures();assert.equal(JSON.stringify(r.f),before);
  assert.match(r.el('futuresView').innerHTML,/25월선 따라가기 · 1,420.1원 · 현물/);assert.equal(r.el('ftargetLine').value,'');
  assert.doesNotMatch(r.el('futuresView').innerHTML,/자동 추종|가져오기/);
  r.change('#ftargetLine','25일선');assert.equal(r.f.targetPrice,1451.2);assert.equal(r.f.targetLine,'25일선');
  assert.equal(r.saved().futures.targetPrice,1451.2);assert.equal(r.saved().futures.targetLine,'25일선');
  const expected=JSON.parse(before);expected.targetPrice=1451.2;expected.targetLine='25일선';assert.deepEqual(plain(r.f),expected,'선택 설정·체결은 바꾸지 않음');
  // 시세가 바뀌면 화면·계산은 새 값을 따라가고, 렌더만으로 기록·저장은 바뀌지 않는다.
  const savedText=r.stored.get('etf-exit-planner-standalone-v1');
  prices.futures['202612'].ma['25일선']=1499.06;r.c.renderFutures();
  assert.equal(r.f.targetPrice,1451.2);assert.equal(r.stored.get('etf-exit-planner-standalone-v1'),savedText);
  assert.equal(r.c.futureTargetOf(r.f),1499.1);assert.equal(r.input('#ftarget').value,'1,499.1');assert.equal(r.el('ftargetLine').value,'25일선');
  assert.equal(r.c.futuresSummary(r.f).current,r.c.futuresSummary(r.f,1499.1).current);
  assert.equal(r.c.futureLadder(r.f).rows.find(x=>x.kind==='target').price,1499.1);
  // 매수 표 회차 기대손익도 같은 추종 목표 환율을 쓴다(미매수 1,354.91원 회차).
  const buyTable=r.el('futuresView').innerHTML;
  assert.match(buyTable,/목표 환율 1,499.1원 기준/);assert.match(buyTable,new RegExp(`기대손익 ${Math.round((1499.1-1354.91)*10000)}원`));
  assert.doesNotMatch(buyTable,new RegExp(`기대손익 ${Math.round((1451.2-1354.91)*10000)}원`));
  r.change('#ftargetLine','25개월선');assert.equal(r.f.targetPrice,1420.1);assert.equal(r.f.targetLine,'25개월선');assert.equal(r.saved().futures.targetPrice,1420.1);
  const saved=JSON.stringify(r.f);r.change('#ftargetLine','없는 선');assert.equal(JSON.stringify(r.f),saved);
});

test('목표환율 직접 입력·직접 입력 선택은 기준선을 지워 숫자로 고정하고 시세 없는 기준선은 대체값을 쓴다',()=>{
  const prices={futures:{'202612':{kind:'달러선물',close:1400,asOf:'2026-11-13',ma:{'25일선':1451.2345}}}};
  let r=setup(future(),etf(),prices);r.c.renderFutures();r.change('#ftargetLine','25일선');
  prices.futures['202612'].ma['25일선']=1460.04;r.c.renderFutures();
  r.change('#ftargetLine','');assert.equal(Object.hasOwn(r.f,'targetLine'),false);assert.equal(r.f.targetPrice,1460);assert.equal(r.saved().futures.targetPrice,1460);
  prices.futures['202612'].ma['25일선']=1470;r.c.renderFutures();assert.equal(r.c.futureTargetOf(r.f),1460,'고정 후에는 따라가지 않음');
  r.change('#ftargetLine','25일선');r.type('#ftarget','1500');r.change('#ftarget');
  assert.equal(Object.hasOwn(r.f,'targetLine'),false);assert.equal(r.f.targetPrice,1500);assert.equal(Object.hasOwn(r.saved().futures,'targetLine'),false);
  // 빈 값·0·음수 입력은 기준선·숫자를 바꾸거나 저장하지 않는다.
  r.change('#ftargetLine','25일선');
  const savedText=r.stored.get('etf-exit-planner-standalone-v1');let writes=0;const save=r.c.save;r.c.save=(...a)=>{writes++;return save(...a);};
  for(const bad of ['','0','-100']){r.type('#ftarget',bad);r.change('#ftarget');assert.equal(r.f.targetLine,'25일선',bad);assert.equal(r.f.targetPrice,1470,bad);}
  assert.equal(writes,0,'빈 값·0·음수는 저장하지 않음');assert.equal(r.stored.get('etf-exit-planner-standalone-v1'),savedText);assert.equal(r.input('#ftarget').value,'1,470');
  // 저장된 선의 시세가 없으면 targetPrice를 쓰고 선택 상태를 '시세 없음'으로 보인다.
  const f=future();f.targetLine='60일선';f.targetPrice=1444.4;r=setup(f,etf(),prices);r.c.renderFutures();
  assert.equal(r.c.futureTargetOf(f),1444.4);assert.equal(r.el('ftargetLine').value,'60일선');assert.match(r.el('futuresView').innerHTML,/60일선 따라가기 · 시세 없음/);
  assert.equal(r.el('ftargetLine').disabled,false);
  // 옛 기록(targetLine 없음)은 렌더로 필드를 만들지 않는다.
  const old=future();r=setup(old,etf(),prices);r.c.renderFutures();assert.equal(Object.hasOwn(old,'targetLine'),false);assert.equal(r.c.futureTargetOf(old),1480);
});

test('재매수 해제·수량·환율 수정에서 평균가 계산이 거절되면 안내하고 저장하지 않는다',()=>{
  const f=future();
  f.positions=[{month:'202612',contracts:7,settlementPrice:1000}];
  f.rebuy.contracts=16;
  f.rebuy.cuts=[{contracts:8,price:1500,targetPrice:1500}];
  f.rebuy.stages[0].buys=[{contracts:6,price:1450,month:'202612'}];
  const r=setup(f),alerts=[];
  r.c.alert=message=>alerts.push(message);
  r.c.renderFutures();
  const before=JSON.stringify(f),check='[data-fbuy="0:0"]';
  const input=r.input(check);input.checked=false;input.onchange();
  assert.equal(r.input(check).checked,true);
  r.type('[data-fbuy-qty="0:0"]','1');r.change('[data-fbuy-qty="0:0"]');
  r.type('[data-fbuy-exec="0:0"]','200');r.change('[data-fbuy-exec="0:0"]');
  assert.equal(alerts.length,3);
  for(const message of alerts)assert.match(message,/보유 단순평균가와 체결 환율을 확인하세요/);
  assert.equal(r.stored.size,0);
  assert.equal(JSON.stringify(f),before);
});

test('재매수 해제로 평균가가 0이면 확인 창 없이 체크와 원본 전체를 유지한다',()=>{
  const f=future();
  f.positions=[{month:'202612',contracts:7,settlementPrice:1200}];
  f.rebuy.contracts=16;f.rebuy.cuts=[{contracts:8,price:1500,targetPrice:1500}];
  f.rebuy.stages[0].buys=[{contracts:6,price:1400,month:'202612'}];
  const r=setup(f),alerts=[];
  r.c.confirm=()=>assert.fail('계산을 거절할 때는 확인 창을 열지 않는다');
  r.c.alert=message=>alerts.push(message);r.c.renderFutures();
  const before=JSON.stringify(f),selector='[data-fbuy="0:0"]';
  const input=r.input(selector);input.checked=false;input.onchange();
  assert.equal(r.input(selector).checked,true);
  assert.deepEqual(alerts,['보유 단순평균가와 체결 환율을 확인하세요.']);
  assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);
});

test('신규 재매수의 평균가가 잘못되면 경고하고 체크와 원본 전체를 유지한다',()=>{
  const f=future();
  f.positions=[{month:'202612',contracts:20,settlementPrice:-90}];
  f.rebuy={lowPrice:1400,floorPrice:1300,contracts:20,sellPct:50,steps:2,currentPrice:1310,
    cuts:[{contracts:2,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}],
    stages:[{name:'25선',price:1320},{name:'32선',price:1330}]};
  const r=setup(f),alerts=[];r.c.alert=message=>alerts.push(message);r.c.renderFutures();
  const before=JSON.stringify(f),selector='[data-fbuy="0:0"]';
  const input=r.input(selector);assert.equal(input.disabled,false);input.checked=true;input.onchange();
  assert.equal(r.input(selector).checked,false);
  assert.deepEqual(alerts,['202612 보유의 계약 수·단순평균가가 비어 있거나 잘못됐습니다. 보유·계산 기준에서 계좌와 맞게 고친 뒤 다시 하세요.'],'보유 평균가가 음수면 보유를 고치게 안내');
  assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);
});

test('신규 분할매수로 평균가가 음수가 되면 체크와 원본 전체를 유지한다',()=>{
  const f=future();
  f.positions=[{month:'202612',contracts:20,settlementPrice:-90}];
  f.levels[0].tranches[0].price=1320;
  const r=setup(f),alerts=[];r.c.alert=message=>alerts.push(message);r.c.renderFutures();
  const before=JSON.stringify(f),selector='[data-tranche-check="0:0"]';
  r.input('[data-tranche-month="0:0"]').value='202612';
  const input=r.input(selector);input.checked=true;input.onchange();
  assert.equal(r.input(selector).checked,false);
  assert.deepEqual(alerts,['202612 보유의 계약 수·단순평균가가 비어 있거나 잘못됐습니다. 보유·계산 기준에서 계좌와 맞게 고친 뒤 다시 하세요.']);
  assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);
});

test('체결 환율 칸을 비우면 옛 returns 기록을 유지하고 값을 복원한다',()=>{
  const f=future();
  f.rebuy={cuts:[{contracts:4,price:1400,targetPrice:1400}],returns:[{done:true,contracts:3,execPrice:1325}]};
  const r=setup(f),alerts=[];r.c.alert=message=>alerts.push(message);r.c.renderFutures();
  const before=JSON.stringify(f),selector='[data-fbuy-exec="0:0"]';
  r.type(selector,'');r.change(selector);
  assert.equal(r.stored.size,0);
  assert.equal(JSON.stringify(f),before);
  assert.equal(r.input(selector).value,'1,325');
  assert.deepEqual(alerts,['보유 단순평균가와 체결 환율을 확인하세요.']);
});

test('산 분할매수 체크를 풀 때 잘못된 단순평균가가 되면 체크와 보유를 보존한다',()=>{
  const f=future(),t=f.levels[0].tranches[1];
  f.positions=[{month:'202612',contracts:2,settlementPrice:1000}];t.executionPrice=2500;
  const r=setup(f),alerts=[];r.c.alert=message=>alerts.push(message);r.c.renderFutures();
  const before=JSON.stringify(f),input=r.input('[data-tranche-check="0:1"]');
  input.checked=false;input.onchange();
  assert.equal(input.checked,true);
  assert.equal(r.stored.size,0);
  assert.equal(JSON.stringify(f),before);
  assert.deepEqual(alerts,['보유 단순평균가와 체결 환율을 확인하세요.']);
});

test('목표환율 이평선 적용 직후 정수·0.1 단위 수동 재입력은 저장되고 단위 밖 입력은 거부된다',()=>{
  const prices={futures:{'202612':{kind:'달러선물',close:1400,asOf:'2026-11-13',ma:{'25일선':1451.2345}}},fx:{USDKRW:{kind:'현물환율',close:1400,asOf:'2026-11-13',ma:{'25개월선':1420.125}}}};
  for(const [line,value] of [['25일선',1451.2],['25개월선',1420.1]]){
    const r=setup(future(),etf(),prices);r.c.renderFutures();r.change('#ftargetLine',line);
    assert.equal(r.c.moneyInputNumber(r.input('#ftarget').defaultValue),value);assert.equal(r.input('#ftarget').getAttribute('data-money-step'),'0.1');
    for(const value of [1450,1451.5]){
      r.type('#ftarget',String(value));assert.equal(r.input('#ftarget').validationMessage,'');r.change('#ftarget');
      assert.equal(r.f.targetPrice,value);assert.equal(r.saved().futures.targetPrice,value);
    }
    rejected(r,'#ftarget',x=>r.change(x),['1354.91']);assert.equal(r.f.targetPrice,1451.5);assert.equal(r.saved().futures.targetPrice,1451.5);
  }
});

test('목표환율 이평선에 현물 일선을 선물 대신 쓰지 않고 없는 선·비정상 시세는 선택하지 않는다',()=>{
  const prices={futures:{'202612':{kind:'달러선물',close:1400,ma:{'25일선':-1,'32일선':Infinity}}},fx:{USDKRW:{kind:'현물환율',close:1400,ma:{'25일선':1300}}}};
  const r=setup(future(),etf(),prices);r.c.renderFutures();assert.equal(r.el('ftargetLine').disabled,true);
  assert.equal(r.c.futureTargetLines(prices,null).length,0);
  const before=JSON.stringify(r.f);r.change('#ftargetLine','25일선');assert.equal(JSON.stringify(r.f),before);
});

test('재매수 해제 확인 창은 월물교체 뒤 보유를 유지하는 기록 해제를 묻고 취소하면 저장하지 않는다',()=>{
  const f=future(),r=setup(f),messages=[];
  f.positions[0].month='202701';
  f.rebuy.cuts=[{contracts:2,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}];
  f.rebuy.stages[0].buys=[{contracts:1,price:1320,month:'202612'}];
  const holdings=plain(f.positions),pnl=f.baselinePnl;
  const expected='기록한 202612 월물이 없거나 보유 계약이 부족합니다.\n보유를 그대로 두고 재매수 체크만 해제할까요?';
  r.c.confirm=message=>{messages.push(message);return messages.length===2;};
  r.c.renderFutures();
  const uncheck=()=>{const input=r.input('[data-fbuy="0:0"]');input.checked=false;input.onchange();};
  uncheck();
  assert.deepEqual(messages,[expected]);
  assert.equal(r.input('[data-fbuy="0:0"]').checked,true);assert.equal(r.stored.size,0);
  uncheck();
  assert.deepEqual(messages,[expected,expected]);
  assert.equal(r.input('[data-fbuy="0:0"]').checked,false);
  assert.deepEqual(r.saved().futures.positions,holdings);
  assert.equal(r.saved().futures.baselinePnl,pnl);
  assert.equal(r.saved().futures.rebuy.stages[0].buys,undefined);
});

test('신규 분할매수 체크는 계약이 남은 보유의 단순평균가가 비정상이면 경고하고, 계약 0인 빈 행에는 첫 체결을 넣는다',()=>{
  for(const [contracts,sp] of [[2,null],[2,''],[2,0],[2,-5],[0,1],[0,null],[0,0]]){
    const f=future(),label=`${contracts}계약 평균 ${String(sp)}`;
    f.positions=[{month:'202612',contracts,settlementPrice:sp}];f.levels[0].tranches[0].price=1320;
    const r=setup(f),alerts=[];r.c.alert=message=>alerts.push(message);r.c.renderFutures();
    const before=JSON.stringify(f),selector='[data-tranche-check="0:0"]';
    r.input('[data-tranche-month="0:0"]').value='202612';
    const input=r.input(selector);input.checked=true;input.onchange();
    if(contracts){
      assert.equal(r.input(selector).checked,false,label);
      assert.deepEqual(alerts,['202612 보유의 계약 수·단순평균가가 비어 있거나 잘못됐습니다. 보유·계산 기준에서 계좌와 맞게 고친 뒤 다시 하세요.'],label);
      assert.equal(r.stored.size,0,label);assert.equal(JSON.stringify(f),before,label);
    }else{
      assert.deepEqual(alerts,[],label);
      assert.deepEqual(plain(r.saved().futures.positions),[{month:'202612',contracts:1,settlementPrice:1320}],label);
      assert.equal(r.saved().futures.levels[0].tranches[0].completed,true,label);
    }
  }
});

test('산 분할매수 체크 해제는 체결가가 비정상이거나 남은 평균가를 계산할 수 없으면 확인 창 없이 경고만 하고, 보유 전량은 확인 후 지운다',()=>{
  for(const [exec,sp] of [[0,1400],[-5,1400],[NaN,1400],[2500,1000]]){
    const f=future(),t=f.levels[0].tranches[1],label=`체결가 ${exec} 평균가 ${sp}`;
    f.positions=[{month:'202612',contracts:2,settlementPrice:sp}];t.executionPrice=exec;
    const r=setup(f),alerts=[];let confirms=0;
    r.c.confirm=()=>{confirms++;return true;};r.c.alert=message=>alerts.push(message);r.c.renderFutures();
    const before=JSON.stringify(f),input=r.input('[data-tranche-check="0:1"]');
    input.checked=false;input.onchange();
    assert.equal(confirms,0,label);
    assert.deepEqual(alerts,[exec===2500?'보유 단순평균가와 체결 환율을 확인하세요.':'기록된 체결가가 비어 있거나 잘못돼 보유에 반영할 수 없습니다. 먼저 체결가 칸을 고친 뒤 다시 하세요.'],label);
    assert.equal(input.checked,true,label);assert.equal(r.stored.size,0,label);assert.equal(JSON.stringify(f),before,label);
  }
  const f=future(),t=f.levels[0].tranches[1];
  f.positions=[{month:'202612',contracts:1,settlementPrice:1400}];t.executionPrice=0;
  const r=setup(f),alerts=[];let confirms=0;
  r.c.confirm=()=>{confirms++;return true;};r.c.alert=message=>alerts.push(message);r.c.renderFutures();
  const input=r.input('[data-tranche-check="0:1"]');input.checked=false;input.onchange();
  assert.equal(confirms,1);assert.deepEqual(alerts,[]);
  assert.deepEqual(r.saved().futures.positions,[]);assert.equal(r.saved().futures.levels[0].tranches[1].completed,false);
});

test('신규 분할매수 체크는 보유 계약이 음수인 월물이면 경고하고 체크와 원본 전체를 유지한다',()=>{
  for(const sp of [1400,0,null]){
    const f=future(),label=`평균가 ${String(sp)}`;
    f.positions=[{month:'202612',contracts:-2,settlementPrice:sp}];f.levels[0].tranches[0].price=1320;
    const r=setup(f),alerts=[];r.c.alert=message=>alerts.push(message);r.c.renderFutures();
    const before=JSON.stringify(f),selector='[data-tranche-check="0:0"]';
    r.input('[data-tranche-month="0:0"]').value='202612';
    const input=r.input(selector);input.checked=true;input.onchange();
    assert.equal(r.input(selector).checked,false,label);
    assert.deepEqual(alerts,['202612 보유의 계약 수·단순평균가가 비어 있거나 잘못됐습니다. 보유·계산 기준에서 계좌와 맞게 고친 뒤 다시 하세요.'],label);
    assert.equal(r.stored.size,0,label);assert.equal(JSON.stringify(f),before,label);
  }
});


const HOLD_WARN='202612 보유의 계약 수·단순평균가가 비어 있거나 잘못됐습니다. 보유·계산 기준에서 계좌와 맞게 고친 뒤 다시 하세요.';
const EXEC_WARN='기록된 체결가가 비어 있거나 잘못돼 보유에 반영할 수 없습니다. 먼저 체결가 칸을 고친 뒤 다시 하세요.';
const OLD_PRICE_CONFIRM='기록된 체결가가 비어 있거나 잘못돼 보유 평균가를 맞출 수 없습니다. 보유는 그대로 두고 체결가 기록만 고칠까요?\n보유 단순평균가는 보유·계산 기준에서 계좌와 맞는지 확인하세요.';
function cutView(positions,cut){
  const f=future();f.positions=positions;f.rebuy.cuts=[cut];
  const r=setup(f),alerts=[],confirms=[];r.c.alert=m=>alerts.push(m);r.c.confirm=m=>{confirms.push(m);return true;};r.c.renderFutures();
  return {r,f,alerts,confirms,before:JSON.stringify(f)};
}

test('손절 해제·체결 감소는 되돌릴 보유가 잘못됐으면 확인 창 없이 보유 안내만 하고 저장하지 않는다',()=>{
  for(const sp of [null,0,-5]){
    let v=cutView([{month:'202612',contracts:2,settlementPrice:sp}],{contracts:1,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450});
    const input=v.r.input('[data-fcut="0"]');input.checked=false;input.onchange();
    assert.deepEqual(v.confirms,[],`해제 ${sp}`);assert.deepEqual(v.alerts,[HOLD_WARN],`해제 ${sp}`);
    assert.equal(v.r.input('[data-fcut="0"]').checked,true);assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
    v=cutView([{month:'202612',contracts:2,settlementPrice:sp}],{contracts:2,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450});
    v.r.type('[data-fcut-qty="0"]','1');v.r.change('[data-fcut-qty="0"]');
    assert.deepEqual(v.confirms,[],`감소 ${sp}`);assert.deepEqual(v.alerts,[HOLD_WARN],`감소 ${sp}`);assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
  }
  const v=cutView([{month:'202612',contracts:2,settlementPrice:1400}],{contracts:1,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450});
  const input=v.r.input('[data-fcut="0"]');input.checked=false;input.onchange();
  assert.equal(v.confirms.length,1,'정상 보유는 기존대로 확인 후 되돌린다');assert.deepEqual(v.alerts,[]);
  assert.deepEqual(v.r.saved().futures.positions,[{month:'202612',contracts:3,settlementPrice:(2*1400+1450)/3}]);
});

test('재매수 해제는 보유가 잘못됐으면 보유 안내, 기록된 체결 환율이 잘못됐으면 체결가 안내를 확인 창 없이 보인다',()=>{
  for(const [sp,price,warn] of [[null,1400,HOLD_WARN],[1400,0,EXEC_WARN]]){
    const f=future();f.positions=[{month:'202612',contracts:7,settlementPrice:sp}];
    f.rebuy.contracts=16;f.rebuy.cuts=[{contracts:8,price:1500,targetPrice:1500}];f.rebuy.stages[0].buys=[{contracts:6,price,month:'202612'}];
    const r=setup(f),alerts=[];r.c.confirm=()=>assert.fail('확인 창을 열지 않는다');r.c.alert=m=>alerts.push(m);r.c.renderFutures();
    const before=JSON.stringify(f),input=r.input('[data-fbuy="0:0"]');input.checked=false;input.onchange();
    assert.deepEqual(alerts,[warn]);assert.equal(r.input('[data-fbuy="0:0"]').checked,true);assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);
  }
});

test('기록된 체결가가 잘못된 산 분할매수·재매수는 확인하면 보유는 두고 체결가 기록만 고치고, 취소하면 저장하지 않는다',()=>{
  for(const answer of [false,true]){
    const f=future(),t=f.levels[0].tranches[1];f.positions=[{month:'202612',contracts:2,settlementPrice:1400}];t.executionPrice=0;t.price=0;
    const r=setup(f),alerts=[],confirms=[];r.c.alert=m=>alerts.push(m);r.c.confirm=m=>{confirms.push(m);return answer;};r.c.renderFutures();
    const before=JSON.stringify(f);r.type('[data-future-exec="0:1"]','1460');r.change('[data-future-exec="0:1"]');
    assert.deepEqual(confirms,[OLD_PRICE_CONFIRM]);assert.deepEqual(alerts,[]);
    if(answer){assert.equal(r.saved().futures.levels[0].tranches[1].executionPrice,1460);assert.deepEqual(r.saved().futures.positions,[{month:'202612',contracts:2,settlementPrice:1400}]);}
    else{assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);}
  }
  for(const answer of [false,true]){
    const f=future();f.positions=[{month:'202612',contracts:7,settlementPrice:1400}];
    f.rebuy.contracts=16;f.rebuy.cuts=[{contracts:8,price:1500,targetPrice:1500}];f.rebuy.stages[0].buys=[{contracts:6,price:0,month:'202612'}];
    const r=setup(f),alerts=[],confirms=[];r.c.alert=m=>alerts.push(m);r.c.confirm=m=>{confirms.push(m);return answer;};r.c.renderFutures();
    const before=JSON.stringify(f);r.type('[data-fbuy-exec="0:0"]','1460');r.change('[data-fbuy-exec="0:0"]');
    assert.deepEqual(confirms,[OLD_PRICE_CONFIRM]);assert.deepEqual(alerts,[]);
    if(answer){assert.equal(r.saved().futures.rebuy.stages[0].buys[0].price,1460);assert.deepEqual(r.saved().futures.positions,[{month:'202612',contracts:7,settlementPrice:1400}]);}
    else{assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);}
  }
});

test('부분 체결 재매수 체크 실패는 기록 월물의 보유 비정상·기록 체결가 비정상을 구분해 안내하고 저장하지 않는다',()=>{
  const cases=[
    [[{month:'202612',contracts:5,settlementPrice:1400},{month:'202701',contracts:5,settlementPrice:null}],{contracts:2,price:1350,month:'202701',partial:true,plannedQty:6},HOLD_WARN.replace('202612','202701')],
    [[{month:'202612',contracts:5,settlementPrice:1400}],{contracts:2,price:0,month:'202612',partial:true,plannedQty:6},EXEC_WARN],
  ];
  for(const [positions,buy,warn] of cases){
    const f=future();f.positions=positions;f.rebuy.contracts=16;f.rebuy.cuts=[{contracts:8,price:1500,targetPrice:1500}];f.rebuy.stages[0].buys=[buy];
    const r=setup(f),alerts=[];r.c.confirm=()=>assert.fail('확인 창을 열지 않는다');r.c.alert=m=>alerts.push(m);r.c.renderFutures();
    const before=JSON.stringify(f),input=r.input('[data-fbuy="0:0"]');input.checked=true;input.onchange();
    assert.deepEqual(alerts,[warn],buy.month);assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);
  }
});

test('체결가 수정은 연결 월물의 보유 계약이 음수면 보유 안내, 월물 없음·계약 0·계약 부족이면 기존 안내를 보이고 바꾸지 않는다',()=>{
  const noMonth='202612 보유 월물이 없어 체결가를 고치지 않았습니다. 월물을 교체했다면 보유·계산 기준에서 단순평균가를 직접 고치세요.';
  for(const [positions,warn] of [[[{month:'202612',contracts:-1,settlementPrice:1400}],HOLD_WARN],[[{month:'202612',contracts:0,settlementPrice:1400}],noMonth],[[],noMonth]]){
    const f=future();f.positions=positions;
    const r=setup(f),alerts=[];r.c.alert=m=>alerts.push(m);r.c.renderFutures();
    const before=JSON.stringify(f);r.type('[data-future-exec="0:1"]','1460');r.change('[data-future-exec="0:1"]');
    assert.deepEqual(alerts,[warn],`분할매수 ${JSON.stringify(positions)}`);assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);
  }
  const short='체결 환율과 기록한 월물의 보유 계약을 확인하세요.';
  for(const [positions,warn] of [[[{month:'202612',contracts:-1,settlementPrice:1400}],HOLD_WARN],[[{month:'202612',contracts:0,settlementPrice:1400}],short],[[],short],[[{month:'202612',contracts:1,settlementPrice:1400}],short]]){
    const f=future();f.positions=positions;
    f.rebuy.contracts=16;f.rebuy.cuts=[{contracts:8,price:1500,targetPrice:1500}];f.rebuy.stages[0].buys=[{contracts:2,price:1320,month:'202612'}];
    const r=setup(f),alerts=[];r.c.alert=m=>alerts.push(m);r.c.renderFutures();
    const before=JSON.stringify(f);r.type('[data-fbuy-exec="0:0"]','1460');r.change('[data-fbuy-exec="0:0"]');
    assert.deepEqual(alerts,[warn],`재매수 ${JSON.stringify(positions)}`);assert.equal(r.stored.size,0);assert.equal(JSON.stringify(f),before);
  }
});

test('판 시점 단순평균가가 생략된 손절 기록의 해제·감소는 확인 창 없이 손절 기록 안내만 하고 저장하지 않는다',()=>{
  const warn='손절 기록의 판 시점 단순평균가나 체결 환율이 비어 있거나 잘못돼 누적 정산손익을 맞출 수 없습니다. 보유 월물·누적 정산손익은 계좌와 맞게 직접 고치세요.';
  let v=cutView([{month:'202701',contracts:3,settlementPrice:1460}],{contracts:1,price:1400,targetPrice:1400,month:'202612'});
  const input=v.r.input('[data-fcut="0"]');input.checked=false;input.onchange();
  assert.deepEqual(v.confirms,[]);assert.deepEqual(v.alerts,[warn]);assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
  v=cutView([{month:'202701',contracts:3,settlementPrice:1460}],{contracts:2,price:1400,targetPrice:1400,month:'202612'});
  v.r.type('[data-fcut-qty="0"]','1');v.r.change('[data-fcut-qty="0"]');
  assert.deepEqual(v.confirms,[]);assert.deepEqual(v.alerts,[warn]);assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
});

test('신규 분할매수 체크는 단순평균가가 생략된 계약 0인 빈 행에 첫 체결을 넣는다',()=>{
  const f=future();f.positions=[{month:'202612',contracts:0}];f.levels[0].tranches[0].price=1320;
  const r=setup(f),alerts=[];r.c.alert=m=>alerts.push(m);r.c.renderFutures();
  r.input('[data-tranche-month="0:0"]').value='202612';const input=r.input('[data-tranche-check="0:0"]');input.checked=true;input.onchange();
  assert.deepEqual(alerts,[]);assert.deepEqual(plain(r.saved().futures.positions),[{month:'202612',contracts:1,settlementPrice:1320}]);
});

const CUT_RECORD_WARN='손절 기록의 판 시점 단순평균가나 체결 환율이 비어 있거나 잘못돼 누적 정산손익을 맞출 수 없습니다. 보유 월물·누적 정산손익은 계좌와 맞게 직접 고치세요.';
test('손익을 계산할 수 없는 손절 기록은 같은 계약 수·체결 환율 수정에서 누적 정산손익을 지키고 손절 기록 안내를 보인다',()=>{
  let v=cutView([{month:'202701',contracts:3,settlementPrice:1460}],{contracts:2,price:1400,targetPrice:1400,month:'202612'});
  const pnl=v.f.baselinePnl;v.r.type('[data-fcut-qty="0"]','02');v.r.change('[data-fcut-qty="0"]');
  assert.deepEqual(v.alerts,[]);assert.equal(v.f.baselinePnl,pnl);if(v.r.stored.size)assert.equal(v.r.saved().futures.baselinePnl,pnl);
  for(const cut of [{contracts:1,price:1400,targetPrice:1400,month:'202612'},{contracts:1,month:'202612',settlementPrice:1450}]){
    v=cutView([{month:'202612',contracts:3,settlementPrice:1450}],cut);
    v.r.type('[data-fcut-price="0"]','1410');v.r.change('[data-fcut-price="0"]');
    assert.deepEqual(v.alerts,[CUT_RECORD_WARN],JSON.stringify(cut));assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
  }
});

test('체결 환율·목표가 없는 미연동 손절은 보유 월물에 반영할 때 확인 창 없이 손절 기록 안내만 하고 저장하지 않는다',()=>{
  const v=cutView([{month:'202612',contracts:4,settlementPrice:1450}],{contracts:1});
  v.r.c.$('frLink').onclick();
  assert.deepEqual(v.confirms,[]);assert.deepEqual(v.alerts,[CUT_RECORD_WARN]);assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
});

test('판 시점 단순평균가가 생략된 부분 체결 손절의 체결 증가·체크 완료는 손절 기록 안내를 보이고 저장하지 않는다',()=>{
  const cut=()=>({contracts:1,price:1400,targetPrice:1400,month:'202612',partial:true,plannedQty:2});
  let v=cutView([{month:'202612',contracts:4,settlementPrice:1450}],cut());
  v.r.type('[data-fcut-qty="0"]','2');v.r.change('[data-fcut-qty="0"]');
  assert.deepEqual(v.alerts,[CUT_RECORD_WARN]);assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
  v=cutView([{month:'202612',contracts:4,settlementPrice:1450}],cut());
  const input=v.r.input('[data-fcut="0"]');input.checked=true;input.onchange();
  assert.deepEqual(v.alerts,[CUT_RECORD_WARN]);assert.equal(v.r.stored.size,0);assert.equal(JSON.stringify(v.f),v.before);
});
