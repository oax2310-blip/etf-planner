// 분할매도 계산·목록·수정 창. 시세는 prices.js, 체결→자산 배분은 alloc-link.js·assets-calc.js.
// 주식은 1주, 비트코인은 0.00000001 BTC 단위의 정수로 균등 배분한다. 나머지는 회차에 고르게 넣어 합계가 보유 수량과 같도록 한다.
const sharesAt = (shares, stage, stages, digits=0) => { const scale=10**digits, units=Math.round(Number(shares)*scale), base=Math.floor(units/stages), extra=units%stages;return (base+Math.ceil((stage+1)*extra/stages)-Math.ceil(stage*extra/stages))/scale; };
const planShareDigits = p => isBitcoinTicker(p.ticker)?8:0;
const fractionalQuantity = new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
const planQuantity = (shares, p) => isBitcoinTicker(p.ticker)?`${fractionalQuantity.format(shares)} BTC`:`${won.format(shares)}주`;
const planReferenceQuantity = (shares, p) => isBitcoinTicker(p.ticker)?planQuantity(shares,p):`${fractionalQuantity.format(shares)}주`;
// 비트코인 회차표(화면 전용): 좁은 매도·체결 두 칸을 한 칸으로 합쳐 매도 수량(BTC 소수 8자리, 단위는 표 머리)을 체결 칸 위에 쌓아 보인다.
// 부분 체결 회차는 그 자리에 남은 수량을 보인다. 기준가 칸과 이평선 줄의 달러 가격은 센트를 빼고 반올림($79,031.03 → $79,031). 원화 환산 줄·알림·기록은 원래 값 그대로.
const planRowPrice = (v, p) => isBitcoinTicker(p.ticker)&&p.currency==="USD"?`$${won.format(v)}`:priceText(v,p.currency);
const hasPlanShares = (ticker, shares) => shares>0&&(isBitcoinTicker(ticker)?Number.isFinite(shares)&&Number.isSafeInteger(Math.round(shares*1e8))&&Number(shares.toFixed(8))===shares:Number.isSafeInteger(shares));
// 매도 비중(plans[].salePct, 1~99 정수 %): 보유 수량(또는 평가액만 넣은 계획은 평가액)의 이 비중만 회차에 나눠 팔고 나머지는 남긴다.
// 없으면 100%(전량) — 100이면 저장하지 않고 delete. 매도 수량은 최소 단위(1주·0.00000001 BTC)로 내림해 정한 비중보다 더 팔지 않는다.
const planSalePct = p => { const v=Number(p?.salePct); return Number.isInteger(v)&&v>=1&&v<100?v:100; };
// 종료 기준선 없는 전액매도(plans[].endPct, 0<값<100): 종료 기준가 = 시작 기준가 × (1 − endPct/100)이고 매도 비중은 100%(salePct 없음), 시작 기준가는 직접 입력.
// endLabel은 '시작가 −N%'로 두어 시세 채우기(fillPrices — 이동평균 이름이 아니면 건너뜀)가 종료 기준가를 덮어쓰지 않게 한다.
// 종료 기준가는 시작 기준가·하락률을 입력할 때만 다시 계산해 저장하고, 회차·알림은 기존처럼 저장된 startPrice·endPrice로 계산한다.
const planEndPct = p => { const v=Number(p?.endPct); return Number.isFinite(v)&&v>0&&v<100?v:null; };
const pctEndPrice = (start, pct, ticker, currency) => priceRound(Number(start)*(1-pct/100), quoteDigits(ticker,currency));
const pctEndLabel = pct => `시작가 −${Math.round(pct*100)/100}%`;
const saleShares = (shares, p) => { const scale=10**planShareDigits(p); return Math.floor(Math.round(Number(shares)*scale)*planSalePct(p)/100)/scale; };
// 자동 기준가가 비어 있으면 보간하지 않는다. 두 기준가가 모두 준비된 뒤 회차 가격을 계산한다.
const stagePrice = (plan, stage) => plan.startPrice>0&&plan.endPrice>0?plan.startPrice - (plan.startPrice - plan.endPrice) * stage / Math.max(plan.stages - 1, 1):null;
const defaultPlan = (ticker, title, opts) => ({id:id(), ticker, title, currency:"USD", holdings:[], startLabel:"60일선", endLabel:"25개월선", startPrice:100, endPrice:80, stages:30, checked:Array(30).fill(false), valueKrw:null, fx:1354.91, note:"", ...opts});
function selected(){ return state.plans.find(p=>p.id===state.selectedPlan) || state.plans[0] || null; }
// 계획 종목 시세(prices.js): 통화가 맞을 때만(국내=원화 계획, 해외·비트코인=달러 계획)
const planQuote = (ticker, currency) => { const e=stockEntry(priceData,planTicker(ticker));return e&&e.kind===planQuoteKind(ticker,currency)?e:null; };
// 평가액(만원) = 수량 × 현재가(달러 계획은 × 환율) ÷ 1만. 시세가 없으면 null. 화면에만 쓰고 저장하지 않는다(현재가처럼).
// 보유 수량이 있는 계획은 이 값만 쓰고 valueKrw(직접 입력한 평가액)는 보유 수량 없이 평가액만 있는 계획에만 쓴다.
const planWorth = (shares, close, currency, fx) => { const rate=currency==="KRW"?1:Number(fx); return shares>0&&Number(close)>0&&rate>0?shares*Number(close)*rate/1e4:null; };
// 평가액만 넣은 계획(보유 수량 없이 valueKrw)의 회차 금액(만원): 주수 계획처럼 회차마다 같은 수량을 판다고 보고 회차 기준가에 비례해 나눈다(같은 금액씩 나누지 않음).
// 수량 = 평가액 ÷ valueBase(평가액 저장 때 종목 시세, 옛 basisPrice와 별개). 없으면 지금 첫 매도 기준가로 나눈다.
const valueBasis = p => Number(p.valueBase)>0?Number(p.valueBase):Number(p.startPrice);
const stageWorth = (p, price) => { const b=valueBasis(p); return price==null?null:p.valueKrw*planSalePct(p)/100/p.stages*(b>0?price/b:1); };
// 남은 보유 수량: 부분 체결을 포함한 실제 매도 수량만 최소 단위 정수로 빼며, 매도 비중으로 남기는 수량도 포함한다.
const sharesLeft = p => { const scale=10**planShareDigits(p), held=p.holdings.reduce((s,h)=>s+Math.round(Number(h.shares||0)*scale),0);
  if(Object.values(p.fills||{}).some(f=>f.execution))return Number(Math.max(0,held/scale-Array.from({length:p.stages},(_,i)=>planStageProgress(p,i).qty||0).reduce((s,n)=>s+n,0)).toFixed(8));
  return Math.max(0,held-Array.from({length:p.stages},(_,i)=>Math.round((planStageProgress(p,i).qty||0)*scale)).reduce((s,n)=>s+n,0))/scale; };
// alloc-link.js(없으면 체크만): 같은 종목 코드 계좌 보유량을 줄이고 풀면 되돌림. 취소에 쓰는 키 'sell:계획 id:회차' 형식 유지.
function planLink(fn, ...args){
  if(typeof allocLink==="object")return allocLink[fn](...args);
  if(fn==="check"){args[0].commit();args[0].redraw?.();}
  return fn==="line"?"":null;
}
// 회차 체결(자산 배분 연동 — assets-calc.js 체결): 보유 수량 계획은 회차 매도 수량 합 × 회차 기준가, 평가액만 넣은 계획은 회차 매도액(stageWorth)만.
const planTrade = (p, i) => { const price=stagePrice(p,i), digits=planShareDigits(p), valueOnly=p.valueKrw!=null&&!p.holdings.length, qty=p.holdings.reduce((n,h)=>n+sharesAt(saleShares(h.shares,p),i,p.stages,digits),0);
  return {sign:-1,qty:valueOnly?null:Number(qty.toFixed(digits))||null,price,currency:p.currency,value:valueOnly?stageWorth(p,price):null}; };
// fills[회차]={plannedQty,qty,price} 또는 {plannedValue,value,price}: 첫 체결 때 예정량·가격 고정, 누적량·잔량 유지.
// 체크 전에도 입력 가능; checked는 전량 완료만. 옛 checked=true는 기존 전량 체결로 읽고 입력 때 새 필드로 저장.
function planStageProgress(p,i){
  const planned=planTrade(p,i),fill=p.fills?.[i],byValue=p.valueKrw!=null&&!p.holdings.length, target=byValue?fill?.plannedValue??planned.value:fill?.plannedQty??planned.qty??(p.holdings.length?0:null);
  const amount=byValue?fill?.value??(p.checked?.[i]?target:0):fill?.qty??(p.checked?.[i]?target:0), remaining=Number(Math.max(0,(target||0)-(amount||0)).toFixed(8));
  return {target,amount:amount||0,remaining,recorded:!!fill||!!p.checked?.[i],done:!!p.checked?.[i],byValue,
    qty:byValue?null:amount||0,trade:{...planned,price:fill?.price??planned.price,qty:byValue?null:amount||0,value:byValue?amount||0:null}};
}
// 누적 체결 입력·전량 체크 공통. 추가 체결은 기존 반영 키를 rescale해 차이만 반영하고, 0이면 기존 자산 반영을 되돌린다.
function recordPlanFill(p,i,n,redraw=renderPlans,quantity=null){
  const r=planStageProgress(p,i),key=`sell:${p.id}:${i}`;
  if(!Number.isFinite(n)||n<0||n>0&&!(r.trade.price>0)||!quantity&&n>(r.target||0)||!r.byValue&&n>0&&!hasPlanShares(p.ticker,n))return redraw();
  if(n===0&&!quantity?.qty){p.checked[i]=false;if(p.fills){delete p.fills[i];if(!Object.keys(p.fills).length)delete p.fills;}save();planLink("uncheck",key);return redraw();}
  const fill={price:r.trade.price,...(r.byValue?{plannedValue:r.target,value:n,...(quantity?{plannedQty:quantity.target,qty:quantity.qty}:{})}:{plannedQty:r.target,qty:n})},trade={...r.trade,...(r.byValue?{value:n,...(quantity?{qty:quantity.qty}:{})}:{qty:n})};
  const commit=()=>{const q=state.plans.find(x=>x.id===p.id);if(q!==p||i>=q.stages)return false;q.fills={...(q.fills||{}),[i]:fill};q.checked[i]=quantity?quantity.qty>=quantity.target:n>=r.target;save();return key;};
  if(r.recorded){if(commit())planLink("rescale",key,trade);redraw();}
  else planLink("check",{ticker:planTicker(p.ticker),trade,label:`${p.title} ${i+1}회 매도`,prefer:[`sell:${p.id}:`],redraw,commit});
}
// 체결 입력은 수량만. 평가액만 있는 옛 계획도 회차 가격·환율로 계획 주수를 내림해 표시하고, 금액은 수량에서 자동 계산한다.
// 추종 ETF 환산(referenceOnly)은 기준 ETF 수량의 소수부를 유지하고, 실제 ETF 주수를 계산할 때만 내림한다.
function planSourceQuantityProgress(p,i,referenceOnly=false){
  const r=planStageProgress(p,i);if(!r.byValue)return r;
  const scale=10**planShareDigits(p),rate=p.currency==="USD"?Number(p.fx):1,price=r.trade.price,cost=price*rate;
  const rec=typeof assetStore==="object"?assetStore.doc?.allocation?.trades?.[`sell:${p.id}:${i}`]:null,items=Array.isArray(rec?.items)?rec.items:[];
  const applied=Number.isFinite(rec?.qty)?rec.qty:items.length&&items.every(e=>Number.isFinite(e.shares))?Math.abs(items.reduce((n,e)=>n+e.shares,0)):null;
  const target=p.fills?.[i]?.plannedQty??(cost>0?referenceOnly?r.target*1e4/cost:Math.floor(r.target*1e4/cost*scale+1e-9)/scale:null);
  const amount=p.fills?.[i]?.qty??applied??(cost>0?Math.round(r.amount*1e4/cost*scale)/scale:0);
  return {...r,byValue:false,target,amount,remaining:target===null?null:Number(Math.max(0,target-amount).toFixed(8))};
}
function planSaleAssets(){return typeof assetStore==="object"?assetStore.doc?.allocation:null;}
function planSaleItems(){return (planSaleAssets()?.groups||[]).flatMap(g=>(g.items||[]).filter(it=>["국내","해외"].includes(purchaseQuoteKind(assetTradeTicker(it)))).map(it=>({g,it})));}
function planSalePrices(){return {stocks:{...(typeof priceData==="object"?priceData?.stocks:{}),...(typeof assetStore==="object"?assetStore.prices?.stocks:{})}};}
// 같은 기준 티커에 연결된 모든 계좌와 직접 보유 종목을 한 계획으로 읽는다. 선택했던 계좌 필드는 옛 체결 호환용으로 유지한다.
// 조회로 기록을 만들지 않으며, 나중에 등록한 직접 보유·추종 ETF도 미체결 회차에 자동 포함한다(BTC는 기존 계산 유지).
function planLinkedSaleItems(p){
  if(isBitcoinTicker(p.ticker))return [];
  const ticker=linkTicker(p.ticker),priority=new Map();
  for(const key of Array.isArray(p.sellPriority)?p.sellPriority:[])if(typeof key==="string"&&!priority.has(key))priority.set(key,priority.size);
  return planSaleItems().filter(({it})=>linkTicker(it.ticker)===ticker||linkTicker(assetTradeTicker(it))===ticker)
    .sort((a,b)=>(priority.get(a.it.id)??priority.size)-(priority.get(b.it.id)??priority.size));
}
// execution.group의 rows는 회차별 계좌·실제 코드·계획/누적 주수·가격을 고정한다. 옛 단일 execution·자산 반영 기록도 읽는다.
function planRecordedSaleRows(p,i){
  const e=p.fills?.[i]?.execution;
  if(e?.group)return e.rows;
  if(e)return [e];
  const rec=planSaleAssets()?.trades?.[`sell:${p.id}:${i}`];
  return (rec?.items||[]).filter(r=>Number.isFinite(r.shares)&&r.shares<0).map(r=>({targetId:r.id,qty:-r.shares,plannedQty:-r.shares}));
}
function planSaleHolding(found,p){
  const prices=planSalePrices(),quote=assetTradeQuote(prices,found.it),q=quote?.kind===purchaseQuoteKind(assetTradeTicker(found.it))?quote:null,fx=Number(p.fx);
  const unit=finite(found.it.shares)!==null?"shares":"amount",value=itemValue(found.it,prices,fx).value,cost=q?krwPrice(q,fx):null;
  const held=unit==="shares"?Math.floor(Math.max(0,Number(found.it.shares))):!(value>0)?0:cost>0?Math.floor(value*1e4/cost+1e-9):null;
  return {targetId:found.it.id,ticker:assetTradeTicker(found.it),account:found.g.name,name:found.it.name,unit,held,
    price:q?.close??null,currency:q?.currency||"KRW",fx,asOf:q?.asOf||"",manual:!!q?.manual,stale:!!q?.stale};
}
// 실제 코드별 전체 보유량 × 매도 비중을 한 번만 내림한다. 현재 보유량에 실제 체결량을 더해 원래 수량을 복원하고 고정 회차의 계획량을 먼저 확보한다.
// 남은 목표는 sellPriority의 자산 id 순서(없으면 자산 목록 순서)로 계좌 보유량 한도까지 배정한다. 새 종목은 저장된 순서 뒤에 둔다.
// 전체 남은 매도 주수를 미체결 회차에 균등 분할하고 앞 계좌의 예정 물량을 소진한 뒤 다음으로 넘어간다. 경계 회차만 여러 계좌에 배정한다.
// 가격·환율은 주수 배분에 쓰지 않으며, 순서 변경은 부분 체결·완료 회차의 종목·계획량·가격을 바꾸지 않는다.
function planLinkedSaleSchedule(p){
  const items=planLinkedSaleItems(p);if(!items.length)return null;
  const recorded=Array.from({length:p.stages},(_,i)=>planRecordedSaleRows(p,i)),open=Array.from({length:p.stages},(_,i)=>i).filter(i=>!p.fills?.[i]&&!p.checked?.[i]);
  const rows=items.map(found=>{const row=planSaleHolding(found,p),past=recorded.flat().filter(r=>r.targetId===row.targetId),sold=past.reduce((n,r)=>n+(r.qty||0),0),reserved=past.reduce((n,r)=>n+(r.plannedQty||0),0);
    return {...row,sold,reserved,original:row.held===null?null:row.held+sold,quota:null,planned:Array(p.stages).fill(0)};});
  const groups=new Map();for(const row of rows){if(!groups.has(row.ticker))groups.set(row.ticker,[]);groups.get(row.ticker).push(row);}
  for(const group of groups.values()){
    if(group.some(r=>r.original===null))continue;
    const target=Math.floor(group.reduce((n,r)=>n+r.original,0)*planSalePct(p)/100+1e-9);
    let remaining=Math.max(0,target-group.reduce((n,r)=>n+r.reserved,0));
    for(const row of group){
      const amount=Math.min(remaining,Math.max(0,row.original-row.reserved));
      row.quota=row.reserved+amount;remaining-=amount;
    }
  }
  if(rows.some(r=>r.quota===null)){
    for(const row of rows.filter(r=>r.quota===null))for(const i of open)row.planned[i]=null;
  }else{
    const remaining=rows.map(r=>r.quota-r.reserved),total=remaining.reduce((n,v)=>n+v,0);
    for(let s=0;s<open.length;s++){
      let amount=sharesAt(total,s,open.length);
      rows.forEach((row,j)=>{const n=Math.min(amount,remaining[j]);row.planned[open[s]]=n;remaining[j]-=n;amount-=n;});
    }
  }
  return {rows,open};
}
function planLinkedSaleExecution(p,i){
  const stored=p.fills?.[i]?.execution;
  let rows;
  if(stored?.group){
    rows=stored.rows.map(row=>{const found=planSaleItems().find(x=>x.it.id===row.targetId);
      return row.qty||!found?{...row}:{...row,...planSaleHolding(found,p),plannedQty:row.plannedQty,qty:0};});
  }else{
    const schedule=planLinkedSaleSchedule(p);if(!schedule)return null;
    rows=schedule.rows.map(({sold,reserved,original,quota,planned,...row})=>({...row,plannedQty:planned[i],qty:0}));
  }
  const target=rows.some(r=>r.plannedQty===null)?null:rows.reduce((n,r)=>n+r.plannedQty,0);
  return {group:true,rows,sourcePrice:stored?.sourcePrice??stagePrice(p,i),plannedQty:target,qty:rows.reduce((n,r)=>n+r.qty,0),recorded:!!stored};
}
// 각 계좌의 누적 체결을 그대로 반영한다. 회차 전체 체크는 모든 계좌의 잔량을 채우며, 정정은 이전 반영을 되돌린 뒤 정확한 계좌별 양으로 다시 반영한다.
function recordPlanGroupFill(p,i,changes,complete=false,redraw=renderPlans){
  const e=planSaleExecution(p,i);if(!e?.group||!(e.sourcePrice>0))return redraw();
  const key=`sell:${p.id}:${i}`,rows=e.rows.map(row=>({...row,qty:changes?.has(row.targetId)?changes.get(row.targetId):row.qty}));
  if(rows.some(r=>!Number.isSafeInteger(r.qty)||r.qty<0||r.plannedQty===null||r.qty>r.plannedQty))return redraw();
  const qty=rows.reduce((n,r)=>n+r.qty,0);
  if(!qty&&!complete){p.checked[i]=false;if(p.fills){delete p.fills[i];if(!Object.keys(p.fills).length)delete p.fills;}save();planLink("uncheck",key);return redraw();}
  const picks=[];let value=0;
  for(const row of rows){
    if(!row.qty)continue;
    const found=planSaleItems().find(x=>x.it.id===row.targetId),old=e.rows.find(r=>r.targetId===row.targetId)?.qty||0,held=found?planSaleHolding(found,p).held:null,rate=row.currency==="USD"?row.fx:1;
    if(!found||linkTicker(assetTradeTicker(found.it))!==linkTicker(row.ticker)||!(row.price>0)||!(rate>0)||held===null||row.qty-old>held)return redraw();
    const amount=row.qty*row.price*rate/1e4;value+=amount;picks.push({id:row.targetId,unit:row.unit,n:row.unit==="shares"?row.qty:amount});
  }
  const source=planStageProgress(p,i),ratio=e.plannedQty>0?qty/e.plannedQty:1;
  const fill={price:e.sourcePrice,...(source.byValue?{plannedValue:source.target,value:source.target*ratio}:{plannedQty:source.target,qty:(source.target||0)*ratio}),execution:{group:true,sourcePrice:e.sourcePrice,plannedQty:e.plannedQty,qty,rows:rows.map(({held,...row})=>row)}};
  const commit=()=>{if(state.plans.find(x=>x.id===p.id)!==p)return false;p.fills={...(p.fills||{}),[i]:fill};p.checked[i]=rows.every(r=>r.qty>=r.plannedQty);save();return key;};
  planLink("check",{trade:{sign:-1,qty:qty||null,value:value||null,currency:"KRW"},picks,label:`${p.title} ${i+1}회 통합 매도`,redraw,commit});
}
// 기존 자산 id에서 실제 ETF 코드·현재가를 읽고 기준 ETF 현재가×주수×환율을 실제 ETF 정수 주로 내림(보유량 한도).
// 기준 시세가 없으면 회차 기준가. 첫 체결 execution={targetId,ticker,account,name,price,currency,fx,sourceQty,sourcePrice,referencePrice,plannedQty,qty,…} 고정.
// execution.qty는 실제 ETF 주수, 바깥 fills.qty는 기준 수량 환산값. 기존 회차 추가/취소는 고정한 원래 자산 id에 반영.
function planSaleExecution(p,i){
  const stored=p.fills?.[i]?.execution;
  if(stored)return stored.group?planLinkedSaleExecution(p,i):{...stored,recorded:true};
  if(planStageProgress(p,i).recorded)return null; // 옛 체결은 당시 기준 ETF 단위 유지
  const linked=planLinkedSaleExecution(p,i);if(linked)return linked;
  if(!p.sellTargetId)return null;
  const found=planSaleItems().find(x=>x.it.id===p.sellTargetId),quote=found&&assetTradeQuote(planSalePrices(),found.it),q=quote?.kind===purchaseQuoteKind(assetTradeTicker(found?.it))?quote:null,fx=Number(p.fx),price=q?krwPrice(q,fx):null;
  const same=found&&linkTicker(assetTradeTicker(found.it))===planTicker(p.ticker),source=planSourceQuantityProgress(p,i,!same);
  const sourceQuote=assetQuote(planSalePrices(),planTicker(p.ticker)),reference=sourceQuote?.kind===planQuoteKind(p.ticker,p.currency)?sourceQuote:null,referencePrice=Number(reference?.close)>0?Number(reference.close):source.trade.price;
  const sourceRate=p.currency==="USD"?fx:1,budget=source.target!==null&&sourceRate>0?source.target*referencePrice*sourceRate:null;
  const shares=found?finite(found.it.shares):null,value=found?itemValue(found.it,planSalePrices(),fx).value:null;
  const held=shares!==null?Math.floor(Math.max(0,shares)):price>0?Math.floor(Math.max(0,value||0)*1e4/price+1e-9):null;
  const converted=same?source.target:budget!==null&&price>0?Math.floor(budget/price+1e-9):null,plannedQty=converted!==null&&held!==null?Math.min(converted,held):null;
  return {targetId:p.sellTargetId,ticker:found?assetTradeTicker(found.it):"",account:found?.g.name||"삭제된 계좌",name:found?.it.name||"삭제된 종목",price:q?.close??null,currency:q?.currency||"KRW",asOf:q?.asOf||"",manual:!!q?.manual,stale:!!q?.stale,fx,sourceQty:source.target,sourcePrice:source.trade.price,referencePrice,referenceAsOf:reference?.asOf||"",plannedQty,qty:0,capped:converted!==null&&plannedQty<converted};
}
function planQuantityProgress(p,i){
  const raw=planSourceQuantityProgress(p,i),execution=planSaleExecution(p,i);
  if(execution)return {...raw,execution,target:execution.plannedQty,amount:execution.qty,remaining:execution.plannedQty===null?null:Math.max(0,execution.plannedQty-execution.qty)};
  if(p.sellAccountId&&!p.sellTargetId&&!raw.recorded)return {...raw,target:null,remaining:null,pendingAccount:true};
  return raw;
}
function recordPlanExecution(p,i,n,redraw){
  const r=planQuantityProgress(p,i),e=r.execution,key=`sell:${p.id}:${i}`;
  if(!e||!Number.isSafeInteger(n)||n<0||n>0&&!(e.sourcePrice>0)||e.plannedQty===null||n>e.plannedQty)return redraw();
  if(n===0){p.checked[i]=false;if(p.fills){delete p.fills[i];if(!Object.keys(p.fills).length)delete p.fills;}save();planLink("uncheck",key);return redraw();}
  if(!planSaleItems().some(x=>x.it.id===e.targetId))return redraw();
  const source=planStageProgress(p,i),rate=e.currency==="USD"?e.fx:1,trade={sign:-1,qty:n,price:e.price,currency:e.currency,value:Number((n*e.price*rate/1e4).toFixed(8))};
  const fill={price:e.sourcePrice,...(source.byValue?{plannedValue:source.target,value:source.target*n/e.plannedQty}:{plannedQty:e.sourceQty,qty:e.sourceQty*n/e.plannedQty}),execution:{...e,qty:n}};delete fill.execution.recorded;
  const commit=()=>{if(state.plans.find(x=>x.id===p.id)!==p)return false;p.fills={...(p.fills||{}),[i]:fill};p.checked[i]=n>=e.plannedQty;save();return key;};
  if(e.recorded){if(commit())planLink("rescale",key,trade);redraw();}
  else planLink("check",{ticker:e.ticker,ownId:e.targetId,targetId:e.targetId,trade,label:`${p.title} ${i+1}회 매도`,redraw,commit});
}
function recordPlanQuantity(p,i,n,redraw=renderPlans){
  const execution=planSaleExecution(p,i);
  if(execution?.group){
    if(n!==0&&n!==execution.plannedQty&&execution.rows.length!==1)return redraw();
    return recordPlanGroupFill(p,i,new Map(execution.rows.map(r=>[r.targetId,n===execution.plannedQty?r.plannedQty:n])),n!==0&&n===execution.plannedQty,redraw);
  }
  if(execution)return recordPlanExecution(p,i,n,redraw);
  if(p.sellAccountId&&!p.sellTargetId&&!planStageProgress(p,i).recorded)return redraw();
  const raw=planStageProgress(p,i);if(!raw.byValue)return recordPlanFill(p,i,n,redraw);
  const r=planQuantityProgress(p,i);if(!Number.isFinite(n)||n<0||r.target===null||n>r.target||n>0&&!hasPlanShares(p.ticker,n))return redraw();
  const value=Number((n*r.trade.price*(p.currency==="USD"?p.fx:1)/1e4).toFixed(8));
  if(raw.recorded&&typeof assetStore==="object"){
    const rec=assetStore.doc?.allocation?.trades?.[`sell:${p.id}:${i}`];
    if(rec&&rec.qty==null&&r.amount>0){rec.qty=r.amount;assetStore.saveSection("allocation");}
  }
  return recordPlanFill(p,i,value,redraw,{qty:n,target:r.target});
}
// 도달 = 완료 전 회차 중 현재가(통화가 맞는 계획 종목 시세)가 회차 기준가에 닿은 회차(종료가 시작보다 높으면 현재가 ≥ 기준가, 아니면 ≤ — trade-alerts.js 알림 방향과 같음).
// 계획 진행 카드(띠·칩·범례)와 회차표가 같은 기준을 쓴다. 회차표는 체결 기록이 없는 도달 회차만 줄 강조·회차 번호 아래·상태 칸에 '도달'로 보이고 부분 체결 회차는 부분 체결로 둔다.
const planNow = p => { const px=planQuote(p.ticker,p.currency); return Number(px?.close)>0?Number(px.close):null; };
const planStageDue = (p, r, now) => now!==null&&!r.done&&r.trade.price>0&&(Number(p.endPrice)>Number(p.startPrice)?now>=r.trade.price:now<=r.trade.price);
// 회차표는 분할매수 회차표(purchases.js row·css/purchases.css)와 같은 모양: 회차(아래 도달·남은 수량) · 기준가(달러면 원화 환산) · 매도 수량 · 누적 체결 입력 · 알림 · 상태(PC).
// 회차를 파는 종목(통합 매도의 계좌·종목, 계좌 선택 매도의 실제 ETF, 직접 입력의 보유 종목 하나) 중 지금 매도 중인 종목만 표 위 '매도 종목'에 둔다(planSaleSellers): 새 체결이 들어갈 회차
// (미체결 → 부분 체결 → 전체) 중 첫 회차의 종목이며, 그 회차를 여러 계좌로 나눴으면 그 계좌들을 우선순위 순서로 모두. 매도 우선순위를 바꾸거나 앞 계좌를 다 팔면 바뀐다.
// 표 위 줄이 있으면 미체결 회차에는 종목을 반복하지 않고(뒤 계좌가 팔 회차도 그 계좌 차례가 되면 표 위에 보임), 지금 매도 중이 아닌 종목으로 체결한 완료·부분 체결 회차만 회차 아래 작은 줄에 둔다.
// 한 회차를 여러 계좌로 나눈 통합 매도 회차는 계좌마다 작은 줄과 입력칸이며
// 줄 이름은 계좌(굵게)·종목 이름, 종목 이름 끝 괄호(예: '(연저펀)', 규칙은 stock-names.js titleParts)가 있으면 그 꼬리표를 굵게 해 좁은 칸에서 잘려도 구분한다. 체크는 모든 계좌의 잔량까지 완료, 입력·체크·알림 저장 키는 그대로.
function planSaleRowInfo(p,i){
  const r=planQuantityProgress(p,i),e=r.execution,group=!!e?.group,price=group?e.sourcePrice:r.trade.price,priced=price>0;
  const live=row=>priced&&row.price>0&&(row.currency!=="USD"||row.fx>0)&&planSaleItems().some(x=>x.it.id===row.targetId);
  const members=group?e.rows.filter(row=>row.plannedQty!==0||row.qty).map(row=>({...row,valid:live(row)})):[];
  const seller=x=>({key:x.targetId,name:x.name,account:x.account,ticker:x.ticker,price:x.price,currency:x.currency,manual:x.manual,stale:x.stale,live:true});
  const own=p.holdings.length===1?p.holdings[0].name:p.valueKrw!=null&&!p.holdings.length?p.title:"";
  const holder=group?members.length>1?{many:true}:members.length?seller(members[0]):null:e?seller(e):r.pendingAccount||!own?null:{key:"",name:own,account:"",ticker:p.ticker};
  return {i,r,e,group,price,priced,members,holder,sellers:holder?.many?members.map(seller):holder?[holder]:[],ready:group&&priced&&e.rows.every(row=>row.plannedQty!==null&&(!row.plannedQty||live(row)))};
}
function planSaleSellers(infos){
  const base=[infos.filter(x=>!x.r.recorded),infos.filter(x=>!x.r.done),infos].find(x=>x.length)||[],named=x=>x.sellers.filter(h=>String(h.name||"").trim());
  const now=base.find(x=>named(x).length);return now?named(now):[];
}
const planSellerText = h => [h.account,h.ticker&&h.ticker!==h.name?h.ticker:"",...(h.live?[h.price>0?priceText(h.price,h.currency):"시세 대기",h.manual?"직접 입력":"",h.stale?"지난 시세":""]:[])].filter(Boolean).join(" · ");
function planSellerHead(sellers){
  if(!sellers.length)return "";
  if(sellers.length===1)return `<div class="purchase-buy-target"><span>매도 종목</span><div><b>${esc(sellers[0].name)}</b>${(t=>t?`<small>${esc(t)}</small>`:"")(planSellerText(sellers[0]))}</div></div>`;
  return `<div class="purchase-buy-target many"><span>매도 종목</span><ol class="sale-sellers">${sellers.map(h=>`<li><b>${esc(h.name)}</b>${(t=>t?`<small>${esc(t)}</small>`:"")(planSellerText(h))}</li>`).join("")}</ol></div>`;
}
function planSaleRow(p,i,sellers=[],info=planSaleRowInfo(p,i)){
  const {r,e,group,price,priced,members,holder}=info,partial=r.recorded&&!r.done,due=!r.recorded&&planStageDue(p,r,planNow(p)),state=r.done?"done":partial?"partial":due?"due":"";
  const digits=e?0:planShareDigits(p),unit=digits?"BTC":"주",qty=n=>group?`${won.format(n)}주`:planQuantity(n,p),shown=r.done?r.amount:r.target;
  const left=digits&&partial&&r.remaining!==null,flag=partial?r.remaining!==null&&!left?`남은 ${qty(r.remaining)}`:"부분 체결":due?"도달":"",priceLabel=priced?planRowPrice(price,p):"—";
  const memberInput=m=>`<input type="number" min="0" max="${m.plannedQty}" step="1" inputmode="numeric" data-sale-member="${esc(m.targetId)}" data-sale-stage="${i}" value="${esc(m.qty)}" placeholder="0"${!m.valid||!m.plannedQty?" disabled":""} aria-label="${i+1}회 ${esc(m.account)} ${esc(m.name)} 매도 누적 체결 수량 (주)">`;
  const one=group&&members.length===1?members[0]:null;
  const input=group?one&&one.plannedQty!==null?memberInput(one):"":r.target!==null?`<input type="number" min="0" max="${r.target}" step="${digits?"0.00000001":"1"}" inputmode="${digits?"decimal":"numeric"}" data-sale-filled="${i}" value="${esc(r.amount)}" placeholder="0"${!priced||e&&r.target===0?" disabled":""} aria-label="${i+1}회 매도 누적 체결 수량 (${unit})">`:"";
  const memberName=m=>{const t=stockNames.titleParts(m.name);return t.tag?[t.tag,[m.account,t.main].filter(Boolean).join(" · ")]:[m.account,m.name];};
  const lines=group&&members.length>1?members.map(m=>`<div class="sale-member-line"><span title="${esc(`${m.account} · ${m.name} (${m.ticker})`)}">${(([b,s])=>`<b>${esc(b)}</b><small>${esc(s)}</small>`)(memberName(m))}</span><span class="purchase-qty">${m.plannedQty===null?"—":`${won.format(m.plannedQty)}주`}</span><div class="purchase-fill">${m.plannedQty!==null?memberInput(m):""}</div></div>`).join(""):"";
  const listed=Array.isArray(sellers)&&sellers.length>0&&holder&&!holder.many&&(!r.recorded||sellers.some(h=>h.key===holder.key));
  const notes=[holder&&!holder.many&&!listed?[holder.account&&holder.name?`${holder.account} · ${holder.name}`:holder.name,holder.ticker&&holder.ticker!==holder.name?holder.ticker:""].filter(Boolean).join(" · "):"",
    group?r.target===null?"계좌별 보유량 확인 필요":r.target===0?"이번 회차 배정 없음":members.some(m=>m.plannedQty&&!m.valid)?"실제 종목의 시세·환율·보유 기록을 확인하세요.":""
    :e?e.plannedQty===null?"실제 ETF 가격·환율·보유량을 확인하세요.":e.capped?"보유량으로 제한":""
    :r.pendingAccount?"계좌의 보유 ETF를 먼저 선택하세요.":r.target===null?"보유량 입력 필요":!r.recorded&&p.holdings.length>1?p.holdings.map(h=>`${h.name} ${planQuantity(sharesAt(saleShares(h.shares,p),i,p.stages,digits),p)}`).join(" · "):""].filter(Boolean);
  const disabled=group?!info.ready:!priced||(e||r.pendingAccount)&&!(r.target>0);
  return `<div class="purchase-row${state?` ${state}`:""}"><label class="check" title="${group?"모든 연결 계좌의 잔량까지 매도 완료":"잔량까지 매도 완료"}"><input type="checkbox" data-stage="${i}"${r.done?" checked":""}${partial?' data-sale-partial="true" aria-checked="mixed"':""}${disabled?" disabled":""} aria-label="${i+1}회 ${group?"전체 계좌 ":""}매도 완료"><span class="purchase-round"><b>${i+1}회</b>${flag?`<small>${esc(flag)}</small>`:""}</span></label>
    <div class="stage-price"><span class="price${priceLabel.length>9?" xlong":priceLabel.length>7?" long":""}">${esc(priceLabel)}</span>${p.currency==="USD"?`<span class="krw">${priced?fxText(price*p.fx):"시세 대기"}</span>`:""}</div>
    <div class="purchase-qty">${left?`<small class="qty-left">남은</small>${esc(fractionalQuantity.format(r.remaining))}`:shown===null?"—":digits?esc(fractionalQuantity.format(shown)):esc(qty(shown))}</div><div class="purchase-fill">${input}</div>${typeof tradeAlertToggle==="function"?`<div class="purchase-alert">${tradeAlertToggle(tradePlanEnabled(p,i),`data-sale-alert="${i}"`,`${i+1}회 매도`,r.done)}</div>`:""}
    <div class="status${state?` ${state}`:""}">${r.done?"매도 완료":partial?"부분 체결":due?"도달":"대기"}</div>${notes.length?`<small class="purchase-sub">${esc(notes.join(" · "))}</small>`:""}${lines}</div>`;
}
// 회차표 이평선 위치(화면 전용): 같은 간격·같은 수량의 회차는 그대로 두고, 지금 시세의 일선·주선·월선 중 시작·종료 기준가 사이에 있는 선을
// 그 선에 처음 닿거나 넘는 회차(하락 계획은 회차 기준가 ≤ 선, 상승은 ≥) 앞에 한 줄로 보인다. 시작·종료 기준선 자체와 60분봉 N선은 빼고,
// 같은 회차 앞의 선은 한 줄에 가까운 순서로 모은다. rows = planSaleRowInfo 목록(체결 회차는 첫 체결 가격). 계산·저장·알림에는 쓰지 않는다.
function planLineMarks(p,rows){
  const q=planQuote(p.ticker,p.currency),a=Number(p.startPrice),b=Number(p.endPrice),out=new Map();
  if(!q||!(a>0)||!(b>0)||a===b)return out;
  const up=b>a,skip=new Set([p.startLabel,p.endLabel].map(movingLineName).filter(Boolean)),digits=quoteDigits(p.ticker,p.currency);
  for(const name of MA_LINES){
    if(movingLineUnit(name)==="선"||skip.has(name))continue;
    const v=priceRound(maValue(q,name),digits),at=v>0&&(up?v>a&&v<b:v<a&&v>b)?rows.find(x=>x.priced&&(up?x.price>=v:x.price<=v)):null;
    if(at){if(!out.has(at.i))out.set(at.i,[]);out.get(at.i).push({name,price:v});}
  }
  for(const list of out.values())list.sort((x,y)=>up?x.price-y.price:y.price-x.price);
  return out;
}
// 선 줄은 바로 다음 회차가 매도 완료면 그 회차와 함께 접힌다(완료 회차 접기).
const planLineMark = (p,list,done) => `<div class="sale-line-mark${done?" done":""}" role="note" aria-label="${esc(list.map(m=>`${movingLineText(m.name)} ${planRowPrice(m.price,p)}`).join(", "))} 위치">${list.map(m=>`<span><b>${esc(movingLineText(m.name))}</b>${esc(planRowPrice(m.price,p))}</span>`).join("")}</div>`;
function planSaleAccountView(p){
  if(isBitcoinTicker(p.ticker))return "";
  const schedule=planLinkedSaleSchedule(p),summary=allocationSummary(planSaleAssets(),typeof assetStore==="object"?assetStore.prices:null);
  if(schedule){
    const rows=schedule.rows.filter(r=>r.held!==0||r.sold),known=rows.every(r=>r.held!==null),total=rows.reduce((n,r)=>n+(r.held||0),0);
    // 보유 평가액·비중은 매수 목록과 같은 자산현황 기준. 남은 매도 주수·우선순위·체결의 계산과 기록에는 반영하지 않는다.
    const infos=new Map(rows.map(r=>[r.targetId,allocationHoldingInfo(allocItemById(planSaleAssets(),r.targetId),summary)])),valuation=allocationHoldingTotal(infos.values(),summary);
    return `<section class="card panel sale-account sale-linked"><div class="sale-linked-heading"><h2>연결된 전체 보유 종목</h2><strong>${valuation.valueText}</strong></div><p class="hint sale-linked-summary">전체 계좌 ${rows.length}개 항목 · 현재 ${valuation.pctText} · ${known?`${won.format(total)}주 보유`:"보유량 확인 필요"}${valuation.pendingCount?` · 평가 대기 ${valuation.pendingCount}개`:""}</p><p class="hint sale-linked-policy">매도 우선순위 · 위에서부터 한 계좌씩 매도합니다.</p><div class="sale-linked-holdings" aria-label="매도 우선순위">${rows.map((r,j)=>{
      const it=allocItemById(planSaleAssets(),r.targetId),info=infos.get(r.targetId),path=[r.account,it.section,r.ticker].filter(Boolean).map(esc).join(" · "),remaining=r.quota===null?"계획 계산 대기":`계획 ${won.format(Math.max(0,r.quota-r.sold))}주`;
      return `<div class="sale-linked-holding" data-sale-priority-row="${esc(r.targetId)}"><span class="sale-priority-rank" aria-label="${j+1}순위">${j+1}</span><div class="sale-holding-details"><div class="sale-holding-title"><strong>${esc(r.name)}</strong>${j===0?'<span class="sale-holding-tag">매도 우선</span>':""}</div><small class="sale-holding-meta">${path} · <span title="남은 매도 계획">${remaining}</span></small><div class="sale-holding-stats"><small class="sale-holding-quantity">${info.quantityText}${info.pending?` · ${info.pending}`:""}</small><span class="sale-holding-value"><strong>${info.valueText}</strong><small>${info.pctText}</small></span></div></div><div class="sale-priority-controls"><button class="btn sale-priority-move" type="button" data-sale-priority="${esc(r.targetId)}" data-sale-direction="-1"${j===0?" disabled":""} aria-label="${esc(r.account)} ${esc(r.name)} 매도 우선순위 올리기">↑</button><button class="btn sale-priority-move" type="button" data-sale-priority="${esc(r.targetId)}" data-sale-direction="1"${j===rows.length-1?" disabled":""} aria-label="${esc(r.account)} ${esc(r.name)} 매도 우선순위 내리기">↓</button></div></div>`;
    }).join("")||'<p class="hint">등록된 종목의 보유량이 0입니다.</p>'}</div></section>`;
  }
  const items=planSaleItems(),found=items.find(x=>x.it.id===p.sellTargetId),gid=found?.g.id||p.sellAccountId||"",groups=(planSaleAssets()?.groups||[]).filter(g=>items.some(x=>x.g.id===g.id));
  const choices=items.filter(x=>x.g.id===gid),info=found?`${found.g.name} › ${found.it.name} · 코드 ${assetTradeTicker(found.it)}${finite(found.it.shares)!==null?` · 보유 ${won.format(found.it.shares)}주`:" · 금액으로 보유 관리"}`:p.sellTargetId?"연결한 보유 종목이 없어졌습니다. 계좌·종목을 다시 고르세요.":gid?"이 계좌에서 실제 매도할 보유 ETF를 고르세요.":"ISA·연저펀 등 보유 계좌를 고르면 실제 ETF 코드와 회차별 매도 주수를 연결합니다.";
  const valuation=found?allocationHoldingInfo(found.it,summary):null;
  return `<section class="card panel sale-account"><h2>실제 매도 계좌 · ETF</h2><div class="sale-account-fields"><label class="field"><span>매도할 계좌·그룹</span><select id="saleAccount"><option value="">${esc(p.ticker)} 직접 매도</option>${groups.map(g=>`<option value="${esc(g.id)}"${g.id===gid?" selected":""}>${esc(g.name)}</option>`).join("")}</select></label>${gid?`<label class="field"><span>계좌에 보유한 ETF</span><select id="saleHolding"><option value="">보유 ETF 선택</option>${choices.map(({it})=>`<option value="${esc(it.id)}"${it.id===p.sellTargetId?" selected":""}>${esc(it.name)} · ${esc(assetTradeTicker(it))}${finite(it.shares)!==null?` · ${won.format(it.shares)}주 보유`:""}</option>`).join("")}</select></label>`:""}</div><p class="hint">${esc(info)}</p>${valuation?`<p class="hint sale-account-valuation">평가액 ${valuation.valueText} · 전체 자산의 ${valuation.pctText}${valuation.pending?` · ${valuation.pending}`:""}</p>`:""}<p class="hint">${esc(p.ticker)} 현재가 × 기준 주수${p.currency==="USD"?" × 환율":""} ÷ 실제 ETF 현재가로 정수 주수를 내림합니다. 기준 현재가가 없으면 회차 기준가를 사용합니다. 체결한 회차는 당시 계좌·ETF·수량을 유지합니다.${!groups.length?' <a href="assets.html#alloc">자산 배분에서 보유 계좌와 종목 코드를 등록하세요.</a>':""}</p></section>`;
}
// 전액매도 시점 표식: 종료 기준선 없이 하락률로 만든 계획(planEndPct)에만 계획 진행 카드의 다음 회차 줄 아래에 재매수 '손절 도달 기준'과 같은 한 줄로 보인다.
// 현재가가 시작 기준가 이하이면 전액매도 시점, 종료가 이하이면 하락 끝 도달. 현재가(통화가 맞는 계획 종목 시세)만 쓰며 시세가 없거나 지난 시세·조회 실패이면 판단하지 않는다.
// 휴대폰 알림은 첫 매도(1회)·회차 알림을 그대로 쓴다. 화면을 그려도 어떤 값도 저장하지 않는다.
function planFullSellState(p){
  const pct=planEndPct(p);if(pct===null)return null;
  const start=Number(p.startPrice)>0?Number(p.startPrice):null,end=Number(p.endPrice)>0?Number(p.endPrice):null,px=planQuote(p.ticker,p.currency),cur=Number(px?.close)>0?Number(px.close):null,old=!!px&&(px.stale||priceOld(px));
  const finished=p.checked.length>0&&p.checked.every(Boolean),ok=start!==null&&end!==null&&cur!==null&&!old&&!finished,bottom=ok&&cur<=end,due=ok&&cur<=start;
  return {pct,start,end,due,
    label:start===null||end===null?"기준가 대기":finished?"전액매도 완료":cur===null?"시세 대기":old?"지난 시세":bottom?"하락 끝 도달":due?"전액매도 시점":"대기"};
}
function planFullSellMark(p){
  const f=planFullSellState(p);if(!f)return "";
  const P=v=>v===null?"—":priceText(v,p.currency),hit=f.due;
  return `<div class="cut-milestones full-sell-mark" id="fullSellMark"><dl><div${hit?' class="due"':""}><dt>전액 매도<small>100%</small></dt><dd><strong>${f.end===null?"기준가 대기":`−${decimal.format(f.pct)}% · ${P(f.end)}`}</strong><small>시작 ${P(f.start)} · ${esc(p.stages)}회 분할 · <span class="full-sell-state${hit?" due":""}">${esc(f.label)}</span></small></dd></div></dl></div>`;
}
// sellPriority는 사용자가 순서를 바꿀 때만 저장한다. 계좌 이름·종목 코드가 같아도 자산 id로 구분하며 조회·체결에는 순서 필드를 만들지 않는다.
function movePlanSalePriority(p,targetId,direction,redraw=renderPlans){
  if(![-1,1].includes(direction))return;
  const schedule=planLinkedSaleSchedule(p);if(!schedule)return;
  const visible=schedule.rows.filter(r=>r.held!==0||r.sold),i=visible.findIndex(r=>r.targetId===targetId),next=visible[i+direction];
  if(i<0||!next)return;
  const ids=schedule.rows.map(r=>r.targetId),a=ids.indexOf(targetId),b=ids.indexOf(next.targetId);
  [ids[a],ids[b]]=[ids[b],ids[a]];p.sellPriority=ids;save();redraw();
}
function bindSalePriority(p){
  $$("#planMain [data-sale-priority]").forEach(el=>el.onclick=()=>{
    movePlanSalePriority(p,el.dataset.salePriority,Number(el.dataset.saleDirection));
    const buttons=[...$$("#planMain [data-sale-priority]")].filter(b=>b.dataset.salePriority===el.dataset.salePriority);
    (buttons.find(b=>!b.disabled&&b.dataset.saleDirection===el.dataset.saleDirection)||buttons.find(b=>!b.disabled))?.focus({preventScroll:true});
  });
}
// sellAccountId·sellTargetId는 계좌/ETF 선택 때만 저장. 변경은 새 회차에만 적용(execution이 있는 회차는 고정).
function bindSaleAccount(p){
  const select=$("saleAccount");if(!select)return;
  select.onchange=()=>{const gid=select.value;if(!gid){delete p.sellAccountId;delete p.sellTargetId;}else{p.sellAccountId=gid;const items=planSaleItems().filter(x=>x.g.id===gid),matches=items.filter(x=>linkTicker(x.it.ticker)===linkTicker(p.ticker)||linkTicker(assetTradeTicker(x.it))===linkTicker(p.ticker));const chosen=matches.length===1?matches[0]:items.length===1?items[0]:null;if(chosen)p.sellTargetId=chosen.it.id;else delete p.sellTargetId;}save();renderPlans();};
  const holding=$("saleHolding");if(holding)holding.onchange=()=>{const found=planSaleItems().find(x=>x.it.id===holding.value&&x.g.id===(p.sellAccountId||planSaleItems().find(x=>x.it.id===p.sellTargetId)?.g.id));if(found)p.sellTargetId=found.it.id;else delete p.sellTargetId;save();renderPlans();};
}
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
// 화면 제목·목록 카드·이름 창에 보일 종목 이름: 계획 이름이 연결 종목 이름 중 하나이면(자산 배분에서 종목을 골라 채운 이름) 매도 우선순위 맨 위 종목(보유 목록의 '매도 우선')의 이름을 따른다.
// 분할매수 leadName과 같은 규칙. 직접 쓴 계획 이름은 그대로(stockNames.planName)이며 계획 이름·자산 종목 이름 기록은 바꾸지 않는다.
function planShownName(p){
  const name=stockNames.planName(p),title=String(p?.title||"").trim();
  if(!title||!planLinkedSaleItems(p).some(({it})=>String(it.name||"").trim()===title))return name;
  return String(planLinkedSaleSchedule(p)?.rows.find(r=>r.held!==0||r.sold)?.name||"").trim()||name;
}
// 저장된 계획 카드: 카드 이름(cardName)을 굵게, 없으면 종목명(planShownName: 계획 이름 → 같은 코드의 종목 이름 → 종목 코드). PC에서만 아래 작게 종목 코드.
// 모바일은 이름을 두 줄까지 보이고 아래 줄을 숨기되, 카드 이름 없이 같은 이름이 다른 코드에도 있으면 그 카드만 코드 줄을 보인다(.show-code). 저장된 cardName·title·ticker는 바꾸지 않는다.
// 카드 이름은 이름만 고치는 작은 창(nameDialog)으로도 바꾼다: 터치는 카드를 0.5초 누르고 있으면(손 떼기 전에) 열리고, 마우스(PC)는 카드 오른쪽 아래 연필(.plan-rename).
// 수정 창의 카드 이름 칸과 같은 값(비우면 cardName을 지워 종목명으로). 카드가 button이라 연필은 바깥(.plan-cell)에 둔다.
// 모바일 카드 한 줄·'회' 숨김. 상태는 실제 체결/완료 수로: 시작 전 → 진행 중 → 전량(비중<100이면 계획) 매도 완료.
// 옛 currentPrice·started·asOf·basisPrice는 값만 보존하며 계산·새 계획·수정 창에 쓰지 않는다.
// 완료 회차는 기본 접기. 계획별 펼침 상태는 이 화면에서만 유지하고 거래 기록·동기화에는 저장하지 않는다.
const openCompletedSales=new Set();
// 계획 진행 카드: 분할매수 진행 카드(purchases.js statusCard, CSS purchases.css .buy-track)와 같은 띠·양 끝·가운데 구성. 띠는 회차마다 한 칸이며 오른쪽이 1회다(CSS row-reverse).
// 매도라 처음에는 모든 칸이 가득 차 있고(남은 매도 초록) 매도 완료 회차는 오른쪽부터 빈 칸, 부분 체결은 남은 비율만큼만 채운다(도달·부분 주황, 다음 파랑).
// 도달은 회차표와 같은 기준(planStageDue)이다.
// 다음 = 회차표 순서로 첫 미완료·미도달 회차이고 현재가 이름표를 그 칸 앞에 둔다. 다음 회차가 없으면 현재가가 지난 기준가 회차 수만큼 뒤에 둔다.
// 오른쪽 끝은 첫 매도 기준가(카드에서 바로 수정)·시작선, 왼쪽 끝은 마지막 매도 기준가·종료선, 달러 계획은 원화 환산. 하락률 계획은 다음 회차 줄 아래 전액 매도 표식(planFullSellMark), 맨 아래 줄은 환율 수정과 첫 매도 알림.
// 계산 요약 카드는 두지 않는다(회차별 가격·수량은 아래 회차표, 매도 비중은 제목 아래 시세 줄). 화면 표시만 하며 기록에 필드를 만들지 않는다.
// 카드의 가격(현재가 이름표·왼쪽 끝·다음 회차)은 회차표와 같은 planRowPrice(비트코인 달러는 센트 없이)로 보인다. 첫 매도 기준가 입력칸은 저장값 그대로.
function planTrackCard(p,{status,value,valueTitle,startText,fxAuto,px,label}){
  const now=Number(px?.close)>0?Number(px.close):null,up=Number(p.endPrice)>Number(p.startPrice),usd=p.currency==="USD",done=p.checked.filter(Boolean).length,pt=v=>planRowPrice(v,p);
  const rows=Array.from({length:p.stages},(_,i)=>{const r=planQuantityProgress(p,i);return {i,r,price:r.trade.price>0?r.trade.price:null};});
  const due=x=>planStageDue(p,x.r,now);
  const next=now===null?null:rows.find(x=>!x.r.done&&x.price!==null&&!due(x))||null,priced=rows.some(x=>x.price!==null);
  const at=now===null||!priced?-1:next?next.i:rows.filter(x=>x.price!==null&&(up?x.price<=now:x.price>=now)).length;
  const nowTag=at<0?"":`<em class="buy-track-now ${at/rows.length<.18?"right":at/rows.length>.82?"left":"mid"}"><span>현재 <b>${pt(now)}</b></span></em>`;
  const left=x=>x.r.target>0&&x.r.remaining!==null?Math.round(x.r.remaining/x.r.target*100):50; // 부분 체결 칸에 남은 매도 비율만큼 채움
  const cell=x=>x.r.done?'<i class="sold"></i>':x.r.recorded?`<i class="partial" style="--left:${left(x)}%"></i>`:due(x)?'<i class="due"></i>':x===next?'<i class="next"></i>':'<i class="hold"></i>';
  const dueRows=rows.filter(x=>!x.r.recorded&&due(x)),partialRows=rows.filter(x=>x.r.recorded&&!x.r.done),qtyOf=n=>planQuantity(Number(Math.max(0,n).toFixed(8)),p);
  const lineName=(name,fallback)=>movingLineName(name)?movingLineText(name):fallback,krw=v=>usd?`<small>${v>0?fxText(v*p.fx):"시세 대기"}</small>`:"";
  const startEdit=`<label class="metric-edit" title="첫 매도 기준가 — 눌러서 수정">${usd&&p.startPrice>0?"$":""}<input id="startPrice" type="number" min="0" step="any" inputmode="decimal" placeholder="대기" value="${esc(startText)}" aria-label="첫 매도 기준가">${usd||!(p.startPrice>0)?"":"원"}${PENCIL}</label>`;
  const ends=[`<div class="buy-track-end"><b>${p.endPrice>0?pt(p.endPrice):"—"}</b><small>${esc(lineName(p.endLabel,planEndPct(p)?pctEndLabel(planEndPct(p)):"마지막 매도"))}</small>${krw(p.endPrice)}</div>`,
    `<div class="buy-track-end r"><b>${startEdit}</b><small>${esc(lineName(p.startLabel,"첫 매도"))}</small>${krw(p.startPrice)}</div>`];
  const chips=`<span class="buy-track-chip${{"전량 매도 완료":" done","계획 매도 완료":" done","기준가 대기":" muted"}[status]||""}">${esc(status)}</span>${dueRows.length?`<span class="buy-track-chip warn">도달 ${dueRows.length}회</span>`:""}${partialRows.length?`<span class="buy-track-chip warn">부분 체결 ${partialRows.length}회</span>`:""}`;
  const main=`<div class="buy-track-main"><div class="buy-track-chips">${chips}</div><div class="buy-track-count"><b>${done}</b><span>/ ${esc(p.stages)}회</span></div></div>`;
  const notes=partialRows.length===1?(x=>[`${x.i+1}회 부분 체결 · ${x.r.target!==null&&x.r.remaining!==null?`${qtyOf(x.r.amount)} 매도, ${qtyOf(x.r.remaining)} 남음`:"남은 수량은 아래 회차표에서 확인하세요"}`])(partialRows[0]):partialRows.length?[`부분 체결 ${partialRows.length}회 · 아래 회차표에서 남은 수량을 확인하세요`]:[];
  const gap=next?(next.price/now-1)*100:null,gapText=gap===null?"":`${gap>0?"+":""}${new Intl.NumberFormat("ko-KR",{maximumFractionDigits:Math.abs(gap)<1?2:1}).format(gap)}%`;
  const legend=`${done?`<span class="sold">매도 ${done}</span>`:""}${partialRows.length?`<span class="partial">부분 ${partialRows.length}</span>`:""}${dueRows.length?`<span class="due">도달 ${dueRows.length}</span>`:""}${next?`<span class="next">다음 ${next.i+1}회 <b>${pt(next.price)}</b><em class="${gap>0?"up":gap<0?"down":""}">${gapText}</em></span>`:""}`;
  const fx=usd?`<label class="metric-edit fx-edit" title="${esc(fxAuto)}환율 — 눌러서 수정">환율 <input id="planFx" type="number" min="0" step="any" inputmode="decimal" aria-label="달러/원 환율" value="${esc(String(p.fx))}">${PENCIL}</label>`:"";
  const toggle=typeof tradeAlertToggle==="function"?tradeAlertToggle(tradePlanEnabled(p,0),'data-sale-alert="0"',"첫 매도",p.checked[0],"첫 매도"):"";
  const dense=p.stages>120?" tight":p.stages>60?" dense":"";
  return `<section class="card buy-track sale-track" aria-label="${esc(label)}"><div class="buy-track-cells${at<0?"":" with-now"}${dense}" role="img" aria-label="${esc(p.stages)}회 중 ${done}회 매도 완료${now!==null?`, 현재 ${pt(now)}`:""}">${rows.map(x=>(x.i===at?nowTag:"")+cell(x)).join("")}${at===rows.length?nowTag:""}</div>
    <div class="buy-track-row">${ends[0]}${main}${ends[1]}</div><p class="sale-track-sub"${valueTitle}>${value}</p>${notes.map(t=>`<p class="buy-track-note">${esc(t)}</p>`).join("")}${legend?`<div class="buy-track-legend">${legend}</div>`:""}${planFullSellMark(p)}${fx||toggle?`<div class="buy-wait-alert sale-track-foot">${fx||"<span></span>"}${toggle}</div>`:""}</section>`;
}
function renderPlans(){
  const list=$("planList"), pencil=PENCIL;
  const shownNames=new Map(state.plans.map(p=>[p,planShownName(p)])), auto=state.plans.filter(p=>!String(p.cardName||"").trim()).map(p=>({name:shownNames.get(p),code:p.ticker})), clash=stockNames.clashes(auto);
  list.innerHTML=state.plans.length?state.plans.map(p=>{const n=p.checked.filter(Boolean).length, sub=String(p.ticker||"").trim(), card=String(p.cardName||"").trim(), main=card||shownNames.get(p), showCode=!card&&sub&&sub!==main&&clash(main), fullDue=planFullSellState(p)?.due===true;
    return `<div class="plan-cell"><button class="plan-item ${p.id===state.selectedPlan?"active":""}${showCode?" show-code":""}" type="button" data-plan="${esc(p.id)}" aria-pressed="${p.id===state.selectedPlan}" aria-controls="planMain" title="${esc(main)}${sub&&sub!==main?` (${esc(sub)})`:""} · ${n} / ${esc(p.stages)}회 완료${fullDue?" · 전액매도 시점":""}"><span class="plan-row"><strong>${esc(main)}</strong><span class="plan-count${fullDue?" due":""}">${n}/${esc(p.stages)}<span class="plan-unit">회</span></span></span><span class="plan-title">${sub&&sub!==main?esc(sub):""}</span><span class="plan-bar"><i style="width:${Math.round(n/Math.max(p.stages,1)*100)}%"></i></span></button><button class="plan-rename" type="button" data-rename="${esc(p.id)}" aria-label="${esc(main)} 카드 이름 변경" title="카드 이름 변경">${pencil}</button></div>`;}).join(""):"<div class='empty'>계획 없음</div>";
  list.querySelectorAll("[data-plan]").forEach(b=>{b.onclick=()=>{state.selectedPlan=b.dataset.plan;save();renderPlans();[...list.querySelectorAll("[data-plan]")].find(x=>x.dataset.plan===state.selectedPlan)?.focus();};
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
  if(typeof keepPlanListView==="function")keepPlanListView(list,state.selectedPlan); // PC 목록 스크롤 위치 유지(core.js)
  const p=selected(); const main=$("planMain");
  if(!p){main.innerHTML="<div class='card empty'><h2>분할매도 계획을 추가하세요</h2></div>";return;}
  const done=p.checked.filter(Boolean).length, shares=p.holdings.reduce((s,h)=>s+Number(h.shares||0),0), ready=stagePrice(p,0)!=null;
  const completedOpen=openCompletedSales.has(p.id);
  const linkedSchedule=planLinkedSaleSchedule(p),linkedHeld=linkedSchedule?.rows.reduce((n,r)=>n+(r.held||0),0);
  const started=done>0||Object.keys(p.fills||{}).length>0, pct=planSalePct(p), status=done===p.stages?pct<100||linkedHeld>0?"계획 매도 완료":"전량 매도 완료":started?"진행 중":ready?"시작 전":"기준가 대기";
  const startText=!(p.startPrice>0)?"":p.currency==="USD"&&Number.isInteger(Math.round(p.startPrice*1e6)/1e4)?Number(p.startPrice).toFixed(2):String(p.startPrice); // 달러는 소수 둘째 자리까지면 $80.00처럼
  const saleRows=Array.from({length:p.stages},(_,i)=>planSaleRowInfo(p,i)),sellers=planSaleSellers(saleRows),saleAlerts=typeof tradeAlertToggle==="function";
  const px=planQuote(p.ticker,p.currency); // 시세: 기준일은 제목 위에 작게, 현재 가격은 제목 아래 공통 시세 줄 맨 앞에
  const fxe=fxEntry(priceData), fxAuto=fxe&&p.auto?.fx===p.fx&&p.fx===priceRound(fxe.close,2)?`현물 USD/KRW(시세 ${fxe.asOf}${fxe.stale?" · 마지막 조회 실패":""}${priceOld(fxe)?" · 지난 시세":""})로 자동 · `:""; // 달러 계획 환율(prices.js)
  const left=sharesLeft(p), worth=shares?planWorth(left,px?.close,p.currency,p.fx):null; // 평가액: 남은 수량 × 현재가(× 환율), 수량 없이 평가액만 넣은 계획은 그 값
  const value = linkedSchedule?`${linkedSchedule.rows.filter(r=>r.held||r.sold).length}개 보유 항목 · ${linkedSchedule.rows.some(r=>r.held===null)?"보유량 확인 필요":`현재 ${won.format(linkedHeld)}주 보유`}`:shares ? `${started?`매도 ${planQuantity(Number((shares-left).toFixed(8)),p)} · 남은 ${planQuantity(left,p)}`:`${planQuantity(shares,p)} 보유`}${worth!=null?` · 평가액 ₩${won.format(worth)}만원`:""}` : p.valueKrw!=null?`평가액 ₩${won.format(p.valueKrw)}만원`:"보유 수량 미입력";
  const head=stockNames.titleParts(planShownName(p)); // 이름 끝 괄호는 제목 꼬리표로(규칙은 stock-names.js titleParts)
  main.innerHTML=`<div class="heading plan-heading"><div><div class="eyebrow">${esc(p.ticker)}${px?` · ${priceStamp(px)}`:""}</div><div class="title-row"><h1>${esc(head.main)}${head.tag?` <span class="title-tag">${esc(head.tag)}</span>`:""}</h1><button class="btn icon-btn" id="editPlan" type="button" aria-label="계획 수정" title="계획 수정">${pencil}</button></div>${tradeQuoteLine({now:px&&Number(px.close)>0?priceText(Number(px.close),p.currency):"",state:planEndPct(p)?`시작 기준가부터 ${decimal.format(planEndPct(p))}% 하락까지`:`${esc(movingLineText(p.startLabel))} 이탈 후 ${esc(movingLineText(p.endLabel))}까지`,round:`${planEndPct(p)?"보유 전량 ":pct<100?`보유의 ${pct}%를 `:""}${esc(p.stages)}회 분할매도`})}${planLink("line",planTicker(p.ticker))}</div></div>${px?priceWarning(px,esc(p.ticker)):""}
    ${planSaleAccountView(p)}
    ${planTrackCard(p,{status,value:`${!linkedSchedule&&p.sellTargetId?`${esc(p.ticker)} 기준 `:""}${value}`,valueTitle:worth!=null&&!linkedSchedule?` title="${esc(`남은 ${planQuantity(left,p)} × 현재가 ${priceText(Number(px.close),p.currency)}${p.currency==="USD"?` × 환율 ${p.fx}`:""}`)}"`:"",startText,fxAuto,px,label:linkedSchedule?"전체 계좌 계획 진행":p.sellTargetId?"기준 ETF 계획 진행":"계획 진행"})}
    <div class="control-grid"><section class="card panel memo"><div class="memo-head"><h2>메모</h2><span id="memoCount" class="memo-count">${memoCount(p.note)}</span><button class="btn mini" id="saveNote">저장</button></div><textarea id="planNote" maxlength="4000" rows="3" aria-label="메모">${esc(p.note||"")}</textarea></section></div>
    <div class="section-heading"><h2>분할매도 체크</h2>${typeof tradeAlertAllButtons==="function"?tradeAlertAllButtons("data-sale-alert-all"):""}<span>${done} / ${esc(p.stages)}회 완료</span></div><section class="card table-card purchase-table sale-table${completedOpen?"":" hide-completed"}${saleAlerts?"":" no-alert"}${isBitcoinTicker(p.ticker)?" btc":""}" id="saleTable">${planSellerHead(sellers)}<div class="purchase-table-head"><span>회차</span><span>기준가</span>${isBitcoinTicker(p.ticker)?"<span>매도 / 체결 <small>BTC</small></span>":"<span>매도</span><span>체결</span>"}${saleAlerts?"<span>알림</span>":""}<span>상태</span></div>${done?`<button class="completed-fold-bar" id="toggleCompletedSales" type="button" aria-expanded="${completedOpen}" aria-controls="saleRows"><span>매도 완료 <b>${done}회</b></span><span class="completed-fold-action" data-completed-action>${completedOpen?"접기":"펼치기"}</span></button>`:""}<div id="saleRows">${(marks=>saleRows.map(x=>(marks.has(x.i)?planLineMark(p,marks.get(x.i),x.r.done):"")+planSaleRow(p,x.i,sellers,x)).join(""))(planLineMarks(p,saleRows))}</div>${done===p.stages?'<div class="completed-fold-empty">모든 회차의 매도가 완료되었습니다.</div>':""}</section>`;
  const completedToggle=$("toggleCompletedSales");
  if(completedToggle)completedToggle.onclick=()=>{
    const open=!openCompletedSales.has(p.id);if(open)openCompletedSales.add(p.id);else openCompletedSales.delete(p.id);
    $("saleTable").classList.toggle("hide-completed",!open);completedToggle.setAttribute("aria-expanded",String(open));completedToggle.querySelector("[data-completed-action]").textContent=open?"접기":"펼치기";
  };
  // 첫 매도 기준가·달러 환율은 수정 창과 같은 필드. 카드에서 Enter/blur 저장·Esc 취소; 0 이하·빈 값은 원복, 폭은 글자 수.
  bindSaleAccount(p);
  bindSalePriority(p);
  const inlineEdit=(id,text,key)=>{const el=$(id);if(!el)return;const fit=()=>el.style.width=`${Math.max(3,el.value.length-(el.value.split(".").length-1)*.6)+.4}ch`; fit(); el.oninput=fit;
    el.onkeydown=e=>{if(e.key==="Enter")el.blur();if(e.key==="Escape"){el.value=text;fit();el.blur();}};
    onEdit("#"+id,v=>{v=Number(v);if(!(v>0)||v===p[key])return false;p[key]=v;if(key==="startPrice"&&planEndPct(p))p.endPrice=pctEndPrice(v,planEndPct(p),p.ticker,p.currency);},renderPlans);};
  inlineEdit("startPrice",startText,"startPrice"); inlineEdit("planFx",String(p.fx),"fx");
  const note=$("planNote"); note.oninput=()=>$("memoCount").textContent=memoCount(note.value); $("saveNote").onclick=()=>{p.note=note.value;save();renderPlans();};
  // 체크는 잔량까지 전량 체결, 입력칸은 누적 실제 체결. 부분 체결은 중간 체크 상태로 표시하며 완료 수에는 넣지 않는다.
  $$("#planMain [data-stage]").forEach(el=>el.onchange=()=>{const i=Number(el.dataset.stage), pid=p.id, key=`sell:${pid}:${i}`;
    if(!el.checked)return recordPlanQuantity(p,i,0);
    const r=planQuantityProgress(p,i);if(!(r.trade.price>0))return renderPlans();if(r.execution?.group)return recordPlanGroupFill(p,i,new Map(r.execution.rows.map(row=>[row.targetId,row.plannedQty])),true);if(r.target>0)return recordPlanQuantity(p,i,r.target);if(r.target===null||r.execution||r.pendingAccount)return renderPlans();
    planLink("check",{ticker:planTicker(p.ticker),trade:{...planTrade(p,i),qty:0,value:null},label:`${p.title} ${i+1}회 매도`,prefer:[`sell:${pid}:`],redraw:renderPlans,
      commit:()=>{const q=state.plans.find(x=>x.id===pid);if(!q||i>=q.checked.length)return false;q.checked[i]=true;save();return key;}});});
  onEdit("#planMain [data-sale-filled]",(v,el)=>{recordPlanQuantity(p,Number(el.dataset.saleFilled),String(v).trim()===""?NaN:Number(v));return false;});
  onEdit("#planMain [data-sale-member]",(v,el)=>{recordPlanGroupFill(p,Number(el.dataset.saleStage),new Map([[el.dataset.saleMember,String(v).trim()===""?NaN:Number(v)]]));return false;});
  $$("#planMain [data-sale-partial]").forEach(el=>{el.indeterminate=true;});
  $("editPlan").onclick=()=>openPlanDialog(p);
  if(typeof bindTradePlanAlerts==="function")bindTradePlanAlerts(p);
  fitNames();
}
const planDialog=$("planDialog"); let editingId=null, dialogBase={};
// 자산 배분의 기준 종목을 코드별로 한 번씩 보여 준다. 추종 ETF는 기준 코드로 고르고 같은 코드의 모든 계좌를 합산한다.
// 창을 열거나 종목을 고르는 동안 원본 자산·계획은 바꾸지 않고, 저장할 때 기존 계획 필드에만 반영한다.
function planAllocOptions(){
  const options=new Map();
  for(const g of planSaleAssets()?.groups||[])for(const it of g.items||[]){
    const ticker=linkTicker(it.ticker||assetTradeTicker(it));if(!purchaseQuoteKind(ticker))continue;
    if(!options.has(ticker))options.set(ticker,{ticker,name:it.name||ticker,accounts:new Set(),groups:[],words:[ticker]});
    const o=options.get(ticker);o.accounts.add(g.id);if(g.name&&!o.groups.includes(g.name))o.groups.push(g.name);o.words.push(it.name,g.name,it.section,it.ticker,it.tradeTicker);
  }
  return [...options.values()];
}
function planAllocLocked(){const p=state.plans.find(x=>x.id===editingId);return !!p&&(p.checked.some(Boolean)||Object.keys(p.fills||{}).length>0);}
// 종목 검색(item-search.js, 분할매수 창과 공통). planPick = 고른 자산 배분 기준 코드(창에서만 사용). 고른 동안 종목 코드 칸은 잠그고 '변경'으로 다시 검색한다.
// 계획을 열 때 종목 코드가 목록에 있으면 고른 상태로 보여 준다. 목록에 없는 종목은 아래 칸에 직접 입력하며, 맞는 종목이 없을 때 검색어를 종목 코드로 넘길 수 있다.
let planPick=null, planPickerUi=null;
function planOptionInfo(o){
  const hold=planLink("holding",o.ticker), amount=!hold?"":hold.shares>0?`보유 ${planReferenceQuantity(hold.shares,o)}`:`평가액 ${decimal.format(hold.value)}만원`;
  return [o.ticker,o.groups.join(", "),o.accounts.size>1?`${o.accounts.size}개 계좌`:"",amount].filter(Boolean).join(" · ");
}
const planPicker=()=>planPickerUi||=itemSearch.create($("planItemSearch"),{id:"plan",label:"planItemLabel",empty:"자산 배분에 불러올 종목이 없습니다. 아래에 직접 입력하세요.",
  rows:()=>{const planned=new Set(state.plans.filter(p=>p.id!==editingId).map(p=>linkTicker(p.ticker)));return planAllocOptions().map(o=>({id:o.ticker,name:o.name,info:planOptionInfo(o),badge:planned.has(o.ticker)?"계획 있음":"",words:o.words}));},
  current:()=>{
    const o=planPick&&planAllocOptions().find(x=>x.ticker===planPick);if(o)return {name:o.name,info:planOptionInfo(o)};
    const f=$("planForm").elements;return planAllocLocked()?{name:f.title.value||f.ticker.value,info:`${f.ticker.value} · 직접 입력`}:null;
  },
  locked:planAllocLocked,pick:ticker=>fillPlanAllocTicker(ticker),repick:()=>{planPick=null;planLive();},
  manual:{label:q=>`‘${q}’ 종목 코드로 직접 입력`,fill:q=>{const f=$("planForm").elements;f.ticker.value=q;planLive(["start","end"]);f.title.focus();}}});
function renderPlanAllocPicker(locked){
  const options=planAllocOptions();
  if(planPick&&!options.some(o=>o.ticker===planPick))planPick=null;
  planPicker().render();
  $("planAllocPickerHint").textContent=locked?"체결 기록이 있어 종목과 계획 보유량은 유지합니다.":options.length?"자산 배분 종목을 고르면 코드·이름·통화와 연결된 모든 계좌의 보유량을 가져옵니다. 목록에 없는 종목은 아래에 직접 입력하세요.":"자산 배분에 종목과 코드를 등록하면 여기에서 불러올 수 있습니다.";
}
function fillPlanAllocHolding(hold){
  const f=$("planForm").elements;
  if(hold.shares>0)f.shares.value=String(hold.shares);
  else{f.shares.value="";f.valueKrw.dataset.typed=String(hold.value);if(!f.valueKrw.readOnly)f.valueKrw.value=String(hold.value);}
}
function fillPlanAllocTicker(ticker){
  if(planAllocLocked())return;
  const option=planAllocOptions().find(o=>o.ticker===ticker),hold=option&&planLink("holding",ticker);if(!hold)return;
  const f=$("planForm").elements;planPick=ticker;
  f.ticker.value=ticker;f.title.value=option.name;f.currency.value=purchaseQuoteKind(ticker)==="국내"?"KRW":"USD";
  const fx=priceRound(fxEntry(priceData)?.close||hold.fx,2);if(fx)f.fx.value=fx;
  f.valueKrw.readOnly=false;f.valueKrw.value="";f.valueKrw.dataset.typed="";
  fillPlanAllocHolding(hold);planLive(["start","end"]);
}
// 수정 창 실시간 채우기: 종목 코드·통화·기준선을 바꾸면 그 기준선 이동평균(maValue)으로 기준가를 바로 바꾼다(시세에 없으면 창을 열 때 값).
// 기준선은 숫자 + 일선·주선·개월선(endN·endUnit → "25개월선", 데이터 저장소 수집 스크립트 LABEL_RE와 같은 이름). 기준가는 직접 고칠 수 있다(시세 우선 규칙 그대로).
// 시작 기준선은 '직접'(기본)이 더 있다: 이름만 적고 시작 기준가는 사용자가 정함(시세로 안 채움). 일·주·개월선을 고르면 plans[].startAuto=true(직접이면 delete)로
// 종료 기준가처럼 채운다(prices.js). 옛 기록(startAuto 없음)은 직접.
// 평가액 칸: 보유 수량이 있으면 보유 수량 × 현재가(× 환율)로 자동(읽기 전용, 저장 안 함), 없으면 직접 입력(valueKrw — 평가액만 있는 계획).
// 자동 여부는 칸 이름 옆 .field-note, 긴 설명은 .dialog-help로 접는다. 제목 연필로 창을 열고 삭제는 창 아래 왼쪽.
const lineOf = (f, k) => `${Math.round(Number(f[k+"N"].value))||""}${f[k+"Unit"].value}`; // k: "start"·"end"
// 시작 기준선 칸: 직접이면 이름 칸, 일·주·개월선이면 숫자 칸(보이는 칸만 필수). 직접으로 바꾸면 이름은 고르던 기준선 이름으로 둔다.
function startMode(f, switched){const auto=!!f.startUnit.value;if(switched&&!auto&&f.startN.value)f.startLabel.value=`${Math.round(Number(f.startN.value))}${f.startUnit.dataset.last||"일선"}`;
  if(switched&&auto&&!f.startLabel.hidden){const m=/^(\d+)/.exec(maKey(f.startLabel.value));if(m)f.startN.value=m[1];}
  if(auto)f.startUnit.dataset.last=f.startUnit.value;f.startLabel.hidden=auto;f.startLabel.required=!auto;f.startN.hidden=!auto;f.startN.required=auto;}
function planLive(fill=[]){
  const f=$("planForm").elements, btc=isBitcoinTicker(f.ticker.value), changedCurrency=btc&&f.currency.value!=="USD";
  // 비트코인은 Coinbase 달러 시세만 사용한다. 원화 선택 상태에서 입력해도 조회 전에 USD로 바꾸고, 통화 선택은 고정한다.
  if(btc)f.currency.value="USD";f.currency.disabled=btc;
  if(changedCurrency)fill=["start","end"];
  const currency=f.currency.value, q=planQuote(f.ticker.value,currency), auto=q?`시세 ${Number(q.asOf.slice(5,7))}/${Number(q.asOf.slice(8))} 자동`:"";
  // 종료 '% 하락'(기준선 없음): 시작 기준가는 직접, 종료 기준가는 시작 기준가 × (1 − 하락률)로 자동(읽기 전용), 매도 비중은 100% 고정.
  const pctMode=f.endUnit.value==="pct", endPct=Number(f.endN.value);
  if(pctMode&&f.startUnit.value){f.startUnit.value="";startMode(f,true);}
  f.startUnit.disabled=pctMode;f.endPrice.readOnly=pctMode;
  Object.assign(f.endN,pctMode?{min:"0.1",max:"99.9",step:"any",inputMode:"decimal"}:{min:"1",max:"400",step:"1",inputMode:"numeric"});
  f.endN.setCustomValidity(pctMode&&!(endPct>0&&endPct<100)?"하락률은 0보다 크고 100보다 작게 입력해 주세요.":"");
  $("endLineName").textContent=pctMode?"종료 하락률 (%) · 기준선 없음":"종료 기준선";
  if(pctMode)f.salePct.value="100";
  for(const k of ["start","end"]){
    const price=f[k+"Price"], note=$(k+"Note");
    if(k==="end"&&pctMode){const v=Number(f.startPrice.value)>0&&endPct>0&&endPct<100?pctEndPrice(f.startPrice.value,endPct,f.ticker.value,currency):null;price.value=v??"";note.textContent=v!=null?`시작 기준가 −${decimal.format(endPct)}% 자동`:"";continue;}
    price.required=k==="start"&&!f.startUnit.value;
    if(k==="start"&&!f.startUnit.value){note.textContent="";continue;}
    const label=lineOf(f,k), v=q?priceRound(maValue(q,label),quoteDigits(f.ticker.value,currency)):null;
    if(fill.includes(k)||price.value===""&&v!=null)price.value=v??dialogBase[k]??"";
    note.textContent=v!=null&&Number(price.value)===v?auto:planTicker(f.ticker.value)&&maKey(label)&&v==null?"다음 시세 수집 때 자동":"";
  }
  const shares=Number(f.shares.value), held=hasPlanShares(f.ticker.value,shares), worth=held?planWorth(shares,q?.close,currency,f.fx.value):null, el=f.valueKrw;
  f.shares.step=btc?"0.00000001":"1";f.shares.inputMode=btc?"decimal":"numeric";
  $("sharesLabel").textContent=btc?"보유 수량 (BTC)":"보유 수량 (주)";
  $("tickerNote").textContent=btc?"달러(USD) 자동":"";
  f.shares.setCustomValidity(f.shares.value!==""&&shares!==0&&!held?btc?"비트코인 수량은 소수점 8자리까지 입력해 주세요.":"보유 수량은 정수로 입력해 주세요.":"");
  if(held!==el.readOnly){if(held)el.dataset.typed=el.value;else el.value=el.dataset.typed||"";el.readOnly=held;}
  if(held)el.value=worth!=null?Math.round(worth*10)/10:"";
  el.placeholder=held?"시세 대기":"수량 없을 때";
  $("worthNote").textContent=worth!=null?"보유 수량 × 현재가 자동":"";
  // 매도 비중: 비우면 100%(전량). 100% 아래면 매도·남길 수량(평가액만 넣은 계획은 매도 금액)을 칸 이름 옆에 보여 준다.
  const pctText=String(f.salePct.value).trim(), pct=pctText===""?100:Number(pctText), pctOk=Number.isInteger(pct)&&pct>=1&&pct<=100, plan={ticker:f.ticker.value,salePct:pct};
  const sale=held&&pctOk?saleShares(shares,plan):null, value=Number(el.value);
  f.salePct.setCustomValidity(!pctOk?"매도 비중은 1~100 사이 정수(%)로 입력해 주세요.":sale===0?"매도할 수량이 없습니다. 매도 비중을 올려 주세요.":"");
  $("saleNote").textContent=!pctOk||pct===100?"":sale?`${planQuantity(sale,plan)} 매도 · ${planQuantity(Math.round((shares-sale)*1e8)/1e8,plan)} 남김`:!held&&value>0?`약 ${decimal.format(value*pct/100)}만원 매도`:"";
  // 자산 배분 보유량 가져오기(alloc-link.js holding): 같은 종목 코드 계좌가 모두 수량이면 보유 수량 합, 아니면 평가액 합(만원). 매도 체크가 있으면 계획 기준 보유량이라 바꾸지 않는다.
  const hold=planLink("holding",planTicker(f.ticker.value)), box=$("planAllocHold"), locked=planAllocLocked();
  renderPlanAllocPicker(locked);
  for(const name of ["ticker","shares","stages","salePct"])f[name].readOnly=locked||name==="salePct"&&pctMode||name==="ticker"&&!!planPick;
  box.hidden=!hold;if(!hold)return;
  box.innerHTML=`자산 배분 ${esc(hold.text)} · ${locked?"체결 기록이 있어 계획 보유량은 그대로 둡니다":`<button class="text-link" type="button" id="planAllocFill">보유량 가져오기</button>`}`;
  if(!locked)$("planAllocFill").onclick=()=>{fillPlanAllocHolding(hold);planLive();};
}
$("planForm").addEventListener("input",e=>{if(e.target===planPicker().input)return;const n=e.target.name;if(n==="startUnit")startMode(e.target.form.elements,true);
  planLive(n==="ticker"||n==="currency"?["start","end"]:n==="startN"||n==="startUnit"?["start"]:n==="endN"||n==="endUnit"?["end"]:[]);});
function openPlanDialog(p){editingId=p?.id||null; const form=$("planForm"), f=form.elements;form.reset();planPicker().clear();planPick=p&&planAllocOptions().some(o=>o.ticker===linkTicker(p.ticker))?linkTicker(p.ticker):null;$("dialogTitle").textContent=p?`${p.ticker} 계획 수정`:"새 분할매도 계획";$("deletePlanBtn").classList.toggle("hidden",!p);
  f.valueKrw.readOnly=false;f.valueKrw.dataset.typed="";
  if(p){for(const [k,v] of Object.entries({ticker:p.ticker,title:p.title,cardName:p.cardName??"",currency:p.currency,startLabel:p.startLabel,startPrice:p.startPrice??"",endPrice:p.endPrice??"",stages:p.stages,valueKrw:p.valueKrw??"",fx:p.fx})){if(f[k])f[k].value=v;}f.shares.value=p.holdings[0]?.shares||"";f.salePct.value=planSalePct(p);
    const m=/^(\d+)(일선|주선|개월선)$/.exec(maKey(p.endLabel));f.endN.value=m?m[1]:"";f.endUnit.value=m?m[2]:"개월선";if(planEndPct(p)){f.endN.value=planEndPct(p);f.endUnit.value="pct";}
    const s=p.startAuto&&/^(\d+)(일선|주선|개월선)$/.exec(maKey(p.startLabel));if(s){f.startN.value=s[1];f.startUnit.value=s[2];}}
  else{const fx=priceRound(fxEntry(priceData)?.close,2);if(fx)f.fx.value=fx;} // 새 달러 계획 환율은 현물 USD/KRW로
  startMode(f);dialogBase={start:f.startPrice.value,end:f.endPrice.value};planLive();planDialog.showModal();
  if(!p&&typeof matchMedia==="function"&&matchMedia("(hover:hover) and (pointer:fine)").matches)planPicker().focus();} // 새 계획은 분할매수 창처럼 PC에서만 검색 칸에
$("addPlanBtn").onclick=()=>openPlanDialog();
$("deletePlanBtn").onclick=()=>{const p=state.plans.find(x=>x.id===editingId);if(!p||!confirm(`${p.ticker} 계획을 삭제할까요?`))return;state.plans=state.plans.filter(x=>x.id!==p.id);state.selectedPlan=state.plans[0]?.id||null;save();planDialog.close();render();};
planDialog.querySelectorAll("[data-close-plan]").forEach(b=>b.onclick=()=>planDialog.close());
const nameDialog=$("nameDialog"); let namingId=null,namingSave=null; // 카드 이름만 고치는 창(규칙은 renderPlans 위 주석). 분할매수는 저장 콜백으로 자기 계획만 수정하고 비웠을 때 보일 이름(name)을 넘긴다.
function openNameDialog(pid,options=null){const p=options||state.plans.find(x=>x.id===pid);if(!p||nameDialog.open)return;namingId=pid;namingSave=typeof options?.onSave==="function"?options.onSave:null;const input=$("nameForm").elements.cardName,shownName=options?String(options.name||"").trim():planShownName(p);$("nameTitle").textContent=`${shownName} 카드 이름`;input.value=p.cardName??"";input.placeholder=shownName;nameDialog.showModal();input.focus();input.select();}
nameDialog.querySelector("[data-close-name]").onclick=()=>nameDialog.close();
$("nameForm").addEventListener("submit",e=>{e.preventDefault();const p=state.plans.find(x=>x.id===namingId),v=String(e.target.elements.cardName.value).trim(),commit=namingSave;namingSave=null;nameDialog.close();if(commit){commit(v);return;}if(!p||v===String(p.cardName||"").trim())return;if(v)p.cardName=v;else delete p.cardName;save();renderPlans();});
// 저장: 종목·자동 기준선·통화를 바꿨거나 새 계획이면 auto를 지금 시세 기준으로 다시 표시한다(창에서 채운 값과 같음 — 창에서 직접 고친 기준가는 그 칸 시세가 다음에 바뀔 때까지 둠).
// 평가액만 넣은 계획은 평가액·종목·통화를 바꿨거나 새 계획일 때만 valueBase를 지금 시세로 다시 둔다(시세가 없으면 delete). 수량을 넣거나 평가액을 비우면 delete.
// 빈 자동 기준가는 저장하지 않고 다음 시세를 기다린다. 이전 auto 표시도 비워 같은 값의 시세가 다시 들어오면 채울 수 있게 한다.
$("planForm").addEventListener("submit",e=>{
  e.preventDefault();planLive();if(!e.target.reportValidity())return;
  const f=new FormData(e.target), val=k=>String(f.get(k)||"").trim(), ticker=planTicker(val("ticker")), stages=Math.max(2,Math.min(250,Number(val("stages"))||30)), old=editingId?state.plans.find(p=>p.id===editingId):null;
  const endPct=val("endUnit")==="pct"?Number(val("endN")):null, shares=Number(val("shares")), held=hasPlanShares(ticker,shares), endLabel=endPct?pctEndLabel(endPct):lineOf(e.target.elements,"end"), startAuto=!endPct&&!!val("startUnit"), startLabel=startAuto?lineOf(e.target.elements,"start"):val("startLabel"), currency=val("currency")==="KRW"?"KRW":"USD", moved=old&&(old.ticker!==ticker||old.endLabel!==endLabel||old.currency!==currency||!!old.startAuto!==startAuto||startAuto&&old.startLabel!==startLabel);
  const valueKrw=held||val("valueKrw")===""?null:Number(val("valueKrw")), locked=old&&(old.checked.some(Boolean)||Object.keys(old.fills||{}).length>0);
  if(locked&&(ticker!==old.ticker||currency!==old.currency||stages!==old.stages||shares!==Number(old.holdings[0]?.shares||0)||planSalePct({salePct:Number(val("salePct"))})!==planSalePct(old)||valueKrw!==(old.valueKrw??null))){
    alert("체결 기록이 있어 종목·통화·보유량·분할 횟수·매도 비중은 유지합니다. 체결 수량은 계획 화면에서 수정하세요.");return;
  }
  const rebase=valueKrw!=null&&(!old||old.valueKrw!==valueKrw||old.ticker!==ticker||old.currency!==currency), p=old||defaultPlan(ticker,val("title"),{});
  Object.assign(p,{ticker,title:val("title"),currency,startLabel,endLabel,startPrice:Number(val("startPrice")),endPrice:endPct?pctEndPrice(val("startPrice"),endPct,ticker,currency):Number(val("endPrice")),stages,valueKrw,fx:Number(val("fx"))||1354.91,holdings:locked?old.holdings:held?[{name:val("title"),shares}]:[],checked:Array.from({length:stages},(_,i)=>old?.checked?.[i]===true),note:old?.note||""});const cardName=val("cardName");if(cardName)p.cardName=cardName;else delete p.cardName;const salePct=planSalePct({salePct:Number(val("salePct"))});if(salePct<100)p.salePct=salePct;else delete p.salePct;if(startAuto)p.startAuto=true;else delete p.startAuto;if(endPct)p.endPct=endPct;else delete p.endPct;
  for(const key of ["startPrice","endPrice"])if(val(key)===""){delete p[key];if(p.auto)delete p.auto[key];}
  if(rebase||valueKrw==null){const base=valueKrw==null?null:priceRound(planQuote(ticker,currency)?.close,currency==="KRW"?0:2);if(base)p.valueBase=base;else delete p.valueBase;} // 평가액 기준 가격(규칙은 stageWorth 위 주석)
  if(moved||!old){delete p.auto;const mark=JSON.parse(JSON.stringify(p));if(fillPrices({plans:[mark],futures:state.futures},priceData))p.auto=mark.auto;}
  if(!old)state.plans.push(p);state.selectedPlan=p.id;save();planDialog.close();render();});
// 자산 페이지에서 계좌·보유량 또는 실제 ETF 시세가 바뀌면 분할매도에도 반영한다. 입력 중에는 다시 그리지 않는다.
if(typeof assetStore==="object"&&typeof assetStore.subscribe==="function")assetStore.subscribe(type=>{
  if(!["change","prices"].includes(type)||state.tab!=="plans")return;
  const active=document.activeElement;if(active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)&&active.type!=="checkbox")return;
  renderPlans();
});
