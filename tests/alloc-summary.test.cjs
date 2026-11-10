const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 투자구성·자산 배분 맨 위 요약(기준 총자산 · 지역 구성 막대 · 합계·시세·환율 안내). assets.js를 가상 DOM으로 불러 그리며 종목·금액·시세는 모두 테스트용 가짜 값이다.
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
// 요약 카드만: <section class="card alloc-summary"> … </section>
const summary = html => { const start = html.indexOf('<section class="card alloc-summary"'); assert.ok(start >= 0, '요약 카드'); return html.slice(start, html.indexOf('</section>', start)); };
const day = ago => { const d = new Date(Date.now() - ago * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const md = iso => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`;
const quotes = fx => ({updatedAt: '2026-01-02T06:40:00.000Z', stocks: {}, fx});
const classes = [{id: 'us', region: '미국', name: '주식'}, {id: 'kr', region: '국내', name: '주식'}, {id: 'cash', region: '현금', name: '현금', cash: true}];
const group = (id, classId, amount) => ({id, name: `그룹 ${id}`, classId, items: [{id: `i-${id}`, name: `종목 ${id}`, ticker: id.toUpperCase(), amount}]});
// 기준 총자산 1,000만원: 미국 400 · 국내 200 · 현금 100(원화) → 합계 700, 기준까지 300.
const alloc = (extra = {}) => ({version: 1, allocation: {savedAt: '', total: 1000, cashFx: null, memo: '', classes, groups: [group('a', 'us', 400), group('b', 'kr', 200)], cash: [{id: 'k', name: '예수금', amount: 1000000, currency: 'KRW'}], ...extra}});

test('요약 카드는 두 탭에 같은 모양으로 그리고 옛 세 칸 지표 카드·중복 시각·입력 칸 없는 label을 쓰지 않는다', () => {
  const strategy = page(alloc(), null), list = page(alloc(), null, '#alloc');
  assert.equal(summary(strategy), summary(list), '투자구성·자산 배분 공통');
  assert.match(strategy, /^<div class="heading alloc-heading"><h1>투자구성<\/h1><\/div>/);
  assert.match(list, /^<div class="heading alloc-heading"><h1>자산 배분<\/h1><\/div>/);
  for (const html of [strategy, list]) {
    assert.doesNotMatch(html, /class="card metrics"|class="metric"|class="eyebrow"|시세 파일/, '옛 카드·머리말·중복 시각 없음');
    assert.equal((html.match(/id="allocTotal"/g) || []).length, 1);
    assert.deepEqual(html.match(/<label(?: [^>]*)?>/g).filter(tag => !/for="|class="(?:metric-edit|field|check)/.test(tag)), [], '입력 칸에 연결되지 않은 label 없음');
  }
  const card = summary(strategy);
  assert.match(card, /<label for="allocTotal">기준 총자산<\/label><span>투자 600만원 · 현금 100만원<\/span>/);
  assert.match(card, /<span class="alloc-total-size" data-value="1,000만원"><input id="allocTotal"[^>]*value="1,000만원"[^>]*aria-describedby="allocTotalHint"><\/span>/);
  assert.doesNotMatch(card, /<input[^>]*style=/, '입력 칸 너비를 글자 수로 어림하지 않는다');
  assert.match(card, /<small class="alloc-total-hint" id="allocTotalHint">억·만원으로 입력 · 숫자만 넣으면 만원 · 비우면 종목 \+ 현금 합계 기준<\/small>/);
  assert.match(card, /<span>종목 \+ 현금 합계 700만원 · 기준보다 300만원 적음<\/span><span>시세 반영 0 \/ 2개 · 달러 환율 없음<\/span>/);
  assert.match(strategy, /<p class="footnote">목표 비중은 자산 배분의 종목에서 수정하면 소분류·그룹·분류에 자동 합산됩니다\. 모든 목표 비중은 기준 총자산 대비입니다\./, '제목 아래 설명은 맨 아래 안내로');
  assert.match(list, /<p class="footnote">금액은 만원 단위, 비중은 기준 총자산 대비입니다\. 종목 이름을 눌러 목표를 수정하세요\./);
});

test('지역 구성 막대는 금액 비례 칸·기준 대비 %·남은 기준 칸을 그리고 범례는 칸 순서의 이름만 둔다', () => {
  const card = summary(page(alloc(), null));
  assert.match(card, /<div class="region-bar" role="img" aria-label="지역 구성: 미국 40%, 국내 20%, 현금 10%, 기준까지 30%">/);
  assert.deepEqual([...card.matchAll(/<i class="([^"]+)" style="flex:([\d.]+)" title="([^"]+)">(?:<span[^>]*>([^<]+)<\/span>)?<\/i>/g)].map(m => m.slice(1)),
    [['region-1', '400', '미국 400만원 · 40%', '40%'], ['region-2', '200', '국내 200만원 · 20%', '20%'], ['region-4', '100', '현금 100만원 · 10%', '10%'], ['rest', '300', '기준까지 300만원 · 30%', '30%']]);
  assert.match(card, /<ul class="region-legend" aria-hidden="true"><li><i class="region-1"><\/i>미국<\/li><li><i class="region-2"><\/i>국내<\/li><li><i class="region-4"><\/i>현금<\/li><li><i class="rest"><\/i>기준까지<\/li><\/ul>/);
});

test('기준을 비우거나 합계가 기준을 넘으면 남은 기준 칸이 없고 안내 문구가 바뀐다', () => {
  const unset = summary(page(alloc({total: null}), null));
  assert.doesNotMatch(unset, /class="rest"|기준까지/);
  assert.match(unset, /data-value="700만원"><input id="allocTotal"[^>]*value=""[^>]*placeholder="700만원"/);
  assert.match(unset, /종목 \+ 현금 합계 700만원 · 기준 미입력 · 합계 기준/);
  assert.match(unset, /aria-label="지역 구성: 미국 57\.1%, 국내 28\.6%, 현금 14\.3%"/);
  const over = summary(page(alloc({total: 500}), null));
  assert.doesNotMatch(over, /class="rest"|기준까지/);
  assert.match(over, /종목 \+ 현금 합계 700만원 · 기준보다 200만원 많음/);
  assert.match(over, /<i class="region-1" style="flex:400" title="미국 400만원 · 80%"><span>80%<\/span><\/i>/, '칸 안 숫자는 기준 총자산 대비');
  assert.match(summary(page(alloc({total: 700}), null)), /종목 \+ 현금 합계 700만원 · 기준과 같음/);
  // 합계의 긴 소수는 placeholder에 그대로 보이지 않는다.
  const odd = summary(page(alloc({total: null, groups: [group('a', 'us', 123.456789)], cash: []}), null));
  assert.match(odd, /placeholder="123\.5만원"/);assert.match(odd, /data-value="123\.5만원"/);
});

test('지역 색은 지역에 고정하고 0 이하인 지역·좁은 칸 숫자·위험한 이름을 안전하게 처리한다', () => {
  const custom = n => ({id: `x${n}`, region: `지역${n}`, name: '분류'});
  const data = alloc({total: null, classes: [...classes, {id: 'etc', region: '기타', name: '기타'}, custom(1), custom(2), custom(3), {id: 'bad', region: '<b>"x"</b>', name: '분류'}],
    groups: [group('b', 'kr', 200), group('e', 'etc', 0), group('c1', 'x1', 100), group('c2', 'x2', 100), group('c3', 'x3', 8), group('z', 'bad', 100)],
    cash: [{id: 'k', name: '증거금', amount: 500000, currency: 'KRW', minus: true}]});
  const card = summary(page(data, null));
  const cells = [...card.matchAll(/<i class="([^"]+)" style="flex:([\d.]+)"/g)].map(m => `${m[1]}:${m[2]}`);
  assert.deepEqual(cells, ['region-2:200', 'region-7:100', 'region-8:100', 'region-x:8', 'region-x:100'], '미국(없음)·현금(음수)·기타(0)는 그리지 않고 나머지 색은 그대로');
  assert.match(card, /<i class="region-x" style="flex:8" title="지역3 8만원 · 1\.7%"><\/i>/, '막대의 5% 미만 칸에는 숫자를 넣지 않는다');
  assert.doesNotMatch(card, /<b>"x"<\/b>/);assert.match(card, /&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(card, /음수|NaN|undefined/);
  const empty = summary(page(alloc({total: null, groups: [], cash: []}), null));
  assert.doesNotMatch(empty, /region-bar|region-legend/, '자산이 없으면 막대를 그리지 않는다');
  assert.match(empty, /종목 \+ 현금 합계 0만원 · 기준 미입력 · 합계 기준/);
  assert.match(summary(page(alloc({groups: [group('a', 'us', 95)], cash: []}), null)), /<span class="s">10%<\/span>|<span>10%<\/span>/);
  assert.match(summary(page(alloc({groups: [group('a', 'us', 90)], cash: []}), null)), /<i class="region-1"[^>]*><span class="s">9%<\/span><\/i>/, '두 글자 숫자는 더 좁은 칸까지 보인다');
});

test('달러 환율 안내: 현물 기준일을 월/일로 붙이고 기준일이 없거나 오래되면 경고 꼬리표를 붙인다', () => {
  const usd = {cash: [{id: 'k', name: '달러', amount: 100, currency: 'USD'}]}, fresh = day(1), old = day(9);
  for (const hash of ['#strategy', '#alloc']) {
    const ok = page(alloc(usd), quotes({close: 1400, asOf: fresh}), hash);
    assert.ok(ok.includes(`<span class="nowrap">환율 1,400원 (현물 ${md(fresh)})</span>`), `${hash} 기준일 표시, 경고 없음`);
    assert.doesNotMatch(ok, /quote-status/);
    const stale = page(alloc(usd), quotes({close: 1400, asOf: old}), hash);
    assert.ok(stale.includes(`환율 1,400원 (현물 ${md(old)})<span class="quote-status" title="현물 환율이 3일 넘게 갱신되지 않았습니다. 마지막 기준일: ${old}"><span aria-hidden="true">!</span> 갱신 필요</span></span>`), `${hash} 오래된 환율 경고`);
    for (const asOf of [undefined, null, '', '2026-01', 20260102, 'x', '<b>']) {
      const html = page(alloc(usd), quotes({close: 1400, asOf}), hash);
      assert.ok(html.includes('환율 1,400원 (현물)<span class="quote-status" title="현물 환율 기준일을 확인할 수 없습니다. 오래된 환율일 수 있습니다."><span aria-hidden="true">!</span> 기준일 없음</span></span>'), `${hash} 기준일 ${asOf}`);
      assert.doesNotMatch(html, /NaN/, `${hash} 기준일 ${asOf}: NaN을 보이지 않는다`);
      assert.doesNotMatch(summary(html), /<b>/, `${hash} 기준일 ${asOf}: 깨진 기준일 원문을 넣지 않는다`);
    }
  }
  const card = summary(page(alloc(usd), quotes({close: 1400, asOf: fresh})));
  assert.ok(card.includes(`<span>시세 반영 0 / 2개 · 달러 $100 · <span class="nowrap">환율 1,400원 (현물 ${md(fresh)})</span></span>`), '달러 현금이 있으면 금액 뒤에 환율');
  assert.match(page(alloc(usd), quotes({close: 1400, asOf: fresh}), '#alloc'), /<h2>현금<\/h2><span>달러 <span class="nowrap">환율 1,400원/, '현금 구역 제목 옆에도 같은 안내');
  const manual = page(alloc({...usd, cashFx: 1300}), null);
  assert.match(manual, /달러 \$100 · <span class="nowrap">환율 1,300원 \(직접 넣은 값\)<\/span>/, '직접 넣은 환율');
  assert.doesNotMatch(manual, /quote-status/, '직접 넣은 환율은 경고 대상이 아니다');
  assert.match(page(alloc(usd), null), /달러 \$100 · 환율 없음/, '환율이 전혀 없을 때');
});
