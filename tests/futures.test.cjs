const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const monthOk = '), html.indexOf('    function renderFutures(){'));
if (!source.includes('function applyRatio(')) throw Error('계약 비율 조정 구현을 찾지 못했습니다.');

const load = () => { const context = vm.createContext({futuresDays: [25, 32, 42, 60, 80, 125, 150], contractSize: 10000}); vm.runInContext(source, context); return context; };
const tranche = (completed = false) => ({price: 1400, completed, executionPrice: completed ? 1400 : null});
const level = (days, contracts, done = 0) => ({days, price: 1400, confirmed: true, contracts, tranches: Array.from({length: contracts}, (_, i) => tranche(i < done))});
const counts = f => f.levels.map(l => l.contracts);

test('남는 계약은 앞 구간부터 1개씩 더 준다: 앞 3계약, 뒤 2계약', () => {
  const {spreadContracts} = vm.runInContext('({spreadContracts})', load());
  assert.deepEqual(spreadContracts(17, [0, 0, 0, 0, 0, 0, 0]), [3, 3, 3, 2, 2, 2, 2]);
  assert.deepEqual(spreadContracts(14, [0, 0, 0, 0, 0, 0, 0]), [2, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(spreadContracts(20, [0, 0, 0, 0, 0, 0, 0]), [3, 3, 3, 3, 3, 3, 2]);
});

test('체크한 계약보다 적게 줄 수 없는 구간은 고정하고 나머지를 다시 나눈다', () => {
  const {spreadContracts} = vm.runInContext('({spreadContracts})', load());
  assert.deepEqual(spreadContracts(12, [0, 0, 4, 0, 0]), [2, 2, 4, 2, 2]);
  assert.equal(spreadContracts(3, [2, 2]), null);
  assert.equal(spreadContracts(3, []), null);
});

test('비율 적용: 매수 완료·0계약 구간은 그대로, 총 계약 수는 유지', () => {
  const ctx = load();
  const f = {targetPrice: 1480, baselinePnl: 0, positions: [], levels: [level(25, 2, 2), level(32, 1), level(42, 1), level(60, 0), level(80, 2), level(125, 4), level(150, 4)]};
  assert.equal(ctx.applyRatio(f, 12), true);
  assert.deepEqual(counts(f), [2, 3, 3, 0, 2, 2, 2]);
  assert.ok(f.levels.every(l => l.tranches.length === l.contracts));
});

test('줄여도 체크한 계약은 지우지 않고 뒤쪽 미매수 계약부터 뺀다', () => {
  const ctx = load();
  const l = level(125, 4);
  l.tranches[3] = {...tranche(true), mergedMonth: '202612'};
  l.tranches[1].price = 1390;
  ctx.resizeTranches(l, 2);
  assert.equal(l.contracts, 2);
  assert.deepEqual(l.tranches.map(t => [t.price, t.completed]), [[1400, false], [1400, true]]);
  assert.equal(l.tranches[1].mergedMonth, '202612');
});

test('모든 구간이 0계약이면 완료 안 된 구간 전체에 나눈다', () => {
  const ctx = load();
  const f = {targetPrice: 1480, baselinePnl: 0, positions: [], levels: [25, 32, 42, 60, 80, 125, 150].map(d => level(d, 0))};
  assert.equal(ctx.applyRatio(f, 17), true);
  assert.deepEqual(counts(f), [3, 3, 3, 2, 2, 2, 2]);
  assert.ok(f.levels.every(l => l.tranches.every(t => t.price === 1400 && !t.completed)));
});
