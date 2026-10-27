const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 계좌 조회와 실제 계좌 선택 창을 함께 실행한다. 종목·보유·체결은 모두 가상 값이다.
const code=['ma-ladder.js','assets-calc.js','alloc-link.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const plain=v=>JSON.parse(JSON.stringify(v));
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setup(){
  const allocation={total:1000,classes:[],cash:[],groups:[
    {id:'ga',name:'가상 계좌 A',items:[{id:'a',name:'가상 ETF',ticker:'900001',shares:100}]},
    {id:'gb',name:'가상 계좌 B',items:[{id:'b',name:'가상 ETF',ticker:'900001',shares:50}]},
    {id:'gz',name:'가상 계좌 C',items:[{id:'z',name:'가상 ETF',ticker:'900001',shares:0,amount:99}]},
    {id:'gm',name:'가상 금액 계좌',items:[{id:'m',name:'가상 금액 ETF',ticker:'900002',amount:100,base:10000}]}
  ]};
  const prices={stocks:{'900001':{kind:'국내',close:10000,asOf:'2026-01-05'},'900002':{kind:'국내',close:20000,asOf:'2026-01-05'}}};
  const nodes={},node=id=>nodes[id]||=( {textContent:'',innerHTML:'',showModal(){this.open=true;}} );
  const store={doc:{allocation},prices,saveSection(){throw Error('조회 중 저장 금지');}};
  const ctx=vm.createContext({assetStore:store,$:node,$$:()=>[],esc:escape});
  const api=vm.runInContext(`${code}\n;allocLink`,ctx);
  return {api,allocation,prices,nodes,node};
}
const record=(id,shares,at)=>({at,items:[{id,shares}]});

test('기본 계좌는 손절·재매수의 출처별 우선순위를 따르고 실제 체결 창과 같다',()=>{
  const {api,allocation,node}=setup();
  allocation.trades={
    'cut:r:0':record('a',-3,'2026-01-01T00:00:00Z'),
    'cut:r:1':record('b',-2,'2026-01-03T00:00:00Z'),
    'rebuy:r:25선:0':record('z',1,'2026-01-02T00:00:00Z'),
    'cut:other:0':record('a',-1,'2026-01-04T00:00:00Z')
  };
  const cases=[
    {prefer:['cut:r:'],expected:'가상 계좌 B'},
    {prefer:['rebuy:r:','cut:r:'],expected:'가상 계좌 C'},
    {prefer:['rebuy:new:','cut:r:'],expected:'가상 계좌 B'},
    {ownId:'z',expected:'가상 계좌 C'},
    {expected:'가상 계좌 A'}
  ];
  const before=JSON.stringify([allocation]);
  for(const {expected,...o} of cases){
    const options={ticker:'A900001',...o},choice=api.accountChoice(options);
    assert.deepEqual(plain(choice),{name:`${expected} · 가상 ETF`,count:3});
    api.check({...options,trade:{sign:1,qty:2,price:10000,currency:'KRW'},label:'가상 재매수',commit(){throw Error('선택 전에 체결 금지');}});
    assert.equal(node('linkDialog').open,true);
    const picked=node('linkRows').innerHTML.match(/class="link-row picked"[^]*?<small>([^<]+)<\/small>/)?.[1];
    assert.ok(picked?.startsWith(expected+' · '),`${choice.name}와 실제 창 선택이 같아야 한다`);
  }
  assert.equal(JSON.stringify([allocation]),before,'기본 계좌를 조회하거나 선택 창을 열어도 보유·기록을 바꾸지 않는다');
});

test('연결 없는 종목은 기본 계좌가 없고 한 계좌는 이름과 개수를 돌려준다',()=>{
  const {api}=setup();
  assert.equal(api.accountChoice({ticker:'없는 종목'}),null);
  assert.deepEqual(plain(api.accountChoice({ticker:'900002'})),{name:'가상 금액 계좌 · 가상 금액 ETF',count:1});
});

test('회차별 실제 반영은 손절·매수와 여러 계좌 전부를 구분하고 읽기만 한다',()=>{
  const {api,allocation,prices}=setup();
  allocation.trades={
    'cut:r:0':{items:[{id:'a',shares:-3},{id:'b',shares:-2},{id:'z',shares:0}]},
    'rebuy:r:25선:0':{items:[{id:'b',shares:4}]},
    'cut:r:1':{items:[{id:'m',amount:-10}]}
  };
  const before=JSON.stringify([allocation,prices]);
  assert.equal(api.accountRecord('cut:r:0'),'가상 계좌 A · 가상 ETF −3주 · 가상 계좌 B · 가상 ETF −2주 · 가상 계좌 C · 가상 ETF +0주');
  assert.equal(api.accountRecord('rebuy:r:25선:0'),'가상 계좌 B · 가상 ETF +4주');
  assert.equal(api.accountRecord('cut:r:1'),'가상 금액 계좌 · 가상 금액 ETF −20만원','금액은 기존 반영 설명과 같은 지금 평가액으로 환산');
  assert.equal(JSON.stringify([allocation,prices]),before);
});

test('옛 단계 별칭은 첫 존재 기록을 쓰며 기록 없음·삭제된 계좌를 임의로 추정하지 않는다',()=>{
  const {api,allocation}=setup();
  allocation.trades={
    'rebuy:r:25분봉:0':{items:[{id:'b',shares:2}]},
    'rebuy:r:삭제:0':{items:[{id:'gone',shares:3},{id:'a',shares:1}]},
    'cut:r:empty':{items:[]}
  };
  assert.equal(api.accountRecord(['rebuy:r:25선:0','rebuy:r:25분봉:0']),'가상 계좌 B · 가상 ETF +2주');
  allocation.trades['rebuy:r:25선:0']={items:[{id:'a',shares:5}]};
  assert.equal(api.accountRecord(['rebuy:r:25선:0','rebuy:r:25분봉:0']),'가상 계좌 A · 가상 ETF +5주');
  assert.equal(api.accountRecord('rebuy:r:삭제:0'),'삭제된 계좌·자산 · 가상 계좌 A · 가상 ETF +1주');
  for(const key of ['cut:r:missing','cut:r:empty',[],['absent','also absent']])assert.equal(api.accountRecord(key),'자산 배분 반영 기록 없음');
  delete allocation.trades;
  assert.equal(api.accountRecord('cut:r:0'),'자산 배분 반영 기록 없음');
});

test('계좌 이름은 HTML이 아닌 일반 글자로 돌려주어 호출부에서 한 번만 이스케이프한다',()=>{
  const {api,allocation}=setup();
  allocation.groups[0].name='<계좌 & A>';
  allocation.groups[0].items[0].name='"가상 ETF"';
  allocation.trades={'cut:r:0':{items:[{id:'a',shares:-1}]}};
  const name=api.accountChoice({ticker:'900001'}).name,text=api.accountRecord('cut:r:0');
  assert.equal(name,'<계좌 & A> · "가상 ETF"');
  assert.equal(text,'<계좌 & A> · "가상 ETF" −1주');
  assert.equal(escape(text),'&lt;계좌 &amp; A&gt; · &quot;가상 ETF&quot; −1주');
  assert.doesNotMatch(text,/&lt;|&amp;|&quot;/);
});
