// 앱 안 .html 링크는 대기 중인 저장만 최대 4초 기다리며 이유를 표시한다. 저장·충돌 처리는 각 등록자가 맡고 입력 칸은 강제로 확정하지 않는다.
const pageLeave = (()=>{
  const handlers=[];
  let leaving=false,waiting=null;
  function showWaiting(){
    waiting=document.createElement("div");waiting.className="page-leave";
    waiting.setAttribute("role","status");waiting.setAttribute("aria-live","polite");waiting.setAttribute("aria-atomic","true");
    const panel=document.createElement("div");panel.className="page-leave-panel";
    const spinner=document.createElement("span");spinner.className="page-leave-spinner";spinner.setAttribute("aria-hidden","true");
    const title=document.createElement("strong");title.className="page-leave-title";title.textContent="동기화 대기 중…";
    const hint=document.createElement("p");hint.className="page-leave-hint";hint.textContent="잠시 후 다음 화면으로 이동합니다.";
    panel.append(spinner,title,hint);waiting.append(panel);
    // 모달 밖은 접근성 트리에서 제외되므로, 창에서 이동할 때는 안내도 그 창 안에 둔다.
    const host=document.activeElement?.closest?.("dialog[open]")||document.body;host.append(waiting);
    // 입력 포커스를 옮기지 않고 열린 설정 창 위에도 표시한다. popover가 없는 브라우저는 고정 레이어를 쓴다.
    if(typeof waiting.showPopover==="function"){waiting.setAttribute("popover","manual");waiting.showPopover();}
  }
  // 다음 문서 로딩을 취소하면 pageshow가 오지 않으므로, 이동 요청 전에 안내와 잠금을 함께 푼다.
  function clearWaiting(){waiting?.remove();waiting=null;leaving=false;}
  document.addEventListener("click",event=>{
    if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest?.("a[href]");
    if(!link||link.hasAttribute("target")||link.hasAttribute("download"))return;
    const href=link.getAttribute("href");
    if(!href||href.trim().startsWith("#"))return;
    let url;try{url=new URL(href,location.href);}catch{return;}
    if(url.origin!==location.origin||!url.pathname.endsWith(".html"))return;
    if(leaving){event.preventDefault();return;}
    const pending=handlers.filter(handler=>handler.pending());
    if(!pending.length)return;
    event.preventDefault();leaving=true;showWaiting();
    let timer;
    Promise.race([
      Promise.allSettled(pending.map(handler=>Promise.resolve().then(()=>handler.flush()))),
      new Promise(resolve=>{timer=setTimeout(resolve,4000);})
    ]).then(()=>{clearTimeout(timer);clearWaiting();location.assign(url.href);});
  });
  // 뒤로 가기로 복원된 문서는 새 이동을 받을 수 있다.
  addEventListener("pageshow",event=>{if(event.persisted)clearWaiting();});
  return {register:handler=>{handlers.push(handler);}};
})();
