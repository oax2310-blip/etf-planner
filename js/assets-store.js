// 자산 현황·플래너 분할매수의 공유 기록·시세·동기화. 구역 병합은 assets-calc.js mergeAssets, 공통 작업 규칙은 AGENTS.md.
const assetStore = (()=>{
const A_KEY="etf-planner-assets-v1", A_BASE_KEY="etf-planner-assets-sync-base:", A_RECOVERY_KEY="etf-planner-assets-recovery";
const A_PRICE_KEY="etf-planner-assets-prices", A_FILE="etf-planner-assets.json", A_PRICE_FILE="etf-planner-prices.json";
const A_REPO_KEY="etf-planner-data-repo", A_TOKEN_KEY="etf-planner-github-token";
const readJson=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||"null")??d;}catch{return d;}};
const writeJson=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}};
let doc=cleanAssets(readJson(A_KEY,null))||{version:1}, prices=readJson(A_PRICE_KEY,null), priceMessage="", priceRefreshBusy=false, started=false;
let lastLocal=JSON.parse(JSON.stringify(doc)); // 같은 브라우저의 다른 페이지가 바꾼 기록도 공통 기준으로 병합
const listeners=new Set(), emit=type=>listeners.forEach(fn=>fn(type));
function writeLocal(){writeJson(A_KEY,doc);lastLocal=JSON.parse(JSON.stringify(doc));}
function saveSection(section){
  // 두 페이지에서 다른 구역을 고쳤으면 localStorage의 최신 구역도 함께 보존한다.
  const latest=cleanAssets(readJson(A_KEY,null));
  for(const s of ASSET_SECTIONS)if(s!==section&&latest?.[s]&&(!doc[s]||String(latest[s].savedAt||"")>String(doc[s].savedAt||"")))doc[s]=latest[s];
  if(doc[section])doc[section].savedAt=new Date().toISOString();writeLocal();scheduleAssetSync(1500);emit("change");
}
const aSync = {busy:false, again:false, timer:null, checked:"", state:"off", message:"", at:"", remote:null};
function assetConfig(){ try { const repo=(localStorage.getItem(A_REPO_KEY)||"").trim(), token=localStorage.getItem(A_TOKEN_KEY)||""; return token&&/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)?{repo,token}:null; } catch { return null; } }
const sameConfig=cfg=>{const current=assetConfig();return !!current&&current.repo===cfg.repo&&current.token===cfg.token;};
const toB64A = text => { const bytes=new TextEncoder().encode(text); let bin=""; for(let i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(bin); };
const fromB64A = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g,"")),c=>c.charCodeAt(0)));
async function aGh(cfg, path, options={}){
  const r=await fetch(`https://api.github.com${path}`,{cache:"no-store",...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${cfg.token}`,...options.headers}});
  if(r.status===401) throw Error("GitHub 토큰이 맞지 않거나 만료됐습니다. 메인 플래너의 동기화 설정에서 새 토큰을 넣어 주세요.");
  if(r.status===403) throw Error("토큰 권한이 부족하거나 요청이 너무 많습니다. 토큰의 Contents 읽기·쓰기 권한을 확인해 주세요.");
  return r;
}
async function readAssetRemote(cfg){
  const path=`/repos/${cfg.repo}/contents/${A_FILE}`, last=aSync.remote?.repo===cfg.repo?aSync.remote:null;
  const r=await aGh(cfg,path,{headers:last?.etag?{"If-None-Match":last.etag}:{}}); // 바뀌지 않았으면 304(요청 한도에 세지 않음)
  if(r.status===304&&last) return last;
  if(r.status===404) return (aSync.remote={repo:cfg.repo,sha:"",doc:null,etag:""});
  if(!r.ok) throw Error(`기록 읽기 실패 (${r.status})`);
  const meta=await r.json(); let text=meta.encoding==="base64"&&meta.content?fromB64A(meta.content):null;
  if(text===null){ const raw=await aGh(cfg,path,{headers:{Accept:"application/vnd.github.raw+json"}}); if(!raw.ok) throw Error(`기록 읽기 실패 (${raw.status})`); text=await raw.text(); }
  let data=null; try { data=cleanAssets(JSON.parse(text)); } catch { data=null; }
  if(!data) throw Error(`저장소의 ${A_FILE} 형식을 확인할 수 없어 자동으로 덮어쓰지 않았습니다.`);
  return (aSync.remote={repo:cfg.repo,sha:meta.sha,doc:data,etag:r.headers.get("ETag")||""});
}
async function writeAssetRemote(cfg, data, sha){
  const body={message:`자산 현황 동기화 ${new Date().toISOString()}`,content:toB64A(JSON.stringify(data,null,2)+"\n"),...(sha?{sha}:{})};
  const r=await aGh(cfg,`/repos/${cfg.repo}/contents/${A_FILE}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(r.status===409||r.status===422){ const e=Error("다른 기기가 먼저 저장했습니다."); e.stale=true; throw e; }
  if(!r.ok) throw Error(`기록 저장 실패 (${r.status})`);
  const res=await r.json(); aSync.remote={repo:cfg.repo,sha:res.content?.sha||"",doc:JSON.parse(JSON.stringify(data)),etag:""};
}
// 시세 파일은 ETag로 읽고 종가·환율만 이 기기에 둔다. 수동 조회(force)는 ETag 없이 다시 받으며 연결이 바뀐 뒤의 응답은 무시한다. 자산 종목은 kis_prices.py가 마감 후 하루 한 번 수집한다. 시세가 바뀌었으면 true.
async function readAssetPrices(cfg,force=false){
  try{
    const same=prices?.repo===cfg.repo, r=await aGh(cfg,`/repos/${cfg.repo}/contents/${A_PRICE_FILE}`,{headers:{Accept:"application/vnd.github.raw+json",...(!force&&same&&prices.etag?{"If-None-Match":prices.etag}:{})}});
    if(!sameConfig(cfg))return false;
    if(r.status===304){ priceLine(); return false; }
    if(r.status===404){ const had=!!prices; prices=null; localStorage.removeItem(A_PRICE_KEY); priceLine("데이터 저장소에 시세 파일이 없어 입력한 금액 그대로 계산합니다."); return had; }
    if(!r.ok) throw Error(`시세 읽기 실패 (${r.status})`);
    const d=JSON.parse(await r.text());
    if(!d||!d.stocks||typeof d.stocks!=="object"||Array.isArray(d.stocks))throw Error("시세 파일 형식을 확인할 수 없습니다.");
    return acceptPrices(cfg,d,r.headers.get("ETag")||"",false);
  }catch(error){ if(sameConfig(cfg))priceLine(`시세 확인 실패 · ${error.message}`); return false; }
}
// 메인에서 즉시 읽은 시세 파일을 분할매수·자산 평가에도 반영한다. 연결 변경 뒤의 응답은 받지 않는다.
function acceptPrices(cfg,d,etag="",notify=true){
  if(!sameConfig(cfg))return false;
  let next=null;
  if(d){const stocks={};for(const [k,e] of Object.entries(d.stocks||{})){if(!e||typeof e!=="object")continue;stocks[k]=Number(e.close)>0?{kind:e.kind,asOf:e.asOf,close:Number(e.close),...(e.stale?{stale:true}:{})}:{error:true};}
    const fx=d.fx?.USDKRW;next={repo:cfg.repo,etag,updatedAt:String(d.updatedAt||""),stocks,fx:fx&&Number(fx.close)>0?{close:Number(fx.close),asOf:fx.asOf}:null};}
  const changed=JSON.stringify({...prices,etag:""})!==JSON.stringify({...next,etag:""});prices=next;
  if(next)writeJson(A_PRICE_KEY,next);else localStorage.removeItem(A_PRICE_KEY);
  priceLine(next?"":"데이터 저장소에 시세 파일이 없어 입력한 금액 그대로 계산합니다.");if(changed&&notify)emit("change");return changed;
}
function priceLine(message=""){ priceMessage=message; emit("prices"); }
// 수집된 시세 파일만 즉시 다시 읽는다. 보유량·금액·체결 기록은 변경하지 않고, 기록 동기화와 중복 조회는 겹치지 않게 한다.
async function refreshPrices(){
  if(aSync.busy||priceRefreshBusy)return;
  const cfg=assetConfig();
  if(!cfg){priceLine("먼저 메인 플래너의 동기화 설정에서 데이터 저장소와 토큰을 연결해 주세요.");return;}
  priceRefreshBusy=true;priceLine("시세 불러오는 중…");
  try{
    const changed=await readAssetPrices(cfg,true);
    if(!sameConfig(cfg)){priceLine("연결 설정이 바뀌었습니다. 다시 시세를 불러와 주세요.");return;}
    if(changed)emit("change");
    if(!priceMessage)priceLine(`시세 불러오기 완료${prices?.updatedAt?` · 최근 수집 ${new Date(prices.updatedAt).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}`:""}`);
  }finally{priceRefreshBusy=false;emit("prices");if(aSync.again)scheduleAssetSync(300);}
}
function setAssetSync(state, message=""){
  aSync.state=state; aSync.message=message;
  if(state==="done") aSync.at=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
  emit("status");
}
function keepLost(lost){
  if(!lost.length)return; const list=readJson(A_RECOVERY_KEY,[]);
  lost.forEach(x=>list.push({...x,keptAt:new Date().toISOString()})); writeJson(A_RECOVERY_KEY,list.slice(-20)); emit("recovery");
}
async function syncAssets(){
  const cfg=assetConfig();
  if(!cfg){ clearTimeout(aSync.timer); aSync.timer=null; setAssetSync("off"); return; }
  if(aSync.busy||priceRefreshBusy){ aSync.again=true; return; }
  aSync.busy=true; aSync.again=false; clearTimeout(aSync.timer); aSync.timer=null; setAssetSync("busy");
  try{
    if(aSync.checked!==cfg.repo){ const r=await aGh(cfg,`/repos/${cfg.repo}`); if(r.status===404) throw Error(`저장소 ${cfg.repo}를 찾을 수 없습니다.`); if(!r.ok) throw Error(`저장소 확인 실패 (${r.status})`); if(!(await r.json()).private) throw Error(`${cfg.repo}는 공개 저장소라 기록을 올리지 않았습니다. 비공개 저장소를 지정해 주세요.`); aSync.checked=cfg.repo; }
    let redraw=await readAssetPrices(cfg);
    for(let attempt=1;;attempt++){
      const remote=await readAssetRemote(cfg), base=cleanAssets(readJson(A_BASE_KEY+cfg.repo,null)), {doc:merged,lost}=mergeAssets(doc,remote.doc,base);
      keepLost(lost);
      if(JSON.stringify(merged)!==JSON.stringify(doc)){ doc=JSON.parse(JSON.stringify(merged)); writeLocal(); redraw=true; } // 복사: 화면에서 고칠 때 받아 둔 저장소 기록(aSync.remote)이 같이 바뀌지 않게
      if(doc.allocation&&prices&&fillBases(doc.allocation,prices)){ doc.allocation.savedAt=new Date().toISOString(); writeLocal(); redraw=true; }
      if(remote.doc?JSON.stringify(doc)===JSON.stringify(remote.doc):assetsBlank(doc)){ writeJson(A_BASE_KEY+cfg.repo,doc); break; }
      try{ await writeAssetRemote(cfg,doc,remote.sha); writeJson(A_BASE_KEY+cfg.repo,doc); break; }
      catch(error){ if(!error.stale||attempt>=3) throw error; aSync.remote=null; }
    }
    if(redraw) emit("change");
    setAssetSync(aSync.timer?"pending":"done");
  }catch(error){ setAssetSync("error",error?.name==="TypeError"&&/fetch|network|load/i.test(error.message)?"네트워크 연결을 확인해 주세요.":error?.message||String(error)); }
  finally{ aSync.busy=false; if(aSync.again) scheduleAssetSync(300); }
}
function scheduleAssetSync(delay){ if(!assetConfig()) return; clearTimeout(aSync.timer); aSync.timer=setTimeout(()=>{ aSync.timer=null; syncAssets(); },delay); if(!aSync.busy) setAssetSync("pending"); }

function restore(incoming){
  const next=cleanAssets(incoming);if(!next||assetsBlank(next))return false;
  keepLost(ASSET_SECTIONS.filter(s=>next[s]&&doc[s]).map(s=>({section:s,data:doc[s]})));
  const now=new Date().toISOString();for(const s of ASSET_SECTIONS)if(next[s])doc[s]={...next[s],savedAt:now};
  writeLocal();scheduleAssetSync(300);emit("change");return true;
}
function refreshConfig(){aSync.checked="";aSync.remote=null;return syncAssets();}
// UI와 독립적이며 start()를 부를 때만 주기적 동기화를 시작한다.
function start(){
  if(started)return;started=true;
  setInterval(()=>{if(!document.hidden&&!aSync.busy&&assetConfig())syncAssets();},45000);
  document.addEventListener("visibilitychange",()=>{if(assetConfig()&&(!document.hidden||aSync.timer))syncAssets();});
  addEventListener("storage",e=>{
    if(e.key===A_KEY){const incoming=cleanAssets(readJson(A_KEY,null));if(incoming){const merged=mergeAssets(doc,incoming,lastLocal);keepLost(merged.lost);doc=JSON.parse(JSON.stringify(merged.doc));if(JSON.stringify(doc)!==JSON.stringify(incoming))writeLocal();else lastLocal=JSON.parse(JSON.stringify(doc));emit("change");}}
    if(e.key===null||e.key===A_REPO_KEY||e.key===A_TOKEN_KEY)refreshConfig();
  });
  if(doc.allocation&&prices&&fillBases(doc.allocation,prices))saveSection("allocation");
  syncAssets();
}
return {get doc(){return doc;},get prices(){return prices;},get priceMessage(){return priceMessage;},get priceRefreshing(){return priceRefreshBusy;},get status(){return {...aSync};},
  config:assetConfig,saveSection,sync:syncAssets,start,refreshConfig,refreshPrices,restore,keepLost,acceptPrices,
  recovery:()=>readJson(A_RECOVERY_KEY,[]),subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
})();
