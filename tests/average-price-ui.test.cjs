const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 실제 투자 기록 없이 종목 수정창의 평균매수가 입력·저장 이벤트를 가상 DOM에서 실행한다.
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const source=['js/ma-ladder.js','js/assets-calc.js','js/member-link.js','js/assets.js'].map(read).join('\n;\n');
const fixture=()=>({version:1,allocation:{savedAt:'2026-01-01',total:100,cashFx:1200,memo:'가상 메모',classes:[{id:'stock',region:'미국',name:'주식'}],cash:[],groups:[
  {id:'g1',name:'가상 계좌 1',classId:'stock',items:[{id:'a',name:'가상 해외 ETF',ticker:'AAA',shares:2,amount:20,base:50000,target:10,note:'보존',buyPlan:{stages:[{id:'stage',price:40,shares:1,amount:5,done:true}]}}]},
  {id:'g2',name:'가상 계좌 2',classId:'stock',items:[{id:'b',name:'다른 계좌 ETF',ticker:'AAA',shares:3,averagePrice:100,amount:30,base:60000},{id:'missing',name:'평균가 없는 ETF',ticker:'AAA',shares:1},{id:'domestic',name:'가상 국내 ETF',ticker:'111111',shares:4,averagePrice:10000}]}]}});
const quoteFixture=()=>({stocks:{AAA:{kind:'해외',close:60,asOf:'2026-01-02'},'111111':{kind:'국내',close:12000,asOf:'2026-01-02'}},fx:{close:1200,asOf:'2026-01-02'}});
function page(data=fixture(),quotes=quoteFixture()){
  const nodes=new Map(),storage=new Map(),writes=[],alerts=[];let itemButtons=[];
  const document={activeElement:null,getElementById:node,querySelector:node,querySelectorAll:sel=>sel==='[data-item]'?itemButtons:sel==='dialog [data-close]'?[node('itemCancel')]:[],addEventListener(){}};
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='',value='';const attrs=new Map();
    const n={id,dataset:{},hidden:false,open:false,textContent:'',style:{},classList:{toggle(){},contains(){return false;}},tagName:'DIV',
      querySelector:sel=>node(`${id}:${sel}`),querySelectorAll:()=>[],setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),
      setCustomValidity(message){n.validationMessage=message;n.validity={valid:!message};},checkValidity:()=>!n.validationMessage,reportValidity(){n.reported=true;},
      focus(){document.activeElement=n;},blur(){if(document.activeElement===n)document.activeElement=null;},
      showModal(){n.open=true;},close(){n.open=false;document.activeElement=null;},closest:sel=>sel==='dialog'?node('itemDialog'):null,
      click(){return n.onclick?.();}};
    Object.defineProperty(n,'value',{get:()=>value,set:v=>{value=String(v);}});
    Object.defineProperty(n,'innerHTML',{get:()=>html,set:v=>{
      html=String(v);
      if(id!=='allocView'&&id!=='strategyView')return;
      if(!html){itemButtons=[];return;}
      itemButtons=[...html.matchAll(/<button\b[^>]*data-item="([^"]+)"[^>]*>/g)].map(m=>{
        const b=node(`itemButton:${m[1]}`);b.dataset.item=m[1];return b;
      });
    }});
    nodes.set(id,n);return n;
  }
  const form=node('itemForm');form.elements={};
  for(const name of ['name','group','section','ticker','tradeTicker','shares','target','done','note','averagePrice']){
    const input=node(name==='averagePrice'?'averagePriceInput':`item:${name}`);input.tagName=name==='group'?'SELECT':name==='note'?'TEXTAREA':'INPUT';
    form[name]=input;form.elements[name]=input;
  }
  form.checkValidity=()=>Object.values(form.elements).every(input=>input.checkValidity());
  const store={doc:data,prices:quotes,saveSection(section){writes.push(section);storage.set('etf-planner-assets-v1',JSON.stringify(store.doc));}};
  const ctx=vm.createContext({document,assetStore:store,URLSearchParams,crypto:require('node:crypto').webcrypto,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    addEventListener(){},setTimeout:fn=>{fn();return 1;},alert:message=>alerts.push(message)});
  vm.runInContext(source,ctx);ctx.openTab('alloc');
  const html=()=>node('allocView').innerHTML;
  const row=id=>{const start=html().indexOf(`data-alloc-item="${id}"`);assert.ok(start>=0,`종목 줄 ${id}`);const rest=html().slice(start),end=rest.search(/class="asset-row|class="group-foot"/);return end<0?rest:rest.slice(0,end);};
  return {ctx,data,store,node,html,row,writes,alerts,storage,input:node('averagePriceInput'),
    open(id){const b=itemButtons.find(b=>b.dataset.item===id);assert.ok(b?.onclick,'종목 수정 버튼 이벤트');b.click();},
    edit(value){node('averagePriceInput').value=value;node('averagePriceInput').oninput();},
    submit(){form.onsubmit({preventDefault(){}});},cancel(){node('itemCancel').click();},
    field(name,value){form.elements[name].value=value;form.elements[name].oninput?.();},
    refresh(quotes){store.prices=quotes;vm.runInContext('prices=assetStore.prices;render()',ctx);}};
}

// 소분류 검증에는 공개 가능한 가상 종목·수량·가격만 쓴다.
function sectionFixture(mixed=false){
  const data=fixture(),quotes=quoteFixture();
  data.allocation.groups=[{id:'g1',name:'가상 계좌',classId:'stock',sections:[{name:'가상 소분류',note:'가상 소분류 메모'}],items:[
    {id:'krw-a',name:'가상 원화 A',ticker:'111111',section:'가상 소분류',shares:3,averagePrice:10000},
    {id:'other',name:'가상 종목 B',ticker:mixed?'AAA':'222222',section:'가상 소분류',shares:1,averagePrice:mixed?100:10000}]}];
  quotes.stocks['222222']={kind:'국내',close:9000,asOf:'2026-01-02'};quotes.stocks.AAA.close=90;
  return {data,quotes};
}
function sectionHead(h,group='g1',name='가상 소분류'){
  const body=h.html().split(`id="allocGroup-${encodeURIComponent(group)}"`)[1]?.split('class="group-foot"')[0];
  assert.ok(body,`그룹 상세 ${group}`);
  const head=[...body.matchAll(/<div class="sub-head"><b>(.*?)<\/b>[\s\S]*?<\/div>/g)].find(m=>m[1]===name);
  assert.ok(head,`소분류 머리줄 ${name}`);return head[0];
}

test('소분류 원화 손익률은 종목 수익률 평균이 아닌 매입금액 가중 합산이다',()=>{
  const {data,quotes}=sectionFixture(),before=JSON.stringify(data),h=page(data,quotes),head=sectionHead(h);
  assert.match(head,/손익 <b class="profit-gain">\+5,000원<\/b><b class="profit-gain">\+12\.5%<\/b>/);
  assert.doesNotMatch(head,/개 합산|환율 없음/);assert.match(head,/<\/span><small title="가상 소분류 메모">가상 소분류 메모<\/small><\/div>$/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('소분류 혼합 통화는 평가액과 같은 현재 현물 환율로 매입금액·손익을 모두 환산한다',()=>{
  const {data,quotes}=sectionFixture(true);data.allocation.cashFx=1800;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(sectionHead(h),/손익 <b class="profit-loss">−6,000원<\/b><b class="profit-loss">−4%<\/b>/);
  assert.match(sectionHead(h),/title="달러 종목은 현재 환율 1,200원으로 환산 · 환차손익 제외"/);
  const next=structuredClone(quotes);next.fx.close=1000;h.refresh(next);
  assert.match(sectionHead(h),/손익 <b class="profit-loss">−4,000원<\/b><b class="profit-loss">−3\.08%<\/b>/);
  assert.match(sectionHead(h),/현재 환율 1,000원/);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('현물 환율이 없으면 직접 넣은 cashFx를 소분류 손익에도 적용한다',()=>{
  const {data,quotes}=sectionFixture(true);delete quotes.fx;data.allocation.cashFx=1000;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(sectionHead(h),/−4,000원<\/b><b class="profit-loss">−3\.08%<\/b>/);
  assert.match(sectionHead(h),/현재 환율 1,000원/);assert.doesNotMatch(sectionHead(h),/환율 없음|개 합산/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('환율이 전혀 없으면 소분류 원화 종목만 합산하고 달러 누락을 표시한다',()=>{
  const {data,quotes}=sectionFixture(true);delete quotes.fx;delete data.allocation.cashFx;
  const before=JSON.stringify(data),h=page(data,quotes),head=sectionHead(h);
  assert.match(head,/손익 <b class="profit-gain">\+6,000원<\/b><b class="profit-gain">\+20%<\/b>/);
  assert.match(head,/1\/2개 합산/);assert.match(head,/환율 없음/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  data.allocation.groups[0].items.shift();const usdOnly=JSON.stringify(data);h.ctx.renderAlloc();
  assert.doesNotMatch(sectionHead(h),/sub-profit|손익|개 합산|환율 없음/,'합산 가능한 종목이 없으면 안내도 숨긴다');
  assert.equal(JSON.stringify(data),usdOnly);assert.deepEqual(h.writes,[]);
});

test('평균매수가가 일부 없으면 소분류 합산 개수를 표시하고 전부 없으면 손익을 숨긴다',()=>{
  const {data,quotes}=sectionFixture();delete data.allocation.groups[0].items[1].averagePrice;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(sectionHead(h),/\+6,000원<\/b><b class="profit-gain">\+20%<\/b>/);assert.match(sectionHead(h),/1\/2개 합산/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  delete data.allocation.groups[0].items[0].averagePrice;const empty=JSON.stringify(data);h.ctx.renderAlloc();
  assert.doesNotMatch(sectionHead(h),/sub-profit|손익|개 합산/);assert.equal(JSON.stringify(data),empty);assert.deepEqual(h.writes,[]);
});

test('소분류 없는 종목과 다른 그룹의 같은 소분류는 제외하고 검색 중에도 소분류 전체를 합산한다',()=>{
  const {data,quotes}=sectionFixture(),item={id:'plain',name:'가상 별도 종목',ticker:'111111',shares:100,averagePrice:10000};
  data.allocation.groups[0].items.push(item);
  data.allocation.groups.push({id:'g2',name:'가상 다른 계좌',classId:'stock',items:[{...item,id:'elsewhere',section:'가상 소분류'}]});
  const before=JSON.stringify(data),h=page(data,quotes),head=sectionHead(h);
  assert.match(head,/\+5,000원<\/b><b class="profit-gain">\+12\.5%<\/b>/);assert.doesNotMatch(head,/개 합산/);
  assert.match(sectionHead(h,'g2'),/\+200,000원<\/b><b class="profit-gain">\+20%<\/b>/);
  vm.runInContext('allocQuery="가상 원화 A";renderAlloc()',h.ctx);assert.equal(sectionHead(h),head,'검색으로 일부 종목만 보여도 합계는 그대로');
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('소분류 원화 합산을 추가해도 종목 줄과 상단 보유 손익 카드는 현지 통화를 유지한다',()=>{
  const {data,quotes}=sectionFixture(true),before=JSON.stringify(data),h=page(data,quotes);
  assert.match(h.row('other'),/손익 <b class="profit-loss">−\$10<\/b><b class="profit-loss">−10%<\/b>/);
  assert.match(h.row('krw-a'),/손익 <b class="profit-gain">\+6,000원/);
  const totals=h.html().split('<div class="alloc-profit-totals">')[1].split('<p class="hint">')[0];
  assert.match(totals,/달러 \(USD\)<\/span><strong class="profit-loss">−\$10<\/strong>/);
  assert.match(totals,/원화 \(KRW\)<\/span><strong class="profit-gain">\+6,000원<\/strong>/);assert.doesNotMatch(totals,/−6,000원/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
});

test('소분류 미합산 개수에는 수량·시세 없는 보유를 포함하고 보유 0인 항목은 제외한다',()=>{
  const {data,quotes}=sectionFixture(),items=data.allocation.groups[0].items;
  items.push({...items[0],id:'no-shares',shares:undefined,amount:2},{...items[0],id:'no-quote',ticker:'333333'},{...items[0],id:'sold',shares:0});
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(sectionHead(h),/\+5,000원<\/b><b class="profit-gain">\+12\.5%<\/b>/);assert.match(sectionHead(h),/2\/4개 합산/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
});

test('소분류 손익은 기존 원 단위 반올림을 따르고 손익 0도 숨기지 않는다',()=>{
  const {data,quotes}=sectionFixture();data.allocation.groups[0].items.pop();quotes.stocks['111111'].close=10000.2;
  const before=JSON.stringify(data),h=page(data,quotes);
  assert.match(sectionHead(h),/손익 <b class="profit-gain">\+1원<\/b><b class="profit-gain">\+0%<\/b>/);
  quotes.stocks['111111'].close=10000;h.refresh(quotes);
  assert.match(sectionHead(h),/손익 <b class="">0원<\/b><b class="">0%<\/b>/);
  assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
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
  assert.equal([...modal.matchAll(/type="button" data-close/g)].length,2);assert.match(modal,/name="averagePrice"[^>]*step="any"[^>]*inputmode="decimal"/);assert.match(modal,/name="averagePrice"[^>]*max="9007199254740991"/);
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
