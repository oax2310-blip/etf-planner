const assert=require('node:assert/strict');

// DOM 대역이 받은 실제 화면 문자열에서 회차 줄만 읽는다. 가짜 체결의 키로 줄을 구별한다.
function renderedRows(html,tableId,keyAttr,rowClass='purchase-row'){
  const start=html.indexOf(`id="${tableId}"`);
  assert.ok(start>=0,`${tableId} 표가 있다`);
  const end=html.indexOf('</section>',start),table=html.slice(start,end<0?undefined:end);
  const tags=[...table.matchAll(new RegExp(`<div class="(${rowClass}(?: [^"]*)?)"[^>]*>`,'g'))];
  return tags.map((tag,i)=>{
    const body=table.slice(tag.index,tags[i+1]?.index),key=body.match(new RegExp(`${keyAttr}="([^"]*)"`))?.[1];
    return {classes:tag[1].split(/\s+/),key,html:body};
  });
}
function assertLastDone(rows,expected){
  assert.deepEqual(rows.filter(r=>r.classes.includes('last-done')).map(r=>r.key),expected===null?[]:[expected],
    '표 순서상 마지막 완료 회차 한 줄만 남긴다');
  for(const row of rows.filter(r=>r.classes.includes('last-done'))){
    assert.ok(row.classes.includes('done'),'남기는 줄은 완료 줄이다');
    assert.ok(!row.classes.includes('partial'),'부분 체결 줄은 남기는 완료 줄이 아니다');
    assert.ok(!row.classes.includes('future-buy-dim'),'흐린 제외 줄은 남기는 완료 줄이 아니다');
  }
}
module.exports={renderedRows,assertLastDone};
