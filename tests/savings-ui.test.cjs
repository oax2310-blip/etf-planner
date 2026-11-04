// 가상 저축 기록으로 화면 상태만 검증한다. 실제 자산·보유 기록은 사용하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),key='etf-planner-assets-v1';
const source=['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/assets.js','js/assets-ledger.js','js/assets-savings.js','js/assets-installments.js','js/assets-start.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n;\n');
const fixture=()=>({version:1,savings:{savedAt:'2026-01-01',startYear:2025,startAge:31,actual:[{ym:'2025-12',total:1000,note:'기존 필드'}],scenarios:[{id:'base',name:'기본',salary:100,giving:10,spending:50,spendingYear:2025,growth:2,returnRate:5,endAge:60,stages:[]},{id:'other',name:'비교',salary:100,giving:10,spending:50,spendingYear:2025,growth:2,returnRate:3,endAge:60,stages:[]}]}});
function setup(data=fixture(),year=2026,shared,{cloneOnSave=false}={}){
  let now=new Date(year,9,11).getTime(),saves=0;
  const nodes=new Map(),events=new Map(),intervals=[],timers=[],listeners=[],storage=shared||new Map([[key,JSON.stringify(data)]]);
  class SystemDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const decode=s=>s.replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
  const escape=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const attributes=text=>Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],decode(m[2]??'')]));
  const flush=()=>{while(timers.length)timers.shift()();};
  const voids=new Set(['input','br','hr','img','meta','link']),selectors=new Map();
  function element(tag='div'){
    let attrs=new Map(),children=[],value,focusedValue;const handlers=new Map();
    const n={tagName:tag.toUpperCase(),parentElement:null,validity:{valid:true},
      get attributes(){return [...attrs].map(([name,value])=>({name,value}));},
      get dataset(){return Object.fromEntries([...attrs].filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));},
      get children(){return children.filter(x=>typeof x!=='string');},
      get innerHTML(){return children.map(x=>typeof x==='string'?x:x.outerHTML).join('');},
      set innerHTML(html){
        children.forEach(x=>{if(typeof x!=='string')x.parentElement=null;});children=[];
        const stack=[n];
        for(const m of String(html).matchAll(/<\/?([a-z][\w-]*)\b[^>]*>|[^<]+/gi)){
          const token=m[0];
          if(!m[1]){stack.at(-1).appendText(token);continue;}
          if(token.startsWith('</')){stack.pop();continue;}
          const child=element(m[1]);for(const [k,v]of Object.entries(attributes(token.slice(m[1].length+1,-1))))child.setAttribute(k,v);
          stack.at(-1).appendChild(child);if(!voids.has(m[1])&&!token.endsWith('/>'))stack.push(child);
        }
      },
      get outerHTML(){const a=[...attrs].map(([k,v])=>v===''&&['hidden','open','selected','data-money'].includes(k)?` ${k}`:` ${k}="${escape(v)}"`).join('');return `<${tag}${a}>`+(voids.has(tag)?'':n.innerHTML+`</${tag}>`);},
      get textContent(){return decode(children.map(x=>typeof x==='string'?x:x.textContent).join(''));},
      set textContent(v){children=[escape(v)];},
      get value(){if(value!==undefined)return value;if(tag==='select'){const options=n.querySelectorAll('option');return (options.find(x=>x.hasAttribute('selected'))||options[0])?.getAttribute('value')??'';}return attrs.get('value')??(tag==='textarea'?n.textContent:'');},
      set value(v){value=String(v);},
      get hidden(){return attrs.has('hidden');},set hidden(v){if(v)attrs.set('hidden','');else attrs.delete('hidden');},
      get open(){return attrs.has('open');},set open(v){if(v)attrs.set('open','');else attrs.delete('open');},
      get placeholder(){return attrs.get('placeholder');},set placeholder(v){attrs.set('placeholder',v);},
      get title(){return attrs.get('title')||'';},set title(v){attrs.set('title',v);},
      get tabIndex(){return Number(attrs.get('tabindex')??0);},set tabIndex(v){attrs.set('tabindex',String(v));},
      get className(){return attrs.get('class')||'';},set className(v){attrs.set('class',v);},
      classList:{toggle(name,force){const classes=new Set((attrs.get('class')||'').split(' ').filter(Boolean)),active=force??!classes.has(name);if(active)classes.add(name);else classes.delete(name);attrs.set('class',[...classes].join(' '));}},
      getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,String(v)),hasAttribute:k=>attrs.has(k),removeAttribute:k=>attrs.delete(k),
      appendText:t=>children.push(t),appendChild:child=>n.insertBefore(child,null),
      insertBefore(child,before){child.parentElement?.removeChild(child);child.parentElement=n;const i=children.indexOf(before);children.splice(i<0?children.length:i,0,child);return child;},
      removeChild(child){children.splice(children.indexOf(child),1);child.parentElement=null;},
      contains(other){for(let x=other;x;x=x.parentElement)if(x===n)return true;return false;},
      matches(selector){
        if(!selectors.has(selector)){
          const parts=selector.trim().split(/\s+/),tests=[...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
          const base=selector.replace(/\[[^\]]*\]/g,''),kind=base.match(/^[\w-]+/),id=base.match(/#([\w-]+)/),classes=[...base.matchAll(/\.([\w-]+)/g)];
          const match=selector.includes(',')?x=>selector.split(',').some(s=>x.matches(s.trim())):parts.length>1?x=>x.matches(parts.at(-1))&&!!x.parentElement?.closest(parts.slice(0,-1).join(' ')):
            x=>tests.every(([,k,v])=>x.hasAttribute(k)&&(v===undefined||x.getAttribute(k)===v))&&(!kind||kind[0].toUpperCase()===x.tagName)&&(!id||x.getAttribute('id')===id[1])&&classes.every(([,c])=>x.className.split(' ').includes(c));
          selectors.set(selector,match);
        }
        return selectors.get(selector)(n);
      },
      closest(selector){for(let x=n;x;x=x.parentElement)if(x.matches(selector))return x;return null;},
      querySelectorAll(selector){return n.children.flatMap(c=>[...(c.matches(selector)?[c]:[]),...c.querySelectorAll(selector)]);},
      querySelector(selector){for(const c of n.children){if(c.matches(selector))return c;const found=c.querySelector(selector);if(found)return found;}return null;},
      focus(){if(document.activeElement!==n){document.activeElement?.blur?.(n);focusedValue=n.value;document.activeElement=n;}flush();},
      blur(relatedTarget=null){if(document.activeElement!==n)return;document.activeElement=null;if(n.value!==focusedValue)n.onchange?.();for(let x=n;x;x=x.parentElement)x.dispatchEvent({type:'focusout',relatedTarget});events.get('document:focusout')?.();},
      addEventListener(type,handler){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(handler);},
      dispatchEvent(e){handlers.get(e.type)?.forEach(fn=>fn(e));},
      click(){n.focus();n.onclick?.();flush();}
    };return n;
  }
  const view=element();view.setAttribute('id','savingsView');nodes.set('savingsView',view);
  const node=id=>view.querySelector(`#${id}`)||nodes.get(id)||(()=>{const n=element();n.setAttribute('id',id);n.querySelector=sel=>node(`${id}:${sel}`);nodes.set(id,n);return n;})();
  const document={hidden:false,activeElement:null,getElementById:node,createElement:element,
    querySelector:sel=>view.querySelector(sel)||node(sel),querySelectorAll:sel=>view.querySelectorAll(sel),addEventListener:(name,fn)=>events.set(`document:${name}`,fn)};
  const store={doc:data,prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe:fn=>listeners.push(fn),start(){},
    saveSection(){saves++;if(cloneOnSave){store.doc=JSON.parse(JSON.stringify(store.doc));storage.set(key,JSON.stringify(store.doc));}listeners.forEach(fn=>fn('change'));},
    saveSavingsMilestone(record){store.doc.savings.milestoneRecord={ym:record.ym,age:record.age};storage.set(key,JSON.stringify(store.doc));saves++;listeners.forEach(fn=>fn('change'));return true;}};
  const ctx=vm.createContext({Date:SystemDate,document,assetStore:store,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    addEventListener:(name,fn)=>events.set(`window:${name}`,fn),setInterval:(fn,ms)=>intervals.push({fn,ms}),setTimeout:fn=>{timers.push(fn);return timers.length;},
    location:{hash:'#savings'},history:{replaceState(){}},scrollTo(){}});
  vm.runInContext(source,ctx);flush();
  const buttons=()=>view.querySelectorAll('[data-savings-year]');
  return {ctx,document,storage,events,node,store,flush,emit:type=>listeners.forEach(fn=>fn(type)),inputs:()=>view.querySelectorAll('input'),html:()=>view.innerHTML.replace(/ data-savings-result="[^"]*"/g,''),saves:()=>saves,
    setYear:y=>now=new Date(y,0,1).getTime(),render:()=>ctx.renderSavings(),tick:()=>intervals.find(i=>i.ms===60000).fn(),
    click:y=>buttons().find(b=>Number(b.dataset.savingsYear)===y).onclick(),
    state:()=>buttons().map(b=>[Number(b.dataset.savingsYear),b.getAttribute('aria-expanded')==='true',!node(b.getAttribute('aria-controls')).hidden])};
}
const openYears=h=>h.state().filter(x=>x[1]).map(x=>x[0]);
const selectScenario=(h,id)=>{const select=h.node('savingsScenarioSelect');select.value=id;select.onchange();};
const savingsPaneHtml=(h,name)=>h.html().split(`id="savingsPane${name}"`)[1].split(/<section id="savingsPane/)[0];
const savingsYearsHtml=h=>savingsPaneHtml(h,'Records').split('<div class="card savings-years">')[1];
const stageInput=(h,i,key)=>h.inputs().find(x=>x.dataset.stage===String(i)&&x.dataset.k===key);
const editInput=(x,value)=>{x.value=value;x.onchange();};
const yearRow=(h,year)=>h.html().split(/<section class="savings-year(?: savings-year-current)?">/).find(x=>x.includes(`data-savings-year="${year}"`))?.split('</section>')[0];
const yearButton=(h,year)=>h.document.querySelectorAll('[data-savings-year]').find(x=>x.dataset.savingsYear===String(year));
const paramInput=(h,key)=>h.inputs().find(x=>x.dataset.param===key);
const arrivalButton=(h,id)=>h.document.querySelectorAll('[data-savings-scenario]').find(x=>x.dataset.savingsScenario===id);
const spendingNow=h=>vm.runInContext('Math.round((()=>{const s=doc.savings,c=s.scenarios.find(x=>x.id===ui.scenario)||s.scenarios[0],months=s.actual.filter(a=>finite(a.total)!==null).map(a=>ymNum(a.ym)).filter(n=>n!==null),y=finite(s.startYear)??(months.length?Math.floor(Math.min(...months)/12):new Date().getFullYear());return savingsSpending(c,y,finite(s.startAge)??0,months.length?Math.floor(Math.max(...months)/12):y)(new Date().getFullYear());})())',h.ctx);

test('지난 기록 묶음: 기본 접힘·범위·지난 빠진 달만·지난해 금액을 표시하며 조회·토글·새로고침은 저장하지 않는다',()=>{
  const data=fixture();Object.assign(data.savings,{startYear:2024,startAge:30,actual:[{ym:'2024-12',total:100000000},{ym:'2025-02',total:110000000},{ym:'2025-12',total:125000000},{ym:'2026-03',total:130000000}]});
  const before=JSON.stringify(data),h=setup(data),stored=[...h.storage],button=h.node('toggleSavingsPast');
  assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(button.getAttribute('aria-controls'),'savingsPastYears');
  assert.match(button.getAttribute('aria-label'),/지난 기록 2024–2025 · 2년 · 빠진 달 10/);
  assert.equal(button.querySelector('.savings-past-balance').textContent,'1억 2,500만 원');
  const summary=button.querySelector('.savings-past-summary');
  assert.deepEqual(summary.children.map(x=>x.className),['savings-past-label','savings-past-balance'],'이름과 금액은 연도·연말 총액 두 열에 걸친 요약 영역에 둔다');
  assert.deepEqual(button.children.map(x=>x.className),['savings-past-summary','savings-past-missing'],'빠진 달은 투자수익 열에 두어 금액을 밀지 않는다');
  assert.equal(button.querySelector('.savings-past-missing').textContent,'빠진 달 10');assert.equal(h.node('savingsPastYears').hidden,true);
  assert.deepEqual(h.node('savingsPastYears').querySelectorAll('[data-savings-year]').map(x=>x.dataset.savingsYear),['2024','2025']);
  assert.equal(yearButton(h,2026).closest('section').parentElement.className,'card savings-years');assert.deepEqual(openYears(h),[2026]);
  const input=h.inputs().find(x=>x.dataset.actual==='2025-01');button.click();h.click(2025);
  assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(h.node('savingsPastYears').hidden,false);assert.equal(h.inputs().find(x=>x.dataset.actual==='2025-01'),input);
  h.node('savingsTabRecords').click();h.render();assert.equal(h.node('savingsPastYears').hidden,false);
  const reload=setup(JSON.parse(before),2026,h.storage);assert.equal(reload.node('savingsPastYears').hidden,true);assert.deepEqual(openYears(reload),[2026]);
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  const css=fs.readFileSync(path.join(root,'css/assets.css'),'utf8');assert.match(css,/\.savings-past-missing\{[^}]*color:var\(--warn\)/);
  assert.match(css,/\.savings-years-head,\.savings-year-toggle,\.savings-past-toggle\{[^}]*grid-template-columns:/,'묶음·연도·제목은 같은 열을 사용한다');
  assert.match(css,/\.savings-past-summary\{grid-column:1\/3;display:flex;/,'첫 두 열 영역의 오른쪽 끝이 연말 저축총액 열의 끝이다');
  assert.match(css,/\.savings-past-missing\{grid-column:3;/);
});

test('지난 기록 묶음: 현재 연도 이전이 없으면 숨기고 새해에는 지난해를 묶어 새해 행을 펼친다',()=>{
  const data=fixture();data.savings.startYear=2026;data.savings.actual=[{ym:'2026-12',total:1000}];
  const h=setup(data),stored=[...h.storage];assert.equal(h.document.querySelector('.savings-past').hidden,true);
  h.setYear(2027);h.tick();assert.equal(h.document.querySelector('.savings-past').hidden,false);assert.equal(h.node('savingsPastYears').hidden,true);
  assert.equal(yearButton(h,2026).closest('section').parentElement,h.node('savingsPastYears'));assert.deepEqual(openYears(h),[2027]);
  h.node('toggleSavingsPast').click();h.setYear(2028);h.events.get('window:focus')();
  assert.equal(h.node('toggleSavingsPast').getAttribute('aria-expanded'),'false');assert.match(h.node('toggleSavingsPast').textContent,/2026–2027 · 2년/);
  assert.deepEqual(openYears(h),[2028]);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
});

test('지난 기록 묶음: 모든 지난 연도를 담고 모든 연도 보기의 줄임과 개수는 미래 연도에만 적용한다',()=>{
  const data=fixture();Object.assign(data.savings,{startYear:2000,startAge:10,actual:[{ym:'2000-12',total:1000}]});
  const h=setup(data),past=h.node('savingsPastYears');assert.equal(past.querySelectorAll('[data-savings-year]').length,26);
  assert.equal(h.node('toggleYears').textContent,'모든 연도 보기 (24년)');
  const future=()=>h.state().filter(([y])=>y>2026).map(([y])=>y),short=future();assert.ok(short.length<24);
  h.node('toggleYears').click();assert.equal(future().length,24);assert.equal(h.node('savingsPastYears').querySelectorAll('[data-savings-year]').length,26);assert.equal(h.node('savingsPastYears').hidden,true);
  h.node('toggleYears').click();assert.deepEqual(future(),short);assert.deepEqual(openYears(h),[2026]);assert.equal(h.saves(),0);
});

test('지난 묶음 월 입력 뒤 첫 터치: 복사 저장 뒤에도 다른 연도 버튼과 내부 대상을 유지하고 저장·펼침을 한 번 실행한다',()=>{
  for(const targetYear of [2025,2027]){
    const h=setup(fixture(),2026,undefined,{cloneOnSave:true});h.node('savingsTabRecords').click();h.node('toggleSavingsPast').click();h.click(2025);
    const input=h.inputs().find(x=>x.dataset.actual==='2025-01'),target=yearButton(h,targetYear),touch=target.querySelector('b'),before=h.node('toggleSavingsPast'),balance=before.querySelector('.savings-past-balance');
    input.focus();input.value='123456789';target.focus();assert.equal(h.saves(),1);assert.equal(target.querySelector('b'),touch);assert.equal(h.node('toggleSavingsPast'),before);
    target.onclick();h.flush();assert.equal(h.store.doc.savings.actual.find(x=>x.ym==='2025-01').total,123456789);assert.equal(h.saves(),1);
    assert.equal(target.getAttribute('aria-expanded'),targetYear===2025?'false':'true');assert.equal(h.node('savingsPastYears').hidden,false);
    editInput(h.inputs().find(x=>x.dataset.actual==='2025-12'),'150000000');assert.equal(before.querySelector('.savings-past-balance').textContent,'1억 5,000만 원');
    assert.equal(before.querySelector('.savings-past-balance'),balance,'금액 결과를 갱신해도 내부 터치 대상을 유지한다');
    assert.equal(before.querySelector('.savings-past-missing').textContent,'빠진 달 10');assert.equal(h.saves(),2);
  }
});

test('지난 기록 부분 갱신: 시작 연도 변경으로 묶음을 추가·숨겨도 기존 입력과 버튼을 교체하지 않는다',()=>{
  const data=fixture();data.savings.startYear=2026;data.savings.actual=[{ym:'2026-12',total:1000}];const h=setup(data),view=h.node('savingsView');
  const input=paramInput(h,'salary'),button=yearButton(h,2026),pastButton=h.node('toggleSavingsPast'),start=h.inputs().find(x=>x.dataset.base==='startYear');
  editInput(start,'2024');assert.equal(view.querySelector('.savings-past').hidden,false);assert.deepEqual(h.node('savingsPastYears').querySelectorAll('[data-savings-year]').map(x=>x.dataset.savingsYear),['2024','2025']);
  pastButton.click();editInput(start,'2026');assert.equal(view.querySelector('.savings-past').hidden,true);
  assert.equal(paramInput(h,'salary'),input);assert.equal(yearButton(h,2026),button);assert.equal(h.node('toggleSavingsPast'),pastButton);assert.equal(h.saves(),2);
});

test('저축 입력 확정: 저장 알림과 문서 복사 뒤에도 입력·버튼·버튼 안의 터치 대상 노드를 유지한다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:35},{age:40}];
  const h=setup(data,2026,undefined,{cloneOnSave:true}),view=h.node('savingsView');
  const controls=()=>view.querySelectorAll('input,textarea,select,button');
  const before=controls(),touch=yearButton(h,2026).querySelector('b');
  for(const [selector,value] of [['[data-param="salary"]','2,000,000'],['[data-actual="2026-01"]','123,456,789'],['[data-stage="0"][data-k="spending"]','900,000']]){
    const x=view.querySelector(selector),count=h.saves();editInput(x,value);
    assert.equal(h.saves(),count+1);assert.deepEqual(controls(),before);
    assert.equal(yearButton(h,2026).querySelector('b'),touch);
    assert.equal(view.querySelector(selector),x);assert.equal(vm.runInContext('redrawLater',h.ctx),false,'로컬 저장 알림이 전체 다시 그리기를 예약하지 않는다');
    h.flush();assert.deepEqual(controls(),before);
  }
  const sc=h.store.doc.savings.scenarios[0];assert.equal(sc.salary,2000000);assert.equal(sc.stages[0].spending,900000);
  assert.equal(h.store.doc.savings.actual.find(x=>x.ym==='2026-01').total,123456789);
});

test('저축 입력 직후 클릭: 입력 저장 한 번과 복사·단계 추가/삭제·연도 토글·최단 저장·탭 동작 한 번을 실행한다',()=>{
  for(const kind of ['copy','add','delete','year','milestone','tab']){
    const data=milestoneFixture();data.savings.scenarios[0].stages=[{age:35},{age:40}];
    const h=setup(data,2026,undefined,{cloneOnSave:true}),input=h.inputs().find(x=>x.dataset.param==='salary');
    const button=kind==='copy'?h.node('copyScenario'):kind==='add'?h.node('addStage'):kind==='delete'?h.document.querySelectorAll('[data-stage-del]')[1]:kind==='year'?yearButton(h,2026):kind==='milestone'?h.node('saveSavingsMilestone'):h.node('savingsTabRecords');
    input.focus();input.value='2000000';button.focus();
    assert.equal(h.saves(),1,`${kind}: change만 한 번 저장한다`);
    assert.equal(h.node('savingsView').contains(button),true,`${kind}: 클릭 대상이 남는다`);
    button.onclick();h.flush();
    const sv=h.store.doc.savings;
    assert.equal(sv.scenarios[0].salary,2000000);
    if(kind==='copy'){assert.equal(sv.scenarios.length,3);assert.equal(sv.scenarios[2].salary,2000000);}
    if(kind==='add')assert.equal(sv.scenarios[0].stages.length,3);
    if(kind==='delete')assert.deepEqual(sv.scenarios[0].stages,[{age:35}]);
    if(kind==='year')assert.equal(yearButton(h,2026).getAttribute('aria-expanded'),'false');
    if(kind==='milestone')assert.equal(sv.milestoneRecord.ym,'2031-01');
    if(kind==='tab')assert.equal(h.node('savingsPaneRecords').hidden,false);
    assert.equal(h.saves(),['year','tab'].includes(kind)?1:2,`${kind}: 버튼 자체의 저장만 추가한다`);
  }
});

test('저축 연속 초점: 다음/이전 칸의 초점과 미확정 값은 부분 갱신 후에도 유지한다',()=>{
  const h=setup(),salary=h.inputs().find(x=>x.dataset.param==='salary'),giving=h.inputs().find(x=>x.dataset.param==='giving');
  salary.focus();salary.value='4200000';giving.focus();giving.value='12.';
  assert.equal(h.document.activeElement,giving);assert.equal(h.saves(),1);
  const actual=h.inputs().find(x=>x.dataset.actual==='2026-01');editInput(actual,'5000');
  assert.equal(h.document.activeElement,giving);assert.equal(giving.value,'12.','다른 결과 갱신이 입력 중 값을 덮지 않는다');
  salary.focus();assert.equal(h.saves(),3);assert.equal(h.document.activeElement,salary);
  assert.equal(salary.value,'4,200,000');assert.equal(h.store.doc.savings.scenarios[0].giving,12);
});

test('저축 단계 객체: 35→50 정렬·문서 복사 뒤에도 원래 칸과 다른 단계 칸에 각각 저장하고 밖으로 나간 뒤 노드만 이동한다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:35,salary:100},{age:40,salary:200}];
  const h=setup(data,2026,undefined,{cloneOnSave:true}),age=stageInput(h,0,'age'),firstSalary=stageInput(h,0,'salary'),secondSalary=stageInput(h,1,'salary');
  const firstCard=age.closest('.plan-line'),secondCard=secondSalary.closest('.plan-line'),list=firstCard.parentElement;
  age.focus();age.value='50';secondSalary.focus();secondSalary.value='222';firstSalary.focus();firstSalary.value='111';
  assert.deepEqual(list.children,[firstCard,secondCard],'단계 목록 안에서는 입력 순서를 유지한다');
  h.node('savingsTabRecords').focus();h.flush();
  assert.deepEqual(h.store.doc.savings.scenarios[0].stages,[{age:40,salary:222},{age:50,salary:111}]);
  assert.deepEqual(list.children,[secondCard,firstCard]);assert.equal(stageInput(h,0,'salary'),firstSalary);assert.equal(stageInput(h,1,'salary'),secondSalary);
  assert.equal(h.saves(),3);
  firstCard.querySelector('[data-stage-del]').onclick();
  assert.deepEqual(h.store.doc.savings.scenarios[0].stages,[{age:40,salary:222}],'삭제도 화면 인덱스가 아닌 같은 단계 객체를 지운다');
});

test('저축 부분 갱신: 요약·개요·연도·실제 상태·안내·빠진 달·억만 표시·선택 이름이 전체 그리기와 같다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:35}];
  const h=setup(data),view=h.node('savingsView');
  for(const [selector,value] of [['[data-param="name"]','변경 <계획>'],['[data-param="salary"]','4500000'],['[data-actual="2026-01"]','123456789'],['[data-actual="2026-03"]','130000000'],['[data-actual="2026-03"]',''],['[data-param="endAge"]','65']]){
    editInput(view.querySelector(selector),value);
    const next=h.document.createElement('div');next.innerHTML=vm.runInContext('savingsMarkup(doc.savings,doc.savings.scenarios[0],savingsStageViews)',h.ctx);
    for(const result of next.querySelectorAll('[data-savings-result]')){
      const current=view.querySelector(`[data-savings-result="${result.dataset.savingsResult}"]`);
      assert.equal(current?.outerHTML,result.outerHTML,`${selector}: ${result.dataset.savingsResult}`);
    }
  }
  assert.equal(h.node('savingsScenarioSelect').querySelector('option').textContent,'변경 <계획> 계획');
  assert.equal(view.querySelector('[data-savings-result="month-status-2026-01"]').textContent,'실제');
  assert.equal(view.querySelector('[data-savings-result="month-status-2026-03"]').textContent,'미기록');
  assert.equal(view.querySelector('[data-savings-result="month-hint-2026-01"]').textContent,'1억 2,346만원');
  assert.equal(view.querySelector('[data-savings-result="year-gaps-2026"]').hidden,true);
  assert.equal(stageInput(h,0,'salary').placeholder,'4,500,000');assert.ok(yearButton(h,2059));assert.equal(h.saves(),6);
});

test('저축 입력 검증: 잘못된 값은 저장하지 않고 필수 빈칸은 복원하며 선택 빈칸은 delete한다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:35,salary:100}];const h=setup(data),salary=h.inputs().find(x=>x.dataset.param==='salary');
  salary.validity.valid=false;editInput(salary,'x');assert.equal(h.saves(),0);assert.equal(salary.value,'x');
  salary.validity.valid=true;editInput(salary,'');assert.equal(h.saves(),0);assert.equal(salary.value,'100');
  editInput(stageInput(h,0,'salary'),'');assert.equal('salary' in data.savings.scenarios[0].stages[0],false);assert.equal(h.saves(),1);
  const actual=h.inputs().find(x=>x.dataset.actual==='2026-01');editInput(actual,'');assert.equal(h.saves(),1,'기록 없는 빈칸은 저장하지 않는다');
  editInput(actual,'0');assert.equal(h.saves(),2);assert.equal(data.savings.actual.find(x=>x.ym==='2026-01').total,0);
  editInput(actual,'0');assert.equal(h.saves(),2,'같은 실제 금액을 중복 저장하지 않는다');
});

test('저축 부분 갱신은 외부 동기화로 보류 중인 다시 그리기를 없애지 않는다',()=>{
  const h=setup(),salary=h.inputs().find(x=>x.dataset.param==='salary');salary.focus();h.ctx.redrawIdle();
  assert.equal(vm.runInContext('redrawLater',h.ctx),true);editInput(salary,'250');
  assert.equal(h.inputs().find(x=>x.dataset.param==='salary'),salary);assert.equal(vm.runInContext('redrawLater',h.ctx),true);
  salary.blur();h.flush();assert.equal(vm.runInContext('redrawLater',h.ctx),false);
  assert.notEqual(h.inputs().find(x=>x.dataset.param==='salary'),salary,'외부 갱신은 초점이 빠진 뒤 기존 전체 그리기를 실행한다');
});

test('저축 입력 중 외부 문서 교체: 초점·입력값을 유지하고 최신 가정과 같은 단계에 변경을 합친다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:35,salary:100},{age:40,salary:200}];
  const h=setup(data,2026,undefined,{cloneOnSave:true}),input=stageInput(h,0,'salary');input.focus();input.value='150';
  h.store.doc=JSON.parse(JSON.stringify(h.store.doc));h.store.doc.savings.scenarios[0].growth=7;h.store.doc.savings.scenarios[0].stages.reverse();h.store.doc.savings.scenarios[0].stages[1].spending=50;
  h.emit('change');assert.equal(h.document.activeElement,input);assert.equal(input.value,'150');assert.equal(stageInput(h,0,'salary'),input);
  stageInput(h,1,'salary').focus();
  assert.deepEqual(h.store.doc.savings.scenarios[0].stages,[{age:35,salary:150,spending:50},{age:40,salary:200}]);
  assert.equal(h.store.doc.savings.scenarios[0].growth,7);assert.equal(h.saves(),1);assert.equal(vm.runInContext('redrawLater',h.ctx),true);
});

test('저축 연도 상태: 요약 상태 줄 없이 예상 금액만 흐리게 구분하고 접근성 이름·본문에 판정을 유지한다',()=>{
  const data=fixture();Object.assign(data.savings,{startYear:2022,startAge:28,actual:[{ym:'2023-09',total:0},
    ...Array.from({length:9},(_,i)=>({ym:`2026-${String(i+1).padStart(2,'0')}`,total:100000000+i*1000000}))]});
  data.savings.scenarios[0].endAge=34;
  const before=JSON.stringify(data),h=setup(data),stored=[...h.storage];
  const simulation=()=>JSON.parse(vm.runInContext('JSON.stringify(simulateSavings(doc.savings,doc.savings.scenarios[0]))',h.ctx)),calculated=simulation();
  for(const [year,note] of [[2022,'기록 없음'],[2023,'실제 · 9월까지'],[2026,'실제 9개월 + 예상'],[2027,'예상 · 12월']]){
    const row=yearRow(h,year),balance=row.match(/<span class="savings-year-balance">([^]*?)<\/span>/)[1];
    assert.doesNotMatch(balance,/<small|실제|예상|기록 없음/);
    assert.equal(yearButton(h,year).className.includes('savings-year-predicted'),year>=2026);
    assert.ok(yearButton(h,year).getAttribute('aria-label').includes(note));
    assert.ok(row.includes(`<span>· ${note}</span>`),'펼친 정확 금액에도 같은 판정을 표시한다');
  }
  assert.match(yearRow(h,2022),/class="savings-year-balance"><b>—<\/b>/);
  assert.match(yearRow(h,2023),/class="savings-year-balance"><b>0원<\/b>/,'실제 0원은 미기록과 다르다');
  h.node('savingsTabRecords').onclick();h.click(2023);h.click(2026);h.render();
  assert.deepEqual(simulation(),calculated);assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  data.savings.actual.push({ym:'2026-12',total:127947465});h.render();
  assert.doesNotMatch(yearButton(h,2026).outerHTML,/savings-year-predicted|savings-balance-note/);
  assert.match(yearButton(h,2026).getAttribute('aria-label'),/실제 · 12월까지/,'12월 실제 기록 뒤에는 혼합이 아닌 실제로 표시한다');
  assert.equal(h.html().split('흐린 금액은 예상').length-1,1);
  const css=fs.readFileSync(path.join(root,'css/assets.css'),'utf8');
  assert.match(css,/\.savings-year-predicted \.savings-year-balance b[^}]*color:var\(--text-2\)/);
  assert.match(css,/\.savings-year-toggle \.savings-year-balance[^}]*white-space:nowrap/);
  assert.doesNotMatch(h.html(),/savings-balance-note/);
});

test('저축 연도 금액: 축약 금액의 원은 붙이고 펼친 본문 첫 줄·접근성 이름은 정확한 원 금액을 제공한다',()=>{
  const data=fixture();data.savings.actual[0].total=127947465;
  Object.assign(data.savings.scenarios[0],{salary:0,spending:0,growth:0,returnRate:10,giving:10,endAge:34});
  const before=JSON.stringify(data),h=setup(data),stored=[...h.storage],row=yearRow(h,2025);
  assert.match(row,/<span class="savings-year-balance"><b>1억 2,795만\u00a0원<\/b>/);
  assert.match(row,/<div class="savings-year-body" id="savings-year-2025" hidden><p class="savings-year-exact"><span>연말 저축총액 <b>127,947,465원<\/b><\/span><span>· 실제 · 12월까지<\/span><\/p>/);
  const predicted=yearRow(h,2026);
  assert.match(predicted,/class="savings-year-balance"><b>1억 3,946만\u00a0원<\/b>/);
  assert.match(predicted,/class="savings-year-return"[^]*?<b>1,279만\u00a0원<\/b>/);
  assert.match(predicted,/class="savings-year-giving"[^]*?<b>128만\u00a0원<\/b>/);
  assert.match(predicted,/연말 저축총액 <b>139,462,737원<\/b><\/span><span>· 예상 · 12월/);
  assert.equal(yearButton(h,2025).getAttribute('aria-label'),'2025년 · 31세 · 연말 저축총액 127,947,465원 · 실제 · 12월까지 · 월별 기록 펼치기');
  h.click(2025);assert.equal(yearButton(h,2025).getAttribute('aria-label'),'2025년 · 31세 · 연말 저축총액 127,947,465원 · 실제 · 12월까지 · 월별 기록 접기');
  h.click(2025);assert.match(yearButton(h,2025).getAttribute('aria-label'),/월별 기록 펼치기$/);
  h.render();assert.match(yearButton(h,2025).getAttribute('aria-label'),/월별 기록 펼치기$/);
  assert.match(savingsYearsHtml(h),/<span>연도<\/span><span>연말 저축총액<\/span><span>투자수익<\/span><span title="월급 기부 \+ 투자수익 기부">기부금<\/span>/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  data.savings.actual[0].total=-127947465;h.render();
  assert.match(yearRow(h,2025),/<b>−1억 2,795만\u00a0원<\/b>/);
  assert.match(yearButton(h,2025).getAttribute('aria-label'),/연말 저축총액 -127,947,465원/);
});

test('나이별 단계: 제목·삭제 이름은 나이와 순서를 구분하고 수정·삭제 뒤에도 맞게 갱신한다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:35},{age:40,salary:0},{}];
  const before=JSON.stringify(data),h=setup(data),stored=[...h.storage];
  const names=()=>h.document.querySelectorAll('[data-stage-del]').map(b=>b.getAttribute('aria-label'));
  assert.deepEqual(names(),['35세 단계 삭제','40세 단계 삭제','3번째 단계 삭제']);
  assert.match(h.html(),/role="group" aria-labelledby="savings-stage-0"><div class="plan-line-head"><strong id="savings-stage-0">35세부터<\/strong><button[^>]*data-stage-del="0"[^>]*>삭제<\/button><\/div><div class="plan-line-fields">/);
  assert.match(h.html(),/id="savings-stage-2">3번째 단계<\/strong>/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  editInput(stageInput(h,0,'age'),'45');
  assert.deepEqual(names(),['45세 단계 삭제','40세 단계 삭제','3번째 단계 삭제']);
  h.ctx.savingsSortStageRows();assert.deepEqual(names(),['40세 단계 삭제','45세 단계 삭제','3번째 단계 삭제']);
  assert.match(h.html(),/id="savings-stage-0">45세부터<\/strong>/);
  assert.equal(stageInput(h,1,'salary').value,'0','제목 변경으로 실제 0원 입력을 비우지 않는다');
  h.document.querySelectorAll('[data-stage-del]')[0].onclick();
  assert.deepEqual(names(),['45세 단계 삭제','2번째 단계 삭제']);assert.equal(h.saves(),2);
});

test('나이별 빈칸은 계산에 적용되는 월급·누적 사용금액·비율을 표시하고 조회로 입력·저장·결과를 바꾸지 않는다',()=>{
  const data=fixture(),sc=data.savings.scenarios[0];
  Object.assign(sc,{salary:1000000,spending:200000,growth:10,returnRate:3.125,endAge:40,
    stages:[{age:32},{age:34,salary:0,spending:500000,growth:20,returnRate:-1.234},{age:35}]});
  const before=JSON.stringify(data),h=setup(data),stored=h.storage.get(key);
  const simulation=()=>JSON.parse(vm.runInContext('JSON.stringify(simulateSavings(doc.savings,doc.savings.scenarios[0]))',h.ctx));
  const result=simulation();
  assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,0,k).placeholder),['1,000,000','220,000','10','3.125']);
  assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,2,k).placeholder),['0','600,000','20','-1.234']);
  assert.equal(stageInput(h,1,'salary').value,'0','직접 지정한 0은 빈칸으로 바꾸지 않는다');
  assert.equal(stageInput(h,1,'spending').value,'500,000');
  for(const [i,year] of [[0,2026],[2,2029]]){
    const row=result.rows.find(r=>r.year===year);
    assert.equal(stageInput(h,i,'salary').placeholder,new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(row.salary/12));
    assert.equal(stageInput(h,i,'spending').placeholder,new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(row.spending/12));
    for(const k of ['salary','spending','growth','returnRate'])assert.equal(stageInput(h,i,k).value,'','적용값을 입력값으로 채우지 않는다');
  }
  assert.doesNotMatch(h.html(),/placeholder="그대로"/);assert.match(h.html(),/회색은 적용값/);
  h.node('savingsTabAssumptions').onclick();h.render();selectScenario(h,'other');selectScenario(h,'base');
  assert.deepEqual(simulation(),result);assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('나이별 적용값은 기존 기본 가정·앞 단계·나이 변경과 값 삭제 흐름을 따라 다시 계산한다',()=>{
  const data=fixture(),sc=data.savings.scenarios[0];sc.stages=[{age:32},{age:34}];
  const h=setup(data),param=k=>h.inputs().find(x=>x.dataset.param===k);
  editInput(param('salary'),'200');editInput(param('spending'),'100');editInput(param('growth'),'10');editInput(param('returnRate'),'4.125');
  assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,1,k).placeholder),['200','121','10','4.125']);
  assert.equal(stageInput(h,1,'spending').title,'적용값: 121.00000000000003원','원 미만 정밀값도 반올림하지 않은 원래 계산값에서 조회한다');
  editInput(stageInput(h,0,'salary'),'0');editInput(stageInput(h,0,'spending'),'50');editInput(stageInput(h,0,'growth'),'20');editInput(stageInput(h,0,'returnRate'),'-2.345');
  assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,1,k).placeholder),['0','72','20','-2.345']);
  editInput(stageInput(h,0,'spending'),'');assert.equal('spending' in sc.stages[0],false);assert.equal(stageInput(h,1,'spending').placeholder,'144');
  editInput(stageInput(h,0,'salary'),'');assert.equal('salary' in sc.stages[0],false);assert.equal(stageInput(h,1,'salary').placeholder,'200');
  editInput(stageInput(h,0,'age'),'35');
  assert.equal(sc.stages[0].age,34);assert.equal(stageInput(h,0,'age').value,'35');assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,1,k).placeholder),['200','121','10','4.125']);
  assert.equal(h.saves(),11,'기존 입력 변경에만 저장한다');
});

test('나이별 적용값은 실제 기록 없는 가정·옛 기준 연도 생략·정렬 전/중복 나이·유효하지 않은 나이를 계산 규칙대로 표시한다',()=>{
  const data=fixture(),sc=data.savings.scenarios[0];delete sc.spendingYear;
  Object.assign(sc,{salary:100,spending:20,growth:10,stages:[{age:34},{age:32,salary:0,spending:30,growth:20},{age:32,salary:50,spending:40},{age:null}]});
  data.savings.actual=[{ym:'2025-12',total:1000},{ym:'2026-03',total:1200},{ym:'2030-12',total:null}];
  const h=setup(data),before=JSON.stringify(data);
  assert.equal(stageInput(h,0,'salary').placeholder,'50');assert.equal(stageInput(h,0,'spending').placeholder,'58');
  assert.equal(stageInput(h,1,'spending').value,'30');assert.equal(stageInput(h,1,'salary').value,'0');
  for(const k of ['salary','spending','growth','returnRate'])assert.equal(stageInput(h,3,k).placeholder,'—');
  assert.equal(JSON.stringify(data),before);assert.equal(h.saves(),0);
  data.savings.actual=[];sc.stages=[{age:32.5},{age:34},{age:30,spending:5}];h.render();
  assert.equal(stageInput(h,0,'spending').placeholder,'24','소수 나이의 설정이 처음 적용되는 연도를 조회한다');
  assert.equal(stageInput(h,1,'spending').placeholder,'27');assert.equal(vm.runInContext('simulateSavings(doc.savings,doc.savings.scenarios[0])',h.ctx),null);
  data.savings.startAge=30;h.render();assert.equal(stageInput(h,1,'spending').placeholder,'7','시작 나이 변경을 적용한다');
  sc.spendingYear=2030;h.render();assert.equal(stageInput(h,1,'spending').placeholder,'20','기준 연도보다 이른 해도 기존 계산과 같다');
});

const milestoneFixture=()=>{
  const data=fixture();data.savings.actual=[{ym:'2030-12',total:499000000}];
  data.savings.scenarios.forEach((sc,i)=>Object.assign(sc,{salary:i?500000:1000000,giving:0,spending:0,growth:0,returnRate:0}));
  data.savings.milestoneRecord={ym:'2032-01',age:38};return data;
};

test('5억 도달 목록: 요약과 같은 연월·나이와 월 단위 차이·가장 빠름·선택 강조를 표시한다',()=>{
  const data=milestoneFixture();data.savings.scenarios[1].salary=25000;
  const h=setup(data),before=JSON.stringify(data),stored=h.storage.get(key),base=arrivalButton(h,'base'),other=arrivalButton(h,'other');
  assert.match(base.querySelector('.savings-arrival-date').textContent,/2031.01 · 37세/);
  assert.equal(base.getAttribute('aria-pressed'),'true');assert.equal(base.querySelector('.savings-arrival-meta').children[1].textContent,'');
  assert.equal(base.querySelector('.savings-arrival-fastest').hidden,false);assert.equal(other.querySelector('.savings-arrival-fastest').hidden,true);
  assert.match(other.querySelector('.savings-arrival-date').textContent,/2034.04 · 40세/);assert.equal(other.querySelector('.savings-arrival-meta').children[1].textContent,'3년 3개월 늦음');
  other.click();assert.equal(h.node('savingsScenarioSelect').value,'other');assert.equal(arrivalButton(h,'other').getAttribute('aria-pressed'),'true');
  assert.equal(arrivalButton(h,'base').querySelector('.savings-arrival-meta').children[1].textContent,'3년 3개월 빠름');
  assert.equal(arrivalButton(h,'other').querySelector('.savings-arrival-meta').children[1].textContent,'');
  assert.match(h.document.querySelector('.savings-goal-date').textContent,/2034.04 · 40세/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('5억 도달 목록: 실제 달성·동일 시점·미도달·실제 기록 없음을 계산 판정 그대로 표시한다',()=>{
  const data=milestoneFixture(),h=setup(data),sc=data.savings.scenarios[1];
  Object.assign(sc,{salary:0,returnRate:0});h.render();assert.match(arrivalButton(h,'other').textContent,/종료 나이까지 미도달/);
  assert.equal(arrivalButton(h,'other').querySelector('.savings-arrival-fastest').hidden,true);assert.equal(arrivalButton(h,'other').querySelector('.savings-arrival-meta').children[1].textContent,'');
  data.savings.actual=[{ym:'2025-06',total:500000000},{ym:'2025-12',total:490000000}];h.render();
  for(const id of ['base','other']){assert.match(arrivalButton(h,id).querySelector('.savings-arrival-date').textContent,/달성 2025.06 · 31세/);assert.equal(arrivalButton(h,id).querySelector('.savings-arrival-fastest').hidden,false);}
  assert.equal(arrivalButton(h,'other').querySelector('.savings-arrival-meta').children[1].textContent,'같은 시점');
  data.savings.actual=[];const empty=JSON.stringify(data);h.render();
  for(const id of ['base','other']){assert.match(arrivalButton(h,id).textContent,/실제 기록 없음/);assert.equal(arrivalButton(h,id).querySelector('.savings-arrival-fastest').hidden,true);}
  assert.equal(JSON.stringify(data),empty);assert.equal(h.saves(),0);
});

test('5억 도달 비교 표: 개별 칸 강조·첫 5억 안내 없이 정확한 원 금액과 현재 시나리오 행 강조만 유지한다',()=>{
  const data=milestoneFixture(),h=setup(data),rows=()=>h.document.querySelector('[data-savings-result="compare"]').querySelectorAll('tbody tr');
  const check=()=>{
    const table=h.document.querySelector('[data-savings-result="compare"]');assert.doesNotMatch(table.outerHTML,/savings-compare-goal|첫 5억 이상/);
    for(const row of rows())for(const cell of row.querySelectorAll('td')){
      assert.equal(cell.hasAttribute('class'),false);
      if(cell.textContent!=='—')assert.match(cell.getAttribute('aria-label'),/^[\d,]+원$/);
    }
  };
  check();assert.equal(rows()[0].querySelectorAll('td')[1].getAttribute('aria-label'),'547,000,000원');assert.equal(rows()[1].querySelectorAll('td')[1].getAttribute('aria-label'),'523,000,000원');
  assert.deepEqual(rows().map(x=>x.className),['active','']);selectScenario(h,'other');check();assert.deepEqual(rows().map(x=>x.className),['','active']);assert.equal(h.saves(),0);
  editInput(paramInput(h,'salary'),'0');check();assert.deepEqual(rows().map(x=>x.className),['','active']);assert.equal(h.saves(),1);
  assert.equal(h.document.querySelectorAll('[data-savings-scenario]').length,2,'위 도달 시점 목록은 유지한다');
  assert.doesNotMatch(fs.readFileSync(path.join(root,'css/assets.css'),'utf8'),/savings-compare-goal/);
});

test('5억 도달 목록 입력 직후 선택: 결과와 내부 터치 노드를 유지한 채 한 번 저장하고 시나리오만 전환한다',()=>{
  const h=setup(milestoneFixture(),2026,undefined,{cloneOnSave:true}),salary=paramInput(h,'salary'),button=arrivalButton(h,'other'),touch=button.querySelector('.savings-arrival-date').children[0];
  salary.focus();salary.value='2000000';button.focus();
  assert.equal(arrivalButton(h,'other'),button);assert.equal(button.querySelector('.savings-arrival-date').children[0],touch);assert.equal(h.saves(),1);
  button.onclick();assert.equal(h.node('savingsScenarioSelect').value,'other');assert.equal(h.saves(),1);assert.equal(h.store.doc.savings.scenarios[0].salary,2000000);
});

test('올해 월 사용금액: 과거 기준 연도의 증가분·단계를 반영해 원 반올림으로 표시하고 조회는 저장·계산을 바꾸지 않는다',()=>{
  const data=fixture(),sc=data.savings.scenarios[0];Object.assign(sc,{spending:123456.78,spendingYear:2020,growth:7.4,stages:[{age:34,spending:300000}]});
  const original=JSON.stringify(data),h=setup(data),stored=[...h.storage],simulation=()=>vm.runInContext('JSON.stringify(simulateSavings(doc.savings,doc.savings.scenarios[0]))',h.ctx),before=simulation();
  assert.equal(paramInput(h,'spending').value,new Intl.NumberFormat('ko-KR').format(Math.round(123456.78*1.074**6)));
  assert.equal(Number(paramInput(h,'spending').value.replaceAll(',','')),spendingNow(h));
  const row=JSON.parse(before).rows.find(r=>r.year===2026);assert.ok(Math.abs(row.spending/12-123456.78*1.074**6)<1e-8);
  assert.doesNotMatch(h.html(),/data-param="spendingYear"|사용금액 기준 연도/);assert.match(h.html(),/월 사용금액 \(2026년\)/);
  h.node('savingsTabAssumptions').click();h.render();h.tick();h.node('savingsTabOverview').click();
  assert.equal(simulation(),before);assert.equal(JSON.stringify(data),original);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
});

test('올해 월 사용금액: 실제 없음·시작 연도/나이 생략·옛 기준 연도 생략도 단계 적용값과 같은 기준으로 조회한다',()=>{
  for(const noActual of [false,true]){
    const data=fixture();delete data.savings.startYear;delete data.savings.startAge;delete data.savings.scenarios[0].spendingYear;
    data.savings.actual=noActual?[]:[{ym:'2023-12',total:1000},{ym:'2025-09',total:2000},{ym:'2030-12',total:null}];
    Object.assign(data.savings.scenarios[0],{spending:123.45,growth:10,endAge:10,stages:[{age:1,spending:222.22}]});
    const original=JSON.stringify(data),h=setup(data);assert.equal(Number(paramInput(h,'spending').value.replaceAll(',','')),spendingNow(h));
    h.render();assert.equal(JSON.stringify(data),original);assert.equal(h.saves(),0);
  }
});

test('올해 월 사용금액 수정: 값 변경 때만 금액·올해 기준 연도를 함께 저장하고 빈값·동일값은 저장하지 않는다',()=>{
  const h=setup(fixture(),2026,undefined,{cloneOnSave:true}),input=paramInput(h,'spending'),button=yearButton(h,2027),before=h.store.doc.savings.scenarios[0];
  assert.equal(input.value,'51');editInput(input,'');assert.equal(input.value,'51');editInput(input,'51');assert.equal(h.saves(),0);assert.equal(before.spendingYear,2025);
  input.focus();input.value='1200000';button.focus();assert.equal(h.saves(),1);assert.equal(paramInput(h,'spending'),input);assert.equal(yearButton(h,2027),button);
  const saved=h.store.doc.savings.scenarios[0];assert.equal(saved.spending,1200000);assert.equal(saved.spendingYear,2026);assert.equal(saved.growth,2);
  button.onclick();assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(input.value,'1,200,000');assert.equal(h.saves(),1);
});

test('올해 월 사용금액 부분 갱신: 증가율·시작 기준·단계 변경을 표시하되 초점이 있으면 입력 중인 값을 유지한다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:31,growth:5}];const h=setup(data),input=paramInput(h,'spending'),base=k=>h.inputs().find(x=>x.dataset.base===k);
  const check=()=>assert.equal(Number(input.value.replaceAll(',','')),spendingNow(h));check();
  assert.equal(input.hasAttribute('aria-describedby'),false);assert.equal(h.node('savingsSpendingHelp').hidden,true);
  editInput(stageInput(h,0,'growth'),'10');check();editInput(base('startYear'),'2024');check();editInput(base('startAge'),'30');check();
  editInput(stageInput(h,0,'spending'),'100000');check();editInput(paramInput(h,'growth'),'20');check();
  assert.equal(paramInput(h,'spending'),input);input.focus();input.value='180.';editInput(paramInput(h,'growth'),'12');
  assert.equal(h.document.activeElement,input);assert.equal(input.value,'180.');
  assert.equal(h.store.doc.savings.scenarios[0].spending,50);assert.equal(h.store.doc.savings.scenarios[0].spendingYear,2025);
});

test('올해 월 사용금액: 안내가 보이는 읽기 전용일 때만 설명을 연결하고 부분 갱신에서도 같은 칸의 속성을 함께 전환한다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:32,salary:200},{age:32,spending:765432.5}];
  const h=setup(data,2026,undefined,{cloneOnSave:true}),input=paramInput(h,'spending'),controls=h.node('savingsView').querySelectorAll('input,button');
  const check=readOnly=>{
    assert.equal(paramInput(h,'spending'),input);assert.deepEqual(h.node('savingsView').querySelectorAll('input,button'),controls);
    assert.equal(input.hasAttribute('readonly'),readOnly);assert.equal(h.node('savingsSpendingHelp').hidden,!readOnly);
    if(readOnly)assert.equal(input.getAttribute('aria-describedby'),'savingsSpendingHelp');else assert.equal(input.hasAttribute('aria-describedby'),false);
  };
  check(true);assert.equal(input.value,'765,433');
  assert.equal(h.node('savingsSpendingHelp').hidden,false);assert.equal(h.node('savingsSpendingHelp').textContent,'올해는 32세 단계 사용금액이 적용됩니다');
  editInput(input,'999');assert.equal(h.saves(),0);assert.equal(input.value,'765,433');assert.equal(data.savings.scenarios[0].spending,50);
  editInput(stageInput(h,1,'spending'),'800000');assert.equal(input.value,'800,000');check(true);
  editInput(stageInput(h,1,'age'),'33');check(false);assert.equal(input.value,'51');
  editInput(stageInput(h,1,'age'),'32');check(true);
  editInput(stageInput(h,1,'spending'),'');check(false);assert.equal(input.value,'51');
});

test('올해 월 사용금액 새해: 연도·금액·단계 읽기 전용을 자동 갱신하며 기존 기준 연도는 저장하지 않는다',()=>{
  const data=fixture();data.savings.scenarios[0].stages=[{age:33,spending:700}];const h=setup(data),stored=[...h.storage],before=JSON.stringify(data);
  h.setYear(2027);h.tick();assert.match(h.html(),/월 사용금액 \(2027년\)/);assert.equal(paramInput(h,'spending').value,'700');assert.equal(paramInput(h,'spending').hasAttribute('readonly'),true);
  assert.equal(paramInput(h,'spending').getAttribute('aria-describedby'),'savingsSpendingHelp');
  h.setYear(2028);h.events.get('window:focus')();assert.match(h.html(),/월 사용금액 \(2028년\)/);assert.equal(paramInput(h,'spending').value,'714');assert.equal(paramInput(h,'spending').hasAttribute('readonly'),false);
  assert.equal(paramInput(h,'spending').hasAttribute('aria-describedby'),false);
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
});

test('저축 요약: 현재 5억 달성 월·연도 나이와 과거 최단 기록을 구분하고 시나리오 전환은 기록을 저장하지 않는다',()=>{
  const data=milestoneFixture(),before=JSON.stringify(data),h=setup(data),stored=h.storage.get(key);
  assert.doesNotMatch(h.html(),/40세 말 \(예상\)/);
  assert.match(h.html(),/class="savings-goal-date"[^>]*>2031\.01 <span class="savings-milestone-age">· 37세<\/span><\/span>/);
  assert.match(h.html(),/목표 도달 최단 기록<\/h2><div><b>2032\.01 <span class="savings-milestone-age">· 38세<\/span><\/b>/);assert.match(h.html(),/id="saveSavingsMilestone"/);
  assert.equal((h.html().match(/class="card savings-summary"/g)||[]).length,1);
  assert.equal((h.html().match(/class="savings-goal"/g)||[]).length,1);assert.doesNotMatch(h.html(),/class="metric(?: |")/);
  assert.equal(h.node('savingsScenarioSelect').value,'base');
  selectScenario(h,'other');assert.equal(h.node('savingsScenarioSelect').value,'other');
  assert.match(h.html(),/class="savings-goal-date"[^>]*>2031\.02 <span class="savings-milestone-age">· 37세<\/span><\/span>/);
  assert.match(h.html(),/목표 도달 최단 기록<\/h2><div><b>2032\.01 <span class="savings-milestone-age">· 38세<\/span><\/b>/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('저축 요약: 저장 버튼은 현재 예상 월을 저장하며 늦어짐·미달성·나이 기준 변경에도 과거 기록은 유지한다',()=>{
  const data=milestoneFixture(),h=setup(data);
  h.node('saveSavingsMilestone').onclick();assert.deepEqual(data.savings.milestoneRecord,{ym:'2031-01',age:37});assert.equal(h.saves(),1);
  assert.equal(h.node('saveSavingsMilestone').hidden,true);
  selectScenario(h,'other');assert.match(h.html(),/class="savings-goal-date"[^>]*>2031\.02 <span class="savings-milestone-age">· 37세<\/span><\/span>/);
  data.savings.scenarios[1].salary=0;data.savings.startAge=32;h.render();
  assert.match(h.html(),/기간 내 미도달/);assert.match(h.html(),/목표 도달 최단 기록<\/h2><div><b>2031\.01 <span class="savings-milestone-age">· 37세<\/span><\/b>/);
  assert.equal(h.node('saveSavingsMilestone').hidden,true);assert.equal(h.saves(),1);
  const reloaded=setup(JSON.parse(h.storage.get(key)));assert.match(reloaded.html(),/목표 도달 최단 기록<\/h2><div><b>2031\.01 <span class="savings-milestone-age">· 37세<\/span><\/b>/);
});

test('저축 요약: 실제 기록 없음·이미 달성·나이 정보 없는 옛 기록을 구분하고 조회로 초기 기록을 만들지 않는다',()=>{
  const data=milestoneFixture();delete data.savings.milestoneRecord;data.savings.actual=[];
  const h=setup(data),before=JSON.stringify(data);assert.match(h.html(),/class="savings-goal-date"[^>]*>실제 기록 없음<\/span>/);assert.match(h.html(),/저장된 기록 없음/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.saves(),0);
  data.savings.actual=[{ym:'2030-12',total:500000000}];h.render();assert.match(h.html(),/2030\.12 <span class="savings-milestone-age">· 36세<\/span>/);assert.match(h.html(),/실제 월말 기록 · 이미 달성/);
  data.savings.milestoneRecord={ym:'2030-11'};h.render();assert.match(h.html(),/목표 도달 최단 기록<\/h2><div><b>2030\.11<\/b>/,'기록에 나이가 없으면 추정해서 붙이지 않는다');
});

test('저축 목표 바: 실제 금액의 진행률은 그대로 읽히고 채움은 0~100%, 백분율 위치는 절반까지만 이동한다',()=>{
  for(const [total,percent,fill,labelWidth]of [[0,'0%',0,0],[-125000000,'-25%',0,0],[125000000,'25%',25,25],[250000000,'50%',50,50],[375000000,'75%',75,50],[625000000,'125%',100,50]]){
    const data=fixture();data.savings.actual=[{ym:'2025-12',total}];
    const before=JSON.stringify(data),h=setup(data),stored=h.storage.get(key);
    const goal=h.html().match(/<div class="savings-goal"([^>]*)>([^]*?)<\/div>/);
    assert.ok(goal);assert.match(goal[1],/role="progressbar"/);
    assert.match(goal[1],/aria-valuemin="0"/);assert.match(goal[1],/aria-valuemax="100"/);
    assert.match(goal[1],new RegExp(`aria-valuenow="${fill}"`));assert.match(goal[1],new RegExp(`aria-valuetext="${percent}"`));
    assert.match(goal[2],new RegExp(`class="savings-goal-fill" style="width:${fill}%"`));
    assert.match(goal[2],new RegExp(`class="savings-goal-label-group" style="width:${labelWidth}%"`));
    assert.match(goal[2],/<b>목표 5억<\/b>/);assert.match(goal[2],new RegExp(`class="savings-goal-percent">${percent}<\/span>`));
    assert.doesNotMatch(goal[2].replace(/<[^>]*>/g,''),/달성|가정 기반 예측|원/,'목표 줄에는 간결한 목표·백분율·날짜만 표시한다');
    assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
  }
});

test('저축 목표 바: 미기록은 0%로 단정하지 않으며 조회로 금액이나 기록을 생성하지 않는다',()=>{
  for(const actual of [[],[{ym:'2025-12',total:null}]]){
    const data=fixture();data.savings.actual=actual;
    const before=JSON.stringify(data),h=setup(data),stored=h.storage.get(key);
    const goal=h.html().match(/<div class="savings-goal"([^>]*)>([^]*?)<\/div>/);
    assert.ok(goal);assert.doesNotMatch(goal[1],/aria-valuenow=/);assert.match(goal[1],/aria-valuetext="실제 기록 없음"/);
    assert.match(goal[2],/class="savings-goal-percent">—<\/span>/);
    assert.match(goal[2],/class="savings-goal-date"[^>]*>실제 기록 없음<\/span>/);
    assert.match(goal[2],/class="savings-goal-fill" style="width:0%"/);
    assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
  }
});

test('저축 목표 바: 시나리오 예상과 별개로 마지막 실제 기록을 사용하며 월별 0 입력도 저장한다',()=>{
  const data=milestoneFixture(),h=setup(data);
  const progress=()=>h.html().match(/class="savings-goal-percent">([^<]*)<\/span>/)[1];
  assert.equal(progress(),'99.8%');selectScenario(h,'other');assert.equal(progress(),'99.8%');assert.equal(h.saves(),0);
  const input=h.inputs().find(x=>x.dataset.actual==='2031-01');assert.ok(input);
  editInput(input,'0');assert.equal(progress(),'0%');assert.equal(h.saves(),1);
  assert.deepEqual(JSON.parse(JSON.stringify(data.savings.actual.find(x=>x.ym==='2031-01'))),{ym:'2031-01',total:0});
  assert.match(h.html(),/2031\.01 실제 기록/);assert.match(h.html(),/기간 내 미도달/);
  assert.deepEqual(data.savings.milestoneRecord,{ym:'2032-01',age:38},'실제 금액 수정은 과거 최단 기록을 덮어쓰지 않는다');
});

test('저축 상세 탭: DOM과 입력값을 유지하며 탭 선택·키보드 이동·다시 그리기는 저장하지 않는다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=setup(data),stored=[...h.storage];
  const names=['Overview','Records','Assumptions'];
  const check=active=>{
    for(const name of names){
      const button=h.node(`savingsTab${name}`),pane=h.node(button.getAttribute('aria-controls'));
      assert.equal(button.getAttribute('role'),'tab');assert.equal(button.getAttribute('aria-selected'),String(name===active));
      assert.equal(button.tabIndex,name===active?0:-1);assert.equal(pane.hidden,name!==active);
      assert.match(h.html(),new RegExp(`id="savingsPane${name}"`));
    }
  };
  check('Overview');
  const input=h.inputs().find(x=>x.dataset.param==='salary'),actual=h.inputs().find(x=>x.dataset.actual==='2026-01');
  for(const name of names){h.node(`savingsTab${name}`).onclick();check(name);assert.equal(h.inputs().find(x=>x.dataset.param==='salary'),input);assert.equal(h.inputs().find(x=>x.dataset.actual==='2026-01'),actual);}
  let prevented=false;h.node('savingsTabAssumptions').onkeydown({key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);check('Overview');assert.equal(h.document.activeElement,h.node('savingsTabOverview'));
  for(const [from,key,to] of [['Overview','ArrowRight','Records'],['Records','ArrowRight','Assumptions'],['Overview','ArrowLeft','Assumptions'],['Assumptions','Home','Overview'],['Overview','End','Assumptions'],['Assumptions','ArrowLeft','Records'],['Records','Home','Overview']]){
    h.node(`savingsTab${from}`).onkeydown({key,preventDefault(){}});check(to);assert.equal(h.document.activeElement,h.node(`savingsTab${to}`));
  }
  h.render();check('Overview');
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  const reloaded=setup(JSON.parse(before),2026,h.storage);assert.equal(reloaded.node('savingsTabOverview').getAttribute('aria-selected'),'true','탭 선택은 새로고침하면 실제 기록 유무로 다시 정한다');
});

test('저축 상세 탭: 입력을 편집하다 첫 터치로 이동하면 변경을 한 번 저장하고 선택한 탭을 연다',()=>{
  const data=fixture(),h=setup(data),storedUi=h.storage.get('etf-planner-assets-ui');
  h.node('savingsTabAssumptions').onclick();
  const salary=h.inputs().find(x=>x.dataset.param==='salary'),records=h.node('savingsTabRecords');
  salary.focus();salary.value='450';
  assert.equal(records.onpointerdown,undefined,'부분 갱신으로 첫 터치를 유지하므로 pointerdown 보호가 필요 없다');
  assert.equal(h.document.activeElement,salary);assert.equal(data.savings.scenarios[0].salary,100);assert.equal(h.saves(),0);
  records.onclick();
  assert.equal(data.savings.scenarios[0].salary,450);assert.equal(h.saves(),1);
  assert.equal(h.inputs().find(x=>x.dataset.param==='salary').value,'450');
  assert.equal(h.node('savingsTabRecords').getAttribute('aria-selected'),'true');
  assert.equal(h.node('savingsPaneRecords').hidden,false);assert.equal(h.node('savingsPaneAssumptions').hidden,true);
  assert.equal(h.document.activeElement,h.node('savingsTabRecords'));
  assert.match(h.html(),/id="savingsTabRecords"[^>]*aria-selected="true"/,'change가 다시 그릴 때부터 선택한 탭을 유지한다');
  h.render();h.node('savingsTabRecords').onclick();
  assert.equal(h.node('savingsTabRecords').getAttribute('aria-selected'),'true');assert.equal(h.saves(),1,'탭 전환 자체로 다시 저장하지 않는다');
  assert.equal(h.storage.get('etf-planner-assets-ui'),storedUi);
});

test('저축 기본 탭: 유효한 실제 총액이 있으면 개요, 없으면 기록이며 0원도 실제 기록이다',()=>{
  for(const [actual,tab] of [[[],'Records'],[[{ym:'2025-12',total:null}],'Records'],[[{ym:'2025-12',total:''}],'Records'],[[{ym:'2025-12',total:'invalid'}],'Records'],[[{ym:'invalid',total:100}],'Records'],[[{ym:'2025-12',total:0}],'Overview'],[[{ym:'2025-12',total:1000}],'Overview']]){
    const data=fixture();data.savings.actual=actual;const before=JSON.stringify(data),h=setup(data);
    assert.equal(h.node(`savingsTab${tab}`).getAttribute('aria-selected'),'true');
    assert.deepEqual([...h.html().matchAll(/role="tab" id="savingsTab(\w+)"/g)].map(m=>m[1]),['Overview','Records','Assumptions']);
    h.node('savingsTabAssumptions').onclick();h.render();selectScenario(h,'other');
    assert.equal(h.node('savingsTabAssumptions').getAttribute('aria-selected'),'true');
    assert.equal(JSON.stringify(data),before);assert.equal(h.saves(),0);
    const reloaded=setup(JSON.parse(before),2026,h.storage);assert.equal(reloaded.node(`savingsTab${tab}`).getAttribute('aria-selected'),'true');
  }
});

test('저축 탭 구조: 요약만 탭 위에 두고 개요·가정·기록 내용은 해당 패널 안에 둔다',()=>{
  const h=setup(milestoneFixture()),overview=savingsPaneHtml(h,'Overview'),assumptions=savingsPaneHtml(h,'Assumptions'),records=savingsPaneHtml(h,'Records');
  assert.ok(h.html().indexOf('class="card savings-summary"')<h.html().indexOf('role="tablist"'));
  assert.match(overview,/5억 도달 시점[^]*시나리오 비교[^]*나이별 연말 저축총액[^]*class="card savings-future"[^]*장기 예상 자산[^]*60세 말 · 2054\.12[^]*현재 시나리오의 월말 자산 기준[^]*목표 도달 최단 기록/);
  assert.match(overview,/지금 예상이 저장된 시점보다 빠를 때 저장할 수 있습니다/);
  assert.doesNotMatch(overview,/<details/);
  assert.match(assumptions,/data-param="salary"[^]*계산 방식/);assert.match(records,/연도별 기록/);
  for(const content of ['장기 예상 자산','목표 도달 최단 기록','계산 방식']){
    assert.equal(h.html().split(content).length-1,1);
  }
  assert.doesNotMatch(assumptions+records,/장기 예상 자산|목표 도달 최단 기록/);
  assert.doesNotMatch(overview+records,/계산 방식/);
  // 마지막 패널의 닫힘 뒤에 카드나 편집 버튼이 남지 않는다.
  assert.match(h.html(),/<\/div>\s*<\/section>\s*$/);
  assert.doesNotMatch(h.html(),/data-savings-setting|toggleSavingsAssumptions|가정 수정하기|가정 접기|data-savings-detail="future"|과거 최단 기록/);
  for(const name of ['Overview','Records','Assumptions']){
    h.node(`savingsTab${name}`).onclick();
    assert.equal(['Overview','Records','Assumptions'].filter(x=>!h.node(`savingsPane${x}`).hidden).join(),name);
  }
  assert.equal(h.saves(),0);
});

test('저축 가정: 입력 묶음을 바로 보여 주고 계산 방식만 기본 접힘이며 삭제는 둘 이상일 때 맨 아래에 있다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=setup(data),stored=[...h.storage];
  h.node('savingsTabAssumptions').onclick();assert.equal(h.node('savingsAssumptionsBody').hidden,false);
  const pane=savingsPaneHtml(h,'Assumptions');
  assert.match(pane,/기본<\/h2>[^]*data-param="name"[^]*data-base="startYear"[^]*data-base="startAge"[^]*data-param="endAge"[^]*월급·지출<\/h2>[^]*data-param="salary"[^]*data-param="giving"[^]*월 사용금액 \(2026년\)[^]*data-param="spending"[^]*data-param="growth"[^]*수익<\/h2>[^]*data-param="returnRate"[^]*나이별 변경[^]*메모[^]*계산 방식[^]*id="deleteScenario"/);
  assert.doesNotMatch(pane,/사용금액 기준 연도|data-param="spendingYear"/);
  const detail=()=>h.document.querySelectorAll('[data-savings-detail]').find(x=>x.dataset.savingsDetail==='method');
  assert.equal(detail().open,false);detail().open=true;detail().ontoggle();h.render();
  assert.equal(detail().open,true);assert.equal(h.node('savingsAssumptionsBody').hidden,false);
  h.node('savingsTabOverview').onclick();h.node('savingsTabAssumptions').onclick();
  assert.equal(detail().open,true);assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  const single=fixture();single.savings.scenarios.length=1;
  assert.doesNotMatch(setup(single).html(),/id="deleteScenario"/);
});

test('저축 미기록 안내: 기록 입력 버튼은 기록 탭으로만 이동하며 조회·재렌더·이동은 저장하지 않는다',()=>{
  const data=fixture();data.savings.actual=[];const before=JSON.stringify(data),h=setup(data),stored=[...h.storage];
  assert.match(h.html(),/id="enterSavingsRecord"[^>]*>기록 입력<\/button>/);
  assert.doesNotMatch(h.html(),/기록 탭에서/);
  h.node('savingsTabOverview').onclick();h.node('enterSavingsRecord').onclick();
  assert.equal(h.node('savingsPaneRecords').hidden,false);assert.equal(h.document.activeElement,h.node('savingsTabRecords'));
  h.render();assert.equal(h.node('savingsTabRecords').getAttribute('aria-selected'),'true');
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
});

test('저축 기록 입력 버튼: 가정 편집 중 첫 터치도 값을 한 번 저장하고 기록 탭으로 이동한다',()=>{
  const data=fixture();data.savings.actual=[];const h=setup(data);
  h.node('savingsTabAssumptions').onclick();
  const salary=h.inputs().find(x=>x.dataset.param==='salary');salary.focus();salary.value='450';
  const button=h.node('enterSavingsRecord');let prevented=false;
  assert.equal(button.onpointerdown,undefined);
  button.onclick();assert.equal(h.saves(),1);assert.equal(data.savings.scenarios[0].salary,450);
  assert.equal(h.node('savingsPaneRecords').hidden,false);assert.equal(h.document.activeElement,h.node('savingsTabRecords'));
  h.render();assert.equal(h.node('savingsTabRecords').getAttribute('aria-selected'),'true');assert.equal(h.saves(),1);
});

test('저축 비교 표: 미기록 연도·종료 나이 밖은 —, 실제 0원은 0원이며 축약 금액의 정확한 원 금액을 읽을 수 있다',()=>{
  const data=fixture();data.savings.startAge=30;
  data.savings.actual=[{ym:'2035-12',total:0},{ym:'2040-12',total:123456789}];
  data.savings.scenarios[1].endAge=40;const before=JSON.stringify(data),h=setup(data),stored=[...h.storage];
  const rows=[...savingsPaneHtml(h,'Overview').matchAll(/<tr[^>]*><th scope="row">([^]*?)<\/tr>/g)].map(m=>m[1]);
  assert.equal(rows.length,2);
  assert.match(rows[0],/^기본<\/th><td>—<\/td><td aria-label="0원">0원<\/td><td aria-label="123,456,789원">1억 2,346만 원<\/td>/);
  assert.match(rows[1],/^비교<\/th><td>—<\/td><td aria-label="0원">0원<\/td>(?:<td>—<\/td>){3}$/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
});

test('저축 빈 화면과 새로 시작: 기존 초기 데이터 필드로 한 번만 저장하고 기록 탭의 현재 연도를 펼친다',()=>{
  const data={version:1},h=setup(data),stored=[...h.storage];
  assert.match(h.html(),/저축 계획을 시작하세요/);
  assert.match(h.html(),/매달 말 저축총액을 기록하면 목표 5억 도달 시점을 예상합니다\. 다른 기기에서 쓰던 기록은 동기화하면 불러옵니다\./);
  h.render();assert.deepEqual(data,{version:1});assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  h.node('startSavings').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(data.savings)),{savedAt:'',startYear:2026,startAge:30,actual:[],scenarios:[{id:data.savings.scenarios[0].id,name:'기본',salary:0,giving:0,spending:0,spendingYear:2026,growth:2,returnRate:5,endAge:60,stages:[]}]});
  assert.ok(data.savings.scenarios[0].id);assert.equal(h.saves(),1);
  assert.equal(h.node('savingsPaneRecords').hidden,false);assert.deepEqual(openYears(h),[2026]);
  h.node('savingsTabAssumptions').onclick();h.render();assert.equal(h.saves(),1);
});

test('저축 사용자 문자열: 시나리오 이름과 메모를 모든 위치에서 이스케이프한다',()=>{
  const data=fixture();Object.assign(data.savings.scenarios[0],{name:'<img src=x onerror="alert(1)">',note:'</textarea><script>alert(1)</script>&'});
  const before=JSON.stringify(data),h=setup(data);
  assert.doesNotMatch(h.html(),/<img src=x|<script>alert/);
  assert.match(h.html(),/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(h.html(),/&lt;\/textarea&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.saves(),0);
});

test('저축 연도별: 투자수익은 기부 전으로 표시하고 기부·연말 잔액·저장 기록은 유지한다',()=>{
  for(const rate of [-10,0,10]){
    const data=fixture();data.savings.scenarios=[{id:'base',name:'기본',salary:100,giving:10,spending:20,spendingYear:2026,growth:0,returnRate:rate,endAge:34,stages:[]}];
    const original=JSON.stringify(data),h=setup(data),stored=h.storage.get(key);
    const simulation=()=>JSON.parse(vm.runInContext('JSON.stringify(simulateSavings(doc.savings,doc.savings.scenarios[0]))',h.ctx));
    const before=simulation(),first=before.rows.find(r=>r.year===2026),gross=1000*rate/100,donation=rate>0?10:0;
    assert.equal(first.returns,gross-donation,'계산의 returns는 기부 후 수익이다');
    assert.equal(first.returnGiving,donation);assert.equal(first.end,1000+12*70+gross-donation);
    const row=h.html().split(/<section class="savings-year(?: savings-year-current)?">/).find(x=>x.includes('data-savings-year="2026"'));
    assert.match(row,new RegExp(`class="savings-year-return"><small class="savings-column-label">투자수익</small><b>${gross}원</b>`));
    assert.match(row,new RegExp(`<span>투자수익 기부</span><b>${donation}원</b>`));
    const years=savingsYearsHtml(h);
    assert.doesNotMatch(years,/기부 후/);assert.match(years,/<span>투자수익<\/span>/);
    h.click(2025);h.render();h.node('toggleYears').onclick();
    assert.deepEqual(simulation(),before,'표시·펼침·전체 연도 전환은 모든 연도 계산 결과를 바꾸지 않는다');
    assert.equal(JSON.stringify(data),original);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
    if(rate===10){const next=before.rows.find(r=>r.year===2027);assert.equal(next.returnGiving,19.3);assert.equal(next.end,2943.7,'기부 차감 후 1930원을 다음 해 기준으로 사용한다');}
  }
});

test('저축 연도별: 시나리오·수익률 변경과 소수 수익도 기부 전 기준으로 한 번만 반올림한다',()=>{
  const data=fixture();data.savings.actual[0].total=100;
  data.savings.scenarios=[{id:'base',name:'기본',salary:0,giving:10,spending:0,spendingYear:2026,growth:0,returnRate:4.6,endAge:33,stages:[{age:33,returnRate:10}]},
    {id:'other',name:'비교',salary:0,giving:10,spending:0,spendingYear:2026,growth:0,returnRate:10,endAge:33,stages:[]}];
  const h=setup(data),original=JSON.stringify(data),stored=h.storage.get(key);
  const row=year=>h.html().split(/<section class="savings-year(?: savings-year-current)?">/).find(x=>x.includes(`data-savings-year="${year}"`));
  assert.match(row(2026),/class="savings-year-return"[^]*?<b>5원<\/b>/,'4.14원 + 0.46원을 더한 4.6원을 표시 시 반올림한다');
  assert.match(row(2026),/<span>투자수익 기부<\/span><b>0원<\/b>/);
  assert.match(row(2027),/class="savings-year-return"[^]*?<b>10원<\/b>/);
  selectScenario(h,'other');
  assert.match(row(2026),/class="savings-year-return"[^]*?<b>10원<\/b>/);assert.match(row(2026),/<span>투자수익 기부<\/span><b>1원<\/b>/);
  assert.equal(JSON.stringify(data),original);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('저축 연도별: 시스템 현재 연도만 기본 펼침이고 화면 문구 없이 접근성 상태를 제공한다',()=>{
  const h=setup(),before=h.storage.get(key);
  assert.deepEqual(openYears(h),[2026]);
  assert.ok(h.state().every(([,open,visible])=>open===visible));
  assert.match(h.html(),/class="savings-year savings-year-current"/);
  assert.match(h.html(),/2026년<\/b><small class="savings-year-age">32세<\/small>/);
  const years=savingsYearsHtml(h);
  assert.doesNotMatch(years.replace(/<[^>]*>/g,''),/펼치기|접기|올해|실제 마지막 기록 \/ 예상 12월/);
  assert.doesNotMatch(years,/data-savings-fold-action|savings-current-label/);
  assert.match(yearButton(h,2026).getAttribute('aria-label'),/^2026년 · 32세 · 연말 저축총액 1,513원 · 예상 · 12월 · 월별 기록 접기$/);
  h.click(2026);assert.match(yearButton(h,2026).getAttribute('aria-label'),/월별 기록 펼치기$/);
  assert.equal(h.storage.get(key),before);assert.equal(h.saves(),0);
});

test('저축 연도별: 수동 상태는 다시 그리기·시나리오 전환 때 유지하고 새로고침 때 초기화한다',()=>{
  const h=setup(),before=h.storage.get(key),storedUi=h.storage.get('etf-planner-assets-ui');
  h.click(2025);h.click(2026);h.click(2027);h.render();h.tick();
  assert.deepEqual(openYears(h),[2025,2027]);
  assert.equal(h.storage.get('etf-planner-assets-ui'),storedUi,'펼침 상태는 브라우저 저장소에 쓰지 않는다');
  selectScenario(h,'other');
  assert.deepEqual(openYears(h),[2025,2027]);
  assert.equal(h.storage.get(key),before);assert.equal(h.saves(),0);
  const reloaded=setup(JSON.parse(before),2026,h.storage);
  assert.deepEqual(openYears(reloaded),[2026]);
});

test('저축 연도별: 줄여 보기에서 현재 연도를 접어도 계속 표시한다',()=>{
  const data=fixture();data.savings.startYear=2000;data.savings.startAge=20;
  data.savings.actual=[{ym:'2000-12',total:1000}];
  const h=setup(data);assert.deepEqual(openYears(h),[2026]);
  h.click(2026);h.render();
  assert.ok(h.state().some(([year,open])=>year===2026&&!open));
});

test('저축 연도별: 연도 변경을 주기적으로 확인하고 새 현재 연도만 펼친다',()=>{
  const h=setup(),before=h.storage.get(key);h.click(2025);h.click(2027);
  h.setYear(2027);h.tick();
  assert.deepEqual(openYears(h),[2027]);
  assert.match(h.html(),/class="savings-year savings-year-current"><button[^>]+data-savings-year="2027"/);
  h.click(2028);h.render();assert.deepEqual(openYears(h),[2027,2028]);
  assert.equal(h.storage.get(key),before);assert.equal(h.saves(),0);
});

test('저축 연도별: 화면 복귀·탭 전환 때 연도를 확인하고 입력 중이면 갱신을 미룬다',()=>{
  const h=setup();h.click(2025);h.setYear(2027);
  h.document.activeElement={tagName:'INPUT',closest:()=>null};
  h.tick();assert.deepEqual(openYears(h),[2025,2026]);
  h.document.activeElement=null;h.events.get('document:focusout')();h.flush();
  assert.deepEqual(openYears(h),[2027]);
  h.setYear(2028);h.events.get('window:focus')();assert.deepEqual(openYears(h),[2028]);
  h.setYear(2029);h.events.get('document:visibilitychange')();assert.deepEqual(openYears(h),[2029]);
  vm.runInContext('ui.tab="ledger"',h.ctx);h.setYear(2030);h.tick();assert.deepEqual(openYears(h),[2029]);
  vm.runInContext('ui.tab="savings"',h.ctx);h.render();assert.deepEqual(openYears(h),[2030]);
});

test('저축 연도별: 현재 연도가 계획 범위 밖이어도 기록·계산 범위를 늘리지 않는다',()=>{
  const data=fixture();data.savings.scenarios.forEach(sc=>sc.endAge=32);
  const h=setup(data,2030),before=h.storage.get(key);
  assert.deepEqual(openYears(h),[]);
  assert.deepEqual(h.state().map(x=>x[0]),[2025,2026]);
  assert.equal(h.storage.get(key),before);assert.equal(h.saves(),0);
});

test('저축·할부의 음수 가능 칸은 \'-\'·\'.\' 키가 있는 키패드(numeric)와 숫자 pattern을 쓴다',()=>{
  // 삼성 키보드는 inputmode=decimal·type=number 키패드에 '-' 키가 없다. 가상 값.
  const data=fixture();data.savings.scenarios[0].stages=[{age:40,growth:-1,returnRate:-2.5}];
  const h=setup(data),html=h.html(),signed=/type="text" inputmode="numeric" autocomplete="off" pattern="([^"]+)"/;
  for(const k of ['growth','returnRate'])assert.match(html,new RegExp(`data-param="${k}" ${signed.source}`),k);
  assert.match(html,new RegExp(`data-stage="0" data-k="growth" ${signed.source} value="-1"`),'단계 증가율');
  assert.match(html,new RegExp(`data-stage="0" data-k="returnRate" ${signed.source} value="-2.5"`),'단계 수익률');
  assert.match(html,/data-param="giving" type="number" step="any" inputmode="decimal"/,'음수 없는 비율은 그대로');
  const pattern=new RegExp(`^(?:${html.match(signed)[1]})$`,'v');
  for(const v of ['-1.5','3','.5','-0.25','10.'])assert.ok(pattern.test(v),v);
  for(const v of ['-','1.2.3','abc','1,000','+1'])assert.ok(!pattern.test(v),v);
  vm.runInContext('renderInstallments()',h.ctx);const inst=h.node('installmentsView').innerHTML;
  assert.match(inst,/data-installment="netAssets" type="text" inputmode="numeric" autocomplete="off" data-money/,'기준 순자산');
  assert.match(inst,new RegExp(`data-installment="returnRate" ${signed.source}`),'예상 수익률');
  assert.match(inst,/data-installment="discountRate"[^>]*type="number" inputmode="decimal" min="0" max="100"/,'할인율은 그대로');
});
