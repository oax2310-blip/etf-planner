// 가상 기록만 사용한다. 검증은 원본·옛 선택 필드·체결 기록을 변경하지 않아야 한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const validate=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/data-validation.js'),'utf8')+'\nexternalData');
const planner=()=>({plans:[{id:'example',stages:30,checked:[true,false],holdings:[{name:'예시',shares:12}],note:'기존 메모'}],futures:{positions:[]},actions:{}});

test('옛 숫자 문자열·부분 체결·미입력 필드·호환 데이터를 추가·삭제·변경 없이 검증한다',()=>{
  const data=planner();data.plans[0].stages='30';
  data.plans[0].fills={'0':{plannedQty:10,qty:3,price:100,execution:{group:true,qty:3,sourcePrice:100,rows:[{plannedQty:10,qty:3}]}}};
  data.futures.rolls=[{legacy:true}];data.futures.rebuy={steps:'10',cuts:[null,{contracts:2,price:100},{contracts:1,price:98,month:'202612',settlementPrice:101},{contracts:1,price:96,manual:true}],stages:[{name:'25분봉',price:null,buys:[null,{shares:1,execPrice:99},{contracts:1,price:97,month:'202612'},{contracts:1,price:96,manual:true}]}]};
  data.rebuy={items:[{id:'r',stages:[{name:'25일선',price:100}],cuts:[],oldField:{keep:true}}]};
  data.futureCompatibleField={keep:'보존'};
  const before=JSON.stringify(data);assert.equal(validate.planner(data),data);assert.equal(JSON.stringify(data),before);
  assert.equal(Object.hasOwn(data.plans[0],'startAuto'),false);
});

test('정상 문자열의 HTML 문자·한글 메모는 삭제하거나 이중 변환하지 않는다',()=>{
  const data=planner();data.plans[0].title='<img src=x onerror="synthetic()"> & 메모';
  assert.equal(validate.planner(data).plans[0].title,data.plans[0].title);
});

for(const stages of ['<img src=x onerror="synthetic()">','2" onmouseover="synthetic()','Infinity','1e309',0,-1,251,2.5,true,[],{},null,'']){
  test(`잘못된 회차 수 거부 (${typeof stages}:${JSON.stringify(stages).slice(0,16)})`,()=>{
    const data=planner();data.plans[0].stages=stages;const before=JSON.stringify(data);
    assert.throws(()=>validate.planner(data),/plans\[0\]\.stages/);assert.equal(JSON.stringify(data),before);
  });
}

test('회차 수의 기존 1회·상한 250회·누락된 옛 필드를 허용한다',()=>{
  for(const stages of [1,250,'250',undefined]){const data=planner();if(stages===undefined)delete data.plans[0].stages;else data.plans[0].stages=stages;assert.doesNotThrow(()=>validate.planner(data));}
});

test('중첩 목록·숫자·불리언 구조가 잘못된 입력과 예약된 프로토타입 필드를 거부한다',()=>{
  const invalid=[
    {...planner(),plans:[null]}, {...planner(),futures:[]}, {...planner(),rebuy:{items:'not-a-list'}},
    {...planner(),plans:[{stages:2,holdings:[[]]}]}, {...planner(),plans:[{stages:2,checked:['true']}]},
    {...planner(),futures:{targetPrice:'"><img src=x onerror="synthetic()">'}},
    {...planner(),alerts:{rules:[{period:401}]}},
    {...planner(),futures:{rebuy:{cuts:[{contracts:1,price:100,month:{}}]}}}, {...planner(),futures:{rebuy:{stages:[{name:'25일선',buys:[{contracts:1,price:100,month:['202612']}]}]}}},
    {...planner(),futures:{rebuy:{cuts:[{contracts:1,price:100,manual:'false'}]}}}, {...planner(),futures:{rebuy:{stages:[{name:'25일선',buys:[{contracts:1,price:100,manual:1}]}]}}},
    JSON.parse('{"plans":[],"futures":{},"actions":{},"__proto__":{"polluted":true}}'),
    {...planner(),legacy:{constructor:{prototype:{polluted:true}}}}
  ];
  for(const data of invalid)assert.throws(()=>validate.planner(data),/기존 기록은 변경하지 않았습니다/);
  assert.equal({}.polluted,undefined);
});

test('목록 크기·중첩 깊이를 제한하며 값이 오류 메시지로 노출되지 않는다',()=>{
  const data=planner();data.plans[0].stages='synthetic-private-value';
  assert.throws(()=>validate.planner(data),error=>!error.message.includes('synthetic-private-value'));
  const deep=planner();let current=deep;for(let i=0;i<45;i++){current.extra={};current=current.extra;}
  assert.throws(()=>validate.planner(deep),/크기·구조/);
  const long=planner();long.extra=Array(10001).fill(0);assert.throws(()=>validate.planner(long),/목록 길이/);
});

test('자산 배분·분할매수·저축의 기존 필드와 체결을 그대로 보존한다',()=>{
  const data={version:1,allocation:{groups:[{id:'g',items:[{id:'i',target:'10',amount:20,buyPlan:{lines:{names:['25분봉'],startLine:'25분봉'},buys:{'25분봉:0':{shares:2,price:100}},stages:[{id:'s',amount:3}]}}]}],trades:{'buy:i:25분봉:0':{qty:2,items:[{id:'i',shares:2,exact:2.25}]}}},savings:{scenarios:[{name:'옛 계획',endAge:'60',stages:[{age:40,salary:200}]}]}};
  const before=JSON.stringify(data);assert.equal(validate.assets(data),data);assert.equal(JSON.stringify(data),before);
});

test('자산 JSON의 중첩 구조와 표시되는 숫자 문자열을 검증한다',()=>{
  for(const data of [
    {allocation:{groups:[null]}}, {allocation:{groups:[{items:'not-a-list'}]}},
    {allocation:{groups:[{items:[{target:'"><img src=x onerror="synthetic()">'}]}]}},
    {allocation:{trades:{k:{items:[{id:'i',shares:0,exact:'<img src=x onerror="synthetic()">'}]}}}},
    {ledger:{years:[{year:'<img src=x onerror="synthetic()">'}]}},
    {savings:{scenarios:[{endAge:'<img src=x onerror="synthetic()">'}]}}
  ])assert.throws(()=>validate.assets(data),/기록 형식/);
});

test('월별 RP·달러 RP·환율은 누락된 옛 기록·빈 배열·null·허용 범위 숫자를 변경 없이 허용한다',()=>{
  for(const month of [{m:1,balances:['옛 형식 보존']},{m:1,rp:[]},{m:1,rp:[null,0,1200.5,null]},{m:1,rp:[0,1300],rpUsd:[0,1],rpFx:[null,1300.1234]}]){
    const data={ledger:{years:[{year:2026,months:[month]}]}};
    const before=JSON.stringify(data);assert.equal(validate.assets(data),data);assert.equal(JSON.stringify(data),before);
  }
  const month={m:1};validate.assets({ledger:{years:[{year:2026,months:[month]}]}});
  assert.equal(Object.hasOwn(month,'rp'),false);
});

test('월별 RP·달러 RP·환율의 잘못된 배열 형식과 음수·문자열·객체·유한하지 않은 원소를 거부한다',()=>{
  for(const key of ['rp','rpUsd','rpFx'])for(const rp of [null,0,'1200',{},[-1],['1200'],[{}],[[]],[true],[undefined],[NaN],[Infinity],Array(1)]){
    const data={ledger:{years:[{year:2026,months:[{m:1,[key]:rp}]}]}};
    assert.throws(()=>validate.assets(data),/기록 형식/,`${key}`);
  }
  assert.throws(()=>validate.assets({ledger:{years:[{year:2026,months:[{m:1,rpFx:[0]}]}]}}),/기록 형식/,'환율 0은 거부');
});


test('이동평균 종료 설정은 변경 없이 불러오고 잘못된 필드 형식은 거부한다',()=>{
  const data=planner();data.futures.buyPlan={startLine:'32일선',endLine:'19일선',endPrice:1370,manualEndPrice:1380,contracts:7,units:['일선']};
  const before=JSON.stringify(data);assert.equal(validate.planner(data),data);assert.equal(JSON.stringify(data),before);
  data.futures.buyPlan.endLine={};assert.throws(()=>validate.planner(data),/endLine/);
  data.futures.buyPlan.endLine='19일선';data.futures.buyPlan.manualEndPrice='잘못된 값';assert.throws(()=>validate.planner(data),/manualEndPrice/);
});

test('달러선물 손절 하단선은 변경 없이 불러오고 문자열이 아니면 거부한다',()=>{
  const data=planner();data.futures.rebuy={lowPrice:1400,floorLine:'20개월선',floorPrice:1310.46,auto:{at:'2026-10-04T00:00:00Z',floorPrice:1310.46}};
  const before=JSON.stringify(data);assert.equal(validate.planner(data),data);assert.equal(JSON.stringify(data),before);
  data.futures.rebuy.floorLine=20;assert.throws(()=>validate.planner(data),/floorLine/);
});

test('여러 월물에서 판 손절의 월물별 내역(legs)은 기록·계약·평균가 형식만 받고 그대로 둔다',()=>{
  const data=planner();data.futures.rebuy={cuts:[{contracts:3,price:1300,month:'202612',settlementPrice:1446.67,legs:[{month:'202611',contracts:1,settlementPrice:1440},{month:'202612',contracts:2,settlementPrice:1450}]}]};
  const before=JSON.stringify(data);validate.planner(data);assert.equal(JSON.stringify(data),before);
  for(const legs of ['202611',[null],[{month:{},contracts:1,settlementPrice:1440}],[{month:'202611',contracts:'x',settlementPrice:1440}],[{month:'202611',contracts:1,settlementPrice:[1440]}]]){
    const bad=planner();bad.futures.rebuy={cuts:[{contracts:1,price:1300,month:'202611',settlementPrice:1440,legs}]};
    assert.throws(()=>validate.planner(bad),/legs/,JSON.stringify(legs));
  }
});
