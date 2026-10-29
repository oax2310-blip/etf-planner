const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 모든 보유·가격은 가상 테스트 값. 공유 계산을 DOM 없이 실행한다.
const c=vm.runInThisContext(`(function(){${fs.readFileSync(path.join(__dirname,'../js/ma-ladder.js'),'utf8')}\n${fs.readFileSync(path.join(__dirname,'../js/assets-calc.js'),'utf8')}\nreturn {itemProfit,allocationProfitSummary,allocationSummary,applyTrade,revertTrade};})()`);
const prices={stocks:{'111111':{kind:'국내',close:12000,asOf:'2026-01-02'},AAA:{kind:'해외',close:60,asOf:'2026-01-02'},'BTC-USD':{kind:'코인',close:60000,asOf:'2026-01-02'}},fx:{close:1200}};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≠ ${expected}`);

test('평균매수가 손익은 실제 입력 가격·수량과 현재가로 계산하며 수익·손실·보합을 구분한다',()=>{
  const item={id:'a',ticker:'111111',shares:3,averagePrice:10000,amount:999,base:1},before=JSON.stringify([item,prices]);
  const gain=c.itemProfit(item,prices);
  assert.deepEqual([gain.currency,gain.averagePrice,gain.shares,gain.cost,gain.value,gain.profit],['KRW',10000,3,30000,36000,6000]);near(gain.rate,20);
  const loss=c.itemProfit({...item,averagePrice:15000},prices);assert.equal(loss.profit,-9000);near(loss.rate,-20);
  const flat=c.itemProfit({...item,averagePrice:12000},prices);assert.equal(flat.profit,0);assert.equal(flat.rate,0);
  assert.equal(JSON.stringify([item,prices]),before,'계산은 입력·기준가격·시세를 변경하지 않음');
});

test('해외·코인 손익은 원 통화 기준이며 환율 유무·변동에 영향받지 않는다',()=>{
  const item={id:'a',ticker:'AAA',shares:2.5,averagePrice:50},first=c.itemProfit(item,prices);
  assert.deepEqual([first.currency,first.cost,first.value,first.profit],['USD',125,150,25]);near(first.rate,20);
  for(const fx of [null,{close:1},{close:5000}])assert.deepEqual(c.itemProfit(item,{...prices,fx}),first);
  const coin=c.itemProfit({ticker:'BTC-USD',shares:.001,averagePrice:50000},prices);
  assert.deepEqual([coin.currency,coin.cost,coin.value,coin.profit],['USD',50,60,10]);near(coin.rate,20);
});

test('실제 ETF의 가격·통화를 사용하며 기존 직접 입력 시세 대체와 자동 시세 우선을 유지한다',()=>{
  const item={ticker:'AAA',tradeTicker:'111111',shares:2,averagePrice:10000,tradePrice:11000,tradePriceAt:'2026-01-01T00:00:00Z'};
  let p=c.itemProfit(item,prices);assert.deepEqual([p.currency,p.value,p.profit,p.q.manual],['KRW',24000,4000,undefined]);
  p=c.itemProfit(item,{stocks:{AAA:prices.stocks.AAA}});assert.deepEqual([p.currency,p.value,p.profit,p.q.manual],['KRW',22000,2000,true]);
  delete item.tradePrice;p=c.itemProfit(item,{stocks:{AAA:prices.stocks.AAA}});
  assert.deepEqual([p.currency,p.q,p.profit,p.rate],['KRW',null,null,null],'기준 미국 ETF 가격으로 대체하지 않음');
});

test('평균매수가·수량·시세 누락은 역산하지 않고 계산 가능한 필드만 표시한다',()=>{
  const item={ticker:'111111',shares:2,amount:100,base:5000,buyPlan:{stages:[{price:8000,shares:2,done:true}]}};
  for(const averagePrice of [undefined,null,'',0,-1,Infinity]){
    const p=c.itemProfit({...item,averagePrice},prices);assert.equal(p.averagePrice,null);assert.equal(p.cost,null);assert.equal(p.profit,null);assert.equal(p.rate,null);assert.equal(p.value,24000);
  }
  const unknown=c.itemProfit({...item,shares:undefined,averagePrice:10000},prices);
  assert.deepEqual([unknown.shares,unknown.cost,unknown.value,unknown.profit],[null,null,null,null]);near(unknown.rate,20);
  const missing=c.itemProfit({...item,averagePrice:10000},null);assert.deepEqual([missing.cost,missing.value,missing.profit,missing.rate],[20000,null,null,null]);
  const zero=c.itemProfit({...item,shares:0,averagePrice:10000},prices);assert.deepEqual([zero.cost,zero.value,zero.profit],[0,0,0]);
  assert.equal(c.itemProfit({...item,shares:-1,averagePrice:10000},prices).profit,null);
});

test('동일 종목의 계좌별 손익과 통화별 합계는 매입금액으로 가중하며 다른 통화를 섞지 않는다',()=>{
  const a={id:'a',ticker:'A111111',shares:2,averagePrice:10000},b={id:'b',ticker:'111111',shares:3,averagePrice:15000};
  const p={...prices,stocks:{...prices.stocks,A111111:prices.stocks['111111']}};
  const alloc={cashFx:999,groups:[{id:'g1',items:[a,{id:'u',ticker:'AAA',shares:2,averagePrice:50}]},{id:'g2',items:[b,{id:'missing',ticker:'AAA',shares:1},{id:'amount',ticker:'AAA',amount:100,averagePrice:20},{id:'zero',ticker:'AAA',shares:0,amount:100,averagePrice:20},{id:'empty',ticker:'AAA'}]}]},before=JSON.stringify(alloc);
  const s=c.allocationProfitSummary(alloc,p);
  assert.deepEqual([s.count,s.eligible,s.items.size],[5,3,7]);
  assert.equal(s.items.get('a').profit,4000);assert.equal(s.items.get('b').profit,-9000);
  const krw=s.currencies.get('KRW');assert.deepEqual([krw.cost,krw.value,krw.profit,krw.count],[65000,60000,-5000,2]);near(krw.rate,-5000/65000*100);
  assert.deepEqual(s.tickers.get('111111'),krw);assert.equal(s.tickers.size,2);
  const usd=s.currencies.get('USD');assert.deepEqual([usd.cost,usd.value,usd.profit,usd.count],[100,120,20,1]);near(usd.rate,20);
  assert.equal(JSON.stringify(alloc),before);
  assert.deepEqual(c.allocationProfitSummary({...alloc,cashFx:1},{...p,fx:null}),s,'원화 환산 평가와 손익 집계는 별개');
});

test('금액 보유·0주·미입력 항목만 있으면 합산 손익률을 만들지 않는다',()=>{
  const s=c.allocationProfitSummary({groups:[{items:[{id:'a',ticker:'AAA',amount:10,averagePrice:50},{id:'b',ticker:'AAA',shares:0,averagePrice:50},{id:'c',ticker:'AAA',shares:2}]}]},prices);
  assert.deepEqual([s.count,s.eligible,s.currencies.size,s.tickers.size],[2,0,0,0]);
});

test('매매 연동의 수량 증감·취소는 직접 입력 평균매수가를 보존하며 손익 수량만 따라간다',()=>{
  const item={id:'a',ticker:'111111',shares:10,averagePrice:10000},alloc={classes:[],cash:[],groups:[{id:'g',items:[item]}]};
  c.applyTrade(alloc,prices,'buy:test:0',{sign:1,qty:2,price:12000,currency:'KRW'},'가상 체결',[{id:'a',unit:'shares',n:2}]);
  assert.equal(item.shares,12);assert.equal(item.averagePrice,10000);assert.equal(c.itemProfit(item,prices).profit,24000);
  c.revertTrade(alloc,'buy:test:0');assert.equal(item.shares,10);assert.equal(item.averagePrice,10000);assert.equal(c.itemProfit(item,prices).profit,20000);
  const previous=JSON.stringify(c.allocationSummary(alloc,prices));delete item.averagePrice;
  assert.equal(JSON.stringify(c.allocationSummary(alloc,prices)),previous,'평균매수가는 자산배분 계산에 영향을 주지 않음');
});
