// 플래너의 분할매수 탭. 자산 배분의 연결 종목·목표와 기존 buyPlan 기록을 그대로 사용한다.
const purchasePlanner = (()=>{
const el=id=>document.getElementById(id), all=sel=>document.querySelectorAll(sel);
const escA=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const nf1=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}),nf2=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}),nf8=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
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
// 회차 가격·수량(선택): 통화는 계획에 저장한 currency(달러일 때만 저장) → 종목 시세 통화 → 원화. 비트코인(BTC-USD)은 0.00000001 단위, 나머지는 1주.
const quoteOf=it=>assetQuote(prices,it?.ticker);
const planCurrency=(plan,it)=>plan?.currency||quoteOf(it)?.currency||"KRW";
const unitOf=it=>quoteOf(it)?.kind==="코인"||String(it?.ticker||"").trim().toUpperCase()==="BTC-USD"?1e-8:1;
const qtyNum=(v,it)=>(unitOf(it)<1?nf8:nf1).format(v), qtyUnit=it=>unitOf(it)<1?" BTC":"주", qtyText=(v,it)=>`${qtyNum(v,it)}${qtyUnit(it)}`;
const qtyRange=(list,it)=>{const n=list.filter(v=>v>0);if(!n.length)return "";const lo=Math.min(...n),hi=Math.max(...n);return lo===hi?qtyText(lo,it):`${qtyNum(lo,it)}~${qtyText(hi,it)}`;};
const manRange=list=>{const n=list.filter(v=>v>0);if(!n.length)return "";const lo=Math.min(...n),hi=Math.max(...n);return Math.round(lo)===Math.round(hi)?`약 ${man(Math.round(hi))}`:`${nf1.format(Math.round(lo))}~${man(Math.round(hi))}`;};
// 가격 구간 분할(plan.ladder={start,end,count,target?}): 목표 가격이 시작 가격 이상이면 상승(현재가 ≥ 회차 가격이면 도달), 아래면 하락(현재가 ≤ 회차 가격).
const ladderUp=l=>finite(l?.end)>=finite(l?.start);
const ladderStep=l=>finite(l?.count)>1?Math.abs(finite(l.end)-finite(l.start))/(finite(l.count)-1):null;
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
    const cur=planCurrency(plan,it), q=quoteOf(it), now=q&&q.currency===cur?q.close:null, lad=plan.ladder&&finite(plan.ladder.start)>0&&finite(plan.ladder.end)>0?plan.ladder:null, up=ladderUp(lad);
    const pt=v=>priceText(v,cur), priced=stages.some(x=>finite(x.price)!==null);
    const due=x=>now!==null&&lad&&!x.done&&finite(x.price)!==null&&(up?now>=x.price:now<=x.price);
    const next=lad&&now!==null?stages.findIndex(x=>!x.done&&finite(x.price)!==null&&!due(x)):-1, step=ladderStep(lad);
    const each=qtyRange(stages.map(x=>finite(x.shares)||0),it);
    const nowText=now!==null&&(lad||priced)?`현재가 ${pt(now)}<span class="price-date">${escA(q.asOf.slice(5))}</span>${next>=0?` · 다음 ${next+1}차까지 ${up?"+":""}${nf1.format((stages[next].price/now-1)*100)}%`:""}`:"";
    const ladderLine=lad?`<p class="purchase-ladder-line"><b>${up?"상승":"하락"} 분할</b> ${pt(lad.start)} → ${pt(lad.end)} · ${escA(lad.count)}회${step?` · ${pt(step)} ${up?"오를":"내릴"} 때마다`:""}${each?` ${each}씩`:""}</p>`:"";
    return `<section class="card purchase-card"><div class="purchase-head"><div class="title-row"><h2>${escA(it.name)}</h2><button class="btn icon-btn" type="button" data-purchase-edit="${escA(it.id)}" aria-label="${escA(it.name)} 분할매수 계획 수정" title="계획 수정">${PEN}</button></div>
      <p>${escA(g.name)} · 현재 ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)}${s.base>0&&t/100*s.base>v?` · 목표까지 ${man(t/100*s.base-v)}`:""}`:" · 목표 미입력"}</p>
      ${ladderLine}${nowText?`<p class="purchase-now">${nowText}</p>`:""}
      <div class="purchase-progress"><span class="purchase-status${p.count&&p.done===p.count?" done":""}">${status} · ${p.done}/${p.count}회</span><span>예정 ${man(p.planned)} · 체결 ${man(p.actual)} · 남은 예정 ${man(p.remaining)}</span></div></div>
      ${stages.map((stage,i)=>{const price=finite(stage.price),sh=finite(stage.shares),reached=due(stage);
        const main=price!==null?`${pt(price)}${sh!==null?` · ${qtyText(sh,it)}`:""}`:stage.condition||"조건 미입력", sub=price!==null?[stage.condition,stage.date].filter(Boolean).join(" · "):stage.date||"날짜 미정";
        return `<div class="purchase-row${stage.done?" done":reached?" due":""}"><label class="check" title="매수 완료"><input type="checkbox" data-purchase-done="${escA(it.id)}" data-stage="${i}"${stage.done?" checked":""} aria-label="${escA(it.name)} ${i+1}차 매수 완료"><b>${i+1}차</b></label><div class="purchase-condition"><strong>${escA(main)}${reached?`<span class="purchase-due">도달</span>`:""}</strong>${sub?`<small>${escA(sub)}</small>`:""}</div>
        <div class="purchase-amount"><span>예정 ${man(stage.amount)}</span>${stage.done?`<label>체결 <input type="number" min="0" step="any" inputmode="decimal" data-purchase-actual="${escA(it.id)}" data-stage="${i}" value="${finite(stage.actual)??Math.max(0,finite(stage.amount)||0)}" aria-label="${escA(it.name)} ${i+1}차 체결 금액 (만원)"> 만원</label>`:""}</div></div>`;}).join("")}
      ${plan.note?`<p class="purchase-note">${escA(plan.note)}</p>`:""}</section>`;
  };
  view.innerHTML=`<div class="heading"><div><div class="eyebrow">목표 비중과 연결한 매수 계획</div><h1>분할매수</h1><p>회차별 가격·수량·예정액과 체결 기록을 관리합니다. 실제 매수 후 보유 금액·수량은 자산 배분에서 수정하세요.</p></div><button class="btn primary" id="addPurchase" type="button">＋ 계획</button></div>
    <p class="hint purchase-save-status" id="purchaseSaveStatus" role="status"></p>
    <div class="card metrics"><div class="metric"><label>총 매수 예정액</label><strong>${man(totals.planned)}</strong><small>${plans.length}개 종목 · ${summaries.filter(p=>p.count&&p.done===p.count).length}개 매수 완료</small></div><div class="metric"><label>체결 금액</label><strong>${man(totals.actual)}</strong><small>완료한 회차의 실제 금액 합계</small></div><div class="metric"><label>남은 예정액</label><strong>${man(totals.remaining)}</strong><small>아직 매수하지 않은 회차의 예정액</small></div></div>
    ${plans.length?plans.map(card).join(""):emptyCard("아직 분할매수 계획이 없습니다","종목을 고르고 매수 회차를 추가하세요.","")}`;
  updateStatus();
  el("addPurchase").onclick=()=>openPurchase(null);
  all("[data-purchase-edit]").forEach(b=>b.onclick=()=>openPurchase(b.dataset.purchaseEdit));
  onChange("[data-purchase-done]","allocation",(_,x)=>{const stage=findItem(x.dataset.purchaseDone)?.it.buyPlan?.stages?.[Number(x.dataset.stage)];if(!stage)return false;if(x.checked){stage.done=true;if(finite(stage.actual)===null)stage.actual=Math.max(0,finite(stage.amount)||0);}else delete stage.done;});
  onChange("[data-purchase-actual]","allocation",(v,x)=>{const stage=findItem(x.dataset.purchaseActual)?.it.buyPlan?.stages?.[Number(x.dataset.stage)],n=numIn(v);if(!stage||n!==null&&n<0)return false;setNum(stage,"actual",v);});
}
// ---------- 계획 창 ----------
// 종목은 검색 목록에서 고른다(이름·그룹·소분류·종목 코드, 띄어 쓴 낱말이 모두 들어간 종목). 이미 계획이 있는 종목을 고르면 그 계획을 연다. 수정할 때는 종목 고정.
let purchaseDraft=null,editing=null,autoStart="",ladderResult=null;
const form=()=>el("purchaseForm"), pickedItem=()=>findItem(form().item.value);
const draftCurrency=()=>{const it=pickedItem()?.it;return purchaseDraft?.currency||quoteOf(it)?.currency||form().ladderCurrency.value||"KRW";};
function itemInfo({g,it},s){
  const v=s.items.get(it.id)?.value||0,t=finite(it.target);
  return [g.name,it.section,it.ticker,`현재 ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)}`:""}`].filter(Boolean).map(escA).join(" · ");
}
function renderPicker(){
  const s=allocationSummary(doc.allocation,prices), picked=pickedItem(), box=el("purchasePicked");
  box.hidden=!picked;el("purchaseSearchBox").hidden=!!picked;
  if(picked){
    box.innerHTML=`<div><strong>${escA(picked.it.name)}</strong><small>${itemInfo(picked,s)}</small></div>${editing?"":`<button class="btn mini" type="button" id="purchaseRepick">변경</button>`}`;
    if(!editing)el("purchaseRepick").onclick=()=>{form().item.value="";renderPicker();renderLadder();renderPurchaseDraft();el("purchaseSearch").focus();};
    return;
  }
  const query=el("purchaseSearch").value.trim(), terms=query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows=purchaseItems().filter(({g,it})=>{const hay=[it.name,g.name,it.section,it.ticker].filter(Boolean).join(" ").toLowerCase();return terms.every(w=>hay.includes(w));});
  el("purchaseItemList").innerHTML=rows.length?rows.map(r=>`<button type="button" role="option" aria-selected="false" class="purchase-opt" data-pick="${escA(r.it.id)}"><span><strong>${escA(r.it.name)}</strong><small>${itemInfo(r,s)}</small></span>${r.it.buyPlan?`<em>계획 있음</em>`:""}</button>`).join("")
    :`<p class="purchase-none">${query?`‘${escA(query)}’에 맞는 종목이 없습니다.`:"자산 배분에 종목이 없습니다."}</p>`;
  all("[data-pick]").forEach(b=>b.onclick=()=>pickPurchaseItem(b.dataset.pick));
}
function pickPurchaseItem(itemId){
  const found=findItem(itemId);if(!found)return;
  if(found.it.buyPlan){openPurchase(itemId);return;}
  const f=form(),q=quoteOf(found.it);f.item.value=itemId;if(q)delete purchaseDraft.currency; // 시세가 있으면 그 통화(전에 고른 종목의 직접 선택은 버림)
  if(numIn(f.ladderStart.value)===null||f.ladderStart.value===autoStart){autoStart=q?String(q.close):"";f.ladderStart.value=autoStart;}
  renderPicker();renderLadder();renderPurchaseDraft();
}
// 가격 구간 분할 계산: 매수할 금액 = 목표 비중(비우면 종목 목표) × 기준 총자산 − 지금 평가액. 계산은 assets-calc.js purchaseLadder.
// '회차 채우기'는 완료한 회차는 두고 나머지 회차를 계산 결과로 바꾼다(그래서 완료분은 자산 배분 보유량에 먼저 반영해야 함).
function renderLadder(){
  const f=form(), picked=pickedItem(), box=el("ladderResult"), fill=el("ladderFill"), hint=t=>`<p class="hint">${t}</p>`;
  ladderResult=null;fill.disabled=true;
  const it=picked?.it, q=quoteOf(it), cur=draftCurrency(), sym=cur==="USD"?"$":"원";
  all("[data-ladder-cur]").forEach(x=>x.textContent=sym);
  el("ladderCurrencyField").hidden=!picked||!!q;f.ladderCurrency.value=cur;
  f.ladderTarget.placeholder=finite(it?.target)!==null?`${it.target} (종목 목표)`:"예: 3";
  el("ladderStartNote").textContent=q&&q.currency===cur?`현재가 ${priceText(q.close,cur)} · ${q.asOf.slice(5)}`:"";
  if(!picked){box.innerHTML=hint("종목을 먼저 고르세요.");return;}
  const s=allocationSummary(doc.allocation,prices), own=numIn(f.ladderTarget.value), target=own??finite(it.target);
  if(target===null){box.innerHTML=hint("매수 목표 비중을 넣으세요. 종목 목표 비중이 있으면 비워 둬도 됩니다.");return;}
  const value=s.items.get(it.id)?.value||0, goal=target/100*s.base, budget=goal-value, pt=v=>priceText(v,cur);
  const start=numIn(f.ladderStart.value), end=numIn(f.ladderEnd.value), count=numIn(f.ladderCount.value), kept=purchaseDraft.stages.filter(x=>x.done).length;
  const lines=[`목표 ${pc(target)} = <b>${man(goal)}</b> <small>기준 총자산 ${escA(allocationTotalText(s.base)||man(s.base))} 대비${own!==null&&own!==finite(it.target)?" · 이 계획만":""}</small>`,
    `지금 보유 ${man(value)} (${pc(s.pct(value))}) → 매수할 금액 <b>${budget>0?man(budget):"없음"}</b>${budget>0&&cur==="USD"&&s.fx?` <small>≈ ${pt(budget*1e4/s.fx)}</small>`:""}`];
  const r=purchaseLadder({budget,start,end,count,currency:cur,fx:s.fx,unit:unitOf(it)});
  const errors={price:"시작 가격과 목표 가격을 넣으세요.",count:`분할 횟수는 1~${PURCHASE_MAX_STAGES}회로 넣으세요.`,fx:"원/달러 환율이 없어 계산할 수 없습니다. 동기화를 연결하거나 자산 배분의 달러 환율을 넣으세요.",
    budget:"지금 평가액이 목표 이상이라 더 살 금액이 없습니다.",few:`매수할 금액으로 ${qtyText(r.units||0,it)}만 살 수 있어 ${count}회로 나눌 수 없습니다. 분할 횟수를 줄이세요.`};
  if(r.error)lines.push(`<span class="ladder-error">${errors[r.error]}</span>`);
  else{
    const up=end>=start, amounts=r.stages.map(x=>x.amount);
    lines.push(`<b>${up?"상승":"하락"} 분할</b> ${pt(start)} → ${pt(end)} · ${count}회${count>1?` · ${pt(Math.abs(r.step))} ${up?"오를":"내릴"} 때마다`:""} <b>${qtyRange(r.stages.map(x=>x.shares),it)}씩</b> <small>회당 ${manRange(amounts)}</small>`);
    lines.push(`합계 ${qtyText(r.shares,it)} · ${pt(r.cost)}${cur==="USD"?` ≈ ${man(r.amount)}`:""} <small>남는 금액 ${pt(Math.max(0,r.money-r.cost))}</small>`);
    if(kept)lines.push(`<small>완료한 ${kept}회는 그대로 두고 나머지 회차를 바꿉니다. 매수한 수량을 자산 배분 보유량에 먼저 반영하세요.</small>`);
    ladderResult={stages:r.stages,ladder:{start,end,count,...(own!==null?{target:own}:{})},cur};fill.disabled=false;
  }
  box.innerHTML=lines.map(l=>`<p>${l}</p>`).join("");
  fill.textContent=kept?"남은 회차 바꾸기":"회차 채우기";
}
function fillLadder(){
  if(!ladderResult)return;
  const rest=purchaseDraft.stages.filter(x=>!x.done), used=rest.some(x=>x.date||x.condition||finite(x.amount)!==null||finite(x.price)!==null||finite(x.shares)!==null);
  if(used&&!confirm(`아직 매수하지 않은 ${rest.length}개 회차를 새 계산으로 바꿀까요?`))return;
  purchaseDraft.stages=[...purchaseDraft.stages.filter(x=>x.done),...ladderResult.stages.map(x=>({id:newId(),...x}))];
  purchaseDraft.ladder=ladderResult.ladder;
  if(ladderResult.cur==="USD")purchaseDraft.currency="USD";else delete purchaseDraft.currency;
  renderPurchaseDraft();renderLadder();
}
function renderPurchaseDraft(){
  const stages=purchaseDraft.stages, it=pickedItem()?.it, cur=draftCurrency(), unit=unitOf(it);
  el("purchaseStageRows").innerHTML=stages.map((stage,i)=>`<div class="purchase-stage${stage.done?" done":""}"><b>${i+1}차${stage.done?`<small>매수 완료</small>`:""}</b>
    <label>매수 가격 (${cur==="USD"?"$":"원"})<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="price" data-stage="${i}" value="${finite(stage.price)??""}"></label>
    <label>수량 (${qtyUnit(it).trim()})<input type="number" min="0" step="${unit<1?"any":"1"}" inputmode="decimal" data-purchase-field="shares" data-stage="${i}" value="${finite(stage.shares)??""}"></label>
    <label>예정액 (만원)<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="amount" data-stage="${i}" value="${finite(stage.amount)??""}"></label>
    <button class="btn mini ghost" type="button" data-purchase-remove="${i}" aria-label="${i+1}차 회차 삭제">삭제</button>
    <label class="date-field">매수 예정일<input type="date" data-purchase-field="date" data-stage="${i}" value="${escA(stage.date||"")}"></label>
    <label class="condition-field">매수 조건<input maxlength="100" placeholder="예: 기준가 도달" data-purchase-field="condition" data-stage="${i}" value="${escA(stage.condition||"")}"></label>
    ${stage.done?`<label class="actual-field">체결액 (만원)<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="actual" data-stage="${i}" value="${finite(stage.actual)??""}"></label>`:""}</div>`).join("");
  // 가격·수량을 고치면 예정액 = 가격 × 수량(달러는 × 지금 환율)으로 맞춘다. 예정액만 따로 고쳐도 된다.
  all("[data-purchase-field]").forEach(x=>x.oninput=()=>{const i=Number(x.dataset.stage),stage=stages[i],key=x.dataset.purchaseField;
    if(["amount","actual","price","shares"].includes(key))setNum(stage,key,x.value);else setText(stage,key,x.value);
    const rate=draftCurrency()==="USD"?assetFx(prices,doc.allocation):1;
    if((key==="price"||key==="shares")&&finite(stage.price)!==null&&finite(stage.shares)!==null&&rate){stage.amount=Math.round(stage.price*stage.shares*rate/100)/100;const a=el("purchaseStageRows").querySelector(`[data-purchase-field=amount][data-stage="${i}"]`);if(a)a.value=stage.amount;}
  });
  all("[data-purchase-remove]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.purchaseRemove);if(stages[i].done&&!confirm(`${i+1}차의 완료 기록과 체결 금액도 삭제할까요?`))return;stages.splice(i,1);renderPurchaseDraft();renderLadder();});
}
function openPurchase(id){
  const found=id?findItem(id):null,f=form(),d=dlg("purchaseDialog");
  if(!found&&purchaseItems().every(({it})=>it.buyPlan)){alert("모든 종목에 분할매수 계획이 있습니다. 종목 이름 옆 연필로 기존 계획을 수정하세요.");return;}
  editing=found;ladderResult=null;
  el("purchaseTitle").textContent=found?"분할매수 계획 수정":"새 분할매수 계획";
  f.item.value=found?.it.id||"";el("purchaseSearch").value="";
  purchaseDraft=found?.it.buyPlan?JSON.parse(JSON.stringify(found.it.buyPlan)):{stages:Array.from({length:3},()=>({id:newId()}))};
  if(!Array.isArray(purchaseDraft.stages))purchaseDraft.stages=[];
  const lad=purchaseDraft.ladder,q=quoteOf(found?.it);
  f.ladderTarget.value=finite(lad?.target)??"";f.ladderEnd.value=finite(lad?.end)??"";f.ladderCount.value=finite(lad?.count)??5;
  autoStart=!lad&&q?String(q.close):"";f.ladderStart.value=finite(lad?.start)??autoStart;
  f.ladderCurrency.value=purchaseDraft.currency||"KRW";
  el("purchaseLadder").open=!found||!!lad;
  f.note.value=purchaseDraft.note||"";renderPicker();renderLadder();renderPurchaseDraft();
  el("addPurchaseStage").onclick=()=>{purchaseDraft.stages.push({id:newId()});renderPurchaseDraft();};
  el("purchaseDelete").hidden=!found;
  el("purchaseDelete").onclick=()=>{if(!confirm(`'${found.it.name}' 분할매수 계획과 체결 기록을 삭제할까요?`))return;delete found.it.buyPlan;saveSection("allocation");d.close();render();};
  f.onsubmit=e=>{e.preventDefault();const item=pickedItem()?.it;if(!item){alert("분할매수할 종목을 고르세요.");el("purchaseSearch").focus();return;}if(!purchaseDraft.stages.length){alert("매수 회차를 하나 이상 추가하세요.");return;}
    if(draftCurrency()==="USD"&&(purchaseDraft.ladder||purchaseDraft.stages.some(x=>finite(x.price)!==null)))purchaseDraft.currency="USD";else delete purchaseDraft.currency;
    setText(purchaseDraft,"note",f.note.value);item.buyPlan=purchaseDraft;saveSection("allocation");d.close();render();};
  if(!d.open)d.showModal();
  if(!found&&matchMedia("(hover:hover) and (pointer:fine)").matches)el("purchaseSearch").focus();
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
  const search=el("purchaseSearch"),f=form();
  search.oninput=()=>renderPicker();
  search.onkeydown=e=>{const first=el("purchaseItemList").querySelector("[data-pick]");
    if(e.key==="Enter"){e.preventDefault();if(first)pickPurchaseItem(first.dataset.pick);}else if(e.key==="ArrowDown"&&first){e.preventDefault();first.focus();}};
  el("purchaseItemList").onkeydown=e=>{const b=e.target.closest?.("[data-pick]");if(!b||!["ArrowDown","ArrowUp"].includes(e.key))return;e.preventDefault();
    const next=e.key==="ArrowDown"?b.nextElementSibling:b.previousElementSibling;(next||(e.key==="ArrowUp"?search:null))?.focus();};
  for(const name of ["ladderTarget","ladderStart","ladderEnd","ladderCount"]){f[name].oninput=()=>renderLadder();f[name].onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();fillLadder();}};}
  f.ladderCurrency.onchange=()=>{if(f.ladderCurrency.value==="USD")purchaseDraft.currency="USD";else delete purchaseDraft.currency;renderLadder();renderPurchaseDraft();};
  el("ladderFill").onclick=fillLadder;
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
