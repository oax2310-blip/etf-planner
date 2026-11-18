const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 실제 투자 기록 없이 자산 배분 수정창의 입력·저장·삭제 이벤트를 가상 DOM에서 실행한다.
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
// 계산·화면 코드는 assets.html에 실제 등록된 순서로만 읽는다. 저장소는 아래 대역을 쓰며, 빠진 페이지 의존성을 테스트가 대신 주입하지 않는다.
const exercised=new Set(['js/gold-estimate.js','js/money-input.js','js/ma-ladder.js','js/assets-calc.js','js/member-link.js','js/alloc-link.js','js/assets.js']);
const source=[...read('assets.html').matchAll(/<script\b[^>]*src="(js\/[^"?]+)\?v=\d+"/g)].map(m=>m[1]).filter(file=>exercised.has(file)).map(read).join('\n;\n');
const fixture=()=>({version:1,allocation:{savedAt:'2026-01-01',total:100,cashFx:1200,memo:'가상 메모',classes:[{id:'stock',region:'미국',name:'주식'}],cash:[],groups:[
  {id:'g1',name:'가상 계좌 1',classId:'stock',items:[{id:'a',name:'가상 해외 ETF',ticker:'AAA',shares:2,amount:20,base:50000,target:10,note:'보존',buyPlan:{stages:[{id:'stage',price:40,shares:1,amount:5,done:true}]}}]},
  {id:'g2',name:'가상 계좌 2',classId:'stock',items:[{id:'b',name:'다른 계좌 ETF',ticker:'AAA',shares:3,averagePrice:100,amount:30,base:60000},{id:'missing',name:'평균가 없는 ETF',ticker:'AAA',shares:1},{id:'domestic',name:'가상 국내 ETF',ticker:'111111',shares:4,averagePrice:10000}]}]}});
const quoteFixture=()=>({stocks:{AAA:{kind:'해외',close:60,asOf:'2026-01-02'},'111111':{kind:'국내',close:12000,asOf:'2026-01-02'}},fx:{close:1200,asOf:'2026-01-02'}});

test('체결된 매수의 기준 티커 변경 확인 취소는 저장하지 않고 승인해도 옛 회차를 변환하지 않는다',()=>{
  for(const confirmed of [false,true])for(const buyPlan of [{stages:[{id:'s',price:80,done:true}]},{buys:{end:{price:80,actual:1}}},{stages:[{id:'s',price:80,partial:true,shares:1}]}]){
    const data=fixture(),item=data.allocation.groups[0].items[0];Object.assign(item,{section:'금',ticker:'GLDM',buyPlan});
    const h=page(data),messages=[],before=JSON.stringify(data),record=JSON.stringify(buyPlan);
    h.ctx.confirm=message=>{messages.push(message);return confirmed;};h.open('a');h.field('ticker','GDX');h.submit();
    assert.equal(messages.length,1);assert.match(messages[0],/옛 티커 가격/);assert.match(messages[0],/다음 수집/);assert.match(messages[0],/장중 금 추정이 꺼집니다/);
    assert.equal(JSON.stringify(item.buyPlan),record);
    if(confirmed){assert.equal(item.ticker,'GDX');assert.deepEqual(h.writes,['allocation']);}
    else{assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,true);}
  }
});
function page(data=fixture(),quotes=quoteFixture()){
  const nodes=new Map(),storage=new Map(),writes=[],alerts=[],inputListeners=[];let itemButtons=[],groupButtons=[];
  const document={activeElement:null,getElementById:node,querySelector:node,querySelectorAll:sel=>sel==='[data-item]'?itemButtons:sel==='[data-group]'?groupButtons:sel==='dialog [data-close]'?[node('itemCancel')]:[],addEventListener(type,fn){if(type==='input')inputListeners.push(fn);}};
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='',value='';const attrs=new Map();
    const n={id,dataset:{},hidden:false,open:false,textContent:'',style:{},classList:{toggle(){},contains(){return false;}},tagName:'DIV',
      querySelector:sel=>node(`${id}:${sel}`),querySelectorAll:()=>[],setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),
      matches:selector=>selector==='input[data-money]'&&attrs.has('data-money'),setSelectionRange(start,end){n.selectionStart=start;n.selectionEnd=end;},
      setCustomValidity(message){n.validationMessage=message;n.validity={valid:!message};},checkValidity:()=>!n.validationMessage,reportValidity(){n.reported=true;},
      focus(){document.activeElement=n;},blur(){if(document.activeElement===n)document.activeElement=null;},
      showModal(){n.open=true;},close(){n.open=false;document.activeElement=null;},closest:sel=>sel==='dialog'?node('itemDialog'):null,
      click(){return n.onclick?.();}};
    Object.defineProperty(n,'value',{get:()=>value,set:v=>{value=String(v);}});
    Object.defineProperty(n,'innerHTML',{get:()=>html,set:v=>{
      html=String(v);
      if(id!=='allocView'&&id!=='strategyView')return;
      if(!html){itemButtons=[];groupButtons=[];return;}
      itemButtons=[...html.matchAll(/<button\b[^>]*data-item="([^"]+)"[^>]*>/g)].map(m=>{
        const b=node(`itemButton:${m[1]}`);b.dataset.item=m[1];return b;
      });
      groupButtons=[...html.matchAll(/<button\b[^>]*data-group="([^"]+)"[^>]*>/g)].map(m=>{
        const b=node(`groupButton:${m[1]}`);b.dataset.group=m[1];return b;
      });
    }});
    nodes.set(id,n);return n;
  }
  const form=node('itemForm');form.elements={};
  for(const name of ['name','group','section','ticker','tradeTicker','shares','target','done','note','averagePrice','averageCurrency']){
    const input=node(name==='averagePrice'?'averagePriceInput':name==='averageCurrency'?'averageCurrencySelect':`item:${name}`);input.tagName=['group','averageCurrency'].includes(name)?'SELECT':name==='note'?'TEXTAREA':'INPUT';
    form[name]=input;form.elements[name]=input;
  }
  for(const name of ['name','classId','target','note'])node('groupForm')[name]=node(`group:${name}`);
  for(const name of ['name','region','target','cash'])node('classForm')[name]=node(`class:${name}`);
  for(const name of ['place','name','amount','currency','minus'])node('cashForm')[name]=node(`cash:${name}`);
  node('cashForm').amount.setAttribute('data-money','');
  node('cashForm').amount.setAttribute('data-money-step','any');
  // HTML의 금액 제한도 실제 화면처럼 공용 검증기에 전달한다.
  const averageTag=read('assets.html').match(/<input id="averagePriceInput"[^>]*>/)[0];
  node('averagePriceInput').setAttribute('data-money','');
  for(const [,key,value] of averageTag.matchAll(/(data-money-(?:min|max|step))="([^"]*)"/g))node('averagePriceInput').setAttribute(key,value);
  form.checkValidity=()=>Object.values(form.elements).every(input=>input.checkValidity());
  const store={doc:data,prices:quotes,absorbLocal(){},saveSection(section){writes.push(section);storage.set('etf-planner-assets-v1',JSON.stringify(store.doc));}};
  const ctx=vm.createContext({document,assetStore:store,URLSearchParams,crypto:require('node:crypto').webcrypto,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    addEventListener(){},setTimeout:fn=>{fn();return 1;},confirm:()=>true,alert:message=>alerts.push(message)});
  vm.runInContext(source,ctx);ctx.openTab('alloc');
  const html=()=>node('allocView').innerHTML;
  const row=id=>{const start=html().indexOf(`data-alloc-item="${id}"`);assert.ok(start>=0,`종목 줄 ${id}`);const rest=html().slice(start),end=rest.search(/class="asset-row|class="group-foot"/);return end<0?rest:rest.slice(0,end);};
  return {ctx,data,store,node,html,row,writes,alerts,storage,input:node('averagePriceInput'),
    replaceDoc(next){store.doc=next;vm.runInContext('doc=assetStore.doc;render()',ctx);},
    saved(){return JSON.parse(storage.get('etf-planner-assets-v1'));},
    type(input,value){input.value=value;input.selectionStart=input.selectionEnd=value.length;inputListeners.forEach(fn=>fn({target:input}));input.oninput?.();},
    open(id){const b=itemButtons.find(b=>b.dataset.item===id);assert.ok(b?.onclick,'종목 수정 버튼 이벤트');b.click();},
    openGroup(id){const b=groupButtons.find(b=>b.dataset.group===id);assert.ok(b?.onclick,'그룹 수정 버튼 이벤트');b.click();},
    edit(value){const input=node('averagePriceInput');input.value=value;input.selectionStart=input.selectionEnd=value.length;inputListeners.forEach(fn=>fn({target:input}));input.oninput();},
    submit(){form.onsubmit({preventDefault(){}});},cancel(){node('itemCancel').click();},
    field(name,value){form.elements[name].value=value;form.elements[name].oninput?.();},
    selectCurrency(value){form.elements.averageCurrency.value=value;form.elements.averageCurrency.onchange();},
    refresh(quotes){store.prices=quotes;vm.runInContext('prices=assetStore.prices;render()',ctx);}};
}

function allocationTabFixture(){
  const data=fixture();
  data.allocation.classes.push({id:'unused',region:'국내',name:'가상 큰 분류'});
  data.allocation.cash.push({id:'cash',name:'가상 현금',amount:1000,currency:'KRW'});
  data.ledger={savedAt:'',years:[{year:2025,accounts:[{name:'가상 A'}],months:[{m:2,pnl:200,balances:[1000]}]}]};
  return data;
}

function otherTabSave(data){
  const next=structuredClone(data);
  next.ledger.years[0].months[0].pnl=999;
  return next;
}

const allocationDialogs=[
  {key:'item',label:'종목',id:'a',open:(h,id)=>h.ctx.openItem(id,'g1'),records:a=>a.groups[0].items},
  {key:'group',label:'그룹',id:'g1',open:(h,id)=>h.ctx.openGroup(id),records:a=>a.groups},
  {key:'class',label:'큰 분류',id:'unused',open:(h,id)=>h.ctx.openClass(id),records:a=>a.classes},
  {key:'cash',label:'현금',id:'cash',open:(h,id)=>h.ctx.openCash(id),records:a=>a.cash},
];
const saveForm=form=>form.onsubmit({preventDefault(){}});

for(const {key,label,id,open,records} of allocationDialogs){
  for(const creating of [false,true]){
    const action=creating?'추가':'수정';
    test(`${label} ${action} 결과는 열린 뒤 다른 탭이 저장한 문서에 반영된다`,()=>{
      const data=allocationTabFixture(),h=page(data),before=JSON.stringify(data),next=otherTabSave(data);
      open(h,creating?null:id);
      const form=h.node(`${key}Form`),name=`가상 ${label} ${action}`;
      form.name.value=name;
      h.replaceDoc(next);saveForm(form);
      const saved=h.saved(),row=records(saved.allocation).find(r=>r.name===name);
      assert.ok(row?.id);
      if(!creating)assert.equal(row.id,id);
      assert.deepEqual(saved.ledger,next.ledger);
      assert.equal(saved.ledger.years[0].months[0].pnl,999);
      assert.equal(JSON.stringify(data),before,'열 때의 자산 기록은 수정하지 않음');
      assert.deepEqual(h.writes,['allocation']);
      assert.equal(h.node(`${key}Dialog`).open,false);
    });
  }

  test(`${label} 삭제는 확인 문구와 저장에 최신 문서를 쓴다`,()=>{
    const data=allocationTabFixture(),h=page(data),before=JSON.stringify(data),next=otherTabSave(data),messages=[];
    open(h,id);
    records(next.allocation).find(r=>r.id===id).name='가상 최신 이름';
    h.replaceDoc(next);
    h.ctx.confirm=message=>{messages.push(message);return true;};
    h.node(`${key}Delete`).click();
    assert.match(messages[0],/가상 최신 이름/);
    assert.equal(records(h.saved().allocation).some(r=>r.id===id),false);
    assert.deepEqual(h.saved().ledger,next.ledger);
    assert.equal(JSON.stringify(data),before);
    assert.deepEqual(h.writes,['allocation']);
    assert.equal(h.node(`${key}Dialog`).open,false);
  });

  test(`${label} 수정 중 다른 탭이 대상을 삭제하면 다시 저장하지 않는다`,()=>{
    const data=allocationTabFixture(),h=page(data),next=otherTabSave(data);
    open(h,id);
    const form=h.node(`${key}Form`);form.name.value='가상 남길 입력';
    const rows=records(next.allocation);rows.splice(rows.findIndex(r=>r.id===id),1);
    const before=JSON.stringify(next);
    h.replaceDoc(next);saveForm(form);
    assert.equal(JSON.stringify(next),before);
    assert.deepEqual(h.writes,[]);
    assert.match(h.alerts[0],/삭제되어 저장하지 않았습니다/);
    assert.equal(h.node(`${key}Dialog`).open,key!=='item');
    if(key==='item')assert.equal(h.alerts[0],'이 보유 항목이 삭제되어 저장하지 않았습니다.');
    else assert.equal(form.name.value,'가상 남길 입력');
  });

  test(`${label} 대상을 이미 삭제했으면 삭제 확인 없이 안내하고 창을 닫는다`,()=>{
    const data=allocationTabFixture(),h=page(data),next=otherTabSave(data);
    open(h,id);
    const rows=records(next.allocation);rows.splice(rows.findIndex(r=>r.id===id),1);
    const before=JSON.stringify(next);
    h.replaceDoc(next);
    h.ctx.confirm=()=>assert.fail('이미 삭제된 대상의 확인 창');
    h.node(`${key}Delete`).click();
    assert.equal(JSON.stringify(next),before);
    assert.deepEqual(h.writes,[]);
    assert.match(h.alerts[0],/이미 삭제/);
    assert.equal(h.node(`${key}Dialog`).open,false);
  });

  for(const deleting of [false,true]){
    const action=deleting?'삭제':'저장';
    test(`${label} ${action} 직전에 아직 알림이 오지 않은 다른 탭의 저장을 받는다`,()=>{
      const data=allocationTabFixture(),h=page(data),next=otherTabSave(data);
      open(h,id);
      const current=records(next.allocation).find(r=>r.id===id);
      current.name='가상 최신 이름';
      h.store.absorbLocal=()=>{h.store.doc=next;};
      if(deleting){
        h.ctx.confirm=message=>{assert.match(message,/가상 최신 이름/);return true;};
        h.node(`${key}Delete`).click();
        assert.equal(records(h.saved().allocation).some(r=>r.id===id),false);
      }else{
        const form=h.node(`${key}Form`);form.name.value='가상 수정 이름';saveForm(form);
        assert.equal(records(h.saved().allocation).find(r=>r.id===id).name,'가상 수정 이름');
      }
      assert.equal(h.saved().ledger.years[0].months[0].pnl,999);
    });
  }
}

test('종목 삭제는 다른 탭에서 추가한 최신 계좌 줄에 계획·체결·목표를 옮긴다',()=>{
  const data=allocationTabFixture(),h=page(data),next=otherTabSave(data),a=next.allocation;
  h.open('a');
  const from=a.groups[0].items[0],to={id:'new-account',name:'가상 최신 계좌 줄',ticker:'AAA',target:3};
  const plan=from.buyPlan;plan.buyPriority=['a',to.id];
  a.groups[0].items.push(to);a.trades={'buy:a:stage':{label:'가상 최신 체결',items:[{id:'a',shares:2}]}};
  h.replaceDoc(next);
  h.ctx.confirm=message=>{
    assert.match(message,/'가상 최신 계좌 줄' 줄로 옮겨 유지합니다/);
    assert.match(message,/목표 비중 10%는 '가상 최신 계좌 줄' 줄로 옮깁니다/);
    return true;
  };
  h.node('itemDelete').click();
  assert.equal(a.groups[0].items.includes(from),false);
  assert.equal(to.buyPlan,plan);assert.deepEqual(Array.from(plan.buyPriority),[to.id]);
  assert.deepEqual(Object.keys(a.trades),['buy:new-account:stage']);
  assert.equal(a.trades['buy:new-account:stage'].items[0].shares,2);
  assert.equal(to.target,13);
  assert.deepEqual(h.writes,['allocation']);
});

test('그룹 삭제는 최신 종목 수와 계획으로 확인하고 다른 그룹의 최신 계좌에 계획을 옮긴다',()=>{
  const data=allocationTabFixture(),h=page(data),next=otherTabSave(data),a=next.allocation;
  h.openGroup('g1');
  const to={id:'new-account',name:'가상 최신 계좌 줄',ticker:'AAA',target:3};
  a.groups[1].items.unshift(to);
  const plan=a.groups[0].items[0].buyPlan;plan.buyPriority=[to.id];
  a.groups[0].items.push({id:'new-in-group',name:'가상 최신 종목',ticker:'BBB'});
  h.replaceDoc(next);
  h.ctx.confirm=message=>{
    assert.match(message,/종목 2개/);
    assert.match(message,/가상 해외 ETF → 가상 최신 계좌 줄/);
    return true;
  };
  h.node('groupDelete').click();
  assert.equal(a.groups.length,1);assert.equal(to.buyPlan,plan);assert.equal(to.target,3);
  assert.deepEqual(h.writes,['allocation']);
});

for(const use of ['그룹','소분류'])test(`큰 분류 삭제는 다른 탭이 추가한 ${use} 연결을 검사한다`,()=>{
  const data=allocationTabFixture(),h=page(data),next=otherTabSave(data),group=next.allocation.groups[0];
  h.ctx.openClass('unused');
  if(use==='그룹')group.classId='unused';
  else group.sections=[{name:'가상 소분류',classId:'unused'}];
  h.replaceDoc(next);
  h.ctx.confirm=()=>assert.fail('사용 중인 분류의 삭제 확인 창');
  h.node('classDelete').click();
  assert.match(h.alerts[0],new RegExp(`${use} 1개`));
  assert.equal(next.allocation.classes.some(c=>c.id==='unused'),true);
  assert.deepEqual(h.writes,[]);
  assert.equal(h.node('classDialog').open,true);
});

test('큰 분류의 현금 체크는 다른 탭이 바꾼 현재 분류에서 새 분류로 옮긴다',()=>{
  const data=allocationTabFixture();data.allocation.classes[0].cash=true;
  const h=page(data),next=otherTabSave(data);
  h.ctx.openClass('unused');
  delete next.allocation.classes[0].cash;
  next.allocation.classes.push({id:'new-cash-owner',region:'현금',name:'가상 최신 현금 분류',cash:true});
  h.replaceDoc(next);
  const f=h.node('classForm');f.cash.checked=true;f.cash.onchange();
  assert.match(h.node('classCashHint').textContent,/가상 최신 현금 분류/);
  saveForm(f);
  assert.deepEqual(h.saved().allocation.classes.filter(c=>c.cash).map(c=>c.id),['unused']);
  assert.equal(data.allocation.classes[0].cash,true);
  assert.deepEqual(h.saved().ledger,next.ledger);
});

test('그룹 저장은 다른 탭이 추가한 소분류와 최신 분류·종목을 보존한다',()=>{
  const data=allocationTabFixture(),group=data.allocation.groups[0];
  group.sections=[{name:'가상 기존 소분류',target:5}];
  const h=page(data),next=otherTabSave(data),current=next.allocation.groups[0];
  h.openGroup('g1');
  const added={name:'가상 최신 소분류',classId:'unused',target:8,note:'가상 최신 메모'};
  current.sections.unshift(added);
  current.items.push({id:'new-item',name:'가상 최신 종목',section:added.name});
  next.allocation.classes[0].name='가상 최신 큰 분류 이름';
  h.replaceDoc(next);
  const f=h.node('groupForm');f.name.value='가상 새 그룹 이름';
  f.querySelector('[data-sec="0"]').value='7';saveForm(f);
  const saved=h.saved();
  assert.deepEqual(saved.allocation.groups[0].sections,[added,{name:'가상 기존 소분류',target:7}]);
  assert.equal(saved.allocation.groups[0].items.at(-1).id,'new-item');
  assert.equal(saved.allocation.classes[0].name,'가상 최신 큰 분류 이름');
  assert.deepEqual(saved.ledger,next.ledger);
});

test('그룹 분류로 고른 저장된 분류가 다른 탭에서 지워지면 다시 만들지 않고 창과 입력을 유지한다',()=>{
  const data=allocationTabFixture();
  data.allocation.groups[0].sections=[{name:'가상 기존 소분류',target:5}];
  const h=page(data),next=otherTabSave(data);
  h.openGroup('g1');
  const f=h.node('groupForm'),secTarget=f.querySelector('[data-sec="0"]');
  f.name.value='가상 바꾼 그룹 이름';f.classId.value='unused';f.target.value='15';f.note.value='가상 입력 메모';secTarget.value='9';
  next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
  next.allocation.classes[0].name='가상 최신 주식 분류';
  const beforeNext=JSON.stringify(next);
  h.replaceDoc(next);saveForm(f);
  assert.equal(JSON.stringify(next),beforeNext,'막았을 때 메모리 doc은 바뀌지 않음');
  assert.equal(next.allocation.classes.some(c=>c.id==='unused'),false);
  assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
  assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/가상 큰 분류/);assert.match(h.alerts[0],/삭제되어 저장하지 않았습니다/);assert.match(h.alerts[0],/다른 분류/);
  assert.equal(h.node('groupDialog').open,true);
  assert.equal(f.name.value,'가상 바꾼 그룹 이름');assert.equal(f.classId.value,'');
  assert.match(f.classId.innerHTML,/<option value="">분류 없음 · 다시 고르세요<\/option>/);
  assert.doesNotMatch(f.classId.innerHTML,/value="unused"/);
  assert.match(f.classId.innerHTML,/>미국 · 가상 최신 주식 분류<\/option>/);
  assert.equal(f.target.value,'15');assert.equal(f.note.value,'가상 입력 메모');assert.equal(secTarget.value,'9');
  // 다른 분류로 고친 뒤 다시 저장하면 최신 기록에 반영된다.
  f.classId.value='stock';saveForm(f);
  const saved=h.saved();
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
  assert.equal(saved.allocation.groups[0].name,'가상 바꾼 그룹 이름');
  assert.equal(saved.allocation.groups[0].classId,'stock');
  assert.equal(saved.allocation.classes.some(c=>c.id==='unused'),false);
  assert.equal(saved.allocation.classes[0].name,'가상 최신 주식 분류');
});

test('새 그룹 추가나 직전 absorbLocal로 지운 분류도 다시 만들지 않고 저장을 막는다',()=>{
  const data=allocationTabFixture(),h=page(data),late=otherTabSave(data);
  h.ctx.openGroup(null);
  const f=h.node('groupForm');f.name.value='가상 새 그룹';f.classId.value='unused';f.note.value='가상 새 그룹 메모';
  late.allocation.classes=late.allocation.classes.filter(c=>c.id!=='unused');
  const beforeLate=JSON.stringify(late);
  h.store.absorbLocal=()=>{h.store.doc=late;};
  saveForm(f);
  assert.equal(JSON.stringify(late),beforeLate,'새 그룹 추가도 막으면 doc을 바꾸지 않음');
  assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/가상 큰 분류/);
  assert.equal(h.node('groupDialog').open,true);assert.equal(f.name.value,'가상 새 그룹');assert.equal(f.classId.value,'');assert.equal(f.note.value,'가상 새 그룹 메모');
  assert.match(f.classId.innerHTML,/<option value="">분류 없음 · 다시 고르세요<\/option>/);
  assert.doesNotMatch(f.classId.innerHTML,/value="unused"/);
});

test('소분류 분류로 고른 저장된 분류가 지워지면 그룹·분류·소분류를 바꾸기 전에 저장을 막는다',()=>{
  for(const pickTempChina of [false,true]){
    const data=allocationTabFixture(),group=data.allocation.groups[0];
    group.sections=[{name:'가상 소분류 1',target:4}];
    group.items.push({id:'sec-it',name:'가상 소분류 종목',section:'가상 소분류 1'});
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),tempId=/<option value="([^"]+)">해외 · 중국<\/option>/.exec(f.classId.innerHTML)?.[1];
    assert.ok(tempId);
    f.name.value='가상 고친 그룹 이름';f.note.value='가상 고친 메모';
    f.classId.value=pickTempChina?tempId:'stock';
    const secTarget=f.querySelector('[data-sec="0"]'),secClass=f.querySelector('[data-sec-class="0"]');
    secTarget.value='9';secClass.value='unused';
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
    next.allocation.groups[0].sections.unshift({name:'가상 다른 탭 소분류',target:2});
    const beforeNext=JSON.stringify(next);
    h.replaceDoc(next);saveForm(f);
    assert.equal(JSON.stringify(next),beforeNext,'소분류 분류가 지워져도 doc의 그룹·분류·소분류 모두 그대로');
    assert.equal(next.allocation.classes.some(c=>c.id==='unused'||c.id===tempId),false);
    assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/가상 큰 분류/);assert.match(h.alerts[0],/다른 분류/);
    assert.equal(h.node('groupDialog').open,true);
    assert.equal(f.name.value,'가상 고친 그룹 이름');assert.equal(f.note.value,'가상 고친 메모');
    assert.equal(f.classId.value,pickTempChina?tempId:'stock');assert.equal(secTarget.value,'9');assert.equal(secClass.value,'');
    assert.doesNotMatch(f.classId.innerHTML,/분류 없음 · 다시 고르세요|value="unused"/);
    assert.match(secClass.innerHTML,/<option value="">그룹 분류 따름<\/option>/);
    assert.doesNotMatch(secClass.innerHTML,/value="unused"/);
  }
});

test('창을 열 때 이미 저장돼 있던 해외·중국 분류가 지워지면 임시 예외로 살리지 않고 막는다',()=>{
  for(const legacy of [false,true]){
    const data=allocationTabFixture();
    data.allocation.classes.push(legacy?{id:'cn-stored',region:'중국',name:'주식'}:{id:'cn-stored',region:'해외',name:'중국'});
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm');f.classId.value='cn-stored';
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='cn-stored');
    const beforeNext=JSON.stringify(next);
    h.replaceDoc(next);saveForm(f);
    assert.equal(JSON.stringify(next),beforeNext);
    assert.equal(next.allocation.classes.some(c=>c.id==='cn-stored'||c.name==='중국'),false);
    assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/중국/);
    assert.equal(h.node('groupDialog').open,true);assert.equal(f.classId.value,'');
    assert.match(f.classId.innerHTML,/<option value="">분류 없음 · 다시 고르세요<\/option>/);
    assert.doesNotMatch(f.classId.innerHTML,/value="cn-stored"/);
  }
});

test('창을 열 때 만든 임시 해외·중국을 그룹 또는 소분류로 고르면 저장할 때 분류를 만든다',()=>{
  for(const target of ['group','section']){
    const data=allocationTabFixture();
    data.allocation.groups[0].sections=[{name:'가상 소분류',target:5}];
    const h=page(data);h.openGroup('g1');
    const f=h.node('groupForm'),tempId=/<option value="([^"]+)">해외 · 중국<\/option>/.exec(f.classId.innerHTML)?.[1];
    assert.ok(tempId);
    f.name.value='가상 중국 테스트';f.querySelector('[data-sec="0"]').value='5';
    if(target==='group')f.classId.value=tempId;
    else f.querySelector('[data-sec-class="0"]').value=tempId;
    saveForm(f);
    const saved=h.saved(),china=saved.allocation.classes.filter(c=>c.region==='해외'&&c.name==='중국');
    assert.equal(china.length,1);assert.equal(china[0].id,tempId);
    assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
    if(target==='group'){
      assert.equal(saved.allocation.groups[0].classId,tempId);
      assert.equal(Object.hasOwn(saved.allocation.groups[0].sections[0],'classId'),false);
    }else{
      assert.equal(saved.allocation.groups[0].classId,'stock');
      assert.equal(saved.allocation.groups[0].sections[0].classId,tempId);
    }
  }
});

test('창이 열린 사이 다른 탭이 해외·중국을 이미 만들었으면 중복 생성 없이 그 분류를 재사용한다',()=>{
  for(const mode of ['group','newGroup','section','both']){
    for(const legacy of [false,true]){
      const data=allocationTabFixture();
      data.allocation.groups[0].sections=[{name:'가상 소분류',target:5}];
      const h=page(data),next=otherTabSave(data);
      if(mode==='newGroup')h.ctx.openGroup(null);else h.openGroup('g1');
      const f=h.node('groupForm'),tempId=/<option value="([^"]+)">해외 · 중국<\/option>/.exec(f.classId.innerHTML)?.[1];
      assert.ok(tempId);
      f.name.value='가상 중국 재사용';
      if(mode!=='newGroup')f.querySelector('[data-sec="0"]').value='5';
      if(mode!=='section')f.classId.value=tempId;
      if(mode==='section'||mode==='both')f.querySelector('[data-sec-class="0"]').value=tempId;
      next.allocation.classes.push(legacy?{id:'cn-tab-b',region:'중국',name:'주식'}:{id:'cn-tab-b',region:'해외',name:'중국'});
      h.replaceDoc(next);saveForm(f);
      const saved=h.saved(),china=saved.allocation.classes.filter(c=>c.region==='해외'&&c.name==='중국');
      assert.equal(china.length,1,`${mode}/${legacy}: 중복 생성 금지`);
      assert.equal(china[0].id,'cn-tab-b');
      assert.equal(saved.allocation.classes.some(c=>c.id===tempId),false);
      assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
      const grp=mode==='newGroup'?saved.allocation.groups.at(-1):saved.allocation.groups[0];
      assert.equal(grp.classId,mode==='section'?'stock':'cn-tab-b');
      if(mode==='section')assert.equal(grp.sections[0].classId,'cn-tab-b');
      else if(mode==='both')assert.equal(Object.hasOwn(grp.sections[0],'classId'),false);
    }
  }
});

test('다른 탭이 바꾼 분류 이름·지역을 옛 선택지 값으로 덮어쓰지 않는다',()=>{
  const data=allocationTabFixture();
  data.allocation.groups[0].sections=[{name:'가상 소분류',target:5}];
  const h=page(data),next=otherTabSave(data);
  h.openGroup('g1');
  const f=h.node('groupForm');
  f.classId.value='stock';f.querySelector('[data-sec="0"]').value='5';f.querySelector('[data-sec-class="0"]').value='unused';
  Object.assign(next.allocation.classes[0],{region:'미국',name:'가상 바뀐 주식'});
  Object.assign(next.allocation.classes[1],{region:'해외',name:'가상 바뀐 분류 이름'});
  h.replaceDoc(next);saveForm(f);
  const saved=h.saved();
  assert.deepEqual(saved.allocation.classes.map(c=>({id:c.id,region:c.region,name:c.name})),[
    {id:'stock',region:'미국',name:'가상 바뀐 주식'},
    {id:'unused',region:'해외',name:'가상 바뀐 분류 이름'},
  ]);
});

for(const syncVia of ['replaceDoc','absorbLocal'])test(`막힌 저장 뒤(${syncVia}) 그룹·소분류 분류 선택지가 최신 분류로 갱신되고 남은 입력과 유효한 선택은 유지된다`,()=>{
  const data=allocationTabFixture();
  data.allocation.classes.push({id:'bond',region:'채권',name:'가상 기존 채권'});
  data.allocation.groups[0].sections=[
    {name:'가상 지운 분류 소분류',classId:'unused',target:5},
    {name:'가상 유지 분류 소분류',classId:'bond',target:10},
  ];
  const h=page(data),next=otherTabSave(data);
  h.openGroup('g1');
  const f=h.node('groupForm'),secT0=f.querySelector('[data-sec="0"]'),secC0=f.querySelector('[data-sec-class="0"]'),secT1=f.querySelector('[data-sec="1"]'),secC1=f.querySelector('[data-sec-class="1"]');
  f.name.value='가상 입력 그룹';f.classId.value='unused';f.target.value='25';f.note.value='가상 입력 메모';
  secT0.value='8';secT1.value='12';
  next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
  next.allocation.classes.find(c=>c.id==='bond').name='가상 바뀐 채권';
  next.allocation.classes.push({id:'etf',region:'국내',name:'가상 다른 탭 새 분류'});
  if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
  saveForm(f);
  assert.equal(h.node('groupDialog').open,true);
  assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,1);
  // 다른 입력과 남아 있는 분류 선택은 유지하고, 지워진 분류를 골랐던 칸만 비운다.
  assert.equal(f.name.value,'가상 입력 그룹');assert.equal(f.target.value,'25');assert.equal(f.note.value,'가상 입력 메모');
  assert.equal(secT0.value,'8');assert.equal(secT1.value,'12');
  assert.equal(f.classId.value,'','지워진 그룹 분류는 3번 빈 선택으로 비움');
  assert.equal(secC0.value,'','지워진 소분류 분류는 그룹 분류 따름으로 비움');
  assert.equal(secC1.value,'bond','남아 있는 소분류 분류는 유지');
  for(const html of [f.classId.innerHTML,secC0.innerHTML,secC1.innerHTML]){
    assert.match(html,/value="etf">국내 · 가상 다른 탭 새 분류<\/option>/);
    assert.match(html,/value="bond"[^>]*>채권 · 가상 바뀐 채권<\/option>/);
    assert.doesNotMatch(html,/value="unused"/);
  }
  assert.match(f.classId.innerHTML,/<option value="">분류 없음 · 다시 고르세요<\/option>/);
  assert.doesNotMatch(secC1.innerHTML,/분류 없음 · 다시 고르세요/);
  // 다른 탭이 만든 분류를 바로 골라 저장하면 반영된다. 또한 그새 다시 지우면 두 번째 저장도 막힌다.
  f.classId.value='etf';secC0.value='etf';
  const next2=structuredClone(next);
  next2.allocation.classes=next2.allocation.classes.filter(c=>c.id!=='etf');
  if(syncVia==='replaceDoc')h.replaceDoc(next2);else h.store.absorbLocal=()=>{h.store.doc=next2;};
  saveForm(f);
  assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,2);assert.equal(f.classId.value,'');assert.equal(secC0.value,'');
  // 최종적으로 유효한 분류를 고르면 저장된다.
  f.classId.value='stock';secC0.value='bond';
  saveForm(f);
  const saved=h.saved();
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
  assert.equal(saved.allocation.groups[0].classId,'stock');
  assert.deepEqual(saved.allocation.groups[0].sections,[
    {name:'가상 지운 분류 소분류',classId:'bond',target:8},
    {name:'가상 유지 분류 소분류',classId:'bond',target:12},
  ]);
});

test('막힌 저장 뒤 선택지 갱신에서도 임시 해외·중국 유지와 기존 해외·중국 재사용을 지킨다',()=>{
  // 1) 막힌 시점에도 해외·중국이 없으면 기존 tempChina ID를 유지하고 중복 생성하지 않는다.
  {
    const data=allocationTabFixture();
    data.allocation.groups[0].sections=[{name:'가상 소분류',classId:'unused',target:5}];
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),tempId=/<option value="([^"]+)">해외 · 중국<\/option>/.exec(f.classId.innerHTML)?.[1];
    assert.ok(tempId);
    f.classId.value='temp';f.classId.value=tempId;
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
    next.allocation.classes.push({id:'etf',region:'국내',name:'가상 새 분류'});
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);
    assert.equal(f.classId.value,tempId,'임시 해외·중국 선택은 유지');
    assert.equal(f.querySelector('[data-sec-class="0"]').value,'');
    assert.equal((f.classId.innerHTML.match(/해외 · 중국/g)||[]).length,1);
    assert.match(f.querySelector('[data-sec-class="0"]').innerHTML,/value="etf"/);
    f.querySelector('[data-sec-class="0"]').value='etf';saveForm(f);
    const china=h.saved().allocation.classes.filter(c=>c.region==='해외'&&c.name==='중국');
    assert.equal(china.length,1);assert.equal(china[0].id,tempId);
  }
  // 2) 막힌 시점 사이에 다른 탭이 해외·중국을 만들었으면 그 ID로 갈아타며 중복 옵션을 만들지 않는다.
  for(const legacy of [false,true]){
    const data=allocationTabFixture();
    data.allocation.groups[0].sections=[{name:'가상 소분류',classId:'unused',target:5}];
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),tempId=/<option value="([^"]+)">해외 · 중국<\/option>/.exec(f.classId.innerHTML)?.[1];
    f.classId.value=tempId;
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
    next.allocation.classes.push(legacy?{id:'cn-tab-b',region:'중국',name:'주식'}:{id:'cn-tab-b',region:'해외',name:'중국'});
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);
    assert.equal(f.classId.value,'cn-tab-b');
    assert.equal((f.classId.innerHTML.match(/해외 · 중국/g)||[]).length,1);
    assert.doesNotMatch(f.classId.innerHTML,new RegExp(`value="${tempId}"`));
    // 갱신된 뒤 그 다른 탭 분류가 다시 지워지면 임시 예외가 아니라 실제 삭제된 분류로 막는다.
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='cn-tab-b');
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.alerts.length,2);assert.match(h.alerts[1],/중국/);assert.equal(f.classId.value,'');
  }
});

for(const syncVia of ['replaceDoc','absorbLocal'])test(`다른 탭이 없앤 소분류를 건드리지 않으면(${syncVia}) 저장 때 다시 만들지 않는다`,()=>{
  // 1) 실제 UI 재현 경로: g.sections 없이 items[].section만 있던 소분류를 다른 탭에서 비움
  {
    const data=allocationTabFixture(),g=data.allocation.groups[0];
    g.items[0].section='사라질 소분류';
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    delete next.allocation.groups[0].items[0].section;
    const f=h.node('groupForm');f.name.value='가상 이름 변경';f.note.value='가상 메모 유지';
    if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
    saveForm(f);
    const savedGroup=h.saved().allocation.groups[0];
    assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
    assert.equal(savedGroup.name,'가상 이름 변경');assert.equal(savedGroup.note,'가상 메모 유지');
    assert.equal(Object.hasOwn(savedGroup,'sections'),false,'남은 소분류가 없으면 빈 sections를 만들지 않음');
  }
  // 2) 소분류 목표가 있던 소분류도 건드리지 않고 다른 소분류만 남았으면 없어진 이름만 뺀다
  {
    const data=allocationTabFixture(),g=data.allocation.groups[0];
    g.sections=[{name:'사라질 소분류',target:5},{name:'남는 소분류',target:10}];
    g.items.push({id:'keep-it',name:'가상 남는 종목',section:'남는 소분류'});
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    next.allocation.groups[0].sections=next.allocation.groups[0].sections.filter(s=>s.name!=='사라질 소분류');
    const f=h.node('groupForm');f.querySelector('[data-sec="1"]').value='15';
    if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
    saveForm(f);
    assert.deepEqual(h.saved().allocation.groups[0].sections,[{name:'남는 소분류',target:15}]);
  }
  // 3) 종목 합산(disabled)이던 소분류가 다른 탭에서 삭제돼도 건드리지 않았으면 통과
  {
    const data=allocationTabFixture(),g=data.allocation.groups[0];
    g.items[0].section='사라질 합산 소분류';
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    delete next.allocation.groups[0].items[0].section;
    next.allocation.groups[0].items[0].target=20;
    const f=h.node('groupForm');f.note.value='가상 합산 메모';
    if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
    saveForm(f);
    assert.equal(Object.hasOwn(h.saved().allocation.groups[0],'sections'),false);
  }
});

for(const syncVia of ['replaceDoc','absorbLocal'])for(const kind of ['target','class'])test(`다른 탭이 없앤 소분류의 ${kind==='target'?'목표':'분류'}를 바꿨으면(${syncVia}) 기록을 바꾸기 전에 저장을 막고 입력을 유지한다`,()=>{
  const data=allocationTabFixture(),g=data.allocation.groups[0];
  g.sections=[{name:'남는 소분류',target:3}];
  g.items[0].section='사라질 소분류';
  if(kind==='target')delete g.items[0].target;
  g.items.push({id:'keep-it',name:'가상 남는 종목',section:'남는 소분류'});
  const h=page(data),next=otherTabSave(data);
  h.openGroup('g1');
  const f=h.node('groupForm'),secT0=f.querySelector('[data-sec="0"]'),secC0=f.querySelector('[data-sec-class="0"]'),secT1=f.querySelector('[data-sec="1"]'),secC1=f.querySelector('[data-sec-class="1"]');
  f.name.value='가상 바꾼 그룹';f.target.value='30';f.note.value='가상 메모';
  secT0.value='15';secC0.value='unused';
  if(kind==='target'){secT1.value='9';}
  else{secC1.value='unused';}
  delete next.allocation.groups[0].items[0].section;
  next.allocation.groups[0].sections=[{name:'남는 소분류',target:3}];
  next.allocation.classes.push({id:'etf',region:'국내',name:'가상 새 분류'});
  const beforeNext=JSON.stringify(next);
  if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
  saveForm(f);
  assert.equal(JSON.stringify(next),beforeNext,'막았을 때 메모리 doc은 바꾸지 않음');
  assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
  assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/사라질 소분류/);assert.match(h.alerts[0],/삭제되어 저장하지 않았습니다/);
  assert.equal(h.node('groupDialog').open,true);
  assert.equal(f.name.value,'가상 바꾼 그룹');assert.equal(f.target.value,'30');assert.equal(f.note.value,'가상 메모');
  assert.equal(secT0.value,'15');assert.equal(secC0.value,'unused');
  assert.equal(secT1.value,kind==='target'?'9':'10');assert.equal(secC1.value,kind==='class'?'unused':'');
  assert.match(secC1.innerHTML,/value="etf"/,'막힌 뒤 선택지 갱신 유지');
  // 문제된 소분류 입력만 원래대로 돌리면 남는 소분류 변경을 포함해 저장할 수 있다.
  if(kind==='target')secT1.value='';else secC1.value='';
  if(syncVia==='absorbLocal')h.store.absorbLocal=()=>{h.store.doc=next;};
  saveForm(f);
  const saved=h.saved();
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
  assert.deepEqual(saved.allocation.groups[0].sections,[{name:'남는 소분류',target:15,classId:'unused'}]);
});

test('소분류 목표를 비우거나 0으로 바꾼 뒤 다른 탭에서 소분류가 없어져도 수정을 감지해 저장을 막는다',()=>{
  const data=allocationTabFixture(),g=data.allocation.groups[0];
  g.sections=[{name:'사라질 소분류',target:5}];
  for(const editedTarget of ['','0']){
    const copy=structuredClone(data),h=page(copy),next=otherTabSave(copy);
    h.openGroup('g1');
    const f=h.node('groupForm'),secT=f.querySelector('[data-sec="0"]');
    secT.value=editedTarget;
    delete next.allocation.groups[0].sections;
    const beforeNext=JSON.stringify(next);
    h.replaceDoc(next);saveForm(f);
    assert.equal(JSON.stringify(next),beforeNext);
    assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/사라질 소분류/);
    assert.equal(h.node('groupDialog').open,true);assert.equal(secT.value,editedTarget);
  }
  // 소분류와 그 소분류가 가리키던 큰 분류가 함께 사라져도 건드리지 않았으면 통과하고, 수정 뒤 되돌릴 때도 막히지 않는다.
  for(const edited of [false,true]){
    const copy=allocationTabFixture();copy.allocation.groups[0].sections=[{name:'사라질 소분류',classId:'unused',target:5}];
    const h=page(copy),next=otherTabSave(copy);
    h.openGroup('g1');
    const f=h.node('groupForm'),secT=f.querySelector('[data-sec="0"]'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 메모 저장';if(edited)secT.value='9';
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
    delete next.allocation.groups[0].sections;
    h.replaceDoc(next);saveForm(f);
    if(!edited){
      assert.equal(h.alerts.length,0);assert.deepEqual(h.writes,['allocation']);assert.equal(Object.hasOwn(h.saved().allocation.groups[0],'sections'),false);
    }else{
      assert.equal(h.alerts.length,1);assert.equal(secC.value,'');
      secT.value='5';saveForm(f);
      assert.equal(h.alerts.length,1);assert.deepEqual(h.writes,['allocation']);assert.equal(Object.hasOwn(h.saved().allocation.groups[0],'sections'),false);
    }
  }
});

test('처음부터 목록에 없는 분류 ID를 가진 그룹을 열면 빈 선택을 보여 선택하고 저장을 막으며 열기만으로는 기록을 바꾸지 않는다',()=>{
  for(const badClassId of ['missing-id','',undefined]){
    const data=allocationTabFixture(),g=data.allocation.groups[0];
    if(badClassId===undefined)delete g.classId;else g.classId=badClassId;
    const before=JSON.stringify(data),h=page(data),f=h.node('groupForm');
    h.openGroup('g1');
    assert.equal(JSON.stringify(data),before,'열기만 해서는 기록을 바꾸지 않음');
    assert.deepEqual(h.writes,[]);
    assert.equal(f.classId.value,'');
    assert.match(f.classId.innerHTML,/^<option value="">분류 없음 · 다시 고르세요<\/option>/);
    // 창을 닫기만 해도 기록은 그대로 유지된다.
    h.node('groupDialog').close();
    assert.equal(JSON.stringify(data),before);
    // 다시 열어 입력을 고치고 빈 선택 그대로 저장하면 막고 입력과 창을 유지한다.
    h.openGroup('g1');
    f.name.value='가상 이름 유지';f.target.value='20';f.note.value='가상 메모 유지';
    saveForm(f);
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
    assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/큰 분류를 고르세요/);
    assert.equal(h.node('groupDialog').open,true);
    assert.equal(f.name.value,'가상 이름 유지');assert.equal(f.target.value,'20');assert.equal(f.note.value,'가상 메모 유지');assert.equal(f.classId.value,'');
    assert.match(f.classId.innerHTML,/^<option value="">분류 없음 · 다시 고르세요<\/option>/);
    // 유효한 큰 분류를 고르면 저장되고 기록과 화면이 갱신된다.
    f.classId.value='stock';saveForm(f);
    const saved=h.saved();
    assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
    assert.equal(saved.allocation.groups[0].classId,'stock');
    assert.equal(saved.allocation.groups[0].name,'가상 이름 유지');
  }
});

test('정상 그룹과 새 그룹 창에는 분류 없음 빈 선택을 보이지 않는다',()=>{
  const data=allocationTabFixture(),h=page(data),f=h.node('groupForm');
  h.openGroup('g1');
  assert.equal(f.classId.value,'stock');
  assert.doesNotMatch(f.classId.innerHTML,/분류 없음 · 다시 고르세요|<option value=""/);
  h.node('groupDialog').close();
  h.ctx.openGroup(null);
  assert.equal(f.classId.value,'stock');
  assert.doesNotMatch(f.classId.innerHTML,/분류 없음 · 다시 고르세요|<option value=""/);
});

for(const syncVia of ['replaceDoc','absorbLocal'])test(`소분류 분류를 건드리지 않고 메모만 수정한 뒤(${syncVia}) 다른 탭이 소분류를 다른 분류로 바꾸고 이전 분류를 지워도 재시도 저장에서 소분류 분류가 유지된다`,()=>{
  const base=()=>{
    const d=allocationTabFixture();
    d.allocation.classes.push({id:'D',region:'국내',name:'가상 분류 D'},{id:'E',region:'국내',name:'가상 분류 E'},{id:'F',region:'국내',name:'가상 분류 F'});
    d.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'D',target:5}];
    return d;
  };
  // 1) 경고 닫고 아무것도 바꾸지 않은 채 다시 저장 -> B가 저장한 E와 A의 메모 모두 유지
  {
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 A 메모';
    next.allocation.groups[0].sections[0].classId='E';
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='D');
    if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
    saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);assert.equal(f.note.value,'가상 A 메모');
    assert.equal(secC.value,'E');assert.doesNotMatch(secC.innerHTML,/value="D"/);
    saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,'가상 A 메모');
    assert.equal(saved.allocation.groups[0].sections[0].classId,'E');
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'E');
  }
  // 2) 막힌 뒤 사용자가 직접 다른 유효한 분류(F)나 '그룹 분류 따름'('')을 고르면 그 선택이 반영됨
  for(const choice of ['F','']){
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value=`가상 선택 ${choice||'follow'}`;
    next.allocation.groups[0].sections[0].classId='E';
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='D');
    if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
    saveForm(f);
    secC.value=choice;
    saveForm(f);
    const saved=h.saved(),sec=saved.allocation.groups[0].sections[0];
    assert.equal(saved.allocation.groups[0].note,`가상 선택 ${choice||'follow'}`);
    if(choice)assert.equal(sec.classId,choice);
    else assert.equal(Object.hasOwn(sec,'classId'),false);
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,choice);
  }
  // 3) D가 지워지지 않았더라도 다른 탭이 E로 바꾼 뒤 메모만 저장하면 E가 유지됨
  {
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    h.node('groupForm').note.value='가상 무차단 메모';
    next.allocation.groups[0].sections[0].classId='E';
    if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};
    saveForm(h.node('groupForm'));
    assert.equal(h.saved().allocation.groups[0].note,'가상 무차단 메모');
    assert.equal(h.saved().allocation.groups[0].sections[0].classId,'E');
  }
});

test('수정 중인 소분류와 그 소분류가 고른 큰 분류가 함께 삭제되면 소분류 삭제를 알리고 자동 초기화만으로 닫히지 않는다',()=>{
  // 1) Repro 2: item.section만 있는 소분류 S의 분류를 '' -> D로 바꾼 뒤 다른 탭이 S와 D를 모두 삭제
  {
    const data=allocationTabFixture();
    data.allocation.groups[0].items[0].section='사라질 소분류 S';
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 메모 유지';secC.value='unused';
    delete next.allocation.groups[0].items[0].section;
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
    const beforeNext=JSON.stringify(next);
    h.replaceDoc(next);saveForm(f);
    assert.equal(JSON.stringify(next),beforeNext);assert.deepEqual(h.writes,[]);
    assert.equal(h.node('groupDialog').open,true);assert.equal(f.note.value,'가상 메모 유지');
    assert.equal(h.alerts.length,1);
    assert.match(h.alerts[0],/사라질 소분류 S/);assert.match(h.alerts[0],/삭제되어 저장하지 않았습니다/);
    assert.notEqual(secC.value,'');assert.doesNotMatch(secC.innerHTML,/value="unused"/);
    // 사용자가 충돌을 명시적으로 해소하기 전에는 두 번째 저장도 막히고 저장 횟수는 0회여야 한다.
    saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,2);
    assert.match(h.alerts[1],/사라질 소분류 S/);assert.equal(f.note.value,'가상 메모 유지');
    assert.equal(JSON.stringify(next),beforeNext);
    // 사라진 소분류에 다른 분류를 고른 상태에서도 여전히 막힌다.
    secC.value='stock';saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,3);
    assert.match(h.alerts[2],/사라질 소분류 S/);
    // '그룹 분류 따름'('')으로 충돌을 명시적으로 해소한 뒤에야 S를 되살리지 않고 저장된다.
    secC.value='';saveForm(f);
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(h.saved().allocation.groups[0].note,'가상 메모 유지');
    assert.equal(Object.hasOwn(h.saved().allocation.groups[0],'sections'),false);
  }
  // 2) 목표까지 함께 수정했으면 목표만 되돌려도 소분류 분류 충돌 해소 전까지 차단 유지
  {
    const data=allocationTabFixture();
    data.allocation.groups[0].items[0].section='사라질 소분류 S';
    delete data.allocation.groups[0].items[0].target;
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secT=f.querySelector('[data-sec="0"]'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 충돌 메모';secT.value='12';secC.value='unused';
    delete next.allocation.groups[0].items[0].section;
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='unused');
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);
    assert.match(h.alerts[0],/사라질 소분류 S/);assert.notEqual(secC.value,'');assert.equal(secT.value,'12');
    saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,2);assert.match(h.alerts[1],/사라질 소분류 S/);
    secT.value='';saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,3);assert.match(h.alerts[2],/사라질 소분류 S/);
    secC.value='';saveForm(f);
    assert.equal(h.node('groupDialog').open,false);assert.equal(h.saved().allocation.groups[0].note,'가상 충돌 메모');
    assert.equal(Object.hasOwn(h.saved().allocation.groups[0],'sections'),false);
  }
  // 3) 그룹 분류와 수정한 사라진 소분류 분류가 동시에 삭제되면 둘 다 알리고 모두 해소 후 S를 살리지 않고 저장
  {
    const data=allocationTabFixture();
    data.allocation.classes.push({id:'D_grp',region:'국내',name:'가상 그룹 분류'});
    data.allocation.groups[0].items[0].section='사라질 소분류 S';
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.classId.value='D_grp';secC.value='unused';f.note.value='가상 동시 삭제 메모';
    delete next.allocation.groups[0].items[0].section;
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='D_grp'&&c.id!=='unused');
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);
    assert.match(h.alerts[0],/가상 그룹 분류/);assert.match(h.alerts[0],/사라질 소분류 S/);
    assert.equal(f.classId.value,'');assert.notEqual(secC.value,'');
    f.classId.value='stock';saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,2);
    secC.value='';saveForm(f);
    assert.equal(h.node('groupDialog').open,false);
    assert.equal(h.saved().allocation.groups[0].note,'가상 동시 삭제 메모');
    assert.equal(Object.hasOwn(h.saved().allocation.groups[0],'sections'),false);
  }
});

for(const syncVia of ['replaceDoc','absorbLocal'])test(`소분류가 그룹 분류를 따르는 상태에서(${syncVia}) A가 D를 고르고 B가 S를 E로 저장한 뒤 D를 지워도 자동 비우기로 E가 지워지지 않고, 직접 그룹 분류 따름을 고르면 상속이 저장된다`,()=>{
  const base=()=>{
    const d=allocationTabFixture();
    d.allocation.classes.push({id:'D',region:'국내',name:'가상 분류 D'},{id:'E',region:'국내',name:'가상 분류 E'});
    d.allocation.groups[0].items[0].section='가상 소분류 S';
    return d;
  };
  const applySync=(h,next)=>{if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};};
  // 1) D 삭제 경고 후 선택을 건드리지 않고 그대로 재시도 -> B가 저장한 E 유지
  {
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 2번 그대로 재시도';secC.value='D';
    next.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'E'}];
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='D');
    applySync(h,next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/가상 분류 D/);
    assert.doesNotMatch(secC.innerHTML,/value="D"/);
    saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,'가상 2번 그대로 재시도');
    assert.equal(saved.allocation.groups[0].sections[0].classId,'E');
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'E');
  }
  // 2) D 삭제 경고 후 A가 직접 '그룹 분류 따름'('')을 고르면 상속(classId 미저장)이 반영됨
  {
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 2번 직접 따름';secC.value='D';
    next.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'E'}];
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='D');
    applySync(h,next);saveForm(f);
    assert.notEqual(secC.value,'','직접 선택 전까지는 빈 상속 값과 구분되어야 함');
    secC.value='';
    saveForm(f);
    const saved=h.saved(),sec=saved.allocation.groups[0].sections[0];
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,'가상 2번 직접 따름');
    assert.equal(Object.hasOwn(sec,'classId'),false);
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'');
  }
});

for(const explicitChoice of ['F',''])test(`A가 소분류를 D→${explicitChoice||'그룹 분류 따름'}로 바꾸고 삭제될 그룹 분류 X를 고른 뒤 경고 후 복구하는 사이 B가 ${explicitChoice||'그룹 분류 따름'}→E로 바꿔도 A 화면의 선택이 유지된다`,()=>{
  const data=allocationTabFixture();
  data.allocation.classes.push(
    {id:'D',region:'국내',name:'가상 분류 D'},
    {id:'E',region:'국내',name:'가상 분류 E'},
    {id:'F',region:'국내',name:'가상 분류 F'},
    {id:'X',region:'국내',name:'가상 삭제 그룹 X'},
  );
  data.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'D',target:5}];
  const h=page(data),next1=otherTabSave(data);
  h.openGroup('g1');
  const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
  secC.value=explicitChoice;
  f.classId.value='X';
  next1.allocation.groups[0].sections[0].classId=explicitChoice||'';
  if(!explicitChoice)delete next1.allocation.groups[0].sections[0].classId;
  next1.allocation.classes=next1.allocation.classes.filter(c=>c.id!=='X');
  h.replaceDoc(next1);saveForm(f);
  assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/가상 삭제 그룹 X/);
  assert.equal(secC.value,explicitChoice);
  f.classId.value='stock';
  const next2=structuredClone(next1);
  next2.allocation.groups[0].sections[0].classId='E';
  h.replaceDoc(next2);saveForm(f);
  const saved=h.saved(),sec=saved.allocation.groups[0].sections[0];
  assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
  if(explicitChoice)assert.equal(sec.classId,explicitChoice);
  else assert.equal(Object.hasOwn(sec,'classId'),false);
  const reopened=page(saved);reopened.openGroup('g1');
  assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,explicitChoice);
});

test('그룹과 소분류 S의 classId가 모두 같은 분류로 저장돼 그룹 분류 따름으로 표시될 때 그룹 분류만 바꾸면 S도 새 그룹 분류를 따른다',()=>{
  const data=fixture();
  data.allocation.classes=[{id:'home',region:'국내',name:'가상 기본'},{id:'E',region:'국내',name:'가상 새 분류'}];
  data.allocation.groups=[{id:'g1',name:'가상 상속 그룹',classId:'home',sections:[{name:'가상 소분류 S',classId:'home',target:5}],items:[]}];
  const h=page(data),f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
  h.openGroup('g1');
  assert.equal(f.classId.value,'home');
  assert.equal(secC.value,'');
  f.classId.value='E';
  saveForm(f);
  const saved=h.saved(),grp=saved.allocation.groups[0],sec=grp.sections[0];
  assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
  assert.equal(grp.classId,'E');
  assert.equal(Object.hasOwn(sec,'classId'),false);
  const reopened=page(saved);reopened.openGroup('g1');
  assert.equal(reopened.node('groupForm').classId.value,'E');
  assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'');
});

test('소분류 목표를 건드리지 않고 메모만 수정하는 사이 다른 탭이 바꾼 소분류 목표가 유지된다',()=>{
  // 1) 건드리지 않은 목표는 다른 탭의 변경(20%)이 보존된다
  {
    const data=allocationTabFixture();
    data.allocation.groups[0].sections=[{name:'가상 소분류 S',target:5}];
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm');
    f.note.value='목표 미수정 메모';
    next.allocation.groups[0].sections[0].target=20;
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.saved().allocation.groups[0].note,'목표 미수정 메모');
    assert.equal(h.saved().allocation.groups[0].sections[0].target,20);
  }
  // 2) 사용자가 직접 목표를 고치면 그 목표(12%)가 반영된다
  {
    const data=allocationTabFixture();
    data.allocation.groups[0].sections=[{name:'가상 소분류 S',target:5}];
    const h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm');
    f.querySelector('[data-sec="0"]').value='12';
    next.allocation.groups[0].sections[0].target=20;
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.saved().allocation.groups[0].sections[0].target,12);
  }
});

test('앞뒤 공백이 포함된 기존 분류 ID가 있어도 메모 저장만으로 ID가 잘리지 않고 다시 열어도 선택이 유지된다',()=>{
  const data=fixture();
  data.allocation.classes=[{id:' stock ',region:'미국',name:'주식'},{id:' bond ',region:'채권',name:'가상 채권'}];
  data.allocation.groups=[{id:'g1',name:'가상 공백 ID 그룹',classId:' stock ',sections:[{name:'가상 소분류',classId:' bond ',target:5}],items:[]}];
  const h=page(data),f=h.node('groupForm');
  h.openGroup('g1');
  assert.equal(f.classId.value,' stock ');
  assert.equal(f.querySelector('[data-sec-class="0"]').value,' bond ');
  assert.doesNotMatch(f.classId.innerHTML,/분류 없음 · 다시 고르세요/);
  f.note.value='공백 ID 메모 유지';
  saveForm(f);
  const saved=h.saved();
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
  assert.equal(saved.allocation.classes[0].id,' stock ');
  assert.equal(saved.allocation.classes[1].id,' bond ');
  assert.equal(saved.allocation.groups[0].classId,' stock ');
  assert.equal(saved.allocation.groups[0].sections[0].classId,' bond ');
  assert.equal(saved.allocation.groups[0].note,'공백 ID 메모 유지');
  const reopened=page(saved);reopened.openGroup('g1');
  assert.equal(reopened.node('groupForm').classId.value,' stock ');
  assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,' bond ');
  assert.doesNotMatch(reopened.node('groupForm').classId.innerHTML,/분류 없음 · 다시 고르세요/);
  // 공백뿐인 없는 ID와 빈 선택 저장은 여전히 막힌다.
  const bad=structuredClone(saved);bad.allocation.groups[0].classId='   ';
  const hb=page(bad),fb=hb.node('groupForm');
  hb.openGroup('g1');
  assert.equal(fb.classId.value,'');assert.match(fb.classId.innerHTML,/^<option value="">분류 없음 · 다시 고르세요<\/option>/);
  saveForm(fb);
  assert.deepEqual(hb.writes,[]);assert.match(hb.alerts[0],/큰 분류를 고르세요/);
});

for(const syncVia of ['replaceDoc','absorbLocal'])test(`소분류와 고른 분류가 삭제돼 경고를 받은 뒤(${syncVia}) 다른 탭이 같은 이름의 소분류를 새 분류 E로 다시 만들면 재시도에서 E를 보존하거나 충돌을 다시 알린다`,()=>{
  const base=()=>{
    const d=allocationTabFixture();
    d.allocation.classes.push({id:'D',region:'국내',name:'가상 분류 D'},{id:'E',region:'국내',name:'가상 분류 E'},{id:'F',region:'국내',name:'가상 분류 F'});
    d.allocation.groups[0].sections=[{name:'가상 소분류 S',target:5}];
    return d;
  };
  const applySync=(h,next)=>{if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};};
  // 1) 재시도 전 JSON에 E가 있고, 그대로 재시도해도 E가 지워지지 않으며 최종 저장·재열기까지 E가 유지된다
  {
    const data=base(),h=page(data),next1=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 1번 재시도 메모';secC.value='D';
    delete next1.allocation.groups[0].sections;
    next1.allocation.classes=next1.allocation.classes.filter(c=>c.id!=='D');
    applySync(h,next1);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);assert.deepEqual(h.writes,[]);
    const next2=structuredClone(next1);
    next2.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'E',target:5}];
    const beforeNext2=JSON.stringify(next2);
    applySync(h,next2);saveForm(f);
    assert.equal(JSON.stringify(next2),beforeNext2,'경고 재시도 중 새 소분류 E가 지워지면 안 됨');
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,2);
    assert.match(h.alerts[1],/가상 소분류 S/);
    saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,'가상 1번 재시도 메모');
    assert.equal(saved.allocation.groups[0].sections[0].classId,'E');
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'E');
  }
  // 2) 충돌 안내 후 사용자가 직접 다른 분류(F)나 '그룹 분류 따름'('')을 고르면 그 선택이 반영된다
  for(const choice of ['F','']){
    const data=base(),h=page(data),next1=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value=`가상 1번 직접 ${choice||'follow'}`;secC.value='D';
    delete next1.allocation.groups[0].sections;
    next1.allocation.classes=next1.allocation.classes.filter(c=>c.id!=='D');
    applySync(h,next1);saveForm(f);
    const next2=structuredClone(next1);
    next2.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'E',target:5}];
    applySync(h,next2);saveForm(f);
    secC.value=choice;
    saveForm(f);
    const saved=h.saved(),sec=saved.allocation.groups[0].sections[0];
    assert.equal(saved.allocation.groups[0].note,`가상 1번 직접 ${choice||'follow'}`);
    if(choice)assert.equal(sec.classId,choice);
    else assert.equal(Object.hasOwn(sec,'classId'),false);
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,choice);
  }
});

for(const syncVia of ['replaceDoc','absorbLocal'])test(`D 삭제 경고 뒤(${syncVia}) 자동 안내 옵션을 그대로 두면 타 탭 F가 유지되고, E를 직접 고른 뒤 타 탭이 F로 바꿔도 A가 고른 E가 저장된다`,()=>{
  const base=()=>{
    const d=allocationTabFixture();
    d.allocation.classes.push({id:'D',region:'국내',name:'가상 분류 D'},{id:'E',region:'국내',name:'가상 분류 E'},{id:'F',region:'국내',name:'가상 분류 F'});
    d.allocation.groups[0].items[0].section='가상 소분류 S';
    return d;
  };
  const applySync=(h,next)=>{if(syncVia==='replaceDoc')h.replaceDoc(next);else h.store.absorbLocal=()=>{h.store.doc=next;};};
  // 1) 자동 안내 옵션을 그대로 두고 B가 E->F로 바꾼 뒤 A가 저장 -> 최신값 F 유지
  {
    const data=base(),h=page(data),next1=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 2번 자동유지';secC.value='D';
    next1.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'E'}];
    next1.allocation.classes=next1.allocation.classes.filter(c=>c.id!=='D');
    applySync(h,next1);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);
    const next2=structuredClone(next1);
    next2.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'F'}];
    applySync(h,next2);saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,'가상 2번 자동유지');
    assert.equal(saved.allocation.groups[0].sections[0].classId,'F');
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'F');
  }
  // 2) 자동 안내 옵션에서 E를 직접 고른 뒤 B가 F로 바꾸고 A가 저장 -> A가 직접 고른 E 저장
  {
    const data=base(),h=page(data),next1=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value='가상 2번 직접선택';secC.value='D';
    next1.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'E'}];
    next1.allocation.classes=next1.allocation.classes.filter(c=>c.id!=='D');
    applySync(h,next1);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.equal(h.alerts.length,1);
    secC.value='E';
    const next2=structuredClone(next1);
    next2.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'F'}];
    applySync(h,next2);saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,'가상 2번 직접선택');
    assert.equal(saved.allocation.groups[0].sections[0].classId,'E');
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'E');
  }
});

test("기존 분류 D를 상속('')으로 바꾸거나 E로 바꾼 뒤 S 없는 백업으로 경고받으면 해소·복구 전까지 막히고, 되돌리거나 해소하면 S를 되살리지 않고 메모를 저장한다",()=>{
  const base=()=>{
    const d=allocationTabFixture();
    d.allocation.classes.push({id:'D',region:'국내',name:'가상 분류 D'},{id:'E',region:'국내',name:'가상 분류 E'});
    d.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'D',target:5}];
    return d;
  };
  // 1) D -> ''(상속) 후 B가 S 없는 백업 복원: 그대로 재시도해도 막히고, D 복구 또는 '' 직접 해소를 거치면 S 없이 메모 저장
  for(const resolveTo of ['D','']){
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value=`가상 3A 메모 ${resolveTo||'follow'}`;secC.value='';
    delete next.allocation.groups[0].sections;
    const beforeNext=JSON.stringify(next);
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,1);
    assert.match(h.alerts[0],/가상 소분류 S/);
    assert.notEqual(secC.value,'');assert.notEqual(secC.value,'D');
    saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,2);
    assert.equal(f.note.value,`가상 3A 메모 ${resolveTo||'follow'}`);assert.equal(JSON.stringify(next),beforeNext);
    secC.value=resolveTo;
    saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,`가상 3A 메모 ${resolveTo||'follow'}`);
    assert.equal(Object.hasOwn(saved.allocation.groups[0],'sections'),false);
  }
  // 2) D -> E 편집 후 B가 S 없는 백업 복원: 그대로 재시도하면 막히고, 원래 D로 되돌리거나 ''로 해소하면 S 없이 메모 저장
  for(const resolveTo of ['D','']){
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    f.note.value=`가상 3B 메모 ${resolveTo||'follow'}`;secC.value='E';
    delete next.allocation.groups[0].sections;
    const beforeNext=JSON.stringify(next);
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,1);
    assert.match(h.alerts[0],/가상 소분류 S/);assert.equal(secC.value,'E');
    saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);assert.equal(h.alerts.length,2);
    assert.equal(f.note.value,`가상 3B 메모 ${resolveTo||'follow'}`);assert.equal(JSON.stringify(next),beforeNext);
    secC.value=resolveTo;
    saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].note,`가상 3B 메모 ${resolveTo||'follow'}`);
    assert.equal(Object.hasOwn(saved.allocation.groups[0],'sections'),false);
  }
});

test('백업의 실제 분류 ID가 __cleared__와 __deleted__여도 충돌 상태와 구별돼 저장·재열기와 삭제 차단이 정상 동작한다',()=>{
  const base=()=>{
    const d=allocationTabFixture();
    d.allocation.classes=[
      {id:'stock',region:'미국',name:'주식'},
      {id:'__cleared__',region:'국내',name:'가상 클리어드'},
      {id:'__deleted__',region:'국내',name:'가상 딜리티드'},
    ];
    d.allocation.groups=[{id:'g1',name:'가상 특수 ID 그룹',classId:'stock',sections:[{name:'가상 소분류 S',target:5}],items:[]}];
    return d;
  };
  // 1) 소분류에서 실제 __cleared__를 골라 저장·재열기해도 유지된다
  {
    const data=base(),h=page(data),f=h.node('groupForm');
    h.openGroup('g1');
    const secC=f.querySelector('[data-sec-class="0"]');
    secC.value='__cleared__';
    saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].sections[0].classId,'__cleared__');
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'__cleared__');
  }
  // 2) 그룹에서 실제 __deleted__를 고른 뒤 다른 탭이 __deleted__를 삭제하면 저장 전에 차단되고 없는 ID가 저장되지 않는다
  {
    const data=base(),h=page(data),next=otherTabSave(data),beforeNext=JSON.stringify(next);
    h.openGroup('g1');
    const f=h.node('groupForm');
    f.classId.value='__deleted__';f.note.value='가상 삭제 ID 차단';
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='__deleted__');
    const expectedNext=JSON.stringify(next);
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);
    assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/가상 딜리티드/);
    assert.equal(f.classId.value,'');assert.match(f.classId.innerHTML,/^<option value="">분류 없음 · 다시 고르세요<\/option>/);
    assert.equal(JSON.stringify(next),expectedNext);
    assert.notEqual(beforeNext,'');
  }
  // 3) 기존 그룹=__deleted__, 소분류=__cleared__를 메모만 바꿔 저장·재열기해도 둘 다 유지된다
  {
    const data=base();
    data.allocation.groups[0].classId='__deleted__';
    data.allocation.groups[0].sections[0].classId='__cleared__';
    const h=page(data),f=h.node('groupForm');
    h.openGroup('g1');
    assert.equal(f.classId.value,'__deleted__');
    assert.equal(f.querySelector('[data-sec-class="0"]').value,'__cleared__');
    f.note.value='가상 특수 ID 유지';
    saveForm(f);
    const saved=h.saved();
    assert.equal(saved.allocation.groups[0].classId,'__deleted__');
    assert.equal(saved.allocation.groups[0].sections[0].classId,'__cleared__');
    const reopened=page(saved);reopened.openGroup('g1');
    assert.equal(reopened.node('groupForm').classId.value,'__deleted__');
    assert.equal(reopened.node('groupForm').querySelector('[data-sec-class="0"]').value,'__cleared__');
  }
  // 4) 소분류에서 실제 __deleted__를 고른 뒤 다른 탭이 __deleted__를 삭제하고 S를 __cleared__로 저장하면 차단 후 최신 __cleared__를 보존한다
  {
    const data=base(),h=page(data),next=otherTabSave(data);
    h.openGroup('g1');
    const f=h.node('groupForm'),secC=f.querySelector('[data-sec-class="0"]');
    secC.value='__deleted__';f.note.value='가상 소분류 삭제 ID';
    next.allocation.groups[0].sections=[{name:'가상 소분류 S',classId:'__cleared__',target:5}];
    next.allocation.classes=next.allocation.classes.filter(c=>c.id!=='__deleted__');
    h.replaceDoc(next);saveForm(f);
    assert.equal(h.node('groupDialog').open,true);assert.deepEqual(h.writes,[]);
    assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/가상 딜리티드/);
    saveForm(f);
    const saved=h.saved();
    assert.equal(h.node('groupDialog').open,false);assert.deepEqual(h.writes,['allocation']);
    assert.equal(saved.allocation.groups[0].sections[0].classId,'__cleared__');
  }
});

function btcFixture(averageCurrency){
  const data=fixture(),quotes=quoteFixture(),item=data.allocation.groups[0].items[0];
  Object.assign(item,{name:'가상 비트코인',ticker:'BTC-USD',shares:.01,averagePrice:70000000});
  if(averageCurrency)item.averageCurrency=averageCurrency;
  quotes.stocks['BTC-USD']={kind:'코인',close:60000,asOf:'2026-01-02'};quotes.fx.close=1400;
  return {data,quotes,item};
}

for(const tradeOnly of [false,true])test(`실제 자산 페이지 등록 코드로 ${tradeOnly?'tradeTicker 단독 ':''}종목 삭제를 취소·승인하고 계획·체결 키·목표를 남은 계좌에 이전한다`,()=>{
  const data=fixture(),a=data.allocation,from=a.groups[0].items[0],plan=from.buyPlan,to={id:'a2',name:'가상 남은 계좌',ticker:'AAA',shares:1};
  if(tradeOnly)for(const it of [from,to]){delete it.ticker;it.tradeTicker='AAA';}to.target=5;
  a.groups[0].items.push(to);plan.buyPriority=['a','a2','b'];
  a.trades={'buy:a:stage':{label:'가상 체결',items:[{id:'a',shares:1}]}};
  const before=JSON.stringify(data),other=JSON.stringify(a.groups[1]),h=page(data);h.open('a');
  assert.equal(JSON.stringify(data),before,'페이지·종목 창을 여는 것만으로 저장 기록을 바꾸지 않음');
  let message='';h.ctx.confirm=text=>{message=text;return false;};h.node('itemDelete').click();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,true);
  assert.match(message,/계획과 체결 기록은 같은 종목/);assert.match(message,/목표 비중 10%는 '가상 남은 계좌' 줄로 옮깁니다/);
  h.ctx.confirm=()=>true;h.node('itemDelete').click();
  assert.deepEqual(a.groups[0].items.map(it=>it.id),['a2']);assert.equal(to.buyPlan,plan);assert.equal(to.target,15);assert.equal(to.shares,1);
  assert.equal(a.trades['buy:a:stage'],undefined);assert.ok(a.trades['buy:a2:stage']);assert.equal(a.trades['buy:a2:stage'].items[0].id,'a','옛 체결의 반영 대상은 보존');
  assert.deepEqual([...plan.buyPriority],['a2','b']);assert.equal(JSON.stringify(a.groups[1]),other);
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('itemDialog').open,false);
  const saved=JSON.parse(h.storage.get('etf-planner-assets-v1'));assert.equal(saved.allocation.groups[0].items[0].id,'a2');assert.ok(saved.allocation.groups[0].items[0].buyPlan);
});

for(const tradeOnly of [false,true])test(`실제 자산 페이지 등록 코드로 ${tradeOnly?'tradeTicker 단독 ':''}그룹 삭제를 취소·승인하고 다른 그룹의 계좌에 계획·체결 키를 이전한다`,()=>{
  const data=fixture(),a=data.allocation,plan=a.groups[0].items[0].buyPlan,to=a.groups[1].items[0];
  if(tradeOnly)for(const it of [a.groups[0].items[0],to]){delete it.ticker;it.tradeTicker='AAA';}to.target=5;
  a.trades={'buy:a:stage':{label:'가상 체결',items:[{id:'a',shares:1}]}};
  const before=JSON.stringify(data),remaining=JSON.parse(JSON.stringify(a.groups[1])),h=page(data);h.openGroup('g1');
  assert.equal(JSON.stringify(data),before,'그룹 창의 분류 선택지도 저장 전에는 기록에 넣지 않음');
  h.ctx.confirm=()=>false;h.node('groupDelete').click();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('groupDialog').open,true);
  h.ctx.confirm=()=>true;h.node('groupDelete').click();
  assert.deepEqual(a.groups.map(g=>g.id),['g2']);assert.equal(to.buyPlan,plan);assert.ok(a.trades['buy:b:stage']);assert.equal(a.trades['buy:a:stage'],undefined);
  assert.equal(to.target,5,'삭제한 그룹의 목표는 다른 그룹에 합산하지 않음');
  const expected=remaining;expected.items[0].buyPlan=plan;assert.deepEqual(JSON.parse(JSON.stringify(a.groups[0])),expected);
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
  assert.deepEqual(JSON.parse(h.storage.get('etf-planner-assets-v1')).allocation.groups.map(g=>g.id),['g2']);
});

test('tradeTicker 단독 종목 삭제의 목표 소멸 문구는 같은 실제 코드가 남아 있을 때 표시한다',()=>{
  for(const same of [false,true]){
    const data=fixture(),from=data.allocation.groups[0].items[0],other=data.allocation.groups[1].items[0];
    delete from.ticker;from.tradeTicker='AAA';delete other.ticker;other.tradeTicker=same?'AAA':'BBB';
    const h=page(data);h.open('a');let message='';h.ctx.confirm=text=>{message=text;return false;};h.node('itemDelete').click();
    if(same)assert.match(message,/목표 비중 10%는 함께 지워집니다/);else assert.doesNotMatch(message,/목표 비중 10%는 함께 지워집니다/);
  }
});

test('평균매수가 통화 선택은 실제 거래 종목이 비트코인일 때만 보이며 달러가 기본이다',()=>{
  const h=page();h.open('a');assert.equal(h.node('averageCurrencySelect').hidden,true);
  h.field('ticker','BTC-USD');assert.equal(h.node('averageCurrencySelect').hidden,false);assert.equal(h.node('averageCurrencySelect').value,'');
  assert.equal(h.node('averagePriceLabel').textContent,'평균매수가 (달러 (USD) · 1 BTC 기준)');
  h.field('tradeTicker','111111');assert.equal(h.node('averageCurrencySelect').hidden,true);
  h.field('tradeTicker','');assert.equal(h.node('averageCurrencySelect').hidden,false);
  h.field('ticker','AAA');assert.equal(h.node('averageCurrencySelect').hidden,true);assert.deepEqual(h.writes,[]);
  const modal=read('assets.html').split('<dialog id="itemDialog"')[1].split('</dialog>')[0];
  assert.match(modal,/<select name="averageCurrency"[^>]*aria-label="평균매수가 통화"[^>]*hidden>/);
  assert.match(modal,/<option value="">달러 \(USD\)<\/option><option value="KRW">원화 \(KRW\)<\/option>/);
});

test('비트코인 원화 선택은 즉시 라벨·환산 현재가·손익을 미리 보여 주고 저장할 때만 필드를 만든다',()=>{
  const {data,quotes,item}=btcFixture(),h=page(data,quotes),before=JSON.stringify(data);h.open('a');h.selectCurrency('KRW');
  assert.equal(h.node('averagePriceLabel').textContent,'평균매수가 (원 (KRW) · 1 BTC 기준)');
  assert.match(h.node('averagePriceHolding').innerHTML,/0\.01 BTC/);assert.match(h.node('averagePriceHolding').innerHTML,/\$60,000.*원화 환산 84,000,000원/);
  assert.match(h.node('averagePricePreview').innerHTML,/\+140,000원/);assert.match(h.node('averagePricePreview').innerHTML,/\+20%/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);h.submit();
  assert.equal(item.averageCurrency,'KRW');assert.equal(item.averagePrice,70000000);assert.deepEqual(h.writes,['allocation']);
  assert.match(h.row('a'),/평균매수가 70,000,000원/);assert.match(h.row('a'),/손익 <b class="profit-gain">\+140,000원/);assert.match(h.row('a'),/0\.01 BTC/);assert.doesNotMatch(h.row('a'),/0\.01주/);
  assert.match(h.row('a'),/title="Coinbase 달러 시세 \$60,000 × 현재 환율 1,400원 = 84,000,000원 기준 · 국내 거래소 원화 시세와 차이가 날 수 있음"/);
  const card=h.html().split('<section class="card alloc-profit"')[1].split('</section>')[0];
  assert.match(card,/원화 합계<\/span><strong class="profit-loss">−20,000원/);
  assert.match(card,/원화 평균매수가 비트코인은 달러 시세 × 현재 환율로 계산/);
});

test('비트코인 통화를 달러로 되돌리거나 평균가를 비우거나 종목을 바꾸면 선택 필드를 삭제한다',()=>{
  for(const action of ['usd','empty','ticker','tradeTicker']){
    const {data,quotes,item}=btcFixture('KRW'),h=page(data,quotes);h.open('a');
    if(action==='usd')h.selectCurrency('');
    if(action==='empty')h.edit('');
    if(action==='ticker')h.field('ticker','AAA');
    if(action==='tradeTicker'){h.field('ticker','AAA');h.field('tradeTicker','111111');}
    h.submit();assert.equal(Object.hasOwn(item,'averageCurrency'),false,action);assert.deepEqual(h.writes,['allocation']);
    if(action==='empty')assert.equal(Object.hasOwn(item,'averagePrice'),false);else assert.equal(item.averagePrice,70000000);
  }
});

test('비트코인 통화 선택을 취소하거나 저장 없이 조회하면 기록을 바꾸지 않는다',()=>{
  for(const currency of [undefined,'KRW']){
    const {data,quotes}=btcFixture(currency),h=page(data,quotes),before=JSON.stringify(data);h.open('a');
    h.selectCurrency(currency?'':'KRW');h.cancel();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
    h.open('a');h.submit();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
});

test('환율이 없으면 원화 비트코인의 현재가·손익은 환율 대기로 표시하며 BTC 단위를 유지한다',()=>{
  const {data,quotes}=btcFixture('KRW');delete quotes.fx;delete data.allocation.cashFx;
  const h=page(data,quotes);h.open('a');assert.match(h.node('averagePriceHolding').innerHTML,/환율 대기/);assert.match(h.node('averagePricePreview').innerHTML,/환율 대기/);
  assert.match(h.row('a'),/0\.01 BTC/);assert.match(h.row('a'),/asset-profit-result">환율 대기/);
});

test('원화 비트코인의 그룹·같은 종목 합계는 cashFx를 전달하고 달러 계좌와 섞거나 이중 환산하지 않는다',()=>{
  const {data,quotes,item}=btcFixture('KRW');delete quotes.fx;data.allocation.cashFx=1400;
  data.allocation.groups=[{id:'g1',name:'가상 코인 계좌',classId:'stock',items:[item,{...item,id:'krw2'},{...item,id:'usd',averageCurrency:undefined,averagePrice:50000}]}];
  const h=page(data,quotes);h.open('a');assert.match(h.node('averagePricePreview').innerHTML,/\+140,000원/);
  assert.equal(h.node('averagePriceTotal').hidden,false);assert.match(h.node('averagePriceTotal').innerHTML,/계산 가능 2 \/ 2개/);assert.match(h.node('averagePriceTotal').innerHTML,/\+280,000원/);assert.doesNotMatch(h.node('averagePriceTotal').innerHTML,/\$/);
  assert.match(groupHead(h),/\+42만원/);assert.match(groupHead(h),/\+20%/);
  h.selectCurrency('');assert.match(h.node('averagePriceTotal').innerHTML,/계산 가능 2 \/ 2개/);assert.match(h.node('averagePriceTotal').innerHTML,/\$/);
});

test('창을 연 뒤 동기화된 통화는 손대지 않은 선택으로 덮어쓰지 않으며 직접 바꾼 선택만 저장한다',()=>{
  const {data,quotes,item}=btcFixture(),h=page(data,quotes);h.open('a');item.averageCurrency='KRW';h.field('note','가상 새 메모');h.submit();
  assert.equal(item.averageCurrency,'KRW');assert.equal(item.note,'가상 새 메모');
  h.open('a');delete item.averageCurrency;h.field('note','가상 다른 메모');h.submit();assert.equal(Object.hasOwn(item,'averageCurrency'),false);
});

test('금 기준 티커 확인을 취소하면 비트코인 원화 선택과 평균가 변경도 저장하지 않는다',()=>{
  for(const confirmed of [false,true]){
    const data=fixture(),item=data.allocation.groups[0].items[0];Object.assign(item,{section:'금',ticker:'GLDM'});
    const h=page(data),before=JSON.stringify(data),messages=[];h.ctx.confirm=message=>{messages.push(message);return confirmed;};
    h.open('a');h.field('ticker','BTC-USD');h.selectCurrency('KRW');h.edit('70000000');h.submit();
    assert.equal(messages.length,1);
    if(confirmed){assert.equal(item.averageCurrency,'KRW');assert.equal(item.averagePrice,70000000);assert.deepEqual(h.writes,['allocation']);}
    else{assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,true);}
  }
});

// 그룹 손익 검증에는 공개 가능한 가상 종목·수량·가격만 쓴다.
function groupProfitFixture(mixed=false){
  const data=fixture(),quotes=quoteFixture();
  data.allocation.groups=[{id:'g1',name:'가상 계좌',classId:'stock',sections:[{name:'가상 소분류',note:'가상 소분류 메모'}],items:[
    {id:'krw-a',name:'가상 원화 A',ticker:'111111',section:'가상 소분류',shares:300,averagePrice:10000},
    {id:'other',name:'가상 종목 B',ticker:mixed?'AAA':'222222',section:'가상 소분류',shares:100,averagePrice:mixed?100:10000}]}];
  quotes.stocks['222222']={kind:'국내',close:9000,asOf:'2026-01-02'};quotes.stocks.AAA.close=90;
  return {data,quotes};
}
function groupHead(h,group='g1'){
  const html=h.html(),button=html.indexOf(`data-alloc-fold="group:${group}"`);
  assert.ok(button>=0,`그룹 머리 ${group}`);
  return html.slice(html.lastIndexOf('<div class="group-head">',button),html.indexOf('<div class="alloc-fold-body"',button)).trim();
}

test('그룹 원화 손익은 만원으로 표시하고 손익률은 매입금액으로 가중 합산한다',()=>{
  const {data,quotes}=groupProfitFixture(),before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
  assert.match(head,/손익 <b class="profit-gain">\+50만원<\/b><b class="profit-gain">\+12\.5%<\/b>/);
  assert.doesNotMatch(head,/ · \d+\/\d+개|환율 없음/);assert.match(head,/보유 2개 중 2개 합산/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('그룹 혼합 통화는 평가액과 같은 현재 현물 환율로 매입금액·손익을 모두 환산한다',()=>{
  const {data,quotes}=groupProfitFixture(true);data.allocation.cashFx=1800;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/손익 <b class="profit-loss">−60만원<\/b><b class="profit-loss">−4%<\/b>/);
  assert.match(groupHead(h),/title="[^"]*달러 종목은 현재 환율 1,200원으로 환산 · 환차손익 제외"/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  const next=structuredClone(quotes);next.fx.close=1000;h.refresh(next);
  assert.match(groupHead(h),/손익 <b class="profit-loss">−40만원<\/b><b class="profit-loss">−3\.08%<\/b>/);
  assert.match(groupHead(h),/현재 환율 1,000원/);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('현물 환율이 없으면 직접 넣은 cashFx를 그룹 손익에도 적용한다',()=>{
  const {data,quotes}=groupProfitFixture(true);delete quotes.fx;data.allocation.cashFx=1000;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/−40만원<\/b><b class="profit-loss">−3\.08%<\/b>/);
  assert.match(groupHead(h),/현재 환율 1,000원/);assert.doesNotMatch(groupHead(h),/환율 없음| · \d+\/\d+개/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('환율이 전혀 없으면 그룹 원화 종목만 합산하고 달러만 있으면 손익을 숨긴다',()=>{
  const {data,quotes}=groupProfitFixture(true);delete quotes.fx;delete data.allocation.cashFx;
  const before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
  assert.match(head,/손익 <b class="profit-gain">\+60만원<\/b><b class="profit-gain">\+20%<\/b> · 1\/2개 · 환율 없음<\/span>/);
  assert.match(head,/title="[^"]*보유 2개 중 1개 합산 · 환율 없음 · 달러 종목 합산 제외"/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  data.allocation.groups[0].items.shift();const usdOnly=JSON.stringify(data);h.ctx.renderAlloc();
  assert.doesNotMatch(groupHead(h),/group-profit|손익|개 합산|환율 없음/,'합산 가능한 종목이 없으면 안내도 숨긴다');
  assert.equal(JSON.stringify(data),usdOnly);assert.deepEqual(h.writes,[]);
});

test('평균매수가가 일부 없으면 그룹 합산 개수를 표시하고 전부 없으면 손익을 숨긴다',()=>{
  const {data,quotes}=groupProfitFixture();delete data.allocation.groups[0].items[1].averagePrice;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/\+60만원<\/b><b class="profit-gain">\+20%<\/b> · 1\/2개<\/span>/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  delete data.allocation.groups[0].items[0].averagePrice;const empty=JSON.stringify(data);h.ctx.renderAlloc();
  assert.doesNotMatch(groupHead(h),/group-profit|손익|개 합산/);assert.equal(JSON.stringify(data),empty);assert.deepEqual(h.writes,[]);
});

test('그룹 손익은 소분류 유무와 무관하게 그룹 전체를 합산하고 다른 그룹·검색과 분리한다',()=>{
  const {data,quotes}=groupProfitFixture(),item={id:'plain',name:'가상 별도 종목',ticker:'111111',shares:100,averagePrice:10000};
  data.allocation.groups[0].items.push(item);
  data.allocation.groups.push({id:'g2',name:'가상 다른 계좌',classId:'stock',items:[{...item,id:'elsewhere',section:'가상 소분류'}]});
  const before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
  assert.match(head,/\+70만원<\/b><b class="profit-gain">\+14%<\/b>/);assert.doesNotMatch(head,/ · \d+\/\d+개/);
  assert.match(groupHead(h,'g2'),/\+20만원<\/b><b class="profit-gain">\+20%<\/b>/);
  vm.runInContext('allocQuery="가상 원화 A";renderAlloc()',h.ctx);assert.equal(groupHead(h),head,'검색으로 일부 종목만 보여도 합계는 그대로');
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('전체 보유 평가손익은 달러·원화를 현재 환율로 합산하고 종목 줄은 기존 통화를 유지한다',()=>{
  const {data,quotes}=groupProfitFixture(true),before=JSON.stringify(data),h=page(data,quotes);
  assert.match(h.row('other'),/손익 <b class="profit-loss">−\$1,000<\/b><b class="profit-loss">−10%<\/b>/);
  assert.match(h.row('krw-a'),/손익 <b class="profit-gain">\+600,000원/);
  const card=profitCard(h);
  assert.match(card,/원화 합계<\/span><strong class="profit-loss">−600,000원<\/strong><b class="profit-loss">−4%<\/b>/);
  assert.match(card,/현재 환율 1,200원으로 환산/);assert.match(card,/원화 합산 · 환차손익 제외/);assert.doesNotMatch(card,/달러 \(USD\)/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
});

test('그룹 미합산 개수에는 수량·시세 없는 보유를 포함하고 보유 0인 항목은 제외한다',()=>{
  const {data,quotes}=groupProfitFixture(),items=data.allocation.groups[0].items;
  items.push({...items[0],id:'no-shares',shares:undefined,amount:2},{...items[0],id:'no-quote',ticker:'333333'},{...items[0],id:'sold',shares:0});
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/\+50만원<\/b><b class="profit-gain">\+12\.5%<\/b> · 2\/4개<\/span>/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('그룹 손익 금액은 만원 소수 첫째 자리로 반올림하고 0이면 부호와 색을 없앤다',()=>{
  const {data,quotes}=groupProfitFixture();data.allocation.groups[0].items.pop();data.allocation.groups[0].items[0].shares=1;
  const before=JSON.stringify(data),h=page(data,quotes);
  for(const change of [499,-499,0]){
    quotes.stocks['111111'].close=10000+change;h.refresh(quotes);
    assert.match(groupHead(h),/손익 <b class="">0만원<\/b>/);
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
  for(const [change,sign,color]of [[500,'+','profit-gain'],[-500,'−','profit-loss']]){
    quotes.stocks['111111'].close=10000+change;h.refresh(quotes);
    assert.ok(groupHead(h).includes(`손익 <b class="${color}">${sign}0.1만원</b>`));
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
});

test('그룹 손익은 목표 금액 또는 금액·비중과 같은 줄에 두고 접어도 보이며 소분류에서는 제거한다',()=>{
  for(const target of [undefined,25,'linked']){
    const {data,quotes}=groupProfitFixture(),group=data.allocation.groups[0];
    if(target==='linked')group.sections[0].target=25;else if(target!==undefined)group.target=target;
    const before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
    if(target===undefined){
      assert.match(head,/<div class="group-sub"><p><b>[\s\S]*<\/p><span class="group-profit"/);assert.doesNotMatch(head,/group-target/);
    }else{
      assert.match(head,/<\/p><div class="group-sub"><small class="group-target">[^<]*<\/small><span class="group-profit"/);
      if(target==='linked')assert.match(head,/하위 합산/);
    }
    assert.match(head,/aria-expanded="false"/);assert.match(head,/group-profit/);assert.match(h.html(),/id="allocGroup-g1" hidden/);
    const subheads=[...h.html().matchAll(/<div class="sub-head">[\s\S]*?<\/div>/g)];assert.equal(subheads.length,1);
    assert.doesNotMatch(subheads[0][0],/sub-profit|group-profit|손익/);assert.match(subheads[0][0],/가상 소분류 메모/);
    vm.runInContext('allocOpenCards.add("group:g1");renderAlloc()',h.ctx);assert.match(groupHead(h),/aria-expanded="true"/);assert.match(groupHead(h),/group-profit/);
    h.ctx.openTab('strategy');assert.doesNotMatch(h.node('strategyView').innerHTML,/group-profit|보유 평가손익 합계/);h.ctx.openTab('alloc');
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
  }
});

test('평균매수가 미입력 종목에는 손익을 표시하지 않으며 조회·취소는 저장하지 않는다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);
  assert.doesNotMatch(h.row('a'),/평균매수가|평가손익|손익률|asset-profit/,'미입력 안내 줄도 두지 않는다');
  assert.match(h.row('b'),/평균매수가 \$100<\/span><span class="asset-profit-result" title="평가손익 · 손익률">손익 <b class="profit-loss">−\$120<\/b><b class="profit-loss">−40%<\/b>/);assert.match(h.row('domestic'),/profit-gain[^>]*">\+8,000원/);
  h.open('a');assert.equal(h.node('itemDialog').open,true);assert.equal(h.input.value,'');
  assert.match(h.node('averagePriceLabel').textContent,/달러 \(USD\)/);assert.match(h.node('averagePriceHolding').innerHTML,/보유 수량 <b>2주/);
  h.edit('50');assert.match(h.node('averagePricePreview').innerHTML,/\+\$20/);assert.match(h.node('averagePricePreview').innerHTML,/\+20%/);
  assert.equal(JSON.stringify(data),before,'입력 중 미리보기는 저장 객체를 변경하지 않음');
  h.cancel();assert.equal(h.node('itemDialog').open,false);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
  h.open('a');assert.equal(h.input.value,'','취소한 초안이 다음 입력값에 남지 않음');
});

test('평균매수가 추가·수정·빈칸 삭제는 선택 계좌 필드만 저장하며 기존 보유·기준가·계획을 보존한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data),item=data.allocation.groups[0].items[0];
  for(const [value,expected]of [['50',50],['75.25',75.25],['',undefined]]){
    const prior=JSON.parse(JSON.stringify(data));h.open('a');h.edit(value);h.submit();
    assert.equal(item.averagePrice,expected);if(expected===undefined)assert.equal(Object.hasOwn(item,'averagePrice'),false,'빈 선택 필드는 delete');
    if(expected===undefined)delete prior.allocation.groups[0].items[0].averagePrice;else prior.allocation.groups[0].items[0].averagePrice=expected;
    assert.equal(JSON.stringify(data),JSON.stringify(prior),'다른 계좌·수량·평가기준·계획에는 변경 없음');
    assert.equal(h.node('itemDialog').open,false);
  }
  assert.deepEqual(h.writes,['allocation','allocation','allocation']);assert.equal(JSON.stringify(data),before,'추가 후 삭제하면 원래 기록과 같다');
  h.open('a');h.submit();assert.equal(h.writes.length,3,'변경 없는 빈칸 저장은 쓰지 않음');
  h.open('b');h.submit();assert.equal(h.writes.length,3,'기존 가격 그대로 저장해도 쓰지 않음');
});

test('평균매수가 12,345.6은 숫자 12345.6으로 저장하고 다시 열면 쉼표를 표시한다',()=>{
  const h=page();h.open('a');h.edit('12345.6');assert.equal(h.input.value,'12,345.6');h.submit();
  const saved=JSON.parse(h.storage.get('etf-planner-assets-v1')).allocation.groups[0].items[0];
  assert.equal(saved.averagePrice,12345.6);assert.equal(typeof saved.averagePrice,'number');
  h.open('a');assert.equal(h.input.value,'12,345.6');
  const before=JSON.stringify(h.data);h.input.value='9007199254740992';h.submit();
  assert.equal(JSON.stringify(h.data),before);assert.equal(h.input.checkValidity(),false,'입력 이벤트 없이도 저장 직전 재검사');
});

test('평균매수가 입력칸은 원화 정수·달러 소수 한 자리로 보이고 고치지 않으면 정밀값으로 계산·보존한다',()=>{
  const data=fixture(),[domestic,usd]=[data.allocation.groups[1].items[2],data.allocation.groups[1].items[0]];
  domestic.averagePrice=20990.2941177;usd.averagePrice=100.26;
  const h=page(data),before=JSON.stringify(data);
  assert.match(h.row('domestic'),/평균매수가 20,990원</);assert.match(h.row('b'),/평균매수가 \$100\.3</);
  h.open('domestic');assert.equal(h.input.value,'20,990');assert.match(h.node('averagePriceLabel').textContent,/원 \(KRW\)/);
  assert.match(h.node('averagePricePreview').innerHTML,/−35,961원/,'반올림한 20,990원(−35,960원)이 아닌 저장값으로 계산');h.submit();
  h.open('b');assert.equal(h.input.value,'100.3');assert.match(h.node('averagePricePreview').innerHTML,/−\$120\.78/);h.submit();
  assert.equal(JSON.stringify(data),before,'손대지 않고 저장하면 정밀값을 그대로 둔다');assert.deepEqual(h.writes,[]);
  for(const [value,shown]of [[523.04,'523'],[1234.95,'1,235'],[0.04,'0.04']]){usd.averagePrice=value;h.refresh(h.store.prices);assert.match(h.row('b'),new RegExp(`평균매수가 \\$${shown}<`),String(value));h.open('b');assert.equal(h.input.value,shown,String(value));assert.equal(h.input.checkValidity(),true);h.cancel();}
  domestic.averagePrice=0.3;h.open('domestic');assert.equal(h.input.value,'0.3','반올림해 0이면 원래 값');h.cancel();
  domestic.averagePrice=20990.2941177;h.open('domestic');h.edit('21,000');h.submit();assert.equal(domestic.averagePrice,21000);assert.deepEqual(h.writes,['allocation']);
});

test('현금은 원화·달러·음수 금액을 숫자로 저장하고 잘못된 형식은 저장하지 않는다',()=>{
  const h=page(),f=h.node('cashForm');
  for(const [currency,raw,shown,value] of [['KRW','12345.6','12,345.6',12345.6],['USD','-1234.5','-1,234.5',-1234.5]]){
    h.ctx.openCash();f.name.value='예시 현금';f.currency.value=currency;h.type(f.amount,raw);
    assert.equal(f.amount.value,shown);f.onsubmit({preventDefault(){}});
    const saved=JSON.parse(h.storage.get('etf-planner-assets-v1')).allocation.cash.at(-1);
    assert.equal(saved.amount,value);assert.equal(typeof saved.amount,'number');assert.equal(saved.currency,currency);
    h.ctx.openCash(saved.id);assert.equal(f.amount.value,shown);
    const before=JSON.stringify(h.data);f.amount.value='1e3';f.onsubmit({preventDefault(){}});
    assert.equal(JSON.stringify(h.data),before);assert.ok(f.amount.validationMessage);assert.equal(h.node('cashDialog').open,true);
  }
});

test('평균매수가 0·음수·잘못된 값은 저장을 막고 창과 기존 기록을 유지한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);h.open('b');
  for(const value of ['0','-1','-0.5','invalid','Infinity']){
    h.edit(value);h.submit();assert.equal(h.node('itemDialog').open,true);assert.equal(h.input.checkValidity(),false);assert.match(h.input.validationMessage,/0보다 큰 숫자/);
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
  h.edit('1e20');h.submit();assert.equal(h.node('itemDialog').open,true);assert.match(h.input.validationMessage,/범위를 초과/);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  h.edit('0.25');h.submit();assert.equal(data.allocation.groups[1].items[0].averagePrice,.25);assert.deepEqual(h.writes,['allocation']);
});

test('같은 종목 전체 계좌는 매입금액으로 가중한 손익과 누락된 계좌 수를 표시한다',()=>{
  const data=fixture();data.allocation.groups[0].items[0].averagePrice=50;const before=JSON.stringify(data),h=page(data);
  assert.match(h.html(),/계산 가능 3 \/ 보유 4개/);assert.match(h.html(),/원화 합계/);assert.match(profitCard(h),/현재 환율 1,200원으로 환산/);
  h.open('a');assert.equal(h.node('averagePriceTotal').hidden,false);assert.match(h.node('averagePriceTotal').innerHTML,/계산 가능 2 \/ 3개/);
  assert.match(h.node('averagePriceTotal').innerHTML,/−\$100/);assert.match(h.node('averagePriceTotal').innerHTML,/−25%/,'계좌 수익률 산술평균을 쓰지 않음');
  h.edit('100');assert.match(h.node('averagePriceTotal').innerHTML,/−\$200/);assert.match(h.node('averagePriceTotal').innerHTML,/−40%/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[],'합계 미리보기도 저장하지 않음');
});

test('시세 갱신 뒤 다시 열면 현재가·손익을 갱신하고 평균매수가는 유지한다',()=>{
  const data=fixture();data.allocation.groups[0].items[0].averagePrice=50;const h=page(data),before=JSON.stringify(data);
  h.open('a');h.cancel();const next=quoteFixture();next.stocks.AAA.close=75;next.fx.close=5000;h.refresh(next);
  assert.match(h.row('a'),/\+\$50/);assert.match(h.row('a'),/\+50%/);
  h.open('a');assert.equal(h.input.value,'50');assert.match(h.node('averagePriceHolding').innerHTML,/\$75/);assert.match(h.node('averagePricePreview').innerHTML,/\+\$50/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('투자구성과 자산배분 탭 왕복은 기존 분류·목표 화면과 평균매수가를 보존한다',()=>{
  const data=fixture();data.allocation.groups[0].items[0].averagePrice=50;const h=page(data),before=JSON.stringify(data);
  h.ctx.openTab('strategy');assert.match(h.node('strategyView').innerHTML,/배분 개요/);assert.doesNotMatch(h.node('strategyView').innerHTML,/보유 평가손익 합계|data-average-price=/);assert.equal(h.html(),'');
  h.ctx.openTab('alloc');assert.match(h.row('a'),/평균매수가 \$50/);h.open('a');assert.equal(h.input.value,'50');
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('평균매수가 입력은 종목 수정창 안에만 있으며 제거한 자동 계산 입력 없이 소수 입력 접근성을 제공한다',()=>{
  const html=read('assets.html'),modal=html.split('<dialog id="itemDialog"')[1].split('</dialog>')[0];
  assert.doesNotMatch(html,/id="averagePriceDialog"|id="averagePriceForm"/);
  assert.doesNotMatch(modal,/name="(?:amount|tradePrice)"/);
  assert.equal([...html.matchAll(/name="averagePrice"/g)].length,1);
  assert.equal([...modal.matchAll(/type="button" data-close/g)].length,2);assert.match(modal,/name="averagePrice" type="text" inputmode="decimal" autocomplete="off" data-money/);assert.match(modal,/data-money-step="any"/);assert.match(modal,/data-money-max="9007199254740991"/);
  assert.match(modal,/aria-describedby="averagePriceHint"/);assert.match(modal,/id="averagePricePreview"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('평균매수가 수정은 숨긴 금액·평가기준과 같은 ETF의 기존 가격 대체값을 보존한다',()=>{
  const data=fixture(),item=data.allocation.groups[0].items[0];
  Object.assign(item,{tradeTicker:'111111',tradePrice:9000,tradePriceAt:'2026-01-01T00:00:00Z',baseAt:'2025-12-31'});
  delete item.shares;
  data.allocation.trades={'buy:a:stage':{at:'2026-01-01',items:[{id:'a',amount:5}]}};
  const before=JSON.parse(JSON.stringify(data)),h=page(data);h.open('a');h.edit('10000');h.submit();
  before.allocation.groups[0].items[0].averagePrice=10000;
  assert.deepEqual(data,before,'금액만으로 보유하던 기존 종목도 평균매수가 외 필드는 그대로');
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('itemDialog').open,false);
});

test('실제 매수 ETF 코드를 바꾸면 다른 ETF의 오래된 가격을 재사용하지 않는다',()=>{
  const data=fixture(),item=data.allocation.groups[0].items[0];
  Object.assign(item,{tradeTicker:'111111',tradePrice:9000,tradePriceAt:'2026-01-01T00:00:00Z'});
  const h=page(data);h.open('a');h.field('tradeTicker','222222');h.submit();
  assert.equal(item.tradeTicker,'222222');assert.equal(Object.hasOwn(item,'tradePrice'),false);assert.equal(Object.hasOwn(item,'tradePriceAt'),false);
  assert.equal(item.amount,20);assert.equal(item.shares,2);assert.deepEqual(h.writes,['allocation']);
});

test('같은 수정창에서 수량·평균매수가·종목 통화를 바꾸면 초안으로 손익을 미리 계산한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);h.open('a');h.edit('50');h.field('shares','4');
  assert.match(h.node('averagePriceHolding').innerHTML,/보유 수량 <b>4주/);assert.match(h.node('averagePricePreview').innerHTML,/\+\$40/);
  h.field('tradeTicker','111111');h.edit('10000');
  assert.match(h.node('averagePriceLabel').textContent,/원 \(KRW\)/);assert.match(h.node('averagePricePreview').innerHTML,/\+8,000원/);assert.match(h.node('averagePricePreview').innerHTML,/\+20%/);
  assert.equal(JSON.stringify(data),before);h.cancel();assert.deepEqual(h.writes,[]);
});

test('평균매수가 편집 중 갱신된 보유 수량은 사용자가 수량을 고치지 않았다면 그대로 저장한다',()=>{
  const data=fixture(),h=page(data);h.open('a');h.edit('50');
  data.allocation.groups[0].items[0].shares=5;
  data.allocation.trades={'buy:a:new':{at:'2026-01-03',items:[{id:'a',shares:3}]}};
  const before=JSON.parse(JSON.stringify(data));h.submit();before.allocation.groups[0].items[0].averagePrice=50;
  assert.deepEqual(data,before,'평균매수가만 저장하면서 새 체결 수량·기록을 되돌리지 않음');
  assert.deepEqual(h.writes,['allocation']);
});

test('수정 중 다른 기기에서 지운 종목은 평균매수가 저장으로 다시 만들지 않는다',()=>{
  const data=fixture(),h=page(data);h.open('a');h.edit('50');data.allocation.groups[0].items=[];
  const before=JSON.stringify(data);h.submit();
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,false);assert.equal(h.alerts.length,1);
});

test('새 종목도 같은 수정창에서 수량·평균매수가를 저장하며 자동 계산값은 수동 입력하지 않는다',()=>{
  const data=fixture(),h=page(data);h.ctx.openItem(null,'g1');
  h.field('name','가상 새 ETF');h.field('ticker','111111');h.field('shares','2');h.edit('10000');h.submit();
  const item=data.allocation.groups[0].items.find(it=>it.name==='가상 새 ETF');
  assert.ok(item?.id);assert.equal(item.averagePrice,10000);assert.equal(item.shares,2);assert.equal(item.ticker,'111111');
  assert.equal(item.amount,0);assert.equal(Object.hasOwn(item,'tradePrice'),false);assert.deepEqual(h.writes,['allocation']);
  assert.equal(h.node('itemDialog').open,false);
});

test('동기화가 수정 중 기록 객체를 교체해도 최신 보유 기록에 평균매수가만 반영한다',()=>{
  const h=page();h.open('a');h.edit('50');
  const latest=JSON.parse(JSON.stringify(h.data));latest.allocation.groups[0].items[0].shares=7;latest.allocation.groups[0].items[0].note='가상 동기화 메모';
  h.store.doc=latest;vm.runInContext('doc=assetStore.doc;render()',h.ctx);
  const before=JSON.parse(JSON.stringify(latest));h.submit();before.allocation.groups[0].items[0].averagePrice=50;
  assert.deepEqual(latest,before);assert.deepEqual(JSON.parse(h.storage.get('etf-planner-assets-v1')),before);
  assert.equal(h.data.allocation.groups[0].items[0].averagePrice,undefined,'교체 전 객체를 고치지 않음');
  assert.deepEqual(h.writes,['allocation']);
});

test('종목 창의 플래너 체결은 건수를 남기고 기본 접기하며 다시 열면 접고 기록은 보존한다',()=>{
  const data=fixture();data.allocation.trades={};
  for(let i=0;i<25;i++)data.allocation.trades[`buy:a:${i}`]={label:`가상 체결 ${i}`,at:'2026-01-02',items:[{id:'a',shares:1}]};
  const before=JSON.stringify(data),h=page(data),tag=read('assets.html').match(/<details\b[^>]*id="itemTrades"[^>]*>/)?.[0];
  assert.ok(tag,'키보드·터치로 여닫는 native details');assert.doesNotMatch(tag,/\sopen(?:\s|>)/);
  h.open('a');assert.equal(h.node('itemTrades').open,false);assert.equal(h.node('itemTrades').hidden,false);
  assert.match(h.node('itemTrades').innerHTML,/<summary><span>플래너 체크로 반영한 체결 <small>25건<\/small>/);assert.equal((h.node('itemTrades').innerHTML.match(/<li>/g)||[]).length,20);
  h.node('itemTrades').open=true;h.cancel();h.open('a');assert.equal(h.node('itemTrades').open,false);assert.equal(JSON.stringify(data),before);assert.equal(h.writes.length,0);
  h.open('b');assert.equal(h.node('itemTrades').hidden,true);
});


function profitCard(h){return h.html().split('<section class="card alloc-profit"')[1].split('</section>')[0];}

test('전체 원화 손익은 현물 환율을 우선하고 없으면 기존 cashFx를 쓰며 검색·그룹 접기와 독립적이다',()=>{
  const {data,quotes}=groupProfitFixture(true);data.allocation.cashFx=1800;const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(profitCard(h),/−600,000원/);assert.match(profitCard(h),/현재 환율 1,200원/);
  const card=profitCard(h);vm.runInContext('allocQuery="가상 원화 A";renderAlloc()',h.ctx);assert.equal(profitCard(h),card);
  delete quotes.fx;h.refresh(quotes);assert.match(profitCard(h),/−1,200,000원/);assert.match(profitCard(h),/현재 환율 1,800원/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('전체 보유에 환율이 필요한데 없으면 일부 원화나 0원·0%를 전체 합계로 표시하지 않는다',()=>{
  for(const zero of [false,true]){
    const {data,quotes}=groupProfitFixture(true);delete quotes.fx;delete data.allocation.cashFx;
    if(zero)quotes.stocks.AAA.close=100;
    const before=JSON.stringify(data),h=page(data,quotes),card=profitCard(h);
    assert.match(card,/<strong class="">환율 대기<\/strong><b class="">—<\/b>/);assert.match(card,/전체 원화 합계와 손익률을 기다립니다/);
    assert.doesNotMatch(card,/\+600,000원|원화 합계<\/span><strong[^>]*>0원/);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
});

test('전체 원화 합산은 원화 평균가 코인을 다시 환산하지 않고 원화만 있거나 보유 0인 때도 구분한다',()=>{
  const {data,quotes}=btcFixture('KRW'),before=JSON.stringify(data),h=page(data,quotes);
  // 원화 코인 +140,000, 국내 +8,000, 달러 종목 −120 × 1,400 = −168,000.
  assert.match(profitCard(h),/원화 합계<\/span><strong class="profit-loss">−20,000원/);assert.equal(JSON.stringify(data),before);
  const head=profitCard(h).split('class="alloc-profit-totals"')[0];assert.match(head,/원화 합산 · 평균매수가 통화 기준/);assert.doesNotMatch(head,/환차손익 제외/);assert.match(profitCard(h),/달러 평균가 보유의 환차손익 제외/);
  delete quotes.fx;delete data.allocation.cashFx;h.refresh(quotes);assert.match(profitCard(h),/환율 대기/);
  const krw=groupProfitFixture();krw.data.allocation.groups[0].items.pop();delete krw.quotes.fx;delete krw.data.allocation.cashFx;
  const only=page(krw.data,krw.quotes);assert.match(profitCard(only),/\+600,000원/);assert.match(profitCard(only),/\+20%/);assert.doesNotMatch(profitCard(only),/환율 대기/);
  for(const it of krw.data.allocation.groups[0].items)it.shares=0;only.ctx.renderAlloc();assert.match(profitCard(only),/평균매수가와 보유 수량을 입력/);assert.doesNotMatch(profitCard(only),/원화 합계/);
});
