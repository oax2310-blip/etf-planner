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

function ui(state = {}, {alloc = allocation(), link = true} = {}) {
  const els = {}, listeners = [];
  const el = id => els[id] ||= {id, value: '', textContent: '', innerHTML: '', hidden: undefined, focus() {}, reset() {}, showModal() { this.open = true; }, close() { this.open = false; },
    classList: {toggle() {}}, querySelectorAll: () => [], append() {}, setAttribute() {}, dataset: {}};
  const form = el('rebuyForm');
  form.elements = {name: {value: '', focus() {}}, ticker: {value: '', focus() {}}, holding: {value: ''}};
  form.reset = () => { form.elements.name.value = ''; form.elements.ticker.value = ''; form.elements.holding.value = ''; };
  // 검색 칸(item-search.js)이 만든 요소도 id로 찾는다.
  const document = {activeElement: null, createElement() { const e = {value: '', dataset: {}, setAttribute() {}, append() {}, focus() {}}; Object.defineProperty(e, 'id', {get: () => e._id, set(v) { e._id = v; els[v] = e; }}); return e; }};
  let n = 0, stored = null;
  const assetStore = {doc: {allocation: alloc}, prices: null, subscribe: fn => { listeners.push(fn); return () => {}; }};
  const ctx = vm.createContext({
    state, save() {}, $: el, $$: () => [], onEdit() {}, id: () => `id-${++n}`, PENCIL: '', confirm: () => true, document,
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
    money: v => `${v}원`, priceText: (v, c) => c === 'USD' ? `$${v}` : `${v}원`,
    usd: new Intl.NumberFormat('en-US'), won: new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 8}), decimal: new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1}),
    shown: v => String(v), memoCount: () => '', stockEntry: () => null, priceData: null, priceStamp: () => '', priceWarning: () => '', assetStore,
    ...(link ? {allocLink: {holding: ticker => { const s = linkSummaryOf(ctx, assetStore, ticker); return s; }, line: () => '', check() {}, uncheck() {}, forget() {}, rescale() {}}} : {}),
  });
  vm.runInContext(source, ctx);
  ctx.renderRebuy();
  // 목록 행·'변경' 누르기: 가짜 요소의 onclick에 closest가 그 속성을 찾는 대상을 넘긴다.
  const click = (node, attr, dataset = {}) => node.onclick({target: {closest: sel => sel.split(',').includes(`[${attr}]`) ? {dataset} : null}});
  const pick = itemId => click(els.rebuyItemList, 'data-pick', {pick: itemId});
  const repick = () => click(els.rebuyPicked, 'data-repick');
  return {ctx, els, form, listeners, assetStore, pick, repick, items: () => ctx.state.rebuy?.items || []};
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

test('수정 창: 이미 연결된 종목을 그대로 저장하면 직접 넣은 보유를 덮어쓰지 않고, 손절 기록이 있으면 다른 종목을 골라도 보유를 바꾸지 않는다', () => {
  const state = {rebuy: {items: [{id: 'a', name: '가상국내ETF', ticker: '900001', lowPrice: 10000, shares: 80}]}};
  const {els, form, items} = ui(state), f = form.elements;
  els.rEdit.onclick();
  assert.equal(f.holding.value, '', '같은 코드가 두 계좌에 있어 자동으로 하나를 고르지 않는다');
  assert.equal(els.rebuySearchBox.hidden, false); assert.doesNotMatch(els.rebuyItemList.innerHTML, /등록됨/, '수정 중인 종목은 등록 표시에서 제외');
  f.name.value = '이름만 수정'; form.onsubmit({preventDefault() {}});
  assert.deepEqual([items()[0].name, items()[0].shares], ['이름만 수정', 80], '선택을 바꾸지 않으면 보유는 그대로');

  const locked = {rebuy: {items: [{id: 'b', name: '손절 중', ticker: '900009', lowPrice: 10000, shares: 80, cuts: [{shares: 5, price: 9900}]}]}};
  const t = ui(locked); t.els.rEdit.onclick();
  t.pick('i1'); t.form.onsubmit({preventDefault() {}});
  assert.deepEqual([t.items()[0].ticker, t.items()[0].shares, t.items()[0].cuts.length], ['900001', 80, 1], '이름·코드만 바뀌고 이탈 전 보유는 그대로');
});

test('수정 창: 코드가 한 항목에만 있으면 그 보유 종목을 고른 상태로 보여 주고 그대로 저장하면 보유를 다시 쓰지 않는다', () => {
  const alloc = allocation(); alloc.groups[1].items = [];
  const {els, form, items} = ui({rebuy: {items: [{id: 'a', name: 'x', ticker: '900001', shares: 80}]}}, {alloc});
  els.rEdit.onclick();
  assert.equal(form.elements.holding.value, 'i1'); assert.equal(form.elements.ticker.readOnly, true);
  assert.equal(els.rebuyPicked.hidden, false); assert.match(els.rebuyPicked.innerHTML, /가상국내ETF/);
  form.onsubmit({preventDefault() {}});
  assert.equal(items()[0].shares, 80);
});

test('자산 쪽 보유가 바뀌면 재매수 화면을 다시 그려 자산 배분 줄·가져오기에 바로 반영한다 (입력 중에는 건너뜀)', () => {
  const state = {tab: 'rebuy', rebuy: {items: [{id: 'a', name: '가상국내ETF', ticker: '900001', lowPrice: 10000, shares: 80}]}};
  const {ctx, els, listeners, assetStore} = ui(state);
  assert.equal(listeners.length, 1);
  assert.match(els.rebuyMain.innerHTML, /150주/, '두 계좌 합계 150주를 가져오기로 안내');
  assetStore.doc.allocation.groups[1].items[0].shares = 50;
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /170주/, '자산 변경이 바로 반영');
  assetStore.doc.allocation.groups[1].items[0].shares = 10;
  ctx.document.activeElement = {tagName: 'INPUT', type: 'number'};
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /170주/, '입력 중에는 다시 그리지 않는다');
  ctx.document.activeElement = null; ctx.state.tab = 'plans';
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /170주/, '다른 탭이 열려 있으면 그리지 않는다');
  ctx.state.tab = 'rebuy';
  listeners[0]('sync');
  assert.match(els.rebuyMain.innerHTML, /170주/, '무관한 알림에는 다시 그리지 않는다');
  listeners[0]('change');
  assert.match(els.rebuyMain.innerHTML, /130주/);
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
