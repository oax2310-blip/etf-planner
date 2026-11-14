// Java 쪽은 Promise를 기다리지 못하므로 현재 문서의 일시적인 결과만 가져오고 완료 시 메모리에서 지운다.
(function(){
  const key = Symbol.for("etf-planner.android.download"), result = window[key];
  if (!result) return {status:"missing"};
  if (result.status !== "pending") delete window[key];
  return result;
})();
