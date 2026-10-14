const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=['repo-security.js','price-collection.js'].map(n=>fs.readFileSync(path.join(__dirname,'../js',n),'utf8')).join('\n');
const ID='fake-request-1234',cfg={repo:'example/private-data',token:'fake-data-token'},collector='oax2310-blip/etf-planner-data';
const reply=(doc,status=200,etag='')=>new Response(status===204||status===304?null:JSON.stringify(doc),{status,headers:etag?{ETag:etag}:{}});
function setup(fetcher,initial={}){
  const requests=[],messages=[],timers=new Map(),cleared=[];
  const stored=new Map(Object.entries({'etf-planner-collection-request-token':'fake-issues-token','etf-planner-collection-data-repo':cfg.repo,...initial}));
  const context=vm.createContext({localStorage:{getItem:k=>stored.get(k)},AbortController,crypto:{randomUUID:()=>ID},setTimeout:(fn,ms)=>{if(ms===5000)queueMicrotask(fn);else timers.set(ms,fn);return ms;},clearTimeout:ms=>cleared.push(ms),fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options,requests.length);}});
  vm.runInContext(source,context);
  return {requests,messages,timers,cleared,stored,run:(same=()=>true,c=cfg)=>context.collectPricesNow(c,message=>messages.push(message),same)};
}
const normal=(url,options)=>url.endsWith('/issues')?reply({number:123},201):url.endsWith('/issues/123')?reply({state:'open'}):reply({stocks:{AAA:{close:20}},collectionRequests:[{id:ID,failed:false}]},200,'"new"');

test('Issues 토큰은 요청·상태에만, 데이터 토큰은 데이터 조회에만 쓰며 투자정보는 요청에 포함하지 않는다',async()=>{
  const h=setup(normal),result=await h.run();
  assert.equal(h.requests.length,3);
  const [create,status,read]=h.requests;
  assert.equal(create.url,`https://api.github.com/repos/${collector}/issues`);
  assert.deepEqual(JSON.parse(create.options.body),{title:'ETF price collection',body:JSON.stringify({version:1,request_id:ID})});
  assert.equal(create.options.headers.Authorization,'Bearer fake-issues-token');
  assert.equal(status.options.headers.Authorization,'Bearer fake-issues-token');
  assert.equal(read.options.headers.Authorization,'Bearer fake-data-token');
  assert.ok(read.url.startsWith('https://api.github.com/repos/'+cfg.repo+'/contents/'));
  assert.ok(h.requests.every(r=>r.options.redirect==='error'&&r.options.cache==='no-store'));
  assert.equal(result.doc.stocks.AAA.close,20);assert.equal(result.etag,'"new"');
});
test('실패·토큰 누락·같은 토큰·옛 수집 저장소에 dispatch나 추가 권한으로 우회하지 않는다',async()=>{
  for(const status of [401,403,404,422]){const h=setup(()=>reply(null,status));await assert.rejects(h.run());assert.equal(h.requests.length,1);}
  for(const initial of [{'etf-planner-collection-request-token':''},{'etf-planner-collection-request-token':cfg.token},{'etf-planner-collection-data-repo':'different/data'}]){
    const h=setup(normal,initial);await assert.rejects(h.run());assert.equal(h.requests.length,0);
  }
  for(const repo of [collector,collector.toUpperCase(),collector+'.git']){const h=setup(normal);await assert.rejects(h.run(()=>true,{...cfg,repo}));assert.equal(h.requests.length,0);}
});
test('다른 요청·이전 시세·304·404는 완료로 받지 않고 내 요청 영수증을 기다린다',async()=>{
  const docs=[reply({stocks:{},collectionRequests:[{id:'other-request'}]},200,'"old"'),reply(null,304),reply(null,404),normal('data',{})];
  const h=setup((u,o)=>u.includes('/issues')?normal(u,o):docs.shift());await h.run();
  const reads=h.requests.filter(r=>r.url.includes('/contents/'));assert.equal(reads.length,4);
  assert.equal(reads[1].options.headers['If-None-Match'],'"old"');
});
test('작업 거부·실패는 마지막 시세를 유지하고 반복 요청하지 않는다',async()=>{
  for(const status of ['failed','rate-limited','duplicate-request']){
    const h=setup((u,o)=>u.endsWith('/123')?reply({state:'closed',body:JSON.stringify({request_id:ID,status})}):normal(u,o));
    await assert.rejects(h.run());assert.equal(h.requests.length,2);
  }
});
test('일부 조회 실패는 완료 결과에 경고로 전달한다',async()=>{
  const h=setup((u,o)=>u.includes('/issues')?normal(u,o):reply({stocks:{},collectionRequests:[{id:ID,failed:true}]}));
  assert.match((await h.run()).message,/일부 조회 실패/);
});
test('요청 응답의 잘못된 issue 번호와 본문은 경로·코드로 실행하지 않는다',async()=>{
  for(const number of ['../actions/workflows',-1,1.5,null]){const h=setup(()=>reply({number},201));await assert.rejects(h.run());assert.equal(h.requests.length,1);}
});
test('요청이 멈추면 전체 제한으로 취소하고 타이머를 정리한다',async()=>{
  const h=setup((u,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
  const task=h.run();h.timers.get(300000)();await assert.rejects(task,/완료를 아직/);assert.deepEqual(h.cleared,[300000]);
});
test('데이터 또는 요청 토큰 변경 후에는 이전 인증으로 후속 요청하지 않는다',async()=>{
  let same=true;const h=setup(()=>{same=false;return reply({number:123},201);});await assert.rejects(h.run(()=>same),/연결 설정/);assert.equal(h.requests.length,1);
  const h2=setup(()=>{h2.stored.set('etf-planner-collection-request-token','different-token');return reply({number:123},201);});await assert.rejects(h2.run(),/연결 설정/);assert.equal(h2.requests.length,1);
});
