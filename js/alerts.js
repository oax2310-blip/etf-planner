// 기준선 알림 설정. 규칙은 state.alerts.rules, 수신 기기 설정은 state.alerts의 다른 필드에 둔다.
// 읽거나 창을 여는 것만으로 alerts를 만들지 않는다. 새 필드는 사용자가 저장·수정할 때만 만든다.
// 시세 판정·발송은 데이터 저장소의 수집 작업이 담당한다. 여기서는 마지막 시세와 기준선 간격만 표시한다.
// DOM 없이 불러와 테스트하므로 함수 밖에서 화면을 건드리지 않는다.
let editingAlertId = null;
let alertsInitialized = false;
const alertRules = () => Array.isArray(state.alerts?.rules) ? state.alerts.rules.filter(r=>r&&typeof r==="object") : [];
const krOpenReminderEnabled = () => state.alerts?.krOpenReminder===true;
function setKrOpenReminder(enabled){
  if(krOpenReminderEnabled()===enabled)return false;
  editAlerts().krOpenReminder=enabled;return true;
}
function renderKrOpenReminder(){
  const toggle=$("krOpenReminder");if(!toggle)return;
  toggle.checked=krOpenReminderEnabled();
  $("krOpenReminderStatus").textContent=toggle.checked?"ON":"OFF";
  onEdit("#krOpenReminder",(v,el)=>setKrOpenReminder(el.checked),renderKrOpenReminder);
}
// scripts/kis_prices.py classify와 같음. 국내 A 접두사도 시세 파일 키에는 그대로 남긴다. 비트코인 BTC-USD는 미국 심볼 형식으로 통과하고 수집 스크립트가 Coinbase에서 따로 받는다.
function alertTickerValid(ticker){
  const t=String(ticker||"").trim().toUpperCase();
  return /^A\d{6}$/.test(t)||/^Q\d{6}$/.test(t)||/^\d[0-9A-Z]{5}$/.test(t)||/^[A-Z][A-Z0-9.\-/]{0,11}$/.test(t);
}
function alertRuleInput(input){
  const ticker=String(input.ticker||"").trim().toUpperCase(), period=Number(input.period), tolerancePct=Number(input.tolerancePct);
  if(!alertTickerValid(ticker))return {error:"국내 종목 코드·미국 종목 심볼(비트코인은 BTC-USD)을 확인해 주세요."};
  if(!String(input.period??"").trim()||!Number.isInteger(period)||period<1||period>400)return {error:"기준선 숫자는 1~400의 정수로 넣어 주세요."};
  if(!["일선","주선","개월선"].includes(input.unit))return {error:"일선·주선·개월선 중 하나를 골라 주세요."};
  if(!String(input.tolerancePct??"").trim()||!Number.isFinite(tolerancePct)||tolerancePct<0||tolerancePct>10)return {error:"허용 범위는 0~10%로 넣어 주세요."};
  return {value:{ticker,period,unit:input.unit,tolerancePct,enabled:input.enabled!==false}};
}
function editAlerts(){
  if(!state.alerts||typeof state.alerts!=="object"||Array.isArray(state.alerts))state.alerts={rules:[]};
  if(!Array.isArray(state.alerts.rules))state.alerts.rules=[];
  return state.alerts;
}
// 실패하면 기록을 만들거나 고치지 않는다. 같은 종목·기준선을 중복 등록하지 않는다.
function writeAlertRule(input, ruleId=null){
  const result=alertRuleInput(input);if(result.error)return result;
  const rules=alertRules(), old=ruleId?rules.find(r=>r.id===ruleId):null;
  if(ruleId&&!old)return {error:"이 알림이 다른 기기에서 삭제됐습니다. 새로 추가해 주세요."};
  const v=result.value;
  if(rules.some(r=>r.id!==ruleId&&String(r.ticker||"").trim().toUpperCase()===v.ticker&&Number(r.period)===v.period&&r.unit===v.unit))return {error:"같은 종목의 기준선이 이미 있습니다. 기존 알림을 수정해 주세요."};
  const rule={...old,...v,id:old?.id||id()}, list=editAlerts().rules;
  if(old)list[list.findIndex(r=>r===old)]=rule;else list.push(rule);
  return {value:rule};
}
function removeAlertRule(ruleId){
  if(!alertRules().some(r=>r.id===ruleId))return false;
  editAlerts().rules=state.alerts.rules.filter(r=>r?.id!==ruleId);
  return true;
}
function setAlertRuleEnabled(ruleId, enabled){
  const rule=alertRules().find(r=>r.id===ruleId);if(!rule||rule.enabled===enabled)return false;
  rule.enabled=enabled;return true;
}
function alertQuoteInfo(rule, prices){
  const quote=stockEntry(prices,rule.ticker), current=Number(quote?.close), line=quote?maValue(quote,`${rule.period}${rule.unit}`):null;
  const close=Number.isFinite(current)&&current>0?current:null, ma=Number.isFinite(line)&&line>0?line:null;
  const gapPct=close&&ma?(close/ma-1)*100:null;
  return {quote,current:close,line:ma,gapPct,near:gapPct!==null&&Math.abs(gapPct)<=Number(rule.tolerancePct)+1e-10};
}
function alertRuleCard(rule){
  const info=alertQuoteInfo(rule,priceData), currency=quoteCurrency(info.quote), lineName=`${rule.period}${rule.unit}`;
  const price=value=>value===null?"—":priceText(value,currency);
  const gap=info.gapPct===null?"—":`${info.gapPct>0?"+":""}${info.gapPct.toLocaleString("ko-KR",{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
  const relation=info.gapPct===null?"시세 대기":info.near?"선 근처":info.gapPct>0?"선 위":"선 아래";
  const missing=!info.quote?"다음 시세 수집 후 현재가와 기준선을 표시합니다.":info.line===null?"이동평균을 계산할 봉이 부족할 수 있습니다. 다음 시세 수집 후 확인하세요.":"";
  return `<article class="alert-rule${rule.enabled===false?" paused":""}">
    <div class="alert-rule-head"><div><strong>${esc(rule.ticker)}</strong><span>${esc(lineName)} · 허용 ±${esc(rule.tolerancePct)}%</span></div><label class="alert-switch"><input type="checkbox" data-alert-enabled="${esc(rule.id)}" ${rule.enabled!==false?"checked":""} aria-label="${esc(rule.ticker)} ${esc(lineName)} 알림 사용" />사용</label></div>
    <div class="alert-prices"><div><small>최근 현재가</small><b>${price(info.current)}</b></div><div><small>${esc(lineName)}</small><b>${price(info.line)}</b></div><div><small>기준선과 간격</small><b class="${info.near?"near":""}">${gap}<span>${relation}</span></b></div></div>
    ${info.quote?`<div class="alert-stamp">${priceStamp(info.quote)}</div>`:""}${missing?`<p class="hint">${missing}</p>`:""}
    <div class="alert-rule-foot"><small>${rule.enabled===false?"일시 중지":"근처 진입 · 위/아래 통과 감지"}</small><div><button class="btn mini" type="button" data-edit-alert="${esc(rule.id)}">수정</button><button class="btn mini ghost" type="button" data-remove-alert="${esc(rule.id)}">삭제</button></div></div>
  </article>`;
}
function renderAlerts(){
  const list=$("alertsList");if(!list)return;
  const rules=alertRules();
  renderKrOpenReminder();
  if(typeof renderTradeAlertSummary==="function")renderTradeAlertSummary();
  list.innerHTML=rules.length?rules.map(alertRuleCard).join(""):'<p class="alert-empty">등록한 알림이 없습니다. 종목과 기준선을 추가하세요.</p>';
  $("alertsCount").textContent=`${rules.length}개`;
  const status=$("alertsSaveStatus"), linked=connected();
  status.classList.toggle("warning",!linked||sync.blocked||sync.failed);
  status.textContent=!linked?"동기화가 연결되지 않았습니다. 규칙은 이 기기에만 저장됩니다. 휴대폰·PC 알림을 받으려면 동기화와 아래 수신 설정을 완료하세요.":sync.blocked||sync.failed?"동기화를 확인해 주세요. 변경한 규칙이 수집 작업에 아직 전달되지 않았을 수 있습니다.":"알림 ON/OFF는 비공개 기록과 동기화됩니다. 알림을 받을 휴대폰·PC마다 아래에서 한 번 연결하세요.";
  onEdit("[data-alert-enabled]",(v,el)=>setAlertRuleEnabled(el.dataset.alertEnabled,el.checked),renderAlerts);
  $$("[data-edit-alert]").forEach(button=>button.onclick=()=>openAlertEditor(button.dataset.editAlert));
  $$("[data-remove-alert]").forEach(button=>button.onclick=()=>{if(removeAlertRule(button.dataset.removeAlert)){if(editingAlertId===button.dataset.removeAlert)closeAlertEditor();save();renderAlerts();}});
}
function openAlertEditor(ruleId=null){
  const rule=ruleId?alertRules().find(r=>r.id===ruleId):null;if(ruleId&&!rule)return;
  editingAlertId=ruleId;
  const form=$("alertForm"), fields=form.elements;
  fields.ticker.value=rule?.ticker||"";fields.period.value=rule?.period||60;fields.unit.value=rule?.unit||"일선";fields.tolerancePct.value=rule?.tolerancePct??0.5;
  $("alertEditorTitle").textContent=rule?"알림 수정":"새 알림";$("alertFormError").textContent="";form.hidden=false;
  fields.ticker.focus();
}
function closeAlertEditor(){editingAlertId=null;$("alertForm").hidden=true;$("alertFormError").textContent="";}
function initializeAlerts(){
  if(alertsInitialized)return;alertsInitialized=true;
  $("alertsBtn").onclick=()=>{closeAlertEditor();renderAlerts();if(typeof renderPushSetup==="function")renderPushSetup();$("alertsDialog").showModal();};
  $("closeAlerts").onclick=()=>$("alertsDialog").close();
  $("addAlertBtn").onclick=()=>openAlertEditor();$("cancelAlertEdit").onclick=closeAlertEditor;
  $("alertForm").onsubmit=event=>{
    event.preventDefault();const fields=event.currentTarget.elements, old=editingAlertId?alertRules().find(r=>r.id===editingAlertId):null;
    const result=writeAlertRule({ticker:fields.ticker.value,period:fields.period.value,unit:fields.unit.value,tolerancePct:fields.tolerancePct.value,enabled:old?.enabled!==false},editingAlertId);
    if(result.error){$("alertFormError").textContent=result.error;return;}
    save();closeAlertEditor();renderAlerts();$("addAlertBtn").focus();
  };
}
