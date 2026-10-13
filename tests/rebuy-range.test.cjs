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

for(const rounds of [1,2,3])test(`25선~150주선 범위라도 시작선이 손절가 위면 25선의 지정 ${rounds}회차에만 전액 배분한다`,()=>{
  const ctx=load(),r=fixture(),names=plain(vm.runInContext('MA_LINES.filter(n=>movingLineUnit(n)!=="개월선")',ctx));
  r.stages=names.map((name,i)=>({name,price:11000+i*300}));
  r.range={startLine:'25선',lastLine:'150주선',names,lastRound:rounds,targetPct:100};
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),Array.from({length:rounds},(_,t)=>['25선',t]));
  assert.ok(s.tranches.every(x=>x.i===0&&Math.abs(x.amount-s.sellValue/rounds)<1e-6));
  assert.ok(s.plan.slice(1).every(x=>x===0));assert.equal(s.tranches.reduce((n,x)=>n+x.amount,0),s.sellValue);
  assert.deepEqual(plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null)).map(x=>x.targetPrice),Array.from({length:rounds},(_,t)=>11000+t*100));
  assert.equal(ctx.rebuyBuyRecord(r,1,0,'1',true),false);assert.equal(JSON.stringify(r),before);
  for(let t=0;t<rounds;t++){
    const view=ctx.rebuySummary(r),tr=view.tranches.find(x=>x.t===t),record=ctx.rebuyBuyRecord(r,0,t,String(ctx.rebuyPendingShares(tr.amount,tr.price)),true);
    assert.notEqual(record,false);r.planned=plain(view.planKeys);(r.stages[0].buys??=[])[t]=plain(record);
    assert.deepEqual(plain(ctx.rebuySummary(JSON.parse(JSON.stringify(r))).planKeys),Array.from({length:rounds},(_,t)=>['25선',t]));
  }
  const final=ctx.rebuySummary(r);assert.equal(final.doneTranches,rounds);assert.equal(final.tranches.length,rounds);
  assert.equal(ctx.rebuyStatus(r,final)[0],'재매수 완료');assert.equal(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null).length,0);
  assert.equal(r.range.lastLine,'150주선');assert.equal(r.stages.length,names.length);
});

test('넓은 범위의 실제 종료선은 손절가 이하 마지막 선이며 그 선의 후속 회차는 손절가 위에서도 유지한다',()=>{
  const ctx=load(),r=fixture();r.stages.push({name:'25주선',price:9500},{name:'150주선',price:10000});
  r.range={startLine:'60선',lastLine:'150주선',names:r.stages.map(x=>x.name),lastRound:3,targetPct:100};
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),[['60선',0],['60선',1],['60선',2],['80선',0],['80선',1],['80선',2]]);
  assert.ok(s.tranches.filter(x=>x.i===1).slice(1).every(x=>x.price>s.sellAvg&&x.amount>0));
  assert.ok(s.plan.slice(2).every(x=>x===0),'손절가 위 125선 뒤 가격이 다시 낮아져도 범위를 재개하지 않는다');
  assert.equal(JSON.stringify(r),before);
});

test('저장된 배열 순서와 무관하게 지정 범위의 순서로 종료선을 고르고 마지막 2회차까지 유지한다',()=>{
  const ctx=load(),r=fixture();r.stages=[r.stages[2],r.stages[1],r.stages[0]];
  r.range={startLine:'60선',lastLine:'125선',names:['60선','80선','125선'],lastRound:2,targetPct:100};
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),[['60선',0],['60선',1],['60선',2],['80선',0],['80선',1]]);
  assert.equal(s.plan[0],0);assert.deepEqual(plain(s.tranches).filter(x=>x.i===1).map(x=>x.price),[10000,11000]);
  assert.equal(JSON.stringify(r),before);
});

test('비운 기준가에서 범위를 멈추고 추정 가격 뒤의 알려진 선까지 확대하지 않는다',()=>{
  const ctx=load(),r=fixture();r.stages[1].price=0;r.stages[2].price=10000;
  r.range={startLine:'60선',lastLine:'125선',names:r.stages.map(x=>x.name),lastRound:3,targetPct:100};
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),[['60선',0],['60선',1],['60선',2]]);
  assert.ok(s.plan.slice(1).every(x=>x===0));assert.equal(ctx.rebuyBuyRecord(r,0,1,'1',true),false);
  assert.deepEqual(plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null)).map(x=>x.targetPrice),[9000]);
  assert.equal(JSON.stringify(r),before);
});

test('이전 넓은 계획과 범위 밖 실제·부분 체결은 보존하되 새 회차는 시작선에만 배분한다',()=>{
  const ctx=load(),r=fixture(12000);r.stages[0]={name:'25선',price:11000,buys:[{shares:3,price:11000}]};
  r.stages[1].buys=[{shares:2,price:12000,partial:true,plannedShares:5}];
  r.stages[2].buys=[{shares:1,price:15000}];
  r.range={startLine:'25선',lastLine:'125선',names:r.stages.map(x=>x.name),lastRound:3,targetPct:100};
  r.planned=r.stages.flatMap(st=>[0,1,2].map(t=>[st.name,t]));
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),[['25선',0],['25선',1],['25선',2]]);
  assert.ok(s.tranches.filter(x=>!x.done&&!x.partial).every(x=>x.i===0));
  const partial=s.tranches.find(x=>x.i===1);assert.equal(partial.qty,2);assert.equal(partial.plannedQty,5);assert.equal(partial.amount,36000);
  assert.equal(s.tranches.find(x=>x.i===2).qty,1);assert.equal(s.sellAvg,10100);assert.equal(JSON.stringify(r),before);
});

test('실제 매수 입력 때 고정한 종료선은 시세가 움직여도 후속 회차를 유지하고 마지막 체결 취소 때만 지운다',()=>{
  const ctx=load(),r=fixture();r.range={startLine:'60선',lastLine:'125선',names:r.stages.map(x=>x.name),lastRound:3,targetPct:100};
  Object.assign(ctx,{state:{rebuy:{items:[r]},selectedRebuy:r.id},save(){},renderRebuy(){}});
  const before=JSON.stringify(r);ctx.rebuySummary(r);assert.equal(JSON.stringify(r),before);assert.equal(r.plannedEndLine,undefined);
  const view=ctx.rebuySummary(r),tr=view.tranches.find(x=>x.i===1&&x.t===0),record=ctx.rebuyBuyRecord(r,1,0,String(ctx.rebuyPendingShares(tr.amount,tr.price)),true);
  ctx.applyRebuyBuy(1,0,record);assert.equal(r.plannedEndLine,'80선');
  r.stages[1].price=11000;r.stages[1].prices=[null,11600,12200];r.stages[2].price=9500;
  const saved=JSON.stringify(r),restored=JSON.parse(saved),s=ctx.rebuySummary(restored);
  assert.deepEqual(plain(s.planKeys).filter(([name])=>name==='80선'),[['80선',0],['80선',1],['80선',2]]);
  assert.ok(s.tranches.filter(x=>x.i===1&&!x.done).every(x=>x.amount>0&&x.price>s.sellAvg));assert.equal(s.plan[2],0);
  assert.equal(JSON.stringify(restored),saved);ctx.applyRebuyBuy(1,0,null);
  assert.equal(Object.hasOwn(r,'plannedEndLine'),false);assert.equal(Object.hasOwn(r,'planned'),false);
});

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
