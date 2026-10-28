// 모두 가상 환율·계약. 직접 분할의 수량 한도·도달 방향·기존 체결·동기화·서버 알림 계약을 검증한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=['ma-ladder.js','prices.js','rebuy.js','trade-alerts.js','futures.js','futures-plan.js','futures-rebuy.js','data-validation.js'].map(n=>fs.readFileSync(path.join(__dirname,'../js',n),'utf8')).join('\n;\n');
const load=()=>{const c=vm.createContext({contractSize:10000});vm.runInContext(source,c);return c;};
const plain=x=>JSON.parse(JSON.stringify(x));
const fixture=()=>({positions:[{month:'202612',contracts:10,settlementPrice:1450}],levels:[],baselinePnl:-5000000,rebuy:{lowPrice:1500,floorPrice:1480,contracts:20,sellPct:100,steps:2,currentPrice:1440,cuts:[{contracts:10,price:1500,targetPrice:1500,month:'202612',settlementPrice:1450}],stages:[{name:'25선',price:1380},{name:'32선',price:1390},{name:'25일선',price:1410}],notify:{cuts:true,buys:true}}});
const config=(condition='up',extra={})=>({startPrice:condition==='up'?1445:1435,endPrice:condition==='up'?1455:1415,rounds:3,contracts:6,condition,...extra});
const pending=s=>s.tranches.filter(x=>!x.done&&x.amount>0);
const rules=(c,f,quiet=false)=>plain(c.buildTradeAlertRules({futures:f},null,quiet)).filter(x=>x.id.includes(':buy:'));

test('손절 평균가 이하에서 직접 환율·횟수·일부 계약만 배분하고 원본·기존 알림 키를 보존한다',()=>{
  const c=load(),f=fixture(),snapshot=JSON.stringify(f),g=c.futureRebuyWithDirect(f,config()),s=c.futureRebuySummary(g);
  assert.equal(JSON.stringify(f),snapshot);assert.deepEqual(plain(g.rebuy.stages.slice(0,3)),f.rebuy.stages);
  assert.equal(s.sellAvg,1500);assert.deepEqual(plain(pending(s).map(x=>[x.price,x.amount])),[[1445,2],[1450,2],[1455,2]]);
  assert.deepEqual([s.rest,s.directRest,s.unplannedRest],[10,6,4]);
  assert.equal(c.futureBuyDue(s,1444.99),null);assert.equal(c.futureBuyDue(s,1445).price,1445);
  assert.deepEqual(rules(c,g).map(x=>[x.label,x.targetPrice,x.condition]),[['달러선물 재매수 1단계',1445,'up'],['달러선물 재매수 2단계',1450,'up'],['달러선물 재매수 3단계',1455,'up']]);
  assert.deepEqual(plain(g.rebuy.notify),f.rebuy.notify);
});

test('하락 도달·부분 체결·계약 수정·해제는 보유에 반영하고 이번 계획 한도를 넘지 않는다',()=>{
  const c=load(),g=c.futureRebuyWithDirect(fixture(),config('down')),s=c.futureRebuySummary(g),first=pending(s)[0];
  assert.equal(c.futureBuyDue(s,1435.01),null);assert.equal(c.futureBuyDue(s,1435).price,1435);
  assert.deepEqual(rules(c,g).map(x=>[x.targetPrice,x.condition]),[[1435,'down'],[1425,'down'],[1415,'down']]);
  assert.equal(c.setFutureBuyChecked(g,first.i,0,true),true);assert.equal(g.positions[0].contracts,12);assert.equal(g.positions[0].settlementPrice,(1450*10+1435*2)/12);
  assert.notEqual(c.setFutureBuyCount(g,first.i,0,'1'),false);
  let view=c.futureRebuySummary(g),part=view.tranches.find(x=>x.i===first.i);assert.deepEqual([part.partial,part.qty,part.amount],[true,1,1]);
  assert.equal(c.setFutureBuyCount(g,first.i,0,'7'),false,'전체 미복원 수량 안이어도 이번 계획의 6계약 한도를 넘지 않는다');
  assert.equal(c.setFutureBuyChecked(g,first.i,0,true),true);
  for(const x of pending(c.futureRebuySummary(g)))assert.equal(c.setFutureBuyChecked(g,x.i,x.t,true),true);
  view=c.futureRebuySummary(g);assert.deepEqual([view.rebought,view.rest,view.directRest,view.unplannedRest],[6,4,0,4]);
  assert.equal(g.positions[0].contracts,16);assert.equal(g.baselinePnl,-5000000);assert.deepEqual(rules(c,g,true),[],'계획이 끝나면 나머지는 대기로 남고 재매수 알림이 없다');
  assert.equal(c.futureBuyDue(view,1200),null);assert.ok(c.buildTradeAlertRules({futures:g},null).some(x=>x.label==='달러선물 손절 2회'));
  assert.notEqual(c.setFutureBuyChecked(g,first.i,0,false),false);view=c.futureRebuySummary(g);assert.deepEqual([view.rebought,view.directRest],[4,2]);assert.equal(g.positions[0].contracts,14);
});

test('기존 재매수·부분 체결 뒤 계획을 바꿔도 체결·보유·정산손익은 보존하며 남은 계약만 새로 배분한다',()=>{
  const c=load(),f=fixture();f.rebuy.stages[0].buys=[{contracts:2,price:1380,month:'202612'}];f.positions[0].contracts=12;
  const records=JSON.stringify([f.rebuy.cuts,f.rebuy.stages]),settings=JSON.stringify({...f,rebuy:undefined});
  let g=c.futureRebuyWithDirect(f,config('down')),first=pending(c.futureRebuySummary(g))[0];
  assert.equal(JSON.stringify(g.rebuy.stages.slice(0,3)),JSON.stringify(f.rebuy.stages));assert.equal(JSON.stringify({...g,rebuy:undefined}),settings);
  c.setFutureBuyChecked(g,first.i,0,true);c.setFutureBuyCount(g,first.i,0,'1');
  const filled=JSON.stringify(g.rebuy.stages[first.i]),holdings=JSON.stringify([g.positions,g.baselinePnl]),h=c.futureRebuyWithDirect(g,config('up',{contracts:4,rounds:2,startPrice:1460,endPrice:1470})),s=c.futureRebuySummary(h);
  assert.equal(JSON.stringify(h.rebuy.stages[first.i]),filled);assert.equal(JSON.stringify([h.positions,h.baselinePnl]),holdings);
  assert.deepEqual([s.rebought,s.rest,s.directRest,s.unplannedRest],[3,7,4,3]);
  assert.deepEqual(plain(pending(s).map(x=>[x.price,x.amount])),[[1460,2],[1470,2]]);
  assert.ok(s.tranches.some(x=>x.i===first.i&&x.done&&x.qty===1),'이전 계획의 부분 체결은 실제 체결만 완료 내역에 남긴다');
  assert.equal(JSON.stringify([f.rebuy.cuts,f.rebuy.stages]),records);
  const average=c.futureRebuyWithStart(h,'25선',null,'1450');assert.equal(average.rebuy.directPlan,undefined);
  assert.equal(JSON.stringify(average.rebuy.stages[first.i]),filled);assert.ok(pending(c.futureRebuySummary(average)).every(x=>!average.rebuy.stages[x.i].directRebuy));
});

test('새 손절로 미복원 계약이 늘어도 직접 계획 수량·가격·이력과 개별 알림 선택은 고정한다',()=>{
  const c=load(),g=c.futureRebuyWithDirect(fixture(),config()),first=pending(c.futureRebuySummary(g))[0];
  c.setFutureBuyChecked(g,first.i,0,true);const before=rules(c,g);
  assert.equal(c.setFutureCutChecked(g,1,true),true);
  const s=c.futureRebuySummary(g);assert.deepEqual([s.sold,s.rest,s.directRest,s.unplannedRest],[20,18,4,14]);assert.deepEqual(rules(c,g),before);
  const next=pending(s)[0];g.rebuy.notify.buysOverrides={[`stage:${next.i}`]:false};
  assert.equal(rules(c,g).length,1);assert.equal(rules(c,g,true).filter(x=>x.notify===false).length,1);
});

test('평균 손절가 위 직접 회차는 저장해도 배분·도달·알림에서 빼고 다른 회차로 다시 나누지 않는다',()=>{
  const c=load(),f=fixture(),g=c.futureRebuyWithDirect(f,config('up',{startPrice:1490,endPrice:1520,rounds:4,contracts:8}));
  let s=c.futureRebuySummary(g);
  assert.equal(s.sellAvg,1500);assert.deepEqual(plain(pending(s).map(x=>[x.price,x.amount])),[[1490,2],[1500,2]],'평균 손절가와 같은 회차까지만 산다');
  assert.deepEqual(plain(s.tranches.filter(x=>x.above).map(x=>[x.price,x.amount,x.done])),[[1510,0,false],[1520,0,false]]);
  assert.deepEqual([s.rest,s.directRest,s.above,s.unplannedRest],[10,4,4,2]);
  assert.equal(c.futureBuyDue(s,1530).price,1490);assert.equal(c.futureBuyDue({tranches:s.tranches.filter(x=>x.above)},1530),null);
  assert.deepEqual(rules(c,g).map(x=>x.targetPrice),[1490,1500]);
  const above=s.tranches.find(x=>x.price===1510);assert.equal(c.setFutureBuyChecked(g,above.i,0,true),false,'제외 회차는 체크할 수 없다');
  // 1,500원 회차를 1계약만 산 뒤 더 낮은 손절로 평균 손절가가 1,490원이 되면 남은 1계약은 사지 않고 체결분만 완료로 읽는다.
  const at=pending(s).find(x=>x.price===1500);c.setFutureBuyChecked(g,at.i,0,true);c.setFutureBuyCount(g,at.i,0,'1');
  assert.equal(c.setFutureCutChecked(g,1,true),true);
  const before=JSON.stringify(g);s=c.futureRebuySummary(g);assert.equal(JSON.stringify(g),before,'읽기는 기록을 바꾸지 않는다');
  assert.equal(s.sellAvg,1490);assert.equal(g.rebuy.stages[at.i].buys[0].partial,true);
  const part=s.tranches.find(x=>x.i===at.i);assert.deepEqual([part.done,part.qty,part.amount,Object.hasOwn(part,'partial')],[true,1,1,false]);
  assert.deepEqual(plain(pending(s).map(x=>[x.price,x.amount])),[[1490,2]]);
  assert.deepEqual([s.rest,s.directRest,s.above,s.unplannedRest],[19,2,5,12]);
  assert.deepEqual(rules(c,g).map(x=>x.targetPrice),[1490]);
});

test('범위 밖 입력은 원본을 바꾸지 않고 거절하며 1회와 소수 환율을 처리한다',()=>{
  const c=load(),f=fixture(),snapshot=JSON.stringify(f);
  for(const extra of [{contracts:11},{contracts:2},{rounds:0},{rounds:61},{rounds:2.5},{contracts:2.5},{startPrice:0},{startPrice:'NaN'},{condition:'bad'},{endPrice:1400}])assert.equal(c.futureRebuyWithDirect(f,config('up',extra)),null);
  const g=c.futureRebuyWithDirect(f,config('up',{rounds:1,contracts:1,startPrice:1445.25,endPrice:1455.25}));assert.deepEqual(plain(pending(c.futureRebuySummary(g)).map(x=>[x.price,x.amount])),[[1445.25,1]]);
  const full=fixture();full.rebuy.stages=Array.from({length:80},(_,i)=>({name:`${i+1}일선`,price:1400}));assert.equal(c.futureRebuyWithDirect(full,config()),null);
  assert.equal(JSON.stringify(f),snapshot);
});

test('백업·동기화·시세 갱신은 직접 설정·고정 환율·체결을 보존하고 읽을 때 필드를 만들지 않는다',()=>{
  const c=load(),g=c.futureRebuyWithDirect(fixture(),config('down')),data={plans:[],futures:g,actions:{}},saved=JSON.stringify(data);
  c.data=data;vm.runInContext('externalData.planner(data)',c);assert.equal(JSON.stringify(data),saved);
  const restored=JSON.parse(saved),prior=JSON.stringify(restored.futures.rebuy.directPlan);c.futureRebuySummary(restored.futures);assert.equal(JSON.stringify(restored),saved);
  const prices={updatedAt:'2026-10-27T01:00:00Z',stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-27',close:1448,ma:{'25선':1405}}}};
  c.fillPrices(restored,prices);assert.equal(restored.futures.rebuy.currentPrice,1448);assert.equal(JSON.stringify(restored.futures.rebuy.directPlan),prior);
  assert.deepEqual(plain(pending(c.futureRebuySummary(restored.futures)).map(x=>x.price)),[1435,1425,1415]);
  for(const [key,value] of [['names',{}],['condition','bad'],['rounds',61],['contracts',[]],['startPrice',{}]]){const bad=JSON.parse(saved);bad.futures.rebuy.directPlan[key]=value;c.data=bad;assert.throws(()=>vm.runInContext('externalData.planner(data)',c),/directPlan/);}
  const old=fixture(),before=JSON.stringify(old);c.futureRebuySummary(old);assert.equal(JSON.stringify(old),before);assert.equal(old.rebuy.directPlan,undefined);
});
