// 모두 가상 계획·시세·체결 기록. 실제 보유 기록은 공개 테스트에 넣지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder.js','prices.js','futures.js','futures-plan.js','futures-rebuy.js'].map(name=>fs.readFileSync(path.join(__dirname,'../js',name),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({contractSize:10000});vm.runInContext(source,ctx);return ctx;};
const clone=value=>JSON.parse(JSON.stringify(value));
const level=(days,price,contracts=3)=>({days,unit:'일선',price,confirmed:true,contracts,tranches:Array.from({length:contracts},(_,slot)=>({price,completed:false,executionPrice:null,slot}))});

test('계획 창에서 바꾸지 않은 기준가·체결·알림은 그 사이 갱신된 최신 기록을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  f.levels[0].price=1405;f.levels[0].notify=true;
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1401,mergedMonth:'202612'});
  const before=JSON.stringify(f);
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(JSON.stringify(f),before,'열고 저장만 하면 기존 기록에 필드를 만들거나 값을 되돌리지 않는다');
  edited[1].contracts=4;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].price,1405);assert.equal(f.levels[0].notify,true);
  assert.equal(f.levels[0].tranches[0].executionPrice,1401);assert.equal(f.levels[0].tranches[0].mergedMonth,'202612');
  assert.equal(f.levels[1].contracts,4);assert.equal(f.levels[1].tranches.length,4);
});

test('기준가 수정은 관련 회차 가격만 다시 채우고 이미 체결한 가격을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430),level(42,1460)]};
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1399,mergedMonth:'202612'});
  f.levels[0].tranches[1].priceOverride=1412;f.levels[2].tranches[1].priceOverride=1462;
  const base=clone(f.levels),edited=clone(base);edited[1].price=1460;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].tranches[0].executionPrice,1399);
  assert.equal(f.levels[0].tranches[1].price,1420);assert.equal(f.levels[0].tranches[2].price,1440);
  assert.equal(Object.hasOwn(f.levels[0].tranches[1],'priceOverride'),false);
  assert.equal(f.levels[2].tranches[1].priceOverride,1462);
});

test('창을 연 뒤 매수가 늘어도 완료 수보다 줄이는 수정은 원본 전체를 보존하며 거부한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  edited[0].price=1402;edited[1].contracts=1;
  f.levels[1].tranches[0].completed=true;f.levels[1].tranches[1].completed=true;
  const before=JSON.stringify(f);
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),false);
  assert.equal(JSON.stringify(f),before,'앞 구간의 기준가도 일부 적용하지 않는다');
});

test('새 평균선·직접 입력 계획을 저장하고 중복·잘못된 값은 원본을 건드리지 않는다',()=>{
  const ctx=load(),f={levels:[level(25,1400)]},base=clone(f.levels);
  for(const bad of [{...level(25,1410)},{...level(32,-1)},{...level(32,1430),contracts:1.5}]){
    const before=JSON.stringify(f);assert.equal(ctx.applyFuturePlanEdits(f,base,[...clone(base),bad]),false);assert.equal(JSON.stringify(f),before);
  }
  const edited=[...clone(base),level(32,1430),{days:0,unit:'',label:'가상 추가 매수',price:1390,confirmed:true,contracts:2,tranches:[]}];
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels.length,3);assert.equal(f.levels[1].tranches.length,3);assert.equal(f.levels[2].tranches.length,2);
  assert.ok(f.levels[2].tranches.every(t=>t.price===1390&&!t.completed));
});

test('계약 수를 0으로 바꿔도 평균선 기준은 남아 앞 구간의 가격 계산에 쓰인다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);edited[1].contracts=0;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels.length,2);assert.equal(f.levels[1].price,1430);assert.equal(f.levels[1].tranches.length,0);
  assert.deepEqual(clone(ctx.futureBuyPrices(f.levels,0)),[1400,1410,1420]);
});

test('기준선 알림은 수정한 선택만 저장하고 최신 다른 구간의 선택을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  f.levels[1].notify=true;edited[0].notify=false;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].notify,false);assert.equal(f.levels[1].notify,true);
});

test('가격·계약 수를 수정해도 창을 연 뒤 바뀐 회차별 알림을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  edited[0].price=1402;edited[1].contracts=4;
  f.levels[0].tranches[1].notify=true;f.levels[1].tranches[0].notify=false;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].tranches[1].notify,true);assert.equal(f.levels[1].tranches[0].notify,false);
  assert.equal(Object.hasOwn(f.levels[1].tranches[3],'notify'),false,'늘린 계약은 기존 기본 알림을 따른다');
});

test('기준선 전체 알림을 직접 선택하면 같은 기본값도 회차 예외를 지우고 다른 구간을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]};
  f.levels[0].notify=false;f.levels[0].tranches[1].notify=true;f.levels[1].tranches[0].notify=true;
  const base=clone(f.levels),edited=clone(base);
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited,[0]),true);
  assert.equal(f.levels[0].notify,false);assert.ok(f.levels[0].tranches.every(t=>!Object.hasOwn(t,'notify')));
  assert.equal(f.levels[1].tranches[0].notify,true);
  const before=JSON.stringify(f),invalid=clone(base);invalid[1].contracts=-1;
  assert.equal(ctx.applyFuturePlanEdits(f,base,invalid,[0]),false);assert.equal(JSON.stringify(f),before);
});

test('환율 사다리 지금 행은 보유 근월물 선물 시세와 수집 시각·지연·조회 실패를 구분한다',()=>{
  const ctx=vm.createContext({contractSize:10000,esc:v=>String(v)});
  vm.runInContext(['prices.js','ma-ladder.js','futures.js','futures-plan.js','futures-rebuy.js'].map(name=>fs.readFileSync(path.join(__dirname,'../js',name),'utf8')).join('\n;\n'),ctx);
  const at='2026-10-16T01:40:00Z',now=new Date('2026-10-16T02:05:00Z'),fe={kind:'선물',asOf:'2026-10-16',close:1385.2,ma:{}};
  assert.deepEqual({...ctx.futureQuoteTime(fe,at,now)},{text:'10/16 10:40 수집 · 25분 전',old:false,delayed:false});
  assert.equal(ctx.futureQuoteTime(fe,at,new Date('2026-10-16T04:00:00Z')).text,'10/16 10:40 수집 · 2시간 전 · 지연');
  assert.deepEqual({...ctx.futureQuoteTime({...fe,asOf:'2026-10-15'},'2026-10-17T00:00:00Z',now)},{text:'10/15 종가 · 마지막 가격',old:false,delayed:true});
  assert.deepEqual({...ctx.futureQuoteTime({...fe,stale:true},at,now)},{text:'조회 실패 · 10/16 기준 마지막 가격',old:true,delayed:true});
  assert.equal(ctx.futureQuoteTime(fe,'',now).text,'10/16 기준');
  // 시세 파일의 현물 환율이 있어도 선물 월물 시세만 쓰고, 보유 월물이 없으면 안내만 한다.
  ctx.priceData={updatedAt:at,stocks:{},fx:{USDKRW:{kind:'현물환율',asOf:'2026-10-16',close:1370,ma:{}}},futures:{'202611':fe}};
  Object.assign(ctx,{won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),shown:v=>String(v),PENCIL:''});
  const f={targetPrice:1480,baselinePnl:0,levels:[],positions:[{month:'202612',contracts:0,settlementPrice:1},{month:'202611',contracts:2,settlementPrice:1380}]};
  const html=ctx.futureLadderHtml(f,ctx.priceData.futures[ctx.priceMonth(f)]);
  assert.match(html,/<b>1,385\.2원<\/b><small><span class="future-quote-time( old)?" title="[^"]*202611[^"]*">지금 · \d+(분|시간|일) 전/);
  assert.doesNotMatch(html,/근월물|1,370|10\/16 10:40 수집/,'수집 날짜·시각은 위 최근 수집 줄에만 두고 현물 환율은 쓰지 않는다');
  assert.equal(ctx.futureQuote(f,ctx.priceData.futures['202611']),'','시세가 있으면 안내 없이 사다리 지금 행으로 보인다');
  assert.match(ctx.futureQuote({positions:[]},null),/보유 월물을 입력하면/);
  assert.match(ctx.futureQuote(f,null),/시세 없음/);
  assert.match(ctx.futureLadderHtml(f,null),/시세 없음[^]*1,480원/,'시세가 없으면 지금 행 대신 안내를 보이고 나머지 행은 그린다');
});

test('달러선물 가격 글자·입력칸은 소수 첫째 자리까지만 보이고 기록한 가격은 그대로 둔다',()=>{
  const ctx=vm.createContext({contractSize:10000,esc:v=>String(v),PENCIL:'',decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),money:v=>`${Math.round(v)}원`});
  vm.runInContext(source,ctx);
  const run=expr=>vm.runInContext(expr,ctx);
  assert.equal(run('fmtPrice(1378.3333333333333)'),'1,378.3');assert.equal(run('fmtPrice(1401.6666666666667)'),'1,401.7');assert.equal(run('fmtPrice(1385.2)'),'1,385.2');assert.equal(run('fmtPrice(1371.649)'),'1,371.6');assert.equal(run('fmtPrice(1380)'),'1,380');
  assert.equal(run('futureShown(1378.3333333333333)'),'1378.3');assert.equal(run('futureShown(1401.6666666666667)'),'1401.7');assert.equal(run('futureShown(1385.2)'),'1385.2');
  // 25일선 1,370 → 다음 32일선 1,375의 ⅓ 회차(1,371.6666…)는 매수가 칸과 체크한 회차 모두 첫째 자리까지
  const f={targetPrice:1480,positions:[{month:'202612',contracts:3,settlementPrice:1372.3333333333333}],levels:[level(25,1370),level(32,1375)]};
  ctx.refreshFutureBuyPrices(f);Object.assign(f.levels[0].tranches[2],{completed:true,executionPrice:f.levels[0].tranches[2].price,mergedMonth:'202612'});
  const before=JSON.stringify(f),html=ctx.futureBuyTable(f);
  assert.equal(JSON.stringify(f),before,'표시는 기록을 바꾸지 않는다');
  assert.match(html,/data-tranche-price="0:1"[^>]*value="1371\.7"/);assert.match(html.replace(/<[^>]*>/g,''),/1,373\.3원 · 1계약/);
  assert.doesNotMatch(html,/\d\.\d{2}/,'둘째 자리 이상 숫자를 보이지 않는다');
  assert.equal(f.levels[0].tranches[1].price,1370+5/3);
});

const buyTableContext=()=>{
  const ctx=load();
  Object.assign(ctx,{esc:v=>String(v),PENCIL:'',decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),money:v=>`${Math.round(v)}원`});
  return ctx;
};
const buyTableFutures=levels=>({targetPrice:1480,positions:[{month:'202612',contracts:2,settlementPrice:1370}],levels});
const buyTableQuote=close=>({stocks:{},updatedAt:'2026-10-28T01:00:00Z',futures:{'202612':{kind:'달러선물',asOf:'2026-10-28',close,ma:{}}}});
const buyTableRow=(html,key)=>{
  const row=[...html.matchAll(/<div class="future-buy-row([^"]*)">([\s\S]*?)(?=<div class="future-buy-row|$)/g)].find(m=>m[2].includes(`data-tranche-check="${key}"`));
  assert.ok(row,`${key} 회차를 찾는다`);
  return {classes:row[1].trim().split(/\s+/),html:row[2]};
};
const assertBuyTableDue=(html,key,due,note='')=>{
  const row=buyTableRow(html,key);
  assert.equal(row.classes.includes('due'),due,`${key} 회차 도달 강조${note?` · ${note}`:''}`);
  assert.equal(/<small class="future-buy-due">도달<\/small>/.test(row.html),due,`${key} 회차 도달 글자${note?` · ${note}`:''}`);
};

test('분할매수 도달은 평균선·종료가 이상과 직접 매수가 이하를 포함하며 알림 선택·완료와 구분한다',()=>{
  const ctx=buyTableContext(),manual=price=>({label:'가상 직접 매수',price,contracts:1,tranches:[{price,completed:false}]}),f=buyTableFutures([
    level(25,1360,1),level(32,1365,1),level(42,1370,1),level(60,1380,1),manual(1360),manual(1380),manual(1370),{...manual(1370),planEnd:true}
  ]);
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1360,mergedMonth:'202612'});
  f.levels[1].notify=false;f.levels[2].tranches[0].notify=false;
  ctx.priceData=buyTableQuote(1370);
  const before=JSON.stringify(f),html=ctx.futureBuyTable(f);
  [false,true,true,false,false,true,true,true].forEach((due,i)=>assertBuyTableDue(html,`${i}:0`,due));
  assert.match(buyTableRow(html,'1:0').html,/class="future-buy-round"/,'도달 글자는 기준선·회차 아래에 둔다');
  assert.equal(JSON.stringify(f),before,'도달 표시는 완료·알림·보유 기록을 바꾸지 않는다');
});

test('분할매수 도달은 화면의 보유 근월물 시세를 쓰고 편입 월물·현물 환율을 대신 쓰지 않는다',()=>{
  const ctx=buyTableContext(),f=buyTableFutures([level(25,1370,1)]);
  f.levels[0].tranches[0].month='202701';
  ctx.priceData=buyTableQuote(1360);
  ctx.priceData.futures['202701']={kind:'달러선물',asOf:'2026-10-28',close:1500,ma:{}};
  ctx.priceData.fx={USDKRW:{kind:'현물환율',asOf:'2026-10-28',close:1500,ma:{}}};
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false);
  ctx.priceData.futures['202612'].close=1380;ctx.priceData.futures['202701'].close=1300;ctx.priceData.fx.USDKRW.close=1300;
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',true);
  delete ctx.priceData.futures['202612'];
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false,'다른 월물이 있어도 보유 근월물 시세 없음을 도달로 보지 않는다');
});

test('분할매수 도달은 시세·가격이 없거나 유효하지 않으면 표시하지 않는다',()=>{
  const ctx=buyTableContext(),f=buyTableFutures([level(25,1370,1)]);
  for(const doc of [undefined,null,{},buyTableQuote(undefined),buyTableQuote(null),buyTableQuote(''),buyTableQuote(0),buyTableQuote(-1),buyTableQuote(NaN),buyTableQuote(Infinity),buyTableQuote('가격 없음')]){
    ctx.priceData=doc;assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false);
  }
  ctx.priceData=buyTableQuote(1380);delete ctx.priceData.futures['202612'].asOf;
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false,'유효한 시세 형식을 확인한다');
  ctx.priceData=buyTableQuote(1380);
  for(const price of [0,-1,NaN,Infinity]){
    f.levels[0].tranches[0].price=price;assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false);
  }
  f.levels[0].tranches[0].price=1370;ctx.priceData=buyTableQuote('1370');
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',true,'숫자로 저장된 시세도 같은 값으로 비교한다');
});

test('분할매수 도달은 소수 첫째 자리 표시 반올림 대신 실제 저장 가격을 비교한다',()=>{
  const ctx=buyTableContext(),f=buyTableFutures([level(25,1371.649,1)]);
  ctx.priceData=buyTableQuote(1371.6);
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false,'같은 1,371.6원 표시여도 아직 실제 매수가 미만이다');
  ctx.priceData.futures['202612'].close=1371.649;
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',true);
  const direct={label:'가상 직접 매수',price:1369.951,contracts:1,tranches:[{price:1369.951,completed:false}]};
  f.levels=[direct];ctx.priceData.futures['202612'].close=1370;
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false,'하락 매수도 표시 반올림으로 먼저 도달 처리하지 않는다');
  ctx.priceData.futures['202612'].close=1369.951;
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',true);
});

test('종료 이동평균 계획이 오류·추가 배분 대기이면 보존한 옛 미매수 회차를 도달로 표시하지 않는다',()=>{
  const ctx=buyTableContext(),f=buyTableFutures([level(25,1400,1),level(42,1450,0)]);
  f.buyPlan={startLine:'25일선',endLine:'42일선',endPrice:1450,contracts:1,units:['일선']};
  ctx.priceData=buyTableQuote(1500);
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',true,'유효한 계획의 매수 회차는 표시한다');
  f.buyPlan.endPrice=1390;assert.ok(ctx.futureAutoBuyPlan(f).error);
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false);
  f.buyPlan.endPrice=1450;f.levels[0].price=0;assert.ok(ctx.futureAutoBuyPlan(f).error);
  assertBuyTableDue(ctx.futureBuyTable(f),'0:0',false);
  f.levels=[level(25,1400,1),level(32,1300,1),level(42,1450,0),{planEnd:true,label:'종료가',price:1450,contracts:1,tranches:[{price:1450,completed:true,executionPrice:1450,mergedMonth:'202612'}]}];
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1400,mergedMonth:'202612'});
  f.levels[1].tranches[0].price=1410;f.buyPlan.contracts=3;
  assert.ok(ctx.futureAutoBuyPlan(f).waiting,'남은 계약을 배분할 새 기준선이 없다');
  const before=JSON.stringify(f),html=ctx.futureBuyTable(f);
  assertBuyTableDue(html,'1:0',false);
  assert.equal(JSON.stringify(f),before,'대기 중 보존한 회차도 표시만 하고 기록을 바꾸지 않는다');
});

test('산 분할매수 회차의 체결가를 고치면 편입 월물 단순평균가를 맞추고 체크를 풀면 새 체결가로 되돌린다',()=>{
  const ctx=buyTableContext(),f=buyTableFutures([level(25,1400,2)]),t=f.levels[0].tranches[0],near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);
  ctx.addToPosition(f,'202612',1,1400);Object.assign(t,{completed:true,executionPrice:1400,mergedMonth:'202612',month:'202612'});
  near(f.positions[0].settlementPrice,1380);
  assert.notEqual(ctx.setFutureTrancheExec(f,0,0,'1395.5'),false);
  assert.equal(t.executionPrice,1395.5);assert.equal(t.price,1400,'계획가는 그대로');assert.equal(f.positions[0].contracts,3);
  near(f.positions[0].settlementPrice,(1370*2+1395.5)/3);
  assert.equal(ctx.futuresSummary(f).avg,(1395.5+1400)/2,'평균 매수가도 체결가 기준');
  assert.equal(ctx.removeFromPosition(f,'202612',1,t.executionPrice),true);near(f.positions[0].settlementPrice,1370);
});

test('체결가 수정은 잘못된 값·미매수 회차·보유에 없는 편입 월물이면 기록을 바꾸지 않고 월물 밖 옛 매수는 기록만 고친다',()=>{
  const ctx=buyTableContext(),f=buyTableFutures([level(25,1400,2)]),t=f.levels[0].tranches[0];
  Object.assign(t,{completed:true,executionPrice:1400,mergedMonth:'202612'});f.positions[0].contracts=3;f.positions[0].settlementPrice=1380;
  const before=JSON.stringify(f);
  for(const text of ['','0','-1','abc','Infinity'])assert.equal(ctx.setFutureTrancheExec(f,0,0,text),false,text);
  assert.equal(ctx.setFutureTrancheExec(f,0,1,'1390'),false,'안 산 회차');assert.equal(ctx.setFutureTrancheExec(f,3,0,'1390'),false);
  t.mergedMonth='202609';const moved=JSON.stringify(f);assert.equal(ctx.setFutureTrancheExec(f,0,0,'1390'),'no-month');assert.equal(JSON.stringify(f),moved);
  t.mergedMonth='202612';assert.equal(JSON.stringify(f),before);
  const old=f.levels[0].tranches[1];Object.assign(old,{completed:true,executionPrice:1410});
  const positions=JSON.stringify(f.positions),gain=p=>ctx.futuresSummary(f,p).current;
  assert.notEqual(ctx.setFutureTrancheExec(f,0,1,'1405'),false);assert.equal(old.executionPrice,1405);assert.equal(JSON.stringify(f.positions),positions);
  assert.equal(gain(1480)-gain(1470),(3+1)*10*10000,'월물 밖 매수는 체결가로 손익 계산');assert.equal(ctx.futuresSummary(f,1405).legacyCount,1);
});

test('분할매수 표의 산 회차는 체결가를 점선으로 보이고 그 자리에서 고치며 자동 배분 미매수 회차는 글자로 둔다',()=>{
  const ctx=buyTableContext(),f=buyTableFutures([level(25,1400,2)]);
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1396.25,mergedMonth:'202612'});
  let html=ctx.futureBuyTable(f),done=buyTableRow(html,'0:0').html,open=buyTableRow(html,'0:1').html;
  assert.match(done,/<label class="future-tap-price" title="[^"]*체결가 수정"><span class="price" aria-hidden="true">1,396\.3원<\/span><input data-future-exec="0:0"[^>]*value="1396\.3"/);
  assert.doesNotMatch(done,/data-tranche-price/);assert.match(open,/data-tranche-price="0:1"/);assert.doesNotMatch(open,/data-future-exec/);
  f.buyPlan={startLine:'25일선',endPrice:1450,contracts:2,units:['일선']};
  html=ctx.futureBuyTable(f);open=buyTableRow(html,'0:1').html;
  assert.match(buyTableRow(html,'0:0').html,/data-future-exec="0:0"/,'자동 배분에서도 산 회차 체결가는 고친다');
  assert.doesNotMatch(open,/data-tranche-price|data-future-exec/,'자동 배분 미매수 회차는 계획 창에서 정한다');
});
