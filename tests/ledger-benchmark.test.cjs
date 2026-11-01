// 가상 월별 손익 기록으로 연복리·S&P 500·올해 누적을 검증한다. 실제 자산·손익 기록은 사용하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const c=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js','js/ledger-benchmark.js'].map(read).join('\n;\n')}
return {SP500_TR_RETURNS,SP500_TR_YTD,SP500_COMPARE_FROM,cleanSp500Data,sp500YtdAt,sp500YearReturn,compoundYearReturn,sp500Comparison,ledgerChartData,yearSummary,averageYearReturn};})()`);
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-9,`${msg}: ${a} ≠ ${b}`);
// 월 수익률 r%를 기록한 가상 연도(총자산 1,000,000원, 월 손익 = r% × 총자산).
const yearOf=(year,rates,extra={})=>({year,accounts:[{name:'가상 계좌'}],months:rates.map((r,i)=>({m:i+1,pnl:r*10000,balances:[1000000]})),...extra});
const fixture=()=>[yearOf(2021,Array(12).fill(2)),yearOf(2022,Array(12).fill(-1)),yearOf(2023,Array(12).fill(1.5),{futures:50000}),
  yearOf(2024,Array(12).fill(2.5)),yearOf(2025,Array(12).fill(1)),yearOf(2026,Array(9).fill(1))];
const SP=[28.71,-18.11,26.29,25.02,17.88]; // S&P DJI 공표 S&P 500 Total Return 2021~2025(%)
const fixtureRates=[(1.02**12-1)*100,(.99**12-1)*100,(1.015**12*1.05-1)*100,(1.025**12-1)*100,(1.01**12-1)*100,(1.01**9-1)*100];
const fixtureGrowth=1.02**12*.99**12*1.015**12*1.05*1.025**12*1.01**12;
const completedCompound=(fixtureGrowth**(1/5)-1)*100,spCompound=(SP.reduce((g,r)=>g*(1+r/100),1)**(1/SP.length)-1)*100;
const includes=(html,text,msg)=>assert.ok(html.includes(text),msg||text);

test('연복리 요약은 완료 5년과 올해 마지막 기록 9월을 5.75년으로 계산하고 원본을 바꾸지 않는다',()=>{
  const years=fixture().reverse(),before=JSON.stringify(years),r=c.compoundYearReturn(years,new Date(2026,9,16));
  assert.deepEqual({...r,rate:null},{rate:null,years:6,period:5+9/12,from:2021,to:2026,month:9,partial:false});
  near(r.rate,((fixtureGrowth*1.01**9)**(1/(5+9/12))-1)*100,'올해 포함 연복리');
  const next=c.compoundYearReturn(years,new Date(2027,0,1));
  assert.deepEqual([next.years,next.period,next.from,next.to,next.month,next.partial],[6,6,2021,2026,null,false]);
  near(next.rate,((fixtureGrowth*1.01**9)**(1/6)-1)*100,'해가 바뀌면 지난해는 1년으로 센다');
  assert.equal(JSON.stringify(years),before,'정렬·조회만으로 기록이나 저장 필드를 바꾸지 않는다');
});

test('완료 연도 없이 올해만 있으면 partial로 원래 누적을 그대로 두고 마지막 월을 기간으로 센다',()=>{
  const year=yearOf(2026,Array(9).fill(1)),r=c.compoundYearReturn([year],new Date(2026,9,16));
  assert.deepEqual({...r,rate:null},{rate:null,years:1,period:9/12,from:2026,to:2026,month:9,partial:true});
  assert.equal(r.rate,c.yearSummary(year).rate,'올해 rate를 그대로 반환');
  near(r.rate,(1.01**9-1)*100,'올해 누적을 연환산하지 않는다');
  const sparse=yearOf(2026,[1]);sparse.months[0].m=9;sparse.months.push({m:12,balances:[1000000]});
  const only=c.compoundYearReturn([sparse],new Date(2026,9,16));
  assert.deepEqual([only.period,only.month,only.partial],[9/12,9,true],'입력 건수·잔액만 있는 달 대신 손익을 기록한 마지막 월');
  assert.equal(only.rate,c.yearSummary(sparse).rate);
});

test('연복리 기간은 늦게 시작한 완료 연도도 1년이고 올해 이후 월별 선물옵션 0원도 기록한 달이다',()=>{
  const past=yearOf('2025',[10]);past.months[0].m=7;
  for(const year of [2026,2027]){
    const current={year,accounts:[],months:[{m:4,pnl:10,total:1000},{m:9,futures:0,total:1000},{m:12,total:1000}]};
    const years=[current,past],before=JSON.stringify(years),r=c.compoundYearReturn(years,new Date(2026,9,16));
    assert.deepEqual([r.years,r.period,r.from,r.to,r.month,r.partial],[2,1+9/12,2025,year,9,false]);
    near(r.rate,((1.1*1.01)**(1/(1+9/12))-1)*100,'시작한 달에 상관없이 완료 연도는 1년');
    assert.equal(JSON.stringify(years),before);
  }
});

test('올해 기록한 달이 없거나 연 수익률이 없는 해는 연복리 곱과 기간에서 모두 제외한다',()=>{
  const today=new Date(2026,9,16),past=yearOf(2021,[10]);
  const current={year:2026,accounts:[],futures:100,months:[{m:9,total:1000}]};
  assert.notEqual(c.yearSummary(current).rate,null,'달을 모르는 연 합계만 있는 올해도 제외할 수 있어야 한다');
  const empty=yearOf(2022,[]),missing={year:2024,accounts:[],months:[{m:1,pnl:100}]};
  const years=[current,missing,empty,past],before=JSON.stringify(years),r=c.compoundYearReturn(years,today);
  assert.deepEqual([r.years,r.period,r.from,r.to,r.month,r.partial],[1,1,2021,2021,null,false]);
  near(r.rate,(1.1-1)*100,'기록 없는 중간 해는 기간에 넣지 않는다');
  for(const input of [null,[],[current],[empty,missing]])assert.deepEqual(c.compoundYearReturn(input,today),{rate:null,years:0,period:0,from:null,to:null,month:null,partial:false});
  assert.equal(JSON.stringify(years),before);
});

test('연복리 인수가 0 이하이면 해당 수익률과 비교 차이를 null로 두되 같은 rows와 기간은 유지한다',()=>{
  const today=new Date(2026,9,16),years=[yearOf(2024,[1]),yearOf(2025,[1])];
  // 연 요약의 경계 반환값을 주입해 이 단계의 인수 검사를 독립적으로 검증한다.
  for(const rate of [-100,-120]){
    const boundary=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js','js/ledger-benchmark.js'].map(read).join('\n;\n')}
      yearSummary=()=>({rate:${rate}});return {compoundYearReturn,sp500Comparison};})()`);
    const r=boundary.compoundYearReturn(years,today),comparison=boundary.sp500Comparison(years,today);
    assert.deepEqual([r.rate,r.years,r.period,r.from,r.to],[null,2,2,2024,2025],'음수 인수 두 개의 곱이 양수여도 null');
    assert.deepEqual(comparison.rows.map(r=>r.year),[2024,2025]);assert.equal(comparison.mine,null);assert.equal(comparison.diff,null);
    near(comparison.sp,((1.2502*1.1788)**(1/2)-1)*100,'다른 쪽 연복리는 유지');
    const partial=boundary.compoundYearReturn([yearOf(2026,[1])],today);assert.equal(partial.rate,null);assert.equal(partial.partial,true);
  }
  const data={yearEnd:{2025:{close:1e300},2026:{close:1e-300}}};
  const comparison=c.sp500Comparison([yearOf(2026,[1])],new Date(2027,0,1),data);
  assert.equal(comparison.rows[0].sp,-100,'양수 지수 종가 비율이 반올림되어 인수가 0인 경계');
  assert.equal(comparison.sp,null);assert.equal(comparison.diff,null);near(comparison.mine,(1.01-1)*100);
});

test('S&P 500 자료는 2021년부터 연속된 Total Return 확정치만 담고 바꿀 수 없다',()=>{
  const years=Object.keys(c.SP500_TR_RETURNS).map(Number);
  assert.equal(c.SP500_COMPARE_FROM,2021);
  assert.deepEqual(years,years.map((_,i)=>2021+i),'연도가 빠짐없이 이어진다');
  assert.deepEqual(years.slice(0,5).map(y=>c.SP500_TR_RETURNS[y]),SP);
  for(const y of years)assert.ok(Number.isFinite(c.SP500_TR_RETURNS[y])&&Math.abs(c.SP500_TR_RETURNS[y])<100,`${y}년 값`);
  assert.ok(Object.isFrozen(c.SP500_TR_RETURNS));
});

test('월말 누적 수익률은 연-월 키의 같은 지수 값이며 S&P DJI 대시보드의 월간 수익률과 이어진다',()=>{
  for(const [k,v] of Object.entries(c.SP500_TR_YTD)){assert.match(k,/^\d{4}-(0[1-9]|1[0-2])$/);assert.ok(Number.isFinite(v)&&Math.abs(v)<100,`${k} 값`);}
  assert.ok(Object.isFrozen(c.SP500_TR_YTD));
  assert.deepEqual([c.SP500_TR_YTD['2026-08'],c.SP500_TR_YTD['2026-09']],[13.14,12.75]);
  near(Math.round(((1+13.14/100)*(1-0.35/100)-1)*1e4)/1e2,12.74,'8월 말 누적 × 9월 1개월(−0.35%) ≈ 9월 말 누적(12.75%, 반올림 차 0.01)');
  assert.equal(c.sp500YtdAt(2026,9),12.75);assert.equal(c.sp500YtdAt(2026,10),null);
  assert.equal(c.sp500YearReturn(2025),17.88);assert.equal(c.sp500YearReturn(2026),null,'12월 말 값이 없으면 연간 수익률도 없다');
});

test('완료 연도(2021~지난해)의 내 연 수익률과 S&P 500을 같은 연도 연복리로 비교하고 올해는 누적만 따로 둔다',()=>{
  const years=fixture(),before=JSON.stringify(years),r=c.sp500Comparison(years,new Date(2026,9,16));
  assert.deepEqual(r.rows.map(x=>x.year),[2021,2022,2023,2024,2025]);
  r.rows.forEach((x,i)=>near(x.mine,fixtureRates[i],`${x.year}년 월 복리`));
  assert.deepEqual([r.from,r.to,r.end,r.years],[2021,2025,2025,5]);
  near(r.mine,completedCompound,'내 연복리');
  near(r.sp,spCompound,'S&P 500은 같은 5개 완료 연도의 연복리');
  near(r.diff,completedCompound-spCompound,'차이는 반올림 전 연복리끼리');
  assert.equal(r.diff,r.mine-r.sp,'화면의 반올림한 숫자를 빼지 않는다');
  for(const x of r.rows)near(x.mine,c.yearSummary(years.find(y=>y.year===x.year)).rate,`${x.year}년은 연도별 요약 수익률 그대로`);
  assert.deepEqual({...r.current,rate:null,diff:null},{year:2026,rate:null,months:9,month:9,sp:12.75,diff:null});near(r.current.rate,(1.01**9-1)*100,'올해 누적');near(r.current.diff,(1.01**9-1)*100-12.75,'올해 차이는 같은 9월 말까지');
  near(c.averageYearReturn(years).rate,fixtureRates.reduce((sum,r)=>sum+r,0)/6,'기존 연평균(올해 포함) 계산은 그대로');
  assert.deepEqual([r.missing,r.pending],[[],[]]);
  assert.equal(JSON.stringify(years),before,'조회만으로 기록을 바꾸지 않는다');
});

test('해가 바뀌면 지난해가 비교 기간에 들어가고, S&P 500 확정치가 없으면 그해를 양쪽 연복리에서 함께 뺀다',()=>{
  const years=fixture(),next=c.sp500Comparison(years,new Date(2027,0,5));
  assert.equal(next.end,2026);assert.deepEqual(next.pending,[2026],'2026년 확정치를 넣기 전');
  assert.deepEqual([next.from,next.to,next.years],[2021,2025,5]);near(next.mine,completedCompound,'내 연복리도 같은 연도만');
  assert.equal(next.current,null,'2027년 기록이 없으면 올해 누적을 표시하지 않는다');
  const newYear=c.sp500Comparison(years,new Date(2026,0,1));assert.equal(newYear.end,2025);assert.equal(newYear.years,5);
  const early=c.sp500Comparison(years,new Date(2022,5,1));assert.deepEqual([early.from,early.to,early.years],[2021,2021,1]);near(early.diff,(1.02**12-1)*100-28.71,'2022년 중에는 2021년만');
});

test('내 연 수익률이 없는 완료 연도는 S&P 500 쪽에서도 빼고, 비교할 연도가 없으면 값을 비운다',()=>{
  const years=fixture();years[1].months[3].balances=[];// 2022년 4월 총자산이 없으면 그해 연 수익률은 계산하지 않는다
  years.splice(3,1);// 2024년 기록 없음
  const r=c.sp500Comparison(years,new Date(2026,9,16));
  assert.deepEqual(r.missing,[2022,2024]);assert.deepEqual(r.rows.map(x=>x.year),[2021,2023,2025]);
  near(r.mine,((1.02**12*1.015**12*1.05*1.01**12)**(1/3)-1)*100,'내 연복리');
  near(c.sp500Comparison(fixture().map(y=>y.year===2026?yearOf(2026,Array(8).fill(1)):y),new Date(2026,9,16)).current.sp,13.14,'8월까지 기록했으면 8월 말 S&P 500과 비교');near(r.sp,((1.2871*1.2629*1.1788)**(1/3)-1)*100,'같은 연도의 S&P 500 연복리');
  const none=c.sp500Comparison([yearOf(2026,[1])],new Date(2026,9,16));
  assert.deepEqual([none.years,none.mine,none.sp,none.diff,none.from,none.to],[0,null,null,null,null,null]);
  assert.deepEqual([none.current.months,none.current.month,none.current.sp,none.current.diff],[1,1,null,null],'1월 말 값이 없으면 S&P 500 누적은 비운다');
  const october=c.sp500Comparison([yearOf(2026,Array(10).fill(1))],new Date(2026,9,16)).current;assert.deepEqual([october.month,october.sp,october.diff],[10,null,null],'기록한 달의 월말 값이 없으면 앞달로 대신하지 않는다');
  const gap=yearOf(2026,Array(9).fill(1));gap.months.push({m:10,balances:[1000000]});assert.equal(c.sp500Comparison([gap],new Date(2026,9,16)).current.month,9,'잔액만 있는 달은 손익 기록 달로 세지 않는다');
  assert.equal(c.sp500Comparison(null,new Date(2026,9,16)).years,0);
  assert.equal(c.sp500Comparison([{...yearOf(2021,[1]),year:'2021'}],new Date(2026,9,16)).years,1,'문자 연도도 같은 해로 읽는다');
});

// 공개 수집 자료(data/sp500-tr.json) 형식의 가짜 종가: 2025 말 11788 → 10월 말 +14%, 12월 말 +15%.
const collected=()=>({schemaVersion:1,symbol:'^SP500TR',currency:'USD',yearEnd:[{year:2025,date:'2025-12-31',close:11788},{year:2026,date:'2026-12-31',close:11788*1.15}],
  monthEnd:[{ym:'2026-09',date:'2026-09-30',close:11788*1.1}, {ym:'2026-10',date:'2026-10-30',close:11788*1.14}]});

test('수집 자료는 형식·지수·통화를 확인해 종가만 남기고, 공표치가 없는 달·해를 채운다(공표치 우선)',()=>{
  const data=c.cleanSp500Data(collected());
  assert.deepEqual(Object.keys(data.yearEnd),['2025','2026']);assert.deepEqual(Object.keys(data.monthEnd),['2026-09','2026-10']);
  assert.equal(c.sp500YtdAt(2026,9,data),12.75,'9월은 공표치 우선');near(c.sp500YtdAt(2026,10,data),14,'10월은 수집 종가');
  assert.equal(c.sp500YtdAt(2026,11,data),null);
  near(c.sp500YearReturn(2026,data),15,'연간 공표치를 넣기 전에는 수집한 연말 종가로');assert.equal(c.sp500YearReturn(2025,data),17.88);
  const october=c.sp500Comparison([yearOf(2026,Array(10).fill(1))],new Date(2026,10,3),data).current;
  assert.equal(october.month,10);near(october.sp,14);near(october.diff,(1.01**10-1)*100-14);
  const next=c.sp500Comparison(fixture(),new Date(2027,0,5),data);
  assert.deepEqual([next.from,next.to,next.years,next.pending],[2021,2026,6,[]],'해가 바뀌면 수집한 2026년 연말 종가로 2026년까지 비교');near(next.rows.at(-1).sp,15,'2026년 S&P 500');
  assert.equal(c.sp500Comparison(fixture(),new Date(2027,0,5)).pending.length,1,'수집 자료가 없으면 2026년은 반영 전');
  for(const bad of [null,[],{...collected(),schemaVersion:2},{...collected(),symbol:'^GSPC'},{...collected(),currency:'KRW'}])assert.equal(c.cleanSp500Data(bad),null);
  const odd=collected();odd.yearEnd.push({year:2024,date:'2024-11-29',close:1},{year:'2023',date:'2023-12-29',close:1},{year:2022,date:'2022-12-30',close:-1});
  odd.monthEnd.push({ym:'2026-13',date:'2026-13-01',close:1},{ym:'2026-08',date:'2026-07-31',close:1},{ym:'2026-07',date:'2026-07-31',close:'1'},{ym:'__proto__',date:'x',close:1});
  const cleaned=c.cleanSp500Data(odd);assert.deepEqual(Object.keys(cleaned.yearEnd),['2025','2026']);assert.deepEqual(Object.keys(cleaned.monthEnd),['2026-09','2026-10']);
});

// 연도별 요약 화면: 자산 현황 스크립트(assets.js·assets-ledger.js 등)를 가상 DOM으로 불러 월별 손익 탭만 그린다.
function ledgerPage(data,now,ui=null,fetcher=null){
  class SystemDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const nodes=new Map(),storage=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},hidden:false,innerHTML:'',textContent:'',classList:{toggle(){}},querySelector:sel=>node(`${id}:${sel}`),setAttribute(){},getAttribute(){}});return nodes.get(id);};
  const buttons=['best','both'].map(value=>Object.assign(node(`bench-${value}`),{dataset:{ledgerBench:value}}));
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:node,querySelectorAll:sel=>sel==='[data-ledger-bench]'?buttons:[],addEventListener(){}};
  const store={doc:data,prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe(){},start(){},saveSection(){throw Error('조회만으로 저장하면 안 된다');}};
  const ctx=vm.createContext({Date:SystemDate,document,assetStore:store,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},addEventListener(){},setInterval(){},setTimeout:fn=>{fn();return 1;},
    location:{hash:'#ledger'},history:{replaceState(){}},scrollTo(){}});
  if(fetcher)ctx.fetch=fetcher;
  if(ui)storage.set('etf-planner-assets-ui',JSON.stringify({tab:'ledger',...ui}));
  vm.runInContext(['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/ledger-benchmark.js','js/assets.js','js/assets-ledger.js','js/assets-savings.js','js/assets-installments.js','js/assets-start.js'].map(read).join('\n;\n'),ctx);
  return {ctx,storage,node,buttons,get html(){return node('ledgerView').innerHTML;}};
}
const ledgerHtml=(data,now,ui=null)=>ledgerPage(data,now,ui).html;
const benchmarkHtml=html=>html.slice(html.indexOf('class="benchmark"'));
const benchmarkCells=(html,kind='benchmark-grid')=>{
  const section=html.slice(html.indexOf(`class="${kind}"`));
  if(kind==='benchmark-ytd-cells')return [...section.slice(0,section.indexOf('</div>')).matchAll(/<span>([\s\S]*?)<\/span>/g)].map(m=>m[1]);
  return [...section.slice(0,section.indexOf('class="benchmark-ytd"')).matchAll(/<div(?: class="[^"]*")?>([\s\S]*?)<\/div>/g)].map(m=>m[1]);
};

test('연도별 요약 아래 기본 높은 쪽은 금 연복리·차이를 표시하고 조회만으로 기록을 바꾸지 않는다',()=>{
  const data={version:1,ledger:{savedAt:'2026-01-01',years:fixture()}},before=JSON.stringify(data);
  const html=ledgerHtml(data,new Date(2026,9,16).getTime()),block=html.slice(html.indexOf('class="benchmark"'));
  includes(html,`연복리 수익률 <small>2021~2026년 9월 · 5.75년</small></span><strong class="">${(((fixtureGrowth*1.01**9)**(1/(5+9/12))-1)*100).toFixed(1)}%</strong>`,'올해를 마지막 기록 달까지 기간에 포함');
  assert.match(html,/연 수익률\(월 복리\) · 선물·옵션 포함/);
  const ends=require('../js/ledger-benchmark.js').GOLD_ETF_YEAR_END,goldRate=((ends[2025]/ends[2020])**(1/5)-1)*100;
  assert.match(block,/>지수 비교<\/b>/);
  assert.match(block,/2021~2025년 완료 5개 연도 · 같은 연도 연복리 · 연복리가 더 높은 금 표시 · S&amp;P 500/);
  includes(block,spCompound.toFixed(2)+'%');
  assert.match(block,/data-ledger-bench="best" aria-pressed="true"/);assert.match(block,/data-ledger-bench="both" aria-pressed="false"/);
  const cells=benchmarkCells(block);assert.equal(cells.length,3,'폰에서도 세 칸 구조');
  includes(cells[0],'내 연복리');includes(cells[0],completedCompound.toFixed(2)+'%');
  includes(cells[1],'금 연복리');includes(cells[1],goldRate.toFixed(2)+'%');
  includes(cells[2],'차이');includes(cells[2],(completedCompound-goldRate).toFixed(2)+'%p');
  assert.doesNotMatch(cells[1],/S&amp;P 500 연복리/);
  assert.match(block,/올해 2026년 1~9월 누적/);
  const current=benchmarkCells(block,'benchmark-ytd-cells');assert.equal(current.length,3);
  includes(current[0],'내 누적');includes(current[0],((1.01**9-1)*100).toFixed(2)+'%');includes(current[1],'S&amp;P 500 누적');includes(current[1],c.SP500_TR_YTD['2026-09'].toFixed(2)+'%');includes(block,'누적이 더 높은 S&amp;P 500 표시');
  assert.doesNotMatch(html,/연평균|산술평균|LBMA/);
  assert.doesNotMatch(block,/benchmark-note|원·달러 환율 변동이 빠져|평가손익이 빠져/,'지수 비교 아래 긴 기준 안내 문단은 두지 않는다');
  assert.equal(JSON.stringify(data),before);
  const pending=benchmarkHtml(ledgerHtml({version:1,ledger:{savedAt:'',years:fixture()}},new Date(2027,0,5).getTime()));
  assert.match(pending,/2026년/);assert.match(pending,/S&amp;P 500.*반영 전/);assert.match(pending,/금.*반영 전/);
  assert.doesNotMatch(pending,/올해 2027년/);
  const october=benchmarkHtml(ledgerHtml({version:1,ledger:{savedAt:'',years:fixture().map(y=>y.year===2026?yearOf(2026,Array(10).fill(1)):y)}},new Date(2026,10,3).getTime()));
  assert.match(october,/올해 2026년 1~10월 누적/);includes(benchmarkCells(october,'benchmark-ytd-cells')[1],'반영 전');
  const empty=ledgerHtml({version:1,ledger:{savedAt:'',years:[yearOf(2026,[1])]}},new Date(2026,9,16).getTime());
  assert.match(empty,/비교할 완료 연도가 아직 없습니다/);assert.doesNotMatch(empty,/benchmark-grid/);assert.match(empty,/올해 2026년 1월 누적/);
});

test('연복리 표시 줄은 올해만 있으면 누적 안내, 완료 연도만 있으면 정수 기간, 계산할 해가 없으면 빈 값이다',()=>{
  const today=new Date(2026,9,16).getTime(),render=years=>ledgerHtml({version:1,ledger:{savedAt:'',years}},today);
  includes(render([yearOf(2026,Array(9).fill(1))]),`연복리 수익률 <small>올해 1~9월 누적 · 1년 미만은 연환산하지 않음</small></span><strong class="">${((1.01**9-1)*100).toFixed(1)}%</strong>`);
  includes(render(fixture().slice(0,5)),`연복리 수익률 <small>2021~2025년 · 5년</small></span><strong class="">${completedCompound.toFixed(1)}%</strong>`);
  includes(render([yearOf(2026,[])]),'연복리 수익률 <small>계산할 수 있는 연도가 없습니다</small></span><strong class="">—</strong>');
});

test('월별 손익: 앞뒤 달에는 잔액이 있는데 그달만 빈 계좌는 표시만 하고, 아직 없던·해지한 계좌는 표시하지 않는다',()=>{
  // A 매달 · B 3월만 빔(입력 빠짐) · C 3월부터 빔(해지) · D 4월부터 있음(새 계좌). 금액은 가짜 값.
  const rows=[[100,100,100,null],[100,100,100,null],[100,null,null,null],[100,100,null,100]];
  const year={year:2026,accounts:['A','B','C','D'].map(name=>({name})),months:rows.map((balances,i)=>({m:i+1,pnl:1,balances}))};
  const data={version:1,ledger:{savedAt:'',years:[year]}},before=JSON.stringify(data),html=ledgerHtml(data,new Date(2026,9,16).getTime());
  const row=n=>html.slice(html.indexOf(`data-month="${n}"`),html.indexOf(`data-month="${n+1}"`));
  assert.match(row(3),/빈 계좌 1개 · 확인/,'B만 표시');
  for(const n of [1,2,4])assert.doesNotMatch(row(n),/빈 계좌/,`${n}월`);
  assert.equal(JSON.stringify(data),before,'기록은 바꾸지 않음');
});

test('월별 손익: 항목별로 적은 달은 내역 건수 대신 비어 있는 전용 칸만 경고로 표시한다',()=>{
  // 전용 칸 5개(신한 기본계좌+ISA·연금저축·배당, 키움 실현손익·배당 달러). 금액은 가짜 값.
  const all=[{broker:'신한',label:'기본계좌+ISA',amount:100},{broker:'신한',label:'연금저축',amount:0},{broker:'신한 증권',label:'배당입금내역',amount:10},
    {broker:'키움(영웅문)',label:'실현손익',amount:-50},{broker:'키움',label:'배당',amount:1,currency:'USD',fx:1400,krw:1400}];
  const months=[{m:1,pnl:1000},{m:2,pnlEntries:all},{m:3,pnlEntries:[all[0],all[3]]},{m:4,pnlEntries:[all[0],{broker:'다른 증권사',amount:5}]}];
  const data={version:1,ledger:{savedAt:'',years:[{year:2026,accounts:[],months}]}},before=JSON.stringify(data),html=ledgerHtml(data,new Date(2026,9,16).getTime());
  const row=n=>html.slice(html.indexOf(`data-month="${n}"`),html.indexOf(`data-month="${n+1}"`));
  assert.doesNotMatch(html,/내역 \d+건/,'건수 표시 없음');
  for(const n of [1,2])assert.doesNotMatch(row(n),/빈칸/,`${n}월: 합계만 적었거나(1월) 0원·옛 이름 포함 모두 채움(2월)`);
  assert.match(row(3),/<small class="same-tag">빈칸 3개 · 확인<\/small>/);
  assert.match(row(4),/<small class="same-tag">빈칸 4개 · 확인<\/small>/,'추가 내역은 전용 칸으로 세지 않음');
  assert.equal(JSON.stringify(data),before,'기록은 바꾸지 않음');
});

test('맨 위 누적 그래프 자료: 월 복리 누적 끝에 선물·옵션 연 합계 인수까지 반영해 연 수익률과 같고 S&P 500은 연도별 요약과 같은 기준이다',()=>{
  const years=fixture(),before=JSON.stringify(years),today=new Date(2026,9,16);
  const now=c.ledgerChartData(yearOf(2026,Array(9).fill(1),{futures:-20000}),today);
  assert.deepEqual(now.rate.map(p=>p.m),[1,2,3,4,5,6,7,8,9]);near(now.rate[7].v,(1.01**8-1)*100,'8월까지 월 수익률 1% 월 복리');
  near(now.rate.at(-1).v,(1.01**9*.98-1)*100,'달을 모르는 연 합계 인수는 마지막 달에 곱한다');near(now.rate.at(-1).v,now.total,'그래프 끝 = 연 수익률');near(now.total,(1.01**9*.98-1)*100,'yearSummary.rate');
  assert.deepEqual(now.won.map(p=>p.v),[1,2,3,4,5,6,7,8,7].map(n=>n*10000));assert.equal(now.won.at(-1).v,now.pnl,'그래프 끝 = 실현손익 + 선물·옵션');
  assert.deepEqual([now.from,now.month,now.unrated],[0,9,[]]);
  assert.deepEqual(now.sp,[{m:8,v:13.14},{m:9,v:12.75}],'수집 자료가 없으면 공표치가 있는 달만');near(now.diff,(1.01**9*.98-1)*100-12.75,'올해는 기록한 마지막 달 말 누적과 비교');
  const sp=c.ledgerChartData(yearOf(2026,Array(10).fill(1)),new Date(2026,10,3),c.cleanSp500Data(collected())).sp;
  assert.deepEqual(sp.map(p=>p.m),[8,9,10]);assert.equal(sp[1].v,12.75,'공표치 우선');near(sp[2].v,14,'10월은 수집 종가');
  const past=c.ledgerChartData(years[4],today);
  assert.deepEqual(past.sp,[{m:12,v:17.88}],'월말 값이 없는 지난해는 12월 연간 값만');near(past.diff,(1.01**12-1)*100-17.88,'지난해는 연간 수익률과 비교');
  const future=c.ledgerChartData(yearOf(2027,[1]),today);assert.deepEqual([future.sp,future.spAt,future.diff],[[],null,null],'아직 오지 않은 해');
  const empty=c.ledgerChartData({year:2026,accounts:[],months:[]},today);assert.deepEqual([empty.month,empty.won,empty.rate,empty.sp],[null,[],[],[]]);
  const gap=yearOf(2026,Array(9).fill(1));gap.months[3].balances=[];
  const g=c.ledgerChartData(gap,today);assert.deepEqual([g.rate,g.unrated,g.won.length,c.yearSummary(gap).rate],[null,[4],9,null],'총자산이 빈 달이 있으면 수익률 누적을 그리지 않고 금액은 그린다');
  const late=yearOf(2026,[1,1,1]);late.months.forEach((m,i)=>{m.m=i+3;});assert.equal(c.ledgerChartData(late,today).from,2,'3월부터 기록했으면 0점은 2월');
  assert.equal(JSON.stringify(years),before,'조회만으로 기록을 바꾸지 않는다');
});

test('복리 그래프 끝은 연 요약과 같고 금액 누적은 덧셈이며 기록을 바꾸지 않는다',()=>{
  const years=[...fixture(),{year:2026,accounts:[],futures:50,months:[{m:3,total:2000},{m:2,pnl:0,total:1000},{m:1,futures:100,total:1000}]}];
  const before=JSON.stringify(years),today=new Date(2026,9,16);
  for(const year of years){
    const s=c.yearSummary(year),g=c.ledgerChartData(year,today);
    assert.equal(g.rate.at(-1).v,s.rate,'그래프 끝 = yearSummary.rate');
    assert.equal(g.won.at(-1).v,s.pnl,'금액 끝 = yearSummary.pnl');
    let sum=0;
    g.won.forEach((p,i)=>{const m=year.months.find(m=>m.m===p.m);sum+=(m.pnl||0)+(m.futures||0);assert.equal(p.v,sum+(i===g.won.length-1?(year.futures||0):0));});
  }
  near(c.ledgerChartData(years.at(-1),today).total,((1+100/1000)*(1+0/1000)*(1+50/2000)-1)*100,'잔액만 있는 마지막 달은 연 합계 분모로만 사용');
  assert.equal(JSON.stringify(years),before,'조회·정렬만으로 원본과 저장 필드를 바꾸지 않는다');
});

test('0 이하인 월·연 합계 인수는 수익률 그래프를 비우고 카드에 계산 불가를 표시하며 금액은 유지한다',()=>{
  const today=new Date(2026,9,16);
  for(const loss of [-100,-120])for(const kind of ['pnl','futures','year','twice']){
    const year=yearOf(2026,[1,loss]);
    if(kind==='futures'){year.months[1].futures=year.months[1].pnl;delete year.months[1].pnl;}
    if(kind==='year'){year.futures=year.months[1].pnl;year.months[1].pnl=0;}
    if(kind==='twice')year.months[0].pnl=loss*10000;
    const before=JSON.stringify(year),g=c.ledgerChartData(year,today),s=c.yearSummary(year);
    assert.deepEqual([g.rate,g.total,g.diff,g.unrated,s.annual],[null,null,null,[],null],`${kind}: ${loss}`);
    assert.equal(g.won.at(-1).v,(kind==='twice'?loss:1)*10000+loss*10000);
    const data={version:1,ledger:{savedAt:'',years:[year]}},html=ledgerHtml(data,today.getTime());
    assert.match(html,/<h2 class="warn">수익률을 계산할 수 없습니다<\/h2>/);
    assert.doesNotMatch(html,/class="ledger-chart"|<small>연환산/);
    assert.match(html,/<span>—<small>월 복리<\/small><\/span>/);
    assert.match(ledgerHtml(data,today.getTime(),{ledgerChart:'won'}),/class="ledger-chart"/,'금액 누적은 표시');
    assert.equal(JSON.stringify(year),before,'조회·화면 렌더만으로 기록을 바꾸지 않는다');
  }
  const missing=yearOf(2026,[1],{futures:0});missing.months.push({m:2,balances:[0]});
  const g=c.ledgerChartData(missing,today);assert.deepEqual([g.rate,g.total,g.unrated],[null,null,[]],'연 합계가 있는데 마지막 총자산이 0이면 그래프도 계산 불가');
});

test('월별 손익 맨 위 카드: 고른 기간 누적이 높은 S&P 500과 비교하고 선물·옵션은 따로 나눠 보이지 않으며, 금액 보기는 이 기기 화면 설정',()=>{
  const years=fixture().map(y=>y.year===2026?yearOf(2026,Array(9).fill(1),{futures:-20000}):y),data={version:1,ledger:{savedAt:'',years}},before=JSON.stringify(data),at=new Date(2026,9,16).getTime();
  const page=ledgerPage(data,at),raw=goldCollected(),rate=(1.01**9*.98-1)*100,spRate=c.SP500_TR_YTD['2026-09'];
  page.ctx.fakeGold=raw;vm.runInContext('goldData=cleanGoldData(fakeGold);renderLedger();',page.ctx);
  const html=page.html;
  assert.match(html,/<h1 class="sr-only">월별 손익<\/h1>/);assert.doesNotMatch(html,/class="card metrics"/,'세 칸 지표 카드 대신 맨 위 카드');
  assert.match(html,/data-pick-year="2026" aria-pressed="true">2026<\/button><button class="chip add" id="addYear"/,'연도 칩 끝에 연도 추가');
  assert.match(html,/2026년 1~9월 누적 수익률/);includes(html,`S&amp;P 500보다 <em class="down">${(spRate-rate).toFixed(2)}%p 낮아요</em>`);
  includes(html,`내 누적<b>${rate.toFixed(2)}%</b></span><span class="ledger-key"><i class="sp"></i>S&amp;P 500<b>${spRate.toFixed(2)}%</b>`);
  const card=html.slice(0,html.indexOf('</section>')).replace('원화 실현손익(선물·옵션 포함) 기준','원화 실현손익 기준');
  assert.doesNotMatch(card,/선물·옵션|ledger-calc|class="(?:drop|mid)/,'카드에 선물·옵션을 따로 쓰거나 그리지 않음');assert.match(html,/원화 실현손익\(선물·옵션 포함\) 기준 월 복리 누적/);
  assert.equal((card.match(/<circle /g)||[]).length,3,'점은 S&P 500 8·9월과 내 누적 끝만');
  assert.equal((html.match(/class="month(?: on)?" style="left:/g)||[]).length,12,'월 글자 12개');assert.match(html,/class="month on" style="left:[\d.]+%">9</,'마지막 기록 달 강조');
  assert.match(html,/<div class="ledger-cells"><div><span>실현손익<\/span><b class="">7만원<\/b><\/div><div><span>총자산 9월 말<\/span><b class="">100만원<\/b><\/div><\/div>/);
  includes(html,`<small>연환산 ${(((1.01**9*.98)**(12/9)-1)*100).toFixed(1)}%</small></span></div></section>`,'연환산은 합계 줄로, 선물·옵션 포함 복리 환산');
  const won=ledgerHtml(data,at,{ledgerChart:'won'});
  assert.match(won,/2026년 1~9월 누적 실현손익/);assert.match(won,/실현손익 <em class="up">70,000원<\/em>/);assert.doesNotMatch(won,/class="ledger-key"><i class="(?:sp|gold)">/,'금액 보기에는 지수 없음');
  assert.match(won,/<i><\/i>월 손익 누적<\/span>/);assert.match(won,/달마다 실현손익\(선물·옵션 포함\)을 더한 누적입니다/);assert.doesNotMatch(won.slice(0,won.indexOf('</section>')).replace('(선물·옵션 포함)',''),/선물·옵션|ledger-calc|class="(?:drop|mid)/,'금액 보기도 선물·옵션을 따로 나누지 않음');
  const past=ledgerHtml(data,at,{year:2025});
  assert.match(past,/2025년 1~12월 누적 수익률/);includes(past,`금보다 <em class="down">${((goldEnds[2025]/goldEnds[2024]-1)*100-(1.01**12-1)*100).toFixed(2)}%p 낮아요</em>`);assert.match(past,/1월부터 이어지지 않는 지수 값은 점으로 표시/);
  const gap=JSON.parse(before);gap.ledger.years[5].months[3].balances=[];
  assert.match(ledgerHtml(gap,at),/<h2 class="warn">4월 총자산이 없어 수익률을 계산하지 못했습니다<\/h2>/);
  const blank=JSON.parse(before);blank.ledger.years.push({year:2027,accounts:[],months:[]});
  assert.match(ledgerHtml(blank,at,{year:2027}),/아직 기록한 달이 없습니다/);
  assert.equal(JSON.stringify(data),before,'기록은 바꾸지 않음');
});

test('월별 선물·옵션: 월 손익에 더해 복리 누적하고, 달을 모르는 연 합계는 마지막 점에 인수로 반영하며 표에는 그 금액 줄만 둔다',()=>{
  const today=new Date(2026,9,16), year=yearOf(2026,Array(9).fill(1),{futures:-10000});
  year.months[1].futures=-30000;year.months[4].futures=20000;// 2월 −3%, 5월 +2% (총자산 1,000,000원)
  const before=JSON.stringify(year), g=c.ledgerChartData(year,today);
  near(g.rate[1].v,(1.01*(1+(10000-30000)/1000000)-1)*100,'2월 누적은 1월 1%와 2월 −2%의 복리');
  near(g.rate[7].v,(1.01**6*.98*1.03-1)*100,'8월 누적에 월별 선물·옵션 포함');near(g.rate.at(-1).v,(1.01**7*.98*1.03*.99-1)*100,'9월 누적에 연 합계(−10,000원 ÷ 마지막 총자산)까지 포함');near(g.rate.at(-1).v,g.total,'그래프 끝 = 연 수익률');
  assert.deepEqual([g.won[1].v,g.won.at(-1).v],[-10000,70000]);assert.equal(g.won.at(-1).v,g.pnl);
  const tenth={...yearOf(2026,Array(9).fill(1)),months:[...yearOf(2026,Array(9).fill(1)).months,{m:10,futures:5000,balances:[1000000]}]};
  assert.equal(c.ledgerChartData(tenth,new Date(2026,10,3)).month,10,'선물·옵션만 넣은 달도 기록 달');assert.equal(c.sp500Comparison([tenth],new Date(2026,10,3)).current.month,10,'S&P 500 비교 달도 같다');
  const html=ledgerHtml({version:1,ledger:{savedAt:'',years:[year]}},today.getTime());
  includes(html,`내 누적<b>${((1.01**7*.98*1.03*.99-1)*100).toFixed(2)}%</b>`);assert.doesNotMatch(html.slice(0,html.indexOf('</section>')).replace('(선물·옵션 포함)',''),/선물·옵션|ledger-calc/,'카드에는 선물·옵션 포함 누적만');
  const row=n=>html.slice(html.indexOf(`data-month="${n}"`),html.indexOf(`data-month="${n+1}"`));
  for(const n of [2,5])assert.doesNotMatch(row(n),/선물·옵션/,`${n}월: 넣은 값은 줄에 따로 표시하지 않음`);
  assert.match(row(2),/<span class="neg">-20,000원<\/span><span class="neg">-2%<\/span>/,'2월 줄 = 실현손익 10,000원 + 선물·옵션 −30,000원');
  assert.match(row(5),/<span class="">30,000원<\/span><span class="">3%<\/span>/,'5월 줄 = 실현손익 10,000원 + 선물·옵션 20,000원');
  for(const n of [1,3,9])assert.match(row(n),/<small class="same-tag">선물·옵션 미입력<\/small>/,`${n}월: 월별로 넣는 해의 빈 달`);
  assert.doesNotMatch(row(10),/미입력/,'기록 없는 달은 표시하지 않음');
  assert.doesNotMatch(ledgerHtml({version:1,ledger:{savedAt:'',years:[yearOf(2026,Array(9).fill(1),{futures:-10000})]}},today.getTime()),/선물·옵션 미입력/,'연 합계만 쓰는 해는 표시하지 않음');
  assert.match(html,/<button class="ledger-row foot" type="button" id="editFutures" aria-label="2026년 달을 모르는 선물·옵션 손익 수정"><span>선물·<wbr>옵션<small>수정<\/small><\/span><span class="neg">-10,000원<small>달을 모르는 금액<\/small><\/span><span>-1%<\/span>/,'연 합계만 따로 한 줄');
  includes(html,`<span>합계</span><span class="">70,000원</span><span>${((1.01**7*.98*1.03*.99-1)*100).toFixed(1)}%<small>월 복리</small></span>`,'금액은 달 줄 합 + 연 합계, 수익률은 월 복리');
  const monthly=JSON.parse(before);delete monthly.futures;const only=ledgerHtml({version:1,ledger:{savedAt:'',years:[monthly]}},today.getTime());
  assert.doesNotMatch(only,/id="editFutures"/,'월별로만 넣은 해는 선물·옵션 줄 없음(연도 설정에서 넣음)');includes(only,`<span>합계</span><span class="">80,000원</span><span>${((1.01**7*.98*1.03-1)*100).toFixed(1)}%<small>월 복리</small></span>`,'금액은 달 줄의 합, 수익률은 월 복리');
  assert.doesNotMatch(ledgerHtml({version:1,ledger:{savedAt:'',years:[yearOf(2026,Array(9).fill(1))]}},today.getTime()),/id="editFutures"/,'선물·옵션이 없는 해도 줄 없음');
  assert.equal(JSON.stringify(year),before,'기록은 바꾸지 않음');
});

// openMonth·openYear의 기존 VM 하네스. 동적 HTML의 칸만 가볍게 읽어 실제 입력·저장 경로를 호출한다.
function ledgerDialog(year,{popover=true}={}){
  const nodes=new Map(),storage=new Map(),rendered=new Map(),saves=[],listeners=new Map();
  const decode=value=>String(value).replace(/&(amp|lt|gt|quot|#39);/g,(_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[k]));
  const match=(x,selector)=>selector.split(',').some(part=>{
    part=part.trim();if(part===':popover-open')return !!x.popoverOpen;
    const tag=part.match(/^[a-z]+/i)?.[0];if(tag&&x.tagName!==tag.toUpperCase())return false;
    const id=part.match(/#([\w-]+)/)?.[1];if(id&&x.id!==id)return false;
    const klass=part.match(/\.([\w-]+)/)?.[1];if(klass&&!String(x.className||'').split(/\s+/).includes(klass))return false;
    return [...part.matchAll(/\[([\w-]+)(?:([*^$]?=)"([^\"]*)")?\]/g)].every(([,key,op,value])=>{
      const attr=x.attrs?.[key];if(attr===undefined)return false;if(!op)return true;
      return op==='='?attr===value:op==='^='?attr.startsWith(value):op==='$='?attr.endsWith(value):attr.includes(value);
    });
  });
  const query=(selector,id)=>[...(id?rendered.get(id)||[]:[...rendered.values()].flat())].filter(x=>match(x,selector));
  const field=()=>({value:'',readOnly:false,setCustomValidity(message){this.validationMessage=message;}});
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const x={...field(),id,dataset:{},attrs:{id},hidden:false,textContent:'',open:false,isConnected:true,style:{},classList:{toggle(){}},
      querySelector:sel=>query(sel,id)[0]||node(`${id}:${sel}`),querySelectorAll:sel=>query(sel,id),
      setAttribute(key,value){this.attrs[key]=String(value);},getAttribute(key){return this.attrs[key]??null;},
      addEventListener(type,fn){(this.listeners??={})[type]=fn;},removeEventListener(){},
      matches(selector){return match(this,selector);},getBoundingClientRect:()=>({left:20,right:52,top:100,bottom:132}),
      focus(){},setSelectionRange(){},reportValidity(){
        const fields=id==='monthForm'?[...query('input','monthFields'),...query('input','pnlEntryRows')]:id==='yearForm'?[this.futures,this.note,...query('input','accountRows')]:[];
        return !this.validationMessage&&fields.every(field=>!field.validationMessage);
      },showModal(){this.open=true;},close(){this.open=false;},
      showPopover(){this.popoverOpen=true;},hidePopover(){this.popoverOpen=false;}};
    let html='';Object.defineProperty(x,'innerHTML',{get:()=>html,set:value=>{
      html=String(value);const children=[];
      for(const [,tag,raw] of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){
        const attrs=Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key,decode(value??'')]));
        const child=attrs.id?node(attrs.id):{...field(),...x,id:'',listeners:{}};
        Object.assign(child,{attrs,tagName:tag.toUpperCase(),className:attrs.class||'',value:attrs.value||'',validationMessage:'',dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]))});
        if(attrs.name)node(id==='accountRows'?'yearForm':'monthForm')[attrs.name]=child;
        children.push(child);
      }
      rendered.set(id,children);
    }});
    nodes.set(id,x);return x;
  };
  Object.assign(node('monthForm'),{pnl:field(),futures:field(),dividendFx:field()});
  Object.assign(node('yearForm'),{futures:field(),note:field()});
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:sel=>query(sel)[0]||node(sel),querySelectorAll:sel=>query(sel),addEventListener(type,fn){listeners.set(type,fn);}};
  const store={doc:{version:1,ledger:{savedAt:'',years:year?[year]:[]}},prices:null,saveSection:section=>saves.push(section)};
  class HTMLElement{};if(popover)HTMLElement.prototype.popover='auto';
  const ctx=vm.createContext({Date,document,assetStore:store,HTMLElement,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},addEventListener(){},setInterval(){},setTimeout:fn=>{fn();return 1;},
    location:{hash:'#ledger'},history:{replaceState(){}},scrollTo(){},innerWidth:393,innerHeight:852,confirm:()=>true,alert:message=>{throw Error(message);}});
  vm.runInContext(['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/ledger-benchmark.js','js/assets.js','js/assets-ledger.js'].map(read).join('\n;\n'),ctx);
  vm.runInContext('render=()=>{}',ctx);ctx.year=year;
  return {ctx,node,saves,query,
    openMonth(n=3){vm.runInContext(`openMonth(year,${n})`,ctx);return node('monthFields').innerHTML;},
    openYear(){vm.runInContext('openYear(year)',ctx);},
    input(name,value){const x=node('monthForm')[name];assert.ok(x,`입력 칸 ${name}`);x.value=String(value);x.oninput?.({target:x});listeners.get('input')?.({target:x});return x;},
    submit(id='monthForm'){node(id).onsubmit({preventDefault(){}});},
  };
}

test('월별 손익: 음수가 될 수 있는 손익 칸은 \'-\'·\'.\' 키가 있는 키패드(numeric), 배당·잔액은 소수 키패드(decimal)를 쓴다',()=>{
  // 삼성 키보드는 inputmode=decimal 키패드에 '-' 키가 없고 numeric 키패드에는 '-'와 '.'이 있다. 금액은 가짜 값.
  const {ctx,node}=ledgerDialog();
  const entries=[{broker:'B',amount:-700},{broker:'C',amount:-1.5,currency:'USD',krw:-2000}];
  ctx.year={year:2026,accounts:[{name:'A'}],months:[{m:3,pnl:-5000,futures:-12000,balances:[1000000],pnlEntries:entries}]};
  vm.runInContext('openMonth(year,3)',ctx);
  const html=node('monthFields').innerHTML,rows=node('pnlEntryRows').innerHTML,key=mode=>attr=>new RegExp(`<input ${attr}[^>]*type="text" inputmode="${mode}" autocomplete="off" data-money`);
  const numeric=key('numeric'),decimal=key('decimal');
  assert.match(html,numeric('name="pnl"'));
  assert.match(html,numeric('name="futures"'));
  for(const i of [0,1,3])assert.match(html,numeric(`data-pnl-fixed="${i}"`),`손익 항목 ${i}`);
  for(const i of [2,4])assert.match(html,decimal(`data-pnl-fixed="${i}"`),`배당 ${i}`);
  assert.match(html,decimal('name="bal0"'),'잔액');
  assert.match(rows,numeric('data-pnl-entry="0" data-k="amount"'),'원화 내역 금액');
  assert.match(rows,numeric('data-pnl-entry="1" data-k="amount"'),'달러 내역 금액(소수점 포함)');
  assert.match(rows,numeric('data-pnl-entry="1" data-k="krw"'),'원화 입금액');
  assert.doesNotMatch(html+rows,/sign-toggle|data-sign/,'부호 버튼 없음');
  assert.match(read('assets.html'),/<input name="futures" type="text" inputmode="numeric" autocomplete="off" data-money aria-describedby="yearFuturesHint" \/>/,'연도 설정 선물·옵션');
});

test('월 입력 RP 칸과 안내 버튼은 키움·영웅문 해외 및 RP 기록 계좌에만 있고 loan은 제외한다',()=>{
  const names=['영 웅 문 해 외 가상','키 움 해외 가상','키움 국내 가상','영웅문 가상','다른 해외 가상','바꾼 가상 이름','키움 해외 대출','키움 해외 "<가상>"'];
  const year={year:2026,accounts:names.map((name,i)=>({name,...(i===6?{loan:true}:{})})),months:[{m:3,balances:[1000,2000,3000,4000,5000,6000,7000,8000],rp:[null,null,null,null,null,0,300],rpUsd:[null,null,null,null,null,0]}]};
  const before=JSON.stringify(year),h=ledgerDialog(year),html=h.openMonth();
  for(const i of [0,1,5,7]){
    assert.match(html,new RegExp(`<input[^>]*name="rp${i}"[^>]*inputmode="decimal"`),`RP 대상 ${i}`);
    assert.match(html,new RegExp(`<button[^>]*data-ledger-rp-help="${i}"`),`안내 버튼 ${i}`);
    assert.match(html,new RegExp(`<label[^>]*for="ledgerBal${i}"`),'원화추정자산 label과 입력 칸을 연결');
  }
  for(const i of [2,3,4,6])assert.doesNotMatch(html,new RegExp(`name="rp${i}"|data-ledger-rp-help="${i}"`),`RP 비대상 ${i}`);
  assert.doesNotMatch(html,/name="bal6"/,'loan은 원래 잔액 칸도 숨긴다');
  assert.match(html,/aria-label="키움 해외 &quot;&lt;가상&gt;&quot; 입력 안내"/,'이름은 HTML 속성에서도 이스케이프');
  assert.doesNotMatch(html,/<가상>|"<가상>"/);
  for(const label of html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g))assert.doesNotMatch(label[0],/data-ledger-rp-help/,'안내 버튼을 label 안에 두지 않는다');
  assert.equal(h.node('monthForm').rp5.value,'0','RP 0달러도 숨기지 않는다');
  assert.match(html,/<span>RP \(달러\)<\/span>/);assert.doesNotMatch(html,/RP \(원\)/,'RP는 달러 칸만 둔다');
  assert.equal(JSON.stringify(year),before);assert.deepEqual(h.saves,[],'창을 열기만 해서 기록을 저장하지 않는다');
});

// RP 환율 검증용 가상 원/달러 125개월선(실제 시세 아님)
const ledgerFx=(h,ma,extra='')=>vm.runInContext(`prices={fx:{ma:{"125개월선":${ma}},maAsOf:"2026-10-30"${extra}}}`,h.ctx);

test('월 입력은 RP 달러를 125개월 평균 환율로 환산해 balances에 원화추정자산+RP를 저장하고 다시 열면 기록 환율을 유지하며 RP를 비우면 필드를 지운다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'},{name:'가상 일반'}],months:[{m:3,pnl:0,balances:[1000,2000]}]};
  const h=ledgerDialog(year);ledgerFx(h,1300.5);h.openMonth();
  assert.equal(h.node('ledgerRpFx0').textContent,'125개월 평균 1,300.5원 · 2026-10-30');assert.equal(h.node('ledgerRpWon0').textContent,'—');
  h.input('bal0','1,500');h.input('rp0','2.5');h.input('bal1','3,000');
  assert.equal(h.node('ledgerRpWon0').textContent,'3,251원','2.5달러 × 1,300.5원 반올림');
  h.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,pnl:0,balances:[4751,3000],rp:[3251],rpUsd:[2.5],rpFx:[1300.5]});
  assert.deepEqual(h.saves,['ledger']);
  ledgerFx(h,1400);const saved=JSON.stringify(year);h.openMonth();
  assert.equal(h.node('monthForm').bal0.value,'1,500');assert.equal(h.node('monthForm').rp0.value,'2.5');
  assert.equal(h.node('ledgerRpFx0').textContent,'125개월 평균 1,300.5원 · 기록한 환율','현재 평균선이 바뀌어도 저장한 환율 유지');
  assert.equal(JSON.stringify(year),saved);assert.equal(h.saves.length,1,'재열기도 저장하지 않는다');
  h.input('rp0','3');h.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,pnl:0,balances:[5402,3000],rp:[3902],rpUsd:[3],rpFx:[1300.5]},'금액을 고쳐도 기록 환율로 환산');
  h.openMonth();h.input('rp0','');h.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,pnl:0,balances:[1500,3000]});
  for(const key of ['rp','rpUsd','rpFx'])assert.equal(Object.hasOwn(year.months[0],key),false,`비운 RP 필드 ${key}는 삭제`);
});

test('월 입력의 빈칸·RP만 입력·명시적 0원과 배열 끝 null은 저장 시 구분한다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상 A'},{name:'가상 일반'},{name:'영웅문 해외 가상 B'},{name:'가상 끝'}],months:[{m:3,pnl:0}]};
  const h=ledgerDialog(year);ledgerFx(h,1300);h.openMonth();h.input('rp0','100');h.input('rp2','0');h.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,pnl:0,balances:[130000,null,0],rp:[130000,null,0],rpUsd:[100,null,0],rpFx:[1300,null,1300]},'기초 잔액 없이 RP만 있어도 합계에 포함하고 끝 null만 제거');
  h.openMonth();assert.equal(h.node('monthForm').bal0.value,'0','RP만 있는 합계에서 RP를 뺀 값');
  h.input('bal0','');h.input('rp0','');h.input('bal2','');h.input('rp2','');h.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,pnl:0},'모든 잔액·RP를 비우면 선택 필드 삭제');
});

test('옛 월 기록은 RP 필드를 만들지 않고 기존 잔액을 그대로 열고 저장한다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'},{name:'가상 일반'}],months:[{m:3,balances:[1234,500]}]};
  const h=ledgerDialog(year),before=JSON.stringify(year);h.openMonth();
  assert.equal(h.node('monthForm').bal0.value,'1,234');assert.equal(h.node('monthForm').rp0.value,'');
  assert.equal(h.node('monthForm').bal1.value,'500');assert.equal(JSON.stringify(year),before);assert.deepEqual(h.saves,[]);
  h.submit();assert.equal(JSON.stringify(year),before,'옛 기록을 저장해도 빈 RP 필드는 생기지 않는다');
  const commaYear={year:2026,accounts:[{name:'키움 해외 가상'},{name:'가상 일반'}],months:[{m:3,balances:['1,200','2,500']}]};
  const comma=ledgerDialog(commaYear),commaBefore=JSON.stringify(commaYear);comma.openMonth();
  assert.equal(comma.node('monthForm').bal0.value,'1,200','대상 계좌의 옛 쉼표 문자열 잔액 유지');
  assert.equal(comma.node('monthForm').bal1.value,'2,500','일반 계좌의 옛 쉼표 문자열 잔액 유지');
  assert.equal(comma.node('monthForm').rp0.value,'');assert.equal(JSON.stringify(commaYear),commaBefore);assert.deepEqual(comma.saves,[]);
  comma.submit();assert.deepEqual(JSON.parse(JSON.stringify(commaYear.months[0])),{m:3,balances:[1200,2500]},'저장할 때만 기존 숫자 형식으로 바꾸며 RP는 만들지 않는다');
});

test('계좌 잔액 제목 합계와 RP 계좌 소계는 입력 때 바로 갱신하고 빈 값은 숨긴다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'},{name:'가상 일반'},{name:'가상 loan',loan:true}],months:[{m:3,balances:[null,null,900],rp:[null,null,100]}]};
  const h=ledgerDialog(year);h.openMonth();
  assert.equal(h.node('ledgerBalanceTotal').hidden,true);assert.equal(h.node('ledgerAccountTotal0').hidden,true);
  h.input('bal0','1,000');assert.equal(h.node('ledgerBalanceTotal').textContent,'합계 1,000원');assert.equal(h.node('ledgerBalanceTotal').hidden,false);
  ledgerFx(h,1300);h.input('rp0','0.5');assert.equal(h.node('ledgerBalanceTotal').textContent,'합계 1,650원');
  assert.equal(h.node('ledgerAccountTotal0').textContent,'계좌 합계 1,650원 (원화추정자산 + RP)');assert.equal(h.node('ledgerAccountTotal0').hidden,false);
  h.input('bal1','2,000');assert.equal(h.node('ledgerBalanceTotal').textContent,'합계 3,650원','loan 잔액은 합계에 포함하지 않는다');
  h.input('rp0','');assert.equal(h.node('ledgerAccountTotal0').hidden,true);assert.equal(h.node('ledgerBalanceTotal').textContent,'합계 3,000원');
  h.input('bal0','');h.input('bal1','0');assert.equal(h.node('ledgerBalanceTotal').textContent,'합계 0원');assert.equal(h.node('ledgerBalanceTotal').hidden,false,'0원은 입력한 값');
  h.input('bal1','');assert.equal(h.node('ledgerBalanceTotal').hidden,true);assert.deepEqual(h.saves,[],'합계 갱신은 저장하지 않는다');
});

test('RP 음수·잘못된 숫자는 다른 잔액 입력과 제출 뒤에도 거부하고 고친 값만 저장한다',()=>{
  for(const invalid of ['-1','abc','1.2.3','Infinity','NaN','1e3','0x10']){
    const year={year:2026,accounts:[{name:'키움 해외 가상'}],months:[{m:3,balances:[1000],rp:[100]}]};
    const h=ledgerDialog(year),before=JSON.stringify(year);ledgerFx(h,1300);h.openMonth();
    h.input('rp0',invalid);h.input('bal0','2,500');
    assert.ok(h.node('monthForm').rp0.validationMessage,`${invalid}: 다른 칸 입력 뒤에도 RP 오류 유지`);
    h.submit();assert.deepEqual(h.saves,[],`${invalid}: 잘못된 RP는 저장하지 않는다`);
    assert.equal(JSON.stringify(year),before);assert.equal(h.node('monthDialog').open,true,'오류가 있으면 창을 유지한다');
    h.input('rp0','3');assert.equal(h.node('monthForm').rp0.validationMessage,'');h.submit();
    assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,balances:[6400],rp:[3900],rpUsd:[3],rpFx:[1300]});
    assert.deepEqual(h.saves,['ledger']);assert.equal(h.node('monthDialog').open,false);
  }
});

test('달러 칸 이전의 원화 RP는 달러 칸을 비운 채 저장해도 보존하고 달러를 넣으면 환산액으로 바꾼다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'}],months:[{m:3,balances:[1000],rp:[100]}]};
  const h=ledgerDialog(year),before=JSON.stringify(year);ledgerFx(h,1300);h.openMonth();
  assert.equal(h.node('monthForm').bal0.value,'900');assert.equal(h.node('monthForm').rp0.value,'','원화 기록을 달러 칸에 넣지 않는다');
  assert.equal(h.node('ledgerRpFx0').textContent,'기존 원화 기록입니다. 달러로 넣으면 125개월 평균 환율로 바꿉니다.');
  assert.equal(h.node('ledgerRpWon0').textContent,'100원');assert.equal(h.node('ledgerAccountTotal0').textContent,'계좌 합계 1,000원 (원화추정자산 + RP)');
  h.submit();assert.equal(JSON.stringify(year),before,'달러 칸을 비우면 원화 rp와 합계를 그대로 저장');
  h.openMonth();h.input('rp0','1');assert.equal(h.node('ledgerRpWon0').textContent,'1,300원');h.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,balances:[2200],rp:[1300],rpUsd:[1],rpFx:[1300]});
  // 옛 화면에서 원화 RP만 고쳐 달러×환율과 다른 기록은 원화 rp를 정본으로 보고, 저장하면 맞지 않는 달러·환율을 지운다.
  const edited={year:2026,accounts:[{name:'키움 해외 가상'}],months:[{m:3,balances:[5000],rp:[2000],rpUsd:[1],rpFx:[1300]}]};
  const e=ledgerDialog(edited);ledgerFx(e,1300);e.openMonth();
  assert.equal(e.node('monthForm').bal0.value,'3,000');assert.equal(e.node('monthForm').rp0.value,'');e.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(edited.months[0])),{m:3,balances:[5000],rp:[2000]});
});

test('RP 125개월선이 없으면 환산·저장을 막고 시세가 오면 새 평균선을 적용한다. 0달러는 환율 없이 0원이다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'}],months:[{m:3,balances:[1000]}]};
  const h=ledgerDialog(year),before=JSON.stringify(year);h.openMonth();
  assert.equal(h.node('ledgerRpFx0').textContent,'125개월 평균선을 불러오면 자동 적용됩니다.');
  h.input('rp0','2');assert.equal(h.node('ledgerRpWon0').textContent,'평균선 필요');assert.equal(h.node('ledgerAccountTotal0').hidden,true);
  assert.throws(()=>h.submit(),/125개월 평균선/);assert.equal(JSON.stringify(year),before);assert.deepEqual(h.saves,[]);
  ledgerFx(h,1250,',maStale:true');vm.runInContext('updateLedgerDividendFx()',h.ctx);
  assert.equal(h.node('ledgerRpWon0').textContent,'2,500원');assert.match(h.node('ledgerRpFx0').textContent,/1,250원 · 2026-10-30 · 갱신 필요$/);
  h.submit();assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,balances:[3500],rp:[2500],rpUsd:[2],rpFx:[1250]});
  const zero={year:2026,accounts:[{name:'키움 해외 가상'}],months:[{m:3,balances:[1000]}]};
  const z=ledgerDialog(zero);z.openMonth();z.input('rp0','0');z.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(zero.months[0])),{m:3,balances:[1000],rp:[0],rpUsd:[0]},'환율이 없으면 rpFx를 만들지 않는다');
  z.openMonth();assert.equal(z.node('monthForm').rp0.value,'0','0달러 기록을 다시 연다');
});

test('125개월 평균선 갱신은 저장한 RP 환율도 현재 평균선으로 바꾸고 평균선을 못 받으면 기록 환율을 유지한다',async()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'}],months:[{m:3,balances:[3600],rp:[2600],rpUsd:[2],rpFx:[1300]}]};
  const h=ledgerDialog(year);ledgerFx(h,1400);vm.runInContext('refreshAssetPrices=async()=>{};globalThis.assetConfig=()=>null',h.ctx);h.openMonth();
  h.node('monthDialog').open=true;assert.equal(h.node('ledgerRpWon0').textContent,'2,600원');
  vm.runInContext('prices=null',h.ctx);await h.node('refreshDividendFx').onclick();
  assert.equal(h.node('ledgerRpWon0').textContent,'2,600원','평균선이 없으면 기록 환율 유지');
  ledgerFx(h,1400);await h.node('refreshDividendFx').onclick();
  assert.equal(h.node('ledgerRpWon0').textContent,'2,800원');assert.match(h.node('ledgerRpFx0').textContent,/^125개월 평균 1,400원 · 2026-10-30/);
  h.submit();assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,balances:[3800],rp:[2800],rpUsd:[2],rpFx:[1400]});
});

test('RP 계좌의 입력 빠짐 표시는 원화추정자산 칸에 유지한다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'},{name:'가상 일반'}],months:[{m:2,balances:[1000,2000]},{m:3,balances:[null,2100]},{m:4,balances:[1200,2200]}]};
  const h=ledgerDialog(year),html=h.openMonth();
  assert.match(html,/<input[^>]*name="bal0"[^>]*placeholder="입력 빠짐\?"/);
  assert.match(html,/<input[^>]*name="rp0"[^>]*placeholder="미입력"/);
  assert.match(html,/앞뒤 달에는 잔액이 있습니다/);assert.deepEqual(h.saves,[]);
});

test('연도 설정에서 계좌 삭제·loan 뒤로 정렬 시 balances와 rp·rpUsd·rpFx 인덱스를 함께 맞춘다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상 A'},{name:'가상 loan',loan:true},{name:'영웅문 해외 가상 B'},{name:'가상 일반'}],months:[
    {m:2,balances:[1000,2000,3000,4000],rp:[100,200,300],rpUsd:[1,null,3],rpFx:[100,null,100]},
    {m:3,rp:[100,null,300]},
    {m:4,balances:[1100,2200,3300,4400]},
  ]};
  const h=ledgerDialog(year),before=JSON.stringify(year);h.openYear();assert.equal(JSON.stringify(year),before);assert.deepEqual(h.saves,[]);
  h.submit('yearForm');
  assert.deepEqual(Array.from(year.accounts,a=>a.name),['키움 해외 가상 A','영웅문 해외 가상 B','가상 일반','가상 loan']);
  assert.deepEqual(JSON.parse(JSON.stringify(year.months)),[
    {m:2,balances:[1000,3000,4000,2000],rp:[100,300,null,200],rpUsd:[1,3],rpFx:[100,100]},
    {m:3,rp:[100,300]},
    {m:4,balances:[1100,3300,4400,2200]},
  ],'loan 보존 순서 변경과 balances 없는 달의 RP도 함께 remap');
  h.openYear();h.query('[data-acc-del="0"]')[0].onclick();h.submit('yearForm');
  assert.deepEqual(Array.from(year.accounts,a=>a.name),['영웅문 해외 가상 B','가상 일반','가상 loan']);
  assert.deepEqual(JSON.parse(JSON.stringify(year.months)),[
    {m:2,balances:[3000,4000,2000],rp:[300,null,200],rpUsd:[3],rpFx:[100]},
    {m:3,rp:[300]},
    {m:4,balances:[3300,4400,2200]},
  ],'삭제한 계좌의 두 금액 배열을 같은 인덱스로 제거');
});

test('연도 설정에서 마지막 RP 계좌를 지우면 비어 있는 rp를 삭제하고 새 계좌는 null로 맞춘다',()=>{
  const year={year:2026,accounts:[{name:'키움 해외 가상'},{name:'가상 일반'}],months:[{m:3,balances:[1000,2000],rp:[100]}]};
  const h=ledgerDialog(year);h.openYear();h.query('[data-acc-del="0"]')[0].onclick();
  h.node('addAccount').onclick();const added=h.query('[data-acc-name="1"]')[0];added.value='가상 새 계좌';added.oninput();h.submit('yearForm');
  assert.deepEqual(Array.from(year.accounts,a=>a.name),['가상 일반','가상 새 계좌']);
  assert.deepEqual(JSON.parse(JSON.stringify(year.months[0])),{m:3,balances:[2000]},'새 계좌의 끝 null도 남기지 않는다');
});

// 금 비교도 같은 가상 기록으로 검증한다. 아래 수집 자료는 실제 시세가 아닌 검증용 종가다.
const goldCalc=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js','js/ledger-benchmark.js'].map(read).join('\n;\n')}
return {GOLD_LBMA_YEAR_END,GOLD_ETF_YEAR_END,cleanGoldData,goldYearReturn,goldYtdAt,goldComparison,bestBenchmark,periodBenchmark,ledgerChartData};})()`);
const goldEnds=goldCalc.GOLD_ETF_YEAR_END;
const goldCollected=()=>({schemaVersion:1,symbol:'GLDM',currency:'USD',
  yearEnd:[{year:2025,date:'2025-12-30',close:goldEnds[2025]},{year:2026,date:'2026-12-30',close:goldEnds[2025]*1.12},{year:2027,date:'2027-12-30',close:goldEnds[2025]*1.12*1.05}],
  monthEnd:[{ym:'2026-08',date:'2026-08-28',close:goldEnds[2025]*1.08},{ym:'2026-09',date:'2026-09-30',close:goldEnds[2025]*1.1}]});
const goldCompound=((goldEnds[2025]/goldEnds[2020])**(1/5)-1)*100;

test('기간별 높은 지수는 유한수끼리 비교하고 동점은 S&P 500, 하나만 있으면 그쪽, 둘 다 없으면 fallback이다',()=>{
  assert.equal(goldCalc.periodBenchmark(12,10),'sp500');assert.equal(goldCalc.periodBenchmark(-12,-10),'gold');
  assert.equal(goldCalc.periodBenchmark(0,0),'sp500');assert.equal(goldCalc.periodBenchmark(12,12,'gold'),'sp500');
  assert.equal(goldCalc.periodBenchmark(0,null),'sp500');assert.equal(goldCalc.periodBenchmark(null,0),'gold');
  const absent=[null,undefined,NaN,Infinity,-Infinity,'12',{},[]];
  for(const value of absent){
    assert.equal(goldCalc.periodBenchmark(1,value,'gold'),'sp500','한쪽 유한수 S&P 500');
    assert.equal(goldCalc.periodBenchmark(value,-1),'gold','한쪽 유한수 금');
    assert.equal(goldCalc.periodBenchmark(value,value),'sp500','둘 다 없으면 기본 S&P 500');
    assert.equal(goldCalc.periodBenchmark(value,value,'gold'),'gold','둘 다 없으면 전달한 fallback');
  }
});

test('금 계산 상수는 2020년부터 이어지는 GLDM 연말 종가이며 frozen이고 DOM 없이 내보낸다',()=>{
  const years=Object.keys(goldEnds).map(Number);
  assert.deepEqual(years,Array.from({length:6},(_,i)=>2020+i));
  assert.deepEqual(Object.values(goldEnds),[37.88,36.36,36.19,40.91,51.99,85.37],'실제 Yahoo CI에서 확인한 소수 둘째 자리 종가');
  assert.ok(Object.isFrozen(goldEnds));assert.ok(Object.isFrozen(goldCalc.GOLD_LBMA_YEAR_END),'LBMA 교차 확인 상수도 유지');
  for(const year of years.slice(1))near(goldCalc.goldYearReturn(year),(goldEnds[year]/goldEnds[year-1]-1)*100,`${year}년 GLDM 비율`);
  const exported=require('../js/ledger-benchmark.js');
  assert.deepEqual(exported.GOLD_ETF_YEAR_END,goldEnds);assert.ok(Object.isFrozen(exported.GOLD_ETF_YEAR_END));
  assert.deepEqual(exported.GOLD_LBMA_YEAR_END,goldCalc.GOLD_LBMA_YEAR_END);
  assert.deepEqual(exported.cleanGoldData(goldCollected()),goldCalc.cleanGoldData(goldCollected()));
});

test('금 수집 자료는 형식·지수·통화를 확인하고 S&P 500과 같은 날짜·양수 종가 검증을 적용한다',()=>{
  for(const bad of [null,[],{},'gold',...['schemaVersion','symbol','currency'].map(key=>{const raw=goldCollected();delete raw[key];return raw;}),
    {...goldCollected(),schemaVersion:2},{...goldCollected(),schemaVersion:'1'},{...goldCollected(),symbol:'^SP500TR'},
    {...goldCollected(),symbol:'LBMA-GOLD-AM'},{...goldCollected(),symbol:'LBMA-GOLD-PM'},{...goldCollected(),symbol:'GLD'},
    {...goldCollected(),currency:'KRW'}])assert.equal(goldCalc.cleanGoldData(bad),null);
  const raw=goldCollected();raw.yearEnd[0].extra='제외';raw.monthEnd[0].extra='제외';
  raw.yearEnd.push(null,{year:2024,date:'2024-11-29',close:1},{year:'2023',date:'2023-12-29',close:1},
    {year:2022,date:'2022-12-30',close:-1},{year:2021,date:'2021-12-30',close:0},{year:2020,date:'2020-12-30',close:Infinity});
  raw.monthEnd.push(null,{ym:'2026-13',date:'2026-13-01',close:1},{ym:'2026-07',date:'2026-06-30',close:1},
    {ym:'2026-06',date:'2026-06-30',close:'1'},{ym:'2026-05',date:'2026-05-29',close:NaN},{ym:'__proto__',date:'x',close:1});
  const before=structuredClone(raw),data=goldCalc.cleanGoldData(raw);
  assert.deepEqual(data,c.cleanSp500Data({...raw,symbol:'^SP500TR'}));
  assert.deepEqual(Object.keys(data.yearEnd),['2025','2026','2027']);assert.deepEqual(Object.keys(data.monthEnd),['2026-08','2026-09']);
  assert.deepEqual(data.yearEnd[2025],{date:'2025-12-30',close:goldEnds[2025]});assert.deepEqual(data.monthEnd['2026-08'],{date:'2026-08-28',close:goldEnds[2025]*1.08});
  assert.deepEqual(raw,before,'검증은 원본을 바꾸지 않는다');assert.notEqual(data.yearEnd[2025],raw.yearEnd[0]);
  assert.deepEqual(goldCalc.cleanGoldData({...goldCollected(),yearEnd:{},monthEnd:null}),{yearEnd:{},monthEnd:{}});
});

test('금 수집 자료도 연말 200개·월말 240개까지만 읽는다',()=>{
  const raw={...goldCollected(),yearEnd:Array.from({length:201},(_,i)=>({year:1900+i,date:`${1900+i}-12-30`,close:1})),
    monthEnd:Array.from({length:241},(_,i)=>{const ym=`${2000+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;return {ym,date:`${ym}-28`,close:1};})};
  const data=goldCalc.cleanGoldData(raw);
  assert.equal(Object.keys(data.yearEnd).length,200);assert.equal(Object.keys(data.monthEnd).length,240);
  assert.equal(data.yearEnd[2100],undefined);assert.equal(data.monthEnd['2020-01'],undefined);
  assert.deepEqual(data,c.cleanSp500Data({...raw,symbol:'^SP500TR'}));
});

test('금 연간·월말 수익률은 GLDM 상수 우선이고 없는 연말만 같은 ETF 수집값으로 채운다',()=>{
  const raw=goldCollected();raw.yearEnd[0].close=1;raw.yearEnd.push({year:2024,date:'2024-12-30',close:2},{year:2019,date:'2019-12-30',close:40});
  const data=goldCalc.cleanGoldData(raw);
  near(goldCalc.goldYearReturn(2025,data),(goldEnds[2025]/goldEnds[2024]-1)*100,'양쪽 GLDM 상수 우선');
  near(goldCalc.goldYearReturn(2026,data),(goldEnds[2025]*1.12/goldEnds[2025]-1)*100,'수집 그해 말 ÷ GLDM 상수 전년 말');
  near(goldCalc.goldYearReturn(2020,data),(goldEnds[2020]/40-1)*100,'GLDM 상수 그해 말 ÷ 수집 전년 말');
  near(goldCalc.goldYearReturn(2026,{yearEnd:{2026:data.yearEnd[2026]}}),(1.12-1)*100,'전년 GLDM 상수가 있으면 수집 기준값은 없어도 된다');
  near(goldCalc.goldYearReturn(2020,{yearEnd:{2019:{close:40},2020:{close:42}}}),(goldEnds[2020]/40-1)*100,'그해 상수를 수집값보다 우선한다');
  near(goldCalc.goldYearReturn(2027,data),(goldEnds[2025]*1.12*1.05/(goldEnds[2025]*1.12)-1)*100,'양쪽 상수가 없으면 수집 종가');
  for(const year of [2019,2020,2026,2028])assert.equal(goldCalc.goldYearReturn(year),null);
  assert.equal(goldCalc.goldYearReturn(2028,data),null);
  near(goldCalc.goldYtdAt(2026,9,data),(goldEnds[2025]*1.1/goldEnds[2025]-1)*100,'월말 분모도 GLDM 상수 우선');
  near(goldCalc.goldYtdAt(2026,9,{monthEnd:data.monthEnd}),(1.1-1)*100,'GLDM 전년 말 상수가 수집 기준값을 대신한다');
  const next={...data,monthEnd:{'2027-03':{date:'2027-03-31',close:goldEnds[2025]*1.12*.97}}};
  near(goldCalc.goldYtdAt(2027,3,next),(.97-1)*100,'전년 말 상수가 없으면 수집값');
  assert.equal(goldCalc.goldYtdAt(2026,10,data),null,'9월 값으로 대신하지 않는다');
  assert.equal(goldCalc.goldYtdAt(2026,9),null);assert.equal(goldCalc.goldYtdAt(2027,3,{monthEnd:next.monthEnd}),null,'전년 말 기준값 없음');
});

test('금 비교는 같은 완료 5개 연도의 연복리와 반올림 전 차이를 반환하고 금을 최상위 지수로 고른다',()=>{
  const years=fixture(),today=new Date(2026,9,16),data=goldCalc.cleanGoldData(goldCollected()),r=goldCalc.goldComparison(years,today,data),sp=c.sp500Comparison(years,today);
  assert.deepEqual(Object.keys(r),Object.keys(sp).map(k=>k==='sp'?'gold':k));
  assert.deepEqual(r.rows.map(x=>x.year),[2021,2022,2023,2024,2025]);assert.deepEqual([r.from,r.to,r.end,r.years,r.missing,r.pending],[2021,2025,2025,5,[],[]]);
  r.rows.forEach((row,i)=>{assert.deepEqual(Object.keys(row),['year','mine','gold']);near(row.mine,fixtureRates[i]);near(row.gold,goldCalc.goldYearReturn(row.year));});
  near(r.mine,completedCompound,'내 연복리');near(r.gold,goldCompound,'금 연복리');near(r.diff,completedCompound-goldCompound,'내 − 금');
  assert.equal(r.diff,r.mine-r.gold);assert.equal(goldCalc.bestBenchmark(sp,r),'gold');
  assert.deepEqual({...r.current,rate:null,gold:null,diff:null},{year:2026,rate:null,months:9,month:9,gold:null,diff:null});
  near(r.current.rate,(1.01**9-1)*100);near(r.current.gold,(1.1-1)*100);near(r.current.diff,(1.01**9-1)*100-(1.1-1)*100);
  assert.equal(goldCalc.goldComparison(years,today).current.gold,null,'월 수집값은 연말 상수로 대체하지 않는다');
});

test('금 비교도 기록 없는 해와 지수 대기 연도를 제외하고 올해 마지막 손익 달만 비교한다',()=>{
  const years=fixture();years[1].months[3].balances=[];years.splice(3,1);
  const r=goldCalc.goldComparison(years,new Date(2027,0,5));
  assert.deepEqual([r.missing,r.pending,r.current,r.rows.map(x=>x.year)],[[2022,2024],[2026],null,[2021,2023,2025]]);
  near(r.mine,((1.02**12*1.015**12*1.05*1.01**12)**(1/3)-1)*100);
  near(r.gold,((goldEnds[2021]/goldEnds[2020]*goldEnds[2023]/goldEnds[2022]*goldEnds[2025]/goldEnds[2024])**(1/3)-1)*100);
  const data=goldCalc.cleanGoldData(goldCollected()),next=goldCalc.goldComparison(fixture(),new Date(2027,0,5),data);
  assert.deepEqual([next.to,next.years,next.pending],[2026,6,[]]);near(next.gold,((goldEnds[2025]*1.12/goldEnds[2020])**(1/6)-1)*100);
  const current=yearOf(2026,Array(9).fill(1));current.months.push({m:10,futures:0,balances:[1000000]},{m:11,balances:[1000000]});
  const now=goldCalc.goldComparison([current],new Date(2026,10,3),data);
  assert.deepEqual([now.years,now.mine,now.gold,now.diff,now.from,now.to],[0,null,null,null,null,null]);
  assert.deepEqual([now.current.month,now.current.gold,now.current.diff],[10,null,null],'선물옵션 0원도 기록 달이며 잔액만 있는 달은 제외');
  const empty=goldCalc.goldComparison(null,new Date(2026,9,16));assert.equal(empty.years,0);assert.equal(empty.current,null);
  assert.equal(goldCalc.goldComparison([{...yearOf(2021,[1]),year:'2021'}],new Date(2026,9,16)).years,1);
});

test('금 비교도 0 이하인 연복리 인수는 해당 값과 차이만 null로 둔다',()=>{
  for(const rate of [-100,-120]){
    const boundary=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js','js/ledger-benchmark.js'].map(read).join('\n;\n')}
      yearSummary=()=>({rate:${rate}});return goldComparison;})()`);
    const r=boundary([yearOf(2024,[1]),yearOf(2025,[1])],new Date(2026,9,16));
    assert.deepEqual([r.years,r.mine,r.diff],[2,null,null]);near(r.gold,((goldEnds[2025]/goldEnds[2023])**(1/2)-1)*100);
  }
  const r=goldCalc.goldComparison([yearOf(2027,[1])],new Date(2028,0,1),{yearEnd:{2026:{close:1e300},2027:{close:1e-300}}});
  assert.equal(r.rows[0].gold,-100);assert.equal(r.gold,null);assert.equal(r.diff,null);near(r.mine,(1.01-1)*100);
});

test('최상위 지수는 공통 연도의 수익률로 연복리를 다시 계산하며 사전 집계값이나 산술평균을 쓰지 않는다',()=>{
  const sp={sp:1000,rows:[{year:2021,sp:1000},{year:2022,sp:5}]},gold={gold:-99,rows:[{year:2022,gold:10},{year:2023,gold:-99}]};
  const before=structuredClone({sp,gold});
  assert.equal(goldCalc.bestBenchmark(sp,gold),'gold','겹치지 않는 연도와 사전 집계값 제외');
  assert.equal(goldCalc.bestBenchmark({rows:[{year:2022,sp:10}]},{rows:[{year:2021,gold:1000},{year:2022,gold:5}]}),'sp500');
  assert.equal(goldCalc.bestBenchmark({rows:[{year:2021,sp:100},{year:2022,sp:-50}]},{rows:[{year:2022,gold:10},{year:2021,gold:10}]}),'gold','같은 해를 맞춰 복리로 계산');
  assert.deepEqual({sp,gold},before,'조회 중 rows를 정렬하거나 바꾸지 않는다');
});

test('최상위 지수는 동점·빈 비교에 S&P 500을 쓰고 한쪽에만 rows가 있으면 그쪽을 고른다',()=>{
  const sp={rows:[{year:2021,sp:10},{year:2022,sp:20}]},gold={rows:[{year:2022,gold:20},{year:2021,gold:10}]};
  assert.equal(goldCalc.bestBenchmark(sp,gold),'sp500');assert.equal(goldCalc.bestBenchmark({rows:[]},gold),'gold');
  assert.equal(goldCalc.bestBenchmark(sp,{rows:[]}),'sp500');assert.equal(goldCalc.bestBenchmark({rows:[]},{rows:[]}),'sp500');
  assert.equal(goldCalc.bestBenchmark(null,gold),'gold');assert.equal(goldCalc.bestBenchmark(null,null),'sp500');
  assert.equal(goldCalc.bestBenchmark({rows:[{year:2021,sp:1}]},{rows:[{year:2022,gold:20}]}),'sp500','양쪽 rows가 있지만 공통 연도 없음');
});

test('금 그래프는 올해 해당 월말과 지난해 연간을 비교하며 기존 그래프 필드와 S&P 500 값은 유지한다',()=>{
  const today=new Date(2026,9,16),data=goldCalc.cleanGoldData(goldCollected()),spData=c.cleanSp500Data(collected()),year=yearOf(2026,Array(9).fill(1));
  const chart=goldCalc.ledgerChartData(year,today,spData,data),strip=({gold,goldAt,goldDiff,...rest})=>rest;
  assert.deepEqual(strip(chart),strip(c.ledgerChartData(year,today,spData)));
  assert.deepEqual(chart.gold.map(p=>p.m),[8,9]);near(chart.gold[0].v,(1.08-1)*100);near(chart.gold[1].v,(1.1-1)*100);
  near(chart.goldAt,(1.1-1)*100);near(chart.goldDiff,(1.01**9-1)*100-(1.1-1)*100);
  const missing=goldCalc.ledgerChartData(yearOf(2026,Array(10).fill(1)),today,spData,data);
  assert.deepEqual(missing.gold,chart.gold);assert.equal(missing.goldAt,null);assert.equal(missing.goldDiff,null,'앞달 값으로 대체하지 않는다');
  const pastData={...data,yearEnd:{...data.yearEnd,2024:{date:'2024-12-30',close:goldEnds[2024]}}};
  const past=goldCalc.ledgerChartData(yearOf(2025,[1]),today,null,{...pastData,monthEnd:{'2025-06':{date:'2025-06-30',close:goldEnds[2024]*1.1}}});
  assert.deepEqual(past.gold.map(p=>p.m),[6,12]);near(past.gold[0].v,(1.1-1)*100);near(past.gold[1].v,(goldEnds[2025]/goldEnds[2024]-1)*100);
  near(past.goldAt,(goldEnds[2025]/goldEnds[2024]-1)*100);near(past.goldDiff,(1.01-1)*100-(goldEnds[2025]/goldEnds[2024]-1)*100);
  const december=goldCalc.ledgerChartData(yearOf(2025,[1]),today,null,{...pastData,monthEnd:{'2025-12':{date:'2025-12-30',close:goldEnds[2025]}}});
  assert.equal(december.gold.length,1,'12월 점을 중복 추가하지 않는다');near(december.gold[0].v,(goldEnds[2025]/goldEnds[2024]-1)*100);
  for(const y of [yearOf(2027,[1]),yearOf(2026,[])]){
    const r=goldCalc.ledgerChartData(y,today,spData,data);assert.deepEqual([r.gold,r.goldAt,r.goldDiff],[[],null,null]);
  }
  year.months[3].balances=[];const gap=goldCalc.ledgerChartData(year,today,spData,data);
  assert.equal(gap.rate,null);assert.equal(gap.goldDiff,null);near(gap.goldAt,(1.1-1)*100,'내 수익률이 없어도 금 월말은 유지');
});

test('금 비교·지수 선택·그래프 조회만으로 기록과 수집 자료 및 저장 필드를 바꾸지 않는다',()=>{
  const years=fixture().reverse(),raw=goldCollected(),data=goldCalc.cleanGoldData(raw),spData=c.cleanSp500Data(collected()),today=new Date(2026,9,16);
  years[0].months.reverse();years[0].months[0].futures=0;
  const before=structuredClone({years,raw,data,spData}),sp=c.sp500Comparison(years,today,spData),gold=goldCalc.goldComparison(years,today,data);
  goldCalc.bestBenchmark(sp,gold);
  for(const year of years){goldCalc.goldYearReturn(year.year,data);goldCalc.goldYtdAt(year.year,9,data);goldCalc.ledgerChartData(year,today,spData,data);}
  assert.deepEqual({years,raw,data,spData},before);
});

test('지수 비교 둘 다는 세 칸에 내·S&P 500·금 연복리와 각 차이를 표시하고 더 높은 금 칸에 표시한다',()=>{
  const data={version:1,ledger:{savedAt:'',years:fixture()}},before=JSON.stringify(data),today=new Date(2026,9,16).getTime();
  assert.equal(goldCalc.bestBenchmark(c.sp500Comparison(data.ledger.years,new Date(today)),goldCalc.goldComparison(data.ledger.years,new Date(today))),'gold','fixture의 최고 지수가 바뀌면 화면 기대를 임의 변경하지 않는다');
  const html=ledgerHtml(data,today,{ledgerBench:'both'}),block=benchmarkHtml(html),cells=benchmarkCells(block);
  assert.equal(cells.length,3);assert.match(block,/data-ledger-bench="both" aria-pressed="true"/);assert.match(block,/data-ledger-bench="best" aria-pressed="false"/);
  includes(cells[0],'내 연복리');includes(cells[0],completedCompound.toFixed(2)+'%');
  includes(cells[1],'S&amp;P 500 연복리');includes(cells[1],spCompound.toFixed(2)+'%');includes(cells[1],'차이 +'+(completedCompound-spCompound).toFixed(2)+'%p');
  includes(cells[2],'금 연복리');includes(cells[2],goldCompound.toFixed(2)+'%');includes(cells[2],'차이 '+(completedCompound-goldCompound).toFixed(2)+'%p');
  assert.doesNotMatch(cells[0]+cells[1],/연복리 높음/);includes(cells[2],'연복리 높음');
  const current=benchmarkCells(block,'benchmark-ytd-cells');assert.equal(current.length,3);
  includes(current[0],'내 누적');includes(current[1],'S&amp;P 500 누적');includes(current[1],'12.75%');includes(current[1],'차이 '+((1.01**9-1)*100-12.75).toFixed(2)+'%p');
  includes(current[2],'금 누적');includes(current[2],'반영 전');
  assert.doesNotMatch(html,/LBMA/);assert.equal(JSON.stringify(data),before);
});

test('높은 쪽의 연복리 칸은 금을 유지하고 올해 누적 줄과 맨 위 카드는 마지막 달 말의 높은 지수를 따로 고른다',()=>{
  const data={version:1,ledger:{savedAt:'',years:fixture()}},before=JSON.stringify(data),at=new Date(2026,9,16).getTime(),page=ledgerPage(data,at);
  const raw=goldCollected(),gold=(raw.monthEnd.find(p=>p.ym==='2026-09').close/goldEnds[2025]-1)*100,sp=c.SP500_TR_YTD['2026-09'],mine=(1.01**9-1)*100;
  assert.ok(sp>gold,'가짜 9월 금 누적보다 S&P 500 누적이 높음');
  page.ctx.fakeGold=raw;vm.runInContext('goldData=cleanGoldData(fakeGold);renderLedger();',page.ctx);
  let block=benchmarkHtml(page.html),annual=benchmarkCells(block),current=benchmarkCells(block,'benchmark-ytd-cells');
  includes(annual[1],'금 연복리');includes(annual[1],goldCompound.toFixed(2)+'%');includes(annual[2],(completedCompound-goldCompound).toFixed(2)+'%p');
  includes(current[1],'S&amp;P 500 누적');includes(current[1],sp.toFixed(2)+'%');includes(current[2],(mine-sp).toFixed(2)+'%p');includes(block,'누적이 더 높은 S&amp;P 500 표시');
  includes(topCardHtml(page.html),`S&amp;P 500보다 <em class="down">${(sp-mine).toFixed(2)}%p 낮아요</em>`);
  const high=fullGoldMonths();high.monthEnd.at(-1).close=goldEnds[2025]*1.2;page.ctx.fakeGold=high;
  vm.runInContext('goldData=cleanGoldData(fakeGold);renderLedger();',page.ctx);
  const highPct=(high.monthEnd.at(-1).close/goldEnds[2025]-1)*100;
  block=benchmarkHtml(page.html);annual=benchmarkCells(block);current=benchmarkCells(block,'benchmark-ytd-cells');
  includes(annual[1],'금 연복리');includes(current[1],'금 누적');includes(current[1],highPct.toFixed(2)+'%');includes(current[2],(mine-highPct).toFixed(2)+'%p');includes(block,'누적이 더 높은 금 표시');
  const best=topCardHtml(page.html);assert.match(best,/<path[^>]*class="gold"/);assert.doesNotMatch(best,/class="sp"|class="sp-dot"/);includes(best,`금보다 <em class="down">${(highPct-mine).toFixed(2)}%p 낮아요</em>`);
  page.buttons.find(b=>b.dataset.ledgerBench==='both').onclick();
  const both=topCardHtml(page.html);assert.match(both,/<path[^>]*class="gold"/);assert.match(both,/class="sp-dot"/);
  assert.equal(both.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1],best.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1]);
  assert.doesNotMatch(benchmarkHtml(page.html),/누적이 더 높은/,'둘 다의 올해 누적 머리는 기존 안내를 유지');
  assert.equal(JSON.stringify(data),before,'조회와 모드 변경만으로 기록이 바뀌지 않는다');
});

test('지수 비교 표시 선택은 setUi로 이 기기에만 기억하고 모르는 설정은 높은 쪽으로 본다',()=>{
  const data={version:1,ledger:{savedAt:'',years:fixture()}},before=JSON.stringify(data),today=new Date(2026,9,16).getTime();
  const page=ledgerPage(data,today);
  page.buttons.find(b=>b.dataset.ledgerBench==='both').onclick();
  assert.equal(JSON.parse(page.storage.get('etf-planner-assets-ui')).ledgerBench,'both');
  assert.match(page.html,/data-ledger-bench="both" aria-pressed="true"/);
  const restored=ledgerHtml(data,today,{ledgerBench:JSON.parse(page.storage.get('etf-planner-assets-ui')).ledgerBench});
  assert.match(restored,/data-ledger-bench="both" aria-pressed="true"/);
  page.buttons.find(b=>b.dataset.ledgerBench==='best').onclick();
  assert.equal(JSON.parse(page.storage.get('etf-planner-assets-ui')).ledgerBench,'best');
  assert.equal(JSON.stringify(data),before,'기기 설정을 바꾸어도 doc.ledger에 필드가 생기거나 저장되지 않는다');
  assert.deepEqual([...page.storage.keys()],['etf-planner-assets-ui']);
  for(const value of [undefined,null,'unknown','gold','BEST',0,true]){
    const block=benchmarkHtml(ledgerHtml(data,today,{ledgerBench:value}));
    assert.match(block,/data-ledger-bench="best" aria-pressed="true"/);assert.match(block,/data-ledger-bench="both" aria-pressed="false"/);
    const cells=benchmarkCells(block);includes(cells[1],'금 연복리');includes(cells[2],'차이');
  }
});

test('높은 쪽 선택은 완료 연도 기준으로 S&P 500이 높으면 S&P 500을 표시하고 다른 지수 값도 안내한다',()=>{
  const years=[yearOf(2021,Array(12).fill(2))],today=new Date(2026,9,16),data={version:1,ledger:{savedAt:'',years}};
  assert.equal(goldCalc.bestBenchmark(c.sp500Comparison(years,today),goldCalc.goldComparison(years,today)),'sp500');
  const block=benchmarkHtml(ledgerHtml(data,today.getTime())),cells=benchmarkCells(block);
  includes(cells[1],'S&amp;P 500 연복리');includes(cells[1],SP[0].toFixed(2)+'%');
  includes(block,'연복리가 더 높은 S&amp;P 500 표시');includes(block,'금 '+((goldEnds[2021]/goldEnds[2020]-1)*100).toFixed(2)+'%');
});

test('금 월말은 페이지당 한 번 no-cache로 읽고 가짜 GLDM 자료가 오면 올해 값과 차이를 다시 그린다',async()=>{
  const data={version:1,ledger:{savedAt:'',years:fixture()}},before=JSON.stringify(data),today=new Date(2026,9,16).getTime(),requests=[];
  const raw=goldCollected();let deliver;
  const page=ledgerPage(data,today,{ledgerBench:'both'},(url,options)=>{
    requests.push({url,options});
    return url==='data/gold-etf.json'?new Promise(resolve=>{deliver=()=>resolve({ok:true,json:async()=>raw});}):Promise.resolve({ok:false});
  });
  page.ctx.redrawCount=0;vm.runInContext('const testGoldRedraw=redrawIdle;redrawIdle=()=>{globalThis.redrawCount++;testGoldRedraw();};loadGold();loadGold();renderLedger();',page.ctx);
  const request=requests.filter(r=>r.url==='data/gold-etf.json');assert.equal(request.length,1);assert.equal(request[0].options.cache,'no-cache');
  includes(benchmarkCells(benchmarkHtml(page.html),'benchmark-ytd-cells')[2],'반영 전');
  deliver();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page.ctx.redrawCount,1,'월별 손익 탭을 보면서 유효한 자료가 도착하면 다시 그린다');
  const cells=benchmarkCells(benchmarkHtml(page.html),'benchmark-ytd-cells'),expected=(raw.monthEnd.find(p=>p.ym==='2026-09').close/goldEnds[2025]-1)*100;
  includes(cells[2],'금 누적');includes(cells[2],expected.toFixed(2)+'%');includes(cells[2],'차이 '+((1.01**9-1)*100-expected).toFixed(2)+'%p');
  assert.equal(requests.filter(r=>r.url==='data/gold-etf.json').length,1,'다시 그려도 요청을 반복하지 않는다');
  assert.equal(JSON.stringify(data),before,'자료 조회만으로 투자 기록을 바꾸지 않는다');assert.doesNotMatch(page.html,/LBMA/);
});

test('다른 탭에서 도착한 금 자료는 다시 그리지 않고 금 자료 실패·잘못된 형식은 상수로 조용히 비교한다',async()=>{
  const data={version:1,ledger:{savedAt:'',years:fixture()}},before=JSON.stringify(data),today=new Date(2026,9,16).getTime();let deliver;
  const off=ledgerPage(data,today,null,url=>url==='data/gold-etf.json'?new Promise(resolve=>{deliver=()=>resolve({ok:true,json:async()=>goldCollected()});}):Promise.resolve({ok:false}));
  off.ctx.redrawCount=0;vm.runInContext('ui.tab="alloc";redrawIdle=()=>globalThis.redrawCount++;',off.ctx);
  deliver();await new Promise(resolve=>setImmediate(resolve));assert.equal(off.ctx.redrawCount,0,'월별 손익 탭일 때만 redrawIdle');
  for(const mode of ['reject','http','invalid']){
    const requests=[],page=ledgerPage(data,today,null,url=>{
      requests.push(url);if(url!=='data/gold-etf.json')return Promise.resolve({ok:false});
      return mode==='reject'?Promise.reject(Error('가상 네트워크 실패')):Promise.resolve({ok:mode!=='http',json:async()=>({...goldCollected(),symbol:'GLD'})});
    });
    await new Promise(resolve=>setImmediate(resolve));vm.runInContext('loadGold();renderLedger();',page.ctx);
    const cells=benchmarkCells(benchmarkHtml(page.html));includes(cells[1],goldCompound.toFixed(2)+'%');
    includes(benchmarkCells(benchmarkHtml(page.html),'benchmark-ytd-cells')[1],'S&amp;P 500 누적');
    assert.equal(requests.filter(url=>url==='data/gold-etf.json').length,1,'실패해도 페이지에서 반복 요청하지 않는다');
    assert.doesNotMatch(page.html,/가상 네트워크 실패|LBMA/);
  }
  assert.equal(JSON.stringify(data),before);
});

test('지수마다 제외·반영 전 연도가 다르면 각각 지수 이름을 붙여 안내한다',()=>{
  const years=fixture();years.at(-1).months[0].balances=[];
  const data={version:1,ledger:{savedAt:'',years}},before=JSON.stringify(data),page=ledgerPage(data,new Date(2027,0,5).getTime(),{ledgerBench:'both'});
  page.ctx.fakeGold=goldCollected();vm.runInContext('goldData=cleanGoldData(fakeGold);renderLedger();',page.ctx);
  const block=benchmarkHtml(page.html);
  assert.match(block,/S&amp;P 500: 2026년 값 반영 전/,'S&P 500은 연말 자료가 없는 상태');
  assert.match(block,/금: 2026년은 내 연 수익률이 없어 제외/,'금은 연말 자료가 있어도 내 기록 분모가 없어 제외한 상태');
  assert.equal(JSON.stringify(data),before);
});

test('수집 연도 범위가 다르면 공통 완료 연도로 내·두 지수·차이를 맞추고 올해 누적은 유지한다',()=>{
  const years=[...fixture(),yearOf(2027,[2,2,2])],today=new Date(2027,9,16),data={version:1,ledger:{savedAt:'',years}},before=JSON.stringify(data);
  const raw=goldCollected();raw.yearEnd.find(p=>p.year===2026).close=goldEnds[2025]*.01;
  raw.monthEnd.push({ym:'2027-03',date:'2027-03-31',close:goldEnds[2025]*.01*1.02});
  const rawGold=goldCalc.goldComparison(years,today,goldCalc.cleanGoldData(raw)),rawSp=c.sp500Comparison(years,today);
  assert.equal(rawGold.years,6);assert.equal(rawSp.years,5);
  assert.ok(rawGold.gold<rawSp.sp,'개별 전체 기간의 순위는 공통 기간 순위와 다를 수 있다');
  assert.equal(goldCalc.bestBenchmark(rawSp,rawGold),'gold','공통 2021~2025년의 순위');
  const page=ledgerPage(data,today.getTime(),{ledgerBench:'both'});page.ctx.fakeGold=raw;
  vm.runInContext('goldData=cleanGoldData(fakeGold);renderLedger();',page.ctx);
  const block=benchmarkHtml(page.html),cells=benchmarkCells(block);
  assert.equal(cells.length,3);
  includes(cells[0],completedCompound.toFixed(2)+'%');includes(cells[1],spCompound.toFixed(2)+'%');includes(cells[2],goldCompound.toFixed(2)+'%');
  includes(cells[1],'차이 +'+(completedCompound-spCompound).toFixed(2)+'%p');includes(cells[2],'차이 '+(completedCompound-goldCompound).toFixed(2)+'%p');
  includes(cells[2],'연복리 높음');assert.doesNotMatch(cells[1],/연복리 높음/,'표시 수치와 높은 지수 표시가 같은 기간을 따른다');
  assert.match(block,/2021~2025년 완료 5개 연도 · 같은 연도 연복리/);
  assert.match(block,/S&amp;P 500 자료: 2021~2025년 완료 5개 연도/);assert.match(block,/금 자료: 2021~2026년 완료 6개 연도/);
  assert.doesNotMatch(block,/내 연 수익률이 없어 제외/,'공통 기간 필터로 뺀 해를 개인 기록 누락으로 안내하지 않는다');
  const current=benchmarkCells(block,'benchmark-ytd-cells');
  includes(current[0],((1.02**3-1)*100).toFixed(2)+'%');includes(current[2],((1.02-1)*100).toFixed(2)+'%');
  page.buttons.find(b=>b.dataset.ledgerBench==='best').onclick();
  const best=benchmarkCells(benchmarkHtml(page.html));includes(best[1],'금 연복리');includes(best[1],goldCompound.toFixed(2)+'%');includes(best[2],(completedCompound-goldCompound).toFixed(2)+'%p');
  assert.equal(JSON.stringify(data),before);
});

test('두 지수에 연간 자료가 있어도 공통 연도가 없으면 연복리 칸을 비우고 올해 누적은 표시한다',()=>{
  const years=[yearOf(2027,[1]),yearOf(2029,[2]),yearOf(2030,[3,3])],data={version:1,ledger:{savedAt:'',years}},before=JSON.stringify(data),page=ledgerPage(data,new Date(2030,9,16).getTime(),{ledgerBench:'both'});
  // 2027년은 S&P 500만, 2029년은 금만 연간 비율을 계산할 수 있는 가상 자료다.
  page.ctx.fakeSp={schemaVersion:1,symbol:'^SP500TR',currency:'USD',yearEnd:[{year:2026,date:'2026-12-31',close:100},{year:2027,date:'2027-12-31',close:110}],monthEnd:[]};
  page.ctx.fakeGold={schemaVersion:1,symbol:'GLDM',currency:'USD',yearEnd:[{year:2028,date:'2028-12-31',close:100},{year:2029,date:'2029-12-31',close:120}],monthEnd:[{ym:'2030-02',date:'2030-02-28',close:126}]};
  vm.runInContext('sp500Data=cleanSp500Data(fakeSp);goldData=cleanGoldData(fakeGold);renderLedger();',page.ctx);
  const block=benchmarkHtml(page.html);
  assert.doesNotMatch(block,/class="benchmark-grid"/);includes(block,'비교할 완료 연도가 아직 없습니다');
  includes(block,'올해 2030년 1~2월 누적');
  const current=benchmarkCells(block,'benchmark-ytd-cells');assert.equal(current.length,3);
  includes(current[0],((1.03**2-1)*100).toFixed(2)+'%');includes(current[2],((126/120-1)*100).toFixed(2)+'%');
  assert.equal(JSON.stringify(data),before);
});

const topCardHtml=html=>html.slice(html.indexOf('<section class="card ledger-card">'),html.indexOf('</section>')+'</section>'.length);
const fullGoldMonths=()=>({...goldCollected(),monthEnd:Array.from({length:9},(_,i)=>({ym:`2026-${String(i+1).padStart(2,'0')}`,date:`2026-${String(i+1).padStart(2,'0')}-28`,close:goldEnds[2025]*(1+(i+1)/100)}))});

test('맨 위 높은 쪽은 선택한 완료 연도의 수익률로 2021년 S&P 500·2025년 금을 고르고 모르는 설정도 같은 기준이다',()=>{
  const years=fixture(),data={version:1,ledger:{savedAt:'',years}},before=JSON.stringify(data),at=new Date(2026,9,16).getTime();
  assert.equal(goldCalc.bestBenchmark(c.sp500Comparison(years,new Date(at)),goldCalc.goldComparison(years,new Date(at))),'gold','연복리 기준은 그대로 금');
  for(const setting of [undefined,'best','unknown'])for(const year of [2021,2025]){
    const html=ledgerHtml(data,at,{year,ledgerBench:setting}),card=topCardHtml(html),mine=c.yearSummary(years.find(y=>y.year===year)).rate;
    const gold=(goldEnds[year]/goldEnds[year-1]-1)*100,sp=c.SP500_TR_RETURNS[year],isGold=year===2025,key=isGold?'gold':'sp',label=isGold?'금':'S&amp;P 500',value=isGold?gold:sp,diff=mine-value;
    assert.ok(isGold?gold>sp:sp>gold,'해당 연도에 높은 지수');
    includes(card,`${label}보다 <em class="${diff>0?'up':'down'}">${Math.abs(diff).toFixed(2)}%p ${diff>0?'높아요':'낮아요'}</em>`);
    includes(card,`<i class="${key}"></i>${label}<b>${value.toFixed(2)}%</b>`);assert.doesNotMatch(card,new RegExp(`class="${isGold?'sp':'gold'}(?:-dot)?"`));
    includes(card,`내 누적 수익률과 ${label} 누적 수익률 그래프`);
    if(isGold)includes(card,'금은 금 ETF GLDM 종가 기준');
    assert.match(card,/그해.*수익률이 더 높은 지수 표시/);
    assert.equal((card.match(new RegExp(`class="${key}-dot"`,'g'))||[]).length,1,'연간 값은 12월 점 하나');assert.doesNotMatch(card,new RegExp(`<path[^>]*class="${key}"`));
    assert.equal((card.match(/<circle /g)||[]).length,2,'지수 연간 점과 내 누적 끝만 표시');
    includes(benchmarkHtml(html),'연복리가 더 높은 금 표시');assert.doesNotMatch(html,/LBMA/);
    const both=topCardHtml(ledgerHtml(data,at,{year,ledgerBench:'both'}));
    assert.equal((both.match(/class="sp-dot"/g)||[]).length,1);assert.equal((both.match(/class="gold-dot"/g)||[]).length,1);
    assert.equal((both.match(/<circle /g)||[]).length,3,'연간 값만 있는 둘 다는 지수 두 점과 내 누적 끝');
    assert.doesNotMatch(both,/<path[^>]*class="(?:sp|gold)"/,'월말 경로가 없는 두 지수는 점만 표시');
    assert.equal(both.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1],card.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1],'두 모드 모두 선택한 해의 높은 지수로 제목');
  }
  assert.equal(JSON.stringify(data),before);
});

test('맨 위 둘 다는 두 지수 선·범례를 표시하고 제목은 그 기간의 높은 S&P 500 기준이며 금액에는 지수가 없다',()=>{
  const data={version:1,ledger:{savedAt:'',years:fixture()}},raw=fullGoldMonths(),sp=collected(),at=new Date(2026,9,16).getTime();
  // S&P 500도 1월부터 있어야 점선 경로를 그리는 기존 규칙을 확인할 수 있다.
  sp.monthEnd=raw.monthEnd.map((p,i)=>({...p,close:100*(1+(i+1)/200)}));sp.yearEnd=[{year:2025,date:'2025-12-31',close:100}];
  const snapshot=JSON.stringify({data,raw,sp}),page=ledgerPage(data,at);
  page.ctx.fakeGold=raw;page.ctx.fakeSp=sp;vm.runInContext('goldData=cleanGoldData(fakeGold);sp500Data=cleanSp500Data(fakeSp);renderLedger();',page.ctx);
  const best=topCardHtml(page.html),gold=(raw.monthEnd.at(-1).close/goldEnds[2025]-1)*100,rate=(1.01**9-1)*100,spRate=c.SP500_TR_YTD['2026-09'];
  assert.ok(spRate>gold);assert.match(best,/<path[^>]*class="sp"/);assert.match(best,/class="sp-dot"/);assert.doesNotMatch(best,/class="gold"|class="gold-dot"/);
  includes(best,`S&amp;P 500보다 <em class="down">${(spRate-rate).toFixed(2)}%p 낮아요</em>`);includes(best,`<i class="sp"></i>S&amp;P 500<b>${spRate.toFixed(2)}%</b>`);
  assert.match(best,/올해.*9월 말까지.*수익률이 더 높은 지수 표시/);
  page.buttons.find(b=>b.dataset.ledgerBench==='both').onclick();
  const both=topCardHtml(page.html);
  assert.match(both,/<path[^>]*class="sp"/);assert.match(both,/<path[^>]*class="gold"/);
  assert.match(both,/<i class="sp"><\/i>S&amp;P 500/);assert.match(both,/<i class="gold"><\/i>금/);
  assert.equal(both.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1],best.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1],'모드 전환으로 제목의 비교 지수는 바뀌지 않는다');
  assert.match(both,/내 누적 수익률과.*S&amp;P 500.*금.*누적 수익률 그래프/);includes(both,'금은 금 ETF GLDM 종가 기준');
  assert.equal((both.match(/<circle /g)||[]).length,3,'월별 경로 둘과 내 누적 끝 세 점');
  vm.runInContext('setUi({ledgerChart:"won"});renderLedger();',page.ctx);
  const won=topCardHtml(page.html);assert.doesNotMatch(won,/class="(?:sp|gold)(?:-dot)?"|S&amp;P 500|GLDM|금 누적/);assert.equal((won.match(/<circle /g)||[]).length,1,'금액 그래프는 내 누적 끝만 표시');
  assert.match(won,/aria-label="월 손익 누적 그래프"/);assert.doesNotMatch(page.html,/LBMA/);
  assert.equal(JSON.stringify({data,raw,sp}),snapshot,'모드 변경·조회로 기록과 시세 자료를 바꾸지 않는다');
});

test('금의 해당 월말이 없으면 S&P 500을 고르고 앞달 금 값으로 대체하지 않으며 두 값 모두 없을 때만 연복리 기준을 쓴다',()=>{
  const data={version:1,ledger:{savedAt:'',years:fixture()}},before=JSON.stringify(data),at=new Date(2026,9,16).getTime(),page=ledgerPage(data,at),spRate=c.SP500_TR_YTD['2026-09'],mine=(1.01**9-1)*100;
  const title=`S&amp;P 500보다 <em class="down">${(spRate-mine).toFixed(2)}%p 낮아요</em>`;
  let card=topCardHtml(page.html);
  includes(card,'<i class="sp"></i>S&amp;P 500<b>'+spRate.toFixed(2)+'%</b>');includes(card,title);assert.doesNotMatch(card,/class="gold"|class="gold-dot"/);
  const sparse=goldCollected();sparse.monthEnd=sparse.monthEnd.filter(p=>p.ym!=='2026-09');page.ctx.fakeGold=sparse;
  vm.runInContext('goldData=cleanGoldData(fakeGold);renderLedger();',page.ctx);card=topCardHtml(page.html);
  includes(card,title);assert.doesNotMatch(card,/class="gold-dot"|금보다/,'앞달 금 관측값이 있어도 그달 비교 대상은 S&P 500');
  page.buttons.find(b=>b.dataset.ledgerBench==='both').onclick();card=topCardHtml(page.html);
  includes(card,'<i class="sp"></i>S&amp;P 500<b>'+spRate.toFixed(2)+'%</b>');includes(card,'<i class="gold"></i>금<b>반영 전</b>');includes(card,title);
  assert.equal((card.match(/class="gold-dot"/g)||[]).length,1,'둘 다는 앞달 금 관측점도 남기고 범례는 반영 전');
  const noValues=ledgerHtml({...data,ledger:{...data.ledger,years:fixture().map(y=>y.year===2026?yearOf(2026,Array(10).fill(1)):y)}},new Date(2026,10,3).getTime());
  const fallback=topCardHtml(noValues);includes(fallback,'<i class="gold"></i>금<b>반영 전</b>');includes(fallback,`내 누적 <em class="up">${((1.01**10-1)*100).toFixed(2)}%</em>`);assert.doesNotMatch(fallback,/보다/);
  assert.equal(JSON.stringify(data),before);
});

test('완료 연도 비교에서 S&P 500이 높은 경우 맨 위 높은 쪽도 S&P 500 하나만 표시한다',()=>{
  const years=[yearOf(2021,Array(12).fill(2))],data={version:1,ledger:{savedAt:'',years}},before=JSON.stringify(data),at=new Date(2026,9,16).getTime();
  assert.equal(goldCalc.bestBenchmark(c.sp500Comparison(years,new Date(at)),goldCalc.goldComparison(years,new Date(at))),'sp500');
  const html=ledgerHtml(data,at),card=topCardHtml(html),rate=(1.02**12-1)*100;
  includes(card,`S&amp;P 500보다 <em class="down">${(SP[0]-rate).toFixed(2)}%p 낮아요</em>`);includes(card,`<i class="sp"></i>S&amp;P 500<b>${SP[0].toFixed(2)}%</b>`);
  assert.match(card,/class="sp-dot"/);assert.doesNotMatch(card,/class="gold"|class="gold-dot"|GLDM/);includes(benchmarkHtml(html),'연복리가 더 높은 S&amp;P 500 표시');
  assert.equal(JSON.stringify(data),before);
});

test('그래프 세로축은 표시하는 지수만 포함하고 두 지수·연간 점도 범위 안에 그리며 금액은 지수 범위를 쓰지 않는다',()=>{
  const page=ledgerPage({version:1,ledger:{savedAt:'',years:fixture()}},new Date(2026,9,16).getTime()),chart={rate:[{m:1,v:2}],won:[{m:1,v:20000}],from:0,sp:[{m:1,v:1000}],gold:[{m:12,v:-30}]};
  const indices=[{key:'sp',name:'S&amp;P 500',points:chart.sp,at:1000,diff:-998},{key:'gold',name:'금',points:chart.gold,at:-30,diff:32}],before=JSON.stringify({chart,indices});
  page.ctx.testChart=chart;page.ctx.testIndices=indices;
  const draw=(won,selection)=>vm.runInContext(`ledgerChartHtml(testChart,${won},330,${selection})`,page.ctx);
  const onlyGold=draw(false,'[testIndices[1]]'),both=draw(false,'testIndices'),won=draw(true,'testIndices');
  const axes=html=>[...html.matchAll(/class="axis"[^>]*>([-\d.,]+)%<\/span>/g)].map(m=>Number(m[1].replaceAll(',','')));
  assert.ok(axes(onlyGold).some(v=>v<0),'금 음수 관측점을 세로축에 포함');assert.ok(axes(onlyGold).every(v=>v<100),'숨긴 S&P 500의 큰 수익률은 범위에서 제외');
  assert.ok(axes(both).some(v=>v>100),'둘 다는 큰 S&P 500 관측값도 포함');
  for(const html of [onlyGold,both])for(const m of html.matchAll(/<circle[^>]*cy="([\d.-]+)"/g))assert.ok(Number(m[1])>=0&&Number(m[1])<=104,'지수·내 누적 점이 차트 높이 안에 있음');
  assert.doesNotMatch(won,/class="(?:sp|gold)(?:-dot)?"/);assert.match(won,/월 손익 누적 그래프/);
  assert.equal(JSON.stringify({chart,indices}),before,'그리기만 해서는 입력 배열·좌표 자료를 바꾸지 않는다');
});
