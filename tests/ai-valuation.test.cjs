const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../valuation.html'), 'utf8');
const start = html.indexOf('  // AI 구독사업 계산:'), end = html.indexOf('  // AI 구독사업 계산 함수 끝.', start);
assert.ok(start >= 0 && end > start, 'AI 계산 함수를 찾을 수 있어야 한다');
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context);
const calculate = vm.runInContext('calculateAiSubscription', context);
const base = {...vm.runInContext('aiBaseInputs', context), aiYear: 2030, aiMultiple: 20, aiRequired: 12};
const near = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('월 1.2만원·1.25억 계정의 부가세와 모든 비용을 제외한 영업이익', () => {
  const r = calculate(base);
  near(r.annualGross, 18e12);
  near(r.annualRevenue, 18e12 / 1.1);
  near(r.annualFees, .4909090909090909e12);
  near(r.annualInference, 6e12);
  near(r.annualOther, 1.5e12);
  near(r.profit, 3.372727272727273e12);
  near(r.margin, .2061111111111111, 1e-12);
});

test('추론 원가와 연구개발 고정비가 흑자 여부를 바꾼다', () => {
  near(calculate({...base, aiInference: 2000}).profit, 6.372727272727273e12);
  near(calculate({...base, aiInference: 7000}).profit, -1.127272727272727e12);
  near(calculate({...base, aiFixed: 10}).profit, -1.627272727272727e12);
});

test('무료 체험·가족 이용자를 결제계정으로 환산하면 매출과 이익도 줄어든다', () => {
  const r = calculate({...base, aiPaidRatio: 80});
  assert.equal(r.accounts, 100e6);
  near(r.annualGross, 14.4e12);
  near(r.profit, 1.698181818181818e12);
});

test('손익분기 계정·추론비 상한·손익분기 요금에서 실제 영업이익이 0이다', () => {
  const r = calculate(base);
  near(r.breakEven, 74647122.6927253, 1e-6);
  near(r.inferenceCap, 6248.484848484848, 1e-9);
  near(calculate({...base, aiReferenceM: r.breakEven / 1e6}).profit, 0);
  near(calculate({...base, aiInference: r.inferenceCap}).profit, 0);
  near(calculate({...base, aiPrice: r.minimumPrice}).profit, 0);
  near(calculate({...base, aiInference: r.margin20Cap}).margin, .2, 1e-12);
});

test('계정당 공헌이익이 음수이면 규모를 키울수록 손실이 커지고 이익 배수를 적용하지 않는다', () => {
  const r = calculate({...base, aiInference: 10000});
  assert.ok(r.contribution < 0);
  assert.equal(r.breakEven, null);
  assert.equal(r.futureValue, null);
  assert.equal(r.presentValue, null);
  assert.ok(calculate({...base, aiInference: 10000, aiReferenceM: 250}).profit < r.profit);
});

test('구독사업 정상 영업가치는 영업이익 배수이며 목표 시점에서 할인한다', () => {
  const r = calculate(base);
  near(r.futureValue, 67.45454545454546e12, .1);
  near(r.presentValue, r.futureValue / (1.12 ** 4), .1);
  near(calculate({...base, aiYear: 2026}).presentValue, r.futureValue, .1);
});
