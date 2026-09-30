// 달러선물: 보유 월물·구간 매수 계산(futuresSummary·rollEstimate·lossCheck)과 화면
const monthOk = m => /^\d{6}$/.test(m) && Number(m.slice(4)) >= 1 && Number(m.slice(4)) <= 12;
const fmtPrice = v => Number(v).toLocaleString("ko-KR",{maximumFractionDigits:4});
const nearestMonth = f => f.positions.filter(p=>Number(p.contracts)>0 && monthOk(String(p.month))).map(p=>String(p.month)).sort()[0] || "";
const sortPositions = f => f.positions.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
// 같은 월물이면 가중평균으로 합친다. (목표−가격)×계약 합계가 선형이라 따로 둘 때와 기대손익이 같다.
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
// price를 주면 목표 환율 대신 그 환율에서 계산한다(손익 확인 카드). invested = 보유 계약 매수금액(단순평균가·체결가 × 1만 달러).
function futuresSummary(f, price=f.targetPrice){
  const tr=f.levels.flatMap(l=>l.tranches), gainAt=p=>(price-Number(p))*contractSize;
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
  for(let i=l.tranches.length-1;i>=0&&l.tranches.length>qty;i--) if(!l.tranches[i].completed) l.tranches.splice(i,1);
  while(l.tranches.length<qty) l.tranches.push({price:l.price,completed:false,executionPrice:null});
  l.contracts=qty;
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
function renderFutures(){
  const f=state.futures,s=futuresSummary(f),tr=f.levels.flatMap(l=>l.tranches),completed=tr.filter(t=>t.completed).length,total=f.levels.reduce((a,l)=>a+l.contracts,0),target=decimal.format(f.targetPrice),near=nearestMonth(f),months=[...new Set(f.positions.map(p=>String(p.month)).filter(monthOk))].sort();
  const roll=rollEstimate(f,s.posContracts+s.legacyCount,s.current), fe=futuresEntry(priceData,f); // 보유 근월물 시세: N일선 구간 기준가를 채우고(prices.js) 현재가·기준일은 구간 제목 옆에
  const priced=l=>fe&&l.days>0&&f.auto?.[`${l.days}일선`]===Number(l.price); // 시세로 채운 뒤 그대로인 구간 기준가
  const loss=lossCheck(f), pct=v=>`${v>0?"+":""}${(v*100).toFixed(2)}%`, offsetText=o=>o==null?"":` · ${o>=1?"손실 전부 상쇄":`${Math.round(o*100)}% 상쇄`}`, extraText=y=>y.investedExtra==null?"":` · +${(y.investedExtra*100).toFixed(1)}%`;
  const lossCard=`<div class="card future-metric"><label class="loss-head">환율<input id="flossPrice" type="number" step="1" min="0" value="${shown(loss.price)}" title="손익을 확인할 환율 (원)">원 도달 시 손익</label><strong class="${loss.pnl<0?"neg":""}">${money(loss.pnl)}</strong><small>${loss.contracts?`보유 ${loss.contracts}계약 · 평균 ${decimal.format(loss.avg)}원 대비 <b class="loss-rate">${loss.rate==null?"—":pct(loss.rate)}</b>`:"보유 계약 없음"}${Number(f.baselinePnl)?`${loss.contracts?` · 보유분 ${money(loss.held)}`:""} + 누적 정산손익 ${money(f.baselinePnl)}`:""}</small><div class="roll-est"><div class="roll-est-head"><span>월물교체로 상쇄 · 총 손익</span><span>스프레드 ${shown(roll.spread)}원 기준</span></div><div class="roll-est-years">${loss.years.map(y=>`<div><small>${y.years}년 후${offsetText(y.offset)}</small><strong>${money(y.total)}</strong></div>`).join("")}</div></div></div>`;
  const rollEst=`<div class="roll-est"><div class="roll-est-head"><span>월물교체 장기 예상 · 총 기대수익</span><label>스프레드<input id="frollSpread" type="number" step="0.1" value="${shown(roll.spread)}" title="원월물 − 근월물 (원)">원</label></div><div class="roll-est-years">${roll.years.map(y=>`<div><small>${y.years}년 후${extraText(y)}</small><strong>${money(y.total)}</strong></div>`).join("")}</div></div>`;
  const trancheRow=(l,li,t,ti)=>{const merged=t.completed&&t.mergedMonth, execP=Number(t.executionPrice??t.price), p=t.completed?execP:Number(t.price), key=`${li}:${ti}`, monthInput=`<input class="month" data-tranche-month="${key}" list="posMonths" inputmode="numeric" placeholder="YYYYMM" title="합칠 보유 월물" value="${esc(t.month||near)}">`;
    const act=!t.completed?`${monthInput}<label class="tranche-check"><input type="checkbox" data-tranche-check="${key}">미매수</label>`:merged?`<span class="merged-tag">${esc(t.mergedMonth)}에 편입</span><label class="tranche-check"><input type="checkbox" data-tranche-check="${key}" checked>매수 반영</label>`:`<span class="merged-tag outside" title="보유 월물에 합치지 않고 따로 계산하는 예전 매수">월물 밖</span><label class="tranche-check"><input type="checkbox" data-tranche-check="${key}" checked>매수 반영</label>`;
    return `<div class="tranche ${t.completed?"completed":""}"><div class="tranche-name"><strong>${l.days?`${l.days}일선`:`추가 ${li-futuresDays.length+1}-${ti+1}`}</strong><small>${ti+1}계약<span class="hide-mobile"> · ${t.completed?"체결가":"매수 예정가"}</span></small></div><label>${t.completed?"체결가":"매수가"}<input data-tranche-price="${key}" type="number" step="0.1" value="${shown(p)}" ${t.completed?"disabled":""}></label><div class="gain"><small>${t.completed?`${target}원 기준 손익${merged?`<span class="hide-mobile"> · 보유 월물에 포함</span>`:""}`:`${target}원 도달 시`}</small><strong>${p>0?money((f.targetPrice-p)*contractSize):"—"}</strong></div><div class="tranche-act">${act}</div></div>`;};
  $("futuresView").innerHTML=`<div class="heading"><div><div class="eyebrow">USD/KRW FUTURES · 로컬 저장</div><h1>달러선물 추가매수 체크</h1><p>이동평균선별 계획 계약을 입력하고, 실제 매수한 계약만 체크하세요. 체크하면 고른 보유 월물에 합쳐집니다.</p></div><button class="btn" id="fSave">변경 저장</button></div><div class="futures-metrics"><div class="card future-metric"><label>환율 ${target}원 기대수익</label><strong>${money(s.current)}</strong><small>보유 월물 ${s.posContracts}계약 + 누적 정산손익${s.legacyCount?` + 월물 밖 매수 ${s.legacyCount}계약`:""}</small>${rollEst}</div>${lossCard}<div class="card future-metric"><label>계획 전부 체결 가정</label><strong>${money(s.projected)}</strong><small>현재 + 미매수 계획 ${s.openCount}계약${s.unpriced?` (가격 미입력 ${s.unpriced}계약 제외)`:""} · 계획 평균 ${s.avg?decimal.format(s.avg):"—"}원</small></div></div>${s.legacyCount?`<div class="warning">예전에 체크한 매수 ${s.legacyCount}계약이 아직 보유 월물 밖에서 따로 계산되고 있습니다. 보유 월물에 합치려면 해당 줄의 체크를 풀고 월물을 고른 뒤 다시 체크하세요. 이미 보유 월물에 직접 넣은 계약이라면 이중 계산이니 보유 월물 쪽을 확인하세요.</div>`:""}<div class="card panel future-panel"><div class="future-panel-head"><div><h2>계산 기준</h2><p>월물교체·손절 등은 계좌를 보고 보유 월물과 누적 정산손익을 직접 수정하세요.</p></div></div><div class="inline-fields"><label class="field"><span>목표 환율</span><input id="ftarget" type="number" step="0.1" value="${f.targetPrice}"></label><label class="field"><span>누적 정산손익 (원)</span><input id="fpnl" type="number" step="1000" value="${f.baselinePnl}"></label></div><div class="future-panel-head" style="margin-top:18px"><h2>기존 보유 월물</h2><button class="btn" id="addPosition">＋ 월물 추가</button></div><div class="positions">${f.positions.map((p,i)=>`<div class="position-row"><label>월물<input data-pos="${i}" data-key="month" value="${esc(p.month)}" inputmode="numeric"></label><label>계약 수<input data-pos="${i}" data-key="contracts" type="number" min="0" value="${p.contracts}"></label><label>단순평균가<input data-pos="${i}" data-key="settlementPrice" type="number" step="0.1" value="${shown(p.settlementPrice)}"></label><button class="remove" data-remove-pos="${i}" title="삭제">삭제</button></div>`).join("")}</div><p class="help">계약 1개 손익은 (목표 환율 − 매수가) × 1만 달러(계약 단위)로 계산합니다. 환율이 1원 움직이면 1계약당 1만 원입니다. 같은 월물에 합친 계약은 단순평균가를 계약 수로 가중평균해 다시 계산합니다. 수수료·롤오버 비용은 별도입니다.</p></div><div class="future-panel-head"><div><h2>이동평균선별 매수</h2><p class="small-note">${fe?`${esc(near)} 현재 ${fmtPrice(fe.close)}원 ${priceStamp(fe)} · `:""}총 ${total}계약 · 체크 완료 ${completed}계약. 매수가를 실제 체결가로 맞춘 뒤, 합칠 월물을 고르고 체크하세요.</p></div><button class="btn" id="addLevel">＋ 매수 구간 추가</button></div>${fe?priceWarning(fe,`달러선물 ${esc(near)}`):""}<datalist id="posMonths">${months.map(m=>`<option value="${m}">`).join("")}</datalist><div id="levels">${f.levels.map((l,li)=>{const name=l.days?`${l.days}일선`:esc(l.label||`추가 매수 ${li-futuresDays.length+1}`),done=levelDone(l);if(done&&!openLevels.has(li)){const prices=l.tranches.map(t=>Number(t.executionPrice??t.price)),avg=prices.reduce((a,b)=>a+b,0)/prices.length,where=[...new Set(l.tranches.map(t=>t.mergedMonth?`${t.mergedMonth} 편입`:"월물 밖"))].join(" · ");return `<section class="level level-folded"><div class="level-fold"><div class="level-title"><strong>${name}</strong><small>매수 완료</small></div><span class="fold-summary">${l.contracts}계약 · 평균 체결가 ${fmtPrice(avg)} · ${esc(where)}</span><button class="btn mini ghost" type="button" data-level-toggle="${li}">펼치기</button></div></section>`;}return `<section class="level"><div class="level-head"><div class="level-title"><strong>${name}</strong><small>${priced(l)?`${esc(near)} 이동평균`:l.confirmed?"차트 확인":"기준가 입력"}</small></div><label>기준가<input data-level-price="${li}" type="number" step="0.1" value="${l.price}"></label><label class="qty">계획 계약 수<input data-level-qty="${li}" type="number" min="0" max="100" value="${l.contracts}"></label><span class="level-progress">${l.tranches.filter(t=>t.completed).length} / ${l.contracts} 완료${done?` <button class="btn mini ghost" type="button" data-level-toggle="${li}">접기</button>`:""}</span></div><div class="tranches">${l.tranches.map((t,ti)=>trancheRow(l,li,t,ti)).join("")}</div></section>`;}).join("")}</div><div class="total-bar"><strong>매수 반영 ${completed}계약 · 미매수 계획 ${total-completed}계약</strong><span>${target}원 기대수익 ${money(s.current)}</span></div><section class="card panel memo"><div class="memo-head"><h2>달러선물 메모</h2><span>${memoCount(f.note)}</span></div><textarea id="fNote" maxlength="4000" style="min-height:110px">${esc(f.note||"")}</textarea></section>`;
  onEdit("#ftarget",v=>{f.targetPrice=Number(v)||f.targetPrice;},renderFutures);onEdit("#fpnl",v=>{f.baselinePnl=Number(v)||0;},renderFutures);
  onEdit("#flossPrice",v=>{v=v.trim();if(v===""||!(Number(v)>0))delete f.lossPrice;else f.lossPrice=Number(v);},renderFutures);
  onEdit("#frollSpread",v=>{v=v.trim();if(v===""||!Number.isFinite(Number(v)))delete f.rollSpread;else f.rollSpread=Number(v);},renderFutures);$("fSave").onclick=()=>{f.note=$("fNote").value;save();renderFutures();};$("fNote").oninput=e=>f.note=e.target.value;
  $("addPosition").onclick=()=>{f.positions.push({month:"202612",contracts:0,settlementPrice:1});save();renderFutures();};$$("[data-remove-pos]").forEach(b=>b.onclick=()=>{f.positions.splice(Number(b.dataset.removePos),1);save();renderFutures();});
  onEdit("[data-pos]",(v,el)=>{const p=f.positions[Number(el.dataset.pos)],key=el.dataset.key;p[key]=key==="month"?v:Number(v)||0;},renderFutures);
  onEdit("[data-level-price]",(v,el)=>{const l=f.levels[Number(el.dataset.levelPrice)];l.price=Number(v)||l.price;l.tranches.forEach(t=>{if(!t.completed)t.price=l.price;});},renderFutures);
  $$("[data-level-qty]").forEach(input=>input.onchange=()=>{const li=Number(input.dataset.levelQty),l=f.levels[li],qty=Math.max(0,Math.min(100,Number(input.value)||0));if(l.tranches.some(t=>t.completed)&&qty<l.tranches.filter(t=>t.completed).length){alert("매수 완료한 계약 수보다 작게 줄일 수 없습니다.");return;}resizeTranches(l,qty);save();renderFutures();});
  onEdit("[data-tranche-price]",(v,el)=>{const [li,ti]=el.dataset.tranchePrice.split(":").map(Number);f.levels[li].tranches[ti].price=Number(v)||0;},renderFutures);
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
  $("addLevel").onclick=()=>{if(f.levels.length>=40)return;f.levels.push({days:0,label:`추가 매수 ${f.levels.length-futuresDays.length+1}`,price:0,confirmed:true,contracts:1,tranches:[{price:0,completed:false,executionPrice:null}]});save();renderFutures();};
}
