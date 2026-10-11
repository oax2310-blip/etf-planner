// 가상 저축 기록으로 화면 상태만 검증한다. 실제 자산·보유 기록은 사용하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),key='etf-planner-assets-v1';
const source=['js/ma-ladder.js','js/assets-calc.js','js/assets.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n;\n');
const fixture=()=>({version:1,savings:{savedAt:'2026-01-01',startYear:2025,startAge:31,actual:[{ym:'2025-12',total:1000,note:'기존 필드'}],scenarios:[{id:'base',name:'기본',salary:100,giving:10,spending:50,spendingYear:2025,growth:2,returnRate:5,endAge:60,stages:[]},{id:'other',name:'비교',salary:100,giving:10,spending:50,spendingYear:2025,growth:2,returnRate:3,endAge:60,stages:[]}]}});
function setup(data=fixture(),year=2026,shared){
  let now=new Date(year,9,11).getTime(),buttons=[],scenarios=[],saves=0;
  const nodes=new Map(),events=new Map(),intervals=[],storage=shared||new Map([[key,JSON.stringify(data)]]);
  class SystemDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='';const attrs=new Map();
    const n={dataset:{},hidden:false,classList:{toggle(){}},getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,String(v))};
    Object.defineProperty(n,'innerHTML',{get:()=>html,set:value=>{
      html=value;if(id!=='savingsView')return;
      buttons=[...html.matchAll(/<button class="savings-year-toggle"([^>]*)>/g)].map(m=>{
        const a=Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));
        const b=node(`year-button-${a['data-savings-year']}`);b.dataset.savingsYear=a['data-savings-year'];
        for(const [k,v]of Object.entries(a))b.setAttribute(k,v);
        node(a['aria-controls']).hidden=a['aria-expanded']==='false';return b;
      });
      scenarios=[...html.matchAll(/data-scenario="([^"]*)"/g)].map(m=>{const b=node(`scenario-${m[1]}`);b.dataset.scenario=m[1];return b;});
    }});
    nodes.set(id,n);return n;
  }
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:node,querySelectorAll:sel=>sel==='[data-savings-year]'?buttons:sel==='[data-scenario]'?scenarios:[],addEventListener:(name,fn)=>events.set(`document:${name}`,fn)};
  const store={doc:data,prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe(){},start(){},saveSection(){saves++;},
    saveSavingsMilestone(record){data.savings.milestoneRecord={ym:record.ym,age:record.age};storage.set(key,JSON.stringify(data));saves++;return true;}};
  const ctx=vm.createContext({Date:SystemDate,document,assetStore:store,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    addEventListener:(name,fn)=>events.set(`window:${name}`,fn),setInterval:(fn,ms)=>intervals.push({fn,ms}),setTimeout:fn=>{fn();return 1;},
    location:{hash:'#savings'},history:{replaceState(){}},scrollTo(){}});
  vm.runInContext(source,ctx);
  return {ctx,document,storage,events,node,html:()=>node('savingsView').innerHTML,saves:()=>saves,
    setYear:y=>now=new Date(y,0,1).getTime(),render:()=>ctx.renderSavings(),tick:()=>intervals.find(i=>i.ms===60000).fn(),
    click:y=>buttons.find(b=>Number(b.dataset.savingsYear)===y).onclick(),
    state:()=>buttons.map(b=>[Number(b.dataset.savingsYear),b.getAttribute('aria-expanded')==='true',!node(b.getAttribute('aria-controls')).hidden])};
}
const openYears=h=>h.state().filter(x=>x[1]).map(x=>x[0]);
const milestoneFixture=()=>{
  const data=fixture();data.savings.actual=[{ym:'2030-12',total:499000000}];
  data.savings.scenarios.forEach((sc,i)=>Object.assign(sc,{salary:i?500000:1000000,giving:0,spending:0,growth:0,returnRate:0}));
  data.savings.milestoneRecord={ym:'2032-01',age:38};return data;
};

test('저축 요약: 현재 5억 달성 월·연도 나이와 과거 최단 기록을 구분하고 시나리오 전환은 기록을 저장하지 않는다',()=>{
  const data=milestoneFixture(),before=JSON.stringify(data),h=setup(data),stored=h.storage.get(key);
  assert.doesNotMatch(h.html(),/40세 말 \(예상\)/);
  assert.match(h.html(),/5억 달성 예상<\/label><strong[^>]*>2031년 1월 \(37세\)<\/strong>/);
  assert.match(h.html(),/과거 최단 기록<\/span><b>2032년 1월 \(38세\)<\/b>/);assert.match(h.html(),/id="saveSavingsMilestone"/);
  assert.equal((h.html().match(/class="metric(?: |")/g)||[]).length,3,'기존 세 요약 칸 안에서 표시한다');
  h.node('scenario-other').onclick();assert.match(h.html(),/2031년 2월 \(37세\)/);assert.match(h.html(),/과거 최단 기록<\/span><b>2032년 1월 \(38세\)<\/b>/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('저축 요약: 저장 버튼은 현재 예상 월을 저장하며 늦어짐·미달성·나이 기준 변경에도 과거 기록은 유지한다',()=>{
  const data=milestoneFixture(),h=setup(data);
  h.node('saveSavingsMilestone').onclick();assert.deepEqual(data.savings.milestoneRecord,{ym:'2031-01',age:37});assert.equal(h.saves(),1);
  assert.doesNotMatch(h.html(),/id="saveSavingsMilestone"/);
  h.node('scenario-other').onclick();assert.match(h.html(),/5억 달성 예상<\/label><strong[^>]*>2031년 2월 \(37세\)<\/strong>/);
  data.savings.scenarios[1].salary=0;data.savings.startAge=32;h.render();
  assert.match(h.html(),/예측 기간 내 미달성/);assert.match(h.html(),/과거 최단 기록<\/span><b>2031년 1월 \(37세\)<\/b>/);
  assert.doesNotMatch(h.html(),/id="saveSavingsMilestone"/);assert.equal(h.saves(),1);
  const reloaded=setup(JSON.parse(h.storage.get(key)));assert.match(reloaded.html(),/과거 최단 기록<\/span><b>2031년 1월 \(37세\)<\/b>/);
});

test('저축 요약: 실제 기록 없음·이미 달성·나이 정보 없는 옛 기록을 구분하고 조회로 초기 기록을 만들지 않는다',()=>{
  const data=milestoneFixture();delete data.savings.milestoneRecord;data.savings.actual=[];
  const h=setup(data),before=JSON.stringify(data);assert.match(h.html(),/계산할 실제 기록 없음/);assert.match(h.html(),/저장된 기록 없음/);
  assert.equal(JSON.stringify(data),before);assert.equal(h.saves(),0);
  data.savings.actual=[{ym:'2030-12',total:500000000}];h.render();assert.match(h.html(),/2030년 12월 \(36세\)/);assert.match(h.html(),/실제 월말 기록 · 이미 달성/);
  data.savings.milestoneRecord={ym:'2030-11'};h.render();assert.match(h.html(),/과거 최단 기록<\/span><b>2030년 11월<\/b>/,'기록에 나이가 없으면 추정해서 붙이지 않는다');
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
    const years=h.html().slice(h.html().indexOf('<section class="card savings-years">'));
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
  h.node('scenario-other').onclick();
  assert.match(row(2026),/class="savings-year-return"[^]*?<b>10원<\/b>/);assert.match(row(2026),/<span>투자수익 기부<\/span><b>1원<\/b>/);
  assert.equal(JSON.stringify(data),original);assert.equal(h.storage.get(key),stored);assert.equal(h.saves(),0);
});

test('저축 연도별: 시스템 현재 연도만 기본 펼침이고 화면 문구 없이 접근성 상태를 제공한다',()=>{
  const h=setup(),before=h.storage.get(key);
  assert.deepEqual(openYears(h),[2026]);
  assert.ok(h.state().every(([,open,visible])=>open===visible));
  assert.match(h.html(),/class="savings-year savings-year-current"/);
  assert.match(h.html(),/2026년<\/b><small class="savings-year-age">32세<\/small>/);
  const years=h.html().slice(h.html().indexOf('<section class="card savings-years">'));
  assert.doesNotMatch(years,/펼치기|접기|data-savings-fold-action|올해|savings-current-label|실제 마지막 기록 \/ 예상 12월/);
  assert.match(years,/aria-label="2026년 월별 저축 기록"/);
  assert.equal(h.storage.get(key),before);assert.equal(h.saves(),0);
});

test('저축 연도별: 수동 상태는 다시 그리기·시나리오 전환 때 유지하고 새로고침 때 초기화한다',()=>{
  const h=setup(),before=h.storage.get(key),storedUi=h.storage.get('etf-planner-assets-ui');
  h.click(2025);h.click(2026);h.click(2027);h.render();h.tick();
  assert.deepEqual(openYears(h),[2025,2027]);
  assert.equal(h.storage.get('etf-planner-assets-ui'),storedUi,'펼침 상태는 브라우저 저장소에 쓰지 않는다');
  h.node('scenario-other').onclick();
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
