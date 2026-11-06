// 가짜 상태와 DOM만 사용한다. 투자 입력·원천 네트워크·실제 알림은 사용하지 않는다.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/gold-estimate.js'),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const at='2026-11-06T10:12:00+09:00',later='2026-11-06T10:42:00+09:00',ACK='etf-planner-gold-estimate-ack';
const item={ticker:'GLDM',section:'금(골드)'},allocation={groups:[{items:[item]}]};
const state=(extra={})=>({at,ran:true,computed:0,holds:{current:1},streak:3,since:at,last:{code:'current',at},...extra});
const documentOf=s=>({updatedAt:s.at,stocks:{GLDM:{kind:'해외',asOf:'2026-11-05',close:80,ma:{}}},goldEstimateStatus:s});
class Node{
  constructor(){this.open=false;this.textContent='';this.children=[];this.events={};this.opens=0;}
  set innerHTML(_){throw Error('팝업은 textContent로만 출력해야 함');}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  replaceChildren(...nodes){this.children=nodes;}
  showModal(){this.open=true;this.opens++;}
  close(){this.open=false;this.onclose?.();}
  click(){this.onclick?.();}
}
function setup({page='planner',status=state(),targets=true,shared=new Map(),blocked=false,readFails=false,writeFails=false}={}){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const events=new Map(),documentEvents=new Map(),subscriptions=[],dialog=node('goldEstimateDialog'),other=node('otherDialog');other.open=blocked;
  let data=documentOf(status);
  const context={localStorage:{getItem:key=>{if(readFails)throw Error('read');return shared.get(key)??null;},setItem:(key,value)=>{if(writeFails)throw Error('write');shared.set(key,value);}},
    document:{getElementById:node,createElement:()=>new Node(),querySelector:()=>other.open?other:null,addEventListener:(type,fn)=>documentEvents.set(type,fn)},
    addEventListener:(type,fn)=>events.set(type,fn),setTimeout:fn=>fn()};
  const api=vm.runInNewContext(source+';goldEstimate',context);
  const alloc=targets?allocation:{groups:[{items:[{ticker:'GLDM',section:'현금'}]}]};
  // 두 시작 파일이 전달하는 가격 공급자(플래너 priceData / 자산 assetStore.prices)를 각각 실행한다.
  context.priceData=data;context.assetStore={prices:data,doc:{allocation:alloc}};
  api.initialize({prices:()=>page==='planner'?context.priceData:context.assetStore.prices,allocation:()=>context.assetStore.doc.allocation,subscribe:fn=>subscriptions.push(fn)});
  dialog.onclose=()=>documentEvents.get('close')?.({target:dialog});
  return {api,context,node,dialog,other,shared,events,subscriptions,
    text:()=>node('goldEstimateProblems').children.map(n=>n.textContent).join('\n'),
    update:s=>{data=documentOf(s);context.priceData=data;context.assetStore.prices=data;subscriptions.forEach(fn=>fn('prices'));},
    closeOther:()=>{other.open=false;documentEvents.get('close')?.({target:other});},confirm:()=>node('goldEstimateConfirm').click()};
}

test('상태는 이번 updatedAt·정수·고정 코드·ISO 시각을 검증하고 알 수 없는 필드를 버린다',()=>{
  const api=vm.runInNewContext(source+';goldEstimate'),original=state();
  assert.equal(api.validateStatus(original,at).streak,3);
  for(const extra of [{at:later},{ran:1},{computed:true},{computed:-1},{streak:1.5},{streak:Number.MAX_SAFE_INTEGER+1},
    {holds:{attacker:1}},{holds:{source:'1'}},{holds:{source:Infinity}},{since:'bad'},
    {last:{code:'attacker',at}},{lastError:{code:'source',at}},{lastError:{code:'refresh',at:later}},{error:'source'}])
    assert.equal(api.validateStatus({...original,...extra},at),null,JSON.stringify(extra));
  assert.equal(Object.hasOwn(api.validateStatus({...original,unsafe:'<img src=x onerror=alert(1)>'},at),'unsafe'),false);
  const attached=api.attachStatus({updatedAt:at,stocks:{},goldEstimateStatus:original},{updatedAt:at,goldEstimateStatus:{...original,ran:'yes'}});
  assert.equal(Object.hasOwn(attached,'goldEstimateStatus'),false);
  assert.equal(api.attachStatus({updatedAt:at,stocks:{}},{updatedAt:at}).goldEstimateStatus,undefined);
});

test('카드 경고 우선순위·한국 시간·비대상·잘못된 상태와 옛 문서 호환',()=>{
  const api=vm.runInNewContext(source+';goldEstimate');
  const error=state({lastError:{code:'refresh',at}});
  assert.equal(api.notice(documentOf(error),item,allocation).kind,'error');
  assert.match(api.notice(documentOf(error),item,allocation).text,/오류\(수집 계산\).*11\/06 10:12\(한국 시간\)/);
  assert.match(api.notice(documentOf(state({lastError:{code:'compile',at}})),item,allocation).text,/오류\(알림 계산\)/);
  assert.equal(api.notice(documentOf(state()),item,allocation).kind,'streak');
  assert.match(api.notice(documentOf(state()),item,allocation).text,/마지막 사유: 최근 30분 시세 없음/);
  assert.equal(api.notice(documentOf(state({streak:2})),item,allocation).kind,'hold');
  assert.equal(api.notice(documentOf(state({streak:2,ran:false})),item,allocation),null);
  assert.equal(api.notice(documentOf(error),{ticker:'GDX',section:'금'},allocation),null);
  assert.equal(api.notice(documentOf({...error,at:'bad'}),item,allocation),null);
  assert.equal(api.notice({updatedAt:at,stocks:{}},item,allocation),null);
});

for(const page of ['planner','assets']){
  test(`${page}: 캐시 오류·연속 보류를 모달 하나에 오류부터 보여 주고 확인한 키는 다시 띄우지 않는다`,()=>{
    const h=setup({page,status:state({lastError:{code:'refresh',at}})});
    assert.equal(h.dialog.open,true);assert.equal(h.dialog.opens,1);
    assert.equal(h.node('goldEstimateProblems').children.length,2);
    assert.match(h.node('goldEstimateProblems').children[0].textContent,/오류 · 수집 계산 오류/);
    assert.match(h.node('goldEstimateFallback').textContent,/금 추정 없이 GLDM 종가로 판정·알림/);
    assert.match(h.node('goldEstimateHelp').textContent,/KIS 시세 수집.*금 추정/);
    h.confirm();h.api.check();assert.equal(h.dialog.open,false);
    assert.deepEqual(JSON.parse(h.shared.get(ACK)),[`error:refresh:${at}`,`streak:${at}`]);
    h.update(state({at:later,lastError:{code:'compile',at:later}}));assert.equal(h.dialog.open,true);
    assert.equal(h.node('goldEstimateProblems').children.length,1,'확인한 streak 키는 제외');
    h.confirm();h.update(state({at:later,since:later,last:{code:'base',at:later}}));assert.equal(h.dialog.open,true);
    assert.match(h.text(),/뉴욕 마감 시점 시세 없음/);
    h.confirm();const loaded=setup({page,status:state({at:later,since:later,last:{code:'base',at:later}}),shared:h.shared});
    assert.equal(loaded.dialog.open,false,'다음 페이지에서도 기기 ACK를 공유');
  });
  test(`${page}: 다른 dialog 종료까지 기다리고 1~2회 보류·비대상에는 팝업을 띄우지 않는다`,()=>{
    const h=setup({page,blocked:true});assert.equal(h.dialog.open,false);h.api.check();assert.equal(h.dialog.open,false);
    h.closeOther();assert.equal(h.dialog.open,true);
    for(const streak of [1,2])assert.equal(setup({page,status:state({streak})}).dialog.open,false);
    assert.equal(setup({page,targets:false}).dialog.open,false);
    assert.equal(setup({page,status:state({holds:{unknown:1}})}).dialog.open,false);
  });
  test(`${page}: localStorage 읽기·쓰기 예외에서도 확인·화면 갱신이 동작한다`,()=>{
    const h=setup({page,readFails:true,writeFails:true});assert.equal(h.dialog.open,true);
    assert.doesNotThrow(h.confirm);h.api.check();assert.equal(h.dialog.open,false);
    h.update(state({at:later,since:later,last:{code:'source',at:later}}));assert.equal(h.dialog.open,true);
    assert.doesNotThrow(h.confirm);
  });
}

test('ACK는 JSON 배열의 최근 20개 키만 저장하고 다른 탭 확인도 반영한다',()=>{
  const shared=new Map([[ACK,JSON.stringify(Array.from({length:25},(_,i)=>`streak:2026-10-${String(i+1).padStart(2,'0')}T10:00:00Z`))]]);
  const h=setup({shared});h.confirm();assert.equal(JSON.parse(shared.get(ACK)).length,20);
  const pending=setup({status:state({at:later,since:later,last:{code:'source',at:later}}),blocked:true,shared});
  shared.set(ACK,JSON.stringify([`streak:${later}`]));pending.events.get('storage')({key:ACK});pending.closeOther();
  assert.equal(pending.dialog.open,false);
});

test('두 페이지의 dialog·초기화가 있고 확인 버튼 하나와 고정 안내만 사용한다',()=>{
  for(const [html,start] of [['index.html','js/start.js'],['assets.html','js/assets-start.js']]){
    const markup=fs.readFileSync(path.join(__dirname,'..',html),'utf8');
    const modal=markup.match(/<dialog id="goldEstimateDialog"[\s\S]*?<\/dialog>/)[0];
    assert.match(modal,/class="dialog-inner"/);assert.match(modal,/한국장 금 추정 문제/);
    assert.equal((modal.match(/<button /g)||[]).length,1);assert.match(modal,/>확인<\/button>/);
    assert.match(fs.readFileSync(path.join(__dirname,'..',start),'utf8'),/goldEstimate\.initialize\(/);
  }
});
