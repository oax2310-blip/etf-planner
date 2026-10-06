const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=['prices.js','rebuy.js','trade-alerts.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
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
  const sold=ctx.futureRebuySummary(f).sold;
  assert.equal(ctx.futureRebuySummary(f).plan.reduce((a,b)=>a+b,0),sold);
  assert.notEqual(ctx.setFutureBuyDone(f,0,true),false);
  assert.equal(ctx.setFutureCutDone(f,2,true),false);
  assert.equal(ctx.setFutureBuyQty(f,0,String(sold+1)),false);
  ctx.setFutureBuyDone(f,1,true);
  const s=ctx.futureRebuySummary(f);assert.equal(s.rest,0);assert.equal(s.rebought,s.sold);assert.equal(s.held,20);
  assert.equal(f.positions[0].contracts,20);assert.equal(f.baselinePnl,0,'체크가 실제 계좌의 정산손익을 추정해서 바꾸지 않는다');
});

test('반등 배분은 평균 손절 환율 이하 단계가 첫 단계부터 이어지는 만큼 나누고 비운 기준가에서 끊으며 첫 단계 전에는 환율 복귀가 없다',()=>{
  const ctx=load(),f=futures({currentPrice:1200,stages:[{name:'25분봉',price:1210},{name:'32분봉',price:0},{name:'25일선',price:1500}]});
  ctx.setFutureCutDone(f,0,true);
  let s=ctx.futureRebuySummary(f);
  assert.equal(s.sellAvg,1400);assert.equal(s.splits,1,'비운 32선에서 끊는다');assert.deepEqual(plain(s.plan),[3,0,0]);
  f.rebuy.stages[1].price=1300;s=ctx.futureRebuySummary(f);
  assert.equal(s.splits,2,'평균 손절 환율 위인 25일선에서 끊는다');assert.deepEqual(plain(s.plan),[2,1,0]);
  f.rebuy.currentPrice=1450;s=ctx.futureRebuySummary(f);
  assert.equal(s.due,0,'첫 단계를 사기 전에는 손절 환율 위로 와도 기다린다');assert.deepEqual(plain(s.plan),[2,1,0]);
});
test('첫 단계를 산 뒤 평균 손절 환율에 먼저 돌아오면 남은 계약을 다음 단계에서 지금 되사고 현재 환율로 기록한다',()=>{
  const ctx=load(),f=futures({currentPrice:1349.8,stages:[{name:'25분봉',price:1320},{name:'32분봉',price:1330},{name:'25일선',price:1380}]});
  ctx.setFutureCutDone(f,0,true);ctx.setFutureCutDone(f,1,true);
  f.rebuy.cuts[0].price=1399.7;f.rebuy.cuts[1].price=1349.8;
  let s=ctx.futureRebuySummary(f);
  assert.ok(Math.abs(s.sellAvg-(3*1399.7+4*1349.8)/7)<1e-9,'기한은 실제 체결 환율의 계약 수 가중평균');
  assert.deepEqual([s.splits,s.due],[2,0]);assert.deepEqual(plain(s.plan),[4,3,0]);
  assert.notEqual(ctx.setFutureBuyDone(f,0,true),false);
  assert.deepEqual([f.rebuy.splits,f.rebuy.stages[0].contracts,f.rebuy.stages[0].execPrice],[2,4,1320],'첫 재매수 때 분할 수를 고정하고 기준가로 기록');
  f.rebuy.stages[2].price=1300;s=ctx.futureRebuySummary(f);
  assert.equal(s.splits,2,'25일선이 내려와도 처음 정한 2분할 그대로');assert.deepEqual(plain(s.plan),[4,3,0]);assert.equal(s.due,0);
  f.rebuy.currentPrice=1372;s=ctx.futureRebuySummary(f);
  assert.equal(s.due,3);assert.deepEqual(plain(s.plan),[4,3,0]);
  assert.notEqual(ctx.setFutureBuyDone(f,1,true),false);
  assert.deepEqual([f.rebuy.stages[1].contracts,f.rebuy.stages[1].execPrice],[3,1372],'환율 복귀로 사는 단계는 기준가가 아니라 현재 환율로 기록한다');
  s=ctx.futureRebuySummary(f);assert.deepEqual([s.rest,s.due],[0,0]);
  assert.equal(ctx.setFutureCutDone(f,1,false),false,'이미 되산 손절분을 지우지 못한다');
  assert.equal(ctx.setFutureBuyQty(f,0,'8'),false,'판 계약 수를 넘겨 기록하지 못한다');
  ctx.setFutureBuyDone(f,1,false);ctx.setFutureBuyDone(f,0,false);assert.equal(f.rebuy.splits,undefined,'재매수 체크를 모두 풀면 분할 수를 지운다');
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
  assert.notEqual(ctx.setFutureBuyDone(f,0,false),false);assert.equal(ctx.futureRebuySummary(f).rebought,0);
});

test('손절 시작·회차·반등 단계·환율 복귀 알림은 보유 근월물과 절반 계획에 연결되고 완료·미배분 회차를 제외한다',()=>{
  const ctx=load(),f=futures({stages:[{name:'25분봉',price:1380}],notify:{breakdown:true,cuts:true,buys:true,deadlines:true}}),data={futures:f},before=JSON.stringify(data);
  let rules=plain(ctx.buildTradeAlertRules(data,quote()));
  assert.deepEqual(rules.map(x=>x.targetPrice),[1400,1400,1350,1300],'손절 전에는 배분이 없어 재매수 알림을 만들지 않는다');
  assert.ok(rules.every(x=>x.quoteGroup==='futures'&&x.quoteKey==='202612'&&x.condition==='down'));
  assert.equal(JSON.stringify(data),before);
  ctx.setFutureCutDone(f,0,true);f.rebuy.cuts[0].price=1399.7;
  rules=plain(ctx.buildTradeAlertRules(data,quote(1360)));
  assert.deepEqual(rules.filter(x=>x.condition==='up').map(x=>[x.id,x.targetPrice]),[['trade:future-rebuy:buy:stage:0',1380]],'첫 단계를 사기 전에는 환율 복귀 알림이 없다');
  ctx.setFutureBuyDone(f,0,true);assert.equal(f.rebuy.stages[0].execPrice,1380);assert.equal(ctx.buildTradeAlertRules(data,quote()).length,0);
  ctx.setFutureBuyQty(f,0,'1');rules=plain(ctx.buildTradeAlertRules(data,quote(1360)));
  assert.deepEqual(rules.map(x=>[x.id,x.label,x.targetPrice,x.condition]),[['trade:future-rebuy:deadline','달러선물 손절 환율 복귀',1399.7,'up']],'첫 단계 뒤 남은 계약은 평균 손절 환율 하나로 알린다');
  assert.ok(!JSON.stringify(rules).includes('contracts'),'발송 규칙에 보유·거래 수량을 담지 않는다');
});
test('부분 재매수는 남은 계약의 환율 복귀 알림을 유지하며 다 복원하면 끈다',()=>{
  const ctx=load(),f=futures({currentPrice:1400,stages:[{name:'25분봉',price:1390}],notify:{deadlines:true}});
  ctx.setFutureCutDone(f,0,true);
  assert.equal(ctx.buildTradeAlertRules({futures:f},quote(1400)).length,0,'첫 단계 전에는 환율 복귀 알림이 없다');
  ctx.setFutureBuyDone(f,0,true);
  assert.equal(f.rebuy.stages[0].execPrice,1390,'첫 단계 전에는 환율 복귀가 아니라 단계 기준가로 기록');
  ctx.setFutureBuyQty(f,0,'1');
  assert.equal(ctx.buildTradeAlertRules({futures:f},quote(1400)).length,1);
  ctx.setFutureBuyQty(f,0,'3');assert.equal(ctx.buildTradeAlertRules({futures:f},quote(1400)).length,0);
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
