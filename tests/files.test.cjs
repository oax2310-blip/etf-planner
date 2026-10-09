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

test('index.html이 css·js 파일을 빠짐없이 같은 버전(?v=)으로 불러온다', () => {
  assert.equal(new Set([...refs, ...assetRefs].map(r => r[2])).size, 1, '모든 ?v= 숫자가 같아야 한다(css·js를 고치면 index.html·assets.html에서 같이 올림)');
  for (const [, f] of [...refs, ...assetRefs]) assert.ok(fs.existsSync(path.join(root, f)), `${f} 파일이 없다`);
  const onDisk = ['css', 'js'].flatMap(d => fs.readdirSync(path.join(root, d)).map(f => `${d}/${f}`));
  assert.deepEqual([...new Set([...refs, ...assetRefs].map(r => r[1]))].sort(), onDisk.sort(), 'index.html·assets.html에서 불러오지 않는 파일이 있다');
  assert.deepEqual(assetScripts, ['js/theme.js', 'js/ma-ladder.js', 'js/assets-calc.js', 'js/price-collection.js', 'js/assets-store.js', 'js/assets.js'], 'assets.html은 공유 수집 함수를 assets-store보다 먼저 불러온다');
  assert.ok(assetRefs.some(r => r[1] === 'css/app.css'), 'assets.html도 공통 토큰(css/app.css)을 불러야 한다');
  assert.equal(scripts[0], 'js/theme.js', '화면 모드(theme.js)는 head에서 가장 먼저 불러야 첫 화면 색이 맞는다');
  assert.deepEqual(scripts.slice(1, 5), ['js/ma-ladder.js', 'js/core.js', 'js/price-collection.js', 'js/sync.js'], '공유 수집 함수를 sync보다 먼저 불러와야 한다');
  const valuation = fs.readFileSync(path.join(root, 'valuation.html'), 'utf8');
  assert.deepEqual([...valuation.matchAll(/src="js\/theme\.js\?v=(\d+)"/g)].map(r => r[1]), [refs[0][2]], 'valuation.html도 같은 버전의 theme.js를 한 번 불러야 한다');
});

test('js 파일을 차례로 이어도 문법 오류·겹치는 맨 위 이름이 없다', () => {
  // 일반 <script>는 맨 위 이름을 함께 쓰므로, 이어 붙여 한 번에 해석하면 겹치는 const·let이 오류로 드러난다.
  for (const list of [scripts, assetScripts])
    assert.doesNotThrow(() => new vm.Script(list.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n')));
});
