const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// js/assets-calc.js를 화면 없이 불러온다(숫자는 모두 테스트용 가짜 값)
// 같은 realm에서 함수 안에 불러 맨 위 이름이 전역으로 새지 않게 한다(deepEqual이 배열·객체를 그대로 비교하도록)
const c = vm.runInThisContext(`(function(){${fs.readFileSync(path.join(__dirname, '../js/assets-calc.js'), 'utf8')}
return {parseAllocationTotal,allocationTotalText,itemValue,fillBases,resetBase,cashValue,allocationTargets,allocationSummary,purchaseSummary,purchaseLadder,purchaseDirection,purchaseAlertRules,purchaseQuoteKind,monthTotals,yearSummary,simulateSavings,savingsStage,cleanAssets,mergeAssets,assetsBlank,ymNum,ymText,missingActual};})()`);
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

test('분할매수 가격 구간: 시작 → 목표 가격을 고르게 나눠 회차마다 같은 금액을 사고(위로 갈수록 수량이 줄어듦), 합계는 매수할 금액을 넘지 않는다', () => {
  // 매수할 금액 600만원, 환율 1,000원 → $6,000, 회차마다 $1,200. $30 → $32 5회(30·30.5·31·31.5·32)
  // 1,200 ÷ 가격으로 내리면 40·39·38·38·37주, 남은 $51.5로 한 주 더 사도 금액이 가장 작은 $31 회차에 1주 → 40·39·39·38·37주
  const r = c.purchaseLadder({budget:600, start:30, end:32, count:5, currency:'USD', fx:1000});
  assert.deepEqual(r.stages.map(s => s.price), [30, 30.5, 31, 31.5, 32]);
  assert.deepEqual(r.stages.map(s => s.shares), [40, 39, 39, 38, 37]);
  assert.deepEqual(r.stages.map(s => s.amount), [120, 118.95, 120.9, 119.7, 118.4], '회차 예정액(만원)은 가격 × 수량 × 환율');
  const dollars = r.stages.map(s => s.price * s.shares);
  assert.ok(Math.max(...dollars) - Math.min(...dollars) <= 32, '회차 금액 차이는 한 주 가격 안쪽');
  assert.equal(r.shares, 193); assert.equal(r.step, 0.5); near(r.cost, 5979.5, '달러 합계');
  assert.ok(r.cost <= r.money, '합계가 매수할 금액 이하');
  near(r.amount, r.cost * 1000 / 1e4, '합계 만원 환산');
  // 하락 분할(원화): 가격은 1원 단위, 아래 회차일수록 수량이 많다
  const d = c.purchaseLadder({budget:100, start:50000, end:40000, count:4});
  assert.deepEqual(d.stages.map(s => [s.price, s.shares]), [[50000,5],[46667,5],[43333,6],[40000,6]]);
  assert.equal(d.step, -3333);
  // 비트코인은 0.00000001 단위라 회차 금액이 거의 같다
  const b = c.purchaseLadder({budget:100, start:100, end:120, count:3, currency:'USD', fx:1000, unit:1e-8});
  assert.deepEqual(b.stages.map(s => s.shares), [3.33333333, 3.03030303, 2.77777778]);
  assert.deepEqual(b.stages.map(s => s.amount), [33.33, 33.33, 33.33]);
  assert.ok(b.cost <= b.money);
  assert.deepEqual(c.purchaseLadder({budget:10, start:1000, end:2000, count:1}).stages, [{price:1000, shares:100, amount:10}], '1회면 시작 가격에서 한 번에');
  assert.equal(c.purchaseLadder({budget:0, start:1, end:2, count:2}).error, 'budget', '목표 이상이면 살 금액 없음');
  assert.equal(c.purchaseLadder({budget:-5, start:1, end:2, count:2}).error, 'budget');
  assert.equal(c.purchaseLadder({budget:10, start:30, end:32, count:5, currency:'USD'}).error, 'fx', '달러인데 환율이 없으면 계산하지 않음');
  assert.equal(c.purchaseLadder({budget:10, start:null, end:32, count:5}).error, 'price');
  assert.equal(c.purchaseLadder({budget:10, start:1, end:2, count:0}).error, 'count');
  assert.equal(c.purchaseLadder({budget:10, start:1, end:2, count:2.5}).error, 'count');
  assert.equal(c.purchaseLadder({budget:10, start:1, end:2, count:51}).error, 'count');
  assert.deepEqual(c.purchaseLadder({budget:1, start:30, end:32, count:5, currency:'USD', fx:1000}), {error:'few', units:0, money:10}, '회차마다 1주도 못 사면 나누지 않음');
  assert.equal(c.purchaseLadder({budget:5, start:30, end:60, count:3, currency:'USD', fx:1000}).error, 'few', '한 회차라도 0주면 나누지 않음');
});

test('분할매수 휴대폰 알림: 켠 미완료 가격 회차만, 방향은 구간(또는 회차 가격 순서), 통화가 종목 시장과 다르면 보내지 않음', () => {
  assert.equal(c.purchaseDirection({ladder:{start:30, end:32}, stages:[{price:40},{price:10}]}), 'up', '구간이 있으면 구간 방향');
  assert.equal(c.purchaseDirection({ladder:{start:32, end:30}}), 'down');
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
