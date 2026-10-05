// 시세 자동 채우기: 데이터 저장소의 etf-planner-prices.json(그 저장소 Actions 'KIS 시세 수집'이 평일마다 갱신)으로 현재가·이동평균선 기준가를 채운다.
// 파일 읽기·채우는 때는 sync.js(readPrices·syncNow), 마지막으로 읽은 시세는 전역 priceData(sync.js). DOM 없이 불러와 테스트하므로 함수 밖에서 화면을 건드리지 말 것.
// 채우는 칸(시세 우선):
//   분할매도 종료 기준가 ← stocks[종목 코드]의 종료 기준선 이름(N일선·N주선·N개월선) 이동평균(maValue) (국내=원화 계획, 해외=달러 계획일 때만).
//     시작 기준가(첫 매도 기준가)는 수정 창에서 시작 기준선을 일·주·개월선으로 고른 계획(startAuto=true)만 같은 방식으로 채운다.
//     '직접'(startAuto 없음, 옛 기록 포함)은 사용자가 정하는 값이라 채우지 않는다(옛 기록의 auto.startPrice는 남아 있어도 안 씀).
//   분할매도 달러 계획 환율 ← fx.USDKRW의 현물 환율(달러선물 보유와 무관). 조회 값이 없으면 마지막 환율 그대로.
//   달러선물 N일선 구간 기준가 ← futures[보유 근월물].ma (안 산 계약 매수가도 같이, 직접 고칠 때와 같음)
//   달러선물 손절 후 재매수(futures.rebuy가 있는 경우만) 현재가·N일선 단계 기준가 ← 같은 보유 근월물. 신저점·손절 하단·이탈 전 계약 수는 직접 정한다.
//   재매수 종목마다(rebuy.items[], 옛 기록은 rebuy 하나 — rebuy.js rebuyItems) 현재가·N일선 단계 기준가 ← stocks[그 종목 코드] (국내 종목만). 분할매도·달러선물 현재가와 분할매도 평가액(plans.js planWorth)은 저장하지 않고 화면에만.
// 비트코인은 stocks["BTC-USD"](kind "코인", Coinbase 달러·UTC 일봉 — 데이터 저장소 scripts/kis_prices.py CRYPTO)로 매 수집에 들어 있다.
//   동기화 창 시세 줄(sync.js priceStatus)과 직접 추가 알림(alerts.js)에만 쓰고 위 칸은 채우지 않는다(분할매도·재매수는 국내·해외 kind만).
// 이동평균은 시세 파일 ma 값, 없으면(수집 스크립트가 아직 계산하지 않은 기준선 — 수정 창에서 새로 고른 N일·N주·N개월선) 보관한 종가(closes)로
//   스크립트와 같은 규칙(종가 단순이동평균, 이번 주·이번 달 봉 포함)으로 바로 계산한다(maValue). 봉이 모자라면 비움 → 다음 수집 때 스크립트가 채움.
// 규칙: 칸마다 지난번 채운 값을 auto에 두고 파일 값이 그와 다를 때만 덮어쓴다 → 직접 고친 값은 다음 시세 갱신 때 덮어쓴다.
//   auto.at(채운 시세 파일의 updatedAt)보다 오래된 시세로는 채우지 않는다(늦게 읽은 기기가 옛 시세로 되돌리지 않게).
//   같은 기록 + 같은 시세면 어느 기기에서 채워도 결과가 같아야 한다(sync.js가 저장소·지난 동기화 기록도 채워 비교해, 시세만으로 기록 차이 창이 뜨지 않게).
const PRICE_STALE_DAYS = 3; // 시세 기준일이 이보다 오래되면 경고
const PRICE_FORMAT = 3; // slimPrices 결과 형식. 바꾸면 올릴 것 — 이 기기에 둔 옛 형식 시세는 ETag 없이 다시 받는다(sync.js readPrices)
// 기준선 이름 → 시세 파일 ma 이름. 데이터 저장소 scripts/kis_prices.py의 LABEL_RE·ma_name과 같게("60 일선"→"60일선", "12달선"→"12개월선")
function maKey(label){ const m=/(\d{1,3})\s*(일|주|개월|달)\s*선/.exec(String(label||"")); return m&&Number(m[1])>=1?`${Number(m[1])}${{일:"일선",주:"주선",개월:"개월선",달:"개월선"}[m[2]]}`:""; }
const priceEntry = e => e&&typeof e==="object"&&/^\d{4}-\d{2}-\d{2}$/.test(e.asOf)&&e.ma&&typeof e.ma==="object" ? e : null;
const stockEntry = (prices, ticker) => priceEntry(prices?.stocks?.[String(ticker||"").trim().toUpperCase()]);
const fxEntry = prices => { const e=priceEntry(prices?.fx?.USDKRW); return e?.kind==="현물환율"&&Number.isFinite(Number(e.close))&&Number(e.close)>0?e:null; };
const BTC_KEY = "BTC-USD";
const btcEntry = prices => { const e=stockEntry(prices,BTC_KEY); return e?.kind==="코인"&&Number(e.close)>0?e:null; };
// 시세 통화: 해외 종목·비트코인은 달러, 그 밖(국내)은 원화
const quoteCurrency = e => e?.kind==="해외"||e?.kind==="코인" ? "USD" : "KRW";
// 달러선물은 보유 근월물(계약 수 > 0인 가장 가까운 월물, futures.js nearestMonth와 같음)의 시세
function priceMonth(f){ return (Array.isArray(f?.positions)?f.positions:[]).filter(p=>Number(p.contracts)>0&&/^\d{4}(0[1-9]|1[0-2])$/.test(String(p.month))).map(p=>String(p.month)).sort()[0]||""; }
const futuresEntry = (prices, f) => priceEntry(prices?.futures?.[priceMonth(f)]);
// 봉 기록(daily·weekly·monthly)에서 종가만 오래된 것부터: {D 일봉, W 주봉, M 월봉}. 주봉이 없으면(N주선을 쓰는 계획이 아직 없으면)
// 일봉을 주(월~일)마다 묶어 그 주 마지막 종가로 만든다. cols는 시세 파일 columns(없으면 스크립트 기본 date·open·high·low·close·volume).
function barCloses(e, cols){
  const at=(name,i)=>Array.isArray(cols)&&cols.includes(name)?cols.indexOf(name):i, ci=at("close",4), di=at("date",0);
  const rows=key=>(Array.isArray(e[key])?e[key]:[]).filter(b=>Array.isArray(b)&&Number(b[ci])>0), out={};
  const daily=rows("daily"), weekly=rows("weekly"), monthly=rows("monthly");
  if(daily.length)out.D=daily.map(b=>Number(b[ci]));
  if(weekly.length)out.W=weekly.map(b=>Number(b[ci]));
  else{const w=[];let last=null;for(const b of daily){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b[di]));if(!m)continue;const t=Date.UTC(m[1],m[2]-1,m[3]),k=t-(new Date(t).getUTCDay()+6)%7*864e5;
    if(k===last)w[w.length-1]=Number(b[ci]);else{w.push(Number(b[ci]));last=k;}} if(w.length)out.W=w;}
  if(monthly.length)out.M=monthly.map(b=>Number(b[ci]));
  return Object.keys(out).length?out:null;
}
// 파일에서 채우기·표시에 쓰는 값만 남긴다(봉 기록은 버리고 종목 종가만 closes로). 형식이 다르면 오류.
function slimPrices(doc){
  if(!doc||typeof doc!=="object"||!doc.stocks||typeof doc.stocks!=="object")throw Error("시세 파일 형식을 확인할 수 없습니다.");
  const pick=(group,bars)=>Object.fromEntries(Object.entries(group&&typeof group==="object"?group:{}).filter(([,e])=>e&&typeof e==="object")
    .map(([k,e])=>{const closes=bars&&barCloses(e,doc.columns);return [k,{kind:e.kind,asOf:e.asOf,close:e.close,ma:e.ma,...(closes?{closes}:{}),...(e.stale?{stale:true}:{})}];}));
  return {format:PRICE_FORMAT,updatedAt:String(doc.updatedAt||""),stocks:pick(doc.stocks,true),futures:pick(doc.futures,false),fx:pick(doc.fx,false)};
}
// 기준선 이름(N일선·N주선·N개월선)의 이동평균: 시세 파일 ma에 있으면 그 값, 없으면 보관한 종가로 계산(스크립트처럼 소수 넷째 자리). 없으면 null.
function maValue(e, label){
  const key=maKey(label);if(!e||!key)return null;
  if(Number(e.ma[key])>0)return Number(e.ma[key]);
  const n=parseInt(key),c=e.closes?.[{일선:"D",주선:"W",개월선:"M"}[key.slice(String(n).length)]];
  if(!Array.isArray(c)||c.length<n)return null;
  let sum=0;for(const v of c.slice(-n))sum+=Number(v);
  return sum>0?Math.round(sum/n*1e4)/1e4:null;
}
const priceRound = (v, digits) => Number(v)>0 ? Math.round(Number(v)*10**digits)/10**digits : null;
// obj의 칸들을 채운다. rows = [auto에 둘 이름, 값, 넣기(값)]. 값이 없거나 지난번 채운 값과 같으면 건너뛴다. 하나라도 채우면 auto를 바꾼다.
function fillMarked(obj, at, rows){
  const prev=obj.auto&&typeof obj.auto==="object"?obj.auto:null;
  if(prev&&(Date.parse(prev.at)||0)>(Date.parse(at)||0))return false;
  const mark={at,...prev};let hit=false;
  for(const [key,value,put] of rows){ if(value==null||mark[key]===value)continue; mark[key]=value; put(value); hit=true; }
  if(hit)obj.auto={...mark,at};
  return hit;
}
// data = {plans, futures, rebuy}(state 또는 저장소 기록, rebuy는 {items:[…]} 또는 옛 기록의 종목 하나). 바꾼 칸이 있으면 true.
function fillPrices(data, prices){
  if(!prices||!data)return false;
  const at=String(prices.updatedAt||"");let changed=false;
  const f=data.futures, fe=futuresEntry(prices,f), fx=priceRound(fxEntry(prices)?.close,2);
  for(const p of Array.isArray(data.plans)?data.plans:[]){
    if(!p||typeof p!=="object")continue;
    const usd=p.currency!=="KRW", e=stockEntry(prices,p.ticker), ok=e?.kind===(usd?"해외":"국내"), ma=label=>ok?priceRound(maValue(e,label),usd?2:0):null;
    changed=fillMarked(p,at,[...(p.startAuto===true?[["startPrice",ma(p.startLabel),v=>p.startPrice=v]]:[]),["endPrice",ma(p.endLabel),v=>p.endPrice=v],...(usd?[["fx",fx,v=>p.fx=v]]:[])])||changed;
  }
  if(fe&&Array.isArray(f.levels)){
    const rows=[...new Set(f.levels.map(l=>Number(l?.days)).filter(d=>Number.isInteger(d)&&d>0))].map(days=>[`${days}일선`,priceRound(fe.ma[`${days}일선`],2),v=>f.levels.forEach(l=>{
      if(Number(l?.days)!==days)return; l.price=v; (Array.isArray(l.tranches)?l.tranches:[]).forEach(t=>{if(!t.completed)t.price=v;}); })]);
    changed=fillMarked(f,at,rows)||changed;
  }
  if(fe&&f.rebuy&&typeof f.rebuy==="object"&&!Array.isArray(f.rebuy)){
    const r=f.rebuy,stages=Array.isArray(r.stages)?r.stages:[];
    changed=fillMarked(r,at,[["currentPrice",priceRound(fe.close,2),v=>r.currentPrice=v],
      ...stages.filter(x=>x&&maKey(x.name)).map(x=>[String(x.name),priceRound(maValue(fe,x.name),2),v=>x.price=v])])||changed;
  }
  const rb=data.rebuy, items=rb&&typeof rb==="object"?(Array.isArray(rb.items)?rb.items:[rb]):[];
  for(const r of items){
    const re=r&&typeof r==="object"?stockEntry(prices,r.ticker):null;
    if(!re||re.kind!=="국내")continue;
    const stages=Array.isArray(r.stages)?r.stages:[];
    changed=fillMarked(r,at,[["currentPrice",priceRound(re.close,0),v=>r.currentPrice=v],
      ...stages.filter(x=>x&&maKey(x.name)).map(x=>[String(x.name),priceRound(maValue(re,x.name),0),v=>x.price=v])])||changed;
  }
  return changed;
}
// 동기화 기록(JSON 문자열)에 시세를 채운 결과. 바꿀 칸이 없으면 받은 문자열 그대로.
function pricedSnapshot(json, prices){ if(!json||!prices)return json; const d=JSON.parse(json); return fillPrices(d,prices)?JSON.stringify(d):json; }
// 시세 기준일이 오늘(이 기기 날짜)보다 며칠 전인지
function priceAge(asOf, now=new Date()){ const [y,m,d]=String(asOf).split("-").map(Number); return Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-Date.UTC(y,m-1,d))/864e5); }
const priceOld = (e, now) => priceAge(e.asOf,now)>PRICE_STALE_DAYS;
// 작게 표시하는 시세 기준일. 오래됐거나 마지막 조회에 실패(stale)했으면 경고색
function priceStamp(e, now=new Date()){
  if(!priceEntry(e))return "";
  const days=priceAge(e.asOf,now), old=days>PRICE_STALE_DAYS;
  return `<small class="price-date${old||e.stale?" old":""}" title="시세 기준일 ${e.asOf}${e.stale?" · 마지막 조회 실패, 지난 값":""}">시세 ${Number(e.asOf.slice(5,7))}/${Number(e.asOf.slice(8))} 기준${old?` · ${days}일 전`:""}${e.stale?" · 조회 실패":""}</small>`;
}
// 기준일이 PRICE_STALE_DAYS일 넘게 지났으면 경고(what은 화면에 넣을 수 있게 이스케이프한 이름)
function priceWarning(e, what, now=new Date()){
  if(!priceEntry(e)||!priceOld(e,now))return "";
  return `<div class="warning price-warn">${what} 시세 기준일이 ${e.asOf}로 ${priceAge(e.asOf,now)}일 지났습니다. 자동으로 채운 현재가·기준가가 옛 값일 수 있으니 데이터 저장소 Actions의 ‘KIS 시세 수집’ 실행 결과를 확인하세요.</div>`;
}
