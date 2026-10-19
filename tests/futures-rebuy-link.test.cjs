// 달러선물 손절·재매수 체크의 보유 월물·누적 정산손익 반영. 모두 가상 계약·체결 기록이다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=['ma-ladder.js','prices.js','rebuy.js','futures.js','futures-plan.js','futures-rebuy.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({contractSize:10000});vm.runInContext(code,ctx);return ctx;};
const futures=(extra={})=>({targetPrice:1480,baselinePnl:50000,positions:[{month:'202612',contracts:4,settlementPrice:1450}],levels:[],rebuy:{lowPrice:1400,floorPrice:1300,contracts:4,steps:2,...extra}});
const held=f=>f.positions.reduce((n,p)=>n+p.contracts,0);

test('손절 체크는 근월물 계약을 빼고 실현 손익을 누적 정산손익에 더해 기대수익·도달 손익에 반영한다',()=>{
  const ctx=load(),f=futures(),before=ctx.futuresSummary(f).current;
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  const rec=f.rebuy.cuts[0];
  assert.equal(rec.contracts,1);assert.equal(rec.month,'202612');assert.equal(rec.settlementPrice,1450);
  assert.deepEqual(JSON.parse(JSON.stringify(f.positions)),[{month:'202612',contracts:3,settlementPrice:1450}],'남은 계약의 단순평균가는 그대로');
  assert.equal(f.baselinePnl,50000+(1400-1450)*10000);
  const s=ctx.futuresSummary(f);
  assert.equal(s.posContracts,3);
  assert.equal(s.current,before-(1480-1400)*10000,'판 계약은 목표 환율까지의 이익 대신 손절 환율에서 확정');
  const loss=ctx.lossCheck(f);
  assert.equal(loss.contracts,3);assert.equal(loss.held,3*(1320-1450)*10000,'도달 손익의 보유분에서 판 계약이 빠진다');
  assert.equal(loss.pnl,f.baselinePnl+loss.held);
  assert.equal(ctx.rollEstimate(f,s.posContracts+s.legacyCount).perRoll,3*5000,'월물교체 예상도 남은 계약 기준');
  assert.equal(ctx.futureRebuySummary(f).hold,4,'이탈 전 계약 수(손절 목표)는 그대로');
});

test('손절 체결 환율·계약 수 수정과 체크 해제는 보유·누적 정산손익을 같은 계산으로 되돌린다',()=>{
  const ctx=load(),f=futures(),orig=JSON.stringify({p:f.positions,b:f.baselinePnl});
  ctx.setFutureCutChecked(f,0,true);
  assert.notEqual(ctx.setFutureCutPrice(f,0,'1395.5'),false);
  assert.equal(f.baselinePnl,50000+Math.round((1395.5-1450)*10000));
  assert.notEqual(ctx.setFutureCutCount(f,0,'2'),false);
  assert.equal(held(f),2);assert.equal(f.baselinePnl,50000+Math.round((1395.5-1450)*2*10000));
  assert.equal(ctx.setFutureCutCount(f,0,'3'),false,'손절 목표(2계약)를 넘으면 거부');
  assert.equal(held(f),2);
  assert.notEqual(ctx.setFutureCutCount(f,0,'1'),false);
  assert.equal(held(f),3);assert.equal(f.positions[0].settlementPrice,1450);
  assert.notEqual(ctx.setFutureCutChecked(f,0,false),false);
  assert.equal(f.rebuy.cuts[0],null);
  assert.equal(JSON.stringify({p:f.positions,b:f.baselinePnl}),orig,'해제하면 원래 보유·정산손익');
});

test('손절로 월물을 다 팔면 행을 지우고, 해제하면 판 시점 단순평균가로 되살린다',()=>{
  const ctx=load(),two=()=>[{month:'202612',contracts:2,settlementPrice:1450},{month:'202703',contracts:2,settlementPrice:1460}];
  const f=futures({contracts:3,sellPct:100,steps:3});f.positions=[{month:'202612',contracts:1,settlementPrice:1450},{month:'202703',contracts:2,settlementPrice:1460}];
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  assert.equal(f.rebuy.cuts[0].month,'202612');
  const all=futures({sellPct:100,steps:1});all.positions=two();
  assert.equal(ctx.setFutureCutChecked(all,0,true),'unlinked','한 월물에 판 계약 수만큼 없으면 나눠 빼지 않고 기록만');
  assert.deepEqual(JSON.parse(JSON.stringify(all.positions)),two());assert.equal(all.baselinePnl,50000);
  const g=futures({steps:1});g.positions=two();
  ctx.setFutureCutChecked(g,0,true);
  assert.equal(g.rebuy.cuts[0].contracts,2);
  assert.deepEqual(JSON.parse(JSON.stringify(g.positions)),[{month:'202703',contracts:2,settlementPrice:1460}]);
  ctx.setFutureCutChecked(g,0,false);
  assert.deepEqual(JSON.parse(JSON.stringify(g.positions)),[{month:'202612',contracts:2,settlementPrice:1450},{month:'202703',contracts:2,settlementPrice:1460}]);
});

test('보유 월물이 없으면 손절 기록만 하고 반영하지 않는다',()=>{
  const ctx=load(),f=futures();f.positions=[];
  assert.equal(ctx.setFutureCutChecked(f,0,true),'unlinked');
  assert.equal(f.rebuy.cuts[0].contracts,1);assert.equal(Object.hasOwn(f.rebuy.cuts[0],'month'),false);
  assert.equal(f.baselinePnl,50000);
  assert.equal(ctx.futureRebuyUnlinked(f).cuts,1);
});

test('재매수 체크는 근월물에 체결 환율로 편입하고 수정·해제는 가중평균을 되돌린다',()=>{
  const ctx=load(),f=futures({currentPrice:1420});
  f.rebuy.stages=[{name:'25일선',price:1380},{name:'60일선',price:1420},{name:'120일선',price:1500}];
  ctx.setFutureCutChecked(f,0,true);ctx.setFutureCutChecked(f,1,true);
  assert.equal(held(f),2);
  const s=ctx.futureRebuySummary(f),tr=s.tranches.find(x=>x.amount>0);
  const pnl=f.baselinePnl;
  assert.equal(ctx.setFutureBuyChecked(f,tr.i,tr.t,true),true);
  const [rec,key]=ctx.futureFillRec(f,tr.i,tr.t);
  assert.equal(rec.month,'202612');
  assert.equal(held(f),2+rec.contracts);
  assert.equal(f.positions[0].settlementPrice,(1450*2+rec[key]*rec.contracts)/(2+rec.contracts));
  assert.equal(f.baselinePnl,pnl,'재매수는 정산손익을 바꾸지 않는다');
  assert.notEqual(ctx.setFutureBuyExec(f,tr.i,tr.t,'1390'),false);
  assert.ok(Math.abs(f.positions[0].settlementPrice-(1450*2+1390*rec.contracts)/(2+rec.contracts))<1e-9);
  assert.notEqual(ctx.setFutureBuyChecked(f,tr.i,tr.t,false),false);
  assert.equal(held(f),2);assert.ok(Math.abs(f.positions[0].settlementPrice-1450)<1e-9);
});

test('연동 전 체크 기록은 버튼으로만 반영하고, 반영할 수 없으면 원본을 그대로 둔다',()=>{
  const ctx=load(),f=futures({cuts:[{contracts:1,price:1398,targetPrice:1400}]}),before=JSON.stringify(f);
  assert.deepEqual({...ctx.futureRebuyUnlinked(f)},{cuts:1,buys:0});
  assert.equal(ctx.futuresSummary(f).posContracts,4,'읽기·계산만으로는 반영하지 않는다');
  const g=ctx.futureRebuyLinked(f);
  assert.equal(JSON.stringify(f),before,'미리 계산만 하면 원본을 바꾸지 않는다');
  assert.equal(held(g),3);assert.equal(g.baselinePnl,50000+(1398-1450)*10000);
  assert.equal(g.rebuy.cuts[0].month,'202612');assert.deepEqual({...ctx.futureRebuyUnlinked(g)},{cuts:0,buys:0});
  const none=futures({cuts:[{contracts:9,price:1398,targetPrice:1400}]});
  assert.equal(ctx.futureRebuyLinked(none),null,'보유보다 많이 판 기록은 반영하지 않는다');
});

test('직접 반영함은 미반영 기록에 manual만 남겨 안내·반영에서 빼고, 보유·누적 정산손익은 그대로 둔다',()=>{
  const ctx=load(),f=futures({currentPrice:1420,cuts:[{contracts:1,price:1398,targetPrice:1400},{contracts:1,price:1390,targetPrice:1390,month:'202612',settlementPrice:1450}]});
  f.rebuy.stages=[{name:'25일선',price:1380,buys:[{contracts:1,price:1385}]},{name:'60일선',price:1420,done:true,contracts:1,execPrice:1420}];
  const pos=JSON.stringify({p:f.positions,b:f.baselinePnl});
  assert.deepEqual({...ctx.futureRebuyUnlinked(f)},{cuts:1,buys:2});
  ctx.markFutureRebuyManual(f);
  assert.deepEqual({...ctx.futureRebuyUnlinked(f)},{cuts:0,buys:0});
  assert.equal(f.rebuy.cuts[0].manual,true);assert.equal(Object.hasOwn(f.rebuy.cuts[1],'manual'),false,'보유에 반영한 기록은 그대로');
  assert.equal(f.rebuy.stages[0].buys[0].manual,true);assert.equal(f.rebuy.stages[1].manual,true);
  assert.equal(JSON.stringify({p:f.positions,b:f.baselinePnl}),pos);
  const g=ctx.futureRebuyLinked(f);
  assert.equal(JSON.stringify({p:g.positions,b:g.baselinePnl}),pos,'보유 월물에 반영 대상에서도 빠진다');
  assert.notEqual(ctx.setFutureBuyChecked(f,1,0,false),false);
  assert.equal(Object.hasOwn(f.rebuy.stages[1],'manual'),false,'옛 통째 기록은 체크 해제 때 manual도 지운다');
});
