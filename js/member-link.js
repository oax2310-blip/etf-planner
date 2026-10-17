// 자산 배분 종목이 플래너 분할매수·분할매도·재매수 탭에 편입돼 있는지 찾는 읽기 전용 계산과 이동 주소. 화면은 assets.js, 이동은 member-go.js.
// 어떤 기록도 바꾸거나 새 필드를 만들지 않는다(플래너 기록은 localStorage를 읽기만 한다).
// 연결 근거(how): id = 분할매수 계획이 붙은 종목 자신, code = 종목 코드 일치(linkTicker 규칙: 대문자·국내 'A' 접두 무시·'비트코인'=BTC-USD, 기준·실제 매수 코드 모두),
//   name = 코드로는 못 찾아 정규화한 이름이 같은 경우, fuzzy = 이름이 비슷한 경우(bigram 유사도 ≥ .85, 4자 이상). name·fuzzy는 '추정'으로 따로 알린다.
// 분할매수는 purchaseAllocationSummary의 연결 종목(같은 코드의 다른 계좌·추종 ETF)까지 편입으로 본다. 이름 비교는 코드 일치가 하나도 없는 항목에만 쓴다.
// 끝난 분할매수·분할매도 계획의 연결에는 done:true를 붙이고, 끝나지 않은 연결만 자산 배분의 '매수중'·'매도중'으로 센다(trading).
const memberLink = (()=>{
const PLANNER_KEY = "etf-exit-planner-standalone-v1"; // js/core.js STORAGE_KEY와 같다(tests/member-link.test.cjs가 확인)
const PRICE_KEY = "etf-planner-prices"; // js/sync.js PRICE_KEY와 같다 — 플래너가 이 기기에 둔 시세(이동평균 ma 포함). 읽기만 한다.
const TABS = [{key:"buys",name:"분할매수"},{key:"plans",name:"분할매도"},{key:"rebuy",name:"재매수"}];
const HOW_TEXT = {id:"계획이 붙은 종목",code:"종목 코드 일치",name:"이름이 같음",fuzzy:"이름이 비슷함"};
const obj = v => !!v&&typeof v==="object"&&!Array.isArray(v);
const text = v => typeof v==="string"||typeof v==="number" ? String(v).trim() : "";
// 이름 비교용: 호환 문자 통일·소문자·ETF/ETN 단어 제거·글자와 숫자만 남김('KODEX 200'='kodex200', 'S&P 500'='sp500').
const norm = s => String(s??"").normalize("NFKC").toLowerCase().replace(/\b(?:etf|etn)\b/g," ").replace(/[^\p{L}\p{N}]+/gu,"");
function dice(a, b){
  const grams = s => { const m=new Map(); for(let i=0;i<s.length-1;i++){ const g=s.slice(i,i+2); m.set(g,(m.get(g)||0)+1); } return m; };
  const x=grams(a), y=grams(b); let hit=0;
  for(const [g,n] of x) hit+=Math.min(n,y.get(g)||0);
  return a.length>1&&b.length>1 ? 2*hit/(a.length+b.length-2) : 0;
}
// 두 이름 목록의 가장 가까운 관계 {how, score} 또는 null.
function nameRelation(entryNames, itemNames){
  let best=null;
  for(const raw of entryNames)for(const other of itemNames){
    const a=norm(raw), b=norm(other);if(a.length<2||b.length<2)continue;
    const rel=a===b ? {how:"name",score:1} : Math.min(a.length,b.length)>=4&&dice(a,b)>=.85 ? {how:"fuzzy",score:dice(a,b)} : null;
    if(rel&&(!best||rel.score>best.score))best=rel;
  }
  return best;
}
// 분할매도 계획 완료: 모든 회차가 체크(전량 체결)됨 — plans.js의 '매도 완료'와 같고, 회차 수는 core.js normalize처럼 1~250 정수가 아니면 2.
const sellDone = p => { const n=Number(p.stages), count=Number.isInteger(n)&&n>=1&&n<=250?n:2; return Array.from({length:count},(_,i)=>p.checked?.[i]===true).every(Boolean); };
// 플래너 기록(localStorage 원문)에서 분할매도 계획·재매수 종목을 읽는다. 타입이 맞지 않는 값은 건너뛰고, 같은 원문이면 다시 해석하지 않는다.
let lastRaw=null, lastLists={plans:[],rebuy:[]};
function lists(state){
  const plans=(Array.isArray(state?.plans)?state.plans:[]).map((p,i)=>obj(p)?{kind:"plans",id:text(p.id)||`#${i}`,code:text(p.ticker),names:[text(p.cardName),text(p.title)].filter(Boolean),label:text(p.cardName)||text(p.title)||text(p.ticker)||"이름 없음",done:sellDone(p)}:null).filter(Boolean);
  const rb=state?.rebuy, items=!obj(rb)?[]:Array.isArray(rb.items)?rb.items.filter(obj):[rb];
  const rebuy=items.map((r,i)=>({kind:"rebuy",id:text(r.id)||`#${i}`,code:text(r.ticker),names:[text(r.name),text(r.cardName)].filter(Boolean),label:text(r.name)||text(r.ticker)||"이름 없음"}));
  return {plans,rebuy};
}
function read(){
  let raw="";try{raw=localStorage.getItem(PLANNER_KEY)||"";}catch{}
  if(raw===lastRaw)return lastLists;
  let state=null;try{state=raw?JSON.parse(raw):null;}catch{}
  lastRaw=raw;lastLists=lists(state);return lastLists;
}
// 플래너 시세의 종목들(stocks). 없거나 깨졌으면 null이며, 같은 원문이면 다시 해석하지 않는다.
let lastPriceRaw=null, lastStocks=null;
function readStocks(){
  let raw="";try{raw=localStorage.getItem(PRICE_KEY)||"";}catch{}
  if(raw===lastPriceRaw)return lastStocks;
  let d=null;try{d=raw?JSON.parse(raw):null;}catch{}
  lastPriceRaw=raw;lastStocks=obj(d?.stocks)?d.stocks:null;return lastStocks;
}
// purchases.js lineEntry와 같은 이동평균 시세: 대문자 종목 코드, 기준일·ma가 있고 시세 종류가 코드 시장과 같을 때만.
function lineEntry(stocks, ticker){
  const key=String(ticker||"").trim().toUpperCase(), e=stocks&&Object.hasOwn(stocks,key)?stocks[key]:null;
  return obj(e)&&/^\d{4}-\d{2}-\d{2}$/.test(e.asOf)&&e.ma&&typeof e.ma==="object"&&e.kind===purchaseQuoteKind(ticker)?e:null;
}
// 분할매수 계획 완료: 플래너 분할매수 화면의 '매수 완료'(purchases.js renderPurchases — 회차가 있고 모두 체결)와 같은 계산·입력(lineOptions)을 쓴다.
// 이동평균선 돌파 회차는 위 시세의 ma로 만들고, 매수대기는 회차가 없어 끝나지 않는다. 계산할 수 없으면 끝나지 않은 것으로 본다
// (이동평균 시세가 없으면 남은 회차를 알 수 없으므로 산 회차가 모두 끝나고 총 매수 금액도 남지 않았을 때만 완료).
function buyDone(alloc, prices, it, summary, stocks){
  try{
    const plan=it.buyPlan, entry=plan.lines?lineEntry(stocks,it.ticker):null, target=purchaseTargets(alloc,prices,it,plan,summary)[0]?.it||it;
    const currency=plan.currency||assetQuote(prices,it.ticker)?.currency||(tracksETF(it)&&purchaseQuoteKind(it.ticker)==="해외"?"USD":"KRW");
    const p=purchaseSummary(plan,entry,{item:it,target,allocation:alloc,prices,fx:assetFx(prices,alloc),currency});
    return p.count>0&&p.done===p.count&&(!plan.lines||!!entry||p.remaining<1e-6);
  }catch{return false;}
}
// 분할매도·재매수 항목 하나가 연결되는 자산 종목들: 코드 일치가 있으면 그것만(code), 없으면 이름이 가장 가까운 종목들(name 또는 fuzzy).
function match(entry, items){
  const key=linkTicker(entry.code);
  const byCode=key?items.filter(({it})=>linkTicker(it.ticker)===key||linkTicker(assetTradeTicker(it))===key):[];
  if(byCode.length)return byCode.map(({it})=>({it,how:"code"}));
  const names=[...entry.names,entry.code].filter(Boolean);
  const near=names.length?items.map(({it})=>({it,rel:nameRelation(names,[it.name,it.ticker])})).filter(x=>x.rel):[];
  const top=near.reduce((n,x)=>Math.max(n,x.rel.score),0);
  return near.filter(x=>x.rel.score===top).map(x=>({it:x.it,how:x.rel.how}));
}
// label은 플래너 카드와 같은 이름(카드 이름 → 계획·종목 이름 → 종목 코드, stock-names.js).
// 결과: items = Map(자산 종목 id → {buys,plans,rebuy: [{id,label,how,done?}…]}), guesses = 추정 연결 [{item,tab,label,how}], unlinked = 자산 배분에 연결되지 않은 플래너 항목 [{tab,label}].
// done은 끝난 분할매수·분할매도 계획에만 true로 붙는다. stocks는 이동평균선 돌파 분할매수의 완료 판단에 쓰는 플래너 시세(readStocks).
function collect(alloc, prices, planner=read(), stocks=readStocks()){
  const items=(alloc?.groups||[]).flatMap(g=>(g.items||[]).map(it=>({g,it}))), out=new Map(items.map(({it})=>[it.id,{buys:[],plans:[],rebuy:[]}]));
  const guesses=[], unlinked=[], seen=new Set();
  const add=(tab,it,entry,how)=>{
    const list=out.get(it.id)?.[tab];if(!list||list.some(x=>x.id===entry.id))return;
    list.push({id:entry.id,label:entry.label,how,...(entry.done?{done:true}:{})});
    if(how==="name"||how==="fuzzy"){const k=`${tab}\u0000${entry.id}\u0000${it.id}`;if(!seen.has(k)){seen.add(k);guesses.push({item:it,tab,label:entry.label,how});}}
  };
  const summary=items.some(({it})=>it.buyPlan)?allocationSummary(alloc,prices):null;
  for(const {it} of items){
    if(!it.buyPlan)continue;
    const entry={id:it.id,label:text(it.buyPlan.cardName)||text(it.name)||text(it.ticker)||"이름 없음",done:buyDone(alloc,prices,it,summary,stocks)};
    for(const row of purchaseAllocationSummary(alloc,prices,it,it.buyPlan,summary).rows)add("buys",row.it,entry,row.it.id===it.id?"id":"code");
  }
  for(const tab of ["plans","rebuy"])for(const entry of planner[tab]){
    const hits=match(entry,items);
    if(!hits.length)unlinked.push({tab,label:entry.label});
    for(const {it,how} of hits)add(tab,it,entry,how);
  }
  // 같은 탭에 여러 개면 확실한 연결을 앞에 둔다(누르면 첫 번째로 이동).
  const rank={id:0,code:1,name:2,fuzzy:3};
  for(const m of out.values())for(const {key} of TABS)m[key].sort((x,y)=>rank[x.how]-rank[y.how]);
  return {items:out,guesses,unlinked};
}
// 자산 배분의 '매수중'·'매도중': 끝나지 않은 분할매수·분할매도 연결(collect의 한 종목 결과 m). 재매수는 보지 않는다.
const trading = m => ({buy:(m?.buys||[]).filter(x=>!x.done), sell:(m?.plans||[]).filter(x=>!x.done)});
// 자산 배분 → 플래너 이동 주소. 도착한 플래너가 탭을 열고 그 카드로 이동한다(member-go.js).
const href = (tab, id) => `index.html#go?${new URLSearchParams({tab,id})}`;
function parse(hash){
  if(typeof hash!=="string"||!hash.startsWith("#go?")||hash.length>600)return null;
  const p=new URLSearchParams(hash.slice(4)), tab=p.get("tab"), id=p.get("id");
  return TABS.some(t=>t.key===tab)&&id&&id.length<=200 ? {tab,id} : null;
}
return {TABS,HOW_TEXT,PLANNER_KEY,PRICE_KEY,read,lists,collect,trading,match,href,parse,norm};
})();
