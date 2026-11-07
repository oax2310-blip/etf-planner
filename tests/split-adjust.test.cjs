// 가상 코드 TEST·TESTALT와 가상 숫자만 사용한다. DOM·시계·저장소 없이 계산과 JSON 경계를 검증한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,'js',name),'utf8');
const context=vm.createContext({});
vm.runInContext(['ma-ladder.js','prices.js','assets-calc.js','data-validation.js','split-adjust.js'].map(source).join('\n;\n'),context);
const api=vm.runInContext('({splitPreview,applySplit,appendSplitLog,externalData})',context);
const plain=v=>JSON.parse(JSON.stringify(v));
const opt={ticker:' test ',from:1,to:3,exDate:'2026-02-03'};
const planner=()=>({plans:[],futures:{}});
const assets=items=>({allocation:{groups:[{id:'group',items}]}});
const run=(data,doc={},options=opt,selection)=>{
  const preview=api.splitPreview(data,doc,options);
  return {...api.applySplit(data,doc,preview,selection),preview};
};
const log=extra=>({id:'split-example',ticker:'TEST',from:1,to:3,exDate:opt.exDate,appliedAt:'2026-02-03T01:02:03.000Z',planner:true,assets:false,...extra});
function freeze(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;
}

test('1→3: 분할매도 가격·보유·체결만 보정하고 금액·환율·비율·회차·날짜를 보존한다',()=>{
  const data=planner();data.plans=[{id:'plan',ticker:'test',title:'가상 계획',startPrice:90,endPrice:60,valueBase:'120',basisPrice:150,currentPrice:180,
    fullSell:{price:30,condition:'down'},holdings:[{shares:'12',amount:20}],valueKrw:500,fx:1300,salePct:50,stages:3,asOf:'2026-01-02',checked:[true],
    fills:{'0':{price:'90',execPrice:81,qty:3,plannedQty:12,shares:6,plannedShares:9,value:'70',plannedValue:100,amount:40,contracts:2}}}];
  const result=run(data),p=result.plannerData.plans[0],f=p.fills['0'];
  assert.deepEqual([p.startPrice,p.endPrice,p.valueBase,p.basisPrice,p.currentPrice,p.fullSell.price,p.holdings[0].shares],[30,20,40,50,60,10,36]);
  assert.deepEqual([f.price,f.execPrice,f.qty,f.plannedQty,f.shares,f.plannedShares],[30,27,9,36,18,27]);
  for(const key of ['valueKrw','fx','salePct','stages','asOf','checked'])assert.deepEqual(plain(p[key]),data.plans[0][key]);
  for(const key of ['value','plannedValue','amount','contracts'])assert.equal(f[key],data.plans[0].fills['0'][key]);
  assert.equal(result.preview.ticker,'TEST');assert.ok(result.changedFields>0);
  assert.equal(result.plannerChanged,true);assert.equal(result.assetsChanged,false);
  assert.equal(Object.hasOwn(p,'splitLog'),false);assert.equal(Object.hasOwn(result.plannerData,'splitLog'),false);
});

test('10→1 병합: 가격은 10배, 수량은 1/10이며 소수 주수를 허용한다',()=>{
  const data={...planner(),plans:[{ticker:'TEST',startPrice:9,holdings:[{shares:12}],fills:{'0':{price:8,qty:3,value:24}}}]};
  const r=run(data,{}, {...opt,from:10,to:1});
  assert.equal(r.plannerData.plans[0].startPrice,90);assert.equal(r.plannerData.plans[0].holdings[0].shares,1.2);
  assert.deepEqual(plain(r.plannerData.plans[0].fills['0']),{price:80,qty:0.3,value:24});
});

test('자동 시세와 같은 값만 건너뛰고 수동 수정·옛 startAuto=false 값은 보정한다',()=>{
  const data={...planner(),plans:[{id:'auto',ticker:'TEST',startPrice:'90',endPrice:60,startAuto:true,auto:{startPrice:90,endPrice:'60',at:'2026-01-01T00:00:00Z'}},
    {id:'manual',ticker:'TEST',startPrice:90,endPrice:99,startAuto:false,auto:{startPrice:90,endPrice:60}}],
    rebuy:{items:[{ticker:'TEST',currentPrice:'90',floorPrice:60,lowPrice:120,auto:{currentPrice:90,floorPrice:'60','25선':30,'12개월선':90},
      stages:[{name:'25분봉',price:'30',execPrice:27,shares:2,done:true},{name:'12달선',price:99}]}]}};
  const r=run(data),p=r.plannerData.plans,rb=r.plannerData.rebuy.items[0];
  assert.equal(p[0].startPrice,'90');assert.equal(p[0].endPrice,60);
  assert.equal(p[1].startPrice,30);assert.equal(p[1].endPrice,33);
  assert.equal(rb.currentPrice,'90');assert.equal(rb.floorPrice,60);assert.equal(rb.lowPrice,40);
  assert.equal(rb.stages[0].price,'30');assert.equal(rb.stages[0].execPrice,9);assert.equal(rb.stages[0].shares,6);assert.equal(rb.stages[1].price,33);
  assert.deepEqual(plain(rb.auto),data.rebuy.items[0].auto);assert.deepEqual(plain(p[0].auto),data.plans[0].auto);
  const skipped=r.preview.items.flatMap(i=>i.skipped);
  assert.equal(skipped.filter(s=>s.reason==='시세 자동 채움').length,5);
  assert.ok(skipped.every(s=>Array.isArray(s.path)));
});

test('재매수 신저점·손절·수동 회차 가격·새/옛 체결 수량을 보정하고 amount·기간·계약은 유지한다',()=>{
  const r={id:'rebuy',ticker:'TEST',lowPrice:90,floorPrice:60,finalPrice:30,endPrice:120,currentPrice:75,shares:'12',amount:'100',stepPct:2,sellPct:3,steps:20,
    cuts:[null,{price:90,execPrice:81,shares:3,plannedShares:6,qty:1,plannedQty:2,contracts:7,amount:20,afterLine:'25선'}],
    stages:[{name:'직접',price:60,prices:[null,'66',69],done:true,execPrice:54,shares:3,plannedShares:6,rounds:3,weight:50},
      {name:'60일선',price:90,buys:[null,{price:'81',execPrice:72,shares:'3',plannedShares:6,qty:2,plannedQty:4,amount:20,contracts:7}]}]};
  const result=run({...planner(),rebuy:{items:[r]}}),next=result.plannerData.rebuy.items[0];
  for(const k of ['lowPrice','floorPrice','finalPrice','endPrice','currentPrice'])assert.equal(next[k],r[k]/3,k);
  assert.equal(next.shares,36);for(const k of ['amount','stepPct','sellPct','steps'])assert.equal(next[k],r[k]);
  assert.deepEqual(plain(next.stages[0].prices),[null,22,23]);assert.equal(next.stages[0].execPrice,18);assert.equal(next.stages[0].shares,9);
  assert.equal(next.cuts[0],null);assert.equal(next.cuts[1].shares,9);assert.equal(next.cuts[1].plannedShares,18);
  assert.equal(next.cuts[1].contracts,7);assert.equal(next.cuts[1].amount,20);
  assert.equal(next.stages[1].buys[1].price,27);assert.equal(next.stages[1].buys[1].shares,9);assert.equal(next.stages[1].buys[1].contracts,7);
});

test('옛 단일 rebuy도 읽고 없는 id/items/선택 필드를 만들지 않는다',()=>{
  const data={...planner(),rebuy:{ticker:'test',lowPrice:'90',shares:'2',stages:[{name:'직접',price:60}]}};
  const r=run(data).plannerData.rebuy;assert.equal(r.lowPrice,30);assert.equal(r.shares,6);
  for(const key of ['id','items','auto','currentPrice','endPrice','cuts'])assert.equal(Object.hasOwn(r,key),false,key);
});

test('다른 종목·BTC·KS200·달러선물 전체·알림·옛 actions·자산의 다른 구역은 불변이다',()=>{
  const other={ticker:'TESTALT',startPrice:90,holdings:[{shares:12}]},btc={ticker:'BTC-USD',startPrice:90,holdings:[{shares:12}]},index={ticker:'KS200',startPrice:90};
  const data={plans:[other,btc,index],futures:{ticker:'TEST',targetPrice:90,positions:[{contracts:2,price:90}],rebuy:{ticker:'TEST',currentPrice:90,shares:3}},
    rebuy:{items:[{ticker:'BTC-USD',currentPrice:90,shares:3},{ticker:'KS200',currentPrice:90}]},alerts:{rules:[{ticker:'TEST',period:25}]},alertHistory:{items:[{ticker:'TEST',price:90}]},actions:{buys:[{ticker:'TEST',price:90,shares:3}]}};
  const doc={...assets([{id:'other',ticker:'TESTALT',shares:3,averagePrice:90},{ticker:'BTC-USD',shares:3,averagePrice:90},{ticker:'KS200',shares:3,averagePrice:90}]),
    ledger:{price:90,shares:3},savings:{amount:50},installments:{amount:40}};
  const r=run(data,doc);assert.equal(r.changedFields,0);assert.deepEqual(plain(r.plannerData),data);assert.deepEqual(plain(r.assetsDoc),doc);
  for(const ticker of ['BTC-USD','비트코인','KS200']){
    const p=api.splitPreview(data,doc,{...opt,ticker});assert.equal(p.excluded,true);assert.equal(p.items.length,0);
  }
});

test('단일 execution은 기준 ETF 필드와 실제 ETF 필드를 각각 해당 종목에만 보정한다',()=>{
  const data={...planner(),plans:[{id:'reference',ticker:'TEST',fills:{'0':{price:90,qty:3,plannedQty:12,execution:{ticker:'TESTALT',price:45,qty:6,plannedQty:24,sourcePrice:90,referencePrice:120,sourceQty:12,fx:1300}}}},
    {id:'actual',ticker:'TESTALT',fills:{'0':{price:120,qty:3,plannedQty:6,execution:{ticker:'test',price:90,qty:'3',plannedQty:12,sourcePrice:120,referencePrice:150,sourceQty:6,fx:1300}}}}]};
  const p=run(data).plannerData.plans,a=p[0].fills['0'],b=p[1].fills['0'];
  assert.equal(a.price,30);assert.equal(a.qty,9);assert.equal(a.execution.sourcePrice,30);assert.equal(a.execution.referencePrice,40);assert.equal(a.execution.sourceQty,36);
  assert.deepEqual([a.execution.price,a.execution.qty,a.execution.plannedQty,a.execution.fx],[45,6,24,1300]);
  assert.deepEqual([b.price,b.qty,b.plannedQty,b.execution.sourcePrice,b.execution.referencePrice,b.execution.sourceQty],[120,3,6,120,150,6]);
  assert.deepEqual([b.execution.price,b.execution.qty,b.execution.plannedQty,b.execution.fx],[30,9,36,1300]);
});

test('여러 실제 ETF가 섞인 execution.rows는 해당 행만 보정하고 합계에는 그 행의 증감만 더한다',()=>{
  const data={...planner(),plans:[{id:'group-plan',ticker:'TESTALT',fills:{'0':{price:120,qty:4,plannedQty:10,execution:{group:true,sourcePrice:120,qty:5,plannedQty:12,
    rows:[{targetId:'one',ticker:'TEST',price:90,qty:2,plannedQty:5},{targetId:'two',ticker:'TESTALT',price:60,qty:3,plannedQty:7}]}}}}]};
  const doc=assets([{id:'one',ticker:'TEST'},{id:'two',ticker:'TESTALT'}]);doc.allocation.trades={'sell:group-plan:0':{price:null,qty:5,value:80,items:[{id:'one',shares:-2},{id:'two',shares:-3}]}};
  const r=run(data,doc),f=r.plannerData.plans[0].fills['0'],e=f.execution,rec=r.assetsDoc.allocation.trades['sell:group-plan:0'];
  assert.deepEqual([f.price,f.qty,f.plannedQty,e.sourcePrice],[120,4,10,120]);assert.deepEqual([e.qty,e.plannedQty],[9,22]);
  assert.deepEqual(plain(e.rows[0]),{targetId:'one',ticker:'TEST',price:30,qty:6,plannedQty:15});assert.deepEqual(plain(e.rows[1]),data.plans[0].fills['0'].execution.rows[1]);
  assert.equal(rec.qty,9);assert.equal(rec.price,null);assert.equal(rec.value,80);assert.deepEqual(plain(rec.items),[{id:'one',shares:-6},{id:'two',shares:-3}]);
});

test('기준 종목과 tradeTicker가 다른 자산의 보유·평단·base는 실제 ETF 기준이다',()=>{
  const one={id:'tracks',ticker:'TEST',tradeTicker:'TESTALT',shares:12,averagePrice:90,base:120000,amount:50,tradePrice:90,
    buyPlan:{lines:{end:120,budget:80,target:20},stages:[{id:'pending',price:90,shares:6,amount:30,date:'2026-02-01'},
      {id:'filled',price:90,shares:2,plannedShares:4,sourceShares:6,tradeTicker:'TESTALT',tradePrice:45,partial:true,actual:20}],
      buys:{'25선:0':{price:90,shares:2,plannedShares:4,tradeTicker:'TESTALT',tradePrice:45,actual:20,plannedActual:40}}}};
  const two={id:'actual',ticker:'TESTALT',tradeTicker:'test',shares:6,averagePrice:'90',base:117000,amount:'40',tradePrice:90,
    buyPlan:{lines:{end:120,budget:80},buys:{'end':{price:120,shares:2,plannedShares:4,tradeTicker:'TEST',tradePrice:90,actual:20}}}};
  const r=run(planner(),assets([one,two])).assetsDoc.allocation.groups[0].items,a=r[0],b=r[1];
  for(const key of ['shares','averagePrice','base','amount','tradePrice'])assert.equal(a[key],one[key],key);
  assert.equal(a.buyPlan.lines.end,40);assert.equal(a.buyPlan.lines.budget,80);assert.equal(a.buyPlan.lines.target,20);
  assert.deepEqual([a.buyPlan.stages[0].price,a.buyPlan.stages[0].shares,a.buyPlan.stages[0].amount],[30,18,30]);
  assert.deepEqual([a.buyPlan.stages[1].price,a.buyPlan.stages[1].sourceShares,a.buyPlan.stages[1].shares,a.buyPlan.stages[1].plannedShares,a.buyPlan.stages[1].tradePrice],[30,18,2,4,45]);
  assert.deepEqual([a.buyPlan.buys['25선:0'].price,a.buyPlan.buys['25선:0'].shares,a.buyPlan.buys['25선:0'].tradePrice],[30,2,45]);
  assert.deepEqual([b.shares,b.averagePrice,b.base,b.tradePrice,b.amount],[18,30,39000,30,'40']);
  assert.deepEqual([b.buyPlan.lines.end,b.buyPlan.buys.end.price,b.buyPlan.buys.end.shares,b.buyPlan.buys.end.plannedShares,b.buyPlan.buys.end.tradePrice],[120,120,6,12,30]);
});

test('분할매수 execPrice는 buys·직접 입력 모두 실제 매수 종목 기준으로만 분할 조정한다',()=>{
  const tracked={id:'tracked',ticker:'TEST',tradeTicker:'TESTALT',buyPlan:{
    stages:[{id:'stage',price:90,sourceShares:6,shares:2,plannedShares:4,partial:true,tradeTicker:'TESTALT',tradePrice:45,execPrice:42}],
    buys:{explicit:{price:90,sourceShares:6,shares:2,tradeTicker:'TESTALT',tradePrice:45,execPrice:42},
      legacy:{price:90,shares:2,execPrice:42},missing:{price:90,shares:2,execPrice:42,tradeTargetId:'deleted'},empty:{price:90,shares:2}}
  }};
  const direct={id:'direct',ticker:'TEST',buyPlan:{stages:[{id:'old',done:true,price:90,shares:2,execPrice:81}],buys:{end:{price:90,shares:2,execPrice:81}}}};
  const doc=assets([tracked,direct]),before=JSON.stringify(doc),basis=run(planner(),doc).assetsDoc.allocation.groups[0].items;
  assert.equal(JSON.stringify(doc),before,'미리보기·적용은 원본 불변');
  const p=basis[0].buyPlan;
  assert.deepEqual([p.stages[0].price,p.stages[0].sourceShares,p.stages[0].tradePrice,p.stages[0].execPrice],[30,18,45,42]);
  assert.deepEqual([p.buys.explicit.price,p.buys.explicit.sourceShares,p.buys.explicit.execPrice,p.buys.legacy.execPrice],[30,18,42,42]);
  assert.equal(basis[1].buyPlan.stages[0].execPrice,27);assert.equal(basis[1].buyPlan.buys.end.execPrice,27);
  const actual=run(planner(),doc,{...opt,ticker:'TESTALT'}),a=actual.assetsDoc.allocation.groups[0].items[0].buyPlan;
  assert.deepEqual([a.stages[0].price,a.stages[0].sourceShares,a.stages[0].tradePrice,a.stages[0].execPrice],[90,6,15,14]);
  assert.deepEqual([a.buys.explicit.price,a.buys.explicit.sourceShares,a.buys.explicit.tradePrice,a.buys.explicit.execPrice,a.buys.legacy.execPrice],[90,6,15,14,14]);
  assert.equal(a.buys.missing.execPrice,42,'삭제된 명시 계좌의 실제 종목은 추정하지 않음');
  assert.equal(Object.hasOwn(a.buys.empty,'execPrice'),false);
  assert.ok(actual.preview.items.some(i=>i.skipped.some(s=>s.path.at(-1)==='execPrice'&&s.reason==='종목 연결 확인 불가')));
});

test('분할매수는 고정 tradeTicker·반영 계좌·옛 반영 기록을 사용하고 삭제된 명시 계좌는 추정하지 않는다',()=>{
  const owner={id:'owner',ticker:'TESTALT',tradeTicker:'TESTALT',buyPlan:{buys:{
    explicit:{price:90,shares:2,tradeTicker:'TEST',tradeTargetId:'other',tradePrice:60},
    target:{price:90,shares:2,plannedShares:4,tradeTargetId:'matching'},
    legacy:{price:90,shares:2},
    missing:{price:90,shares:2,plannedShares:4,tradeTargetId:'deleted'}
  }}};
  const doc=assets([owner,{id:'matching',ticker:'TEST'},{id:'other',ticker:'TESTALT'}]);
  doc.allocation.trades={'buy:owner:legacy':{items:[{id:'matching',shares:2}]}};
  const r=run(planner(),doc),b=r.assetsDoc.allocation.groups[0].items[0].buyPlan.buys;
  assert.deepEqual([b.explicit.shares,b.explicit.tradePrice,b.explicit.price],[6,20,90]);assert.equal(b.target.shares,6);assert.equal(b.target.plannedShares,12);assert.equal(b.legacy.shares,6);
  assert.equal(b.missing.shares,2);assert.equal(b.missing.plannedShares,4);assert.ok(r.preview.items.some(i=>i.skipped.some(s=>s.reason==='종목 연결 확인 불가')));
});

test('분할매수 평균가의 반영 표식 execPrice는 실제 종목으로 조정하고 avgFresh는 유지한다',()=>{
  const doc=assets([{id:'owner',ticker:'TESTALT',tradeTicker:'TEST',shares:3,averagePrice:81,
    buyPlan:{buys:{end:{price:90,shares:3,tradeTicker:'TEST',tradePrice:90,execPrice:81}}}},
    {id:'other',ticker:'TESTALT',shares:2,averagePrice:54}]);
  doc.allocation.trades={'buy:owner:end':{price:90,qty:3,items:[{id:'owner',shares:3,execPrice:81,avgFresh:true},{id:'other',shares:2,execPrice:54}]}};
  const before=JSON.stringify(doc),actual=run(planner(),doc).assetsDoc,basis=run(planner(),doc,{...opt,ticker:'TESTALT'}).assetsDoc;
  assert.equal(JSON.stringify(doc),before);
  const one=actual.allocation.trades['buy:owner:end'].items,two=basis.allocation.trades['buy:owner:end'].items;
  assert.deepEqual(plain(one[0]),{id:'owner',shares:9,execPrice:27,avgFresh:true});assert.equal(one[1].execPrice,54);
  assert.equal(actual.allocation.groups[0].items[0].averagePrice,27);
  assert.deepEqual(plain(two[0]),{id:'owner',shares:3,execPrice:81,avgFresh:true});assert.equal(two[1].execPrice,18);
  assert.equal(api.externalData.assets(actual),actual);assert.equal(api.externalData.assets(basis),basis);
});

test('자산 반영 기록은 출처와 각 항목 종목을 분리하며 exact의 수량/금액 뜻을 보존한다',()=>{
  const doc=assets([{id:'one',ticker:'TEST'},{id:'two',ticker:'TESTALT'}]);
  doc.allocation.trades={
    linked:{price:90,qty:3,value:20,items:[{id:'one',shares:-3,exact:-2.75}]},
    converted:{price:90,qty:3,value:20,items:[{id:'one',shares:3,exact:2.75,converted:true},{id:'two',amount:4,exact:0.005}]},
    deleted:{price:90,qty:3,items:[{id:'deleted',shares:3}]}
  };
  const r=run(planner(),doc),t=r.assetsDoc.allocation.trades;
  assert.deepEqual([t.linked.price,t.linked.qty,t.linked.value,t.linked.items[0].shares,t.linked.items[0].exact],[30,9,20,-9,-8.25]);
  assert.deepEqual([t.converted.price,t.converted.qty,t.converted.value,t.converted.items[0].shares,t.converted.items[0].exact],[90,3,20,9,8.25]);
  assert.deepEqual(plain(t.converted.items[1]),{id:'two',amount:4,exact:0.005});assert.deepEqual(plain(t.deleted),doc.allocation.trades.deleted);
});

test('옛 다계좌 매수는 같은 실제 코드일 때만 수량을 보정하고 혼합·삭제된 연결은 건너뛴다',()=>{
  const doc=assets([{id:'owner',ticker:'TESTALT',buyPlan:{buys:{same:{price:60,shares:2},mixed:{price:60,shares:2},missing:{price:60,shares:2}}}},
    {id:'one',ticker:'TEST'},{id:'two',ticker:'TEST'},{id:'other',ticker:'TESTALT'}]);
  doc.allocation.trades={'buy:owner:same':{items:[{id:'one',shares:1},{id:'two',shares:1}]},
    'buy:owner:mixed':{items:[{id:'one',shares:1},{id:'other',shares:1}]},'buy:owner:missing':{items:[{id:'deleted',shares:2}]}};
  const r=run(planner(),doc),b=r.assetsDoc.allocation.groups[0].items[0].buyPlan.buys;
  assert.equal(b.same.shares,6);assert.equal(b.same.price,60);assert.equal(b.mixed.shares,2);assert.equal(b.missing.shares,2);
  assert.equal(api.externalData.assets(r.assetsDoc),r.assetsDoc);
});

test('출처 id에 구분자가 있어도 더 긴 정확한 연결을 우선하며 다른 종목으로 추정하지 않는다',()=>{
  const data={...planner(),plans:[{id:'plan',ticker:'TEST'},{id:'plan:long',ticker:'TESTALT'}]};
  const doc=assets([{id:'one',ticker:'TESTALT'}]);doc.allocation.trades={'sell:plan:long:0':{price:90,qty:3,items:[{id:'one',shares:-3}]}};
  const r=run(data,doc);assert.equal(r.changedFields,0);assert.deepEqual(plain(r.assetsDoc),doc);
});

test('그룹·항목·체결 선택은 기본 전체이며 같은 체결 key의 플래너와 자산 반영을 함께 제외한다',()=>{
  const data={...planner(),plans:[{id:'plan',ticker:'TEST',startPrice:90,fills:{'0':{price:90,qty:3},'1':{price:60,qty:2}}}],rebuy:{ticker:'TEST',lowPrice:90}};
  const doc=assets([{id:'one',ticker:'TEST',shares:12}]);doc.allocation.trades={'sell:plan:0':{price:90,qty:3,items:[{id:'one',shares:-3}]},'sell:plan:1':{price:60,qty:2,items:[{id:'one',shares:-2}]}};
  const r=run(data,doc,opt,{groups:{rebuy:false},trades:{'sell:plan:0':false}}),p=r.plannerData.plans[0],t=r.assetsDoc.allocation.trades;
  assert.deepEqual(plain(p.fills['0']),data.plans[0].fills['0']);assert.deepEqual(plain(t['sell:plan:0']),doc.allocation.trades['sell:plan:0']);
  assert.equal(p.fills['1'].qty,6);assert.equal(t['sell:plan:1'].qty,6);assert.equal(r.plannerData.rebuy.lowPrice,90);assert.equal(p.startPrice,30);
  const item=r.preview.items.find(i=>i.group==='plans');
  const selected=api.applySplit(data,doc,r.preview,{items:{[item.key]:false},groups:{allocation:false,trades:false,rebuy:false}});
  assert.equal(selected.changedFields,0);assert.deepEqual(plain(selected.plannerData),data);assert.deepEqual(plain(selected.assetsDoc),doc);
  assert.notEqual(selected.plannerData,data);assert.notEqual(selected.assetsDoc,doc);
});

test('입력과 미리보기는 불변이며 출력은 미변경 중첩 구역까지 깊은 복사다',()=>{
  const data=freeze({...planner(),plans:[{id:'plan',ticker:'TEST',startPrice:90,holdings:[{shares:12}]}],extra:{nested:[{keep:true}]}}),doc=freeze({...assets([]),ledger:{rows:[{amount:10}]}});
  const preview=freeze(api.splitPreview(data,doc,opt)),before=JSON.stringify({data,doc,preview}),r=api.applySplit(data,doc,preview);
  assert.equal(JSON.stringify({data,doc,preview}),before);assert.notEqual(r.plannerData.extra,data.extra);assert.notEqual(r.plannerData.extra.nested[0],data.extra.nested[0]);assert.notEqual(r.assetsDoc.ledger.rows,doc.ledger.rows);
  assert.equal(r.plannerData.plans[0].startPrice,30);
});

test('미리보기 위조·이후 변경·잘못된 selection을 거부하고 원본을 보존한다',()=>{
  const data={...planner(),plans:[{ticker:'TEST',startPrice:90}]},preview=plain(api.splitPreview(data,{},opt)),before=JSON.stringify(data);
  const forged=plain(preview);forged.items[0].changes[0].path=['__proto__','polluted'];
  assert.throws(()=>api.applySplit(data,{},forged),/미리보기/);assert.equal({}.polluted,undefined);
  const edited=plain(data);edited.plans[0].startPrice=120;assert.throws(()=>api.applySplit(edited,{},preview),/미리보기/);
  for(const s of [null,[],{groups:[]},{trades:{x:'false'}}])assert.throws(()=>api.applySplit(data,{},preview,s),/선택/);
  assert.equal(JSON.stringify(data),before);
});

test('옛 숫자 문자열은 바뀐 칸만 숫자로 바꾸고 빈칸·누락·호환 필드는 보존한다',()=>{
  const p={ticker:'TEST',startPrice:'100',endPrice:'',basisPrice:null,valueBase:' ',holdings:[{shares:'1.23456789'}],fills:{'0':{price:'0',qty:0,value:'10',unknown:'90'}}};
  const r=run({...planner(),plans:[p]}).plannerData.plans[0];
  assert.equal(r.startPrice,33.3333);assert.equal(r.holdings[0].shares,3.703704);assert.equal(r.endPrice,'');assert.equal(r.valueBase,' ');assert.equal(r.basisPrice,null);
  assert.equal(r.fills['0'].price,'0');assert.equal(r.fills['0'].value,'10');assert.equal(r.fills['0'].unknown,'90');
  for(const key of ['fullSell','auto','currentPrice','shares'])assert.equal(Object.hasOwn(r,key),false,key);
});

test('분할 비율·종목·실제 날짜를 검증하며 숫자 범위 초과는 적용 전에 거부한다',()=>{
  for(const input of [null,{...opt,ticker:''},{...opt,ticker:'x'.repeat(33)},{...opt,ticker:'<TEST>'},{...opt,from:0},{...opt,to:1001},{...opt,from:1.5},{...opt,from:'1'},{...opt,to:true},{...opt,to:1},{...opt,exDate:'2026-02-30'},{...opt,exDate:'2026-2-03'}])assert.throws(()=>api.splitPreview(planner(),{},input),/분할/);
  const data={...planner(),plans:[{ticker:'TEST',startPrice:Number.MAX_SAFE_INTEGER}]},before=JSON.stringify(data);
  assert.throws(()=>api.splitPreview(data,{}, {...opt,from:1000,to:1}),/숫자 범위/);assert.equal(JSON.stringify(data),before);
  const bad={...planner(),plans:[{ticker:'TEST',startPrice:true,endPrice:'not-a-number'}]};assert.equal(run(bad).changedFields,0);
});

test('기존 함수가 없는 단독 VM에서도 DOM 없이 같은 미리보기·자동 별칭을 계산한다',()=>{
  const standalone=vm.runInNewContext(source('split-adjust.js')+'\n({splitPreview,applySplit})');
  const data={...planner(),rebuy:{ticker:'TEST',auto:{'25선':90},stages:[{name:'25분봉',price:90}],shares:3}};
  assert.deepEqual(plain(standalone.splitPreview(data,{},opt)),plain(api.splitPreview(data,{},opt)));
});

test('이력은 명시적 적용 저장 단계에서만 추가하며 같은 종목·exDate의 기존 이력은 경고한다',()=>{
  const data={...planner(),plans:[{ticker:'TEST',startPrice:90}]},r=run(data),record=log({ticker:' test ',planner:r.plannerChanged,assets:r.assetsChanged});
  const logged=api.appendSplitLog(r.plannerData,record);assert.equal(Object.hasOwn(data,'splitLog'),false);assert.equal(Object.hasOwn(r.plannerData,'splitLog'),false);
  assert.deepEqual(plain(logged.splitLog),[log()]);assert.notEqual(logged,r.plannerData);
  assert.equal(api.splitPreview(logged,{},opt).duplicate,true);assert.equal(api.splitPreview(logged,{}, {...opt,exDate:'2026-02-04'}).duplicate,false);
  assert.equal(api.splitPreview({...data,splitLog:[log({ticker:'TESTALT'})]}, {},opt).duplicate,false);
  assert.equal(api.externalData.planner(logged),logged);
  const empty=planner();api.externalData.planner(empty);assert.equal(Object.hasOwn(empty,'splitLog'),false);
});

test('splitLog의 정상 경계·최대 200개를 보존하고 같은 id·201개 추가를 거부한다',()=>{
  const records=Array.from({length:199},(_,i)=>log({id:`example-${i}`})),data={...planner(),splitLog:records},before=JSON.stringify(data);
  const result=api.appendSplitLog(data,log({id:'final',from:1000,to:1,planner:false,assets:true}));
  assert.equal(result.splitLog.length,200);assert.equal(JSON.stringify(data),before);assert.equal(api.externalData.planner(result),result);
  assert.throws(()=>api.appendSplitLog(result,log({id:'too-many'})),/이력/);assert.throws(()=>api.appendSplitLog(data,log({id:'example-0'})),/이력/);
  const boundaries={...planner(),splitLog:[log({id:'x'.repeat(128),ticker:'T'.repeat(32),exDate:'2024-02-29',appliedAt:'2024-02-29T23:59:59+09:00'})]};assert.doesNotThrow(()=>api.externalData.planner(boundaries));
});

test('splitLog의 타입·범위·길이·날짜·불리언 오류를 거부하며 원본과 오류 비공개 원칙을 유지한다',()=>{
  const bad=[null,{},'bad',Array.from({length:201},(_,i)=>log({id:`x-${i}`})),[null],[log({id:''})],[log({id:'x'.repeat(129)})],[log({ticker:'test'})],[log({ticker:'T'.repeat(33)})],[log({ticker:'BTC-USD'})],[log({ticker:'KS200'})],
    [log({from:'1'})],[log({from:0})],[log({to:1001})],[log({from:1.5})],[log({to:1})],[log({exDate:'2026-02-30'})],[log({exDate:'0000-01-01'})],[log({appliedAt:'2026-02-30T01:00:00Z'})],[log({appliedAt:'2026-02-03T24:00:00Z'})],[log({appliedAt:'2026-02-03'})],[log({planner:1})],[log({assets:'false'})],[log({planner:false,assets:false})],[log(),log()]];
  for(const splitLog of bad){const data={...planner(),splitLog},before=JSON.stringify(data);assert.throws(()=>api.externalData.planner(data),/splitLog/);assert.equal(JSON.stringify(data),before);}
  for(const key of ['id','ticker','from','to','exDate','appliedAt','planner','assets']){
    const record=log();delete record[key];assert.throws(()=>api.externalData.planner({...planner(),splitLog:[record]}),/splitLog/);
  }
  const data={...planner(),splitLog:[log({id:'synthetic-private-value',ticker:'bad ticker'})]};assert.throws(()=>api.externalData.planner(data),e=>!e.message.includes('synthetic-private-value'));
});
