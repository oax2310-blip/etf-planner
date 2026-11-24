const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/push.js'), 'utf8');
const publicBytes = Uint8Array.from({length:65}, (_, i) => i === 0 ? 4 : i);
const publicKey = Buffer.from(publicBytes).toString('base64url');
const plain = value => JSON.parse(JSON.stringify(value));

function load({initial={},permission='granted',ready=true,syncMode='complete',existing=true,pc=false,userAgent='',platform='',maxTouchPoints=0,standalone=undefined,userAgentData=undefined,brave=undefined,onShowNotification=null,getNotifications=null,activeState=undefined,nativeApp=false,displayMode='browser',isSecureContext=true,gh=null}={}){
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
  const docListeners = new Map();
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
  const registration = {active:activeState!==undefined?{state:activeState}:true,
    async showNotification(...args){testStats.showNotification++;calls.order.push('showNotification');testStats.shown.push(args);if(onShowNotification)return await onShowNotification(...args);},
    ...(getNotifications?{getNotifications}:{}),
    pushManager:{
      async getSubscription(){return existing?subscription:null;},
      async subscribe(){calls.subscribe++;calls.order.push('subscribe');return subscription;}
    }};
  const serviceWorker = {
    async getRegistration(){return registration;},
    async register(){calls.register++;calls.order.push('register');return registration;},
    ready:Promise.resolve(registration)
  };
  const mediaMatch = query => {
    if(pc&&query==='(hover:hover) and (pointer:fine)')return true;
    return query===`(display-mode:${displayMode})`;
  };
  const navigatorMock = {
    serviceWorker,
    userAgent,
    platform,
    maxTouchPoints,
    ...(standalone!==undefined?{standalone}:{}),
    ...(userAgentData!==undefined?{userAgentData}:{}),
    ...(brave!==undefined?{brave}:{})
  };
  const docMock = {
    hidden:false,
    readyState:'complete',
    addEventListener(type,fn){if(!docListeners.has(type))docListeners.set(type,[]);docListeners.get(type).push(fn);},
    baseURI:'https://example.test/etf-planner/',
    ...(nativeApp?{documentElement:{dataset:{nativeApp:'android'}}}:{})
  };
  const ctx = vm.createContext({
    state:plain(initial),sync:{repo:'owner/private-data',token:'test',base:'{}',busy:syncMode==='busy',failed:false,blocked:false},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{isSecureContext,PushManager:function(){},Notification:notification},
    navigator:navigatorMock,Notification:notification,
    addEventListener(){},document:docMock,URL,Uint8Array,atob,setTimeout,clearTimeout,
    assetStore:{subscribe(){}},
    $:name=>nodes[name],id:()=> 'device-test',esc:value=>String(value),
    connected:()=>!!ctx.sync.token,
    save:()=>{calls.save++;},
    ...(gh?{gh}:{}),
    ...(pc||displayMode!=='browser'?{matchMedia:query=>({matches:mediaMatch(query)})}:{})
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
  return {ctx,calls,testStats,nodes,subscription,storage,notification,registration,serviceWorker,docMock,docListeners,message:()=>vm.runInContext('pushMessage',ctx),tone:()=>vm.runInContext('pushMessageTone',ctx),detail:()=>vm.runInContext('pushMessageDetail',ctx)};
}

function attachLiveDom(h){
  function makeElement(tag){
    const attrs = new Map();
    let _text = '', _innerHTMLWrites = 0;
    const el = {
      nodeType:1,
      tagName:String(tag).toUpperCase(),
      className:'',
      disabled:false,
      type:'',
      onclick:null,
      children:[],
      parentElement:null,
      setAttribute(name,value){
        const k=String(name),v=String(value);
        if(k==='id')this.id=v;
        else if(k==='class')this.className=v;
        else attrs.set(k,v);
      },
      getAttribute(name){
        const k=String(name);
        if(k==='id')return this.id||null;
        if(k==='class')return this.className||null;
        return attrs.has(k)?attrs.get(k):null;
      },
      hasAttribute(name){return this.getAttribute(name)!==null;},
      appendChild(child){
        if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(c=>c!==child);
        child.parentElement=this;
        this.children.push(child);
        return child;
      },
      remove(){
        if(this.parentElement){
          this.parentElement.children=this.parentElement.children.filter(c=>c!==this);
          this.parentElement=null;
        }
      },
      get textContent(){
        if(this.children.length)return this.children.map(c=>c.textContent).join('');
        return _text;
      },
      set textContent(v){
        _text=String(v);
        for(const c of this.children)c.parentElement=null;
        this.children=[];
      },
      get innerHTML(){return '';},
      set innerHTML(_v){_innerHTMLWrites++;},
      get innerHTMLWrites(){return _innerHTMLWrites;},
      querySelector(selector){
        const match=node=>{
          if(selector.startsWith('#'))return node.id===selector.slice(1);
          if(selector.startsWith('.'))return String(node.className||'').split(/\s+/).includes(selector.slice(1));
          if(selector.startsWith('[')&&selector.endsWith(']'))return node.hasAttribute(selector.slice(1,-1));
          return node.tagName===selector.toUpperCase();
        };
        const queue=[...this.children];
        while(queue.length){
          const cur=queue.shift();
          if(match(cur))return cur;
          queue.push(...cur.children);
        }
        return null;
      },
      contains(target){
        let cur=target;
        while(cur){if(cur===this)return true;cur=cur.parentElement;}
        return false;
      }
    };
    return el;
  }
  const root = makeElement('div');
  root.id = 'pushSetup';
  h.docMock.createElement = makeElement;
  Object.defineProperty(h.nodes, 'pushSetup', { value: root, configurable: true });
  for (const id of ['enablePhonePush', 'testPhonePush', 'disablePhonePush', 'pushFeedback']) {
    Object.defineProperty(h.nodes, id, { get: () => root.querySelector(`#${id}`), configurable: true });
  }
  return root;
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
  const samsungUa='Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
  const {ctx,calls,testStats,nodes,storage,message}=load({initial:savedDevice(),permission:'default',userAgent:samsungUa});
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
  assert.equal(options.icon,'https://example.test/etf-planner/icons/push-192.png');
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

test('배경 동기화(readPushConfig) 성공·오류는 사용자의 테스트·연결 안내 문구를 지우지 않는다',async()=>{
  let mode='ok';
  const {ctx,nodes,message,tone}=load({
    gh:async()=>mode==='ok'
      ?{status:200,ok:true,async text(){return JSON.stringify({publicKey,ready:true});}}
      :{status:500,ok:false,async text(){return 'fail';}}
  });
  ctx.renderPushSetup();
  await nodes.testPhonePush.onclick();
  const shown=message();
  assert.equal(tone(),'ok');
  await ctx.readPushConfig();
  assert.equal(message(),shown);
  assert.match(nodes.pushSetup.innerHTML,/class="push-feedback ok"/);
  assert.match(nodes.pushSetup.innerHTML,/이 휴대폰에 테스트 알림을 보냈습니다/);

  mode='error';
  await ctx.readPushConfig();
  assert.equal(message(),shown,'발송 상태 조회 실패가 테스트 결과를 지우지 않는다');
  assert.match(nodes.pushSetup.innerHTML,/알림 발송 상태를 확인하지 못했습니다/);

  const empty=load({
    gh:async()=>mode==='ok'
      ?{status:200,ok:true,async text(){return JSON.stringify({publicKey,ready:true});}}
      :{status:500,ok:false,async text(){return 'fail';}}
  });
  mode='error';
  await empty.ctx.readPushConfig();
  assert.equal(empty.message(),'','pushMessage를 덮어쓰지 않는다');
  assert.match(empty.nodes.pushSetup.innerHTML,/class="push-feedback warn"/);
  assert.match(empty.nodes.pushSetup.innerHTML,/발송 상태 확인 필요/);
  mode='ok';
  await empty.ctx.readPushConfig();
  assert.doesNotMatch(empty.nodes.pushSetup.innerHTML,/발송 상태 확인 필요/);
});

test('규칙 목록을 누르는 동안 푸시 조회는 끝나고 안내 문구는 보류한 목록과 함께 갱신된다',async()=>{
  const h=load({gh:async()=>({status:500,ok:false})});
  const alerts=fs.readFileSync(path.join(__dirname,'../js/alerts.js'),'utf8');
  const list=new EventTarget();
  let listRenders=0;
  Object.assign(h.ctx,{list,dialog:new EventTarget(),drawList:()=>listRenders++});
  vm.runInContext(alerts+'\ndeferAlertRulesRender=deferAlertListWhilePressed(list,dialog);',h.ctx);
  h.ctx.renderPushSetup();
  const before=h.nodes.pushSetup.innerHTML;
  list.dispatchEvent(Object.assign(new Event('pointerdown'),{button:0,pointerId:1}));

  await h.ctx.readPushConfig();
  assert.match(vm.runInContext('pushConfigError',h.ctx),/발송 상태를 확인하지 못했습니다/);
  assert.equal(h.nodes.pushSetup.innerHTML,before);
  assert.equal(vm.runInContext('deferAlertRulesRender(drawList)',h.ctx),true);
  assert.equal(vm.runInContext('deferAlertRulesRender(drawList)',h.ctx),true);

  for(const cancel of h.docListeners.get('pointercancel'))cancel({pointerId:1});
  assert.match(h.nodes.pushSetup.innerHTML,/발송 상태 확인 필요/);
  assert.equal(listRenders,1);
});

test('알림 테스트는 이전 테스트 알림을 정리한 뒤 활성 알림 잔류 여부를 확인한다',async()=>{
  let active=[],closed=0,phase=0;
  const shown=load({
    activeState:'activated',
    displayMode:'fullscreen',
    getNotifications:async query=>{
      assert.equal(query?.tag,'etf-planner-push-test');
      phase++;
      if(phase===1)return [{tag:'etf-planner-push-test',close(){closed++;active=[];}}];
      return active;
    },
    onShowNotification:async()=>{active=[{tag:'etf-planner-push-test'}];}
  });
  shown.ctx.renderPushSetup();
  await shown.nodes.testPhonePush.onclick();
  assert.equal(closed,1);
  assert.equal(shown.tone(),'ok');
  assert.match(shown.detail(),/활성 알림 1건 확인/);
  assert.match(shown.detail(),/서비스 워커 activated/);
  assert.match(shown.detail(),/전체화면에서는 위쪽 상태바가 가려지니/);

  const dropped=load({
    activeState:'activated',
    displayMode:'fullscreen',
    getNotifications:async()=>[]
  });
  const before=JSON.stringify(dropped.ctx.state);
  dropped.ctx.renderPushSetup();
  await dropped.nodes.testPhonePush.onclick();
  assert.equal(dropped.tone(),'warn');
  assert.match(dropped.message(),/활성 알림에 남지 않았습니다\(0건\)/);
  assert.match(dropped.detail(),/활성 알림 0건/);
  assert.match(dropped.nodes.pushSetup.innerHTML,/class="push-feedback warn"/);
  assert.equal(JSON.stringify(dropped.ctx.state),before);
});

test('웹앱 무응답(default 권한), 안드로이드 APK WebView 미지원, 차단(denied) 상태를 버튼 클릭 전·후로 진단한다',async()=>{
  const chromeAndroidUa='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const chromeUserAgentData={brands:[{brand:'Chromium',version:'130'},{brand:'Google Chrome',version:'130'}],mobile:true,platform:'Android'};
  const silentPrompt=load({permission:()=> 'default',displayMode:'fullscreen',userAgent:chromeAndroidUa,userAgentData:chromeUserAgentData});
  silentPrompt.ctx.renderPushSetup();
  await silentPrompt.nodes.testPhonePush.onclick();
  assert.equal(silentPrompt.tone(),'warn');
  assert.match(silentPrompt.message(),/알림이 허용되지 않았습니다/);
  assert.match(silentPrompt.detail(),/권한 default/);
  assert.match(silentPrompt.detail(),/Chrome 일반 창/);
  assert.doesNotMatch(silentPrompt.nodes.pushSetup.innerHTML,/삼성 인터넷|Firefox/);

  const pcPrompt=load({permission:()=> 'default',pc:true});
  pcPrompt.ctx.renderPushSetup();
  await pcPrompt.nodes.testPhonePush.onclick();
  assert.equal(pcPrompt.tone(),'warn');
  assert.doesNotMatch(pcPrompt.nodes.pushSetup.innerHTML,/휴대폰에서|이 휴대폰/);

  const apk=load({nativeApp:true});
  apk.ctx.sync.token='';
  delete apk.ctx.window.Notification;
  delete apk.ctx.window.PushManager;
  apk.ctx.renderPushSetup();
  assert.equal(apk.nodes.testPhonePush.disabled,true);
  assert.match(apk.nodes.pushSetup.innerHTML,/class="push-feedback bad"/);
  assert.match(apk.nodes.pushSetup.innerHTML,/안드로이드 실행 앱\(APK\)/);

  const denied=load({permission:'denied'});
  denied.ctx.sync.token='';
  denied.ctx.renderPushSetup();
  assert.equal(denied.nodes.testPhonePush.disabled,true);
  assert.match(denied.nodes.pushSetup.innerHTML,/class="push-feedback bad"/);
  assert.match(denied.nodes.pushSetup.innerHTML,/Notification\.permission: denied/);
});

test('같은 화면 상태의 반복 렌더는 DOM 버튼을 갈아엎지 않고 redundant 서비스 워커는 ready를 기다린다',async()=>{
  const h=load({activeState:'redundant'});
  let writes=0,markup='';
  const child={disabled:false,onclick:null};
  Object.defineProperty(h.nodes,'pushSetup',{value:{
    querySelector(){return child;},
    contains(el){return el===child;},
    get innerHTML(){return markup;},
    set innerHTML(v){writes++;markup=v;}
  }});
  h.nodes.enablePhonePush=child;
  h.ctx.renderPushSetup();
  h.ctx.renderPushSetup();
  h.ctx.renderPushSetup();
  assert.equal(writes,1,'상태 변화가 없으면 innerHTML을 다시 쓰지 않는다');

  const activeReg={
    active:{state:'activated'},
    async showNotification(...args){h.testStats.showNotification++;h.testStats.shown.push(args);},
    pushManager:h.registration.pushManager
  };
  h.serviceWorker.ready=Promise.resolve(activeReg);
  const picked=await h.ctx.pushRegistration();
  assert.equal(picked,activeReg);
});

test('배경 동기화 오류·복구와 테스트 실행 중에도 실제 DOM 버튼 노드를 유지하고 중복 클릭을 막는다',async()=>{
  let ghMode='ok';
  let releaseNotify;
  const h=load({
    initial:savedDevice(),
    gh:async()=>ghMode==='ok'
      ?{status:200,ok:true,async text(){return JSON.stringify({publicKey,ready:true});}}
      :{status:500,ok:false,async text(){return 'fail';}},
    onShowNotification:()=>new Promise(resolve=>{releaseNotify=resolve;})
  });
  h.ctx.localStorage.setItem('etf-planner-push-device','device-test');
  const root=attachLiveDom(h);
  await h.ctx.initializePush();

  const enableBtn=h.nodes.enablePhonePush;
  const testBtn=h.nodes.testPhonePush;
  const disableBtn=h.nodes.disablePhonePush;
  assert.ok(enableBtn&&testBtn&&disableBtn);
  assert.equal(root.innerHTMLWrites,0);

  ghMode='error';
  await h.ctx.readPushConfig();
  assert.equal(h.nodes.enablePhonePush,enableBtn,'동기화 오류 발생 뒤에도 알림 받기 버튼 DOM 노드를 유지한다');
  assert.equal(h.nodes.testPhonePush,testBtn,'동기화 오류 발생 뒤에도 알림 테스트 버튼 DOM 노드를 유지한다');
  assert.equal(h.nodes.disablePhonePush,disableBtn,'동기화 오류 발생 뒤에도 해제 버튼 DOM 노드를 유지한다');
  assert.match(h.nodes.pushFeedback.className,/warn/);
  assert.match(h.nodes.pushFeedback.textContent,/발송 상태 확인 필요/);

  const running=testBtn.onclick();
  await new Promise(setImmediate);
  assert.equal(h.nodes.enablePhonePush,enableBtn);
  assert.equal(h.nodes.testPhonePush,testBtn);
  assert.equal(testBtn.disabled,true);
  assert.equal(enableBtn.disabled,true);
  assert.equal(disableBtn.disabled,true);
  assert.equal(testBtn.textContent,'테스트 중…');
  await testBtn.onclick();
  await enableBtn.onclick();
  assert.equal(h.testStats.showNotification,1,'실행 중 중복 클릭은 새 테스트·연결을 실행하지 않는다');

  ghMode='ok';
  await h.ctx.readPushConfig();
  assert.equal(h.nodes.enablePhonePush,enableBtn,'동기화 오류 해소 뒤에도 알림 받기 버튼 DOM 노드를 유지한다');
  assert.equal(h.nodes.testPhonePush,testBtn,'동기화 오류 해소 뒤에도 알림 테스트 버튼 DOM 노드를 유지한다');
  assert.equal(h.nodes.disablePhonePush,disableBtn,'동기화 오류 해소 뒤에도 해제 버튼 DOM 노드를 유지한다');

  releaseNotify();
  await running;
  assert.equal(h.testStats.showNotification,1);
  assert.equal(testBtn.disabled,false);
  assert.equal(enableBtn.disabled,false);
  assert.equal(disableBtn.disabled,false);
  assert.equal(testBtn.textContent,'알림 테스트');
  assert.match(h.nodes.pushFeedback.className,/ok/);
  assert.equal(root.innerHTMLWrites,0);
});

test('현재 알림 권한이 denied이면 처음부터든 테스트 성공 뒤든 차단 사유·해제 방법을 우선 표시한다',async()=>{
  const initDenied=load({initial:savedDevice(),permission:'denied'});
  initDenied.ctx.localStorage.setItem('etf-planner-push-device','device-test');
  attachLiveDom(initDenied);
  await initDenied.ctx.initializePush();
  assert.equal(initDenied.nodes.enablePhonePush.disabled,true);
  assert.equal(initDenied.nodes.testPhonePush.disabled,true);
  assert.match(initDenied.nodes.pushFeedback.className,/\bbad\b/);
  assert.match(initDenied.nodes.pushFeedback.textContent,/권한 차단됨/);
  assert.match(initDenied.nodes.pushFeedback.textContent,/Notification\.permission: denied/);

  let ghMode='ok';
  const h=load({
    initial:savedDevice(),
    gh:async()=>ghMode==='ok'
      ?{status:200,ok:true,async text(){return JSON.stringify({publicKey,ready:true});}}
      :{status:500,ok:false,async text(){return 'fail';}}
  });
  h.ctx.localStorage.setItem('etf-planner-push-device','device-test');
  const root=attachLiveDom(h);
  await h.ctx.initializePush();
  await h.nodes.testPhonePush.onclick();
  assert.match(h.nodes.pushFeedback.className,/\bok\b/);
  assert.match(h.nodes.pushFeedback.textContent,/확인 완료/);

  ghMode='error';
  await h.ctx.readPushConfig();
  assert.match(h.nodes.pushFeedback.className,/\bok\b/,'권한이 그대로일 때는 배경 동기화 실패가 테스트 결과를 지우지 않는다');
  assert.match(h.nodes.pushFeedback.textContent,/확인 완료/);
  assert.match(h.nodes.pushFeedback.textContent,/알림 발송 상태를 확인하지 못했습니다/);

  ghMode='ok';
  await h.ctx.readPushConfig();
  assert.match(h.nodes.pushFeedback.className,/\bok\b/);
  assert.match(h.nodes.pushFeedback.textContent,/확인 완료/);
  assert.doesNotMatch(h.nodes.pushFeedback.textContent,/알림 발송 상태를 확인하지 못했습니다/);

  h.notification.permission='denied';
  h.ctx.renderPushSetup();
  assert.equal(h.nodes.enablePhonePush.disabled,true);
  assert.equal(h.nodes.testPhonePush.disabled,true);
  assert.match(h.nodes.pushFeedback.className,/\bbad\b/);
  assert.match(h.nodes.pushFeedback.textContent,/권한 차단됨/);
  assert.match(h.nodes.pushFeedback.textContent,/Notification\.permission: denied/);
  assert.doesNotMatch(h.nodes.pushFeedback.textContent,/확인 완료|권한 granted/);

  h.notification.permission='granted';
  h.docMock.hidden=false;
  for(const fn of h.docListeners.get('visibilitychange')||[])fn();
  assert.doesNotMatch(h.nodes.pushFeedback.textContent,/확인 완료|권한 granted/,'차단 상태를 거친 뒤 복귀해도 예전 성공 배너를 되살리지 않는다');
  assert.equal(h.nodes.testPhonePush.disabled,false);
  assert.equal(root.innerHTMLWrites,0);
});

test('상태바 숨김 안내는 fullscreen에서만 표시하고 standalone·minimal-ui·browser에서는 숨긴다',async()=>{
  const androidChromeUa='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const chromeUserAgentData={brands:[{brand:'Chromium',version:'130'},{brand:'Google Chrome',version:'130'}],mobile:true,platform:'Android'};
  for(const mode of ['standalone','minimal-ui','browser']){
    const one=load({displayMode:mode,userAgent:androidChromeUa,userAgentData:chromeUserAgentData,getNotifications:async()=>[{tag:'etf-planner-push-test',close(){}}]});
    one.ctx.renderPushSetup();
    await one.nodes.testPhonePush.onclick();
    assert.doesNotMatch(one.nodes.pushSetup.innerHTML,/전체화면|상태바/,`${mode} 모드 바닥·1건 안내에 상태바 숨김을 표시하지 않는다`);
    assert.doesNotMatch(one.detail(),/전체화면|상태바/);

    const zero=load({displayMode:mode,userAgent:androidChromeUa,userAgentData:chromeUserAgentData,getNotifications:async()=>[]});
    zero.ctx.renderPushSetup();
    await zero.nodes.testPhonePush.onclick();
    assert.doesNotMatch(zero.nodes.pushSetup.innerHTML,/전체화면|상태바/,`${mode} 모드 0건 안내에 상태바 숨김을 표시하지 않는다`);
    assert.doesNotMatch(zero.detail(),/전체화면|상태바/);
  }

  const iosStandalone=load({
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    standalone:true,
    getNotifications:async()=>[]
  });
  iosStandalone.ctx.renderPushSetup();
  await iosStandalone.nodes.testPhonePush.onclick();
  assert.equal(iosStandalone.ctx.pushDisplayMode(),'standalone');
  assert.doesNotMatch(iosStandalone.nodes.pushSetup.innerHTML,/전체화면|상태바/);

  const full=load({displayMode:'fullscreen',userAgent:androidChromeUa,userAgentData:chromeUserAgentData,getNotifications:async()=>[{tag:'etf-planner-push-test',close(){}}]});
  full.ctx.renderPushSetup();
  await full.nodes.testPhonePush.onclick();
  assert.match(full.detail(),/전체화면에서는 위쪽 상태바가 가려지니/);
  assert.match(full.nodes.pushSetup.innerHTML,/전체화면 웹앱에서는 위쪽 상태바 아이콘이 숨겨집니다/);
});

test('iOS 홈 화면 웹앱과 비안드로이드 환경에서는 삼성 인터넷·Chrome·안드로이드 알림 카테고리 문구를 노출하지 않고 두 버튼이 같은 기준으로 권한을 요청한다',async t=>{
  const iosDevices=[
    {name:'iPhone',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',standalone:true},
    {name:'iPad',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',platform:'MacIntel',maxTouchPoints:5,displayMode:'standalone'}
  ];
  for(const dev of iosDevices)await t.test(dev.name,async()=>{
    for(const action of ['enablePhonePush','testPhonePush']){
      const h=load({permission:()=> 'default',...dev});
      h.ctx.renderPushSetup();
      await h.nodes[action].onclick();
      assert.equal(h.calls.permission,1);
      assert.equal(h.calls.order[0],'permission','권한 요청은 클릭 경로에서 바로 호출한다');
      assert.equal(h.tone(),'warn');
      assert.match(h.message(),/이 홈 화면 앱에서 알림을 허용해야 합니다/);
      assert.match(h.detail(),/권한 default/);
      assert.match(h.detail(),/아이폰·iPad 설정 → 알림에서 이 홈 화면 앱/);
      assert.doesNotMatch(h.nodes.pushSetup.innerHTML,/삼성 인터넷|Chrome|웹사이트·기타 알림|안드로이드 알림 카테고리|팝업으로 알림|전체화면|상태바/);
    }
    const denied=load({permission:'denied',...dev});
    denied.ctx.renderPushSetup();
    assert.match(denied.nodes.pushSetup.innerHTML,/아이폰·iPad 설정 → 알림에서 이 홈 화면 웹앱/);
    assert.doesNotMatch(denied.nodes.pushSetup.innerHTML,/삼성 인터넷|Chrome|웹사이트·기타 알림|팝업으로 알림/);
  });

  const androidChromeUa='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const chromeUserAgentData={brands:[{brand:'Chromium',version:'130'},{brand:'Google Chrome',version:'130'}],mobile:true,platform:'Android'};
  for(const action of ['enablePhonePush','testPhonePush']){
    const h=load({permission:()=> 'default',userAgent:androidChromeUa,userAgentData:chromeUserAgentData,displayMode:'standalone'});
    h.ctx.renderPushSetup();
    await h.nodes[action].onclick();
    assert.equal(h.calls.order[0],'permission');
    assert.match(h.detail(),/Chrome 일반 창/);
    assert.doesNotMatch(h.nodes.pushSetup.innerHTML,/삼성 인터넷|Firefox/);
  }
  const androidSuccess=load({userAgent:androidChromeUa,userAgentData:chromeUserAgentData,displayMode:'standalone',getNotifications:async()=>[{tag:'etf-planner-push-test',close(){}}]});
  androidSuccess.ctx.renderPushSetup();
  await androidSuccess.nodes.testPhonePush.onclick();
  assert.match(androidSuccess.detail(),/안드로이드 앱 알림 카테고리/);
  assert.doesNotMatch(androidSuccess.nodes.pushSetup.innerHTML,/웹사이트·기타 알림|삼성 인터넷|Firefox/);

  const nonAndroid=[
    load({permission:()=> 'default',userAgent:'',displayMode:'standalone'}),
    load({permission:()=> 'default',pc:true}),
    load({permission:'granted',userAgent:'',getNotifications:async()=>[{tag:'etf-planner-push-test',close(){}}]})
  ];
  for(const h of nonAndroid){
    h.ctx.renderPushSetup();
    await h.nodes.testPhonePush.onclick();
    assert.doesNotMatch(h.nodes.pushSetup.innerHTML,/삼성 인터넷|Chrome 일반 창|웹사이트·기타 알림|팝업으로 알림|안드로이드 앱 알림 카테고리/);
  }
});

test('renderPushSetup은 granted→default, denied→granted, default→granted 전환 시 이전 배너를 지우고 권한 불변 배경 동기화에는 유지한다',async()=>{
  // 1) granted → default(다시 묻기): 테스트 성공 뒤 다시 묻기로 바꾸고 설정 창을 다시 열면 '확인 완료 · 권한 granted'가 남지 않는다.
  let ghMode='ok';
  const gToD=load({
    initial:savedDevice(),
    permission:'granted',
    gh:async()=>ghMode==='ok'
      ?{status:200,ok:true,async text(){return JSON.stringify({publicKey,ready:true});}}
      :{status:500,ok:false,async text(){return 'fail';}}
  });
  gToD.ctx.localStorage.setItem('etf-planner-push-device','device-test');
  attachLiveDom(gToD);
  await gToD.ctx.initializePush();
  await gToD.nodes.testPhonePush.onclick();
  assert.match(gToD.nodes.pushFeedback.textContent,/확인 완료/);
  assert.match(gToD.nodes.pushFeedback.textContent,/권한 granted/);

  // 권한이 그대로(granted)인 배경 동기화 성공·오류에서는 최근 테스트 결과를 보존한다.
  ghMode='error';
  await gToD.ctx.readPushConfig();
  assert.match(gToD.nodes.pushFeedback.className,/\bok\b/);
  assert.match(gToD.nodes.pushFeedback.textContent,/확인 완료/);
  assert.match(gToD.nodes.pushFeedback.textContent,/알림 발송 상태를 확인하지 못했습니다/);
  ghMode='ok';
  await gToD.ctx.readPushConfig();
  assert.match(gToD.nodes.pushFeedback.className,/\bok\b/);
  assert.match(gToD.nodes.pushFeedback.textContent,/확인 완료/);
  assert.doesNotMatch(gToD.nodes.pushFeedback.textContent,/알림 발송 상태를 확인하지 못했습니다/);

  gToD.notification.permission='default';
  gToD.ctx.renderPushSetup();
  assert.equal(gToD.nodes.enablePhonePush.disabled,false);
  assert.equal(gToD.nodes.testPhonePush.disabled,false);
  assert.equal(gToD.message(),'');
  assert.equal(gToD.nodes.pushFeedback.className,'push-feedback');
  assert.equal(gToD.nodes.pushFeedback.textContent,'');

  // 2) denied → granted: 권한 요청 거부 후 허용하고 같은 탭으로 돌아오면 '실행 불가 · denied'와 차단 배너가 모두 사라진다.
  for(const action of ['enablePhonePush','testPhonePush']){
    const dToG=load({initial:savedDevice(),permission:()=> 'denied'});
    dToG.ctx.localStorage.setItem('etf-planner-push-device','device-test');
    attachLiveDom(dToG);
    await dToG.ctx.initializePush();
    await dToG.nodes[action].onclick();
    assert.equal(dToG.tone(),'bad');
    assert.match(dToG.nodes.pushFeedback.className,/\bbad\b/);
    assert.match(dToG.nodes.pushFeedback.textContent,/권한 차단됨/);
    assert.equal(dToG.nodes.enablePhonePush.disabled,true);
    assert.equal(dToG.nodes.testPhonePush.disabled,true);

    dToG.notification.permission='granted';
    dToG.docMock.hidden=false;
    for(const fn of dToG.docListeners.get('visibilitychange')||[])fn();
    assert.equal(dToG.nodes.enablePhonePush.disabled,false);
    assert.equal(dToG.nodes.testPhonePush.disabled,false);
    assert.equal(dToG.message(),'',`${action}: 허용 전환 후 이전 거부 메시지가 남지 않는다`);
    assert.equal(dToG.nodes.pushFeedback.className,'push-feedback');
    assert.equal(dToG.nodes.pushFeedback.textContent,'','허용 전환 후 실행 불가·denied 배너를 지운다');
  }

  // 3) default → granted: default 무응답(확인 필요) 배너는 배경 동기화에서 유지되고, 허용 전환 시 지워진다.
  for(const action of ['enablePhonePush','testPhonePush']){
    let mode='ok';
    const defToG=load({
      initial:savedDevice(),
      permission:()=> 'default',
      gh:async()=>mode==='ok'
        ?{status:200,ok:true,async text(){return JSON.stringify({publicKey,ready:true});}}
        :{status:500,ok:false,async text(){return 'fail';}}
    });
    defToG.ctx.localStorage.setItem('etf-planner-push-device','device-test');
    attachLiveDom(defToG);
    await defToG.ctx.initializePush();
    await defToG.nodes[action].onclick();
    assert.match(defToG.nodes.pushFeedback.className,/\bwarn\b/);
    assert.match(defToG.nodes.pushFeedback.textContent,/확인 필요/);
    assert.match(defToG.nodes.pushFeedback.textContent,/권한 default/);

    mode='error';
    await defToG.ctx.readPushConfig();
    assert.match(defToG.nodes.pushFeedback.className,/\bwarn\b/,'권한(default)이 그대로면 배경 동기화 실패에도 이전 결과를 유지한다');
    assert.match(defToG.nodes.pushFeedback.textContent,/확인 필요/);
    mode='ok';
    await defToG.ctx.readPushConfig();
    assert.match(defToG.nodes.pushFeedback.textContent,/확인 필요/);

    defToG.notification.permission='granted';
    defToG.ctx.renderPushSetup();
    assert.equal(defToG.nodes.enablePhonePush.disabled,false);
    assert.equal(defToG.nodes.testPhonePush.disabled,false);
    assert.equal(defToG.message(),'');
    assert.equal(defToG.nodes.pushFeedback.className,'push-feedback');
    assert.equal(defToG.nodes.pushFeedback.textContent,'');
  }
});

test('Firefox·Chrome·삼성 인터넷 Android의 default·denied 안내가 현재 브라우저·웹앱에 맞고 다른 브라우저를 섞지 않는다',async t=>{
  const browsers=[
    {
      name:'Firefox',
      ua:'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
      mustContain:/Firefox/,
      webappDefaultDetail:/Firefox 일반 창/,
      browserDefaultDetail:/Firefox 주소창 왼쪽 자물쇠·설정/,
      webappDeniedDetail:/애플리케이션 → Firefox → 알림.*Firefox 일반 창/,
      browserDeniedDetail:/Firefox 설정 → 사이트 권한 → 알림/,
      forbidden:/삼성 인터넷|Chrome|웹사이트·기타 알림/
    },
    {
      name:'Chrome',
      ua:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      userAgentData:{brands:[{brand:'Chromium',version:'130'},{brand:'Google Chrome',version:'130'}],mobile:true,platform:'Android'},
      mustContain:/Chrome/,
      webappDefaultDetail:/Chrome 일반 창/,
      browserDefaultDetail:/Chrome 주소창 옆 설정/,
      webappDeniedDetail:/애플리케이션 → Chrome·이 웹앱 알림.*Chrome 사이트 설정/,
      browserDeniedDetail:/Chrome → 사이트 설정 → 알림/,
      forbidden:/삼성 인터넷|Firefox|웹사이트·기타 알림/
    },
    {
      name:'삼성 인터넷',
      ua:'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      mustContain:/삼성 인터넷/,
      webappDefaultDetail:/삼성 인터넷 일반 창/,
      browserDefaultDetail:/삼성 인터넷 주소창 옆 설정/,
      webappDeniedDetail:/애플리케이션 → 삼성 인터넷 → 알림.*삼성 인터넷 사이트 설정/,
      browserDeniedDetail:/삼성 인터넷 → 설정 → 사이트 및 다운로드 → 알림/,
      forbidden:/Chrome|Firefox/
    }
  ];

  for(const b of browsers)await t.test(b.name,async()=>{
    for(const mode of ['standalone','browser']){
      // default: pushPermissionRejectedFeedback() 직접 확인 + 알림 받기/알림 테스트 클릭 확인
      for(const action of ['enablePhonePush','testPhonePush']){
        const def=load({permission:()=> 'default',userAgent:b.ua,userAgentData:b.userAgentData,displayMode:mode});
        attachLiveDom(def);
        def.ctx.renderPushSetup();
        const directDefault=def.ctx.pushPermissionRejectedFeedback('default');
        assert.match(directDefault.message,b.mustContain);
        assert.doesNotMatch(directDefault.message+directDefault.detail,b.forbidden);
        assert.match(directDefault.detail,mode==='standalone'?b.webappDefaultDetail:b.browserDefaultDetail);

        await def.nodes[action].onclick();
        assert.equal(def.tone(),'warn');
        assert.match(def.message(),b.mustContain,`${b.name}(${mode}) ${action} default 메시지`);
        assert.match(def.detail(),mode==='standalone'?b.webappDefaultDetail:b.browserDefaultDetail,`${b.name}(${mode}) ${action} default 상세`);
        assert.doesNotMatch(def.nodes.pushSetup.textContent,b.forbidden,`${b.name}(${mode}) ${action} default DOM 누출 없음`);
      }

      // denied: 초기 렌더 + pushBlockedDetail() + 권한 요청 거부 후 알림 받기/알림 테스트 확인
      const initDenied=load({permission:'denied',userAgent:b.ua,userAgentData:b.userAgentData,displayMode:mode});
      attachLiveDom(initDenied);
      initDenied.ctx.renderPushSetup();
      const blockedDetail=initDenied.ctx.pushBlockedDetail();
      assert.match(blockedDetail,mode==='standalone'?b.webappDeniedDetail:b.browserDeniedDetail);
      assert.doesNotMatch(blockedDetail,b.forbidden);
      assert.match(initDenied.nodes.pushSetup.textContent,mode==='standalone'?b.webappDeniedDetail:b.browserDeniedDetail);
      assert.doesNotMatch(initDenied.nodes.pushSetup.textContent,b.forbidden);

      for(const action of ['enablePhonePush','testPhonePush']){
        const rej=load({permission:()=> 'denied',userAgent:b.ua,userAgentData:b.userAgentData,displayMode:mode});
        attachLiveDom(rej);
        rej.ctx.renderPushSetup();
        const directDenied=rej.ctx.pushPermissionRejectedFeedback('denied');
        assert.match(directDenied.detail,mode==='standalone'?b.webappDeniedDetail:b.browserDeniedDetail);
        assert.doesNotMatch(directDenied.message+directDenied.detail,b.forbidden);

        await rej.nodes[action].onclick();
        assert.equal(rej.tone(),'bad');
        assert.match(rej.detail(),mode==='standalone'?b.webappDeniedDetail:b.browserDeniedDetail,`${b.name}(${mode}) ${action} denied detail`);
        assert.doesNotMatch(rej.detail(),b.forbidden);
        assert.match(rej.nodes.pushSetup.textContent,mode==='standalone'?b.webappDeniedDetail:b.browserDeniedDetail,`${b.name}(${mode}) ${action} denied DOM`);
        assert.doesNotMatch(rej.nodes.pushSetup.textContent,b.forbidden,`${b.name}(${mode}) ${action} denied DOM 누출 없음`);
      }
    }

    // granted 테스트 알림 성공 후에도 Firefox에 삼성 인터넷·Chrome 문구가 섞이지 않는다
    const granted=load({permission:'granted',userAgent:b.ua,userAgentData:b.userAgentData,displayMode:'standalone',getNotifications:async()=>[{tag:'etf-planner-push-test',close(){}}]});
    attachLiveDom(granted);
    granted.ctx.renderPushSetup();
    await granted.nodes.testPhonePush.onclick();
    assert.match(granted.nodes.pushSetup.textContent,b.mustContain);
    assert.doesNotMatch(granted.nodes.pushSetup.textContent,b.forbidden);
  });

  // 비표준 안드로이드 인앱 브라우저(KAKAOTALK 등)는 Chrome으로 오인하지 않고 중립 안내를 쓴다
  const inApp=load({
    permission:()=> 'default',
    userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36 KAKAOTALK 11.0.0',
    displayMode:'standalone'
  });
  attachLiveDom(inApp);
  inApp.ctx.renderPushSetup();
  await inApp.nodes.testPhonePush.onclick();
  assert.match(inApp.detail(),/설치한 브라우저의 일반 창/);
  assert.doesNotMatch(inApp.nodes.pushSetup.textContent,/삼성 인터넷|Chrome|Firefox/);
});

test('표준 Android WebView(; wv) + Chrome/)와 Brave·userAgentData 미확인 Chrome UA는 Chrome 대신 현재 앱 또는 설치한 브라우저로 안내한다',async t=>{
  const androidChromeUa='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const webviewCases=[
    {name:'표준 WebView(; wv + Version/4.0 + Chrome/)',ua:'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36'},
    {name:'표준 WebView(; wv + Chrome/)',ua:'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'},
    {name:'WebView userAgentData brand',ua:androidChromeUa,userAgentData:{brands:[{brand:'Chromium',version:'130'},{brand:'Android WebView',version:'130'}],mobile:true,platform:'Android'}}
  ];

  for(const wv of webviewCases)await t.test(wv.name,async()=>{
    for(const connected of [true,false]){
      const unsup=load({userAgent:wv.ua,userAgentData:wv.userAgentData});
      if(!connected)unsup.ctx.sync.token='';
      delete unsup.ctx.window.Notification;
      delete unsup.ctx.window.PushManager;
      attachLiveDom(unsup);
      unsup.ctx.renderPushSetup();
      assert.equal(unsup.ctx.pushIsAndroidWebView(),true);
      assert.equal(unsup.ctx.pushIsChromeAndroid(),false);
      assert.equal(unsup.ctx.pushAndroidBrowserLabel(),'');
      assert.equal(unsup.nodes.enablePhonePush.disabled,true);
      assert.equal(unsup.nodes.testPhonePush.disabled,true);
      assert.match(unsup.nodes.pushSetup.textContent,/현재 앱/);
      assert.match(unsup.nodes.pushSetup.textContent,/설치한 브라우저/);
      assert.doesNotMatch(unsup.nodes.pushSetup.textContent,/Chrome|삼성 인터넷|Firefox/,`${wv.name}(connected=${connected}) 미지원 화면에 Chrome 안내가 없어야 한다`);
    }

    for(const mode of ['standalone','browser']){
      const denied=load({permission:'denied',userAgent:wv.ua,userAgentData:wv.userAgentData,displayMode:mode});
      attachLiveDom(denied);
      denied.ctx.renderPushSetup();
      assert.match(denied.nodes.pushSetup.textContent,/현재 앱.*설치한 브라우저/);
      assert.doesNotMatch(denied.nodes.pushSetup.textContent,/Chrome|삼성 인터넷|Firefox/);

      for(const action of ['enablePhonePush','testPhonePush']){
        const def=load({permission:()=> 'default',userAgent:wv.ua,userAgentData:wv.userAgentData,displayMode:mode});
        attachLiveDom(def);
        def.ctx.renderPushSetup();
        await def.nodes[action].onclick();
        assert.match(def.nodes.pushSetup.textContent,/현재 앱/);
        assert.match(def.nodes.pushSetup.textContent,/설치한 브라우저/);
        assert.doesNotMatch(def.nodes.pushSetup.textContent,/Chrome|삼성 인터넷|Firefox/);
      }

      const ok=load({permission:'granted',userAgent:wv.ua,userAgentData:wv.userAgentData,displayMode:mode,getNotifications:async()=>[{tag:'etf-planner-push-test',close(){}}]});
      attachLiveDom(ok);
      ok.ctx.renderPushSetup();
      await ok.nodes.testPhonePush.onclick();
      assert.match(ok.nodes.pushSetup.textContent,/현재 앱/);
      assert.doesNotMatch(ok.nodes.pushSetup.textContent,/Chrome|삼성 인터넷|Firefox/);
    }
  });

  const braveAndUnconfirmedCases=[
    {name:'Chrome/ UA만 있고 navigator.brave·navigator.userAgentData 없음'},
    {name:'Chrome/ UA + navigator.userAgentData 있으나 brands 속성 없음',userAgentData:{mobile:true,platform:'Android'}},
    {name:'Brave navigator.brave + Chrome UA',brave:{async isBrave(){return true;}}},
    {name:'Brave userAgentData.brands + Chrome UA',userAgentData:{brands:[{brand:'Chromium',version:'130'},{brand:'Brave',version:'130'}],mobile:true,platform:'Android'}},
    {name:'Brave navigator.brave + userAgentData.brands + Chrome UA',brave:{},userAgentData:{brands:[{brand:'Chromium',version:'130'},{brand:'Brave',version:'130'}],mobile:true,platform:'Android'}},
    {name:'Chromium 전용 userAgentData(Google Chrome 미확인)',userAgentData:{brands:[{brand:'Chromium',version:'130'}],mobile:true,platform:'Android'}},
    {name:'빈 userAgentData.brands(Chrome 미확인)',userAgentData:{brands:[],mobile:true,platform:'Android'}}
  ];

  for(const br of braveAndUnconfirmedCases)await t.test(br.name,async()=>{
    const unsup=load({userAgent:androidChromeUa,brave:br.brave,userAgentData:br.userAgentData,isSecureContext:false});
    attachLiveDom(unsup);
    unsup.ctx.renderPushSetup();
    assert.equal(unsup.ctx.pushIsChromeAndroid(),false);
    assert.equal(unsup.ctx.pushAndroidBrowserLabel(),'');
    assert.match(unsup.nodes.pushSetup.textContent,/현재 앱|설치한 브라우저/);
    assert.doesNotMatch(unsup.nodes.pushSetup.textContent,/Chrome|삼성 인터넷|Firefox/);

    for(const mode of ['standalone','fullscreen','browser']){
      for(const action of ['enablePhonePush','testPhonePush']){
        const def=load({permission:()=> 'default',userAgent:androidChromeUa,brave:br.brave,userAgentData:br.userAgentData,displayMode:mode});
        attachLiveDom(def);
        def.ctx.renderPushSetup();
        await def.nodes[action].onclick();
        assert.equal(def.tone(),'warn');
        assert.match(def.message(),/설치한 브라우저/);
        assert.match(def.detail(),/설치한 브라우저/);
        assert.doesNotMatch(def.nodes.pushSetup.textContent,/Chrome|삼성 인터넷|Firefox/,`${br.name}(${mode}) ${action}에 Chrome 일반 창 안내가 나오면 안 된다`);
      }

      const denied=load({permission:'denied',userAgent:androidChromeUa,brave:br.brave,userAgentData:br.userAgentData,displayMode:mode});
      attachLiveDom(denied);
      denied.ctx.renderPushSetup();
      assert.match(denied.nodes.pushSetup.textContent,/설치한 브라우저/);
      assert.doesNotMatch(denied.nodes.pushSetup.textContent,/Chrome|삼성 인터넷|Firefox/);
    }
  });

  // 실제 Chrome의 userAgentData('Google Chrome' 브랜드 포함, navigator.brave 없음)는 계속 Chrome으로 안내한다
  const confirmedChromeData={brands:[{brand:'Chromium',version:'130'},{brand:'Google Chrome',version:'130'}],mobile:true,platform:'Android'};
  for(const mode of ['standalone','fullscreen']){
    for(const action of ['enablePhonePush','testPhonePush']){
      const confirmedChrome=load({
        permission:()=> 'default',
        userAgent:androidChromeUa,
        userAgentData:confirmedChromeData,
        displayMode:mode
      });
      attachLiveDom(confirmedChrome);
      confirmedChrome.ctx.renderPushSetup();
      await confirmedChrome.nodes[action].onclick();
      assert.equal(confirmedChrome.ctx.pushIsAndroidWebView(),false);
      assert.equal(confirmedChrome.ctx.pushIsChromeAndroid(),true);
      assert.match(confirmedChrome.detail(),/Chrome 일반 창에서 먼저 허용/);
      assert.doesNotMatch(confirmedChrome.nodes.pushSetup.textContent,/삼성 인터넷|Firefox/);
    }
  }
});
