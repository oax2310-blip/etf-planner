const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/push.js'), 'utf8');
const publicBytes = Uint8Array.from({length:65}, (_, i) => i ? i : 4);
const publicKey = Buffer.from(publicBytes).toString('base64url');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(setImmediate);
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function clock(){
  let now=0,next=0;
  const tasks=new Map();
  return {
    setTimeout(run,ms){const id=++next;tasks.set(id,{at:now+ms,run});return id;},
    clearTimeout(id){tasks.delete(id);},
    async advance(ms){
      const end=now+ms;
      while(true){
        const due=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!due)break;
        now=due[1].at;tasks.delete(due[0]);due[1].run();await flush();
      }
      now=end;await flush();
    },
    get size(){return tasks.size;}
  };
}
function harness({existing=false,initial={},permission='granted',waitMs}={}){
  const time=clock(),storage=new Map(),logged=[],order=[];
  const calls={permission:0,register:0,lookup:0,query:0,unsubscribe:0,subscribe:0,save:0,sync:0,update:0};
  const behavior={};
  function subscription(suffix='device',bytes=publicBytes){
    return {
      endpoint:`https://push.example.test/${suffix}`,options:{applicationServerKey:bytes.buffer},
      toJSON(){return {endpoint:this.endpoint,expirationTime:null,keys:{p256dh:'fake-public',auth:'fake-auth'}};},
      async unsubscribe(){
        calls.unsubscribe++;order.push('unsubscribe');
        const result=behavior.unsubscribe?await behavior.unsubscribe(this):true;
        if(current===this)current=null;
        return result;
      }
    };
  }
  const created=subscription(),old=subscription('old');
  let current=existing?old:null;
  const registration={active:{state:'activated'},pushManager:{
    async getSubscription(){calls.query++;order.push('query');return behavior.query?behavior.query():current;},
    async subscribe(options){
      calls.subscribe++;order.push('subscribe');
      const result=behavior.subscribe?await behavior.subscribe(options):created;
      current=result;return result;
    }
  },async update(){calls.update++;}};
  const notification={permission,async requestPermission(){
    calls.permission++;order.push('permission');
    this.permission=behavior.permission?await behavior.permission():'granted';return this.permission;
  }};
  const serviceWorker={
    async register(){calls.register++;order.push('register');return behavior.register?behavior.register():registration;},
    async getRegistration(){calls.lookup++;return behavior.lookup?behavior.lookup():registration;},
    ready:Promise.resolve(registration)
  };
  const classes=new Set(),nodes={pushSetup:{},enablePhonePush:{},disablePhonePush:{},alertsBtn:{
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},title:'',ariaLabel:''
  }};
  const ctx=vm.createContext({
    state:plain(initial),sync:{repo:'owner/private-data',token:'fake',base:'{}',busy:false,blocked:false,failed:false},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{isSecureContext:true,PushManager:function(){},Notification:notification},navigator:{serviceWorker},Notification:notification,
    document:{baseURI:'https://example.test/etf-planner/',addEventListener(){}},addEventListener(){},assetStore:{subscribe(){}},
    URL,Uint8Array,atob,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,
    console:{log:(...args)=>logged.push(args),error:(...args)=>logged.push(args),warn:(...args)=>logged.push(args)},
    $:name=>nodes[name],id:()=> 'device-test',esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    connected:()=>!!ctx.sync.token,save(){calls.save++;},
    async syncNow(){calls.sync++;if(behavior.sync)return behavior.sync();ctx.sync.base=JSON.stringify(ctx.state);}
  });
  vm.runInContext(source,ctx);
  vm.runInContext(`pushConfig={repo:sync.repo,publicKey:${JSON.stringify(publicKey)},ready:true}`,ctx);
  if(waitMs!==undefined)vm.runInContext(`pushStageWaitMs=${Number(waitMs)}`,ctx);
  ctx.renderPushSetup();
  return {
    ctx,calls,behavior,registration,serviceWorker,notification,time,storage,logged,order,nodes,created,old,subscription,
    get current(){return current;},set current(value){current=value;},
    busy:()=>vm.runInContext('pushBusy',ctx),local:()=>vm.runInContext('pushSubscription',ctx),message:()=>vm.runInContext('pushMessage',ctx),
    buttonDisabled:()=>/\bdisabled\b/.test(nodes.pushSetup.innerHTML.match(/<button[^>]*id="enablePhonePush"[^>]*>/)[0])
  };
}
function saved(h){
  h.ctx.localStorage.setItem('etf-planner-push-device','device-test');
  h.ctx.state.alerts={rules:[],subscriptions:[{id:'device-test',subscription:h.old.toJSON()}]};
  h.ctx.sync.base=JSON.stringify(h.ctx.state);
}
async function expired(h,work,stage,ms=30000){
  await flush();
  assert.equal(h.busy(),true);assert.equal(h.buttonDisabled(),true);
  await h.time.advance(ms);
  assert.equal(h.busy(),false,'한도 뒤 busy를 해제한다');
  assert.equal(h.buttonDisabled(),false,'지원·권한·설정이 정상인 버튼을 다시 누를 수 있다');
  await work;
  assert.match(h.message(),new RegExp(stage));
  assert.match(h.message(),/30초/);
  assert.equal(h.time.size,0,'완료된 클릭의 타이머를 정리한다');
}

for(const which of ['register','ready','query','unsubscribe','subscribe'])test(`단계 한도: ${which} 미완료 후 버튼·단계 안내를 복구하고 저장하지 않는다`,async()=>{
  const h=harness({existing:which==='unsubscribe'}),held=deferred();
  const stages={register:'브라우저 알림 준비',ready:'브라우저 알림 준비',query:'구독 확인',unsubscribe:'이전 구독 해제',subscribe:'구독 생성'};
  if(which==='ready'){h.registration.active=null;h.serviceWorker.ready=held.promise;}
  else h.behavior[which]=()=>held.promise;
  if(which==='unsubscribe')h.old.options.applicationServerKey=new Uint8Array(65).buffer;
  const before=JSON.stringify(h.ctx.state),storage=[...h.storage];
  const work=h.ctx.enablePhonePush();await flush();
  await h.time.advance(29999);assert.equal(h.busy(),true,'기본 한도는 30,000ms다');
  await expired(h,work,stages[which],1);
  assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);assert.equal(h.calls.permission,0);
  assert.equal(JSON.stringify(h.ctx.state),before);assert.deepEqual([...h.storage],storage);assert.equal(h.local(),undefined);
  if(which==='unsubscribe')assert.equal(h.calls.subscribe,0,'선해제가 완료되기 전 생성하지 않는다');
});

test('register와 ready는 브라우저 알림 준비 한도 30초를 함께 쓴다',async()=>{
  const h=harness(),register=deferred(),ready=deferred();
  h.registration.active=null;h.behavior.register=()=>register.promise;h.serviceWorker.ready=ready.promise;
  const work=h.ctx.enablePhonePush();await flush();await h.time.advance(20000);
  register.resolve(h.registration);await flush();await h.time.advance(9999);assert.equal(h.busy(),true);
  await expired(h,work,'브라우저 알림 준비',1);
  assert.equal(h.calls.query,0);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
});

test('대기 한도는 테스트에서 바꿀 수 있고 성공·실패 때 타이머를 정리한다',async()=>{
  const h=harness({waitMs:25}),held=deferred();h.behavior.query=()=>held.promise;
  const work=h.ctx.enablePhonePush();await flush();await h.time.advance(24);assert.equal(h.busy(),true);
  await expired(h,work,'구독 확인',1);
  for(const name of ['success','failure']){
    const next=harness();if(name==='failure')next.behavior.query=()=>Promise.reject(new TypeError('fake-detail'));
    await next.ctx.enablePhonePush();assert.equal(next.time.size,0);assert.equal(next.busy(),false);
  }
});

for(const which of ['register','ready'])test(`준비 Promise 재사용: ${which} 시간 초과 뒤 재클릭이 register를 중복 호출하지 않는다`,async()=>{
  const h=harness(),held=deferred();
  if(which==='ready'){h.registration.active=null;h.serviceWorker.ready=held.promise;}
  else h.behavior.register=()=>held.promise;
  await expired(h,h.ctx.enablePhonePush(),'브라우저 알림 준비');
  await expired(h,h.ctx.enablePhonePush(),'브라우저 알림 준비');assert.equal(h.calls.register,1);
  held.resolve(h.registration);await flush();
  assert.equal(h.local(),undefined);assert.equal(h.calls.query,0);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
});

test('subscribe 재사용·늦은 완료 무시: 두 번 시간 초과해도 생성은 한 번이며 다음 클릭에서 조회해 저장한다',async()=>{
  const h=harness(),held=deferred();h.behavior.subscribe=()=>held.promise;
  const before=JSON.stringify(h.ctx.state);
  await expired(h,h.ctx.enablePhonePush(),'구독 생성');
  await expired(h,h.ctx.enablePhonePush(),'구독 생성');
  assert.equal(h.calls.subscribe,1);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
  const message=h.message(),storage=[...h.storage];held.resolve(h.created);await flush();
  assert.equal(h.current,h.created,'브라우저 자체의 생성은 완료될 수 있다');
  assert.equal(h.local(),undefined,'기다리는 클릭이 없으면 전역 구독을 바꾸지 않는다');
  assert.equal(JSON.stringify(h.ctx.state),before);assert.deepEqual([...h.storage],storage);
  assert.equal(h.message(),message);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
  const queries=h.calls.query;await h.ctx.enablePhonePush();
  assert.ok(h.calls.query>queries,'새 클릭에서 실제 구독을 다시 조회한다');assert.equal(h.calls.subscribe,1);
  assert.equal(h.local(),h.created);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);assert.equal(h.ctx.pushIsSaved(),true);
});

test('재클릭이 기다리는 동안 subscribe가 완료되면 같은 Promise 뒤 현재 구독을 조회해 한 번 저장한다',async()=>{
  const h=harness(),held=deferred();h.behavior.subscribe=()=>held.promise;
  await expired(h,h.ctx.enablePhonePush(),'구독 생성');
  const work=h.ctx.enablePhonePush();await flush();assert.equal(h.calls.subscribe,1);assert.equal(h.calls.save,0);
  held.resolve(h.created);await work;
  assert.equal(h.calls.subscribe,1);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);assert.equal(h.local(),h.created);
  assert.equal(h.busy(),false);assert.equal(h.time.size,0);
});

test('진행 중 Promise가 늦게 거절돼도 자동 재시도·저장 없이 정리하고 다음 클릭은 새로 시도한다',async()=>{
  const h=harness(),held=deferred();h.behavior.subscribe=()=>held.promise;
  await expired(h,h.ctx.enablePhonePush(),'구독 생성');
  const message=h.message();held.reject(new TypeError('fake-detail'));await flush();
  assert.equal(h.local(),undefined);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);assert.equal(h.message(),message);
  delete h.behavior.subscribe;await h.ctx.enablePhonePush();assert.equal(h.calls.subscribe,2);assert.equal(h.calls.save,1);
});

test('시간 초과한 구독 조회가 새 연결 성공 뒤 옛 구독으로 끝나도 새 상태를 덮지 않는다',async()=>{
  const h=harness(),held=deferred();h.behavior.query=()=>held.promise;
  await expired(h,h.ctx.enablePhonePush(),'구독 확인');delete h.behavior.query;
  await h.ctx.enablePhonePush();const state=JSON.stringify(h.ctx.state),storage=[...h.storage];
  held.resolve(h.old);await flush();assert.equal(h.local(),h.created);assert.equal(JSON.stringify(h.ctx.state),state);
  assert.deepEqual([...h.storage],storage);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
});

test('unsubscribe 재사용: 이전 해제가 미완료이면 재클릭도 새 생성·중복 해제를 하지 않는다',async()=>{
  const h=harness({existing:true}),held=deferred();saved(h);await h.ctx.initializePush();
  h.old.options.applicationServerKey=new Uint8Array(65).buffer;h.behavior.unsubscribe=()=>held.promise;
  const before=JSON.stringify(h.ctx.state);
  await expired(h,h.ctx.enablePhonePush(),'이전 구독 해제');
  await expired(h,h.ctx.enablePhonePush(),'이전 구독 해제');
  assert.equal(h.calls.unsubscribe,1);assert.equal(h.calls.subscribe,0);
  held.resolve(true);await flush();
  assert.equal(h.local(),h.old);assert.equal(JSON.stringify(h.ctx.state),before);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
  await h.ctx.enablePhonePush();assert.equal(h.calls.unsubscribe,1);assert.equal(h.calls.subscribe,1);assert.equal(h.calls.save,1);
});

test('해제 미완료 중 조회가 null로 바뀌어도 재클릭은 기존 해제를 기다린 뒤 새 구독을 만든다',async()=>{
  const h=harness({existing:true}),held=deferred();h.old.options.applicationServerKey=new Uint8Array(65).buffer;
  h.behavior.unsubscribe=()=>held.promise;await expired(h,h.ctx.enablePhonePush(),'이전 구독 해제');
  h.current=null;const work=h.ctx.enablePhonePush();await flush();assert.equal(h.calls.subscribe,0);
  held.resolve(true);await work;assert.equal(h.calls.unsubscribe,1);assert.equal(h.calls.subscribe,1);assert.equal(h.calls.save,1);
});

test('disable 시간 초과: 즉시 잠금을 표시하고 저장된 목록·구독을 보존하며 동기화하지 않는다',async()=>{
  const h=harness({existing:true}),held=deferred();saved(h);await h.ctx.initializePush();h.behavior.unsubscribe=()=>held.promise;
  const before=JSON.stringify(h.ctx.state),work=h.ctx.disablePhonePush();
  assert.equal(h.nodes.disablePhonePush.disabled,true,'시작과 동시에 렌더한다');assert.equal(h.buttonDisabled(),true);
  await expired(h,work,'이전 구독 해제');
  assert.equal(h.nodes.disablePhonePush.disabled,false);assert.equal(h.local(),h.old);assert.equal(JSON.stringify(h.ctx.state),before);
  assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
  await expired(h,h.ctx.disablePhonePush(),'이전 구독 해제');assert.equal(h.calls.unsubscribe,1);
  held.resolve(true);await flush();assert.equal(h.local(),h.old);assert.equal(JSON.stringify(h.ctx.state),before);
  await h.ctx.disablePhonePush();assert.equal(h.local(),null);assert.deepEqual(plain(h.ctx.state.alerts.subscriptions),[]);
  assert.equal(h.calls.unsubscribe,1);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
});

test('disable 실패: 저장된 목록을 지우지 않고 단계·오류 이름만 안내한다',async()=>{
  const h=harness({existing:true});saved(h);await h.ctx.initializePush();
  h.behavior.unsubscribe=()=>Promise.reject(new TypeError('private-test-detail'));
  const before=JSON.stringify(h.ctx.state);await h.ctx.disablePhonePush();
  assert.equal(JSON.stringify(h.ctx.state),before);assert.equal(h.local(),h.old);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
  assert.match(h.message(),/이전 구독 해제 · TypeError/);assert.doesNotMatch(h.message(),/private-test-detail/);
  assert.deepEqual(h.logged,[]);assert.equal(h.busy(),false);assert.equal(h.time.size,0);
});

test('늦은 생성 완료 뒤 disable은 현재 구독을 조회해 해제하며 옛 결과를 전역에 반영하지 않는다',async()=>{
  const h=harness({existing:true}),held=deferred();saved(h);await h.ctx.initializePush();
  h.old.options.applicationServerKey=new Uint8Array(65).buffer;h.behavior.subscribe=()=>held.promise;
  await expired(h,h.ctx.enablePhonePush(),'구독 생성');held.resolve(h.created);await flush();assert.equal(h.local(),h.old);
  await h.ctx.disablePhonePush();assert.equal(h.current,null);assert.equal(h.local(),null);assert.equal(h.calls.subscribe,1);
  assert.deepEqual(plain(h.ctx.state.alerts.subscriptions),[]);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
});

test('생성 대기 중 disable로 바꿔도 그 생성부터 기다리며 새 구독을 만들어 중복시키지 않는다',async()=>{
  const h=harness({existing:true}),held=deferred();saved(h);await h.ctx.initializePush();
  h.old.options.applicationServerKey=new Uint8Array(65).buffer;h.behavior.subscribe=()=>held.promise;
  await expired(h,h.ctx.enablePhonePush(),'구독 생성');
  const work=h.ctx.disablePhonePush();await flush();assert.equal(h.calls.save,0);assert.equal(h.calls.subscribe,1);
  held.resolve(h.created);await work;assert.equal(h.current,null);assert.equal(h.local(),null);
  assert.equal(h.calls.subscribe,1);assert.equal(h.calls.unsubscribe,2);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
});

test('해제 대기 중 disable로 바꾸면 같은 해제 Promise를 재사용하고 늦은 결과는 새로 저장하지 않는다',async()=>{
  const h=harness({existing:true}),held=deferred();saved(h);await h.ctx.initializePush();
  h.old.options.applicationServerKey=new Uint8Array(65).buffer;h.behavior.unsubscribe=()=>held.promise;
  await expired(h,h.ctx.enablePhonePush(),'이전 구독 해제');
  const work=h.ctx.disablePhonePush();await flush();assert.equal(h.calls.unsubscribe,1);assert.equal(h.calls.subscribe,0);
  held.resolve(true);await work;assert.equal(h.calls.unsubscribe,1);assert.equal(h.calls.subscribe,0);
  assert.equal(h.local(),null);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
});

for(const outcome of ['enable','disable'])for(const phase of ['registration','subscription'])test(`initialize 세대 확인: ${phase} 조회가 ${outcome} 뒤 늦게 끝나도 새 구독 상태를 유지한다`,async()=>{
  const h=harness({existing:outcome==='disable'}),held=deferred();if(outcome==='disable')saved(h);
  if(phase==='registration')h.behavior.lookup=()=>h.calls.lookup===1?held.promise:h.registration;
  else h.behavior.query=()=>h.calls.query===1?held.promise:h.current;
  const initial=h.ctx.initializePush();await flush();
  if(outcome==='enable')await h.ctx.enablePhonePush();else await h.ctx.disablePhonePush();
  const expected=outcome==='enable'?h.created:null;
  assert.equal(h.local(),expected);
  if(phase==='registration'){
    h.behavior.query=()=>outcome==='enable'?null:h.old;
    held.resolve(h.registration);
  }else held.resolve(outcome==='enable'?null:h.old);
  await initial;assert.equal(h.local(),expected);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
});

test('권한 요청은 클릭 즉시 시작하고 30초 한도 없이 응답을 기다린다',async()=>{
  const h=harness({permission:'default'}),held=deferred();h.behavior.permission=()=>held.promise;
  const work=h.ctx.enablePhonePush();assert.equal(h.calls.permission,1);assert.deepEqual(h.order,['permission']);
  await h.time.advance(60000);assert.equal(h.busy(),true);assert.equal(h.calls.register,0);assert.equal(h.time.size,0);
  held.resolve('granted');await work;assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
});

test('종료 경로: 정상 연결은 기존 저장 모양과 성공 문구를 유지한다',async()=>{
  const h=harness();await h.ctx.enablePhonePush();
  assert.equal(h.local(),h.created);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
  assert.deepEqual(plain(h.ctx.state.alerts),{rules:[],subscriptions:[{id:'device-test',subscription:h.created.toJSON()}]});
  assert.match(h.message(),/이 휴대폰에 알림을 연결했습니다/);assert.equal(h.busy(),false);assert.equal(h.buttonDisabled(),false);
});

test('종료 경로: 권한 거부는 기존 문구를 유지하고 등록·저장하지 않는다',async()=>{
  const h=harness({permission:'default'});h.behavior.permission=()=> 'denied';await h.ctx.enablePhonePush();
  assert.equal(h.message(),'알림이 허용되지 않았습니다. 허용할 때 다시 눌러 주세요.');
  assert.equal(h.calls.register,0);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);assert.equal(h.busy(),false);
});

for(const [name,message] of [
  ['NotAllowedError','브라우저에서 알림 연결을 허용해 주세요.'],
  ['AbortError','알림 서비스를 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'],
  ['NotSupportedError','알림 연결을 완료하지 못했습니다. 동기화 상태와 브라우저 알림 설정을 확인해 주세요. (구독 생성 · NotSupportedError)']
])test(`종료 경로: ${name} 안내를 유지하고 오류 상세를 노출하지 않는다`,async()=>{
  const h=harness();h.behavior.subscribe=()=>Promise.reject(Object.assign(new Error('private-test-detail'),{name}));
  await h.ctx.enablePhonePush();assert.equal(h.message(),message);assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);
  assert.equal(h.local(),undefined);assert.equal(h.busy(),false);assert.equal(h.buttonDisabled(),false);assert.deepEqual(h.logged,[]);
  assert.doesNotMatch(h.nodes.pushSetup.innerHTML,/private-test-detail|fake-public|fake-auth|push\.example\.test/);
});

for(const [which,stage] of [['register','브라우저 알림 준비'],['query','구독 확인'],['unsubscribe','이전 구독 해제']])test(`기타 오류의 단계 안내: ${which} 실패도 name만 표시한다`,async()=>{
  const h=harness({existing:which==='unsubscribe'});
  if(which==='unsubscribe')h.old.options.applicationServerKey=new Uint8Array(65).buffer;
  h.behavior[which]=()=>{throw new TypeError('private-test-detail');};await h.ctx.enablePhonePush();
  assert.match(h.message(),new RegExp(`${stage} · TypeError`));assert.doesNotMatch(h.message(),/private-test-detail/);
  assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);assert.equal(h.busy(),false);
});

test('종료 경로: 구독 후 동기화 연결이 바뀌면 저장하지 않고 일반 안내에 연결 저장 단계를 붙인다',async()=>{
  const h=harness();h.behavior.subscribe=()=>{h.ctx.sync.repo='owner/changed-data';return h.created;};
  await h.ctx.enablePhonePush();assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);assert.equal(h.ctx.state.alerts,undefined);
  assert.match(h.message(),/연결 저장 · Error/);assert.equal(h.busy(),false);
});

test('종료 경로: 다른 기기 20개면 저장하지 않고 기존 목록을 보존한다',async()=>{
  const h=harness({initial:{alerts:{rules:[],subscriptions:Array.from({length:20},(_,i)=>({id:`fake-${i}`,subscription:{endpoint:`https://push.example.test/other-${i}`}}))}}});
  const before=JSON.stringify(h.ctx.state);await h.ctx.enablePhonePush();assert.equal(JSON.stringify(h.ctx.state),before);
  assert.equal(h.calls.save,0);assert.equal(h.calls.sync,0);assert.match(h.message(),/연결 저장 · Error/);assert.equal(h.busy(),false);
});

for(const [outcome,message] of [
  ['changed','동기화 연결이 바뀌었습니다. 현재 저장소에서 알림 연결을 다시 확인해 주세요.'],
  ['discard','동기화에서 다른 기록을 선택해 이 기기의 연결이 저장되지 않았습니다. 알림 받기를 다시 눌러 주세요.'],
  ['pending','이 기기에는 저장했습니다. 동기화를 완료하면 알림이 연결됩니다.'],
  ['complete','이 휴대폰에 알림을 연결했습니다. 다음 시세 수집부터 조건을 확인합니다.']
])test(`종료 경로: 동기화 뒤 ${outcome} 결과 문구를 유지한다`,async()=>{
  const h=harness();if(outcome!=='complete')h.behavior.sync=()=>{
    if(outcome==='changed')h.ctx.sync.repo='owner/changed-data';
    if(outcome==='discard')h.ctx.state.alerts.subscriptions=[];
  };
  await h.ctx.enablePhonePush();assert.equal(h.message(),message);assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
  assert.equal(h.busy(),false);assert.equal(h.time.size,0);
});

test('동기화 자체와 충돌 선택 대기에는 새 30초 한도를 적용하지 않는다',async()=>{
  const h=harness(),held=deferred();h.behavior.sync=()=>held.promise;
  const work=h.ctx.enablePhonePush();await flush();assert.equal(h.calls.save,1);assert.equal(h.calls.sync,1);
  await h.time.advance(60000);assert.equal(h.busy(),true);assert.equal(h.time.size,0);
  h.ctx.sync.base=JSON.stringify(h.ctx.state);held.resolve();await work;assert.equal(h.busy(),false);
});
