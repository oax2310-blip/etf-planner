const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 종목 표시 이름(js/stock-names.js): 화면·알림 글자만 바꾸고 기록·알림 식별은 종목 코드 그대로. 가상 종목·가격만 사용한다.
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// rebuy.js의 실제 rebuyItems(옛 단일 재매수도 목록으로 읽기)를 그대로 쓴다.
const rebuyItemsSource=/^const rebuyItems = .*$/m.exec(read('js/rebuy.js'))[0];

// 페이지와 서비스 워커가 함께 쓰는 아주 작은 IndexedDB(같은 객체를 넘기면 같은 기기).
function fakeIndexedDB(){
  const dbs=new Map(),writes=[];
  return {writes,dbs,open(name){
    const request={};
    queueMicrotask(()=>{
      const fresh=!dbs.has(name);if(fresh)dbs.set(name,new Map());
      const stores=dbs.get(name);
      request.result={close(){},createObjectStore(store){stores.set(store,new Map());},transaction(store){
        const tx={},data=stores.get(store);
        queueMicrotask(()=>queueMicrotask(()=>tx.oncomplete?.()));
        tx.objectStore=()=>({get(key){const r={};queueMicrotask(()=>{r.result=structuredClone(data.get(key));r.onsuccess?.();});return r;},
          put(value,key){writes.push({name,store,key,value:structuredClone(value)});data.set(key,structuredClone(value));}});
        return tx;
      }};
      if(fresh)request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }};
}
function timers(){
  const queue=new Map();let next=0;
  return {setTimeout:fn=>{queue.set(++next,fn);return next;},clearTimeout:key=>queue.delete(key),
    async flush(){for(const [key,fn] of [...queue]){queue.delete(key);fn();}for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));}};
}
// 플래너 페이지: state(분할매도·재매수·직접 추가 알림)와 자산 배분(assetStore)만 둔다.
function page({plans=[],rebuy,groups=[],rules=[]}={},idb=null){
  const clock=timers();
  const ctx=vm.createContext({state:{plans,...(rebuy?{rebuy}:{}),...(rules.length?{alerts:{rules}}:{})},assetStore:{doc:{allocation:{groups}}},
    setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,...(idb?{indexedDB:idb}:{})});
  vm.runInContext(`${rebuyItemsSource}\nconst alertRules=()=>state.alerts?.rules||[];\n${read('js/stock-names.js')}`,ctx);
  return {ctx,names:vm.runInContext('stockNames',ctx),flush:clock.flush};
}
const groups=()=>[{id:'g',name:'ISA',items:[
  {id:'track',name:'가상 미국500 ETF',ticker:'SPY',tradeTicker:'360750',amount:10,shares:3,buyPlan:{lines:{names:['25선'],budget:5}}},
  {id:'kr',name:'가상 코스피 ETF',ticker:'A069500',amount:20,note:'메모 비밀'}
]}];
const plans=()=>[
  {id:'auto',ticker:'360750',title:'',stages:3,checked:[false,false,false],holdings:[]},
  {id:'titled',ticker:'SPY',title:'가상 S&P 계획',stages:3,checked:[false,false,false],holdings:[{name:'가상 S&P 계획',shares:7}]},
  {id:'bare',ticker:'QQQ',title:'',stages:2,checked:[false,false],holdings:[]},
  {id:'carded',ticker:'069500',title:'코스피 계획',cardName:'내 카드',stages:2,checked:[false,false],holdings:[]}
];
const rebuy=()=>({items:[{id:'r1',ticker:'NVDA',name:'가상 반도체',stages:[]},{id:'r2',ticker:'TSLA',name:'',stages:[]}]});

test('종목 코드로 이름을 찾되 기준 코드만 같은 추종 ETF 이름은 쓰지 않고, 못 찾으면 빈 값·코드로 돌아간다',()=>{
  const p=page({plans:plans(),rebuy:rebuy(),groups:groups()}),before=JSON.stringify(p.ctx.state)+JSON.stringify(p.ctx.assetStore);
  const {lookup,planName}=p.names;
  assert.equal(lookup('360750'),'가상 미국500 ETF','실제 거래 코드');
  assert.equal(lookup('a360750'),'가상 미국500 ETF','국내 A 접두·소문자');
  assert.equal(lookup('069500'),'가상 코스피 ETF','자산 배분의 A069500과 같은 종목');
  assert.equal(lookup('SPY'),'가상 S&P 계획','추종 ETF의 기준 코드(SPY)는 그 ETF 이름 대신 분할매도 계획 이름');
  assert.equal(lookup('NVDA'),'가상 반도체');
  assert.equal(lookup('TSLA'),'','이름이 빈 재매수는 건너뜀');
  assert.equal(lookup('QQQ'),'');assert.equal(lookup(''),'');assert.equal(lookup(null),'');
  const [auto,titled,bare,carded]=p.ctx.state.plans;
  assert.deepEqual([planName(auto),planName(titled),planName(bare),planName(carded)],['가상 미국500 ETF','가상 S&P 계획','QQQ','코스피 계획']);
  assert.equal(JSON.stringify(p.ctx.state)+JSON.stringify(p.ctx.assetStore),before,'이름을 찾는 것만으로 기록을 바꾸지 않는다');
});

test('목록 카드의 같은 이름은 다른 코드일 때만 구분이 필요하다',()=>{
  const {clashes}=page().names;
  const clash=clashes([{name:'S&P500',code:'SPY'},{name:'S&P500 ',code:'360750'},{name:'나스닥',code:'QQQ'},{name:'나스닥',code:'qqq'},{name:'',code:'X'}]);
  assert.deepEqual(['S&P500','나스닥','없는 이름',''].map(clash),[true,false,false,false]);
});
test('이름표의 일괄 조회는 개별 조회와 같은 첫 이름·우선순위를 쓰며 다음 호출에 변경을 반영한다',()=>{
  const ps=Array.from({length:120},(_,i)=>({id:'p'+i,ticker:'T'+i,title:i%3?'계획 '+i:'',cardName:i%7?'':'카드 '+i}));
  const rs=ps.map((p,i)=>({id:'r'+i,ticker:p.ticker,name:i%2?'재매수 '+i:''}));
  const its=ps.flatMap((p,i)=>[{id:'a'+i,ticker:'B'+i,tradeTicker:p.ticker,name:i%4?'자산 '+i:'',buyPlan:{}},{id:'b'+i,ticker:p.ticker,name:'두 번째 '+i}]);
  const p=page({plans:ps,rebuy:{items:rs},groups:[{items:its}],rules:[{ticker:'MISSING'}]});
  for(let round=0;round<2;round++){
    const before=JSON.stringify(p.ctx.state)+JSON.stringify(p.ctx.assetStore),map=p.names.alertMap();
    for(const plan of ps){assert.equal(map.codes[plan.ticker],p.names.lookup(plan.ticker));assert.equal(map.rules[`trade:plan:${plan.id}:`][0],plan.cardName||p.names.planName(plan));}
    for(const r of rs)assert.equal(map.rules[`trade:rebuy:${r.id}:`][0],r.name||p.names.lookup(r.ticker));
    for(const it of its)if(it.ticker.startsWith('B'))assert.equal(map.codes[it.ticker],undefined,'추종 기준 코드는 거래 종목 이름을 받지 않는다');
    assert.equal(map.codes.MISSING,undefined);assert.equal(JSON.stringify(p.ctx.state)+JSON.stringify(p.ctx.assetStore),before);
    for(const it of its)it.name='수정 '+it.id;
  }
});

test('알림 종류는 규칙 ID의 메뉴(분할매수·분할매도·재매수·달러선물)로, 옛 알림은 기준선 글자로 구분한다',()=>{
  const {alertKind}=page().names;
  const cases=[
    [{ruleId:'trade:plan:p1:0',line:'분할매도 첫 매도'},'분할매도'],
    [{ruleId:'trade:buy:i1:25선:0',line:'분할매수 25선 1차'},'분할매수'],
    [{ruleId:'trade:buy:i1:wait',line:'매수대기 60일선'},'분할매수 · 매수대기'],
    [{ruleId:'trade:rebuy:r1:breakdown',line:'재매수 신저점 이탈'},'재매수 · 손절'],
    [{ruleId:'trade:rebuy:r1:cut:0',line:'재매수 손절 1회'},'재매수 · 손절'],
    [{ruleId:'trade:rebuy:r1:buy:25%EC%84%A0:0',line:'재매수 25선'},'재매수'],
    [{ruleId:'trade:future:0:2',line:'달러선물 25일선 2차'},'달러선물 · 매수'],
    [{ruleId:'trade:future-rebuy:breakdown',line:'달러선물 신저점 손절 시작'},'달러선물 · 손절'],
    [{ruleId:'trade:future-rebuy:buy:stage:0',line:'달러선물 재매수 25선'},'달러선물 · 재매수'],
    [{ruleId:'0b4f-uuid',line:'60일선'},'이동평균선'],
    [{line:'분할매도 2회'},'분할매도'],[{line:'재매수 손절 2회'},'재매수 · 손절'],[{line:'매수대기 25선'},'분할매수 · 매수대기'],[{},'이동평균선']
  ];
  for(const [data,text] of cases)assert.equal(alertKind(data).text,text,JSON.stringify(data));
});

test('알림 이름은 발송 이름 → 이 기기의 계획·자산 이름 → 코드 순이고 같은 이름이 다른 코드에도 있으면 코드를 함께 보인다',()=>{
  const p=page({plans:plans(),rebuy:rebuy(),groups:groups(),rules:[{id:'ma1',ticker:'A069500',period:60,unit:'일선'}]}),{alertMap,alertName,alertSubject}=p.names;
  const before=JSON.stringify(p.ctx.state)+JSON.stringify(p.ctx.assetStore),map=alertMap();
  assert.equal(JSON.stringify(p.ctx.state)+JSON.stringify(p.ctx.assetStore),before,'이름표를 만들어도 기록은 그대로');
  assert.doesNotMatch(JSON.stringify(map),/메모 비밀|shares|amount|budget|notify/,'이름·코드만 담는다');
  assert.deepEqual(plain(map.rules['trade:plan:carded:']),['내 카드','069500'],'카드 이름이 있는 분할매도는 서버 발송 이름과 같은 카드 이름');
  // 분할매도 카드 이름이 없으면 서버는 코드만 보낸다 → 계획 이름(없으면 같은 코드의 종목 이름).
  assert.equal(alertName({ticker:'SPY',name:'SPY',ruleId:'trade:plan:titled:1'},map),'가상 S&P 계획');
  assert.equal(alertName({ticker:'360750',name:'360750',ruleId:'trade:plan:auto:0'},map),'가상 미국500 ETF');
  assert.equal(alertName({ticker:'SPY',name:'서버 이름',ruleId:'trade:buy:track:wait'},map),'서버 이름','발송 이름(자산 배분 종목·재매수 이름)이 우선');
  assert.equal(alertName({ticker:'069500',name:'069500',ruleId:'ma1'},map),'가상 코스피 ETF','직접 추가 기준선은 코드로 찾는다');
  assert.equal(alertName({ticker:'ZZZ',name:'ZZZ',ruleId:'trade:plan:gone:0'},map),'ZZZ','삭제된 계획·모르는 코드는 코드');
  assert.equal(alertName({ticker:'ZZZ'},null),'ZZZ','이름표가 없어도 코드');
  assert.equal(alertSubject({ticker:'SPY',name:'SPY',ruleId:'trade:plan:titled:1'},map),'가상 S&P 계획');
  assert.equal(alertSubject({ticker:'202612',name:'달러선물 2026.12',ruleId:'trade:future:0'},map),'2026.12월물');
  // 다른 코드의 계획에 같은 이름을 붙이면 이름만으로는 구분할 수 없다.
  const twin=page({plans:[{id:'a',ticker:'SPY',title:'S&P500'},{id:'b',ticker:'360750',title:'S&P500'}]}).names,twinMap=twin.alertMap();
  assert.equal(twin.alertSubject({ticker:'SPY',name:'SPY',ruleId:'trade:plan:a:0'},twinMap),'S&P500 (SPY)');
  assert.equal(twin.alertSubject({ticker:'360750',name:'360750',ruleId:'trade:plan:b:0'},twinMap),'S&P500 (360750)');
});

test('푸시 글자: 제목은 알림 종류와 종목명, 본문은 코드만 빼고 조건·가격·재알림 정보를 그대로 둔다',()=>{
  const p=page({plans:plans(),rebuy:rebuy(),groups:groups()}),{notice,alertMap}=p.names,map=alertMap();
  const sent=(extra)=>({ticker:'SPY',name:'SPY',line:'분할매도 2회',ruleId:'trade:plan:titled:1',title:'매매 기준 알림',body:'SPY 분할매도 2회 기준가 이하 도달 · 현재 500.0000 · 기준 510.0000',...extra});
  assert.deepEqual(plain(notice(sent(),map)),{title:'분할매도 알림 · 가상 S&P 계획',body:'분할매도 2회 기준가 이하 도달 · 현재 500.0000 · 기준 510.0000'});
  assert.equal(notice(sent({title:'매매 기준 재알림',body:'SPY 분할매도 2회 기준가 이하 도달 · 현재 500.0000 · 기준 510.0000 · 매매 미완료 재알림 2회'}),map).title,'분할매도 재알림 · 가상 S&P 계획');
  assert.match(notice(sent({title:'매매 기준 재알림',body:'SPY 분할매도 2회 · 매매 미완료 재알림 2회'}),map).body,/재알림 2회$/);
  assert.equal(notice(sent({title:'한국장 재알림'}),map).title,'분할매도 한국장 재알림 · 가상 S&P 계획');
  assert.deepEqual(plain(notice({ticker:'NVDA',name:'가상 반도체',line:'재매수 손절 1회',ruleId:'trade:rebuy:r1:cut:0',title:'매매 기준 알림',body:'NVDA 재매수 손절 1회 기준가 이하 도달'},map)),{title:'재매수 알림 · 가상 반도체',body:'재매수 손절 1회 기준가 이하 도달'});
  assert.equal(notice({ticker:'SPY',name:'가상 미국500 ETF',line:'분할매수 25선 1차',ruleId:'trade:buy:track:25선:0',title:'매매 기준 알림',body:'SPY 분할매수 25선 1차'},map).title,'분할매수 알림 · 가상 미국500 ETF');
  assert.deepEqual(plain(notice({ticker:'069500',name:'069500',line:'60일선',ruleId:'ma1',title:'이동평균선 알림',body:'069500 60일선 근처에 닿음 · 현재 1.0000'},map)),{title:'이동평균선 알림 · 가상 코스피 ETF',body:'60일선 근처에 닿음 · 현재 1.0000'});
  assert.equal(notice({ticker:'202612',name:'달러선물 2026.12',line:'달러선물 25일선',ruleId:'trade:future:0',title:'매매 기준 알림',body:'202612 달러선물 25일선 기준가 이상 도달'},map).title,'달러선물 알림 · 2026.12월물');
  assert.equal(notice({ticker:'QQQ',name:'QQQ',line:'분할매도 1회',ruleId:'trade:plan:bare:0',title:'매매 기준 알림',body:'QQQ 분할매도 1회'},map).title,'분할매도 알림 · QQQ','이름을 못 찾으면 코드');
  // 이동평균선 이름은 보일 때만 N월선(받은 기록·규칙 이름은 N개월선 그대로).
  assert.deepEqual(plain(notice({ticker:'SPY',name:'가상 미국500 ETF',line:'매수대기 25개월선',ruleId:'trade:buy:track:wait',title:'매매 기준 알림',body:'SPY 매수대기 25개월선 기준가 이하 도달'},map)),{title:'분할매수 알림 · 가상 미국500 ETF',body:'매수대기 25월선 기준가 이하 도달'});
  assert.equal(notice({title:'새 형식 32개월선',body:'SPY 32개월선 근처'},map).body,'SPY 32월선 근처');assert.equal(p.names.lineText('달러선물 25개월선'),'달러선물 25월선');
  // 모르는 제목·코드 없는 알림은 발송 글자를 그대로, 비어 있으면 기존 기본 문구.
  assert.deepEqual(plain(notice({ticker:'SPY',title:'새 형식 제목',body:'SPY 본문'},map)),{title:'새 형식 제목',body:'SPY 본문'});
  assert.deepEqual(plain(notice({},map)),{title:'매매 플래너 알림',body:'설정한 기준선 알림을 확인해 주세요.'});
  assert.equal(notice({ticker:'SPY',line:'분할매도 1회',body:'다른 형식 SPY 본문'},null).body,'다른 형식 SPY 본문','앞이 코드가 아닌 본문은 그대로');
  assert.equal(notice({ticker:'SPY',title:'매매 기준 알림',line:'분할매도 1회',name:'x'.repeat(300)},null).title.length,100);
});

test('페이지는 바뀐 이름표만 이 기기에 저장하고 서비스 워커는 같은 이름표로 알림을 보인다(수신함에는 받은 내용 그대로)',async()=>{
  const idb=fakeIndexedDB(),p=page({plans:plans(),rebuy:rebuy(),groups:groups()},idb);
  p.names.remember();p.names.remember();await p.flush();
  assert.equal(idb.writes.length,1,'연달아 저장해도 한 번');
  assert.deepEqual(plain(idb.writes[0].value),plain(p.names.alertMap()));
  p.names.remember();await p.flush();assert.equal(idb.writes.length,1,'같은 이름표는 다시 쓰지 않음');
  p.ctx.state.plans[1].title='바뀐 계획 이름';p.names.remember();await p.flush();assert.equal(idb.writes.length,2);
  assert.doesNotMatch(JSON.stringify(idb.writes),/메모 비밀|"shares"|"amount"/);

  const shown=[],posted=[],self={registration:{scope:'https://example.test/etf-planner/',showNotification:async(...args)=>shown.push(args)},addEventListener:(name,fn)=>self[name]=fn,
    clients:{matchAll:async()=>[{postMessage:message=>posted.push(message)}],claim:async()=>{}},skipWaiting:async()=>{}};
  const sw=vm.createContext({self,URL,URLSearchParams,indexedDB:idb,setTimeout:()=>0});
  sw.importScripts=(...names)=>names.forEach(name=>vm.runInContext(read(name.split('?')[0]),sw));
  vm.runInContext(read('push-sw.js'),sw);
  const data={eventId:'e1',ticker:'SPY',name:'SPY',line:'분할매도 2회',ruleId:'trade:plan:titled:1',title:'매매 기준 알림',body:'SPY 분할매도 2회 기준가 이하 도달',occurredAt:'2026-10-14T01:02:10Z',price:500,ma:510,condition:'down',trigger:'reach'};
  let task;self.push({data:{json:()=>data},waitUntil:promise=>task=promise});await task;
  assert.equal(shown[0][0],'분할매도 알림 · 바뀐 계획 이름');assert.equal(shown[0][1].body,'분할매도 2회 기준가 이하 도달');
  assert.equal(shown[0][1].tag,'e1');assert.match(shown[0][1].data.url,/#alert\?ticker=SPY&line=/,'이동 주소는 코드·규칙 ID 그대로');
  assert.equal(posted[0].item.name,'SPY','수신함 기록은 받은 이름 그대로(표시할 때만 바꾼다)');

  // 이름표가 없는 기기(IndexedDB 없음)는 발송 이름으로 보인다.
  const plainShown=[],bare={registration:{scope:'https://example.test/etf-planner/',showNotification:async(...args)=>plainShown.push(args)},addEventListener:(name,fn)=>bare[name]=fn,clients:{matchAll:async()=>[]}};
  const sw2=vm.createContext({self:bare,URL,URLSearchParams});
  sw2.importScripts=(...names)=>names.forEach(name=>vm.runInContext(read(name.split('?')[0]),sw2));vm.runInContext(read('push-sw.js'),sw2);
  bare.push({data:{json:()=>({...data,ticker:'NVDA',name:'가상 반도체',ruleId:'trade:rebuy:r1:cut:0',line:'재매수 손절 1회',body:'NVDA 재매수 손절 1회'})},waitUntil:promise=>task=promise});await task;
  assert.equal(plainShown[0][0],'재매수 알림 · 가상 반도체');assert.equal(plainShown[0][1].body,'재매수 손절 1회');
});

test('알림내역 카드는 코드뿐인 이름을 계획 이름으로 보이고 종류를 메뉴별로 구분하며 저장된 내역은 바꾸지 않는다',()=>{
  const nodes=new Map(),ctx=vm.createContext({state:{plans:plans()},Intl,Date,Set,Map,JSON,URLSearchParams,STORAGE_KEY:'k',save(){},localStorage:{getItem:()=>null,setItem(){}},
    $:name=>{if(!nodes.has(name))nodes.set(name,{classList:{toggle(){}},setAttribute(){}});return nodes.get(name);},$$:()=>[],esc});
  vm.runInContext(`${rebuyItemsSource}\n${read('js/stock-names.js')}\n;${read('js/alert-history-store.js')}\n;${read('js/alert-history.js')}`,ctx);
  const item=(id,extra)=>({eventId:id,ticker:'SPY',name:'SPY',line:'분할매도 2회',ruleId:'trade:plan:titled:1',occurredAt:'2026-10-14T01:02:10Z',condition:'down',...extra});
  ctx.acceptAlertHistory([item('a'),item('b',{ticker:'NVDA',name:'<b>재매수</b>',ruleId:'trade:rebuy:r1:cut:0',line:'재매수 손절 1회',occurredAt:'2026-10-14T01:03:10Z'}),item('c',{ticker:'ZZZ',name:'ZZZ',ruleId:'gone',line:'60일선',occurredAt:'2026-10-14T01:01:10Z'})]);
  const stored=JSON.stringify(ctx.state.alertHistory);ctx.renderAlertHistory();
  const html=nodes.get('alertHistoryList').innerHTML;
  assert.match(html,/<span class="alert-history-type">분할매도<\/span>.*?<span class="alert-history-name">가상 S&amp;P 계획<small>SPY<\/small>/s);
  assert.match(html,/<span class="alert-history-type">재매수 · 손절<\/span>.*?<span class="alert-history-name">&lt;b&gt;재매수&lt;\/b&gt;<small>NVDA<\/small>/s,'발송 이름은 이스케이프해 그대로');
  assert.match(html,/<span class="alert-history-type">이동평균선<\/span>.*?<span class="alert-history-name">ZZZ<span aria-hidden="true">/s,'이름을 못 찾으면 코드만');
  assert.doesNotMatch(html,/<b>재매수/);
  assert.equal(JSON.stringify(ctx.state.alertHistory),stored,'표시만 바꾸고 저장된 이름·종류는 그대로');
  assert.deepEqual(plain(ctx.state.alertHistory.items.map(x=>[x.name,x.type])),[['<b>재매수</b>','손절'],['SPY','분할매도'],['ZZZ','기준선']]);
});

test('제목 꼬리표: 이름 끝 괄호만 나누고 환헤지·합성 표기·중첩·빈 이름은 그대로 둔다',()=>{
  const {names}=page(),parts=name=>plain(names.titleParts(name));
  assert.deepEqual(parts('ACE미국30년국채액티브(연저펀)'),{main:'ACE미국30년국채액티브',tag:'연저펀'});
  assert.deepEqual(parts(' TIGER 미국S&P500(H) (ISA) '),{main:'TIGER 미국S&P500(H)',tag:'ISA'},'앞 괄호는 이름에 남김');
  assert.deepEqual(parts('가상 ETF（ IRP ）'),{main:'가상 ETF',tag:'IRP'},'전각 괄호·안쪽 공백');
  for(const name of ['KODEX 미국채(H)','가상 ETF(합성)','가상 ETF(합성 H)','(연저펀)','가상 ETF()','가상 ETF( )','가상 ETF(1234567890123)','가상 ETF(a(b))','가상 (연저펀) ETF'])
    assert.deepEqual(parts(name),{main:name.trim(),tag:''},name);
  assert.deepEqual(parts(null),{main:'',tag:''});
});
test('분할매도 목록은 카드 이름이 없으면 종목명을 굵게·코드를 아래 줄에 보이고 카드 이름은 바꾸지 않는다',()=>{
  const els={},el=id=>els[id]??={id,value:'',dataset:{},style:{},innerHTML:'',textContent:'',events:{},addEventListener(kind,handler){this.events[kind]=handler;},
    querySelectorAll:()=>[],querySelector:()=>el('inner'),classList:{toggle(){}},close(){},showModal(){this.open=true;},focus(){},select(){},append(){},elements:{}};
  el('nameForm').elements.cardName=el('field:cardName');
  const list=[...plans(),{id:'twin',ticker:'TWIN',title:'가상 S&P 계획',stages:2,checked:[false,false],holdings:[]},{id:'x',ticker:'XSS',title:'<img src=x>',stages:2,checked:[false,false],holdings:[]},{id:'tag',ticker:'TLT',title:'가상 국채 ETF(<b>연저펀)',stages:2,checked:[false,false],holdings:[]}];
  const ctx=vm.createContext({$:el,$$:()=>[],addEventListener(){},save(){},render(){},onEdit(){},document:{createRange:()=>({selectNodeContents(){},getBoundingClientRect:()=>({width:0})}),createElement:()=>({dataset:{},setAttribute(){},append(){},focus(){}})},
    state:{plans:list,futures:{positions:[]},selectedPlan:'auto'},assetStore:{doc:{allocation:{groups:groups()}},subscribe(){}},PENCIL:'',memoCount:()=>'',id:()=>'n',esc,
    won:new Intl.NumberFormat('ko-KR'),decimal:new Intl.NumberFormat('ko-KR'),usd:new Intl.NumberFormat('en-US'),priceText:v=>String(v),fxText:v=>String(v),priceData:null,FormData:class{}});
  for(const f of ['ma-ladder.js','prices.js','assets-calc.js','stock-names.js','item-search.js','rebuy.js','trade-alerts.js','plans.js'])vm.runInContext(read('js/'+f),ctx);
  const before=JSON.stringify(ctx.state);ctx.renderPlans();assert.equal(JSON.stringify(ctx.state),before,'목록을 그려도 기록은 그대로');
  const html=els.planList.innerHTML,card=id=>new RegExp(`<button class="([^"]*)" type="button" data-plan="${id}"[^>]*>(.*?)</button>`).exec(html)?.slice(1).join(' | ')||'';
  assert.match(card('auto'),/^plan-item active \| <span class="plan-row"><strong>가상 미국500 ETF<\/strong><span class="plan-count">0\/3.*<span class="plan-title">360750<\/span>/,'계획 이름이 비면 자산 배분의 종목 이름');
  assert.match(card('titled'),/^plan-item\s+show-code \| <span class="plan-row"><strong>가상 S&amp;P 계획<\/strong><span class="plan-count">.*<span class="plan-title">SPY<\/span>/,'같은 이름의 다른 코드가 있으면 모바일에도 코드 줄');
  assert.match(card('twin'),/^plan-item\s+show-code \|.*<span class="plan-title">TWIN<\/span>/);
  for(const id of ['auto','bare','carded','x'])assert.doesNotMatch(card(id),/show-code/,id);
  assert.match(card('bare'),/<strong>QQQ<\/strong><span class="plan-count">.*<span class="plan-title"><\/span>/,'이름을 못 찾으면 코드만');
  assert.match(card('carded'),/<strong>내 카드<\/strong><span class="plan-count">.*<span class="plan-title">069500<\/span>/,'카드 이름은 그대로');
  assert.match(card('x'),/<strong>&lt;img src=x&gt;<\/strong>/);assert.doesNotMatch(html,/<img/);
  assert.match(els.planMain.innerHTML,/<h1>가상 미국500 ETF<\/h1>/,'제목도 같은 이름');
  ctx.state.selectedPlan='tag';ctx.renderPlans();
  assert.match(els.planMain.innerHTML,/<h1>가상 국채 ETF <span class="title-tag">&lt;b&gt;연저펀<\/span><\/h1>/,'이름 끝 괄호는 이스케이프한 꼬리표로');
  assert.match(card('tag'),/<strong>가상 국채 ETF\(&lt;b&gt;연저펀\)<\/strong>/,'목록 카드는 전체 이름');
  ctx.state.selectedPlan='auto';
  ctx.openNameDialog('auto');assert.equal(els.nameTitle.textContent,'가상 미국500 ETF 카드 이름');assert.equal(els['field:cardName'].placeholder,'가상 미국500 ETF');
  assert.equal(JSON.stringify(ctx.state),before);
});

test('직접 추가한 기준선 알림 카드는 종목명과 코드를 함께, 못 찾으면 코드만 보인다',()=>{
  const ctx=vm.createContext({state:{plans:plans(),alerts:{rules:[{id:'a',ticker:'A069500',period:60,unit:'일선',tolerancePct:0.5},{id:'b',ticker:'ZZZ',period:20,unit:'주선',tolerancePct:1,enabled:false}]}},
    assetStore:{doc:{allocation:{groups:groups()}}},priceData:null,esc,priceText:v=>String(v)});
  vm.runInContext(`${read('js/prices.js')}\n;${rebuyItemsSource}\n${read('js/stock-names.js')}\n;${read('js/alerts.js')}`,ctx);
  const [named,unknown]=ctx.state.alerts.rules.map(rule=>ctx.alertRuleCard(rule));
  assert.match(named,/<strong>가상 코스피 ETF<\/strong><span>A069500 · 60일선 · 허용 ±0.5%<\/span>/);
  assert.match(named,/aria-label="가상 코스피 ETF A069500 60일선 알림 사용"/);
  assert.match(unknown,/<strong>ZZZ<\/strong><span>20주선 · 허용 ±1%<\/span>/);
});
