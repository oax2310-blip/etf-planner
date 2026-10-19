// 달러선물 신저점 손절 후 재매수 화면. 계산은 rebuy.js(futureRebuySummary 등), 달러선물 화면은 futures.js.
// 손절·재매수 계산은 rebuy.js에 둔다(비공개 시세 수집 작업도 같은 함수를 사용). 아래 보유 반영은 화면 쪽에서만 하며 계산 함수는 기록만 읽는다.
// 손절은 특수한 상황이라 실행(첫 체크) 전에는 한 줄로 접어 둔다. 펼친 상태는 화면 상태라 저장·동기화하지 않는다.
let futureRebuyExpanded=false;

// 손절·재매수 체크는 보유 월물·누적 정산손익에 반영한다(분할매수 체크의 월물 편입과 같은 방식).
// 손절: 판 계약 수 이상 남은 가장 가까운 월물에서 빼고, 남은 계약의 단순평균가는 그대로 둔다.
//   실현 손익 round((체결 환율 − 판 시점 단순평균가) × 계약 × 1만)을 누적 정산손익에 더하고 기록에 month·settlementPrice를 남긴다.
// 재매수: 보유 근월물(없으면 마지막 손절 월물)에 체결 환율로 편입(가중평균)하고 기록에 month를 남긴다.
// 해제·계약 수·체결 환율 수정은 기록한 월물에서 같은 계산으로 되돌린다(손절로 다 판 월물은 되살린다). 체크 기록 초기화는 보유에 반영한 체결을 되돌리지 않는다.
// month 없는 기록(연동 전 체크·보유 월물이 없을 때 체크)은 계산에 넣지 않고 '보유 월물에 반영'을 누를 때만 반영한다(직접 고친 보유와 중복 방지).
// '직접 반영함'을 누르면 그 기록에 manual을 남겨 안내·반영 대상에서 뺀다(보유 월물·누적 정산손익은 그대로). 체크를 해제하면 기록과 함께 지운다.
const futureRebuyOpen=x=>!!x&&typeof x==="object"&&!x.month&&!x.manual&&futureRebuyQty(x.contracts)>0;
const futureCutPnl=rec=>Math.round(((Number(rec.price)||Number(rec.targetPrice))-Number(rec.settlementPrice))*futureRebuyQty(rec.contracts)*contractSize);
const addFuturePnl=(f,v)=>{f.baselinePnl=(Number(f.baselinePnl)||0)+v;};
// qty계약 이상 남은 보유 월물(prefer 우선, 없으면 가장 가까운 월물). 없으면 "".
function futureHeldMonth(f,qty,prefer){
  const months=f.positions.filter(p=>monthOk(String(p.month))&&(Number(p.contracts)||0)>=qty).map(p=>String(p.month)).sort();
  return months.includes(prefer)?prefer:months[0]||"";
}
function sellFromPosition(f,month,qty){
  const i=f.positions.findIndex(p=>String(p.month)===month),c=Number(f.positions[i]?.contracts)||0;if(i<0||c<qty)return false;
  if(c===qty)f.positions.splice(i,1);else f.positions[i].contracts=c-qty;
  return true;
}
function linkFutureCut(f,rec){
  const qty=futureRebuyQty(rec.contracts),month=qty?futureHeldMonth(f,qty):"",avg=Number(f.positions.find(p=>String(p.month)===month)?.settlementPrice);
  if(!month||!(avg>0))return false;
  rec.month=month;rec.settlementPrice=avg;sellFromPosition(f,month,qty);addFuturePnl(f,futureCutPnl(rec));
  return true;
}
function unlinkFutureCut(f,rec){addToPosition(f,rec.month,futureRebuyQty(rec.contracts),Number(rec.settlementPrice));addFuturePnl(f,-futureCutPnl(rec));}
// fill = [기록, 가격 필드](futureFillRec): 새 기록 buys[t].price, 옛 통째 기록은 단계의 execPrice.
function linkFutureRebuy(f,[rec,key]){
  const cuts=futureRebuyOf(f).cuts,qty=futureRebuyQty(rec.contracts),price=Number(rec[key]),month=nearestMonth(f)||(Array.isArray(cuts)?cuts:[]).filter(c=>c?.month).at(-1)?.month||"";
  if(!qty||!(price>0)||!month)return false;
  addToPosition(f,month,qty,price);rec.month=month;
  return true;
}
// 화면 확인용 읽기 전용 재매수 기록(futureFillRec와 같은 위치, 기록을 옮기거나 만들지 않음).
function futureFillOf(f,i,t){const x=futureRebuyStages(futureRebuyOf(f))[i];return !x?null:x.done?(t===0?[x,"execPrice"]:null):Array.isArray(x.buys)&&x.buys[t]?[x.buys[t],"price"]:null;}
// 손절 체크·해제: false = 기록 규칙 위반, "unlinked" = 판 계약 수만큼 남은 보유 월물이 없어 기록만 함.
function setFutureCutChecked(f,i,on){
  const cuts=futureRebuyOf(f).cuts,old=on||!Array.isArray(cuts)?null:cuts[i];
  if(setFutureCutDone(f,i,on)===false)return false;
  if(on)return linkFutureCut(f,f.rebuy.cuts[i])||"unlinked";
  if(old?.month)unlinkFutureCut(f,old);
}
function setFutureCutCount(f,i,text){
  const rec=(futureRebuyOf(f).cuts||[])[i],old=futureRebuyQty(rec?.contracts),qty=Number(text);
  if(!rec?.month)return setFutureCutQty(f,i,text);
  const sell=qty>old?futureHeldMonth(f,qty-old,rec.month):"",before=futureCutPnl(rec);
  if(qty>old&&!sell||setFutureCutQty(f,i,text)===false)return false;
  if(qty>old)sellFromPosition(f,sell,qty-old);else if(qty<old)addToPosition(f,rec.month,old-qty,Number(rec.settlementPrice));
  addFuturePnl(f,futureCutPnl(rec)-before);
}
function setFutureCutPrice(f,i,text){
  const n=Number(text),rec=editFutureRebuy(f).cuts[i];if(!rec||!Number.isFinite(n)||n<=0)return false;
  const before=rec.month?futureCutPnl(rec):0;rec.price=n;
  if(rec.month)addFuturePnl(f,futureCutPnl(rec)-before);
}
// 재매수 체크·해제. 해제할 때 보유에서 뺄 월물이 없으면 detach일 때만 체크만 푼다(보유는 직접 수정).
function setFutureBuyChecked(f,i,t,on,detach=false){
  if(on){if(setFutureBuyDone(f,i,t,true)===false)return false;return linkFutureRebuy(f,futureFillRec(f,i,t))||"unlinked";}
  const fill=futureFillOf(f,i,t),rec=fill?.[0],qty=futureRebuyQty(rec?.contracts),price=Number(rec?.[fill?.[1]]),month=rec?.month?futureHeldMonth(f,qty,rec.month):"";
  if(rec?.month&&!month&&!detach||setFutureBuyDone(f,i,t,false)===false)return false;
  if(month)removeFromPosition(f,month,qty,price);
  const st=futureRebuyOf(f).stages[i];delete st.month;delete st.manual; // 옛 통째 기록은 해제 후에도 단계가 남는다
}
function setFutureBuyCount(f,i,t,text){
  const fill=futureFillOf(f,i,t),rec=fill?.[0],old=futureRebuyQty(rec?.contracts),qty=Number(text);
  if(!rec?.month)return setFutureBuyQty(f,i,t,text);
  const take=qty<old?futureHeldMonth(f,old-qty,rec.month):"",price=Number(rec[fill[1]]);
  if(qty<old&&!take||setFutureBuyQty(f,i,t,text)===false)return false;
  if(qty>old)addToPosition(f,rec.month,qty-old,price);else if(qty<old)removeFromPosition(f,take,old-qty,price);
}
function setFutureBuyExec(f,i,t,text){
  const fill=futureFillOf(f,i,t),rec=fill?.[0],n=Number(text);
  if(!rec?.month)return setFutureBuyPrice(f,i,t,text);
  const qty=futureRebuyQty(rec.contracts),old=Number(rec[fill[1]]),month=futureHeldMonth(f,qty,rec.month);
  if(!month||setFutureBuyPrice(f,i,t,text)===false)return false;
  removeFromPosition(f,month,qty,old);addToPosition(f,month,qty,n);
}
// month·manual 없는 손절·재매수 계약 수(화면 안내용, 읽기 전용).
function futureRebuyUnlinked(f){
  const r=futureRebuyOf(f),qty=x=>futureRebuyOpen(x)?futureRebuyQty(x.contracts):0;
  return {cuts:(Array.isArray(r.cuts)?r.cuts:[]).reduce((n,c)=>n+qty(c),0),buys:futureRebuyStages(r).reduce((n,x)=>n+(x.done?qty(x):(Array.isArray(x.buys)?x.buys:[]).reduce((m,b)=>m+qty(b),0)),0)};
}
// month·manual 없는 기록을 손절 → 재매수 순서로 반영한 사본. 하나라도 반영할 수 없으면 null(원본은 그대로).
function futureRebuyLinked(f){
  const g=JSON.parse(JSON.stringify(f)),r=editFutureRebuy(g);
  if(!r.cuts.every(c=>!futureRebuyOpen(c)||linkFutureCut(g,c)))return null;
  const fills=r.stages.flatMap(x=>x.done?[[x,"execPrice"]]:(Array.isArray(x.buys)?x.buys:[]).map(b=>[b,"price"]));
  return fills.every(fill=>!futureRebuyOpen(fill[0])||linkFutureRebuy(g,fill))?g:null;
}
// '직접 반영함': month·manual 없는 기록에 manual만 남긴다.
function markFutureRebuyManual(f){
  const r=editFutureRebuy(f);
  [...r.cuts,...r.stages.flatMap(x=>x.done?[x]:Array.isArray(x.buys)?x.buys:[])].forEach(x=>{if(futureRebuyOpen(x))x.manual=true;});
}
// 맨 위 보유 카드(화면 표시만, 기록을 바꾸지 않음): 이탈 전 계약 수만큼 칸(1칸 = 1계약)을 처음 보유(초록) · 재매수로 다시 채운 칸(파랑) · 손절로 빈 칸 순서로 그린다.
// 손절하면 오른쪽부터 비고 재매수하면 빈 칸이 다시 채워진다(빈 칸·파랑은 판 계약 수까지). 손절 목표 밖(최소 유지) 칸은 흐리게 둔다.
// 말풍선은 다음에 비거나 채워질 칸(그 회차 계약 수만큼)을 가리킨다: 재매수 시작 전에는 다음 손절 회차, 손절 목표를 다 팔았거나 재매수를 시작했으면 다음 재매수 회차.
// 손절 시점(현재 환율 ≤ 회차 환율)·재매수 시점(현재 환율 ≥ 회차 환율)은 주황. toggle은 신저점 이탈 알림 스위치, trText는 재매수 회차 이름(이스케이프됨).
function futureRebuyTrack(r,s,cur,toggle,trText){
  const hold=s.hold,sold=Math.min(s.sold,hold),back=Math.min(s.rebought,sold),green=hold-sold,filled=green+back,keep=Math.max(0,hold-s.goal),low=Number(r.lowPrice)||0;
  const cutPx=v=>`${decimal.format(v)}원`,px2=v=>`${fmtPrice(Math.round(v*100)/100)}원`;
  const pct=p=>{const g=(p/cur-1)*100;return `${g>0?"+":""}${new Intl.NumberFormat("ko-KR",{maximumFractionDigits:Math.abs(g)<1?2:1}).format(g)}%`;},gap=p=>cur>0&&p>0?pct(p):"";
  const nextCut=s.ready&&!s.started?s.cuts.find(c=>!c.done&&c.qty>0):null,nextTr=s.tranches.find(x=>!x.done&&x.amount>0);
  const trPx=x=>Number(x.price)>0?`${x.est?"≈":""}${px2(Number(x.price))}`:"기준가 없음";
  let from=-1,to=-1,bub="",due=false,buy=false;
  if(nextCut){from=Math.max(0,filled-nextCut.qty);to=filled;due=cur>0&&cur<=nextCut.price;
    bub=due?`손절 시점 · ${nextCut.k}회 <b>${cutPx(nextCut.price)}</b> ${nextCut.qty}계약`:`${nextCut.k===1?"신저점 이탈 시 1회":`다음 손절 ${nextCut.k}회`} <b>${cutPx(nextCut.price)}</b>${nextCut.qty>1?` · ${nextCut.qty}계약`:""} ${gap(nextCut.price)}`;}
  else if(nextTr&&filled<hold){buy=true;from=filled;to=Math.min(hold,filled+nextTr.amount);const p=Number(nextTr.price)||0;due=cur>0&&p>0&&cur>=p;
    bub=`${due?"재매수 시점":"다음 재매수"} ${trText(nextTr)} <b>${trPx(nextTr)}</b> ${due?`${nextTr.amount}계약`:gap(p)}`;}
  const [chipCls,chipText]=!s.ready?["muted","기준 확인 필요"]:s.started&&!s.rest?["done","재매수 완료"]:due?["warn",buy?"재매수 시점":"손절 시점"]
    :s.started?["","재매수 진행 중"]:s.sold?nextCut?["","손절 진행 중"]:["","재매수 대기"]:cur>0&&cur<low?["warn","신저점 이탈"]:["muted",cur>0?"신저점 위 대기":"손절 대기"];
  const cell=i=>`<i class="${i<green?i<keep?"h keep":"h":i<filled?"r":"s"}${!buy&&due&&i>=from&&i<to?" due":""}"></i>`,cells=Array.from({length:hold},(_,i)=>i);
  // 다음 회차 칸은 한 묶음(.fr-next)으로 감싸 테두리(손절)·점선(재매수)을 한 번만 그린다(계약이 많아 칸이 좁아도 겹치지 않음).
  const strip=from<0?cells.map(cell).join(""):`${cells.slice(0,from).map(cell).join("")}<span class="fr-next${buy?" buy":""}${due?" due":""}" style="flex:${to-from}">${cells.slice(from,to).map(cell).join("")}</span>${cells.slice(to).map(cell).join("")}`;
  const x=from<0?0:Math.round((from+to)/2/hold*1e4)/100,dense=hold>60?" tight":hold>30?" dense":"";
  const gapChip=p=>gap(p)?` <span class="fr-gap${p>cur?" up":""}">${gap(p)}</span>`:"";
  const bought=s.tranches.filter(t=>t.done&&t.qty>0&&t.execPrice>0),bq=bought.reduce((n,t)=>n+t.qty,0),buyAvg=bq?bought.reduce((n,t)=>n+t.qty*t.execPrice,0)/bq:0,sellAvg=s.sellAvg?px2(s.sellAvg):"";
  const note=!s.ready?"신저점 환율·손절 하단·이탈 전 계약 수·손절 비중을 아래 손절 기준에서 확인하세요."
    :s.started&&!s.rest?`손절 ${s.sold}계약 → 재매수 ${s.rebought}계약${sellAvg?` · 평균 손절 ${sellAvg}`:""}${buyAvg?` → 재매수 ${px2(buyAvg)}`:""}`
    :s.started||s.sold&&!nextCut?`손절 ${s.sold}계약 완료${sellAvg?` · 평균 ${sellAvg}`:""}${s.started&&s.cuts.some(c=>!c.done&&c.qty>0)?" · 남은 손절 멈춤":""}`
    :s.sold?`재매수 시작: ${nextTr?`${trText(nextTr)} <b>${trPx(nextTr)}</b> 이상 ${nextTr.amount}계약${gapChip(Number(nextTr.price)||0)}`:"반등 신호가 나오면 판 계약만 되삽니다"}`
    :"손절하면 칸이 오른쪽부터 비고, 재매수하면 빈 칸이 다시 채워집니다.";
  const legend=`<div class="fr-legend"><span>처음 보유 <b>${green}</b>${keep&&green?`<small> · 최소 유지 ${Math.min(keep,green)}</small>`:""}</span><span class="r">재매수 <b>${back}</b></span><span class="s">손절로 빈 칸 <b>${sold-back}</b></span></div>`;
  const track=hold?`${bub?`<div class="fr-bub-row" style="--x:${x}%"><span class="fr-bub${due?" due":""}">${bub}</span><span class="fr-arrow${due?" due":""}"></span></div>`:""}<div class="fr-cells${dense}" role="img" aria-label="이탈 전 ${hold}계약 중 보유 ${s.held}계약 · 손절 ${sold}계약 · 재매수 ${back}계약">${strip}</div>${legend}`:"";
  return `<section class="card fr-track" aria-label="보유 계약"><div class="fr-track-body"><div class="fr-track-top"><div><strong>보유 계약</strong><span class="buy-track-chip${chipCls?` ${chipCls}`:""}">${chipText}</span></div><div class="fr-count"><b>${s.held}</b><span>/ ${hold}계약</span></div></div>${track}<p class="fr-note">${hold?note:"이탈 전 계약 수를 넣으면 보유 계약 칸이 생깁니다."}</p></div>
    <div class="fr-track-foot"><span>${cur>0?`현재 <b>${fmtPrice(cur)}원</b>`:"현재 환율 미입력"}</span>${toggle}</div></section>`;
}
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
  const px2=v=>px(Math.round(v*100)/100),first=esc(movingLineText(s.stages[0]?.name||"첫 단계")),firstPx=Number(s.stages[0]?.price)||0,firstTr=s.tranches[0],lastTr=s.tranches.at(-1);
  const trName=x=>`<span class="tr-name">${esc(movingLineText(s.stages[x.i].name))}${s.stages[x.i].done?"":`<span class="tr-no">${x.t+1}</span>`}</span>`,trText=x=>`${esc(movingLineText(s.stages[x.i].name))}${s.stages[x.i].done?"":` ${x.t+1}회차`}`,trAt=x=>x.price>0?` · ${x.est?"≈":""}${px2(x.price)} 이상`:"";
  const splitText=!s.sellAvg||!firstTr?"":`${s.tranches.length>1?`${s.tranches.length}분할 (${trName(firstTr)}~${trName(lastTr)}`:`한 번에 (${trName(firstTr)}`}, ${!firstPx?`${first} 기준가 없음`:firstPx<=s.sellAvg?`평균 손절 환율 ${px2(s.sellAvg)} 이하 회차`:`평균 손절 환율 ${px2(s.sellAvg)}보다 ${first} 기준가가 높음`})`;
  const next=!s.ready?s.sellPct===0?"손절 비중이 0%라 분할 손절을 계획하지 않습니다.":"신저점 환율·손절 하단·이탈 전 계약 수·손절 비중을 확인하세요. 손절 목표가 1계약 이상이어야 회차가 계산됩니다."
    :s.started&&!s.rest?`재매수 완료 · 손절 ${s.sold}계약 → 재매수 ${s.rebought}계약`
    :s.started?`다음 재매수 <b>${nextTr?`${trName(nextTr)}${trAt(nextTr)}에서 ${nextTr.amount}계약`:"없음 · 체결 수량을 확인하세요"}</b> · 남은 ${s.rest}계약 · 남은 손절은 멈춤`
    :`다음 손절 <b>${nextCut?`${nextCut.k}회 · ${cutPx(nextCut.price)} 이하에서 ${nextCut.qty}계약`:"없음 (손절 목표 완료)"}</b>${s.sold?` · ${nextTr?`${first} 반등 신호가 나오면 재매수 시작 <b>${nextTr.amount}계약</b>`:"반등 신호에 재매수 시작"} · ${splitText}`:""}`;
  const un=futureRebuyUnlinked(f),unText=[un.cuts?`손절 ${un.cuts}계약`:"",un.buys?`재매수 ${un.buys}계약`:""].filter(Boolean).join("·");
  const notify=(kind,key,label,done,lead)=>typeof futureRebuyAlertEnabled==="function"?tradeAlertToggle(futureRebuyAlertEnabled(f,kind,key),`data-frebuy-alert="${kind}"${key==null?"":` data-alert-key="${esc(key)}"`}`,label,done,lead):"";
  const all=kind=>typeof futureRebuyAllButtons==="function"?futureRebuyAllButtons(kind):"";
  const linkText=rec=>`<div class="sub">${rec?.month?`${esc(rec.month)} 보유 반영`:rec?.manual?"직접 반영":"보유 미반영"}</div>`;
  const cutRows=(s.started?s.cuts.filter(c=>c.done):s.cuts).map(c=>{
    const due=!c.done&&cur>0&&cur<=c.price;
    return `<div class="sale-row ${c.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-fcut="${c.k-1}" ${c.done?"checked":""} ${!c.done&&(s.started||!c.qty)?"disabled":""}>${c.k}회</label><div class="stage-price"><span class="price">${cutPx(c.price)}</span>${notify("cuts",c.k-1,`${c.k}회 손절`,c.done)}</div><div class="shares">${c.done?`<span class="exec-fields"><input class="qty" data-fcut-qty="${c.k-1}" type="number" min="1" step="1" value="${c.qty}" aria-label="${c.k}회 손절 계약 수">계약 <input data-fcut-price="${c.k-1}" type="number" min="0" step="any" value="${opt(c.execPrice)}" aria-label="${c.k}회 손절 체결 환율">원</span>${linkText((Array.isArray(r.cuts)?r.cuts:[])[c.k-1])}`:`${c.qty}계약<div class="sub">계획상 남은 ${c.left}계약</div>`}</div><div class="status ${c.done?"done":due?"due":""}">${c.done?"손절 완료":due?"손절 시점":"대기"}</div></div>`;
  }).join("")||'<div class="empty">기준을 입력하면 손절 회차가 계산됩니다.</div>';
  // 분할 범위 단계(또는 산 단계)는 회차마다 한 줄(첫 줄에 단계 기준 환율·알림), 나머지 단계는 기준 환율만 한 줄.
  const buyRows=s.stages.map((x,i)=>{
    const own=s.tranches.filter(y=>y.i===i),rows=[...own,...s.skipped.filter(y=>y.i===i).map(y=>({...y,skip:true}))].sort((a,b)=>a.t-b.t),price=Number(x.price)||0,nextName=esc(movingLineText(s.stages[i+1]?.name||""));
    const priceInput=`<span class="exec-fields"><input data-fbuy-price="${i}" type="number" min="0" step="any" value="${opt(price)}" placeholder="${s.est[i]?`≈${fmtPrice(Math.round(s.est[i]*100)/100)}`:"기준가"}" aria-label="${esc(movingLineText(x.name))} 기준 환율">원${autoKey(x.name)?auto:""}</span>${notify("buys",`stage:${i}`,movingLineText(`${x.name} 재매수`),own.length>0&&own.every(y=>y.done))}`;
    if(!own.length)return `<div class="sale-row"><label class="check"><input type="checkbox" disabled>${esc(movingLineText(x.name))}</label><div class="stage-price">${priceInput}</div><div class="shares">${s.sold?"배분 없음":"손절 후 계산"}</div><div class="status">대기</div></div>`;
    return rows.map((y,k)=>{
      const due=!y.skip&&!y.done&&y.amount>0&&cur>0&&y.price>0&&cur>=y.price,nextUp=y===nextTr,where=y.step?`${esc(movingLineText(x.name))}→${nextName} ${y.t}/${TRANCHES}`:y.t?"단계 환율과 같음":"";
      const pricePart=k===0?priceInput:`<span class="price">${y.price>0?`${y.est?"≈":""}${px2(y.price)}`:"—"}</span><span class="krw">${where}</span>`;
      if(y.skip)return `<div class="sale-row"><label class="check"><input type="checkbox" disabled>${trName(y)}</label><div class="stage-price">${pricePart}</div><div class="shares">—<div class="sub">${y.est?"추정 환율이라 제외":s.sellAvg&&y.price>s.sellAvg?"평균 손절 환율 위":"계획 밖"}</div></div><div class="status">안 삼</div></div>`;
      const shares=y.done?`<span class="exec-fields"><input class="qty" data-fbuy-qty="${i}:${y.t}" type="number" min="1" step="1" value="${y.qty}" aria-label="${trText(y)} 재매수 계약 수">계약 <input data-fbuy-exec="${i}:${y.t}" type="number" min="0" step="any" value="${opt(y.execPrice)}" aria-label="${trText(y)} 재매수 체결 환율">원</span>${linkText(futureFillOf(f,i,y.t)?.[0])}`:!s.sold?"손절 후 계산":y.amount?`${y.amount}계약`:"배분 없음";
      return `<div class="sale-row ${y.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-fbuy="${i}:${y.t}" ${y.done?"checked":""} ${!y.done&&!y.amount?"disabled":""}>${trName(y)}</label><div class="stage-price">${pricePart}</div><div class="shares">${shares}</div><div class="status ${y.done?"done":due||nextUp?"due":""}">${y.done?"재매수 완료":due?"재매수 시점":nextUp?"다음 신호":"대기"}</div></div>`;
    }).join("");
  }).join("")||'<div class="empty">재매수 단계가 없습니다.</div>';
  // 제목 아래 기준 한 줄: 신저점 → 하단 · 이탈 전 계약 · 비중 · 실제 회차 수(손절 목표보다 많은 분할은 줄어듦) · 최소 유지(있을 때만)
  // 현재 환율은 화면 맨 위 시세·보유 카드에 보이므로, 입력 칸은 보유 근월물 시세가 없을 때만 손절 기준에 둔다.
  const basis=s.ready?`<span class="quote-state">${cutPx(r.lowPrice)} → ${cutPx(r.floorPrice)}</span><span>이탈 전 ${s.hold}계약 · ${pctText}% · ${s.cuts.length}분할${s.hold>s.goal?` · 최소 ${s.hold-s.goal}계약 유지`:""}</span>`:`<span>기준 미입력 · 이탈 전 ${s.hold}계약 · ${pctText}%</span>`;
  $("futureRebuyPanel").innerHTML=`<section class="future-rebuy"><div class="section-heading"><h2>신저점 손절 후 재매수</h2><span class="future-rebuy-basis">${basis}</span>${locked?"":'<button class="btn mini ghost" type="button" id="frToggle">접기</button>'}</div>
    ${futureRebuyTrack(r,s,cur,notify("breakdown",null,"신저점 손절 시작",s.started,"신저점 이탈"),trText)}
    <div class="control-grid"><section class="card panel"><div class="panel-head"><h2>손절 기준</h2></div><p>신저점부터 정한 하단까지 환율을 고르게 나눕니다. 설정한 비중만큼 손절하고, 하단 아래의 손절 회차는 만들지 않습니다.</p><div class="inline-fields"><label class="field"><span>신저점 환율 (원)</span><input id="frLow" type="number" min="0" step="any" value="${opt(r.lowPrice)}" ${s.started?"disabled":""}></label><label class="field"><span>손절 하단 (원)</span><input id="frFloor" type="number" min="0" step="any" value="${opt(r.floorPrice)}" ${s.started?"disabled":""}></label><label class="field"><span>이탈 전 계약 수</span><input id="frHold" type="number" min="0" step="1" value="${s.hold||""}" ${s.started?"disabled":""}></label><label class="field"><span>손절 비중 (%)</span><input id="frSellPct" type="number" min="0" max="100" step="any" inputmode="decimal" value="${pctText}" ${s.started?"disabled":""}></label><label class="field"><span>분할 횟수</span><input id="frSteps" type="number" min="1" max="60" step="1" value="${futureRebuyQty(r.steps)||10}" ${s.started?"disabled":""}></label>${fe?"":`<label class="field"><span>현재 환율 (원)</span><input id="frCurrent" type="number" min="0" step="any" value="${opt(r.currentPrice)}" placeholder="시세 없음"></label>`}</div><p class="hint future-rebuy-hint">${s.started?"재매수 시작 후 손절 기준은 체크 기록 초기화 후 바꿀 수 있습니다.":locked?"기준을 바꿔도 체크한 손절의 계약 수·환율은 그대로 두고 남은 회차만 다시 나눕니다. 손절 목표(이탈 전 계약 수 × 손절 비중)는 이미 손절한 계약 수 이상이어야 합니다.":"손절 비중은 0~100%로 입력합니다(기본 50%). 손절 계약 수보다 많은 분할 횟수는 자동으로 줄입니다."}${s.cuts.length===1?" 한 번만 손절하는 계획은 하단에서 실행합니다.":""}${fe?"":" 보유 근월물 시세가 없어 현재 환율은 직접 넣습니다."}</p></section></div>
    <div class="card progress-line">${next}</div>${s.overSold||s.overBought?'<div class="warning">체결 기록이 손절 목표 또는 판 계약 수를 넘습니다. 실제 체결 수량을 확인하세요.</div>':""}${unText?`<div class="warning">${unText}이 보유 월물·누적 정산손익에 반영되지 않았습니다(연동 전 체크 또는 반영할 보유 월물이 없던 체크). 계좌 기준으로 이미 직접 고쳤다면 '직접 반영함'을 누르세요. <button class="btn mini" type="button" id="frLink">보유 월물에 반영</button> <button class="btn mini" type="button" id="frManual">직접 반영함</button></div>`:""}
    <details class="future-rebuy-details" open><summary>1. 분할 손절 <span>${s.doneCuts}회 · ${s.sold}계약 완료</span></summary><div class="section-heading">${all("cuts")}</div><section class="card table-card"><div class="table-head"><span>회차</span><span>손절 환율</span><span>계약 수 · 실제 체결 환율</span><span>상태</span></div>${cutRows}${s.started?'<div class="stop-note">재매수를 시작해 남은 손절 회차는 멈췄습니다.</div>':""}</section></details>
    <details class="future-rebuy-details" ${s.sold?"open":""}><summary>2. 반등 단계별 재매수 <span>잔여 ${s.rest}계약 · ${s.doneTranches} / ${s.tranches.length}회</span></summary><div class="section-heading">${all("buys")}<button class="btn mini ghost" id="frTimeframes" type="button">시·일·주·월선 추가</button></div><section class="card table-card stage-table"><div class="table-head"><span>단계 · 회차</span><span>기준 환율 · 회차 환율</span><span>재매수 계약 수 · 체결 환율</span><span>상태</span></div>${buyRows}</section></details>
    <div class="reset-row"><button class="btn ghost mini" id="frReset" type="button" ${locked?"":"disabled"}>체크 기록 초기화</button></div><p class="footnote">실제 주문은 증권사에서 실행합니다. 손절을 체크하면 가장 가까운 보유 월물에서 계약을 빼고 실현 손익(체결 환율 − 단순평균가)을 누적 정산손익에 더하며, 재매수를 체크하면 근월물에 체결 환율로 편입합니다. 체크 후 실제 체결 환율·계약 수를 맞추면 보유도 함께 고쳐집니다. 손절·재매수 시점은 보유 근월물 시세(없으면 직접 넣은 현재 환율)로 표시합니다.</p></section>`;
  if(typeof bindFutureRebuyAlerts==="function")bindFutureRebuyAlerts(f);
  $("frTimeframes").onclick=()=>{const r=editFutureRebuy(f),stages=completeMovingStages(r.stages);if(stages.length>80){alert("재매수 단계는 80개까지 설정할 수 있습니다.");return;}r.stages=stages;if(priceData)fillPrices({futures:f},priceData);save();renderFutures();};

  if(!locked)$("frToggle").onclick=()=>{futureRebuyExpanded=false;renderFutures();};
  for(const [field,key] of [["frLow","lowPrice"],["frFloor","floorPrice"],["frHold","contracts"],["frSellPct","sellPct"],["frSteps","steps"],["frCurrent","currentPrice"]])onEdit("#"+field,v=>{
    if(setFutureRebuyField(f,key,v)===false){alert(key==="sellPct"?"손절 비중은 0~100%로 입력하세요. 목표가 이미 손절한 계약 수보다 작아질 수 없으며, 재매수 시작 후에는 변경할 수 없습니다.":"손절 하단은 신저점보다 낮아야 하며, 계약 수·분할 횟수는 정수로 입력하세요. 손절 목표가 이미 손절한 계약 수보다 작아지는 이탈 전 계약 수는 넣을 수 없고, 재매수 시작 후 손절 기준은 체크 기록 초기화 후 바꿀 수 있습니다.");return false;}
    if(key!=="currentPrice"&&priceData)fillPrices({futures:f},priceData);
  },renderFutures);
  $$("[data-fcut]").forEach(input=>input.onchange=()=>{const i=Number(input.dataset.fcut),rec=futureRebuyOf(f).cuts?.[i];
    if(!input.checked&&rec?.month&&!confirm(`${rec.month} 보유분에 ${futureRebuyQty(rec.contracts)}계약(단순평균가 ${fmtPrice(rec.settlementPrice)}원)을 되돌리고 누적 정산손익에서 이 손절 손익 ${money(futureCutPnl(rec))}을 뺄까요?\n그 사이 보유 월물·누적 정산손익을 직접 고쳤다면 되돌린 뒤 값을 확인하세요.`)){renderFutures();return;}
    const done=setFutureCutChecked(f,i,input.checked);
    if(done===false)alert("손절 목표를 넘거나 재매수 기록과 맞지 않습니다. 재매수 시작 후에는 추가 손절을 기록할 수 없습니다.");
    else{save();if(done==="unlinked")alert("판 계약 수만큼 남은 보유 월물(단순평균가 포함)이 없어 손절 기록만 했습니다. 보유 월물을 확인한 뒤 '보유 월물에 반영'을 누르세요.");}
    renderFutures();});
  onEdit("[data-fcut-qty]",(v,el)=>{if(setFutureCutCount(f,Number(el.dataset.fcutQty),v)===false){alert("계약 수는 1 이상 정수로, 손절 목표와 재매수 기록 사이에서 입력하세요. 보유 월물에 더 뺄 계약이 없으면 늘릴 수 없습니다.");return false;}},renderFutures);
  onEdit("[data-fcut-price]",(v,el)=>setFutureCutPrice(f,Number(el.dataset.fcutPrice),v),renderFutures);
  const trKey=v=>String(v).split(":").map(Number);
  $$("[data-fbuy]").forEach(input=>input.onchange=()=>{const [i,t]=trKey(input.dataset.fbuy),fill=futureFillOf(f,i,t),rec=fill?.[0];let detach=false;
    if(!input.checked&&rec?.month){const qty=futureRebuyQty(rec.contracts),month=futureHeldMonth(f,qty,rec.month);
      if(month?!confirm(`${month} 보유분에서 재매수 ${qty}계약(체결 환율 ${fmtPrice(rec[fill[1]])}원)을 빼고 단순평균가를 되돌릴까요?\n그 사이 이 월물의 단순평균가를 직접 고쳤다면, 되돌린 뒤 값을 확인하세요.`):!(detach=confirm(`보유 월물에 재매수 ${qty}계약을 뺄 ${rec.month}이(가) 없습니다(교체·삭제된 것으로 보입니다).\n체크만 해제하고 보유 월물은 직접 고칠까요?`))){renderFutures();return;}}
    const done=setFutureBuyChecked(f,i,t,input.checked,detach);
    if(done===false)alert("손절한 계약과 배분된 재매수 수량·환율을 먼저 확인하세요. 판 계약 수를 넘겨 재매수할 수 없습니다.");
    else{save();if(done==="unlinked")alert("보유 월물이 없어 재매수 기록만 했습니다. 보유 월물을 입력한 뒤 '보유 월물에 반영'을 누르세요.");}
    renderFutures();});
  onEdit("[data-fbuy-qty]",(v,el)=>{if(setFutureBuyCount(f,...trKey(el.dataset.fbuyQty),v)===false){alert("계약 수는 1 이상 정수로, 판 계약 수 안에서 입력하세요. 보유 월물에서 뺄 계약이 없으면 줄일 수 없습니다.");return false;}},renderFutures);
  onEdit("[data-fbuy-price]",(v,el)=>{const n=v.trim()===""?0:Number(v);if(!Number.isFinite(n)||n<0)return false;editFutureRebuy(f).stages[Number(el.dataset.fbuyPrice)].price=n;},renderFutures);
  onEdit("[data-fbuy-exec]",(v,el)=>setFutureBuyExec(f,...trKey(el.dataset.fbuyExec),v),renderFutures);
  if($("frLink"))$("frLink").onclick=()=>{const g=futureRebuyLinked(f),held=x=>x.positions.reduce((n,p)=>n+(Number(p.contracts)||0),0);
    if(!g){alert("반영할 보유 월물 계약이 부족하거나 단순평균가·체결 환율이 없습니다. 보유 월물과 체결 기록을 확인하세요.");return;}
    if(!confirm(`보유 ${held(f)}계약 → ${held(g)}계약, 누적 정산손익 ${money(Number(f.baselinePnl)||0)} → ${money(g.baselinePnl)}으로 고칩니다.\n계좌 기준으로 이미 직접 고쳤다면 취소하고 '직접 반영함'을 누르세요.`))return;
    f.positions=g.positions;f.baselinePnl=g.baselinePnl;f.rebuy=g.rebuy;save();renderFutures();};
  if($("frManual"))$("frManual").onclick=()=>{if(!confirm(`${unText}을 계좌 기준으로 직접 고친 것으로 표시하고 이 안내를 닫을까요?\n보유 월물·누적 정산손익은 바꾸지 않습니다.`))return;markFutureRebuyManual(f);save();renderFutures();};
  $("frReset").onclick=()=>{if(!confirm("달러선물 손절·재매수 체크 기록을 모두 지울까요?\n신저점·하단·이탈 전 계약 수·손절 비중·단계 기준가는 남깁니다. 보유 월물·누적 정산손익에 반영한 체결은 되돌리지 않습니다."))return;const r=editFutureRebuy(f);r.cuts=[];r.stages.forEach(x=>{Object.assign(x,{done:false,contracts:null,execPrice:null});delete x.buys;});delete r.planned;save();renderFutures();};
}
