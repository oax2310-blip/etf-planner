const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 분할매도 계획 진행 카드(plans.js planTrackCard). 가짜 종목·가격·수량만 사용한다.
const read=f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8');
const today=new Date().toISOString().slice(0,10);
const quote=close=>({updatedAt:new Date().toISOString(),stocks:{AAA:{kind:'해외',asOf:today,close,ma:{}}},futures:{}});
function draw(plan,prices){
  const els={};
  const el=id=>els[id]??={id,value:'',dataset:{},style:{},innerHTML:'',textContent:'',events:{},addEventListener(kind,handler){this.events[kind]=handler;},
    setCustomValidity(){},querySelectorAll:()=>[],querySelector:()=>el('inner'),classList:{toggle(){}},close(){},showModal(){},focus(){},append(){}};
  el('planForm').elements={};
  const ctx=vm.createContext({$:el,$$:()=>[],addEventListener(){},save(){},render(){},onEdit(){},alert(){},
    document:{createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:0})}),createElement:()=>({value:'',dataset:{},setAttribute(){},append(){},focus(){}})},
    state:{plans:[plan],futures:{positions:[]},selectedPlan:plan.id},PENCIL:'✎',memoCount:()=>'',id:()=>'p1',
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),usd:new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
    priceText:(v,c)=>c==='USD'?`$${v}`:`${v}원`,fxText:v=>`≈₩${v}`,
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),priceData:prices});
  for(const f of ['ma-ladder.js','prices.js','assets-calc.js','stock-names.js','item-search.js','rebuy.js','trade-alerts.js','plans.js'])vm.runInContext(read(f),ctx);
  const before=JSON.stringify(ctx.state);ctx.renderPlans();
  assert.equal(JSON.stringify(ctx.state),before,'화면을 그려도 기록은 바뀌지 않는다');
  const html=els.planMain.innerHTML,card=html.match(/<section class="card buy-track sale-track"[\s\S]*?<\/section>/)?.[0]||'';
  return {html,card,cells:(card.match(/<div class="buy-track-cells[\s\S]*?<\/div>/)?.[0]||'').replace(/<em[\s\S]*?<\/em>/g,'|').match(/<i class="[^"]*"|\|/g)?.map(x=>x==='|'?'now':x.slice(10,-1))||[]};
}
// 회차 기준가 500·475·450·425·400(하락 매도), 회차마다 2주
const plan=(extra={})=>({id:'p1',ticker:'AAA',title:'가상 ETF',currency:'USD',startLabel:'60일선',endLabel:'25개월선',startPrice:500,endPrice:400,stages:5,checked:[false,false,false,false,false],holdings:[{name:'가상 ETF',shares:10}],note:'',fx:1300,...extra});

test('시작 전에는 띠가 모두 차 있고 현재가 이름표가 다음 1회 칸 앞에 붙는다',()=>{
  const {html,card,cells}=draw(plan({notify:{start:true}}),quote(520));
  assert.doesNotMatch(html,/class="metrics card"/,'옛 세 칸 상태 카드는 없앤다');
  assert.deepEqual(cells,['now','next','hold','hold','hold','hold']);
  assert.match(card,/<em class="buy-track-now left"><span>현재 <b>\$520<\/b><\/span><\/em>/);
  assert.match(card,/<span class="buy-track-chip">시작 전<\/span><\/div><div class="buy-track-count"><b>0<\/b><span>\/ 5회<\/span><\/div>/);
  assert.match(card,/<div class="buy-track-end"><b><label class="metric-edit"[^>]*>\$<input id="startPrice"[^>]*value="500\.00"[^>]*>✎<\/label><\/b><small>60일선<\/small><small>≈₩650000<\/small><\/div>/,'왼쪽 끝 첫 매도 기준가는 카드에서 바로 고친다');
  assert.match(card,/<div class="buy-track-end r"><b>\$400<\/b><small>25월선<\/small><small>≈₩520000<\/small><\/div>/);
  assert.match(card,/<p class="sale-track-sub" title="남은 10주 × 현재가 \$520 × 환율 1300">10주 보유 · 평가액 ₩676만원<\/p>/);
  assert.match(card,/<span class="next">다음 1회 <b>\$500<\/b><em class="down">-3\.8%<\/em><\/span>/);
  assert.match(card,/<input id="planFx"[^>]*value="1300">/);
  assert.match(card,/<input type="checkbox" data-sale-alert="0"\s+checked[^>]*><span>첫 매도 알림 ON<\/span>/,'첫 매도 알림 스위치는 맨 아래 줄');
});

test('판 회차는 빈 칸, 부분 체결은 남은 비율만큼 채우고 도달 회차를 따로 센다',()=>{
  const fills={0:{price:500,plannedQty:2,qty:2},1:{price:475,plannedQty:2,qty:1}},checked=[true,false,false,false,false];
  const wait=draw(plan({fills,checked}),quote(460));
  assert.deepEqual(wait.cells,['sold','partial','now','next','hold','hold']);
  assert.match(wait.card,/<i class="partial" style="--left:50%"><\/i>/);
  assert.match(wait.card,/진행 중<\/span><span class="buy-track-chip warn">부분 체결 1회<\/span>/);
  assert.match(wait.card,/<p class="buy-track-note">2회 부분 체결 · 1주 매도, 1주 남음<\/p>/);
  assert.match(wait.card,/<span class="sold">매도 1<\/span><span class="partial">부분 1<\/span><span class="next">다음 3회 <b>\$450<\/b><em class="down">-2\.2%<\/em><\/span>/);
  assert.match(wait.card,/<p class="sale-track-sub"[^>]*>매도 3주 · 남은 7주 · 평가액 ₩419만원<\/p>/);
  const due=draw(plan({fills,checked}),quote(440));
  assert.deepEqual(due.cells,['sold','partial','due','now','next','hold']);
  assert.match(due.card,/<span class="buy-track-chip warn">도달 1회<\/span><span class="buy-track-chip warn">부분 체결 1회<\/span>/);
  assert.match(due.card,/<span class="due">도달 1<\/span><span class="next">다음 4회 <b>\$425<\/b><em class="down">-3\.4%<\/em>/);
  assert.match(due.card,/<span>첫 매도 완료<\/span>/,'첫 매도 회차가 끝나면 알림 스위치는 완료 표시');
});

test('오르며 파는 계획은 현재가 이상을 도달로 보고 모두 팔면 이름표가 띠 끝으로 간다',()=>{
  const up=draw(plan({startPrice:80,endPrice:100}),quote(85));
  assert.deepEqual(up.cells,['due','due','now','next','hold','hold']);
  assert.match(up.card,/다음 3회 <b>\$90<\/b><em class="up">\+5\.9%<\/em>/);
  const done=draw(plan({checked:[true,true,true,true,true]}),quote(390));
  assert.deepEqual(done.cells,['sold','sold','sold','sold','sold','now']);
  assert.match(done.card,/<em class="buy-track-now right">/);
  assert.match(done.card,/<span class="buy-track-chip done">전량 매도 완료<\/span>/);
  assert.doesNotMatch(done.card,/class="next"/);
});

test('시세·기준가가 없으면 이름표·다음 회차 없이 칸만 보이고 회차가 많으면 칸 사이를 좁힌다',()=>{
  const none=draw(plan(),null);
  assert.deepEqual(none.cells,['hold','hold','hold','hold','hold']);
  assert.doesNotMatch(none.card,/with-now|buy-track-legend/);
  const wait=draw(plan({startPrice:0}),quote(520));
  assert.match(wait.card,/<span class="buy-track-chip muted">기준가 대기<\/span>/);
  assert.match(wait.card,/<input id="startPrice"[^>]*placeholder="대기" value=""/);
  assert.doesNotMatch(wait.card,/buy-track-now/);
  assert.match(draw(plan({stages:61,checked:Array(61).fill(false)}),quote(520)).card,/buy-track-cells with-now dense"/);
  assert.match(draw(plan({stages:121,checked:Array(121).fill(false)}),quote(520)).card,/buy-track-cells with-now tight"/);
});

test('원화 계획은 원화 환산·환율 칸 없이 알림만 맨 아래 줄에 둔다',()=>{
  const {card}=draw(plan({currency:'KRW',ticker:'069500',startPrice:50000,endPrice:40000,startLabel:'직접'}),{updatedAt:new Date().toISOString(),stocks:{'069500':{kind:'국내',asOf:today,close:52000,ma:{}}},futures:{}});
  assert.match(card,/<input id="startPrice"[^>]*value="50000"[^>]*>원✎<\/label><\/b><small>첫 매도<\/small><\/div>/,'시작선이 이동평균이 아니면 첫 매도로 표시');
  assert.doesNotMatch(card,/planFx|≈₩/);
  assert.match(card,/<div class="buy-wait-alert sale-track-foot"><span><\/span><label class="trade-alert-toggle"/);
});
