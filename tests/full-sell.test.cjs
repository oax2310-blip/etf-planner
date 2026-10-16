const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 분할매도 '전액매도 시점': 직접 입력한 기준가에 현재가가 닿았는지만 알린다. 가짜 종목·가격만 사용한다.
const read=f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
function load({prices,allocation}={}){
  const els={},handlers={};
  const el=id=>els[id]??={id,value:'',dataset:{},style:{},innerHTML:'',textContent:'',onclick:null,onchange:null,addEventListener(){},querySelectorAll:()=>[],querySelector:()=>el('inner'),classList:{toggle(){}},close(){},showModal(){},focus(){}};
  const ctx=vm.createContext({$:el,$$:()=>[],addEventListener(){},save(){ctx.saves=(ctx.saves||0)+1;},render(){},onEdit:(sel,set)=>{handlers[sel]=set;},
    document:{createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:0})})},
    state:{plans:[],futures:{positions:[]},selectedPlan:null},PENCIL:'',memoCount:()=>'',id:()=>'id',
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),usd:new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
    priceText:(v,c)=>c==='USD'?`$${v}`:`${v}원`,fxText:v=>String(v),
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    priceData:prices??null,
    ...(allocation?{assetStore:{doc:{allocation},prices:prices??null,subscribe(){}}}:{})});
  for(const f of ['ma-ladder.js','prices.js','assets-calc.js','rebuy.js','trade-alerts.js','plans.js'])vm.runInContext(read(f),ctx);
  return {ctx,els,handlers};
}
const quote=(close,extra={})=>({updatedAt:'2026-10-15T01:00:00Z',stocks:{AAA:{kind:'해외',asOf:'2026-10-15',close,ma:{},...extra}},futures:{}});
const plan=(extra={})=>({id:'p1',ticker:'AAA',title:'테스트 ETF',currency:'USD',startLabel:'직접',endLabel:'25개월선',startPrice:100,endPrice:80,stages:3,checked:[false,false,false],holdings:[{name:'테스트 ETF',shares:9}],note:'',fx:1300,...extra});
function draw(p,prices){
  const t=load({prices});t.ctx.state.plans=[p];t.ctx.state.selectedPlan=p.id;
  const before=JSON.stringify(t.ctx.state);t.ctx.renderPlans();
  assert.equal(JSON.stringify(t.ctx.state),before,'화면을 그려도 기록은 바뀌지 않는다');
  return {...t,main:t.els.planMain.innerHTML,list:t.els.planList.innerHTML};
}

test('기준가를 입력하지 않으면 입력 필요로만 보이고 기록·알림이 생기지 않는다',()=>{
  const p=plan(),{main,list,ctx}=draw(p,quote(70));
  assert.match(main,/id="fullSellCard"/);assert.match(main,/입력 필요/);assert.match(main,/기준가를 직접 입력하세요/);
  assert.doesNotMatch(main,/sale-row[^"]*due/);assert.doesNotMatch(list,/plan-count due/);
  assert.equal('fullSell' in p,false);assert.equal('notify' in p,false);
  assert.deepEqual(plain(ctx.buildTradeAlertRules({plans:[p]},quote(70))),[]);
});

test('입력은 기준가·조건만 저장하고 비우면 지우며 잘못된 값은 거절한다',()=>{
  const p=plan(),{handlers,ctx}=draw(p,quote(90));
  assert.equal(handlers['#fullSellPrice']('80'),undefined);assert.deepEqual(plain(p.fullSell),{price:80});
  assert.equal(handlers['#fullSellCondition']('up'),undefined);assert.deepEqual(plain(p.fullSell),{price:80,condition:'up'});
  assert.equal(handlers['#fullSellCondition']('down'),undefined);assert.deepEqual(plain(p.fullSell),{price:80},'기본 조건(이하)은 저장하지 않는다');
  for(const bad of ['-1','abc','NaN'])assert.equal(handlers['#fullSellPrice'](bad),false);
  assert.equal(handlers['#fullSellCondition']('sideways'),false);assert.deepEqual(plain(p.fullSell),{price:80});
  assert.equal(handlers['#fullSellPrice'](''),undefined);assert.equal('fullSell' in p,false);
  assert.equal(handlers['#fullSellCondition']('up'),false,'기준가가 없으면 조건만 저장하지 않는다');assert.equal('fullSell' in p,false);
  assert.deepEqual(plain(p.holdings),[{name:'테스트 ETF',shares:9}]);assert.deepEqual(plain(p.checked),[false,false,false]);
  assert.equal(ctx.saves||0,0,'입력 처리는 저장을 부르지 않고 onEdit 래퍼가 저장한다');
});

test('현재가가 기준가 이하(또는 이상)이면 재매수와 같은 시점 행·상태로 보여 준다',()=>{
  const due=draw(plan({fullSell:{price:80}}),quote(75));
  assert.match(due.main,/class="sale-row due"/);assert.match(due.main,/class="status due">전액매도 시점</);assert.match(due.main,/full-sell-due/);
  assert.match(due.list,/plan-count due/);assert.match(due.list,/전액매도 시점/);
  const wait=draw(plan({fullSell:{price:80}}),quote(85));
  assert.doesNotMatch(wait.main,/class="sale-row due"/);assert.match(wait.main,/class="status">대기</);assert.doesNotMatch(wait.list,/plan-count due/);
  const edge=draw(plan({fullSell:{price:80}}),quote(80));assert.match(edge.main,/class="status due">전액매도 시점</);
  const up=draw(plan({fullSell:{price:80,condition:'up'}}),quote(85));assert.match(up.main,/class="status due">전액매도 시점</);
  const upWait=draw(plan({fullSell:{price:80,condition:'up'}}),quote(75));assert.match(upWait.main,/class="status">대기</);
});

test('시세가 없거나 지난 시세이거나 모든 회차를 마친 계획은 시점으로 보지 않는다',()=>{
  assert.match(draw(plan({fullSell:{price:80}}),null).main,/class="status">시세 대기</);
  assert.match(draw(plan({fullSell:{price:80}}),quote(70,{stale:true})).main,/class="status">지난 시세</);
  assert.match(draw(plan({fullSell:{price:80}}),quote(70,{asOf:'2026-09-01'})).main,/class="status">지난 시세</);
  const done=draw(plan({fullSell:{price:80},checked:[true,true,true]}),quote(70));
  assert.match(done.main,/class="status">분할매도 완료</);assert.doesNotMatch(done.list,/plan-count due/);
  assert.match(draw(plan({fullSell:{price:80}}),{...quote(70),stocks:{AAA:{kind:'국내',asOf:'2026-10-15',close:70,ma:{}}}}).main,/class="status">시세 대기</,'통화가 다른 시세는 쓰지 않는다');
});

test('전액매도 알림은 따로 켜고 켠 계획만 직접 정한 기준가로 한 번 알린다',()=>{
  const {ctx}=load(),q=quote(120);
  const base=plan({notify:{start:true}}),withFull=plan({notify:{start:true,fullSell:true},fullSell:{price:80}});
  const baseRules=plain(ctx.buildTradeAlertRules({plans:[base]},q)),rules=plain(ctx.buildTradeAlertRules({plans:[withFull]},q));
  assert.deepEqual(rules.filter(r=>!r.id.endsWith(':full')),baseRules,'기존 분할매도 알림은 그대로다');
  const full=rules.find(r=>r.id==='trade:plan:p1:full');
  assert.deepEqual([full.label,full.targetPrice,full.condition,full.ticker,full.quoteKind,full.enabled],['분할매도 전액매도',80,'down','AAA','해외',true]);
  assert.match(full.revision,/80/);
  assert.equal(plain(ctx.buildTradeAlertRules({plans:[plan({notify:{fullSell:true},fullSell:{price:80,condition:'up'}})]},q)).find(r=>r.id.endsWith(':full')).condition,'up');
  // 켜지 않았거나 기준가가 없거나 모든 회차를 마친 계획, 다른 통화 시세는 알리지 않는다.
  for(const p of [plan({fullSell:{price:80}}),plan({notify:{fullSell:true}}),plan({notify:{fullSell:true},fullSell:{price:0}}),plan({notify:{fullSell:true},fullSell:{price:80},checked:[true,true,true]})])
    assert.equal(ctx.buildTradeAlertRules({plans:[p]},q).some(r=>r.id.endsWith(':full')),false);
  assert.equal(ctx.buildTradeAlertRules({plans:[withFull]},{...q,stocks:{AAA:{kind:'국내',asOf:'2026-10-15',close:120,ma:{}}}}).length,0);
});

test('전액매도 알림 설정은 회차 알림·전체 ON/OFF와 독립이다',()=>{
  const {ctx}=load(),p=plan();
  ctx.setTradeFullSellAlert(p,true);assert.deepEqual(plain(p.notify),{fullSell:true});
  ctx.setTradePlanAll(p,false);assert.equal(p.notify.fullSell,true,'전체 OFF는 전액매도 알림을 건드리지 않는다');
  ctx.setTradePlanAlert(p,0,true);assert.equal(p.notify.fullSell,true);
  ctx.setTradeFullSellAlert(p,false);assert.equal(p.notify.start,true);assert.equal(p.notify.sales,false);
  assert.equal(ctx.tradePlanEnabled(p,0),true);
});

test('전액매도 알림 라벨은 수집 저장소 라벨 형식(분할매도 전액매도 추가본)을 따른다',()=>{
  const {ctx}=load();
  // 수집 저장소 ma_alerts.py TRADE_LABEL_RE의 분할매도 부분: 기존 '첫 매도|N회'에 '전액매도'를 더한 형식. 서버 반영 전에는 발송되지 않는다.
  const re=/^분할매도 (?:첫 매도|전액매도|[1-9]\d{0,2}회)$/;
  const rules=ctx.buildTradeAlertRules({plans:[plan({notify:{start:true,sales:true,fullSell:true},fullSell:{price:80}})]},quote(120));
  assert.ok(rules.length>=2);for(const r of rules)assert.match(r.label,re);
});

test('보유 종목은 분할매도와 같은 자산 배분 기록에서 읽기만 한다',()=>{
  const allocation={groups:[{id:'g1',name:'ISA',items:[{id:'i1',name:'가상 ETF A',ticker:'AAA',shares:10},{id:'i2',name:'가상 ETF B',ticker:'AAA',shares:4},{id:'i3',name:'다른 종목',ticker:'ZZZ',shares:3},{id:'i4',name:'빈 종목',ticker:'AAA',shares:0}]}]};
  const p=plan({fullSell:{price:80}}),t=load({prices:quote(70),allocation});
  t.ctx.state.plans=[p];t.ctx.state.selectedPlan=p.id;
  const docBefore=JSON.stringify(allocation),stateBefore=JSON.stringify(t.ctx.state);
  t.ctx.renderPlans();const html=t.els.planMain.innerHTML.slice(t.els.planMain.innerHTML.indexOf('id="fullSellCard"'),t.els.planMain.innerHTML.indexOf('분할매도 체크'));
  assert.match(html,/가상 ETF A/);assert.match(html,/가상 ETF B/);assert.match(html,/ISA/);
  assert.doesNotMatch(html,/다른 종목/);assert.doesNotMatch(html,/빈 종목/);
  assert.equal(JSON.stringify(allocation),docBefore);assert.equal(JSON.stringify(t.ctx.state),stateBefore);
  assert.doesNotMatch(html,/매도 수량|매도 비율|예상 매도|매도 금액/,'전액매도 수량·비율·금액은 계산하지 않는다');
  const none=draw(plan({fullSell:{price:80}}),quote(70));assert.match(none.main,/연결된 보유 종목이 없습니다|계획에 입력한 보유/);
});

test('기존 분할매도 회차·알림 화면은 전액매도 입력과 무관하게 그대로다',()=>{
  const bare=draw(plan(),quote(70)),full=draw(plan({fullSell:{price:80},notify:{fullSell:true}}),quote(70));
  const rows=html=>html.slice(html.indexOf('<div class="section-heading"><h2>분할매도 체크'));
  assert.equal(rows(full.main),rows(bare.main),'회차 목록·알림 버튼 영역이 같다');
  const head=html=>html.slice(0,html.indexOf('<div class="section-heading"><h2>전액매도 시점'));
  assert.equal(head(full.main),head(bare.main));
  assert.match(bare.main,/data-sale-alert="0"/);assert.match(bare.main,/data-sale-alert-all="on"/);
});

test('불러오기·동기화 검증은 전액매도 기록의 타입을 확인하고 옛 기록은 그대로 받는다',()=>{
  const ctx=vm.createContext({});vm.runInContext(read('data-validation.js')+';this.externalData=externalData;',ctx);
  const data=extra=>({plans:[{id:'p',ticker:'AAA',stages:3,checked:[false,false,false],holdings:[],...extra}],futures:{positions:[]}});
  assert.doesNotThrow(()=>ctx.externalData.planner(data({})));
  assert.doesNotThrow(()=>ctx.externalData.planner(data({fullSell:{price:80,condition:'up'},notify:{fullSell:true}})));
  assert.doesNotThrow(()=>ctx.externalData.planner(data({fullSell:{price:'80'}})));
  for(const bad of [{fullSell:{price:'abc'}},{fullSell:{price:-1}},{fullSell:[80]},{fullSell:{price:80,condition:5}},{fullSell:'80'}])
    assert.throws(()=>ctx.externalData.planner(data(bad)),/기록 형식/);
});
