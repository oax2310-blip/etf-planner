// 실제 자산 파일의 임시 복사본에서 CLI를 실행한다. 저장소의 ?v=는 바꾸지 않는다.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'scripts/bump-asset-version.cjs');
const files = ['index.html', 'assets.html', 'valuation.html', 'push-sw.js'];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bump asset version-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const name of files) fs.copyFileSync(path.join(repo, name), path.join(root, name));
  return root;
}
const readFiles = root => Object.fromEntries(files.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
const versionOf = contents => contents['index.html'].match(/src="js\/theme\.js\?v=(\d+)"/)[1];
const run = (entry, args) => spawnSync(process.execPath, [entry, ...args], {cwd: os.tmpdir(), encoding: 'utf8'});

test('기본 루트와 --root에서 네 파일의 모든 로컬 ?v=를 함께 +1 한다', t => {
  for (const useRoot of [false, true]) {
    const root = fixture(t), before = readFiles(root), current = versionOf(before);
    const next = String(BigInt(current) + 1n);
    let entry = script;
    if (!useRoot) {
      fs.mkdirSync(path.join(root, 'scripts'));
      entry = path.join(root, 'scripts/bump-asset-version.cjs');
      fs.copyFileSync(script, entry);
    }
    const result = run(entry, useRoot ? ['--root', root] : []);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `${current} → ${next}`);
    const after = readFiles(root);
    for (const name of files) {
      assert.notEqual(after[name], before[name], `${name}의 버전도 올린다`);
      assert.equal(after[name], before[name].replaceAll(`?v=${current}"`, `?v=${next}"`), name);
    }
  }
});

test('--check는 현재 버전과 일치를 출력하고 파일을 쓰지 않는다', t => {
  const root = fixture(t), before = readFiles(root);
  const oldTime = new Date('2000-01-01T00:00:00Z');
  for (const name of files) fs.utimesSync(path.join(root, name), oldTime, oldTime);
  const result = run(script, ['--check', '--root', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `${versionOf(before)} (일치)`);
  assert.deepEqual(readFiles(root), before);
  for (const name of files) assert.equal(fs.statSync(path.join(root, name)).mtimeMs, oldTime.getTime(), name);
});

test('어느 파일에서든 버전이 섞이면 일반 실행·--check 모두 코드 1로 끝나고 모든 파일을 보존한다', t => {
  for (const name of files) {
    const root = fixture(t), contents = readFiles(root), current = versionOf(contents);
    fs.writeFileSync(path.join(root, name), contents[name].replace(`?v=${current}"`, `?v=${BigInt(current) + 1n}"`));
    const before = readFiles(root);
    for (const args of [[], ['--check']]) {
      const result = run(script, ['--root', root, ...args]);
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, /버전 불일치/);
      assert.ok(result.stderr.includes(name), '불일치 파일을 출력한다');
      assert.ok(result.stderr.includes(current) && result.stderr.includes(String(BigInt(current) + 1n)), '서로 다른 값을 출력한다');
      assert.deepEqual(readFiles(root), before, `${name}: 어느 파일도 바꾸지 않는다`);
    }
  }
});

test('Pretendard·외부 URL·대상 밖의 참조와 다른 숫자는 그대로 둔다', t => {
  const root = fixture(t), before = readFiles(root), current = versionOf(before);
  const next = String(BigInt(current) + 1n);
  const html = `
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<link href="https://cdn.example.test/css/vendor.css?v=${current}">
<script src="//cdn.example.test/js/vendor.js?v=999"></script>
<img src="images/icon.svg?v=${current}">
<div data-src="js/deferred.js?v=${current}" data-href="css/deferred.css?v=998" data-year="2026"></div>
<a href="js/example.js?v=${current}&mode=1">2026</a>
`;
  const worker = `
importScripts("https://cdn.example.test/js/vendor.js?v=${current}", "//cdn.example.test/js/vendor.js?v=999");
const year = 2026, stylesheet = "css/app.css?v=${current}", icon = "images/icon.svg?v=${current}";
`;
  for (const name of files) fs.appendFileSync(path.join(root, name), name === 'push-sw.js' ? worker : html);
  const result = run(script, ['--root', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `${current} → ${next}`);
  const after = readFiles(root);
  for (const name of files) {
    assert.equal(after[name], before[name].replaceAll(`?v=${current}"`, `?v=${next}"`) + (name === 'push-sw.js' ? worker : html), name);
  }
});
