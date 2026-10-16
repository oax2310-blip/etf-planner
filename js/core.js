// 공통 상수·입력 도우미·state·탭. 저장은 sync.js, 이동평균 단계는 ma-ladder.js, 기능 화면은 각 모듈.
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
const seeded = {plans:[],futures:defaultFutures(),actions:{},selectedPlan:null,tab:"plans"}; // actions는 옛 기록 호환용이며 새 기기는 {}만 둔다.
const hadStoredState = localStorage.getItem(STORAGE_KEY) !== null;
let state;
try { state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || seeded; } catch { state = seeded; }
// 새 입력 필드(rebuy·alerts·futures.rebuy·rollSpread·lossPrice 등)를 여기서 채우지 않는다.
// 옛 재매수를 목록으로 바꾸면 기기별 id로 스냅샷이 달라진다(생성·이전은 각 모듈의 edit 함수).
function normalize(target=state){
  target.plans = Array.isArray(target.plans) ? target.plans : [];
  target.plans.forEach(p=>{const n=Number(p.stages),count=Number.isInteger(n)&&n>=1&&n<=250?n:2;if(p.stages!==undefined)p.stages=count;p.checked=Array.from({length:count},(_,i)=>p.checked?.[i]===true);p.holdings=Array.isArray(p.holdings)?p.holdings:[];p.note=p.note||"";});
  target.futures = target.futures || defaultFutures(); target.futures.positions = Array.isArray(target.futures.positions) ? target.futures.positions : []; target.actions = target.actions || {};
  ensureFutureMovingLines(target.futures);
  if(!target.selectedPlan || !target.plans.some(p=>p.id===target.selectedPlan)) target.selectedPlan=target.plans[0]?.id||null;
  target.tab = target.tab || "plans";
}
normalize();
function openTab(tab,redraw=true){ state.tab=["plans","buys","futures","rebuy"].includes(tab)?tab:"plans"; tab=state.tab; save(); $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab)); ["plans","buys","futures","rebuy"].forEach(x=>$(x+"View").classList.toggle("hidden",x!==tab)); if(redraw)render(); }
function openPlannerLocation(){
  if(typeof openPushAlertFromHash==="function"&&openPushAlertFromHash())return;
  if(typeof clearPushAlertTarget==="function")clearPushAlertTarget();
  if(typeof memberGo==="object"&&memberGo.open())return; // 자산 배분의 편입 표시에서 온 이동(#go?…)
  openTab(location.hash.slice(1)||state.tab);
}
$$(".tab[data-tab]").forEach(b=>b.addEventListener("click",()=>{ if(typeof clearPushAlertTarget==="function")clearPushAlertTarget(); openTab(b.dataset.tab); history.replaceState(null,"",`#${state.tab}`); scrollTo(0,0); })); // .tab-link(자산 페이지로 가는 링크)는 제외
addEventListener("hashchange",openPlannerLocation);
const topBar=document.querySelector(".top"), topTabs=topBar.querySelector(".tabs");
// 모바일 top의 음수 top(--tuck): 스크롤하면 탭 줄만 남긴다. 탭 클릭은 위의 핸들러에서 맨 위로 이동.
function fitTop(){ topBar.style.setProperty("--tuck",Math.max(0,topTabs.offsetTop-8)+"px"); }
fitTop(); addEventListener("resize",fitTop);
// PC 왼쪽 목록 칸(.side)의 높이 기준(--side-top, css/app.css): 붙은 위치(top) 또는 페이지 맨 위처럼 아직 아래에 있는 지금 위치.
// 칸 아래가 화면 밖에 가려지지 않게 스크롤·창 크기·다시 그리기 때 보이는 칸에만 맞춘다. 모바일(1000px 이하)은 계산하지 않는다.
let wideLayout=null, sideFrame=0;
function fitSide(){
  const side=(wideLayout??=matchMedia("(min-width:1001px)")).matches&&[...$$(".layout>.side")].find(x=>x.getClientRects().length); if(!side)return;
  const top=Math.round(Math.max(parseFloat(getComputedStyle(side).top)||0,side.getBoundingClientRect().top))+"px";
  if(side.style.getPropertyValue("--side-top")!==top)side.style.setProperty("--side-top",top);
}
const fitSideSoon=()=>{ if(!sideFrame)sideFrame=requestAnimationFrame(()=>{sideFrame=0;fitSide();}); };
addEventListener("scroll",fitSideSoon,{passive:true}); addEventListener("resize",fitSideSoon);
// 왼쪽 목록(.plan-list)이 PC에서 따로 스크롤할 때: 다시 그려도(분할매수는 목록을 새로 만든다) 보던 위치를 지키고,
// 고른 카드가 바뀐 때(처음 열기·카드 선택·알림·자산 배분에서 이동)만 그 카드가 보이게 목록만 움직인다. 페이지 스크롤은 건드리지 않는다.
const planListSpots={};
function keepPlanListView(list,picked){
  fitSide(); if(!list?.getClientRects().length)return;
  const spot=planListSpots[list.id]??={top:0}; list.scrollTop=spot.top; list.onscroll=()=>{spot.top=list.scrollTop;};
  if(spot.picked===picked)return; spot.picked=picked;
  const item=list.querySelector(".plan-item.active"), pad=parseFloat(getComputedStyle(list).paddingTop)||0; if(!item||list.scrollHeight<=list.clientHeight)return;
  const box=list.getBoundingClientRect(), r=item.getBoundingClientRect();
  if(r.top<box.top+pad)list.scrollTop-=box.top+pad-r.top; else if(r.bottom>box.bottom-pad)list.scrollTop+=r.bottom-box.bottom+pad;
}
function render(){ if(typeof applyPendingPushAlert==="function")applyPendingPushAlert(); if(state.tab==="buys") purchasePlanner.render(); if(state.tab==="plans") renderPlans(); if(state.tab==="futures") renderFutures(); if(state.tab==="rebuy") renderRebuy(); if(typeof renderAlerts==="function")renderAlerts(); if(typeof renderAlertHistory==="function")renderAlertHistory(); if(typeof schedulePendingPushAlert==="function")schedulePendingPushAlert(); if(typeof memberGo==="object")memberGo.schedule(); }
