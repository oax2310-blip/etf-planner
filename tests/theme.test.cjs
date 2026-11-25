const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 화면 없이(document 없음) 불러오면 themeOf만 정의되고 화면은 건드리지 않는다.
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/theme.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const themeOf = context.themeOf;

test('직접 고른 화면 모드는 기기의 밝고 어두운 모드보다 우선한다', () => {
  assert.equal(themeOf('dark', false), 'dark');
  assert.equal(themeOf('light', true), 'light');
});

test('기기 설정 따름 또는 모르는 값이면 기기 설정을 따른다', () => {
  assert.equal(themeOf('auto', true), 'dark');
  assert.equal(themeOf('auto', false), 'light');
  assert.equal(themeOf('sepia', true), 'dark');
  assert.equal(themeOf(null, false), 'light');
});

test('삼성 인터넷 터치는 자체 다크가 기본이며 사용자가 고른 터치 설정은 PC 설정과 따로 적용한다', () => {
  for (const choice of [null, 'light']) {
    const events = {}, meta = {content:'#f5f6f8'}, desktop = {matches:false, addEventListener:(name, fn) => events.desktop = fn};
    const dark = {matches:false, addEventListener:(name, fn) => events.dark = fn};
    const document = {documentElement:{dataset:{}}, querySelectorAll:() => [meta], addEventListener() {}};
    const saved = new Map([['etf-planner-theme', choice]]);
    vm.runInNewContext(source, {
      document,
      navigator:{userAgent:'Mozilla/5.0 (Linux; Android 16) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36'},
      matchMedia:q => q.includes('hover') ? desktop : dark,
      localStorage:{getItem:key => saved.get(key)},
      addEventListener:(name, fn) => events[name] = fn,
    });
    const check = (theme, color) => {
      assert.equal(document.documentElement.dataset.theme, theme);
      assert.equal(meta.content, color);
    };
    check('dark', '#0a0c10');
    saved.set('etf-planner-touch-theme','auto');
    events.storage({key:'etf-planner-touch-theme'}); check('light', '#f5f6f8');
    dark.matches = true; events.dark(); check('dark', '#0a0c10');
    saved.set('etf-planner-touch-theme','light');
    events.storage({key:'etf-planner-touch-theme'}); check('light', '#f5f6f8');
    dark.matches = false; events.dark();
    desktop.matches = true; events.desktop(); check('light', '#f5f6f8');
    desktop.matches = false; events.desktop(); check('light', '#f5f6f8');
    saved.delete('etf-planner-touch-theme');
    events.storage({key:null}); check('dark', '#0a0c10');
  }
});

test('상태바 요청 색은 처음 열기·기기 모드 변경·다른 탭 선택 모두 실제 본문 배경색을 따른다', () => {
  const events = {}, metas = [{media:'(prefers-color-scheme: light)', content:'#f5f6f8'}, {media:'(prefers-color-scheme: dark)', content:'#0a0c10'}, {content:'#f5f6f8'}];
  let choice = 'light';
  const desktop = {matches:false, addEventListener:(name, fn) => events.desktop = fn};
  const dark = {matches:true, addEventListener:(name, fn) => events.dark = fn};
  const doc = {documentElement:{dataset:{}}, querySelectorAll:selector => { assert.equal(selector, 'meta[name="theme-color"]'); return metas; }, addEventListener() {}};
  const ctx = vm.createContext({document:doc, matchMedia:q => q.includes('hover') ? desktop : dark,
    localStorage:{getItem:key => key === 'etf-planner-theme' ? choice : null}, addEventListener:(name, fn) => events[name] = fn});
  vm.runInContext(source, ctx);
  const check = (theme, color) => {
    assert.equal(doc.documentElement.dataset.theme, theme);
    assert.deepEqual(metas.map(meta => meta.content), [color, color, color]);
  };
  check('dark', '#0a0c10'); // 터치에서는 저장한 light보다 기기 dark 우선
  dark.matches = false; events.dark(); check('light', '#f5f6f8');
  desktop.matches = true; choice = 'dark'; events.desktop(); check('dark', '#0a0c10');
  choice = 'light'; events.storage({key:'etf-planner-theme'}); check('light', '#f5f6f8');
});

test('런타임 상태바 요청 색은 CSS 본문 배경을 따르고 저장된 기록과 테마 선택을 바꾸지 않는다', () => {
  const css = fs.readFileSync(require('node:path').join(__dirname, '../css/app.css'), 'utf8');
  const colors = {
    light:css.match(/:root\{[^}]*--bg:([^;]+)/)[1],
    dark:css.match(/:root\[data-theme=dark\]\{[^}]*--bg:([^;]+)/)[1],
  };
  for (const systemDark of [false, true]) {
    const metas = [
      {media:'(prefers-color-scheme: light)', content:'기존 밝은 색'},
      {media:'(prefers-color-scheme: dark)', content:'기존 어두운 색'},
      {content:'기존 기본 색'},
    ], saved = new Map([
      ['etf-planner-theme', systemDark ? 'light' : 'dark'], ['legacy-record', '{"plans":[]}'],
    ]), before = [...saved];
    const ctx = vm.createContext({
      document:{documentElement:{dataset:{}}, querySelectorAll:() => metas, addEventListener() {}},
      matchMedia:q => ({matches:q.includes('prefers-color-scheme') && systemDark, addEventListener() {}}),
      localStorage:{getItem:key => saved.get(key), setItem:(key, value) => saved.set(key, value), removeItem:key => saved.delete(key)},
      addEventListener() {},
    });
    vm.runInContext(source, ctx);
    const expected = colors[systemDark ? 'dark' : 'light'];
    assert.deepEqual(metas.map(meta => meta.content), [expected, expected, expected]);
    assert.deepEqual([...saved], before, '표시 초기화는 저장값을 수정하지 않음');
  }
});
