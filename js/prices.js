// 시세 자동 채우기·캐시 형식·기준일 표시. 파일 읽기와 priceData는 sync.js.
// 대상/기준선 변경은 데이터 저장소 scripts/kis_prices.py도 수정(plans[].ticker·rebuy.items[].ticker/옛 rebuy.ticker·보유 월물 수집).
// 화면 없는 계산/테스트에서도 읽으므로 함수 밖에서 DOM을 건드리지 않는다.
const PRICE_STALE_DAYS = 3; // 시세 기준일이 이보다 오래되면 경고
const PRICE_FORMAT = 4; // slimPrices 형식을 바꾸면 증가; 옛 캐시는 ETag 없이 다시 받는다(sync.js readPrices).
// 기준선 이름 → 시세 파일 ma 이름. 데이터 저장소 scripts/kis_prices.py의 LABEL_RE·ma_name과 같게("60 일선"→"60일선", "12달선"→"12개월선")
function maKey(label){ const m=/(\d{1,3})\s*(일|주|개월|월|달)\s*선/.exec(String(label||"")); return m&&Number(m[1])>=1?`${Number(m[1])}${{일:"일선",주:"주선",개월:"개월선",월:"개월선",달:"개월선"}[m[2]]}`:""; }
// 60분봉 종가 N개 평균('N선', 옛 'N분봉') → ma['N선']; scripts/kis_prices.py HOUR_RE와 같은 이름.
// KIS 분봉을 여러 수집에 나눠 받으므로 짧은 N선부터 채워질 수 있다.
function hourKey(label){ const m=/^\s*([1-9]\d{0,2})\s*(?:선|시선|분봉)\s*$/.exec(String(label||"")); return m?`${Number(m[1])}선`:""; }
const autoKey = label => maKey(label)||hourKey(label); // 시세로 채우는 기준선(N일선·N주선·N개월선·N선)
const autoMark = name => autoKey(name)||String(name); // 시선·월선 별칭도 같은 자동 기준가 키를 사용한다.
const priceEntry = e => e&&typeof e==="object"&&/^\d{4}-\d{2}-\d{2}$/.test(e.asOf)&&e.ma&&typeof e.ma==="object" ? e : null;
const stockEntry = (prices, ticker) => priceEntry(prices?.stocks?.[String(ticker||"").trim().toUpperCase()]);
const fxEntry = prices => { const e=priceEntry(prices?.fx?.USDKRW); return e?.kind==="현물환율"&&Number.isFinite(Number(e.close))&&Number(e.close)>0?e:null; };
const BTC_KEY = "BTC-USD";
// 분할매도에서 '비트코인'도 받되 저장할 때는 수집 스크립트와 같은 BTC-USD로 둔다. BTC는 미국 ETF 심볼이므로 바꾸지 않는다.
const planTicker = ticker => { const t=String(ticker||"").trim().toUpperCase();return t==="비트코인"?BTC_KEY:t; };
// 미국 종목 코드(영문 심볼)인지: 재매수 통화(rebuy.js rebuyUsd)와 채울 시세 종류. 데이터 저장소 scripts/kis_prices.py classify와 같은 구분
//   (국내는 6자리·A/Q+6자리 코드. BTC-USD도 영문이라 true지만 시세 종류가 '코인'이라 재매수에는 채우지 않음).
const usTicker = ticker => { const t=String(ticker||"").trim().toUpperCase(); return /^[A-Z][A-Z0-9.\-/]{0,11}$/.test(t)&&!/^[AQ]\d{6}$/.test(t); };
const isBitcoinTicker = ticker => planTicker(ticker)===BTC_KEY;
const planQuoteKind = (ticker, currency) => currency==="KRW"?"국내":isBitcoinTicker(ticker)?"코인":"해외";
// BTC-USD: Coinbase 달러·UTC 일봉, 주말 포함 매 수집(kind '코인', kis_prices.py CRYPTO).
// 동기화 시세 줄·직접 추가 알림·달러 분할매도에 사용; ETF 재매수 자동 채우기는 제외.
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
// 채우기·표시 값만 남김(종목/선물 D·W·M 종가는 closes, 원본 봉은 버림). 형식이 다르면 오류.
function slimPrices(doc){
  if(!doc||typeof doc!=="object"||!doc.stocks||typeof doc.stocks!=="object")throw Error("시세 파일 형식을 확인할 수 없습니다.");
  const pick=(group,bars)=>Object.fromEntries(Object.entries(group&&typeof group==="object"?group:{}).filter(([,e])=>e&&typeof e==="object")
    .map(([k,e])=>{const closes=bars&&barCloses(e,doc.columns);return [k,{kind:e.kind,asOf:e.asOf,close:e.close,ma:e.ma,...(closes?{closes}:{}),...(e.stale?{stale:true}:{})}];}));
  return {format:PRICE_FORMAT,updatedAt:String(doc.updatedAt||""),stocks:pick(doc.stocks,true),futures:pick(doc.futures,true),fx:pick(doc.fx,false)};
}
// N일·N주·N개월선: ma 우선, 없으면 closes 단순평균(진행 중 주·월 봉 포함, 스크립트처럼 소수 넷째 자리). 봉 부족은 null.
// N선(60분봉)은 시세 파일 ma 값만(이 기기에는 60분봉을 두지 않음).
function maValue(e, label){
  const hour=hourKey(label);if(e&&hour)return Number(e.ma[hour])>0?Number(e.ma[hour]):null;
  const key=maKey(label);if(!e||!key)return null;
  if(Number(e.ma[key])>0)return Number(e.ma[key]);
  const n=parseInt(key),c=e.closes?.[{일선:"D",주선:"W",개월선:"M"}[key.slice(String(n).length)]];
  if(!Array.isArray(c)||c.length<n)return null;
  let sum=0;for(const v of c.slice(-n))sum+=Number(v);
  return sum>0?Math.round(sum/n*1e4)/1e4:null;
}
const priceRound = (v, digits) => Number(v)>0 ? Math.round(Number(v)*10**digits)/10**digits : null;
// rows = [auto 키, 값, 넣기]. null·지난 자동값과 같은 시세는 건너뛰고 새 시세만 직접 입력값을 덮어쓴다.
// auto.at보다 오래된 시세는 거부. 같은 기록 + 같은 시세는 기기와 무관하게 같은 결과(syncNow 충돌 비교의 전제).
function fillMarked(obj, at, rows){
  const prev=obj.auto&&typeof obj.auto==="object"?obj.auto:null;
  if(prev&&(Date.parse(prev.at)||0)>(Date.parse(at)||0))return false;
  const mark={at,...prev};let hit=false;
  for(const [key,value,put] of rows){ if(value==null||mark[key]===value)continue; mark[key]=value; put(value); hit=true; }
  if(hit)obj.auto={...mark,at};
  return hit;
}
// data = {plans,futures,rebuy}(state/원격 기록); 바꾼 칸이 있으면 true. 채우기 대상:
// plans: 통화에 맞는 stocks 종료 MA; 시작 MA는 startAuto=true만('직접'/옛 auto.startPrice는 안 씀).
// 달러 계획 환율은 보유 선물과 무관한 fx.USDKRW 현물; 없으면 기존 값 유지.
// futures: 보유 근월물 MA 구간 + 미매수 가격. buyPlan이 있으면 미매수 계약을 자동 재배분하며 완료 기록은 유지.
// futures.rebuy가 있을 때만 현재가·자동 단계도 같은 월물로 채움.
// 선물 재매수 신저점·하단·이탈 전 계약 수는 직접 입력. ETF rebuy.items(옛 단일 종목도)은 국내 원/해외 달러만.
// 분할매도·선물 현재가와 분할매도 평가액(planWorth)은 화면 전용. 단계 MA가 null이면 직접 입력값 유지.
function fillPrices(data, prices){
  if(!prices||!data)return false;
  const at=String(prices.updatedAt||"");let changed=false;
  const f=data.futures, fe=futuresEntry(prices,f), fx=priceRound(fxEntry(prices)?.close,2);
  for(const p of Array.isArray(data.plans)?data.plans:[]){
    if(!p||typeof p!=="object")continue;
    const usd=p.currency!=="KRW", e=stockEntry(prices,planTicker(p.ticker)), ok=e?.kind===planQuoteKind(p.ticker,p.currency), ma=label=>ok?priceRound(maValue(e,label),usd?2:0):null;
    changed=fillMarked(p,at,[...(p.startAuto===true?[["startPrice",ma(p.startLabel),v=>p.startPrice=v]]:[]),["endPrice",ma(p.endLabel),v=>p.endPrice=v],...(usd?[["fx",fx,v=>p.fx=v]]:[])])||changed;
  }
  if(fe&&Array.isArray(f.levels)){
    const names=[...new Set(f.levels.map(futureLineName).filter(Boolean))],updated=[];
    const rows=names.map(name=>[name,priceRound(maValue(fe,name),2),v=>{
      updated.push(name);f.levels.forEach(l=>{if(futureLineName(l)===name)l.price=v;});
    }]);
    const filled=fillMarked(f,at,rows);
    if(filled){refreshFutureBuyPrices(f,updated);if(f.buyPlan)applyFutureAutoBuyPlan(f);}
    changed=filled||changed;
  }
  if(fe&&f.rebuy&&typeof f.rebuy==="object"&&!Array.isArray(f.rebuy)){
    const r=f.rebuy,stages=Array.isArray(r.stages)?r.stages:[];
    changed=fillMarked(r,at,[["currentPrice",priceRound(fe.close,2),v=>r.currentPrice=v],
      ...stages.filter(x=>x&&autoKey(x.name)).map(x=>[autoMark(x.name),priceRound(maValue(fe,x.name),2),v=>x.price=v])])||changed;
  }
  const rb=data.rebuy, items=rb&&typeof rb==="object"?(Array.isArray(rb.items)?rb.items:[rb]):[];
  for(const r of items){
    const re=r&&typeof r==="object"?stockEntry(prices,r.ticker):null;
    if(!re||re.kind!==(usTicker(r.ticker)?"해외":"국내"))continue; // 국내 종목은 원, 미국 종목은 달러(센트까지)
    const stages=Array.isArray(r.stages)?r.stages:[], digits=re.kind==="해외"?2:0;
    changed=fillMarked(r,at,[["currentPrice",priceRound(re.close,digits),v=>r.currentPrice=v],
      ...stages.filter(x=>x&&autoKey(x.name)).map(x=>[autoMark(x.name),priceRound(maValue(re,x.name),digits),v=>x.price=v])])||changed;
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
