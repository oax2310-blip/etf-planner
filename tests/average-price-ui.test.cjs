const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 실제 투자 기록 없이 종목·그룹 수정창의 입력·저장·삭제 이벤트를 가상 DOM에서 실행한다.
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
// 계산·화면 코드는 assets.html에 실제 등록된 순서로만 읽는다. 저장소는 아래 대역을 쓰며, 빠진 페이지 의존성을 테스트가 대신 주입하지 않는다.
const exercised=new Set(['js/gold-estimate.js','js/money-input.js','js/ma-ladder.js','js/assets-calc.js','js/member-link.js','js/alloc-link.js','js/assets.js']);
const source=[...read('assets.html').matchAll(/<script\b[^>]*src="(js\/[^"?]+)\?v=\d+"/g)].map(m=>m[1]).filter(file=>exercised.has(file)).map(read).join('\n;\n');
const fixture=()=>({version:1,allocation:{savedAt:'2026-01-01',total:100,cashFx:1200,memo:'가상 메모',classes:[{id:'stock',region:'미국',name:'주식'}],cash:[],groups:[
  {id:'g1',name:'가상 계좌 1',classId:'stock',items:[{id:'a',name:'가상 해외 ETF',ticker:'AAA',shares:2,amount:20,base:50000,target:10,note:'보존',buyPlan:{stages:[{id:'stage',price:40,shares:1,amount:5,done:true}]}}]},
  {id:'g2',name:'가상 계좌 2',classId:'stock',items:[{id:'b',name:'다른 계좌 ETF',ticker:'AAA',shares:3,averagePrice:100,amount:30,base:60000},{id:'missing',name:'평균가 없는 ETF',ticker:'AAA',shares:1},{id:'domestic',name:'가상 국내 ETF',ticker:'111111',shares:4,averagePrice:10000}]}]}});
const quoteFixture=()=>({stocks:{AAA:{kind:'해외',close:60,asOf:'2026-01-02'},'111111':{kind:'국내',close:12000,asOf:'2026-01-02'}},fx:{close:1200,asOf:'2026-01-02'}});

test('체결된 매수의 기준 티커 변경 확인 취소는 저장하지 않고 승인해도 옛 회차를 변환하지 않는다',()=>{
  for(const confirmed of [false,true])for(const buyPlan of [{stages:[{id:'s',price:80,done:true}]},{buys:{end:{price:80,actual:1}}},{stages:[{id:'s',price:80,partial:true,shares:1}]}]){
    const data=fixture(),item=data.allocation.groups[0].items[0];Object.assign(item,{section:'금',ticker:'GLDM',buyPlan});
    const h=page(data),messages=[],before=JSON.stringify(data),record=JSON.stringify(buyPlan);
    h.ctx.confirm=message=>{messages.push(message);return confirmed;};h.open('a');h.field('ticker','GDX');h.submit();
    assert.equal(messages.length,1);assert.match(messages[0],/옛 티커 가격/);assert.match(messages[0],/다음 수집/);assert.match(messages[0],/장중 금 추정이 꺼집니다/);
    assert.equal(JSON.stringify(item.buyPlan),record);
    if(confirmed){assert.equal(item.ticker,'GDX');assert.deepEqual(h.writes,['allocation']);}
    else{assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,true);}
  }
});
function page(data=fixture(),quotes=quoteFixture()){
  const nodes=new Map(),storage=new Map(),writes=[],alerts=[],inputListeners=[];let itemButtons=[],groupButtons=[];
  const document={activeElement:null,getElementById:node,querySelector:node,querySelectorAll:sel=>sel==='[data-item]'?itemButtons:sel==='[data-group]'?groupButtons:sel==='dialog [data-close]'?[node('itemCancel')]:[],addEventListener(type,fn){if(type==='input')inputListeners.push(fn);}};
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='',value='';const attrs=new Map();
    const n={id,dataset:{},hidden:false,open:false,textContent:'',style:{},classList:{toggle(){},contains(){return false;}},tagName:'DIV',
      querySelector:sel=>node(`${id}:${sel}`),querySelectorAll:()=>[],setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),
      matches:selector=>selector==='input[data-money]'&&attrs.has('data-money'),setSelectionRange(start,end){n.selectionStart=start;n.selectionEnd=end;},
      setCustomValidity(message){n.validationMessage=message;n.validity={valid:!message};},checkValidity:()=>!n.validationMessage,reportValidity(){n.reported=true;},
      focus(){document.activeElement=n;},blur(){if(document.activeElement===n)document.activeElement=null;},
      showModal(){n.open=true;},close(){n.open=false;document.activeElement=null;},closest:sel=>sel==='dialog'?node('itemDialog'):null,
      click(){return n.onclick?.();}};
    Object.defineProperty(n,'value',{get:()=>value,set:v=>{value=String(v);}});
    Object.defineProperty(n,'innerHTML',{get:()=>html,set:v=>{
      html=String(v);
      if(id!=='allocView'&&id!=='strategyView')return;
      if(!html){itemButtons=[];groupButtons=[];return;}
      itemButtons=[...html.matchAll(/<button\b[^>]*data-item="([^"]+)"[^>]*>/g)].map(m=>{
        const b=node(`itemButton:${m[1]}`);b.dataset.item=m[1];return b;
      });
      groupButtons=[...html.matchAll(/<button\b[^>]*data-group="([^"]+)"[^>]*>/g)].map(m=>{
        const b=node(`groupButton:${m[1]}`);b.dataset.group=m[1];return b;
      });
    }});
    nodes.set(id,n);return n;
  }
  const form=node('itemForm');form.elements={};
  for(const name of ['name','group','section','ticker','tradeTicker','shares','target','done','note','averagePrice','averageCurrency']){
    const input=node(name==='averagePrice'?'averagePriceInput':name==='averageCurrency'?'averageCurrencySelect':`item:${name}`);input.tagName=['group','averageCurrency'].includes(name)?'SELECT':name==='note'?'TEXTAREA':'INPUT';
    form[name]=input;form.elements[name]=input;
  }
  for(const name of ['name','classId','target','note'])node('groupForm')[name]=node(`group:${name}`);
  // HTML의 금액 제한도 실제 화면처럼 공용 검증기에 전달한다.
  const averageTag=read('assets.html').match(/<input id="averagePriceInput"[^>]*>/)[0];
  node('averagePriceInput').setAttribute('data-money','');
  for(const [,key,value] of averageTag.matchAll(/(data-money-(?:min|max|step))="([^"]*)"/g))node('averagePriceInput').setAttribute(key,value);
  form.checkValidity=()=>Object.values(form.elements).every(input=>input.checkValidity());
  const store={doc:data,prices:quotes,saveSection(section){writes.push(section);storage.set('etf-planner-assets-v1',JSON.stringify(store.doc));}};
  const ctx=vm.createContext({document,assetStore:store,URLSearchParams,crypto:require('node:crypto').webcrypto,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    addEventListener(){},setTimeout:fn=>{fn();return 1;},confirm:()=>true,alert:message=>alerts.push(message)});
  vm.runInContext(source,ctx);ctx.openTab('alloc');
  const html=()=>node('allocView').innerHTML;
  const row=id=>{const start=html().indexOf(`data-alloc-item="${id}"`);assert.ok(start>=0,`종목 줄 ${id}`);const rest=html().slice(start),end=rest.search(/class="asset-row|class="group-foot"/);return end<0?rest:rest.slice(0,end);};
  return {ctx,data,store,node,html,row,writes,alerts,storage,input:node('averagePriceInput'),
    type(input,value){input.value=value;input.selectionStart=input.selectionEnd=value.length;inputListeners.forEach(fn=>fn({target:input}));input.oninput?.();},
    open(id){const b=itemButtons.find(b=>b.dataset.item===id);assert.ok(b?.onclick,'종목 수정 버튼 이벤트');b.click();},
    openGroup(id){const b=groupButtons.find(b=>b.dataset.group===id);assert.ok(b?.onclick,'그룹 수정 버튼 이벤트');b.click();},
    edit(value){const input=node('averagePriceInput');input.value=value;input.selectionStart=input.selectionEnd=value.length;inputListeners.forEach(fn=>fn({target:input}));input.oninput();},
    submit(){form.onsubmit({preventDefault(){}});},cancel(){node('itemCancel').click();},
    field(name,value){form.elements[name].value=value;form.elements[name].oninput?.();},
    selectCurrency(value){form.elements.averageCurrency.value=value;form.elements.averageCurrency.onchange();},
    refresh(quotes){store.prices=quotes;vm.runInContext('prices=assetStore.prices;render()',ctx);}};
}

function btcFixture(averageCurrency){
  const data=fixture(),quotes=quoteFixture(),item=data.allocation.groups[0].items[0];
  Object.assign(item,{name:'가상 비트코인',ticker:'BTC-USD',shares:.01,averagePrice:70000000});
  if(averageCurrency)item.averageCurrency=averageCurrency;
  quotes.stocks['BTC-USD']={kind:'코인',close:60000,asOf:'2026-01-02'};quotes.fx.close=1400;
  return {data,quotes,item};
}

for(const tradeOnly of [false,true])test(`실제 자산 페이지 등록 코드로 ${tradeOnly?'tradeTicker 단독 ':''}종목 삭제를 취소·승인하고 계획·체결 키·목표를 남은 계좌에 이전한다`,()=>{
  const data=fixture(),a=data.allocation,from=a.groups[0].items[0],plan=from.buyPlan,to={id:'a2',name:'가상 남은 계좌',ticker:'AAA',shares:1};
  if(tradeOnly)for(const it of [from,to]){delete it.ticker;it.tradeTicker='AAA';}to.target=5;
  a.groups[0].items.push(to);plan.buyPriority=['a','a2','b'];
  a.trades={'buy:a:stage':{label:'가상 체결',items:[{id:'a',shares:1}]}};
  const before=JSON.stringify(data),other=JSON.stringify(a.groups[1]),h=page(data);h.open('a');
  assert.equal(JSON.stringify(data),before,'페이지·종목 창을 여는 것만으로 저장 기록을 바꾸지 않음');
  let message='';h.ctx.confirm=text=>{message=text;return false;};h.node('itemDelete').click();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,true);
  assert.match(message,/계획과 체결 기록은 같은 종목/);assert.match(message,/목표 비중 10%는 '가상 남은 계좌' 줄로 옮깁니다/);
  h.ctx.confirm=()=>true;h.node('itemDelete').click();
  assert.deepEqual(a.groups[0].items.map(it=>it.id),['a2']);assert.equal(to.buyPlan,plan);assert.equal(to.target,15);assert.equal(to.shares,1);
  assert.equal(a.trades['buy:a:stage'],undefined);assert.ok(a.trades['buy:a2:stage']);assert.equal(a.trades['buy:a2:stage'].items[0].id,'a','옛 체결의 반영 대상은 보존');
  assert.deepEqual([...plan.buyPriority],['a2','b']);assert.equal(JSON.stringify(a.groups[1]),other);
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('itemDialog').open,false);
  const saved=JSON.parse(h.storage.get('etf-planner-assets-v1'));assert.equal(saved.allocation.groups[0].items[0].id,'a2');assert.ok(saved.allocation.groups[0].items[0].buyPlan);
});

for(const tradeOnly of [false,true])test(`실제 자산 페이지 등록 코드로 ${tradeOnly?'tradeTicker 단독 ':''}그룹 삭제를 취소·승인하고 다른 그룹의 계좌에 계획·체결 키를 이전한다`,()=>{
  const data=fixture(),a=data.allocation,plan=a.groups[0].items[0].buyPlan,to=a.groups[1].items[0];
  if(tradeOnly)for(const it of [a.groups[0].items[0],to]){delete it.ticker;it.tradeTicker='AAA';}to.target=5;
  a.trades={'buy:a:stage':{label:'가상 체결',items:[{id:'a',shares:1}]}};
  const before=JSON.stringify(data),remaining=JSON.parse(JSON.stringify(a.groups[1])),h=page(data);h.openGroup('g1');
  assert.equal(JSON.stringify(data),before,'그룹 창의 분류 선택지도 저장 전에는 기록에 넣지 않음');
  h.ctx.confirm=()=>false;h.node('groupDelete').click();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('groupDialog').open,true);
  h.ctx.confirm=()=>true;h.node('groupDelete').click();
  assert.deepEqual(a.groups.map(g=>g.id),['g2']);assert.equal(to.buyPlan,plan);assert.ok(a.trades['buy:b:stage']);assert.equal(a.trades['buy:a:stage'],undefined);
  assert.equal(to.target,5,'삭제한 그룹의 목표는 다른 그룹에 합산하지 않음');
  const expected=remaining;expected.items[0].buyPlan=plan;assert.deepEqual(JSON.parse(JSON.stringify(a.groups[0])),expected);
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('groupDialog').open,false);
  assert.deepEqual(JSON.parse(h.storage.get('etf-planner-assets-v1')).allocation.groups.map(g=>g.id),['g2']);
});

test('tradeTicker 단독 종목 삭제의 목표 소멸 문구는 같은 실제 코드가 남아 있을 때 표시한다',()=>{
  for(const same of [false,true]){
    const data=fixture(),from=data.allocation.groups[0].items[0],other=data.allocation.groups[1].items[0];
    delete from.ticker;from.tradeTicker='AAA';delete other.ticker;other.tradeTicker=same?'AAA':'BBB';
    const h=page(data);h.open('a');let message='';h.ctx.confirm=text=>{message=text;return false;};h.node('itemDelete').click();
    if(same)assert.match(message,/목표 비중 10%는 함께 지워집니다/);else assert.doesNotMatch(message,/목표 비중 10%는 함께 지워집니다/);
  }
});

test('평균매수가 통화 선택은 실제 거래 종목이 비트코인일 때만 보이며 달러가 기본이다',()=>{
  const h=page();h.open('a');assert.equal(h.node('averageCurrencySelect').hidden,true);
  h.field('ticker','BTC-USD');assert.equal(h.node('averageCurrencySelect').hidden,false);assert.equal(h.node('averageCurrencySelect').value,'');
  assert.equal(h.node('averagePriceLabel').textContent,'평균매수가 (달러 (USD) · 1 BTC 기준)');
  h.field('tradeTicker','111111');assert.equal(h.node('averageCurrencySelect').hidden,true);
  h.field('tradeTicker','');assert.equal(h.node('averageCurrencySelect').hidden,false);
  h.field('ticker','AAA');assert.equal(h.node('averageCurrencySelect').hidden,true);assert.deepEqual(h.writes,[]);
  const modal=read('assets.html').split('<dialog id="itemDialog"')[1].split('</dialog>')[0];
  assert.match(modal,/<select name="averageCurrency"[^>]*aria-label="평균매수가 통화"[^>]*hidden>/);
  assert.match(modal,/<option value="">달러 \(USD\)<\/option><option value="KRW">원화 \(KRW\)<\/option>/);
});

test('비트코인 원화 선택은 즉시 라벨·환산 현재가·손익을 미리 보여 주고 저장할 때만 필드를 만든다',()=>{
  const {data,quotes,item}=btcFixture(),h=page(data,quotes),before=JSON.stringify(data);h.open('a');h.selectCurrency('KRW');
  assert.equal(h.node('averagePriceLabel').textContent,'평균매수가 (원 (KRW) · 1 BTC 기준)');
  assert.match(h.node('averagePriceHolding').innerHTML,/0\.01 BTC/);assert.match(h.node('averagePriceHolding').innerHTML,/\$60,000.*원화 환산 84,000,000원/);
  assert.match(h.node('averagePricePreview').innerHTML,/\+140,000원/);assert.match(h.node('averagePricePreview').innerHTML,/\+20%/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);h.submit();
  assert.equal(item.averageCurrency,'KRW');assert.equal(item.averagePrice,70000000);assert.deepEqual(h.writes,['allocation']);
  assert.match(h.row('a'),/평균매수가 70,000,000원/);assert.match(h.row('a'),/손익 <b class="profit-gain">\+140,000원/);assert.match(h.row('a'),/0\.01 BTC/);assert.doesNotMatch(h.row('a'),/0\.01주/);
  assert.match(h.row('a'),/title="Coinbase 달러 시세 \$60,000 × 현재 환율 1,400원 = 84,000,000원 기준 · 국내 거래소 원화 시세와 차이가 날 수 있음"/);
  const card=h.html().split('<section class="card alloc-profit"')[1].split('</section>')[0];
  assert.match(card,/원화 \(KRW\)<\/span><strong class="profit-gain">\+148,000원/);
  assert.match(card,/원화 평균매수가 비트코인은 달러 시세 × 현재 환율로 계산/);
});

test('비트코인 통화를 달러로 되돌리거나 평균가를 비우거나 종목을 바꾸면 선택 필드를 삭제한다',()=>{
  for(const action of ['usd','empty','ticker','tradeTicker']){
    const {data,quotes,item}=btcFixture('KRW'),h=page(data,quotes);h.open('a');
    if(action==='usd')h.selectCurrency('');
    if(action==='empty')h.edit('');
    if(action==='ticker')h.field('ticker','AAA');
    if(action==='tradeTicker'){h.field('ticker','AAA');h.field('tradeTicker','111111');}
    h.submit();assert.equal(Object.hasOwn(item,'averageCurrency'),false,action);assert.deepEqual(h.writes,['allocation']);
    if(action==='empty')assert.equal(Object.hasOwn(item,'averagePrice'),false);else assert.equal(item.averagePrice,70000000);
  }
});

test('비트코인 통화 선택을 취소하거나 저장 없이 조회하면 기록을 바꾸지 않는다',()=>{
  for(const currency of [undefined,'KRW']){
    const {data,quotes}=btcFixture(currency),h=page(data,quotes),before=JSON.stringify(data);h.open('a');
    h.selectCurrency(currency?'':'KRW');h.cancel();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
    h.open('a');h.submit();assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
});

test('환율이 없으면 원화 비트코인의 현재가·손익은 환율 대기로 표시하며 BTC 단위를 유지한다',()=>{
  const {data,quotes}=btcFixture('KRW');delete quotes.fx;delete data.allocation.cashFx;
  const h=page(data,quotes);h.open('a');assert.match(h.node('averagePriceHolding').innerHTML,/환율 대기/);assert.match(h.node('averagePricePreview').innerHTML,/환율 대기/);
  assert.match(h.row('a'),/0\.01 BTC/);assert.match(h.row('a'),/asset-profit-result">환율 대기/);
});

test('원화 비트코인의 그룹·같은 종목 합계는 cashFx를 전달하고 달러 계좌와 섞거나 이중 환산하지 않는다',()=>{
  const {data,quotes,item}=btcFixture('KRW');delete quotes.fx;data.allocation.cashFx=1400;
  data.allocation.groups=[{id:'g1',name:'가상 코인 계좌',classId:'stock',items:[item,{...item,id:'krw2'},{...item,id:'usd',averageCurrency:undefined,averagePrice:50000}]}];
  const h=page(data,quotes);h.open('a');assert.match(h.node('averagePricePreview').innerHTML,/\+140,000원/);
  assert.equal(h.node('averagePriceTotal').hidden,false);assert.match(h.node('averagePriceTotal').innerHTML,/계산 가능 2 \/ 2개/);assert.match(h.node('averagePriceTotal').innerHTML,/\+280,000원/);assert.doesNotMatch(h.node('averagePriceTotal').innerHTML,/\$/);
  assert.match(groupHead(h),/\+42만원/);assert.match(groupHead(h),/\+20%/);
  h.selectCurrency('');assert.match(h.node('averagePriceTotal').innerHTML,/계산 가능 2 \/ 2개/);assert.match(h.node('averagePriceTotal').innerHTML,/\$/);
});

test('창을 연 뒤 동기화된 통화는 손대지 않은 선택으로 덮어쓰지 않으며 직접 바꾼 선택만 저장한다',()=>{
  const {data,quotes,item}=btcFixture(),h=page(data,quotes);h.open('a');item.averageCurrency='KRW';h.field('note','가상 새 메모');h.submit();
  assert.equal(item.averageCurrency,'KRW');assert.equal(item.note,'가상 새 메모');
  h.open('a');delete item.averageCurrency;h.field('note','가상 다른 메모');h.submit();assert.equal(Object.hasOwn(item,'averageCurrency'),false);
});

test('금 기준 티커 확인을 취소하면 비트코인 원화 선택과 평균가 변경도 저장하지 않는다',()=>{
  for(const confirmed of [false,true]){
    const data=fixture(),item=data.allocation.groups[0].items[0];Object.assign(item,{section:'금',ticker:'GLDM'});
    const h=page(data),before=JSON.stringify(data),messages=[];h.ctx.confirm=message=>{messages.push(message);return confirmed;};
    h.open('a');h.field('ticker','BTC-USD');h.selectCurrency('KRW');h.edit('70000000');h.submit();
    assert.equal(messages.length,1);
    if(confirmed){assert.equal(item.averageCurrency,'KRW');assert.equal(item.averagePrice,70000000);assert.deepEqual(h.writes,['allocation']);}
    else{assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,true);}
  }
});

// 그룹 손익 검증에는 공개 가능한 가상 종목·수량·가격만 쓴다.
function groupProfitFixture(mixed=false){
  const data=fixture(),quotes=quoteFixture();
  data.allocation.groups=[{id:'g1',name:'가상 계좌',classId:'stock',sections:[{name:'가상 소분류',note:'가상 소분류 메모'}],items:[
    {id:'krw-a',name:'가상 원화 A',ticker:'111111',section:'가상 소분류',shares:300,averagePrice:10000},
    {id:'other',name:'가상 종목 B',ticker:mixed?'AAA':'222222',section:'가상 소분류',shares:100,averagePrice:mixed?100:10000}]}];
  quotes.stocks['222222']={kind:'국내',close:9000,asOf:'2026-01-02'};quotes.stocks.AAA.close=90;
  return {data,quotes};
}
function groupHead(h,group='g1'){
  const html=h.html(),button=html.indexOf(`data-alloc-fold="group:${group}"`);
  assert.ok(button>=0,`그룹 머리 ${group}`);
  return html.slice(html.lastIndexOf('<div class="group-head">',button),html.indexOf('<div class="alloc-fold-body"',button)).trim();
}

test('그룹 원화 손익은 만원으로 표시하고 손익률은 매입금액으로 가중 합산한다',()=>{
  const {data,quotes}=groupProfitFixture(),before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
  assert.match(head,/손익 <b class="profit-gain">\+50만원<\/b><b class="profit-gain">\+12\.5%<\/b>/);
  assert.doesNotMatch(head,/ · \d+\/\d+개|환율 없음/);assert.match(head,/보유 2개 중 2개 합산/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('그룹 혼합 통화는 평가액과 같은 현재 현물 환율로 매입금액·손익을 모두 환산한다',()=>{
  const {data,quotes}=groupProfitFixture(true);data.allocation.cashFx=1800;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/손익 <b class="profit-loss">−60만원<\/b><b class="profit-loss">−4%<\/b>/);
  assert.match(groupHead(h),/title="[^"]*달러 종목은 현재 환율 1,200원으로 환산 · 환차손익 제외"/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  const next=structuredClone(quotes);next.fx.close=1000;h.refresh(next);
  assert.match(groupHead(h),/손익 <b class="profit-loss">−40만원<\/b><b class="profit-loss">−3\.08%<\/b>/);
  assert.match(groupHead(h),/현재 환율 1,000원/);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('현물 환율이 없으면 직접 넣은 cashFx를 그룹 손익에도 적용한다',()=>{
  const {data,quotes}=groupProfitFixture(true);delete quotes.fx;data.allocation.cashFx=1000;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/−40만원<\/b><b class="profit-loss">−3\.08%<\/b>/);
  assert.match(groupHead(h),/현재 환율 1,000원/);assert.doesNotMatch(groupHead(h),/환율 없음| · \d+\/\d+개/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('환율이 전혀 없으면 그룹 원화 종목만 합산하고 달러만 있으면 손익을 숨긴다',()=>{
  const {data,quotes}=groupProfitFixture(true);delete quotes.fx;delete data.allocation.cashFx;
  const before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
  assert.match(head,/손익 <b class="profit-gain">\+60만원<\/b><b class="profit-gain">\+20%<\/b> · 1\/2개 · 환율 없음<\/span>/);
  assert.match(head,/title="[^"]*보유 2개 중 1개 합산 · 환율 없음 · 달러 종목 합산 제외"/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  data.allocation.groups[0].items.shift();const usdOnly=JSON.stringify(data);h.ctx.renderAlloc();
  assert.doesNotMatch(groupHead(h),/group-profit|손익|개 합산|환율 없음/,'합산 가능한 종목이 없으면 안내도 숨긴다');
  assert.equal(JSON.stringify(data),usdOnly);assert.deepEqual(h.writes,[]);
});

test('평균매수가가 일부 없으면 그룹 합산 개수를 표시하고 전부 없으면 손익을 숨긴다',()=>{
  const {data,quotes}=groupProfitFixture();delete data.allocation.groups[0].items[1].averagePrice;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/\+60만원<\/b><b class="profit-gain">\+20%<\/b> · 1\/2개<\/span>/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  delete data.allocation.groups[0].items[0].averagePrice;const empty=JSON.stringify(data);h.ctx.renderAlloc();
  assert.doesNotMatch(groupHead(h),/group-profit|손익|개 합산/);assert.equal(JSON.stringify(data),empty);assert.deepEqual(h.writes,[]);
});

test('그룹 손익은 소분류 유무와 무관하게 그룹 전체를 합산하고 다른 그룹·검색과 분리한다',()=>{
  const {data,quotes}=groupProfitFixture(),item={id:'plain',name:'가상 별도 종목',ticker:'111111',shares:100,averagePrice:10000};
  data.allocation.groups[0].items.push(item);
  data.allocation.groups.push({id:'g2',name:'가상 다른 계좌',classId:'stock',items:[{...item,id:'elsewhere',section:'가상 소분류'}]});
  const before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
  assert.match(head,/\+70만원<\/b><b class="profit-gain">\+14%<\/b>/);assert.doesNotMatch(head,/ · \d+\/\d+개/);
  assert.match(groupHead(h,'g2'),/\+20만원<\/b><b class="profit-gain">\+20%<\/b>/);
  vm.runInContext('allocQuery="가상 원화 A";renderAlloc()',h.ctx);assert.equal(groupHead(h),head,'검색으로 일부 종목만 보여도 합계는 그대로');
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('그룹 원화 합산을 표시해도 종목 줄과 상단 보유 손익 카드는 현지 통화를 유지한다',()=>{
  const {data,quotes}=groupProfitFixture(true),before=JSON.stringify(data),h=page(data,quotes);
  assert.match(h.row('other'),/손익 <b class="profit-loss">−\$1,000<\/b><b class="profit-loss">−10%<\/b>/);
  assert.match(h.row('krw-a'),/손익 <b class="profit-gain">\+600,000원/);
  const totals=h.html().split('<div class="alloc-profit-totals">')[1].split('<p class="hint">')[0];
  assert.match(totals,/달러 \(USD\)<\/span><strong class="profit-loss">−\$1,000<\/strong>/);
  assert.match(totals,/원화 \(KRW\)<\/span><strong class="profit-gain">\+600,000원<\/strong>/);assert.doesNotMatch(totals,/−600,000원/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
});

test('그룹 미합산 개수에는 수량·시세 없는 보유를 포함하고 보유 0인 항목은 제외한다',()=>{
  const {data,quotes}=groupProfitFixture(),items=data.allocation.groups[0].items;
  items.push({...items[0],id:'no-shares',shares:undefined,amount:2},{...items[0],id:'no-quote',ticker:'333333'},{...items[0],id:'sold',shares:0});
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(groupHead(h),/\+50만원<\/b><b class="profit-gain">\+12\.5%<\/b> · 2\/4개<\/span>/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('그룹 손익 금액은 만원 소수 첫째 자리로 반올림하고 0이면 부호와 색을 없앤다',()=>{
  const {data,quotes}=groupProfitFixture();data.allocation.groups[0].items.pop();data.allocation.groups[0].items[0].shares=1;
  const before=JSON.stringify(data),h=page(data,quotes);
  for(const change of [499,-499,0]){
    quotes.stocks['111111'].close=10000+change;h.refresh(quotes);
    assert.match(groupHead(h),/손익 <b class="">0만원<\/b>/);
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
  for(const [change,sign,color]of [[500,'+','profit-gain'],[-500,'−','profit-loss']]){
    quotes.stocks['111111'].close=10000+change;h.refresh(quotes);
    assert.ok(groupHead(h).includes(`손익 <b class="${color}">${sign}0.1만원</b>`));
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
});

test('그룹 손익은 목표 금액 또는 금액·비중과 같은 줄에 두고 접어도 보이며 소분류에서는 제거한다',()=>{
  for(const target of [undefined,25,'linked']){
    const {data,quotes}=groupProfitFixture(),group=data.allocation.groups[0];
    if(target==='linked')group.sections[0].target=25;else if(target!==undefined)group.target=target;
    const before=JSON.stringify(data),h=page(data,quotes),head=groupHead(h);
    if(target===undefined){
      assert.match(head,/<div class="group-sub"><p><b>[\s\S]*<\/p><span class="group-profit"/);assert.doesNotMatch(head,/group-target/);
    }else{
      assert.match(head,/<\/p><div class="group-sub"><small class="group-target">[^<]*<\/small><span class="group-profit"/);
      if(target==='linked')assert.match(head,/하위 합산/);
    }
    assert.match(head,/aria-expanded="false"/);assert.match(head,/group-profit/);assert.match(h.html(),/id="allocGroup-g1" hidden/);
    const subheads=[...h.html().matchAll(/<div class="sub-head">[\s\S]*?<\/div>/g)];assert.equal(subheads.length,1);
    assert.doesNotMatch(subheads[0][0],/sub-profit|group-profit|손익/);assert.match(subheads[0][0],/가상 소분류 메모/);
    vm.runInContext('allocOpenCards.add("group:g1");renderAlloc()',h.ctx);assert.match(groupHead(h),/aria-expanded="true"/);assert.match(groupHead(h),/group-profit/);
    h.ctx.openTab('strategy');assert.doesNotMatch(h.node('strategyView').innerHTML,/group-profit|보유 평가손익 합계/);h.ctx.openTab('alloc');
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
  }
});

test('평균매수가 미입력 종목에는 손익을 표시하지 않으며 조회·취소는 저장하지 않는다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);
  assert.doesNotMatch(h.row('a'),/평균매수가|평가손익|손익률|asset-profit/,'미입력 안내 줄도 두지 않는다');
  assert.match(h.row('b'),/평균매수가 \$100<\/span><span class="asset-profit-result" title="평가손익 · 손익률">손익 <b class="profit-loss">−\$120<\/b><b class="profit-loss">−40%<\/b>/);assert.match(h.row('domestic'),/profit-gain[^>]*">\+8,000원/);
  h.open('a');assert.equal(h.node('itemDialog').open,true);assert.equal(h.input.value,'');
  assert.match(h.node('averagePriceLabel').textContent,/달러 \(USD\)/);assert.match(h.node('averagePriceHolding').innerHTML,/보유 수량 <b>2주/);
  h.edit('50');assert.match(h.node('averagePricePreview').innerHTML,/\+\$20/);assert.match(h.node('averagePricePreview').innerHTML,/\+20%/);
  assert.equal(JSON.stringify(data),before,'입력 중 미리보기는 저장 객체를 변경하지 않음');
  h.cancel();assert.equal(h.node('itemDialog').open,false);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
  h.open('a');assert.equal(h.input.value,'','취소한 초안이 다음 입력값에 남지 않음');
});

test('평균매수가 추가·수정·빈칸 삭제는 선택 계좌 필드만 저장하며 기존 보유·기준가·계획을 보존한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data),item=data.allocation.groups[0].items[0];
  for(const [value,expected]of [['50',50],['75.25',75.25],['',undefined]]){
    const prior=JSON.parse(JSON.stringify(data));h.open('a');h.edit(value);h.submit();
    assert.equal(item.averagePrice,expected);if(expected===undefined)assert.equal(Object.hasOwn(item,'averagePrice'),false,'빈 선택 필드는 delete');
    if(expected===undefined)delete prior.allocation.groups[0].items[0].averagePrice;else prior.allocation.groups[0].items[0].averagePrice=expected;
    assert.equal(JSON.stringify(data),JSON.stringify(prior),'다른 계좌·수량·평가기준·계획에는 변경 없음');
    assert.equal(h.node('itemDialog').open,false);
  }
  assert.deepEqual(h.writes,['allocation','allocation','allocation']);assert.equal(JSON.stringify(data),before,'추가 후 삭제하면 원래 기록과 같다');
  h.open('a');h.submit();assert.equal(h.writes.length,3,'변경 없는 빈칸 저장은 쓰지 않음');
  h.open('b');h.submit();assert.equal(h.writes.length,3,'기존 가격 그대로 저장해도 쓰지 않음');
});

test('평균매수가 12,345.6은 숫자 12345.6으로 저장하고 다시 열면 쉼표를 표시한다',()=>{
  const h=page();h.open('a');h.edit('12345.6');assert.equal(h.input.value,'12,345.6');h.submit();
  const saved=JSON.parse(h.storage.get('etf-planner-assets-v1')).allocation.groups[0].items[0];
  assert.equal(saved.averagePrice,12345.6);assert.equal(typeof saved.averagePrice,'number');
  h.open('a');assert.equal(h.input.value,'12,345.6');
  const before=JSON.stringify(h.data);h.input.value='9007199254740992';h.submit();
  assert.equal(JSON.stringify(h.data),before);assert.equal(h.input.checkValidity(),false,'입력 이벤트 없이도 저장 직전 재검사');
});

test('평균매수가 입력칸은 원화 정수·달러 소수 한 자리로 보이고 고치지 않으면 정밀값으로 계산·보존한다',()=>{
  const data=fixture(),[domestic,usd]=[data.allocation.groups[1].items[2],data.allocation.groups[1].items[0]];
  domestic.averagePrice=20990.2941177;usd.averagePrice=100.26;
  const h=page(data),before=JSON.stringify(data);
  assert.match(h.row('domestic'),/평균매수가 20,990원</);assert.match(h.row('b'),/평균매수가 \$100\.3</);
  h.open('domestic');assert.equal(h.input.value,'20,990');assert.match(h.node('averagePriceLabel').textContent,/원 \(KRW\)/);
  assert.match(h.node('averagePricePreview').innerHTML,/−35,961원/,'반올림한 20,990원(−35,960원)이 아닌 저장값으로 계산');h.submit();
  h.open('b');assert.equal(h.input.value,'100.3');assert.match(h.node('averagePricePreview').innerHTML,/−\$120\.78/);h.submit();
  assert.equal(JSON.stringify(data),before,'손대지 않고 저장하면 정밀값을 그대로 둔다');assert.deepEqual(h.writes,[]);
  for(const [value,shown]of [[523.04,'523'],[1234.95,'1,235'],[0.04,'0.04']]){usd.averagePrice=value;h.refresh(h.store.prices);assert.match(h.row('b'),new RegExp(`평균매수가 \\$${shown}<`),String(value));h.open('b');assert.equal(h.input.value,shown,String(value));assert.equal(h.input.checkValidity(),true);h.cancel();}
  domestic.averagePrice=0.3;h.open('domestic');assert.equal(h.input.value,'0.3','반올림해 0이면 원래 값');h.cancel();
  domestic.averagePrice=20990.2941177;h.open('domestic');h.edit('21,000');h.submit();assert.equal(domestic.averagePrice,21000);assert.deepEqual(h.writes,['allocation']);
});

test('현금은 원화·달러·음수 금액을 숫자로 저장하고 잘못된 형식은 저장하지 않는다',()=>{
  const h=page(),f=h.node('cashForm');
  for(const key of ['place','name','amount','currency','minus'])f[key]=h.node(`cash:${key}`);
  f.amount.setAttribute('data-money','');f.amount.setAttribute('data-money-step','any');
  for(const [currency,raw,shown,value] of [['KRW','12345.6','12,345.6',12345.6],['USD','-1234.5','-1,234.5',-1234.5]]){
    h.ctx.openCash();f.name.value='예시 현금';f.currency.value=currency;h.type(f.amount,raw);
    assert.equal(f.amount.value,shown);f.onsubmit({preventDefault(){}});
    const saved=JSON.parse(h.storage.get('etf-planner-assets-v1')).allocation.cash.at(-1);
    assert.equal(saved.amount,value);assert.equal(typeof saved.amount,'number');assert.equal(saved.currency,currency);
    h.ctx.openCash(saved.id);assert.equal(f.amount.value,shown);
    const before=JSON.stringify(h.data);f.amount.value='1e3';f.onsubmit({preventDefault(){}});
    assert.equal(JSON.stringify(h.data),before);assert.ok(f.amount.validationMessage);assert.equal(h.node('cashDialog').open,true);
  }
});

test('평균매수가 0·음수·잘못된 값은 저장을 막고 창과 기존 기록을 유지한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);h.open('b');
  for(const value of ['0','-1','-0.5','invalid','Infinity']){
    h.edit(value);h.submit();assert.equal(h.node('itemDialog').open,true);assert.equal(h.input.checkValidity(),false);assert.match(h.input.validationMessage,/0보다 큰 숫자/);
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
  h.edit('1e20');h.submit();assert.equal(h.node('itemDialog').open,true);assert.match(h.input.validationMessage,/범위를 초과/);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  h.edit('0.25');h.submit();assert.equal(data.allocation.groups[1].items[0].averagePrice,.25);assert.deepEqual(h.writes,['allocation']);
});

test('같은 종목 전체 계좌는 매입금액으로 가중한 손익과 누락된 계좌 수를 표시한다',()=>{
  const data=fixture();data.allocation.groups[0].items[0].averagePrice=50;const before=JSON.stringify(data),h=page(data);
  assert.match(h.html(),/계산 가능 3 \/ 보유 4개/);assert.match(h.html(),/달러 \(USD\)/);assert.match(h.html(),/원화 \(KRW\)/);
  h.open('a');assert.equal(h.node('averagePriceTotal').hidden,false);assert.match(h.node('averagePriceTotal').innerHTML,/계산 가능 2 \/ 3개/);
  assert.match(h.node('averagePriceTotal').innerHTML,/−\$100/);assert.match(h.node('averagePriceTotal').innerHTML,/−25%/,'계좌 수익률 산술평균을 쓰지 않음');
  h.edit('100');assert.match(h.node('averagePriceTotal').innerHTML,/−\$200/);assert.match(h.node('averagePriceTotal').innerHTML,/−40%/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[],'합계 미리보기도 저장하지 않음');
});

test('시세 갱신 뒤 다시 열면 현재가·손익을 갱신하고 평균매수가는 유지한다',()=>{
  const data=fixture();data.allocation.groups[0].items[0].averagePrice=50;const h=page(data),before=JSON.stringify(data);
  h.open('a');h.cancel();const next=quoteFixture();next.stocks.AAA.close=75;next.fx.close=5000;h.refresh(next);
  assert.match(h.row('a'),/\+\$50/);assert.match(h.row('a'),/\+50%/);
  h.open('a');assert.equal(h.input.value,'50');assert.match(h.node('averagePriceHolding').innerHTML,/\$75/);assert.match(h.node('averagePricePreview').innerHTML,/\+\$50/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('투자구성과 자산배분 탭 왕복은 기존 분류·목표 화면과 평균매수가를 보존한다',()=>{
  const data=fixture();data.allocation.groups[0].items[0].averagePrice=50;const h=page(data),before=JSON.stringify(data);
  h.ctx.openTab('strategy');assert.match(h.node('strategyView').innerHTML,/배분 개요/);assert.doesNotMatch(h.node('strategyView').innerHTML,/보유 평가손익 합계|data-average-price=/);assert.equal(h.html(),'');
  h.ctx.openTab('alloc');assert.match(h.row('a'),/평균매수가 \$50/);h.open('a');assert.equal(h.input.value,'50');
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('평균매수가 입력은 종목 수정창 안에만 있으며 제거한 자동 계산 입력 없이 소수 입력 접근성을 제공한다',()=>{
  const html=read('assets.html'),modal=html.split('<dialog id="itemDialog"')[1].split('</dialog>')[0];
  assert.doesNotMatch(html,/id="averagePriceDialog"|id="averagePriceForm"/);
  assert.doesNotMatch(modal,/name="(?:amount|tradePrice)"/);
  assert.equal([...html.matchAll(/name="averagePrice"/g)].length,1);
  assert.equal([...modal.matchAll(/type="button" data-close/g)].length,2);assert.match(modal,/name="averagePrice" type="text" inputmode="decimal" autocomplete="off" data-money/);assert.match(modal,/data-money-step="any"/);assert.match(modal,/data-money-max="9007199254740991"/);
  assert.match(modal,/aria-describedby="averagePriceHint"/);assert.match(modal,/id="averagePricePreview"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('평균매수가 수정은 숨긴 금액·평가기준과 같은 ETF의 기존 가격 대체값을 보존한다',()=>{
  const data=fixture(),item=data.allocation.groups[0].items[0];
  Object.assign(item,{tradeTicker:'111111',tradePrice:9000,tradePriceAt:'2026-01-01T00:00:00Z',baseAt:'2025-12-31'});
  delete item.shares;
  data.allocation.trades={'buy:a:stage':{at:'2026-01-01',items:[{id:'a',amount:5}]}};
  const before=JSON.parse(JSON.stringify(data)),h=page(data);h.open('a');h.edit('10000');h.submit();
  before.allocation.groups[0].items[0].averagePrice=10000;
  assert.deepEqual(data,before,'금액만으로 보유하던 기존 종목도 평균매수가 외 필드는 그대로');
  assert.deepEqual(h.writes,['allocation']);assert.equal(h.node('itemDialog').open,false);
});

test('실제 매수 ETF 코드를 바꾸면 다른 ETF의 오래된 가격을 재사용하지 않는다',()=>{
  const data=fixture(),item=data.allocation.groups[0].items[0];
  Object.assign(item,{tradeTicker:'111111',tradePrice:9000,tradePriceAt:'2026-01-01T00:00:00Z'});
  const h=page(data);h.open('a');h.field('tradeTicker','222222');h.submit();
  assert.equal(item.tradeTicker,'222222');assert.equal(Object.hasOwn(item,'tradePrice'),false);assert.equal(Object.hasOwn(item,'tradePriceAt'),false);
  assert.equal(item.amount,20);assert.equal(item.shares,2);assert.deepEqual(h.writes,['allocation']);
});

test('같은 수정창에서 수량·평균매수가·종목 통화를 바꾸면 초안으로 손익을 미리 계산한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);h.open('a');h.edit('50');h.field('shares','4');
  assert.match(h.node('averagePriceHolding').innerHTML,/보유 수량 <b>4주/);assert.match(h.node('averagePricePreview').innerHTML,/\+\$40/);
  h.field('tradeTicker','111111');h.edit('10000');
  assert.match(h.node('averagePriceLabel').textContent,/원 \(KRW\)/);assert.match(h.node('averagePricePreview').innerHTML,/\+8,000원/);assert.match(h.node('averagePricePreview').innerHTML,/\+20%/);
  assert.equal(JSON.stringify(data),before);h.cancel();assert.deepEqual(h.writes,[]);
});

test('평균매수가 편집 중 갱신된 보유 수량은 사용자가 수량을 고치지 않았다면 그대로 저장한다',()=>{
  const data=fixture(),h=page(data);h.open('a');h.edit('50');
  data.allocation.groups[0].items[0].shares=5;
  data.allocation.trades={'buy:a:new':{at:'2026-01-03',items:[{id:'a',shares:3}]}};
  const before=JSON.parse(JSON.stringify(data));h.submit();before.allocation.groups[0].items[0].averagePrice=50;
  assert.deepEqual(data,before,'평균매수가만 저장하면서 새 체결 수량·기록을 되돌리지 않음');
  assert.deepEqual(h.writes,['allocation']);
});

test('수정 중 다른 기기에서 지운 종목은 평균매수가 저장으로 다시 만들지 않는다',()=>{
  const data=fixture(),h=page(data);h.open('a');h.edit('50');data.allocation.groups[0].items=[];
  const before=JSON.stringify(data);h.submit();
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.node('itemDialog').open,false);assert.equal(h.alerts.length,1);
});

test('새 종목도 같은 수정창에서 수량·평균매수가를 저장하며 자동 계산값은 수동 입력하지 않는다',()=>{
  const data=fixture(),h=page(data);h.ctx.openItem(null,'g1');
  h.field('name','가상 새 ETF');h.field('ticker','111111');h.field('shares','2');h.edit('10000');h.submit();
  const item=data.allocation.groups[0].items.find(it=>it.name==='가상 새 ETF');
  assert.ok(item?.id);assert.equal(item.averagePrice,10000);assert.equal(item.shares,2);assert.equal(item.ticker,'111111');
  assert.equal(item.amount,0);assert.equal(Object.hasOwn(item,'tradePrice'),false);assert.deepEqual(h.writes,['allocation']);
  assert.equal(h.node('itemDialog').open,false);
});

test('동기화가 수정 중 기록 객체를 교체해도 최신 보유 기록에 평균매수가만 반영한다',()=>{
  const h=page();h.open('a');h.edit('50');
  const latest=JSON.parse(JSON.stringify(h.data));latest.allocation.groups[0].items[0].shares=7;latest.allocation.groups[0].items[0].note='가상 동기화 메모';
  h.store.doc=latest;vm.runInContext('doc=assetStore.doc;render()',h.ctx);
  const before=JSON.parse(JSON.stringify(latest));h.submit();before.allocation.groups[0].items[0].averagePrice=50;
  assert.deepEqual(latest,before);assert.deepEqual(JSON.parse(h.storage.get('etf-planner-assets-v1')),before);
  assert.equal(h.data.allocation.groups[0].items[0].averagePrice,undefined,'교체 전 객체를 고치지 않음');
  assert.deepEqual(h.writes,['allocation']);
});

test('종목 창의 플래너 체결은 건수를 남기고 기본 접기하며 다시 열면 접고 기록은 보존한다',()=>{
  const data=fixture();data.allocation.trades={};
  for(let i=0;i<25;i++)data.allocation.trades[`buy:a:${i}`]={label:`가상 체결 ${i}`,at:'2026-01-02',items:[{id:'a',shares:1}]};
  const before=JSON.stringify(data),h=page(data),tag=read('assets.html').match(/<details\b[^>]*id="itemTrades"[^>]*>/)?.[0];
  assert.ok(tag,'키보드·터치로 여닫는 native details');assert.doesNotMatch(tag,/\sopen(?:\s|>)/);
  h.open('a');assert.equal(h.node('itemTrades').open,false);assert.equal(h.node('itemTrades').hidden,false);
  assert.match(h.node('itemTrades').innerHTML,/<summary><span>플래너 체크로 반영한 체결 <small>25건<\/small>/);assert.equal((h.node('itemTrades').innerHTML.match(/<li>/g)||[]).length,20);
  h.node('itemTrades').open=true;h.cancel();h.open('a');assert.equal(h.node('itemTrades').open,false);assert.equal(JSON.stringify(data),before);assert.equal(h.writes.length,0);
  h.open('b');assert.equal(h.node('itemTrades').hidden,true);
});
