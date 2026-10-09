// 실제 보유·사용자 예시와 관계없는 가상 가격·계약·체결만 사용한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder.js','prices.js','assets-calc.js','rebuy.js','trade-alerts.js','futures.js'].map(file=>fs.readFileSync(path.join(__dirname,'../js',file),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({contractSize:10000});vm.runInContext(source,ctx);return ctx;};
const plain=value=>JSON.parse(JSON.stringify(value));
const level=(days,unit,price)=>({days,unit,price,contracts:0,tranches:[]});
const futures=()=>({targetPrice:1500,baselinePnl:0,positions:[{month:'202612',contracts:5,settlementPrice:1300}],notify:{levels:true},levels:[level(32,'일선',1320),level(42,'일선',1380)]});
const config=extra=>({startLine:'32일선',endPrice:1380,contracts:7,units:['일선'],...extra});
const pending=f=>f.levels.flatMap((l,li)=>l.tranches.map((t,ti)=>({l,li,t,ti}))).filter(x=>!x.t.completed);

test('자동 배분은 시작선·종료가를 포함하고 정수 계약 합계를 보유 월물과 따로 맞춘다',()=>{
  const ctx=load();
  for(let contracts=1;contracts<=40;contracts++){
    const f=futures(),before=JSON.stringify(f),plan=ctx.futureAutoBuyPlan(f,config({contracts}));
    assert.equal(JSON.stringify(f),before,'미리보기는 기록을 바꾸지 않는다');
    assert.equal(plan.rows.reduce((n,r)=>n+r.contracts,0),contracts);
    assert.equal(plan.rows.length,Math.min(contracts,4));
    assert.equal(plan.rows.at(-1).price,1380);
    if(contracts>1)assert.equal(plan.rows[0].price,1320);
    assert.ok(plan.rows.every(r=>Number.isInteger(r.contracts)&&r.contracts>0));
    assert.equal(ctx.applyFutureAutoBuyPlan(f,config({contracts})),true);
    assert.equal(f.levels.reduce((n,l)=>n+l.tranches.length,0),contracts);
    assert.deepEqual(f.positions,[{month:'202612',contracts:5,settlementPrice:1300}]);
    const saved=JSON.stringify(f);assert.equal(ctx.applyFutureAutoBuyPlan(f),false);assert.equal(JSON.stringify(f),saved,'같은 입력의 재계산은 멱등이다');
  }
  assert.deepEqual(plain(ctx.futureAutoBuyPlan(futures(),config()).rows).map(r=>[r.price,r.contracts]),[[1320,2],[1340,2],[1360,2],[1380,1]]);
});

test('시·일·주·월선에서 구간 밖 가격과 겹치는 가격을 빼고 적은 계약은 회차를 줄인다',()=>{
  const ctx=load(),f=futures();
  f.levels.push(level(32,'선',1310),level(42,'선',1345),level(60,'선',1370),level(32,'개월선',1350),level(42,'개월선',1380),level(32,'주선',1372));
  const input=config({units:['선','일선','주선','개월선'],contracts:30}),plan=ctx.futureAutoBuyPlan(f,input);
  assert.equal(new Set(plan.rows.map(r=>r.price)).size,plan.rows.length,'같은 가격에 다른 시간축의 주문을 중복하지 않는다');
  assert.ok(plan.rows.every(r=>r.price>=1320&&r.price<=1380));
  for(const unit of ['선','일선','주선','개월선'])assert.ok(plan.rows.some(r=>r.line.replace(/^\d+/,'')===unit));
  assert.ok(!plan.rows.some(r=>r.line==='32선'),'시작 기준가보다 낮은 선은 사용하지 않는다');
  assert.equal(plan.rows.filter(r=>r.price===1380).length,1,'끝선과 종료가가 같아도 한 번만 매수한다');
  const small=ctx.futureAutoBuyPlan(f,{...input,contracts:3});
  assert.equal(small.rows.length,3);assert.equal(small.rows[0].line,'32일선');assert.equal(small.rows.at(-1).key,'end');
});

test('자동 배분은 현재가가 아닌 시작선 가격을 사용하고 없는 다음 선을 추정하지 않는다',()=>{
  const ctx=load(),f=futures();f.currentPrice=1379;f.levels.splice(1,0,level(35,'일선',0));
  const rows=plain(ctx.futureAutoBuyPlan(f,config()).rows);
  assert.deepEqual(rows.map(r=>[r.price,r.contracts]),[[1320,4],[1380,3]]);
  assert.equal(ctx.futureAutoBuyPlan(f,config({startLine:'32시선',units:['선']})).waiting,'시작 기준선의 시세를 기다립니다.');
});

test('이미 매수한 계약을 포함해 남은 수량만 배분하고 체결가·월물·알림을 보존한다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config());
  const record=f.levels[0].tranches[2];Object.assign(record,{completed:true,executionPrice:1339.8,mergedMonth:'202612',month:'202612',notify:false});
  const saved=plain(record),other=f.levels[0].tranches[3];other.notify=true;other.month='202701';
  const positions=JSON.stringify(f.positions);
  ctx.applyFutureAutoBuyPlan(f,config({contracts:8}));
  assert.equal(pending(f).length,7);assert.equal(f.levels.reduce((n,l)=>n+l.contracts,0),8);
  assert.deepEqual(plain(f.levels[0].tranches.find(t=>t.completed)),saved);
  assert.ok(f.levels[0].tranches.some(t=>!t.completed&&t.slot===1&&t.notify===true&&t.month==='202701'));
  assert.equal(JSON.stringify(f.positions),positions);
  const before=JSON.stringify(f);
  assert.equal(ctx.applyFutureAutoBuyPlan(f,config({contracts:0})),false);assert.equal(JSON.stringify(f),before);
  const done=pending(f).slice(0,2);done.forEach(x=>x.t.completed=true);
  const after=JSON.stringify(f);assert.equal(ctx.applyFutureAutoBuyPlan(f,config({contracts:2})),false);assert.equal(JSON.stringify(f),after);
});

test('새 시세는 미매수 수량·범위만 다시 배분하며 완료 기록과 종료가격을 고정한다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config());
  const record=f.levels[0].tranches[0];Object.assign(record,{completed:true,executionPrice:1319.9,mergedMonth:'202612'});const bought=plain(record);
  const prices=(at,start,next)=>({updatedAt:at,stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-08',close:1390,ma:{'32일선':start,'42일선':next}}}});
  assert.equal(ctx.fillPrices({futures:f},prices('2026-10-08T01:00:00Z',1350,1410)),true);
  assert.equal(pending(f).length,6);assert.ok(pending(f).every(x=>x.t.price>=1350&&x.t.price<=1380));
  assert.deepEqual(plain(f.levels[0].tranches.find(t=>t.completed)),bought);assert.equal(f.buyPlan.endPrice,1380);
  const saved=JSON.stringify(f);assert.equal(ctx.fillPrices({futures:f},prices('2026-10-08T01:00:00Z',1350,1410)),false);assert.equal(JSON.stringify(f),saved);
  assert.equal(ctx.fillPrices({futures:f},prices('2026-10-08T02:00:00Z',1390,1410)),true);
  assert.equal(pending(f).length,0,'시작가가 종료가를 넘으면 추가 매수를 멈춘다');assert.ok(ctx.futureAutoBuyPlan(f).waiting);
  assert.deepEqual(plain(f.levels[0].tranches[0]),bought);
  assert.equal(ctx.fillPrices({futures:f},prices('2026-10-08T03:00:00Z',1330,1390)),true);
  assert.equal(pending(f).length,6);assert.equal(f.levels.reduce((n,l)=>n+l.contracts,0),7);
});

test('자동 알림은 배분한 회차만 가격 상승으로 판단하고 종료가에도 기존 라벨을 사용한다',()=>{
  const ctx=load(),f=futures();f.levels.push(level(32,'선',1340));ctx.applyFutureAutoBuyPlan(f,config());
  const before=JSON.stringify(f),rules=plain(ctx.buildTradeAlertRules({futures:f},null));
  assert.deepEqual(rules.map(r=>r.targetPrice),[1320,1340,1360,1380]);
  assert.ok(rules.every(r=>r.condition==='up'));assert.equal(rules.at(-1).label,'달러선물 추가 4');
  assert.equal(JSON.stringify(f),before);
  f.levels.find(l=>l.planEnd).tranches.forEach(t=>t.completed=true);
  assert.ok(!ctx.buildTradeAlertRules({futures:f},null).some(r=>r.targetPrice===1380));
});

test('시작선 시세 대기 설정은 저장할 수 있고 실제 시세가 채워질 때 총 계약 수를 배분한다',()=>{
  const ctx=load(),f=futures();f.levels[0].price=0;
  assert.equal(ctx.applyFutureAutoBuyPlan(f,config()),true);assert.equal(pending(f).length,0);assert.equal(f.buyPlan.contracts,7);
  const prices={updatedAt:'2026-10-08T01:00:00Z',stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-08',close:1300,ma:{'32일선':1320,'42일선':1380}}}};
  assert.equal(ctx.fillPrices({futures:f},prices),true);assert.equal(pending(f).length,7);
  const same=ctx.futureAutoBuyPlan(f,config({endPrice:1320}));assert.equal(same.rows.length,1);assert.equal(same.rows[0].key,'end');assert.equal(same.rows[0].contracts,7);
  f.levels.forEach(l=>l.tranches.forEach(t=>t.completed=true));f.levels[0].price=0;
  assert.equal(ctx.futureAutoBuyPlan(f).waiting,undefined,'전부 매수했으면 시작선 시세가 없어도 대기 상태로 바뀌지 않는다');
});

test('표시 반올림과 관계없이 실제 미매수 가격은 종료가격을 넘지 않는다',()=>{
  const ctx=load(),f=futures();f.levels[1].price=1321;
  const input=config({endPrice:1320.33332}),plan=ctx.futureAutoBuyPlan(f,input);
  assert.deepEqual(plain(plan.rows).map(r=>r.price),[1320,1320.33332]);
  ctx.applyFutureAutoBuyPlan(f,input);ctx.refreshFutureBuyPrices(f);
  assert.ok(pending(f).every(x=>x.t.price<=input.endPrice));
});

test('잘못된 자동 설정과 자동 설정이 없는 옛 계획은 기록에 새 필드를 만들지 않는다',()=>{
  const ctx=load(),f=futures(),before=JSON.stringify(f);
  for(const input of [config({contracts:2.5}),config({contracts:101}),config({endPrice:Infinity}),config({startLine:'401일선'}),config({units:[]})]){
    assert.ok(ctx.futureAutoBuyPlan(f,input).error);assert.equal(ctx.applyFutureAutoBuyPlan(f,input),false);assert.equal(JSON.stringify(f),before);
  }
  assert.equal(ctx.applyFutureAutoBuyPlan(f),false);assert.equal(JSON.stringify(f),before);assert.ok(!Object.hasOwn(f,'buyPlan'));
  const full={...f,levels:Array.from({length:80},(_,i)=>level(i+1,'일선',1320))},saved=JSON.stringify(full);
  assert.equal(ctx.applyFutureAutoBuyPlan(full,config()),false);assert.equal(JSON.stringify(full),saved);
});
