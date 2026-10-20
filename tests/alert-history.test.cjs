const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=name=>fs.readFileSync(path.join(__dirname,'..','js',name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const event=(id='event-1',extra={})=>({eventId:id,ticker:'TEST',ruleId:'trade:buy:one:round',line:'분할매수 25선 2차',name:'예제 ETF',price:101.2345,ma:100.1234,currency:'USD',condition:'up',trigger:'reach',observedAt:'2026-10-14T01:02:03Z',occurredAt:'2026-10-14T01:02:10Z',body:'분할매수 25선 2차 기준가 이상 도달',...extra});
function load(initial={}){
  let saves=0;const storage=new Map(),nodes=new Map();
  const ctx=vm.createContext({state:plain(initial),Intl,Date,Set,Map,JSON,URLSearchParams,
    STORAGE_KEY:'test-state',save:()=>{saves++;storage.set('test-state',JSON.stringify(ctx.state));},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    $:name=>{if(!nodes.has(name))nodes.set(name,{classList:{toggle(){}},setAttribute(){}});return nodes.get(name);},$$:()=>[],
    esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))});
  vm.runInContext(source('alert-history-store.js')+'\n;\n'+source('alert-history.js')+'\n;globalThis.store=alertHistoryStore',ctx);
  return {ctx,nodes,storage,saves:()=>saves};
}
test('화면·빈 수신함 조회는 옛 기록에 알림내역이나 과거 알림을 만들지 않는다',()=>{
  const h=load({plans:[],alerts:{rules:[]}}),before=JSON.stringify(h.ctx.state);
  h.ctx.renderAlertHistory();assert.equal(h.ctx.acceptAlertHistory([]),false);
  assert.equal(JSON.stringify(h.ctx.state),before);assert.equal(h.saves(),0);
  assert.match(h.nodes.get('alertHistoryList').innerHTML,/기능 적용 이후/);
});
test('당시 조건·소수 가격·기준값·발생 시각을 저장하고 최신순으로 표시한다',()=>{
  const h=load({plans:[{id:'original',ticker:'OTHER'}]});
  h.ctx.acceptAlertHistory([event('later',{occurredAt:'2026-10-14T01:03:00+00:00'}),event('earlier')]);
  const items=plain(h.ctx.state.alertHistory.items);assert.deepEqual(items.map(item=>item.id),['later','earlier']);
  assert.equal(items[1].occurredAt,'2026-10-14T01:02:10.000Z');assert.equal(items[1].observedAt,'2026-10-14T01:02:03.000Z');
  assert.equal(items[1].price,101.2345);assert.equal(items[1].ma,100.1234);assert.equal(items[1].name,'예제 ETF');
  assert.match(h.ctx.alertHistoryCondition(items[1]),/기준값 \$100.1234 이상에 도달/);
  assert.deepEqual(plain(h.ctx.state.plans),[{id:'original',ticker:'OTHER'}]);
  const reopened=load(JSON.parse(h.storage.get('test-state')));assert.deepEqual(plain(reopened.ctx.state.alertHistory),plain(h.ctx.state.alertHistory));
});
test('발송 재시도·다른 기기 수신은 중복 저장하지 않고 바뀐 현재 기준으로 과거 가격을 덮어쓰지 않는다',()=>{
  const h=load();h.ctx.acceptAlertHistory([event()]);const saved=h.saves();
  assert.equal(h.ctx.acceptAlertHistory([event()]),false);assert.equal(h.saves(),saved);
  h.ctx.acceptAlertHistory([event('event-1',{price:999,ma:888,name:'나중 이름'})]);
  assert.equal(h.ctx.state.alertHistory.items.length,1);assert.equal(h.ctx.state.alertHistory.items[0].price,101.2345);assert.equal(h.ctx.state.alertHistory.items[0].name,'예제 ETF');
  h.ctx.acceptAlertHistory([event('event-2')]);assert.equal(h.ctx.state.alertHistory.items.length,2);
});
test('읽음·개별/전체 삭제는 재수신·기기 병합·백업 왕복 뒤에도 유지된다',()=>{
  const h=load();h.ctx.acceptAlertHistory([event('one'),event('two')]);h.ctx.markAlertHistoryRead('one');
  assert.ok(h.ctx.state.alertHistory.items.find(item=>item.id==='one').readAt);
  const other=h.ctx.store.merge({items:[event('one'),event('two')]},h.ctx.state.alertHistory);
  assert.ok(other.items.find(item=>item.id==='one').readAt);
  h.ctx.removeAlertHistory('one');h.ctx.acceptAlertHistory([event('one')]);
  assert.deepEqual(plain(h.ctx.state.alertHistory.items.map(item=>item.id)),['two']);
  const allDeleted=h.ctx.store.merge(h.ctx.state.alertHistory,{deletedIds:['two']});
  const restored=h.ctx.store.merge(JSON.parse(JSON.stringify(allDeleted)),{items:[event('one'),event('two')]});
  assert.equal(restored.items.length,0);assert.deepEqual(plain(restored.deletedIds),['one','two']);
});
test('상세 조건은 이상·이하·미만·허용범위·상하 통과를 구분한다',()=>{
  const h=load();
  for(const [condition,text] of [['up','이상에 도달'],['down','이하에 도달'],['below','미만으로 이탈']])assert.match(h.ctx.alertHistoryCondition(h.ctx.store.record(event('one',{condition}))),new RegExp(text));
  const near=h.ctx.store.record(event('near',{condition:undefined,trigger:'near',tolerancePct:.5}));assert.match(h.ctx.alertHistoryCondition(near),/±0.5% 범위에 진입/);
  const cross=h.ctx.store.record(event('cross',{condition:undefined,trigger:'cross',direction:'down'}));assert.match(h.ctx.alertHistoryCondition(cross),/위에서 아래로 통과/);
  const cut=h.ctx.store.record(event('cut',{line:'재매수 신저점 이탈',condition:'below'}));assert.equal(cut.type,'손절');
});
test('임의 발생시간·허위 과거·토큰·구독·HTML을 저장하거나 실행하지 않는다',()=>{
  const h=load();assert.equal(h.ctx.store.record(event('bad',{occurredAt:undefined,observedAt:undefined})),null);
  assert.equal(h.ctx.store.record(event('bad',{ticker:'https://outside.test'})),null);
  const item=h.ctx.store.record(event('safe',{token:'secret',subscription:{endpoint:'secret'},name:'<img onerror="x">',price:true,ma:Infinity}));
  assert.equal(item.price,undefined);assert.equal(item.ma,undefined);assert.doesNotMatch(JSON.stringify(item),/secret|subscription|token/);
  assert.doesNotMatch(h.ctx.alertHistoryCard(item),/<img/);assert.match(h.ctx.alertHistoryCard(item),/&lt;img/);
});
test('알림내역만 병합하면 거래 차이는 그대로 남고 서로 다른 기기의 새 알림·읽음·삭제는 합쳐진다',()=>{
  const a=load();a.ctx.acceptAlertHistory([event('one')]);a.ctx.markAlertHistoryRead('one');
  const b=load();b.ctx.acceptAlertHistory([event('two'),event('deleted')]);b.ctx.removeAlertHistory('deleted');
  const local=JSON.stringify({plans:[{id:'local'}],alertHistory:a.ctx.state.alertHistory}),remote=JSON.stringify({plans:[{id:'remote'}],alertHistory:b.ctx.state.alertHistory});
  const out=a.ctx.alignAlertHistorySnapshots(local,remote,JSON.stringify({plans:[]}));
  const l=JSON.parse(out.local),r=JSON.parse(out.remote),base=JSON.parse(out.base);
  assert.deepEqual(l.plans,[{id:'local'}]);assert.deepEqual(r.plans,[{id:'remote'}]);assert.deepEqual(l.alertHistory,r.alertHistory);assert.deepEqual(l.alertHistory,base.alertHistory);
  assert.deepEqual(l.alertHistory.items.map(item=>item.id).sort(),['one','two']);assert.ok(l.alertHistory.items.find(item=>item.id==='one').readAt);
});
test('앱이 닫혔을 때 누른 알림은 뒤늦게 복원된 내역도 읽음으로 표시한다',()=>{
  const h=load();h.ctx.noteAlertHistoryRead('later');h.ctx.acceptAlertHistory([event('later')]);assert.ok(h.ctx.state.alertHistory.items[0].readAt);
});
// 미완료 매매 재알림(수집 저장소 trade_reminders.py): 같은 회차의 후속 알림은 alertKey=최초 알림 ID로 한 항목에 합친다.
const FIRST='a'.repeat(64),OTHER='b'.repeat(64);
const followUp=(id,count,occurredAt,extra={})=>event(id,{alertKey:FIRST,reminderCount:count,firstOccurredAt:'2026-10-14T01:02:10Z',occurredAt,price:99,tradeReminder:true,...extra});
test('같은 매매 회차 알림이 세 번 와도 항목 하나에 재알림 횟수·마지막 발송 시각만 더하고 읽음·당시 가격을 유지한다',()=>{
  const h=load();h.ctx.acceptAlertHistory([event(FIRST)]);h.ctx.markAlertHistoryRead(FIRST);
  const readAt=h.ctx.state.alertHistory.items[0].readAt;
  h.ctx.acceptAlertHistory([followUp('r'.repeat(64),1,'2026-10-15T00:45:00Z')]);
  h.ctx.acceptAlertHistory([followUp('s'.repeat(64),2,'2026-10-16T00:45:00Z'),followUp('r'.repeat(64),1,'2026-10-15T00:45:00Z')]);
  const items=plain(h.ctx.state.alertHistory.items);assert.equal(items.length,1);
  assert.deepEqual([items[0].id,items[0].reminderCount,items[0].lastSentAt,items[0].readAt,items[0].price],[FIRST,2,'2026-10-16T00:45:00.000Z',readAt,101.2345]);
  assert.equal(items[0].occurredAt,'2026-10-14T01:02:10.000Z');
  for(const field of ['alertKey','tradeReminder','firstOccurredAt'])assert.equal(items[0][field],undefined);
  assert.deepEqual(plain(h.ctx.state.alertHistory.deletedIds),[]);
  const card=h.ctx.alertHistoryCard(items[0]);
  assert.match(card,/재알림 2회/);assert.match(card,/마지막 발송/);assert.match(card,/data-open-history="a{64}"/);
  const reopened=load(JSON.parse(h.storage.get('test-state')));assert.deepEqual(plain(reopened.ctx.state.alertHistory),plain(h.ctx.state.alertHistory));
});
test('여러 기기·수신함·발송 이력의 재알림은 순서와 중복에 관계없이 같은 한 항목이 된다',()=>{
  const first=event(FIRST),one=followUp('r'.repeat(64),1,'2026-10-15T00:45:00Z'),two=followUp('s'.repeat(64),2,'2026-10-16T05:10:00Z');
  const h=load(),results=[[{items:[first,one]},{items:[two]}],[{items:[two]},{items:[one,first]}],[{items:[two,two,first,one,one]}]].map(groups=>plain(h.ctx.store.merge(...groups)));
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[0],results[2]);
  assert.deepEqual(results[0].items.map(item=>[item.id,item.reminderCount]),[[FIRST,2]]);
  const again=plain(h.ctx.store.merge(results[0],{items:[one]}));assert.deepEqual(again,results[0]);
  const deleted=plain(h.ctx.store.merge(results[0],{deletedIds:[FIRST]},{items:[followUp('t'.repeat(64),3,'2026-10-17T00:45:00Z')]}));
  assert.deepEqual(deleted.items,[]);assert.deepEqual(deleted.deletedIds,[FIRST]);
});
test('최초 알림이 없는 기기는 재알림으로 한 항목을 만들고 서로 다른 회차·매수매도는 따로 둔다',()=>{
  const h=load();
  h.ctx.acceptAlertHistory([followUp('r'.repeat(64),1,'2026-10-15T00:45:00Z'),event(OTHER,{ruleId:'trade:buy:one:round:2',line:'분할매수 25선 3차'}),
    event('c'.repeat(64),{ruleId:'trade:plan:demo:0',line:'분할매도 첫 매도',condition:'down'}),
    followUp('u'.repeat(64),1,'2026-10-15T01:00:00Z',{alertKey:OTHER,ruleId:'trade:buy:one:round:2',line:'분할매수 25선 3차'})]);
  const items=plain(h.ctx.state.alertHistory.items);
  assert.deepEqual(items.map(item=>[item.id,item.reminderCount||0]).sort(),[[FIRST,1],[OTHER,1],['c'.repeat(64),0]]);
  const placeholder=items.find(item=>item.id===FIRST);assert.equal(placeholder.occurredAt,'2026-10-14T01:02:10.000Z');assert.equal(placeholder.readAt,undefined);
  h.ctx.acceptAlertHistory([event(FIRST)]);assert.equal(h.ctx.state.alertHistory.items.filter(item=>item.id===FIRST).length,1);
});
test('예전 수신함이 alertKey 없이 저장한 재알림은 합치고 다시 나타나지 않는다',()=>{
  const h=load(),reminder='r'.repeat(64);
  h.ctx.acceptAlertHistory([event(FIRST),event(reminder,{occurredAt:'2026-10-15T00:45:00Z'})]);h.ctx.markAlertHistoryRead(reminder);
  assert.equal(h.ctx.state.alertHistory.items.length,2);
  h.ctx.acceptAlertHistory([followUp(reminder,1,'2026-10-15T00:45:00Z')]);
  const items=plain(h.ctx.state.alertHistory.items);assert.deepEqual(items.map(item=>item.id),[FIRST]);assert.ok(items[0].readAt);
  assert.deepEqual(plain(h.ctx.state.alertHistory.deletedIds),[reminder]);
  h.ctx.acceptAlertHistory([event(reminder,{occurredAt:'2026-10-15T00:45:00Z'})]);assert.equal(h.ctx.state.alertHistory.items.length,1);
});
test('잘못된 재알림 필드는 합치지 않고 일반 알림으로만 저장하며 최근 발송 순으로 정렬한다',()=>{
  const h=load();
  for(const extra of [{alertKey:'../x'},{alertKey:FIRST,reminderCount:0},{alertKey:FIRST,reminderCount:1.5},{alertKey:FIRST,reminderCount:true}]){
    const item=h.ctx.store.record(event('x'.repeat(64),extra));assert.equal(item.alertKey,undefined);
  }
  assert.equal(h.ctx.store.record(event(FIRST,{alertKey:FIRST,reminderCount:1})).alertKey,undefined);
  h.ctx.acceptAlertHistory([event(FIRST),event('newer',{occurredAt:'2026-10-15T00:00:00Z'}),followUp('r'.repeat(64),1,'2026-10-16T00:45:00Z')]);
  assert.deepEqual(plain(h.ctx.state.alertHistory.items.map(item=>item.id)),[FIRST,'newer']);
});
test('달러선물 알림의 당시 가격·기준값은 달러선물 화면처럼 소수 둘째 자리까지, 다른 알림은 넷째 자리까지 보인다',()=>{
  const h=load();vm.runInContext(source('stock-names.js'),h.ctx);
  const future=event('future',{ticker:'202612',ruleId:'trade:future:0:2',line:'달러선물 25일선 2차',name:'',price:1371.6666666666667,ma:1371.6666666666667,currency:'KRW',condition:'below'});
  h.ctx.acceptAlertHistory([future,event('etf')]);
  const items=plain(h.ctx.state.alertHistory.items),card=id=>h.ctx.alertHistoryCard(items.find(item=>item.id===id));
  assert.match(card('future'),/당시 가격 <strong>1,371\.67원<\/strong>.*기준값 <strong>1,371\.67원<\/strong>/s);assert.match(card('future'),/기준값 1,371\.67원 미만으로 이탈/);
  assert.match(card('etf'),/기준값 <strong>\$100\.1234<\/strong>/);
  assert.equal(items.find(item=>item.id==='future').ma,1371.6666666666667,'저장된 가격은 그대로');
});
