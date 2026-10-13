const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder.js','prices.js','rebuy.js','trade-alerts.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({});vm.runInContext(source,ctx);Object.assign(ctx,vm.runInContext('({rebuyPendingShares})',ctx));return ctx;};
const plain=v=>JSON.parse(JSON.stringify(v));
const fixture=(price=10000,unit='선')=>({id:'range-test',name:'가상 ETF',ticker:'900001',shares:200,lowPrice:11000,currentPrice:9500,cuts:[{shares:100,price:10100}],notify:{buys:true},
  stages:[{name:`60${unit}`,price:9000},{name:`80${unit}`,price},{name:`125${unit}`,price:price+3000}],
  range:{startLine:`80${unit}`,lastLine:`80${unit}`,names:[`80${unit}`],lastRound:3,targetPct:100}});

for(const price of [10000,11000])test(`80선 1회차가 손절가 ${price>10100?'위':'아래'}여도 3회차까지 배분하고 125선은 계산에만 쓴다`,()=>{
  const ctx=load(),r=fixture(price),before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.equal(s.sellAvg,10100);assert.deepEqual(plain(s.planKeys),[['80선',0],['80선',1],['80선',2]]);
  assert.deepEqual(plain(s.tranches).map(x=>x.price),[price,price+1000,price+2000]);
  assert.ok(s.tranches.every(x=>x.amount>0));assert.equal(s.plan[0],0);assert.equal(s.plan[2],0);
  assert.ok(s.tranches[2].price>s.sellAvg);assert.equal(ctx.rebuyBuyRecord(r,2,0,'1',true),false);
  assert.deepEqual(plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null)).map(x=>x.targetPrice),[price,price+1000,price+2000]);
  assert.equal(JSON.stringify(r),before,'조회·알림은 범위 밖 평균선 가격과 기록을 지우거나 저장하지 않는다');
});

test('범위를 따로 저장하지 않은 기존 설정도 80선 뒤 손절가 위 125선에 새 수량을 배정하지 않는다',()=>{
  const ctx=load(),r=fixture();delete r.range;const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),[['60선',0],['60선',1],['60선',2],['80선',0],['80선',1],['80선',2]]);
  assert.equal(s.plan[2],0);assert.equal(JSON.stringify(r),before);
});

test('이전 넓어진 고정 계획이 있어도 명시한 60~80선 범위만 새 회차에 배분하며 이미 산 125선 기록은 보존한다',()=>{
  const ctx=load(),r=fixture();r.range.startLine='60선';r.range.names=['60선','80선'];
  r.stages[0].buys=[{shares:2,price:9000}];r.stages[2].buys=[{shares:1,price:13000}];
  r.planned=[['60선',0],['80선',0],['125선',0],['125선',1]];
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.ok(s.planKeys.every(([name])=>name!=='125선'));
  assert.deepEqual(plain(s.tranches).filter(x=>x.i===2).map(x=>[x.t,x.done,x.qty]),[[0,true,1]]);
  assert.ok(s.tranches.filter(x=>!x.done).every(x=>x.i<2));assert.equal(JSON.stringify(r),before);
});

test('마지막 80선 3회차를 다 사도 남은 금액을 125선에 자동 배정하지 않는다',()=>{
  const ctx=load(),r=fixture();r.stages[1].buys=[{shares:1,price:10000},{shares:1,price:11000},{shares:1,price:12000}];
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.ok(s.rest>0);assert.equal(s.doneTranches,3);assert.equal(s.tranches.length,3);assert.equal(s.plan[2],0);
  assert.equal(ctx.rebuyStatus(r,s)[0],'재매수 완료');assert.equal(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null).length,0);
  assert.equal(JSON.stringify(r),before);
});

for(const unit of ['선','일선','주선','개월선'])test(`${unit} 범위와 마지막 회차는 저장·복원 후에도 적용하며 분할매수와 같은 경계 계산을 사용한다`,()=>{
  const ctx=load(),r=fixture(10000,unit);r.range.lastRound=2;
  assert.deepEqual(plain(ctx.movingLineRange([`25${unit}`,`60${unit}`,`80${unit}`,`125${unit}`],`60${unit}`,`80${unit}`)),[`60${unit}`,`80${unit}`]);
  const restored=JSON.parse(JSON.stringify(r));assert.deepEqual(plain(ctx.rebuySummary(restored).planKeys),[[`80${unit}`,0],[`80${unit}`,1]]);
  assert.deepEqual(plain(ctx.movingLineRange([`60${unit}`,`80${unit}`],`80${unit}`,`60${unit}`)),[]);
  assert.equal(ctx.rebuySummary(restored).plan[2],0);
});

test('기간 목록에 없는 70선 경계도 추가하고 범위 밖 80선 가격만 회차 계산용으로 사용한다',()=>{
  const ctx=load(),r=fixture();r.stages.unshift({name:'70선',price:9800});r.range={startLine:'70선',lastLine:'70선',names:['70선'],lastRound:3,targetPct:100};
  const s=ctx.rebuySummary(r);assert.deepEqual(plain(s.tranches).map(x=>Math.round(x.price)),[9800,9867,9933]);
  assert.equal(s.plan[2],0);assert.equal(s.plan[3],0);
});

test('한 주보다 작은 배분에 1주를 강제 생성하지 않고 기존 실제 체결은 보존한다',()=>{
  const ctx=load(),r=fixture();r.cuts=[{shares:1,price:10000}];const s=ctx.rebuySummary(r);
  assert.ok(s.tranches.every(x=>ctx.rebuyPendingShares(x.amount,x.price)===0));assert.equal(ctx.rebuyBuyRecord(r,1,0,'1',true),false);
  r.stages[1].buys=[{shares:1,price:10000}];assert.equal(ctx.rebuySummary(r).tranches[0].qty,1);
});

test('재매수 비중은 손절 금액에만 적용하고 평균 손절가·체결·손절 기록은 변경하지 않는다',()=>{
  const ctx=load(),r=fixture();r.range.targetPct=50;const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.equal(s.sellValue,1010000);assert.equal(s.buyTarget,505000);assert.equal(s.rest,505000);assert.equal(s.sellAvg,10100);
  assert.ok(Math.abs(s.tranches.reduce((n,x)=>n+x.amount,0)-505000)<1e-6);assert.equal(JSON.stringify(r),before);
});

test('범위 입력은 역전·잘못된 기간·회차·비중을 거절한다',()=>{
  const ctx=load(),r=fixture();assert.equal(ctx.rebuyRangeDraftError(r.range,r.stages),'');
  for(const edit of [{startLine:'125선'},{lastLine:'401선'},{lastLine:'0선'},{lastRound:4},{lastRound:1.5},{targetPct:0},{targetPct:101}])assert.ok(ctx.rebuyRangeDraftError({...r.range,...edit},r.stages));
});
