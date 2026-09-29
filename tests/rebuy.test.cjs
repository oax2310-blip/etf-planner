const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    const defaultRebuy = '), html.indexOf('    function renderRebuy(){'));
if (!source.includes('function cutPlan(')) throw Error('손절 후 재매수 계산 구현을 찾지 못했습니다.');
const sharesAt = html.match(/const sharesAt = .*;/)[0];

const load = () => { const context = vm.createContext({}); vm.runInContext(`${sharesAt}\n${source}`, context); return context; };
const plan = (ctx, extra) => ({...vm.runInContext('defaultRebuy()', ctx), lowPrice: 10000, amount: 1000, ...extra});
const plain = value => JSON.parse(JSON.stringify(value));
const hold = (ctx, r) => { ctx.target = r; return vm.runInContext('holdShares(target)', ctx); };

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
  const cuts = ctx.cutPlan(plan(ctx, {amount: 100}));
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

test('재매수: 손절한 금액을 25분봉부터 5단계에 똑같이 나눈다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 5, price: 9900}, {shares: 5, price: 9800}, {shares: 7, price: 9700}]});
  const s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.stages).map(x => x.name), ['25분봉', '60분봉', '240분봉', '일봉', '주봉']);
  assert.equal(s.sold, 17);
  assert.equal(s.sellValue, 49500 + 49000 + 67900);
  assert.deepEqual(plain(s.plan), Array(5).fill(166400 / 5));
  assert.equal(s.started, false);
  assert.equal(s.held, 983);
  assert.deepEqual(plain(s.lots).map(l => [l.k, l.price, l.amount]), [[3, 9700, 67900], [2, 9800, 49000], [1, 9900, 49500]], '기한이 가까운(낮은 손절가) 분량부터');
});

test('재매수: 산 금액은 손절가가 낮은 분량부터 채우고 남은 금액을 나머지 단계에 다시 나눈다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 8, execPrice: 9500};
  const s = ctx.rebuySummary(r);
  assert.equal(s.started, true);
  assert.equal(s.buyValue, 76000);
  assert.deepEqual(plain(s.lots).map(l => [l.price, l.covered, l.left, l.open]), [[9800, 76000, 22000, true], [10000, 0, 100000, true]]);
  assert.equal(s.rest, 122000);
  assert.deepEqual(plain(s.plan), [76000, 30500, 30500, 30500, 30500]);
  assert.equal(s.held, 1000 - 20 + 8);
  assert.equal(s.sellAvg, 9900);
  assert.equal(s.buyAvg, 9500);
});

test('재매수 기한: 판 가격에 다시 오면 그 분량만 기한 도달로 보고, 다음 단계에서 그 금액 이상을 산다', () => {
  const ctx = load();
  const base = {cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}, {shares: 10, price: 9700}]};
  let s = ctx.rebuySummary(plan(ctx, {...base, currentPrice: 9650}));
  assert.equal(s.dueValue, 0, '가장 낮은 손절가 아래면 기한 전');
  s = ctx.rebuySummary(plan(ctx, {...base, currentPrice: 9700}));
  assert.deepEqual(plain(s.lots).map(l => [l.price, l.due]), [[9700, true], [9800, false], [10000, false]], '9,700원에 판 분량은 9,700원에서 기한 도달');
  assert.equal(s.dueValue, 97000);
  assert.equal(s.plan[0], 97000, '균등 몫(59,000원)보다 기한 도달 금액이 크면 그만큼');
  assert.equal(s.plan.reduce((a, b) => a + b, 0), 295000);
  s = ctx.rebuySummary(plan(ctx, {...base, currentPrice: 10000}));
  assert.equal(s.dueValue, 295000, '모든 손절가를 넘으면 남은 금액 전부 기한 도달');
  assert.deepEqual(plain(s.plan), [295000, 0, 0, 0, 0]);
});

test('재매수 기한: 이미 되산 분량은 가격이 와도 기한 도달이 아니다', () => {
  const ctx = load();
  const r = plan(ctx, {currentPrice: 9900, cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 10, execPrice: 9800};
  const s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.lots).map(l => [l.price, l.open, l.due]), [[9800, false, false], [10000, true, false]]);
  assert.equal(s.dueValue, 0);
});

test('재매수: 반 주가 안 되는 자투리는 다 산 것으로 보고, 모두 되사면 남은 금액이 0이다', () => {
  const ctx = load();
  const r = plan(ctx, {currentPrice: 9900, cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 10, execPrice: 9500};
  let s = ctx.rebuySummary(r);
  assert.equal(s.lots[0].open, false, '9,800원 분량 중 3,000원은 반 주(4,900원) 미만');
  assert.equal(s.dueValue, 0);
  assert.equal(s.rest, 100000);
  r.stages[1] = {...r.stages[1], done: true, shares: 11, execPrice: 9400};
  s = ctx.rebuySummary(r);
  assert.equal(s.rest, 0);
  assert.deepEqual(plain(s.plan).slice(2), [0, 0, 0]);
});

test('재매수: 체결가를 비운 단계는 손절 평균가로 금액을 어림하고 평균가 계산에서는 뺀다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 10, price: 10000}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 5, execPrice: null};
  const s = ctx.rebuySummary(r);
  assert.equal(s.rebought, 5);
  assert.equal(s.buyValue, 50000);
  assert.equal(s.buyAvg, null);
});

test('기본값에는 실제 보유 수량·가격을 넣지 않는다', () => {
  const ctx = load();
  const d = plain(vm.runInContext('defaultRebuy()', ctx));
  assert.deepEqual([d.lowPrice, d.amount, d.currentPrice, d.cuts, d.stepPct, d.sellPct], [0, 0, 0, [], 1, 0.5]);
  assert.equal(d.shares, undefined);
});

test('보유량: 이탈 전 보유 금액(만원) ÷ 신저점 가격을 내림한 주 수로 계산한다', () => {
  const ctx = load();
  assert.equal(hold(ctx, plan(ctx)), 1000);
  assert.equal(hold(ctx, plan(ctx, {amount: 1234.5, lowPrice: 9870})), Math.floor(12345000 / 9870));
  assert.equal(hold(ctx, plan(ctx, {amount: 1000, lowPrice: 0})), 0, '신저점 없이는 계산하지 않는다');
  assert.equal(ctx.cutPlan(plan(ctx, {amount: 500, lowPrice: 12500}))[0].left, Math.round(400 * 0.995));
});

test('보유량: 금액 입력 전에 넣은 보유 수량(shares)은 금액이 없을 때만 쓴다', () => {
  const ctx = load();
  const legacy = {...plan(ctx), amount: undefined, shares: 800};
  assert.equal(hold(ctx, legacy), 800);
  assert.equal(ctx.rebuySummary(legacy).held, 800);
  assert.equal(hold(ctx, {...legacy, amount: 1000}), 1000, '금액이 있으면 금액 기준');
});

test('손절 금액: 체크한 회차의 체결가 × 수량을 더하고, 체결가를 비우면 손절가로 계산한다', () => {
  const ctx = load();
  const s = ctx.rebuySummary(plan(ctx, {cuts: [{shares: 5, price: 9900}, {shares: 5, price: null}]}));
  assert.equal(s.sold, 10);
  assert.equal(s.sellValue, 49500 + 9800 * 5);
});
