const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 자산 배분의 플래너 편입 표시(js/member-link.js). 화면 없이 불러오며 종목·금액은 모두 테스트용 가짜 값이다.
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const store = {};
const m = vm.runInThisContext(`(function(localStorage){${read('js/ma-ladder.js')}\n;\n${read('js/assets-calc.js')}\n;\n${read('js/member-link.js')}
return memberLink;})`)({getItem: k => store[k] ?? null});
const alloc = items => ({groups: [{id: 'g', name: '그룹', items}]});
const plan = (id, ticker, extra = {}) => ({id, ticker, title: `${ticker} 계획`, stages: 3, checked: [false, false, false], holdings: [], ...extra});
const ids = list => list.map(x => x.id);

test('플래너 저장 키는 core.js와 같고 이동 주소는 탭·id만 담아 되돌린다', () => {
  assert.equal(m.PLANNER_KEY, /STORAGE_KEY = "([^"]+)"/.exec(read('js/core.js'))[1]);
  for (const tab of ['buys', 'plans', 'rebuy']) { const link = new URL(m.href(tab, 'a b&c=d/1'), 'https://example.test/'); assert.equal(link.pathname, '/index.html'); assert.deepEqual(m.parse(link.hash), {tab, id: 'a b&c=d/1'}); }
  for (const bad of ['#plans', '#go?tab=futures&id=1', '#go?tab=plans', '#go?tab=plans&id=', `#go?tab=plans&id=${'x'.repeat(201)}`, '#alert?ticker=SPY', null]) assert.equal(m.parse(bad), null, String(bad));
});

test('종목 코드가 같으면(대소문자·국내 A 접두·비트코인·실제 매수 코드) 확정 연결이고 추정 목록에 넣지 않는다', () => {
  const items = [{id: 'a', name: '미국지수', ticker: 'spy', tradeTicker: '360750'}, {id: 'b', name: '코스피', ticker: '069500'}, {id: 'c', name: '코인', ticker: '비트코인'}, {id: 'd', name: '다른 종목', ticker: 'QQQ'}];
  const r = m.collect(alloc(items), null, {
    plans: [{kind: 'plans', id: 'p1', code: 'SPY', names: [], label: 'SPY'}, {kind: 'plans', id: 'p2', code: '360750', names: [], label: '실제 ETF'}, {kind: 'plans', id: 'p3', code: 'A069500', names: [], label: '코스피'}, {kind: 'plans', id: 'p4', code: 'BTC-USD', names: [], label: 'BTC'}],
    rebuy: [{kind: 'rebuy', id: 'r1', code: 'qqq', names: ['아무 이름'], label: '재매수'}]
  });
  assert.deepEqual(ids(r.items.get('a').plans), ['p1', 'p2']);
  assert.deepEqual(ids(r.items.get('b').plans), ['p3']);
  assert.deepEqual(ids(r.items.get('c').plans), ['p4']);
  assert.deepEqual(ids(r.items.get('d').rebuy), ['r1']);
  assert.deepEqual([r.guesses, r.unlinked], [[], []]);
  assert.equal(r.items.get('d').plans.length, 0);
});

test('코드로 못 찾은 항목만 이름으로 맞추고 추정으로 알린다 — 표기 차이는 같게, 이름이 더 긴 다른 상품은 합치지 않는다', () => {
  const items = [{id: 'a', name: 'KODEX 200', ticker: ''}, {id: 'b', name: 'TIGER 미국S&P500', ticker: ''}, {id: 'c', name: 'TIGER 미국S&P500배당귀족', ticker: ''}, {id: 'd', name: '니프티50', ticker: ''}];
  const r = m.collect(alloc(items), null, {
    plans: [],
    rebuy: [
      {kind: 'rebuy', id: 'r1', code: '', names: ['kodex200 ETF'], label: 'kodex200 ETF'},
      {kind: 'rebuy', id: 'r2', code: '', names: ['TIGER 미국 S&P500'], label: 'TIGER 미국 S&P500'},
      {kind: 'rebuy', id: 'r3', code: '', names: ['니프티 50 ETF'], label: '니프티 50 ETF'},
      {kind: 'rebuy', id: 'r4', code: '', names: ['완전히 다른 이름'], label: '다른'}
    ]
  });
  assert.deepEqual(r.items.get('a').rebuy, [{id: 'r1', label: 'kodex200 ETF', how: 'name'}]);
  assert.deepEqual(r.items.get('b').rebuy.map(x => x.id), ['r2']);
  assert.deepEqual(r.items.get('c').rebuy, [], '배당귀족은 다른 상품');
  assert.deepEqual(r.items.get('d').rebuy.map(x => x.how), ['name']);
  assert.deepEqual(r.guesses.map(g => [g.item.id, g.tab, g.how]), [['a', 'rebuy', 'name'], ['b', 'rebuy', 'name'], ['d', 'rebuy', 'name']]);
  assert.deepEqual(r.unlinked, [{tab: 'rebuy', label: '다른'}]);
});

test('이름이 거의 같은 경우는 fuzzy로 표시하고, 코드가 하나라도 맞으면 이름은 보지 않는다', () => {
  const items = [{id: 'a', name: 'ACE 미국나스닥100', ticker: 'X1'}, {id: 'b', name: '다른 이름', ticker: 'QQQ'}];
  const r = m.collect(alloc(items), null, {plans: [{kind: 'plans', id: 'p', code: 'ZZZ', names: ['ACE 미국나스닥10'], label: 'p'}, {kind: 'plans', id: 'q', code: 'QQQ', names: ['ACE 미국나스닥100'], label: 'q'}], rebuy: []});
  assert.deepEqual(r.items.get('a').plans.map(x => [x.id, x.how]), [['p', 'fuzzy']]);
  assert.deepEqual(r.items.get('b').plans.map(x => [x.id, x.how]), [['q', 'code']]);
  assert.deepEqual(r.items.get('a').plans.length + r.items.get('b').plans.length, 2);
});

test('분할매수는 계획이 붙은 종목(id)과 같은 코드의 다른 계좌(code)를 편입으로 보고, 같은 탭 여러 개는 확실한 연결부터 센다', () => {
  const buy = {lines: {names: ['25일선'], budget: 10}, cardName: '카드'};
  const items = [{id: 'a', name: '계좌1', ticker: 'AAA', amount: 10, buyPlan: buy}, {id: 'b', name: '계좌2', ticker: 'AAA', amount: 5}, {id: 'c', name: '무관', ticker: 'CCC', amount: 5}];
  const r = m.collect(alloc(items), null, {plans: [{kind: 'plans', id: 'p1', code: 'AAA', names: [], label: '첫째'}, {kind: 'plans', id: 'p2', code: '', names: ['계좌1'], label: '이름만'}], rebuy: []});
  assert.deepEqual(r.items.get('a').buys, [{id: 'a', label: '카드', how: 'id'}]);
  assert.deepEqual(r.items.get('b').buys, [{id: 'a', label: '카드', how: 'code'}]);
  assert.deepEqual(r.items.get('c').buys, []);
  assert.deepEqual(r.items.get('a').plans.map(x => [x.id, x.how]), [['p1', 'code'], ['p2', 'name']], '코드가 있는 계획은 코드로, 코드가 없는 계획은 이름으로 맞추며 확실한 연결이 앞');
  assert.equal(r.items.get('b').plans.length, 1, '같은 코드의 다른 계좌도 코드 일치');
  const two = m.collect(alloc(items), null, {plans: [{kind: 'plans', id: 'z', code: '', names: ['계좌2'], label: '이름'}, {kind: 'plans', id: 'p1', code: 'CCC', names: [], label: '코드'}, {kind: 'plans', id: 'p9', code: 'CCC', names: [], label: '코드2'}], rebuy: []});
  assert.deepEqual(two.items.get('c').plans.map(x => x.id), ['p1', 'p9']);
  assert.deepEqual(two.items.get('b').plans.map(x => x.how), ['name']);
});

test('플래너 기록 읽기는 깨진 값에도 안전하고 입력을 바꾸지 않으며 옛 단일 재매수·id 없는 항목을 읽는다', () => {
  store[m.PLANNER_KEY] = '{깨진 json';
  assert.deepEqual(m.read(), {plans: [], rebuy: []});
  const state = {plans: [plan('p1', 'SPY', {cardName: '카드'}), 7, null, {id: 5, ticker: 'QQQ'}], rebuy: {name: '옛 재매수', ticker: 'A069500', stages: []}};
  const before = JSON.stringify(state);
  store[m.PLANNER_KEY] = before;
  const lists = m.read();
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(lists.plans.map(p => [p.id, p.code, p.label]), [['p1', 'SPY', '카드'], ['5', 'QQQ', 'QQQ']]);
  assert.deepEqual(lists.rebuy.map(r => [r.id, r.code, r.label]), [['#0', 'A069500', '옛 재매수']]);
  assert.equal(m.read(), lists, '같은 원문은 다시 해석하지 않는다');
  store[m.PLANNER_KEY] = JSON.stringify({plans: [], rebuy: {items: [{id: 'r', name: '목록'}, 'x']}});
  assert.deepEqual(m.read().rebuy.map(r => r.id), ['r']);
  store[m.PLANNER_KEY] = JSON.stringify({plans: 'x', rebuy: 3});
  assert.deepEqual(m.read(), {plans: [], rebuy: []});
});

test('collect는 자산 기록과 플래너 입력을 바꾸지 않고, 추가·삭제 뒤 다시 계산하면 바로 달라진다', () => {
  const a = alloc([{id: 'a', name: '미국지수', ticker: 'SPY', amount: 3}]);
  const planner = {plans: [{kind: 'plans', id: 'p1', code: 'SPY', names: [], label: 'SPY'}], rebuy: []}, before = JSON.stringify([a, planner]);
  assert.equal(m.collect(a, null, planner).items.get('a').plans.length, 1);
  assert.equal(JSON.stringify([a, planner]), before);
  assert.equal(m.collect(a, null, {...planner, plans: []}).items.get('a').plans.length, 0);
  assert.equal(m.collect(a, null, {...planner, plans: [...planner.plans, {kind: 'plans', id: 'p2', code: 'spy', names: [], label: '둘째'}]}).items.get('a').plans.length, 2);
});
