// 가상 계약·시세만 사용한다. 시작선 변경의 계산·판정·알림과 기존 기록 호환을 함께 검증한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder.js','prices.js','rebuy.js','trade-alerts.js','futures.js','futures-plan.js','futures-rebuy.js','data-validation.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const load=()=>{const c=vm.createContext({contractSize:10000});vm.runInContext(source,c);return c;};
const plain=x=>JSON.parse(JSON.stringify(x));
const fixture=()=>({targetPrice:1480,baselinePnl:-50000,positions:[{month:'202612',contracts:10,settlementPrice:1450}],levels:[{days:25,unit:'일선',contracts:1,tranches:[{price:1360,completed:false}]}],rollSpread:0.4,note:'가상 설정',
  rebuy:{lowPrice:1400,floorPrice:1300,contracts:20,steps:1,cuts:[{contracts:10,price:1400,targetPrice:1400,month:'202612',settlementPrice:1450}],currentPrice:1330,
    stages:[{name:'25선',price:1320},{name:'32선',price:1330},{name:'42선',price:1340},{name:'60선',price:1360},{name:'80선',price:1380},{name:'25일선',price:1420}],notify:{buys:true,buysOverrides:{'stage:0':true,'stage:3':false}}}});
const quote=(ma={})=>({updatedAt:'2026-10-15T01:00:00Z',stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-15',close:1340,ma}}});
const open=s=>s.tranches.filter(x=>!x.done&&x.amount>0);

test('50시간선을 새로 선택하면 앞 단계의 시세·알림과 관계없이 50선부터 계산·판정·알림한다',()=>{
  const c=load(),f=fixture(),before=JSON.stringify(f);f.rebuy.stages[0].price=0;
  const untouched=JSON.stringify(f),g=c.futureRebuyWithStart(f,'50시선',{ma:{'50선':1350}}),s=c.futureRebuySummary(g),pending=open(s);
  assert.equal(JSON.stringify(f),untouched,'미리보기는 원본을 바꾸지 않는다');assert.notEqual(before,untouched);
  assert.equal(g.rebuy.startLine,'50선');assert.equal(g.rebuy.stages.length,7);
  assert.deepEqual(plain(pending.slice(0,3).map(x=>[s.stages[x.i].name,x.t,x.price])),[['50선',0,1350],['50선',1,1350+10/3],['50선',2,1350+20/3]]);
  assert.equal(pending.reduce((n,x)=>n+x.amount,0),10);assert.ok(s.plan.slice(0,3).every(x=>x===0));
  assert.equal(c.futureBuyDue(s,1349),null);assert.equal(c.futureBuyDue(s,1350).i,6);
  assert.equal(c.setFutureBuyDone(g,0,0,true),false,'시작선 이전 단계는 실제 체결 대상으로도 배정하지 않는다');
  const rules=plain(c.buildTradeAlertRules({futures:g},quote({'50선':1350}))).filter(x=>x.condition==='up');
  const expected=pending.filter(x=>c.futureRebuyAlertEnabled(g,'buys',`stage:${x.i}`));
  assert.deepEqual(rules.map(x=>x.targetPrice),plain(expected.map(x=>x.price)));
  assert.ok(rules.every(x=>!/^달러선물 재매수 (25|32|42)선/.test(x.label)));
  const second=rules.find(x=>x.id==='trade:future-rebuy:buy:stage:6:2');
  assert.equal(JSON.parse(second.revision)[3],'60선','추가한 50선의 다음 알림 기준은 저장 배열 옆이 아닌 60선');
  assert.deepEqual(plain(g.rebuy.notify),f.rebuy.notify,'기존 알림 스위치와 인덱스를 보존한다');
});

test('시간선·일선·주선·월선의 임의 기간을 시작선으로 쓰고 뒤 시간축·기간 순서를 지킨다',()=>{
  const c=load(),units=['선','일선','주선','개월선'];
  for(let axis=0;axis<units.length;axis++){
    const f=fixture();f.rebuy.stages=units.flatMap(unit=>[25,60,80].map(n=>({name:`${n}${unit}`,price:n===25?1320:n===60?1360:1380})));
    const line=`50${units[axis]}`,g=c.futureRebuyWithStart(f,line,{ma:{[line]:1350}}),s=c.futureRebuySummary(g);
    assert.equal(s.stages[open(s)[0].i].name,line);
    const names=plain(s.active.map(i=>s.stages[i].name));assert.equal(names[0],line);assert.equal(names[1],`60${units[axis]}`);
    assert.ok(names.every(n=>units.indexOf(n.replace(/^\d+/,''))>=axis));
    assert.equal(open(s).reduce((n,x)=>n+x.amount,0),s.rest);
    const loaded=JSON.parse(JSON.stringify(g)),snapshot=JSON.stringify(loaded);
    assert.deepEqual(plain(c.futureRebuySummary(loaded).planKeys),plain(s.planKeys));assert.equal(JSON.stringify(loaded),snapshot);
    assert.equal(loaded.rebuy.startLine,line,'저장·새로 불러온 뒤에도 시작선 유지');
  }
});

test('재매수 도중 시작선을 바꿔도 기존 손절·재매수 체결·보유·정산손익·다른 설정은 그대로다',()=>{
  const c=load(),f=fixture();
  f.rebuy.stages[0].buys=[{contracts:2,price:1321.5,month:'202612'}];f.rebuy.stages[1].done=true;f.rebuy.stages[1].contracts=1;f.rebuy.stages[1].execPrice=1331;
  f.rebuy.planned=[['25선',0],['25선',1],['32선',0],['42선',0],['60선',0]];
  const records=JSON.stringify([f.rebuy.cuts,f.rebuy.stages]),settings=JSON.stringify({...f,rebuy:undefined}),g=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}}),s=c.futureRebuySummary(g);
  assert.equal(JSON.stringify([g.rebuy.cuts,g.rebuy.stages.slice(0,6)]),records);
  assert.equal(JSON.stringify({...g,rebuy:undefined}),settings);assert.equal(s.rebought,3);assert.equal(s.rest,7);
  assert.equal(s.tranches.filter(x=>x.done).length,2);assert.equal(open(s).reduce((n,x)=>n+x.amount,0),7);
  assert.ok(open(s).every(x=>x.i>=3));assert.equal(s.stages[open(s)[0].i].name,'50선');
  const plan=JSON.stringify(s.planKeys);g.rebuy.stages[3].price=1450;
  assert.equal(JSON.stringify(c.futureRebuySummary(g).planKeys),plan,'시작선을 저장한 뒤의 시세 변동은 고정 계획을 바꾸지 않는다');
});

test('선택한 시작선의 시세가 없으면 추정 가격·앞 단계·다음 단계로 대체하지 않고 시세 수신 후 시작한다',()=>{
  const c=load(),f=fixture(),g=c.futureRebuyWithStart(f,'50선'),s=c.futureRebuySummary(g);
  assert.equal(s.waitingStart,true);assert.deepEqual(plain(open(s)),[]);assert.equal(c.futureBuyDue(s,1600),null);
  assert.equal(c.buildTradeAlertRules({futures:g},quote()).filter(x=>x.condition==='up').length,0);
  assert.equal(c.setFutureBuyDone(g,6,0,true),false);
  c.fillPrices({futures:g},quote({'50선':1350}));
  const ready=c.futureRebuySummary(g);assert.equal(ready.waitingStart,false);assert.equal(ready.stages[open(ready)[0].i].name,'50선');
  assert.equal(c.futureBuyDue(ready,1350).price,1350);
  const missing=fixture();missing.rebuy.startLine='50선';assert.equal(c.futureRebuySummary(missing).waitingStart,true);
});

test('앞 체결만 남아 있어도 다음 미체결은 선택 범위 안에서만 배분하고 시작선을 다시 앞당길 수 있다',()=>{
  const c=load(),f=fixture();f.rebuy.stages[0].buys=[{contracts:1,price:1320,manual:true}];f.rebuy.planned=[['25선',0]];
  const g=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}}),s=c.futureRebuySummary(g),first=open(s)[0];
  assert.equal(s.stages[first.i].name,'50선');assert.notEqual(c.setFutureBuyDone(g,first.i,first.t,true),false);
  const h=c.futureRebuyWithStart(g,'32선'),t=c.futureRebuySummary(h);
  assert.equal(h.rebuy.stages[0].buys[0].contracts,1);assert.equal(t.stages[open(t)[0].i].name,'32선');
  assert.equal(open(t).reduce((n,x)=>n+x.amount,0),t.sold-t.rebought);
});

test('기존 체결 뒤 새 시작선 시세를 기다린 경우도 시세 수신 후 첫 체결에서 새 회차 계획을 고정한다',()=>{
  const c=load(),f=fixture();f.rebuy.stages[0].buys=[{contracts:1,price:1320,month:'202612'}];f.rebuy.planned=[['25선',0]];
  const g=c.futureRebuyWithStart(f,'50선');assert.equal(c.futureRebuySummary(g).waitingStart,true);
  c.fillPrices({futures:g},quote({'50선':1350}));
  const s=c.futureRebuySummary(g),first=open(s)[0];assert.notEqual(c.setFutureBuyDone(g,first.i,first.t,true),false);
  assert.deepEqual(plain(g.rebuy.planned),plain(s.planKeys));
  g.rebuy.stages[3].price=1450;assert.deepEqual(plain(c.futureRebuySummary(g).planKeys),plain(s.planKeys));
});

test('옛 시작선 미설정 기록은 읽기만 해서는 필드를 만들거나 회차·알림·체결을 바꾸지 않는다',()=>{
  const c=load(),f=fixture(),before=JSON.stringify(f),s=c.futureRebuySummary(f);
  c.buildTradeAlertRules({futures:f},quote());assert.equal(JSON.stringify(f),before);
  assert.equal(Object.hasOwn(f.rebuy,'startLine'),false);assert.equal(s.stages[open(s)[0].i].name,'25선');
  const empty={positions:[],levels:[]};c.futureRebuySummary(empty);assert.equal(empty.rebuy,undefined);
  for(const line of ['0선','401선','2.5일선','50시간','<img src=x>',null])assert.equal(c.futureRebuyWithStart(f,line),null);
  assert.equal(JSON.stringify(f),before);
});

test('백업·동기화 JSON 경계가 시작선과 체결을 그대로 보존하고 잘못된 시작선 타입은 거부한다',()=>{
  const c=load(),g=c.futureRebuyWithStart(fixture(),'50선',{ma:{'50선':1350}}),data={plans:[],futures:g,actions:{}},before=JSON.stringify(data);
  c.data=data;vm.runInContext('externalData.planner(data)',c);assert.equal(JSON.stringify(data),before);
  for(const value of [[],{},50,true]){data.futures.rebuy.startLine=value;assert.throws(()=>vm.runInContext('externalData.planner(data)',c),/startLine/);}
});

test('옛 환율 복귀 체결도 시작선 이전의 완료 내역으로 보존하고 단계 수 상한에서는 기존 선만 선택한다',()=>{
  const c=load(),f=fixture();f.rebuy.returns=[{done:true,contracts:2,execPrice:1390}];
  const g=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}}),s=c.futureRebuySummary(g);
  assert.equal(s.rebought,2);assert.equal(s.rest,8);assert.equal(s.stages[open(s)[0].i].name,'50선');
  assert.equal(s.tranches.find(x=>x.done).execPrice,1390);assert.equal(f.rebuy.returns[0].contracts,2,'사본만 이전한다');
  const full=fixture();full.rebuy.stages=Array.from({length:80},(_,i)=>({name:`${i+1}일선`,price:1350}));const before=JSON.stringify(full);
  assert.equal(c.futureRebuyWithStart(full,'50선'),null);assert.equal(JSON.stringify(full),before);
  assert.equal(c.futureRebuyWithStart(full,'50일선').rebuy.stages.length,80);
});

test('직접 지정한 종료가격을 마지막 회차로 두고 범위 안에서만 계약·도달·알림을 계산한다',()=>{
  const c=load(),f=fixture(),before=JSON.stringify(f),g=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}},'1375'),s=c.futureRebuySummary(g),pending=open(s);
  assert.equal(JSON.stringify(f),before);assert.equal(g.rebuy.endPrice,1375);
  assert.equal(s.stages[pending[0].i].name,'50선');assert.equal(pending.at(-1).price,1375);assert.equal(s.stages[pending.at(-1).i].rebuyEnd,true);
  assert.ok(pending.every(x=>x.price<=1375));assert.equal(pending.reduce((n,x)=>n+x.amount,0),10);
  const rules=plain(c.buildTradeAlertRules({futures:g},quote({'50선':1350}))).filter(x=>x.condition==='up');
  assert.equal(rules.at(-1).label,'달러선물 재매수 종료가격');assert.equal(rules.at(-1).targetPrice,1375);assert.ok(rules.every(x=>x.targetPrice<=1375));
  for(const x of pending)assert.notEqual(c.setFutureBuyDone(g,x.i,x.t,true),false);
  assert.equal(c.futureRebuySummary(g).rest,0);assert.equal(c.futureBuyDue(c.futureRebuySummary(g),1500),null);
  assert.equal(c.buildTradeAlertRules({futures:g},quote()).filter(x=>x.condition==='up').length,0);
});

test('종료가격을 평균 손절 환율보다 높게 저장해도 그 위 회차는 배분·알림에서 빼고 같은 가격의 평균선 도달과 중복하지 않는다',()=>{
  const c=load(),f=fixture(),entry={ma:{'50선':1350}};
  const g=c.futureRebuyWithStart(f,'50선',entry,'1450'),s=c.futureRebuySummary(g),above=s.tranches.filter(x=>x.above);
  assert.equal(g.rebuy.endPrice,1450);assert.equal(s.sellAvg,1400);
  assert.ok(open(s).length>0&&open(s).every(x=>x.price<=1400),'평균 손절 환율 이하 회차만 배분');
  assert.ok(above.some(x=>x.price===1450&&s.stages[x.i].rebuyEnd)&&above.every(x=>x.price>1400&&x.amount===0&&!x.done),'종료 회차도 평균 손절 환율 위면 제외');
  assert.equal(s.above+open(s).reduce((n,x)=>n+x.amount,0),s.rest,'뺀 계약은 다른 회차에 다시 나누지 않고 미복원으로 둔다');
  assert.equal(c.futureBuyDue({tranches:above},1500),null,'제외 회차는 재매수 시점이 되지 않는다');
  const rules=plain(c.buildTradeAlertRules({futures:g},quote({'50선':1350}))).filter(x=>x.condition==='up');
  assert.ok(rules.length>0&&rules.every(x=>x.targetPrice<=1400));
  const h=c.futureRebuyWithStart(f,'50선',entry,'1360'),t=c.futureRebuySummary(h);
  assert.equal(open(t).filter(x=>x.price===1360).length,1);assert.equal(t.stages[open(t).at(-1).i].rebuyEnd,true);
});

test('종료가격 범위에서 계약이 적어도 마지막 가격을 배분하고 두 계약 이상이면 시작·종료를 포함한다',()=>{
  const c=load();
  for(const qty of [1,2,3,4,8]){
    const f=fixture();f.rebuy.cuts[0].contracts=qty;
    const g=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}},'1395'),s=c.futureRebuySummary(g),pending=open(s);
    assert.equal(pending.reduce((n,x)=>n+x.amount,0),qty);assert.ok(pending.every(x=>Number.isInteger(x.amount)&&x.amount>0));
    assert.equal(pending.at(-1).price,1395);
    if(qty>1)assert.equal(s.stages[pending[0].i].name,'50선');else assert.equal(pending.length,1);
  }
});

test('종료 회차 체결 뒤 범위 변경은 새 회차를 만들고 이전 체결·가격·알림 인덱스는 보존한다',()=>{
  const c=load(),f=fixture(),g=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}},'1375'),s=c.futureRebuySummary(g),end=open(s).at(-1);
  assert.notEqual(c.setFutureBuyDone(g,end.i,0,true),false);const recorded=JSON.stringify(g.rebuy.stages[end.i]),before=JSON.stringify(g.rebuy.stages);
  const h=c.futureRebuyWithStart(g,'50선',null,'1395'),t=c.futureRebuySummary(h);
  assert.equal(JSON.stringify(h.rebuy.stages[end.i]),recorded);assert.notEqual(h.rebuy.stages[t.endIndex].name,g.rebuy.stages[end.i].name);
  assert.equal(open(t).at(-1).price,1395);assert.equal(open(t).reduce((n,x)=>n+x.amount,0),t.sold-t.rebought);
  const loaded=JSON.parse(JSON.stringify(h));assert.deepEqual(plain(c.futureRebuySummary(loaded).planKeys),plain(t.planKeys));
  const cleared=c.futureRebuyWithStart(g,'50선',null,'');assert.equal(Object.hasOwn(cleared.rebuy,'endPrice'),false);
  assert.equal(JSON.stringify(cleared.rebuy.stages),before);assert.equal(c.futureRebuySummary(cleared).rebought,s.sold-c.futureRebuySummary(g).rest);
});

test('시작가보다 낮거나 잘못된 종료가격은 저장하지 않고 이후 시세로 범위가 뒤집혀도 앞·뒤 회차로 대체하지 않는다',()=>{
  const c=load(),f=fixture(),before=JSON.stringify(f);
  for(const end of ['1349','0','-1','NaN','Infinity'])assert.equal(c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}},end),null);
  assert.equal(JSON.stringify(f),before);
  const g=c.futureRebuyWithStart(f,'50선',null,'1375');assert.equal(c.futureRebuySummary(g).waitingStart,true);
  c.fillPrices({futures:g},quote({'50선':1380}));const s=c.futureRebuySummary(g);
  assert.match(s.rangeError,/종료가격보다 높/);assert.equal(open(s).length,0);assert.equal(c.futureBuyDue(s,1500),null);
  assert.equal(c.buildTradeAlertRules({futures:g},quote()).filter(x=>x.condition==='up').length,0);
});

test('종료가격은 하나의 저장 기준을 따르고 백업 검증은 원본과 기존 체결을 보존한다',()=>{
  const c=load(),g=c.futureRebuyWithStart(fixture(),'50선',{ma:{'50선':1350}},'1375'),s=c.futureRebuySummary(g);
  g.rebuy.stages[s.endIndex].price=9999;const before=JSON.stringify(g);
  assert.equal(open(c.futureRebuySummary(g)).at(-1).price,1375);assert.equal(JSON.stringify(g),before);
  c.data={plans:[],futures:g,actions:{}};vm.runInContext('externalData.planner(data)',c);
  for(const end of [-1,{},true]){c.data.futures.rebuy.endPrice=end;assert.throws(()=>vm.runInContext('externalData.planner(data)',c),/endPrice/);}
});

test('종료선을 시·일·주·월선으로 고르면 그 선의 도달까지만 배분하고 시세 변경을 가격·알림에 반영한다',()=>{
  const c=load();
  for(const unit of ['선','일선','주선','개월선']){
    const f=fixture();f.rebuy.stages=['선','일선','주선','개월선'].flatMap(u=>[25,60,80].map(n=>({name:`${n}${u}`,price:n===25?1320:n===60?1380:1390})));
    const first=`50${unit}`,last=`70${unit}`,g=c.futureRebuyWithStart(f,first,{ma:{[first]:1350,[last]:1385}},last),s=c.futureRebuySummary(g);
    assert.equal(g.rebuy.endLine,last);assert.equal(Object.hasOwn(g.rebuy,'endPrice'),false);
    assert.equal(s.stages[open(s)[0].i].name,first);assert.equal(s.stages[open(s).at(-1).i].name,last);assert.equal(open(s).at(-1).t,0);
    assert.deepEqual(plain(s.active.map(i=>s.stages[i].name)),[first,`60${unit}`,last]);
    assert.equal(open(s).reduce((n,x)=>n+x.amount,0),10);assert.equal(open(s).filter(x=>x.i===s.endIndex).length,1);
    const rules=plain(c.buildTradeAlertRules({futures:g},quote({[last]:1385,[first]:1350}))).filter(x=>x.condition==='up');
    assert.equal(rules.at(-1).label,`달러선물 재매수 ${last}`);assert.equal(rules.at(-1).targetPrice,1385);
    c.fillPrices({futures:g},{...quote({[last]:1388,[first]:1350}),updatedAt:'2026-10-15T02:00:00Z'});
    assert.equal(c.futureRebuySummary(g).endPrice,1388);
    const moved=plain(c.buildTradeAlertRules({futures:g},null)).filter(x=>x.condition==='up');
    assert.equal(moved.at(-1).targetPrice,1388);assert.equal(moved.at(-1).revision,rules.at(-1).revision,'이평선 시세 이동만으로 알림 이력을 초기화하지 않는다');
    const loaded=JSON.parse(JSON.stringify(g));assert.equal(loaded.rebuy.endLine,last);assert.deepEqual(plain(c.futureRebuySummary(loaded).planKeys),plain(c.futureRebuySummary(g).planKeys));
  }
});

test('종료선 시세가 비면 중간 단계나 자동 기준으로 대체하지 않고 시세를 받은 후에만 시작한다',()=>{
  const c=load(),g=c.futureRebuyWithStart(fixture(),'50선',{ma:{'50선':1350}},'70일선');
  const before=JSON.stringify(g),s=c.futureRebuySummary(g);assert.equal(s.waitingEnd,true);assert.equal(s.endPrice,null);assert.equal(open(s).length,0);
  assert.equal(c.futureBuyDue(s,1500),null);assert.equal(c.setFutureBuyDone(g,s.endIndex,0,true),false);
  assert.equal(c.buildTradeAlertRules({futures:g},quote()).filter(x=>x.condition==='up').length,0);assert.equal(JSON.stringify(g),before);
  c.fillPrices({futures:g},quote({'70일선':1390}));const ready=c.futureRebuySummary(g);
  assert.equal(ready.waitingEnd,false);assert.equal(ready.endPrice,1390);assert.equal(ready.stages[open(ready).at(-1).i].name,'70일선');
});

test('같은 시작·종료선은 도달 1회이며 역순 종료선은 거절하고 종료선 뒤의 싼 평균선도 제외한다',()=>{
  const c=load(),f=fixture(),before=JSON.stringify(f),g=c.futureRebuyWithStart(f,'60선',null,'60선'),s=c.futureRebuySummary(g);
  assert.equal(open(s).length,1);assert.equal(open(s)[0].price,1360);assert.equal(open(s)[0].amount,10);
  for(const last of ['42선','25선','0일선','401주선'])assert.equal(c.futureRebuyWithStart(f,'60선',null,last),null);
  assert.equal(JSON.stringify(f),before);
  const h=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}},'60선');h.rebuy.stages[4].price=1351;
  assert.equal(c.futureRebuySummary(h).active.includes(4),false);assert.ok(open(c.futureRebuySummary(h)).every(x=>x.i!==4));
});

test('직접·평균선·자동으로 종료 기준을 바꿔도 체결 기록과 다른 설정은 보존한다',()=>{
  const c=load(),f=fixture(),g=c.futureRebuyWithStart(f,'50선',{ma:{'50선':1350}},'1375'),s=c.futureRebuySummary(g),end=open(s).at(-1);
  c.setFutureBuyDone(g,end.i,0,true);const record=JSON.stringify(g.rebuy.stages[end.i]),cuts=JSON.stringify(g.rebuy.cuts),settings=JSON.stringify({...g,rebuy:undefined});
  const h=c.futureRebuyWithStart(g,'50선',null,'80선'),t=c.futureRebuySummary(h);
  assert.equal(h.rebuy.endLine,'80선');assert.equal(Object.hasOwn(h.rebuy,'endPrice'),false);assert.equal(t.endPrice,1380);
  assert.equal(JSON.stringify(h.rebuy.stages[end.i]),record);assert.equal(JSON.stringify(h.rebuy.cuts),cuts);assert.equal(JSON.stringify({...h,rebuy:undefined}),settings);
  assert.equal(open(t).reduce((n,x)=>n+x.amount,0),t.rest);
  const direct=c.futureRebuyWithStart(h,'50선',null,'1395');assert.equal(Object.hasOwn(direct.rebuy,'endLine'),false);assert.equal(direct.rebuy.endPrice,1395);
  const cleared=c.futureRebuyWithStart(h,'50선',null,'');assert.equal(Object.hasOwn(cleared.rebuy,'endLine'),false);assert.equal(Object.hasOwn(cleared.rebuy,'endPrice'),false);
  assert.equal(c.futureRebuySummary(cleared).rebought,t.rebought);assert.equal(JSON.stringify(cleared.rebuy.stages[end.i]),record);
});
