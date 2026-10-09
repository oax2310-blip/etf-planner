// 달러선물 계산·화면. 시세는 prices.js, 단계는 ma-ladder.js, 손절·재매수 계산은 rebuy.js.
// DOM 없는 계산 호출을 위해 함수 밖에서 화면을 건드리지 않는다.
const monthOk = m => /^\d{6}$/.test(m) && Number(m.slice(4)) >= 1 && Number(m.slice(4)) <= 12;
const fmtPrice = v => Number(v).toLocaleString("ko-KR",{maximumFractionDigits:4});
const nearestMonth = f => f.positions.filter(p=>Number(p.contracts)>0 && monthOk(String(p.month))).map(p=>String(p.month)).sort()[0] || "";
const sortPositions = f => f.positions.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
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
// 현재 기대손익 = (price−단순평균가)×계약×1만 + baselinePnl(직접 입력 누적 정산손익) + 월물 밖 옛 매수.
// 편입 매수는 월물에 이미 포함; 미매수 유효 가격만 projected에 추가. price 기본은 목표 환율, invested는 보유 매수금액.
function futuresSummary(f, price=f.targetPrice){
  const tr=f.levels.flatMap((l,li)=>l.tranches.map((t,ti)=>({...t,price:futureTranchePrice(f.levels,li,t,ti)}))), gainAt=p=>(price-Number(p))*contractSize;
  const posContracts=f.positions.reduce((s,p)=>s+(Number(p.contracts)||0),0);
  const existing=f.baselinePnl+f.positions.reduce((s,p)=>s+gainAt(p.settlementPrice)*(Number(p.contracts)||0),0);
  const legacy=tr.filter(t=>t.completed&&!t.mergedMonth); // 이 기능 이전에 체크된 계약: 보유 월물 밖에서 따로 계산
  const legacyGain=legacy.reduce((s,t)=>s+gainAt(t.executionPrice??t.price),0);
  const open=tr.filter(t=>!t.completed&&Number(t.price)>0), unpriced=tr.filter(t=>!t.completed&&!(Number(t.price)>0)).length;
  const remaining=open.reduce((s,t)=>s+gainAt(t.price),0), current=existing+legacyGain;
  const priced=tr.map(t=>Number(t.completed?(t.executionPrice??t.price):t.price)).filter(p=>p>0);
  const invested=(f.positions.reduce((s,p)=>s+Number(p.settlementPrice)*(Number(p.contracts)||0),0)+legacy.reduce((s,t)=>s+Number(t.executionPrice??t.price),0))*contractSize;
  return {existing,current,remaining,projected:current+remaining,posContracts,invested,legacyCount:legacy.length,openCount:open.length,unpriced,avg:priced.length?priced.reduce((a,b)=>a+b,0)/priced.length:null,total:tr.length};
}
const openLevels = new Set(); // 매수 완료 구간 중 펼쳐 둔 것(화면 상태라 저장·동기화하지 않음)
const levelDone = l => Number(l.contracts)>0 && l.tranches.length>=Number(l.contracts) && l.tranches.every(t=>t.completed);
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
// 월물교체는 계좌를 보고 보유 월물·단순평균가·누적 정산손익을 직접 수정(교체 실행 기능 없음).
// rollSpread·lossPrice는 입력 때만 저장, 비우면 delete. 현재 근월물 시세는 화면 전용.
function renderFutures(){
  const f=state.futures;refreshFutureBuyPrices(f);const s=futuresSummary(f),tr=f.levels.flatMap(l=>l.tranches),completed=tr.filter(t=>t.completed).length,total=f.levels.reduce((a,l)=>a+l.contracts,0),target=decimal.format(f.targetPrice),near=nearestMonth(f),months=[...new Set(f.positions.map(p=>String(p.month)).filter(monthOk))].sort();
  const roll=rollEstimate(f,s.posContracts+s.legacyCount,s.current), fe=futuresEntry(priceData,f); // 보유 근월물 시세: N일선 구간 기준가를 채우고(prices.js) 현재가·기준일은 구간 제목 옆에
  const priced=l=>fe&&futureLineName(l)&&f.auto?.[futureLineName(l)]===Number(l.price); // 시세로 채운 뒤 그대로인 구간 기준가
  const loss=lossCheck(f), pct=v=>`${v>0?"+":""}${(v*100).toFixed(2)}%`, offsetText=o=>o==null?"":` · ${o>=1?"손실 전부 상쇄":`${Math.round(o*100)}% 상쇄`}`, extraText=y=>y.investedExtra==null?"":` · +${(y.investedExtra*100).toFixed(1)}%`;
  const lossCard=`<div class="card future-metric"><label class="loss-head">환율<input id="flossPrice" type="number" step="1" min="0" value="${shown(loss.price)}" title="손익을 확인할 환율 (원)">원 도달 시 손익</label><strong class="${loss.pnl<0?"neg":""}">${money(loss.pnl)}</strong><small>${loss.contracts?`보유 ${loss.contracts}계약 · 평균 ${decimal.format(loss.avg)}원 대비 <b class="loss-rate">${loss.rate==null?"—":pct(loss.rate)}</b>`:"보유 계약 없음"}${Number(f.baselinePnl)?`${loss.contracts?` · 보유분 ${money(loss.held)}`:""} + 누적 정산손익 ${money(f.baselinePnl)}`:""}</small><div class="roll-est"><div class="roll-est-head"><span>월물교체로 상쇄 · 총 손익</span><span>스프레드 ${shown(roll.spread)}원 기준</span></div><div class="roll-est-years">${loss.years.map(y=>`<div><small>${y.years}년 후${offsetText(y.offset)}</small><strong>${money(y.total)}</strong></div>`).join("")}</div></div></div>`;
  const rollEst=`<div class="roll-est"><div class="roll-est-head"><span>월물교체 장기 예상 · 총 기대수익</span><label>스프레드<input id="frollSpread" type="number" step="0.1" value="${shown(roll.spread)}" title="원월물 − 근월물 (원)">원</label></div><div class="roll-est-years">${roll.years.map(y=>`<div><small>${y.years}년 후${extraText(y)}</small><strong>${money(y.total)}</strong></div>`).join("")}</div></div>`;
  const trancheRow=(l,li,t,ti)=>{const slot=futureTrancheSlot(l,t,ti),name=futureLineName(l),part=futureBuyPrices(f.levels,li).length>1?slot:0;const merged=t.completed&&t.mergedMonth, execP=Number(t.executionPrice??t.price), p=t.completed?execP:Number(t.price), key=`${li}:${ti}`, monthInput=`<input class="month" data-tranche-month="${key}" list="posMonths" inputmode="numeric" placeholder="YYYYMM" title="합칠 보유 월물" value="${esc(t.month||near)}">`;
    const act=!t.completed?`${monthInput}<label class="tranche-check"><input type="checkbox" data-tranche-check="${key}">미매수</label>`:merged?`<span class="merged-tag">${esc(t.mergedMonth)}에 편입</span><label class="tranche-check"><input type="checkbox" data-tranche-check="${key}" checked>매수 반영</label>`:`<span class="merged-tag outside" title="보유 월물에 합치지 않고 따로 계산하는 예전 매수">월물 밖</span><label class="tranche-check"><input type="checkbox" data-tranche-check="${key}" checked>매수 반영</label>`;
    return `<div class="tranche ${t.completed?"completed":""}"><div class="tranche-name"><strong>${name?`${esc(name)} ${part?`${part+1}차 매수`:"도달 매수"}`:esc(l.label||`추가 ${li+1}`)}</strong><small>${ti+1}계약<span class="hide-mobile"> · ${t.completed?"체결가":"매수 예정가"}</span></small></div><label>${t.completed?"체결가":"매수가"}<input data-tranche-price="${key}" type="number" step="0.1" value="${shown(p)}" ${t.completed?"disabled":""}></label><div class="gain"><small>${t.completed?`${target}원 기준 손익${merged?`<span class="hide-mobile"> · 보유 월물에 포함</span>`:""}`:`${target}원 도달 시`}</small><strong>${p>0?money((f.targetPrice-p)*contractSize):"—"}</strong></div><div class="tranche-act">${act}</div></div>`;};
  $("futuresView").innerHTML=`<div class="heading"><div><div class="eyebrow">USD/KRW FUTURES · 로컬 저장</div><h1>달러선물 매매 계획</h1></div><button class="btn" id="fSave">변경 저장</button></div><div id="futureRebuyPanel" class="rebuy"></div><div class="futures-metrics"><div class="card future-metric"><label>환율 ${target}원 기대수익</label><strong>${money(s.current)}</strong><small>보유 월물 ${s.posContracts}계약 + 누적 정산손익${s.legacyCount?` + 월물 밖 매수 ${s.legacyCount}계약`:""}</small>${rollEst}</div>${lossCard}<div class="card future-metric"><label>계획 전부 체결 가정</label><strong>${money(s.projected)}</strong><small>현재 + 미매수 계획 ${s.openCount}계약${s.unpriced?` (가격 미입력 ${s.unpriced}계약 제외)`:""} · 계획 평균 ${s.avg?decimal.format(s.avg):"—"}원</small></div></div>${s.legacyCount?`<div class="warning">예전에 체크한 매수 ${s.legacyCount}계약이 아직 보유 월물 밖에서 따로 계산되고 있습니다. 보유 월물에 합치려면 해당 줄의 체크를 풀고 월물을 고른 뒤 다시 체크하세요. 이미 보유 월물에 직접 넣은 계약이라면 이중 계산이니 보유 월물 쪽을 확인하세요.</div>`:""}<div class="card panel future-panel"><div class="inline-fields"><label class="field"><span>목표 환율</span><input id="ftarget" type="number" step="0.1" value="${f.targetPrice}"></label><label class="field"><span>누적 정산손익 (원)</span><input id="fpnl" type="number" step="1000" value="${f.baselinePnl}"></label></div><div class="future-panel-head" style="margin-top:18px"><h2>기존 보유 월물</h2><button class="btn" id="addPosition">＋ 월물 추가</button></div><div class="positions">${f.positions.map((p,i)=>`<div class="position-row"><label>월물<input data-pos="${i}" data-key="month" value="${esc(p.month)}" inputmode="numeric"></label><label>계약 수<input data-pos="${i}" data-key="contracts" type="number" min="0" value="${p.contracts}"></label><label>단순평균가<input data-pos="${i}" data-key="settlementPrice" type="number" step="0.1" value="${shown(p.settlementPrice)}"></label><button class="remove" data-remove-pos="${i}" title="삭제">삭제</button></div>`).join("")}</div></div><div class="future-panel-head"><div><h2>분할매수</h2></div>${typeof tradeAlertAllButtons==="function"?tradeAlertAllButtons("data-level-alert-all"):""}<div class="future-line-add"><input id="newLevelPeriod" type="number" min="1" max="400" step="1" value="200" aria-label="추가할 이동평균 기간"><select id="newLevelUnit" aria-label="추가할 이동평균 시간축"><option value="선">시선 · 60분봉</option><option value="일선" selected>일선</option><option value="주선">주선</option><option value="개월선">월선</option><option value="">직접 입력</option></select><button class="btn" id="addLevel">＋ 매수 구간 추가</button></div></div>${fe?priceWarning(fe,`달러선물 ${esc(near)}`):""}<datalist id="posMonths">${months.map(m=>`<option value="${m}">`).join("")}</datalist><div id="levels">${f.levels.map((l,li)=>{const name=esc(futureLineName(l)||l.label||`추가 매수 ${li+1}`),done=levelDone(l),prices=futureBuyPrices(f.levels,li),next=nextFutureLine(f.levels,li);if(done&&!openLevels.has(li)){const prices=l.tranches.map(t=>Number(t.executionPrice??t.price)),avg=prices.reduce((a,b)=>a+b,0)/prices.length,where=[...new Set(l.tranches.map(t=>t.mergedMonth?`${t.mergedMonth} 편입`:"월물 밖"))].join(" · ");return `<section class="level level-folded"><div class="level-fold"><div class="level-title"><strong>${name}</strong><small>매수 완료</small></div><span class="fold-summary">${l.contracts}계약 · 평균 체결가 ${fmtPrice(avg)} · ${esc(where)}</span><button class="btn mini ghost" type="button" data-level-toggle="${li}" aria-expanded="false">펼치기</button></div></section>`;}return `<section class="level"><div class="level-head${done?" has-toggle":""}"><div class="level-title"><strong>${name}</strong><small>${priced(l)?`${esc(near)} 이동평균`:l.confirmed?"차트 확인":"기준가 입력"}</small>${typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeLevelEnabled(f,l),`data-level-alert="${li}"`,`${futureLineName(l)||`추가 ${li+1}`} 매수`,done):""}</div>${done?`<button class="btn mini ghost" type="button" data-level-toggle="${li}" aria-expanded="true">접기</button>`:""}<label>기준가<input data-level-price="${li}" type="number" step="0.1" value="${l.price}"></label><label class="qty">계획 계약 수<input data-level-qty="${li}" type="number" min="0" max="100" value="${l.contracts}"></label><span class="level-progress">${l.tranches.filter(t=>t.completed).length} / ${l.contracts} 완료</span></div>${futureLineName(l)?`<p class="small-note">${prices.map((p,t)=>`${t?`${t+1}차`:"도달 매수"} ${fmtPrice(p)}원`).join(" · ")}${next?` → ${esc(next.name)} 도달 매수 ${Number(next.level.price)>0?`${fmtPrice(next.level.price)}원`:"(기준가 입력 필요)"}`:""}${prices.length===1&&next?" · 상승 구간이 확인되면 2·3차 가격이 채워집니다.":""}${prices.length>1&&l.contracts<3?" · 세 회차 모두 매수하려면 계획 계약 수를 3개 이상으로 설정하세요.":""}</p>`:""}<div class="tranches">${l.tranches.map((t,ti)=>trancheRow(l,li,t,ti)).join("")}</div></section>`;}).join("")}</div><div class="total-bar"><strong>매수 반영 ${completed}계약 · 미매수 계획 ${total-completed}계약</strong><span>${target}원 기대수익 ${money(s.current)}</span></div><section class="card panel memo"><div class="memo-head"><h2>달러선물 메모</h2><span>${memoCount(f.note)}</span></div><textarea id="fNote" maxlength="4000" style="min-height:110px">${esc(f.note||"")}</textarea></section>`;
  if(typeof bindTradeFuturesAlerts==="function")bindTradeFuturesAlerts(f);
  onEdit("#ftarget",v=>{f.targetPrice=Number(v)||f.targetPrice;},renderFutures);onEdit("#fpnl",v=>{f.baselinePnl=Number(v)||0;},renderFutures);
  onEdit("#flossPrice",v=>{v=v.trim();if(v===""||!(Number(v)>0))delete f.lossPrice;else f.lossPrice=Number(v);},renderFutures);
  onEdit("#frollSpread",v=>{v=v.trim();if(v===""||!Number.isFinite(Number(v)))delete f.rollSpread;else f.rollSpread=Number(v);},renderFutures);$("fSave").onclick=()=>{f.note=$("fNote").value;save();renderFutures();};$("fNote").oninput=e=>f.note=e.target.value;
  $("addPosition").onclick=()=>{f.positions.push({month:"202612",contracts:0,settlementPrice:1});save();renderFutures();};$$("[data-remove-pos]").forEach(b=>b.onclick=()=>{f.positions.splice(Number(b.dataset.removePos),1);save();renderFutures();});
  onEdit("[data-pos]",(v,el)=>{const p=f.positions[Number(el.dataset.pos)],key=el.dataset.key;p[key]=key==="month"?v:Number(v)||0;},renderFutures);
  onEdit("[data-level-price]",(v,el)=>{const l=f.levels[Number(el.dataset.levelPrice)];const price=Number(v);if(!Number.isFinite(price)||price<0)return false;l.price=price;refreshFutureBuyPrices(f,[futureLineName(l)]);if(!futureLineName(l))l.tranches.forEach(t=>{if(!t.completed)t.price=price;});},renderFutures);
  $$("[data-level-qty]").forEach(input=>input.onchange=()=>{const li=Number(input.dataset.levelQty),l=f.levels[li],qty=Math.max(0,Math.min(100,Math.floor(Number(input.value)||0)));if(l.tranches.some(t=>t.completed)&&qty<l.tranches.filter(t=>t.completed).length){alert("매수 완료한 계약 수보다 작게 줄일 수 없습니다.");return;}resizeTranches(l,qty);refreshFutureBuyPrices(f);save();renderFutures();});
  onEdit("[data-tranche-price]",(v,el)=>{const [li,ti]=el.dataset.tranchePrice.split(":").map(Number);const t=f.levels[li].tranches[ti];t.price=Number(v)||0;if(futureLineName(f.levels[li]))t.priceOverride=t.price;},renderFutures);
  const monthOf=key=>(document.querySelector(`[data-tranche-month="${key}"]`)?.value||"").trim();
  onEdit("[data-tranche-month]",(v,el)=>{const [li,ti]=el.dataset.trancheMonth.split(":").map(Number);f.levels[li].tranches[ti].month=v.trim();});
  $$("[data-tranche-check]").forEach(input=>input.onchange=()=>{const key=input.dataset.trancheCheck,[li,ti]=key.split(":").map(Number),t=f.levels[li].tranches[ti];
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
  $$("[data-level-toggle]").forEach(b=>b.onclick=()=>{const li=Number(b.dataset.levelToggle);if(openLevels.has(li))openLevels.delete(li);else openLevels.add(li);renderFutures();});
  $("addLevel").onclick=()=>{
    if(f.levels.length>=80){alert("매수 구간은 80개까지 설정할 수 있습니다.");return;}
    const unit=$("newLevelUnit").value,days=unit?Number($("newLevelPeriod").value):0,name=unit?movingLineName(`${days}${unit}`):"";
    if(unit&&(!Number.isInteger(days)||!name)){alert("이동평균 기간을 1~400 사이 정수로 입력하세요.");return;}
    if(name&&f.levels.some(l=>futureLineName(l)===name)){alert(`${name}은 이미 있습니다.`);return;}
    const level={days,unit,price:0,confirmed:true,contracts:unit?3:1,tranches:[]};if(!unit)level.label=`추가 매수 ${f.levels.filter(l=>!futureLineName(l)).length+1}`;
    resizeTranches(level,level.contracts);f.levels.push(level);
    const q=maValue(fe,name);if(q>0)level.price=priceRound(q,2);
    refreshFutureBuyPrices(f);save();renderFutures();
  };
  renderFutureRebuy(f);
}
// 손절·재매수 계산은 rebuy.js에 둔다(비공개 시세 수집 작업도 같은 함수를 사용).
// 이 계획의 체크는 보유 월물과 정산손익을 바꾸지 않는다. 실제 주문 후 계좌 기준으로 직접 수정한다.
// 손절은 특수한 상황이라 실행(첫 체크) 전에는 한 줄로 접어 둔다. 펼친 상태는 화면 상태라 저장·동기화하지 않는다.
let futureRebuyExpanded=false;
function renderFutureRebuy(f){
  const r=futureRebuyOf(f),s=futureRebuySummary(f),fe=futuresEntry(priceData,f),locked=futureRebuyLocked(f),cur=Number(r.currentPrice)||0,pctText=shown(s.sellPct),opt=v=>Number(v)>0?shown(v):"",px=v=>Number(v)>0?`${fmtPrice(v)}원`:"—";
  const nextCut=s.cuts.find(c=>!c.done&&c.qty>0),nextTr=s.tranches.find(x=>!x.done&&x.amount>0),auto=fe?'<small class="auto-tag">(자동)</small>':"";
  if(!locked&&!futureRebuyExpanded){
    const low=Number(r.lowPrice)||0,dueCut=!!nextCut&&cur>0&&cur<=nextCut.price,broken=s.ready&&cur>0&&cur<low;
    const line=!s.goal&&s.hold>0?"손절 목표 0계약 · 펼쳐서 손절 비중을 확인하세요":!s.ready?"기준 미입력 · 펼쳐서 신저점·하단·이탈 전 계약 수를 넣으세요"
      :dueCut?`<b>손절 시점</b> · ${nextCut.k}회 ${px(nextCut.price)} 이하 ${nextCut.qty}계약`
      :broken?`<b>신저점 이탈</b> · 다음 손절 ${nextCut?`${nextCut.k}회 ${px(nextCut.price)} 이하`:"없음"}`
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
    :`다음 손절 <b>${nextCut?`${nextCut.k}회 · ${px(nextCut.price)} 이하에서 ${nextCut.qty}계약`:"없음 (손절 목표 완료)"}</b>${s.sold?` · ${nextTr?`${first} 반등 신호가 나오면 재매수 시작 <b>${nextTr.amount}계약</b>`:"반등 신호에 재매수 시작"} · ${splitText}`:""}`;
  const notify=(kind,key,label,done,lead)=>typeof futureRebuyAlertEnabled==="function"?tradeAlertToggle(futureRebuyAlertEnabled(f,kind,key),`data-frebuy-alert="${kind}"${key==null?"":` data-alert-key="${esc(key)}"`}`,label,done,lead):"";
  const all=kind=>typeof futureRebuyAllButtons==="function"?futureRebuyAllButtons(kind):"";
  const cutRows=(s.started?s.cuts.filter(c=>c.done):s.cuts).map(c=>{
    const due=!c.done&&cur>0&&cur<=c.price;
    return `<div class="sale-row ${c.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-fcut="${c.k-1}" ${c.done?"checked":""} ${!c.done&&(s.started||!c.qty)?"disabled":""}>${c.k}회</label><div class="stage-price"><span class="price">${px(c.price)}</span>${notify("cuts",c.k-1,`${c.k}회 손절`,c.done)}</div><div class="shares">${c.done?`<span class="exec-fields"><input class="qty" data-fcut-qty="${c.k-1}" type="number" min="1" step="1" value="${c.qty}" aria-label="${c.k}회 손절 계약 수">계약 <input data-fcut-price="${c.k-1}" type="number" min="0" step="any" value="${opt(c.execPrice)}" aria-label="${c.k}회 손절 체결 환율">원</span>`:`${c.qty}계약<div class="sub">계획상 남은 ${c.left}계약</div>`}</div><div class="status ${c.done?"done":due?"due":""}">${c.done?"손절 완료":due?"손절 시점":"대기"}</div></div>`;
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
