// 알림 당시의 푸시 내용만 보관한다. 페이지·서비스 워커 공용이며 DOM·토큰·매매 계산을 사용하지 않는다.
// 이벤트 ID는 발송 재시도·여러 기기의 중복을 구분한다. 읽음·삭제는 기존 플래너 JSON에만 저장한다.
// 같은 매매 회차의 재알림·재도달 알림은 alertKey(최초 알림 ID)와 reminderCount를 싣고 온다(수집 저장소 trade_reminders.py).
// 그 알림들은 최초 알림 항목 하나에 재알림 횟수(reminderCount)·마지막 발송 시각(lastSentAt)만 더한다. 그 항목을 지운 뒤 온 재알림은 새 항목 하나로 보인다.
const alertHistoryStore = (()=>{
  const clean=(value,max)=>typeof value==="string"?value.slice(0,max):"";
  const stamp=value=>typeof value==="string"&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():"";
  const positive=value=>typeof value==="number"&&Number.isFinite(value)&&value>0?value:null;
  function record(data,receivedAt){
    if(!data||typeof data!=="object")return null;
    const eventId=clean(data.eventId||data.id,128),ticker=clean(data.ticker,12).trim().toUpperCase();
    const occurredAt=stamp(data.occurredAt)||stamp(data.observedAt);
    if(!eventId||!occurredAt||!/^[A-Z0-9][A-Z0-9.\-/]{0,11}$/.test(ticker))return null;
    const line=clean(data.line,100),type=/손절|신저점 이탈/.test(line)?"손절":/재매수/.test(line)?"재매수":line.startsWith("분할매도 ")?"분할매도":line.startsWith("분할매수 ")?"분할매수":line.startsWith("매수대기 ")?"매수대기":line.startsWith("달러선물 ")?"달러선물 매수":"기준선";
    const item={id:eventId,ticker,line,ruleId:clean(data.ruleId,512),name:clean(data.name,200)||ticker,type,occurredAt,body:clean(data.body,2000)};
    for(const field of ["price","ma"]){const value=positive(data[field]);if(value!==null)item[field]=value;}
    for(const field of ["tolerancePct","gapPct"]){if(typeof data[field]==="number"&&Number.isFinite(data[field]))item[field]=data[field];}
    for(const [field,values] of [["currency",["KRW","USD"]],["condition",["up","down","below"]],["trigger",["reach","near","cross"]],["direction",["up","down","both"]]])if(values.includes(data[field]))item[field]=data[field];
    for(const field of ["observedAt","receivedAt","readAt"]){const value=stamp(field==="receivedAt"?receivedAt||data[field]:data[field]);if(value)item[field]=value;}
    if(data.krOpenReminder===true)item.krOpenReminder=true;
    if(/^\d{4}-\d\d-\d\d$/.test(data.asOf||""))item.asOf=data.asOf;
    const count=Number.isInteger(data.reminderCount)&&data.reminderCount>0&&data.reminderCount<=100000?data.reminderCount:0,lastSentAt=stamp(data.lastSentAt);
    if(count)item.reminderCount=count;
    if(lastSentAt)item.lastSentAt=lastSentAt;
    if(count&&typeof data.alertKey==="string"&&/^[0-9a-f]{64}$/.test(data.alertKey)&&data.alertKey!==eventId){
      item.alertKey=data.alertKey;const first=stamp(data.firstOccurredAt);if(first)item.firstOccurredAt=first;
    }
    return item;
  }
  const follow=(item,count,at)=>{
    if(count&&count>(item.reminderCount||0))item.reminderCount=count;
    if(at&&(!item.lastSentAt||at>item.lastSentAt))item.lastSentAt=at;
  };
  const latest=item=>item.lastSentAt||item.occurredAt;
  // 삭제 ID는 수신함·발송 이력을 다시 읽어도 복구하지 않는다. 읽음은 어느 기기에서 읽었든 유지한다.
  function merge(...histories){
    const deleted=new Set(),items=new Map(),later=[];
    const readAt=(item,value)=>{if(value&&(!item.readAt||value>item.readAt))item.readAt=value;};
    for(const history of histories){
      if(!history||typeof history!=="object")continue;
      for(const key of Array.isArray(history.deletedIds)?history.deletedIds:[])if(typeof key==="string"&&key.length<=128)deleted.add(key);
      for(const raw of Array.isArray(history.items)?history.items:[]){const item=record(raw);if(!item)continue;if(item.alertKey){later.push(item);continue;}const old=items.get(item.id);if(!old)items.set(item.id,item);else{
        // 먼저 기록한 당시 정보는 유지하고 더 정확한 발송 스냅샷의 빈 필드만 보충한다.
        for(const [key,value] of Object.entries(item))if(old[key]===undefined||old[key]===""||(key==="name"&&old.name===old.ticker))old[key]=value;
        readAt(old,item.readAt);follow(old,item.reminderCount,item.lastSentAt);
      }}
    }
    // 회차 항목을 지울 때 남긴 'alertKey:재알림 횟수'(removal)까지의 후속 알림은 지운 항목에 합쳐 보이지 않는다(표시 없는 옛 삭제는 0회).
    const covered=new Map();
    for(const key of deleted){const mark=/^([0-9a-f]{64}):(\d{1,6})$/.exec(key);if(mark)covered.set(mark[1],Math.max(covered.get(mark[1])||0,Number(mark[2])));}
    const restarted=new Map();
    // 후속 알림은 최초 알림 항목의 읽음·스냅샷을 그대로 두고 횟수·마지막 발송 시각만 갱신한다(가장 큰 값, 순서·중복 무관).
    for(const item of later.sort((a,b)=>a.reminderCount-b.reminderCount||a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id))){
      const {alertKey:key,reminderCount:count,firstOccurredAt:first,...rest}=item;
      const stray=items.get(item.id);
      if(stray){items.delete(item.id);deleted.add(item.id);} // 옛 수신함이 이 후속 알림을 따로 저장한 항목은 합치고 다시 만들지 않는다.
      // 회차 항목을 지운 뒤 온 재알림은 가장 앞선 재알림의 ID·당시 스냅샷으로 새 항목 하나를 만든다. alertKey를 남겨 다음 재알림도 이 항목에 합친다.
      if(deleted.has(key)&&!deleted.has(item.id)&&count>(covered.get(key)||0)){
        if(!restarted.has(key))restarted.set(key,{...item});
        const card=restarted.get(key);readAt(card,item.readAt);follow(card,count,item.lastSentAt||item.occurredAt);continue;
      }
      let base=items.get(key);
      if(!base){base={...rest,id:key,occurredAt:first||item.occurredAt};delete base.readAt;items.set(key,base);} // 최초 알림을 받지 못한 기기
      readAt(base,stray?.readAt);follow(base,count,item.occurredAt);
    }
    return {items:[...items.values(),...restarted.values()].filter(item=>!deleted.has(item.id)).sort((a,b)=>latest(b).localeCompare(latest(a))||a.id.localeCompare(b.id)),deletedIds:[...deleted].sort()};
  }
  // 항목을 지울 때 남길 삭제 ID. 재알림을 합친 회차 항목은 그 횟수까지 덮는 표시를 더해, 다른 기기 수신함·발송 이력에 남은
  // 같은 재알림이 다시 나타나지 않게 하고 그 뒤 재알림만 새 항목으로 보인다.
  function removal(item){
    const key=item.alertKey||item.id,count=item.reminderCount;
    return Number.isInteger(count)&&count>0&&/^[0-9a-f]{64}$/.test(key)?[item.id,`${key}:${count}`]:[item.id];
  }
  let connection;
  function database(){
    if(!connection)connection=new Promise((resolve,reject)=>{
      if(typeof indexedDB==="undefined"){reject(Error("알림 수신함을 사용할 수 없습니다."));return;}
      const request=indexedDB.open("etf-planner-alert-inbox",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("events",{keyPath:"id"});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    }).catch(error=>{connection=null;throw error;});
    return connection;
  }
  async function transaction(mode,action){
    const db=await database();return new Promise((resolve,reject)=>{
      const tx=db.transaction("events",mode);let result;
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error("알림 수신함 저장 실패"));tx.onerror=()=>{};
      action(tx.objectStore("events"),value=>result=value);
    });
  }
  async function enqueue(data){
    const item=record(data,new Date().toISOString());if(!item)return null;
    await transaction("readwrite",store=>{const request=store.add(item);request.onerror=event=>{if(request.error?.name==="ConstraintError"){event.preventDefault();event.stopPropagation();}};});return item;
  }
  const pending=()=>transaction("readonly",(store,done)=>{const request=store.getAll();request.onsuccess=()=>done(request.result);});
  const acknowledge=ids=>transaction("readwrite",store=>{for(const key of ids)store.delete(key);});
  return {record,merge,removal,enqueue,pending,acknowledge};
})();
