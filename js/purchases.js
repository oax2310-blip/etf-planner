// 플래너의 분할매수 탭. 자산 배분의 연결 종목·목표와 기존 buyPlan 기록을 그대로 사용한다.
const purchasePlanner = (()=>{
const el=id=>document.getElementById(id), all=sel=>document.querySelectorAll(sel);
const escA=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const nf1=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}),nf2=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2});
const man=v=>`${nf1.format(Math.round((Number(v)||0)*10)/10)}만원`;
const pc=v=>v===null||v===undefined||!Number.isFinite(Number(v))?"—":`${(Math.abs(v)<1?nf2:nf1).format(Number(v))}%`;
const PEN=PENCIL,newId=id,dlg=el;
const numIn=v=>String(v??"").trim()===""?null:finite(v);
const setNum=(obj,key,v)=>{const n=numIn(v);if(n===null)delete obj[key];else obj[key]=n;};
const setText=(obj,key,v)=>{const t=String(v??"").trim();if(t)obj[key]=t;else delete obj[key];};
let doc=assetStore.doc,prices=assetStore.prices,redrawLater=false,initialized=false;
function findItem(id){for(const g of doc.allocation?.groups||[]){const it=g.items.find(x=>x.id===id);if(it)return {g,it};}return null;}
const render=()=>renderPurchases(),saveSection=section=>assetStore.saveSection(section);
const onChange=(sel,section,set)=>all(sel).forEach(x=>x.onchange=()=>{if(set(x.value,x)!==false)saveSection(section);render();});
const emptyCard=(title,text,button)=>`<div class="card empty purchase-empty"><h2>${title}</h2><p>${text}</p>${button}</div>`;
// ---------- 분할매수 ----------
// 계획은 종목 안에 두므로 이름·목표 변경과 그룹 이동이 그대로 연결된다. 창에서 고치는 동안은 복사본만 바꾸고 저장할 때 반영한다.
const purchaseItems = () => (doc.allocation?.groups||[]).flatMap(g=>(g.items||[]).map(it=>({g,it})));
function renderPurchases(){
  doc=assetStore.doc;prices=assetStore.prices;
  const view=el("buysView"), items=purchaseItems(), plans=items.filter(({it})=>it.buyPlan);
  if(!items.length){view.innerHTML=emptyCard("분할매수할 종목을 추가하세요","자산 배분에서 종목을 등록하면 목표 비중과 연결해 분할매수 계획을 만들 수 있습니다.",`<button class="btn primary" id="purchaseGoAlloc" type="button">자산 배분으로</button>`);el("purchaseGoAlloc").onclick=()=>{location.href="assets.html#alloc";};return;}
  const s=allocationSummary(doc.allocation,prices), summaries=plans.map(({it})=>purchaseSummary(it.buyPlan)), totals=summaries.reduce((t,p)=>({planned:t.planned+p.planned,actual:t.actual+p.actual,remaining:t.remaining+p.remaining}),{planned:0,actual:0,remaining:0});
  const card=({g,it})=>{const plan=it.buyPlan,p=purchaseSummary(plan),v=s.items.get(it.id)?.value||0,t=finite(it.target),stages=Array.isArray(plan.stages)?plan.stages:[];
    const status=p.count&&p.done===p.count?"매수 완료":p.done?"진행 중":"매수 전";
    return `<section class="card purchase-card"><div class="purchase-head"><div class="title-row"><h2>${escA(it.name)}</h2><button class="btn icon-btn" type="button" data-purchase-edit="${escA(it.id)}" aria-label="${escA(it.name)} 분할매수 계획 수정" title="계획 수정">${PEN}</button></div>
      <p>${escA(g.name)} · 현재 ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)}${s.base>0&&t/100*s.base>v?` · 목표까지 ${man(t/100*s.base-v)}`:""}`:" · 목표 미입력"}</p>
      <div class="purchase-progress"><span class="purchase-status${p.count&&p.done===p.count?" done":""}">${status} · ${p.done}/${p.count}회</span><span>예정 ${man(p.planned)} · 체결 ${man(p.actual)} · 남은 예정 ${man(p.remaining)}</span></div></div>
      ${stages.map((stage,i)=>`<div class="purchase-row${stage.done?" done":""}"><label class="check" title="매수 완료"><input type="checkbox" data-purchase-done="${escA(it.id)}" data-stage="${i}"${stage.done?" checked":""} aria-label="${escA(it.name)} ${i+1}차 매수 완료"><b>${i+1}차</b></label><div class="purchase-condition"><strong>${escA(stage.condition||"조건 미입력")}</strong><small>${escA(stage.date||"날짜 미정")}</small></div>
        <div class="purchase-amount"><span>예정 ${man(stage.amount)}</span>${stage.done?`<label>체결 <input type="number" min="0" step="any" inputmode="decimal" data-purchase-actual="${escA(it.id)}" data-stage="${i}" value="${finite(stage.actual)??Math.max(0,finite(stage.amount)||0)}" aria-label="${escA(it.name)} ${i+1}차 체결 금액 (만원)"> 만원</label>`:""}</div></div>`).join("")}
      ${plan.note?`<p class="purchase-note">${escA(plan.note)}</p>`:""}</section>`;
  };
  view.innerHTML=`<div class="heading"><div><div class="eyebrow">목표 비중과 연결한 매수 계획</div><h1>분할매수</h1><p>회차별 날짜·조건·예정액과 체결 기록을 관리합니다. 실제 매수 후 보유 금액·수량은 자산 배분에서 수정하세요.</p></div><button class="btn primary" id="addPurchase" type="button">＋ 계획</button></div>
    <p class="hint purchase-save-status" id="purchaseSaveStatus" role="status"></p>
    <div class="card metrics"><div class="metric"><label>총 매수 예정액</label><strong>${man(totals.planned)}</strong><small>${plans.length}개 종목 · ${summaries.filter(p=>p.count&&p.done===p.count).length}개 매수 완료</small></div><div class="metric"><label>체결 금액</label><strong>${man(totals.actual)}</strong><small>완료한 회차의 실제 금액 합계</small></div><div class="metric"><label>남은 예정액</label><strong>${man(totals.remaining)}</strong><small>아직 매수하지 않은 회차의 예정액</small></div></div>
    ${plans.length?plans.map(card).join(""):emptyCard("아직 분할매수 계획이 없습니다","종목을 고르고 매수 회차를 추가하세요.","")}`;
  updateStatus();
  el("addPurchase").onclick=()=>openPurchase(null);
  all("[data-purchase-edit]").forEach(b=>b.onclick=()=>openPurchase(b.dataset.purchaseEdit));
  onChange("[data-purchase-done]","allocation",(_,x)=>{const stage=findItem(x.dataset.purchaseDone)?.it.buyPlan?.stages?.[Number(x.dataset.stage)];if(!stage)return false;if(x.checked){stage.done=true;if(finite(stage.actual)===null)stage.actual=Math.max(0,finite(stage.amount)||0);}else delete stage.done;});
  onChange("[data-purchase-actual]","allocation",(v,x)=>{const stage=findItem(x.dataset.purchaseActual)?.it.buyPlan?.stages?.[Number(x.dataset.stage)],n=numIn(v);if(!stage||n!==null&&n<0)return false;setNum(stage,"actual",v);});
}
let purchaseDraft=null;
function renderPurchaseDraft(){
  const stages=purchaseDraft.stages;
  el("purchaseStageRows").innerHTML=stages.map((stage,i)=>`<div class="purchase-stage"><b>${i+1}차${stage.done?`<small>매수 완료</small>`:""}</b><label>매수 예정일<input type="date" data-purchase-field="date" data-stage="${i}" value="${escA(stage.date||"")}"></label><label class="condition-field">매수 조건<input maxlength="100" placeholder="예: 기준가 도달" data-purchase-field="condition" data-stage="${i}" value="${escA(stage.condition||"")}"></label><label>예정액 (만원)<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="amount" data-stage="${i}" value="${finite(stage.amount)??""}"></label>${stage.done?`<label>체결액 (만원)<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="actual" data-stage="${i}" value="${finite(stage.actual)??""}"></label>`:""}<button class="btn mini ghost" type="button" data-purchase-remove="${i}" aria-label="${i+1}차 회차 삭제">삭제</button></div>`).join("");
  all("[data-purchase-field]").forEach(x=>x.oninput=()=>{const stage=stages[Number(x.dataset.stage)],key=x.dataset.purchaseField;if(key==="amount"||key==="actual")setNum(stage,key,x.value);else setText(stage,key,x.value);});
  all("[data-purchase-remove]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.purchaseRemove);if(stages[i].done&&!confirm(`${i+1}차의 완료 기록과 체결 금액도 삭제할까요?`))return;stages.splice(i,1);renderPurchaseDraft();});
}
function openPurchase(id){
  const items=purchaseItems(),found=id?findItem(id):null,f=el("purchaseForm"),available=items.filter(({it})=>!it.buyPlan||it===found?.it);
  if(!available.length){alert("모든 종목에 분할매수 계획이 있습니다. 종목 이름 옆 연필로 기존 계획을 수정하세요.");return;}
  el("purchaseTitle").textContent=found?"분할매수 계획 수정":"새 분할매수 계획";
  f.item.innerHTML=available.map(({g,it})=>`<option value="${escA(it.id)}">${escA(it.name)} · ${escA(g.name)}</option>`).join("");f.item.value=found?.it.id||available[0].it.id;f.item.disabled=!!found;
  purchaseDraft=found?.it.buyPlan?JSON.parse(JSON.stringify(found.it.buyPlan)):{stages:Array.from({length:3},()=>({id:newId()}))};
  if(!Array.isArray(purchaseDraft.stages))purchaseDraft.stages=[];
  f.note.value=purchaseDraft.note||"";renderPurchaseDraft();
  el("addPurchaseStage").onclick=()=>{purchaseDraft.stages.push({id:newId()});renderPurchaseDraft();};
  el("purchaseDelete").hidden=!found;
  el("purchaseDelete").onclick=()=>{if(!confirm(`'${found.it.name}' 분할매수 계획과 체결 기록을 삭제할까요?`))return;delete found.it.buyPlan;saveSection("allocation");dlg("purchaseDialog").close();render();};
  f.onsubmit=e=>{e.preventDefault();const item=findItem(f.item.value)?.it;if(!item)return;if(!purchaseDraft.stages.length){alert("매수 회차를 하나 이상 추가하세요.");return;}
    setText(purchaseDraft,"note",f.note.value);item.buyPlan=purchaseDraft;saveSection("allocation");dlg("purchaseDialog").close();render();};
  dlg("purchaseDialog").showModal();
}


function statusText(){const s=assetStore.status;return {off:"이 기기에만 저장 중",pending:"잠시 후 동기화",busy:"동기화 확인 중…",done:`동기화 완료 · ${s.at}`,error:`이 기기 저장됨 · ${s.message}`}[s.state];}
function updateStatus(){
  const text=statusText();if(el("purchaseSaveStatus"))el("purchaseSaveStatus").textContent=text;
  el("purchaseSyncDialogStatus").textContent=`분할매수·자산: ${text}`;el("purchaseRecovery").hidden=!assetStore.recovery().length;
}
function redrawIdle(){
  if(state.tab!=="buys")return;const active=document.activeElement;
  if(el("purchaseDialog").open||active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)&&active.type!=="checkbox"){redrawLater=true;return;}
  redrawLater=false;render();
}
function initialize(){
  if(initialized)return;initialized=true;
  el("purchaseDialog").querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>dlg("purchaseDialog").close());
  el("purchaseDialog").addEventListener("close",()=>{if(redrawLater)redrawIdle();});
  document.addEventListener("focusout",()=>setTimeout(()=>{if(redrawLater)redrawIdle();},0));
  assetStore.subscribe(type=>{doc=assetStore.doc;prices=assetStore.prices;updateStatus();if(type==="change")redrawIdle();});
  for(const key of ["connectRepo","syncNow","disconnectRepo"]){const button=el(key),previous=button.onclick;button.onclick=e=>{previous?.call(button,e);assetStore.refreshConfig();};}
  el("purchaseExport").onclick=()=>downloadJson({...assetStore.doc,exportedAt:new Date().toISOString()},`etf-planner-assets-${new Date().toISOString().slice(0,10)}.json`);
  el("purchaseRecovery").onclick=()=>downloadJson(assetStore.recovery(),`etf-planner-assets-recovery-${new Date().toISOString().slice(0,10)}.json`);
  el("purchaseImport").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;
    try{const incoming=cleanAssets(JSON.parse(await file.text()));if(!incoming||assetsBlank(incoming))throw Error("분할매수·자산 백업 형식이 아닙니다.");
      const names=ASSET_SECTIONS.filter(s=>incoming[s]).map(s=>({allocation:"분할매수·자산 배분",ledger:"월별 손익",savings:"저축 계획"}[s]));
      if(confirm(`${names.join("·")} 기록을 이 파일로 바꿀까요? 지금 기록은 이 기기에 보관합니다.`)){assetStore.restore(incoming);alert("복원했습니다.");}}
    catch(error){alert(`복원 실패: ${error.message}`);}e.target.value="";};
  updateStatus();assetStore.start();
}
return {render:renderPurchases,initialize};
})();
