// 페이지와 서비스 워커가 같은 알림 이동 주소를 사용한다. 발송 URL 대신 이 사이트 안의 주소만 만든다.
function pushAlertTarget(data){
  const ticker=typeof data?.ticker==="string"?data.ticker.trim().toUpperCase():"";
  if(!/^[A-Z0-9][A-Z0-9.\-/]{0,11}$/.test(ticker))return null;
  const line=typeof data.line==="string"&&data.line.length<=100?data.line:"";
  const ruleId=typeof data.ruleId==="string"&&data.ruleId.length<=512?data.ruleId:"";
  return {ticker,line,ruleId};
}
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
