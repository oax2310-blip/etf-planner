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
  assert.equal(ctx.setFutureRebuyMode(f,'sellPrice'),false);
  assert.equal(ctx.setFutureBuyQty(f,0,String(sold+1)),false);
  ctx.setFutureBuyDone(f,1,true);
  const s=ctx.futureRebuySummary(f);assert.equal(s.rest,0);assert.equal(s.rebought,s.sold);assert.equal(s.held,20);
  assert.equal(f.positions[0].contracts,20);assert.equal(f.baselinePnl,0,'체크가 실제 계좌의 정산손익을 추정해서 바꾸지 않는다');
});

test('반등 배분은 환율 복귀 시 다음 단계로 모이며 비운 기준가는 배분에만 쓴다',()=>{
  const ctx=load(),f=futures({currentPrice:1200,stages:[{name:'25분봉',price:1210},{name:'32분봉',price:0},{name:'25일선',price:1500}]});
  ctx.setFutureCutDone(f,0,true);
  let s=ctx.futureRebuySummary(f);assert.ok(s.plan[0]>0);assert.equal(s.plan[2],0);
  f.rebuy.currentPrice=1400;s=ctx.futureRebuySummary(f);
  assert.deepEqual(plain(s.plan),[s.rest,0,0]);assert.equal(s.due,s.rest);
});

test('손절 환율 복귀는 실제 손절 체결 환율을 쓰고 각 손절분을 독립적으로 복원한다',()=>{
  const ctx=load(),f=futures({buyMode:'sellPrice',currentPrice:1349.8});
  ctx.setFutureCutDone(f,0,true);ctx.setFutureCutDone(f,1,true);
  f.rebuy.cuts[0].price=1399.7;f.rebuy.cuts[1].price=1349.8;
  let s=ctx.futureRebuySummary(f);assert.deepEqual(plain(s.stages).map(x=>x.price),[1349.8,1399.7]);assert.equal(s.due,4);
  ctx.setFutureBuyDone(f,0,true);s=ctx.futureRebuySummary(f);
  assert.equal(s.lots.find(l=>l.k===2).left,0);assert.equal(s.lots.find(l=>l.k===1).left,3);
  assert.equal(ctx.setFutureCutDone(f,1,false),false,'이미 복원한 손절분을 제거하지 못한다');
  assert.equal(ctx.setFutureBuyQty(f,0,'5'),false,'다른 손절분의 계약까지 해당 회차에 넣지 못한다');
  assert.notEqual(ctx.setFutureBuyQty(f,0,'2'),false);
  s=ctx.futureRebuySummary(f);assert.equal(s.lots.find(l=>l.k===2).left,2);assert.equal(s.lots.find(l=>l.k===1).left,3);assert.equal(s.due,2);
});

test('손절 시작·회차·복귀 재매수 알림은 보유 근월물과 절반 계획에 연결되고 완료·미배분 회차를 제외한다',()=>{
  const ctx=load(),f=futures({buyMode:'sellPrice',notify:{breakdown:true,cuts:true,buys:true}}),data={futures:f},before=JSON.stringify(data);
  let rules=plain(ctx.buildTradeAlertRules(data,quote()));
  assert.deepEqual(rules.map(x=>x.targetPrice),[1400,1400,1350,1300]);
  assert.ok(rules.every(x=>x.quoteGroup==='futures'&&x.quoteKey==='202612'&&x.condition==='down'));
  assert.equal(JSON.stringify(data),before);
  ctx.setFutureCutDone(f,0,true);f.rebuy.cuts[0].price=1399.7;
  rules=plain(ctx.buildTradeAlertRules(data,quote(1399.7)));
  const buy=rules.find(x=>x.condition==='up');assert.equal(buy.targetPrice,1399.7);
  ctx.setFutureBuyDone(f,0,true);assert.equal(ctx.buildTradeAlertRules(data,quote()).length,0);
  assert.ok(!JSON.stringify(rules).includes('contracts'),'발송 규칙에 보유·거래 수량을 담지 않는다');
});

test('부분 복귀 재매수는 남은 계약의 알림을 유지하며 다 복원하면 끈다',()=>{
  const ctx=load(),f=futures({buyMode:'sellPrice',currentPrice:1400,notify:{buys:true}});
  ctx.setFutureCutDone(f,0,true);ctx.setFutureBuyDone(f,0,true);ctx.setFutureBuyQty(f,0,'1');
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
