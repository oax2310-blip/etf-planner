// 달러선물 분할매수 계획 창(기준선별 직접 설정·시작·종료 기준 자동 배분). 계산·화면은 futures.js.
// DOM 없는 계산 호출을 위해 함수 밖에서 화면을 건드리지 않는다. 수정 중인 초안은 화면 상태라 저장하지 않는다.
let futurePlanDraft=null;
// 이동평균 시세 갱신은 사용자 설정 충돌로 취급하지 않는다.
function futurePlanConfigKey(plan){const config={...plan};if(config.endLine)delete config.endPrice;return JSON.stringify(config);}

// 수정 창에서 바꾼 기준가·계약 수·알림만 최신 구간에 적용한다. 그 사이 채워진 시세·체결·알림은 보존한다.
// 실패 시 원본을 건드리지 않으며, 이미 매수한 계약보다 줄이거나 같은 평균선을 중복 추가하지 않는다.
function applyFuturePlanEdits(f,base,edited,alertEdits=[]){
  if(!Array.isArray(base)||!Array.isArray(edited)||edited.length<base.length||edited.length>80)return false;
  const next={levels:JSON.parse(JSON.stringify(f.levels)),...(f.buyPlan?.endLine?{buyPlan:f.buyPlan}:{})},changedNames=[];let changed=false;
  for(let i=0;i<edited.length;i++){
    const row=edited[i],price=Number(row.price),qty=Number(row.contracts),name=futureLineName(row);
    if(!Number.isFinite(price)||price<0||!Number.isInteger(qty)||qty<0||qty>100)return false;
    if(i>=base.length){
      if(next.levels.length>=80||name&&next.levels.some(l=>futureLineName(l)===name))return false;
      const added=JSON.parse(JSON.stringify(row));resizeTranches(added,qty);next.levels.push(added);
      if(name)changedNames.push(name);changed=true;continue;
    }
    const original=base[i],oldName=futureLineName(original);
    if(name!==oldName||row.label!==original.label)return false;
    const index=oldName?next.levels.findIndex(l=>futureLineName(l)===oldName):next.levels.findIndex((l,j)=>j===i&&!futureLineName(l)&&l.label===original.label);
    if(index<0)return false;
    const level=next.levels[index];
    if(row.notify!==original.notify||alertEdits.includes(i)){
      if(typeof row.notify!=="boolean")return false;
      level.notify=row.notify;level.tranches.forEach(t=>delete t.notify);changed=true;
    }
    if(qty!==Number(original.contracts)){
      if(qty<level.tranches.filter(t=>t.completed).length)return false;
      resizeTranches(level,qty);changed=true;
    }
    if(price!==Number(original.price)){
      level.price=price;
      if(oldName)changedNames.push(oldName);
      else level.tranches.forEach(t=>{if(!t.completed)t.price=price;});
      changed=true;
    }
  }
  if(changed){
    if(changedNames.length)refreshFutureBuyPrices(next,changedNames);
    refreshFutureBuyPrices(next);f.levels=next.levels;
  }
  return true;
}

function openFuturePlanDialog(){
  const f=state.futures,base=JSON.parse(JSON.stringify(f.levels));
  const active=base.find(l=>Number(l.contracts)>0),unit=active?movingLineUnit(futureLineName(active)):"일선";
  const contracts=base.reduce((n,l)=>n+Number(l.contracts||0),0);
  futurePlanDraft={base,levels:JSON.parse(JSON.stringify(base)),unit,alertEdits:new Set(),basePlan:futurePlanConfigKey(f.buyPlan),autoEnabled:!!f.buyPlan||!contracts,autoDirty:false,
    endMode:f.buyPlan?.endLine?"ma":"price",endLine:f.buyPlan?.endLine||"150일선",manualEndPrice:f.buyPlan?.endLine?(f.buyPlan.manualEndPrice??""):(f.buyPlan?.endPrice??""),
    auto:f.buyPlan?JSON.parse(JSON.stringify(f.buyPlan)):{startLine:futureLineName(active)||"25일선",endPrice:"",contracts:contracts||"",units:["선","일선","개월선"]}};
  renderFuturePlanDialog();$("futurePlanDialog").showModal();
}

// 새 시작선에는 확인된 이동평균 시세만 채운다. 미리보기·저장 준비는 원본 기록을 바꾸지 않는다.
function futureAutoSource(f,config,entry,at=""){
  if(at&&(Date.parse(f.auto?.at)||0)>(Date.parse(at)||0))entry=null;
  const levels=JSON.parse(JSON.stringify(f.levels)),name=movingLineName(config.startLine);
  if(name&&!levels.some(l=>futureLineName(l)===name))levels.push({days:parseInt(name),unit:movingLineUnit(name),price:0,confirmed:false,contracts:0,tranches:[]});
  const start=levels.find(l=>futureLineName(l)===name),price=maValue(entry,name);
  if(start&&!(Number(start.price)>0)&&price>0)start.price=priceRound(price,2);
  const buyPlan={...config};
  if(config.endLine)buyPlan.endPrice=priceRound(maValue(entry,config.endLine),2)??(f.buyPlan?.endLine===config.endLine?f.buyPlan.endPrice:0);
  return {...f,levels,buyPlan};
}

function futureAutoBreakdown(f){
  const groups=new Map();
  for(const l of f.levels){
    if(!(Number(l.contracts)>0))continue;
    const name=futureLineName(l),unit=movingLineUnit(name),key=l.planEnd?"end":unit||"manual";
    if(!groups.has(key))groups.set(key,{names:[],rounds:new Set(),contracts:0});
    const group=groups.get(key);if(name)group.names.push(name);group.contracts+=l.tranches.length;
    l.tranches.forEach((t,i)=>group.rounds.add(`${name||l.label}:${futureTrancheSlot(l,t,i)}`));
  }
  const labels={선:"시선",일선:"일선",주선:"주선",개월선:"월선",end:"종료가",manual:"기존 매수"};
  return [...MA_UNITS,"end","manual"].filter(key=>groups.has(key)).map(key=>{
    const g=groups.get(key),last=g.names.sort((a,b)=>parseInt(a)-parseInt(b)).at(-1);
    return `<div><strong>${labels[key]}</strong><span>${last?`${esc(movingLineText(last))}까지 · `:""}${g.rounds.size}분할 · ${g.contracts}계약</span></div>`;
  }).join("");
}

function renderFuturePlanDialog(){
  const draft=futurePlanDraft;if(!draft)return;
  const dialog=$("futurePlanDialog"),f=state.futures,fe=futuresEntry(priceData,f);
  const units=[["선","시선 · 60분봉"],["일선","일선"],["주선","주선"],["개월선","월선"],["","직접 입력"]];
  const lineOptions=selected=>units.filter(([value])=>value).map(([value,label])=>`<option value="${value}"${selected===value?" selected":""}>${label}</option>`).join("");
  const options=selected=>units.map(([value,name])=>`<option value="${value}"${selected===value?" selected":""}>${name}</option>`).join("");
  dialog.innerHTML=`<form id="futurePlanForm" class="dialog-inner" novalidate><div class="dialog-head"><h2 id="futurePlanTitle">분할매수 계획 수정</h2><button class="btn mini ghost" type="button" id="closeFuturePlan" aria-label="수정 창 닫기">닫기</button></div>
    <label class="field future-plan-mode"><span>배분 방식</span><select id="futurePlanMode"><option value="auto"${draft.autoEnabled?" selected":""}>시작·종료 기준으로 자동 배분</option><option value="manual"${draft.autoEnabled?"":" selected"}>기준선별 직접 설정</option></select></label>
    <div id="futureAutoFields"${draft.autoEnabled?"":' class="hidden"'}><div class="future-auto-grid"><label class="field future-auto-start"><span>시작기준선</span><div><input id="futureAutoPeriod" type="number" min="1" max="400" step="1" inputmode="numeric" value="${parseInt(draft.auto.startLine)||""}" required aria-label="시작 이동평균 기간"><select id="futureAutoStartUnit" aria-label="시작 이동평균 시간축">${lineOptions(movingLineUnit(draft.auto.startLine))}</select></div><small id="futureAutoStartPrice"></small></label>
    <div class="future-auto-end"><label class="field"><span>종료가격 설정</span><select id="futureAutoEndMode"><option value="price"${draft.endMode==="price"?" selected":""}>직접 가격 입력</option><option value="ma"${draft.endMode==="ma"?" selected":""}>이동평균선 선택</option></select></label>
    <label class="field" id="futureAutoEndPriceField"${draft.endMode==="ma"?' hidden':""}><span>종료가격 (원)</span><input id="futureAutoEnd" type="number" min="0.0001" step="any" inputmode="decimal" value="${esc(draft.manualEndPrice)}" required${draft.endMode==="ma"?" disabled":""}></label>
    <div class="field future-auto-start" id="futureAutoEndLineField"${draft.endMode==="ma"?"":" hidden"}><span>종료기준선</span><div><input id="futureAutoEndPeriod" type="number" min="1" max="400" step="1" inputmode="numeric" value="${parseInt(draft.endLine)||""}" required aria-label="종료 이동평균 기간"${draft.endMode==="ma"?"":" disabled"}><select id="futureAutoEndUnit" aria-label="종료 이동평균 시간축"${draft.endMode==="ma"?"":" disabled"}>${lineOptions(movingLineUnit(draft.endLine))}</select></div><small id="futureAutoEndPrice"></small></div></div>
    <label class="field future-auto-contracts"><span>총 매수 계약 수</span><input id="futureAutoContracts" type="number" min="1" max="100" step="1" inputmode="numeric" value="${esc(draft.auto.contracts)}" required></label></div>
    <fieldset class="future-auto-units"><legend>배분할 기준선</legend>${units.filter(([value])=>value).map(([value,label])=>`<label><input type="checkbox" data-future-auto-unit="${value}"${draft.auto.units.includes(value)?" checked":""}>${label}</label>`).join("")}</fieldset>
    <div id="futureAutoPreview" class="future-auto-preview" aria-live="polite"></div><p class="hint future-auto-hint">시세가 있는 기준선으로 회차와 계약 수를 계산합니다. 이미 매수한 계약은 포함하고, 남은 계약만 자동 배분합니다.</p></div>
    <div id="futureManualFields"${draft.autoEnabled?' class="hidden"':""}>
    <div class="future-plan-toolbar"><label class="field"><span>시간축</span><select id="futurePlanUnit">${options(draft.unit)}</select></label><span id="futurePlanCount"></span></div>
    <div class="future-plan-head"><span>기준선</span><span>기준가 (원)</span><span>계약 수</span></div><div class="future-plan-rows">${draft.levels.map((l,i)=>{const name=futureLineName(l),unit=movingLineUnit(name),bought=l.tranches.filter(t=>t.completed).length;return `<div class="future-plan-row${unit===draft.unit?"":" hidden"}" data-future-plan-unit="${unit}"><strong>${esc(movingLineText(name||l.label||`추가 ${i+1}`))}${bought?`<small>완료 ${bought}계약</small>`:""}</strong><input data-future-plan-price="${i}" type="number" min="0" step="any" inputmode="decimal" value="${futureShown(l.price)}" required aria-label="${esc(movingLineText(name||l.label||`추가 ${i+1}`))} 기준가"><input data-future-plan-qty="${i}" type="number" min="${bought}" max="100" step="1" inputmode="numeric" value="${esc(l.contracts)}" required aria-label="${esc(movingLineText(name||l.label||`추가 ${i+1}`))} 계획 계약 수"><small class="future-plan-preview" data-future-plan-preview="${i}"></small></div>`;}).join("")}</div>
    <details class="future-plan-add"><summary>기준선 추가</summary><div class="future-line-add"><input id="newLevelPeriod" type="number" min="1" max="400" step="1" value="200" aria-label="추가할 이동평균 기간"><select id="newLevelUnit" aria-label="추가할 이동평균 시간축">${options(draft.unit)}</select><button class="btn mini" id="addLevel" type="button">추가</button></div></details>
    ${typeof tradeAlertToggle==="function"?`<details class="future-plan-notify"><summary>기준선 전체 알림</summary><p class="hint">변경한 기준선의 모든 회차에 적용합니다.</p><div class="future-plan-notify-grid">${draft.levels.map((l,i)=>{const name=futureLineName(l),done=Number(l.contracts)>0&&l.tranches.length>=Number(l.contracts)&&l.tranches.every(t=>t.completed);return `<div class="${movingLineUnit(name)===draft.unit?"":"hidden"}" data-future-notify-unit="${movingLineUnit(name)}">${tradeAlertToggle(tradeLevelEnabled(f,l),`data-future-plan-alert="${i}"`,movingLineText(`${name||l.label||`추가 ${i+1}`} 매수`),done,movingLineText(name||l.label||`추가 ${i+1}`))}</div>`;}).join("")}</div></details>`:""}
    </div>
    <p class="future-plan-error" id="futurePlanError" role="alert"></p><div class="dialog-foot"><button class="btn" id="cancelFuturePlan" type="button">취소</button><button class="btn primary" type="submit">저장</button></div></form>`;
  const updateAutoPreview=()=>{
    const source=futureAutoSource({...f,levels:draft.levels},draft.auto,fe,priceData?.updatedAt),plan=futureAutoBuyPlan(source);
    $("futureAutoStartPrice").textContent=plan.startPrice>0?`시작 기준가 ${fmtPrice(plan.startPrice)}원`:"시작 기준선 시세 대기";
    $("futureAutoEndPrice").textContent=source.buyPlan.endPrice>0?`종료 기준가 ${fmtPrice(source.buyPlan.endPrice)}원`:"종료 기준선 시세 없음";
    if(plan.error){$("futureAutoPreview").innerHTML=`<p class="hint" role="alert">${esc((draft.endMode==="price"&&draft.auto.endPrice===""||draft.auto.contracts==="")?"종료가격과 총 계약 수를 입력하면 자동 배분 결과를 보여 줍니다.":plan.error)}</p>`;return;}
    const used=new Set(plan.rows.map(r=>r.key));
    const body=plan.rows.map(r=>`<div class="future-auto-preview-row"><span>${esc(movingLineText(r.line))}${r.fixed?" · 직접 수정":""}${r.key==="end"?"":` <small>${r.slot+1}차</small>`}</span><span>${fmtPrice(r.price)}원</span><strong>${r.contracts}계약</strong></div>`).join("");
    const arranged=JSON.parse(JSON.stringify(source));applyFutureAutoBuyPlan(arranged);
    $("futureAutoPreview").innerHTML=`<div class="future-auto-preview-head"><strong>${plan.waiting?"추가 매수 대기":`${used.size}분할 · 남은 ${plan.remaining}계약`}</strong><span>총 ${plan.config.contracts}계약${plan.completed?` · 매수 완료 ${plan.completed}`:""}</span></div>${plan.waiting?`<p class="hint">${esc(plan.waiting)}</p>`:`<div class="future-auto-breakdown">${futureAutoBreakdown(arranged)}</div><div class="future-auto-preview-table"><div class="future-auto-preview-row head"><span>기준선 · 회차</span><span>매수가</span><span>계약 수</span></div>${body}</div>`}`;
  };
  const readAuto=()=>{
    const unit=$("futureAutoStartUnit").value;
    $$("[data-future-auto-unit]").forEach(input=>{input.disabled=input.dataset.futureAutoUnit===unit;if(input.disabled)input.checked=true;});
    draft.manualEndPrice=$("futureAutoEnd").value;draft.endLine=`${$("futureAutoEndPeriod").value}${$("futureAutoEndUnit").value}`;
    draft.auto={...draft.auto,startLine:`${$("futureAutoPeriod").value}${unit}`,endPrice:$("futureAutoEnd").value,contracts:$("futureAutoContracts").value,units:[...$$("[data-future-auto-unit]")].filter(x=>x.checked).map(x=>x.dataset.futureAutoUnit)};
    if(draft.endMode==="ma"){draft.auto.endLine=draft.endLine;if(Number(draft.manualEndPrice)>0)draft.auto.manualEndPrice=Number(draft.manualEndPrice);else delete draft.auto.manualEndPrice;}
    else{delete draft.auto.endLine;delete draft.auto.manualEndPrice;}
    draft.autoDirty=true;$("futurePlanError").textContent="";updateAutoPreview();
  };
  $$("#futureAutoPeriod, #futureAutoEnd, #futureAutoEndPeriod, #futureAutoContracts").forEach(input=>input.oninput=readAuto);
  $("futureAutoEndMode").onchange=e=>{
    draft.endMode=e.target.value;const ma=draft.endMode==="ma";
    $("futureAutoEndPriceField").hidden=ma;$("futureAutoEnd").disabled=ma;
    $("futureAutoEndLineField").hidden=!ma;$("futureAutoEndPeriod").disabled=!ma;$("futureAutoEndUnit").disabled=!ma;readAuto();
  };
  $("futureAutoEndUnit").onchange=readAuto;
  $("futureAutoStartUnit").onchange=readAuto;$$("[data-future-auto-unit]").forEach(input=>{input.onchange=readAuto;input.disabled=input.dataset.futureAutoUnit===movingLineUnit(draft.auto.startLine);if(input.disabled)input.checked=true;});
  $("futurePlanMode").onchange=e=>{draft.autoEnabled=e.target.value==="auto";$("futureAutoFields").classList.toggle("hidden",!draft.autoEnabled);$("futureManualFields").classList.toggle("hidden",draft.autoEnabled);$("futurePlanError").textContent="";updateAutoPreview();};
  updateAutoPreview();
  const updatePreview=()=>{
    $("futurePlanCount").textContent=`총 ${draft.levels.reduce((n,l)=>n+Number(l.contracts||0),0)}계약`;
    $$("[data-future-plan-preview]").forEach(el=>{const i=Number(el.dataset.futurePlanPreview),l=draft.levels[i],prices=futureLineName(l)?futureBuyPrices(draft.levels,i):[Number(l.price)];el.textContent=Number(l.contracts)>0&&Number(l.price)>0?prices.map((p,j)=>`${j+1}차 ${fmtPrice(p)}원`).join(" · "):"";});
  };
  updatePreview();
  $("futurePlanUnit").onchange=e=>{draft.unit=e.target.value;$$("[data-future-plan-unit]").forEach(row=>row.classList.toggle("hidden",row.dataset.futurePlanUnit!==draft.unit));$$("[data-future-notify-unit]").forEach(row=>row.classList.toggle("hidden",row.dataset.futureNotifyUnit!==draft.unit));};
  $$("[data-future-plan-alert]").forEach(input=>{
    if(input.disabled)return;
    const i=Number(input.dataset.futurePlanAlert),l=draft.levels[i],flags=l.tranches.filter(t=>!t.completed).map(t=>tradeFutureTrancheEnabled(f,l,t)),name=movingLineText(futureLineName(l)||l.label||`추가 ${i+1}`);
    input.checked=flags.length?flags.every(Boolean):tradeLevelEnabled(f,l);input.indeterminate=flags.some(Boolean)&&!flags.every(Boolean);
    input.nextElementSibling.textContent=`${name} 알림 ${input.indeterminate?"일부 ON":input.checked?"ON":"OFF"}`;
    input.onchange=()=>{l.notify=input.checked;l.tranches.forEach(t=>delete t.notify);draft.alertEdits.add(i);input.nextElementSibling.textContent=`${name} 알림 ${input.checked?"ON":"OFF"}`;};
  });
  $$("[data-future-plan-price], [data-future-plan-qty]").forEach(input=>input.oninput=()=>{const isPrice=input.dataset.futurePlanPrice!=null,index=Number(isPrice?input.dataset.futurePlanPrice:input.dataset.futurePlanQty);draft.levels[index][isPrice?"price":"contracts"]=Number(input.value);updatePreview();});
  const close=()=>dialog.close();$("closeFuturePlan").onclick=close;$("cancelFuturePlan").onclick=close;
  dialog.onclose=()=>{futurePlanDraft=null;};
  $("futurePlanForm").onsubmit=e=>{
    e.preventDefault();
    const invalid=e.currentTarget.querySelector(draft.autoEnabled?"#futureAutoFields input:invalid":"[data-future-plan-price]:invalid, [data-future-plan-qty]:invalid");
    if(invalid){
      const unit=invalid.closest("[data-future-plan-unit]")?.dataset.futurePlanUnit;
      if(unit!=null){$("futurePlanUnit").value=unit;$("futurePlanUnit").dispatchEvent(new Event("change"));}
      invalid.reportValidity();return;
    }
    const latest=state.futures,next=JSON.parse(JSON.stringify(latest));
    if(futurePlanConfigKey(latest.buyPlan)!==draft.basePlan||!applyFuturePlanEdits(next,draft.base,draft.levels,[...draft.alertEdits])){$("futurePlanError").textContent="완료한 계약 수와 중복 기준선을 확인하세요. 기록이 갱신됐다면 창을 다시 열어 주세요.";return;}
    if(draft.autoEnabled&&(!latest.buyPlan||draft.autoDirty||JSON.stringify(draft.levels)!==JSON.stringify(draft.base))){
      const source=futureAutoSource(next,draft.auto,futuresEntry(priceData,latest),priceData?.updatedAt),plan=futureAutoBuyPlan(source);
      if(plan.error||plan.startPrice>plan.config.endPrice){$("futurePlanError").textContent=plan.error||"종료가격은 시작 기준가 이상으로 입력하세요.";return;}
      if(source.levels.length+(source.levels.some(l=>l.planEnd)?0:1)>80){$("futurePlanError").textContent="종료가를 포함해 기준선은 80개까지 설정할 수 있습니다.";return;}
      applyFutureAutoBuyPlan(source);next.levels=source.levels;next.buyPlan=source.buyPlan;
    }
    if(!draft.autoEnabled)delete next.buyPlan;
    latest.levels=next.levels;if(next.buyPlan)latest.buyPlan=next.buyPlan;else delete latest.buyPlan;
    save();dialog.close();renderFutures();
  };
  $("addLevel").onclick=()=>{
    const error=$("futurePlanError");error.textContent="";
    if(draft.levels.length>=80){error.textContent="매수 기준선은 80개까지 설정할 수 있습니다.";return;}
    const unit=$("newLevelUnit").value,days=unit?Number($("newLevelPeriod").value):0,name=unit?movingLineName(`${days}${unit}`):"";
    if(unit&&(!Number.isInteger(days)||!name)){error.textContent="이동평균 기간을 1~400 사이 정수로 입력하세요.";return;}
    if(name&&draft.levels.some(l=>futureLineName(l)===name)){error.textContent=`${movingLineText(name)}은 이미 있습니다.`;return;}
    const level={days,unit,price:0,confirmed:true,contracts:unit?3:1,tranches:[]};if(!unit)level.label=`추가 매수 ${draft.levels.filter(l=>!futureLineName(l)).length+1}`;
    const q=maValue(fe,name);if(q>0)level.price=priceRound(q,2);
    resizeTranches(level,level.contracts);draft.levels.push(level);draft.unit=unit;renderFuturePlanDialog();
  };
}
