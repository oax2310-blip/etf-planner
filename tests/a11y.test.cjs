const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`))?.[1] ?? null;
const idsOf = source => [...source.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]);

test('세 HTML의 모든 창은 같은 문서나 해당 창의 렌더링 코드에 있는 제목을 참조한다', () => {
  for (const file of ['index.html', 'assets.html', 'valuation.html']) {
    const html = read(file), ids = idsOf(html), dialogs = [...html.matchAll(/<dialog\b[^>]*>/g)];
    const scripts = [...html.matchAll(/<script\b[^>]*src="(js\/[^"?]+)(?:\?[^" ]*)?"/g)].map(m => read(m[1]));
    assert.ok(dialogs.length, `${file}: 검사할 창이 있어야 한다`);
    for (const [tag] of dialogs) {
      const dialogId = attr(tag, 'id'), labels = attr(tag, 'aria-labelledby')?.trim().split(/\s+/);
      assert.ok(labels?.length && labels.every(Boolean), `${file}: ${dialogId}의 aria-labelledby가 비어 있다`);
      for (const label of labels) {
        const matches = ids.filter(id => id === label);
        if (matches.length) {
          assert.equal(matches.length, 1, `${file}: ${label} 제목 ID가 중복된다`);
        } else {
          // 빈 dialog의 제목은 그 창을 참조하는 JS가 열 때 그린다.
          assert.ok(scripts.some(source =>
            (source.includes(`"${dialogId}"`) || source.includes(`'${dialogId}'`)) && idsOf(source).includes(label)
          ), `${file}: ${dialogId}의 제목 ${label}이 HTML과 해당 창의 JS에 없다`);
        }
      }
    }
  }
});

function node(tag = '') {
  const attributes = new Map([...tag.matchAll(/\s([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const classes = new Set((attributes.get('class') || '').split(/\s+/));
  return {
    dataset: attributes.has('data-tab') ? {tab: attributes.get('data-tab')} : {},
    classList: {toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name)},
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name),
    addEventListener() {}, style: {setProperty() {}}
  };
}

function page(htmlFile, scriptFile) {
  const nav = read(htmlFile).match(/<nav\b[^>]*class="tabs"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const navTabs = [...nav.matchAll(/<(?:button|a)\b[^>]*>/g)].map(m => node(m[0])).filter(b => b.classList.contains('tab'));
  const tabs = navTabs.filter(b => b.dataset.tab), nodes = new Map(), storage = new Map(), savedTabs = [];
  const getNode = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const top = node(); top.querySelector = () => ({offsetTop: 0});
  const ctx = vm.createContext({
    document: {
      getElementById: getNode, querySelector: selector => selector === '.top' ? top : getNode(selector), addEventListener() {},
      querySelectorAll: selector => selector === '.tab' ? navTabs : ['.tab[data-tab]', 'nav.tabs .tab[data-tab]'].includes(selector) ? tabs : []
    },
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    assetStore: {doc: {}, prices: null}, location: {hash: '#unchanged'}, addEventListener() {}
  });
  ctx.save = () => savedTabs.push(vm.runInContext('state.tab', ctx));
  for (const file of ['js/ma-ladder.js', ...(scriptFile === 'js/assets.js' ? ['js/assets-calc.js', 'js/money-input.js'] : []), scriptFile])
    vm.runInContext(read(file), ctx, {filename: file});
  let renders = 0; ctx.render = () => renders++;
  return {ctx, tabs, navTabs, getNode, storage, savedTabs, renders: () => renders};
}

test('openTab은 현재 상단 탭 하나에만 aria-current를 남기고 이전 탭에서는 속성을 지운다', () => {
  for (const [htmlFile, scriptFile, fallback, stateName] of [
    ['index.html', 'js/core.js', 'plans', 'state'], ['assets.html', 'js/assets.js', 'alloc', 'ui']
  ]) {
    const p = page(htmlFile, scriptFile), names = p.tabs.map(b => b.dataset.tab);
    assert.ok(names.length > 1, `${htmlFile}: 탭 전환을 검사한다`);
    for (const tab of p.tabs) {
      assert.equal(tab.getAttribute('type'), 'button', `${htmlFile}: ${tab.dataset.tab}은 제출 버튼이 아니다`);
      tab.setAttribute('aria-current', 'step');
    }
    const check = expected => {
      assert.deepEqual(p.navTabs.filter(b => b.getAttribute('aria-current') !== null).map(b => b.dataset.tab), [expected]);
      for (const tab of p.navTabs) {
        const active = tab.dataset.tab === expected;
        assert.equal(tab.getAttribute('aria-current'), active ? 'page' : null);
        assert.equal(tab.classList.contains('active'), active);
      }
      for (const name of names) assert.equal(p.getNode(name + 'View').classList.contains('hidden'), name !== expected);
      assert.equal(vm.runInContext(`${stateName}.tab`, p.ctx), expected);
      assert.equal(p.ctx.location.hash, '#unchanged', 'openTab 자체는 hash를 바꾸지 않는다');
      if (stateName === 'state') assert.equal(p.savedTabs.at(-1), expected);
      else assert.equal(JSON.parse(p.storage.get('etf-planner-assets-ui')).tab, expected);
    };
    for (const requested of [...names, ...names.toReversed(), 'unknown', '']) {
      p.ctx.openTab(requested);
      check(names.includes(requested) ? requested : fallback);
    }
    if (stateName === 'state') {
      const before = p.renders();
      p.ctx.openTab(names[0], false); check(names[0]);
      assert.equal(p.renders(), before, 'redraw=false여도 탭 속성은 갱신하고 화면은 다시 그리지 않는다');
    }
  }
});
