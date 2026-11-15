// 신뢰한 플래너의 최상위 문서에서만 Android가 실행한다. 브라우저 저장값은 읽거나 쓰지 않는다.
(function(){
  const root = document.documentElement;
  root.dataset.nativeApp = "android";
  return [getComputedStyle(document.body || root).backgroundColor, getComputedStyle(root).backgroundColor];
})();
