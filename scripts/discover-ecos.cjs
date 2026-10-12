/* ECOS 인증은 Actions secret만 사용. 결과에는 공개 통계표·항목 메타데이터만 담는다. */
'use strict';
const fs=require('node:fs/promises');
const fields=['STAT_CODE','STAT_NAME','P_STAT_CODE','SRCH_YN','CYCLE','GRP_CODE','GRP_NAME','ITEM_CODE','ITEM_NAME','START_TIME','END_TIME','DATA_CNT','UNIT_NAME'];
const publicRow=row=>Object.fromEntries(fields.filter(key=>typeof row[key]==='string' || typeof row[key]==='number').map(key=>[key,row[key]]));
async function list(service,table='',fetcher=fetch,env=process.env) {
  if(!env.ECOS_API_KEY)throw Error('secret-missing');
  const rows=[];
  for(let first=1;first<=10000;first+=1000) {
    const url=`https://ecos.bok.or.kr/api/${service}/${encodeURIComponent(env.ECOS_API_KEY)}/json/kr/${first}/${first+999}/${table}/`;
    const response=await fetcher(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('http-failed');
    const data=await response.json(), result=data[service];
    if(!Array.isArray(result?.row)) {
      const code=data.RESULT?.CODE;
      throw Error(typeof code==='string' && /^(INFO|ERROR)-\d{3}$/.test(code)?code:'api-failed');
    }
    rows.push(...result.row.map(publicRow));
    if(first+result.row.length-1>=Number(result.list_total_count))return rows;
    if(!result.row.length)throw Error('empty-page');
  }
  throw Error('page-limit');
}
async function main() {
  const tables=(await list('StatisticTableList')).filter(row=>/M2|광의통화|한국은행 기준금리/.test(row.STAT_NAME || ''));
  if(!tables.length)throw Error('no-candidates');
  const items={}, errors=[];
  for(const table of tables.filter(row=>row.SRCH_YN==='Y').slice(0,40)) {
    try { items[table.STAT_CODE]=await list('StatisticItemList',table.STAT_CODE); }
    catch(error) { errors.push({table:table.STAT_CODE,code:allowedError(error)}); }
  }
  const result={checkedAt:new Date().toISOString(),authentication:'connected',tables,items,errors};
  const output=process.argv[2];
  if(!output)throw Error('output-missing');
  await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(`ECOS 인증 확인 · 후보 ${tables.length}개 · 항목 조회 ${Object.keys(items).length}개`);
  // 키·요청 URL을 제외한 공개 메타데이터만 로그로도 제공해 연결 검토에 사용한다.
  console.log('ECOS_PUBLIC_METADATA_BEGIN\n'+JSON.stringify(result)+'\nECOS_PUBLIC_METADATA_END');
}
function allowedError(error) {
  const value=error?.message;
  return typeof value==='string' && /^(secret-missing|http-failed|api-failed|empty-page|page-limit|no-candidates|output-missing|(INFO|ERROR)-\d{3})$/.test(value)?value:'request-failed';
}
module.exports={publicRow,list,allowedError};
if(require.main===module)main().catch(error=>{console.error('ECOS 연결 확인 실패: '+allowedError(error));process.exitCode=1;});
