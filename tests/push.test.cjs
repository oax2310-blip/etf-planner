const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/push.js'), 'utf8');
const publicBytes = Uint8Array.from({length:65}, (_, i) => i === 0 ? 4 : i);
const publicKey = Buffer.from(publicBytes).toString('base64url');
const plain = value => JSON.parse(JSON.stringify(value));

function load({initial={},permission='granted',ready=true,syncMode='complete',existing=true,pc=false,onShowNotification=null}={}){
  const calls = {permission:0,register:0,subscribe:0,unsubscribe:0,save:0,order:[]};
  const testStats = {sync:0,showNotification:0,shown:[]};
  const classes = new Set();
  const alertsBtn = {
    title:'알림내역',ariaLabel:'알림',
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
    setAttribute(name,value){if(name==='aria-label')this.ariaLabel=value;else this[name]=value;}
  };
  const nodes = {pushSetup:{},enablePhonePush:{},testPhonePush:{},disablePhonePush:{},alertsBtn,alertsUnreadBadge:{hidden:true,textContent:''}};
  const storage = new Map();
  const subscription = {
    endpoint:'https://push.example.test/device',
    options:{applicationServerKey:publicBytes.buffer},
    toJSON(){return {endpoint:this.endpoint,expirationTime:null,keys:{p256dh:'test-key',auth:'test-auth'}};},
    async unsubscribe(){calls.unsubscribe++;return true;}
  };
  const notification = {
    permission,
    async requestPermission(){calls.permission++;calls.order.push('permission');this.permission=typeof permission==='function'?permission():'granted';return this.permission;}
  };
  const registration = {active:true,
    async showNotification(...args){testStats.showNotification++;calls.order.push('showNotification');testStats.shown.push(args);if(onShowNotification)return await onShowNotification(...args);},
    pushManager:{
      async getSubscription(){return existing?subscription:null;},
      async subscribe(){calls.subscribe++;calls.order.push('subscribe');return subscription;}
    }};
  const serviceWorker = {
    async getRegistration(){return registration;},
    async register(){calls.register++;calls.order.push('register');return registration;},
    ready:Promise.resolve(registration)
  };
  const ctx = vm.createContext({
    state:plain(initial),sync:{repo:'owner/private-data',token:'test',base:'{}',busy:syncMode==='busy',failed:false,blocked:false},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{isSecureContext:true,PushManager:function(){},Notification:notification},
    navigator:{serviceWorker},Notification:notification,
    addEventListener(){},document:{addEventListener(){},baseURI:'https://example.test/etf-planner/'},URL,Uint8Array,atob,setTimeout,clearTimeout,
    assetStore:{subscribe(){}},
    $:name=>nodes[name],id:()=> 'device-test',esc:value=>String(value),
    connected:()=>!!ctx.sync.token,
    save:()=>{calls.save++;},
    ...(pc?{matchMedia:query=>({matches:query==='(hover:hover) and (pointer:fine)'})}:{})
  });
  ctx.syncNow=async()=>{
    testStats.sync++;
    if(syncMode==='busy'){ctx.sync.again=true;return;}
    if(syncMode==='failed'){ctx.sync.failed=true;return;}
    if(syncMode==='discard'){ctx.state.alerts.subscriptions=[];}
    ctx.sync.base=JSON.stringify(ctx.state);
  };
  vm.runInContext(source,ctx);
  vm.runInContext(`pushConfig={repo:sync.repo,publicKey:${JSON.stringify(publicKey)},ready:${ready}}`,ctx);
  return {ctx,calls,testStats,nodes,subscription,storage,notification,registration,message:()=>vm.runInContext('pushMessage',ctx)};
}

const savedDevice = (endpoint='https://push.example.test/device',deviceId='device-test') => ({alerts:{rules:[],subscriptions:[{id:deviceId,subscription:{endpoint}}]}});
const changedMessage = '이 기기의 알림 연결이 끊겼거나 바뀌었습니다. 알림 연결 확인을 눌러 다시 연결해 주세요.';

test('이 기기에 저장된 구독이 브라우저에서 사라지면 다시 연결할 상태임을 읽기 전용으로 표시한다',async()=>{
  const {ctx,calls,nodes,storage}=load({initial:savedDevice(),existing:false,permission:'default'});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  const before=JSON.stringify(ctx.state),storedBefore=[...storage];
  ctx.renderPushSetup();
  assert.equal(ctx.pushConnectionChanged(),false,'브라우저 구독을 조회하기 전에는 연결 끊김으로 단정하지 않는다');
  assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),false);
  await ctx.initializePush();
  ctx.renderPushSetup();
  assert.equal(ctx.pushConnectionChanged(),true);
  assert.ok(nodes.pushSetup.innerHTML.includes(changedMessage));
  assert.match(nodes.pushSetup.innerHTML,/id="enablePhonePush"[^>]*>알림 연결 확인<\/button>/);
  assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),true);
  assert.match(nodes.alertsBtn.title,/알림 연결 확인/);
  assert.match(nodes.alertsBtn.ariaLabel,/알림 연결 확인/);
  assert.equal(JSON.stringify(ctx.state),before);
  assert.deepEqual([...storage],storedBefore);
  assert.deepEqual(calls,{permission:0,register:0,subscribe:0,unsubscribe:0,save:0,order:[]});
});

test('이 기기에 저장된 주소와 브라우저의 현재 구독 주소가 다르면 연결 변경을 알린다',async()=>{
  const {ctx,calls,nodes,storage}=load({initial:savedDevice('https://push.example.test/old-device')});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  const before=JSON.stringify(ctx.state),storedBefore=[...storage];
  await ctx.initializePush();
  assert.equal(ctx.pushConnectionChanged(),true);
  assert.ok(nodes.pushSetup.innerHTML.includes(changedMessage));
  assert.match(nodes.pushSetup.innerHTML,/id="enablePhonePush"[^>]*>알림 연결 확인<\/button>/);
  assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),true);
  assert.equal(JSON.stringify(ctx.state),before);
  assert.deepEqual([...storage],storedBefore);
  assert.deepEqual(calls,{permission:0,register:0,subscribe:0,unsubscribe:0,save:0,order:[]});
});

test('이 기기의 저장 주소와 현재 구독이 같으면 연결 변경 경고를 없앤다',async()=>{
  const {ctx,nodes}=load({initial:savedDevice()});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  ctx.sync.base=JSON.stringify(ctx.state);
  nodes.alertsBtn.classList.toggle('push-connection-warning',true);
  nodes.alertsBtn.title='알림내역 · 이 기기의 알림 연결 확인 필요';
  nodes.alertsBtn.ariaLabel='알림, 이 기기의 알림 연결 확인 필요';
  await ctx.initializePush();
  assert.equal(ctx.pushConnectionChanged(),false);
  assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),false);
  assert.equal(nodes.alertsBtn.title,'알림내역');
  assert.equal(nodes.alertsBtn.ariaLabel,'알림');
  assert.match(nodes.pushSetup.innerHTML,/이 휴대폰에 알림이 연결되어 있습니다/);
  assert.ok(!nodes.pushSetup.innerHTML.includes(changedMessage));
});

test('다른 기기만 저장되어 있으면 이 기기의 연결 변경으로 표시하지 않는다',async()=>{
  const {ctx,nodes}=load({initial:savedDevice('https://push.example.test/other-device','device-other'),existing:false});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  await ctx.initializePush();
  assert.equal(ctx.pushConnectionChanged(),false);
  assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),false);
  assert.match(nodes.pushSetup.innerHTML,/id="enablePhonePush"[^>]*>알림 받기<\/button>/);
  assert.ok(!nodes.pushSetup.innerHTML.includes(changedMessage));
});

test('상단 연결 경고는 읽지 않은 알림 수를 보존하고 정상 연결 뒤에 함께 갱신된다',async()=>{
  const {ctx,nodes,subscription}=load({initial:savedDevice('https://push.example.test/old-device')});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  nodes.alertsUnreadBadge.hidden=false;nodes.alertsUnreadBadge.textContent='3';
  await ctx.initializePush();
  ctx.renderPushConnectionStatus(3);
  assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),true);
  assert.match(nodes.alertsBtn.ariaLabel,/읽지 않은 알림 3개/);
  assert.match(nodes.alertsBtn.ariaLabel,/알림 연결 확인/);
  assert.equal(nodes.alertsUnreadBadge.hidden,false);
  assert.equal(nodes.alertsUnreadBadge.textContent,'3');
  ctx.state.alerts.subscriptions[0].subscription.endpoint=subscription.endpoint;
  ctx.renderPushConnectionStatus(3);
  assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),false);
  assert.equal(nodes.alertsBtn.title,'알림내역');
  assert.equal(nodes.alertsBtn.ariaLabel,'알림, 읽지 않은 알림 3개');
});

test('연결 변경 판단은 동기화·브라우저 지원·발송 준비·기존 기기 ID가 필요하고 새 ID를 만들지 않는다',async t=>{
  for(const reason of ['disconnected','unsupported','not-ready','no-device-id'])await t.test(reason,async()=>{
    const {ctx,nodes,storage}=load({initial:savedDevice(),existing:false,ready:reason!=='not-ready'});
    if(reason!=='no-device-id')ctx.localStorage.setItem('etf-planner-push-device','device-test');
    if(reason==='disconnected')ctx.sync.token='';
    if(reason==='unsupported')delete ctx.window.PushManager;
    const before=JSON.stringify(ctx.state),storedBefore=[...storage];
    await ctx.initializePush();
    assert.equal(ctx.pushConnectionChanged(),false);
    assert.equal(nodes.alertsBtn.classList.contains('push-connection-warning'),false);
    assert.deepEqual([...storage],storedBefore);
    assert.equal(JSON.stringify(ctx.state),before);
  });
});

test('연결이 끊겨도 알림 차단 안내가 우선하고 기존 키·만료·동기화 안내 순서를 유지한다',async()=>{
  const blocked=load({initial:savedDevice(),existing:false,permission:'denied'});
  blocked.ctx.localStorage.setItem('etf-planner-push-device','device-test');
  await blocked.ctx.initializePush();
  assert.equal(blocked.ctx.pushConnectionChanged(),true);
  assert.match(blocked.nodes.pushSetup.innerHTML,/알림이 차단되어 있습니다/);
  assert.ok(!blocked.nodes.pushSetup.innerHTML.includes(changedMessage));

  const {ctx,nodes,subscription}=load({initial:savedDevice()});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  await ctx.initializePush();
  subscription.options.applicationServerKey=new Uint8Array(65).buffer;
  ctx.renderPushSetup();
  assert.match(nodes.pushSetup.innerHTML,/알림 연결키가 바뀌었습니다/);
  vm.runInContext('pushConfig.inactiveDeviceIds=["device-test"]',ctx);
  ctx.renderPushSetup();
  assert.match(nodes.pushSetup.innerHTML,/연결이 만료되었습니다/);
  ctx.sync.failed=true;
  ctx.renderPushSetup();
  assert.match(nodes.pushSetup.innerHTML,/동기화를 완료해야 발송 서버에 반영/);
});

test('진행 중인 동기화는 휴대폰 연결 성공으로 표시하지 않는다',async()=>{
  const {ctx,calls,nodes,message}=load({syncMode:'busy'});
  await ctx.enablePhonePush();
  assert.equal(calls.save,1);
  assert.equal(ctx.sync.busy,true);
  assert.equal(ctx.pushIsSaved(),true);
  assert.equal(ctx.pushRemoteHas('https://push.example.test/device'),false);
  assert.match(message(),/동기화를 완료하면/);
  assert.doesNotMatch(message(),/알림을 연결했습니다/);
  assert.match(nodes.pushSetup.innerHTML,/동기화가 끝나면 발송 서버에 반영/);
  assert.doesNotMatch(nodes.pushSetup.innerHTML,/플래너를 닫아도 조건에 맞는/);
});

test('충돌에서 다른 기록을 선택해 구독을 버렸으면 연결 성공을 표시하지 않는다',async()=>{
  const {ctx,nodes,message}=load({syncMode:'discard'});
  await ctx.enablePhonePush();
  assert.equal(ctx.pushIsSaved(),false);
  assert.equal(ctx.pushRemoteHas('https://push.example.test/device'),false);
  assert.match(message(),/연결이 저장되지 않았습니다/);
  assert.doesNotMatch(message(),/알림을 연결했습니다/);
  assert.doesNotMatch(nodes.pushSetup.innerHTML,/이 휴대폰에 알림이 연결되어 있습니다/);
});

test('업로드 실패 후에는 기기 저장만 안내하고 원격 반영 뒤에 연결 완료를 표시한다',async()=>{
  const {ctx,nodes,message}=load({syncMode:'failed'});
  await ctx.enablePhonePush();
  assert.match(message(),/이 기기에는 저장/);
  assert.doesNotMatch(nodes.pushSetup.innerHTML,/플래너를 닫아도 조건에 맞는/);
  ctx.sync.failed=false;
  ctx.sync.base=JSON.stringify(ctx.state);
  ctx.renderPushSetup();
  assert.match(nodes.pushSetup.innerHTML,/이 휴대폰에 알림이 연결되어 있습니다/);
});

test('발송 서버 준비 상태만으로 기기에 저장된 미동기화 구독을 연결 완료로 표시하지 않는다',async()=>{
  const initial={alerts:{rules:[],subscriptions:[{id:'device-test',subscription:{endpoint:'https://push.example.test/device'}}]}};
  const {ctx,nodes}=load({initial});
  await ctx.initializePush();
  assert.equal(ctx.pushReady(),true);
  assert.equal(ctx.pushIsSaved(),true);
  assert.match(nodes.pushSetup.innerHTML,/동기화가 끝나면 발송 서버에 반영/);
  assert.doesNotMatch(nodes.pushSetup.innerHTML,/플래너를 닫아도 조건에 맞는/);
});

test('페이지 초기화와 연결 상태 확인은 알림 권한을 요청하거나 새 구독을 만들지 않는다',async()=>{
  const {ctx,calls}=load({permission:'default',existing:false});
  const before=JSON.stringify(ctx.state);
  await ctx.initializePush();
  ctx.renderPushSetup();
  assert.equal(calls.permission,0);
  assert.equal(calls.register,0);
  assert.equal(calls.subscribe,0);
  assert.equal(calls.save,0);
  assert.equal(JSON.stringify(ctx.state),before);
});

test('알림 받기 버튼에서 권한을 먼저 요청하고 원격 저장된 구독만 연결 성공으로 안내한다',async()=>{
  const {ctx,calls,nodes,message}=load({permission:'default',existing:false});
  ctx.renderPushSetup();
  assert.equal(calls.permission,0);
  await nodes.enablePhonePush.onclick();
  assert.deepEqual(calls.order,['permission','register','subscribe']);
  assert.equal(ctx.pushRemoteHas('https://push.example.test/device'),true);
  assert.match(message(),/알림을 연결했습니다/);
  assert.match(nodes.pushSetup.innerHTML,/플래너를 닫아도 조건에 맞는/);
});

test('발송 설정이 준비되지 않은 상태에서는 권한도 구독도 요청하지 않는다',async()=>{
  const {ctx,calls}=load({permission:'default',ready:false,existing:false});
  await ctx.enablePhonePush();
  assert.equal(calls.permission,0);
  assert.equal(calls.register,0);
  assert.equal(calls.subscribe,0);
  assert.equal(calls.save,0);
});

test('발송 서버에서 만료된 구독은 기존 키가 같아도 다시 구독한다',async()=>{
  const initial={alerts:{rules:[],subscriptions:[{id:'device-test',subscription:{endpoint:'https://push.example.test/device'}}]}};
  const {ctx,calls,nodes}=load({initial});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  vm.runInContext('pushConfig.inactiveDeviceIds=["device-test"]',ctx);
  await ctx.initializePush();
  assert.match(nodes.pushSetup.innerHTML,/연결이 만료/);
  await ctx.enablePhonePush();
  assert.equal(calls.unsubscribe,1);
  assert.equal(calls.subscribe,1);
  assert.equal(ctx.state.alerts.subscriptions.length,1);
});

test('이 기기 알림을 해제해도 서버 기록이 남아 있으면 동기화가 필요하다고 안내한다',async()=>{
  const {ctx,calls,message}=load({syncMode:'busy'});
  await ctx.initializePush();
  ctx.state.alerts={rules:[],subscriptions:[{id:'device-test',subscription:{endpoint:'https://push.example.test/device'}}]};
  ctx.sync.base=JSON.stringify(ctx.state);
  await ctx.disablePhonePush();
  assert.equal(calls.unsubscribe,1);
  assert.equal(ctx.pushIsSaved(),false);
  assert.deepEqual(plain(ctx.state.alerts.subscriptions),[]);
  assert.match(message(),/저장소에도 반영하려면 동기화를 완료/);
});

test('PC(마우스 기기)에서는 같은 방식으로 연결하고 PC 기준으로 안내한다',async()=>{
  const {ctx,calls,nodes,message}=load({permission:'default',existing:false,pc:true});
  ctx.renderPushSetup();
  assert.match(nodes.pushSetup.innerHTML,/이 PC에서 알림 받기/);
  assert.match(nodes.pushSetup.innerHTML,/브라우저가 켜져 있을 때/);
  assert.match(nodes.pushSetup.innerHTML,/Edge로 연결/);
  assert.doesNotMatch(nodes.pushSetup.innerHTML,/휴대폰에서|이 휴대폰/);
  await nodes.enablePhonePush.onclick();
  assert.deepEqual(calls.order,['permission','register','subscribe']);
  assert.match(message(),/이 PC에 알림을 연결했습니다/);
  assert.match(nodes.pushSetup.innerHTML,/이 PC에 알림이 연결되어 있습니다/);
  assert.deepEqual(plain(ctx.state.alerts.subscriptions.map(s=>s.id)),['device-test']);
});

test('휴대폰에서는 PC도 따로 연결할 수 있다고 안내한다',()=>{
  const {ctx,nodes}=load({existing:false});
  ctx.renderPushSetup();
  assert.match(nodes.pushSetup.innerHTML,/이 휴대폰에서 알림 받기/);
  assert.match(nodes.pushSetup.innerHTML,/PC에서도 받으려면/);
  assert.match(nodes.pushSetup.innerHTML,/id="testPhonePush"[^>]*>알림 테스트<\/button>/);
});

test('알림 테스트 버튼은 동기화 전에도 누를 수 있고 미지원·차단 상태에서만 비활성화된다',()=>{
  const {ctx,nodes}=load({existing:false,ready:false});
  ctx.sync.token='';
  ctx.renderPushSetup();
  assert.equal(nodes.testPhonePush.disabled,false);
  assert.doesNotMatch(nodes.pushSetup.innerHTML.match(/<button[^>]*id="testPhonePush"[^>]*>/)[0],/\bdisabled\b/);

  const blocked=load({permission:'denied'});
  blocked.ctx.renderPushSetup();
  assert.equal(blocked.nodes.testPhonePush.disabled,true);
  assert.match(blocked.nodes.pushSetup.innerHTML.match(/<button[^>]*id="testPhonePush"[^>]*>/)[0],/\bdisabled\b/);

  const unsupported=load();
  delete unsupported.ctx.window.PushManager;
  unsupported.ctx.renderPushSetup();
  assert.equal(unsupported.nodes.testPhonePush.disabled,true);
});

test('알림 테스트는 클릭 시 권한을 먼저 확인하고 PNG 아이콘으로 로컬 알림을 표시하며 기록·구독·동기화를 바꾸지 않는다',async()=>{
  const {ctx,calls,testStats,nodes,storage,message}=load({initial:savedDevice(),permission:'default'});
  ctx.localStorage.setItem('etf-planner-push-device','device-test');
  const before=JSON.stringify(ctx.state),storedBefore=[...storage];
  await ctx.initializePush();
  const initialSub=vm.runInContext('pushSubscription',ctx);
  await nodes.testPhonePush.onclick();
  assert.deepEqual(calls.order,['permission','register','showNotification']);
  assert.equal(calls.subscribe,0);
  assert.equal(calls.unsubscribe,0);
  assert.equal(calls.save,0);
  assert.equal(testStats.sync,0);
  assert.equal(testStats.showNotification,1);
  const [title,options]=testStats.shown[0];
  assert.equal(title,'매매 플래너 테스트 알림');
  assert.equal(options.tag,'etf-planner-push-test');
  assert.equal(options.renotify,true);
  assert.equal(options.data.url,'https://example.test/etf-planner/');
  assert.equal(options.icon,'https://example.test/etf-planner/icons/planner-192.png');
  assert.match(message(),/이 휴대폰에 테스트 알림을 보냈습니다/);
  assert.match(message(),/웹사이트·기타 알림/);
  assert.equal(vm.runInContext('pushSubscription',ctx),initialSub);
  assert.equal(JSON.stringify(ctx.state),before);
  assert.deepEqual([...storage],storedBefore);

  const pc=load({pc:true});
  pc.ctx.renderPushSetup();
  await pc.nodes.testPhonePush.onclick();
  assert.match(pc.message(),/이 PC에 테스트 알림을 보냈습니다/);
  assert.match(pc.message(),/브라우저·운영체제 알림 설정/);
});

test('알림 테스트에서 권한이 거부되거나 아이콘 실패·표시 오류가 나도 안전하게 안내하고 기록을 바꾸지 않는다',async()=>{
  const denied=load({permission:()=> 'denied'});
  denied.ctx.renderPushSetup();
  await denied.nodes.testPhonePush.onclick();
  assert.equal(denied.calls.permission,1);
  assert.equal(denied.calls.register,0);
  assert.equal(denied.testStats.showNotification,0);
  assert.match(denied.message(),/알림이 허용되지 않았습니다/);

  let iconAttempt=0;
  const fallback=load({onShowNotification:async(_,options)=>{iconAttempt++;if(options.icon)throw new Error('icon-decode-fail');}});
  const before=JSON.stringify(fallback.ctx.state);
  fallback.ctx.renderPushSetup();
  await fallback.nodes.testPhonePush.onclick();
  assert.equal(iconAttempt,2);
  assert.equal(fallback.testStats.shown.length,2);
  assert.equal('icon' in fallback.testStats.shown[1][1],false);
  assert.match(fallback.message(),/테스트 알림을 보냈습니다/);
  assert.equal(JSON.stringify(fallback.ctx.state),before);

  const errored=load({onShowNotification:async()=>{throw Object.assign(new Error('internal-secret'),{name:'TypeError'});}});
  errored.ctx.renderPushSetup();
  await errored.nodes.testPhonePush.onclick();
  assert.match(errored.message(),/테스트 알림 표시 · TypeError/);
  assert.doesNotMatch(errored.message(),/internal-secret/);
  assert.equal(vm.runInContext('pushBusy',errored.ctx),false);
  assert.equal(vm.runInContext('pushTesting',errored.ctx),false);
});

