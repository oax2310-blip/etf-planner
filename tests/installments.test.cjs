const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const {calculateInstallments,cleanAssets,mergeAssets,assetsBlank}=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n;\n')};return {calculateInstallments,cleanAssets,mergeAssets,assetsBlank};})()`);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
const example=()=>({price:3600000,returnRate:3,years:3,firstMonth:1,methods:{once:{rewardRate:1},m12:{rewardRate:1,rewardsEnabled:false},m36:{rewardRate:1,rewardsEnabled:false}}});

test('무이자: 수익·혜택이 없으면 원금 분할만으로 이득이 생기지 않고 마지막 납부까지 합계가 정확하다',()=>{
  const r=calculateInstallments({price:3600001,returnRate:0});
  assert.equal(r.tied,true);
  assert.equal(r.winners.length,3);
  for(const p of r.plans){
    assert.equal(p.totalBenefit,0);assert.equal(p.advantage,0);
    assert.equal(p.rows.reduce((s,x)=>s+x.payment,0),3600001);
    assert.equal(p.rows[p.endMonth].remaining,0);
    assert.equal(p.rows[p.endMonth+1].payment,0);
  }
  assert.equal(r.plans[1].monthly,300000);assert.equal(r.plans[1].lastPayment,300001);
  assert.equal(r.plans[2].monthly,100000);assert.equal(r.plans[2].lastPayment,100001);
});

test('무이자: 줄어드는 결제 잔액을 계산한 결과가 현금흐름의 독립적인 미래가치 계산과 일치한다',()=>{
  const input=example(),before=JSON.stringify(input),r=calculateInstallments(input),q=Math.pow(1.03,1/12);
  for(const p of r.plans){
    // 매월 납부액의 미래가치를 차감해 전액을 3년 내내 굴리는 오류를 잡는다.
    let expected=input.price*Math.pow(1.03,3);
    for(let m=1;m<=p.months;m++)expected-=(m===p.months?p.lastPayment:p.monthly)*Math.pow(q,36-m);
    expected+=p.reward*Math.pow(q,35);
    near(p.totalBenefit,expected);
    near(p.totalBenefit,p.cardBenefit+p.holdingReturn);
    near(p.advantage,p.cardDifference+p.holdingDifference);
  }
  assert.equal(r.best.id,'m36');assert.equal(r.plans[1].reward,0);assert.equal(r.plans[2].reward,0);
  assert.ok(r.plans[2].totalBenefit<input.price*(1.03**3-1),'3년간 전체 구매대금의 수익으로 과대 계산하지 않음');
  assert.equal(JSON.stringify(input),before,'읽기·계산에서 기존 기록을 채우거나 바꾸지 않음');
});

test('무이자: 아직 내지 않은 원금을 이득에 포함하지 않는다',()=>{
  const r=calculateInstallments({price:3600000,returnRate:0}),p=r.plans[2],month=p.rows[12];
  assert.equal(month.balance,2400000);assert.equal(month.remaining,2400000);assert.equal(month.benefit,0);
  const earning=calculateInstallments(example()).plans[2].rows[12];
  near(earning.benefit,earning.earned);
  assert.ok(earning.benefit<earning.balance);
});

test('무이자: 할인 후 원금·적립, 한도 0과 제외 조건, 추가 비용을 모두 반영한다',()=>{
  const r=calculateInstallments({price:1200000,returnRate:0,methods:{
    once:{discountRate:10,fixedDiscount:20000,rewardRate:10,rewardCap:5000,fee:1000},
    m12:{rewardRate:10,rewardCap:0},m36:{rewardRate:10,rewardsEnabled:false,fee:10000}
  }});
  const [once,m12,m36]=r.plans;
  assert.equal(once.discount,140000);assert.equal(once.principal,1060000);assert.equal(once.reward,5000);
  assert.equal(once.totalBenefit,144000);assert.equal(m12.reward,0);assert.equal(m36.reward,0);
  assert.equal(m36.totalBenefit,-10000);assert.equal(m36.advantage,-154000);assert.equal(r.best.id,'once');
  assert.ok(m36.minBalance<0,'부족한 납부자금은 별도 표시할 수 있다');
  const noCap=calculateInstallments({price:10000,methods:{once:{rewardRate:10}}});assert.equal(noCap.plans[0].reward,1000);
  const fullDiscount=calculateInstallments({price:10000,methods:{m36:{fixedDiscount:20000,rewardRate:10}}}).plans[2];
  assert.equal(fullDiscount.principal,0);assert.equal(fullDiscount.discount,10000);assert.equal(fullDiscount.reward,0);
});

test('무이자: 첫 납부 시점과 공통 3·5·10년 비교를 일관되게 적용한다',()=>{
  const later=calculateInstallments(example()),now=calculateInstallments({...example(),firstMonth:0});
  for(let i=0;i<3;i++){
    const p=now.plans[i];assert.equal(p.rows[0].payment,p.monthly);assert.equal(p.endMonth,p.months-1);
    assert.ok(p.totalBenefit<later.plans[i].totalBenefit);
  }
  const ten=calculateInstallments({...example(),years:10});
  for(let i=0;i<3;i++)near(ten.plans[i].advantage,later.plans[i].advantage*1.03**7);
  assert.equal(ten.horizon,120);
});

test('무이자: 납부 부족액을 대출로 가정해 수익이나 이자를 만들지 않는다',()=>{
  const r=calculateInstallments({price:10000,returnRate:3,methods:{once:{fee:10000}}}),p=r.plans[0];
  assert.ok(p.rows[1].balance<0);
  assert.equal(p.rows[2].interest,0);near(p.rows[1].balance,p.rows[120].balance);
});

test('무이자: 두 방식이 동률이면 둘 다 가장 유리한 결과로 남긴다',()=>{
  const r=calculateInstallments({...example(),returnRate:0,methods:{once:{rewardRate:1},m36:{rewardRate:1}}});
  assert.equal(r.tied,false);assert.deepEqual(r.winners.map(p=>p.id),['once','m36']);
});

test('무이자: 잘못된 금액·혜택·수익률에서는 결과를 만들지 않는다',()=>{
  for(const price of [undefined,0,-1,1.5,Infinity,1e13])assert.equal(calculateInstallments({price}),null);
  for(const returnRate of [-1,101,'abc'])assert.equal(calculateInstallments({price:100,returnRate}),null);
  for(const method of [{discountRate:-1},{discountRate:101},{rewardRate:'abc'},{rewardCap:-1},{fee:-1}])assert.equal(calculateInstallments({price:100,methods:{m12:method}}),null);
});

test('무이자: 별도 구역의 저장·병합에서 기존 저축 기록과 저장 형식을 유지한다',()=>{
  const savings={savedAt:'2026-01-01',actual:[],scenarios:[{id:'old',name:'기존 계획'}]},old={version:1,savings};
  const before=JSON.stringify(old);assert.equal(cleanAssets(old).installments,undefined);assert.equal(JSON.stringify(old),before);
  const local={...old,installments:{savedAt:'2026-02-01',...example()}},remote={version:1,savings:{...savings,savedAt:'2026-03-01',startAge:40}};
  const r=mergeAssets(local,remote,old);assert.equal(r.doc.installments,local.installments);assert.equal(r.doc.savings,remote.savings);assert.deepEqual(r.lost,[]);
  assert.equal(assetsBlank({version:1,installments:{price:10000}}),false);
  assert.deepEqual(cleanAssets({version:1,installments:{price:10000}}),{version:1,installments:{price:10000}},'불러올 때 빈 선택 필드를 채우지 않음');
});
