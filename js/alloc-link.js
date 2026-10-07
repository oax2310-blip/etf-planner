// 플래너 체크 → 자산 배분 보유량 연동(분할매도·재매수·분할매수 공통): 계획 화면의 '자산 배분' 줄, 보유량 가져오기 값, 체크할 때 계좌를 고르는 창(linkDialog)과 결과 알림 줄.
// 계산·반영 기록 규칙은 assets-calc.js '플래너 체결 → 자산 배분 연동' 주석. 자산 기록은 assetStore(분할매수·자산 현황과 같은 기록·동기화)의 allocation 구역에 저장한다.
// 체크: 연결 종목이 없으면 지금처럼 체크만, 하나면 바로 반영, 여럿(같은 종목 코드의 여러 계좌)이거나 양을 계산할 수 없으면 창에서 계좌·양을 고른다.
// 창의 '반영 안 함'은 체크만 하고 자산 배분은 그대로, '취소'·닫기는 체크하지 않는다. 체크를 풀면 반영한 양을 그대로 되돌린다(창 없음).
const allocLink = (()=>{
const allocOf=()=>assetStore.doc?.allocation||null;
const nf1=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}), nf2=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}), nf8=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
const man=v=>`${nf1.format(Math.round((Number(v)||0)*10)/10)}만원`, pc=v=>`${(Math.abs(v)<1?nf2:nf1).format(v)}%`;
const qty=(n,it)=>`${nf8.format(n)}${linkStep(it)<1?" BTC":"주"}`;
const sign=d=>d<0?"−":"+";
function summary(ticker, ownId=null){const a=allocOf();return a?linkSummary(a,assetStore.prices,ticker,ownId):null;}
// 계획 화면 한 줄: 자산 배분 · 계좌(여럿이면 개수) 평가액 · 현재 비중 / 목표 비중 · 목표까지·목표 초과 금액. 연결 종목이 없으면 빈 글자.
function line(ticker, ownId=null){
  const s=summary(ticker,ownId);if(!s)return "";
  const who=s.rows.length>1?`${s.rows.length}개 계좌`:esc(s.rows[0].it.name), names=s.rows.map(r=>`${r.it.name} ${man(r.value)}`).join("\n");
  const target=s.target!==null?` / 목표 ${pc(s.target)}${s.scope==="group"?" (그룹)":""}`:" · 목표 미입력";
  const gap=s.gap===null?"":Math.abs(s.gap)<.5?" · 목표 도달":s.gap>0?` · 목표까지 ${man(s.gap)}`:` · 목표 초과 ${man(-s.gap)}`;
  return `<p class="alloc-link" title="${esc(names)}"><b>자산 배분</b> <span>${who} ${man(s.value)} · 현재 ${pc(s.pct)}${target}${gap}</span></p>`;
}
// 보유량 가져오기: 연결 종목이 모두 보유 수량이면 수량 합(shares), 아니면 평가액 합(value, 만원). 설명 글자(text) 포함. 연결 종목이 없으면 null.
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
    if(finite(e.shares))return `${it.name} ${sign(e.shares)}${qty(Math.abs(e.shares),it)}`;
    const v=s?.items.get(it.id)?.value||0, amt=finite(it.amount)||0, eq=Math.abs(e.amount)*(amt>0&&v>0?v/amt:1);
    return `${it.name} ${sign(e.amount)}${man(eq)}`;
  }).filter(Boolean);
  return list.length>2?`${list.length}개 계좌`:list.join(" · ");
}
function apply(key, o, picks){
  const a=allocOf();if(!a)return;
  const had=!!a.trades?.[key], rec=applyTrade(a,assetStore.prices,key,o.trade,o.label,picks);
  if(rec||had)assetStore.saveSection("allocation");
  if(rec)toast(`자산 배분 반영 · ${describe(rec)}`);
}
// ---------- 계좌 고르는 창 ----------
let pending=null; // 창에서 고르는 중인 체크 {o, rows}
const dialog=()=>$("linkDialog");
// 처음 고른 계좌: 같은 출처(prefer 키 앞부분 순서)의 가장 최근 반영 계좌 → 계획이 붙은 종목(ownId) → 지금 평가액이 가장 큰 계좌
function preferred(rows, o){
  const trades=Object.entries(allocOf()?.trades||{});
  for(const prefix of o.prefer||[]){
    const hit=trades.filter(([k,t])=>k.startsWith(prefix)&&Array.isArray(t?.items)).sort((x,y)=>String(y[1].at).localeCompare(String(x[1].at)))[0];
    const r=hit&&rows.filter(r=>hit[1].items.some(e=>e.id===r.it.id)).sort((x,y)=>y.value-x.value)[0];if(r)return r;
  }
  return rows.find(r=>r.it.id===o.ownId)||[...rows].sort((x,y)=>y.value-x.value)[0];
}
function openDialog(o, rows){
  const d=dialog(), first=preferred(rows,o), buy=o.trade.sign>0, t=o.trade, rate=t.currency==="USD"?(summary(o.ticker,o.ownId)?.fx||0):1;
  const value=finite(t.value)??(finite(t.qty)&&finite(t.price)&&rate?t.qty*t.price*rate/1e4:null);
  pending={o,rows};
  $("linkWhat").textContent=[o.label,finite(t.qty)?qty(t.qty,rows[0].it):"",value?`약 ${man(value)}`:""].filter(Boolean).join(" · ");
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
// 체크: o = {ticker, ownId?, trade(assets-calc.js 체결), label, prefer?: [반영 키 앞부분…], commit: () => 출처 키(체크를 저장한 뒤) 또는 false, redraw}
function check(o){
  const a=allocOf(), size=plus(o.trade?.qty)||plus(o.trade?.value), rows=a&&size?tradeRows(a,assetStore.prices,o.ticker,o.trade,o.ownId):[]; // 0주 회차는 체크만
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
return {line,holding,check,uncheck,forget,rescale,initialize};
})();
