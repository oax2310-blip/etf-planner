const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../js',file),'utf8');

// 실제 연동 창·공용 금액 처리·자산 반영을 함께 실행한다. 금액과 수량을 가진 가상 계좌를 섞는다.
function setup(){
  const allocation={total:100000,classes:[],cash:[],groups:[{id:'g',name:'예시 계좌',items:[
    {id:'money',name:'예시 금액 종목',ticker:'111111',amount:20000},
    {id:'shares',name:'예시 수량 종목',ticker:'111111',shares:30000}]}]};
  const doc={version:1,allocation},nodes=new Map(),listeners=[],fields=[],buttons=[],writes=[];
  let commits=0;
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const x={id,value:'',attrs:{},dataset:{},events:{},open:false,validationMessage:'',classList:{toggle(){},add(){},remove(){}},
      getAttribute(key){return this.attrs[key]??null;},setAttribute(key,value){this.attrs[key]=String(value);},setCustomValidity(message){this.validationMessage=message;},
      matches:selector=>selector==='input[data-money]'&&Object.hasOwn(x.attrs,'data-money'),setSelectionRange(){},
      checkValidity(){
        if(this.validationMessage)return false;if(this.attrs.type!=='number'||this.value==='')return true;
        const n=Number(this.value),step=Number(this.attrs.step);
        return Number.isFinite(n)&&n>=Number(this.attrs.min)&&(!step||Number.isInteger(n/step));
      },reportValidity(){this.reported=true;return this.checkValidity();},
      closest:()=>({classList:{toggle(name,on){x.picked=on;}}}),focus(){},
      addEventListener(type,fn){this.events[type]=fn;},querySelectorAll:()=>[],showModal(){this.open=true;},close(){this.open=false;}};
    nodes.set(id,x);return x;
  };
  Object.defineProperty(node('linkRows'),'innerHTML',{set(html){
    fields.length=buttons.length=0;
    for(const [,tag,raw] of html.matchAll(/<(input|button)\b([^>]*)>/g)){
      const attrs=Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key,value??'']));
      const x=node(tag+':'+(attrs['data-link-n']??attrs['data-link-pick']));x.attrs=attrs;x.value=attrs.value??'';
      x.dataset=Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,ch)=>ch.toUpperCase()),value]));
      if(tag==='input')fields.push(x);else buttons.push(x);
    }
  }});
  const document={body:{append(){}},createElement:()=>node('toast'),addEventListener(type,fn){if(type==='input')listeners.push(fn);},querySelectorAll:()=>fields.filter(x=>x.matches('input[data-money]'))};
  const store={doc,prices:{stocks:{'111111':{kind:'국내',close:10000,asOf:'2026-01-02'}}},saveSection(){writes.push(JSON.parse(JSON.stringify(doc)));}};
  const context=vm.createContext({document,$:node,$$:selector=>selector==='[data-link-n]'?fields:selector==='[data-link-pick]'?buttons:[],assetStore:store,
    esc:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(['money-input.js','ma-ladder.js','assets-calc.js','alloc-link.js'].map(read).join('\n;\n'),context);
  const api=vm.runInContext('allocLink',context);api.initialize();
  const open=()=>api.check({ticker:'111111',label:'예시 매수',trade:{sign:1,value:12345,price:10000,currency:'KRW'},commit(){commits++;return 'example-trade';}});
  open();
  return {allocation,fields,buttons,writes,node,open,commits:()=>commits,
    type(x,value){x.value=value;listeners.forEach(fn=>fn({target:x}));x.oninput?.();},submit:()=>node('linkForm').events.submit({preventDefault(){}})};
}

test('연동 금액만 쉼표를 표시하며 계좌 선택·직접 입력·자산 저장을 숫자로 처리한다',()=>{
  for(const [raw,shown,value] of [['12345','12,345',12345],['1354.91','1,354.91',1354.91]]){
    const h=setup(),[money,shares]=h.fields,before=JSON.stringify(h.allocation);
    assert.equal(money.attrs.type,'text');assert.equal(money.attrs['data-money-min'],'0');assert.equal(money.attrs['data-money-step'],'any');
    assert.equal(shares.attrs.type,'number');assert.equal(shares.attrs.min,'0');assert.equal(shares.attrs.step,'1');
    h.buttons[0].onclick();assert.equal(money.value,'12,345','계좌 클릭으로 채운 값도 쉼표');assert.equal(shares.value,'');
    h.type(money,raw);assert.equal(money.value,shown);assert.equal(money.picked,true);assert.equal(JSON.stringify(h.allocation),before,'제출 전에 자산 변경 없음');
    h.submit();assert.equal(h.commits(),1);
    const saved=h.writes.at(-1).allocation,entry=saved.trades['example-trade'].items[0];
    assert.equal(entry.id,'money');assert.equal(entry.amount,value);assert.equal(typeof entry.amount,'number');
    assert.equal(saved.groups[0].items[0].amount,20000+value);h.open();
    h.buttons[0].onclick();assert.equal(h.fields[0].value,'12,345','다시 그린 계좌 칸도 쉼표');
  }
});

test('연동 금액의 음수·형식 오류와 기존 수량 간격 오류는 반영·저장을 막는다',()=>{
  const h=setup(),[money,shares]=h.fields,before=JSON.stringify(h.allocation);
  for(const value of ['-1','1e3','잘못된 금액']){
    money.value=value;h.submit();assert.ok(money.validationMessage);assert.equal(h.commits(),0);assert.equal(h.node('linkDialog').open,true);
    assert.equal(JSON.stringify(h.allocation),before);assert.equal(h.writes.length,0);
  }
  money.value='';shares.value='1.5';h.submit();assert.equal(shares.reported,true);assert.equal(h.commits(),0);
  shares.value='12345';h.submit();assert.equal(h.commits(),1);assert.equal(h.writes.at(-1).allocation.trades['example-trade'].items[0].shares,12345);
});
