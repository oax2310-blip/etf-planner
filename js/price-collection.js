// 즉시수집: 수집 저장소의 Issues 전용 토큰으로 요청 ID만 보내고 데이터 토큰으로 결과만 읽는다.
// 두 토큰은 교환하지 않는다. 실패 시 Contents/Actions 권한 요청이나 dispatch로의 우회가 없다.
async function collectPricesNow(cfg, progress=()=>{}, same=()=>true){
  const trigger=repoSecurity.requestConfig(cfg),requestId=crypto.randomUUID(), path=`/repos/${cfg.repo}`;
  const waitingMessage="시세 수집 완료를 아직 확인하지 못했습니다. 잠시 후 다시 불러오거나 데이터 저장소의 수집 작업 상태를 확인해 주세요.";
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),300000);
  const check=()=>{if(!same()||repoSecurity.requestConfig(cfg).token!==trigger.token)throw Error("연결 설정이 바뀌었습니다. 다시 시세를 불러와 주세요.");if(controller.signal.aborted)throw Error(waitingMessage);};
  async function request(suffix,options={},issue=false){
    check();
    let r;
    try{r=await fetch(`https://api.github.com${issue?`/repos/${trigger.repo}`:path}${suffix}`,{cache:"no-store",redirect:"error",signal:controller.signal,...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${issue?trigger.token:cfg.token}`,...options.headers}});}
    catch(error){check();if(error?.name==="TypeError")throw Error("네트워크 연결을 확인해 주세요.");throw error;}
    check();
    if(r.status===401)throw Error("GitHub 토큰이 맞지 않거나 만료됐습니다. 동기화 설정에서 새 토큰을 넣어 주세요.");
    if(r.status===403)throw Error(issue?"즉시수집 토큰의 Issues 쓰기 권한 또는 요청 한도를 확인해 주세요. Contents·Actions 권한은 부여하지 마세요.":"데이터 토큰의 Contents 읽기·쓰기 권한 또는 요청 한도를 확인해 주세요.");
    return r;
  }
  try{
    progress("시세 수집 요청 중…");
    const sent=await request("/issues",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"ETF price collection",body:JSON.stringify({version:1,request_id:requestId})})},true);
    if(!sent.ok)throw Error(`시세 수집 요청 실패 (${sent.status}) · 데이터 저장소와 토큰 권한을 확인해 주세요.`);
    const issue=await sent.json();if(!Number.isSafeInteger(issue?.number)||issue.number<1)throw Error("수집 요청 응답 형식을 확인할 수 없습니다.");
    progress("시세 수집 중… · 완료되면 자동으로 불러옵니다.");
    let etag="";
    for(let attempt=0;attempt<60;attempt++){
      await new Promise(resolve=>setTimeout(resolve,5000));check();
      // Fixed status values only; issue text never becomes HTML, code, a ref, or a command.
      const status=await request(`/issues/${issue.number}`,{},true);
      if(status.ok){const state=await status.json();if(state.state==="closed"){
        let result;try{result=JSON.parse(state.body);}catch{}
        if(result?.request_id===requestId&&["failed","rate-limited","duplicate-request"].includes(result.status))throw Error(result.status==="rate-limited"?"즉시수집 요청이 많습니다. 1분 후 다시 시도해 주세요.":"수집 작업이 완료되지 않았습니다. 마지막 시세를 유지합니다. 수집 저장소의 작업 상태를 확인해 주세요.");
      }}
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
// 정기 수집이 늦어졌는지: GitHub 예약 실행이 빠지거나 크게 늦으면 그동안 시세·알림도 멈춘다. 마지막 수집(시세 파일 updatedAt)이
// 한국 시간 평일 10:20~15:20(국내 장중 약 30분마다, 실제 시작은 예약보다 13~41분 늦음)에는 70분, 그 밖에는 7시간 30분 넘게 지났으면 true.
// 장중 한 번 빠짐은 보통 1시간 안팎이라 두 번 이상 빠지거나 크게 늦을 때 표시한다. 그 밖의 시간은 휴장일에 저녁 수집을 건너뛰어
// 16:40→23:10 예약 사이가 최대 7시간 가까이 빌 수 있어 길게 둔다(주말 3시간·밤 최대 3시간 반 간격도 두 번 이상 빠질 때 표시).
// 수집 시각을 모르면 false. 화면 표시용이며 기록은 바꾸지 않는다.
function priceCollectionLate(updatedAt, now=new Date()){
  const at=Date.parse(updatedAt);if(!Number.isFinite(at))return false;
  const kst=new Date(now.getTime()+9*3600e3),day=kst.getUTCDay(),minute=kst.getUTCHours()*60+kst.getUTCMinutes();
  const intraday=day>=1&&day<=5&&minute>=10*60+20&&minute<15*60+20;
  return now.getTime()-at>(intraday?70:450)*60e3;
}
