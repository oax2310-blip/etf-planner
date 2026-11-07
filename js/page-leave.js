// 앱 안 .html 링크는 대기 중인 저장만 최대 4초 기다린다. 저장·충돌 처리는 각 등록자가 맡고 입력 칸은 강제로 확정하지 않는다.
const pageLeave = (()=>{
  const handlers=[];
  let leaving=false;
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
    event.preventDefault();leaving=true;
    let timer;
    Promise.race([
      Promise.allSettled(pending.map(handler=>Promise.resolve().then(()=>handler.flush()))),
      new Promise(resolve=>{timer=setTimeout(resolve,4000);})
    ]).then(()=>{clearTimeout(timer);location.assign(url.href);});
  });
  // 뒤로 가기로 복원된 문서는 새 이동을 받을 수 있다.
  addEventListener("pageshow",event=>{if(event.persisted)leaving=false;});
  return {register:handler=>{handlers.push(handler);}};
})();
