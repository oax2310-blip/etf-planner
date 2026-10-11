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
  const store={doc:data,prices:null,status:{state:'off'},config:()=>null,recovery:()=>[],subscribe(){},start(){},saveSection(){saves++;}};
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

test('저축 연도별: 시스템 현재 연도만 기본 펼침이고 화면 문구 없이 접근성 상태를 제공한다',()=>{
  const h=setup(),before=h.storage.get(key);
  assert.deepEqual(openYears(h),[2026]);
  assert.ok(h.state().every(([,open,visible])=>open===visible));
  assert.match(h.html(),/class="savings-year savings-year-current"/);
  assert.match(h.html(),/2026년<\/b><small class="savings-year-age">32세<\/small><small class="savings-current-label">올해<\/small>/);
  const years=h.html().slice(h.html().indexOf('<section class="card savings-years">'));
  assert.doesNotMatch(years,/펼치기|접기|data-savings-fold-action|실제 마지막 기록 \/ 예상 12월/);
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
  assert.match(h.html(),/2027년<\/b><small class="savings-year-age">33세<\/small><small class="savings-current-label">올해<\/small>/);
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
