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

function openNewStopPlan({unlinked=false,legacy=false}={}){
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
  assert.equal(r.el('frRestartNote').hidden,true,'신저점을 그대로 두면 이어서 새 손절 안내가 없다');
  r.type('[data-fr-field="floorPrice"]','1280');r.type('[data-fr-field="steps"]','3');
  r.submit('futureRebuyForm');
  const saved=r.saved().futures.rebuy;
  assert.deepEqual([saved.lowPrice,saved.floorPrice,saved.steps,saved.contracts],[1400,1280,3,12]);assert.equal(Object.hasOwn(saved,'cutRestart'),false,'신저점을 그대로 두면 같은 손절 안에서 조정');
  assert.equal(JSON.stringify(saved.cuts),cuts);assert.equal(JSON.stringify(saved.stages),stages);
  assert.equal(JSON.stringify(plain(r.c.futureRebuySummary(r.saved().futures).tranches)),tranches,'남은 재매수 회차는 그대로');
  assert.deepEqual(archive,[],'보관 기록을 만들지 않는다');assert.equal(r.el('futureRebuyDialog').open,false);
  r.el('frEdit').onclick();r.type('[data-fr-field="contracts"]','7');r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/이미 손절한 4계약보다 작아집니다/);assert.equal(r.saved().futures.rebuy.contracts,12);
});

test('신저점을 바꾸면 평균 손절가·미복원 계약·재매수 계획을 유지하고 지금 보유로 손절 회차를 1회부터 다시 짠다',()=>{
  // 이탈 전 14계약(직접 입력)에서 4계약 손절·1계약 재매수 뒤 추가매수로 20계약이 된 경우: 손절 기준 수정에서 신저점 1,350 · 하단 1,280 · 비중 72%만 넣고 저장한다.
  const f=future();f.positions[0].contracts=20;Object.assign(f.rebuy,{contracts:14,steps:5,notify:{cuts:true,buys:true}});
  f.rebuy.cuts=[{contracts:2,price:1399.5,targetPrice:1400,month:'202612',settlementPrice:1450},{contracts:2,price:1374.8,targetPrice:1375,month:'202612',settlementPrice:1450}];
  f.rebuy.stages[0].buys=[{contracts:1,price:1321,month:'202612'}];
  const r=setup(f),archive=[];r.c.backupRecord=(snapshot,reason)=>archive.push(reason);
  const before=r.c.futureRebuySummary(f),stages=JSON.stringify(f.rebuy.stages),cuts=JSON.stringify(f.rebuy.cuts),tranches=JSON.stringify(plain(before.tranches));
  assert.deepEqual([before.sold,before.rebought,before.rest,before.hold],[4,1,3,14]);
  const direct=r.c.applyFutureRebuyEdits(f,{lowPrice:1350}).rebuy;
  assert.deepEqual([Object.hasOwn(direct,'contracts'),plain(direct.cutRestart)],[false,{at:2,rebought:1}],'이탈 전 계약 수를 함께 고치지 않으면 고정 값을 지워 자동으로 센다');
  r.c.renderFutures();r.el('frEdit').onclick();
  const hold=r.input('[data-fr-field="contracts"]');assert.equal(hold.value,'14');assert.equal(r.el('frRestartNote').hidden,true);
  r.type('[data-fr-field="lowPrice"]','1350');
  assert.deepEqual([r.el('frRestartNote').hidden,r.el('frHintBase').hidden],[false,true],'신저점을 바꾸면 기존 안내 대신 이어서 새 손절 안내를 보인다');
  assert.deepEqual([hold.value,hold.placeholder],['','자동 · 20계약'],'이탈 전 계약 수를 지금 보유 기준(자동)으로 바꿔 보인다');
  r.type('[data-fr-field="lowPrice"]','1400');assert.deepEqual([hold.value,r.el('frRestartNote').hidden],['14',true],'신저점을 되돌리면 원래 값');
  r.type('[data-fr-field="lowPrice"]','1350');r.type('[data-fr-field="floorPrice"]','1280');r.type('[data-fr-field="sellPct"]','72');
  r.submit('futureRebuyForm');
  const live=r.c.state.futures,g=r.saved().futures,s=r.c.futureRebuySummary(g);
  assert.deepEqual(plain(g.rebuy.cutRestart),{at:2,rebought:1});assert.equal(Object.hasOwn(g.rebuy,'contracts'),false,'고정 14계약 대신 자동');
  assert.deepEqual([g.rebuy.lowPrice,g.rebuy.floorPrice,g.rebuy.sellPct,g.rebuy.steps],[1350,1280,72,5]);
  assert.equal(JSON.stringify(g.rebuy.cuts),cuts,'지난 손절 기록은 그대로');assert.equal(JSON.stringify(g.rebuy.stages),stages,'재매수 단계·체결은 그대로');
  assert.deepEqual(g.rebuy.notify,{cuts:true,buys:true},'알림 설정도 이어 간다');assert.deepEqual(archive,[],'보관 기록 없이 바로 저장');
  assert.deepEqual([s.sold,s.cutSold,s.rebought,s.rest,s.sellAvg,s.hold,s.goal,s.held],[4,0,1,3,before.sellAvg,20,14,20]);
  assert.equal(JSON.stringify(plain(s.tranches)),tranches,'남은 재매수 회차·계약은 그대로');
  assert.deepEqual(plain(s.cuts.map(c=>[c.k,c.round,c.price,c.qty])),[[3,1,1350,3],[4,2,1332.5,3],[5,3,1315,2],[6,4,1297.5,3],[7,5,1280,3]],'20계약 × 72% = 14계약을 신저점부터 1회로 다시 나눈다');
  r.c.renderFutures();
  assert.match(r.el('futureRebuyPanel').innerHTML,/이전 손절 4계약은 평균 손절가·재매수에 포함됩니다/);
  assert.match(r.el('futureRebuyPanel').innerHTML,/data-fcut="2"[^>]*aria-label="1회 손절 완료"/,'cuts 위치 2의 회차를 1회로 보인다');
  // 새로 손절한 계약은 평균 손절가와 남은 재매수에 더하고, 기준(20)은 그대로다.
  assert.notEqual(r.c.setFutureCutChecked(live,2,true),false);
  const after=r.c.futureRebuySummary(live);
  assert.deepEqual([after.sold,after.cutSold,after.rest,after.hold,after.held],[7,3,6,20,17]);
  assert.ok(Math.abs(after.sellAvg-(before.sellAvg*4+1350*3)/7)<1e-9,'평균 손절가는 지난 손절과 새 손절의 계약 가중평균');
  const rules=plain(r.c.buildTradeAlertRules({futures:live},null)).filter(x=>x.id.includes(':cut:'));
  assert.equal(rules[0].id.endsWith(':cut:3'),true,'알림 키는 cuts 위치라 지난 손절 알림 이력과 겹치지 않는다');assert.match(JSON.stringify(rules[0]),/달러선물 손절 2회/);
  // 분할매수가 체결되면 기준이 21계약으로 늘어 목표가 15계약이 된다.
  live.levels[0].tranches[0].completed=true;
  assert.deepEqual([r.c.futureRebuySummary(live).hold,r.c.futureRebuySummary(live).goal],[21,15]);
  // 같은 손절 안의 조정(신저점 그대로)은 이번 계획에서 판 계약과만 비교한다.
  assert.notEqual(r.c.setFutureRebuyField(live,'sellPct','20'),false);assert.equal(r.c.futureRebuySummary(live).goal,4);
  assert.equal(r.c.setFutureRebuyField(live,'sellPct','10'),false,'목표 2계약 < 이번 계획에서 판 3계약');
  // 이번 계획에 손절 체결이 없으면 신저점을 바꿔도 이어서 새 손절을 만들지 않는다(오타 수정).
  const fresh=r.c.applyFutureRebuyEdits(g,{lowPrice:1360});assert.deepEqual(plain(fresh.rebuy.cutRestart),{at:2,rebought:1});
  const plan=future(),edited=r.c.applyFutureRebuyEdits(plan,{lowPrice:1390}).rebuy;
  assert.deepEqual([edited.lowPrice,edited.contracts,Object.hasOwn(edited,'cutRestart')],[1390,8,false],'체결 없는 계획의 신저점 수정은 이탈 전 계약 수·기록을 그대로 둔다');
});

// 보유 20계약 · 지난 손절 2회 4계약(월물 반영) · 재매수 buys(월물 반영) — 검토 보완 테스트 공통.
function restartPlan({buys=[],contracts}={}){
  const f=future();f.positions[0].contracts=20;Object.assign(f.rebuy,{steps:5,currentPrice:1360});delete f.rebuy.contracts;if(contracts!=null)f.rebuy.contracts=contracts;
  f.rebuy.cuts=[{contracts:2,price:1399.5,targetPrice:1400,month:'202612',settlementPrice:1450},{contracts:2,price:1374.8,targetPrice:1375,month:'202612',settlementPrice:1450}];
  if(buys.length)f.rebuy.stages[0].buys=buys;
  const r=setup(f);r.c.backupRecord=()=>{};return r;
}
const trackOf=(r,f)=>{const s=r.c.futureRebuySummary(f);return {s,html:r.c.futureRebuyTrack(f.rebuy,s,Number(f.rebuy.currentPrice),'',()=>'단계',null),
  fold:r.c.futureRebuyFoldLine(f.rebuy,s,Number(f.rebuy.currentPrice),r.c.futureRebuyLocked(f),r.c.futureCutDue(s,Number(f.rebuy.currentPrice)),r.c.futureBuyDue(s,Number(f.rebuy.currentPrice)))};};
const chipOf=html=>html.match(/buy-track-chip[^"]*">([^<]*)</)[1],countOf=html=>html.match(/fr-count"><b>(\d+)<\/b><span>\/ (\d+)계약/).slice(1).map(Number);

test('재매수 없이 손절만 한 계획을 이어서 새 손절로 바꿔도 잠금·새 손절 계획 버튼·접힌 줄 상태가 유지된다',()=>{
  const r=restartPlan();r.c.state.futures.rebuy.stages.forEach(x=>{x.price+=130;}); // 재매수 기준가를 현재 환율 위로(재매수 시점 아님)
  r.c.renderFutures();r.el('frEdit').onclick();
  r.type('[data-fr-field="lowPrice"]','1350');r.type('[data-fr-field="floorPrice"]','1280');r.submit('futureRebuyForm');
  const f=r.c.state.futures;assert.deepEqual(plain(f.rebuy.cutRestart),{at:2,rebought:0});
  assert.equal(r.c.futureRebuyLocked(f),true,'지난 손절 체결이 있으면 잠금');assert.equal(r.c.futureRebuySummary(f).cutSold,0,'이번 계획 체결은 없음');
  r.c.renderFutures();r.el('frEdit').onclick();
  assert.match(r.el('futureRebuyDialog').innerHTML,/id="frNewPlan"/);assert.match(r.el('futureRebuyDialog').innerHTML,/id="frHintBase">남은 손절 회차만 다시 나눕니다/);
  const {html,fold}=trackOf(r,f);
  assert.doesNotMatch(fold.text,/실행 전/);assert.match(fold.text,/^손절 진행 중 · 1,350원 이하 · 보유 20\/20$/);assert.equal(chipOf(html),'손절 진행 중','접힌 줄과 보유 카드 칩이 같다');
});

test('이어서 새 손절 뒤 지난 미복원 계약의 재매수 시점·체결을 보유 카드와 접힌 줄에 일관되게 보인다',()=>{
  for(const contracts of [undefined,20]){
    const r=restartPlan({buys:[{contracts:1,price:1321,month:'202612'}],contracts}),f=r.c.state.futures;
    f.rebuy=r.c.applyFutureRebuyEdits(f,{lowPrice:1350,floorPrice:1280,sellPct:72,...(contracts?{contracts}:{})}).rebuy;assert.equal(f.rebuy.contracts,contracts);
    // (a) 이번 계획 손절 0계약인데 재매수 회차 도달: 칩·말풍선·접힌 줄 모두 재매수 시점
    let t=trackOf(r,f);assert.equal(t.s.cutSold,0);
    assert.equal(chipOf(t.html),'재매수 시점');assert.match(t.html,/buy-track-chip warn/);assert.match(t.html,/class="fr-bub due">재매수 시점/);assert.match(t.fold.text,/<b>재매수 시점<\/b>/);
    // 다음 재매수 회차는 아직이지만 다른 회차가 도달했어도 칩은 접힌 줄과 같이 재매수 시점이다.
    const first=t.s.tranches.findIndex(x=>!x.done&&x.amount>0),s2={...t.s,tranches:t.s.tranches.map((x,k)=>k===first?{...x,price:1500}:x)},cur=Number(f.rebuy.currentPrice);
    assert.ok(r.c.futureBuyDue(s2,cur)&&r.c.futureBuyDue(s2,cur)!==s2.tranches[first],'다음 회차가 아닌 회차가 도달');
    assert.equal(chipOf(r.c.futureRebuyTrack(f.rebuy,s2,cur,'',()=>'단계',null)),'재매수 시점');
    assert.match(r.c.futureRebuyFoldLine(f.rebuy,s2,cur,true,null,r.c.futureBuyDue(s2,cur)).text,/<b>재매수 시점<\/b>/);
    // (b) 지난 미복원 1계약 이상을 재매수(보유 증가): 보유 칸·분모가 함께 늘어 분자가 분모를 넘지 않는다
    const tr=t.s.tranches.find(x=>!x.done&&x.amount>0);const res=r.c.setFutureBuyChecked(f,tr.i,tr.t,true);assert.notEqual(res,false,JSON.stringify({tr:plain(tr),rest:t.s.rest,res}));
    const qty=r.c.futureRebuySummary(f).rebought-1,held=f.positions.reduce((n,p)=>n+p.contracts,0);assert.equal(held,20+qty);
    t=trackOf(r,f);
    assert.deepEqual(countOf(t.html),[20+qty,20+qty],`보유 ${20+qty} / ${20+qty}계약 (${contracts?'고정':'자동'})`);
    assert.match(t.html,new RegExp(`aria-label="이탈 전 ${20+qty}계약 중 보유 ${20+qty}계약`));assert.equal((t.html.match(/<i class=/g)||[]).length,20+qty,'칸 수 = 분모');
    assert.match(t.fold.text,new RegExp(` · 보유 ${20+qty}/${20+qty}$`));
    assert.equal(t.s.hold,contracts?20:20+qty,'고정이면 손절 목표 기준은 그대로, 자동이면 늘어난 보유');
  }
});

test('이어서 새 손절 뒤 지난 재매수를 해제하면 시작 때 재매수 수를 낮추고, 다음 재매수 때 지금 보유로 다시 짠다',()=>{
  const r=restartPlan({buys:[{contracts:2,price:1321,month:'202612'}]}),f=r.c.state.futures;
  f.rebuy=r.c.applyFutureRebuyEdits(f,{lowPrice:1350,floorPrice:1280,sellPct:72}).rebuy;assert.deepEqual(plain(f.rebuy.cutRestart),{at:2,rebought:2});
  assert.notEqual(r.c.setFutureBuyChecked(f,0,0,false),false);assert.equal(f.positions[0].contracts,18);
  assert.equal(f.rebuy.cutRestart.rebought,0,'재매수 합계 이하로 맞춘다');assert.equal(r.c.futureRebuySummary(f).hold,18);
  const cut=r.c.futureRebuySummary(f).cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
  const q=cut.qty;assert.equal(f.positions[0].contracts,18-q);assert.equal(r.c.futureRebuySummary(f).hold,18);
  f.rebuy.currentPrice=1400;const tr=r.c.futureRebuySummary(f).tranches.find(x=>!x.done&&x.amount>0);assert.notEqual(r.c.setFutureBuyChecked(f,tr.i,tr.t,true),false);
  const k=r.c.futureRebuySummary(f).rebought;assert.equal(f.positions[0].contracts,18-q+k);
  assert.deepEqual([r.c.futureRebuySummary(f).hold,plain(f.rebuy.cutRestart)],[18-q+k,{at:cut.k,rebought:k}],'재매수로 보유가 늘면 그 시점 보유로 다시 짠다(미복원 제외)');
});

test('신저점을 바꾸며 이탈 전 계약 수를 직접 같은 값으로 다시 넣으면 고정으로 저장한다',()=>{
  for(const order of ['low-first','hold-first']){
    const r=restartPlan({contracts:14});r.c.renderFutures();r.el('frEdit').onclick();
    if(order==='low-first'){r.type('[data-fr-field="lowPrice"]','1350');assert.equal(r.input('[data-fr-field="contracts"]').value,'');r.type('[data-fr-field="contracts"]','14');}
    else{r.type('[data-fr-field="contracts"]','15');r.type('[data-fr-field="contracts"]','14');r.type('[data-fr-field="lowPrice"]','1350');assert.equal(r.input('[data-fr-field="contracts"]').value,'14');}
    r.submit('futureRebuyForm');const saved=r.saved().futures.rebuy;
    assert.deepEqual([saved.contracts,saved.lowPrice,saved.cutRestart?.at],[14,1350,2],order);
  }
  const r=restartPlan({contracts:14});r.c.renderFutures();r.el('frEdit').onclick();r.type('[data-fr-field="lowPrice"]','1350');r.submit('futureRebuyForm');
  assert.equal(Object.hasOwn(r.saved().futures.rebuy,'contracts'),false,'건드리지 않으면 자동');
});

test('이어서 새 손절은 지난 계획 미체결 회차의 알림 예외를 새 회차에 넘기지 않는다',()=>{
  for(const notify of [{cuts:true,cutsOverrides:{'2':false}},{cuts:false,cutsOverrides:{'0':true,'2':true,'3':true}}]){
    const r=restartPlan(),f=r.c.state.futures;f.rebuy.notify=structuredClone(notify);
    const g=r.c.applyFutureRebuyEdits(f,{lowPrice:'1350'});
    assert.equal(r.c.futureRebuyAlertEnabled(g,'cuts',2),notify.cuts,'새 1회차(cuts 위치 2)는 손절 알림 전체 설정');
    assert.deepEqual(plain(g.rebuy.notify.cutsOverrides??null),notify.cuts?null:{'0':true},'지난 회차(at 앞) 예외만 남긴다');
    for(const c of r.c.futureRebuySummary(g).cuts)assert.equal(r.c.futureRebuyAlertEnabled(g,'cuts',c.k-1),notify.cuts,`새 ${c.round}회`);
  }
});

test('자동 이탈 전 계약 수는 보유 월물에 반영되지 않은 손절 체결을 보유 변동으로 세지 않는다',()=>{
  const f=future();f.positions=[{month:'202612',contracts:3,settlementPrice:1450},{month:'202703',contracts:3,settlementPrice:1455}];
  f.rebuy={lowPrice:1400,floorPrice:1300,currentPrice:1350,sellPct:70,steps:1,cuts:[],stages:[{name:'25선',price:1320}]};
  const r=setup(f);assert.deepEqual([r.c.futureRebuySummary(f).hold,r.c.futureRebuySummary(f).goal],[6,4]);
  assert.equal(r.c.setFutureCutChecked(f,0,true),'unlinked');assert.equal(f.positions.reduce((n,p)=>n+p.contracts,0),6,'보유는 그대로');
  assert.deepEqual([r.c.futureRebuySummary(f).hold,r.c.futureRebuySummary(f).goal],[6,4],'미반영 손절은 기준을 부풀리지 않는다');
  const linked=r.c.futureRebuyLinked(f);
  if(linked)assert.deepEqual([r.c.futureRebuySummary(linked).hold,r.c.futureRebuySummary(linked).goal],[6,4],'보유 월물에 반영해도 그대로');
  r.c.markFutureRebuyManual(f);f.positions[1].contracts=0;f.positions[0].contracts=2; // 계좌대로 보유를 직접 고친 뒤 '직접 반영함'
  assert.deepEqual([r.c.futureRebuySummary(f).hold,r.c.futureRebuySummary(f).goal],[6,4],'직접 반영해도 그대로');
});

test('미반영 재매수가 있어도 이어서 새 손절 뒤 손절·반영으로는 기준이 흔들리지 않고 재매수 때 지금 보유로 다시 짠다',()=>{
  for(const reflectAfter of [false,true]){
    // 보유 20계약 + 보유에 아직 반영하지 않은 지난 재매수 1계약(기록상 보유 21계약)
    const r=restartPlan({buys:[{contracts:1,price:1321}]}),f=r.c.state.futures;
    f.rebuy=r.c.applyFutureRebuyEdits(f,{lowPrice:1350,floorPrice:1280,sellPct:72}).rebuy;
    assert.deepEqual(plain(f.rebuy.cutRestart),{at:2,rebought:1},'시작 재매수 수는 체결 기록 기준');
    const base=r.c.futureRebuySummary(f).hold;assert.equal(base,21,'미반영 재매수도 기록대로 보유로 본다');
    if(reflectAfter){r.c.markFutureRebuyManual(f);f.positions[0].contracts+=1;assert.equal(r.c.futureRebuySummary(f).hold,base,'지난 재매수를 반영해도 그대로');}
    const cut=r.c.futureRebuySummary(f).cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
    assert.equal(r.c.futureRebuySummary(f).hold,base,'손절 체결로 바뀌지 않는다');
    f.rebuy.currentPrice=1400;const tr=r.c.futureRebuySummary(f).tranches.find(x=>!x.done&&x.amount>0);assert.notEqual(r.c.setFutureBuyChecked(f,tr.i,tr.t,true),false);
    const s=r.c.futureRebuySummary(f);assert.equal(f.rebuy.cutRestart.at,cut.k);
    assert.equal(s.hold,f.positions[0].contracts+(reflectAfter?0:1),`재매수 뒤 기준 = 기록상 지금 보유(${reflectAfter?'반영 후':'미반영 1계약 포함'})`);
  }
});

test('이탈 전 계약 수 칸을 건드렸다가 처음 값으로 되돌리면 편집으로 보지 않는다',()=>{
  // A: 기록이 없을 때 10을 쳤다가 비우고 저장하면 아무것도 만들지 않는다.
  const f=future();delete f.rebuy;const a=setup(f);let saves=0;const save=a.c.save;a.c.save=(...x)=>{saves++;return save(...x);};
  a.c.renderFutures();a.el('frEdit').onclick();a.type('[data-fr-field="contracts"]','10');a.type('[data-fr-field="contracts"]','');a.submit('futureRebuyForm');
  assert.equal(saves,0);assert.equal(a.c.state.futures.rebuy,undefined);
  // B: 판 계약이 목표보다 많은 기록에서 12를 쳤다가 10으로 되돌리고 하단만 바꾸면 하단만 저장한다.
  const g=future();Object.assign(g.rebuy,{contracts:10,sellPct:50,steps:2});g.rebuy.cuts=[{contracts:3,price:1399,targetPrice:1400},{contracts:3,price:1299,targetPrice:1300}];
  const b=setup(g);b.c.renderFutures();b.el('frEdit').onclick();
  b.type('[data-fr-field="contracts"]','12');b.type('[data-fr-field="contracts"]','10');b.type('[data-fr-field="floorPrice"]','1280');b.submit('futureRebuyForm');
  assert.equal(b.el('futureRebuyError').textContent,'');assert.deepEqual([b.saved().futures.rebuy.floorPrice,b.saved().futures.rebuy.contracts],[1280,10]);
});

test('판 계약이 손절 목표보다 많아도 보유 칸 수는 이탈 전 계약 수다',()=>{
  const f=future();f.positions[0].contracts=0;Object.assign(f.rebuy,{contracts:10,sellPct:50,steps:2});
  f.rebuy.cuts=[{contracts:6,price:1399,targetPrice:1400,month:'202612'},{contracts:6,price:1299,targetPrice:1300,month:'202612'}];
  const r=setup(f),{s,html,fold}=trackOf(r,f);
  assert.equal(s.overSold,true);assert.deepEqual([s.hold,s.cells,s.held],[10,10,0]);
  assert.deepEqual(countOf(html),[0,10]);assert.match(html,/aria-label="이탈 전 10계약 중 보유 0계약/);assert.equal((html.match(/<i class=/g)||[]).length,10);
  assert.match(fold.text,/ · 보유 0\/10$/);
});

// 보유 17계약 · 지난 손절 3계약(반영, 미복원 3) · 이어서 새 손절(at 1) 신저점 1,350 · 하단 1,280 · 4회 · 50% · 이탈 전 계약 수 자동.
function orderPlan(cutRestart={at:1,rebought:0}){
  const f=future();f.positions[0].contracts=17;
  f.rebuy={lowPrice:1350,floorPrice:1280,currentPrice:1400,sellPct:50,steps:4,cutRestart,cuts:[{contracts:3,price:1399,targetPrice:1400,month:'202612',settlementPrice:1450}],
    stages:[{name:'25선',price:1320},{name:'32선',price:1330},{name:'42선',price:1340}]};
  const r=setup(f);return {r,f,sum:()=>r.c.futureRebuySummary(f),pos:()=>f.positions[0].contracts};
}
test('이어서 새 손절 뒤 지난 미복원 재매수가 먼저 체결돼도 다음 손절로 기준이 줄지 않고, 재매수 때 지금 보유로 다시 짠다',()=>{
  const {r,f,sum,pos}=orderPlan(),open=()=>sum().tranches.find(x=>!x.done&&x.amount>0);
  assert.deepEqual([sum().hold,sum().goal],[17,8]);
  const first=open();assert.notEqual(r.c.setFutureBuyChecked(f,first.i,first.t,true),false);
  assert.deepEqual([pos(),sum().hold,sum().goal,f.rebuy.cutRestart.prior],[18,18,9,1],'이번 손절 체결이 없으면 다시 짜지 않고 보유 증가로 고정');
  const cut=sum().cuts[0];assert.equal(cut.qty,2);assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
  assert.deepEqual([pos(),sum().hold,sum().goal],[16,18,9],'손절만 했으면 이탈 전 계약 수·목표가 그대로');
  const second=open();assert.notEqual(r.c.setFutureBuyChecked(f,second.i,second.t,true),false);const q=sum().rebought-1;
  assert.deepEqual([pos(),sum().hold,sum().cutSold,plain(f.rebuy.cutRestart)],[16+q,16+q,0,{at:2,rebought:1+q}],'재매수로 보유가 늘면 그 보유로 다시 짠다(미복원 제외)');
  assert.notEqual(r.c.setFutureBuyChecked(f,second.i,second.t,false),false);assert.deepEqual([pos(),sum().hold],[16,16],'되찾은 계약을 해제하면 기준에서도 빠진다');
});

test('재매수 체결 수를 늘려도 늘린 몫을 기록 때 지난 미복원으로 고정해 뒤의 손절로 기준이 줄지 않는다',()=>{
  const {r,f,sum,pos}=orderPlan(),tr=sum().tranches.find(x=>!x.done&&x.amount>0);
  assert.notEqual(r.c.setFutureBuyChecked(f,tr.i,tr.t,true),false);const a=sum().rebought;
  assert.notEqual(r.c.setFutureBuyCount(f,tr.i,tr.t,String(a+1)),false);
  assert.deepEqual([pos(),f.rebuy.cutRestart.prior,sum().hold],[17+a+1,a+1,17+a+1],'이번 손절이 없을 때 늘린 몫은 지난 미복원 되찾기');
  const cut=sum().cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
  assert.equal(sum().hold,17+a+1,'뒤에 손절이 체결돼도 기준이 그대로');
});

test('부분 체결 재매수를 체크해 채워도 늘어난 몫을 기록 때 지난 미복원으로 고정한다',()=>{
  // 화면은 부분 체결을 setFutureBuyCount로 보내지만, 공용 계산 setFutureBuyDone의 부분 체결 분기도 같은 규칙을 지킨다.
  const {r,f,sum,pos}=orderPlan();f.positions[0].contracts=18;f.rebuy.stages[0].buys=[{contracts:1,price:1321,month:'202612',partial:true,plannedQty:2}];
  const tr=sum().tranches.find(x=>x.partial);assert.ok(tr&&tr.amount>=1);
  assert.notEqual(r.c.setFutureBuyDone(f,tr.i,tr.t,true),false);f.positions[0].contracts+=tr.amount; // 늘린 계약을 보유에 반영
  assert.deepEqual([f.rebuy.stages[0].buys[0].contracts,f.rebuy.cutRestart.prior],[1+tr.amount,1+tr.amount],'이번 손절이 없을 때 채운 몫은 지난 미복원 되찾기로 고정');
  const hold=sum().hold;assert.equal(hold,pos());
  const cut=sum().cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
  assert.equal(sum().hold,hold,'뒤에 손절이 체결돼도 기준이 그대로');
});

test('재매수 귀속(prior)이 없는 옛 이어서 새 손절 기록은 이전과 같은 값으로 읽고 읽기만으로 필드를 만들지 않는다',()=>{
  // 지난 재매수 1계약 → 새 손절 2계약 순서로 이미 기록된 옛 형식: 시작 뒤 재매수를 이번 손절 먼저 되찾은 것으로 읽는다.
  const {r,f,sum}=orderPlan();f.positions[0].contracts=16;f.rebuy.cuts.push({contracts:2,price:1350,targetPrice:1350,month:'202612',settlementPrice:1450});
  f.rebuy.stages[0].buys=[{contracts:1,price:1321,month:'202612'}];
  const before=JSON.stringify(f);
  assert.deepEqual([sum().hold,sum().goal,sum().cutSold,sum().cutRebought,sum().priorRebought],[17,8,2,1,0]);assert.equal(JSON.stringify(f),before);
  f.rebuy.cutRestart.prior=1;assert.deepEqual([sum().hold,sum().goal,sum().cutRebought,sum().priorRebought],[18,9,0,1],'prior가 있으면 고정한 귀속을 쓴다');
  f.rebuy.cutRestart.prior=5;assert.equal(sum().priorRebought,1,'prior는 시작 뒤 재매수 이하로 읽는다');
});

test('고정한 이탈 전 계약 수를 비우면 미복원 계약을 빼고 지금 보유 기준으로 손절을 다시 짠다',()=>{
  // 이탈 전 14계약(고정) · 손절 5계약 · 재매수 3계약(미복원 2) · 추가매수로 지금 보유 20계약.
  const f=future();f.positions[0].contracts=20;Object.assign(f.rebuy,{contracts:14,sellPct:100,steps:4});
  f.rebuy.cuts=Array.from({length:5},(_,i)=>({contracts:1,price:1399-i*5,targetPrice:1400-i*5,month:'202612',settlementPrice:1450}));
  f.rebuy.stages[0].buys=[{contracts:3,price:1321,month:'202612'}];
  const r=setup(f),before=r.c.futureRebuySummary(f);r.c.backupRecord=()=>{};
  assert.deepEqual([before.sold,before.rebought,before.rest],[5,3,2]);
  r.c.renderFutures();r.el('frEdit').onclick();
  const hold=r.input('[data-fr-field="contracts"]');
  assert.deepEqual([hold.value,hold.placeholder],['14','자동 · 20계약'],'비웠을 때 자동 값은 미복원 2계약을 뺀 지금 보유');
  r.type(hold,'');assert.deepEqual([r.el('frRestartNote').hidden,r.el('frHintBase').hidden],[false,true],'비우면 다시 짠다는 안내');
  r.submit('futureRebuyForm');
  const g=r.saved().futures,s=r.c.futureRebuySummary(g);
  assert.deepEqual(plain(g.rebuy.cutRestart),{at:5,rebought:3});assert.equal(Object.hasOwn(g.rebuy,'contracts'),false);assert.equal(g.rebuy.lowPrice,1325,'남은 회차가 하단 회차뿐이라 현재 환율과 하단의 중간이 새 신저점');
  assert.deepEqual([s.hold,s.goal,s.cutSold,s.sold,s.rest,s.sellAvg],[20,20,0,5,2,before.sellAvg],'손절 기준은 지금 보유 20, 미복원 2는 재매수에만 남는다');
  // 이번 손절에 체결이 없거나 고정 값이 없으면 비워도 다시 짜지 않는다.
  const plan=future();assert.equal(Object.hasOwn(r.c.applyFutureRebuyEdits(plan,{contracts:''}).rebuy,'cutRestart'),false);
  assert.equal(Object.hasOwn(r.c.applyFutureRebuyEdits(g,{contracts:''}).rebuy,'contracts'),false);assert.deepEqual(plain(r.c.applyFutureRebuyEdits(g,{contracts:''}).rebuy.cutRestart),{at:5,rebought:3});
});

// 보유 20 · 이탈 전 14(고정) · 손절 5계약(회차 환율 1400~1380) · 재매수 3 · 비중 100% · 4회 · 현재 1350 (가상 숫자)
function clearPlan(){
  const f=future();f.positions[0].contracts=20;Object.assign(f.rebuy,{contracts:14,sellPct:100,steps:4,currentPrice:1350,notify:{cuts:true}});
  f.rebuy.cuts=Array.from({length:5},(_,i)=>({contracts:1,price:1400-i*5,targetPrice:1400-i*5,month:'202612',settlementPrice:1450}));
  f.rebuy.stages[0].buys=[{contracts:3,price:1321,month:'202612'}];
  const r=setup(f);r.c.backupRecord=()=>{};let saves=0;const save=r.c.save;r.c.save=(...x)=>{saves++;return save(...x);};
  return {r,f,saves:()=>saves};
}
test('신저점 그대로 고정 값을 비우면 다음 미체결 손절 회차 환율을 새 신저점으로 다시 짜 지난 환율 회차가 바로 도래하지 않는다',()=>{
  const {r,f}=clearPlan();f.rebuy.steps=10;
  const next=r.c.futureRebuySummary(f).cuts.find(c=>!c.recorded&&c.qty>0);assert.equal(Math.round(next.price*100)/100,1344.44,'원래 계획의 다음 미체결 회차');
  const g=r.c.applyFutureRebuyEdits(f,{contracts:''}),s=r.c.futureRebuySummary(g);
  assert.equal(g.rebuy.lowPrice,1344.44,'다음 미체결 회차 환율이 새 신저점');assert.equal(s.cuts[0].price,1344.44);assert.equal(s.cuts[0].round,1);
  assert.ok(s.cuts.every(c=>c.price<1350),'현재 환율 1350 위 회차 없음');assert.equal(r.c.futureCutDue(s,1350),null,'바로 도래하는 회차 없음');
  const rules=plain(r.c.buildTradeAlertRules({futures:g},null)).filter(x=>x.id.includes(':cut:'));assert.ok(rules.length&&rules.every(x=>x.targetPrice<1350&&x.condition==='down'));
  r.c.renderFutures();r.el('frEdit').onclick();r.type('[data-fr-field="contracts"]','');
  assert.match(r.el('frRestartNote').textContent,/다음 손절 회차 1,344\.4원을 신저점으로/);
  r.type('[data-fr-field="lowPrice"]','1340');assert.doesNotMatch(r.el('frRestartNote').textContent,/다음 손절 회차/,'신저점을 직접 바꾸면 입력값이 신저점');
  // 남은 회차가 하단 회차뿐이면 현재 환율과 하단의 중간을 신저점으로 써 첫 회차가 현재 환율보다 낮다.
  const {r:r2,f:f2}=clearPlan(),g2=r2.c.applyFutureRebuyEdits(f2,{contracts:''}),s2=r2.c.futureRebuySummary(g2);
  assert.equal(g2.rebuy.lowPrice,1325);assert.equal(r2.c.futureCutDue(s2,1350),null,'다시 짠 직후 바로 도래하지 않음');
  const rules2=plain(r2.c.buildTradeAlertRules({futures:g2},null)).filter(x=>x.id.includes(':cut:'));assert.ok(rules2.length&&rules2.every(x=>x.targetPrice<1350));
  r2.c.renderFutures();r2.el('frEdit').onclick();r2.type('[data-fr-field="contracts"]','');
  assert.match(r2.el('frRestartNote').textContent,/현재 환율과 하단의 중간 1,325원을 신저점으로/,'대체 경로는 현재 환율 기준 안내');
  // 남은 회차가 하단 회차뿐이어도 현재 환율이 기존 신저점 이상이면 신저점은 그대로다.
  const {r:r3,f:f3}=clearPlan();f3.rebuy.currentPrice=1410;assert.equal(r3.c.applyFutureRebuyEdits(f3,{contracts:''}).rebuy.lowPrice,1400);
});

test('고정 이탈 전 계약 수 칸: 비우며 신저점도 바꾸기·비웠다 되돌리기·다른 값 입력',()=>{
  // (a) 비움 + 신저점 변경 → 자동·이어서 새 손절·신저점은 입력값
  let {r}=clearPlan();r.c.renderFutures();r.el('frEdit').onclick();
  r.type('[data-fr-field="contracts"]','');r.type('[data-fr-field="lowPrice"]','1350');r.submit('futureRebuyForm');
  let saved=r.saved().futures.rebuy;assert.deepEqual([Object.hasOwn(saved,'contracts'),plain(saved.cutRestart),saved.lowPrice],[false,{at:5,rebought:3},1350]);
  // (b) 비웠다가 원래 값 14 → 안내 숨김·저장해도 변경 없음
  let p=clearPlan();p.r.c.renderFutures();p.r.el('frEdit').onclick();
  p.r.type('[data-fr-field="contracts"]','');assert.equal(p.r.el('frRestartNote').hidden,false);
  p.r.type('[data-fr-field="contracts"]','14');assert.deepEqual([p.r.el('frRestartNote').hidden,p.r.el('frHintBase').hidden],[true,false]);
  p.r.submit('futureRebuyForm');assert.equal(p.saves(),0);assert.equal(Object.hasOwn(p.f.rebuy,'cutRestart'),false);
  // (c) 16 입력 → 고정 16, 이어서 새 손절 없음
  p=clearPlan();p.r.c.renderFutures();p.r.el('frEdit').onclick();p.r.type('[data-fr-field="contracts"]','16');assert.equal(p.r.el('frRestartNote').hidden,true);p.r.submit('futureRebuyForm');
  saved=p.r.saved().futures.rebuy;assert.deepEqual([saved.contracts,Object.hasOwn(saved,'cutRestart')],[16,false]);
});

test('이탈 전 계약 수 자동이면 분할매수 체결로 보유가 늘 때 그 보유로 손절을 다시 짜고 미복원 계약은 뺀다',()=>{
  // 보유 18 · 자동 · 손절 4계약(미복원 4) → 분할매수 1계약 체결(보유 19)
  const f=future();f.positions[0].contracts=18;delete f.rebuy.contracts;Object.assign(f.rebuy,{steps:10,currentPrice:1390});
  f.rebuy.cuts=[{contracts:2,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450},{contracts:2,price:1388.89,targetPrice:1388.89,month:'202612',settlementPrice:1450}];
  const r=setup(f),sum=()=>r.c.futureRebuySummary(r.c.state.futures);assert.equal(sum().hold,22,'같은 손절 안에서는 판 계약 포함');
  r.c.renderFutures();r.input('[data-tranche-month="0:0"]').value='202612';const box=r.input('[data-tranche-check="0:0"]');box.checked=true;box.onchange();
  const g=r.c.state.futures;assert.equal(g.positions[0].contracts,19);
  assert.deepEqual([plain(g.rebuy.cutRestart),sum().hold,sum().cutSold,sum().sold,sum().rest],[{at:2,rebought:0},19,0,4,4],'분할매수 체결 시점 보유 19가 기준, 미복원 4는 재매수에만');
  assert.equal(g.rebuy.lowPrice,1377.78,'다음 미체결 회차 환율이 새 신저점');
  // 이탈 전 계약 수를 직접 입력해 둔 기록은 다시 짜지 않는다.
  const h=future();h.positions[0].contracts=18;h.rebuy.cuts=structuredClone(f.rebuy.cuts);const r2=setup(h);r2.c.renderFutures();
  r2.input('[data-tranche-month="0:0"]').value='202612';const b2=r2.input('[data-tranche-check="0:0"]');b2.checked=true;b2.onchange();
  assert.equal(Object.hasOwn(r2.c.state.futures.rebuy,'cutRestart'),false);
});

test('이번 손절 뒤 재매수 체결 수를 늘려도 그 보유로 손절을 다시 짠다',()=>{
  const {r,f,sum,pos}=orderPlan(),tr=sum().tranches.find(x=>!x.done&&x.amount>0);
  assert.notEqual(r.c.setFutureBuyChecked(f,tr.i,tr.t,true),false);const a=sum().rebought;
  const cut=sum().cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);assert.equal(f.rebuy.cutRestart.at,1,'아직 다시 짜지 않음');
  assert.equal(r.c.futureFillOf(f,tr.i,tr.t)[0].month,'202612');assert.notEqual(r.c.setFutureBuyCount(f,tr.i,tr.t,String(a+1)),false);
  assert.deepEqual([f.rebuy.cutRestart.at,sum().hold,sum().cutSold],[2,pos(),0],'늘린 재매수로 보유가 늘면 그 보유로 다시 짠다');
});

test('하단 회차만 남은 자동 기록에서 재매수 체결로 다시 짜도 첫 회차가 현재 환율보다 낮다',()=>{
  // 보유 16 · 신저점 1400 · 하단 1300 · 비중 20% · 2회 · 손절 2회 완료(2계약씩 1400·1300) · 현재 1350 · 재매수 단계 1320·1330·1340 · 자동
  const f=future();f.positions[0].contracts=16;delete f.rebuy.contracts;Object.assign(f.rebuy,{sellPct:20,steps:2,currentPrice:1350,notify:{cuts:true}});
  f.rebuy.cuts=[{contracts:2,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450},{contracts:2,price:1300,targetPrice:1300,month:'202612',settlementPrice:1450}];
  const r=setup(f),sum=()=>r.c.futureRebuySummary(f),tr=sum().tranches.find(x=>!x.done&&x.amount>0);
  assert.notEqual(r.c.setFutureBuyChecked(f,tr.i,tr.t,true),false);
  const s=sum();assert.equal(f.rebuy.lowPrice,1325);assert.ok(s.cuts[0].price<1350);assert.equal(r.c.futureCutDue(s,1350),null);
  const rules=plain(r.c.buildTradeAlertRules({futures:f},null)).filter(x=>x.id.includes(':cut:'));assert.ok(rules.length&&rules.every(x=>x.targetPrice<1350&&x.condition==='down'));
});

test('월물에 반영하지 않은 재매수 수량을 늘리면 지금 보유로 다시 짜고, 줄이거나 같게 두면 다시 짜지 않는다',()=>{
  const plan=qty=>{const f=future();f.positions[0].contracts=18;delete f.rebuy.contracts;f.rebuy.steps=10;
    f.rebuy.cuts=[{contracts:2,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450},{contracts:2,price:1388.89,targetPrice:1388.89,month:'202612',settlementPrice:1450}];
    f.rebuy.stages[0].buys=[{contracts:qty,price:1321}];const r=setup(f);return {r,f,sum:()=>r.c.futureRebuySummary(f)};};
  let {r,f,sum}=plan(1);assert.equal(sum().hold,22);
  assert.notEqual(r.c.setFutureBuyCount(f,0,0,'2'),false);
  assert.deepEqual([plain(f.rebuy.cutRestart),sum().hold,sum().cutSold],[{at:2,rebought:2},20,0],'늘리면 기록상 보유(18 + 미반영 2)로 다시 짠다');
  ({r,f,sum}=plan(2));assert.notEqual(r.c.setFutureBuyCount(f,0,0,'2'),false);assert.equal(Object.hasOwn(f.rebuy,'cutRestart'),false,'같게 두면 그대로');
  assert.notEqual(r.c.setFutureBuyCount(f,0,0,'1'),false);assert.equal(Object.hasOwn(f.rebuy,'cutRestart'),false,'줄이면 그대로');
});

test('자동으로 정한 새 신저점이 하단 이하라 저장할 수 없으면 그 이유와 직접 입력 안내를 보인다',()=>{
  const {r,f}=clearPlan();f.rebuy.steps=10;r.c.renderFutures();r.el('frEdit').onclick();
  r.type('[data-fr-field="contracts"]','');r.type('[data-fr-field="floorPrice"]','1360');r.submit('futureRebuyForm');
  assert.match(r.el('futureRebuyError').textContent,/자동으로 정한 새 신저점 1,344\.4원이 손절 하단 이하라 저장할 수 없습니다\. 신저점을 직접 입력하면 저장할 수 있습니다/);
  r.type('[data-fr-field="lowPrice"]','1380');r.submit('futureRebuyForm');assert.equal(r.saved().futures.rebuy.lowPrice,1380,'신저점을 직접 넣으면 저장');
});

test('신저점이 자동으로 옮겨지지 않았으면 하단 오류는 기존 문구로 보인다',()=>{
  const {r,f}=clearPlan();f.rebuy.currentPrice=1410;r.c.renderFutures();r.el('frEdit').onclick();
  r.type('[data-fr-field="contracts"]','');r.type('[data-fr-field="floorPrice"]','1400');r.submit('futureRebuyForm');
  assert.equal(r.el('futureRebuyError').textContent,'손절 하단은 신저점 환율보다 낮게 입력하세요.');
});

test('건너뛰고 체결한 뒤 다시 짜면 마지막 체결 다음 회차를 새 신저점으로 써 바로 도래하지 않는다',()=>{
  const f=future();f.positions[0].contracts=20;Object.assign(f.rebuy,{contracts:20,sellPct:100,steps:10,currentPrice:1370,notify:{cuts:true}});
  const rec=p=>({contracts:2,price:p,targetPrice:p,month:'202612',settlementPrice:1450});f.rebuy.cuts=[rec(1400),null,rec(1377.78)];
  const r=setup(f),g=r.c.applyFutureRebuyEdits(f,{contracts:''}),s=r.c.futureRebuySummary(g);
  assert.deepEqual([g.rebuy.lowPrice,plain(g.rebuy.cutRestart)],[1366.67,{at:3,rebought:0}],'건너뛴 2회차(1388.89)가 아니라 마지막 체결(3회) 다음 4회차');
  assert.equal(r.c.futureCutDue(s,1370),null);assert.ok(s.cuts.every(c=>c.price<1370));
});

test('현재 환율이 하단 이하면 신저점을 옮기지 않아 새 회차가 모두 손절 시점이 된다',()=>{
  const {r,f}=clearPlan();f.rebuy.currentPrice=1290;
  const g=r.c.applyFutureRebuyEdits(f,{contracts:''}),s=r.c.futureRebuySummary(g);
  assert.equal(g.rebuy.lowPrice,1400);
  assert.deepEqual(plain(s.cuts.map(c=>[Math.round(c.price*100)/100,c.qty])),[[1400,5],[1366.67,5],[1333.33,5],[1300,5]]);
  assert.equal(s.cuts.filter(c=>c.price>=1290).length,4,'새 회차 4개가 모두 도래');assert.equal(r.c.futureCutDue(s,1290).round,1);
});

test('현재 환율이 하단 + 0.01원 이내면 중간값이 현재 환율과 같아 신저점을 옮기지 않는다',()=>{
  const {r,f}=clearPlan();f.rebuy.currentPrice=1300.01;
  assert.equal(r.c.futureNextCut(f),null);assert.equal(r.c.applyFutureRebuyEdits(f,{contracts:''}).rebuy.lowPrice,1400);
});

test('하단 아래라도 남은 회차가 하단 회차뿐이 아니면 다음 회차로 옮기고, 후보가 현재 환율 이상이면 첫 회차가 바로 도래한다',()=>{
  // (a) 4회 아닌 10회 계획: 남은 회차가 하단 회차뿐이 아니라 현재 환율 1290(하단 아래)이어도 다음 회차 1344.44로 옮기고 새 회차가 모두 도래
  const {r,f}=clearPlan();Object.assign(f.rebuy,{steps:10,currentPrice:1290});
  const g=r.c.applyFutureRebuyEdits(f,{contracts:''}),s=r.c.futureRebuySummary(g);
  assert.equal(g.rebuy.lowPrice,1344.44);assert.equal(s.cuts.length,10);assert.equal(s.cuts.filter(c=>c.price>=1290).length,10);
  // (b) 건너뛴 체결 뒤 현재 1360: 마지막 체결 다음 회차 1366.67이 현재 환율 이상이라 새 첫 회차가 바로 도래
  const h=future();h.positions[0].contracts=20;Object.assign(h.rebuy,{contracts:20,sellPct:100,steps:10,currentPrice:1360});
  const rec=p=>({contracts:2,price:p,targetPrice:p,month:'202612',settlementPrice:1450});h.rebuy.cuts=[rec(1400),null,rec(1377.78)];
  const r2=setup(h),g2=r2.c.applyFutureRebuyEdits(h,{contracts:''}),s2=r2.c.futureRebuySummary(g2);
  assert.equal(g2.rebuy.lowPrice,1366.67);assert.equal(r2.c.futureCutDue(s2,1360).round,1);
});

test('분할매수 체결로 다시 짤 때 새 신저점은 체결 전 표의 다음 회차 환율이다',()=>{
  const f=future();f.positions[0].contracts=14;delete f.rebuy.contracts;Object.assign(f.rebuy,{sellPct:50,steps:10,currentPrice:1395});
  f.rebuy.cuts=[{contracts:1,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}];
  const r=setup(f),shown=Math.round(r.c.futureRebuySummary(f).cuts.find(c=>!c.recorded).price*100)/100;assert.equal(shown,1383.33);
  r.c.renderFutures();r.input('[data-tranche-month="0:0"]').value='202612';const b=r.input('[data-tranche-check="0:0"]');b.checked=true;b.onchange();
  assert.equal(r.c.state.futures.rebuy.lowPrice,1383.33,'체결 뒤 계획(1385.71)이 아니라 표에 보이던 1383.33');
});

test('자동 기록은 이탈 전 계약 수를 비워도(이미 비어 있음) 다시 짜지 않는다',()=>{
  const f=future();f.positions[0].contracts=16;delete f.rebuy.contracts;f.rebuy.cuts=[{contracts:2,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}];
  const r=setup(f),g=r.c.applyFutureRebuyEdits(f,{contracts:''});assert.equal(Object.hasOwn(g.rebuy,'cutRestart'),false);
});

test('하단이 소수 여러 자리일 때 반올림한 중간값이 하단 이하가 되면 신저점을 옮기지 않는다',()=>{
  // 하단 1331.4501 · 현재 1331.452 → 중간 1331.45105 → 반올림 1331.45 ≤ 하단
  const {r,f}=clearPlan();Object.assign(f.rebuy,{floorPrice:1331.4501,currentPrice:1331.452});
  assert.ok(!(r.c.futureRebuySummary(f).cuts.find(c=>!c.recorded&&c.qty>0).price>1331.4501),'남은 회차가 하단 회차뿐');
  assert.equal(r.c.futureNextCut(f),null);
});

const tickTranche=r=>{r.c.renderFutures();r.input('[data-tranche-month="0:0"]').value='202612';const b=r.input('[data-tranche-check="0:0"]');b.checked=true;b.onchange();};
test('손절 목표를 모두 체결한 뒤 분할매수가 체결돼도 지금 보유로 다시 짠다(하단 아래면 새 회차 모두 도래, 하단 위면 중간부터)',()=>{
  // 보유 50 · 자동 · 50% · 10회 · 신저점 1400 · 하단 1300 · 5계약씩 10회 모두 손절(미복원 50)
  const make=cur=>{const f=future();f.positions[0].contracts=50;delete f.rebuy.contracts;Object.assign(f.rebuy,{sellPct:50,steps:10,currentPrice:cur,notify:{cuts:true}});
    f.rebuy.cuts=Array.from({length:10},(_,i)=>{const p=Math.round((1400-100*i/9)*100)/100;return {contracts:5,price:p,targetPrice:p,month:'202612',settlementPrice:1450};});
    return {r:setup(f)};};
  let {r}=make(1290);let s=r.c.futureRebuySummary(r.c.state.futures);assert.deepEqual([s.hold,s.goal,s.cuts.filter(c=>!c.recorded&&c.qty>0).length],[100,50,0],'남은 미체결 회차 없음');
  tickTranche(r);let g=r.c.state.futures;s=r.c.futureRebuySummary(g);
  assert.deepEqual([s.hold,s.goal,g.rebuy.lowPrice,s.cuts.length],[51,25,1400,10],'하단 아래: 신저점 그대로, 새 회차 10개');
  assert.equal(s.cuts.filter(c=>c.price>=1290).reduce((n,c)=>n+c.qty,0),25,'새 회차가 모두 도래');
  assert.equal(plain(r.c.buildTradeAlertRules({futures:g},null)).filter(x=>x.id.includes(':cut:')).length,10);
  ({r}=make(1350));tickTranche(r);g=r.c.state.futures;s=r.c.futureRebuySummary(g);
  assert.equal(g.rebuy.lowPrice,1325,'하단 위: 현재 환율과 하단의 중간');assert.equal(r.c.futureCutDue(s,1350),null);
});

test('체결 전 표에서 새 신저점 후보가 없으면 체결 뒤에 다시 구하지 않는다',()=>{
  // 보유 6 · 자동 · 50% · 10회 · 신저점 1400 · 하단 1300 · 현재 1290 · 손절 1계약씩 3회(1400·1366.67·1333.33): 체결 전 남은 회차는 하단 회차뿐
  const f=future();f.positions[0].contracts=6;delete f.rebuy.contracts;Object.assign(f.rebuy,{sellPct:50,steps:10,currentPrice:1290});
  f.rebuy.cuts=[1400,1366.67,1333.33].map(p=>({contracts:1,price:p,targetPrice:p,month:'202612',settlementPrice:1450}));
  const r=setup(f);assert.equal(r.c.futureNextCut(f),null);
  tickTranche(r);assert.equal(r.c.state.futures.rebuy.lowPrice,1400,'체결 뒤 계획(1325)으로 다시 구하지 않는다');assert.ok(r.c.state.futures.rebuy.cutRestart);
});

test('마지막 회차가 부분 체결로 남아도 남은 미체결 회차가 없는 경로로 다시 짜고 남은 계약은 끝난다',()=>{
  // 보유 16 · 자동 · 25% · 2회 · 신저점 1400 · 하단 1300 · 현재 1350 · 1400에 3계약 완료 + 1300에 1계약 부분 체결(계획 2) → 목표 5·체결 4
  const f=future();f.positions[0].contracts=16;delete f.rebuy.contracts;Object.assign(f.rebuy,{sellPct:25,steps:2,currentPrice:1350});
  f.rebuy.cuts=[{contracts:3,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450},{contracts:1,price:1300,targetPrice:1300,month:'202612',settlementPrice:1450,partial:true,plannedQty:2}];
  const r=setup(f),s0=r.c.futureRebuySummary(f);assert.deepEqual([s0.goal,s0.cutSold],[5,4]);assert.equal(r.c.futureNextCut(f).current,true,'후보 회차 없음 → 중간값 경로');
  tickTranche(r);const g=r.c.state.futures,s=r.c.futureRebuySummary(g);
  assert.deepEqual([g.rebuy.lowPrice,plain(g.rebuy.cutRestart),g.rebuy.cuts.length],[1325,{at:2,rebought:0},2],'부분 체결의 남은 1계약은 새 계획에서 끝남');
  assert.deepEqual(plain(s.cuts.map(c=>[c.price,c.qty])),[[1325,2],[1300,2]]);
});

test('재매수가 지난 미복원까지 되찾아 계획이 바뀌어도 새 신저점은 체결 전 표의 다음 회차다',()=>{
  const {r,f,sum}=orderPlan();f.rebuy.steps=10;f.rebuy.cuts[0].contracts=10;
  assert.deepEqual([sum().hold,sum().goal,sum().cuts.length],[17,8,8]);
  const cut=sum().cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
  const tr=sum().tranches.find(x=>!x.done&&x.amount>=2);assert.deepEqual([tr.i,tr.t,tr.amount],[0,0,2]);
  assert.equal(r.c.futureNextCut(f).price,1340,'체결 전 다음 회차');
  assert.notEqual(r.c.setFutureBuyChecked(f,tr.i,tr.t,true),false);
  assert.deepEqual([f.rebuy.lowPrice,plain(f.rebuy.cutRestart),r.c.futureRebuySummary(f).hold],[1340,{at:2,rebought:2},18],'체결 뒤 계획(1341.25)이 아니라 체결 전 1340');
});

test('재매수 체결 수량 칸을 늘려 다시 짤 때도 새 신저점은 체결 전 표의 다음 회차다(월물 반영)',()=>{
  const {r,f,sum}=orderPlan();f.rebuy.steps=10;const tr=sum().tranches.find(x=>!x.done&&x.amount>0); // 계약이 배정된 첫 재매수 회차
  assert.notEqual(r.c.setFutureBuyChecked(f,tr.i,tr.t,true),false);const q=r.c.futureFillOf(f,tr.i,tr.t)[0].contracts;assert.equal(r.c.futureFillOf(f,tr.i,tr.t)[0].month,'202612');
  const cut=sum().cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
  const before=r.c.futureNextCut(f).price;assert.equal(before,1341.25);
  assert.notEqual(r.c.setFutureBuyCount(f,tr.i,tr.t,String(q+3)),false);
  assert.deepEqual([f.rebuy.lowPrice,f.rebuy.cutRestart.at],[before,2],'체결 뒤 계획(1342.22)이 아니라 체결 전 1341.25');
});

test('재매수 체결 수량 칸을 늘려 다시 짤 때도 새 신저점은 체결 전 표의 다음 회차다(월물 미반영)',()=>{
  const {r,f,sum}=orderPlan();f.positions[0].contracts=14;Object.assign(f.rebuy,{sellPct:30,steps:10});f.rebuy.stages[0].buys=[{contracts:1,price:1321}];
  const cut=sum().cuts[0];assert.notEqual(r.c.setFutureCutChecked(f,cut.k-1,true),false);
  const before=r.c.futureNextCut(f).price;assert.equal(before,1326.67);
  assert.notEqual(r.c.setFutureBuyCount(f,0,0,'4'),false);assert.equal(r.c.futureFillOf(f,0,0)[0].month,undefined);
  assert.deepEqual([f.rebuy.lowPrice,f.rebuy.cutRestart.at],[before,2],'체결 뒤 계획(1332.5)이 아니라 체결 전 1326.67');
});

test('계약이 배정되지 않은 미체결 회차는 새 신저점 후보에서 뺀다',()=>{
  const f=future();f.positions[0].contracts=12;Object.assign(f.rebuy,{contracts:20,sellPct:50,steps:10,currentPrice:1380});
  f.rebuy.cuts=[{contracts:8,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}];
  const r=setup(f),rows=r.c.futureRebuySummary(f).cuts;assert.deepEqual(plain(rows.slice(1,4).map(c=>[Math.round(c.price*100)/100,c.qty])),[[1388.89,0],[1377.78,0],[1366.67,1]]);
  assert.deepEqual(plain(r.c.futureNextCut(f)),{price:1366.67,current:false});
  const g=r.c.applyFutureRebuyEdits(f,{contracts:''});assert.equal(g.rebuy.lowPrice,1366.67);assert.equal(r.c.futureCutDue(r.c.futureRebuySummary(g),1380),null);
});

test('신저점을 직접 넣었으면 하단 오류에 자동 신저점 문구를 쓰지 않는다',()=>{
  const {r,f}=clearPlan();f.rebuy.steps=10;r.c.renderFutures();r.el('frEdit').onclick();
  r.type('[data-fr-field="contracts"]','');r.type('[data-fr-field="lowPrice"]','1350');r.type('[data-fr-field="floorPrice"]','1360');r.submit('futureRebuyForm');
  assert.equal(r.el('futureRebuyError').textContent,'손절 하단은 신저점 환율보다 낮게 입력하세요.');
});

test('보관 후 새 손절 계획은 이전 체결 원본과 현재 보유·정산손익을 보존하고 새 손절 회차만 시작한다',()=>{
  const r=openNewStopPlan(),before=plain(r.c.state);
  assert.equal(r.input('[data-fr-field="contracts"]').value,'');assert.equal(r.input('[data-fr-field="contracts"]').placeholder,'자동 · 8계약','새 계획은 보유에서 자동으로 센다');
  assert.match(r.el('frNewGoal').textContent,/손절 목표 4계약 · 4회/);
  assert.match(r.el('futureRebuyDialog').innerHTML,/손절 4계약 · 재매수 3계약 · 미복원 1계약/);
  assert.match(r.el('futureRebuyDialog').innerHTML,/알림은 꺼진 채 시작합니다/);
  r.enterPrices();r.type('[data-fr-field="steps"]','2');
  assert.match(r.el('frNewGoal').textContent,/손절 목표 4계약 · 2회/);
  r.submit('futureRebuyForm');
  assert.deepEqual(r.archive.map(x=>x.snapshot),[before]);
  const {rebuy,...savedFutures}=r.saved().futures;
  const {rebuy:oldRebuy,...oldFutures}=before.futures;
  assert.deepEqual(savedFutures,oldFutures);
  assert.deepEqual(r.archive[0].snapshot.futures.rebuy,oldRebuy);
  assert.equal(Object.hasOwn(rebuy,'contracts'),false);assert.equal(r.c.futureRebuySummary(r.saved().futures).hold,8);assert.equal(rebuy.currentPrice,1350);
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

test('손절 분할 횟수 자동은 steps 60으로 저장해 손절 목표를 회차마다 1계약씩 나누고, 60이면 자동으로 연다',()=>{
  const f=future();Object.assign(f.rebuy,{contracts:16,steps:5});
  const r=setup(f);r.c.renderFutures();r.el('frEdit').onclick();
  const steps=r.input('[data-fr-field="steps"]');
  assert.deepEqual([r.el('frStepsMode').value,steps.value,steps.disabled],['direct','5',false],'저장한 횟수는 직접으로 연다');
  r.change('#frStepsMode','auto');
  assert.deepEqual([steps.disabled,steps.value,steps.placeholder,r.el('frStepsNote').textContent],[true,'','8회','회차마다 1계약씩 손절'],'16계약 × 50% = 8계약');
  r.type('[data-fr-field="contracts"]','150');
  assert.equal(steps.placeholder,'60회');assert.equal(r.el('frStepsNote').textContent,'목표 75계약 · 일부 회차 2계약');assert.equal(r.el('frStepsNote').classList.contains('warn'),true);
  r.type('[data-fr-field="contracts"]','16');r.submit('futureRebuyForm');
  const saved=r.saved().futures;assert.equal(saved.rebuy.steps,60);
  assert.deepEqual(plain(r.c.futureCutPlan(saved).map(c=>c.qty)),[1,1,1,1,1,1,1,1],'8계약을 8회 · 1계약씩');
  r.el('frEdit').onclick();
  assert.deepEqual([r.el('frStepsMode').value,r.input('[data-fr-field="steps"]').disabled],['auto',true],'steps 60은 자동으로 연다');
  r.submit('futureRebuyForm');assert.equal(r.saved().futures.rebuy.steps,60,'자동 그대로 저장해도 60');
  r.el('frEdit').onclick();r.change('#frStepsMode','direct');
  assert.deepEqual([r.input('[data-fr-field="steps"]').value,r.input('[data-fr-field="steps"]').disabled],['10',false],'자동에서 직접으로 바꾸면 기본 10회');
  r.type('[data-fr-field="steps"]','4');r.submit('futureRebuyForm');assert.equal(r.saved().futures.rebuy.steps,4);
});

test('손절 목표가 60계약을 넘으면 자동은 60회로 나누고 합계는 손절 목표와 같다',()=>{
  const f=future();Object.assign(f.rebuy,{contracts:150,steps:60});f.positions[0].contracts=150;
  const plan=require('node:vm').runInContext('futureCutPlan',setup(f).c)(f);
  assert.equal(plan.length,60);assert.equal(plan.reduce((n,c)=>n+c.qty,0),75);assert.ok(plan.every(c=>c.qty>=1&&c.qty<=2));
});

test('분할 횟수가 없는 옛 기록은 직접 10회로 열고, 다른 칸만 고치면 steps를 만들지 않는다',()=>{
  const f=future();delete f.rebuy.steps;
  const r=setup(f);r.c.renderFutures();r.el('frEdit').onclick();
  assert.deepEqual([r.el('frStepsMode').value,r.input('[data-fr-field="steps"]').value],['direct','10']);
  r.type('[data-fr-field="floorPrice"]','1280');r.submit('futureRebuyForm');
  const saved=r.saved().futures.rebuy;assert.equal(saved.floorPrice,1280);assert.equal(Object.hasOwn(saved,'steps'),false);
  assert.equal(r.c.futureCutPlan(r.saved().futures).length,4,'8계약 × 50% = 4계약, 옛 기본 10회는 목표로 줄어든다');
});

test('체결한 손절 회차가 있어도 자동으로 바꾸면 체결 기록은 그대로 두고 남은 회차만 다시 나눈다',()=>{
  const f=future();Object.assign(f.rebuy,{contracts:16,steps:2,cuts:[{contracts:1,price:1399,targetPrice:1400,month:'202612',settlementPrice:1450}]});
  const r=setup(f),cuts=JSON.stringify(f.rebuy.cuts);r.c.renderFutures();r.el('frEdit').onclick();
  r.change('#frStepsMode','auto');r.submit('futureRebuyForm');
  const saved=r.saved().futures;assert.equal(saved.rebuy.steps,60);assert.equal(JSON.stringify(saved.rebuy.cuts),cuts);
  assert.equal(Object.hasOwn(saved.rebuy,'cutRestart'),false);
  assert.deepEqual(plain(r.c.futureCutPlan(saved).map(c=>c.qty)),[1,1,1,1,1,1,1,1]);
});

test('새 손절 계획 창도 분할 횟수 자동을 미리보기와 저장에 반영한다',()=>{
  const f=future();Object.assign(f.rebuy,{contracts:16,cuts:[{contracts:1,price:1399,targetPrice:1400,month:'202612',settlementPrice:1450}]});
  const r=setup(f);r.c.backupRecord=()=>{};r.c.absorbPlanner=()=>{};r.c.dataSnapshot=()=>'snapshot';r.c.pricedSnapshot=()=>'';r.c.openFutureRebuyDialog(true);
  r.type('[data-fr-field="lowPrice"]','1400');r.type('[data-fr-field="floorPrice"]','1300');r.type('[data-fr-field="contracts"]','12');
  assert.match(r.el('frNewGoal').textContent,/손절 목표 6계약 · 6회/,'직접 10회도 목표 6계약으로 줄어든다');
  r.change('#frStepsMode','auto');assert.match(r.el('frNewGoal').textContent,/손절 목표 6계약 · 6회/);
  r.submit('futureRebuyForm');assert.equal(r.el('futureRebuyError').textContent,'');
  const saved=r.saved().futures.rebuy;assert.equal(saved.steps,60);assert.deepEqual(plain(r.c.futureCutPlan(r.saved().futures).map(c=>c.qty)),[1,1,1,1,1,1]);
});
