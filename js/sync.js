// 플래너 저장·GitHub 동기화·JSON 백업/복원. 시세 채우기는 prices.js, 분할매수·자산 기록은 assets-store.js.
// core.js 이름을 새로 사용하면 가짜 core 값으로 불러오는 tests/sync.test.cjs도 맞춘다.
const initialSnapshot = dataSnapshot();
const DATA_FILE = "etf-planner-data.json";
const DEFAULT_DATA_REPO = repoSecurity.defaultData;
// assets-store.js·valuation.js도 같은 키를 읽는다(시나리오는 etf-planner-scenarios.json); 이름 변경은 함께 적용.
const REPO_KEY = "etf-planner-data-repo";
const TOKEN_KEY = "etf-planner-github-token"; // 토큰은 기기별 localStorage 전용(Contents 읽기·쓰기).
const SYNC_BASE_KEY = "etf-planner-sync-base:";
const LAST_REPO_KEY = "etf-planner-last-data-repo";
const RECOVERY_KEY = "etf-planner-sync-recovery";
const PRICE_FILE = "etf-planner-prices.json"; // 데이터 저장소 Actions(KIS 시세 수집)가 올리는 시세 파일. 읽기만 한다(채우는 규칙은 prices.js)
const PRICE_KEY = "etf-planner-prices"; // 마지막으로 읽은 시세(채우기·표시에 쓰는 값과 ETag만). 이 기기에만 두고 동기화 기록에는 넣지 않는다
let priceData = null; try { priceData = JSON.parse(localStorage.getItem(PRICE_KEY) || "null"); if (!priceData?.stocks || !priceData.futures) priceData = null; } catch {}
let priceRefreshBusy=false, priceReadMessage="";
// stored: 이 페이지가 마지막으로 읽거나 쓴 플래너 기록 원문(같은 브라우저의 다른 페이지가 그 뒤 저장했는지 비교, storePlanner·absorbPlanner).
const sync = {token:"",repo:"",sha:"",base:"",busy:false,again:false,blocked:false,failed:false,localFailed:false,checked:false,timer:null,redraw:false,waitTyping:false,stored:localStorage.getItem(STORAGE_KEY)};
// 순서는 plans → futures → actions → rebuy → alerts → alertHistory(readRemote도 같음). 미입력 선택 필드는 JSON에서 빠진다.
// tab·selectedPlan·selectedRebuy는 이 기기에만; 시세 캐시·화면 상태도 동기화 밖.
function snapshotOf(d){return JSON.stringify({plans:d.plans,futures:d.futures,actions:d.actions,rebuy:d.rebuy,alerts:d.alerts,alertHistory:d.alertHistory});} // 맨 위 initialSnapshot보다 먼저 쓰이므로 함수 선언
function dataSnapshot(){return snapshotOf(state);}
const repoOk = r => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(r);
const connected = () => !!(sync.token && sync.repo);
// 빈 기기만 처음 연결 때 자동 수신. rebuy·alerts가 있으면 비어 있지 않다.
// 옛 futures.rolls·targetProfit·actions도 이 판정에 보존한다(화면·계산에 다시 넣지 않음).
const isBlank = json => {const d=JSON.parse(json),f=d.futures||{},a=d.actions||{},al=a.allocation||{};return !(d.plans||[]).length&&!(f.positions||[]).length&&!(f.rolls||[]).length&&!Number(f.baselinePnl)&&!Number(f.targetProfit)&&!f.note&&!f.rebuy&&!f.buyPlan&&!(f.levels||[]).some(l=>Number(l.contracts)>0||Number(l.price)>0)&&!(a.buys||[]).some(b=>b.completed||b.actualKrw)&&!(a.adobeSales||[]).some(s=>s.completed||s.plannedShares||s.soldShares||s.priceUsd)&&!a.buyNote&&!a.adobeNote&&!al.completed&&!al.note&&!al.targetNasdaqPct&&!al.targetCoveredCallPct&&!d.rebuy&&!d.alerts;};
function syncStatus(message){$("syncStatus").textContent=message;$("syncDialogStatus").textContent=message;const btn=$("syncBtn");btn.title=message;syncBadge();}
// 동기화 버튼 아이콘 상태: off(연결 안 됨, 회전 아이콘 대신 빨간 ! 표시) · busy(도는 중) · ok(초록 점) · warn(주황 점, 확인 필요)
function syncBadge(){$("syncBtn").className="btn mini sync-btn "+(!connected()?"off":sync.failed||sync.blocked?"warn":sync.busy?"busy":"ok");priceRefreshControls();if(typeof renderPushConnectionStatus==="function")renderPushConnectionStatus();}
function priceRefreshControls(){for(const key of ["refreshPricesBtn","refreshPricesDialogBtn"]){const btn=$(key);btn.disabled=sync.busy||priceRefreshBusy;btn.ariaBusy=String(priceRefreshBusy);btn.textContent=priceRefreshBusy?"시세 불러오는 중…":"시세 즉시 불러오기";}}
function scheduleSync(delay=1500){if(!connected()||sync.blocked)return;clearTimeout(sync.timer);sync.timer=setTimeout(()=>syncNow(),delay);}
// 같은 브라우저의 여러 페이지(탭·창·뒤로 가기로 복원한 화면·알림으로 다시 연 화면)는 state를 따로 들고 기기 기록(STORAGE_KEY)과 동기화 기준(SYNC_BASE_KEY)은 함께 쓴다.
// 옛 state를 가진 페이지가 그대로 덮어쓰면 다른 페이지의 체결·알림 삭제가 기기 기록에서 사라지고, 다음에 열 때 더 새 동기화 기준과 비교해 이 기기에서 지운 수정으로 보고
// 저장소까지 되돌린다(서버는 미완료 회차로 보고 재알림). 그래서 쓰기 전(storePlanner)·받을 때(absorbPlanner) 다른 페이지 기록과 합친다.
const PLANNER_FIELDS=["plans","futures","actions","rebuy","alerts","alertHistory"]; // snapshotOf의 동기화 항목
const parsePlanner=text=>{try{const value=text?JSON.parse(text):null;return value&&typeof value==="object"&&!Array.isArray(value)?value:null;}catch{return null;}};
// mine(이 페이지)에 theirs(다른 페이지)를 합친다. base는 이 페이지가 마지막으로 읽거나 쓴 기록(없으면 null). 동기화 항목은 기기 간 병합과 같은 mergeThreeWay
// (겹친 칸은 preferMine 쪽), 알림내역은 합집합(alertHistoryStore.merge: 삭제·읽음 유지), 탭·선택 계획 같은 화면 상태는 이 페이지 값. 원본은 바꾸지 않는다.
function mergePlannerPages(mine,theirs,base,preferMine){
  const view=d=>{if(!d)return undefined;const copy=JSON.parse(JSON.stringify(d));normalize(copy);return JSON.parse(snapshotOf(copy));};
  const merged=mergeThreeWay(JSON.parse(snapshotOf(mine)),view(theirs),view(base),preferMine).value||{},next={...mine};
  for(const key of PLANNER_FIELDS){if(merged[key]===undefined)delete next[key];else next[key]=merged[key];}
  if((mine.alertHistory||theirs?.alertHistory)&&typeof alertHistoryStore==="object")next.alertHistory=alertHistoryStore.merge(mine.alertHistory,theirs?.alertHistory);
  normalize(next);return next;
}
// 기기 기록에 쓴다. 다른 페이지가 그사이 쓴 기록이 있으면 합친 뒤 쓰고 true. 브라우저 저장이 실패하면 예외를 던지고 state도 바꾸지 않는다.
function storePlanner(next,preferMine=true){
  const raw=localStorage.getItem(STORAGE_KEY),theirs=raw!==null&&raw!==sync.stored?parsePlanner(raw):null;
  if(theirs)next=mergePlannerPages(next,theirs,parsePlanner(sync.stored),preferMine);
  const text=JSON.stringify(next);localStorage.setItem(STORAGE_KEY,text);sync.stored=text;state=next;return !!theirs;
}
// 다른 페이지가 저장한 기록을 받는다(storage 알림·화면 복귀·뒤로 가기 복원·알림으로 이동·동기화 직전). 겹친 칸은 나중에 쓴 다른 페이지 값. 받았으면 true.
// 동기화 항목이 받은 기록과 같으면 다시 쓰지 않는다(페이지끼리 저장을 주고받지 않게). 기기 기록과 같아진 뒤에는 기기의 동기화 기준도 받아
// 기록·기준의 짝을 맞춘다(다른 페이지가 이미 올린 변경을 겹친 칸으로 묻지 않게).
function absorbPlanner(){
  const raw=localStorage.getItem(STORAGE_KEY),theirs=raw!==null&&raw!==sync.stored?parsePlanner(raw):null;
  if(theirs){
    const next=mergePlannerPages(state,theirs,parsePlanner(sync.stored),false),copy=JSON.parse(raw);normalize(copy);
    sync.stored=raw;if(snapshotOf(next)!==snapshotOf(copy)){
      try{storePlanner(next);setLocalSaveFailed(false);}catch(error){setLocalSaveFailed(true);throw error;}
    }else state=next;
    sync.redraw=true;
  }
  const base=!sync.localFailed&&sync.repo&&localStorage.getItem(STORAGE_KEY)===sync.stored?localStorage.getItem(SYNC_BASE_KEY+sync.repo):null;
  if(base)sync.base=base;
  return !!theirs;
}
// 저장할 때 알림 글자용 종목 이름표(stock-names.js)도 이 기기에만 다시 만든다. 동기화 기록에는 넣지 않는다. 다른 페이지 기록을 합쳤으면 이 작업이 끝난 뒤 다시 그린다.
// 실패 중에는 기기 기록과 기준의 옛 짝을 남긴다. 실제 기록 저장이 회복된 뒤에만 메모리 기준도 쓴다.
function setLocalSaveFailed(failed){
  if(!failed&&sync.localFailed&&connected()){
    try{localStorage.setItem(SYNC_BASE_KEY+sync.repo,sync.base);}catch(error){console.error(error);failed=true;}
  }
  sync.localFailed=failed;
  renderLocalSaveWarning();
}
// 플래너와 공유 자산의 실패는 독립적으로 표시한다. 백업은 기존 버튼과 같은 메모리 기록을 내려받는다.
function renderLocalSaveWarning(){
  const box=$("localSaveWarning");if(!box)return;
  const assetsFailed=typeof assetStore!=="undefined"&&assetStore.localSaveFailed;
  $("plannerLocalSaveWarning").hidden=!sync.localFailed;$("assetLocalSaveWarning").hidden=!assetsFailed;
  $("plannerLocalSaveMessage").textContent="이 기기 브라우저에 기록을 저장하지 못했습니다(저장 공간 부족 등). 페이지를 닫기 전에 JSON 백업을 받아 두세요.";
  $("assetLocalSaveMessage").textContent="분할매수·자산 기록을 이 기기 브라우저에 저장하지 못했습니다. JSON 백업을 받아 두세요.";
  $("plannerLocalSaveExport").textContent="JSON 백업";$("assetLocalSaveExport").textContent="분할매수·자산 JSON 백업";
  $("plannerLocalSaveExport").onclick=()=>$("exportBtn").click();$("assetLocalSaveExport").onclick=()=>$("purchaseExport").click();
  box.hidden=!sync.localFailed&&!assetsFailed;
}
function save(next=state){
  let merged=false;
  try{merged=storePlanner(next);setLocalSaveFailed(false);}catch(error){console.error(error);setLocalSaveFailed(true);}
  if(merged){sync.redraw=true;Promise.resolve().then(()=>{if(sync.redraw)redrawIdle();});}
  if(connected() && dataSnapshot()!==sync.base) scheduleSync();
  if(typeof stockNames==="object")stockNames.remember();
}
// 복구본: 덮어쓰기(충돌 선택·JSON 복원) 전 기록을 이 기기에 최근 RECOVERY_LIMIT개까지 목록으로 남긴다(옛 한 개 형식도 목록으로 읽음).
// 각 항목은 그대로 JSON 복원할 수 있는 플래너 기록 + recoveryReason·exportedAt. 저장 공간이 모자라면 오래된 것부터 줄이고, 하나도 못 남기면 예외로 덮어쓰기를 멈춘다.
const RECOVERY_LIMIT = 5;
function recoveryList(){try{const v=JSON.parse(localStorage.getItem(RECOVERY_KEY)||"null");return (Array.isArray(v)?v:v?[v]:[]).filter(x=>x&&typeof x==="object"&&!Array.isArray(x));}catch{return [];}}
function backupRecord(json,reason){
  const list=[...recoveryList(),{...JSON.parse(json),recoveryReason:reason,exportedAt:new Date().toISOString()}];
  for(let n=Math.min(RECOVERY_LIMIT,list.length);;n--){try{localStorage.setItem(RECOVERY_KEY,JSON.stringify(list.slice(-n)));break;}catch(error){if(n<=1)throw error;}}
  renderRecovery();
}
const recordSummary = d => {const pos=Array.isArray(d?.futures?.positions)?d.futures.positions:[],n=pos.reduce((t,p)=>t+(Number(p?.contracts)>0?Number(p.contracts):0),0);return `계획 ${Array.isArray(d?.plans)?d.plans.length:0}개 · 달러선물 ${pos.length}개 월물${n?` ${n}계약`:""}`;};
const recordTime = at => {const t=Date.parse(at);return t?new Date(t).toLocaleString("ko-KR",{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"";};
// 동기화 창의 복구본 목록(최근 것부터). 글자는 textContent로만 넣는다.
function renderRecovery(){
  const box=$("syncRecoveryList"),list=recoveryList().reverse();box.hidden=!list.length;
  box.replaceChildren(...(list.length?[Object.assign(document.createElement("p"),{className:"sync-details",textContent:`플래너 보관 기록 (이 기기에만 최근 ${RECOVERY_LIMIT}개까지 · 내려받아 JSON 파일 복원으로 되돌릴 수 있음)`})]:[]),...list.map(r=>{
    const row=Object.assign(document.createElement("p"),{className:"sync-details sync-recovery-row",textContent:`${recordTime(r.exportedAt)||"시각 없음"} · ${typeof r.recoveryReason==="string"?r.recoveryReason:"보관한 기록"} · ${recordSummary(r)} `});
    row.append(Object.assign(document.createElement("button"),{type:"button",className:"btn mini",textContent:"내려받기",onclick:()=>downloadJson(r,`etf-planner-recovery-${String(r.exportedAt||"").slice(0,10)||"record"}.json`)}));
    return row;
  }));
}
function downloadJson(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
const toB64 = text => {const bytes=new TextEncoder().encode(text);let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(bin);};
const fromB64 = b64 => repoSecurity.decodeBase64Text(b64);
async function gh(path,options={}){
  return repoSecurity.dataRequest(sync,path,options);
}
// 업로드 전 비공개 저장소인지 확인하고 공개 저장소면 거부한다.
async function checkRepo(){
  await repoSecurity.checkPrivateDataRepo(sync,{
    notFound:`저장소 ${sync.repo}를 찾을 수 없습니다. 이름과 토큰에 고른 저장소를 확인해 주세요.`,
    publicRepo:`${sync.repo}는 공개 저장소라 기록을 올리지 않았습니다. 비공개 저장소를 지정해 주세요.`
  });
  sync.checked=true;
}
async function readRemote(){
  const path=`/repos/${sync.repo}/contents/${DATA_FILE}`,response=await gh(path);
  if(response.status===404)return {sha:"",snapshot:null};
  if(!response.ok)throw Error(`기록 읽기 실패 (${response.status})`);
  const meta=await response.json();
  let text=meta.encoding==="base64"&&meta.content?fromB64(meta.content):null;
  if(text===null){const raw=await gh(path,{headers:{Accept:"application/vnd.github.raw+json"}});if(!raw.ok)throw Error(`기록 읽기 실패 (${raw.status})`);text=await raw.text();}
  let data;try{data=JSON.parse(text);}catch{throw Error("저장소의 기록 파일을 읽을 수 없습니다. 자동으로 덮어쓰지 않았습니다.");}
  externalData.planner(data);
  if(!data.actions)throw Error("저장소의 기록 파일 형식을 확인할 수 없습니다. 자동으로 덮어쓰지 않았습니다.");
  return {sha:meta.sha,snapshot:snapshotOf(data)};
}
// SHA로 다른 기기의 선행 저장(409/422)을 감지해 다시 읽는다.
async function writeRemote(snapshot,sha){
  const body={message:`기록 동기화 ${new Date().toISOString()}`,content:toB64(JSON.stringify(externalData.planner(JSON.parse(snapshot)),null,2)+"\n"),...(sha?{sha}:{})};
  const response=await gh(`/repos/${sync.repo}/contents/${DATA_FILE}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(response.status===409||response.status===422){const error=Error("다른 기기가 먼저 저장했습니다. 다시 확인합니다.");error.stale=true;throw error;}
  if(!response.ok)throw Error(`기록 저장 실패 (${response.status})`);
  const result=await response.json();sync.sha=result.content?.sha||"";
  return result;
}
// 시세 파일 읽기: ETag로 바뀌었을 때만 받는다(안 바뀌면 304, 이 기기에 둔 시세가 옛 형식(PRICE_FORMAT)이면 다시 받음). 실패해도 동기화는 계속하고 지난 시세를 쓴다. 시세가 바뀌었으면 true.
async function readPrices(force=false){
  const cfg={repo:sync.repo,token:sync.token},same=()=>sync.repo===cfg.repo&&sync.token===cfg.token;
  try{
    const response=await gh(`/repos/${cfg.repo}/contents/${PRICE_FILE}`,{headers:{Accept:"application/vnd.github.raw+json",...(!force&&priceData?.etag&&priceData.format===PRICE_FORMAT?{"If-None-Match":priceData.etag}:{})}});
    if(!same())return false;
    if(response.status===304){priceStatus();return false;}
    if(response.status===404){const had=!!priceData;priceData=null;localStorage.removeItem(PRICE_KEY);if(typeof assetStore!=="undefined")assetStore.acceptPrices(cfg,null);priceStatus("데이터 저장소에 시세 파일(etf-planner-prices.json)이 없어 현재가·기준가를 채우지 않습니다.");return had;}
    if(!response.ok)throw Error(`시세 읽기 실패 (${response.status})`);
    const text=await response.text();
    let doc;try{doc=JSON.parse(text);}catch{throw Error("시세 파일을 읽을 수 없습니다.");}
    if(!same())return false;
    return acceptPlannerPrices(cfg,doc,response.headers?.get?.("ETag")||"");
  }catch(error){if(same())priceStatus(`시세 확인 실패 · ${error.message}`);return false;}
}
function acceptPlannerPrices(cfg,doc,etag){
  const next={...slimPrices(doc),etag},plain=d=>JSON.stringify({...d,etag:""}),changed=!priceData||plain(priceData)!==plain(next);
  priceData=next;localStorage.setItem(PRICE_KEY,JSON.stringify(next));if(typeof assetStore!=="undefined")assetStore.acceptPrices(cfg,doc,etag);priceStatus();return changed;
}
// 저장 대기 중인 종목을 먼저 동기화한 뒤 실제 수집을 요청한다. 수집 결과가 확인되기 전에는 마지막 시세를 유지한다.
async function refreshPrices(){
  if(sync.busy||priceRefreshBusy)return;
  if(!connected()){priceStatus("먼저 동기화 설정에서 데이터 저장소와 토큰을 연결해 주세요.");$("syncDialog").showModal();return;}
  const repo=sync.repo,token=sync.token;
  priceRefreshBusy=true;priceRefreshControls();$("priceRefreshStatus").className="";$("priceRefreshStatus").textContent="시세 수집 준비 중…";
  try{
    if(dataSnapshot()!==sync.base&&!sync.blocked)await syncNow(true);
    if(sync.blocked||sync.failed)throw Error("먼저 기록 동기화를 완료한 뒤 시세를 수집해 주세요.");
    if(typeof assetStore!=="undefined"&&assetStore.status?.state==="pending"){
      await assetStore.sync();if(assetStore.status.state==="error")throw Error("먼저 분할매수·자산 기록 동기화를 완료한 뒤 시세를 수집해 주세요.");
    }
    const result=await collectPricesNow({repo,token},message=>{$("priceRefreshStatus").textContent=message;},()=>sync.repo===repo&&sync.token===token);
    if(sync.repo!==repo||sync.token!==token){priceStatus("연결 설정이 바뀌었습니다. 다시 시세를 불러와 주세요.");return;}
    if(acceptPlannerPrices({repo,token},result.doc,result.etag))sync.redraw=true;
    if(fillPrices(state,priceData)){save();sync.redraw=true;}
    if(!priceReadMessage){
      const missing=typeof assetStore!=="undefined"?assetStore.missingPriceMessage:"";
      if(missing||result.message)priceStatus(missing||result.message);
      else $("priceRefreshStatus").textContent=`시세 불러오기 완료${priceData?.updatedAt?` · 최근 수집 ${new Date(priceData.updatedAt).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}`:""}`;
    }
  }catch(error){priceStatus(`시세 확인 실패 · ${error.message}`);}
  finally{priceRefreshBusy=false;syncBadge();if(sync.redraw)redrawIdle();if(sync.again&&!sync.blocked)scheduleSync(300);}
}
// 시세 줄: 종목 수(비트코인 제외)·달러선물 월물 수·현물 환율·비트코인(BTC-USD, 달러) 현재가
function priceStatus(message){const d=priceData,at=Date.parse(d?.updatedAt),fx=fxEntry(d),btc=btcEntry(d),stocks=Object.values(d?.stocks||{}).filter(e=>e?.kind!=="코인").length;
  const late=!message&&connected()&&priceCollectionLate(d?.updatedAt); // 정기 수집이 늦어짐(예약 실행 누락·지연) — price-collection.js
  priceReadMessage=message||"";$("priceRefreshStatus").className=message?"warning":late?"late":"";$("priceRefreshStatus").textContent=message||(at?`최근 수집 ${new Date(at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}${late?" · 수집 지연":""}`:connected()?"시세를 바로 수집한 뒤 불러옵니다.":"동기화를 연결하면 시세를 불러올 수 있습니다.");
  $("priceStatus").textContent=message||(d?`시세 파일${at?` ${new Date(at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})} 갱신`:""} · 종목 ${stocks}개 · 달러선물 ${Object.keys(d.futures).length}개 월물 · ${fx?`현물 환율 ${priceRound(fx.close,2)}원 (${fx.asOf}${fx.stale?" · 조회 실패":""}${priceOld(fx)?" · 지난 시세":""})`:"현물 환율 없음(기존 값 유지)"}${btc?` · 비트코인 $${priceRound(btc.close,2).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} (${btc.asOf} UTC${btc.stale?" · 조회 실패":""}${priceOld(btc)?" · 지난 시세":""})`:""}. 현재가·이동평균선 기준가·달러 계획 환율을 자동으로 채웁니다.${late?" 정기 수집이 예정보다 늦어지고 있습니다(GitHub 예약 실행 지연·누락). 그동안 시세와 알림도 늦을 수 있으며, 시세 즉시 불러오기로 바로 받을 수 있습니다.":""}`:"");}
// 입력 중인 칸(글자·숫자·선택, 동기화 창의 연결 칸은 제외). 다른 기기 기록을 적용하면 화면을 다시 그리며 저장하지 않은 입력이 지워지고
// 그 칸의 저장 버튼도 바뀌기 전 기록에 묶이므로, 적용(자동 병합·충돌 창 포함)은 칸에서 나올 때까지 미루고 focusout에서 다시 동기화한다.
function typingIn(el){return !!el&&(el.tagName==="TEXTAREA"||el.tagName==="SELECT"||el.tagName==="INPUT"&&!["checkbox","radio","button","submit","file"].includes(el.type))&&!el.closest?.("#syncDialog");}
function holdForTyping(){if(!typingIn(document.activeElement))return false;sync.waitTyping=true;syncStatus("입력 중 · 끝나면 동기화");return true;}
// 시세가 바뀌어 다시 그릴 때 입력 중인 칸이 있으면 다음 동기화까지 미룬다(쓰던 메모·숫자가 지워지지 않게).
function redrawIdle(){const el=document.activeElement;if(el&&/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))return;sync.redraw=false;render();}
function markSynced(snapshot,sha){
  sync.base=snapshot;if(sha!==undefined)sync.sha=sha;
  if(!sync.localFailed)try{localStorage.setItem(SYNC_BASE_KEY+sync.repo,snapshot);}catch(error){console.error(error);setLocalSaveFailed(true);}
  try{localStorage.setItem(LAST_REPO_KEY,sync.repo);}catch(error){console.error(error);setLocalSaveFailed(true);}
  syncStatus(`동기화 완료 · ${new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}`);
}
// 병합: 원격에 rebuy·alerts가 없으면 이 기기 값 유지. 빈 목록도 지우려면 {items:[]}·{rules:[]}로 저장.
// 기기 기록에 쓰기 직전 다른 페이지가 저장한 칸은 그 페이지 값을 둔다(storePlanner).
function applyRemote(snapshot){
  const incoming=externalData.planner(JSON.parse(snapshot)),next={...state,...incoming};normalize(next);
  try{storePlanner(next,false);setLocalSaveFailed(false);}catch(error){setLocalSaveFailed(true);throw error;}
  render();
}
// 충돌 창: 겹친 곳(overlap = mergeThreeWay 경로, 없으면 지난 동기화 기준이 없는 기기)과 양쪽 계획·월물 수. 저장소 기록을 기본(첫 버튼)으로 둔다.
const CONFLICT_AREAS={plans:"분할매도",futures:"달러선물",rebuy:"재매수",alerts:"알림 설정",actions:"이전 기록",alertHistory:"알림내역"};
function chooseConflict(local,remote,overlap=[]){return new Promise(resolve=>{
  const dialog=$("conflictDialog"),summary=json=>recordSummary(JSON.parse(json)),areas=[...new Set(overlap.map(path=>CONFLICT_AREAS[path[0]]||"기타"))].join("·");
  $("conflictMessage").textContent=`${areas?`두 기기에서 같은 곳(${areas})을 다르게 고쳤습니다.`:"이 기기와 저장소의 기록이 다릅니다(지난 동기화 기준이 없는 기기)."} 이 기기: ${summary(local)} / 저장소: ${summary(remote)}.`;
  let done=false;const finish=value=>{if(done)return;done=true;dialog.close();resolve(value);};
  $("keepLocal").onclick=()=>finish("local");$("keepRemote").onclick=()=>finish("remote");$("conflictLater").onclick=()=>finish("later");
  dialog.onclose=()=>finish("later");dialog.showModal();
});}
async function syncNow(beforePriceCollection=false){
  if(!connected())return;
  if(sync.busy||(priceRefreshBusy&&beforePriceCollection!==true)){sync.again=true;return;}
  const repo=sync.repo,token=sync.token,same=()=>sync.repo===repo&&sync.token===token;
  sync.busy=true;sync.again=false;sync.failed=false;sync.waitTyping=false;clearTimeout(sync.timer);syncStatus("동기화 확인 중…");
  try{
    absorbPlanner(); // 다른 페이지가 저장·동기화한 기록(알림을 놓쳤어도)부터 받는다
    if(!sync.checked){await checkRepo();if(!same())return;}
    const {sha,snapshot:raw}=await readRemote();if(!same())return;
    if(await readPrices())sync.redraw=true;
    if(!same())return;
    if(typeof readPushConfig==="function")await readPushConfig();
    if(!same())return;
    if(typeof readAlertHistory==="function")await readAlertHistory();
    if(!same())return;
    if(fillPrices(state,priceData)){
      try{storePlanner(state);setLocalSaveFailed(false);}catch(error){console.error(error);setLocalSaveFailed(true);}
      sync.redraw=true;
    }
    sync.sha=sha;
    // 로컬·원격·base를 같은 시세로 채운 뒤 비교(시세 갱신만으로 충돌 창이 뜨지 않음). settle은 채운 원격 값도 저장.
    let remote=pricedSnapshot(raw,priceData),local=dataSnapshot(),base=pricedSnapshot(sync.base,priceData),merged=null;
    if(typeof alignAlertHistorySnapshots==="function")({local,remote,base}=alignAlertHistorySnapshots(local,remote,base));
    const settle=async json=>{if(json===raw)markSynced(json,sha);else{await writeRemote(json,sha);if(!same())return;markSynced(json);}sync.blocked=false;};
    if(remote===local)await settle(local);
    else if(remote===null){
      const last=localStorage.getItem(LAST_REPO_KEY);
      if(last&&last!==repo&&!confirm(`이전에 쓰던 저장소(${last})와 다릅니다. 이 기기 기록을 ${repo}에 새로 저장할까요?`)){
        sync.blocked=true;syncStatus("다른 저장소 확인 전 · 이 기기에만 저장 중");return;
      }
      await writeRemote(local,"");if(!same())return;markSynced(local);sync.blocked=false;
    }
    else if(local===base||(!base&&(isBlank(local)||(!hadStoredState&&local===initialSnapshot)))){if(holdForTyping())return;applyRemote(remote);await settle(remote);}
    else if(remote===base)await settle(local);
    else if(base&&!(merged=mergeThreeWay(JSON.parse(local),JSON.parse(remote),JSON.parse(base))).conflicts.length){
      // 양쪽이 지난 동기화 뒤 서로 다른 칸만 바꿨으면 묻지 않고 합친다(계획·알림·재매수 종목은 항목별, 달러선물 보유·손절처럼 함께 바뀌는 칸은 겹치면 묻는다).
      const json=snapshotOf(merged.value);if(holdForTyping())return;applyRemote(json);await settle(json);
    }
    else{
      if(holdForTyping())return;
      sync.blocked=true;syncStatus("기록 차이 확인 필요 · 자동 저장 대기");
      const choice=await chooseConflict(local,remote,merged?.conflicts);
      if(!same())return;
      if(choice==="remote"){backupRecord(dataSnapshot(),"저장소 기록을 선택하기 전 이 기기 기록");applyRemote(remote);await settle(remote);}
      else if(choice==="local"){
        const latest=await readRemote();if(latest.snapshot!==raw)throw Error("선택하는 동안 저장소 기록이 바뀌었습니다. 다시 동기화해 주세요.");
        if(!same())return;
        backupRecord(raw,"이 기기 기록을 선택하기 전 저장소 기록");
        const current=dataSnapshot();await writeRemote(current,latest.sha);if(!same())return;markSynced(current);sync.blocked=false;
      }
      else syncStatus("기록 차이 확인 전 · 이 기기에만 저장 중");
    }
  }catch(error){if(error.stale){sync.again=true;syncStatus("다른 기기 저장 확인 중…");}else{sync.failed=true;syncStatus(`${sync.localFailed?"이 기기 저장 실패":"이 기기 저장됨"} · ${error.message}`);}}
  finally{sync.busy=false;syncBadge();if(sync.redraw)redrawIdle();if(typeof renderPushSetup==="function")renderPushSetup();if(sync.failed||sync.waitTyping)return;if(sync.again&&!sync.blocked)scheduleSync(300);else if(connected()&&!sync.blocked&&dataSnapshot()!==sync.base)scheduleSync();}
}
function loadConfig(){sync.repo=localStorage.getItem(REPO_KEY)||"";sync.token=localStorage.getItem(TOKEN_KEY)||"";sync.base=sync.repo?localStorage.getItem(SYNC_BASE_KEY+sync.repo)||"":"";sync.sha="";sync.checked=false;sync.blocked=false;}
function refreshTokenField(){$("githubToken").placeholder=localStorage.getItem(TOKEN_KEY)?"저장됨 · 바꿀 때만 붙여넣기":"github_pat_로 시작하는 값";}
function refreshCollectionTokenField(){$("collectionToken").placeholder=localStorage.getItem(repoSecurity.tokenKey)?"저장됨 · 바꿀 때만 붙여넣기":"github_pat_로 시작하는 Issues 전용 토큰";}
$("syncBtn").onclick=()=>$("syncDialog").showModal();
$("closeSync").onclick=()=>$("syncDialog").close();
$("dataRepo").value=localStorage.getItem(REPO_KEY)||DEFAULT_DATA_REPO;
renderRecovery();
$("connectRepo").onclick=()=>{
  if(sync.busy){syncStatus("현재 동기화가 끝나면 다시 눌러 주세요.");return;}
  const repo=$("dataRepo").value.trim(),token=$("githubToken").value.trim()||localStorage.getItem(TOKEN_KEY)||"";
  if(!repoOk(repo)){syncStatus("데이터 저장소를 '아이디/저장소이름' 형식으로 입력해 주세요.");return;}
  try{repoSecurity.assertDataRepo(repo);}catch(error){syncStatus(error.message);return;}
  if(!token){syncStatus("GitHub 토큰을 붙여넣어 주세요.");return;}
  const collectionToken=$("collectionToken").value.trim()||(localStorage.getItem(repoSecurity.repoKey)===repo?localStorage.getItem(repoSecurity.tokenKey)||"":"");
  try{repoSecurity.assertTokens(token,collectionToken);}catch(error){syncStatus(error.message);return;}
  if(collectionToken){localStorage.setItem(repoSecurity.tokenKey,collectionToken);localStorage.setItem(repoSecurity.repoKey,repo);}
  $("collectionToken").value="";refreshCollectionTokenField();
  localStorage.setItem(REPO_KEY,repo);localStorage.setItem(TOKEN_KEY,token);$("githubToken").value="";
  clearTimeout(sync.timer);loadConfig();refreshTokenField();syncNow();
};
$("syncNow").onclick=()=>{sync.blocked=false;if(connected())syncNow();else syncStatus("먼저 저장소와 토큰으로 연결해 주세요.");};
$("refreshPricesBtn").onclick=refreshPrices;$("refreshPricesDialogBtn").onclick=refreshPrices;
$("disconnectRepo").onclick=()=>{clearTimeout(sync.timer);localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(repoSecurity.tokenKey);localStorage.removeItem(repoSecurity.repoKey);loadConfig();refreshTokenField();refreshCollectionTokenField();syncStatus("이 기기에만 저장 중");};
// 열 때(startSync)·45초마다·탭 복귀 시 동기화. 숨긴 화면과 미해결 충돌은 자동 동기화를 멈춘다.
setInterval(()=>{if(connected()&&!sync.blocked&&!document.hidden)syncNow();},45000);
document.addEventListener("visibilitychange",()=>{if(document.hidden)return;if(absorbPlanner())redrawIdle();if(connected()&&!sync.blocked)syncNow();});
// 같은 브라우저의 다른 페이지가 저장하면 바로 받고, 그 알림을 받지 못했을 수 있는 뒤로 가기 복원 때도 받는다(그 밖의 놓친 저장은 화면 복귀·동기화 직전에 받음).
addEventListener("storage",e=>{if(e.key===STORAGE_KEY&&absorbPlanner())redrawIdle();});
addEventListener("pageshow",e=>{if(e.persisted&&absorbPlanner())redrawIdle();});
document.addEventListener("focusout",e=>{if(sync.waitTyping&&!typingIn(e.relatedTarget)){sync.waitTyping=false;scheduleSync(300);}}); // 입력 칸에서 나오면 미룬 동기화를 이어 간다
loadConfig();refreshTokenField();refreshCollectionTokenField();
$("exportBtn").onclick=()=>downloadJson({...state,exportedAt:new Date().toISOString()},`etf-planner-backup-${new Date().toISOString().slice(0,10)}.json`);
// JSON 복원: 검사 → 백업 시각·계획 수를 보여 주고 확인 → 지금 기록을 복구본에 남긴 뒤 바꾼다(남기지 못하면 바꾸지 않음). 백업·복구본의 시각·사유는 기록에 넣지 않는다.
$("importInput").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{
  const {exportedAt,recoveryReason,...incoming}=externalData.planner(JSON.parse(await file.text())),at=recordTime(exportedAt);
  if(confirm(`이 백업으로 플래너 기록을 바꿀까요?\n백업 파일: ${at?`${at} 백업`:"백업 시각 없음"} · ${recordSummary(incoming)}\n지금 기록: ${recordSummary(state)}\n지금 기록은 이 기기에 보관합니다(동기화 창에서 내려받기).`)){
    backupRecord(dataSnapshot(),"JSON 복원 전 이 기기 기록");const next={...state,...incoming};normalize(next);
    try{storePlanner(next);setLocalSaveFailed(false);}catch(error){setLocalSaveFailed(true);throw error;}
    if(connected()&&dataSnapshot()!==sync.base)scheduleSync();if(typeof stockNames==="object")stockNames.remember();
    render();alert("백업을 복원했습니다.");
  }}catch(err){alert(`복원 실패: ${err.message}`);}e.target.value="";};
renderLocalSaveWarning();
function startSync(){ priceStatus();return connected()?syncNow():Promise.resolve(); } // js/start.js에서 부름(모든 파일을 불러온 뒤 시세 표시·동기화 시작)
