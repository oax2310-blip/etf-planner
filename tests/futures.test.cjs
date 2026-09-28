const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const monthOk = '), html.indexOf('    function renderFutures(){'));
if (!source.includes('function resizeTranches(')) throw Error('계획 계약 수 조정 구현을 찾지 못했습니다.');

const load = () => { const context = vm.createContext({futuresDays: [25, 32, 42, 60, 80, 125, 150], contractSize: 10000}); vm.runInContext(source, context); return context; };
const tranche = (completed = false) => ({price: 1400, completed, executionPrice: completed ? 1400 : null});
const level = (days, contracts) => ({days, price: 1400, confirmed: true, contracts, tranches: Array.from({length: contracts}, () => tranche())});

test('계획 계약 수를 줄여도 체크한 계약은 지우지 않고 뒤쪽 미매수 계약부터 뺀다', () => {
  const ctx = load();
  const l = level(125, 4);
  l.tranches[3] = {...tranche(true), mergedMonth: '202612'};
  l.tranches[1].price = 1390;
  ctx.resizeTranches(l, 2);
  assert.equal(l.contracts, 2);
  assert.deepEqual(l.tranches.map(t => [t.price, t.completed]), [[1400, false], [1400, true]]);
  assert.equal(l.tranches[1].mergedMonth, '202612');
});

test('계획 계약 수를 늘리면 구간 기준가로 미매수 계약을 추가한다', () => {
  const ctx = load();
  const l = level(25, 2);
  l.price = 1420;
  ctx.resizeTranches(l, 3);
  assert.equal(l.contracts, 3);
  assert.deepEqual({...l.tranches[2]}, {price: 1420, completed: false, executionPrice: null});
});

const futures = extra => ({targetPrice: 1480, targetProfit: 0, baselinePnl: 50000, positions: [{month: '202611', contracts: 3, settlementPrice: 1400}], levels: [level(25, 2)], ...extra});

test('월물교체 장기 예상: 스프레드 기본값 -0.5원이면 매달 교체 시 계약당 월 5,000원씩 쌓인다', () => {
  const ctx = load();
  const r = ctx.rollEstimate(futures(), 3);
  assert.equal(r.spread, -0.5);
  assert.equal(r.perContract, 5000);
  assert.deepEqual([...r.years].map(y => [y.years, y.rolls, y.gain]), [[1, 12, 180000], [2, 24, 360000], [3, 36, 540000]]);
});

test('월물교체 장기 예상: 연도별 총 기대수익은 현재 기대수익 + 누적 교체 이득이다', () => {
  const ctx = load();
  const f = futures(), current = ctx.futuresSummary(f).current;
  assert.equal(current, 50000 + 3 * 80 * 10000);
  const r = ctx.rollEstimate(f, 3, current);
  assert.deepEqual([...r.years].map(y => y.total), [current + 180000, current + 360000, current + 540000]);
  assert.equal(ctx.futuresSummary(f).current, current, '표시용 합계가 기대수익 자체를 바꾸지 않는다');
});

test('월물교체 장기 예상: 입력한 스프레드를 쓰고, 비었거나 잘못된 값이면 기본값으로 돌아간다', () => {
  const ctx = load();
  assert.equal(ctx.rollEstimate(futures({rollSpread: -0.3}), 2).years[0].gain, 72000);
  assert.equal(ctx.rollEstimate(futures({rollSpread: 0.4}), 1).years[2].gain, -144000, '스프레드가 양수면 교체 비용');
  for (const bad of [undefined, null, '', 'abc']) assert.equal(ctx.rollEstimate(futures({rollSpread: bad}), 1).spread, -0.5);
  assert.equal(ctx.rollEstimate(futures(), 0).years[2].gain, 0);
});

test('월물교체 장기 예상은 기대수익·계획 체결 가정에 더하지 않는다(이중 계산 방지)', () => {
  const ctx = load();
  const base = JSON.stringify(ctx.futuresSummary(futures()));
  for (const rollSpread of [-0.5, -3, 2]) assert.equal(JSON.stringify(ctx.futuresSummary(futures({rollSpread}))), base);
});
