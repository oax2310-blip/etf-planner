// 실제 HTML 기본값과 시나리오 계산을 실행해 단위·구성합·할인·입력 경계를 검증한다. 저장소·네트워크는 사용하지 않는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = require('node:path').join(__dirname, '..') + require('node:path').sep;
const source = fs.readFileSync(root + 'js/valuation.js', 'utf8').split('// AI 구독사업 계산:')[0];
const html = fs.readFileSync(root + 'valuation.html', 'utf8');
function page() {
  const nodes = new Map();
  const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
  const node = (id, attr = {}) => {
    if (nodes.has(id)) return nodes.get(id);
    let value = attr.value || '', inner = '';
    const n = { textContent: '', style: {}, dataset: {}, classList: { remove(){}, toggle(){} }, addEventListener(){},
      get value(){return value;}, set value(x){value=String(x);},
      get innerHTML(){return inner;}, set innerHTML(x){inner=x; parseInputs(x); for(const m of x.matchAll(/\bid="([^"]*)"/g))node(m[1]);},
      getAttribute(k){return attr[k];},
      checkValidity(){const v=Number(value); return Number.isFinite(v) && (attr.min===undefined||v>=+attr.min) && (attr.max===undefined||v<=+attr.max);}, attr };
    nodes.set(id,n); return n;
  };
  function parseInputs(s){for(const tag of s.match(/<input\b[^>]*>/g)||[]){const a=attrs(tag);if(a.id)node(a.id,a);}}
  parseInputs(html);
  for(const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){
    const a=attrs(m[1]), opts=[...m[2].matchAll(/<option\b([^>]*)>/g)];
    a.value=opts.length?attrs((opts.find(x=>/\bselected\b/.test(x[1]))||opts[0])[1]).value:''; node(a.id,a);
  }
  for(const m of html.matchAll(/\bid="([^"]*)"/g))node(m[1]);
  const ctx=vm.createContext({document:{getElementById:id=>{assert.ok(nodes.has(id),id);return nodes.get(id);},querySelectorAll:()=>[]}});
  vm.runInContext(source,ctx);
  const set=(id,x)=>{nodes.get(id).value=x;};
  const run=code=>vm.runInContext(code,ctx);
  const read=id=>nodes.get(id).textContent;
  const number=id=>{const value=read(id).replace(/[^\d.-]/g,''); assert.ok(value, `${id}: 계산값이 있어야 한다`); return Number(value);};
  return {nodes,set,run,read,number};
}
const near=(a,b,delta=.011)=>assert.ok(Math.abs(a-b)<=delta,`${a} != ${b}`);
test('SDI default physical units, revenue and discounted per-share identity',()=>{
  const h=page();
  assert.equal(h.read('evMarket'),'2,200 GWh'); assert.equal(h.read('robotMarket'),'200 GWh');
  assert.equal(h.read('evFigures'),'13.2조 / 1.06조'); assert.equal(h.read('robotFigures'),'6조 / 0.72조');
  const future=((13.2*.08+6*.12+.8)*.7+.8)*1e12*16/82203426;
  near(h.number('futurePrice'),future/10000,.051); near(h.number('pvPrice'),future/1.1**9/10000,.051);
  h.set('discount',0);h.set('robotM',0);h.run('render()');
  assert.equal(h.read('futurePrice'),h.read('pvPrice')); assert.match(h.read('robotDelta'),/약 0만 원/);
});
test('HUMN unchanged underlying values conserve basket before fees',()=>{
  const h=page();h.set('humnPortfolioShare',0);h.set('humnExisting',100);h.set('humnDilution',0);h.set('humnRestMultiple',1);h.run('renderHumn()');
  const future=29.67*.9925**14;
  near(h.number('humnFuture'),future);near(h.number('humnPV'),future/1.1**14);
  near(h.run('makerWeight+otherWeight+humnNetCash'),1,1e-14);
});
test('Teradyne test and robot earnings add and dilution divides per-share value',()=>{
  const h=page();h.set('terDilution',0);h.run('renderHumn()');
  const before=h.number('terFuture');near(before,h.number('terRobotPerShare')+h.number('terTestPerShare'),.02);
  h.set('terDilution',100);h.run('renderHumn()');near(h.number('terFuture'),before/2);
});
test('Battery zero discount has identical future and present price; robot-free demand gives zero robot contribution',()=>{
  const h=page();h.set('batRequired',0);h.set('batRobotM',0);h.run('renderBatteryEtfs()');
  for(const fund of ['rise','china']){
    assert.equal(h.read(fund+'Future'),h.read(fund+'PV'));
    assert.match(h.nodes.get(fund+'Breakdown').innerHTML,/계산상 기여<\/td><td>0원/);
  }
});
test('Battery residual weights, group baseline and fee factors conserve the non-cell basket',()=>{
  const h=page();h.run('for(const c of batteryCompanies) for(const k of ["ev","robot","ess","other"]) el("bc-"+c.id+"-"+k).value=0; for(const g of batteryRestGroups) el("bg-"+g.id+"-margin").value=0; renderBatteryEtfs();');
  for(const [fund,cell,fee,base] of [['rise',.2815,.0007,'riseBasePrice'],['china',.3937,.0025,'chinaBasePrice']]){
    const expected=+h.nodes.get(base).value*(1-cell)*(1-fee)**9;
    near(h.number(fund+'Future'),expected,.51);
  }
});
test('Calculation inputs individually at HTML min/max remain finite; impossible ETF total weights are rejected',()=>{
  const seed=page();let checks=0;
  const ids=seed.run('[...ids,...humnControlIds,...terControlIds,...batteryInputs,...companyInputIds,...groupInputIds]');
  for(const id of ids){for(const bound of ['min','max']){
    const value=seed.nodes.get(id).attr[bound];if(value===undefined)continue;
    const h=page();h.set(id,value);h.run('render();renderHumn();renderBatteryEtfs()');
    for(const result of ['futurePrice','pvPrice','humnFuture','humnPV','terFuture','terPV','riseFuture','risePV','chinaFuture','chinaPV'])assert.ok(Number.isFinite(h.number(result)),`${id} ${bound} ${result}`);
    checks++;
  }}
  assert.ok(checks>100);
  const h=page(),before=h.read('riseFuture');h.set('bc-lg-weight',100);h.run('renderBatteryEtfs()');
  assert.match(h.read('batteryWeightsWarning'),/100%/);assert.equal(h.read('riseFuture'),before);
});
