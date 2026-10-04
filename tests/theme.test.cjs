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
