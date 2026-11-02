const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'js',name),'utf8');
const files={planner:'sync.js',assets:'assets-store.js',scenario:'valuation.js'};
const pages=Object.keys(files);
const sources=Object.fromEntries(Object.entries(files).map(([page,file])=>[page,read(file)]));
const REPO='example/private-data',TOKEN='fake-data-token',PATH=`/repos/${REPO}/contents/fake.json`;
const timeoutMessage='GitHub 응답이 늦어 동기화를 멈췄습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
const networkMessage='네트워크 연결을 확인해 주세요.';
const forbiddenMessage='토큰 권한이 부족하거나 요청이 너무 많습니다. 토큰의 Contents 읽기·쓰기 권한을 확인해 주세요.';
const collectorMessage='기존 저장소는 KIS 수집 전용입니다. 분리된 데이터 저장소와 새 데이터 전용 토큰을 연결해 주세요. 이 기기의 기록은 유지됩니다.';
const unauthorized=page=>`GitHub 토큰이 맞지 않거나 만료됐습니다. ${page==='planner'?'':'메인 플래너의 '}동기화 설정에서 새 토큰을 넣어 주세요.`;
const notFound=page=>`저장소 ${REPO}를 찾을 수 없습니다.${page==='planner'?' 이름과 토큰에 고른 저장소를 확인해 주세요.':page==='scenario'?' 메인 플래너의 동기화 설정을 확인해 주세요.':''}`;
const publicRepo=page=>`${REPO}는 공개 저장소라 ${page==='scenario'?'가정':'기록'}을 올리지 않았습니다. 비공개 저장소를 지정해 주세요.`;
const reply=(status=200,body={private:true})=>({status,ok:status>=200&&status<300,headers:{get:()=>null},async json(){return body;},async text(){return typeof body==='string'?body:JSON.stringify(body);}});
const missing=Symbol('AbortSignal 없는 환경');

function functionSource(source,name){
  const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,`${name} 함수가 있어야 한다`);
  return source.slice(start,end+2);
}
function decodeSource(source,name){
  const line=source.split('\n').find(line=>line.startsWith(`const ${name}`));
  assert.ok(line,`${name} 래퍼가 있어야 한다`);
  return line;
}

// 실제 페이지 래퍼를 불러온다. 자산 IIFE의 내부 함수만 테스트 반환값에 노출하며,
// 비공개 저장소 확인은 공개 진입점 assetStore.sync()를 그대로 실행한다.
function setup(page,{fetcher=()=>reply(),abortSignal}={}){
  const requests=[],deadlines=[],signal={fakeDeadline:true};
  const storage=new Map([['etf-planner-data-repo',REPO],['etf-planner-github-token',TOKEN]]);
  const config={repo:REPO,token:TOKEN};
  const context=vm.createContext({
    TextEncoder,TextDecoder,Uint8Array,atob,btoa,
    sync:{...config,checked:false},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    setTimeout:()=>1,clearTimeout(){},setInterval(){},addEventListener(){},document:{hidden:false,addEventListener(){}},
    async fetch(url,options){requests.push({url,options});return fetcher(url,options);}
  });
  if(abortSignal!==missing)context.AbortSignal=abortSignal===undefined?{timeout(ms){deadlines.push(ms);return signal;}}:abortSignal;
  vm.runInContext(read('repo-security.js'),context,{filename:'repo-security.js'});
  const security=vm.runInContext('repoSecurity',context);
  let request,check,decode;
  if(page==='assets'){
    for(const name of ['ma-ladder.js','assets-calc.js'])vm.runInContext(read(name),context,{filename:name});
    const source=sources.assets.replace('return {get doc(){','return {request:aGh,decode:fromB64A,get doc(){');
    assert.notEqual(source,sources.assets,'자산 내부 요청 래퍼를 테스트에서 노출해야 한다');
    const store=vm.runInContext(source+'\nassetStore',context,{filename:files.assets});
    request=(path=PATH,options)=>store.request(config,path,options);
    decode=store.decode;
    check=async()=>{await store.sync();if(store.status.state==='error')throw Error(store.status.message);};
  }else{
    const requestName=page==='planner'?'gh':'scenarioGh',checkName=page==='planner'?'checkRepo':'checkScenarioRepo';
    vm.runInContext([decodeSource(sources[page],'fromB64'),functionSource(sources[page],requestName),functionSource(sources[page],checkName)].join('\n'),context,{filename:files[page]});
    const api=vm.runInContext(`({request:${requestName},check:${checkName},decode:fromB64})`,context);
    request=page==='planner'?(path=PATH,options)=>api.request(path,options):(path=PATH,options)=>api.request(config,path,options);
    check=page==='planner'?()=>api.check():()=>api.check(config);
    decode=api.decode;
  }
  return {request,check,decode,requests,deadlines,signal,security,context,config,storage,setRepo(repo){config.repo=repo;context.sync.repo=repo;storage.set('etf-planner-data-repo',repo);}};
}

test('세 페이지 요청 래퍼는 URL·기본 헤더·cache·30초 signal이 같고 호출자 옵션을 유지한다',async()=>{
  const sent=[];
  for(const page of pages){
    const response=reply(),h=setup(page,{fetcher:()=>response});
    assert.equal(await h.request(),response,page);
    const [{url,options}]=h.requests;
    assert.equal(url,'https://api.github.com'+PATH,page);
    assert.equal(options.cache,'no-store',page);
    assert.deepEqual({...options.headers},{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+TOKEN},page);
    assert.equal(options.signal,h.signal,page);
    assert.deepEqual(h.deadlines,[30000],page);
    sent.push(JSON.stringify({...options,signal:'같은 30초 제한'}));
  }
  assert.equal(new Set(sent).size,1);
  for(const page of pages){
    const h=setup(page),signal={fakeCallerSignal:true};
    const headers={Accept:'application/vnd.github.raw+json','X-GitHub-Api-Version':'fake-version',Authorization:'Bearer fake-header-token','If-None-Match':'"fake-etag"','Content-Type':'application/json'};
    const options={method:'PUT',body:'{"fake":true}',signal,headers};
    await h.request(PATH,options);
    const sent=h.requests[0].options;
    assert.equal(sent.method,'PUT',page);assert.equal(sent.body,options.body,page);
    assert.equal(sent.signal,signal,page);assert.deepEqual({...sent.headers},headers,page);
    assert.equal(sent.cache,'no-store',page);assert.deepEqual(h.deadlines,[],page);
    assert.equal(options.headers,headers,page);
  }
});

test('세 페이지는 TimeoutError·AbortError·TypeError를 fetch와 json·text 본문에서 같은 기존 문구로 바꾼다',async()=>{
  for(const page of pages)for(const phase of ['fetch','json','text'])for(const name of ['TimeoutError','AbortError','TypeError']){
    const error=Object.assign(Error('가짜 네트워크 오류 상세'),{name});
    const h=setup(page,{fetcher:()=>{if(phase==='fetch')throw error;const response=reply();response[phase]=async()=>{throw error;};return response;}});
    await assert.rejects(async()=>{const response=await h.request();if(phase!=='fetch')await response[phase]();},{message:name==='TypeError'?networkMessage:timeoutMessage},`${page}/${phase}/${name}`);
  }
});

test('세 페이지의 401·403 안내는 원래 문구를 유지한다',async()=>{
  for(const page of pages)for(const status of [401,403]){
    const h=setup(page,{fetcher:()=>reply(status)});
    await assert.rejects(h.request(),{message:status===401?unauthorized(page):forbiddenMessage},`${page}/${status}`);
  }
});

test('알려지지 않은 요청·본문 오류와 응답의 json·text this는 그대로 보존한다',async()=>{
  for(const page of pages)for(const phase of ['fetch','json','text']){
    const error=Error('가짜 오류');
    const h=setup(page,{fetcher:()=>{if(phase==='fetch')throw error;const response=reply();response[phase]=async()=>{throw error;};return response;}});
    await assert.rejects(async()=>{const response=await h.request();if(phase!=='fetch')await response[phase]();},actual=>actual===error,`${page}/${phase}`);
  }
  for(const page of pages){
    const response=reply();response.json=async function(){return this;};response.text=async function(){return this;};
    const h=setup(page,{fetcher:()=>response}),received=await h.request();
    assert.equal(await received.json(),response,page);assert.equal(await received.text(),response,page);
  }
});

test('304·404·409·422 등 상태 처리는 호출부에 남기고 응답을 그대로 돌려준다',async()=>{
  for(const page of pages)for(const status of [201,304,404,409,422,500]){
    const response=reply(status),h=setup(page,{fetcher:()=>response});
    assert.equal(await h.request(),response,`${page}/${status}`);
  }
});

test('수집 저장소와 형식이 틀린 데이터 저장소는 fetch 전에 거부한다',async()=>{
  const invalid=['','example','example/private/data','example/.','example/..','example/repo?query','example/repo#fragment',null,17];
  const collectors=['oax2310-blip/etf-planner-data','OAX2310-BLIP/ETF-PLANNER-DATA','oax2310-blip/etf-planner-data.git'];
  for(const page of pages)for(const repo of [...collectors,...invalid]){
    const h=setup(page);h.setRepo(repo);
    await assert.rejects(h.request(),{message:collectors.includes(repo)?collectorMessage:'데이터 저장소 이름을 확인해 주세요.'},`${page}/${repo}`);
    assert.equal(h.requests.length,0,`${page}/${repo}`);assert.deepEqual(h.deadlines,[],`${page}/${repo}`);
  }
  const h=setup('planner');
  h.storage.set(h.security.tokenKey,'fake-issues-token');h.storage.set(h.security.repoKey,REPO);
  const collectorConfig=h.security.requestConfig(h.config);
  assert.equal(collectorConfig.token,'fake-issues-token');
  await assert.rejects(h.security.dataRequest(collectorConfig,`/repos/${collectorConfig.repo}/issues`),{message:collectorMessage});
  assert.equal(h.requests.length,0,'즉시수집 설정을 공통 데이터 요청에 넘겨도 요청하지 않는다');
});

test('AbortSignal.timeout 미지원 환경은 signal 없이 요청하고 호출자 signal은 항상 우선한다',async()=>{
  for(const page of pages)for(const abortSignal of [missing,{}, {timeout:undefined},{timeout:17}]){
    const h=setup(page,{abortSignal});
    await assert.doesNotReject(h.request(),page);
    assert.equal(Object.hasOwn(h.requests[0].options,'signal'),false,page);
    assert.deepEqual(h.deadlines,[],page);
    const signal={fakeCallerSignal:true};
    await h.request(PATH,{signal});assert.equal(h.requests[1].options.signal,signal,page);
  }
});

test('세 페이지 비공개 확인의 공개·404·기타 오류 문구와 401 안내를 유지한다',async()=>{
  for(const page of pages)for(const status of [200,404,500,401,403]){
    const h=setup(page,{fetcher:()=>reply(status,{private:false})});
    const expected=status===200?publicRepo(page):status===404?notFound(page):status===401?unauthorized(page):status===403?forbiddenMessage:'저장소 확인 실패 (500)';
    await assert.rejects(h.check(),{message:expected},`${page}/${status}`);
    assert.equal(h.requests.length,1,`${page}/${status}`);
    assert.equal(h.requests[0].url,`https://api.github.com/repos/${REPO}`,page);
  }
  for(const page of pages){
    const h=setup(page,{fetcher:url=>url===`https://api.github.com/repos/${REPO}`?reply():reply(404)});
    await assert.doesNotReject(h.check(),page);
    if(page==='planner')assert.equal(h.context.sync.checked,true,'확인 성공 뒤 플래너 checked 상태를 유지한다');
  }
});

test('세 페이지 base64 해독 래퍼는 공백과 UTF-8 문자열을 유지한다',()=>{
  const text='가짜 UTF-8 데이터 🙂\n',encoded=Buffer.from(text,'utf8').toString('base64').replace(/(.{4})/g,'$1 \n\t');
  for(const page of pages){const h=setup(page);assert.equal(h.decode(encoded),text,page);assert.equal(h.security.decodeBase64Text(encoded),text,page);}
});

test('세 페이지 파일에 직접 GitHub API fetch 호출이 남지 않는다',()=>{
  for(const [page,source] of Object.entries(sources))assert.doesNotMatch(source,/\bfetch\s*\(\s*["'`]https:\/\/api\.github\.com/,files[page]);
});
