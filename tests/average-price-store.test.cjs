// 가상 계좌·수량만 사용한다. 평균매수가는 기존 자산 저장·동기화 경로의 선택 필드다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),KEY='etf-planner-assets-v1',BASE='etf-planner-assets-sync-base:example/private-data';
const code=['js/repo-security.js','js/ma-ladder.js','js/data-validation.js','js/assets-calc.js','js/price-collection.js','js/assets-store.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
const clone=v=>JSON.parse(JSON.stringify(v));
const fake=()=>({version:1,allocation:{savedAt:'2026-01-01',total:100,classes:[],cash:[{id:'cash',amount:10}],groups:[
  {id:'g1',name:'가상 계좌 A',items:[{id:'a',ticker:'SYNTH',name:'가상 종목',shares:3,target:10,note:'보존',buyPlan:{stages:[{id:'s',amount:1,done:true,shares:1,actual:1}]}}]},
  {id:'g2',name:'가상 계좌 B',items:[{id:'b',ticker:'SYNTH',name:'가상 종목',shares:7,averagePrice:90}]}
],trades:{'buy:a:s':{qty:1,price:100,items:[{id:'a',shares:1}]}}},ledger:{savedAt:'2026-01-01',years:[]},savings:{savedAt:'2026-01-01',actual:[],scenarios:[]}});
const item=(doc,id)=>doc.allocation.groups.flatMap(g=>g.items).find(it=>it.id===id);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const contents=doc=>json({sha:'synthetic-sha',encoding:'base64',content:Buffer.from(JSON.stringify(doc)).toString('base64')});
function setup(initial,{shared,remote}={}){
  const storage=shared||new Map([[KEY,JSON.stringify(initial)]]),listeners=new Map(),uploads=[];
  const context={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    TextEncoder,TextDecoder,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
    AbortController,AbortSignal,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},setInterval(){},document:{hidden:false,addEventListener(){}},addEventListener:(type,fn)=>listeners.set(type,fn),
    async fetch(url,options={}){
      if(url.endsWith('/repos/example/private-data'))return json({private:true});
      if(url.endsWith('/contents/etf-planner-prices.json'))return new Response(null,{status:404});
      if(options.method==='PUT'){uploads.push(JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString()));return json({content:{sha:'synthetic-saved'}});}
      if(remote)return contents(remote);
      throw Error('unexpected synthetic network call');
    }};
  const store=vm.runInNewContext(`${code}\nassetStore`,context);
  return {store,storage,uploads,event:()=>listeners.get('storage')?.({key:KEY}),connect(base){storage.set('etf-planner-data-repo','example/private-data');storage.set('etf-planner-github-token','fake-test-token');storage.set(BASE,JSON.stringify(base));}};
}

test('평균매수가: 미입력 기록을 열어도 필드를 만들거나 기존 설정·다른 계좌를 바꾸지 않는다',()=>{
  const original=fake(),h=setup(original);h.store.start();
  assert.deepEqual(clone(h.store.doc),original);assert.deepEqual(JSON.parse(h.storage.get(KEY)),original);
  assert.equal(Object.hasOwn(item(h.store.doc,'a'),'averagePrice'),false);
});

test('평균매수가: 입력·수정·삭제를 새로고침·백업 복원 후 유지하고 다른 계좌·수량·체결을 보존한다',()=>{
  const original=fake(),h=setup(original);
  for(const averagePrice of [100.25,95.5,undefined]){
    if(averagePrice===undefined)delete item(h.store.doc,'a').averagePrice;else item(h.store.doc,'a').averagePrice=averagePrice;
    h.store.saveSection('allocation');
    const saved=JSON.parse(h.storage.get(KEY)),reloaded=setup(null,{shared:h.storage});reloaded.store.start();
    assert.deepEqual(clone(reloaded.store.doc),saved);
    assert.equal(item(reloaded.store.doc,'a').averagePrice,averagePrice);
    assert.equal(Object.hasOwn(item(reloaded.store.doc,'a'),'averagePrice'),averagePrice!==undefined);
    assert.deepEqual(item(saved,'b'),item(original,'b'));assert.equal(item(saved,'a').shares,3);
    assert.deepEqual(saved.allocation.trades,original.allocation.trades);assert.deepEqual(item(saved,'a').buyPlan,item(original,'a').buyPlan);
    assert.deepEqual(saved.ledger,original.ledger);assert.deepEqual(saved.savings,original.savings);
    const restored=setup(fake());assert.equal(restored.store.restore(saved),true);
    assert.deepEqual(clone(restored.store.doc.allocation.groups),saved.allocation.groups);
    assert.deepEqual(clone(restored.store.doc.allocation.trades),original.allocation.trades);
  }
});

test('평균매수가: 같은 티커의 서로 다른 계좌 입력과 다른 필드 변경을 동기화하면서 모두 보존한다',async()=>{
  const original=fake(),remote=clone(original);item(remote,'b').averagePrice=85.75;item(remote,'a').note='원격 메모';remote.allocation.savedAt='2099-01-01';
  const h=setup(original,{remote});h.connect(original);item(h.store.doc,'a').averagePrice=100.25;h.store.saveSection('allocation');await h.store.sync();
  assert.equal(h.store.status.state,'done');assert.equal(item(h.store.doc,'a').averagePrice,100.25);assert.equal(item(h.store.doc,'b').averagePrice,85.75);
  assert.equal(item(h.store.doc,'a').note,'원격 메모');assert.equal(h.store.recovery().length,0);
  const uploaded=h.uploads.at(-1);assert.deepEqual(uploaded.allocation.trades,original.allocation.trades);assert.deepEqual(uploaded.ledger,original.ledger);
  assert.equal(item(setup(uploaded).store.doc,'a').averagePrice,100.25);
});

test('평균매수가: 한쪽에서 비운 필드를 동기화하고 다른 계좌와 원격 설정 변경은 보존한다',async()=>{
  const original=fake();item(original,'a').averagePrice=100;
  const remote=clone(original);item(remote,'b').target=20;remote.allocation.savedAt='2099-01-01';
  const h=setup(original,{remote});h.connect(original);delete item(h.store.doc,'a').averagePrice;h.store.saveSection('allocation');await h.store.sync();
  assert.equal(h.store.status.state,'done');assert.equal(Object.hasOwn(item(h.store.doc,'a'),'averagePrice'),false);
  assert.equal(Object.hasOwn(item(h.uploads.at(-1),'a'),'averagePrice'),false);assert.equal(item(h.store.doc,'b').averagePrice,90);assert.equal(item(h.store.doc,'b').target,20);
  assert.equal(h.store.recovery().length,0);
});

test('평균매수가: 원격 삭제도 다른 계좌의 로컬 입력과 함께 반영한다',async()=>{
  const original=fake();item(original,'a').averagePrice=100;
  const remote=clone(original);delete item(remote,'a').averagePrice;remote.allocation.savedAt='2099-01-01';
  const h=setup(original,{remote});h.connect(original);item(h.store.doc,'b').averagePrice=80;h.store.saveSection('allocation');await h.store.sync();
  assert.equal(Object.hasOwn(item(h.store.doc,'a'),'averagePrice'),false);assert.equal(item(h.store.doc,'b').averagePrice,80);assert.equal(h.store.recovery().length,0);
});

test('평균매수가: 같은 칸의 수정 충돌은 기존 규칙으로 선택하고 이전 값·다른 계좌를 보관한다',async()=>{
  const original=fake();item(original,'a').averagePrice=100;
  const remote=clone(original);item(remote,'a').averagePrice=110;remote.allocation.savedAt='2099-01-01';
  const h=setup(original,{remote});h.connect(original);item(h.store.doc,'a').averagePrice=95;item(h.store.doc,'b').averagePrice=80;h.store.saveSection('allocation');await h.store.sync();
  assert.equal(item(h.store.doc,'a').averagePrice,110);assert.equal(item(h.store.doc,'b').averagePrice,80);
  assert.equal(h.store.notice.kind,'merged');assert.equal(h.store.notice.count,1);assert.equal(h.store.recovery().length,1);
  assert.equal(item({allocation:clone(h.store.recovery()[0].data)},'a').averagePrice,95);
  assert.deepEqual(clone(h.store.doc.allocation.trades),original.allocation.trades);
});

test('평균매수가: 삭제와 다른 기기의 수정이 겹치면 수정 값을 남기고 삭제 전 기록을 보관한다',async()=>{
  const original=fake();item(original,'a').averagePrice=100;
  const remote=clone(original);item(remote,'a').averagePrice=110;remote.allocation.savedAt='2099-01-01';
  const h=setup(original,{remote});h.connect(original);delete item(h.store.doc,'a').averagePrice;h.store.saveSection('allocation');await h.store.sync();
  assert.equal(item(h.store.doc,'a').averagePrice,110);assert.equal(item(h.store.doc,'b').averagePrice,90);
  assert.equal(h.store.notice.count,1);assert.equal(h.store.recovery().length,1);
  assert.equal(Object.hasOwn(item({allocation:clone(h.store.recovery()[0].data)},'a'),'averagePrice'),false);
});

test('평균매수가: 같은 브라우저의 다른 페이지 입력도 계좌별로 병합한다',()=>{
  const original=fake(),first=setup(original),second=setup(null,{shared:first.storage});first.store.start();second.store.start();
  item(first.store.doc,'a').averagePrice=100;first.store.saveSection('allocation');
  item(second.store.doc,'b').averagePrice=85;second.store.saveSection('allocation');first.event();
  assert.equal(item(first.store.doc,'a').averagePrice,100);assert.equal(item(first.store.doc,'b').averagePrice,85);
  assert.equal(item(JSON.parse(first.storage.get(KEY)),'a').averagePrice,100);assert.equal(first.store.recovery().length,0);
});

test('평균매수가: 다른 페이지 알림 전 같은 칸을 수정하면 마지막 저장을 쓰고 앞선 입력을 보관한다',()=>{
  const original=fake(),first=setup(original),second=setup(null,{shared:first.storage});first.store.start();second.store.start();
  item(first.store.doc,'a').averagePrice=100;first.store.saveSection('allocation');
  item(second.store.doc,'a').averagePrice=95;second.store.saveSection('allocation');
  assert.equal(item(second.store.doc,'a').averagePrice,95);assert.equal(second.store.notice.count,1);assert.equal(second.store.recovery().length,1);
  assert.equal(item({allocation:clone(second.store.recovery()[0].data)},'a').averagePrice,100);
  assert.equal(item(second.store.doc,'b').averagePrice,90);assert.deepEqual(clone(second.store.doc.allocation.trades),original.allocation.trades);
});

test('평균매수가: 다른 페이지에서 체결로 바뀐 보유량을 알림 전 저장해도 되돌리지 않는다',()=>{
  const original=fake(),planner=setup(original),assets=setup(null,{shared:planner.storage});planner.store.start();assets.store.start();
  item(planner.store.doc,'a').shares=5;planner.store.doc.allocation.trades['buy:a:next']={qty:2,price:110,items:[{id:'a',shares:2}]};planner.store.saveSection('allocation');
  item(assets.store.doc,'a').averagePrice=100;assets.store.saveSection('allocation');
  assert.equal(item(assets.store.doc,'a').shares,5);assert.equal(item(assets.store.doc,'a').averagePrice,100);
  assert.equal(assets.store.doc.allocation.trades['buy:a:next'].qty,2);assert.equal(assets.store.recovery().length,0);
});

test('평균매수가: 백업·동기화 경계에서 양수만 허용하고 원본·미입력 필드는 생성하거나 바꾸지 않는다',()=>{
  const validate=vm.runInNewContext(fs.readFileSync(path.join(root,'js/data-validation.js'),'utf8')+'\nexternalData');
  for(const averagePrice of [100.25,'0.000001',undefined]){
    const data=fake();if(averagePrice!==undefined)item(data,'a').averagePrice=averagePrice;
    const before=JSON.stringify(data);assert.equal(validate.assets(data),data);assert.equal(JSON.stringify(data),before);
  }
  for(const averagePrice of [0,-1,'-0.5','Infinity','<img src=x>',true,{},[]]){
    const data=fake();item(data,'a').averagePrice=averagePrice;const before=JSON.stringify(data);
    assert.throws(()=>validate.assets(data),/averagePrice/);assert.equal(JSON.stringify(data),before);
  }
});

test('평균매수가: 잘못된 원격 값과 백업을 거부하고 현재 계좌·보유량·체결을 덮어쓰지 않는다',async()=>{
  const original=fake(),remote=clone(original);item(remote,'a').averagePrice='invalid-synthetic-price';
  const h=setup(original,{remote});h.connect(original);const before=h.storage.get(KEY);await h.store.sync();
  assert.equal(h.store.status.state,'error');assert.equal(h.uploads.length,0);assert.deepEqual(clone(h.store.doc),original);assert.equal(h.storage.get(KEY),before);
  assert.throws(()=>h.store.restore(remote),/averagePrice/);assert.deepEqual(clone(h.store.doc),original);assert.equal(h.storage.get(KEY),before);
});
