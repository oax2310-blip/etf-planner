const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const pages = ['index.html', 'assets.html', 'valuation.html'];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const tags = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))]
  .map(([text]) => Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));

test('홈 화면 앱은 전체화면으로 열고 특정 탭·종목을 시작 주소에 고정하지 않는다', () => {
  assert.equal(manifest.display, 'fullscreen');
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.lang, 'ko');
  for (const key of ['start_url', 'scope']) {
    assert.equal(typeof manifest[key], 'string', key);
    assert.ok(manifest[key], key);
  }
  const base = new URL('https://example.test/etf-planner/manifest.webmanifest');
  const start = new URL(manifest.start_url, base);
  assert.equal(start.href, 'https://example.test/etf-planner/');
  assert.equal(start.search, '');
  assert.equal(start.hash, '');
});

test('앱 ID는 프로젝트 시작 주소를 쓰며 같은 출처의 다른 Pages 앱과 겹치지 않는다', () => {
  for (const prefix of ['/etf-planner/', '/preview/etf-planner/']) {
    const start = new URL(manifest.start_url, `https://example.test${prefix}manifest.webmanifest`);
    // 명시한 id는 manifest 폴더가 아닌 출처 루트에 상대적이다. 생략하면 start_url이 ID다.
    const identity = manifest.id === undefined ? start : new URL(manifest.id, start.origin);
    assert.equal(identity.href, start.href);
    assert.notEqual(identity.pathname, '/');
  }
});

test('프로젝트 하위 경로에서도 세 화면·알림 링크는 앱 안에, 이웃 사이트는 밖에 둔다', () => {
  for (const prefix of ['/etf-planner/', '/preview/etf-planner/']) {
    const base = new URL(`https://example.test${prefix}manifest.webmanifest`);
    const scope = new URL(manifest.scope, base);
    const inside = href => {
      const url = new URL(href, base);
      return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    };
    assert.equal(scope.href, `https://example.test${prefix}`);
    for (const href of ['./', ...pages, 'index.html#alert?ticker=TEST', 'index.html?split=TEST%3A2026-11-01%3A1%3A3', 'assets.html#allocation'])
      assert.ok(inside(href), href);
    for (const href of ['../other-site/', '/', 'https://outside.test/etf-planner/'])
      assert.equal(inside(href), false, href);
    assert.equal(new URL(manifest.start_url, base).href, scope.href);
  }
});

test('세 화면 모두 CSP가 허용한 같은 설치 정보를 읽고 iOS 앱 모드를 제공한다', () => {
  for (const name of pages) {
    const html = read(name), links = tags(html, 'link'), metas = tags(html, 'meta');
    assert.deepEqual(links.filter(tag => tag.rel === 'manifest').map(tag => tag.href), ['manifest.webmanifest'], name);
    const policy = Object.fromEntries(metas.find(tag => tag['http-equiv'] === 'Content-Security-Policy').content
      .split(';').map(s => s.trim().split(/\s+/)).map(([key, ...values]) => [key, values]));
    assert.deepEqual(policy['manifest-src'], ["'self'"], `${name}: 기본 차단 CSP에서 설치 정보만 같은 출처로 허용`);
    for (const key of ['mobile-web-app-capable', 'apple-mobile-web-app-capable'])
      assert.deepEqual(metas.filter(tag => tag.name === key).map(tag => tag.content), ['yes'], `${name}: ${key}`);
    assert.deepEqual(metas.filter(tag => tag.name === 'apple-mobile-web-app-title').map(tag => tag.content), [manifest.name], name);
    assert.deepEqual(metas.filter(tag => tag.name === 'apple-mobile-web-app-status-bar-style').map(tag => tag.content), ['default'], `${name}: 상태 막대와 본문이 겹치지 않음`);
    assert.deepEqual(links.filter(tag => tag.rel === 'apple-touch-icon').map(tag => [tag.href, tag.sizes]), [['icons/apple-touch-icon.png', '180x180']], name);
  }
});

// 확장자·선언 크기만 맞고 실제 PNG가 없거나 잘린 경우도 잡는다. 외부 이미지 라이브러리를 쓰지 않는다.
function pngSize(file) {
  assert.match(file, /^icons\/[\w-]+\.png$/);
  const data = fs.readFileSync(path.join(root, file));
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);
  assert.equal(data.toString('ascii', 12, 16), 'IHDR', file);
  const compressed = [];
  let end = false;
  for (let pos = 8; pos < data.length;) {
    const size = data.readUInt32BE(pos), type = data.toString('ascii', pos + 4, pos + 8);
    assert.ok(pos + size + 12 <= data.length, `${file}: 잘린 ${type}`);
    if (type === 'IDAT') compressed.push(data.subarray(pos + 8, pos + 8 + size));
    pos += size + 12;
    if (type === 'IEND') { end = true; assert.equal(pos, data.length); }
  }
  assert.ok(end, `${file}: IEND`);
  assert.ok(zlib.inflateSync(Buffer.concat(compressed)).length > 0, `${file}: 픽셀 데이터`);
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

test('Android 설치용 192·512px와 iOS용 180px 아이콘의 실제 PNG가 존재한다', () => {
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find(icon => icon.sizes === size && icon.purpose.split(' ').includes('any'));
    assert.ok(icon, size);
    assert.equal(icon.type, 'image/png');
    assert.equal(pngSize(icon.src), size);
  }
  const maskable = manifest.icons.find(icon => icon.purpose.split(' ').includes('maskable'));
  assert.ok(maskable, '기기별 원형·둥근 사각형 아이콘');
  assert.equal(pngSize(maskable.src), '512x512');
  assert.equal(pngSize('icons/apple-touch-icon.png'), '180x180');
});
