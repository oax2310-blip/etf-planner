// S&P 500 Total Return 월말 자료 수집기(scripts/collect-sp500.cjs)를 네트워크 없이 검증한다. 지수 수준은 공표 수익률에 맞춘 가짜 값이다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseChart,summarize,rangeStart,fetchChart,nextFile,main}=require('../scripts/collect-sp500.cjs');
const {cleanSp500Data}=require('../js/ledger-benchmark.js');
const OUT=path.join(__dirname,'../data/sp500-tr.json');

// 2024 말 10000 → 2025 말 11788(+17.88%) → 2026 8월 말 +13.14%, 9월 말 +12.75%. 평일 종가만 만든다.
const level=date=>date<'2025'?10000:date<'2026'?11788:date<'2026-08'?12500:date<'2026-09'?13336.94:date<'2026-10'?13290.97:13500;
function chart(from='2024-12-02',to='2026-10-15',edit=x=>x){
  const timestamp=[],close=[];
  for(let t=Date.parse(`${from}T14:30:00Z`);t<=Date.parse(`${to}T14:30:00Z`);t+=864e5){
    const d=new Date(t);if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
    timestamp.push(t/1000);close.push(level(d.toISOString().slice(0,10)));
  }
  return edit({chart:{result:[{meta:{symbol:'^SP500TR',currency:'USD',exchangeTimezoneName:'America/New_York'},timestamp,indicators:{quote:[{close}]}}],error:null}});
}

test('Yahoo 응답에서 같은 지수·달러의 날짜별 종가만 읽고 빈 종가·겹친 날은 정리한다',()=>{
  const payload=chart('2026-09-28','2026-10-02');
  payload.chart.result[0].indicators.quote[0].close[1]=null;
  payload.chart.result[0].timestamp.push(payload.chart.result[0].timestamp.at(-1)+3600);payload.chart.result[0].indicators.quote[0].close.push(13501.234);
  const {zone,points}=parseChart(payload);
  assert.equal(zone,'America/New_York');
  assert.deepEqual(points.map(p=>p.date),['2026-09-28','2026-09-30','2026-10-01','2026-10-02']);
  assert.deepEqual(points.at(-1),{date:'2026-10-02',close:13501.23},'같은 날은 나중 값, 소수 둘째 자리');
  assert.throws(()=>parseChart(chart('2026-09-28','2026-10-02',p=>{p.chart.result[0].meta.symbol='^GSPC';return p;})),/unexpected-series/,'가격지수는 받지 않는다');
  assert.throws(()=>parseChart(chart('2026-09-28','2026-10-02',p=>{p.chart.result[0].meta.currency='KRW';return p;})),/unexpected-series/);
  assert.throws(()=>parseChart({chart:{result:null,error:{code:'Not Found'}}}),/invalid-response/);
});

test('끝난 해의 연말 종가와 올해 끝난 달의 월말 종가만 남기고 공표치(연간·월말)와 맞는지 확인한다',()=>{
  const {points}=parseChart(chart()),s=summarize(points,'2026-10-16');
  assert.deepEqual(s.yearEnd.map(y=>[y.year,y.date,y.close]),[[2024,'2024-12-31',10000],[2025,'2025-12-31',11788]]);
  assert.deepEqual(s.monthEnd.map(m=>m.ym),['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'],'진행 중인 10월은 넣지 않는다');
  assert.deepEqual(s.monthEnd.at(-1),{ym:'2026-09',date:'2026-09-30',close:13290.97});
  assert.deepEqual(s.verified.map(v=>[v.period,v.official]),[['2025',17.88],['2026-08',13.14],['2026-09',12.75]]);
  for(const v of s.verified)assert.ok(Math.abs(v.returnPct-v.official)<=0.02,`${v.period} ${v.returnPct}`);
  assert.equal(summarize(points,'2026-10-01').monthEnd.length,9,'1일에는 지난달까지');
  assert.equal(summarize(points,'2026-09-15').verified.length,2,'아직 끝나지 않은 9월은 공표치 확인에서 뺀다');
});

test('가격지수처럼 공표치와 다르거나 종가가 빠졌거나 기준 연말이 없으면 기록하지 않는다',()=>{
  const price=parseChart(chart('2024-12-02','2026-10-15',p=>{const r=p.chart.result[0];r.indicators.quote[0].close=r.indicators.quote[0].close.map(v=>v===11788?11639:v);return p;})).points;
  assert.throws(()=>summarize(price,'2026-10-16'),/official-mismatch-2025/,'배당 제외 16.39%는 Total Return 17.88%와 다르다');
  const monthOff=parseChart(chart('2024-12-02','2026-10-15',p=>{const r=p.chart.result[0];r.indicators.quote[0].close=r.indicators.quote[0].close.map(v=>v===13290.97?13200:v);return p;})).points;
  assert.throws(()=>summarize(monthOff,'2026-10-16'),/official-mismatch-2026-09/);
  const gap=parseChart(chart()).points.filter(p=>!(p.date>'2026-07-20'&&p.date<'2026-08-01'));
  assert.throws(()=>summarize(gap,'2026-10-16'),/incomplete-month-2026-07/,'월말 종가가 빠진 달');
  assert.throws(()=>summarize(parseChart(chart('2026-01-05','2026-10-15')).points,'2026-10-16'),/missing-base/);
  assert.throws(()=>summarize(parseChart(chart('2025-06-02','2026-10-15')).points,'2026-10-16'),/no-verification/,'연간 공표치를 확인할 범위가 없다');
});

test('검증 범위는 연간 공표치 전년 12월부터이고, 첫 주소가 실패하면 두 번째 주소로 한 번 더 받는다',async()=>{
  assert.equal(rangeStart(2026),2024);assert.equal(rangeStart(2027),2024);
  const calls=[];const payload=chart();
  const fetcher=async(url,options)=>{calls.push([new URL(url).host,options.headers]);if(calls.length===1)return {ok:false,status:429};return {ok:true,json:async()=>payload};};
  assert.equal(await fetchChart(2024,new Date('2026-10-16T00:00:00Z'),fetcher),payload);
  assert.deepEqual(calls.map(c=>c[0]),['query1.finance.yahoo.com','query2.finance.yahoo.com']);
  assert.ok(!('Authorization' in calls[0][1])&&!('Cookie' in calls[0][1]),'인증·쿠키를 보내지 않는다');
  const url=[];await fetchChart(2024,new Date('2026-10-16T00:00:00Z'),async u=>{url.push(u);return {ok:true,json:async()=>payload};});
  assert.match(url[0],/\/v8\/finance\/chart\/%5ESP500TR\?period1=1733011200&period2=1792108800&interval=1d$/);
  await assert.rejects(fetchChart(2024,new Date(),async()=>({ok:false,status:403})),/http-403/);
});

test('종가가 같으면 파일을 다시 쓰지 않고, 만든 자료는 화면 검증을 통과한다',async()=>{
  const s=summarize(parseChart(chart()).points,'2026-10-16'),file=nextFile(null,s,'2026-10-16T22:40:00.000Z');
  assert.deepEqual(Object.keys(file),['schemaVersion','index','symbol','currency','sourceName','sourceUrl','fetchedAt','verified','yearEnd','monthEnd']);
  assert.equal(nextFile(JSON.parse(JSON.stringify(file)),s,'2026-10-17T22:40:00.000Z'),null,'수집 시각만 다르면 그대로');
  assert.ok(nextFile(file,{...s,monthEnd:s.monthEnd.slice(0,8)},'2026-10-17T22:40:00.000Z'));
  const clean=cleanSp500Data(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(Object.keys(clean.yearEnd),['2024','2025']);assert.equal(clean.monthEnd['2026-09'].close,13290.97);
  // 시험 실행은 기록 파일을 만들거나 바꾸지 않는다.
  const before=fs.existsSync(OUT)?fs.readFileSync(OUT,'utf8'):null,log=console.log;let printed='';console.log=x=>{printed+=x;};
  try{await main(['--dry-run'],new Date('2026-10-16T22:40:00Z'),async()=>({ok:true,json:async()=>chart()}));}finally{console.log=log;}
  assert.equal(fs.existsSync(OUT)?fs.readFileSync(OUT,'utf8'):null,before);
  assert.match(printed,/"dryRun": true/);assert.match(printed,/"period": "2026-09"/);
});

test('11·12월이 통째로 누락되면 10월 말 종가를 연말 기준으로 채택하지 않는다',()=>{
  const points=parseChart(chart()).points.filter(p=>!/^2025-(11|12)-/.test(p.date));
  assert.throws(()=>summarize(points,'2026-10-16'),/incomplete-year-2025/);
});
