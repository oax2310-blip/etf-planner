// 수신 알림만 표시한다. 개인 기록·토큰을 캐시하거나 네트워크로 보내지 않는다.
self.addEventListener("push",event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const text=(value,max)=>typeof value==="string"?value.slice(0,max):"";
  event.waitUntil(self.registration.showNotification(text(data.title,100)||"매매 플래너 알림",{
    body:text(data.body,400)||"설정한 기준선 알림을 확인해 주세요.",
    tag:text(data.eventId,100)||"ma-alert",data:{url:self.registration.scope},
    icon:new URL("push-icon.svg",self.registration.scope).href
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=self.registration.scope;
    for(const client of await self.clients.matchAll({type:"window",includeUncontrolled:true})){
      if(client.url.startsWith(url)&&"focus" in client)return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
