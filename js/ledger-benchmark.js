// 월별 손익 맨 위 누적 그래프와 ‘연도별 요약’의 S&P 500 수익률 비교. 내 연 수익률은 assets-calc.js yearSummary가 기준이다.
// 화면 없이 계산한다(tests/ledger-benchmark.test.cjs). 공개 자료 수집 scripts/collect-sp500.cjs는 공표치 검증에 아래 두 표만 읽는다.
// 개인 기록은 읽기만 하며 저장·변경하지 않는다. 시세 수집(비공개 저장소)은 이 파일을 읽지 않는다.

// S&P 500 Total Return(배당 재투자) 지수의 달러 기준 연간 수익률(%, 전년 12월 말 종가 → 그해 12월 말 종가).
// 출처: S&P Dow Jones Indices 공표치(U.S. Equities Market Attributes 각 연도 12월호·지수 대시보드). 2026-10-16 조회.
// 배당을 뺀 가격지수 수익률(예: 2025년 16.39%)과 섞지 않는다.
const SP500_TR_RETURNS = Object.freeze({2021:28.71, 2022:-18.11, 2023:26.29, 2024:25.02, 2025:17.88});
// 같은 지수의 월말 연초 대비 누적 수익률(%, 전년 12월 말 종가 → 그달 말 종가). 출처: S&P DJI 월간 ‘Index Dashboard: U.S.’의 S&P 500 YTD
// (Total Return·달러). 2026-10-16 조회. 월말 값은 자동 수집(data/sp500-tr.json)으로 채우므로 매달 넣지 않는다. 여기 값은 공표치로 확인한 달만
// 두며 수집값보다 우선하고, 수집기는 수집 종가가 이 값들과 맞는지 확인한다.
const SP500_TR_YTD = Object.freeze({"2026-08":13.14, "2026-09":12.75});
const SP500_COMPARE_FROM = 2021; // 투자 기록을 시작한 해

// data/sp500-tr.json(공개 수집 자료: 같은 지수의 연말 종가와 올해 끝난 달의 월말 종가)을 믿지 않고 형식·범위를 확인해 종가만 남긴다.
// 지수·통화가 다르거나 형식이 틀리면 null이며, 그때는 위 공표치만으로 비교한다.
function cleanSp500Data(raw){
  if(!raw||typeof raw!=="object"||raw.schemaVersion!==1||raw.symbol!=="^SP500TR"||raw.currency!=="USD")return null;
  const point=p=>p&&typeof p==="object"&&typeof p.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&typeof p.close==="number"&&Number.isFinite(p.close)&&p.close>0;
  const yearEnd={}, monthEnd={};
  for(const p of Array.isArray(raw.yearEnd)?raw.yearEnd.slice(0,200):[])
    if(point(p)&&Number.isInteger(p.year)&&p.date.startsWith(`${p.year}-12-`))yearEnd[p.year]={date:p.date,close:p.close};
  for(const p of Array.isArray(raw.monthEnd)?raw.monthEnd.slice(0,240):[])
    if(point(p)&&typeof p.ym==="string"&&/^\d{4}-(0[1-9]|1[0-2])$/.test(p.ym)&&p.date.startsWith(`${p.ym}-`))monthEnd[p.ym]={date:p.date,close:p.close};
  return {yearEnd,monthEnd};
}
const sp500Ratio = (end, start) => end&&start ? (end.close/start.close-1)*100 : null;
// 월말 누적: 공표치, 없으면 수집한 전년 말 종가 → 그달 말 종가. 둘 다 없으면 null.
function sp500YtdAt(year, month, data=null){
  const key=`${year}-${String(month).padStart(2,"0")}`;
  return finite(SP500_TR_YTD[key]) ?? sp500Ratio(data?.monthEnd?.[key], data?.yearEnd?.[year-1]);
}
// 연간: 연간 공표치, 12월 말 누적 공표치, 수집한 연말 종가 비율 순. 모두 없으면 null.
const sp500YearReturn = (year, data=null) => finite(SP500_TR_RETURNS[year]) ?? finite(SP500_TR_YTD[`${year}-12`]) ?? sp500Ratio(data?.yearEnd?.[year], data?.yearEnd?.[year-1]);

// 비교 기간은 2021년부터 오늘 기준 지난해(완료 연도)까지이며 해가 바뀌면 자동으로 늘어난다.
// 내 연 수익률(yearSummary.rate, 선물·옵션 포함)과 S&P 500 연간 수익률이 모두 있는 해만 같은 연도끼리 평균한다.
// 두 평균은 기존 ‘연평균 수익률’과 같은 연 수익률 산술평균이다(연복리 CAGR 아님). diff = 내 평균 − S&P 500 평균(%p, 반올림 전 값).
// missing: 내 연 수익률이 없는 완료 연도(기록 없음·분모 부족), pending: S&P 500 값이 아직 없는 완료 연도. 둘 다 평균에서 뺀다.
// 진행 중인 올해는 평균에 넣지 않고 current에 월 단위로 따로 비교한다. month = 올해 실현손익·선물옵션을 기록한 마지막 달,
// rate = 내 누적 연 수익률(연도별 요약 값), sp = 그달 말 S&P 500 누적 수익률(값이 아직 없으면 null), diff = rate − sp.
function sp500Comparison(years, today=new Date(), data=null){
  const list=Array.isArray(years)?years:[], thisYear=today.getFullYear(), end=thisYear-1;
  const recordOf=year=>list.find(x=>Number(x?.year)===year), summaryOf=year=>{const y=recordOf(year);return y?yearSummary(y):null;};
  const rows=[], missing=[], pending=[];
  for(let year=SP500_COMPARE_FROM;year<=end;year++){
    const sp=sp500YearReturn(year,data), mine=summaryOf(year)?.rate??null;
    if(sp===null)pending.push(year);
    else if(mine===null)missing.push(year);
    else rows.push({year,mine,sp});
  }
  const mean=key=>rows.length?rows.reduce((sum,r)=>sum+r[key],0)/rows.length:null;
  const mine=mean("mine"), sp=mean("sp"), record=recordOf(thisYear), now=record?yearSummary(record):null;
  let current=null;
  if(now){
    const month=Math.max(0,...(Array.isArray(record.months)?record.months:[]).filter(m=>(monthPnl(m)!==null||finite(m?.futures)!==null)&&Number.isInteger(m?.m)&&m.m>=1&&m.m<=12).map(m=>m.m))||null;
    const spNow=month?sp500YtdAt(thisYear,month,data):null;
    current={year:thisYear, rate:now.rate, months:now.months, month, sp:spNow, diff:now.rate!==null&&spNow!==null?now.rate-spNow:null};
  }
  return {from:rows.length?rows[0].year:null, to:rows.length?rows[rows.length-1].year:null, end, years:rows.length, rows,
    mine, sp, diff:mine!==null&&sp!==null?mine-sp:null, missing, pending, current};
}
// 월별 손익 맨 위 카드의 누적 그래프 자료(연도 하나). 기록은 읽기만 한다.
// 실현손익·월별 선물옵션(m.futures)을 기록한 달마다 rate = 월 수익률((실현손익 + 선물옵션) ÷ 그달 총자산, %) 누적, won = 그 손익 누적(원)을 [{m, v}]로 둔다.
// 손익이 있는 달 중 총자산이 0 이하·빈 달(unrated)이 있으면 rate는 null(yearSummary.rate와 같은 조건). from = 첫 기록 달 − 1(0점), month = 마지막 기록 달.
// 달을 모르는 선물옵션 연 합계(year.futures)는 rest(원)·restRate(마지막 총자산 기준 %p)로 따로 두며, 마지막 누적에 더하면 yearSummary의 pnl·rate가 된다.
// 계산 줄용 나눔: monthPnl·monthRate = 실현손익만, futures·futuresRate = 월별 선물옵션 + 연 합계(monthRate + futuresRate = 연 수익률).
// sp = S&P 500 누적 [{m, v}]: 올해는 1월~month의 월말 누적, 지난해는 월말 값이 있는 달과 12월의 연간 수익률. 값이 없는 달은 넣지 않는다.
// spAt = 비교할 S&P 500(올해는 month 말 누적, 지난해는 연간, 아직 오지 않은 해는 null) — sp500Comparison과 같은 기준. diff = 내 연 수익률 − spAt.
function ledgerChartData(year, today=new Date(), data=null){
  const s=yearSummary(year), rate=[], won=[], unrated=[];
  let r=0, w=0, monthRate=0, futRate=0;
  for(const m of (Array.isArray(year?.months)?year.months:[]).filter(m=>Number.isInteger(m?.m)&&m.m>=1&&m.m<=12).sort((a,b)=>a.m-b.m)){
    const p=monthPnl(m), f=finite(m.futures), t=monthTotals(year,m).total;
    if(p===null&&f===null)continue;
    w+=(p||0)+(f||0);won.push({m:m.m,v:w});
    if(t>0){r+=((p||0)+(f||0))/t*100;monthRate+=(p||0)/t*100;futRate+=(f||0)/t*100;rate.push({m:m.m,v:r});}else unrated.push(m.m);
  }
  const month=won.length?won[won.length-1].m:null, y=Number(year?.year), thisYear=today.getFullYear(), sp=[];
  const rest=s.futuresYear, restRate=rest!==null&&s.last?.total>0?rest/s.last.total*100:null;
  let spAt=null;
  if(month&&y===thisYear){
    for(let n=1;n<=month;n++){const v=sp500YtdAt(y,n,data);if(v!==null)sp.push({m:n,v});}
    spAt=sp500YtdAt(y,month,data);
  }else if(month&&y<thisYear){
    for(let n=1;n<=12;n++){const v=sp500YtdAt(y,n,data);if(v!==null)sp.push({m:n,v});}
    spAt=sp500YearReturn(y,data);
    if(spAt!==null&&!sp.some(p=>p.m===12))sp.push({m:12,v:spAt});
  }
  const rated=!unrated.length;
  return {rate:rated?rate:null, unrated, won, from:won.length?won[0].m-1:0, month, rest, restRate,
    monthPnl:s.monthPnl, monthRate:rated?monthRate:null, futures:s.futures,
    futuresRate:s.futures===null||!rated||(rest!==null&&restRate===null)?null:futRate+(restRate||0), pnl:s.pnl, total:s.rate,
    sp, spAt, diff:s.rate!==null&&spAt!==null?s.rate-spAt:null};
}
if(typeof module!=="undefined"&&module.exports)module.exports={SP500_TR_RETURNS,SP500_TR_YTD,SP500_COMPARE_FROM,cleanSp500Data};
