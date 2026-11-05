const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// 실제 자산 기록 없이 공유 저장소의 상태 알림과 화면 초기화를 연결한다.
function assetsPage(failed=false){
  const nodes=new Map(),listeners=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',className:'',click(){return this.onclick?.();},showModal(){this.open=true;}});
    return nodes.get(id);
  };
  const store={doc:{version:1},prices:null,status:{state:'off'},localSaveFailed:failed,priceRefreshing:false,
    config:()=>null,recovery:()=>[],subscribe:fn=>listeners.push(fn),start(){}};
  const context=vm.createContext({assetStore:store,splitNotices:{initialize(){}},el:node,all:()=>[],doc:store.doc,prices:null,nf2:new Intl.NumberFormat('ko-KR'),
    location:{hash:'#alloc'},history:{replaceState(){}},openTab(){},addEventListener(){},scrollTo(){},priceCollectionLate:()=>false});
  vm.runInContext(read('js/assets-start.js'),context);
  return {store,node,emit:type=>listeners.forEach(fn=>fn(type))};
}

test('자산 경고는 첫 로딩·저장 실패·회복에 맞춰 바뀌며 기존 JSON 백업 버튼을 실행한다',()=>{
  const h=assetsPage();assert.equal(h.node('localSaveWarning').hidden,true);
  h.store.localSaveFailed=true;h.emit('local-save');
  assert.equal(h.node('localSaveWarning').hidden,false);
  assert.equal(h.node('assetLocalSaveMessage').textContent,'자산 기록을 이 기기 브라우저에 저장하지 못했습니다(저장 공간 부족 등). 페이지를 닫기 전에 JSON 백업을 받아 두세요.');
  assert.equal(h.node('assetLocalSaveExport').textContent,'JSON 백업');
  let exports=0;h.node('exportBtn').onclick=()=>exports++;h.node('assetLocalSaveExport').click();assert.equal(exports,1);
  for(const state of ['off','error','choose','pending','busy','done']){
    h.store.status={state,at:'가상 시각',message:'가상 오류'};h.emit('status');
    assert.equal(h.node('localSaveWarning').hidden,false,'동기화 성공은 저장 경고를 지우지 않음');
    assert.equal(h.node('syncStatus').textContent,'이 기기 저장 실패');assert.equal(h.node('syncDialogStatus').textContent,'이 기기 저장 실패');
  }
  h.store.localSaveFailed=false;h.emit('local-save');
  assert.equal(h.node('localSaveWarning').hidden,true);assert.equal(h.node('syncStatus').textContent,'동기화 완료 · 가상 시각');
  assert.equal(assetsPage(true).node('localSaveWarning').hidden,false,'이미 실패한 상태로 초기화해도 표시');
});

test('두 페이지의 저장 경고는 접히는 머리 밖 본문 처음에 있고 모든 탭이 같은 경고를 공유한다',()=>{
  for(const file of ['index.html','assets.html']){
    const html=read(file),headerEnd=html.indexOf('</header>'),main=html.indexOf('<main>'),warning=html.indexOf('id="localSaveWarning"'),firstView=html.search(/<section id="\w+View"/);
    assert.ok(headerEnd<main&&main<warning&&warning<firstView,file);
    assert.match(html,/<div id="localSaveWarning" class="save-warning" role="alert" hidden>/);
    assert.equal((html.match(/id="localSaveWarning"/g)||[]).length,1,file);
  }
  const html=read('index.html');
  for(const id of ['plannerLocalSaveWarning','plannerLocalSaveMessage','plannerLocalSaveExport','assetLocalSaveWarning','assetLocalSaveMessage','assetLocalSaveExport'])assert.ok(html.includes(`id="${id}"`),id);
  const css=read('css/app.css'),warningCss=css.slice(css.indexOf('.save-warning{'),css.indexOf('\n',css.indexOf('.save-warning{')));
  assert.deepEqual([...new Set([...warningCss.matchAll(/var\((--[^)]+)\)/g)].map(m=>m[1]))].sort(),['--warn','--warn-line']);
  assert.doesNotMatch(warningCss,/#[\da-f]{3,8}\b|rgb\(/i,'밝고 어두운 테마의 기존 경고 토큰만 사용');
});
