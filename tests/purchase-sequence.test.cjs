const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 공개 계산을 DOM 없이 실행한다. 도달 이력은 서버가 관리하므로 여기서는
// 현재 시세에 관계없이 회차와 선행 관계가 유지되는지를 검증한다.
const {purchaseAlertRules,purchaseLineRows,purchaseLineSelection,purchaseInOrderSelection}=vm.runInThisContext(`(function(){${['ma-ladder.js','assets-calc.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n')}
return {purchaseAlertRules,purchaseLineRows,purchaseLineSelection,purchaseInOrderSelection};})()`);
const item=(id='a',ticker='111111',buyPlan=linePlan())=>({id,ticker,buyPlan});
const assets=(...items)=>({version:1,allocation:{groups:[{id:'test-group',items}]}});
const linePlan=()=>({lines:{names:['42선','150주선'],startLine:'42선',budget:100},notify:{stages:true}});
const quotes=(close=11000)=>({stocks:{'111111':{kind:'국내',asOf:'2026-01-02',close,ma:{'42선':12000,'150주선':10000}}}});
const chain=rules=>rules.map(r=>[r.id,r.after??null]);

const screenPlan=()=>({lines:{names:['25일선','32일선','60개월선'],budget:100},notify:{stages:true}});
const screenQuote=(close=11000)=>({kind:'국내',asOf:'2026-01-02',close,ma:{'25일선':12000,'32일선':13000,'60개월선':10000}});
const keys=rows=>rows.map(r=>r.key);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);

test('화면 순서 판정은 첫 미도달 뒤의 도달만 빼고 현재가가 없으면 입력 목록을 유지한다',()=>{
  const rows=[12000,13000,10000,14000,9000].map((price,i)=>({key:String(i),price})),before=JSON.stringify(rows);
  assert.deepEqual(purchaseInOrderSelection(rows,12500),{rows:[rows[0],rows[1],rows[3]],skipped:[rows[2],rows[4]]});
  for(const current of [null,undefined,0])assert.deepEqual(purchaseInOrderSelection(rows,current),{rows,skipped:[]});
  assert.equal(JSON.stringify(rows),before);
});

test('화면만 순서 밖 장기선을 빼고 남은 회차에 예산 전액을 다시 나누며 알림 출력은 유지한다',()=>{
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
  assert.deepEqual(purchaseAlertRules(doc,prices),rules);
  assert.equal(JSON.stringify({plan,entry,trade}),before,'읽기·계산 중 저장 필드를 만들지 않는다');
});

test('현재가가 장기선 아래로 내려오거나 앞 회차를 모두 넘으면 저장 없이 다시 편입한다',()=>{
  const plan=screenPlan(),before=JSON.stringify(plan);
  for(const [close,reached] of [[9500,false],[13500,true],[10000,true]]){
    const entry=screenQuote(close),selected=purchaseLineSelection(plan,entry,{inOrder:true});
    if(close===10000){assert.deepEqual(keys(selected.skipped),['60개월선:0'],'선과 같은 가격도 도달이므로 순서 밖이면 제외');continue;}
    assert.deepEqual(selected.skipped,[]);assert.equal(selected.rows.at(-1).key,'60개월선:0');
    assert.equal(close>=selected.rows.at(-1).price,reached);near(selected.rows.reduce((sum,r)=>sum+r.amount,0),100);
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
  assert.deepEqual(selected.skipped,[]);assert.equal(selected.rows.at(-1).key,'60개월선:0');assert.ok(entry.close>=selected.rows.at(-1).price);
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

test('앞선 42선 미도달·뒤 150주선 도달: 시세와 무관하게 선행 도달 관계를 서버에 전달한다',()=>{
  const doc=assets(item()),prices=quotes(),before=JSON.stringify({doc,prices});
  const rules=purchaseAlertRules(doc,prices);
  assert.deepEqual(rules.map(r=>[r.id,r.targetPrice,r.revision]),[
    ['trade:buy:a:42선:0',12000,'["42선",0,null]'],
    ['trade:buy:a:150주선:0',10000,'["150주선",0,null]']
  ]);
  assert.deepEqual(chain(rules),[['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0']]);
  assert.equal(JSON.stringify({doc,prices}),before,'순서 계산은 입력에 도달 기록이나 새 필드를 만들지 않는다');
  for(const close of [13000,9000,null]){
    const next=quotes(close);
    if(close===null)delete next.stocks['111111'].close;
    assert.deepEqual(purchaseAlertRules(doc,next),rules,'앞선 도달 후 가격 되돌림·현재가 누락으로 회차를 지우지 않는다');
  }
  prices.stocks['111111'].ma={'42선':12500,'150주선':10500};
  const moved=purchaseAlertRules(doc,prices);
  assert.deepEqual(chain(moved),chain(rules));
  assert.deepEqual(moved.map(r=>r.revision),rules.map(r=>r.revision),'이동평균 가격 변경에도 기존 단계 이력을 잇는다');
});

test('부분 체결 회차는 선행 관계에 남고 전량 완료하면 다음 회차의 선행 제한을 푼다',()=>{
  const plan=linePlan(),doc=assets(item('a','111111',plan)),prices=quotes();
  plan.buys={'42선:0':{plannedShares:10,shares:4,plannedActual:12,actual:4.8,price:12000}};
  const before=JSON.stringify(doc),partial=purchaseAlertRules(doc,prices,true);
  assert.deepEqual(chain(partial),[['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0']]);
  assert.equal(partial[0].targetPrice,12000);
  assert.equal(JSON.stringify(doc),before,'부분 체결 수량과 잔량 예산을 그대로 둔다');
  Object.assign(plan.buys['42선:0'],{shares:10,actual:12});
  assert.deepEqual(chain(purchaseAlertRules(doc,prices,true)),[['trade:buy:a:150주선:0',null]]);
  Object.assign(plan.buys['42선:0'],{shares:4,actual:4.8});
  assert.deepEqual(chain(purchaseAlertRules(doc,prices,true)),chain(partial),'완료를 되돌리면 선행 관계도 다시 생긴다');
});

test('앞 회차 알림 OFF도 순서에서 건너뛰지 않고 quiet 규칙으로 도달을 추적한다',()=>{
  const plan=linePlan();plan.notify={keys:{'150주선:0':true}};
  const doc=assets(item('a','111111',plan)),prices=quotes(),before=JSON.stringify(doc);
  const normal=purchaseAlertRules(doc,prices),quiet=purchaseAlertRules(doc,prices,true);
  assert.deepEqual(chain(normal),[['trade:buy:a:150주선:0','trade:buy:a:42선:0']]);
  assert.deepEqual(chain(quiet),[['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0']]);
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
  const prices=quotes(),before=JSON.stringify({doc,prices}),rules=purchaseAlertRules(doc,prices,true);
  assert.deepEqual(chain(rules),[
    ['trade:buy:a:42선:0',null],['trade:buy:a:150주선:0','trade:buy:a:42선:0'],
    ['trade:buy:b:first',null],['trade:buy:b:last','trade:buy:b:first'],['trade:buy:wait:wait',null]
  ]);
  const wait=rules.at(-1);
  assert.equal(wait.condition,'down');assert.equal(wait.revision,'["wait","150주선","down"]');
  assert.equal(JSON.stringify({doc,prices}),before);
});
