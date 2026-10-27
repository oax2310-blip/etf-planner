// 달러선물 계산·화면(현재가·매수 표·요약). 분할매수 계획 창은 futures-plan.js, 신저점 손절 후 재매수 화면은 futures-rebuy.js(이 순서로 불러온다).
// 시세는 prices.js, 단계는 ma-ladder.js, 손절·재매수 계산은 rebuy.js.
// DOM 없는 계산 호출을 위해 함수 밖에서 화면을 건드리지 않는다.
const monthOk = m => /^\d{6}$/.test(m) && Number(m.slice(4)) >= 1 && Number(m.slice(4)) <= 12;
// 달러선물 가격은 소수 첫째 자리까지만 보인다(계산·저장은 원래 값). fmtPrice는 글자, futureShown은 입력칸 값(futures-plan.js·futures-rebuy.js 공용).
const fmtPrice = v => Number(v).toLocaleString("ko-KR",{maximumFractionDigits:1});
const futureShown = v => Number.isFinite(Number(v)) ? String(Math.round(Number(v)*10)/10) : "";
const nearestMonth = f => f.positions.filter(p=>Number(p.contracts)>0 && monthOk(String(p.month))).map(p=>String(p.month)).sort()[0] || "";
const sortPositions = f => f.positions.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
// 보유 직접 입력만 검증한다. 불러온 옛 기록은 변경하지 않고 잘못된 필드를 하나씩 고칠 수 있게 둔다.
function futurePositionEdit(f,index,key,raw){
  const p=Number.isInteger(index)&&index>=0?f.positions[index]:null;
  if(!p||!["month","contracts","settlementPrice"].includes(key))return {ok:false,error:"수정할 보유 항목을 다시 확인해 주세요."};
  const text=String(raw??"").trim(),value=key==="month"?text:Number(text);
  let error="";
  if(key==="month"){
    if(!monthOk(text))error="월물은 YYYYMM 형식의 6자리와 01~12월을 입력해 주세요.";
    else if(f.positions.some((other,i)=>i!==index&&String(other.month)===text))error="같은 월물이 이미 있습니다. 기존 월물의 계약 수를 수정해 주세요.";
  }else if(key==="contracts"){
    if(!text||!Number.isSafeInteger(value)||value<0)error="계약 수는 0 이상의 정수로 입력해 주세요.";
  }else if(!text||!Number.isFinite(value)||value<=0)error="단순평균가는 0보다 큰 숫자로 입력해 주세요.";
  if(error)return {ok:false,error};
  p[key]=value;return {ok:true};
}
// 삭제/복구는 보유 행만 바꾼다. 편입 매수·손절·재매수의 과거 월물과 누적 정산손익은 유지한다.
// 복구 가능 여부는 보유/체결 기준과 객체 참조로 확인한다. 메모·목표가·알림·수집 시세는 비교에서 뺀다.
function futurePositionFingerprint(f){
  const fill=x=>x?{contracts:x.contracts,price:x.price,targetPrice:x.targetPrice,execPrice:x.execPrice,month:x.month,settlementPrice:x.settlementPrice,legs:x.legs,manual:x.manual,done:x.done}:null;
  const completed=(f.levels||[]).flatMap((l,li)=>(l.tranches||[]).flatMap((t,ti)=>t.completed?[{li,ti,price:t.price,executionPrice:t.executionPrice,mergedMonth:t.mergedMonth,month:t.month}]:[]));
  const r=f.rebuy||{},buys=(r.stages||[]).flatMap((s,i)=>s.done?[{i,whole:fill(s)}]:s.buys?.some(Boolean)?[{i,buys:s.buys.map(fill)}]:[]);
  return JSON.stringify({positions:f.positions,baselinePnl:f.baselinePnl,completed,cuts:(r.cuts||[]).map(fill),buys,returns:(r.returns||[]).filter(x=>x?.done).map(fill)});
}
function deleteFuturePosition(f,index){
  if(!Number.isInteger(index)||index<0||!f.positions[index])return null;
  const position=JSON.parse(JSON.stringify(f.positions[index]));
  f.positions.splice(index,1);
  return {owner:f,index,position,after:futurePositionFingerprint(f)};
}
function canRestoreFuturePosition(f,record){return !!record&&!record.used&&record.owner===f&&record.after===futurePositionFingerprint(f);}
function restoreFuturePosition(f,record){
  if(!canRestoreFuturePosition(f,record))return false;
  f.positions.splice(record.index,0,JSON.parse(JSON.stringify(record.position)));record.used=true;return true;
}
// 화면에서만 마지막 삭제를 기억한다. 저장·동기화 필드는 추가하지 않고 새로고침하면 비운다.
let futurePositionUndo=null;
function nextFuturePositionMonth(f,now=new Date()){
  let month=nearestMonth(f)||`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}`;
  const used=new Set(f.positions.map(p=>String(p.month)));
  while(used.has(month)){const year=Number(month.slice(0,4)),m=Number(month.slice(4));month=m===12?`${year+1}01`:`${year}${String(m+1).padStart(2,"0")}`;}
  return month;
}
function futurePositionUndoNotice(f){
  if(!futurePositionUndo)return "";
  const can=canRestoreFuturePosition(f,futurePositionUndo),p=futurePositionUndo.position;
  return `<div class="future-position-undo" id="futurePositionUndoNotice" role="status"><p><b>${esc(p.month)} · ${esc(p.contracts)}계약</b> 보유를 삭제했습니다.</p><p class="hint">${can?"새로고침 전, 보유·체결 기록이 바뀌기 전까지 복구할 수 있습니다.":"보유·체결 기록이 변경되어 이 삭제는 실행 취소할 수 없습니다."}</p><div class="future-position-undo-actions"><button class="btn mini" id="undoFuturePosition" type="button"${can?"":" disabled"}>실행 취소</button><button class="btn mini ghost" id="dismissFuturePositionUndo" type="button">닫기</button></div></div>`;
}
function openFuturePositionDelete(index){
  const f=state.futures,p=f.positions[index];if(!p)return;
  const before=futurePositionFingerprint(f),month=String(p.month),r=f.rebuy||{};
  const buys=(f.levels||[]).reduce((n,l)=>n+(l.tranches||[]).filter(t=>t.completed&&String(t.mergedMonth)===month).length,0);
  const cuts=(r.cuts||[]).filter(c=>c&&(String(c.month)===month||c.legs?.some(l=>String(l.month)===month))).length;
  const rebuys=(r.stages||[]).reduce((n,s)=>n+(s.done?(String(s.month)===month?1:0):(s.buys||[]).filter(b=>b&&String(b.month)===month).length),0)+(r.returns||[]).filter(x=>x?.done&&String(x.month)===month).length;
  const links=[buys?`매수 ${buys}회`:"",cuts?`손절 ${cuts}회`:"",rebuys?`재매수 ${rebuys}회`:""].filter(Boolean).join(" · "),dialog=$("futurePositionDeleteDialog");
  dialog.innerHTML=`<div class="dialog-inner"><div class="dialog-head"><h2 id="futurePositionDeleteTitle">보유 월물을 삭제할까요?</h2></div><p class="sync-details"><b>${esc(month)} · ${esc(p.contracts)}계약</b>을 보유 수량·손익 계산에서 제외합니다.</p>${links?`<p class="warning">연결 기록: ${links}<br>완료 매수·손절·재매수 기록은 그대로 유지합니다.</p>`:""}<p class="hint">누적 정산손익은 바뀌지 않습니다. 삭제 후 실행 취소할 수 있지만 보유·체결 기록이 바뀌거나 새로고침하면 복구할 수 없습니다.</p><p class="future-position-error" id="futurePositionDeleteError" role="alert"></p><div class="dialog-foot"><button class="btn" id="cancelFuturePositionDelete" type="button" autofocus>취소</button><button class="btn danger" id="confirmFuturePositionDelete" type="button">보유 월물 삭제</button></div></div>`;
  $("cancelFuturePositionDelete").onclick=()=>dialog.close();
  $("confirmFuturePositionDelete").onclick=()=>{
    if(state.futures!==f||futurePositionFingerprint(f)!==before){$("futurePositionDeleteError").textContent="보유·체결 기록이 바뀌었습니다. 창을 닫고 다시 확인해 주세요.";$("confirmFuturePositionDelete").disabled=true;return;}
    futurePositionUndo=deleteFuturePosition(f,index);save();dialog.close();renderFutures();$("undoFuturePosition")?.focus();
  };
  dialog.showModal();
}
function bindFuturePositions(){
  $$("[data-pos]").forEach(el=>{
    const clear=()=>{el.removeAttribute("aria-invalid");el.setCustomValidity("");$(el.getAttribute("aria-describedby")).textContent="";};
    el.oninput=clear;
    el.onchange=()=>{
      const result=futurePositionEdit(state.futures,Number(el.dataset.pos),el.dataset.key,el.value);
      if(!result.ok){el.setAttribute("aria-invalid","true");el.setCustomValidity(result.error);$(el.getAttribute("aria-describedby")).textContent=result.error;return;}
      clear();save();renderFutures();
    };
  });
  $$("[data-remove-pos]").forEach(b=>b.onclick=()=>openFuturePositionDelete(Number(b.dataset.removePos)));
  if($("undoFuturePosition"))$("undoFuturePosition").onclick=()=>{if(!restoreFuturePosition(state.futures,futurePositionUndo)){renderFutures();return;}futurePositionUndo=null;save();renderFutures();$("futurePositions").open=true;$("addPosition").focus({preventScroll:true});};
  if($("dismissFuturePositionUndo"))$("dismissFuturePositionUndo").onclick=()=>{futurePositionUndo=null;renderFutures();};
}
// 같은 월물은 계약 수 가중평균으로 합침; settlementPrice는 화면 '단순평균가'. 선형 손익이라 따로 둘 때와 기대손익이 같다.
function addToPosition(f, month, qty, price){
  const pos=f.positions.find(p=>String(p.month)===month);
  if(pos){ const c=Number(pos.contracts)||0; pos.settlementPrice=(Number(pos.settlementPrice)*c+price*qty)/(c+qty); pos.contracts=c+qty; }
  else f.positions.push({month, contracts:qty, settlementPrice:price});
  sortPositions(f);
}
function removeFromPosition(f, month, qty, price){
  const i=f.positions.findIndex(p=>String(p.month)===month); if(i<0) return false;
  const pos=f.positions[i], c=Number(pos.contracts)||0; if(c<qty) return false;
  if(c===qty) f.positions.splice(i,1);
  else { pos.settlementPrice=(Number(pos.settlementPrice)*c-price*qty)/(c-qty); pos.contracts=c-qty; }
  return true;
}
// 현재 기대손익 = (price−단순평균가)×계약×1만 + baselinePnl(누적 정산손익: 직접 입력 + 손절 체크 실현손익, futures-rebuy.js) + 월물 밖 옛 매수.
// 편입 매수는 월물에 이미 포함; 미매수 유효 가격만 projected에 추가. price 기본은 목표 환율, invested는 보유 매수금액.
function futuresSummary(f, price=f.targetPrice){
  const tr=f.levels.flatMap((l,li)=>l.tranches.map((t,ti)=>({...t,price:f.buyPlan?.endLine?Number(t.price)||0:futureTranchePrice(f.levels,li,t,ti)}))), gainAt=p=>(price-Number(p))*contractSize;
  const posContracts=f.positions.reduce((s,p)=>s+(Number(p.contracts)||0),0);
  const existing=(Number(f.baselinePnl)||0)+f.positions.reduce((s,p)=>s+gainAt(p.settlementPrice)*(Number(p.contracts)||0),0);
  const legacy=tr.filter(t=>t.completed&&!t.mergedMonth); // 이 기능 이전에 체크된 계약: 보유 월물 밖에서 따로 계산
  const legacyGain=legacy.reduce((s,t)=>s+gainAt(t.executionPrice??t.price),0);
  const open=tr.filter(t=>!t.completed&&Number(t.price)>0), unpriced=tr.filter(t=>!t.completed&&!(Number(t.price)>0)).length;
  const remaining=open.reduce((s,t)=>s+gainAt(t.price),0), current=existing+legacyGain;
  const priced=tr.map(t=>Number(t.completed?(t.executionPrice??t.price):t.price)).filter(p=>p>0);
  const invested=(f.positions.reduce((s,p)=>s+Number(p.settlementPrice)*(Number(p.contracts)||0),0)+legacy.reduce((s,t)=>s+Number(t.executionPrice??t.price),0))*contractSize;
  return {existing,current,remaining,projected:current+remaining,posContracts,invested,legacyCount:legacy.length,openCount:open.length,unpriced,avg:priced.length?priced.reduce((a,b)=>a+b,0)/priced.length:null,total:tr.length};
}
// 계획 계약 수를 바꿔도 체크한 계약은 남긴다. 줄일 땐 뒤쪽 미매수 계약부터 뺀다.
function resizeTranches(l, qty){
  l.tranches.forEach((t,i)=>{if(t.completed)t.slot=futureTrancheSlot(l,t,i);});
  for(let i=l.tranches.length-1;i>=0&&l.tranches.length>qty;i--) if(!l.tranches[i].completed) l.tranches.splice(i,1);
  while(l.tranches.length<qty) l.tranches.push({price:l.price,completed:false,executionPrice:null});
  l.contracts=qty;
  rebalanceFutureTranches(l);
}
// 월물교체 장기 예상(표시용): 스프레드(원월물 − 근월물, 입력 없으면 −0.5원)가 음수면 매달 교체할 때마다 계약당 −스프레드 × 1만 달러 이득(계약 수·스프레드 고정).
// total = current + 누적 이득, investedExtra = 누적 이득 ÷ 투자금(계약 수 × 1만 달러 × 목표 환율, 투자금 양수·이득일 때만).
// futuresSummary 등 손익에 더하지 말 것(실제 교체 후 단순평균가를 고치면 이미 반영돼 이중 계산).
function rollSpreadOf(f){const v=f.rollSpread;return v===""||v==null||!Number.isFinite(Number(v))?-0.5:Number(v);}
function rollEstimate(f, contracts, current=0){
  const spread=rollSpreadOf(f), perContract=Math.round(-spread*contractSize), perRoll=perContract*contracts, invested=contracts*contractSize*(Number(f.targetPrice)||0);
  return {spread,perContract,perRoll,invested,years:[1,2,3].map(years=>{const gain=perRoll*12*years;return {years,rolls:12*years,gain,total:current+gain,investedExtra:invested>0&&gain>0?gain/invested:null};})};
}
// 환율 N원(lossPrice, 없거나 0 이하면 1,320원) 도달 시 손익: 기대수익과 같은 계산(보유 월물 + 누적 정산손익 + 월물 밖 매수)에 가격만 바꾼다.
// rate = 보유분 손익(누적 정산손익 제외) ÷ 보유 계약 매수금액(계좌 잔고 수익률 기준).
// years(표시용) = rollEstimate와 같은 가정의 교체 이득을 더한 총 손익, offset = 이득 ÷ 손실(손실이고 이득일 때만).
function lossPriceOf(f){const v=f.lossPrice;return v===""||v==null||!(Number(v)>0)?1320:Number(v);}
function lossCheck(f){
  const price=lossPriceOf(f), s=futuresSummary(f,price), contracts=s.posContracts+s.legacyCount, pnl=s.current, held=pnl-(Number(f.baselinePnl)||0);
  return {price,pnl,held,contracts,invested:s.invested,avg:contracts?s.invested/(contracts*contractSize):null,rate:s.invested>0?held/s.invested:null,
    years:rollEstimate(f,contracts,pnl).years.map(y=>({...y,offset:pnl<0&&y.gain>0?y.gain/-pnl:null}))};
}
// 매수 완료 접기는 화면 상태만 유지하며 저장·동기화하지 않는다.
let futureCompletedOpen=false;

// 상단 현재가 줄의 시세 시각(화면 전용, 시세 조회 없음). 시세 파일에는 체결 시각이 없어 파일 수집 시각(updatedAt)을 한국 시간으로 쓴다.
// 조회 실패(stale)면 기준일의 마지막 값, 기준일이 수집일보다 앞서면(휴장 등) 그날 종가로 표시한다.
// 실시간 시세가 아니므로 수집 후 FUTURE_QUOTE_DELAY_MIN분이 지나면 '지연'을 붙인다. old = 경고색(조회 실패·기준일 PRICE_STALE_DAYS일 초과).
const FUTURE_QUOTE_DELAY_MIN = 60;
function futureQuoteTime(fe, updatedAt, now=new Date()){
  const md=d=>`${Number(d.slice(5,7))}/${Number(d.slice(8,10))}`,at=Date.parse(updatedAt),old=!!fe.stale||priceOld(fe,now);
  const kst=at?new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(at):"";
  if(fe.stale)return {text:`조회 실패 · ${md(fe.asOf)} 기준 마지막 가격`,old,delayed:true};
  if(!kst||fe.asOf<kst.slice(0,10))return {text:`${md(fe.asOf)} ${kst?"종가 · 마지막 가격":"기준"}`,old,delayed:true};
  const min=Math.max(0,Math.floor((now-at)/6e4)),delayed=min>=FUTURE_QUOTE_DELAY_MIN,ago=min<1?"방금":min<60?`${min}분 전`:min<1440?`${Math.floor(min/60)}시간 전`:`${Math.floor(min/1440)}일 전`;
  return {text:`${md(kst)} ${kst.slice(11)} 수집 · ${ago}${delayed?" · 지연":""}`,old,delayed};
}
// 제목 아래 현재가: prices.js priceMonth 월물(보유 근월물, 손절로 보유를 모두 팔았으면 마지막 손절 월물 또는 그 다음 월물)의 달러선물 시세.
// 현물 환율(fx.USDKRW)은 쓰지 않는다. 월물 이름은 보유·계산 기준 줄에 있으므로 가격 줄에는 붙이지 않고 시각 툴팁에만 둔다.
function futureQuote(f,fe){
  const near=priceMonth(f,typeof priceData==="object"?priceData:null);
  if(!near)return tradeQuoteLine({round:"보유 월물을 입력하면 현재가를 표시합니다."});
  if(!fe||!(Number(fe.close)>0))return tradeQuoteLine({round:"시세 없음 · 시세를 불러오면 표시합니다."});
  const q=futureQuoteTime(fe,priceData?.updatedAt);
  return tradeQuoteLine({now:`${fmtPrice(fe.close)}원`,round:`<span class="future-quote-time${q.old?" old":""}" title="한국투자증권 달러선물 ${esc(near)} 시세(기준일 ${esc(fe.asOf)}). 예약·즉시 수집 때 받은 값으로 실시간 시세가 아닙니다.">${q.text}</span>`});
}

function futureBuyTable(f){
  const near=priceMonth(f,typeof priceData==="object"?priceData:null),target=decimal.format(f.targetPrice),rows=f.levels.flatMap((l,li)=>l.tranches.map((t,ti)=>({l,li,t,ti}))),completed=rows.filter(x=>x.t.completed).length,auto=f.buyPlan?futureAutoBuyPlan(f):null;
  const bell='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
  const allAlerts=typeof tradeAlertAllButtons==="function"?`<span class="trade-alert-actions future-buy-alert-actions"><span class="future-buy-bell" aria-hidden="true">${bell}</span><button class="btn mini ghost" type="button" data-level-alert-all="on" aria-label="분할매수 전체 알림 켜기">전체 ON</button><button class="btn mini ghost" type="button" data-level-alert-all="off" aria-label="분할매수 전체 알림 끄기">OFF</button></span>`:"";
  if(auto)rows.sort((a,b)=>Number(a.t.completed?(a.t.executionPrice??a.t.price):a.t.price)-Number(b.t.completed?(b.t.executionPrice??b.t.price):b.t.price)||a.li-b.li||a.ti-b.ti);
  const row=({l,li,t,ti})=>{
    const line=futureLineName(l),name=movingLineText(line||l.label||`추가 ${li+1}`),slot=futureTrancheSlot(l,t,ti),part=line?futureBuyPrices(f.levels,li).length>1?slot:0:ti,key=`${li}:${ti}`,price=Number(t.completed?(t.executionPrice??t.price):t.price),title=`${name} ${part+1}회차 ${ti+1}번째 계약`;
    const tag=`<span class="future-buy-name">${esc(name)}</span><span class="tr-no">${part+1}</span>`,priceText=price>0?`${fmtPrice(price)}원`:"—";
    const pricePart=t.completed||auto?`<strong>${priceText}<span class="future-buy-qty"> · 1계약</span></strong>`:`<label class="future-buy-price"><input data-tranche-price="${key}" type="number" min="0" step="any" inputmode="decimal" value="${futureShown(price)}" aria-label="${esc(title)} 매수가">원<span class="future-buy-qty"> · 1계약</span></label>`;
    const monthPart=t.completed?t.mergedMonth?`<span class="future-buy-month-state" title="${esc(t.mergedMonth)} 보유 월물에 편입">${esc(t.mergedMonth)}</span>`:'<span class="future-buy-month-state outside" title="보유 월물 밖에서 따로 계산하는 예전 매수">월물 밖</span>':`<label class="future-buy-month"><input data-tranche-month="${key}" list="posMonths" inputmode="numeric" maxlength="6" placeholder="YYYYMM" title="합칠 보유 월물" value="${esc(t.month||near)}" aria-label="${esc(title)} 편입 월물"></label>`;
    const alert=!t.completed&&typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeFutureTrancheEnabled(f,l,t),`data-tranche-alert="${key}"`,`${title} 매수`):"";
    return `<div class="future-buy-row${t.completed?" done":""}"><label class="check"><input type="checkbox" data-tranche-check="${key}"${t.completed?" checked":f.buyPlan?.endLine&&(auto?.error||auto?.waiting)?" disabled":""} aria-label="${esc(title)} 매수 완료"><b class="tr-name" title="${esc(title)}">${tag}</b></label><div class="future-buy-condition">${pricePart}<small>기대손익 ${price>0?money((f.targetPrice-price)*contractSize):"—"}</small></div>${monthPart}<div class="future-buy-alert">${alert}</div></div>`;
  };
  const count=rows.length,planned=Number(auto?.config?.contracts)||Number(f.buyPlan?.contracts)||count,done=planned>0&&completed===planned,summary=planned?`${done?"매수 완료":auto?.waiting?"추가 매수 대기":completed?"매수 진행":"매수 대기"} · ${completed}/${planned}계약`:"계획 미입력";
  const autoInfo=auto?.config?`<p class="purchase-ladder-line"><b>자동 배분</b> ${esc(movingLineText(auto.config.startLine))} → ${auto.config.endLine?`${esc(movingLineText(auto.config.endLine))} · `:""}${fmtPrice(auto.config.endPrice)}원 · 총 ${planned}계약</p><div class="future-auto-breakdown">${futureAutoBreakdown(f)}</div>${auto.waiting?`<p class="hint future-auto-hint">${esc(auto.waiting)}</p>`:""}`:"";
  return `<section class="card future-buy-card" id="futureBuyCard"><div class="purchase-head"><div class="title-row"><h2>분할매수</h2><button class="btn icon-btn" id="editFuturePlan" type="button" aria-label="달러선물 분할매수 계획 수정" title="계획 수정">${PENCIL}</button></div>${autoInfo}<div class="purchase-progress"><span class="purchase-status${done?" done":""}">${summary}</span>${allAlerts}</div></div>
    ${f.buyPlan?.endLine&&auto?.error?`<p class="warning" role="alert">${esc(auto.error)}</p>`:""}<div class="future-buy-table${futureCompletedOpen?"":" hide-completed"}" id="futureBuyTable"><div class="future-buy-table-head"><span>기준선 · 회차</span><span>매수가 · 계약</span><span>월물</span><span class="future-buy-bell" role="img" aria-label="알림">${bell}</span></div>${completed?`<button class="completed-fold-bar" id="toggleCompletedFutureBuys" type="button" aria-expanded="${futureCompletedOpen}" aria-controls="futureBuyRows"><span>매수 완료 <b>${completed}계약</b></span><span class="completed-fold-action" data-completed-action>${futureCompletedOpen?"접기":"펼치기"}</span></button>`:""}<div id="futureBuyRows">${rows.map(row).join("")}</div>${done?'<div class="completed-fold-empty">모든 회차의 매수가 완료되었습니다.</div>':""}${!count?`<div class="empty"><h3>${auto?"매수 기준 대기":"매수 계획이 없습니다"}</h3><p>${auto?"시작선 시세가 채워지면 회차를 자동 배분합니다.":"계획 수정에서 시작·종료 기준과 총 계약 수를 입력하세요."}</p><button class="btn primary" type="button" id="startFuturePlan">계획 ${auto?"수정":"입력"}</button></div>`:""}</div>${planned?`<div class="future-buy-foot">목표 환율 ${target}원 기준 · 남은 ${planned-completed}계약</div>`:""}</section>`;
}

// 월물교체는 계좌를 보고 보유 월물·단순평균가·누적 정산손익을 직접 수정(교체 실행 기능 없음).
// rollSpread·lossPrice는 입력 때만 저장, 비우면 delete. 현재 근월물 시세는 화면 전용.
// 누적 정산손익·스프레드는 음수가 흔해 '-'와 '.'이 있는 키패드(text + inputmode=numeric)를 쓴다. 삼성 키보드의 type=number 키패드에는 '-' 키가 없다.
function renderFutures(){
  const f=state.futures;refreshFutureBuyPrices(f);const s=futuresSummary(f),target=decimal.format(f.targetPrice),near=nearestMonth(f),months=[...new Set(f.positions.map(p=>String(p.month)).filter(monthOk))].sort();
  const open=id=>$(id)?.open?' open':"",positionOpen=open("futurePositions");
  // 마우스 PC에서만 접기 없는 섹션을 쓰고, 터치 기기의 기존 표시·펼침 상태는 유지한다(theme.js와 같은 기기 구분).
  const desktop=typeof matchMedia==="function"&&matchMedia("(hover:hover) and (pointer:fine)").matches;
  const estimate=(id,title,body)=>desktop?`<section class="future-estimate" id="${id}"><h3>${title}</h3>${body}</section>`:`<details class="future-estimate" id="${id}"${open(id)}><summary>${title}</summary>${body}</details>`;
  const roll=rollEstimate(f,s.posContracts+s.legacyCount,s.current),fe=futuresEntry(priceData,f),loss=lossCheck(f),pct=v=>`${v>0?"+":""}${(v*100).toFixed(2)}%`,offsetText=o=>o==null?"":` · ${o>=1?"손실 전부 상쇄":`${Math.round(o*100)}% 상쇄`}`,extraText=y=>y.investedExtra==null?"":` · +${(y.investedExtra*100).toFixed(1)}%`;
  const lossCard=`<div class="metric"><label class="loss-head">환율<input id="flossPrice" type="number" step="1" min="0" value="${shown(loss.price)}" title="손익을 확인할 환율 (원)">원 도달 시 손익</label><strong class="${loss.pnl<0?"neg":""}">${money(loss.pnl)}</strong><small>${loss.contracts?`보유 ${loss.contracts}계약 · 평균 ${decimal.format(loss.avg)}원 대비 <b class="loss-rate${loss.rate<0?" neg":""}">${loss.rate==null?"—":pct(loss.rate)}</b>`:"보유 계약 없음"}</small>${estimate("futureLossRollDetails","월물교체로 상쇄 · 총 손익",`<div class="roll-est"><div class="roll-est-head"><span>스프레드 ${shown(roll.spread)}원 기준</span></div><div class="roll-est-years">${loss.years.map(y=>`<div><small>${y.years}년 후${offsetText(y.offset)}</small><strong>${money(y.total)}</strong></div>`).join("")}</div></div>`)}</div>`;
  const rollEst=estimate("futureRollDetails","월물교체 장기 예상",`<div class="roll-est"><div class="roll-est-head"><label>스프레드<input id="frollSpread" type="text" inputmode="numeric" autocomplete="off" value="${shown(roll.spread)}" title="원월물 − 근월물 (원)">원</label></div><div class="roll-est-years">${roll.years.map(y=>`<div><small>${y.years}년 후${extraText(y)}</small><strong>${money(y.total)}</strong></div>`).join("")}</div></div>`);
  const positions=`<details class="card future-position-settings" id="futurePositions"${positionOpen}><summary><strong>보유·계산 기준</strong><span>${s.posContracts}계약${near?` · 근월물 ${esc(near)}`:""}</span></summary><div class="panel future-panel"><div class="inline-fields"><label class="field"><span>목표 환율</span><input id="ftarget" type="number" step="0.1" value="${esc(f.targetPrice)}"></label><label class="field"><span>누적 정산손익 (원)</span><input id="fpnl" type="text" inputmode="numeric" autocomplete="off" value="${esc(f.baselinePnl)}"></label></div><div class="future-panel-head" style="margin-top:18px"><h2>보유 월물</h2><button class="btn mini" id="addPosition" type="button">＋ 월물 추가</button></div><div class="positions">${f.positions.map((p,i)=>`<div class="position-row"><label>월물<input data-pos="${i}" data-key="month" value="${esc(p.month)}" inputmode="numeric" maxlength="6" required aria-describedby="futurePositionError${i}month"></label><label>계약 수<input data-pos="${i}" data-key="contracts" type="number" min="0" step="1" inputmode="numeric" required value="${esc(p.contracts)}" aria-describedby="futurePositionError${i}contracts"></label><label>단순평균가<input data-pos="${i}" data-key="settlementPrice" type="number" min="0" step="any" inputmode="decimal" required value="${futureShown(p.settlementPrice)}" aria-describedby="futurePositionError${i}settlementPrice"></label><button class="remove" data-remove-pos="${i}" type="button" aria-label="${esc(p.month)} 보유 월물 삭제">삭제</button>${["month","contracts","settlementPrice"].map(key=>`<p class="future-position-error" id="futurePositionError${i}${key}" role="alert"></p>`).join("")}</div>`).join("")}</div></div></details>`;
  $("futuresView").innerHTML=`<div class="heading"><div><div class="eyebrow">USD/KRW FUTURES · 로컬 저장</div><h1>달러선물 매매 계획</h1>${futureQuote(f,fe)}</div></div><div class="metrics card future-overview"><div class="metric"><label>환율 ${target}원 기대수익</label><strong>${money(s.current)}</strong><small>보유 ${s.posContracts}계약 + 누적 정산손익${s.legacyCount?` + 월물 밖 매수 ${s.legacyCount}계약`:""}</small>${rollEst}</div>${lossCard}<div class="metric"><label>계획 전부 체결 가정</label><strong>${money(s.projected)}</strong><small>현재 + 미매수 계획 ${s.openCount}계약${s.unpriced?` (가격 미입력 ${s.unpriced}계약 제외)`:""} · 계획 평균 ${s.avg?decimal.format(s.avg):"—"}원</small></div></div>${futurePositionUndoNotice(f)}${positions}<div id="futureRebuyPanel" class="rebuy"></div>${s.legacyCount?`<div class="warning">월물 밖 매수 ${s.legacyCount}계약이 있습니다. 완료 회차를 펼쳐 체크를 풀고 월물을 지정한 뒤 다시 체크하면 보유 월물에 편입합니다. 이미 보유 월물에 직접 입력한 계약은 중복되지 않았는지 확인하세요.</div>`:""}${fe?priceWarning(fe,`달러선물 ${esc(near)}`):""}<datalist id="posMonths">${months.map(m=>`<option value="${m}">`).join("")}</datalist>${futureBuyTable(f)}<section class="card panel memo"><div class="memo-head"><h2>달러선물 메모</h2><span class="memo-count">${memoCount(f.note)}</span><button class="btn mini" id="fSave" type="button">저장</button></div><textarea id="fNote" maxlength="4000" aria-label="달러선물 메모">${esc(f.note||"")}</textarea></section>`;
  if(typeof bindTradeFuturesAlerts==="function")bindTradeFuturesAlerts(f);
  $("editFuturePlan").onclick=openFuturePlanDialog;if($("startFuturePlan"))$("startFuturePlan").onclick=openFuturePlanDialog;
  const completedToggle=$("toggleCompletedFutureBuys");if(completedToggle)completedToggle.onclick=()=>{futureCompletedOpen=!futureCompletedOpen;$("futureBuyTable").classList.toggle("hide-completed",!futureCompletedOpen);completedToggle.setAttribute("aria-expanded",String(futureCompletedOpen));completedToggle.querySelector("[data-completed-action]").textContent=futureCompletedOpen?"접기":"펼치기";};
  onEdit("#ftarget",v=>{f.targetPrice=Number(v)||f.targetPrice;},renderFutures);onEdit("#fpnl",v=>{v=v.trim().replace(/,/g,"");if(v!==""&&!Number.isFinite(Number(v)))return false;f.baselinePnl=Number(v)||0;},renderFutures);
  onEdit("#flossPrice",v=>{v=v.trim();if(v===""||!(Number(v)>0))delete f.lossPrice;else f.lossPrice=Number(v);},renderFutures);
  onEdit("#frollSpread",v=>{v=v.trim();if(v===""||!Number.isFinite(Number(v)))delete f.rollSpread;else f.rollSpread=Number(v);},renderFutures);$("fSave").onclick=()=>{f.note=$("fNote").value;save();renderFutures();};$("fNote").oninput=e=>f.note=e.target.value;
  $("addPosition").onclick=()=>{f.positions.push({month:nextFuturePositionMonth(f),contracts:0,settlementPrice:1});save();renderFutures();};
  bindFuturePositions();
  onEdit("[data-tranche-price]",(v,el)=>{const price=Number(v);if(!Number.isFinite(price)||price<0)return false;const [li,ti]=el.dataset.tranchePrice.split(":").map(Number),t=f.levels[li].tranches[ti];t.price=price;if(futureLineName(f.levels[li]))t.priceOverride=t.price;},renderFutures);
  const monthOf=key=>(document.querySelector(`[data-tranche-month="${key}"]`)?.value||"").trim();
  onEdit("[data-tranche-month]",(v,el)=>{const [li,ti]=el.dataset.trancheMonth.split(":").map(Number);f.levels[li].tranches[ti].month=v.trim();});
  $$("[data-tranche-check]").forEach(input=>input.onchange=()=>{const key=input.dataset.trancheCheck,[li,ti]=key.split(":").map(Number),t=f.levels[li].tranches[ti];
    if(input.checked&&f.buyPlan?.endLine){const plan=futureAutoBuyPlan(f);if(t.completed||plan.error||plan.waiting||plan.completed>=plan.config.contracts){input.checked=!!t.completed;if(plan.error)alert(plan.error);return;}}
    if(input.checked){const month=monthOf(key),price=Number(t.price);
      if(!monthOk(month)){alert("합칠 월물을 YYYYMM 형식으로 입력하세요. 예: 202611");input.checked=false;return;}
      if(!(price>0)){alert("매수가를 먼저 입력하세요.");input.checked=false;return;}
      addToPosition(f,month,1,price);t.completed=true;t.executionPrice=price;t.mergedMonth=month;t.month=month;}
    else if(t.mergedMonth){const execP=Number(t.executionPrice??t.price),has=f.positions.some(p=>String(p.month)===t.mergedMonth&&Number(p.contracts)>=1);
      if(has){if(!confirm(`${t.mergedMonth} 보유분에서 1계약(체결가 ${fmtPrice(execP)})을 빼고 단순평균가를 되돌릴까요?\n그 사이 이 월물의 단순평균가를 직접 고쳤다면, 되돌린 뒤 값을 확인하세요.`)){input.checked=true;return;}removeFromPosition(f,t.mergedMonth,1,execP);}
      else if(!confirm(`보유 월물에 ${t.mergedMonth}이(가) 없습니다(교체·삭제된 것으로 보입니다).\n체크만 해제하고 보유 월물은 직접 고칠까요?`)){input.checked=true;return;}
      t.completed=false;t.executionPrice=null;delete t.mergedMonth;}
    else{t.completed=false;t.executionPrice=null;}
    save();renderFutures();});
  renderFutureRebuy(f);
}
