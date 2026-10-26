/* 공개 경제통계 캐시 수집. 인증키는 환경변수만 사용하고 파일·오류·로그에 남기지 않는다. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const CONFIG = path.join(ROOT,'data/currency-sources.json');
const OUTPUT = path.join(ROOT,'data/currency-pressure.json');
const fredSpecs = {
  usGdp:{code:'GDPC1',frequency:'Q',kind:'gdp',sourceName:'BEA · FRED',definitionId:'bea-real-gdp',unit:'Billions of chained 2017 dollars',seasonalAdjustment:'SAAR'},
  krGdp:{code:'NGDPRSAXDCKRQ',frequency:'Q',kind:'gdp',sourceName:'IMF · FRED',definitionId:'imf-korea-real-gdp',unit:'Millions of KRW',seasonalAdjustment:'SA'},
  usM2:{code:'M2SL',frequency:'M',kind:'money',sourceName:'연준 · FRED',definitionId:'fed-m2',unit:'Billions of USD',seasonalAdjustment:'SA',basis:'period-average'},
  fx:{code:'EXKOUS',frequency:'M',kind:'fx',sourceName:'연준 · FRED',definitionId:'fed-krw-usd-monthly',unit:'KRW per USD',seasonalAdjustment:'NSA',basis:'monthly-average'},
  usRate:{code:'FEDFUNDS',frequency:'M',kind:'rate',sourceName:'연준 · FRED',definitionId:'fed-effective-funds-rate',unit:'Percent',seasonalAdjustment:'NSA',basis:'monthly-average'}
};
const nowIso = () => new Date().toISOString();
function numberOrNull(raw) {
  if (raw === null || raw === undefined || String(raw).trim()==='' || ['.','-','..'].includes(String(raw).trim())) return null;
  const value=Number(String(raw).replaceAll(',',''));
  return Number.isFinite(value) ? value : null;
}
function parseFredCsv(csv, frequency, expectedCode) {
  const lines=csv.trim().split(/\r?\n/);
  if(!/^(observation_date|DATE),/i.test(lines[0] || '')) throw Error('invalid-response');
  if(expectedCode && lines[0].split(',').slice(1).join(',')!==expectedCode) throw Error('wrong-series');
  const seen=new Set();
  return lines.slice(1).filter(Boolean).map(line=>{
    const [date,raw]=line.split(',');
    if(!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(date)) throw Error('invalid-period');
    if(frequency==='Q' && !['01','04','07','10'].includes(date.slice(5,7))) throw Error('invalid-period');
    const period=frequency==='M'?date.slice(0,7):`${date.slice(0,4)}-Q${Math.ceil(Number(date.slice(5,7))/3)}`;
    if(seen.has(period)) throw Error('duplicate-period');seen.add(period);
    return {period,value:numberOrNull(raw)};
  }).sort((a,b)=>a.period.localeCompare(b.period));
}
function parseEcosRows(rows, spec) {
  if(!Array.isArray(rows) || !rows.length) throw Error('empty-response');
  const seen=new Set();
  return rows.map(row=>{
    if(row.STAT_CODE !== spec.table || spec.items.some((item,i)=>item && row[`ITEM_CODE${i+1}`] !== item)) throw Error('wrong-series');
    if(spec.unit && row.UNIT_NAME !== spec.unit) throw Error('wrong-series');
    if(spec.expectedItemName && String(row.ITEM_NAME1).replace(/\s+/g,'') !== spec.expectedItemName.replace(/\s+/g,'')) throw Error('wrong-series');
    const time=String(row.TIME), pattern=spec.frequency==='M'?/^\d{4}(0[1-9]|1[0-2])$/:/^\d{4}Q[1-4]$/;
    if(!pattern.test(time) || seen.has(time)) throw Error('invalid-period');seen.add(time);
    return {period:spec.frequency==='M'?`${time.slice(0,4)}-${time.slice(4)}`:`${time.slice(0,4)}-${time.slice(4)}`,value:numberOrNull(row.DATA_VALUE)};
  }).sort((a,b)=>a.period.localeCompare(b.period));
}
async function fetchText(url, fetcher=fetch) {
  const response=await fetcher(url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'etf-planner-public-statistics/1.0'}});
  if(!response.ok) throw Error('request-failed');
  return response.text();
}
async function collectFred(spec,start,fetcher=fetch,env=process.env) {
  const sourceUrl=`https://fred.stlouisfed.org/series/${spec.code}`;
  const observations=parseFredCsv(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${spec.code}&cosd=${start}-01-01`,fetcher),spec.frequency,spec.code);
  if(!observations.some(o=>o.value!==null)) throw Error('empty-response');
  let sourceUpdatedAt=null;
  if(env.FRED_API_KEY) {
    try {
      const url=new URL('https://api.stlouisfed.org/fred/series');
      url.search=new URLSearchParams({series_id:spec.code,api_key:env.FRED_API_KEY,file_type:'json'});
      const metadata=JSON.parse(await fetchText(url,fetcher));
      const s=metadata.seriess?.[0];
      if(s?.id===spec.code && s.frequency_short===spec.frequency) sourceUpdatedAt=s.last_updated || null;
    } catch (_) { /* 메타데이터 실패 시 CSV 값에 갱신일을 추정해 넣지 않는다. */ }
  }
  return {...spec,sourceUrl,observations,sourceUpdatedAt,releaseDate:null};
}
function validateEcosSpec(spec,key) {
  if(!spec || !/^[0-9]{3}Y[0-9]{3}$/.test(spec.table || '') || !Array.isArray(spec.items) || spec.items.length<1 || spec.items.length>4 || !spec.items.every(item=>typeof item==='string' && /^[\w-]+$/.test(item))) throw Error('series-unconfigured');
  if(key==='krM2' && (spec.table!=='161Y005' || spec.items.length!==1 || spec.items[0]!=='BBHS00' || spec.definitionId!=='bok-m2-2025-revision' || spec.frequency!=='M' || spec.basis!=='period-average' || spec.seasonalAdjustment!=='SA' || !/^\d{4}-\d{2}-\d{2}$/.test(spec.verifiedAt || ''))) throw Error('revision-unverified');
  if(key==='krRate' && (spec.frequency!=='M' || spec.kind!=='rate' || typeof spec.definitionId!=='string' || !spec.definitionId)) throw Error('series-unconfigured');
  if(key==='krGdp' && (spec.table!=='200Y104' || spec.items.length!==1 || spec.items[0]!=='1400' || spec.frequency!=='Q' || spec.kind!=='gdp' || spec.seasonalAdjustment!=='SA')) throw Error('series-unconfigured');
}
async function collectEcos(spec,key,start,fetcher=fetch,env=process.env) {
  validateEcosSpec(spec,key);
  if(!env.ECOS_API_KEY) throw Error('key-missing');
  const end=new Date().getUTCFullYear()+(spec.frequency==='Q'?'Q4':'12'), begin=start+(spec.frequency==='Q'?'Q1':'01'), observations=[];
  for(let first=1;;first+=1000) {
    const url=`https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(env.ECOS_API_KEY)}/json/kr/${first}/${first+999}/${spec.table}/${spec.frequency}/${begin}/${end}/${spec.items.map(encodeURIComponent).join('/')}/`;
    const payload=JSON.parse(await fetchText(url,fetcher)), result=payload.StatisticSearch;
    if(!result || !Array.isArray(result.row)) throw Error('request-failed');
    observations.push(...parseEcosRows(result.row,spec));
    if(first+result.row.length-1>=Number(result.list_total_count)) break;
    if(!result.row.length || first>10000) throw Error('invalid-response');
  }
  if(!observations.some(o=>o.value!==null)) throw Error('empty-response');
  return {...spec,code:[spec.table,...spec.items].join('/'),sourceName:'한국은행 · ECOS',sourceUrl:'https://ecos.bok.or.kr/',observations,sourceUpdatedAt:null,releaseDate:null};
}
function updateSeries(previous, collected, errorCode, fetchedAt) {
  if(errorCode) return {...(previous || {}),status:previous?.observations?.length?'error':'pending',lastAttemptAt:fetchedAt,errorCode,
    message:{'series-unconfigured':'공식 계열 연결 대기','revision-unverified':'M2 개편 기준 확인 대기','key-missing':'ECOS 인증 연결 대기'}[errorCode] || '공식 자료 수집 실패'};
  const same=previous?.code===collected.code && previous?.definitionId===collected.definitionId;
  const old=new Map(same?(previous.observations || []).map(o=>[o.period,o.value]):[]);
  const revisions=collected.observations.filter(o=>old.has(o.period) && old.get(o.period)!==o.value).map(o=>o.period);
  const previousPoints=new Map(same?(previous.observations || []).map(o=>[o.period,o]):[]);
  const observations=collected.observations.map(o=>({...o,firstSeenAt:previousPoints.get(o.period)?.firstSeenAt || fetchedAt}));
  const unchanged=same && JSON.stringify(collected.observations)===JSON.stringify((previous.observations||[]).map(({period,value})=>({period,value})));
  return {...collected,observations,status:'ready',fetchedAt,lastAttemptAt:fetchedAt,
    sourceUpdatedAt:collected.sourceUpdatedAt || (unchanged?previous.sourceUpdatedAt:null),revisedPeriods:revisions,
    lastRevisionAt:revisions.length?fetchedAt:same?previous.lastRevisionAt || null:null};
}
async function discover(fetcher=fetch,env=process.env) {
  if(!env.ECOS_API_KEY) throw Error('key-missing');
  for(let first=1;;first+=1000) {
    const url=`https://ecos.bok.or.kr/api/StatisticTableList/${encodeURIComponent(env.ECOS_API_KEY)}/json/kr/${first}/${first+999}/`;
    const payload=JSON.parse(await fetchText(url,fetcher)), result=payload.StatisticTableList;
    if(!result?.row) throw Error('request-failed');
    for(const row of result.row.filter(row=>/M2|광의통화|한국은행 기준금리/.test(row.STAT_NAME))) console.log(JSON.stringify(row));
    if(first+result.row.length-1>=Number(result.list_total_count)) break;
    if(first>10000)throw Error('invalid-response');
  }
}
async function main() {
  if(process.argv.includes('--discover')) return discover();
  const config=JSON.parse(await fs.readFile(CONFIG,'utf8'));
  let previous={series:{}};try {previous=JSON.parse(await fs.readFile(OUTPUT,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('invalid-cache');}
  const fetchedAt=nowIso(),start=String(new Date().getUTCFullYear()-11),series={};
  const ecosKeys=['krM2','krRate',...(config.krGdp?['krGdp']:[])];
  const jobs=Object.entries(fredSpecs).filter(([key])=>!ecosKeys.includes(key)).map(([key,spec])=>({key,run:()=>collectFred(spec,start)}));
  for(const key of ecosKeys)jobs.push({key,run:()=>collectEcos(config[key],key,start)});
  const results=await Promise.allSettled(jobs.map(job=>job.run()));
  for(let i=0;i<jobs.length;i++) {
    const {key}=jobs[i],result=results[i];
    // URL·예외 문자열에는 API 키가 포함될 수 있어 알려진 오류 코드만 출력.
    const known=new Set(['series-unconfigured','revision-unverified','key-missing','wrong-series','invalid-response','empty-response','invalid-period','duplicate-period']);
    const error=result.status==='rejected'?(known.has(result.reason?.message)?result.reason.message:'request-failed'):null;
    const configured=ecosKeys.includes(key)?config[key]:fredSpecs[key];
    const expectedCode=configured?.table?[configured.table,...configured.items].join('/'):configured?.code;
    const prior=previous.series?.[key];
    const compatible=!!configured && prior?.definitionId===configured.definitionId && prior?.code===expectedCode;
    series[key]=updateSeries(compatible?prior:null,result.status==='fulfilled'?result.value:null,error,fetchedAt);
    console.log(`${key}: ${series[key].status}`);
  }
  const output={schemaVersion:1,generatedAt:fetchedAt,series};
  const temp=OUTPUT+'.tmp';await fs.writeFile(temp,JSON.stringify(output,null,2)+'\n');await fs.rename(temp,OUTPUT);
}
module.exports={numberOrNull,parseFredCsv,parseEcosRows,collectFred,collectEcos,validateEcosSpec,updateSeries};
if(require.main===module)main().catch(()=>{console.error('공식 통계 수집을 완료하지 못했습니다. 인증·계열 설정과 네트워크를 확인하세요.');process.exitCode=1;});
