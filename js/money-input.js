// 금액 입력의 표시·숫자 변환·검증. 다른 파일 없이 세 화면에서 사용한다(공통 작업 규칙은 AGENTS.md).
// assets-calc.js의 assetNumberText·parseAssetNumber와 같은 결과를 유지하되 수집기 고정 파일에 의존하지 않는다.
function moneyInputText(value){
  const text=String(value??"").replace(/,/g,"");
  if(!/^[+-]?\d*(?:\.\d*)?$/.test(text))return text;
  const [whole,fraction]=text.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,",")+(fraction!==undefined?`.${fraction}`:"");
}
function moneyInputNumber(value){
  const text=String(value??"").trim().replace(/,/g,"");
  return text!==""&&Number.isFinite(Number(text))?Number(text):null;
}
// text에는 min·max·step이 적용되지 않는다. 저장·계산 직전에도 이 함수를 호출해 코드가 넣은 값까지 검사한다.
// step의 기준은 기존 number와 같이 min → 최초 value → 0. 기존 data-money 칸은 step 지정이 없으면 소수를 허용한다.
function moneyInputValidate(input){
  const text=input.value.trim(), raw=text.replace(/,/g,""), value=moneyInputNumber(text);
  const min=moneyInputNumber(input.getAttribute("data-money-min")), max=moneyInputNumber(input.getAttribute("data-money-max"));
  const step=moneyInputNumber(input.getAttribute("data-money-step"));
  let message="";
  if(text){
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)||value===null)message="금액을 숫자로 입력해 주세요.";
    else if(min!==null&&value<min)message=`금액은 ${moneyInputText(min)} 이상으로 입력해 주세요.`;
    else if(max!==null&&value>max)message=`금액은 ${moneyInputText(max)} 이하로 입력해 주세요.`;
    else if(step!==null&&step>0){
      const base=min??moneyInputNumber(input.defaultValue)??0, count=(value-base)/step;
      if(Math.abs(count-Math.round(count))>Math.max(1e-8,Number.EPSILON*Math.abs(count)*8))message=`금액은 ${moneyInputText(step)} 단위로 입력해 주세요.`;
    }
  }
  input.setCustomValidity(message);
  return !message;
}
// 대상 칸의 계산·미리보기 처리기보다 먼저 표시와 검증을 맞춘다. 쉼표를 제외한 위치로 선택 범위를 보존한다.
document.addEventListener("input",e=>{
  const input=e.target;if(!input.matches?.("input[data-money]"))return;
  const value=input.value, formatted=/^[+-]?\d*(?:\.\d*)?$/.test(value.replace(/,/g,""))?moneyInputText(value):value;
  if(value!==formatted){
    const position=offset=>{
      const before=value.slice(0,offset??value.length).replace(/,/g,"").length;
      let pos=0,count=0;
      while(pos<formatted.length&&count<before){if(formatted[pos]!==",")count++;pos++;}
      return pos;
    };
    const start=position(input.selectionStart),end=position(input.selectionEnd),direction=input.selectionDirection;
    input.value=formatted;input.setSelectionRange(start,end,direction);
  }
  moneyInputValidate(input);
},true);
document.querySelectorAll("input[data-money]").forEach(input=>{
  input.value=moneyInputText(input.value);moneyInputValidate(input);
});
