// 월별 손익 맨 위 누적 그래프와 ‘연도별 요약’의 S&P 500·금 수익률 비교 계산. 내 연 수익률은 assets-calc.js yearSummary가 기준이다.
// 화면 없이 계산한다(tests/ledger-benchmark.test.cjs). 공개 자료 수집 scripts/collect-sp500.cjs는 공표치 검증에 S&P 500 두 표만 읽는다.
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

// 각 해 마지막 LBMA Gold Price PM(미국 달러/트로이온스). 12/31에 오후 가격이 없으면 그해 마지막 PM 날짜의 값이다.
// 출처(2차 자료): Wheaton Precious Metals 2022·2025 Annual Information Form의 Gold Prices, Closing.
// 2020~2022: https://s203.q4cdn.com/976005377/files/doc_financials/2022/ar/56f9e1a4-3f7d-4aec-b08f-217f7f63241b.pdf (PDF 122쪽)
// 2023~2025: https://s203.q4cdn.com/976005377/files/doc_financials/2025/ar/AIF-for-the-year-ended-December-31-2025-FINAL.pdf (PDF 120쪽)
// 2026-10-30 조회. 2차 자료로 확인한 값이므로 4단계 CI에서 LBMA 원자료와 대조한다.
const GOLD_LBMA_YEAR_END = Object.freeze({2020:1887.60, 2021:1805.85, 2022:1813.75, 2023:2078.40, 2024:2609.10, 2025:4367.80});

// 공개 비교 자료의 schemaVersion·지수·통화와 날짜·양수 종가를 확인한다. 형식이 틀리면 null, 연말은 200개·월말은 240개까지 사본에 남긴다.
// 연말은 해당 연도 12월, 월말은 해당 YYYY-MM의 날짜만 받으며 입력 자료는 바꾸지 않는다.
function cleanBenchmarkData(raw, symbol){
  if(!raw||typeof raw!=="object"||raw.schemaVersion!==1||raw.symbol!==symbol||raw.currency!=="USD")return null;
  const point=p=>p&&typeof p==="object"&&typeof p.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&typeof p.close==="number"&&Number.isFinite(p.close)&&p.close>0;
  const yearEnd={}, monthEnd={};
  for(const p of Array.isArray(raw.yearEnd)?raw.yearEnd.slice(0,200):[])
    if(point(p)&&Number.isInteger(p.year)&&p.date.startsWith(`${p.year}-12-`))yearEnd[p.year]={date:p.date,close:p.close};
  for(const p of Array.isArray(raw.monthEnd)?raw.monthEnd.slice(0,240):[])
    if(point(p)&&typeof p.ym==="string"&&/^\d{4}-(0[1-9]|1[0-2])$/.test(p.ym)&&p.date.startsWith(`${p.ym}-`))monthEnd[p.ym]={date:p.date,close:p.close};
  return {yearEnd,monthEnd};
}
// data/sp500-tr.json의 기존 검증 진입점. 수집 자료가 없거나 틀리면 공표치만으로 비교한다.
function cleanSp500Data(raw){ return cleanBenchmarkData(raw,"^SP500TR"); }
// LBMA Gold Price PM 달러 수집 자료의 검증 진입점. S&P 500과 같은 연말·월말 검증을 적용한다.
function cleanGoldData(raw){ return cleanBenchmarkData(raw,"LBMA-GOLD-PM"); }
const sp500Ratio = (end, start) => end&&start ? (end.close/start.close-1)*100 : null;
// 월말 누적: 공표치, 없으면 수집한 전년 말 종가 → 그달 말 종가. 둘 다 없으면 null.
function sp500YtdAt(year, month, data=null){
  const key=`${year}-${String(month).padStart(2,"0")}`;
  return finite(SP500_TR_YTD[key]) ?? sp500Ratio(data?.monthEnd?.[key], data?.yearEnd?.[year-1]);
}
// 연간: 연간 공표치, 12월 말 누적 공표치, 수집한 연말 종가 비율 순. 모두 없으면 null.
const sp500YearReturn = (year, data=null) => finite(SP500_TR_RETURNS[year]) ?? finite(SP500_TR_YTD[`${year}-12`]) ?? sp500Ratio(data?.yearEnd?.[year], data?.yearEnd?.[year-1]);

// 금 연간 수익률(%): (그해 연말 ÷ 전년 연말 − 1) × 100. 두 연말값 각각 상수 우선, 없으면 검증한 수집 종가. 한쪽이라도 없으면 null.
function goldYearReturn(year, data=null){
  const end=finite(GOLD_LBMA_YEAR_END[year])??data?.yearEnd?.[year]?.close, start=finite(GOLD_LBMA_YEAR_END[year-1])??data?.yearEnd?.[year-1]?.close;
  return end&&start?(end/start-1)*100:null;
}
// 금 월말 누적(%): (해당 월말 수집 종가 ÷ 전년 연말 − 1) × 100. 전년 말은 상수 우선이며, 해당 월말이 없으면 앞달로 대체하지 않고 null.
function goldYtdAt(year, month, data=null){
  const key=`${year}-${String(month).padStart(2,"0")}`, end=data?.monthEnd?.[key]?.close, start=finite(GOLD_LBMA_YEAR_END[year-1])??data?.yearEnd?.[year-1]?.close;
  return end&&start?(end/start-1)*100:null;
}

// 연도별 요약의 연복리: yearSummary.rate가 있는 해만 곱셈·기간에 넣고, 기록은 읽기만 한다.
// 지난해까지는 시작한 달과 관계없이 해마다 1년, 올해(today 연도 이상)는 실현손익·월별 선물옵션을 기록한 마지막 달 m/12년으로 센다.
// 올해에 기록한 달이 없으면 제외한다(잔액·달을 모르는 연 합계만 있는 올해도 제외). 0원 손익은 기록한 달이다.
// rate = ((∏(1+r/100))^(1/period) − 1) × 100. 인수가 하나라도 0 이하이거나 계산할 해가 없으면 null.
// 완료 연도 없이 올해 한 해만 있으면 partial=true, 연환산하지 않고 그해 rate를 그대로 둔다.
// years는 포함한 해 수, period는 합산한 기간, from·to는 첫·마지막 해, month는 마지막 해가 올해 이상일 때 기록한 마지막 달(그 외 null).
function compoundYearReturn(years, today=new Date()){
  const thisYear=today.getFullYear(), rows=[];
  for(const y of Array.isArray(years)?years:[]){
    const rate=yearSummary(y).rate;if(rate===null)continue;
    const year=Number(y.year), current=year>=thisYear;
    const month=current?Math.max(0,...(Array.isArray(y.months)?y.months:[]).filter(m=>(monthPnl(m)!==null||finite(m?.futures)!==null)&&Number.isInteger(m?.m)&&m.m>=1&&m.m<=12).map(m=>m.m))||null:null;
    if(current&&!month)continue;
    rows.push({year,rate,month,period:current?month/12:1});
  }
  rows.sort((a,b)=>a.year-b.year);
  const period=rows.reduce((sum,r)=>sum+r.period,0), first=rows[0], last=rows[rows.length-1], partial=rows.length===1&&first.year>=thisYear;
  const valid=rows.every(r=>1+r.rate/100>0), growth=rows.reduce((g,r)=>g*(1+r.rate/100),1);
  const rate=rows.length&&valid?(partial?first.rate:(growth**(1/period)-1)*100):null;
  return {rate,years:rows.length,period,from:first?.year??null,to:last?.year??null,month:last?.month??null,partial};
}

// 비교 기간은 2021년부터 오늘 기준 지난해(완료 연도)까지이며 해가 바뀌면 자동으로 늘어난다.
// 지수 정의 benchmark = {key,yearReturn,ytdAt}를 받아 내 연 수익률(yearSummary.rate, 선물·옵션 포함)과 지수 연간 수익률이 모두 있는 해만 같은 rows에 넣는다.
// mine·지수 값은 각각 ((∏(1+r/100))^(1/n) − 1) × 100인 연복리(n = rows 수). 인수가 하나라도 0 이하이거나 rows가 없으면 그 값은 null.
// diff = 내 연복리 − 지수 연복리(%p, 반올림 전 값). 어느 한쪽이 null이면 diff도 null이다. 지수 값의 반환 키는 benchmark.key(sp 또는 gold)다.
// missing: 내 연 수익률이 없는 완료 연도(기록 없음·분모 부족), pending: 지수 값이 아직 없는 완료 연도. 둘 다 연복리에서 뺀다.
// 진행 중인 올해는 연복리에 넣지 않고 current에 월 단위로 따로 비교한다. month = 올해 실현손익·선물옵션을 기록한 마지막 달,
// rate = 내 누적 연 수익률(연도별 요약 값), 지수 값 = 그달 말 누적 수익률(값이 아직 없으면 null), diff = rate − 지수 값.
function ledgerBenchmarkComparison(years, today, data, benchmark){
  const list=Array.isArray(years)?years:[], thisYear=today.getFullYear(), end=thisYear-1;
  const recordOf=year=>list.find(x=>Number(x?.year)===year), summaryOf=year=>{const y=recordOf(year);return y?yearSummary(y):null;};
  const rows=[], missing=[], pending=[];
  for(let year=SP500_COMPARE_FROM;year<=end;year++){
    const value=benchmark.yearReturn(year,data), mine=summaryOf(year)?.rate??null;
    if(value===null)pending.push(year);
    else if(mine===null)missing.push(year);
    else rows.push({year,mine,[benchmark.key]:value});
  }
  const compound=key=>rows.length&&rows.every(r=>1+r[key]/100>0)?(rows.reduce((g,r)=>g*(1+r[key]/100),1)**(1/rows.length)-1)*100:null;
  const mine=compound("mine"), value=compound(benchmark.key), record=recordOf(thisYear), now=record?yearSummary(record):null;
  let current=null;
  if(now){
    const month=Math.max(0,...(Array.isArray(record.months)?record.months:[]).filter(m=>(monthPnl(m)!==null||finite(m?.futures)!==null)&&Number.isInteger(m?.m)&&m.m>=1&&m.m<=12).map(m=>m.m))||null;
    const valueNow=month?benchmark.ytdAt(thisYear,month,data):null;
    current={year:thisYear, rate:now.rate, months:now.months, month, [benchmark.key]:valueNow, diff:now.rate!==null&&valueNow!==null?now.rate-valueNow:null};
  }
  return {from:rows.length?rows[0].year:null, to:rows.length?rows[rows.length-1].year:null, end, years:rows.length, rows,
    mine, [benchmark.key]:value, diff:mine!==null&&value!==null?mine-value:null, missing, pending, current};
}
// S&P 500 비교의 기존 인수·sp 반환 키를 유지한다. 계산 기준은 ledgerBenchmarkComparison 주석.
function sp500Comparison(years, today=new Date(), data=null){
  return ledgerBenchmarkComparison(years,today,data,{key:"sp",yearReturn:sp500YearReturn,ytdAt:sp500YtdAt});
}
// 금 비교는 S&P 500과 같은 모양이며 지수 값의 키만 gold다. 계산 기준은 ledgerBenchmarkComparison 주석.
function goldComparison(years, today=new Date(), data=null){
  return ledgerBenchmarkComparison(years,today,data,{key:"gold",yearReturn:goldYearReturn,ytdAt:goldYtdAt});
}
// 두 rows에 공통인 연도만 골라 각 지수의 연복리((∏(1+r/100))^(1/n) − 1) × 100를 다시 계산해 높은 쪽을 고른다. 동점은 sp500.
// 공통 연도가 없으면 rows가 있는 쪽(양쪽 다 있거나 모두 없으면 sp500). 0 이하 인수 등으로 한쪽 연복리를 계산할 수 없으면 계산 가능한 쪽, 둘 다 불가면 sp500.
function bestBenchmark(spCmp, goldCmp){
  const spRows=Array.isArray(spCmp?.rows)?spCmp.rows:[], goldRows=Array.isArray(goldCmp?.rows)?goldCmp.rows:[];
  const goldByYear=new Map(goldRows.map(r=>[Number(r.year),r.gold])), common=spRows.filter(r=>goldByYear.has(Number(r.year)));
  if(!common.length)return !spRows.length&&goldRows.length?"gold":"sp500";
  const compound=rates=>rates.every(r=>Number.isFinite(r)&&1+r/100>0)?(rates.reduce((g,r)=>g*(1+r/100),1)**(1/rates.length)-1)*100:null;
  const sp=compound(common.map(r=>r.sp)), gold=compound(common.map(r=>goldByYear.get(Number(r.year))));
  return gold!==null&&(sp===null||gold>sp)?"gold":"sp500";
}
// 월별 손익 맨 위 카드의 누적 그래프 자료(연도 하나). 기록은 읽기만 한다.
// 실현손익·월별 선물옵션(m.futures)을 기록한 달마다 r_m = ((실현손익||0) + (선물옵션||0)) ÷ 그달 총자산, g(초기 1) *= 1+r_m으로 월 복리 누적한다.
// rate = [{m, v:(g−1)×100}], won = 그 손익을 더한 누적(원). 총자산이 0 이하·빈 달(unrated), 0 이하인 인수 등 yearSummary.rate가 null인 기록은 rate도 null이다.
// from = 첫 기록 달 − 1(0점), month = 마지막 기록 달. 빈 해의 점 목록은 비운다.
// 달을 모르는 선물옵션 연 합계(year.futures)는 마지막 기록 달의 won에 더하고, rate에는 g × (1+연 합계 ÷ 마지막 총자산)을 반영한다.
// 그래서 그래프 끝은 선물옵션을 포함한 누적, 곧 yearSummary의 pnl·rate와 같다.
// sp = S&P 500 누적 [{m, v}]: 올해는 1월~month의 월말 누적, 지난해는 월말 값이 있는 달과 12월의 연간 수익률. 값이 없는 달은 넣지 않는다.
// spAt = 비교할 S&P 500(올해는 month 말 누적, 지난해는 연간, 아직 오지 않은 해는 null) — sp500Comparison과 같은 기준. diff = 내 연 수익률 − spAt.
// gold·goldAt·goldDiff는 금 수집 자료(goldData)에 같은 기준을 적용한 값이며, 기존 S&P 500·내 수익률·금액 값은 그대로 둔다.
function ledgerChartData(year, today=new Date(), data=null, goldData=null){
  const s=yearSummary(year), rate=[], won=[], unrated=[];
  let g=1, w=0;
  for(const m of (Array.isArray(year?.months)?year.months:[]).filter(m=>Number.isInteger(m?.m)&&m.m>=1&&m.m<=12).sort((a,b)=>a.m-b.m)){
    const p=monthPnl(m), f=finite(m.futures), t=monthTotals(year,m).total;
    if(p===null&&f===null)continue;
    w+=(p||0)+(f||0);won.push({m:m.m,v:w});
    if(t>0){g*=1+((p||0)+(f||0))/t;rate.push({m:m.m,v:(g-1)*100});}else unrated.push(m.m);
  }
  const month=won.length?won[won.length-1].m:null, y=Number(year?.year), thisYear=today.getFullYear(), sp=[], gold=[];
  const rest=s.futuresYear, rated=!unrated.length&&(s.rate!==null||!won.length);
  if(rest!==null&&won.length)won[won.length-1].v+=rest;
  if(rest!==null&&rated&&rate.length)rate[rate.length-1].v=(g*(1+rest/s.last.total)-1)*100;
  let spAt=null, goldAt=null;
  if(month&&y===thisYear){
    for(let n=1;n<=month;n++){const v=sp500YtdAt(y,n,data);if(v!==null)sp.push({m:n,v});}
    spAt=sp500YtdAt(y,month,data);
    for(let n=1;n<=month;n++){const v=goldYtdAt(y,n,goldData);if(v!==null)gold.push({m:n,v});}
    goldAt=goldYtdAt(y,month,goldData);
  }else if(month&&y<thisYear){
    for(let n=1;n<=12;n++){const v=sp500YtdAt(y,n,data);if(v!==null)sp.push({m:n,v});}
    spAt=sp500YearReturn(y,data);
    if(spAt!==null&&!sp.some(p=>p.m===12))sp.push({m:12,v:spAt});
    for(let n=1;n<=12;n++){const v=goldYtdAt(y,n,goldData);if(v!==null)gold.push({m:n,v});}
    goldAt=goldYearReturn(y,goldData);
    if(goldAt!==null&&!gold.some(p=>p.m===12))gold.push({m:12,v:goldAt});
  }
  return {rate:rated?rate:null, unrated, won, from:won.length?won[0].m-1:0, month, pnl:s.pnl, total:s.rate,
    sp, spAt, diff:s.rate!==null&&spAt!==null?s.rate-spAt:null,
    gold, goldAt, goldDiff:s.rate!==null&&goldAt!==null?s.rate-goldAt:null};
}
if(typeof module!=="undefined"&&module.exports)module.exports={SP500_TR_RETURNS,SP500_TR_YTD,SP500_COMPARE_FROM,cleanSp500Data,GOLD_LBMA_YEAR_END,cleanGoldData};
