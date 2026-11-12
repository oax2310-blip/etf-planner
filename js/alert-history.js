// 알림내역 화면·발송 이력/수신함 불러오기. state.alertHistory는 새 알림 수신·사용자 조작 때만 생성한다.
// 기존 localStorage·비공개 동기화·플래너 JSON 백업을 사용하며 매매 기록은 수정하지 않는다.
let alertHistoryFilter="all",alertHistoryBusy=false,alertHistoryAgain=false,alertHistoryMessage="";
const alertHistoryReadIds=new Map(); // 푸시를 눌러 연 항목 ID → 누른 시각(ms). 이 페이지가 열려 있는 동안만 둔다.
const alertHistoryItems=()=>alertHistoryStore.merge(state.alertHistory).items;
// 읽지 않음: 읽은 적이 없거나, 마지막으로 읽은 뒤 같은 회차의 재알림이 또 왔을 때(lastSentAt > readAt).
// 화면 판단만 하고 저장 필드(readAt·lastSentAt)는 그대로라 옛 기록·다른 기기와 호환된다.
const alertHistoryUnread=item=>!item.readAt||!!item.lastSentAt&&Date.parse(item.lastSentAt)>Date.parse(item.readAt);
// 읽음 시각은 마지막 발송 시각보다 이르지 않게 둔다. 기기 시계가 발송 서버보다 늦어도 방금 읽은 재알림이 다시 읽지 않음이 되지 않는다.
const alertHistoryReadStamp=item=>new Date(Math.max(Date.now(),Date.parse(item.lastSentAt||"")||0)).toISOString();
// 푸시를 눌러 연 알림은 뒤늦게 수신함·동기화로 들어와도 읽음으로 둔다. 누른 뒤 30분 넘어 보낸 재알림(다음 시간대)은
// 새로 온 알림이라 그대로 둔다(30분은 기기·서버 시계 차이 여유).
function alertHistoryApplyTaps(items){
  for(const item of items){const at=alertHistoryReadIds.get(item.id)??alertHistoryReadIds.get(item.alertKey);if(at!==undefined&&alertHistoryUnread(item)&&(!item.lastSentAt||Date.parse(item.lastSentAt)<=at+30*60e3))item.readAt=alertHistoryReadStamp(item);}
}
// 수신함·서버 이력의 새 유입만 마지막 발송(lastSentAt, 없으면 occurredAt)이 90일(retentionMs) 초과면 버린다.
// 삭제 ID 정리 뒤 오래된 발송의 재등장을 막으며, 동기화로 합치는 기존 items에는 적용하지 않는다.
function acceptAlertHistory(items){
  const cutoff=Date.now()-alertHistoryStore.retentionMs;
  const incoming=items.map(item=>alertHistoryStore.received(item)).filter(item=>item&&Date.parse(item.lastSentAt||item.occurredAt)>=cutoff);
  const next=alertHistoryStore.merge(state.alertHistory,{items:incoming});
  alertHistoryApplyTaps(next.items);
  if(!next.items.length&&!state.alertHistory)return false;
  if(JSON.stringify(state.alertHistory)===JSON.stringify(next))return false;
  state.alertHistory=next;save();renderAlertHistory();return true;
}
// 수신·동기화가 겹쳐도 수신 처리를 마친 이벤트만 수신함에서 제거한다(오래되어 받지 않은 항목 포함).
async function collectAlertInbox(){
  if(alertHistoryBusy){alertHistoryAgain=true;return;}
  alertHistoryBusy=true;
  try{do{alertHistoryAgain=false;const items=await alertHistoryStore.pending();acceptAlertHistory(items);if(items.length)await alertHistoryStore.acknowledge(items.map(item=>item.id));}while(alertHistoryAgain);}
  catch{alertHistoryMessage="이 기기의 알림 수신함을 읽지 못했습니다. 알림내역을 다시 열어 주세요.";renderAlertHistory();}
  finally{alertHistoryBusy=false;}
}
// 기존 평가·발송 대기를 과거 내역으로 변환하지 않는다. 적용 후 발송 쪽에서 기록한 history만 가져온다.
async function readAlertHistory(){
  const repo=sync.repo,token=sync.token;
  try{
    const response=await gh(`/repos/${repo}/contents/etf-planner-alert-state.json`,{headers:{Accept:"application/vnd.github.raw+json"}});
    if(sync.repo!==repo||sync.token!==token)return false;
    if(response.status===404)return false;
    if(!response.ok)throw Error("알림내역 읽기 실패");
    const doc=JSON.parse(await response.text());
    if(sync.repo!==repo||sync.token!==token)return false;
    if(doc.history!==undefined&&!Array.isArray(doc.history))throw Error("알림내역 형식 확인 필요");
    alertHistoryMessage="";return acceptAlertHistory(doc.history||[]);
  }catch{if(sync.repo===repo&&sync.token===token){alertHistoryMessage="발송 알림내역을 불러오지 못했습니다. 저장된 내역은 유지하며 다음 동기화에서 다시 확인합니다.";renderAlertHistory();}return false;}
}
// 알림내역만 자동 병합한다. 거래 입력의 충돌 선택·복구 기록 정책은 기존 sync.js를 따른다.
function alignAlertHistorySnapshots(local,remote,base){
  const docs=[local,remote,base].map(raw=>raw?JSON.parse(raw):null);
  const sources=docs.slice(0,2).map(doc=>doc?.alertHistory).filter(Boolean);
  if(!sources.length)return {local,remote,base};
  const merged=alertHistoryStore.merge(...sources);
  alertHistoryApplyTaps(merged.items);
  const apply=doc=>doc?JSON.stringify({...doc,alertHistory:merged}):null;
  state.alertHistory=merged;
  try{
    if(typeof storePlanner==="function")storePlanner(state);else localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    if(typeof setLocalSaveFailed==="function")setLocalSaveFailed(false);
  }catch(error){console.error(error);if(typeof setLocalSaveFailed==="function")setLocalSaveFailed(true);}
  renderAlertHistory();
  return {local:apply(docs[0]),remote:apply(docs[1]),base:apply(docs[2])};
}
// 달러선물 알림은 달러선물 화면(futures.js fmtPrice)과 같게 소수 첫째 자리, 나머지는 넷째 자리까지 보인다. 저장된 가격은 그대로 둔다.
function alertHistoryPrice(value,item){
  if(typeof value!=="number")return "확인 불가";
  const future=typeof stockNames==="object"&&stockNames.alertKind(item).menu==="달러선물",currency=item?.currency;
  const number=value.toLocaleString("ko-KR",{maximumFractionDigits:future?1:4});return currency==="USD"?`$${number}`:currency==="KRW"?`${number}원`:number;
}
function alertHistoryCondition(item){
  const target=alertHistoryPrice(item.ma,item);
  if(item.condition)return `${item.line} · 현재가가 기준값 ${target} ${item.condition==="up"?"이상에 도달":item.condition==="below"?"미만으로 이탈":"이하에 도달"}`;
  if(item.trigger==="near"&&typeof item.tolerancePct==="number")return `${item.line} · 기준선 ${target}의 ±${item.tolerancePct}% 범위에 진입`;
  if(item.trigger==="cross")return `${item.line} · 기준선을 ${item.direction==="up"?"아래에서 위로":item.direction==="down"?"위에서 아래로":"위·아래로"} 통과`;
  return item.body||`${item.line||"기준선"} 알림 · 상세 조건을 발송 내용에서 확인할 수 없습니다.`;
}
function alertHistoryTime(value){return new Date(value).toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});}
// 표시 이름·종류는 화면에서만 정한다(stock-names.js). 저장된 name·type은 받은 그대로 두고, 이름이 코드뿐이면 이 기기의 계획·자산 이름을 보인다.
// 기준선 글자는 화면에서만 'N개월선'→'N월선'(stock-names.js lineText). 저장된 line·body는 받은 그대로 둔다.
const alertHistoryText=v=>typeof stockNames==="object"?stockNames.lineText(v):String(v??"");
const alertHistoryView=(item,names)=>typeof stockNames==="object"?{name:stockNames.alertName(item,names),type:stockNames.alertKind(item).text}:{name:item.name,type:item.type};
// 최근 재알림의 실제 회차·가격을 본문과 이동에 쓰고, 첫 스냅샷은 별도로 펼쳐 본다. 옛 기록에 최근 스냅샷이 없으면 기존 표시를 유지한다.
// 읽음·삭제·재알림 횟수는 묶음 항목을 기준으로 판단한다.
const alertHistoryDisplay=item=>item.latestAlert||item;
function alertHistoryCard(item,names=null){
  const read=!alertHistoryUnread(item),count=Number.isInteger(item.reminderCount)&&item.reminderCount>0?item.reminderCount:0,shown=alertHistoryDisplay(item),recent=shown!==item,{name,type}=alertHistoryView(shown,names);
  const original=recent?`<details class="alert-history-original"><summary>처음 기록된 알림</summary><span class="alert-history-condition">${esc(alertHistoryText(alertHistoryCondition(item)))}</span><span class="alert-history-prices"><span>당시 가격 <strong>${esc(alertHistoryPrice(item.price,item))}</strong></span><span>기준값 <strong>${esc(alertHistoryPrice(item.ma,item))}</strong></span></span></details>`:"";
  return `<article class="alert-history-card${read?" is-read":""}">
    <button type="button" class="alert-history-open" data-open-history="${esc(item.id)}" aria-label="${esc(type)} ${esc(name)} ${esc(alertHistoryText(shown.line))} 알림${count?` 재알림 ${count}회`:""} ${read?"읽음":"읽지 않음"}, 종목으로 이동">
      <span class="alert-history-meta"><span class="alert-history-type">${esc(type)}</span>${item.krOpenReminder?'<span class="alert-history-reminder">한국장 재알림</span>':""}${count?`<span class="alert-history-reminder">재알림 ${count}회</span>`:""}<span class="alert-history-read">${read?"읽음":"읽지 않음"}</span><time datetime="${esc(shown.occurredAt)}">${esc(alertHistoryTime(shown.occurredAt))}</time></span>
      <span class="alert-history-name">${esc(name)}${name!==shown.ticker?`<small>${esc(shown.ticker)}</small>`:""}<span aria-hidden="true">↗</span></span>
      <span class="alert-history-condition">${recent?"최근 재알림 · ":""}${esc(alertHistoryText(alertHistoryCondition(shown)))}</span>
      ${item.krOpenReminder&&item.observedAt?`<span class="alert-history-note">미국 신호 ${esc(alertHistoryTime(item.observedAt))}${item.asOf?` · 시세 기준일 ${esc(item.asOf)}`:""}</span>`:""}
      ${count&&item.lastSentAt?`<span class="alert-history-note">최초 알림 ${esc(alertHistoryTime(item.firstOccurredAt||item.occurredAt))} · 마지막 발송 ${esc(alertHistoryTime(item.lastSentAt))}</span>`:""}
    </button><div class="alert-history-bottom"><span class="alert-history-prices"><span>${recent?"재알림 당시 가격":"당시 가격"} <strong>${esc(alertHistoryPrice(shown.price,shown))}</strong></span><span>기준값 <strong>${esc(alertHistoryPrice(shown.ma,shown))}</strong></span></span><div class="alert-history-actions">${read?"":`<button class="text-link" type="button" data-read-history="${esc(item.id)}">읽음 표시</button>`}<button class="text-link danger" type="button" data-delete-history="${esc(item.id)}" aria-label="${esc(name)} 알림 삭제">삭제</button></div></div>${original}
  </article>`;
}
// 재알림 푸시는 최초 알림 ID(alertKey)로 온다. 최초 항목을 지운 뒤 새로 만든 회차 항목은 alertKey로 찾는다.
function markAlertHistoryRead(eventId){
  const item=state.alertHistory?.items?.find(item=>item.id===eventId||item.alertKey===eventId);if(!item||!alertHistoryUnread(item))return false;
  item.readAt=alertHistoryReadStamp(item);save();renderAlertHistory();return true;
}
function noteAlertHistoryRead(eventId){
  if(typeof eventId!=="string"||!eventId||eventId.length>128)return;
  alertHistoryReadIds.set(eventId,Date.now());markAlertHistoryRead(eventId);
}
function removeAlertHistory(eventId){
  const item=alertHistoryItems().find(item=>item.id===eventId);if(!item)return false;
  removeAlertHistoryItems([item]);return true;
}
function removeAlertHistoryItems(items){
  const deletedIds=items.flatMap(alertHistoryStore.removal),at=new Date().toISOString();
  state.alertHistory=alertHistoryStore.merge(state.alertHistory,{deletedIds,deletedAt:Object.fromEntries(deletedIds.map(id=>[id,at]))});save();renderAlertHistory();
}
function renderAlertHistory(){
  const list=$("alertHistoryList");if(!list)return;
  const all=alertHistoryItems(),unread=all.filter(alertHistoryUnread),items=alertHistoryFilter==="unread"?unread:all;
  $("historyAllCount").textContent=all.length;$("historyUnreadCount").textContent=unread.length;
  $("alertsUnreadBadge").textContent=unread.length;$("alertsUnreadBadge").hidden=!unread.length;
  if(typeof renderPushConnectionStatus==="function")renderPushConnectionStatus(unread.length);
  else $("alertsBtn").ariaLabel=`알림${unread.length?`, 읽지 않은 알림 ${unread.length}개`:""}`;
  for(const button of $$("[data-history-filter]")){const selected=button.dataset.historyFilter===alertHistoryFilter;button.classList.toggle("active",selected);button.setAttribute("aria-pressed",String(selected));}
  $("readAllHistory").disabled=!unread.length;$("clearReadAlertHistory").disabled=unread.length===all.length;$("clearAlertHistory").disabled=!all.length;
  const names=items.length&&typeof stockNames==="object"?stockNames.alertMap():null;
  list.innerHTML=items.length?items.map(item=>alertHistoryCard(item,names)).join(""):`<div class="alert-history-empty"><span aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></span><strong>${alertHistoryFilter==="unread"?"읽지 않은 알림이 없습니다":"아직 알림내역이 없습니다"}</strong><p>${alertHistoryFilter==="unread"?"전체 탭에서 지난 알림을 확인하세요.":"기능 적용 이후 발생하는 알림부터 기록합니다.<br>새 알림이 오면 당시 조건과 가격을 이곳에서 확인할 수 있습니다."}</p></div>`;
  $("alertHistoryStatus").textContent=alertHistoryMessage;
  $$("[data-open-history]").forEach(button=>button.onclick=()=>{
    const item=alertHistoryItems().find(item=>item.id===button.dataset.openHistory);if(!item)return;
    markAlertHistoryRead(item.id);const target=pushAlertTarget({...alertHistoryDisplay(item),eventId:item.id});
    if(!target||!pushAlertDestination(target)){alertHistoryMessage="연결된 종목을 찾을 수 없습니다. 동기화 상태를 확인해 주세요. 삭제된 종목의 알림내역도 계속 확인할 수 있습니다.";renderAlertHistory();return;}
    alertHistoryMessage="";$("alertHistoryDialog").close();history.replaceState(null,"",pushAlertHash(target));openPlannerLocation();
  });
  $$("[data-read-history]").forEach(button=>button.onclick=()=>markAlertHistoryRead(button.dataset.readHistory));
  $$("[data-delete-history]").forEach(button=>button.onclick=()=>removeAlertHistory(button.dataset.deleteHistory));
}
function openAlertHistory(){
  if($("alertsDialog").open)$("alertsDialog").close();renderAlertHistory();$("alertHistoryDialog").showModal();collectAlertInbox();
}
function initializeAlertHistory(){
  $("alertHistoryBtn").onclick=openAlertHistory;$("closeAlertHistory").onclick=()=>$("alertHistoryDialog").close();
  $("openAlertSettings").onclick=()=>{$("alertHistoryDialog").close();openAlertSettings();};
  $$("[data-history-filter]").forEach(button=>button.onclick=()=>{alertHistoryFilter=button.dataset.historyFilter;renderAlertHistory();});
  $("readAllHistory").onclick=()=>{for(const item of state.alertHistory?.items||[])if(alertHistoryUnread(item))item.readAt=alertHistoryReadStamp(item);save();renderAlertHistory();};
  $("clearReadAlertHistory").onclick=()=>{const items=alertHistoryItems().filter(item=>!alertHistoryUnread(item));if(!items.length||!confirm(`읽은 알림 ${items.length}개를 삭제할까요?`))return;removeAlertHistoryItems(items);};
  $("clearAlertHistory").onclick=()=>{const items=alertHistoryItems();if(!items.length||!confirm(`알림내역 ${items.length}개를 모두 삭제할까요?`))return;removeAlertHistoryItems(items);};
  navigator.serviceWorker?.addEventListener("message",event=>{if(event.data?.type==="alert-history-updated"){if(event.data.item)acceptAlertHistory([event.data.item]);collectAlertInbox();}});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)collectAlertInbox();});
  // 다른 탭의 읽음·삭제는 sync.js absorbPlanner가 플래너 기록 전체와 함께 받는다(알림내역만 합쳐 옛 체결 기록을 다시 저장하지 않게).
  renderAlertHistory();collectAlertInbox();
}
