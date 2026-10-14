const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const scope = 'https://example.test/etf-planner/';
const plain = value => JSON.parse(JSON.stringify(value));

function worker(clients=[]){
  const events={},calls={shown:[],opened:[],navigated:[],focused:0,closed:0,installed:0,claimed:0};
  const self={registration:{scope,showNotification:async(...args)=>calls.shown.push(args)},
    addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>calls.installed++,
    clients:{claim:async()=>calls.claimed++,matchAll:async()=>clients,
      openWindow:async url=>calls.opened.push(url)}};
  const ctx=vm.createContext({self,URL,URLSearchParams});
  ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(source(name.split('?')[0]),ctx));
  vm.runInContext(source('push-sw.js'),ctx);
  const dispatch=async(name,value={})=>{let task;events[name]({...value,waitUntil:promise=>task=promise});await task;};
  const push=async payload=>{await dispatch('push',{data:{json:()=>payload}});return calls.shown.at(-1)[1];};
  const click=async data=>dispatch('notificationclick',{notification:{data,close:()=>calls.closed++}});
  return {ctx,calls,dispatch,push,click};
}

test('수신한 종목·기준선만 같은 사이트의 이동 주소에 담는다',async()=>{
  const {push,calls}=worker();
  const notice=await push({ticker:'brk/b',line:'분할매도 첫 매도',eventId:'event-1',ruleId:'trade:plan:origin:0',body:'가격 도달',url:'https://outside.test/',token:'private'});
  const url=new URL(notice.data.url);
  assert.equal(url.origin+url.pathname,scope);
  const params=new URLSearchParams(url.hash.slice(7));
  assert.equal(params.get('ticker'),'BRK/B');
  assert.equal(params.get('line'),'분할매도 첫 매도');
  assert.equal(params.get('rule'),'trade:plan:origin:0');
  assert.equal(notice.tag,'event-1');
  assert.doesNotMatch(JSON.stringify(calls.shown),/outside|private|token/);
  assert.equal((await push({ticker:'https://outside.test/'})).data.url,scope);
  assert.equal((await push({})).data.url,scope);
});

test('열린 플래너를 알림 대상 주소로 이동한 뒤 포커스한다',async()=>{
  const order=[],client={url:scope+'index.html#rebuy',
    async navigate(url){order.push(['navigate',url]);return this;},async focus(){order.push(['focus']);}};
  const {push,click,calls}=worker([client]);
  const notice=await push({ticker:'TEST',line:'분할매수 2차'});
  await click(notice.data);
  assert.deepEqual(order,[['navigate',notice.data.url],['focus']]);
  assert.equal(calls.closed,1);
  assert.deepEqual(calls.opened,[]);
});

test('자산·시나리오·다른 사이트 탭을 바꾸지 않고 플래너를 연다',async()=>{
  const clients=['assets.html','valuation.html'].map(name=>({url:scope+name,navigate(){throw Error('unrelated tab');}}));
  clients.push({url:'https://outside.test/etf-planner/',navigate(){throw Error('outside');}});
  const {push,click,calls}=worker(clients),notice=await push({ticker:'BTC-USD',line:'60일선'});
  await click(notice.data);
  assert.deepEqual(calls.opened,[notice.data.url]);
});

test('닫힌 탭·이동 실패·잘못된 알림 주소는 안전한 플래너 주소로 연다',async()=>{
  for(const navigate of [async()=>null,async()=>{throw Error('closed');}]){
    const {push,click,calls}=worker([{url:scope,navigate}]),notice=await push({ticker:'TEST',line:'재매수 25선'});
    await click(notice.data);
    assert.deepEqual(calls.opened,[notice.data.url]);
  }
  for(const url of ['https://outside.test/','#alert?ticker=TEST',scope+'assets.html#alert?ticker=TEST']){
    const {click,calls}=worker();await click({url});assert.deepEqual(calls.opened,[scope]);
  }
});

test('연결한 기기도 새 서비스 워커로 갱신하고 기존 형식 알림은 플래너를 연다',async()=>{
  const {dispatch,click,calls}=worker();
  await dispatch('install');await dispatch('activate');await click({url:scope});
  assert.equal(calls.installed,1);assert.equal(calls.claimed,1);assert.deepEqual(calls.opened,[scope]);
});

function page(initial={},assets={}){
  const storage=new Map([['etf-exit-planner-standalone-v1',JSON.stringify({plans:[],futures:{positions:[],levels:[]},...initial})]]);
  const events={},assetListeners=[],frames=new Map(),calls={tabs:[],focused:[],scrolled:[],saves:0,selectedBuys:[]};
  const node=name=>({name,dataset:{},classList:{toggle(){},add(){},remove(){}},closest:()=>null,style:{setProperty(){}},
    isConnected:true,getClientRects:()=>[{}],getBoundingClientRect:()=>({top:240,height:60,bottom:60}),focus:()=>calls.focused.push(name),
    scrollIntoView:()=>calls.scrolled.push(name),addEventListener(){}});
  const nodes=Object.fromEntries(['plansView','buysView','futuresView','rebuyView','planMain','rebuyMain','alertForm','alertFormError','alertsDialog','futureRebuyPanel','futureBuyCard'].map(name=>[name,node(name)]));
  nodes.alertsDialog.showModal=()=>nodes.alertsDialog.open=true;nodes.alertsDialog.close=()=>nodes.alertsDialog.open=false;
  const top=node('top');top.querySelector=()=>({offsetTop:20});
  const tabs=['plans','buys','futures','rebuy'].map(tab=>{const b=node(tab);b.dataset.tab=tab;b.addEventListener=(_,fn)=>b.onclick=fn;return b;});
  const cards=[],rules=[];
  const ctx=vm.createContext({URL,URLSearchParams,Intl,crypto:require('node:crypto').webcrypto,
    window:{isSecureContext:false},navigator:{},location:{hash:''},
    requestAnimationFrame:fn=>{const key=frames.size+1;frames.set(key,fn);return key;},cancelAnimationFrame:key=>frames.delete(key),
    openCompletedSales:new Set(),futureCompletedOpen:false,
    document:{baseURI:scope,readyState:'complete',hidden:false,addEventListener:(name,fn)=>events[name]=fn,getElementById:name=>nodes[name]||null,querySelector:()=>top,
      querySelectorAll:sel=>sel==='.tab'||sel==='.tab[data-tab]'?tabs:sel==='[data-purchase-item]'?cards:sel==='[data-alert-rule]'?rules:[]},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    addEventListener:(name,fn)=>events[name]=fn,scrollY:80,scrollTo:options=>calls.scrolled.push(options),
    history:{replaceState:(_,__,hash)=>ctx.location.hash=hash},save:()=>calls.saves++,
    assetStore:{doc:assets,subscribe:fn=>assetListeners.push(fn)},
    renderPlans:()=>calls.tabs.push('plans'),renderRebuy:()=>calls.tabs.push('rebuy'),renderFutures:()=>calls.tabs.push('futures'),
    purchasePlanner:{select:id=>calls.selectedBuys.push(id),render:()=>calls.tabs.push('buys')},futureRebuyExpanded:false,priceData:null});
  for(const file of ['js/ma-ladder.js','js/core.js','js/assets-calc.js','js/rebuy.js','js/alerts.js','js/alert-target.js','js/push.js'])vm.runInContext(source(file),ctx);
  ctx.renderRebuy=()=>calls.tabs.push('rebuy');
  const state=()=>plain(vm.runInContext('state',ctx));
  const records=()=>{const s=state();return JSON.stringify({plans:s.plans,futures:s.futures,rebuy:s.rebuy,alerts:s.alerts});};
  const flush=()=>{const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn());};
  const open=target=>{ctx.location.hash=ctx.pushAlertHash(target);ctx.openPlannerLocation();flush();};
  return {ctx,calls,nodes,tabs,node,cards,rules,assetListeners,events,state,records,open,flush};
}

test('처음 열린 페이지에서 알림 종목의 분할매도 계획을 선택하고 매매 기록은 보존한다',()=>{
  const p=page({plans:[{id:'other',ticker:'OTHER'},{id:'target',ticker:'TEST'}],selectedPlan:'other'}),before=p.records();
  p.open({ticker:'TEST',line:'분할매도 첫 매도'});
  assert.equal(p.state().selectedPlan,'target');assert.equal(p.state().tab,'plans');
  assert.equal(p.ctx.location.hash,'#plans');assert.equal(p.records(),before);
  assert.equal(p.ctx.openCompletedSales.has('target'),true);
  assert.deepEqual(p.calls.focused,['planMain']);
  p.ctx.location.hash=p.ctx.pushAlertHash({ticker:'OTHER',line:'분할매도 2회'});p.events.hashchange();p.flush();
  assert.equal(p.state().selectedPlan,'other');
});

test('국내 코드 접두사·대소문자·비트코인 별칭을 같은 종목으로 찾는다',()=>{
  for(const [stored,incoming] of [['A123456','123456'],['test','TEST'],['비트코인','BTC-USD']]){
    const p=page({plans:[{id:'target',ticker:stored}]});p.open({ticker:incoming,line:'분할매도 첫 매도'});
    assert.equal(p.state().selectedPlan,'target');assert.equal(p.ctx.location.hash,'#plans');
  }
});

test('재매수 종목을 바꾸고 옛 단일 종목 기록도 이전 없이 연다',()=>{
  const p=page({rebuy:{items:[{id:'other',ticker:'OTHER'},{id:'target',ticker:'TEST'}]},selectedRebuy:'other'}),before=p.records();
  vm.runInContext('rebuyUnit="shares"',p.ctx);p.open({ticker:'TEST',line:'재매수 신저점 이탈'});
  assert.equal(p.state().selectedRebuy,'target');assert.equal(p.state().tab,'rebuy');
  assert.equal(vm.runInContext('rebuyUnit',p.ctx),null);assert.equal(p.records(),before);
  assert.deepEqual(plain(vm.runInContext('rebuyFolds.get("target")',p.ctx)),{cuts:true,buys:true,complete:false});
  const old=page({rebuy:{ticker:'TEST',name:'예제'}}),oldRecords=old.records();old.open({ticker:'TEST',line:'재매수 25선'});
  assert.equal(old.state().tab,'rebuy');assert.equal(old.records(),oldRecords);
});

test('분할매수 종목 카드로 이동하며 늦게 동기화된 자산 기록도 찾는다',async()=>{
  const p=page(),card=p.node('target');card.dataset.purchaseItem='target';p.cards.push(card);
  await p.ctx.initializePush();p.open({ticker:'TEST',line:'분할매수 2차'});
  assert.equal(p.state().tab,'buys');assert.match(p.ctx.location.hash,/^#alert\?/);assert.deepEqual(p.calls.focused,[]);
  p.ctx.assetStore.doc={allocation:{groups:[{items:[{id:'other',ticker:'OTHER',buyPlan:{}},{id:'target',ticker:'TEST',buyPlan:{}}]}]}};
  for(const fn of p.assetListeners)fn('change');p.flush();
  assert.equal(p.ctx.location.hash,'#buys');assert.deepEqual(p.calls.focused,['target']);
  assert.deepEqual(p.calls.selectedBuys,['target']);
  assert.deepEqual(plain(p.calls.scrolled),[{top:248,behavior:'instant'}]);
});

test('별도 기준선은 같은 종목 계획이나 계획 없는 종목의 알림 규칙을 연다',()=>{
  const p=page({plans:[{id:'target',ticker:'TEST'}]});p.open({ticker:'TEST',line:'60일선'});
  assert.equal(p.state().selectedPlan,'target');assert.equal(p.ctx.location.hash,'#plans');
  const a=page({alerts:{rules:[{id:'rule',ticker:'TEST',period:60,unit:'일선'}]}}),before=a.records();
  const rule=a.node('rule'),details={open:false};rule.dataset.alertRule='rule';rule.closest=()=>details;a.rules.push(rule);
  a.open({ticker:'TEST',line:'60일선'});
  assert.equal(a.nodes.alertsDialog.open,true);assert.equal(details.open,true);assert.deepEqual(a.calls.focused,['rule']);
  assert.equal(a.records(),before);
});

test('매수대기 알림은 같은 종목의 매도 계획 대신 해당 계좌 매수대기 카드로 이동한다',()=>{
  const assets={allocation:{groups:[{items:[{id:'one',ticker:'TEST',buyPlan:{wait:{line:'25개월선'}}},{id:'two',ticker:'TEST',buyPlan:{wait:{line:'25개월선'}}}]}]}};
  const p=page({plans:[{id:'sell',ticker:'TEST'}]},assets),card=p.node('two');card.dataset.purchaseItem='two';p.cards.push(card);
  const before=JSON.stringify(assets);p.open({ticker:'TEST',line:'매수대기 25개월선',ruleId:'trade:buy:two:wait'});
  assert.equal(p.state().tab,'buys');assert.equal(p.ctx.location.hash,'#buys');assert.deepEqual(p.calls.focused,['two']);assert.equal(JSON.stringify(assets),before);
  assert.deepEqual(p.calls.selectedBuys,['two']);
});

test('달러선물 손절·재매수 알림은 해당 화면을 펼치며 기록을 바꾸지 않는다',()=>{
  const p=page({futures:{positions:[],levels:[],rebuy:{}}}),before=p.records();p.open({ticker:'202612',line:'달러선물 신저점 손절 시작'});
  assert.equal(p.state().tab,'futures');assert.equal(p.ctx.futureRebuyExpanded,true);assert.equal(p.records(),before);
});

test('기록이 아직 없으면 기다리고 수동 탭 전환 뒤에는 알림으로 다시 이동하지 않는다',()=>{
  const p=page();p.open({ticker:'TEST',line:'분할매도 첫 매도'});
  assert.match(p.ctx.location.hash,/^#alert\?/);
  p.tabs.find(x=>x.dataset.tab==='rebuy').onclick();
  vm.runInContext('state.plans.push({id:"later",ticker:"TEST"})',p.ctx);p.ctx.render();
  assert.equal(p.state().tab,'rebuy');assert.equal(p.state().selectedPlan,null);
  p.open({ticker:'TEST',line:'분할매도 첫 매도'});assert.equal(p.state().selectedPlan,'later');
});

test('알림 규칙 ID가 있으면 같은 종목의 다른 계획과 구분한다',()=>{
  const p=page({plans:[{id:'one',ticker:'TEST'},{id:'two',ticker:'TEST'}],selectedPlan:'one'});
  p.open({ticker:'TEST',line:'분할매도 첫 매도',ruleId:'trade:plan:two:0'});
  assert.equal(p.state().selectedPlan,'two');
});


test('같은 코드의 다른 계좌가 먼저 복원되어도 정확한 ID가 도착할 때까지 기다린다',async()=>{
  const p=page({}, {allocation:{groups:[{items:[{id:'one',ticker:'TEST',buyPlan:{}}]}]}});
  const other=p.node('one');other.dataset.purchaseItem='one';p.cards.push(other);
  await p.ctx.initializePush();p.open({ticker:'TEST',line:'분할매수 2차',ruleId:'trade:buy:two:stage'});
  assert.match(p.ctx.location.hash,/^#alert\?/);assert.deepEqual(p.calls.selectedBuys,[]);assert.deepEqual(p.calls.focused,[]);
  p.ctx.assetStore.doc.allocation.groups.push({items:[{id:'two',ticker:'TEST',buyPlan:{}}]});
  const target=p.node('two');target.dataset.purchaseItem='two';p.cards.push(target);
  for(const fn of p.assetListeners)fn('change');p.flush();
  assert.deepEqual(p.calls.selectedBuys,['two']);assert.deepEqual(p.calls.focused,['two']);assert.equal(p.ctx.location.hash,'#buys');
});

test('ID 없는 옛 알림의 중복 코드와 삭제된 대상은 다른 종목으로 대체하지 않는다',()=>{
  for(const ruleId of ['', 'trade:plan:deleted:0']){
    const p=page({plans:[{id:'one',ticker:'TEST'},{id:'two',ticker:'TEST'}],selectedPlan:'one'});
    p.open({ticker:'TEST',line:'분할매도 첫 매도',ruleId});
    assert.match(p.ctx.location.hash,/^#alert\?/);assert.deepEqual(p.calls.focused,[]);
  }
});

test('종목 데이터가 있어도 렌더링된 카드가 없으면 목표를 소모하지 않는다',()=>{
  const p=page({}, {allocation:{groups:[{items:[{id:'target',ticker:'TEST',buyPlan:{}}]}]}});
  p.open({ticker:'TEST',line:'분할매수 2차',ruleId:'trade:buy:target:stage'});
  assert.match(p.ctx.location.hash,/^#alert\?/);assert.deepEqual(p.calls.focused,[]);
  const target=p.node('target');target.dataset.purchaseItem='target';p.cards.push(target);p.ctx.render();p.flush();
  assert.equal(p.ctx.location.hash,'#buys');assert.deepEqual(p.calls.focused,['target']);
});

test('로딩·화면 복귀·폰트 준비 후 현재 DOM을 측정하고 한 번 이동한다',async()=>{
  const p=page({plans:[{id:'target',ticker:'TEST'}]});await p.ctx.initializePush();
  p.ctx.document.readyState='loading';p.ctx.document.hidden=true;p.open({ticker:'TEST',line:'분할매도 첫 매도'});
  assert.match(p.ctx.location.hash,/^#alert\?/);assert.deepEqual(p.calls.focused,[]);
  p.ctx.document.readyState='complete';p.events.load();p.flush();assert.deepEqual(p.calls.focused,[]);
  let fontsReady;p.ctx.document.fonts={status:'loading',ready:new Promise(resolve=>fontsReady=resolve)};
  p.ctx.document.hidden=false;p.events.visibilitychange();p.flush();assert.deepEqual(p.calls.focused,[]);
  p.ctx.document.fonts.status='loaded';fontsReady();await Promise.resolve();p.flush();
  assert.equal(p.ctx.location.hash,'#plans');assert.deepEqual(p.calls.focused,['planMain']);
  p.events.visibilitychange();p.flush();assert.deepEqual(p.calls.focused,['planMain']);
});

test('렌더 직후 수동 메뉴 이동은 예약된 스크롤을 취소한다',()=>{
  const p=page({plans:[{id:'target',ticker:'TEST'}]});
  p.ctx.location.hash=p.ctx.pushAlertHash({ticker:'TEST',line:'분할매도 첫 매도'});p.ctx.openPlannerLocation();
  p.tabs.find(x=>x.dataset.tab==='rebuy').onclick();p.flush();
  assert.equal(p.state().tab,'rebuy');assert.deepEqual(p.calls.focused,[]);
});

test('ruleId의 메뉴와 legacy 재매수 ID를 라벨보다 우선한다',()=>{
  const p=page({rebuy:{ticker:'TEST'}}),before=p.records();
  p.open({ticker:'TEST',line:'분할매도 첫 매도',ruleId:'trade:rebuy:legacy-0:breakdown'});
  assert.equal(p.state().tab,'rebuy');assert.deepEqual(p.calls.focused,['rebuyMain']);assert.equal(p.records(),before);
  const r=page({plans:[{id:'plan',ticker:'TEST'}],alerts:{rules:[{id:'rule',ticker:'TEST',period:60,unit:'일선'}]}});
  const node=r.node('rule');node.dataset.alertRule='rule';r.rules.push(node);
  r.open({ticker:'TEST',line:'60일선',ruleId:'rule'});assert.equal(r.nodes.alertsDialog.open,true);assert.deepEqual(r.calls.focused,['rule']);
});

test('포커스 실패로 닫힌 클라이언트는 새 플래너로 연다',async()=>{
  const {push,click,calls}=worker([{url:scope,async navigate(){return this;},async focus(){throw Error('closed');}}]);
  const notice=await push({ticker:'TEST',line:'분할매도 첫 매도'});await click(notice.data);
  assert.deepEqual(calls.opened,[notice.data.url]);
});
