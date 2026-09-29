const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const defaultRebuy = '), html.indexOf('    function renderRebuy(){'));
if (!source.includes('function cutPlan(')) throw Error('손절 후 재매수 계산 구현을 찾지 못했습니다.');
const sharesAt = html.match(/const sharesAt = .*;/)[0];

const load = () => { const context = vm.createContext({}); vm.runInContext(`${sharesAt}\n${source}`, context); return context; };
const plan = (ctx, extra) => ({...vm.runInContext('defaultRebuy()', ctx), lowPrice: 10000, shares: 1000, ...extra});
const plain = value => JSON.parse(JSON.stringify(value));

test('손절: 신저점 대비 -1%, -2% …마다 그때 남은 수량의 0.5%를 정수 주로 판다', () => {
  const ctx = load();
  const cuts = ctx.cutPlan(plan(ctx));
  assert.equal(cuts.length, 30, '기본 30회(-30%)까지 표시');
  assert.deepEqual(plain(cuts.slice(0, 3)).map(c => [c.k, c.drop, Math.round(c.price), c.qty, c.left]), [[1, 1, 9900, 5, 995], [2, 2, 9800, 5, 990], [3, 3, 9700, 5, 985]]);
  // 남은 수량 기준이라 누적 잔량은 1000 × 0.995^k를 반올림한 값과 같다
  cuts.forEach(c => assert.equal(c.left, Math.round(1000 * 0.995 ** c.k)));
  assert.ok(cuts.every(c => c.qty <= 5), '회차가 늘수록 파는 수량이 늘지 않는다');
  assert.equal(cuts.at(-1).left, 860);
});

test('손절: 보유 수량이 적어도 정수 주로 나누고 누적 합계가 맞는다', () => {
  const ctx = load();
  const cuts = ctx.cutPlan(plan(ctx, {shares: 100}));
  assert.ok(cuts.every(c => Number.isInteger(c.qty) && c.qty >= 0));
  assert.equal(cuts.reduce((a, c) => a + c.qty, 0), 100 - Math.round(100 * 0.995 ** 30));
});

test('손절: 체크한 회차는 기록한 수량을 쓰고, 다음 회차는 실제 남은 수량으로 다시 계산한다', () => {
  const ctx = load();
  const cuts = ctx.cutPlan(plan(ctx, {cuts: [{shares: 10, price: 9880}]}));
  assert.deepEqual([cuts[0].done, cuts[0].qty, cuts[0].left, cuts[0].execPrice], [true, 10, 990, 9880]);
  assert.equal(cuts[1].qty, 990 - Math.round(990 * 0.995));
  assert.equal(cuts[2].left, Math.round(990 * 0.995 ** 2));
});

test('손절: 표시 회차를 줄여도 체크한 회차는 계속 보이고 합계에 들어간다', () => {
  const ctx = load();
  const r = plan(ctx, {steps: 3, cuts: [null, null, null, null, {shares: 5, price: 9500}]});
  const cuts = ctx.cutPlan(r);
  assert.equal(cuts.length, 5);
  assert.equal(ctx.rebuySummary(r).sold, 5);
});

test('손절: 하락 간격이 커도 손절가가 0원 아래로 내려가지 않게 회차를 줄인다', () => {
  const ctx = load();
  const cuts = ctx.cutPlan(plan(ctx, {stepPct: 5, steps: 60}));
  assert.equal(cuts.length, 19);
  assert.ok(cuts.every(c => c.price > 0));
});

test('재매수: 손절한 수량을 25분봉부터 5단계에 균등 분할한다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 5, price: 9900}, {shares: 5, price: 9800}, {shares: 7, price: 9700}]});
  const s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.stages).map(x => x.name), ['25분봉', '60분봉', '240분봉', '일봉', '주봉']);
  assert.equal(s.sold, 17);
  assert.deepEqual(plain(s.plan), [4, 3, 4, 3, 3]);
  assert.equal(s.plan.reduce((a, b) => a + b, 0), 17);
  assert.equal(s.started, false);
  assert.equal(s.held, 983);
});

test('재매수: 산 단계는 기록 수량을 쓰고 남은 수량을 나머지 단계에 다시 나눈다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 8, execPrice: 9500};
  const s = ctx.rebuySummary(r);
  assert.equal(s.started, true);
  assert.deepEqual(plain(s.plan), [8, 3, 3, 3, 3]);
  assert.equal(s.rest, 12);
  assert.equal(s.held, 1000 - 20 + 8);
  assert.equal(s.sellAvg, 9900);
  assert.equal(s.buyAvg, 9500);
  assert.equal(s.edge, (9900 - 9500) * 8, '손절 평균가보다 싸게 되산 만큼');
});

test('재매수: 체결가를 비운 단계는 평균·차익 계산에서 뺀다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 10, price: 10000}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 5, execPrice: null};
  const s = ctx.rebuySummary(r);
  assert.equal(s.rebought, 5);
  assert.equal(s.buyAvg, null);
  assert.equal(s.edge, null);
});

test('기본값에는 실제 보유 수량·가격을 넣지 않는다', () => {
  const ctx = load();
  const d = plain(vm.runInContext('defaultRebuy()', ctx));
  assert.deepEqual([d.lowPrice, d.shares, d.currentPrice, d.cuts, d.stepPct, d.sellPct], [0, 0, 0, [], 1, 0.5]);
});
