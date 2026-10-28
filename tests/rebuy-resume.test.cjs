const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// 재이탈: 재매수를 시작한 뒤 다시 손절하면 남은 손절은 이어지고, 재매수는 이미 산 선 다음 선부터 다시 배분한다.
const source=['ma-ladder.js','prices.js','rebuy.js','trade-alerts.js','data-validation.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const plain=v=>JSON.parse(JSON.stringify(v));
const LINES=['25선','32선','42선','60선','80선','125선'];
const load=()=>{
  const ctx=vm.createContext({});vm.runInContext(source,ctx);let n=0;
  Object.assign(ctx,{save(){},id:()=>`id-${++n}`,renderRebuy(){}},vm.runInContext('({rebuyPendingShares,rebuyPick,externalData})',ctx));
  return ctx;
};
// 가상 종목: 1,000주, 신저점 10,000원, 1% 하락마다 20주 손절. 평균선 기준가는 표시 순서대로 오른다.
const fixture=(extra={})=>({id:'resume-test',name:'가상 ETF',ticker:'900001',lowPrice:10000,shares:1000,stepPct:1,sellPct:2,steps:10,currentPrice:9450,
  notify:{breakdown:true,cuts:true,buys:true},cuts:[],stages:LINES.map((name,i)=>({name,price:[9300,9400,9500,9800,9900,10000][i]})),
  range:{startLine:'25선',lastLine:'125선',names:LINES,lastRound:3,targetPct:100},...extra});
const use=(ctx,r)=>{ctx.state={rebuy:{items:[r]},selectedRebuy:r.id};return r;};
// 화면의 체크와 같은 경로(rebuyCutRecord·rebuyBuyRecord → applyRebuyCut·applyRebuyBuy)로 기록한다.
const cut=(ctx,i,qty=20)=>{const rec=ctx.rebuyCutRecord(ctx.rebuyPick(),i,String(qty),true);assert.notEqual(rec,false);ctx.applyRebuyCut(i,rec);};
const buy=(ctx,i,t)=>{
  const r=ctx.rebuyPick(),tr=ctx.rebuySummary(r).tranches.find(x=>x.i===i&&x.t===t),rec=ctx.rebuyBuyRecord(r,i,t,String(ctx.rebuyPendingShares(tr.amount,tr.price)),true);
  assert.notEqual(rec,false,`${i}:${t} 재매수 기록`);ctx.applyRebuyBuy(i,t,rec);
};
const buyOpen=(ctx,pick=()=>true)=>{for(;;){const s=ctx.rebuySummary(ctx.rebuyPick()),tr=s.tranches.find(x=>!x.done&&x.amount>0&&pick(s.stages[x.i].name,x.t));if(!tr)return;buy(ctx,tr.i,tr.t);}};
const labels=(ctx,r,kind)=>plain(plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null)).map(x=>x.label).filter(x=>kind==='cut'?x.includes('손절'):kind==='buy'?!x.includes('손절')&&!x.includes('이탈'):true));
const open=s=>plain(s.tranches.filter(x=>!x.done).map(x=>[s.stages[x.i].name,x.t]));
const cutLabels=(from,to)=>Array.from({length:to-from+1},(_,k)=>`재매수 손절 ${from+k}회`);
// 재이탈하면 평균 손절가가 내려가므로(약 9,650원) 처음에 평균 손절가 위라 빠진 60선은 그대로면 사지 않는다.
// 시간이 지나 60선이 평균 손절가 아래로 내려온 상황(80선은 위)을 만들어 재개 흐름을 검증한다.
const maDown=r=>{r.stages[3].price=9450;if(r.stages[4])r.stages[4].price=9700;};

test('재이탈: 25·32·42선까지 산 뒤 다시 손절하면 남은 손절은 이어지고 재매수는 60선부터 다시 배분한다',()=>{
  const ctx=load(),r=use(ctx,fixture());
  for(let i=0;i<5;i++)cut(ctx,i);
  assert.ok(r.cuts.every(c=>!Object.hasOwn(c,'afterLine')),'재매수 전 손절에는 재이탈 표시를 저장하지 않는다');
  let s=ctx.rebuySummary(r);
  assert.deepEqual([...new Set(s.planKeys.map(x=>x[0]))],['25선','32선','42선'],'평균 손절가 9,700원 이하인 42선까지');
  buyOpen(ctx);
  s=ctx.rebuySummary(r);
  assert.deepEqual([r.plannedEndLine,s.cycle,ctx.rebuyStatus(r,s)[0]],['42선',null,'재매수 완료']);
  assert.deepEqual(labels(ctx,r),cutLabels(6,10),'재매수를 마쳐도 남은 손절 알림은 유지하고 신저점 이탈은 알리지 않는다');
  assert.deepEqual(plain(s.cutBase),{base:s.held,left:s.held,cont:false,start:5},'다음 손절은 재매수를 반영한 지금 보유 기준');
  assert.equal(s.cuts[5].qty,Math.round(s.held*2*6/100)-Math.round(s.held*2*5/100));

  const planned=plain(r.planned);
  cut(ctx,5);
  assert.equal(r.cuts[5].afterLine,'42선','재매수 뒤 새 손절에 마지막으로 산 선을 남긴다');
  s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.cycle),{after:'42선',at:2,round:0,from:3,start:5,bought:false});
  assert.equal(Object.hasOwn(r.cuts[5],'afterRound'),false,'42선을 다 샀으면 다음 선부터');
  assert.deepEqual(plain(s.planKeys),[['60선',0],['60선',1],['60선',2]],'다음 선 60선을 계획한다');
  assert.ok(s.tranches.filter(x=>!x.done).every(x=>x.above&&x.amount===0),'60선이 평균 손절가 위면 사지 않는다');
  assert.deepEqual(labels(ctx,r,'buy'),[]);
  maDown(r);s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),[['60선',0],['60선',1],['60선',2]],'80선은 아직 평균 손절가 위라 60선까지');
  assert.deepEqual(open(s),[['60선',0],['60선',1],['60선',2]],'25·32·42선은 가격이 다시 와도 새로 사지 않는다');
  assert.ok(s.rest>180000&&Math.abs(s.tranches.filter(x=>!x.done).reduce((n,x)=>n+x.amount,0)-s.rest)<1e-6,'재이탈 손절 금액을 60선 회차에 모두 배분');
  assert.equal(s.fixPlan,true);
  assert.deepEqual(labels(ctx,r,'buy'),['재매수 60선','재매수 60선 2차','재매수 60선 3차']);
  assert.deepEqual(labels(ctx,r,'cut'),cutLabels(7,10));

  buy(ctx,3,0);
  assert.deepEqual([r.resumeEndLine,r.plannedEndLine],['60선','42선'],'재이탈 뒤 첫 재매수 때 이번 범위만 고정하고 앞 범위는 남긴다');
  assert.deepEqual(plain(r.planned),planned,'범위 기록의 옛 고정 계획은 바꾸지 않는다');
  s=ctx.rebuySummary(r);
  assert.deepEqual([s.cycle.bought,s.fixPlan],[true,false]);
  assert.deepEqual(open(s),[['60선',1],['60선',2]]);

  buyOpen(ctx);cut(ctx,6);
  assert.deepEqual([r.cuts[6].afterLine,Object.hasOwn(r.cuts[6],'afterRound')],['60선',false],'60선을 다 산 뒤 두 번째 재이탈은 다음 선부터');
  s=ctx.rebuySummary(r);
  assert.deepEqual(open(s),[['80선',0],['80선',1],['80선',2]]);
  assert.ok(!s.skipped.some(x=>['42선','60선'].includes(s.stages[x.i].name)),'앞 재매수들의 마지막 선은 지정 회차를 유지한다');

  ctx.applyRebuyCut(6,null);
  s=ctx.rebuySummary(r);
  assert.equal(r.cuts.length,6);
  assert.deepEqual([s.cycle.after,s.cycle.bought,open(s)],['42선',true,[]],'재이탈 손절을 지우면 이전 재이탈(60선, 다 삼)로 돌아간다');
});

test('재이탈: 한 선을 일부만 산 뒤 다시 손절하면 그 선의 다음 회차부터 다시 산다',()=>{
  const ctx=load(),r=use(ctx,fixture());
  for(let i=0;i<5;i++)cut(ctx,i);
  buyOpen(ctx,(name,t)=>name==='25선'||name==='32선'&&t===0);
  cut(ctx,5);
  let s=ctx.rebuySummary(r);
  assert.deepEqual([r.cuts[5].afterLine,r.cuts[5].afterRound],['32선',1],'32선 1회차까지 산 뒤 재이탈');
  assert.deepEqual(plain(s.cycle),{after:'32선',at:1,round:1,from:1,start:5,bought:false});
  assert.deepEqual(open(s),[['32선',1],['32선',2],['42선',0],['42선',1],['42선',2]],'32선 2회차부터 평균 손절가 9,650원 이하인 42선까지');
  assert.deepEqual(plain(s.skipped.filter(x=>x.passed)),[]);
  assert.deepEqual(plain(s.tranches.filter(x=>x.above).map(x=>[s.stages[x.i].name,x.t])),[['42선',2]],'42선 3회차 9,700원은 평균 손절가 위');
  assert.deepEqual(labels(ctx,r,'buy'),['재매수 32선 2차','재매수 32선 3차','재매수 42선','재매수 42선 2차']);
  buy(ctx,1,1);
  assert.equal(r.resumeEndLine,'42선');
  cut(ctx,6);
  assert.deepEqual([r.cuts[6].afterLine,r.cuts[6].afterRound],['32선',2],'32선 2회차를 산 뒤 다시 재이탈하면 3회차부터');
  s=ctx.rebuySummary(r);
  assert.deepEqual(open(s)[0],['32선',2]);
});

test('재이탈: 앞 선에서 사지 않은 회차는 재이탈로 건너뛰고, 같은 선만 남아도 다음 회차는 지정 회차와 관계없이 남긴다',()=>{
  const ctx=load(),r=use(ctx,fixture({range:{startLine:'25선',lastLine:'125선',names:LINES,lastRound:1,targetPct:100}}));
  r.stages[2].price=9660; // 재이탈 뒤 평균 손절가 9,650원 위 → 이번 재매수는 32선 하나
  for(let i=0;i<5;i++)cut(ctx,i);
  buyOpen(ctx,(name,t)=>t===0&&name!=='42선');
  cut(ctx,5);
  const s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.skipped.filter(x=>x.passed).map(x=>[s.stages[x.i].name,x.t])),[['25선',1],['25선',2]]);
  assert.deepEqual(open(s),[['32선',1]],'마지막 1회차 설정이어도 32선 2회차는 남긴다');
});

test('재이탈 손절 수량은 재매수를 반영한 그때 보유로 나누고 손절 합계 한도도 재매수만큼 늘어난다',()=>{
  const ctx=load(),r=use(ctx,fixture({sellPct:10,steps:6}));
  // 2회 손절(200주) 뒤 25선에서 300주 재매수(가상 수치) → 지금 보유 1,100주
  r.cuts=[{shares:100,price:9900},{shares:100,price:9800}];r.stages[0].buys=[{shares:300,price:9300}];
  let s=ctx.rebuySummary(r);
  assert.deepEqual([s.held,plain(s.cutBase)],[1100,{base:1100,left:1100,cont:false,start:2}]);
  assert.deepEqual(plain(s.cuts.slice(2).map(c=>c.qty)),[110,110,110,110],'이탈 전 1,000주가 아니라 지금 보유 1,100주의 10%');
  const points=m=>plain(m.points.map(x=>[x.cut.k,x.cut.drop,x.cut.sold,!!x.cut.reached,x.inPlan]));
  let m=ctx.cutMilestones(r);
  assert.deepEqual([plain(m.base),points(m)],[{hold:1100,cont:false},[[7,7,550,false,false],[12,12,1100,false,false]]],'손절 도달 기준도 지금 보유 1,100주를 3회차부터 110주씩 파는 기준(표시 6회 밖)');
  cut(ctx,2,110);
  s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.cutBase),{base:1100,left:990,cont:true,start:2},'재이탈 손절 뒤 그 재매수 전에는 재이탈 직전 보유를 유지');
  assert.deepEqual(plain(s.cuts.slice(3).map(c=>c.qty)),[110,110,110]);
  m=ctx.cutMilestones(r);
  assert.deepEqual([plain(m.base),points(m)],[{hold:1100,cont:true},[[7,7,550,false,false],[12,12,1100,false,false]]],'이미 판 110주를 포함해 같은 회차');
  assert.equal(ctx.rebuyCutRecord(r,3,'991',true),false,'손절 합계는 이탈 전 보유 + 재매수(1,300주)까지');
  assert.notEqual(ctx.rebuyCutRecord(r,3,'990',true),false);
  const before=ctx.rebuySummary({...r,stages:r.stages.map(st=>({...st,buys:undefined}))});
  assert.equal(before.cutBase,null,'재매수 전에는 이탈 전 보유 기준 그대로');
  r.steps=10;for(let i=3;i<7;i++)cut(ctx,i,110);
  m=ctx.cutMilestones(r);
  assert.deepEqual(points(m)[0],[7,7,550,true,true],'절반을 이미 팔았으면 넘긴 회차를 도달로 표시');
});

test('재이탈: 범위 상한까지 다 샀으면 범위 밖 다음 평균선 하나에 배분한다',()=>{
  const ctx=load(),r=use(ctx,fixture({range:{startLine:'25선',lastLine:'42선',names:['25선','32선','42선'],lastRound:2,targetPct:100}}));
  for(let i=0;i<5;i++)cut(ctx,i);
  buyOpen(ctx);
  let s=ctx.rebuySummary(r);
  assert.deepEqual(open(s),[]);assert.equal(r.plannedEndLine,'42선');
  cut(ctx,5);maDown(r);
  s=ctx.rebuySummary(r);
  assert.deepEqual(open(s),[['60선',0],['60선',1]],'상한 밖 60선 하나에 지정 회차(2회차)까지');
  assert.deepEqual(plain(s.tranches.filter(x=>!x.done).map(x=>Math.round(x.price*100)/100)),[9450,9533.33],'60선 회차 가격은 다음 평균선 80선으로 나눈다');
  assert.ok(!s.skipped.some(x=>s.stages[x.i].name==='42선'),'앞 재매수의 마지막 선 회차 수는 그대로');
  assert.deepEqual(labels(ctx,r,'buy'),['재매수 60선','재매수 60선 2차']);
});

test('재이탈: 범위 없는 옛 기록은 저장 순서의 다음 단계부터 배분하고 첫 재매수 때 계획을 다시 고정한다',()=>{
  const ctx=load(),r=fixture();delete r.range;r.stages=r.stages.slice(0,4);use(ctx,r);
  for(let i=0;i<5;i++)cut(ctx,i);
  buyOpen(ctx);
  assert.deepEqual([...new Set(r.planned.map(x=>x[0]))],['25선','32선','42선']);
  cut(ctx,5);maDown(r);
  let s=ctx.rebuySummary(r);
  assert.deepEqual([s.cycle.from,plain(s.planKeys),s.fixPlan],[3,[['60선',0]],true],'옛 고정 계획의 앞 선은 쓰지 않는다');
  buy(ctx,3,0);
  assert.deepEqual(plain(r.planned),[['60선',0]]);assert.equal(r.resumeEndLine,undefined);
  s=ctx.rebuySummary(r);
  assert.deepEqual([s.cycle.bought,s.fixPlan,open(s)],[true,false,[]]);
});

test('재이탈: 다음 평균선이 없으면 새 배분 없이 남은 손절만 이어진다',()=>{
  const ctx=load(),r=fixture();delete r.range;r.stages=r.stages.slice(0,2);use(ctx,r);
  for(let i=0;i<5;i++)cut(ctx,i);
  buyOpen(ctx);cut(ctx,5);
  const s=ctx.rebuySummary(r);
  assert.deepEqual([s.cycle.after,s.cycle.from,plain(s.planKeys),s.fixPlan],['32선',-1,[],false]);
  assert.ok(s.rest>0);assert.deepEqual(open(s),[]);
  assert.deepEqual(labels(ctx,r),cutLabels(7,10));
});

test('재이탈 표시는 조회로 저장하지 않고, 가리키는 단계의 체결이 지워졌으면 무시한다',()=>{
  const ctx=load(),r=use(ctx,fixture());
  for(let i=0;i<5;i++)cut(ctx,i);
  buyOpen(ctx);cut(ctx,5);
  const before=JSON.stringify(r);
  ctx.rebuySummary(r);ctx.buildTradeAlertRules({rebuy:{items:[r]}},null);ctx.rebuyStatus(r,ctx.rebuySummary(r));
  assert.equal(JSON.stringify(r),before);
  const copy=JSON.parse(before);copy.cuts[5].afterLine='150일선';
  assert.equal(ctx.rebuySummary(copy).cycle,null);
  copy.cuts[5].afterLine='42선';delete copy.stages[2].buys;
  assert.equal(ctx.rebuySummary(copy).cycle,null);
});

test('재이탈 필드는 문자열만 받고 기존 기록 검증을 유지한다',()=>{
  const ctx=load(),data=item=>({plans:[],futures:{},rebuy:{items:[{id:'a',cuts:[{shares:1,price:1}],...item}]}});
  for(const ok of [{},{resumeEndLine:'60선'},{cuts:[{shares:1,price:1,afterLine:'42선'},null]}])assert.doesNotThrow(()=>ctx.externalData.planner(data(ok)));
  for(const bad of [{resumeEndLine:60},{cuts:[{shares:1,price:1,afterLine:42}]},{cuts:[{shares:1,price:1,afterLine:{}}]}])assert.throws(()=>ctx.externalData.planner(data(bad)),/기록 형식/);
});

test('재이탈: 지난 손절 회차를 다시 체크하는 정정은 재이탈로 보지 않고, 표시한 선의 체결이 지워지면 앞 재이탈을 따른다',()=>{
  const ctx=load(),r=use(ctx,fixture());
  for(let i=0;i<5;i++)cut(ctx,i);
  buyOpen(ctx,(name)=>name==='25선');
  ctx.applyRebuyCut(2,null);cut(ctx,2);
  assert.equal(Object.hasOwn(r.cuts[2],'afterLine'),false,'기록된 손절보다 얕은 회차');
  assert.equal(ctx.rebuySummary(r).cycle,null);
  buyOpen(ctx);cut(ctx,5);maDown(r);buy(ctx,3,0);cut(ctx,6);
  assert.deepEqual([r.cuts[5].afterLine,r.cuts[6].afterLine],['42선','60선']);
  ctx.applyRebuyBuy(3,0,null);
  const s=ctx.rebuySummary(r);
  assert.deepEqual([s.cycle.after,s.stages[s.cycle.from].name],['42선','60선'],'60선 체결을 지우면 앞 재이탈(42선 다음)부터');
  assert.deepEqual(open(s),[['60선',0],['60선',1],['60선',2]]);
});
