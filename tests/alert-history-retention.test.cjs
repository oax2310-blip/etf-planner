// 가상 알림 ID와 고정 시각만 사용한다. 보관 기간은 현재 기기 시각과 관계없이 재현한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=name=>fs.readFileSync(path.join(__dirname,'..','js',name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const NOW='2026-11-02T12:00:00.000Z',NOW_MS=Date.parse(NOW),DAY=24*60*60*1000;
const ago=days=>new Date(NOW_MS-days*DAY).toISOString();
class FixedDate extends Date{
  constructor(...args){super(...(args.length?args:[NOW_MS]));}
  static now(){return NOW_MS;}
}
const FIRST='a'.repeat(64),SECOND='b'.repeat(64),THIRD='c'.repeat(64);
const event=(id,extra={})=>({eventId:id,ticker:'TEST',line:'가상 기준선',name:'가상 알림',occurredAt:ago(1),...extra});
function load(initial={}){
  let saves=0;const nodes=new Map(),storage=new Map();
  const ctx=vm.createContext({state:plain(initial),Intl,Date:FixedDate,Set,Map,JSON,URLSearchParams,
    STORAGE_KEY:'retention-test-state',save:()=>{saves++;storage.set('retention-test-state',JSON.stringify(ctx.state));},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    $:name=>{if(!nodes.has(name))nodes.set(name,{classList:{toggle(){}},setAttribute(){}});return nodes.get(name);},$$:()=>[],
    esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    navigator:{},document:{addEventListener(){}},confirm:()=>true});
  vm.runInContext(source('alert-history-store.js')+'\n;\n'+source('alert-history.js')+'\n;globalThis.store=alertHistoryStore',ctx);
  ctx.store.pending=async()=>[];
  return {ctx,nodes,storage,saves:()=>saves};
}
const ids=history=>plain(history.deletedIds);

test('개별 삭제는 removal의 각 ID에 현재 시각을 붙이고 시각 없는 옛 삭제는 그대로 둔다',()=>{
  const h=load({alertHistory:{items:[],deletedIds:['legacy-delete']}});
  h.ctx.acceptAlertHistory([event(FIRST,{reminderCount:3,lastSentAt:ago(1)})]);
  const expected=plain(h.ctx.store.removal(h.ctx.state.alertHistory.items[0]));
  assert.deepEqual(expected,[FIRST,`${FIRST}:3`]);
  assert.equal(h.ctx.removeAlertHistory(FIRST),true);
  assert.deepEqual(ids(h.ctx.state.alertHistory),[...expected,'legacy-delete'].sort());
  assert.deepEqual(plain(h.ctx.state.alertHistory.deletedAt),Object.fromEntries(expected.map(id=>[id,NOW])));
  assert.equal(h.ctx.state.alertHistory.items.length,0);
  const reopened=load(JSON.parse(h.storage.get('retention-test-state')));
  assert.deepEqual(plain(reopened.ctx.state.alertHistory),plain(h.ctx.state.alertHistory));
});

test('전체 삭제도 모든 항목의 removal ID에 같은 현재 시각을 저장한다',()=>{
  const h=load();h.ctx.acceptAlertHistory([event(FIRST,{reminderCount:2}),event(SECOND)]);
  const expected=plain(h.ctx.state.alertHistory.items.flatMap(h.ctx.store.removal));
  h.ctx.collectAlertInbox=()=>{};h.ctx.initializeAlertHistory();h.nodes.get('clearAlertHistory').onclick();
  assert.deepEqual(ids(h.ctx.state.alertHistory),expected.sort());
  assert.deepEqual(plain(h.ctx.state.alertHistory.deletedAt),Object.fromEntries(expected.map(id=>[id,NOW])));
  assert.equal(h.ctx.state.alertHistory.items.length,0);
});

test('삭제 없이 merge·저장 기록 재열기·서버 이력 불러오기는 deletedAt을 만들지 않는다',async()=>{
  const legacy={items:[],deletedIds:['legacy-delete']},h=load({plans:[],alertHistory:legacy});
  for(const merged of [h.ctx.store.merge(),h.ctx.store.merge(legacy),h.ctx.store.merge(legacy,{items:[event(FIRST)]})])assert.equal(Object.hasOwn(merged,'deletedAt'),false);
  h.ctx.renderAlertHistory();assert.equal(h.ctx.acceptAlertHistory([]),false);
  assert.equal(Object.hasOwn(h.ctx.state.alertHistory,'deletedAt'),false);
  h.ctx.sync={repo:'example/retention-test',token:''};
  h.ctx.gh=async()=>({ok:true,status:200,text:async()=>JSON.stringify({history:[event(FIRST)]})});
  assert.equal(await h.ctx.readAlertHistory(),true);
  const reopened=load(JSON.parse(h.storage.get('retention-test-state')));
  assert.equal(Object.hasOwn(reopened.ctx.state.alertHistory,'deletedAt'),false);
  const empty=load();assert.equal(empty.ctx.acceptAlertHistory([]),false);assert.equal(empty.ctx.state.alertHistory,undefined);
});

test('89일·정확히 90일 된 삭제와 시각 없는 옛 ID는 남고 91일 된 ID만 두 필드에서 함께 빠진다',()=>{
  const h=load(),input={items:[],deletedIds:['at-89','at-90','at-91','legacy'],deletedAt:{'at-89':ago(89),'at-90':ago(90),'at-91':ago(91),'orphan':ago(1)}},before=plain(input);
  const merged=h.ctx.store.merge(input);
  assert.deepEqual(ids(merged),['at-89','at-90','legacy']);
  assert.deepEqual(plain(merged.deletedAt),{'at-89':ago(89),'at-90':ago(90)});
  assert.deepEqual(input,before,'병합 입력은 변경하지 않는다');
});

test('기기 병합은 같은 ID의 늦은 삭제 시각을 순서와 관계없이 쓰고 한쪽의 선택 필드도 보존한다',()=>{
  const h=load(),older={deletedIds:[FIRST,SECOND],deletedAt:{[FIRST]:ago(91)}},newer={deletedIds:[FIRST,SECOND],deletedAt:{[FIRST]:ago(89),[SECOND]:ago(1)}};
  for(const merged of [h.ctx.store.merge(older,newer),h.ctx.store.merge(newer,older)]){
    assert.deepEqual(ids(merged),[FIRST,SECOND]);
    assert.deepEqual(plain(merged.deletedAt),{[FIRST]:ago(89),[SECOND]:ago(1)});
  }
  for(const merged of [h.ctx.store.merge({deletedIds:[THIRD]},{deletedIds:[THIRD],deletedAt:{[THIRD]:ago(1)}}),h.ctx.store.merge({deletedIds:[THIRD],deletedAt:{[THIRD]:ago(1)}},{deletedIds:[THIRD]})]){
    assert.deepEqual(ids(merged),[THIRD]);assert.equal(merged.deletedAt[THIRD],ago(1));
  }
});

test('삭제 ID가 정리된 뒤 온 오래된 수신함 알림도 되살리지 않고 acknowledge한다',async()=>{
  const h=load({alertHistory:{items:[],deletedIds:[FIRST],deletedAt:{[FIRST]:ago(91)}}});
  h.ctx.state.alertHistory=plain(h.ctx.store.merge(h.ctx.state.alertHistory));
  assert.deepEqual(ids(h.ctx.state.alertHistory),[]);
  const acknowledged=[];h.ctx.store.pending=async()=>[h.ctx.store.record(event(FIRST,{occurredAt:ago(91)}))];
  h.ctx.store.acknowledge=async values=>acknowledged.push(plain(values));
  await h.ctx.collectAlertInbox();
  assert.equal(h.ctx.state.alertHistory.items.length,0);assert.deepEqual(acknowledged,[[FIRST]]);
});

test('삭제 ID가 정리된 뒤 서버 이력의 오래된 알림도 되살리지 않는다',async()=>{
  const h=load({alertHistory:{items:[],deletedIds:[FIRST],deletedAt:{[FIRST]:ago(91)}}});
  h.ctx.sync={repo:'example/retention-test',token:''};
  h.ctx.gh=async()=>({ok:true,status:200,text:async()=>JSON.stringify({history:[event(FIRST,{occurredAt:ago(91)})]})});
  await h.ctx.readAlertHistory();
  assert.deepEqual(ids(h.ctx.state.alertHistory),[]);assert.equal(h.ctx.state.alertHistory.items.length,0);
});

test('최근 알림과 경계 알림은 받고 재알림은 occurredAt보다 lastSentAt을 기준으로 받는다',()=>{
  const h=load();h.ctx.acceptAlertHistory([
    event('recent',{occurredAt:ago(89)}),event('boundary',{occurredAt:ago(90)}),event('too-old',{occurredAt:ago(91)}),
    event(FIRST,{occurredAt:ago(120),reminderCount:3,lastSentAt:ago(1)}),
    event('old-last-send',{occurredAt:ago(1),lastSentAt:ago(91)})
  ]);
  assert.deepEqual(plain(h.ctx.state.alertHistory.items.map(item=>item.id).sort()),[FIRST,'boundary','recent'].sort());
  assert.equal(h.ctx.state.alertHistory.items.find(item=>item.id===FIRST).lastSentAt,ago(1));
  h.ctx.acceptAlertHistory([event(SECOND,{alertKey:FIRST,reminderCount:4,firstOccurredAt:ago(120),occurredAt:ago(119),lastSentAt:ago(1)})]);
  assert.equal(h.ctx.state.alertHistory.items.find(item=>item.id===FIRST).reminderCount,4);
});

test('오래된 기존 항목에 최근 lastSentAt을 가진 후속 재알림을 합치면 마지막 발송 시각도 보존한다',()=>{
  const h=load();h.ctx.state.alertHistory=h.ctx.store.merge({items:[event(FIRST,{occurredAt:ago(120)})]});
  assert.equal(h.ctx.state.alertHistory.items[0].lastSentAt,undefined);
  h.ctx.acceptAlertHistory([event(SECOND,{alertKey:FIRST,reminderCount:4,firstOccurredAt:ago(120),occurredAt:ago(119),lastSentAt:ago(1)})]);
  const items=plain(h.ctx.state.alertHistory.items);
  assert.equal(items.length,1);assert.equal(items[0].id,FIRST);assert.equal(items[0].occurredAt,ago(120));
  assert.equal(items[0].reminderCount,4);assert.equal(items[0].lastSentAt,ago(1));
});

test('재알림 덮개 ID도 삭제 ID와 함께 정리하고 옛 재알림 수신은 acknowledge한다',async()=>{
  const mark=`${FIRST}:4`,h=load({alertHistory:{items:[],deletedIds:[FIRST,mark],deletedAt:{[FIRST]:ago(91),[mark]:ago(91)}}});
  const merged=h.ctx.store.merge(h.ctx.state.alertHistory);assert.deepEqual(ids(merged),[]);assert.equal(Object.hasOwn(merged,'deletedAt'),false);
  const acknowledged=[];h.ctx.store.pending=async()=>[h.ctx.store.record(event(SECOND,{alertKey:FIRST,reminderCount:4,firstOccurredAt:ago(120),occurredAt:ago(91),lastSentAt:ago(91)}))];
  h.ctx.store.acknowledge=async values=>acknowledged.push(plain(values));
  await h.ctx.collectAlertInbox();
  assert.equal(h.ctx.state.alertHistory.items.length,0);assert.deepEqual(ids(h.ctx.state.alertHistory),[]);assert.deepEqual(acknowledged,[[SECOND]]);
});

test('지우지 않은 오래된 items와 동기화로 들어온 items는 merge·불러오기 뒤에도 보존한다',()=>{
  const h=load(),old=h.ctx.store.record(event(FIRST,{occurredAt:ago(365)}));
  const merged=h.ctx.store.merge({items:[old]},{deletedIds:[SECOND],deletedAt:{[SECOND]:ago(91)}});
  assert.deepEqual(plain(merged.items),[plain(old)]);
  const local=JSON.stringify({plans:[],alertHistory:{items:[]}}),remote=JSON.stringify({plans:[],alertHistory:{items:[old]}});
  const aligned=h.ctx.alignAlertHistorySnapshots(local,remote,null);
  assert.deepEqual(JSON.parse(aligned.local).alertHistory.items,[plain(old)]);
  assert.deepEqual(JSON.parse(aligned.remote).alertHistory.items,[plain(old)]);
  h.ctx.acceptAlertHistory([]);assert.deepEqual(plain(h.ctx.state.alertHistory.items),[plain(old)]);
});

const validate=vm.runInNewContext(source('data-validation.js')+'\nexternalData');
test('deletedAt의 Z·시간대 ISO와 128자 키는 검증만 하고 누락된 선택 필드를 생성하지 않는다',()=>{
  for(const deletedAt of [{[FIRST]:NOW},{[FIRST]:'2026-11-02T21:00:00+09:00'},{[FIRST]:'2026-11-02T03:00:00-09:00'},{['x'.repeat(128)]:NOW},{}]){
    const data={plans:[],futures:{},alertHistory:{items:[],deletedIds:[FIRST],deletedAt}},before=plain(data);
    assert.equal(validate.planner(data),data);assert.deepEqual(data,before);
  }
  const legacy={plans:[],futures:{},alertHistory:{items:[],deletedIds:[FIRST]}};
  assert.equal(validate.planner(legacy),legacy);assert.equal(Object.hasOwn(legacy.alertHistory,'deletedAt'),false);
});

test('deletedAt의 배열·숫자 값·시각 형식 오류·129자 키는 기존 기록을 바꾸지 않고 거부한다',()=>{
  for(const deletedAt of [[],{[FIRST]:123},{[FIRST]:'2026-11-02T12:00:00'},{[FIRST]:'2026-11-02'},{[FIRST]:'not-an-iso-time'},{[FIRST]:'2026-13-02T12:00:00Z'},{['x'.repeat(129)]:NOW}]){
    const data={plans:[],futures:{},alertHistory:{items:[],deletedIds:[FIRST],deletedAt}},before=plain(data);
    assert.throws(()=>validate.planner(data),/기록 형식/);assert.deepEqual(data,before);
  }
});
