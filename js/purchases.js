// 플래너의 분할매수 탭. 자산 배분의 연결 종목·목표와 기존 buyPlan 기록을 그대로 사용한다.
const purchasePlanner = (()=>{
const el=id=>document.getElementById(id), all=sel=>document.querySelectorAll(sel);
const escA=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const nf1=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}),nf2=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}),nf8=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
const man=v=>`${nf1.format(Math.round((Number(v)||0)*10)/10)}만원`;
const pc=v=>v===null||v===undefined||!Number.isFinite(Number(v))?"—":`${(Math.abs(v)<1?nf2:nf1).format(Number(v))}%`;
const PEN=PENCIL,newId=id,dlg=el;
const numIn=v=>String(v??"").trim()===""?null:finite(v);
const setNum=(obj,key,v)=>{const n=numIn(v);if(n===null)delete obj[key];else obj[key]=n;};
const setText=(obj,key,v)=>{const t=String(v??"").trim();if(t)obj[key]=t;else delete obj[key];};
let doc=assetStore.doc,prices=assetStore.prices,redrawLater=false,initialized=false;
function findItem(id){for(const g of doc.allocation?.groups||[]){const it=g.items.find(x=>x.id===id);if(it)return {g,it};}return null;}
const render=()=>renderPurchases(),saveSection=section=>assetStore.saveSection(section);
const onChange=(sel,section,set)=>all(sel).forEach(x=>x.onchange=()=>{if(set(x.value,x)!==false)saveSection(section);render();});
const emptyCard=(title,text,button)=>`<div class="card empty purchase-empty"><h2>${title}</h2><p>${text}</p>${button}</div>`;
// 회차 가격·수량(선택): 통화는 계획에 저장한 currency(달러일 때만 저장) → 종목 시세 통화 → 원화. 비트코인(BTC-USD)은 0.00000001 단위, 나머지는 1주.
const quoteOf=it=>assetQuote(prices,it?.ticker);
const planCurrency=(plan,it)=>plan?.currency||quoteOf(it)?.currency||"KRW";
const unitOf=it=>quoteOf(it)?.kind==="코인"||String(it?.ticker||"").trim().toUpperCase()==="BTC-USD"?1e-8:1;
const qtyNum=(v,it)=>(unitOf(it)<1?nf8:nf1).format(v), qtyUnit=it=>unitOf(it)<1?" BTC":"주", qtyText=(v,it)=>`${qtyNum(v,it)}${qtyUnit(it)}`;
// 옛 체결에 수량이 없으면 이미 자산 배분에 반영한 수량을 표시한다. 읽기만 할 때는 기록을 바꾸지 않는다.
const recordedShares=(key,b)=>{
  const rec=doc.allocation?.trades?.[key], qty=finite(b.shares)??finite(rec?.qty);
  if(qty!==null)return qty;
  const items=Array.isArray(rec?.items)?rec.items:[];
  return items.length&&items.every(e=>finite(e.shares)!==null)?Number(items.reduce((n,e)=>n+finite(e.shares),0).toFixed(8)):null;
};
// 이동평균선 돌파 계획의 시세: 메인 플래너가 읽은 시세 파일(sync.js priceData — 종목마다 ma 포함). 종목 코드 시장과 시세 종류가 같을 때만.
const priceDoc=()=>typeof priceData==="object"&&priceData?priceData:null;
const lineEntry=it=>{const e=stockEntry(priceDoc(),it?.ticker);return e&&e.kind===purchaseQuoteKind(it.ticker)?e:null;};
const lineMarket=it=>["국내","해외"].includes(purchaseQuoteKind(it?.ticker)); // 이동평균(일봉·60분봉)은 국내·미국 종목만 수집(비트코인 제외)
const lineKnown=(lines,e)=>purchaseLineNames(lines).filter(n=>Number(e?.ma?.[n])>0);
const rangeText=names=>names.length?`${names[0]}~${names[names.length-1]}`:"";
// 단계 묶음(창의 '단계' 선택): 재매수 기본 14단계 전체, 일봉만, 60분봉만. 저장은 lines.names(수집 작업이 이 이름으로 이동평균을 계산).
const LINE_SETS={all:PURCHASE_LINES,hour:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="선"),day:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="일선"),week:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="주선"),month:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="개월선"),legacy:PURCHASE_LINES.filter(n=>["선","일선"].includes(movingLineUnit(n)))};
const lineSetOf=names=>Object.keys(LINE_SETS).find(k=>LINE_SETS[k].join()===names.join())||"custom";
// ---------- 분할매수 ----------
// 계획은 종목 안에 두므로 이름·목표 변경과 그룹 이동이 그대로 연결된다. 창에서 고치는 동안은 복사본만 바꾸고 저장할 때 반영한다.
// 두 방식(assets-calc.js 분할매수 주석): 이동평균선 돌파(lines — 회차는 지금 이동평균으로 계산, 산 회차는 buys[키])와 직접 입력(stages).
const purchaseItems = () => (doc.allocation?.groups||[]).flatMap(g=>(g.items||[]).map(it=>({g,it})));
function renderPurchases(){
  doc=assetStore.doc;prices=assetStore.prices;
  const view=el("buysView"), items=purchaseItems(), plans=items.filter(({it})=>it.buyPlan), fills=new Map();
  if(!items.length){view.innerHTML=emptyCard("분할매수할 종목을 추가하세요","자산 배분에서 종목을 등록하면 목표 비중과 연결해 분할매수 계획을 만들 수 있습니다.",`<button class="btn primary" id="purchaseGoAlloc" type="button">자산 배분으로</button>`);el("purchaseGoAlloc").onclick=()=>{location.href="assets.html#alloc";};return;}
  const s=allocationSummary(doc.allocation,prices), summaries=plans.map(({it})=>purchaseSummary(it.buyPlan,lineEntry(it))), totals=summaries.reduce((t,p)=>({planned:t.planned+p.planned,actual:t.actual+p.actual,remaining:t.remaining+p.remaining}),{planned:0,actual:0,remaining:0});
  const card=({g,it})=>{
    const plan=it.buyPlan, lines=plan.lines, entry=lines?lineEntry(it):null, p=purchaseSummary(plan,entry), v=s.items.get(it.id)?.value||0, t=finite(it.target);
    const status=p.count&&p.done===p.count?"매수 완료":p.done?"진행 중":"매수 전", id=escA(it.id);
    const cur=planCurrency(plan,it), q=quoteOf(it), now=q&&q.currency===cur?q.close:null, up=purchaseDirection(plan)==="up";
    const pt=v=>priceText(v,cur), kind=purchaseQuoteKind(it.ticker), alertable=!!kind&&(kind==="국내"?"KRW":"USD")===cur;
    // 회차 줄(두 방식 공통 모양): 이동평균선 돌파는 키(data-key), 직접 입력은 순번(data-stage)으로 체크·체결·알림을 저장한다.
    const rows=lines?purchaseLineRows(plan,entry).map(r=>{
      const key=`buy:${it.id}:${r.key}`, fill=r.done?null:purchaseFill(r,cur,s.fx,unitOf(it));if(fill)fills.set(key,fill);
      return {attr:`data-key="${escA(r.key)}"`,label:purchaseLineLabel(r),price:r.price,shares:r.done?recordedShares(key,purchaseBuys(plan)[r.key]):fill?.shares??null,amount:r.done?r.actual:r.amount,done:r.done,actual:r.actual,line:r,fill};})
      :(Array.isArray(plan.stages)?plan.stages:[]).map((x,i)=>({attr:`data-stage="${i}"`,label:`${i+1}차`,price:finite(x.price),shares:x.done?recordedShares(`buy:${it.id}:${x.id||`#${i}`}`,x):finite(x.shares),amount:finite(x.amount),done:!!x.done,actual:finite(x.actual)??Math.max(0,finite(x.amount)||0),stage:x}));
    const due=r=>now!==null&&!r.done&&r.price>0&&(up?now>=r.price:now<=r.price), priced=rows.some(r=>r.price>0);
    // 다음 회차: 아직 도달하지 않은 회차 중 현재가에 가장 가까운 가격(단계 순서와 가격 순서가 다를 수 있음)
    const next=now!==null?rows.filter(r=>!r.done&&r.price>0&&!due(r)).sort((a,b)=>Math.abs(a.price-now)-Math.abs(b.price-now))[0]:null, open=rows.filter(r=>!r.done);
    const gap=next?(next.price/now-1)*100:0;
    const nowText=now!==null&&priced?`현재가 ${pt(now)}<span class="price-date">${escA(q.asOf.slice(5))}</span>${next?` · 다음 ${escA(next.label)}까지 ${gap>0?"+":""}${(Math.abs(gap)<1?nf2:nf1).format(gap)}%`:""}`:"";
    const known=lines?lineKnown(lines,entry):[], missing=lines?purchaseLineNames(lines).filter(n=>!known.includes(n)):[];
    const head=lines?`<p class="purchase-ladder-line"><b>이동평균선 돌파</b> ${escA(rangeText(purchaseLineNames(lines)))} · 목표가 ${pt(lines.end)} · 총 ${man(lines.budget)}${open.length?` · 남은 ${open.length}회 회당 약 ${man(open[0].amount)}`:""}</p>
        ${!known.length?`<p class="purchase-wait">이동평균 시세를 기다리는 중입니다. 다음 수집(장중 30분마다) 뒤 단계 회차가 보이고, 그 전에는 목표가 회차만 있습니다.</p>`
          :missing.length?`<p class="purchase-wait">아직 시세가 없는 단계 ${escA(missing.join("·"))}는 건너뜁니다(60분봉 긴 선은 수집이 과거 봉을 받는 동안 며칠 걸릴 수 있음).</p>`:""}`:"";
    const alertLine=!priced?"":alertable?`<span class="trade-alert-actions"><span>알림</span><button class="btn mini ghost" type="button" data-purchase-alert-all="${id}" data-on="on">전체 ON</button><button class="btn mini ghost" type="button" data-purchase-alert-all="${id}" data-on="off">OFF</button></span>`
      :`<span class="purchase-alert-off">휴대폰 알림은 자산 배분에서 시세 종목 코드를 넣으면 켤 수 있습니다</span>`;
    const row=r=>{
      const reached=due(r), blocked=r.line&&!r.done&&!(r.shares>0);
      const main=r.line?`${pt(r.price)} · ${r.shares!==null?`${r.done?"체결":"매수"} ${qtyText(r.shares,it)}`:r.done?"체결 수량 미입력":"수량 계산 불가"}`:r.price!==null?`${pt(r.price)}${r.shares!==null?` · ${r.done?"체결":"매수"} ${qtyText(r.shares,it)}`:""}`:r.stage.condition||"조건 미입력";
      const sub=r.line?blocked?r.shares===0?`회차 예산으로 ${qtyText(unitOf(it),it)}를 살 수 없습니다.`:"환율·기준 가격을 확인하세요.":"":r.price!==null?[r.stage.condition,r.stage.date].filter(Boolean).join(" · "):r.stage.date||"날짜 미정", name=`${it.name} ${r.label}`;
      // 이동평균선 돌파 회차는 재매수처럼 단계 이름 + 회차 번호 칩(25선 [2]), 한 줄로 촘촘하게
      const tag=r.line?(r.line.key==="end"?"목표가":`${escA(r.line.line)}<span class="tr-no">${r.line.t+1}</span>`):escA(r.label);
      return `<div class="purchase-row${r.line?" line":""}${r.done?" done":reached?" due":""}"><label class="check" title="매수 완료"><input type="checkbox" ${r.line?"data-purchase-buy":"data-purchase-done"}="${id}" ${r.attr}${r.done?" checked":""}${blocked?" disabled":""} aria-label="${escA(name)} 매수 완료"><b>${tag}</b></label><div class="purchase-condition"><strong>${escA(main)}${reached?`<span class="purchase-due">도달</span>`:""}</strong>${sub?`<small>${escA(sub)}</small>`:""}</div>
        <div class="purchase-amount">${r.done?`<label>체결 수량 <input type="number" min="${unitOf(it)}" step="${unitOf(it)}" inputmode="${unitOf(it)<1?"decimal":"numeric"}" ${r.line?"data-purchase-buy-shares":"data-purchase-shares"}="${id}" ${r.attr} value="${r.shares??""}" placeholder="수량" aria-label="${escA(name)} 체결 수량 (${qtyUnit(it).trim()})"> ${qtyUnit(it).trim()}</label><label>체결 금액 <input type="number" min="0" step="any" inputmode="decimal" ${r.line?"data-purchase-buy-actual":"data-purchase-actual"}="${id}" ${r.attr} value="${r.actual}" aria-label="${escA(name)} 체결 금액 (만원)"> 만원</label>`
          :`<span>예정 ${man(r.fill?.actual??r.amount)}</span>${r.price>0&&alertable?tradeAlertToggle(purchaseAlertOn(plan,r.line||r.stage),`data-purchase-alert="${id}" ${r.attr}`,name):""}`}</div></div>`;
    };
    return `<section class="card purchase-card"><div class="purchase-head"><div class="title-row"><h2>${escA(it.name)}</h2><button class="btn icon-btn" type="button" data-purchase-edit="${id}" aria-label="${escA(it.name)} 분할매수 계획 수정" title="계획 수정">${PEN}</button></div>
      <p>${escA(g.name)} · 현재 ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)}${s.base>0&&t/100*s.base>v?` · 목표까지 ${man(t/100*s.base-v)}`:""}`:" · 목표 미입력"}</p>
      ${head}${nowText?`<p class="purchase-now">${nowText}</p>`:""}
      <div class="purchase-progress"><span class="purchase-status${p.count&&p.done===p.count?" done":""}">${status} · ${p.done}/${p.count}회</span><span>예정 ${man(p.planned)} · 체결 ${man(p.actual)} · 남은 예정 ${man(p.remaining)}</span>${alertLine}</div></div>
      ${rows.map(row).join("")}${lines?`<p class="purchase-note">매수 수량은 회차 예산과 표시 가격 기준입니다. 표시된 수량을 매수한 뒤 체크하세요. 실제 체결 수량·금액은 완료 후 고칠 수 있습니다.</p>`:""}
      ${plan.note?`<p class="purchase-note">${escA(plan.note)}</p>`:""}</section>`;
  };
  view.innerHTML=`<div class="heading"><div><div class="eyebrow">목표 비중과 연결한 매수 계획</div><h1>분할매수</h1><p>이동평균선 돌파 회차나 직접 정한 회차로 목표 비중까지 나눠 삽니다. 회차를 체크하면 자산 배분 보유량에도 더하고(같은 종목 코드 계좌가 여럿이면 고름), 체크를 풀면 되돌립니다.</p></div><button class="btn primary" id="addPurchase" type="button">＋ 계획</button></div>
    <p class="hint purchase-save-status" id="purchaseSaveStatus" role="status"></p>
    <div class="card metrics"><div class="metric"><label>총 매수 예정액</label><strong>${man(totals.planned)}</strong><small>${plans.length}개 종목 · ${summaries.filter(p=>p.count&&p.done===p.count).length}개 매수 완료</small></div><div class="metric"><label>체결 금액</label><strong>${man(totals.actual)}</strong><small>완료한 회차의 실제 금액 합계</small></div><div class="metric"><label>남은 예정액</label><strong>${man(totals.remaining)}</strong><small>아직 매수하지 않은 회차의 예정액</small></div></div>
    ${plans.length?plans.map(card).join(""):emptyCard("아직 분할매수 계획이 없습니다","종목을 고르고 목표 가격과 목표 비중을 넣으세요.","")}`;
  updateStatus();
  el("addPurchase").onclick=()=>openPurchase(null);
  all("[data-purchase-edit]").forEach(b=>b.onclick=()=>openPurchase(b.dataset.purchaseEdit));
  const planOf=id=>findItem(id)?.it.buyPlan, stageOf=x=>planOf(x.dataset.purchaseDone||x.dataset.purchaseActual||x.dataset.purchaseShares||x.dataset.purchaseAlert)?.stages?.[Number(x.dataset.stage)];
  // 회차 체크는 자산 배분 보유량과 연동(alloc-link.js). 표시한 수량을 저장·반영하고, 수량 수정은 보유량도 맞추며, 체결 금액만 수정하면 기록한 수량은 유지한다. 체크를 풀면 되돌린다.
  // 반영 키: 'buy:종목 id:회차 키(이동평균선 돌파) 또는 회차 id(직접 입력)'. 수량 없는 옛 기록은 이미 반영한 수량을 먼저 읽고, 사용자가 고칠 때만 shares에 기록한다.
  const stageKey=(id,x)=>{const stage=stageOf(x);return stage?`buy:${id}:${stage.id||`#${x.dataset.stage}`}`:"";};
  const buyTrade=(it,plan,b)=>({sign:1,qty:finite(b.shares),price:finite(b.price),currency:planCurrency(plan,it),value:finite(b.actual)});
  const keepShares=(key,b)=>{const qty=recordedShares(key,b),rec=doc.allocation?.trades?.[key];if(qty!==null){b.shares=qty;if(rec&&finite(rec.qty)===null)rec.qty=qty;}return qty;};
  const linkCheck=(x,label,b,commit)=>{const found=findItem(x.dataset.purchaseDone||x.dataset.purchaseBuy);if(!found)return render();
    allocLink.check({ticker:found.it.ticker,ownId:found.it.id,trade:buyTrade(found.it,found.it.buyPlan,b),label:`${found.it.name} ${label}`,prefer:[`buy:${found.it.id}:`],redraw:render,
      commit:()=>{const key=commit();if(!key)return false;saveSection("allocation");return key;}});};
  // 직접 입력 회차: 체크하면 체결 금액을 예정액으로 채운다(고칠 수 있음).
  all("[data-purchase-done]").forEach(x=>x.onchange=()=>{const id=x.dataset.purchaseDone, i=Number(x.dataset.stage), stage=stageOf(x), key=stageKey(id,x);if(!stage)return render();
    if(!x.checked){delete stage.done;saveSection("allocation");allocLink.uncheck(key);return render();}
    const actual=finite(stage.actual)??Math.max(0,finite(stage.amount)||0);
    linkCheck(x,`분할매수 ${i+1}차`,{shares:stage.shares,price:stage.price,actual},()=>{const s=planOf(id)?.stages?.[i];if(!s)return false;s.done=true;if(finite(s.actual)===null)s.actual=actual;return key;});});
  onChange("[data-purchase-actual]","allocation",(v,x)=>{const stage=stageOf(x),n=numIn(v),found=findItem(x.dataset.purchaseActual);if(!stage||n!==null&&n<0)return false;
    const key=stageKey(found.it.id,x),qty=keepShares(key,stage);setNum(stage,"actual",v);
    allocLink.rescale(key,{qty,price:finite(stage.price),value:finite(stage.actual)??finite(stage.amount)});});
  // 이동평균선 돌파 회차: 화면에 표시한 수량·가격과 그 수량의 금액을 buys[키]에 기록. 남은 예산은 남은 회차에 다시 나누고, 체크를 풀면 지운다.
  all("[data-purchase-buy]").forEach(x=>x.onchange=()=>{const id=x.dataset.purchaseBuy, found=findItem(id), plan=found?.it.buyPlan, key=x.dataset.key;if(!plan?.lines)return render();
    if(!x.checked){const buys={...purchaseBuys(plan)};delete buys[key];if(Object.keys(buys).length)plan.buys=buys;else delete plan.buys;saveSection("allocation");allocLink.uncheck(`buy:${id}:${key}`);return render();}
    const r=purchaseLineRows(plan,lineEntry(found.it)).find(r=>r.key===key&&!r.done);if(!r)return render();
    const fill=fills.get(`buy:${id}:${key}`);if(!(fill?.shares>0))return render();const b={...fill};
    linkCheck(x,`분할매수 ${purchaseLineLabel(r)}`,b,()=>{const p=planOf(id);if(!p?.lines||purchaseBuys(p)[key])return false;p.buys={...purchaseBuys(p),[key]:b};return `buy:${id}:${key}`;});});
  onChange("[data-purchase-buy-actual]","allocation",(v,x)=>{const id=x.dataset.purchaseBuyActual, b=purchaseBuys(planOf(id))[x.dataset.key],n=numIn(v);if(!b||n===null||n<0)return false;
    const key=`buy:${id}:${x.dataset.key}`,qty=keepShares(key,b);b.actual=n;
    allocLink.rescale(key,{qty,price:finite(b.price),value:n});});
  onChange("[data-purchase-shares], [data-purchase-buy-shares]","allocation",(v,x)=>{
    const id=x.dataset.purchaseShares||x.dataset.purchaseBuyShares,found=findItem(id),plan=found?.it.buyPlan,b=x.dataset.key!==undefined?purchaseBuys(plan)[x.dataset.key]:stageOf(x),n=numIn(v);
    if(!found||!b||!(n>0)||(unitOf(found.it)===1?!Number.isSafeInteger(n):Number(n.toFixed(8))!==n))return false;
    const key=x.dataset.key!==undefined?`buy:${id}:${x.dataset.key}`:stageKey(id,x),old=keepShares(key,b),rate=planCurrency(plan,found.it)==="USD"?assetFx(prices,doc.allocation):1,actual=finite(b.actual)??finite(b.amount);
    const value=old>0&&actual!==null?actual*n/old:finite(b.price)>0&&rate?n*b.price*rate/1e4:null;
    b.shares=n;if(value!==null)b.actual=Number(value.toFixed(8));
    allocLink.rescale(key,buyTrade(found.it,plan,b));
  });
  // 알림 ON/OFF는 누를 때만 저장(직접 입력은 회차 notify, 이동평균선 돌파는 notify.keys[키], 전체는 계획 notify.stages — 새 회차도 따라감). 규칙은 assets-calc.js purchaseAlertRules.
  onChange("[data-purchase-alert]","allocation",(_,x)=>{const plan=planOf(x.dataset.purchaseAlert);if(!plan)return false;
    if(x.dataset.key!==undefined){const n=plan.notify&&typeof plan.notify==="object"?plan.notify:(plan.notify={});n.keys={...(n.keys&&typeof n.keys==="object"?n.keys:{}),[x.dataset.key]:x.checked};}
    else{const stage=stageOf(x);if(!stage)return false;stage.notify=x.checked;}});
  all("[data-purchase-alert-all]").forEach(b=>b.onclick=()=>{const plan=planOf(b.dataset.purchaseAlertAll);if(!plan)return;
    const n={...(plan.notify&&typeof plan.notify==="object"?plan.notify:{}),stages:b.dataset.on==="on"};delete n.keys;plan.notify=n;(plan.stages||[]).forEach(x=>delete x.notify);saveSection("allocation");render();});
}
// ---------- 계획 창 ----------
// 종목은 검색 목록에서 고른다(이름·그룹·소분류·종목 코드, 띄어 쓴 낱말이 모두 들어간 종목). 이미 계획이 있는 종목을 고르면 그 계획을 연다. 수정할 때는 종목 고정.
// 방식은 이동평균선 돌파(기본)·직접 입력. 체결 기록이 있는 방식에서는 다른 방식으로 바꾸지 않는다.
let purchaseDraft=null,editing=null,budgetAuto=true;
const form=()=>el("purchaseForm"), pickedItem=()=>findItem(form().item.value), mode=()=>form().mode.value;
const draftCurrency=()=>{const it=pickedItem()?.it;return purchaseDraft?.currency||quoteOf(it)?.currency||form().manualCurrency.value||"KRW";};
function itemInfo({g,it},s){
  const v=s.items.get(it.id)?.value||0,t=finite(it.target);
  return [g.name,it.section,it.ticker,`현재 ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)}`:""}`].filter(Boolean).map(escA).join(" · ");
}
function renderPicker(){
  const s=allocationSummary(doc.allocation,prices), picked=pickedItem(), box=el("purchasePicked");
  box.hidden=!picked;el("purchaseSearchBox").hidden=!!picked;
  if(picked){
    box.innerHTML=`<div><strong>${escA(picked.it.name)}</strong><small>${itemInfo(picked,s)}</small></div>${editing?"":`<button class="btn mini" type="button" id="purchaseRepick">변경</button>`}`;
    if(!editing)el("purchaseRepick").onclick=()=>{form().item.value="";renderDraft();el("purchaseSearch").focus();};
    return;
  }
  const query=el("purchaseSearch").value.trim(), terms=query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows=purchaseItems().filter(({g,it})=>{const hay=[it.name,g.name,it.section,it.ticker].filter(Boolean).join(" ").toLowerCase();return terms.every(w=>hay.includes(w));});
  el("purchaseItemList").innerHTML=rows.length?rows.map(r=>`<button type="button" role="option" aria-selected="false" class="purchase-opt" data-pick="${escA(r.it.id)}"><span><strong>${escA(r.it.name)}</strong><small>${itemInfo(r,s)}</small></span>${r.it.buyPlan?`<em>계획 있음</em>`:""}</button>`).join("")
    :`<p class="purchase-none">${query?`‘${escA(query)}’에 맞는 종목이 없습니다.`:"자산 배분에 종목이 없습니다."}</p>`;
  all("[data-pick]").forEach(b=>b.onclick=()=>pickPurchaseItem(b.dataset.pick));
}
function pickPurchaseItem(itemId){
  const found=findItem(itemId);if(!found)return;
  if(found.it.buyPlan){openPurchase(itemId);return;}
  form().item.value=itemId;if(quoteOf(found.it))delete purchaseDraft.currency; // 시세가 있으면 그 통화(전에 고른 종목의 직접 선택은 버림)
  budgetAuto=true;renderDraft();
}
const renderDraft=()=>{renderPicker();renderLines();renderPurchaseDraft();};
// 이동평균선 돌파 설정: 총 매수 금액 = 목표 비중(비우면 종목 목표) × 기준 총자산 − 지금 평가액 + 이미 체결한 금액(매수한 수량을 자산 배분 보유량에 반영했다고 보고).
// 새 계획·목표 비중을 고치면 자동으로 채우고, 직접 고친 금액은 그대로 둔다('다시 계산'으로 되돌림). 미리보기 회차는 assets-calc.js purchaseLineRows(지금 이동평균).
function linesDraft(){
  const f=form(), it=pickedItem()?.it, own=numIn(f.lineTarget.value);
  return {names:LINE_SETS[f.lineSet.value]||purchaseLineNames(purchaseDraft.lines),end:numIn(f.lineEnd.value),budget:numIn(f.lineBudget.value),...(own!==null?{target:own}:{})};
}
function renderLines(){
  const f=form(), picked=pickedItem(), it=picked?.it, q=quoteOf(it), cur=quoteOf(it)?.currency||"KRW", lines=mode()==="lines";
  el("purchaseLines").hidden=!lines;el("purchaseManual").hidden=lines;
  el("manualCurrencyField").hidden=!picked||!!q;
  all("[data-line-cur]").forEach(x=>x.textContent=cur==="USD"?"$":"원");
  const box=el("lineResult"), list=el("linePreview"), hint=t=>`<p class="hint">${t}</p>`;list.innerHTML="";
  el("lineEndNote").textContent=q?`현재가 ${priceText(q.close,cur)} · ${q.asOf.slice(5)}`:"";
  f.lineTarget.placeholder=finite(it?.target)!==null?`${it.target} (종목 목표)`:"예: 3";
  if(!lines)return;
  if(!picked){box.innerHTML=hint("종목을 먼저 고르세요.");return;}
  if(!lineMarket(it)){box.innerHTML=`<p class="ladder-error">이동평균선 돌파는 국내·미국 시세 종목 코드가 있는 종목만 쓸 수 있습니다(수집 작업이 그 종목의 일봉·60분봉 이동평균을 계산). 자산 배분에서 종목 코드를 넣거나 직접 입력을 고르세요.</p>`;return;}
  const s=allocationSummary(doc.allocation,prices), own=numIn(f.lineTarget.value), target=own??finite(it.target), value=s.items.get(it.id)?.value||0;
  const spent=Object.values(purchaseBuys(purchaseDraft)).reduce((n,b)=>n+Math.max(0,finite(b?.actual)||0),0), goal=target!==null?target/100*s.base:null;
  const auto=goal!==null?Math.round((Math.max(0,goal-value)+spent)*10)/10:null;
  if(budgetAuto&&auto!==null)f.lineBudget.value=auto;
  el("lineBudgetNote").textContent=goal===null?"매수 목표 비중을 넣으면 계산합니다":`목표 ${pc(target)} ${man(goal)} − 지금 보유 ${man(value)}${spent?` + 체결 ${man(spent)}`:""} = ${man(auto)}${numIn(f.lineBudget.value)!==auto?" · 직접 고친 금액":""}`;
  const draft=linesDraft(), entry=lineEntry(it), rows=purchaseLineRows({lines:draft,buys:purchaseDraft.buys},entry), open=rows.filter(r=>!r.done), known=lineKnown(draft,entry);
  const out=[];
  if(!(draft.end>0))out.push(`<span class="ladder-error">목표 가격을 넣으세요.</span>`);
  else if(!(draft.budget>0))out.push(`<span class="ladder-error">${goal!==null&&goal<=value?"지금 평가액이 목표 이상이라 더 살 금액이 없습니다.":"총 매수 금액을 넣으세요."}</span>`);
  else{
    const rate=cur==="USD"?s.fx:1, now=q&&q.currency===cur?q.close:null;
    out.push(`<b>${open.length}회</b>${open.length?` · 회당 약 <b>${man(open[0].amount)}</b>${cur==="USD"&&rate?` <small>(약 ${priceText(open[0].amount*1e4/rate,"USD")})</small>`:""}`:""}${spent?` · 체결 ${man(spent)}`:""}`);
    if(!known.length)out.push(`<small>${escA(it.ticker)}의 이동평균 시세가 아직 없습니다. 저장하면 다음 수집(장중 30분마다)부터 일봉·60분봉 이동평균을 받아 단계 회차가 채워지고(60분봉 긴 선은 며칠), 그 전에는 목표가 회차만 있습니다.</small>`);
    list.innerHTML=rows.map(r=>`<span class="${r.done?"done":now!==null&&now>=r.price?"due":""}"><b>${escA(purchaseLineLabel(r))}</b> ${r.price?priceText(r.price,cur):""}${r.done?" · 체결":""}</span>`).join("");
  }
  box.innerHTML=out.map(l=>`<p>${l}</p>`).join("");
}
function renderPurchaseDraft(){
  const stages=purchaseDraft.stages||[], it=pickedItem()?.it, cur=draftCurrency(), unit=unitOf(it);
  el("purchaseStageRows").innerHTML=stages.map((stage,i)=>`<div class="purchase-stage${stage.done?" done":""}"><b>${i+1}차${stage.done?`<small>매수 완료</small>`:""}</b>
    <label>매수 가격 (${cur==="USD"?"$":"원"})<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="price" data-stage="${i}" value="${finite(stage.price)??""}"></label>
    <label>수량 (${qtyUnit(it).trim()})<input type="number" min="0" step="${unit<1?"any":"1"}" inputmode="decimal" data-purchase-field="shares" data-stage="${i}" value="${finite(stage.shares)??""}"></label>
    <label>예정액 (만원)<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="amount" data-stage="${i}" value="${finite(stage.amount)??""}"></label>
    <button class="btn mini ghost" type="button" data-purchase-remove="${i}" aria-label="${i+1}차 회차 삭제">삭제</button>
    <label class="date-field">매수 예정일<input type="date" data-purchase-field="date" data-stage="${i}" value="${escA(stage.date||"")}"></label>
    <label class="condition-field">매수 조건<input maxlength="100" placeholder="예: 기준가 도달" data-purchase-field="condition" data-stage="${i}" value="${escA(stage.condition||"")}"></label>
    ${stage.done?`<label class="actual-field">체결액 (만원)<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="actual" data-stage="${i}" value="${finite(stage.actual)??""}"></label>`:""}</div>`).join("");
  // 가격·수량을 고치면 예정액 = 가격 × 수량(달러는 × 지금 환율)으로 맞춘다. 예정액만 따로 고쳐도 된다.
  all("[data-purchase-field]").forEach(x=>x.oninput=()=>{const i=Number(x.dataset.stage),stage=stages[i],key=x.dataset.purchaseField;
    if(["amount","actual","price","shares"].includes(key))setNum(stage,key,x.value);else setText(stage,key,x.value);
    const rate=draftCurrency()==="USD"?assetFx(prices,doc.allocation):1;
    if((key==="price"||key==="shares")&&finite(stage.price)!==null&&finite(stage.shares)!==null&&rate){stage.amount=Math.round(stage.price*stage.shares*rate/100)/100;const a=el("purchaseStageRows").querySelector(`[data-purchase-field=amount][data-stage="${i}"]`);if(a)a.value=stage.amount;}
  });
  all("[data-purchase-remove]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.purchaseRemove);if(stages[i].done&&!confirm(`${i+1}차의 완료 기록과 체결 금액도 삭제할까요?`))return;stages.splice(i,1);renderPurchaseDraft();});
}
function openPurchase(id){
  const found=id?findItem(id):null,f=form(),d=dlg("purchaseDialog");
  if(!found&&purchaseItems().every(({it})=>it.buyPlan)){alert("모든 종목에 분할매수 계획이 있습니다. 종목 이름 옆 연필로 기존 계획을 수정하세요.");return;}
  editing=found;
  el("purchaseTitle").textContent=found?"분할매수 계획 수정":"새 분할매수 계획";
  f.item.value=found?.it.id||"";el("purchaseSearch").value="";
  purchaseDraft=found?.it.buyPlan?JSON.parse(JSON.stringify(found.it.buyPlan)):{};
  const lines=purchaseDraft.lines;
  if(!Array.isArray(purchaseDraft.stages))purchaseDraft.stages=lines?[]:Array.from({length:3},()=>({id:newId()}));
  f.mode.value=lines||!found?"lines":"manual";
  f.lineSet.value=lineSetOf(purchaseLineNames(lines));f.lineTarget.value=finite(lines?.target)??"";f.lineEnd.value=finite(lines?.end)??"";f.lineBudget.value=finite(lines?.budget)??"";budgetAuto=!lines;
  f.manualCurrency.value=purchaseDraft.currency||"KRW";
  f.note.value=purchaseDraft.note||"";renderDraft();
  el("addPurchaseStage").onclick=()=>{purchaseDraft.stages.push({id:newId()});renderPurchaseDraft();};
  el("purchaseDelete").hidden=!found;
  el("purchaseDelete").onclick=()=>{if(!confirm(`'${found.it.name}' 분할매수 계획과 체결 기록을 삭제할까요?`))return;delete found.it.buyPlan;saveSection("allocation");d.close();render();};
  f.onsubmit=e=>{e.preventDefault();const item=pickedItem()?.it;if(!item){alert("분할매수할 종목을 고르세요.");el("purchaseSearch").focus();return;}
    const draft=purchaseDraft;
    if(mode()==="lines"){
      const kind=purchaseQuoteKind(item.ticker),l=linesDraft();
      if(!lineMarket(item)){alert("이동평균선 돌파는 자산 배분에서 국내·미국 시세 종목 코드를 넣은 종목만 쓸 수 있습니다.");return;}
      if(!(l.end>0)){alert("목표 가격을 넣으세요.");f.lineEnd.focus();return;}
      if(!(l.budget>0)){alert("총 매수 금액을 넣으세요(목표 비중을 넣으면 계산합니다).");f.lineBudget.focus();return;}
      draft.lines=l;delete draft.stages;delete draft.ladder;
      if(kind!=="국내")draft.currency="USD";else delete draft.currency;
    }else{
      if(!draft.stages.length){alert("매수 회차를 하나 이상 추가하세요.");return;}
      delete draft.lines;delete draft.buys;delete draft.ladder;if(draft.notify){delete draft.notify.keys;if(!Object.keys(draft.notify).length)delete draft.notify;}
      if(draftCurrency()==="USD"&&draft.stages.some(x=>finite(x.price)!==null))draft.currency="USD";else delete draft.currency;
    }
    setText(draft,"note",f.note.value);item.buyPlan=draft;saveSection("allocation");d.close();render();};
  if(!d.open)d.showModal();
  if(!found&&matchMedia("(hover:hover) and (pointer:fine)").matches)el("purchaseSearch").focus();
}


function statusText(){const s=assetStore.status;return {off:"이 기기에만 저장 중",pending:"잠시 후 동기화",busy:"동기화 확인 중…",done:`동기화 완료 · ${s.at}`,error:`이 기기 저장됨 · ${s.message}`}[s.state];}
function updateStatus(){
  const text=statusText();if(el("purchaseSaveStatus"))el("purchaseSaveStatus").textContent=text;
  el("purchaseSyncDialogStatus").textContent=`분할매수·자산: ${text}`;el("purchaseRecovery").hidden=!assetStore.recovery().length;
}
function redrawIdle(){
  if(state.tab!=="buys")return;const active=document.activeElement;
  if(el("purchaseDialog").open||active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)&&active.type!=="checkbox"){redrawLater=true;return;}
  redrawLater=false;render();
}
function initialize(){
  if(initialized)return;initialized=true;
  el("purchaseDialog").querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>dlg("purchaseDialog").close());
  el("purchaseDialog").addEventListener("close",()=>{if(redrawLater)redrawIdle();});
  const search=el("purchaseSearch"),f=form();
  search.oninput=()=>renderPicker();
  search.onkeydown=e=>{const first=el("purchaseItemList").querySelector("[data-pick]");
    if(e.key==="Enter"){e.preventDefault();if(first)pickPurchaseItem(first.dataset.pick);}else if(e.key==="ArrowDown"&&first){e.preventDefault();first.focus();}};
  el("purchaseItemList").onkeydown=e=>{const b=e.target.closest?.("[data-pick]");if(!b||!["ArrowDown","ArrowUp"].includes(e.key))return;e.preventDefault();
    const next=e.key==="ArrowDown"?b.nextElementSibling:b.previousElementSibling;(next||(e.key==="ArrowUp"?search:null))?.focus();};
  f.lineTarget.oninput=()=>{budgetAuto=true;renderLines();};
  f.lineEnd.oninput=()=>renderLines();f.lineSet.onchange=()=>renderLines();
  f.lineBudget.oninput=()=>{budgetAuto=false;renderLines();};
  el("lineBudgetReset").onclick=()=>{budgetAuto=true;renderLines();};
  // 방식 바꾸기: 지금 방식에 체결 기록이 있으면 바꾸지 않는다(기록이 사라지지 않게).
  all("[name=mode]").forEach(x=>x.onchange=()=>{const toLines=x.value==="lines",kept=toLines?(purchaseDraft.stages||[]).some(s=>s.done):Object.keys(purchaseBuys(purchaseDraft)).length;
    if(kept){alert("체결 기록이 있어 방식을 바꿀 수 없습니다. 기록을 지우려면 계획을 삭제하고 새로 만드세요.");f.mode.value=toLines?"manual":"lines";return;}
    if(!toLines&&!(purchaseDraft.stages||[]).length)purchaseDraft.stages=Array.from({length:3},()=>({id:newId()}));renderLines();renderPurchaseDraft();});
  f.manualCurrency.onchange=()=>{if(f.manualCurrency.value==="USD")purchaseDraft.currency="USD";else delete purchaseDraft.currency;renderPurchaseDraft();};
  document.addEventListener("focusout",()=>setTimeout(()=>{if(redrawLater)redrawIdle();},0));
  assetStore.subscribe(type=>{doc=assetStore.doc;prices=assetStore.prices;updateStatus();if(type==="change")redrawIdle();});
  for(const key of ["connectRepo","syncNow","disconnectRepo"]){const button=el(key),previous=button.onclick;button.onclick=e=>{previous?.call(button,e);assetStore.refreshConfig();};}
  el("purchaseExport").onclick=()=>downloadJson({...assetStore.doc,exportedAt:new Date().toISOString()},`etf-planner-assets-${new Date().toISOString().slice(0,10)}.json`);
  el("purchaseRecovery").onclick=()=>downloadJson(assetStore.recovery(),`etf-planner-assets-recovery-${new Date().toISOString().slice(0,10)}.json`);
  el("purchaseImport").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;
    try{const incoming=cleanAssets(JSON.parse(await file.text()));if(!incoming||assetsBlank(incoming))throw Error("분할매수·자산 백업 형식이 아닙니다.");
      const names=ASSET_SECTIONS.filter(s=>incoming[s]).map(s=>({allocation:"분할매수·자산 배분",ledger:"월별 손익",savings:"저축 계획"}[s]));
      if(confirm(`${names.join("·")} 기록을 이 파일로 바꿀까요? 지금 기록은 이 기기에 보관합니다.`)){assetStore.restore(incoming);alert("복원했습니다.");}}
    catch(error){alert(`복원 실패: ${error.message}`);}e.target.value="";};
  updateStatus();assetStore.start();
}
return {render:renderPurchases,initialize,alertCount:()=>purchaseAlertRules(assetStore.doc,priceDoc()||assetStore.prices).length};
})();
