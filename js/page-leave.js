// 앱 안 .html 링크는 대기 중인 저장만 최대 4초 기다리며 배경 블러·회전 표시·문구로 알린다. 저장·충돌 처리는 각 등록자가 맡고 입력 칸은 강제로 확정하지 않는다.
const pageLeave = (()=>{
  const handlers=[];
  let leaving=false,waiting=null,waitId=0;
  function showWaiting(link){
    waiting=document.createElement("div");waiting.className="page-leave";waiting.style.background="transparent";
    waiting.setAttribute("role","status");waiting.setAttribute("aria-live","polite");waiting.setAttribute("aria-atomic","true");
    const group=document.createElement("div");group.className="page-leave-content";
    Object.assign(group.style,{display:"flex",flexDirection:"column",alignItems:"center",gap:"16px"});
    const spinner=document.createElement("span");spinner.className="page-leave-spinner";spinner.style.margin="0";spinner.setAttribute("aria-hidden","true");
    const label=document.createElement("span");label.className="page-leave-message";label.textContent="동기화 대기 중…";label.setAttribute("aria-hidden","true");
    Object.assign(label.style,{fontSize:"15px",fontWeight:"600",color:"var(--text)",letterSpacing:"-.02em"});
    // 보이는 문구와 중복해서 읽지 않도록 읽기 도구용 안내는 하나로 유지한다.
    const message=document.createElement("span");message.className="sync-status sr-only";message.textContent="동기화 대기 중… 잠시 후 다음 화면으로 이동합니다.";
    group.append(spinner,label);waiting.append(group,message);
    // 모달 밖은 접근성 트리에서 제외되므로, 창에서 이동할 때는 안내도 그 창 안에 둔다.
    const host=link.closest("dialog[open]")||document.body;host.append(waiting);
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
    const current=++waitId;
    event.preventDefault();leaving=true;
    try{showWaiting(link);}catch(error){console.error(error);}
    let timer;
    Promise.race([
      Promise.allSettled(pending.map(handler=>Promise.resolve().then(()=>handler.flush()))),
      new Promise(resolve=>{timer=setTimeout(resolve,4000);})
    ]).then(()=>{clearTimeout(timer);if(current!==waitId)return;clearWaiting();location.assign(url.href);});
  });
  // 복원 시 이전 대기를 무효로 한다. 그 대기가 나중에 끝나도 새 안내·잠금·이동 주소를 건드리지 않는다.
  addEventListener("pageshow",event=>{if(event.persisted){waitId++;clearWaiting();}});
  return {register:handler=>{handlers.push(handler);}};
})();
