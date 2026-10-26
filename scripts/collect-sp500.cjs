// S&P 500 Total Return(^SP500TR, S&P Dow Jones Indices 산출) 일별 종가에서 연말·월말 종가만 공개 자료 data/sp500-tr.json에 기록한다.
// 월별 손익의 올해 누적 비교(js/ledger-benchmark.js)가 ‘기록한 달 말’까지 같은 기간으로 계산하도록 끝난 달의 마지막 종가만 남긴다.
// 지수 확인: 수집 종가로 계산한 최근 확정 연도의 연간 수익률과 범위 안 월말 누적 수익률이 S&P DJI 공표치(SP500_TR_RETURNS·SP500_TR_YTD)와
// ±0.02%p 안이어야 기록한다(가격지수·다른 계열·빠진 종가 차단). 하나라도 다르면 기존 자료를 그대로 둔다.
// 개인 기록·토큰·Secrets를 읽지 않는다. 사용: node scripts/collect-sp500.cjs [--dry-run]
const fs=require('node:fs');
const path=require('node:path');
const {SP500_TR_RETURNS,SP500_TR_YTD}=require('../js/ledger-benchmark.js');

const OUT=path.join(__dirname,'../data/sp500-tr.json');
const SYMBOL='^SP500TR';
const TOLERANCE=0.02; // %p, 공표치의 소수 둘째 자리 반올림 허용
const META={schemaVersion:1,index:'S&P 500 Total Return',symbol:SYMBOL,currency:'USD',
  sourceName:'S&P Dow Jones Indices · Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/%5ESP500TR/history/'};

const dateFormatter=timeZone=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
const dateIn=(seconds,timeZone)=>dateFormatter(timeZone).format(new Date(seconds*1000));
// Yahoo chart 응답 → 날짜(거래소 시간대)별 종가(소수 둘째 자리). 같은 날이 겹치면 나중 값을 쓰고 빈 종가는 건너뛴다.
function parseChart(payload){
  const result=payload?.chart?.result?.[0];
  if(!result||payload.chart.error)throw Error('invalid-response');
  if(result.meta?.symbol!==SYMBOL||result.meta?.currency!=='USD')throw Error('unexpected-series');
  const zone=/^[A-Za-z_]+\/[A-Za-z_]+$/.test(String(result.meta.exchangeTimezoneName||''))?result.meta.exchangeTimezoneName:'America/New_York';
  const times=result.timestamp, closes=result.indicators?.quote?.[0]?.close;
  if(!Array.isArray(times)||!Array.isArray(closes)||times.length!==closes.length||!times.length)throw Error('invalid-response');
  const byDate=new Map(), formatter=dateFormatter(zone);
  times.forEach((t,i)=>{const v=closes[i];if(Number.isFinite(t)&&typeof v==='number'&&Number.isFinite(v)&&v>0)byDate.set(formatter.format(new Date(t*1000)),Math.round(v*100)/100);});
  return {zone,points:[...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,close])=>({date,close}))};
}
const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
// 연말·월말 종가: 끝난 해의 마지막 종가, 올해 끝난 달의 마지막 종가. 마지막 종가가 그 달 마지막 4일보다 이르면 자료가 빠진 것으로 보고 멈춘다.
// verified: 연간 공표치가 있는 가장 최근 해와 범위 안 월말 공표치를 수집 종가로 다시 계산한 값. 연간 검증이 없거나 공표치와 다르면 기록하지 않는다.
function summarize(points, today){
  const thisYear=Number(today.slice(0,4)), thisMonth=today.slice(0,7), last=new Map();
  for(const p of points){last.set(p.date.slice(0,4),p);last.set(p.date.slice(0,7),p);}
  const complete=(p,y,m)=>p.date.startsWith(`${y}-${String(m).padStart(2,'0')}-`)&&Number(p.date.slice(8,10))>=lastDay(y,m)-4;
  const yearEnd=[], monthEnd=[];
  for(const [key,p] of last){
    if(key.length===4&&Number(key)<thisYear){if(!complete(p,Number(key),12))throw Error(`incomplete-year-${key}`);yearEnd.push({year:Number(key),...p});}
    if(key.length===7&&key.startsWith(`${thisYear}-`)&&key<thisMonth){if(!complete(p,thisYear,Number(key.slice(5))))throw Error(`incomplete-month-${key}`);monthEnd.push({ym:key,...p});}
  }
  yearEnd.sort((a,b)=>a.year-b.year);monthEnd.sort((a,b)=>a.ym.localeCompare(b.ym));
  // 범위 첫해는 12월 일부만 받으므로 연말 종가로만 쓰고 그해 수익률은 계산하지 않는다.
  if(!yearEnd.some(y=>y.year===thisYear-1))throw Error('missing-base');
  const close=year=>yearEnd.find(y=>y.year===year)?.close, pct=(a,b)=>Math.round((a/b-1)*1e6)/1e4;
  const year=Object.keys(SP500_TR_RETURNS).map(Number).filter(y=>close(y)&&close(y-1)).sort((a,b)=>b-a)[0];
  if(!year)throw Error('no-verification');
  const verified=[{period:String(year),returnPct:pct(close(year),close(year-1)),official:SP500_TR_RETURNS[year]}];
  // 월말 공표치: 수집 범위의 끝난 달이며 전년 말 종가가 있는 달만 확인한다.
  const months=new Map([...last].filter(([key])=>key.length===7));
  for(const [ym,official] of Object.entries(SP500_TR_YTD)){
    const end=months.get(ym), base=close(Number(ym.slice(0,4))-1);
    if(end&&base&&ym<thisMonth)verified.push({period:ym,returnPct:pct(end.close,base),official});
  }
  const wrong=verified.find(v=>Math.abs(v.returnPct-v.official)>TOLERANCE);
  if(wrong)throw Error(`official-mismatch-${wrong.period}`);
  return {verified,yearEnd,monthEnd};
}
// 연간 검증 연도의 전년 12월부터 받는다(연간 공표치를 넣지 않은 해가 늘면 범위도 함께 늘어난다).
function rangeStart(thisYear){return Math.min(Math.max(...Object.keys(SP500_TR_RETURNS).map(Number))-1,thisYear-1);}
async function fetchChart(start, now, fetcher=fetch){
  const query=`period1=${Math.floor(Date.UTC(start,11,1)/1000)}&period2=${Math.floor(now.getTime()/1000)}&interval=1d`;
  let error;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
      const response=await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(SYMBOL)}?${query}`,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0 (compatible; etf-planner-public-statistics/1.0)',Accept:'application/json'}});
      if(!response.ok)throw Error(`http-${response.status}`);
      return await response.json();
    }catch(e){error=e;}
  }
  throw error;
}
// 같은 종가면 파일을 다시 쓰지 않는다(수집 시각만 바뀌는 커밋을 만들지 않음).
function nextFile(previous, summary, fetchedAt){
  const body={...META,verified:summary.verified,yearEnd:summary.yearEnd,monthEnd:summary.monthEnd};
  const same=previous&&JSON.stringify({...previous,fetchedAt:undefined})===JSON.stringify({...body,fetchedAt:undefined});
  return same?null:{...META,fetchedAt,verified:body.verified,yearEnd:body.yearEnd,monthEnd:body.monthEnd};
}
async function main(argv=process.argv.slice(2), now=new Date(), fetcher=fetch){
  const dry=argv.includes('--dry-run'), thisYear=Number(dateIn(now.getTime()/1000,'America/New_York').slice(0,4));
  const {zone,points}=parseChart(await fetchChart(rangeStart(thisYear),now,fetcher));
  const summary=summarize(points,dateIn(now.getTime()/1000,zone));
  let previous=null;try{previous=JSON.parse(fs.readFileSync(OUT,'utf8'));}catch{}
  const file=nextFile(previous,summary,now.toISOString());
  console.log(JSON.stringify({dryRun:dry,changed:!!file,points:points.length,first:points[0]?.date,last:points[points.length-1]?.date,...summary},null,1));
  if(file&&!dry)fs.writeFileSync(OUT,`${JSON.stringify(file,null,2)}\n`);
}
module.exports={parseChart,summarize,rangeStart,fetchChart,nextFile,main};
if(require.main===module)main().catch(e=>{console.error(`S&P 500 Total Return 수집을 완료하지 못했습니다(${e.message}). 기존 자료는 그대로 둡니다.`);process.exitCode=1;});
