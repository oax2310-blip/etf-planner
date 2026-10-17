const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 종료 기준선 없는 전액매도(시작 기준가부터 N% 하락까지 보유 전량 분할매도). 가짜 종목·가격·수량만 사용한다.
const read=f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const today=new Date().toISOString().slice(0,10);
const quote=(close,extra={})=>({updatedAt:new Date().toISOString(),stocks:{AAA:{kind:'해외',asOf:today,close,ma:{'25개월선':300,'60일선':450},...extra}},futures:{}});
function load({prices=null,allocation=null}={}){
  const els={},handlers={};
  const el=id=>els[id]??={id,value:'',dataset:{},style:{},innerHTML:'',textContent:'',readOnly:false,disabled:false,events:{},validityMessage:'',
    addEventListener(kind,handler){this.events[kind]=handler;},setCustomValidity(m){this.validityMessage=m;},querySelectorAll:()=>[],querySelector:()=>el('inner'),classList:{toggle(){}},close(){},showModal(){},focus(){},append(){}};
  const defaults={ticker:'',title:'',cardName:'',currency:'USD',shares:'',fx:'1300',startUnit:'',startN:'60',startLabel:'60일선',startPrice:'',endN:'25',endUnit:'개월선',endPrice:'',stages:'30',salePct:'100',valueKrw:''};
  const fields=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,Object.assign(el('field:'+k),{name:k,value:v})]));
  const form=el('planForm');form.elements=fields;
  form.reportValidity=()=>Object.values(fields).every(f=>!f.validityMessage&&(!f.required||f.disabled||f.readOnly||String(f.value??'')!==''));
  form.reset=()=>{for(const [k,v] of Object.entries(defaults))fields[k].value=v;};
  const ctx=vm.createContext({$:el,$$:()=>[],addEventListener(){},save(){},render(){},onEdit:(sel,set)=>{handlers[sel]=set;},alert(){},
    document:{createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:0})}),createElement:()=>({value:'',dataset:{},setAttribute(){},append(){},focus(){}})},
    state:{plans:[],futures:{positions:[]},selectedPlan:null},PENCIL:'',memoCount:()=>'',id:()=>'p1',
    won:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}),decimal:new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}),usd:new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
    priceText:(v,c)=>c==='USD'?`$${v}`:`${v}원`,fxText:v=>String(v),
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    FormData:class{constructor(f){this.fields=f.elements;}get(k){return this.fields[k]?.disabled?null:this.fields[k]?.value;}},
    priceData:prices,...(allocation?{assetStore:{doc:{allocation},prices,subscribe(){}}}:{})});
  for(const f of ['ma-ladder.js','prices.js','assets-calc.js','stock-names.js','item-search.js','rebuy.js','trade-alerts.js','plans.js'])vm.runInContext(read(f),ctx);
  const submit=()=>{ctx.planLive();form.events.submit({target:form,preventDefault(){}});};
  const input=name=>form.events.input({target:Object.assign(fields[name],{form})});
  return {ctx,els,handlers,fields,submit,input};
}
const pctPlan=(extra={})=>({id:'p1',ticker:'AAA',title:'가상 ETF',currency:'USD',startLabel:'직접',endLabel:'시작가 −20%',endPct:20,startPrice:500,endPrice:400,stages:5,checked:[false,false,false,false,false],holdings:[{name:'가상 ETF',shares:10}],note:'',fx:1300,...extra});
const maPlan=(extra={})=>({id:'p2',ticker:'AAA',title:'가상 ETF',currency:'USD',startLabel:'직접',endLabel:'25개월선',startPrice:500,endPrice:400,stages:5,checked:[false,false,false,false,false],holdings:[{name:'가상 ETF',shares:10}],note:'',fx:1300,...extra});
function draw(plans,prices){
  const t=load({prices});t.ctx.state.plans=plans;t.ctx.state.selectedPlan=plans[0].id;
  const before=JSON.stringify(t.ctx.state);t.ctx.renderPlans();
  assert.equal(JSON.stringify(t.ctx.state),before,'화면을 그려도 기록은 바뀌지 않는다');
  return {...t,main:t.els.planMain.innerHTML,list:t.els.planList.innerHTML};
}

test('% 하락으로 만든 계획은 시작 기준가에서 하락률만큼 내린 종료가까지 보유 전량을 나눠 판다',()=>{
  const {ctx,fields,submit}=load({prices:quote(520)});
fields.ticker.value='AAA';fields.title.value='가상 ETF';fields.shares.value='10';fields.startPrice.value='500';fields.stages.value='5';
  fields.endUnit.value='pct';fields.endN.value='20';fields.salePct.value='50';ctx.planLive();
  assert.equal(fields.endPrice.value,400);assert.equal(fields.endPrice.readOnly,true);assert.equal(fields.salePct.value,'100');assert.equal(fields.salePct.readOnly,true);
  assert.equal(fields.startUnit.disabled,true);assert.equal(ctx.$('endNote').textContent,'시작 기준가 −20% 자동');
  submit();const p=ctx.state.plans[0];
  assert.deepEqual([p.endPct,p.startPrice,p.endPrice,p.endLabel,'salePct' in p,'startAuto' in p],[20,500,400,'시작가 −20%',false,false]);
  const stagePrice=vm.runInContext('stagePrice',ctx),planSalePct=vm.runInContext('planSalePct',ctx);
  assert.deepEqual(Array.from({length:5},(_,i)=>stagePrice(p,i)),[500,475,450,425,400]);
  assert.equal(p.holdings[0].shares,10);assert.equal(planSalePct(p),100);
  assert.equal(ctx.fillPrices({plans:[p]},quote(520)),false,'이동평균 시세가 종료 기준가를 덮어쓰지 않는다');assert.equal(p.endPrice,400);
});

test('하락률 계획은 시작을 직접 입력으로 고정하고 잘못된 하락률은 저장하지 않으며 수정 창을 다시 열면 그대로 보인다',()=>{
  const {ctx,fields,submit}=load({prices:quote(520)});
  fields.ticker.value='AAA';fields.title.value='가상 ETF';fields.shares.value='10';fields.startUnit.value='일선';fields.startPrice.value='';
  fields.endUnit.value='pct';fields.endN.value='100';ctx.planLive();
  assert.equal(fields.startUnit.value,'');assert.equal(fields.startUnit.disabled,true);assert.equal(fields.startLabel.hidden,false);
  submit();assert.equal(ctx.state.plans.length,0,'시작 기준가가 없거나 하락률이 100%면 저장하지 않는다');
  fields.startPrice.value='500';fields.endN.value='0';submit();assert.equal(ctx.state.plans.length,0);
  fields.endN.value='12.5';submit();const p=ctx.state.plans[0];assert.equal(p.endPct,12.5);assert.equal(p.endPrice,437.5);assert.equal(p.endLabel,'시작가 −12.5%');
  ctx.openPlanDialog(p);assert.equal(fields.endUnit.value,'pct');assert.equal(Number(fields.endN.value),12.5);assert.equal(fields.endPrice.value,437.5);
  // 기준선으로 되돌리면 하락률 필드를 지우고 기존처럼 이동평균으로 종료 기준가를 채운다.
  fields.endUnit.value='개월선';fields.endN.value='25';ctx.planLive(['end']);assert.equal(fields.startUnit.disabled,false);assert.equal(fields.endPrice.readOnly,false);
  submit();assert.equal('endPct' in p,false);assert.equal(p.endLabel,'25개월선');assert.equal(p.endPrice,300);
});

test('전액 매도 표식은 종료 기준선 없는 계획에만 손절 도달 기준과 같은 한 줄로 보이고 기존 기준선 계획 화면은 그대로다',()=>{
  const ma=draw([maPlan()],quote(450));
  assert.doesNotMatch(ma.main,/fullSellMark|전액 매도|전액매도 시점/);assert.doesNotMatch(ma.list,/plan-count due/);
  assert.match(ma.main,/<p class="quote-line"><strong class="quote-now">\$450<\/strong><span class="quote-state">직접 이탈 후 25개월선까지<\/span><span class="quote-round">5회 분할매도<\/span><\/p>/,'현재가가 공통 시세 줄 맨 앞');
  const pct=draw([pctPlan()],quote(520));
  assert.match(pct.main,/<p class="quote-line"><strong class="quote-now">\$520<\/strong><span class="quote-state">시작 기준가부터 20% 하락까지<\/span><span class="quote-round">보유 전량 5회 분할매도<\/span><\/p>/);
  assert.match(pct.main,/<div class="cut-milestones full-sell-mark" id="fullSellMark"><dl><div><dt>전액 매도<small>100%<\/small><\/dt><dd><strong>−20% · \$400<\/strong><small>시작 \$500 · 5회 분할 · <span class="full-sell-state">대기<\/span><\/small><\/dd><\/div><\/dl><\/div><\/section>/);
  assert.doesNotMatch(pct.main,/fullSellCard|sale-row due/,'큰 카드·강조 행은 만들지 않는다');
  // 기준선 계획과 하락률 계획의 회차 목록은 같은 가격·수량이면 같은 HTML이다.
  const rows=html=>html.slice(html.indexOf('<div class="section-heading"><h2>분할매도 체크'));
  assert.equal(rows(draw([pctPlan()],quote(450)).main),rows(draw([maPlan({id:'p1'})],quote(450)).main));
});

test('현재가가 시작 기준가 이하이면 표식에 전액매도 시점, 종료가 이하이면 하락 끝 도달로 보인다',()=>{
  const due=draw([pctPlan(),maPlan()],quote(480));
  assert.match(due.main,/<div class="due"><dt>전액 매도/);assert.match(due.main,/<span class="full-sell-state due">전액매도 시점<\/span>/);
  assert.match(due.list,/plan-count due/);assert.equal((due.list.match(/plan-count due/g)||[]).length,1,'기준선 계획 카드는 표시하지 않는다');
  assert.match(draw([pctPlan()],quote(500)).main,/full-sell-state due">전액매도 시점</);
  assert.match(draw([pctPlan()],quote(390)).main,/full-sell-state due">하락 끝 도달</);
  assert.match(draw([pctPlan()],null).main,/full-sell-state">시세 대기</);
  assert.match(draw([pctPlan()],quote(450,{stale:true})).main,/full-sell-state">지난 시세</);
  assert.match(draw([pctPlan()],quote(450,{asOf:'2020-01-01'})).main,/full-sell-state">지난 시세</);
  const done=draw([pctPlan({checked:[true,true,true,true,true]})],quote(450));assert.match(done.main,/full-sell-state">전액매도 완료</);assert.doesNotMatch(done.list,/plan-count due/);
});

test('카드의 시작 기준가 수정은 종료가를 다시 계산하고 알림은 기존 첫 매도·회차 라벨을 쓴다',()=>{
  const p=pctPlan(),t=draw([p],quote(520));
  t.handlers['#startPrice']('600');assert.equal(p.startPrice,600);assert.equal(p.endPrice,480);assert.equal(p.endPct,20);
  const m=maPlan();const t2=draw([m],quote(520));t2.handlers['#startPrice']('600');assert.equal(m.endPrice,400,'기준선 계획은 종료 기준가를 그대로 둔다');
  const rules=plain(t.ctx.buildTradeAlertRules({plans:[pctPlan({notify:{start:true,sales:true}})]},quote(520)));
  assert.deepEqual(rules.map(r=>[r.label,r.targetPrice,r.condition]),[['분할매도 첫 매도',500,'down'],['분할매도 2회',475,'down'],['분할매도 3회',450,'down'],['분할매도 4회',425,'down'],['분할매도 5회',400,'down']]);
  assert.match(t.main,/data-sale-alert="0"/);
});

test('불러오기·동기화 검증은 하락률과 이전 전액매도 입력 기록을 받고 잘못된 값은 거절한다',()=>{
  const ctx=vm.createContext({});vm.runInContext(read('data-validation.js')+';this.externalData=externalData;',ctx);
  const data=extra=>({plans:[{id:'p',ticker:'AAA',stages:3,checked:[false,false,false],holdings:[],...extra}],futures:{positions:[]}});
  for(const ok of [{},{endPct:20},{endPct:'12.5'},{fullSell:{price:80,condition:'up'}}])assert.doesNotThrow(()=>ctx.externalData.planner(data(ok)));
  for(const bad of [{endPct:'abc'},{endPct:-1},{endPct:101},{fullSell:{price:'abc'}}])assert.throws(()=>ctx.externalData.planner(data(bad)),/기록 형식/);
});

test('회차당 가격 하락폭은 시작 기준가 대비 %로 보이고 금액은 설명에만 둔다',()=>{
  assert.match(draw([pctPlan()],quote(520)).main,/회차당 가격 하락폭<\/div><strong title="\$25">−5%<\/strong>/);
  assert.match(draw([maPlan({stages:30,startPrice:100,endPrice:80})],quote(120)).main,/회차당 가격 하락폭<\/div><strong title="\$0\.6896551724137931">−0\.69%<\/strong>/);
  assert.match(draw([maPlan({startPrice:80,endPrice:100})],quote(120)).main,/<strong title="\$5">\+6\.25%<\/strong>/);
  assert.match(draw([maPlan({startPrice:0})],quote(120)).main,/회차당 가격 하락폭<\/div><strong>—<\/strong>/);
});
