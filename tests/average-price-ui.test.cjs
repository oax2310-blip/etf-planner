const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 실제 투자 기록 없이 기존 자산 화면·평균매수가 창의 이벤트를 가상 DOM에서 실행한다.
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const source=['js/ma-ladder.js','js/assets-calc.js','js/member-link.js','js/assets.js'].map(read).join('\n;\n');
const fixture=()=>({version:1,allocation:{savedAt:'2026-01-01',total:100,cashFx:1200,memo:'가상 메모',classes:[{id:'stock',region:'미국',name:'주식'}],cash:[],groups:[
  {id:'g1',name:'가상 계좌 1',classId:'stock',items:[{id:'a',name:'가상 해외 ETF',ticker:'AAA',shares:2,amount:20,base:50000,target:10,note:'보존',buyPlan:{stages:[{id:'stage',price:40,shares:1,amount:5,done:true}]}}]},
  {id:'g2',name:'가상 계좌 2',classId:'stock',items:[{id:'b',name:'다른 계좌 ETF',ticker:'AAA',shares:3,averagePrice:100,amount:30,base:60000},{id:'missing',name:'평균가 없는 ETF',ticker:'AAA',shares:1},{id:'domestic',name:'가상 국내 ETF',ticker:'111111',shares:4,averagePrice:10000}]}]}});
const quoteFixture=()=>({stocks:{AAA:{kind:'해외',close:60,asOf:'2026-01-02'},'111111':{kind:'국내',close:12000,asOf:'2026-01-02'}},fx:{close:1200,asOf:'2026-01-02'}});
function page(data=fixture(),quotes=quoteFixture()){
  const nodes=new Map(),storage=new Map(),writes=[],alerts=[];let averageButtons=[];
  const document={activeElement:null,getElementById:node,querySelector:node,querySelectorAll:sel=>sel==='[data-average-price]'?averageButtons:sel==='dialog [data-close]'?[node('averageCancel')]:[],addEventListener(){}};
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='',value='';const attrs=new Map();
    const n={id,dataset:{},hidden:false,open:false,textContent:'',style:{},classList:{toggle(){},contains(){return false;}},tagName:'DIV',
      querySelector:sel=>node(`${id}:${sel}`),querySelectorAll:()=>[],setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),
      setCustomValidity(message){n.validationMessage=message;n.validity={valid:!message};},checkValidity:()=>!n.validationMessage,reportValidity(){n.reported=true;},
      focus(){document.activeElement=n;},blur(){if(document.activeElement===n)document.activeElement=null;},
      showModal(){n.open=true;},close(){n.open=false;document.activeElement=null;},closest:sel=>sel==='dialog'?node('averagePriceDialog'):null,
      click(){return n.onclick?.();}};
    Object.defineProperty(n,'value',{get:()=>value,set:v=>{value=String(v);}});
    Object.defineProperty(n,'innerHTML',{get:()=>html,set:v=>{
      html=String(v);
      if(id!=='allocView'&&id!=='strategyView')return;
      if(!html){averageButtons=[];return;}
      averageButtons=[...html.matchAll(/<button\b[^>]*data-average-price="([^"]+)"[^>]*>/g)].map(m=>{
        const b=node(`averageButton:${m[1]}`);b.dataset.averagePrice=m[1];return b;
      });
    }});
    nodes.set(id,n);return n;
  }
  node('averagePriceInput').tagName='INPUT';node('averagePriceForm').elements={averagePrice:node('averagePriceInput')};
  const store={doc:data,prices:quotes,saveSection(section){writes.push(section);storage.set('etf-planner-assets-v1',JSON.stringify(data));}};
  const ctx=vm.createContext({document,assetStore:store,URLSearchParams,crypto:require('node:crypto').webcrypto,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    addEventListener(){},setTimeout:fn=>{fn();return 1;},alert:message=>alerts.push(message)});
  vm.runInContext(source,ctx);ctx.openTab('alloc');
  const html=()=>node('allocView').innerHTML;
  const row=id=>{const start=html().indexOf(`data-alloc-item="${id}"`);assert.ok(start>=0,`종목 줄 ${id}`);const rest=html().slice(start),end=rest.search(/class="asset-row|class="group-foot"/);return end<0?rest:rest.slice(0,end);};
  return {ctx,data,store,node,html,row,writes,alerts,storage,input:node('averagePriceInput'),
    open(id){const b=averageButtons.find(b=>b.dataset.averagePrice===id);assert.ok(b?.onclick,'평균매수가 버튼 이벤트');b.click();},
    edit(value){node('averagePriceInput').value=value;node('averagePriceInput').oninput();},
    submit(){node('averagePriceForm').onsubmit({preventDefault(){}});},cancel(){node('averageCancel').click();},
    refresh(quotes){store.prices=quotes;vm.runInContext('prices=assetStore.prices;render()',ctx);}};
}

test('평균매수가 미입력 종목에는 손익을 표시하지 않으며 조회·취소는 저장하지 않는다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);
  assert.match(h.row('a'),/평균매수가 입력/);assert.doesNotMatch(h.row('a'),/평가손익|손익률/);
  assert.match(h.row('b'),/profit-loss[^>]*">−\$120/);assert.match(h.row('domestic'),/profit-gain[^>]*">\+8,000원/);
  h.open('a');assert.equal(h.node('averagePriceDialog').open,true);assert.equal(h.input.value,'');
  assert.match(h.node('averagePriceLabel').textContent,/달러 \(USD\)/);assert.match(h.node('averagePriceHolding').innerHTML,/보유 수량 <b>2주/);
  h.edit('50');assert.match(h.node('averagePricePreview').innerHTML,/\+\$20/);assert.match(h.node('averagePricePreview').innerHTML,/\+20%/);
  assert.equal(JSON.stringify(data),before,'입력 중 미리보기는 저장 객체를 변경하지 않음');
  h.cancel();assert.equal(h.node('averagePriceDialog').open,false);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);assert.equal(h.storage.has('etf-planner-assets-v1'),false);
  h.open('a');assert.equal(h.input.value,'','취소한 초안이 다음 입력값에 남지 않음');
});

test('평균매수가 추가·수정·빈칸 삭제는 선택 계좌 필드만 저장하며 기존 보유·기준가·계획을 보존한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data),item=data.allocation.groups[0].items[0];
  for(const [value,expected]of [['50',50],['75.25',75.25],['',undefined]]){
    const prior=JSON.parse(JSON.stringify(data));h.open('a');h.edit(value);h.submit();
    assert.equal(item.averagePrice,expected);if(expected===undefined)assert.equal(Object.hasOwn(item,'averagePrice'),false,'빈 선택 필드는 delete');
    if(expected===undefined)delete prior.allocation.groups[0].items[0].averagePrice;else prior.allocation.groups[0].items[0].averagePrice=expected;
    assert.equal(JSON.stringify(data),JSON.stringify(prior),'다른 계좌·수량·평가기준·계획에는 변경 없음');
    assert.equal(h.node('averagePriceDialog').open,false);
  }
  assert.deepEqual(h.writes,['allocation','allocation','allocation']);assert.equal(JSON.stringify(data),before,'추가 후 삭제하면 원래 기록과 같다');
  h.open('a');h.submit();assert.equal(h.writes.length,3,'변경 없는 빈칸 저장은 쓰지 않음');
  h.open('b');h.submit();assert.equal(h.writes.length,3,'기존 가격 그대로 저장해도 쓰지 않음');
});

test('평균매수가 0·음수·잘못된 값은 저장을 막고 창과 기존 기록을 유지한다',()=>{
  const data=fixture(),before=JSON.stringify(data),h=page(data);h.open('b');
  for(const value of ['0','-1','-0.5','invalid','Infinity']){
    h.edit(value);h.submit();assert.equal(h.node('averagePriceDialog').open,true);assert.equal(h.input.checkValidity(),false);assert.match(h.input.validationMessage,/0보다 큰 숫자/);
    assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
  }
  h.edit('1e20');h.submit();assert.equal(h.node('averagePriceDialog').open,true);assert.match(h.input.validationMessage,/범위를 초과/);assert.equal(JSON.stringify(data),before);assert.deepEqual(h.writes,[]);
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

test('평균매수가 창의 취소·닫기 버튼은 제출하지 않으며 손익 안내와 소수 입력 접근성을 제공한다',()=>{
  const modal=read('assets.html').split('<dialog id="averagePriceDialog">')[1].split('</dialog>')[0];
  assert.equal([...modal.matchAll(/type="button" data-close/g)].length,2);assert.match(modal,/name="averagePrice"[^>]*step="any"[^>]*inputmode="decimal"/);assert.match(modal,/name="averagePrice"[^>]*max="9007199254740991"/);
  assert.match(modal,/aria-describedby="averagePriceHint"/);assert.match(modal,/id="averagePricePreview"[^>]*role="status"[^>]*aria-live="polite"/);
});
