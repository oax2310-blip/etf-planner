// LBMA Gold Price PM의 USD/트로이온스 원자료에서 연말·월말 값만 data/gold-lbma.json에 기록한다. 원자료 전체를 재게시하지 않는다.
// 개인 기록·토큰·Secrets를 읽지 않는다. 사용: node scripts/collect-gold.cjs [--dry-run]
const fs=require('node:fs');
const path=require('node:path');
const {GOLD_LBMA_YEAR_END}=require('../js/ledger-benchmark.js');

const OUT=path.join(__dirname,'../data/gold-lbma.json');
const SOURCE='https://prices.lbma.org.uk/json/gold_pm.json';
const TOLERANCE=0.005;
const META={schemaVersion:1,index:'LBMA Gold Price PM',symbol:'LBMA-GOLD-PM',currency:'USD',unit:'troy oz',
  sourceName:'LBMA · ICE Benchmark Administration',sourceUrl:'https://www.lbma.org.uk/prices-and-data/precious-metal-prices'};
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;

// LBMA 배열 {d:날짜,v:[USD,GBP,EUR]}에서 유효한 날짜와 양의 유한수인 USD만 사본으로 읽는다. 다른 통화로 대체하거나 가격을 반올림하지 않는다.
// 같은 날이 겹치면 마지막 유효값을 쓰고 날짜순으로 정렬한다. 배열이 아니거나 유효값이 하나도 없으면 중단한다.
function parse(payload){
  if(!Array.isArray(payload))throw Error('invalid-response');
  const byDate=new Map();
  for(const p of payload){
    const v=Array.isArray(p?.v)?p.v[0]:null;
    if(validDate(p?.d)&&typeof v==='number'&&Number.isFinite(v)&&v>0)byDate.set(p.d,v);
  }
  if(!byDate.size)throw Error('invalid-response');
  return [...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,close])=>({date,close}));
}

// 2020~지난해 각 해의 마지막 PM 값과 올해 끝난 달의 마지막 PM 값만 남긴다. 진행 중인 달·미래·2020년 이전은 기록하지 않는다.
// 필요한 해·달이 없거나 마지막 날짜가 해당 월말에서 4일보다 더 이르면 incomplete로 중단한다. 연말은 반드시 그해 12월이어야 한다.
// verified에는 GOLD_LBMA_YEAR_END가 있는 모든 완료 연도의 날짜·수집값·상수를 남긴다. 상수 ±0.005달러 밖이면 official-mismatch로 기록하지 않는다.
function summarize(points, today){
  if(!validDate(today))throw Error('invalid-date');
  const thisYear=Number(today.slice(0,4)), thisMonth=Number(today.slice(5,7)), last=new Map();
  for(const p of points)for(const key of [p.date.slice(0,4),p.date.slice(0,7)])
    if(!last.has(key)||last.get(key).date<p.date)last.set(key,p);
  const complete=(p,y,m)=>p&&p.date.startsWith(`${y}-${String(m).padStart(2,'0')}-`)&&Number(p.date.slice(8,10))>=new Date(Date.UTC(y,m,0)).getUTCDate()-4;
  const yearEnd=[], monthEnd=[];
  for(let year=2020;year<thisYear;year++){
    const p=last.get(String(year));if(!complete(p,year,12))throw Error(`incomplete-year-${year}`);
    yearEnd.push({year,date:p.date,close:p.close});
  }
  for(let m=1;m<thisMonth;m++){
    const ym=`${thisYear}-${String(m).padStart(2,'0')}`,p=last.get(ym);
    if(!complete(p,thisYear,m))throw Error(`incomplete-month-${ym}`);
    monthEnd.push({ym,date:p.date,close:p.close});
  }
  const verified=yearEnd.filter(p=>Object.hasOwn(GOLD_LBMA_YEAR_END,p.year)).map(p=>({period:String(p.year),date:p.date,close:p.close,official:GOLD_LBMA_YEAR_END[p.year]}));
  if(!verified.length)throw Error('no-verification');
  const wrong=verified.filter(v=>v.close<v.official-TOLERANCE||v.close>v.official+TOLERANCE);
  if(wrong.length)throw Error(`official-mismatch-${wrong.map(v=>v.period).join(',')}: ${JSON.stringify(wrong)}`);
  return {verified,yearEnd,monthEnd};
}

// 값·검증 결과가 같으면 수집 시각만 바뀌는 파일을 다시 쓰지 않는다.
function nextFile(previous, summary, fetchedAt){
  const body={...META,verified:summary.verified,yearEnd:summary.yearEnd,monthEnd:summary.monthEnd};
  const same=previous&&JSON.stringify({...previous,fetchedAt:undefined})===JSON.stringify({...body,fetchedAt:undefined});
  return same?null:{...META,fetchedAt,verified:body.verified,yearEnd:body.yearEnd,monthEnd:body.monthEnd};
}

// 런던 날짜로 끝난 달을 정하고 인증·쿠키 없이 LBMA 한 주소만 30초 제한으로 읽는다. 실패하면 다른 금 시세로 대체하지 않는다.
// 검증 후에만 임시 파일을 원자적으로 교체하며 dry-run은 파일을 쓰지 않는다. 로그에도 요약과 검증 결과만 남긴다.
async function main(argv=process.argv.slice(2), now=new Date(), fetcher=fetch){
  const dry=argv.includes('--dry-run'),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const response=await fetcher(SOURCE,{signal:AbortSignal.timeout(30000),credentials:'omit',headers:{'User-Agent':'Mozilla/5.0 (compatible; etf-planner-public-statistics/1.0)',Accept:'application/json'}});
  if(!response.ok)throw Error(`http-${response.status}`);
  const points=parse(await response.json()),summary=summarize(points,today);
  let previous=null;try{previous=JSON.parse(fs.readFileSync(OUT,'utf8'));}catch{}
  const file=nextFile(previous,summary,now.toISOString());
  console.log(JSON.stringify({dryRun:dry,changed:!!file,points:points.length,first:points[0].date,last:points.at(-1).date,...summary},null,1));
  if(file&&!dry){
    const temp=`${OUT}.tmp`;
    try{fs.writeFileSync(temp,`${JSON.stringify(file,null,2)}\n`);fs.renameSync(temp,OUT);}
    finally{fs.rmSync(temp,{force:true});}
  }
}
module.exports={parse,summarize,nextFile,main};
if(require.main===module)main().catch(e=>{console.error(`LBMA Gold Price PM 수집을 완료하지 못했습니다(${e.message}). 기존 자료는 그대로 둡니다.`);process.exitCode=1;});
