// 가상 월별 손익 기록으로 S&P 500 연평균·올해 누적 비교만 검증한다. 실제 자산·손익 기록은 사용하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const c=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js','js/ledger-benchmark.js'].map(read).join('\n;\n')}
return {SP500_TR_RETURNS,SP500_TR_YTD,SP500_COMPARE_FROM,cleanSp500Data,sp500YtdAt,sp500YearReturn,sp500Comparison,ledgerChartData,yearSummary,averageYearReturn};})()`);
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

test('월말 누적 수익률은 연-월 키의 같은 지수 값이며 S&P DJI 대시보드의 월간 수익률과 이어진다',()=>{
  for(const [k,v] of Object.entries(c.SP500_TR_YTD)){assert.match(k,/^\d{4}-(0[1-9]|1[0-2])$/);assert.ok(Number.isFinite(v)&&Math.abs(v)<100,`${k} 값`);}
  assert.ok(Object.isFrozen(c.SP500_TR_YTD));
  assert.deepEqual([c.SP500_TR_YTD['2026-08'],c.SP500_TR_YTD['2026-09']],[13.14,12.75]);
  near(Math.round(((1+13.14/100)*(1-0.35/100)-1)*1e4)/1e2,12.74,'8월 말 누적 × 9월 1개월(−0.35%) ≈ 9월 말 누적(12.75%, 반올림 차 0.01)');
  assert.equal(c.sp500YtdAt(2026,9),12.75);assert.equal(c.sp500YtdAt(2026,10),null);
  assert.equal(c.sp500YearReturn(2025),17.88);assert.equal(c.sp500YearReturn(2026),null,'12월 말 값이 없으면 연간 수익률도 없다');
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
  assert.deepEqual({...r.current,rate:null,diff:null},{year:2026,rate:null,months:9,month:9,sp:12.75,diff:null});near(r.current.rate,9,'올해 누적');near(r.current.diff,9-12.75,'올해 차이는 같은 9월 말까지');
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
  near(r.mine,(24+23+12)/3,'내 평균');
  near(c.sp500Comparison(fixture().map(y=>y.year===2026?yearOf(2026,Array(8).fill(1)):y),new Date(2026,9,16)).current.sp,13.14,'8월까지 기록했으면 8월 말 S&P 500과 비교');near(r.sp,(28.71+26.29+17.88)/3,'같은 연도의 S&P 500 평균');
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
  assert.deepEqual([october.month,Math.round(october.sp*1e9)/1e9,Math.round(october.diff*1e9)/1e9],[10,14,-4]);
  const next=c.sp500Comparison(fixture(),new Date(2027,0,5),data);
  assert.deepEqual([next.from,next.to,next.years,next.pending],[2021,2026,6,[]],'해가 바뀌면 수집한 2026년 연말 종가로 2026년까지 비교');near(next.rows.at(-1).sp,15,'2026년 S&P 500');
  assert.equal(c.sp500Comparison(fixture(),new Date(2027,0,5)).pending.length,1,'수집 자료가 없으면 2026년은 반영 전');
  for(const bad of [null,[],{...collected(),schemaVersion:2},{...collected(),symbol:'^GSPC'},{...collected(),currency:'KRW'}])assert.equal(c.cleanSp500Data(bad),null);
  const odd=collected();odd.yearEnd.push({year:2024,date:'2024-11-29',close:1},{year:'2023',date:'2023-12-29',close:1},{year:2022,date:'2022-12-30',close:-1});
  odd.monthEnd.push({ym:'2026-13',date:'2026-13-01',close:1},{ym:'2026-08',date:'2026-07-31',close:1},{ym:'2026-07',date:'2026-07-31',close:'1'},{ym:'__proto__',date:'x',close:1});
  const cleaned=c.cleanSp500Data(odd);assert.deepEqual(Object.keys(cleaned.yearEnd),['2025','2026']);assert.deepEqual(Object.keys(cleaned.monthEnd),['2026-09','2026-10']);
});

// 연도별 요약 화면: 자산 현황 스크립트(assets.js·assets-ledger.js 등)를 가상 DOM으로 불러 월별 손익 탭만 그린다.
function ledgerHtml(data,now,ui=null){
  class SystemDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const nodes=new Map(),storage=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},hidden:false,innerHTML:'',textContent:'',classList:{toggle(){}},querySelector:sel=>node(`${id}:${sel}`),setAttribute(){},getAttribute(){}});return nodes.get(id);};
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:node,querySelectorAll:()=>[],addEventListener(){}};
  const store={doc:data,prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe(){},start(){},saveSection(){throw Error('조회만으로 저장하면 안 된다');}};
  const ctx=vm.createContext({Date:SystemDate,document,assetStore:store,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},addEventListener(){},setInterval(){},setTimeout:fn=>{fn();return 1;},
    location:{hash:'#ledger'},history:{replaceState(){}},scrollTo(){}});
  if(ui)storage.set('etf-planner-assets-ui',JSON.stringify({tab:'ledger',...ui}));
  vm.runInContext(['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/ledger-benchmark.js','js/assets.js','js/assets-ledger.js','js/assets-savings.js','js/assets-installments.js','js/assets-start.js'].map(read).join('\n;\n'),ctx);
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
  assert.match(block,/올해 2026년 1~9월 누적<small>S&amp;P 500은 9월 말 기준 · 연간 확정 후 평균에 포함<\/small>/);
  assert.match(block,/<span><small>내 누적<\/small><b class="">9.00%<\/b><\/span><span><small>S&amp;P 500 누적<\/small><b class="">12.75%<\/b><\/span><span><small>차이<\/small><b class="neg">-3.75%p<\/b><\/span>/);
  assert.match(block,/Total Return 지수\(배당 재투자\) 달러 수익률.*원·달러 환율 변동.*원화 실현손익 기준이라 평가손익/);
  assert.equal(JSON.stringify(data),before);
  const pending=ledgerHtml({version:1,ledger:{savedAt:'',years:fixture()}},new Date(2027,0,5).getTime());
  assert.match(pending,/2021~2025년 완료 5개 연도 · 연 수익률 산술평균 · 2026년 S&amp;P 500 값 반영 전/);
  assert.doesNotMatch(pending,/올해 2027년/);
  const october=ledgerHtml({version:1,ledger:{savedAt:'',years:fixture().map(y=>y.year===2026?yearOf(2026,Array(10).fill(1)):y)}},new Date(2026,10,3).getTime());
  assert.match(october,/올해 2026년 1~10월 누적<small>S&amp;P 500 10월 말 값 반영 전/);assert.match(october,/<small>S&amp;P 500 누적<\/small><b class="">—<\/b>/);
  const empty=ledgerHtml({version:1,ledger:{savedAt:'',years:[yearOf(2026,[1])]}},new Date(2026,9,16).getTime());
  assert.match(empty,/비교할 완료 연도가 아직 없습니다/);assert.doesNotMatch(empty,/benchmark-grid/);assert.match(empty,/올해 2026년 1월 누적/);
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

test('맨 위 누적 그래프 자료: 월 수익률 누적과 선물·옵션을 나눠 두고, 더하면 연 수익률이며 S&P 500은 연도별 요약과 같은 기준이다',()=>{
  const years=fixture(),before=JSON.stringify(years),today=new Date(2026,9,16);
  const now=c.ledgerChartData(yearOf(2026,Array(9).fill(1),{futures:-20000}),today);
  assert.deepEqual(now.rate.map(p=>p.m),[1,2,3,4,5,6,7,8,9]);near(now.rate.at(-1).v,9,'월 수익률 1% × 9');
  near(now.futuresRate,-2,'선물·옵션 −20,000원 ÷ 마지막 총자산 1,000,000원');near(now.rate.at(-1).v+now.futuresRate,now.total,'더하면 연 수익률');near(now.total,7,'yearSummary.rate');
  assert.deepEqual(now.won.map(p=>p.v),[1,2,3,4,5,6,7,8,9].map(n=>n*10000));assert.equal(now.pnl,70000,'월 손익 합 + 선물·옵션');
  assert.deepEqual([now.from,now.month,now.unrated],[0,9,[]]);
  assert.deepEqual(now.sp,[{m:8,v:13.14},{m:9,v:12.75}],'수집 자료가 없으면 공표치가 있는 달만');near(now.diff,7-12.75,'올해는 기록한 마지막 달 말 누적과 비교');
  const sp=c.ledgerChartData(yearOf(2026,Array(10).fill(1)),new Date(2026,10,3),c.cleanSp500Data(collected())).sp;
  assert.deepEqual(sp.map(p=>p.m),[8,9,10]);assert.equal(sp[1].v,12.75,'공표치 우선');near(sp[2].v,14,'10월은 수집 종가');
  const past=c.ledgerChartData(years[4],today);
  assert.deepEqual(past.sp,[{m:12,v:17.88}],'월말 값이 없는 지난해는 12월 연간 값만');near(past.diff,12-17.88,'지난해는 연간 수익률과 비교');
  const future=c.ledgerChartData(yearOf(2027,[1]),today);assert.deepEqual([future.sp,future.spAt,future.diff],[[],null,null],'아직 오지 않은 해');
  const empty=c.ledgerChartData({year:2026,accounts:[],months:[]},today);assert.deepEqual([empty.month,empty.won,empty.rate,empty.sp,empty.futuresRate],[null,[],[],[],null]);
  const gap=yearOf(2026,Array(9).fill(1));gap.months[3].balances=[];
  const g=c.ledgerChartData(gap,today);assert.deepEqual([g.rate,g.unrated,g.won.length,c.yearSummary(gap).rate],[null,[4],9,null],'총자산이 빈 달이 있으면 수익률 누적을 그리지 않고 금액은 그린다');
  const late=yearOf(2026,[1,1,1]);late.months.forEach((m,i)=>{m.m=i+3;});assert.equal(c.ledgerChartData(late,today).from,2,'3월부터 기록했으면 0점은 2월');
  assert.equal(JSON.stringify(years),before,'조회만으로 기록을 바꾸지 않는다');
});

test('월별 손익 맨 위 카드: 고른 연도의 누적 수익률을 S&P 500과 비교하고 월 손익 합 + 선물·옵션 = 누적, 금액 보기는 이 기기 화면 설정',()=>{
  const years=fixture().map(y=>y.year===2026?yearOf(2026,Array(9).fill(1),{futures:-20000}):y),data={version:1,ledger:{savedAt:'',years}},before=JSON.stringify(data),at=new Date(2026,9,16).getTime();
  const html=ledgerHtml(data,at);
  assert.match(html,/<h1 class="sr-only">월별 손익<\/h1>/);assert.doesNotMatch(html,/class="card metrics"/,'세 칸 지표 카드 대신 맨 위 카드');
  assert.match(html,/data-pick-year="2026" aria-pressed="true">2026<\/button><button class="chip add" id="addYear"/,'연도 칩 끝에 연도 추가');
  assert.match(html,/2026년 1~9월 누적 수익률/);assert.match(html,/S&amp;P 500보다 <em class="down">5.75%p 낮아요<\/em>/);
  assert.match(html,/내 누적<b>7.00%<\/b><\/span><span class="ledger-key"><i class="sp"><\/i>S&amp;P 500<b>12.75%<\/b>/);
  assert.match(html,/월 손익 합 <b class="">9.00%<\/b><\/span><span><i>\+<\/i> 선물·옵션 <b class="neg">-2.00%p<\/b><\/span><span><i>=<\/i> 누적 <b class="">7.00%<\/b>/);
  assert.equal((html.match(/class="month(?: on)?" style="left:/g)||[]).length,12,'월 글자 12개');assert.match(html,/class="month on" style="left:[\d.]+%">9</,'마지막 기록 달 강조');
  assert.match(html,/<span>실현손익<\/span><b class="">7만원<\/b>.*<span>선물·옵션<\/span><b class="neg">−2만원<\/b>.*<span>총자산 9월 말<\/span><b class="">100만원<\/b>/s);
  assert.match(html,/<small>연환산 12%<\/small><small>선물·옵션 제외<\/small>/,'연환산은 합계 줄로');
  const won=ledgerHtml(data,at,{ledgerChart:'won'});
  assert.match(won,/2026년 1~9월 누적 실현손익/);assert.match(won,/실현손익 <em class="up">70,000원<\/em>/);assert.doesNotMatch(won,/class="ledger-key"><i class="sp">/,'금액 보기에는 S&P 500 없음');
  assert.match(won,/월 손익 합 <b class="">9만원<\/b><\/span><span><i>\+<\/i> 선물·옵션 <b class="neg">−2만원<\/b><\/span><span><i>=<\/i> <b class="">7만원<\/b>/);
  const past=ledgerHtml(data,at,{year:2025});
  assert.match(past,/2025년 1~12월 누적 수익률/);assert.match(past,/S&amp;P 500보다 <em class="down">5.88%p 낮아요<\/em>/);assert.match(past,/연간 값만 점으로 표시/);
  const gap=JSON.parse(before);gap.ledger.years[5].months[3].balances=[];
  assert.match(ledgerHtml(gap,at),/<h2 class="warn">4월 총자산이 없어 수익률을 계산하지 못했습니다<\/h2>/);
  const blank=JSON.parse(before);blank.ledger.years.push({year:2027,accounts:[],months:[]});
  assert.match(ledgerHtml(blank,at,{year:2027}),/아직 기록한 달이 없습니다/);
  assert.equal(JSON.stringify(data),before,'기록은 바꾸지 않음');
});

test('월별 선물·옵션: 그래프는 그 달에 더하고 달을 모르는 연 합계만 마지막 달에 더하며, 표와 계산 줄은 실현손익과 나눠 보여 준다',()=>{
  const today=new Date(2026,9,16), year=yearOf(2026,Array(9).fill(1),{futures:-10000});
  year.months[1].futures=-30000;year.months[4].futures=20000;// 2월 −3%, 5월 +2% (총자산 1,000,000원)
  const before=JSON.stringify(year), g=c.ledgerChartData(year,today);
  near(g.rate[1].v,2-3,'2월 누적 = 1% + 1% − 3%');near(g.rate.at(-1).v,9-3+2,'9월 누적에 월별 선물·옵션 포함');
  assert.deepEqual([g.rest,g.won[1].v,g.won.at(-1).v],[-10000,-10000,80000]);near(g.restRate,-1,'연 합계 −10,000원 ÷ 마지막 총자산');
  near(g.monthRate,9,'실현손익만');near(g.futuresRate,-3+2-1,'월별 + 연 합계');near(g.monthRate+g.futuresRate,g.total,'나눠도 합은 연 수익률');
  near(g.rate.at(-1).v+g.restRate,g.total,'그래프 끝 + 연 합계 = 연 수익률');assert.equal(g.monthPnl+g.futures,g.pnl);
  const tenth={...yearOf(2026,Array(9).fill(1)),months:[...yearOf(2026,Array(9).fill(1)).months,{m:10,futures:5000,balances:[1000000]}]};
  assert.equal(c.ledgerChartData(tenth,new Date(2026,10,3)).month,10,'선물·옵션만 넣은 달도 기록 달');assert.equal(c.sp500Comparison([tenth],new Date(2026,10,3)).current.month,10,'S&P 500 비교 달도 같다');
  const html=ledgerHtml({version:1,ledger:{savedAt:'',years:[year]}},today.getTime());
  assert.match(html,/월 손익 합 <b class="">9.00%<\/b><\/span><span><i>\+<\/i> 선물·옵션 <b class="neg">-2.00%p<\/b><\/span><span><i>=<\/i> 누적 <b class="">7.00%<\/b>/);
  const row=n=>html.slice(html.indexOf(`data-month="${n}"`),html.indexOf(`data-month="${n+1}"`));
  for(const n of [2,5])assert.doesNotMatch(row(n),/선물·옵션/,`${n}월: 넣은 값은 줄에 표시하지 않음`);
  for(const n of [1,3,9])assert.match(row(n),/<small class="same-tag">선물·옵션 미입력<\/small>/,`${n}월: 월별로 넣는 해의 빈 달`);
  assert.doesNotMatch(row(10),/미입력/,'기록 없는 달은 표시하지 않음');
  assert.doesNotMatch(ledgerHtml({version:1,ledger:{savedAt:'',years:[yearOf(2026,Array(9).fill(1),{futures:-10000})]}},today.getTime()),/선물·옵션 미입력/,'연 합계만 쓰는 해는 표시하지 않음');
  assert.match(html,/<span>선물·<wbr>옵션<small>수정<\/small><\/span><span class="neg">-20,000원<small>월별 2개월 \+ 연 합계 -10,000원<\/small><\/span><span>-2%<\/span>/);
  assert.match(html,/선물·옵션 연 합계는 마지막 기록 달에 더함/);
  assert.equal(JSON.stringify(year),before,'기록은 바꾸지 않음');
});

test('월별 손익: 손익 칸에만 +/− 부호 버튼을 붙이고, 버튼은 포커스를 유지한 채 부호만 바꾸며 읽기 전용 칸은 건드리지 않는다',()=>{
  // 숫자 키패드(inputmode=decimal)에 '-' 키가 없는 삼성 키보드·iPhone용. 금액은 가짜 값.
  const nodes=new Map(),listeners={},storage=new Map(),field=()=>({value:'',readOnly:false,setCustomValidity(){}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},hidden:false,innerHTML:'',textContent:'',open:false,classList:{toggle(){}},querySelector:sel=>node(`${id}:${sel}`),setAttribute(){},getAttribute(){},showModal(){this.open=true;}});return nodes.get(id);};
  Object.assign(node('monthForm'),{pnl:field(),futures:field(),dividendFx:field()});
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:node,querySelectorAll:()=>[],addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const store={doc:{version:1,ledger:{savedAt:'',years:[]}},prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe(){},start(){},saveSection(){throw Error('창을 열기만 해서 저장하면 안 된다');}};
  const ctx=vm.createContext({Date,Event,document,assetStore:store,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},addEventListener(){},setInterval(){},setTimeout:fn=>{fn();return 1;},
    location:{hash:'#ledger'},history:{replaceState(){}},scrollTo(){}});
  vm.runInContext(['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/ledger-benchmark.js','js/assets.js','js/assets-ledger.js','js/assets-savings.js','js/assets-installments.js','js/assets-start.js'].map(read).join('\n;\n'),ctx);
  ctx.year={year:2026,accounts:[{name:'A'}],months:[{m:3,pnl:-5000,futures:-12000,balances:[1000000]}]};
  vm.runInContext('openMonth(year,3)',ctx);
  const html=node('monthFields').innerHTML,toggle=attr=>new RegExp(`<span class="sign-input"><input ${attr}[^>]*data-money><button class="sign-toggle" type="button" tabindex="-1" data-sign-toggle`);
  assert.match(html,toggle('name="pnl" value="-5,000"'));
  assert.match(html,toggle('name="futures" value="-12,000"'));
  for(const i of [0,1,3])assert.match(html,toggle(`data-pnl-fixed="${i}"`),`손익 항목 ${i}`);
  for(const i of [2,4])assert.match(html,new RegExp(`<input data-pnl-fixed="${i}"[^>]*></label>`),`배당 ${i}는 버튼 없음`);
  assert.match(html,/<input name="bal0" [^>]*><\/label>/,'잔액은 버튼 없음');
  assert.match(read('assets.html'),/<span class="sign-input"><input name="futures" type="text" inputmode="decimal"[^>]*\/><button class="sign-toggle" type="button" tabindex="-1" data-sign-toggle/,'연도 설정 선물·옵션');
  const input={value:'1,234',readOnly:false,disabled:false,events:[],focus(){this.focused=true;},setSelectionRange(a,b){this.selection=[a,b];},dispatchEvent(e){this.events.push(`${e.type}:${e.bubbles}`);}};
  const button={closest:sel=>sel==='[data-sign-toggle]'?button:null,previousElementSibling:input};
  let prevented=false;listeners.mousedown({target:button,preventDefault(){prevented=true;}});assert.ok(prevented,'키보드가 닫히지 않게 포커스 이동을 막는다');
  const tap=()=>listeners.click({target:button});
  tap();assert.equal(input.value,'-1,234');assert.ok(input.focused);assert.deepEqual(input.selection,[6,6]);assert.deepEqual(input.events,['input:true']);
  tap();assert.equal(input.value,'1,234');
  input.value='';tap();assert.equal(input.value,'-','빈 칸은 부호부터');
  input.value='+500';tap();assert.equal(input.value,'-500');
  input.readOnly=true;tap();assert.equal(input.value,'-500','자동 합계(읽기 전용)는 그대로');
  input.readOnly=false;input.disabled=true;tap();assert.equal(input.value,'-500');
  listeners.click({target:{closest:()=>null}});assert.equal(input.events.length,4,'다른 곳 클릭은 무시');
});
