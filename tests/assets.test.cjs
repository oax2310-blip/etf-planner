const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// js/assets-calc.js를 화면 없이 불러온다(숫자는 모두 테스트용 가짜 값)
// 같은 realm에서 함수 안에 불러 맨 위 이름이 전역으로 새지 않게 한다(deepEqual이 배열·객체를 그대로 비교하도록)
const c = vm.runInThisContext(`(function(){${fs.readFileSync(path.join(__dirname, '../js/assets-calc.js'), 'utf8')}
return {itemValue,fillBases,resetBase,cashValue,allocationSummary,monthTotals,yearSummary,simulateSavings,savingsStage,cleanAssets,mergeAssets,assetsBlank,ymNum,ymText};})()`);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const prices = {stocks: {
  '111111': {kind: '국내', asOf: '2026-01-02', close: 10000},
  AAA: {kind: '해외', asOf: '2026-01-02', close: 50},
  'BTC-USD': {kind: '코인', asOf: '2026-01-03', close: 100},
  BAD: {error: true},
}, fx: {close: 1000, asOf: '2026-01-02'}};

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
