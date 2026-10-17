const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 자산 배분 탭의 목표 대비(%p)·경고 색·매수중/매도중 표시. assets.js를 가상 DOM으로 불러 그리며 종목·금액은 모두 테스트용 가짜 값이다.
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const PLANNER_KEY = 'etf-exit-planner-standalone-v1';
function page(data, planner, hash = '#alloc') {
  const nodes = new Map(), storage = new Map([[PLANNER_KEY, JSON.stringify(planner)]]);
  const node = id => { if (!nodes.has(id)) nodes.set(id, {dataset: {}, hidden: false, value: '', innerHTML: '', textContent: '', style: {}, classList: {toggle() {}}, querySelector: sel => node(`${id}:${sel}`), querySelectorAll: () => [], setAttribute() {}, getAttribute() {}}); return nodes.get(id); };
  const document = {hidden: false, activeElement: null, getElementById: node, querySelector: node, querySelectorAll: () => [], addEventListener() {}};
  const store = {doc: data, prices: null, status: {state: 'off'}, config: () => null, recovery: () => [], subscribe() {}, start() {}, saveSection() { throw Error('조회만으로 저장하면 안 된다'); }};
  const ctx = vm.createContext({document, assetStore: store, URLSearchParams, crypto: require('node:crypto').webcrypto,
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v))}, addEventListener() {}, setInterval() {}, setTimeout: fn => { fn(); return 1; },
    location: {hash}, history: {replaceState() {}}, scrollTo() {}});
  vm.runInContext(['js/ma-ladder.js', 'js/data-validation.js', 'js/assets-calc.js', 'js/member-link.js', 'js/ledger-benchmark.js', 'js/assets.js'].map(read).join('\n;\n'), ctx);
  const html = node(hash.slice(1) + 'View').innerHTML;
  // 종목 줄 하나: data-alloc-item부터 다음 종목 줄 또는 그룹 끝(＋ 종목 줄) 전까지.
  const row = id => { const start = html.indexOf(`data-alloc-item="${id}"`); assert.ok(start >= 0, id); const ends = ['class="asset-row', 'class="group-foot"'].map(k => html.indexOf(k, start)).filter(i => i >= 0); return html.slice(start, ends.length ? Math.min(...ends) : undefined); };
  return {html, row, gap: ctx.allocTargetGap};
}
const item = (id, amount, target, extra = {}) => ({id, name: `종목 ${id}`, ticker: id.toUpperCase(), amount, ...(target === null ? {} : {target}), ...extra});
const stages = done => ({stages: done.map((d, i) => ({id: `s${i}`, amount: 5, price: 100, ...(d ? {done: true} : {})}))});
const sell = (id, ticker, checked, extra = {}) => ({id, ticker, title: `${ticker} 매도`, stages: checked.length, checked, holdings: [], ...extra});
// 기준 총자산 1,000만원이라 금액(만원) ÷ 10 = 현재 비중(%).
function fixture() {
  const items = [
    item('over', 230, 20), item('edge', 110, 10), item('edgeup', 105, 9.45), item('edgedown', 90, 10), item('under', 100, 11.05), item('near', 100, 10.04),
    item('buy', 180, 20, {buyPlan: stages([true, false])}), item('bought', 50, 10, {buyPlan: stages([true, true])}),
    item('sell', 150, 10), item('sold', 150, 10), item('both', 40, 10, {buyPlan: {wait: {line: '25일선'}}}), item('notarget', 30, null),
    item('xss', 10, 1, {name: '<b>이름</b>'})
  ];
  // 연결 계좌: 목표는 기준 종목에만 있고 같은 기준 코드의 추종 ETF 계좌(목표 없음)를 함께 덮는다.
  const track = (id, ticker, amount, tradeTicker = '900001') => item(id, amount, null, {ticker, tradeTicker});
  const bond = [item('bnd', 70, 20, {ticker: 'BND', buyPlan: stages([false, false])}), track('bnd2', 'BND', 50), track('bnd3', 'BND', 50)];
  const lnk = [item('lnk', 40, 10, {ticker: 'LNK'}), track('lnk2', 'LNK', 40, '900002')];
  return {version: 1, allocation: {savedAt: '', total: 1000, cashFx: 1400, memo: '', classes: [{id: 'c1', region: '미국', name: '주식'}],
    groups: [{id: 'g', name: '그룹', classId: 'c1', items}, {id: 'gb', name: '채권', classId: 'c1', items: bond}, {id: 'gl', name: '연결', classId: 'c1', items: lnk},
      // 회색 판정: 매수중 +4.0% + 1.0%p 이내 종목들(+0.9·+0.8·+0.7) → 그룹 +6.4%여도 종목이 모두 회색.
      {id: 'gm', name: '모두회색', classId: 'c1', items: [item('m1', 140, 10, {buyPlan: stages([false])}), item('m2', 109, 10), item('m3', 108, 10), item('m4', 107, 10)]},
      // 목표 없는 보유(3%)는 어느 목표에도 들지 않아 그룹 차이로 남는다. 비중 0인 목표 없는 종목은 막지 않는다.
      {id: 'gn', name: '목표밖보유', classId: 'c1', items: [item('n1', 100, 10), item('n2', 30, null)]},
      {id: 'gz', name: '빈종목', classId: 'c1', items: [item('z1', 150, 10, {buyPlan: stages([false])}), item('z2', 0, null)]}], cash: []}};
}
const planner = {plans: [sell('p1', 'SELL', [true, false]), sell('p2', 'SOLD', [true, true]), sell('p3', 'BOTH', [false, false]), sell('p4', 'XSS', [false], {cardName: '<img src=x onerror=1>'})], rebuy: {items: [{id: 'r', ticker: 'OVER', name: '재매수'}]}};

test('목표 대비는 현재 − 목표 비중(%p)을 소수 첫째 자리로 표시하고 표시 값 ±1.0%p까지는 기본 색이다', () => {
  const {gap} = page(fixture(), planner);
  const cases = [[23, 20, '+3.0%', 'over'], [18, 20, '-2.0%', 'under'], [11.000000000000002, 10, '+1.0%', ''], [9.000000000000002, 10, '-1.0%', ''],
    [10.5, 9.45, '+1.1%', 'over'], [10, 11.05, '-1.1%', 'under'], [10, 11.04, '-1.0%', ''], [11.04, 10, '+1.0%', ''], [10, 10.04, '0.0%', ''], [10, 10, '0.0%', ''], [0, 0.5, '-0.5%', ''], [10, 10.25, '-0.3%', ''], [10.25, 10, '+0.3%', '']];
  for (const [cur, target, text, state] of cases) {
    const g = gap(cur, target);
    assert.equal(g.text, text, `${cur} − ${target}`);assert.equal(g.state, state, `${cur} − ${target} 색`);assert.equal(g.muted, false);
  }
  assert.deepEqual({...gap(23, 20, true)}, {d: 3, text: '+3.0%', state: '', muted: true}, '진행 중인 매매는 경고 색 대신 muted');
  assert.deepEqual({...gap(10.5, 10, true)}, {d: 0.5, text: '+0.5%', state: '', muted: false}, '1.0%p 이내는 매매 여부와 관계없이 기본 색');
  for (const target of [null, undefined, '', 'x']) assert.equal(gap(10, target), null, `목표 없음: ${target}`);
});

test('자산 배분 종목·그룹은 금액 대신 %p 차이를 표시하고 매수중·매도중 종목은 경고 색 없이 따로 표시한다', () => {
  const data = fixture(), before = JSON.stringify(data), plannerRaw = JSON.stringify(planner), {html, row} = page(data, planner);
  const gapOf = id => /<b class="target-gap([^"]*)"[^>]*>([^<]+)<\/b>/.exec(row(id))?.slice(1, 3);
  assert.deepEqual(gapOf('over'), [' over', '+3.0%'], '재매수만 있으면 경고 색');
  assert.deepEqual(gapOf('under'), [' under', '-1.1%']);
  assert.deepEqual(gapOf('edgeup'), [' over', '+1.1%']);
  for (const id of ['edge', 'edgedown', 'near']) assert.equal(gapOf(id)[0], '', `${id}: ±1.0%p 이내`);
  assert.equal(gapOf('near')[1], '0.0%');
  assert.match(row('over'), /<span>현재 23%<\/span><small>목표 20%<\/small><b class="target-gap over" title="목표 대비 \+3\.0%p \(현재 비중 − 목표 비중\) · 목표 초과">/);
  // 진행 중인 분할매수·분할매도: 차이가 커도 기본 색, 상태 꼬리표는 매수·매도 색이 따로.
  assert.deepEqual(gapOf('buy'), ['', '-2.0%']);assert.match(row('buy'), /<span class="trade-state buy" title="분할매수 진행 중 · BUY">매수중<\/span>/);assert.doesNotMatch(row('buy'), /trade-state sell/);
  assert.match(row('buy'), /title="[^"]*매수중·매도중 종목이라 경고 색을 쓰지 않습니다"/);
  assert.deepEqual(gapOf('sell'), ['', '+5.0%']);assert.match(row('sell'), /<span class="trade-state sell" title="분할매도 진행 중 · SELL">매도중<\/span>/);assert.doesNotMatch(row('sell'), /trade-state buy/);
  assert.deepEqual(gapOf('both'), ['', '-6.0%']);assert.match(row('both'), /종목 both<span class="trade-state buy"[^>]*>매수중<\/span><span class="trade-state sell"[^>]*>매도중<\/span><\/strong>/, '매수대기와 분할매도가 함께 있으면 둘 다');
  // 끝난 계획은 매수중·매도중이 아니므로 경고 색을 쓴다. 편입 칩은 그대로 둔다.
  assert.deepEqual(gapOf('bought'), [' under', '-5.0%']);assert.doesNotMatch(row('bought'), /trade-state/);assert.match(row('bought'), /alloc-chip on[^>]*>.*분할매수/);
  assert.deepEqual(gapOf('sold'), [' over', '+5.0%']);assert.doesNotMatch(row('sold'), /trade-state/);assert.match(row('sold'), /alloc-chip on[^>]*>.*분할매도/);
  assert.equal(gapOf('notarget'), undefined, '목표가 없으면 차이를 표시하지 않는다');
  assert.match(row('xss'), /&lt;b&gt;이름&lt;\/b&gt;<span class="trade-state sell" title="분할매도 진행 중 · &lt;img src=x onerror=1&gt;">매도중/);assert.doesNotMatch(html, /<img|<b>이름<\/b>/);
  // 그룹: 합계 1,345만원(134.5%) / 종목 목표 합 131.54% → +3.0%p. 그룹은 매수중·매도중 종목이 있어도 경고 색.
  assert.match(html, /<p><b>1,345만원<\/b> · 134\.5% \/ 목표 131\.5% \(1,315\.4만원\) · 하위 합산 · <span class="group-gap">목표 대비 <b class="target-gap over"[^>]*>\+3\.0%<\/b><\/span><\/p>/);
  assert.doesNotMatch(html, /목표까지|목표 초과 [\d,.]+만원|목표 도달|class="gap /, '자산 배분 탭에는 금액 차이를 표시하지 않는다');
  assert.equal(JSON.stringify(data), before, '자산 배분 계산·기록을 바꾸지 않는다');assert.equal(JSON.stringify(planner), plannerRaw);
});

test('투자구성 탭의 분류 줄은 기존 목표까지·목표 초과 금액을 유지한다', () => {
  const {html} = page(fixture(), planner, '#strategy');
  assert.match(html, /<span class="gap (?:up|over|ok)">(?:목표까지 \+|목표 초과 |목표 도달)/);
  assert.doesNotMatch(html, /target-gap|trade-state/);
});

test('모든 종목이 매수중·매도중인 그룹은 기본 색이고, 연결 계좌까지 덮는 종목 목표는 연결 계좌 합계와 비교한다', () => {
  const data = fixture(), before = JSON.stringify(data), {html, row} = page(data, planner);
  const head = name => { const i = html.indexOf(`<span>${name}</span>`); return html.slice(i, html.indexOf('</p>', i)); };
  // 채권: 기준 종목 7% + 추종 계좌 5%·5% = 17% / 목표 20%. 세 계좌 모두 같은 분할매수에 편입돼 매수중.
  for (const id of ['bnd', 'bnd2', 'bnd3']) assert.match(row(id), /trade-state buy[^>]*>매수중/, id);
  assert.match(head('채권'), /목표 대비 <b class="target-gap" title="목표 대비 -3\.0%p \(현재 비중 − 목표 비중\) · 종목마다 1\.0%p 이내이거나 매수중·매도중이라 경고 색을 쓰지 않습니다">-3\.0%<\/b>/);
  assert.match(row('bnd'), /<span>현재 7%<\/span><small>목표 20%<\/small><span class="gap-line"><small>합계 17%<\/small><b class="target-gap" title="목표 대비 -3\.0%p \(연결 계좌 3개 합계 17% − 목표 20%\) · 매수중·매도중 종목이라 경고 색을 쓰지 않습니다">-3\.0%<\/b><\/span>/, '혼자 비교한 -13.0%가 아니다');
  for (const id of ['bnd2', 'bnd3']) assert.doesNotMatch(row(id), /target-gap/, '목표 없는 추종 계좌는 차이를 표시하지 않는다');
  // 연결: 매매가 없으면 연결 합계 8% / 목표 10% → 미달 파랑. 그룹도 일부만(또는 전혀) 매매 중이면 경고 색.
  assert.match(row('lnk'), /<span class="gap-line"><small>합계 8%<\/small><b class="target-gap under" title="목표 대비 -2\.0%p \(연결 계좌 2개 합계 8% − 목표 10%\) · 목표 미달">-2\.0%<\/b><\/span>/);
  assert.match(head('연결'), /목표 대비 <b class="target-gap under"[^>]*>-2\.0%<\/b>/);
  assert.match(head('그룹'), /목표 대비 <b class="target-gap over"[^>]*>\+3\.0%<\/b>/, '매매 중인 종목이 일부뿐인 그룹');
  assert.equal(JSON.stringify(data), before);
});

test('그룹 차이가 1.0%p를 넘어도 종목이 모두 회색(1.0%p 이내 또는 매수중·매도중)이면 그룹도 회색이다', () => {
  const data = fixture(), before = JSON.stringify(data), {html, row} = page(data, planner);
  const head = name => { const i = html.indexOf(`<span>${name}</span>`); return html.slice(i, html.indexOf('</p>', i)); };
  const gapOf = id => /<b class="target-gap([^"]*)"[^>]*>([^<]+)<\/b>/.exec(row(id))?.slice(1, 3);
  assert.deepEqual(['m1', 'm2', 'm3', 'm4'].map(gapOf), [['', '+4.0%'], ['', '+0.9%'], ['', '+0.8%'], ['', '+0.7%']]);
  assert.match(head('모두회색'), /목표 대비 <b class="target-gap" title="[^"]*종목마다 1\.0%p 이내이거나 매수중·매도중이라 경고 색을 쓰지 않습니다">\+6\.4%<\/b>/, '작은 차이가 쌓인 그룹');
  assert.match(head('목표밖보유'), /<b class="target-gap over"[^>]*>\+3\.0%<\/b>/, '목표 없는 3% 보유는 회색으로 보지 않는다');
  assert.equal(gapOf('n1')[0], '');assert.doesNotMatch(row('n2'), /target-gap/);
  assert.match(head('빈종목'), /<b class="target-gap"[^>]*>\+5\.0%<\/b>/, '비중 0%인 목표 없는 종목은 그룹 회색을 막지 않는다');
  assert.match(head('그룹'), /<b class="target-gap over"[^>]*>\+3\.0%<\/b>/, '빨강·파랑 종목이 하나라도 있으면 그룹도 경고 색');
  assert.equal(JSON.stringify(data), before);
});
