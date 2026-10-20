// 달러선물 손절·재매수 체크의 보유 월물·누적 정산손익 반영. 모두 가상 계약·체결 기록이다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=['ma-ladder.js','prices.js','rebuy.js','futures.js','futures-plan.js','futures-rebuy.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({contractSize:10000});vm.runInContext(code,ctx);return ctx;};
const futures=(extra={})=>({targetPrice:1480,baselinePnl:50000,positions:[{month:'202612',contracts:4,settlementPrice:1450}],levels:[],rebuy:{lowPrice:1400,floorPrice:1300,contracts:4,steps:2,...extra}});
const held=f=>f.positions.reduce((n,p)=>n+p.contracts,0);

test('손절 체크는 근월물 계약을 빼고 실현 손익을 누적 정산손익에 더해 기대수익·도달 손익에 반영한다',()=>{
  const ctx=load(),f=futures(),before=ctx.futuresSummary(f).current;
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  const rec=f.rebuy.cuts[0];
  assert.equal(rec.contracts,1);assert.equal(rec.month,'202612');assert.equal(rec.settlementPrice,1450);
  assert.deepEqual(JSON.parse(JSON.stringify(f.positions)),[{month:'202612',contracts:3,settlementPrice:1450}],'남은 계약의 단순평균가는 그대로');
  assert.equal(f.baselinePnl,50000+(1400-1450)*10000);
  const s=ctx.futuresSummary(f);
  assert.equal(s.posContracts,3);
  assert.equal(s.current,before-(1480-1400)*10000,'판 계약은 목표 환율까지의 이익 대신 손절 환율에서 확정');
  const loss=ctx.lossCheck(f);
  assert.equal(loss.contracts,3);assert.equal(loss.held,3*(1320-1450)*10000,'도달 손익의 보유분에서 판 계약이 빠진다');
  assert.equal(loss.pnl,f.baselinePnl+loss.held);
  assert.equal(ctx.rollEstimate(f,s.posContracts+s.legacyCount).perRoll,3*5000,'월물교체 예상도 남은 계약 기준');
  assert.equal(ctx.futureRebuySummary(f).hold,4,'이탈 전 계약 수(손절 목표)는 그대로');
});

test('손절 체결 환율·계약 수 수정과 체크 해제는 보유·누적 정산손익을 같은 계산으로 되돌린다',()=>{
  const ctx=load(),f=futures(),orig=JSON.stringify({p:f.positions,b:f.baselinePnl});
  ctx.setFutureCutChecked(f,0,true);
  assert.notEqual(ctx.setFutureCutPrice(f,0,'1395.5'),false);
  assert.equal(f.baselinePnl,50000+Math.round((1395.5-1450)*10000));
  assert.notEqual(ctx.setFutureCutCount(f,0,'2'),false);
  assert.equal(held(f),2);assert.equal(f.baselinePnl,50000+Math.round((1395.5-1450)*2*10000));
  assert.equal(ctx.setFutureCutCount(f,0,'3'),false,'손절 목표(2계약)를 넘으면 거부');
  assert.equal(held(f),2);
  assert.notEqual(ctx.setFutureCutCount(f,0,'1'),false);
  assert.equal(held(f),3);assert.equal(f.positions[0].settlementPrice,1450);
  assert.notEqual(ctx.setFutureCutChecked(f,0,false),false);
  assert.equal(f.rebuy.cuts[0],null);
  assert.equal(JSON.stringify({p:f.positions,b:f.baselinePnl}),orig,'해제하면 원래 보유·정산손익');
});

test('손절로 월물을 다 팔면 행을 지우고, 해제하면 판 시점 단순평균가로 되살린다',()=>{
  const ctx=load(),two=()=>[{month:'202612',contracts:2,settlementPrice:1450},{month:'202703',contracts:2,settlementPrice:1460}];
  const f=futures({contracts:3,sellPct:100,steps:3});f.positions=[{month:'202612',contracts:1,settlementPrice:1450},{month:'202703',contracts:2,settlementPrice:1460}];
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  assert.equal(f.rebuy.cuts[0].month,'202612');
  const all=futures({sellPct:100,steps:1});all.positions=two();
  assert.equal(ctx.setFutureCutChecked(all,0,true),'unlinked','한 월물에 판 계약 수만큼 없으면 나눠 빼지 않고 기록만');
  assert.deepEqual(JSON.parse(JSON.stringify(all.positions)),two());assert.equal(all.baselinePnl,50000);
  const g=futures({steps:1});g.positions=two();
  ctx.setFutureCutChecked(g,0,true);
  assert.equal(g.rebuy.cuts[0].contracts,2);
  assert.deepEqual(JSON.parse(JSON.stringify(g.positions)),[{month:'202703',contracts:2,settlementPrice:1460}]);
  ctx.setFutureCutChecked(g,0,false);
  assert.deepEqual(JSON.parse(JSON.stringify(g.positions)),[{month:'202612',contracts:2,settlementPrice:1450},{month:'202703',contracts:2,settlementPrice:1460}]);
});

test('보유 월물이 없으면 손절 기록만 하고 반영하지 않는다',()=>{
  const ctx=load(),f=futures();f.positions=[];
  assert.equal(ctx.setFutureCutChecked(f,0,true),'unlinked');
  assert.equal(f.rebuy.cuts[0].contracts,1);assert.equal(Object.hasOwn(f.rebuy.cuts[0],'month'),false);
  assert.equal(f.baselinePnl,50000);
  assert.equal(ctx.futureRebuyUnlinked(f).cuts,1);
});

test('재매수 체크는 근월물에 체결 환율로 편입하고 수정·해제는 가중평균을 되돌린다',()=>{
  const ctx=load(),f=futures({currentPrice:1420});
  f.rebuy.stages=[{name:'25일선',price:1380},{name:'60일선',price:1420},{name:'120일선',price:1500}];
  ctx.setFutureCutChecked(f,0,true);ctx.setFutureCutChecked(f,1,true);
  assert.equal(held(f),2);
  const s=ctx.futureRebuySummary(f),tr=s.tranches.find(x=>x.amount>0);
  const pnl=f.baselinePnl;
  assert.equal(ctx.setFutureBuyChecked(f,tr.i,tr.t,true),true);
  const [rec,key]=ctx.futureFillRec(f,tr.i,tr.t);
  assert.equal(rec.month,'202612');
  assert.equal(held(f),2+rec.contracts);
  assert.equal(f.positions[0].settlementPrice,(1450*2+rec[key]*rec.contracts)/(2+rec.contracts));
  assert.equal(f.baselinePnl,pnl,'재매수는 정산손익을 바꾸지 않는다');
  assert.notEqual(ctx.setFutureBuyExec(f,tr.i,tr.t,'1390'),false);
  assert.ok(Math.abs(f.positions[0].settlementPrice-(1450*2+1390*rec.contracts)/(2+rec.contracts))<1e-9);
  assert.notEqual(ctx.setFutureBuyChecked(f,tr.i,tr.t,false),false);
  assert.equal(held(f),2);assert.ok(Math.abs(f.positions[0].settlementPrice-1450)<1e-9);
});

test('연동 전 체크 기록은 버튼으로만 반영하고, 반영할 수 없으면 원본을 그대로 둔다',()=>{
  const ctx=load(),f=futures({cuts:[{contracts:1,price:1398,targetPrice:1400}]}),before=JSON.stringify(f);
  assert.deepEqual({...ctx.futureRebuyUnlinked(f)},{cuts:1,buys:0});
  assert.equal(ctx.futuresSummary(f).posContracts,4,'읽기·계산만으로는 반영하지 않는다');
  const g=ctx.futureRebuyLinked(f);
  assert.equal(JSON.stringify(f),before,'미리 계산만 하면 원본을 바꾸지 않는다');
  assert.equal(held(g),3);assert.equal(g.baselinePnl,50000+(1398-1450)*10000);
  assert.equal(g.rebuy.cuts[0].month,'202612');assert.deepEqual({...ctx.futureRebuyUnlinked(g)},{cuts:0,buys:0});
  const none=futures({cuts:[{contracts:9,price:1398,targetPrice:1400}]});
  assert.equal(ctx.futureRebuyLinked(none),null,'보유보다 많이 판 기록은 반영하지 않는다');
});

test('직접 반영함은 미반영 기록에 manual만 남겨 안내·반영에서 빼고, 보유·누적 정산손익은 그대로 둔다',()=>{
  const ctx=load(),f=futures({currentPrice:1420,cuts:[{contracts:1,price:1398,targetPrice:1400},{contracts:1,price:1390,targetPrice:1390,month:'202612',settlementPrice:1450}]});
  f.rebuy.stages=[{name:'25일선',price:1380,buys:[{contracts:1,price:1385}]},{name:'60일선',price:1420,done:true,contracts:1,execPrice:1420}];
  const pos=JSON.stringify({p:f.positions,b:f.baselinePnl});
  assert.deepEqual({...ctx.futureRebuyUnlinked(f)},{cuts:1,buys:2});
  ctx.markFutureRebuyManual(f);
  assert.deepEqual({...ctx.futureRebuyUnlinked(f)},{cuts:0,buys:0});
  assert.equal(f.rebuy.cuts[0].manual,true);assert.equal(Object.hasOwn(f.rebuy.cuts[1],'manual'),false,'보유에 반영한 기록은 그대로');
  assert.equal(f.rebuy.stages[0].buys[0].manual,true);assert.equal(f.rebuy.stages[1].manual,true);
  assert.equal(JSON.stringify({p:f.positions,b:f.baselinePnl}),pos);
  const g=ctx.futureRebuyLinked(f);
  assert.equal(JSON.stringify({p:g.positions,b:g.baselinePnl}),pos,'보유 월물에 반영 대상에서도 빠진다');
  assert.notEqual(ctx.setFutureBuyChecked(f,1,0,false),false);
  assert.equal(Object.hasOwn(f.rebuy.stages[1],'manual'),false,'옛 통째 기록은 체크 해제 때 manual도 지운다');
});

test('맨 위 보유 카드는 손절하면 오른쪽 칸을 비우고 재매수하면 빈 칸을 다시 채우며 기록을 바꾸지 않는다',()=>{
  const ctx=load();ctx.decimal=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
  const f=futures({stages:[{name:'25선',price:1390,done:false,execPrice:null}]}),tr=x=>`${x.i}:${x.t}`;
  const card=(cur=0)=>{const before=JSON.stringify(f),html=ctx.futureRebuyTrack(f.rebuy,ctx.futureRebuySummary(f),cur,'<i>알림</i>',tr);assert.equal(JSON.stringify(f),before,'카드는 기록을 바꾸지 않는다');return html;};
  const strip=html=>html.match(/<div class="fr-cells[^>]*>(.*?)<\/div>/)[1],cells=html=>[...strip(html).matchAll(/<i class="([^"]+)"/g)].map(m=>m[1]);
  const next=html=>(m=>m&&[m[1],Number(m[2]),[...m[3].matchAll(/<i /g)].length])(strip(html).match(/<span class="fr-next([^"]*)" style="flex:(\d+)">(.*?)<\/span>/));
  // 50%: 4계약 중 2계약은 최소 유지(흐림), 다음 손절 1회 칸(맨 오른쪽)을 테두리 묶음으로
  let html=card(1410);
  assert.deepEqual(cells(html),['h keep','h keep','h','h']);assert.deepEqual(next(html),['',1,1]);
  assert.match(html,/신저점 이탈 시 1회 <b>1,400원<\/b> -0\.71%/);assert.match(html,/<b>4<\/b><span>\/ 4계약/);assert.match(html,/신저점 위 대기/);
  assert.match(html,/--x:87\.5%/,'말풍선 꼬리는 가리키는 칸 가운데');
  // 1회 손절 뒤 현재가가 2회 환율 이하면 그 칸이 주황(손절 시점)
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  html=card(1290);
  assert.deepEqual(cells(html),['h keep','h keep','h due','s']);assert.deepEqual(next(html),[' due',1,1]);assert.match(html,/buy-track-chip warn">손절 시점/);assert.match(html,/손절 시점 · 2회 <b>1,300원<\/b> 1계약/);
  assert.match(html,/<p class="fr-note">재매수: 0:0 <b>1,390원<\/b> 이상 1계약 <span class="fr-gap up">\+7\.8%<\/span><\/p>/,'손절 중 안내는 다음 재매수 회차를 한 줄로');
  // 손절 목표를 다 팔면 다음 재매수 칸(점선)을 가리킨다
  assert.equal(ctx.setFutureCutChecked(f,1,true),true);
  html=card(1350);
  assert.deepEqual(cells(html),['h keep','h keep','s','s']);assert.deepEqual(next(html),[' buy',2,2],'다음 재매수 2계약 칸을 점선 묶음으로');assert.match(html,/다음 재매수 0:0 <b>1,390원<\/b> \+3%/);assert.match(html,/<b>2<\/b><span>\/ 4계약/);
  // 재매수하면 빈 칸이 파랑으로 다시 채워진다
  assert.equal(ctx.setFutureBuyChecked(f,0,0,true),true);
  html=card(1395);
  assert.deepEqual(cells(html),['h keep','h keep','r','r']);assert.equal(next(html),null);assert.match(html,/buy-track-chip done">재매수 완료/);assert.match(html,/손절 2계약 → 재매수 2계약/);
  assert.equal(ctx.futureRebuyTrack({},ctx.futureRebuySummary({positions:[],levels:[],rebuy:{}}),0,'',tr).includes('fr-cells'),false,'이탈 전 계약이 없으면 칸을 그리지 않는다');
});

test('손절 기준 수정 창은 바꾼 칸만 순서와 관계없이 함께 저장하고 실패하면 원본을 그대로 둔다',()=>{
  const ctx=load(),f=futures({contracts:20,steps:5});f.positions[0].contracts=20;
  ctx.setFutureCutChecked(f,0,true);ctx.setFutureCutChecked(f,1,true);
  const records=JSON.stringify(f.rebuy.cuts),before=JSON.stringify(f);assert.equal(ctx.futureRebuySummary(f).sold,4);
  // 둘 다 내리는 신저점·하단(하단 먼저), 계약 수를 줄이며 비중을 올림(비중 먼저)도 한 번에 저장된다.
  let g=ctx.applyFutureRebuyEdits(f,{lowPrice:'1280',floorPrice:'1200',contracts:'6',sellPct:'100'});
  assert.ok(g);assert.equal(JSON.stringify(f),before,'원본은 사본 적용 뒤 호출하는 쪽에서 바꾼다');
  assert.deepEqual([g.rebuy.lowPrice,g.rebuy.floorPrice,g.rebuy.contracts,g.rebuy.sellPct],[1280,1200,6,100]);
  assert.equal(JSON.stringify(g.rebuy.cuts),records,'체크한 손절 기록은 그대로');
  g=ctx.applyFutureRebuyEdits(f,{lowPrice:'1500',floorPrice:'1420',contracts:'40',sellPct:'10'});
  assert.deepEqual([g.rebuy.lowPrice,g.rebuy.floorPrice,g.rebuy.contracts,g.rebuy.sellPct],[1500,1420,40,10],'둘 다 올림(신저점 먼저)·계약 수를 늘리며 비중을 내림(계약 수 먼저)');
  g=ctx.applyFutureRebuyEdits(f,{steps:'8'});
  assert.equal(Object.hasOwn(g.rebuy,'sellPct'),false,'바꾸지 않은 비중은 필드를 만들지 않는다');assert.equal(g.rebuy.steps,8);
  for(const edits of [{lowPrice:'1300'},{contracts:'7'},{sellPct:'10'},{steps:''},{contracts:'2.5'}])assert.equal(ctx.applyFutureRebuyEdits(f,edits),null,JSON.stringify(edits));
  assert.equal(JSON.stringify(f),before);
  assert.match(ctx.futureRebuyEditError(f,{lowPrice:'1300',floorPrice:'1300',contracts:'20',sellPct:'50',steps:'5'}),/하단은 신저점 환율보다 낮게/);
  assert.match(ctx.futureRebuyEditError(f,{lowPrice:'1400',floorPrice:'1300',contracts:'7',sellPct:'',steps:'5'}),/이미 손절한 4계약보다 작아집니다/);
  f.rebuy.currentPrice=1250;f.rebuy.stages=[{name:'25선',price:1260},{name:'25일선',price:1270}];
  const first=ctx.futureRebuySummary(f).tranches.find(x=>x.amount>0);assert.notEqual(ctx.setFutureBuyChecked(f,first.i,first.t,true),false);
  assert.equal(ctx.applyFutureRebuyEdits(f,{lowPrice:'1410'}),null);assert.match(ctx.futureRebuyEditError(f,{}),/재매수 시작 후/);
  assert.equal(ctx.applyFutureRebuyEdits(f,{currentPrice:'1265'}).rebuy.currentPrice,1265,'재매수 시작 뒤에도 현재 환율은 바꾼다');
});

test('분할 손절 표의 손절 시점은 현재 환율이 다음 손절 회차 환율 이하일 때만이다',()=>{
  const ctx=load(),f=futures(),due=cur=>ctx.futureCutDue(ctx.futureRebuySummary(f),cur)?.k??null;
  assert.equal(due(1450),null,'신저점 위면 접는다');assert.equal(due(0),null,'현재 환율이 없으면 접는다');
  assert.equal(due(1400),1);assert.equal(due(1350),1);
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  assert.equal(due(1350),null,'1회를 손절하면 다음 회차 환율까지는 접는다');assert.equal(due(1300),2);
  assert.equal(ctx.futureCutDue(ctx.futureRebuySummary(futures({floorPrice:1400})),1200),null,'기준 미입력');
});

test('반등 단계별 재매수 표의 재매수 시점은 판 계약이 있고 현재 환율이 재매수 회차 환율 이상일 때만이다',()=>{
  const ctx=load(),f=futures({currentPrice:1330,stages:[{name:'25일선',price:1340},{name:'60일선',price:1380}]});
  const due=cur=>(x=>x&&`${x.i}:${x.t}`)(ctx.futureBuyDue(ctx.futureRebuySummary(f),cur));
  assert.equal(due(1400),null,'손절 전에는 재매수 회차가 없어 접는다');
  ctx.setFutureCutChecked(f,0,true);ctx.setFutureCutChecked(f,1,true);
  assert.equal(due(1330),null,'첫 회차 환율 아래면 접는다');assert.equal(due(0),null,'현재 환율이 없으면 접는다');
  assert.equal(due(1340),'0:0');assert.equal(due(1390),'0:0');
  assert.equal(ctx.setFutureBuyChecked(f,0,0,true),true);
  assert.equal(due(1390),null,'판 계약을 다 되사면 접는다');
});

test('접힌 한 줄은 실행 전·손절 진행·재매수 대기·완료 상태와 다음 회차·현재 환율·보유를 보여 주며 기록을 바꾸지 않는다',()=>{
  const ctx=load();ctx.decimal=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
  const f=futures({stages:[{name:'25선',price:1390,done:false,execPrice:null}]}),tr=x=>`${x.i}:${x.t}`;
  const fold=cur=>{const before=JSON.stringify(f),s=ctx.futureRebuySummary(f),out=ctx.futureRebuyFoldLine(f.rebuy,s,cur,ctx.futureRebuyLocked(f),ctx.futureCutDue(s,cur),ctx.futureBuyDue(s,cur),tr);assert.equal(JSON.stringify(f),before);return [out.text,out.due];};
  assert.deepEqual(fold(1410),['실행 전 · 신저점 1,400원 · 하단 1,300원 · 최대 2계약 손절 · 현재 1,410원',false]);
  assert.deepEqual(fold(1400),['<b>손절 시점</b> · 1회 1,400원 이하 1계약 · 현재 1,400원',true]);
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  assert.deepEqual(fold(1350),['손절 진행 중 · 2회 1,300원 이하 · 현재 1,350원 · 보유 3/4계약',false],'실행 뒤에도 접히고 보유 계약을 덧붙인다');
  assert.deepEqual(fold(1300),['<b>손절 시점</b> · 2회 1,300원 이하 1계약 · 현재 1,300원 · 보유 3/4계약',true]);
  assert.equal(ctx.setFutureCutChecked(f,1,true),true);
  assert.deepEqual(fold(1350),['재매수 대기 · 0:0 1,390원 이상 · 현재 1,350원 · 보유 2/4계약',false]);
  assert.deepEqual(fold(1395),['<b>재매수 시점</b> · 0:0 1,390원 이상 2계약 · 현재 1,395원 · 보유 2/4계약',true]);
  assert.equal(ctx.setFutureBuyChecked(f,0,0,true),true);
  assert.deepEqual(fold(1395),['재매수 완료 · 손절 2 → 재매수 2계약 · 현재 1,395원 · 보유 4/4계약',false]);
});

test('손절 영역은 새 매매 시점·경고가 생길 때만 저절로 펼치고 펼치기·접기로 고른 상태를 그 사이 유지한다',()=>{
  const ctx=load(),open=keys=>ctx.futureRebuyOpenNow(keys),set=v=>vm.runInContext(`futureRebuyExpanded=${v}`,ctx);
  assert.equal(open([]),false,'처음에는 접힌다');
  assert.equal(open(['cut:2']),true,'손절 시점이 되면 펼친다');
  set(false);assert.equal(open(['cut:2']),false,'같은 회차에서 접으면 다시 그려도 접어 둔다');
  assert.equal(open([]),false);
  assert.equal(open(['cut:2']),true,'시점을 벗어났다가 다시 오면 펼친다');
  set(false);assert.equal(open(['cut:2','unlinked:손절 1계약']),true,'새 경고가 생기면 펼친다');
  set(false);assert.equal(open(['unlinked:손절 1계약']),false,'시점·경고가 사라지기만 하면 고른 상태 그대로');
  set(true);assert.equal(open([]),true,'펼쳐 두면 매매 시점이 지나도 그대로 둔다');
});
