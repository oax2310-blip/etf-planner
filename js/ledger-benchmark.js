// 월별 손익 ‘연도별 요약’의 S&P 500 수익률 비교. 내 연 수익률은 assets-calc.js yearSummary가 기준이다.
// 화면 없이 계산한다(tests/ledger-benchmark.test.cjs). 시세 수집은 이 파일을 읽지 않으며 기록을 저장·변경하지 않는다.

// S&P 500 Total Return(배당 재투자) 지수의 달러 기준 연간 수익률(%, 전년 12월 말 종가 → 그해 12월 말 종가).
// 출처: S&P Dow Jones Indices 공표치(U.S. Equities Market Attributes 각 연도 12월호·지수 대시보드). 2026-10-16 조회.
// 배당을 뺀 가격지수 수익률(예: 2025년 16.39%)과 섞지 않는다.
const SP500_TR_RETURNS = Object.freeze({2021:28.71, 2022:-18.11, 2023:26.29, 2024:25.02, 2025:17.88});
// 같은 지수의 월말 연초 대비 누적 수익률(%, 전년 12월 말 종가 → 그달 말 종가). 출처: S&P DJI 월간 ‘Index Dashboard: U.S.’의 S&P 500 YTD
// (Total Return·달러). 2026-10-16 조회. 매달 대시보드가 나오면 "연-월" 하나를 더한다. 12월 값은 위 연간 확정치를 넣기 전까지 그해 연간 수익률로 쓴다.
const SP500_TR_YTD = Object.freeze({"2026-08":13.14, "2026-09":12.75});
const SP500_COMPARE_FROM = 2021; // 투자 기록을 시작한 해

const sp500YtdAt = (year, month) => finite(SP500_TR_YTD[`${year}-${String(month).padStart(2,"0")}`]);
// 연간 수익률: 연간 확정치, 없으면 12월 말 누적 수익률. 둘 다 없으면 null.
const sp500YearReturn = year => finite(SP500_TR_RETURNS[year]) ?? sp500YtdAt(year,12);

// 비교 기간은 2021년부터 오늘 기준 지난해(완료 연도)까지이며 해가 바뀌면 자동으로 늘어난다.
// 내 연 수익률(yearSummary.rate, 선물·옵션 포함)과 S&P 500 연간 수익률이 모두 있는 해만 같은 연도끼리 평균한다.
// 두 평균은 기존 ‘연평균 수익률’과 같은 연 수익률 산술평균이다(연복리 CAGR 아님). diff = 내 평균 − S&P 500 평균(%p, 반올림 전 값).
// missing: 내 연 수익률이 없는 완료 연도(기록 없음·분모 부족), pending: S&P 500 값을 아직 넣지 않은 완료 연도. 둘 다 평균에서 뺀다.
// 진행 중인 올해는 평균에 넣지 않고 current에 월 단위로 따로 비교한다. month = 올해 실현손익을 기록한 마지막 달,
// rate = 내 누적 연 수익률(연도별 요약 값), sp = 그달 말 S&P 500 누적 수익률(값이 아직 없으면 null), diff = rate − sp.
function sp500Comparison(years, today=new Date()){
  const list=Array.isArray(years)?years:[], thisYear=today.getFullYear(), end=thisYear-1;
  const recordOf=year=>list.find(x=>Number(x?.year)===year), summaryOf=year=>{const y=recordOf(year);return y?yearSummary(y):null;};
  const rows=[], missing=[], pending=[];
  for(let year=SP500_COMPARE_FROM;year<=end;year++){
    const sp=sp500YearReturn(year), mine=summaryOf(year)?.rate??null;
    if(sp===null)pending.push(year);
    else if(mine===null)missing.push(year);
    else rows.push({year,mine,sp});
  }
  const mean=key=>rows.length?rows.reduce((sum,r)=>sum+r[key],0)/rows.length:null;
  const mine=mean("mine"), sp=mean("sp"), record=recordOf(thisYear), now=record?yearSummary(record):null;
  let current=null;
  if(now){
    const month=Math.max(0,...(Array.isArray(record.months)?record.months:[]).filter(m=>monthPnl(m)!==null&&Number.isInteger(m?.m)&&m.m>=1&&m.m<=12).map(m=>m.m))||null;
    const spNow=month?sp500YtdAt(thisYear,month):null;
    current={year:thisYear, rate:now.rate, months:now.months, month, sp:spNow, diff:now.rate!==null&&spNow!==null?now.rate-spNow:null};
  }
  return {from:rows.length?rows[0].year:null, to:rows.length?rows[rows.length-1].year:null, end, years:rows.length, rows,
    mine, sp, diff:mine!==null&&sp!==null?mine-sp:null, missing, pending, current};
}
