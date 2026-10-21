// 세 페이지 공통: 160px 아래에서 위로 8px 되돌릴 때만 표시하고, 아래로 이동하거나 맨 아래에 닿으면 숨긴다.
// 스크롤 끝의 탄성 움직임은 실제 범위로 제한하고, 버튼으로 맨 위로 이동하는 중에는 다시 표시하지 않는다.
// 삼성 인터넷에서도 같은 사이트 버튼을 사용한다. 중복되는 브라우저 기본 버튼은 브라우저 설정에서 끈다.
(function(){
  if (document.querySelector(".back-to-top")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back-to-top";
  button.hidden = true;
  button.setAttribute("aria-label", "맨 위로 올라가기");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 18l8-8 8 8"/></svg>';
  button.addEventListener("click", () => {
    returning = true; upward = 0; button.hidden = true;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({top:0, behavior:reduced ? "instant" : "smooth"});
  });
  document.body.append(button);
  function position(){
    const bottom = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return {bottom, y:Math.max(0, Math.min(window.scrollY, bottom))};
  }
  let lastY = position().y, upward = 0, returning = false;
  function reset(){ lastY = position().y; upward = 0; button.hidden = true; }
  function update(){
    const {y, bottom} = position(), delta = y - lastY;
    lastY = y;
    if (y <= 160 || y >= bottom - 2){
      button.hidden = true; upward = 0;
      if (y <= 160) returning = false;
    } else if (delta > 0){
      button.hidden = true; upward = 0; returning = false;
    } else if (delta < 0 && !returning){
      upward -= delta;
      if (upward >= 8) button.hidden = false;
    }
  }
  window.addEventListener("scroll", update, {passive:true});
  window.addEventListener("pageshow", () => { returning = false; reset(); });
  window.addEventListener("resize", reset);
})();
