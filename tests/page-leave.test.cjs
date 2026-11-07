const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/page-leave.js'),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function page(){
  const listeners={},timers=new Map(),moves=[];
  let now=0,id=0;
  const location={href:'https://example.test/app/index.html',origin:'https://example.test',assign:href=>moves.push(href)};
  const context=vm.createContext({URL,location,document:{addEventListener:(type,fn)=>listeners[type]=fn},
    addEventListener:(type,fn)=>listeners[type]=fn,
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:key=>timers.delete(key)});
  const leave=vm.runInContext(source+'\npageLeave',context);
  function click({href='assets.html',attrs={},target, ...options}={}){
    const attributes={href,...attrs},link={hasAttribute:key=>Object.hasOwn(attributes,key),getAttribute:key=>attributes[key]??null};
    const event={button:0,defaultPrevented:false,target:target||{closest:selector=>{assert.equal(selector,'a[href]');return link;}},
      preventDefault(){this.defaultPrevented=true;},...options};
    listeners.click(event);return event;
  }
  async function advance(ms){
    now+=ms;
    for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}
    await turn();
  }
  return {leave,click,moves,timers,advance,show:()=>listeners.pageshow({persisted:true})};
}

test('pending이 있으면 기본 이동을 막고 4초를 기다리지 않고 flush 완료 즉시 이동한다',async()=>{
  const h=page(),work=deferred();let calls=0;
  h.leave.register({pending:()=>true,flush:()=>{calls++;return work.promise;}});
  assert.equal(h.click({href:'assets.html?tab=ledger#month'}).defaultPrevented,true);
  await turn();assert.equal(calls,1);assert.equal(h.moves.length,0);
  await h.advance(25);work.resolve();await turn();
  assert.deepEqual(h.moves,['https://example.test/app/assets.html?tab=ledger#month']);assert.equal(h.timers.size,0);
});

test('flush 실패·동기 예외도 4초를 기다리지 않고 이동한다',async()=>{
  for(const flush of [()=>Promise.reject(Error('synthetic failure')),()=>{throw Error('synthetic failure');}]){
    const h=page();h.leave.register({pending:()=>true,flush});
    assert.equal(h.click().defaultPrevented,true);await turn();
    assert.equal(h.moves.length,1);assert.equal(h.timers.size,0);
  }
});

test('flush가 끝나지 않아도 4초에 이동하고 나중에 완료돼도 다시 이동하지 않는다',async()=>{
  const h=page(),work=deferred();h.leave.register({pending:()=>true,flush:()=>work.promise});
  h.click();await turn();await h.advance(3999);assert.equal(h.moves.length,0);
  await h.advance(1);assert.equal(h.moves.length,1);
  work.resolve();await turn();await h.advance(4000);assert.equal(h.moves.length,1);
});

test('pending이 없으면 기본 이동을 막거나 flush하지 않는다',async()=>{
  const h=page();assert.equal(h.click().defaultPrevented,false);
  h.leave.register({pending:()=>false,flush:()=>assert.fail('대기 없음')});
  assert.equal(h.click().defaultPrevented,false);await turn();
  assert.equal(h.moves.length,0);assert.equal(h.timers.size,0);
});

test('새 탭·수정키·외부·다운로드·페이지 이동이 아닌 클릭에는 개입하지 않는다',async t=>{
  const cases={
    '가운데 버튼':{button:1},'오른쪽 버튼':{button:2},Ctrl:{ctrlKey:true},Meta:{metaKey:true},Shift:{shiftKey:true},Alt:{altKey:true},
    '새 탭':{attrs:{target:'_blank'}},'target 속성':{attrs:{target:'_self'}},'빈 target':{attrs:{target:''}},
    download:{attrs:{download:''}},'다른 사이트':{href:'https://other.test/assets.html'},
    '다른 프로토콜':{href:'http://example.test/assets.html'},'다른 포트':{href:'https://example.test:8443/assets.html'},
    JSON:{href:'data/example.json'},'문서 안 위치':{href:'#section'},'빈 주소':{href:''},'잘못된 주소':{href:'https://['},
    '링크 밖':{target:{closest:()=>null}},'다른 처리기가 막은 클릭':{defaultPrevented:true}
  };
  for(const [name,options] of Object.entries(cases))await t.test(name,async()=>{
    const h=page();h.leave.register({pending:()=>assert.fail('대상 링크 아님'),flush:()=>assert.fail('대상 링크 아님')});
    const event=h.click(options);assert.equal(event.defaultPrevented,!!options.defaultPrevented);
    await turn();assert.equal(h.moves.length,0);assert.equal(h.timers.size,0);
  });
});

test('등록자 중 pending인 flush만 모두 끝나면 이동한다',async()=>{
  const h=page(),work=deferred();let calls=0;
  h.leave.register({pending:()=>false,flush:()=>assert.fail('대기 아님')});
  h.leave.register({pending:()=>true,flush:()=>{calls++;return Promise.reject(Error('synthetic failure'));}});
  h.leave.register({pending:()=>true,flush:()=>{calls++;return work.promise;}});
  h.click();await turn();assert.equal(calls,2);assert.equal(h.moves.length,0);
  work.resolve();await turn();assert.equal(h.moves.length,1);
});

test('기다리는 동안 연속 클릭은 무시하고 첫 주소로 한 번만 이동한다',async()=>{
  const h=page(),work=deferred();let calls=0;
  h.leave.register({pending:()=>true,flush:()=>{calls++;return work.promise;}});
  assert.equal(h.click().defaultPrevented,true);
  assert.equal(h.click({href:'valuation.html'}).defaultPrevented,true);
  await turn();assert.equal(calls,1);
  work.resolve();await turn();
  assert.deepEqual(h.moves,['https://example.test/app/assets.html']);
});

test('뒤로 가기로 복원된 페이지에서는 다음 링크 이동도 처리한다',async()=>{
  const h=page();let calls=0;
  h.leave.register({pending:()=>true,flush:async()=>{calls++;}});
  h.click();await turn();h.show();h.click({href:'valuation.html'});await turn();
  assert.equal(calls,2);assert.equal(h.moves.length,2);
});
