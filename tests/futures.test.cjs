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

test('환율 도달 시 손익: 기본 1,320원, 기대수익과 같은 계산에 가격만 바꾼다', () => {
  const ctx = load();
  const f = futures();
  const r = ctx.lossCheck(f);
  assert.equal(r.price, 1320);
  assert.equal(r.pnl, 50000 + 3 * (1320 - 1400) * 10000);
  assert.equal(r.pnl, ctx.futuresSummary(f, 1320).current);
  assert.equal(r.held, 3 * (1320 - 1400) * 10000, '보유분 손익은 누적 정산손익을 빼고 계산');
  assert.equal(r.contracts, 3);
  assert.equal(r.avg, 1400);
  assert.equal(r.rate, (1320 - 1400) / 1400, '손실률은 매수금액 대비');
  assert.equal(ctx.futuresSummary(f).current, 50000 + 3 * 80 * 10000, '목표 환율 기대수익은 그대로');
});

test('환율 도달 시 손익: 입력한 환율을 쓰고, 비었거나 0 이하면 1,320원으로 돌아간다', () => {
  const ctx = load();
  assert.equal(ctx.lossCheck(futures({lossPrice: 1350})).held, 3 * -50 * 10000);
  for (const bad of [undefined, null, '', 'abc', 0, -5]) assert.equal(ctx.lossCheck(futures({lossPrice: bad})).price, 1320);
});

test('환율 도달 시 손익: 여러 월물과 월물 밖 매수를 매수금액 가중평균으로 묶는다', () => {
  const ctx = load();
  const l = level(25, 2);
  l.tranches[0] = {price: 1380, completed: true, executionPrice: 1380};
  const f = futures({baselinePnl: 0, positions: [{month: '202611', contracts: 1, settlementPrice: 1400}, {month: '202612', contracts: 2, settlementPrice: 1430}], levels: [l]});
  const r = ctx.lossCheck(f);
  assert.equal(r.contracts, 4);
  assert.equal(r.invested, (1400 + 2 * 1430 + 1380) * 10000);
  assert.equal(r.avg, (1400 + 2 * 1430 + 1380) / 4);
  assert.equal(r.held, ((1320 - 1400) + 2 * (1320 - 1430) + (1320 - 1380)) * 10000);
  assert.ok(Math.abs(r.rate - (1320 - r.avg) / r.avg) < 1e-12);
});

test('환율 도달 시 손익: 월물교체 이득으로 손실이 상쇄되는 비율을 연도별로 계산한다', () => {
  const ctx = load();
  const r = ctx.lossCheck(futures({baselinePnl: 0}));
  const loss = 3 * 80 * 10000;
  assert.deepEqual([...r.years].map(y => y.total), [-loss + 180000, -loss + 360000, -loss + 540000]);
  assert.deepEqual([...r.years].map(y => y.offset), [180000 / loss, 360000 / loss, 540000 / loss]);
  const big = ctx.lossCheck(futures({baselinePnl: 0, lossPrice: 1395}));
  assert.ok(big.years[2].offset >= 1, '교체 이득이 손실보다 크면 1 이상');
  assert.equal(ctx.lossCheck(futures({baselinePnl: 0, lossPrice: 1450})).years[0].offset, null, '손실이 아니면 상쇄 비율 없음');
  assert.equal(ctx.lossCheck(futures({baselinePnl: 0, rollSpread: 0.5})).years[0].offset, null, '교체 비용이면 상쇄 비율 없음');
});

test('보유 계약이 없으면 손실률·평균가 없이 누적 정산손익만 남는다', () => {
  const ctx = load();
  const r = ctx.lossCheck(futures({positions: []}));
  assert.equal(r.contracts, 0);
  assert.equal(r.avg, null);
  assert.equal(r.rate, null);
  assert.equal(r.pnl, 50000);
});
