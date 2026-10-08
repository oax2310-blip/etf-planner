// 공통: 상수·도우미($·onEdit 등)·state 불러오기·normalize·탭 전환. 불러오는 순서 core → sync → plans → futures → rebuy
const STORAGE_KEY = "etf-exit-planner-standalone-v1";
const futuresDays = [25,32,42,60,80,125,150];
const contractSize = 10000;
const won = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:0});
const decimal = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:1});
const usd = new Intl.NumberFormat("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
const $ = id => document.getElementById(id), $$ = sel => document.querySelectorAll(sel);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
const money = value => `${won.format(Math.round(value || 0))}원`;
const priceText = (value, currency) => currency === "USD" ? `$${usd.format(value)}` : money(value);
const memoCount = text => `${String(text||"").length.toLocaleString("ko-KR")} / 4,000자`;
const fxText = value => `≈ ₩${won.format(Math.round(value || 0))}`;
const PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'; // 수정 연필 아이콘(분할매도·재매수)
const shown = v => Number.isFinite(Number(v)) ? String(Math.round(Number(v)*1e4)/1e4) : "";
// 입력칸 공통 처리: 값이 바뀌면 set(입력값, 칸)을 부르고 저장한 뒤 redraw로 다시 그린다.
// set이 false를 돌려주면(잘못된 값) 저장하지 않고 다시 그려 원래 값으로 되돌린다. redraw가 없으면 다시 그리지 않는다.
const onEdit = (sel, set, redraw) => $$(sel).forEach(el => el.onchange = () => { if (set(el.value, el) !== false) save(); redraw?.(); });
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const defaultFutures = () => ({targetPrice:1480,baselinePnl:0,positions:[],levels:MA_LINES.map(name=>({days:parseInt(name),unit:movingLineUnit(name),price:0,confirmed:false,contracts:0,tranches:[]})),note:""});
const seeded = {plans:[],futures:defaultFutures(),actions:{},selectedPlan:null,tab:"plans"}; // actions는 옛 기록·동기화 형식 호환용. 실제 데이터는 JSON 복원으로만
const hadStoredState = localStorage.getItem(STORAGE_KEY) !== null;
let state;
try { state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || seeded; } catch { state = seeded; }
function normalize(){
  state.plans = Array.isArray(state.plans) ? state.plans : [];
  state.plans.forEach(p=>{p.checked=Array.from({length:Number(p.stages)||2},(_,i)=>p.checked?.[i]===true);p.holdings=Array.isArray(p.holdings)?p.holdings:[];p.note=p.note||"";});
  state.futures = state.futures || defaultFutures(); state.futures.positions = Array.isArray(state.futures.positions) ? state.futures.positions : []; state.actions = state.actions || {};
  ensureFutureMovingLines(state.futures);
  if(!state.selectedPlan || !state.plans.some(p=>p.id===state.selectedPlan)) state.selectedPlan=state.plans[0]?.id||null;
  state.tab = state.tab || "plans";
}
normalize();
function openTab(tab){ state.tab=["plans","buys","futures","rebuy"].includes(tab)?tab:"plans"; tab=state.tab; save(); $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab)); ["plans","buys","futures","rebuy"].forEach(x=>$(x+"View").classList.toggle("hidden",x!==tab)); render(); }
function openPlannerLocation(){
  if(typeof openPushAlertFromHash==="function"&&openPushAlertFromHash())return;
  if(typeof clearPushAlertTarget==="function")clearPushAlertTarget();
  openTab(location.hash.slice(1)||state.tab);
}
$$(".tab[data-tab]").forEach(b=>b.addEventListener("click",()=>{ if(typeof clearPushAlertTarget==="function")clearPushAlertTarget(); openTab(b.dataset.tab); history.replaceState(null,"",`#${state.tab}`); scrollTo(0,0); })); // .tab-link(자산 페이지로 가는 링크)는 제외
addEventListener("hashchange",openPlannerLocation);
const topBar=document.querySelector(".top"), topTabs=topBar.querySelector(".tabs");
function fitTop(){ topBar.style.setProperty("--tuck",Math.max(0,topTabs.offsetTop-8)+"px"); }
fitTop(); addEventListener("resize",fitTop);
function render(){ if(typeof applyPendingPushAlert==="function"&&applyPendingPushAlert())return; if(state.tab==="buys") purchasePlanner.render(); if(state.tab==="plans") renderPlans(); if(state.tab==="futures") renderFutures(); if(state.tab==="rebuy") renderRebuy(); if(typeof renderAlerts==="function")renderAlerts(); }
