// 휴대폰·PC 웹 푸시 연결·종목 이동. 규칙은 alerts.js·trade-alerts.js, 공통 이동 주소는 alert-target.js·push-sw.js와 연결된다.
const PUSH_CONFIG_FILE = "etf-planner-push.json";
const PUSH_CONFIG_KEY = "etf-planner-push-config";
const PUSH_DEVICE_KEY = "etf-planner-push-device";
let pushConfig = null, pushSubscription = null, pushBusy = false, pushMessage = "";
let pendingPushTarget = null;
try { pushConfig = JSON.parse(localStorage.getItem(PUSH_CONFIG_KEY) || "null"); } catch {}
// 발송된 ticker·line으로 기존 기록을 찾는다. 화면 선택(selectedPlan·selectedRebuy)은 이 기기에만 저장하고 매매 기록은 만들거나 고치지 않는다.
function pushAlertTab(target){
  return target.line.startsWith("분할매도 ")?"plans":target.line.startsWith("분할매수 ")||target.line.startsWith("매수대기 ")?"buys":target.line.startsWith("달러선물 ")?"futures":target.line.startsWith("재매수 ")?"rebuy":null;
}
function pushAlertDestination(target){
  const same=ticker=>linkTicker(ticker)===linkTicker(target.ticker), tab=pushAlertTab(target);
  const pick=(items,prefix,selected)=>items.find(x=>target.ruleId&&target.ruleId.startsWith(`${prefix}${x.id}:`))||items.find(x=>x.id===selected)||items[0];
  const plans=(state.plans||[]).filter(p=>same(p.ticker)), rebuys=rebuyItems(state).filter(r=>same(r.ticker));
  const buys=(assetStore.doc.allocation?.groups||[]).flatMap(g=>g.items||[]).filter(it=>it.buyPlan&&same(it.ticker));
  const forTab=kind=>{
    if(kind==="plans"){const p=pick(plans,"trade:plan:",state.selectedPlan);if(p)return {tab:kind,planId:p.id};}
    if(kind==="buys"){const it=pick(buys,"trade:buy:");if(it)return {tab:kind,itemId:it.id};}
    if(kind==="rebuy"){const r=pick(rebuys,"trade:rebuy:",state.selectedRebuy);if(r)return {tab:kind,rebuyId:r.id||null};}
    if(kind==="futures")return {tab:kind,futureRebuy:/손절|재매수/.test(target.line)};
    return null;
  };
  if(tab)return forTab(tab);
  for(const kind of [...new Set([state.tab,"plans","buys","rebuy"])].filter(x=>x!=="futures")){const found=forTab(kind);if(found)return found;}
  const rule=alertRules().find(r=>same(r.ticker)&&(target.ruleId?r.id===target.ruleId:!target.line||`${r.period}${r.unit}`===target.line));
  return rule?{tab:state.tab,ruleId:rule.id}:null;
}
function clearPushAlertTarget(){pendingPushTarget=null;}
// #alert? 이동 목표를 메모리에 남겨 아직 기록이 없는 기기도 동기화 후 다시 찾을 수 있게 한다.
function openPushAlertFromHash(){
  const target=pushAlertTargetFromHash(location.hash);if(!target)return false;
  pendingPushTarget=target;
  openTab(pushAlertTab(target)||state.tab);return true;
}
// 기록이 없으면 목표를 유지해 동기화 뒤 다시 찾는다. 찾은 뒤 해시를 일반 탭으로 돌려 평소 종목 선택을 방해하지 않는다.
function applyPendingPushAlert(){
  if(!pendingPushTarget)return false;
  const found=pushAlertDestination(pendingPushTarget);if(!found)return false;
  pendingPushTarget=null;
  if(found.planId)state.selectedPlan=found.planId;
  if(found.itemId)purchasePlanner.select(found.itemId);
  if("rebuyId" in found){if(state.selectedRebuy!==found.rebuyId)rebuyUnit=null;state.selectedRebuy=found.rebuyId;}
  if(found.futureRebuy)futureRebuyExpanded=true;
  openTab(found.tab);
  history.replaceState(null,"",`#${state.tab}`);
  let node;
  if(found.ruleId){
    closeAlertEditor();renderPushSetup();
    node=[...$$("[data-alert-rule]")].find(x=>x.dataset.alertRule===found.ruleId);
    if(node){node.closest("details").open=true;if(!$("alertsDialog").open)$("alertsDialog").showModal();}
  }else if(found.itemId)node=[...$$("[data-purchase-item]")].find(x=>x.dataset.purchaseItem===found.itemId);
  else node=$(found.tab==="plans"?"planMain":found.tab==="rebuy"?"rebuyMain":"futuresView");
  if(node){
    node.tabIndex=-1;node.focus({preventScroll:true});
    if(found.ruleId)node.scrollIntoView({block:"start"});
    else scrollTo({top:Math.max(0,node.getBoundingClientRect().top+scrollY-topBar.getBoundingClientRect().height-12),behavior:"auto"});
  }
  return true;
}
function pushOnPc(){try{return typeof matchMedia==="function"&&matchMedia("(hover:hover) and (pointer:fine)").matches;}catch{return false;}}
function pushSupported(){return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;}
function pushPublicBytes(key){
  const raw=atob(String(key).replace(/-/g,"+").replace(/_/g,"/"));
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length!==65||bytes[0]!==4)throw Error("알림 연결키를 확인할 수 없습니다.");
  return bytes;
}
function pushDeviceId(){
  let value=localStorage.getItem(PUSH_DEVICE_KEY);
  if(!value){value=id();localStorage.setItem(PUSH_DEVICE_KEY,value);}
  return value;
}
const pushDevices = () => Array.isArray(state.alerts?.subscriptions) ? state.alerts.subscriptions : [];
function pushIsSaved(){return !!pushSubscription && pushDevices().some(s=>s?.subscription?.endpoint===pushSubscription.endpoint);}
function pushRemoteHas(endpoint){
  if(!connected()||!endpoint)return false;
  try{return JSON.parse(sync.base||"{}").alerts?.subscriptions?.some(s=>s?.subscription?.endpoint===endpoint)===true;}catch{return false;}
}
function pushReady(){
  if(!connected()||pushConfig?.repo!==sync.repo||pushConfig.ready!==true||!pushConfig.publicKey)return false;
  try{pushPublicBytes(pushConfig.publicKey);return true;}catch{return false;}
}
function pushDeviceExpired(){return pushConfig?.repo===sync.repo && Array.isArray(pushConfig.inactiveDeviceIds) && pushConfig.inactiveDeviceIds.includes(localStorage.getItem(PUSH_DEVICE_KEY));}
function pushKeyMatches(subscription,key){
  const stored=subscription?.options?.applicationServerKey;
  if(!stored)return false;
  const a=new Uint8Array(stored),b=pushPublicBytes(key);
  return a.length===b.length&&a.every((value,i)=>value===b[i]);
}
async function readPushConfig(){
  const repo=sync.repo;
  try{
    const response=await gh(`/repos/${repo}/contents/${PUSH_CONFIG_FILE}`,{headers:{Accept:"application/vnd.github.raw+json"}});
    if(sync.repo!==repo)return;
    if(response.status===404){pushConfig=null;localStorage.removeItem(PUSH_CONFIG_KEY);renderPushSetup();return;}
    if(!response.ok)throw Error("알림 발송 상태를 확인하지 못했습니다.");
    const doc=JSON.parse(await response.text());
    if(typeof doc.publicKey!=="string"||typeof doc.ready!=="boolean")throw Error("알림 연결 정보를 확인하지 못했습니다.");
    if(doc.publicKey)pushPublicBytes(doc.publicKey);
    if(sync.repo!==repo)return;
    pushConfig={repo,publicKey:doc.publicKey,ready:doc.ready,updatedAt:String(doc.updatedAt||""),status:String(doc.status||""),inactiveDeviceIds:Array.isArray(doc.inactiveDeviceIds)?doc.inactiveDeviceIds.filter(v=>typeof v==="string"&&v.length<=128).slice(0,20):[]};
    localStorage.setItem(PUSH_CONFIG_KEY,JSON.stringify(pushConfig));
    pushMessage="";
  }catch{pushMessage="알림 발송 상태를 확인하지 못했습니다. 동기화 후 다시 확인해 주세요.";}
  renderPushSetup();
}
// 기기마다 따로 연결하며 연결·발송 방식은 같다. 안내 문구만 PC(theme.js와 같은 마우스 기준)와 휴대폰으로 나눈다.
function renderPushSetup(){
  const target=$("pushSetup");if(!target)return;
  const supported=pushSupported(),saved=pushIsSaved(),ready=pushReady(),pc=pushOnPc(),device=pc?"PC":"휴대폰";
  let message=!connected()?`동기화를 연결하면 알림 조건과 이 ${device}의 연결 정보를 비공개 저장소에 저장합니다.`:
    !supported?"이 브라우저는 웹 푸시를 지원하지 않습니다. 휴대폰은 안드로이드 Chrome, PC는 Chrome·Edge·Firefox·Safari에서 사이트를 열어 주세요.":
    Notification.permission==="denied"?"알림이 차단되어 있습니다. 브라우저의 이 사이트 설정에서 알림을 허용해 주세요.":
    !ready?`알림 연결을 준비 중입니다. 발송 설정이 적용된 뒤 동기화하고 이 ${device}에서 알림을 허용해 주세요.`:
    saved?(pushRemoteHas(pushSubscription.endpoint)?`이 ${device}에 알림이 연결되어 있습니다. 플래너를 닫아도 조건에 맞는 새 알림을 받습니다.`:`이 ${device}의 연결을 저장했습니다. 동기화가 끝나면 발송 서버에 반영됩니다.`):`이 ${device}에서 한 번 알림을 허용하면 플래너를 닫아도 받을 수 있습니다.`;
  if(saved && ready && !pushKeyMatches(pushSubscription,pushConfig.publicKey))message="알림 연결키가 바뀌었습니다. 알림 받기를 다시 눌러 연결해 주세요.";
  if(saved && pushDeviceExpired())message=`이 ${device}의 알림 연결이 만료되었습니다. 알림 연결 확인을 눌러 다시 연결해 주세요.`;
  if(saved && (sync.blocked||sync.failed))message=`이 ${device}의 연결은 저장되어 있습니다. 동기화를 완료해야 발송 서버에 반영됩니다.`;
  const status=pushConfig?.repo===sync.repo?pushConfig.status:"";
  if(status==="delivery-error")message+=" 최근 발송에 실패했습니다. 다음 수집 때 다시 시도합니다.";
  if(status==="collection-unavailable")message+=" 최근 시세 수집에 실패했습니다. 새 시세를 받은 뒤 발송을 재개합니다.";
  if(status==="linked-alerts-unavailable")message+=" 매매 기준 알림 계산을 확인 중입니다. 다음 수집에서 계산을 마치면 발송을 재개합니다.";
  const disabled=pushBusy||!supported||!ready||sync.blocked||Notification.permission==="denied";
  target.innerHTML=`<h3>이 ${device}에서 알림 받기</h3><p class="hint">${esc(message)}</p><div class="sync-controls"><button class="btn primary" id="enablePhonePush" type="button" ${disabled?"disabled":""}>${pushBusy?"연결 중…":saved?"알림 연결 확인":"알림 받기"}</button>${pushSubscription?'<button class="btn ghost" id="disablePhonePush" type="button">이 기기 알림 해제</button>':""}</div><p class="hint" role="status">${esc(pushMessage)}</p><p class="hint">알림에는 종목·기준선·가격만 보냅니다. ${pc?"PC는 보통 브라우저가 켜져 있을 때 받고(플래너 탭은 닫아도 됨), 꺼져 있던 동안의 알림은 다시 켤 때(최대 24시간) 옵니다. Windows에서 브라우저를 닫아도 받으려면 Edge로 연결하고 Edge 설정 → 시스템 및 성능의 ‘닫혀 있을 때 백그라운드 확장 및 앱 계속 실행’을 켜 두세요. Windows·Mac 알림 설정이나 방해 금지(집중 모드)에서 브라우저 알림이 꺼져 있으면 보이지 않습니다. 휴대폰·다른 PC도 받으려면 그 기기에서 따로 연결하세요.":"잠금화면 표시 여부는 휴대폰 알림 설정에서 바꿀 수 있습니다. PC에서도 받으려면 PC 브라우저에서 이 창을 열어 따로 연결하세요."}</p>`;
  $("enablePhonePush").onclick=enablePhonePush;
  const disable=$("disablePhonePush");if(disable){disable.disabled=pushBusy;disable.onclick=disablePhonePush;}
}
async function pushRegistration(){
  const worker=new URL("push-sw.js",document.baseURI),scope=new URL("./",document.baseURI).href;
  const registration=await navigator.serviceWorker.register(worker.href,{scope,updateViaCache:"none"});
  return registration.active?registration:await navigator.serviceWorker.ready;
}
// 권한은 사용자 버튼으로 요청한다. 구독·구독 주소는 비공개 기록에만, 발송키는 서버에만 둔다.
// state.alerts는 이 입력 때만 만들며 공개 기본값에는 기기 구독·구독 주소·발송키를 넣지 않는다.
async function enablePhonePush(){
  if(pushBusy||!pushSupported()||!pushReady()||sync.blocked)return;
  const repo=sync.repo,key=pushConfig.publicKey;
  pushBusy=true;pushMessage="";renderPushSetup();
  try{
    // permission request must stay on the click path (no network/registration wait before it).
    const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    if(permission!=="granted"){pushMessage="알림이 허용되지 않았습니다. 허용할 때 다시 눌러 주세요.";return;}
    const registration=await pushRegistration();
    let subscription=await registration.pushManager.getSubscription();
    if(subscription&&(!pushKeyMatches(subscription,key)||pushDeviceExpired())){await subscription.unsubscribe();subscription=null;}
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushPublicBytes(key)});
    pushSubscription=subscription;
    if(sync.repo!==repo||!connected())throw Error("동기화 연결이 바뀌었습니다. 현재 저장소를 확인한 뒤 다시 연결해 주세요.");
    const subscriptions=pushDevices().filter(s=>s?.id!==pushDeviceId()&&s?.subscription?.endpoint!==subscription.endpoint);
    if(subscriptions.length>=20)throw Error("연결된 기기가 많습니다. 쓰지 않는 기기에서 알림을 해제해 주세요.");
    state.alerts={...state.alerts,rules:state.alerts?.rules||[],subscriptions:[...subscriptions,{id:pushDeviceId(),subscription:subscription.toJSON()}]};
    save();
    await syncNow();
    pushMessage=sync.repo!==repo?"동기화 연결이 바뀌었습니다. 현재 저장소에서 알림 연결을 다시 확인해 주세요.":
      !pushIsSaved()?"동기화에서 다른 기록을 선택해 이 기기의 연결이 저장되지 않았습니다. 알림 받기를 다시 눌러 주세요.":
      !pushRemoteHas(subscription.endpoint)?"이 기기에는 저장했습니다. 동기화를 완료하면 알림이 연결됩니다.":`이 ${pushOnPc()?"PC":"휴대폰"}에 알림을 연결했습니다. 다음 시세 수집부터 조건을 확인합니다.`;
  }catch(error){pushMessage=error?.name==="NotAllowedError"?"브라우저에서 알림 연결을 허용해 주세요.":error?.name==="AbortError"?"알림 서비스를 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.":"알림 연결을 완료하지 못했습니다. 동기화 상태와 브라우저 알림 설정을 확인해 주세요.";}
  finally{pushBusy=false;renderPushSetup();}
}
async function disablePhonePush(){
  if(pushBusy)return;pushBusy=true;pushMessage="";
  const endpoint=pushSubscription?.endpoint;
  try{
    if(pushSubscription)await pushSubscription.unsubscribe();
    pushSubscription=null;
    if(state.alerts){state.alerts={...state.alerts,subscriptions:pushDevices().filter(s=>s?.id!==pushDeviceId()&&s?.subscription?.endpoint!==endpoint)};save();}
    if(connected())await syncNow();
    pushMessage=pushRemoteHas(endpoint)?"이 기기 알림을 해제했습니다. 저장소에도 반영하려면 동기화를 완료해 주세요.":"이 기기 알림을 해제했습니다.";
  }catch{pushMessage="알림 해제를 완료하지 못했습니다. 브라우저의 사이트 설정에서도 알림을 차단할 수 있습니다.";}
  finally{pushBusy=false;renderPushSetup();}
}
async function initializePush(){
  assetStore.subscribe(type=>{if(type==="change"&&pendingPushTarget)render();});
  renderPushSetup();
  if(!pushSupported())return;
  try{const registration=await navigator.serviceWorker.getRegistration(new URL("./",document.baseURI).href);pushSubscription=registration?await registration.pushManager.getSubscription():null;if(registration?.update)registration.update().catch(()=>{});}catch{}
  renderPushSetup();
}
