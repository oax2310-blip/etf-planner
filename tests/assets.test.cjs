const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// js/assets-calc.js를 화면 없이 불러온다(숫자는 모두 테스트용 가짜 값)
// 같은 realm에서 함수 안에 불러 맨 위 이름이 전역으로 새지 않게 한다(deepEqual이 배열·객체를 그대로 비교하도록)
const c = vm.runInThisContext(`(function(){${fs.readFileSync(path.join(__dirname, '../js/ma-ladder.js'), 'utf8')}\n;\n${fs.readFileSync(path.join(__dirname, '../js/assets-calc.js'), 'utf8')}
return {parseAssetNumber,assetNumberText,assetDividendFx,pnlDollarKrw,pnlDollarFx,pnlEntriesTotal,monthPnl,ledgerAccounts,averageYearReturn,parseAllocationTotal,allocationTotalText,itemValue,fillBases,resetBase,cashValue,allocationTargets,allocationSummary,allocationHoldingInfo,allocationHoldingTotal,purchaseAllocationSummary,purchaseTargets,purchaseBudget,purchaseAutoBudget,syncPurchaseTargets,linkedAllocationTarget,purchaseSummary,purchaseLineLevels,purchaseLineRows,purchaseFill,purchaseTrackingFill,assetTradeQuote,purchaseDirection,purchaseAlertRules,purchaseQuoteKind,monthTotals,yearSummary,simulateSavings,savingsMilestone,earlierSavingsRecord,setSavingsActual,savingsStage,cleanAssets,mergeAssets,assetsBlank,ymNum,ymText,missingActual,linkTicker,linkedItems,linkSummary,tradeRows,applyTrade,revertTrade,rescaleTrade};})()`);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
test('매수·매도 보유 표시의 평가액·비중·소수 수량은 자산현황 기준이며 시세·환율 대기와 금액·0주 보유를 구분한다',()=>{
  const item={id:'a',ticker:'AAA',tradeTicker:'111111',shares:.125},dollar={id:'b',ticker:'AAA',shares:2},amount={id:'c',ticker:'111111',amount:10},zero={id:'d',ticker:'111111',shares:0,amount:99};
  const alloc={total:100,groups:[{id:'g',items:[item,dollar,amount,zero]}]},p={stocks:{'111111':{kind:'국내',close:10000,asOf:'2026-01-02'},AAA:{kind:'해외',close:50,asOf:'2026-01-02'}},fx:{close:1200}},before=JSON.stringify([alloc,p]);
  let s=c.allocationSummary(alloc,p),info=c.allocationHoldingInfo(item,s);assert.equal(info.value,.125);assert.equal(info.pct,.125);assert.equal(info.quantityText,'보유 0.125주');assert.equal(info.valueText,'0.1만원');assert.equal(info.pctText,'0.13%');
  assert.equal(c.allocationHoldingInfo(dollar,s).value,12);assert.equal(c.allocationHoldingInfo(amount,s).quantityText,'금액으로 보유 관리');assert.equal(c.allocationHoldingInfo(zero,s).valueText,'0만원');assert.equal(JSON.stringify([alloc,p]),before);
  assert.equal(c.allocationHoldingTotal([item,dollar,amount,zero].map(it=>c.allocationHoldingInfo(it,s)),s).value,22.125);
  delete p.stocks['111111'];p.fx=null;s=c.allocationSummary(alloc,p);
  assert.deepEqual([c.allocationHoldingInfo(item,s).valueText,c.allocationHoldingInfo(item,s).pctText,c.allocationHoldingInfo(item,s).pending],['평가 대기','—','시세 대기']);
  assert.equal(c.allocationHoldingInfo(dollar,s).pending,'환율 대기');assert.equal(c.allocationHoldingInfo(amount,s).value,10);assert.equal(c.allocationHoldingInfo(zero,s).pending,'');
  const total=c.allocationHoldingTotal([item,dollar].map(it=>c.allocationHoldingInfo(it,s)),s);assert.deepEqual([total.valueText,total.pctText,total.pendingCount],['평가 대기','—',2]);
});
test('매수 우선순위는 연결된 실제 자산 id만 사용하고 조회·정규화·병합은 순서와 기존 회차를 자동 생성·변경하지 않는다',()=>{
  const item={id:'a',ticker:'AAA',tradeTicker:'111111',amount:10,buyPlan:{lines:{names:['25일선'],budget:10},buys:{end:{price:50,shares:2,plannedShares:5,actual:2}}}},other={id:'b',ticker:'AAA',tradeTicker:'222222',shares:0};
  const assets={version:1,allocation:{groups:[{id:'g',items:[other,item,{id:'x',ticker:'BBB',amount:20}]}]}},alloc=assets.allocation,before=JSON.stringify(assets);
  assert.deepEqual(c.purchaseTargets(alloc,null,item).map(r=>r.it.id),['a','b']);assert.equal(JSON.stringify(assets),before);
  item.buyPlan.buyPriority=['x','missing','b','b','a'];const selected=JSON.stringify(assets);assert.deepEqual(c.purchaseTargets(alloc,null,item).map(r=>r.it.id),['b','a']);assert.equal(JSON.stringify(assets),selected);
  const cleaned=c.cleanAssets(assets);assert.deepEqual(cleaned.allocation.groups[0].items[1].buyPlan,item.buyPlan);
  const merged=c.mergeAssets(assets,JSON.parse(selected),JSON.parse(selected)).doc;assert.deepEqual(merged.allocation.groups[0].items[1].buyPlan,item.buyPlan);
});
test('우선순위 ETF의 최소 매수액이 공통 회차·합계·알림 계산에 적용되고 기준 티커와 전체 계좌 비중은 유지된다',()=>{
  const item={id:'a',ticker:'AAA',tradeTicker:'111111',shares:10,buyPlan:{currency:'USD',lines:{names:['25일선','32일선'],budget:40},notify:{stages:true},buyPriority:['b','a']}},other={id:'b',ticker:'AAA',tradeTicker:'222222',shares:2};
  const alloc={total:100,groups:[{id:'g',items:[item,other]}]},p={stocks:{AAA:{kind:'해외',asOf:'2026-01-02',close:9,ma:{'25일선':10,'32일선':20}},'111111':{kind:'국내',asOf:'2026-01-02',close:10000},'222222':{kind:'국내',asOf:'2026-01-02',close:200000}},fx:{close:1000}},trade={item,allocation:alloc,prices:p,fx:1000,currency:'USD'},before=JSON.stringify(alloc);
  const rows=c.purchaseLineRows(item.buyPlan,p.stocks.AAA,trade),summary=c.purchaseSummary(item.buyPlan,p.stocks.AAA,trade),rules=c.purchaseAlertRules({allocation:alloc},p);
  assert.equal(rows.length,2);assert.equal(summary.count,2);assert.deepEqual(rules.map(r=>r.targetPrice),rows.map(r=>r.price));assert.ok(rules.every(r=>r.ticker==='AAA'));assert.equal(c.purchaseAllocationSummary(alloc,p,item).pct,50);
  assert.ok(rows.every(r=>c.purchaseTrackingFill(r,item,p,1000,'USD',other).shares===1));assert.equal(JSON.stringify(alloc),before);
  delete item.buyPlan.buyPriority;assert.equal(c.purchaseLineRows(item.buyPlan,p.stocks.AAA,trade).length,4);
});
test('분할매수 보유 비중은 코드가 같은 모든 계좌를 합산하고 이름·분류만 같은 다른 상품은 제외한다',()=>{
  const item={id:'a',name:'같은 이름',ticker:' A111111 ',shares:10,target:15},other={id:'b',ticker:'111111',amount:30,target:20};
  const alloc={total:200,classes:[],cash:[],groups:[{id:'g1',classId:'stock',items:[item]},{id:'g2',classId:'stock',items:[other,{id:'x',name:'같은 이름',ticker:'222222',amount:60}]}]},p={stocks:{' A111111 ':{kind:'국내',asOf:'2026-01-02',close:10000},A111111:{kind:'국내',asOf:'2026-01-02',close:10000}}};
  const before=JSON.stringify(alloc),s=c.purchaseAllocationSummary(alloc,p,item);
  assert.deepEqual(s.rows.map(r=>r.it.id),['a','b']);near(s.value,40,'수량 평가액과 금액 보유분 합');near(s.pct,20,'전체 기준 총자산');
  assert.equal(s.target,35);near(s.gapPct,15,'목표와 현재 비중 차이');near(s.buyable,30,'추가 가능 금액');assert.equal(JSON.stringify(alloc),before);
  other.amount=50;near(c.purchaseAllocationSummary(alloc,p,item).pct,30,'다른 계좌 변경을 다시 읽음');
  alloc.total=400;near(c.purchaseAllocationSummary(alloc,p,item).pct,15,'자산현황 기준 총자산 변경');
});
test('분할매수는 기준 코드·실제 ETF 연결을 따라 다른 추종 ETF와 실제 코드 직접 보유분을 한 번씩만 합산한다',()=>{
  const item={id:'a',ticker:'AAA',tradeTicker:'111111',amount:10},items=[item,{id:'b',ticker:'aaa',tradeTicker:'222222',amount:15},{id:'c',ticker:'A111111',amount:20},{id:'d',ticker:'222222',amount:25},{id:'e',ticker:'BBB',tradeTicker:'222222',amount:5},{id:'x',ticker:'CCC',tradeTicker:'333333',amount:40,name:'같은 투자 이름'}];
  const alloc={total:300,groups:[{id:'g',items}],classes:[],cash:[]},before=JSON.stringify(alloc);
  const s=c.purchaseAllocationSummary(alloc,null,item);
  assert.deepEqual(s.rows.map(r=>r.it.id),['a','b','c','d','e']);assert.equal(s.value,75);assert.equal(s.pct,25);assert.equal(s.target,null);
  assert.equal(JSON.stringify(alloc),before);item.ticker='';delete item.tradeTicker;
  assert.deepEqual(c.purchaseAllocationSummary(alloc,null,item).rows.map(r=>r.it.id),['a'],'코드 없는 항목은 이름으로 찾지 않음');
});
test('분할매수 기본 목표는 전체 대상의 소분류·그룹 목표이며 옛 계획 목표는 자산 배분 목표가 없을 때만 쓴다',()=>{
  const item={id:'a',ticker:'111111',amount:10,section:'일반'},alloc={total:100,groups:[{id:'g',target:40,sections:[{name:'일반',target:6},{name:'다른 상품',target:8}],items:[item,{id:'b',ticker:'111111',section:'일반',amount:5},{id:'x',ticker:'222222',section:'다른 상품',amount:30}]}],classes:[],cash:[]};
  assert.equal(c.purchaseAllocationSummary(alloc,null,item).target,6,'다른 상품 목표는 제외');
  const legacy=c.purchaseAllocationSummary(alloc,null,item,{lines:{target:30}});
  assert.deepEqual([legacy.target,legacy.assetTarget,legacy.scope],[6,6,'section'],'자산 배분 목표가 있으면 계획에 따로 저장된 옛 목표보다 우선');
  delete alloc.groups[0].sections[0].target;
  const old=c.purchaseAllocationSummary(alloc,null,item,{lines:{target:30}});
  assert.deepEqual([old.target,old.assetTarget,old.scope],[30,null,'plan'],'자산 배분 목표가 없으면 옛 계획 목표를 그대로 사용');
  assert.equal(c.purchaseAllocationSummary(alloc,null,item,{lines:{target:0}}).buyable,0);
  alloc.groups=[{id:'g1',target:4,items:[item]},{id:'g2',target:5,items:[{id:'b',ticker:'111111',amount:5}]}];delete item.section;
  assert.equal(c.purchaseAllocationSummary(alloc,null,item).target,9,'계좌가 달라도 완전히 포함된 그룹 목표 합');
});
test('분할매수 자동 분모는 자산현황의 종목·원화 현금·외화 현금·차감 항목 합과 같고 시세·환율을 반영한다',()=>{
  const item={id:'a',ticker:'AAA',shares:10},p={stocks:{AAA:{kind:'해외',close:10,asOf:'2026-01-02'}},fx:{close:1000}},alloc={groups:[{id:'g',items:[item,{id:'b',ticker:'AAA',amount:30},{id:'x',amount:20}]}],classes:[],cash:[{amount:150000},{currency:'USD',amount:100},{amount:50000,minus:true}]};
  const s=c.purchaseAllocationSummary(alloc,p,item),assets=c.allocationSummary(alloc,p);assert.equal(s.base,80);assert.equal(s.base,assets.base);assert.equal(s.pct,50);
  p.fx.close=2000;assert.equal(c.purchaseAllocationSummary(alloc,p,item).pct,50/100*100);
  p.stocks.AAA.close=20;near(c.purchaseAllocationSummary(alloc,p,item).pct,70/120*100,'해외 보유액과 전체 자산을 같은 환율로 평가');
});
test('분할매수 회차·합계·알림은 전체 목표 잔액을 쓰고 저장 예산과 부분 체결 원래 잔량은 보존한다',()=>{
  const item={id:'a',ticker:'111111',amount:10,target:40},alloc={total:100,groups:[{id:'g',items:[item,{id:'b',ticker:'111111',amount:15}]}],classes:[],cash:[]};
  const plan={lines:{names:['25일선'],end:10000,budget:50},notify:{stages:true}},p={stocks:{'111111':{kind:'국내',close:10000,asOf:'2026-01-02'}}},trade={allocation:alloc,item,prices:p,fx:1,currency:'KRW'};item.buyPlan=plan;
  const before=JSON.stringify(alloc),summary=c.purchaseSummary(plan,null,trade),rows=c.purchaseLineRows(plan,null,trade);
  assert.equal(summary.planned,15);assert.equal(summary.remaining,15);assert.equal(rows[0].amount,15);assert.equal(c.purchaseAlertRules({allocation:alloc},p).length,1);assert.equal(JSON.stringify(alloc),before);
  alloc.groups[0].items[1].amount=35;assert.equal(c.purchaseLineRows(plan,null,trade).length,0);assert.equal(c.purchaseSummary(plan,null,trade).remaining,0);assert.equal(c.purchaseAlertRules({allocation:alloc},p).length,0);assert.equal(plan.lines.budget,50);
  plan.buys={end:{plannedShares:10,shares:4,plannedActual:10,actual:4,price:10000}};
  const partial=c.purchaseLineRows(plan,null,trade);assert.equal(partial.length,1);assert.equal(partial[0].remainingShares,6);assert.equal(partial[0].amount,6);assert.equal(c.purchaseSummary(plan,null,trade).remaining,6);
  delete item.target;assert.equal(c.purchaseBudget(plan,trade),50,'목표 없는 직접 예산은 그대로');
});
test('분할매수·분할매도·재매수의 목표는 같은 자산 배분 규칙(종목 합 → 완전히 포함된 그룹·소분류)으로 읽는다',()=>{
  const item={id:'a',ticker:'111111',amount:10,section:'일반'},alloc={total:100,groups:[{id:'g',target:40,sections:[{name:'일반',target:6},{name:'다른 상품',target:8}],items:[item,{id:'b',ticker:'111111',section:'일반',amount:5},{id:'x',ticker:'222222',section:'다른 상품',amount:30}]}],classes:[],cash:[]};
  const before=JSON.stringify(alloc),same=label=>{const link=c.linkSummary(alloc,null,'111111'),buy=c.purchaseAllocationSummary(alloc,null,item);assert.deepEqual([link.target,link.scope],[buy.target,buy.scope],label);return [link.target,link.scope];};
  assert.deepEqual(same('소분류'),[6,'section'],'다른 상품이 있는 그룹은 완전히 포함된 소분류 목표');
  alloc.groups=[{id:'g1',target:4,items:[item]},{id:'g2',target:5,items:[{id:'b',ticker:'111111',amount:5}]}];delete item.section;
  assert.deepEqual(same('여러 그룹'),[9,'group'],'계좌가 나뉜 그룹 목표 합');
  item.target=21;assert.deepEqual(same('종목'),[21,'item']);
  item.target=21.5;assert.deepEqual(same('변경'),[21.5,'item'],'저장된 목표를 그릴 때마다 다시 읽는다');
  alloc.groups[1].items[0].target=0.5;assert.deepEqual(same('연결 계좌 합'),[22,'item']);
  assert.deepEqual(c.linkedAllocationTarget([],c.allocationSummary(alloc,null)),{target:null,scope:null});
  alloc.groups=JSON.parse(before).groups;
  assert.equal(JSON.stringify(alloc),before,'읽기만 한다');
});
test('목표 변경 맞춤: 바뀐 이동평균선 돌파 계획만 옛 목표를 지우고 총 매수 금액을 다시 계산한다',()=>{
  const plan=()=>({lines:{names:['25일선','32일선'],startLine:'25일선',budget:65},notify:{stages:true},buys:{'25일선:0':{plannedShares:4,plannedActual:8,shares:2,actual:4,price:20000}}});
  const make=()=>({total:1000,classes:[],cash:[],groups:[{id:'bond',target:25,items:[{id:'edv',ticker:'EDV',amount:100,target:21,buyPlan:plan()},{id:'isa',ticker:'EDV',tradeTicker:'999999',amount:50}]},
    {id:'only',target:30,items:[{id:'solo',ticker:'SOLO',amount:100,buyPlan:{lines:{names:['25일선'],budget:200}}}]},
    {id:'etc',items:[{id:'wait',ticker:'WAIT',amount:10,target:5,buyPlan:{wait:{line:'25개월선'}}},{id:'manual',ticker:'MAN',amount:10,target:5,buyPlan:{stages:[{id:'s',amount:30}]}},{id:'fresh',ticker:'NEW',amount:10,target:5}]}]});
  const before=make(),after=make(),edv=after.groups[0].items[0],trade={allocation:after,item:edv};
  assert.deepEqual(c.syncPurchaseTargets(before,after,null),[],'목표가 그대로면 아무것도 바꾸지 않음');assert.deepEqual(after,make());
  after.groups[0].items[1].amount=60;assert.deepEqual(c.syncPurchaseTargets(before,after,null),[],'보유량·평가액만 바뀐 저장은 예산을 다시 계산하지 않음');
  after.groups[0].items[1].amount=50;
  edv.target=21.5;after.groups[1].target=31;after.groups[2].items.forEach(it=>it.target=6);after.groups[2].items[2].buyPlan={lines:{names:['25일선'],budget:9}};
  assert.deepEqual(c.syncPurchaseTargets(before,after,null),['edv','solo']);
  assert.equal(edv.buyPlan.lines.budget,c.purchaseAutoBudget(edv.buyPlan,c.purchaseAllocationSummary(after,null,edv)));
  assert.equal(edv.buyPlan.lines.budget,69,'21.5% × 1,000 − 150 + 체결 4');assert.equal(c.purchaseBudget(edv.buyPlan,trade),69);
  assert.deepEqual(edv.buyPlan.buys,plan().buys,'부분 체결 기록 유지');assert.deepEqual([edv.buyPlan.lines.names,edv.buyPlan.lines.startLine,edv.buyPlan.notify],[plan().lines.names,'25일선',{stages:true}]);
  assert.equal(after.groups[1].items[0].buyPlan.lines.budget,(310-100)*1,'종목 목표가 없으면 그룹 목표 변경도 따라감');
  assert.deepEqual(after.groups[2].items.map(it=>it.buyPlan),[{wait:{line:'25개월선'}},{stages:[{id:'s',amount:30}]},{lines:{names:['25일선'],budget:9}}],'매수대기·기존 직접 입력·새 계획은 그대로');
  const snapshot=JSON.parse(JSON.stringify(after));assert.deepEqual(c.syncPurchaseTargets(snapshot,after,null),[],'같은 저장을 다시 맞춰도 바뀌지 않음');
  edv.target=10;c.syncPurchaseTargets(snapshot,after,null);
  assert.equal(edv.buyPlan.lines.budget,4,'목표가 지금 비중보다 낮으면 체결 금액만');assert.equal(c.purchaseBudget(edv.buyPlan,trade),8,'부분 체결의 고정 잔량 4만원은 보존');
});
test('목표 변경 맞춤: 옛 계획 목표는 자산 배분 목표로 옮겨 가면 지우고, 쓰던 목표와 같으면 직접 넣은 예산을 둔다',()=>{
  const make=()=>({total:1000,classes:[],cash:[],groups:[{id:'g',items:[{id:'a',ticker:'EDV',amount:100,buyPlan:{lines:{names:['25일선'],budget:123,target:21}}},{id:'b',ticker:'TLT',amount:100}]}]});
  const before=make(),after=make(),it=after.groups[0].items[0];
  assert.equal(c.purchaseAllocationSummary(before,null,before.groups[0].items[0]).scope,'plan');
  it.target=21;assert.deepEqual(c.syncPurchaseTargets(before,after,null),['a']);
  assert.deepEqual(it.buyPlan.lines,{names:['25일선'],budget:123},'같은 목표면 옛 목표만 지우고 예산은 유지');
  const next=JSON.parse(JSON.stringify(after));it.target=22;c.syncPurchaseTargets(next,after,null);assert.equal(it.buyPlan.lines.budget,120);
  const legacy=make(),cleared=make();cleared.groups[0].items[0].target=21;delete cleared.groups[0].items[0].buyPlan.lines.target;
  assert.deepEqual(c.syncPurchaseTargets(cleared,legacy,null),['a'],'자산 목표를 지우면');assert.equal(legacy.groups[0].items[0].buyPlan.lines.target,undefined,'옛 목표로 되돌아가지 않음');
  assert.equal(legacy.groups[0].items[0].buyPlan.lines.budget,123);assert.equal(c.syncPurchaseTargets(null,legacy,null).length,0);
});
test('매수대기는 예산·회차 합계에서 제외하고 일선·주선·월선·시선마다 하락 도달 알림을 만든다',()=>{
  for(const line of ['25선','60일선','20주선','25개월선']){
    const plan={wait:{line},currency:'USD',notify:{stages:true}},assets={allocation:{groups:[{items:[{id:'a',ticker:'AAA',buyPlan:plan}]}]}},before=JSON.stringify(assets);
    assert.deepEqual(c.purchaseSummary(plan),{count:0,done:0,planned:0,actual:0,remaining:0});assert.equal(c.purchaseDirection(plan),'down');
    assert.deepEqual(c.purchaseAlertRules(assets,null),[]);
    const rules=c.purchaseAlertRules(assets,{stocks:{AAA:{kind:'해외',close:105,ma:{[line]:100}}}});
    assert.equal(rules.length,1);assert.equal(rules[0].targetPrice,100);assert.equal(rules[0].condition,'down');assert.equal(rules[0].id,'trade:buy:a:wait');
    assert.equal(JSON.stringify(assets),before);
    for(const invalid of ['', '401개월선','0일선','25개월선 메모']){plan.wait.line=invalid;assert.deepEqual(c.purchaseAlertRules(assets,{stocks:{AAA:{kind:'해외',ma:{[invalid]:100}}}}),[]);}
  }
});
const prices = {stocks: {
  '111111': {kind: '국내', asOf: '2026-01-02', close: 10000},
  AAA: {kind: '해외', asOf: '2026-01-02', close: 50},
  'BTC-USD': {kind: '코인', asOf: '2026-01-03', close: 100},
  BAD: {error: true},
}, fx: {close: 1000, asOf: '2026-01-02'}};

test('일반 추종 ETF: 기준 주수·달러 가격·환율로 같은 금액을 환산하고 잔액을 남긴다',()=>{
  const it={ticker:'AAA',tradeTicker:'111111'},source={price:50,shares:10};
  const before=JSON.stringify([it,source,prices]);
  const fill=c.purchaseTrackingFill(source,it,prices,1000,'USD');
  assert.equal(fill.shares,50);assert.equal(fill.actual,50);assert.equal(fill.price,50);assert.equal(fill.tradePrice,10000);assert.equal(fill.tradeCurrency,'KRW');
  const p={...prices,stocks:{...prices.stocks,'111111':{...prices.stocks['111111'],close:12300}}};
  const rounded=c.purchaseTrackingFill({amount:100,price:50},it,p,1000,'USD');
  assert.equal(rounded.shares,81);assert.equal(rounded.actual,99.63);near((rounded.budget-rounded.actual)*1e4,3700,'예산 내 매수 잔액');
  assert.equal(JSON.stringify([it,source,prices]),before,'환산·표시는 기존 입력과 시세를 변경하지 않음');
  assert.equal(c.purchaseTrackingFill(source,it,prices,null,'USD'),null,'달러 기준 주수 환산에는 환율 필요');
  assert.equal(c.purchaseTrackingFill({amount:100,price:50},it,prices,null,'USD').shares,100,'이미 원화 예산이면 국내 ETF 주수 계산에 환율 불필요');
});

test('추종 ETF 평가액은 실제 ETF 주수·가격을 쓰며 직접 입력 가격보다 자동 시세를 우선한다',()=>{
  const it={id:'a',ticker:'AAA',tradeTicker:'111111',shares:10,amount:0,tradePrice:9000,tradePriceAt:'2026-01-01T00:00:00Z'};
  assert.equal(c.itemValue(it,prices,1000).value,10,'미국 기준 ETF의 50달러로 보유 주수를 곱하지 않음');
  assert.equal(c.assetTradeQuote(prices,it).close,10000);
  const empty={stocks:{AAA:prices.stocks.AAA}};
  assert.equal(c.assetTradeQuote(empty,it).manual,true);assert.equal(c.itemValue(it,empty,null).value,9);
  assert.equal(c.purchaseTrackingFill({amount:10,price:50},it,empty,1000,'USD').shares,11);
  delete it.tradePrice;assert.equal(c.purchaseTrackingFill({amount:10,price:50},it,empty,1000,'USD'),null,'실제 ETF 가격이 없을 때 원본 가격으로 잘못 계산하지 않음');
  const amountOnly={ticker:'AAA',tradeTicker:'111111',amount:10};c.resetBase(amountOnly,prices,{});
  assert.equal(amountOnly.base,10000);assert.equal(c.itemValue(amountOnly,prices,1000).value,10);
});

test('미국 기준 계획과 연결한 추종 ETF 계좌는 보유 주수를 섞지 않고 체결 금액을 실제 ETF 주수로 환산한다',()=>{
  const it={id:'a',ticker:'AAA',tradeTicker:'111111',shares:100},alloc={total:1000,groups:[{id:'g',items:[it]}],cash:[],classes:[]};
  assert.equal(c.linkSummary(alloc,prices,'AAA').shares,null,'국내 ETF 100주를 미국 ETF 100주로 가져오지 않음');
  assert.equal(c.linkSummary(alloc,prices,'111111').shares,100);
  const trade={ticker:'AAA',sign:1,qty:2,price:50,currency:'USD',value:10},row=c.tradeRows(alloc,prices,'AAA',trade)[0];
  assert.equal(row.n,10);assert.equal(row.converted,true);
  c.applyTrade(alloc,prices,'r',trade,'환산',[{id:'a',unit:'shares',n:row.n}]);assert.equal(it.shares,110);
  c.rescaleTrade(alloc,'r',{qty:2,price:75,value:15});assert.equal(it.shares,115,'기준 가격 정정도 투자 금액 비율로 맞춤');
  c.revertTrade(alloc,'r');assert.equal(it.shares,100);
});

test('체결 크기를 크게 줄여 반영량이 0이 돼도 다시 고치면 돌아오고 추종 ETF 주수 내림이 쌓이지 않는다',()=>{
  const it={id:'a',ticker:'AAA',tradeTicker:'111111',shares:100},am={id:'b',ticker:'111111',amount:2,base:10000},z={id:'z',ticker:'AAA',tradeTicker:'111111'};
  const alloc={total:1000,groups:[{id:'g',items:[it,am,z]}],cash:[],classes:[]},usd={ticker:'AAA',sign:1,qty:2,price:50,currency:'USD',value:10};
  c.applyTrade(alloc,prices,'r',usd,'환산',[{id:'a',unit:'shares',n:10}]);
  c.rescaleTrade(alloc,'r',{qty:2,price:50,value:0.5});assert.equal(it.shares,100,'금액 오타로 0.5주 → 0주');assert.equal(alloc.trades.r.items[0].exact,0.5);
  c.rescaleTrade(alloc,'r',{qty:2,price:50,value:10});assert.equal(it.shares,110,'바로잡으면 10주를 다시 반영');assert.equal('exact' in alloc.trades.r.items[0],false);
  c.rescaleTrade(alloc,'r',{qty:2,price:50,value:7.5});assert.equal(it.shares,107,'7.5주는 내림');
  c.rescaleTrade(alloc,'r',{qty:2,price:50,value:10});assert.equal(it.shares,110,'내림한 7주 × 4/3 = 9주로 줄지 않음');
  c.revertTrade(alloc,'r');assert.equal(it.shares,100);
  c.applyTrade(alloc,prices,'m',{sign:1,qty:1,price:10000,currency:'KRW',value:1},'금액',[{id:'b',unit:'amount',n:1}]);assert.equal(am.amount,3);
  c.rescaleTrade(alloc,'m',{qty:1,price:10000,value:0.001});assert.equal(am.amount,2,'0.01만원 아래는 0');
  c.rescaleTrade(alloc,'m',{qty:1,price:10000,value:1});assert.equal(am.amount,3,'금액 종목도 돌아옴');
  c.applyTrade(alloc,prices,'f',{...usd,qty:1,value:5},'새 칸',[{id:'z',unit:'shares',n:5}]);
  c.rescaleTrade(alloc,'f',{qty:1,price:50,value:0.5});assert.equal(z.shares,0);
  c.revertTrade(alloc,'f');assert.equal('shares' in z,false,'새로 만든 수량 칸은 0으로 남기지 않고 지움');
  c.applyTrade(alloc,prices,'s',usd,'환산',[{id:'a',unit:'shares',n:10}]);alloc.trades.s.items[0].exact=30;
  c.rescaleTrade(alloc,'s',{qty:2,price:50,value:5});assert.equal(it.shares,105,'반영량과 맞지 않는 exact(반영량만 고친 기록)는 읽지 않음');
});

test('목표 비중: 종목 수정·이동·삭제가 소분류·그룹·분류·지역 합계에 반영되고 기존 기록은 보존한다', () => {
  const alloc = {classes: [{id:'c',region:'국내',target:80},{id:'cash',region:'현금',target:20,cash:true}],cash:[],
    groups:[{id:'g',classId:'c',target:70,sections:[{name:'배당',target:40}],items:[{id:'a',amount:10,target:3.3,section:'배당'},{id:'b',amount:10,target:6.7,section:'배당'},{id:'z',target:0},{id:'blank'}]},
      {id:'legacy',classId:'c',target:5,items:[]}]};
  const before = JSON.stringify(alloc), t = c.allocationTargets(alloc);
  assert.deepEqual(t.section('g','배당'),{target:10,linked:true});
  assert.deepEqual(t.groups.get('g'),{target:10,linked:true});
  assert.deepEqual(t.classes.get('c'),{target:15,linked:true});
  assert.deepEqual(t.classes.get('cash'),{target:20,linked:false});
  assert.equal(JSON.stringify(alloc),before,'계산만으로 상위 목표나 동기화 기록을 변경하지 않는다');
  alloc.groups[0].items[0].target=4;
  assert.equal(c.allocationSummary(alloc,null).regions.find(r=>r.name==='국내').target,15.7,'종목 목표 수정 연동');
  const moved=alloc.groups[0].items.splice(1,1)[0];delete moved.section;alloc.groups[1].items.push(moved);
  assert.equal(c.allocationTargets(alloc).groups.get('legacy').target,6.7,'그룹 이동은 새 그룹에서 합산');
  alloc.groups[1].items=[];
  assert.equal(c.allocationTargets(alloc).groups.get('legacy').target,5,'하위 목표가 없으면 기존 직접 입력 목표');
  delete alloc.groups[0].items[0].target;
  assert.equal(c.allocationTargets(alloc).section('g','배당').target,40,'소분류도 기존 직접 입력 목표 유지');
  assert.equal(c.allocationTargets({groups:[{id:'zero',target:20,items:[{target:0}]}]}).groups.get('zero').target,0,'0%는 입력된 목표');
});

test('분할매수: 실제 체결 금액과 남은 회차 예정액을 따로 합산하고 완료 해제도 반영한다', () => {
  const plan={stages:[{amount:30,done:true,actual:25},{amount:40,done:true},{amount:50},{amount:10,done:true,actual:0}]};
  assert.deepEqual(c.purchaseSummary(plan),{count:4,done:3,planned:130,actual:65,remaining:50});
  plan.stages[0].done=false;
  assert.deepEqual(c.purchaseSummary(plan),{count:4,done:2,planned:130,actual:40,remaining:80});
  assert.deepEqual(c.purchaseSummary(null),{count:0,done:0,planned:0,actual:0,remaining:0});
  assert.equal(c.purchaseSummary({stages:[{amount:-10},{amount:'bad'},{amount:10,done:true,actual:-1}]}).actual,0,'음수·잘못된 금액은 합계에 더하지 않는다');
});

test('분할매수 이동평균선 돌파: 단계마다 다음 단계까지 3분할, 목표 가격보다 낮은 회차 + 목표가 회차에 같은 금액, 산 금액은 빼고 남은 회차에 다시 나눔', () => {
  // 가짜 이동평균: 25선 100 · 32선 103 · 42선 102(앞보다 낮아 32선은 1차만) · 60선 없음(건너뜀) · 25일선 106 · 32일선 112
  const entry = {kind:'해외', ma:{'25선':100, '32선':103, '42선':102, '25일선':106, '32일선':112}};
  const lines = {names:['25선','32선','42선','60선','25일선','32일선'], end:110, budget:90};
  const levels = c.purchaseLineLevels(lines, entry);
  assert.deepEqual(levels.map(x => x.key), ['25선:0','25선:1','25선:2','32선:0','42선:0','42선:1','42선:2','25일선:0','25일선:1','end']);
  near(levels[1].price, 101, '25선 2차 = 100 + (103 − 100) × ⅓'); near(levels[5].price, 103.333333, '42선 2차는 다음 값 있는 25일선까지');
  assert.ok(levels.every(x => x.key === 'end' || x.price < 110), '목표 가격 이상 회차는 빼고(25일선 3차 110, 32일선 112) 목표가 회차가 마지막');
  assert.deepEqual(levels.at(-1), {key:'end', line:'목표가', t:0, next:null, price:110});
  assert.equal(levels[1].next, '32선'); assert.equal(levels[0].next, null);
  let rows = c.purchaseLineRows({lines}, entry);
  assert.equal(rows.length, 10); near(rows[0].amount, 9, '총 90만원 ÷ 10회');
  const plan = {lines, buys:{'25선:0':{actual:12, price:100}, 'bad':{actual:1}, '25선:9':{actual:1}}};
  rows = c.purchaseLineRows(plan, entry);
  assert.deepEqual(rows.filter(r => r.done).map(r => [r.key, r.actual, r.price]), [['25선:0', 12, 100]], '이상한 키는 무시');
  near(rows.find(r => !r.done).amount, (90 - 12) / 9, '산 금액을 뺀 남은 금액을 남은 회차에');
  assert.deepEqual(c.purchaseSummary(plan, entry), {count:10, done:1, planned:90, actual:12, remaining:78});
  assert.deepEqual(c.purchaseLineRows({lines, buys:{end:{actual:90}}}, entry).map(r => r.key), ['end'], '다 쓰면 남은 회차 없음');
  assert.deepEqual(c.purchaseLineRows({lines}, null).map(r => [r.key, r.price, r.amount]), [['end', 110, 90]], '시세가 없으면 목표가 회차만');
  assert.equal(c.purchaseLineLevels({names:['25선','bad','25분봉'], end:110}, {ma:{'25선':100, bad:1, '25분봉':1}}).length, 2, 'N선·N일선만 받는다');
  assert.equal(c.purchaseLineLevels({end:0}, entry).length, 0);
  assert.equal(c.purchaseLineLevels({end:200}, {ma:{'25선':1}}).length, 2, '단계 이름이 없으면 재매수 기본 14단계');
});

test('분할매수는 같은 회차 예산으로 1주를 못 사더라도 총예산이 충분하면 모든 회차를 유지한다',()=>{
  const plan={lines:{names:['25일선','32일선'],budget:100}},entry={ma:{'25일선':100000,'32일선':400000}},before=JSON.stringify(plan);
  const rows=c.purchaseLineRows(plan,entry);
  assert.deepEqual(rows.map(r=>[r.key,r.amount]),[['25일선:0',10],['25일선:1',20],['25일선:2',30],['32일선:0',40]]);
  assert.ok(rows.every(r=>c.purchaseFill(r,'KRW',null).shares===1));
  assert.equal(rows.reduce((sum,r)=>sum+r.amount,0),100);
  assert.equal(JSON.stringify(plan),before,'회차를 조정해도 저장된 계획에 필드를 추가하지 않는다');
});

test('분할매수는 부족한 예산을 앞에서 소진하지 않고 최대한 많은 회차를 종료선까지 고르게 배치한다',()=>{
  const names=['25일선','32일선','42일선','60일선','80일선'],entry={ma:Object.fromEntries(names.map((n,i)=>[n,(i+1)*100000]))};
  for(const end of [null,500000]){
    const plan={lines:{names,budget:150,...(end?{end}:{})}},rows=c.purchaseLineRows(plan,entry);
    assert.equal(c.purchaseLineLevels(plan.lines,entry).length,13);
    assert.deepEqual(rows.map(r=>r.key),['25일선:0','32일선:0','42일선:0','60일선:0',end?'end':'80일선:0']);
    assert.ok(rows.every(r=>c.purchaseFill(r,'KRW',null).shares===1));
    near(rows.reduce((sum,r)=>sum+r.amount,0),150);
    assert.equal(c.purchaseSummary(plan,entry).count,5);
    for(const row of rows){
      (plan.buys??={})[row.key]=c.purchaseFill(row,'KRW',null);
      const next=c.purchaseLineRows(plan,entry);
      assert.deepEqual(next.map(r=>r.key),rows.map(r=>r.key),'체결 뒤에도 건너뛴 앞 회차를 다시 만들지 않는다');
      assert.ok(next.filter(r=>!r.done).every(r=>c.purchaseFill(r,'KRW',null).shares>0));
      assert.ok(next.reduce((sum,r)=>sum+(r.done?r.actual:r.amount),0)<=150+1e-8);
    }
    assert.deepEqual(c.purchaseSummary(plan,entry),{count:5,done:5,planned:150,actual:150,remaining:0});
  }
});

test('분할매수는 원화 표시 가격 반올림 경계에서도 1주 예산을 확보한다',()=>{
  const plan={lines:{names:['25일선','32일선'],budget:20.0001}},entry={ma:{'25일선':100000.49,'32일선':100000.51}};
  const rows=c.purchaseLineRows(plan,entry);
  assert.deepEqual(rows.map(r=>r.key),['25일선:0','32일선:0']);
  assert.ok(rows.every(r=>c.purchaseFill(r,'KRW',null).shares===1));
  near(rows.reduce((sum,r)=>sum+c.purchaseFill(r,'KRW',null).actual,0),20.0001);
});

test('분할매수는 체결 뒤 종료선이 급등해 남은 예산으로 못 사면 매수 완료로 오인하지 않는다',()=>{
  const names=['25일선','32일선','42일선','60일선','80일선'],entry={ma:Object.fromEntries(names.map((n,i)=>[n,(i+1)*100000]))},plan={lines:{names,budget:150},buys:{}};
  const initial=c.purchaseLineRows(plan,entry);
  for(const row of initial.slice(0,-1))plan.buys[row.key]=c.purchaseFill(row,'KRW',null);
  entry.ma['80일선']=1000000;
  const rows=c.purchaseLineRows(plan,entry),last=rows.at(-1);
  assert.equal(last.key,'80일선:0');assert.equal(last.done,false);assert.equal(last.amount,50);
  assert.equal(c.purchaseFill(last,'KRW',null).shares,0);
  assert.deepEqual(c.purchaseSummary(plan,entry),{count:5,done:4,planned:150,actual:100,remaining:50});
});

test('목표 가격 없는 분할매수는 마지막 선택 평균선의 도달 회차까지 예산을 배분한다', () => {
  for(const unit of ['선','일선','주선','개월선']){
    const names=[`32${unit}`,`42${unit}`],plan={lines:{names,budget:400}},entry={ma:{[names[0]]:1350,[names[1]]:1380}},before=JSON.stringify(plan);
    const rows=c.purchaseLineRows(plan,entry);
    assert.deepEqual(rows.map(r=>[r.key,r.price,r.amount]),[[`${names[0]}:0`,1350,100],[`${names[0]}:1`,1360,100],[`${names[0]}:2`,1370,100],[`${names[1]}:0`,1380,100]]);
    assert.equal(c.purchaseSummary(plan,entry).remaining,400);
    assert.equal(JSON.stringify(plan),before,'읽기만 할 때 목표 가격이나 체결 필드를 만들지 않음');
  }
  const rows=c.purchaseLineLevels({names:['25선','32선']},{ma:{'25선':1400,'32선':1350,'42선':1600}});
  assert.deepEqual(rows.map(r=>[r.key,r.price]),[['25선:0',1400],['32선:0',1350]],'역전된 선도 선택 순서대로 매수하고 선택 뒤의 선은 제외');
});

test('목표 가격 없는 분할매수는 종료선 시세가 없으면 기다리고 부분 체결 잔량은 보존한다', () => {
  const plan={lines:{names:['25선','32선'],budget:50}},entry={ma:{'25선':10000}};
  for(const missing of [null,{},entry]){
    assert.deepEqual(c.purchaseLineRows(plan,missing),[]);
    assert.deepEqual(c.purchaseSummary(plan,missing),{count:0,done:0,planned:50,actual:0,remaining:50});
  }
  plan.buys={'25선:0':{plannedShares:10,plannedActual:10,shares:7,price:10000,actual:7,next:null}};
  const before=JSON.stringify(plan),pending=c.purchaseLineRows(plan,entry);
  assert.equal(pending.length,1);assert.equal(pending[0].remainingShares,3);assert.equal(pending[0].amount,3);
  entry.ma['32선']=13000;
  const rows=c.purchaseLineRows(plan,entry);
  assert.equal(rows[0].remainingShares,3);assert.equal(rows[0].price,10000);
  near(rows.filter(r=>r.key!=='25선:0').reduce((sum,r)=>sum+r.amount,0),40,'예산에서 체결 7만원과 고정 잔량 3만원만 제외');
  assert.equal(rows.at(-1).key,'32선:0');assert.equal(JSON.stringify(plan),before);
});

test('목표 가격 없는 분할매수 알림은 종료 평균선을 따르고 시세 변경에도 같은 이력을 쓴다', () => {
  const plan={currency:'USD',lines:{names:['25일선','32일선'],budget:40},notify:{stages:true}},assets={allocation:{groups:[{items:[{id:'a',ticker:'AAA',buyPlan:plan}]}]}},prices={stocks:{AAA:{kind:'해외',ma:{'25일선':100,'32일선':130}}}};
  const before=JSON.stringify(assets),first=c.purchaseAlertRules(assets,prices);
  assert.deepEqual(first.map(r=>[r.targetPrice,r.condition]),[[100,'up'],[110,'up'],[120,'up'],[130,'up']]);
  assert.equal(first.at(-1).label,'분할매수 32일선 1차');assert.equal(first.at(-1).id,'trade:buy:a:32일선:0');
  prices.stocks.AAA.ma={'25일선':110,'32일선':140};
  const updated=c.purchaseAlertRules(assets,prices);
  assert.deepEqual(updated.map(r=>r.revision),first.map(r=>r.revision));assert.equal(updated.at(-1).targetPrice,140);
  delete prices.stocks.AAA.ma['32일선'];assert.deepEqual(c.purchaseAlertRules(assets,prices),[]);
  assert.equal(JSON.stringify(assets),before);
});

test('분할매수 휴대폰 알림(직접 입력): 켠 미완료 가격 회차만, 방향은 회차 가격 순서, 통화가 종목 시장과 다르면 보내지 않음', () => {
  assert.equal(c.purchaseDirection({lines:{end:30}, stages:[{price:40},{price:10}]}), 'up', '이동평균선 돌파는 상승');
  assert.equal(c.purchaseDirection({stages:[{price:10},{},{price:12}]}), 'up', '직접 넣은 가격이 오르면 상승');
  assert.equal(c.purchaseDirection({stages:[{price:12},{price:10}]}), 'down');
  assert.equal(c.purchaseDirection({stages:[{price:12}]}), 'down', '가격 하나뿐이면 하락(그 가격 이하에서 매수)');
  assert.deepEqual(['069500','A069500','0091C0','KS200',' ks200 ','SPY','BRK/B','BTC-USD','비트코인',''].map(c.purchaseQuoteKind), ['국내','국내','국내','국내','국내','해외','해외','코인',null,null]);
  const plan = (extra={}) => ({ladder:{start:30, end:32, count:3}, currency:'USD', notify:{stages:true}, stages:[
    {id:'s1', price:30, shares:1, amount:3, done:true}, {id:'s2', price:31, shares:1, amount:3}, {id:'s3', price:32, shares:1, amount:3, notify:false}, {id:'s4'}], ...extra});
  const assets = {allocation:{groups:[{items:[
    {id:'a', name:'비공개 이름', ticker:'aaa', note:'비공개 메모', buyPlan:plan()},
    {id:'b', ticker:'111111', buyPlan:{stages:[{id:'k1', price:10000}], notify:{stages:true}}},
    {id:'c', ticker:'AAA', buyPlan:plan({currency:undefined})},  // 시세도 계획 통화도 없으면 원화 → 미국 종목과 달라 제외
    {id:'d', buyPlan:plan()},  // 종목 코드 없음
    {id:'e', ticker:'BBB', buyPlan:plan({notify:undefined})},  // 켠 회차 없음
  ]}]}};
  const rules = c.purchaseAlertRules(assets, null);
  assert.deepEqual(rules, [
    {id:'trade:buy:a:s2', kind:'trade', ticker:'AAA', label:'분할매수 2차', targetPrice:31, condition:'up', quoteGroup:'stocks', quoteKey:'AAA', quoteKind:'해외', enabled:true, revision:'[31,"up"]'},
    {id:'trade:buy:b:k1', kind:'trade', ticker:'111111', label:'분할매수 1차', targetPrice:10000, condition:'down', quoteGroup:'stocks', quoteKey:'111111', quoteKind:'국내', enabled:true, revision:'[10000,"down"]'},
  ], '완료·OFF·가격 없는 회차는 빼고 이름·메모는 넣지 않는다');
  assert.equal(c.purchaseAlertRules(assets, prices).length, 3, '시세가 있으면 그 통화(AAA는 달러) — 계획 c도 포함');
  assert.deepEqual(c.purchaseAlertRules({allocation:{groups:[{items:[{id:'x', ticker:'111111', buyPlan:{currency:'USD', notify:{stages:true}, stages:[{id:'s', price:1}]}}]}]}}, null), [], '달러 계획인데 국내 종목 코드면 제외');
  assert.deepEqual(c.purchaseAlertRules(null, null), []);
  assert.deepEqual(c.purchaseAlertRules({allocation:{groups:'bad'}}, null), []);
});

test('분할매수 체결 기본값: 8.9주 예산은 표시 가격으로 8주만 사고 실제 수량의 금액을 저장한다', () => {
  assert.deepEqual(c.purchaseFill({amount:8.9,price:10000},'KRW',null),{shares:8,price:10000,actual:8});
  assert.deepEqual(c.purchaseFill({amount:8.9,price:10},'USD',1000),{shares:8,price:10,actual:8});
  assert.deepEqual(c.purchaseFill({amount:0.8008,price:1000.6},'KRW',null),{shares:8,price:1001,actual:0.8008},'표시 원화 가격으로 계산해 반올림 경계에서도 수량·금액 일치');
  assert.deepEqual(c.purchaseFill({amount:8.8044,price:10.004},'USD',1000),{shares:8,price:10,actual:8},'표시 달러 가격 소수 둘째 자리 사용');
  assert.deepEqual(c.purchaseFill({amount:0.9,price:10000},'KRW',null),{shares:0,price:10000,actual:0},'예산을 초과하는 1주를 만들지 않음');
  assert.equal(c.purchaseFill({amount:10,price:10},'USD',null),null,'달러 환율이 없으면 수량을 추정하지 않음');
  assert.equal(c.purchaseFill({amount:10,price:0},'KRW',null),null);
  const btc=c.purchaseFill({amount:0.1234567891,price:100},'USD',1000,1e-8);
  assert.equal(btc.shares,0.01234567,'BTC도 예산 안에서 최소 단위로 내림');
  assert.ok(btc.actual<=0.1234567891);
  const plan={lines:{names:['25선'],end:10000,budget:8.9},buys:{end:c.purchaseFill({amount:8.9,price:10000},'KRW',null)}};
  assert.equal(c.purchaseLineRows(plan,null).find(r=>r.done).shares,8,'완료 회차의 저장한 수량을 보존');
  near(c.purchaseSummary(plan).remaining,0.9,'쓰지 않은 예산은 체결 금액에 포함하지 않음');
});

test('분할매수 부분 체결은 잔량 예산을 먼저 남기고 새 회차에 중복 배분하지 않는다',()=>{
  const plan={lines:{names:['25선','32선'],end:14000,budget:50},buys:{'25선:0':{plannedShares:10,plannedActual:10,shares:7,price:10000,actual:7,next:null}}};
  const entry={ma:{'25선':10000,'32선':13000}},before=JSON.stringify(plan),rows=c.purchaseLineRows(plan,entry);
  assert.equal(rows[0].done,false);assert.equal(rows[0].remainingShares,3);assert.equal(rows[0].amount,3);
  assert.ok(rows.slice(1).every(r=>r.amount===10),'체결 7 + 잔량 3을 빼고 나머지 40을 새 4회에 배분');
  assert.deepEqual(c.purchaseSummary(plan,entry),{count:5,done:0,planned:50,actual:7,remaining:43});
  assert.equal(JSON.stringify(plan),before,'조회만으로 새 필드를 저장하지 않음');
  plan.lines.budget=7;
  assert.equal(c.purchaseLineRows(plan,{ma:{'25선':15000,'32선':16000}})[0].remainingShares,3,'예산을 낮추거나 단계가 사라져도 이미 고정한 잔량은 유지');
});

test('분할매수 부분 체결은 알림·JSON 복원·기기 간 병합에서도 미완료 상태를 유지한다',()=>{
  const plan={lines:{names:['25선','32선'],end:14000,budget:50},notify:{stages:true},buys:{'25선:0':{plannedShares:10,plannedActual:10,shares:7,price:10000,actual:7,next:null}}};
  const doc={version:1,allocation:{savedAt:'2026-01-02',classes:[],cash:[],groups:[{items:[{id:'a',ticker:'111111',shares:7,buyPlan:plan}]}]}};
  const restored=c.cleanAssets(JSON.parse(JSON.stringify(doc))),merged=c.mergeAssets({version:1},restored,{version:1}).doc;
  assert.deepEqual(merged,doc);
  const rules=c.purchaseAlertRules(merged,{stocks:{'111111':{kind:'국내',ma:{'25선':15000,'32선':16000}}}});
  assert.equal(rules.find(r=>r.id==='trade:buy:a:25선:0').targetPrice,10000,'부분 체결 회차의 잔량도 알림에 포함');
  const item=merged.allocation.groups[0].items[0];item.buyPlan={notify:{stages:true},stages:[{id:'s',price:10000,plannedShares:10,shares:7,amount:10,actual:7,partial:true}]};
  assert.deepEqual(c.purchaseSummary(item.buyPlan),{count:1,done:0,planned:10,actual:7,remaining:3});
  assert.equal(c.purchaseAlertRules(merged,null)[0].id,'trade:buy:a:s','직접 입력의 부분 체결도 잔량 알림 유지');
  item.buyPlan.stages[0].done=true;delete item.buyPlan.stages[0].partial;
  assert.equal(c.purchaseAlertRules(merged,null).length,0);
});

test('분할매수 휴대폰 알림(이동평균선 돌파): 지금 이동평균 회차 가격으로 상승 알림, 이력은 단계 이름·회차로 이어지고 산 회차·OFF는 빠진다', () => {
  const assets = {allocation:{groups:[{items:[{id:'a', ticker:'AAA', name:'비공개', buyPlan:{currency:'USD', lines:{names:['25선','32선'], end:110, budget:40},
    buys:{'25선:0':{actual:10, price:100}}, notify:{stages:true, keys:{'25선:2':false}}}}]}]}};
  const doc = {stocks:{AAA:{kind:'해외', asOf:'2026-01-02', close:99, ma:{'25선':100, '32선':103}}}};
  const rules = c.purchaseAlertRules(assets, doc);
  assert.deepEqual(rules.map(r => [r.id, r.label, r.condition, r.revision]), [
    ['trade:buy:a:25선:1', '분할매수 25선 2차', 'up', '["25선",1,"32선"]'],
    ['trade:buy:a:32선:0', '분할매수 32선 1차', 'up', '["32선",0,null]'],
    ['trade:buy:a:end', '분할매수 목표가', 'up', '["end",110]'],
  ]);
  near(rules[0].targetPrice, 101, '25선 2차 가격');
  const moved = JSON.parse(JSON.stringify(doc));moved.stocks.AAA.ma['25선'] = 101;
  assert.equal(c.purchaseAlertRules(assets, moved)[0].revision, rules[0].revision, '이평선이 움직여도 같은 이력');
  doc.stocks.AAA.kind = '국내';
  assert.deepEqual(c.purchaseAlertRules(assets, doc).map(r => r.id), ['trade:buy:a:end'], '시세 종류가 다르면 이동평균을 쓰지 않음(목표가 회차만)');
});

test('분할매수 계획은 JSON 복원과 기기 간 병합에서 체결 기록을 보존하고 보유량·점검 기록과 독립적이다', () => {
  const base={version:1,allocation:{savedAt:'2026-01-01',classes:[{id:'c',region:'국내'}],cash:[],groups:[{id:'g',classId:'c',items:[{id:'a',amount:100,target:10,done:true,buyPlan:{stages:[{id:'s',amount:30}],note:'예시 계획'}}]}]}};
  const remote=JSON.parse(JSON.stringify(base));remote.allocation.savedAt='2026-01-02';
  const item=remote.allocation.groups[0].items[0];item.buyPlan.stages[0].done=true;item.buyPlan.stages[0].actual=25;
  const restored=c.cleanAssets(JSON.parse(JSON.stringify(remote))),merged=c.mergeAssets(base,restored,base);
  assert.deepEqual(merged.doc,remote,'완료·실제 금액·메모가 복원·구역 병합에서 유지된다');
  assert.equal(merged.doc.allocation.groups[0].items[0].done,true,'종목 점검완료는 별도 기록');
  assert.equal(c.allocationSummary(merged.doc.allocation,null).invest,c.allocationSummary(base.allocation,null).invest,'매수 완료 체크는 평가액에 반영하지 않는다');
  assert.equal(c.allocationTargets(merged.doc.allocation).classes.get('c').target,10,'목표도 그대로 유지한다');
});

test('기준 총자산: 억·만원 입력을 기존 만원 숫자로 저장하고 소수 금액도 유지한다', () => {
  for (const [text, amount] of [['13567.89', 13567.89], ['13,567.89만원', 13567.89], ['1억 3,567.89만원', 13567.89], ['1.5억원', 15000], ['1억', 10000], ['350만', 350], ['1억5000원', 10000.5], ['5000원', 0.5]])
    assert.equal(c.parseAllocationTotal(text), amount, text);
  assert.equal(c.parseAllocationTotal('  '), null, '비우면 합계 기준');
  for (const text of ['-1', 'abc', '1억 잘못입력', '1억5000', 'NaN', 'Infinity', '만원'])
    assert.ok(Number.isNaN(c.parseAllocationTotal(text)), `${text}: 잘못된 입력을 빈칸으로 처리해 기준을 지우지 않음`);
  assert.equal(c.allocationTotalText(13567.89), '1억 3,567.89만원');
  assert.equal(c.allocationTotalText(10000), '1억원');
  assert.equal(c.allocationTotalText(350.5), '350.5만원');
  assert.equal(c.allocationTotalText(null), '');
  for (const amount of [0, 0.000005, 9999.9999, 10000, 10000.0001, 13567.89, 1000000.123456])
    assert.equal(c.parseAllocationTotal(c.allocationTotalText(amount)), amount, `${amount}: 표시를 다시 입력해도 금액 유지`);
});

test('종목 평가액: 수량 × 현재가(달러는 × 환율) → 금액 × 시세 변동 → 넣은 금액', () => {
  near(c.itemValue({shares: 30, ticker: '111111'}, prices, 1000).value, 30, '국내 30주 × 1만원 = 30만원');
  const usd = c.itemValue({shares: 4, ticker: 'aaa'}, prices, 1000);
  near(usd.value, 20, '달러 4주 × $50 × 1,000원 = 20만원'); assert.equal(usd.how, 'shares');
  const ratio = c.itemValue({amount: 100, ticker: 'AAA', base: 40000}, prices, 1000);
  near(ratio.value, 125, '넣을 때 원화 4만원 → 지금 5만원이면 100만원 × 1.25'); assert.equal(ratio.how, 'ratio');
  assert.deepEqual({...c.itemValue({amount: 70, ticker: 'BAD'}, prices, 1000), q: null}, {value: 70, how: 'amount', q: null});
  assert.equal(c.itemValue({amount: 70, ticker: 'AAA'}, prices, null).how, 'amount', '환율이 없으면 달러 시세로 환산하지 않음');
  assert.equal(c.itemValue({amount: 70}, prices, 1000).value, 70);
});

test('금액만 넣은 종목의 기준 가격은 한 번만 정하고, 금액을 고치면 다시 잡는다', () => {
  const alloc = {groups: [{items: [{id: 'a', amount: 100, ticker: 'AAA'}, {id: 'b', amount: 50, ticker: '111111', shares: 3}, {id: 'c', amount: 0, ticker: 'AAA'}, {id: 'd', amount: 10, ticker: 'NONE'}]}]};
  assert.equal(c.fillBases(alloc, prices), true);
  const [a, b, z, d] = alloc.groups[0].items;
  assert.equal(a.base, 50000); assert.equal(a.baseAt, '2026-01-02');
  assert.equal(b.base, undefined, '수량이 있으면 기준 가격이 필요 없음'); assert.equal(z.base, undefined, '금액 0은 제외'); assert.equal(d.base, undefined, '시세 없으면 비움');
  assert.equal(c.fillBases(alloc, prices), false, '이미 정했으면 바꾸지 않음');
  const later = {...prices, stocks: {...prices.stocks, AAA: {kind: '해외', asOf: '2026-01-05', close: 60}}};
  a.amount = 120; c.resetBase(a, later, {});
  assert.equal(a.base, 60000); assert.equal(a.baseAt, '2026-01-05');
  c.resetBase(d, later, {}); assert.equal('base' in d, false);
});

test('자산 배분 합계: 그룹·분류·지역, 현금 분류, 빼는 현금, 기준 총자산', () => {
  const alloc = {total: null, cashFx: 1300,
    classes: [{id: 'k1', region: '국내', name: '주식', target: 10}, {id: 'u1', region: '미국', name: '주식', target: 20}, {id: 'u2', region: '미국', name: '채권'}, {id: 'cash', region: '현금', name: '현금', cash: true, target: 5}, {id: 'x', region: '새 지역', name: '기타'}],
    groups: [{id: 'g1', classId: 'u1', items: [{id: 'i1', amount: 100, section: '일반'}, {id: 'i2', shares: 2, ticker: 'AAA', amount: 1, section: '일반'}, {id: 'i3', amount: 30, section: '커버드콜'}]},
      {id: 'g2', classId: 'k1', items: [{id: 'i4', amount: 40}]}, {id: 'g3', classId: 'x', items: []}],
    cash: [{amount: 1000000, currency: 'KRW'}, {amount: 100, currency: 'USD'}, {amount: 200000, currency: 'KRW', minus: true}]};
  const s = c.allocationSummary(alloc, prices);
  near(s.fx, 1000, '시세 환율이 직접 넣은 환율보다 우선');
  near(s.groups.get('g1'), 140, 'g1 = 100 + 2주×$50×1000/1만 + 30');
  near(s.section('g1', '일반'), 110, '소분류 합'); near(s.section('g1', '없음'), 0, '없는 소분류');
  near(s.cash, 90, '현금 = 100만 + $100×1000 − 20만 = 90만원');
  near(s.classes.get('cash'), 90, '현금 분류에 현금 합계');
  near(s.invest, 180, '종목 합'); near(s.grand, 270, '종목 + 현금'); near(s.base, 270, '기준 총자산이 없으면 합계');
  assert.deepEqual(s.regions.map(r => r.name), ['미국', '국내', '현금', '새 지역'], '정한 지역 순서 뒤에 새 지역');
  const us = s.regions[0]; near(us.value, 140, '미국'); assert.equal(us.target, 20, '목표 없는 분류는 0으로 더함');
  assert.equal(s.regions[3].target, null, '목표가 하나도 없으면 null');
  near(s.pct(27), 10, '비중');
  near(c.allocationSummary({...alloc, total: 540}, prices).pct(27), 5, '기준 총자산을 넣으면 그 값 기준');
  near(c.allocationSummary({...alloc}, null).cash, (1000000 + 130000 - 200000) / 1e4, '시세가 없으면 직접 넣은 환율');
});

test('중국 분류: 기존 연결·목표·기록을 보존하고 해외의 인도 다음에 합산한다', () => {
  const alloc={total:1000,cash:[],classes:[{id:'cn',region:'중국',name:'주식',target:30},
    {id:'kr',region:'국내',name:'주식'}, {id:'jp',region:'해외',name:'일본'},
    {id:'in',region:'해외',name:'인도'}, {id:'eu',region:'해외',name:'유럽'}],
    groups:[{id:'cn-g',classId:'cn',items:[{id:'cn-i',amount:100,target:10}]},
      {id:'in-g',classId:'in',items:[{id:'in-i',amount:200,target:20}]}]};
  const before=JSON.stringify(alloc), s=c.allocationSummary(alloc,null);
  assert.deepEqual(s.regions.map(r=>r.name),['국내','해외']);
  const overseas=s.regions.find(r=>r.name==='해외');
  assert.deepEqual(overseas.classes.map(x=>[x.id,x.name]),[['jp','일본'],['in','인도'],['cn','중국'],['eu','유럽']]);
  assert.equal(overseas.value,300);assert.equal(overseas.target,30);
  assert.equal(s.classes.get('cn'),100);assert.equal(s.targets.classes.get('cn').target,10);
  assert.equal(JSON.stringify(alloc),before,'표시·합산만으로 저장 기록을 바꾸지 않는다');
  alloc.classes[0]={...alloc.classes[0],region:'해외',name:'중국'};
  assert.deepEqual(c.allocationSummary(alloc,null).regions.find(r=>r.name==='해외').classes.map(x=>x.id),['jp','in','cn','eu']);
});

test('월별 손익: 옛 대출 계좌는 계산에서 빼고 월·연도·연환산은 같은 자산 기준을 사용한다', () => {
  const year = {accounts: [{name: 'A'}, {name: '대출', loan: true}, {name: 'B'}], futures: -1000,
    months: [{m: 2, pnl: 2000, balances: [100000, 50000]}, {m: 1, total: 100000}, {m: 3, pnl: 1000, interest: -50, balances: [150000, null, 50000]}, {m: 4, balances: [200000]}]};
  assert.deepEqual(c.monthTotals(year, year.months[0]), {total: 100000, noLoan: 100000});
  assert.deepEqual(c.monthTotals(year, year.months[1]), {total: null, noLoan: null}, '옛 대출 계좌가 있으면 총액에서 자산을 추정하지 않는다');
  assert.deepEqual(c.monthTotals({accounts: []}, {total: 100000}), {total: 100000, noLoan: 100000}, '계좌가 없으면 직접 넣은 총자산');
  assert.deepEqual(c.monthTotals({accounts: [{name: 'A'}]}, {m: 1, balances: [10]}), {total: 10, noLoan: 10});
  const y = c.yearSummary(year);
  assert.equal(y.pnl, 2000, '실현손익 3,000 + 선물옵션 −1,000'); assert.equal(y.monthPnl, 3000); assert.equal(y.months, 2);
  near(y.rate, 2000 / 100000 * 100 + 1000 / 200000 * 100 - 1000 / 200000 * 100, '월 수익률 합 + 선물옵션 ÷ 마지막 달(4월) 총자산');
  near(y.annual, (2000 / 100000 + 1000 / 200000 - 1000 / 200000) * 100 * 12 / 2, '연환산은 선물옵션을 포함한 연 수익률을 기록한 달 수로');
  assert.equal(y.interest, -50); assert.deepEqual(y.last, {m: 4, total: 200000, noLoan: 200000});
  near(y.rateNoLoan, 2000 / 100000 * 100 + 1000 / 200000 * 100 - 1000 / 200000 * 100, '대출 제외: 대출 계좌를 뺀 총자산으로 같은 방식');
  near(y.annualNoLoan,(2000/100000+1000/200000-1000/200000)*100*12/2,'대출 제외 연환산도 같은 분모를 사용');
  assert.equal(c.yearSummary({accounts: [{name: 'A'}], months: [{m: 1, pnl: 1, balances: [10]}]}).rateNoLoan, 10, '대출 계좌가 없는 해도 동일 자산 기준으로 수익률 표시');
  assert.equal(c.yearSummary({accounts: [], months: []}).annual, null);
});

test('월별 선물옵션은 그 달 총자산으로, 달을 모르는 연 합계는 마지막 총자산으로 나눠 연 수익률·연환산에 더한다',()=>{
  const year={accounts:[],futures:-1000,months:[{m:1,pnl:1000,futures:-500,total:100000},{m:2,futures:2000,total:200000},{m:3,pnl:3000,total:300000}]},before=JSON.stringify(year);
  const y=c.yearSummary(year);
  assert.deepEqual([y.futures,y.futuresYear,y.monthPnl,y.pnl,y.months],[500,-1000,4000,4500,2],'선물옵션 = 월별 1,500 + 연 합계 −1,000');
  near(y.rate,1+1-0.5+1-1000/300000*100,'실현손익 1%+1%, 월별 선물옵션 −0.5%+1%, 연 합계 ÷ 3월 총자산');
  near(y.annual,(1+1-0.5+1-1000/300000*100)*12/3,'연환산은 선물옵션 포함 연 수익률 × 12 ÷ 실현손익이나 선물옵션을 기록한 3개월');
  const only=c.yearSummary({accounts:[],months:[{m:1,futures:300,total:1000}]});
  assert.deepEqual([only.futures,only.futuresYear,only.pnl,only.months],[300,null,300,0]);near(only.rate,30,'선물옵션만 있는 해');near(only.annual,360,'선물옵션만 기록한 달도 연환산 개월 수에 센다');
  assert.equal(c.yearSummary({accounts:[],futures:100,months:[{m:1,total:1000}]}).annual,null,'달을 모르는 연 합계만 있는 해는 연환산하지 않는다');
  assert.equal(c.yearSummary({accounts:[],months:[{m:1,pnl:10,total:1000},{m:2,futures:5}]}).rate,null,'선물옵션을 넣은 달의 총자산이 없으면 연 수익률을 계산하지 않는다');
  assert.equal(c.yearSummary({accounts:[],months:[{m:1,pnl:10,total:1000},{m:2,futures:5}]}).annual,null,'연 수익률이 없으면 연환산도 없다');
  assert.equal(c.yearSummary({accounts:[],months:[{m:1,pnl:10,total:1000}]}).futures,null,'선물옵션 기록이 없으면 null');
  assert.equal(JSON.stringify(year),before,'계산만으로 기록을 바꾸지 않는다');
});

test('달러 배당은 적용 환율로 반올림하고 저장된 환산액과 과거 환율을 유지한다',()=>{
  assert.equal(c.pnlDollarKrw(12.75,1310),16703);
  assert.equal(c.pnlDollarKrw(-2,1310),-2620);
  assert.equal(c.pnlDollarKrw(0,null),0);
  for(const rate of [null,0,-1,'bad'])assert.equal(c.pnlDollarKrw(2,rate),null);
  assert.equal(c.pnlDollarKrw(null,1310),null);
  assert.equal(c.pnlDollarKrw(Number.MAX_VALUE,1310),null);
  const old={amount:4,currency:'USD',krw:5200}, snapshot={amount:4,currency:'USD',fx:1300,krw:5200};
  assert.equal(c.pnlDollarFx(old,1500),1300);
  assert.equal(c.pnlDollarFx(snapshot,1500),1300);
  assert.equal(c.pnlDollarFx({},1500),1500);
  assert.equal(c.pnlEntriesTotal([{amount:4,currency:'USD',fx:1300}]),5200);
  assert.equal(c.pnlEntriesTotal([{...snapshot,fx:1500}]),5200,'원화 환산액을 현재 환율로 바꾸거나 이중 합산하지 않는다');
  assert.deepEqual(old,{amount:4,currency:'USD',krw:5200},'읽기만 해서는 fx를 저장하지 않는다');
});

test('배당 자동 환율은 현물 환율과 125일선 대신 125개월선만 사용한다',()=>{
  const prices={fx:{close:1800,ma:{'125일선':1700,'125개월선':1320}}};
  assert.equal(c.assetDividendFx(prices),1320);
  assert.equal(c.pnlDollarKrw(15,c.assetDividendFx(prices)),19800);
  for(const value of [null,0,-1,'bad',Infinity])assert.equal(c.assetDividendFx({fx:{close:1800,ma:{'125개월선':value}}}),null);
  assert.equal(c.assetDividendFx({fx:{close:1800,ma:{'125일선':1700}}}),null);
  assert.equal(c.assetDividendFx(null),null);
});

test('옛 대출 계좌를 숨겨도 남은 계좌와 잔액의 원래 위치를 유지한다',()=>{
  const year={accounts:[{name:'old',loan:true},{name:'A'},{name:'old2',loan:true},{name:'B'}],months:[{m:1,balances:[5000,2000,3000,4000],pnl:60}]};
  const before=JSON.stringify(year), rows=c.ledgerAccounts(year);
  assert.deepEqual(rows.map(r=>[r.index,r.account.name]),[[1,'A'],[3,'B']]);
  assert.equal(c.monthTotals(year,year.months[0]).total,6000);
  assert.equal(c.yearSummary(year).rate,1);
  assert.equal(JSON.stringify(year),before,'기존 계좌와 잔액 배열을 정규화하거나 삭제하지 않는다');
});

test('손익 상세: 원화와 달러 입금액을 한 번씩 합산하고 월·연도 요약이 같은 기록을 사용한다',()=>{
  const month={m:9,pnl:999999,pnlEntries:[
    {broker:'A증권',label:'기본계좌+ISA',amount:2400},
    {broker:'A증권',label:'연금저축',amount:900},
    {broker:'B증권',label:'실현손익',amount:-10000},
    {broker:'B증권',label:'배당입금내역',amount:4,currency:'USD',krw:5200}],balances:[100000,50000]};
  const year={accounts:[{name:'자산'},{name:'대출',loan:true}],months:[month],futures:500},before=JSON.stringify(year);
  assert.equal(c.monthPnl(month),-1500);assert.equal(c.pnlEntriesTotal(month.pnlEntries),-1500);
  assert.equal(c.yearSummary(year).pnl,-1000);near(c.yearSummary(year).rateNoLoan,-1,'월 손익과 선물 모두 대출 제외 기준');
  assert.equal(JSON.stringify(year),before,'표시·계산 중 저장된 합계나 상세 필드를 바꾸지 않는다');
  assert.equal(c.monthPnl({m:1,pnl:0}),0);assert.equal(c.monthPnl({m:1,pnl:123,pnlEntries:[]}),123);
  assert.equal(c.pnlEntriesTotal([{amount:0,currency:'USD',krw:0}]),0);
  assert.equal(c.monthPnl({pnl:100,pnlEntries:[{amount:4,currency:'USD'}]}),null,'환산액이 빠지면 이전 합계를 대신 표시하지 않음');
  assert.equal(c.pnlEntriesTotal([{krw:100,currency:'USD'}]),null,'달러 원금도 필요');
});

test('연평균: 대출 제외 연 수익률의 산술평균에 0% 해는 포함하고 빈 해·잔액 누락 해는 제외한다',()=>{
  const years=[
    {accounts:[{name:'자산'},{name:'대출',loan:true}],months:[{m:1,pnl:100,balances:[1000,1000]}],futures:20},
    {accounts:[],months:[{m:1,pnl:-40,total:1000}]},
    {accounts:[],months:[{m:1,pnl:0,total:1000}]},
    {accounts:[],months:[]},
    {accounts:[],months:[{m:1,pnl:100}]}];
  const before=JSON.stringify(years);
  near(c.averageYearReturn(years).rate,(12-4+0)/3,'선물 포함, 총자산의 대출 포함 수익률을 평균내지 않는다');
  assert.equal(c.averageYearReturn(years).years,3);assert.deepEqual(c.averageYearReturn([]),{rate:null,years:0});
  assert.equal(JSON.stringify(years),before);
});

test('잔액을 계산할 수 없으면 수익률을 0%나 일부 월 합으로 표시하지 않는다',()=>{
  const noLoan={accounts:[],months:[{m:1,pnl:100,total:1000},{m:2,pnl:100}]};
  assert.equal(c.yearSummary(noLoan).rateNoLoan,null);assert.equal(c.yearSummary(noLoan).annualNoLoan,null);
  const loan={accounts:[{name:'대출',loan:true}],months:[{m:1,pnl:100,total:1000}]};
  assert.equal(c.yearSummary(loan).rateNoLoan,null,'대출 계좌가 있는데 계좌별 잔액이 없으면 대출 제외 분모를 추정하지 않는다');
  loan.months[0].balances=[1000];assert.equal(c.yearSummary(loan).rateNoLoan,null,'대출 제외 0원은 분모로 사용 불가');
  const fut={accounts:[],futures:100,months:[{m:1,total:1000},{m:2,total:0}]};
  assert.equal(c.yearSummary(fut).rateNoLoan,null,'최신 자산 0원일 때 이전 잔액으로 선물 수익률을 계산하지 않는다');
  assert.equal(c.yearSummary(fut).last.m,2);
});

test('금액 쉼표는 음수·0·소수 입력을 유지하며 기존 숫자 저장·복원과 호환된다',()=>{
  for(const [raw,shown,value] of [['12345678','12,345,678',12345678],['-1234567','-1,234,567',-1234567],['0','0',0],['12345.60','12,345.60',12345.6],['1234.','1,234.',1234],['.5','.5',.5]]){
    assert.equal(c.assetNumberText(raw),shown);assert.equal(c.parseAssetNumber(shown),value);assert.equal(c.assetNumberText(shown),shown);
  }
  for(const raw of ['',null,'잘못된 금액','-',NaN,Infinity])assert.equal(c.parseAssetNumber(raw),null);
  const original={version:1,ledger:{years:[{accounts:[],months:[{m:1,pnl:0,interest:-20,pnlEntries:[{broker:'A',amount:0}]}]}]}};
  assert.deepEqual(c.cleanAssets(JSON.parse(JSON.stringify(original))),original,'옛 이자와 상세 내역을 불러오기만 할 때 바꾸지 않는다');
});

test('저축 계획: 매달 월급 − 기부 − 사용금액, 12월에 전년 12월 × 수익률(기부 뺌), 나이별 단계', () => {
  const sv = {startYear: 2020, startAge: 30, actual: [{ym: '2020-12', total: 1000}, {ym: '2021-10', total: 2000}]};
  const sc = {salary: 100, giving: 10, spending: 20, spendingYear: 2021, growth: 10, returnRate: 10, endAge: 33,
    stages: [{age: 32, salary: 50, returnRate: 20}, {age: 33, spending: 5}]};
  const r = c.simulateSavings(sv, sc);
  assert.deepEqual(r.last, {ym: '2021-10', total: 2000});
  // 2021: 11월 2000 + 100 − 10 − 20 = 2070, 12월 + 70 + 1000 × 10% × 0.9 = 2230
  const y21 = r.rows.find(x => x.year === 2021);
  near(y21.end, 2230, '2021년 말'); near(y21.returns, 90, '기부 뺀 수익'); assert.equal(y21.actual, false);
  near(y21.salaryGiving, 20, '실제 기록 이후 2개월의 월급 기부');near(y21.returnGiving, 10, '연 투자수익 기부');near(y21.giving, 30, '월급 기부 + 투자수익 기부');
  // 2022(32세): 월급 50, 사용금액 20 × 1.1 = 22, 12월 수익 = 2230 × 20% × 0.9
  const y22 = r.rows.find(x => x.year === 2022);
  near(y22.end, 2907.4, '2022년 말');
  near(y22.returnGiving, 44.6, '나이별 연 수익률 변경을 투자수익 기부에도 적용');near(y22.giving, 60 + 44.6, '매년 월급·투자수익 기부 합산');
  // 2023(33세): 사용금액 5로 재설정
  const y23 = r.rows.find(x => x.year === 2023);
  near(y23.end, y22.end + 12 * (50 - 5 - 5) + y22.end * 0.2 * 0.9, '2023년 말');
  assert.equal(r.rows[r.rows.length - 1].year, 2023, '종료 나이 해까지');
  assert.equal(r.rows[0].year, 2020); assert.equal(r.rows[0].actual, true); assert.equal(r.rows[0].end, 1000);
  assert.equal(r.at(33), y23.end); assert.equal(r.at(99), null);
  assert.deepEqual(c.savingsStage(sc, 32), {salary: 50, growth: 10, returnRate: 20});
  assert.equal(c.simulateSavings({...sv, actual: []}, sc), null, '실제 기록이 없으면 계산하지 않음');
  assert.equal(c.ymText(c.ymNum('2026-12') + 1), '2027-01'); assert.equal(c.ymNum('2026-13'), null);
  assert.deepEqual(c.missingActual({actual: [{ym: '2026-03', total: 1}, {ym: '2025-12', total: 1}, {ym: '2026-02', total: null}]}), ['2026-01', '2026-02'], '첫 달~마지막 달 사이 빈 달');
  assert.deepEqual(c.missingActual({actual: []}), []);
});

test('5억 달성: 연말보다 앞선 최초 월말을 찾고 경계값·연도 나이·나이별 변경을 적용한다',()=>{
  const sv={startYear:2030,startAge:36,actual:[{ym:'2030-12',total:499000000}]};
  const sc={salary:1000000,giving:0,spending:0,growth:0,returnRate:0,endAge:38,stages:[]};
  const before=JSON.stringify([sv,sc]),sim=c.simulateSavings(sv,sc);
  assert.deepEqual(c.savingsMilestone(sim),{ym:'2031-01',age:37,total:500000000,actual:false});
  assert.equal(sim.rows[1].end,511000000);assert.equal(sim.months.find(m=>m.ym==='2032-01').total,512000000);
  assert.equal(JSON.stringify([sv,sc]),before,'월별 관측·달성 조회는 입력에 필드를 만들지 않는다');
  assert.equal(c.savingsMilestone(c.simulateSavings(sv,{...sc,salary:500000})).ym,'2031-02');
  assert.equal(c.savingsMilestone(c.simulateSavings(sv,{...sc,salary:0,stages:[{age:38,salary:1000000}]})).ym,'2032-01');
  const below=c.simulateSavings({...sv,actual:[{ym:'2030-12',total:499999999.99}]},{...sc,salary:0});
  assert.equal(c.savingsMilestone(below),null,'표시 반올림으로 5억처럼 보여도 원래 잔액이 미달이면 달성하지 않는다');
  assert.equal(c.savingsMilestone(null),null);assert.equal(c.simulateSavings({...sv,actual:[]},sc),null);
});

test('5억 달성: 12월 수익·기부를 모두 반영한 월말을 읽고 이후 손실에도 최초 달성 월을 유지한다',()=>{
  const sv={startYear:2030,startAge:36,actual:[{ym:'2030-12',total:450000000}]};
  const sc={salary:1000000,giving:10,spending:100000,spendingYear:2031,growth:10,returnRate:10,endAge:38,stages:[{age:38,salary:2000000,returnRate:-10}]};
  const sim=c.simulateSavings(sv,sc),first=sim.rows[1],next=sim.rows[2];
  assert.equal(sim.months.find(m=>m.ym==='2031-11').total,458800000);
  assert.deepEqual(c.savingsMilestone(sim),{ym:'2031-12',age:37,total:500100000,actual:false});
  assert.equal(first.returnGiving,4500000);assert.equal(first.returns,40500000);assert.equal(first.end,500100000);
  assert.equal(sim.months.find(m=>m.ym==='2032-01').total,501790000,'기부 차감 후 연말 잔액을 다음 해에 그대로 이월한다');
  assert.equal(next.returns,-50010000);assert.equal(next.returnGiving,0);assert.equal(next.end,470370000);
  assert.equal(c.savingsMilestone(c.simulateSavings(sv,{...sc,returnRate:0,stages:[]})),null);
});

test('5억 달성: 누락 실제 월을 보간하지 않고 기록된 월말만 사용하며 예측 종료 월을 넘지 않는다',()=>{
  const sv={startYear:2030,startAge:36,actual:[{ym:'2030-01',total:499000000},{ym:'2030-03',total:500000000},{ym:'2030-13',total:600000000}]};
  const sc={salary:0,endAge:36},sim=c.simulateSavings(sv,sc);
  assert.equal(sim.months.some(m=>m.ym==='2030-02'),false);
  assert.deepEqual(c.savingsMilestone(sim),{ym:'2030-03',age:36,total:500000000,actual:true});
  assert.equal(c.savingsMilestone(c.simulateSavings({...sv,actual:[{ym:'2030-12',total:499000000}]},{salary:1000000,endAge:36})),null);
  assert.equal(c.savingsMilestone(c.simulateSavings({...sv,actual:[{ym:'2031-01',total:500000000}]},sc)),null);
});

test('저축 최단 기록: 새 가정·다른 기기·옛 동기화 기준과 병합해도 가장 빠른 기록만 보존한다',()=>{
  const savings={savedAt:'T1',actual:[],scenarios:[{id:'base',salary:1}],milestoneRecord:{ym:'2031-01',age:37}};
  const base={version:1,savings},local={version:1,savings:{...savings,savedAt:'T2',milestoneRecord:{ym:'2030-12',age:36}}};
  const remote={version:1,savings:{...savings,savedAt:'T3',scenarios:[{id:'base',salary:2}]}};
  const before=JSON.stringify([base,local,remote]),merged=c.mergeAssets(local,remote,base);
  assert.deepEqual(merged.doc.savings.scenarios,remote.savings.scenarios,'가정은 기존 구역 병합 규칙대로 선택한다');
  assert.deepEqual(merged.doc.savings.milestoneRecord,local.savings.milestoneRecord);
  delete remote.savings.milestoneRecord;
  assert.deepEqual(c.mergeAssets(base,remote,base).doc.savings.milestoneRecord,savings.milestoneRecord,'옛 기기에서 새 필드가 사라져도 기록 유지');
  assert.equal(JSON.stringify([base,local,{...remote,savings:{...remote.savings,milestoneRecord:savings.milestoneRecord}}]),before,'병합은 원본을 수정하지 않는다');
  assert.equal(c.earlierSavingsRecord({ym:'잘못된 날짜'},{ym:'2031-13'}),null);
});

test('저축 계획: 투자손실·수익률 0은 수익 기부를 만들지 않고 손실은 전액 반영한다',()=>{
  for(const rate of [-10,0,10]){
    const sv={startYear:2020,startAge:30,actual:[{ym:'2020-12',total:1000}]},sc={salary:100,giving:10,spending:20,spendingYear:2021,growth:0,returnRate:rate,endAge:31};
    const before=JSON.stringify([sv,sc]),row=c.simulateSavings(sv,sc).rows[1],donation=rate>0?10:0;
    near(row.returnGiving,donation,'양수 투자수익만 기부');near(row.salaryGiving,120,'월급 기부');near(row.giving,120+donation,'연 기부 합계');
    near(row.returns,1000*rate/100-donation,'기부 후 투자수익·손실');near(row.end,1000+12*70+1000*rate/100-donation,'기부와 손실을 중복 차감하지 않음');
    assert.equal(JSON.stringify([sv,sc]),before,'조회만으로 실제 기록·가정에 필드를 생성하지 않음');
  }
});

test('저축 계획: 연도별 월 입력은 기존 기록과 필드를 보존하고 0·쉼표·빈칸을 구분한다',()=>{
  const sv={startYear:2020,startAge:30,actual:[{ym:'2020-12',total:1000,note:'가상 기록'}],scenarios:[{id:'s',endAge:31}]};
  assert.equal(c.setSavingsActual(sv,'2021-06','2,000'),true);assert.deepEqual(sv.actual,[{ym:'2020-12',total:1000,note:'가상 기록'},{ym:'2021-06',total:2000}]);
  const sc={salary:100,giving:10,spending:20,spendingYear:2021,growth:0,returnRate:10,endAge:31};
  assert.equal(c.simulateSavings(sv,sc).last.ym,'2021-06');near(c.simulateSavings(sv,sc).rows[1].salary,600,'새 마지막 기록 다음 달부터 다시 계산');
  assert.equal(c.setSavingsActual(sv,'2020-12','1,500'),true);assert.equal(sv.actual[0].note,'가상 기록');
  assert.equal(c.setSavingsActual(sv,'2021-06','0'),true);assert.equal(c.simulateSavings(sv,sc).last.total,0,'0원도 실제 기록');
  const before=JSON.stringify(sv);
  for(const [ym,value] of [['2021-06','0'],['2021-13','100'],['2021-06','잘못된 값'],['2021-06','Infinity'],['2021-07','']])assert.equal(c.setSavingsActual(sv,ym,value),false);
  assert.equal(JSON.stringify(sv),before,'같은 값·잘못된 입력·이미 빈 달은 저장 기록을 바꾸지 않음');
  assert.equal(c.setSavingsActual(sv,'2021-06',''),true);assert.equal(c.simulateSavings(sv,sc).last.ym,'2020-12');
  assert.deepEqual(sv.scenarios,[{id:'s',endAge:31}]);assert.deepEqual(sv.actual,[{ym:'2020-12',total:1500,note:'가상 기록'}]);
  assert.equal(c.setSavingsActual(sv,'2020-12',''),true);assert.equal(c.simulateSavings(sv,sc),null,'마지막 기록도 비우면 예상 계산을 멈춤');
});

test('저축 계획: 이지·하드의 월별 실제 입력과 나이별 가정을 보존한다',()=>{
  const easy={id:'easy',name:'이지',salary:100,giving:10,spending:20,spendingYear:2026,growth:10,returnRate:10,endAge:32,
    stages:[{age:32,salary:50,returnRate:20}]};
  const hard={...structuredClone(easy),id:'hard',name:'하드',salary:40,growth:0,returnRate:0,stages:[]};
  const sv={startYear:2025,startAge:30,actual:[{ym:'2025-12',total:1000},{ym:'2026-10',total:2000}],scenarios:[easy,hard]};
  const doc={version:1,savings:structuredClone(sv)},before=JSON.stringify(doc),loaded=c.cleanAssets(doc);
  const result=c.simulateSavings(loaded.savings,loaded.savings.scenarios[0]);
  near(result.at(31),2230,'이지 11·12월 저축 140 + 수익 90');
  near(result.at(32),2907.4,'이지 다음 해 저축 276 + 수익 401.4');
  near(c.simulateSavings(loaded.savings,hard).at(31),2032,'하드의 연말 저축');
  near(c.simulateSavings(loaded.savings,hard).at(32),2224,'하드의 다음 연도 저축');
  assert.equal(JSON.stringify(doc),before,'계산·조회로 기존 값이나 선택 필드를 바꾸지 않음');
  assert.equal(c.setSavingsActual(loaded.savings,'2026-11','2,070'),true);
  const updated=c.simulateSavings(loaded.savings,easy);
  assert.equal(updated.last.ym,'2026-11');near(updated.at(31),2230,'11월 실제 입력 후 12월부터 계산');near(updated.at(32),2907.4,'다음 연도 수익·자산 동일');
  assert.ok(loaded.savings.scenarios.every(sc=>!Object.hasOwn(sc,'events')),'새 가정에는 삭제된 기능의 필드를 만들지 않는다');
});

test('저축 계획: 옛 할부·큰 지출 기록은 예측에 반영하지 않고 불러오기·병합에도 기존 데이터를 보존한다',()=>{
  const sc={id:'easy',name:'이지',salary:100,giving:10,spending:20,spendingYear:2026,growth:10,returnRate:10,endAge:32,
    stages:[{age:32,salary:50,returnRate:20}],note:'가상 설정'};
  const sv={savedAt:'T2',startYear:2025,startAge:30,actual:[{ym:'2025-12',total:1000,note:'가상 기록'},{ym:'2026-10',total:2000}],scenarios:[sc]};
  const baseline=c.simulateSavings(sv,sc);
  for(const events of [[
    {start:'2026-01',down:100,monthly:5,months:3},
    {start:'2026-09',down:999,monthly:3,months:6},
    {start:'2027-02',down:7,months:0},
    {start:'2027-06',monthly:12,months:2},
  ],{legacy:true}]){
    const legacy={...structuredClone(sv),scenarios:[{...structuredClone(sc),events}]};
    const doc={version:1,savings:legacy},before=JSON.stringify(doc),loaded=c.cleanAssets(doc);
    const merged=c.mergeAssets({version:1},loaded,{version:1}).doc;
    assert.deepEqual(loaded,doc,'불러오기에서 실제 입력·가정·선택 필드를 보존한다');
    assert.deepEqual(merged,doc,'기기 병합에서 삭제된 기능의 옛 기록 때문에 다른 데이터를 지우지 않는다');
    const result=c.simulateSavings(merged.savings,merged.savings.scenarios[0]);
    assert.deepEqual(result.rows,baseline.rows,'과거·진행 중·미래의 선수금과 월 납부는 월급·기부·사용금액·수익·연말 자산에 영향 없음');
    assert.deepEqual(result.last,baseline.last);assert.equal(result.endYear,baseline.endYear);
    for(const age of [30,31,32,99])assert.equal(result.at(age),baseline.at(age),'나이별 자산 예측도 동일');
    assert.equal(JSON.stringify(doc),before,'계산·불러오기·병합은 기존 기록을 변경하지 않는다');
  }
});

test('기기 간 병합: 구역마다 바뀐 쪽, 같은 칸을 둘 다 바꾸면 나중 저장 우선 + 버린 쪽 보관', () => {
  const base = {version: 1, allocation: {savedAt: 'T1', total: 1}, ledger: {savedAt: 'T1', years: []}};
  const local = {version: 1, allocation: {savedAt: 'T3', total: 2}, ledger: {savedAt: 'T1', years: []}, savings: {savedAt: 'T2', actual: [], scenarios: []}};
  const remote = {version: 1, allocation: {savedAt: 'T2', total: 3}, ledger: {savedAt: 'T4', years: [{year: 2026}]}};
  const {doc, lost} = c.mergeAssets(local, remote, base);
  assert.equal(doc.allocation.total, 2, '둘 다 바뀜 → savedAt 늦은 이 기기');
  assert.deepEqual(lost, [{section: 'allocation', data: remote.allocation}]);
  assert.equal(doc.ledger.savedAt, 'T4', '저장소만 바뀜 → 저장소'); assert.equal(doc.savings.savedAt, 'T2', '이 기기에만 있음 → 이 기기');
  assert.deepEqual(c.mergeAssets({version: 1}, remote, null).doc, remote, '빈 기기는 저장소를 그대로');
  assert.deepEqual(c.mergeAssets(local, {version: 1, allocation: {...base.allocation}}, base).doc.allocation, local.allocation, '이 기기만 바뀜');
  assert.equal(c.cleanAssets({version: 2}), null); assert.equal(c.cleanAssets([]), null);
  assert.deepEqual(c.cleanAssets({allocation: {}}).allocation, {classes: [], groups: [], cash: []});
  assert.equal(c.assetsBlank({version: 1}), true); assert.equal(c.assetsBlank(local), false);
});

test('기기 간 병합: 두 기기가 다른 종목·칸을 고치면 둘 다 남기고, 같은 칸만 나중 저장 값을 쓴다(가짜 기록)', () => {
  const it = (id, amount, extra = {}) => ({id, name: `가상 ${id}`, amount, ...extra});
  const base = {version: 1, allocation: {savedAt: 'T1', total: 10, classes: [{id: 'c', name: '주식'}], cash: [], groups: [{id: 'g', items: [it('x', 100), it('y', 200), it('z', 300)]}],
    trades: {'buy:x:25일선:0': {items: [{id: 't1', qty: 1}]}}}};
  const before = JSON.stringify(base), local = structuredClone(base), remote = structuredClone(base);
  local.allocation.savedAt = 'T2'; local.allocation.groups[0].items[0].amount = 150; local.allocation.groups[0].items.push(it('n1', 50));
  local.allocation.trades['buy:x:25일선:1'] = {items: [{id: 't2', qty: 2}]};
  remote.allocation.savedAt = 'T3'; remote.allocation.groups[0].items[1].note = '메모'; remote.allocation.groups[0].items.splice(2, 1); remote.allocation.groups[0].items.splice(1, 0, it('r1', 70));
  remote.allocation.trades['buy:x:25일선:0'].items[0].qty = 3;
  const lb = JSON.stringify(local), rb = JSON.stringify(remote);
  let {doc, lost, conflicts} = c.mergeAssets(local, remote, base);
  assert.deepEqual(doc.allocation.groups[0].items.map(x => [x.id, x.amount, x.note ?? '']), [['x', 150, ''], ['r1', 70, ''], ['y', 200, '메모'], ['n1', 50, '']], '이 기기 금액·새 종목 + 저장소 메모·새 종목, 저장소만 지운 z는 지움');
  assert.deepEqual(doc.allocation.trades, {'buy:x:25일선:0': {items: [{id: 't1', qty: 3}]}, 'buy:x:25일선:1': {items: [{id: 't2', qty: 2}]}}, '분할매수 체결 기록도 회차별로 합침');
  assert.equal(doc.allocation.savedAt, 'T3'); assert.deepEqual([lost, conflicts], [[], 0], '겹친 칸이 없으면 보관하지 않음');
  assert.equal(JSON.stringify([base, local, remote]), `[${before},${lb},${rb}]`, '병합은 원본을 바꾸지 않는다');
  // 같은 칸(x 금액)을 둘 다 고침 → 늦은 저장(저장소) 값, 다른 쪽 구역 전체를 보관
  remote.allocation.groups[0].items[0].amount = 180;
  ({doc, lost, conflicts} = c.mergeAssets(local, remote, base));
  assert.equal(doc.allocation.groups[0].items[0].amount, 180); assert.equal(doc.allocation.groups[0].items[2].note, '메모');
  assert.equal(conflicts, 1); assert.deepEqual(lost, [{section: 'allocation', data: local.allocation}]);
  // 한쪽이 지우고 다른 쪽이 고친 종목은 고친 쪽을 남긴다
  local.allocation.groups[0].items[2].amount = 333; remote.allocation.groups[0].items[0].amount = 150;
  ({doc, conflicts} = c.mergeAssets(local, remote, base));
  assert.equal(doc.allocation.groups[0].items.find(x => x.id === 'z').amount, 333); assert.equal(conflicts, 1);
});

test('기기 간 병합: 월별 손익은 연·월, 저축 실적은 연월로 합치고 키 없는 목록은 한 칸으로 본다(가짜 기록)', () => {
  const month = (m, pnl, balances = [1, 2]) => ({m, pnl, balances});
  const base = {version: 1, ledger: {savedAt: 'T1', years: [{year: 2026, accounts: [{name: '가상 계좌'}], months: [month(1, 10), month(2, 20)]}]},
    savings: {savedAt: 'T1', actual: [{ym: '2026-01', total: 1}], scenarios: [{id: 's', stages: [{age: 40}]}]}};
  const local = structuredClone(base), remote = structuredClone(base);
  local.ledger.savedAt = 'T2'; local.ledger.years[0].months.push(month(3, 30)); local.ledger.years[0].months[0].balances = [5, 2];
  local.savings.savedAt = 'T2'; local.savings.actual.push({ym: '2026-02', total: 2});
  remote.ledger.savedAt = 'T3'; remote.ledger.years[0].months[1].pnl = 25; remote.ledger.years[0].months[0].balances = [1, 6]; remote.ledger.years.push({year: 2027, accounts: [], months: []});
  remote.savings.savedAt = 'T3'; remote.savings.actual.push({ym: '2026-03', total: 3}); remote.savings.scenarios[0].stages[0].age = 41;
  const {doc, lost, conflicts} = c.mergeAssets(local, remote, base);
  assert.deepEqual(doc.ledger.years.map(y => y.year), [2026, 2027]);
  assert.deepEqual(doc.ledger.years[0].months.map(x => [x.m, x.pnl]), [[1, 10], [2, 25], [3, 30]]);
  assert.deepEqual(doc.ledger.years[0].months[0].balances, [1, 6], '계좌별 잔액(키 없는 목록)은 한 칸: 늦은 저장');
  assert.deepEqual(doc.savings.actual.map(a => a.ym), ['2026-01', '2026-02', '2026-03']); assert.equal(doc.savings.scenarios[0].stages[0].age, 41);
  assert.equal(conflicts, 1); assert.deepEqual(lost.map(x => x.section), ['ledger']);
  // 지난 기준에 없던 구역을 양쪽이 만들었으면 키·항목을 모두 남긴다(같은 칸만 늦은 쪽)
  const fresh = c.mergeAssets({version: 1, installments: {savedAt: 'T2', price: 1, months: 3}}, {version: 1, installments: {savedAt: 'T3', price: 2, fee: 5}}, {version: 1});
  assert.deepEqual(fresh.doc.installments, {savedAt: 'T3', price: 2, months: 3, fee: 5}); assert.equal(fresh.conflicts, 1);
});

// ---------- 플래너 체결 → 자산 배분 연동 ----------
// 시세 파일 키는 적힌 그대로(A 접두 포함)라 테스트 시세에도 둘 다 둔다
const lp = {...prices, stocks: {...prices.stocks, A111111: {kind: '국내', asOf: '2026-01-02', close: 10000}}};
const linkAlloc = () => ({cash: [], total: 1000, classes: [], groups: [
  {id: 'g1', target: 2, items: [{id: 'a', ticker: 'A111111', shares: 10, amount: 0}, {id: 'b', ticker: '111111', shares: 5, amount: 0}]},
  {id: 'g2', items: [{id: 'c', ticker: 'aaa', amount: 100, base: 40000}, {id: 'd', ticker: 'AAA', amount: 50, target: 1}, {id: 'e', ticker: 'BTC-USD', shares: 0.5, amount: 0}, {id: 'n', name: '코드 없음', amount: 30}]},
]});
const byId = (alloc, id) => alloc.groups.flatMap(g => g.items).find(it => it.id === id);

test('체결 연동: 같은 종목 코드 계좌(대소문자·국내 A 접두·비트코인)와 합계·목표·수량 합', () => {
  const alloc = linkAlloc();
  assert.equal(c.linkTicker(' a111111 '), '111111');
  assert.equal(c.linkTicker('비트코인'), 'BTC-USD');
  assert.deepEqual(c.linkedItems(alloc, '111111').map(x => x.it.id), ['a', 'b']);
  assert.deepEqual(c.linkedItems(alloc, 'AAA').map(x => x.it.id), ['c', 'd']);
  assert.deepEqual(c.linkedItems(alloc, '비트코인').map(x => x.it.id), ['e']);
  assert.deepEqual(c.linkedItems(alloc, '', 'n').map(x => x.it.id), ['n'], '분할매수 계획이 붙은 종목은 코드가 없어도 연결');
  assert.deepEqual(c.linkedItems(alloc, 'ZZZ'), []);
  const kr = c.linkSummary(alloc, lp, 'A111111');
  near(kr.value, 15, '10주 + 5주 × 1만원'); assert.equal(kr.shares, 15);
  assert.deepEqual([kr.target, kr.scope], [2, 'group'], '종목 목표가 없고 그룹 종목이 모두 연결되면 그룹 목표');
  near(kr.gap, 5, '목표 2% × 1,000만원 − 15만원'); near(kr.pct, 1.5, '기준 총자산 대비');
  const us = c.linkSummary(alloc, lp, 'AAA');
  near(us.value, 175, '125(시세 따라감) + 50'); assert.deepEqual([us.target, us.scope, us.shares], [1, 'item', null], '종목 목표 합, 금액 종목이 있으면 수량 합 없음');
  assert.equal(c.linkSummary(alloc, lp, 'ZZZ'), null);
});

test('체결 연동: 계좌마다 단위(수량·금액)와 미리 채울 양', () => {
  const alloc = linkAlloc();
  assert.deepEqual(c.tradeRows(alloc, lp, '111111', {sign: -1, qty: 3, price: 9000, currency: 'KRW'}).map(r => [r.it.id, r.unit, r.n]), [['a', 'shares', 3], ['b', 'shares', 3]]);
  assert.deepEqual(c.tradeRows(alloc, lp, 'AAA', {sign: -1, qty: 2, price: 60, currency: 'USD'}).map(r => [r.it.id, r.unit, r.n]), [['c', 'amount', 12], ['d', 'amount', 12]], '2주 × $60 × 1,000원 = 12만원');
  assert.deepEqual(c.tradeRows(alloc, lp, '111111', {sign: -1, value: 20, currency: 'KRW'}).map(r => r.n), [20, 20], '금액만 아는 매도는 지금 시세로 수량 환산');
  assert.deepEqual(c.tradeRows(alloc, lp, 'BTC-USD', {sign: -1, qty: 0.1234567891, price: 100, currency: 'USD'})[0].n, 0.12345679, '비트코인은 0.00000001 단위');
  alloc.groups[0].items.push({id: 'z', ticker: '111111', amount: 0});
  assert.equal(c.tradeRows(alloc, lp, '111111', {sign: 1, qty: 4, price: 10000, currency: 'KRW'})[2].unit, 'shares', '빈 종목은 체결 수량을 알면 수량');
  assert.equal(c.tradeRows(alloc, lp, '111111', {sign: 1, value: 4, price: 10000, currency: 'KRW'})[2].unit, 'amount', '금액만 알면 금액');
});

test('체결 연동: 반영하면 보유 수량·금액을 바꾸고 기록하며, 되돌리면 정확히 원래 값으로', () => {
  const alloc = linkAlloc(), before = JSON.stringify(alloc);
  const sell = c.applyTrade(alloc, lp, 'sell:p:0', {sign: -1, qty: 3, price: 9000, currency: 'KRW'}, '테스트 1회 매도', [{id: 'a', unit: 'shares', n: 3}, {id: 'c', unit: 'amount', n: 12.5}, {id: 'gone', unit: 'shares', n: 1}]);
  assert.equal(byId(alloc, 'a').shares, 7);
  near(byId(alloc, 'c').amount, 90, '지금 평가액 12.5만원 = 입력 금액 10만원(기준 가격 4만원 → 5만원)'); assert.equal(byId(alloc, 'c').base, 40000, '기준 가격은 그대로');
  assert.deepEqual(sell.items, [{id: 'a', shares: -3}, {id: 'c', amount: -10}], '없는 종목은 건너뜀');
  assert.deepEqual([sell.label, sell.qty, sell.price, sell.value], ['테스트 1회 매도', 3, 9000, null]);
  assert.equal(alloc.trades['sell:p:0'], sell);
  c.applyTrade(alloc, lp, 'sell:p:0', {sign: -1, qty: 2, price: 9000, currency: 'KRW'}, '테스트 1회 매도', [{id: 'b', unit: 'shares', n: 2}]);
  assert.deepEqual([byId(alloc, 'a').shares, byId(alloc, 'b').shares, byId(alloc, 'c').amount], [10, 3, 100], '같은 키를 다시 반영하면 먼저 되돌린다');
  assert.ok(c.revertTrade(alloc, 'sell:p:0'));
  assert.equal(JSON.stringify(alloc), before, '되돌리면 원래 기록 그대로(trades도 지움)');
  assert.equal(c.revertTrade(alloc, 'sell:p:0'), null);
});

test('체결 연동: 0 아래로 내려가지 않고, 다 판 종목은 수량 0(평가액 0), 새로 만든 수량 칸은 되돌리면 지운다', () => {
  const alloc = linkAlloc();
  const rec = c.applyTrade(alloc, lp, 'cut:r:0', {sign: -1, qty: 8, currency: 'KRW'}, '손절', [{id: 'b', unit: 'shares', n: 8}]);
  assert.deepEqual(rec.items, [{id: 'b', shares: -5, exact:-8}], '실제로 뺀 양과 부족한 잔고에 잘리기 전 요청량을 구분');
  assert.equal(byId(alloc, 'b').shares, 0);
  assert.deepEqual(c.itemValue({...byId(alloc, 'b'), amount: 30}, lp, 1000).value, 0, '수량 0은 금액 칸으로 돌아가지 않고 0');
  c.revertTrade(alloc, 'cut:r:0'); assert.equal(byId(alloc, 'b').shares, 5);
  alloc.groups[0].items.push({id: 'z', ticker: '111111', amount: 0});
  const buy = c.applyTrade(alloc, lp, 'rebuy:r:25선:0', {sign: 1, qty: 4, price: 10000, currency: 'KRW'}, '재매수', [{id: 'z', unit: 'shares', n: 4}]);
  assert.deepEqual([byId(alloc, 'z').shares, buy.items[0].fresh], [4, true]);
  c.revertTrade(alloc, 'rebuy:r:25선:0'); assert.equal('shares' in byId(alloc, 'z'), false);
  alloc.groups[1].items.push({id: 'y', ticker: 'AAA', amount: 0});
  c.applyTrade(alloc, lp, 'buy:y:end', {sign: 1, price: 50, currency: 'USD', value: 20}, '분할매수 목표가', [{id: 'y', unit: 'amount', n: 20}]);
  assert.deepEqual([byId(alloc, 'y').amount, byId(alloc, 'y').base], [20, 50000], '금액 0에서 사면 기준 가격을 지금 시세로');
  assert.equal(c.applyTrade(alloc, lp, 'sell:p:1', {sign: -1, qty: 1, currency: 'KRW'}, '없음', [{id: 'a', unit: 'shares', n: 0}]), null, '반영할 양이 없으면 기록하지 않음');
});

test('체결 연동: 체크 뒤 체결 수량·가격·금액을 고치면 반영한 양을 같은 비율로', () => {
  const alloc = linkAlloc();
  c.applyTrade(alloc, lp, 'cut:r:0', {sign: -1, qty: 4, price: 10000, currency: 'KRW'}, '손절', [{id: 'a', unit: 'shares', n: 4}, {id: 'c', unit: 'amount', n: 5}]);
  near(byId(alloc, 'c').amount, 96, '5만원 × 0.8');
  assert.ok(c.rescaleTrade(alloc, 'cut:r:0', {qty: 3, price: 10000}));
  assert.equal(byId(alloc, 'a').shares, 7, '4주 → 3주'); near(byId(alloc, 'c').amount, 97, '금액도 3/4');
  assert.ok(c.rescaleTrade(alloc, 'cut:r:0', {qty: 3, price: 20000}));
  assert.equal(byId(alloc, 'a').shares, 7, '가격만 바꾸면 수량 그대로'); near(byId(alloc, 'c').amount, 94, '금액은 두 배');
  assert.equal(c.rescaleTrade(alloc, 'cut:r:0', {qty: 0, price: null}), null, '0·빈 값이면 바꾸지 않음');
  c.revertTrade(alloc, 'cut:r:0');
  assert.deepEqual([byId(alloc, 'a').shares, byId(alloc, 'c').amount], [10, 100]);
  c.applyTrade(alloc, lp, 'buy:d:k', {sign: 1, price: 50, currency: 'USD', value: 10}, '분할매수', [{id: 'd', unit: 'amount', n: 10}, {id: 'b', unit: 'shares', n: 2}]);
  c.rescaleTrade(alloc, 'buy:d:k', {price: 50, value: 15});
  assert.deepEqual([byId(alloc, 'd').amount, byId(alloc, 'b').shares], [65, 8], '체결 금액 1.5배 → 금액·수량(2주 → 3주) 모두');
});

test('체결 연동: 여러 계좌 수량 수정 시 계좌별 반올림으로 체결 수량 합계가 달라지지 않는다', () => {
  const alloc=linkAlloc(),key='buy:a:end';
  c.applyTrade(alloc,lp,key,{sign:1,qty:8,price:10000,currency:'KRW',value:8},'분할매수', [{id:'a',unit:'shares',n:4},{id:'b',unit:'shares',n:4}]);
  c.rescaleTrade(alloc,key,{qty:7,price:10000,value:7});
  assert.equal(alloc.trades[key].items.reduce((n,e)=>n+e.shares,0),7,'4×7/8를 각각 반올림해 4+4=8로 남기지 않는다');
  assert.deepEqual([byId(alloc,'a').shares,byId(alloc,'b').shares],[14,8],'최소 단위를 배분한 4주+3주를 반영');
  c.rescaleTrade(alloc,key,{qty:9,price:10000,value:9});
  assert.equal(alloc.trades[key].items.reduce((n,e)=>n+e.shares,0),9,'재수정해도 합계 유지');
  c.revertTrade(alloc,key);assert.deepEqual([byId(alloc,'a').shares,byId(alloc,'b').shares],[10,5],'계좌마다 정확히 원래 보유량 복원');
});

test('분할매수 quiet 계산은 알림을 끈 미완료 회차를 notify:false로 더하고 매수대기·완료 회차는 넣지 않는다', () => {
  const lines={currency:'USD',lines:{names:['25일선','32일선'],budget:40},notify:{keys:{'25일선:1':true}}};
  const stages={currency:'USD',notify:{stages:true},stages:[{id:'s1',price:30,amount:3,done:true},{id:'s2',price:31,amount:3,notify:false},{id:'s3',price:32,amount:3}]};
  const assets={allocation:{groups:[{items:[{id:'a',ticker:'AAA',buyPlan:lines},{id:'b',ticker:'BBB',buyPlan:stages},{id:'w',ticker:'CCC',buyPlan:{wait:{line:'60일선'},currency:'USD'}}]}]}};
  const prices={stocks:{AAA:{kind:'해외',ma:{'25일선':100,'32일선':130}},BBB:{kind:'해외'},CCC:{kind:'해외',close:105,ma:{'60일선':100}}}},before=JSON.stringify(assets);
  const on=c.purchaseAlertRules(assets,prices),all=c.purchaseAlertRules(assets,prices,true);
  assert.deepEqual(on.map(r=>r.id),['trade:buy:a:25일선:1','trade:buy:b:s3']);
  assert.deepEqual(all.map(r=>[r.id,r.notify]),[['trade:buy:a:25일선:0',false],['trade:buy:a:25일선:1',undefined],['trade:buy:a:25일선:2',false],['trade:buy:a:32일선:0',false],['trade:buy:b:s2',false],['trade:buy:b:s3',undefined]]);
  assert.deepEqual(all.filter(r=>r.notify===undefined),on,'켠 규칙은 quiet 여부와 관계없이 같은 모양');
  assert.equal(JSON.stringify(assets),before,'quiet 계산도 기록을 바꾸지 않는다');
  lines.notify={stages:true};stages.stages[1].notify=true;
  assert.deepEqual(all.map(({notify,...r})=>r),c.purchaseAlertRules(assets,prices),'알림을 켜고 꺼도 같은 id·기준·이력');
});

test('체결·정정·취소는 기존 소수 보유량을 보존하며 잔고 부족 시 실제 차감량을 기록한다',()=>{
  for(const ticker of ['AAA','BTC-USD'])for(const holding of [0.125,10.25,10.99999999])for(const sign of [-1,1]){
    const it={id:'a',ticker,shares:holding},alloc={groups:[{id:'g',items:[it]}]},key='buy:a:test';
    const rec=c.applyTrade(alloc,prices,key,{sign,qty:2,value:2},'모의 체결',[{id:it.id,unit:'shares',n:2}]);
    const expected=Number(Math.max(0,holding+sign*2).toFixed(8));
    assert.equal(it.shares,expected,`${ticker} ${holding} ${sign}: 기존 소수부 유지`);
    assert.equal(rec.items[0].shares,Number((expected-holding).toFixed(8)),'체결 기록은 반올림한 예정량이 아니라 실제 변경량');
    c.rescaleTrade(alloc,key,{qty:3,value:3});
    assert.equal(it.shares,Number((holding+alloc.trades[key].items[0].shares).toFixed(8)),'정정 후에도 잔고 = 원래 보유 + 반영 기록');
    c.revertTrade(alloc,key);assert.equal(it.shares,holding,'취소하면 원래 소수 보유량');
  }
});

test('소수 잔고를 전량 차감한 새 체결 정정은 요청량을 기준으로 실제 차감량을 다시 계산한다',()=>{
  for(const [holding,qty,nextQty,remaining] of [[0.4,1,2,0],[10.75,20,10,0.75]]){
    const it={id:'a',ticker:'AAA',shares:holding},alloc={groups:[{id:'g',items:[it]}]},key='sell:a:0';
    c.applyTrade(alloc,prices,key,{sign:-1,qty},'모의 매도',[{id:'a',unit:'shares',n:qty}]);
    assert.equal(it.shares,0);
    c.rescaleTrade(alloc,key,{qty:nextQty});
    assert.equal(it.shares,remaining,'원래 요청한 20주를 10주로 고치면 보유 10.75주에서 실제로 10주만 차감');
    assert.equal(alloc.trades[key].items[0].shares,Number((remaining-holding).toFixed(8)));
    c.revertTrade(alloc,key);assert.equal(it.shares,holding);
  }
});

test('잔고에 잘린 매도를 여러 번 정정해도 요청량과 실제 차감량을 보존하고 취소하면 소수 잔고가 돌아온다',()=>{
  for(const [holding,initial,corrections] of [[10.25,11,[12,11]],[10.75,20,[30,20,10,20,10]]]){
    const it={id:'a',ticker:'AAA',shares:holding},alloc={groups:[{id:'g',items:[it]}]},key='sell:a:0';
    c.applyTrade(alloc,prices,key,{sign:-1,qty:initial},'모의 매도',[{id:'a',unit:'shares',n:initial}]);
    assert.equal(it.shares,0);assert.equal(alloc.trades[key].items[0].exact,-initial);
    for(const qty of corrections){
      c.rescaleTrade(alloc,key,{qty});const expected=Math.max(0,holding-qty);
      assert.equal(it.shares,expected,`${holding}주 보유에서 누적 ${qty}주 매도`);
      assert.equal(alloc.trades[key].items[0].shares,expected-holding,'요청량과 별개로 실제 차감량만 기록');
    }
    c.revertTrade(alloc,key);assert.equal(it.shares,holding);assert.equal(alloc.trades,undefined);
  }
});

test('연결 계좌의 소수 보유량 합과 고정 거래 단위는 서로 독립적이다',()=>{
  const a={id:'a',ticker:'AAA',shares:10.25},b={id:'b',ticker:'AAA',shares:0.125},alloc={groups:[{id:'g',items:[a,b]}]};
  assert.equal(c.linkSummary(alloc,prices,'AAA').shares,10.375,'실제 보유량은 정수 거래 단위로 반올림하지 않음');
  assert.equal(c.purchaseFill({amount:100,price:50},'USD',1000).shares,20,'신규 주식 계획은 기존 정수 단위 유지');
  c.applyTrade(alloc,prices,'sell:a:0',{sign:-1,qty:20},'모의 매도',[{id:'a',unit:'shares',n:20}]);
  assert.equal(a.shares,0);assert.equal(alloc.trades['sell:a:0'].items[0].shares,-10.25);
  c.applyTrade(alloc,prices,'sell:a:0',{sign:-1,qty:1},'모의 정정',[{id:'a',unit:'shares',n:1}]);
  assert.equal(a.shares,9.25,'같은 키 재반영도 기존 소수부를 보존');
  c.revertTrade(alloc,'sell:a:0');assert.equal(a.shares,10.25);
});

test('금액으로 관리하는 계좌도 반영 단위보다 작은 기존 금액을 취소까지 보존한다',()=>{
  const it={id:'a',amount:10.125},alloc={groups:[{id:'g',items:[it]}]};
  c.applyTrade(alloc,null,'buy:a:0',{sign:1,value:1},'모의 매수',[{id:'a',unit:'amount',n:1}]);
  assert.equal(it.amount,11.125);assert.equal(alloc.trades['buy:a:0'].items[0].amount,1);
  c.rescaleTrade(alloc,'buy:a:0',{value:2});assert.equal(it.amount,12.125);
  c.revertTrade(alloc,'buy:a:0');assert.equal(it.amount,10.125);
});

test('소수 잔고와 exact 보정이 함께 있어도 0주 정정·반복 정정·취소 후 잔고를 보존한다',()=>{
  for(const holding of [0.125,10.25,10.99999999]){
    const it={id:'a',ticker:'AAA',tradeTicker:'111111',shares:holding},alloc={groups:[{id:'g',items:[it]}]};
    c.applyTrade(alloc,prices,'r',{ticker:'AAA',sign:1,qty:2,price:50,value:10},'모의 환산',[{id:'a',unit:'shares',n:10}]);
    for(const [value,applied] of [[0.5,0],[10,10],[7.5,7],[10,10],[0.5,0],[10,10]]){
      c.rescaleTrade(alloc,'r',{qty:2,price:50,value});
      assert.equal(it.shares,Number((holding+applied).toFixed(8)),'새 주수만 내리고 원래 소수 보유량은 유지');
      assert.equal(alloc.trades.r.items[0].shares,applied,'현재 반영량과 exact 기준량을 구분');
    }
    c.revertTrade(alloc,'r');assert.equal(it.shares,holding);
  }
  const it={id:'a',amount:10.125},alloc={groups:[{id:'g',items:[it]}]};
  c.applyTrade(alloc,null,'m',{sign:1,value:1},'모의 금액',[{id:'a',unit:'amount',n:1}]);
  c.rescaleTrade(alloc,'m',{value:0.001});assert.equal(it.amount,10.125);assert.equal(alloc.trades.m.items[0].exact,0.001);
  c.rescaleTrade(alloc,'m',{value:1});assert.equal(it.amount,11.125);
  c.revertTrade(alloc,'m');assert.equal(it.amount,10.125);
});

test('유한하지 않은 자산 시세는 평가·매수 계산에 넣지 않고 직접 입력 금액을 보존한다',()=>{
  for(const close of [Infinity,-Infinity,NaN,'Infinity','1e999']){
    const prices={stocks:{AAA:{kind:'해외',close,asOf:'2026-01-02'}}},item={ticker:'AAA',shares:2,amount:15};
    assert.equal(c.assetTradeQuote(prices,item),null);
    const value=c.itemValue(item,prices,1000);assert.equal(value.value,15);assert.equal(value.how,'amount');
  }
  assert.equal(c.assetTradeQuote({stocks:{AAA:{kind:'해외',close:'50.25',asOf:'2026-01-02'}}},{ticker:'AAA'}).close,50.25);
});
