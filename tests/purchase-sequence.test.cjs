const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 공개 계산을 DOM 없이 실행한다. 화면과 같은 회차 선택 및 남은 회차의 선행 관계를 검증한다.
const {purchaseAlertRules,purchaseLineRows,purchaseLineSelection,purchaseSummary,purchaseInOrderSelection,movingLineRange,MA_LINES}=vm.runInThisContext(`(function(){${['ma-ladder.js','assets-calc.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n')}
return {purchaseAlertRules,purchaseLineRows,purchaseLineSelection,purchaseSummary,purchaseInOrderSelection,movingLineRange,MA_LINES};})()`);
const item=(id='a',ticker='111111',buyPlan=linePlan())=>({id,ticker,buyPlan});
const assets=(...items)=>({version:1,allocation:{groups:[{id:'test-group',items}]}});
// 목표가 없이 마지막 선까지 사면 마지막 선보다 위인 앞 선은 빠지므로, 앞 선 미도달·뒤 선 도달의 선행 관계는 목표가 계획으로 검증한다.
const linePlan=()=>({lines:{names:['42선','150주선'],startLine:'42선',end:13000,budget:100},notify:{stages:true}});
const quotes=(close=11000)=>({stocks:{'111111':{kind:'국내',asOf:'2026-01-02',close,ma:{'42선':12000,'150주선':10000}}}});
const chain=rules=>rules.map(r=>[r.id,r.after??null]);

const screenPlan=()=>({lines:{names:['25일선','32일선','60개월선'],end:14000,budget:100},notify:{stages:true}});
const screenQuote=(close=11000)=>({kind:'국내',asOf:'2026-01-02',close,ma:{'25일선':12000,'32일선':13000,'60개월선':10000}});
const keys=rows=>rows.map(r=>r.key);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);

test('화면에서 순서 밖 도달로 빠진 주선 회차는 ON·OFF 모두 알림에서 빼고 남은 선행 관계를 잇는다',()=>{
  for(const on of [false,true]){
    const plan={lines:{names:['150일선','25주선','32주선'],budget:100},notify:{stages:on}};
    const entry={kind:'국내',asOf:'2026-01-02',close:11000,ma:{'150일선':12000,'25주선':10000,'32주선':13000}};
    const doc=assets(item('a','111111',plan)),prices={stocks:{'111111':entry}},before=JSON.stringify({doc,prices});
    const screen=purchaseLineSelection(plan,entry,{inOrder:true});
    assert.deepEqual(keys(screen.skipped),['25주선:0','25주선:1']);
    const rules=purchaseAlertRules(doc,prices,true),visible=screen.rows.filter(r=>!r.done).map(r=>`trade:buy:a:${r.key}`);
    assert.deepEqual(rules.map(r=>r.id),visible);
    assert.equal(rules.some(r=>['trade:buy:a:25주선:0','trade:buy:a:25주선:1'].includes(r.id)),false);
    assert.deepEqual(chain(rules),visible.map((id,i)=>[id,i?visible[i-1]:null]));
    assert.deepEqual(purchaseAlertRules(doc,prices),on?rules:[]);
    assert.equal(JSON.stringify({doc,prices}),before,'회차 제외는 계획·체결·시세를 저장하거나 수정하지 않는다');
  }
});

test('순서 밖 주선에도 부분 체결 기록이 있으면 고정된 잔량과 알림을 유지한다',()=>{
  const plan={lines:{names:['150일선','25주선','32주선'],budget:100},notify:{stages:false},buys:{
    '25주선:0':{plannedShares:10,shares:4,plannedActual:10,actual:4,price:10000}
  }};
  const entry={kind:'국내',asOf:'2026-01-02',close:11000,ma:{'150일선':12000,'25주선':10000,'32주선':13000}};
  const doc=assets(item('a','111111',plan)),prices={stocks:{'111111':entry}},before=JSON.stringify({doc,prices});
  const screen=purchaseLineSelection(plan,entry,{inOrder:true});
  assert.equal(screen.rows.find(r=>r.key==='25주선:0').remainingShares,6);
  assert.deepEqual(keys(screen.skipped),['25주선:1']);
  const rules=purchaseAlertRules(doc,prices,true),partial=rules.find(r=>r.id==='trade:buy:a:25주선:0');
  assert.equal(partial.targetPrice,10000);assert.equal(partial.notify,false);
  assert.deepEqual(rules.map(r=>r.id),screen.rows.map(r=>`trade:buy:a:${r.key}`));
  assert.equal(JSON.stringify({doc,prices}),before);
});

const progressPlan=()=>({lines:{names:['60선','80선','80일선','100일선'],budget:1,end:200},notify:{stages:true}});
const progressQuote=()=>({kind:'국내',asOf:'2026-01-02',close:150,ma:{'60선':100,'80선':100.008,'80일선':140,'100일선':170}});

test('60선 1·2차 뒤 일선 체결이 있으면 시선 역전으로 지난 미체결 회차를 화면·합계·알림에 되살리지 않는다',()=>{
  for(const shares of [4,10])for(const second of [false,true])for(const t of [0,1,2])for(const budget of [0.2,1]){
    const plan=progressPlan();plan.lines.budget=budget;plan.buys={
      '60선:0':{plannedShares:10,shares,plannedActual:0.1,actual:shares/100,price:100},
      ...(second?{'60선:1':{shares:1,actual:0.01,price:100}}:{}),
      [`80일선:${t}`]:{plannedShares:2,shares:1,plannedActual:0.028,actual:0.014,price:140}
    };
    const entry=progressQuote(),doc=assets(item('a','111111',plan)),prices={stocks:{'111111':entry}},before=JSON.stringify({doc,prices});
    for(const trade of [{},{inOrder:true}]){
      const selected=purchaseLineSelection(plan,entry,trade),rows=purchaseLineRows(plan,entry,trade);
      assert.equal(keys(rows).includes('60선:2'),false);
      assert.equal(keys(selected.skipped).includes('60선:2'),false,'순서 판정 전에 제외한다');
      assert.deepEqual(keys(rows).filter(key=>key.startsWith('60선:')),second?['60선:0','60선:1']:['60선:0']);
      assert.equal(purchaseSummary(plan,entry,trade).count,rows.length);
      near(rows.reduce((sum,r)=>sum+(r.actual||0)+(r.done?0:r.amount),0),budget);
    }
    for(const quiet of [false,true]){
      const rules=purchaseAlertRules(doc,prices,quiet);
      assert.equal(rules.some(r=>r.id==='trade:buy:a:60선:2'),false);
      assert.equal(rules.some(r=>r.id==='trade:buy:a:60선:1'),false);
      assert.equal(rules.some(r=>r.after==='trade:buy:a:60선:2'),false);
    }
    assert.equal(JSON.stringify({doc,prices}),before,'부분 체결을 포함한 조회도 계획·buys에 필드를 만들거나 지우지 않는다');
  }
});

test('names의 뒤 선 체결이 없으면 60선의 남은 2·3차를 유지하고 범위 밖·목표가 체결은 진행으로 보지 않는다',()=>{
  for(const extra of [{},{'150주선:0':{shares:1,actual:0.02,price:200}},{end:{shares:1,actual:0.02,price:200}}]){
    const plan=progressPlan();plan.buys={'60선:0':{shares:1,actual:0.01,price:100},...extra};
    const entry=progressQuote(),doc=assets(item('a','111111',plan)),prices={stocks:{'111111':entry}},before=JSON.stringify({doc,prices});
    assert.deepEqual(keys(purchaseLineRows(plan,entry)).slice(0,3),['60선:0','60선:1','60선:2']);
    assert.deepEqual(purchaseAlertRules(doc,prices).slice(0,2).map(r=>r.id),['trade:buy:a:60선:1','trade:buy:a:60선:2']);
    assert.equal(JSON.stringify({doc,prices}),before);
  }
  const plan=progressPlan();plan.lines.names=['80일선','60선','80선','100일선'];
  plan.buys={'80일선:0':{shares:1,actual:0.014,price:140},'60선:0':{shares:1,actual:0.01,price:100}};
  const before=JSON.stringify(plan),rows=purchaseLineRows(plan,progressQuote());
  assert.ok(keys(rows).includes('60선:1')&&keys(rows).includes('60선:2'),'시·일 단위 순서가 아닌 names 순서에서 뒤 선인지 판정한다');
  assert.equal(JSON.stringify(plan),before);
});

test('같은 선 안의 남은 회차와 1차를 체결하지 않은 앞 선의 회차·목표가는 유지한다',()=>{
  const plan=progressPlan();plan.buys={'60선:1':{shares:1,actual:0.01,price:100},'80일선:0':{shares:1,actual:0.014,price:140}};
  const entry=progressQuote(),doc=assets(item('a','111111',plan)),prices={stocks:{'111111':entry}},before=JSON.stringify({doc,prices});
  const rows=purchaseLineRows(plan,entry,{inOrder:true});
  assert.deepEqual(keys(rows),[
    '60선:0','60선:1','60선:2','80선:0','80선:1','80선:2','80일선:0','80일선:1','80일선:2','100일선:0','end'
  ]);
  assert.deepEqual(purchaseAlertRules(doc,prices).map(r=>r.id),rows.filter(r=>!r.done).map(r=>`trade:buy:a:${r.key}`));
  near(rows.reduce((sum,r)=>sum+(r.actual||0)+(r.done?0:r.amount),0),1);
  assert.equal(JSON.stringify({doc,prices}),before);
});

test('지난 선의 이미 체결한 2·3차 기록과 부분 체결 잔량·알림은 선이 다시 뒤집혀도 유지한다',()=>{
  for(const next of [90,100.008]){
    const plan=progressPlan();plan.buys={
      '60선:0':{shares:1,actual:0.01,price:100},
      '60선:1':{plannedShares:5,shares:5,plannedActual:0.05,actual:0.05,price:100,next:'80선'},
      '60선:2':{plannedShares:10,shares:4,plannedActual:0.1,actual:0.04,price:100,next:'80선'},
      '80일선:0':{shares:1,actual:0.014,price:140}
    };
    const entry=progressQuote();entry.ma['80선']=next;
    const doc=assets(item('a','111111',plan)),prices={stocks:{'111111':entry}},before=JSON.stringify({doc,prices});
    const rows=purchaseLineRows(plan,entry,{inOrder:true});
    assert.deepEqual(rows.slice(1,3).map(({amount,...row})=>row),[
      {key:'60선:1',line:'60선',t:1,price:100,shares:5,done:true,actual:0.05,plannedShares:5,remainingShares:0,next:'80선'},
      {key:'60선:2',line:'60선',t:2,price:100,shares:4,done:false,actual:0.04,plannedShares:10,remainingShares:6,next:'80선'}
    ]);
    near(rows[1].amount,0);near(rows[2].amount,0.06);
    for(const quiet of [false,true]){
      const rules=purchaseAlertRules(doc,prices,quiet);
      assert.equal(rules[0].id,'trade:buy:a:60선:2');assert.equal(rules[0].targetPrice,100);
      assert.equal(rules.some(r=>r.id==='trade:buy:a:60선:1'),false,'완료 회차는 표시하되 알림은 만들지 않는다');
    }
    near(rows.reduce((sum,r)=>sum+(r.actual||0)+(r.done?0:r.amount),0),1);
    assert.equal(JSON.stringify({doc,prices}),before);
  }
});

const rangePlan=(start='25일선',last='25개월선')=>({lines:{names:movingLineRange(MA_LINES,start,last),startLine:start,budget:100},notify:{stages:true}});
const rangeQuote=plan=>({kind:'국내',asOf:'2026-01-02',close:50,ma:Object.fromEntries(plan.lines.names.map((name,i)=>[name,100+i*30]))});
const rangeBuys=()=>Object.fromEntries(['32선:2','25선:1','42선:0','32선:0','25선:2','25선:0','32선:1'].map(key=>[
  key,{plannedShares:10,shares:key==='42선:0'?4:10,plannedActual:0.1,actual:key==='42선:0'?0.04:0.1,price:100}
]));

test('범위 밖 시선 체결은 선별 회차 순으로 일선 앞에 오고 목표가는 맨 끝이며 계획을 바꾸지 않는다',()=>{
  for(const end of [null,1000])for(const trade of [{},{inOrder:true}]){
    const plan=rangePlan();plan.buys=rangeBuys();if(end)plan.lines.end=end;
    const entry=rangeQuote(plan),before=JSON.stringify({plan,entry,trade}),selected=purchaseLineSelection(plan,entry,trade);
    assert.deepEqual(keys(selected.rows).slice(0,10),[
      '25선:0','25선:1','25선:2','32선:0','32선:1','32선:2','42선:0','25일선:0','25일선:1','25일선:2'
    ]);
    assert.deepEqual(selected.rows.slice(0,7).map(r=>r.done),[true,true,true,true,true,true,false]);
    assert.equal(selected.rows[6].remainingShares,6);near(selected.rows[6].amount,0.06);
    assert.equal(selected.rows.at(-1).key,end?'end':'25개월선:0');
    assert.equal(JSON.stringify({plan,entry,trade}),before,'조회 전후 계획·체결·시세·옵션 JSON이 같다');
  }
});

test('범위 밖 기록은 뒤에 오는 첫 선택선 앞에 끼우고 끝선보다 뒤면 목표가 앞에 둔다',()=>{
  for(const [start,last,record,expected] of [
    ['25주선','60주선','60일선:0',['60일선:0','25주선:0']],
    ['25일선','60일선','150주선:0',['60일선:0','150주선:0','end']]
  ]){
    const plan=rangePlan(start,last);plan.lines.end=1000;plan.buys={[record]:{shares:1,actual:0.01,price:100}};
    const entry=rangeQuote(plan),before=JSON.stringify(plan),rows=purchaseLineSelection(plan,entry).rows;
    const at=keys(rows).indexOf(expected[0]);assert.deepEqual(keys(rows).slice(at,at+expected.length),expected);
    assert.equal(rows.at(-1).key,'end');assert.equal(JSON.stringify(plan),before);
  }
});

test('같은 위치의 범위 밖 기록은 별칭을 해석해 시·일·주·월 → 기간 → 회차로 정렬한다',()=>{
  const plan=rangePlan('25주선','60주선');plan.lines.end=1000;
  plan.buys=Object.fromEntries(['32달선:0','40주선:1','80일선:0','25월선:0','32분봉:0','60일선:2','25시선:1','40주선:0','25시선:0','60일선:0']
    .map(key=>[key,{shares:1,actual:0.01,price:100}]));
  const before=JSON.stringify(plan),rows=purchaseLineSelection(plan,rangeQuote(plan)).rows;
  assert.deepEqual(keys(rows),[
    '25시선:0','25시선:1','32분봉:0','60일선:0','60일선:2','80일선:0',
    '25주선:0','25주선:1','25주선:2','32주선:0','32주선:1','32주선:2',
    '40주선:0','40주선:1','42주선:0','42주선:1','42주선:2','60주선:0','25월선:0','32달선:0','end'
  ]);
  assert.equal(JSON.stringify(plan),before,'정렬을 위해 별칭 키나 기록 필드를 고치지 않는다');
});

test('선택 범위 안의 기록·미체결은 names 순서와 회차 순서를 그대로 유지한다',()=>{
  const plan={lines:{names:['60일선','25일선','25주선'],budget:100,end:1000},buys:{
    '25일선:1':{shares:1,actual:0.01,price:100},'60일선:2':{plannedShares:10,shares:4,plannedActual:0.1,actual:0.04,price:100}
  }};
  const before=JSON.stringify(plan),rows=purchaseLineSelection(plan,rangeQuote(plan)).rows;
  assert.deepEqual(keys(rows),['60일선:0','60일선:1','60일선:2','25일선:0','25일선:1','25일선:2','25주선:0','end']);
  assert.equal(JSON.stringify(plan),before);
});

test('범위 밖 부분 체결이 알림 체인의 첫 규칙이고 다음 미완료 회차만 그 id를 선행으로 받는다',()=>{
  const plan=rangePlan();plan.lines.end=1000;plan.buys=rangeBuys();
  const doc=assets(item('a','111111',plan)),prices={stocks:{'111111':rangeQuote(plan)}},before=JSON.stringify({doc,prices});
  const baseline=JSON.parse(JSON.stringify(doc));delete baseline.allocation.groups[0].items[0].buyPlan.buys['42선:0'];
  for(const quiet of [false,true]){
    const rules=purchaseAlertRules(doc,prices,quiet),original=purchaseAlertRules(baseline,prices,quiet);
    assert.equal(rules[0].id,'trade:buy:a:42선:0');assert.equal(Object.hasOwn(rules[0],'after'),false);
    assert.deepEqual(rules[1],{...original[0],after:rules[0].id});
    assert.deepEqual(rules.slice(2),original.slice(1),'나머지 규칙의 순서·id·revision·after는 같다');
  }
  assert.equal(JSON.stringify({doc,prices}),before,'알림 계산도 계획·체결에 새 필드를 만들지 않는다');
});

test('화면 순서 판정은 첫 미도달 뒤의 도달만 빼고 현재가가 없으면 입력 목록을 유지한다',()=>{
  const rows=[12000,13000,10000,14000,9000].map((price,i)=>({key:String(i),price})),before=JSON.stringify(rows);
  assert.deepEqual(purchaseInOrderSelection(rows,12500),{rows:[rows[0],rows[1],rows[3]],skipped:[rows[2],rows[4]]});
  for(const current of [null,undefined,0])assert.deepEqual(purchaseInOrderSelection(rows,current),{rows,skipped:[]});
  assert.equal(JSON.stringify(rows),before);
});

test('화면·알림 모두 순서 밖 장기선을 빼고 남은 회차에 예산 전액을 다시 나눈다',()=>{
  const plan=screenPlan(),entry=screenQuote(),doc=assets(item('a','111111',plan)),prices={stocks:{'111111':entry}},trade={inOrder:true};
  const before=JSON.stringify({plan,entry,trade}),normal=purchaseLineRows(plan,entry),rules=purchaseAlertRules(doc,prices);
  const selected=purchaseLineSelection(plan,entry,trade);
  assert.deepEqual(keys(selected.skipped),['60개월선:0']);
  assert.deepEqual(keys(selected.rows),keys(normal).filter(key=>key!=='60개월선:0'));
  assert.deepEqual(purchaseLineRows(plan,entry,trade),selected.rows,'기존 진입점의 반환값은 배열');
  assert.ok(selected.rows.every(r=>r.amount>normal.find(n=>n.key===r.key).amount));
  near(selected.rows.reduce((sum,r)=>sum+r.amount,0),plan.lines.budget);
  assert.deepEqual(purchaseLineSelection(plan,entry),{rows:normal,skipped:[]});
  assert.deepEqual(purchaseLineRows(plan,entry,{inOrder:1}),normal,'정확히 true일 때만 제외한다');
  assert.deepEqual(rules.map(r=>r.id),selected.rows.map(r=>`trade:buy:a:${r.key}`));
  assert.equal(JSON.stringify({plan,entry,trade}),before,'읽기·계산 중 저장 필드를 만들지 않는다');
});

test('현재가가 장기선 아래로 내려오거나 앞 회차를 모두 넘으면 저장 없이 다시 편입한다',()=>{
  const plan=screenPlan(),before=JSON.stringify(plan);
  for(const [close,reached] of [[9500,false],[13500,true],[10000,true]]){
    const entry=screenQuote(close),selected=purchaseLineSelection(plan,entry,{inOrder:true});
    if(close===10000){assert.deepEqual(keys(selected.skipped),['60개월선:0'],'선과 같은 가격도 도달이므로 순서 밖이면 제외');continue;}
    const long=selected.rows.find(r=>r.key==='60개월선:0');
    assert.deepEqual(selected.skipped,[]);assert.ok(long,'장기선 회차를 다시 넣는다');
    const rules=purchaseAlertRules(assets(item('a','111111',plan)),{stocks:{'111111':entry}},true);
    assert.deepEqual(rules.map(r=>r.id),selected.rows.map(r=>`trade:buy:a:${r.key}`),'다시 편입한 회차도 화면과 같은 알림 대상');
    assert.equal(close>=long.price,reached);near(selected.rows.reduce((sum,r)=>sum+r.amount,0),100);
  }
  assert.deepEqual(keys(purchaseLineSelection(plan,screenQuote(),{inOrder:true}).skipped),['60개월선:0']);
  assert.equal(JSON.stringify(plan),before);
});

test('완료·부분 체결은 지난 회차로 보고 잔량 예산을 보존하며 남은 앞 회차까지 체결하면 장기선 도달을 넣는다',()=>{
  const plan=screenPlan(),entry=screenQuote();
  plan.buys={'25일선:0':{plannedShares:10,shares:4,plannedActual:12,actual:4.8,price:12000}};
  let before=JSON.stringify({plan,entry}),selected=purchaseLineSelection(plan,entry,{inOrder:true});
  assert.deepEqual(keys(selected.skipped),['60개월선:0']);
  assert.equal(selected.rows[0].remainingShares,6);near(selected.rows[0].amount,7.2);
  near(selected.rows.filter(r=>!r.done).reduce((sum,r)=>sum+r.amount,0),100-4.8);
  assert.equal(JSON.stringify({plan,entry}),before);
  for(const r of selected.rows.slice(1))plan.buys[r.key]={price:r.price,actual:1};
  before=JSON.stringify({plan,entry});selected=purchaseLineSelection(plan,entry,{inOrder:true});
  const long=selected.rows.find(r=>r.key==='60개월선:0');
  assert.deepEqual(selected.skipped,[]);assert.ok(long&&!long.done);assert.ok(entry.close>=long.price);
  near(selected.rows.filter(r=>!r.done).reduce((sum,r)=>sum+r.amount,0),100-selected.rows.reduce((sum,r)=>sum+(r.actual||0),0));
  assert.equal(JSON.stringify({plan,entry}),before,'부분 체결이 남아도 새 기록 없이 재편입한다');
});

test('현재가·올바른 기준일이 없거나 시세 통화가 계획 통화와 다르면 화면도 회차를 빼지 않는다',()=>{
  for(const entry of [screenQuote(null),screenQuote(0),{...screenQuote(),asOf:undefined},{...screenQuote(),asOf:'2026/01/02'}]){
    const plan=screenPlan(),before=JSON.stringify({plan,entry}),selected=purchaseLineSelection(plan,entry,{inOrder:true});
    assert.deepEqual(selected,{rows:purchaseLineRows(plan,entry),skipped:[]});assert.equal(JSON.stringify({plan,entry}),before);
  }
  const plan={...screenPlan(),currency:'USD'},entry=screenQuote(),trade={inOrder:true,fx:1000};
  const before=JSON.stringify({plan,entry,trade});
  assert.deepEqual(purchaseLineSelection(plan,entry,trade),{rows:purchaseLineRows(plan,entry,{fx:1000}),skipped:[]});
  assert.deepEqual(purchaseLineSelection(screenPlan(),{...entry,kind:'해외'},{inOrder:true,currency:'KRW'}).skipped,[]);
  assert.equal(JSON.stringify({plan,entry,trade}),before);
});

test('간격을 고른 뒤에만 제외해 화면 회차는 서버 집합의 부분집합이고 비용 미상 경로도 예산을 다시 나눈다',()=>{
  for(const budget of [0.5,3,5,8,100])for(const trade of [{},{currency:'USD'}, {currency:'USD',fx:1000}]){
    const plan=screenPlan();plan.lines.budget=budget;
    const entry=screenQuote(),normal=purchaseLineRows(plan,entry,trade),selected=purchaseLineSelection(plan,entry,{...trade,inOrder:true});
    assert.deepEqual(keys(selected.rows),keys(normal).filter(key=>!keys(selected.skipped).includes(key)));
    near(selected.rows.reduce((sum,r)=>sum+r.amount,0),budget);
  }
  const plan=screenPlan(),entry={...screenQuote(),kind:'해외'},trade={inOrder:true,currency:'USD'};
  const selected=purchaseLineSelection(plan,entry,trade);
  assert.deepEqual(keys(selected.skipped),['60개월선:0'],'환율을 몰라 비용을 계산할 수 없어도 제외한다');
  near(selected.rows.reduce((sum,r)=>sum+r.amount,0),100);
});

test('남은 회차는 현재가 누락·이평선 이동에도 같은 선행 관계와 이력을 서버에 전달한다',()=>{
  const doc=assets(item()),prices=quotes(9000),before=JSON.stringify({doc,prices});
  const rules=purchaseAlertRules(doc,prices);
  assert.deepEqual(rules.map(r=>[r.id,r.targetPrice,r.revision]),[
    ['trade:buy:a:42선:0',12000,'["42선",0,null]'],
    ['trade:buy:a:150주선:0',10000,'["150주선",0,null]'],
    ['trade:buy:a:end',13000,'["end",13000]']
  ]);
  assert.deepEqual(chain(rules),[['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0'],['trade:buy:a:end','trade:buy:a:150주선:0']]);
  assert.equal(JSON.stringify({doc,prices}),before,'순서 계산은 입력에 도달 기록이나 새 필드를 만들지 않는다');
  for(const close of [13000,9000,null]){
    const next=quotes(close);
    if(close===null)delete next.stocks['111111'].close;
    assert.deepEqual(purchaseAlertRules(doc,next),rules,'순서 밖 도달이 아니면 같은 회차·선행 관계를 유지한다');
  }
  assert.deepEqual(chain(purchaseAlertRules(doc,quotes())),[['trade:buy:a:42선:0',null],['trade:buy:a:end','trade:buy:a:42선:0']],'순서 밖 도달은 빼고 목표가를 앞 회차에 잇는다');
  prices.stocks['111111'].ma={'42선':12500,'150주선':10500};
  const moved=purchaseAlertRules(doc,prices);
  assert.deepEqual(chain(moved),chain(rules));
  assert.deepEqual(moved.map(r=>r.revision),rules.map(r=>r.revision),'이동평균 가격 변경에도 기존 단계 이력을 잇는다');
});

test('부분 체결 회차는 선행 관계에 남고 전량 완료하면 다음 회차의 선행 제한을 푼다',()=>{
  const plan=linePlan(),doc=assets(item('a','111111',plan)),prices=quotes();
  plan.buys={'42선:0':{plannedShares:10,shares:4,plannedActual:12,actual:4.8,price:12000}};
  const before=JSON.stringify(doc),partial=purchaseAlertRules(doc,prices,true);
  assert.deepEqual(chain(partial),[['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0'],['trade:buy:a:end','trade:buy:a:150주선:0']]);
  assert.equal(partial[0].targetPrice,12000);
  assert.equal(JSON.stringify(doc),before,'부분 체결 수량과 잔량 예산을 그대로 둔다');
  Object.assign(plan.buys['42선:0'],{shares:10,actual:12});
  assert.deepEqual(chain(purchaseAlertRules(doc,prices,true)),[['trade:buy:a:150주선:0',null],['trade:buy:a:end','trade:buy:a:150주선:0']]);
  Object.assign(plan.buys['42선:0'],{shares:4,actual:4.8});
  assert.deepEqual(chain(purchaseAlertRules(doc,prices,true)),chain(partial),'완료를 되돌리면 선행 관계도 다시 생긴다');
});

test('앞 회차 알림 OFF도 순서에서 건너뛰지 않고 quiet 규칙으로 도달을 추적한다',()=>{
  const plan=linePlan();plan.notify={keys:{'150주선:0':true}};
  const doc=assets(item('a','111111',plan)),prices=quotes(9000),before=JSON.stringify(doc);
  const normal=purchaseAlertRules(doc,prices),quiet=purchaseAlertRules(doc,prices,true);
  assert.deepEqual(chain(normal),[['trade:buy:a:150주선:0','trade:buy:a:42선:0']]);
  assert.deepEqual(chain(quiet),[['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0'],['trade:buy:a:end','trade:buy:a:150주선:0']]);
  assert.equal(quiet[0].notify,false);
  assert.deepEqual(quiet.filter(r=>r.notify!==false),normal);
  assert.equal(JSON.stringify(doc),before);
  plan.notify={stages:true};
  assert.deepEqual(quiet.map(({notify,...rule})=>rule),purchaseAlertRules(doc,prices),'알림을 켜도 id·revision·선행 관계는 같다');
});

test('직접 입력 상승·하락 계획도 완료 회차를 건너뛰고 OFF·부분 체결 회차를 같은 순서로 잇는다',()=>{
  for(const [prices,condition] of [[[10000,11000,12000,13000],'up'],[[13000,12000,11000,10000],'down']]){
    const plan={notify:{stages:true},stages:[
      {id:'done',price:prices[0],amount:10,done:true},
      {id:'partial',price:prices[1],amount:10,plannedShares:8,shares:3,actual:3,partial:true,notify:false},
      {id:'next',price:prices[2],amount:10},
      {id:'last',price:prices[3],amount:10}
    ]};
    const doc=assets(item('a','111111',plan)),before=JSON.stringify(doc),rules=purchaseAlertRules(doc,null,true);
    assert.deepEqual(chain(rules),[['trade:buy:a:partial',null],['trade:buy:a:next','trade:buy:a:partial'],['trade:buy:a:last','trade:buy:a:next']]);
    assert.ok(rules.every(r=>r.condition===condition));
    assert.deepEqual(rules.map(r=>r.revision),prices.slice(1).map(price=>JSON.stringify([price,condition])));
    assert.equal(rules[0].notify,false);
    assert.deepEqual(purchaseAlertRules(doc,null),rules.slice(1),'일반 알림 목록에서도 OFF 선행을 건너뛰지 않는다');
    assert.equal(JSON.stringify(doc),before);
  }
});

test('가격 없는 미완료 직접 입력 회차 뒤는 없는 선행 규칙을 참조하여 조기 도달을 막는다',()=>{
  const plan={notify:{stages:true},stages:[{id:'missing',amount:10},{id:'next',price:10000,amount:10}]};
  const doc=assets(item('a','111111',plan)),before=JSON.stringify(doc);
  assert.deepEqual(chain(purchaseAlertRules(doc,null,true)),[['trade:buy:a:next','trade:buy:a:missing']]);
  assert.equal(JSON.stringify(doc),before);
  plan.stages[0].done=true;
  assert.deepEqual(chain(purchaseAlertRules(doc,null,true)),[['trade:buy:a:next',null]],'완료한 회차는 가격을 기다리지 않는다');
});

test('1주를 살 수 없는 이동평균 회차는 선행·알림에서 제외하되 이미 체결한 회차 잔량은 보존한다',()=>{
  const plan=linePlan();plan.lines.budget=0.5;
  const doc=assets(item('a','111111',plan)),prices=quotes();
  assert.deepEqual(purchaseAlertRules(doc,prices,true),[],'1주 최소 매수액보다 예산이 작으면 0주 알림을 만들지 않는다');
  plan.buys={'42선:0':{plannedShares:10,shares:4,plannedActual:12,actual:4.8,price:12000}};
  assert.deepEqual(chain(purchaseAlertRules(doc,prices,true)),[['trade:buy:a:42선:0',null]],'예산을 낮춰도 고정된 부분 체결 잔량은 알림에 남는다');
});

test('계획마다 선행 관계를 새로 시작하고 체결 없는 매수대기에는 after를 붙이지 않는다',()=>{
  const doc=assets(
    item('a','111111'),
    item('b','222222',{notify:{stages:true},stages:[{id:'first',price:12000,amount:10},{id:'last',price:10000,amount:10}]}),
    item('wait','111111',{wait:{line:'150주선'},notify:{stages:true}})
  );
  const prices=quotes(9000),before=JSON.stringify({doc,prices}),rules=purchaseAlertRules(doc,prices,true);
  assert.deepEqual(chain(rules),[
    ['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0'],['trade:buy:a:end','trade:buy:a:150주선:0'],
    ['trade:buy:b:first',null],['trade:buy:b:last','trade:buy:b:first'],['trade:buy:wait:wait',null]
  ]);
  const wait=rules.at(-1);
  assert.equal(wait.condition,'down');assert.equal(wait.revision,'["wait","150주선","down"]');
  assert.equal(JSON.stringify({doc,prices}),before);
});

test('목표가 없이 마지막 선까지 사면 마지막 선 가격 이상인 앞 선(시작선 포함)은 회차·⅓·⅔ 연결·알림에서 빼고 남은 선끼리 잇는다',()=>{
  const plan=()=>({lines:{names:['25일선','32일선','42일선','60주선','60개월선'],startLine:'25일선',budget:100},notify:{stages:true}});
  const quote=(ma={})=>({kind:'국내',asOf:'2026-01-02',close:98,ma:{'25일선':106,'32일선':99,'42일선':112,'60주선':96,'60개월선':100,...ma}});
  const p=plan(),entry=quote(),doc=assets(item('a','111111',p)),prices={stocks:{'111111':entry}},before=JSON.stringify({doc,prices});
  const rows=purchaseLineRows(p,entry);
  assert.deepEqual(rows.map(r=>[r.key,Number(r.price.toFixed(4))]),[['32일선:0',99],['60주선:0',96],['60주선:1',97.3333],['60주선:2',98.6667],['60개월선:0',100]]);
  assert.ok(rows.every(r=>r.price<=100),'마지막 선 가격보다 비싼 회차가 없다');
  near(rows.reduce((sum,r)=>sum+r.amount,0),100);
  const rules=purchaseAlertRules(doc,prices);
  assert.deepEqual(rules.map(r=>r.id),purchaseLineRows(p,entry,{inOrder:true}).map(r=>`trade:buy:a:${r.key}`));
  assert.equal(rules.some(r=>/25일선|42일선/.test(r.id)),false);
  assert.equal(JSON.stringify({doc,prices}),before,'계획·시세에 필드를 만들지 않는다');
  assert.deepEqual(keys(purchaseLineRows(p,quote({'42일선':100}))),keys(rows),'마지막 선과 같은 가격도 뺀다');
  assert.ok(keys(purchaseLineRows(p,quote({'42일선':97}))).includes('42일선:0'),'이동평균이 마지막 선 아래로 내려오면 다시 넣는다');
  assert.deepEqual(keys(purchaseLineRows(p,quote({'25일선':120,'32일선':101,'60주선':130}))),['60개월선:0'],'모두 위면 마지막 선 1차만');
  p.buys={'42일선:0':{shares:1,actual:1.12,price:112}};
  const recorded=purchaseLineRows(p,entry);
  assert.deepEqual(keys(recorded),['32일선:0','42일선:0',...keys(rows).slice(1)],'이미 체결한 회차 기록은 names 순서 자리에 유지한다');
  near(recorded.filter(r=>!r.done).reduce((sum,r)=>sum+r.amount,0),100-1.12);
  const target=plan();target.lines.end=150;
  assert.ok(['25일선:0','42일선:0'].every(key=>keys(purchaseLineRows(target,entry)).includes(key)),'목표 가격 계획은 그 가격 아래 회차를 그대로 쓴다');
});
