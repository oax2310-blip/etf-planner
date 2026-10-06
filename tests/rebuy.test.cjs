const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../js/rebuy.js'), 'utf8');
if (!source.includes('function cutPlan(')) throw Error('손절 후 재매수 계산 구현을 찾지 못했습니다.');

// 화면이 쓰는 기준선 이름 판정(maKey)은 prices.js 것을 그대로 쓴다
const maKey = vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../js/prices.js'), 'utf8').match(/^function maKey\(.*$/m)[0] + ';maKey');

const load = () => { const context = vm.createContext({}); vm.runInContext(source, context); return context; };
const plan = (ctx, extra) => ({...vm.runInContext('defaultRebuy()', ctx), lowPrice: 10000, amount: 1000, ...extra});
const plain = value => JSON.parse(JSON.stringify(value));
const hold = (ctx, r) => { ctx.target = r; return vm.runInContext('holdShares(target)', ctx); };

test('손절: 신저점 대비 -1%, -2% …마다 이탈 전 보유 수량의 0.5%를 정수 주로 판다', () => {
  const ctx = load();
  const cuts = ctx.cutPlan(plan(ctx));
  assert.equal(cuts.length, 30, '기본 30회(-30%)까지 표시');
  assert.deepEqual(plain(cuts.slice(0, 3)).map(c => [c.k, c.drop, Math.round(c.price), c.qty, c.left]), [[1, 1, 9900, 5, 995], [2, 2, 9800, 5, 990], [3, 3, 9700, 5, 985]]);
  // 이탈 전 보유 기준이라 회차마다 같은 수량(1,000주 × 0.5% = 5주), k회까지 누적 5k주
  cuts.forEach(c => assert.deepEqual([c.qty, c.left], [5, 1000 - 5 * c.k]));
  assert.equal(cuts.at(-1).left, 850);
});

test('손절: 회당 수량이 정수로 안 나눠지면 누적 예정 수량을 반올림해 나눈다', () => {
  const ctx = load();
  let cuts = ctx.cutPlan(plan(ctx, {amount: 100})); // 100주 × 0.5% = 0.5주
  assert.ok(cuts.every(c => Number.isInteger(c.qty) && c.qty >= 0 && c.qty <= 1));
  assert.equal(cuts.reduce((a, c) => a + c.qty, 0), 15);
  cuts = ctx.cutPlan(plan(ctx, {amount: undefined, shares: 1234})); // 6.17주
  assert.ok(cuts.every(c => c.qty === 6 || c.qty === 7));
  cuts.forEach(c => assert.equal(1234 - c.left, Math.round(1234 * 0.005 * c.k)));
});

test('손절: 체크한 회차는 기록한 수량을 쓰고, 다음 회차 예정 수량은 그대로 둔다', () => {
  const ctx = load();
  const cuts = ctx.cutPlan(plan(ctx, {cuts: [{shares: 10, price: 9880}]}));
  assert.deepEqual([cuts[0].done, cuts[0].qty, cuts[0].left, cuts[0].execPrice], [true, 10, 990, 9880]);
  assert.deepEqual([cuts[1].qty, cuts[1].left, cuts[2].qty, cuts[2].left], [5, 985, 5, 980]);
});

test('손절: 남은 수량보다 많이 팔지 않는다', () => {
  const ctx = load();
  let cuts = ctx.cutPlan(plan(ctx, {sellPct: 10})); // 10회면 이탈 전 보유를 다 판다
  assert.deepEqual(plain(cuts.slice(8, 12)).map(c => [c.qty, c.left]), [[100, 100], [100, 0], [0, 0], [0, 0]]);
  cuts = ctx.cutPlan(plan(ctx, {cuts: [{shares: 997, price: 9900}]}));
  assert.deepEqual(plain(cuts.slice(1, 3)).map(c => [c.qty, c.left]), [[3, 0], [0, 0]]);
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

const STAGES = ['25선', '32선', '42선', '60선', '80선', '125선', '150선', '25일선', '32일선', '42일선', '60일선', '80일선', '125일선', '150일선'];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);
const nearAll = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((v, i) => near(v, expected[i])); };

test('재매수: 기본 단계는 60분봉 이평선 7개 + 일선 7개, 150일선 가격이 없으면 손절 금액을 14단계에 똑같이 나눈다', () => {
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
  assert.deepEqual(plain(ctx.rebuySummary(plan(ctx, {stages: used})).stages).map(x => x.name), ['25선', '60선', '240선', '일봉', '주봉']);
});

test('옛 단계 이름 N분봉(60분봉 N이평선)은 읽을 때 N선으로 보고 기록은 처음 고칠 때 바꾼다', () => {
  const ctx = load();
  const stages = ['25분봉', '150분봉', '25일선', '0분봉', '내 단계'].map((name, i) => ({name, price: 9000 + i, done: !i, execPrice: i ? null : 9100, shares: i ? null : 3, ...(i === 1 ? {notify: true} : {})}));
  const r = {id: 'demo', ...plan(ctx, {stages})}, before = JSON.stringify(r);
  assert.deepEqual(plain(ctx.rebuySummary(r).stages).map(x => x.name), ['25선', '150선', '25일선', '0분봉', '내 단계']);
  assert.equal(JSON.stringify(r), before, '읽기만 하면 기록을 바꾸지 않는다');
  ctx.state = {rebuy: {items: [r]}, selectedRebuy: 'demo'};
  const edited = ctx.editRebuy();
  assert.equal(edited, r);
  assert.deepEqual(r.stages.map(x => x.name), ['25선', '150선', '25일선', '0분봉', '내 단계']);
  assert.deepEqual([r.stages[0].done, r.stages[0].execPrice, r.stages[0].shares, r.stages[1].price, r.stages[1].notify], [true, 9100, 3, 9001, true], '이름만 바꾸고 체결·기준가·알림은 그대로');
  ctx.target = r;
  assert.equal(vm.runInContext('stagesOf(target)', ctx), r.stages, '바꿀 이름이 없으면 저장된 배열 그대로');
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

// DOM 없이 화면을 그려 입력칸마다 등록한 저장 처리(onEdit)를 모은다. 종목 추가·수정 창은 form.onsubmit·버튼 onclick을 직접 부른다.
function ui(state = {}, env = {}) {
  const handlers = {}, els = {};
  const el = id => els[id] ||= {id, value: '', textContent: '', focus() {}, reset() {}, showModal() { this.open = true; }, close() { this.open = false; },
    classList: {toggle(name, on) { el(id)[name] = on; }}, querySelectorAll: () => [], elements: {name: {value: '', focus() {}}, ticker: {value: ''}}};
  let n = 0;
  const ctx = vm.createContext({
    state, save() {}, $: el, $$: () => [], onEdit: (sel, set) => { handlers[sel] = set; }, id: () => `id-${++n}`, PENCIL: '', confirm: () => true,
    esc: v => String(v ?? ''), money: v => `${v}원`, won: new Intl.NumberFormat('ko-KR'), decimal: new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1}),
    shown: v => String(v), memoCount: () => '', stockEntry: () => null, priceData: null, priceStamp: () => '', priceWarning: () => '', maKey, ...env,
  });
  vm.runInContext(source, ctx);
  ctx.renderRebuy();
  // 종목 추가(edit 없음) 또는 연필(rEdit)로 연 창에 이름·코드를 넣고 저장
  const submit = (opener, name, ticker = '') => { opener(); const f = els.rebuyForm.elements; f.name.value = name; f.ticker.value = ticker; els.rebuyForm.onsubmit({preventDefault() {}}); };
  return {ctx, handlers, els, add: (name, ticker) => submit(() => els.addRebuyBtn.onclick(), name, ticker), rename: (name, ticker) => submit(() => els.rEdit.onclick(), name, ticker)};
}

test('기준 입력: 현재가·신저점·보유 칸이 저장에 연결되고, 단위를 주로 바꾸면 수량으로 저장한다', () => {
  const {ctx, handlers, els} = ui({rebuy: {items: [{id: 'a', name: '테스트 ETF'}]}});
  for (const sel of ['#rCurrent', '#rLow', '#rHold']) assert.equal(typeof handlers[sel], 'function', `${sel} 저장 처리가 없다`);
  handlers['#rCurrent']('9500');
  handlers['#rLow']('10000');
  handlers['#rHold']('1000');
  const r = () => ctx.state.rebuy.items[0];
  assert.deepEqual([r().currentPrice, r().lowPrice, r().amount, r().shares], [9500, 10000, 1000, undefined]);
  ctx.renderRebuy();
  els.rHoldUnit.onchange({target: {value: 'shares'}});
  assert.match(els.rebuyMain.innerHTML, /<option value="shares" selected>/);
  assert.match(els.rebuyMain.innerHTML, /id="rHold"[^>]*value=""[^>]*placeholder="≈1,000주"/, '단위만 바꾸면 값은 그대로, 환산 주 수를 흐리게');
  handlers['#rHold']('800');
  assert.deepEqual([r().amount, r().shares], [undefined, 800]);
  ctx.renderRebuy();
  assert.match(els.rebuyMain.innerHTML, /id="rHold"[^>]*value="800"/);
  assert.match(els.rebuyMain.innerHTML, /보유 수량 800주로 계산합니다/);
});

test('제목: 작은 글씨에 손절 후 재매수·종목 코드, 큰 글씨(h1)에 종목 이름', () => {
  const {els} = ui({rebuy: {items: [{id: 'a', name: '테스트 ETF', ticker: '900001'}]}});
  assert.match(els.rebuyMain.innerHTML, /<div class="eyebrow">손절 후 재매수 · 900001<\/div>/);
  assert.match(els.rebuyMain.innerHTML, /<h1>테스트 ETF<\/h1>/);
  assert.doesNotMatch(els.rebuyMain.innerHTML, /id="rName"|id="rTicker"/, '이름·코드는 연필 창에서만 고친다');
});

test('시세로 채우는 칸: 국내 종목 코드가 있으면 현재가·N일선 기준가 이름 옆에 작은 (자동)', () => {
  const tag = '<small class="auto-tag">(자동)</small>', count = html => html.split(tag).length - 1;
  const stages = plain(vm.runInContext('defaultRebuy().stages', load()));
  const view = (item, env) => ui({rebuy: {items: [{id: 'a', name: '테스트 ETF', stages, ...item}]}}, env).els.rebuyMain.innerHTML;
  const domestic = () => ({kind: '국내', asOf: '2026-10-01', ma: {}}), foreign = () => ({kind: '해외', asOf: '2026-10-01', ma: {}});
  // 기본 단계 14개 중 N일선 7개 + 현재가 + 마지막 단계(150일선) 가격 칸. 분봉 단계에는 붙이지 않는다
  let html = view({ticker: '900001'}, {priceData: {stocks: {}}, stockEntry: domestic});
  assert.equal(count(html), 9);
  assert.ok(html.includes(`현재가 (원)${tag}</span>`) && html.includes(`150일선 가격 (원)${tag}</span>`));
  assert.ok(html.includes(`aria-label="150일선 기준가">원${tag}`) && !html.includes(`aria-label="25분봉 기준가">원${tag}`));
  // 시세 파일에 아직 없는 코드도 다음 수집 때 채우므로 표시하고, 안내는 짧게
  html = view({ticker: '900001'}, {priceData: {stocks: {}}});
  assert.equal(count(html), 9);
  assert.match(html, /시세 수집 후 \(장중 30분마다\) 현재가·일선 기준가를 채웁니다\./);
  assert.doesNotMatch(html, /시세 파일에 아직 없는/);
  // 채우지 않는 경우: 해외 종목, 종목 코드 없음, 시세 파일을 못 읽음
  assert.equal(count(view({ticker: '900001'}, {priceData: {stocks: {}}, stockEntry: foreign})), 0);
  assert.equal(count(view({}, {priceData: {stocks: {}}, stockEntry: domestic})), 0);
  assert.equal(count(view({ticker: '900001'}, {})), 0);
});

test('종목 목록: 옛 기록(rebuy에 종목 하나)은 한 종목으로 보여 주고, 처음 고칠 때만 {items:[…]}로 바꾼다', () => {
  const legacy = {name: '옛 ETF', ticker: '900001', lowPrice: 10000, shares: 500, cuts: [{shares: 3, price: 9900}], note: '메모', auto: {at: 'x', currentPrice: 1}};
  const {ctx, handlers, els} = ui({rebuy: structuredClone(legacy)});
  assert.match(els.rebuyList.innerHTML, /<strong>옛 ETF<\/strong>/);
  assert.match(els.rebuyMain.innerHTML, /<h1>옛 ETF<\/h1>/);
  assert.deepEqual(plain(ctx.state.rebuy), legacy, '그리기만 해서는 기록(동기화 기록)이 바뀌지 않는다');
  handlers['#rLow']('9000');
  assert.equal(ctx.state.rebuy.items.length, 1);
  assert.deepEqual(Object.keys(ctx.state.rebuy), ['items'], '옛 칸은 종목 안으로 옮긴다');
  const {id, stages, ...moved} = plain(ctx.state.rebuy.items[0]);
  assert.deepEqual([id, ctx.state.selectedRebuy, stages.length], ['id-1', 'id-1', 14]);
  assert.deepEqual(moved, {...legacy, lowPrice: 9000});
});

test('종목 목록: 추가한 종목을 고르고 그 종목만 고치며, 삭제하면 남은 첫 종목을 보여 준다', () => {
  const {ctx, handlers, els, add, rename} = ui();
  assert.match(els.rebuyList.innerHTML, /종목 없음/);
  assert.match(els.rebuyMain.innerHTML, /재매수 종목을 추가하세요/);
  assert.equal(ctx.state.rebuy, undefined, '종목을 추가하기 전에는 재매수 기록을 만들지 않는다');
  add('가 ETF', ' 900001 ');
  add('나 ETF');
  const [a, b] = ctx.state.rebuy.items;
  assert.deepEqual([a.name, a.ticker, b.name, 'ticker' in b, ctx.state.selectedRebuy], ['가 ETF', '900001', '나 ETF', false, b.id], '새 종목을 고른다');
  assert.deepEqual(plain(b.stages).map(x => x.name), plain(vm.runInContext('defaultRebuy().stages', ctx)).map(x => x.name), '새 종목은 기본 단계');
  assert.match(els.rebuyMain.innerHTML, /<h1>나 ETF<\/h1>/);
  handlers['#rLow']('5000');
  assert.deepEqual([a.lowPrice, b.lowPrice], [0, 5000], '고른 종목만 바뀐다');
  ctx.state.selectedRebuy = a.id; ctx.renderRebuy();
  assert.match(els.rebuyList.innerHTML, /class="plan-item active"[^>]*data-rebuy="0"/);
  a.auto = {at: 'x', currentPrice: 1};
  rename('가 ETF 2', '900002');
  assert.deepEqual([a.name, a.ticker, 'auto' in a], ['가 ETF 2', '900002', false], '종목 코드를 바꾸면 다음 동기화 때 새 시세로 채운다');
  els.rEdit.onclick(); els.deleteRebuyBtn.onclick();
  assert.deepEqual([ctx.state.rebuy.items.length, ctx.state.rebuy.items[0].name, ctx.state.selectedRebuy], [1, '나 ETF', b.id]);
  els.rEdit.onclick(); els.deleteRebuyBtn.onclick();
  assert.deepEqual(plain(ctx.state.rebuy), {items: []}, '다 지워도 rebuy는 남겨 다른 기기에도 삭제가 간다');
  assert.match(els.rebuyMain.innerHTML, /재매수 종목을 추가하세요/);
});

test('손절 금액: 체크한 회차의 체결가 × 수량을 더하고, 체결가를 비우면 손절가로 계산한다', () => {
  const ctx = load();
  const s = ctx.rebuySummary(plan(ctx, {cuts: [{shares: 5, price: 9900}, {shares: 5, price: null}]}));
  assert.equal(s.sold, 10);
  assert.equal(s.sellValue, 49500 + 9800 * 5);
});
