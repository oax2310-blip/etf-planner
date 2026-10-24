// 실제 보유·사용자 예시와 관계없는 가상 가격·계약·체결만 사용한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder.js','prices.js','assets-calc.js','rebuy.js','trade-alerts.js','futures.js','futures-plan.js','futures-rebuy.js'].map(file=>fs.readFileSync(path.join(__dirname,'../js',file),'utf8')).join('\n;\n');
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


test('종료 이동평균은 네 시간축·임의 기간의 기존 시세를 사용하고 직접 입력값을 따로 보존한다',()=>{
  const ctx=load();
  const entry={asOf:'2026-10-20',ma:{'17선':1370},closes:{D:Array(19).fill(1371),W:Array(11).fill(1372),M:Array(9).fill(1373)}};
  for(const [endLine,endPrice] of [['17선',1370],['19일선',1371],['11주선',1372],['9개월선',1373]]){
    const f=futures(),before=JSON.stringify(f),input=config({endLine,manualEndPrice:1380});
    const source=ctx.futureAutoSource(f,input,entry),plan=ctx.futureAutoBuyPlan(source);
    assert.equal(JSON.stringify(f),before);assert.equal(plan.config.endLine,endLine);assert.equal(plan.config.endPrice,endPrice);
    assert.equal(plan.config.manualEndPrice,1380);assert.equal(plan.rows.at(-1).price,endPrice);
    assert.equal(ctx.applyFutureAutoBuyPlan(source),true);
    assert.equal(source.buyPlan.endLine,endLine);assert.equal(pending(source).length,7);
    assert.equal(ctx.applyFutureAutoBuyPlan(source),false,'재적용은 멱등이다');
  }
  const missing=ctx.futureAutoSource(futures(),config({endLine:'399선'}),entry);
  assert.ok(ctx.futureAutoBuyPlan(missing).error,'없는 시간봉 시세를 직접 입력 종료가로 추정하지 않는다');
  for(const endLine of ['401일선','0일선','잘못된 선'])assert.ok(ctx.futureAutoBuyPlan(futures(),config({endLine})).error);
});

test('종료선만 바뀐 시세도 미매수 계약만 배분하고 수동 가격·월물·알림·완료 내역을 유지한다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config({endLine:'19일선',manualEndPrice:1390,customSetting:'보존'}));
  const record=f.levels[0].tranches[0];Object.assign(record,{completed:true,executionPrice:1319.8,mergedMonth:'202612',month:'202612',notify:false});
  const bought=plain(record),manual=f.levels[0].tranches[1];Object.assign(manual,{price:1335,priceOverride:1335,month:'202701',notify:false});
  pending(f).forEach((x,i)=>x.t.memo=`가상 ${i}`);const fixed=plain(manual);
  const marked=pending(f).map(x=>x.t.memo).sort(),positions=JSON.stringify(f.positions);
  const quote=(hour,end)=>({updatedAt:`2026-10-20T${hour}:00:00Z`,stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-20',ma:{'19일선':end}}}});
  assert.equal(ctx.fillPrices({futures:f},quote('01',1365)),true);
  assert.equal(f.buyPlan.endPrice,1365);assert.equal(f.buyPlan.manualEndPrice,1390);assert.equal(f.buyPlan.customSetting,'보존');
  assert.equal(pending(f).length,6);assert.equal(f.levels.reduce((n,l)=>n+l.contracts,0),7);
  assert.deepEqual(plain(pending(f).find(x=>x.t.priceOverride).t),fixed);
  assert.deepEqual(pending(f).map(x=>x.t.memo).sort(),marked,'배분에서 빠진 회차의 설정도 새 회차에서 재사용한다');
  assert.deepEqual(plain(f.levels[0].tranches.find(t=>t.completed)),bought);assert.equal(JSON.stringify(f.positions),positions);
  const before=JSON.stringify(f);ctx.refreshFutureBuyPrices(f);assert.equal(JSON.stringify(f),before,'렌더링에서 자동 배분가를 다시 덮어쓰지 않는다');
  assert.equal(ctx.fillPrices({futures:f},quote('01',1365)),false);assert.equal(JSON.stringify(f),before);
  assert.equal(ctx.fillPrices({futures:f},quote('00',1390)),false);assert.equal(JSON.stringify(f),before,'오래된 시세는 되돌리지 않는다');
  assert.equal(ctx.applyFutureAutoBuyPlan(f),false);
  const rules=plain(ctx.buildTradeAlertRules({futures:f},null));
  assert.ok(rules.every(r=>pending(f).some(x=>x.t.price===r.targetPrice)));
  assert.ok(rules.every(r=>r.targetPrice<=1365));
});

test('잘못된 이동평균 종료가는 기존 배분·수동값을 보존하고 경고하며 새 매수 알림을 중지한다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config({endLine:'19일선'}));
  const levels=JSON.stringify(f.levels);
  for(const endPrice of [1320,1319,0]){
    f.buyPlan.endPrice=endPrice;const before=JSON.stringify(f);
    assert.ok(ctx.futureAutoBuyPlan(f).error);assert.equal(ctx.applyFutureAutoBuyPlan(f),false);
    ctx.refreshFutureBuyPrices(f);assert.equal(JSON.stringify(f),before);assert.equal(JSON.stringify(f.levels),levels);
    assert.equal(ctx.buildTradeAlertRules({futures:f},null).length,0);
  }
  f.buyPlan.endPrice=1380;const t=pending(f)[0].t;t.priceOverride=1400;t.price=1400;
  const before=JSON.stringify(f);assert.match(ctx.futureAutoBuyPlan(f).error,/직접 수정/);assert.equal(ctx.applyFutureAutoBuyPlan(f),false);assert.equal(JSON.stringify(f),before);
  f.buyPlan.endPrice=1410;assert.equal(ctx.applyFutureAutoBuyPlan(f),true);assert.equal(pending(f).length,7,'정상 범위로 돌아오면 총 수량을 유지해 재개한다');
});

test('이동평균 종료가 갱신 실패 후 복구해도 완료 내역·계약 합계를 유지하며 체결한 가격을 중복 추가하지 않는다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config({endLine:'19일선'}));
  f.levels[0].tranches.filter(t=>t.slot===0).forEach(t=>Object.assign(t,{completed:true,executionPrice:1321,mergedMonth:'202612'}));
  const bought=plain(f.levels[0].tranches.filter(t=>t.completed));
  const data=end=>({updatedAt:`2026-10-20T${end===1310?'01':'02'}:00:00Z`,stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-20',ma:{'19일선':end,'32일선':1320,'42일선':1395}}}});
  const before=JSON.stringify(f.levels.map(l=>l.tranches));
  ctx.fillPrices({futures:f},data(1310));assert.equal(JSON.stringify(f.levels.map(l=>l.tranches)),before);assert.ok(ctx.futureAutoBuyPlan(f).error);
  ctx.fillPrices({futures:f},data(1390));assert.equal(ctx.futureAutoBuyPlan(f).error,undefined);
  assert.deepEqual(plain(f.levels[0].tranches.filter(t=>t.completed)),bought);
  assert.equal(pending(f).length,7-bought.length);assert.ok(pending(f).every(x=>x.t.price!==1320));
  for(let total=bought.length;total<=100;total++){
    ctx.applyFutureAutoBuyPlan(f,{...f.buyPlan,contracts:total});
    assert.equal(f.levels.reduce((n,l)=>n+l.contracts,0),total);
    assert.deepEqual(plain(f.levels[0].tranches.filter(t=>t.completed)),bought);
    const snapshot=JSON.stringify(f);assert.equal(ctx.applyFutureAutoBuyPlan(f),false);assert.equal(JSON.stringify(f),snapshot);
  }
});

test('이동평균 종료 설정만 자동 시세를 충돌 비교에서 제외하고 설정 변경은 감지한다',()=>{
  const ctx=load(),a=config({endLine:'19일선'}),b={...a,endPrice:1370};
  assert.equal(ctx.futurePlanConfigKey(a),ctx.futurePlanConfigKey(b));
  assert.notEqual(ctx.futurePlanConfigKey(a),ctx.futurePlanConfigKey({...b,endLine:'20일선'}));
  assert.notEqual(ctx.futurePlanConfigKey(a),ctx.futurePlanConfigKey({...b,contracts:8}));
  assert.notEqual(ctx.futurePlanConfigKey(config()),ctx.futurePlanConfigKey(config({endPrice:1370})));
});


test('이동평균 종료 계획의 기준가 수정은 다른 수동 가격·최신 체결 기록을 지우지 않는다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config({endLine:'19일선'}));
  const t=f.levels[0].tranches[0];Object.assign(t,{price:1335,priceOverride:1335,month:'202701',notify:false});
  const base=plain(f.levels),edited=plain(base);edited[0].price=1321;
  f.levels[0].tranches[1].completed=true;f.levels[0].tranches[1].executionPrice=1320.5;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].tranches[0].priceOverride,1335);assert.equal(f.levels[0].tranches[0].notify,false);
  assert.equal(f.levels[0].tranches[1].executionPrice,1320.5);
});

test('이동평균 종료 시세만 바뀌면 같은 회차 알림 ID와 이력을 유지한다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config({endLine:'19일선'}));
  const first=plain(ctx.buildTradeAlertRules({futures:f},null));
  f.buyPlan.endPrice=1370;ctx.applyFutureAutoBuyPlan(f);
  const next=plain(ctx.buildTradeAlertRules({futures:f},null));
  assert.equal(next.length,first.length);
  assert.deepEqual(next.map(r=>[r.id,r.revision]),first.map(r=>[r.id,r.revision]));
  assert.notEqual(next.at(-1).targetPrice,first.at(-1).targetPrice);
});


test('직접 설정한 추가 매수와 가격을 비운 예외도 이동평균 종료 선택으로 초기화하지 않는다',()=>{
  const ctx=load(),f=futures(),manual={days:0,unit:'',label:'가상 추가 매수',price:1350,contracts:1,tranches:[{price:1350,completed:false,executionPrice:null,month:'202701',notify:true}]};
  f.levels.push(manual);const before=plain(manual);
  ctx.applyFutureAutoBuyPlan(f,config({endLine:'19일선'}));assert.deepEqual(plain(f.levels[2]),before);
  assert.equal(pending(f).length,7);
  const t=pending(f).find(x=>x.li===0).t;t.price=0;t.priceOverride=0;
  const snapshot=JSON.stringify(f);assert.match(ctx.futureAutoBuyPlan(f).error,/직접 수정/);assert.equal(ctx.applyFutureAutoBuyPlan(f),false);assert.equal(JSON.stringify(f),snapshot);
});

test('계획 창의 오래된 로컬 시세는 최신 저장 종료가를 되돌리지 않는다',()=>{
  const ctx=load(),f=futures();f.buyPlan=config({endLine:'19일선',endPrice:1370});f.auto={at:'2026-10-20T02:00:00Z'};
  const source=ctx.futureAutoSource(f,f.buyPlan,{asOf:'2026-10-20',ma:{'19일선':1380}},'2026-10-20T01:00:00Z');
  assert.equal(source.buyPlan.endPrice,1370);
  const changed=ctx.futureAutoSource(f,{...f.buyPlan,endLine:'20일선'},{asOf:'2026-10-20',ma:{'20일선':1380}},'2026-10-20T01:00:00Z');
  assert.ok(ctx.futureAutoBuyPlan(changed).error);
});

test('회차를 체결해도 시세가 같으면 남은 회차의 가격·계약 수는 처음 계획 그대로다',()=>{
  const ctx=load(),open=f=>{const m=new Map();for(const x of pending(f))m.set(x.t.price,(m.get(x.t.price)||0)+1);return [...m].sort((a,b)=>a[0]-b[0]);};
  // 계약이 회차보다 적으면 첫·끝 포함 고르게: 1,320·1,360·1,380. 1,320을 사도 다음 목표가 1,340으로 당겨지지 않는다.
  let f=futures();ctx.applyFutureAutoBuyPlan(f,config({contracts:3}));
  assert.deepEqual(open(f),[[1320,1],[1360,1],[1380,1]]);
  Object.assign(pending(f)[0].t,{completed:true,executionPrice:1320});ctx.applyFutureAutoBuyPlan(f);
  assert.deepEqual(open(f),[[1360,1],[1380,1]]);
  Object.assign(pending(f).find(x=>x.t.price===1360).t,{completed:true,executionPrice:1360.5});ctx.applyFutureAutoBuyPlan(f);
  assert.deepEqual(open(f),[[1380,1]]);
  // 계약이 회차보다 많으면 회차의 일부 계약만 체결해도 다른 회차 계약 수가 옮겨 다니지 않는다.
  f=futures();ctx.applyFutureAutoBuyPlan(f,config());
  assert.deepEqual(open(f),[[1320,2],[1340,2],[1360,2],[1380,1]]);
  Object.assign(pending(f)[0].t,{completed:true,executionPrice:1320});ctx.applyFutureAutoBuyPlan(f);
  assert.deepEqual(open(f),[[1320,1],[1340,2],[1360,2],[1380,1]]);
  // 이평선이 움직이면 같은 회차(32일선 3차 = 1,326 + 54 × ⅔)의 가격이 선을 따라 움직인다.
  const prices=(at,start,next)=>({updatedAt:at,stocks:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-08',close:1390,ma:{'32일선':start,'42일선':next}}}});
  f=futures();ctx.applyFutureAutoBuyPlan(f,config({contracts:3}));Object.assign(pending(f)[0].t,{completed:true,executionPrice:1320});
  ctx.fillPrices({futures:f},prices('2026-10-08T01:00:00Z',1326,1380));
  assert.deepEqual(open(f),[[1362,1],[1380,1]]);
  assert.equal(f.levels.reduce((n,l)=>n+l.tranches.length,0),3,'총 계약 수는 그대로');
});

test('이동평균 종료 계획의 quiet 계산은 끈 미완료 회차를 더하고 같은 회차·가격에 켠 계약이 있으면 켠 규칙만 둔다',()=>{
  const ctx=load(),f=futures();ctx.applyFutureAutoBuyPlan(f,config());f.notify={levels:false};
  const before=JSON.stringify(f);
  assert.deepEqual(plain(ctx.buildTradeAlertRules({futures:f},null)),[]);
  const all=plain(ctx.buildTradeAlertRules({futures:f},null,true));
  assert.deepEqual(all.map(r=>[r.targetPrice,r.notify]),[[1320,false],[1340,false],[1360,false],[1380,false]]);
  assert.equal(JSON.stringify(f),before);
  const same=pending(f).filter(x=>x.t.price===1340);assert.ok(same.length>1,'같은 가격의 여러 계약');
  same[1].t.notify=true;
  const mixed=plain(ctx.buildTradeAlertRules({futures:f},null,true));
  assert.deepEqual(mixed.filter(r=>r.targetPrice===1340).map(r=>r.notify),[undefined],'켠 계약이 있으면 quiet 중복 없이 켠 규칙 하나');
  assert.deepEqual(plain(ctx.buildTradeAlertRules({futures:f},null)),mixed.filter(r=>r.notify===undefined));
  pending(f).forEach(x=>x.t.completed=true);assert.deepEqual(plain(ctx.buildTradeAlertRules({futures:f},null,true)),[]);
});
