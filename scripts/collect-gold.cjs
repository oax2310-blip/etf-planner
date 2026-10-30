// GLDM(SPDR Gold MiniShares, 보수 0.10%) 달러 종가에서 연말·월말 값만 data/gold-etf.json에 기록한다.
// 개인 기록·토큰·Secrets를 읽지 않는다. 사용: node scripts/collect-gold.cjs [--dry-run]
const fs=require('node:fs');
const path=require('node:path');
const {GOLD_LBMA_YEAR_END}=require('../js/ledger-benchmark.js');

const OUT=path.join(__dirname,'../data/gold-etf.json');
const SYMBOL='GLDM';
const TOLERANCE=5; // %p
const META={schemaVersion:1,index:'SPDR Gold MiniShares (GLDM)',symbol:SYMBOL,currency:'USD',
  sourceName:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/GLDM/history/'};

const dateIn=(seconds,timeZone)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(seconds*1000));
// Yahoo chart 응답 → 날짜(거래소 시간대)별 종가(소수 둘째 자리). 같은 날이 겹치면 나중 값을 쓰고 빈 종가는 건너뛴다.
function parseChart(payload){
  const result=payload?.chart?.result?.[0];
  if(!result||payload.chart.error)throw Error('invalid-response');
  if(result.meta?.symbol!==SYMBOL||result.meta?.currency!=='USD')throw Error('unexpected-series');
  const zone=/^[A-Za-z_]+\/[A-Za-z_]+$/.test(String(result.meta.exchangeTimezoneName||''))?result.meta.exchangeTimezoneName:'America/New_York';
  const times=result.timestamp, closes=result.indicators?.quote?.[0]?.close;
  if(!Array.isArray(times)||!Array.isArray(closes)||times.length!==closes.length||!times.length)throw Error('invalid-response');
  const byDate=new Map();
  times.forEach((t,i)=>{const v=closes[i];if(Number.isFinite(t)&&typeof v==='number'&&Number.isFinite(v)&&v>0)byDate.set(dateIn(t,zone),Math.round(v*100)/100);});
  return {zone,points:[...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,close])=>({date,close}))};
}
const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
// 2020~지난해 연말과 올해 끝난 달의 마지막 종가만 남긴다. 마지막 날짜가 해당 월말에서 4일보다 더 이르면 incomplete로 멈춘다.
// 올해 월말의 기준이 될 전년 말이 없으면 missing-base다. 연말은 반드시 해당 해 12월의 값이어야 한다.
// verified: LBMA 상수로 연간 수익률을 계산할 수 있는 모든 완료 연도(2021~2025)를 같은 해 GLDM 수익률과 비교한다.
// etfPct·lbmaPct = (그해 말 ÷ 전년 말 − 1) × 100, diff = etfPct − lbmaPct(%p). 반올림 전 차이가 ±5%p를 넘으면 official-mismatch로 기록하지 않는다.
// LBMA와의 대조는 다른 종목·단위 오류를 막는 느슨한 교차 확인이다. 보수 0.10%와 마지막 런던 PM·뉴욕 종가의 서로 다른 연말 시점은 허용한다.
// 교차 확인할 해의 종가가 빠져도 기록하지 않는다.
function summarize(points, today){
  const thisYear=Number(today.slice(0,4)), thisMonth=today.slice(0,7), last=new Map();
  for(const p of points){last.set(p.date.slice(0,4),p);last.set(p.date.slice(0,7),p);}
  const complete=(p,y,m)=>p.date.startsWith(`${y}-${String(m).padStart(2,'0')}-`)&&Number(p.date.slice(8,10))>=lastDay(y,m)-4;
  const yearEnd=[], monthEnd=[];
  for(const [key,p] of last){
    if(key.length===4&&Number(key)>=2020&&Number(key)<thisYear){if(!complete(p,Number(key),12))throw Error(`incomplete-year-${key}`);yearEnd.push({year:Number(key),...p});}
    if(key.length===7&&key.startsWith(`${thisYear}-`)&&key<thisMonth){if(!complete(p,thisYear,Number(key.slice(5))))throw Error(`incomplete-month-${key}`);monthEnd.push({ym:key,...p});}
  }
  yearEnd.sort((a,b)=>a.year-b.year);monthEnd.sort((a,b)=>a.ym.localeCompare(b.ym));
  if(!yearEnd.some(y=>y.year===thisYear-1))throw Error('missing-base');
  const close=year=>yearEnd.find(y=>y.year===year)?.close, pct=(a,b)=>(a/b-1)*100, verified=[];
  for(const year of Object.keys(GOLD_LBMA_YEAR_END).map(Number).filter(y=>y<thisYear&&GOLD_LBMA_YEAR_END[y-1])){
    if(!close(year)||!close(year-1))throw Error(`no-verification-${year}`);
    const etfPct=pct(close(year),close(year-1)), lbmaPct=pct(GOLD_LBMA_YEAR_END[year],GOLD_LBMA_YEAR_END[year-1]);
    verified.push({period:String(year),etfPct,lbmaPct,diff:etfPct-lbmaPct});
  }
  if(!verified.length)throw Error('no-verification');
  const wrong=verified.filter(v=>Math.abs(v.diff)>TOLERANCE);
  if(wrong.length)throw Error(`official-mismatch-${wrong.map(v=>v.period).join(',')}: ${JSON.stringify(wrong)}`);
  return {verified,yearEnd,monthEnd};
}
// 2021년부터 모든 LBMA 연간 수익률을 검증할 수 있도록 전년인 2020년 12월부터 받는다.
function rangeStart(){return 2020;}
async function fetchChart(start, now, fetcher=fetch){
  const query=`period1=${Math.floor(Date.UTC(start,11,1)/1000)}&period2=${Math.floor(now.getTime()/1000)}&interval=1d`;
  let error;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
      const response=await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(SYMBOL)}?${query}`,{signal:AbortSignal.timeout(30000),credentials:'omit',headers:{'User-Agent':'Mozilla/5.0 (compatible; etf-planner-public-statistics/1.0)',Accept:'application/json'}});
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
  const dry=argv.includes('--dry-run');
  const {zone,points}=parseChart(await fetchChart(rangeStart(),now,fetcher));
  const summary=summarize(points,dateIn(now.getTime()/1000,zone));
  let previous=null;try{previous=JSON.parse(fs.readFileSync(OUT,'utf8'));}catch{}
  const file=nextFile(previous,summary,now.toISOString());
  console.log(JSON.stringify({dryRun:dry,changed:!!file,points:points.length,first:points[0]?.date,last:points[points.length-1]?.date,...summary},null,1));
  if(file&&!dry){
    const temp=`${OUT}.tmp`;
    try{fs.writeFileSync(temp,`${JSON.stringify(file,null,2)}\n`);fs.renameSync(temp,OUT);}
    finally{fs.rmSync(temp,{force:true});}
  }
}
module.exports={parseChart,summarize,rangeStart,fetchChart,nextFile,main};
if(require.main===module)main().catch(e=>{console.error(`금 ETF(GLDM) 수집을 완료하지 못했습니다(${e.message}). 기존 자료는 그대로 둡니다.`);process.exitCode=1;});
