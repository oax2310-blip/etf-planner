const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 실제 렌더·입력 핸들러와 자산 반영 코드를 함께 실행한다. DOM은 입력값·이벤트를 담는 최소 대역이다.
function setup({currency='KRW',budget=8.9,price=10000,legacy=false,manual=false,manualShares=8,manualAmount=8.9,ma=null,names=['25선'],tracking=false,trackingPrice=10000,trackingCurrency='KRW',missingTracking=false,manualTrackingPrice=null,fx=1000}={}){
  const ticker=currency==='USD'?'AAA':'111111',item={id:'a',name:'테스트 종목',ticker,shares:legacy?19:10,amount:0,
    buyPlan:manual?{stages:[{id:'s',price,...(manualShares===null?{}:{shares:manualShares}),amount:manualAmount}]}:{lines:{names,end:price,budget}}};
  if(currency==='USD')item.buyPlan.currency='USD';
  if(tracking){item.tradeTicker=trackingCurrency==='USD'?'BBB':'222222';if(manualTrackingPrice!==null){item.tradePrice=manualTrackingPrice;item.tradePriceAt='2026-01-02T00:00:00Z';}}
  const doc={version:1,allocation:{total:100,classes:[],cash:[],groups:[{id:'g',name:'테스트 계좌',items:[item]}]}};
  if(legacy){item.buyPlan.buys={end:{actual:8.9,price}};doc.allocation.trades={'buy:a:end':{qty:null,price,value:8.9,items:[{id:'a',shares:9}]}};}
  const prices={fx:{close:fx,asOf:'2026-01-02'},stocks:{[ticker]:{kind:currency==='USD'?'해외':'국내',close:price,asOf:'2026-01-02',...(ma?{ma}:{})}},futures:{}};
  if(tracking&&!missingTracking)prices.stocks[item.tradeTicker]={kind:trackingCurrency==='USD'?'해외':'국내',close:trackingPrice,asOf:'2026-01-02'};
  const elements=new Map(),rendered=new Map(),classList={add(){},remove(){},toggle(){}};
  function element(){return {dataset:{},value:'',classList,setAttribute(){},append(){},textContent:''};}
  const document={body:element(),createElement:element,getElementById(id){
    if(!elements.has(id)){
      const e=element();let html='';Object.defineProperty(e,'innerHTML',{get:()=>html,set(value){
        html=value;
        rendered.set(id,[...value.matchAll(/<(input|button)\b([^>]*)>/g)].map(([,tag,attrs])=>{
          const node=element();node.checked=/(?:^|\s)checked(?:\s|$)/.test(attrs);node.disabled=/(?:^|\s)disabled(?:\s|$)/.test(attrs);
          node.attrs=Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,val])=>[key,val]));
          node.value=node.attrs.value||'';
          for(const [key,val] of Object.entries(node.attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=val;
          if(node.attrs.id)elements.set(node.attrs.id,node);
          return node;
        }));
      }});elements.set(id,e);
    }
    return elements.get(id);
  },querySelectorAll(selector){return [...rendered.values()].flat().filter(node=>selector.split(',').some(s=>{
    const attr=/^\s*\[([\w-]+)\]\s*$/.exec(s);return attr&&Object.hasOwn(node.attrs,attr[1]);
  }));}};
  const store={doc,prices,status:{state:'off'},saveSection(){},recovery:()=>[]};
  const ctx={document,assetStore:store,priceData:prices,PENCIL:'',id:()=>'',priceText:(v,cur)=>`${cur==='USD'?'$':'₩'}${v}`,
    tradeAlertToggle:()=>'',esc:v=>String(v),$:document.getElementById.bind(document),$$:document.querySelectorAll.bind(document),setTimeout:()=>1,clearTimeout(){}};
  const code=['ma-ladder.js','prices.js','assets-calc.js','alloc-link.js','purchases.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
  const api=vm.runInNewContext(`${code}\n;({purchasePlanner,purchaseAlertRules})`,ctx);
  const before=JSON.stringify(doc);api.purchasePlanner.render();assert.equal(JSON.stringify(doc),before,'화면을 여는 것만으로 기록을 바꾸지 않음');
  function change(selector,value){const node=document.querySelectorAll(selector)[0];assert.ok(node,selector);if(typeof value==='boolean')node.checked=value;else node.value=String(value);node.onchange();}
  return {doc,item,prices,change,rules:()=>api.purchaseAlertRules(doc,prices),render:api.purchasePlanner.render,html:()=>document.getElementById('buysView').innerHTML,input:selector=>document.querySelectorAll(selector)[0]};
}

test('분할매수: 표시한 8주를 저장·반영하고 기존 금액 기록이 있어도 주수로만 수정한다',()=>{
  for(const options of [{},{currency:'USD',price:10}]){
    const r=setup(options);
    assert.match(r.html(),/매수 8주/);assert.doesNotMatch(r.html(),/약 8주/);
    r.change('[data-purchase-buy]',true);
    assert.equal(r.item.buyPlan.buys.end.shares,8);assert.equal(r.item.buyPlan.buys.end.actual,8);
    assert.equal(r.item.shares,18);assert.equal(r.doc.allocation.trades['buy:a:end'].qty,8);
    assert.equal(r.input('[data-purchase-buy-actual]'),undefined,'별도 체결금액 입력이 필요하지 않음');
    r.item.buyPlan.buys.end.actual=8.95;r.doc.allocation.trades['buy:a:end'].value=8.95;r.render();
    assert.equal(r.item.shares,18,'옛 금액 기록을 불러와도 보유 주수는 유지');
    r.change('[data-purchase-buy-shares]',7);
    assert.equal(r.item.shares,17);assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].shares,7);
    r.change('[data-purchase-buy-shares]',7.5);
    assert.equal(r.item.shares,17,'주식 소수 수량은 저장·반영하지 않음');
    r.change('[data-purchase-buy-shares]','');assert.equal(r.item.shares,17);
    r.change('[data-purchase-buy]',false);
    assert.equal(r.item.shares,10,'수량·금액을 수정한 뒤 취소해도 원래 보유량으로 복원');
    assert.equal(r.item.buyPlan.buys,undefined);assert.equal(r.doc.allocation.trades,undefined);
  }
});

test('분할매수: 옛 9주 반영 기록을 표시하고 실제 체결 수량 8주로 수정하면 1주를 되돌린다',()=>{
  const r=setup({legacy:true});assert.match(r.html(),/체결 9주/);
  assert.equal(r.item.buyPlan.buys.end.shares,undefined,'기존 기록을 자동 변경하지 않음');
  r.change('[data-purchase-buy-shares]',8);
  assert.equal(r.item.buyPlan.buys.end.shares,8);assert.equal(r.item.shares,18);
  assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].shares,8);
  assert.equal(r.input('[data-purchase-buy-actual]'),undefined);assert.equal(r.item.shares,18);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);
});

test('분할매수: 1주도 살 수 없는 예산은 0주로 표시하고 체크로 보유량을 늘리지 않는다',()=>{
  const r=setup({budget:0.9});assert.match(r.html(),/매수 0주/);assert.equal(r.input('[data-purchase-buy]').disabled,true);
  r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);
});

test('분할매수 직접 입력: 체결 주수만 입력하고 금액은 자동 계산한다',()=>{
  const r=setup({manual:true});r.change('[data-purchase-done]',true);assert.equal(r.item.shares,18);
  assert.equal(r.input('[data-purchase-actual]'),undefined);
  r.change('[data-purchase-shares]',7);assert.equal(r.item.shares,17);
  assert.equal(r.item.buyPlan.stages[0].actual,7.7875);
  r.change('[data-purchase-done]',false);assert.equal(r.item.shares,10);
});

test('분할매수: 체크 전 10주 중 7주를 기록하면 7주만 반영하고 잔량 3주를 유지한다',()=>{
  for(const options of [{budget:10},{budget:10,currency:'USD',price:10}]){
    const r=setup(options);r.change('[data-purchase-buy-shares]',7);
    assert.equal(r.item.buyPlan.buys.end.plannedShares,10);assert.equal(r.item.buyPlan.buys.end.shares,7);
    assert.equal(r.item.shares,17);assert.equal(r.doc.allocation.trades['buy:a:end'].qty,7);
    assert.match(r.html(),/부분 체결 · 체결 7주 · 남은 매수 3주/);
    assert.match(r.html(),/진행 중 · 0\/1회/);
    assert.equal(r.input('[data-purchase-buy]').checked,false);assert.equal(r.input('[data-purchase-buy]').indeterminate,true);
    r.change('[data-purchase-buy-shares]',9);assert.equal(r.item.shares,19,'추가 2주만 반영');
    assert.match(r.html(),/남은 매수 1주/);
    r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,20,'마지막 1주만 반영');
    assert.equal(r.input('[data-purchase-buy]').checked,true);assert.match(r.html(),/매수 완료 · 1\/1회/);
    r.change('[data-purchase-buy-shares]',0);assert.equal(r.item.shares,10);
    assert.equal(r.item.buyPlan.buys,undefined);assert.equal(r.doc.allocation.trades,undefined);
  }
});

test('분할매수: 완료 후 수량을 줄이면 부분 체결로 돌아가고 잘못된 입력은 자산을 바꾸지 않는다',()=>{
  const r=setup();r.change('[data-purchase-buy]',true);r.change('[data-purchase-buy-shares]',7);
  assert.match(r.html(),/남은 매수 1주/);assert.equal(r.input('[data-purchase-buy]').checked,false);
  for(const value of [9,7.5,-1,'',Infinity]){r.change('[data-purchase-buy-shares]',value);assert.equal(r.item.shares,17);}
  r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,18);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);
});

test('분할매수: 시세가 바뀌고 원래 단계가 사라져도 부분 체결 잔량과 예산을 보존한다',()=>{
  const r=setup({budget:50,price:14000,ma:{'25선':10000,'32선':13000},names:['25선','32선']});
  r.change('[data-purchase-buy-shares]',7);
  assert.equal(r.item.buyPlan.buys['25선:0'].plannedShares,10);
  r.prices.stocks['111111'].ma={'25선':15000,'32선':16000};r.render();
  assert.match(r.html(),/부분 체결 · 체결 7주 · 남은 매수 3주/);
  assert.equal(r.item.buyPlan.buys['25선:0'].price,10000,'원래 회차 가격도 유지');
  r.change('[data-purchase-buy-shares]',10);assert.equal(r.item.shares,20);
});

test('분할매수 직접 입력: 부분 체결·추가 체결·체크 취소가 원래 계획 수량을 보존한다',()=>{
  const r=setup({manual:true,manualShares:10,manualAmount:10});
  r.change('[data-purchase-shares]',7);assert.equal(r.item.shares,17);
  assert.equal(r.item.buyPlan.stages[0].plannedShares,10);assert.equal(r.item.buyPlan.stages[0].partial,true);
  assert.equal(r.item.buyPlan.stages[0].done,undefined);assert.match(r.html(),/남은 매수 3주/);
  r.change('[data-purchase-done]',true);assert.equal(r.item.shares,20);
  assert.equal(r.item.buyPlan.stages[0].done,true);assert.equal(r.item.buyPlan.stages[0].partial,undefined);
  r.change('[data-purchase-done]',false);assert.equal(r.item.shares,10);
  assert.equal(r.item.buyPlan.stages[0].shares,10);assert.equal(r.item.buyPlan.stages[0].plannedShares,undefined);
});

test('분할매수 금액 계획도 예정액·가격으로 주수를 계산해 체결 7주와 잔량 3주를 기록한다',()=>{
  const r=setup({manual:true,manualShares:null,manualAmount:10});
  assert.match(r.html(),/매수 10주/);assert.equal(r.input('[data-purchase-actual]'),undefined);
  r.change('[data-purchase-shares]',7);assert.equal(r.item.shares,17);
  assert.equal(r.item.buyPlan.stages[0].plannedShares,10);assert.equal(r.item.buyPlan.stages[0].actual,7);
  assert.match(r.html(),/부분 체결 · 체결 7주 · 남은 매수 3주/);
  r.change('[data-purchase-done]',true);assert.equal(r.item.shares,20);
  r.change('[data-purchase-shares]',8);assert.equal(r.item.shares,18);
  assert.match(r.html(),/남은 매수 2주/);
  r.change('[data-purchase-shares]',0);assert.equal(r.item.shares,10);
});

test('미국 ETF 추종: 실제 ETF 90주를 표시하고 부분 체결·추가 체결·취소에 같은 단위를 쓴다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  assert.match(r.html(),/매수 90주/);assert.match(r.html(),/실제 매수 <b>222222<\/b>/);assert.match(r.html(),/예상 ₩1350000/);assert.match(r.html(),/잔액 ₩0/);
  r.item.buyPlan.notify={stages:true};assert.equal(r.rules()[0].ticker,'AAA');assert.equal(r.rules()[0].targetPrice,100);
  r.change('[data-purchase-buy-shares]',60);
  const b=r.item.buyPlan.buys.end;assert.equal(b.shares,60);assert.equal(b.plannedShares,90);assert.equal(b.price,100);assert.equal(b.tradePrice,15000);assert.equal(b.tradeTicker,'222222');assert.equal(b.tradeCurrency,'KRW');assert.equal(b.actual,90);assert.equal(r.item.shares,70);
  assert.equal(r.doc.allocation.trades['buy:a:end'].price,15000,'반영 기록도 실제 ETF 가격');
  r.prices.stocks.AAA.close=200;r.prices.stocks['222222'].close=30000;r.prices.fx.close=1500;r.render();
  assert.match(r.html(),/남은 매수 30주/);assert.equal(b.tradePrice,15000,'첫 체결 시 가격 고정');
  r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,100);assert.equal(r.item.buyPlan.buys.end.actual,135);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);
});

test('추종 ETF: 예산 내림·잔액·가격 누락·직접 입력·해외 추종 ETF 환율을 처리한다',()=>{
  const r=setup({currency:'USD',price:100,budget:100,tracking:true,trackingPrice:12300});
  assert.match(r.html(),/매수 81주/);assert.match(r.html(),/예상 ₩996300/);assert.match(r.html(),/잔액 ₩3700/);
  const missing=setup({currency:'USD',price:100,tracking:true,missingTracking:true});
  assert.match(missing.html(),/수량 계산 불가/);assert.equal(missing.input('[data-purchase-buy]').disabled,true);
  missing.change('[data-purchase-buy]',true);assert.equal(missing.item.shares,10);
  const manualPrice=setup({currency:'USD',price:100,budget:100,tracking:true,missingTracking:true,manualTrackingPrice:12300});
  assert.match(manualPrice.html(),/매수 81주/);assert.match(manualPrice.html(),/직접 입력/);
  const small=setup({currency:'USD',price:100,budget:0.9,tracking:true});assert.match(small.html(),/매수 0주/);assert.equal(small.input('[data-purchase-buy]').disabled,true);
  const foreign=setup({currency:'USD',price:100,budget:10,tracking:true,trackingCurrency:'USD',trackingPrice:20,fx:1000});
  assert.match(foreign.html(),/매수 5주/);foreign.change('[data-purchase-buy]',true);assert.equal(foreign.item.shares,15);assert.equal(foreign.item.buyPlan.buys.end.tradeCurrency,'USD');assert.equal(foreign.item.buyPlan.buys.end.actual,10);
});

test('추종 ETF 직접 입력: 기준 수량 10주와 실제 계획 90주를 구분하고 취소 때 원래 입력을 복원한다',()=>{
  for(const manualShares of [10,null]){
    const r=setup({currency:'USD',price:100,manual:true,manualShares,manualAmount:135,tracking:true,trackingPrice:15000,fx:1350});
    assert.match(r.html(),/매수 90주/);r.change('[data-purchase-shares]',63);assert.equal(r.item.shares,73);
    const b=r.item.buyPlan.stages[0];assert.equal(b.plannedShares,90);assert.equal(b.actual,94.5);assert.equal(b.sourceShares,manualShares);assert.equal(b.tradePrice,15000);
    r.prices.stocks['222222'].close=30000;r.render();assert.match(r.html(),/남은 매수 27주/);
    r.change('[data-purchase-done]',true);assert.equal(r.item.shares,100);assert.equal(b.actual,135);
    r.change('[data-purchase-done]',false);assert.equal(r.item.shares,10);assert.equal(b.shares,manualShares??undefined);assert.equal(b.tradeTicker,undefined);assert.equal(b.sourceShares,undefined);
  }
});

test('같은 미국 티커를 추종해도 다른 실제 ETF 계좌에 주수를 더하지 않는다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  const other={id:'b',name:'다른 추종 ETF',ticker:'AAA',tradeTicker:'333333',shares:20};r.doc.allocation.groups[0].items.push(other);
  r.prices.stocks['333333']={kind:'국내',close:30000,asOf:'2026-01-02'};r.render();r.change('[data-purchase-buy]',true);
  assert.equal(r.item.shares,100);assert.equal(other.shares,20);
});
