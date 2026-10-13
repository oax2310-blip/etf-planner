const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder.js','prices.js','rebuy.js','trade-alerts.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const plain=v=>JSON.parse(JSON.stringify(v));
const load=()=>{const ctx=vm.createContext({});vm.runInContext(source,ctx);return ctx;};
// 가상 설정·체결만 사용한다. 마지막 평균선도 직접 설정한 세 회차를 지원한다.
const fixture=(price=10100)=>({id:'qa',name:'테스트 ETF',ticker:'900001',lowPrice:10000,shares:200,currentPrice:9800,cuts:[{shares:100,price:9900}],
  stages:[{name:'80선',price,rounds:3,prices:[null,price+100,price+200]}]});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

for(const price of [10100,9000])test(`평균 손절가 ${price>9900?'위':'아래'}의 80선은 1~3회차 완료·저장·복원까지 진행한다`,()=>{
  const ctx=load(),r=fixture(price),cuts=JSON.stringify(r.cuts);
  for(let t=0;t<3;t++){
    const s=ctx.rebuySummary(r),tr=s.tranches.find(x=>x.t===t);
    assert.equal(s.sellAvg,9900);assert.ok(tr.amount>0);assert.equal(tr.price,price+t*100);
    const rec=ctx.rebuyBuyRecord(r,0,t,String(Math.max(1,Math.round(tr.amount/tr.price))),true);
    assert.notEqual(rec,false);if(!t)r.planned=plain(s.planKeys);
    (r.stages[0].buys??=[])[t]=plain(rec);
    const restored=JSON.parse(JSON.stringify(r));assert.deepEqual(plain(ctx.rebuySummary(restored).planKeys),[['80선',0],['80선',1],['80선',2]]);
    assert.equal(JSON.stringify(restored.cuts),cuts);assert.equal(ctx.rebuySummary(restored).sellAvg,9900);
  }
  const final=ctx.rebuySummary(r);assert.equal(final.doneTranches,3);assert.equal(final.rest,0);
  assert.equal(ctx.rebuyStatus(r,final)[0],'재매수 완료');assert.equal(JSON.stringify(r.cuts),cuts);
});

test('옛 고정 계획에서 손절가 때문에 제외됐던 같은 평균선 후속 회차를 기록 수정 없이 복구한다',()=>{
  const ctx=load(),r=fixture();delete r.stages[0].rounds;delete r.stages[0].prices;
  r.stages.push({name:'125선',price:10400});r.stages[0].buys=[{shares:20,price:10100}];r.planned=[['80선',0]];
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.planKeys),[['80선',0],['80선',1],['80선',2]]);
  assert.deepEqual(plain(s.tranches).map(x=>[x.t,x.done]),[[0,true],[1,false],[2,false]]);
  assert.ok(s.tranches.slice(1).every(x=>x.amount>0&&x.price>s.sellAvg));
  assert.equal(JSON.stringify(r),before);
});

test('명시한 회차 가격을 기다리는 동안 단계·배분은 유지하고 추정가 체결·알림은 실행하지 않는다',()=>{
  const ctx=load(),r=fixture();delete r.stages[0].prices;r.notify={buys:true};
  const s=ctx.rebuySummary(r);assert.equal(s.tranches.length,3);
  assert.ok(s.tranches.every(x=>x.amount>0));assert.equal(s.tranches[2].price,null);
  assert.equal(ctx.rebuyBuyRecord(r,0,2,'1',true),false);
  assert.deepEqual(plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null)).map(x=>x.targetPrice),[10100]);
});

test('단계 비중은 남은 금액을 회차에 배분하고 완료·부분 체결량과 예약 잔량은 보존한다',()=>{
  const ctx=load(),r=fixture();r.stages[0].weight=70;r.stages.push({name:'125선',price:10500,rounds:1,weight:30});
  r.cuts[0].price=11000;
  r.range={startLine:'80선',lastLine:'125선',lastRound:1,names:['80선','125선'],targetPct:100};
  let s=ctx.rebuySummary(r);s.tranches.slice(0,3).forEach(x=>near(x.amount,1100000*.7/3));near(s.tranches[3].amount,330000);
  r.stages[0].buys=[{shares:4,price:10100,partial:true,plannedShares:10}];r.planned=plain(s.planKeys);
  const before=JSON.stringify(r.stages[0].buys);s=ctx.rebuySummary(r);
  near(s.tranches[0].amount,60600);near(s.tranches.filter(x=>!x.done).reduce((n,x)=>n+x.amount,0),s.rest);
  assert.equal(JSON.stringify(r.stages[0].buys),before);
});

test('회차를 줄여도 체결한 마지막 회차와 옛 통째 완료 기록은 지우지 않는다',()=>{
  const ctx=load(),r=fixture();r.stages[0].rounds=1;r.stages[0].buys=[null,null,{shares:2,price:10300}];
  let s=ctx.rebuySummary(r);assert.ok(s.tranches.some(x=>x.t===2&&x.done&&x.qty===2));
  r.stages[0]={name:'80선',price:10100,done:true,shares:5,execPrice:10050};
  const before=JSON.stringify(r);s=ctx.rebuySummary(r);assert.equal(s.tranches.filter(x=>x.i===0).length,1);assert.equal(s.buyValue,50250);assert.equal(JSON.stringify(r),before);
});

test('매수 조건과 직접 회차 가격은 평균 손절가 위에서도 알림 방향·기준 변경에 반영한다',()=>{
  const ctx=load(),r=fixture();r.notify={buys:true};r.stages[0].buyCondition='down';
  const rules=()=>plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null));let result=rules();
  assert.deepEqual(result.map(x=>[x.targetPrice,x.condition]),[[10100,'down'],[10200,'down'],[10300,'down']]);
  const revision=result[2].revision;r.stages[0].prices[2]=10350;assert.notEqual(rules()[2].revision,revision);
  r.stages[0].buys=[{shares:2,price:10100}];assert.equal(rules().length,2);
});

test('편집 필드 검증은 기존 기록을 바꾸지 않고 비운 선택 설정은 삭제한다',()=>{
  const ctx=load(),st=fixture().stages[0];
  for(const [key,value] of [['rounds','4'],['rounds','1.5'],['weight','0'],['weight','101'],['price','-1'],['price1','Infinity'],['buyCondition','bad']]){
    const before=JSON.stringify(st);assert.equal(ctx.setRebuyStageDraftField(st,key,value),false);assert.equal(JSON.stringify(st),before);
  }
  ctx.setRebuyStageDraftField(st,'weight','40');ctx.setRebuyStageDraftField(st,'weight','');assert.equal(Object.hasOwn(st,'weight'),false);
  ctx.setRebuyStageDraftField(st,'rounds','');assert.equal(Object.hasOwn(st,'rounds'),false);
  ctx.setRebuyStageDraftField(st,'price1','');ctx.setRebuyStageDraftField(st,'price2','');assert.equal(Object.hasOwn(st,'prices'),false);
  st.buys=[{shares:2,price:10100}];const before=JSON.stringify(st);assert.equal(ctx.setRebuyStageDraftField(st,'name','125선'),false);assert.equal(JSON.stringify(st),before);
});

function editing(r){
  const ctx=load(),elements={},original=plain(r.stages),base=JSON.stringify(original);let saves=0;
  Object.assign(ctx,{state:{rebuy:{items:[r]},selectedRebuy:r.id},save:()=>saves++,$:id=>elements[id]??={close(){},textContent:''},id:()=> 'new-id',renderRebuy(){}});
  ctx.draft={source:r,original,base,stages:plain(original),invalid:new Set()};vm.runInContext('rebuyStageDraft=draft',ctx);
  return {ctx,draft:ctx.draft,error:()=>elements.rebuyStagesError?.textContent,saves:()=>saves};
}

test('매수 시작 뒤 범위를 직접 바꾸면 기존 기록을 유지하고 새 범위의 실제 종료선을 다시 고정한다',()=>{
  const r=fixture(9000);r.stages.push({name:'125선',price:9500});r.stages[0].buys=[{shares:2,price:9000}];
  r.range={startLine:'80선',lastLine:'125선',names:['80선','125선'],lastRound:3,targetPct:100};r.plannedEndLine='80선';
  const before=plain(r),{ctx,draft,saves}=editing(r);draft.range={...r.range,lastRound:2};
  assert.equal(ctx.saveRebuyStageDraft(),true);assert.equal(saves(),1);assert.equal(r.plannedEndLine,'125선');
  assert.deepEqual(plain(r.planned).filter(([name])=>name==='125선'),[['125선',0],['125선',1]]);
  assert.deepEqual(plain(r.stages[0].buys),before.stages[0].buys);assert.deepEqual(r.cuts,before.cuts);
});

test('추가·수정·삭제·순서 변경은 저장 때만 적용하고 손절·매수·메모·알림 설정을 보존한다',()=>{
  const r=fixture();r.note='가상 메모';r.stages[0].notify=true;r.stages[0].buys=[{shares:2,price:10100}];r.stages.push({name:'125선',price:10500});r.planned=[['80선',0]];
  const before=plain(r),{ctx,draft,saves}=editing(r);
  draft.stages[0].weight=60;draft.stages.splice(1,1);draft.stages.unshift({name:'60선',price:10000,rounds:1,weight:40});
  assert.deepEqual(r,before,'사본 조작은 저장 전 원본을 변경하지 않는다');
  assert.equal(ctx.saveRebuyStageDraft(),true);assert.equal(saves(),1);
  assert.deepEqual(r.stages.map(x=>x.name),['60선','80선']);assert.deepEqual(r.cuts,before.cuts);assert.equal(r.note,before.note);
  assert.deepEqual(plain(r.stages[1].buys),before.stages[0].buys);assert.equal(r.stages[1].notify,true);
  assert.ok(ctx.rebuySummary(JSON.parse(JSON.stringify(r))).tranches.some(x=>x.i===1&&x.t===2));
});

test('중복·빈 단계·기록 삭제·동시 변경은 저장을 거절하고 기존 데이터와 동기화 변경을 보존한다',()=>{
  for(const mode of ['duplicate','empty','delete','concurrent','replace']){
    const r=fixture();r.stages[0].buys=[{shares:2,price:10100}];const {ctx,draft,saves,error}=editing(r);
    if(mode==='duplicate')draft.stages.push(plain(draft.stages[0]));
    if(mode==='empty')draft.stages.push({name:'',price:0});
    if(mode==='delete')draft.stages=[{name:'125선',price:10500}];
    if(mode==='concurrent')r.stages[0].buys[0].shares=3;
    if(mode==='replace')ctx.state.rebuy.items[0]=plain(r);
    const before=JSON.stringify(r);assert.equal(ctx.saveRebuyStageDraft(),false,mode);assert.equal(JSON.stringify(r),before);assert.equal(saves(),0);assert.ok(error());
  }
});

test('설정을 바꾸지 않고 저장하거나 계산·복원만 하면 선택 필드를 만들거나 기존 데이터에 쓰지 않는다',()=>{
  const r=fixture();delete r.stages[0].rounds;delete r.stages[0].prices;
  const before=JSON.stringify(r),{ctx,saves}=editing(r);ctx.rebuySummary(r);assert.equal(ctx.saveRebuyStageDraft(),true);
  assert.equal(JSON.stringify(r),before);assert.equal(saves(),0);
});
