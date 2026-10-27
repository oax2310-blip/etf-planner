const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 재매수 종목 추가·수정 창의 '보유 종목에서 선택': 자산 배분(assetStore.doc.allocation) 항목만 읽고, 재매수에는 따로 목록을 저장하지 않는다.
// 가상 종목·수량만 사용한다(실제 보유 정보 없음). 화면은 DOM 없이 가짜 요소로 실행한다.
const read = f => fs.readFileSync(path.join(__dirname, '../js', f), 'utf8');
const source = ['ma-ladder.js', 'prices.js', 'assets-calc.js', 'item-search.js', 'rebuy.js'].map(read).join('\n;\n');
const plain = v => JSON.parse(JSON.stringify(v));

const allocation = () => ({groups: [
  {id: 'g1', name: '가상계좌A', items: [
    {id: 'i1', name: '가상국내ETF', ticker: '900001', shares: 120},
    {id: 'i2', name: '가상미국ETF', ticker: 'QQQQ', shares: 7},
    {id: 'i3', name: '가상코인', ticker: 'BTC-USD', shares: 0.5},
    {id: 'i4', name: '다 판 종목', ticker: '900002', shares: 0},
    {id: 'i5', name: '금액만 입력', ticker: '900003', amount: 300},
    {id: 'i6', name: '코드 없음', amount: 100},
  ]},
  {id: 'g2', name: '가상계좌B', items: [{id: 'i7', name: '가상국내ETF(B)', ticker: '900001', shares: 30}]},
]});

// real: 가짜 allocLink 대신 실제 alloc-link.js(계좌 고르는 창·손절/재매수 계좌)를 함께 실행한다.
function ui(state = {}, {alloc = allocation(), link = true, real = false, prices = null} = {}) {
  const els = {}, listeners = [];
  const el = id => els[id] ||= {id, value: '', textContent: '', innerHTML: '', hidden: undefined, focus() {}, reset() {}, showModal() { this.open = true; }, close() { this.open = false; },
    classList: {toggle() {}}, querySelectorAll: () => [], append() {}, setAttribute() {}, dataset: {}};
  const form = el('rebuyForm');
  form.elements = {name: {value: '', focus() {}}, ticker: {value: '', focus() {}}, holding: {value: ''}};
  form.reset = () => { form.elements.name.value = ''; form.elements.ticker.value = ''; form.elements.holding.value = ''; };
  // 검색 칸(item-search.js)이 만든 요소도 id로 찾는다.
  const document = {activeElement: null, createElement() { const e = {value: '', dataset: {}, setAttribute() {}, append() {}, focus() {}}; Object.defineProperty(e, 'id', {get: () => e._id, set(v) { e._id = v; els[v] = e; }}); return e; }};
  let n = 0, stored = null;
  const assetStore = {doc: {allocation: alloc}, prices, subscribe: fn => { listeners.push(fn); return () => {}; }};
  const ctx = vm.createContext({
    state, save() {}, $: el, $$: () => [], onEdit() {}, id: () => `id-${++n}`, PENCIL: '', confirm: () => true, document,
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
    money: v => `${v}원`, priceText: (v, c) => c === 'USD' ? `$${v}` : `${v}원`,
    usd: new Intl.NumberFormat('en-US'), won: new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 8}), decimal: new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1}),
    shown: v => String(v), memoCount: () => '', stockEntry: () => null, priceData: null, priceStamp: () => '', priceWarning: () => '', assetStore,
    ...(link && !real ? {allocLink: {holding: ticker => { const s = linkSummaryOf(ctx, assetStore, ticker); return s; }, line: () => '', check() {}, uncheck() {}, forget() {}, rescale() {}}} : {}),
  });
  vm.runInContext(real ? `${read('alloc-link.js')}\n;\n${source}` : source, ctx);
  ctx.renderRebuy();
  // 목록 행·'변경' 누르기: 가짜 요소의 onclick에 closest가 그 속성을 찾는 대상을 넘긴다.
  const click = (node, attr, dataset = {}) => node.onclick({target: {closest: sel => sel.split(',').includes(`[${attr}]`) ? {dataset} : null}});
  const pick = itemId => click(els.rebuyItemList, 'data-pick', {pick: itemId});
  const repick = () => click(els.rebuyPicked, 'data-repick');
  const rules = () => { els.rRules.onclick(); return els.rebuyRuleDialog.innerHTML; }; // 손절 기준 창(현재가·이탈 전 보유는 이 창에 읽기 전용)
  return {ctx, els, form, listeners, assetStore, pick, repick, rules, items: () => ctx.state.rebuy?.items || []};
}
// alloc-link.js의 holding()과 같은 계산(linkSummary 사용) — 파일 자체는 DOM에 의존하므로 계산 함수만 그대로 부른다.
function linkSummaryOf(ctx, store, ticker) {
  const s = vm.runInContext('(a,p,t)=>linkSummary(a,p,t)', ctx)(store.doc.allocation, store.prices, ticker);
  if (!s) return null;
  return {shares: s.shares, value: Math.round(s.value * 10) / 10, fx: s.fx, text: `${s.rows.length > 1 ? `${s.rows.length}개 계좌` : s.rows[0].it.name} ${s.shares === null ? '' : `${s.shares}주`}`};
}

test('보유 종목 목록: 자산 배분에서 국내·미국 거래 코드이면서 보유가 있는 항목만 읽는다', () => {
  const {ctx} = ui();
  const ids = ctx.rebuyHoldingChoices(allocation()).map(c => c.it.id);
  assert.deepEqual(ids, ['i1', 'i2', 'i5', 'i7'], '코인·0주·코드 없음은 제외, 금액만 있는 종목은 포함');
  assert.deepEqual(plain(ctx.rebuyHoldingChoices(null)), []);
  assert.deepEqual(plain(ctx.rebuyHoldingChoices({})), []);
});

test('새 종목: 보유 종목을 검색해 고르면 이름·코드를 채우고 저장할 때 합계 수량을 이탈 전 보유로 채운다 (자산 데이터는 읽기만)', () => {
  const {ctx, els, form, items, assetStore, pick} = ui();
  const before = JSON.stringify(assetStore.doc);
  els.addRebuyBtn.onclick();
  const f = form.elements;
  assert.equal(els.rebuySearchBox.hidden, false); assert.equal(els.rebuyPicked.hidden, true);
  assert.match(els.rebuyItemList.innerHTML, /<strong>가상국내ETF<\/strong><small>가상계좌A · 900001 · 보유 120주<\/small>/);
  assert.doesNotMatch(els.rebuyItemList.innerHTML, /가상코인|다 판 종목/);
  els.rebuySearch.value = '계좌b'; els.rebuySearch.oninput();
  assert.equal((els.rebuyItemList.innerHTML.match(/data-pick=/g) || []).length, 1, '그룹 이름으로도 찾는다');
  els.rebuySearch.value = ''; els.rebuySearch.oninput();
  pick('i1');
  assert.deepEqual([f.name.value, f.ticker.value, f.holding.value, f.ticker.readOnly], ['가상국내ETF', '900001', 'i1', true]);
  assert.equal(els.rebuyPicked.hidden, false); assert.match(els.rebuyPicked.innerHTML, /data-repick/);
  assert.match(els.rebuyHoldingHint.textContent, /150주/, '같은 코드의 두 계좌 합계를 안내'); assert.equal(els.rebuyHoldingHint.hidden, false);
  form.onsubmit({preventDefault() {}});
  assert.deepEqual(plain(items()).map(r => [r.name, r.ticker, r.shares, r.amount]), [['가상국내ETF', '900001', 150, undefined]]);
  assert.equal(JSON.stringify(assetStore.doc), before, '자산 데이터는 바뀌지 않는다');
  els.addRebuyBtn.onclick();
  assert.match(els.rebuyItemList.innerHTML, /data-pick="i1"[^>]*>.*?<em>등록됨<\/em>/, '이미 등록한 종목을 표시');
});

test('새 종목: 미국 종목은 수량으로, 금액만 있는 종목은 금액 단위로 채운다', () => {
  const t = ui();
  t.els.addRebuyBtn.onclick(); t.pick('i2'); t.form.onsubmit({preventDefault() {}});
  assert.deepEqual([t.items()[0].ticker, t.items()[0].shares], ['QQQQ', 7]);
  t.els.addRebuyBtn.onclick(); t.els.rebuySearch.value = '금액만'; t.els.rebuySearch.oninput(); t.els.rebuySearch.onkeydown({key: 'Enter', preventDefault() {}}); t.form.onsubmit({preventDefault() {}});
  assert.deepEqual([t.items()[1].ticker, t.items()[1].amount, t.items()[1].shares], ['900003', 300, undefined]);
});

test('보유 종목이 없으면 목록에 안내를 보이고 검색어를 이름으로 넘기거나 이름·코드를 직접 입력해 저장한다', () => {
  for (const alloc of [null, {groups: []}]) {
    const {els, form, items} = ui({}, {alloc});
    els.addRebuyBtn.onclick();
    assert.match(els.rebuyItemList.innerHTML, /자산 배분에 보유 종목이 없습니다/);
    els.rebuySearch.value = '직접 입력 ETF'; els.rebuySearch.oninput();
    assert.match(els.rebuyItemList.innerHTML, /‘직접 입력 ETF’ 종목 이름으로 직접 입력/);
    els.rebuySearch.onkeydown({key: 'Enter', preventDefault() {}});
    assert.equal(form.elements.name.value, '직접 입력 ETF'); assert.equal(els.rebuySearch.value, '');
    form.elements.ticker.value = '900009';
    form.onsubmit({preventDefault() {}});
    assert.deepEqual(plain(items()).map(r => [r.name, r.ticker, r.shares, r.amount]), [['직접 입력 ETF', '900009', undefined, 0]]); // amount 0은 defaultRebuy의 기존 기본값
  }
});

test('고른 뒤 변경을 누르고 코드를 직접 바꾸면 보유를 채우지 않는다', () => {
  const {els, form, items, pick, repick} = ui();
  els.addRebuyBtn.onclick(); const f = form.elements;
  pick('i1'); repick();
  assert.deepEqual([f.holding.value, f.ticker.readOnly, f.ticker.value, els.rebuyHoldingHint.hidden], ['', false, '900001', true], '변경은 입력한 값을 지우지 않는다');
  f.ticker.value = '900099';
  form.onsubmit({preventDefault() {}});
  assert.deepEqual([items()[0].ticker, items()[0].shares, items()[0].amount], ['900099', undefined, 0], '보유는 기본값 그대로');
});

test('수정 창: 기록 전이면 저장할 때 이탈 전 보유를 자산 배분 보유로 맞추고, 손절 기록이 있으면 다른 종목을 골라도 보유를 바꾸지 않는다', () => {
  const state = {rebuy: {items: [{id: 'a', name: '가상국내ETF', ticker: '900001', lowPrice: 10000, shares: 80}]}};
  const {els, form, items} = ui(state), f = form.elements;
  els.rEdit.onclick();
  assert.equal(f.holding.value, '', '같은 코드가 두 계좌에 있어 자동으로 하나를 고르지 않는다');
  assert.equal(els.rebuySearchBox.hidden, false); assert.doesNotMatch(els.rebuyItemList.innerHTML, /등록됨/, '수정 중인 종목은 등록 표시에서 제외');
  f.name.value = '이름만 수정'; form.onsubmit({preventDefault() {}});
  assert.deepEqual([items()[0].name, items()[0].shares], ['이름만 수정', 150], '두 계좌 합계로 맞춘다');

  const locked = {rebuy: {items: [{id: 'b', name: '손절 중', ticker: '900009', lowPrice: 10000, shares: 80, cuts: [{shares: 5, price: 9900}]}]}};
  const t = ui(locked); t.els.rEdit.onclick();
  t.pick('i1'); t.form.onsubmit({preventDefault() {}});
  assert.deepEqual([t.items()[0].ticker, t.items()[0].shares, t.items()[0].cuts.length], ['900001', 80, 1], '이름·코드만 바뀌고 이탈 전 보유는 그대로');
});

test('수정 창: 코드가 한 항목에만 있으면 그 보유 종목을 고른 상태로 보여 주고 저장하면 그 보유로 맞춘다', () => {
  const alloc = allocation(); alloc.groups[1].items = [];
  const {els, form, items} = ui({rebuy: {items: [{id: 'a', name: 'x', ticker: '900001', shares: 80}]}}, {alloc});
  els.rEdit.onclick();
  assert.equal(form.elements.holding.value, 'i1'); assert.equal(form.elements.ticker.readOnly, true);
  assert.equal(els.rebuyPicked.hidden, false); assert.match(els.rebuyPicked.innerHTML, /가상국내ETF/);
  form.onsubmit({preventDefault() {}});
  assert.equal(items()[0].shares, 120);
});

test('수정 창: 기록 전에 다른 종목 코드로 바꾸면 이전 종목의 보유를 지우고 새 코드의 자산 배분 보유를 쓴다', () => {
  const t = ui({rebuy: {items: [{id: 'a', name: 'x', ticker: '900001', shares: 150}]}});
  t.els.rEdit.onclick(); t.form.elements.ticker.value = '900099'; t.form.onsubmit({preventDefault() {}});
  assert.deepEqual([t.items()[0].ticker, t.items()[0].shares, t.items()[0].amount], ['900099', undefined, undefined], '자산 배분에 없는 코드');
  t.els.rEdit.onclick(); t.form.elements.ticker.value = '900003'; t.form.onsubmit({preventDefault() {}});
  assert.deepEqual([t.items()[0].shares, t.items()[0].amount], [undefined, 300], '금액만 있는 종목은 금액');
});

test('기준 입력: 이탈 전 보유는 읽기 전용으로 자산 배분 보유를 따르고, 저장은 입력 때만, 첫 손절 기록부터 고정한다', () => {
  const state = {tab: 'rebuy', rebuy: {items: [{id: 'a', name: '가상국내ETF', ticker: '900001', lowPrice: 10000, shares: 80, stepPct: 1, sellPct: 1}]}};
  const {ctx, els, listeners, assetStore, items, rules} = ui(state);
  const hold = () => vm.runInContext('holdShares(rebuyPick())', ctx);
  assert.match(rules(), /이탈 전 보유<small class="auto-tag">\(자산 배분\)<\/small><\/span><input id="rHold" type="text" value="150주"[^>]*readonly/);
  assert.match(rules(), /자산 배분 보유\(2개 계좌 150주\)를 불러옵니다/);
  assert.match(els.rebuyMain.innerHTML, /<div class="fr-count" title="이탈 전 보유 150주"><b>150<\/b><span>\/ 150주<\/span>/, '보유 카드에 이탈 전 보유');
  assert.doesNotMatch(els.rebuyMain.innerHTML, /<span>이탈 전 /, '기준 줄에는 카드와 같은 이탈 전 보유를 다시 적지 않는다');
  assert.equal(hold(), 150, '계산도 자산 배분 보유');
  assert.equal(items()[0].shares, 80, '그리기만 해서는 저장하지 않는다');
  vm.runInContext('editRebuy()', ctx);
  assert.equal(items()[0].shares, 150, '입력 때 저장값을 맞춘다(수집 작업 알림용)');
  items()[0].cuts = [{shares: 2, price: 9900}];
  assetStore.doc.allocation.groups[1].items[0].shares = 28; // 손절이 자산 배분에 반영된 뒤
  listeners[0]('change');
  assert.equal(hold(), 150, '기록 뒤에는 저장한 값으로 고정');
  assert.match(rules(), /이탈 전 보유<small class="auto-tag">\(고정\)<\/small><\/span><input id="rHold" type="text" value="150주"/);
  assert.match(els.rebuyMain.innerHTML, /<div class="fr-count" title="이탈 전 보유 150주\(고정\)"><b>148<\/b><span>\/ 150주<\/span>/);
  vm.runInContext('editRebuy()', ctx);
  assert.equal(items()[0].shares, 150, '기록이 있으면 입력 때도 바꾸지 않는다');
  items()[0].cuts = [];
  assert.equal(hold(), 148, '기록을 모두 지우면 다시 자산 배분 보유를 따른다');
});

test('기준 입력: 자산 배분에 없는 종목은 저장된 보유로 계산하고 등록을 안내한다', () => {
  const {rules} = ui({rebuy: {items: [{id: 'a', name: '없는 종목', ticker: '900099', lowPrice: 10000, amount: 1000}]}});
  assert.match(rules(), /<input id="rHold" type="text" value="1,000만원 ≈ 1,000주"/);
  assert.match(rules(), /자산 배분에 이 종목 코드의 보유가 없어 저장된 보유로 계산합니다/);
  const none = ui({rebuy: {items: [{id: 'a', name: '없는 종목', ticker: '900099', lowPrice: 10000}]}});
  assert.match(none.rules(), /<input id="rHold" type="text" value="" placeholder="자산 배분 보유 없음"/);
  assert.match(none.els.rebuyMain.innerHTML, /손절 수량을 계산할 수 없습니다/, '보유가 없으면 본 화면 보유 카드에서도 안내');
});

test('자산 쪽 보유가 바뀌면 재매수 화면을 다시 그려 자산 배분 줄·이탈 전 보유에 바로 반영한다 (입력 중에는 건너뜀)', () => {
  const state = {tab: 'rebuy', rebuy: {items: [{id: 'a', name: '가상국내ETF', ticker: '900001', lowPrice: 10000, shares: 80}]}};
  const {ctx, els, listeners, assetStore} = ui(state);
  assert.equal(listeners.length, 1);
  assert.match(els.rebuyMain.innerHTML, /150주/, '두 계좌 합계 150주를 이탈 전 보유로');
  assetStore.doc.allocation.groups[1].items[0].shares = 50;
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /170주/, '자산 변경이 바로 반영');
  assetStore.doc.allocation.groups[1].items[0].shares = 10;
  ctx.document.activeElement = {tagName: 'INPUT', type: 'number'};
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /170주/, '입력 중에는 다시 그리지 않는다');
  ctx.document.activeElement = {tagName: 'INPUT', type: 'number', readOnly: true};
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /130주/, '읽기 전용 칸을 눌러 둔 것은 입력 중이 아니다');
  assetStore.doc.allocation.groups[1].items[0].shares = 50;
  ctx.document.activeElement = null; ctx.state.tab = 'plans';
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /130주/, '다른 탭이 열려 있으면 그리지 않는다');
  ctx.state.tab = 'rebuy';
  listeners[0]('sync');
  assert.match(els.rebuyMain.innerHTML, /130주/, '무관한 알림에는 다시 그리지 않는다');
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /title="이탈 전 보유 170주"/);
});

test('가져오기 변환: 수량 합이 없으면 평가액(미국은 환율로 달러 환산), 값이 없으면 null', () => {
  const {ctx} = ui();
  const conv = (h, usd) => plain(ctx.rebuyHoldFromAlloc(h, usd));
  assert.deepEqual(conv({shares: 10, value: 5, fx: 1400}, false), {unit: 'shares', value: 10});
  assert.deepEqual(conv({shares: null, value: 300, fx: 1400}, false), {unit: 'amount', value: 300});
  assert.deepEqual(conv({shares: null, value: 140, fx: 1400}, true), {unit: 'amount', value: 1000});
  assert.equal(conv({shares: null, value: 0, fx: 1400}, false), null);
  assert.equal(conv(null, false), null);
  assert.equal(conv({shares: null, value: 100, fx: 0}, true), null, '환율이 없으면 달러 환산 불가');
});

// 가상 계좌 두 곳(가상계좌A 120주·가상계좌B 30주)에 같은 코드(900001)를 둔 재매수 종목. 손절 1회는 자산 배분 미반영, 2회는 B 계좌에 반영(보유 수량은 고정한 가상 값).
const accountFixture = () => {
  const alloc = allocation();
  alloc.trades = {'cut:a:1': {label: '가상국내ETF 손절 2회', at: '2026-01-02T00:00:00.000Z', qty: 3, price: 9800, value: null, items: [{id: 'i7', shares: -3}]}};
  const state = {tab: 'rebuy', rebuy: {items: [{id: 'a', name: '가상국내ETF', ticker: '900001', lowPrice: 10000, shares: 150, stepPct: 1, sellPct: 1, cuts: [{shares: 2, price: 9900}, {shares: 3, price: 9800}]}]}};
  return {alloc, state, prices: {stocks: {'900001': {kind: '국내', close: 10000, asOf: '2026-01-02'}}}};
};
const accountLine = (html, kind) => (html.match(new RegExp(`<div class="purchase-buy-target rebuy-account" data-rebuy-account="${kind}"[^>]*>.*?</div></div>`)) || [''])[0];

test('손절·재매수 계좌: 1·2 표 위에 체크할 때 먼저 고를 계좌와 근거를, 회차 아래에 다른 계좌·미반영 기록을 보인다 (읽기만)', () => {
  const {alloc, state, prices} = accountFixture(), before = JSON.stringify([state, alloc]);
  const {els, ctx} = ui(state, {alloc, prices, real: true}), html = els.rebuyMain.innerHTML;
  const cut = accountLine(html, 'cut'), buy = accountLine(html, 'buy');
  assert.match(cut, /<span>손절 계좌<\/span><div><b>가상국내ETF\(B\)<\/b><small>가상계좌B · 30주 보유 · 최근 손절 계좌<\/small>/, '최근 손절을 반영한 계좌');
  assert.match(cut, /title="같은 종목 코드 계좌 2개 중 체크하면 이 계좌가 먼저 선택됩니다"/);
  assert.match(buy, /<span>재매수 계좌<\/span><div><b>가상국내ETF\(B\)<\/b><small>가상계좌B · 30주 보유 · 손절한 계좌<\/small>/, '재매수 기록이 없으면 손절한 계좌');
  assert.ok(html.indexOf(cut) < html.indexOf('id="rebuyCutRows"') && html.indexOf('id="rebuyBuyTable"') < html.indexOf(buy), '각 표 위');
  const rows = html.split('<div class="purchase-row').slice(1);
  assert.match(rows[0], /data-cut="0"[\s\S]*<div class="purchase-sub">자산 배분 미반영<\/div><\/div>/, '반영 기록이 없는 손절 회차');
  assert.doesNotMatch(rows[1], /purchase-sub/, '표 위 계좌와 같은 계좌에 반영한 회차는 반복하지 않는다');
  assert.doesNotMatch(rows[2], /purchase-sub/, '아직 체결하지 않은 회차에는 계좌 줄이 없다');
  assert.equal(JSON.stringify([state, alloc]), before, '그리기만 해서는 재매수·자산 기록을 바꾸지 않는다');

  // 체크하면 계좌 고르는 창도 같은 계좌를 먼저 고른다.
  vm.runInContext('applyRebuyCut(2,{shares:1,price:9700})', ctx);
  assert.equal(els.linkDialog.open, true);
  assert.match(els.linkRows.innerHTML, /<div class="link-row picked"><button[^>]*><strong>가상국내ETF\(B\)<\/strong>/);
  assert.doesNotMatch(els.linkRows.innerHTML, /<div class="link-row picked"><button[^>]*><strong>가상국내ETF<\/strong>/);
});

test('손절·재매수 계좌: 반영 기록이 없으면 평가액이 가장 큰 계좌, 재매수 기록이 있으면 그 계좌이며 다른 계좌에 반영한 회차는 계좌를 적는다', () => {
  const {alloc, state, prices} = accountFixture();
  delete alloc.trades;
  let t = ui(state, {alloc, prices, real: true});
  assert.match(accountLine(t.els.rebuyMain.innerHTML, 'cut'), /<b>가상국내ETF<\/b><small>가상계좌A · 120주 보유 · 평가액이 가장 큰 계좌<\/small>/);
  assert.equal((t.els.rebuyMain.innerHTML.match(/자산 배분 미반영/g) || []).length, 2, '두 손절 모두 미반영');

  alloc.trades = {'cut:a:0': {label: '손절 1회', at: '2026-01-01T00:00:00.000Z', qty: 2, price: 9900, items: [{id: 'i1', shares: -2}]},
    'cut:a:1': {label: '손절 2회', at: '2026-01-02T00:00:00.000Z', qty: 3, price: 9800, items: [{id: 'i7', shares: -3}]}};
  t = ui(state, {alloc, prices, real: true});
  const rows = t.els.rebuyMain.innerHTML.split('<div class="purchase-row').slice(1);
  assert.match(rows[0], /<div class="purchase-sub">가상국내ETF 2주<\/div>/, '표 위 계좌(B)와 다른 계좌(A)에 반영한 회차');
  const prefer = kind => vm.runInContext(`rebuyPrefer({id:'a'},'${kind}')`, t.ctx);
  const account = prefer => plain(vm.runInContext(`(()=>{const a=allocLink.account({ticker:'900001',prefer:${JSON.stringify(prefer)}});return a&&{id:a.it.id,by:a.by,count:a.count};})()`, t.ctx));
  assert.deepEqual(account(prefer('buy')), {id: 'i7', by: 1, count: 2});
  alloc.trades['rebuy:a:25선:0'] = {label: '25선 1차 재매수', at: '2026-01-03T00:00:00.000Z', qty: 1, price: 10100, items: [{id: 'i1', shares: 1}]};
  assert.deepEqual(account(prefer('buy')), {id: 'i1', by: 0, count: 2}, '최근 재매수 계좌');
  assert.deepEqual(account(prefer('cut')), {id: 'i7', by: 0, count: 2}, '손절은 재매수 기록과 무관하게 최근 손절 계좌');
  assert.equal(plain(vm.runInContext(`allocLink.account({ticker:'900099',prefer:[]})`, t.ctx)), null, '연결 계좌가 없으면 null');
  assert.deepEqual(plain(vm.runInContext(`allocLink.reflected('cut:a:9')`, t.ctx)), [], '반영 기록 없음');
  assert.deepEqual(plain(vm.runInContext(`allocLink.reflected('cut:a:1').map(x=>[x.g.name,x.it.id,x.shares])`, t.ctx)), [['가상계좌B', 'i7', -3]]);
});

test('손절·재매수 계좌: 자산 배분에 연결 계좌가 없으면 계좌 줄·미반영 표시를 하지 않고, 수정 창은 같은 코드 계좌들을 안내한다', () => {
  const {alloc, state, prices} = accountFixture();
  state.rebuy.items[0].ticker = '900099';
  const t = ui(state, {alloc, prices, real: true});
  assert.doesNotMatch(t.els.rebuyMain.innerHTML, /rebuy-account|자산 배분 미반영/);

  const {alloc: a2, state: s2} = accountFixture();
  const u = ui(s2, {alloc: a2, prices, real: true});
  u.els.rEdit.onclick();
  assert.equal(u.form.elements.holding.value, '');
  assert.equal(u.els.rebuyHoldingHint.hidden, false);
  assert.match(u.els.rebuyHoldingHint.textContent, /같은 종목 코드의 자산 배분 계좌 2개\(가상국내ETF, 가상국내ETF\(B\)\)의 보유를 함께 봅니다/);
  u.pick('i1');
  assert.match(u.els.rebuyHoldingHint.textContent, /자산 배분 보유 \(같은 코드 계좌 2개 합계\) 150주를/);
});
