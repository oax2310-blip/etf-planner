// 배너·제외 확인·URL 진입을 가짜 DOM과 가상 기록으로 확인한다.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const plain=v=>JSON.parse(JSON.stringify(v));
const action=()=>({id:'TEST:2026-11-05:1:3',ticker:'TEST',kind:'split',from:1,to:3,exDate:'2026-11-05',basisThrough:'2026-11-04',detectedAt:'2026-11-05T12:00:00Z'});
class Node {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.hidden=false;this.disabled=false;this.open=false;this.text='';this.listeners={};}
  set textContent(v){this.text=String(v);this.children=[];}get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(v){throw Error('textContent 필요');}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=v;}
  addEventListener(type,fn){this.listeners[type]=fn;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
  click(){if(!this.disabled)this.onclick?.();}
}
function setup({assets=false,search='',logs,saveFails=false,name='가상 ETF'}={}){
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Node());return elements.get(id);},storage=new Map(),subscribers=[],events=new Map();
  const data={plans:[{ticker:'TEST',shares:9}],futures:{},...(logs?{splitLog:logs}:{})};
  storage.set('etf-exit-planner-standalone-v1',JSON.stringify(data));let clock=Date.parse('2026-11-05T14:00:00Z'),saves=0,opened=[];
  const context={Date:class extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}},URL,URLSearchParams,
    state:plain(data),sync:{busy:false,blocked:false},priceRefreshBusy:false,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    location:new URL('https://example.test/index.html'+search),history:{replaceState(_a,_b,url){context.location=new URL(url,context.location);}},
    document:{body:{classList:{contains:cls=>assets&&cls==='assets-page'}},hidden:false,getElementById:el,createElement:tag=>new Node(tag),querySelector:()=>[...elements.values()].find(e=>e.open)||null},
    stockNames:{lookup:()=>name},assetStore:{corporateActions:[action()],status:{busy:false,choice:false},priceRefreshing:false,subscribe:fn=>subscribers.push(fn),absorbLocal(){}},
    plannerCorporateActions:()=>context.assetStore.corporateActions,splitDialog:{openAuto:a=>{opened.push(plain(a));el('splitDialog').showModal();return true;}},
    id:()=> 'example-dismiss',absorbPlanner(){},save(next){saves++;if(saveFails)return false;context.state=plain(next);return true;},
    addEventListener:(type,fn)=>events.set(type,fn),setInterval(){}};
  const code=['split-auto.js','split-adjust.js','data-validation.js','split-notices.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;');
  const ui=vm.runInNewContext(code+'\nsplitNotices',context);ui.initialize();
  return {ui,context,el,storage,events,subscribers,opened,get saves(){return saves;},advance:ms=>{clock+=ms;}};
}
test('표시 이름을 textContent로 출력하고 확인·해당 없음을 누르기 전에는 기록을 쓰지 않는다',()=>{
  const h=setup({name:'<img src=x onerror=alert(1)>'});
  assert.match(h.el('splitNotices').textContent,/<img src=x onerror=alert\(1\)> 1→3 액면분할 감지 \(11\/5\)/);
  assert.match(h.el('splitNotices').textContent,/보유 수량·체결가 반영/);assert.equal(h.saves,0);
  h.el('splitNotices').children[0].children[1].children[0].click();assert.equal(h.opened[0].id,action().id);assert.equal(h.saves,0);
});
test('해당 없음은 확인 창·취소에서 쓰지 않고 최종 확인 때만 dismissed와 두 false 플래그를 보존한다',()=>{
  const h=setup(),before=JSON.stringify(h.context.state);
  h.ui.dismiss(action());assert.equal(h.el('splitDismissDialog').open,true);assert.equal(h.saves,0);h.el('splitDismissCancel').click();assert.equal(h.saves,0);
  h.ui.dismiss(action());h.el('splitDismissConfirm').click();assert.equal(h.saves,1);
  const entry=h.context.state.splitLog[0];assert.equal(entry.actionId,action().id);assert.equal(entry.source,'auto');assert.equal(entry.dismissed,true);assert.equal(entry.planner,false);assert.equal(entry.assets,false);
  assert.equal(h.context.state.plans[0].shares,JSON.parse(before).plans[0].shares);assert.equal(h.el('splitNotices').hidden,true);
});
test('0건 안내도 확인 전에는 저장하지 않고 저장 실패 시 배너와 기록을 보존한다',()=>{
  const h=setup({saveFails:true}),before=JSON.stringify(h.context.state);h.ui.dismiss(action(),true);
  assert.match(h.el('splitDismissReason').textContent,/바뀔 칸이 없습니다/);assert.equal(h.saves,0);h.el('splitDismissConfirm').click();
  assert.equal(JSON.stringify(h.context.state),before);assert.equal(h.el('splitDismissDialog').open,true);assert.match(h.el('splitDismissFeedback').textContent,/저장하지 못/);assert.equal(h.el('splitNotices').hidden,false);
});
test('시세·동기화 중에는 제외 확인을 막고 다른 화면에서 처리하면 중복 이력을 만들지 않는다',()=>{
  const h=setup();h.context.sync.busy=true;assert.equal(h.ui.dismiss(action()),false);assert.equal(h.saves,0);
  h.context.sync.busy=false;h.ui.dismiss(action());h.context.state.splitLog=[{actionId:action().id}];h.el('splitDismissConfirm').click();assert.equal(h.saves,0);assert.equal(h.el('splitNotices').hidden,true);
});
test('?split=은 초기 동기화 뒤 대기 감지만 한 번 열고 다른 검색 인자·해시를 보존한다',()=>{
  const h=setup({search:'?other=value&split='+encodeURIComponent(action().id)+'#plans'});assert.equal(h.opened.length,0);h.ui.openLocation();
  assert.equal(h.opened.length,1);assert.equal(h.context.location.search,'?other=value');assert.equal(h.context.location.hash,'#plans');h.ui.render();assert.equal(h.opened.length,1);assert.equal(h.saves,0);
  const done=setup({search:'?split='+encodeURIComponent(action().id),logs:[{actionId:action().id}]});done.ui.openLocation();assert.equal(done.opened.length,0);
  const forged=setup({search:'?split=forged'});forged.ui.openLocation();assert.equal(forged.opened.length,0);
});
test('자산 화면은 짧은 안내와 안전한 플래너 링크만 만들고 로컬 splitLog·30일 경과를 반영한다',()=>{
  const h=setup({assets:true}),link=h.el('splitNotices').children[0].children[1].children[0];
  assert.equal(link.href,'index.html?split='+encodeURIComponent(action().id));assert.equal(link.textContent,'플래너에서 확인');assert.equal(h.saves,0);
  h.storage.set('etf-exit-planner-standalone-v1',JSON.stringify({splitLog:[{ticker:'TEST',from:1,to:3,exDate:'2026-11-01'}]}));h.events.get('storage')({key:'etf-exit-planner-standalone-v1'});assert.equal(h.el('splitNotices').hidden,true);
  const stale=setup();stale.advance(31*86400000);stale.ui.render();assert.equal(stale.el('splitNotices').hidden,true);assert.equal(stale.saves,0);
});
