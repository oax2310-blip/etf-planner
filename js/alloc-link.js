// 플래너 체결의 자산 배분 연결 화면·계좌 선택·결과 알림. 계산은 assets-calc.js, 기록·동기화는 assetStore.
// 기능 규칙은 해당 함수 주석, 공통 작업 규칙은 AGENTS.md.
const allocLink = (()=>{
const allocOf=()=>assetStore.doc?.allocation||null;
const nf1=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}), nf2=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}), nf8=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
const man=v=>`${nf1.format(Math.round((Number(v)||0)*10)/10)}만원`, pc=v=>`${(Math.abs(v)<1?nf2:nf1).format(v)}%`;
const qty=(n,it)=>`${nf8.format(n)}${linkStep(it)<1?" BTC":"주"}`;
const sign=d=>d<0?"−":"+";
function summary(ticker, ownId=null){const a=allocOf();return a?linkSummary(a,assetStore.prices,ticker,ownId):null;}
// 계획 화면 한 줄: 현재 비중(연결 종목 합계) / 목표 비중 · 목표 도달(±0.5만원)·목표까지·목표 초과 금액. 분할매수 줄(purchases.js purchaseHeading)과 같은 글자이며 계좌별 금액은 title로만 보인다. 연결 종목이 없으면 빈 글자.
// 목표는 자산 배분 목표(linkSummary — 분할매수와 같은 규칙)를 그릴 때마다 읽으며, 자산 배분이 바뀌면 분할매도·재매수 화면이 다시 그린다(assetStore.subscribe).
function line(ticker, ownId=null){
  const s=summary(ticker,ownId);if(!s)return "";
  const names=s.rows.map(r=>`${r.it.name} ${man(r.value)}`).join("\n");
  const target=s.target!==null?` / 목표 ${pc(s.target)}${{group:" (그룹)",section:" (소분류)"}[s.scope]||""}`:" · 목표 미입력";
  const gap=s.gap===null?"":Math.abs(s.gap)<.5?" · 목표 도달":s.gap>0?` · 목표까지 ${man(s.gap)}`:` · 목표 초과 ${man(-s.gap)}`;
  return `<p class="alloc-link" title="${esc(names)}"><span>현재 ${pc(s.pct)}${target}${gap}</span></p>`;
}
// 보유량 가져오기: linkSummary의 같은 거래 단위 수량 합(shares) 또는 평가액 합(value, 만원)과 설명(text). 연결 종목이 없으면 null.
function holding(ticker){
  const s=summary(ticker);if(!s)return null;
  const who=s.rows.length>1?`${s.rows.length}개 계좌`:s.rows[0].it.name;
  return {shares:s.shares,value:Math.round(s.value*10)/10,fx:s.fx,text:`${who} ${s.shares!==null?qty(s.shares,s.rows[0].it):man(s.value)}`};
}
// ---------- 알림 줄 ----------
let toastEl=null,toastTimer=0;
function toast(text){
  if(!toastEl){toastEl=document.createElement("div");toastEl.className="link-toast";toastEl.setAttribute("role","status");document.body.append(toastEl);}
  toastEl.textContent=text;toastEl.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove("show"),4500);
}
// 반영 기록 설명: 종목 이름 + 바꾼 양(금액 종목은 지금 평가액 기준으로 환산). 셋 이상이면 개수만.
function describe(rec){
  const a=allocOf(), s=a?allocationSummary(a,assetStore.prices):null, list=(rec?.items||[]).map(e=>{
    const it=allocItemById(a,e.id);if(!it)return null;
    if(finite(e.shares)!==null)return `${it.name} ${sign(e.shares)}${qty(Math.abs(e.shares),it)}`;
    const v=s?.items.get(it.id)?.value||0, amt=finite(it.amount)||0, eq=Math.abs(e.amount)*(amt>0&&v>0?v/amt:1);
    return `${it.name} ${sign(e.amount)}${man(eq)}`;
  }).filter(Boolean);
  return list.length>2?`${list.length}개 계좌`:list.join(" · ");
}
function apply(key, o, picks){
  const a=allocOf();if(!a)return;
  const had=!!a.trades?.[key], rec=applyTrade(a,assetStore.prices,key,{...o.trade,ticker:o.ticker},o.label,picks);
  if(rec||had)assetStore.saveSection("allocation");
  if(rec)toast(`자산 배분 반영 · ${describe(rec)}`);
}
// ---------- 계좌 고르는 창 ----------
let pending=null; // 창에서 고르는 중인 체크 {o, rows}
const dialog=()=>$("linkDialog");
// 처음 고른 계좌: 같은 출처(prefer 키 앞부분 순서)의 가장 최근 반영 계좌 → 계획이 붙은 종목(ownId) → 지금 평가액이 가장 큰 계좌
// by = 고른 근거(맞은 prefer 순번, 'own', 'value'). 재매수 화면의 손절·재매수 계좌 줄(account)도 같은 결과를 보인다.
function preferredPick(rows, o){
  const trades=Object.entries(allocOf()?.trades||{});
  for(const [by,prefix] of (o.prefer||[]).entries()){
    const hit=trades.filter(([k,t])=>k.startsWith(prefix)&&Array.isArray(t?.items)).sort((x,y)=>String(y[1].at).localeCompare(String(x[1].at)))[0];
    const r=hit&&rows.filter(r=>hit[1].items.some(e=>e.id===r.it.id)).sort((x,y)=>y.value-x.value)[0];if(r)return {row:r,by};
  }
  const own=rows.find(r=>r.it.id===o.ownId);
  return own?{row:own,by:"own"}:{row:[...rows].sort((x,y)=>y.value-x.value)[0],by:"value"};
}
const preferred=(rows,o)=>preferredPick(rows,o).row;
// 체크하면 계좌 고르는 창이 먼저 고를 계좌(o = check의 {ticker, ownId?, prefer?}): {g, it, value(만원), by, count(연결 계좌 수)}. 연결 종목이 없으면 null. 읽기만 한다.
function account(o){
  const s=summary(o?.ticker,o?.ownId);if(!s)return null;
  const {row,by}=preferredPick(s.rows,o);return {g:row.g,it:row.it,value:row.value,by,count:s.rows.length};
}
// 체크한 회차를 반영한 자산 항목들 [{g, it, shares?, amount?}](지금 없는 항목은 뺌). 반영 기록이 없으면(반영 안 함·연동 전 체크) 빈 배열, 자산 배분이 없으면 null.
function reflected(key){
  const a=allocOf();if(!a)return null;
  const rec=a.trades?.[key];if(!Array.isArray(rec?.items))return [];
  const where=new Map((a.groups||[]).flatMap(g=>(g.items||[]).map(it=>[it.id,{g,it}])));
  return rec.items.map(e=>where.has(e?.id)?{...where.get(e.id),shares:finite(e.shares),amount:finite(e.amount)}:null).filter(Boolean);
}
function openDialog(o, rows){
  const d=dialog(), first=preferred(rows,o), buy=o.trade.sign>0, t=o.trade, rate=t.currency==="USD"?(summary(o.ticker,o.ownId)?.fx||0):1;
  const value=finite(t.value)??(finite(t.qty)&&finite(t.price)&&rate?t.qty*t.price*rate/1e4:null);
  pending={o,rows};
  $("linkWhat").textContent=[typeof movingLineText==="function"?movingLineText(o.label):o.label,finite(t.qty)?qty(t.qty,rows[0].it):"",value?`약 ${man(value)}`:""].filter(Boolean).join(" · ");
  $("linkHint").textContent=`어느 계좌에서 ${buy?"샀":"팔았"}나요? 계좌 이름을 누르면 그 계좌로 모두 반영합니다. 여러 계좌로 나눴으면 칸을 고치세요(주식은 주, 금액 종목은 지금 평가액 기준 만원).`;
  $("linkRows").innerHTML=rows.map((r,i)=>{const it=r.it, own=finite(it.shares)!==null?qty(finite(it.shares),it):"", n=r===first&&r.n!==null?r.n:"";
    return `<div class="link-row${n!==""?" picked":""}"><button type="button" class="link-pick" data-link-pick="${i}"><strong>${esc(it.name)}</strong><small>${[r.g.name,man(r.value),own].filter(Boolean).map(esc).join(" · ")}</small></button>
      <label class="link-n"><span aria-hidden="true">${buy?"+":"−"}</span><input type="number" min="0" step="${r.unit==="shares"?r.step<1?"any":"1":"any"}" inputmode="decimal" data-link-n="${i}" value="${n}" aria-label="${esc(it.name)} ${buy?"매수":"매도"} ${r.unit==="shares"?"수량":"금액(만원)"}"><span>${r.unit==="shares"?r.step<1?"BTC":"주":"만원"}</span></label></div>`;}).join("");
  const inputs=[...$$("[data-link-n]")], mark=()=>inputs.forEach(x=>x.closest(".link-row").classList.toggle("picked",Number(x.value)>0));
  $$("[data-link-pick]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.linkPick), r=rows[i];inputs.forEach((x,j)=>{x.value=j===i&&r.n!==null?r.n:"";});mark();if(r.n===null)inputs[i].focus();});
  inputs.forEach(x=>x.oninput=mark);
  if(!d.open)d.showModal();
}
// 창 닫기: picks가 배열이면(반영·반영 안 함) 체크(commit)하고 고른 계좌에 반영(빈 배열이면 체크만), null이면(취소·닫기·Esc) 체크하지 않고 다시 그린다.
function finish(picks){
  const p=pending;pending=null;dialog().close();if(!p)return;
  if(picks){const key=p.o.commit();if(key&&picks.length)apply(key,p.o,picks);}
  p.o.redraw?.();
}
function initialize(){
  const d=dialog();if(!d)return;
  $("linkForm").addEventListener("submit",e=>{e.preventDefault();if(!pending)return;
    const picks=[...$$("[data-link-n]")].map(x=>{const r=pending.rows[Number(x.dataset.linkN)], n=Number(x.value);return r&&n>0?{id:r.it.id,unit:r.unit,n}:null;}).filter(Boolean);
    finish(picks);});
  $("linkSkip").onclick=()=>finish([]);
  d.querySelectorAll("[data-close-link]").forEach(b=>b.onclick=()=>finish(null));
  d.addEventListener("close",()=>{if(pending)finish(null);});
}
// ---------- 출처 화면이 부르는 함수 ----------
// 체크: o = {ticker, ownId?, targetId?, trade(assets-calc.js 체결), label, prefer?: [반영 키 앞부분…], commit: () => 출처 키(체크를 저장한 뒤) 또는 false, redraw}
// 연결 종목이 없으면 체크만, 하나면 바로 반영, 여럿이거나 반영량을 계산할 수 없으면 linkDialog에서 계좌·양을 고른다.
// 통합 매도의 picks는 지정한 계좌별 누적량 그대로 반영한다. 기존 targetId는 해당 자산 항목에만 반영한다(추종 ETF 분할매수 등).
function check(o){
  if(Array.isArray(o.picks)){
    const a=allocOf();if(!a||o.picks.some(p=>!allocItemById(a,p.id)||!Number.isFinite(p.n)||p.n<0)){o.redraw?.();return;}
    const key=o.commit();if(key)apply(key,o,o.picks);o.redraw?.();return;
  }
  const a=allocOf(), size=plus(o.trade?.qty)||plus(o.trade?.value), rows=a&&size?tradeRows(a,assetStore.prices,o.ticker,o.trade,o.ownId).filter(r=>!o.targetId||r.it.id===o.targetId):[]; // 0주 회차는 체크만
  if(o.targetId&&size&&!rows.length){toast("매수를 반영할 자산 항목을 다시 확인하세요.");o.redraw?.();return;}
  if(rows.length>1||rows.length===1&&rows[0].n===null){openDialog(o,rows);return;}
  const key=o.commit();
  if(key&&rows.length)apply(key,o,[{id:rows[0].it.id,unit:rows[0].unit,n:rows[0].n}]);
  o.redraw?.();
}
// 체크를 풀었을 때(출처 기록을 저장한 뒤): 반영한 양을 되돌린다.
function uncheck(key){
  const a=allocOf(), rec=a&&revertTrade(a,key);if(!rec)return;
  assetStore.saveSection("allocation");toast(`자산 배분 되돌림 · ${rec.items.map(e=>allocItemById(a,e.id)?.name).filter(Boolean).slice(0,2).join(" · ")||rec.label}`);
}
// 체크 기록을 한꺼번에 지울 때(재매수 체크 기록 초기화 — 출처 기록을 저장한 뒤): 반영한 것이 있으면 되돌릴지 묻는다. 되돌리지 않으면 반영 기록만 지운다(자산 배분은 그대로).
function forget(keys, label){
  const a=allocOf(), hit=(keys||[]).filter(k=>a?.trades?.[k]);if(!hit.length)return;
  if(confirm(`자산 배분에 반영한 ${label} ${hit.length}건도 되돌릴까요?\n취소하면 자산 배분 보유량은 지금 그대로 둡니다.`)){hit.forEach(k=>revertTrade(a,k));toast(`자산 배분 되돌림 · ${hit.length}건`);}
  else{hit.forEach(k=>delete a.trades[k]);if(!Object.keys(a.trades).length)delete a.trades;}
  assetStore.saveSection("allocation");
}
// 체크 뒤 체결 수량·가격·금액을 고쳤을 때(trade = 새 {qty, price, value}): 반영한 양을 같은 비율로 맞춘다.
function rescale(key, trade){
  const a=allocOf();if(!a?.trades?.[key])return;
  const before=JSON.stringify(a.trades[key]), rec=rescaleTrade(a,key,trade);
  if(JSON.stringify(a.trades[key])!==before)assetStore.saveSection("allocation");
  if(rec)toast(`자산 배분도 맞춤 · ${describe(rec)}`);
}
// 분할매수 기록 회차의 수량을 고치거나 취소할 때(출처 기록을 저장한 뒤): 바뀐 양만 지금 매수 1순위 계좌(targetId)에 더하거나 뺀다(이어 사기·되팔기 모두 1순위 기준).
// 처음 반영한 계좌는 그대로 두고, 반영 기록 items에는 계좌별로 실제 더한 양을 합쳐 둔다. 뺄 보유량이 모자라면 0까지만 빼고 알린다.
// o = {key, ticker(회차 실제 코드), targetId, trade: 바뀐 양 {sign, qty, price, value, currency}, total: 새 누적 {qty, value}}. total이 0이면 기록을 지운다.
// 반영 기록이 없으면(처음에 '반영 안 함') 자산 배분은 그대로 둔다.
function shift(o){
  const a=allocOf(), rec=a?.trades?.[o.key];if(!rec)return;
  const it=allocItemById(a,o.targetId), row=it&&(plus(o.trade?.qty)||plus(o.trade?.value))?tradeRows(a,assetStore.prices,o.ticker,o.trade,o.targetId).find(r=>r.it.id===it.id):null;
  const dir=o.trade?.sign<0?-1:1, items=Array.isArray(rec.items)?rec.items:[];let done=0,short=false,field="shares";
  if(row?.n){
    field=row.unit==="shares"?"shares":"amount";const step=field==="shares"?row.step:0.01, s=field==="amount"?allocationSummary(a,assetStore.prices):null;
    const was=finite(it.amount)||0, v=s?.items.get(it.id)?.value||0, want=field==="shares"?row.n:row.n*(was>0&&v>0?was/v:1);
    const fresh=finite(it[field])===null;done=bumpField(it,field,dir*want,step);short=Math.abs(done)+step/2<want;
    if(done&&field==="amount"&&!(was>0)&&finite(it.shares)===null)resetBase(it,assetStore.prices,a);
    const e=done&&items.find(x=>x?.id===it.id&&finite(x[field])!==null&&!x.converted);
    if(e){e[field]=linkRound(e[field]+done,step);delete e.exact;if(e.fresh&&field==="shares"&&!(finite(it.shares)>0))delete it.shares;}else if(done)items.push({id:it.id,[field]:done,...(fresh&&field==="shares"?{fresh:true}:{})});
    rec.items=items.filter(x=>finite(x?.shares)||finite(x?.amount)||finite(x?.exact)); // 0이 됐어도 반올림 전 양(exact, rescaleTrade)이 남은 계좌는 둔다
  }
  if(!plus(o.total?.qty)&&!plus(o.total?.value)){delete a.trades[o.key];if(!Object.keys(a.trades).length)delete a.trades;}
  else Object.assign(rec,{qty:plus(o.total.qty),value:plus(o.total.value)});
  assetStore.saveSection("allocation");
  if(done)toast(`자산 배분도 맞춤 · ${describe({items:[{id:it.id,[field]:done}]})}${short?" · 보유량이 모자라 일부만 뺐습니다":""}`);
  else if(row?.n&&dir<0)toast(`자산 배분 · ${it.name} 보유량이 없어 빼지 못했습니다`);
}
return {line,holding,account,reflected,check,uncheck,forget,rescale,shift,initialize};
})();
