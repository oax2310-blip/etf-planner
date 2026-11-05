// DOM은 가짜 노드, 기록은 가상 TEST만 쓴다. 실제 저장소·수집·푸시를 호출하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const clone=value=>JSON.parse(JSON.stringify(value));
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.className='';this.open=false;this.text='';this.listeners={};
    this.classList={add:x=>this.tokens(x,true),toggle:(x,force)=>this.tokens(x,force)};}
  tokens(name,force){const names=new Set(this.className.split(/\s+/).filter(Boolean));if(force??!names.has(name))names.add(name);else names.delete(name);this.className=[...names].join(' ');}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(value){throw Error('동적 문자열은 textContent로만 표시해야 한다');}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.text='';this.append(...children);}
  querySelectorAll(selector){const out=[];for(const child of this.children){if(selector==='[data-split-trade]'&&child.dataset.splitTrade!==undefined)out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
  closest(selector){let at=this;while(at){if(at.className.split(/\s+/).includes(selector.slice(1)))return at;at=at.parentElement;}return null;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  click(){if(!this.disabled)return this.onclick?.();}
}
const records=()=>({plans:[{id:'plan',ticker:'TEST',title:'가상 계획',startPrice:90,endPrice:60,auto:{endPrice:60},holdings:[{shares:12}],fills:{'0':{price:90,qty:2},'1':{price:60,qty:1}}}],futures:{}});
const assets=()=>({version:1,allocation:{groups:[{id:'group',items:[{id:'asset',ticker:'TEST',name:'가상 자산',shares:12,averagePrice:90,buyPlan:{lines:{end:120},buys:{end:{price:120,shares:2}}}}]}]}});
function setup({data=records(),doc=assets(),readOnly=false,noStore=false,saveFails=false,assetFails=false,renderFails=false}={}){
  const elements=new Map(),el=key=>{if(!elements.has(key))elements.set(key,new Element());return elements.get(key);};
  let assetDoc=clone(doc),assetWrites=0,plannerWrites=0,rendered=0,plannerBackups=0,assetBackups=0,absorbed=0;
  const listeners=[],saved=[],order=[];
  const assetStore={get doc(){return assetDoc;},localSaveFailed:readOnly,status:{busy:false,choice:false},priceRefreshing:false,
    saveSection(section,replacement){order.push('assets');assetWrites++;if(assetFails)return false;assetDoc={...assetDoc,[section]:clone(replacement)};listeners.forEach(fn=>fn('change'));return true;},
    absorbLocal(){},subscribe(fn){listeners.push(fn);}};
  const context={Intl,Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-02-03T10:00:00Z']));}static now(){return Date.parse('2026-02-03T10:00:00Z');}},
    state:clone(data),sync:{busy:false,blocked:false},priceRefreshBusy:false,
    document:{getElementById:el,createElement:tag=>new Element(tag)},id:()=> 'example-split',
    absorbPlanner(){absorbed++;},save(next){order.push('planner');plannerWrites++;if(saveFails)return false;context.state=clone(next);saved.push(clone(next));return true;},
    render(){rendered++;if(renderFails)throw Error('synthetic renderer failure');}};
  if(!noStore)context.assetStore=assetStore;
  el('planForm').elements={ticker:{value:' test '}};el('rebuyForm').elements={ticker:{value:'testalt'}};
  el('exportBtn').onclick=()=>plannerBackups++;el('purchaseExport').onclick=()=>assetBackups++;
  vm.createContext(context);
  const code=['ma-ladder.js','prices.js','assets-calc.js','split-auto.js','data-validation.js','split-adjust.js','split-dialog.js'].map(name=>fs.readFileSync(path.join(__dirname,'../js',name),'utf8')).join('\n;\n');
  vm.runInContext(code,context);const ui=vm.runInContext('splitDialog',context);ui.initialize();
  return {ui,el,context,store:assetStore,saved,order,get doc(){return assetDoc;},stats:()=>({assetWrites,plannerWrites,rendered,plannerBackups,assetBackups,absorbed}),
    preview(){el('splitForm').onsubmit({preventDefault(){}});},checks:()=>el('splitGroups').querySelectorAll('[data-split-trade]')};
}

test('동기화·계획 수정 창의 진입과 종목 미리 채우기·오늘 날짜는 입력만 바꾸며 저장하지 않는다',()=>{
  const h=setup();h.el('syncDialog').open=true;h.el('syncSplitOpen').click();
  assert.equal(h.el('syncDialog').open,false);assert.equal(h.el('splitDialog').open,true);assert.equal(h.el('splitTicker').value,'');
  assert.equal(h.el('splitDate').value,'2026-02-03');assert.equal(h.el('splitApply').disabled,true);
  h.el('planDialog').open=true;h.el('planSplitOpen').click();assert.equal(h.el('splitTicker').value,'TEST');assert.equal(h.el('planDialog').open,false);
  h.el('rebuyDialog').open=true;h.el('rebuySplitOpen').click();assert.equal(h.el('splitTicker').value,'TESTALT');assert.equal(h.el('rebuyDialog').open,false);
  assert.equal(h.stats().plannerWrites,0);assert.equal(h.stats().assetWrites,0);assert.equal(Object.hasOwn(h.context.state,'splitLog'),false);
});

const detected=()=>({id:'TEST:2026-02-03:1:3',ticker:'TEST',from:1,to:3,kind:'split',exDate:'2026-02-03',basisThrough:'2026-02-02',detectedAt:'2026-02-03T09:00:00Z'});
test('자동 확인은 비율·적용일과 미리보기를 바로 채우고 반영을 눌러야 actionId·auto 이력을 저장한다',()=>{
  const h=setup(),before=JSON.stringify(h.context.state);
  assert.equal(h.ui.openAuto(detected()),true);assert.equal(h.el('splitInputs').hidden,true);assert.equal(h.el('splitPreviewSection').hidden,false);
  assert.equal(h.el('splitFrom').value,'1');assert.equal(h.el('splitTo').value,'3');assert.equal(h.el('splitDate').value,'2026-02-03');
  assert.equal(JSON.stringify(h.context.state),before);assert.equal(h.stats().plannerWrites,0);assert.equal(h.stats().assetWrites,0);
  h.el('splitApply').click();assert.equal(h.saved[0].splitLog[0].actionId,detected().id);assert.equal(h.saved[0].splitLog[0].source,'auto');
});
test('자동 입력 조건을 고치면 수동 이력으로 저장하고 이미 처리한 감지는 열거나 다시 반영하지 않는다',()=>{
  const h=setup();h.ui.openAuto(detected());h.el('splitEdit').click();h.el('splitTo').value='4';h.preview();h.el('splitApply').click();
  assert.equal(h.saved[0].splitLog[0].source,'manual');assert.equal(Object.hasOwn(h.saved[0].splitLog[0],'actionId'),false);
  const old={id:'old',ticker:'TEST',from:1,to:3,exDate:'2026-02-02',appliedAt:'2026-02-02T12:00:00Z',planner:true,assets:false};
  const finished=setup({data:{...records(),splitLog:[old]}});assert.equal(finished.ui.openAuto(detected()),false);assert.equal(finished.stats().plannerWrites,0);
  const changed=setup();changed.ui.openAuto(detected());changed.context.state.splitLog=[old];changed.el('splitApply').click();assert.equal(changed.stats().plannerWrites,0);
});
test('자동 미리보기에서 바뀔 칸이 없으면 해당 없음 확인으로 넘기며 이력을 미리 만들지 않는다',()=>{
  const h=setup({data:{plans:[],futures:{}},doc:{version:1}}),seen=[];
  h.context.splitNotices={render(){},dismiss:(a,empty)=>seen.push([a.id,empty])};h.ui.openAuto(detected());
  assert.deepEqual(seen,[[detected().id,true]]);assert.equal(Object.hasOwn(h.context.state,'splitLog'),false);assert.equal(h.stats().plannerWrites,0);
});
test('자산 저장을 못 해도 바뀔 자산 칸이 있으면 0건으로 보고 자동 제외를 제안하지 않는다',()=>{
  const h=setup({data:{plans:[],futures:{}},readOnly:true}),seen=[];
  h.context.splitNotices={render(){},dismiss:(a,empty)=>seen.push([a.id,empty])};h.ui.openAuto(detected());
  assert.deepEqual(seen,[]);assert.equal(h.el('splitApply').disabled,true);assert.equal(h.stats().plannerWrites,0);
});

test('미리보기는 네 그룹·이전→이후·자동값 건너뜀·기본 체결 체크를 표시한다',()=>{
  const data=records();data.rebuy={ticker:'TEST',name:'가상 재매수',lowPrice:90};const h=setup({data});
  const before=clone(h.context.state);h.ui.open('TEST');h.preview();
  const text=h.el('splitGroups').textContent;
  for(const label of ['분할매도 계획','재매수','자산 배분','분할매수','90→30','12→36','시세 자동 채움 — 변경 안 함'])assert.ok(text.includes(label),label);
  assert.ok(h.checks().length>=3);assert.ok(h.checks().every(x=>x.checked));assert.equal(h.el('splitApply').disabled,false);
  assert.deepEqual(h.context.state,before);assert.equal(h.stats().plannerWrites,0);assert.equal(h.el('splitInputs').hidden,true);
});

test('사용자 종목명·카드 이름·체결 이름은 HTML로 실행하지 않고 그대로 표시한다',()=>{
  const data=records();data.plans[0].title='<img src=x onerror="synthetic()">';const doc=assets();doc.allocation.groups[0].items[0].name='<script>synthetic()</script>';
  const h=setup({data,doc});h.ui.open('TEST');assert.doesNotThrow(()=>h.preview());
  assert.ok(h.el('splitGroups').textContent.includes(data.plans[0].title));assert.ok(h.el('splitGroups').textContent.includes(doc.allocation.groups[0].items[0].name));
});

test('해제한 체결은 보존하고 선택된 칸·이력을 플래너와 자산에 저장한 뒤 다시 그린다',()=>{
  const h=setup();h.ui.open('TEST');h.preview();
  const first=h.checks().find(x=>x.dataset.splitTrade==='sell:plan:0');first.checked=false;first.onchange();
  h.el('splitApply').click();const p=h.context.state.plans[0];
  assert.equal(p.startPrice,30);assert.equal(p.endPrice,60);assert.equal(p.holdings[0].shares,36);
  assert.deepEqual(p.fills['0'],{price:90,qty:2});assert.deepEqual(p.fills['1'],{price:20,qty:3});
  assert.equal(h.doc.allocation.groups[0].items[0].shares,36);assert.equal(h.context.state.splitLog.length,1);
  assert.deepEqual([h.context.state.splitLog[0].planner,h.context.state.splitLog[0].assets],[true,true]);
  assert.equal(h.stats().plannerWrites,1);assert.equal(h.stats().assetWrites,1);assert.equal(h.stats().rendered,1);
  assert.match(h.el('splitFeedback').textContent,/칸을 반영하고 이력을 저장/);assert.equal(h.el('splitApply').disabled,true);
});

test('같은 출처 체결의 플래너·자산 체크는 함께 바뀌고 함께 제외된다',()=>{
  const doc=assets();doc.allocation.trades={'sell:plan:0':{price:90,qty:2,items:[{id:'asset',shares:-2}]}};const h=setup({doc});
  h.ui.open('TEST');h.preview();const same=h.checks().filter(x=>x.dataset.splitTrade==='sell:plan:0');assert.equal(same.length,2);
  same[0].checked=false;same[0].onchange();assert.ok(same.every(x=>!x.checked));h.el('splitApply').click();
  assert.deepEqual(h.context.state.plans[0].fills['0'],{price:90,qty:2});assert.deepEqual(h.doc.allocation.trades['sell:plan:0'],doc.allocation.trades['sell:plan:0']);
});

test('중복 이력은 경고하고 추가 확인 전에는 반영을 막으며 조건을 바꾸면 확인을 초기화한다',()=>{
  const data=records();data.splitLog=[{id:'older',ticker:'TEST',from:1,to:3,exDate:'2026-02-03',appliedAt:'2026-02-03T00:00:00Z',planner:true,assets:false}];
  const h=setup({data});h.ui.open('TEST');h.preview();assert.equal(h.el('splitDuplicate').hidden,false);assert.equal(h.el('splitApply').disabled,true);
  h.el('splitApply').onclick();assert.equal(h.stats().plannerWrites,0);
  h.el('splitDuplicateConfirm').checked=true;h.el('splitDuplicateConfirm').onchange();assert.equal(h.el('splitApply').disabled,false);
  h.el('splitEdit').click();assert.equal(h.el('splitDuplicateConfirm').checked,false);assert.equal(h.el('splitApply').disabled,true);
  h.preview();assert.equal(h.el('splitApply').disabled,true);
});

test('동기화·시세 수집·기록 차이 확인 중에는 버튼과 직접 적용을 막고 끝나면 다시 켠다',()=>{
  const h=setup();h.ui.open('TEST');h.preview();
  for(const [obj,key] of [[h.context.sync,'busy'],[h.context.sync,'blocked'],[h.context,'priceRefreshBusy'],[h.store.status,'busy'],[h.store.status,'choice'],[h.store,'priceRefreshing']]){
    obj[key]=true;h.ui.updateStatus();assert.equal(h.el('splitApply').disabled,true);assert.match(h.el('splitBusy').textContent,/끝난 뒤/);
    h.el('splitApply').onclick();assert.equal(h.stats().plannerWrites,0);obj[key]=false;h.ui.updateStatus();assert.equal(h.el('splitApply').disabled,false);
  }
});

test('자산 기록을 쓸 수 없으면 플래너만 반영하고 assets=false와 안내를 남긴다',()=>{
  const h=setup({readOnly:true}),before=clone(h.doc);h.ui.open('TEST');h.preview();
  assert.match(h.el('splitAssetsNotice').textContent,/플래너 기록만/);assert.ok(h.checks().filter(x=>x.disabled).every(x=>!x.checked));
  h.el('splitApply').click();assert.deepEqual(h.doc,before);assert.equal(h.stats().assetWrites,0);assert.equal(h.context.state.splitLog[0].assets,false);assert.match(h.el('splitFeedback').textContent,/자산 기록은 변경하지 않았습니다/);
});

test('자산 저장이 실제로 실패해도 플래너만 다시 계산해 반영하고 반영 칸 수와 이력 플래그를 맞춘다',()=>{
  const h=setup({assetFails:true}),before=clone(h.doc);h.ui.open('TEST');h.preview();h.el('splitApply').click();
  assert.deepEqual(h.doc,before);assert.equal(h.context.state.plans[0].startPrice,30);assert.equal(h.context.state.splitLog[0].assets,false);
  assert.equal(h.stats().assetWrites,1);assert.equal(h.stats().plannerWrites,1);assert.match(h.el('splitFeedback').textContent,/플래너 기록만 반영/);
});

test('플래너 저장 실패는 먼저 저장한 자산을 되돌리고 반영 이력을 남기지 않는다',()=>{
  const h=setup({saveFails:true}),before=clone(h.context.state),oldAssets=clone(h.doc);h.ui.open('TEST');h.preview();h.el('splitApply').click();
  assert.deepEqual(h.context.state,before);assert.deepEqual(h.doc,oldAssets);assert.equal(h.stats().assetWrites,2);assert.equal(h.stats().rendered,0);assert.match(h.el('splitFeedback').textContent,/반영하지 않았습니다/);
});

test('자산만 바뀌는 경우에도 플래너에 정확한 문서 플래그로 이력을 저장한다',()=>{
  const h=setup({data:{plans:[],futures:{}}});h.ui.open('TEST');h.preview();h.el('splitApply').click();
  assert.equal(h.context.state.splitLog[0].planner,false);assert.equal(h.context.state.splitLog[0].assets,true);assert.equal(h.doc.allocation.groups[0].items[0].shares,36);
});

test('자산만 바뀌는데 저장에 실패하면 0건 적용이며 이력을 만들지 않는다',()=>{
  const h=setup({data:{plans:[],futures:{}},assetFails:true});h.ui.open('TEST');h.preview();h.el('splitApply').click();
  assert.equal(h.stats().plannerWrites,0);assert.equal(Object.hasOwn(h.context.state,'splitLog'),false);assert.match(h.el('splitFeedback').textContent,/기록은 변경하지 않았습니다/);
});

test('미리보기 이후 기록이 바뀌면 덮어쓰지 않고 다시 확인하도록 한다',()=>{
  const h=setup();h.ui.open('TEST');h.preview();h.context.state.plans[0].startPrice=120;h.ui.updateStatus();
  assert.equal(h.el('splitApply').disabled,true);h.el('splitApply').onclick();assert.equal(h.stats().assetWrites,0);assert.equal(h.stats().plannerWrites,0);assert.equal(h.context.state.plans[0].startPrice,120);
});

test('바뀔 칸 없음·제외 종목·잘못된 비율은 반영하지 않으며 기존 백업 버튼을 사용한다',()=>{
  const h=setup();h.ui.open('TESTALT');h.preview();assert.equal(h.el('splitApply').disabled,true);assert.match(h.el('splitCount').textContent,/바뀔 칸/);
  h.ui.open('BTC-USD');h.preview();assert.equal(h.el('splitApply').disabled,true);assert.match(h.el('splitFeedback').textContent,/대상이 아닙니다/);
  h.ui.open('TEST');h.el('splitFrom').value='0';h.preview();assert.equal(h.el('splitApply').disabled,true);assert.match(h.el('splitFeedback').textContent,/비율/);
  h.el('splitPlannerBackup').click();h.el('splitAssetsBackup').click();assert.equal(h.stats().plannerBackups,1);assert.equal(h.stats().assetBackups,1);assert.equal(h.stats().plannerWrites,0);
});

test('자산 저장소가 없거나 읽을 수 없어도 플래너 반영과 백업 경로를 유지한다',()=>{
  for(const missing of [true,false]){
    const h=setup({noStore:missing});if(!missing)Object.defineProperty(h.store,'doc',{get(){throw Error('synthetic unavailable');}});
    h.ui.open('TEST');assert.doesNotThrow(()=>h.preview());h.el('splitApply').click();assert.equal(h.context.state.plans[0].startPrice,30);assert.equal(h.context.state.splitLog[0].assets,false);assert.equal(h.el('splitAssetsBackup').disabled,true);
  }
});

test('저장 후 화면 그리기 실패가 있어도 성공한 자산 보정을 되돌리거나 이력을 바꾸지 않는다',()=>{
  const h=setup({renderFails:true});h.ui.open('TEST');h.preview();h.el('splitApply').click();
  assert.equal(h.stats().assetWrites,1);assert.equal(h.context.state.splitLog[0].assets,true);assert.equal(h.doc.allocation.groups[0].items[0].shares,36);assert.match(h.el('splitFeedback').textContent,/저장했습니다/);
});
