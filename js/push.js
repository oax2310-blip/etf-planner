// 휴대폰·PC 웹 푸시 연결·종목 이동. 규칙은 alerts.js·trade-alerts.js, 공통 이동 주소는 alert-target.js·push-sw.js와 연결된다.
const PUSH_CONFIG_FILE = "etf-planner-push.json";
const PUSH_CONFIG_KEY = "etf-planner-push-config";
const PUSH_DEVICE_KEY = "etf-planner-push-device";
let pushConfig = null, pushSubscription, pushBusy = false, pushTesting = false, pushMessage = "", pushMessageTone = "", pushMessageDetail = "", pushMessagePermission = "", pushConfigError = ""; // undefined: 브라우저 구독 조회 전, null: 구독 없음.
let pushStageWaitMs = 30000, pushGeneration = 0;
const PUSH_STAGE_TIMEOUT = Symbol("push-stage-timeout");
const pushPendingTasks = {registration:null,unsubscribe:null,subscribe:null};
let pendingPushTarget = null, pushAlertFrame = 0, pushAlertFontTarget = null;
try { pushConfig = JSON.parse(localStorage.getItem(PUSH_CONFIG_KEY) || "null"); } catch {}
// ruleId를 우선해 메뉴·항목을 식별한다. ID가 있으면 같은 코드의 다른 계좌로 대체하지 않는다.
// ID가 없는 옛 알림은 해당 메뉴에서 코드가 유일할 때만 이동한다. 이름·현재 선택은 대상 식별에 쓰지 않는다.
function pushAlertTab(target){
  const rule=target.ruleId;
  if(rule.startsWith("trade:plan:"))return "plans";
  if(rule.startsWith("trade:buy:"))return "buys";
  if(rule.startsWith("trade:rebuy:"))return "rebuy";
  if(rule.startsWith("trade:future:")||rule.startsWith("trade:future-rebuy:"))return "futures";
  return target.line.startsWith("분할매도 ")?"plans":target.line.startsWith("분할매수 ")||target.line.startsWith("매수대기 ")?"buys":target.line.startsWith("달러선물 ")?"futures":target.line.startsWith("재매수 ")?"rebuy":null;
}
function pushAlertDestination(target){
  const same=ticker=>linkTicker(ticker)===linkTicker(target.ticker), tab=pushAlertTab(target);
  const pick=(items,prefix)=>target.ruleId?items.find(x=>target.ruleId.startsWith(`${prefix}${x.key}:`)):items.length===1?items[0]:null;
  const plans=(state.plans||[]).filter(p=>same(p.ticker)).map(p=>({key:p.id,value:p}));
  const rebuys=rebuyItems(state).map((r,i)=>({key:r.id||`legacy-${i}`,value:r})).filter(x=>same(x.value.ticker));
  const buys=(assetStore.doc.allocation?.groups||[]).flatMap(g=>g.items||[]).filter(it=>it.buyPlan&&same(it.ticker)).map(it=>({key:it.id,value:it}));
  const forTab=kind=>{
    if(kind==="plans"){const p=pick(plans,"trade:plan:");if(p)return {tab:kind,planId:p.value.id};}
    if(kind==="buys"){const it=pick(buys,"trade:buy:");if(it)return {tab:kind,itemId:it.value.id};}
    if(kind==="rebuy"){const r=pick(rebuys,"trade:rebuy:");if(r)return {tab:kind,rebuyId:r.value.id||null};}
    if(kind==="futures"){
      const futureRebuy=target.ruleId?target.ruleId.startsWith("trade:future-rebuy:"):/손절|재매수/.test(target.line),f=state.futures;
      if(futureRebuy?f?.rebuy:(f?.positions||[]).some(p=>Number(p.contracts)>0)||(f?.levels||[]).some(l=>Number(l.price)>0||Number(l.contracts)>0))return {tab:kind,futureRebuy};
    }
    return null;
  };
  if(tab)return forTab(tab);
  const rule=alertRules().find(r=>same(r.ticker)&&(target.ruleId?r.id===target.ruleId:!target.line||`${r.period}${r.unit}`===target.line));
  if(target.ruleId)return rule?{tab:state.tab,ruleId:rule.id}:null;
  for(const kind of [...new Set([state.tab,"plans","buys","rebuy"])].filter(x=>x!=="futures")){const found=forTab(kind);if(found)return found;}
  return rule?{tab:state.tab,ruleId:rule.id}:null;
}
function clearPushAlertTarget(){
  pendingPushTarget=null;pushAlertFontTarget=null;
  if(pushAlertFrame)cancelAnimationFrame(pushAlertFrame);pushAlertFrame=0;
}
// 해시는 이동 완료까지 유지한다. 새 페이지·동기화·백그라운드 복귀 모두 같은 준비/완료 경로를 사용한다.
function openPushAlertFromHash(){
  const target=pushAlertTargetFromHash(location.hash);if(!target)return false;
  if(typeof noteAlertHistoryRead==="function")noteAlertHistoryRead(target.eventId);
  clearPushAlertTarget();pendingPushTarget=target;
  openTab(pushAlertTab(target)||state.tab);return true;
}
// render 전에는 대상 선택만 준비한다. 재귀 render나 DOM 유무만으로 이동을 완료하지 않는다.
// 알림은 미완료 회차에만 오므로 완료 회차 접기는 사용자가 둔 상태 그대로 둔다. 달러선물 손절만 접힌 한 줄에 회차가 없어 펼친다.
function applyPendingPushAlert(){
  if(!pendingPushTarget)return false;
  const found=pushAlertDestination(pendingPushTarget);if(!found)return false;
  if(found.planId)state.selectedPlan=found.planId;
  if(found.itemId)purchasePlanner.select(found.itemId);
  if("rebuyId" in found)state.selectedRebuy=found.rebuyId;
  if(found.futureRebuy)futureRebuyExpanded=true;
  openTab(found.tab,false);
  return true;
}
function pushAlertNode(found){
  if(found.ruleId)return [...$$("[data-alert-rule]")].find(x=>x.dataset.alertRule===found.ruleId);
  if(found.itemId)return [...$$("[data-purchase-item]")].find(x=>x.dataset.purchaseItem===found.itemId);
  return $(found.tab==="plans"?"planMain":found.tab==="rebuy"?"rebuyMain":found.futureRebuy?"futureRebuyPanel":"futureBuyCard");
}
// 렌더링·페이지 로딩·폰트·화면 복귀를 기다리고 실제 표시되는 요소에서만 완료한다. 시간 기반 재시도는 없다.
function schedulePendingPushAlert(){
  if(!pendingPushTarget||document.hidden||document.readyState!=="complete")return;
  const target=pendingPushTarget;
  if(document.fonts?.status==="loading"){
    if(pushAlertFontTarget!==target){pushAlertFontTarget=target;document.fonts.ready.then(()=>{if(pendingPushTarget===target){pushAlertFontTarget=null;render();}});}
    return;
  }
  if(pushAlertFrame)cancelAnimationFrame(pushAlertFrame);
  pushAlertFrame=requestAnimationFrame(()=>{
    pushAlertFrame=0;if(pendingPushTarget!==target||document.hidden)return;
    const found=pushAlertDestination(target);if(!found||state.tab!==found.tab)return;
    const node=pushAlertNode(found);if(!node?.isConnected)return;
    if(found.ruleId){
      closeAlertEditor();renderPushSetup();
      const details=node.closest("details");if(details)details.open=true;
      if(!$("alertsDialog").open)$("alertsDialog").showModal();
    }else if($("alertsDialog").open)$("alertsDialog").close();
    for(let parent=node.closest("details");parent;parent=parent.parentElement?.closest("details"))parent.open=true;
    if(!node.getClientRects().length)return;
    node.tabIndex=-1;node.focus({preventScroll:true});
    if(found.ruleId)node.scrollIntoView({block:"start"});else scrollBelowTop(node);
    flashTarget(node);
    clearPushAlertTarget();history.replaceState(null,"",`#${state.tab}`);
  });
}
function pushOnPc(){try{return typeof matchMedia==="function"&&matchMedia("(hover:hover) and (pointer:fine)").matches;}catch{return false;}}
function pushSupported(){return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;}
const pushNativeApp = () => typeof document!=="undefined"&&document.documentElement?.dataset?.nativeApp==="android";
function pushIsIos(){
  if(pushOnPc())return false;
  const ua=String(navigator.userAgent||""),platform=String(navigator.platform||"");
  return !/Android/i.test(ua)&&(/iPhone|iPad|iPod/i.test(ua)||(/Mac/i.test(platform)&&(navigator.maxTouchPoints||0)>1));
}
function pushIsAndroid(){
  if(pushNativeApp())return true;
  if(pushOnPc()||pushIsIos())return false;
  return /Android|SamsungBrowser/i.test(String(navigator.userAgent||""));
}
function pushIsSamsungBrowser(){return pushIsAndroid()&&/SamsungBrowser/i.test(String(navigator.userAgent||""));}
function pushIsFirefoxAndroid(){return pushIsAndroid()&&/Firefox|Fennec/i.test(String(navigator.userAgent||""));}
function pushIsAndroidWebView(){
  if(pushNativeApp())return true;
  if(!pushIsAndroid())return false;
  const ua=String(navigator.userAgent||"");
  if(/[;(]\s*wv(?:\s*[);]|$)|\bVersion\/\d+\.\d+\b/i.test(ua))return true;
  const brands=navigator.userAgentData?.brands;
  return Array.isArray(brands)&&brands.some(b=>/WebView/i.test(String(b?.brand||"")));
}
function pushIsChromeAndroid(){
  const ua=String(navigator.userAgent||"");
  if(!pushIsAndroid()||pushIsAndroidWebView()||navigator.brave)return false;
  if(!/Chrome\//i.test(ua)||/SamsungBrowser|Firefox|Fennec|EdgA|Edg\/|OPR\/|OPT\/|Whale\/|YaBrowser|UCBrowser|MiuiBrowser|HuaweiBrowser|Vivaldi|Brave|DuckDuckGo|Kiwi|NAVER|KAKAOTALK|Instagram|FB_IAB|FBAN|FBAV|Line\/|GSA\//i.test(ua))return false;
  const brands=navigator.userAgentData?.brands;
  return Array.isArray(brands)&&brands.some(b=>/^Google Chrome$/i.test(String(b?.brand||"")))&&!brands.some(b=>/Brave|WebView|Edge|Samsung|Opera|Whale|Vivaldi|DuckDuckGo|Kiwi/i.test(String(b?.brand||"")));
}
function pushAndroidBrowserLabel(){
  if(pushIsAndroidWebView())return "";
  if(pushIsFirefoxAndroid())return "Firefox";
  if(pushIsSamsungBrowser())return "삼성 인터넷";
  if(pushIsChromeAndroid())return "Chrome";
  return "";
}
function pushMissingFeatures(){
  const missing=[];
  if(!window.isSecureContext)missing.push("HTTPS");
  if(!("serviceWorker" in navigator))missing.push("ServiceWorker");
  if(!("PushManager" in window))missing.push("PushManager");
  if(!("Notification" in window))missing.push("Notification");
  return missing;
}
function pushDisplayMode(){
  try{
    if(typeof matchMedia==="function"){
      for(const mode of ["fullscreen","standalone","minimal-ui"])if(matchMedia(`(display-mode:${mode})`).matches)return mode;
    }
    if(navigator.standalone===true)return "standalone";
  }catch{}
  return "browser";
}
function pushNowClock(){
  try{return new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});}
  catch{return "";}
}
function pushPermissionState(){return typeof Notification!=="undefined"&&typeof Notification?.permission==="string"?Notification.permission:"";}
function setPushFeedback(message,tone="",detail=""){pushMessage=message;pushMessageTone=tone;pushMessageDetail=detail;pushMessagePermission=message?pushPermissionState():"";}
function focusPushFeedback(){
  const box=$("pushFeedback");
  if(box&&typeof box.scrollIntoView==="function")box.scrollIntoView({block:"nearest",behavior:"auto"});
}
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
// 저장된 이 기기 ID와 브라우저 구독만 비교한다. 조회 때 ID·구독·알림 기록을 만들거나 고치지 않는다.
function pushConnectionChanged(){
  if(pushSubscription===undefined||!connected()||!pushSupported()||!pushReady())return false;
  const deviceId=localStorage.getItem(PUSH_DEVICE_KEY);
  return !!deviceId&&pushDevices().some(s=>s?.id===deviceId&&s?.subscription?.endpoint&&s.subscription.endpoint!==pushSubscription?.endpoint);
}
// 알림내역이 다시 그려져도 읽지 않은 개수와 연결 경고를 함께 유지한다.
function renderPushConnectionStatus(unreadCount=typeof alertHistoryItems==="function"?alertHistoryItems().filter(alertHistoryUnread).length:0){
  const button=$("alertsBtn");if(!button)return;
  const changed=pushConnectionChanged(),warning=changed?"이 기기의 알림 연결 확인 필요":"";
  button.classList.toggle("push-connection-warning",changed);
  button.title=`알림내역${warning?` · ${warning}`:""}`;
  button.ariaLabel=`알림${unreadCount?`, 읽지 않은 알림 ${unreadCount}개`:""}${warning?`, ${warning}`:""}`;
}
function pushDeviceExpired(){return pushConfig?.repo===sync.repo && Array.isArray(pushConfig.inactiveDeviceIds) && pushConfig.inactiveDeviceIds.includes(localStorage.getItem(PUSH_DEVICE_KEY));}
function pushKeyMatches(subscription,key){
  const stored=subscription?.options?.applicationServerKey;
  if(!stored)return false;
  const a=new Uint8Array(stored),b=pushPublicBytes(key);
  return a.length===b.length&&a.every((value,i)=>value===b[i]);
}
function pushBlockedDetail(){
  const ios=pushIsIos(),android=pushIsAndroid(),webview=pushIsAndroidWebView(),mode=pushDisplayMode(),firefox=!webview&&pushIsFirefoxAndroid(),samsung=!webview&&pushIsSamsungBrowser(),chrome=!webview&&pushIsChromeAndroid();
  if(ios&&mode!=="browser")return "Notification.permission: denied · 아이폰·iPad 설정 → 알림에서 이 홈 화면 웹앱의 알림을 허용한 뒤 다시 열어 주세요.";
  if(ios)return "Notification.permission: denied · Safari 설정 또는 아이폰·iPad 설정 → 알림에서 허용한 뒤 다시 열어 주세요.";
  if(webview&&mode!=="browser")return "Notification.permission: denied · 휴대폰 설정 → 애플리케이션 → 현재 앱·설치한 브라우저 알림(또는 설치한 브라우저 사이트 설정 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
  if(webview)return "Notification.permission: denied · 현재 앱 설정 또는 설치한 브라우저의 사이트 설정 → 알림에서 허용으로 바꾼 뒤 새로고침해 주세요.";
  if(android&&mode!=="browser"){
    if(firefox)return "Notification.permission: denied · 휴대폰 설정 → 애플리케이션 → Firefox → 알림(또는 Firefox 일반 창 → 이 사이트 설정·사이트 권한 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
    if(samsung)return "Notification.permission: denied · 휴대폰 설정 → 애플리케이션 → 삼성 인터넷 → 알림(또는 삼성 인터넷 사이트 설정 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
    if(chrome)return "Notification.permission: denied · 휴대폰 설정 → 애플리케이션 → Chrome·이 웹앱 알림(또는 Chrome 사이트 설정 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
    return "Notification.permission: denied · 휴대폰 설정 → 애플리케이션 → 설치한 브라우저·이 웹앱 알림(또는 해당 브라우저 사이트 설정 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
  }
  if(firefox)return "Notification.permission: denied · 주소창 왼쪽 자물쇠·설정(또는 Firefox 설정 → 사이트 권한 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
  if(samsung)return "Notification.permission: denied · 주소창 옆 설정(또는 삼성 인터넷 → 설정 → 사이트 및 다운로드 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
  if(chrome)return "Notification.permission: denied · 주소창 옆 설정(또는 Chrome → 사이트 설정 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
  if(android)return "Notification.permission: denied · 주소창 옆 설정(또는 설치한 브라우저 → 사이트 설정 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
  return "Notification.permission: denied · 주소창 옆 설정(또는 브라우저 → 사이트 설정 → 알림)에서 허용으로 바꾼 뒤 새로고침해 주세요.";
}
function pushPermissionRejectedFeedback(permission){
  const blocked=permission==="denied"||Notification.permission==="denied";
  const pc=pushOnPc(),ios=pushIsIos(),android=pushIsAndroid(),webview=pushIsAndroidWebView(),browserLabel=pushAndroidBrowserLabel(),mode=pushDisplayMode(),done=pushNowClock();
  const inWebApp=mode!=="browser",timeText=done?`확인 ${done} · `:"";
  if(blocked){
    return {
      message:"알림이 허용되지 않았습니다. 허용할 때 다시 눌러 주세요.",
      tone:"bad",
      detail:`${timeText}${pushBlockedDetail()}`
    };
  }
  let hint="";
  if(ios){
    hint=inWebApp
      ?" · 이 홈 화면 앱의 알림 허용 창에서 ‘허용’을 선택하거나, 창이 뜨지 않으면 앱을 완전히 닫고 다시 연 뒤 아이폰·iPad 설정 → 알림에서 이 홈 화면 앱을 확인해 주세요"
      :" · iPhone·iPad에서는 Safari 공유 → ‘홈 화면에 추가’로 설치한 웹앱 안에서 알림을 허용해 주세요";
  }else if(webview){
    hint=inWebApp
      ?" · 현재 앱에서 허용 창이 열리지 않으면 설치한 브라우저의 일반 창에서 먼저 허용해 주세요"
      :" · 현재 앱에서 허용 창이 열리지 않으면 설치한 브라우저에서 사이트를 열어 확인해 주세요";
  }else if(android&&inWebApp){
    hint=browserLabel
      ?` · 홈 화면 웹앱에서 허용 창이 열리지 않으면 ${browserLabel} 일반 창에서 먼저 허용해 주세요`
      :" · 홈 화면 웹앱에서 허용 창이 열리지 않으면 설치한 브라우저의 일반 창에서 먼저 허용해 주세요";
  }else if(android){
    hint=browserLabel==="Firefox"
      ?" · Firefox 주소창 왼쪽 자물쇠·설정 또는 사이트 권한 → 알림에서 확인해 주세요"
      :browserLabel==="삼성 인터넷"
        ?" · 삼성 인터넷 주소창 옆 설정 또는 사이트 및 다운로드 → 알림에서 확인해 주세요"
        :browserLabel==="Chrome"
          ?" · Chrome 주소창 옆 설정 또는 사이트 설정 → 알림에서 확인해 주세요"
          :" · 설치한 브라우저의 주소창 옆 설정 또는 사이트 설정 → 알림에서 확인해 주세요";
  }else if(!pc&&inWebApp){
    hint=" · 홈 화면 웹앱에서 허용 창이 열리지 않으면 브라우저 일반 창에서 먼저 허용한 뒤 다시 시도해 주세요";
  }
  const androidTarget=webview?"현재 앱 또는 설치한 브라우저":(browserLabel||"설치한 브라우저");
  const message=ios&&inWebApp
    ?"알림이 허용되지 않았습니다. 이 홈 화면 앱에서 알림을 허용해야 합니다. 다시 눌러 허용 창이 뜨면 허용하거나, 아이폰·iPad 설정 → 알림에서 이 홈 화면 앱의 알림을 확인해 주세요."
    :`알림이 허용되지 않았습니다. 권한 확인 창이 뜨지 않았다면 ${android?androidTarget:"브라우저"}에서 알림을 허용한 뒤 다시 눌러 주세요.`;
  return {message,tone:"warn",detail:`${timeText}권한 ${permission}${hint}`};
}
function pushTestFeedbackInfo(delivered,usedIcon,swState){
  const pc=pushOnPc(),ios=pushIsIos(),android=pushIsAndroid(),webview=pushIsAndroidWebView(),firefox=!webview&&pushIsFirefoxAndroid(),samsung=!webview&&pushIsSamsungBrowser(),chrome=!webview&&pushIsChromeAndroid(),mode=pushDisplayMode(),done=pushNowClock();
  const zero=delivered===0,fullscreen=!pc&&mode==="fullscreen";
  const settingTarget=pc?"브라우저·운영체제 알림 설정(방해 금지)":
    ios?"아이폰·iPad 알림 설정(설정 → 알림·집중 모드)":
    webview?"휴대폰·현재 앱 알림 설정(앱 알림·방해 금지)":
    firefox?"휴대폰·Firefox 알림 설정(애플리케이션 → Firefox → 알림·방해 금지)":
    samsung?"휴대폰·삼성 인터넷 알림 설정(웹사이트·기타 알림·방해 금지)":
    chrome?"안드로이드·Chrome 알림 설정(사이트 알림·방해 금지)":
    android?"안드로이드·설치한 브라우저 알림 설정(사이트 알림·방해 금지)":
    "휴대폰·브라우저 알림 설정(방해 금지)";
  const message=zero
    ?`이 ${pc?"PC":"휴대폰"}에 테스트 알림을 요청했지만 활성 알림에 남지 않았습니다(0건). ${settingTarget}에서 차단되었는지 확인해 주세요.`
    :`이 ${pc?"PC":"휴대폰"}에 테스트 알림을 보냈습니다. 보이지 않으면 ${settingTarget}을 확인해 주세요.`;
  const statusBarHint=fullscreen
    ?(zero?"전체화면 앱은 위쪽 상태바가 숨겨집니다(화면 위에서 아래로 내려 알림창 확인)":"전체화면에서는 위쪽 상태바가 가려지니 화면 위에서 아래로 내려 알림창을 확인하세요")
    :"";
  const tailHint=zero?"":pc?"운영체제 알림 센터와 방해 금지 모드를 확인해 주세요":
    ios?"배너가 보이지 않으면 아이폰·iPad 설정 → 알림에서 이 웹앱의 배너·잠금화면 표시를 확인해 주세요":
    webview?"배너·소리가 보이지 않으면 휴대폰 설정 → 애플리케이션 → 현재 앱 알림 또는 설치한 브라우저의 알림 설정을 확인하세요":
    firefox?"배너·소리가 보이지 않으면 휴대폰 설정 → 애플리케이션 → Firefox → 알림 설정을 확인하세요":
    samsung?"팝업이 안 뜨면 알림 카테고리(웹사이트·기타 알림) 이름을 눌러 ‘팝업으로 알림’·소리를 확인하세요":
    android?"팝업이 안 뜨면 안드로이드 앱 알림 카테고리 이름을 눌러 ‘팝업으로 알림’·소리를 확인하세요":
    "배너·소리가 보이지 않으면 기기와 브라우저의 알림 설정을 확인해 주세요";
  const detail=[
    done?`시각 ${done}`:"",
    `권한 ${Notification.permission}`,
    `서비스 워커 ${swState}`,
    zero?"활성 알림 0건":delivered!==null?`활성 알림 ${delivered}건 확인`:"",
    !usedIcon?"아이콘 제외 재시도":"",
    statusBarHint,
    tailHint
  ].filter(Boolean).join(" · ");
  return {message,tone:zero?"warn":"ok",detail};
}
function pushFootHint(pc){
  if(pc)return "PC는 보통 브라우저가 켜져 있을 때 받고(플래너 탭은 닫아도 됨), 꺼져 있던 동안의 알림은 다시 켤 때(최대 24시간) 옵니다. Windows에서 브라우저를 닫아도 받으려면 Edge로 연결하고 Edge 설정 → 시스템 및 성능의 ‘닫혀 있을 때 백그라운드 확장 및 앱 계속 실행’을 켜 두세요. Windows·Mac 알림 설정이나 방해 금지(집중 모드)에서 브라우저 알림이 꺼져 있으면 보이지 않습니다. 휴대폰·다른 PC도 받으려면 그 기기에서 따로 연결하세요.";
  const ios=pushIsIos(),android=pushIsAndroid(),webview=pushIsAndroidWebView(),firefox=!webview&&pushIsFirefoxAndroid(),samsung=!webview&&pushIsSamsungBrowser(),chrome=!webview&&pushIsChromeAndroid(),mode=pushDisplayMode(),fullscreen=mode==="fullscreen";
  const body=ios
    ?"iPhone·iPad에서는 홈 화면에 추가한 웹앱에서 알림을 받을 수 있고, 잠금화면·배너 표시는 아이폰·iPad 설정 → 알림에서 바꿀 수 있습니다."
    :webview
      ?"잠금화면·팝업 표시는 현재 앱 또는 설치한 브라우저의 알림 설정에서 바꿀 수 있습니다."
      :firefox
        ?"잠금화면·팝업 표시는 휴대폰 설정 → 애플리케이션 → Firefox → 알림에서 바꿀 수 있습니다."
        :samsung
          ?"잠금화면·팝업 표시는 휴대폰·삼성 인터넷 알림 설정(알림 카테고리 → ‘웹사이트·기타 알림’)에서 바꿀 수 있습니다."
          :chrome
            ?(mode!=="browser"
              ?"잠금화면·팝업 표시는 휴대폰 설정 → 애플리케이션 → Chrome·이 웹앱 알림(또는 Chrome 사이트 설정 → 알림)에서 바꿀 수 있습니다."
              :"잠금화면·팝업 표시는 휴대폰 설정 → 애플리케이션 → Chrome → 알림(또는 Chrome 사이트 설정 → 알림)에서 바꿀 수 있습니다.")
            :android
              ?"잠금화면·팝업 표시는 안드로이드 설정 → 애플리케이션 → 설치한 브라우저 알림(또는 해당 브라우저 사이트 설정 → 알림)에서 바꿀 수 있습니다."
              :"잠금화면·배너 표시는 기기와 브라우저의 알림 설정에서 바꿀 수 있습니다.";
  return `${body}${fullscreen?" 전체화면 웹앱에서는 위쪽 상태바 아이콘이 숨겨집니다.":""} PC에서도 받으려면 PC 브라우저에서 이 창을 열어 따로 연결하세요.`;
}
function writePushFeedbackChildren(box,label,main,detail,extra){
  const sig=[label,main,detail,extra].join("\0");
  if(box._pushFeedbackSig===sig)return;
  box._pushFeedbackSig=sig;
  box.textContent="";
  if(!main)return;
  if(label){const head=document.createElement("div");head.className="push-feedback-head";head.textContent=label;box.appendChild(head);}
  const p=document.createElement("p");p.textContent=main;box.appendChild(p);
  if(detail){const d=document.createElement("small");d.textContent=detail;box.appendChild(d);}
  if(extra){const x=document.createElement("small");x.textContent=extra;box.appendChild(x);}
}
async function readPushConfig(){
  const repo=sync.repo;
  try{
    const response=await gh(`/repos/${repo}/contents/${PUSH_CONFIG_FILE}`,{headers:{Accept:"application/vnd.github.raw+json"}});
    if(sync.repo!==repo)return;
    if(response.status===404){pushConfig=null;localStorage.removeItem(PUSH_CONFIG_KEY);pushConfigError="";renderPushSetup();return;}
    if(!response.ok)throw Error("알림 발송 상태를 확인하지 못했습니다.");
    const doc=JSON.parse(await response.text());
    if(typeof doc.publicKey!=="string"||typeof doc.ready!=="boolean")throw Error("알림 연결 정보를 확인하지 못했습니다.");
    if(doc.publicKey)pushPublicBytes(doc.publicKey);
    if(sync.repo!==repo)return;
    pushConfig={repo,publicKey:doc.publicKey,ready:doc.ready,updatedAt:String(doc.updatedAt||""),status:String(doc.status||""),inactiveDeviceIds:Array.isArray(doc.inactiveDeviceIds)?doc.inactiveDeviceIds.filter(v=>typeof v==="string"&&v.length<=128).slice(0,20):[]};
    localStorage.setItem(PUSH_CONFIG_KEY,JSON.stringify(pushConfig));
    pushConfigError="";
  }catch{
    if(sync.repo!==repo)return;
    pushConfigError="알림 발송 상태를 확인하지 못했습니다. 동기화 후 다시 확인해 주세요.";
  }
  renderPushSetup();
}
// 기기마다 따로 연결하며 연결·발송 방식은 같다. 안내 문구만 PC(theme.js와 같은 마우스 기준)·모바일 환경별로 나눈다.
function renderPushSetup(){
  renderPushConnectionStatus();
  const target=$("pushSetup");if(!target)return;
  const supported=pushSupported(),saved=pushIsSaved(),ready=pushReady(),changed=pushConnectionChanged(),pc=pushOnPc(),ios=pushIsIos(),android=pushIsAndroid(),webview=pushIsAndroidWebView(),browserLabel=pushAndroidBrowserLabel(),device=pc?"PC":"휴대폰",nativeApp=pushNativeApp(),mode=pushDisplayMode();
  if(!connected())pushConfigError="";
  let message=!connected()?`동기화를 연결하면 알림 조건과 이 ${device}의 연결 정보를 비공개 저장소에 저장합니다.`:
    !supported?(nativeApp?"안드로이드 실행 앱(APK)은 웹 푸시를 지원하지 않습니다. 알림은 삼성 인터넷·Chrome에서 추가한 웹앱을 이용해 주세요.":webview?"현재 앱 화면에서는 웹 푸시를 지원하지 않습니다. 설치한 브라우저에서 사이트를 열어 주세요.":ios?"iPhone·iPad Safari에서는 공유 → ‘홈 화면에 추가’로 설치한 웹앱에서 열어 알림을 받아 주세요.":pc?"이 브라우저는 웹 푸시를 지원하지 않습니다. Chrome·Edge·Firefox·Safari에서 사이트를 열어 주세요.":android&&browserLabel?`${browserLabel}의 현재 환경에서는 웹 푸시를 지원하지 않습니다. HTTPS 주소의 일반 창이나 지원 브라우저에서 열어 주세요.`:android?"현재 앱 또는 설치한 브라우저의 현재 화면에서는 웹 푸시를 지원하지 않습니다. HTTPS 주소의 지원 브라우저에서 열어 주세요.":"이 브라우저는 웹 푸시를 지원하지 않습니다. 지원 브라우저에서 사이트를 열어 주세요."):
    Notification.permission==="denied"?(ios&&mode!=="browser"?"알림이 차단되어 있습니다. 아이폰·iPad 설정 → 알림에서 이 홈 화면 웹앱의 알림을 허용해 주세요.":webview?"알림이 차단되어 있습니다. 현재 앱 또는 설치한 브라우저의 알림 설정에서 알림을 허용해 주세요.":android&&mode!=="browser"?`알림이 차단되어 있습니다. ${browserLabel||"설치한 브라우저"} 또는 휴대폰 알림 설정에서 이 웹앱의 알림을 허용해 주세요.`:android?`알림이 차단되어 있습니다. ${browserLabel||"설치한 브라우저"}의 이 사이트 설정에서 알림을 허용해 주세요.`:"알림이 차단되어 있습니다. 브라우저의 이 사이트 설정에서 알림을 허용해 주세요."):
    !ready?`알림 연결을 준비 중입니다. 발송 설정이 적용된 뒤 동기화하고 이 ${device}에서 알림을 허용해 주세요.`:
    changed?"이 기기의 알림 연결이 끊겼거나 바뀌었습니다. 알림 연결 확인을 눌러 다시 연결해 주세요.":
    saved?(pushRemoteHas(pushSubscription.endpoint)?`이 ${device}에 알림이 연결되어 있습니다. 플래너를 닫아도 조건에 맞는 새 알림을 받습니다.`:`이 ${device}의 연결을 저장했습니다. 동기화가 끝나면 발송 서버에 반영됩니다.`):`이 ${device}에서 한 번 알림을 허용하면 플래너를 닫아도 받을 수 있습니다.`;
  if(saved && ready && !pushKeyMatches(pushSubscription,pushConfig.publicKey))message="알림 연결키가 바뀌었습니다. 알림 받기를 다시 눌러 연결해 주세요.";
  if(saved && pushDeviceExpired())message=`이 ${device}의 알림 연결이 만료되었습니다. 알림 연결 확인을 눌러 다시 연결해 주세요.`;
  if(saved && (sync.blocked||sync.failed))message=`이 ${device}의 연결은 저장되어 있습니다. 동기화를 완료해야 발송 서버에 반영됩니다.`;
  const status=pushConfig?.repo===sync.repo?pushConfig.status:"";
  if(status==="delivery-error")message+=" 최근 발송에 실패했습니다. 다음 수집 때 다시 시도합니다.";
  if(status==="collection-unavailable")message+=" 최근 시세 수집에 실패했습니다. 새 시세를 받은 뒤 발송을 재개합니다.";
  if(status==="linked-alerts-unavailable")message+=" 매매 기준 알림 계산을 확인 중입니다. 다음 수집에서 계산을 마치면 발송을 재개합니다.";
  const blockedPermission=supported&&Notification.permission==="denied";
  if(!pushBusy&&supported&&pushMessage&&((pushMessagePermission&&Notification.permission!==pushMessagePermission)||(blockedPermission&&pushMessageTone!=="bad")))setPushFeedback("");
  const disabled=pushBusy||!supported||!ready||sync.blocked||blockedPermission;
  const testDisabled=pushBusy||!supported||blockedPermission;
  let feedbackTone="",feedbackLabel="",feedbackMain="",feedbackDetail="",feedbackExtra="";
  if(!supported){
    feedbackTone="bad";
    feedbackLabel="알림 미지원";
    const missing=pushMissingFeatures();
    feedbackMain=nativeApp?"안드로이드 실행 앱(APK) 화면에서는 알림 받기·알림 테스트를 쓸 수 없습니다.":webview?"현재 앱 화면(WebView)에서는 알림 받기·알림 테스트를 쓸 수 없습니다.":ios?"현재 화면에서는 웹 푸시와 알림 테스트를 사용할 수 없습니다.":android&&!browserLabel?"현재 앱 또는 설치한 브라우저의 현재 화면에서는 웹 푸시와 알림 테스트를 사용할 수 없습니다.":"현재 브라우저 환경에서 웹 푸시와 알림 테스트를 사용할 수 없습니다.";
    feedbackDetail=nativeApp?`WebView 환경(${missing.join(" · ")||"Notification"} 미지원) · 기존 삼성 인터넷·Chrome에서 추가한 웹앱에서 열어 주세요.`:webview?`WebView 환경(${missing.join(" · ")||"Notification"} 미지원) · 설치한 브라우저에서 사이트를 열어 주세요.`:ios?`홈 화면에 추가한 웹앱에서만 지원됩니다(${missing.join(" · ")||"Notification"} 미지원) · Safari 공유 → ‘홈 화면에 추가’로 열어 주세요.`:`미지원 항목: ${missing.join(" · ")||"알림 API"} · HTTPS 주소의 지원 브라우저에서 열어 주세요.`;
    if(connected()&&pushConfigError)feedbackExtra=pushConfigError;
  }else if(blockedPermission){
    feedbackTone="bad";
    feedbackLabel="권한 차단됨";
    feedbackMain=ios&&mode!=="browser"?"기기의 알림 설정에서 이 웹앱의 알림이 차단되어 알림 받기·알림 테스트 버튼이 비활성화되어 있습니다.":webview?"현재 앱 또는 설치한 브라우저에서 알림이 차단되어 알림 받기·알림 테스트 버튼이 비활성화되어 있습니다.":android&&mode!=="browser"?`${browserLabel||"설치한 브라우저"} 또는 기기 알림 설정에서 이 웹앱의 알림이 차단되어 알림 받기·알림 테스트 버튼이 비활성화되어 있습니다.`:android?`${browserLabel||"설치한 브라우저"}에서 이 사이트의 알림이 차단되어 알림 받기·알림 테스트 버튼이 비활성화되어 있습니다.`:"브라우저에서 사이트 알림이 차단되어 알림 받기·알림 테스트 버튼이 비활성화되어 있습니다.";
    feedbackDetail=pushBlockedDetail();
    if(connected()&&pushConfigError)feedbackExtra=pushConfigError;
  }else if(pushMessage){
    feedbackTone=pushMessageTone||"info";
    feedbackLabel=feedbackTone==="busy"?"실행 중":feedbackTone==="ok"?"확인 완료":feedbackTone==="warn"?"확인 필요":feedbackTone==="bad"?"실행 불가":"상태";
    feedbackMain=pushMessage;
    feedbackDetail=pushMessageDetail;
    if(connected()&&pushConfigError)feedbackExtra=pushConfigError;
  }else if(connected()&&pushConfigError){
    feedbackTone="warn";
    feedbackLabel="발송 상태 확인 필요";
    feedbackMain=pushConfigError;
  }
  const headingText=`이 ${device}에서 알림 받기`;
  const enableLabel=pushBusy&&!pushTesting?"연결 중…":saved||changed?"알림 연결 확인":"알림 받기";
  const testLabel=pushTesting?"테스트 중…":"알림 테스트";
  const feedbackClass=`push-feedback${feedbackTone?` ${feedbackTone}`:""}`;
  const footText=`알림에는 종목·기준선·가격만 보냅니다. 알림 테스트는 이 기기의 브라우저 알림 표시를 확인합니다. ${pushFootHint(pc)}`;
  const liveDom=target.nodeType===1&&typeof document!=="undefined"&&typeof document.createElement==="function"&&typeof target.querySelector==="function";
  if(liveDom){
    let heading=target.querySelector("h3"),
        lead=target.querySelector("[data-push-lead]"),
        controls=target.querySelector(".sync-controls"),
        enableBtn=controls?.querySelector("#enablePhonePush"),
        testBtn=controls?.querySelector("#testPhonePush"),
        feedback=target.querySelector("#pushFeedback"),
        foot=target.querySelector("[data-push-foot]");
    if(!heading||!lead||!controls||!enableBtn||!testBtn||!feedback||!foot){
      heading=document.createElement("h3");
      lead=document.createElement("p");lead.className="hint";lead.setAttribute("data-push-lead","");
      controls=document.createElement("div");controls.className="sync-controls";
      enableBtn=document.createElement("button");enableBtn.className="btn primary";enableBtn.id="enablePhonePush";enableBtn.type="button";
      testBtn=document.createElement("button");testBtn.className="btn";testBtn.id="testPhonePush";testBtn.type="button";
      controls.appendChild(enableBtn);controls.appendChild(testBtn);
      feedback=document.createElement("div");feedback.className="push-feedback";feedback.id="pushFeedback";
      feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");
      foot=document.createElement("p");foot.className="hint";foot.setAttribute("data-push-foot","");
      target.textContent="";
      target.appendChild(heading);target.appendChild(lead);target.appendChild(controls);target.appendChild(feedback);target.appendChild(foot);
    }
    if(heading.textContent!==headingText)heading.textContent=headingText;
    if(lead.textContent!==message)lead.textContent=message;
    if(enableBtn.textContent!==enableLabel)enableBtn.textContent=enableLabel;
    if(enableBtn.disabled!==disabled)enableBtn.disabled=disabled;
    enableBtn.onclick=enablePhonePush;
    if(testBtn.textContent!==testLabel)testBtn.textContent=testLabel;
    if(testBtn.disabled!==testDisabled)testBtn.disabled=testDisabled;
    testBtn.onclick=testPhonePush;
    let disableBtn=controls.querySelector("#disablePhonePush");
    if(pushSubscription){
      if(!disableBtn){
        disableBtn=document.createElement("button");disableBtn.className="btn ghost";disableBtn.id="disablePhonePush";disableBtn.type="button";
        disableBtn.textContent="이 기기 알림 해제";
        controls.appendChild(disableBtn);
      }
      if(disableBtn.disabled!==pushBusy)disableBtn.disabled=pushBusy;
      disableBtn.onclick=disablePhonePush;
    }else if(disableBtn){
      disableBtn.remove();
    }
    if(feedback.className!==feedbackClass)feedback.className=feedbackClass;
    writePushFeedbackChildren(feedback,feedbackLabel,feedbackMain,feedbackDetail,feedbackExtra);
    if(foot.textContent!==footText)foot.textContent=footText;
    return;
  }
  const feedbackHtml=feedbackMain?`${feedbackLabel?`<div class="push-feedback-head">${esc(feedbackLabel)}</div>`:""}<p>${esc(feedbackMain)}</p>${feedbackDetail?`<small>${esc(feedbackDetail)}</small>`:""}${feedbackExtra?`<small>${esc(feedbackExtra)}</small>`:""}`:"";
  const html=`<h3>${esc(headingText)}</h3><p class="hint" data-push-lead>${esc(message)}</p><div class="sync-controls"><button class="btn primary" id="enablePhonePush" type="button" ${disabled?"disabled":""}>${esc(enableLabel)}</button><button class="btn" id="testPhonePush" type="button" ${testDisabled?"disabled":""}>${esc(testLabel)}</button>${pushSubscription?'<button class="btn ghost" id="disablePhonePush" type="button">이 기기 알림 해제</button>':""}</div><div class="${feedbackClass}" id="pushFeedback" role="status" aria-live="polite">${feedbackHtml}</div><p class="hint" data-push-foot>${esc(footText)}</p>`;
  const dom=typeof target.querySelector==="function";
  if(!dom||target._pushMarkup!==html||!target.contains?.($("enablePhonePush"))){
    target.innerHTML=html;
    if(dom)target._pushMarkup=html;
  }
  $("enablePhonePush").onclick=enablePhonePush;
  const test=$("testPhonePush");if(test){test.disabled=testDisabled;test.onclick=testPhonePush;}
  const disable=$("disablePhonePush");if(disable){disable.disabled=pushBusy;disable.onclick=disablePhonePush;}
}
async function pushRegistration(){
  const worker=new URL("push-sw.js",document.baseURI),scope=new URL("./",document.baseURI).href;
  const registration=await navigator.serviceWorker.register(worker.href,{scope,updateViaCache:"none"});
  return registration.active&&registration.active.state!=="redundant"?registration:await navigator.serviceWorker.ready;
}
async function probeTestNotifications(registration,closeExisting=false){
  if(typeof registration?.getNotifications!=="function")return null;
  let timer;
  try{
    const list=await Promise.race([
      registration.getNotifications({tag:"etf-planner-push-test"}),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})
    ]);
    if(!Array.isArray(list))return null;
    if(closeExisting)for(const item of list)try{item?.close?.();}catch{}
    return list.length;
  }catch{return null;}
  finally{clearTimeout(timer);}
}
// 시간 초과는 브라우저 작업을 취소하지 않는다. 정리 콜백은 보관만 비우며 기기·저장 기록을 바꾸지 않는다.
function pendingPushTask(kind,start){
  if(pushPendingTasks[kind])return pushPendingTasks[kind];
  const task=Promise.resolve().then(start);
  pushPendingTasks[kind]=task;
  const clear=()=>{if(pushPendingTasks[kind]===task)pushPendingTasks[kind]=null;};
  task.then(clear,clear);
  return task;
}
async function waitPushStage(task){
  let timer;
  try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(PUSH_STAGE_TIMEOUT),pushStageWaitMs);})]);}
  finally{clearTimeout(timer);}
}
function pushFailureMessage(error,stage,message){
  if(error===PUSH_STAGE_TIMEOUT)return `‘${stage}’ 단계가 30초 안에 끝나지 않았습니다. 잠시 뒤 다시 눌러 주세요.`;
  const name=typeof error?.name==="string"&&/^[A-Za-z]{1,64}$/.test(error.name)?error.name:"Error";
  return `${message} (${stage} · ${name})`;
}
// 권한은 사용자 버튼으로 요청한다. 구독·구독 주소는 비공개 기록에만, 발송키는 서버에만 둔다.
// state.alerts는 이 입력 때만 만들며 공개 기본값에는 기기 구독·구독 주소·발송키를 넣지 않는다.
async function enablePhonePush(){
  if(pushBusy||!pushSupported()||!pushReady()||sync.blocked)return;
  if(Notification.permission==="denied"){renderPushSetup();return;}
  const repo=sync.repo,key=pushConfig.publicKey,started=pushNowClock();
  pushGeneration++;pushBusy=true;
  setPushFeedback("브라우저와 저장소에 알림을 연결하는 중입니다…","busy",`${started?`시작 ${started} · `:""}권한 ${Notification.permission}`);
  renderPushSetup();
  let stage="알림 권한 확인";
  try{
    // permission request must stay on the click path (no network/registration wait before it).
    const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    focusPushFeedback();
    if(permission!=="granted"){
      const rejected=pushPermissionRejectedFeedback(permission);
      setPushFeedback(rejected.message,rejected.tone,rejected.detail);
      return;
    }
    stage="브라우저 알림 준비";
    const registration=await waitPushStage(pendingPushTask("registration",pushRegistration));
    // 이전 클릭의 변경 작업이 남아 있으면 먼저 기다린 뒤 조회한다. 키·구독이 바뀐 재시도에도 옛 결과를 저장하지 않는다.
    if(pushPendingTasks.unsubscribe){stage="이전 구독 해제";await waitPushStage(pushPendingTasks.unsubscribe);}
    if(pushPendingTasks.subscribe){stage="구독 생성";await waitPushStage(pushPendingTasks.subscribe);}
    stage="구독 확인";
    let subscription=await waitPushStage(registration.pushManager.getSubscription());
    if(subscription&&(!pushKeyMatches(subscription,key)||pushDeviceExpired())){
      stage="이전 구독 해제";
      await waitPushStage(pendingPushTask("unsubscribe",()=>subscription.unsubscribe()));subscription=null;
    }
    if(!subscription){
      stage="구독 생성";
      subscription=await waitPushStage(pendingPushTask("subscribe",()=>registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushPublicBytes(key)})));
    }
    stage="연결 저장";
    pushSubscription=subscription;
    if(sync.repo!==repo||!connected())throw Error("동기화 연결이 바뀌었습니다. 현재 저장소를 확인한 뒤 다시 연결해 주세요.");
    const subscriptions=pushDevices().filter(s=>s?.id!==pushDeviceId()&&s?.subscription?.endpoint!==subscription.endpoint);
    if(subscriptions.length>=20)throw Error("연결된 기기가 많습니다. 쓰지 않는 기기에서 알림을 해제해 주세요.");
    state.alerts={...state.alerts,rules:state.alerts?.rules||[],subscriptions:[...subscriptions,{id:pushDeviceId(),subscription:subscription.toJSON()}]};
    save();
    stage="동기화";
    await syncNow();
    const done=pushNowClock();
    if(sync.repo!==repo)setPushFeedback("동기화 연결이 바뀌었습니다. 현재 저장소에서 알림 연결을 다시 확인해 주세요.","warn",done?`확인 ${done}`:"");
    else if(!pushIsSaved())setPushFeedback("동기화에서 다른 기록을 선택해 이 기기의 연결이 저장되지 않았습니다. 알림 받기를 다시 눌러 주세요.","warn",done?`확인 ${done}`:"");
    else if(!pushRemoteHas(subscription.endpoint))setPushFeedback("이 기기에는 저장했습니다. 동기화를 완료하면 알림이 연결됩니다.","warn",done?`확인 ${done}`:"");
    else setPushFeedback(`이 ${pushOnPc()?"PC":"휴대폰"}에 알림을 연결했습니다. 다음 시세 수집부터 조건을 확인합니다.`,"ok",`${done?`완료 ${done} · `:""}권한 ${Notification.permission}`);
  }catch(error){
    const done=pushNowClock(),message=error?.name==="NotAllowedError"?"브라우저에서 알림 연결을 허용해 주세요.":error?.name==="AbortError"?"알림 서비스를 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.":pushFailureMessage(error,stage,"알림 연결을 완료하지 못했습니다. 동기화 상태와 브라우저 알림 설정을 확인해 주세요.");
    setPushFeedback(message,error===PUSH_STAGE_TIMEOUT||error?.name==="AbortError"?"warn":"bad",`${done?`확인 ${done} · `:""}${stage} · 권한 ${Notification.permission}`);
  }
  finally{pushBusy=false;renderPushSetup();focusPushFeedback();}
}
async function disablePhonePush(){
  if(pushBusy)return;
  const started=pushNowClock();
  pushGeneration++;pushBusy=true;
  setPushFeedback("이 기기의 알림 연결을 해제하는 중입니다…","busy",started?`시작 ${started}`:"");
  renderPushSetup();focusPushFeedback();
  let endpoint=pushSubscription?.endpoint;
  let stage="이전 구독 해제";
  try{
    if(pushPendingTasks.unsubscribe)await waitPushStage(pushPendingTasks.unsubscribe);
    if(pushPendingTasks.subscribe){stage="구독 생성";await waitPushStage(pushPendingTasks.subscribe);}
    // 시간 초과 뒤 브라우저에서만 끝난 생성·해제도 현재 구독을 읽어 확인한다.
    stage="브라우저 알림 준비";
    const registration=await waitPushStage(navigator.serviceWorker.getRegistration(new URL("./",document.baseURI).href));
    stage="구독 확인";
    const subscription=registration?await waitPushStage(registration.pushManager.getSubscription()):null;
    if(!endpoint)endpoint=subscription?.endpoint;
    if(subscription){stage="이전 구독 해제";await waitPushStage(pendingPushTask("unsubscribe",()=>subscription.unsubscribe()));}
    pushSubscription=null;
    if(state.alerts){state.alerts={...state.alerts,subscriptions:pushDevices().filter(s=>s?.id!==pushDeviceId()&&s?.subscription?.endpoint!==endpoint)};save();}
    stage="동기화";if(connected())await syncNow();
    const done=pushNowClock(),pending=pushRemoteHas(endpoint);
    setPushFeedback(
      pending?"이 기기 알림을 해제했습니다. 저장소에도 반영하려면 동기화를 완료해 주세요.":"이 기기 알림을 해제했습니다.",
      pending?"warn":"ok",
      done?`확인 ${done}`:""
    );
  }catch(error){
    const done=pushNowClock();
    setPushFeedback(
      pushFailureMessage(error,stage,"알림 해제를 완료하지 못했습니다. 브라우저의 사이트 설정에서도 알림을 차단할 수 있습니다."),
      error===PUSH_STAGE_TIMEOUT?"warn":"bad",
      `${done?`확인 ${done} · `:""}${stage}`
    );
  }
  finally{pushBusy=false;renderPushSetup();focusPushFeedback();}
}
// 서버 발송이 아닌 현재 브라우저·OS의 서비스 워커 알림 표시만 시험한다. 기록·구독·알림내역은 바꾸지 않는다.
async function testPhonePush(){
  if(pushBusy||!pushSupported())return;
  if(Notification.permission==="denied"){renderPushSetup();return;}
  const started=pushNowClock();
  pushBusy=true;pushTesting=true;
  setPushFeedback("테스트 알림을 보내는 중입니다…","busy",`${started?`시작 ${started} · `:""}권한 ${Notification.permission}`);
  renderPushSetup();
  let stage="알림 권한 확인";
  try{
    const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    focusPushFeedback();
    if(permission!=="granted"){
      const rejected=pushPermissionRejectedFeedback(permission);
      setPushFeedback(rejected.message,rejected.tone,rejected.detail);
      return;
    }
    stage="브라우저 알림 준비";
    const registration=await waitPushStage(pendingPushTask("registration",pushRegistration));
    if(typeof registration?.showNotification!=="function")throw Object.assign(Error("알림 표시를 지원하지 않습니다."),{name:"NotSupportedError"});
    stage="테스트 알림 표시";
    await probeTestNotifications(registration,true);
    const options={
      body:"이 기기에서 알림이 정상 표시됩니다.",
      tag:"etf-planner-push-test",
      renotify:true,
      data:{url:new URL("./",document.baseURI).href}
    };
    const icon=new URL("icons/planner-192.png",document.baseURI).href;
    let usedIcon=true;
    await waitPushStage(
      Promise.resolve()
        .then(()=>registration.showNotification("매매 플래너 테스트 알림",{...options,icon}))
        .catch(()=>{usedIcon=false;return registration.showNotification("매매 플래너 테스트 알림",options);})
    );
    const delivered=await probeTestNotifications(registration,false);
    const swState=typeof registration.active==="object"&&registration.active?.state?String(registration.active.state):"활성";
    const info=pushTestFeedbackInfo(delivered,usedIcon,swState);
    setPushFeedback(info.message,info.tone,info.detail);
  }catch(error){
    const done=pushNowClock(),message=error?.name==="NotAllowedError"?"브라우저에서 알림 표시를 허용해 주세요.":pushFailureMessage(error,stage,"테스트 알림을 표시하지 못했습니다. 브라우저와 기기의 알림 설정을 확인해 주세요.");
    setPushFeedback(message,error===PUSH_STAGE_TIMEOUT?"warn":"bad",`${done?`확인 ${done} · `:""}${stage} · 권한 ${Notification.permission}`);
  }finally{pushBusy=false;pushTesting=false;renderPushSetup();focusPushFeedback();}
}
async function initializePush(){
  // 알림 글자의 종목 이름표(stock-names.js)는 기록·자산이 바뀔 때 이 기기에만 다시 저장한다.
  if(typeof stockNames==="object")stockNames.remember();
  assetStore.subscribe(type=>{if(typeof stockNames==="object")stockNames.remember();if(type==="change"&&pendingPushTarget)render();});
  addEventListener("load",()=>{if(pendingPushTarget)render();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){if(pendingPushTarget)render();renderPushSetup();}});
  document.addEventListener("click",event=>{if(event.target.closest?.("[data-plan], [data-rebuy], [data-purchase-select]"))clearPushAlertTarget();},true);
  renderPushSetup();
  if(!pushSupported())return;
  const generation=pushGeneration;
  try{
    const registration=await navigator.serviceWorker.getRegistration(new URL("./",document.baseURI).href);
    const subscription=registration?await registration.pushManager.getSubscription():null;
    if(generation===pushGeneration)pushSubscription=subscription;
    if(registration?.update)registration.update().catch(()=>{});
  }catch{}
  renderPushSetup();
}
