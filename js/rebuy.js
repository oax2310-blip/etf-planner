// 손절 후 재매수(state.rebuy): 종목 목록·손절 회차(cutPlan)·재매수 배분(rebuySummary)과 화면
// 손절 후 재매수 (가격은 국내 상장 ETF 원화 가격). 종목마다 아래 규칙으로 따로 계산한다.
// 종목 목록: state.rebuy = {items:[종목…]}(종목마다 id). 고른 종목(state.selectedRebuy)은 selectedPlan처럼 이 기기 state에만(동기화 기록 밖).
//   옛 기록은 rebuy에 종목 하나를 바로 둔 것 — 그 하나를 목록으로 보고, 처음 고칠 때 editRebuy가 {items:[{id,…옛 종목}]}으로 바꾼다
//   (불러올 때 바꾸면 기기마다 다른 id가 붙어 기록 차이 창이 뜸). 목록을 rebuy 안에 두는 건 열어 둔 옛 화면·시세 수집 스크립트가 rebuy를 객체로 읽어서
//   (옛 화면은 rebuy를 통째로 주고받아 목록을 지우지 않음). 종목을 모두 지워도 {items:[]}로 둔다(rebuy를 지우면 applyRemote 병합이라 다른 기기에서 안 지워짐).
// 손절: 신저점 × (1 − k × stepPct%)에서 그때 남은 수량의 sellPct%. 정수 주로 나누려고 회차별 목표 잔량(남은 수량 × (1 − 비율)^회차)을 반올림하고,
//   체크한 회차(cuts[i] = {shares, price})는 기록한 수량을 쓴 뒤 다음 회차부터 실제 남은 수량으로 다시 계산한다.
// 재매수: 손절한 금액만큼. 분량마다 판 가격이 재매수 기한(다시 오르면 낮은 손절가부터 닿으므로 재매수 금액은 낮은 손절가 분량부터 채움).
//   각 분량은 판 가격보다 싸게 살 것으로 추정되는 단계에 나누고(stageEstimates), 기한이 온(현재가 ≥ 판 가격) 분량은 다음 단계에서 먼저 산다. 재매수를 하나라도 체크하면 남은 손절은 멈춘다.
// 보유량 = 이탈 전 보유 금액(amount, 만원) ÷ 신저점 가격을 내림한 주 수, 또는 직접 넣은 보유 수량(shares, 주). 둘 중 넣은 쪽만 저장한다(setHold, 둘 다 있으면 금액 우선).
const defaultRebuy = () => ({name:"니프티50 ETF",lowPrice:0,amount:0,currentPrice:0,stepPct:1,sellPct:0.5,steps:30,cuts:[],stages:["분봉","일선"].flatMap(unit=>[25,32,42,60,80,125,150].map(n=>({name:n+unit,price:0,done:false,execPrice:null,shares:null}))),note:""});
// 예전 기본 단계(25분봉·60분봉·240분봉·일봉·주봉)를 손대지 않았으면 지금 기본 14단계로 본다(editRebuy가 저장할 때 바꿈).
const untouchedOldStages = st => Array.isArray(st) && st.map(x=>x.name).join()==="25분봉,60분봉,240분봉,일봉,주봉" && st.every(x=>!x.done&&!(Number(x.price)>0));
const stagesOf = r => untouchedOldStages(r.stages) ? defaultRebuy().stages : Array.isArray(r.stages) ? r.stages : [];
const wholeShares = v => Math.max(0,Math.floor(Number(v)||0));
const holdShares = r => Number(r.amount)>0 ? (Number(r.lowPrice)>0 ? Math.floor(Number(r.amount)*10000/Number(r.lowPrice)+1e-9) : 0) : wholeShares(r.shares);
// 보유 입력 단위: 수량만 저장돼 있으면 "shares"(주), 아니면 "amount"(만원). 화면에서 단위만 바꾼 상태(rebuyUnit)는 메모리에만(저장·동기화 안 함)
const holdUnit = r => !(Number(r.amount)>0) && wholeShares(r.shares)>0 ? "shares" : "amount";
let rebuyUnit = null;
// 보유 입력칸 저장: 고른 단위로 넣은 값만 남기고 다른 단위 값은 지운다(수량은 정수 주). 0·빈칸이면 둘 다 지움. 잘못된 값이면 false
function setHold(r, unit, text){
  let v=text===""?0:Number(text); if(!(v>=0))return false;
  const [key,other]=unit==="shares"?["shares","amount"]:["amount","shares"]; if(key==="shares")v=Math.floor(v);
  if(v>0){r[key]=v;delete r[other];}else{delete r.amount;delete r.shares;}
}
function cutPlan(r){
  const low=Number(r.lowPrice)||0, step=Number(r.stepPct)>0?Number(r.stepPct):1, rate=Math.min(Math.max(Number(r.sellPct)||0,0),100)/100, cuts=Array.isArray(r.cuts)?r.cuts:[];
  const lastDone=cuts.reduce((m,c,i)=>c?i+1:m,0), n=Math.max(1,lastDone,Math.min(60,Math.floor(Number(r.steps)||30),Math.ceil(100/step)-1));
  let left=holdShares(r), base=left, from=0;
  return Array.from({length:n},(_,i)=>{
    const k=i+1, rec=cuts[i], price=Math.max(0,low*(1-k*step/100));
    if(rec){const qty=wholeShares(rec.shares);left=Math.max(0,left-qty);base=left;from=k;return {k,drop:k*step,price,qty,left,done:true,execPrice:Number(rec.price)>0?Number(rec.price):null};}
    const qty=Math.max(0,left-Math.round(base*Math.pow(1-rate,k-from)));left-=qty;
    return {k,drop:k*step,price,qty,left,done:false,execPrice:null};
  });
}
// 단계별 예상 가격: 산 단계는 체결가, 기준가를 넣은 단계(마지막 150일선 가격 포함)는 그 값, 나머지는 앞뒤 값 사이를 고르게 채운다.
// 아직 안 산 첫 단계 바로 앞에 start(현재가 등)를 둔다. 뒤쪽에 아는 값이 없는 단계는 추정하지 않는다(null).
function stageEstimates(stages,start){
  const est=stages.map(x=>x.done?(Number(x.execPrice)>0?Number(x.execPrice):null):(Number(x.price)>0?Number(x.price):null)), first=stages.findIndex(x=>!x.done);
  if(first<0)return est;
  const anchors=[[first-1,start>0?start:null],...est.map((v,i)=>[i,v]).filter(([i,v])=>i>=first&&v!=null)].filter(([,v])=>v!=null);
  for(let i=first;i<stages.length;i++){
    if(est[i]!=null)continue;
    const prev=anchors.filter(([j])=>j<i).pop(), next=anchors.find(([j])=>j>i);
    est[i]=prev&&next?prev[1]+(next[1]-prev[1])*(i-prev[0])/(next[0]-prev[0]):null;
  }
  return est;
}
function rebuySummary(r){
  const cuts=cutPlan(r), stages=stagesOf(r), done=cuts.filter(c=>c.done), bought=stages.filter(x=>x.done), cur=Number(r.currentPrice)||0;
  const sellAt=c=>c.execPrice||c.price, sold=done.reduce((a,c)=>a+c.qty,0), sellValue=done.reduce((a,c)=>a+sellAt(c)*c.qty,0), sellAvg=sold?sellValue/sold:null;
  const buyAt=x=>Number(x.execPrice)>0?Number(x.execPrice):sellAvg||0, rebought=bought.reduce((a,x)=>a+wholeShares(x.shares),0), buyValue=bought.reduce((a,x)=>a+wholeShares(x.shares)*buyAt(x),0);
  const priced=bought.filter(x=>Number(x.execPrice)>0&&wholeShares(x.shares)>0), pq=priced.reduce((a,x)=>a+wholeShares(x.shares),0), buyAvg=pq?priced.reduce((a,x)=>a+wholeShares(x.shares)*Number(x.execPrice),0)/pq:null;
  // 손절 분량별 기한: 판 가격이 낮은 분량부터 재매수 금액을 채운다. 반 주 미만 자투리는 정수 주로 살 수 없으니 다 산 것으로 본다.
  let pool=buyValue;
  const lots=done.filter(c=>c.qty>0).map(c=>({k:c.k,price:sellAt(c),qty:c.qty,amount:sellAt(c)*c.qty})).sort((a,b)=>a.price-b.price||a.k-b.k)
    .map(l=>{const covered=Math.min(l.amount,pool),open=l.amount-covered>=l.price/2;pool-=covered;return {...l,covered,left:open?l.amount-covered:0,open,due:open&&cur>0&&cur>=l.price,stages:[]};});
  const rest=lots.reduce((a,l)=>a+l.left,0), dueValue=lots.filter(l=>l.due).reduce((a,l)=>a+l.left,0);
  // 효율적 배분: 분량마다 예상 가격이 판 가격보다 낮은(더 싸게 살) 안 산 단계에 똑같이 나눈다. 예상 가격을 모르는 단계는 후보에 넣는다.
  // 기한이 왔거나(현재가 ≥ 판 가격) 판 가격 아래 단계가 없으면 바로 다음 단계에 담는다.
  const lastBuy=[...bought].reverse().find(x=>Number(x.execPrice)>0), start=cur>0?cur:lastBuy?Number(lastBuy.execPrice):lots.length?lots[0].price:0;
  const est=stageEstimates(stages,start), open=stages.map((x,i)=>x.done?-1:i).filter(i=>i>=0), plan=stages.map(x=>x.done?wholeShares(x.shares)*buyAt(x):0); // 단계별 금액(원)
  lots.forEach(l=>{if(!l.open||!open.length)return;const cheaper=l.due?[]:open.filter(i=>est[i]==null||est[i]<l.price);l.stages=cheaper.length?cheaper:[open[0]];l.stages.forEach(i=>plan[i]+=l.left/l.stages.length);});
  return {cuts,stages,lots,plan,est,sold,rebought,sellValue,buyValue,rest,dueValue,sellAvg,buyAvg,started:bought.length>0,doneCuts:done.length,doneStages:bought.length,held:Math.max(0,holdShares(r)-sold+rebought)};
}
const rebuyItems = d => { const r=d?.rebuy; return !r||typeof r!=="object"?[]:Array.isArray(r.items)?r.items.filter(x=>x&&typeof x==="object"):[r]; };
const rebuyPick = () => { const list=rebuyItems(state); return list.find(x=>x.id&&x.id===state.selectedRebuy)||list[0]||null; }; // 화면에 보이는 종목
// 고칠 종목 목록(배열). 옛 기록이면 목록 형식으로 바꾼다.
function editRebuyList(){
  const rb=state.rebuy;
  if(!rb||typeof rb!=="object")state.rebuy={items:[]};
  else if(!Array.isArray(rb.items))state.rebuy={items:[{id:id(),...rb}]};
  return state.rebuy.items;
}
// 고칠 종목(화면에 보이는 종목)을 돌려준다. 종목이 없으면 기본값으로 하나 만든다.
function editRebuy(){
  const items=editRebuyList();
  let r=rebuyPick();
  if(!r){r={id:id(),...defaultRebuy()};items.push(r);}
  if(!r.id)r.id=id();
  state.selectedRebuy=r.id;
  if(!Array.isArray(r.cuts))r.cuts=[];if(!Array.isArray(r.stages)||untouchedOldStages(r.stages))r.stages=defaultRebuy().stages;return r;
}
// 상태 글자: [화면 '현재 상태', 목록 카드 오른쪽 짧은 글자]
function rebuyStatus(r,s){
  const low=Number(r.lowPrice)||0, cur=Number(r.currentPrice)||0, fromLow=low>0&&cur>0?(cur/low-1)*100:null;
  if(!(low>0&&holdShares(r)>0))return ["입력 필요","입력 필요"];
  if(s.lots.some(l=>l.due))return ["재매수 기한 도달","기한 도달"];
  if(s.started&&!s.rest)return ["재매수 완료","완료"];
  if(s.started)return [`재매수 ${s.doneStages}/${s.stages.length}단계`,`재매수 ${s.doneStages}/${s.stages.length}`];
  if(s.doneCuts)return [`손절 ${s.doneCuts}회 진행`,`손절 ${s.doneCuts}회`];
  return fromLow!=null&&fromLow<0?["신저점 이탈","신저점 이탈"]:fromLow!=null?["신저점 위","대기"]:["손절 대기","대기"];
}
// 종목 추가·이름/코드 수정 창(rebuyDialog). 이 파일은 테스트가 DOM 없이 불러오므로 창 처리는 이 함수 안에서 연결한다.
// 새 종목은 기본 규칙·단계로 만든다. 종목 코드를 바꾸면 auto를 지워 다음 동기화 때 새 종목 시세로 채운다.
function openRebuyDialog(edit){
  const dialog=$("rebuyDialog"), form=$("rebuyForm"), f=form.elements;
  form.reset();$("rebuyTitle").textContent=edit?`${String(edit.name||"").trim()||"종목"} 수정`:"새 재매수 종목";$("deleteRebuyBtn").classList.toggle("hidden",!edit);
  if(edit){f.name.value=edit.name||"";f.ticker.value=edit.ticker||"";}
  form.onsubmit=e=>{e.preventDefault();const name=f.name.value.trim().slice(0,40), ticker=f.ticker.value.trim().toUpperCase().slice(0,12);if(!name)return;
    let r;if(edit)r=editRebuy();else{r={id:id(),...defaultRebuy()};editRebuyList().push(r);state.selectedRebuy=r.id;rebuyUnit=null;}
    r.name=name;if(ticker!==(r.ticker||"")){if(ticker)r.ticker=ticker;else delete r.ticker;delete r.auto;}
    save();dialog.close();renderRebuy();};
  $("deleteRebuyBtn").onclick=()=>{const r=rebuyPick();if(!r||!confirm(`${String(r.name||"").trim()||"이 종목"} 재매수 기록을 삭제할까요?\n손절·재매수 체크와 메모도 함께 지워집니다.`))return;
    const gone=editRebuy();state.rebuy.items=state.rebuy.items.filter(x=>x!==gone);state.selectedRebuy=state.rebuy.items[0]?.id||null;rebuyUnit=null;save();dialog.close();renderRebuy();};
  dialog.querySelectorAll("[data-close-rebuy]").forEach(b=>b.onclick=()=>dialog.close());
  dialog.showModal();f.name.focus();
}
// 화면: 왼쪽(모바일은 위) 종목 목록(분할매도 '저장된 계획'과 같은 카드 — 종목 이름, 오른쪽 짧은 상태, 아래 종목 코드(PC), 막대는 재매수 금액/손절 금액)
// + 고른 종목. 제목은 작은 글씨 '손절 후 재매수 · 종목 코드' 아래 종목 이름(크게), 옆 연필로 이름·코드 수정·종목 삭제 창.
function renderRebuy(){
  const items=rebuyItems(state), r=rebuyPick();
  $("rebuyList").innerHTML=items.length?items.map((x,i)=>{const s=rebuySummary(x), [,short]=rebuyStatus(x,s), name=String(x.name||"").trim()||"이름 없음", code=String(x.ticker||"").trim(), done=s.sellValue?Math.min(100,Math.round(s.buyValue/s.sellValue*100)):0;
    return `<button class="plan-item ${x===r?"active":""}" type="button" data-rebuy="${i}" title="${esc(name)}${code?` (${esc(code)})`:""} · ${esc(short)}"><span class="plan-row"><strong>${esc(name)}</strong><span class="plan-count${short==="기한 도달"?" due":""}">${esc(short)}</span></span><span class="plan-title">${esc(code)}</span><span class="plan-bar"><i style="width:${done}%"></i></span></button>`;}).join(""):"<div class='empty'>종목 없음</div>";
  $$("#rebuyList [data-rebuy]").forEach(b=>b.onclick=()=>{const x=rebuyItems(state)[Number(b.dataset.rebuy)];if(!x||x===rebuyPick())return;state.selectedRebuy=x.id||null;rebuyUnit=null;save();renderRebuy();});
  $("addRebuyBtn").onclick=()=>openRebuyDialog();
  if(!r){$("rebuyMain").innerHTML="<div class='card empty'><h2>재매수 종목을 추가하세요</h2></div>";return;}
  const s=rebuySummary(r), low=Number(r.lowPrice)||0, cur=Number(r.currentPrice)||0, shares=holdShares(r), amount=Number(r.amount)>0?Number(r.amount):0, qtyIn=amount?0:wholeShares(r.shares), unit=rebuyUnit||holdUnit(r), inQty=unit==="shares";
  const step=Number(r.stepPct)>0?Number(r.stepPct):1, sellPct=Number(r.sellPct)||0, first=s.stages[0]?.name||"첫 단계", lastStage=s.stages[s.stages.length-1], lastName=lastStage?.name||"마지막 단계", finalPrice=Number(lastStage?.price)||0, ready=low>0&&shares>0;
  const opt=v=>Number(v)>0?shown(v):"", fromLow=low>0&&cur>0?(cur/low-1)*100:null;
  // 종목 코드를 넣으면 현재가·N일선 단계 기준가를 시세 파일로 채운다(prices.js, 국내 종목만). 없거나 해외 종목이면 기준 입력 아래에 알림
  const ticker=String(r.ticker||""), re=stockEntry(priceData,ticker), rp=re?.kind==="국내"?re:null;
  const priceHint=!ticker||!priceData?"":re&&!rp?"국내 상장 종목 코드만 시세로 채웁니다.":!re?"시세 수집 후 (장중 30분마다) 현재가·일선 기준가를 채웁니다.":"";
  // 시세로 채우는 칸(현재가·N일선 기준가) 이름 옆에 아주 작고 흐린 '(자동)' — 국내 종목 코드가 있고 시세 파일을 읽었을 때(아직 파일에 없는 코드 포함)
  const autoTag=label=>ticker&&priceData&&(!re||rp)&&(!label||maKey(label))?`<small class="auto-tag">(자동)</small>`:"";
  const complete=s.started&&!s.rest, firstDue=s.lots.find(l=>l.due), nextLot=s.lots.find(l=>l.open), nextCut=s.cuts.find(c=>!c.done&&c.qty>0), ni=s.stages.findIndex(x=>!x.done);
  const [status]=rebuyStatus(r,s), title=String(r.name||"").trim()||"이름 없음";
  const manwon=v=>`${decimal.format(v)}만원`, wonShort=v=>v>=10000?manwon(Math.round(v/1000)/10):money(v), amt=(qty,price)=>price>0&&qty>0?`약 ${wonShort(qty*price)}`:"", approx=(qty,price)=>amt(qty,price)&&` · ${amt(qty,price)}`;
  // 이탈 전 보유: 고른 단위로 저장한 값이 있으면 그 값, 다른 단위로 저장돼 있으면 빈칸에 환산값을 흐리게 보여 준다
  const holdValue=inQty?qtyIn||"":amount?shown(amount):"", holdPlaceholder=inQty?(amount&&low>0?`≈${won.format(shares)}주`:"예: 500"):(qtyIn&&low>0?`≈${manwon(qtyIn*low/10000)}`:"예: 1000");
  const holdHint=(amount&&low>0?`${manwon(amount)} ÷ 신저점 ${money(low)} ≈ ${won.format(shares)}주로 계산합니다.`:qtyIn?`보유 수량 ${won.format(qtyIn)}주로 계산합니다.`:amount?"신저점 가격을 넣으면 보유 금액을 신저점 가격으로 나눈 주 수(정수)로 계산합니다.":"보유 금액(만원)을 넣으면 신저점 가격으로 나눈 주 수(정수)로, 수량(주)을 넣으면 그 주 수로 손절 수량을 계산합니다.")
    +(inQty&&amount?" 주 수를 넣으면 수량 기준으로 바뀝니다.":!inQty&&qtyIn?" 금액을 넣으면 금액 기준으로 바뀝니다.":"");
  const next=!ready?"신저점 가격과 이탈 전 보유 금액(또는 수량)을 입력하면 손절 회차가 계산됩니다."
    :firstDue?`<b>기한 도달</b> · ${s.lots.filter(l=>l.due).map(l=>money(l.price)).join("·")}에 판 분량의 손절가에 다시 왔습니다 · <b>${ni>=0?`${esc(s.stages[ni].name)} 단계로 지금 약 ${wonShort(s.plan[ni])}`:`지금 약 ${wonShort(s.dueValue)}`} 재매수</b>${ni>=0?"":" (단계 편집으로 단계를 추가하세요)"}`
    :complete?`재매수 완료 · 손절 ${money(s.sellValue)} → 재매수 ${money(s.buyValue)} (${won.format(s.sold)}주 → ${won.format(s.rebought)}주)`
    :!s.started?`다음 손절 <b>${nextCut?`${nextCut.k}회 · ${money(nextCut.price)} 이하에서 ${won.format(nextCut.qty)}주${approx(nextCut.qty,nextCut.price)}`:"없음"}</b>${s.sold?` · ${esc(first)} 반등 신호가 나오면 재매수 시작 <b>약 ${wonShort(s.plan[0]??0)}</b>${nextLot?` · 기한 ${money(nextLot.price)} 전`:""}`:""}`
    :ni>=0?`다음 재매수 <b>${esc(s.stages[ni].name)} 신호 시 약 ${wonShort(s.plan[ni])}</b>${nextLot?` · 가장 가까운 기한 ${money(nextLot.price)}`:""} · 손절은 멈춤`
    :`모든 단계를 체크했지만 약 ${wonShort(s.rest)}이 남았습니다 · 단계 편집으로 단계를 추가하세요`;
  const cutRow=c=>{const due=!c.done&&cur>0&&cur<=c.price;return `<div class="sale-row ${c.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-cut="${c.k-1}" ${c.done?"checked":""}>${c.k}회</label><div class="stage-price"><span class="price">${money(c.price)}</span><span class="krw">신저점 −${shown(c.drop)}%</span></div><div class="shares">${c.done?`<span class="exec-fields"><input class="qty" data-cut-qty="${c.k-1}" type="number" min="0" step="1" value="${c.qty}" aria-label="${c.k}회 손절 수량">주 <input data-cut-price="${c.k-1}" type="number" min="0" step="any" value="${opt(c.execPrice)}" placeholder="체결가" aria-label="${c.k}회 체결가">원</span>`:`<span>${won.format(c.qty)}주</span><div class="sub">${amt(c.qty,c.price)}<span class="hide-mobile">${amt(c.qty,c.price)&&" · "}남은 약 ${won.format(c.left)}주</span></div>`}</div><div class="status ${c.done?"done":due?"due":""}">${c.done?"손절 완료":due?"손절 시점":"대기"}</div></div>`;};
  const cutRows=!ready&&!s.doneCuts?"<div class='empty'>기준 입력에 신저점 가격과 이탈 전 보유 금액(또는 수량)을 넣으세요.</div>":(s.started?s.cuts.filter(c=>c.done):s.cuts).map(cutRow).join("")+(s.started?`<div class="stop-note">재매수를 시작해 남은 손절 회차는 멈췄습니다. 재매수 체크를 모두 풀면 다시 보입니다.</div>`:"");
  const stageRow=(x,i)=>{const px=Number(x.price)||0, nextUp=!x.done&&i===ni&&s.rest>0, overdue=nextUp&&!!firstDue, due=overdue||(!x.done&&s.plan[i]>0&&cur>0&&px>0&&cur>=px), est=px||s.est[i]||cur, plan=s.plan[i];
    return `<div class="sale-row ${x.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-stage-done="${i}" ${x.done?"checked":""}>${esc(x.name)}</label><div class="stage-price"><span class="exec-fields">${x.done?`체결 <input data-stage-exec="${i}" type="number" min="0" step="any" value="${opt(x.execPrice)}" placeholder="체결가" aria-label="${esc(x.name)} 체결가">원`:`기준 <input data-stage-price="${i}" type="number" min="0" step="any" value="${opt(px)}" placeholder="${s.est[i]?`≈${won.format(Math.round(s.est[i]))}`:"선택"}" aria-label="${esc(x.name)} 기준가">원${autoTag(x.name)}`}</span></div><div class="shares">${x.done?`<span class="exec-fields"><input class="qty" data-stage-qty="${i}" type="number" min="0" step="1" value="${wholeShares(x.shares)}" aria-label="${esc(x.name)} 재매수 수량">주</span><div class="sub">${amt(1,plan)}</div>`:!s.sold?"손절 후 계산":plan>0?`<span>약 ${wonShort(plan)}</span><div class="sub">${est?`약 ${won.format(Math.max(1,Math.round(plan/est)))}주`:"현재가 넣으면 수량"}</div>`:"—"}</div><div class="status ${x.done?"done":due||nextUp?"due":""}">${x.done?"매수 완료":overdue?"기한 도달":due?"재매수 시점":nextUp?"다음 신호":"대기"}</div></div>`;};
  const lotRow=l=>`<div class="sale-row ${l.open?"":"done"} ${l.due?"due":""}"><div class="check">${l.k}회 손절분</div><div class="stage-price"><span class="price">${money(l.price)}</span>${l.due?`<span class="krw due-tag">기한 도달</span>`:`<span class="krw">이 가격 오기 전</span>`}</div><div class="shares"><span>약 ${wonShort(l.amount)}</span><div class="sub">${l.open?`남은 약 ${wonShort(l.left)}`:"재매수 완료"}</div>${l.open&&l.stages.length?`<div class="sub">${esc(s.stages[l.stages[0]].name)}${l.stages.length>1?`~${esc(s.stages[l.stages.at(-1)].name)}`:""}에서</div>`:""}</div><div class="status ${l.open?l.due?"due":"":"done"}">${!l.open?"재매수 완료":l.due?"기한 도달":l.covered>0?"일부 재매수":"대기"}</div></div>`;
  $("rebuyMain").innerHTML=`<div class="heading"><div><div class="eyebrow">손절 후 재매수${ticker?` · ${esc(ticker)}`:""}${rp?` · ${priceStamp(rp)}`:""}</div><div class="title-row"><h1>${esc(title)}</h1><button class="btn icon-btn" id="rEdit" type="button" aria-label="종목 이름·코드 수정" title="종목 이름·코드 수정">${PENCIL}</button></div><p>신저점 이탈 뒤 ${shown(step)}% 내려갈 때마다 남은 수량의 ${shown(sellPct)}%씩 손절하고, ${esc(first)}부터 ${esc(lastName)}까지 손절한 금액만큼 나눠 되삽니다. 손절한 분량마다 판 가격보다 싸게 살 수 있는 단계에 나누고, 판 가격에 다시 오기 전까지 모두 되삽니다.</p></div><button class="btn" id="rSave">변경 저장</button></div><div class="card progress-line">${next}</div>${rp?priceWarning(rp,esc(title)):""}
    <div class="metrics card"><div class="metric"><label>현재 상태</label><strong>${esc(status)}</strong><small>${ready?`현재 보유 약 ${won.format(s.held)}주 · 이탈 전 ${amount?manwon(amount):`${won.format(shares)}주`}${fromLow!=null?` · 신저점 대비 ${fromLow>0?"+":""}${fromLow.toFixed(1)}%`:""}`:"기준 입력에 신저점·보유 금액(또는 수량)을 넣으세요"}</small></div><div class="metric"><label>손절</label><strong>${won.format(s.sold)}주</strong><small>${s.doneCuts}회${s.sellValue?` · ${money(s.sellValue)}`:""} · 평균 ${s.sellAvg?money(s.sellAvg):"—"}</small></div><div class="metric"><label>재매수 (금액)</label><strong>${decimal.format(s.buyValue/10000)} / ${decimal.format(s.sellValue/10000)}만원</strong><small>${won.format(s.rebought)}주 (판 ${won.format(s.sold)}주) · 평균 ${s.buyAvg?money(s.buyAvg):"—"}${s.buyAvg&&s.sellAvg?` · 손절 평균 대비 ${s.buyAvg>s.sellAvg?"+":""}${((s.buyAvg/s.sellAvg-1)*100).toFixed(1)}%`:""}</small></div></div>
    <div class="control-grid"><section class="card panel"><h2>기준 입력</h2><p>가격은 국내 상장 ETF 가격(원)입니다. 현재가는 선택 — 넣으면 도달한 손절 회차와 재매수 기한을 표시합니다. 종목 이름 옆 연필에서 종목 코드를 넣으면 현재가·일선 기준가를 시세로 자동으로 채웁니다.</p><div class="inline-fields"><label class="field"><span>현재가 (원)${autoTag()}</span><input id="rCurrent" type="number" min="0" step="any" value="${opt(cur)}" placeholder="선택"></label><label class="field"><span>신저점 가격 (원)</span><input id="rLow" type="number" min="0" step="any" value="${opt(low)}"></label><label class="field"><span>이탈 전 보유</span><div class="hold-input"><input id="rHold" type="number" min="0" step="${inQty?1:"any"}" value="${holdValue}" placeholder="${holdPlaceholder}" aria-label="이탈 전 보유 ${inQty?"수량(주)":"금액(만원)"}"><select id="rHoldUnit" aria-label="보유 입력 단위"><option value="amount"${inQty?"":" selected"}>만원</option><option value="shares"${inQty?" selected":""}>주</option></select></div></label><label class="field"><span>${esc(lastName)} 가격 (원)${lastStage?autoTag(lastName):""}</span><input id="rFinal" type="number" min="0" step="any" value="${opt(finalPrice)}" placeholder="재매수 단계 계산용"></label></div><p class="hint" style="margin:10px 0 0">${holdHint}${priceHint?`<br>${priceHint}`:""}</p></section><section class="card panel"><h2>손절 규칙</h2><p>신저점 대비 ${shown(step)}% 내려갈 때마다 그때 남은 수량의 ${shown(sellPct)}%를 팝니다. 재매수를 체크하면 남은 손절은 멈춥니다.</p><div class="inline-fields"><label class="field"><span>하락 간격 (%)</span><input id="rStep" type="number" min="0.1" max="50" step="0.1" value="${shown(step)}"></label><label class="field"><span>회당 손절 (남은 수량의 %)</span><input id="rSell" type="number" min="0.1" max="100" step="0.1" value="${shown(sellPct)}"></label><label class="field"><span>표시 회차</span><input id="rSteps" type="number" min="1" max="60" step="1" value="${Math.floor(Number(r.steps)||30)}"></label></div></section></div>
    <div class="section-heading"><h2>1. 신저점 이탈 손절</h2><span>${s.doneCuts}회 · ${won.format(s.sold)}주 손절</span></div><section class="card table-card"><div class="table-head"><span>회차</span><span>손절가</span><span>손절 수량 · 금액</span><span>상태</span></div><div>${cutRows}</div></section>
    <div class="section-heading"><h2>2. 단계별 재매수</h2><span>${s.doneStages} / ${s.stages.length}단계 · ${finalPrice?`${esc(lastName)} ${money(finalPrice)}까지 · 비운 기준가는 추정`:`기준 입력에 ${esc(lastName)} 가격을 넣으면 단계별로 나눕니다`}</span><button class="btn mini" id="rStages" type="button">단계 편집</button></div><section class="card table-card stage-table"><div class="table-head"><span>단계</span><span>기준가(비우면 추정) · 체결가</span><span>재매수 금액 · 수량</span><span>상태</span></div><div>${s.stages.map(stageRow).join("")}</div></section>
    ${s.lots.length?`<div class="section-heading"><h2>3. 재매수 기한</h2><span>손절한 분량마다 판 가격에 다시 오기 전까지 · 낮은 손절가부터 채움</span></div><section class="card table-card"><div class="table-head"><span>손절분</span><span>기한 (판 가격)</span><span>손절 금액 · 남은 금액</span><span>상태</span></div><div>${s.lots.map(lotRow).join("")}</div></section>`:""}
    <div class="reset-row"><button class="btn ghost mini" id="rReset" type="button" ${s.doneCuts||s.doneStages?"":"disabled"}>체크 기록 초기화</button></div>
    <section class="card panel memo" style="margin-top:16px"><div class="memo-head"><h2>메모</h2><span id="rNoteCount">${memoCount(r.note)}</span></div><textarea id="rNote" maxlength="4000" style="min-height:100px">${esc(r.note||"")}</textarea></section>
    <p class="footnote">체크는 기록용입니다. 실제 주문은 증권사에서 직접 실행하세요. 체크하면 손절가·예정 수량이 먼저 기록되니 실제 체결가·수량으로 고치세요. 재매수 기한은 현재가를 넣어야 알 수 있습니다. 수량은 정수 주로 나누며 수수료·세금은 빼지 않았습니다.</p>`;
  const setField=(id,key,parse)=>onEdit("#"+id,v=>{v=parse(v.trim());if(v===undefined)return false;editRebuy()[key]=v;},renderRebuy);
  const nonNeg=v=>v===""?0:Number(v)>=0?Number(v):undefined;
  $("rEdit").onclick=()=>openRebuyDialog(r);
  setField("rCurrent","currentPrice",nonNeg);setField("rLow","lowPrice",nonNeg);
  onEdit("#rHold",v=>{if(setHold(editRebuy(),unit,v.trim())===false)return false;rebuyUnit=unit;},renderRebuy);
  $("rHoldUnit").onchange=e=>{rebuyUnit=e.target.value==="shares"?"shares":"amount";renderRebuy();$("rHold").focus();}; // 단위만 바꿈(값은 새로 넣을 때 바뀜)
  onEdit("#rFinal",v=>{v=nonNeg(v.trim());if(v===undefined)return false;const st=editRebuy().stages;if(!st.length)return false;st[st.length-1].price=v;},renderRebuy);
  setField("rStep","stepPct",v=>Number(v)>0&&Number(v)<=50?Number(v):undefined);setField("rSell","sellPct",v=>Number(v)>0&&Number(v)<=100?Number(v):undefined);setField("rSteps","steps",v=>Number(v)>=1&&Number(v)<=60?Math.floor(Number(v)):undefined);
  $$("[data-cut]").forEach(input=>input.onchange=()=>{const i=Number(input.dataset.cut),r=editRebuy();
    if(input.checked){const c=cutPlan(r)[i];while(r.cuts.length<i)r.cuts.push(null);r.cuts[i]={shares:c.qty,price:Math.round(c.price)};}
    else{r.cuts[i]=null;while(r.cuts.length&&!r.cuts[r.cuts.length-1])r.cuts.pop();}
    save();renderRebuy();});
  onEdit("[data-cut-qty]",(v,el)=>{v=v.trim();const rec=editRebuy().cuts[Number(el.dataset.cutQty)];if(!rec||v===""||!(Number(v)>=0))return false;rec.shares=Math.floor(Number(v));},renderRebuy);
  onEdit("[data-cut-price]",(v,el)=>{const rec=editRebuy().cuts[Number(el.dataset.cutPrice)];if(!rec)return false;rec.price=Number(v)>0?Number(v):null;},renderRebuy);
  $$("[data-stage-done]").forEach(input=>input.onchange=()=>{const i=Number(input.dataset.stageDone);
    if(input.checked){const src=r,view=rebuySummary(src),px=Number(view.stages[i].price)>0?Number(view.stages[i].price):Number(src.currentPrice)>0?Number(src.currentPrice):Math.round(view.est[i]||0);
      if(!(view.sold>0)){alert("손절한 수량이 없습니다. 먼저 손절 회차를 체크하세요.");input.checked=false;return;}
      if(!(view.plan[i]>0)){alert("손절한 금액을 모두 재매수했습니다.");input.checked=false;return;}
      if(!(px>0)){alert("현재가(또는 이 단계의 기준가)를 먼저 넣으세요. 그 가격으로 재매수 수량을 계산합니다.");input.checked=false;return;}
      const r=editRebuy();Object.assign(r.stages[i],{done:true,shares:Math.max(1,Math.round(view.plan[i]/px)),execPrice:px});}
    else Object.assign(editRebuy().stages[i],{done:false,shares:null,execPrice:null});
    save();renderRebuy();});
  onEdit("[data-stage-price]",(v,el)=>{v=nonNeg(v.trim());if(v===undefined)return false;editRebuy().stages[Number(el.dataset.stagePrice)].price=v;},renderRebuy);
  onEdit("[data-stage-exec]",(v,el)=>{v=Number(v);if(!(v>0))return false;editRebuy().stages[Number(el.dataset.stageExec)].execPrice=v;},renderRebuy);
  onEdit("[data-stage-qty]",(v,el)=>{v=v.trim();if(v===""||!(Number(v)>=0))return false;editRebuy().stages[Number(el.dataset.stageQty)].shares=Math.floor(Number(v));},renderRebuy);
  $("rStages").onclick=()=>{const list=s.stages,text=prompt("재매수 단계를 짧은 봉부터 쉼표로 구분해 적으세요.\n마지막 단계 가격은 기준 입력에서 넣습니다.",list.map(x=>x.name).join(", "));
    if(text==null)return;const names=[...new Set(text.split(/[,，]/).map(x=>x.trim().slice(0,20)).filter(Boolean))].slice(0,12);
    if(!names.length){alert("단계를 하나 이상 적어 주세요.");return;}
    const lost=list.filter(x=>x.done&&!names.includes(x.name));if(lost.length){alert(`재매수를 체크한 단계(${lost.map(x=>x.name).join(", ")})는 뺄 수 없습니다. 먼저 체크를 푸세요.`);return;}
    const r=editRebuy();r.stages=names.map(name=>r.stages.find(x=>x.name===name)||{name,price:0,done:false,execPrice:null,shares:null});save();renderRebuy();};
  $("rReset").onclick=()=>{if(!confirm(`${title} 손절·재매수 체크 기록을 모두 지울까요?\n신저점·보유 금액(수량)·규칙·단계·메모는 남깁니다.`))return;const r=editRebuy();r.cuts=[];r.stages.forEach(x=>Object.assign(x,{done:false,shares:null,execPrice:null}));save();renderRebuy();};
  const note=$("rNote");note.oninput=()=>$("rNoteCount").textContent=memoCount(note.value);
  onEdit("#rNote",v=>{editRebuy().note=v;});
  $("rSave").onclick=()=>{if(note.value!==(r.note||""))editRebuy().note=note.value;save();renderRebuy();};
}
