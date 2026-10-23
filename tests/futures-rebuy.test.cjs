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

test('기본 50% 달러 손절은 하단에서 끝나며 홀수 계약도 절반 이상을 남긴다',()=>{
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

test('손절 비중에 따라 목표를 내림해 분할하고 0%·100%·1계약도 처리한다',()=>{
  const ctx=load();
  const cases=[[20,25,5],[20,75,15],[21,50,10],[20,27.5,5],[100,29,29],[1,100,1],[1,50,0],[20,0,0],[0,100,0]];
  for(const [contracts,sellPct,goal] of cases)for(const steps of [1,3,10,60]){
    const f=futures({contracts,sellPct,steps}),before=JSON.stringify(f),s=ctx.futureRebuySummary(f);
    assert.equal(s.goal,goal);assert.equal(s.sellPct,sellPct);
    assert.equal(s.cuts.reduce((n,c)=>n+c.qty,0),goal);
    assert.equal(s.cuts.length,Math.min(steps,goal));
    assert.ok(s.cuts.every(c=>Number.isInteger(c.qty)&&c.qty>0&&c.left>=contracts-goal));
    assert.equal(JSON.stringify(f),before,'계산만 하면 기록을 바꾸지 않는다');
    if(!goal){assert.equal(s.ready,false);continue;}
    assert.equal(s.cuts.at(-1).price,1300);
    if(s.cuts.length>1)assert.equal(s.cuts[0].price,1400);
    for(let i=0;i<s.cuts.length;i++)assert.notEqual(ctx.setFutureCutDone(f,i,true),false);
    assert.equal(ctx.futureRebuySummary(f).sold,goal);
  }
});

test('옛 체결 기록은 비중 필드 없이 50%를 쓰고 입력·빈칸·0%를 구분해 저장한다',()=>{
  const ctx=load(),old=futures({cuts:[{contracts:3,price:1399.7,targetPrice:1400}]}),before=JSON.stringify(old);
  const s=ctx.futureRebuySummary(old);assert.equal(s.sellPct,50);assert.equal(s.goal,10);assert.equal(s.sold,3);
  assert.equal(JSON.stringify(old),before);assert.equal(Object.hasOwn(old.rebuy,'sellPct'),false);
  const f=futures();
  for(const value of ['25','27.5','100','0']){
    assert.notEqual(ctx.setFutureRebuyField(f,'sellPct',value),false);
    assert.equal(f.rebuy.sellPct,Number(value));
  }
  assert.equal(ctx.futureCutPlan(f).length,0);
  assert.notEqual(ctx.setFutureRebuyField(f,'sellPct','  '),false);
  assert.equal(Object.hasOwn(f.rebuy,'sellPct'),false);assert.equal(ctx.futureRebuySummary(f).goal,10);
  const fresh={positions:[],levels:[]};
  for(const value of ['-1','100.1','Infinity','NaN','abc'])assert.equal(ctx.setFutureRebuyField(fresh,'sellPct',value),false);
  assert.equal(ctx.setFutureRebuyField(fresh,'unknown','50'),false);assert.equal(fresh.rebuy,undefined);
});

test('손절 뒤 비중을 바꾸면 체결을 보존하고 남은 회차만 새 목표에 맞춘다',()=>{
  const ctx=load(),f=futures();ctx.setFutureCutDone(f,0,true);
  f.rebuy.cuts[0].price=1399.7;const record=JSON.stringify(f.rebuy.cuts[0]);
  assert.notEqual(ctx.setFutureRebuyField(f,'sellPct','75'),false);
  let s=ctx.futureRebuySummary(f);assert.equal(s.goal,15);assert.equal(s.sold,3);
  assert.equal(s.cuts.filter(c=>!c.done).reduce((n,c)=>n+c.qty,0),12);
  assert.equal(JSON.stringify(f.rebuy.cuts[0]),record);
  assert.notEqual(ctx.setFutureRebuyField(f,'sellPct','15'),false);
  s=ctx.futureRebuySummary(f);assert.equal(s.goal,3);assert.equal(s.cuts.filter(c=>!c.done).reduce((n,c)=>n+c.qty,0),0);
  const before=JSON.stringify(f);
  assert.equal(ctx.setFutureRebuyField(f,'sellPct','14.9'),false);assert.equal(JSON.stringify(f),before);
  assert.notEqual(ctx.setFutureRebuyField(f,'sellPct','75'),false);
  for(let i=1;i<ctx.futureCutPlan(f).length;i++)ctx.setFutureCutDone(f,i,true);
  const overHalf=JSON.stringify(f);assert.equal(ctx.setFutureRebuyField(f,'sellPct',''),false);
  assert.equal(JSON.stringify(f),overHalf,'비우면 50%가 되지만 이미 판 15계약보다 작아져 거절한다');
});

test('손절 목표 완료 뒤 비중을 늘리면 남은 계약을 하단에서 추가 손절할 수 있다',()=>{
  const ctx=load();
  for(const [contracts,steps,sellPct,sold,extra] of [[20,3,75,10,5],[4,10,100,2,2],[2,60,100,1,1]]){
    const f=futures({contracts,steps});
    for(let i=0;i<ctx.futureCutPlan(f).length;i++)ctx.setFutureCutDone(f,i,true);
    const records=JSON.stringify(f.rebuy.cuts);assert.equal(ctx.futureRebuySummary(f).sold,sold);
    assert.notEqual(ctx.setFutureRebuyField(f,'sellPct',String(sellPct)),false);
    const cuts=ctx.futureCutPlan(f),pending=cuts.filter(c=>!c.done);
    assert.equal(JSON.stringify(f.rebuy.cuts),records);
    assert.equal(pending.length,1);assert.equal(pending[0].price,1300);assert.equal(pending[0].qty,extra);
    assert.notEqual(ctx.setFutureCutDone(f,cuts.length-1,true),false);
    assert.equal(ctx.futureRebuySummary(f).sold,sold+extra);
  }
});

test('재매수 시작 뒤 비중은 고정하고 새 비중으로 판 계약만 복원한다',()=>{
  const ctx=load(),f=futures({sellPct:75,currentPrice:1250,stages:[{name:'25선',price:1260},{name:'25일선',price:1270}]});
  for(let i=0;i<ctx.futureCutPlan(f).length;i++)ctx.setFutureCutDone(f,i,true);
  assert.equal(ctx.futureRebuySummary(f).sold,15);
  const first=ctx.futureRebuySummary(f).tranches.find(x=>x.amount>0);
  assert.notEqual(ctx.setFutureBuyDone(f,first.i,first.t,true),false);
  const before=JSON.stringify(f);assert.equal(ctx.setFutureRebuyField(f,'sellPct','100'),false);assert.equal(JSON.stringify(f),before);
  for(const x of ctx.futureRebuySummary(f).tranches.filter(x=>!x.done&&x.amount>0))assert.notEqual(ctx.setFutureBuyDone(f,x.i,x.t,true),false);
  const s=ctx.futureRebuySummary(f);assert.equal(s.rebought,15);assert.equal(s.rest,0);assert.equal(s.held,20);
  assert.equal(f.positions[0].contracts,20);assert.equal(f.baselinePnl,0);
});

test('비중이 0%이면 손절 알림이 없고 늘린 목표의 예정 회차만 알린다',()=>{
  const ctx=load(),f=futures({sellPct:0,notify:{breakdown:true,cuts:true}});
  assert.equal(ctx.buildTradeAlertRules({futures:f},quote()).length,0);
  ctx.setFutureRebuyField(f,'sellPct','10');
  assert.deepEqual(plain(ctx.buildTradeAlertRules({futures:f},quote())).map(x=>x.targetPrice),[1400,1400,1300]);
  ctx.setFutureCutDone(f,0,true);
  ctx.setFutureRebuyField(f,'sellPct','100');
  const rules=plain(ctx.buildTradeAlertRules({futures:f},quote()));
  assert.deepEqual(rules.filter(x=>x.id.includes(':cut:')).map(x=>x.targetPrice),[1350,1300]);
  assert.ok(!JSON.stringify(rules).includes('contracts'),'비중을 바꿔도 발송 규칙에 보유·거래 수량을 담지 않는다');
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
  const cuts=ctx.futureCutPlan(f);assert.equal(cuts.reduce((n,c)=>n+(c.plannedQty??c.qty),0),10);
  assert.deepEqual([cuts[0].qty,cuts[0].plannedQty,cuts[0].partial,cuts[0].done],[2,3,true,false],'계획보다 적게 고치면 남은 계약은 그 회차에 둔다');
  assert.deepEqual(plain(cuts).slice(1),original.slice(1),'다음 회차 배정은 그대로');
  assert.equal(ctx.setFutureCutQty(f,0,'11'),false);
});

test('손절 체크 뒤에도 재매수 전에는 신저점·하단·이탈 전 계약 수·분할 횟수를 바꾸고 체결 기록은 그대로 둔다',()=>{
  const ctx=load(),f=futures({steps:5});ctx.setFutureCutDone(f,0,true);ctx.setFutureCutDone(f,1,true);
  f.rebuy.cuts[0].price=1399.7;const records=JSON.stringify(f.rebuy.cuts),sold=ctx.futureRebuySummary(f).sold;assert.equal(sold,4);
  assert.notEqual(ctx.setFutureRebuyField(f,'lowPrice','1420'),false);assert.notEqual(ctx.setFutureRebuyField(f,'floorPrice','1250'),false);
  assert.notEqual(ctx.setFutureRebuyField(f,'contracts','30'),false);assert.notEqual(ctx.setFutureRebuyField(f,'steps','8'),false);
  let s=ctx.futureRebuySummary(f);
  assert.equal(JSON.stringify(f.rebuy.cuts),records,'체결 기록(계약 수·체결·회차 환율)은 그대로');
  assert.deepEqual(plain(s.cuts.filter(c=>c.done).map(c=>[c.price,c.qty])),[[1400,2],[1375,2]]);
  assert.equal(s.goal,15);assert.equal(s.sold,4);assert.equal(s.cuts.length,8);
  assert.equal(s.cuts.filter(c=>!c.done).reduce((n,c)=>n+c.qty,0),11,'남은 목표만 새 회차에 다시 나눈다');
  assert.equal(s.cuts.at(-1).price,1250);assert.ok(s.cuts.filter(c=>!c.done).every(c=>c.price>=1250&&c.price<=1420));
  const before=JSON.stringify(f);
  for(const [key,value] of [['contracts','7'],['contracts','0'],['floorPrice','1420'],['lowPrice','1250'],['steps','0']])assert.equal(ctx.setFutureRebuyField(f,key,value),false,`${key} ${value}`);
  assert.equal(JSON.stringify(f),before,'목표가 이미 판 4계약보다 작아지거나 잘못된 기준은 저장하지 않는다');
  assert.notEqual(ctx.setFutureRebuyField(f,'contracts','8'),false);assert.equal(ctx.futureRebuySummary(f).goal,4);
  assert.equal(ctx.futureRebuySummary(f).cuts.filter(c=>!c.done).reduce((n,c)=>n+c.qty,0),0);
  f.rebuy.currentPrice=1250;f.rebuy.stages=[{name:'25선',price:1260},{name:'25일선',price:1270}];
  const first=ctx.futureRebuySummary(f).tranches.find(x=>x.amount>0);assert.notEqual(ctx.setFutureBuyDone(f,first.i,first.t,true),false);
  const started=JSON.stringify(f);
  for(const [key,value] of [['lowPrice','1410'],['floorPrice','1280'],['contracts','20'],['steps','3']])assert.equal(ctx.setFutureRebuyField(f,key,value),false,'재매수 시작 뒤 손절 기준은 고정');
  assert.equal(JSON.stringify(f),started);assert.notEqual(ctx.setFutureRebuyField(f,'currentPrice','1260'),false);
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

test('부분 체결한 손절 회차는 남은 계약 알림을 이어 가고, 손절 목표를 줄여 남은 계약이 없으면 완료로 읽는다',()=>{
  const ctx=load(),f=futures({notify:{cuts:true}}),labels=()=>plain(ctx.buildTradeAlertRules({futures:f},null)).map(r=>r.label);
  assert.notEqual(ctx.setFutureCutDone(f,0,true),false);
  assert.deepEqual(labels(),['달러선물 손절 2회','달러선물 손절 3회']);
  assert.notEqual(ctx.setFutureCutQty(f,0,'2'),false);
  assert.deepEqual(plain(f.rebuy.cuts[0]),{contracts:2,price:1400,targetPrice:1400,partial:true,plannedQty:3});
  assert.deepEqual(labels(),['달러선물 손절 1회','달러선물 손절 2회','달러선물 손절 3회'],'남은 1계약이 있는 1회 알림을 이어 간다');
  assert.equal(ctx.futureRebuySummary(f).sold,2,'판 계약은 체결한 계약만');
  assert.notEqual(ctx.setFutureRebuyField(f,'contracts','4'),false);
  const c=ctx.futureCutPlan(f)[0];
  assert.deepEqual([c.qty,c.plannedQty,c.done,Object.hasOwn(c,'partial')],[2,2,true,false],'목표(2계약)를 다 팔았으면 남은 계약을 두지 않는다');
  assert.equal(f.rebuy.cuts[0].plannedQty,3,'읽기만으로 기록을 고치지 않는다');
});

test('손절 하단선(일·주·월선)은 보유 근월물 시세로 하단을 채우고 기록 없는 회차만 다시 나누며 직접 하단으로 되돌린다',()=>{
  const ctx=load(),fresh={positions:[],levels:[]},prices=s=>plain(s.cuts.map(c=>Math.round(c.price*100)/100));
  for(const v of ['25선','25시선','60분봉','0일선','401주선','abc'])assert.equal(ctx.setFutureRebuyField(fresh,'floorLine',v),false,v);
  assert.notEqual(ctx.setFutureRebuyField(fresh,'floorLine',''),false);assert.equal(fresh.rebuy,undefined,'선택 안 함 그대로면 기록을 만들지 않는다');
  const f=futures({contracts:20,sellPct:100,notify:{cuts:true}}),data={futures:f},rules=ma=>plain(ctx.buildTradeAlertRules({futures:f},quote(1340,ma)));
  assert.notEqual(ctx.setFutureRebuyField(f,'floorLine','20월선'),false);
  assert.equal(f.rebuy.floorLine,'20개월선','월선은 기존 이름 N개월선으로 저장');assert.equal(Object.hasOwn(f.rebuy,'floorPrice'),false,'새 선은 시세를 기다린다');
  assert.equal(ctx.futureRebuySummary(f).ready,false);assert.equal(ctx.futureCutPlan(f).length,0);assert.deepEqual(rules({}),[],'하단선 시세가 없으면 손절 알림도 없다');
  assert.equal(ctx.fillPrices(data,quote(1340,{'20개월선':1310.456})),true);
  assert.equal(f.rebuy.floorPrice,1310.46);assert.deepEqual(prices(ctx.futureRebuySummary(f)),[1400,1355.23,1310.46]);
  const first=rules({'20개월선':1310.456}),moved=rules({'20개월선':1320});
  assert.deepEqual(first.map(x=>x.id),['trade:future-rebuy:cut:0','trade:future-rebuy:cut:1','trade:future-rebuy:cut:2']);
  assert.equal(moved[2].targetPrice,1320);assert.deepEqual(moved.map(x=>x.revision),first.map(x=>x.revision),'하단선 시세만 움직이면 같은 알림 이력');
  assert.equal(JSON.parse(first[0].revision)[1],'20개월선');
  assert.notEqual(ctx.setFutureCutDone(f,0,true),false);assert.equal(f.rebuy.cuts[0].targetPrice,1400);
  ctx.fillPrices(data,quote(1340,{'20개월선':1320}));
  let s=ctx.futureRebuySummary(f);assert.deepEqual(prices(s),[1400,1360,1320],'체크한 회차는 그대로, 남은 회차만 새 하단으로');assert.deepEqual(plain(s.cuts.map(c=>c.qty)),[7,6,7]);
  // 직접 하단을 넣으면 하단선을 끄고 시세로 덮어쓰지 않는다. 같은 선을 다시 고르면 지난 자동 값과 같은 시세도 다시 채운다.
  assert.notEqual(ctx.setFutureRebuyField(f,'floorPrice','1290'),false);
  assert.equal(Object.hasOwn(f.rebuy,'floorLine'),false);assert.equal(Object.hasOwn(f.rebuy.auto,'floorPrice'),false);
  ctx.fillPrices(data,quote(1340,{'20개월선':1320}));assert.equal(f.rebuy.floorPrice,1290);
  assert.notEqual(ctx.setFutureRebuyField(f,'floorLine','20개월선'),false);assert.equal(Object.hasOwn(f.rebuy,'floorPrice'),false);
  ctx.fillPrices(data,quote(1340,{'20개월선':1320}));assert.equal(f.rebuy.floorPrice,1320);
  // 하단선을 끄면 마지막 하단을 직접 하단으로 남긴다.
  assert.notEqual(ctx.setFutureRebuyField(f,'floorLine',''),false);
  assert.equal(Object.hasOwn(f.rebuy,'floorLine'),false);assert.equal(f.rebuy.floorPrice,1320);
  ctx.fillPrices(data,quote(1340,{'20개월선':1330}));assert.equal(f.rebuy.floorPrice,1320);
  assert.equal(JSON.stringify(f.rebuy.cuts),JSON.stringify([{contracts:7,price:1400,targetPrice:1400}]),'손절 기록은 그대로');
});

test('하단선 시세가 신저점 이상이면 손절 회차·알림을 멈추고, 직접 하단의 알림 기준과 재매수 시작 뒤 잠금은 그대로다',()=>{
  const ctx=load(),f=futures({contracts:20,sellPct:100,notify:{cuts:true}}),q=quote(1340,{'60주선':1405});
  assert.notEqual(ctx.setFutureRebuyField(f,'floorLine','60주선'),false);ctx.fillPrices({futures:f},q);
  assert.equal(f.rebuy.floorPrice,1405);assert.equal(ctx.futureRebuySummary(f).ready,false);assert.deepEqual(plain(ctx.buildTradeAlertRules({futures:f},q)),[]);
  assert.equal(ctx.setFutureRebuyField(f,'lowPrice','1405'),false,'신저점은 하단선 시세보다 높아야 한다');
  assert.notEqual(ctx.setFutureRebuyField(f,'lowPrice','1450'),false);assert.equal(ctx.futureRebuySummary(f).ready,true);
  const direct=futures({notify:{cuts:true}}),rule=plain(ctx.buildTradeAlertRules({futures:direct},null))[0];
  assert.deepEqual(JSON.parse(rule.revision),[1400,1300,3,1],'직접 하단 기록의 알림 기준(이력)은 바뀌지 않는다');
  const bought=futures({stages:[{name:'25일선',price:1260,done:true,contracts:1,execPrice:1259.3}]});
  assert.equal(ctx.setFutureRebuyField(bought,'floorLine','60일선'),false);assert.equal(Object.hasOwn(bought.rebuy,'floorLine'),false);
});

test('재매수 회차를 체결해도 남은 회차의 환율·계약은 처음 계획 그대로다(종료 기준 유무 모두)',()=>{
  const ctx=load(),r=v=>Math.round(v*10)/10,line={'25선':1330,'32선':1340,'42선':1350,'60선':1360};
  const make=end=>{
    const f=futures({contracts:6,sellPct:50,steps:1,floorPrice:1355,stages:vm.runInContext('MA_LINES',ctx).map(name=>({name,price:line[name]||0,done:false,execPrice:null,shares:null}))});
    assert.notEqual(ctx.setFutureCutQty(f,0,'3'),false);
    return ctx.futureRebuyWithStart(f,'25선',null,end);
  };
  const open=f=>plain(ctx.futureRebuySummary(f).tranches.filter(x=>!x.done&&x.amount>0).map(x=>[r(x.price),x.amount]));
  const buy=(f,price)=>{const x=ctx.futureRebuySummary(f).tranches.find(y=>!y.done&&y.amount>0&&r(y.price)===price);assert.notEqual(ctx.setFutureBuyDone(f,x.i,x.t,true),false);};
  let f=make('1345');
  assert.deepEqual(open(f),[[1330,1],[1340,1],[1345,1]],'종료가 계획: 첫·끝 포함 고르게');
  buy(f,1330);assert.deepEqual(open(f),[[1340,1],[1345,1]],'다음 목표가 1,333.3으로 당겨지지 않는다');
  buy(f,1340);assert.deepEqual(open(f),[[1345,1]]);
  f=make('');
  assert.deepEqual(open(f),[[1333.3,1],[1340,1],[1350,1]],'평균 손절 환율 이하 회차에 고르게');
  buy(f,1333.3);assert.deepEqual(open(f),[[1340,1],[1350,1]]);
  buy(f,1340);assert.deepEqual(open(f),[[1350,1]],'마지막 목표가 1,343.3으로 내려오지 않는다');
});

test('손절로 보유를 모두 팔아도 마지막 손절 월물로 시세·알림을 이어 가고 셋째 월요일부터 다음 월물을 쓴다',()=>{
  const ctx=load(),f=futures({contracts:4,sellPct:100,steps:1,notify:{buys:true},cuts:[{contracts:4,price:1300,targetPrice:1300,month:'202611',settlementPrice:1450}],
    stages:vm.runInContext('MA_LINES',ctx).map(name=>({name,price:0,done:false,execPrice:null,shares:null}))});
  f.positions=[];
  const doc=(at,month)=>({updatedAt:at,stocks:{},futures:{[month]:{kind:'달러선물',asOf:'2026-11-13',close:1320,ma:{'25선':1330}}}});
  // 11월물 최종거래일은 셋째 월요일 2026-11-16(KST). 그 전날까지는 손절한 11월물.
  let d=doc('2026-11-15T14:59:00Z','202611');
  assert.equal(ctx.priceMonth(f,d),'202611');
  const data={futures:plain(f)};assert.equal(ctx.fillPrices(data,d),true);assert.equal(data.futures.rebuy.currentPrice,1320,'보유가 없어도 현재 환율을 채운다');
  let rules=plain(ctx.buildTradeAlertRules({futures:f},d));
  assert.ok(rules.length>0&&rules.every(x=>x.ticker==='202611'&&x.id.startsWith('trade:future-rebuy:buy:')),'보유가 없어도 재매수 알림이 나온다');
  d=doc('2026-11-15T15:00:00Z','202612');
  assert.equal(ctx.priceMonth(f,d),'202612','최종거래일 당일부터 다음 월물');
  rules=plain(ctx.buildTradeAlertRules({futures:f},d));assert.ok(rules.length>0&&rules.every(x=>x.ticker==='202612'));
  assert.equal(ctx.priceMonth(f,{updatedAt:'2026-12-21T00:00:00Z'}),'202701','12월물 셋째 월요일(12/21)부터 다음 해 1월물');
  assert.equal(ctx.priceMonth(f,null),'202611','시세 파일이 없으면 넘기지 않는다');
  assert.equal(ctx.priceMonth({...f,positions:[{month:'202612',contracts:1,settlementPrice:1400}]},{updatedAt:'2027-03-01T00:00:00Z'}),'202612','보유 월물이 있으면 그 월물');
  assert.equal(ctx.priceMonth({positions:[],rebuy:{}},d),'','손절 기록이 없으면 월물 없음');
});

test('재매수 부분 체결은 계획 계약까지 그 회차에 남기고, 다른 회차 배분과 남은 재매수 한도를 지킨다',()=>{
  const ctx=load(),r=v=>Math.round(v*10)/10,line={'25선':1330,'32선':1340,'42선':1350};
  const f=futures({contracts:24,sellPct:50,steps:1,floorPrice:1355,stages:vm.runInContext('MA_LINES',ctx).map(name=>({name,price:line[name]||0,done:false,execPrice:null,shares:null}))});
  assert.notEqual(ctx.setFutureCutQty(f,0,'12'),false);
  const open=()=>plain(ctx.futureRebuySummary(f).tranches.filter(x=>!x.done&&x.amount>0).map(x=>[r(x.price),x.amount,!!x.partial]));
  const first=open();assert.equal(first.reduce((n,x)=>n+x[1],0),12);
  const x=ctx.futureRebuySummary(f).tranches.find(y=>!y.done&&y.amount>=2);
  assert.notEqual(ctx.setFutureBuyDone(f,x.i,x.t,true),false);
  const planned=ctx.futureRebuySummary(f).tranches.find(y=>y.i===x.i&&y.t===x.t).qty;assert.ok(planned>=2);
  {
    assert.notEqual(ctx.setFutureBuyQty(f,x.i,x.t,String(planned-1)),false);
    const s=ctx.futureRebuySummary(f),p=s.tranches.find(y=>y.i===x.i&&y.t===x.t);
    assert.deepEqual([p.done,p.partial,p.qty,p.amount],[false,true,planned-1,1],'남은 1계약은 같은 회차');
    assert.deepEqual(open().filter(y=>!y[2]),first.filter(y=>y[0]!==r(x.price)),'다른 회차는 처음 계획 그대로');
    assert.equal(s.tranches.reduce((n,y)=>n+(y.done?0:y.amount),0),s.rest,'남은 재매수 계약을 모두 배분');
    const rule=plain(ctx.buildTradeAlertRules({futures:{...f,rebuy:{...f.rebuy,notify:{buys:true}}}},null)).find(y=>y.id===`trade:future-rebuy:buy:stage:${x.i}${x.t?`:${x.t+1}`:''}`);
    assert.ok(rule&&rule.targetPrice===p.price,'부분 체결 회차의 재매수 알림이 같은 id로 이어진다');
    assert.notEqual(ctx.setFutureBuyQty(f,x.i,x.t,String(planned)),false,'계획 이상으로 고치면 완료');
    assert.equal(Object.hasOwn(f.rebuy.stages[x.i].buys[x.t],'partial'),false);
  }
  assert.equal(ctx.setFutureBuyQty(f,x.i,x.t,'0'),false,'0계약은 체크 해제로');
  assert.equal(ctx.setFutureBuyQty(f,x.i,x.t,'99'),false,'판 계약 수를 넘기지 않는다');
});
