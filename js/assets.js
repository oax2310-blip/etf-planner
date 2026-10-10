// 자산 현황 화면. 기능 규칙은 해당 함수 주석, 계산·기록은 assets-calc.js·assets-store.js, 공통 작업 규칙은 AGENTS.md.
const A_UI_KEY = "etf-planner-assets-ui";
const A_STALE_DAYS = 3; // 시세 기준일이 이보다 오래되면 ‘갱신 필요’ 배지(js/prices.js PRICE_STALE_DAYS와 같음)
const el = id => document.getElementById(id), all = sel => document.querySelectorAll(sel);
const escA = v => String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
const noteLineA = v => escA(String(v ?? "").replace(/\s+/g," ").trim());
const nf0 = new Intl.NumberFormat("ko-KR",{maximumFractionDigits:0}), nf1 = new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}), nf2 = new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}), nfShares = new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
const man = v => `${nf1.format(Math.round((Number(v)||0)*10)/10)}만원`;
const wonA = v => `${nf0.format(Math.round(Number(v)||0))}원`;
const pc = v => v===null||v===undefined||!Number.isFinite(Number(v)) ? "—" : `${(Math.abs(v)<1?nf2:nf1).format(Number(v))}%`;
// 원 → '2억 1,615만원'(만원 아래 반올림)
function eok(v){ if(v===null||v===undefined||!Number.isFinite(Number(v)))return "—"; const m=Math.round(Math.abs(v)/1e4), s=v<0?"−":"";
  if(m>=1e4){const e=Math.floor(m/1e4),r=m%1e4;return `${s}${nf0.format(e)}억${r?` ${nf0.format(r)}만원`:"원"}`;} return m?`${s}${nf0.format(m)}만원`:wonA(v); }
const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const newId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const numIn = v => { const s=String(v??"").trim(); return s===""?null:finite(s); };

let doc=assetStore.doc, prices=assetStore.prices;
// 고른 탭·연도·시나리오는 이 기기 etf-planner-assets-ui에만 저장하고 동기화하지 않는다.
const ui = {tab:"alloc", year:null, scenario:null, ...readJson(A_UI_KEY, {})};
const setUi = patch => { Object.assign(ui, patch); writeJson(A_UI_KEY, ui); };
// 바꾼 구역의 savedAt을 새로 찍고 저장 → 잠시 뒤 동기화
function saveSection(section){assetStore.saveSection(section);}

// ---------- 탭 ----------
const TABS = ["strategy","alloc","ledger","savings"];
function openTab(tab){ if(!TABS.includes(tab)) tab="alloc"; setUi({tab}); all(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab)); TABS.forEach(t=>el(t+"View").classList.toggle("hidden",t!==tab)); render(); }
all(".tab").forEach(b=>b.addEventListener("click",()=>{ openTab(b.dataset.tab); history.replaceState(null,"",`#${ui.tab}`); scrollTo(0,0); }));
addEventListener("hashchange",()=>{if(location.hash==="#buys")location.replace("index.html#buys");else openTab(location.hash.slice(1));});
function render(){ if(ui.tab==="alloc"||ui.tab==="strategy") renderAlloc(ui.tab); if(ui.tab==="ledger") renderLedger(); if(ui.tab==="savings") renderSavings(); }
// 시세·동기화로 다시 그릴 때 입력 중인 칸이 있으면 미룬다(쓰던 값이 지워지지 않게)
let redrawLater = false;
function redrawIdle(){ const a=document.activeElement; if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!a.closest("dialog")){ redrawLater=true; return; } redrawLater=false; render(); }
document.addEventListener("focusout",()=>setTimeout(()=>{ if(redrawLater) redrawIdle(); },0));
// 칸 공통: 바뀌면 set(값, 칸) → false가 아니면 저장 → 다시 그림
const onChange = (sel, section, set) => all(sel).forEach(x=>x.onchange=()=>{ if(set(x.value,x)!==false) saveSection(section); render(); });
function emptyCard(title, text, button){ return `<div class="card empty assets-empty"><h2>${title}</h2><p>${text}</p>${button}</div>`; }
const priceDays = asOf => { const [y,m,d]=String(asOf).split("-").map(Number), n=new Date(); return Math.round((Date.UTC(n.getFullYear(),n.getMonth(),n.getDate())-Date.UTC(y,m-1,d))/864e5); };
function quoteText(q,current=false){
  if(!q)return "";
  const days=q.asOf?priceDays(q.asOf):NaN, status=q.stale?"갱신 실패":!Number.isFinite(days)||days>A_STALE_DAYS?"갱신 필요":"";
  const detail=q.stale?"시세 갱신에 실패해 이전 가격을 표시합니다.":Number.isFinite(days)?`시세가 ${A_STALE_DAYS}일 넘게 갱신되지 않았습니다.`:"시세 기준일을 확인할 수 없습니다.";
  return `${q.currency==="USD"?`$${nf2.format(q.close)}`:wonA(q.close)}${current?'<span class="quote-label">(현재가)</span>':""}${q.manual?' <span class="quote-source">직접 입력</span>':""}${status?` <span class="quote-status" title="${escA(detail+(q.asOf?` 마지막 시세: ${q.asOf}`:""))}"><span aria-hidden="true">!</span> ${status}</span>`:""}`;
}

// ---------- 자산 배분 ----------
// 검색(이름·티커·실제 ETF 코드·그룹·소분류)은 메모리에만 두고 화면 목록만 거른다. 입력칸을 다시 만들지 않아 한글 조합·포커스를 유지하며 기록·합계는 바꾸지 않는다.
let allocQuery = "";
// 그룹·현금·메모는 기본 접기. 펼침은 현재 화면 메모리에만 두며 다시 그려도 유지하고, 새로 열면 접는다.
const allocOpenCards = new Set();
function setAllocCardOpen(button,open){
  const body=el(button.getAttribute("aria-controls"));if(!body)return;
  body.hidden=!open;button.setAttribute("aria-expanded",String(open));
  const action=open?"접기":"펼치기";
  button.querySelector("[data-alloc-fold-action]").textContent=action;
  button.setAttribute("aria-label",`${button.dataset.foldLabel} ${action}`);
}
const allocSearchText = v => String(v??"").normalize("NFKC").toLowerCase().replace(/\s+/g,"");
function filterAllocItems(){
  const input=el("allocSearch"), list=el("allocItems"); if(!input||!list)return;
  allocQuery=input.value;
  const terms=allocQuery.normalize("NFKC").trim().split(/\s+/).filter(Boolean).map(allocSearchText), matches=new Set();
  let count=0;
  for(const g of doc.allocation.groups)for(const it of g.items){
    count++;
    const hay=[it.name,it.ticker,it.tradeTicker,g.name,it.section].map(allocSearchText);
    if(terms.every(term=>hay.some(text=>text.includes(term))))matches.add(it.id);
  }
  list.querySelectorAll("[data-alloc-item]").forEach(row=>row.classList.toggle("hidden",!matches.has(row.dataset.allocItem)));
  list.querySelectorAll(".asset-section, .group-card, .alloc-class").forEach(box=>box.classList.toggle("hidden",!!terms.length&&!box.querySelector(".asset-row:not(.hidden)")));
  // 검색 중에는 일치한 그룹을 펼쳐 종목을 보여 주고, 검색을 비우면 직접 고른 접힘 상태로 돌아간다.
  list.querySelectorAll("[data-alloc-fold]").forEach(button=>setAllocCardOpen(button,terms.length?!button.closest(".group-card").classList.contains("hidden"):allocOpenCards.has(button.dataset.allocFold)));
  el("allocSearchStatus").textContent=terms.length?`검색 결과 ${matches.size} / ${count}개 종목`:`전체 ${count}개 종목`;
  el("allocSearchClear").classList.toggle("hidden",!allocQuery);
  el("allocSearchEmpty").classList.toggle("hidden",!terms.length||matches.size>0);
}
// 투자구성은 지역·큰 분류 합계, 자산 배분은 그룹별 종목·현금. 큰 분류(classes) → 그룹(groups) → 종목(items, 소분류 section은 그룹 안 작은 제목).
function renderAlloc(tab="alloc"){
  const a=doc.allocation, view=el(tab+"View"), strategy=tab==="strategy";
  el((strategy?"alloc":"strategy")+"View").innerHTML=""; // 같은 입력칸 id가 두 화면에 남지 않게
  if(!a){ view.innerHTML=emptyCard("자산 배분 기록이 없습니다","데이터 저장소에 etf-planner-assets.json이 있으면 동기화할 때 불러옵니다. 동기화 창의 JSON 복원으로 넣거나 새로 시작할 수 있습니다.",`<button class="btn primary" id="startAlloc" type="button">새로 시작</button>`);
    el("startAlloc").onclick=()=>{ doc.allocation={savedAt:"",total:null,cashFx:null,memo:"",classes:[{id:newId(),region:"미국",name:"주식"},{id:newId(),region:"국내",name:"주식"},{id:newId(),region:"해외",name:"중국"},{id:newId(),region:"현금",name:"현금",cash:true}],groups:[],cash:[]}; saveSection("allocation"); render(); }; return; }
  const s=allocationSummary(a,prices), rows=[...s.items.values()], live=rows.filter(r=>r.how!=="amount").length, count=rows.length, reviewed=a.groups.some(g=>g.items.some(it=>it.done));
  const cashPct=pc(s.pct(s.cash));
  const usd=a.cash.filter(c=>c.currency==="USD").reduce((t,c)=>t+(finite(c.amount)||0)*(c.minus?-1:1),0);
  const fxNote=s.fx?`달러 환율 ${nf2.format(s.fx)}원${plus(prices?.fx?.close)?` (현물 ${Number(prices.fx.asOf?.slice(5,7))}/${Number(prices.fx.asOf?.slice(8))})`:" (직접 넣은 값)"}`:"달러 환율 없음";
  const gap=(t,v)=>{ if(finite(t)===null)return ""; const d=t/100*s.base-v; return Math.abs(d)<.5?`<span class="gap ok">목표 도달</span>`:d>0?`<span class="gap up">목표까지 +${man(d)}</span>`:`<span class="gap over">목표 초과 ${man(-d)}</span>`; };
  const bar=(cur,t)=>{ const top=Math.max(cur,finite(t)||0,.01); return `<span class="bar" aria-hidden="true"><i style="width:${Math.min(100,cur/top*100)}%"></i>${finite(t)!==null?`<em style="left:${Math.min(100,t/top*100)}%"></em>`:""}</span>`; };
  const foldButton=(key,id,label,title)=>{const open=allocOpenCards.has(key);return `<button class="alloc-fold" type="button" data-alloc-fold="${escA(key)}" data-fold-label="${escA(label)}" aria-expanded="${open}" aria-controls="${escA(id)}" aria-label="${escA(label)} ${open?"접기":"펼치기"}">${title}<span class="alloc-fold-action" data-alloc-fold-action>${open?"접기":"펼치기"}</span></button>`;};
  const classLabels=new Map(s.regions.flatMap(r=>r.classes.map(c=>[c.id,`${r.name} · ${c.name}`])));
  const regionCards=s.regions.map(r=>`<div class="card region-card"><div class="region-head"><h3>${escA(r.name)}</h3><b>${man(r.value)}</b><span>${pc(s.pct(r.value))}${r.target!==null?` <small>/ 목표 ${pc(r.target)}</small>`:""}</span></div>
    ${r.classes.map(c=>{const v=s.classes.get(c.id)||0,cur=s.pct(v),t=s.targets.classes.get(c.id);return `<button class="class-row" type="button" data-class="${escA(c.id)}"><span class="class-name">${escA(c.name)}${c.cash?` <small>현금</small>`:""}</span><span class="class-val">${man(v)}</span><span class="class-pct">${pc(cur)}<small>${t.target!==null?`목표 ${pc(t.target)}${t.linked?" · 합산":""}`:"목표 없음"}</small></span>${bar(cur,t.target)}${gap(t.target,v)}</button>`;}).join("")}</div>`).join("");
  const itemRow=it=>{ const r=s.items.get(it.id), cur=s.pct(r.value), t=finite(it.target), stock=prices?.stocks?.[assetTradeTicker(it)];
    const how=r.how==="shares"?`<small class="how holding">${nfShares.format(it.shares)}주${r.q?` × <span class="holding-price">${quoteText(r.q,true)}</span>`:""}</small>`:r.how==="ratio"?`<small class="how live">입력 ${man(it.amount)} ${r.value>=it.amount?"+":"−"}${pc(Math.abs(r.value/it.amount-1)*100)}</small>`:it.ticker&&prices?stock?.error?'<small class="how quote-status"><span aria-hidden="true">!</span> 시세 조회 실패</small>':'<small class="how">시세 대기</small>':"";
    return `<div class="asset-row${it.done?" done":""}" data-alloc-item="${escA(it.id)}"><label class="check" title="점검완료 · 직접 표시, 계산에 영향 없음"><input type="checkbox" data-done="${escA(it.id)}"${it.done?" checked":""} aria-label="${escA(it.name)} 점검완료 (직접 표시)"></label>
      <button class="asset-name" type="button" data-item="${escA(it.id)}"><strong>${escA(it.name)}</strong><small>${[tracksETF(it)?`기준 ${escA(String(it.ticker).toUpperCase())} → 매수 ${escA(assetTradeTicker(it))}`:it.ticker&&String(it.ticker).toUpperCase()!==String(it.name).trim().toUpperCase()?escA(String(it.ticker).toUpperCase()):"",r.how!=="shares"?quoteText(r.q):"",r.how!=="shares"&&finite(it.shares)!==null?`${nfShares.format(it.shares)}주`:""].filter(Boolean).join(" · ")}</small></button>
      <span class="asset-val">${man(r.value)}${how}</span><span class="asset-pct"><span>현재 ${pc(cur)}</span>${t!==null?`<small>목표 ${pc(t)}</small>`:""}</span>
      ${it.note?`<p class="asset-note" title="${escA(it.note)}"><span class="alloc-note-label">메모</span>${noteLineA(it.note)}</p>`:""}</div>`; };
  const groupCard=g=>{ const v=s.groups.get(g.id)||0, target=s.targets.groups.get(g.id),t=target.target, plain=g.items.filter(it=>!it.section), names=[...new Set([...(g.sections||[]).map(x=>x.name),...g.items.map(it=>it.section).filter(Boolean)])];
    const sec=name=>{const meta=(g.sections||[]).find(x=>x.name===name)||{},sv=s.section(g.id,name),st=s.targets.section(g.id,name);return `<div class="sub-head"><b>${escA(name)}</b><span>${man(sv)} · ${pc(s.pct(sv))}${st.target!==null?` / 목표 ${pc(st.target)}${st.linked?" · 종목 합산":""}`:""}</span>${meta.note?`<small title="${escA(meta.note)}">${noteLineA(meta.note)}</small>`:""}</div>`;};
    const key=`group:${g.id}`,bodyId=`allocGroup-${encodeURIComponent(g.id)}`;
    return `<section class="card group-card"><div class="group-head"><div class="title-row"><h3>${foldButton(key,bodyId,`${g.name} 상세`,`<span>${escA(g.name)}</span>`)}</h3><button class="btn icon-btn" type="button" data-group="${escA(g.id)}" aria-label="${escA(g.name)} 그룹 수정" title="그룹 수정">${PEN}</button></div>
      <p><b>${man(v)}</b> · ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)} (${man(t/100*s.base)})${target.linked?" · 하위 합산":""}`:""} ${gap(t,v)}</p></div>
      <div class="alloc-fold-body" id="${escA(bodyId)}"${allocOpenCards.has(key)?"":" hidden"}>
      ${g.note?`<p class="group-note" title="${escA(g.note)}"><span class="alloc-note-label">메모</span>${noteLineA(g.note)}</p>`:""}
      ${plain.map(itemRow).join("")}${names.map(n=>`<div class="asset-section">${sec(n)}${g.items.filter(it=>it.section===n).map(itemRow).join("")}</div>`).join("")}
      ${g.items.length?"":`<p class="group-empty">종목 없음</p>`}<div class="group-foot"><button class="btn mini ghost" type="button" data-add-item="${escA(g.id)}">＋ 종목</button></div></div></section>`; };
  // 종목별 목록은 저장된 그룹 순서를 그대로 따른다. 연속한 같은 분류만 묶고, 지역·분류별로 다시 정렬하거나 기록을 바꾸지 않는다.
  const detailBlocks=[];
  for(const g of a.groups){
    const prev=detailBlocks[detailBlocks.length-1];
    if(prev&&prev.classId===g.classId)prev.groups.push(g);
    else detailBlocks.push({classId:g.classId,label:classLabels.get(g.classId)||"분류 없음",groups:[g]});
  }
  const detail=detailBlocks.map(b=>`<div class="alloc-class"><div class="class-label">${escA(b.label)}</div>${b.groups.map(groupCard).join("")}</div>`).join("");
  const cashRows=a.cash.map(c=>`<button class="cash-row" type="button" data-cash="${escA(c.id)}"><span class="cash-place">${escA(c.place||"")}</span><strong>${escA(c.name)}${c.minus?` <small>차감</small>`:""}</strong><span class="cash-amt">${c.currency==="USD"?`$${nf2.format(finite(c.amount)||0)}`:wonA(c.amount)}</span><b>${c.minus?"−":""}${man(Math.abs(cashValue(c,s.fx)))}</b></button>`).join("");
  const totalText=allocationTotalText(a.total), totalPlaceholder=allocationTotalText(s.grand), totalWidth=v=>`${Math.max(3,v.replace(/[억만원]/g,"00").length)+.6}ch`;
  view.innerHTML=`<div class="heading"><div><div class="eyebrow">${strategy?"지역과 자산군별 배분":"종목과 현금"}</div><h1>${strategy?"투자구성":"자산 배분"}</h1><p>${strategy?"지역·자산 분류별 현재 비중과 목표를 한눈에 확인합니다. 목표 비중은 종목별에서 수정하면 소분류·그룹·분류에 자동 합산됩니다.":"금액은 만원 단위, 비중은 기준 총자산 대비입니다. 종목 이름을 눌러 목표를 수정하세요. 체크는 점검을 끝냈다는 직접 표시입니다."}</p></div></div>
    <div class="card metrics"><div class="metric"><label for="allocTotal">기준 총자산 (비중 기준)</label><label class="metric-edit"><input id="allocTotal" type="text" enterkeyhint="done" autocomplete="off" spellcheck="false" value="${totalText}" placeholder="${totalPlaceholder}" aria-describedby="allocTotalHint" style="width:${totalWidth(totalText||totalPlaceholder)}">${PEN}</label><small id="allocTotalHint">억·만원으로 입력 · 숫자만 넣으면 만원</small><small>종목 + 현금 합계 ${man(s.grand)}${plus(a.total)?` · 차이 ${s.grand>=a.total?"+":"−"}${man(Math.abs(s.grand-a.total))}`:" · 비우면 합계 기준"}</small></div>
      <div class="metric"><label>투자 평가액</label><strong>${man(s.invest)}</strong><small>시세 반영 ${live} / ${count}개 종목${prices?.updatedAt?` · 시세 파일 ${new Date(prices.updatedAt).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}`:""}</small></div>
      <div class="metric"><label>현금</label><strong class="cash-value"><span>${man(s.cash)}</span><span class="cash-pct" title="기준 총자산 대비 비중">(${cashPct})</span></strong><small>${usd?`달러 $${nf2.format(usd)} · `:""}${fxNote}</small></div></div>
    ${strategy?`<div class="section-heading"><h2>배분 개요</h2><span>지역별 합계와 목표 · 목표 합계 ${pc(s.regions.some(r=>r.target!==null)?s.regions.reduce((n,r)=>n+(r.target??0),0):null)}</span><button class="btn mini" type="button" id="addClass">＋ 분류</button></div>
    <div class="region-grid">${regionCards||`<div class="card empty">분류가 없습니다</div>`}</div>
    <p class="footnote">모든 목표 비중은 기준 총자산 대비입니다. 하위 목표가 하나라도 있으면 그 합계를 쓰고, 전부 비어 있으면 직접 입력한 목표를 씁니다. 목표 없는 종목 ${a.groups.reduce((n,g)=>n+g.items.filter(it=>finite(it.target)===null).length,0)}개.</p>`:`<div class="section-heading"><h2>종목별</h2><span>그룹 ${a.groups.length}개 · 종목 ${count}개</span><div class="alloc-actions"><button class="btn mini" type="button" id="clearAllocDone" title="검색 결과와 관계없이 모든 종목의 점검완료를 해제합니다."${reviewed?"":" disabled"}>점검완료 일괄해제</button><button class="btn mini" type="button" id="addGroup">＋ 그룹</button></div></div>
    <div class="alloc-search"><label class="field"><span>종목 검색</span><input id="allocSearch" type="search" value="${escA(allocQuery)}" placeholder="종목명 · 코드 · 그룹 · 소분류" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-controls="allocItems" aria-describedby="allocSearchStatus"></label><button class="btn hidden" id="allocSearchClear" type="button">초기화</button><p class="hint" id="allocSearchStatus" role="status" aria-live="polite" aria-atomic="true"></p></div>
    <div id="allocItems">${detail||`<div class="card empty">그룹이 없습니다</div>`}</div>
    <div class="card empty assets-empty hidden" id="allocSearchEmpty"><h2>검색 결과가 없습니다</h2><p>종목명이나 코드를 확인하거나 검색어를 줄여보세요.</p></div>
    <div class="section-heading"><h2>현금</h2><span>${fxNote}</span><button class="btn mini" type="button" id="addCash">＋ 현금</button></div>
    <section class="card cash-card"><div class="cash-total">${foldButton("cash","allocCashBody","현금 상세",`<span>합계</span><b><span>${man(s.cash)}</span><small class="cash-pct" title="기준 총자산 대비 비중">(${cashPct})</small></b>`)}</div><div class="alloc-fold-body" id="allocCashBody"${allocOpenCards.has("cash")?"":" hidden"}>${cashRows||`<p class="group-empty">현금 항목 없음</p>`}</div></section>`}
    <section class="card panel memo assets-memo"><div class="memo-head"><h2>${strategy?'<label for="allocMemo">배분 메모</label>':foldButton("memo","allocMemoBody","배분 메모","<span>배분 메모</span>")}</h2></div><div class="alloc-fold-body" id="allocMemoBody"${strategy||allocOpenCards.has("memo")?"":" hidden"}><textarea id="allocMemo" aria-label="배분 메모" maxlength="4000">${escA(a.memo||"")}</textarea></div></section>`;
  view.querySelectorAll("[data-alloc-fold]").forEach(button=>{
    // 입력 저장으로 화면이 다시 그려져 클릭이 사라지지 않게, 접힘을 먼저 바꾼 뒤 포커스를 옮긴다.
    button.onpointerdown=e=>{if(e.button===0)e.preventDefault();};
    button.onclick=()=>{
      const open=button.getAttribute("aria-expanded")!=="true",key=button.dataset.allocFold;
      if(open)allocOpenCards.add(key);else allocOpenCards.delete(key);
      setAllocCardOpen(button,open);
      if(document.activeElement!==button)document.activeElement?.blur();
      [...view.querySelectorAll("[data-alloc-fold]")].find(b=>b.dataset.allocFold===key)?.focus({preventScroll:true});
    };
  });
  const totalInput=el("allocTotal");
  totalInput.oninput=()=>{totalInput.setCustomValidity("");totalInput.style.width=totalWidth(totalInput.value||totalPlaceholder);};
  totalInput.onchange=()=>{const n=parseAllocationTotal(totalInput.value);
    if(Number.isNaN(n)){totalInput.setCustomValidity("0 이상의 금액을 억·만원 단위로 입력하세요. 숫자만 넣으면 만원입니다.");totalInput.reportValidity();return;}
    const next=plus(n);if(next!==(doc.allocation.total??null)){doc.allocation.total=next;saveSection("allocation");}render();};
  totalInput.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();totalInput.blur();}if(e.key==="Escape"){e.preventDefault();render();}};
  onChange("#allocMemo","allocation",v=>{a.memo=v;});
  onChange("[data-done]","allocation",(v,x)=>{const it=findItem(x.dataset.done)?.it;if(!it)return false;if(x.checked)it.done=true;else delete it.done;});
  // 검색 결과와 관계없이 모든 그룹의 점검완료만 해제하고, 바뀐 기록이 있을 때 한 번 저장한다.
  const clearDone=el("clearAllocDone");
  if(clearDone)clearDone.onclick=()=>{
    let changed=false;
    for(const g of doc.allocation?.groups||[])for(const it of g.items)if(it.done){delete it.done;changed=true;}
    if(changed){saveSection("allocation");render();}
  };
  all("[data-item]").forEach(b=>b.onclick=()=>openItem(b.dataset.item));
  all("[data-add-item]").forEach(b=>b.onclick=()=>openItem(null,b.dataset.addItem));
  all("[data-group]").forEach(b=>b.onclick=()=>openGroup(b.dataset.group));
  all("[data-class]").forEach(b=>b.onclick=()=>openClass(b.dataset.class));
  all("[data-cash]").forEach(b=>b.onclick=()=>openCash(b.dataset.cash));
  if(el("addGroup"))el("addGroup").onclick=()=>openGroup(null); if(el("addClass"))el("addClass").onclick=()=>openClass(null); if(el("addCash"))el("addCash").onclick=()=>openCash(null);
  const search=el("allocSearch");
  if(search){
    const clear=()=>{search.value="";filterAllocItems();search.focus();};
    search.oninput=filterAllocItems;
    search.onkeydown=e=>{if(e.key==="Escape"&&!e.isComposing){e.preventDefault();clear();}};
    el("allocSearchClear").onclick=clear;
    filterAllocItems();
  }
}
function findItem(id){ for(const g of doc.allocation?.groups||[]){ const it=g.items.find(x=>x.id===id); if(it) return {g,it}; } return null; }
const dlg = id => el(id);
all("dialog [data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
const setNum = (obj, key, v) => { const n=numIn(v); if(n===null) delete obj[key]; else obj[key]=n; };
const setText = (obj, key, v) => { const t=String(v??"").trim(); if(t) obj[key]=t; else delete obj[key]; };
function openItem(id, groupId){
  const a=doc.allocation, found=id?findItem(id):null, it=found?.it||{}, f=el("itemForm");
  el("itemTitle").textContent=found?"종목 수정":"새 종목";
  f.group.innerHTML=a.groups.map(g=>`<option value="${escA(g.id)}">${escA(g.name)}</option>`).join("");
  f.group.value=found?.g.id||groupId||a.groups[0]?.id||"";
  const fillSections=()=>{const g=a.groups.find(x=>x.id===f.group.value);el("sectionList").innerHTML=[...new Set([...(g?.sections||[]).map(x=>x.name),...(g?.items||[]).map(x=>x.section).filter(Boolean)])].map(n=>`<option value="${escA(n)}">`).join("");};
  f.group.onchange=fillSections; fillSections();
  f.name.value=it.name||""; f.section.value=it.section||""; f.amount.value=it.amount??""; f.ticker.value=it.ticker||""; f.shares.value=it.shares??""; f.target.value=it.target??""; f.done.checked=!!it.done; f.note.value=it.note||"";
  f.tradeTicker.value=it.tradeTicker||"";f.tradePrice.value=it.tradePrice??"";
  const tradePriceInfo=()=>{const draft={tradeTicker:f.tradeTicker.value,ticker:f.ticker.value,tradePrice:numIn(f.tradePrice.value),tradePriceAt:it.tradePriceAt},q=assetTradeQuote(prices,draft),usd=purchaseQuoteKind(f.tradeTicker.value)==="해외";
    const target=el("itemPurchaseTarget");target.hidden=!tracksETF(draft);target.textContent=`매수 반영 대상 · 자산 배분 › ${a.groups.find(g=>g.id===f.group.value)?.name||"그룹 선택"} › ${f.name.value.trim()||"종목 이름 입력"}${numIn(f.shares.value)!==null?` · 현재 보유 ${nf2.format(numIn(f.shares.value))}주`:""}`;
    el("itemTradePriceLabel").textContent=`매수 ETF 현재가 (${usd?"달러":"원"} · 시세 없을 때)`;
    el("itemTradePriceNote").textContent=q&&!q.manual?`자동 시세 ${q.currency==="USD"?`$${nf2.format(q.close)}`:wonA(q.close)} · ${q.asOf} 기준${q.stale?" · 마지막 조회 실패":""}. 직접 입력보다 우선 사용합니다.`:"자동 시세가 없으면 직접 입력한 가격으로 주수·평가액을 계산합니다.";};
  let priceTicker=f.tradeTicker.value.trim().toUpperCase();
  f.tradeTicker.oninput=()=>{const next=f.tradeTicker.value.trim().toUpperCase();if(next!==priceTicker){f.tradePrice.value="";priceTicker=next;}tradePriceInfo();};f.ticker.oninput=tradePriceInfo;tradePriceInfo();
  f.group.onchange=()=>{fillSections();tradePriceInfo();};f.name.oninput=tradePriceInfo;f.shares.oninput=tradePriceInfo;
  // 플래너에서 체크로 반영한 체결(allocation.trades — 규칙은 assets-calc.js '플래너 체결 → 자산 배분 연동'): 이 종목에 더하거나 뺀 양. 체크를 풀면 플래너가 되돌린다.
  const trades=Object.values(a.trades&&typeof a.trades==="object"?a.trades:{}).flatMap(t=>(Array.isArray(t?.items)?t.items:[]).filter(e=>found&&e.id===it.id).map(e=>({t,e}))).sort((x,y)=>String(y.t.at).localeCompare(String(x.t.at)));
  el("itemTrades").hidden=!trades.length;
  el("itemTrades").innerHTML=trades.length?`<span>플래너 체크로 반영한 체결 <small>${trades.length}건 · 체크를 풀면 되돌립니다</small></span><ul>${trades.slice(0,20).map(({t,e})=>{const d=finite(e.shares)?e.shares:e.amount,sign=d<0?"−":"+";
    return `<li><b>${escA(t.label||"체결")}</b><span>${sign}${finite(e.shares)?`${nf2.format(Math.abs(d))}주`:`${man(Math.abs(d))}${it.base?" (입력 금액)":""}`}</span><small>${escA(String(t.at||"").slice(5,10).replace("-","/"))}</small></li>`;}).join("")}</ul>`:"";
  el("itemDelete").hidden=!found;
  el("itemDelete").onclick=()=>{ if(!confirm(`'${it.name}' 종목${it.buyPlan?"과 분할매수 계획":""}을 삭제할까요?`)) return; found.g.items=found.g.items.filter(x=>x!==it); saveSection("allocation"); dlg("itemDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault(); if(!a.groups.length){ alert("먼저 그룹을 추가하세요."); return; }
    const tradeTicker=f.tradeTicker.value.trim().toUpperCase(),sourceKind=purchaseQuoteKind(f.ticker.value),tradeKind=purchaseQuoteKind(tradeTicker);
    if(tradeTicker&&(!["국내","해외"].includes(sourceKind)||!["국내","해외"].includes(tradeKind))){alert("기준 티커와 실제 매수 ETF에 국내 종목 코드 또는 미국 심볼을 넣으세요.");f.tradeTicker.focus();return;}
    if(numIn(f.tradePrice.value)!==null&&!tradeTicker){alert("현재가를 직접 넣으려면 실제 매수 ETF 코드를 먼저 입력하세요.");f.tradeTicker.focus();return;}
    const target=found?.it||{id:newId(), amount:0}, before=JSON.stringify([target.amount,target.ticker,target.tradeTicker,target.shares]),oldTradeTicker=target.tradeTicker,oldTradePrice=finite(target.tradePrice);
    target.name=f.name.value.trim()||"이름 없음"; setText(target,"section",f.section.value); target.amount=numIn(f.amount.value)??0; setText(target,"ticker",f.ticker.value.toUpperCase()); setNum(target,"shares",f.shares.value); setNum(target,"target",f.target.value);
    setText(target,"tradeTicker",tradeTicker);setNum(target,"tradePrice",f.tradePrice.value);
    if(!target.tradeTicker||!plus(target.tradePrice)){delete target.tradePrice;delete target.tradePriceAt;}
    else if(oldTradeTicker!==target.tradeTicker||oldTradePrice!==target.tradePrice)target.tradePriceAt=new Date().toISOString();
    if(f.done.checked) target.done=true; else delete target.done; setText(target,"note",f.note.value);
    if(!(finite(target.shares)>=0)) delete target.shares; // 0은 남김(다 판 종목 — 평가액 0, itemValue)
    if(!found||before!==JSON.stringify([target.amount,target.ticker,target.tradeTicker,target.shares])||tracksETF(target)&&!plus(target.base)&&plus(target.amount)) resetBase(target,prices,a);
    const g=a.groups.find(x=>x.id===f.group.value);
    if(found&&found.g!==g) found.g.items=found.g.items.filter(x=>x!==target);
    if(!g.items.includes(target)) g.items.push(target);
    saveSection("allocation"); dlg("itemDialog").close(); render(); };
  dlg("itemDialog").showModal();
}
function openGroup(id){
  const a=doc.allocation, g=id?a.groups.find(x=>x.id===id):null, f=el("groupForm");
  // 중국 분류가 없는 옛 기록에도 선택지를 보이되, 선택한 그룹을 저장할 때만 만든다.
  const classes=allocationClassList(a);
  if(!classes.some(c=>c.region==="해외"&&c.name==="중국")){
    const india=classes.findIndex(c=>c.region==="해외"&&c.name==="인도");
    classes.splice(india<0?classes.length:india+1,0,{id:newId(),region:"해외",name:"중국"});
  }
  el("groupTitle").textContent=g?"그룹 수정":"새 그룹";
  f.classId.innerHTML=classes.map(c=>`<option value="${escA(c.id)}">${escA(c.region||"기타")} · ${escA(c.name)}</option>`).join("");
  const targets=allocationTargets(a), target=g?targets.groups.get(g.id):{target:null,linked:false};
  f.name.value=g?.name||""; f.classId.value=g?.classId||classes[0].id; f.target.value=target.target??""; f.target.disabled=target.linked; f.note.value=g?.note||"";
  el("groupTargetHint").textContent=target.linked?"종목·소분류 목표의 합계입니다. 종목별에서 수정하면 자동 반영됩니다.":"하위 목표가 없을 때만 직접 입력합니다. 기준 총자산 대비입니다.";
  const names=g?[...new Set([...(g.sections||[]).map(x=>x.name),...g.items.map(x=>x.section).filter(Boolean)])]:[];
  el("sectionTargets").innerHTML=names.length?`<span>소분류 목표 비중 (%)</span>${names.map((n,i)=>{const t=targets.section(g.id,n);return `<label class="sub-target">${escA(n)}${t.linked?" · 종목 합산":""}<input data-sec="${i}" type="number" min="0" max="100" step="any" inputmode="decimal" value="${t.target??""}"${t.linked?" disabled":""}></label>`;}).join("")}`:"";
  el("groupDelete").hidden=!g;
  el("groupDelete").onclick=()=>{ if(!confirm(`'${g.name}' 그룹${g.items.length?`과 종목 ${g.items.length}개`:""}를 삭제할까요?`)) return; a.groups=a.groups.filter(x=>x!==g); saveSection("allocation"); dlg("groupDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault(); const t=g||{id:newId(),items:[]};
    t.name=f.name.value.trim()||"이름 없음"; t.classId=f.classId.value; if(!f.target.disabled)setNum(t,"target",f.target.value); setText(t,"note",f.note.value);
    const c=classes.find(x=>x.id===t.classId), stored=a.classes.find(x=>x.id===t.classId);
    if(c){if(stored)Object.assign(stored,c);else a.classes.push(c);}
    if(names.length){ const old=t.sections||[]; t.sections=names.map((n,i)=>{const prev=old.find(x=>x.name===n)||{},o={...prev,name:n},input=f.querySelector(`[data-sec="${i}"]`);if(!input.disabled)setNum(o,"target",input.value);return o;}); }
    if(!g) a.groups.push(t); saveSection("allocation"); dlg("groupDialog").close(); render(); };
  dlg("groupDialog").showModal();
}
function openClass(id){
  const a=doc.allocation, c=id?a.classes.find(x=>x.id===id):null, f=el("classForm");
  const classes=allocationClassList(a), display=classes.find(x=>x.id===id);
  el("classTitle").textContent=c?"큰 분류 수정":"새 큰 분류";
  el("regionList").innerHTML=[...new Set([...ASSET_REGIONS,...classes.map(x=>x.region).filter(Boolean)])].map(r=>`<option value="${escA(r)}">`).join("");
  const target=c?allocationTargets(a).classes.get(c.id):{target:null,linked:false};
  f.name.value=display?.name||""; f.region.value=display?.region||""; f.target.value=target.target??""; f.target.disabled=target.linked; f.cash.checked=!!c?.cash;
  el("classTargetHint").textContent=target.linked?"그룹 목표의 합계입니다. 종목별에서 수정하면 자동 반영됩니다.":"하위 목표가 없을 때만 직접 입력합니다. 기준 총자산 대비입니다.";
  const used=c?a.groups.filter(g=>g.classId===c.id).length:0;
  el("classDelete").hidden=!c;
  el("classDelete").onclick=()=>{ if(used){ alert(`이 분류에 그룹 ${used}개가 있습니다. 그룹을 다른 분류로 옮기거나 지운 뒤 삭제하세요.`); return; } if(!confirm(`'${c.name}' 분류를 삭제할까요?`)) return; a.classes=a.classes.filter(x=>x!==c); saveSection("allocation"); dlg("classDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault(); const t=c||{id:newId()};
    t.name=f.name.value.trim()||"이름 없음"; t.region=f.region.value.trim()||"기타"; if(!f.target.disabled)setNum(t,"target",f.target.value); if(f.cash.checked) t.cash=true; else delete t.cash;
    if(!c) a.classes.push(t); saveSection("allocation"); dlg("classDialog").close(); render(); };
  dlg("classDialog").showModal();
}
function openCash(id){
  const a=doc.allocation, c=id?a.cash.find(x=>x.id===id):null, f=el("cashForm");
  el("cashTitle").textContent=c?"현금 수정":"새 현금 항목";
  f.place.value=c?.place||""; f.name.value=c?.name||""; f.amount.value=c?.amount??""; f.currency.value=c?.currency||"KRW"; f.minus.checked=!!c?.minus;
  el("cashDelete").hidden=!c;
  el("cashDelete").onclick=()=>{ if(!confirm(`'${c.name}' 항목을 삭제할까요?`)) return; a.cash=a.cash.filter(x=>x!==c); saveSection("allocation"); dlg("cashDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault(); const t=c||{id:newId()};
    setText(t,"place",f.place.value); t.name=f.name.value.trim()||"이름 없음"; t.amount=numIn(f.amount.value)??0; t.currency=f.currency.value==="USD"?"USD":"KRW"; if(f.minus.checked) t.minus=true; else delete t.minus;
    if(!c) a.cash.push(t); saveSection("allocation"); dlg("cashDialog").close(); render(); };
  dlg("cashDialog").showModal();
}

// ---------- 월별 손익 ----------
function renderLedger(){
  const L=doc.ledger, view=el("ledgerView");
  if(!L||!L.years.length){ view.innerHTML=emptyCard("월별 손익 기록이 없습니다","데이터 저장소에 etf-planner-assets.json이 있으면 동기화할 때 불러옵니다.",`<button class="btn primary" id="startLedger" type="button">올해부터 시작</button>`);
    el("startLedger").onclick=()=>{ doc.ledger={savedAt:"",years:[{year:new Date().getFullYear(),accounts:[],months:[]}]}; saveSection("ledger"); render(); }; return; }
  const years=[...L.years].sort((a,b)=>a.year-b.year), y=years.find(x=>x.year===ui.year)||years[years.length-1], ys=yearSummary(y);
  const hasInterest=y.months.some(m=>finite(m.interest)!==null), hasLoan=y.accounts.some(x=>x.loan);
  // 잔액이 전달과 똑같은 달(엑셀에서 전달 값을 그대로 둔 것일 수 있음)은 작게 표시
  const sameAsPrev=m=>{ const prev=y.months.find(x=>x.m===m.m-1); return Array.isArray(m.balances)&&m.balances.some(v=>finite(v))&&JSON.stringify(m.balances)===JSON.stringify(prev?.balances); };
  const monthRow=n=>{ const m=y.months.find(x=>x.m===n), t=m?monthTotals(y,m):{}, p=finite(m?.pnl), r=p!==null&&t.total>0?p/t.total*100:null, rf=p!==null&&t.noLoan>0?p/t.noLoan*100:null;
    return `<button class="ledger-row${m?"":" blank"}" type="button" data-month="${n}"><span>${n}월</span><span class="${p<0?"neg":""}">${p!==null?wonA(p):"—"}</span><span class="${r<0?"neg":""}">${r!==null?pc(r):"—"}${hasLoan&&rf!==null?`<small>대출 제외 ${pc(rf)}</small>`:""}</span><span>${t.total>0?eok(t.total):"—"}${hasLoan&&t.noLoan!==null?`<small>대출 제외 ${eok(t.noLoan)}</small>`:""}${m&&sameAsPrev(m)?`<small class="same-tag">잔액이 전달과 같음</small>`:""}</span>${hasInterest?`<span class="hide-m">${finite(m?.interest)!==null?wonA(m.interest):"—"}</span>`:""}</button>`; };
  const summaryRows=years.map(x=>{const t=yearSummary(x);return `<button class="ledger-row${x===y?" active":""}" type="button" data-pick-year="${x.year}"><span>${x.year}</span><span class="${t.pnl<0?"neg":""}">${wonA(t.pnl)}</span><span class="${t.rate<0?"neg":""}">${pc(t.rate)}${t.rateNoLoan!==null?`<small>대출 제외 ${pc(t.rateNoLoan)}</small>`:""}</span><span>${t.last?eok(t.last.total):"—"}<small>${t.last?`${t.last.m}월`:""}</small></span></button>`;}).join("");
  view.innerHTML=`<div class="heading"><div><div class="eyebrow">월별 손익 · 엑셀 손익 시트</div><h1>월별 손익</h1><p>달마다 실현손익과 계좌 잔액을 적습니다. 수익률은 엑셀처럼 실현손익 ÷ 그 달 총자산(대출 계좌 포함)이고, 선물옵션은 한 해 합계를 마지막 달 총자산으로 나눕니다.</p></div><button class="btn" id="addYear" type="button">＋ 연도</button></div>
    <div class="chip-row" role="tablist">${years.map(x=>`<button class="chip${x===y?" active":""}" type="button" data-pick-year="${x.year}">${x.year}</button>`).join("")}</div>
    <div class="card metrics"><div class="metric"><label>${y.year}년 실현손익</label><strong class="${ys.pnl<0?"neg":""}">${wonA(ys.pnl)}</strong><small>${ys.months}개월${ys.futures!==null?` · 선물옵션 ${wonA(ys.futures)} 포함`:""}${ys.interest!==null?` · 이자 ${wonA(ys.interest)}`:""}</small></div>
      <div class="metric"><label>연 수익률 (월 합)</label><strong class="${ys.rate<0?"neg":""}">${pc(ys.rate)}</strong><small>${ys.rateNoLoan!==null?`대출 제외 ${pc(ys.rateNoLoan)} · `:""}연환산 ${pc(ys.annual)} (선물옵션 제외, 실현손익 ${ys.months}개월 기준)</small></div>
      <div class="metric"><label>마지막 총자산</label><strong>${ys.last?eok(ys.last.total):"—"}</strong><small>${ys.last?`${ys.last.m}월 · 대출 포함${ys.last.noLoan!==null?` · 대출 제외 ${eok(ys.last.noLoan)}`:""}`:"계좌 잔액을 넣으세요"}</small></div></div>
    <div class="section-heading"><h2>${y.year}년</h2><span>줄을 누르면 그 달 실현손익·계좌 잔액을 고칩니다. 계좌 ${y.accounts.length}개</span><button class="btn mini" type="button" id="editYear">연도 설정</button></div>
    <section class="card ledger-table${hasInterest?" with-interest":""}"><div class="ledger-row head"><span>월</span><span>실현손익</span><span>수익률</span><span>총자산</span>${hasInterest?`<span class="hide-m">이자</span>`:""}</div>
      ${Array.from({length:12},(_,i)=>monthRow(i+1)).join("")}
      ${ys.futures!==null?`<div class="ledger-row foot"><span>선물옵션</span><span class="${ys.futures<0?"neg":""}">${wonA(ys.futures)}</span><span>${ys.last?.total>0?pc(ys.futures/ys.last.total*100):"—"}</span><span></span>${hasInterest?`<span class="hide-m"></span>`:""}</div>`:""}
      <div class="ledger-row foot total"><span>합계</span><span class="${ys.pnl<0?"neg":""}">${wonA(ys.pnl)}</span><span>${pc(ys.rate)}</span><span></span>${hasInterest?`<span class="hide-m">${ys.interest!==null?wonA(ys.interest):""}</span>`:""}</div></section>
    ${y.note?`<p class="footnote">${escA(y.note)}</p>`:""}
    <div class="section-heading"><h2>연도별 요약</h2><span>실현손익(선물옵션 포함) · 연 수익률 · 마지막 총자산</span></div>
    <section class="card ledger-table years"><div class="ledger-row head"><span>연도</span><span>실현손익</span><span>수익률</span><span>총자산</span></div>${summaryRows}</section>`;
  all("[data-pick-year]").forEach(b=>b.onclick=()=>{ setUi({year:Number(b.dataset.pickYear)}); renderLedger(); });
  all("[data-month]").forEach(b=>b.onclick=()=>openMonth(y,Number(b.dataset.month)));
  el("editYear").onclick=()=>openYear(y);
  el("addYear").onclick=()=>{ const next=Math.max(...years.map(x=>x.year))+1, last=years[years.length-1];
    if(!confirm(`${next}년을 추가할까요? 계좌 목록은 ${last.year}년과 같게 시작합니다.`)) return;
    L.years.push({year:next,accounts:last.accounts.map(x=>({...x})),months:[]}); setUi({year:next}); saveSection("ledger"); render(); };
}
function openMonth(y, n){
  const f=el("monthForm"), m=y.months.find(x=>x.m===n)||{m:n}, bal=m.balances||[];
  el("monthTitle").textContent=`${y.year}년 ${n}월`;
  el("monthFields").innerHTML=`<label class="field"><span>실현손익 (원)</span><input name="pnl" type="number" step="any" inputmode="decimal" value="${m.pnl??""}"></label>
    <label class="field"><span>이자 (원, 선택 · 비용은 −)</span><input name="interest" type="number" step="any" inputmode="decimal" value="${m.interest??""}"></label>
    ${y.accounts.length?y.accounts.map((acc,i)=>`<label class="field"><span>${escA(acc.name)}${acc.loan?` <small class="loan-tag">대출</small>`:""}</span><input name="bal${i}" type="number" step="any" inputmode="decimal" value="${bal[i]??""}"></label>`).join("")
      :`<label class="field"><span>총자산 (원)</span><input name="total" type="number" step="any" inputmode="decimal" value="${m.total??""}"></label>`}
    <p class="hint dialog-wide">${y.accounts.length?"총자산은 계좌 잔액 합계입니다(대출 계좌 포함). 계좌는 ‘연도 설정’에서 더하거나 뺍니다.":"계좌가 없는 해는 총자산만 넣습니다. ‘연도 설정’에서 계좌를 더하면 계좌별로 적을 수 있습니다."}</p>`;
  el("monthClear").onclick=()=>{ if(!confirm(`${y.year}년 ${n}월 기록을 지울까요?`)) return; y.months=y.months.filter(x=>x.m!==n); saveSection("ledger"); dlg("monthDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault(); const t={m:n}; setNum(t,"pnl",f.pnl.value); setNum(t,"interest",f.interest.value);
    if(y.accounts.length){ const b=y.accounts.map((_,i)=>numIn(f[`bal${i}`].value)); while(b.length&&b[b.length-1]===null) b.pop(); if(b.length) t.balances=b; }
    else setNum(t,"total",f.total.value);
    y.months=y.months.filter(x=>x.m!==n); if(Object.keys(t).length>1){ y.months.push(t); y.months.sort((a,b)=>a.m-b.m); }
    saveSection("ledger"); dlg("monthDialog").close(); render(); };
  dlg("monthDialog").showModal();
}
function openYear(y){
  const f=el("yearForm"); el("yearTitle").textContent=`${y.year}년 설정`;
  f.futures.value=y.futures??""; f.note.value=y.note||"";
  let rows=y.accounts.map((a,i)=>({from:i,name:a.name,loan:!!a.loan}));
  const draw=()=>{ el("accountRows").innerHTML=rows.map((r,i)=>`<div class="account-row"><input data-acc-name="${i}" value="${escA(r.name)}" maxlength="40" aria-label="계좌 이름"><label class="check"><input type="checkbox" data-acc-loan="${i}"${r.loan?" checked":""}> 대출</label><button class="remove" type="button" data-acc-del="${i}" aria-label="계좌 삭제">삭제</button></div>`).join("")||`<p class="hint">계좌 없음 · 총자산만 적습니다</p>`;
    all("[data-acc-name]").forEach(x=>x.oninput=()=>{rows[Number(x.dataset.accName)].name=x.value;});
    all("[data-acc-loan]").forEach(x=>x.onchange=()=>{rows[Number(x.dataset.accLoan)].loan=x.checked;});
    all("[data-acc-del]").forEach(x=>x.onclick=()=>{const r=rows[Number(x.dataset.accDel)];if(r.from!==null&&y.months.some(m=>finite(m.balances?.[r.from])!==null)&&!confirm(`'${r.name}' 계좌를 지우면 이 해의 그 계좌 잔액도 지워집니다. 계속할까요?`))return;rows.splice(Number(x.dataset.accDel),1);draw();}); };
  draw(); el("addAccount").onclick=()=>{ rows.push({from:null,name:"",loan:false}); draw(); el("accountRows").querySelector(`[data-acc-name="${rows.length-1}"]`)?.focus(); };
  el("yearDelete").onclick=()=>{ if(!confirm(`${y.year}년 손익 기록을 모두 지울까요?`)) return; doc.ledger.years=doc.ledger.years.filter(x=>x!==y); setUi({year:null}); saveSection("ledger"); dlg("yearDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault(); setNum(y,"futures",f.futures.value); setText(y,"note",f.note.value);
    rows=rows.filter(r=>r.name.trim()); y.accounts=rows.map(r=>({name:r.name.trim(),...(r.loan?{loan:true}:{})}));
    y.months.forEach(m=>{ if(!Array.isArray(m.balances)) return; const b=rows.map(r=>r.from===null?null:m.balances[r.from]??null); while(b.length&&b[b.length-1]===null) b.pop(); if(b.length) m.balances=b; else delete m.balances; });
    saveSection("ledger"); dlg("yearDialog").close(); render(); };
  dlg("yearDialog").showModal();
}

// ---------- 저축 계획 ----------
const KEY_AGES = [35,40,45,50,60,70,80,90];
let savingsAllYears = false; // 연도별 표를 모두 펼쳤는지(화면 상태, 저장 안 함)
function renderSavings(){
  const S=doc.savings, view=el("savingsView");
  if(!S){ view.innerHTML=emptyCard("저축 계획 기록이 없습니다","데이터 저장소에 etf-planner-assets.json이 있으면 동기화할 때 불러옵니다.",`<button class="btn primary" id="startSavings" type="button">새로 시작</button>`);
    el("startSavings").onclick=()=>{ const y=new Date().getFullYear(); doc.savings={savedAt:"",startYear:y,startAge:30,actual:[],scenarios:[{id:newId(),name:"기본",salary:0,giving:0,spending:0,spendingYear:y,growth:2,returnRate:5,endAge:60,stages:[]}]}; saveSection("savings"); render(); }; return; }
  const sc=S.scenarios.find(x=>x.id===ui.scenario)||S.scenarios[0], sim=sc?simulateSavings(S,sc):null;
  const field=(key,label,unit,attrs="")=>`<label class="field"><span>${label}</span><span class="unit-input"><input data-param="${key}" type="number" step="any" inputmode="decimal" value="${sc[key]??""}" ${attrs}><em>${unit}</em></span>${unit==="원"&&finite(sc[key])?`<small class="field-hint">${eok(sc[key])}</small>`:""}</label>`;
  const stageRow=(st,i)=>`<div class="plan-line"><label><span>나이</span><input data-stage="${i}" data-k="age" type="number" step="1" value="${st.age??""}"></label><label><span>월급 (원)</span><input data-stage="${i}" data-k="salary" type="number" step="any" value="${st.salary??""}" placeholder="그대로"></label><label><span>사용금액 (원)</span><input data-stage="${i}" data-k="spending" type="number" step="any" value="${st.spending??""}" placeholder="그대로"></label><label><span>증가율 (%)</span><input data-stage="${i}" data-k="growth" type="number" step="any" value="${st.growth??""}" placeholder="그대로"></label><label><span>수익률 (%)</span><input data-stage="${i}" data-k="returnRate" type="number" step="any" value="${st.returnRate??""}" placeholder="그대로"></label><button class="remove" type="button" data-stage-del="${i}" aria-label="단계 삭제">삭제</button></div>`;
  const lastN=sim?ymNum(sim.last.ym):null;
  const eventNote=ev=>{ const n=ymNum(ev.start); if(n===null||lastN===null||n>lastN) return ""; const left=Math.max(0,n+Math.round(finite(ev.months)||0)-1-lastN);
    return `<p class="event-note">시작 달이 마지막 실제 기록(${sim.last.ym}) 이전이라 선수금${left?`과 그때까지의 할부는 계산에서 빠지고 남은 ${left}개월만`:"·할부 모두 이미 지난 일이라"} 계산${left?"합니다":"하지 않습니다"}.</p>`; };
  const eventRow=(ev,i)=>`<div class="plan-line event"><label class="wide"><span>이름</span><input data-event="${i}" data-k="name" value="${escA(ev.name||"")}" maxlength="40"></label><label><span>시작 달</span><input data-event="${i}" data-k="start" type="month" value="${escA(ev.start||"")}"></label><label><span>선수금 (원)</span><input data-event="${i}" data-k="down" type="number" step="any" value="${ev.down??""}"></label><label><span>월 할부 (원)</span><input data-event="${i}" data-k="monthly" type="number" step="any" value="${ev.monthly??""}"></label><label><span>개월</span><input data-event="${i}" data-k="months" type="number" step="1" min="0" value="${ev.months??""}"></label><button class="remove" type="button" data-event-del="${i}" aria-label="할부 삭제">삭제</button>${eventNote(ev)}</div>`;
  const maxAge=Math.max(...S.scenarios.map(x=>finite(x.endAge)||0)), ages=KEY_AGES.filter(a=>a<=maxAge&&a>=(finite(S.startAge)||0));
  const compare=S.scenarios.map(x=>{const r=simulateSavings(S,x);return `<tr${x===sc?' class="active"':""}><th scope="row">${escA(x.name)}</th>${ages.map(a=>`<td>${r&&a<=(finite(x.endAge)||0)?eok(r.at(a)):"—"}</td>`).join("")}</tr>`;}).join("");
  const shownRows=sim?sim.rows.filter((r,i)=>savingsAllYears||r.actual||i===sim.rows.length-1||r.age%5===0||sim.rows.slice(0,i).filter(x=>!x.actual).length<10):[];
  const yearRows=sim?shownRows.map(r=>`<tr class="${r.actual?"actual":""}"><th scope="row">${r.year} <small>${r.age}세</small></th><td><b>${eok(r.end)}</b>${r.actual?`<small>실제 ${r.endYm.slice(5)}월</small>`:""}</td><td>${r.actual?"—":eok(r.returns)}</td><td class="hide-m">${r.actual?"—":eok(r.salary)}</td><td class="hide-m">${r.actual?"—":eok(r.spending)}</td><td class="hide-m">${r.payments?eok(r.payments):"—"}</td></tr>`).join(""):"";
  const endRow=sim?.rows[sim.rows.length-1], at40=sim?.rows.find(r=>r.age===40&&!r.actual);
  const actual=[...S.actual].sort((a,b)=>String(a.ym).localeCompare(String(b.ym))), missing=missingActual(S);
  view.innerHTML=`<div class="heading"><div><div class="eyebrow">저축 계획 · 엑셀 복리 저축 계산 시트(보이는 시트만)</div><h1>저축 계획</h1><p>매달 월급 − 기부 − 사용금액 − 할부를 더하고, 12월에 전년 12월 저축총액 × 연 수익률(수익의 기부 뺌)을 더합니다. 마지막 실제 기록 다음 달부터 계산합니다.</p></div><button class="btn" id="copyScenario" type="button">＋ 시나리오 복사</button></div>
    <div class="chip-row">${S.scenarios.map(x=>`<button class="chip${x===sc?" active":""}" type="button" data-scenario="${escA(x.id)}">${escA(x.name)}</button>`).join("")}</div>
    ${sc?`<div class="card metrics"><div class="metric"><label>마지막 실제 기록</label><strong>${sim?eok(sim.last.total):"—"}</strong><small>${sim?`${sim.last.ym.replace("-","년 ")}월`:"아래 실제 기록을 한 달 이상 넣으세요"}</small></div>
      <div class="metric"><label>40세 말 (예상)</label><strong>${at40?eok(at40.end):"—"}</strong><small>${at40?`${at40.year}년 12월`:"계산 범위 밖"}</small></div>
      <div class="metric"><label>${endRow?`${endRow.age}세 말 (예상)`:"종료 나이"}</label><strong>${endRow?eok(endRow.end):"—"}</strong><small>${endRow?`${endRow.year}년 12월 · 종료 나이 ${sc.endAge}세`:""}</small></div></div>
    <section class="card panel"><div class="future-panel-head"><h2>${escA(sc.name)} 가정</h2><button class="btn mini danger" type="button" id="deleteScenario"${S.scenarios.length<2?" hidden":""}>시나리오 삭제</button></div>
      <div class="param-grid"><label class="field"><span>시나리오 이름</span><input data-param="name" maxlength="40" value="${escA(sc.name)}"></label>${field("salary","월급","원")}${field("giving","기부 (월급·수익의 %)","%")}${field("spending","월 사용금액","원")}${field("spendingYear","사용금액 기준 연도","년",'step="1"')}${field("growth","사용금액 연 증가율","%")}${field("returnRate","연 수익률","%")}${field("endAge","종료 나이","세",'step="1"')}</div>
      <h3 class="sub-title">나이별 변경 <small>그 나이(그해)부터 적용 · 빈칸은 그대로 · 사용금액은 그해 월 사용금액을 그 값으로 바꿈</small></h3><div class="plan-lines">${(sc.stages||[]).map(stageRow).join("")||`<p class="hint">없음</p>`}</div><button class="btn mini" type="button" id="addStage">＋ 단계</button>
      <h3 class="sub-title">할부·큰 지출 <small>시작 달에 선수금(일시불), 시작 달부터 개월 수만큼 월 할부</small></h3><div class="plan-lines">${(sc.events||[]).map(eventRow).join("")||`<p class="hint">없음</p>`}</div><button class="btn mini" type="button" id="addEvent">＋ 할부·지출</button>
      <label class="field scenario-note"><span>메모</span><textarea data-param="note" maxlength="2000">${escA(sc.note||"")}</textarea></label></section>`:""}
    <div class="section-heading"><h2>시나리오 비교</h2><span>나이별 연말 저축총액</span></div>
    <section class="card table-scroll"><table class="data-table"><thead><tr><th>시나리오</th>${ages.map(a=>`<th>${a}세</th>`).join("")}</tr></thead><tbody>${compare}</tbody></table></section>
    ${sim?`<div class="section-heading"><h2>${escA(sc.name)} · 연도별</h2><span>실제 기록 연도는 그해 마지막 기록, 계산한 해는 12월 기준${savingsAllYears?"":" · 처음 10년 뒤로는 5년마다"}</span></div>
    <section class="card table-scroll"><table class="data-table years"><thead><tr><th>연도</th><th>연말 저축총액</th><th>투자수익</th><th class="hide-m">월급</th><th class="hide-m">사용금액</th><th class="hide-m">할부</th></tr></thead><tbody>${yearRows}</tbody></table>${sim.rows.length>shownRows.length||savingsAllYears?`<div class="group-foot"><button class="btn mini ghost" type="button" id="toggleYears">${savingsAllYears?"줄여 보기":`모든 연도 보기 (${sim.rows.length}년)`}</button></div>`:""}</section>`:""}
    <details class="card panel actual-panel"${S.actual.length?"":" open"}><summary>실제 저축총액 기록 <small>${S.actual.length}개월${actual.length?` · ${actual[0].ym} ~ ${actual[actual.length-1].ym}`:""}</small></summary>
      ${missing.length?`<p class="hint missing-note">사이에 빠진 달: ${missing.join(", ")} — 계산은 마지막 기록부터라 결과에는 영향이 없고, 기록만 비어 있습니다.</p>`:""}
      <div class="param-grid"><label class="field"><span>시작 연도</span><input data-base="startYear" type="number" step="1" value="${S.startYear??""}"></label><label class="field"><span>그해 나이</span><input data-base="startAge" type="number" step="1" value="${S.startAge??""}"></label></div>
      <div class="actual-list">${actual.map(r=>`<div class="actual-row"><span>${escA(r.ym)}</span><input data-actual="${escA(r.ym)}" type="number" step="any" inputmode="decimal" value="${r.total??""}" aria-label="${escA(r.ym)} 저축총액"><small>${eok(r.total)}</small><button class="remove" type="button" data-actual-del="${escA(r.ym)}">삭제</button></div>`).join("")}</div>
      <div class="actual-row add"><input id="newActualYm" type="month" aria-label="기록할 달"><input id="newActualTotal" type="number" step="any" inputmode="decimal" placeholder="저축총액 (원)"><button class="btn mini" type="button" id="addActual">추가</button></div></details>`;
  all("[data-scenario]").forEach(b=>b.onclick=()=>{ setUi({scenario:b.dataset.scenario}); renderSavings(); });
  if(el("toggleYears")) el("toggleYears").onclick=()=>{ savingsAllYears=!savingsAllYears; renderSavings(); };
  el("copyScenario").onclick=()=>{ const base=sc||{}; const copy=JSON.parse(JSON.stringify({...base,id:newId(),name:`${base.name||"시나리오"} 복사`})); S.scenarios.push(copy); setUi({scenario:copy.id}); saveSection("savings"); render(); };
  onChange("[data-base]","savings",(v,x)=>{ const n=numIn(v); if(n===null) return false; S[x.dataset.base]=Math.round(n); });
  onChange("[data-actual]","savings",(v,x)=>{ const n=numIn(v); const r=S.actual.find(a=>a.ym===x.dataset.actual); if(!r||n===null) return false; r.total=n; });
  all("[data-actual-del]").forEach(b=>b.onclick=()=>{ if(!confirm(`${b.dataset.actualDel} 기록을 지울까요?`)) return; S.actual=S.actual.filter(a=>a.ym!==b.dataset.actualDel); saveSection("savings"); render(); });
  el("addActual").onclick=()=>{ const ym=el("newActualYm").value, n=numIn(el("newActualTotal").value); if(ymNum(ym)===null||n===null){ alert("달과 저축총액을 넣어 주세요."); return; }
    S.actual=S.actual.filter(a=>a.ym!==ym); S.actual.push({ym,total:n}); S.actual.sort((a,b)=>a.ym.localeCompare(b.ym)); saveSection("savings"); render(); };
  if(!sc) return;
  onChange("[data-param]","savings",(v,x)=>{ const k=x.dataset.param; if(k==="name"){ sc.name=v.trim()||sc.name; return; } if(k==="note"){ setText(sc,"note",v); return; }
    const n=numIn(v); if(n===null) return false; sc[k]=["spendingYear","endAge"].includes(k)?Math.round(n):n; });
  onChange("[data-stage]","savings",(v,x)=>{ const st=sc.stages[Number(x.dataset.stage)]; if(x.dataset.k==="age"&&numIn(v)===null) return false; setNum(st,x.dataset.k,v); sc.stages.sort((a,b)=>a.age-b.age); });
  onChange("[data-event]","savings",(v,x)=>{ const ev=sc.events[Number(x.dataset.event)], k=x.dataset.k; if(k==="name"||k==="start") setText(ev,k,v); else setNum(ev,k,v); });
  all("[data-stage-del]").forEach(b=>b.onclick=()=>{ sc.stages.splice(Number(b.dataset.stageDel),1); saveSection("savings"); render(); });
  all("[data-event-del]").forEach(b=>b.onclick=()=>{ sc.events.splice(Number(b.dataset.eventDel),1); if(!sc.events.length) delete sc.events; saveSection("savings"); render(); });
  el("addStage").onclick=()=>{ sc.stages=sc.stages||[]; const last=sc.stages[sc.stages.length-1]; sc.stages.push({age:(finite(last?.age)??(finite(S.startAge)||30))+5}); saveSection("savings"); render(); };
  el("addEvent").onclick=()=>{ sc.events=sc.events||[]; const n=new Date(); sc.events.push({name:"할부",start:ymText(n.getFullYear()*12+n.getMonth()+1),months:12}); saveSection("savings"); render(); };
  el("deleteScenario").onclick=()=>{ if(!confirm(`'${sc.name}' 시나리오를 삭제할까요?`)) return; S.scenarios=S.scenarios.filter(x=>x!==sc); setUi({scenario:S.scenarios[0]?.id||null}); saveSection("savings"); render(); };
}

// ---------- 동기화 표시(기록·시세·병합은 assets-store.js에서 두 페이지가 공유) ----------
const assetConfig=()=>assetStore.config();
function priceLine(message=assetStore.priceMessage){
  const n=prices?Object.values(prices.stocks).filter(e=>e.close).length:0,at=prices?.updatedAt,busy=assetStore.priceRefreshing,status=el("priceRefreshStatus");
  el("assetPriceStatus").textContent=message||(prices?`시세 파일 ${at?new Date(at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):""} · 종목 ${n}개${prices.fx?` · 현물 환율 ${nf2.format(prices.fx.close)}원`:""}. 자산 배분 종목 코드는 데이터 저장소 수집 작업이 장 마감 후 하루 한 번(국내 16:40·미국 06:40) 종가를 받습니다.`:"");
  status.className=message&&!busy&&!message.startsWith("시세 불러오기 완료")?"warning":"";
  status.textContent=message||(at?`최근 수집 ${new Date(at).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}`:assetConfig()?"시세를 바로 수집한 뒤 불러옵니다.":"동기화를 연결하면 시세를 불러올 수 있습니다.");
  for(const key of ["refreshPricesBtn","refreshPricesDialogBtn"]){const btn=el(key);btn.disabled=assetStore.status.state==="busy"||busy;btn.ariaBusy=String(busy);btn.textContent=busy?"시세 불러오는 중…":"시세 즉시 불러오기";}
}
function setAssetSync(){
  const cfg=assetConfig(),s=assetStore.status;
  const text={off:"이 기기에만 저장 중",pending:"잠시 후 동기화",busy:"동기화 확인 중…",done:`동기화 완료 · ${s.at}`,error:`이 기기 저장됨 · ${s.message}`}[s.state];
  el("syncStatus").textContent=text;el("syncDialogStatus").textContent=text;el("syncBtn").title=text;
  el("syncBtn").className="btn mini sync-btn "+(!cfg?"off":s.state==="error"?"warn":s.state==="busy"?"busy":"ok");
  el("syncOff").hidden=!!cfg;el("syncOn").hidden=!cfg;el("syncRepo").textContent=cfg?.repo||"";el("syncNowBtn").hidden=!cfg;
  el("downloadRecovery").hidden=!assetStore.recovery().length;
}
assetStore.subscribe(type=>{doc=assetStore.doc;prices=assetStore.prices;setAssetSync();priceLine();if(type==="change")redrawIdle();});
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
  try{ const incoming=cleanAssets(JSON.parse(await file.text())); if(!incoming||assetsBlank(incoming)) throw Error("자산 현황 백업 형식이 아닙니다.");
    const names=ASSET_SECTIONS.filter(s=>incoming[s]).map(s=>({allocation:"자산 배분",ledger:"월별 손익",savings:"저축 계획"}[s]));
    if(!confirm(`${names.join("·")} 기록을 이 파일로 바꿀까요? 지금 기록은 이 기기에 보관합니다.`)) return;
    assetStore.restore(incoming); render(); alert("복원했습니다."); }
  catch(err){ alert(`복원 실패: ${err.message}`); }
  e.target.value=""; };
priceLine();setAssetSync();
if(location.hash==="#buys")location.replace("index.html#buys");
else openTab(location.hash.slice(1)||ui.tab);
assetStore.start();
