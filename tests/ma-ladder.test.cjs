const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const files=['ma-ladder.js','prices.js','assets-calc.js','rebuy.js','trade-alerts.js','futures.js'];
const source=files.map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({contractSize:10000,futuresDays:[25,32,42,60,80,125,150]});vm.runInContext(source,ctx);return ctx;};
const plain=v=>JSON.parse(JSON.stringify(v));
const level=(days,unit,price,contracts=3)=>({days,unit,price,contracts,tranches:Array.from({length:contracts},()=>({price,completed:false,executionPrice:null}))});
const plan=unit=>({targetPrice:1500,baselinePnl:0,positions:[{month:'202612',contracts:1,settlementPrice:1300}],notify:{levels:true},levels:[level(32,unit,1350),level(42,unit,1380,1)]});

for(const unit of ['선','일선','주선','개월선']){
  test(`${unit}: 1,350·1,360·1,370원과 다음 선 1,380원 도달 매수를 각각 만든다`,()=>{
    const ctx=load(),f=plan(unit),before=JSON.stringify(f);
    assert.deepEqual(plain(ctx.futureBuyPrices(f.levels,0)),[1350,1360,1370]);
    const rules=plain(ctx.buildTradeAlertRules({futures:f},null));
    assert.deepEqual(rules.map(x=>[x.targetPrice,x.condition]),[[1350,'up'],[1360,'up'],[1370,'up'],[1380,'up']]);
    assert.deepEqual(rules.map(x=>x.label),[`달러선물 32${unit}`,`달러선물 32${unit} 2차`,`달러선물 32${unit} 3차`,`달러선물 42${unit}`]);
    assert.equal(new Set(rules.map(x=>x.id)).size,4);
    assert.equal(JSON.stringify(f),before,'알림을 계산해도 저장된 기록은 바꾸지 않는다');
    ctx.refreshFutureBuyPrices(f);
    assert.deepEqual(f.levels.flatMap(l=>l.tranches.map(t=>t.price)),[1350,1360,1370,1380]);
    assert.equal(f.levels.reduce((n,l)=>n+l.tranches.length,0),4,'가격을 나눌 때 계약 수를 늘리지 않는다');
    f.levels[0].tranches.forEach(t=>{t.completed=true;t.executionPrice=t.price;});
    assert.deepEqual(plain(ctx.buildTradeAlertRules({futures:f},null)).map(x=>[x.targetPrice,x.label]),[[1380,`달러선물 42${unit}`]],'앞 구간 완료 후 다음 선 도달 매수만 남는다');
  });
}

test('가격은 기간 순서와 같은 시간축으로 연결하며 빈 다음 선을 건너뛰지 않는다',()=>{
  const ctx=load(),levels=[level(60,'일선',1450),level(32,'일선',1350),level(42,'일선',0),level(42,'주선',1400)];
  assert.deepEqual(plain(ctx.futureBuyPrices(levels,1)),[1350]);
  levels[2].price=1380;
  assert.deepEqual(plain(ctx.futureBuyPrices(levels,1)),[1350,1360,1370]);
  for(const bad of [0,1340,1350,NaN,Infinity]){levels[2].price=bad;assert.deepEqual(plain(ctx.futureBuyPrices(levels,1)),[1350]);}
  levels[1].price=0;assert.deepEqual(plain(ctx.futureBuyPrices(levels,1)),[]);
});

test('다음 선 시세만 바뀌어도 앞 구간 미매수 가격을 다시 계산하고 체결가·월물·수량은 보존한다',()=>{
  const ctx=load(),f=plan('일선'),q=price=>({updatedAt:`2026-10-07T0${price===1380?1:2}:00:00Z`,stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-07',close:1340,ma:{'32일선':1350,'42일선':price}}}});
  ctx.fillPrices({futures:f},q(1380));
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1349.9,mergedMonth:'202612'});
  ctx.fillPrices({futures:f},q(1410));
  assert.deepEqual(f.levels[0].tranches.map(t=>t.price),[1350,1370,1390]);
  assert.deepEqual([f.levels[0].tranches[0].executionPrice,f.levels[0].tranches[0].mergedMonth,f.levels[0].contracts],[1349.9,'202612',3]);
  assert.deepEqual(plain(ctx.buildTradeAlertRules({futures:f},q(1410))).map(x=>x.targetPrice),[1370,1390,1410]);
  assert.equal(ctx.fillPrices({futures:f},q(1380)),false,'오래된 시세는 가격을 되돌리지 않는다');
  assert.equal(f.levels[0].tranches[1].price,1370);
  const s=ctx.futuresSummary(f);
  assert.equal(s.remaining,(1500-1370+1500-1390+1500-1410)*10000,'예상 손익도 회차별 가격으로 계산한다');
});

test('선물 기간 추가는 기존 단계 순서·체결 기록·개별 알림 설정을 보존한다',()=>{
  const ctx=load(),f=plan('일선'),first=f.levels[0];first.notify=false;first.tranches[0].completed=true;
  ctx.ensureFutureMovingLines(f);ctx.ensureFutureMovingLines(f);
  assert.equal(f.levels.length,28);assert.equal(f.levels[0],first);assert.equal(first.notify,false);assert.equal(first.tranches[0].completed,true);
  assert.equal(f.levels.filter(l=>ctx.futureLineName(l)==='32일선').length,1);
  assert.ok(f.levels.some(l=>ctx.futureLineName(l)==='150개월선'));
});

test('직접 바꾼 앞·뒤 기준가는 알림 이력을 바꾸지만 자동 시세 갱신은 같은 이력을 쓴다',()=>{
  const ctx=load(),f=plan('일선'),rules=()=>plain(ctx.buildTradeAlertRules({futures:f},null));
  const first=rules();f.levels[1].price=1410;
  const edited=rules();assert.notEqual(first[1].revision,edited[1].revision);
  assert.equal(first[0].revision,edited[0].revision,'다음 선 변경은 시작선 도달 매수 기준을 바꾸지 않는다');
  f.auto={'32일선':1350,'42일선':1410};const marked=rules();
  f.levels[0].price=f.auto['32일선']=1360;f.levels[1].price=f.auto['42일선']=1420;
  const later=rules();assert.deepEqual(marked.map(x=>x.revision),later.map(x=>x.revision));
});

test('기존 재매수 단계에 빠진 시간축을 추가해도 단계 순서와 고정 계획·체결 객체를 보존한다',()=>{
  const ctx=load(),record={name:'32일선',price:1350,buys:[{shares:2,price:1349.9}]},stages=[record,{name:'42일선',price:1380}];
  const expanded=ctx.completeMovingStages(stages);
  assert.equal(expanded.length,28);assert.equal(expanded[0],record);assert.equal(expanded[1],stages[1]);
  assert.equal(ctx.completeMovingStages(expanded).length,28);
  const frozen={stages:expanded,planned:[['32일선',0],['42일선',0]]};
  assert.deepEqual(plain(ctx.storedPlan(frozen,expanded)),[[0,0],[1,0]]);
  assert.deepEqual(record.buys,[{shares:2,price:1349.9}]);
});

test('계약 수 변경은 체결 회차를 보존하고 미매수 계약을 세 가격에 다시 배분한다',()=>{
  const ctx=load(),f=plan('일선');ctx.refreshFutureBuyPrices(f);
  Object.assign(f.levels[0].tranches[1],{completed:true,executionPrice:1359.9,mergedMonth:'202612'});
  ctx.resizeTranches(f.levels[0],4);ctx.refreshFutureBuyPrices(f);
  assert.equal(f.levels[0].tranches[1].slot,1);
  assert.equal(f.levels[0].tranches[1].executionPrice,1359.9);
  ctx.resizeTranches(f.levels[0],2);ctx.refreshFutureBuyPrices(f);
  assert.equal(f.levels[0].tranches.length,2);assert.equal(f.levels[0].tranches[1].completed,true);
  const pending=plan('일선');ctx.resizeTranches(pending.levels[0],6);ctx.refreshFutureBuyPrices(pending);
  ctx.resizeTranches(pending.levels[0],3);ctx.refreshFutureBuyPrices(pending);
  assert.deepEqual(pending.levels[0].tranches.map(t=>t.price),[1350,1360,1370],'6계약을 3계약으로 줄여도 한 가격에 몰리지 않는다');
});

test('분할매수는 네 시간축 모두 A 방식이며 월선·시선 이름과 중복을 정규화한다',()=>{
  const ctx=load();
  for(const unit of ['선','일선','주선','개월선']){
    const names=[`32${unit}`,`42${unit}`],lines={names,end:1380,budget:400},entry={ma:{[names[0]]:1350,[names[1]]:1380}};
    const rows=plain(ctx.purchaseLineRows({lines},entry));
    assert.deepEqual(rows.map(r=>[r.price,r.amount]),[[1350,100],[1360,100],[1370,100],[1380,100]]);
    assert.equal(rows.at(-1).key,'end','목표가가 다음 선과 같아도 가격을 중복하지 않는다');
  }
  const names=vm.runInContext('purchaseLineNames({names:["32시선","32선","42월선","42개월선","0선","401주선"]})',ctx);
  assert.deepEqual(plain(names),['32선','42개월선']);
  assert.equal(vm.runInContext('PURCHASE_LINES.length',ctx),28);
});

test('ETF와 달러선물 재매수도 도달 가격을 이전 구간에 넣지 않고 매도한 금액·계약 한도를 지킨다',()=>{
  const ctx=load();
  for(const unit of ['선','일선','주선','개월선']){
    const stages=[{name:`32${unit}`,price:1350},{name:`42${unit}`,price:1380}];
    const stock={ticker:'900001',lowPrice:1400,shares:10,cuts:[{shares:4,price:1400}],stages};
    const s=ctx.rebuySummary(stock);
    assert.deepEqual(plain(s.tranches).map(x=>[x.price,x.amount]),[[1350,1400],[1360,1400],[1370,1400],[1380,1400]]);
    const f={positions:[],rebuy:{lowPrice:1400,floorPrice:1300,contracts:10,cuts:[{contracts:4,price:1400}],stages}};
    assert.deepEqual(plain(ctx.futureRebuySummary(f).tranches).map(x=>[x.price,x.amount]),[[1350,1],[1360,1],[1370,1],[1380,1]]);
  }
});
