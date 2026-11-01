// GLDM 월말 자료 수집기를 네트워크 없이 검증한다. 종가는 확인한 GLDM 연말 상수에 맞춘 가짜 일별 가격이며 개인 기록을 쓰지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseChart,summarize,rangeStart,fetchChart,nextFile,main}=require('../scripts/collect-gold.cjs');
const {GOLD_LBMA_YEAR_END,GOLD_ETF_YEAR_END,cleanGoldData}=require('../js/ledger-benchmark.js');
const SCRIPT=path.join(__dirname,'../scripts/collect-gold.cjs'),OUT=path.join(__dirname,'../data/gold-etf.json');
const round=v=>Math.round(v*100)/100,pct=(a,b)=>(a/b-1)*100;
const existing=()=>fs.existsSync(OUT)?fs.readFileSync(OUT,'utf8'):null;
const now=new Date('2026-10-16T22:50:00Z');
const level=date=>Number(date.slice(0,4))<=2025?(GOLD_ETF_YEAR_END[date.slice(0,4)]??30):GOLD_ETF_YEAR_END[2025]*(1+Number(date.slice(5,7))/100);
function chart(from='2020-12-01',to='2026-10-15',edit=x=>x){
  const timestamp=[],close=[];
  for(let t=Date.parse(`${from}T21:00:00Z`);t<=Date.parse(`${to}T21:00:00Z`);t+=864e5){
    const d=new Date(t);if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
    timestamp.push(t/1000);close.push(level(d.toISOString().slice(0,10)));
  }
  return edit({chart:{result:[{meta:{symbol:'GLDM',currency:'USD',exchangeTimezoneName:'America/New_York'},timestamp,indicators:{quote:[{close}],adjclose:[{adjclose:close.map(()=>1)}]}}],error:null}});
}

test('Yahoo GLDM/USD 종가만 읽고 빈값·중복 날짜를 정리하며 다른 종목·통화를 거부한다',()=>{
  const raw=chart('2026-09-28','2026-10-02'),r=raw.chart.result[0];r.indicators.quote[0].close[1]=null;
  r.timestamp.push(r.timestamp.at(-1)+3600);r.indicators.quote[0].close.push(50.123);
  const before=structuredClone(raw),parsed=parseChart(raw);
  assert.equal(parsed.zone,'America/New_York');assert.deepEqual(parsed.points.map(p=>p.date),['2026-09-28','2026-09-30','2026-10-01','2026-10-02']);
  assert.deepEqual(parsed.points.at(-1),{date:'2026-10-02',close:50.12},'조정종가 대신 quote.close, 소수 둘째 자리');assert.deepEqual(raw,before);
  for(const symbol of ['GLD','GC=F','^SP500TR'])assert.throws(()=>parseChart(chart(undefined,undefined,p=>{p.chart.result[0].meta.symbol=symbol;return p;})),/unexpected-series/);
  assert.throws(()=>parseChart(chart(undefined,undefined,p=>{p.chart.result[0].meta.currency='KRW';return p;})),/unexpected-series/);
  for(const bad of [null,{chart:{result:null,error:{code:'Not Found'}}}])assert.throws(()=>parseChart(bad),/invalid-response/);
  assert.throws(()=>parseChart(chart(undefined,undefined,p=>{p.chart.result[0].timestamp.pop();return p;})),/invalid-response/);
});

test('2020~지난해 연말과 올해 끝난 월말만 추출하고 2021~2025 전부를 LBMA 연간 수익률과 대조한다',()=>{
  const {points}=parseChart(chart('2019-12-02')),before=structuredClone(points),s=summarize(points,'2026-10-16');
  assert.deepEqual(s.yearEnd.map(p=>p.year),[2020,2021,2022,2023,2024,2025]);
  assert.deepEqual(s.yearEnd.map(p=>p.date),['2020-12-31','2021-12-31','2022-12-30','2023-12-29','2024-12-31','2025-12-31']);
  assert.deepEqual(s.monthEnd.map(p=>p.ym),Array.from({length:9},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`));
  assert.deepEqual(s.monthEnd.at(-1),{ym:'2026-09',date:'2026-09-30',close:round(GOLD_ETF_YEAR_END[2025]*1.09)});
  assert.deepEqual(s.verified.map(v=>v.period),['2021','2022','2023','2024','2025']);
  for(const v of s.verified){
    const y=Number(v.period),etfPct=pct(GOLD_ETF_YEAR_END[y],GOLD_ETF_YEAR_END[y-1]),lbmaPct=pct(GOLD_LBMA_YEAR_END[y],GOLD_LBMA_YEAR_END[y-1]);
    assert.deepEqual(v,{period:String(y),etfPct,lbmaPct,diff:etfPct-lbmaPct});assert.ok(Math.abs(v.diff)<=5);
  }
  assert.equal(summarize(points,'2026-10-01').monthEnd.length,9);assert.equal(summarize(points,'2026-09-15').monthEnd.length,8);
  assert.equal(summarize(points,'2026-01-01').monthEnd.length,0);assert.deepEqual(points,before);
});

// 정확 대조를 통과하는 가상 GLDM 상수를 주입해 LBMA 교차 확인을 독립적으로 검증한다. 실제 상수는 바꾸지 않는다.
function collectorWithGold(etf){
  const refs={...require('../js/ledger-benchmark.js'),GOLD_ETF_YEAR_END:etf},fakeRequire=name=>name.startsWith('node:')?require(name):refs;
  const ctx=vm.createContext({require:fakeRequire,module:{exports:{}},__dirname:path.dirname(SCRIPT)});
  vm.runInContext(fs.readFileSync(SCRIPT,'utf8'),ctx);return ctx.module.exports;
}

test('GLDM 연말 종가는 모든 상수와 양방향 ±0.02달러 안만 통과한다',()=>{
  const points=parseChart(chart()).points,ends=summarize(points,'2026-10-16').yearEnd;
  for(const end of ends)for(const delta of [-.02,.02,-.03,.03]){
    const changed=points.map(p=>p.date===end.date?{...p,close:GOLD_ETF_YEAR_END[end.year]+delta}:p);
    if(Math.abs(delta)<=.02)assert.doesNotThrow(()=>summarize(changed,'2026-10-16'),`${end.year}: ${delta}`);
    else assert.throws(()=>summarize(changed,'2026-10-16'),new RegExp(`official-mismatch-close-${end.year}`));
  }
});

test('GLDM과 LBMA 연간 차이는 양방향 ±5%p로 교차 확인하고 어느 해든 초과하면 수치를 남겨 차단한다',()=>{
  const points=parseChart(chart()).points;
  for(const delta of [-4.9,4.9,-5.1,5.1]){
    const lbmaPct=pct(GOLD_LBMA_YEAR_END[2025],GOLD_LBMA_YEAR_END[2024]),end=GOLD_ETF_YEAR_END[2024]*(1+(lbmaPct+delta)/100);
    const changed=points.map(p=>p.date==='2025-12-31'?{...p,close:end}:p),c=collectorWithGold({...GOLD_ETF_YEAR_END,2025:end});
    if(Math.abs(delta)<5)assert.doesNotThrow(()=>c.summarize(changed,'2026-10-16'));
    else assert.throws(()=>c.summarize(changed,'2026-10-16'),e=>/official-mismatch-2025/.test(e.message)&&e.message.includes('"etfPct"')&&e.message.includes('"lbmaPct"')&&e.message.includes('"diff"'));
  }
  for(let year=2021;year<=2025;year++){
    const changed=points.map(p=>p.date.startsWith(`${year}-`)?{...p,close:p.close*1.1}:p),c=collectorWithGold({...GOLD_ETF_YEAR_END,[year]:GOLD_ETF_YEAR_END[year]*1.1});
    assert.throws(()=>c.summarize(changed,'2026-10-16'),e=>e.message.startsWith('official-mismatch-')&&e.message.includes(`"period":"${year}"`)&&e.message.includes('"etfPct"'));
  }
});

test('월말에서 4일보다 이른 값과 빠진 전년 말·검증 연도를 차단한다',()=>{
  const points=parseChart(chart()).points;
  assert.throws(()=>summarize(points.filter(p=>!(p.date>'2026-07-20'&&p.date<'2026-08-01')),'2026-10-16'),/incomplete-month-2026-07/);
  assert.throws(()=>summarize(points.filter(p=>!(p.date>'2024-12-20'&&p.date<'2025-01-01')),'2026-10-16'),/incomplete-year-2024/);
  assert.throws(()=>summarize(points.filter(p=>!p.date.startsWith('2024-12')),'2026-10-16'),/incomplete-year-2024/,'11월 마지막 날짜를 연말로 쓰지 않는다');
  assert.throws(()=>summarize(points.filter(p=>!p.date.startsWith('2025-')),'2026-10-16'),/missing-base/);
  assert.throws(()=>summarize(points.filter(p=>!p.date.startsWith('2022-')),'2026-10-16'),/no-verification-2022/);
  assert.throws(()=>summarize(points.filter(p=>!p.date.startsWith('2020-')),'2026-10-16'),/no-verification-2021/);
  const boundary=points.filter(p=>!(p.date>'2026-07-27'&&p.date<'2026-08-01'));assert.doesNotThrow(()=>summarize(boundary,'2026-10-16'));
});

test('2020년 12월부터 query1→query2로 받고 인증·쿠키 없이 요청마다 30초 제한을 둔다',async t=>{
  assert.equal(rangeStart(),2020);assert.equal(rangeStart(2030),2020);
  const calls=[],timeouts=[],signal=new AbortController().signal,payload=chart();
  t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return signal;});
  const fetcher=async(url,options)=>{calls.push({url,options});if(calls.length===1)return {ok:false,status:429};return {ok:true,json:async()=>payload};};
  assert.equal(await fetchChart(rangeStart(),now,fetcher),payload);
  assert.deepEqual(calls.map(c=>new URL(c.url).host),['query1.finance.yahoo.com','query2.finance.yahoo.com']);assert.deepEqual(timeouts,[30000,30000]);
  for(const c of calls){
    const u=new URL(c.url);assert.equal(u.pathname,'/v8/finance/chart/GLDM');assert.equal(u.searchParams.get('period1'),String(Date.UTC(2020,11,1)/1000));
    assert.equal(u.searchParams.get('period2'),String(now.getTime()/1000));assert.equal(u.searchParams.get('interval'),'1d');
    assert.equal(c.options.credentials,'omit');assert.equal(c.options.signal,signal);assert.deepEqual(Object.keys(c.options.headers).sort(),['Accept','User-Agent']);
  }
  let failed=0;await assert.rejects(fetchChart(rangeStart(),now,async()=>{failed++;return {ok:false,status:403};}),/http-403/);assert.equal(failed,2);
});

test('생성 파일은 정해진 키·GLDM 계열의 요약만 담고 cleanGoldData를 통과하며 같은 값은 다시 기록하지 않는다',()=>{
  const s=summarize(parseChart(chart()).points,'2026-10-16'),before=structuredClone(s),file=nextFile(null,s,now.toISOString());
  assert.deepEqual(Object.keys(file),['schemaVersion','index','symbol','currency','sourceName','sourceUrl','fetchedAt','verified','yearEnd','monthEnd']);
  assert.deepEqual([file.schemaVersion,file.index,file.symbol,file.currency,file.sourceName,file.sourceUrl],
    [1,'SPDR Gold MiniShares (GLDM)','GLDM','USD','Yahoo Finance','https://finance.yahoo.com/quote/GLDM/history/']);
  assert.equal(nextFile(JSON.parse(JSON.stringify(file)),s,'2026-10-17T22:50:00Z'),null);
  const changed=structuredClone(s);changed.monthEnd.at(-1).close+=1;assert.ok(nextFile(file,changed,'2026-10-17T22:50:00Z'));
  const clean=cleanGoldData(JSON.parse(JSON.stringify(file)));assert.deepEqual(Object.keys(clean.yearEnd),['2020','2021','2022','2023','2024','2025']);
  assert.equal(clean.monthEnd['2026-09'].close,round(GOLD_ETF_YEAR_END[2025]*1.09));assert.deepEqual(s,before);
  assert.ok(!('chart' in file)&&!('points' in file)&&!('timestamp' in file),'일별 원자료 전체를 저장하지 않는다');
});

test('dry-run은 파일을 바꾸지 않고 실제 응답 대신 가짜 자료로 verified만 출력한다',async t=>{
  const before=existing();let printed='';t.mock.method(console,'log',x=>{printed+=x;});
  await main(['--dry-run'],now,async()=>({ok:true,json:async()=>chart()}));
  assert.equal(existing(),before);const log=JSON.parse(printed);assert.equal(log.dryRun,true);assert.equal(log.verified.length,5);
  assert.deepEqual(log.verified,summarize(parseChart(chart()).points,'2026-10-16').verified);assert.equal(log.monthEnd.at(-1).ym,'2026-09');
});

test('HTTP·종목·검증 실패는 기존 자료를 보존하고 CLI는 exitCode 1로 끝난다',async()=>{
  const before=existing();await assert.rejects(main([],now,async()=>({ok:false,status:403})),/http-403/);
  await assert.rejects(main([],now,async()=>({ok:true,json:async()=>chart(undefined,undefined,p=>{p.chart.result[0].meta.symbol='GLD';return p;})})),/unexpected-series/);
  await assert.rejects(main([],now,async()=>({ok:true,json:async()=>chart(undefined,undefined,p=>{const r=p.chart.result[0];r.indicators.quote[0].close=r.indicators.quote[0].close.map(v=>v===GOLD_ETF_YEAR_END[2025]?v*2:v);return p;})})),/official-mismatch-close-2025/);
  const mod={exports:{}},proc={argv:[]};let error='';const fakeRequire=name=>name==='node:fs'?fs:name==='node:path'?path:name==='./month-close.cjs'?require('../scripts/month-close.cjs'):require('../js/ledger-benchmark.js');fakeRequire.main=mod;
  const context=vm.createContext({require:fakeRequire,module:mod,__dirname:path.dirname(SCRIPT),process:proc,AbortSignal,Date,Intl,
    fetch:async()=>({ok:false,status:403}),console:{error:x=>{error+=x;}}});
  await vm.runInContext(fs.readFileSync(SCRIPT,'utf8'),context);assert.equal(proc.exitCode,1);assert.match(error,/http-403.*기존 자료는 그대로 둡니다/);assert.equal(existing(),before);
});

test('새 파일은 검증 후에만 교체하고 쓰기 실패·같은 값·dry-run에는 기존 파일을 유지한다',async()=>{
  const file=nextFile(null,summarize(parseChart(chart()).points,'2026-10-16'),now.toISOString()),original=JSON.stringify(file),files=new Map([[OUT,original]]),writes=[];
  let fail=false;
  const fakeFs={readFileSync:p=>files.get(p),writeFileSync:(p,text)=>{writes.push(p);files.set(p,text);if(fail)throw Error('disk-full');},
    renameSync:(from,to)=>{files.set(to,files.get(from));files.delete(from);},rmSync:p=>files.delete(p)};
  const fakeRequire=name=>name==='node:fs'?fakeFs:name==='node:path'?path:name==='./month-close.cjs'?require('../scripts/month-close.cjs'):require('../js/ledger-benchmark.js');
  const context=vm.createContext({require:fakeRequire,module:{exports:{}},__dirname:path.dirname(SCRIPT),console:{log(){}},AbortSignal,Date,Intl,process:{argv:[]}});
  vm.runInContext(fs.readFileSync(SCRIPT,'utf8'),context);const run=context.module.exports.main,fetcher=async()=>({ok:true,json:async()=>chart()});
  await run([],now,fetcher);assert.equal(writes.length,0);assert.equal(files.get(OUT),original);
  const updated=chart(),r=updated.chart.result[0],i=r.timestamp.findIndex(t=>new Date(t*1000).toISOString().startsWith('2026-09-30'));r.indicators.quote[0].close[i]+=1;
  const update=async()=>({ok:true,json:async()=>updated});await run(['--dry-run'],now,update);assert.equal(writes.length,0);
  fail=true;await assert.rejects(run([],now,update),/disk-full/);assert.equal(files.get(OUT),original);assert.equal(files.has(`${OUT}.tmp`),false);
  fail=false;await run([],now,update);assert.deepEqual(writes,[`${OUT}.tmp`,`${OUT}.tmp`]);assert.equal(files.has(`${OUT}.tmp`),false);
  assert.equal(JSON.parse(files.get(OUT)).monthEnd.at(-1).close,round(GOLD_ETF_YEAR_END[2025]*1.09+1));assert.ok(cleanGoldData(JSON.parse(files.get(OUT))));
});

test('10월 31일 토요일처럼 그달 거래가 끝났으면 다음 달을 기다리지 않고 그달 말 종가를 남긴다',async t=>{
  const run=async iso=>{let printed='';const m=t.mock.method(console,'log',x=>{printed+=x;});
    try{await main(['--dry-run'],new Date(iso),async()=>({ok:true,json:async()=>chart('2020-12-01','2026-10-30')}));}finally{m.mock.restore();}
    return JSON.parse(printed);};
  assert.deepEqual((await run('2026-10-31T22:50:00Z')).monthEnd.at(-1),{ym:'2026-10',date:'2026-10-30',close:round(GOLD_ETF_YEAR_END[2025]*1.1)},'뉴욕 10월 31일 토요일');
  assert.equal((await run('2026-10-30T22:50:00Z')).monthEnd.at(-1).ym,'2026-10','마지막 금요일 장 마감 뒤');
  assert.equal((await run('2026-10-30T19:00:00Z')).monthEnd.at(-1).ym,'2026-09','장중인 마지막 금요일은 기다린다');
});
