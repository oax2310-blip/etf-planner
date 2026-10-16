// 가상 월별 손익 기록으로 S&P 500 연평균 비교만 검증한다. 실제 자산·손익 기록은 사용하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const c=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js','js/ledger-benchmark.js'].map(read).join('\n;\n')}
return {SP500_TR_RETURNS,SP500_COMPARE_FROM,sp500Comparison,yearSummary,averageYearReturn};})()`);
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-9,`${msg}: ${a} ≠ ${b}`);
// 월 수익률 r%를 기록한 가상 연도(총자산 1,000,000원, 월 손익 = r% × 총자산). 연 수익률 = 월 수익률 합(+선물·옵션 ÷ 마지막 총자산).
const yearOf=(year,rates,extra={})=>({year,accounts:[{name:'가상 계좌'}],months:rates.map((r,i)=>({m:i+1,pnl:r*10000,balances:[1000000]})),...extra});
const fixture=()=>[yearOf(2021,Array(12).fill(2)),yearOf(2022,Array(12).fill(-1)),yearOf(2023,Array(12).fill(1.5),{futures:50000}),
  yearOf(2024,Array(12).fill(2.5)),yearOf(2025,Array(12).fill(1)),yearOf(2026,Array(9).fill(1))];
const SP=[28.71,-18.11,26.29,25.02,17.88]; // S&P DJI 공표 S&P 500 Total Return 2021~2025(%)

test('S&P 500 자료는 2021년부터 연속된 Total Return 확정치만 담고 바꿀 수 없다',()=>{
  const years=Object.keys(c.SP500_TR_RETURNS).map(Number);
  assert.equal(c.SP500_COMPARE_FROM,2021);
  assert.deepEqual(years,years.map((_,i)=>2021+i),'연도가 빠짐없이 이어진다');
  assert.deepEqual(years.slice(0,5).map(y=>c.SP500_TR_RETURNS[y]),SP);
  for(const y of years)assert.ok(Number.isFinite(c.SP500_TR_RETURNS[y])&&Math.abs(c.SP500_TR_RETURNS[y])<100,`${y}년 값`);
  assert.ok(Object.isFrozen(c.SP500_TR_RETURNS));
});

test('완료 연도(2021~지난해)의 내 연 수익률과 S&P 500을 같은 연 수익률 산술평균으로 비교하고 올해는 누적만 따로 둔다',()=>{
  const years=fixture(),before=JSON.stringify(years),r=c.sp500Comparison(years,new Date(2026,9,16));
  // 2021 24%, 2022 −12%, 2023 18%+선물 5%, 2024 30%, 2025 12% → 77 ÷ 5
  assert.deepEqual(r.rows.map(x=>x.year),[2021,2022,2023,2024,2025]);
  assert.deepEqual(r.rows.map(x=>Math.round(x.mine*1e9)/1e9),[24,-12,23,30,12]);
  assert.deepEqual([r.from,r.to,r.end,r.years],[2021,2025,2025,5]);
  near(r.mine,15.4,'내 연평균');
  near(r.sp,79.79/5,'S&P 500 연평균 = (28.71 − 18.11 + 26.29 + 25.02 + 17.88) ÷ 5');
  near(r.diff,15.4-15.958,'차이는 반올림 전 평균끼리');
  const cagr=(SP.reduce((p,v)=>p*(1+v/100),1)**(1/5)-1)*100;
  assert.ok(Math.abs(r.sp-cagr)>1,`연복리(${cagr.toFixed(2)}%)와 산술평균을 섞지 않는다`);
  for(const x of r.rows)near(x.mine,c.yearSummary(years.find(y=>y.year===x.year)).rate,`${x.year}년은 연도별 요약 수익률 그대로`);
  assert.deepEqual(r.current,{year:2026,rate:r.current.rate,months:9});near(r.current.rate,9,'올해 누적');
  near(c.averageYearReturn(years).rate,86/6,'기존 연평균(올해 포함) 계산은 그대로');
  assert.deepEqual([r.missing,r.pending],[[],[]]);
  assert.equal(JSON.stringify(years),before,'조회만으로 기록을 바꾸지 않는다');
});

test('해가 바뀌면 지난해가 비교 기간에 들어가고, S&P 500 확정치가 없으면 그해를 양쪽 평균에서 함께 뺀다',()=>{
  const years=fixture(),next=c.sp500Comparison(years,new Date(2027,0,5));
  assert.equal(next.end,2026);assert.deepEqual(next.pending,[2026],'2026년 확정치를 넣기 전');
  assert.deepEqual([next.from,next.to,next.years],[2021,2025,5]);near(next.mine,15.4,'내 평균도 같은 연도만');
  assert.equal(next.current,null,'2027년 기록이 없으면 올해 누적을 표시하지 않는다');
  const newYear=c.sp500Comparison(years,new Date(2026,0,1));assert.equal(newYear.end,2025);assert.equal(newYear.years,5);
  const early=c.sp500Comparison(years,new Date(2022,5,1));assert.deepEqual([early.from,early.to,early.years],[2021,2021,1]);near(early.diff,24-28.71,'2022년 중에는 2021년만');
});

test('내 연 수익률이 없는 완료 연도는 S&P 500 쪽에서도 빼고, 비교할 연도가 없으면 값을 비운다',()=>{
  const years=fixture();years[1].months[3].balances=[];// 2022년 4월 총자산이 없으면 그해 연 수익률은 계산하지 않는다
  years.splice(3,1);// 2024년 기록 없음
  const r=c.sp500Comparison(years,new Date(2026,9,16));
  assert.deepEqual(r.missing,[2022,2024]);assert.deepEqual(r.rows.map(x=>x.year),[2021,2023,2025]);
  near(r.mine,(24+23+12)/3,'내 평균');near(r.sp,(28.71+26.29+17.88)/3,'같은 연도의 S&P 500 평균');
  const none=c.sp500Comparison([yearOf(2026,[1])],new Date(2026,9,16));
  assert.deepEqual([none.years,none.mine,none.sp,none.diff,none.from,none.to],[0,null,null,null,null,null]);
  assert.equal(none.current.months,1);
  assert.equal(c.sp500Comparison(null,new Date(2026,9,16)).years,0);
  assert.equal(c.sp500Comparison([{...yearOf(2021,[1]),year:'2021'}],new Date(2026,9,16)).years,1,'문자 연도도 같은 해로 읽는다');
});

// 연도별 요약 화면: assets.js를 가상 DOM으로 불러 월별 손익 탭만 그린다.
function ledgerHtml(data,now){
  class SystemDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const nodes=new Map(),storage=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},hidden:false,innerHTML:'',textContent:'',classList:{toggle(){}},querySelector:sel=>node(`${id}:${sel}`),setAttribute(){},getAttribute(){}});return nodes.get(id);};
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:node,querySelectorAll:()=>[],addEventListener(){}};
  const store={doc:data,prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe(){},start(){},saveSection(){throw Error('조회만으로 저장하면 안 된다');}};
  const ctx=vm.createContext({Date:SystemDate,document,assetStore:store,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},addEventListener(){},setInterval(){},setTimeout:fn=>{fn();return 1;},
    location:{hash:'#ledger'},history:{replaceState(){}},scrollTo(){}});
  vm.runInContext(['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/ledger-benchmark.js','js/assets.js'].map(read).join('\n;\n'),ctx);
  return node('ledgerView').innerHTML;
}

test('연도별 요약 아래에 내 연평균·S&P 500 연평균·차이(%p)와 기준을 표시하고 기존 요약은 유지한다',()=>{
  const data={version:1,ledger:{savedAt:'2026-01-01',years:fixture()}},before=JSON.stringify(data);
  const html=ledgerHtml(data,new Date(2026,9,16).getTime()),block=html.slice(html.indexOf('class="benchmark"'));
  assert.match(html,/연평균 수익률 <small>6개 연도의 연 수익률 평균 · 올해 포함<\/small><\/span><strong class="">14.3%<\/strong>/,'기존 연평균 줄 유지');
  assert.match(block,/S&amp;P 500 비교<\/b><small>2021~2025년 완료 5개 연도 · 연 수익률 산술평균<\/small>/);
  assert.match(block,/<span>내 연평균<\/span><strong class="">15.40%<\/strong><small>원화 · 실현손익<\/small>/);
  assert.match(block,/<span>S&amp;P 500 연평균<\/span><strong class="">15.96%<\/strong><small>달러 · 배당 재투자<\/small>/);
  assert.match(block,/<span>차이<\/span><strong class="neg">-0.56%p<\/strong>/);
  assert.match(block,/올해 2026년 9개월 누적 <b class="">9%<\/b> · 연간 확정 후 비교에 포함/);
  assert.match(block,/Total Return 지수\(배당 재투자\) 달러 수익률.*원·달러 환율 변동.*원화 실현손익 기준이라 평가손익/);
  assert.equal(JSON.stringify(data),before);
  const pending=ledgerHtml({version:1,ledger:{savedAt:'',years:fixture()}},new Date(2027,0,5).getTime());
  assert.match(pending,/2021~2025년 완료 5개 연도 · 연 수익률 산술평균 · 2026년 S&amp;P 500 확정치 반영 전/);
  assert.doesNotMatch(pending,/올해 2027년/);
  const empty=ledgerHtml({version:1,ledger:{savedAt:'',years:[yearOf(2026,[1])]}},new Date(2026,9,16).getTime());
  assert.match(empty,/비교할 완료 연도가 아직 없습니다/);assert.doesNotMatch(empty,/benchmark-grid/);
});
