// 가상 저축 기록으로 화면 상태만 검증한다. 실제 자산·보유 기록은 사용하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),key='etf-planner-assets-v1';
const source=['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/assets.js','js/assets-ledger.js','js/assets-savings.js','js/assets-installments.js','js/assets-start.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n;\n');
const fixture=()=>({version:1,savings:{savedAt:'2026-01-01',startYear:2025,startAge:31,actual:[{ym:'2025-12',total:1000,note:'기존 필드'}],scenarios:[{id:'base',name:'기본',salary:100,giving:10,spending:50,spendingYear:2025,growth:2,returnRate:5,endAge:60,stages:[]},{id:'other',name:'비교',salary:100,giving:10,spending:50,spendingYear:2025,growth:2,returnRate:3,endAge:60,stages:[]}]}});
function setup(data=fixture(),year=2026,shared){
  let now=new Date(year,9,11).getTime(),buttons=[],inputs=[],elements=[],saves=0;
  const nodes=new Map(),events=new Map(),intervals=[],storage=shared||new Map([[key,JSON.stringify(data)]]);
  class SystemDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const attributes=text=>Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]??'']));
  const matches=(n,sel)=>{
    if(sel.includes(','))return sel.split(',').some(s=>matches(n,s.trim()));
    const scoped=sel.match(/^#savingsView (input|textarea)$/);
    if(scoped)return elements.includes(n)&&n.tagName===scoped[1].toUpperCase();
    const m=sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    return !!m&&n.getAttribute(m[1])!==undefined&&(m[2]===undefined||n.getAttribute(m[1])===m[2]);
  };
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='',focusedValue;const attrs=new Map();
    const n={dataset:{},hidden:false,classList:{toggle(){}},querySelector:sel=>elements.find(x=>matches(x,sel))||node(`${id}:${sel}`),
      getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,String(v)),click:()=>n.onclick?.(),matches:sel=>matches(n,sel),
      focus:()=>{if(document.activeElement!==n){document.activeElement?.blur?.();focusedValue=n.value;document.activeElement=n;}},
      blur:()=>{if(document.activeElement===n){document.activeElement=null;if(n.value!==focusedValue)n.onchange?.();events.get('document:focusout')?.();}}};
    n.readAttributes=a=>{
      attrs.clear();for(const [k,v]of Object.entries(a))attrs.set(k,v);
      n.dataset=Object.fromEntries(Object.entries(a).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));
      n.hidden='hidden' in a;n.open='open' in a;n.value=a.value??'';n.placeholder=a.placeholder;n.title=a.title;n.tabIndex=Number(a.tabindex??0);n.validity={valid:true};
    };
    Object.defineProperty(n,'innerHTML',{get:()=>html,set:value=>{
      html=value;if(id!=='savingsView')return;
      elements=[...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].flatMap((m,i)=>{
        const a=attributes(m[2]);if(!a.id&&!Object.keys(a).some(k=>k.startsWith('data-')))return [];
        const x=node(a.id||`savings-element-${i}`);x.readAttributes(a);x.tagName=m[1].toUpperCase();
        x.textContent=html.slice(m.index+m[0].length).split('<',1)[0];return [x];
      });
      buttons=elements.filter(x=>'savingsYear' in x.dataset);inputs=elements.filter(x=>x.tagName==='INPUT');
      for(const m of html.matchAll(/<select\b([^>]*)>([^]*?)<\/select>/g)){
        const a=attributes(m[1]),options=[...m[2].matchAll(/<option\b([^>]*)>/g)].map(o=>attributes(o[1]));
        if(a.id)node(a.id).value=(options.find(o=>'selected' in o)||options[0])?.value??'';
      }
    }});
    nodes.set(id,n);return n;
  }
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:node,querySelectorAll:sel=>elements.filter(x=>matches(x,sel)),addEventListener:(name,fn)=>events.set(`document:${name}`,fn)};
  const store={doc:data,prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe(){},start(){},saveSection(){saves++;},
    saveSavingsMilestone(record){data.savings.milestoneRecord={ym:record.ym,age:record.age};storage.set(key,JSON.stringify(data));saves++;return true;}};
  const ctx=vm.createContext({Date:SystemDate,document,assetStore:store,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    addEventListener:(name,fn)=>events.set(`window:${name}`,fn),setInterval:(fn,ms)=>intervals.push({fn,ms}),setTimeout:fn=>{fn();return 1;},
    location:{hash:'#savings'},history:{replaceState(){}},scrollTo(){}});
  vm.runInContext(source,ctx);
  return {ctx,document,storage,events,node,inputs:()=>inputs,html:()=>node('savingsView').innerHTML,saves:()=>saves,
    setYear:y=>now=new Date(y,0,1).getTime(),render:()=>ctx.renderSavings(),tick:()=>intervals.find(i=>i.ms===60000).fn(),
    click:y=>buttons.find(b=>Number(b.dataset.savingsYear)===y).onclick(),
    state:()=>buttons.map(b=>[Number(b.dataset.savingsYear),b.getAttribute('aria-expanded')==='true',!node(b.getAttribute('aria-controls')).hidden])};
}
const openYears=h=>h.state().filter(x=>x[1]).map(x=>x[0]);
const selectScenario=(h,id)=>{const select=h.node('savingsScenarioSelect');select.value=id;select.onchange();};
const savingsYearsHtml=h=>h.html().split('<div class="card savings-years">')[1].split('<div class="card savings-details">')[0];
const stageInput=(h,i,key)=>h.inputs().find(x=>x.dataset.stage===String(i)&&x.dataset.k===key);
const editInput=(x,value)=>{x.value=value;x.onchange();};

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
  h.node('toggleSavingsAssumptions').onclick();h.render();selectScenario(h,'other');selectScenario(h,'base');
  assert.deepEqual(simulation(),result);assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('나이별 적용값은 기존 기본 가정·앞 단계·나이 변경과 값 삭제 흐름을 따라 다시 계산한다',()=>{
  const data=fixture(),sc=data.savings.scenarios[0];sc.stages=[{age:32},{age:34}];
  const h=setup(data),param=k=>h.inputs().find(x=>x.dataset.param===k);
  editInput(param('salary'),'200');editInput(param('spending'),'100');editInput(param('growth'),'10');editInput(param('returnRate'),'4.125');
  assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,1,k).placeholder),['200','133','10','4.125']);
  assert.equal(stageInput(h,1,'spending').title,'적용값: 133.10000000000005원','원 미만 정밀값도 반올림하지 않은 원래 계산값에서 조회한다');
  editInput(stageInput(h,0,'salary'),'0');editInput(stageInput(h,0,'spending'),'50');editInput(stageInput(h,0,'growth'),'20');editInput(stageInput(h,0,'returnRate'),'-2.345');
  assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,1,k).placeholder),['0','72','20','-2.345']);
  editInput(stageInput(h,0,'spending'),'');assert.equal('spending' in sc.stages[0],false);assert.equal(stageInput(h,1,'spending').placeholder,'173');
  editInput(stageInput(h,0,'salary'),'');assert.equal('salary' in sc.stages[0],false);assert.equal(stageInput(h,1,'salary').placeholder,'200');
  editInput(stageInput(h,0,'age'),'35');
  assert.equal(sc.stages[0].age,34);assert.deepEqual(['salary','spending','growth','returnRate'].map(k=>stageInput(h,0,k).placeholder),['200','133','10','4.125']);
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

test('저축 요약: 현재 5억 달성 월·연도 나이와 과거 최단 기록을 구분하고 시나리오 전환은 기록을 저장하지 않는다',()=>{
  const data=milestoneFixture(),before=JSON.stringify(data),h=setup(data),stored=h.storage.get(key);
  assert.doesNotMatch(h.html(),/40세 말 \(예상\)/);
  assert.match(h.html(),/class="savings-goal-date"[^>]*>2031\.01 <span class="savings-milestone-age">· 37세<\/span><\/span>/);
  assert.match(h.html(),/과거 최단 기록<\/span><div><b>2032\.01 <span class="savings-milestone-age">· 38세<\/span><\/b>/);assert.match(h.html(),/id="saveSavingsMilestone"/);
  assert.equal((h.html().match(/class="card savings-summary"/g)||[]).length,1);
  assert.equal((h.html().match(/class="savings-goal"/g)||[]).length,1);assert.doesNotMatch(h.html(),/class="metric(?: |")/);
  assert.equal(h.node('savingsScenarioSelect').value,'base');
  selectScenario(h,'other');assert.equal(h.node('savingsScenarioSelect').value,'other');
  assert.match(h.html(),/class="savings-goal-date"[^>]*>2031\.02 <span class="savings-milestone-age">· 37세<\/span><\/span>/);
  assert.match(h.html(),/과거 최단 기록<\/span><div><b>2032\.01 <span class="savings-milestone-age">· 38세<\/span><\/b>/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('저축 요약: 저장 버튼은 현재 예상 월을 저장하며 늦어짐·미달성·나이 기준 변경에도 과거 기록은 유지한다',()=>{
  const data=milestoneFixture(),h=setup(data);
  h.node('saveSavingsMilestone').onclick();assert.deepEqual(data.savings.milestoneRecord,{ym:'2031-01',age:37});assert.equal(h.saves(),1);
  assert.doesNotMatch(h.html(),/id="saveSavingsMilestone"/);
  selectScenario(h,'other');assert.match(h.html(),/class="savings-goal-date"[^>]*>2031\.02 <span class="savings-milestone-age">· 37세<\/span><\/span>/);
  data.savings.scenarios[1].salary=0;data.savings.startAge=32;h.render();
  assert.match(h.html(),/기간 내 미도달/);assert.match(h.html(),/과거 최단 기록<\/span><div><b>2031\.01 <span class="savings-milestone-age">· 37세<\/span><\/b>/);
  assert.doesNotMatch(h.html(),/id="saveSavingsMilestone"/);assert.equal(h.saves(),1);
  const reloaded=setup(JSON.parse(h.storage.get(key)));assert.match(reloaded.html(),/과거 최단 기록<\/span><div><b>2031\.01 <span class="savings-milestone-age">· 37세<\/span><\/b>/);
});

test('저축 요약: 실제 기록 없음·이미 달성·나이 정보 없는 옛 기록을 구분하고 조회로 초기 기록을 만들지 않는다',()=>{
  const data=milestoneFixture();delete data.savings.milestoneRecord;data.savings.actual=[];
  const h=setup(data),before=JSON.stringify(data);assert.match(h.html(),/class="savings-goal-date"[^>]*>실제 기록 없음<\/span>/);assert.match(h.html(),/저장된 기록 없음/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.saves(),0);
  data.savings.actual=[{ym:'2030-12',total:500000000}];h.render();assert.match(h.html(),/2030\.12 <span class="savings-milestone-age">· 36세<\/span>/);assert.match(h.html(),/실제 월말 기록 · 이미 달성/);
  data.savings.milestoneRecord={ym:'2030-11'};h.render();assert.match(h.html(),/과거 최단 기록<\/span><div><b>2030\.11<\/b>/,'기록에 나이가 없으면 추정해서 붙이지 않는다');
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
  const names=['Overview','Assumptions','Records'];
  const check=active=>{
    for(const name of names){
      const button=h.node(`savingsTab${name}`),pane=h.node(button.getAttribute('aria-controls'));
      assert.equal(button.getAttribute('role'),'tab');assert.equal(button.getAttribute('aria-selected'),String(name===active));
      assert.equal(button.tabIndex,name===active?0:-1);assert.equal(pane.hidden,name!==active);
      assert.match(h.html(),new RegExp(`id="savingsPane${name}"`));
    }
  };
  check('Assumptions');
  const input=h.inputs().find(x=>x.dataset.param==='salary'),actual=h.inputs().find(x=>x.dataset.actual==='2026-01');
  for(const name of names){h.node(`savingsTab${name}`).onclick();check(name);assert.equal(h.inputs().find(x=>x.dataset.param==='salary'),input);assert.equal(h.inputs().find(x=>x.dataset.actual==='2026-01'),actual);}
  let prevented=false;h.node('savingsTabRecords').onkeydown({key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);check('Overview');assert.equal(h.document.activeElement,h.node('savingsTabOverview'));
  h.render();check('Overview');
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
  const reloaded=setup(JSON.parse(before),2026,h.storage);assert.equal(reloaded.node('savingsTabAssumptions').getAttribute('aria-selected'),'true','탭 선택은 새로고침하면 기본 가정 탭으로 돌아간다');
});

test('저축 상세 탭: 입력을 편집하다 첫 터치로 이동하면 변경을 한 번 저장하고 선택한 탭을 연다',()=>{
  const data=fixture(),h=setup(data),storedUi=h.storage.get('etf-planner-assets-ui');
  h.node('toggleSavingsAssumptions').onclick();
  const salary=h.inputs().find(x=>x.dataset.param==='salary'),records=h.node('savingsTabRecords');
  salary.focus();salary.value='450';
  let prevented=false;records.onpointerdown({button:0,preventDefault(){prevented=true;}});
  assert.equal(prevented,true,'pointerdown에서 blur를 미뤄 change 재렌더가 탭 click을 없애지 않게 한다');
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

test('저축 가정 CTA와 접힌 상세: 다른 탭에서 편집을 열 수 있고 펼침 상태는 기록에 저장하지 않는다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=setup(data),stored=[...h.storage];
  const action=()=>h.node('toggleSavingsAssumptions').querySelector('[data-savings-assumptions-action]').textContent;
  assert.equal(h.node('savingsAssumptionsBody').hidden,true);assert.equal(action(),'가정 수정하기');
  h.node('savingsTabRecords').onclick();h.node('toggleSavingsAssumptions').onclick();
  assert.equal(h.node('savingsPaneAssumptions').hidden,false);assert.equal(h.node('savingsPaneRecords').hidden,true);
  assert.equal(h.node('savingsAssumptionsBody').hidden,false);assert.equal(h.node('toggleSavingsAssumptions').getAttribute('aria-expanded'),'true');assert.equal(action(),'가정 접기');
  const detail=h.document.querySelectorAll('[data-savings-detail]').find(x=>x.dataset.savingsDetail==='future');
  assert.ok(detail);assert.equal(detail.open,false);detail.open=true;detail.ontoggle();h.render();
  assert.equal(h.document.querySelectorAll('[data-savings-detail]').find(x=>x.dataset.savingsDetail==='future').open,true);
  assert.equal(h.node('savingsAssumptionsBody').hidden,false);h.node('toggleSavingsAssumptions').onclick();
  assert.equal(h.node('savingsAssumptionsBody').hidden,true);assert.equal(h.node('toggleSavingsAssumptions').getAttribute('aria-expanded'),'false');assert.equal(action(),'가정 수정하기');
  assert.equal(JSON.stringify(data),before);assert.deepEqual([...h.storage],stored);assert.equal(h.saves(),0);
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
  assert.doesNotMatch(years,/펼치기|접기|data-savings-fold-action|올해|savings-current-label|실제 마지막 기록 \/ 예상 12월/);
  assert.match(years,/aria-label="2026년 월별 저축 기록"/);
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
  h.document.activeElement=null;h.events.get('document:focusout')();
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
