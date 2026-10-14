// 알림 당시의 푸시 내용만 보관한다. 페이지·서비스 워커 공용이며 DOM·토큰·매매 계산을 사용하지 않는다.
// 이벤트 ID는 발송 재시도·여러 기기의 중복을 구분한다. 읽음·삭제는 기존 플래너 JSON에만 저장한다.
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
    return item;
  }
  // 삭제 ID는 수신함·발송 이력을 다시 읽어도 복구하지 않는다. 읽음은 어느 기기에서 읽었든 유지한다.
  function merge(...histories){
    const deleted=new Set(),items=new Map();
    for(const history of histories){
      if(!history||typeof history!=="object")continue;
      for(const key of Array.isArray(history.deletedIds)?history.deletedIds:[])if(typeof key==="string"&&key.length<=128)deleted.add(key);
      for(const raw of Array.isArray(history.items)?history.items:[]){const item=record(raw);if(!item)continue;const old=items.get(item.id);if(!old)items.set(item.id,item);else{
        // 먼저 기록한 당시 정보는 유지하고 더 정확한 발송 스냅샷의 빈 필드만 보충한다.
        for(const [key,value] of Object.entries(item))if(old[key]===undefined||old[key]===""||(key==="name"&&old.name===old.ticker))old[key]=value;
        if(item.readAt&&(!old.readAt||item.readAt>old.readAt))old.readAt=item.readAt;
      }}
    }
    return {items:[...items.values()].filter(item=>!deleted.has(item.id)).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||a.id.localeCompare(b.id)),deletedIds:[...deleted].sort()};
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
