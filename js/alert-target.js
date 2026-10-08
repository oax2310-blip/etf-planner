// push.js와 push-sw.js가 공유하는 알림 이동 주소. 발송 URL 대신 이 사이트 안의 주소만 만든다.
function pushAlertTarget(data){
  const ticker=typeof data?.ticker==="string"?data.ticker.trim().toUpperCase():"";
  if(!/^[A-Z0-9][A-Z0-9.\-/]{0,11}$/.test(ticker))return null;
  const line=typeof data.line==="string"&&data.line.length<=100?data.line:"";
  const ruleId=typeof data.ruleId==="string"&&data.ruleId.length<=512?data.ruleId:"";
  return {ticker,line,ruleId};
}
// 발송된 ticker·line과 선택용 ruleId를 #alert?에 넣는다. 기존 계획·종목 찾기와 동기화 후 재시도는 push.js가 맡는다.
function pushAlertHash(data){
  const target=pushAlertTarget(data);if(!target)return "";
  const params=new URLSearchParams({ticker:target.ticker});
  if(target.line)params.set("line",target.line);
  if(target.ruleId)params.set("rule",target.ruleId);
  return `#alert?${params}`;
}
function pushAlertTargetFromHash(hash){
  if(typeof hash!=="string"||!hash.startsWith("#alert?")||hash.length>2400)return null;
  const params=new URLSearchParams(hash.slice(7));
  return pushAlertTarget({ticker:params.get("ticker"),line:params.get("line"),ruleId:params.get("rule")});
}
