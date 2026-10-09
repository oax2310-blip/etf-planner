// 자산 현황·플래너 분할매수의 계산, 자산 배분 연동, 구역별 병합. 계산 기준은 각 함수 주석, 공통 작업 규칙은 AGENTS.md.
// tests/assets.test.cjs·시세 수집도 DOM 없이 실행하므로 함수 밖에서 화면을 건드리지 않는다.
const ASSET_SECTIONS = ["allocation","ledger","savings"]; // 기록 파일의 세 구역. 기기 간 병합은 구역마다 따로(savedAt)
const ASSET_REGIONS = ["미국","국내","해외","현금","외화·원자재","기타"]; // 큰 분류 지역 순서(목록에 없는 지역은 뒤에)
const finite = v => v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v)) ? Number(v) : null;
const plus = v => { const n=finite(v); return n!==null&&n>0 ? n : null; };

// ---------- 시세 ----------
// prices = {updatedAt, stocks:{종목 코드:{kind, asOf, close, stale}}, fx:{close, asOf}} (assets-store.js가 시세 파일에서 필요한 값만 남긴 것)
function assetQuote(prices, ticker){
  const key=String(ticker||"").trim().toUpperCase(), e=key&&prices?.stocks?.[key];
  if(!e||!(Number(e.close)>0)||!/^\d{4}-\d{2}-\d{2}$/.test(String(e.asOf)))return null;
  return {...e, close:Number(e.close), currency:e.kind==="해외"||e.kind==="코인"?"USD":"KRW"};
}
// 원/달러: 시세 파일의 현물 환율, 없으면 자산 배분에 직접 넣은 환율(cashFx)
const assetFx = (prices, alloc) => plus(prices?.fx?.close) || plus(alloc?.cashFx);
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
// ① 이동평균선 돌파(lines가 있음): lines = {names:[단계 이름…], end?:목표 가격, budget:총 매수 금액(만원), target?:종목 목표와 다르게 넣은 목표 비중}. 목표 가격을 비우면 names의 마지막 선까지 매수한다.
//    회차 가격은 시세 파일의 이동평균을 따라 움직이고(purchaseLineLevels), 체결은 buys[회차 키] = {plannedShares:원래 계획 수량, plannedActual:그 수량의 예정액, shares:누적 체결 수량, actual:체결 금액(만원), price:첫 체결 때 표시 가격, next?}.
//    부분 체결 회차는 원래 수량·가격과 잔량 예산을 고정한다. plannedShares 없는 옛 체결은 완료로 읽고, 처음 수정할 때만 계획 수량을 저장한다.
//    수량은 purchaseFill로 회차 예산 안에서 내림하고, 표시한 수량을 그대로 저장·반영한다. 체결 금액만 고쳐도 수량은 바뀌지 않는다. 옛 기록은 읽을 때 새 필드를 채우지 않는다.
// ② 직접 입력: stages = [{id, price?, shares?, plannedShares?, date?, condition?, amount(만원), done?, partial?, actual?}] — 첫 체결 때 plannedShares를 고정하고 shares는 누적 체결, 잔량이 있으면 partial=true(done 없음).
// ③ 매수대기: wait = {line:원하는 이동평균선 이름}. 예산·체결 회차 없이 현재가 ≤ 그때의 이동평균선이면 도달하며 보유량을 바꾸지 않는다.
//    알림은 notify.stages(개별 예외는 notify.keys.wait). 선 값이 바뀌어도 같은 알림 이력을 쓰고, 선택한 선을 바꾸면 이력을 새로 시작한다.
// 이동평균선 돌파 단계(재매수 기본 단계와 같음): 시선(60분봉) 'N선', 일선 'N일선', 주선 'N주선', 월선 'N개월선'(각 25~150). 시세 파일 ma에 같은 이름으로 들어 있다
// (데이터 저장소 kis_prices.py가 lines.names로 이 종목의 일봉·60분봉 이동평균을 계산 — purchase_line_plans).
const PURCHASE_LINES = MA_LINES;
const purchaseLineName = movingLineName;
const purchaseLineNames = lines => [...new Set((Array.isArray(lines?.names)?lines.names:PURCHASE_LINES).map(purchaseLineName).filter(Boolean))];
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
// 목표 가격이 없으면 선택한 마지막 선의 도달 회차까지 만든다. 마지막 선 시세가 없으면 새 회차를 만들지 않고 기다리며, 그 밖의 값이 없는 단계는 건너뛴다.
// 회차 키: '25선:0'(단계 이름:회차 0~2), 목표가는 'end'. 상승 돌파라 현재가 ≥ 회차 가격이면 도달.
function purchaseLineLevels(lines, entry){
  const end=plus(lines?.end), names=purchaseLineNames(lines);
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
// shares·plannedShares는 실제 ETF 주수, price는 기준 가격. tradeTicker·tradePrice·tradeCurrency는 첫 체결 때 고정해 추가 체결·취소도 같은 ETF 단위를 쓴다.
function purchaseTrackingFill(row, it, prices, fx, currency="USD"){
  if(!tracksETF(it))return purchaseFill(row,currency,fx,linkStep(it));
  const q=assetTradeQuote(prices,it);if(!q)return null;
  let amount=finite(row?.amount);
  if(amount===null){const shares=plus(row?.shares), price=plus(row?.price), rate=currency==="USD"?plus(fx):1;if(!shares||!price||!rate)return null;amount=shares*price*rate/1e4;}
  const fill=purchaseFill({amount,price:q.close},q.currency,fx);if(!fill)return null;
  const raw=plus(row?.price), price=raw?currency==="USD"?Math.round(raw*100)/100:Math.round(raw):null;
  return {...fill,price,budget:amount,tradeTicker:assetTradeTicker(it),tradePrice:fill.price,tradeCurrency:q.currency};
}
// 회차 목록(화면·합계·알림 공통): 체결 기록(완료·부분 체결) + 아직 안 산 회차(지금 이동평균 기준).
// 부분 체결의 잔량 예산을 먼저 남겨 두고, 나머지 예산만 새 회차에 나눈다. 시세·단계·예산이 바뀌어도 부분 체결 잔량은 사라지지 않는다.
// 각 회차에 최소 1주(실제 추종 ETF도 같은 단위)를 남길 수 있는 최대 회차 수를 고른다. 부족하면 시작~종료 전체 구간에서 회차 간격을 고르게 넓힌다.
// 체결한 회차도 간격 계산에 포함해 건너뛴 앞 회차를 다시 만들지 않는다. 금액은 최소 매수액을 먼저 확보하고 나머지를 가능한 한 같게 나눈다.
// trade는 화면·알림이 쓰는 실제 종목·시세·환율·계획 통화. 필요한 시세나 환율이 없으면 기존 균등 예산을 유지하며 수량을 추정하지 않는다.
function purchaseLineRows(plan, entry, trade={}){
  const lines=plan?.lines, buys=purchaseBuys(plan), names=purchaseLineNames(lines);
  const parse=key=>{if(key==="end")return {line:"목표가",t:0};const m=/^(.+):([0-2])$/.exec(key);return m&&purchaseLineName(m[1])?{line:m[1],t:Number(m[2])}:null;};
  const records=Object.entries(buys).map(([key,b])=>{
    const at=b&&typeof b==="object"?parse(key):null;if(!at)return null;
    const planned=plus(b.plannedShares), shares=finite(b.shares), remaining=planned?Number(Math.max(0,planned-(shares||0)).toFixed(8)):0;
    return {key,...at,price:plus(b.price),...(shares!==null?{shares}:{}),done:!remaining,actual:Math.max(0,finite(b.actual)||0),
      ...(planned?{plannedShares:planned,remainingShares:remaining,next:b.next??null,amount:remaining*(plus(b.plannedActual)??plus(b.actual)??0)/(planned||1)}:{})};
  }).filter(Boolean);
  const budget=Math.max(0,finite(lines?.budget)||0), spent=records.reduce((s,r)=>s+r.actual,0), reserved=records.filter(r=>!r.done).reduce((s,r)=>s+r.amount,0), left=Math.max(0,budget-spent-reserved);
  const levels=purchaseLineLevels(lines,entry), currency=trade.currency||plan?.currency||(["해외","코인"].includes(entry?.kind)?"USD":"KRW"), step=trade.item?linkStep(trade.item):1;
  let open=left>0?levels.filter(x=>!buys[x.key]):[];
  const amounts=new Map(), costs=new Map(open.map(r=>{
    const fill=trade.item?purchaseTrackingFill({...r,amount:left},trade.item,trade.prices,trade.fx,currency):purchaseFill({...r,amount:left},currency,trade.fx,step);
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
    const rows=purchaseLineRows(plan,entry,trade), actual=rows.reduce((s,r)=>s+(r.actual||0),0), budget=Math.max(0,finite(plan.lines.budget)||0);
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
// 종목 코드 → 시세 종류(데이터 저장소 kis_prices.py classify와 같은 형식): BTC-USD는 코인, 국내 6자리(A·Q 접두 포함)는 국내, 미국 심볼은 해외, 그 밖은 null
function purchaseQuoteKind(ticker){
  const t=String(ticker||"").trim().toUpperCase();
  return t==="BTC-USD"?"코인":/^[AQ]\d{6}$|^\d[0-9A-Z]{5}$/.test(t)?"국내":/^[A-Z][A-Z0-9.\-/]{0,11}$/.test(t)?"해외":null;
}
// 분할매수 회차 휴대폰 알림 규칙(js/trade-alerts.js buildTradeAlertRules와 같은 모양): 종목 코드가 있고 가격이 있는 미완료 회차 중 알림을 켠 것.
// 계획 통화(달러 계획만 currency 저장, 없으면 시세 통화 → 원화)가 종목 코드 시장 통화와 다르면 보내지 않는다.
// 이동평균선 돌파 회차는 지금 이동평균 가격으로(이력은 단계 이름·회차로 이어져 이평선이 움직여도 다시 알리지 않음), 직접 입력 회차는 가격·방향을 바꾸면 이력이 새로.
// 데이터 저장소의 compile_trade_alerts.cjs가 etf-planner-assets.json에 이 함수를 그대로 실행하고, kis_prices.py가 이동평균선 돌파·매수대기 종목(purchase_line_plans)은 선택한 선의 전체 시세·60분봉을,
// 직접 입력 알림 종목(purchase_alert_tickers)은 장중 실행마다 종가를 받는다(함수 이름·켜짐 판정·단계 이름을 바꾸면 그쪽도 같이).
// 라벨 '매수대기 25개월선'·'분할매수 N차'·'분할매수 25선 1차'·'분할매수 목표가'는 그 저장소 ma_alerts.py TRADE_LABEL_RE와 같은 형식.
function purchaseAlertRules(assets, prices){
  const rules=[];
  for(const g of Array.isArray(assets?.allocation?.groups)?assets.allocation.groups:[])for(const it of Array.isArray(g?.items)?g.items:[]){
    const plan=it?.buyPlan, ticker=String(it?.ticker||"").trim().toUpperCase(), kind=purchaseQuoteKind(ticker);
    if(!plan||!kind||!it.id||(plan.currency||assetQuote(prices,ticker)?.currency||"KRW")!==(kind==="국내"?"KRW":"USD"))continue;
    const add=(key,label,price,condition,revision)=>rules.push({id:`trade:buy:${it.id}:${key}`,kind:"trade",ticker,label,targetPrice:price,condition,quoteGroup:"stocks",quoteKey:ticker,quoteKind:kind,enabled:true,revision:JSON.stringify(revision)});
    if(plan.wait){
      const entry=prices?.stocks?.[ticker], info=purchaseWaitInfo(plan,entry?.kind===kind?entry:null);
      if(["국내","해외"].includes(kind)&&info.price&&purchaseAlertOn(plan,{key:"wait"}))
        add("wait",`매수대기 ${info.line}`,info.price,"down",["wait",info.line,"down"]);
      continue;
    }
    if(plan.lines){
      const entry=prices?.stocks?.[ticker];
      const trade={item:it,prices,fx:assetFx(prices,assets?.allocation),currency:plan.currency||assetQuote(prices,ticker)?.currency||"KRW"};
      for(const r of purchaseLineRows(plan,entry&&entry.kind===kind?entry:null,trade))if(!r.done&&r.price&&purchaseAlertOn(plan,r)&&(r.remainingShares>0||purchaseTrackingFill(r,it,prices,trade.fx,trade.currency)?.shares!==0))
        add(r.key,`분할매수 ${purchaseLineLabel(r)}`,r.price,"up",r.key==="end"?["end",r.price]:[r.line,r.t,r.next]);
      continue;
    }
    const condition=purchaseDirection(plan);
    (Array.isArray(plan.stages)?plan.stages:[]).forEach((s,i)=>{
      const price=plus(s?.price);
      if(price&&!s.done&&s.id&&purchaseAlertOn(plan,s))add(s.id,`분할매수 ${i+1}차`,price,condition,[price,condition]);
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

// ---------- 플래너 체결 → 자산 배분 연동 (화면·계좌 고르는 창은 플래너 js/alloc-link.js) ----------
// 분할매도 회차·재매수 손절·재매수 회차·분할매수 회차를 체크하면 종목 코드가 같은 자산 배분 종목(계좌)의 보유량을 줄이거나 늘리고, 체크를 풀면 되돌린다.
// 연결: 종목 코드가 같은 종목(대문자, 국내 코드 'A' 접두 무시, '비트코인' = BTC-USD). 분할매수는 계획이 붙은 종목도(코드가 없어도) 연결.
// 반영 기록 allocation.trades = {출처 키: {label, at, qty, price, value, items:[{id, shares?, amount?, fresh?}]}} — 체크한 동안만 두고 풀면 지운다(처음 반영할 때만 만듦).
//   items의 shares·amount는 그 종목에 실제로 더한 양(매도는 음수, 0 아래로 내려가지 않게 자른 값)이라 되돌리면 원래 값. fresh는 보유 수량 칸을 새로 만든 것(되돌려 0이면 칸을 지움).
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
// 계획 화면의 '자산 배분' 줄과 보유량 가져오기: 연결 종목 합계 평가액·비중, 목표(연결 종목 목표의 합 — 없으면 연결 종목이 한 그룹의 전부일 때 그 그룹 목표),
// 목표와의 차이(gap > 0 목표까지 더 살 금액, < 0 목표 초과), 보유 수량 합(모든 연결 종목에 수량이 있고 실제 거래 티커가 기준 티커와 같을 때만).
function linkSummary(alloc, prices, ticker, ownId=null){
  const list=linkedItems(alloc,ticker,ownId);if(!list.length)return null;
  const s=allocationSummary(alloc,prices), rows=list.map(x=>({...x,value:s.items.get(x.it.id)?.value||0})), value=rows.reduce((n,r)=>n+r.value,0);
  const own=list.map(x=>finite(x.it.target)).filter(v=>v!==null), groups=[...new Set(list.map(x=>x.g))];
  let target=own.length?Math.round(own.reduce((a,b)=>a+b,0)*1e8)/1e8:null, scope=own.length?"item":null;
  if(target===null&&groups.length===1&&groups[0].items.every(it=>list.some(x=>x.it===it))){const t=s.targets.groups.get(groups[0].id)?.target;if(t!=null){target=t;scope="group";}}
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
    if(finite(e.shares)){bumpField(it,"shares",-e.shares,linkStep(it));if(e.fresh&&!(finite(it.shares)>0))delete it.shares;}
    if(finite(e.amount))bumpField(it,"amount",-e.amount,0.01);
  }
  delete alloc.trades[key];if(!Object.keys(alloc.trades).length)delete alloc.trades;
  return rec;
}
// 체크 뒤 체결 크기를 고쳤을 때(trade = 새 {qty, price, value}): 수량 종목은 수량 비율, 금액 종목은 금액 비율(금액이 없으면 수량 × 가격, 그다음 수량 비율)로
// 반영한 양을 다시 맞춘다. 수량은 같은 최소 단위·방향의 계좌별 합계를 먼저 반올림하고, 남는 최소 단위는 소수부가 큰 계좌부터 배분한다(4주+4주를 7주로 고쳐도 합계 7주).
// 비율을 알 수 없거나(0·빈 값) 그대로면 바꾸지 않는다. 바뀐 기록(없으면 null).
function rescaleTrade(alloc, key, trade){
  const rec=alloc?.trades?.[key];if(!rec)return null;
  const q=plus(trade?.qty), p=plus(trade?.price), v=plus(trade?.value), ratio=(a,b)=>a&&b?a/b:null;
  const rq=ratio(q,rec.qty), rpq=ratio(q&&p?q*p:null,rec.qty&&rec.price?rec.qty*rec.price:null), rv=ratio(v,rec.value);
  const fShares=rq??rv??rpq, fAmount=rv??rpq??rq;
  const quantities=new Map(), groups=new Map();
  for(const e of Array.isArray(rec.items)?rec.items:[]){
    const it=allocItemById(alloc,e?.id);if(!it||!finite(e.shares))continue;
    const factor=e.converted?fAmount:fShares;if(!factor||factor===1)continue;
    const step=linkStep(it), sign=e.shares<0?-1:1, key=`${step}:${sign}:${!!e.converted}`, rows=groups.get(key)||[];
    const units=Math.round(Math.abs(e.shares)/step), scaled=units*factor;
    rows.push({e,step,sign,units,factor,base:Math.floor(scaled),fraction:scaled-Math.floor(scaled)});groups.set(key,rows);
  }
  for(const rows of groups.values()){
    const total=rows.reduce((n,r)=>n+r.units,0)*rows[0].factor,extra=(rows[0].e.converted?Math.floor(total+1e-9):Math.round(total))-rows.reduce((n,r)=>n+r.base,0);
    [...rows].sort((a,b)=>b.fraction-a.fraction).slice(0,extra).forEach(r=>r.base++);
    rows.forEach(r=>quantities.set(r.e,linkRound(r.sign*r.base*r.step,r.step)));
  }
  let changed=false;
  for(const e of Array.isArray(rec.items)?rec.items:[]){
    const it=allocItemById(alloc,e?.id);if(!it)continue;
    const factor=e.converted?fAmount:fShares;
    if(finite(e.shares)&&factor&&factor!==1){const step=linkStep(it), add=bumpField(it,"shares",(quantities.get(e)??linkRound(e.shares*factor,step))-e.shares,step);if(add){e.shares=linkRound(e.shares+add,step);changed=true;}}
    if(finite(e.amount)&&fAmount&&fAmount!==1){const add=bumpField(it,"amount",Math.round(e.amount*fAmount*100)/100-e.amount,0.01);if(add){e.amount=linkRound(e.amount+add,0.01);changed=true;}}
  }
  rec.qty=q??rec.qty;rec.price=p??rec.price;rec.value=v??rec.value;
  return changed?rec:null;
}

// ---------- 월별 손익 ----------
// 달 총자산(원): 계좌 잔액이 있으면 합계(대출 계좌 포함), 없으면 직접 넣은 total. noLoan은 대출 계좌를 뺀 합계(대출 계좌가 없으면 null).
function monthTotals(year, m){
  const bal=Array.isArray(m?.balances)?m.balances:[], acc=year?.accounts||[];
  if(!bal.some(v=>finite(v)!==null))return {total:finite(m?.total), noLoan:null};
  let total=0,free=0;
  bal.forEach((v,i)=>{const n=finite(v)||0;total+=n;if(!acc[i]?.loan)free+=n;});
  return {total, noLoan:acc.some(a=>a?.loan)?free:null};
}
// 연 요약: 실현손익 합계(선물옵션 포함), 월 수익률 합(엑셀 '연환산 %'와 같은 방식: 달마다 실현손익 ÷ 그 달 총자산, 선물옵션은 마지막 달 총자산으로),
// 대출 계좌가 있는 해는 같은 방식의 대출 제외 수익률(엑셀 '대출 미 포함' 줄, rateNoLoan — 없으면 null),
// 연환산(월 수익률 합 × 12 ÷ 실현손익을 넣은 달 수, 선물옵션 제외), 마지막 달 총자산.
function yearSummary(year){
  let pnl=0,rate=0,rateFree=0,months=0,interest=0,hasInterest=false,last=null;
  for(const m of [...(year?.months||[])].sort((a,b)=>a.m-b.m)){
    const t=monthTotals(year,m), p=finite(m.pnl);
    if(t.total>0)last={m:m.m,...t};
    if(p!==null){pnl+=p;months++;if(t.total>0)rate+=p/t.total*100;if(t.noLoan>0)rateFree+=p/t.noLoan*100;}
    if(finite(m.interest)!==null){interest+=Number(m.interest);hasInterest=true;}
  }
  const fut=finite(year?.futures), futRate=fut!==null&&last?.total>0?fut/last.total*100:0, loan=(year?.accounts||[]).some(a=>a?.loan);
  return {pnl:pnl+(fut||0), monthPnl:pnl, futures:fut, months, rate:rate+futRate, rateNoLoan:loan?rateFree+(fut!==null&&last?.noLoan>0?fut/last.noLoan*100:0):null,
    annual:months?rate*12/months:null, interest:hasInterest?interest:null, last};
}

// ---------- 저축 계획 ----------
// 금액은 원, giving·growth·returnRate는 % 숫자(3 = 3%).
// 엑셀 '복리 저축 계산' 시트 규칙: 매달 저축총액 += 월급 − 기부(월급 × giving%) − 사용금액 − 할부. 12월에는 투자수익(전년 12월 저축총액 × 연 수익률)에서
// 수익 기부(giving%)를 뺀 값을 더한다. 사용금액은 spendingYear의 월 금액에서 해마다 growth%씩 늘고, 단계(stages: 그 나이부터 월급·증가율·수익률을 바꾸고
// spending이 있으면 그해 월 사용금액을 그 값으로)로 바꾼다. 나이는 해마다 1살(startYear에 startAge). 마지막 실제 기록(actual) 다음 달부터 endAge 해 12월까지 계산.
// 할부(events): start 달에 down(선수금·일시불), start 달부터 months개월 동안 monthly. 실제 기록 기간의 지출은 기록에 이미 들어 있어 빼지 않는다.
const ymNum = ym => { const m=/^(\d{4})-(\d{2})$/.exec(String(ym||"")); return m&&Number(m[2])>=1&&Number(m[2])<=12 ? Number(m[1])*12+Number(m[2])-1 : null; };
const ymText = n => `${Math.floor(n/12)}-${String(n%12+1).padStart(2,"0")}`;
function savingsStage(sc, age){
  const p={salary:finite(sc.salary)||0, growth:finite(sc.growth)||0, returnRate:finite(sc.returnRate)||0};
  for(const s of [...(sc.stages||[])].filter(s=>finite(s.age)!==null&&Number(s.age)<=age).sort((a,b)=>a.age-b.age))
    for(const k of ["salary","growth","returnRate"])if(finite(s[k])!==null)p[k]=Number(s[k]);
  return p;
}
// 실제 기록의 첫 달과 마지막 달 사이에 빠진 달(YYYY-MM)
function missingActual(sv){
  const ns=new Set((sv?.actual||[]).map(a=>finite(a.total)!==null?ymNum(a.ym):null).filter(n=>n!==null));
  if(!ns.size)return [];
  const out=[];for(let n=Math.min(...ns);n<=Math.max(...ns);n++)if(!ns.has(n))out.push(ymText(n));
  return out;
}
function simulateSavings(sv, sc){
  const actual=(sv?.actual||[]).map(a=>({n:ymNum(a.ym),total:finite(a.total)})).filter(a=>a.n!==null&&a.total!==null).sort((a,b)=>a.n-b.n);
  if(!actual.length||!sc)return null;
  const startYear=finite(sv.startYear)??Math.floor(actual[0].n/12), startAge=finite(sv.startAge)??0, age=y=>startAge+y-startYear;
  const endYear=startYear+Math.round((finite(sc.endAge)??startAge)-startAge), giving=(finite(sc.giving)||0)/100, last=actual[actual.length-1];
  const resets=new Map((sc.stages||[]).filter(s=>finite(s.age)!==null&&finite(s.spending)!==null).map(s=>[Number(s.age),Number(s.spending)]));
  const spendYear0=finite(sc.spendingYear)??Math.floor(last.n/12), spend=new Map();
  const spending=y=>{ if(spend.has(y))return spend.get(y); let s=finite(sc.spending)||0;
    for(let k=spendYear0;k<=y;k++){ if(k>spendYear0)s*=1+savingsStage(sc,age(k)).growth/100; if(resets.has(age(k)))s=resets.get(age(k)); }
    spend.set(y,s); return s; };
  const events=(sc.events||[]).map(e=>({n:ymNum(e.start),down:finite(e.down)||0,monthly:finite(e.monthly)||0,months:Math.max(0,Math.round(finite(e.months)||0))})).filter(e=>e.n!==null);
  const actualAt=n=>{let v=null;for(const a of actual){if(a.n>n)break;v=a.total;}return v;}, dec=new Map();
  const decBalance=y=>dec.has(y)?dec.get(y):actualAt(y*12+11);
  const years=new Map(), row=y=>{if(!years.has(y))years.set(y,{year:y,age:age(y),salary:0,giving:0,spending:0,payments:0,returns:0,end:null,actual:false});return years.get(y);};
  for(const a of actual){const r=row(Math.floor(a.n/12));r.end=a.total;r.actual=true;r.endYm=ymText(a.n);}
  let bal=last.total;
  for(let n=last.n+1;n<=endYear*12+11;n++){
    const y=Math.floor(n/12), p=savingsStage(sc,age(y)), r=row(y), s=spending(y);
    const pay=events.reduce((t,e)=>t+(n===e.n?e.down:0)+(n>=e.n&&n<e.n+e.months?e.monthly:0),0);
    bal+=p.salary-p.salary*giving-s-pay;
    r.salary+=p.salary;r.giving+=p.salary*giving;r.spending+=s;r.payments+=pay;
    if(n%12===11){const base=decBalance(y-1), ret=base>0?base*p.returnRate/100:0;bal+=ret-ret*giving;r.returns+=ret-ret*giving;r.giving+=ret*giving;dec.set(y,bal);}
    r.end=bal;r.endYm=ymText(n);r.actual=false;
  }
  const rows=[...years.values()].filter(r=>r.year<=endYear).sort((a,b)=>a.year-b.year);
  return {rows, last:{ym:ymText(last.n),total:last.total}, endYear, at:a=>rows.find(r=>r.age===a)?.end??null};
}

// ---------- 기록 파일·기기 간 병합 ----------
// 기록 파일(etf-planner-assets.json) = {version:1, allocation, ledger, savings}. 구역마다 savedAt(바꿀 때만 갱신)을 둔다.
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
// 구역마다: 한쪽만 바뀌었으면(지난 동기화 base와 비교) 바뀐 쪽, 둘 다 바뀌었으면 savedAt이 늦은 쪽. 버린 쪽은 lost로 돌려줘 이 기기에 보관한다.
function mergeAssets(local, remote, base){
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null), doc={version:1}, lost=[];
  for(const s of ASSET_SECTIONS){
    const L=local?.[s], R=remote?.[s], B=base?.[s];
    let pick;
    if(!R)pick=L; else if(!L)pick=R; else if(same(L,R)||same(R,B))pick=L; else if(same(L,B))pick=R;
    else{pick=String(L.savedAt||"")>=String(R.savedAt||"")?L:R;lost.push({section:s,data:pick===L?R:L});}
    if(pick)doc[s]=pick;
  }
  return {doc, lost};
}
