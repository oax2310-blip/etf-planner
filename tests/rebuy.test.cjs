const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../js/rebuy.js'), 'utf8');
if (!source.includes('function cutPlan(')) throw Error('손절 후 재매수 계산 구현을 찾지 못했습니다.');

const load = () => { const context = vm.createContext({}); vm.runInContext(source, context); return context; };
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

const STAGES = ['25분봉', '32분봉', '42분봉', '60분봉', '80분봉', '125분봉', '150분봉', '25일선', '32일선', '42일선', '60일선', '80일선', '125일선', '150일선'];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);
const nearAll = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((v, i) => near(v, expected[i])); };

test('재매수: 기본 단계는 분봉 7개 + 일선 7개, 150일선 가격이 없으면 손절 금액을 14단계에 똑같이 나눈다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 5, price: 9900}, {shares: 5, price: 9800}, {shares: 7, price: 9700}]});
  const s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.stages).map(x => x.name), STAGES);
  assert.equal(s.sold, 17);
  assert.equal(s.sellValue, 49500 + 49000 + 67900);
  nearAll(s.plan, Array(14).fill(166400 / 14));
  assert.equal(s.started, false);
  assert.equal(s.held, 983);
  assert.deepEqual(plain(s.lots).map(l => [l.k, l.price, l.amount]), [[3, 9700, 67900], [2, 9800, 49000], [1, 9900, 49500]], '기한이 가까운(낮은 손절가) 분량부터');
});

test('재매수: 산 금액은 손절가가 낮은 분량부터 채우고 남은 금액을 안 산 단계에 다시 나눈다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 8, execPrice: 9500};
  const s = ctx.rebuySummary(r);
  assert.equal(s.started, true);
  assert.equal(s.buyValue, 76000);
  assert.deepEqual(plain(s.lots).map(l => [l.price, l.covered, l.left, l.open]), [[9800, 76000, 22000, true], [10000, 0, 100000, true]]);
  assert.equal(s.rest, 122000);
  nearAll(s.plan, [76000, ...Array(13).fill(122000 / 13)]);
  assert.equal(s.held, 1000 - 20 + 8);
  assert.equal(s.sellAvg, 9900);
  assert.equal(s.buyAvg, 9500);
});

test('재매수 기한: 판 가격에 다시 오면 그 분량만 기한 도달로 보고 다음 단계에서 전부 산다', () => {
  const ctx = load();
  const base = {cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}, {shares: 10, price: 9700}]};
  let s = ctx.rebuySummary(plan(ctx, {...base, currentPrice: 9650}));
  assert.equal(s.dueValue, 0, '가장 낮은 손절가 아래면 기한 전');
  s = ctx.rebuySummary(plan(ctx, {...base, currentPrice: 9700}));
  assert.deepEqual(plain(s.lots).map(l => [l.price, l.due]), [[9700, true], [9800, false], [10000, false]], '9,700원에 판 분량은 9,700원에서 기한 도달');
  assert.equal(s.dueValue, 97000);
  near(s.plan[0], 97000 + 198000 / 14);
  near(s.plan.reduce((a, b) => a + b, 0), 295000);
  s = ctx.rebuySummary(plan(ctx, {...base, currentPrice: 10000}));
  assert.equal(s.dueValue, 295000, '모든 손절가를 넘으면 남은 금액 전부 기한 도달');
  nearAll(s.plan, [295000, ...Array(13).fill(0)]);
});

test('단계 가격 추정: 현재가와 150일선 가격 사이를 고르게 채우고, 넣은 기준가·체결가를 기준점으로 쓴다', () => {
  const ctx = load();
  const stages = plain(vm.runInContext('defaultRebuy()', ctx).stages);
  stages[13].price = 11200;
  const est = () => { ctx.target = stages; return plain(vm.runInContext('stageEstimates(target, 9800)', ctx)); };
  nearAll(est(), Array.from({length: 14}, (_, i) => 9800 + 100 * (i + 1)));
  stages[6].price = 10000; // 150분봉 기준가를 알면 그 앞뒤를 따로 채운다
  const e = est();
  near(e[6], 10000); near(e[2], 9800 + 200 * 3 / 7); near(e[10], 10000 + 1200 * 4 / 7);
  stages[0] = {...stages[0], done: true, execPrice: 9600};
  near(est()[1], 9800 + 200 / 6, '산 단계 뒤 첫 단계 앞에는 현재가');
  stages[13].price = 0;
  assert.equal(est()[10], null, '뒤쪽에 아는 가격이 없으면 추정하지 않음');
});

test('효율적 배분: 150일선 가격을 넣으면 분량마다 판 가격보다 싸게 살 단계에만 나눈다', () => {
  const ctx = load();
  const r = plan(ctx, {currentPrice: 9030, cuts: [{shares: 5, price: 9900}, {shares: 5, price: 9800}, {shares: 5, price: 9700}]});
  r.stages[13].price = 11200; // 추정가: 9,030원에서 11,200원까지 155원씩 → 9,185 · 9,340 · 9,495 · 9,650 · 9,805 · 9,960 …
  const s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.lots).map(l => [l.price, l.stages]), [[9700, [0, 1, 2, 3]], [9800, [0, 1, 2, 3]], [9900, [0, 1, 2, 3, 4]]]);
  nearAll(s.plan, [...Array(4).fill(48500 / 4 + 49000 / 4 + 49500 / 5), 49500 / 5, ...Array(9).fill(0)]);
  near(s.plan.reduce((a, b) => a + b, 0), s.rest);
});

test('효율적 배분: 150일선이 판 가격보다 아래면(내려가며 사는 경우) 14단계 모두에 나눈다', () => {
  const ctx = load();
  const r = plan(ctx, {currentPrice: 9500, cuts: [{shares: 5, price: 9900}, {shares: 5, price: 9800}]});
  r.stages[13].price = 8200;
  const s = ctx.rebuySummary(r);
  nearAll(s.plan, Array(14).fill(98500 / 14));
});

test('효율적 배분: 판 가격보다 싼 단계가 남지 않았으면 기한 전이라도 다음 단계에서 산다', () => {
  const ctx = load();
  const r = plan(ctx, {currentPrice: 9650, cuts: [{shares: 5, price: 9700}]});
  r.stages[0] = {...r.stages[0], price: 9750};
  r.stages[13].price = 11000;
  const s = ctx.rebuySummary(r);
  assert.equal(s.dueValue, 0);
  assert.deepEqual(plain(s.lots[0].stages), [0]);
  near(s.plan[0], 48500);
});

test('예전 기본 5단계를 손대지 않은 기록은 14단계로 보고, 체크한 기록은 그대로 둔다', () => {
  const ctx = load();
  const old = ['25분봉', '60분봉', '240분봉', '일봉', '주봉'].map(name => ({name, price: 0, done: false, execPrice: null, shares: null}));
  assert.deepEqual(plain(ctx.rebuySummary(plan(ctx, {stages: old})).stages).map(x => x.name), STAGES);
  const used = old.map((x, i) => i ? x : {...x, done: true, shares: 2, execPrice: 9500});
  assert.deepEqual(plain(ctx.rebuySummary(plan(ctx, {stages: used})).stages).map(x => x.name), old.map(x => x.name));
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
  assert.ok(plain(s.plan).slice(2).every(v => v === 0));
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

test('보유량: 수량(shares, 주)으로 넣으면 그 주 수를 쓰고, 옛 기록처럼 금액도 있으면 금액 기준', () => {
  const ctx = load();
  const legacy = {...plan(ctx), amount: undefined, shares: 800};
  assert.equal(hold(ctx, legacy), 800);
  assert.equal(ctx.rebuySummary(legacy).held, 800);
  assert.equal(hold(ctx, {...legacy, amount: 1000}), 1000, '금액이 있으면 금액 기준');
});

test('보유 입력: 금액(만원)·수량(주) 중 넣은 쪽만 남기고, 0·빈칸이면 둘 다 지운다', () => {
  const ctx = load();
  const r = plan(ctx);
  const unit = () => { ctx.target = r; return vm.runInContext('holdUnit(target)', ctx); };
  assert.equal(unit(), 'amount');
  ctx.setHold(r, 'shares', '800.7');
  assert.deepEqual([r.amount, r.shares, hold(ctx, r), unit()], [undefined, 800, 800, 'shares'], '수량은 정수 주, 금액은 지움');
  ctx.setHold(r, 'amount', '500');
  assert.deepEqual([r.amount, r.shares, hold(ctx, r), unit()], [500, undefined, 500, 'amount']);
  assert.equal(ctx.setHold(r, 'shares', 'abc'), false);
  assert.equal(ctx.setHold(r, 'shares', '-1'), false);
  assert.equal(r.amount, 500, '잘못된 값이면 바꾸지 않는다');
  ctx.setHold(r, 'shares', '');
  assert.deepEqual([r.amount, r.shares, hold(ctx, r)], [undefined, undefined, 0]);
});

test('기준 입력: 현재가·신저점·보유 칸이 저장에 연결되고, 단위를 주로 바꾸면 수량으로 저장한다', () => {
  // DOM 없이 화면을 그려 입력칸마다 등록한 저장 처리(onEdit)를 모은다
  const handlers = {}, els = {}, el = id => els[id] ||= {id, value: '', focus() {}};
  const ctx = vm.createContext({
    state: {}, save() {}, $: el, $$: () => [], onEdit: (sel, set) => { handlers[sel] = set; },
    esc: v => String(v ?? ''), money: v => `${v}원`, won: new Intl.NumberFormat('ko-KR'), decimal: new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1}),
    shown: v => String(v), memoCount: () => '', stockEntry: () => null, priceData: null, priceStamp: () => '', priceWarning: () => '',
  });
  vm.runInContext(source, ctx);
  ctx.renderRebuy();
  for (const sel of ['#rCurrent', '#rLow', '#rHold']) assert.equal(typeof handlers[sel], 'function', `${sel} 저장 처리가 없다`);
  handlers['#rCurrent']('9500');
  handlers['#rLow']('10000');
  handlers['#rHold']('1000');
  assert.deepEqual([ctx.state.rebuy.currentPrice, ctx.state.rebuy.lowPrice, ctx.state.rebuy.amount, ctx.state.rebuy.shares], [9500, 10000, 1000, undefined]);
  ctx.renderRebuy();
  els.rHoldUnit.onchange({target: {value: 'shares'}});
  assert.match(els.rebuyView.innerHTML, /<option value="shares" selected>/);
  assert.match(els.rebuyView.innerHTML, /id="rHold"[^>]*value=""[^>]*placeholder="≈1,000주"/, '단위만 바꾸면 값은 그대로, 환산 주 수를 흐리게');
  handlers['#rHold']('800');
  assert.deepEqual([ctx.state.rebuy.amount, ctx.state.rebuy.shares], [undefined, 800]);
  ctx.renderRebuy();
  assert.match(els.rebuyView.innerHTML, /id="rHold"[^>]*value="800"/);
  assert.match(els.rebuyView.innerHTML, /보유 수량 800주로 계산합니다/);
});

test('손절 금액: 체크한 회차의 체결가 × 수량을 더하고, 체결가를 비우면 손절가로 계산한다', () => {
  const ctx = load();
  const s = ctx.rebuySummary(plan(ctx, {cuts: [{shares: 5, price: 9900}, {shares: 5, price: null}]}));
  assert.equal(s.sold, 10);
  assert.equal(s.sellValue, 49500 + 9800 * 5);
});
