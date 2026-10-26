// 자산 현황·플래너 분할매수의 공유 기록·시세·동기화. 구역 병합은 assets-calc.js mergeAssets, 공통 작업 규칙은 AGENTS.md.
const assetStore = (()=>{
const A_KEY="etf-planner-assets-v1", A_BASE_KEY="etf-planner-assets-sync-base:", A_RECOVERY_KEY="etf-planner-assets-recovery";
const A_PRICE_KEY="etf-planner-assets-prices", A_FILE="etf-planner-assets.json", A_PRICE_FILE="etf-planner-prices.json";
const A_NOTICE_KEY="etf-planner-assets-merge-notice"; // 겹친 칸을 나중 값으로 정리한 칸 수 {count, at}. 이 기기에만 두고 안내에서 '확인'하면 지운다
const A_PRICE_FORMAT=2; // 125개월 평균선을 버리던 옛 시세 캐시는 ETag 없이 한 번 다시 받는다.
const A_REPO_KEY="etf-planner-data-repo", A_TOKEN_KEY="etf-planner-github-token";
const readJson=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||"null")??d;}catch{return d;}};
const writeJson=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}};
// 손상된 로컬 기록은 빈 기기로 취급하지 않는다. 원문을 보존하고 명시적 백업 복원까지 쓰기·동기화를 막는다.
let loadedRaw=null,loadError="";
function readLocalAssets(){
  if(loadError)return null;
  loadedRaw=null; // 읽기 자체가 실패하면 앞선 정상 원문을 현재 기록의 백업으로 오인하지 않는다.
  try{loadedRaw=localStorage.getItem(A_KEY);if(loadedRaw===null)return null;const value=cleanAssets(externalData.assets(JSON.parse(loadedRaw)));if(!value)throw Error();return value;}
  catch{loadError="이 기기의 자산 기록을 불러오지 못했습니다. 기존 기록을 보호하기 위해 저장·동기화를 중단했습니다.";return null;}
}
let doc=readLocalAssets()||{version:1}, prices=readJson(A_PRICE_KEY,null), priceMessage="", priceRefreshBusy=false, started=false;
let lastLocal=JSON.parse(JSON.stringify(doc)); // 같은 브라우저의 다른 페이지가 바꾼 기록도 공통 기준으로 병합
const listeners=new Set(), emit=type=>listeners.forEach(fn=>fn(type));
function writeLocal(next=doc,restoring=false){
  if(loadError&&!restoring){setAssetSync("error",loadError);return false;}
  if(!writeJson(A_KEY,next)){setAssetSync("error","이 기기에 기록을 저장하지 못했습니다. 브라우저 저장 공간을 확인하고 JSON 백업을 내려받아 주세요.");return false;}
  doc=next;lastLocal=JSON.parse(JSON.stringify(doc));if(restoring){const blocked=!!loadError;loadError="";loadedRaw=null;if(blocked)setAssetSync(assetConfig()?"pending":"off");}return true;
}
function saveSection(section){
  // storage 이벤트가 오기 전에도 같은 구역의 서로 다른 칸을 합친다. 충돌은 이번 입력을
  // 우선하되 최신 원문을 복구본에 남긴 뒤 저장한다(구역 밖의 입력·저축 최단 기록도 보존).
  const latest=readLocalAssets();if(loadError){setAssetSync("error",loadError);return false;}
  if(!latest||JSON.stringify(latest)===JSON.stringify(lastLocal)){
    if(section==="allocation"&&doc.allocation)syncPurchaseTargets(lastLocal.allocation,doc.allocation,prices);
    if(doc[section])doc[section].savedAt=new Date().toISOString();
    if(!writeLocal())return false;scheduleAssetSync(1500);emit("change");return true;
  }
  const next=JSON.parse(JSON.stringify(doc));
  // 자산 배분 목표가 바뀐 분할매수 계획은 같은 저장에서 옛 계획 목표·총 매수 금액을 맞춘다(assets-calc.js syncPurchaseTargets). 동기화·복원으로 받은 기록은 다시 계산하지 않는다.
  if(section==="allocation"&&next.allocation)syncPurchaseTargets(lastLocal.allocation,next.allocation,prices);
  if(next[section])next[section].savedAt=new Date().toISOString();
  const result=mergeAssets(next,latest,lastLocal);
  if(!keepMerged(result)||!writeLocal(JSON.parse(JSON.stringify(result.doc))))return false;scheduleAssetSync(1500);emit("change");return true;
}
// 저장 버튼을 누를 때만 기록을 갱신한다. 다른 탭의 최신 입력·최단 기록을 먼저 합치고, 브라우저 저장 실패 시 기존 상태를 유지한다.
function saveSavingsMilestone(record){
  const n=ymNum(record?.ym), latest=readLocalAssets(), best=earlierSavingsRecord(doc.savings?.milestoneRecord,latest?.savings?.milestoneRecord);
  if(loadError){setAssetSync("error",loadError);return false;}
  if(n===null||(best&&n>=ymNum(best.ym)))return false;
  const result=mergeAssets(doc,latest,lastLocal),merged=result.doc;if(!merged.savings)return false;
  const age=finite(record.age), next={...merged,savings:{...merged.savings,milestoneRecord:{ym:record.ym,...(age!==null?{age}:{})},savedAt:new Date().toISOString()}};
  if(!keepMerged(result))return false;
  if(!writeJson(A_KEY,next)){setAssetSync("error","최단 기록을 이 기기에 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.");return false;}
  doc=next;lastLocal=JSON.parse(JSON.stringify(doc));scheduleAssetSync(1500);emit("change");return true;
}
const aSync = {busy:false, again:false, timer:null, checked:"", state:"off", message:"", at:"", remote:null, choice:false};
function assetConfig(){ try { const repo=(localStorage.getItem(A_REPO_KEY)||"").trim(), token=localStorage.getItem(A_TOKEN_KEY)||""; return token&&/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)?{repo,token}:null; } catch { return null; } }
const sameConfig=cfg=>{const current=assetConfig();return !!current&&current.repo===cfg.repo&&current.token===cfg.token;};
const toB64A = text => { const bytes=new TextEncoder().encode(text); let bin=""; for(let i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(bin); };
const fromB64A = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g,"")),c=>c.charCodeAt(0)));
async function aGh(cfg, path, options={}){
  repoSecurity.assertDataRepo(cfg.repo);
  if(!sameConfig(cfg))throw Error("연결 설정이 바뀌었습니다. 다시 동기화해 주세요.");
  const r=await fetch(`https://api.github.com${path}`,{cache:"no-store",...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${cfg.token}`,...options.headers}});
  if(r.status===401) throw Error("GitHub 토큰이 맞지 않거나 만료됐습니다. 메인 플래너의 동기화 설정에서 새 토큰을 넣어 주세요.");
  if(r.status===403) throw Error("토큰 권한이 부족하거나 요청이 너무 많습니다. 토큰의 Contents 읽기·쓰기 권한을 확인해 주세요.");
  return r;
}
async function readAssetRemote(cfg){
  const path=`/repos/${cfg.repo}/contents/${A_FILE}`, last=aSync.remote?.repo===cfg.repo?aSync.remote:null;
  const r=await aGh(cfg,path,{headers:last?.etag?{"If-None-Match":last.etag}:{}}); // 바뀌지 않았으면 304(요청 한도에 세지 않음)
  if(!sameConfig(cfg))return null;
  if(r.status===304&&last) return last;
  if(r.status===404) return (aSync.remote={repo:cfg.repo,sha:"",doc:null,etag:""});
  if(!r.ok) throw Error(`기록 읽기 실패 (${r.status})`);
  const meta=await r.json(); let text=meta.encoding==="base64"&&meta.content?fromB64A(meta.content):null;
  if(!sameConfig(cfg))return null;
  if(text===null){ const raw=await aGh(cfg,path,{headers:{Accept:"application/vnd.github.raw+json"}}); if(!raw.ok) throw Error(`기록 읽기 실패 (${raw.status})`); text=await raw.text(); }
  let data=null; try { data=cleanAssets(externalData.assets(JSON.parse(text))); } catch { data=null; }
  if(!data) throw Error(`저장소의 ${A_FILE} 형식을 확인할 수 없어 자동으로 덮어쓰지 않았습니다.`);
  if(!sameConfig(cfg))return null;
  return (aSync.remote={repo:cfg.repo,sha:meta.sha,doc:data,etag:r.headers.get("ETag")||""});
}
async function writeAssetRemote(cfg, data, sha){
  const body={message:`자산 현황 동기화 ${new Date().toISOString()}`,content:toB64A(JSON.stringify(data,null,2)+"\n"),...(sha?{sha}:{})};
  const r=await aGh(cfg,`/repos/${cfg.repo}/contents/${A_FILE}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(r.status===409||r.status===422){ const e=Error("다른 기기가 먼저 저장했습니다."); e.stale=true; throw e; }
  if(!r.ok) throw Error(`기록 저장 실패 (${r.status})`);
  const res=await r.json(); if(sameConfig(cfg))aSync.remote={repo:cfg.repo,sha:res.content?.sha||"",doc:JSON.parse(JSON.stringify(data)),etag:""};
}
// 시세 파일은 ETag로 읽고 종가·환율만 이 기기에 둔다. 수동 조회(force)는 ETag 없이 다시 받으며 연결이 바뀐 뒤의 응답은 무시한다. 자산 종목은 kis_prices.py가 마감 후 하루 한 번 수집한다. 시세가 바뀌었으면 true.
async function readAssetPrices(cfg,force=false){
  try{
    const same=prices?.repo===cfg.repo, r=await aGh(cfg,`/repos/${cfg.repo}/contents/${A_PRICE_FILE}`,{headers:{Accept:"application/vnd.github.raw+json",...(!force&&same&&prices.format===A_PRICE_FORMAT&&prices.etag?{"If-None-Match":prices.etag}:{})}});
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
    const fx=d.fx?.USDKRW;next={format:A_PRICE_FORMAT,repo:cfg.repo,etag,updatedAt:String(d.updatedAt||""),stocks,fx:fx&&Number(fx.close)>0?{close:Number(fx.close),asOf:fx.asOf,ma:{"125개월선":plus(fx.ma?.["125개월선"])},...(fx.maAsOf?{maAsOf:fx.maAsOf}:{}),...(fx.maStale?{maStale:true}:{})}:null};}
  const changed=JSON.stringify({...prices,etag:""})!==JSON.stringify({...next,etag:""});prices=next;
  if(next)writeJson(A_PRICE_KEY,next);else localStorage.removeItem(A_PRICE_KEY);
  priceLine(next?"":"데이터 저장소에 시세 파일이 없어 입력한 금액 그대로 계산합니다.");if(changed&&notify)emit("change");return changed;
}
function priceLine(message=""){ priceMessage=message; emit("prices"); }
// 평가에 필요한 실제 종목 시세가 없으면 파일을 읽었어도 완료로 표시하지 않는다.
// 같은 ETF의 여러 계좌는 한 번만 안내하며, 보유 수량 0·보유 금액 없음·직접 입력 가격은 제외한다. 기록은 바꾸지 않는다.
function missingPriceMessage(){
  const missing=new Set();
  for(const g of doc.allocation?.groups||[])for(const it of g.items||[]){
    if(finite(it.shares)===0||(!plus(it.shares)&&!plus(it.amount)))continue;
    const ticker=assetTradeTicker(it);
    if(ticker&&purchaseQuoteKind(ticker)&&!assetTradeQuote(prices,it))missing.add(ticker);
  }
  return missing.size?`시세 없음 ${missing.size}종목 (${[...missing].join(", ")}) · 다음 시세 수집 후 다시 불러와 주세요.`:"";
}
// 저장 대기 중인 자산 종목을 먼저 동기화하고 새 수집 결과를 받는다. 보유량·금액·체결 기록은 시세로 변경하지 않는다.
async function refreshPrices(){
  if(aSync.busy||priceRefreshBusy)return;
  const cfg=assetConfig();
  if(!cfg){priceLine("먼저 메인 플래너의 동기화 설정에서 데이터 저장소와 토큰을 연결해 주세요.");return;}
  priceRefreshBusy=true;priceLine("시세 수집 준비 중…");
  try{
    if(aSync.timer||aSync.state==="pending"){
      await syncAssets(true);if(aSync.state==="error"||aSync.choice)throw Error("먼저 자산 기록 동기화를 완료한 뒤 시세를 수집해 주세요.");
    }
    const result=await collectPricesNow(cfg,message=>priceLine(message),()=>sameConfig(cfg));
    if(!sameConfig(cfg)){priceLine("연결 설정이 바뀌었습니다. 다시 시세를 불러와 주세요.");return;}
    const changed=acceptPrices(cfg,result.doc,result.etag,false);
    if(changed)emit("change");
    if(!priceMessage)priceLine(missingPriceMessage()||result.message||`시세 불러오기 완료${prices?.updatedAt?` · 최근 수집 ${new Date(prices.updatedAt).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}`:""}`);
  }catch(error){priceLine(`시세 확인 실패 · ${error.message}`);}
  finally{priceRefreshBusy=false;emit("prices");if(aSync.again)scheduleAssetSync(300);}
}
function setAssetSync(state, message=""){
  aSync.state=state; aSync.message=message;
  if(state==="done") aSync.at=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
  emit("status");
}
function keepLost(lost){
  if(!lost.length)return true;let list;
  try{const raw=localStorage.getItem(A_RECOVERY_KEY);list=raw===null?[]:JSON.parse(raw);if(!Array.isArray(list)||list.some(value=>!value||typeof value!=="object"||Array.isArray(value)))throw Error();}
  catch{setAssetSync("error","기존 충돌 복구 기록을 읽을 수 없어 덮어쓰지 않았습니다.");return false;}
  lost.forEach(x=>list.push({...x,keptAt:new Date().toISOString()}));
  if(!writeJson(A_RECOVERY_KEY,list.slice(-20))){setAssetSync("error","충돌 복구 기록을 이 기기에 저장하지 못했습니다. 기존 기록을 유지합니다.");return false;}
  emit("recovery");return true;
}
function keepMerged({lost,conflicts}){
  if(!keepLost(lost))return false;
  if(conflicts){const prev=readJson(A_NOTICE_KEY,null);writeJson(A_NOTICE_KEY,{count:(prev?.count||0)+conflicts,at:new Date().toISOString()});emit("recovery");}
  return true;
}
// 처음 맞추는 저장소(지난 동기화 기준 없음)에서 이 기기와 내용이 다른 구역(저장 시각은 빼고 비교). 이때는 합치지 않고 고를 때까지 기다린다(choose).
const bareSection=v=>JSON.stringify({...v,savedAt:""});
const differing=(a,b)=>ASSET_SECTIONS.filter(s=>a?.[s]&&b?.[s]&&bareSection(a[s])!==bareSection(b[s]));
const SUMMARY={allocation:v=>`자산 배분 종목 ${(v.groups||[]).reduce((n,g)=>n+(g.items||[]).length,0)}개`,ledger:v=>`월별 손익 ${(v.years||[]).reduce((n,y)=>n+(y.months||[]).length,0)}개월`,savings:v=>`저축 실적 ${(v.actual||[]).length}개월`,installments:()=>"할부 계산"};
// 고른 쪽을 쓴다: 다른 쪽을 지난 동기화 기준으로 두면 mergeAssets가 다른 구역은 고른 쪽을 택하고, 한쪽에만 있는 구역은 그대로 남긴다. 버린 쪽은 보관한다.
function choose(side){
  const cfg=assetConfig(),remote=aSync.remote?.repo===cfg?.repo?aSync.remote.doc:null;
  if(!aSync.choice||!cfg||!remote||!["local","remote"].includes(side))return false;
  const other=side==="local"?remote:doc;
  if(!keepLost(differing(doc,remote).map(s=>({section:s,data:other[s]}))))return false;
  try{writeAssetBase(cfg.repo,other);}catch(error){setAssetSync("error",error.message);return false;}
  aSync.choice=false;return syncAssets().then(()=>aSync.state==="done"||aSync.state==="pending");
}
// 처음 연결 선택(choose)·겹친 칸 정리(merged) 안내. 두 화면(index.html·assets.html)이 같은 칸(#assetSyncNotice)에 쓰며, 글자는 숫자와 고정 문구뿐이다.
function notice(){
  const remote=aSync.choice?aSync.remote?.doc:null;
  if(remote){const list=differing(doc,remote),text=d=>list.map(s=>SUMMARY[s](d[s])).join(" · ");return {kind:"choose",local:text(doc),remote:text(remote)};}
  const n=readJson(A_NOTICE_KEY,null);return n?.count>0?{kind:"merged",count:n.count,at:n.at}:null;
}
function renderNotice(box,download){
  const n=notice(),btn=(text,fn)=>Object.assign(document.createElement("button"),{type:"button",className:"btn mini",textContent:text,onclick:fn});
  box.hidden=!n;if(!n)return;
  // 글자는 한 문단, 버튼은 그 아래 줄에 모은다(버튼이 글자 줄에 끼어 줄 간격이 벌어지지 않게).
  const show=(text,...buttons)=>{const p=Object.assign(document.createElement("p"),{textContent:text}),row=Object.assign(document.createElement("div"),{className:"notice-actions"});row.append(...buttons);box.replaceChildren(p,row);};
  if(n.kind==="choose")show(`분할매수·자산 기록이 이 기기와 저장소에서 다릅니다. 이 기기: ${n.local} / 저장소: ${n.remote}. 어느 쪽을 쓸까요? 고르지 않은 쪽은 이 기기에 보관합니다.`,
    btn("저장소 기록 사용",()=>choose("remote")),btn("이 기기 기록 사용",()=>choose("local")));
  else show(`다른 기기와 같은 칸을 함께 고친 ${n.count}곳은 나중에 저장한 값을 썼습니다. 이전 값은 이 기기에 보관했습니다.`,btn("보관 기록 내려받기",download),btn("확인",()=>{localStorage.removeItem(A_NOTICE_KEY);emit("recovery");}));
}
function writeAssetBase(repo,snapshot){if(!writeJson(A_BASE_KEY+repo,snapshot))throw Error("동기화 기준을 이 기기에 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.");}
// 다른 탭의 storage 이벤트보다 동기화 응답이 먼저 와도 최신 로컬 입력을 병합한다.
function reconcileLocalAssets(){
  const latest=readLocalAssets();if(loadError){setAssetSync("error",loadError);return false;}
  const result=mergeAssets(doc,latest,lastLocal);if(!keepMerged(result))return false;
  const next=JSON.parse(JSON.stringify(result.doc));
  if(JSON.stringify(next)!==JSON.stringify(doc)||JSON.stringify(doc)!==JSON.stringify(lastLocal))return writeLocal(next);
  return true;
}
async function syncAssets(beforePriceCollection=false){
  readLocalAssets();
  if(loadError){setAssetSync("error",loadError);return;}
  const cfg=assetConfig();
  if(!cfg){ clearTimeout(aSync.timer); aSync.timer=null; aSync.choice=false; setAssetSync("off"); return; }
  if(aSync.busy||(priceRefreshBusy&&beforePriceCollection!==true)){ aSync.again=true; return; }
  aSync.busy=true; aSync.again=false; clearTimeout(aSync.timer); aSync.timer=null; setAssetSync("busy");
  try{
    if(!reconcileLocalAssets())return;
    if(aSync.checked!==cfg.repo){ const r=await aGh(cfg,`/repos/${cfg.repo}`); if(r.status===404) throw Error(`저장소 ${cfg.repo}를 찾을 수 없습니다.`); if(!r.ok) throw Error(`저장소 확인 실패 (${r.status})`); if(!(await r.json()).private) throw Error(`${cfg.repo}는 공개 저장소라 기록을 올리지 않았습니다. 비공개 저장소를 지정해 주세요.`); if(!sameConfig(cfg))return; aSync.checked=cfg.repo; }
    let redraw=await readAssetPrices(cfg);
    if(!sameConfig(cfg))return;
    for(let attempt=1;;attempt++){
      const remote=await readAssetRemote(cfg);if(!sameConfig(cfg))return;
      if(!reconcileLocalAssets())return;
      const base=cleanAssets(readJson(A_BASE_KEY+cfg.repo,null));
      if(!base&&remote.doc&&differing(doc,remote.doc).length){aSync.choice=true;if(redraw)emit("change");setAssetSync("choose");return;}
      aSync.choice=false;
      const result=mergeAssets(doc,remote.doc,base),merged=result.doc;
      if(!keepMerged(result))return;
      const next=JSON.parse(JSON.stringify(merged)); // 원격 캐시와 화면 입력 객체를 분리한다.
      if(next.allocation&&prices&&fillBases(next.allocation,prices))next.allocation.savedAt=new Date().toISOString();
      if(JSON.stringify(next)!==JSON.stringify(doc)){if(!writeLocal(next))return;redraw=true;}
      if(remote.doc?JSON.stringify(doc)===JSON.stringify(remote.doc):assetsBlank(doc)){ writeAssetBase(cfg.repo,doc); break; }
      // PUT 중 추가 입력은 다음 동기화에 남긴다. 기준·원격 캐시는 실제 보낸 스냅샷만 사용한다.
      const uploaded=JSON.parse(JSON.stringify(doc));
      try{ await writeAssetRemote(cfg,uploaded,remote.sha); if(!sameConfig(cfg))return; writeAssetBase(cfg.repo,uploaded); break; }
      catch(error){ if(!sameConfig(cfg))return;if(!error.stale||attempt>=3) throw error; aSync.remote=null; }
    }
    if(redraw) emit("change");
    setAssetSync(aSync.timer?"pending":"done");
  }catch(error){ if(sameConfig(cfg))setAssetSync("error",error?.name==="TypeError"&&/fetch|network|load/i.test(error.message)?"네트워크 연결을 확인해 주세요.":error?.message||String(error)); }
  finally{ aSync.busy=false; if(!sameConfig(cfg)){aSync.checked="";aSync.remote=null;setAssetSync(assetConfig()?"pending":"off");} if(aSync.again) scheduleAssetSync(300); }
}
function scheduleAssetSync(delay){ if(!assetConfig()) return; clearTimeout(aSync.timer); aSync.timer=setTimeout(()=>{ aSync.timer=null; syncAssets(); },delay); if(!aSync.busy&&!aSync.choice) setAssetSync("pending"); }

function restore(incoming,backupRaw){
  const next=cleanAssets(externalData.assets(incoming));if(!next||assetsBlank(next))return false;
  const latest=readLocalAssets(),now=new Date().toISOString();
  if(loadError){if(loadedRaw===null||typeof backupRaw!=="function")throw Error("읽지 못한 기존 자산 원문을 백업할 수 없어 복원하지 않았습니다.");backupRaw(loadedRaw);}
  const lost=ASSET_SECTIONS.filter(s=>next[s]&&doc[s]).map(s=>({section:s,data:doc[s]})), restored={...doc};
  for(const s of ASSET_SECTIONS)if(next[s]){const record=s==="savings"?earlierSavingsRecord(doc[s]?.milestoneRecord,latest?.[s]?.milestoneRecord,next[s].milestoneRecord):null;restored[s]={...next[s],...(record?{milestoneRecord:record}:{}),savedAt:now};}
  if(!keepLost(lost)||!writeLocal(restored,true))throw Error(aSync.message);scheduleAssetSync(300);emit("change");return true;
}
function refreshConfig(){aSync.checked="";aSync.remote=null;return syncAssets();}
// UI와 독립적이며 start()를 부를 때만 주기적 동기화를 시작한다.
function start(){
  if(started)return;started=true;
  setInterval(()=>{if(!document.hidden&&!aSync.busy&&assetConfig())syncAssets();},45000);
  document.addEventListener("visibilitychange",()=>{if(assetConfig()&&(!document.hidden||aSync.timer))syncAssets();});
  addEventListener("storage",e=>{
    if(e.key===A_KEY){const incoming=readLocalAssets();if(loadError){setAssetSync("error",loadError);return;}if(incoming){const merged=mergeAssets(doc,incoming,lastLocal);if(!keepMerged(merged))return;const next=JSON.parse(JSON.stringify(merged.doc));if(JSON.stringify(next)!==JSON.stringify(incoming)){if(!writeLocal(next))return;}else{doc=next;lastLocal=JSON.parse(JSON.stringify(doc));}emit("change");}}
    if(e.key===null||e.key===A_REPO_KEY||e.key===A_TOKEN_KEY)refreshConfig();
  });
  if(doc.allocation&&prices&&fillBases(doc.allocation,prices))saveSection("allocation");
  syncAssets();
}
return {get doc(){return doc;},get loadError(){return loadError;},get loadedRaw(){return loadedRaw;},get prices(){return prices;},get priceMessage(){return priceMessage;},get missingPriceMessage(){return missingPriceMessage();},get priceRefreshing(){return priceRefreshBusy;},get status(){return {...aSync};},
  get notice(){return notice();},config:assetConfig,saveSection,saveSavingsMilestone,sync:syncAssets,start,refreshConfig,refreshPrices,restore,keepLost,acceptPrices,choose,renderNotice,
  recovery:()=>readJson(A_RECOVERY_KEY,[]),subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
})();
