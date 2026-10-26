// 알림 당시의 푸시 내용만 보관한다. 페이지·서비스 워커 공용이며 DOM·토큰·매매 계산을 사용하지 않는다.
// 이벤트 ID는 발송 재시도·여러 기기의 중복을 구분한다. 읽음·삭제는 기존 플래너 JSON에만 저장한다.
// 같은 매매 회차의 재알림·재도달 알림은 alertKey(최초 알림 ID)와 reminderCount를 싣고 온다(수집 저장소 trade_reminders.py).
// 그 알림들은 최초 알림 항목 하나에 재알림 횟수(reminderCount)·마지막 발송 시각(lastSentAt)만 더한다.
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
        // 옛 클라이언트는 재알림을 먼저 받으면 그 가격·관측 시각을 최초 ID 아래 저장했다.
        // 같은 최초 ID/발송 시각의 완전한 스냅샷 중 더 이른 관측이 원본이다(재도달·재알림은 뒤의 시세).
        // 읽음과 재알림 집계는 유지한다. 시각이 없거나 같아 구별할 수 없으면 기존 값을 보존한다.
        if(old.reminderCount&&old.occurredAt===item.occurredAt&&old.observedAt&&item.observedAt&&item.observedAt<old.observedAt&&item.price!==undefined&&item.ma!==undefined){
          readAt(item,old.readAt);follow(item,old.reminderCount,old.lastSentAt);items.set(item.id,item);continue;
        }
        // 먼저 기록한 당시 정보는 유지하고 더 정확한 발송 스냅샷의 빈 필드만 보충한다.
        for(const [key,value] of Object.entries(item))if(old[key]===undefined||old[key]===""||(key==="name"&&old.name===old.ticker))old[key]=value;
        readAt(old,item.readAt);follow(old,item.reminderCount,item.lastSentAt);
      }}
    }
    // 후속 알림은 최초 알림 항목의 읽음·스냅샷을 그대로 두고 횟수·마지막 발송 시각만 갱신한다(가장 큰 값, 순서·중복 무관).
    for(const item of later){
      const {alertKey:key,reminderCount:count,firstOccurredAt:first}=item;
      const stray=items.get(item.id);
      if(stray){items.delete(item.id);deleted.add(item.id);} // 옛 수신함이 이 후속 알림을 따로 저장한 항목은 합치고 다시 만들지 않는다.
      let base=items.get(key);
      // 최초 알림을 못 받았으면 식별 정보만 둔다. 재알림 가격·조건을 최초 시각의 스냅샷으로 쓰지 않는다.
      // 나중에 최초 발송 이력을 받으면 위의 빈 필드 병합으로 채운다(새 저장 필드 없음).
      if(!base){base={id:key,ticker:item.ticker,line:item.line,ruleId:item.ruleId,name:item.name,type:item.type,occurredAt:first||item.occurredAt,body:""};items.set(key,base);}
      readAt(base,stray?.readAt);follow(base,count,item.occurredAt);
    }
    return {items:[...items.values()].filter(item=>!deleted.has(item.id)).sort((a,b)=>latest(b).localeCompare(latest(a))||a.id.localeCompare(b.id)),deletedIds:[...deleted].sort()};
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
  return {record,merge,enqueue,pending,acknowledge};
})();
