// 세 페이지 공통: 모바일에서 160px 넘게 내리면 원형 맨 위 버튼을 표시한다. 기록·동기화에는 관여하지 않는다.
(function(){
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back-to-top";
  button.hidden = true;
  button.setAttribute("aria-label", "맨 위로 올라가기");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v13"/></svg>';
  button.addEventListener("click", () => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({top:0, behavior:reduced ? "instant" : "smooth"});
  });
  document.body.append(button);
  function update(){ button.hidden = window.scrollY <= 160; }
  window.addEventListener("scroll", update, {passive:true});
  window.addEventListener("pageshow", update);
  update();
})();
