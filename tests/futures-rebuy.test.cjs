const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=['ma-ladder.js','prices.js','rebuy.js','trade-alerts.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({});vm.runInContext(code,ctx);return ctx;};
const plain=v=>JSON.parse(JSON.stringify(v));
// 모두 가상 계약·시세. 실제 기록은 공개 테스트에 넣지 않는다.
const futures=(extra={})=>({positions:[{month:'202612',contracts:20,settlementPrice:1450}],levels:[],baselinePnl:0,rebuy:{lowPrice:1400,floorPrice:1300,contracts:20,steps:3,...extra}});
const quote=(close=1340,ma={})=>({updatedAt:'2026-10-04T00:00:00Z',stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-02',close,ma}}});

test('달러 손절은 하단에서 끝나며 홀수 계약도 절반 이상을 남긴다',()=>{
  const ctx=load();
  for(let contracts=2;contracts<=101;contracts++)for(const steps of [1,2,3,7,10,60]){
    const f=futures({contracts,steps}),cuts=ctx.futureCutPlan(f),goal=Math.floor(contracts/2);
    assert.equal(cuts.reduce((n,c)=>n+c.qty,0),goal);
    assert.equal(cuts.at(-1).price,1300);
    assert.ok(cuts.every(c=>Number.isInteger(c.qty)&&c.qty>0&&c.price>=1300&&c.price<=1400&&c.left>=contracts-goal));
    if(cuts.length>1)assert.equal(cuts[0].price,1400);
    for(let i=0;i<cuts.length;i++)assert.notEqual(ctx.setFutureCutDone(f,i,true),false);
    assert.equal(ctx.futureRebuySummary(f).sold,goal);
  }
});

test('기준을 읽어도 새 기록을 만들지 않고 최초 입력 때 이탈 전 계약 수를 고정한다',()=>{
  const ctx=load(),f=futures();delete f.rebuy;
  f.levels=[{tranches:[{completed:true},{completed:true,mergedMonth:'202612'}]}];
  const before=JSON.stringify(f);assert.equal(ctx.futureRebuySummary(f).hold,21);assert.equal(JSON.stringify(f),before);
  assert.notEqual(ctx.setFutureRebuyField(f,'lowPrice','1400'),false);
  f.positions[0].contracts=10;
  assert.equal(ctx.futureRebuySummary(f).hold,21,'보유 월물을 실제 손절 후 고쳐도 손절 목표가 다시 줄지 않는다');
});

test('하단이 잘못되거나 2계약 미만이면 예정 손절을 만들지 않으며 잘못된 입력은 저장하지 않는다',()=>{
  const ctx=load();
  for(const extra of [{floorPrice:1400},{floorPrice:1450},{floorPrice:0},{contracts:1}])assert.equal(ctx.futureCutPlan(futures(extra)).length,0);
  const f={positions:[],levels:[]};
  for(const [key,value] of [['floorPrice','Infinity'],['contracts','2.5'],['steps','61'],['currentPrice','NaN']])assert.equal(ctx.setFutureRebuyField(f,key,value),false);
  assert.equal(f.rebuy,undefined);
  ctx.setFutureRebuyField(f,'lowPrice','1400');
  assert.equal(ctx.setFutureRebuyField(f,'floorPrice','1400'),false);
});

test('회차 체크만으로 다음 예정 수량은 바뀌지 않고 실제 수량 조정 뒤에도 절반 한도를 지킨다',()=>{
  const ctx=load(),f=futures(),original=plain(ctx.futureCutPlan(f));
  ctx.setFutureCutDone(f,0,true);
  assert.deepEqual(plain(ctx.futureCutPlan(f)).slice(1),original.slice(1));
  assert.notEqual(ctx.setFutureCutQty(f,0,'2'),false);
  const cuts=ctx.futureCutPlan(f);assert.equal(cuts.reduce((n,c)=>n+c.qty,0),10);
  assert.equal(ctx.setFutureCutQty(f,0,'11'),false);
  assert.equal(ctx.setFutureRebuyField(f,'contracts','100'),false,'체결 기록이 생기면 기준 변경은 잠근다');
});

test('반등 단계는 싼 환율에서도 판 계약 수만 복원하고 재매수 시작 뒤 손절을 멈춘다',()=>{
  const ctx=load(),f=futures({currentPrice:1250,stages:[{name:'25분봉',price:1260},{name:'25일선',price:1270}]});
  ctx.setFutureCutDone(f,0,true);ctx.setFutureCutDone(f,1,true);
  let s=ctx.futureRebuySummary(f);const sold=s.sold;
  assert.equal(s.tranches.reduce((a,x)=>a+x.amount,0),sold);
  for(const x of s.tranches)assert.notEqual(ctx.setFutureBuyDone(f,x.i,x.t,true),false);
  assert.equal(ctx.setFutureCutDone(f,2,true),false);
  assert.equal(ctx.setFutureBuyQty(f,0,0,String(sold+1)),false);
  s=ctx.futureRebuySummary(f);assert.equal(s.rest,0);assert.equal(s.rebought,s.sold);assert.equal(s.held,20);
  assert.equal(f.positions[0].contracts,20);assert.equal(f.baselinePnl,0,'체크가 실제 계좌의 정산손익을 추정해서 바꾸지 않는다');
});
test('반등 배분은 평균 손절 환율 이하 회차에만 나누고 비운 기준가에서 끊으며 계약은 회차에 고르게 흩는다',()=>{
  const ctx=load(),f=futures({currentPrice:1200,stages:[{name:'25분봉',price:1210},{name:'32분봉',price:0},{name:'25일선',price:1500}]});
  ctx.setFutureCutDone(f,0,true);
  let s=ctx.futureRebuySummary(f);
  assert.equal(s.sellAvg,1400);assert.deepEqual(plain(s.tranches).map(x=>[x.i,x.t]),[[0,0]],'32선 기준가가 비어 25선 2·3차 환율은 추정이라 25선 1차만');assert.deepEqual(plain(s.plan),[3,0,0]);
  f.rebuy.stages[1].price=1300;s=ctx.futureRebuySummary(f);
  assert.deepEqual(plain(s.tranches).map(x=>[x.i,x.t,x.amount]),[[0,0,1],[0,1,0],[0,2,1],[1,0,0],[1,1,1]],'32선 3차 1,433.33원은 평균 손절 환율 위, 3계약은 5회에 1·0·1·0·1');
  assert.deepEqual(plain(s.skipped).map(x=>[x.i,x.t]),[[1,2]]);assert.deepEqual(plain(s.plan),[2,1,0]);
  f.rebuy.currentPrice=1450;assert.deepEqual(plain(ctx.futureRebuySummary(f).plan),[2,1,0],'손절 환율 위로 와도 기한 없이 회차 신호를 기다린다');
});
test('회차를 체크하면 회차 환율로 기록하고 첫 재매수 때 회차 계획을 고정하며 체크를 모두 풀면 지운다',()=>{
  const ctx=load(),f=futures({currentPrice:1320,stages:[{name:'25분봉',price:1320},{name:'32분봉',price:1330},{name:'25일선',price:1380}]});
  ctx.setFutureCutDone(f,0,true);ctx.setFutureCutDone(f,1,true);
  f.rebuy.cuts[0].price=1399.7;f.rebuy.cuts[1].price=1349.8;
  let s=ctx.futureRebuySummary(f);
  assert.ok(Math.abs(s.sellAvg-(3*1399.7+4*1349.8)/7)<1e-9,'기준은 실제 체결 환율의 계약 수 가중평균');
  assert.deepEqual(plain(s.plan),[4,3,0]);
  assert.deepEqual(plain(s.tranches).map(x=>[x.i,x.t,x.price,x.amount]),[[0,0,1320,1],[0,1,1323.3333333333333,1],[0,2,1326.6666666666667,2],[1,0,1330,1],[1,1,1346.6666666666667,1],[1,2,1363.3333333333333,1]],'회차 환율이 모두 평균 손절 환율 1,371.19원 이하, 7계약을 6회에 고르게');
  assert.notEqual(ctx.setFutureBuyDone(f,0,1,true),false);
  assert.deepEqual(plain([f.rebuy.planned,f.rebuy.stages[0].buys]),[[['25선',0],['25선',1],['25선',2],['32선',0],['32선',1],['32선',2]],[null,{contracts:1,price:1323.33}]],'회차 환율(소수 둘째 자리)로 기록하고 계획을 저장');
  f.rebuy.stages[2].price=1300;s=ctx.futureRebuySummary(f);
  assert.equal(s.tranches.length,6,'25일선이 내려와도 처음 정한 계획 그대로');assert.equal(s.rest,6);
  assert.notEqual(ctx.setFutureBuyPrice(f,0,1,'1325.5'),false);assert.notEqual(ctx.setFutureBuyQty(f,0,1,'2'),false);
  assert.deepEqual(plain(f.rebuy.stages[0].buys[1]),{contracts:2,price:1325.5});
  assert.equal(ctx.setFutureBuyQty(f,0,1,'8'),false,'판 계약 수를 넘겨 기록하지 못한다');
  assert.equal(ctx.setFutureBuyDone(f,0,1,true),false,'이미 산 회차');
  ctx.setFutureBuyDone(f,0,1,false);assert.deepEqual([f.rebuy.stages[0].buys,f.rebuy.planned],[undefined,undefined],'체크를 모두 풀면 회차 기록과 계획을 지운다');
});
test('예전 손절 환율 복귀 방식 기록은 다음 반등 단계에서 산 것으로 이어 보고 처음 고칠 때 옮긴다',()=>{
  const ctx=load(),f=futures({buyMode:'sellPrice',currentPrice:1380,cuts:[{contracts:3,price:1399.7,targetPrice:1400},{contracts:4,price:1349.8,targetPrice:1350}],returns:[null,{done:true,contracts:3,execPrice:1350},{done:false,contracts:null,execPrice:null}]});
  f.rebuy.returns[0]={done:true,contracts:1,execPrice:1356};
  const before=JSON.stringify(f);let s=ctx.futureRebuySummary(f);
  assert.equal(JSON.stringify(f),before,'읽기만 하면 기록을 바꾸지 않는다');
  assert.equal(s.rebought,4);assert.equal(s.rest,3);assert.ok(s.started);
  assert.deepEqual([s.stages[0].name,s.stages[0].done,s.stages[0].contracts,s.stages[0].execPrice],['25선',true,4,1351.5]);
  assert.equal(ctx.setFutureCutDone(f,1,false),false);
  assert.notEqual(ctx.setFutureRebuyField(f,'currentPrice','1390'),false);
  assert.equal(f.rebuy.returns,undefined);assert.equal(f.rebuy.buyMode,undefined);
  assert.deepEqual([f.rebuy.stages[0].done,f.rebuy.stages[0].contracts,f.rebuy.stages[0].execPrice],[true,4,1351.5]);
  s=ctx.futureRebuySummary(f);assert.equal(s.rebought,4);assert.equal(s.rest,3);
  assert.notEqual(ctx.setFutureBuyDone(f,0,0,false),false);assert.equal(ctx.futureRebuySummary(f).rebought,0);
});

test('손절 시작·회차·반등 단계 회차 알림은 보유 근월물과 절반 계획에 연결되고 완료·미배분 회차를 제외한다',()=>{
  const ctx=load(),f=futures({stages:[{name:'25분봉',price:1380},{name:'25일선',price:1410}],notify:{breakdown:true,cuts:true,buys:true,deadlines:true}}),data={futures:f},before=JSON.stringify(data);
  let rules=plain(ctx.buildTradeAlertRules(data,quote()));
  assert.deepEqual(rules.map(x=>x.targetPrice),[1400,1400,1350,1300],'손절 전에는 배분이 없어 재매수 알림을 만들지 않는다');
  assert.ok(rules.every(x=>x.quoteGroup==='futures'&&x.quoteKey==='202612'&&x.condition==='down'));
  assert.equal(JSON.stringify(data),before);
  ctx.setFutureCutDone(f,0,true);f.rebuy.cuts[0].price=1399.7;
  rules=plain(ctx.buildTradeAlertRules(data,quote(1360)));
  assert.deepEqual(rules.filter(x=>x.condition==='up').map(x=>[x.id,x.label,x.targetPrice]),[['trade:future-rebuy:buy:stage:0','달러선물 재매수 25선',1380],['trade:future-rebuy:buy:stage:0:2','달러선물 재매수 25선 2차',1390]],'25선→25일선 회차 중 평균 손절 환율 1,399.7원 이하만(3차 1,400원 제외), 기한 알림은 없다');
  ctx.setFutureBuyDone(f,0,0,true);assert.deepEqual(plain(f.rebuy.stages[0].buys),[{contracts:2,price:1380}],'3계약을 2회에 2·1');
  rules=plain(ctx.buildTradeAlertRules(data,quote()));
  assert.deepEqual(rules.map(x=>x.id),['trade:future-rebuy:buy:stage:0:2'],'산 회차와 재매수 시작 뒤 손절은 제외');
  assert.ok(!JSON.stringify(rules).includes('contracts'),'발송 규칙에 보유·거래 수량을 담지 않는다');
});
test('회차 알림은 비운 기준가의 추정 환율을 쓰지 않고 다 복원하면 끈다',()=>{
  const ctx=load(),f=futures({currentPrice:1390,stages:[{name:'25분봉',price:1390},{name:'32분봉',price:0},{name:'25일선',price:1500}],notify:{buys:true}});
  ctx.setFutureCutDone(f,0,true);
  let rules=plain(ctx.buildTradeAlertRules({futures:f},quote(1390)));
  assert.deepEqual(rules.map(x=>x.id),['trade:future-rebuy:buy:stage:0'],'32선 기준가가 비어 2·3차 환율은 추정이라 알리지 않는다');
  f.rebuy.stages[1].price=1405;rules=plain(ctx.buildTradeAlertRules({futures:f},quote(1390)));
  assert.deepEqual(rules.map(x=>[x.id,x.targetPrice]),[['trade:future-rebuy:buy:stage:0',1390],['trade:future-rebuy:buy:stage:0:2',1395],['trade:future-rebuy:buy:stage:0:3',1400]]);
  for(const t of [0,1,2])ctx.setFutureBuyDone(f,0,t,true);
  assert.equal(ctx.futureRebuySummary(f).rest,0);assert.equal(ctx.buildTradeAlertRules({futures:f},quote(1400)).length,0);
});
test('달러 재매수 시세는 소수 환율을 보존하고 손절 기준·분봉·체결 기록을 덮어쓰지 않는다',()=>{
  const ctx=load(),f=futures({stages:[{name:'25분봉',price:1250},{name:'25일선',price:1260,done:true,contracts:1,execPrice:1259.3}]});
  const data={futures:f},q=quote(1340.27,{'25일선':1320.456});
  assert.equal(ctx.fillPrices(data,q),true);
  assert.equal(f.rebuy.currentPrice,1340.27);assert.equal(f.rebuy.stages[1].price,1320.46);
  assert.equal(f.rebuy.stages[1].execPrice,1259.3);assert.equal(f.rebuy.stages[0].price,1250);
  assert.deepEqual([f.rebuy.lowPrice,f.rebuy.floorPrice,f.rebuy.contracts],[1400,1300,20]);
  assert.equal(ctx.fillPrices(data,q),false);
  const without=futures();delete without.rebuy;ctx.fillPrices({futures:without},q);assert.equal(without.rebuy,undefined);
});
