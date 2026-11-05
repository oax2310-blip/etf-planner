// 수집 응답의 액면분할·병합 검증·대기 판정. DOM·투자 기록 변경 없음. 시세 메타 캐시는 별도 키에만 둔다.
const splitAuto = (()=>{
  const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
  const day=v=>typeof v==="string"&&/^(?!0000)\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  const iso=v=>typeof v==="string"&&v.length<=40&&day(v.slice(0,10))&&/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)&&Number.isFinite(Date.parse(v));
  const ticker=v=>typeof v==="string"&&/^[A-Z0-9][A-Z0-9.\/-]{0,31}$/.test(v)&&!["BTC-USD","KS200"].includes(v);
  const ratio=v=>Number.isInteger(v)&&v>=1&&v<=1000;
  const code=v=>typeof v==="string"?v.trim().toUpperCase().replace(/^A(\d[0-9A-Z]{5})$/,"$1"):"";
  const key="etf-planner-corporate-actions";
  // 50개 초과 배열은 전체를 버리고, 개별 잘못된 항목·중복 id는 건너뛴다. 계약 필드만 복사한다.
  function read(doc){
    const rows=doc?.corporateActions;if(!Array.isArray(rows)||rows.length>50)return [];
    const seen=new Set(),out=[];
    for(const r of rows){
      if(!object(r)||!ticker(r.ticker)||!ratio(r.from)||!ratio(r.to)||r.from===r.to||!day(r.exDate)||!day(r.basisThrough)||!iso(r.detectedAt)||r.kind!==(r.to>r.from?"split":"merge")||r.id!==`${r.ticker}:${r.exDate}:${r.from}:${r.to}`||seen.has(r.id))continue;
      seen.add(r.id);out.push({id:r.id,ticker:r.ticker,kind:r.kind,from:r.from,to:r.to,exDate:r.exDate,basisThrough:r.basisThrough,detectedAt:r.detectedAt});
    }
    return out;
  }
  // 감지 후 30일(정확히 30일은 포함). 같은 actionId 또는 같은 종목·비율에 적용일 ±7일 이력이 있으면 수동 반영·제외도 처리된 것으로 본다.
  function pending(actions,splitLog,now=Date.now()){
    const logs=Array.isArray(splitLog)?splitLog:[],clock=Number(now),oneDay=86400000;
    return read({corporateActions:actions}).filter(a=>{
      const age=clock-Date.parse(a.detectedAt);if(!Number.isFinite(age)||age<0||age>30*oneDay)return false;
      return !logs.some(r=>object(r)&&(r.actionId===a.id||code(r.ticker)===code(a.ticker)&&r.from===a.from&&r.to===a.to&&day(r.exDate)&&Math.abs(Date.parse(r.exDate)-Date.parse(a.exDate))<=7*oneDay));
    });
  }
  // pending 목록의 id만 허용한다. 중복 쿼리·임의 종목/비율 입력은 받지 않는다.
  function locationAction(search,waiting){
    const params=new URLSearchParams(search),ids=params.getAll("split");
    return ids.length===1?(waiting||[]).find(a=>a.id===ids[0])||null:null;
  }
  function load(storage){try{return JSON.parse(storage.getItem(key)||"null");}catch{return null;}}
  function cached(cache,repo,etag){
    return object(cache)&&cache.format===1&&cache.repo===repo&&cache.etag===etag&&Array.isArray(cache.items)&&cache.items.length<=50?read({corporateActions:cache.items}):null;
  }
  function remember(storage,repo,etag,doc){
    const cache={format:1,repo,etag,items:read(doc)};try{storage.setItem(key,JSON.stringify(cache));}catch{}
    return cache;
  }
  return {read,pending,locationAction,key,load,cached,remember};
})();
