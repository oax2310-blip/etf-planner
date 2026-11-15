const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 화면 없이(document 없음) 불러오면 themeOf만 정의되고 화면은 건드리지 않는다.
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/theme.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const themeOf = context.themeOf;

test('PC(마우스)는 고른 화면 모드를 쓴다', () => {
  assert.equal(themeOf('dark', true, false), 'dark');
  assert.equal(themeOf('light', true, true), 'light');
});

test('PC에서 기기 설정 따름(또는 모르는 값)이면 기기 설정을 따른다', () => {
  assert.equal(themeOf('auto', true, true), 'dark');
  assert.equal(themeOf('auto', true, false), 'light');
  assert.equal(themeOf('sepia', true, true), 'dark');
  assert.equal(themeOf(null, true, false), 'light');
});

test('휴대폰(터치)은 PC에서 고른 값이 있어도 늘 기기 설정을 따른다', () => {
  assert.equal(themeOf('dark', false, false), 'light');
  assert.equal(themeOf('light', false, true), 'dark');
});

test('상태바 요청 색은 처음 열기·기기 모드 변경·다른 탭 선택 모두 실제 본문 배경색을 따른다', () => {
  const events = {}, metas = [{content:'#ffffff'}, {content:'#0a0c10'}];
  let choice = 'light';
  const desktop = {matches:false, addEventListener:(name, fn) => events.desktop = fn};
  const dark = {matches:true, addEventListener:(name, fn) => events.dark = fn};
  const doc = {documentElement:{dataset:{}}, querySelectorAll:() => metas, addEventListener() {}};
  const ctx = vm.createContext({document:doc, matchMedia:q => q.includes('hover') ? desktop : dark,
    localStorage:{getItem:() => choice}, addEventListener:(name, fn) => events[name] = fn});
  vm.runInContext(source, ctx);
  const check = (theme, color) => {
    assert.equal(doc.documentElement.dataset.theme, theme);
    assert.deepEqual(metas.map(meta => meta.content), [color, color]);
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
    const metas = [{content:'기존 밝은 색'}, {content:'기존 어두운 색'}], saved = new Map([
      ['etf-planner-theme', systemDark ? 'light' : 'dark'], ['legacy-record', '{"plans":[]}'],
    ]), before = [...saved];
    const ctx = vm.createContext({
      document:{documentElement:{dataset:{}}, querySelectorAll:() => metas, addEventListener() {}},
      matchMedia:q => ({matches:q.includes('prefers-color-scheme') && systemDark, addEventListener() {}}),
      localStorage:{getItem:key => saved.get(key), setItem:(key, value) => saved.set(key, value), removeItem:key => saved.delete(key)},
      addEventListener() {},
    });
    vm.runInContext(source, ctx);
    assert.deepEqual(metas.map(meta => meta.content), [colors[systemDark ? 'dark' : 'light'], colors[systemDark ? 'dark' : 'light']]);
    assert.deepEqual([...saved], before, '표시 초기화는 저장값을 수정하지 않음');
  }
});
