const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 투자구성·자산 배분 맨 위 요약(기준 총자산·투자 평가액·현금). assets.js를 가상 DOM으로 불러 그리며 종목·금액·시세는 모두 테스트용 가짜 값이다.
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function page(data, prices, hash = '#strategy') {
  const nodes = new Map(), storage = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, {dataset: {}, hidden: false, value: '', innerHTML: '', textContent: '', style: {}, classList: {toggle() {}}, querySelector: sel => node(`${id}:${sel}`), querySelectorAll: () => [], setAttribute() {}, getAttribute() {}, showModal() {}, close() {}}); return nodes.get(id); };
  const document = {hidden: false, activeElement: null, getElementById: node, querySelector: node, querySelectorAll: () => [], addEventListener() {}};
  const store = {doc: data, prices, status: {state: 'off'}, config: () => null, recovery: () => [], subscribe() {}, start() {}, saveSection() { throw Error('조회만으로 저장하면 안 된다'); }};
  const ctx = vm.createContext({document, assetStore: store, splitNotices: {initialize() {}}, URLSearchParams, crypto: require('node:crypto').webcrypto,
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v))}, addEventListener() {}, setInterval() {}, setTimeout: fn => { fn(); return 1; },
    location: {hash}, history: {replaceState() {}}, scrollTo() {}});
  vm.runInContext(['js/ma-ladder.js', 'js/data-validation.js', 'js/assets-calc.js', 'js/member-link.js', 'js/ledger-benchmark.js', 'js/money-input.js', 'js/assets.js', 'js/assets-ledger.js', 'js/assets-savings.js', 'js/assets-installments.js', 'js/assets-start.js'].map(read).join('\n;\n'), ctx);
  return node(hash.slice(1) + 'View').innerHTML;
}
const alloc = extra => ({version: 1, allocation: {savedAt: '', total: 1000, cashFx: null, memo: '', classes: [{id: 'c1', region: '미국', name: '주식'}, {id: 'c2', region: '현금', name: '현금', cash: true}],
  groups: [{id: 'g', name: '그룹', classId: 'c1', items: [{id: 'a', name: '종목 a', ticker: 'AAA', amount: 300}]}], cash: [{id: 'k', name: '달러', amount: 100, currency: 'USD'}], ...extra}});
const quotes = fx => ({updatedAt: '2026-01-02T06:40:00.000Z', stocks: {}, fx});

test('달러 환율 안내는 현물 기준일을 월/일로 붙이고, 기준일이 없거나 깨지면 날짜만 뺀다', () => {
  for (const hash of ['#strategy', '#alloc']) {
    assert.match(page(alloc(), quotes({close: 1400, asOf: '2026-01-02'}), hash), /달러 환율 1,400원 \(현물 1\/2\)/, `${hash} 기준일 표시`);
    for (const asOf of [undefined, null, '', '2026-01', 20260102, 'x']) {
      const html = page(alloc(), quotes({close: 1400, asOf}), hash);
      assert.match(html, /달러 환율 1,400원 \(현물\)/, `${hash} 기준일 ${asOf}`);
      assert.doesNotMatch(html, /NaN/, `${hash} 기준일 ${asOf}: NaN을 보이지 않는다`);
    }
  }
  assert.match(page(alloc({cashFx: 1300}), null), /달러 환율 1,300원 \(직접 넣은 값\)/, '시세 파일이 없으면 직접 넣은 환율');
  assert.match(page(alloc(), null), /달러 환율 없음/, '환율이 전혀 없을 때');
});
