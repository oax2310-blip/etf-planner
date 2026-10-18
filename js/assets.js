// 자산 현황 화면의 공통 도구·탭·자산 배분(투자구성 포함). 월별 손익·저축 계획·할부는 assets-ledger.js·assets-savings.js·assets-installments.js, 동기화 표시·첫 화면은 assets-start.js(이 순서로 불러온다).
// 기능 규칙은 해당 함수 주석, 계산·기록은 assets-calc.js·assets-store.js, 공통 작업 규칙은 AGENTS.md.
const A_UI_KEY = "etf-planner-assets-ui";
const A_STALE_DAYS = 3; // 시세 기준일이 이보다 오래되면 ‘갱신 필요’ 배지(js/prices.js PRICE_STALE_DAYS와 같음)
const el = id => document.getElementById(id), all = sel => document.querySelectorAll(sel);
const escA = v => String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
const noteLineA = v => escA(String(v ?? "").replace(/\s+/g," ").trim());
const nfFixed1 = new Intl.NumberFormat("ko-KR",{minimumFractionDigits:1,maximumFractionDigits:1});
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
const numIn = parseAssetNumber;
const moneyAttrs = 'type="text" inputmode="decimal" autocomplete="off" data-money';
const moneyText = v => escA(assetNumberText(v));
// 금액 칸은 입력 중에도 천 단위 쉼표를 표시한다. 쉼표 삽입 전의 숫자 위치로 커서를 맞춰 중간 자리 수정도 유지한다.
document.addEventListener("input",e=>{
  const x=e.target;if(!x.matches("input[data-money]"))return;
  const value=x.value, raw=value.replace(/,/g,""), before=value.slice(0,x.selectionStart??value.length).replace(/,/g,"").length;
  const valid=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())&&numIn(raw)!==null;
  x.setCustomValidity(value.trim()&&!valid?"금액을 숫자로 입력해 주세요.":"");
  if(!/^[+-]?\d*(?:\.\d*)?$/.test(raw))return;
  const formatted=assetNumberText(raw);if(value===formatted)return;
  x.value=formatted;let pos=0,count=0;
  while(pos<formatted.length&&count<before){if(formatted[pos]!==",")count++;pos++;}
  x.setSelectionRange(pos,pos);
});

let doc=assetStore.doc, prices=assetStore.prices;
// 고른 탭·연도·시나리오는 이 기기 etf-planner-assets-ui에만 저장하고 동기화하지 않는다.
const ui = {tab:"alloc", year:null, scenario:null, ...readJson(A_UI_KEY, {})};
const setUi = patch => { Object.assign(ui, patch); writeJson(A_UI_KEY, ui); };
// 바꾼 구역의 savedAt을 새로 찍고 저장 → 잠시 뒤 동기화
function saveSection(section){assetStore.saveSection(section);}

// ---------- 탭 ----------
const TABS = ["strategy","alloc","ledger","savings","installments"];
function openTab(tab){ if(!TABS.includes(tab)) tab="alloc"; setUi({tab}); all(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab)); TABS.forEach(t=>el(t+"View").classList.toggle("hidden",t!==tab)); document.querySelector(".price-refresh").classList.toggle("hidden",tab==="installments"); render(); }
function render(){ if(ui.tab==="alloc"||ui.tab==="strategy") renderAlloc(ui.tab); if(ui.tab==="ledger") renderLedger(); if(ui.tab==="savings") renderSavings(); if(ui.tab==="installments") renderInstallments(); }
// 시세·동기화로 다시 그릴 때 입력 중인 칸이 있으면 미룬다(쓰던 값이 지워지지 않게)
let redrawLater = false;
function redrawIdle(){ const a=document.activeElement; if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!a.closest("dialog")){ redrawLater=true; return; } redrawLater=false; render(); }
document.addEventListener("focusout",()=>setTimeout(()=>{ if(redrawLater) redrawIdle(); },0));
// 칸 공통: 바뀌면 set(값, 칸) → false가 아니면 저장 → 다시 그림
const onChange = (sel, section, set) => all(sel).forEach(x=>x.onchange=()=>{ if(!x.validity.valid)return; if(set(x.value,x)!==false) saveSection(section); render(); });
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
// 플래너 편입 점검 패널의 펼침(현재 화면 메모리에만 둠). 편입 계산은 실패해도 자산 배분 화면을 막지 않는다.
let memberPanelOpen = false;
let memberRaw = null;
const plannerRaw = () => { try{ return localStorage.getItem(memberLink.PLANNER_KEY)||""; }catch{ return ""; } };
function memberInfo(a){ memberRaw=plannerRaw(); try{ return memberLink.collect(a,prices); }catch{ return null; } }
// 플래너에서 분할매도·재매수를 추가·삭제하면(다른 탭의 저장·동기화, 뒤로 가기·화면 복귀 포함) 마지막으로 그린 뒤 바뀐 경우에만 편입 표시를 다시 그린다.
function memberRefresh(){ if(ui.tab==="alloc"&&memberRaw!==null&&plannerRaw()!==memberRaw)redrawIdle(); }
addEventListener("storage",e=>{ if(e.key===memberLink.PLANNER_KEY||e.key===null)memberRefresh(); });
addEventListener("pageshow",memberRefresh);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden)memberRefresh(); });
// 그룹·현금·메모는 기본 접기. 펼침은 현재 화면 메모리에만 두며 다시 그려도 유지하고, 새로 열면 접는다.
const allocOpenCards = new Set();
function setAllocCardOpen(button,open){
  const body=el(button.getAttribute("aria-controls"));if(!body)return;
  body.hidden=!open;button.setAttribute("aria-expanded",String(open));
  const action=open?"접기":"펼치기";
  button.querySelector("[data-alloc-fold-action]").textContent=action;
  button.setAttribute("aria-label",`${button.dataset.foldLabel} ${action}`);
}
// 전체 버튼은 실제 상세의 펼침 상태를 따른다. 검색의 임시 펼침도 반영하되 기록·저장은 바꾸지 않는다.
function updateAllocFoldAll(){
  const buttons=all("[data-alloc-fold-all]");if(!buttons.length)return;
  const folds=[...el("allocView").querySelectorAll("[data-alloc-fold]")];
  const open=folds.length>0&&folds.every(b=>b.getAttribute("aria-expanded")==="true");
  buttons.forEach(button=>{
    button.textContent=open?"전체 접기":"전체 펼치기";
    button.setAttribute("aria-expanded",String(open));
  });
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
  updateAllocFoldAll();
}
// 자산 배분 목표 대비(그룹·종목): 현재 비중 − 목표 비중(%p)을 소수 첫째 자리로 반올림해 '+3.0%'·'-2.0%'처럼 표시한다(음수 반올림도 0에서 먼 쪽).
// 표시한 값이 ±1.0%p 이내면 기본 색, 넘으면 초과(over)·미달(under) 색. 진행 중인 분할매수·분할매도 종목(trading)은 차이가 커도 경고 색 없이 muted로 둔다.
// 종목 목표가 같은 코드·실제 ETF로 연결된 다른 계좌까지 덮으면(purchaseAllocationSummary 행이 둘 이상, 목표가 종목 목표의 합)
// 그 종목 혼자가 아니라 연결 계좌 합계 비중과 연결 목표(분할매수 '전체 계좌'와 같은 기준)를 비교해 '합계 N%'와 함께 표시한다.
// 그룹은 차이가 1.0%p를 넘어도 모든 종목이 회색(gray)이면 muted: 목표 대비가 ±1.0%p 이내이거나 매수중·매도중인 종목.
// 목표 없는 종목은 매수중·매도중이거나, 목표 있는 연결 계좌의 합계 비교가 회색이거나, 비중이 0.0%일 때만 회색이다(어느 목표에도 들지 않은 보유는 그룹 차이로 남긴다).
// 투자구성 분류 줄은 기존 목표까지·목표 초과 금액(gap)을 유지한다. 계산·저장 값은 바꾸지 않는다.
const ALLOC_GAP_LIMIT = 1;
function allocTargetGap(cur, target, trading=false){
  if(finite(target)===null||!Number.isFinite(cur))return null;
  const raw=cur-target, d=Math.sign(raw)*Math.round(Math.abs(raw)*10+1e-9)/10||0, off=Math.abs(d)>ALLOC_GAP_LIMIT;
  return {d, text:`${d>0?"+":""}${nfFixed1.format(d)}%`, state:off&&!trading?d>0?"over":"under":"", muted:off&&trading};
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
  const gapHtml=(g,{why="매수중·매도중 종목이라",basis="현재 비중 − 목표 비중"}={})=>{ if(!g)return "";
    const tip=`목표 대비 ${g.text}p (${basis})${g.state==="over"?" · 목표 초과":g.state==="under"?" · 목표 미달":g.muted?` · ${why} 경고 색을 쓰지 않습니다`:" · 1.0%p 이내"}`;
    return `<b class="target-gap${g.state?` ${g.state}`:""}" title="${escA(tip)}">${g.text}</b>`; };
  const bar=(cur,t)=>{ const top=Math.max(cur,finite(t)||0,.01); return `<span class="bar" aria-hidden="true"><i style="width:${Math.min(100,cur/top*100)}%"></i>${finite(t)!==null?`<em style="left:${Math.min(100,t/top*100)}%"></em>`:""}</span>`; };
  const foldButton=(key,id,label,title)=>{const open=allocOpenCards.has(key);return `<button class="alloc-fold" type="button" data-alloc-fold="${escA(key)}" data-fold-label="${escA(label)}" aria-expanded="${open}" aria-controls="${escA(id)}" aria-label="${escA(label)} ${open?"접기":"펼치기"}">${title}<span class="alloc-fold-action" data-alloc-fold-action>${open?"접기":"펼치기"}</span></button>`;};
  const foldAllButton=(id,extra="")=>`<button class="btn mini${extra}" type="button" id="${id}" data-alloc-fold-all aria-expanded="false" aria-controls="allocItems allocCashBody allocMemoBody">전체 펼치기</button>`;
  const classLabels=new Map(s.regions.flatMap(r=>r.classes.map(c=>[c.id,`${r.name} · ${c.name}`])));
  const regionCards=s.regions.map(r=>`<div class="card region-card"><div class="region-head"><h3>${escA(r.name)}</h3><b>${man(r.value)}</b><span>${pc(s.pct(r.value))}${r.target!==null?` <small>/ 목표 ${pc(r.target)}</small>`:""}</span></div>
    ${r.classes.map(c=>{const v=s.classes.get(c.id)||0,cur=s.pct(v),t=s.targets.classes.get(c.id);return `<button class="class-row" type="button" data-class="${escA(c.id)}"><span class="class-name">${escA(c.name)}${c.cash?` <small>현금</small>`:""}</span><span class="class-val">${man(v)}</span><span class="class-pct">${pc(cur)}<small>${t.target!==null?`목표 ${pc(t.target)}${t.linked?" · 합산":""}`:"목표 없음"}</small></span>${bar(cur,t.target)}${gap(t.target,v)}</button>`;}).join("")}</div>`).join("");
  // 분할매수·분할매도·재매수 편입 표시(읽기 전용, member-link.js). 계산이 실패해도 자산 배분 화면은 그대로 그린다.
  const members=strategy?null:memberInfo(a);
  const memberChips=it=>{
    const m=members?.items.get(it.id);if(!m)return "";
    return `<span class="alloc-links" role="group" aria-label="${escA(it.name)} 플래너 편입 상태">${memberLink.TABS.map(({key,name})=>{
      const list=m[key];
      if(!list.length)return `<span class="alloc-chip off" role="img" aria-label="${name} 미편입"><span aria-hidden="true">–</span>${name}</span>`;
      const guess=list.some(x=>x.how==="name"||x.how==="fuzzy"), many=list.length>1;
      const tip=`${name} 탭 · ${list.map(x=>x.label).join(" · ")}${many?" (눌러서 첫 번째로 이동)":" (눌러서 이동)"}${guess?" · 이름이 비슷해 같은 종목으로 추정했습니다. 확인하세요.":""}`;
      return `<a class="alloc-chip on${guess?" guess":""}" href="${escA(memberLink.href(key,list[0].id))}" title="${escA(tip)}" aria-label="${escA(`${name} 편입됨${many?` ${list.length}개`:""}${guess?" 추정":""}, 누르면 ${name} 탭으로 이동`)}"><span aria-hidden="true">✓</span>${name}${many?`<b class="chip-count">${list.length}</b>`:""}${guess?'<i class="chip-guess">추정</i>':""}</a>`;
    }).join("")}</span>`;
  };
  const memberPanel=()=>{
    if(!members)return "";
    const rows=a.groups.flatMap(g=>g.items.map(it=>({g,it}))), nameOf=(x,dup)=>escA(dup.get(x.it.name)>1?`${x.it.name} (${x.g.name})`:x.it.name);
    const tabs=memberLink.TABS.map(({key,name})=>{
      const miss=rows.filter(x=>!members.items.get(x.it.id)[key].length), dup=new Map();
      for(const x of miss)dup.set(x.it.name,(dup.get(x.it.name)||0)+1);
      return {key,name,have:rows.length-miss.length,miss:miss.map(x=>nameOf(x,dup))};
    });
    const tabName=key=>memberLink.TABS.find(t=>t.key===key).name;
    return `<details class="card alloc-members" id="allocMembers"${memberPanelOpen?" open":""}><summary><b>플래너 편입 점검</b><span>${tabs.map(t=>`${t.name} ${t.have}/${rows.length}`).join(" · ")}${members.guesses.length?` · 추정 ${members.guesses.length}건`:""}</span></summary><div class="alloc-members-body">
      ${tabs.map(t=>`<p><b>${t.name} 미편입 ${t.miss.length}개</b>${t.miss.length?`<span>${t.miss.join(" · ")}</span>`:""}</p>`).join("")}
      <p><b>이름으로 추정해 연결한 ${members.guesses.length}건</b>${members.guesses.length?`<span>${members.guesses.map(g=>`${escA(g.item.name)} ↔ ${tabName(g.tab)} ‘${escA(g.label)}’ (${memberLink.HOW_TEXT[g.how]})`).join(" · ")}</span>`:"<span>없음 — 모두 종목 코드로 연결됐습니다.</span>"}</p>
      ${members.unlinked.length?`<p><b>자산 배분과 연결되지 않은 플래너 항목 ${members.unlinked.length}건</b><span>${members.unlinked.map(u=>`${tabName(u.tab)} ‘${escA(u.label)}’`).join(" · ")}</span></p>`:""}
      <small>종목 코드가 같으면(기준·실제 매수 코드, 대소문자·국내 A 접두 무시) 같은 종목으로 봅니다. 코드로 못 찾은 항목만 이름으로 맞추고, 그 경우 ‘추정’으로 표시합니다.</small></div></details>`;
  };
  // 매수중·매도중: 끝나지 않은 분할매수·분할매도에 편입된 종목(member-link.js trading). 색은 목표 대비 경고 색과 따로 정한다.
  const tradeBadge=(list,kind,text,tab)=>list.length?`<span class="trade-state ${kind}" title="${escA(`${tab} 진행 중 · ${list.map(x=>x.label).join(" · ")}${list.every(x=>x.how==="name"||x.how==="fuzzy")?" · 이름이 비슷해 같은 종목으로 추정했습니다":""}`)}">${text}</span>`:"";
  const tradeOf=it=>memberLink.trading(members?.items.get(it.id)), busy=it=>{ const tr=tradeOf(it); return tr.buy.length>0||tr.sell.length>0; };
  // 종목 목표 대비(종목 줄과 그룹 판단이 함께 쓴다): html = 줄에 넣을 차이, gray = 경고 색이 없는지(위 allocTargetGap 주석).
  const itemGaps=new Map(), itemGap=it=>{ if(itemGaps.has(it.id))return itemGaps.get(it.id);
    const cur=s.pct(s.items.get(it.id).value), t=finite(it.target), trading=busy(it), link=purchaseAllocationSummary(a,prices,it,null,s), linked=link.rows.length>1&&link.scope==="item";
    const g=linked?allocTargetGap(link.pct,link.target,trading):allocTargetGap(cur,t,trading);
    const html=t===null?"":linked?`<span class="gap-line"><small>합계 ${pc(link.pct)}</small>${gapHtml(g,{basis:`연결 계좌 ${link.rows.length}개 합계 ${pc(link.pct)} − 목표 ${pc(link.target)}`})}</span>`:gapHtml(g);
    const out={html,gray:g?g.state==="":trading||allocTargetGap(cur,0).d===0};itemGaps.set(it.id,out);return out; };
  const itemRow=it=>{ const r=s.items.get(it.id), cur=s.pct(r.value), t=finite(it.target), stock=prices?.stocks?.[assetTradeTicker(it)], trade=tradeOf(it);
    const how=r.how==="shares"?`<small class="how holding">${nfShares.format(it.shares)}주${r.q?` × <span class="holding-price">${quoteText(r.q,true)}</span>`:""}</small>`:r.how==="ratio"?`<small class="how live">입력 ${man(it.amount)} ${r.value>=it.amount?"+":"−"}${pc(Math.abs(r.value/it.amount-1)*100)}</small>`:it.ticker&&prices?stock?.error?'<small class="how quote-status"><span aria-hidden="true">!</span> 시세 조회 실패</small>':'<small class="how">시세 대기</small>':"";
    return `<div class="asset-row${it.done?" done":""}" data-alloc-item="${escA(it.id)}"><label class="check" title="점검완료 · 직접 표시, 계산에 영향 없음"><input type="checkbox" data-done="${escA(it.id)}"${it.done?" checked":""} aria-label="${escA(it.name)} 점검완료 (직접 표시)"></label>
      <button class="asset-name" type="button" data-item="${escA(it.id)}"><strong>${escA(it.name)}${tradeBadge(trade.buy,"buy","매수중","분할매수")}${tradeBadge(trade.sell,"sell","매도중","분할매도")}</strong><small>${[tracksETF(it)?`기준 ${escA(String(it.ticker).toUpperCase())} → 매수 ${escA(assetTradeTicker(it))}`:it.ticker&&String(it.ticker).toUpperCase()!==String(it.name).trim().toUpperCase()?escA(String(it.ticker).toUpperCase()):"",r.how!=="shares"?quoteText(r.q):"",r.how!=="shares"&&finite(it.shares)!==null?`${nfShares.format(it.shares)}주`:""].filter(Boolean).join(" · ")}</small></button>
      <span class="asset-figures"><span class="asset-val">${man(r.value)}${how}</span><span class="asset-pct"><span>현재 ${pc(cur)}</span>${t!==null?`<small>목표 ${pc(t)}</small>${itemGap(it).html}`:""}</span></span>
      ${it.note?`<p class="asset-note" title="${escA(it.note)}"><span class="alloc-note-label">메모</span>${noteLineA(it.note)}</p>`:""}${memberChips(it)}</div>`; };
  const groupCard=g=>{ const v=s.groups.get(g.id)||0, target=s.targets.groups.get(g.id),t=target.target, plain=g.items.filter(it=>!it.section), names=[...new Set([...(g.sections||[]).map(x=>x.name),...g.items.map(it=>it.section).filter(Boolean)])];
    const sec=name=>{const meta=(g.sections||[]).find(x=>x.name===name)||{},sv=s.section(g.id,name),st=s.targets.section(g.id,name);return `<div class="sub-head"><b>${escA(name)}</b><span>${man(sv)} · ${pc(s.pct(sv))}${st.target!==null?` / 목표 ${pc(st.target)}${st.linked?" · 종목 합산":""}`:""}</span>${meta.note?`<small title="${escA(meta.note)}">${noteLineA(meta.note)}</small>`:""}</div>`;};
    const key=`group:${g.id}`,bodyId=`allocGroup-${encodeURIComponent(g.id)}`;
    return `<section class="card group-card"><div class="group-head"><div class="title-row"><h3>${foldButton(key,bodyId,`${g.name} 상세`,`<span>${escA(g.name)}</span>`)}</h3><button class="btn icon-btn" type="button" data-group="${escA(g.id)}" aria-label="${escA(g.name)} 그룹 수정" title="그룹 수정">${PEN}</button></div>
      <p><b>${man(v)}</b> · ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)} (${man(t/100*s.base)})${target.linked?" · 하위 합산":""} · <span class="group-gap">목표 대비 ${gapHtml(allocTargetGap(s.pct(v),t,g.items.length>0&&g.items.every(it=>itemGap(it).gray)),{why:"종목마다 1.0%p 이내이거나 매수중·매도중이라"})}</span>`:""}</p></div>
      <div class="alloc-fold-body" id="${escA(bodyId)}"${allocOpenCards.has(key)?"":" hidden"}>
      ${g.note?`<p class="group-note" title="${escA(g.note)}"><span class="alloc-note-label">메모</span>${noteLineA(g.note)}</p>`:""}
      ${plain.map(itemRow).join("")}${names.map(n=>`<div class="asset-section">${sec(n)}${g.items.filter(it=>it.section===n).map(itemRow).join("")}</div>`).join("")}
      ${g.items.length?"":`<p class="group-empty">종목 없음</p>`}<div class="group-foot"><button class="btn mini ghost" type="button" data-add-item="${escA(g.id)}">＋ 종목</button></div></div></section>`; };
  // 연속한 같은 분류만 묶는다. 중국 블록만 마지막 인도 블록 바로 뒤로 옮기고, 나머지 순서와 저장 기록은 유지한다.
  const detailBlocks=[];
  for(const g of a.groups){
    const prev=detailBlocks[detailBlocks.length-1];
    if(prev&&prev.classId===g.classId)prev.groups.push(g);
    else detailBlocks.push({classId:g.classId,label:classLabels.get(g.classId)||"분류 없음",groups:[g]});
  }
  const overseasClasses=s.regions.find(r=>r.name==="해외")?.classes||[];
  const chinaIds=new Set(overseasClasses.filter(c=>c.name==="중국").map(c=>c.id));
  const indiaIds=new Set(overseasClasses.filter(c=>c.name==="인도").map(c=>c.id));
  const chinaBlocks=detailBlocks.filter(b=>chinaIds.has(b.classId));
  const otherBlocks=detailBlocks.filter(b=>!chinaIds.has(b.classId));
  const india=otherBlocks.map(b=>indiaIds.has(b.classId)).lastIndexOf(true);
  if(india>=0&&chinaBlocks.length){
    otherBlocks.splice(india+1,0,...chinaBlocks);
    detailBlocks.splice(0,detailBlocks.length,...otherBlocks);
  }
  const detail=detailBlocks.map(b=>`<div class="alloc-class"><div class="class-label">${escA(b.label)}</div>${b.groups.map(groupCard).join("")}</div>`).join("");
  const cashRows=a.cash.map(c=>`<button class="cash-row" type="button" data-cash="${escA(c.id)}"><span class="cash-place">${escA(c.place||"")}</span><strong>${escA(c.name)}${c.minus?` <small>차감</small>`:""}</strong><span class="cash-amt">${c.currency==="USD"?`$${nf2.format(finite(c.amount)||0)}`:wonA(c.amount)}</span><b>${c.minus?"−":""}${man(Math.abs(cashValue(c,s.fx)))}</b></button>`).join("");
  const totalText=allocationTotalText(a.total), totalPlaceholder=allocationTotalText(s.grand), totalWidth=v=>`${Math.max(3,v.replace(/[억만원]/g,"00").length)+.6}ch`;
  view.innerHTML=`<div class="heading${strategy?"":" alloc-heading"}"><div><div class="eyebrow">${strategy?"지역과 자산군별 배분":"종목과 현금"}</div>${strategy?"<h1>투자구성</h1>":`<div class="title-row"><h1>자산 배분</h1>${foldAllButton("toggleAllocAll")}</div>`}<p>${strategy?"지역·자산 분류별 현재 비중과 목표를 한눈에 확인합니다. 목표 비중은 종목별에서 수정하면 소분류·그룹·분류에 자동 합산됩니다.":"금액은 만원 단위, 비중은 기준 총자산 대비입니다. 종목 이름을 눌러 목표를 수정하세요. 체크는 점검을 끝냈다는 직접 표시입니다."}</p></div></div>
    <div class="card metrics"><div class="metric"><label for="allocTotal">기준 총자산 (비중 기준)</label><label class="metric-edit"><input id="allocTotal" type="text" enterkeyhint="done" autocomplete="off" spellcheck="false" value="${totalText}" placeholder="${totalPlaceholder}" aria-describedby="allocTotalHint" style="width:${totalWidth(totalText||totalPlaceholder)}">${PEN}</label><small id="allocTotalHint">억·만원으로 입력 · 숫자만 넣으면 만원</small><small>종목 + 현금 합계 ${man(s.grand)}${plus(a.total)?` · 차이 ${s.grand>=a.total?"+":"−"}${man(Math.abs(s.grand-a.total))}`:" · 비우면 합계 기준"}</small></div>
      <div class="metric"><label>투자 평가액</label><strong>${man(s.invest)}</strong><small>시세 반영 ${live} / ${count}개 종목${prices?.updatedAt?` · 시세 파일 ${new Date(prices.updatedAt).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}`:""}</small></div>
      <div class="metric"><label>현금</label><strong class="cash-value"><span>${man(s.cash)}</span><span class="cash-pct" title="기준 총자산 대비 비중">(${cashPct})</span></strong><small>${usd?`달러 $${nf2.format(usd)} · `:""}${fxNote}</small></div></div>
    ${strategy?`<div class="section-heading"><h2>배분 개요</h2><span>지역별 합계와 목표 · 목표 합계 ${pc(s.regions.some(r=>r.target!==null)?s.regions.reduce((n,r)=>n+(r.target??0),0):null)}</span><button class="btn mini" type="button" id="addClass">＋ 분류</button></div>
    <div class="region-grid">${regionCards||`<div class="card empty">분류가 없습니다</div>`}</div>
    <p class="footnote">모든 목표 비중은 기준 총자산 대비입니다. 하위 목표가 하나라도 있으면 그 합계를 쓰고, 전부 비어 있으면 직접 입력한 목표를 씁니다. 목표 없는 종목 ${a.groups.reduce((n,g)=>n+g.items.filter(it=>finite(it.target)===null).length,0)}개.</p>`:`<div class="section-heading"><h2>종목별</h2><span>그룹 ${a.groups.length}개 · 종목 ${count}개</span><div class="alloc-actions"><button class="btn mini" type="button" id="clearAllocDone" title="검색 결과와 관계없이 모든 종목의 점검완료를 해제합니다."${reviewed?"":" disabled"}>점검완료 일괄해제</button><button class="btn mini" type="button" id="addGroup">＋ 그룹</button></div></div>
    ${memberPanel()}
    <div class="alloc-search"><label class="field"><span>종목 검색</span><input id="allocSearch" type="search" value="${escA(allocQuery)}" placeholder="종목명 · 코드 · 그룹 · 소분류" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-controls="allocItems" aria-describedby="allocSearchStatus"></label><button class="btn hidden" id="allocSearchClear" type="button">초기화</button><div class="alloc-search-meta"><p class="hint" id="allocSearchStatus" role="status" aria-live="polite" aria-atomic="true"></p>${foldAllButton("toggleAllocAllMobile"," alloc-fold-all-mobile")}</div></div>
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
      updateAllocFoldAll();
      if(document.activeElement!==button)document.activeElement?.blur();
      [...view.querySelectorAll("[data-alloc-fold]")].find(b=>b.dataset.allocFold===key)?.focus({preventScroll:true});
    };
  });
  view.querySelectorAll("[data-alloc-fold-all]").forEach(toggleAll=>{
    toggleAll.onpointerdown=e=>{if(e.button===0)e.preventDefault();};
    toggleAll.onclick=()=>{
      const folds=[...view.querySelectorAll("[data-alloc-fold]")];
      const open=!folds.every(b=>b.getAttribute("aria-expanded")==="true");
      folds.forEach(button=>{
        const key=button.dataset.allocFold;
        if(open)allocOpenCards.add(key);else allocOpenCards.delete(key);
        setAllocCardOpen(button,open);
      });
      updateAllocFoldAll();
      if(document.activeElement!==toggleAll)document.activeElement?.blur();
      el(toggleAll.id)?.focus({preventScroll:true});
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
  const panel=el("allocMembers");if(panel)panel.ontoggle=()=>{memberPanelOpen=panel.open;};
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
// 분할매수 계획은 한 줄(buyPlan)에 저장하지만 같은 종목 코드의 계좌 줄 전체가 함께 쓴다. 줄·그룹 삭제로 계획이 붙은 줄이 빠지면 기준 코드·실제 매수 코드가 같은
// 남는 줄 중 매수 우선순위(buyPriority, 없으면 계획 줄 → 자산 목록 순서)가 가장 앞선 줄로 계획을 옮긴다. 체결 반영 키 'buy:줄 id:회차'도 새 줄 id로 바꾸고
// 우선순위에서 지운 줄 id를 뺀다(알림 ID trade:buy:줄 id:…도 새 줄 id가 된다). 남는 같은 종목 줄에 이미 계획이 있거나(중복) 옮길 줄·코드가 없으면 계획도 지운다.
// dry면 기록을 바꾸지 않고 {moved:[{from,to}], lost:[줄]}만 돌려준다(삭제 확인 문구용).
function keepBuyPlans(alloc, removed, dry=false){
  const all=(alloc.groups||[]).flatMap(g=>g.items||[]), ids=new Set([...removed].map(it=>it.id)), taken=new Set(all.filter(it=>it.buyPlan&&!removed.has(it))), out={moved:[],lost:[]};
  for(const from of all.filter(it=>it.buyPlan&&removed.has(it))){
    const plan=from.buyPlan, code=linkTicker(from.ticker), trade=linkTicker(assetTradeTicker(from)), rank=new Map();
    for(const id of [...(Array.isArray(plan.buyPriority)?plan.buyPriority:[]),from.id])if(!rank.has(id))rank.set(id,rank.size);
    const same=code?all.filter(it=>!removed.has(it)&&linkTicker(it.ticker)===code&&linkTicker(assetTradeTicker(it))===trade):[];
    const to=same.some(it=>taken.has(it))?null:same.sort((x,y)=>(rank.get(x.id)??Infinity)-(rank.get(y.id)??Infinity))[0];
    if(!to){out.lost.push(from);continue;}
    taken.add(to);out.moved.push({from,to});if(dry)continue;
    const order=Array.isArray(plan.buyPriority)?plan.buyPriority.filter(id=>!ids.has(id)):[];
    if(order.length)plan.buyPriority=order;else delete plan.buyPriority;
    to.buyPlan=plan;delete from.buyPlan;
    const prefix=`buy:${from.id}:`;
    for(const key of Object.keys(alloc.trades||{}))if(key.startsWith(prefix)){alloc.trades[`buy:${to.id}:${key.slice(prefix.length)}`]=alloc.trades[key];delete alloc.trades[key];}
  }
  return out;
}
// 같은 종목의 목표 비중은 대표 계좌 줄 하나에 둔다. 목표가 있는 줄을 지우면 같은 그룹·소분류에 남는 같은 기준 코드 줄로 목표를 옮긴다
// (분할매수 계획이 있거나 옮겨 갈 줄이 우선, 없으면 자산 목록 순서). 받는 줄에 목표가 있으면 더해 종목 목표 합계를 유지한다. 옮길 줄이 없으면 목표도 함께 지운다.
// moved는 keepBuyPlans가 돌려준 계획 이전 목록. dry면 기록을 바꾸지 않고 [{from,to,target}]만 돌려준다.
function keepTargets(alloc, removed, moved, dry=false){
  const out=[];
  for(const g of alloc.groups||[])for(const from of g.items||[]){
    const target=finite(from.target), code=linkTicker(from.ticker);if(!removed.has(from)||target===null||!code)continue;
    const same=(g.items||[]).filter(it=>!removed.has(it)&&linkTicker(it.ticker)===code&&(it.section||"")===(from.section||""));
    const to=same.find(it=>it.buyPlan||moved.some(m=>m.to===it))||same[0];if(!to)continue;
    out.push({from,to,target});if(dry)continue;
    to.target=Math.round(((finite(to.target)||0)+target)*1e8)/1e8;delete from.target;
  }
  return out;
}
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
  el("itemDelete").onclick=()=>{
    const removed=new Set([it]), keep=keepBuyPlans(a,removed,true), to=keep.moved[0]?.to, goal=keepTargets(a,removed,keep.moved,true)[0], code=linkTicker(it.ticker), twins=!!code&&a.groups.some(g=>g.items.some(x=>x!==it&&linkTicker(x.ticker)===code));
    const notes=[to?`분할매수 계획과 체결 기록은 같은 종목의 '${to.name}' 줄로 옮겨 유지합니다.`:"",goal?`목표 비중 ${pc(goal.target)}는 '${goal.to.name}' 줄로 옮깁니다.`:twins&&finite(it.target)!==null?`이 줄의 목표 비중 ${pc(it.target)}는 함께 지워집니다.`:""].filter(Boolean);
    if(!confirm(`'${it.name}' 종목${keep.lost.length?"과 분할매수 계획":""}을 삭제할까요?${notes.map(n=>`\n${n}`).join("")}`)) return;
    keepTargets(a,removed,keepBuyPlans(a,removed).moved); found.g.items=found.g.items.filter(x=>x!==it); saveSection("allocation"); dlg("itemDialog").close(); render(); };
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
  el("groupDelete").onclick=()=>{
    const removed=new Set(g.items), keep=keepBuyPlans(a,removed,true);
    const notes=[keep.moved.length?`분할매수 계획은 같은 종목의 다른 계좌 줄로 옮겨 유지합니다: ${keep.moved.map(m=>`${m.from.name} → ${m.to.name}`).join(", ")}`:"",keep.lost.length?`분할매수 계획도 함께 삭제됩니다: ${keep.lost.map(x=>x.name).join(", ")}`:""].filter(Boolean);
    if(!confirm(`'${g.name}' 그룹${g.items.length?`과 종목 ${g.items.length}개`:""}를 삭제할까요?${notes.map(n=>`\n${n}`).join("")}`)) return;
    keepBuyPlans(a,removed); a.groups=a.groups.filter(x=>x!==g); saveSection("allocation"); dlg("groupDialog").close(); render(); };
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
