// 플래너 분할매수 탭·계획 창. 계산 기준은 assets-calc.js 분할매수 주석, 기록·동기화는 assetStore, 공통 작업 규칙은 AGENTS.md.
const purchasePlanner = (()=>{
const el=id=>document.getElementById(id), all=sel=>document.querySelectorAll(sel);
const escA=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const nf1=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}),nf2=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}),nf8=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
const man=v=>`${nf1.format(Math.round((Number(v)||0)*10)/10)}만원`;
const pc=v=>v===null||v===undefined||!Number.isFinite(Number(v))?"—":`${(Math.abs(v)<1?nf2:nf1).format(Number(v))}%`;
const PEN=PENCIL,dlg=el;
const numIn=v=>String(v??"").trim()===""?null:finite(v);
const setNum=(obj,key,v)=>{const n=numIn(v);if(n===null)delete obj[key];else obj[key]=n;};
const setText=(obj,key,v)=>{const t=String(v??"").trim();if(t)obj[key]=t;else delete obj[key];};
let doc=assetStore.doc,prices=assetStore.prices,redrawLater=false,initialized=false,selectedPurchaseId=null,priorityPointerDown=false;
// 완료 회차는 기본 접기. 종목별 펼침 상태는 현재 화면에서만 유지하고 자산·체결·동기화 기록에는 저장하지 않는다.
const openCompletedPurchases=new Set();
function findItem(id){for(const g of doc.allocation?.groups||[]){const it=g.items.find(x=>x.id===id);if(it)return {g,it};}return null;}
const render=()=>renderPurchases(),saveSection=section=>assetStore.saveSection(section);
const onChange=(sel,section,set)=>all(sel).forEach(x=>x.onchange=()=>{if(set(x.value,x)!==false)saveSection(section);render();});
const emptyCard=(title,text,button)=>`<div class="card empty purchase-empty"><h2>${title}</h2><p>${text}</p>${button}</div>`;
// 회차 가격·수량(선택): 통화는 계획에 저장한 currency(달러일 때만 저장) → 종목 시세 통화 → 원화. 비트코인(BTC-USD)은 0.00000001 단위, 나머지는 1주.
const quoteOf=it=>assetQuote(prices,it?.ticker);
const planCurrency=(plan,it)=>plan?.currency||quoteOf(it)?.currency||(tracksETF(it)&&purchaseQuoteKind(it?.ticker)==="해외"?"USD":"KRW");
const targetsOf=(it,plan=it.buyPlan,s)=>purchaseTargets(doc.allocation,prices,it,plan,s);
// 화면 제목·목록 카드에 보일 종목 이름: 매수 우선순위 첫 항목(매수 반영 대상·매수대기의 계획 종목). 순서를 바꾸지 않았으면 계획을 둔 종목, 이름이 없으면 종목 코드. 계획·자산 이름은 바꾸지 않는다.
const itemName=it=>String(it?.name||"").trim()||String(it?.ticker||"").trim();
const leadName=(it,s)=>itemName(targetsOf(it,it.buyPlan,s)[0]?.it||it);
// 매수 1순위 계좌. 기록한 회차의 이어 사기·되팔기(수량 늘리기·줄이기·0·체크 해제)도 처음 반영한 계좌가 아니라 이 계좌에 바뀐 양만 반영한다(alloc-link.js shift).
// 1순위 계좌의 실제 매수 코드가 회차 코드와 같을 때만 따르며(주수 단위가 같음), 다르거나 이미 반영한 수량을 모르는 옛 기록은 처음 반영한 계좌를 그대로 고친다.
const leadOf=(it,plan=it.buyPlan)=>targetsOf(it,plan)[0]?.it||it;
const followsLead=(r,lead)=>!!r?.recorded&&r.shares!==null&&r.shares!==undefined&&!!lead&&linkTicker(assetTradeTicker(lead))===linkTicker(assetTradeTicker(r.tradeItem));
const lineOptions=(it,plan=it.buyPlan)=>({item:it,target:leadOf(it,plan),allocation:doc.allocation,prices,fx:assetFx(prices,doc.allocation),currency:planCurrency(plan,it)});
// 다른 ETF로 사는지는 계획이 붙은 줄이 아니라 종목 코드로 판단한다. 같은 코드의 다른 계좌 줄은 같은 종목이라 예상·잔액·'→' 표시를 하지 않는다.
const otherCode=(it,code)=>!!code&&linkTicker(code)!==linkTicker(it?.ticker);
// 같은 종목(연결된 전체 계좌 줄, purchaseAllocationSummary)에 있는 분할매수 계획. 새 계획은 이 계획을 열어 한 종목에 계획이 둘 생기지 않게 한다(예산·알림 중복).
const linkedPlans=(it,s)=>purchaseAllocationSummary(doc.allocation,prices,it,it?.buyPlan,s).rows.filter(r=>r.it.buyPlan);
const perRoundText=rows=>{
  const amounts=rows.map(r=>finite(r.line?.amount??r.amount)).filter(v=>v!==null), min=Math.min(...amounts),max=Math.max(...amounts);
  return man(min)===man(max)?`회당 약 ${man(min)}`:`회당 ${man(min)}~${man(max)}`;
};
const unitOf=it=>linkStep(it);
const qtyNum=(v,it)=>(unitOf(it)<1?nf8:nf1).format(v), qtyUnit=it=>unitOf(it)<1?" BTC":"주", qtyText=(v,it)=>`${qtyNum(v,it)}${qtyUnit(it)}`;
// 회차표의 좁은 매수·체결 칸(화면 전용)은 비트코인 수량을 사토시 정수로 보인다(1 sat = 0.00000001 BTC = 매수 단위, 1억 sat = 1 BTC).
// 체결 칸은 sat 정수로 받고 소수점 있는 값(거래소 체결 수량)은 BTC로 읽는다. 기록·계산과 진행 카드 등 다른 수량 글자는 BTC 그대로.
// 칸 글자는 숫자와 아랫줄 sat(폰에서 7자리 이상은 글자를 줄이고 쉼표에서만 줄바꿈), 회차 칸 '남은' 수량은 숫자만.
// 기준가 칸의 비트코인 달러 가격은 센트를 빼고 반올림(renderPurchases rowPt). 원화 환산 줄·알림·기록은 원래 가격 그대로.
const sats=v=>nf1.format(Math.round(Number(v)*1e8)), cellQty=(v,it)=>unitOf(it)<1?sats(v):qtyText(v,it);
const satCell=v=>(t=>`<span class="sat-n${t.length>6?" long":""}">${t.replace(/,/g,",<wbr>")}</span><small class="qty-unit">sat</small>`)(sats(v));
const cellIn=(v,it)=>v===null||unitOf(it)>=1||!Number.isInteger(v)?v:v/1e8;
const holdingQty=(v,it)=>`${nf8.format(v)}${qtyUnit(it)}`;
const wonAmount=v=>priceText(v*1e4,"KRW");
// 계획·회차 키는 처음 고른 항목에 유지하고 새 체결은 우선순위 첫 항목에 반영한다. 추가 체결·취소도 같은 코드면 지금 우선순위 첫 항목을 따른다(followsLead).
function targetInfo({g,it},s){
  const path=[g.name,it.section,it.name].filter(Boolean).map(escA).join(" › "), shares=finite(it.shares), byShares=shares!==null||!(finite(it.amount)>0);
  const holding=byShares?`현재 보유 <b class="purchase-target-quantity">${holdingQty(shares??0,it)}</b> · 체결 주수를 더합니다.`:`현재 평가액 <b>${man(s.items.get(it.id)?.value||0)}</b> · 체결 금액을 더합니다.`;
  return `<b>매수 반영 대상</b> 자산 배분 › ${path}<br>${holding}`;
}
function trackingInfo(it,target=it){
  if(!it||!target)return "";
  if(linkTicker(it.ticker)===linkTicker(assetTradeTicker(target)))return "";
  const q=assetTradeQuote(prices,target), fx=assetFx(prices,doc.allocation), date=q?.asOf?` ${escA(q.asOf.slice(5))} 기준`:"", old=q&&(q.stale||q.asOf&&priceAge(q.asOf)>PRICE_STALE_DAYS);
  const fxDate=plus(prices?.fx?.close)?prices.fx.asOf?` 현물 ${escA(prices.fx.asOf.slice(5))} 기준`:" 현물":" 직접 입력";
  return `기준 ${escA(it.ticker)} → 실제 매수 <b>${escA(assetTradeTicker(target))}</b>${q?` · 현재가 ${priceText(q.close,q.currency)} <small class="price-date${old?" old":""}">${q.manual?"직접 입력":"시세"}${date}${q.stale?" · 조회 실패":""}</small>`:" · 실제 ETF 가격 대기"}${fx?` · 환율 ${priceText(fx,"KRW")}<small class="price-date">${fxDate}</small>`:""}`;
}
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
const waitEntry=it=>{const e=lineEntry(it)||quoteOf(it);return lineMarket(it)&&e?.kind===purchaseQuoteKind(it.ticker)?e:null;};
const lineKnown=(lines,e)=>purchaseLineNames(lines).filter(n=>Number(e?.ma?.[n])>0);
// 단계 묶음(창의 '단계' 선택). 목표 가격을 비우면 고른 마지막 선까지의 names만 저장해 수집 작업도 같은 선을 받는다.
const LINE_SETS={all:PURCHASE_LINES,hour:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="선"),day:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="일선"),week:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="주선"),month:PURCHASE_LINES.filter(n=>movingLineUnit(n)==="개월선"),legacy:PURCHASE_LINES.filter(n=>["선","일선"].includes(movingLineUnit(n)))};
const lineSetOf=(names,extend=false)=>Object.keys(LINE_SETS).find(k=>LINE_SETS[k].join()===names.join())||["hour","day","week","month","legacy","all"].find(k=>{
  const range=purchaseLineRange(LINE_SETS[k],names[0]);
  const bounded=extend?purchaseLineRange(LINE_SETS[k],names[0],names[names.length-1]):[];
  return names.length&&(names.every((n,i)=>range[i]===n)&&(extend||names.length===range.length)||bounded.length===names.length&&names.every((n,i)=>bounded[i]===n));
})||"custom";
const startText=name=>movingLineUnit(name)==="선"?name.replace(/선$/,"시선"):movingLineText(name);
// 분할매도와 같은 보유 목록·상태·메모 순서(계산 요약 카드 없음). 조회는 계산에 쓰는 연결 항목 그대로 읽으며 보유 수량·자산 이름·계획 기록을 바꾸지 않는다.
function linkedHoldings({g,it},s){
  const wait=!!it.buyPlan.wait,ordered=targetsOf(it,it.buyPlan,s),infos=new Map(ordered.map(r=>[r.it.id,allocationHoldingInfo(r.it,s)])),total=allocationHoldingTotal(infos.values(),s);
  const rows=ordered.map((r,j)=>{
    const selected=j===0,path=[r.g.name,r.it.section,assetTradeTicker(r.it)].filter(Boolean).map(escA).join(" · "),info=infos.get(r.it.id),tag=selected?(wait?"계획 종목":"매수 반영 대상"):"";
    return `<div class="sale-linked-holding purchase-linked-holding${selected?" selected":""}" data-purchase-holding="${escA(r.it.id)}"><span class="sale-priority-rank" aria-label="${j+1}순위">${j+1}</span><div class="sale-holding-details"><div class="sale-holding-title"><strong>${escA(r.it.name)}</strong>${tag?`<span class="sale-holding-tag">${tag}</span>`:""}</div><small class="sale-holding-meta">${path}</small><div class="sale-holding-stats"><small class="sale-holding-quantity">${info.quantityText}${info.pending?` · ${info.pending}`:""}</small><span class="sale-holding-value"><strong>${info.valueText}</strong><small>${info.pctText}</small></span></div></div><div class="sale-priority-controls"><button class="btn sale-priority-move" type="button" data-purchase-priority="${escA(r.it.id)}" data-purchase-direction="-1"${j===0?" disabled":""} aria-label="${escA(r.g.name)} ${escA(r.it.name)} 매수 우선순위 올리기">↑</button><button class="btn sale-priority-move" type="button" data-purchase-priority="${escA(r.it.id)}" data-purchase-direction="1"${j===ordered.length-1?" disabled":""} aria-label="${escA(r.g.name)} ${escA(r.it.name)} 매수 우선순위 내리기">↓</button></div></div>`;
  }).join("");
  return `<section class="card panel sale-account sale-linked purchase-linked"><div class="sale-linked-heading"><h2>연결된 전체 보유 종목</h2><strong>${total.valueText}</strong></div><p class="hint sale-linked-summary">전체 계좌 ${ordered.length}개 항목 · 현재 ${total.pctText}${total.pendingCount?` · 평가 대기 ${total.pendingCount}개`:""}</p><p class="hint sale-linked-policy">${wait?"화살표로 계획 종목의 우선순위를 바꿉니다.":"매수 우선순위 · 맨 위 종목에 새 회차의 체결을 반영합니다."}</p><div class="sale-linked-holdings" aria-label="매수 우선순위">${rows}</div></section>`;
}
// 순서는 사용자가 화살표를 누를 때만 저장한다. 자산 배열·다른 계획·완료/부분 체결 회차는 그대로 두고 다음 매수 대상만 바꾼다.
function bindPurchasePriority(it){
  all("[data-purchase-priority]").forEach(b=>{b.onpointerdown=e=>{if(e.button===0)priorityPointerDown=true;};b.onclick=()=>{
    priorityPointerDown=false;
    const found=findItem(it.id),direction=Number(b.dataset.purchaseDirection);if(!found?.it.buyPlan||![-1,1].includes(direction))return;
    const ids=targetsOf(found.it).map(r=>r.it.id),at=ids.indexOf(b.dataset.purchasePriority),next=at+direction;if(at<0||next<0||next>=ids.length)return;
    [ids[at],ids[next]]=[ids[next],ids[at]];found.it.buyPlan.buyPriority=ids;saveSection("allocation");render();
    const buttons=[...all("[data-purchase-priority]")].filter(x=>x.dataset.purchasePriority===b.dataset.purchasePriority);
    (buttons.find(x=>!x.disabled&&x.dataset.purchaseDirection===b.dataset.purchaseDirection)||buttons.find(x=>!x.disabled))?.focus({preventScroll:true});
  };});
}
// 옛 기록에는 반영 대상 id를 자동 추가하지 않는다. 첫 체결의 tradeTargetId 또는 allocation.trades의 항목으로 반영 계좌를 읽는다.
function recordedTarget(it,b,key){
  const entries=doc.allocation?.trades?.[key]?.items||[],targetId=b?.tradeTargetId||(entries.length===1?entries[0].id:null);
  const found=targetId?findItem(targetId):null;
  return {targetId,found,tradeItem:{...(found?.it||it),...(b?.tradeTicker?{tradeTicker:b.tradeTicker}:{})}};
}
const noteCount=v=>`${String(v||"").length.toLocaleString("ko-KR")} / 4,000자`;
const memoPanel=it=>`<section class="card panel memo"><div class="memo-head"><h2>메모</h2><span id="purchaseMemoCount" class="memo-count">${noteCount(it.buyPlan.note)}</span><button class="btn mini" id="savePurchaseNote" type="button">저장</button></div><textarea id="purchaseMemo" maxlength="4000" rows="3" aria-label="분할매수 메모">${escA(it.buyPlan.note||"")}</textarea></section>`;
// 카드 이름은 계획에만 저장한다. 분할매도와 같은 이름 창·PC 연필·터치 길게 누르기를 사용하며 빈 이름은 필드를 지운다.
function openPurchaseName(id){
  const found=findItem(id);if(!found?.it.buyPlan||typeof openNameDialog!=="function")return;
  openNameDialog(id,{name:leadName(found.it),cardName:found.it.buyPlan.cardName,onSave:value=>{
    const plan=findItem(id)?.it.buyPlan;if(!plan||String(plan.cardName||"").trim()===value)return;
    setText(plan,"cardName",value);saveSection("allocation");render();
  }});
}
// ---------- 분할매수 ----------
// 계획은 종목 안에 두므로 이름·목표 변경과 그룹 이동이 그대로 연결된다. 창에서 고치는 동안은 복사본만 바꾸고 저장할 때 반영한다.
// 이동평균선 돌파(lines)·매수대기(wait)와 기존 직접 입력(stages). 새 계획은 돌파·대기만 선택하고 기존 회차 기록은 유지한다.
const purchaseItems = () => (doc.allocation?.groups||[]).flatMap(g=>(g.items||[]).map(it=>({g,it})));
const purchaseMode = plan => plan?.wait?"wait":plan?.lines?"lines":Array.isArray(plan?.stages)?"manual":"lines";
// 목록 선택은 화면에만 유지한다. 알림·계획 저장도 같은 종목 id를 선택하며 자산·동기화 기록에는 필드를 추가하지 않는다.
const selectPurchase=id=>{selectedPurchaseId=id;};
// 분할매도와 같은 제목·시세·자산 배분 순서. 자산 배분 줄은 연결된 전체 계좌 합계 비중(아래 보유 목록 요약과 같은 값)이라 꼬리표·계좌 글자 없이 쓰고, 목표 도달·까지·초과 글자는 분할매도·재매수 줄(alloc-link.js line)과 같다. 계획 선택·화면 표시로 저장 필드를 만들지 않는다. 목표 출처 표시는 alloc-link.js 줄과 같다(옛 계획 목표만 '계획 목표').
const TARGET_SCOPE={group:" (그룹)",section:" (소분류)",plan:" (계획 목표)"};
function purchaseHeading({g,it},s,quote,entry=quoteOf(it)){
  const {pct,target,gap,scope}=purchaseAllocationSummary(doc.allocation,prices,it,it.buyPlan,s);
  const name=leadName(it,s),head=stockNames.titleParts(name); // 이름 끝 괄호는 제목 꼬리표로(규칙은 stock-names.js titleParts)
  const twin=linkedPlans(it,s).filter(r=>r.it!==it); // 새 계획 창이 막기 전에 만든 같은 종목의 중복 계획은 합치지 않고 알리기만 한다.
  const targetText=target!==null?` / 목표 ${pc(target)}${TARGET_SCOPE[scope]||""}${gap===null?"":Math.abs(gap)<.5?" · 목표 도달":gap>0?` · 목표까지 ${man(gap)}`:` · 목표 초과 ${man(-gap)}`}`:" · 목표 미입력";
  return `<div class="heading plan-heading"><div><div class="eyebrow">${escA(it.ticker||g.name)}${entry?` · ${priceStamp(entry)}`:""}</div><div class="title-row"><h1>${escA(head.main)}${head.tag?` <span class="title-tag">${escA(head.tag)}</span>`:""}</h1><button class="btn icon-btn" type="button" data-purchase-edit="${escA(it.id)}" aria-label="${escA(name)} 분할매수 계획 수정" title="계획 수정">${PEN}</button></div>${quote}<p class="alloc-link" title="자산 배분 · 연결된 전체 계좌 합계 비중"><span>현재 ${pc(pct)}${targetText}</span></p></div></div>${entry?priceWarning(entry,escA(it.ticker||it.name)):""}${twin.length?`<div class="warning">같은 종목의 다른 계좌 줄(${twin.map(r=>escA(r.it.name)).join(", ")})에도 분할매수 계획이 있어 예산과 알림이 겹칩니다. 하나만 남기고 삭제하세요.</div>`:""}`;
}
// 매수대기 진행 카드: 돌파 계획의 진행 카드(statusCard)와 같은 띠·양 끝·가운데 구성. 띠는 왼쪽이 낮은 가격인 가격 축으로, 대기 중엔 왼쪽 선(○)·오른쪽 현재가(●)이고 띠의 화살표(‹)가 선 쪽(하락)을 가리킨다.
// 현재가가 선 이하로 내려오면 현재가가 선 왼쪽으로 넘어가고 양 끝 가격도 자리를 바꾼다(대기 파랑·도달 주황·시세 대기 회색).
// 가운데 %(시세 대기면 생략)는 대기 중이면 선까지 남은 하락(선 ÷ 현재가 − 1, 돌파 계획의 '다음 회차까지'와 같은 기준), 도달 뒤에는 선 대비 현재가(현재가 ÷ 선 − 1). 계산 요약 카드 없이 메모만 두고, 시세 대기·종목 코드 안내는 카드 아래쪽, 알림 스위치는 맨 아래 줄. 화면 표시만 하며 기록에 필드를 만들지 않는다.
function waitCard({g,it},s){
  const plan=it.buyPlan, entry=waitEntry(it), info=purchaseWaitInfo(plan,entry), cur=planCurrency(plan,it), pt=v=>v?priceText(v,cur):"—", id=escA(it.id);
  const line=escA(movingLineText(info.line)||"기준선 미입력"), ready=info.gapPct!==null, gap=!ready?null:info.reached?info.gapPct:(info.price/info.current-1)*100;
  const status=!ready?"시세 대기":info.reached?"기준선 도달":"매수대기", tone=!ready?"wait":info.reached?"due":"next";
  const alertable=lineMarket(it)&&(purchaseQuoteKind(it.ticker)==="국내"?"KRW":"USD")===cur;
  const gapText=ready?`${gap>0?"+":""}${pc(gap)}`:"", caption=info.reached?`${line} ${info.gapPct<0?"아래":"도달"}`:`${line}까지 하락`;
  const end=(price,name,cls="")=>`<div class="buy-track-end${cls}"><b>${price}</b><small>${name}</small></div>`, low=info.reached?end(pt(info.current),"현재가"):end(pt(info.price),line), high=info.reached?end(pt(info.price),line," r"):end(pt(info.current),"현재가"," r");
  const notes=[!info.price?"선택한 이동평균선의 시세를 기다리는 중입니다. 다음 수집 후 표시하며, 봉이 부족하면 계산될 때까지 기다립니다.":"",!alertable?"자산 배분에서 국내·미국 시세 종목 코드를 확인하세요.":""].filter(Boolean);
  const card=`<section class="card buy-track buy-wait" aria-label="매수대기 진행"><div class="buy-wait-track ${tone}${info.reached?" crossed":""}" role="img" aria-label="${line} ${pt(info.price)} · 현재 ${pt(info.current)}${ready?` · ${caption} ${gapText}`:""}"><i></i></div><div class="buy-track-row">${low}<div class="buy-track-main"><div class="buy-track-chips"><span class="buy-track-chip${{due:" warn",wait:" muted"}[tone]||""}">${status}</span></div>${ready?`<div class="buy-track-count ${tone}"><b>${gapText}</b></div><small>${caption}</small>`:""}</div>${high}</div>${notes.map(t=>`<p class="buy-track-note muted">${t}</p>`).join("")}${alertable?`<div class="buy-wait-alert"><span>${line} 이하 도달 알림</span>${tradeAlertToggle(purchaseAlertOn(plan,{key:"wait"}),`data-purchase-alert="${id}" data-key="wait"`,movingLineText(`${it.name} 매수대기 ${info.line}`))}</div>`:""}</section>`;
  return `<div data-purchase-item="${id}">${purchaseHeading({g,it},s,tradeQuoteLine({now:info.current?pt(info.current):"",state:"매수대기",round:`${line}까지 기다립니다.`}),entry)}${linkedHoldings({g,it},s)}
    ${card}
    <div class="control-grid">${memoPanel(it)}</div><p class="footnote">현재가가 ${escA(movingLineText(info.line)||"선택한 이동평균선")} 이하가 되면 알림을 받고 매수를 결정합니다. 같은 조건에 머무는 동안에는 알림을 반복하지 않으며, 대기만으로 보유량은 바뀌지 않습니다.</p></div>`;
}
function renderPurchases(){
  // 수량 입력 중 화살표를 누르면 blur의 체결 저장을 먼저 마친다. click이 끝날 때까지 다시 그리기를 미뤄 한 번의 입력이 사라지지 않게 한다.
  if(priorityPointerDown){redrawLater=true;return;}redrawLater=false;
  doc=assetStore.doc;prices=assetStore.prices;
  const view=el("buysView"), items=purchaseItems(), plans=items.filter(({it})=>it.buyPlan), fills=new Map(), rowData=new Map();
  const selected=plans.find(({it})=>it.id===selectedPurchaseId)||plans[0];selectedPurchaseId=selected?.it.id||null;
  const s=allocationSummary(doc.allocation,prices), summaries=plans.map(({it})=>purchaseSummary(it.buyPlan,lineEntry(it),lineOptions(it)));
  const card=({g,it})=>{
    if(it.buyPlan.wait)return waitCard({g,it},s);
    const plan=it.buyPlan, lines=plan.lines, entry=lines?lineEntry(it):null, trade=lineOptions(it),target=targetsOf(it,plan,s)[0],p=purchaseSummary(plan,entry,trade), id=escA(it.id);
    const cur=planCurrency(plan,it), q=quoteOf(it), now=q&&q.currency===cur?q.close:null, up=purchaseDirection(plan)==="up";
    const pt=v=>priceText(v,cur), kind=purchaseQuoteKind(it.ticker), rowPt=v=>kind==="코인"&&cur==="USD"?`$${nf1.format(Math.round(v))}`:pt(v), alertable=!!kind&&(kind==="국내"?"KRW":"USD")===cur;
    // 회차 줄(두 방식 공통 모양): 이동평균선 돌파는 키(data-key), 직접 입력은 순번(data-stage)으로 체크·체결·알림을 저장한다.
    const rows=lines?purchaseLineRows(plan,entry,trade).map(r=>{
      const key=`buy:${it.id}:${r.key}`, b=purchaseBuys(plan)[r.key], fill=b?null:purchaseTrackingFill(r,it,prices,s.fx,cur,trade.target);if(fill)fills.set(key,fill);
      const shares=b?recordedShares(key,b):0, plannedShares=b?finite(b.plannedShares)??shares:fill?.shares??null;
      const saved=b?recordedTarget(it,b,key):{targetId:target?.it.id,found:target,tradeItem:trade.target};
      const row={key,attr:`data-key="${escA(r.key)}"`,label:purchaseLineLabel(r),price:r.price,shares,plannedShares,amount:b?r.amount:fill?.actual??r.amount,done:r.done,recorded:!!b,actual:r.actual??0,line:r,fill,tradeTicker:b?.tradeTicker||fill?.tradeTicker,...saved};rowData.set(key,row);return row;})
      :(Array.isArray(plan.stages)?plan.stages:[]).map((x,i)=>{
        const key=`buy:${it.id}:${x.id||`#${i}`}`, recorded=purchaseStageRecorded(x), tracking=(tracksETF(it)||trade.target.id!==it.id)&&!recorded;
        const inferred=tracking?purchaseTrackingFill(x,it,prices,s.fx,cur,trade.target):purchasePlannedShares(x)===null?purchaseFill(x,cur,s.fx,unitOf(it)):null;
        const plannedShares=tracking?inferred?.shares??null:purchasePlannedShares(x)??inferred?.shares??null, shares=recorded?recordedShares(key,x)??(inferred?purchaseFill({amount:finite(x.actual)??x.amount,price:x.price},cur,s.fx,unitOf(it))?.shares??null:null):0;
        if(inferred)fills.set(key,inferred);
        const saved=recorded?recordedTarget(it,x,key):{targetId:target?.it.id,found:target,tradeItem:trade.target};
        const row={key,attr:`data-stage="${i}"`,label:`${i+1}차`,price:finite(x.price),shares,plannedShares,amount:purchaseStageRemaining(x),done:!!x.done,recorded,actual:recorded?finite(x.actual)??Math.max(0,finite(x.amount)||0):0,stage:x,fill:inferred,tradeTicker:x.tradeTicker||inferred?.tradeTicker,...saved};rowData.set(key,row);return row;});
    const due=r=>now!==null&&!r.done&&r.plannedShares>0&&r.price>0&&(up?now>=r.price:now<=r.price), priced=rows.some(r=>r.price>0);
    const budgetMissing=!!lines&&!(lines.budget>0),targetReached=!!lines&&p.remaining===0&&purchaseAllocationSummary(doc.allocation,prices,it,plan,s).buyable===0;
    const status=p.count&&p.done===p.count?"매수 완료":p.done||p.actual>0||rows.some(r=>r.recorded)?"진행 중":targetReached?"목표 도달":budgetMissing?"예산 확인 필요":!priced?"기준가 대기":"매수 전";
    // 다음 회차: 아직 도달하지 않은 회차 중 현재가에 가장 가까운 가격(단계 순서와 가격 순서가 다를 수 있음)
    const next=now!==null?rows.filter(r=>!r.done&&r.plannedShares>0&&r.price>0&&!due(r)).sort((a,b)=>Math.abs(a.price-now)-Math.abs(b.price-now))[0]:null, open=rows.filter(r=>!r.done);
    const sharesKnown=rows.length>0&&rows.every(r=>r.plannedShares!==null&&(!r.recorded||r.shares!==null)),filledShares=rows.reduce((n,r)=>n+(r.shares||0),0),remainingShares=open.reduce((n,r)=>n+Math.max(0,(r.plannedShares||0)-(r.shares||0)),0);
    const gap=next?(next.price/now-1)*100:0;
    const nextGap=now!==null&&next?{label:`다음 ${escA(movingLineText(next.label))}까지`,text:`${gap>0?"+":""}${(Math.abs(gap)<1?nf2:nf1).format(gap)}%`,dir:gap>0?"up":gap<0?"down":""}:null;
    const names=lines?purchaseLineNames(lines):[],known=lines?lineKnown(lines,entry):[],missing=names.filter(n=>!known.includes(n)),lastLine=names[names.length-1],waitingLast=!!lines&&!plus(lines.end)&&!known.includes(lastLine);
    const partialCount=rows.filter(r=>r.recorded&&!r.done).length;
    const done=rows.filter(r=>r.done).length, completedOpen=openCompletedPurchases.has(it.id);
    const spaced=lines&&open.length&&purchaseLineLevels(lines,entry).filter(r=>!purchaseBuys(plan)[r.key]).length>rows.filter(r=>!r.recorded).length;
    const waitingStart=!!lines?.startLine&&!known.includes(purchaseLineName(lines.startLine));
    // 시세 대기·회차 간격 안내는 계획 진행 카드 아래쪽에 둔다(계산 요약 카드는 두지 않음).
    const waits=lines?[spaced?"예산에 맞춰 회차 간격을 넓혀 고르게 나눴습니다.":"",
      waitingStart?`매수 시작 이동평균선 ${escA(startText(lines.startLine))}의 시세를 기다리는 중입니다. 시세가 채워지면 선택한 시작선부터 매수 회차를 계산합니다.`:waitingLast?`마지막 매수 평균선 ${escA(movingLineText(lastLine)||"선택한 선")}의 시세를 기다리는 중입니다. 시세가 채워지면 이 선의 도달 회차까지 매수 금액을 나눕니다.`:!known.length?"이동평균 시세를 기다리는 중입니다. 다음 수집 뒤 단계 회차가 보이고, 그 전에는 목표가 회차만 있습니다."
        :missing.length?`아직 시세가 없는 단계 ${escA(movingLineText(missing.join("·")))}는 건너뜁니다(60분봉 긴 선은 수집이 과거 봉을 받는 동안 며칠 걸릴 수 있음).`:""].filter(Boolean):[];
    const alertLine=alertable?`<span class="trade-alert-actions"><span>알림</span><button class="btn mini ghost" type="button" data-purchase-alert-all="${id}" data-on="on">전체 ON</button><button class="btn mini ghost" type="button" data-purchase-alert-all="${id}" data-on="off">OFF</button></span>`
      :`<span class="purchase-alert-off">휴대폰 알림은 자산 배분에서 시세 종목 코드를 넣으면 켤 수 있습니다</span>`;
    // 회차별 반영 계좌·실제 ETF·예상액. 새 체결이 들어갈 회차(미체결 → 없으면 부분 체결 → 모두 완료면 전체)의 계좌·ETF가 모두 같으면 회차표 위 '매수 종목' 한 줄로 올리고,
    // 미체결 회차의 예상액·잔액까지 같으면 함께 올린다. 예상액·잔액은 실제 매수 코드가 계획 코드와 다를 때만 둔다(otherCode). 다른 계좌·ETF로 체결한 완료·부분 체결 회차만 회차 아래 작은 줄에 계좌를 둔다(실제 ETF 코드를 넣기 전에 같은 계좌로 체결한 옛 기록은 같은 계좌로 본다). 부분 체결의 남은 예상액은 회차마다 다르므로 회차 아래에 둔다.
    const remainingOf=r=>r.plannedShares!==null?Number(Math.max(0,r.plannedShares-(r.shares||0)).toFixed(8)):null;
    const detailOf=r=>{
      const ticker=otherCode(it,r.tradeTicker)?r.tradeTicker:"",partial=r.recorded&&!r.done,remaining=remainingOf(r),expected=r.recorded?r.done?r.actual:r.shares>0?r.actual*remaining/r.shares:null:r.fill?.actual, remainder=ticker&&r.fill?.tradeTicker?Math.max(0,r.fill.budget-r.fill.actual):null;
      const amount=ticker?`${expected!==null&&expected!==undefined?`${r.done?"체결":partial?"남은 예상":"예상"} ${wonAmount(expected)}`:"가격 확인 필요"}${remainder!==null?` · 잔액 ${wonAmount(remainder)}`:""}`:"";
      return {group:r.found?r.found.g.name:"",name:r.found?r.found.it.name:"",ticker,amount};
    };
    const details=new Map(rows.map(r=>[r,detailOf(r)])),base=[rows.filter(r=>!r.recorded),open,rows].find(x=>x.length)||[],lead=base.length?details.get(base[0]):null;
    const sameTarget=(d,l)=>d.group===l.group&&d.name===l.name&&d.ticker===l.ticker,shared=lead&&(lead.name||lead.ticker)&&base.every(r=>sameTarget(details.get(r),lead))?lead:null;
    const openAmounts=new Set(rows.filter(r=>!r.recorded).map(r=>details.get(r).amount)),sharedAmount=shared&&openAmounts.size===1?[...openAmounts][0]:"";
    const buyTarget=shared?`<div class="purchase-buy-target"><span>매수 종목</span><div><b>${escA(shared.name||shared.ticker)}</b>${(t=>t?`<small>${t}</small>`:"")([shared.group,shared.name?shared.ticker:"",sharedAmount.startsWith("예상")?`회차 ${sharedAmount}`:sharedAmount,unitOf(base[0]?.tradeItem)<1?"1억 sat = 1 BTC":""].filter(Boolean).map(escA).join(" · "))}</div></div>`:"";
    const row=r=>{
      const actualItem=r.tradeItem,reached=due(r), partial=r.recorded&&!r.done,missingTarget=!!r.targetId&&!r.found,follows=followsLead(r,trade.target),missingFx=!r.recorded&&!r.tradeTicker&&cur==="USD"&&!s.fx&&!(r.stage?.amount>0), blocked=!r.recorded&&(!(r.plannedShares>0)||!(r.price>0)||missingFx), remaining=remainingOf(r);
      const shown=r.done?r.shares:r.plannedShares, fallback=shown!==null?"":r.done?"체결 수량 미입력":r.stage?.condition||"수량 계산 불가";
      const krw=cur==="USD"?`<span class="krw">${r.price>0?s.fx?`≈ ₩${nf1.format(Math.round(r.price*s.fx))}`:"환율 대기":"시세 대기"}</span>`:"";
      const note=missingTarget?r.done?"삭제한 계좌에서 체결":follows?"삭제한 계좌에서 일부 체결":"반영 계좌가 없어졌습니다. 0을 입력하면 이 회차의 체결을 취소합니다.":partial?remaining===null?"계획에 매수 가격·수량을 입력하세요.":"":blocked?missingFx?"자산 배분에 원/달러 환율을 입력하거나 현물 시세를 불러오세요.":r.plannedShares===0?`${r.line?"남은 총예산":"회차 예산"}으로 ${qtyText(unitOf(actualItem),actualItem)}를 살 수 없습니다.`:otherCode(it,assetTradeTicker(actualItem))?"실제 매수 ETF의 현재가와 필요한 환율을 확인하세요.":"계획에 매수 가격·수량을 입력하세요.":r.line?"":r.price!==null?[r.stage.condition,r.stage.date].filter(Boolean).join(" · "):r.stage.date||"날짜 미정", name=movingLineText(`${it.name} ${r.label}`);
      const d=details.get(r),track=shared&&(sameTarget(d,shared)||r.recorded&&!d.ticker&&d.group===shared.group&&d.name===shared.name)?(partial||!r.recorded&&!sharedAmount)?d.amount:"":[d.group&&d.name?`${d.group} · ${d.name}`:"",d.ticker,d.amount].filter(Boolean).join(" · ");
      const sub=[fallback,track,note].filter(Boolean).map(escA).join(" · "), flag=partial?remaining!==null?`남은 ${cellQty(remaining,actualItem)}`:"부분 체결":reached?"도달":"";
      // 이동평균선 돌파 회차는 재매수처럼 단계 이름 + 회차 번호 칩(25선 [2]), 한 줄로 촘촘하게
      const tag=r.line?(r.line.key==="end"?"목표가":`${escA(movingLineText(r.line.line))}<span class="tr-no">${r.line.t+1}</span>`):escA(r.label);
      // 표 열: 회차(아래 도달·남은 수량) · 기준가(매수 수량과 같은 중간 굵기, 달러면 원화 환산) · 매수 수량 · 누적 체결 입력 · 알림 · 상태(PC). 입력·알림의 저장 키는 그대로 쓴다.
      return `<div class="purchase-row${r.line?" line":""}${r.done?" done":partial?" partial":reached?" due":""}"><label class="check" title="잔량까지 매수 완료"><input type="checkbox" ${r.line?"data-purchase-buy":"data-purchase-done"}="${id}" ${r.attr}${r.done?" checked":""}${partial?' data-purchase-partial="true" aria-checked="mixed"':""}${blocked||missingTarget&&!r.done&&!follows?" disabled":""} aria-label="${escA(name)} 매수 완료"><span class="purchase-round"><b>${tag}</b>${flag?`<small>${escA(flag)}</small>`:""}</span></label>
        <div class="stage-price">${(t=>`<span class="price${t.length>9?" xlong":t.length>7?" long":""}">${escA(t)}</span>`)(r.price>0?rowPt(r.price):"—")}${krw}</div>
        <div class="purchase-qty">${shown===null?"—":unitOf(actualItem)<1?satCell(shown):escA(qtyText(shown,actualItem))}</div>
        <div class="purchase-fill">${r.plannedShares!==null||r.recorded&&!r.stage?.partial?(sat=>`<input type="number" min="0" ${r.plannedShares!==null?`max="${sat?Math.round(r.plannedShares*1e8):r.plannedShares}"`:""} step="1" inputmode="numeric" ${r.line?"data-purchase-buy-shares":"data-purchase-shares"}="${id}" ${r.attr} value="${escA(sat&&r.shares!=null?Math.round(r.shares*1e8):r.shares??"")}" placeholder="0"${blocked?" disabled":""} aria-label="${escA(name)} 누적 체결 수량 (${sat?"sat":qtyUnit(actualItem).trim()})">`)(unitOf(actualItem)<1):""}</div>
        ${alertable?`<div class="purchase-alert">${(r.done||!blocked)&&r.price>0?tradeAlertToggle(purchaseAlertOn(plan,r.line||r.stage),`data-purchase-alert="${id}" ${r.attr}`,name,r.done):""}</div>`:""}
        <div class="status${r.done?" done":partial?" partial":reached?" due":""}">${r.done?"매수 완료":partial?"부분 체결":reached?"도달":"대기"}</div>${sub?`<small class="purchase-sub">${sub}</small>`:""}</div>`;
    };
    // 제목 아래 회차: 완료/전체(목록 카드와 같은 표기, 부분 체결은 완료에 넣지 않고 개수만 덧붙임)
    const quote=tradeQuoteLine({now:now!==null?pt(now):"",state:lines?"이동평균선 돌파":"직접 입력",round:p.count?`<b>${p.done}</b>/${p.count}회 분할매수${partialCount?`<span class="quote-sub"> · 부분 ${partialCount}</span>`:""}`:"",gap:nextGap});
    const bounds=lines?purchaseLineLevels(lines,entry):rows,first=rows.find(r=>r.recorded)||bounds[0],last=waitingLast?null:bounds.at(-1);
    const mixedTickers=new Set(rows.map(r=>linkTicker(r.tradeTicker||assetTradeTicker(r.tradeItem)))).size>1;
    const summaryItem=rows[0]?.tradeItem||trade.target;
    const emptyText=targetReached?"전체 계좌 보유액이 목표 이상이라 추가 매수할 금액이 없습니다.":budgetMissing?"계획에 매수 금액을 입력하면 회차가 표시됩니다.":"기준가가 준비되면 매수 회차가 표시됩니다.";
    // 계획 진행 카드: 회차 띠(회차표 순서, 완료·부분 체결·도달·다음·대기 색) 위에 현재가 이름표, 양 끝은 첫·마지막 기준가와 선 이름(회차 번호 생략), 가운데 상태·완료 회차·체결/남은 수량.
    // 이름표는 다음 회차 칸 앞에 둔다. 다음 회차가 없으면 현재가가 지난(도달 방향) 기준가 회차 수만큼 뒤에 둔다. 화면 표시만 하며 기록에 필드를 만들지 않는다.
    const dueRows=rows.filter(r=>!r.recorded&&due(r)),partialRows=rows.filter(r=>r.recorded&&!r.done),qtyOf=(v,item)=>qtyText(Number(Math.max(0,v).toFixed(8)),item);
    const at=now===null||!rows.length?-1:next?rows.indexOf(next):rows.filter(r=>r.price>0&&(up?r.price<=now:r.price>=now)).length;
    const nowTag=at<0?"":`<em class="buy-track-now ${at/rows.length<.18?"left":at/rows.length>.82?"right":"mid"}"><span>현재 <b>${pt(now)}</b></span></em>`;
    const cell=r=>`<i class="${r.done?"done":r.recorded?"partial":due(r)?"due":r===next?"next":"wait"}"></i>`;
    const lineOf=r=>movingLineText(String(r?.label||purchaseLineLabel(r)).replace(/\s+\d+차$/,"")); // 회차 이름에서 번호만 뗀 선 이름(목표가·직접 입력 'N차'는 그대로)
    const end=(r,cls="")=>`<div class="buy-track-end${cls}"><b>${r?.price>0?pt(r.price):"—"}</b><small>${r?.price>0?escA(lineOf(r)):"시세 대기"}</small></div>`;
    const chips=`<span class="buy-track-chip${{"매수 완료":" done","목표 도달":" done","예산 확인 필요":" warn","기준가 대기":" muted"}[status]||""}">${status}</span>${dueRows.length?`<span class="buy-track-chip warn">도달 ${dueRows.length}회</span>`:""}${partialRows.length?`<span class="buy-track-chip warn">부분 체결 ${partialRows.length}회</span>`:""}`;
    const shareLine=!rows.length?emptyText:sharesKnown&&!mixedTickers?`체결 <b>${qtyOf(filledShares,summaryItem)}</b> · 남은 <b>${qtyOf(remainingShares,summaryItem)}</b>`:`부분 체결 ${partialCount}회 · 미완료 ${open.length}회`;
    // 도달 회차는 칩·띠·범례로만 표시하고 안내 문장은 부분 체결에만 둔다.
    const notes=[partialRows.length===1?(r=>`${escA(movingLineText(r.label))} 부분 체결 · ${r.plannedShares!==null&&r.shares!==null?`${qtyOf(r.shares,r.tradeItem)} 체결, ${qtyOf(r.plannedShares-r.shares,r.tradeItem)} 남음`:"남은 수량은 아래 회차표에서 확인하세요"}`)(partialRows[0]):partialRows.length?`부분 체결 ${partialRows.length}회 · 아래 회차표에서 남은 수량을 확인하세요`:""].filter(Boolean);
    const legend=`${partialRows.length?`<span class="partial">부분 ${partialRows.length}</span>`:""}${dueRows.length?`<span class="due">도달 ${dueRows.length}</span>`:""}${next?`<span class="next">다음 ${escA(movingLineText(next.label))} <b>${pt(next.price)}</b>${nextGap?`<em class="${nextGap.dir}">${nextGap.text}</em>`:""}</span>`:""}`;
    const main=`<div class="buy-track-main"><div class="buy-track-chips">${chips}</div>${p.count?`<div class="buy-track-count"><b>${p.done}</b><span>/ ${p.count}회</span></div>`:""}<small>${shareLine}</small></div>`;
    const statusCard=`<section class="card buy-track${rows.length?"":" empty"}" aria-label="계획 진행">${rows.length?`<div class="buy-track-cells${at<0?"":" with-now"}" role="img" aria-label="${p.count}회 중 ${p.done}회 완료${now!==null?`, 현재 ${pt(now)}`:""}">${rows.map((r,i)=>(i===at?nowTag:"")+cell(r)).join("")}${at===rows.length?nowTag:""}</div><div class="buy-track-row">${end(first)}${main}${end(last," r")}</div>`:main}${notes.map(t=>`<p class="buy-track-note">${t}</p>`).join("")}${waits.map(t=>`<p class="buy-track-note muted">${t}</p>`).join("")}${legend?`<div class="buy-track-legend">${legend}</div>`:""}</section>`;
    return `<div data-purchase-item="${id}">${purchaseHeading({g,it},s,quote,q)}${linkedHoldings({g,it},s)}
      ${statusCard}
      <div class="control-grid">${memoPanel(it)}</div>
      <div class="section-heading"><h2>분할매수 체크</h2>${alertLine}<span>${p.count?`${p.done} / ${p.count}회 완료`:budgetMissing?"예산 입력 대기":"회차 시세 대기"}</span></div><section class="card table-card purchase-table${completedOpen?"":" hide-completed"}${alertable?"":" no-alert"}${rows.some(r=>unitOf(r.tradeItem)<1)?" sat":""}" id="purchaseTable">${buyTarget}<div class="purchase-table-head${lines?" line":""}"><span>회차</span><span>기준가</span><span>매수</span><span>체결</span>${alertable?"<span>알림</span>":""}<span>상태</span></div>${done?`<button class="completed-fold-bar" type="button" data-purchase-fold="${id}" aria-expanded="${completedOpen}" aria-controls="purchaseRows"><span>매수 완료 <b>${done}회</b></span><span class="completed-fold-action" data-completed-action>${completedOpen?"접기":"펼치기"}</span></button>`:""}<div id="purchaseRows">${rows.map(row).join("")||`<div class="empty">${emptyText}</div>`}</div>${rows.length&&done===rows.length?'<div class="completed-fold-empty">모든 회차의 매수가 완료되었습니다.</div>':""}</section>
      </div>`;
  };
  // 카드 이름이 없으면 제목과 같은 종목 이름(leadName)을 굵게, PC 아래 줄에 종목 코드(카드 이름이 있으면 종목 이름). 모바일은 같은 이름이 다른 코드에도 있을 때만 코드 줄을 보인다(.show-code).
  const leads=new Map(plans.map(({it})=>[it.id,leadName(it,s)])),autoName=it=>leads.get(it.id),clash=stockNames.clashes(plans.filter(({it})=>!String(it.buyPlan.cardName||"").trim()).map(({it})=>({name:autoName(it),code:it.ticker})));
  const list=plans.map(({g,it},i)=>{
    const p=summaries[i],wait=it.buyPlan.wait?purchaseWaitInfo(it.buyPlan,waitEntry(it)):null;
    const progress=wait?wait.gapPct===null?"시세 대기":wait.reached?"도달":"대기":p.count?`${p.done}/${p.count}`:it.buyPlan.lines&&purchaseAllocationSummary(doc.allocation,prices,it,it.buyPlan,s).buyable===0?"목표 도달":it.buyPlan.lines&&!(it.buyPlan.lines.budget>0)?"예산 대기":"시세 대기",reached=!!wait?.reached;
    const context=[g.name,it.section,it.ticker].filter(Boolean).join(" · "),mode=wait?"매수대기":it.buyPlan.lines?"이동평균선 돌파":"직접 입력",card=String(it.buyPlan.cardName||"").trim(),code=String(it.ticker||"").trim(),name=card||autoName(it),sub=card?autoName(it):code,showCode=!card&&code&&code!==name&&clash(name);
    return `<div class="plan-cell"><button class="plan-item${it.id===selectedPurchaseId?" active":""}${showCode?" show-code":""}" type="button" data-purchase-select="${escA(it.id)}" aria-pressed="${it.id===selectedPurchaseId}" aria-controls="purchaseMain" title="${escA(`${name}${card&&sub?` · ${sub}`:""} · ${context} · ${mode} · ${progress}${!wait&&p.count?"회 완료":""}`)}"><span class="plan-row"><strong>${escA(name)}</strong><span class="plan-count${reached?" due":""}">${progress}${!wait&&p.count?'<span class="plan-unit">회</span>':""}</span></span><span class="plan-title">${sub&&sub!==name?escA(sub):""}</span>${wait?"":`<span class="plan-bar"><i style="width:${Math.round(p.done/Math.max(p.count,1)*100)}%"></i></span>`}</button><button class="plan-rename" type="button" data-purchase-rename="${escA(it.id)}" aria-label="${escA(name)} 카드 이름 변경" title="카드 이름 변경">${PEN}</button></div>`;
  }).join("");
  const empty=items.length?emptyCard("아직 분할매수 계획이 없습니다","저장된 계획의 ＋ 추가를 눌러 종목과 매수 방식을 고르세요.",""):emptyCard("분할매수할 종목을 추가하세요","자산 배분에서 종목을 등록하면 목표 비중과 연결해 분할매수 계획을 만들 수 있습니다.",`<button class="btn primary" id="purchaseGoAlloc" type="button">자산 배분으로</button>`);
  view.innerHTML=`<div class="layout"><aside class="side card" aria-label="저장된 분할매수 계획"><div class="side-head"><h2>저장된 계획</h2><button class="btn primary mini" id="addPurchase" type="button" aria-label="새 분할매수 계획 추가">＋ 추가</button></div><div id="purchaseList" class="plan-list">${list||"<div class='empty'>계획 없음</div>"}</div><p class="hint purchase-save-status" id="purchaseSaveStatus" role="status"></p></aside>
    <section id="purchaseMain">${selected?card(selected):empty}</section></div>`;
  updateStatus();if(typeof keepPlanListView==="function")keepPlanListView(el("purchaseList"),selectedPurchaseId); // 새로 만든 목록도 보던 위치 유지(core.js)
  el("addPurchase").onclick=()=>{if(items.length)openPurchase(null);else location.href="assets.html#alloc";};
  if(!items.length)el("purchaseGoAlloc").onclick=()=>{location.href="assets.html#alloc";};
  all("[data-purchase-select]").forEach(b=>{
    b.onclick=()=>{selectPurchase(b.dataset.purchaseSelect);render();[...all("[data-purchase-select]")].find(x=>x.dataset.purchaseSelect===selectedPurchaseId)?.focus?.();};
    let timer=0,opened=false,x=0,y=0;const stop=()=>{clearTimeout(timer);timer=0;},open=()=>{stop();opened=true;openPurchaseName(b.dataset.purchaseSelect);};
    b.ontouchstart=e=>{({clientX:x,clientY:y}=e.touches[0]);opened=false;timer=setTimeout(open,500);};
    b.ontouchmove=e=>{const t=e.touches[0];if(opened){if(e.cancelable)e.preventDefault();}else if(timer&&Math.hypot(t.clientX-x,t.clientY-y)>10)stop();};
    b.ontouchcancel=stop;b.ontouchend=e=>{stop();if(opened){opened=false;e.preventDefault();}};
    b.oncontextmenu=e=>{if(timer){e.preventDefault();open();}else if(opened)e.preventDefault();};
  });
  all("[data-purchase-rename]").forEach(b=>b.onclick=()=>openPurchaseName(b.dataset.purchaseRename));
  all("[data-purchase-edit]").forEach(b=>b.onclick=()=>openPurchase(b.dataset.purchaseEdit));
  if(selected){
    bindPurchasePriority(selected.it);
    const note=el("purchaseMemo");note.oninput=()=>el("purchaseMemoCount").textContent=noteCount(note.value);
    el("savePurchaseNote").onclick=()=>{const plan=findItem(selected.it.id)?.it.buyPlan;if(!plan)return;setText(plan,"note",note.value);saveSection("allocation");render();};
  }
  const planOf=id=>findItem(id)?.it.buyPlan, stageOf=x=>planOf(x.dataset.purchaseDone||x.dataset.purchaseShares||x.dataset.purchaseAlert)?.stages?.[Number(x.dataset.stage)];
  all("[data-purchase-fold]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.purchaseFold,open=!openCompletedPurchases.has(id);if(open)openCompletedPurchases.add(id);else openCompletedPurchases.delete(id);
    el("purchaseTable").classList.toggle("hide-completed",!open);b.setAttribute("aria-expanded",String(open));b.querySelector("[data-completed-action]").textContent=open?"접기":"펼치기";
  });
  // 회차의 누적 체결 수량을 저장·반영한다. 첫 체결 때 계획 수량을 고정하고, 추가 체결은 같은 반영 키의 총량을 맞춰 차이만 자산에 반영한다.
  // 반영 키: 'buy:종목 id:회차 키(이동평균선 돌파) 또는 회차 id(직접 입력)'. 수량 없는 옛 기록은 이미 반영한 수량을 먼저 읽고, 사용자가 고칠 때만 shares에 기록한다.
  const stageKey=(id,x)=>{const stage=stageOf(x);return stage?`buy:${id}:${stage.id||`#${x.dataset.stage}`}`:"";};
  const buyTrade=(it,plan,b)=>({sign:1,qty:finite(b.shares),price:finite(b.tradePrice)??finite(b.price),currency:b.tradeCurrency||planCurrency(plan,it),value:finite(b.actual)});
  const keepShares=(key,b)=>{const qty=recordedShares(key,b),rec=doc.allocation?.trades?.[key];if(qty!==null){b.shares=qty;if(rec&&finite(rec.qty)===null)rec.qty=qty;}return qty;};
  const inputRow=(id,x)=>rowData.get(x.dataset.key!==undefined?`buy:${id}:${x.dataset.key}`:stageKey(id,x));
  const oldBuy=(plan,r)=>r.line?purchaseBuys(plan)[r.line.key]:r.stage;
  // 누적 0·체크 해제는 체결과 자산 반영을 되돌린다. 추종 ETF 직접 입력은 sourceShares(원래 기준 티커 주수, null이면 원래 빈칸)를 복원한다.
  function clearFill(id,r){
    const found=findItem(id),plan=found?.it.buyPlan;if(!plan||!r)return;
    const lead=leadOf(found.it,plan),back=followsLead(r,lead)?{key:r.key,ticker:assetTradeTicker(r.tradeItem),targetId:lead.id,trade:{...buyTrade(found.it,plan,oldBuy(plan,r)),sign:-1,qty:r.shares,value:r.actual},total:{qty:0,value:0}}:null;
    if(r.line){const buys={...purchaseBuys(plan)};delete buys[r.line.key];if(Object.keys(buys).length)plan.buys=buys;else delete plan.buys;}
    else{const b=r.stage;if(Object.hasOwn(b,"sourceShares")){if(finite(b.sourceShares)!==null)b.shares=b.sourceShares;else delete b.shares;}else if(finite(b.plannedShares)!==null)b.shares=b.plannedShares;for(const key of ["plannedShares","sourceShares","done","partial","actual","tradeTicker","tradePrice","tradeCurrency","tradeTargetId"])delete b[key];}
    saveSection("allocation");if(back)allocLink.shift(back);else allocLink.uncheck(r.key);render();
  }
  function writeFill(id,r,b,lead=null){
    const found=findItem(id),plan=found?.it.buyPlan;if(!plan)return render();
    const commit=()=>{if(planOf(id)!==plan)return false;
      if(r.line)plan.buys={...purchaseBuys(plan),[r.line.key]:b};
      else{delete r.stage.done;delete r.stage.partial;Object.assign(r.stage,b);}
      saveSection("allocation");return r.key;};
    if(r.recorded){if(r.line||finite(b.plannedShares)!==null)keepShares(r.key,oldBuy(plan,r));
      if(commit()){const t=buyTrade(found.it,plan,b),dq=(finite(b.shares)||0)-r.shares,dv=(finite(b.actual)||0)-(r.actual||0);
        if(lead)allocLink.shift({key:r.key,ticker:assetTradeTicker(r.tradeItem),targetId:lead.id,trade:{...t,sign:dq<0||!dq&&dv<0?-1:1,qty:Math.abs(dq),value:Math.abs(dv)},total:{qty:t.qty,value:t.value}});
        else allocLink.rescale(r.key,t);}
      render();}
    else allocLink.check({ticker:b.tradeTicker||found.it.ticker,ownId:r.targetId||id,targetId:r.targetId||id,trade:buyTrade(found.it,plan,b),label:`${found.it.name} 분할매수 ${r.label}`,prefer:[`buy:${id}:`],redraw:render,commit});
  }
  // 체크 전에도 누적 주수만 입력한다(체결 금액 칸 없음). 기준가가 있어야 새 체결을 기록하고, 예정액이 없는 직접 입력은 가격·수량·환율로 금액을 계산한다.
  // 금액은 양수만 기록하며 잔량은 유지한다. 체크는 잔량까지 전부 체결한 상태만 표시한다. 0·체크 해제는 기준가 없이도 취소한다.
  function fillShares(id,r,n){
    const found=findItem(id),plan=found?.it.buyPlan;if(!found||!r||n===null||n<0||(unitOf(r.tradeItem)===1?!Number.isSafeInteger(n):Number(n.toFixed(8))!==n))return render();
    if(n===0)return clearFill(id,r);
    const lead=leadOf(found.it,plan),follow=followsLead(r,lead);
    if(!follow&&r.targetId&&!findItem(r.targetId))return render();
    if(!r.recorded&&!(r.plannedShares>0))return render();
    const target=r.plannedShares??n;if(n>target||!(target>0))return render();
    if(!(r.price>0))return render();
    const old=oldBuy(plan,r),fill=fills.get(r.key),qty=r.recorded?r.shares:0,rate=planCurrency(plan,found.it)==="USD"?assetFx(prices,doc.allocation):1;
    const full=qty>0?r.actual*target/qty:r.line?fill?.actual:r.fill?.actual??plus(old.actual)??plus(old.amount);
    const actual=full!==null&&full!==undefined?full*n/target:r.price>0&&rate?n*r.price*rate/1e4:null;if(!(actual>0))return render();
    const mapping=fill?.tradeTicker?{tradeTicker:fill.tradeTicker,tradePrice:fill.tradePrice,tradeCurrency:fill.tradeCurrency}:{};
    const b={...old,...mapping,...(!r.recorded&&r.targetId?{tradeTargetId:r.targetId}:follow?{tradeTargetId:lead.id}:{}),plannedShares:target,shares:n,actual:Number(actual.toFixed(8))};
    if(!r.line&&!r.recorded&&fill?.tradeTicker)b.sourceShares=finite(old.shares);
    if(r.line){b.price=old?.price??fill?.price??r.price;b.plannedActual=finite(old?.plannedActual)??Number(full.toFixed(8));b.next=old?.next??r.line.next??null;}
    else{delete b.done;delete b.partial;if(n>=target)b.done=true;else b.partial=true;}
    writeFill(id,r,b,follow?lead:null);
  }
  all("[data-purchase-done], [data-purchase-buy]").forEach(x=>x.onchange=()=>{
    const id=x.dataset.purchaseDone||x.dataset.purchaseBuy,r=inputRow(id,x);if(!r)return render();
    if(!x.checked)return clearFill(id,r);
    if(r.plannedShares!==null)return fillShares(id,r,r.plannedShares);
    return render();
  });
  all("[data-purchase-shares], [data-purchase-buy-shares]").forEach(x=>x.onchange=()=>{
    const id=x.dataset.purchaseShares||x.dataset.purchaseBuyShares,r=inputRow(id,x);fillShares(id,r,r?cellIn(numIn(x.value),r.tradeItem):null);
  });
  all("[data-purchase-partial]").forEach(x=>{x.indeterminate=true;});
  // 알림 ON/OFF는 누를 때만 저장(직접 입력은 회차 notify, 이동평균선 돌파는 notify.keys[키], 전체는 계획 notify.stages — 새 회차도 따라감). 규칙은 assets-calc.js purchaseAlertRules.
  onChange("[data-purchase-alert]","allocation",(_,x)=>{const plan=planOf(x.dataset.purchaseAlert);if(!plan)return false;
    if(x.dataset.key!==undefined){const n=plan.notify&&typeof plan.notify==="object"?plan.notify:(plan.notify={});n.keys={...(n.keys&&typeof n.keys==="object"?n.keys:{}),[x.dataset.key]:x.checked};}
    else{const stage=stageOf(x);if(!stage)return false;stage.notify=x.checked;}});
  all("[data-purchase-alert-all]").forEach(b=>b.onclick=()=>{const plan=planOf(b.dataset.purchaseAlertAll);if(!plan)return;
    const n={...(plan.notify&&typeof plan.notify==="object"?plan.notify:{}),stages:b.dataset.on==="on"};delete n.keys;plan.notify=n;(plan.stages||[]).forEach(x=>delete x.notify);saveSection("allocation");render();});
}
// ---------- 계획 창 ----------
// 종목은 검색 목록에서 고른다(이름·그룹·소분류·종목 코드, 띄어 쓴 낱말이 모두 들어간 종목). 이미 계획이 있는 종목을 고르면 그 계획을 연다. 수정할 때는 종목 고정.
// 새 방식은 이동평균선 돌파(기본)·매수대기. 기존 직접 입력을 포함해 체결 기록이 있으면 방식을 바꾸지 않는다.
let purchaseDraft=null,editing=null,budgetAuto=true,originalMode="lines",openedBudget=null;
const form=()=>el("purchaseForm"), pickedItem=()=>findItem(form().item.value), mode=()=>form().mode.value;
const draftCurrency=()=>{const it=pickedItem()?.it;return purchaseDraft?.currency||quoteOf(it)?.currency||form().manualCurrency.value||"KRW";};
// 검색 목록·고른 종목 한 줄의 설명(이스케이프는 item-search.js).
function itemInfo({g,it},s){
  const v=s.items.get(it.id)?.value||0,t=finite(it.target),holding=purchaseAllocationSummary(doc.allocation,prices,it,it.buyPlan,s);
  return [g.name,it.section,tracksETF(it)?`${it.ticker} → ${assetTradeTicker(it)}`:it.ticker,finite(it.shares)!==null?`보유 ${holdingQty(finite(it.shares),it)}`:`평가액 ${man(v)}`,`선택 항목 ${pc(s.pct(v))}${t!==null?` / 목표 ${pc(t)}`:""}`,`전체 계좌 ${pc(holding.pct)}`].filter(Boolean).join(" · ");
}
// 검색 칸(item-search.js, 분할매도·재매수 창과 공통)은 처음 그릴 때 만든다.
let pickerUi=null;
const picker=()=>pickerUi||=itemSearch.create(el("purchaseItemSearch"),{id:"purchase",label:"purchaseItemLabel",empty:"자산 배분에 종목이 없습니다.",
  rows:()=>{const s=allocationSummary(doc.allocation,prices);return purchaseItems().map(r=>({id:r.it.id,name:r.it.name,info:itemInfo(r,s),badge:linkedPlans(r.it,s).length?"계획 있음":"",words:[r.it.name,r.g.name,r.it.section,r.it.ticker,r.it.tradeTicker]}));},
  current:()=>{const p=pickedItem();return p?{name:p.it.name,info:itemInfo(p,allocationSummary(doc.allocation,prices))}:null;},
  locked:()=>!!editing,pick:id=>pickPurchaseItem(id),repick:()=>{form().item.value="";renderDraft();}});
const renderPicker=()=>picker().render();
function pickPurchaseItem(itemId){
  const found=findItem(itemId);if(!found)return;
  const plan=found.it.buyPlan?found:linkedPlans(found.it,allocationSummary(doc.allocation,prices))[0];if(plan){openPurchase(plan.it.id);return;}
  form().item.value=itemId;if(quoteOf(found.it))delete purchaseDraft.currency; // 시세가 있으면 그 통화(전에 고른 종목의 직접 선택은 버림)
  budgetAuto=true;renderDraft();
}
const renderDraft=()=>{
  renderPicker();const picked=pickedItem(),it=picked?.it,info=el("purchaseTrackingInfo"),target=el("purchaseTargetInfo");
  const first=it?targetsOf(it,purchaseDraft)[0]:null,tracking=first?trackingInfo(it,first.it):"";
  info.hidden=mode()==="wait"||!tracking;target.hidden=mode()==="wait"||!first;info.innerHTML=tracking;target.innerHTML=first?targetInfo(first,allocationSummary(doc.allocation,prices)):"";
  el("purchaseLines").hidden=mode()!=="lines";el("purchaseWait").hidden=mode()!=="wait";el("purchaseManual").hidden=mode()!=="manual";
  form().waitPeriod.disabled=form().waitUnit.disabled=form().waitNotify.disabled=mode()!=="wait";
  el("purchasePlanHint").textContent=mode()==="wait"?"매수대기는 원하는 선까지 기다렸다가 알림을 받고 매수를 결정하는 전략입니다. 알림을 받으려면 동기화와 알림 탭의 기기 수신 설정을 연결하세요.":"체결은 카드에서 누적 주수로 기록합니다. 실제 산 주수만 자산 배분에 더하고 남은 주수는 계속 표시합니다.";
  renderLines();renderWait();renderPurchaseDraft();
};
function waitDraft(){
  const f=form(),n=numIn(f.waitPeriod.value);
  return {line:Number.isInteger(n)?purchaseLineName(`${n}${f.waitUnit.value}`):""};
}
function renderWait(){
  if(mode()!=="wait")return;
  const it=pickedItem()?.it,box=el("waitResult"),hint=t=>`<p>${t}</p>`;
  if(!it){box.innerHTML=hint("종목을 먼저 고르세요.");return;}
  if(!lineMarket(it)){box.innerHTML=hint(`<span class="ladder-error">자산 배분에서 국내·미국 시세 종목 코드를 넣은 종목을 고르세요.</span>`);return;}
  const wait=waitDraft();
  if(!wait.line){box.innerHTML=hint(`<span class="ladder-error">기준선 기간은 1~400의 정수로 넣으세요.</span>`);return;}
  const info=purchaseWaitInfo({wait},waitEntry(it)),cur=purchaseQuoteKind(it.ticker)==="국내"?"KRW":"USD";
  box.innerHTML=hint(`<b>${escA(movingLineText(info.line))}</b>${info.price?` · 기준가 <b>${priceText(info.price,cur)}</b>${info.current?` · 현재가 ${priceText(info.current,cur)}${info.reached?` <span class="purchase-due">기준선 도달</span>`:` · 선 위 +${nf2.format(info.gapPct)}%`}`:""}`:" · 기준선 시세 대기"}`)
    +hint(`<small>${info.price?"현재가가 이 선 이하가 되면 알립니다.":"저장하면 선택한 선의 시세를 수집합니다. 봉이 부족하면 계산될 때까지 기다립니다."} 매수 금액·목표 가격 없이 대기할 수 있습니다.</small>`);
}
// 이동평균선 돌파 설정: 총 매수 금액 = 자산 배분 목표 비중 × 기준 총자산 − 전체 계좌 평가액 + 이미 체결한 금액(assets-calc.js purchaseAutoBudget).
// 새 계획은 자동으로 채우고, 직접 고친 금액은 그대로 둔다('다시 계산'으로 되돌림). 미리보기 회차는 assets-calc.js purchaseLineRows(지금 이동평균).
// 목표 비중은 자산 배분이 단일 기준이라 창에서는 읽기만 하고 계획에 저장하지 않는다. 자산 배분에서 바꾸면 저장 때 총 매수 금액도 다시 계산한다(syncPurchaseTargets).
// 옛 계획 목표(lines.target)는 자산 배분에 목표가 없을 때만 그대로 두고, 자산 배분 목표가 있으면 저장할 때 지운다.
const legacyTarget=()=>finite(purchaseDraft?.lines?.target);
function draftHolding(it,s=allocationSummary(doc.allocation,prices)){const legacy=legacyTarget();return purchaseAllocationSummary(doc.allocation,prices,it,{lines:legacy!==null?{target:legacy}:{}},s);}
function targetNote(h){
  const link='<a href="assets.html#alloc">자산 배분</a>';
  if(!h||h.target===null)return `${link}에 목표가 없습니다. 목표를 넣거나 총 매수 금액을 직접 넣으세요.`;
  if(h.scope==="plan")return `이 계획에만 저장된 옛 목표입니다. ${link}에 목표를 넣으면 그 값을 따릅니다.`;
  const own=h.rows.filter(r=>finite(r.it.target)!==null).length;
  return `${h.scope==="group"?"그룹 목표":h.scope==="section"?"소분류 목표":own>1?`연결 계좌 ${own}개 목표 합`:"종목 목표"} · ${link}에서 바꾸면 분할매도·재매수와 함께 바뀝니다.`;
}
function linesDraft(){
  const f=form(),end=numIn(f.lineEnd.value),start=lineStartDraft(),names=draftLineNames(end===null?lineLastDraft():null),it=pickedItem()?.it;
  const explicit=!!purchaseDraft.lines?.startLine||!purchaseDraft.lines||start!==purchaseLineNames(purchaseDraft.lines)[0];
  const legacy=legacyTarget(),keep=legacy!==null&&!!it&&draftHolding(it).assetTarget===null;
  return {names,...(explicit&&start?{startLine:start}:{}),...(end!==null?{end}:{}),budget:numIn(f.lineBudget.value),...(keep?{target:legacy}:{})};
}
function lineStartDraft(){
  const f=form(),n=numIn(f.lineStartPeriod.value);
  return Number.isInteger(n)?purchaseLineName(`${n}${f.lineStartUnit.value}`):"";
}
function lineLastDraft(){
  const f=form(),n=numIn(f.lineLastPeriod.value);
  return Number.isInteger(n)?purchaseLineName(`${n}${f.lineLastUnit.value}`):"";
}
const draftLineNames=(last=null)=>{
  const old=purchaseLineNames(purchaseDraft.lines),start=lineStartDraft();
  if(form().lineSet.value==="custom"&&start===old[0]&&(last===null||last===old[old.length-1]))return old;
  return purchaseLineRange(LINE_SETS[form().lineSet.value]||old,start,last);
};
function renderLines(){
  const f=form(), picked=pickedItem(), it=picked?.it, q=quoteOf(it), cur=quoteOf(it)?.currency||"KRW", lines=mode()==="lines";
  f.lineStartPeriod.disabled=f.lineStartUnit.disabled=!lines;
  el("lineEndLineField").hidden=f.lineLastPeriod.disabled=f.lineLastUnit.disabled=!lines||numIn(f.lineEnd.value)!==null;
  el("manualCurrencyField").hidden=!picked||!!q;
  all("[data-line-cur]").forEach(x=>x.textContent=cur==="USD"?"$":"원");
  const box=el("lineResult"), list=el("linePreview"), hint=t=>`<p class="hint">${t}</p>`;list.innerHTML="";
  el("lineEndNote").textContent=q?`현재가 ${priceText(q.close,cur)} · ${q.asOf.slice(5)}`:"";
  const s=allocationSummary(doc.allocation,prices),holding=draftHolding(it,s);
  f.lineTarget.value=picked&&holding.target!==null?holding.target:"";el("lineTargetNote").innerHTML=picked?targetNote(holding):"종목을 고르면 자산 배분 목표를 표시합니다.";
  if(!lines)return;
  if(!picked){box.innerHTML=hint("종목을 먼저 고르세요.");return;}
  if(!lineMarket(it)){box.innerHTML=`<p class="ladder-error">자산 배분에서 국내·미국 시세 종목 코드를 넣은 종목을 고르세요.</p>`;return;}
  const target=holding.target, value=holding.value;
  const spent=Object.values(purchaseBuys(purchaseDraft)).reduce((n,b)=>n+Math.max(0,finite(b?.actual)||0),0), goal=target!==null?target/100*s.base:null;
  const auto=purchaseAutoBudget(purchaseDraft,holding,target);
  if(budgetAuto&&auto!==null)f.lineBudget.value=auto;
  el("lineBudgetNote").textContent=goal===null?"자산 배분에 목표 비중을 넣으면 계산합니다":`목표 ${pc(target)} ${man(goal)} − 전체 계좌 보유 ${man(value)}${spent?` + 체결 ${man(spent)}`:""} = ${man(auto)}${numIn(f.lineBudget.value)!==auto?" · 직접 고친 금액":""}`;
  const draft=linesDraft(), entry=lineEntry(it), rows=purchaseLineRows({lines:draft,buys:purchaseDraft.buys},entry,{...lineOptions(it,purchaseDraft),currency:cur}), open=rows.filter(r=>!r.done), known=lineKnown(draft,entry);
  const out=[];
  if(!lineStartDraft())out.push(`<span class="ladder-error">시작선 기간은 1~400의 정수로 넣으세요.</span>`);
  else if(draft.end!==undefined&&!(draft.end>0))out.push(`<span class="ladder-error">목표 가격은 0보다 크게 넣거나 비우세요.</span>`);
  else if(draft.end===undefined&&!lineLastDraft())out.push(`<span class="ladder-error">마지막 매수 평균선 기간은 1~400의 정수로 넣으세요.</span>`);
  else if(!draft.names.length)out.push(`<span class="ladder-error">마지막 매수 평균선은 시작선과 같거나 뒤에 있어야 합니다.</span>`);
  else if(!(draft.budget>0))out.push(`<span class="ladder-error">${goal!==null&&goal<=value?"지금 평가액이 목표 이상이라 더 살 금액이 없습니다.":"총 매수 금액을 넣으세요."}</span>`);
  else{
    const rate=cur==="USD"?s.fx:1, now=q&&q.currency===cur?q.close:null;
    const partial=open.filter(r=>r.remainingShares>0).length;
    out.push(`<b>${escA(startText(lineStartDraft()))}</b>부터 매수합니다.`);
    if(draft.end===undefined)out.push(`<b>${escA(startText(draft.names[draft.names.length-1]))}</b>의 도달 회차까지 매수합니다.`);
    out.push(`<b>${open.length}회</b>${partial?` · 부분 체결 ${partial}회`:open.length?` · <b>${perRoundText(open)}</b>${cur==="USD"&&rate&&open.every(r=>r.amount===open[0].amount)?` <small>(약 ${priceText(open[0].amount*1e4/rate,"USD")})</small>`:""}`:""}${spent?` · 체결 ${man(spent)}`:""}`);
    if(open.length&&purchaseLineLevels(draft,entry).filter(r=>!purchaseBuys(purchaseDraft)[r.key]).length>rows.filter(r=>!purchaseBuys(purchaseDraft)[r.key]).length)out.push('<small>예산에 맞춰 회차 간격을 넓혀 고르게 나눴습니다.</small>');
    if(draft.startLine&&!known.includes(draft.startLine))out.push(`<small>시작 이동평균선의 시세를 기다립니다. 저장하면 선택한 선의 시세를 수집하고, 시세가 채워진 뒤 매수 회차를 계산합니다.</small>`);
    else if(draft.end===undefined&&!known.includes(draft.names[draft.names.length-1]))out.push(`<small>마지막 매수 평균선의 시세를 기다립니다. 저장하면 선택한 선의 시세를 수집하고, 시세가 채워진 뒤 매수 회차를 계산합니다.</small>`);
    else if(!known.length)out.push(`<small>${escA(it.ticker)}의 이동평균 시세가 아직 없습니다. 저장하면 다음 수집(장중 30분마다)부터 이동평균을 받아 단계 회차가 채워지고, 그 전에는 목표가 회차만 있습니다.</small>`);
    const tradeTarget=targetsOf(it,purchaseDraft,s)[0]?.it||it;
    list.innerHTML=rows.map(r=>{const b=purchaseBuys(purchaseDraft)[r.key],fill=!r.done&&!b?purchaseTrackingFill(r,it,prices,s.fx,cur,tradeTarget):null,qty=r.plannedShares??fill?.shares,actualItem=b?recordedTarget(it,b,`buy:${it.id}:${r.key}`).tradeItem:tradeTarget;
      return `<span class="${r.done?"done":now!==null&&now>=r.price?"due":""}"><b>${escA(movingLineText(purchaseLineLabel(r)))}</b> ${r.price?priceText(r.price,cur):""}${r.done?" · 체결":qty!==null&&qty!==undefined?`${otherCode(it,assetTradeTicker(tradeTarget))?" →":" · 매수"} ${qtyText(qty,actualItem)}`:" · 수량 계산 불가"}</span>`;}).join("");
  }
  box.innerHTML=out.map(l=>`<p>${l}</p>`).join("");
}
function renderPurchaseDraft(){
  const stages=purchaseDraft.stages||[], it=pickedItem()?.it, cur=draftCurrency(), unit=unitOf(it);
  el("purchaseStageRows").innerHTML=stages.map((stage,i)=>tradeStageEditorCard(`${i+1}차${purchaseStageRecorded(stage)?`<small>${stage.done?"매수 완료":"부분 체결"}</small>`:""}`,
    `<label>${tracksETF(it)?"기준 티커 가격":"매수 가격"} (${cur==="USD"?"$":"원"})<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="price" data-stage="${i}" value="${finite(stage.price)??""}"${purchaseStageRecorded(stage)?" readonly":""}></label>
    <label>${tracksETF(it)?purchaseStageRecorded(stage)?"실제 ETF 계획 수량":"기준 티커 수량":"계획 수량"} (${qtyUnit(it).trim()})<input type="number" min="0" step="${unit<1?"any":"1"}" inputmode="decimal" data-purchase-field="shares" data-stage="${i}" value="${purchasePlannedShares(stage)??""}"${purchaseStageRecorded(stage)?" readonly":""}></label>
    <label>예정액 (만원)<input type="number" min="0" step="any" inputmode="decimal" data-purchase-field="amount" data-stage="${i}" value="${finite(stage.amount)??""}"${purchaseStageRecorded(stage)?" readonly":""}></label>
    <label class="date-field">매수 예정일<input type="date" data-purchase-field="date" data-stage="${i}" value="${escA(stage.date||"")}"></label>
    <label class="condition-field">매수 조건<input maxlength="100" placeholder="예: 기준가 도달" data-purchase-field="condition" data-stage="${i}" value="${escA(stage.condition||"")}"></label>`,
    `<button class="btn mini ghost" type="button" data-purchase-remove="${i}" aria-label="${i+1}차 회차 삭제">삭제</button>`,stage.done?"done":"")).join("");
  form().manualCurrency.disabled=stages.some(purchaseStageRecorded);
  // 가격·수량을 고치면 예정액 = 가격 × 수량(달러는 × 지금 환율)으로 맞춘다. 예정액만 따로 고쳐도 된다.
  all("[data-purchase-field]").forEach(x=>x.oninput=()=>{const i=Number(x.dataset.stage),stage=stages[i],key=x.dataset.purchaseField;
    if(purchaseStageRecorded(stage)&&["amount","actual","price","shares"].includes(key))return;
    if(["amount","actual","price","shares"].includes(key))setNum(stage,key,x.value);else setText(stage,key,x.value);
    const rate=draftCurrency()==="USD"?assetFx(prices,doc.allocation):1;
    if((key==="price"||key==="shares")&&finite(stage.price)!==null&&finite(stage.shares)!==null&&rate){stage.amount=Math.round(stage.price*stage.shares*rate/100)/100;const a=el("purchaseStageRows").querySelector(`[data-purchase-field=amount][data-stage="${i}"]`);if(a)a.value=stage.amount;}
  });
  all("[data-purchase-remove]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.purchaseRemove);if(purchaseStageRecorded(stages[i])&&!confirm(`${i+1}차의 체결 기록과 잔량도 삭제할까요?`))return;stages.splice(i,1);renderPurchaseDraft();});
}
function openPurchase(id){
  const found=id?findItem(id):null,f=form(),d=dlg("purchaseDialog"),s=allocationSummary(doc.allocation,prices);
  if(!found&&purchaseItems().every(({it})=>linkedPlans(it,s).length)){alert("모든 종목에 분할매수 계획이 있습니다. 종목 이름 옆 연필로 기존 계획을 수정하세요.");return;}
  editing=found;
  el("purchaseTitle").textContent=found?"분할매수 계획 수정":"새 분할매수 계획";
  f.item.value=found?.it.id||"";picker().clear();
  purchaseDraft=found?.it.buyPlan?JSON.parse(JSON.stringify(found.it.buyPlan)):{};
  const lines=purchaseDraft.lines;
  originalMode=purchaseMode(purchaseDraft);f.mode.value=originalMode;
  const waitLine=purchaseWaitLine(purchaseDraft)||"25개월선";
  f.waitPeriod.value=parseInt(waitLine);f.waitUnit.value=movingLineUnit(waitLine);f.waitNotify.checked=purchaseDraft.wait?purchaseAlertOn(purchaseDraft,{key:"wait"}):true;
  f.lineSet.value=lineSetOf(purchaseLineNames(lines),!plus(lines?.end));f.lineEnd.value=finite(lines?.end)??"";f.lineBudget.value=finite(lines?.budget)??"";budgetAuto=!lines;openedBudget=finite(lines?.budget);
  const start=purchaseLineName(lines?.startLine)||purchaseLineNames(lines)[0]||PURCHASE_LINES[0];
  f.lineStartPeriod.value=parseInt(start);f.lineStartUnit.value=movingLineUnit(start);
  const names=purchaseLineNames(lines),last=names[names.length-1]||start;
  f.lineLastPeriod.value=parseInt(last);f.lineLastUnit.value=movingLineUnit(last);
  f.manualCurrency.value=purchaseDraft.currency||"KRW";
  f.cardName.value=purchaseDraft.cardName||"";f.note.value=purchaseDraft.note||"";renderDraft();
  el("purchaseDelete").hidden=!found;
  // 계획 삭제는 실제 체결로 바뀐 자산 보유량을 되돌리지 않는다.
  el("purchaseDelete").onclick=()=>{if(!confirm(`'${found.it.name}' 분할매수 계획과 체결 기록을 삭제할까요?`))return;delete found.it.buyPlan;saveSection("allocation");d.close();render();};
  f.onsubmit=e=>{e.preventDefault();const item=pickedItem()?.it;if(!item){alert("분할매수할 종목을 고르세요.");picker().focus();return;}
    if(!editing&&linkedPlans(item,allocationSummary(doc.allocation,prices)).length){alert("같은 종목의 다른 계좌 줄에 분할매수 계획이 있습니다. 기존 계획을 수정하세요.");return;}
    const draft=purchaseDraft;
    if(mode()!==originalMode&&(Object.keys(purchaseBuys(draft)).length||(draft.stages||[]).some(purchaseStageRecorded))){alert("체결 기록이 있어 방식을 바꿀 수 없습니다.");return;}
    if(mode()==="lines"){
      const kind=purchaseQuoteKind(item.ticker),l=linesDraft();
      if(!lineMarket(item)){alert("이동평균선 돌파는 자산 배분에서 국내·미국 시세 종목 코드를 넣은 종목만 쓸 수 있습니다.");return;}
      if(!lineStartDraft()){alert("시작선 기간은 1~400의 정수로 넣으세요.");f.lineStartPeriod.focus();return;}
      if(l.end!==undefined&&!(l.end>0)){alert("목표 가격은 0보다 크게 넣거나 비우세요.");f.lineEnd.focus();return;}
      if(l.end===undefined&&!lineLastDraft()){alert("마지막 매수 평균선 기간은 1~400의 정수로 넣으세요.");f.lineLastPeriod.focus();return;}
      if(!l.names.length){alert("마지막 매수 평균선은 시작선과 같거나 뒤에 있어야 합니다.");f.lineLastPeriod.focus();return;}
      if(!(l.budget>0)){alert("총 매수 금액을 넣으세요(자산 배분에 목표 비중을 넣으면 계산합니다).");f.lineBudget.focus();return;}
      // 창을 연 뒤 다른 탭·기기에서 자산 배분 목표가 바뀌어 다시 계산된 총 매수 금액은, 금액 칸을 고치지 않았으면 옛 값으로 덮어쓰지 않는다.
      const stored=finite(item.buyPlan?.lines?.budget);if(!budgetAuto&&l.budget===openedBudget&&stored!==null)l.budget=stored;
      draft.lines=l;delete draft.wait;delete draft.stages;delete draft.ladder;
      if(kind!=="국내")draft.currency="USD";else delete draft.currency;
    }else if(mode()==="wait"){
      if(!lineMarket(item)){alert("자산 배분에서 국내·미국 시세 종목 코드를 넣은 종목을 고르세요.");return;}
      const wait=waitDraft();if(!wait.line){alert("기준선 기간은 1~400의 정수로 넣으세요.");f.waitPeriod.focus();return;}
      draft.wait=wait;delete draft.lines;delete draft.stages;delete draft.buys;delete draft.ladder;
      draft.notify={...(draft.notify&&typeof draft.notify==="object"?draft.notify:{}),stages:f.waitNotify.checked};delete draft.notify.keys;
      if(purchaseQuoteKind(item.ticker)==="해외")draft.currency="USD";else delete draft.currency;
    }else{
      if(!draft.stages?.length){alert("기존 회차가 없습니다. 이동평균선 돌파 또는 매수대기를 선택하세요.");return;}
      delete draft.wait;delete draft.lines;delete draft.buys;delete draft.ladder;if(draft.notify){delete draft.notify.keys;if(!Object.keys(draft.notify).length)delete draft.notify;}
      if(draftCurrency()==="USD"&&draft.stages.some(x=>finite(x.price)!==null))draft.currency="USD";else delete draft.currency;
    }
    setText(draft,"cardName",f.cardName.value);setText(draft,"note",f.note.value);item.buyPlan=draft;selectPurchase(item.id);saveSection("allocation");d.close();render();};
  if(!d.open)d.showModal();
  if(!found&&matchMedia("(hover:hover) and (pointer:fine)").matches)picker().focus();
}


function statusText(){const s=assetStore.status;return {off:"이 기기에만 저장 중",pending:"잠시 후 동기화",busy:"동기화 확인 중…",done:`동기화 완료 · ${s.at}`,error:`이 기기 저장됨 · ${s.message}`,choose:"기록 선택 필요 · 이 기기에만 저장 중"}[s.state];}
function updateStatus(){
  const text=statusText();if(el("purchaseSaveStatus"))el("purchaseSaveStatus").textContent=text;
  el("purchaseSyncDialogStatus").textContent=`분할매수·자산: ${text}`;el("purchaseRecovery").hidden=!assetStore.recovery().length;
  assetStore.renderNotice?.(el("assetSyncNotice"),()=>el("purchaseRecovery").click());
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
  const f=form();picker();
  f.lineEnd.oninput=f.lineLastPeriod.oninput=()=>renderLines();f.lineLastUnit.onchange=()=>renderLines();
  f.lineSet.onchange=()=>{
    const names=LINE_SETS[f.lineSet.value]||purchaseLineNames(purchaseDraft.lines);
    if(!names.some(n=>movingLineUnit(n)===f.lineStartUnit.value))f.lineStartUnit.value=movingLineUnit(names[0]);
    renderLines();
  };
  f.lineStartPeriod.oninput=()=>renderLines();
  f.lineStartUnit.onchange=()=>{
    const names=LINE_SETS[f.lineSet.value]||purchaseLineNames(purchaseDraft.lines);
    if(!names.some(n=>movingLineUnit(n)===f.lineStartUnit.value))f.lineSet.value={선:"hour",일선:"day",주선:"week",개월선:"month"}[f.lineStartUnit.value];
    renderLines();
  };
  f.lineBudget.oninput=()=>{budgetAuto=false;renderLines();};
  el("lineBudgetReset").onclick=()=>{budgetAuto=true;renderLines();};
  f.waitPeriod.oninput=()=>renderWait();f.waitUnit.onchange=()=>renderWait();
  // 방식 바꾸기: 지금 방식에 체결 기록이 있으면 바꾸지 않는다(기록이 사라지지 않게).
  all("[name=mode]").forEach(x=>x.onchange=()=>{const kept=Object.keys(purchaseBuys(purchaseDraft)).length||(purchaseDraft.stages||[]).some(purchaseStageRecorded);
    if(kept&&x.value!==originalMode){alert("체결 기록이 있어 방식을 바꿀 수 없습니다. 기록을 지우려면 계획을 삭제하고 새로 만드세요.");f.mode.value=originalMode;return;}
    renderDraft();});
  f.manualCurrency.onchange=()=>{if(f.manualCurrency.value==="USD")purchaseDraft.currency="USD";else delete purchaseDraft.currency;renderPurchaseDraft();};
  document.addEventListener("focusout",()=>setTimeout(()=>{if(redrawLater)redrawIdle();},0));
  const releasePriorityPointer=()=>{if(!priorityPointerDown)return;priorityPointerDown=false;if(redrawLater)redrawIdle();};
  document.addEventListener("pointerup",()=>{if(priorityPointerDown)setTimeout(releasePriorityPointer,0);});
  document.addEventListener("pointercancel",releasePriorityPointer);
  assetStore.subscribe(type=>{doc=assetStore.doc;prices=assetStore.prices;updateStatus();if(type==="change")redrawIdle();});
  for(const key of ["connectRepo","syncNow","disconnectRepo"]){const button=el(key),previous=button.onclick;button.onclick=e=>{previous?.call(button,e);assetStore.refreshConfig();};}
  el("purchaseExport").onclick=()=>downloadJson({...assetStore.doc,exportedAt:new Date().toISOString()},`etf-planner-assets-${new Date().toISOString().slice(0,10)}.json`);
  el("purchaseRecovery").onclick=()=>downloadJson(assetStore.recovery(),`etf-planner-assets-recovery-${new Date().toISOString().slice(0,10)}.json`);
  el("purchaseImport").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;
    try{const incoming=cleanAssets(JSON.parse(await file.text()));if(!incoming||assetsBlank(incoming))throw Error("분할매수·자산 백업 형식이 아닙니다.");
      const names=ASSET_SECTIONS.filter(s=>incoming[s]).map(s=>({allocation:"분할매수·자산 배분",ledger:"월별 손익",savings:"저축 계획",installments:"할부 계산"}[s]));
      if(confirm(`${names.join("·")} 기록을 이 파일로 바꿀까요? 지금 기록은 이 기기에 보관합니다.`)){assetStore.restore(incoming);alert("복원했습니다.");}}
    catch(error){alert(`복원 실패: ${error.message}`);}e.target.value="";};
  updateStatus();assetStore.start();
}
return {render:renderPurchases,select:selectPurchase,initialize,alertCount:()=>purchaseAlertRules(assetStore.doc,priceDoc()||assetStore.prices).length};
})();
