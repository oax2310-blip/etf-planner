// 자산 현황·플래너 분할매수의 계산, 자산 배분 연동, 구역별 병합. 계산 기준은 각 함수 주석, 공통 작업 규칙은 AGENTS.md.
// tests/assets.test.cjs·시세 수집도 DOM 없이 실행하므로 함수 밖에서 화면을 건드리지 않는다.
const ASSET_SECTIONS = ["allocation","ledger","savings","installments"]; // 기기 간 병합은 구역마다 따로(savedAt)
const ASSET_REGIONS = ["미국","국내","해외","현금","외화·원자재","기타"]; // 큰 분류 지역 순서(목록에 없는 지역은 뒤에)
const finite = v => v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v)) ? Number(v) : null;
const plus = v => { const n=finite(v); return n!==null&&n>0 ? n : null; };
// 금액 입력의 쉼표만 제거해 기존 숫자 저장 형식을 유지한다. 화면 표시는 부호·소수부·입력 중인 소수점을 보존한다.
const parseAssetNumber = value => finite(String(value??"").trim().replace(/,/g,""));
function assetNumberText(value){
  const text=String(value??"").replace(/,/g,"");
  if(!/^[+-]?\d*(?:\.\d*)?$/.test(text))return text;
  const [whole,fraction]=text.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,",")+(fraction!==undefined?`.${fraction}`:"");
}

// ---------- 시세 ----------
// prices = {updatedAt, stocks:{종목 코드:{kind, asOf, close, stale}}, fx:{close, asOf}} (assets-store.js가 시세 파일에서 필요한 값만 남긴 것)
function assetQuote(prices, ticker){
  const key=String(ticker||"").trim().toUpperCase(), e=key&&prices?.stocks?.[key];
  if(!e||!(Number(e.close)>0)||!/^\d{4}-\d{2}-\d{2}$/.test(String(e.asOf)))return null;
  return {...e, close:Number(e.close), currency:e.kind==="해외"||e.kind==="코인"?"USD":"KRW"};
}
// 원/달러: 시세 파일의 현물 환율, 없으면 자산 배분에 직접 넣은 환율(cashFx)
const assetFx = (prices, alloc) => plus(prices?.fx?.close) || plus(alloc?.cashFx);
// 배당 환산 기본 환율은 원/달러 현물의 125개월선만 쓴다. 시세 수집기가 월봉으로 계산하며 값이 없으면 다른 환율로 대체하지 않는다.
const assetDividendFx = prices => plus(prices?.fx?.ma?.["125개월선"]);
// 1주(1단위) 원화 가격. 달러 시세는 × 환율, 환율이 없으면 null
const krwPrice = (q, fx) => !q ? null : q.currency==="USD" ? (fx ? q.close*fx : null) : q.close;
// ticker는 기준 가격·이동평균·알림용, tradeTicker는 실제 거래하는 일반 추종 ETF 코드. 빈칸이면 ticker를 직접 거래한다.
const assetTradeTicker = it => String(it?.tradeTicker||it?.ticker||"").trim().toUpperCase();
const tracksETF = it => !!String(it?.tradeTicker||"").trim()&&linkTicker(it.tradeTicker)!==linkTicker(it.ticker);
// 실제 ETF 자동 시세가 우선이며, 없으면 직접 넣은 tradePrice·tradePriceAt을 쓴다.
function assetTradeQuote(prices, it){
  if(!tracksETF(it))return assetQuote(prices,it?.ticker);
  const ticker=assetTradeTicker(it), kind=purchaseQuoteKind(ticker);
  if(!["국내","해외"].includes(kind))return null;
  const q=assetQuote(prices,ticker);
  if(q?.kind===kind)return q;
  const close=plus(it.tradePrice);
  return close?{kind,close,currency:kind==="해외"?"USD":"KRW",asOf:String(it.tradePriceAt||"").slice(0,10),manual:true}:null;
}

// ---------- 자산 배분 ----------
// amount·total은 만원, target은 % 숫자(3 = 3%). 현금 단위는 cashValue 주석.
// 이전 중국·주식은 해외·중국으로 표시하고 인도 바로 뒤에 둔다. id·목표·그룹 연결과 저장된 기록은 그대로 유지한다.
function allocationClassList(alloc){
  const classes=(alloc?.classes||[]).map(c=>c.region==="중국"&&c.name==="주식"?{...c,region:"해외",name:"중국"}:c);
  const china=classes.filter(c=>c.region==="해외"&&c.name==="중국"), rest=classes.filter(c=>!china.includes(c));
  const india=rest.findIndex(c=>c.region==="해외"&&c.name==="인도");
  if(india<0||!china.length)return classes;
  rest.splice(india+1,0,...china);return rest;
}
// 기준 총자산 입력: 숫자만 넣으면 기존처럼 만원. 억·만원·원 표기는 만원 숫자로 환산하며, 빈칸(null)과 잘못된 입력(NaN)을 구분한다.
function parseAllocationTotal(value){
  const text=String(value??"").replace(/[\s,]/g,"");
  if(!text)return null;
  const e=text.match(/^(\d+(?:\.\d*)?|\.\d+)억(?:원|(\d+(?:\.\d*)?|\.\d+)(만원?|원))?$/);
  const m=e?null:text.match(/^(\d+(?:\.\d*)?|\.\d+)(만원?|원)?$/);
  const total=e?Number(e[1])*1e4+Number(e[2]||0)/(e[3]==="원"?1e4:1):m?Number(m[1])/(m[2]==="원"?1e4:1):NaN;
  return Number.isFinite(total)?total:NaN;
}
const allocationTotalFormat=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:20});
// 저장된 만원 숫자 → 억·만원 표기. 소수부를 따로 붙여 억 단위를 뺄 때의 부동소수점 오차를 표시하지 않는다.
function allocationTotalText(value){
  const n=finite(value);if(n===null||n<0)return "";
  const text=allocationTotalFormat.format(n);if(n<1e4)return `${text}만원`;
  const [whole,fraction=""]=text.replace(/,/g,"").split("."), e=Number(whole.slice(0,-4)), m=Number(`${whole.slice(-4)}.${fraction}`);
  return `${allocationTotalFormat.format(e)}억${m?` ${allocationTotalFormat.format(m)}만원`:"원"}`;
}
// 종목 평가액(만원): ① 보유 수량 × 현재가(달러는 × 환율) ② 금액만 넣었으면 금액 × (지금 원화 가격 ÷ 금액을 넣을 때 원화 가격 base)
// ③ 시세가 없으면 넣은 금액 그대로. tradeTicker가 있으면 실제 ETF 시세(없으면 직접 넣은 tradePrice)로 평가하고, 보유 수량도 실제 ETF 주수다.
// 미국 ETF를 따라가는 국내 ETF에서 tradeTicker를 비운 기존 기록은 ticker에 따라가는 미국 ETF를 넣어 ②로 따라간다.
// 보유 수량 0(플래너 체크로 다 판 종목 — 칸을 지우지 않음)은 평가액 0(남은 금액 칸으로 돌아가지 않게).
function itemValue(item, prices, fx){
  const q=assetTradeQuote(prices,item), p=krwPrice(q,fx), shares=plus(item?.shares), amount=finite(item?.amount)||0;
  if(finite(item?.shares)===0)return {value:0, how:"shares", q};
  if(shares&&p)return {value:shares*p/1e4, how:"shares", q};
  if(amount>0&&p&&plus(item?.base))return {value:amount*p/Number(item.base), how:"ratio", q};
  return {value:amount, how:"amount", q};
}
// 금액만 넣은 종목에 기준 가격(base)이 없으면 지금 시세로 정한다(그 뒤로 금액이 시세를 따라감). 바꾼 종목이 있으면 true.
function fillBases(alloc, prices){
  const fx=assetFx(prices,alloc);let changed=false;
  for(const g of alloc?.groups||[])for(const it of g.items||[]){
    if(plus(it.shares)||!(finite(it.amount)>0)||plus(it.base))continue;
    const q=assetTradeQuote(prices,it), p=krwPrice(q,fx);
    if(p){it.base=Math.round(p*1e4)/1e4;it.baseAt=q.asOf;changed=true;}
  }
  return changed;
}
// 금액·종목 코드(실제 ETF 코드 포함)를 고쳤을 때 기준 가격을 지금 시세로 다시 잡는다(시세가 없으면 지움 → 다음 시세 때 fillBases)
function resetBase(it, prices, alloc){
  delete it.base;delete it.baseAt;
  const q=assetTradeQuote(prices,it), p=krwPrice(q,assetFx(prices,alloc));
  if(p&&finite(it.amount)>0&&!plus(it.shares)){it.base=Math.round(p*1e4)/1e4;it.baseAt=q.asOf;}
}
// 현금(만원): 원화는 그대로, 달러는 × 환율(시세 → 직접 넣은 환율), minus는 빼는 항목(예: 선물 증거금)
function cashValue(c, fx){ const a=finite(c?.amount)||0, krw=c?.currency==="USD"?a*(fx||0):a; return (c?.minus?-krw:krw)/1e4; }
// 목표 비중은 모두 기준 총자산 대비 %. 종목 → 소분류 → 그룹 → 큰 분류 순서로 합산한다.
// 하위 목표가 하나라도 있으면 그 합계가 우선이고, 전부 비어 있으면 기존 직접 입력 목표를 쓴다.
// 저장된 상위 목표는 건드리지 않는다(읽기만 해도 동기화 기록이 달라지거나 기존 목표가 사라지지 않게).
function allocationTargets(alloc){
  const groups=new Map(), classes=new Map(), sections=new Map();
  const total=values=>values.some(v=>v!==null)?Math.round(values.reduce((s,v)=>s+(v??0),0)*1e8)/1e8:null;
  const resolve=(values,fallback)=>{const sum=total(values);return {target:sum??finite(fallback),linked:sum!==null};};
  for(const g of alloc?.groups||[]){
    const names=[...new Set([...(g.sections||[]).map(s=>s.name),...(g.items||[]).map(it=>it.section).filter(Boolean)])];
    const values=(g.items||[]).filter(it=>!it.section).map(it=>finite(it.target));
    for(const name of names){
      const result=resolve((g.items||[]).filter(it=>it.section===name).map(it=>finite(it.target)),(g.sections||[]).find(s=>s.name===name)?.target);
      sections.set(`${g.id}\u0000${name}`,result);values.push(result.target);
    }
    groups.set(g.id,resolve(values,g.target));
  }
  for(const c of alloc?.classes||[])classes.set(c.id,resolve((alloc?.groups||[]).filter(g=>g.classId===c.id).map(g=>groups.get(g.id).target),c.target));
  return {groups,classes,section:(gid,name)=>sections.get(`${gid}\u0000${name}`)||{target:null,linked:false}};
}
// ---------- 분할매수(플래너 js/purchases.js) ----------
// 종목의 buyPlan은 이동평균선 돌파·매수대기·기존 직접 입력이며 옛 ladder는 읽지 않는다. 체결 반영·취소는 alloc-link.js, 종목의 점검완료(it.done)와 매수 완료는 별개.
// ① 이동평균선 돌파(lines가 있음): lines = {names:[단계 이름…], startLine?:사용자가 고른 시작선, end?:목표 가격, budget:총 매수 금액(만원), target?:옛 계획 목표 — 새로 저장하지 않으며 자산 배분 목표가 없을 때만 읽는다(purchaseAllocationSummary·syncPurchaseTargets)}. 목표 가격을 비우면 names의 마지막 선까지 매수한다.
//    회차 가격은 시세 파일의 이동평균을 따라 움직이고(purchaseLineLevels), 체결은 buys[회차 키] = {plannedShares:원래 계획 수량, plannedActual:그 수량의 예정액, shares:누적 체결 수량, actual:체결 금액(만원), price:첫 체결 때 표시 가격, next?, tradeTargetId?:첫 반영 자산 id}.
//    부분 체결 회차는 원래 수량·가격과 잔량 예산을 고정한다. plannedShares 없는 옛 체결은 완료로 읽고, 처음 수정할 때만 계획 수량을 저장한다.
//    수량은 purchaseFill로 회차 예산 안에서 내림하고, 표시한 수량을 그대로 저장·반영한다. 체결 금액만 고쳐도 수량은 바뀌지 않는다. 옛 기록은 읽을 때 새 필드를 채우지 않는다.
// ② 직접 입력: stages = [{id, price?, shares?, plannedShares?, date?, condition?, amount(만원), done?, partial?, actual?, tradeTargetId?}] — 첫 체결 때 plannedShares·반영 계좌를 고정하고 shares는 누적 체결, 잔량이 있으면 partial=true(done 없음).
// ③ 매수대기: wait = {line:원하는 이동평균선 이름}. 예산·체결 회차 없이 현재가 ≤ 그때의 이동평균선이면 도달하며 보유량을 바꾸지 않는다.
//    알림은 notify.stages(개별 예외는 notify.keys.wait). 선 값이 바뀌어도 같은 알림 이력을 쓰고, 선택한 선을 바꾸면 이력을 새로 시작한다.
// 이동평균선 돌파 단계(재매수 기본 단계와 같음): 시선(60분봉) 'N선', 일선 'N일선', 주선 'N주선', 월선 'N개월선'(기본 25~150, 시작선은 1~400). 시세 파일 ma에 같은 이름으로 들어 있다
// (데이터 저장소 kis_prices.py가 lines.names로 이 종목의 일봉·60분봉 이동평균을 계산 — purchase_line_plans).
const PURCHASE_LINES = MA_LINES;
const purchaseLineName = movingLineName;
const purchaseLineNames = lines => [...new Set((Array.isArray(lines?.names)?lines.names:PURCHASE_LINES).map(purchaseLineName).filter(Boolean))];
// 시작선부터 단계 묶음의 나머지를 선택한다. 시간 단위 순서는 시·일·주·월이며 같은 단위는 시작 기간 이상만 포함한다.
// 종료선을 지정하면 그 선까지 자르고 기본 단계에 없는 종료선도 마지막에 넣는다. 종료선이 앞서면 빈 구간, 같은 선이면 한 단계다.
// 직접 고른 시작·종료선을 names의 첫·마지막 항목에 넣어 기존 수집 작업이 같은 선을 받는다. 읽기·계산에서는 저장 필드를 만들지 않는다.
const purchaseLineRange = movingLineRange;
const purchaseWaitLine = plan => purchaseLineName(plan?.wait?.line);
// 대기 기준가는 수집 작업이 계산한 ma만 사용한다. 시세·봉이 없으면 추정하지 않으며 읽기만 할 때 계획을 바꾸지 않는다.
function purchaseWaitInfo(plan, entry){
  const line=purchaseWaitLine(plan), price=line?plus(entry?.ma?.[line]):null, current=plus(entry?.close);
  return {line,price,current,gapPct:price&&current?(current/price-1)*100:null,reached:!!(price&&current&&current<=price)};
}
const purchaseBuys = plan => plan?.buys&&typeof plan.buys==="object"&&!Array.isArray(plan.buys) ? plan.buys : {};
const purchaseStageRecorded = stage => !!(stage?.done||stage?.partial);
const purchasePlannedShares = stage => finite(stage?.plannedShares)??finite(stage?.shares);
const purchaseStageRemaining = stage => {
  if(stage?.done)return 0;
  const amount=Math.max(0,finite(stage?.amount)||0), planned=purchasePlannedShares(stage);
  return stage?.partial?planned>0?amount*Math.max(0,planned-(finite(stage.shares)||0))/planned:Math.max(0,amount-(finite(stage.actual)||0)):amount;
};
// 회차 가격: 이동평균 값이 있는 단계를 순서대로, 단계마다 다음 단계(값이 있는 단계) 가격까지 3번 — 단계 가격·⅓·⅔ 지점(재매수 trancheLevels와 같음,
// 다음 단계가 없거나 더 낮으면 1차만). 목표 가격이 있으면 그보다 낮은 회차 + 마지막 '목표가' 회차(목표 가격).
// 목표 가격이 없으면 선택한 마지막 선의 도달 회차까지 만든다. 명시한 시작선 또는 마지막 선 시세가 없으면 새 회차를 만들지 않고 기다리며, 그 밖의 값이 없는 단계는 건너뛴다.
// 회차 키: '25선:0'(단계 이름:회차 0~2), 목표가는 'end'. 상승 돌파라 현재가 ≥ 회차 가격이면 도달.
function purchaseLineLevels(lines, entry){
  const end=plus(lines?.end), names=purchaseLineNames(lines);
  if(lines?.startLine&&(!names.includes(purchaseLineName(lines.startLine))||!plus(entry?.ma?.[purchaseLineName(lines.startLine)])))return [];
  if(lines?.end!==undefined&&lines.end!==null&&lines.end!==""&&!end)return [];
  if(!end&&!plus(entry?.ma?.[names[names.length-1]]))return [];
  const known=names.map(name=>({name,price:plus(entry?.ma?.[name])})).filter(x=>x.price), out=[];
  known.forEach((s,k)=>{
    const next=known[k+1];
    for(const [t,price] of lineThirds(s.price,next?.price).entries()){
      if(price&&(!end||price<end))out.push({key:`${s.name}:${t}`,line:s.name,t,next:t?next.name:null,price});
    }
  });
  if(end)out.push({key:"end",line:"목표가",t:0,next:null,price:end});
  return out;
}
const purchaseLineLabel = row => row.key==="end" ? "목표가" : `${row.line} ${row.t+1}차`;
// 화면·체크 공통 체결 기본값: 표시 가격(원화 정수·달러 소수 둘째 자리)으로 예산 안에서 살 수 있는 수량을 내림한다.
// 주식은 1주, 비트코인은 0.00000001 BTC 단위. 체결 금액은 그 수량 × 가격 × 환율(만원); 쓰지 않은 예산은 남은 회차에 배분한다.
function purchaseFill(row, currency, fx, step=1){
  const amount=plus(row?.amount), raw=plus(row?.price), rate=currency==="USD"?plus(fx):1;
  if(!amount||!raw||!rate||!(step>0))return null;
  const price=currency==="USD"?Math.round(raw*100)/100:Math.round(raw);
  if(!(price>0))return null;
  const shares=Number((Math.floor(amount*1e4/(price*rate*step)+1e-9)*step).toFixed(8));
  return {shares, price, actual:Number((shares*price*rate/1e4).toFixed(8))};
}
// 추종 ETF: 회차 예산(만원)을 실제 ETF 현재가로 나눠 정수 주수를 내림한다. 예산이 없고 기준 주수만 있으면 기준 주수 × 기준가 × 환율로 예산을 환산한다.
// target은 매수 우선순위의 첫 자산 항목이다. 기준 코드와 같은 ETF는 회차 기준가, 다른 실제 ETF는 선택한 항목의 현재가·직접 입력 가격을 쓴다.
// shares·plannedShares는 실제 ETF 주수, price는 기준 가격. tradeTicker·tradePrice·tradeCurrency는 첫 체결 때 고정해 추가 체결·취소도 같은 ETF 단위를 쓴다.
function purchaseTrackingFill(row, it, prices, fx, currency="USD", target=it){
  const direct=linkTicker(assetTradeTicker(target))===linkTicker(it?.ticker);
  if(target===it&&!tracksETF(it))return purchaseFill(row,currency,fx,linkStep(it));
  const q=direct?{close:plus(row?.price),currency}:assetTradeQuote(prices,target);if(!q?.close)return null;
  let amount=finite(row?.amount);
  if(amount===null){const shares=plus(row?.shares), price=plus(row?.price), rate=currency==="USD"?plus(fx):1;if(!shares||!price||!rate)return null;amount=shares*price*rate/1e4;}
  const fill=purchaseFill({amount,price:q.close},q.currency,fx,linkStep(target));if(!fill)return null;
  const raw=plus(row?.price), price=raw?currency==="USD"?Math.round(raw*100)/100:Math.round(raw):null;
  return {...fill,price,budget:amount,tradeTicker:assetTradeTicker(target),tradePrice:fill.price,tradeCurrency:q.currency};
}
// 회차 목록(화면·합계·알림 공통): 체결 기록(완료·부분 체결) + 아직 안 산 회차(지금 이동평균 기준).
// 부분 체결의 잔량 예산을 먼저 남겨 두고, 나머지 예산만 새 회차에 나눈다. 시세·단계·예산이 바뀌어도 부분 체결 잔량은 사라지지 않는다.
// 각 회차에 최소 1주(실제 추종 ETF도 같은 단위)를 남길 수 있는 최대 회차 수를 고른다. 부족하면 시작~종료 전체 구간에서 회차 간격을 고르게 넓힌다.
// 체결한 회차도 간격 계산에 포함해 건너뛴 앞 회차를 다시 만들지 않는다. 금액은 최소 매수액을 먼저 확보하고 나머지를 가능한 한 같게 나눈다.
// trade는 화면·알림이 쓰는 실제 종목·시세·환율·계획 통화. 필요한 시세나 환율이 없으면 기존 균등 예산을 유지하며 수량을 추정하지 않는다.
// 기준 item으로 전체 계좌 목표·예산을 유지하고 target(없으면 buyPriority 첫 항목)의 실제 가격·단위로 미체결 회차의 수량·최소 매수액을 계산한다.
function purchaseLineRows(plan, entry, trade={}){
  const lines=plan?.lines, buys=purchaseBuys(plan), names=purchaseLineNames(lines);
  const parse=key=>{if(key==="end")return {line:"목표가",t:0};const m=/^(.+):([0-2])$/.exec(key);return m&&purchaseLineName(m[1])?{line:m[1],t:Number(m[2])}:null;};
  const records=Object.entries(buys).map(([key,b])=>{
    const at=b&&typeof b==="object"?parse(key):null;if(!at)return null;
    const planned=plus(b.plannedShares), shares=finite(b.shares), remaining=planned?Number(Math.max(0,planned-(shares||0)).toFixed(8)):0;
    return {key,...at,price:plus(b.price),...(shares!==null?{shares}:{}),done:!remaining,actual:Math.max(0,finite(b.actual)||0),
      ...(planned?{plannedShares:planned,remainingShares:remaining,next:b.next??null,amount:remaining*(plus(b.plannedActual)??plus(b.actual)??0)/(planned||1)}:{})};
  }).filter(Boolean);
  const budget=purchaseBudget(plan,trade), spent=records.reduce((s,r)=>s+r.actual,0), reserved=records.filter(r=>!r.done).reduce((s,r)=>s+r.amount,0), left=Math.max(0,budget-spent-reserved);
  const target=trade.target||(trade.item&&trade.allocation?purchaseTargets(trade.allocation,trade.prices,trade.item,plan)[0]?.it:null)||trade.item;
  const levels=purchaseLineLevels(lines,entry), currency=trade.currency||plan?.currency||(["해외","코인"].includes(entry?.kind)?"USD":"KRW"), step=target?linkStep(target):1;
  let open=left>0?levels.filter(x=>!buys[x.key]):[];
  const amounts=new Map(), costs=new Map(open.map(r=>{
    const fill=trade.item?purchaseTrackingFill({...r,amount:left},trade.item,trade.prices,trade.fx,currency,target):purchaseFill({...r,amount:left},currency,trade.fx,step);
    const price=fill?.tradePrice??fill?.price, rate=(fill?.tradeCurrency||currency)==="USD"?plus(trade.fx):1;
    return [r.key,price&&rate?price*rate*step/1e4:null];
  }));
  if(open.length&&[...costs.values()].every(v=>v>0)){
    const eligible=levels.filter(r=>buys[r.key]||costs.get(r.key)<=budget+1e-8);
    let selected=null;
    for(let count=eligible.length;count>0;count--){
      const spaced=count===1?[eligible[eligible.length-1]]:Array.from({length:count},(_,i)=>eligible[Math.round(i*(eligible.length-1)/(count-1))]);
      const fresh=spaced.filter(r=>!buys[r.key]);
      if(fresh.reduce((sum,r)=>sum+costs.get(r.key),0)<=left+1e-8){selected=fresh;break;}
    }
    // 총예산으로도 1주를 못 사거나 체결 뒤 종료선 가격이 올라 더 살 수 없으면 한 회차에서 실제 부족액을 보여 준다.
    open=selected??[!records.length?open.reduce((a,b)=>costs.get(a.key)<=costs.get(b.key)?a:b):open[open.length-1]];
    let remaining=left;
    [...open].sort((a,b)=>costs.get(b.key)-costs.get(a.key)).forEach((r,i)=>{
      const amount=Math.min(remaining,Math.max(costs.get(r.key),remaining/(open.length-i)));
      amounts.set(r.key,amount);remaining-=amount;
    });
  }
  const order=r=>r.key==="end"?1e6:(names.indexOf(r.line)+1||999)*3+r.t;
  return [...records,...open.map(x=>({...x,done:false,amount:amounts.get(x.key)??left/open.length}))].sort((a,b)=>order(a)-order(b));
}
// 합계: 예정 = 총 매수 금액(이동평균선 돌파) 또는 회차 예정액 합(직접 입력), 체결 = 부분 체결·완료의 실제 금액, 남은 예정 = 예산 차이·미체결 잔량 예정액.
// 이동평균선 돌파의 회차 수는 지금 이동평균 기준이라 entry(시세 파일 종목)가 필요하다(없으면 목표 가격을 넣은 계획만 목표가 회차).
function purchaseSummary(plan, entry=null, trade={}){
  if(plan?.wait)return {count:0,done:0,planned:0,actual:0,remaining:0};
  if(plan?.lines){
    const rows=purchaseLineRows(plan,entry,trade), actual=rows.reduce((s,r)=>s+(r.actual||0),0), budget=purchaseBudget(plan,trade);
    return {count:rows.length,done:rows.filter(r=>r.done).length,planned:budget,actual,remaining:Math.max(0,budget-actual)};
  }
  const stages=Array.isArray(plan?.stages)?plan.stages:[];
  const amount=s=>Math.max(0,finite(s.amount)||0), done=stages.filter(s=>s.done), recorded=stages.filter(purchaseStageRecorded);
  return {count:stages.length,done:done.length,planned:stages.reduce((n,s)=>n+amount(s),0),
    actual:recorded.reduce((n,s)=>n+Math.max(0,finite(s.actual)??amount(s)),0),remaining:stages.reduce((n,s)=>n+purchaseStageRemaining(s),0)};
}
// 방향: 매수대기는 하락("down" — 현재가 ≤ 선택한 이동평균선), 이동평균선 돌파는 상승("up" — 현재가 ≥ 회차 가격이면 도달). 기존 직접 입력은 마지막 회차 가격이 첫 회차보다 높으면 상승, 그 밖은 하락.
// 화면의 '도달' 표시와 휴대폰 알림이 같은 기준.
function purchaseDirection(plan){
  if(plan?.wait)return "down";
  if(plan?.lines)return "up";
  const p=(Array.isArray(plan?.stages)?plan.stages:[]).map(s=>plus(s?.price)).filter(v=>v!==null);
  return p.length>1&&p[p.length-1]>p[0]?"up":"down";
}
// 회차 알림 켬: 회차 설정(직접 입력은 stages[].notify, 이동평균선 돌파는 notify.keys[회차 키])이 있으면 그것, 없으면 계획의 notify.stages(카드의 '전체 ON').
// 버튼을 누를 때만 저장한다. row는 직접 입력 회차(stage) 또는 purchaseLineRows의 회차.
function purchaseAlertOn(plan, row){
  const n=plan?.notify&&typeof plan.notify==="object"?plan.notify:{}, own=row?.key?n.keys?.[row.key]:row?.notify;
  return typeof own==="boolean"?own:n.stages===true;
}
// 종목 코드 → 시세 종류(데이터 저장소 kis_prices.py classify와 같은 형식): BTC-USD는 코인, 국내 6자리(A·Q 접두 포함)·코스피200 KS200은 국내, 미국 심볼은 해외, 그 밖은 null
function purchaseQuoteKind(ticker){
  const t=String(ticker||"").trim().toUpperCase();
  return t==="BTC-USD"?"코인":t==="KS200"||/^[AQ]\d{6}$|^\d[0-9A-Z]{5}$/.test(t)?"국내":/^[A-Z][A-Z0-9.\-/]{0,11}$/.test(t)?"해외":null;
}
// 분할매수 회차 휴대폰 알림 규칙(js/trade-alerts.js buildTradeAlertRules와 같은 모양): 종목 코드가 있고 가격이 있는 미완료 회차 중 알림을 켠 것.
// quiet=true(수집 작업만)면 알림을 끈 미완료 회차도 notify:false로 더한다(도달 알림 없이 미체결 재알림만). 체결이 없는 매수대기는 켤 때만.
// 계획 통화(달러 계획만 currency 저장, 없으면 시세 통화 → 원화)가 종목 코드 시장 통화와 다르면 보내지 않는다.
// 이동평균선 돌파 회차는 지금 이동평균 가격으로(이력은 단계 이름·회차로 이어져 이평선이 움직여도 다시 알리지 않음), 직접 입력 회차는 가격·방향을 바꾸면 이력이 새로.
// 데이터 저장소의 compile_trade_alerts.cjs가 etf-planner-assets.json에 이 함수를 그대로 실행하고, kis_prices.py가 이동평균선 돌파·매수대기 종목(purchase_line_plans)은 선택한 선의 전체 시세·60분봉을,
// 직접 입력 알림 종목(purchase_alert_tickers)은 장중 실행마다 종가를 받는다(함수 이름·켜짐 판정·단계 이름을 바꾸면 그쪽도 같이).
// 라벨 '매수대기 25개월선'·'분할매수 N차'·'분할매수 25선 1차'·'분할매수 목표가'는 그 저장소 ma_alerts.py TRADE_LABEL_RE와 같은 형식.
function purchaseAlertRules(assets, prices, quiet=false){
  const rules=[];
  for(const g of Array.isArray(assets?.allocation?.groups)?assets.allocation.groups:[])for(const it of Array.isArray(g?.items)?g.items:[]){
    const plan=it?.buyPlan, ticker=String(it?.ticker||"").trim().toUpperCase(), kind=purchaseQuoteKind(ticker);
    if(!plan||!kind||!it.id||(plan.currency||assetQuote(prices,ticker)?.currency||"KRW")!==(kind==="국내"?"KRW":"USD"))continue;
    const add=(key,label,price,condition,revision,on=true)=>rules.push({id:`trade:buy:${it.id}:${key}`,kind:"trade",ticker,label,targetPrice:price,condition,quoteGroup:"stocks",quoteKey:ticker,quoteKind:kind,enabled:true,revision:JSON.stringify(revision),...(on?{}:{notify:false})});
    if(plan.wait){
      const entry=prices?.stocks?.[ticker], info=purchaseWaitInfo(plan,entry?.kind===kind?entry:null);
      if(["국내","해외"].includes(kind)&&info.price&&purchaseAlertOn(plan,{key:"wait"}))
        add("wait",`매수대기 ${info.line}`,info.price,"down",["wait",info.line,"down"]);
      continue;
    }
    if(plan.lines){
      const entry=prices?.stocks?.[ticker];
      const trade={item:it,target:purchaseTargets(assets?.allocation,prices,it,plan)[0]?.it||it,allocation:assets?.allocation,prices,fx:assetFx(prices,assets?.allocation),currency:plan.currency||assetQuote(prices,ticker)?.currency||"KRW"};
      for(const r of purchaseLineRows(plan,entry&&entry.kind===kind?entry:null,trade)){const on=purchaseAlertOn(plan,r);
        if(!r.done&&r.price&&(on||quiet)&&(r.remainingShares>0||purchaseTrackingFill(r,it,prices,trade.fx,trade.currency,trade.target)?.shares!==0))
          add(r.key,`분할매수 ${purchaseLineLabel(r)}`,r.price,"up",r.key==="end"?["end",r.price]:[r.line,r.t,r.next],on);}
      continue;
    }
    const condition=purchaseDirection(plan);
    (Array.isArray(plan.stages)?plan.stages:[]).forEach((s,i)=>{
      const price=plus(s?.price);
      const on=purchaseAlertOn(plan,s);
      if(price&&!s.done&&s.id&&(on||quiet))add(s.id,`분할매수 ${i+1}차`,price,condition,[price,condition],on);
    });
  }
  return rules;
}
// 화면에 쓰는 합계. base = 비중 기준(직접 넣은 기준 총자산, 없으면 종목+현금 합계)
function allocationSummary(alloc, prices){
  const fx=assetFx(prices,alloc), items=new Map(), groups=new Map(), classes=new Map(), sections=new Map(), targets=allocationTargets(alloc);
  let invest=0;
  for(const g of alloc?.groups||[]){
    let sum=0;
    for(const it of g.items||[]){
      const r=itemValue(it,prices,fx);items.set(it.id,r);sum+=r.value;
      if(it.section){const k=`${g.id}\u0000${it.section}`;sections.set(k,(sections.get(k)||0)+r.value);}
    }
    groups.set(g.id,sum);invest+=sum;classes.set(g.classId,(classes.get(g.classId)||0)+sum);
  }
  const cash=(alloc?.cash||[]).reduce((s,c)=>s+cashValue(c,fx),0);
  for(const c of alloc?.classes||[])if(c.cash)classes.set(c.id,(classes.get(c.id)||0)+cash);
  const grand=invest+cash, base=plus(alloc?.total)||grand;
  const classList=allocationClassList(alloc);
  const regions=[...new Set([...ASSET_REGIONS,...classList.map(c=>c.region||"기타")])]
    .map(name=>({name,classes:classList.filter(c=>(c.region||"기타")===name)})).filter(r=>r.classes.length)
    .map(r=>({...r,value:r.classes.reduce((s,c)=>s+(classes.get(c.id)||0),0),target:r.classes.some(c=>targets.classes.get(c.id).target!==null)?r.classes.reduce((s,c)=>s+(targets.classes.get(c.id).target??0),0):null}));
  return {fx, invest, cash, grand, base, items, groups, classes, regions, targets, section:(gid,name)=>sections.get(`${gid}\u0000${name}`)||0, pct:v=>base>0?v/base*100:0};
}

// 매수·매도 보유 목록의 표시 값은 자산현황의 실제 ETF 평가액·현물/입력 환율·전체 자산 분모를 그대로 읽는다.
// 매도 계획의 환율·가격·내림한 예정 주수로 현재 보유액을 다시 계산하지 않는다. 보유 소수 수량은 유지하고 필요한 시세·환율이 없으면 평가 대기로 구분한다.
const {allocationHoldingInfo,allocationHoldingTotal}=(()=>{
  const nf1=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}),nf2=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}),nf8=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
  const valueInfo=(value,pct,valuePending)=>({value,pct,valueText:valuePending?"평가 대기":`${nf1.format(Math.round(value*10)/10)}만원`,pctText:valuePending?"—":`${(Math.abs(pct)<1?nf2:nf1).format(pct)}%`});
  const info=(it,s)=>{
    const entry=s.items.get(it.id),value=entry?.value||0,pct=s.pct(value),shares=finite(it.shares),missing=shares>0&&!krwPrice(entry?.q,s.fx);
    const pending=missing?(entry?.q?.currency==="USD"&&!s.fx?"환율 대기":"시세 대기"):"",valuePending=missing&&value===0;
    return {...valueInfo(value,pct,valuePending),shares,pending,valuePending,quantityText:shares===null?"금액으로 보유 관리":`보유 ${nf8.format(shares)}${linkStep(it)<1?" BTC":"주"}`};
  };
  // 목록 합계도 항목과 같은 반올림·전체 자산 분모를 쓴다. 일부 평가 대기는 개수로, 전부 대기면 합계도 평가 대기로 표시한다.
  const total=(infos,s)=>{
    const rows=[...infos],value=rows.reduce((n,r)=>n+r.value,0),pendingCount=rows.filter(r=>r.valuePending).length;
    return {...valueInfo(value,s.pct(value),pendingCount>0&&pendingCount===rows.length),pendingCount};
  };
  return {allocationHoldingInfo:info,allocationHoldingTotal:total};
})();

// 연결 항목 [{g, it}]의 자산 배분 목표 — 분할매수·분할매도·재매수가 같은 규칙으로 읽는 단일 기준(자산 배분 목표만 쓰고 계획에 따로 저장하지 않는다).
// 항목 목표가 하나라도 있으면 그 합(scope item). 없으면 연결 항목이 전부 포함된 그룹의 목표, 일부만 포함된 그룹에서는 전부 포함된 소분류의 목표를 더한다(scope group·section).
// 목표가 없으면 {target:null, scope:null}. 저장된 목표는 읽기만 한다.
function linkedAllocationTarget(rows, summary){
  const ids=new Set(rows.map(r=>r.it.id)), own=rows.map(({it})=>finite(it.target)).filter(v=>v!==null), sum=list=>Math.round(list.reduce((n,v)=>n+v,0)*1e8)/1e8;
  if(own.length)return {target:sum(own),scope:"item"};
  const groups=[], sections=[];
  for(const g of new Set(rows.map(r=>r.g))){
    if((g.items||[]).every(it=>ids.has(it.id))){const t=summary.targets.groups.get(g.id)?.target;if(t!=null)groups.push(t);continue;}
    for(const name of new Set(rows.filter(r=>r.g===g).map(r=>r.it.section).filter(Boolean)))
      if(g.items.filter(it=>it.section===name).every(it=>ids.has(it.id))){const t=summary.targets.section(g.id,name).target;if(t!==null)sections.push(t);}
  }
  return groups.length||sections.length?{target:sum([...groups,...sections]),scope:groups.length?"group":"section"}:{target:null,scope:null};
}
// 분할매수의 투자 대상은 저장된 기준 ticker·실제 tradeTicker 연결로 구분한다. 같은 코드의 다른 계좌와 명시적으로 연결된 추종 ETF를 중복 없이 합산한다.
// 이름·큰 분류·소분류가 비슷하다는 이유로 합치지 않는다. 코드가 없으면 선택한 항목만, 평가액·분모는 자산현황 allocationSummary 그대로 쓴다.
// 목표는 자산 배분 목표(linkedAllocationTarget — assetTarget)가 우선이고, 자산 배분에 목표가 없을 때만 옛 계획 목표(lines.target)를 쓴다(scope plan).
// 계좌별 보유량·저장 목표·계획은 읽기만 한다.
function purchaseAllocationSummary(alloc, prices, item, plan=item?.buyPlan, summary=allocationSummary(alloc,prices)){
  const all=(alloc?.groups||[]).flatMap(g=>(g.items||[]).map(it=>({g,it}))), keys=new Set(), ids=new Set();
  const addKeys=it=>{for(const code of [it?.ticker,it?.tradeTicker]){const key=linkTicker(code);if(key)keys.add(key);}};
  addKeys(item);
  let changed=true;
  while(changed){
    changed=false;
    for(const {it} of all){
      if(ids.has(it.id)||!(it.id===item?.id||[it.ticker,it.tradeTicker].some(code=>keys.has(linkTicker(code)))))continue;
      ids.add(it.id);addKeys(it);changed=true;
    }
  }
  const rows=all.filter(({it})=>ids.has(it.id)).map(x=>({...x,value:summary.items.get(x.it.id)?.value||0})), value=rows.reduce((n,r)=>n+r.value,0);
  const asset=linkedAllocationTarget(rows,summary), legacy=finite(plan?.lines?.target);
  const target=asset.target??legacy, scope=asset.target!==null?asset.scope:legacy!==null?"plan":null, pct=summary.pct(value);
  const gap=target!==null&&summary.base>0?target/100*summary.base-value:null;
  return {rows,value,pct,target,assetTarget:asset.target,scope,gap,gapPct:gap===null?null:target-pct,buyable:gap===null?null:Math.max(0,gap),base:summary.base};
}
// buyPriority는 화살표로 정렬한 자산 항목 id. 같은 투자 대상으로 연결된 항목만 정렬하고 삭제·중복·다른 상품의 id는 읽을 때 무시한다.
// 미설정·초기화 후에는 계획이 붙은 항목이 첫 순위다. 최상위는 새 회차에만 쓰고 기존 체결 기록은 바꾸지 않는다.
function purchaseTargets(alloc, prices, item, plan=item?.buyPlan, summary=allocationSummary(alloc,prices)){
  const rows=purchaseAllocationSummary(alloc,prices,item,plan,summary).rows,priority=Array.isArray(plan?.buyPriority)?plan.buyPriority:[],rank=new Map();
  for(const id of [...priority,item?.id])if(!rank.has(id))rank.set(id,rank.size);
  return rows.sort((a,b)=>(rank.get(a.it.id)??Infinity)-(rank.get(b.it.id)??Infinity));
}
// 저장한 총 매수 금액은 한도로 유지하고, 아직 시작하지 않은 회차는 전체 계좌의 목표까지 남은 금액 안에서만 배분한다.
// 목표가 없으면 기존 직접 예산을 그대로 쓴다. 이미 체결한 금액과 부분 체결의 고정 잔량은 보존하며, 계산만으로 저장 예산을 덮어쓰지 않는다.
// 화면·합계·알림은 allocation과 item을 함께 넘겨 같은 한도를 적용한다. 다른 계좌 보유액·시세·기준 총자산 변경도 다음 계산에 반영된다.
function purchaseBudget(plan, trade={}){
  const budget=Math.max(0,finite(plan?.lines?.budget)||0);
  if(!trade.allocation||!trade.item)return budget;
  const holding=purchaseAllocationSummary(trade.allocation,trade.prices,trade.item,plan);
  if(holding.buyable===null)return budget;
  let spent=0,reserved=0;
  for(const b of Object.values(purchaseBuys(plan))){
    spent+=Math.max(0,finite(b?.actual)||0);
    const planned=plus(b?.plannedShares), remaining=planned?Math.max(0,planned-(finite(b?.shares)||0)):0;
    if(remaining)reserved+=remaining*(plus(b.plannedActual)??plus(b.actual)??0)/planned;
  }
  return Math.max(spent+reserved,Math.min(budget,spent+holding.buyable));
}
// 총 매수 금액 자동 계산(계획 창의 자동 금액·'다시 계산'과 같은 식): 목표 비중 × 기준 총자산 − 연결 계좌 평가액(0 아래는 0) + 이미 체결한 금액, 0.1만원 단위.
// holding은 purchaseAllocationSummary 결과, target이 없으면 null.
function purchaseAutoBudget(plan, holding, target=holding?.target){
  if(!holding||target===null||target===undefined)return null;
  const spent=Object.values(purchaseBuys(plan)).reduce((n,b)=>n+Math.max(0,finite(b?.actual)||0),0);
  return Math.round((Math.max(0,target/100*holding.base-holding.value)+spent)*10)/10;
}
// 자산 배분을 저장할 때(assetStore.saveSection) 저장 전(before)·후(after) allocation으로 부른다. 이동평균선 돌파 계획마다 자산 배분 목표(assetTarget)를 비교해
// 바뀐 계획만 고친다: 옛 계획 목표(lines.target)를 지우고, 새 목표가 있고 쓰던 목표와 다르면 총 매수 금액(lines.budget)을 purchaseAutoBudget으로 다시 계산한다
// (계획 창에서 목표를 바꿀 때처럼 직접 고친 금액도 새 목표의 자동 금액으로 바뀐다). 목표를 지우면 저장 예산은 그대로 둔다.
// 체결·부분 체결(buys)·단계·시작선·목표 가격·우선순위·알림·반영 기록(allocation.trades)은 바꾸지 않고, 새로 만든 계획·목표가 그대로인 계획은 건너뛴다.
// 저장 예산을 그대로 쓰는 수집 작업(purchaseBudget)도 같은 금액을 읽는다. 고친 계획의 자산 종목 id 목록을 돌려준다.
function syncPurchaseTargets(before, after, prices){
  const plans=(after?.groups||[]).flatMap(g=>(g.items||[]).filter(it=>it.buyPlan?.lines&&typeof it.buyPlan.lines==="object"));
  if(!before||!plans.length)return [];
  const old=allocationSummary(before,prices), now=allocationSummary(after,prices), changed=[];
  for(const it of plans){
    const prev=allocItemById(before,it.id);if(!prev?.buyPlan?.lines)continue;
    const was=purchaseAllocationSummary(before,prices,prev,prev.buyPlan,old), holding=purchaseAllocationSummary(after,prices,it,it.buyPlan,now), target=holding.assetTarget;
    if(target===was.assetTarget)continue;
    delete it.buyPlan.lines.target;
    if(target!==null&&target!==was.target&&holding.base>0)it.buyPlan.lines.budget=purchaseAutoBudget(it.buyPlan,holding,target);
    changed.push(it.id);
  }
  return changed;
}

// ---------- 플래너 체결 → 자산 배분 연동 (화면·계좌 고르는 창은 플래너 js/alloc-link.js) ----------
// 분할매도 회차·재매수 손절·재매수 회차·분할매수 회차를 체크하면 종목 코드가 같은 자산 배분 종목(계좌)의 보유량을 줄이거나 늘리고, 체크를 풀면 되돌린다.
// 연결: 종목 코드가 같은 종목(대문자, 국내 코드 'A' 접두 무시, '비트코인' = BTC-USD). 분할매수는 계획이 붙은 종목도(코드가 없어도) 연결.
// 반영 기록 allocation.trades = {출처 키: {label, at, qty, price, value, items:[{id, shares?, amount?, fresh?}]}} — 체크한 동안만 두고 풀면 지운다(처음 반영할 때만 만듦).
//   items의 shares·amount는 그 종목에 실제로 더한 양(매도는 음수, 0 아래로 내려가지 않게 자른 값)이라 되돌리면 원래 값. fresh는 보유 수량 칸을 새로 만든 것(되돌려 0이면 칸을 지움). exact는 rescaleTrade의 반올림 전 양(그 함수 주석).
//   qty(주)·price(체결 통화)·value(만원)는 반영할 때의 체결 크기 — 체크 뒤 체결 수량·가격·금액을 고치면 같은 비율로 items를 다시 맞춘다(rescaleTrade).
//   기준 티커와 실제 ETF 단위가 다르면 투자 금액을 실제 ETF 가격으로 나눈 주수를 내림하고 items[].converted로 표시해 금액 비율로 정정한다.
// 출처 키(기존 반영을 되돌리는 데 쓰는 형식): 'sell:계획 id:회차', 'cut:재매수 종목 id:회차', 'rebuy:재매수 종목 id:단계 이름:회차', 'buy:자산 종목 id:회차 키(이동평균선 돌파) 또는 회차 id(직접 입력)'.
// 종목마다 단위: 보유 수량 칸(shares, 0 포함)이 있으면 수량(비트코인 0.00000001, 나머지 1주), 없으면 금액(amount, 만원). 빈 종목(수량 없고 금액 0)은 체결 수량을 알면 수량.
//   금액 종목이 시세를 따라가면(base) 금액 칸은 '넣을 때 가격' 기준이라, 지금 평가액 V만원을 사고팔면 amount를 V × (amount ÷ 지금 평가액)만큼 바꾼다(기준 가격 base는 그대로 — 입력 대비 수익률 유지).
//   금액 0에서 사면 기준 가격을 지금 시세로 다시 잡는다(resetBase).
const linkTicker = t => { const s=String(t||"").trim().toUpperCase(); return s==="비트코인"?"BTC-USD":s.replace(/^A(\d[0-9A-Z]{5})$/,"$1"); };
const linkStep = it => linkTicker(assetTradeTicker(it))==="BTC-USD" ? 1e-8 : 1;
const linkRound = (v, step) => step<1 ? Number((Math.round(v/step)*step).toFixed(8)) : Math.round(v/step)*step;
function allocItemById(alloc, id){ for(const g of alloc?.groups||[])for(const it of g.items||[])if(it.id===id)return it; return null; }
// 연결 종목 [{g, it}]: 종목 코드가 같은 종목 + ownId 종목(분할매수 계획이 붙은 종목). 종목 코드가 비었으면 ownId만.
function linkedItems(alloc, ticker, ownId=null){
  const key=linkTicker(ticker), out=[];
  for(const g of alloc?.groups||[])for(const it of g.items||[])if(it.id===ownId||key&&(linkTicker(it.ticker)===key||linkTicker(assetTradeTicker(it))===key))out.push({g,it});
  return out;
}
// 계획 화면의 '자산 배분' 줄과 보유량 가져오기: 연결 종목 합계 평가액·비중, 목표(linkedAllocationTarget — 분할매수와 같은 자산 배분 목표 규칙, scope item·group·section),
// 목표와의 차이(gap > 0 목표까지 더 살 금액, < 0 목표 초과), 보유 수량 합(모든 연결 종목에 수량이 있고 실제 거래 티커가 기준 티커와 같을 때만).
function linkSummary(alloc, prices, ticker, ownId=null){
  const list=linkedItems(alloc,ticker,ownId);if(!list.length)return null;
  const s=allocationSummary(alloc,prices), rows=list.map(x=>({...x,value:s.items.get(x.it.id)?.value||0})), value=rows.reduce((n,r)=>n+r.value,0);
  const {target,scope}=linkedAllocationTarget(list,s);
  const allShares=list.every(x=>finite(x.it.shares)!==null&&linkTicker(assetTradeTicker(x.it))===linkTicker(ticker)), step=linkStep(list[0].it);
  return {rows, value, pct:s.pct(value), target, scope, gap:target!==null?target/100*s.base-value:null, shares:allShares?linkRound(list.reduce((n,x)=>n+finite(x.it.shares),0),step):null, base:s.base, fx:s.fx};
}
// 체결 = {sign: -1 매도·손절, 1 매수, qty?: 수량, price?: 가격(계획 통화), currency: "KRW"|"USD", value?: 금액(만원)}. 모르는 값은 null.
// 연결 종목마다 단위와 미리 채울 양(n, 양수 — 수량 종목은 수량, 금액 종목은 지금 평가액 기준 만원): 수량은 체결 수량, 없으면 금액 ÷ 체결 가격(없으면 지금 시세).
// 금액은 체결 금액, 없으면 수량 × 체결 가격(없으면 지금 시세)을 0.1만원 단위로. 계산할 수 없으면 n = null(창에서 직접 넣음).
function tradeRows(alloc, prices, ticker, trade, ownId=null){
  const s=allocationSummary(alloc,prices), qty=plus(trade?.qty), rate=trade?.currency==="USD"?s.fx:1, px=plus(trade?.price)&&rate?trade.price*rate:null;
  return linkedItems(alloc,ticker,ownId).map(({g,it})=>{
    const r=s.items.get(it.id), converted=linkTicker(assetTradeTicker(it))!==linkTicker(ticker), price=converted?krwPrice(r?.q,s.fx):px||krwPrice(r?.q,s.fx), step=linkStep(it);
    const unit=finite(it.shares)!==null||!(finite(it.amount)>0)&&qty?"shares":"amount";
    const value=plus(trade?.value)??(qty&&(converted?px:price)?qty*(converted?px:price)/1e4:null), n=unit==="shares"?(!converted?qty:null)??(value&&price?value*1e4/price:null):value;
    return {g,it,unit,step,converted,value:r?.value||0,n:n===null?null:unit==="shares"?converted?Math.floor(n/step+1e-9)*step:linkRound(n,step):Math.round(n*10)/10};
  });
}
// 종목 칸(shares·amount)에 d를 더한다(0 아래로는 자름). 실제로 더한 양을 돌려준다(없으면 0).
function bumpField(it, field, d, step){
  const old=finite(it[field])||0, next=Math.max(0,linkRound(old+d,step)), done=linkRound(next-old,step);
  if(done)it[field]=next;
  return done;
}
// 반영: picks = [{id, unit, n}](n은 tradeRows와 같은 단위·양수). 같은 키가 남아 있으면(다른 기기 기록을 고른 경우 등) 먼저 되돌린다. 반영한 기록(없으면 null).
function applyTrade(alloc, prices, key, trade, label, picks){
  revertTrade(alloc,key);
  const s=allocationSummary(alloc,prices), sign=trade?.sign<0?-1:1, items=[];
  for(const p of picks||[]){
    const it=allocItemById(alloc,p?.id), n=plus(p?.n);if(!it||!n)continue;
    if(p.unit==="shares"){
      const fresh=finite(it.shares)===null, add=bumpField(it,"shares",sign*n,linkStep(it));
      if(add)items.push({id:it.id,shares:add,...(fresh?{fresh:true}:{}),...(trade?.ticker&&linkTicker(trade.ticker)!==linkTicker(assetTradeTicker(it))?{converted:true}:{})});
    }else{
      const was=finite(it.amount)||0, v=s.items.get(it.id)?.value||0, add=bumpField(it,"amount",sign*n*(was>0&&v>0?was/v:1),0.01);
      if(!add)continue;
      if(!(was>0)&&finite(it.shares)===null)resetBase(it,prices,alloc);
      items.push({id:it.id,amount:add});
    }
  }
  if(!items.length)return null;
  const rec={label:String(label||""),at:new Date().toISOString(),qty:plus(trade?.qty),price:plus(trade?.price),value:plus(trade?.value),items};
  alloc.trades={...(alloc.trades&&typeof alloc.trades==="object"?alloc.trades:{}),[key]:rec};
  return rec;
}
// 되돌리기: 기록한 양을 거꾸로 더하고 기록을 지운다(지워진 종목은 건너뜀). 되돌린 기록(없으면 null).
function revertTrade(alloc, key){
  const rec=alloc?.trades?.[key];if(!rec)return null;
  for(const e of Array.isArray(rec.items)?rec.items:[]){
    const it=allocItemById(alloc,e?.id);if(!it)continue;
    if(finite(e.shares)!==null){if(e.shares)bumpField(it,"shares",-e.shares,linkStep(it));if(e.fresh&&!(finite(it.shares)>0))delete it.shares;}
    if(finite(e.amount))bumpField(it,"amount",-e.amount,0.01);
  }
  delete alloc.trades[key];if(!Object.keys(alloc.trades).length)delete alloc.trades;
  return rec;
}
// 체크 뒤 체결 크기를 고쳤을 때(trade = 새 {qty, price, value}): 수량 종목은 수량 비율, 금액 종목은 금액 비율(금액이 없으면 수량 × 가격, 그다음 수량 비율)로
// 반영한 양을 다시 맞춘다. 수량은 같은 최소 단위·방향의 계좌별 합계를 먼저 반올림하고, 남는 최소 단위는 소수부가 큰 계좌부터 배분한다(4주+4주를 7주로 고쳐도 합계 7주).
// 반올림·내림 전 양은 items[].exact에 두고 다음 수정의 기준으로 쓴다(수량은 반영량과 다를 때, 금액은 0.01만원 아래라 0이 될 때만 저장).
// 크게 줄여 반영량이 0이 된 계좌도 다시 고치면 같은 비율로 돌아오고, 추종 ETF 주수 내림이 고칠 때마다 쌓이지 않는다.
// exact는 반영량과 방향이 같고 최소 단위 2개 안일 때만 읽는다(없거나 맞지 않으면 지금 반영량 — 반영량만 고친 옛 기록·다른 경로 호환).
// 비율을 알 수 없거나(0·빈 값) 그대로면 바꾸지 않는다. 바뀐 기록(없으면 null).
function rescaleTrade(alloc, key, trade){
  const rec=alloc?.trades?.[key];if(!rec)return null;
  const q=plus(trade?.qty), p=plus(trade?.price), v=plus(trade?.value), ratio=(a,b)=>a&&b?a/b:null;
  const rq=ratio(q,rec.qty), rpq=ratio(q&&p?q*p:null,rec.qty&&rec.price?rec.qty*rec.price:null), rv=ratio(v,rec.value);
  const fShares=rq??rv??rpq, fAmount=rv??rpq??rq;
  const start=(e,field,step)=>{const n=finite(e[field]), x=finite(e.exact);return x&&(!n||Math.sign(x)===Math.sign(n))&&Math.abs(x-(n||0))<2*step?x:n;};
  const keep=(e,exact,n,step)=>{if(exact&&Math.abs(exact-n)>step*1e-6)e.exact=Number(exact.toPrecision(12));else delete e.exact;};
  const targets=new Map(), groups=new Map();
  for(const e of Array.isArray(rec.items)?rec.items:[]){
    const it=allocItemById(alloc,e?.id);if(!it||finite(e.shares)===null)continue;
    const factor=e.converted?fAmount:fShares;if(!factor||factor===1)continue;
    const step=linkStep(it), from=start(e,"shares",step);if(!from)continue;
    const sign=from<0?-1:1, key=`${step}:${sign}:${!!e.converted}`, rows=groups.get(key)||[], scaled=Math.abs(from)/step*factor;
    rows.push({e,step,sign,scaled,base:Math.floor(scaled),fraction:scaled-Math.floor(scaled)});groups.set(key,rows);
  }
  for(const rows of groups.values()){
    const total=rows.reduce((n,r)=>n+r.scaled,0),extra=Math.max(0,(rows[0].e.converted?Math.floor(total+1e-9):Math.round(total))-rows.reduce((n,r)=>n+r.base,0));
    [...rows].sort((a,b)=>b.fraction-a.fraction).slice(0,extra).forEach(r=>r.base++);
    rows.forEach(r=>targets.set(r.e,{n:linkRound(r.sign*r.base*r.step,r.step),exact:r.sign*r.scaled*r.step}));
  }
  let changed=false;
  for(const e of Array.isArray(rec.items)?rec.items:[]){
    const it=allocItemById(alloc,e?.id), t=targets.get(e);if(!it)continue;
    if(t){const step=linkStep(it), add=bumpField(it,"shares",t.n-e.shares,step);if(add){e.shares=linkRound(e.shares+add,step);changed=true;}keep(e,t.exact,t.n,step);}
    else if(finite(e.shares)===null&&finite(e.amount)!==null&&fAmount&&fAmount!==1){
      const from=start(e,"amount",0.01);if(!from)continue;
      const exact=from*fAmount, n=Math.round(exact*100)/100, add=bumpField(it,"amount",n-e.amount,0.01);
      if(add){e.amount=linkRound(e.amount+add,0.01);changed=true;}
      keep(e,n?0:exact,n,0.01);
    }
  }
  rec.qty=q??rec.qty;rec.price=p??rec.price;rec.value=v??rec.value;
  return changed?rec:null;
}

// ---------- 월별 손익 ----------
// 달러 배당은 입력 금액 × 적용 환율을 원 단위로 반올림한다. 0달러는 환율 없이도 0원이며, 양수 환율이 없으면 null.
function pnlDollarKrw(amount, fx){
  const n=finite(amount), rate=plus(fx);
  if(n===null)return null;
  return n===0?0:rate&&Number.isFinite(n*rate)?Math.round(n*rate):null;
}
// 저장된 환율을 우선하고, 옛 달러·원화 기록은 당시 환율을 역산한다. 새 기록은 호출부가 고른 평균 환율을 기본값으로 쓴다.
function pnlDollarFx(entry, fallback){
  const amount=finite(entry?.amount), won=finite(entry?.krw);
  return plus(entry?.fx)||(amount&&won!==null?plus(won/amount):null)||plus(fallback);
}
// pnlEntries = [{broker, label?, amount, currency?:"USD", krw?, fx?, fxBasis?:"125개월선", fxAt?}]. 원화는 amount, 달러는 저장한 원화 환산액 krw만 한 번 합산한다.
// krw 없는 새 형식은 저장된 fx로 계산한다. 현재 시세로 과거 손익을 바꾸지 않는다. 미완성 내역은 null, 상세 없는 기존 기록은 pnl을 쓴다.
function pnlEntriesTotal(entries){
  if(!Array.isArray(entries)||!entries.length)return null;
  let total=0;
  for(const e of entries){
    const amount=finite(e?.amount), won=e?.currency==="USD"?finite(e.krw)??pnlDollarKrw(amount,e.fx):amount;
    if(amount===null||won===null)return null;
    total+=won;
  }
  return Math.round(total);
}
const monthPnl = m => Array.isArray(m?.pnlEntries)&&m.pnlEntries.length?pnlEntriesTotal(m.pnlEntries):finite(m?.pnl);
// 옛 기록의 loan 계좌는 표시·입력·계산에서 제외한다. 원래 잔액 배열의 인덱스를 유지하며 읽기만 해서는 저장 기록을 바꾸지 않는다.
const ledgerAccounts = year => (year?.accounts||[]).map((account,index)=>({account,index})).filter(x=>!x.account?.loan);
// 달 총자산(원): 남은 계좌 잔액 합계, 계좌별 잔액이 없으면 직접 넣은 total. 옛 loan 계좌가 있으면 총액만으로 자산을 추정하지 않는다.
// noLoan은 이전 호출부 호환을 위한 total의 별칭이다.
function monthTotals(year, m){
  const bal=Array.isArray(m?.balances)?m.balances:[], acc=year?.accounts||[];
  if(!bal.some(v=>finite(v)!==null)){const total=acc.some(a=>a?.loan)?null:finite(m?.total);return {total,noLoan:total};}
  let total=0;
  bal.forEach((v,i)=>{if(!acc[i]?.loan)total+=finite(v)||0;});
  return {total,noLoan:total};
}
// 연 요약: 월 손익 ÷ 그 달 총자산을 합산한다. 선물옵션은 달마다 넣은 값(m.futures)을 그 달 총자산으로 나눠 더하고,
// 달을 모르는 연 합계(year.futures, 옛 기록 방식)는 마지막 잔액의 총자산으로 나눠 더한다. 두 방식은 함께 쓸 수 있으며 둘 다 합한다.
// 실현손익·선물옵션이 있는 달의 분모가 하나라도 없거나 0 이하면 해당 연 수익률은 null. 빈 해도 null(연평균에 0%로 섞지 않는다).
// futures = 월별 선물옵션 합 + 연 합계(둘 다 없으면 null), futuresYear = 연 합계만.
// annual은 월 수익률 합 × 12 ÷ 실현손익 기록 개월 수(선물옵션 제외). rateNoLoan·annualNoLoan은 이전 호출부 호환 별칭이다.
function yearSummary(year){
  let pnl=0,rate=0,months=0,rated=0,interest=0,hasInterest=false,last=null,monthFut=null,futRate=0,futRated=true;
  for(const m of [...(year?.months||[])].sort((a,b)=>a.m-b.m)){
    const t=monthTotals(year,m), p=monthPnl(m), f=finite(m.futures);
    if(t.total!==null)last={m:m.m,...t};
    if(p!==null){pnl+=p;months++;if(t.total>0){rate+=p/t.total*100;rated++;}}
    if(f!==null){monthFut=(monthFut||0)+f;if(t.total>0)futRate+=f/t.total*100;else futRated=false;}
    if(finite(m.interest)!==null){interest+=Number(m.interest);hasInterest=true;}
  }
  const rest=finite(year?.futures), fut=monthFut===null&&rest===null?null:(monthFut||0)+(rest||0);
  const yearly=(months||fut!==null)&&rated===months&&futRated&&(rest===null||last?.total>0)?rate+futRate+(rest!==null?rest/last.total*100:0):null;
  const annual=months&&rated===months?rate*12/months:null;
  return {pnl:pnl+(fut||0), monthPnl:pnl, futures:fut, futuresYear:rest, months, rate:yearly, rateNoLoan:yearly,
    annual, annualNoLoan:annual, interest:hasInterest?interest:null, last};
}
// 연평균 수익률: 계산 가능한 해의 연 수익률(선물옵션 포함) 산술평균. 빈 해·분모가 부족한 해는 개수에서도 제외한다.
function averageYearReturn(years){
  const rates=(years||[]).map(y=>yearSummary(y).rate).filter(r=>r!==null);
  return {rate:rates.length?rates.reduce((sum,r)=>sum+r,0)/rates.length:null,years:rates.length};
}

// ---------- 저축 계획 ----------
// 금액은 원, giving·growth·returnRate는 % 숫자(3 = 3%).
// 엑셀 '복리 저축 계산' 시트 규칙: 매달 저축총액 += 월급 − 기부(월급 × giving%) − 사용금액. 12월에는 투자수익(전년 12월 저축총액 × 연 수익률)에서
// 양수 수익의 기부(giving%)를 뺀 값을 더하고, 투자손실은 그대로 반영한다. 연 기부금은 월급 기부(salaryGiving) + 수익 기부(returnGiving), returns는 기부 후 투자수익이다.
// 사용금액은 spendingYear의 월 금액에서 해마다 growth%씩 늘고, 단계(stages: 그 나이부터 월급·증가율·수익률을 바꾸고
// spending이 있으면 그해 월 사용금액을 그 값으로)로 바꾼다. 나이는 해마다 1살(startYear에 startAge). 마지막 실제 기록(actual) 다음 달부터 endAge 해 12월까지 계산.
const ymNum = ym => { const m=/^(\d{4})-(\d{2})$/.exec(String(ym||"")); return m&&Number(m[2])>=1&&Number(m[2])<=12 ? Number(m[1])*12+Number(m[2])-1 : null; };
const ymText = n => `${Math.floor(n/12)}-${String(n%12+1).padStart(2,"0")}`;
// 월별 실제 저축총액 입력만 actual에 저장한다. 빈칸은 그 달 기록 삭제, 0은 유효한 기록. 기존 달의 다른 필드는 보존하며 잘못된 입력은 기록을 바꾸지 않는다.
function setSavingsActual(sv, ym, value){
  if(!Array.isArray(sv?.actual)||ymNum(ym)===null)return false;
  const text=String(value??"").trim(), total=parseAssetNumber(text), records=sv.actual.filter(a=>a.ym===ym), previous=records[records.length-1];
  if(text&&total===null)return false;
  if((!text&&!records.length)||(text&&records.length===1&&finite(previous.total)===total))return false;
  sv.actual=sv.actual.filter(a=>a.ym!==ym);
  if(text)sv.actual.push(previous?{...previous,total}:{ym,total});
  sv.actual.sort((a,b)=>String(a.ym).localeCompare(String(b.ym)));return true;
}
function savingsStage(sc, age){
  const p={salary:finite(sc.salary)||0, growth:finite(sc.growth)||0, returnRate:finite(sc.returnRate)||0};
  for(const s of [...(sc.stages||[])].filter(s=>finite(s.age)!==null&&Number(s.age)<=age).sort((a,b)=>a.age-b.age))
    for(const k of ["salary","growth","returnRate"])if(finite(s[k])!==null)p[k]=Number(s[k]);
  return p;
}
// simulateSavings의 월 사용금액 조회를 화면과 공유한다. 기준 연도·증가·단계 재설정의 순서와 소수 금액은 그대로 유지하고 기록에는 쓰지 않는다.
function savingsSpending(sc, startYear, startAge, lastYear){
  const age=y=>startAge+y-startYear;
  const resets=new Map((sc.stages||[]).filter(s=>finite(s.age)!==null&&finite(s.spending)!==null).map(s=>[Number(s.age),Number(s.spending)]));
  const spendYear0=finite(sc.spendingYear)??lastYear, spend=new Map();
  return y=>{ if(spend.has(y))return spend.get(y); let s=finite(sc.spending)||0;
    for(let k=spendYear0;k<=y;k++){ if(k>spendYear0)s*=1+savingsStage(sc,age(k)).growth/100; if(resets.has(age(k)))s=resets.get(age(k)); }
    spend.set(y,s); return s; };
}
// 실제 기록의 첫 달과 마지막 달 사이에 빠진 달(YYYY-MM)
function missingActual(sv){
  const ns=new Set((sv?.actual||[]).map(a=>finite(a.total)!==null?ymNum(a.ym):null).filter(n=>n!==null));
  if(!ns.size)return [];
  const out=[];for(let n=Math.min(...ns);n<=Math.max(...ns);n++)if(!ns.has(n))out.push(ymText(n));
  return out;
}
// 5억 달성은 기록이 있는 실제 월 또는 기존 계산을 마친 예상 월의 월말 잔액으로만 판단한다. 빠진 실제 월은 보간하지 않는다.
const savingsMilestone = sim => sim?.months.find(m=>m.total>=5e8)??null;
// 최단 기록은 시나리오 공통의 savings.milestoneRecord = {ym, age?}. 연월만 비교하고 기록 당시의 연도 나이는 보존한다.
function earlierSavingsRecord(...records){
  return records.filter(r=>ymNum(r?.ym)!==null).reduce((best,r)=>!best||ymNum(r.ym)<ymNum(best.ym)?r:best,null);
}
function simulateSavings(sv, sc){
  const actual=(sv?.actual||[]).map(a=>({n:ymNum(a.ym),total:finite(a.total)})).filter(a=>a.n!==null&&a.total!==null).sort((a,b)=>a.n-b.n);
  if(!actual.length||!sc)return null;
  const startYear=finite(sv.startYear)??Math.floor(actual[0].n/12), startAge=finite(sv.startAge)??0, age=y=>startAge+y-startYear;
  const endYear=startYear+Math.round((finite(sc.endAge)??startAge)-startAge), giving=(finite(sc.giving)||0)/100, last=actual[actual.length-1];
  const spending=savingsSpending(sc,startYear,startAge,Math.floor(last.n/12));
  const actualAt=n=>{let v=null;for(const a of actual){if(a.n>n)break;v=a.total;}return v;}, dec=new Map();
  const decBalance=y=>dec.has(y)?dec.get(y):actualAt(y*12+11);
  const years=new Map(), row=y=>{if(!years.has(y))years.set(y,{year:y,age:age(y),salary:0,giving:0,salaryGiving:0,returnGiving:0,spending:0,returns:0,end:null,actual:false});return years.get(y);};
  const months=actual.filter(a=>a.n<=endYear*12+11).map(a=>({ym:ymText(a.n),age:age(Math.floor(a.n/12)),total:a.total,actual:true}));
  for(const a of actual){const r=row(Math.floor(a.n/12));r.end=a.total;r.actual=true;r.endYm=ymText(a.n);}
  let bal=last.total;
  for(let n=last.n+1;n<=endYear*12+11;n++){
    const y=Math.floor(n/12), p=savingsStage(sc,age(y)), r=row(y), s=spending(y);
    bal+=p.salary-p.salary*giving-s;
    r.salary+=p.salary;r.salaryGiving+=p.salary*giving;r.giving+=p.salary*giving;r.spending+=s;
    if(n%12===11){const base=decBalance(y-1), ret=base>0?base*p.returnRate/100:0, donated=Math.max(0,ret)*giving;bal+=ret-donated;r.returns+=ret-donated;r.returnGiving+=donated;r.giving+=donated;dec.set(y,bal);}
    r.end=bal;r.endYm=ymText(n);r.actual=false;
    months.push({ym:r.endYm,age:r.age,total:bal,actual:false});
  }
  const rows=[...years.values()].filter(r=>r.year<=endYear).sort((a,b)=>a.year-b.year);
  return {rows, months, last:{ym:ymText(last.n),total:last.total}, endYear, at:a=>rows.find(r=>r.age===a)?.end??null};
}

// 할부의 순자산 참조는 저축 계획의 마지막 실제 기록(savings.actual의 total, 원)만 읽는다.
// simulateSavings의 last와 같이 유효한 연월·금액 중 가장 늦은 달을 고르고, 같은 달은 뒤의 기록을 쓴다.
// 직접 저장한 0원과 기준 연월도 유지한다. 저축 예상액·시나리오·자산 배분·월별 손익은 합산하지 않고 원본을 바꾸지 않는다.
function installmentAssetReference(doc){
  let latestMonth=null,amount=null;
  for(const record of Array.isArray(doc?.savings?.actual)?doc.savings.actual:[]){
    const month=ymNum(record?.ym),total=finite(record?.total);
    if(month!==null&&total!==null&&(latestMonth===null||month>=latestMonth)){latestMonth=month;amount=total;}
  }
  return {amount,ym:latestMonth===null?null:ymText(latestMonth).padStart(7,"0")};
}

// ---------- 카드 결제·무이자 할부 ----------
const INSTALLMENT_TERMS = [{id:"once",name:"일시불",months:1},{id:"m12",name:"12개월 무이자",months:12},{id:"m36",name:"36개월 무이자",months:36}];
// m12·m36은 기존 비교안의 저장 키다. 개월수만 methods[id].months로 바꾸고, 없는 필드는 저장하지 않은 채 기존 기간을 쓴다.
const INSTALLMENT_MAX_MONTHS = 120;
function installmentTerms(settings){
  return INSTALLMENT_TERMS.map(term=>{
    if(term.id==="once")return term;
    const saved=settings?.methods?.[term.id]?.months, months=saved===undefined?term.months:finite(saved);
    return {...term,months,name:Number.isSafeInteger(months)&&months>=1&&months<=INSTALLMENT_MAX_MONTHS?`${months}개월 무이자`:term.name};
  });
}
// 같은 구매대금(price, 원)을 처음부터 보유하고, 첫 납부는 firstMonth(0=지금, 1=한 달 뒤)부터 매달 한다.
// discountEnabled=true일 때만 할인율·할인한도(둘 다 기본 0)를 읽는다. 할인=min(구매금액, 한도, 구매금액×할인율의 원 반올림).
// 할인 후 원금을 개월 수로 나눠 원 미만을 버리고 마지막 납부에 나머지를 더한다. 할인은 결제 때 원금에서 빼고,
// 옛 fee는 첫 납부 때 한 번 반영한다. 옛 fixedDiscount·적립·캐시백 필드는 검증·계산에서 제외하되 저장 원본에 보존한다.
// 직접 입력한 기간은 1~120개월 정수. 선택 startYm은 결제 연월이며 납부 연월=결제 연월+경과 개월(정수 월 연산)이다.
// 월 수익률=(1+세후 연 수익률/100)^(1/12)-1. 매월 전월 말의 남은 양수 잔액에 수익을 붙인 뒤 납부한다.
// 부족한 잔액에는 수익·대출이자를 붙이지 않으며 minBalance로 알린다. 할부 종료 후에도 남은 이득만 같은 수익률로 운용한다.
// benefit=보유잔액-남은 납부원금(채무를 이득으로 세지 않음). 같은 3·5·10년 시점에서 비교하며 납부가 남아도 원금을 제외한다.
// 총 이득=할인-옛 비용+보유자금 수익. 일시불 대비는 같은 월의 benefit 차이이며 각 안의 종료 비교도 그 안의 마지막 납부 월이다.
// 순자산 N은 직접 입력 settings.netAssets(원 단위 정수)가 우선하고 없으면 읽기 전용 referenceNetAssets다. 구매대금은 N에 이미
// 포함되어 있으므로 예상 순자산=N-price+benefit. 전체 자산·저축·새 납입에는 수익률을 적용하지 않는다. 입력·기록은 바꾸지 않는다.
function calculateInstallments(settings, referenceNetAssets=null){
  const price=finite(settings?.price), annualRate=settings?.returnRate===undefined||settings?.returnRate===null||settings?.returnRate===""?0:finite(settings.returnRate);
  if(!Number.isSafeInteger(price)||price<=0||price>1e12||annualRate===null||annualRate<-100||annualRate>100)return null;
  const customNetAssets=settings?.netAssets, hasCustom=customNetAssets!==undefined&&customNetAssets!==null&&customNetAssets!=="";
  const netAssets=hasCustom?finite(customNetAssets):referenceNetAssets===null||referenceNetAssets===undefined?null:finite(referenceNetAssets);
  if((hasCustom&&(!Number.isSafeInteger(netAssets)||Math.abs(netAssets)>1e15))||(!hasCustom&&referenceNetAssets!==null&&referenceNetAssets!==undefined&&(netAssets===null||Math.abs(netAssets)>1e15)))return null;
  const years=[3,5,10].includes(settings?.years)?settings.years:3, firstMonth=settings?.firstMonth===0?0:1;
  const terms=installmentTerms(settings), start=settings?.startYm, startMonth=start===undefined||start===null||start===""?null:ymNum(start);
  if(terms.some(t=>!Number.isSafeInteger(t.months)||t.months<1||t.months>INSTALLMENT_MAX_MONTHS)||(start!==undefined&&start!==null&&start!==""&&(startMonth===null||startMonth<12||startMonth>ymNum("9989-12"))))return null;
  const monthlyRate=Math.expm1(Math.log1p(annualRate/100)/12), horizon=years*12;
  const value=(v,max=1e12)=>{const n=v===undefined||v===null||v===""?0:finite(v);return n!==null&&n>=0&&n<=max?n:null;};
  const plans=[];
  for(const term of terms){
    const p=settings?.methods?.[term.id]||{}, fee=value(p.fee);
    const discountRate=p.discountEnabled===true?value(p.discountRate,100):0, discountCap=p.discountEnabled===true?value(p.discountCap):0;
    if(fee===null||discountRate===null||!Number.isSafeInteger(discountCap))return null;
    const discount=Math.min(price,discountCap,Math.round(price*discountRate/100)), principal=price-discount;
    const extraCost=Math.round(fee), monthly=Math.floor(principal/term.months), lastPayment=principal-monthly*(term.months-1), endMonth=firstMonth+term.months-1;
    let balance=price, earned=0, paid=0, minBalance=price;
    const rows=[];
    for(let month=0;month<=120;month++){
      const interest=month&&balance>0?balance*monthlyRate:0;
      balance+=interest;earned+=interest;
      const payment=month>=firstMonth&&month<=endMonth?(month===endMonth?lastPayment:monthly):0;
      const cost=month===firstMonth?extraCost:0;
      paid+=payment;balance-=cost+payment;minBalance=Math.min(minBalance,balance);
      const remaining=Math.max(0,principal-paid);
      const benefit=balance-remaining;
      rows.push({month,...(startMonth!==null?{ym:ymText(startMonth+month).padStart(7,"0")}:{}),payment,discount:month===0?discount:0,fee:cost,interest,earned,balance,remaining,benefit,netAssets:netAssets===null?null:netAssets-price+benefit});
    }
    plans.push({...term,discount,fee:extraCost,principal,monthly,lastPayment,endMonth,cardBenefit:discount-extraCost,rows,minBalance});
  }
  const baseline=plans[0];
  for(const p of plans){
    for(const row of p.rows){
      const once=baseline.rows[row.month];
      row.advantage=row.benefit-once.benefit;
      row.assetRate=once.netAssets>0?row.advantage/once.netAssets*100:null;
      row.purchaseRate=row.advantage/price*100;
    }
    const payoff=p.rows[p.endMonth], oncePayoff=baseline.rows[p.endMonth];
    p.payoff={month:p.endMonth,...(payoff.ym?{ym:payoff.ym}:{}),netAssets:payoff.netAssets,onceNetAssets:oncePayoff.netAssets,advantage:payoff.advantage,assetRate:payoff.assetRate,purchaseRate:payoff.purchaseRate,
      holdingDifference:payoff.earned-oncePayoff.earned,discountDifference:p.discount-baseline.discount,costDifference:p.fee-baseline.fee};
    const end=p.rows[horizon];p.totalBenefit=end.benefit;p.holdingReturn=end.earned;
    p.advantage=end.benefit-baseline.rows[horizon].benefit;
    p.cardDifference=p.cardBenefit-baseline.cardBenefit;p.holdingDifference=end.earned-baseline.rows[horizon].earned;
  }
  const max=Math.max(...plans.map(p=>p.totalBenefit)), winners=plans.filter(p=>max-p.totalBenefit<.5), best=winners[0];
  const tied=plans.every(p=>Math.abs(p.totalBenefit-plans[0].totalBenefit)<.5);
  return {price,annualRate,monthlyRate,netAssets,years,firstMonth,startYm:startMonth===null?null:ymText(startMonth).padStart(7,"0"),horizon,plans,best,winners,tied};
}

// ---------- 기록 파일·기기 간 병합 ----------
// 기록 파일(etf-planner-assets.json) = {version:1, allocation, ledger, savings, installments?}. 구역마다 savedAt(바꿀 때만 갱신)을 둔다.
function cleanAssets(doc){
  if(!doc||typeof doc!=="object"||Array.isArray(doc)||(doc.version!==undefined&&doc.version!==1))return null;
  const out={version:1};
  for(const s of ASSET_SECTIONS){const v=doc[s];if(v&&typeof v==="object"&&!Array.isArray(v))out[s]=v;}
  if(out.allocation){const a=out.allocation;a.classes=Array.isArray(a.classes)?a.classes:[];a.groups=Array.isArray(a.groups)?a.groups:[];a.cash=Array.isArray(a.cash)?a.cash:[];a.groups.forEach(g=>{g.items=Array.isArray(g.items)?g.items:[];});}
  if(out.ledger){out.ledger.years=Array.isArray(out.ledger.years)?out.ledger.years:[];out.ledger.years.forEach(y=>{y.accounts=Array.isArray(y.accounts)?y.accounts:[];y.months=Array.isArray(y.months)?y.months:[];});}
  if(out.savings){const v=out.savings;v.actual=Array.isArray(v.actual)?v.actual:[];v.scenarios=Array.isArray(v.scenarios)?v.scenarios:[];}
  return out;
}
const assetsBlank = doc => !doc||ASSET_SECTIONS.every(s=>!doc[s]);
// 기기 간 3방향 병합(자산 mergeAssets·플래너 sync.js 공용): 지난 동기화 기록(base)과 비교해 이 기기(local)·저장소(remote)가 바꾼 칸을 모두 반영한다.
// 객체는 키마다(savedAt은 늦은 값), id(없으면 ym·year·m)가 모두 있고 겹치지 않는 목록은 항목마다 합치며, 그 밖의 목록·값은 한 칸으로 본다.
// 한쪽만 바꾼 칸은 그 값, 한쪽이 지우고 다른 쪽이 고친 칸은 고친 쪽, 양쪽이 다르게 바꾼 칸은 preferLocal 쪽을 쓴다. base에 없던 칸은 양쪽에서 새로 만든 키·항목을 모두 남긴다.
// 목록 순서는 preferLocal 쪽(순서를 바꾼 쪽이 한쪽뿐이면 그쪽)을 따르고 다른 쪽에만 있는 항목은 앞 항목 뒤에 둔다.
// conflicts는 겹친(지움·고침 포함) 칸의 경로(키·항목 키 목록)다. 원본은 바꾸지 않는다.
function mergeThreeWay(local, remote, base, preferLocal=true){
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null), plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v), conflicts=[];
  const listKey=lists=>["id","ym","year","m"].find(k=>lists.every(a=>a.every(x=>plain(x)&&["string","number"].includes(typeof x[k]))&&new Set(a.map(x=>x[k])).size===a.length));
  const merge=(l,r,b,path)=>{
    if(same(l,r))return l;
    if(b!==undefined){if(same(l,b))return r;if(same(r,b))return l;}
    if(l===undefined||r===undefined){if(b!==undefined)conflicts.push(path);return l===undefined?r:l;} // 지운 쪽보다 고친 쪽을 남긴다
    if(plain(l)&&plain(r)&&(b===undefined||plain(b))){
      const out={};
      for(const k of new Set([...Object.keys(l),...Object.keys(r)])){const v=k==="savedAt"?(String(l[k]||"")>=String(r[k]||"")?l[k]:r[k]):merge(l[k],r[k],b?.[k],[...path,k]);if(v!==undefined)out[k]=v;}
      return out;
    }
    const was=b===undefined?[]:b,key=Array.isArray(l)&&Array.isArray(r)&&Array.isArray(was)&&listKey([l,r,was]);
    if(!key){conflicts.push(path);return preferLocal?l:r;}
    const map=a=>new Map(a.map(x=>[x[key],x])),lm=map(l),rm=map(r),bm=map(was);
    const moved=a=>JSON.stringify(a.map(x=>x[key]).filter(k=>bm.has(k)))!==JSON.stringify(was.map(x=>x[key]).filter(k=>a.some(x=>x[key]===k)));
    const first=preferLocal?(moved(r)&&!moved(l)?r:l):(moved(l)&&!moved(r)?l:r),order=first.map(x=>x[key]);
    (first===l?r:l).forEach((x,i,a)=>{if(order.includes(x[key]))return;const at=i?order.indexOf(a[i-1][key])+1:0;order.splice(at>0||!i?at:order.length,0,x[key]);});
    return order.map(k=>merge(lm.get(k),rm.get(k),bm.get(k),[...path,k])).filter(v=>v!==undefined);
  };
  return {value:merge(local,remote,base,[]),conflicts};
}
// 자산 기록 구역마다: 한쪽에만 있는 구역은 그쪽, 그 밖에는 mergeThreeWay(겹친 칸은 구역 savedAt이 늦은 쪽, 같으면 이 기기).
// 칸이 겹친 구역은 다른 쪽 기록 전체를 lost로 돌려줘 이 기기에 보관하고, conflicts는 겹친 칸 수다.
// 저축 최단 기록만은 양쪽·지난 동기화의 가장 빠른 연월을 보존해, 가정 변경이나 옛 기기의 저장으로 늦어지거나 지워지지 않게 한다.
function mergeAssets(local, remote, base){
  const doc={version:1}, lost=[];
  let conflicts=0;
  for(const s of ASSET_SECTIONS){
    const L=local?.[s], R=remote?.[s], B=base?.[s], newer=String(L?.savedAt||"")>=String(R?.savedAt||"");
    const m=L&&R?mergeThreeWay(L,R,B,newer):null, pick=m?m.value:L||R;
    if(m?.conflicts.length){conflicts+=m.conflicts.length;lost.push({section:s,data:newer?R:L});}
    if(pick){const record=s==="savings"?earlierSavingsRecord(L?.milestoneRecord,R?.milestoneRecord,B?.milestoneRecord):null;doc[s]=record?{...pick,milestoneRecord:record}:pick;}
  }
  return {doc, lost, conflicts};
}
