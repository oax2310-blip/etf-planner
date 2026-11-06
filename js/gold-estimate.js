// 한국장 금 분할매수 화면용. 수집기 gold_estimates.py와 같은 고정 이름/실물 ETF 목록.
// 기록에는 설정을 만들지 않고 section/ticker는 비교에만 사용한다. 종가·MA·평가액은 원본.
const goldEstimate=(()=>{
  const sections=new Set(["금","골드","금골드","gold"]);
  const tickers=new Set(["GLDM","IAUM","GLD","IAU","SGOL","AAAU","BAR","OUNZ"]);
  const positive=v=>typeof v==="number"&&Number.isFinite(v)&&v>0;
  const code=v=>typeof v==="string"?v.trim().toUpperCase():"";
  const section=v=>typeof v==="string"&&sections.has(v.replace(/[\s()·]/g,"").toLowerCase());
  const eligible=it=>section(it?.section)&&tickers.has(code(it?.ticker));
  const date=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  const iso=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&date(v.slice(0,10))&&Number.isFinite(Date.parse(v));
  // slimPrices가 버린 원본 estimate만 검증해 별도로 붙인다. 가격은 숫자형 양수,
  // 변동률은 음수/0도 가능한 유한 숫자, 시각/날짜와 원천은 고정 계약. 알 수 없는 필드는 버린다.
  function validate(e){
    if(!e||typeof e!=="object"||Array.isArray(e)||!positive(e.close)||!positive(e.baseClose)||
       !iso(e.at)||!date(e.baseDate)||e.source!=="GC=F"||e.check!=="PAXG-USD"||
       ![e.changePct,e.checkPct].every(v=>typeof v==="number"&&Number.isFinite(v)))return null;
    return {close:e.close,at:e.at,baseDate:e.baseDate,baseClose:e.baseClose,source:"GC=F",check:"PAXG-USD",changePct:e.changePct,checkPct:e.checkPct};
  }
  function attach(slim,raw){
    const stocks=Object.fromEntries(Object.entries(slim.stocks||{}).map(([ticker,entry])=>{
      const estimate=validate(raw?.stocks?.[ticker]?.estimate);
      return [ticker,estimate?{...entry,estimate}:entry];
    }));
    return {...slim,stocks};
  }
  // 한 항목이라도 조건을 만족하면 그 기준 티커의 모든 분할매수에 적용한다.
  // 동일 baseDate/baseClose·updatedAt, 미래가 아닌 60분 이내 표본만 사용한다.
  // 수집기가 NAS kr-intraday/한국장 즉시·수동 실행에서만 만든 GC 변동률 추정가이며,
  // 실패·8% 초과·PAXG와 0.4%p 초과 차이·미국 정규장에는 estimate가 제거된다.
  function info(data,it,allocation,now=Date.now()){
    const ticker=code(it?.ticker),groups=Array.isArray(allocation?.groups)?allocation.groups:[];
    if(!tickers.has(ticker)||!groups.some(g=>Array.isArray(g?.items)&&g.items.some(x=>eligible(x)&&code(x.ticker)===ticker)))return null;
    const entry=data?.stocks?.[ticker],e=validate(entry?.estimate),age=now-Date.parse(e?.at);
    return entry?.kind==="해외"&&!entry.stale&&e&&e.baseDate===entry.asOf&&e.baseClose===entry.close&&e.at===data.updatedAt&&age>=0&&age<=60*60*1000?e:null;
  }
  function current(entry,data,it,allocation,now){
    const e=info(data,it,allocation,now);
    return e&&entry&&entry.asOf===e.baseDate&&entry.close===e.baseClose?{...entry,close:e.close}:entry;
  }
  // 체결 기록은 변환하지 않는다. 기준 티커 변경 전에만 확인창을 띄운다.
  function tickerChangeMessage(before,after){
    const plan=before?.buyPlan,buys=plan?.buys;
    const recorded=buys&&typeof buys==="object"&&!Array.isArray(buys)&&Object.values(buys).some(v=>v&&typeof v==="object")||
      Array.isArray(plan?.stages)&&plan.stages.some(s=>s&&(s.done||s.partial));
    if(code(before?.ticker)===code(after?.ticker)||!recorded)return "";
    return "기준 티커를 바꾸면 완료 회차의 기준가는 옛 티커 가격으로 남습니다.\n새 티커 이동평균은 다음 수집 뒤 채워집니다."+
      (!tickers.has(code(after?.ticker))?"\n실물 금 ETF 목록 밖이므로 장중 금 추정이 꺼집니다.":"")+"\n저장할까요?";
  }
  return {section,eligible,validate,attach,info,current,tickerChangeMessage,unsupported:it=>section(it?.section)&&!tickers.has(code(it?.ticker))};
})();
