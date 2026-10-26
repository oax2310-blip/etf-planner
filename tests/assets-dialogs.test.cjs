// 동기화가 입력창 뒤의 기록을 교체하는 경우. 모든 값은 테스트용 모의 기록이다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder','assets-calc','assets','assets-ledger'].map(name=>fs.readFileSync(path.join(__dirname,'../js',`${name}.js`),'utf8')).join('\n;\n');
const fixture=()=>({version:1,allocation:{classes:[{id:'c',name:'분류',region:'국내'}],groups:[{id:'g',name:'그룹',classId:'c',items:[{id:'i',name:'종목',ticker:'TEST',amount:100}]}],cash:[{id:'cash',name:'현금',currency:'KRW',amount:50}]},ledger:{years:[{year:2026,accounts:[],months:[{m:1,pnl:10,total:100,note:'원본'}]}]}});
function page(data=fixture()){
  const nodes=new Map(),alerts=[];let saves=0;
  const field=()=>({value:'',checked:false,disabled:false,readOnly:false,validity:{valid:true},focus(){},setCustomValidity(){},reportValidity(){return true;}});
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    let html='';
    const n={...field(),dataset:{},hidden:false,open:false,isConnected:true,classList:{toggle(){}},querySelector:sel=>node(`${id}:${sel}`),querySelectorAll:()=>[],showModal(){this.open=true;},close(){this.open=false;}};
    Object.defineProperty(n,'innerHTML',{get:()=>html,set:value=>{html=value;
      if(id==='monthFields')for(const match of value.matchAll(/<input\s([^>]*)>/g)){
        const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
        if(attrs.name){node('monthForm')[attrs.name]=field();node('monthForm')[attrs.name].value=attrs.value||'';}
      }
    }});
    const fields={itemForm:'group name section amount ticker shares target done note tradeTicker tradePrice',groupForm:'name classId target note',classForm:'name region target cash',cashForm:'place name amount currency minus',yearForm:'futures note'};
    for(const name of (fields[id]||'').split(' ').filter(Boolean))n[name]=field();
    nodes.set(id,n);return n;
  }
  const ctx=vm.createContext({document:{getElementById:node,querySelector:node,querySelectorAll:()=>[],addEventListener(){}},assetStore:{doc:data,prices:null,saveSection(){saves++;}},localStorage:{getItem(){return null;}},crypto:require('node:crypto').webcrypto,addEventListener(){},setTimeout(){},alert:msg=>alerts.push(msg),confirm:()=>true});
  vm.runInContext(source+'\n;render=()=>{};',ctx);
  return {ctx,node,alerts,saves:()=>saves,replace(next){ctx.nextDoc=next;vm.runInContext('doc=nextDoc;assetStore.doc=nextDoc;',ctx);},submit(form){node(form).onsubmit({preventDefault(){}});}};
}

for(const [name,open,form,button] of [
  ['종목',"openItem('i')",'itemForm','itemDelete'],['그룹',"openGroup('g')",'groupForm','groupDelete'],
  ['큰 분류',"openClass('c')",'classForm','classDelete'],['현금',"openCash('cash')",'cashForm','cashDelete'],
  ['월별',"openMonth(doc.ledger.years[0],1)",'monthForm','monthClear'],['연도',"openYear(doc.ledger.years[0])",'yearForm','yearDelete']
])test(`${name} 입력창: 동기화로 교체된 기록에 오래된 수정·삭제를 저장하지 않는다`,()=>{
  for(const action of ['submit','delete']){
    const data=fixture(),h=page(data);vm.runInContext(open,h.ctx);
    const next=structuredClone(data);next.allocation.cash[0].amount=75;next.ledger.years[0].months[0].pnl=20;
    const before=JSON.stringify(next),old=JSON.stringify(data);h.replace(next);
    if(action==='submit')h.submit(form);else h.node(button).onclick();
    assert.equal(JSON.stringify(next),before,`${action}: 새 기록 보존`);
    assert.equal(JSON.stringify(data),old,`${action}: 오래된 기록에도 쓰지 않음`);
    assert.equal(h.saves(),0,`${action}: 성공으로 표시하지 않음`);
    assert.ok(h.alerts.length,`${action}: 다시 열기 안내`);
  }
});

test('입력창: 기록이 바뀌지 않으면 자산과 월별 손익을 정상 저장한다',()=>{
  const data=fixture(),h=page(data);vm.runInContext("openCash('cash')",h.ctx);h.node('cashForm').amount.value='80';h.submit('cashForm');
  assert.equal(data.allocation.cash[0].amount,80);
  vm.runInContext('openMonth(doc.ledger.years[0],1)',h.ctx);h.node('monthForm').pnl.value='15';h.submit('monthForm');
  assert.equal(data.ledger.years[0].months[0].pnl,15);assert.equal(data.ledger.years[0].months[0].note,'원본');assert.equal(h.saves(),2);assert.deepEqual(h.alerts,[]);
});
