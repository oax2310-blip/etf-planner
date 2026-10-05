const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/alerts.js'), 'utf8');
const prices = fs.readFileSync(path.join(__dirname, '../js/prices.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const valid = extra => ({ticker:'TEST',period:60,unit:'일선',tolerancePct:0.5,enabled:true,...extra});
function load(initial={}){
  let serial=0;
  const ctx=vm.createContext({state:initial,id:()=>`test-${++serial}`});
  vm.runInContext(prices+'\n'+source,ctx);
  return ctx;
}

test('알림을 읽거나 빈 목록을 그리는 것만으로 새 동기화 필드를 만들지 않는다',()=>{
  assert.doesNotThrow(()=>vm.runInNewContext(source,{}),'파일 로드에는 DOM이 필요하지 않아야 한다');
  const ctx=load({plans:[]}), before=JSON.stringify(ctx.state);
  const nodes={alertsList:{},alertsCount:{},alertsSaveStatus:{classList:{toggle(){}}}};
  ctx.$=name=>nodes[name];ctx.$$=()=>[];ctx.connected=()=>false;ctx.sync={};ctx.onEdit=()=>{};
  assert.equal(vm.runInContext('alertRules().length',ctx),0);
  ctx.renderAlerts();
  assert.equal(JSON.stringify(ctx.state),before);
  assert.match(nodes.alertsSaveStatus.textContent,/이 기기에만 저장/);
  assert.match(nodes.alertsList.innerHTML,/등록한 알림이 없습니다/);
});

test('잘못된 알림 저장은 새 필드도 만들지 않고 기존 수신 설정도 바꾸지 않는다',()=>{
  const ctx=load();
  for(const input of [valid({ticker:''}),valid({period:0}),valid({period:401}),valid({period:1.5}),valid({period:''}),valid({unit:'분봉'}),valid({tolerancePct:''}),valid({tolerancePct:-1}),valid({tolerancePct:11}),valid({tolerancePct:Infinity})]){
    assert.ok(ctx.writeAlertRule(input).error);
    assert.equal(ctx.state.alerts,undefined);
  }
  ctx.state.alerts={subscriptions:[{endpoint:'https://push.example.test/one'}],rules:[]};
  const before=JSON.stringify(ctx.state);
  assert.ok(ctx.writeAlertRule(valid({ticker:'한글종목'})).error);
  assert.equal(JSON.stringify(ctx.state),before);
});

test('수집기가 지원하는 국내 코드와 미국 심볼을 저장하고 공백·대소문자를 맞춘다',()=>{
  const ctx=load();
  for(const ticker of ['000001','A000001','Q000001','1AB2CD','TEST','TEST.A','TEST-A','TEST/A'])assert.equal(ctx.alertTickerValid(ticker),true,ticker);
  for(const ticker of ['','00001','한국ETF','TEST$','TEST WITH SPACE','TESTABCDEFGHI'])assert.equal(ctx.alertTickerValid(ticker),false,ticker);
  const result=ctx.writeAlertRule(valid({ticker:' test.a '}));
  assert.equal(result.value.ticker,'TEST.A');
  assert.equal(ctx.state.alerts.rules[0].ticker,'TEST.A');
});

test('알림 수정·일시 중지·마지막 삭제가 수신 설정과 기존 필드를 보존한다',()=>{
  const ctx=load({alerts:{subscriptions:[{endpoint:'https://push.example.test/one'}],futureSetting:'keep',rules:[]}});
  const first=ctx.writeAlertRule(valid()).value;
  assert.equal(ctx.setAlertRuleEnabled(first.id,false),true);
  const edited=ctx.writeAlertRule(valid({period:400,unit:'개월선',tolerancePct:0,enabled:false}),first.id).value;
  assert.equal(edited.id,first.id);
  assert.equal(edited.enabled,false);
  assert.equal(ctx.state.alerts.rules.length,1);
  assert.equal(ctx.state.alerts.futureSetting,'keep');
  assert.deepEqual(plain(ctx.state.alerts.subscriptions),[{endpoint:'https://push.example.test/one'}]);
  assert.equal(ctx.removeAlertRule(first.id),true);
  assert.deepEqual(plain(ctx.state.alerts.rules),[]);
  assert.equal(ctx.state.alerts.subscriptions.length,1);
  assert.equal(ctx.removeAlertRule(first.id),false);
});

test('같은 종목·기준선 중복과 다른 기기에서 삭제한 규칙의 저장을 거부한다',()=>{
  const ctx=load(), first=ctx.writeAlertRule(valid()).value;
  const before=JSON.stringify(ctx.state);
  assert.ok(ctx.writeAlertRule(valid({ticker:'test',tolerancePct:1})).error);
  assert.ok(ctx.writeAlertRule(valid(),'deleted-on-other-device').error);
  assert.equal(JSON.stringify(ctx.state),before);
  assert.equal(ctx.writeAlertRule(valid({unit:'주선'})).value.unit,'주선');
  assert.ok(ctx.writeAlertRule(valid({unit:'주선'}),first.id).error,'수정도 다른 규칙과 중복할 수 없다');
});

test('마지막 시세의 가격·기준선·간격을 표시하고 허용 범위 경계를 정확히 포함한다',()=>{
  const ctx=load(), rule=valid({period:2}), quote={kind:'해외',asOf:'2026-10-02',close:100.5,ma:{},closes:{D:[99,101]}};
  const data={stocks:{TEST:quote}};
  const info=ctx.alertQuoteInfo(rule,data);
  assert.equal(info.current,100.5);assert.equal(info.line,100);assert.ok(Math.abs(info.gapPct-0.5)<1e-10);assert.equal(info.near,true);
  quote.close=100.5001;assert.equal(ctx.alertQuoteInfo(rule,data).near,false);
  quote.close=99.5;assert.equal(ctx.alertQuoteInfo(rule,data).near,true);
  rule.period=3;assert.equal(ctx.alertQuoteInfo(rule,data).line,null);
  assert.equal(ctx.alertQuoteInfo(rule,null).current,null);
});

test('비트코인 BTC-USD를 알림 종목으로 받고 가격을 달러로 표시한다',()=>{
  const ctx=load();
  assert.equal(ctx.writeAlertRule(valid({ticker:' btc-usd ',period:20,unit:'주선'})).value.ticker,'BTC-USD');
  assert.match(ctx.alertRuleInput(valid({ticker:'비트코인'})).error,/BTC-USD/);
  Object.assign(ctx,{esc:v=>String(v),priceText:(v,c)=>`${c} ${v}`,priceStamp:()=>'',
    priceData:{stocks:{'BTC-USD':{kind:'코인',asOf:'2026-10-03',close:65432.1,ma:{'20주선':65000}}}}});
  const html=ctx.alertRuleCard(ctx.state.alerts.rules[0]);
  assert.match(html,/USD 65432\.1/);
  assert.match(html,/USD 65000/);
});
