// 두 화면의 즉시 수집: Contents 읽기·쓰기 권한으로 데이터 저장소에 요청하고, 그 요청의 결과만 받는다.
// 데이터 저장소 kis-prices.yml(repository_dispatch: collect-prices-now)·kis_prices.py(collectionRequests)와 같은 계약.
async function collectPricesNow(cfg, progress=()=>{}, same=()=>true){
  const requestId=crypto.randomUUID(), path=`/repos/${cfg.repo}`;
  const waitingMessage="시세 수집 완료를 아직 확인하지 못했습니다. 잠시 후 다시 불러오거나 데이터 저장소의 수집 작업 상태를 확인해 주세요.";
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),300000);
  const check=()=>{if(!same())throw Error("연결 설정이 바뀌었습니다. 다시 시세를 불러와 주세요.");if(controller.signal.aborted)throw Error(waitingMessage);};
  async function request(suffix,options={}){
    check();
    let r;
    try{r=await fetch(`https://api.github.com${path}${suffix}`,{cache:"no-store",signal:controller.signal,...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${cfg.token}`,...options.headers}});}
    catch(error){check();if(error?.name==="TypeError")throw Error("네트워크 연결을 확인해 주세요.");throw error;}
    check();
    if(r.status===401)throw Error("GitHub 토큰이 맞지 않거나 만료됐습니다. 동기화 설정에서 새 토큰을 넣어 주세요.");
    if(r.status===403)throw Error("토큰 권한이 부족하거나 요청이 너무 많습니다. 데이터 저장소의 Contents 읽기·쓰기 권한을 확인해 주세요.");
    return r;
  }
  try{
    progress("시세 수집 요청 중…");
    const sent=await request("/dispatches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_type:"collect-prices-now",client_payload:{request_id:requestId}})});
    if(!sent.ok)throw Error(`시세 수집 요청 실패 (${sent.status}) · 데이터 저장소와 토큰 권한을 확인해 주세요.`);
    progress("시세 수집 중… · 완료되면 자동으로 불러옵니다.");
    let etag="";
    for(let attempt=0;attempt<60;attempt++){
      await new Promise(resolve=>setTimeout(resolve,5000));check();
      const r=await request("/contents/etf-planner-prices.json",{headers:{Accept:"application/vnd.github.raw+json",...(etag?{"If-None-Match":etag}:{})}});
      if(r.status===304||r.status===404)continue; // 첫 수집은 아직 파일이 없을 수 있다.
      if(!r.ok)throw Error(`시세 읽기 실패 (${r.status})`);
      let doc;try{doc=JSON.parse(await r.text());}catch{throw Error("시세 파일을 읽을 수 없습니다.");}
      check();etag=r.headers?.get?.("ETag")||"";
      const receipt=Array.isArray(doc?.collectionRequests)?doc.collectionRequests.find(e=>e?.id===requestId):null;
      if(!receipt)continue; // 예약 수집이나 다른 기기의 결과를 내 요청의 완료로 표시하지 않는다.
      if(!doc.stocks||typeof doc.stocks!=="object"||Array.isArray(doc.stocks))throw Error("시세 파일 형식을 확인할 수 없습니다.");
      return {doc,etag,message:receipt.failed?"시세 수집 완료 · 일부 조회 실패(마지막 시세 유지)":""};
    }
    throw Error(waitingMessage);
  }finally{clearTimeout(timer);}
}
