// 한국장 금 분할매수 화면용. 수집기 gold_estimates.py와 같은 고정 이름/실물 ETF 목록.
// 기록에는 설정을 만들지 않고 section/ticker는 비교에만 사용한다. 종가·MA·평가액은 원본.
const goldEstimate=(()=>{
  const sections=new Set(["금","골드","금골드","gold"]);
  const tickers=new Set(["GLDM","IAUM","GLD","IAU","SGOL","AAAU","BAR","OUNZ"]);
  const positive=v=>typeof v==="number"&&Number.isFinite(v)&&v>0;
  const code=v=>typeof v==="string"?v.trim().toUpperCase():"";
  const section=v=>typeof v==="string"&&sections.has(v.replace(/[\s()·]/g,"").toLowerCase());
  const eligible=it=>section(it?.section)&&tickers.has(code(it?.ticker));
  const groupsOf=allocation=>Array.isArray(allocation?.groups)?allocation.groups:[];
  const hasTargets=allocation=>groupsOf(allocation).some(g=>Array.isArray(g?.items)&&g.items.some(eligible));
  const applies=(it,allocation)=>tickers.has(code(it?.ticker))&&groupsOf(allocation).some(g=>Array.isArray(g?.items)&&g.items.some(x=>eligible(x)&&code(x.ticker)===code(it?.ticker)));
  const date=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  const iso=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&date(v.slice(0,10))&&Number.isFinite(Date.parse(v));
  const codes=['run','quote','source','timeout','format','series','missing','base','current','change','divergence','refresh','compile'];
  const errors=new Set(['refresh','compile']),object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),count=v=>Number.isSafeInteger(v)&&v>=0;
  const reasons={};
  // 상태는 시세 캐시에만 붙인다. Python/compile과 같은 고정 코드·안전한 정수로 검증한다.
  function validateStatus(v,updatedAt){
    if(!object(v)||v.at!==updatedAt||!iso(v.at)||typeof v.ran!=='boolean'||!count(v.computed)||!count(v.streak)||!object(v.holds)||Object.entries(v.holds).some(([c,n])=>!codes.includes(c)||!count(n)))return null;
    const clean={at:v.at,ran:v.ran,computed:v.computed,holds:{...v.holds},streak:v.streak};
    if(Object.hasOwn(v,'error')){if(!errors.has(v.error))return null;clean.error=v.error;}
    if(v.streak){if(!iso(v.since)||Date.parse(v.since)>Date.parse(v.at))return null;clean.since=v.since;}
    else if(Object.hasOwn(v,'since'))return null;
    for(const key of ['last','lastError'])if(Object.hasOwn(v,key)){
      const e=v[key];if(!object(e)||!(key==='lastError'?errors.has(e.code):codes.includes(e.code))||!iso(e.at)||Date.parse(e.at)>Date.parse(v.at))return null;
      clean[key]={code:e.code,at:e.at};
    }
    return clean;
  }
  const status=data=>validateStatus(data?.goldEstimateStatus,data?.updatedAt);
  function attachStatus(slim,raw){
    const {goldEstimateStatus,...clean}=slim,s=status(raw);
    return s?{...clean,goldEstimateStatus:s}:clean;
  }
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
    return attachStatus({...slim,stocks},raw);
  }
  // 한 항목이라도 조건을 만족하면 그 기준 티커의 모든 분할매수에 적용한다.
  // 동일 baseDate/baseClose·updatedAt, 미래가 아닌 60분 이내 표본만 사용한다.
  // 수집기가 NAS kr-intraday/한국장 즉시·수동 실행에서만 만든 GC 변동률 추정가이며,
  // 실패·8% 초과·PAXG와 0.4%p 초과 차이·미국 정규장에는 estimate가 제거된다.
  function info(data,it,allocation,now=Date.now()){
    const ticker=code(it?.ticker),s=status(data);
    if(!applies(it,allocation)||s?.lastError||s?.streak>=3||s?.ran&&s.computed===0)return null;
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
  Object.assign(reasons,{run:'계산 실행 아님',source:'시세 응답 실패',timeout:'시간 초과(15초)',format:'응답 형식 이상',series:'응답 형식 이상',missing:'응답 형식 이상',base:'뉴욕 마감 시점 시세 없음',current:'최근 30분 시세 없음',change:'변동 8% 초과',divergence:'금선물·PAXG 차이 0.4%p 초과',quote:'기준 종가 미확정',refresh:'수집 계산 오류',compile:'알림 계산 오류'});
  const reason=c=>reasons[c]||reasons.missing;
  const clock=at=>{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
    return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  };
  const lastOf=s=>s.last||{code:[...codes].reverse().find(c=>c!=='run'&&s.holds[c]>0)||'missing',at:s.at};
  // 카드 우선순위: 마지막 오류 → 3회 이상 연속 보류 → 이번 계산 보류 → 기존 추정가.
  function notice(data,it,allocation){
    if(!applies(it,allocation))return null;
    const s=status(data);if(!s)return null;
    if(s.lastError)return {kind:'error',text:`한국장 금 추정 오류(${s.lastError.code==='refresh'?'수집 계산':'알림 계산'}) · ${clock(s.lastError.at)}(한국 시간) · 금 추정 없이 GLDM 종가로 판정합니다. 수집 기록을 확인하세요.`};
    const last=lastOf(s);
    if(s.streak>=3)return {kind:'streak',text:`한국장 금 추정 ${s.streak}회 연속 보류 · 마지막 사유: ${reason(last.code)} · ${clock(last.at)}`};
    if(s.ran&&s.computed===0)return {kind:'hold',text:`이번 수집 금 추정 보류 · ${reason(last.code)}`};
    return null;
  }
  function problems(data,allocation){
    const s=status(data);if(!hasTargets(allocation)||!s)return [];
    const out=[];
    if(s.lastError)out.push({key:`error:${s.lastError.code}:${s.lastError.at}`,text:`한국장 금 추정 오류 · ${reason(s.lastError.code)} · ${clock(s.lastError.at)}(한국 시간)`});
    if(s.streak>=3){const last=lastOf(s);out.push({key:`streak:${s.since}`,text:`한국장 금 추정 ${s.streak}회 연속 보류 · 마지막 사유: ${reason(last.code)} · ${clock(last.at)}(한국 시간)`});}
    return out;
  }
  const ACK_KEY='etf-planner-gold-estimate-ack';
  const ackKey=k=>typeof k==='string'&&(k.startsWith('streak:')&&iso(k.slice(7))||['refresh','compile'].some(c=>k.startsWith(`error:${c}:`)&&iso(k.slice(`error:${c}:`.length))));
  let checkPopup=()=>{},initialized=false;
  // 초기 캐시·시세/자산 변경·다른 dialog 종료마다 확인한다. ACK는 이 기기 최근 20개만,
  // 저장 실패 때는 현재 페이지 메모리에서 확인 상태를 유지하고 화면 동작을 계속한다.
  function initialize({prices,allocation,subscribe}={}){
    if(initialized||typeof document==='undefined')return;
    const byId=id=>document.getElementById(id),dialog=byId('goldEstimateDialog');
    if(!dialog)return;initialized=true;
    const read=()=>{try{const v=JSON.parse(localStorage.getItem(ACK_KEY)||'[]');return Array.isArray(v)?v.slice(-20).filter(ackKey):[];}catch{return [];}};
    let acknowledged=read(),shown=[];
    const remember=keys=>{acknowledged=[...new Set([...acknowledged,...read(),...keys])].slice(-20);};
    const check=()=>{
      remember([]);
      const pending=problems(prices?.(),allocation?.()).filter(p=>!acknowledged.includes(p.key));
      if(!pending.length){shown=[];if(dialog.open)dialog.close();return;}
      if(document.querySelector('dialog[open]:not(#goldEstimateDialog)'))return;
      shown=pending.map(p=>p.key);
      const rows=pending.map(p=>{const row=document.createElement('p');row.className='warning';row.textContent=p.text;return row;});
      byId('goldEstimateProblems').replaceChildren(...rows);
      byId('goldEstimateFallback').textContent='지금은 금 추정 없이 GLDM 종가로 판정·알림합니다';
      byId('goldEstimateHelp').textContent="GitHub Actions 'KIS 시세 수집' 기록에서 '금 추정' 줄을 확인하세요";
      if(!dialog.open)try{dialog.showModal();}catch{}
    };
    checkPopup=check;
    byId('goldEstimateConfirm').onclick=()=>{remember(shown);try{localStorage.setItem(ACK_KEY,JSON.stringify(acknowledged));}catch{}shown=[];dialog.close();};
    dialog.addEventListener('cancel',event=>event.preventDefault());
    document.addEventListener('close',()=>setTimeout(check,0),true);
    subscribe?.(check);
    if(typeof addEventListener==='function'){
      addEventListener('pageshow',check);
      addEventListener('storage',event=>{if(event.key===ACK_KEY||event.key===null)check();});
    }
    check();
  }
  return {section,eligible,hasTargets,applies,validate,validateStatus,status,attachStatus,attach,info,current,tickerChangeMessage,notice,problems,initialize,check:()=>checkPopup(),unsupported:it=>section(it?.section)&&!tickers.has(code(it?.ticker))};
})();
