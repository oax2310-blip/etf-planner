// 달러선물 신저점 손절 후 재매수 화면. 계산은 rebuy.js(futureRebuySummary 등), 달러선물 화면은 futures.js.
// 손절·재매수 계산은 rebuy.js에 둔다(비공개 시세 수집 작업도 같은 함수를 사용).
// 이 계획의 체크는 보유 월물과 정산손익을 바꾸지 않는다. 실제 주문 후 계좌 기준으로 직접 수정한다.
// 손절은 특수한 상황이라 실행(첫 체크) 전에는 한 줄로 접어 둔다. 펼친 상태는 화면 상태라 저장·동기화하지 않는다.
let futureRebuyExpanded=false;
function renderFutureRebuy(f){
  const r=futureRebuyOf(f),s=futureRebuySummary(f),fe=futuresEntry(priceData,f),locked=futureRebuyLocked(f),cur=Number(r.currentPrice)||0,pctText=shown(s.sellPct),opt=v=>Number(v)>0?shown(v):"",px=v=>Number(v)>0?`${fmtPrice(v)}원`:"—";
  const cutPx=v=>Number(v)>0?`${decimal.format(v)}원`:"—";
  const nextCut=s.cuts.find(c=>!c.done&&c.qty>0),nextTr=s.tranches.find(x=>!x.done&&x.amount>0),auto=fe?'<small class="auto-tag">(자동)</small>':"";
  if(!locked&&!futureRebuyExpanded){
    const low=Number(r.lowPrice)||0,dueCut=!!nextCut&&cur>0&&cur<=nextCut.price,broken=s.ready&&cur>0&&cur<low;
    const line=!s.goal&&s.hold>0?"손절 목표 0계약 · 펼쳐서 손절 비중을 확인하세요":!s.ready?"기준 미입력 · 펼쳐서 신저점·하단·이탈 전 계약 수를 넣으세요"
      :dueCut?`<b>손절 시점</b> · ${nextCut.k}회 ${cutPx(nextCut.price)} 이하 ${nextCut.qty}계약`
      :broken?`<b>신저점 이탈</b> · 다음 손절 ${nextCut?`${nextCut.k}회 ${cutPx(nextCut.price)} 이하`:"없음"}`
      :`실행 전 · 신저점 ${px(low)} · 하단 ${px(r.floorPrice)} · 최대 ${s.goal}계약 손절`;
    const text=line+(s.ready&&cur>0?` · 현재 ${px(cur)}`:"");
    $("futureRebuyPanel").innerHTML=`<section class="future-rebuy folded"><div class="card rebuy-fold${dueCut||broken?" due":""}"><strong>신저점 손절<span class="hide-mobile"> 후 재매수</span></strong><span class="fold-summary" title="${esc(text.replace(/<[^>]+>/g,""))}">${text}</span><button class="btn mini ghost" type="button" id="frToggle">펼치기</button></div></section>`;
    $("frToggle").onclick=()=>{futureRebuyExpanded=true;renderFutures();};
    return;
  }
  // 재매수는 ETF 재매수 화면과 같은 규칙: 평균 손절 환율 이하 단계가 첫 단계부터 이어지는 만큼 나누고, 단계마다 다음 단계 환율까지 3회로 나눠 산다.
  const px2=v=>px(Math.round(v*100)/100),first=esc(s.stages[0]?.name||"첫 단계"),firstPx=Number(s.stages[0]?.price)||0,firstTr=s.tranches[0],lastTr=s.tranches.at(-1);
  const trName=x=>`<span class="tr-name">${esc(s.stages[x.i].name)}${s.stages[x.i].done?"":`<span class="tr-no">${x.t+1}</span>`}</span>`,trText=x=>`${esc(s.stages[x.i].name)}${s.stages[x.i].done?"":` ${x.t+1}회차`}`,trAt=x=>x.price>0?` · ${x.est?"≈":""}${px2(x.price)} 이상`:"";
  const splitText=!s.sellAvg||!firstTr?"":`${s.tranches.length>1?`${s.tranches.length}분할 (${trName(firstTr)}~${trName(lastTr)}`:`한 번에 (${trName(firstTr)}`}, ${!firstPx?`${first} 기준가 없음`:firstPx<=s.sellAvg?`평균 손절 환율 ${px2(s.sellAvg)} 이하 회차`:`평균 손절 환율 ${px2(s.sellAvg)}보다 ${first} 기준가가 높음`})`;
  const next=!s.ready?s.sellPct===0?"손절 비중이 0%라 분할 손절을 계획하지 않습니다.":"신저점 환율·손절 하단·이탈 전 계약 수·손절 비중을 확인하세요. 손절 목표가 1계약 이상이어야 회차가 계산됩니다."
    :s.started&&!s.rest?`재매수 완료 · 손절 ${s.sold}계약 → 재매수 ${s.rebought}계약`
    :s.started?`다음 재매수 <b>${nextTr?`${trName(nextTr)}${trAt(nextTr)}에서 ${nextTr.amount}계약`:"없음 · 체결 수량을 확인하세요"}</b> · 남은 ${s.rest}계약 · 남은 손절은 멈춤`
    :`다음 손절 <b>${nextCut?`${nextCut.k}회 · ${cutPx(nextCut.price)} 이하에서 ${nextCut.qty}계약`:"없음 (손절 목표 완료)"}</b>${s.sold?` · ${nextTr?`${first} 반등 신호가 나오면 재매수 시작 <b>${nextTr.amount}계약</b>`:"반등 신호에 재매수 시작"} · ${splitText}`:""}`;
  const notify=(kind,key,label,done,lead)=>typeof futureRebuyAlertEnabled==="function"?tradeAlertToggle(futureRebuyAlertEnabled(f,kind,key),`data-frebuy-alert="${kind}"${key==null?"":` data-alert-key="${esc(key)}"`}`,label,done,lead):"";
  const all=kind=>typeof futureRebuyAllButtons==="function"?futureRebuyAllButtons(kind):"";
  const cutRows=(s.started?s.cuts.filter(c=>c.done):s.cuts).map(c=>{
    const due=!c.done&&cur>0&&cur<=c.price;
    return `<div class="sale-row ${c.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-fcut="${c.k-1}" ${c.done?"checked":""} ${!c.done&&(s.started||!c.qty)?"disabled":""}>${c.k}회</label><div class="stage-price"><span class="price">${cutPx(c.price)}</span>${notify("cuts",c.k-1,`${c.k}회 손절`,c.done)}</div><div class="shares">${c.done?`<span class="exec-fields"><input class="qty" data-fcut-qty="${c.k-1}" type="number" min="1" step="1" value="${c.qty}" aria-label="${c.k}회 손절 계약 수">계약 <input data-fcut-price="${c.k-1}" type="number" min="0" step="any" value="${opt(c.execPrice)}" aria-label="${c.k}회 손절 체결 환율">원</span>`:`${c.qty}계약<div class="sub">계획상 남은 ${c.left}계약</div>`}</div><div class="status ${c.done?"done":due?"due":""}">${c.done?"손절 완료":due?"손절 시점":"대기"}</div></div>`;
  }).join("")||'<div class="empty">기준을 입력하면 손절 회차가 계산됩니다.</div>';
  // 분할 범위 단계(또는 산 단계)는 회차마다 한 줄(첫 줄에 단계 기준 환율·알림), 나머지 단계는 기준 환율만 한 줄.
  const buyRows=s.stages.map((x,i)=>{
    const own=s.tranches.filter(y=>y.i===i),rows=[...own,...s.skipped.filter(y=>y.i===i).map(y=>({...y,skip:true}))].sort((a,b)=>a.t-b.t),price=Number(x.price)||0,nextName=esc(s.stages[i+1]?.name||"");
    const priceInput=`<span class="exec-fields"><input data-fbuy-price="${i}" type="number" min="0" step="any" value="${opt(price)}" placeholder="${s.est[i]?`≈${fmtPrice(Math.round(s.est[i]*100)/100)}`:"기준가"}" aria-label="${esc(x.name)} 기준 환율">원${autoKey(x.name)?auto:""}</span>${notify("buys",`stage:${i}`,`${x.name} 재매수`,own.length>0&&own.every(y=>y.done))}`;
    if(!own.length)return `<div class="sale-row"><label class="check"><input type="checkbox" disabled>${esc(x.name)}</label><div class="stage-price">${priceInput}</div><div class="shares">${s.sold?"배분 없음":"손절 후 계산"}</div><div class="status">대기</div></div>`;
    return rows.map((y,k)=>{
      const due=!y.skip&&!y.done&&y.amount>0&&cur>0&&y.price>0&&cur>=y.price,nextUp=y===nextTr,where=y.step?`${esc(x.name)}→${nextName} ${y.t}/${TRANCHES}`:y.t?"단계 환율과 같음":"";
      const pricePart=k===0?priceInput:`<span class="price">${y.price>0?`${y.est?"≈":""}${px2(y.price)}`:"—"}</span><span class="krw">${where}</span>`;
      if(y.skip)return `<div class="sale-row"><label class="check"><input type="checkbox" disabled>${trName(y)}</label><div class="stage-price">${pricePart}</div><div class="shares">—<div class="sub">${y.est?"추정 환율이라 제외":s.sellAvg&&y.price>s.sellAvg?"평균 손절 환율 위":"계획 밖"}</div></div><div class="status">안 삼</div></div>`;
      const shares=y.done?`<span class="exec-fields"><input class="qty" data-fbuy-qty="${i}:${y.t}" type="number" min="1" step="1" value="${y.qty}" aria-label="${trText(y)} 재매수 계약 수">계약 <input data-fbuy-exec="${i}:${y.t}" type="number" min="0" step="any" value="${opt(y.execPrice)}" aria-label="${trText(y)} 재매수 체결 환율">원</span>`:!s.sold?"손절 후 계산":y.amount?`${y.amount}계약`:"배분 없음";
      return `<div class="sale-row ${y.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-fbuy="${i}:${y.t}" ${y.done?"checked":""} ${!y.done&&!y.amount?"disabled":""}>${trName(y)}</label><div class="stage-price">${pricePart}</div><div class="shares">${shares}</div><div class="status ${y.done?"done":due||nextUp?"due":""}">${y.done?"재매수 완료":due?"재매수 시점":nextUp?"다음 신호":"대기"}</div></div>`;
    }).join("");
  }).join("")||'<div class="empty">재매수 단계가 없습니다.</div>';
  $("futureRebuyPanel").innerHTML=`<section class="future-rebuy"><div class="section-heading"><h2>신저점 손절 후 재매수</h2><span>지정한 하단까지 ${pctText}% 손절 · 최소 ${s.hold-s.goal}계약 유지</span>${locked?"":'<button class="btn mini ghost" type="button" id="frToggle">접기</button>'}</div>
    <div class="metrics card"><div class="metric"><label>${pctText}% 손절 목표 · 이탈 전 ${s.hold}계약</label><strong>${s.goal}계약</strong><small>계약 수는 소수점 이하 내림 · 최소 ${s.hold-s.goal}계약 유지</small></div><div class="metric"><label>손절 완료</label><strong>${s.sold} / ${s.goal}계약</strong><small>${s.doneCuts}회 · 계획상 현재 보유 ${s.held}계약</small></div><div class="metric"><label>재매수 완료</label><strong>${s.rebought} / ${s.sold}계약</strong><small>재매수 잔여 ${s.rest}계약 · 판 계약 수만 복원</small></div></div>
    <div class="control-grid"><section class="card panel"><div class="panel-head"><h2>손절 기준</h2>${notify("breakdown",null,"신저점 손절 시작",s.started,"신저점 이탈")}</div><p>신저점부터 정한 하단까지 환율을 고르게 나눕니다. 설정한 비중만큼 손절하고, 하단 아래의 손절 회차는 만들지 않습니다.</p><div class="inline-fields"><label class="field"><span>신저점 환율 (원)</span><input id="frLow" type="number" min="0" step="any" value="${opt(r.lowPrice)}" ${locked?"disabled":""}></label><label class="field"><span>손절 하단 (원)</span><input id="frFloor" type="number" min="0" step="any" value="${opt(r.floorPrice)}" ${locked?"disabled":""}></label><label class="field"><span>이탈 전 계약 수</span><input id="frHold" type="number" min="0" step="1" value="${s.hold||""}" ${locked?"disabled":""}></label><label class="field"><span>손절 비중 (%)</span><input id="frSellPct" type="number" min="0" max="100" step="any" inputmode="decimal" value="${pctText}" ${s.started?"disabled":""}></label><label class="field"><span>분할 횟수</span><input id="frSteps" type="number" min="1" max="60" step="1" value="${futureRebuyQty(r.steps)||10}" ${locked?"disabled":""}></label></div><p class="hint future-rebuy-hint">${s.started?"재매수 시작 후 손절 기준은 체크 기록 초기화 후 바꿀 수 있습니다.":locked?"손절 비중은 이미 손절한 계약 수 이상으로 바꿀 수 있습니다. 다른 기준은 체크 기록 초기화 후 변경하세요.":"손절 비중은 0~100%로 입력합니다(기본 50%). 손절 계약 수보다 많은 분할 횟수는 자동으로 줄입니다."}${s.cuts.length===1?" 한 번만 손절하는 계획은 하단에서 실행합니다.":""}</p></section>
    <section class="card panel"><h2>재매수 기준</h2><p>시선(60분봉)·일선·주선·월선 반등 단계로 판 계약을 되삽니다. 단계마다 다음 단계 환율까지 3번으로 나눈 회차 중 평균 손절 환율(실제 체결 환율) 이하인 회차에 나눠 되삽니다(없으면 첫 단계 1회차에서 한 번에). 재매수를 시작하면 남은 손절은 멈춥니다.</p><div class="inline-fields"><label class="field"><span>현재 환율 (원)${auto}</span><input id="frCurrent" type="number" min="0" step="any" value="${opt(r.currentPrice)}" placeholder="도달 여부 확인용"></label></div><p class="hint future-rebuy-hint">${fe?`보유 근월물 ${esc(priceMonth(f))} 시세로 현재 환율·시선·일선·주선·월선 기준가를 채웁니다. N선(60분봉)이 아직 비어 있으면 직접 입력하세요.`:"현재 환율과 단계 기준가를 직접 넣을 수 있습니다. 동기화 시 보유 근월물 시세로 현재 환율·시선·일선·주선·월선 기준가를 채웁니다."}</p></section></div>
    <div class="card progress-line">${next}</div>${s.overSold||s.overBought?'<div class="warning">체결 기록이 손절 목표 또는 판 계약 수를 넘습니다. 실제 체결 수량을 확인하세요.</div>':""}
    <details class="future-rebuy-details" open><summary>1. 분할 손절 <span>${s.doneCuts}회 · ${s.sold}계약 완료</span></summary><div class="section-heading">${all("cuts")}</div><section class="card table-card"><div class="table-head"><span>회차</span><span>손절 환율</span><span>계약 수 · 실제 체결 환율</span><span>상태</span></div>${cutRows}${s.started?'<div class="stop-note">재매수를 시작해 남은 손절 회차는 멈췄습니다.</div>':""}</section></details>
    <details class="future-rebuy-details" ${s.sold?"open":""}><summary>2. 반등 단계별 재매수 <span>잔여 ${s.rest}계약 · ${s.doneTranches} / ${s.tranches.length}회</span></summary><div class="section-heading">${all("buys")}<button class="btn mini ghost" id="frTimeframes" type="button">시·일·주·월선 추가</button></div><section class="card table-card stage-table"><div class="table-head"><span>단계 · 회차</span><span>기준 환율 · 회차 환율</span><span>재매수 계약 수 · 체결 환율</span><span>상태</span></div>${buyRows}</section></details>
    <div class="reset-row"><button class="btn ghost mini" id="frReset" type="button" ${locked?"":"disabled"}>체크 기록 초기화</button></div><p class="footnote">체크는 이 계획의 기록용입니다. 실제 주문은 증권사에서 실행하고 기존 보유 월물·누적 정산손익은 계좌 기준으로 직접 수정하세요. 체크 후 실제 체결 환율·계약 수를 맞추세요. 재매수 시점은 현재 환율을 넣어야 표시됩니다.</p></section>`;
  if(typeof bindFutureRebuyAlerts==="function")bindFutureRebuyAlerts(f);
  $("frTimeframes").onclick=()=>{const r=editFutureRebuy(f),stages=completeMovingStages(r.stages);if(stages.length>80){alert("재매수 단계는 80개까지 설정할 수 있습니다.");return;}r.stages=stages;if(priceData)fillPrices({futures:f},priceData);save();renderFutures();};

  if(!locked)$("frToggle").onclick=()=>{futureRebuyExpanded=false;renderFutures();};
  for(const [field,key] of [["frLow","lowPrice"],["frFloor","floorPrice"],["frHold","contracts"],["frSellPct","sellPct"],["frSteps","steps"],["frCurrent","currentPrice"]])onEdit("#"+field,v=>{
    if(setFutureRebuyField(f,key,v)===false){alert(key==="sellPct"?"손절 비중은 0~100%로 입력하세요. 목표가 이미 손절한 계약 수보다 작아질 수 없으며, 재매수 시작 후에는 변경할 수 없습니다.":"손절 하단은 신저점보다 낮아야 하며, 계약 수·분할 횟수는 정수로 입력하세요. 체결 후 손절 기준은 초기화해야 바꿀 수 있습니다.");return false;}
    if(key!=="currentPrice"&&priceData)fillPrices({futures:f},priceData);
  },renderFutures);
  $$("[data-fcut]").forEach(input=>input.onchange=()=>{if(setFutureCutDone(f,Number(input.dataset.fcut),input.checked)===false)alert("손절 목표를 넘거나 재매수 기록과 맞지 않습니다. 재매수 시작 후에는 추가 손절을 기록할 수 없습니다.");else save();renderFutures();});
  onEdit("[data-fcut-qty]",(v,el)=>setFutureCutQty(f,Number(el.dataset.fcutQty),v),renderFutures);
  onEdit("[data-fcut-price]",(v,el)=>{const n=Number(v),rec=editFutureRebuy(f).cuts[Number(el.dataset.fcutPrice)];if(!rec||!Number.isFinite(n)||n<=0)return false;rec.price=n;},renderFutures);
  const trKey=v=>String(v).split(":").map(Number);
  $$("[data-fbuy]").forEach(input=>input.onchange=()=>{if(setFutureBuyDone(f,...trKey(input.dataset.fbuy),input.checked)===false)alert("손절한 계약과 배분된 재매수 수량·환율을 먼저 확인하세요. 판 계약 수를 넘겨 재매수할 수 없습니다.");else save();renderFutures();});
  onEdit("[data-fbuy-qty]",(v,el)=>setFutureBuyQty(f,...trKey(el.dataset.fbuyQty),v),renderFutures);
  onEdit("[data-fbuy-price]",(v,el)=>{const n=v.trim()===""?0:Number(v);if(!Number.isFinite(n)||n<0)return false;editFutureRebuy(f).stages[Number(el.dataset.fbuyPrice)].price=n;},renderFutures);
  onEdit("[data-fbuy-exec]",(v,el)=>setFutureBuyPrice(f,...trKey(el.dataset.fbuyExec),v),renderFutures);
  $("frReset").onclick=()=>{if(!confirm("달러선물 손절·재매수 체크 기록을 모두 지울까요?\n신저점·하단·이탈 전 계약 수·손절 비중·단계 기준가는 남깁니다."))return;const r=editFutureRebuy(f);r.cuts=[];r.stages.forEach(x=>{Object.assign(x,{done:false,contracts:null,execPrice:null});delete x.buys;});delete r.planned;save();renderFutures();};
}
