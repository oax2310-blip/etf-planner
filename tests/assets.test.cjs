const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// js/assets-calc.js를 화면 없이 불러온다(숫자는 모두 테스트용 가짜 값)
// 같은 realm에서 함수 안에 불러 맨 위 이름이 전역으로 새지 않게 한다(deepEqual이 배열·객체를 그대로 비교하도록)
const c = vm.runInThisContext(`(function(){${fs.readFileSync(path.join(__dirname, '../js/ma-ladder.js'), 'utf8')}\n;\n${fs.readFileSync(path.join(__dirname, '../js/assets-calc.js'), 'utf8')}
return {parseAllocationTotal,allocationTotalText,itemValue,fillBases,resetBase,cashValue,allocationTargets,allocationSummary,purchaseSummary,purchaseLineLevels,purchaseLineRows,purchaseFill,purchaseDirection,purchaseAlertRules,purchaseQuoteKind,monthTotals,yearSummary,simulateSavings,savingsStage,cleanAssets,mergeAssets,assetsBlank,ymNum,ymText,missingActual,linkTicker,linkedItems,linkSummary,tradeRows,applyTrade,revertTrade,rescaleTrade};})()`);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const prices = {stocks: {
  '111111': {kind: '국내', asOf: '2026-01-02', close: 10000},
  AAA: {kind: '해외', asOf: '2026-01-02', close: 50},
  'BTC-USD': {kind: '코인', asOf: '2026-01-03', close: 100},
  BAD: {error: true},
}, fx: {close: 1000, asOf: '2026-01-02'}};

test('목표 비중: 종목 수정·이동·삭제가 소분류·그룹·분류·지역 합계에 반영되고 기존 기록은 보존한다', () => {
  const alloc = {classes: [{id:'c',region:'국내',target:80},{id:'cash',region:'현금',target:20,cash:true}],cash:[],
    groups:[{id:'g',classId:'c',target:70,sections:[{name:'배당',target:40}],items:[{id:'a',amount:10,target:3.3,section:'배당'},{id:'b',amount:10,target:6.7,section:'배당'},{id:'z',target:0},{id:'blank'}]},
      {id:'legacy',classId:'c',target:5,items:[]}]};
  const before = JSON.stringify(alloc), t = c.allocationTargets(alloc);
  assert.deepEqual(t.section('g','배당'),{target:10,linked:true});
  assert.deepEqual(t.groups.get('g'),{target:10,linked:true});
  assert.deepEqual(t.classes.get('c'),{target:15,linked:true});
  assert.deepEqual(t.classes.get('cash'),{target:20,linked:false});
  assert.equal(JSON.stringify(alloc),before,'계산만으로 상위 목표나 동기화 기록을 변경하지 않는다');
  alloc.groups[0].items[0].target=4;
  assert.equal(c.allocationSummary(alloc,null).regions.find(r=>r.name==='국내').target,15.7,'종목 목표 수정 연동');
  const moved=alloc.groups[0].items.splice(1,1)[0];delete moved.section;alloc.groups[1].items.push(moved);
  assert.equal(c.allocationTargets(alloc).groups.get('legacy').target,6.7,'그룹 이동은 새 그룹에서 합산');
  alloc.groups[1].items=[];
  assert.equal(c.allocationTargets(alloc).groups.get('legacy').target,5,'하위 목표가 없으면 기존 직접 입력 목표');
  delete alloc.groups[0].items[0].target;
  assert.equal(c.allocationTargets(alloc).section('g','배당').target,40,'소분류도 기존 직접 입력 목표 유지');
  assert.equal(c.allocationTargets({groups:[{id:'zero',target:20,items:[{target:0}]}]}).groups.get('zero').target,0,'0%는 입력된 목표');
});

test('분할매수: 실제 체결 금액과 남은 회차 예정액을 따로 합산하고 완료 해제도 반영한다', () => {
  const plan={stages:[{amount:30,done:true,actual:25},{amount:40,done:true},{amount:50},{amount:10,done:true,actual:0}]};
  assert.deepEqual(c.purchaseSummary(plan),{count:4,done:3,planned:130,actual:65,remaining:50});
  plan.stages[0].done=false;
  assert.deepEqual(c.purchaseSummary(plan),{count:4,done:2,planned:130,actual:40,remaining:80});
  assert.deepEqual(c.purchaseSummary(null),{count:0,done:0,planned:0,actual:0,remaining:0});
  assert.equal(c.purchaseSummary({stages:[{amount:-10},{amount:'bad'},{amount:10,done:true,actual:-1}]}).actual,0,'음수·잘못된 금액은 합계에 더하지 않는다');
});

test('분할매수 이동평균선 돌파: 단계마다 다음 단계까지 3분할, 목표 가격보다 낮은 회차 + 목표가 회차에 같은 금액, 산 금액은 빼고 남은 회차에 다시 나눔', () => {
  // 가짜 이동평균: 25선 100 · 32선 103 · 42선 102(앞보다 낮아 32선은 1차만) · 60선 없음(건너뜀) · 25일선 106 · 32일선 112
  const entry = {kind:'해외', ma:{'25선':100, '32선':103, '42선':102, '25일선':106, '32일선':112}};
  const lines = {names:['25선','32선','42선','60선','25일선','32일선'], end:110, budget:90};
  const levels = c.purchaseLineLevels(lines, entry);
  assert.deepEqual(levels.map(x => x.key), ['25선:0','25선:1','25선:2','32선:0','42선:0','42선:1','42선:2','25일선:0','25일선:1','end']);
  near(levels[1].price, 101, '25선 2차 = 100 + (103 − 100) × ⅓'); near(levels[5].price, 103.333333, '42선 2차는 다음 값 있는 25일선까지');
  assert.ok(levels.every(x => x.key === 'end' || x.price < 110), '목표 가격 이상 회차는 빼고(25일선 3차 110, 32일선 112) 목표가 회차가 마지막');
  assert.deepEqual(levels.at(-1), {key:'end', line:'목표가', t:0, next:null, price:110});
  assert.equal(levels[1].next, '32선'); assert.equal(levels[0].next, null);
  let rows = c.purchaseLineRows({lines}, entry);
  assert.equal(rows.length, 10); near(rows[0].amount, 9, '총 90만원 ÷ 10회');
  const plan = {lines, buys:{'25선:0':{actual:12, price:100}, 'bad':{actual:1}, '25선:9':{actual:1}}};
  rows = c.purchaseLineRows(plan, entry);
  assert.deepEqual(rows.filter(r => r.done).map(r => [r.key, r.actual, r.price]), [['25선:0', 12, 100]], '이상한 키는 무시');
  near(rows.find(r => !r.done).amount, (90 - 12) / 9, '산 금액을 뺀 남은 금액을 남은 회차에');
  assert.deepEqual(c.purchaseSummary(plan, entry), {count:10, done:1, planned:90, actual:12, remaining:78});
  assert.deepEqual(c.purchaseLineRows({lines, buys:{end:{actual:90}}}, entry).map(r => r.key), ['end'], '다 쓰면 남은 회차 없음');
  assert.deepEqual(c.purchaseLineRows({lines}, null).map(r => [r.key, r.price, r.amount]), [['end', 110, 90]], '시세가 없으면 목표가 회차만');
  assert.equal(c.purchaseLineLevels({names:['25선','bad','25분봉'], end:110}, {ma:{'25선':100, bad:1, '25분봉':1}}).length, 2, 'N선·N일선만 받는다');
  assert.equal(c.purchaseLineLevels({end:0}, entry).length, 0);
  assert.equal(c.purchaseLineLevels({end:200}, {ma:{'25선':1}}).length, 2, '단계 이름이 없으면 재매수 기본 14단계');
});

test('분할매수 휴대폰 알림(직접 입력): 켠 미완료 가격 회차만, 방향은 회차 가격 순서, 통화가 종목 시장과 다르면 보내지 않음', () => {
  assert.equal(c.purchaseDirection({lines:{end:30}, stages:[{price:40},{price:10}]}), 'up', '이동평균선 돌파는 상승');
  assert.equal(c.purchaseDirection({stages:[{price:10},{},{price:12}]}), 'up', '직접 넣은 가격이 오르면 상승');
  assert.equal(c.purchaseDirection({stages:[{price:12},{price:10}]}), 'down');
  assert.equal(c.purchaseDirection({stages:[{price:12}]}), 'down', '가격 하나뿐이면 하락(그 가격 이하에서 매수)');
  assert.deepEqual(['069500','A069500','0091C0','SPY','BRK/B','BTC-USD','비트코인',''].map(c.purchaseQuoteKind), ['국내','국내','국내','해외','해외','코인',null,null]);
  const plan = (extra={}) => ({ladder:{start:30, end:32, count:3}, currency:'USD', notify:{stages:true}, stages:[
    {id:'s1', price:30, shares:1, amount:3, done:true}, {id:'s2', price:31, shares:1, amount:3}, {id:'s3', price:32, shares:1, amount:3, notify:false}, {id:'s4'}], ...extra});
  const assets = {allocation:{groups:[{items:[
    {id:'a', name:'비공개 이름', ticker:'aaa', note:'비공개 메모', buyPlan:plan()},
    {id:'b', ticker:'111111', buyPlan:{stages:[{id:'k1', price:10000}], notify:{stages:true}}},
    {id:'c', ticker:'AAA', buyPlan:plan({currency:undefined})},  // 시세도 계획 통화도 없으면 원화 → 미국 종목과 달라 제외
    {id:'d', buyPlan:plan()},  // 종목 코드 없음
    {id:'e', ticker:'BBB', buyPlan:plan({notify:undefined})},  // 켠 회차 없음
  ]}]}};
  const rules = c.purchaseAlertRules(assets, null);
  assert.deepEqual(rules, [
    {id:'trade:buy:a:s2', kind:'trade', ticker:'AAA', label:'분할매수 2차', targetPrice:31, condition:'up', quoteGroup:'stocks', quoteKey:'AAA', quoteKind:'해외', enabled:true, revision:'[31,"up"]'},
    {id:'trade:buy:b:k1', kind:'trade', ticker:'111111', label:'분할매수 1차', targetPrice:10000, condition:'down', quoteGroup:'stocks', quoteKey:'111111', quoteKind:'국내', enabled:true, revision:'[10000,"down"]'},
  ], '완료·OFF·가격 없는 회차는 빼고 이름·메모는 넣지 않는다');
  assert.equal(c.purchaseAlertRules(assets, prices).length, 3, '시세가 있으면 그 통화(AAA는 달러) — 계획 c도 포함');
  assert.deepEqual(c.purchaseAlertRules({allocation:{groups:[{items:[{id:'x', ticker:'111111', buyPlan:{currency:'USD', notify:{stages:true}, stages:[{id:'s', price:1}]}}]}]}}, null), [], '달러 계획인데 국내 종목 코드면 제외');
  assert.deepEqual(c.purchaseAlertRules(null, null), []);
  assert.deepEqual(c.purchaseAlertRules({allocation:{groups:'bad'}}, null), []);
});

test('분할매수 체결 기본값: 8.9주 예산은 표시 가격으로 8주만 사고 실제 수량의 금액을 저장한다', () => {
  assert.deepEqual(c.purchaseFill({amount:8.9,price:10000},'KRW',null),{shares:8,price:10000,actual:8});
  assert.deepEqual(c.purchaseFill({amount:8.9,price:10},'USD',1000),{shares:8,price:10,actual:8});
  assert.deepEqual(c.purchaseFill({amount:0.8008,price:1000.6},'KRW',null),{shares:8,price:1001,actual:0.8008},'표시 원화 가격으로 계산해 반올림 경계에서도 수량·금액 일치');
  assert.deepEqual(c.purchaseFill({amount:8.8044,price:10.004},'USD',1000),{shares:8,price:10,actual:8},'표시 달러 가격 소수 둘째 자리 사용');
  assert.deepEqual(c.purchaseFill({amount:0.9,price:10000},'KRW',null),{shares:0,price:10000,actual:0},'예산을 초과하는 1주를 만들지 않음');
  assert.equal(c.purchaseFill({amount:10,price:10},'USD',null),null,'달러 환율이 없으면 수량을 추정하지 않음');
  assert.equal(c.purchaseFill({amount:10,price:0},'KRW',null),null);
  const btc=c.purchaseFill({amount:0.1234567891,price:100},'USD',1000,1e-8);
  assert.equal(btc.shares,0.01234567,'BTC도 예산 안에서 최소 단위로 내림');
  assert.ok(btc.actual<=0.1234567891);
  const plan={lines:{names:['25선'],end:10000,budget:8.9},buys:{end:c.purchaseFill({amount:8.9,price:10000},'KRW',null)}};
  assert.equal(c.purchaseLineRows(plan,null).find(r=>r.done).shares,8,'완료 회차의 저장한 수량을 보존');
  near(c.purchaseSummary(plan).remaining,0.9,'쓰지 않은 예산은 체결 금액에 포함하지 않음');
});

test('분할매수 휴대폰 알림(이동평균선 돌파): 지금 이동평균 회차 가격으로 상승 알림, 이력은 단계 이름·회차로 이어지고 산 회차·OFF는 빠진다', () => {
  const assets = {allocation:{groups:[{items:[{id:'a', ticker:'AAA', name:'비공개', buyPlan:{currency:'USD', lines:{names:['25선','32선'], end:110, budget:40},
    buys:{'25선:0':{actual:10, price:100}}, notify:{stages:true, keys:{'25선:2':false}}}}]}]}};
  const doc = {stocks:{AAA:{kind:'해외', asOf:'2026-01-02', close:99, ma:{'25선':100, '32선':103}}}};
  const rules = c.purchaseAlertRules(assets, doc);
  assert.deepEqual(rules.map(r => [r.id, r.label, r.condition, r.revision]), [
    ['trade:buy:a:25선:1', '분할매수 25선 2차', 'up', '["25선",1,"32선"]'],
    ['trade:buy:a:32선:0', '분할매수 32선 1차', 'up', '["32선",0,null]'],
    ['trade:buy:a:end', '분할매수 목표가', 'up', '["end",110]'],
  ]);
  near(rules[0].targetPrice, 101, '25선 2차 가격');
  const moved = JSON.parse(JSON.stringify(doc));moved.stocks.AAA.ma['25선'] = 101;
  assert.equal(c.purchaseAlertRules(assets, moved)[0].revision, rules[0].revision, '이평선이 움직여도 같은 이력');
  doc.stocks.AAA.kind = '국내';
  assert.deepEqual(c.purchaseAlertRules(assets, doc).map(r => r.id), ['trade:buy:a:end'], '시세 종류가 다르면 이동평균을 쓰지 않음(목표가 회차만)');
});

test('분할매수 계획은 JSON 복원과 기기 간 병합에서 체결 기록을 보존하고 보유량·조정 기록과 독립적이다', () => {
  const base={version:1,allocation:{savedAt:'2026-01-01',classes:[{id:'c',region:'국내'}],cash:[],groups:[{id:'g',classId:'c',items:[{id:'a',amount:100,target:10,done:true,buyPlan:{stages:[{id:'s',amount:30}],note:'예시 계획'}}]}]}};
  const remote=JSON.parse(JSON.stringify(base));remote.allocation.savedAt='2026-01-02';
  const item=remote.allocation.groups[0].items[0];item.buyPlan.stages[0].done=true;item.buyPlan.stages[0].actual=25;
  const restored=c.cleanAssets(JSON.parse(JSON.stringify(remote))),merged=c.mergeAssets(base,restored,base);
  assert.deepEqual(merged.doc,remote,'완료·실제 금액·메모가 복원·구역 병합에서 유지된다');
  assert.equal(merged.doc.allocation.groups[0].items[0].done,true,'종목 비중 조정 완료는 별도 기록');
  assert.equal(c.allocationSummary(merged.doc.allocation,null).invest,c.allocationSummary(base.allocation,null).invest,'매수 완료 체크는 평가액에 반영하지 않는다');
  assert.equal(c.allocationTargets(merged.doc.allocation).classes.get('c').target,10,'목표도 그대로 유지한다');
});

test('기준 총자산: 억·만원 입력을 기존 만원 숫자로 저장하고 소수 금액도 유지한다', () => {
  for (const [text, amount] of [['13567.89', 13567.89], ['13,567.89만원', 13567.89], ['1억 3,567.89만원', 13567.89], ['1.5억원', 15000], ['1억', 10000], ['350만', 350], ['1억5000원', 10000.5], ['5000원', 0.5]])
    assert.equal(c.parseAllocationTotal(text), amount, text);
  assert.equal(c.parseAllocationTotal('  '), null, '비우면 합계 기준');
  for (const text of ['-1', 'abc', '1억 잘못입력', '1억5000', 'NaN', 'Infinity', '만원'])
    assert.ok(Number.isNaN(c.parseAllocationTotal(text)), `${text}: 잘못된 입력을 빈칸으로 처리해 기준을 지우지 않음`);
  assert.equal(c.allocationTotalText(13567.89), '1억 3,567.89만원');
  assert.equal(c.allocationTotalText(10000), '1억원');
  assert.equal(c.allocationTotalText(350.5), '350.5만원');
  assert.equal(c.allocationTotalText(null), '');
  for (const amount of [0, 0.000005, 9999.9999, 10000, 10000.0001, 13567.89, 1000000.123456])
    assert.equal(c.parseAllocationTotal(c.allocationTotalText(amount)), amount, `${amount}: 표시를 다시 입력해도 금액 유지`);
});

test('종목 평가액: 수량 × 현재가(달러는 × 환율) → 금액 × 시세 변동 → 넣은 금액', () => {
  near(c.itemValue({shares: 30, ticker: '111111'}, prices, 1000).value, 30, '국내 30주 × 1만원 = 30만원');
  const usd = c.itemValue({shares: 4, ticker: 'aaa'}, prices, 1000);
  near(usd.value, 20, '달러 4주 × $50 × 1,000원 = 20만원'); assert.equal(usd.how, 'shares');
  const ratio = c.itemValue({amount: 100, ticker: 'AAA', base: 40000}, prices, 1000);
  near(ratio.value, 125, '넣을 때 원화 4만원 → 지금 5만원이면 100만원 × 1.25'); assert.equal(ratio.how, 'ratio');
  assert.deepEqual({...c.itemValue({amount: 70, ticker: 'BAD'}, prices, 1000), q: null}, {value: 70, how: 'amount', q: null});
  assert.equal(c.itemValue({amount: 70, ticker: 'AAA'}, prices, null).how, 'amount', '환율이 없으면 달러 시세로 환산하지 않음');
  assert.equal(c.itemValue({amount: 70}, prices, 1000).value, 70);
});

test('금액만 넣은 종목의 기준 가격은 한 번만 정하고, 금액을 고치면 다시 잡는다', () => {
  const alloc = {groups: [{items: [{id: 'a', amount: 100, ticker: 'AAA'}, {id: 'b', amount: 50, ticker: '111111', shares: 3}, {id: 'c', amount: 0, ticker: 'AAA'}, {id: 'd', amount: 10, ticker: 'NONE'}]}]};
  assert.equal(c.fillBases(alloc, prices), true);
  const [a, b, z, d] = alloc.groups[0].items;
  assert.equal(a.base, 50000); assert.equal(a.baseAt, '2026-01-02');
  assert.equal(b.base, undefined, '수량이 있으면 기준 가격이 필요 없음'); assert.equal(z.base, undefined, '금액 0은 제외'); assert.equal(d.base, undefined, '시세 없으면 비움');
  assert.equal(c.fillBases(alloc, prices), false, '이미 정했으면 바꾸지 않음');
  const later = {...prices, stocks: {...prices.stocks, AAA: {kind: '해외', asOf: '2026-01-05', close: 60}}};
  a.amount = 120; c.resetBase(a, later, {});
  assert.equal(a.base, 60000); assert.equal(a.baseAt, '2026-01-05');
  c.resetBase(d, later, {}); assert.equal('base' in d, false);
});

test('자산 배분 합계: 그룹·분류·지역, 현금 분류, 빼는 현금, 기준 총자산', () => {
  const alloc = {total: null, cashFx: 1300,
    classes: [{id: 'k1', region: '국내', name: '주식', target: 10}, {id: 'u1', region: '미국', name: '주식', target: 20}, {id: 'u2', region: '미국', name: '채권'}, {id: 'cash', region: '현금', name: '현금', cash: true, target: 5}, {id: 'x', region: '새 지역', name: '기타'}],
    groups: [{id: 'g1', classId: 'u1', items: [{id: 'i1', amount: 100, section: '일반'}, {id: 'i2', shares: 2, ticker: 'AAA', amount: 1, section: '일반'}, {id: 'i3', amount: 30, section: '커버드콜'}]},
      {id: 'g2', classId: 'k1', items: [{id: 'i4', amount: 40}]}, {id: 'g3', classId: 'x', items: []}],
    cash: [{amount: 1000000, currency: 'KRW'}, {amount: 100, currency: 'USD'}, {amount: 200000, currency: 'KRW', minus: true}]};
  const s = c.allocationSummary(alloc, prices);
  near(s.fx, 1000, '시세 환율이 직접 넣은 환율보다 우선');
  near(s.groups.get('g1'), 140, 'g1 = 100 + 2주×$50×1000/1만 + 30');
  near(s.section('g1', '일반'), 110, '소분류 합'); near(s.section('g1', '없음'), 0, '없는 소분류');
  near(s.cash, 90, '현금 = 100만 + $100×1000 − 20만 = 90만원');
  near(s.classes.get('cash'), 90, '현금 분류에 현금 합계');
  near(s.invest, 180, '종목 합'); near(s.grand, 270, '종목 + 현금'); near(s.base, 270, '기준 총자산이 없으면 합계');
  assert.deepEqual(s.regions.map(r => r.name), ['미국', '국내', '현금', '새 지역'], '정한 지역 순서 뒤에 새 지역');
  const us = s.regions[0]; near(us.value, 140, '미국'); assert.equal(us.target, 20, '목표 없는 분류는 0으로 더함');
  assert.equal(s.regions[3].target, null, '목표가 하나도 없으면 null');
  near(s.pct(27), 10, '비중');
  near(c.allocationSummary({...alloc, total: 540}, prices).pct(27), 5, '기준 총자산을 넣으면 그 값 기준');
  near(c.allocationSummary({...alloc}, null).cash, (1000000 + 130000 - 200000) / 1e4, '시세가 없으면 직접 넣은 환율');
});

test('월별 손익: 계좌 합계·대출 제외, 월 수익률 합, 선물옵션은 마지막 달 총자산으로, 연환산', () => {
  const year = {accounts: [{name: 'A'}, {name: '대출', loan: true}, {name: 'B'}], futures: -1000,
    months: [{m: 2, pnl: 2000, balances: [100000, 50000]}, {m: 1, total: 100000}, {m: 3, pnl: 1000, interest: -50, balances: [150000, null, 50000]}, {m: 4, balances: [200000]}]};
  assert.deepEqual(c.monthTotals(year, year.months[0]), {total: 150000, noLoan: 100000});
  assert.deepEqual(c.monthTotals(year, year.months[1]), {total: 100000, noLoan: null}, '계좌가 없으면 직접 넣은 총자산');
  assert.deepEqual(c.monthTotals({accounts: [{name: 'A'}]}, {m: 1, balances: [10]}), {total: 10, noLoan: null}, '대출 계좌가 없으면 대출 제외 없음');
  const y = c.yearSummary(year);
  assert.equal(y.pnl, 2000, '실현손익 3,000 + 선물옵션 −1,000'); assert.equal(y.monthPnl, 3000); assert.equal(y.months, 2);
  near(y.rate, 2000 / 150000 * 100 + 1000 / 200000 * 100 - 1000 / 200000 * 100, '월 수익률 합 + 선물옵션 ÷ 마지막 달(4월) 총자산');
  near(y.annual, (2000 / 150000 + 1000 / 200000) * 100 * 12 / 2, '연환산은 실현손익을 넣은 달 수로');
  assert.equal(y.interest, -50); assert.deepEqual(y.last, {m: 4, total: 200000, noLoan: 200000});
  near(y.rateNoLoan, 2000 / 100000 * 100 + 1000 / 200000 * 100 - 1000 / 200000 * 100, '대출 제외: 대출 계좌를 뺀 총자산으로 같은 방식');
  assert.equal(c.yearSummary({accounts: [{name: 'A'}], months: [{m: 1, pnl: 1, balances: [10]}]}).rateNoLoan, null, '대출 계좌가 없는 해는 null');
  assert.equal(c.yearSummary({accounts: [], months: []}).annual, null);
});

test('저축 계획: 매달 월급 − 기부 − 사용금액 − 할부, 12월에 전년 12월 × 수익률(기부 뺌), 나이별 단계', () => {
  const sv = {startYear: 2020, startAge: 30, actual: [{ym: '2020-12', total: 1000}, {ym: '2021-10', total: 2000}]};
  const sc = {salary: 100, giving: 10, spending: 20, spendingYear: 2021, growth: 10, returnRate: 10, endAge: 33,
    stages: [{age: 32, salary: 50, returnRate: 20}, {age: 33, spending: 5}],
    events: [{name: '할부', start: '2021-12', down: 7, monthly: 3, months: 2}]};
  const r = c.simulateSavings(sv, sc);
  assert.deepEqual(r.last, {ym: '2021-10', total: 2000});
  // 2021: 11월 2000 + 100 − 10 − 20 = 2070, 12월 + 70 − 10(선수금 7 + 할부 3) + 1000 × 10% × 0.9 = 2220
  const y21 = r.rows.find(x => x.year === 2021);
  near(y21.end, 2220, '2021년 말'); near(y21.payments, 10, '2021 할부'); near(y21.returns, 90, '기부 뺀 수익'); assert.equal(y21.actual, false);
  // 2022(32세): 월급 50, 사용금액 20 × 1.1 = 22, 1월 할부 3, 12월 수익 = 2220 × 20% × 0.9
  const y22 = r.rows.find(x => x.year === 2022);
  near(y22.end, 2220 + 12 * (50 - 5 - 22) - 3 + 2220 * 0.2 * 0.9, '2022년 말');
  // 2023(33세): 사용금액 5로 재설정
  const y23 = r.rows.find(x => x.year === 2023);
  near(y23.end, y22.end + 12 * (50 - 5 - 5) + y22.end * 0.2 * 0.9, '2023년 말');
  assert.equal(r.rows[r.rows.length - 1].year, 2023, '종료 나이 해까지');
  assert.equal(r.rows[0].year, 2020); assert.equal(r.rows[0].actual, true); assert.equal(r.rows[0].end, 1000);
  assert.equal(r.at(33), y23.end); assert.equal(r.at(99), null);
  assert.deepEqual(c.savingsStage(sc, 32), {salary: 50, growth: 10, returnRate: 20});
  assert.equal(c.simulateSavings({...sv, actual: []}, sc), null, '실제 기록이 없으면 계산하지 않음');
  assert.equal(c.ymText(c.ymNum('2026-12') + 1), '2027-01'); assert.equal(c.ymNum('2026-13'), null);
  assert.deepEqual(c.missingActual({actual: [{ym: '2026-03', total: 1}, {ym: '2025-12', total: 1}, {ym: '2026-02', total: null}]}), ['2026-01', '2026-02'], '첫 달~마지막 달 사이 빈 달');
  assert.deepEqual(c.missingActual({actual: []}), []);
});

test('기기 간 병합: 구역마다 바뀐 쪽, 둘 다 바뀌면 나중 저장 우선 + 버린 쪽 보관', () => {
  const base = {version: 1, allocation: {savedAt: 'T1', total: 1}, ledger: {savedAt: 'T1', years: []}};
  const local = {version: 1, allocation: {savedAt: 'T3', total: 2}, ledger: {savedAt: 'T1', years: []}, savings: {savedAt: 'T2', actual: [], scenarios: []}};
  const remote = {version: 1, allocation: {savedAt: 'T2', total: 3}, ledger: {savedAt: 'T4', years: [{year: 2026}]}};
  const {doc, lost} = c.mergeAssets(local, remote, base);
  assert.equal(doc.allocation.total, 2, '둘 다 바뀜 → savedAt 늦은 이 기기');
  assert.deepEqual(lost, [{section: 'allocation', data: remote.allocation}]);
  assert.equal(doc.ledger.savedAt, 'T4', '저장소만 바뀜 → 저장소'); assert.equal(doc.savings.savedAt, 'T2', '이 기기에만 있음 → 이 기기');
  assert.deepEqual(c.mergeAssets({version: 1}, remote, null).doc, remote, '빈 기기는 저장소를 그대로');
  assert.deepEqual(c.mergeAssets(local, {version: 1, allocation: {...base.allocation}}, base).doc.allocation, local.allocation, '이 기기만 바뀜');
  assert.equal(c.cleanAssets({version: 2}), null); assert.equal(c.cleanAssets([]), null);
  assert.deepEqual(c.cleanAssets({allocation: {}}).allocation, {classes: [], groups: [], cash: []});
  assert.equal(c.assetsBlank({version: 1}), true); assert.equal(c.assetsBlank(local), false);
});

// ---------- 플래너 체결 → 자산 배분 연동 ----------
// 시세 파일 키는 적힌 그대로(A 접두 포함)라 테스트 시세에도 둘 다 둔다
const lp = {...prices, stocks: {...prices.stocks, A111111: {kind: '국내', asOf: '2026-01-02', close: 10000}}};
const linkAlloc = () => ({cash: [], total: 1000, classes: [], groups: [
  {id: 'g1', target: 2, items: [{id: 'a', ticker: 'A111111', shares: 10, amount: 0}, {id: 'b', ticker: '111111', shares: 5, amount: 0}]},
  {id: 'g2', items: [{id: 'c', ticker: 'aaa', amount: 100, base: 40000}, {id: 'd', ticker: 'AAA', amount: 50, target: 1}, {id: 'e', ticker: 'BTC-USD', shares: 0.5, amount: 0}, {id: 'n', name: '코드 없음', amount: 30}]},
]});
const byId = (alloc, id) => alloc.groups.flatMap(g => g.items).find(it => it.id === id);

test('체결 연동: 같은 종목 코드 계좌(대소문자·국내 A 접두·비트코인)와 합계·목표·수량 합', () => {
  const alloc = linkAlloc();
  assert.equal(c.linkTicker(' a111111 '), '111111');
  assert.equal(c.linkTicker('비트코인'), 'BTC-USD');
  assert.deepEqual(c.linkedItems(alloc, '111111').map(x => x.it.id), ['a', 'b']);
  assert.deepEqual(c.linkedItems(alloc, 'AAA').map(x => x.it.id), ['c', 'd']);
  assert.deepEqual(c.linkedItems(alloc, '비트코인').map(x => x.it.id), ['e']);
  assert.deepEqual(c.linkedItems(alloc, '', 'n').map(x => x.it.id), ['n'], '분할매수 계획이 붙은 종목은 코드가 없어도 연결');
  assert.deepEqual(c.linkedItems(alloc, 'ZZZ'), []);
  const kr = c.linkSummary(alloc, lp, 'A111111');
  near(kr.value, 15, '10주 + 5주 × 1만원'); assert.equal(kr.shares, 15);
  assert.deepEqual([kr.target, kr.scope], [2, 'group'], '종목 목표가 없고 그룹 종목이 모두 연결되면 그룹 목표');
  near(kr.gap, 5, '목표 2% × 1,000만원 − 15만원'); near(kr.pct, 1.5, '기준 총자산 대비');
  const us = c.linkSummary(alloc, lp, 'AAA');
  near(us.value, 175, '125(시세 따라감) + 50'); assert.deepEqual([us.target, us.scope, us.shares], [1, 'item', null], '종목 목표 합, 금액 종목이 있으면 수량 합 없음');
  assert.equal(c.linkSummary(alloc, lp, 'ZZZ'), null);
});

test('체결 연동: 계좌마다 단위(수량·금액)와 미리 채울 양', () => {
  const alloc = linkAlloc();
  assert.deepEqual(c.tradeRows(alloc, lp, '111111', {sign: -1, qty: 3, price: 9000, currency: 'KRW'}).map(r => [r.it.id, r.unit, r.n]), [['a', 'shares', 3], ['b', 'shares', 3]]);
  assert.deepEqual(c.tradeRows(alloc, lp, 'AAA', {sign: -1, qty: 2, price: 60, currency: 'USD'}).map(r => [r.it.id, r.unit, r.n]), [['c', 'amount', 12], ['d', 'amount', 12]], '2주 × $60 × 1,000원 = 12만원');
  assert.deepEqual(c.tradeRows(alloc, lp, '111111', {sign: -1, value: 20, currency: 'KRW'}).map(r => r.n), [20, 20], '금액만 아는 매도는 지금 시세로 수량 환산');
  assert.deepEqual(c.tradeRows(alloc, lp, 'BTC-USD', {sign: -1, qty: 0.1234567891, price: 100, currency: 'USD'})[0].n, 0.12345679, '비트코인은 0.00000001 단위');
  alloc.groups[0].items.push({id: 'z', ticker: '111111', amount: 0});
  assert.equal(c.tradeRows(alloc, lp, '111111', {sign: 1, qty: 4, price: 10000, currency: 'KRW'})[2].unit, 'shares', '빈 종목은 체결 수량을 알면 수량');
  assert.equal(c.tradeRows(alloc, lp, '111111', {sign: 1, value: 4, price: 10000, currency: 'KRW'})[2].unit, 'amount', '금액만 알면 금액');
});

test('체결 연동: 반영하면 보유 수량·금액을 바꾸고 기록하며, 되돌리면 정확히 원래 값으로', () => {
  const alloc = linkAlloc(), before = JSON.stringify(alloc);
  const sell = c.applyTrade(alloc, lp, 'sell:p:0', {sign: -1, qty: 3, price: 9000, currency: 'KRW'}, '테스트 1회 매도', [{id: 'a', unit: 'shares', n: 3}, {id: 'c', unit: 'amount', n: 12.5}, {id: 'gone', unit: 'shares', n: 1}]);
  assert.equal(byId(alloc, 'a').shares, 7);
  near(byId(alloc, 'c').amount, 90, '지금 평가액 12.5만원 = 입력 금액 10만원(기준 가격 4만원 → 5만원)'); assert.equal(byId(alloc, 'c').base, 40000, '기준 가격은 그대로');
  assert.deepEqual(sell.items, [{id: 'a', shares: -3}, {id: 'c', amount: -10}], '없는 종목은 건너뜀');
  assert.deepEqual([sell.label, sell.qty, sell.price, sell.value], ['테스트 1회 매도', 3, 9000, null]);
  assert.equal(alloc.trades['sell:p:0'], sell);
  c.applyTrade(alloc, lp, 'sell:p:0', {sign: -1, qty: 2, price: 9000, currency: 'KRW'}, '테스트 1회 매도', [{id: 'b', unit: 'shares', n: 2}]);
  assert.deepEqual([byId(alloc, 'a').shares, byId(alloc, 'b').shares, byId(alloc, 'c').amount], [10, 3, 100], '같은 키를 다시 반영하면 먼저 되돌린다');
  assert.ok(c.revertTrade(alloc, 'sell:p:0'));
  assert.equal(JSON.stringify(alloc), before, '되돌리면 원래 기록 그대로(trades도 지움)');
  assert.equal(c.revertTrade(alloc, 'sell:p:0'), null);
});

test('체결 연동: 0 아래로 내려가지 않고, 다 판 종목은 수량 0(평가액 0), 새로 만든 수량 칸은 되돌리면 지운다', () => {
  const alloc = linkAlloc();
  const rec = c.applyTrade(alloc, lp, 'cut:r:0', {sign: -1, qty: 8, currency: 'KRW'}, '손절', [{id: 'b', unit: 'shares', n: 8}]);
  assert.deepEqual(rec.items, [{id: 'b', shares: -5}], '실제로 뺀 양만 기록');
  assert.equal(byId(alloc, 'b').shares, 0);
  assert.deepEqual(c.itemValue({...byId(alloc, 'b'), amount: 30}, lp, 1000).value, 0, '수량 0은 금액 칸으로 돌아가지 않고 0');
  c.revertTrade(alloc, 'cut:r:0'); assert.equal(byId(alloc, 'b').shares, 5);
  alloc.groups[0].items.push({id: 'z', ticker: '111111', amount: 0});
  const buy = c.applyTrade(alloc, lp, 'rebuy:r:25선:0', {sign: 1, qty: 4, price: 10000, currency: 'KRW'}, '재매수', [{id: 'z', unit: 'shares', n: 4}]);
  assert.deepEqual([byId(alloc, 'z').shares, buy.items[0].fresh], [4, true]);
  c.revertTrade(alloc, 'rebuy:r:25선:0'); assert.equal('shares' in byId(alloc, 'z'), false);
  alloc.groups[1].items.push({id: 'y', ticker: 'AAA', amount: 0});
  c.applyTrade(alloc, lp, 'buy:y:end', {sign: 1, price: 50, currency: 'USD', value: 20}, '분할매수 목표가', [{id: 'y', unit: 'amount', n: 20}]);
  assert.deepEqual([byId(alloc, 'y').amount, byId(alloc, 'y').base], [20, 50000], '금액 0에서 사면 기준 가격을 지금 시세로');
  assert.equal(c.applyTrade(alloc, lp, 'sell:p:1', {sign: -1, qty: 1, currency: 'KRW'}, '없음', [{id: 'a', unit: 'shares', n: 0}]), null, '반영할 양이 없으면 기록하지 않음');
});

test('체결 연동: 체크 뒤 체결 수량·가격·금액을 고치면 반영한 양을 같은 비율로', () => {
  const alloc = linkAlloc();
  c.applyTrade(alloc, lp, 'cut:r:0', {sign: -1, qty: 4, price: 10000, currency: 'KRW'}, '손절', [{id: 'a', unit: 'shares', n: 4}, {id: 'c', unit: 'amount', n: 5}]);
  near(byId(alloc, 'c').amount, 96, '5만원 × 0.8');
  assert.ok(c.rescaleTrade(alloc, 'cut:r:0', {qty: 3, price: 10000}));
  assert.equal(byId(alloc, 'a').shares, 7, '4주 → 3주'); near(byId(alloc, 'c').amount, 97, '금액도 3/4');
  assert.ok(c.rescaleTrade(alloc, 'cut:r:0', {qty: 3, price: 20000}));
  assert.equal(byId(alloc, 'a').shares, 7, '가격만 바꾸면 수량 그대로'); near(byId(alloc, 'c').amount, 94, '금액은 두 배');
  assert.equal(c.rescaleTrade(alloc, 'cut:r:0', {qty: 0, price: null}), null, '0·빈 값이면 바꾸지 않음');
  c.revertTrade(alloc, 'cut:r:0');
  assert.deepEqual([byId(alloc, 'a').shares, byId(alloc, 'c').amount], [10, 100]);
  c.applyTrade(alloc, lp, 'buy:d:k', {sign: 1, price: 50, currency: 'USD', value: 10}, '분할매수', [{id: 'd', unit: 'amount', n: 10}, {id: 'b', unit: 'shares', n: 2}]);
  c.rescaleTrade(alloc, 'buy:d:k', {price: 50, value: 15});
  assert.deepEqual([byId(alloc, 'd').amount, byId(alloc, 'b').shares], [65, 8], '체결 금액 1.5배 → 금액·수량(2주 → 3주) 모두');
});
