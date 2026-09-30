// 시세 자동 채우기: 데이터 저장소의 etf-planner-prices.json(그 저장소 Actions 'KIS 시세 수집'이 평일마다 갱신)으로 현재가·이동평균선 기준가를 채운다.
// 파일 읽기·채우는 때는 sync.js(readPrices·syncNow), 마지막으로 읽은 시세는 전역 priceData(sync.js). DOM 없이 불러와 테스트하므로 함수 밖에서 화면을 건드리지 말 것.
// 채우는 칸(시세 우선):
//   분할매도 시작·종료 기준가 ← stocks[종목 코드].ma[기준선 이름(N일선·N주선·N개월선)] (국내=원화 계획, 해외=달러 계획일 때만)
//   달러선물 N일선 구간 기준가 ← futures[보유 근월물].ma (안 산 계약 매수가도 같이, 직접 고칠 때와 같음)
//   재매수 현재가·N일선 단계 기준가 ← stocks[재매수 종목 코드] (국내 종목만). 분할매도·달러선물 현재가는 저장하지 않고 화면에만.
// 규칙: 칸마다 지난번 채운 값을 auto에 두고 파일 값이 그와 다를 때만 덮어쓴다 → 직접 고친 값은 다음 시세 갱신 때 덮어쓴다.
//   auto.at(채운 시세 파일의 updatedAt)보다 오래된 시세로는 채우지 않는다(늦게 읽은 기기가 옛 시세로 되돌리지 않게).
//   같은 기록 + 같은 시세면 어느 기기에서 채워도 결과가 같아야 한다(sync.js가 저장소·지난 동기화 기록도 채워 비교해, 시세만으로 기록 차이 창이 뜨지 않게).
const PRICE_STALE_DAYS = 3; // 시세 기준일이 이보다 오래되면 경고
// 기준선 이름 → 시세 파일 ma 이름. 데이터 저장소 scripts/kis_prices.py의 LABEL_RE·ma_name과 같게("60 일선"→"60일선", "12달선"→"12개월선")
function maKey(label){ const m=/(\d{1,3})\s*(일|주|개월|달)\s*선/.exec(String(label||"")); return m&&Number(m[1])>=1?`${Number(m[1])}${{일:"일선",주:"주선",개월:"개월선",달:"개월선"}[m[2]]}`:""; }
const priceEntry = e => e&&typeof e==="object"&&/^\d{4}-\d{2}-\d{2}$/.test(e.asOf)&&e.ma&&typeof e.ma==="object" ? e : null;
const stockEntry = (prices, ticker) => priceEntry(prices?.stocks?.[String(ticker||"").trim().toUpperCase()]);
// 달러선물은 보유 근월물(계약 수 > 0인 가장 가까운 월물, futures.js nearestMonth와 같음)의 시세
function priceMonth(f){ return (Array.isArray(f?.positions)?f.positions:[]).filter(p=>Number(p.contracts)>0&&/^\d{4}(0[1-9]|1[0-2])$/.test(String(p.month))).map(p=>String(p.month)).sort()[0]||""; }
const futuresEntry = (prices, f) => priceEntry(prices?.futures?.[priceMonth(f)]);
// 파일에서 채우기·표시에 쓰는 값만 남긴다(봉 기록 daily·monthly는 버림). 형식이 다르면 오류.
function slimPrices(doc){
  if(!doc||typeof doc!=="object"||!doc.stocks||typeof doc.stocks!=="object")throw Error("시세 파일 형식을 확인할 수 없습니다.");
  const pick=group=>Object.fromEntries(Object.entries(group&&typeof group==="object"?group:{}).filter(([,e])=>e&&typeof e==="object")
    .map(([k,e])=>[k,{kind:e.kind,asOf:e.asOf,close:e.close,ma:e.ma,...(e.stale?{stale:true}:{})}]));
  return {updatedAt:String(doc.updatedAt||""),stocks:pick(doc.stocks),futures:pick(doc.futures)};
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
// data = {plans, futures, rebuy}(state 또는 저장소 기록). 바꾼 칸이 있으면 true.
function fillPrices(data, prices){
  if(!prices||!data)return false;
  const at=String(prices.updatedAt||"");let changed=false;
  for(const p of Array.isArray(data.plans)?data.plans:[]){
    const e=stockEntry(prices,p?.ticker);if(!e||e.kind!==(p.currency==="KRW"?"국내":"해외"))continue;
    const digits=p.currency==="KRW"?0:2, ma=label=>priceRound(e.ma[maKey(label)],digits);
    changed=fillMarked(p,at,[["startPrice",ma(p.startLabel),v=>p.startPrice=v],["endPrice",ma(p.endLabel),v=>p.endPrice=v]])||changed;
  }
  const f=data.futures, fe=futuresEntry(prices,f);
  if(fe&&Array.isArray(f.levels)){
    const rows=[...new Set(f.levels.map(l=>Number(l?.days)).filter(d=>Number.isInteger(d)&&d>0))].map(days=>[`${days}일선`,priceRound(fe.ma[`${days}일선`],2),v=>f.levels.forEach(l=>{
      if(Number(l?.days)!==days)return; l.price=v; (Array.isArray(l.tranches)?l.tranches:[]).forEach(t=>{if(!t.completed)t.price=v;}); })]);
    changed=fillMarked(f,at,rows)||changed;
  }
  const r=data.rebuy, re=r&&typeof r==="object"?stockEntry(prices,r.ticker):null;
  if(re&&re.kind==="국내"){
    const stages=Array.isArray(r.stages)?r.stages:[];
    changed=fillMarked(r,at,[["currentPrice",priceRound(re.close,0),v=>r.currentPrice=v],
      ...stages.filter(x=>x&&maKey(x.name)).map(x=>[String(x.name),priceRound(re.ma[maKey(x.name)],0),v=>x.price=v])])||changed;
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
