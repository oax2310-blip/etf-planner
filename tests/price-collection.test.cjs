const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/price-collection.js'),'utf8');
const ID='fake-request-1234',cfg={repo:'example/private-data',token:'fake-test-token'};
const reply=(doc,status=200,etag='')=>new Response(status===204||status===304?null:JSON.stringify(doc),{status,headers:etag?{ETag:etag}:{}});
function setup(fetcher){
  const requests=[],messages=[],timers=new Map(),cleared=[];
  const context=vm.createContext({AbortController,crypto:{randomUUID:()=>ID},setTimeout:(fn,ms)=>{if(ms===5000)queueMicrotask(fn);else timers.set(ms,fn);return ms;},clearTimeout:ms=>cleared.push(ms),fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options,requests.length);}});
  vm.runInContext(source,context);
  return {requests,messages,timers,cleared,run:(same=()=>true)=>context.collectPricesNow(cfg,message=>messages.push(message),same)};
}

test('실제 수집 요청에 개인 기록 없이 식별자만 보내고 이전·다른 요청의 시세는 완료로 받지 않는다',async()=>{
  const docs=[reply(null,204),reply({stocks:{AAA:{close:10}},collectionRequests:[{id:'other-request',failed:false}]},200,'"old"'),reply(null,304),reply(null,404),reply({stocks:{AAA:{close:20}},collectionRequests:[{id:ID,failed:false}]},200,'"new"')];
  const h=setup(()=>docs.shift()),result=await h.run();
  assert.equal(h.requests.length,5);assert.equal(h.requests[0].options.method,'POST');assert.ok(h.requests[0].url.endsWith('/dispatches'));
  assert.deepEqual(JSON.parse(h.requests[0].options.body),{event_type:'collect-prices-now',client_payload:{request_id:ID}});
  assert.equal(h.requests[1].options.headers['If-None-Match'],undefined);assert.equal(h.requests[2].options.headers['If-None-Match'],'"old"');
  assert.ok(h.requests.every(r=>r.options.cache==='no-store'&&r.options.headers.Authorization===`Bearer ${cfg.token}`));
  assert.equal(result.doc.stocks.AAA.close,20);assert.equal(result.etag,'"new"');assert.equal(result.message,'');
  assert.match(h.messages.at(-1),/수집 중/);
});

test('권한·수집 요청 실패에는 파일 조회나 새 요청을 반복하지 않는다',async()=>{
  for(const [status,message] of [[401,/토큰/],[403,/Contents/],[404,/요청 실패/],[422,/요청 실패/]]){
    const h=setup(()=>reply(null,status));await assert.rejects(h.run(),message);assert.equal(h.requests.length,1);
  }
});

test('새 수집 결과에서 일부 조회가 실패했으면 적용할 시세와 경고를 함께 반환한다',async()=>{
  const h=setup((url)=>url.endsWith('/dispatches')?reply(null,204):reply({stocks:{AAA:{close:10,stale:true}},collectionRequests:[{id:ID,failed:true}]}));
  const result=await h.run();assert.equal(result.doc.stocks.AAA.close,10);assert.match(result.message,/일부 조회 실패/);
});

test('수집 결과를 끝내 받지 못하면 완료로 표시하지 않고 한 번의 요청으로 대기를 끝낸다',async()=>{
  const h=setup(url=>url.endsWith('/dispatches')?reply(null,204):reply({stocks:{},collectionRequests:[{id:'other-request'}]}));
  await assert.rejects(h.run(),/완료를 아직 확인하지 못했습니다/);assert.equal(h.requests.length,61);
  assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
});

test('API 응답이 멈춰도 전체 대기 제한으로 요청을 취소하고 타이머를 해제한다',async()=>{
  const h=setup((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
  const work=h.run();h.timers.get(300000)();
  await assert.rejects(work,/완료를 아직 확인하지 못했습니다/);assert.equal(h.requests.length,1);assert.deepEqual(h.cleared,[300000]);
});

test('수집 대기 중 연결이 바뀌면 이전 연결로 후속 요청하거나 시세를 반환하지 않는다',async()=>{
  let same=true;
  const h=setup(()=>{same=false;return reply(null,204);});
  await assert.rejects(h.run(()=>same),/연결 설정이 바뀌었습니다/);assert.equal(h.requests.length,1);
  const afterRead=setup(url=>url.endsWith('/dispatches')?reply(null,204):{status:200,ok:true,headers:{get:()=>''},async text(){same=false;return JSON.stringify({stocks:{},collectionRequests:[{id:ID}]});}});
  same=true;await assert.rejects(afterRead.run(()=>same),/연결 설정이 바뀌었습니다/);assert.equal(afterRead.requests.length,2);
});
