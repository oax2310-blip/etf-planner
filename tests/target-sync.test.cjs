const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 자산 배분 목표(단일 기준) → 분할매수·분할매도·재매수 연동. 실제 저장(assets-store.js)·계산(assets-calc.js)·계획 화면 줄(alloc-link.js)을 함께 실행한다.
// 모든 종목·금액은 가상 값이다.
const root=path.join(__dirname,'..'),KEY='etf-planner-assets-v1',REPO='example/private-data',BASE='etf-planner-assets-sync-base:'+REPO;
const code=['js/repo-security.js','js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/price-collection.js','js/assets-store.js','js/alloc-link.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n;\n');
const clone=v=>JSON.parse(JSON.stringify(v));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const contents=doc=>json({sha:'remote-sha',encoding:'base64',content:Buffer.from(JSON.stringify(doc)).toString('base64')});

// 채권 EDV(직접 보유 + 같은 기준 코드의 ISA 추종 ETF)와 다른 분할매수 계획. 총자산 1,000만원, EDV 합계 150만원(15%).
// EDV 분할매수는 첫 회차 5만원 체결·자산 반영 기록이 있고, 총 매수 금액 65만원은 목표 21%의 자동 금액(210 − 150 + 5)이다.
function original(){
  return {version:1,allocation:{savedAt:'2026-01-01T00:00:00.000Z',total:1000,classes:[],cash:[],groups:[
    {id:'bond',name:'채권',items:[
      {id:'edv',name:'가상 EDV',ticker:'EDV',amount:100,target:21,buyPlan:{lines:{names:['25일선','32일선'],startLine:'25일선',end:120,budget:65,target:21},notify:{stages:true},buyPriority:['edv','edv-isa'],
        buys:{'25일선:0':{plannedShares:1,plannedActual:5,shares:1,actual:5,price:50000}}}},
      {id:'edv-isa',name:'가상 EDV 추종(ISA)',ticker:'EDV',tradeTicker:'999999',amount:50}]},
    {id:'stock',name:'주식',items:[{id:'qqq',name:'가상 QQQ',ticker:'QQQ',amount:300,target:30,buyPlan:{lines:{names:['25일선'],budget:40}}}]}],
    trades:{'buy:edv:25일선:0':{label:'가상 EDV 1회',at:'2026-01-02T00:00:00.000Z',qty:1,price:50000,value:5,items:[{id:'edv',amount:5}]}}},
    ledger:{savedAt:'2026-01-01T00:00:00.000Z',years:[]}};
}
function device(storage=new Map(),fetcher){
  const listeners=new Map();
  const ctx={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    TextEncoder,TextDecoder,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
    AbortController,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},setInterval(){},document:{hidden:false,addEventListener(){}},
    addEventListener:(type,fn)=>listeners.set(type,fn),esc:v=>String(v??''),
    fetch:async(url,options)=>{if(!fetcher)throw Error('unexpected network call');return fetcher(url,options);}};
  const api=vm.runInNewContext(`${code}\n;({assetStore,allocLink,purchaseAllocationSummary,purchaseBudget,syncPurchaseTargets})`,ctx);
  if(!fetcher)api.assetStore.start(); // 동기화 기기는 테스트에서 sync()를 직접 기다린다(start의 첫 동기화와 겹치지 않게)
  const find=id=>api.assetStore.doc.allocation.groups.flatMap(g=>g.items).find(it=>it.id===id);
  // 분할매수(EDV 계획)·분할매도·재매수(같은 기준 코드 EDV의 '자산 배분' 줄)가 읽는 목표와 매수 한도.
  const view=()=>{const a=api.assetStore.doc.allocation,it=find('edv'),trade={allocation:a,item:it,prices:api.assetStore.prices};
    return {buyTarget:api.purchaseAllocationSummary(a,api.assetStore.prices,it).target,budget:api.purchaseBudget(it.buyPlan,trade),line:api.allocLink.line('EDV')};};
  return {...api,storage,find,view,event:()=>listeners.get('storage')?.({key:KEY})};
}
function seeded(){const storage=new Map([[KEY,JSON.stringify(original())]]);return storage;}
const untouched=(doc,start=original())=>{
  const edv=doc.allocation.groups[0].items[0].buyPlan,was=start.allocation.groups[0].items[0].buyPlan;
  assert.deepEqual(clone(edv.buys),was.buys,'체결·부분 체결 기록 유지');
  assert.deepEqual([edv.lines.names,edv.lines.startLine,edv.lines.end],[was.lines.names,was.lines.startLine,was.lines.end],'단계·시작선·목표 가격 유지');
  assert.deepEqual([clone(edv.notify),clone(edv.buyPriority)],[was.notify,was.buyPriority],'알림·우선순위 유지');
  assert.deepEqual(clone(doc.allocation.trades),start.allocation.trades,'자산 반영 기록 유지');
  assert.deepEqual(clone(doc.allocation.groups[1].items[0]),start.allocation.groups[1].items[0],'목표가 그대로인 다른 계획은 바꾸지 않음');
};

test('자산 배분 목표 21%→21.5%: 같은 저장에서 분할매수 총 매수 금액을 맞추고 분할매도·재매수 줄도 같은 목표를 읽는다',()=>{
  const storage=seeded(),assets=device(storage),planner=device(storage);
  const start=planner.view();
  assert.equal(start.buyTarget,21);assert.equal(start.budget,65);assert.match(start.line,/<span>현재 15% \/ 목표 21% · 목표까지 60만원<\/span>/,'꼬리표·계좌 개수·금액 없이 분할매수 줄과 같은 글자');
  assert.deepEqual(JSON.parse(storage.get(KEY)),original(),'열기만 해서는 기록을 바꾸지 않음');
  // 바꾸기 전 동작(저장 예산 65만원이 한도)이면 목표를 올려도 한도가 그대로였다.
  const stale=clone(assets.assetStore.doc.allocation);stale.groups[0].items[0].target=21.5;
  assert.equal(assets.purchaseBudget(stale.groups[0].items[0].buyPlan,{allocation:stale,item:stale.groups[0].items[0]}),65);

  assets.find('edv').target=21.5;assets.assetStore.saveSection('allocation');
  const saved=JSON.parse(storage.get(KEY)),plan=saved.allocation.groups[0].items[0].buyPlan;
  assert.equal(saved.allocation.groups[0].items[0].target,21.5);
  assert.equal(plan.lines.budget,70,'목표 21.5% × 1,000만원 − 보유 150만원 + 체결 5만원');
  assert.equal(Object.hasOwn(plan.lines,'target'),false,'계획에 따로 저장된 옛 목표는 지워 중복 저장을 없앤다');
  untouched(saved);

  planner.event();
  const now=planner.view();
  assert.equal(now.buyTarget,21.5);assert.equal(now.budget,70);assert.match(now.line,/현재 15% \/ 목표 21\.5% · 목표까지 65만원/);
  assert.deepEqual(clone(planner.assetStore.doc),saved,'다른 탭은 받은 기록을 다시 계산하지 않고 그대로 쓴다');
});

test('목표 변경은 새로고침·다른 탭 저장·다른 기기 동기화 뒤에도 유지되고 받은 쪽에서 다시 계산하지 않는다',async()=>{
  const storage=seeded(),assets=device(storage);
  assets.find('edv').target=21.5;assets.assetStore.saveSection('allocation');
  const saved=JSON.parse(storage.get(KEY));

  const reloaded=device(storage);assert.deepEqual(clone(reloaded.assetStore.doc),saved,'새로고침');
  assert.equal(reloaded.view().budget,70);
  reloaded.find('qqq').buyPlan.note='가상 메모';reloaded.assetStore.saveSection('allocation');
  const later=JSON.parse(storage.get(KEY));
  assert.equal(later.allocation.groups[0].items[0].buyPlan.lines.budget,70,'목표가 그대로인 저장은 예산을 다시 계산하지 않음');
  assert.equal(later.allocation.groups[1].items[0].buyPlan.lines.budget,40);

  let uploaded=null;
  const remote=(doc)=>async(url,options={})=>{
    if(url.endsWith(`/repos/${REPO}`))return json({private:true});
    if(url.endsWith('/contents/etf-planner-prices.json'))return new Response(null,{status:404});
    if(options.method==='PUT'){uploaded=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString());return json({content:{sha:'new-sha'}});}
    return contents(doc);
  };
  const connect=s=>{s.set('etf-planner-data-repo',REPO);s.set('etf-planner-github-token','fake-test-token');};
  const pcStorage=new Map([[KEY,JSON.stringify(later)],[BASE,JSON.stringify(original())]]);connect(pcStorage);
  const pc=device(pcStorage,remote(original()));await pc.assetStore.sync();
  assert.equal(pc.assetStore.status.state,'done');
  assert.equal(uploaded.allocation.groups[0].items[0].target,21.5);assert.equal(uploaded.allocation.groups[0].items[0].buyPlan.lines.budget,70);
  untouched(uploaded,later);

  const phoneStorage=new Map([[KEY,JSON.stringify(original())],[BASE,JSON.stringify(original())]]);connect(phoneStorage);
  const phone=device(phoneStorage,remote(uploaded));await phone.assetStore.sync();
  assert.equal(phone.assetStore.status.state,'done');
  assert.deepEqual(clone(phone.assetStore.doc.allocation),uploaded.allocation,'다른 기기는 바뀐 목표와 총 매수 금액을 그대로 받는다');
  const view=phone.view();assert.equal(view.buyTarget,21.5);assert.equal(view.budget,70);assert.match(view.line,/목표 21\.5%/);
  assert.deepEqual(JSON.parse(phoneStorage.get(KEY)).allocation,uploaded.allocation,'받은 기기의 새로고침 기록');
});

test('목표를 다시 바꾸거나 지우면 미체결 회차 금액만 따라가고 지운 목표는 저장 예산을 남긴다',()=>{
  const storage=seeded(),assets=device(storage);
  assets.find('edv').target=16;assets.assetStore.saveSection('allocation');
  let plan=JSON.parse(storage.get(KEY)).allocation.groups[0].items[0].buyPlan;
  assert.equal(plan.lines.budget,15,'목표 16% − 보유 15% = 10만원 + 체결 5만원');
  assets.find('edv').target=10;assets.assetStore.saveSection('allocation');
  plan=JSON.parse(storage.get(KEY)).allocation.groups[0].items[0].buyPlan;
  assert.equal(plan.lines.budget,5,'목표가 지금 비중보다 낮으면 이미 체결한 금액만 남는다');
  assert.equal(assets.view().budget,5);assert.match(assets.view().line,/목표 초과 50만원/);
  delete assets.find('edv').target;assets.assetStore.saveSection('allocation');
  const saved=JSON.parse(storage.get(KEY));plan=saved.allocation.groups[0].items[0].buyPlan;
  assert.equal(plan.lines.budget,5,'목표를 지우면 예산은 그대로');assert.equal(Object.hasOwn(saved.allocation.groups[0].items[0],'target'),false);
  assert.match(assets.view().line,/목표 미입력/);
  untouched(saved);
});
