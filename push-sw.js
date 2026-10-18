// 수신 알림의 당시 내용을 로컬 수신함에 저장한다. 토큰·매매 기록을 캐시하거나 네트워크로 보내지 않는다.
importScripts("js/alert-target.js?v=189","js/alert-history-store.js?v=189","js/stock-names.js?v=208");
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const text=(value,max)=>typeof value==="string"?value.slice(0,max):"";
  const historyTask=alertHistoryStore.enqueue(data).catch(()=>alertHistoryStore.record(data)).then(async item=>{
    if(!item)return;
    for(const client of await self.clients.matchAll({type:"window",includeUncontrolled:true}))client.postMessage?.({type:"alert-history-updated",item});
  }).catch(()=>{});
  // 제목·본문만 종목 이름과 알림 종류로 바꾼다(stock-names.js notice). 수신함에는 받은 내용 그대로 저장한다.
  const shown=stockNames.recall().catch(()=>null).then(names=>{
    let view;try{view=stockNames.notice(data,names);}catch{view={title:text(data.title,100)||"매매 플래너 알림",body:text(data.body,400)||"설정한 기준선 알림을 확인해 주세요."};}
    return self.registration.showNotification(view.title,{
      body:view.body,
      tag:text(data.eventId,100)||"ma-alert",data:{url:self.registration.scope+pushAlertHash(data)},
      icon:new URL("push-icon.svg",self.registration.scope).href
    });
  });
  event.waitUntil(Promise.all([historyTask,shown]));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const scope=new URL(self.registration.scope);
    let hash="";
    try{const sent=new URL(event.notification.data?.url);if(sent.origin===scope.origin&&sent.pathname===scope.pathname)hash=pushAlertHash(pushAlertTargetFromHash(sent.hash));}catch{}
    const url=scope.href+hash;
    for(const client of await self.clients.matchAll({type:"window",includeUncontrolled:true})){
      const current=new URL(client.url);
      if(current.origin!==scope.origin||![scope.pathname,scope.pathname+"index.html"].includes(current.pathname)||!("navigate" in client))continue;
      try{const opened=await client.navigate(url);if(opened)return await opened.focus();}catch{}
    }
    return self.clients.openWindow(url);
  })());
});
