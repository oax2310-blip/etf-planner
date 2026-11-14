// 실제 네트워크·개인 기록 없이 월말 비교 자료의 재시도·표시를 검증한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const scripts=['js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/ledger-benchmark.js','js/money-input.js','js/assets.js']
  .map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n;\n');
const ledgerScript=fs.readFileSync(path.join(root,'js/assets-ledger.js'),'utf8');
const SP='data/sp500-tr.json', GOLD='data/gold-etf.json';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const rawFor=url=>({schemaVersion:1,symbol:url===SP?'^SP500TR':'GLDM',currency:'USD',
  yearEnd:[{year:2025,date:'2025-12-31',close:url===SP?100:85.37}],
  monthEnd:[{ym:'2026-10',date:'2026-10-30',close:url===SP?121:85.37*1.17}]});
const responseFor=url=>({ok:true,json:async()=>rawFor(url)});

function page(options={}){
  let now=new Date(2026,10,2).getTime();
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const requests=[],listeners=new Map(),registrations=new Map(),nodes=new Map(),storage=new Map();
  const data={version:1,ledger:{savedAt:'',years:[{year:2026,accounts:[],months:[{m:10,pnl:10,total:1000}]}]}};
  const before=JSON.stringify(data);
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{dataset:{},clientWidth:361,innerHTML:'',classList:{toggle(){}},querySelector:()=>null});
    return nodes.get(id);
  };
  const document={hidden:false,activeElement:null,getElementById:node,querySelector:node,querySelectorAll:()=>[],
    addEventListener(type,fn){
      registrations.set(type,(registrations.get(type)||0)+1);
      if(!listeners.has(type))listeners.set(type,[]);
      listeners.get(type).push(fn);
    }};
  storage.set('etf-planner-assets-ui',JSON.stringify({tab:'ledger',ledgerBench:'both'}));
  const storedUi=storage.get('etf-planner-assets-ui');
  const context={Date:Clock,document,addEventListener(){},setTimeout,clearTimeout,
    assetStore:{doc:data,prices:null,saveSection(){assert.fail('자료 조회로 기록을 저장하면 안 된다');}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},
    fetch(url,requestOptions){
      const request={url,options:requestOptions};requests.push(request);
      if(options.fetch)return options.fetch(url,requestOptions);
      return new Promise((resolve,reject)=>Object.assign(request,{resolve,reject}));
    }};
  if(Object.hasOwn(options,'AbortSignal'))context.AbortSignal=options.AbortSignal;
  const ctx=vm.createContext(context);
  vm.runInContext(scripts,ctx);
  // 공통 자산 화면의 기존 리스너와 구분해 월별 손익 파일의 등록 횟수만 센다.
  registrations.clear();
  vm.runInContext(ledgerScript,ctx);
  const run=code=>vm.runInContext(code,ctx);
  return {requests,registrations,document,run,
    get html(){return node('ledgerView').innerHTML;},
    render(){run('renderLedger()');},
    advance(ms){now+=ms;},
    count(url){return requests.filter(request=>request.url===url).length;},
    latest(url){return requests.filter(request=>request.url===url).at(-1);},
    succeed(url){this.latest(url).resolve(responseFor(url));},
    fail(url){this.latest(url).reject(Error('가상 네트워크 오류 <외부 문자열>'));},
    visibility(hidden=false){document.hidden=hidden;for(const listener of listeners.get('visibilitychange')||[])listener();},
    unchanged(){assert.equal(JSON.stringify(data),before,'저장 기록을 바꾸지 않는다');assert.equal(storage.get('etf-planner-assets-ui'),storedUi,'화면 설정을 바꾸지 않는다');}
  };
}

function assertHints(p,names){
  const hints=[...p.html.matchAll(/<p class="hint"[^>]*>([^<]*월말 자료 실패[^<]*)<\/p>/g)]
    .map(match=>match[1].replace(/&amp;/g,'&'));
  const expected=names?`${names} 월말 자료 실패 · 공표치 비교 · 재시도 예정`:null;
  assert.deepEqual(hints,expected?[expected,expected]:[],'맨 위 카드 근처와 지수 비교에 안내를 하나씩만 표시한다');
  const benchmark=p.html.slice(p.html.indexOf('<div class="benchmark">'));
  assert.equal((benchmark.match(/월말 자료 실패/g)||[]).length,names?1:0,'지수 비교 영역의 안내는 한 줄이다');
  assert.doesNotMatch(p.html,/가상 네트워크 오류|외부 문자열/,'응답·오류 내용은 안내에 넣지 않는다');
}

test('실패는 마지막 요청 뒤 60초 전에는 유지하고 경계에서 재시도하며 성공 뒤에는 다시 받지 않는다',async()=>{
  const p=page();p.render();await flush();
  p.advance(10000);p.fail(SP);p.succeed(GOLD);await flush();assertHints(p,'S&P 500');
  p.advance(49999);p.render();await flush();assert.equal(p.count(SP),1);
  p.advance(1);p.render();await flush();assert.equal(p.count(SP),2,'실패 시점이 아닌 마지막 시도 시점부터 60초');
  p.succeed(SP);await flush();assertHints(p,null);
  p.advance(120000);p.render();p.visibility();await flush();
  assert.equal(p.count(SP),2);assert.equal(p.count(GOLD),1);p.unchanged();
});

test('처음 받는 중에는 렌더·복귀 이벤트와 60초 경과로도 요청을 추가하지 않는다',async()=>{
  const p=page();p.render();await flush();assertHints(p,null);
  p.advance(120000);
  for(let i=0;i<6;i++){p.render();p.visibility();}
  await flush();assert.equal(p.count(SP),1);assert.equal(p.count(GOLD),1);assertHints(p,null);
  p.succeed(SP);p.succeed(GOLD);await flush();assertHints(p,null);p.unchanged();
});

test('60초 뒤 재시도도 끝나기 전에는 반복 렌더·복귀·추가 시간 경과로 중복 요청하지 않는다',async()=>{
  const p=page();p.render();await flush();p.fail(SP);p.fail(GOLD);await flush();
  p.advance(60000);p.render();await flush();
  assert.equal(p.count(SP),2);assert.equal(p.count(GOLD),2);
  assertHints(p,'S&P 500·금');
  p.advance(120000);
  for(let i=0;i<6;i++){p.render();p.visibility();}
  await flush();assert.equal(p.count(SP),2);assert.equal(p.count(GOLD),2);
  p.succeed(SP);p.succeed(GOLD);await flush();assertHints(p,null);
});

for(const failed of [SP,GOLD])test(`${failed===SP?'S&P 500':'GLDM'}만 실패해도 다른 지수는 정상 표시·캐시하고 복귀 시 실패한 지수만 재시도한다`,async()=>{
  const healthy=failed===SP?GOLD:SP,p=page();p.render();await flush();
  p.fail(failed);p.succeed(healthy);await flush();
  assertHints(p,failed===SP?'S&P 500':'금(GLDM)');
  assert.match(p.html,healthy===SP?/<i class="sp"><\/i>S&amp;P 500<b>21\.00%<\/b>/:/<i class="gold"><\/i>금<b>17\.00%<\/b>/,'다른 지수의 월말 수익률을 표시한다');
  p.visibility(true);await flush();assert.equal(p.count(failed),1,'숨겨지는 이벤트에는 요청하지 않는다');
  p.advance(1);p.visibility();await flush();
  assert.equal(p.count(failed),2,'복귀하면 60초 전이어도 실패한 자료는 바로 재시도한다');
  assert.equal(p.count(healthy),1);
  for(let i=0;i<6;i++){p.render();p.visibility();}
  await flush();assert.equal(p.count(failed),2);assert.equal(p.count(healthy),1);
  p.succeed(failed);await flush();assertHints(p,null);p.unchanged();
});

test('두 자료 실패 안내에서 복구한 이름만 빠지고 모두 복구되면 안내 요소가 없어진다',async()=>{
  const p=page();p.render();await flush();assertHints(p,null);
  p.fail(SP);p.fail(GOLD);await flush();assertHints(p,'S&P 500·금');
  p.visibility();await flush();p.succeed(SP);await flush();assertHints(p,'금(GLDM)');
  p.succeed(GOLD);await flush();assertHints(p,null);
  assert.doesNotMatch(p.html,/<p class="hint"/,'실패가 없으면 빈 안내도 남기지 않는다');p.unchanged();
});

test('S&P 500 실패 안내와 GLDM 성공 반영은 각각 한 번만 다시 그린다',async()=>{
  const p=page();
  p.run('globalThis.ledgerTestRedraws=[];const ledgerTestRedraw=redrawIdle;redrawIdle=()=>{ledgerTestRedraw();ledgerTestRedraws.push(document.getElementById("ledgerView").innerHTML);};');
  p.render();await flush();assert.equal(p.run('ledgerTestRedraws.length'),0);
  p.fail(SP);await flush();
  assert.equal(p.run('ledgerTestRedraws.length'),1,'S&P 500 실패 안내에 한 번 갱신한다');
  assertHints(p,'S&P 500');assert.match(p.html,/<i class="gold"><\/i>금<b>반영 전<\/b>/);
  p.succeed(GOLD);await flush();
  assert.equal(p.run('ledgerTestRedraws.length'),2,'GLDM 성공 반영에 한 번 더 갱신한다');
  assertHints(p,'S&P 500');assert.match(p.html,/<i class="gold"><\/i>금<b>17\.00%<\/b>/);
  p.render();await flush();assert.equal(p.run('ledgerTestRedraws.length'),2,'같은 완료 상태로 중복 갱신하지 않는다');
  p.unchanged();
});

test('visibilitychange 리스너는 렌더와 요청·재시도 동안 한 번만 등록한다',async()=>{
  const p=page();p.render();await flush();
  for(let i=0;i<4;i++){p.render();p.visibility();}
  p.fail(SP);p.fail(GOLD);await flush();p.advance(60000);p.render();await flush();
  for(let i=0;i<4;i++){p.render();p.visibility();}
  p.succeed(SP);p.succeed(GOLD);await flush();
  assert.equal(p.registrations.get('visibilitychange'),1);assert.equal(p.count(SP),2);assert.equal(p.count(GOLD),2);
});

const failureModes={
  '응답 오류':url=>Promise.resolve({ok:false,json:async()=>rawFor(url)}),
  'JSON 오류':()=>Promise.resolve({ok:true,json:async()=>{throw SyntaxError('가상 JSON 오류');}}),
  '정제 결과 null':()=>Promise.resolve({ok:true,json:async()=>({schemaVersion:1,symbol:'잘못된 지수',currency:'USD'})}),
  '시간 초과':()=>Promise.reject(Object.assign(Error('가상 시간 초과'),{name:'TimeoutError'})),
  '네트워크 오류':()=>Promise.reject(Error('가상 네트워크 오류')),
  '동기 네트워크 오류':()=>{throw Error('가상 동기 네트워크 오류');}
};
for(const [name,failure] of Object.entries(failureModes))test(`${name}는 두 자료 모두 실패 안내·60초 재시도 대상으로 처리한다`,async()=>{
  let recover=false;
  const p=page({fetch:url=>recover?Promise.resolve(responseFor(url)):failure(url)});
  assert.doesNotThrow(()=>p.render());await flush();assertHints(p,'S&P 500·금');
  p.advance(59999);p.render();await flush();assert.equal(p.count(SP),1);assert.equal(p.count(GOLD),1);
  recover=true;p.advance(1);p.render();await flush();
  assert.equal(p.count(SP),2);assert.equal(p.count(GOLD),2);assertHints(p,null);p.unchanged();
});

test('AbortSignal.timeout이 있으면 두 자료 요청 모두 15초 signal을 전달한다',async()=>{
  const signals=[],durations=[],p=page({AbortSignal:{timeout(ms){const signal={};durations.push(ms);signals.push(signal);return signal;}}});
  assert.doesNotThrow(()=>p.render());await flush();
  assert.deepEqual(durations,[15000,15000]);
  p.requests.forEach((request,index)=>{assert.equal(request.options.signal,signals[index]);assert.equal(request.options.cache,'no-cache');});
  p.fail(SP);p.succeed(GOLD);await flush();p.advance(60000);p.render();await flush();
  assert.deepEqual(durations,[15000,15000,15000],'재시도는 새 제한 시간을 쓴다');
  assert.equal(p.latest(SP).options.signal,signals[2]);p.succeed(SP);await flush();
});

for(const absent of ['AbortSignal 없음','timeout 없음','timeout이 함수 아님'])test(`${absent} 환경은 예외 없이 signal을 생략한다`,async()=>{
  const options=absent==='AbortSignal 없음'?{}:{AbortSignal:absent==='timeout 없음'?{}:{timeout:true}};
  const p=page(options);assert.doesNotThrow(()=>p.render());await flush();
  assert.equal(p.requests.length,2);
  for(const request of p.requests){assert.equal(Object.hasOwn(request.options,'signal'),false);assert.equal(request.options.cache,'no-cache');}
  p.fail(SP);p.fail(GOLD);await flush();p.visibility();await flush();
  assert.equal(p.count(SP),2);assert.equal(p.count(GOLD),2);
  for(const request of p.requests)assert.equal(Object.hasOwn(request.options,'signal'),false);
  p.succeed(SP);p.succeed(GOLD);await flush();assertHints(p,null);p.unchanged();
});

test('종료된 해의 연말 경고는 12월 활성 계좌 누락을 잡고 0원·대출·올해·옛 총액 기록을 구분한다',()=>{
  const p=page(),check=y=>p.run(`ledgerYearEndWarning(${JSON.stringify(y)},new Date(2026,0,1))`),base={year:2025,accounts:[{name:'가상 계좌'},{name:'제외 계좌',loan:true},{name:'가상 계좌 2'}],months:[]};
  assert.match(check(base),/12월 기록/);base.months=[{m:12,balances:[100,null,null]}];assert.match(check(base),/잔액 1개/);
  base.months[0].balances=[100,null,0];assert.equal(check(base),'','0원도 완료, 원래 배열 인덱스의 대출은 제외');
  assert.equal(check({...base,year:2026,months:[]}), '');assert.equal(check({...base,year:2027,months:[]}), '');
  assert.match(check({year:2025,accounts:[],months:[{m:12,pnl:0}]}),/총자산이 미입력/);
  assert.equal(check({year:2025,accounts:[],months:[{m:12,total:0}]}),'');
  p.unchanged();
});

test('연도별 요약 총자산은 월 부제를 없애고 종료된 해의 미완료만 한 줄 아이콘으로 경고한다',()=>{
  const p=page();p.run('doc.ledger.years=[{year:2024,accounts:[],months:[{m:12,total:1000,pnl:0}]},{year:2025,accounts:[],months:[{m:10,total:2000,pnl:0}]},{year:2026,accounts:[],months:[{m:10,total:3000,pnl:0}]}]');
  const before=p.run('JSON.stringify(doc)');p.render();
  const rows=p.html.slice(p.html.indexOf('<section class="card ledger-table years">'),p.html.indexOf('<div class="benchmark">'));
  assert.doesNotMatch(rows,/<small>(?:10|12)월<\/small>/);assert.equal((rows.match(/class="ledger-year-warning"/g)||[]).length,1);
  assert.match(rows,/aria-label="12월 기록이 없어 연말 총자산이 미완료입니다\."/);assert.match(rows,/2,000원/);
  assert.equal(p.run('JSON.stringify(doc)'),before,'표시만 바꾸고 기존 연 요약 계산과 저장을 유지');
});
