// 가상 감지 정보만 사용한다. DOM·네트워크·실제 저장소 접근 없음.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=name=>fs.readFileSync(path.join(__dirname,'../js',name),'utf8');
const api=vm.runInNewContext(['split-auto.js','split-adjust.js','data-validation.js'].map(source).join('\n;')+'\n({splitAuto,appendSplitLog,externalData})',{URLSearchParams});
const auto=api.splitAuto,plain=v=>JSON.parse(JSON.stringify(v)),now=Date.parse('2026-11-05T14:00:00Z');
const action=(extra={})=>({id:'TEST:2026-11-05:1:3',ticker:'TEST',kind:'split',from:1,to:3,exDate:'2026-11-05',basisThrough:'2026-11-04',detectedAt:'2026-11-05T12:00:00Z',...extra});
const log=(extra={})=>({id:'example-log',ticker:'TEST',from:1,to:3,exDate:'2026-11-05',appliedAt:'2026-11-05T14:00:00Z',planner:true,assets:false,...extra});

test('정상 분할·병합 계약 필드만 복사하고 원본·옛 시세 문서에 필드를 만들지 않는다',()=>{
  const split=action({ignored:'example'}),merge=action({id:'900001:2026-11-05:10:1',ticker:'900001',kind:'merge',from:10,to:1});
  const doc={corporateActions:[split,merge]},before=JSON.stringify(doc),rows=auto.read(doc);
  assert.equal(rows.length,2);assert.deepEqual(plain(rows[0]),action());assert.notEqual(rows[0],split);assert.equal(JSON.stringify(doc),before);
  for(const old of [{},null,{stocks:{}},{corporateActions:null}])assert.deepEqual(plain(auto.read(old)),[]);
});

test('위조 id·종목·비율·kind·날짜·ISO·범위 밖 항목과 중복 id를 버린다',()=>{
  const invalid=[null,{},action({id:'TEST:2026-11-05:01:3'}),action({id:'OTHER:2026-11-05:1:3'}),action({ticker:'test'}),action({ticker:'<img>'}),
    action({id:'BTC-USD:2026-11-05:1:3',ticker:'BTC-USD'}),action({id:'KS200:2026-11-05:1:3',ticker:'KS200'}),
    action({from:'1'}),action({from:0}),action({to:1001}),action({to:1.5}),action({from:true}),action({from:3}),action({kind:'merge'}),
    action({exDate:'2026-02-30'}),action({basisThrough:'0000-01-01'}),action({detectedAt:'2026-02-30T12:00:00Z'}),action({detectedAt:'2026-11-05'}),
    action({detectedAt:'2026-11-05T24:00:00Z'}),action({detectedAt:'2026-11-05T12:00:00'}),action({detectedAt:123})];
  assert.deepEqual(plain(auto.read({corporateActions:[...invalid,action(),action()]})),[action()]);
  for(const field of Object.keys(action())){const missing=action();delete missing[field];assert.deepEqual(plain(auto.read({corporateActions:[missing]})),[],field);}
  const edge=action({ticker:'T'.repeat(32),id:'T'.repeat(32)+':2026-11-05:1:1000',to:1000});
  assert.equal(auto.read({corporateActions:[edge]}).length,1);
  assert.equal(auto.read({corporateActions:Array.from({length:50},(_,i)=>action({ticker:`TEST${i}`,id:`TEST${i}:2026-11-05:1:3`}))}).length,50);
  assert.deepEqual(plain(auto.read({corporateActions:Array.from({length:51},()=>action())})),[]);
});

test('대기: actionId·수동 반영 적용일 ±7일을 제외하고 다른 비율·8일 차이는 남긴다',()=>{
  const cases=[[[log({actionId:action().id,exDate:'2026-10-01'})],0],[[log()],0],[[log({exDate:'2026-10-29'})],0],[[log({exDate:'2026-11-12'})],0],
    [[log({exDate:'2026-10-28'})],1],[[log({exDate:'2026-11-13'})],1],[[log({to:2})],1],[[log({ticker:'OTHER'})],1],
    [[log({planner:false,assets:false,dismissed:true,actionId:action().id})],0]];
  for(const [logs,count] of cases)assert.equal(auto.pending([action()],logs,now).length,count,JSON.stringify(logs));
  const domestic=action({ticker:'900001',id:'900001:2026-11-05:1:3'});
  assert.equal(auto.pending([domestic],[log({ticker:'A900001'})],now).length,0);
});

test('대기: 30일 경계 포함·경과 및 미래 감지 제외, 입력은 불변',()=>{
  const exact=action({detectedAt:new Date(now-30*86400000).toISOString()}),expired=action({detectedAt:new Date(now-30*86400000-1).toISOString()}),future=action({detectedAt:new Date(now+1).toISOString()});
  assert.equal(auto.pending([exact],[],now).length,1);assert.equal(auto.pending([expired],[],now).length,0);assert.equal(auto.pending([future],[],now).length,0);
  const rows=[action()],logs=[log({ticker:'OTHER'})],before=JSON.stringify([rows,logs]);auto.pending(rows,logs,now);assert.equal(JSON.stringify([rows,logs]),before);
});

test('?split=은 현재 대기 id 하나만 받으며 처리·만료·위조·중복 인자를 열지 않는다',()=>{
  const waiting=auto.pending([action()],[],now),search='?split='+encodeURIComponent(action().id);
  assert.equal(auto.locationAction(search,waiting).id,action().id);
  for(const [query,rows] of [[search,[]],['?split=forged',waiting],[search+'&split='+encodeURIComponent(action().id),waiting],['?other=value',waiting]])assert.equal(auto.locationAction(query,rows),null);
});

test('별도 메타 캐시: 없는 옛 캐시는 재조회 대상, 새 응답의 빈 목록도 완료로 보존한다',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  assert.equal(auto.load(storage),null);assert.equal(auto.cached({format:5,etag:'same'},'example/records','same'),null);
  const old={stocks:{}},before=JSON.stringify(old),cache=auto.remember(storage,'example/records','same',old);
  assert.equal(JSON.stringify(old),before);assert.deepEqual(plain(auto.cached(cache,'example/records','same')),[]);
  const next=auto.remember(storage,'example/records','new',{corporateActions:[action(),action({to:'3'})]});
  assert.deepEqual(plain(auto.cached(auto.load(storage),'example/records','new')),[action()]);
  assert.equal(auto.cached(next,'other/records','new'),null);assert.equal(auto.cached(next,'example/records','old'),null);
  assert.doesNotThrow(()=>auto.remember({setItem(){throw Error('synthetic quota');}},'example/records','new',{}));
});

test('반영/제외 이력 선택 필드 보존·엄격 검증, 옛 기록에 필드 생성 없음',()=>{
  const base={plans:[],futures:{}},entry=log({actionId:action().id,source:'auto',planner:false,assets:false,dismissed:true});
  const next=api.appendSplitLog(base,entry);assert.deepEqual(plain(next.splitLog),[entry]);assert.equal(api.externalData.planner(next),next);assert.equal(Object.hasOwn(base,'splitLog'),false);
  const old={...base,splitLog:[log()]},before=JSON.stringify(old);api.externalData.planner(old);assert.equal(JSON.stringify(old),before);assert.equal(Object.hasOwn(old.splitLog[0],'source'),false);
  const manual=api.appendSplitLog(base,log({source:'manual'}));assert.equal(manual.splitLog[0].source,'manual');
  for(const change of [{actionId:'forged'},{actionId:null},{source:'other'},{source:null},{dismissed:1},{dismissed:false},{dismissed:undefined}]){
    const bad={...entry,...change};assert.throws(()=>api.appendSplitLog(base,bad),/이력/);assert.throws(()=>api.externalData.planner({...base,splitLog:[bad]}),/splitLog/);
  }
});
