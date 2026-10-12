const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {quarterly,yoy,buildRows,direction,validate} = require('../js/currency-pressure.js');
const {numberOrNull,parseFredCsv,parseEcosRows,validateEcosSpec,updateSeries,collectFred,collectEcos} = require('../scripts/collect-currency-pressure.cjs');
const near = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const m2 = (values,year=2025) => ({frequency:'M',kind:'money',definitionId:'bok-m2-2025-revision',observations:values.map((value,i)=>({period:`${year+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`,value}))});
const gdp = values => ({frequency:'Q',kind:'gdp',observations:values.map((value,i)=>({period:`${2025+Math.floor(i/4)}-Q${i%4+1}`,value}))});
function fixture() {
  return {schemaVersion:1,series:{krGdp:gdp([100,100,100,100,102,102]),usGdp:gdp([100,100,100,100,103,103]),krM2:m2([...Array(12).fill(100),...Array(6).fill(108)]),usM2:m2([...Array(12).fill(100),...Array(6).fill(105)])}};
}
test('M2는 증가율 평균이 아닌 3개월 수준 평균의 전년 대비이며 부분 분기를 쓰지 않는다',()=>{
  const s=m2([...Array(12).fill(100),110,120,130,140,150]);
  const q=quarterly(s);near(q.get('2026-Q1'),120);near(yoy(q,'2026-Q1'),20);
  assert.equal(q.get('2026-Q2'),null);assert.equal(yoy(q,'2026-Q2'),null);
  s.observations[13].value=null;assert.equal(quarterly(s).get('2026-Q1'),null);
  s.observations[13].value=0;assert.equal(quarterly(s).get('2026-Q1'),null);
});
test('요청한 상대 통화압력 공식과 부호를 반올림 전에 적용한다',()=>{
  const rows=buildRows(fixture(),5,new Date('2026-10-12T00:00:00Z'));
  const row=rows.find(r=>r.quarter==='2026-Q2');
  near(row.krPressure,6);near(row.usPressure,2);near(row.pressure,4);assert.equal(row.missing.length,0);
  assert.equal(direction(row.pressure),'달러 강세 압력');assert.equal(direction(-0.001),'달러 약세 압력');
  assert.equal(direction(0),'중립');assert.equal(direction(null),'자료 대기');
  assert.equal(rows.at(-1).quarter,'2026-Q3');assert.equal(rows.at(-1).pressure,null);
});
test('개편 확인 안 된 한국 M2·전년 자료 결측은 판단을 보류하며 다른 지표를 대신 쓰지 않는다',()=>{
  const data=fixture();data.series.krM2.definitionId='old-m2';
  assert.equal(buildRows(data,5,new Date('2026-10-12')).find(r=>r.quarter==='2026-Q2').pressure,null);
  data.series.krM2.definitionId='bok-m2-2025-revision';data.series.krGdp.observations[1].value=null;
  const row=buildRows(data,5,new Date('2026-10-12')).find(r=>r.quarter==='2026-Q2');
  assert.equal(row.pressure,null);near(row.usPressure,2);assert.ok(row.missing.includes('krGdp'));
});
test('중복 월·분기와 수치 아닌 값은 유효 관측으로 간주하지 않는다',()=>{
  const data=m2([100,100,100]);data.observations.push({...data.observations[1]});
  assert.equal(quarterly(data).get('2025-Q1'),null);
  const quarterlyGdp=gdp([100]);quarterlyGdp.observations.push({period:'2025-Q1',value:101});
  assert.equal(quarterly(quarterlyGdp).get('2025-Q1'),null);
  assert.equal(numberOrNull(''),null);assert.equal(numberOrNull('.'),null);assert.equal(numberOrNull('-'),null);assert.equal(numberOrNull('1,234.5'),1234.5);
});
test('상관·R²·일치율은 실제 환율 변화율을 사용하고 표본 부족·상수 자료는 보류한다',()=>{
  const rows=Array.from({length:20},(_,i)=>({quarter:`${2020+Math.floor(i/4)}-Q${i%4+1}`,pressure:i-9,fxYoy:(i-9)*2,fx:100+i*10}));
  const result=validate(rows);near(result.r,1);near(result.r2,1);near(result.hitRate,100);assert.equal(result.directionalN,19);
  assert.equal(validate(rows.slice(0,11)).r,null);assert.equal(validate(rows.map(r=>({...r,pressure:1}))).r,null);
  assert.equal(validate(rows,1).n,19);assert.equal(validate(rows,4).n,16);
  const gap=rows.filter(r=>r.quarter!=='2021-Q2');assert.equal(validate(gap,1).n,17,'인접 배열 항목을 다음 분기로 오인하지 않는다');
});
test('공식 CSV·ECOS 파서는 날짜·계열을 확인하고 결측을 0으로 바꾸지 않는다',()=>{
  assert.deepEqual(parseFredCsv('observation_date,M2SL\n2026-01-01,100\n2026-02-01,.\n','M'),[{period:'2026-01',value:100},{period:'2026-02',value:null}]);
  assert.throws(()=>parseFredCsv('<html>Error</html>','M'));assert.throws(()=>parseFredCsv('DATE,X\n2026-02-01,10','Q'));
  const spec={table:'101Y003',items:['BBHS00'],frequency:'M'};
  assert.deepEqual(parseEcosRows([{STAT_CODE:spec.table,ITEM_CODE1:'BBHS00',TIME:'202601',DATA_VALUE:'100'}],spec),[{period:'2026-01',value:100}]);
  assert.throws(()=>parseEcosRows([{STAT_CODE:spec.table,ITEM_CODE1:'OTHER',TIME:'202601',DATA_VALUE:'100'}],spec));
});
test('ECOS M2는 개편·평잔·계절조정·확인일이 명시된 설정만 허용한다',()=>{
  const spec={table:'161Y005',items:['BBHS00'],frequency:'M',definitionId:'bok-m2-2025-revision',basis:'period-average',seasonalAdjustment:'SA',verifiedAt:'2026-10-12'};
  assert.doesNotThrow(()=>validateEcosSpec(spec,'krM2'));
  assert.throws(()=>validateEcosSpec({...spec,definitionId:'old-m2'},'krM2'));
  assert.throws(()=>validateEcosSpec({...spec,table:'101Y003'},'krM2'));
  assert.throws(()=>validateEcosSpec({...spec,items:['BBHS11']},'krM2'));
  assert.throws(()=>validateEcosSpec({...spec,seasonalAdjustment:'NSA'},'krM2'));
  assert.throws(()=>validateEcosSpec(null,'krM2'));
});
test('확인한 M2 항목 이름·단위가 달라지면 자동으로 대체하지 않는다',()=>{
  const spec={table:'161Y005',items:['BBHS00'],frequency:'M',unit:'십억원',expectedItemName:'M2(평잔,계절조정계열)'};
  const row={STAT_CODE:spec.table,ITEM_CODE1:'BBHS00',ITEM_NAME1:'M2(평잔, 계절조정계열)',UNIT_NAME:'십억원',TIME:'202607',DATA_VALUE:'4200000'};
  assert.equal(parseEcosRows([row],spec)[0].value,4200000);
  assert.throws(()=>parseEcosRows([{...row,ITEM_NAME1:'[참고] 구 M2'}],spec));
  assert.throws(()=>parseEcosRows([{...row,UNIT_NAME:'전년동월대비%'}],spec));
});
test('수집 실패는 마지막 값·조회일을 유지하고, 개정과 최초 관측시점은 구분한다',()=>{
  const spec={code:'X',definitionId:'d',frequency:'M',observations:[{period:'2026-01',value:100}],sourceUpdatedAt:'2026-02-01'};
  const old=updateSeries(null,spec,null,'2026-02-10T00:00:00Z');
  const failed=updateSeries(old,null,'request-failed','2026-03-10T00:00:00Z');
  assert.equal(failed.status,'error');assert.equal(failed.fetchedAt,old.fetchedAt);assert.deepEqual(failed.observations,old.observations);
  const revised=updateSeries(old,{...spec,sourceUpdatedAt:null,observations:[{period:'2026-01',value:101}]},null,'2026-03-10T00:00:00Z');
  assert.deepEqual(revised.revisedPeriods,['2026-01']);assert.equal(revised.sourceUpdatedAt,null);
  assert.equal(revised.observations[0].firstSeenAt,old.fetchedAt);assert.equal(revised.releaseDate,undefined);
  const changed=updateSeries(old,{...spec,definitionId:'new-definition'},null,'2026-03-10T00:00:00Z');
  assert.deepEqual(changed.revisedPeriods,[]);assert.equal(changed.observations[0].firstSeenAt,'2026-03-10T00:00:00Z');
});
test('키 없는 FRED 공개 수집·키 없는 ECOS 대기와 메타데이터 실패를 처리한다',async()=>{
  const fetcher=async()=>({ok:true,text:async()=> 'observation_date,GDPC1\n2025-01-01,100\n2026-01-01,102\n'});
  const result=await collectFred({code:'GDPC1',frequency:'Q'},'2025',fetcher,{});
  assert.equal(result.observations.length,2);assert.equal(result.releaseDate,null);assert.equal(result.sourceUpdatedAt,null);
  const spec={table:'161Y005',items:['BBHS00'],frequency:'M',definitionId:'bok-m2-2025-revision',basis:'period-average',seasonalAdjustment:'SA',verifiedAt:'2026-10-12'};
  await assert.rejects(collectEcos(spec,'krM2','2025',fetcher,{}),/key-missing/);
});
test('공개 초기 자료에는 확인한 FRED 원자료만 있고 한국 M2·검증 수치는 만들어내지 않는다',()=>{
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/currency-pressure.json'),'utf8'));
  assert.equal(data.schemaVersion,1);
  for(const s of Object.values(data.series)) {
    assert.ok(!s.sourceUrl || /^https:\/\/(fred\.stlouisfed\.org|ecos\.bok\.or\.kr)\//.test(s.sourceUrl));
    assert.equal(new Set((s.observations||[]).map(o=>o.period)).size,(s.observations||[]).length);
    for(const o of s.observations || [])assert.ok(o.value===null || typeof o.value==='number' && Number.isFinite(o.value));
  }
  if(data.series.krM2.status==='pending' && !data.series.krM2.observations.length) {
    assert.ok(buildRows(data).every(row=>row.pressure===null));assert.equal(validate(buildRows(data)).n,0);
  }
});
