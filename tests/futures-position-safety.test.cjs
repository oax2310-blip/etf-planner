// 모두 가상 월물·계약·체결 기록. 실제 보유 기록은 사용하지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=['ma-ladder.js','futures.js','futures-plan.js','futures-rebuy.js'].map(name=>fs.readFileSync(path.join(__dirname,'../js',name),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({contractSize:10000});vm.runInContext(source,ctx);return ctx;};
const plain=value=>JSON.parse(JSON.stringify(value));
const fixture=()=>({
  targetPrice:1500,baselinePnl:12345,note:'가상 메모',
  positions:[{month:'202611',contracts:2,settlementPrice:1400.25},{month:'202612',contracts:3,settlementPrice:1425.125}],
  levels:[{days:25,price:1410,confirmed:true,contracts:2,tranches:[
    {price:1410,completed:true,executionPrice:1409.5,mergedMonth:'202611'},
    {price:1420,completed:false,executionPrice:null}
  ]}],
  rebuy:{currentPrice:1430,cuts:[{contracts:1,price:1395,month:'202611',settlementPrice:1400.25}],stages:[{name:'가상 재매수',price:1415,buys:[{contracts:1,price:1416.5,month:'202612'}]}]}
});

test('보유 월물·계약·평균가의 잘못된 입력은 저장 값을 바꾸지 않고 오류 이유를 돌려준다',()=>{
  const ctx=load(),f=fixture();
  const invalid={month:['',' ','20261','2026111','202600','202613','20a611','202612'],contracts:['',' ',-1,1.5,'Infinity','NaN',String(Number.MAX_SAFE_INTEGER+1)],settlementPrice:['',' ',0,-1,'Infinity','NaN']};
  for(const [key,values] of Object.entries(invalid))for(const raw of values){
    const before=JSON.stringify(f),result=ctx.futurePositionEdit(f,0,key,String(raw));
    assert.equal(result.ok,false,`${key}=${JSON.stringify(raw)}`);assert.equal(typeof result.error,'string');assert.ok(result.error.trim());
    assert.equal(JSON.stringify(f),before,'거절한 입력은 다른 필드나 기존 기록도 바꾸지 않는다');
  }
});

test('월물의 연도 경계·0계약·소수 평균가를 허용하고 입력한 필드만 바꾼다',()=>{
  const ctx=load(),f=fixture(),untouched=JSON.stringify({levels:f.levels,rebuy:f.rebuy,other:f.positions[1]});
  assert.equal(ctx.futurePositionEdit(f,0,'month','202701').ok,true);assert.equal(f.positions[0].month,'202701');
  assert.equal(ctx.futurePositionEdit(f,0,'month','202701').ok,true,'자기 월물을 그대로 확정하는 것은 중복이 아니다');
  assert.equal(ctx.futurePositionEdit(f,0,'contracts','0').ok,true);assert.equal(f.positions[0].contracts,0);
  assert.equal(ctx.futurePositionEdit(f,0,'contracts','4').ok,true);assert.equal(f.positions[0].contracts,4);
  assert.equal(ctx.futurePositionEdit(f,0,'settlementPrice','1400.123456789').ok,true);assert.equal(f.positions[0].settlementPrice,1400.123456789,'표시용 반올림을 저장 값에 적용하지 않는다');
  assert.equal(JSON.stringify({levels:f.levels,rebuy:f.rebuy,other:f.positions[1]}),untouched);
});

test('옛 잘못된 보유 기록은 다른 칸을 자동 보정하지 않고 한 칸씩 수정할 수 있다',()=>{
  const ctx=load(),f=fixture();f.positions[0]={month:'202613',contracts:-1,settlementPrice:0};
  assert.equal(ctx.futurePositionEdit(f,0,'month','202611').ok,true);assert.equal(f.positions[0].contracts,-1);assert.equal(f.positions[0].settlementPrice,0);
  assert.equal(ctx.futurePositionEdit(f,0,'contracts','2').ok,true);assert.equal(f.positions[0].settlementPrice,0);
  assert.equal(ctx.futurePositionEdit(f,0,'settlementPrice','1400.25').ok,true);
  assert.deepEqual(plain(f.positions[0]),{month:'202611',contracts:2,settlementPrice:1400.25});
});

test('존재하지 않는 보유 행·허용하지 않은 키의 수정과 삭제는 아무것도 바꾸지 않는다',()=>{
  const ctx=load(),f=fixture(),before=JSON.stringify(f);
  for(const index of [-1,9,1.5]){
    assert.equal(ctx.futurePositionEdit(f,index,'contracts','1').ok,false);
    assert.equal(ctx.deleteFuturePosition(f,index),null);
  }
  assert.equal(ctx.futurePositionEdit(f,0,'baselinePnl','999').ok,false);
  assert.equal(JSON.stringify(f),before);
});

test('월물 삭제는 보유 행만 제거하고 연결된 완료·손절·재매수 이력을 보존한다',()=>{
  const ctx=load(),f=fixture(),before=plain(f),summary=ctx.futuresSummary(f),removed=plain(f.positions[0]);
  const record=ctx.deleteFuturePosition(f,0);
  assert.ok(record);assert.equal(record.owner,f);assert.equal(record.index,0);assert.deepEqual(plain(record.position),removed);assert.notEqual(record.position,before.positions[0]);
  assert.deepEqual(plain(f.positions),[before.positions[1]]);
  assert.deepEqual(plain({levels:f.levels,rebuy:f.rebuy}),{levels:before.levels,rebuy:before.rebuy});assert.equal(f.baselinePnl,before.baselinePnl);
  const after=ctx.futuresSummary(f);assert.equal(after.legacyCount,summary.legacyCount,'편입 표시를 지워 월물 밖 보유로 되살리지 않는다');
  assert.equal(after.current,summary.current-(f.targetPrice-removed.settlementPrice)*removed.contracts*10000);
  assert.equal(record.after,ctx.futurePositionFingerprint(f));
  assert.equal(ctx.restoreFuturePosition(f,record),true);assert.deepEqual(plain(f),before);
  assert.deepEqual(plain(ctx.futuresSummary(f)),plain(summary),'복구 후 손익도 원래 계산으로 돌아온다');
  const restored=JSON.stringify(f);assert.equal(ctx.restoreFuturePosition(f,record),false,'같은 삭제를 두 번 복구하지 않는다');assert.equal(JSON.stringify(f),restored);
});

test('삭제 복구는 다른 보유 행과 임의의 과거 필드를 덮어쓰지 않고 원래 행 위치를 복구한다',()=>{
  const ctx=load(),f=fixture();f.positions[1].memo='가상 과거 필드';const removed=f.positions[1],record=ctx.deleteFuturePosition(f,1);
  removed.contracts=999;removed.memo='삭제 뒤 원래 객체 수정';
  assert.equal(ctx.restoreFuturePosition(f,record),true);
  assert.deepEqual(plain(f.positions),[{month:'202611',contracts:2,settlementPrice:1400.25},{month:'202612',contracts:3,settlementPrice:1425.125,memo:'가상 과거 필드'}],'삭제 당시 깊은 사본을 복구한다');
});

test('메모·목표가·알림·표시 시세 변경은 실행 취소로 되돌리지 않는다',()=>{
  const ctx=load(),f=fixture(),beforePositions=plain(f.positions),record=ctx.deleteFuturePosition(f,0),basis=ctx.futurePositionFingerprint(f);
  f.note='수정한 가상 메모';f.targetPrice=1510;f.notify={levels:true};f.levels[0].notify=true;f.levels[0].tranches[0].notify=false;
  f.rebuy.currentPrice=1445;f.rebuy.notify={cuts:true,buys:false};
  assert.equal(ctx.futurePositionFingerprint(f),basis,'보유·체결에 무관한 변경은 복구 가능성을 유지한다');
  assert.equal(ctx.restoreFuturePosition(f,record),true);assert.deepEqual(plain(f.positions),beforePositions);
  assert.equal(f.note,'수정한 가상 메모');assert.equal(f.targetPrice,1510);assert.equal(f.notify.levels,true);assert.equal(f.levels[0].tranches[0].notify,false);assert.equal(f.rebuy.currentPrice,1445);assert.equal(f.rebuy.notify.buys,false);
});

test('보유·누적 정산손익·완료 회차·손절·재매수 기록이 달라지면 오래된 삭제 복구를 거절한다',()=>{
  const ctx=load();
  const changes=[
    f=>{f.positions[0].contracts+=1;},
    f=>{f.baselinePnl+=100;},
    f=>{f.levels[0].tranches[0].executionPrice+=1;},
    f=>{f.levels[0].tranches[0].mergedMonth='202701';},
    f=>{f.levels[0].tranches[1].completed=true;f.levels[0].tranches[1].executionPrice=1421;f.levels[0].tranches[1].mergedMonth='202612';},
    f=>{f.rebuy.cuts[0].price+=1;},
    f=>{f.rebuy.stages[0].buys[0].contracts+=1;}
  ];
  for(const change of changes){
    const f=fixture(),record=ctx.deleteFuturePosition(f,0);change(f);const changed=JSON.stringify(f);
    assert.equal(ctx.restoreFuturePosition(f,record),false);assert.equal(JSON.stringify(f),changed,'새 보유·체결을 덮어쓰거나 삭제 행을 중복 편입하지 않는다');
  }
});

test('동기화·불러오기로 교체된 객체에는 같은 내용이어도 이전 삭제를 복구하지 않는다',()=>{
  const ctx=load(),f=fixture(),record=ctx.deleteFuturePosition(f,0),replacement=plain(f),before=JSON.stringify(replacement);
  assert.equal(ctx.restoreFuturePosition(replacement,record),false);assert.equal(JSON.stringify(replacement),before);
  assert.equal(ctx.restoreFuturePosition(f,null),false);
});

test('새 보유 월물은 연도 경계와 0계약 행의 중복을 피해 가장 가까운 빈 월물을 제안한다',()=>{
  const ctx=load(),f={positions:[{month:'202612',contracts:2},{month:'202701',contracts:0},{month:'202703',contracts:1}]},before=JSON.stringify(f);
  assert.equal(ctx.nextFuturePositionMonth(f,new Date(2026,9,15)),'202702','보유 근월물부터 빈 월물을 찾고 12월 다음 해로 넘어간다');
  assert.equal(JSON.stringify(f),before,'제안만으로 보유 기록을 만들거나 정렬하지 않는다');
  assert.equal(ctx.nextFuturePositionMonth({positions:[]},new Date(2027,4,15)),'202705','보유 월물이 없으면 현재 연월을 쓴다');
  assert.equal(ctx.nextFuturePositionMonth({positions:[{month:'202612',contracts:0}]},new Date(2026,11,15)),'202701','0계약 행도 같은 월물의 중복 입력을 피한다');
});

test('옛 returns의 완료 재매수 변경도 복구를 막고 미완료 설정 변경은 그대로 보존한다',()=>{
  const ctx=load();
  const old=()=>{const f=fixture();delete f.rebuy.stages;f.rebuy.returns=[{done:true,contracts:1,execPrice:1416.5,month:'202612'},{done:false,contracts:null,execPrice:null}];return f;};
  for(const change of [r=>{r.contracts=2;},r=>{r.execPrice+=1;},r=>{r.month='202701';},r=>{r.done=false;}]){
    const f=old(),record=ctx.deleteFuturePosition(f,0);change(f.rebuy.returns[0]);const before=JSON.stringify(f);
    assert.equal(ctx.restoreFuturePosition(f,record),false);assert.equal(JSON.stringify(f),before,'옛 체결 이력을 덮어쓰거나 새 형식으로 옮기지 않는다');
  }
  const f=old(),record=ctx.deleteFuturePosition(f,0),basis=ctx.futurePositionFingerprint(f);
  f.rebuy.returns[1].execPrice=1432;
  assert.equal(ctx.futurePositionFingerprint(f),basis,'미완료 가격 편집은 실제 체결 변경이 아니다');
  assert.equal(ctx.restoreFuturePosition(f,record),true);assert.equal(f.rebuy.returns[1].execPrice,1432);assert.equal(f.rebuy.stages,undefined);
  const g=old(),pendingRecord=ctx.deleteFuturePosition(g,0);Object.assign(g.rebuy.returns[1],{done:true,contracts:1,execPrice:1432,month:'202612'});const changed=JSON.stringify(g);
  assert.equal(ctx.restoreFuturePosition(g,pendingRecord),false);assert.equal(JSON.stringify(g),changed,'미완료 회차가 새로 체결되면 복구를 막는다');
});
