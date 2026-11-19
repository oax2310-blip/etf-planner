const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/alerts.js'), 'utf8');
const prices = fs.readFileSync(path.join(__dirname, '../js/prices.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const valid = extra => ({ticker:'TEST',period:60,unit:'일선',tolerancePct:0.5,enabled:true,...extra});
function load(initial={}){
  let serial=0;
  const ctx=vm.createContext({state:initial,id:()=>`test-${++serial}`});
  vm.runInContext(prices+'\n'+source,ctx);
  return ctx;
}

test('알림을 읽거나 빈 목록을 그리는 것만으로 새 동기화 필드를 만들지 않는다',()=>{
  assert.doesNotThrow(()=>vm.runInNewContext(source,{}),'파일 로드에는 DOM이 필요하지 않아야 한다');
  const ctx=load({plans:[]}), before=JSON.stringify(ctx.state);
  const nodes={alertsList:{},alertsCount:{},alertsSaveStatus:{classList:{toggle(){}}}};
  ctx.$=name=>nodes[name];ctx.$$=()=>[];ctx.connected=()=>false;ctx.sync={};ctx.onEdit=()=>{};
  assert.equal(vm.runInContext('alertRules().length',ctx),0);
  ctx.renderAlerts();
  assert.equal(JSON.stringify(ctx.state),before);
  assert.match(nodes.alertsSaveStatus.textContent,/이 기기에만 저장/);
  assert.match(nodes.alertsList.innerHTML,/등록한 알림이 없습니다/);
});

test('잘못된 알림 저장은 새 필드도 만들지 않고 기존 수신 설정도 바꾸지 않는다',()=>{
  const ctx=load();
  for(const input of [valid({ticker:''}),valid({period:0}),valid({period:401}),valid({period:1.5}),valid({period:''}),valid({unit:'분봉'}),valid({tolerancePct:''}),valid({tolerancePct:-1}),valid({tolerancePct:11}),valid({tolerancePct:Infinity})]){
    assert.ok(ctx.writeAlertRule(input).error);
    assert.equal(ctx.state.alerts,undefined);
  }
  ctx.state.alerts={subscriptions:[{endpoint:'https://push.example.test/one'}],rules:[]};
  const before=JSON.stringify(ctx.state);
  assert.ok(ctx.writeAlertRule(valid({ticker:'한글종목'})).error);
  assert.equal(JSON.stringify(ctx.state),before);
});

test('한국장 재알림은 기본 OFF이며 읽기·렌더링은 기록을 만들지 않는다',()=>{
  const ctx=load({plans:[]}),before=JSON.stringify(ctx.state);
  const nodes={krOpenReminder:{},krOpenReminderStatus:{}};
  ctx.$=name=>nodes[name];ctx.onEdit=()=>{};
  assert.equal(vm.runInContext('krOpenReminderEnabled()',ctx),false);
  ctx.renderKrOpenReminder();
  assert.equal(nodes.krOpenReminder.checked,false);
  assert.equal(nodes.krOpenReminderStatus.textContent,'OFF');
  assert.equal(ctx.setKrOpenReminder(false),false);
  assert.equal(JSON.stringify(ctx.state),before);
});

test('한국장 재알림 설정은 규칙·기기 구독을 보존하고 켜고 끌 수 있다',()=>{
  const configured={rules:[{id:'r1',...valid()}],subscriptions:[{endpoint:'https://push.example.test/one'}],futureSetting:'keep'};
  const ctx=load({alerts:plain(configured)});
  assert.equal(ctx.setKrOpenReminder(true),true);
  assert.equal(vm.runInContext('krOpenReminderEnabled()',ctx),true);
  assert.equal(ctx.setKrOpenReminder(true),false);
  const nodes={krOpenReminder:{},krOpenReminderStatus:{}};
  let binding;
  ctx.$=name=>nodes[name];ctx.onEdit=(selector,write,redraw)=>{binding={selector,write,redraw};};
  ctx.renderKrOpenReminder();
  assert.equal(nodes.krOpenReminder.checked,true);
  assert.equal(nodes.krOpenReminderStatus.textContent,'ON');
  assert.equal(binding.selector,'#krOpenReminder');
  assert.equal(binding.write('',{checked:false}),true);
  binding.redraw();
  assert.equal(nodes.krOpenReminder.checked,false);
  assert.deepEqual(plain(ctx.state.alerts),{...configured,krOpenReminder:false});
});

test('수집기가 지원하는 국내 코드와 미국 심볼을 저장하고 공백·대소문자를 맞춘다',()=>{
  const ctx=load();
  for(const ticker of ['000001','A000001','Q000001','1AB2CD','TEST','TEST.A','TEST-A','TEST/A'])assert.equal(ctx.alertTickerValid(ticker),true,ticker);
  for(const ticker of ['','00001','한국ETF','TEST$','TEST WITH SPACE','TESTABCDEFGHI'])assert.equal(ctx.alertTickerValid(ticker),false,ticker);
  const result=ctx.writeAlertRule(valid({ticker:' test.a '}));
  assert.equal(result.value.ticker,'TEST.A');
  assert.equal(ctx.state.alerts.rules[0].ticker,'TEST.A');
});

test('알림 수정·일시 중지·마지막 삭제가 수신 설정과 기존 필드를 보존한다',()=>{
  const ctx=load({alerts:{subscriptions:[{endpoint:'https://push.example.test/one'}],futureSetting:'keep',rules:[]}});
  const first=ctx.writeAlertRule(valid()).value;
  assert.equal(ctx.setAlertRuleEnabled(first.id,false),true);
  const edited=ctx.writeAlertRule(valid({period:400,unit:'개월선',tolerancePct:0,enabled:false}),first.id).value;
  assert.equal(edited.id,first.id);
  assert.equal(edited.enabled,false);
  assert.equal(ctx.state.alerts.rules.length,1);
  assert.equal(ctx.state.alerts.futureSetting,'keep');
  assert.deepEqual(plain(ctx.state.alerts.subscriptions),[{endpoint:'https://push.example.test/one'}]);
  assert.equal(ctx.removeAlertRule(first.id),true);
  assert.deepEqual(plain(ctx.state.alerts.rules),[]);
  assert.equal(ctx.state.alerts.subscriptions.length,1);
  assert.equal(ctx.removeAlertRule(first.id),false);
});

test('같은 종목·기준선 중복과 다른 기기에서 삭제한 규칙의 저장을 거부한다',()=>{
  const ctx=load(), first=ctx.writeAlertRule(valid()).value;
  const before=JSON.stringify(ctx.state);
  assert.ok(ctx.writeAlertRule(valid({ticker:'test',tolerancePct:1})).error);
  assert.ok(ctx.writeAlertRule(valid(),'deleted-on-other-device').error);
  assert.equal(JSON.stringify(ctx.state),before);
  assert.equal(ctx.writeAlertRule(valid({unit:'주선'})).value.unit,'주선');
  assert.ok(ctx.writeAlertRule(valid({unit:'주선'}),first.id).error,'수정도 다른 규칙과 중복할 수 없다');
});

test('마지막 시세의 가격·기준선·간격을 표시하고 허용 범위 경계를 정확히 포함한다',()=>{
  const ctx=load(), rule=valid({period:2}), quote={kind:'해외',asOf:'2026-10-02',close:100.5,ma:{},closes:{D:[99,101]}};
  const data={stocks:{TEST:quote}};
  const info=ctx.alertQuoteInfo(rule,data);
  assert.equal(info.current,100.5);assert.equal(info.line,100);assert.ok(Math.abs(info.gapPct-0.5)<1e-10);assert.equal(info.near,true);
  quote.close=100.5001;assert.equal(ctx.alertQuoteInfo(rule,data).near,false);
  quote.close=99.5;assert.equal(ctx.alertQuoteInfo(rule,data).near,true);
  rule.period=3;assert.equal(ctx.alertQuoteInfo(rule,data).line,null);
  assert.equal(ctx.alertQuoteInfo(rule,null).current,null);
});

test('비트코인 BTC-USD를 알림 종목으로 받고 가격을 달러로 표시한다',()=>{
  const ctx=load();
  assert.equal(ctx.writeAlertRule(valid({ticker:' btc-usd ',period:20,unit:'주선'})).value.ticker,'BTC-USD');
  assert.match(ctx.alertRuleInput(valid({ticker:'비트코인'})).error,/BTC-USD/);
  Object.assign(ctx,{esc:v=>String(v),priceText:(v,c)=>`${c} ${v}`,priceStamp:()=>'',
    priceData:{stocks:{'BTC-USD':{kind:'코인',asOf:'2026-10-03',close:65432.1,ma:{'20주선':65000}}}}});
  const html=ctx.alertRuleCard(ctx.state.alerts.rules[0]);
  assert.match(html,/USD 65432\.1/);
  assert.match(html,/USD 65000/);
});

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const pageLeaveSource=fs.readFileSync(path.join(__dirname,'../js/page-leave.js'),'utf8');

function loadAlertDialogContext(initial={}){
  const ctx=load(initial);
  const events=new Map(),timers=new Map();
  let saves=0,editorClosed=0,timerId=0,now=0;
  function element(tagName){
    const map=new Map();
    return {tagName,children:[],attributes:{},className:'',textContent:'',dataset:{},
      setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},
      removeAttribute(k){delete this.attributes[k];},get open(){return Object.hasOwn(this.attributes,'open');},
      addEventListener(type,fn){if(!map.has(type))map.set(type,new Set());map.get(type).add(fn);},
      removeEventListener(type,fn){map.get(type)?.delete(fn);},
      emit(type,extra={}){for(const fn of [...(map.get(type)||[])])fn({type,target:this,...extra});},
      append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},
      remove(){const p=this.parentElement;if(p)p.children.splice(p.children.indexOf(this),1);this.parentElement=null;},
      closest(sel){if(sel==='dialog[open]'&&this.tagName==='dialog'&&Object.hasOwn(this.attributes,'open'))return this;return this.parentElement?.closest(sel)||null;},
      showPopover(){this.popoverOpen=true;}};
  }
  const body=element('body'),dialog=element('dialog'),removeBtn=element('button');
  dialog.setAttribute('open','');dialog.append(removeBtn);body.append(dialog);
  const nodes={
    alertsDialog:dialog,conflictDialog:element('dialog'),
    alertsList:{},alertsCount:{},alertsSaveStatus:{classList:{toggle(){}}},
    alertForm:{hidden:false},alertFormError:{}
  };
  Object.assign(ctx,{
    $:id=>nodes[id],$$:sel=>sel==='[data-remove-alert]'?[removeBtn]:[],
    esc:v=>String(v??''),priceText:(v,c)=>`${c} ${v}`,priceStamp:()=>'',priceData:null,
    connected:()=>true,sync:{busy:false,running:null,blocked:false,failed:false},onEdit:()=>{},
    save:()=>{saves++;},
    document:{body,createElement:element,addEventListener:(type,fn)=>events.set(type,fn)},
    URL,location:{href:'https://example.test/index.html',origin:'https://example.test',assign(){}},
    console:{error(){}},addEventListener:(type,fn)=>events.set(type,fn),
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,at:now+ms});return timerId;},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(pageLeaveSource+'\n;globalThis.pageLeave=pageLeave;',ctx);
  const origClose=ctx.closeAlertEditor;
  ctx.closeAlertEditor=()=>{editorClosed++;origClose();};
  const findWaiting=node=>node.className==='page-leave'?node:node.children.map(findWaiting).find(Boolean);
  async function advance(ms){
    now+=ms;
    for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}
    await turn();await turn();
  }
  return {ctx,body,dialog,removeBtn,nodes,events,timers,advance,saves:()=>saves,editorClosed:()=>editorClosed,waiting:()=>findWaiting(body)};
}

test('동기화 중 알림 규칙 삭제를 누르면 진행 중 화면을 띄우고 완료 후 삭제한다',async()=>{
  const h=loadAlertDialogContext(),syncRun=deferred();
  const rule=h.ctx.writeAlertRule(valid()).value;
  h.removeBtn.dataset.removeAlert=rule.id;
  h.ctx.renderAlerts();
  h.ctx.sync.busy=true;h.ctx.sync.running=syncRun.promise;
  h.removeBtn.onclick();
  const overlay=h.waiting();
  assert.ok(overlay,'동기화 중 규칙 삭제 클릭 시 진행 중 화면이 즉시 보여야 한다');
  assert.equal(overlay.parentElement,h.dialog,'알림 설정 창 안에 표시해야 한다');
  assert.equal(overlay.children[0].children[1].textContent,'동기화 진행 중…');
  assert.equal(overlay.children[1].textContent,'동기화 진행 중… 최대 4초까지 기다린 뒤 삭제를 진행합니다.');
  // 마이크로태스크를 비워도 동기화가 끝나기 전에는 대기 화면을 유지하고 삭제하지 않는다.
  await turn();await turn();
  assert.equal(h.waiting(),overlay,'동기화 진행 중에는 마이크로태스크 이후에도 진행 중 화면을 유지해야 한다');
  assert.equal(h.ctx.state.alerts.rules.length,1,'동기화 완료 전에는 규칙을 삭제하지 않는다');
  assert.equal(h.saves(),0,'동기화 완료 전에는 저장을 호출하지 않는다');
  h.ctx.sync.running=null;h.ctx.sync.busy=false;syncRun.resolve();
  await turn();
  assert.equal(h.waiting(),undefined);
  assert.equal(h.ctx.state.alerts.rules.length,0);
  assert.equal(h.saves(),1);
});

test('알림 규칙 삭제는 동기화가 4초 넘게 끝나지 않으면 삭제를 진행하되 충돌 상태면 취소한다',async t=>{
  await t.test('4초 경과 후 규칙 삭제 진행',async()=>{
    const h=loadAlertDialogContext(),syncRun=deferred();
    const rule=h.ctx.writeAlertRule(valid()).value;
    h.removeBtn.dataset.removeAlert=rule.id;
    h.ctx.renderAlerts();
    h.ctx.sync.busy=true;h.ctx.sync.running=syncRun.promise;
    h.removeBtn.onclick();
    await h.advance(3999);
    assert.ok(h.waiting(),'4초 전에는 대기 화면을 유지한다');
    assert.equal(h.ctx.state.alerts.rules.length,1);
    assert.equal(h.saves(),0);
    await h.advance(1);
    assert.equal(h.waiting(),undefined,'4초 경과 후 대기 화면을 닫는다');
    assert.equal(h.ctx.state.alerts.rules.length,0,'4초 경과 후 규칙을 삭제한다');
    assert.equal(h.saves(),1);
  });

  for(const reason of ['sync.blocked','conflictDialog 열림'])await t.test(`4초 경과 시 ${reason}이면 규칙 삭제 취소`,async()=>{
    const h=loadAlertDialogContext(),syncRun=deferred();
    const rule=h.ctx.writeAlertRule(valid()).value;
    h.removeBtn.dataset.removeAlert=rule.id;
    h.ctx.renderAlerts();
    h.ctx.sync.busy=true;h.ctx.sync.running=syncRun.promise;
    h.removeBtn.onclick();
    assert.ok(h.waiting());
    if(reason==='sync.blocked')h.ctx.sync.blocked=true;
    else h.nodes.conflictDialog.setAttribute('open','');
    await h.advance(4000);
    assert.equal(h.waiting(),undefined);
    assert.equal(h.ctx.state.alerts.rules.length,1);
    assert.equal(h.saves(),0);
  });
});

test('동기화 대기 중 알림 설정 창 닫힘·충돌 발생 시 규칙 삭제를 취소하고 평상시에는 즉시 삭제한다',async()=>{
  const h=loadAlertDialogContext();
  const first=h.ctx.writeAlertRule(valid()).value;
  const second=h.ctx.writeAlertRule(valid({unit:'주선'})).value;
  h.removeBtn.dataset.removeAlert=first.id;
  h.ctx.renderAlerts();

  // 창 닫힘 취소
  const run1=deferred();
  h.ctx.sync.busy=true;h.ctx.sync.running=run1.promise;
  h.removeBtn.onclick();assert.ok(h.waiting());
  h.dialog.removeAttribute('open');h.dialog.emit('close');
  h.ctx.sync.running=null;h.ctx.sync.busy=false;run1.resolve();
  await turn();
  assert.equal(h.ctx.state.alerts.rules.length,2);

  // 충돌(sync.blocked) 시 취소
  h.dialog.setAttribute('open','');
  const run2=deferred();
  h.ctx.sync.busy=true;h.ctx.sync.running=run2.promise;
  h.removeBtn.onclick();assert.ok(h.waiting());
  h.ctx.sync.blocked=true;h.ctx.sync.running=null;h.ctx.sync.busy=false;run2.resolve();
  await turn();
  assert.equal(h.ctx.state.alerts.rules.length,2);

  // 충돌 창(conflictDialog) 열림 시 취소
  h.ctx.sync.blocked=false;
  const run3=deferred();
  h.ctx.sync.busy=true;h.ctx.sync.running=run3.promise;
  h.removeBtn.onclick();assert.ok(h.waiting());
  h.nodes.conflictDialog.setAttribute('open','');
  h.ctx.sync.running=null;h.ctx.sync.busy=false;run3.resolve();
  await turn();
  assert.equal(h.ctx.state.alerts.rules.length,2);

  // 평상시 즉시 삭제
  h.nodes.conflictDialog.removeAttribute('open');
  h.removeBtn.dataset.removeAlert=second.id;
  h.removeBtn.onclick();
  assert.equal(h.waiting(),undefined);
  assert.deepEqual(plain(h.ctx.state.alerts.rules.map(r=>r.id)),[first.id]);
});

test('알림 규칙 목록이 같으면 renderAlerts가 DOM innerHTML을 불필요하게 교체하지 않고 체크 상태만 맞춘다',()=>{
  const h=loadAlertDialogContext();
  const rule=h.ctx.writeAlertRule(valid()).value;
  let writes=0,markup='';
  const checkbox={dataset:{alertEnabled:rule.id},checked:false};
  h.nodes.alertsList={
    querySelector(){return null;},
    get firstChild(){return markup?{}:null;},
    get innerHTML(){return markup;},
    set innerHTML(v){writes++;markup=v;}
  };
  h.ctx.$$=sel=>sel==='[data-alert-enabled]'?[checkbox]:[];
  h.ctx.renderAlerts();
  assert.equal(writes,1);
  checkbox.checked=false;
  h.ctx.renderAlerts();
  assert.equal(writes,1,'동일한 규칙 목록으로 다시 그릴 때 DOM을 갈아엎지 않아야 한다');
  assert.equal(checkbox.checked,true,'DOM을 유지할 때도 체크 상태를 현재 규칙과 맞춰야 한다');
  h.ctx.setAlertRuleEnabled(rule.id,false);
  h.ctx.renderAlerts();
  assert.equal(writes,2,'규칙 상태가 바뀌면 마크업을 갱신해야 한다');
});

test('알림 규칙 목록을 누르면 목록·상태를 유지하고 클릭 뒤 원래 규칙 삭제와 새 규칙을 그린다',async()=>{
  const h=loadAlertDialogContext(),list=new EventTarget();
  h.nodes.alertsList=list;
  for(const name of ['alertsBtn','closeAlerts','addAlertBtn','cancelAlertEdit'])h.nodes[name]={};
  h.ctx.initializeAlerts();
  const first=h.ctx.writeAlertRule(valid()).value;
  h.removeBtn.dataset.removeAlert=first.id;
  h.ctx.renderAlerts();
  const before=list.innerHTML,statusBefore=h.nodes.alertsSaveStatus.textContent;

  list.dispatchEvent(Object.assign(new Event('pointerdown'),{button:0,pointerId:7}));
  const fresh=h.ctx.writeAlertRule(valid({ticker:'NEW'})).value;
  h.ctx.state.alerts.rules.reverse();
  h.ctx.sync.failed=true;
  h.ctx.renderAlerts();
  assert.equal(list.innerHTML,before,'누르는 동안 바뀐 규칙을 그리지 않는다');
  assert.equal(h.nodes.alertsSaveStatus.textContent,statusBefore);
  assert.equal(h.nodes.alertsCount.textContent,'1개');

  h.events.get('pointerup')({pointerId:7,pointerType:'touch'});
  await h.advance(0);
  assert.equal(list.innerHTML,before);
  h.events.get('click')({pointerId:7,detail:1});
  h.removeBtn.onclick();
  assert.equal(h.saves(),1);
  assert.deepEqual(plain(h.ctx.state.alerts.rules.map(rule=>rule.id)),[fresh.id]);
  assert.equal(list.innerHTML,before);
  await h.advance(0);
  assert.match(list.innerHTML,/NEW/);
  assert.doesNotMatch(list.innerHTML,/TEST/);
  assert.match(h.nodes.alertsSaveStatus.textContent,/동기화를 확인/);
});
