// 자산 현황(assets.html) 계산: 자산 배분 평가액·비중, 월별 손익 요약, 저축 계획 시뮬레이션, 기기 간 병합.
// DOM 없이 불러와 테스트하므로(tests/assets.test.cjs) 함수 밖에서 화면을 건드리지 말 것. 공개 소스라 개인 수치를 기본값으로 넣지 말 것.
// 단위: 자산 배분 금액(amount·total)은 만원, 현금(cash[].amount)은 원 또는 달러, 손익·저축은 원. 비중·수익률(target·giving·growth·returnRate)은 % 숫자(3 = 3%).
const ASSET_SECTIONS = ["allocation","ledger","savings"]; // 기록 파일의 세 구역. 기기 간 병합은 구역마다 따로(savedAt)
const ASSET_REGIONS = ["미국","국내","해외","현금","외화·원자재","기타"]; // 큰 분류 지역 순서(목록에 없는 지역은 뒤에)
const finite = v => v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v)) ? Number(v) : null;
const plus = v => { const n=finite(v); return n!==null&&n>0 ? n : null; };

// ---------- 시세 ----------
// prices = {updatedAt, stocks:{종목 코드:{kind, asOf, close, stale}}, fx:{close, asOf}} (assets.js가 시세 파일에서 필요한 값만 남긴 것)
function assetQuote(prices, ticker){
  const key=String(ticker||"").trim().toUpperCase(), e=key&&prices?.stocks?.[key];
  if(!e||!(Number(e.close)>0)||!/^\d{4}-\d{2}-\d{2}$/.test(String(e.asOf)))return null;
  return {...e, close:Number(e.close), currency:e.kind==="해외"||e.kind==="코인"?"USD":"KRW"};
}
// 원/달러: 시세 파일의 현물 환율, 없으면 자산 배분에 직접 넣은 환율(cashFx)
const assetFx = (prices, alloc) => plus(prices?.fx?.close) || plus(alloc?.cashFx);
// 1주(1단위) 원화 가격. 달러 시세는 × 환율, 환율이 없으면 null
const krwPrice = (q, fx) => !q ? null : q.currency==="USD" ? (fx ? q.close*fx : null) : q.close;

// ---------- 자산 배분 ----------
// 종목 평가액(만원): ① 보유 수량 × 현재가(달러는 × 환율) ② 금액만 넣었으면 금액 × (지금 원화 가격 ÷ 금액을 넣을 때 원화 가격 base)
// ③ 시세가 없으면 넣은 금액 그대로. 미국 ETF를 따라가는 국내 ETF는 ticker에 따라가는 미국 ETF를 넣어 ②로 따라간다.
function itemValue(item, prices, fx){
  const q=assetQuote(prices,item?.ticker), p=krwPrice(q,fx), shares=plus(item?.shares), amount=finite(item?.amount)||0;
  if(shares&&p)return {value:shares*p/1e4, how:"shares", q};
  if(amount>0&&p&&plus(item?.base))return {value:amount*p/Number(item.base), how:"ratio", q};
  return {value:amount, how:"amount", q};
}
// 금액만 넣은 종목에 기준 가격(base)이 없으면 지금 시세로 정한다(그 뒤로 금액이 시세를 따라감). 바꾼 종목이 있으면 true.
function fillBases(alloc, prices){
  const fx=assetFx(prices,alloc);let changed=false;
  for(const g of alloc?.groups||[])for(const it of g.items||[]){
    if(plus(it.shares)||!(finite(it.amount)>0)||plus(it.base))continue;
    const q=assetQuote(prices,it.ticker), p=krwPrice(q,fx);
    if(p){it.base=Math.round(p*1e4)/1e4;it.baseAt=q.asOf;changed=true;}
  }
  return changed;
}
// 금액·종목 코드를 고쳤을 때 기준 가격을 지금 시세로 다시 잡는다(시세가 없으면 지움 → 다음 시세 때 fillBases)
function resetBase(it, prices, alloc){
  delete it.base;delete it.baseAt;
  const q=assetQuote(prices,it.ticker), p=krwPrice(q,assetFx(prices,alloc));
  if(p&&finite(it.amount)>0&&!plus(it.shares)){it.base=Math.round(p*1e4)/1e4;it.baseAt=q.asOf;}
}
// 현금(만원): 원화는 그대로, 달러는 × 환율(시세 → 직접 넣은 환율), minus는 빼는 항목(예: 선물 증거금)
function cashValue(c, fx){ const a=finite(c?.amount)||0, krw=c?.currency==="USD"?a*(fx||0):a; return (c?.minus?-krw:krw)/1e4; }
// 화면에 쓰는 합계. base = 비중 기준(직접 넣은 기준 총자산, 없으면 종목+현금 합계)
function allocationSummary(alloc, prices){
  const fx=assetFx(prices,alloc), items=new Map(), groups=new Map(), classes=new Map(), sections=new Map();
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
  const regions=[...new Set([...ASSET_REGIONS,...(alloc?.classes||[]).map(c=>c.region||"기타")])]
    .map(name=>({name,classes:(alloc?.classes||[]).filter(c=>(c.region||"기타")===name)})).filter(r=>r.classes.length)
    .map(r=>({...r,value:r.classes.reduce((s,c)=>s+(classes.get(c.id)||0),0),target:r.classes.some(c=>finite(c.target)!==null)?r.classes.reduce((s,c)=>s+(finite(c.target)||0),0):null}));
  return {fx, invest, cash, grand, base, items, groups, classes, regions, section:(gid,name)=>sections.get(`${gid}\u0000${name}`)||0, pct:v=>base>0?v/base*100:0};
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
