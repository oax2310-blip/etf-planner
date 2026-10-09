// 모두 가상 계획·시세·체결 기록. 실제 보유 기록은 공개 테스트에 넣지 않는다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ma-ladder.js','futures.js'].map(name=>fs.readFileSync(path.join(__dirname,'../js',name),'utf8')).join('\n;\n');
const load=()=>{const ctx=vm.createContext({contractSize:10000});vm.runInContext(source,ctx);return ctx;};
const clone=value=>JSON.parse(JSON.stringify(value));
const level=(days,price,contracts=3)=>({days,unit:'일선',price,confirmed:true,contracts,tranches:Array.from({length:contracts},(_,slot)=>({price,completed:false,executionPrice:null,slot}))});

test('계획 창에서 바꾸지 않은 기준가·체결·알림은 그 사이 갱신된 최신 기록을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  f.levels[0].price=1405;f.levels[0].notify=true;
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1401,mergedMonth:'202612'});
  const before=JSON.stringify(f);
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(JSON.stringify(f),before,'열고 저장만 하면 기존 기록에 필드를 만들거나 값을 되돌리지 않는다');
  edited[1].contracts=4;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].price,1405);assert.equal(f.levels[0].notify,true);
  assert.equal(f.levels[0].tranches[0].executionPrice,1401);assert.equal(f.levels[0].tranches[0].mergedMonth,'202612');
  assert.equal(f.levels[1].contracts,4);assert.equal(f.levels[1].tranches.length,4);
});

test('기준가 수정은 관련 회차 가격만 다시 채우고 이미 체결한 가격을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430),level(42,1460)]};
  Object.assign(f.levels[0].tranches[0],{completed:true,executionPrice:1399,mergedMonth:'202612'});
  f.levels[0].tranches[1].priceOverride=1412;f.levels[2].tranches[1].priceOverride=1462;
  const base=clone(f.levels),edited=clone(base);edited[1].price=1460;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].tranches[0].executionPrice,1399);
  assert.equal(f.levels[0].tranches[1].price,1420);assert.equal(f.levels[0].tranches[2].price,1440);
  assert.equal(Object.hasOwn(f.levels[0].tranches[1],'priceOverride'),false);
  assert.equal(f.levels[2].tranches[1].priceOverride,1462);
});

test('창을 연 뒤 매수가 늘어도 완료 수보다 줄이는 수정은 원본 전체를 보존하며 거부한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  edited[0].price=1402;edited[1].contracts=1;
  f.levels[1].tranches[0].completed=true;f.levels[1].tranches[1].completed=true;
  const before=JSON.stringify(f);
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),false);
  assert.equal(JSON.stringify(f),before,'앞 구간의 기준가도 일부 적용하지 않는다');
});

test('새 평균선·직접 입력 계획을 저장하고 중복·잘못된 값은 원본을 건드리지 않는다',()=>{
  const ctx=load(),f={levels:[level(25,1400)]},base=clone(f.levels);
  for(const bad of [{...level(25,1410)},{...level(32,-1)},{...level(32,1430),contracts:1.5}]){
    const before=JSON.stringify(f);assert.equal(ctx.applyFuturePlanEdits(f,base,[...clone(base),bad]),false);assert.equal(JSON.stringify(f),before);
  }
  const edited=[...clone(base),level(32,1430),{days:0,unit:'',label:'가상 추가 매수',price:1390,confirmed:true,contracts:2,tranches:[]}];
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels.length,3);assert.equal(f.levels[1].tranches.length,3);assert.equal(f.levels[2].tranches.length,2);
  assert.ok(f.levels[2].tranches.every(t=>t.price===1390&&!t.completed));
});

test('계약 수를 0으로 바꿔도 평균선 기준은 남아 앞 구간의 가격 계산에 쓰인다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);edited[1].contracts=0;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels.length,2);assert.equal(f.levels[1].price,1430);assert.equal(f.levels[1].tranches.length,0);
  assert.deepEqual(clone(ctx.futureBuyPrices(f.levels,0)),[1400,1410,1420]);
});

test('기준선 알림은 수정한 선택만 저장하고 최신 다른 구간의 선택을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  f.levels[1].notify=true;edited[0].notify=false;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].notify,false);assert.equal(f.levels[1].notify,true);
});

test('가격·계약 수를 수정해도 창을 연 뒤 바뀐 회차별 알림을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]},base=clone(f.levels),edited=clone(base);
  edited[0].price=1402;edited[1].contracts=4;
  f.levels[0].tranches[1].notify=true;f.levels[1].tranches[0].notify=false;
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited),true);
  assert.equal(f.levels[0].tranches[1].notify,true);assert.equal(f.levels[1].tranches[0].notify,false);
  assert.equal(Object.hasOwn(f.levels[1].tranches[3],'notify'),false,'늘린 계약은 기존 기본 알림을 따른다');
});

test('기준선 전체 알림을 직접 선택하면 같은 기본값도 회차 예외를 지우고 다른 구간을 보존한다',()=>{
  const ctx=load(),f={levels:[level(25,1400),level(32,1430)]};
  f.levels[0].notify=false;f.levels[0].tranches[1].notify=true;f.levels[1].tranches[0].notify=true;
  const base=clone(f.levels),edited=clone(base);
  assert.equal(ctx.applyFuturePlanEdits(f,base,edited,[0]),true);
  assert.equal(f.levels[0].notify,false);assert.ok(f.levels[0].tranches.every(t=>!Object.hasOwn(t,'notify')));
  assert.equal(f.levels[1].tranches[0].notify,true);
  const before=JSON.stringify(f),invalid=clone(base);invalid[1].contracts=-1;
  assert.equal(ctx.applyFuturePlanEdits(f,base,invalid,[0]),false);assert.equal(JSON.stringify(f),before);
});
