const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// 순자산·기준 연월은 저축 계획의 마지막 실제 기록만 읽는다. 모든 기록은 회귀 검증용 가짜 값이다.
const root=path.join(__dirname,'..');
const {installmentAssetReference,simulateSavings}=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n;\n')};return {installmentAssetReference,simulateSavings};})()`);
const reference=actual=>installmentAssetReference({version:1,savings:{actual}});
const result=(amount,ym=amount===null?null:'2026-10')=>({amount,ym});

test('무이자 순자산 참조: 저축 계획의 연월상 마지막 실제 기록을 원 단위 그대로 사용한다',()=>{
  const actual=[{ym:'2026-10',total:1234567},{ym:'2025-12',total:500000},{ym:'2026-09',total:999999}];
  assert.deepEqual(reference(actual),result(1234567),'배열의 마지막 항목이나 월별 합계가 아닌 최근 월의 실제 총액');
  assert.deepEqual(reference([{ym:'2026-12',total:200000},{ym:'2027-01',total:210000},{ym:'2026-01',total:100000}]),result(210000,'2027-01'));
  assert.deepEqual(reference([{ym:'0001-01',total:1}]),result(1,'0001-01'));
});

test('무이자 순자산 참조: 자산 배분·월별 손익·직접 입력 비교조건은 저축 실제 기록에 합산하지 않는다',()=>{
  const doc={version:1,savings:{actual:[{ym:'2026-10',total:1234567}]},
    allocation:{total:999999,groups:[{id:'g',items:[{id:'a',amount:500}]}],cash:[{currency:'USD',amount:100}]},
    ledger:{years:[{year:2026,accounts:[],months:[{m:10,total:1234567}]}]},installments:{netAssets:7654321}};
  const prices={fx:{close:1000,asOf:'2026-10-01'}},before=JSON.stringify([doc,prices]);
  assert.deepEqual(installmentAssetReference(doc,prices),result(1234567));
  assert.deepEqual(installmentAssetReference(doc,null),result(1234567),'시세·환율 조회 여부와 무관한 저장 순자산');
  assert.equal(JSON.stringify([doc,prices]),before);
});

test('무이자 순자산 참조: 실제 저축 기록이 없으면 예상액이나 다른 메뉴로 기준값을 만들지 않는다',()=>{
  for(const doc of [null,{version:1},{version:1,savings:{}},{version:1,savings:{actual:[]}},
    {version:1,savings:{actual:null,scenarios:[{id:'s',salary:500000,returnRate:10}]}},
    {version:1,savings:{actual:{ym:'2026-10',total:100000},total:100000,initial:200000}},
    {version:1,allocation:{total:1000},ledger:{years:[{year:2026,months:[{m:10,total:100000}]}]}}
  ])assert.deepEqual(installmentAssetReference(doc,null),result(null));
});

test('무이자 순자산 참조: 잘못된 연월·빈 금액·무한값은 건너뛰고 이전의 유효한 실제 기록을 유지한다',()=>{
  const invalid=[null,{ym:'2026-13',total:200000},{ym:'2026-1',total:200000},{ym:'bad',total:200000},
    {ym:'2027-01'},{ym:'2027-02',total:''},{ym:'2027-03',total:null},{ym:'2027-04',total:Infinity},
    {ym:'2027-05',total:NaN},{ym:'2027-06',total:'not-a-number'}];
  assert.deepEqual(reference([{ym:'2026-10',total:100000},...invalid]),result(100000));
  assert.deepEqual(reference(invalid),result(null));
});

test('무이자 순자산 참조: 명시적으로 저장한 최신 0원은 기록 없음이나 과거 양수 기록으로 대체하지 않는다',()=>{
  for(const total of [0,'0'])assert.deepEqual(reference([{ym:'2026-09',total:100000},{ym:'2026-10',total}]),result(0));
  assert.deepEqual(reference([{ym:'2026-10',total:''}]),result(null));
});

test('무이자 순자산 참조: 저장된 음수·소수 금액과 기존 숫자 저장 호환을 유지한다',()=>{
  for(const total of [-10000,123456.75,'123456'])assert.deepEqual(reference([{ym:'2026-10',total}]),result(Number(total)));
});

test('무이자 순자산 참조: 저축 시나리오의 급여·수익률·종료 예상 자산이 바뀌어도 실제 기준액은 동일하다',()=>{
  const savings={startYear:2026,startAge:30,actual:[{ym:'2026-01',total:100000}],
    scenarios:[{id:'a',salary:10000,returnRate:5,endAge:30},{id:'b',salary:50000,returnRate:20,endAge:31}]};
  const doc={version:1,savings};
  for(const scenario of savings.scenarios){
    const projection=simulateSavings(savings,scenario);
    assert.ok(projection.rows[projection.rows.length-1].end>projection.last.total);
    assert.deepEqual(installmentAssetReference(doc),result(projection.last.total,'2026-01'));
  }
  savings.scenarios[0].salary=999999;savings.scenarios[0].returnRate=50;
  assert.deepEqual(installmentAssetReference(doc),result(100000,'2026-01'));
});

test('무이자 순자산 참조: 같은 달의 마지막 유효 기록을 사용하고 원본 기록·순서·메모를 바꾸지 않는다',()=>{
  const doc={version:1,savings:{savedAt:'2026-10-01',actual:[
    {ym:'2026-10',total:100000,note:'synthetic first'},
    {ym:'2026-09',total:99999},
    {ym:'2026-10',total:110000,note:'synthetic last'},
    {ym:'2026-10',total:''}
  ],scenarios:[{id:'s',salary:5000}],milestoneRecord:{ym:'2030-12',age:34}}};
  const before=JSON.stringify(doc);
  assert.deepEqual(installmentAssetReference(doc,null),result(110000));
  assert.equal(simulateSavings(doc.savings,{endAge:0}).last.total,110000,'기존 저축 계획의 마지막 실제 기록 선택과 같다');
  assert.equal(JSON.stringify(doc),before);
});
