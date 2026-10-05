const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/push.js'), 'utf8');
const publicBytes = Uint8Array.from({length:65}, (_, i) => i === 0 ? 4 : i);
const publicKey = Buffer.from(publicBytes).toString('base64url');
const plain = value => JSON.parse(JSON.stringify(value));

function load({initial={},permission='granted',ready=true,syncMode='complete',existing=true,pc=false}={}){
  const calls = {permission:0,register:0,subscribe:0,unsubscribe:0,save:0,order:[]};
  const nodes = {pushSetup:{},enablePhonePush:{},disablePhonePush:{}};
  const storage = new Map();
  const subscription = {
    endpoint:'https://push.example.test/device',
    options:{applicationServerKey:publicBytes.buffer},
    toJSON(){return {endpoint:this.endpoint,expirationTime:null,keys:{p256dh:'test-key',auth:'test-auth'}};},
    async unsubscribe(){calls.unsubscribe++;return true;}
  };
  const notification = {
    permission,
    async requestPermission(){calls.permission++;calls.order.push('permission');this.permission='granted';return this.permission;}
  };
  const registration = {active:true,pushManager:{
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
    document:{baseURI:'https://example.test/etf-planner/'},URL,Uint8Array,atob,
    $:name=>nodes[name],id:()=> 'device-test',esc:value=>String(value),
    connected:()=>!!ctx.sync.token,
    save:()=>{calls.save++;},
    ...(pc?{matchMedia:query=>({matches:query==='(hover:hover) and (pointer:fine)'})}:{})
  });
  ctx.syncNow=async()=>{
    if(syncMode==='busy'){ctx.sync.again=true;return;}
    if(syncMode==='failed'){ctx.sync.failed=true;return;}
    if(syncMode==='discard'){ctx.state.alerts.subscriptions=[];}
    ctx.sync.base=JSON.stringify(ctx.state);
  };
  vm.runInContext(source,ctx);
  vm.runInContext(`pushConfig={repo:sync.repo,publicKey:${JSON.stringify(publicKey)},ready:${ready}}`,ctx);
  return {ctx,calls,nodes,subscription,message:()=>vm.runInContext('pushMessage',ctx)};
}

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
});
