const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 실제 자산 연결 계산과 저장 실패를 함께 실행한다. 운영 기록·브라우저 저장소는 사용하지 않는다.
function setup(saved){
  const item={id:'a',name:'모의 계좌',ticker:'AAA',shares:10.25},allocation={groups:[{id:'g',items:[item]}]};
  const messages=[];let saves=0;
  const node=()=>({textContent:'',setAttribute(){},classList:{add(){},remove(){}}});
  const context=vm.createContext({assetStore:{doc:{allocation},prices:null,saveSection(){saves++;return typeof saved==='function'?saved(saves,this.doc.allocation):saved;}},
    document:{createElement:node,body:{append(el){messages.push(el);}}},setTimeout(){return 1;},clearTimeout(){},confirm:()=>true});
  const source=['ma-ladder','assets-calc','alloc-link'].map(name=>fs.readFileSync(path.join(__dirname,'../js',name+'.js'),'utf8')).join('\n;\n');
  const api=vm.runInContext(source+'\n;({allocLink,applyTrade})',context);
  const key='buy:a:0',trade={sign:1,qty:2,value:2};
  return {item,allocation,store:context.assetStore,key,trade,api,messages,saves:()=>saves,seed(){api.applyTrade(allocation,null,key,trade,'모의 매수',[{id:'a',unit:'shares',n:2}]);}};
}

for(const action of ['check','uncheck','forget','rescale','shift'])test(`자산 연결 ${action}: 저장 실패를 성공으로 알리지 않고 정상 저장은 알린다`,()=>{
  for(const saved of [false,true]){
    const h=setup(saved),{allocLink}=h.api;
    if(action!=='check')h.seed();
    if(action==='check')allocLink.check({ticker:'AAA',trade:h.trade,label:'모의 매수',picks:[{id:'a',unit:'shares',n:2}],commit:()=>h.key});
    if(action==='uncheck')allocLink.uncheck(h.key);
    if(action==='forget')allocLink.forget([h.key],'모의 매수');
    if(action==='rescale')allocLink.rescale(h.key,{qty:3,value:3});
    if(action==='shift')allocLink.shift({key:h.key,ticker:'AAA',targetId:'a',trade:{sign:1,qty:1},total:{qty:3,value:3}});
    assert.equal(h.saves(),1,'실제 변경을 한 번 저장');
    assert.equal(h.messages.length,saved?1:0,'저장 결과를 확인한 뒤 성공 알림');
  }
});

test('자산 저장 실패 뒤 같은 누적 체결 재입력은 한 번 저장하며 교체된 문서에 옛 재시도 표식을 적용하지 않는다',()=>{
  let durable=null;
  const h=setup((calls,a)=>{if(calls===1)return false;durable=JSON.parse(JSON.stringify(a));return true;});
  h.api.allocLink.check({ticker:'AAA',trade:h.trade,label:'모의 매수',picks:[{id:'a',unit:'shares',n:2}],commit:()=>h.key});
  assert.equal(h.saves(),1);assert.equal(durable,null);assert.equal(h.item.shares,12.25);
  h.api.allocLink.rescale(h.key,h.trade);
  assert.equal(h.saves(),2);assert.equal(durable.groups[0].items[0].shares,12.25);assert.equal(durable.trades[h.key].qty,2);
  h.api.allocLink.rescale(h.key,h.trade);assert.equal(h.saves(),2,'같은 입력을 한 번 더 해도 저장을 반복하지 않는다');

  const replaced=setup(false);replaced.seed();replaced.api.allocLink.rescale(replaced.key,{qty:3,value:3});
  assert.equal(replaced.saves(),1);
  const next=JSON.parse(JSON.stringify(replaced.allocation));next.groups[0].items[0].shares=100;
  replaced.store.doc.allocation=next;
  replaced.api.allocLink.rescale(replaced.key,{qty:3,value:3});
  assert.equal(replaced.saves(),1,'문서가 교체되면 옛 실패 표식으로 새 문서를 저장하지 않는다');
  assert.equal(next.groups[0].items[0].shares,100);
});

test('자산 취소 저장 실패 뒤 재시도는 반영 기록이 메모리에서 지워졌어도 원래 소수 잔고를 저장한다',()=>{
  let durable=null;
  const h=setup((calls,a)=>{if(calls===1)return false;durable=JSON.parse(JSON.stringify(a));return true;});h.seed();
  h.api.allocLink.uncheck(h.key);
  assert.equal(h.saves(),1);assert.equal(h.item.shares,10.25);assert.equal(h.allocation.trades,undefined);assert.equal(durable,null);
  h.api.allocLink.uncheck(h.key);
  assert.equal(h.saves(),2);assert.equal(durable.groups[0].items[0].shares,10.25);assert.equal(durable.trades,undefined);
  h.api.allocLink.uncheck(h.key);assert.equal(h.saves(),2);
});
