const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = ['ma-ladder.js', 'item-search.js', 'rebuy.js'].map(f => fs.readFileSync(require('node:path').join(__dirname, '../js', f), 'utf8')).join('\n;\n');
if (!source.includes('function cutPlan(')) throw Error('손절 후 재매수 계산 구현을 찾지 못했습니다.');

// 화면이 쓰는 기준선 이름 판정(maKey·hourKey·autoKey)은 prices.js 것을 그대로 쓴다
const pricesSource = fs.readFileSync(require('node:path').join(__dirname, '../js/prices.js'), 'utf8');
const {maKey, hourKey, autoKey, usTicker} = vm.runInNewContext(['function maKey\\(', 'function hourKey\\(', 'const autoKey ', 'const isKospi200Ticker ', 'const usTicker ']
  .map(head => pricesSource.match(new RegExp(`^${head}.*$`, 'm'))[0]).join('\n') + '\n({maKey, hourKey, autoKey, usTicker})');

const load = () => { const context = vm.createContext({usTicker}); vm.runInContext(source, context); return context; };
const plan = (ctx, extra) => ({...vm.runInContext('defaultRebuy()', ctx), lowPrice: 10000, amount: 1000, stages: vm.runInContext('defaultRebuy().stages.slice(0,14)',ctx), ...extra});
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

test('재매수: 기본 단계는 60분봉 이평선 7개 + 일선 7개, 기준가가 없으면 손절 금액을 첫 단계(25선)에서 전부 산다', () => {
  const ctx = load();
  const r = plan(ctx, {cuts: [{shares: 5, price: 9900}, {shares: 5, price: 9800}, {shares: 7, price: 9700}]});
  const s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.stages).map(x => x.name), STAGES);
  assert.equal(s.sold, 17);
  assert.equal(s.sellValue, 49500 + 49000 + 67900);
  near(s.sellAvg, 166400 / 17);
  assert.equal(s.tranches.length, 1, '기준가가 없으면 25선에서 한 번에');
  nearAll(s.plan, [166400, ...Array(13).fill(0)]);
  assert.equal(s.started, false);
  assert.equal(s.held, 983);
});

test('기본 재매수는 마지막 선택 단계까지 계획하되 평균 손절가 위 회차는 사지 않고 다음 평균선에는 배분하지 않는다', () => {
  const ctx=load(),r=plan(ctx,{cuts:[{shares:10,price:10000},{shares:10,price:9800}]}),keys=s=>plain(s.tranches).map(x=>[x.i,x.t]);
  const prices=list=>r.stages.forEach((st,i)=>{st.price=list[i]||0;});
  prices([9700,9850,9900,9950,9600]);let s=ctx.rebuySummary(r);
  near(s.sellAvg,9900);
  assert.deepEqual(keys(s),[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]]);
  assert.deepEqual(plain(s.tranches.filter(x=>x.above)).map(x=>[x.i,x.t]),[[2,1],[2,2]],'마지막 선의 2·3회차는 평균 손절가 위라 사지 않는다');
  s.tranches.forEach(x=>near(x.amount,x.above?0:198000/9));near(s.above,2*198000/9);assert.deepEqual(plain(s.skipped),[]);
  prices([10000,10100]);s=ctx.rebuySummary(r);
  assert.deepEqual(keys(s),[[0,0],[0,1],[0,2]],'첫 단계가 평균 손절가보다 높으면 그 단계만 계획하고 다음 단계는 제외한다');
  assert.ok(s.tranches.every(x=>x.above&&x.amount===0),'평균 손절가 위라 사지 않는다');near(s.above,198000);
  prices(Array(14).fill(9000));s=ctx.rebuySummary(r);
  assert.equal(s.tranches.length,14);nearAll(s.plan,Array(14).fill(198000/14));
});

test('범위 없는 옛 재매수는 비운 평균선에서 멈추고 추정가격으로 새 범위를 확장하지 않는다', () => {
  const ctx=load(),r=plan(ctx,{currentPrice:9030,cuts:[{shares:10,price:10000},{shares:10,price:9800}]});
  r.stages[0].price=9700;r.stages[2].price=9750;r.stages[13].price=11200;
  const before=JSON.stringify(r),s=ctx.rebuySummary(r);
  assert.ok(s.est[1]>9700&&s.est[1]<9900);
  assert.deepEqual(plain(s.tranches).map(x=>[x.i,x.t]),[[0,0]]);
  assert.ok(s.skipped.every(x=>x.est));s.tranches.forEach(x=>near(x.amount,198000));
  assert.equal(JSON.stringify(r),before,'추정·배분 계산은 설정과 기록을 바꾸지 않는다');
});

test('재매수: 옛 통째 기록 뒤 남은 금액은 고정한 계획의 안 산 회차에 나누고, 계획을 다 사도 다음 단계에 배분하지 않는다', () => {
  const ctx = load();
  const r = plan(ctx, {planned: [['25선', 0], ['32선', 0]], cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0] = {...r.stages[0], price: 9700, done: true, shares: 8, execPrice: 9500};
  r.stages[1].price = 9800; r.stages[2].price = 9800;
  let s = ctx.rebuySummary(r);
  assert.equal(s.started, true);
  assert.equal(s.buyValue, 76000);
  assert.equal(s.rest, 122000);
  assert.deepEqual(plain(s.planKeys), [['25선', 0], ['32선', 0]], '42선이 평균 손절가 아래여도 처음 정한 계획 그대로');
  nearAll(s.plan, [76000, 122000, ...Array(12).fill(0)]);
  assert.equal(s.held, 1000 - 20 + 8);
  assert.equal(s.sellAvg, 9900);
  assert.equal(s.buyAvg, 9500);
  r.stages[1] = {...r.stages[1], done: true, shares: 5, execPrice: 9800};
  s = ctx.rebuySummary(r);
  nearAll(s.plan, [76000, 49000, ...Array(12).fill(0)]);
  assert.equal(s.rest,73000);
  delete r.planned;
  r.stages[1] = {...r.stages[1], done: false, shares: null, execPrice: null};
  s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.tranches).map(x => [x.i, x.t, x.done]), [[0, 0, true], [1, 0, false], [2, 0, false]], '계획을 저장하지 않은 옛 기록은 산 단계를 이어진 것으로 보고 지금 기준가로 센다');
  nearAll(s.plan, [76000, 61000, 61000, ...Array(11).fill(0)]);
});

test('ETF 재매수의 0·⅓·⅔ 회차 중 평균 손절가를 넘는 회차는 계획에 남기되 사지 않는다', () => {
  const ctx=load(),r=plan(ctx,{currentPrice:10050,cuts:[{shares:10,price:10000},{shares:10,price:9800},{shares:10,price:9700}]});
  r.stages[0].price=10100;r.stages[1].price=10160;let s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.tranches).map(x=>[x.i,x.t,x.price]),[[0,0,10100],[0,1,10120],[0,2,10140]]);
  assert.ok(s.tranches.every(x=>x.above&&x.amount===0));near(s.above,295000);assert.deepEqual(plain(s.skipped),[]);
  assert.deepEqual(plain(ctx.rebuyStatus(r,s)),['손절 3회 진행','손절 3회']);
  r.stages[0].price=9700;r.stages[1].price=9790;r.stages[2].price=9910;s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.tranches).map(x=>[x.i,x.t,Math.round(x.price)]),[[0,0,9700],[0,1,9730],[0,2,9760],[1,0,9790],[1,1,9830],[1,2,9870]]);
  assert.deepEqual(plain(s.tranches.filter(x=>x.above)).map(x=>[x.i,x.t]),[[1,2]],'평균 손절가 9,833원 위 9,870원 회차만 뺀다');
  s.tranches.forEach(x=>near(x.amount,x.above?0:295000/6));assert.deepEqual(plain(s.skipped),[]);
});

test('자동 회차는 다음 평균선 가격이 비면 추정 표시만 하고 다음 선이 더 낮으면 1회로 계산한다', () => {
  const ctx=load(),r=plan(ctx,{currentPrice:9500,cuts:[{shares:10,price:9620}]}); // 평균 손절 9,620원 이하 회차
  r.stages[0].price=9600;r.stages[13].price=11000;let s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.tranches).map(x=>[x.i,x.t,x.est,x.amount]),[[0,0,false,96200]]);
  assert.deepEqual(plain(s.skipped).map(x=>[x.i,x.t,x.est]),[[0,1,true],[0,2,true]]);
  r.stages[1].price=9550;s=ctx.rebuySummary(r);
  assert.deepEqual(plain(s.tranches.filter(x=>x.i===0)).map(x=>[x.i,x.t,x.price]),[[0,0,9600]],'다음 선이 더 낮으면 25선은 1회');
  assert.ok(!s.skipped.some(x=>x.i===0));
});

test('재매수 회차: 산 회차를 뺀 남은 금액을 고정한 계획의 안 산 회차에 똑같이 나누고, 계획을 다 사도 다음 단계 1회차는 만들지 않는다', () => {
  const ctx = load();
  const planned = [['25선', 0], ['25선', 1], ['25선', 2], ['32선', 0], ['32선', 1], ['32선', 2], ['42선', 0]];
  const r = plan(ctx, {planned, currentPrice: 9950, cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]}); // 평균 9,900원
  r.stages[0].price = 9700; r.stages[1].price = 9800; r.stages[2].price = 9850;
  r.stages[0].buys = [{shares: 10, price: 9700}];
  let s = ctx.rebuySummary(r);
  assert.deepEqual([s.started, s.buyValue, s.rest, s.rebought, s.buyAvg], [true, 97000, 101000, 10, 9700]);
  assert.deepEqual(plain(s.tranches).map(x => [x.i, x.t, x.done]), [[0, 0, true], [0, 1, false], [0, 2, false], [1, 0, false], [1, 1, false], [1, 2, false], [2, 0, false]]);
  s.tranches.slice(1).forEach(x => near(x.amount, 101000 / 6));
  assert.deepEqual(plain(ctx.rebuyStatus(r, s)), ['재매수 1/7회', '재매수 1/7']);
  r.stages[2].price = 9950;
  assert.deepEqual(plain(ctx.rebuySummary(r).planKeys), planned, '42선이 평균 손절가 위로 올라가도 처음 정한 계획 그대로');
  r.stages[2].price = 9850;
  r.stages[0].buys = [{shares: 2, price: 9700}, {shares: 2, price: 9733}, {shares: 2, price: 9767}];
  r.stages[1].buys = [{shares: 2, price: 9800}, {shares: 2, price: 9817}, {shares: 2, price: 9833}];
  r.stages[2].buys = [{shares: 2, price: 9850}];
  s = ctx.rebuySummary(r);
  assert.equal(s.tranches.at(-1).i,2,'범위 마지막 42선 이후의 60선 회차는 자동 생성하지 않는다');
  assert.ok(s.tranches.every(x=>x.done));assert.ok(s.rest>0);
  r.stages[1].buys = [null, {shares: 2, price: 9817}];
  s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.tranches).filter(x => !x.done).map(x => [x.i, x.t]), [[1, 0], [1, 2]], '빈 회차는 순서와 관계없이 남은 회차');
});
test('단계 가격 추정: 현재가와 150일선 가격 사이를 고르게 채우고, 넣은 기준가·체결가를 기준점으로 쓴다', () => {
  const ctx = load();
  const stages = plain(vm.runInContext('defaultRebuy()', ctx).stages).slice(0,14);
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

test('예전 기본 5단계를 손대지 않은 기록은 시·일·주·월선 28단계로 보고, 체크한 기록은 그대로 둔다', () => {
  const ctx = load();
  const old = ['25분봉', '60분봉', '240분봉', '일봉', '주봉'].map(name => ({name, price: 0, done: false, execPrice: null, shares: null}));
  assert.deepEqual(plain(ctx.rebuySummary(plan(ctx, {stages: old})).stages).map(x => x.name), [...STAGES,...[25,32,42,60,80,125,150].map(n=>`${n}주선`),...[25,32,42,60,80,125,150].map(n=>`${n}개월선`)]);
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

test('재매수: 다 되샀으면 남은 회차에 금액이 없고 재매수 완료', () => {
  const ctx = load();
  const r = plan(ctx, {currentPrice: 10500, cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0].buys = [{shares: 21, price: 9500}];
  const s = ctx.rebuySummary(r);
  assert.equal(s.rest, 0);
  assert.ok(s.tranches.filter(x => !x.done).every(x => x.amount === 0));
  assert.deepEqual(plain(ctx.rebuyStatus(r, s)), ['재매수 완료', '완료']);
});
test('재매수: 반 주(평균 손절가의 절반)가 안 되는 자투리는 다 산 것으로 보고, 모두 되사면 남은 금액이 0이다', () => {
  const ctx = load();
  const r = plan(ctx, {planned: [['25선', 0], ['25선', 1], ['25선', 2], ['32선', 0], ['32선', 1], ['32선', 2]], currentPrice: 9950, cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]});
  r.stages[0] = {...r.stages[0], done: true, shares: 10, execPrice: 9500};
  let s = ctx.rebuySummary(r);
  assert.equal(s.rest, 103000);
  r.stages[1] = {...r.stages[1], done: true, shares: 10, execPrice: 9970};
  s = ctx.rebuySummary(r);
  assert.equal(s.rest, 0, '남은 3,300원은 반 주(4,950원) 미만');
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

test('보유 저장: 금액(만원)·수량(주) 중 받은 쪽만 남기고, 0·빈칸이면 둘 다 지운다', () => {
  const ctx = load();
  const r = plan(ctx);
  ctx.setHold(r, 'shares', '800.7');
  assert.deepEqual([r.amount, r.shares, hold(ctx, r)], [undefined, 800, 800], '수량은 정수 주, 금액은 지움');
  ctx.setHold(r, 'amount', '500');
  assert.deepEqual([r.amount, r.shares, hold(ctx, r)], [500, undefined, 500]);
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
    classList: {toggle(name, on) { el(id)[name] = on; }}, querySelectorAll: () => [], append() {}, elements: {name: {value: '', focus() {}}, ticker: {value: ''}, holding: {value: ''}}};
  let n = 0;
  const ctx = vm.createContext({
    state, save() {}, $: el, $$: () => [], onEdit: (sel, set) => { handlers[sel] = set; }, id: () => `id-${++n}`, PENCIL: '', confirm: () => true,
    document: {createElement: () => ({value:'',dataset:{},setAttribute(){},append(){},focus(){}})},
    esc: v => String(v ?? ''), money: v => `${v}원`, priceText: (v, currency) => currency === 'USD' ? `$${v}` : `${v}원`,
    usd: new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}), won: new Intl.NumberFormat('ko-KR'), decimal: new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1}),
    shown: v => String(v), memoCount: () => '', stockEntry: () => null, priceData: null, priceStamp: () => '', priceWarning: () => '', maKey, hourKey, autoKey, usTicker, ...env,
  });
  vm.runInContext(source, ctx);
  ctx.renderRebuy();
  // 종목 추가(edit 없음) 또는 연필(rEdit)로 연 창에 이름·코드를 넣고 저장
  const submit = (opener, name, ticker = '') => { opener(); const f = els.rebuyForm.elements; f.name.value = name; f.ticker.value = ticker; els.rebuyForm.onsubmit({preventDefault() {}}); };
  // 손절 기준 창(제목 옆 연필 rRules): 값 없이 부르면 창 내용, {칸: 글자}를 주면 넣고 저장해 저장 여부(잘못된 값이면 false)를 돌려준다.
  const rules = edits => {
    els.rRules.onclick();
    if (!edits) return els.rebuyRuleDialog.innerHTML;
    els.rebuyRuleForm.elements = Object.fromEntries(Object.entries(edits).map(([key, value]) => [key, {value}]));
    el('rebuyRuleError').textContent = ''; els.rebuyRuleForm.onsubmit({preventDefault() {}});
    return !el('rebuyRuleError').textContent;
  };
  return {ctx, handlers, els, rules, add: (name, ticker) => submit(() => els.addRebuyBtn.onclick(), name, ticker), rename: (name, ticker) => submit(() => els.rEdit.onclick(), name, ticker)};
}

test('제목: 이름 끝 괄호는 꼬리표로 보이고 저장 버튼은 제목 옆이 아니라 메모 제목 옆에 둔다', () => {
  const stockNames = vm.runInNewContext(`${fs.readFileSync(require('node:path').join(__dirname, '../js/stock-names.js'), 'utf8')}\n;stockNames`, {});
  const state = {rebuy: {items: [{id: 'a', name: '테스트 ETF(연저펀)', ticker: '900001', note: '옛 메모'}]}};
  const {els} = ui(state, {stockNames}), html = els.rebuyMain.innerHTML;
  assert.match(html, /<h1>테스트 ETF <span class="title-tag">연저펀<\/span><\/h1>/);
  assert.doesNotMatch(html, /변경 저장/);
  assert.match(html, /<div class="memo-head"><h2>메모<\/h2><span id="rNoteCount" class="memo-count"><\/span><button class="btn mini" id="rSave" type="button">저장<\/button><\/div>/);
  assert.equal(state.rebuy.items[0].name, '테스트 ETF(연저펀)', '저장한 이름은 그대로');
  els.rNote.value = '새 메모'; els.rSave.onclick();
  assert.equal(state.rebuy.items[0].note, '새 메모');
  assert.match(ui({rebuy: {items: [{id: 'a', name: '테스트 ETF(연저펀)'}]}}).els.rebuyMain.innerHTML, /<h1>테스트 ETF\(연저펀\)<\/h1>/, 'stock-names.js가 없으면(서버) 그대로');
});
test('재매수 제목 아래 시세 줄: 분할매도·분할매수와 같은 순서로 현재가·상태·신저점 대비 %(부호·방향)를 보인다', () => {
  const line = item => (ui({rebuy: {items: [{id: 'a', name: '테스트 ETF', lowPrice: 10000, amount: 1000, ...item}]}}).els.rebuyMain.innerHTML.match(/<p class="quote-line">.*?<\/p>/) || [''])[0];
  assert.equal(line({currentPrice: 9500}), '<p class="quote-line"><strong class="quote-now">9500원</strong><span class="quote-state">신저점 이탈</span><span class="quote-gap down">신저점 대비 <b>-5.0%</b></span></p>');
  assert.equal(line({currentPrice: 10300}), '<p class="quote-line"><strong class="quote-now">10300원</strong><span class="quote-state">신저점 위</span><span class="quote-gap up">신저점 대비 <b>+3.0%</b></span></p>');
  assert.equal(line({}), '<p class="quote-line"><span class="quote-state">손절 대기</span></p>', '현재가가 없으면 상태만');
});

test('손절 기준 창: 신저점·하락 간격·회당 손절·표시 회차만 저장하고 현재가(시세)·이탈 전 보유(자산 배분)는 읽기 전용이며 마지막 단계 가격 칸은 없다', () => {
  const {ctx, els, rules} = ui({rebuy: {items: [{id: 'a', name: '테스트 ETF', currentPrice: 9500, shares: 800}]}});
  assert.doesNotMatch(els.rebuyMain.innerHTML, /id="r(Low|Current|Hold|Step|Sell|Steps)"/, '본 화면에는 기준 입력칸을 두지 않는다');
  assert.match(els.rebuyMain.innerHTML, /<section class="future-rebuy rebuy-flow"><button class="rebuy-rule" id="rRules" type="button" aria-label="손절 기준 수정: 신저점 미입력 · −1%마다 0% 손절" title="손절 기준 수정"><span>신저점 미입력 · −1%마다 0% 손절<\/span>/, '종목 제목 아래 손절 기준 한 줄이 손절 기준 창 버튼');
  assert.doesNotMatch(els.rebuyMain.innerHTML, /<h2>신저점 손절 후 재매수<\/h2>/, '위 글자(손절 후 재매수)와 겹치는 구역 제목은 두지 않는다');
  const html = rules();
  assert.equal(els.rebuyRuleDialog.open, true);
  assert.match(html, /<input id="rCurrent" type="number" value="9500" placeholder="종목 코드 필요" readonly tabindex="-1">/);
  assert.match(html, /<input id="rHold" type="text" value="800주" placeholder="자산 배분 보유 없음" readonly tabindex="-1">/);
  assert.deepEqual([...html.matchAll(/<input id="r\w+" name="(\w+)"/g)].map(m => m[1]), ['lowPrice', 'stepPct', 'sellPct', 'steps'], '저장하는 칸은 네 개');
  assert.doesNotMatch(html, /id="rFinal"|id="rHoldUnit"|id="rHoldLink"|빈 단계 추정용|가져오기/);
  assert.match(html, /종목 이름 옆 연필에서 자산 배분의 보유 종목을 고르면 보유를 불러옵니다/);
  const before = JSON.stringify(ctx.state);
  assert.equal(rules({lowPrice: '', stepPct: '1', sellPct: '0', steps: '30'}), true);
  assert.equal(JSON.stringify(ctx.state), before, '바꾼 칸이 없으면 저장해도 기록을 만들지 않는다');
  assert.equal(rules({lowPrice: '10000'}), true);
  assert.deepEqual([ctx.state.rebuy.items[0].lowPrice, els.rebuyRuleDialog.open], [10000, false], '저장하면 창을 닫는다');
  assert.equal(rules({lowPrice: '9000', stepPct: '0'}), false, '하나라도 잘못되면');
  assert.deepEqual([ctx.state.rebuy.items[0].lowPrice, 'stepPct' in ctx.state.rebuy.items[0]], [10000, false], '아무것도 바꾸지 않는다');
  assert.equal(els.rebuyRuleDialog.open, true, '잘못된 값이면 창을 열어 둔다');
});

test('제목: 작은 글씨에 손절 후 재매수·종목 코드, 큰 글씨(h1)에 종목 이름', () => {
  const {els} = ui({rebuy: {items: [{id: 'a', name: '테스트 ETF', ticker: '900001'}]}});
  assert.match(els.rebuyMain.innerHTML, /<div class="eyebrow">손절 후 재매수 · 900001<\/div>/);
  assert.match(els.rebuyMain.innerHTML, /<h1>테스트 ETF<\/h1>/);
  assert.doesNotMatch(els.rebuyMain.innerHTML, /id="rName"|id="rTicker"/, '이름·코드는 연필 창에서만 고친다');
});

test('시세로 채우는 칸: 국내 종목 코드가 있으면 현재가·N일선·N선 기준가 이름 옆에 작은 (자동)', () => {
  const tag = '<small class="auto-tag">(자동)</small>', count = html => html.split(tag).length - 1;
  const stages = plain(vm.runInContext('defaultRebuy().stages', load()));
  const view = (item, env) => { const t = ui({rebuy: {items: [{id: 'a', name: '테스트 ETF', stages, ...item}]}}, env); return t.els.rebuyMain.innerHTML + t.rules(); }; // 본 화면 + 손절 기준 창
  const domestic = () => ({kind: '국내', asOf: '2026-10-01', ma: {}}), foreign = () => ({kind: '해외', asOf: '2026-10-01', ma: {}});
  // 기본 단계 28개(시선·일선·주선·월선 7개씩) + 현재가. 마지막 단계 가격 칸은 없다
  let html = view({ticker: '900001'}, {priceData: {stocks: {}}, stockEntry: domestic});
  assert.equal(count(html), 29);
  assert.ok(html.includes(`현재가 (원)${tag}</span>`) && !html.includes('150개월선 가격 (원)'));
  assert.ok(html.includes(`class="rebuy-base-label">${tag}</span>`) && html.includes('aria-label="150일선 기준가"') && html.includes('aria-label="25선 기준가"'));
  // 시세 파일에 아직 없는 코드도 다음 수집 때 채우므로 표시하고, 안내는 짧게
  html = view({ticker: '900001'}, {priceData: {stocks: {}}});
  assert.equal(count(html), 29);
  assert.match(html, /시세 수집 후 \(장중 30분마다\) 현재가·시선·일선·주선·월선 기준가를 채웁니다\./);
  assert.doesNotMatch(html, /시세 파일에 아직 없는/);
  // 채우지 않는 경우: 국내 코드인데 해외 시세(종류가 다름), 종목 코드 없음, 시세 파일을 못 읽음
  assert.equal(count(view({ticker: '900001'}, {priceData: {stocks: {}}, stockEntry: foreign})), 0);
  assert.equal(count(view({}, {priceData: {stocks: {}}, stockEntry: domestic})), 0);
  assert.equal(count(view({ticker: '900001'}, {})), 0);
});

test('미국 종목: 가격·금액은 달러로, 보유 금액은 달러로 나눠 주 수를 계산하고 시세로 채우는 칸에 (자동)', () => {
  const tag = '<small class="auto-tag">(자동)</small>', count = html => html.split(tag).length - 1;
  const ctx = load(), hold = r => { ctx.target = r; return vm.runInContext('holdShares(target)', ctx); };
  assert.deepEqual([hold({ticker: 'SPY', lowPrice: 500, amount: 10000}), hold({ticker: '900001', lowPrice: 10000, amount: 1000}), hold({ticker: 'A005930', lowPrice: 50000, amount: 100})],
    [20, 1000, 20], '미국은 달러 ÷ 가격, 국내는 만원 × 10,000 ÷ 가격');
  const stages = plain(vm.runInContext('defaultRebuy().stages', load()));
  const item = {id: 'a', name: '테스트 미국 ETF', ticker: 'spy', lowPrice: 500, amount: 10000, currentPrice: 480.25, cuts: [{shares: 2, price: 495}], stages};
  const t = ui({rebuy: {items: [item]}}, {priceData: {stocks: {}}, stockEntry: () => ({kind: '해외', asOf: '2026-10-01', ma: {}})}), html = t.els.rebuyMain.innerHTML + t.rules();
  assert.equal(count(html), 29);
  assert.match(html, /가격은 미국 시세\(달러\)입니다\./);
  assert.ok(html.includes(`현재가 (달러)${tag}</span>`) && html.includes('신저점 가격 (달러)</span>') && html.includes('<input id="rHold" type="text" value="$10,000 ≈ 20주"'));
  assert.ok(html.includes('$495') && html.includes(`class="rebuy-base-label">${tag}</span>`) && html.includes('aria-label="25선 기준가"'));
  assert.doesNotMatch(html, /만원|\(원\)/);
});

test('종목 목록: 옛 기록(rebuy에 종목 하나)은 한 종목으로 보여 주고, 처음 고칠 때만 {items:[…]}로 바꾼다', () => {
  const legacy = {name: '옛 ETF', ticker: '900001', lowPrice: 10000, shares: 500, cuts: [{shares: 3, price: 9900}], note: '메모', auto: {at: 'x', currentPrice: 1}};
  const {ctx, rules, els} = ui({rebuy: structuredClone(legacy)});
  assert.match(els.rebuyList.innerHTML, /<strong>옛 ETF<\/strong>/);
  assert.match(els.rebuyMain.innerHTML, /<h1>옛 ETF<\/h1>/);
  assert.deepEqual(plain(ctx.state.rebuy), legacy, '그리기만 해서는 기록(동기화 기록)이 바뀌지 않는다');
  rules({lowPrice: '9000'});
  assert.equal(ctx.state.rebuy.items.length, 1);
  assert.deepEqual(Object.keys(ctx.state.rebuy), ['items'], '옛 칸은 종목 안으로 옮긴다');
  const {id, stages, ...moved} = plain(ctx.state.rebuy.items[0]);
  assert.deepEqual([id, ctx.state.selectedRebuy, stages.length], ['id-1', 'id-1', 28]);
  assert.deepEqual(moved, {...legacy, lowPrice: 9000});
});

test('종목 목록: 추가한 종목을 고르고 그 종목만 고치며, 삭제하면 남은 첫 종목을 보여 준다', () => {
  const {ctx, rules, els, add, rename} = ui();
  assert.match(els.rebuyList.innerHTML, /종목 없음/);
  assert.match(els.rebuyMain.innerHTML, /재매수 종목을 추가하세요/);
  assert.equal(ctx.state.rebuy, undefined, '종목을 추가하기 전에는 재매수 기록을 만들지 않는다');
  add('가 ETF', ' 900001 ');
  add('나 ETF');
  const [a, b] = ctx.state.rebuy.items;
  assert.deepEqual([a.name, a.ticker, b.name, 'ticker' in b, ctx.state.selectedRebuy], ['가 ETF', '900001', '나 ETF', false, b.id], '새 종목을 고른다');
  assert.deepEqual(plain(b.stages).map(x => x.name), plain(vm.runInContext('defaultRebuy().stages', ctx)).map(x => x.name), '새 종목은 기본 단계');
  assert.match(els.rebuyMain.innerHTML, /<h1>나 ETF<\/h1>/);
  rules({lowPrice: '5000'});
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

test('재매수 체크: 회차를 체크하면 회차 가격으로 buys에 기록하고, 첫 재매수 때 회차 계획을 고정하며 체크를 모두 풀면 지운다', () => {
  const ctx = load();
  const r = {id: 'demo', ...plan(ctx, {currentPrice: 9600, cuts: [{shares: 10, price: 10000}, {shares: 10, price: 9800}]})};
  r.stages[0].price = 9600; r.stages[1].price = 9800; r.stages[2].price = 9950;
  const input = {dataset: {trancheDone: '0:0'}, checked: true};
  Object.assign(ctx, {state: {rebuy: {items: [r]}, selectedRebuy: 'demo'}, $$: () => [input], save() {}, renderRebuy() {}, cents: v => Math.round(v), alert: msg => { throw Error(msg); }});
  const start = source.indexOf('  $$("[data-tranche-done]").forEach('), end = source.indexOf('  onEdit("[data-stage-price]"', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), ctx);
  input.onchange();
  const planned = [['25선', 0], ['25선', 1], ['25선', 2], ['32선', 0], ['32선', 1], ['32선', 2]];
  assert.deepEqual(plain([r.planned, r.stages[0].buys, r.stages[0].done]), [planned, [{shares: 3, price: 9600}], false], '32선의 세 회차까지 6회로 나누고 42선에는 배분하지 않는다');
  input.dataset.trancheDone = '0:2'; input.onchange();
  assert.deepEqual(plain(r.stages[0].buys), [{shares: 3, price: 9600}, null, {shares: 3, price: 9733}], '3회차는 25선→32선 ⅔ 지점 가격(원 단위)');
  r.stages[2].price = 9700;
  assert.deepEqual(plain(ctx.rebuySummary(r).planKeys), planned, '42선이 평균 손절가 아래로 내려와도 계획 그대로');
  input.checked = false; input.onchange();
  assert.deepEqual(plain(r.stages[0].buys), [{shares: 3, price: 9600}]);
  input.dataset.trancheDone = '0:0'; input.onchange();
  assert.deepEqual(['buys' in r.stages[0], 'planned' in r], [false, false]);
  assert.deepEqual(plain(ctx.rebuySummary(r).tranches).map(x => [x.i, x.t]), [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], '체크를 모두 풀면 지금 기준가로 다시 짠다(32선·42선은 다음 단계가 더 낮거나 비어 한 번에)');
});
test('재매수 체크: 옛 기록(단계 통째로 done)은 그 단계를 한 번에 산 것으로 보고 체크를 풀면 지운다', () => {
  const ctx = load();
  const r = {id: 'demo', ...plan(ctx, {cuts: [{shares: 10, price: 10000}]})};
  r.stages[0] = {...r.stages[0], price: 9600, done: true, shares: 4, execPrice: 9500};
  let s = ctx.rebuySummary(r);
  assert.deepEqual(plain(s.tranches).map(x => [x.i, x.t, x.done, x.qty]), [[0, 0, true, 4]], '옛 통째 기록은 유지하고 범위 뒤의 회차는 만들지 않는다');
  assert.equal(s.buyValue, 38000);
  const input = {dataset: {trancheDone: '0:0'}, checked: false};
  Object.assign(ctx, {state: {rebuy: {items: [r]}, selectedRebuy: 'demo'}, $$: () => [input], save() {}, renderRebuy() {}, cents: v => Math.round(v), alert: msg => { throw Error(msg); }});
  const start = source.indexOf('  $$("[data-tranche-done]").forEach('), end = source.indexOf('  onEdit("[data-stage-price]"', start);
  vm.runInContext(source.slice(start, end), ctx);
  input.onchange();
  assert.deepEqual([r.stages[0].done, r.stages[0].shares, r.stages[0].execPrice], [false, null, null]);
});
test('화면은 평균 손절가를 표시하고 그보다 높은 회차는 사지 않는 제외 줄로 보여 준다', () => {
  const stages=plain(vm.runInContext('defaultRebuy().stages',load()));
  const view=(extra={})=>ui({rebuy:{items:[{id:'a',name:'테스트 ETF',lowPrice:10000,shares:1000,currentPrice:9950,cuts:[{shares:10,price:9900}],stages,...extra}]}}).els;
  stages[0].price=10100;stages[1].price=10160;
  let els=view(),html=els.rebuyMain.innerHTML;
  assert.match(html,/0 \/ 3회<\/span>/);assert.match(html,/평균 9900원/);
  assert.doesNotMatch(html,/기한/);assert.doesNotMatch(html,/data-tranche-done="0:\d"/,'평균 손절가 위 회차는 체크할 수 없다');
  assert.equal((html.match(/<div class="purchase-row future-buy-dim" title="평균 손절가 위">/g)||[]).length,3);
  assert.match(html,/<div class="status">안 삼<\/div>/);assert.match(html,/평균 손절가 9900원 위 회차는 사지 않습니다/);
  assert.match(html,/평균 손절가 위 제외 <b>약 /);
  assert.match(html,/id="rStages"/);
  assert.doesNotMatch(html,/aria-label="[^\"]*</);
  stages[0].price=9800;stages[1].price=9850;stages[2].price=9950;html=view().rebuyMain.innerHTML;
  assert.match(html,/0 \/ 6회<\/span>/);assert.match(html,/data-tranche-done="1:1" (?![^>]*disabled)[^>]*>/);
  assert.doesNotMatch(html,/data-tranche-done="1:2"/,'32선 3회차 9,917원은 평균 손절가 9,900원 위');
  stages[2].price=0;stages[0].buys=[{shares:2,price:9800}];
  els=view({planned:[['25선',0],['25선',1],['25선',2],['32선',0]]});
  assert.match(els.rebuyMain.innerHTML,/다음 재매수.*2\.6만원/);
  assert.match(els.rebuyList.innerHTML,/plan-count">재매수 1\/4/);
});

const fillFixture = () => ({id:'fill-test',name:'테스트 ETF',lowPrice:10000,shares:100,stepPct:1,sellPct:10,steps:2,cuts:[],stages:[{name:'25선',price:9900,done:false,shares:null,execPrice:null}]});

test('손절 카드: 대기 계획 금액과 실제 누적 수량을 구분하고 기존 기록·알림 설정을 유지한다', () => {
  const r={...fillFixture(),currentPrice:10000,notify:{cuts:true,cutsOverrides:{1:false}}},before=structuredClone(r);
  const {ctx,els}=ui({rebuy:{items:[r]}});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/trade-alerts.js'),'utf8'),ctx);
  ctx.renderRebuy();
  const cutHTML=()=>els.rebuyMain.innerHTML.split('id="rebuyCutRows">')[1].split('</section>')[0];
  let html=cutHTML();
  assert.match(html,/<span class="purchase-round"><b>1회<\/b><\/span>/);
  assert.match(html,/<div class="stage-price"><span class="price">9900원<\/span><span class="krw">신저점 −1%<\/span><\/div><div class="purchase-qty">10주<\/div>/,'하락률은 손절가 아래, 계획 주수는 수량 칸');
  assert.match(html,/data-cut-qty="0"[^>]*value=""[^>]*placeholder="0"/,'대기 회차는 예정량을 누적 체결로 보여 주지 않는다');
  assert.match(html,/data-rebuy-alert="cuts" data-alert-index="0" checked/);
  assert.doesNotMatch(html,/data-rebuy-alert="cuts" data-alert-index="1" checked/);
  for(const table of ['rebuyCutTable','rebuyBuyTable'])assert.match(els.rebuyMain.innerHTML,new RegExp(`class="[^"]*purchase-table[^"]*" id="${table}"`),'달러선물 재매수와 같은 회차표');
  assert.deepEqual(plain(r),before,'조회로 저장된 설정과 체결을 바꾸지 않는다');

  r.cuts=[{shares:3,price:9850,partial:true,plannedShares:10}];
  const partialBefore=structuredClone(r);ctx.renderRebuy();html=cutHTML();
  assert.match(html,/data-cut="0"[^>]*aria-checked="mixed"/);
  assert.match(html,/<div class="purchase-qty">10주<\/div>/,'부분 손절도 회차 계획 주수');
  assert.match(html,/data-cut-qty="0"[^>]*value="3"/);
  assert.match(html,/data-cut-price="0"[^>]*value="9850"/);
  assert.match(html,/<small>남은 7주<\/small>/);assert.match(html,/>부분 손절<\/div>/);
  assert.deepEqual(plain(r),partialBefore);
});

test('손절 카드: 미국 달러·옛 완료 기록을 유지하고 재매수 시작 후에도 남은 손절 회차를 보인다', () => {
  const r={...fillFixture(),ticker:'SPY',lowPrice:500,stages:[{name:'25선',price:495,done:false}],cuts:[{shares:10,price:494.5}]};
  let before=structuredClone(r),view=ui({rebuy:{items:[r]}});
  assert.match(view.els.rebuyMain.innerHTML,/<span class="krw">약 \$4,945<\/span><\/div><div class="purchase-qty">10주<\/div>/);
  assert.match(view.els.rebuyMain.innerHTML,/data-cut-qty="0"[^>]*value="10"/);
  assert.deepEqual(plain(r),before,'옛 완료 기록에 partial·plannedShares를 생성하지 않는다');
  r.stages[0]={...r.stages[0],done:true,shares:10,execPrice:494.5};before=structuredClone(r);view=ui({rebuy:{items:[r]}});
  const cuts=view.els.rebuyMain.innerHTML.split('id="rebuyCutRows">')[1].split('</section>')[0];
  assert.doesNotMatch(cuts,/stop-note/,'재매수 중 안내 문단 없이 남은 손절 회차만');
  assert.equal(view.ctx.rebuySummary(r).cutBase.base,100,'남은 손절은 지금 보유 100주 기준');
  assert.match(cuts,/data-cut="1" (?![^>]*disabled)[^>]*aria-label="2회 손절 완료"/,'재이탈 손절 회차는 체크할 수 있다');
  assert.deepEqual(plain(r),before);
});

test('누적 손절: 부분 수량만 계산·자산 반영하고 계획과 다음 회차는 유지, 수량 0은 취소한다', () => {
  const r=fillFixture(),calls=[],{ctx,handlers}=ui({rebuy:{items:[r]}},{allocLink:{line:()=>'',holding:()=>null,check:o=>{const key=o.commit();calls.push(['check',key,plain(o.trade)]);o.redraw();},rescale:(...a)=>calls.push(['rescale',...plain(a)]),uncheck:key=>calls.push(['uncheck',key])}});
  handlers['[data-cut-qty]']('3',{dataset:{cutQty:'0'}});
  let s=ctx.rebuySummary(r);
  assert.deepEqual([s.sold,s.sellValue,s.held,s.doneCuts,s.filledCuts],[3,29700,97,0,1]);
  assert.deepEqual([r.cuts[0].partial,r.cuts[0].plannedShares,s.cuts[1].qty],[true,10,10]);
  assert.deepEqual(calls[0],['check','cut:fill-test:0',{sign:-1,qty:3,price:9900,currency:'KRW'}]);
  handlers['[data-cut-qty]']('10',{dataset:{cutQty:'0'}});
  assert.equal(ctx.rebuySummary(r).doneCuts,1);assert.equal(Object.hasOwn(r.cuts[0],'partial'),false);
  assert.equal(calls.at(-1)[2].qty,10);
  handlers['[data-cut-qty]']('4',{dataset:{cutQty:'0'}});
  assert.equal(ctx.rebuySummary(r).doneCuts,0);assert.equal(r.cuts[0].plannedShares,10);
  handlers['[data-cut-qty]']('0',{dataset:{cutQty:'0'}});
  assert.deepEqual(r.cuts,[]);assert.deepEqual(calls.at(-1),['uncheck','cut:fill-test:0']);
});

test('누적 재매수: 부분 잔량은 같은 회차에 남고 첫 체결 계획은 고정, 완료·수량 수정·취소 가능', () => {
  const r=fillFixture();r.cuts=[{shares:10,price:9900}];
  const {ctx,handlers,els}=ui({rebuy:{items:[r]}});
  handlers['[data-tranche-qty]']('4',{dataset:{trancheQty:'0:0'}});
  let s=ctx.rebuySummary(r),rec=r.stages[0].buys[0];
  assert.deepEqual([s.rebought,s.buyValue,s.rest,s.held,s.doneTranches],[4,39600,59400,94,0]);
  assert.deepEqual([s.tranches[0].partial,s.tranches[0].amount,rec.plannedShares],[true,59400,10]);
  assert.deepEqual(plain(r.planned),[['25선',0]]);
  assert.match(els.rebuyMain.innerHTML,/<small>남은 6주<\/small>/);assert.match(els.rebuyMain.innerHTML,/>부분 재매수<\/div>/);
  handlers['[data-tranche-qty]']('10',{dataset:{trancheQty:'0:0'}});
  s=ctx.rebuySummary(r);assert.deepEqual([s.rest,s.doneTranches],[0,1]);assert.equal(Object.hasOwn(r.stages[0].buys[0],'partial'),false);
  handlers['[data-tranche-qty]']('5',{dataset:{trancheQty:'0:0'}});
  assert.equal(ctx.rebuySummary(r).doneTranches,0);assert.equal(r.stages[0].buys[0].plannedShares,10);
  handlers['[data-tranche-qty]']('0',{dataset:{trancheQty:'0:0'}});
  assert.equal(r.stages[0].buys,undefined);assert.equal(r.planned,undefined);
});

test('잘못된 수량은 기록·id·계획을 만들지 않으며 보유량을 넘는 손절을 거절한다', () => {
  const r=fillFixture(),ctx=load(),before=JSON.stringify(r);
  for(const value of ['', '-1','1.5','NaN','Infinity','9007199254740992','101'])assert.equal(ctx.rebuyCutRecord(r,0,value),false,value);
  assert.equal(JSON.stringify(r),before);
  r.cuts=[{shares:10,price:9900}];const sold=JSON.stringify(r);
  for(const value of ['', '-1','1.5','NaN','Infinity'])assert.equal(ctx.rebuyBuyRecord(r,0,0,value),false,value);
  assert.equal(JSON.stringify(r),sold);
});

test('완료 회차 자동 접기·수동 펼치기: 전체 완료 때 다시 접고, 수정 후 부분 회차는 계속 표시한다', () => {
  const r=fillFixture();r.cuts=[{shares:10,price:9900}];const {ctx,handlers,els}=ui({rebuy:{items:[r]}});
  assert.match(els.rebuyMain.innerHTML,/id="toggleRebuyCuts"[^>]*aria-expanded="false"/);
  els.toggleRebuyCuts.onclick();assert.match(els.rebuyMain.innerHTML,/id="toggleRebuyCuts"[^>]*aria-expanded="true"/);
  handlers['[data-tranche-qty]']('4',{dataset:{trancheQty:'0:0'}});
  handlers['[data-tranche-qty]']('10',{dataset:{trancheQty:'0:0'}});
  assert.match(els.rebuyMain.innerHTML,/id="toggleRebuyCuts"[^>]*aria-expanded="false"/);
  assert.match(els.rebuyMain.innerHTML,/id="rebuyBuyRows" hidden/);
  els.toggleRebuyBuys.onclick();assert.match(els.rebuyMain.innerHTML,/id="toggleRebuyBuys"[^>]*aria-expanded="true"/);
  handlers['[data-tranche-qty]']('5',{dataset:{trancheQty:'0:0'}});
  assert.doesNotMatch(els.rebuyMain.innerHTML,/id="rebuyBuyRows" hidden/);
  ctx.renderRebuy();assert.match(els.rebuyMain.innerHTML,/부분 재매수/);
});

test('옛 완료·단일 종목 기록은 조회·화면 복원 때 바꾸지 않고 새 필드를 생성하지 않는다', () => {
  const old={...fillFixture(),cuts:[{shares:10,price:9900}],stages:[{name:'25분봉',price:9900,done:true,shares:10,execPrice:9900}]};
  delete old.id;const state={rebuy:old},before=JSON.stringify(state),{ctx,els}=ui(state);
  assert.match(els.rebuyMain.innerHTML,/재매수 완료/);els.toggleRebuyBuys.onclick();ctx.renderRebuy();
  assert.equal(JSON.stringify(state),before);
  assert.equal(Object.hasOwn(old.cuts[0],'plannedShares'),false);assert.equal(Object.hasOwn(old.stages[0],'partial'),false);
});

test('부분 재매수 잔량은 다른 미체결 회차의 금액과 분리해 보존한다', () => {
  const ctx=load(),r=fillFixture();r.cuts=[{shares:10,price:10000}];r.stages=[{name:'25선',price:9000,buys:[{shares:1,price:9000,plannedShares:3,partial:true}]},{name:'32선',price:10000}];r.planned=[['25선',0],['25선',1],['25선',2],['32선',0]];
  const s=ctx.rebuySummary(r);
  assert.equal(s.tranches[0].amount,18000);near(s.tranches.slice(1).reduce((n,x)=>n+x.amount,0),73000);
  assert.equal(s.rest,91000);assert.equal(s.tranches[0].done,false);
});

test('옛 체결 수량만 수정할 때 비운 체결가·다른 회차 기록을 유지한다', () => {
  const r=fillFixture();r.cuts=[{shares:10,price:null},{shares:3,price:9800}];r.stages[0]={name:'25선',price:9900,done:true,shares:10,execPrice:null};
  const {handlers}=ui({rebuy:{items:[r]}}),other=JSON.stringify(r.cuts[1]);
  handlers['[data-cut-qty]']('6',{dataset:{cutQty:'0'}});assert.equal(r.cuts[0].price,null);assert.equal(JSON.stringify(r.cuts[1]),other);
  handlers['[data-tranche-qty]']('5',{dataset:{trancheQty:'0:0'}});assert.equal(r.stages[0].execPrice,null);assert.equal(r.stages[0].price,9900);
});

test('옛 통째 기록의 체결가 수정도 자산 반영에는 기준가 대신 실제 체결가를 전달한다', () => {
  const r=fillFixture();r.cuts=[{shares:10,price:9900}];r.stages[0]={name:'25선',price:9000,done:true,shares:10,execPrice:8900};const calls=[];
  const {handlers}=ui({rebuy:{items:[r]}},{allocLink:{line:()=>'',holding:()=>null,rescale:(...a)=>calls.push(plain(a))}});
  handlers['[data-tranche-exec]']('8950',{dataset:{trancheExec:'0:0'}});
  assert.equal(r.stages[0].execPrice,8950);assert.equal(calls[0][1].price,8950);assert.equal(calls[0][1].qty,10);
});

test('손절 도달 기준: 신저점 대비 하락률·가격·회차를 기존 정수 배분으로 계산한다', () => {
  const ctx=load(),r=plan(ctx,{sellPct:5,stepPct:1,steps:30}),m=ctx.cutMilestones(r);
  assert.deepEqual(plain(m.points).map(x=>[x.pct,x.cut.k,x.cut.drop,x.cut.price,x.cut.sold,x.inPlan]),[[50,10,10,9000,500,true],[100,20,20,8000,1000,true]]);
  assert.equal(m.sold,1000);assert.equal(m.rounds,30);
});

test('손절 도달 기준: 설정한 회차 밖의 기준은 계획에 포함되지 않는다고 구분한다', () => {
  const ctx=load(),r=plan(ctx,{sellPct:5,stepPct:2,steps:8}),m=ctx.cutMilestones(r);
  assert.deepEqual(plain(m.points).map(x=>[x.cut.k,x.cut.drop,x.cut.price,x.inPlan]),[[10,20,8000,false],[20,40,6000,false]]);
  assert.equal(m.sold,400);assert.equal(m.rounds,8);
});

test('손절 도달 기준: 소량 보유의 누적 반올림을 반영해 비중만 단순 나누지 않는다', () => {
  const ctx=load(),m=ctx.cutMilestones(plan(ctx,{amount:undefined,shares:10,sellPct:3,steps:30}));
  assert.deepEqual(plain(m.points).map(x=>[x.cut.k,x.cut.sold,x.inPlan]),[[15,5,true],[32,10,false]]);
  assert.equal(m.sold,9);
});

test('손절 도달 기준: 0원 이전에 도달하지 못하면 유효한 가격을 만들어내지 않는다', () => {
  const ctx=load(),m=ctx.cutMilestones(plan(ctx));
  assert.deepEqual(plain(m.points).map(x=>[x.cut,x.maxRounds]),[[null,99],[null,99]]);assert.equal(m.sold,150);
  const low=ctx.cutMilestones(plan(ctx,{stepPct:10,sellPct:5,steps:60}));
  assert.deepEqual(plain(low.points).map(x=>[x.cut,x.maxRounds]),[[null,9],[null,9]]);
  assert.equal(ctx.cutMilestones(plan(ctx,{lowPrice:0})).ready,false);
  assert.equal(ctx.cutMilestones(plan(ctx,{amount:undefined,shares:0})).ready,false);
});

test('손절 도달 기준 조회는 실제 손절·재매수 기록과 저장 필드를 바꾸지 않는다', () => {
  const ctx=load(),r=plan(ctx,{sellPct:5,cuts:[{shares:3,price:9850,plannedShares:50,partial:true}]});
  r.stages[0].buys=[{shares:1,price:9800,partial:true,plannedShares:2}];const before=JSON.stringify(r);
  // 재매수 뒤라 지금 보유(1,000 − 3 + 1 = 998주)를 2회차부터 5%씩 파는 기준
  const m=ctx.cutMilestones(r);assert.deepEqual(plain(m.base),{hold:998,cont:false});assert.equal(m.points[0].cut.k,11);assert.equal(m.points[0].cut.sold,499);assert.equal(JSON.stringify(r),before);
  const fresh=ctx.cutMilestones({...r,stages:r.stages.map(st=>({...st,buys:undefined}))});assert.equal(fresh.base,null);assert.equal(fresh.points[0].cut.k,10);assert.equal(fresh.points[0].cut.sold,500);
});

test('손절 도달 기준 화면은 하락 간격·비중·회차·신저점 수정에 맞춰 바뀐다', () => {
  const r={id:'milestone',...plan(load(),{sellPct:5})},{rules,els}=ui({rebuy:{items:[r]}});
  const row=pct=>els.rebuyMain.innerHTML.match(new RegExp(`<div data-cut-milestone="${pct}">.*?</div>`))[0];
  assert.equal(row(50),'<div data-cut-milestone="50"><dt>절반 매도<small>50%</small></dt><dd><b>−10% · 9000원</b><small>10회차</small></dd></div>','이름·비율 / 하락률·가격·회차 한 줄');
  assert.match(row(100),/−20% · 8000원<\/b><small>20회차</);
  rules({stepPct:'2'});assert.match(row(50),/−20% · 8000원/);assert.match(row(100),/−40% · 6000원/);
  rules({sellPct:'10'});assert.match(row(50),/<small>5회차<\/small>/);
  rules({steps:'3'});assert.match(row(50),/<small>5회차<\/small>/,'표시 회차 밖이어도 회차만');assert.doesNotMatch(els.rebuyMain.innerHTML,/회 밖/);assert.match(els.rebuyMain.innerHTML,/<span>0 \/ 3회 완료<\/span>/,'표시 회차는 1번 표 제목 줄');
  rules({lowPrice:'20000'});assert.match(row(50),/−10% · 18000원/);assert.match(row(100),/−20% · 16000원/);
  assert.match(els.rebuyMain.innerHTML,/<span>신저점 <b>20000원<\/b> · −2%마다 10% 손절<\/span>/,'기준 줄 버튼도 고친 기준');
});

test('회차 상한 제거: 표시 30회여도 전액 매도 기준은 100회차까지 계산한다', () => {
  const ctx=load(),r=plan(ctx,{stepPct:0.8,sellPct:1,steps:30}),before=JSON.stringify(r),m=ctx.cutMilestones(r);
  assert.deepEqual(plain(m.points).map(x=>[x.cut.k,x.cut.drop,Math.round(x.cut.price),x.cut.sold,x.inPlan]),[[50,40,6000,500,false],[100,80,2000,1000,false]]);
  assert.equal(JSON.stringify(r),before);assert.equal(ctx.cutPlan(r).length,30);
});

test('회차 상한 제거: 100·200·1000회 계획은 기존 정수 배분으로 전량까지 만들 수 있다', () => {
  const ctx=load();
  for(const [steps,stepPct,sellPct] of [[100,0.8,1],[200,0.2,0.5],[1000,0.05,0.1]]){
    const r=plan(ctx,{steps,stepPct,sellPct}),cuts=ctx.cutPlan(r),m=ctx.cutMilestones(r);
    assert.equal(cuts.length,steps);assert.ok(cuts.every(x=>x.price>0));assert.equal(cuts.reduce((n,c)=>n+c.qty,0),1000);assert.equal(cuts.at(-1).left,0);
    assert.equal(m.points[1].cut.k,steps);assert.equal(m.points[1].inPlan,true);
  }
});

test('회차 상한 제거: 60회 이후의 부분 손절·수량 수정·완료·표시 축소에도 기록을 유지한다', () => {
  const r={id:'long-plan',...plan(load(),{stepPct:0.8,sellPct:1,steps:100})},{ctx,handlers,rules}=ui({rebuy:{items:[r]}});
  handlers['[data-cut-qty]']('3',{dataset:{cutQty:'99'}});let s=ctx.rebuySummary(r);
  assert.equal(s.sold,3);assert.equal(s.filledCuts,1);assert.equal(r.cuts[99].partial,true);assert.equal(r.cuts[99].plannedShares,10);assert.equal(r.cuts[99].price,2000);
  handlers['[data-cut-qty]']('10',{dataset:{cutQty:'99'}});assert.equal(ctx.rebuySummary(r).doneCuts,1);assert.equal(r.cuts[99].partial,undefined);
  const record=JSON.stringify(r.cuts[99]);rules({steps:'30'});
  assert.equal(ctx.cutPlan(r).length,100);assert.equal(JSON.stringify(r.cuts[99]),record);assert.equal(ctx.rebuySummary(r).sold,10);
});

test('회차 입력은 60회 상한 없이 저장하고 잘못된 숫자는 기존 기록을 유지한다', () => {
  const r={id:'long-input',...plan(load(),{stepPct:0.8,sellPct:1})},{rules}=ui({rebuy:{items:[r]}});
  for(const value of ['100','200','1000']){assert.equal(rules({steps:value}),true);assert.equal(r.steps,Number(value));}
  const before=JSON.stringify(r);
  for(const value of ['0','-1','Infinity','NaN','9007199254740992'])assert.equal(rules({steps:value}),false,value);
  assert.equal(JSON.stringify(r),before);
  const input=rules().match(/<input id="rSteps"[^>]+>/)[0];assert.doesNotMatch(input,/\bmax=/);
});

test('상한 없는 도달 회차 계산은 작은 주수·소수 비중에서도 실제 cutPlan 누적 배분과 일치한다', () => {
  const ctx=load();
  for(const shares of [3,10,1234])for(const sellPct of [0.5,3,17])for(const stepPct of [0.2,0.8,5]){
    const r=plan(ctx,{amount:undefined,shares,sellPct,stepPct,steps:10000}),cuts=ctx.cutPlan(r);let sold=0;
    const cumulative=cuts.map(c=>({...c,sold:sold+=c.qty})),points=ctx.cutMilestones(r).points;
    for(const x of points){const first=cumulative.find(c=>c.sold*100>=shares*x.pct);assert.deepEqual(x.cut&&[x.cut.k,x.cut.sold],first?[first.k,first.sold]:null,JSON.stringify({shares,sellPct,stepPct,pct:x.pct}));}
  }
});

test('재이탈 화면: 재매수 중에도 남은 손절을 보이고, 다시 손절하면 이미 산 회차를 건너뛰고 다음 회차부터 재매수를 안내한다', () => {
  const names=['25선','32선','42선','60선','80선'];
  const r={id:'resume-ui',name:'테스트 ETF',lowPrice:10000,shares:1000,stepPct:1,sellPct:2,steps:8,currentPrice:9450,cuts:[],
    stages:names.map((name,i)=>({name,price:[9300,9400,9500,9800,9900][i]})),range:{startLine:'25선',lastLine:'80선',names,lastRound:3,targetPct:100}};
  const {ctx,handlers,els,rules}=ui({rebuy:{items:[r]}});
  const pending=(i,t)=>{const tr=ctx.rebuySummary(r).tranches.find(x=>x.i===i&&x.t===t);return String(vm.runInContext(`rebuyPendingShares(${tr.amount},${tr.price})`,ctx));};
  for(let i=0;i<5;i++)handlers['[data-cut-qty]']('20',{dataset:{cutQty:String(i)}});
  for(const [i,t] of [[0,0],[0,1],[0,2],[1,0]])handlers['[data-tranche-qty]'](pending(i,t),{dataset:{trancheQty:`${i}:${t}`}});
  let html=els.rebuyMain.innerHTML;
  const held=ctx.rebuySummary(r).held;
  assert.doesNotMatch(html,/stop-note|남은 손절 회차는 이어집니다/,'손절 표 위 안내 문단은 두지 않는다(다음 재매수·재손절은 보유 카드 안내 줄)');
  assert.equal(held,ctx.rebuySummary(r).cutBase.base,'남은 손절은 지금 보유 기준');
  assert.match(html,/다음 재매수 <b>.*? · 다시 [\d.]+원 이하면 손절 6회<\/p>/);
  assert.match(rules(),/재매수 뒤 다시 내려가면 그때 보유\(재매수 포함\)의 같은 비율씩 이어서 손절하고, 그다음 재매수는 이미 산 회차의 다음부터 합니다/);
  assert.match(html,/data-cut="5" (?![^>]*disabled)[^>]*aria-label="6회 손절 완료"/,'재매수 중에도 남은 손절을 체크할 수 있다');
  handlers['[data-cut-qty]']('20',{dataset:{cutQty:'5'}});
  assert.deepEqual([r.cuts[5].afterLine,r.cuts[5].afterRound],['32선',1]);
  html=els.rebuyMain.innerHTML;
  assert.doesNotMatch(html,/stop-note|재이탈 손절을 기록해/,'재이탈 뒤에도 안내 문단 없이');
  assert.deepEqual([ctx.rebuySummary(r).cutBase.cont,ctx.rebuySummary(r).cutBase.base],[true,held],'남은 손절은 재이탈 직전 보유 기준');
  assert.match(html,/재이탈 · 32선 1회차까지 건너뜀 · 다음 재매수 <b><span class="tr-name">32선<span class="tr-no">2<\/span>/);
  assert.doesNotMatch(html,/재이탈로 건너뜀/,'32선의 남은 2·3회차는 다시 산다');
  assert.match(html,/data-cut="6" (?![^>]*disabled)[^>]*aria-label="7회 손절 완료"/);
});

// 화면(달러선물 재매수와 같은 구조): 보유 주수 카드 · 절반·전액 매도 두 줄 · 접는 1·2 표 · 손절 기준 창. 모두 가상 종목·수량.
// 재매수 선은 평균 손절가(9,871원) 아래, 현재가는 다음 손절(9,800원)과 첫 재매수(9,850원) 사이.
const flowFixture = extra => ({id:'flow',name:'테스트 ETF',ticker:'900001',lowPrice:10000,shares:1000,stepPct:1,sellPct:1,steps:10,currentPrice:9820,cuts:[{shares:10,price:9900},{shares:4,price:9800,partial:true,plannedShares:10}],
  stages:[{name:'25선',price:9850},{name:'32선',price:9880},{name:'42선',price:9950}],range:{startLine:'25선',lastLine:'25선',names:['25선'],lastRound:3,targetPct:100},...extra});

test('0주 손절 회차는 띠·표·진행 집계에서 건너뛰고 다음 손절의 원래 번호와 입력 인덱스를 유지한다', () => {
  const r=flowFixture({shares:100,sellPct:.5,steps:14,cuts:[{shares:1,price:9900}]}),before=JSON.stringify(r),{ctx,els}=ui({rebuy:{items:[r]}});
  const html=els.rebuyMain.innerHTML,strip=html.match(/<div class="fr-cells rebuy-cells[^"]*"[^>]*>(.*?)<\/div>/)[1];
  assert.equal(ctx.cutPlan(r).length,14,'수량 배분·손절가·저장 인덱스는 원래 회차를 유지');
  assert.equal((strip.match(/<i /g)||[]).length,7,'1주씩 배정된 홀수 회차만 칸으로 표시');
  assert.doesNotMatch(strip,/class="z"/);
  assert.match(strip,/<span class="fr-next"><i class="h"><\/i><\/span><i class="s"><\/i>$/,'0주인 2회를 건너뛰고 3회 칸을 가리킨다');
  assert.match(html,/<div class="fr-bub-row" style="--x:78\.57%">/,'숨긴 회차를 뺀 실제 칸 위치에 말풍선을 둔다');
  assert.match(html,/다음 손절 3회 <b>9700원<\/b> · 1주/);
  assert.match(html,/<h2>1\. 분할 손절<\/h2><span>1 \/ 7회 완료<\/span>/);
  assert.deepEqual([...html.matchAll(/data-cut="(\d+)"/g)].map(m=>Number(m[1])),[0,2,4,6,8,10,12]);
  assert.match(html,/남은 손절 <b>1회<\/b> · 8700원 이하/,'가까운 5회와 나머지 집계도 수량이 있는 회차만 센다');
  assert.equal(JSON.stringify(r),before,'그리기로 체결 기록을 만들거나 회차를 다시 매기지 않는다');
});

test('0주 회차를 숨겨도 재매수로 채운 칸·다음 재매수 위치와 부분 손절 기록은 유지한다', () => {
  const r=flowFixture({shares:100,sellPct:.5,steps:14,currentPrice:9805,cuts:[{shares:1,price:9900},{shares:1,price:9800}],stages:[{name:'25선',price:9800,buys:[{shares:1,price:9800}]},{name:'32선',price:9840},{name:'42선',price:9950}],planned:[['25선',0],['25선',1],['25선',2]]}); // 평균 손절 9,850원 이하, 2회차(9,813원) 전
  let html=ui({rebuy:{items:[r]}}).els.rebuyMain.innerHTML;
  const strip=html.match(/<div class="fr-cells rebuy-cells[^"]*"[^>]*>(.*?)<\/div>/)[1];
  assert.doesNotMatch(strip,/class="z"/);
  assert.match(strip,/<i class="r"><\/i><span class="fr-next buy"><i class="s"><\/i><\/span>$/,'가장 최근 손절 칸부터 재매수로 채우고 다음 빈 칸에 점선을 둔다');
  r.cuts[1]={shares:0,price:9800,partial:true,plannedShares:1};
  html=ui({rebuy:{items:[r]}}).els.rebuyMain.innerHTML;
  assert.match(html,/data-cut="1" [^>]*aria-checked="mixed"/,'체결 수량이 0이어도 부분 손절 기록과 남은 수량은 남긴다');
  assert.match(html,/data-cut-qty="1" value="0"/);
});

test('표시 구간 전체가 0주이면 빈 회차를 만들지 않고 손절할 수량이 없음을 안내한다', () => {
  const r=flowFixture({shares:1,sellPct:.5,cuts:[]}),before=JSON.stringify(r),html=ui({rebuy:{items:[r]}}).els.rebuyMain.innerHTML;
  assert.doesNotMatch(html,/fr-cells rebuy-cells|data-cut="|fr-bub-row/);
  assert.match(html,/표시 구간에 손절할 수량이 없습니다\./);
  assert.match(html,/<h2>1\. 분할 손절<\/h2><span>0 \/ 0회 완료<\/span>/);
  assert.equal(JSON.stringify(r),before);
});

test('보유 주수 카드: 1칸 = 손절 1회(표시 회차), 1회 칸이 오른쪽 끝이고 손절한 만큼 비우며 다음 손절을 말풍선으로 가리킨다', () => {
  const r=flowFixture(),before=JSON.stringify(r),{ctx,els}=ui({rebuy:{items:[r]}});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/trade-alerts.js'),'utf8'),ctx);ctx.renderRebuy();
  const html=els.rebuyMain.innerHTML;
  const cells=[...html.match(/<div class="fr-cells rebuy-cells[^"]*"[^>]*>(.*?)<\/div>/)[1].matchAll(/<i class="([^"]+)"( style="[^"]*")?><\/i>/g)].map(m=>m[1]+(m[2]||''));
  assert.equal(cells.length,10,'표시 회차만큼 칸');
  assert.deepEqual(cells.slice(-2),['mix style="--g:60%;--b:60%"','s'],'1회는 빈 칸, 부분 손절한 2회는 판 비율만큼 비움');
  assert.ok(cells.slice(0,-2).every(x=>x==='h'));
  assert.match(html,/<span class="fr-next"><i class="mix"[^>]*><\/i><\/span>/,'남은 손절이 있는 2회 칸을 다음 손절로 감싼다');
  assert.match(html,/<span class="fr-bub">다음 손절 2회 <b>9800원<\/b> · 6주 /);
  assert.match(html,/<b>986<\/b><span>\/ 1,000주<\/span>/,'보유 / 이탈 전 주수');
  assert.doesNotMatch(html,/buy-track-chip/,'진행 상태는 제목 아래 상태 칩(손절 1회 진행)과 같아 카드에 다시 적지 않는다');
  assert.match(html,/<span class="quote-state">손절 1회 진행 · 부분 체결<\/span>/);
  assert.match(html,/<div class="fr-track-foot"><span>손절 평균가 <b>[\d.]+원<\/b>[^<]*<\/span><label class="trade-alert-toggle"[^>]*><input type="checkbox" data-rebuy-alert="breakdown"/,'아래 줄에 손절 평균가와 신저점 이탈 알림');
  assert.match(html,/재매수: <span class="tr-name">25선<span class="tr-no">1<\/span><\/span> <b>9850원<\/b> 이상 약 /,'안내 줄은 재매수 시작 조건');
  assert.equal(JSON.stringify(r),before,'그리기만 해서는 기록을 바꾸지 않는다');
});

test('보유 주수 카드: 재매수 주수는 가장 최근에 비운 칸부터 파랑으로 다시 채우고, 손절가에 닿으면 주황으로 바뀐다', () => {
  const r=flowFixture({currentPrice:9805,cuts:[{shares:10,price:9900},{shares:10,price:9800}],stages:[{name:'25선',price:9800,buys:[{shares:12,price:9800}]},{name:'32선',price:9840},{name:'42선',price:9950}],planned:[['25선',0],['25선',1],['25선',2]]}); // 평균 손절 9,850원 이하, 2회차(9,813원) 전
  let html=ui({rebuy:{items:[r]}}).els.rebuyMain.innerHTML;
  const cells=()=>[...html.match(/<div class="fr-cells rebuy-cells[^"]*"[^>]*>(.*?)<\/div>/)[1].matchAll(/<i class="([^" ]+)/g)].map(m=>m[1]);
  assert.deepEqual(cells().slice(-2),['r','mix'],'2회 칸(10주)은 다 채우고 1회 칸은 남은 2주만');
  assert.doesNotMatch(html,/buy-track-chip/,'재매수 진행 중도 제목 아래 상태 칩만');
  assert.match(html,/<span class="fr-next buy">/,'재매수 시작 뒤에는 다음 재매수가 채울 칸을 점선으로');
  assert.match(html,/재매수 <b>12<\/b>/);assert.match(html,/손절 <b>[\d.]+원<\/b> → 재매수 <b>9800원<\/b>/);
  r.currentPrice=9690;html=ui({rebuy:{items:[r]}}).els.rebuyMain.innerHTML;
  assert.match(html,/<span class="buy-track-chip warn">손절 시점<\/span>/);
  assert.match(html,/<span class="fr-bub due">손절 시점 · 3회 <b>9700원<\/b>/);
});

test('1·2 표는 기본으로 펼치고, 사용자가 접은 상태는 다시 그려도 유지하며 다른 회차가 새로 시점이 되면 다시 펼친다', () => {
  const r=flowFixture(),{ctx,els}=ui({rebuy:{items:[r]}});
  const open=id=>new RegExp(`<details class="future-rebuy-details" id="${id}" open>`).test(els.rebuyMain.innerHTML);
  assert.deepEqual([open('rCuts'),open('rBuys')],[true,true],'시점이 아니어도 펼친다');
  els.rCuts.open=false;els.rCuts.ontoggle();els.rBuys.open=false;els.rBuys.ontoggle();ctx.renderRebuy();
  assert.deepEqual([open('rCuts'),open('rBuys')],[false,false],'사용자가 접은 표는 접어 둔다');
  r.currentPrice=9790;ctx.renderRebuy();assert.deepEqual([open('rCuts'),open('rBuys')],[true,false],'손절 시점이 되면 손절 표만 다시 펼친다');
  els.rCuts.open=false;els.rCuts.ontoggle();ctx.renderRebuy();assert.equal(open('rCuts'),false,'같은 시점에서 다시 접으면 유지');
  r.currentPrice=10050;ctx.renderRebuy();assert.equal(open('rCuts'),false,'시점이 지나도 접은 상태 유지');
  els.rCuts.open=true;els.rCuts.ontoggle();ctx.renderRebuy();assert.equal(open('rCuts'),true,'다시 열면 기본(펼침)');
  r.cuts[1]={shares:10,price:9800};r.stages=[{name:'25선',price:9800,buys:[{shares:2,price:9800}]},{name:'32선',price:9840},{name:'42선',price:9950}];r.planned=[['25선',0],['25선',1],['25선',2]];r.currentPrice=9815;ctx.renderRebuy();
  assert.match(els.rebuyMain.innerHTML,/재매수 시점/,'평균 손절가 이하 2회차에 닿았다');
  assert.equal(open('rBuys'),true,'재매수 시점이면 접어 둔 재매수 표도 펼친다');
});

test('손절 표는 끝나지 않은 가까운 5회만 바로 보이고 나머지는 남은 손절 띠로, 배분 없는 단계는 다른 단계 띠로 접는다', () => {
  const r=flowFixture({steps:30}),{ctx,els}=ui({rebuy:{items:[r]}});
  let html=els.rebuyMain.innerHTML;
  const near=html.split('id="rebuyCutRows">')[1].split('id="toggleRebuyCutRest"')[0];
  assert.deepEqual([...near.matchAll(/data-cut="(\d+)"/g)].map(m=>Number(m[1])),[0,1,2,3,4,5],'완료 1회(접힘) + 부분 손절 2회부터 5회');
  assert.match(html,/id="toggleRebuyCutRest" type="button" aria-expanded="false" aria-controls="rebuyCutRest"><span>남은 손절 <b>24회<\/b> · 9300원 이하<\/span>/);
  assert.match(html,/<div id="rebuyCutRest" hidden>/);
  els.toggleRebuyCutRest.onclick();html=els.rebuyMain.innerHTML;
  assert.match(html,/<div id="rebuyCutRest">/);assert.match(html,/data-cut="29"/);
  assert.match(html,/id="toggleRebuyStages"[^>]*aria-expanded="false"[^>]*><span>다른 단계 2개 · 기준가·알림<\/span>/,'범위 밖 32선·42선');
  assert.match(html,/<div id="rebuyStageRows" hidden>.*data-stage-price="1".*data-stage-price="2"/s,'다른 단계의 기준가도 그 띠 안에서 고친다');
  els.toggleRebuyStages.onclick();assert.match(els.rebuyMain.innerHTML,/<div id="rebuyStageRows">/);
  assert.match(els.rebuyMain.innerHTML,/<span>시작 기준선 <b>25선<\/b><\/span><span>마지막 <b>25선 3회차<\/b><\/span><\/div>/,'범위 줄(비운 기준가가 없으면 추정 안내를 뺀다)');
  ctx.renderRebuy();
});

test('손절 시점 회차가 5회를 넘으면 도달한 회차는 모두 바로 보이고 남은 손절 띠에는 도달 전 회차만 접는다', () => {
  const r=flowFixture({steps:30,currentPrice:9150}),before=JSON.stringify(r),{els}=ui({rebuy:{items:[r]}});
  const html=els.rebuyMain.innerHTML,near=html.split('id="rebuyCutRows">')[1].split('id="toggleRebuyCutRest"')[0],rest=html.split('<div id="rebuyCutRest"')[1].split('id="rBuys"')[0];
  assert.deepEqual([...near.matchAll(/data-cut="(\d+)"/g)].map(m=>Number(m[1])),[0,1,2,3,4,5,6,7],'부분 손절 2회부터 9200원 8회까지 7회 도달');
  assert.equal((near.match(/<div class="status due">손절 시점<\/div>/g)||[]).length,6,'부분 손절 2회를 뺀 도달 회차는 모두 주황 손절 시점');
  assert.doesNotMatch(rest,/status due/,'접힌 띠 안에는 도달한 회차가 없다');
  assert.match(html,/<span>남은 손절 <b>22회<\/b> · 9100원 이하<\/span>/);
  assert.equal(JSON.stringify(r),before,'표시만 바꾸고 기록은 그대로');
});

test('손절 기준 저장(setRebuyRules)은 바꾼 칸만 검사해 저장하고, 잘못된 칸이 있거나 바꾼 칸이 없으면 기록을 만들지 않는다', () => {
  const r=flowFixture(),{ctx}=ui({rebuy:{items:[r]}}),before=JSON.stringify(r);
  assert.equal(ctx.setRebuyRules({}),true);assert.equal(JSON.stringify(r),before);
  for(const edits of [{lowPrice:'-1'},{stepPct:'0'},{stepPct:'50.1'},{sellPct:'0'},{sellPct:'101'},{steps:'0'},{steps:'abc'},{lowPrice:'9000',sellPct:''}])
    assert.equal(ctx.setRebuyRules(edits),false,JSON.stringify(edits));
  assert.equal(JSON.stringify(r),before,'잘못된 값은 하나도 저장하지 않는다');
  assert.equal(ctx.setRebuyRules({lowPrice:'',stepPct:'0.8',sellPct:'0.92',steps:'40.7'}),true);
  assert.deepEqual([r.lowPrice,r.stepPct,r.sellPct,r.steps],[0,0.8,0.92,40],'신저점을 비우면 0, 표시 회차는 정수로');
  assert.deepEqual(plain(r.cuts),plain(flowFixture().cuts),'기준을 바꿔도 손절 기록은 그대로');
});
