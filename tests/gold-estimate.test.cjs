const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const api=vm.runInNewContext(read('js/gold-estimate.js')+';goldEstimate');
const now=Date.parse('2026-11-06T10:12:00+09:00');
const estimate=()=>({close:81.52,at:'2026-11-06T10:12:00+09:00',baseDate:'2026-11-05',baseClose:80,source:'GC=F',check:'PAXG-USD',changePct:1.9,checkPct:1.8});
const prices=()=>({updatedAt:estimate().at,stocks:{GLDM:{kind:'해외',close:80,asOf:'2026-11-05',ma:{'25일선':82},estimate:estimate()}}});
const item={section:'금(골드)',ticker:'GLDM'},allocation={groups:[{items:[item]}]};

test('수집기와 동일한 소분류·실물 ETF 예시 표',()=>{
  for(const example of JSON.parse(read('tests/gold-eligibility-cases.json')))
    assert.equal(api.eligible(example),example.eligible,JSON.stringify(example));
});

test('시세 검증은 숫자형 양수·실제 날짜·ISO 시각·고정 원천만 받는다',()=>{
  assert.equal(api.validate(estimate()).close,81.52);
  assert.equal(api.validate({...estimate(),changePct:-1,checkPct:0}).changePct,-1);
  for(const extra of [{close:0},{close:-1},{close:'81.52'},{close:true},{close:Infinity},{baseClose:'80'},
    {baseClose:NaN},{at:'2026-11-06'},{at:'2026-02-30T10:00:00Z'},{at:'2026-11-06T10:12:00'},
    {baseDate:'2026-2-03'},{baseDate:'2026-02-30'},{source:'GLDM'},{check:'BTC-USD'},
    {changePct:'1.9'},{checkPct:NaN}])assert.equal(api.validate({...estimate(),...extra}),null,JSON.stringify(extra));
  assert.equal(Object.hasOwn(api.validate({...estimate(),unsafe:'<img src=x onerror=alert(1)>'}),'unsafe'),false);
});

test('유효 시세의 같은 실행·base·60분 양쪽 경계와 티커 단위 적용',()=>{
  const doc=prices(),before=JSON.stringify(doc);
  assert.equal(api.info(doc,item,allocation,now).close,81.52);
  assert.ok(api.info(doc,item,allocation,now+60*60*1000));
  assert.equal(api.info(doc,item,allocation,now+60*60*1000+1),null);
  assert.equal(api.info(doc,item,allocation,now-1),null);
  for(const extra of [{baseDate:'2026-11-04'},{baseClose:80.01},{at:'2026-11-06T10:11:00+09:00'}]){
    const q=prices();Object.assign(q.stocks.GLDM.estimate,extra);assert.equal(api.info(q,item,allocation,now),null);
  }
  const sameTicker={section:'현금',ticker:'gldm'};
  assert.equal(api.info(doc,sameTicker,allocation,now).close,81.52,'같은 기준 티커의 모든 매수 항목');
  assert.equal(api.info(doc,item,{groups:[{items:[sameTicker]}]},now),null);
  assert.equal(api.current(doc.stocks.GLDM,doc,item,allocation,now).close,81.52);
  assert.equal(JSON.stringify(doc),before,'시세 원본 유지');
  const raw=doc.stocks.GLDM;delete raw.estimate;
  assert.equal(api.current(raw,doc,item,allocation,now),raw,'estimate 없는 파일 호환');
  raw.estimate=estimate();raw.stale=true;assert.equal(api.info(doc,item,allocation,now),null);
});

test('slimPrices 확장 복사본에 검증된 estimate만 붙이며 원본 봉/MA와 종가는 유지한다',()=>{
  const context=vm.createContext({});
  vm.runInContext(read('js/ma-ladder.js')+'\n'+read('js/prices.js')+'\n'+read('js/gold-estimate.js'),context);
  const doc=prices();doc.stocks.GLD={...doc.stocks.GLDM,estimate:{...estimate(),source:'other'}};
  doc.stocks.GLDM.daily=[['2026-11-05',80,80,80,80,1]];context.doc=doc;
  const next=vm.runInContext('goldEstimate.attach(slimPrices(doc),doc)',context);
  assert.equal(next.stocks.GLDM.estimate.close,81.52);assert.equal(next.stocks.GLDM.close,80);
  assert.equal(next.stocks.GLDM.ma['25일선'],82);assert.equal(next.stocks.GLD.estimate,undefined);
  assert.equal(doc.stocks.GLDM.daily[0][4],80);
});

test('티커 변경은 완료·부분 체결만 확인하며 입력 예정 주수는 체결로 보지 않는다',()=>{
  for(const buyPlan of [{buys:{end:{price:80,actual:1}}},{stages:[{done:true,price:80}]},{stages:[{partial:true,shares:1}]}]){
    const before={ticker:'GLDM',buyPlan},after={ticker:'GDX'};
    const message=api.tickerChangeMessage(before,after);
    assert.match(message,/완료 회차의 기준가는 옛 티커 가격/);assert.match(message,/이동평균은 다음 수집 뒤/);
    assert.match(message,/실물 금 ETF 목록 밖/);
    assert.doesNotMatch(api.tickerChangeMessage(before,{ticker:'IAUM'}),/꺼집니다/);
    assert.equal(api.tickerChangeMessage(before,{ticker:'gldm'}),'');
  }
  for(const buyPlan of [{stages:[{shares:5,amount:1}]},{buys:{}},{}])
    assert.equal(api.tickerChangeMessage({ticker:'GLDM',buyPlan},{ticker:'GDX'}),'');
});
