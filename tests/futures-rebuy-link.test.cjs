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

test('재매수 뒤 부분 손절을 채우고 새 회차를 손절해도 기존 체결을 보존하고 보유·정산손익을 반영한다',()=>{
  const ctx=load(),f=futures({contracts:8,steps:2,stages:[{name:'25선',price:1390}]});
  f.positions[0].contracts=8;
  assert.notEqual(ctx.setFutureCutCount(f,0,'1'),false);
  assert.equal(ctx.setFutureBuyChecked(f,0,0,true),true);
  const buy=JSON.stringify(f.rebuy.stages),avg=f.positions[0].settlementPrice,pnl=f.baselinePnl;
  let s=ctx.futureRebuySummary(f);assert.equal(s.started,true);assert.equal(s.rest,0);
  assert.equal(ctx.futureCutDue(s,1400.1),null);assert.equal(ctx.futureCutDue(s,1400)?.k,1,'부분 체결 잔량도 계속 손절한다');
  assert.equal(ctx.setFutureCutChecked(f,0,true),true,'재매수 뒤 부분 손절도 체크로 완료');
  assert.equal(held(f),7);assert.equal(f.baselinePnl,pnl+Math.round((1400-avg)*10000));
  s=ctx.futureRebuySummary(f);assert.equal(s.cuts[0].done,true);
  assert.equal(ctx.futureCutDue(s,1300.1),null);assert.equal(ctx.futureCutDue(s,1300)?.k,2);
  assert.notEqual(ctx.setFutureCutCount(f,1,'1'),false,'재매수 뒤 새 회차의 부분 손절도 기록');
  s=ctx.futureRebuySummary(f);assert.deepEqual([s.cuts[1].partial,s.cuts[1].qty,s.cuts[1].plannedQty],[true,1,2]);
  assert.equal(ctx.setFutureCutChecked(f,1,true),true);
  s=ctx.futureRebuySummary(f);assert.deepEqual([s.sold,s.rebought,s.rest,s.held],[4,1,3,5]);
  assert.equal(held(f),5);assert.equal(f.baselinePnl,pnl+Math.round((1400-avg)*10000)+Math.round((1300-avg)*2*10000));
  assert.equal(f.rebuy.cuts[1].month,'202612');assert.equal(JSON.stringify(f.rebuy.stages),buy);
  assert.equal(ctx.futureCutDue(s,1200),null,'모든 손절을 마치면 더 팔지 않는다');
  assert.equal(ctx.setFutureCutCount(f,1,'3'),false,'손절 목표를 넘기는 입력은 거부');
  assert.equal(ctx.setFutureCutCount(f,0,'0'),undefined);
  const snapshot=JSON.stringify(f),restored=JSON.parse(snapshot);
  assert.equal(ctx.futureRebuySummary(restored).rest,1);assert.equal(JSON.stringify(restored),snapshot,'불러오기 계산은 기록을 바꾸지 않는다');
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

test('접힌 한 줄은 실행 전·손절 진행·재매수 대기·완료 상태와 다음 환율·보유 계약만 보여 주며 기록을 바꾸지 않는다',()=>{
  const ctx=load();ctx.decimal=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
  const f=futures({stages:[{name:'25선',price:1390,done:false,execPrice:null}]});
  const fold=cur=>{const before=JSON.stringify(f),s=ctx.futureRebuySummary(f),out=ctx.futureRebuyFoldLine(f.rebuy,s,cur,ctx.futureRebuyLocked(f),ctx.futureCutDue(s,cur),ctx.futureBuyDue(s,cur));assert.equal(JSON.stringify(f),before);return [out.text,out.due];};
  assert.deepEqual(fold(1410),['실행 전 · 1,400원 → 1,300원 · 최대 2계약',false],'폰 한 줄에 들도록 회차·계약 수·현재 환율은 뺀다');
  assert.deepEqual(fold(1400),['<b>손절 시점</b> · 1,400원 이하',true]);
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  assert.deepEqual(fold(1350),['손절 진행 중 · 1,300원 이하 · 보유 3/4',false],'실행 뒤에도 접히고 보유 계약을 덧붙인다');
  assert.deepEqual(fold(1300),['<b>손절 시점</b> · 1,300원 이하 · 보유 3/4',true]);
  assert.equal(ctx.setFutureCutChecked(f,1,true),true);
  assert.deepEqual(fold(1350),['재매수 대기 · 1,390원 이상 · 보유 2/4',false]);
  assert.deepEqual(fold(1395),['<b>재매수 시점</b> · 1,390원 이상 · 보유 2/4',true]);
  assert.equal(ctx.setFutureBuyChecked(f,0,0,true),true);
  assert.deepEqual(fold(1395),['재매수 완료 · 보유 4/4',false]);
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

test('분할 손절 체결 칸은 분할매도처럼 누적 체결이고, 계획보다 적으면 남은 계약을 그 회차에 두며 체크로 채운다',()=>{
  const ctx=load(),f=futures({contracts:8,steps:2});f.positions=[{month:'202612',contracts:8,settlementPrice:1450}];
  assert.equal(ctx.setFutureCutCount(f,0,'1'),true);
  let rec=f.rebuy.cuts[0];
  assert.deepEqual([rec.contracts,rec.partial,rec.plannedQty,rec.month],[1,true,2,'202612'],'계획 2계약 중 1계약');
  assert.equal(held(f),7);assert.equal(f.baselinePnl,50000+(1400-1450)*10000,'체결한 계약만 보유·손익에 반영');
  let s=ctx.futureRebuySummary(f);const c=s.cuts[0];
  assert.deepEqual([c.qty,c.plannedQty,c.partial,c.done,vm.runInContext('futureCutRest',ctx)(c)],[1,2,true,false,1]);
  assert.deepEqual([...s.cuts].map(x=>x.recorded?x.plannedQty:x.qty),[2,2],'남은 1계약을 뒤 회차로 옮기지 않는다');
  assert.deepEqual([s.sold,s.doneCuts,s.filledCuts],[1,0,1]);
  assert.equal(ctx.futureCutDue(s,1400)?.k,1,'부분 체결 회차가 다음 손절 회차');
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  rec=f.rebuy.cuts[0];
  assert.deepEqual([rec.contracts,Object.hasOwn(rec,'partial'),Object.hasOwn(rec,'plannedQty')],[2,false,false],'체크하면 계획 계약까지 채워 완료');
  assert.equal(held(f),6);assert.equal(f.baselinePnl,50000+(1400-1450)*2*10000);
  assert.notEqual(ctx.setFutureCutCount(f,0,'1'),false);
  assert.deepEqual([f.rebuy.cuts[0].partial,f.rebuy.cuts[0].plannedQty,held(f)],[true,2,7],'완료 회차를 줄이면 다시 부분 체결');
  assert.equal(ctx.setFutureCutCount(f,0,'5'),false,'손절 목표(4계약)를 넘으면 거부');assert.equal(ctx.setFutureCutCount(f,0,'1.5'),false);
  assert.notEqual(ctx.setFutureCutCount(f,0,'0'),false);
  assert.equal(f.rebuy.cuts[0],null);assert.equal(held(f),8);assert.equal(f.baselinePnl,50000,'0이면 체크 해제와 같다');
});

test('월물교체 뒤 부분 체결을 채우면 지금 보유 월물에서 빼고, 보유에 없는 월물로 되돌릴 때 detach면 보유를 그대로 둔다',()=>{
  const ctx=load(),f=futures({contracts:8,steps:2});f.positions=[{month:'202612',contracts:8,settlementPrice:1450}];
  ctx.setFutureCutCount(f,0,'1');
  f.positions=[{month:'202703',contracts:7,settlementPrice:1460}]; // 계좌를 보고 보유를 직접 교체
  const pnl=f.baselinePnl;
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  let rec=f.rebuy.cuts[0];
  assert.deepEqual([rec.month,rec.settlementPrice,rec.contracts],['202703',1455,2],'기록은 지금 월물·계약 가중평균');
  assert.deepEqual(JSON.parse(JSON.stringify(rec.legs)),[{month:'202612',contracts:1,settlementPrice:1450},{month:'202703',contracts:1,settlementPrice:1460}],'월물별 판 계약·평균가');
  assert.equal(held(f),6);assert.equal(f.baselinePnl,pnl+(1400-1460)*10000,'채운 계약은 지금 월물 단순평균가로 손익');
  f.positions=[{month:'202706',contracts:6,settlementPrice:1470}];
  const keep=JSON.stringify(f.positions);
  assert.notEqual(ctx.setFutureCutCount(f,0,'1',true),false);
  assert.equal(JSON.stringify(f.positions),keep,'없는 월물을 되살리지 않는다');
  rec=f.rebuy.cuts[0];
  assert.deepEqual([rec.month,rec.settlementPrice,rec.contracts,Object.hasOwn(rec,'legs')],['202612',1450,1,false],'마지막에 판 202703 계약을 빼면 처음 판 월물·평균가만 남는다');
  assert.equal(f.baselinePnl,50000+(1400-1450)*10000);assert.equal(f.rebuy.cuts[0].partial,true);
  assert.notEqual(ctx.setFutureCutChecked(f,0,false,true),false);
  assert.equal(JSON.stringify(f.positions),keep);assert.equal(f.baselinePnl,50000,'손익만 되돌린다');
  ctx.setFutureCutCount(f,0,'2');f.positions=[];
  assert.equal(ctx.setFutureCutCount(f,0,'3'),false,'더 뺄 보유 월물이 없으면 늘리지 않는다');
});

test('분할 손절 표는 분할매도 회차표로 그리고, 부분 체결·완료 접기·보유에 없는 월물을 표시한다',()=>{
  const ctx=load(),els={},handlers={};
  const el=id=>els[id]||(els[id]={id,innerHTML:'',open:true,classList:{toggle(){}},setAttribute(){},querySelector:()=>({textContent:'',addEventListener(){}}),addEventListener(){}});
  Object.assign(ctx,{$:el,$$:()=>[],onEdit:(sel,set)=>{handlers[sel]=set;},esc:v=>String(v),money:v=>`${Math.round(v)}원`,shown:v=>String(v),PENCIL:'',priceData:null,decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),save(){},renderFutures(){},confirm:()=>true,alert:msg=>{throw Error(msg);}});
  vm.runInContext('futureRebuyExpanded=true',ctx);
  const f=futures({contracts:8,steps:2,currentPrice:1420,cuts:[{contracts:1,price:1400,targetPrice:1400,month:'202609',settlementPrice:1445,partial:true,plannedQty:2}]});f.positions=[{month:'202612',contracts:7,settlementPrice:1450}];
  ctx.renderFutureRebuy(f);let html=els.futureRebuyPanel.innerHTML;
  assert.match(html,/<summary><h2>1\. 분할 손절<\/h2><span>0 \/ 2회 완료<\/span>/);
  assert.match(html,/class="card table-card purchase-table sale-table future-cut-table hide-completed no-alert" id="frCutTable"><div class="purchase-table-head"><span>회차<\/span><span>손절 환율<\/span><span>계약<\/span><span>체결<\/span><span>상태<\/span><\/div><div id="frCutRows">/);
  assert.match(html,/<div class="purchase-row partial">[^]*data-fcut-partial="true"[^]*<b>1회<\/b><small>남은 1<\/small>[^]*<div class="purchase-qty">2계약<\/div>[^]*data-fcut-qty="0" value="1"/);
  assert.match(html,/<div class="stage-price"><label class="future-tap-price" title="1회 손절 체결 환율 수정"><span class="price" aria-hidden="true">1,400원<\/span><input data-fcut-price="0"[^>]*value="1400"[^>]*><\/label><span class="krw future-row-warn">202609 보유 없음<\/span><\/div>/,'체결 환율은 그 자리에서 고치고, 기록한 월물이 지금 보유에 없을 때만 작은 줄');
  assert.match(html,/<div class="stage-price"><span class="price">1,300원<\/span><\/div>/,'체결 전 회차는 회차 환율만');
  assert.doesNotMatch(html.slice(html.indexOf('id="frCuts"'),html.indexOf('id="frBuys"')),/sale-row|class="table-head"|계획상 남은|purchase-sub/,'회차마다 한 줄, 옛 손절 줄 모양을 쓰지 않는다');
  handlers['[data-fcut-qty]']('2',{dataset:{fcutQty:'1'}});
  assert.deepEqual([f.rebuy.cuts[1].contracts,f.rebuy.cuts[1].month,Object.hasOwn(f.rebuy.cuts[1],'partial')],[2,'202612',false]);
  handlers['[data-fcut-qty]']('2',{dataset:{fcutQty:'0'}});
  ctx.renderFutureRebuy(f);html=els.futureRebuyPanel.innerHTML;
  assert.match(html,/<button class="completed-fold-bar" id="toggleFutureCuts" type="button" aria-expanded="false" aria-controls="frCutRows"><span>손절 완료 <b>2회 · 4계약<\/b> · 202612 반영<\/span>/,'반영한 월물은 완료 띠에 모은다');
  assert.deepEqual(JSON.parse(JSON.stringify(f.rebuy.cuts[0].legs)),[{month:'202609',contracts:1,settlementPrice:1445},{month:'202612',contracts:1,settlementPrice:1450}],'채운 1계약만 지금 월물에서 뺀다');
  assert.deepEqual(html.match(/future-row-warn">[^<]*/g),['future-row-warn">202609 보유 없음'],'처음 판 202609 계약은 그대로 보유 없음으로 남는다');
  assert.match(html,/completed-fold-empty">모든 회차의 손절이 완료되었습니다/);
});

test('재매수 뒤에도 남은 손절 표·입력·도달 표시를 유지하고 보유 카드와 접힌 줄에 재손절을 안내한다',()=>{
  const ctx=load(),els={};
  const el=id=>els[id]||(els[id]={innerHTML:'',open:true,classList:{toggle(){}},setAttribute(){},querySelector:()=>({textContent:'',addEventListener(){}}),addEventListener(){}});
  Object.assign(ctx,{$:el,$$:()=>[],onEdit(){},esc:v=>String(v),shown:v=>String(v),PENCIL:'',priceData:null,decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),save(){},renderFutures(){}});
  const f=futures({contracts:8,steps:2,currentPrice:1401,stages:[{name:'25선',price:1390}]});f.positions[0].contracts=8;
  ctx.setFutureCutCount(f,0,'1');ctx.setFutureBuyChecked(f,0,0,true);
  const draw=cur=>{f.rebuy.currentPrice=cur;vm.runInContext('futureRebuyExpanded=true',ctx);const before=JSON.stringify(f);ctx.renderFutureRebuy(f);assert.equal(JSON.stringify(f),before);return els.futureRebuyPanel.innerHTML;};
  let html=draw(1401),cuts=html.slice(html.indexOf('id="frCuts"'),html.indexOf('id="frBuys"'));
  assert.match(cuts,/data-fcut="0"[^>]*aria-checked="mixed"/);assert.match(cuts,/data-fcut="1"/);
  assert.doesNotMatch(cuts,/<input[^>]*disabled/,'부분 손절과 새 회차 모두 입력 가능');
  assert.match(cuts,/재매수 후에도 회차 환율 이하로 다시 내려오면 남은 손절을 이어갑니다/);
  assert.doesNotMatch(html,/남은 손절 멈춤|남은 손절 회차는 멈췄습니다/);
  assert.match(html,/buy-track-chip muted">손절 대기/);assert.match(html,/다시 1,400원 이하면 손절 1회/);
  let s=ctx.futureRebuySummary(f);
  assert.match(ctx.futureRebuyFoldLine(f.rebuy,s,1401,true,null,null).text,/손절 대기 · 1,400원 이하/);
  html=draw(1400);assert.match(html,/buy-track-chip warn">손절 시점/,'재매수 복원이 끝나도 손절 도달을 우선 표시');
  assert.match(html,/<details[^>]*id="frCuts" open>/);
  assert.match(html,/손절 시점 · 1회 <b>1,400원<\/b> 1계약/);
  s=ctx.futureRebuySummary(f);assert.match(ctx.futureRebuyFoldLine(f.rebuy,s,1400,true,ctx.futureCutDue(s,1400),ctx.futureBuyDue(s,1400)).text,/^<b>손절 시점<\/b>/);
});

test('반등 단계별 재매수 표도 회차마다 한 줄로 그리고, 배분 없는 단계는 다른 단계 띠로 접는다',()=>{
  const ctx=load(),els={};
  const el=id=>els[id]||(els[id]={id,innerHTML:'',open:true,classList:{toggle(){}},setAttribute(){},querySelector:()=>({textContent:'',addEventListener(){}}),addEventListener(){}});
  Object.assign(ctx,{$:el,$$:()=>[],onEdit(){},esc:v=>String(v),money:v=>`${Math.round(v)}원`,shown:v=>String(v),PENCIL:'',priceData:null,decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),save(){},renderFutures(){},confirm:()=>true,alert:msg=>{throw Error(msg);}});
  vm.runInContext('futureRebuyExpanded=true',ctx);
  const f=futures({contracts:4,sellPct:100,steps:2,currentPrice:1385,stages:[{name:'25선',price:1380},{name:'32선',price:1390},{name:'42선',price:1500}]});
  ctx.setFutureCutChecked(f,0,true);ctx.setFutureCutChecked(f,1,true);
  const section=()=>{ctx.renderFutureRebuy(f);const html=els.futureRebuyPanel.innerHTML;return html.slice(html.indexOf('id="frBuys"'));};
  let html=section();
  assert.match(html,/<summary><h2>2\. 반등 단계별 재매수<\/h2><button[^>]*id="frBuyEdit"[^>]*>[^]*?<\/button><span>잔여 4계약 · 0 \/ \d+회<\/span><\/summary><section class="card table-card purchase-table sale-table future-rebuy-table hide-completed no-alert" id="frBuyTable"><div class="future-rebuy-start">[^]*?<\/div><div class="purchase-table-head"><span>회차<\/span><span>재매수 환율<\/span><span>계약<\/span><span>체결<\/span><span>상태<\/span><\/div>/);
  assert.match(html,/<b><span class="tr-name">25선<span class="tr-no">1<\/span><\/span><\/b>[^]*?<label class="future-tap-price" title="25선 기준 환율 수정"><span class="price" aria-hidden="true">1,380원<\/span><input data-fbuy-price="0"[^>]*value="1380"/,'단계 첫 회차 줄의 환율이 그 단계 기준 환율');
  assert.match(html,/id="toggleFutureStages"[^>]*><span>다른 단계 <b>\d+개<\/b> · 기준 환율<\/span>[^]*<div id="frStageRows" hidden>[^]*data-fbuy-price="2"/,'배분 없는 단계의 기준 환율은 다른 단계 띠 안에서 고친다');
  assert.match(html,/id="frTimeframes"/);assert.doesNotMatch(html,/sale-row|class="table-head"|25선→32선/,'회차마다 한 줄, 옛 줄 모양을 쓰지 않는다');
  const s=ctx.futureRebuySummary(f),tr=s.tranches.find(x=>x.amount>0);
  assert.equal(ctx.setFutureBuyChecked(f,tr.i,tr.t,true),true);
  html=section();
  assert.match(html,/<span>재매수 완료 <b>1회 · \d+계약<\/b> · 202612 반영<\/span>/,'반영한 월물은 완료 띠에 모은다');
  assert.match(html,new RegExp(`<label class="future-tap-price"[^>]*><span class="price" aria-hidden="true">[^<]+</span><input data-fbuy-exec="${tr.i}:${tr.t}"`),'산 회차는 체결 환율을 그 자리에서 고친다');
  assert.match(html,new RegExp(`data-fbuy-qty="${tr.i}:${tr.t}"`),'산 회차의 계약 수는 체결 칸');
});

test('손절 기준 창의 하단선은 신저점보다 먼저 적용하고, 하단선 대기·신저점 이상을 접힌 줄·보유 카드·기준 줄에 보인다',()=>{
  const ctx=load(),els={};
  const el=id=>els[id]||(els[id]={id,innerHTML:'',open:true,classList:{toggle(){}},setAttribute(){},querySelector:()=>({textContent:'',addEventListener(){}}),addEventListener(){}});
  Object.assign(ctx,{$:el,$$:()=>[],onEdit(){},esc:v=>String(v),money:v=>`${Math.round(v)}원`,shown:v=>String(v),PENCIL:'',priceData:null,decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),save(){},renderFutures(){},confirm:()=>true,alert:msg=>{throw Error(msg);}});
  const f=futures(),before=JSON.stringify(f);
  // 옛 직접 하단(1,300원)보다 낮은 신저점도 새 하단선과 함께면 저장된다(하단선이 하단 가격을 지우고 시세를 기다림).
  let g=ctx.applyFutureRebuyEdits(f,{floorLine:'60주선',lowPrice:'1280'});
  assert.deepEqual([g.rebuy.lowPrice,g.rebuy.floorLine,Object.hasOwn(g.rebuy,'floorPrice')],[1280,'60주선',false]);assert.equal(JSON.stringify(f),before);
  assert.equal(ctx.applyFutureRebuyEdits(f,{floorLine:'25선'}),null,'시선은 하단선으로 받지 않는다');
  g.rebuy.floorPrice=1250;g=ctx.applyFutureRebuyEdits(g,{floorLine:''});
  assert.deepEqual([Object.hasOwn(g.rebuy,'floorLine'),g.rebuy.floorPrice],[false,1250],'하단선을 끄면 마지막 하단을 직접 하단으로 남긴다');
  assert.match(ctx.futureRebuyEditError(f,{lowPrice:'1300',floorPrice:'1310',floorLine:'60주선',contracts:'4',sellPct:'',steps:'2'}),/^손절 하단 60주선\(1,310원\)이 신저점 환율 이상입니다/);
  // 화면: 하단선 시세 대기 → 신저점 이상 → 정상
  const line=futures({floorLine:'60주선'});delete line.rebuy.floorPrice;
  const view=()=>{const s=ctx.futureRebuySummary(line);return {fold:ctx.futureRebuyFoldLine(line.rebuy,s,1410,false,null,null).text,card:ctx.futureRebuyTrack(line.rebuy,s,1410,'',x=>x),basis:(vm.runInContext('futureRebuyExpanded=true',ctx),ctx.renderFutureRebuy(line),els.futureRebuyPanel.innerHTML.match(/<span class="future-rebuy-basis">(.*?)<\/span><\/div>/)[1])};};
  let v=view();
  assert.equal(v.fold,'하단 60주선 시세 대기 · 펼쳐서 확인하세요');assert.match(v.card,/손절 하단 60주선의 시세를 기다립니다/);assert.match(v.basis,/^<span>하단 60주선 시세 대기 · 이탈 전 4계약/);
  line.rebuy.floorPrice=1405;v=view();
  assert.equal(v.fold,'하단 60주선이 신저점 이상 · 펼쳐서 확인하세요');assert.match(v.card,/손절 하단 60주선\(1,405원\)이 신저점 환율 이상이라/);
  line.rebuy.floorPrice=1310.46;line.rebuy.floorLine='20개월선';const kept=JSON.stringify(line);v=view();
  assert.equal(v.fold,'실행 전 · 1,400원 → 20월선 · 최대 2계약');assert.match(v.basis,/^<span class="quote-state">1,400원 → 20월선 1,310\.5원<\/span><span>이탈 전/);
  // 채운 뒤 그 선 시세가 빠지면 마지막 하단으로 회차를 이어 가고 기준 줄에만 알린다(시세 파일을 받기 전·직접 하단은 표시 안 함).
  const quote=ma=>({updatedAt:'2026-10-05T00:00:00Z',stocks:{},fx:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-05',close:1405,ma}}});
  const cuts=()=>ctx.futureRebuySummary(line).cuts.map(c=>[c.price,c.qty]),planned=cuts();
  assert.equal(ctx.futureFloorStale(line,line.rebuy),false,'시세 파일 전');
  ctx.priceData=quote({'20개월선':1310.46});v=view();
  assert.equal(ctx.futureFloorStale(line,line.rebuy),false);assert.doesNotMatch(v.basis,/시세 없음/);
  ctx.priceData=quote({});v=view();
  assert.equal(ctx.futureFloorStale(line,line.rebuy),true);
  assert.match(v.basis,/^<span class="quote-state">1,400원 → 20월선 1,310\.5원<\/span><span class="future-floor-stale">시세 없음 · 마지막 값<\/span><span>이탈 전 4계약/);
  assert.deepEqual(cuts(),planned,'손절 회차는 마지막 하단 그대로');
  ctx.priceData={...quote({}),futures:{}};assert.equal(ctx.futureFloorStale(line,line.rebuy),true,'보유 월물 시세가 없어도 같은 표시');
  const direct=futures();assert.equal(ctx.futureFloorStale(direct,direct.rebuy),false,'직접 하단');
  // 보유 근월물의 월봉이 12개뿐인데 20월선을 고르면(수집기가 150개월선까지 요청하고도 12개만 받음) 계산할 수 없다고 알리고 고를 수 있는 길이를 보인다
  const young=futures({floorLine:'20개월선'});delete young.rebuy.floorPrice;
  const quote12=ma=>({updatedAt:'2026-10-05T00:00:00Z',stocks:{},fx:{},futures:{'202612':{kind:'달러선물',asOf:'2026-10-05',close:1405,ma,closes:{M:Array(12).fill(1300)}}}});
  ctx.priceData=quote12({'150개월선':null});
  const fe=vm.runInContext('futuresEntry',ctx)(ctx.priceData,young),ys=ctx.futureRebuySummary(young);
  assert.deepEqual({...ctx.futureFloorShort(fe,'20개월선')},{have:12,max:'12월선'});assert.equal(ctx.futureFloorShort(fe,'12개월선'),null,'12월선은 계산 가능');
  assert.equal(ctx.futureRebuyFoldLine(young.rebuy,ys,1410,false,null,null,fe).text,'하단 20월선 계산 불가 · 12월선까지 · 펼쳐서 확인하세요');
  assert.match(ctx.futureRebuyTrack(young.rebuy,ys,1410,'',x=>x,fe),/보유 근월물은 봉이 12개뿐이라 손절 하단 20월선을 계산할 수 없습니다\. 제목 옆 연필에서 12월선 이하로/);
  ctx.priceData=quote12({'12개월선':1310});
  assert.equal(ctx.futureFloorShort(vm.runInContext('futuresEntry',ctx)(ctx.priceData,young),'20개월선'),null,'수집기가 그 길이까지 요청하지 않았으면(덜 받은 봉) 한계로 보지 않는다');
  ctx.priceData=quote12({'25개월선':null});
  assert.ok(ctx.futureFloorShort(vm.runInContext('futuresEntry',ctx)(ctx.priceData,young),'20개월선'));
  assert.equal(ctx.futureFloorShort(null,'20개월선'),null,'시세 파일 전');
  ctx.priceData=null;
  assert.equal(JSON.stringify(line),kept,'화면은 기록을 바꾸지 않는다');
});

test('손절로 보유를 모두 판 뒤 재매수 체크는 마지막 손절 월물(최종거래일부터 다음 월물)에 넣는다',()=>{
  for(const [updatedAt,month] of [[null,'202612'],['2026-12-21T00:00:00Z','202701']]){
    const ctx=load(),f=futures({sellPct:100,steps:1,currentPrice:1320});
    if(updatedAt)ctx.priceData={updatedAt};
    assert.equal(ctx.setFutureCutChecked(f,0,true),true);assert.equal(f.positions.length,0,'손절로 보유를 모두 판다');
    assert.equal(ctx.setFutureBuyChecked(f,0,0,true),true);
    assert.deepEqual(JSON.parse(JSON.stringify(f.positions)),[{month,contracts:4,settlementPrice:1320}]);
  }
});

test('여러 월물에서 판 손절은 줄이면 마지막에 판 월물부터, 해제하면 월물마다 판 시점 평균가로 되돌린다',()=>{
  const ctx=load(),f=futures({contracts:4,sellPct:100,steps:1});
  f.positions=[{month:'202611',contracts:1,settlementPrice:1440},{month:'202612',contracts:3,settlementPrice:1450}];
  const orig=JSON.stringify({p:f.positions,b:f.baselinePnl}),plain=v=>JSON.parse(JSON.stringify(v));
  assert.equal(ctx.setFutureCutCount(f,0,'1'),true);assert.equal(f.rebuy.cuts[0].month,'202611','가장 가까운 월물부터');
  assert.notEqual(ctx.setFutureCutCount(f,0,'3'),false);
  let rec=f.rebuy.cuts[0];
  assert.deepEqual(plain(rec.legs),[{month:'202611',contracts:1,settlementPrice:1440},{month:'202612',contracts:2,settlementPrice:1450}]);
  assert.deepEqual([rec.month,Math.round(rec.settlementPrice*100)/100],['202612',1446.67],'월물은 마지막에 판 월물, 평균가는 계약 가중평균');
  assert.deepEqual(plain(f.positions),[{month:'202612',contracts:1,settlementPrice:1450}]);
  assert.equal(Math.round(f.baselinePnl),Math.round(50000+((1300-1440)*1+(1300-1450)*2)*10000));
  // 2계약으로 줄이면 마지막에 판 202612에서 1계약을 그 평균가로 되돌린다.
  assert.notEqual(ctx.setFutureCutCount(f,0,'2'),false);rec=f.rebuy.cuts[0];
  assert.deepEqual(plain(f.positions),[{month:'202612',contracts:2,settlementPrice:1450}]);
  assert.deepEqual(plain(rec.legs),[{month:'202611',contracts:1,settlementPrice:1440},{month:'202612',contracts:1,settlementPrice:1450}]);
  // 1계약으로 줄이면 한 월물만 남아 legs를 지운다.
  assert.notEqual(ctx.setFutureCutCount(f,0,'1'),false);rec=f.rebuy.cuts[0];
  assert.deepEqual([rec.month,rec.settlementPrice,Object.hasOwn(rec,'legs')],['202611',1440,false]);
  assert.notEqual(ctx.setFutureCutCount(f,0,'3'),false);
  assert.equal(ctx.setFutureCutChecked(f,0,false),undefined);
  assert.equal(JSON.stringify({p:f.positions,b:f.baselinePnl}),orig,'해제하면 처음 보유·누적 정산손익 그대로');
});

test('달러선물 재매수 체결 수를 줄이면 부분 체결로 남은 계약을 그 회차에 두고 보유도 체결한 계약만큼만 반영한다',()=>{
  const ctx=load(),plain=v=>JSON.parse(JSON.stringify(v)),r=v=>Math.round(v*10)/10;
  const stages=vm.runInContext('MA_LINES',ctx).map(name=>({name,price:{'25선':1330,'32선':1340}[name]||0,done:false,execPrice:null,shares:null}));
  let f=futures({contracts:8,sellPct:50,steps:1,stages,currentPrice:1325,notify:{buys:true}});f.positions=[{month:'202612',contracts:8,settlementPrice:1450}];
  assert.equal(ctx.setFutureCutChecked(f,0,true),true);
  f=ctx.futureRebuyWithStart(f,'25선',null,'1335');
  const held=()=>f.positions.reduce((n,p)=>n+p.contracts,0),open=()=>plain(ctx.futureRebuySummary(f).tranches.filter(x=>!x.done&&x.amount>0).map(x=>[r(x.price),x.amount,!!x.partial]));
  assert.equal(held(),4);assert.deepEqual(open(),[[1330,1,false],[1333.3,2,false],[1335,1,false]]);
  const x=ctx.futureRebuySummary(f).tranches.find(y=>r(y.price)===1333.3);
  assert.equal(ctx.setFutureBuyChecked(f,x.i,x.t,true),true);assert.equal(held(),6);
  // 실제로 1계약만 샀으면 체결 칸을 1로: 남은 1계약은 같은 회차에 부분 체결로 남고 알림도 이어진다.
  assert.notEqual(ctx.setFutureBuyCount(f,x.i,x.t,'1'),false);assert.equal(held(),5);
  const rec=f.rebuy.stages[x.i].buys[x.t];assert.deepEqual([rec.contracts,rec.partial,rec.plannedQty],[1,true,2]);
  assert.deepEqual(open(),[[1330,1,false],[1333.3,1,true],[1335,1,false]],'다른 회차 배분은 그대로');
  const part=ctx.futureRebuySummary(f).tranches.find(y=>y.partial);assert.ok(part.amount>0&&!part.est&&part.price>0,'알림 대상 조건(trade-alerts.js tradeTranchesToSend)을 유지한다');
  // 체크하면 남은 계약까지 채우고 보유에는 더한 1계약만 넣는다.
  assert.equal(ctx.setFutureBuyChecked(f,x.i,x.t,true),true);assert.equal(held(),6);
  assert.deepEqual([rec.contracts,Object.hasOwn(rec,'partial'),Object.hasOwn(rec,'plannedQty')],[2,false,false]);
  // 다시 줄였다가 해제하면 체결한 계약만 보유에서 뺀다.
  assert.notEqual(ctx.setFutureBuyCount(f,x.i,x.t,'1'),false);assert.equal(held(),5);
  assert.notEqual(ctx.setFutureBuyChecked(f,x.i,x.t,false),false);assert.equal(held(),4);
  assert.equal(f.rebuy.stages[x.i].buys,undefined);
  assert.deepEqual(open(),[[1330,1,false],[1333.3,2,false],[1335,1,false]],'해제하면 처음 계획으로');
});

test('재매수 표의 부분 체결 회차는 손절 표처럼 체크 −·남은 계약·부분 체결로 보인다',()=>{
  const ctx=load(),els={};
  const el=id=>els[id]||(els[id]={id,innerHTML:'',open:true,classList:{toggle(){}},setAttribute(){},querySelector:()=>({textContent:'',addEventListener(){}}),addEventListener(){}});
  Object.assign(ctx,{$:el,$$:()=>[],onEdit(){},esc:v=>String(v),money:v=>`${Math.round(v)}원`,shown:v=>String(v),PENCIL:'',priceData:null,decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),save(){},renderFutures(){},confirm:()=>true,alert:msg=>{throw Error(msg);}});
  vm.runInContext('futureRebuyExpanded=true',ctx);
  const stages=vm.runInContext('MA_LINES',ctx).map(name=>({name,price:{'25선':1330,'32선':1340}[name]||0,done:false,execPrice:null,shares:null}));
  let f=futures({contracts:8,sellPct:50,steps:1,stages,currentPrice:1325});f.positions=[{month:'202612',contracts:8,settlementPrice:1450}];
  ctx.setFutureCutChecked(f,0,true);f=ctx.futureRebuyWithStart(f,'25선',null,'1335');
  const x=ctx.futureRebuySummary(f).tranches.find(y=>Math.round(y.price*10)===13333);
  ctx.setFutureBuyChecked(f,x.i,x.t,true);ctx.setFutureBuyCount(f,x.i,x.t,'1');
  ctx.renderFutureRebuy(f);const html=els.futureRebuyPanel.innerHTML;
  assert.match(html,new RegExp(`<div class="purchase-row partial">[^]*data-fbuy="${x.i}:${x.t}" data-fbuy-partial="true" aria-checked="mixed"[^]*<small>남은 1</small>[^]*<div class="purchase-qty">2계약</div>[^]*data-fbuy-qty="${x.i}:${x.t}" value="1"[^]*<div class="status partial">부분 체결</div>`));
  assert.match(html,new RegExp(`data-fbuy-exec="${x.i}:${x.t}"`),'산 계약의 체결 환율은 그 자리에서 고친다');
});
