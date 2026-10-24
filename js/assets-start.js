// 자산 현황 › 동기화 표시·백업·복원과 첫 화면. 모든 탭 파일 다음에 불러온다(기록·시세·병합은 assets-store.js에서 두 페이지가 공유).
const assetConfig=()=>assetStore.config();
function priceLine(message=assetStore.priceMessage){
  const n=prices?Object.values(prices.stocks).filter(e=>e.close).length:0,at=prices?.updatedAt,busy=assetStore.priceRefreshing,status=el("priceRefreshStatus");
  el("assetPriceStatus").textContent=message||(prices?`시세 파일 ${at?new Date(at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):""} · 종목 ${n}개${prices.fx?` · 현물 환율 ${nf2.format(prices.fx.close)}원`:""}. 자산 배분 종목 코드는 데이터 저장소 수집 작업이 장 마감 후 하루 한 번(국내 16:40·미국 06:40) 종가를 받습니다.`:"");
  const late=!message&&!busy&&!!assetConfig()&&priceCollectionLate(at); // 정기 수집이 늦어짐(예약 실행 누락·지연) — price-collection.js
  status.className=message&&!busy&&!message.startsWith("시세 불러오기 완료")?"warning":late?"late":"";
  status.textContent=message||(at?`최근 수집 ${new Date(at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}${late?" · 수집 지연":""}`:assetConfig()?"시세를 바로 수집한 뒤 불러옵니다.":"동기화를 연결하면 시세를 불러올 수 있습니다.");
  for(const key of ["refreshPricesBtn","refreshPricesDialogBtn"]){const btn=el(key);btn.disabled=assetStore.status.state==="busy"||busy;btn.ariaBusy=String(busy);btn.textContent=busy?"시세 불러오는 중…":"시세 즉시 불러오기";}
}
function setAssetSync(){
  const cfg=assetConfig(),s=assetStore.status;
  const text={off:"이 기기에만 저장 중",pending:"잠시 후 동기화",busy:"동기화 확인 중…",done:`동기화 완료 · ${s.at}`,error:`이 기기 저장됨 · ${s.message}`,choose:"기록 선택 필요 · 이 기기에만 저장 중"}[s.state];
  el("syncStatus").textContent=text;el("syncDialogStatus").textContent=text;el("syncBtn").title=text;
  el("syncBtn").className="btn mini sync-btn "+(!cfg?"off":s.state==="error"||s.state==="choose"?"warn":s.state==="busy"?"busy":"ok");
  el("syncOff").hidden=!!cfg;el("syncOn").hidden=!cfg;el("syncRepo").textContent=cfg?.repo||"";el("syncNowBtn").hidden=!cfg;
  el("downloadRecovery").hidden=!assetStore.recovery().length;
  assetStore.renderNotice?.(el("assetSyncNotice"),()=>el("downloadRecovery").click());
}
assetStore.subscribe(type=>{doc=assetStore.doc;prices=assetStore.prices;setAssetSync();priceLine();if(type==="prices"||type==="change")updateLedgerDividendFx?.();if(type==="change")redrawIdle();});
el("syncBtn").onclick=()=>el("syncDialog").showModal();
el("syncNowBtn").onclick=()=>assetStore.refreshConfig();
async function refreshAssetPrices(){await assetStore.refreshPrices();if(!assetConfig()&&!el("syncDialog").open)el("syncDialog").showModal();}
el("refreshPricesBtn").onclick=refreshAssetPrices;
el("refreshPricesDialogBtn").onclick=refreshAssetPrices;
el("downloadRecovery").hidden=!assetStore.recovery().length;
const downloadA = (value, name) => { const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"}), a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); };
el("downloadRecovery").onclick=()=>downloadA(assetStore.recovery(),`etf-planner-assets-recovery-${new Date().toISOString().slice(0,10)}.json`);
el("exportBtn").onclick=()=>downloadA({...doc,exportedAt:new Date().toISOString()},`etf-planner-assets-${new Date().toISOString().slice(0,10)}.json`);
el("importInput").onchange=async e=>{ const file=e.target.files?.[0]; if(!file) return;
  try{ const incoming=cleanAssets(externalData.assets(JSON.parse(await file.text()))); if(!incoming||assetsBlank(incoming)) throw Error("자산 현황 백업 형식이 아닙니다.");
    const names=ASSET_SECTIONS.filter(s=>incoming[s]).map(s=>({allocation:"자산 배분",ledger:"월별 손익",savings:"저축 계획",installments:"할부 계산"}[s]));
    if(!confirm(`${names.join("·")} 기록을 이 파일로 바꿀까요? 지금 기록은 이 기기에 보관합니다.`)) return;
    assetStore.restore(incoming); render(); alert("복원했습니다."); }
  catch(err){ alert(`복원 실패: ${err.message}`); }
  e.target.value=""; };
// 탭 전환은 모든 탭 파일을 불러온 뒤 연결한다(불러오는 중 누른 탭이 아직 없는 화면 함수를 부르지 않게).
all(".tab").forEach(b=>b.addEventListener("click",()=>{ openTab(b.dataset.tab); history.replaceState(null,"",`#${ui.tab}`); scrollTo(0,0); }));
addEventListener("hashchange",()=>{if(location.hash==="#buys")location.replace("index.html#buys");else openTab(location.hash.slice(1));});
priceLine();setAssetSync();
if(location.hash==="#buys")location.replace("index.html#buys");
else openTab(location.hash.slice(1)||ui.tab);
assetStore.start();
