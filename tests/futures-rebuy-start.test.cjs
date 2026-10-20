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
