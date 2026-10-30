// LBMA PM 수집기를 네트워크·개인 기록 없이 가짜 응답으로 검증한다. 원자료 파일을 직접 만들지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parse,summarize,nextFile,main}=require('../scripts/collect-gold.cjs');
const {GOLD_LBMA_YEAR_END,cleanGoldData}=require('../js/ledger-benchmark.js');
const SCRIPT=path.join(__dirname,'../scripts/collect-gold.cjs'),OUT=path.join(__dirname,'../data/gold-lbma.json');
const existing=()=>fs.existsSync(OUT)?fs.readFileSync(OUT,'utf8'):null;
const now=new Date('2026-10-16T22:50:00Z');

// 검증용 연말은 상수와 같게, 2026년 월말은 5,000 + 월 × 10달러로 만든다. GBP·EUR와 중간 날짜 값은 저장 대상이 아니다.
function payload(){
  const rows=[{d:'2019-12-31',v:[1500,1,2]},{d:'2027-01-15',v:[6000,1,2]}];
  for(const [year,close] of Object.entries(GOLD_LBMA_YEAR_END))rows.push({d:`${year}-12-20`,v:[close-10,1,2]},{d:`${year}-12-30`,v:[close,1,2]});
  for(let m=1;m<=12;m++){
    const ym=`2026-${String(m).padStart(2,'0')}`,day=new Date(Date.UTC(2026,m,0)).getUTCDate();
    rows.push({d:`${ym}-15`,v:[4000,1,2]},{d:`${ym}-${day}`,v:[5000+m*10,1,2]});
  }
  return rows.reverse();
}

test('LBMA 배열에서 유효한 날짜·양의 유한수 USD만 읽고 정렬하며 중복 날짜는 마지막 유효값을 쓴다',()=>{
  const raw=[{d:'2026-09-30',v:[5000,1,2]},{d:'2026-08-31',v:[4900,1,2]},{d:'2026-09-30',v:[5000.12345,1,2]},
    {d:'2026-09-30',v:[null,100,200]},null,{d:'2026-02-29',v:[100]},{d:'2026-13-01',v:[100]},
    {d:'2026-01-01T12:00:00Z',v:[100]},{d:'2026-7-01',v:[100]},{d:'2026-07-31',v:{0:100}},
    ...[null,'100',0,-1,Infinity,NaN].map(v=>({d:'2026-07-31',v:[v,100,200]}))];
  const before=structuredClone(raw);
  assert.deepEqual(parse(raw),[{date:'2026-08-31',close:4900},{date:'2026-09-30',close:5000.12345}]);
  assert.deepEqual(raw,before,'정렬·검증 중 원본을 바꾸지 않는다');
  for(const bad of [null,{},'[]',[],[{d:'2026-01-01',v:[null,100,200]}]])assert.throws(()=>parse(bad),/invalid-response/);
});

test('2020~지난해 연말과 올해 끝난 달만 요약하고 모든 연말 상수를 검증한다',()=>{
  const points=parse(payload()),before=structuredClone(points),s=summarize(points,'2026-10-16');
  assert.deepEqual(s.yearEnd,Object.entries(GOLD_LBMA_YEAR_END).map(([year,close])=>({year:Number(year),date:`${year}-12-30`,close})));
  assert.deepEqual(s.monthEnd.map(p=>p.ym),Array.from({length:9},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`));
  assert.deepEqual(s.monthEnd.at(-1),{ym:'2026-09',date:'2026-09-30',close:5000+9*10});
  assert.deepEqual(s.verified,Object.entries(GOLD_LBMA_YEAR_END).map(([year,official])=>({period:year,date:`${year}-12-30`,close:official,official})));
  assert.equal(summarize(points,'2026-10-01').monthEnd.length,9);
  assert.equal(summarize(points,'2026-09-30').monthEnd.length,8,'현재 달은 끝나기 전까지 제외');
  assert.equal(summarize(points,'2026-01-01').monthEnd.length,0);
  const next=summarize(points,'2027-01-01');assert.equal(next.yearEnd.at(-1).year,2026);assert.equal(next.monthEnd.length,0);
  assert.deepEqual(summarize([...points].reverse(),'2026-10-16'),s,'입력 순서와 관계없이 마지막 날짜');
  assert.deepEqual(points,before);assert.throws(()=>summarize(points,'2026-02-30'),/invalid-date/);
});

test('연말 상수와 0.005달러를 넘게 벗어난 어느 해든 차단하고 원자료 가격을 반올림하지 않는다',()=>{
  for(const year of Object.keys(GOLD_LBMA_YEAR_END))for(const delta of [-.0051,.0051]){
    const raw=payload();raw.find(p=>p.d===`${year}-12-30`).v[0]+=delta;
    assert.throws(()=>summarize(parse(raw),'2026-10-16'),new RegExp(`official-mismatch-${year}`));
  }
  for(const delta of [-.005,.005]){
    const raw=payload();raw.find(p=>p.d==='2025-12-30').v[0]+=delta;
    const s=summarize(parse(raw),'2026-10-16');assert.equal(s.yearEnd.at(-1).close,GOLD_LBMA_YEAR_END[2025]+delta);
  }
});

test('해·월 전체 누락과 너무 이른 마지막 값은 incomplete이며 연말은 그해 12월이어야 한다',()=>{
  const points=parse(payload());
  for(const year of [2020,2023,2025])assert.throws(()=>summarize(points.filter(p=>!p.date.startsWith(`${year}-`)),'2026-10-16'),new RegExp(`incomplete-year-${year}`));
  assert.throws(()=>summarize(points.filter(p=>!p.date.startsWith('2026-07')),'2026-10-16'),/incomplete-month-2026-07/);
  const november=points.filter(p=>!p.date.startsWith('2025-12'));november.push({date:'2025-11-30',close:GOLD_LBMA_YEAR_END[2025]});
  assert.throws(()=>summarize(november,'2026-10-16'),/incomplete-year-2025/);
  for(const [date,kind] of [['2025-12-30','year-2025'],['2026-07-31','month-2026-07']]){
    const earlier=points.map(p=>p.date===date?{...p,date:date.slice(0,8)+'26'}:p);
    assert.throws(()=>summarize(earlier,'2026-10-16'),new RegExp(`incomplete-${kind}`));
    const boundary=earlier.map(p=>p.date===date.slice(0,8)+'26'?{...p,date:date.slice(0,8)+'27'}:p);
    assert.doesNotThrow(()=>summarize(boundary,'2026-10-16'),'월말에서 4일 이내는 허용');
  }
  assert.throws(()=>summarize(points.filter(p=>p.date!=='2026-02-28'),'2026-10-16'),/incomplete-month-2026-02/);
});

test('생성 파일은 정해진 키 순서·단위·출처와 요약만 담고 cleanGoldData를 통과하며 같은 값이면 미기록한다',()=>{
  const s=summarize(parse(payload()),'2026-10-16'),before=structuredClone(s),file=nextFile(null,s,now.toISOString());
  assert.deepEqual(Object.keys(file),['schemaVersion','index','symbol','currency','unit','sourceName','sourceUrl','fetchedAt','verified','yearEnd','monthEnd']);
  assert.deepEqual([file.schemaVersion,file.index,file.symbol,file.currency,file.unit,file.sourceName,file.sourceUrl],
    [1,'LBMA Gold Price PM','LBMA-GOLD-PM','USD','troy oz','LBMA · ICE Benchmark Administration','https://www.lbma.org.uk/prices-and-data/precious-metal-prices']);
  assert.equal(nextFile(JSON.parse(JSON.stringify(file)),s,'2026-10-17T22:50:00Z'),null);
  const changed=structuredClone(s);changed.monthEnd.at(-1).close+=1;assert.ok(nextFile(file,changed,'2026-10-17T22:50:00Z'));
  const clean=cleanGoldData(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(Object.keys(clean.yearEnd),Object.keys(GOLD_LBMA_YEAR_END));assert.equal(Object.keys(clean.monthEnd).length,9);
  assert.deepEqual(clean.monthEnd['2026-09'],{date:'2026-09-30',close:5000+9*10});assert.deepEqual(s,before);
  assert.ok(!JSON.stringify(file).includes('2019-12-31')&&!JSON.stringify(file).includes('2026-09-15'),'원자료 전체를 저장하지 않는다');
});

test('dry-run은 런던 기준으로 끝난 달만 읽고 파일 불변이며 인증·쿠키 없이 한 URL과 30초 제한만 쓴다',async t=>{
  const before=existing(),calls=[],timeouts=[],controller=new AbortController();let printed='';
  t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return controller.signal;});
  t.mock.method(console,'log',x=>{printed+=x;});
  await main(['--dry-run'],new Date('2026-09-30T23:30:00Z'),async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>payload()};});
  assert.equal(existing(),before);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://prices.lbma.org.uk/json/gold_pm.json');
  assert.deepEqual(timeouts,[30000]);assert.equal(calls[0].options.signal,controller.signal);assert.equal(calls[0].options.credentials,'omit');
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(),['Accept','User-Agent']);
  const log=JSON.parse(printed);assert.equal(log.dryRun,true);assert.equal(log.monthEnd.at(-1).ym,'2026-09','런던 날짜는 10월 1일');
  assert.equal(log.verified.length,6);assert.ok(!printed.includes('2026-09-15'));
});

test('HTTP 실패·잘못된 응답·검증 실패는 기존 파일을 보존하며 다른 시세로 재시도하지 않는다',async()=>{
  const before=existing(),mismatch=payload();mismatch.find(p=>p.d==='2025-12-30').v[0]+=1;
  for(const [response,error] of [[{ok:false,status:403},/http-403/],[{ok:true,json:async()=>({})},/invalid-response/],
    [{ok:true,json:async()=>mismatch},/official-mismatch-2025/],[{ok:true,json:async()=>{throw Error('invalid-json');}},/invalid-json/]]){
    let calls=0;await assert.rejects(main([],now,async()=>{calls++;return response;}),error);assert.equal(calls,1);assert.equal(existing(),before);
  }
  await assert.rejects(main([],now,async()=>{throw Error('timeout');}),/timeout/);assert.equal(existing(),before);
});

test('쓰기 성공 때만 기존 파일을 교체하고 같은 값·dry-run·쓰기 실패에는 기존 자료를 유지한다',async()=>{
  const file=nextFile(null,summarize(parse(payload()),'2026-10-16'),now.toISOString()),original=JSON.stringify(file),files=new Map([[OUT,original]]),writes=[];
  let fail=false;
  const fakeFs={readFileSync:p=>files.get(p),writeFileSync:(p,text)=>{writes.push(p);files.set(p,text);if(fail)throw Error('disk-full');},
    renameSync:(from,to)=>{files.set(to,files.get(from));files.delete(from);},rmSync:p=>files.delete(p)};
  const fakeRequire=name=>name==='node:fs'?fakeFs:name==='node:path'?path:require('../js/ledger-benchmark.js');
  const context=vm.createContext({require:fakeRequire,module:{exports:{}},__dirname:path.dirname(SCRIPT),console:{log(){}},AbortSignal,Date,Intl,process:{argv:[]}});
  vm.runInContext(fs.readFileSync(SCRIPT,'utf8'),context);const run=context.module.exports.main;
  const fetcher=async()=>({ok:true,json:async()=>payload()});
  await run([],now,fetcher);assert.equal(writes.length,0,'같은 값이면 쓰기 없음');assert.equal(files.get(OUT),original);
  const updated=payload();updated.find(p=>p.d==='2026-09-30').v[0]+=1;const update=async()=>({ok:true,json:async()=>updated});
  await run(['--dry-run'],now,update);assert.equal(writes.length,0);assert.equal(files.get(OUT),original);
  fail=true;await assert.rejects(run([],now,update),/disk-full/);assert.equal(files.get(OUT),original);assert.equal(files.has(`${OUT}.tmp`),false);
  fail=false;await run([],now,update);assert.deepEqual(writes,[`${OUT}.tmp`,`${OUT}.tmp`]);assert.equal(files.has(`${OUT}.tmp`),false);
  assert.equal(JSON.parse(files.get(OUT)).monthEnd.at(-1).close,5000+9*10+1);assert.ok(cleanGoldData(JSON.parse(files.get(OUT))));
});

test('CLI 수집 실패는 exitCode 1과 기존 자료 유지 안내를 남긴다',async()=>{
  const before=existing(),mod={exports:{}},proc={argv:[]};let error='';
  const fakeRequire=name=>name==='node:fs'?fs:name==='node:path'?path:require('../js/ledger-benchmark.js');fakeRequire.main=mod;
  const context=vm.createContext({require:fakeRequire,module:mod,__dirname:path.dirname(SCRIPT),process:proc,AbortSignal,Date,Intl,
    fetch:async()=>({ok:false,status:403}),console:{error:x=>{error+=x;}}});
  await vm.runInContext(fs.readFileSync(SCRIPT,'utf8'),context);
  assert.equal(proc.exitCode,1);assert.match(error,/http-403.*기존 자료는 그대로 둡니다/);assert.equal(existing(),before);
});
