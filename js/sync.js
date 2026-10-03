// 저장(save)·GitHub 비공개 데이터 저장소 동기화·JSON 백업/복원. 시작은 index.html 맨 끝의 startSync()
const initialSnapshot = dataSnapshot();
const DATA_FILE = "etf-planner-data.json";
const DEFAULT_DATA_REPO = "oax2310-blip/etf-planner-data"; // 기록 전용 비공개 저장소. 사이트 저장소와 분리해 저장해도 사이트가 다시 게시되지 않는다
const REPO_KEY = "etf-planner-data-repo";
const TOKEN_KEY = "etf-planner-github-token"; // 이 기기 브라우저에만 보관하는 GitHub 토큰(데이터 저장소 Contents 읽기·쓰기 전용). 코드·저장소에 넣지 말 것
const SYNC_BASE_KEY = "etf-planner-sync-base:";
const LAST_REPO_KEY = "etf-planner-last-data-repo";
const RECOVERY_KEY = "etf-planner-sync-recovery";
const PRICE_FILE = "etf-planner-prices.json"; // 데이터 저장소 Actions(KIS 시세 수집)가 올리는 시세 파일. 읽기만 한다(채우는 규칙은 prices.js)
const PRICE_KEY = "etf-planner-prices"; // 마지막으로 읽은 시세(채우기·표시에 쓰는 값과 ETag만). 이 기기에만 두고 동기화 기록에는 넣지 않는다
let priceData = null; try { priceData = JSON.parse(localStorage.getItem(PRICE_KEY) || "null"); if (!priceData?.stocks || !priceData.futures) priceData = null; } catch {}
const sync = {token:"",repo:"",sha:"",base:"",busy:false,again:false,blocked:false,failed:false,checked:false,timer:null,redraw:false};
function dataSnapshot(){return JSON.stringify({plans:state.plans,futures:state.futures,actions:state.actions,rebuy:state.rebuy});}
const repoOk = r => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(r);
const connected = () => !!(sync.token && sync.repo);
// 아무것도 입력하지 않은 기기인지(처음 연결할 때 저장소 기록을 묻지 않고 가져와도 되는지)
const isBlank = json => {const d=JSON.parse(json),f=d.futures||{},a=d.actions||{},al=a.allocation||{};return !(d.plans||[]).length&&!(f.positions||[]).length&&!(f.rolls||[]).length&&!Number(f.baselinePnl)&&!Number(f.targetProfit)&&!f.note&&!(f.levels||[]).some(l=>Number(l.contracts)>0||Number(l.price)>0)&&!(a.buys||[]).some(b=>b.completed||b.actualKrw)&&!(a.adobeSales||[]).some(s=>s.completed||s.plannedShares||s.soldShares||s.priceUsd)&&!a.buyNote&&!a.adobeNote&&!al.completed&&!al.note&&!al.targetNasdaqPct&&!al.targetCoveredCallPct&&!d.rebuy;};
function syncStatus(message){$("syncStatus").textContent=message;$("syncDialogStatus").textContent=message;const btn=$("syncBtn");btn.title=message;syncBadge();}
// 동기화 버튼 아이콘 상태: off(연결 안 됨, 회전 아이콘 대신 빨간 ! 표시) · busy(도는 중) · ok(초록 점) · warn(주황 점, 확인 필요)
function syncBadge(){$("syncBtn").className="btn mini sync-btn "+(!connected()?"off":sync.failed||sync.blocked?"warn":sync.busy?"busy":"ok");}
function scheduleSync(delay=1500){if(!connected()||sync.blocked)return;clearTimeout(sync.timer);sync.timer=setTimeout(()=>syncNow(),delay);}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));if(connected() && dataSnapshot()!==sync.base) scheduleSync();}
function backupRecord(json,reason){localStorage.setItem(RECOVERY_KEY,JSON.stringify({...JSON.parse(json),recoveryReason:reason,exportedAt:new Date().toISOString()}));$("downloadSyncBackup").hidden=false;}
function downloadJson(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
const toB64 = text => {const bytes=new TextEncoder().encode(text);let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(bin);};
const fromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g,"")),c=>c.charCodeAt(0)));
async function gh(path,options={}){
  const response=await fetch(`https://api.github.com${path}`,{cache:"no-store",...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${sync.token}`,...options.headers}});
  if(response.status===401)throw Error("GitHub 토큰이 맞지 않거나 만료됐습니다. 동기화 설정에서 새 토큰을 넣어 주세요.");
  if(response.status===403)throw Error("토큰 권한이 부족하거나 요청이 너무 많습니다. 토큰의 Contents 읽기·쓰기 권한을 확인해 주세요.");
  return response;
}
async function checkRepo(){
  const response=await gh(`/repos/${sync.repo}`);
  if(response.status===404)throw Error(`저장소 ${sync.repo}를 찾을 수 없습니다. 이름과 토큰에 고른 저장소를 확인해 주세요.`);
  if(!response.ok)throw Error(`저장소 확인 실패 (${response.status})`);
  const info=await response.json();
  if(!info.private)throw Error(`${sync.repo}는 공개 저장소라 기록을 올리지 않았습니다. 비공개 저장소를 지정해 주세요.`);
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
  if(!Array.isArray(data.plans)||!data.futures||!data.actions)throw Error("저장소의 기록 파일 형식을 확인할 수 없습니다. 자동으로 덮어쓰지 않았습니다.");
  return {sha:meta.sha,snapshot:JSON.stringify({plans:data.plans,futures:data.futures,actions:data.actions,rebuy:data.rebuy})};
}
async function writeRemote(snapshot,sha){
  const body={message:`기록 동기화 ${new Date().toISOString()}`,content:toB64(JSON.stringify(JSON.parse(snapshot),null,2)+"\n"),...(sha?{sha}:{})};
  const response=await gh(`/repos/${sync.repo}/contents/${DATA_FILE}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(response.status===409||response.status===422){const error=Error("다른 기기가 먼저 저장했습니다. 다시 확인합니다.");error.stale=true;throw error;}
  if(!response.ok)throw Error(`기록 저장 실패 (${response.status})`);
  const result=await response.json();sync.sha=result.content?.sha||"";
  return result;
}
// 시세 파일 읽기: ETag로 바뀌었을 때만 받는다(안 바뀌면 304, 이 기기에 둔 시세가 옛 형식(PRICE_FORMAT)이면 다시 받음). 실패해도 동기화는 계속하고 지난 시세를 쓴다. 시세가 바뀌었으면 true.
async function readPrices(){
  try{
    const response=await gh(`/repos/${sync.repo}/contents/${PRICE_FILE}`,{headers:{Accept:"application/vnd.github.raw+json",...(priceData?.etag&&priceData.format===PRICE_FORMAT?{"If-None-Match":priceData.etag}:{})}});
    if(response.status===304){priceStatus();return false;}
    if(response.status===404){const had=!!priceData;priceData=null;localStorage.removeItem(PRICE_KEY);priceStatus("데이터 저장소에 시세 파일(etf-planner-prices.json)이 없어 현재가·기준가를 채우지 않습니다.");return had;}
    if(!response.ok)throw Error(`시세 읽기 실패 (${response.status})`);
    let doc;try{doc=JSON.parse(await response.text());}catch{throw Error("시세 파일을 읽을 수 없습니다.");}
    const next={...slimPrices(doc),etag:response.headers?.get?.("ETag")||""},plain=d=>JSON.stringify({...d,etag:""}),changed=!priceData||plain(priceData)!==plain(next);
    priceData=next;localStorage.setItem(PRICE_KEY,JSON.stringify(next));priceStatus();return changed;
  }catch(error){priceStatus(`시세 확인 실패 · ${error.message}`);return false;}
}
function priceStatus(message){const d=priceData,at=Date.parse(d?.updatedAt),fx=fxEntry(d);$("priceStatus").textContent=message||(d?`시세 파일${at?` ${new Date(at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})} 갱신`:""} · 종목 ${Object.keys(d.stocks).length}개 · 달러선물 ${Object.keys(d.futures).length}개 월물 · ${fx?`현물 환율 ${priceRound(fx.close,2)}원 (${fx.asOf}${fx.stale?" · 조회 실패":""}${priceOld(fx)?" · 지난 시세":""})`:"현물 환율 없음(기존 값 유지)"}. 현재가·이동평균선 기준가·달러 계획 환율을 자동으로 채웁니다.`:"");}
// 시세가 바뀌어 다시 그릴 때 입력 중인 칸이 있으면 다음 동기화까지 미룬다(쓰던 메모·숫자가 지워지지 않게).
function redrawIdle(){const el=document.activeElement;if(el&&/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))return;sync.redraw=false;render();}
function markSynced(snapshot,sha){sync.base=snapshot;if(sha!==undefined)sync.sha=sha;localStorage.setItem(SYNC_BASE_KEY+sync.repo,snapshot);localStorage.setItem(LAST_REPO_KEY,sync.repo);syncStatus(`동기화 완료 · ${new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}`);}
function applyRemote(snapshot){state={...state,...JSON.parse(snapshot)};normalize();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();}
function chooseConflict(local,remote){return new Promise(resolve=>{
  const dialog=$("conflictDialog"),summary=json=>{const d=JSON.parse(json);return `${d.plans.length}개 계획 · 달러선물 ${d.futures.positions?.length||0}개 월물`;};
  $("conflictMessage").textContent=`이 기기: ${summary(local)} / 저장소: ${summary(remote)}. 먼저 JSON 백업을 내려받아 두면 더 안전합니다.`;
  let done=false;const finish=value=>{if(done)return;done=true;dialog.close();resolve(value);};
  $("keepLocal").onclick=()=>finish("local");$("keepRemote").onclick=()=>finish("remote");$("conflictLater").onclick=()=>finish("later");
  dialog.onclose=()=>finish("later");dialog.showModal();
});}
async function syncNow(){
  if(!connected())return;
  if(sync.busy){sync.again=true;return;}
  const repo=sync.repo,token=sync.token,same=()=>sync.repo===repo&&sync.token===token;
  sync.busy=true;sync.again=false;sync.failed=false;clearTimeout(sync.timer);syncStatus("동기화 확인 중…");
  try{
    if(!sync.checked){await checkRepo();if(!same())return;}
    const {sha,snapshot:raw}=await readRemote();if(!same())return;
    if(await readPrices())sync.redraw=true;
    if(!same())return;
    if(fillPrices(state,priceData)){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));sync.redraw=true;}
    sync.sha=sha;
    // 시세로 채우는 칸은 어느 기기든 같은 시세 파일로 똑같이 채우므로, 저장소 기록(raw)·지난 동기화 기록도 같은 시세로 채운 뒤 비교한다
    // (시세 갱신만으로 기록 차이 창이 뜨지 않게). 저장소 파일에 아직 안 채운 시세가 있으면 채운 기록을 올린다(settle).
    const remote=pricedSnapshot(raw,priceData),local=dataSnapshot(),base=pricedSnapshot(sync.base,priceData);
    const settle=async json=>{if(json===raw)markSynced(json,sha);else{await writeRemote(json,sha);if(!same())return;markSynced(json);}sync.blocked=false;};
    if(remote===local)await settle(local);
    else if(remote===null){
      const last=localStorage.getItem(LAST_REPO_KEY);
      if(last&&last!==repo&&!confirm(`이전에 쓰던 저장소(${last})와 다릅니다. 이 기기 기록을 ${repo}에 새로 저장할까요?`)){
        sync.blocked=true;syncStatus("다른 저장소 확인 전 · 이 기기에만 저장 중");return;
      }
      await writeRemote(local,"");if(!same())return;markSynced(local);sync.blocked=false;
    }
    else if(local===base||(!base&&(isBlank(local)||(!hadStoredState&&local===initialSnapshot)))){applyRemote(remote);await settle(remote);}
    else if(remote===base)await settle(local);
    else{
      sync.blocked=true;syncStatus("기록 차이 확인 필요 · 자동 저장 대기");
      const choice=await chooseConflict(local,remote);
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
  }catch(error){if(error.stale){sync.again=true;syncStatus("다른 기기 저장 확인 중…");}else{sync.failed=true;syncStatus(`이 기기 저장됨 · ${error.message}`);}}
  finally{sync.busy=false;syncBadge();if(sync.redraw)redrawIdle();if(sync.failed)return;if(sync.again&&!sync.blocked)scheduleSync(300);else if(connected()&&!sync.blocked&&dataSnapshot()!==sync.base)scheduleSync();}
}
function loadConfig(){sync.repo=localStorage.getItem(REPO_KEY)||"";sync.token=localStorage.getItem(TOKEN_KEY)||"";sync.base=sync.repo?localStorage.getItem(SYNC_BASE_KEY+sync.repo)||"":"";sync.sha="";sync.checked=false;sync.blocked=false;}
function refreshTokenField(){$("githubToken").placeholder=localStorage.getItem(TOKEN_KEY)?"저장됨 · 바꿀 때만 붙여넣기":"github_pat_로 시작하는 값";}
$("syncBtn").onclick=()=>$("syncDialog").showModal();
$("closeSync").onclick=()=>$("syncDialog").close();
$("dataRepo").value=localStorage.getItem(REPO_KEY)||DEFAULT_DATA_REPO;
$("downloadSyncBackup").hidden=!localStorage.getItem(RECOVERY_KEY);
$("downloadSyncBackup").onclick=()=>{const raw=localStorage.getItem(RECOVERY_KEY);if(raw)downloadJson(JSON.parse(raw),`etf-planner-recovery-${new Date().toISOString().slice(0,10)}.json`);};
$("connectRepo").onclick=()=>{
  if(sync.busy){syncStatus("현재 동기화가 끝나면 다시 눌러 주세요.");return;}
  const repo=$("dataRepo").value.trim(),token=$("githubToken").value.trim()||localStorage.getItem(TOKEN_KEY)||"";
  if(!repoOk(repo)){syncStatus("데이터 저장소를 '아이디/저장소이름' 형식으로 입력해 주세요.");return;}
  if(!token){syncStatus("GitHub 토큰을 붙여넣어 주세요.");return;}
  localStorage.setItem(REPO_KEY,repo);localStorage.setItem(TOKEN_KEY,token);$("githubToken").value="";
  clearTimeout(sync.timer);loadConfig();refreshTokenField();syncNow();
};
$("syncNow").onclick=()=>{sync.blocked=false;if(connected())syncNow();else syncStatus("먼저 저장소와 토큰으로 연결해 주세요.");};
$("disconnectRepo").onclick=()=>{clearTimeout(sync.timer);localStorage.removeItem(TOKEN_KEY);loadConfig();refreshTokenField();syncStatus("이 기기에만 저장 중");};
setInterval(()=>{if(connected()&&!sync.blocked&&!document.hidden)syncNow();},45000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&connected()&&!sync.blocked)syncNow();});
loadConfig();refreshTokenField();
$("exportBtn").onclick=()=>downloadJson({...state,exportedAt:new Date().toISOString()},`etf-planner-backup-${new Date().toISOString().slice(0,10)}.json`);
$("importInput").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{const incoming=JSON.parse(await file.text());if(!Array.isArray(incoming.plans)||!incoming.futures)throw Error("플래너 백업 형식이 아닙니다.");state={...state,...incoming};normalize();save();render();alert("백업을 복원했습니다.");}catch(err){alert(`복원 실패: ${err.message}`);}e.target.value="";};
function startSync(){ priceStatus();return connected()?syncNow():Promise.resolve(); } // index.html 맨 끝에서 부름(모든 파일을 불러온 뒤 시세 표시·동기화 시작)
