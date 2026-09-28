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
