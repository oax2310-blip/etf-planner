const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 자산 배분에서 온 이동을 화면 없이 실행하며 상태·브라우저 의존성은 모두 가짜 값으로 넣는다.
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = vm.runInThisContext(`(function(location, history, state, openTab, rebuyItems, assetStore, purchasePlanner){
${read('js/member-link.js')}\n;\n${read('js/member-go.js')}
return {memberLink, memberGo};})`);
function setup(tab, id) {
  const location = {hash: ''}, tabs = [], replacements = [], purchases = [];
  const state = {tab: 'buys', plans: [{id: 'p0'}, {id: 'p1'}], rebuy: {items: [{id: 'r0'}, {id: 'r1'}]}, selectedPlan: 'keep-plan', selectedRebuy: 'keep-rebuy'};
  const assetStore = {doc: {allocation: {groups: [{items: [{id: 'b0', buyPlan: {}}]}]}}};
  const {memberLink, memberGo} = load(location, {replaceState: (...args) => replacements.push(args)}, state,
    t => {tabs.push(t);state.tab = t;}, s => s.rebuy.items, assetStore, {select: id => purchases.push(id)});
  location.hash = new URL(memberLink.href(tab, id), 'https://example.test/').hash;
  return {memberGo, state, tabs, replacements, purchases};
}

for (const [tab, field, ids] of [['plans', 'selectedPlan', ['p0', 'p1']], ['rebuy', 'selectedRebuy', ['r0', 'r1']]]) {
  test(`${tab}: 정상 id와 범위 안의 정수 순번은 해당 항목을 선택한다`, () => {
    for (const [id, expected] of [[ids[0], ids[0]], [ids[1], ids[1]], ['#0', ids[0]], ['#1', ids[1]], ['#01', ids[1]]]) {
      const {memberGo, state, tabs, replacements, purchases} = setup(tab, id);
      assert.equal(memberGo.open(), true, id);
      assert.equal(state[field], expected, id);
      assert.equal(state[tab === 'plans' ? 'selectedRebuy' : 'selectedPlan'], tab === 'plans' ? 'keep-rebuy' : 'keep-plan');
      assert.deepEqual(tabs, [tab]);
      assert.deepEqual(replacements, []);
      assert.deepEqual(purchases, []);
    }
  });

  for (const id of ['#', '#1.5', '#-1', '#abc', '# 1', '#0x1', '#2', '#99', '#9007199254740993', 'missing']) {
    test(`${tab}: ${JSON.stringify(id)}는 오류 없이 탭만 연다`, () => {
      const {memberGo, state, tabs, replacements, purchases} = setup(tab, id);
      const before = structuredClone(state);
      assert.doesNotThrow(() => assert.equal(memberGo.open(), true));
      assert.deepEqual(state, {...before, tab});
      assert.deepEqual(tabs, [tab]);
      assert.deepEqual(replacements, [[null, '', `#${tab}`]]);
      assert.deepEqual(purchases, []);
    });
  }
}

test('분할매수의 정상 id는 기존처럼 purchasePlanner로 선택한다', () => {
  const {memberGo, state, tabs, replacements, purchases} = setup('buys', 'b0');
  assert.equal(memberGo.open(), true);
  assert.equal(state.selectedPlan, 'keep-plan');
  assert.equal(state.selectedRebuy, 'keep-rebuy');
  assert.deepEqual(tabs, ['buys']);
  assert.deepEqual(replacements, []);
  assert.deepEqual(purchases, ['b0']);
});
