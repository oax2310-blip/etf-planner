// 앱 안 .html 링크와 동기화 중 삭제 조작은 대기 중인 동기화를 최대 4초 기다리며 배경 블러·회전 표시·문구로 알린다. 저장·충돌 처리는 각 등록자가 맡고 입력 칸은 강제로 확정하지 않는다.
const pageLeave = (()=>{
  const handlers=[];
  let leaving=false,waiting=null,waitId=0,waitingDialog=null,stopDialogWatch=null;
  function showWaiting(anchor,labelText="동기화 대기 중…",announceText="동기화 대기 중… 잠시 후 다음 화면으로 이동합니다."){
    waiting=document.createElement("div");waiting.className="page-leave";
    waiting.setAttribute("role","status");waiting.setAttribute("aria-live","polite");waiting.setAttribute("aria-atomic","true");
    const group=document.createElement("div");group.className="page-leave-content";
    const spinner=document.createElement("span");spinner.className="page-leave-spinner";spinner.setAttribute("aria-hidden","true");
    const label=document.createElement("span");label.className="page-leave-message";label.textContent=labelText;label.setAttribute("aria-hidden","true");
    // 보이는 문구와 중복해서 읽지 않도록 읽기 도구용 안내는 하나로 유지한다.
    const message=document.createElement("span");message.className="sync-status sr-only";message.textContent=announceText;
    group.append(spinner,label);waiting.append(group,message);
    // 모달 밖은 접근성 트리에서 제외되므로, 창에서 누를 때는 안내도 그 창 안에 둔다.
    const host=anchor?.closest?.("dialog[open]")||document.body;host.append(waiting);
    if(host!==document.body){
      waitingDialog=host;const current=waitId,events=["cancel","close","beforetoggle"];
      const dismiss=event=>{
        if(current!==waitId)return;
        if(event.type==="beforetoggle"&&event.newState!=="closed"||event.type==="close"&&host.open)return;
        waitId++;clearWaiting();
      };
      for(const type of events)host.addEventListener(type,dismiss);
      stopDialogWatch=()=>{for(const type of events)host.removeEventListener(type,dismiss);};
    }
    // 입력 포커스를 옮기지 않고 열린 설정 창 위에도 표시한다. popover가 없는 브라우저는 고정 레이어를 쓴다.
    if(typeof waiting.showPopover==="function"){waiting.setAttribute("popover","manual");waiting.showPopover();}
  }
  // 다음 문서 로딩을 취소하면 pageshow가 오지 않으므로, 후속 동작 전에 안내와 잠금을 함께 푼다.
  function clearWaiting(){stopDialogWatch?.();stopDialogWatch=null;waitingDialog=null;waiting?.remove();waiting=null;leaving=false;}
  function runWaiting(anchor,work,finish,options={}){
    if(leaving)return false;
    const current=++waitId;
    leaving=true;
    try{showWaiting(anchor,options.label,options.announce);}catch(error){console.error(error);}
    const timeoutMs=Number.isFinite(options.timeoutMs)&&options.timeoutMs>0?options.timeoutMs:4000;
    let timer,timedOut=false;
    Promise.race([
      Promise.resolve().then(work).then(()=>true,()=>true),
      new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve(false);},timeoutMs);})
    ]).then(()=>{
      clearTimeout(timer);if(current!==waitId)return;
      // close 이벤트가 늦게 와도 닫힌 창에서 자동 실행하지 않는다. 이미 시작한 동기화는 중단하지 않는다.
      if(waitingDialog&&!waitingDialog.open){waitId++;clearWaiting();return;}
      clearWaiting();finish({timedOut});
    });
    return true;
  }
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
    event.preventDefault();
    runWaiting(
      link,
      ()=>Promise.allSettled(pending.map(handler=>Promise.resolve().then(()=>handler.flush()))),
      ()=>{location.assign(url.href);}
    );
  });
  // 복원 시 이전 대기를 무효로 한다. 그 대기가 나중에 끝나도 새 안내·잠금·후속 동작을 건드리지 않는다.
  addEventListener("pageshow",event=>{if(event.persisted){waitId++;clearWaiting();}});
  return {register:handler=>{handlers.push(handler);},wait:runWaiting};
})();
