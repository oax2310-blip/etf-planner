const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const scope = 'https://example.test/etf-planner/';

function makeNotification(tag, {closeError = null} = {}) {
  let closed = false;
  return {
    tag,
    get isClosed() { return closed; },
    close() {
      if (closeError) throw closeError;
      closed = true;
    }
  };
}

function worker({notifications = [], getNotificationsError = null, clients = []} = {}) {
  const events = {};
  const calls = {
    shown: [],
    posted: [],
    installed: 0,
    claimed: 0
  };
  const activeClients = clients.map(c => ({
    ...c,
    postMessage: msg => {
      calls.posted.push(msg);
      c.postMessage?.(msg);
    }
  }));
  const self = {
    registration: {
      scope,
      showNotification: async (...args) => {
        calls.shown.push(args);
      },
      getNotifications: async () => {
        if (getNotificationsError) throw getNotificationsError;
        return notifications;
      }
    },
    addEventListener: (name, fn) => {
      events[name] = fn;
    },
    skipWaiting: async () => { calls.installed++; },
    clients: {
      claim: async () => { calls.claimed++; },
      matchAll: async () => activeClients,
      openWindow: async () => {}
    }
  };
  const ctx = vm.createContext({self, URL, URLSearchParams, Set, Array});
  ctx.importScripts = (...names) => names.forEach(name => vm.runInContext(source(name.split('?')[0]), ctx));
  vm.runInContext(source('push-sw.js'), ctx);
  const dispatch = async (name, value = {}) => {
    let task;
    events[name]({ ...value, waitUntil: promise => { task = promise; } });
    await task;
  };
  const push = async payload => {
    await dispatch('push', { data: { json: () => payload } });
  };
  return { ctx, calls, dispatch, push };
}

test('alertClear는 clearIds와 tag가 같은 알림만 닫고 다른 tag 알림은 그대로 둔다', async () => {
  const n1 = makeNotification('event-1');
  const n2 = makeNotification('event-2');
  const n3 = makeNotification('event-3');
  const {push, calls} = worker({notifications: [n1, n2, n3]});

  await push({
    kind: 'alertClear',
    clearIds: ['event-1', 'event-3'],
    clearedAt: '2026-11-10T00:00:00Z',
    ticker: 'TEST1',
    title: '알림 해제',
    body: '조건 해제'
  });

  assert.equal(n1.isClosed, true);
  assert.equal(n2.isClosed, false);
  assert.equal(n3.isClosed, true);
  assert.equal(calls.shown.length, 0);
});

test('clearIds가 배열이 아님·빈 문자열·숫자·101자 문자열이면 무시하고, 51개 이상이면 앞 50개만 처리한다', async () => {
  // 배열이 아닌 경우 무시
  for (const badClearIds of [null, undefined, 'event-1', 123, {id: 'event-1'}]) {
    const n = makeNotification('event-1');
    const {push} = worker({notifications: [n]});
    await push({kind: 'alertClear', clearIds: badClearIds});
    assert.equal(n.isClosed, false);
  }
  const nMissing = makeNotification('event-1');
  const {push: pushMissing} = worker({notifications: [nMissing]});
  await pushMissing({kind: 'alertClear'});
  assert.equal(nMissing.isClosed, false);

  // 빈 문자열, 숫자, 101자 문자열 무시 & 유효한 id만 처리
  const nEmpty = makeNotification('');
  const nNum = makeNotification('100');
  const nLong = makeNotification('a'.repeat(101));
  const nValid = makeNotification('event-valid');
  const {push: pushFilter} = worker({notifications: [nEmpty, nNum, nLong, nValid]});

  await pushFilter({
    kind: 'alertClear',
    clearIds: ['', 100, 'a'.repeat(101), 'event-valid']
  });

  assert.equal(nValid.isClosed, true);
  assert.equal(nEmpty.isClosed, false);
  assert.equal(nNum.isClosed, false);
  assert.equal(nLong.isClosed, false);

  // 유효한 문자열이 하나도 없는 경우
  const nUntouched = makeNotification('event-1');
  const {push: pushEmptyValid} = worker({notifications: [nUntouched]});
  await pushEmptyValid({
    kind: 'alertClear',
    clearIds: ['', 123, 'a'.repeat(101)]
  });
  assert.equal(nUntouched.isClosed, false);

  // 51개 이상이면 앞 50개만 처리
  const notifications = Array.from({length: 55}, (_, i) => makeNotification(`event-${i}`));
  const clearIds = Array.from({length: 55}, (_, i) => `event-${i}`);
  const {push: pushLimit} = worker({notifications});

  await pushLimit({kind: 'alertClear', clearIds});

  for (let i = 0; i < 50; i++) {
    assert.equal(notifications[i].isClosed, true, `event-${i}는 닫혀야 함`);
  }
  for (let i = 50; i < 55; i++) {
    assert.equal(notifications[i].isClosed, false, `event-${i}는 닫히지 않아야 함`);
  }
});

test('alertClear일 때 showNotification과 clients의 postMessage가 호출되지 않는다', async () => {
  const n = makeNotification('event-1');
  let clientMessageCount = 0;
  const client = {
    url: scope + 'index.html',
    postMessage: () => { clientMessageCount++; }
  };
  const {push, calls} = worker({notifications: [n], clients: [client]});

  await push({
    kind: 'alertClear',
    clearIds: ['event-1'],
    ticker: 'TEST1',
    title: '알림 해제',
    body: '조건 해제'
  });

  assert.equal(n.isClosed, true);
  assert.equal(calls.shown.length, 0);
  assert.equal(calls.posted.length, 0);
  assert.equal(clientMessageCount, 0);
});

test('getNotifications가 예외를 던져도 push 처리 Promise가 정상 완료된다', async () => {
  const {push} = worker({
    getNotificationsError: new Error('getNotifications 실패')
  });

  await assert.doesNotReject(push({
    kind: 'alertClear',
    clearIds: ['event-1']
  }));
});

test('알림의 close()가 예외를 던져도 정상 완료되고 다른 알림을 닫는다', async () => {
  const nBroken = makeNotification('event-1', {closeError: new Error('close 실패')});
  const nNormal = makeNotification('event-2');
  const {push} = worker({notifications: [nBroken, nNormal]});

  await assert.doesNotReject(push({
    kind: 'alertClear',
    clearIds: ['event-1', 'event-2']
  }));
  assert.equal(nNormal.isClosed, true);
});

test('kind가 없는 일반 푸시는 지금처럼 tag가 eventId인 알림을 띄운다(회귀 확인)', async () => {
  const {push, calls} = worker();

  await push({
    eventId: 'event-reg-1',
    ticker: 'TEST1',
    line: '분할매수 1차',
    title: '매매 플래너 알림',
    body: '기준선 도달'
  });

  assert.equal(calls.shown.length, 1);
  const [title, options] = calls.shown[0];
  assert.equal(options.tag, 'event-reg-1');
  assert.ok(title);
  assert.ok(options.body);
});
