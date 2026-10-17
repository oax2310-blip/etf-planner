const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refsOf = text => [...text.matchAll(/(?:href|src)="((?:css|js)\/[^"?]+)\?v=(\d+)"/g)];
const refs = refsOf(html);
const scripts = refs.map(r => r[1]).filter(f => f.startsWith('js/'));
// 자산 현황 페이지(assets.html)는 theme.js·app.css를 같이 쓰고 자기 css·js를 따로 불러온다
const assetRefs = refsOf(fs.readFileSync(path.join(root, 'assets.html'), 'utf8'));
const assetScripts = assetRefs.map(r => r[1]).filter(f => f.startsWith('js/'));
const valuationHtml = fs.readFileSync(path.join(root, 'valuation.html'), 'utf8');
const valuationRefs = refsOf(valuationHtml);
const valuationScripts = valuationRefs.map(r => r[1]).filter(f => f.startsWith('js/'));

test('index.html이 css·js 파일을 빠짐없이 같은 버전(?v=)으로 불러온다', () => {
  assert.equal(new Set([...refs, ...assetRefs, ...valuationRefs].map(r => r[2])).size, 1, '세 HTML의 모든 ?v= 숫자가 같아야 한다');
  for (const [, f] of [...refs, ...assetRefs, ...valuationRefs]) assert.ok(fs.existsSync(path.join(root, f)), `${f} 파일이 없다`);
  const onDisk = ['css', 'js'].flatMap(d => fs.readdirSync(path.join(root, d)).map(f => `${d}/${f}`));
  assert.deepEqual([...new Set([...refs, ...assetRefs, ...valuationRefs].map(r => r[1]))].sort(), onDisk.sort(), '세 HTML에서 불러오지 않는 파일이 있다');
  assert.deepEqual(assetScripts, ['js/theme.js', 'js/repo-security.js', 'js/ma-ladder.js', 'js/data-validation.js', 'js/assets-calc.js', 'js/price-collection.js', 'js/assets-store.js', 'js/member-link.js', 'js/ledger-benchmark.js', 'js/assets.js', 'js/assets-ledger.js', 'js/assets-savings.js', 'js/assets-installments.js', 'js/assets-start.js'], 'assets.html은 공유 수집 함수를 assets-store보다 먼저, 첫 화면(assets-start.js)은 모든 탭 파일 다음에 불러온다');
  assert.ok(assetRefs.some(r => r[1] === 'css/app.css'), 'assets.html도 공통 토큰(css/app.css)을 불러야 한다');
  assert.equal(scripts[0], 'js/theme.js', '화면 모드(theme.js)는 head에서 가장 먼저 불러야 첫 화면 색이 맞는다');
  assert.deepEqual(scripts.slice(2, 7), ['js/ma-ladder.js', 'js/data-validation.js', 'js/core.js', 'js/price-collection.js', 'js/sync.js'], '공유 수집 함수를 sync보다 먼저 불러와야 한다');
  assert.deepEqual(valuationScripts, ['js/theme.js', 'js/repo-security.js', 'js/valuation.js', 'js/currency-pressure.js'], '시나리오 계산·통화강도는 시나리오에만 불러온다');
  const valuation = fs.readFileSync(path.join(root, 'valuation.html'), 'utf8');
  assert.deepEqual([...valuation.matchAll(/src="js\/theme\.js\?v=(\d+)"/g)].map(r => r[1]), [refs[0][2]], 'valuation.html도 같은 버전의 theme.js를 한 번 불러야 한다');
});

test('분할매수·분할매도·재매수 계획 창은 같은 종목 검색(item-search.js)을 쓴다', () => {
  for (const f of ['js/purchases.js', 'js/plans.js', 'js/rebuy.js']) {
    assert.ok(scripts.indexOf('js/item-search.js') >= 0 && scripts.indexOf('js/item-search.js') < scripts.indexOf(f), `item-search.js를 ${f}보다 먼저 불러야 한다`);
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /itemSearch\.create\(/, `${f}는 공통 검색 칸을 만든다`);
  }
  for (const [dialog, host] of [['purchaseDialog', 'purchaseItemSearch'], ['planDialog', 'planItemSearch'], ['rebuyDialog', 'rebuyItemSearch']]) {
    const body = html.slice(html.indexOf(`<dialog id="${dialog}"`), html.indexOf('</dialog>', html.indexOf(`<dialog id="${dialog}"`)));
    assert.match(body, new RegExp(`<div class="item-search" id="${host}"></div>`), `${dialog}에 검색 칸 자리가 있다`);
  }
  assert.doesNotMatch(html, /type="search"|class="purchase-pick"|id="planAllocTicker"|<select name="holding"/, '검색 입력·목록은 index.html에 따로 두지 않는다');
});

test('js 파일을 차례로 이어도 문법 오류·겹치는 맨 위 이름이 없다', () => {
  // 일반 <script>는 맨 위 이름을 함께 쓰므로, 이어 붙여 한 번에 해석하면 겹치는 const·let이 오류로 드러난다.
  for (const list of [scripts, assetScripts, valuationScripts])
    assert.doesNotThrow(() => new vm.Script(list.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n')));
});

test('토큰을 쓰는 세 페이지는 같은 보안 정책(CSP)을 맨 앞에 두고 초기화 script만 해시로 허용한다', () => {
  const crypto = require('node:crypto');
  const policies = [];
  for (const name of ['index.html', 'assets.html', 'valuation.html']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    const metas = [...text.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/g)];
    assert.equal(metas.length, 1, `${name}에 CSP meta가 하나 있어야 한다`);
    const head = text.slice(text.indexOf('<head>'), metas[0].index);
    assert.doesNotMatch(head, /<script|<link|<style/, `${name}의 CSP는 script·link·style보다 먼저 와야 적용된다`);
    const policy = Object.fromEntries(metas[0][1].split(';').map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    const hashes = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    assert.deepEqual(policy['script-src'], ["'self'", ...hashes], `${name}: 초기화 script를 고치면 CSP 해시도 바꾼다(그 밖의 인라인·외부 script 금지)`);
    assert.deepEqual(policy['default-src'], ["'none'"]);
    assert.deepEqual(policy['connect-src'], ["'self'", 'https://api.github.com'], '토큰은 이 사이트와 GitHub API로만 보낸다');
    assert.deepEqual(policy['img-src'], ["'self'", 'data:'], 'CSS·주입 이미지로 외부 주소에 값을 보내지 못하게 한다');
    for (const k of ['base-uri', 'object-src']) assert.ok(policy[k], `${name}: ${k} 필요`);
    assert.doesNotMatch(text, /\son[a-z]+="/, `${name}: 인라인 이벤트 속성은 CSP에 막힌다`);
    policies.push(JSON.stringify({...policy, 'script-src': policy['script-src'].slice(0, 1)}));
  }
  assert.equal(new Set(policies).size, 1, '세 페이지의 정책은 초기화 script 해시만 다르다');
});
