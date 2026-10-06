const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=['prices.js','rebuy.js','trade-alerts.js'].map(f=>fs.readFileSync(path.join(__dirname,'../js',f),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({});vm.runInContext(code,ctx);return ctx;};
const plain=v=>JSON.parse(JSON.stringify(v));
const sale=(extra={})=>({id:'demo-sale',ticker:'AAA',currency:'USD',startPrice:100,endPrice:80,startLabel:'직접',endLabel:'25개월선',stages:3,checked:[],...extra});
const rebuy=(extra={})=>({id:'demo-rebuy',ticker:'TEST',lowPrice:10000,shares:1000,stepPct:1,sellPct:1,steps:3,cuts:[],currentPrice:9500,stages:[{name:'25분봉',price:9600,done:false},{name:'25일선',price:9700,done:false}],...extra});
const quote=(ma={},extra={})=>({updatedAt:'2026-10-03T01:00:00Z',stocks:{AAA:{kind:'해외',asOf:'2026-10-02',close:105,ma,...extra}},futures:{}});

test('기존 기록은 알림 화면을 읽어도 변경되지 않고 새 알림은 OFF다',()=>{
  const ctx=load(),data={plans:[sale()],rebuy:{items:[rebuy()]}};
  const before=JSON.stringify(data);
  assert.deepEqual(plain(ctx.buildTradeAlertRules(data,quote())),[]);
  assert.equal(JSON.stringify(data),before);
});
test('첫 매도와 1회차가 같은 알림을 공유하고 전체 ON 후 개별 OFF·완료를 제외한다',()=>{
  const ctx=load(),p=sale();ctx.setTradePlanAll(p,true);ctx.setTradePlanAlert(p,1,false);
  let rules=plain(ctx.buildTradeAlertRules({plans:[p]},quote()));
  assert.deepEqual(rules.map(r=>[r.label,r.targetPrice,r.condition]),[['분할매도 첫 매도',100,'down'],['분할매도 3회',80,'down']]);
  p.checked[0]=true;rules=plain(ctx.buildTradeAlertRules({plans:[p]},quote()));assert.equal(rules.length,1);
  ctx.setTradePlanAll(p,false);assert.equal(ctx.buildTradeAlertRules({plans:[p]},quote()).length,0);
});
test('닫힌 화면의 자동 기준가·통화·보간은 시세 채우기와 같고 원본을 바꾸지 않는다',()=>{
  const ctx=load(),p=sale({startAuto:true,startLabel:'60일선',notify:{start:true,sales:true}}),data={plans:[p]},before=JSON.stringify(data);
  const rules=plain(ctx.buildTradeAlertRules(data,quote({'60일선':110,'25개월선':90})));
  assert.deepEqual(rules.map(r=>r.targetPrice),[110,100,90]);assert.equal(JSON.stringify(data),before);
  assert.equal(ctx.buildTradeAlertRules(data,quote({}, {kind:'국내'})).length,0);
  const krw=sale({currency:'KRW',startAuto:true,startLabel:'60일선',notify:{start:true}});
  assert.equal(ctx.buildTradeAlertRules({plans:[krw]},quote({'60일선':101.6},{kind:'국내'}))[0].targetPrice,102);
});
test('자동 시세 갱신은 같은 알림 이력, 직접 기준가 변경은 새 이력으로 판정한다',()=>{
  const ctx=load(),p=sale({startAuto:true,startLabel:'60일선',notify:{start:true}}),get=q=>plain(ctx.buildTradeAlertRules({plans:[p]},q))[0];
  const first=get(quote({'60일선':100,'25개월선':80})),second=get(quote({'60일선':101,'25개월선':81}));
  assert.notEqual(first.targetPrice,second.targetPrice);assert.equal(first.revision,second.revision);
  p.auto={at:'2026-10-03T01:00:00Z',startPrice:100,endPrice:80};p.startPrice=98;
  const overridden=get(quote({'60일선':100,'25개월선':80}));assert.equal(overridden.targetPrice,98);assert.notEqual(overridden.revision,first.revision);
  const later=get(quote({'60일선':101,'25개월선':81}));assert.equal(later.targetPrice,101);
});
test('비트코인 분할매도 알림은 BTC-USD 코인 시세와 자동 기준가를 사용한다',()=>{
  const ctx=load(),p=sale({ticker:'비트코인',startAuto:true,startLabel:'60일선',notify:{start:true,sales:true},checked:[false,true,false]}),q=quote();
  q.stocks['BTC-USD']={kind:'코인',asOf:'2026-10-02',close:61000,ma:{'60일선':60000,'25개월선':50000}};
  const before=JSON.stringify(p),rules=plain(ctx.buildTradeAlertRules({plans:[p]},q));
  assert.deepEqual(rules.map(r=>[r.ticker,r.quoteKey,r.quoteKind,r.targetPrice,r.condition]),[
    ['BTC-USD','BTC-USD','코인',60000,'down'],['BTC-USD','BTC-USD','코인',50000,'down'],
  ]);
  assert.equal(JSON.stringify(p),before);
  assert.equal(ctx.buildTradeAlertRules({plans:[{...p,currency:'KRW'}]},q).length,0);
  const etf=ctx.buildTradeAlertRules({plans:[{...p,ticker:'BTC'}]},q);
  assert.ok(etf.every(r=>r.quoteKind==='해외'&&r.ticker==='BTC'),'BTC 심볼은 미국 ETF로 남긴다');
});
test('원시 봉과 브라우저 종가 캐시로 계산한 기준가가 같다',()=>{
  const ctx=load(),p=sale({startAuto:true,startLabel:'2일선',endLabel:'직접',notify:{start:true}}),q=quote();
  q.stocks.AAA.daily=[['2026-10-01',0,0,0,98,0],['2026-10-02',0,0,0,102,0]];
  assert.deepEqual(plain(ctx.buildTradeAlertRules({plans:[p]},q)),plain(ctx.buildTradeAlertRules({plans:[p]},ctx.slimPrices(q))));
  assert.equal(ctx.buildTradeAlertRules({plans:[p]},q)[0].targetPrice,100);
});
test('달러선물은 실제 보유 근월물 시세를 사용하고 매수 완료·OFF 일선을 제외한다',()=>{
  const ctx=load(),f={positions:[{month:'202611',contracts:2},{month:'202610',contracts:0},{month:'202612',contracts:1}],notify:{levels:true},levels:[{days:25,price:1,contracts:0,tranches:[]},{days:60,price:2,notify:false,tranches:[]},{days:80,price:3,contracts:1,tranches:[{completed:true}]}]},q=quote();
  q.futures['202611']={kind:'달러선물',asOf:'2026-10-02',close:1300,ma:{'25일선':1350.126}};
  const rules=plain(ctx.buildTradeAlertRules({futures:f},q));assert.equal(rules.length,1);assert.deepEqual([rules[0].ticker,rules[0].targetPrice,rules[0].quoteGroup],['202611',1350.13,'futures']);
  f.positions=[];assert.equal(ctx.buildTradeAlertRules({futures:f},q).length,0);
});
test('재매수의 이탈·회차 손절·기한·단계를 기존 배분에 연결하고 빈 추정가격을 제외한다',()=>{
  const ctx=load(),r=rebuy({notify:{breakdown:true,cuts:true,buys:true,deadlines:true},cuts:[{shares:10,price:9900}]});
  r.stages.push({name:'60분봉',price:0,done:false});
  const rules=plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null));
  assert.ok(rules.some(x=>x.label==='재매수 신저점 이탈'&&x.condition==='below'));
  assert.ok(!rules.some(x=>x.label==='재매수 손절 1회'));
  assert.ok(rules.some(x=>x.label==='재매수 손절 2회'&&x.targetPrice===9800));
  assert.ok(rules.some(x=>x.label==='재매수 1회 기한'&&x.targetPrice===9900));
  assert.ok(rules.some(x=>x.label==='재매수 25선'&&x.targetPrice===9600),'옛 이름 25분봉은 25선으로 알린다');
  assert.ok(!rules.some(x=>x.label==='재매수 60선'));
  const s=ctx.rebuySummary(r);for(const x of rules.filter(x=>x.id.includes(':buy:')))assert.ok(s.plan[Number(x.id.split(':').at(-1))]>0);
});
test('재매수 시작 뒤 손절·이탈은 멈추고 완료 단계·다 채운 기한·배분 없는 단계는 제외한다',()=>{
  const ctx=load(),r=rebuy({notify:{breakdown:true,cuts:true,buys:true,deadlines:true},cuts:[{shares:10,price:9900}]});
  r.stages[0]={name:'25분봉',price:9600,done:true,shares:11,execPrice:9600};
  assert.equal(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null).length,0);
  r.stages[0].shares=2;
  const rules=plain(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null));
  assert.ok(rules.every(x=>!x.label.includes('손절')&&!x.label.includes('이탈')&&x.label!=='재매수 25선'));
  assert.ok(rules.some(x=>x.label==='재매수 25일선'));
  r.stages[1].price=11000;r.stages[0].done=false;
  assert.ok(!ctx.buildTradeAlertRules({rebuy:{items:[r]}},null).some(x=>x.label==='재매수 25일선'));
});
// 데이터 저장소 scripts/ma_alerts.py의 TRADE_LABEL_RE와 같게 둔다 — 수집 작업은 라벨 하나라도 거부하면 연결 알림 전체를 보내지 않는다
const STAGE_LABEL='(?:[1-9]\\d{0,2}(?:일선|주선|개월선|분봉|단계|선))';
const TRADE_LABEL_RE=new RegExp(`^(?:분할매도 (?:첫 매도|[1-9]\\d{0,2}회)|달러선물 (?:[1-9]\\d{0,2}일선|추가 [1-9]\\d{0,2}|신저점 손절 시작|손절 [1-9]\\d?회|[1-9]\\d?회 손절 환율 복귀|재매수 ${STAGE_LABEL})|재매수 (?:신저점 이탈|손절 [1-9]\\d?회|[1-9]\\d?회 기한|${STAGE_LABEL}))$`);
test('재매수 단계 알림 이름은 N선·N일선, 직접 정한 이름은 N단계로 수집 작업의 라벨 형식을 지킨다',()=>{
  const ctx=load(),notify={breakdown:true,cuts:true,buys:true,deadlines:true};
  const r=rebuy({notify,cuts:[{shares:10,price:9900}]});r.stages.push({name:'내 단계',price:9650,done:false});
  const f={positions:[{month:'202612',contracts:20}],levels:[],rebuy:{lowPrice:1400,floorPrice:1300,contracts:20,steps:3,currentPrice:1360,notify,
    cuts:[{contracts:3,price:1399.7,targetPrice:1400}],stages:[{name:'25분봉',price:1370},{name:'내 단계',price:1375},{name:'25일선',price:1380}]}};
  const before=JSON.stringify(f),rules=plain(ctx.buildTradeAlertRules({rebuy:{items:[r]},futures:f},null)),labels=rules.map(x=>x.label);
  assert.deepEqual(rules.filter(x=>x.id.includes(':buy:')).map(x=>x.label),['달러선물 재매수 25선','달러선물 재매수 2단계','달러선물 재매수 25일선','재매수 25선','재매수 25일선','재매수 3단계']);
  assert.ok(labels.includes('달러선물 신저점 손절 시작')&&labels.includes('달러선물 손절 2회')&&labels.includes('달러선물 1회 손절 환율 복귀'));
  for(const label of labels)assert.match(label,TRADE_LABEL_RE);
  assert.equal(JSON.stringify(f),before,'알림 계산은 옛 이름 기록을 바꾸지 않는다');
});
test('종류별 전체 ON/OFF는 개별 예외를 초기화하며 알림에 수량·메모를 포함하지 않는다',()=>{
  const ctx=load(),r=rebuy({note:'private-memo',cuts:[{shares:10,price:9900}]});
  ctx.setTradeRebuyAll(r,'buys',true);ctx.setTradeRebuyAlert(r,'buys',0,false);
  assert.equal(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null).filter(x=>x.id.includes(':buy:')).length,1);
  ctx.setTradeRebuyAll(r,'buys',true);const out=JSON.stringify(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null));
  assert.ok(!out.includes('private-memo'));assert.ok(!out.includes('shares'));assert.ok(!out.includes('amount'));
  ctx.setTradeRebuyAll(r,'buys',false);assert.equal(ctx.buildTradeAlertRules({rebuy:{items:[r]}},null).length,0);
});
test('실제 완료 체크 핸들러가 체결 기록을 저장하고 이탈·남은 손절 알림을 멈춘다',()=>{
  const ctx=load(),r=rebuy({notify:{breakdown:true,cuts:true,buys:true,deadlines:true},cuts:[{shares:10,price:9900}]}),input={dataset:{stageDone:'0'},checked:true};
  ctx.state={rebuy:{items:[r]},selectedRebuy:r.id};ctx.$$=()=>[input];let saved=0,redrawn=0;
  ctx.save=()=>saved++;ctx.renderRebuy=()=>redrawn++;ctx.alert=msg=>{throw Error(msg);};
  const source=fs.readFileSync(path.join(__dirname,'../js/rebuy.js'),'utf8'),start=source.indexOf('  $$("[data-stage-done]").forEach('),end=source.indexOf('  onEdit("[data-stage-price]"',start);
  assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),ctx);
  input.onchange();assert.equal(r.stages[0].done,true);assert.equal(r.stages[0].execPrice,9600);assert.ok(r.stages[0].shares>0);assert.equal(saved,1);assert.equal(redrawn,1);
  let rules=ctx.buildTradeAlertRules(ctx.state,null);assert.ok(rules.every(x=>!x.label.includes('손절')&&!x.label.includes('이탈')&&x.label!=='재매수 25선'));
  input.checked=false;input.onchange();assert.equal(r.stages[0].done,false);assert.equal(r.stages[0].execPrice,null);
  rules=ctx.buildTradeAlertRules(ctx.state,null);assert.ok(rules.some(x=>x.label==='재매수 신저점 이탈'));
});
