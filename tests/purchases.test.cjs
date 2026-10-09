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
  const purchaseForm=document.getElementById('purchaseForm');
  for(const name of ['item','mode','waitPeriod','waitUnit','waitNotify','lineSet','lineTarget','lineEnd','lineEndLine','lineBudget','manualCurrency','note'])purchaseForm[name]=element();
  const dialog=document.getElementById('purchaseDialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const store={doc,prices,status:{state:'off'},saveSection(){},recovery:()=>[]};
  const ctx={document,assetStore:store,priceData:prices,PENCIL:'',id:()=>'',priceText:(v,cur)=>`${cur==='USD'?'$':'₩'}${v}`,
    tradeAlertToggle:(on,attrs)=>`<label><input type="checkbox" ${attrs}${on?' checked':''}></label>`,esc:v=>String(v),$:document.getElementById.bind(document),$$:document.querySelectorAll.bind(document),setTimeout:()=>1,clearTimeout(){},matchMedia:()=>({matches:false})};
  const code=['ma-ladder.js','prices.js','assets-calc.js','alloc-link.js','purchases.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
  const api=vm.runInNewContext(`${code}\n;({purchasePlanner,purchaseAlertRules})`,ctx);
  const before=JSON.stringify(doc);api.purchasePlanner.render();assert.equal(JSON.stringify(doc),before,'화면을 여는 것만으로 기록을 바꾸지 않음');
  function change(selector,value){const node=document.querySelectorAll(selector)[0];assert.ok(node,selector);if(typeof value==='boolean')node.checked=value;else node.value=String(value);node.onchange();}
  return {doc,item,prices,change,form:purchaseForm,edit:()=>document.querySelectorAll('[data-purchase-edit]')[0].onclick(),submit:()=>purchaseForm.onsubmit({preventDefault(){}}),rules:()=>api.purchaseAlertRules(doc,prices),render:api.purchasePlanner.render,html:()=>document.getElementById('buysView').innerHTML,input:selector=>document.querySelectorAll(selector)[0],inputs:selector=>document.querySelectorAll(selector)};
}

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

test('계획 목록: 매수대기의 시세 대기·도달 상태를 표시하고 회차 수를 만들지 않는다',()=>{
  const r=setup({wait:'25일선',ma:{'25일선':10000}});
  const progress=()=>r.html().match(/<span class="plan-count[^"]*">(.*?)<\/span>/)[1];
  assert.equal(progress(),'도달');r.prices.stocks['111111'].close=11000;r.render();assert.equal(progress(),'대기');
  delete r.prices.stocks['111111'].ma;r.render();assert.equal(progress(),'시세 대기');assert.equal(r.item.shares,10);assert.equal(r.item.buyPlan.buys,undefined);
});

test('매수대기: 선 위에서 기다리고 선에 닿거나 내려가면 도달하며 보유량·체결 회차는 바꾸지 않는다',()=>{
  const r=setup({currency:'USD',wait:'25개월선',price:110,ma:{'25개월선':100}}),before=JSON.stringify(r.doc);
  assert.match(r.html(),/매수대기 1개/);assert.match(r.html(),/기준선 위/);assert.doesNotMatch(r.html(),/기준선 도달/);
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

test('분할매수 설정: 목표 가격을 비우면 필드를 지우고 종료 평균선만 저장하며 기존 부분 체결은 유지한다',()=>{
  const r=setup({budget:50,price:14000,names:['25선','32선'],ma:{'25선':10000,'32선':13000}});
  r.change('[data-purchase-buy-shares]',7);const record=JSON.stringify(r.item.buyPlan.buys);
  r.edit();r.form.lineEnd.value='';r.form.lineEndLine.value='32선';r.submit();
  assert.equal(Object.hasOwn(r.item.buyPlan.lines,'end'),false);assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['25선','32선']);
  assert.equal(JSON.stringify(r.item.buyPlan.buys),record);assert.equal(r.item.shares,17);assert.match(r.html(),/남은 매수 3주/);
});

test('분할매수 설정: 목표 가격 없는 계획을 다시 열어 종료선을 늘리거나 목표 가격을 넣을 수 있다',()=>{
  const r=setup({end:null,names:['25일선','32일선'],ma:{'25일선':10000,'32일선':13000,'42일선':16000}}),before=JSON.stringify(r.item.buyPlan);
  r.edit();assert.equal(r.form.lineEnd.value,'');assert.equal(r.form.lineEndLine.value,'32일선');assert.equal(r.form.lineSet.value,'day');
  assert.equal(JSON.stringify(r.item.buyPlan),before);
  r.form.lineEndLine.value='42일선';r.submit();assert.deepEqual(Array.from(r.item.buyPlan.lines.names),['25일선','32일선','42일선']);
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
  assert.match(r.html(),/매수 완료 · 4\/4회/);assert.equal(r.item.shares,45);
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
    assert.equal(r.rules().length,5);assert.match(r.html(),/매수 전 · 0\/5회/);assert.match(r.html(),/남은 매수 5주/);
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
    assert.match(r.html(),/매수 완료 · 5\/5회/);
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
    assert.ok(r.inputs('[data-purchase-buy]').every(x=>!x.disabled));assert.match(r.html(),/남은 매수 5주/);
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

test('추종 ETF: 같은 이름·코드의 기존 보유 계좌가 여럿이어도 계획에서 고른 항목에만 체결·추가·취소한다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  const other={id:'b',name:r.item.name,ticker:'AAA',tradeTicker:'222222',shares:20},direct={id:'c',name:'같은 ETF 직접 보유',ticker:'222222',shares:30},source={id:'ref',name:'기준 미국 ETF',ticker:'AAA',shares:5};
  r.doc.allocation.groups.push({id:'other',name:'다른 계좌',items:[other,direct,source]});
  const before=JSON.stringify(r.doc);r.render();assert.equal(JSON.stringify(r.doc),before,'대상 표시만으로 기존 보유 기록을 바꾸지 않음');
  assert.match(r.html(),/매수 반영 대상<\/b> 자산 배분 › 테스트 계좌 › 테스트 종목/);assert.match(r.html(),/현재 보유 <b>10주<\/b> · 체결 주수를 더합니다/);
  r.change('[data-purchase-buy-shares]',60);
  assert.equal(r.item.shares,70);assert.deepEqual([other.shares,direct.shares,source.shares],[20,30,5]);
  assert.equal(r.doc.allocation.trades['buy:a:end'].items.length,1);assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].id,'a');
  r.item.name='바뀐 종목 이름';r.doc.allocation.groups[0].items=[];r.doc.allocation.groups[1].items.push(r.item);r.render();
  assert.match(r.html(),/매수 반영 대상<\/b> 자산 배분 › 다른 계좌 › 바뀐 종목 이름/);
  r.change('[data-purchase-buy]',true);assert.equal(r.item.shares,100);assert.deepEqual([other.shares,direct.shares,source.shares],[20,30,5]);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.shares,10);assert.deepEqual([other.shares,direct.shares,source.shares],[20,30,5]);assert.equal(r.doc.allocation.trades,undefined);
});

test('추종 ETF: 금액으로 관리하는 기존 항목은 평가액을 표시하고 체결 금액만 더했다가 복원한다',()=>{
  const r=setup({currency:'USD',price:100,budget:135,tracking:true,trackingPrice:15000,fx:1350});
  delete r.item.shares;r.item.amount=100;r.item.base=15000;r.render();
  assert.match(r.html(),/현재 평가액 <b>100만원<\/b> · 체결 금액을 더합니다/);
  r.change('[data-purchase-buy-shares]',60);assert.equal(r.item.amount,190);assert.equal(r.item.shares,undefined);
  assert.equal(r.doc.allocation.trades['buy:a:end'].items[0].amount,90);
  r.change('[data-purchase-buy]',true);assert.equal(r.item.amount,235);assert.equal(r.item.base,15000);
  r.change('[data-purchase-buy]',false);assert.equal(r.item.amount,100);assert.equal(r.item.shares,undefined);
});
