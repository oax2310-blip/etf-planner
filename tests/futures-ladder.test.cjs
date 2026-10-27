// 달러선물 상단 환율 사다리 계산(js/futures.js futureLadder*). 모두 가상 계약·계획·손절 기준이다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=['ma-ladder.js','prices.js','rebuy.js','futures.js','futures-plan.js','futures-rebuy.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const plain=v=>JSON.parse(JSON.stringify(v));
const load=()=>{const ctx=vm.createContext({contractSize:10000,esc:v=>String(v),PENCIL:'',shown:v=>String(v),won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0})});vm.runInContext(code,ctx);return ctx;};
const open=price=>({price,priceOverride:price,completed:false,executionPrice:null});
// 25일선 회차 1,410·1,420원(이상 체결), 직접 입력 회차 1,380원(이하 체결), 체결한 1,405원 회차는 계산에서 뺀다.
const futures=(extra={})=>({targetPrice:1480,baselinePnl:-200000,positions:[{month:'202612',contracts:2,settlementPrice:1400}],
  levels:[{days:25,unit:'일선',price:1410,confirmed:true,contracts:3,tranches:[open(1410),open(1420),{price:1405,completed:true,executionPrice:1405,mergedMonth:'202612'}]},
    {days:0,unit:'',label:'가상 추가 매수',price:1380,confirmed:true,contracts:1,tranches:[{price:1380,completed:false,executionPrice:null}]}],...extra});

test('분할매수 반영 손익은 그 환율까지 도달하는 회차만 각 회차 가격에 1계약씩 산다',()=>{
  const ctx=load(),f=futures(),cur=p=>ctx.futuresSummary(f,p).current;
  assert.deepEqual({...ctx.futureLadderBuyPnl(f,1415)},{pnl:cur(1415)+(1415-1410)*10000,count:1},'1,420원 회차는 아직 닿지 않는다');
  assert.deepEqual({...ctx.futureLadderBuyPnl(f,1430)},{pnl:cur(1430)+((1430-1410)+(1430-1420))*10000,count:2},'일괄 매수가 아니라 회차 가격마다 계산');
  assert.deepEqual({...ctx.futureLadderBuyPnl(f,1370)},{pnl:cur(1370)+(1370-1380)*10000,count:1},'직접 입력 회차는 내려올 때 체결');
  assert.equal(ctx.futureLadderBuyPnl(f,1400).count,0);
  const plan=futures({buyPlan:{startLine:'25일선',endLine:'60일선',endPrice:1450,contracts:4,units:['일선']}});
  assert.equal(ctx.futureLadderBuyPnl(plan,1370).count,0,'이동평균 종료 계획은 모든 회차가 올라올 때 체결');
  assert.equal(ctx.futureLadderBuyPnl(plan,1390).count,1);
});

test('손절 반영 손익은 내려가며 도달하는 남은 손절 회차를 회차 환율에 청산한다',()=>{
  const ctx=load(),f=futures({positions:[{month:'202612',contracts:4,settlementPrice:1400}],rebuy:{lowPrice:1390,floorPrice:1370,steps:2}}),cur=p=>ctx.futuresSummary(f,p).current;
  assert.deepEqual(plain(ctx.futureLadderCuts(f)),[{price:1390,qty:1},{price:1370,qty:1}],'4계약의 50% = 2계약을 1,390~1,370원 2회로');
  assert.deepEqual({...ctx.futureLadderCutPnl(f,1380)},{pnl:cur(1380)+(1390-1380)*10000,count:1});
  assert.deepEqual({...ctx.futureLadderCutPnl(f,1360)},{pnl:cur(1360)+((1390-1360)+(1370-1360))*10000,count:2});
  assert.equal(ctx.futureLadderCutPnl(f,1395).count,0);
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);assert.equal(f.positions[0].contracts,3);
  assert.deepEqual({...ctx.futureLadderCutPnl(f,1360)},{pnl:ctx.futuresSummary(f,1360).current+(1370-1360)*10000,count:1},'체결한 손절 회차는 이미 보유·누적 정산손익에 있다');
  assert.equal(ctx.futureLadderCutPnl(futures(),1300).count,0,'신저점 손절 기준이 없으면 반영하지 않는다');
});

test('손익분기는 손익이 0원 이상이 되는 가장 낮은 환율을 0.1원 단위로 올린다',()=>{
  const ctx=load(),be=f=>ctx.futureLadderBreakeven(p=>ctx.futuresSummary(f,p).current,4000);
  assert.equal(be(futures()),1410,'2계약 평균 1,400원 + 누적 정산 -20만 원');
  assert.equal(be(futures({baselinePnl:-201000})),1410.1,'1,410.05원은 1,410.1원으로 올린다');
  assert.equal(be(futures({baselinePnl:300000})),1385,'누적 정산 이익이면 평균보다 낮다');
  assert.equal(be(futures({baselinePnl:30000000})),null,'0.1원에서도 이익이면 없음');
  assert.equal(ctx.futureLadderBreakeven(()=>-1,4000),null,'끝까지 손실이면 없음');
  const f=futures({baselinePnl:-300000}),p=ctx.futureLadder(f,1405).beBuy,buy=x=>ctx.futureLadderBuyPnl(f,x).pnl;
  assert.ok(buy(p)>=0&&buy(Math.round(p*10-1)/10)<0,'분할매수 손익분기도 같은 규칙');
  assert.ok(p<ctx.futureLadder(f,1405).beHeld,'회차를 사면 보유만일 때보다 손익분기가 낮다');
});

test('사다리 행은 환율 높은 순이고, 지금보다 위는 분할매수·아래는 손절을 붙이며 기록을 바꾸지 않는다',()=>{
  const ctx=load(),f=futures({positions:[{month:'202612',contracts:4,settlementPrice:1400}],baselinePnl:-600000,lossPrice:1385,rebuy:{lowPrice:1390,floorPrice:1370,steps:2}}),before=JSON.stringify(f);
  const {rows,beHeld,beBuy}=ctx.futureLadder(f,1395);
  assert.deepEqual(plain(rows.map(r=>r.kind)),['target','be-held','be-buy','avg','now','check','floor']);
  assert.deepEqual(plain(rows.map(r=>r.price)),[1480,1415,1414,1400,1395,1385,1370]);assert.deepEqual([beHeld,beBuy],[1415,1414]);
  const by=k=>rows.find(r=>r.kind===k);
  assert.deepEqual({...by('target').sub},{type:'buy',count:2,pnl:ctx.futureLadderBuyPnl(f,1480).pnl},'1,380원 직접 입력 회차는 올라갈 때 체결하지 않는다');
  assert.equal(by('avg').sub,null,'1,400원까지 오를 때 도달하는 회차가 없으면 비운다');
  assert.equal(by('now').sub,null);
  assert.deepEqual({...by('check').sub},{type:'cut',count:1,pnl:ctx.futureLadderCutPnl(f,1385).pnl});
  assert.equal(by('floor').rounds,2);assert.equal(by('floor').sub.count,2);
  assert.equal(by('now').pnl,ctx.futuresSummary(f,1395).current);
  assert.deepEqual([by('target').top,by('be-held').top,by('be-held').bottom,by('be-buy').bottom,by('floor').top],['g','g','w','r','r'],'보유만 이익 / 분할매수해야 이익 / 손실 구간');
  assert.equal(JSON.stringify(f),before,'계산·그리기에서 저장 필드를 만들지 않는다');
  const html=ctx.futureLadderHtml(f,{asOf:'2026-10-16',close:1395,ma:{}});
  assert.match(html,/id="flossPrice"[^>]*value="1385"/);assert.match(html,/손익분기 · 보유만/);assert.match(html,/분할매수 2계약 체결/);assert.match(html,/손절 1계약 반영/);
  assert.doesNotMatch(html,/전부 체결/);
  assert.equal(JSON.stringify(f),before);
});

test('보유 계약·계획·손절 기준이 없으면 손익분기·보유 평균·손절 하단 행을 빼고 시세가 없으면 위아래를 보유 평균으로 나눈다',()=>{
  const ctx=load(),empty=ctx.futureLadder({targetPrice:1480,baselinePnl:0,positions:[],levels:[]},null);
  assert.deepEqual(plain(empty.rows.map(r=>r.kind)),['target','check']);assert.equal(empty.beHeld,null);assert.equal(empty.beBuy,null);
  const f=futures({lossPrice:1390}),rows=ctx.futureLadder(f,null).rows;
  assert.equal(rows.find(r=>r.kind==='target').sub.type,'buy');
  assert.equal(rows.find(r=>r.kind==='check').sub,null,'평균 아래에서 손절 기준이 없으면 비운다');
});

test('달러선물 화면은 사다리와 월물교체 예상을 그리고 확인 환율 손실 상쇄 비율을 숫자로 보인다',()=>{
  const ctx=load(),els={};
  const el=id=>els[id]||(els[id]={id,innerHTML:'',open:false,value:'',classList:{toggle(){}},setAttribute(){},querySelector:()=>({textContent:''}),addEventListener(){},focus(){}});
  Object.assign(ctx,{$:el,$$:()=>[],onEdit(){},save(){},money:v=>`${new Intl.NumberFormat('ko-KR').format(Math.round(v))}원`,decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),memoCount:()=>'',priceData:null});
  ctx.state={futures:futures({baselinePnl:0,rollSpread:-0.5})};
  vm.runInContext('renderFutures()',ctx);
  const html=els.futuresView.innerHTML;
  assert.match(html,/id="futureLadder"/);assert.match(html,/id="futureRollDetails"/);
  assert.match(html,/확인 1,320원 손익 \+ 교체 이득[^]*1년 후 · \d+% 상쇄/);
  assert.doesNotMatch(html,/NaN|future-overview|계획 전부 체결 가정/);
});
