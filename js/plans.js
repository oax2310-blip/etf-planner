// 분할매도: 저장된 계획 목록·계획 화면·계획 입력/수정 창
const sharesAt = (shares, stage, stages) => Math.ceil((stage + 1) * shares / stages) - Math.ceil(stage * shares / stages);
const stagePrice = (plan, stage) => plan.startPrice - (plan.startPrice - plan.endPrice) * stage / Math.max(plan.stages - 1, 1);
const defaultPlan = (ticker, title, opts) => ({id:id(), ticker, title, currency:"USD", holdings:[], startLabel:"60일선", endLabel:"25개월선", startPrice:100, endPrice:80, stages:30, checked:Array(30).fill(false), valueKrw:null, basisPrice:null, fx:1354.91, asOf:"", note:"", ...opts});
function selected(){ return state.plans.find(p=>p.id===state.selectedPlan) || state.plans[0] || null; }
// 모바일 표 이름 말줄임: CSS 말줄임은 잘린 뒤 남는 여백이 '…' 오른쪽에 생겨 끝이 안 맞는다. 칸에 들어가는 만큼 글자를 잘라 '…'를 붙여
// 오른쪽 끝(수량·'매도량')에 붙인다. 같은 폭은 한 번만 계산. CSS text-overflow는 예비로 둔다.
function fitNames(){
  const range=document.createRange();
  for(const sel of [".one-sub",".m-head b"]){
    const els=[...$$(`#planMain ${sel}`)], memo=new Map();
    els.forEach(e=>e.textContent=e.dataset.full??=e.textContent);
    els.map(e=>[e,e.getBoundingClientRect().width,e.scrollWidth>e.clientWidth]).forEach(([e,box,over])=>{
      if(!box||!over) return;
      const key=Math.round(box*10);
      if(!memo.has(key)){
        const full=e.dataset.full, cut=m=>full.slice(0,m).trimEnd()+"…", fits=t=>{e.textContent=t;range.selectNodeContents(e);return range.getBoundingClientRect().width<=box-.5;};
        let lo=0,hi=full.length-1; while(lo<hi){const m=(lo+hi+1)>>1; if(fits(cut(m)))lo=m; else hi=m-1;}
        memo.set(key,cut(lo));
      }
      e.textContent=memo.get(key);
    });
  }
}
addEventListener("resize",fitNames);
// 저장된 계획 카드: 카드 이름(cardName)을 굵게, 없으면 종목 코드. PC에서만 아래 작게 — 카드 이름이 있으면 종목 코드, 없으면 계획 이름.
// 카드 이름은 이름만 고치는 작은 창(nameDialog)으로도 바꾼다: 터치는 카드를 0.5초 누르고 있으면(손 떼기 전에) 열리고, 마우스(PC)는 카드 오른쪽 아래 연필(.plan-rename).
// 수정 창의 카드 이름 칸과 같은 값(비우면 cardName을 지워 종목 코드로). 카드가 button이라 연필은 바깥(.plan-cell)에 둔다.
function renderPlans(){
  const list=$("planList"), pencil='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  list.innerHTML=state.plans.length?state.plans.map(p=>{const n=p.checked.filter(Boolean).length, ticker=String(p.ticker||"").trim(), card=String(p.cardName||"").trim(), [main,sub]=card?[card,ticker]:[ticker,String(p.title||"").trim()];
    return `<div class="plan-cell"><button class="plan-item ${p.id===state.selectedPlan?"active":""}" data-plan="${esc(p.id)}" title="${esc(main)}${sub&&sub!==main?` (${esc(sub)})`:""} · ${n} / ${p.stages}회 완료"><span class="plan-row"><strong>${esc(main)}</strong><span class="plan-count">${n}/${p.stages}<span class="plan-unit">회</span></span></span><span class="plan-title">${sub&&sub!==main?esc(sub):""}</span><span class="plan-bar"><i style="width:${Math.round(n/Math.max(p.stages,1)*100)}%"></i></span></button><button class="plan-rename" type="button" data-rename="${esc(p.id)}" aria-label="${esc(main)} 카드 이름 변경" title="카드 이름 변경">${pencil}</button></div>`;}).join(""):"<div class='empty'>계획 없음</div>";
  list.querySelectorAll("[data-plan]").forEach(b=>{b.onclick=()=>{state.selectedPlan=b.dataset.plan;save();renderPlans();};
    // 길게 누르기(터치만): 0.5초 또는 안드로이드 길게 누르기 메뉴(contextmenu) 중 먼저 오는 때에 이름 창을 연다. 10px 넘게 움직이면(스크롤) 취소.
    // 창을 연 뒤 손을 뗄 때의 클릭·움직임은 막는다(창 바깥을 누른 것으로 처리되거나 화면이 밀리지 않게).
    let timer=0,opened=false,x=0,y=0; const stop=()=>{clearTimeout(timer);timer=0;}, open=()=>{stop();opened=true;openNameDialog(b.dataset.plan);};
    b.ontouchstart=e=>{({clientX:x,clientY:y}=e.touches[0]);opened=false;timer=setTimeout(open,500);};
    b.ontouchmove=e=>{const t=e.touches[0];if(opened){if(e.cancelable)e.preventDefault();}else if(timer&&Math.hypot(t.clientX-x,t.clientY-y)>10)stop();};
    b.ontouchcancel=stop;
    b.ontouchend=e=>{stop();if(opened){opened=false;e.preventDefault();}};
    b.oncontextmenu=e=>{if(timer){e.preventDefault();open();}else if(opened)e.preventDefault();};
  });
  list.querySelectorAll("[data-rename]").forEach(b=>b.onclick=()=>openNameDialog(b.dataset.rename));
  const p=selected(); const main=$("planMain");
  if(!p){main.innerHTML="<div class='card empty'><h2>분할매도 계획을 추가하세요</h2></div>";return;}
  const done=p.checked.filter(Boolean).length, shares=p.holdings.reduce((s,h)=>s+Number(h.shares||0),0), gap=(p.startPrice-p.endPrice)/Math.max(p.stages-1,1);
  const status=done===p.stages?"전량 매도 완료":done?"진행 중":"시작 전"; // 1회라도 체크하면 시작
  const startText=p.currency==="USD"&&Number.isInteger(Math.round(p.startPrice*1e6)/1e4)?Number(p.startPrice).toFixed(2):String(p.startPrice); // 달러는 소수 둘째 자리까지면 $80.00처럼
  const oneName=esc(p.holdings.length===1?p.holdings[0].name:!p.holdings.length&&p.valueKrw!=null?p.title:""); // 종목이 하나(또는 평가액만 입력)면 모바일 표는 머리줄·줄마다 작은 글씨로 이름
  const pe=stockEntry(priceData,p.ticker), px=pe&&pe.kind===(p.currency==="KRW"?"국내":"해외")?pe:null; // 시세 파일(통화가 맞을 때만): 기준일은 제목 위에 작게, 현재 가격은 설명 줄에
  const fxe=futuresEntry(priceData,state.futures), fxAuto=fxe&&p.auto?.fx===p.fx?`달러선물 ${priceMonth(state.futures)} 종가(시세 ${fxe.asOf})로 자동 · `:""; // 달러 계획 환율(prices.js)
  const value = p.valueKrw!=null ? `₩${won.format(p.valueKrw)}만원` : shares?`${won.format(shares)}주 보유`:"보유 수량 미입력";
  main.innerHTML=`<div class="heading plan-heading"><div><div class="eyebrow">${esc(p.ticker)} · ${px?priceStamp(px):esc(p.asOf||"기준일 미입력")}</div><div class="title-row"><h1>${esc(p.title)}</h1><button class="btn icon-btn" id="editPlan" type="button" aria-label="계획 수정" title="계획 수정">${pencil}</button></div><p>${esc(p.startLabel)} 이탈 후 ${esc(p.endLabel)}까지 ${p.stages}회 분할매도${px&&Number(px.close)>0?` · <span class="nowrap">현재 ${priceText(Number(px.close),p.currency)}</span>`:""}</p></div></div>${px?priceWarning(px,esc(p.ticker)):""}
    <div class="metrics card"><div class="metric"><label>현재 계획 상태</label><strong>${esc(status)}</strong><small>${done} / ${p.stages}회 완료 · ${value}</small></div><div class="metric"><label for="startPrice">첫 매도 기준가</label><label class="metric-edit" title="눌러서 수정">${p.currency==="USD"?"$":""}<input id="startPrice" type="number" min="0" step="any" inputmode="decimal" value="${esc(startText)}">${p.currency==="USD"?"":"원"}${pencil}</label><small>${p.currency==="USD"?`${fxText(p.startPrice*p.fx)} · <label class="metric-edit fx-edit" title="${esc(fxAuto)}환율 — 눌러서 수정">환율 <input id="planFx" type="number" min="0" step="any" inputmode="decimal" aria-label="달러/원 환율" value="${esc(String(p.fx))}">${pencil}</label>`:""}</small></div><div class="metric"><label>마지막 매도 기준가</label><strong>${priceText(p.endPrice,p.currency)}</strong><small>${p.currency==="USD"?fxText(p.endPrice*p.fx):""}</small></div></div>
    <div class="control-grid"><section class="card panel"><h2>계산 요약</h2><p>주수는 정수로 균등 분배하며, 평가액만 입력한 계획은 회차별 금액으로 표시합니다.</p><div class="inline-fields"><div><div class="sub">회차당 가격 하락폭</div><strong>${priceText(gap,p.currency)}</strong></div><div><div class="sub">예상 1회 주문 비중</div><strong>${p.stages?decimal.format(100/p.stages):"—"}%</strong></div></div></section><section class="card panel memo"><div class="memo-head"><h2>메모</h2><span id="memoCount" class="memo-count">${memoCount(p.note)}</span><button class="btn mini" id="saveNote">저장</button></div><textarea id="planNote" maxlength="4000" rows="3" aria-label="메모">${esc(p.note||"")}</textarea></section></div>
    <div class="section-heading"><h2>분할매도 체크</h2><span>${done} / ${p.stages}회 완료</span></div><section class="card table-card"><div class="m-head"><span>회차 · 기준가</span><span>${oneName?`<b>${oneName}</b>`:""}<span>${!oneName?"예상 매도량":p.holdings.length?"매도량":"매도액"}</span></span></div><div class="table-head"><span>회차</span><span>기준가</span><span>예상 매도량</span><span>상태</span></div><div>${Array.from({length:p.stages},(_,i)=>{const price=stagePrice(p,i), checked=p.checked[i];const amount=p.valueKrw!=null?`약 ${decimal.format(p.valueKrw/p.stages)}만원`:"";const qty=([...p.holdings.map(h=>`<span class="${oneName?"one-name":""}">${esc(h.name)} </span>${sharesAt(h.shares,i,p.stages)}주`),amount].filter(Boolean).map(x=>`<span>${x}</span>`).join(" · ")||"보유량 입력 필요")+(oneName?`<small class="one-sub">${oneName}</small>`:"");return `<div class="sale-row ${checked?"done":""}"><label class="check"><input type="checkbox" data-stage="${i}" ${checked?"checked":""}>${i+1}회</label><div class="stage-price"><span class="price">${priceText(price,p.currency)}</span>${p.currency==="USD"?`<span class="krw">${fxText(price*p.fx)}</span>`:""}</div><div class="shares">${qty}</div><div class="status ${checked?"done":""}">${checked?"매도 완료":"대기"}</div></div>`;}).join("")}</div></section><p class="footnote">체크는 기록용입니다. 실제 주문은 증권사에서 직접 실행하세요. 기기 간 동기화를 연결하면 다른 기기에도 반영됩니다.</p>`;
  // 첫 매도 기준가·환율(달러 계획)은 카드 숫자에서 바로 수정: 폭은 글자 수에 맞추고, Enter·칸 벗어나면 저장, Esc는 취소. 0 이하·빈 값은 무시(다시 그려 원래 값).
  const inlineEdit=(id,text,key)=>{const el=$(id);if(!el)return;const fit=()=>el.style.width=`${Math.max(3,el.value.length-(el.value.split(".").length-1)*.6)+.4}ch`; fit(); el.oninput=fit;
    el.onkeydown=e=>{if(e.key==="Enter")el.blur();if(e.key==="Escape"){el.value=text;fit();el.blur();}};
    onEdit("#"+id,v=>{v=Number(v);if(!(v>0)||v===p[key])return false;p[key]=v;},renderPlans);};
  inlineEdit("startPrice",startText,"startPrice"); inlineEdit("planFx",String(p.fx),"fx");
  const note=$("planNote"); note.oninput=()=>$("memoCount").textContent=memoCount(note.value); $("saveNote").onclick=()=>{p.note=note.value;save();renderPlans();};
  onEdit("[data-stage]",(v,el)=>{p.checked[Number(el.dataset.stage)]=el.checked;},renderPlans);
  $("editPlan").onclick=()=>openPlanDialog(p);
  fitNames();
}
const planDialog=$("planDialog"); let editingId=null;
function openPlanDialog(p){editingId=p?.id||null; const form=$("planForm");form.reset();$("dialogTitle").textContent=p?`${p.ticker} 계획 수정`:"새 분할매도 계획";$("deletePlanBtn").classList.toggle("hidden",!p);if(p){for(const [k,v] of Object.entries({ticker:p.ticker,title:p.title,cardName:p.cardName??"",currency:p.currency,startLabel:p.startLabel,endLabel:p.endLabel,startPrice:p.startPrice,endPrice:p.endPrice,stages:p.stages,valueKrw:p.valueKrw??"",basisPrice:p.basisPrice??"",fx:p.fx,asOf:p.asOf||""})){if(form.elements[k])form.elements[k].value=v;}form.elements.shares.value=p.holdings[0]?.shares||"";}planDialog.showModal();}
$("addPlanBtn").onclick=()=>openPlanDialog();
$("deletePlanBtn").onclick=()=>{const p=state.plans.find(x=>x.id===editingId);if(!p||!confirm(`${p.ticker} 계획을 삭제할까요?`))return;state.plans=state.plans.filter(x=>x.id!==p.id);state.selectedPlan=state.plans[0]?.id||null;save();planDialog.close();render();};
planDialog.querySelectorAll("[data-close-plan]").forEach(b=>b.onclick=()=>planDialog.close());
const nameDialog=$("nameDialog"); let namingId=null; // 카드 이름만 고치는 창(규칙은 renderPlans 위 주석)
function openNameDialog(pid){const p=state.plans.find(x=>x.id===pid);if(!p||nameDialog.open)return;namingId=pid;const input=$("nameForm").elements.cardName;$("nameTitle").textContent=`${p.ticker} 카드 이름`;input.value=p.cardName??"";input.placeholder=String(p.ticker||"").trim();nameDialog.showModal();input.focus();input.select();}
nameDialog.querySelector("[data-close-name]").onclick=()=>nameDialog.close();
$("nameForm").addEventListener("submit",e=>{e.preventDefault();const p=state.plans.find(x=>x.id===namingId),v=String(e.target.elements.cardName.value).trim();nameDialog.close();if(!p||v===String(p.cardName||"").trim())return;if(v)p.cardName=v;else delete p.cardName;save();renderPlans();});
$("planForm").addEventListener("submit",e=>{e.preventDefault();const f=new FormData(e.target), val=k=>String(f.get(k)||"").trim();const ticker=val("ticker").toUpperCase(), stages=Math.max(2,Math.min(250,Number(val("stages"))||30)), old=editingId?state.plans.find(p=>p.id===editingId):null;const shares=Number(val("shares")), currency=val("currency")==="KRW"?"KRW":"USD", moved=old&&(old.ticker!==ticker||old.startLabel!==val("startLabel")||old.endLabel!==val("endLabel")||old.currency!==currency);const p=old||defaultPlan(ticker,val("title"),{});Object.assign(p,{ticker,title:val("title"),currency,startLabel:val("startLabel"),endLabel:val("endLabel"),startPrice:Number(val("startPrice")),endPrice:Number(val("endPrice")),stages,valueKrw:val("valueKrw")===""?null:Number(val("valueKrw")),basisPrice:val("basisPrice")===""?null:Number(val("basisPrice")),fx:Number(val("fx"))||1354.91,asOf:val("asOf"),holdings:Number.isSafeInteger(shares)&&shares>0?[{name:val("title"),shares}]:[],checked:Array.from({length:stages},(_,i)=>old?.checked?.[i]===true),note:old?.note||""});const cardName=val("cardName");if(cardName)p.cardName=cardName;else delete p.cardName;if(moved)delete p.auto;if(!old)state.plans.push(p);state.selectedPlan=p.id;save();planDialog.close();render();});
