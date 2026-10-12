const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publicRow,list,allowedError}=require('../scripts/discover-ecos.cjs');
test('ECOS 연결 확인 결과에는 공개 통계 메타데이터만 남긴다',()=>{
  assert.deepEqual(publicRow({STAT_CODE:'101Y003',STAT_NAME:'M2',ITEM_CODE:'X',API_KEY:'private-key',url:'private-url'}),{STAT_CODE:'101Y003',STAT_NAME:'M2',ITEM_CODE:'X'});
  assert.equal(allowedError(Error('https://ecos.bok.or.kr/api/private-key/')),'request-failed');
  assert.equal(allowedError(Error('INFO-100')),'INFO-100');
});
test('인증키가 없으면 요청하지 않고, 공식 API 오류도 키를 포함한 메시지로 출력하지 않는다',async()=>{
  let called=false;
  await assert.rejects(list('StatisticTableList','',async()=>{called=true;},{}),/secret-missing/);
  assert.equal(called,false);
  const fetcher=async url=>{
    assert.equal(new URL(url).hostname,'ecos.bok.or.kr');
    return {ok:true,json:async()=>({RESULT:{CODE:'INFO-100',MESSAGE:'private-key rejected'}})};
  };
  await assert.rejects(list('StatisticTableList','',fetcher,{ECOS_API_KEY:'private-key'}),error=>error.message==='INFO-100');
});
test('공식 목록 페이지 전체를 조회하고 응답의 추가 필드는 제외한다',async()=>{
  let call=0;
  const fetcher=async()=>({ok:true,json:async()=>({StatisticTableList:{list_total_count:1001,row:++call===1?Array.from({length:1000},(_,i)=>({STAT_CODE:String(i),STAT_NAME:'통계',API_KEY:'private-key'})):[{STAT_CODE:'last',STAT_NAME:'M2'}]}})});
  const rows=await list('StatisticTableList','',fetcher,{ECOS_API_KEY:'private-key'});
  assert.equal(call,2);assert.equal(rows.length,1001);assert.equal(rows[0].API_KEY,undefined);assert.equal(rows.at(-1).STAT_CODE,'last');
});
