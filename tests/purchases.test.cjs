const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 실제 렌더·입력 핸들러와 자산 반영 코드를 함께 실행한다. DOM은 입력값·이벤트를 담는 최소 대역이다.
function setup({currency='KRW',budget=8.9,price=10000,end=price,legacy=false,manual=false,manualShares=8,manualAmount=8.9,ma=null,names=['25선'],wait=null,tracking=false,trackingPrice=10000,trackingCurrency='KRW',missingTracking=false,manualTrackingPrice=null,fx=1000}={}){
  const ticker=currency==='USD'?'AAA':'111111',item={id:'a',name:'테스트 종목',ticker,shares:legacy?19:10,amount:0,
    buyPlan:wait?{wait:{line:wait},notify:{stages:true}}:manual?{stages:[{id:'s',price,...(manualShares===null?{}:{shares:manualShares}),amount:manualAmount}]}:{lines:{names,...(end===null?{}:{end}),budget}}};
  if(currency==='USD')item.buyPlan.currency='USD';
  if(tracking){item.tradeTicker=trackingCurrency==='USD'?'BBB':'222222';if(manualTrackingPrice!==null){item.tradePrice=manualTrackingPrice;item.tradePriceAt='2026-01-02T00:00:00Z';}}
  const doc={version:1,allocation:{total:100,classes:[],cash:[],groups:[{id:'g',name:'테스트 계좌',items:[item]}]}};
  if(legacy){item.buyPlan.buys={end:{actual:8.9,price}};doc.allocation.trades={'buy:a:end':{qty:null,price,value:8.9,items:[{id:'a',shares:9}]}};}
  const prices={fx:{close:fx,asOf:'2026-01-02'},stocks:{[ticker]:{kind:currency==='USD'?'해외':'국내',close:price,asOf:'2026-01-02',...(ma?{ma}:{})}},futures:{}};
  if(tracking&&!missingTracking)prices.stocks[item.tradeTicker]={kind:trackingCurrency==='USD'?'해외':'국내',close:trackingPrice,asOf:'2026-01-02'};
  const elements=new Map(),rendered=new Map(),classList={add(){},remove(){},toggle(){}};
  function element(){return {dataset:{},value:'',classList,setAttribute(){},append(){},focus(){},textContent:'',addEventListener(){},querySelectorAll:selector=>document.querySelectorAll(selector)};}
  // innerHTML로 그린 input·button을 기억해 querySelectorAll로 찾는다. 검색 칸(item-search.js)이 만든 요소도 id로 찾는다.
  function capturing(e){
    let html='';Object.defineProperty(e,'innerHTML',{get:()=>html,set(value){
      html=value;
      rendered.set(e,[...value.matchAll(/<(input|button)\b([^>]*)>/g)].map(([,tag,attrs])=>{
        const node=element();node.checked=/(?:^|\s)checked(?:\s|$)/.test(attrs);node.disabled=/(?:^|\s)disabled(?:\s|$)/.test(attrs);
        node.attrs=Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,val])=>[key,val]));
        node.value=node.attrs.value||'';
        for(const [key,val] of Object.entries(node.attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=val;
        if(node.attrs.id)elements.set(node.attrs.id,node);
        return node;
      }));
    }});
    return e;
  }
  const document={body:element(),createElement(){const e=capturing(element());let id='';Object.defineProperty(e,'id',{get:()=>id,set(v){id=v;elements.set(v,e);}});return e;},getElementById(id){
    if(!elements.has(id))elements.set(id,capturing(element()));
    return elements.get(id);
  },addEventListener(){},querySelectorAll(selector){return [...rendered.values()].flat().filter(node=>selector.split(',').some(s=>{
    const attr=/^\s*\[([\w-]+)\]\s*$/.exec(s);return attr&&Object.hasOwn(node.attrs,attr[1]);
  }));}};
  const purchaseForm=document.getElementById('purchaseForm');
  for(const name of ['item','mode','waitPeriod','waitUnit','waitNotify','lineStartPeriod','lineStartUnit','lineSet','lineTarget','lineEnd','lineLastPeriod','lineLastUnit','lineBudget','manualCurrency','cardName','note'])purchaseForm[name]=element();
  const dialog=document.getElementById('purchaseDialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const listeners=new Set(),store={doc,prices,status:{state:'off'},saveSection(){},recovery:()=>[],start(){},subscribe:fn=>listeners.add(fn)};
  const alerts=[],renameDialogs=[],ctx={document,assetStore:store,priceData:prices,PENCIL:'',id:()=>'',alert:text=>alerts.push(text),openNameDialog:(id,options)=>renameDialogs.push({id,...options}),priceText:(v,cur)=>`${cur==='USD'?'$':'₩'}${v}`,
    tradeAlertToggle:(on,attrs)=>`<label><input type="checkbox" ${attrs}${on?' checked':''}></label>`,esc:v=>String(v),$:document.getElementById.bind(document),$$:document.querySelectorAll.bind(document),setTimeout:()=>1,clearTimeout(){},matchMedia:()=>({matches:false}),state:{tab:'buys'}};
  const code=['ma-ladder.js','prices.js','assets-calc.js','alloc-link.js','stock-names.js','item-search.js','purchases.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
  const api=vm.runInNewContext(`${code}\n;({purchasePlanner,purchaseAlertRules,syncPurchaseTargets})`,ctx);
  const before=JSON.stringify(doc);api.purchasePlanner.render();assert.equal(JSON.stringify(doc),before,'화면을 여는 것만으로 기록을 바꾸지 않음');
  function change(selector,value){const node=document.querySelectorAll(selector)[0];assert.ok(node,selector);if(typeof value==='boolean')node.checked=value;else node.value=String(value);node.onchange();}
  return {doc,item,prices,change,alerts,names:renameDialogs,form:purchaseForm,edit:()=>document.querySelectorAll('[data-purchase-edit]')[0].onclick(),submit:()=>purchaseForm.onsubmit({preventDefault(){}}),rules:()=>api.purchaseAlertRules(doc,prices),sync:before=>api.syncPurchaseTargets(before,doc.allocation,prices),render:api.purchasePlanner.render,initialize:api.purchasePlanner.initialize,emit:()=>listeners.forEach(fn=>fn('change')),element:document.getElementById.bind(document),html:()=>document.getElementById('buysView').innerHTML,input:selector=>document.querySelectorAll(selector)[0],inputs:selector=>document.querySelectorAll(selector)};
}

// 계획 진행 카드(purchases.js statusCard)의 상태 칩과 완료/전체 회차
const trackStatus=(status,done,count)=>new RegExp(`buy-track-chip[^"]*">${status}</span>.*?<div class="buy-track-count"><b>${done}</b><span>/ ${count}회</span>`);
function linkedAccounts(r,{ticker=r.item.ticker,tradeTicker='333333',price=20000}={}){
  const other={id:'b',name:'다른 계좌 ETF',ticker,tradeTicker,shares:5},zero={id:'c',name:'보유량 0인 ETF',ticker:r.item.ticker,tradeTicker:r.item.tradeTicker,shares:0};
  r.doc.allocation.groups.push({id:'g2',name:'추가 계좌',items:[other,zero]});
  r.prices.stocks[tradeTicker]={kind:'국내',close:price,asOf:'2026-01-02'};
  r.render();
  return {other,zero,move:(id,direction)=>{const b=r.inputs('[data-purchase-priority]').find(x=>x.dataset.purchasePriority===id&&Number(x.dataset.purchaseDirection)===direction);assert.ok(b);b.onclick();},ids:()=>Array.from(r.html().matchAll(/data-purchase-holding="([^"]+)"/g),m=>m[1])};
}

test('매수 화살표는 연결 계좌 순서와 매수 반영 대상·계획 주수를 함께 바꾸고 되돌리기·다시 그리기는 보유 기록을 보존한다',()=>{
  const r=setup({tracking:true,budget:12}),{other,zero,move,ids}=linkedAccounts(r),before=JSON.stringify(r.doc),groups=JSON.stringify(r.doc.allocation.groups.map(g=>({id:g.id,items:g.items.map(({buyPlan,...it})=>it)})));
  assert.deepEqual(ids(),['a','b','c']);assert.match(r.html(),/매수 12주/);
  move('a',-1);assert.equal(JSON.stringify(r.doc),before,'첫 항목 경계는 저장하지 않음');
  move('b',-1);assert.deepEqual(ids(),['b','a','c']);assert.deepEqual(Array.from(r.item.buyPlan.buyPriority),['b','a','c']);assert.match(r.html(),/매수 6주/);
  assert.doesNotMatch(r.html(),/매수 반영 대상<\/b>|실제 매수 <b>/,'보유 목록 아래 반영 대상·실제 매수 안내는 두지 않음');assert.match(r.html(),/추가 계좌 · 다른 계좌 ETF · 333333 · 예상/);
  assert.equal(JSON.stringify(r.doc.allocation.groups.map(g=>({id:g.id,items:g.items.map(({buyPlan,...it})=>it)}))),groups);assert.equal(other.buyPlan,undefined);assert.equal(zero.shares,0);assert.equal(r.doc.allocation.trades,undefined);
  r.edit();assert.match(r.element('linePreview').innerHTML,/6주/);assert.match(r.element('purchaseTargetInfo').innerHTML,/매수 반영 대상<\/b> 자산 배분 › 추가 계좌 › 다른 계좌 ETF/);assert.match(r.element('purchaseTrackingInfo').innerHTML,/실제 매수 <b>333333<\/b>/);r.submit();assert.deepEqual(ids(),['b','a','c']);
  const ordered=JSON.stringify(r.doc);r.render();assert.equal(JSON.stringify(r.doc),ordered,'조회만으로 순서를 다시 저장하지 않음');
  assert.doesNotMatch(r.html(),/순서 초기화|resetPurchasePriority/,'순서 초기화 버튼 없이 화살표로 되돌림');
  move('a',-1);assert.deepEqual(ids(),['a','b','c']);assert.deepEqual(Array.from(r.item.buyPlan.buyPriority),['a','b','c']);assert.match(r.html(),/매수 12주/);
  assert.equal(JSON.stringify(r.doc.allocation.groups.map(g=>({id:g.id,items:g.items.map(({buyPlan,...it})=>it)}))),groups);assert.equal(r.doc.allocation.trades,undefined);
});

test('부분·완료 회차는 첫 반영 계좌·가격·수량을 유지하고 우선순위 변경은 미체결 회차에만 반영한다',()=>{
  const r=setup({tracking:true,budget:60,end:null,names:['25일선','32일선'],ma:{'25일선':10000,'32일선':20000}}),{other,move}=linkedAccounts(r);
  move('b',-1);
  const first=r.inputs('[data-purchase-buy-shares]')[0],key=first.dataset.key,planned=Number(first.attrs.max);first.value='2';first.onchange();
  const record=JSON.stringify(r.item.buyPlan.buys[key]),trade=JSON.stringify(r.doc.allocation.trades['buy:a:'+key]);assert.equal(other.shares,7);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys[key].tradeTargetId,'b');
  move('a',-1);assert.equal(JSON.stringify(r.item.buyPlan.buys[key]),record);assert.equal(JSON.stringify(r.doc.allocation.trades['buy:a:'+key]),trade);
  const fresh=r.inputs('[data-purchase-buy-shares]').find(x=>x.dataset.key!==key),freshKey=fresh.dataset.key;fresh.value='1';fresh.onchange();
  assert.equal(r.item.shares,11);assert.equal(other.shares,7);assert.equal(r.item.buyPlan.buys[freshKey].tradeTargetId,'a');
  const partial=r.inputs('[data-purchase-buy-shares]').find(x=>x.dataset.key===key);partial.value=String(planned);partial.onchange();assert.equal(other.shares,5+planned);assert.equal(r.item.shares,11);assert.equal(r.item.buyPlan.buys[key].tradePrice,20000);
  const done=r.inputs('[data-purchase-buy]').find(x=>x.dataset.key===key);assert.equal(done.checked,true);done.checked=false;done.onchange();assert.equal(other.shares,5);assert.equal(r.item.shares,11);assert.equal(r.doc.allocation.trades['buy:a:'+key],undefined);
});

test('같은 ETF 코드의 다른 계좌도 화살표로 직접 바꾸며 새로 고른 계좌에만 체결·추가·취소를 반영한다',()=>{
  const r=setup(),{other,move}=linkedAccounts(r,{tradeTicker:'111111'});delete other.tradeTicker;r.render();
  move('b',-1);r.change('[data-purchase-buy-shares]',3);assert.equal(other.shares,8);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys.end.tradeTargetId,'b');
  assert.equal(r.doc.allocation.trades['buy:a:end'].items.length,1);assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].id,'b');
  move('a',-1);r.change('[data-purchase-buy-shares]',8);assert.equal(other.shares,13);assert.equal(r.item.shares,10);
  r.change('[data-purchase-buy-shares]',0);assert.equal(other.shares,5);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);
});

test('수량 입력에서 바로 화살표를 누르면 체결은 기존 계좌에 저장하고 한 번의 클릭으로 다음 대상을 바꾼다',()=>{
  const r=setup({tracking:true,budget:12}),{other,move}=linkedAccounts(r);move('b',-1);
  const arrow=r.inputs('[data-purchase-priority]').find(x=>x.dataset.purchasePriority==='a'&&x.dataset.purchaseDirection==='-1'),before=r.html();
  arrow.onpointerdown({button:0});r.change('[data-purchase-buy-shares]',2);assert.equal(other.shares,7);assert.equal(r.html(),before,'blur 저장 중에는 클릭 대상 버튼을 제거하지 않음');
  arrow.onclick();assert.deepEqual(Array.from(r.item.buyPlan.buyPriority),['a','b','c']);assert.equal(r.item.buyPlan.buys.end.tradeTargetId,'b');assert.equal(other.shares,7);assert.equal(r.item.shares,10);assert.match(r.html(),/부분 체결/);
});

test('기존 직접 입력 회차도 계좌·ETF를 바꾸고 추가 체결은 고정하며 취소하면 원래 기준 수량과 선택 필드를 복원한다',()=>{
  const r=setup({tracking:true,manual:true}),{other,move}=linkedAccounts(r),original=JSON.stringify(r.item.buyPlan.stages);
  move('b',-1);assert.match(r.html(),/매수 4주/);r.change('[data-purchase-shares]',2);assert.equal(other.shares,7);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.stages[0].sourceShares,8);assert.equal(r.item.buyPlan.stages[0].tradeTargetId,'b');
  move('a',-1);r.change('[data-purchase-shares]',4);assert.equal(other.shares,9);assert.equal(r.item.shares,10);r.change('[data-purchase-done]',false);
  assert.equal(other.shares,5);assert.equal(JSON.stringify(r.item.buyPlan.stages),original);assert.equal(r.doc.allocation.trades,undefined);
});

test('선택한 ETF의 시세·환율을 기다리며 입력·알림·미리보기도 같은 수량을 쓰고 다른 계좌 시세로 대체하지 않는다',()=>{
  const r=setup({tracking:true,budget:10}),{move}=linkedAccounts(r);r.item.buyPlan.notify={stages:true};delete r.prices.stocks['333333'];move('b',-1);
  assert.equal(r.input('[data-purchase-buy]').disabled,true);assert.match(r.html(),/수량 계산 불가<\/strong><small class="purchase-tracking-amount">추가 계좌 · 다른 계좌 ETF<\/small><small class="">실제 매수 ETF의 현재가와 필요한 환율을 확인하세요/);assert.doesNotMatch(r.html(),/매수 10주/);
  r.prices.stocks['333333']={kind:'해외',close:20,asOf:'2026-01-02'};r.doc.allocation.groups[1].items[0].tradeTicker='BBB';r.prices.stocks.BBB=r.prices.stocks['333333'];r.prices.fx=null;r.render();assert.equal(r.input('[data-purchase-buy]').disabled,true);
  r.prices.fx={close:1000};r.render();assert.match(r.html(),/매수 5주/);assert.equal(r.rules().length,1);
  r.prices.stocks.BBB.close=200;r.render();assert.match(r.html(),/매수 0주/);assert.equal(r.input('[data-purchase-buy]').disabled,true);assert.equal(r.rules().length,0);
});

test('다른 투자 대상·중복·삭제된 우선순위 id는 제외하고 없어진 체결 계좌를 다른 계좌로 바꿔 반영하지 않는다',()=>{
  const r=setup({tracking:true,budget:12}),{other,move,ids}=linkedAccounts(r);r.doc.allocation.groups[1].items.push({id:'x',name:other.name,ticker:'444444',shares:99});
  r.item.buyPlan.buyPriority=['x','b','b','missing','a'];const before=JSON.stringify(r.doc);r.render();assert.deepEqual(ids(),['b','a','c']);assert.equal(JSON.stringify(r.doc),before);
  r.change('[data-purchase-buy-shares]',2);assert.equal(other.shares,7);r.doc.allocation.groups[1].items=r.doc.allocation.groups[1].items.filter(x=>x.id!=='b');r.render();assert.deepEqual(ids(),['a','c']);
  const saved=JSON.stringify(r.doc);r.change('[data-purchase-buy-shares]',3);assert.equal(JSON.stringify(r.doc),saved);assert.equal(r.item.shares,10);r.change('[data-purchase-buy-shares]',0);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);
});

test('매수대기에서도 계획 종목 순서를 바꿔 저장하고 돌파 계획으로 수정해도 그 대상과 기존 보유량을 유지한다',()=>{
  const r=setup({tracking:true,wait:'25일선',ma:{'25일선':10000}}),{other,move}=linkedAccounts(r);move('b',-1);assert.match(r.html(),/다른 계좌 ETF<\/strong><span class="sale-holding-tag">계획 종목/);assert.equal(r.inputs('[data-purchase-buy]').length,0);
  r.edit();r.form.mode.value='lines';r.form.lineStartUnit.value='일선';r.form.lineSet.value='day';r.form.lineBudget.value='10';r.form.lineEnd.value='10000';r.submit();assert.equal(r.alerts.length,0);assert.deepEqual(Array.from(r.item.buyPlan.buyPriority),['b','a','c']);assert.match(r.html(),/매수 5주/);assert.equal(other.shares,5);assert.equal(r.item.shares,10);assert.equal(r.doc.allocation.trades,undefined);
});

test('연결 보유 목록은 추종 ETF·실제 코드 보유 계좌 모두를 보여 주고 보유량·체결·시세 변경도 그대로 읽는다',()=>{
  const r=setup({tracking:true,budget:10}),other={id:'b',name:'다른 계좌 <보유>',ticker:'111111',tradeTicker:'333333',shares:5},direct={id:'c',name:'직접 보유 계좌',ticker:'A222222',shares:20},unrelated={id:'x',name:r.item.name,ticker:'444444',shares:50};
  r.doc.allocation.groups.push({id:'g2',name:'다른 계좌',items:[other,direct,unrelated]});r.prices.stocks['333333']={kind:'국내',close:30000,asOf:'2026-01-02'};r.prices.stocks.A222222={kind:'국내',close:10000,asOf:'2026-01-02'};
  const before=JSON.stringify(r.doc);r.render();r.initialize();
  const ids=()=>Array.from(r.html().matchAll(/data-purchase-holding="([^"]+)"/g),m=>m[1]);assert.deepEqual(ids(),['a','b','c']);
  assert.match(r.html(),/연결된 전체 보유 종목/);assert.match(r.html(),/다른 계좌 &lt;보유&gt;/);assert.match(r.html(),/전체 계좌 3개 항목 · 현재 45%/);assert.equal(JSON.stringify(r.doc),before);
  r.change('[data-purchase-buy-shares]',7);assert.match(r.html(),/전체 계좌 3개 항목 · 현재 52%/);assert.match(r.html(),/보유 17주/);assert.equal(other.shares,5);assert.equal(direct.shares,20);
  r.change('[data-purchase-buy-shares]',0);assert.equal(JSON.stringify(r.doc),before);
  other.shares=10;r.emit();assert.match(r.html(),/전체 계좌 3개 항목 · 현재 60%/);
  r.prices.stocks['333333'].close=40000;r.emit();assert.match(r.html(),/전체 계좌 3개 항목 · 현재 70%/);
});
test('연결 보유 목록은 금액 보유를 주수로 오인하지 않고 0주·시세 누락·매수대기에서도 조회만 한다',()=>{
  const r=setup({wait:'25일선'});delete r.item.shares;r.item.amount=7;r.prices.stocks={};
  r.doc.allocation.groups[0].items.push({id:'b',name:'0주 보유',ticker:'111111',shares:0,amount:99},{id:'c',name:'시세 대기 계좌',ticker:'111111',shares:3},{id:'d',name:'소수 보유 계좌',ticker:'111111',shares:.125});
  const before=JSON.stringify(r.doc);r.render();assert.match(r.html(),/금액으로 보유 관리/);assert.match(r.html(),/보유 0주/);assert.match(r.html(),/보유 3주 · 시세 대기/);assert.match(r.html(),/보유 0\.125주 · 시세 대기/);assert.match(r.html(),/평가 대기/);assert.match(r.html(),/전체 계좌 4개 항목 · 현재 7%/);
  assert.doesNotMatch(r.html(),/보유 7주|NaN|undefined|data-purchase-buy=/);assert.equal(JSON.stringify(r.doc),before);
});
test('분할매도와 같은 메모 저장은 현재 계획만 수정하고 체결·보유량을 보존하며 비운 필드는 삭제한다',()=>{
  const r=setup({tracking:true});r.change('[data-purchase-buy-shares]',3);
  const buys=JSON.stringify(r.item.buyPlan.buys),trades=JSON.stringify(r.doc.allocation.trades),shares=r.item.shares;
  const note=r.element('purchaseMemo');note.value='매수 메모 <확인>';note.oninput();assert.equal(r.element('purchaseMemoCount').textContent,'10 / 4,000자');assert.equal(r.item.buyPlan.note,undefined);
  r.element('savePurchaseNote').onclick();assert.equal(r.item.buyPlan.note,'매수 메모 <확인>');assert.match(r.html(),/매수 메모 &lt;확인&gt;/);
  r.element('purchaseMemo').value='';r.element('savePurchaseNote').onclick();assert.equal(Object.hasOwn(r.item.buyPlan,'note'),false);
  assert.equal(JSON.stringify(r.item.buyPlan.buys),buys);assert.equal(JSON.stringify(r.doc.allocation.trades),trades);assert.equal(r.item.shares,shares);
});
test('카드 이름·계획 수정은 자산 종목 이름과 보유량을 유지하고 PC 연필·터치 길게 누르기로 같은 이름 창을 연다',()=>{
  const r=setup({tracking:true}),before=JSON.stringify(r.doc),select=r.input('[data-purchase-select]');
  select.ontouchstart({touches:[{clientX:0,clientY:0}]});select.ontouchmove({touches:[{clientX:20,clientY:0}]});select.oncontextmenu({preventDefault(){}});assert.equal(r.names.length,0,'스크롤은 이름 창을 열지 않음');
  select.ontouchstart({touches:[{clientX:0,clientY:0}]});select.oncontextmenu({preventDefault(){}});assert.equal(r.names.length,1);assert.equal(JSON.stringify(r.doc),before);
  r.names[0].onSave('내 매수 계획');assert.equal(r.item.buyPlan.cardName,'내 매수 계획');assert.match(r.html(),/<strong>내 매수 계획<\/strong>/);assert.equal(r.item.name,'테스트 종목');assert.equal(r.item.shares,10);
  r.input('[data-purchase-rename]').onclick();assert.equal(r.names.at(-1).cardName,'내 매수 계획');r.names.at(-1).onSave('');assert.equal(Object.hasOwn(r.item.buyPlan,'cardName'),false);assert.equal(JSON.stringify(r.doc),before);
  r.edit();r.form.cardName.value='계획 창 이름';r.submit();assert.equal(r.item.buyPlan.cardName,'계획 창 이름');r.edit();assert.equal(r.form.cardName.value,'계획 창 이름');
  r.form.cardName.value='';r.submit();assert.equal(Object.hasOwn(r.item.buyPlan,'cardName'),false);assert.equal(r.item.name,'테스트 종목');
});

test('분할매수 목록: 카드 이름이 없으면 종목명을 굵게·코드를 아래 줄에, 같은 이름의 다른 코드는 모바일에도 코드 줄을 보이고 카드 이름은 그대로 둔다',()=>{
  const r=setup(),card=id=>new RegExp(`<button class="([^"]*)" type="button" data-purchase-select="${id}"[^>]*>(.*?)</button>`).exec(r.html())?.slice(1).join(' | ')||'';
  assert.match(card('a'),/<strong>테스트 종목<\/strong><span class="plan-count[^"]*">.*<span class="plan-title">111111<\/span>/);
  assert.doesNotMatch(card('a'),/show-code/);
  r.input('[data-purchase-rename]').onclick();assert.equal(r.names.at(-1).name,'테스트 종목','이름 창도 비웠을 때 보일 종목명');
  r.doc.allocation.groups.push({id:'g2',name:'다른 계좌',items:[{id:'b',name:'테스트 종목',ticker:'222222',amount:5,buyPlan:{lines:{names:['25선'],budget:5}}},{id:'c',name:'',ticker:'333333',amount:5,buyPlan:{lines:{names:['25선'],budget:5}}}]});
  r.render();assert.match(card('a'),/^plan-item active show-code \| <span class="plan-row"><strong>테스트 종목<\/strong>.*<span class="plan-title">111111<\/span>/);assert.match(card('b'),/^plan-item show-code \|.*<span class="plan-title">222222<\/span>/);
  assert.match(card('c'),/^plan-item \| <span class="plan-row"><strong>333333<\/strong><span class="plan-count/,'종목 이름이 없으면 코드');
  r.item.buyPlan.cardName='내 매수 카드';const before=JSON.stringify(r.doc);r.render();
  assert.match(card('a'),/<strong>내 매수 카드<\/strong><span class="plan-count[^"]*">.*<span class="plan-title">테스트 종목<\/span>/,'카드 이름이 있으면 기존처럼 아래 줄에 종목 이름');
  assert.equal(JSON.stringify(r.doc),before,'목록을 그려도 기록은 그대로');
});
test('분할매수 제목: 이름 끝 괄호는 꼬리표로 보이고 목록·자산 종목 이름은 그대로 둔다',()=>{
  const r=setup();r.item.name='테스트 종목(연저펀)';const before=JSON.stringify(r.doc);r.render();
  assert.match(r.html(),/<h1>테스트 종목 <span class="title-tag">연저펀<\/span><\/h1>/);
  assert.match(r.html(),/<strong>테스트 종목\(연저펀\)<\/strong>/,'목록 카드는 전체 이름');
  assert.equal(JSON.stringify(r.doc),before,'화면 표시만 바꾸고 기록은 그대로');
});
test('분할매수 제목·목록 카드·이름 창은 매수 우선순위 첫 종목(매수 반영 대상) 이름을 따르고 카드 이름·기록은 그대로 둔다',()=>{
  const r=setup();r.item.name='테스트 종목(연저펀)';const {move}=linkedAccounts(r);r.doc.allocation.groups[1].items[0].name='테스트 종목(ISA)';r.render();
  const card=()=>/data-purchase-select="a"[^>]*>(.*?)<\/button>/.exec(r.html())?.[1]||'';
  assert.match(r.html(),/<h1>테스트 종목 <span class="title-tag">연저펀<\/span><\/h1>/,'순서를 바꾸지 않으면 계획을 둔 종목');
  const items=()=>JSON.stringify(r.doc.allocation.groups.flatMap(g=>g.items.map(({buyPlan,...it})=>it))),before=items();move('b',-1);
  assert.match(r.html(),/<h1>테스트 종목 <span class="title-tag">ISA<\/span><\/h1>/,'매수 반영 대상이 바뀌면 제목도');
  assert.match(r.html(),/aria-label="테스트 종목\(ISA\) 분할매수 계획 수정"/);assert.match(card(),/<strong>테스트 종목\(ISA\)<\/strong>/,'목록 카드도 같은 이름');
  r.input('[data-purchase-rename]').onclick();assert.equal(r.names.at(-1).name,'테스트 종목(ISA)','이름 창의 기본 이름도 같은 종목');
  assert.equal(r.item.name,'테스트 종목(연저펀)');assert.equal(items(),before,'자산 종목 이름·보유량은 그대로');assert.deepEqual(Array.from(r.item.buyPlan.buyPriority),['b','a','c'],'저장은 화살표의 순서뿐');
  r.item.buyPlan.cardName='내 카드';r.render();assert.match(card(),/<strong>내 카드<\/strong>.*<span class="plan-title">테스트 종목\(ISA\)<\/span>/,'카드 이름이 있으면 아래 줄에 반영 대상 종목 이름');
  assert.match(r.html(),/<h1>테스트 종목 <span class="title-tag">ISA<\/span><\/h1>/,'제목은 카드 이름이 아니라 종목 이름');
  move('a',-1);delete r.item.buyPlan.cardName;r.render();assert.match(r.html(),/<h1>테스트 종목 <span class="title-tag">연저펀<\/span><\/h1>/,'화살표로 되돌리면 원래 종목');
});
test('분할매수 제목 아래 시세 줄: 현재가를 맨 앞에 두고 상태·완료/전체 회차·다음 기준까지 %를 방향과 함께 구분한다',()=>{
  const line=r=>(r.html().match(/<p class="quote-line">.*?<\/p>/)||[''])[0];
  assert.equal(line(setup({currency:'USD',price:57.61,ma:{'42일선':57.71,'60일선':57.2},names:['42일선','60일선'],end:null,budget:5000})),
    '<p class="quote-line"><strong class="quote-now">$57.61</strong><span class="quote-state">이동평균선 돌파</span><span class="quote-round"><b>0</b>/2회 분할매수</span><span class="quote-gap up">다음 42일선 1차까지 <b>+0.17%</b></span></p>');
  assert.equal(line(setup({manual:true,price:10500})),'<p class="quote-line"><strong class="quote-now">₩10500</strong><span class="quote-state">직접 입력</span><span class="quote-round"><b>0</b>/1회 분할매수</span></p>');
  assert.match(line(setup({legacy:true})),/<span class="quote-round"><b>1<\/b>\/1회 분할매수<\/span>/,'완료 회차 수는 목록 카드(1/1)와 같은 표기');
  const r=setup({manual:true,price:10500});
  r.item.buyPlan.stages=[{id:'s1',price:10000,shares:8,amount:8,done:true,actual:8},{id:'s2',price:10200,shares:3,plannedShares:8,amount:8.2,partial:true,actual:3.06},{id:'s3',price:10400,shares:8,amount:8.4}];r.render();
  assert.match(line(r),/<span class="quote-round"><b>1<\/b>\/3회 분할매수<span class="quote-sub"> · 부분 1<\/span><\/span>/,'부분 체결은 완료에 넣지 않고 개수만 덧붙임');
  assert.equal(line(setup({wait:'25선',ma:{'25선':9800}})),'<p class="quote-line"><strong class="quote-now">₩10000</strong><span class="quote-state">매수대기</span><span class="quote-round">25선까지 기다립니다.</span></p>');
});
test('분할매수 현재·목표·회차는 모든 계좌 기준으로 표시하고 계좌 변경 알림에도 갱신한다',()=>{
  const r=setup({budget:50,tracking:true});r.item.target=40;
  const other={id:'b',name:'같은 ETF의 다른 계좌',ticker:'A222222',amount:15};
  r.doc.allocation.groups.push({id:'g2',name:'다른 계좌',items:[other,{id:'x',name:r.item.name,ticker:'333333',amount:50}]});
  const before=JSON.stringify(r.doc);r.render();r.initialize();assert.equal(JSON.stringify(r.doc),before);
  assert.match(r.html(),/현재 25% \/ 목표 40% · 목표까지 15만원/);assert.doesNotMatch(r.html(),/<b>자산 배분<\/b>|전체 계좌 · 현재/,'제목 아래 줄은 꼬리표·계좌 글자 없이 현재 비중부터');assert.match(r.html(),/총 15만원/);assert.match(r.html(),/매수 15주/);
  other.amount=20;r.emit();assert.match(r.html(),/현재 30% \/ 목표 40% · 목표까지 10만원/);assert.match(r.html(),/매수 10주/);
  r.prices.stocks['222222'].close=20000;r.emit();assert.match(r.html(),/현재 40% \/ 목표 40% · 목표 도달<\/span>/);assert.equal(r.inputs('[data-purchase-buy]').length,0);assert.equal(r.rules().length,0);
  r.doc.allocation.total=200;r.emit();assert.match(r.html(),/현재 20% \/ 목표 40% · 목표까지 40만원/);assert.match(r.html(),/매수 20주/);assert.equal(r.item.buyPlan.lines.budget,50);
});
test('분할매수 계획 창의 기본 목표·다시 계산·미리보기는 전체 계좌 합을 쓰고 체결은 고른 계좌에만 반영한다',()=>{
  const r=setup({budget:50,tracking:true});r.doc.allocation.groups[0].target=40;
  const other={id:'b',ticker:'111111',tradeTicker:'222222',amount:15};r.doc.allocation.groups[0].items.push(other);
  r.initialize();r.edit();assert.equal(r.form.lineTarget.value,40,'자산 배분 그룹 목표를 읽기 전용으로 표시');assert.match(r.element('lineTargetNote').innerHTML,/그룹 목표.*assets\.html#alloc/);
  assert.match(r.element('purchasePicked').innerHTML,/선택 항목 10%.*전체 계좌 25%/);
  r.element('lineBudgetReset').onclick();assert.equal(r.form.lineBudget.value,15);assert.match(r.element('lineBudgetNote').textContent,/전체 계좌 보유 25만원/);assert.match(r.element('linePreview').innerHTML,/15주/);
  r.submit();assert.equal(r.item.buyPlan.lines.budget,15);r.change('[data-purchase-buy]',true);
  assert.equal(r.item.shares,25);assert.equal(other.amount,15);assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].id,'a');assert.match(r.html(),/현재 40% \/ 목표 40%/);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);assert.equal(other.amount,15);assert.match(r.html(),/현재 25%/);
});

test('자산 배분 목표 21%→21.5%: 분할매수 제목·총 매수 금액·회차·알림·계획 창이 함께 바뀌고 체결 기록은 그대로 둔다',()=>{
  const r=setup({budget:200,end:null,names:['25일선','32일선'],ma:{'25일선':10000,'32일선':20000}});
  r.doc.allocation.total=1000;r.item.target=21;r.item.buyPlan.lines.target=21;r.item.buyPlan.notify={stages:true};r.initialize();r.render();
  assert.match(r.html(),/현재 1% \/ 목표 21% · 목표까지 200만원/);assert.match(r.html(),/총 200만원/);
  const first=r.inputs('[data-purchase-buy-shares]')[0];first.value='10';first.onchange();assert.equal(r.item.shares,20);
  const buys=JSON.stringify(r.item.buyPlan.buys),trades=JSON.stringify(r.doc.allocation.trades),rules=r.rules().length,before=JSON.parse(JSON.stringify(r.doc.allocation));
  const open=()=>r.inputs('[data-purchase-buy-shares]').filter(x=>!x.attrs.value||x.attrs.value==='0').map(x=>Number(x.attrs.max)).reduce((n,v)=>n+v,0),planned=open();
  r.item.target=21.5;assert.deepEqual([...r.sync(before)],['a']);r.emit();
  assert.equal(r.item.buyPlan.lines.budget,205,'21.5% × 1,000만원 − 보유 20만원 + 체결 10만원');assert.equal(Object.hasOwn(r.item.buyPlan.lines,'target'),false);
  assert.match(r.html(),/현재 2% \/ 목표 21\.5% · 목표까지 195만원/);assert.match(r.html(),/총 205만원/);
  assert.ok(open()>planned,'미체결 회차 수량이 새 목표만큼 늘어남');assert.equal(r.rules().length,rules);
  assert.equal(JSON.stringify(r.item.buyPlan.buys),buys,'부분 체결 기록 유지');assert.equal(JSON.stringify(r.doc.allocation.trades),trades,'자산 반영 기록 유지');
  r.edit();assert.equal(r.form.lineTarget.value,21.5);assert.equal(r.form.lineBudget.value,205);assert.match(r.element('lineBudgetNote').textContent,/목표 21\.5%/);assert.doesNotMatch(r.element('lineBudgetNote').textContent,/직접 고친 금액/);
  r.submit();assert.equal(Object.hasOwn(r.item.buyPlan.lines,'target'),false,'계획 창 저장은 목표를 계획에 따로 저장하지 않음');assert.equal(r.item.buyPlan.lines.budget,205);assert.equal(JSON.stringify(r.item.buyPlan.buys),buys);
});
test('계획 창 목표는 자산 배분 목표를 읽기만 하고 옛 계획 목표는 자산 배분 목표가 없을 때만 유지한다',()=>{
  const r=setup({budget:50});r.item.buyPlan.lines.target=30;r.initialize();r.render();
  assert.match(r.html(),/목표 30% \(계획 목표\)/);
  r.edit();assert.equal(r.form.lineTarget.value,30);assert.match(r.element('lineTargetNote').innerHTML,/옛 목표/);r.submit();assert.equal(r.item.buyPlan.lines.target,30,'자산 배분 목표가 없으면 기존 목표 유지');
  r.item.target=25;r.render();assert.match(r.html(),/목표 25% · 목표까지/);assert.doesNotMatch(r.html(),/계획 목표/);
  r.edit();assert.equal(r.form.lineTarget.value,25);assert.match(r.element('lineTargetNote').innerHTML,/종목 목표.*분할매도·재매수와 함께/);
  assert.equal(r.form.lineBudget.value,50,'기존 계획의 저장 예산은 창을 열어도 바꾸지 않음');
  r.submit();assert.equal(Object.hasOwn(r.item.buyPlan.lines,'target'),false,'자산 배분 목표가 있으면 옛 목표를 지워 중복 저장을 없앰');assert.equal(r.item.buyPlan.lines.budget,50);
  delete r.item.target;r.edit();assert.equal(r.form.lineTarget.value,'');assert.match(r.element('lineTargetNote').innerHTML,/목표가 없습니다/);
});
test('계획 창을 연 동안 다른 탭에서 목표가 바뀌면 고치지 않은 총 매수 금액은 새 금액을 유지하고 직접 고친 금액은 저장한다',()=>{
  const r=setup({budget:200});r.doc.allocation.total=1000;r.item.target=21;r.initialize();r.render();
  r.edit();assert.equal(r.form.lineBudget.value,200);
  const before=JSON.parse(JSON.stringify(r.doc.allocation));r.item.target=21.5;r.sync(before);assert.equal(r.item.buyPlan.lines.budget,205);
  r.submit();assert.equal(r.item.buyPlan.lines.budget,205,'창에 남은 옛 금액으로 되돌리지 않음');
  r.edit();r.form.lineBudget.value='150';r.form.lineBudget.oninput();r.submit();assert.equal(r.item.buyPlan.lines.budget,150,'직접 고친 금액은 그대로 저장');
});
test('시작선 150시선: 앞선 시선은 제외하고 선택한 시선부터 3등분·수량·도달 알림을 만든다',()=>{
  const names=['25선','32선','42선','60선','80선','125선','150선','25일선','32일선'];
  const r=setup({names,end:null,budget:100,price:9000,ma:{'25선':8000,'125선':9000,'150선':10000,'25일선':13000,'32일선':16000}});
  r.edit();r.form.lineSet.value='all';r.form.lineStartPeriod.value='150';r.form.lineStartUnit.value='선';r.form.lineLastPeriod.value='32';r.form.lineLastUnit.value='일선';r.submit();
  assert.equal(r.item.buyPlan.lines.startLine,'150선');
  assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['150선','25일선','32일선']);
  assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),['150선:0','150선:1','150선:2','25일선:0','25일선:1','25일선:2','32일선:0']);
  assert.match(r.html(),/시작 150시선/);assert.match(r.html(),/150선~32일선까지 매수/);assert.doesNotMatch(r.html(),/매수 0주|25선<span|125선<span/);
  r.item.buyPlan.notify={stages:true};const rules=r.rules();assert.equal(rules[0].targetPrice,10000);assert.equal(rules[1].targetPrice,11000);assert.equal(rules[2].targetPrice,12000);assert.equal(rules.length,7);
  r.edit();assert.equal(r.form.lineStartPeriod.value,150);assert.equal(r.form.lineStartUnit.value,'선');assert.equal(r.form.lineLastPeriod.value,32);assert.equal(r.form.lineLastUnit.value,'일선');
  const before=JSON.stringify(r.item.buyPlan);r.submit();assert.equal(JSON.stringify(r.item.buyPlan),before);
});

test('시작선: 시·일·주·월마다 1~400 기간을 선택하고 기본 목록에 없는 기간도 종목에 저장한다',()=>{
  for(const [unit,set] of [['선','hour'],['일선','day'],['주선','week'],['개월선','month']])for(const period of [1,20,150,400]){
    const r=setup({names:[`25${unit}`,`32${unit}`],end:null,budget:100,ma:{[`150${unit}`]:10000,[`${period}${unit}`]:9000}});
    r.edit();r.form.lineSet.value=set;r.form.lineStartPeriod.value=String(period);r.form.lineStartUnit.value=unit;r.form.lineLastPeriod.value=String(Math.max(150,period));r.form.lineLastUnit.value=unit;r.submit();
    assert.equal(r.alerts.length,0);assert.equal(r.item.buyPlan.lines.names[0],`${period}${unit}`);
    assert.ok(r.item.buyPlan.lines.names.every(n=>parseInt(n)>=period));
    assert.ok(r.inputs('[data-purchase-buy]').length>0);
    r.edit();assert.equal(r.form.lineSet.value,set);assert.equal(r.form.lineStartPeriod.value,period);assert.equal(r.form.lineStartUnit.value,unit);
  }
});

test('시작선 변경: 완료·부분 체결 가격과 수량·잔량·자산 반영 기록을 보존하고 다른 종목은 바꾸지 않는다',()=>{
  const r=setup({names:['25선','32선','150선'],end:null,budget:100,price:9000,ma:{'25선':10000,'32선':13000,'150선':16000}});
  const other={id:'b',name:'다른 종목',ticker:'222222',shares:3,buyPlan:{lines:{names:['25주선','32주선'],budget:10}}};r.doc.allocation.groups[0].items.push(other);
  r.change('[data-purchase-buy-shares]',7);
  const complete=r.inputs('[data-purchase-buy]').find(x=>x.dataset.key==='32선:0');complete.checked=true;complete.onchange();
  const before=JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares,other});
  r.edit();r.form.lineSet.value='hour';r.form.lineStartPeriod.value='150';r.form.lineStartUnit.value='선';r.form.lineLastPeriod.value='150';r.form.lineLastUnit.value='선';r.submit();
  assert.equal(JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares,other}),before);
  const keys=r.inputs('[data-purchase-buy]').map(x=>x.dataset.key);assert.deepEqual(keys,['150선:0','25선:0','32선:0']);
  assert.match(r.html(),/부분 체결/);assert.match(r.html(),/진행 중/);assert.match(r.html(),/매수 완료 <b>1회/);
  r.edit();r.form.lineStartPeriod.value='25';r.submit();
  assert.equal(JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares,other}),before);
  assert.equal(r.inputs('[data-purchase-buy]').filter(x=>x.dataset.key==='25선:0').length,1);
});

test('시작선 시세 대기: 목표가가 있어도 새 매수·알림을 만들지 않고 기존 체결만 유지한다',()=>{
  const r=setup({names:['25선','150선'],budget:100,end:20000,ma:{'25선':10000}});
  r.change('[data-purchase-buy-shares]',7);const before=JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares});
  r.edit();r.form.lineSet.value='hour';r.form.lineStartPeriod.value='150';r.form.lineStartUnit.value='선';r.submit();
  assert.equal(r.inputs('[data-purchase-buy]').length,1);assert.match(r.html(),/매수 시작 이동평균선 150시선의 시세를 기다리는 중/);
  assert.equal(JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares}),before);
  r.prices.stocks['111111'].ma['150선']=16000;r.render();assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),['150선:0','25선:0','end']);
});

test('잘못된 시작선 기간은 저장하지 않고 기존 계획·체결을 보존한다',()=>{
  for(const value of ['', '0','401','1.5']){
    const r=setup(),before=JSON.stringify(r.doc);r.edit();r.form.lineStartPeriod.value=value;r.submit();
    assert.equal(JSON.stringify(r.doc),before);assert.match(r.alerts[0],/1~400의 정수/);
  }
});

test('마지막 매수선 직접 입력: 기본 목록에 없는 40일선까지 계획·수량·알림을 만들고 다시 열어 유지한다',()=>{
  const r=setup({names:['25일선','32일선'],end:null,budget:100,price:9000,ma:{'25일선':10000,'32일선':13000,'40일선':16000,'42일선':19000}});
  r.edit();r.form.lineLastPeriod.value='40';r.form.lineLastUnit.value='일선';r.submit();
  assert.equal(r.alerts.length,0);assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['25일선','32일선','40일선']);
  assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),['25일선:0','25일선:1','25일선:2','32일선:0','32일선:1','32일선:2','40일선:0']);
  assert.match(r.html(),/25일선~40일선까지 매수/);assert.doesNotMatch(r.html(),/42일선<span|매수 0주/);
  r.item.buyPlan.notify={stages:true};assert.equal(r.rules().length,7);assert.equal(r.rules().at(-1).targetPrice,16000);
  r.edit();assert.equal(r.form.lineLastPeriod.value,40);assert.equal(r.form.lineLastUnit.value,'일선');assert.equal(r.form.lineSet.value,'day');
  const before=JSON.stringify(r.item.buyPlan);r.submit();assert.equal(JSON.stringify(r.item.buyPlan),before);
  r.edit();r.form.lineLastPeriod.value='60';r.prices.stocks['111111'].ma['60일선']=22000;r.submit();
  assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['25일선','32일선','42일선','60일선'],'종료선을 늘리면 기존 단계 묶음의 중간선도 포함');
});

test('마지막 매수선: 시·일·주·월 모두 1~400 직접 입력과 시작·종료 동일 선을 지원한다',()=>{
  for(const [unit,set] of [['선','hour'],['일선','day'],['주선','week'],['개월선','month']])for(const period of [1,20,150,400]){
    const r=setup({names:[`1${unit}`],end:null,budget:50,price:9000,ma:{[`1${unit}`]:10000,[`${period}${unit}`]:13000}});
    r.edit();r.form.lineSet.value=set;r.form.lineLastPeriod.value=String(period);r.form.lineLastUnit.value=unit;r.submit();
    assert.equal(r.alerts.length,0);assert.equal(r.item.buyPlan.lines.names.at(-1),`${period}${unit}`);
    assert.ok(r.item.buyPlan.lines.names.every(n=>parseInt(n)<=period));
    assert.equal(r.inputs('[data-purchase-buy]').at(-1).dataset.key,`${period}${unit}:0`);
    if(period===1)assert.equal(r.inputs('[data-purchase-buy]').length,1);
    r.edit();assert.equal(r.form.lineLastPeriod.value,period);assert.equal(r.form.lineLastUnit.value,unit);
  }
});

test('마지막 매수선은 단계 묶음 밖의 단위도 종료점으로 포함하고 150시선부터 해당 선까지 계산한다',()=>{
  const r=setup({names:['25선','150선'],end:null,budget:100,price:9000,ma:{'150선':10000,'20일선':13000,'25일선':16000}});
  r.edit();r.form.lineSet.value='hour';r.form.lineStartPeriod.value='150';r.form.lineLastPeriod.value='20';r.form.lineLastUnit.value='일선';r.submit();
  assert.equal(r.alerts.length,0);assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['150선','20일선']);
  assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),['150선:0','150선:1','150선:2','20일선:0']);
});

test('종료선 변경: 완료·부분 체결·잔량·자산·다른 종목 기록을 유지하고 종료선 시세가 없으면 기다린다',()=>{
  const r=setup({names:['25일선','32일선','42일선'],end:null,budget:100,price:9000,ma:{'25일선':10000,'32일선':13000,'42일선':16000}});
  r.change('[data-purchase-buy-shares]',7);const complete=r.inputs('[data-purchase-buy]').find(x=>x.dataset.key==='32일선:0');complete.checked=true;complete.onchange();
  const other={id:'b',name:'다른 종목',ticker:'222222',shares:5,buyPlan:{lines:{names:['25개월선','32개월선'],budget:10}}};r.doc.allocation.groups[0].items.push(other);
  const before=JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares,other});
  r.edit();r.form.lineLastPeriod.value='40';r.submit();
  assert.equal(JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares,other}),before);
  assert.match(r.html(),/마지막 매수 평균선 40일선의 시세를 기다리는 중/);assert.match(r.html(),/부분 체결/);
  assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),['25일선:0','32일선:0']);
  r.prices.stocks['111111'].ma['40일선']=15000;r.render();assert.ok(r.inputs('[data-purchase-buy]').some(x=>x.dataset.key==='40일선:0'));
  r.edit();r.form.lineLastPeriod.value='25';r.submit();
  assert.equal(JSON.stringify({buys:r.item.buyPlan.buys,trades:r.doc.allocation.trades,shares:r.item.shares,other}),before);
  assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['25일선']);
});

test('잘못된 종료선 기간·시작선보다 앞선 종료선은 저장하지 않으며 목표 가격 방식에서는 종료선 입력을 쓰지 않는다',()=>{
  for(const value of ['', '0','401','1.5']){
    const r=setup({names:['25일선','32일선'],end:null}),before=JSON.stringify(r.doc);r.edit();r.form.lineLastPeriod.value=value;r.submit();
    assert.equal(JSON.stringify(r.doc),before);assert.match(r.alerts[0],/마지막 매수 평균선 기간은 1~400/);
  }
  for(const [period,unit] of [['20','일선'],['400','선']]){
    const r=setup({names:['25일선','32일선'],end:null}),before=JSON.stringify(r.doc);r.edit();r.form.lineLastPeriod.value=period;r.form.lineLastUnit.value=unit;r.submit();
    assert.equal(JSON.stringify(r.doc),before);assert.match(r.alerts[0],/시작선과 같거나 뒤/);
  }
  const r=setup({names:['25일선','32일선']}),before=JSON.stringify(r.item.buyPlan);r.edit();r.form.lineLastPeriod.value='';r.submit();
  assert.equal(r.alerts.length,0);assert.equal(JSON.stringify(r.item.buyPlan),before);
});

test('계획 목록: 선택한 계획만 표시하고 체결은 그 종목에만 반영하며 선택·새로 그리기는 기록을 바꾸지 않는다',()=>{
  const r=setup(),other={id:'b',name:'다른 종목',ticker:'222222',shares:3,buyPlan:{lines:{names:['25선'],end:10000,budget:5}}};
  r.doc.allocation.groups.push({id:'g2',name:'다른 계좌',items:[other]});r.prices.stocks['222222']={kind:'국내',close:10000,asOf:'2026-01-02'};
  const before=JSON.stringify(r.doc);r.render();
  assert.equal(r.inputs('[data-purchase-select]').length,2);assert.match(r.html(),/data-purchase-item="a"/);assert.doesNotMatch(r.html(),/data-purchase-item="b"/);
  r.inputs('[data-purchase-select]').find(x=>x.dataset.purchaseSelect==='b').onclick();
  assert.match(r.html(),/data-purchase-item="b"/);assert.doesNotMatch(r.html(),/data-purchase-item="a"/);assert.equal(JSON.stringify(r.doc),before);
  assert.equal(r.inputs('[data-purchase-select]').find(x=>x.dataset.purchaseSelect==='b').attrs['aria-pressed'],'true');
  r.change('[data-purchase-buy-shares]',2);assert.equal(other.shares,5);assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);
  r.render();assert.match(r.html(),/data-purchase-item="b"/);assert.match(r.html(),/부분 체결/);
  delete other.buyPlan;r.render();assert.match(r.html(),/data-purchase-item="a"/);assert.doesNotMatch(r.html(),/data-purchase-item="b"/);
  delete r.item.buyPlan;r.render();assert.match(r.html(),/계획 없음/);assert.match(r.html(),/아직 분할매수 계획이 없습니다/);
  r.doc.allocation.groups=[];r.render();assert.match(r.html(),/분할매수할 종목을 추가하세요/);assert.match(r.html(),/id="addPurchase"/);
});

test('계획 진행 카드: 다음 회차 칸 앞에 현재가 이름표를 두고 양 끝은 기준가와 선 이름만, 도달 회차는 칩·안내로 표시한다',()=>{
  // 25일선 3회(10000·12000·14000) + 32일선 1회(16000)
  const card=r=>{const html=r.html();return html.slice(html.indexOf('<section class="card buy-track'),html.indexOf('<div class="control-grid">'));};
  const r=setup({budget:100,end:null,names:['25일선','32일선'],price:9000,ma:{'25일선':10000,'32일선':16000}});
  assert.match(card(r),/<div class="buy-track-cells with-now"[^>]*><em class="buy-track-now left"><span>현재 <b>₩9000<\/b><\/span><\/em><i class="next"><\/i><i class="wait"><\/i><i class="wait"><\/i><i class="wait"><\/i><\/div>/);
  assert.match(card(r),/<div class="buy-track-end"><b>₩10000<\/b><small>25일선<\/small><\/div>/);
  assert.match(card(r),/<div class="buy-track-end r"><b>₩16000<\/b><small>32일선<\/small><\/div>/);
  assert.match(card(r),trackStatus('매수 전',0,4));assert.doesNotMatch(card(r),/buy-track-note/);
  const before=JSON.stringify(r.doc);r.prices.stocks['111111'].close=12500;r.render();
  assert.match(card(r),/<i class="due"><\/i><i class="due"><\/i><em class="buy-track-now mid"><span>현재 <b>₩12500<\/b><\/span><\/em><i class="next"><\/i><i class="wait"><\/i>/);
  assert.match(card(r),/<span class="buy-track-chip warn">도달 2회<\/span>/);
  assert.match(card(r),/<p class="buy-track-note">25일선 1차·2차 기준가 도달/);
  assert.match(card(r),/<span class="next">다음 25일선 3차 <b>₩14000<\/b><em class="up">\+12%<\/em><\/span>/);
  assert.equal(JSON.stringify(r.doc),before,'화면 표시만 하고 기록은 바꾸지 않는다');
  r.change('[data-purchase-buy-shares]',1);
  assert.match(card(r),/<span class="buy-track-chip warn">도달 1회<\/span><span class="buy-track-chip warn">부분 체결 1회<\/span>/,'부분 체결 회차는 도달 수에 다시 세지 않는다');
  assert.match(card(r),/<i class="partial"><\/i><i class="due"><\/i><em class="buy-track-now mid">/);
  assert.match(card(r),/<p class="buy-track-note">25일선 1차 부분 체결 · 1주 체결, \d+주 남음<\/p>/);
});
test('계획 목록: 매수대기의 시세 대기·도달 상태를 표시하고 회차 수를 만들지 않는다',()=>{
  const r=setup({wait:'25일선',ma:{'25일선':10000}});
  const progress=()=>r.html().match(/<span class="plan-count[^"]*">(.*?)<\/span>/)[1];
  assert.equal(progress(),'도달');r.prices.stocks['111111'].close=11000;r.render();assert.equal(progress(),'대기');
  delete r.prices.stocks['111111'].ma;r.render();assert.equal(progress(),'시세 대기');assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);
});

test('분할매수 시세 대기에도 전체 알림을 켜 두면 시세 도착 후 같은 회차에 적용한다',()=>{
  const r=setup({end:null,names:['25일선','32일선']});
  assert.equal(r.inputs('[data-purchase-buy]').length,0);assert.equal(r.rules().length,0);
  const on=r.inputs('[data-purchase-alert-all]').find(x=>x.dataset.on==='on');assert.ok(on);on.onclick();
  assert.equal(r.item.buyPlan.notify.stages,true);assert.equal(r.rules().length,0);assert.equal(r.item.shares,10);
  r.prices.stocks['111111'].ma={'25일선':10000,'32일선':11000};r.render();
  assert.ok(r.inputs('[data-purchase-buy]').length>0);assert.equal(r.rules().length,r.inputs('[data-purchase-buy]').length);
  assert.equal(r.item.buyPlan.buys,undefined);assert.equal(r.doc.allocation.trades,undefined);
  r.inputs('[data-purchase-alert-all]').find(x=>x.dataset.on==='off').onclick();assert.equal(r.rules().length,0);
});

test('매수대기: 선 위에서 기다리고 선에 닿거나 내려가면 도달하며 보유량·체결 회차는 바꾸지 않는다',()=>{
  const r=setup({currency:'USD',wait:'25개월선',price:110,ma:{'25개월선':100}}),before=JSON.stringify(r.doc);
  assert.match(r.html(),/매수대기/);assert.match(r.html(),/기준선 위/);assert.doesNotMatch(r.html(),/기준선 도달/);
  assert.equal(r.input('[data-purchase-buy]'),undefined);assert.equal(r.input('[data-purchase-shares]'),undefined);
  assert.equal(r.rules()[0].label,'매수대기 25개월선');assert.equal(r.rules()[0].condition,'down');assert.equal(r.rules()[0].targetPrice,100);
  for(const close of [100,90]){r.prices.stocks.AAA.close=close;r.render();assert.match(r.html(),/기준선 도달/);}
  assert.equal(JSON.stringify(r.doc),before);assert.equal(r.item.shares,10);
  r.change('[data-purchase-alert]',false);assert.equal(r.rules().length,0);assert.equal(r.item.buyPlan.notify.keys.wait,false);
  r.change('[data-purchase-alert]',true);assert.equal(r.rules().length,1);
});

test('매수대기: 이동평균 시세가 없으면 도달·알림을 만들지 않으며 새 선 값은 같은 알림을 갱신한다',()=>{
  const r=setup({wait:'25개월선'});assert.match(r.html(),/시세 대기/);assert.equal(r.rules().length,0);
  r.prices.stocks['111111'].ma={'25개월선':9000};r.render();const first=r.rules()[0];
  r.prices.stocks['111111'].ma['25개월선']=9500;r.render();assert.equal(r.rules()[0].targetPrice,9500);assert.equal(r.rules()[0].revision,first.revision);
  r.item.buyPlan.wait.line='60일선';r.prices.stocks['111111'].ma['60일선']=9500;r.render();assert.notEqual(r.rules()[0].revision,first.revision);
  r.prices.stocks['111111'].kind='해외';r.render();assert.equal(r.rules().length,0);assert.doesNotMatch(r.html(),/기준선 도달/);
});

test('분할매수 설정: 기존 목표 가격 계획의 사용자 지정 단계는 다시 저장해도 늘리지 않는다',()=>{
  const r=setup({names:['25일선','32일선']}),before=JSON.stringify(r.item.buyPlan);
  r.edit();assert.equal(r.form.lineSet.value,'custom');assert.equal(JSON.stringify(r.item.buyPlan),before);
  r.submit();assert.equal(JSON.stringify(r.item.buyPlan),before);
});

test('기존 사용자 지정 단계의 순서와 짧아지는 기간도 시작선을 그대로 두면 변경하지 않는다',()=>{
  const r=setup({names:['60일선','25일선','150선']}),before=JSON.stringify(r.item.buyPlan);
  r.edit();assert.equal(r.form.lineSet.value,'custom');r.submit();assert.equal(JSON.stringify(r.item.buyPlan),before);
});

test('분할매수 설정: 목표 가격을 비우면 필드를 지우고 종료 평균선만 저장하며 기존 부분 체결은 유지한다',()=>{
  const r=setup({budget:50,price:14000,names:['25선','32선'],ma:{'25선':10000,'32선':13000}});
  r.change('[data-purchase-buy-shares]',7);const record=JSON.stringify(r.item.buyPlan.buys);
  r.edit();r.form.lineEnd.value='';r.form.lineLastPeriod.value='32';r.form.lineLastUnit.value='선';r.submit();
  assert.equal(Object.hasOwn(r.item.buyPlan.lines,'end'),false);assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['25선','32선']);
  assert.equal(JSON.stringify(r.item.buyPlan.buys),record);assert.equal(r.item.shares,17);assert.match(r.html(),/남은 매수 3주/);
});

test('분할매수 설정: 목표 가격 없는 계획을 다시 열어 종료선을 늘리거나 목표 가격을 넣을 수 있다',()=>{
  const r=setup({end:null,names:['25일선','32일선'],ma:{'25일선':10000,'32일선':13000,'42일선':16000}}),before=JSON.stringify(r.item.buyPlan);
  r.edit();assert.equal(r.form.lineEnd.value,'');assert.equal(r.form.lineLastPeriod.value,32);assert.equal(r.form.lineLastUnit.value,'일선');assert.equal(r.form.lineSet.value,'day');
  assert.equal(JSON.stringify(r.item.buyPlan),before);
  r.form.lineLastPeriod.value='42';r.form.lineLastUnit.value='일선';r.submit();assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['25일선','32일선','42일선']);
  r.edit();r.form.lineEnd.value='18000';r.submit();assert.equal(r.item.buyPlan.lines.end,18000);assert.match(r.html(),/목표가/);
});

test('목표 가격 없는 분할매수: 마지막 평균선까지 표시하고 순차 체결·추가·취소를 자산에 반영한다',()=>{
  const r=setup({end:null,budget:40,price:9000,names:['25일선','32일선'],ma:{'25일선':10000,'32일선':13000}});
  assert.match(r.html(),/25일선~32일선까지 매수/);assert.doesNotMatch(r.html(),/목표가|NaN|undefined/);
  assert.equal(r.inputs('[data-purchase-buy]').length,4);
  r.change('[data-purchase-buy-shares]',7);assert.equal(r.item.shares,17);assert.match(r.html(),/남은 매수 3주/);
  r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,20);
  for(let i=0;i<3;i++){
    const input=r.inputs('[data-purchase-buy]').find(x=>!x.checked);assert.ok(input);input.checked=true;input.onchange();
  }
  assert.match(r.html(),trackStatus('매수 완료',4,4));assert.equal(r.item.shares,45);
  assert.equal(r.item.buyPlan.buys['32일선:0'].shares,8,'앞 회차의 내림 잔액도 마지막 선 예산에 배분');
  assert.equal(r.item.buyPlan.lines.end,undefined);
  for(let i=0;i<4;i++){const input=r.inputs('[data-purchase-buy]').find(x=>x.checked);input.checked=false;input.onchange();}
  assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);assert.equal(r.doc.allocation.trades,undefined);
});

test('목표 가격 없는 분할매수: 마지막 선의 시세를 기다리는 동안 목표가나 체결 회차를 만들지 않는다',()=>{
  const r=setup({end:null,budget:40,names:['25일선','32일선'],ma:{'25일선':10000}});
  assert.match(r.html(),/마지막 매수 평균선 32일선의 시세를 기다리는 중/);
  assert.doesNotMatch(r.html(),/목표가|NaN|남은 매수 0주/);assert.equal(r.inputs('[data-purchase-buy]').length,0);
  assert.equal(r.item.buyPlan.lines.end,undefined);assert.equal(r.item.shares,10);
  r.prices.stocks['111111'].ma['32일선']=13000;r.render();assert.equal(r.inputs('[data-purchase-buy]').length,4);
});

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
  r.item.buyPlan.notify={stages:true};assert.equal(r.rules().length,0,'총예산으로도 살 수 없는 회차는 매수 알림을 보내지 않는다');
});

test('고가주 분할매수: 회차·미리보기·합계·알림을 종료선까지 분산하고 순차 체결·취소에도 같은 간격을 유지한다',()=>{
  const names=['25일선','32일선','42일선','60일선','80일선'];
  for(const currency of ['KRW','USD']){
    const scale=currency==='KRW'?100000:100,ma=Object.fromEntries(names.map((n,i)=>[n,(i+1)*scale]));
    const r=setup({currency,end:null,budget:150,price:scale*.8,names,ma});r.item.buyPlan.notify={stages:true};r.render();
    const keys=names.map(n=>`${n}:0`),before=JSON.stringify(r.doc);
    assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),keys);
    assert.equal(r.rules().length,5);assert.match(r.html(),trackStatus('매수 전',0,5));assert.match(r.html(),/남은 <b>5주<\/b>/);
    assert.doesNotMatch(r.html(),/· 매수 0주|1주를 살 수 없습니다/);assert.match(r.html(),/회차 간격을 넓혀/);
    r.edit();assert.equal(JSON.stringify(r.doc),before,'미리보기만으로 기록을 바꾸지 않는다');
    assert.equal((r.html().match(/매수 1주/g)||[]).length,5);
    for(let i=0;i<keys.length;i++){
      const input=r.inputs('[data-purchase-buy]').find(x=>!x.checked);assert.equal(input.dataset.key,keys[i]);
      input.checked=true;input.onchange();
      assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),keys);
      assert.equal(r.item.shares,11+i);assert.equal(r.rules().length,4-i);
      assert.doesNotMatch(r.html(),/· 매수 0주|1주를 살 수 없습니다/);
    }
    assert.match(r.html(),trackStatus('매수 완료',5,5));
    for(let i=0;i<keys.length;i++){const input=r.inputs('[data-purchase-buy]').find(x=>x.checked);input.checked=false;input.onchange();}
    assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);assert.equal(r.doc.allocation.trades,undefined);
    assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),keys);
  }
});

test('고가주 분할매수: 총예산이 모든 회차의 1주 가격 합계이면 회차를 줄이지 않는다',()=>{
  const r=setup({end:null,budget:100,price:90000,names:['25일선','32일선'],ma:{'25일선':100000,'32일선':400000}});
  assert.equal(r.inputs('[data-purchase-buy]').length,4);assert.ok(r.inputs('[data-purchase-buy]').every(x=>!x.disabled));
  assert.equal((r.html().match(/매수 1주/g)||[]).length,4);assert.match(r.html(),/회당 10만원~40만원/);
  assert.doesNotMatch(r.html(),/매수 0주|회차 간격을 넓혀/);
});

test('추종 ETF 분할매수: 기준 가격이 아닌 실제 ETF 가격으로 회차 수를 정하고 알림도 같은 회차만 사용한다',()=>{
  const names=['25일선','32일선','42일선','60일선','80일선'],ma=Object.fromEntries(names.map((n,i)=>[n,(i+1)*10]));
  for(const trackingCurrency of ['KRW','USD']){
    const r=setup({currency:'USD',tracking:true,trackingCurrency,trackingPrice:trackingCurrency==='KRW'?300000:300,end:null,budget:150,price:8,names,ma});
    r.item.buyPlan.notify={stages:true};r.render();
    const keys=names.map(n=>`${n}:0`);
    assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),keys);assert.equal(r.rules().length,5);
    assert.ok(r.inputs('[data-purchase-buy]').every(x=>!x.disabled));assert.match(r.html(),/남은 <b>5주<\/b>/);
    r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,11);assert.equal(r.item.buyPlan.buys[keys[0]].actual,30);
    assert.deepEqual(r.inputs('[data-purchase-buy]').map(x=>x.dataset.key),keys);assert.equal(r.rules().length,4);
    r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);
  }
});

test('고가주 분할매수: 예산을 줄여 회차 간격을 넓혀도 부분 체결의 원래 3주와 잔량 2주를 유지한다',()=>{
  const names=['25일선','32일선','42일선','60일선','80일선'],ma=Object.fromEntries(names.map((n,i)=>[n,(i+1)*100000]));
  const r=setup({end:null,budget:500,price:80000,names,ma});r.change('[data-purchase-buy-shares]',1);
  assert.equal(r.item.buyPlan.buys['25일선:0'].plannedShares,3);assert.equal(r.item.shares,11);
  r.item.buyPlan.lines.budget=150;r.render();
  assert.match(r.html(),/부분 체결 · 체결 1주 · 남은 매수 2주/);
  assert.equal(r.item.buyPlan.buys['25일선:0'].price,100000);assert.equal(r.item.buyPlan.buys['25일선:0'].plannedActual,30);
  assert.equal(r.inputs('[data-purchase-buy]').at(-1).dataset.key,'80일선:0');assert.doesNotMatch(r.html(),/· 매수 0주|1주를 살 수 없습니다/);
  r.change('[data-purchase-buy-shares]',3);assert.equal(r.item.shares,13);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);
});

test('추종 ETF 분할매수: 부분 체결 뒤 실제 ETF 가격이 급등해도 고정 잔량과 켜 둔 알림을 보존한다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  r.item.buyPlan.notify={stages:true};r.change('[data-purchase-buy-shares]',70);
  r.prices.stocks['222222'].close=1000000;r.render();
  assert.match(r.html(),/부분 체결 · 체결 70주 · 남은 매수 20주/);assert.equal(r.item.shares,80);
  assert.equal(r.item.buyPlan.buys.end.tradePrice,15000);assert.equal(r.rules().length,1,'이미 고정한 부분 체결의 알림은 현재 ETF 가격과 무관하게 유지');
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
    assert.match(r.html(),trackStatus('진행 중',0,1));
    assert.equal(r.input('[data-purchase-buy]').checked,false);assert.equal(r.input('[data-purchase-buy]').indeterminate,true);
    r.change('[data-purchase-buy-shares]',9);assert.equal(r.item.shares,19,'추가 2주만 반영');
    assert.match(r.html(),/남은 매수 1주/);
    r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,20,'마지막 1주만 반영');
    assert.equal(r.input('[data-purchase-buy]').checked,true);assert.match(r.html(),trackStatus('매수 완료',1,1));
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

test('직접 입력 매수: 기준가가 없으면 체결을 막고 기존 체결 취소는 허용한다',()=>{
  for(const price of [null,0]){
    const r=setup({manual:true,manualShares:10,manualAmount:10});r.item.buyPlan.stages[0].price=price;r.render();
    assert.equal(r.input('[data-purchase-done]').disabled,true);assert.equal(r.input('[data-purchase-shares]').disabled,true);
    const before=JSON.stringify(r.doc);r.change('[data-purchase-done]',true);r.change('[data-purchase-shares]',7);
    assert.equal(JSON.stringify(r.doc),before);assert.match(r.html(),/기준가 대기/);
  }
  const r=setup({manual:true,manualShares:10,manualAmount:10});r.change('[data-purchase-shares]',7);
  delete r.item.buyPlan.stages[0].price;r.render();r.change('[data-purchase-shares]',0);
  assert.equal(r.item.shares,10);assert.equal(r.doc.allocation.trades,undefined);assert.equal(r.item.buyPlan.stages[0].partial,undefined);
});

test('직접 입력 매수: 예정액이 없으면 가격·수량·환율로 체결 금액을 계산하고 환율이 없으면 보유량을 바꾸지 않는다',()=>{
  for(const currency of ['KRW','USD'])for(const amount of [null,0]){
    const r=setup({currency,manual:true,price:currency==='USD'?10:10000,manualShares:10,manualAmount:amount});
    r.change('[data-purchase-shares]',7);assert.equal(r.item.shares,17);assert.equal(r.item.buyPlan.stages[0].actual,7);
    assert.match(r.html(),/남은 매수 3주/);r.change('[data-purchase-done]',true);assert.equal(r.item.buyPlan.stages[0].actual,10);
    r.change('[data-purchase-done]',false);assert.equal(r.item.shares,10);assert.equal(r.doc.allocation.trades,undefined);
  }
  const r=setup({currency:'USD',manual:true,manualShares:10,manualAmount:null,fx:null});
  assert.equal(r.input('[data-purchase-shares]').disabled,true);assert.match(r.html(),/원\/달러 환율/);
  const before=JSON.stringify(r.doc);r.change('[data-purchase-shares]',7);r.change('[data-purchase-done]',true);assert.equal(JSON.stringify(r.doc),before);
});

test('매수 수량을 계산할 수 없으면 직접 핸들러를 호출해도 체결하지 않고 수량 없는 옛 기록도 0으로 취소한다',()=>{
  const r=setup({currency:'USD',price:100,tracking:true,missingTracking:true});const before=JSON.stringify(r.doc);
  r.change('[data-purchase-buy]',true);assert.equal(JSON.stringify(r.doc),before);
  r.item.buyPlan.buys={end:{actual:8.9,price:100}};r.render();
  assert.match(r.html(),/체결 수량 미입력/);r.change('[data-purchase-buy-shares]',0);
  assert.equal(r.item.buyPlan.buys,undefined);assert.equal(r.item.shares,10);assert.equal(r.doc.allocation.trades,undefined);
});

test('미국 ETF 추종: 실제 ETF 90주를 표시하고 부분 체결·추가 체결·취소에 같은 단위를 쓴다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  assert.match(r.html(),/매수 90주/);assert.match(r.html(),/222222 · 예상 ₩1350000/);assert.match(r.html(),/잔액 ₩0/);
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
  assert.match(manualPrice.html(),/매수 81주/);manualPrice.edit();assert.match(manualPrice.element('purchaseTrackingInfo').innerHTML,/현재가 ₩12300 <small[^>]*>직접 입력/);
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

test('추종 ETF: 같은 이름·코드의 기존 보유 계좌가 여럿이어도 계획에서 고른 항목에만 체결·추가·취소한다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  const other={id:'b',name:r.item.name,ticker:'AAA',tradeTicker:'222222',shares:20},direct={id:'c',name:'같은 ETF 직접 보유',ticker:'222222',shares:30},source={id:'ref',name:'기준 미국 ETF',ticker:'AAA',shares:5};
  r.doc.allocation.groups.push({id:'other',name:'다른 계좌',items:[other,direct,source]});
  const before=JSON.stringify(r.doc);r.render();assert.equal(JSON.stringify(r.doc),before,'대상 표시만으로 기존 보유 기록을 바꾸지 않음');
  r.edit();const target=()=>r.element('purchaseTargetInfo').innerHTML;
  assert.match(target(),/매수 반영 대상<\/b> 자산 배분 › 테스트 계좌 › 테스트 종목/);assert.match(target(),/현재 보유 <b[^>]*>10주<\/b> · 체결 주수를 더합니다/);
  r.change('[data-purchase-buy-shares]',60);
  assert.equal(r.item.shares,70);assert.deepEqual([other.shares,direct.shares,source.shares],[20,30,5]);
  assert.equal(r.doc.allocation.trades['buy:a:end'].items.length,1);assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].id,'a');
  r.item.name='바뀐 종목 이름';r.doc.allocation.groups[0].items=[];r.doc.allocation.groups[1].items.push(r.item);r.render();
  r.edit();assert.match(target(),/매수 반영 대상<\/b> 자산 배분 › 다른 계좌 › 바뀐 종목 이름/);
  r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,100);assert.deepEqual([other.shares,direct.shares,source.shares],[20,30,5]);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);assert.deepEqual([other.shares,direct.shares,source.shares],[20,30,5]);assert.equal(r.doc.allocation.trades,undefined);
});

test('추종 ETF: 금액으로 관리하는 기존 항목은 평가액을 표시하고 체결 금액만 더했다가 복원한다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  delete r.item.shares;r.item.amount=100;r.item.base=15000;r.render();
  r.edit();assert.match(r.element('purchaseTargetInfo').innerHTML,/현재 평가액 <b>100만원<\/b> · 체결 금액을 더합니다/);
  r.change('[data-purchase-buy-shares]',60);assert.equal(r.item.amount,190);assert.equal(r.item.shares,undefined);
  assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].amount,90);
  r.change('[data-purchase-buy]',true);assert.equal(r.item.amount,235);assert.equal(r.item.base,15000);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.amount,100);assert.equal(r.item.shares,undefined);
});
