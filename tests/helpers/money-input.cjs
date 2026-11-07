// DOM을 쓰지 않는 기존 계산·화면 테스트에서도 실제 공용 금액 함수를 실행한다.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
module.exports=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../js/money-input.js'),'utf8')+'\n;({moneyInputText,moneyInputNumber,moneyInputValidate})',{
  document:{addEventListener(){},querySelectorAll:()=>[]}
});
