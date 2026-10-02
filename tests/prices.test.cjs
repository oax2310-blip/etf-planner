const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../js/prices.js'), 'utf8');
if (!source.includes('function fillPrices(')) throw Error('시세 채우기 구현을 찾지 못했습니다.');

// 종목 코드·가격은 모두 가짜 값.
const load = () => { const context = vm.createContext({}); vm.runInContext(source, context); return context; };
const plain = value => JSON.parse(JSON.stringify(value));
const AT = '2026-09-30T16:40:00+09:00';
const ma = extra => ({'25일선': 1401.234, '32일선': 1402, '42일선': 1403, '60일선': 1404, '80일선': 1405, '125일선': 1406, '150일선': null, '25개월선': null, ...extra});
const prices = () => ({updatedAt: AT, stocks: {
  AAA: {kind: '해외', asOf: '2026-09-29', close: 130.5, ma: {'60일선': 120.4567, '20주선': 110, '25개월선': 90.1}},
  '900001': {kind: '국내', asOf: '2026-09-30', close: 10234, ma: {'25일선': 10100.4, '60일선': 9900.6, '150일선': 9500, '25개월선': 8000.5}},
}, futures: {'202612': {kind: '달러선물', asOf: '2026-09-30', close: 1398.2, ma: ma()}}});

test('기준선 이름을 시세 파일 이동평균 이름으로 바꾼다(데이터 저장소 수집 스크립트와 같은 규칙)', () => {
  const ctx = load();
  assert.deepEqual(['60일선', '25 개월선', '12달선', '20주선', '150일 선', '77.65달러', '25분봉', '일봉', '0일선', ''].map(ctx.maKey),
    ['60일선', '25개월선', '12개월선', '20주선', '150일선', '', '', '', '', '']);
});

test('분할매도: 통화가 맞는 계획만 종료 기준가를 채우고(시작 기준가는 직접 정하는 값이라 그대로), 달러는 센트·원화는 원 단위로 반올림한다', () => {
  const ctx = load();
  const data = {plans: [
    {ticker: ' aaa ', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 100, endPrice: 80},
    {ticker: '900001', currency: 'KRW', startLabel: '25일선', endLabel: '25개월선', startPrice: 1, endPrice: 1},
    {ticker: '900001', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 5, endPrice: 4},
    {ticker: 'AAA', currency: 'USD', startLabel: '77.65달러', endLabel: '20주선', startPrice: 77.65, endPrice: 70},
    {ticker: 'ZZZ', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 3, endPrice: 2},
  ], futures: {positions: []}};
  assert.equal(ctx.fillPrices(data, prices()), true);
  assert.deepEqual(data.plans.map(p => plain([p.startPrice, p.endPrice, p.auto ?? 'auto 없음'])), [
    [100, 90.1, {at: AT, endPrice: 90.1}], // 시작 기준선이 60일선이어도 시작 기준가는 채우지 않는다
    [1, 8001, {at: AT, endPrice: 8001}],
    [5, 4, 'auto 없음'], // 국내 종목인데 달러 계획이면 채우지 않는다
    [77.65, 110, {at: AT, endPrice: 110}], // 이동평균이 아닌 기준선은 직접 입력한 값 그대로
    [3, 2, 'auto 없음'], // 시세 파일에 없는 종목은 새 필드도 만들지 않는다
  ]);
  assert.equal(ctx.fillPrices(data, prices()), false, '같은 시세로 다시 채우면 바뀌는 것이 없다');
});

test('분할매도: 직접 고친 값은 시세가 그대로면 두고, 그 칸 시세가 바뀌면 덮어쓴다', () => {
  const ctx = load();
  const p = {ticker: 'AAA', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 1, endPrice: 1};
  const data = {plans: [p]};
  ctx.fillPrices(data, prices());
  p.endPrice = 88;
  assert.equal(ctx.fillPrices(data, {...prices(), updatedAt: '2026-09-30T17:00:00+09:00'}), false);
  assert.equal(p.endPrice, 88);
  const next = prices(); next.updatedAt = '2026-10-01T06:40:00+09:00'; next.stocks.AAA.ma['25개월선'] = 91; next.stocks.AAA.ma['60일선'] = 121;
  assert.equal(ctx.fillPrices(data, next), true);
  assert.deepEqual(plain([p.startPrice, p.endPrice, p.auto]), [1, 91, {at: '2026-10-01T06:40:00+09:00', endPrice: 91}]);
  assert.equal(ctx.fillPrices(data, prices()), false, '채운 시각보다 오래된 시세로는 되돌리지 않는다');
  assert.equal(p.endPrice, 91);
});

test('분할매도: 달러 계획 환율은 달러선물 보유 근월물 종가로 채우고, 원화 계획·보유 월물이 없으면 그대로 둔다', () => {
  const ctx = load();
  const usd = {ticker: 'AAA', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 1, endPrice: 1, fx: 1354.91};
  const noQuote = {ticker: 'ZZZ', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 3, endPrice: 2, fx: 1354.91};
  const krw = {ticker: '900001', currency: 'KRW', startLabel: '25일선', endLabel: '25개월선', startPrice: 1, endPrice: 1, fx: 1354.91};
  const futures = {positions: [{month: '202612', contracts: 1}]};
  assert.equal(ctx.fillPrices({plans: [usd, noQuote, krw], futures}, prices()), true);
  assert.deepEqual(plain([usd.fx, usd.auto, noQuote.fx, noQuote.auto, krw.fx, 'fx' in krw.auto]), [
    1398.2, {at: AT, endPrice: 90.1, fx: 1398.2},
    1398.2, {at: AT, fx: 1398.2}, // 시세 파일에 없는 종목도 환율은 채운다
    1354.91, false]);
  usd.fx = 1400; // 직접 고친 환율은 종가가 그대로면 둔다
  assert.equal(ctx.fillPrices({plans: [usd], futures}, prices()), false);
  assert.equal(usd.fx, 1400);
  const next = prices(); next.updatedAt = '2026-10-01T09:10:00+09:00'; next.futures['202612'].close = 1402.456;
  assert.equal(ctx.fillPrices({plans: [usd], futures}, next), true);
  assert.equal(usd.fx, 1402.46);
  const alone = {ticker: 'ZZZ', currency: 'USD', fx: 1354.91};
  assert.equal(ctx.fillPrices({plans: [alone], futures: {positions: []}}, prices()), false, '달러선물 보유 월물이 없으면 환율을 채우지 않는다');
  assert.deepEqual([alone.fx, 'auto' in alone], [1354.91, false]);
});

test('달러선물: 보유 근월물 이동평균으로 N일선 구간 기준가와 안 산 계약 매수가를 채운다', () => {
  const ctx = load();
  const tranche = (completed, price) => ({price, completed, executionPrice: completed ? price : null});
  const f = {positions: [{month: '202703', contracts: 1}, {month: '202612', contracts: 2}, {month: '202611', contracts: 0}],
    levels: [{days: 25, price: 1390, contracts: 2, tranches: [tranche(true, 1390), tranche(false, 1390)]},
      {days: 150, price: 1350, contracts: 1, tranches: [tranche(false, 1350)]},
      {days: 0, label: '추가 매수 1', price: 1300, contracts: 1, tranches: [tranche(false, 1300)]}]};
  assert.equal(vm.runInContext('priceMonth', ctx)(f), '202612');
  assert.equal(ctx.fillPrices({plans: [], futures: f}, prices()), true);
  assert.deepEqual(plain(f.levels.map(l => [l.price, l.tranches.map(t => [t.price, t.completed, t.executionPrice])])), [
    [1401.23, [[1390, true, 1390], [1401.23, false, null]]], // 체크한 계약은 그대로
    [1350, [[1350, false, null]]], // 봉이 모자라 이동평균이 없으면(null) 그대로
    [1300, [[1300, false, null]]], // 직접 추가한 구간은 채우지 않는다
  ]);
  assert.deepEqual(plain(f.auto), {at: AT, '25일선': 1401.23});
  assert.equal(ctx.fillPrices({plans: [], futures: {positions: [], levels: f.levels}}, prices()), false, '보유 월물이 없으면 채우지 않는다');
});

test('재매수: 국내 종목 코드를 넣었을 때만 현재가와 N일선 단계 기준가를 채운다(분봉 단계는 그대로)', () => {
  const ctx = load();
  const stages = () => [{name: '25분봉', price: 0}, {name: '25일선', price: 0}, {name: '150일선', price: 1, done: true}];
  const r = {name: '테스트 ETF', ticker: '900001', currentPrice: 0, stages: stages()};
  assert.equal(ctx.fillPrices({plans: [], rebuy: r}, prices()), true);
  assert.deepEqual(plain([r.currentPrice, r.stages.map(x => x.price), r.auto]), [10234, [0, 10100, 9500], {at: AT, currentPrice: 10234, '25일선': 10100, '150일선': 9500}]);
  const us = {ticker: 'AAA', currentPrice: 0, stages: stages()}, none = {currentPrice: 7, stages: stages()};
  assert.equal(ctx.fillPrices({plans: [], rebuy: us}, prices()), false, '해외 종목은 원화 재매수에 채우지 않는다');
  assert.equal(ctx.fillPrices({plans: [], rebuy: none}, prices()), false);
  assert.equal(ctx.fillPrices({plans: []}, prices()), false, '재매수 기록이 없으면 만들지 않는다');
  assert.deepEqual(['auto' in us, 'auto' in none, none.currentPrice], [false, false, 7]);
});

test('동기화 기록(JSON)에 채운 결과는 같은 기록을 직접 채운 것과 같고, 바꿀 것이 없으면 받은 문자열 그대로다', () => {
  const ctx = load();
  const data = {plans: [{ticker: 'AAA', currency: 'USD', startLabel: '60일선', endLabel: '25개월선', startPrice: 1, endPrice: 1}], futures: {positions: []}, actions: {}};
  const json = JSON.stringify(data);
  const filled = ctx.pricedSnapshot(json, prices());
  ctx.fillPrices(data, prices());
  assert.equal(filled, JSON.stringify(data));
  assert.equal(ctx.pricedSnapshot(filled, prices()), filled);
  assert.equal(ctx.pricedSnapshot(json, null), json);
  assert.equal(ctx.pricedSnapshot(null, prices()), null);
});

test('시세 파일에서 채우기·표시에 쓰는 값만 남기고, 형식이 다르면 오류', () => {
  const ctx = load();
  const slim = plain(ctx.slimPrices({updatedAt: AT, columns: [], stocks: {AAA: {kind: '해외', market: 'NAS', asOf: '2026-09-29', close: 1, ma: {'60일선': 1}, daily: [[1]], monthly: [[1]]},
    BAD: {error: '조회 실패'}, OLD: {kind: '국내', asOf: '2026-09-01', close: 2, ma: {}, stale: true, error: 'x'}}}));
  assert.deepEqual(slim, {format: 2, updatedAt: AT, stocks: {AAA: {kind: '해외', asOf: '2026-09-29', close: 1, ma: {'60일선': 1}}, BAD: {}, OLD: {kind: '국내', asOf: '2026-09-01', close: 2, ma: {}, stale: true}}, futures: {}});
  assert.equal(vm.runInContext('stockEntry', ctx)(slim, 'bad'), null, '기준일 없는 항목(조회만 실패)은 쓰지 않는다');
  assert.throws(() => ctx.slimPrices({plans: []}), /형식/);
});

// 봉: 시세 파일 columns(date·open·high·low·close·volume) 순서. 9/14·9/21·9/28이 있는 주(월~일)로 주봉을 만든다.
const COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume'];
const bar = (date, close) => [date, 1, 1, 1, close, 100];
const daily = [bar('2026-09-17', 10), bar('2026-09-18', 11), bar('2026-09-21', 12), bar('2026-09-25', 13), bar('2026-09-28', 14), bar('2026-09-30', 15)];
const monthly = [bar('2026-08-31', 20), bar('2026-09-30', 30)];

test('시세 파일 봉 기록에서 종목 종가만 남기고, 주봉이 없으면 일봉을 주마다 묶어 만든다', () => {
  const ctx = load();
  const slim = plain(ctx.slimPrices({updatedAt: AT, columns: COLUMNS, stocks: {
    AAA: {kind: '해외', asOf: '2026-09-30', close: 15, ma: {}, daily, monthly},
    BBB: {kind: '국내', asOf: '2026-09-30', close: 15, ma: {}, daily, weekly: [bar('2026-09-21', 7), bar('2026-09-28', 8)]},
  }, futures: {'202612': {kind: '달러선물', asOf: '2026-09-30', close: 1398.2, ma: {}, daily}}}));
  assert.deepEqual(slim.stocks.AAA.closes, {D: [10, 11, 12, 13, 14, 15], W: [11, 13, 15], M: [20, 30]});
  assert.deepEqual(slim.stocks.BBB.closes, {D: [10, 11, 12, 13, 14, 15], W: [7, 8]}, '시세 파일 주봉이 있으면 그대로 쓴다');
  assert.equal(slim.futures['202612'].closes, undefined, '달러선물은 파일 ma만 쓴다');
  const moved = plain(ctx.slimPrices({updatedAt: AT, columns: ['close', 'date'], stocks: {AAA: {kind: '해외', asOf: '2026-09-30', close: 15, ma: {}, daily: [[10, '2026-09-29'], [15, '2026-09-30']]}}}));
  assert.deepEqual(moved.stocks.AAA.closes, {D: [10, 15], W: [15]}, 'columns 순서를 따른다');
});

test('이동평균: 시세 파일 ma에 있으면 그 값, 없으면 보관한 종가로 계산하고 봉이 모자라면 비운다', () => {
  const ctx = load();
  const e = plain(ctx.slimPrices({updatedAt: AT, columns: COLUMNS, stocks: {AAA: {kind: '해외', asOf: '2026-09-30', close: 15, ma: {'3일선': 99, '4일선': null}, daily, monthly}}})).stocks.AAA;
  assert.deepEqual(['3일선', '2일선', '4일선', '2주선', '3 주선', '2개월선', '1달선', '3개월선', '7일선', '25분봉'].map(label => ctx.maValue(e, label)),
    [99, 14.5, 13.5, 14, 13, 25, 30, null, null, null]);
  assert.equal(ctx.maValue({kind: '국내', asOf: '2026-09-30', close: 1, ma: {'60일선': 5}}, '60일선'), 5, '종가가 없는 옛 시세도 ma는 쓴다');
});

test('분할매도: 새로 고른 기준선(시세 파일 ma에 아직 없음)도 보관한 종가로 바로 채운다', () => {
  const ctx = load();
  const slim = ctx.slimPrices({updatedAt: AT, columns: COLUMNS, stocks: {AAA: {kind: '해외', asOf: '2026-09-30', close: 15, ma: {'60일선': 120.4567}, daily, monthly}}});
  const p = {ticker: 'AAA', currency: 'USD', startLabel: '60일선', endLabel: '2주선', startPrice: 1, endPrice: 1};
  assert.equal(ctx.fillPrices({plans: [p]}, slim), true);
  assert.deepEqual(plain([p.startPrice, p.endPrice, p.auto]), [1, 14, {at: AT, endPrice: 14}]);
  p.endLabel = '12개월선'; // 월봉이 모자라면 그대로(다음 수집 때 스크립트가 채움)
  assert.equal(ctx.fillPrices({plans: [p]}, slim), false);
  assert.equal(p.endPrice, 14);
});

test('시세 기준일은 작게 표시하고, 3일 넘게 지났으면 경고한다', () => {
  const ctx = load();
  const now = new Date(2026, 9, 2, 9, 0); // 2026-10-02(금) 이 기기 시각
  const entry = asOf => ({kind: '국내', asOf, close: 1, ma: {}});
  assert.equal(ctx.priceAge('2026-09-29', now), 3);
  assert.equal(ctx.priceStamp(entry('2026-09-29'), now), '<small class="price-date" title="시세 기준일 2026-09-29">시세 9/29 기준</small>');
  assert.equal(ctx.priceWarning(entry('2026-09-29'), 'AAA', now), '', '3일까지는 경고하지 않는다(금요일 시세를 월요일에 봐도 정상)');
  assert.match(ctx.priceStamp(entry('2026-09-28'), now), /class="price-date old".*시세 9\/28 기준 · 4일 전/);
  assert.match(ctx.priceWarning(entry('2026-09-28'), 'AAA', now), /^<div class="warning price-warn">AAA 시세 기준일이 2026-09-28로 4일 지났습니다/);
  assert.match(ctx.priceStamp({...entry('2026-10-02'), stale: true}, now), /class="price-date old".*조회 실패/);
  assert.equal(ctx.priceStamp(null, now), '');
});
