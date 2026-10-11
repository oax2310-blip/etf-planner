const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const {calculateInstallments,cleanAssets,mergeAssets,assetsBlank}=vm.runInThisContext(`(function(){${['js/ma-ladder.js','js/assets-calc.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n;\n')};return {calculateInstallments,cleanAssets,mergeAssets,assetsBlank};})()`);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
const example=()=>({price:3600000,returnRate:3,years:3,firstMonth:1,methods:{once:{},m12:{},m36:{}}});

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

test('무이자: 직접 입력한 기간의 원금·마지막 회차·잔여금액과 3·5·10년 현금흐름이 일치한다',()=>{
  for(const months of [1,6,12,18,24,36,48,120])for(const firstMonth of [0,1])for(const years of [3,5,10]){
    const price=3600001,annualRate=3,q=Math.pow(1.03,1/12),input={price,returnRate:annualRate,years,firstMonth,methods:{m12:{months},m36:{months}}};
    const before=JSON.stringify(input),r=calculateInstallments(input);
    for(const p of r.plans.slice(1)){
      assert.equal(p.months,months);assert.equal(p.name,`${months}개월 무이자`);
      assert.equal(p.endMonth,firstMonth+months-1);
      assert.equal(p.rows.reduce((sum,row)=>sum+row.payment,0),price);
      assert.equal(p.rows[p.endMonth].remaining,0);
      let expected=price*q**r.horizon,paid=0;
      for(let i=0;i<months;i++){
        const at=firstMonth+i,payment=i===months-1?price-Math.floor(price/months)*(months-1):Math.floor(price/months);
        if(at<=r.horizon){expected-=payment*q**(r.horizon-at);paid+=payment;}
        assert.equal(p.rows[at].payment,payment);assert.equal(p.rows[at].remaining,price-(i===months-1?price:Math.floor(price/months)*(i+1)));
      }
      expected-=price-paid;
      near(p.totalBenefit,expected);near(p.totalBenefit,p.holdingReturn);
      assert.equal(p.rows[r.horizon].remaining,price-paid);
    }
    assert.equal(JSON.stringify(input),before);
  }
  for(const months of [6,12,18,24,36,48]){
    const p=calculateInstallments({price:7,methods:{m36:{months}}}).plans[2];
    assert.equal(p.rows.reduce((sum,row)=>sum+row.payment,0),7);assert.equal(p.rows[p.endMonth].remaining,0);
  }
});

test('무이자: 선택 결제 연월의 납부 일정은 연도·윤년을 넘어도 월이 빠지거나 중복되지 않는다',()=>{
  for(const startYm of ['2026-12','2027-11','2028-02'])for(const months of [6,12,18,24,36,48])for(const firstMonth of [0,1]){
    const input={price:3600001,startYm,firstMonth,methods:{m36:{months}}},before=JSON.stringify(input),r=calculateInstallments(input),p=r.plans[2];
    const [y,m]=startYm.split('-').map(Number),dates=p.rows.slice(firstMonth,p.endMonth+1).map(row=>row.ym);
    assert.equal(dates.length,months);assert.equal(new Set(dates).size,months);
    for(let i=0;i<months;i++)assert.equal(dates[i],new Date(Date.UTC(y,m-1+firstMonth+i,1)).toISOString().slice(0,7));
    assert.equal(JSON.stringify(input),before);
  }
  assert.equal(calculateInstallments({price:100,startYm:'2026-12'}).plans[2].rows[1].ym,'2027-01');
  const earliest=calculateInstallments({price:100,startYm:'0001-12'}),latest=calculateInstallments({price:100,startYm:'9989-12',methods:{m36:{months:120}}});
  assert.equal(earliest.startYm,'0001-12');assert.equal(earliest.plans[2].rows[1].ym,'0002-01');assert.equal(latest.plans[2].rows[120].ym,'9999-12');
  assert.equal(Object.hasOwn(calculateInstallments({price:100}).plans[2].rows[0],'ym'),false);
});

test('무이자: 잘못된 직접 입력 기간·연월은 계산하지 않고 기존 기간은 기본값으로 유지한다',()=>{
  for(const months of [null,'',0,-1,1.5,121,Infinity,'abc'])for(const id of ['m12','m36'])assert.equal(calculateInstallments({price:100,methods:{[id]:{months}}}),null);
  for(const startYm of ['2026-00','2026-13','2026-1','0000-01','9990-01','abc'])assert.equal(calculateInstallments({price:100,startYm}),null);
  assert.deepEqual(calculateInstallments({price:100}).plans.map(p=>p.months),[1,12,36]);
});

test('무이자: 줄어드는 결제 잔액을 계산한 결과가 현금흐름의 독립적인 미래가치 계산과 일치한다',()=>{
  const input=example(),before=JSON.stringify(input),r=calculateInstallments(input),q=Math.pow(1.03,1/12);
  for(const p of r.plans){
    // 매월 납부액의 미래가치를 차감해 전액을 3년 내내 굴리는 오류를 잡는다.
    let expected=input.price*Math.pow(1.03,3);
    for(let m=1;m<=p.months;m++)expected-=(m===p.months?p.lastPayment:p.monthly)*Math.pow(q,36-m);
    near(p.totalBenefit,expected);
    near(p.totalBenefit,p.cardBenefit+p.holdingReturn);
    near(p.advantage,p.cardDifference+p.holdingDifference);
  }
  assert.equal(r.best.id,'m36');
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

test('무이자: 적립·캐시백은 검증·계산에서 제외하며 옛 비용만 반영한다',()=>{
  const r=calculateInstallments({price:1200000,returnRate:0,methods:{
    once:{discountRate:10,fixedDiscount:20000,rewardRate:10,rewardCap:5000,fee:1000},
    m12:{rewardRate:10,rewardCap:0},m36:{rewardRate:10,rewardsEnabled:false,fee:10000}
  }});
  const [once,m12,m36]=r.plans;
  assert.equal(once.principal,1200000);
  assert.equal(once.totalBenefit,-1000);assert.equal(m12.totalBenefit,0);
  assert.equal(m36.totalBenefit,-10000);assert.equal(m36.advantage,-9000);assert.equal(r.best.id,'m12');
  assert.ok(m36.minBalance<0,'부족한 납부자금은 별도 표시할 수 있다');
  for(const p of r.plans){assert.equal(Object.hasOwn(p,'reward'),false);assert.ok(p.rows.every(row=>!Object.hasOwn(row,'reward')));}
  const legacy={price:10000,methods:{once:{rewardRate:'abc',rewardCap:-1,rewardsEnabled:true},m12:{rewardRate:101,rewardCap:'wrong',cashback:1000},m36:{fixedDiscount:20000,rewardRate:Infinity,rewardsEnabled:false}}},before=JSON.stringify(legacy);
  const without={price:10000};assert.deepEqual(calculateInstallments(legacy),calculateInstallments(without));assert.equal(JSON.stringify(legacy),before);
});

test('무이자: 옛 할인 조건은 계산·검증에서 제외하되 원본 데이터는 그대로 보존한다',()=>{
  const settings={price:1200000,returnRate:3,methods:{once:{discountRate:10,fixedDiscount:20000,discountCap:5000,rewardRate:1},m12:{discountRate:'abc',fixedDiscount:-1,discountCap:0,months:18},m36:{discountRate:100,fixedDiscount:1200000,months:48}}};
  const before=JSON.stringify(settings),r=calculateInstallments(settings),without=JSON.parse(before);
  for(const method of Object.values(without.methods)){delete method.discountRate;delete method.fixedDiscount;delete method.discountCap;}
  assert.deepEqual(r,calculateInstallments(without));
  assert.equal(r.plans.every(p=>p.discount===0),true);assert.equal(r.plans[2].principal,1200000);
  assert.equal(JSON.stringify(settings),before);
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
  const r=calculateInstallments({...example(),returnRate:0,methods:{once:{discountEnabled:true,discountRate:1,discountCap:1e12},m36:{discountEnabled:true,discountRate:1,discountCap:1e12}}});
  assert.equal(r.tied,false);assert.deepEqual(r.winners.map(p=>p.id),['once','m36']);
});

test('무이자: 잘못된 금액·혜택·수익률에서는 결과를 만들지 않는다',()=>{
  for(const price of [undefined,0,-1,1.5,Infinity,1e13])assert.equal(calculateInstallments({price}),null);
  for(const returnRate of [-101,101,'abc'])assert.equal(calculateInstallments({price:100,returnRate}),null);
  for(const method of [{discountEnabled:true,discountRate:-1},{discountEnabled:true,discountRate:101},{discountEnabled:true,discountRate:'abc'},{discountEnabled:true,discountCap:-1},{discountEnabled:true,discountCap:1.5},{discountEnabled:true,discountCap:1e12+1},{fee:-1}])assert.equal(calculateInstallments({price:100,methods:{m12:method}}),null);
});

test('무이자: 할인은 명시적으로 사용한 비율·한도 안에서만 원금을 줄이고 옛 추가 할인액을 재해석하지 않는다',()=>{
  const methods={once:{discountEnabled:true,discountRate:10,discountCap:30000,fixedDiscount:900000},m12:{discountEnabled:true,discountRate:10,discountCap:0},m36:{discountEnabled:false,discountRate:'abc',discountCap:-1,fixedDiscount:50000}};
  const input={price:1200001,returnRate:0,methods},before=JSON.stringify(input),r=calculateInstallments(input),[once,m12,m36]=r.plans;
  assert.equal(once.discount,30000);assert.equal(once.principal,1170001);assert.equal(once.payoff.advantage,0);
  for(const p of [m12,m36]){assert.equal(p.discount,0);assert.equal(p.principal,1200001);assert.equal(p.payoff.advantage,-30000);}
  for(const p of r.plans){
    assert.equal(p.rows.reduce((sum,row)=>sum+row.payment,0),p.principal);
    assert.equal(p.rows[p.endMonth].remaining,0);assert.equal(p.rows[0].benefit,p.discount);
    assert.equal(p.rows.reduce((sum,row)=>sum+row.discount,0),p.discount);
  }
  assert.equal(JSON.stringify(input),before);
  for(const discountCap of [undefined,null,'',0]){
    const method={discountEnabled:true,discountRate:100};if(discountCap!==undefined)method.discountCap=discountCap;
    assert.equal(calculateInstallments({price:100,methods:{m12:method}}).plans[1].discount,0);
  }
  const rounded=calculateInstallments({price:101,methods:{m12:{discountEnabled:true,discountRate:10,discountCap:100}}}).plans[1];
  assert.equal(rounded.discount,10);assert.equal(rounded.principal,91);assert.equal(rounded.lastPayment,14);
  const free=calculateInstallments({price:101,returnRate:3,methods:{m36:{discountEnabled:true,discountRate:100,discountCap:1e12,months:48}}}).plans[2];
  assert.equal(free.discount,101);assert.equal(free.principal,0);assert.equal(free.monthly,0);assert.equal(free.lastPayment,0);assert.equal(free.rows[free.endMonth].remaining,0);
});

test('무이자: 종료 자산 차이는 같은 시점의 독립적인 현금흐름 미래가치와 일치한다',()=>{
  for(const months of [1,6,12,18,24,36,48,120])for(const firstMonth of [0,1]){
    const price=3600001,N=100000000,q=Math.pow(1.05,1/12),input={price,returnRate:5,firstMonth,startYm:'2026-12',netAssets:N,methods:{once:{discountEnabled:true,discountRate:1,discountCap:10000,fee:100},m12:{months,discountEnabled:true,discountRate:2,discountCap:15000,fee:200},m36:{months}}};
    const before=JSON.stringify(input),r=calculateInstallments(input);
    const independent=(p,t)=>{
      let balance=price*q**t,paid=0;
      for(let i=0;i<p.months;i++){
        const at=firstMonth+i;if(at>t)break;
        const principal=price-p.discount,regular=Math.floor(principal/p.months),payment=i===p.months-1?principal-regular*(p.months-1):regular;
        paid+=payment;balance-=payment*q**(t-at);
      }
      if(firstMonth<=t)balance-=p.fee*q**(t-firstMonth);
      return {benefit:balance-(price-p.discount-paid),netAssets:N-price+balance-(price-p.discount-paid)};
    };
    for(const p of r.plans){
      const own=independent(p,p.endMonth),once=independent(r.plans[0],p.endMonth),payoff=p.payoff;
      assert.equal(payoff.month,firstMonth+p.months-1);assert.equal(payoff.ym,p.rows[p.endMonth].ym);
      near(payoff.advantage,own.benefit-once.benefit);near(payoff.netAssets,own.netAssets);near(payoff.onceNetAssets,once.netAssets);
      near(payoff.assetRate,(own.benefit-once.benefit)/once.netAssets*100);near(payoff.purchaseRate,(own.benefit-once.benefit)/price*100);
      near(payoff.advantage,payoff.holdingDifference+payoff.discountDifference-payoff.costDifference);
      for(const row of p.rows){
        const baseline=r.plans[0].rows[row.month];near(row.advantage,row.benefit-baseline.benefit);near(row.netAssets,N-price+row.balance-row.remaining);
      }
    }
    assert.equal(JSON.stringify(input),before);
  }
});

test('무이자: 기준 순자산은 구매예산과 중복되지 않으며 자산 규모가 운용수익을 바꾸지 않는다',()=>{
  const settings={price:3600001,returnRate:3,methods:{m12:{months:6},m36:{months:48}}},before=JSON.stringify(settings);
  const small=calculateInstallments(settings,10000000),large=calculateInstallments(settings,20000000),missing=calculateInstallments(settings);
  assert.equal(small.netAssets,10000000);assert.equal(large.netAssets,20000000);assert.equal(missing.netAssets,null);
  for(let i=0;i<small.plans.length;i++){
    const a=small.plans[i],b=large.plans[i],c=missing.plans[i];
    assert.equal(a.payoff.advantage,b.payoff.advantage);assert.equal(a.payoff.advantage,c.payoff.advantage);
    assert.equal(a.holdingReturn,b.holdingReturn);near(b.payoff.netAssets-a.payoff.netAssets,10000000);
    assert.equal(c.payoff.netAssets,null);assert.equal(c.payoff.onceNetAssets,null);assert.equal(c.payoff.assetRate,null);
    for(const row of a.rows)near(row.netAssets,10000000-settings.price+row.benefit);
  }
  assert.equal(JSON.stringify(settings),before);
  const zero=calculateInstallments({...settings,returnRate:0},10000000);
  for(const p of zero.plans)for(const row of p.rows){
    assert.equal(row.netAssets,10000000-settings.price);assert.equal(row.advantage,0);assert.equal(row.assetRate,0);assert.equal(row.purchaseRate,0);
    assert.equal(row.balance,row.remaining,'남은 납부대금이 순자산 이득으로 계산되지 않음');
  }
});

test('무이자: 직접 입력 순자산 우선순위·음수·0·미입력·분모와 저장 원본을 유지한다',()=>{
  for(const netAssets of [-10000,0,9999,10000,10001,1e15]){
    const settings={price:10000,returnRate:0,netAssets},before=JSON.stringify(settings),r=calculateInstallments(settings,50000);
    assert.equal(r.netAssets,netAssets);assert.equal(JSON.stringify(settings),before);
    for(const p of r.plans){assert.equal(p.payoff.netAssets,netAssets-10000);assert.equal(p.payoff.assetRate,netAssets>10000?0:null);assert.equal(p.payoff.purchaseRate,0);}
  }
  for(const netAssets of [undefined,null,''])assert.equal(calculateInstallments({price:10000,netAssets},50000).netAssets,50000);
  for(const netAssets of [1.5,1e15+1,-1e15-1,NaN,Infinity,'abc'])assert.equal(calculateInstallments({price:10000,netAssets},50000),null);
  assert.equal(calculateInstallments({price:10000},12345.67).netAssets,12345.67,'저축 실제 기록의 원 미만은 참조할 때 임의 반올림하지 않음');
  for(const reference of [NaN,Infinity,'abc',1e15+1])assert.equal(calculateInstallments({price:10000},reference),null);
  assert.equal(calculateInstallments({price:10000,netAssets:20000},Infinity).netAssets,20000,'명시 입력이 있으면 외부 참조는 계산에 섞이지 않음');
});

test('무이자: 음수 예상 수익률은 손실을 반영하고 부족한 잔액에 가상의 차입 이자를 만들지 않는다',()=>{
  for(const months of [6,12,24,36,48])for(const firstMonth of [0,1]){
    const r=calculateInstallments({price:3600001,returnRate:-3,firstMonth,methods:{m36:{months}}},10000000),p=r.plans[2];
    assert.ok(p.payoff.advantage<0);assert.ok(p.payoff.purchaseRate<0);assert.ok(p.payoff.assetRate<0);
    assert.ok(p.rows[p.endMonth].earned<0);assert.equal(p.rows[p.endMonth].remaining,0);
    assert.equal(p.rows.reduce((sum,row)=>sum+row.payment,0),r.price);
    assert.ok(p.rows.every(row=>Number.isFinite(row.benefit)&&Number.isFinite(row.netAssets)));
    const deficit=p.rows.find(row=>row.balance<0);assert.ok(deficit);
    for(const row of p.rows.slice(deficit.month+1))assert.equal(row.interest,0);
  }
  const lost=calculateInstallments({price:100,returnRate:-100,firstMonth:0,methods:{m12:{months:2}}},1000).plans[1];
  assert.equal(lost.rows[0].balance,50);assert.equal(lost.rows[1].interest,-50);assert.equal(lost.payoff.advantage,-50);
  assert.equal(lost.rows[2].balance,-50);assert.equal(lost.rows[2].interest,0);
  assert.equal(calculateInstallments({price:100,returnRate:100}).monthlyRate,Math.expm1(Math.log(2)/12));
});

test('무이자: 별도 구역의 저장·병합에서 기존 저축 기록과 저장 형식을 유지한다',()=>{
  const savings={savedAt:'2026-01-01',actual:[],scenarios:[{id:'old',name:'기존 계획'}]},old={version:1,savings};
  const before=JSON.stringify(old);assert.equal(cleanAssets(old).installments,undefined);assert.equal(JSON.stringify(old),before);
  const local={...old,installments:{savedAt:'2026-02-01',...example()}},remote={version:1,savings:{...savings,savedAt:'2026-03-01',startAge:40}};
  const r=mergeAssets(local,remote,old);assert.equal(r.doc.installments,local.installments);assert.equal(r.doc.savings,remote.savings);assert.deepEqual(r.lost,[]);
  assert.equal(assetsBlank({version:1,installments:{price:10000}}),false);
  assert.deepEqual(cleanAssets({version:1,installments:{price:10000}}),{version:1,installments:{price:10000}},'불러올 때 빈 선택 필드를 채우지 않음');
});
