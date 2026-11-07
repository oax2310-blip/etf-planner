const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

function field(value='',attrs={}){
  return {value,defaultValue:attrs.value??'',selectionStart:value.length,selectionEnd:value.length,selectionDirection:'none',validationMessage:'',
    getAttribute:key=>attrs[key]??null,matches:selector=>selector==='input[data-money]',
    setCustomValidity(message){this.validationMessage=message;},
    setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}};
}
function page(inputs=[]){
  const listeners=new Map();
  const context=vm.createContext({document:{querySelectorAll:()=>inputs,addEventListener:(type,fn,capture)=>listeners.set(type,{fn,capture})}});
  // assets-calc 없이 공용 파일만 실행한다. 시나리오에서도 같은 함수를 쓸 수 있어야 한다.
  vm.runInContext(read('js/money-input.js'),context);
  return {context,input:target=>listeners.get('input').fn({target}),capture:listeners.get('input').capture};
}

test('공용 금액 표시·숫자 변환은 수집기 고정 함수와 부호·소수점·쉼표 처리 결과가 같다',()=>{
  const {context:c}=page(),fixed=vm.createContext({});
  vm.runInContext(read('js/ma-ladder.js')+'\n'+read('js/assets-calc.js'),fixed);
  const parse=vm.runInContext('parseAssetNumber',fixed);
  for(const raw of ['1234567','-1234.5','1234.','.5','12,345','+1234.0500','',null,'-',NaN,Infinity,' 12,345.6 ']){
    assert.equal(c.moneyInputText(raw),fixed.assetNumberText(raw),String(raw));
    assert.equal(c.moneyInputNumber(raw),parse(raw),String(raw));
  }
  assert.equal(c.moneyInputNumber('12,345.6'),12345.6);
});

test('처음 값과 입력 중 값은 정수부만 묶고 선택 범위·방향을 유지한다',()=>{
  const initial=field('-1234.0500'),p=page([initial]);
  assert.equal(initial.value,'-1,234.0500');assert.equal(p.capture,true,'미리보기보다 먼저 실행');
  const x=field('1234567.89');x.selectionStart=2;x.selectionEnd=5;x.selectionDirection='backward';
  p.input(x);assert.equal(x.value,'1,234,567.89');
  assert.deepEqual([x.selectionStart,x.selectionEnd,x.selectionDirection],[3,7,'backward']);
  for(const [raw,shown] of [['-1234.','-1,234.'],['.5','.5'],['+1234.50','+1,234.50'],['12,345.6','12,345.6']]){
    x.value=raw;x.selectionStart=x.selectionEnd=raw.length;p.input(x);
    assert.equal(x.value,shown);assert.equal(x.selectionStart,shown.length);assert.equal(x.validationMessage,'');
  }
});

test('금액 형식·최솟값·최댓값·간격 오류를 막고 유효한 값에서는 오류를 지운다',()=>{
  const {context:c,input}=page(),x=field('',{'data-money-min':'0.01','data-money-max':'20000','data-money-step':'0.01'});
  for(const raw of ['1e3','0x10','1.2.3','Infinity','-','.','+','1 2','-0.01','0','20,000.01','1.001']){
    x.value=raw;assert.equal(c.moneyInputValidate(x),false,raw);assert.ok(x.validationMessage,raw);
  }
  for(const raw of ['0.01','12,345.6','20,000','1234.','']){
    x.value=raw;input(x);assert.equal(c.moneyInputValidate(x),true,raw);assert.equal(x.validationMessage,'');
  }
  const offset=field('2.5',{'data-money-step':'1',value:'1.5'});
  assert.equal(c.moneyInputValidate(offset),true,'최초 value가 step 기준');
  offset.value='2';assert.equal(c.moneyInputValidate(offset),false);
  const any=field('-1234.567',{'data-money-step':'any'});assert.equal(c.moneyInputValidate(any),true);
});
