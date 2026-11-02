// 저장소 권한 경계. 실제 접근 제한은 GitHub의 서로 다른 fine-grained PAT가 시행한다.
// 이 가드는 전환 중 남은 옛 연결이 수집 저장소로 데이터 토큰을 보내는 실수를 막는다.
const repoSecurity=(()=>{
  const collector="oax2310-blip/etf-planner-data",defaultData="oax2310-blip/etf-planner-records";
  const tokenKey="etf-planner-collection-request-token",repoKey="etf-planner-collection-data-repo";
  function assertDataRepo(repo){
    if(typeof repo!=="string"||! /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)||[".",".."].includes(repo.split("/")[1]))throw Error("데이터 저장소 이름을 확인해 주세요.");
    if(repo.toLowerCase().replace(/\.git$/,"")===collector)throw Error("기존 저장소는 KIS 수집 전용입니다. 분리된 데이터 저장소와 새 데이터 전용 토큰을 연결해 주세요. 이 기기의 기록은 유지됩니다.");
  }
  // 데이터 PAT로 읽고 쓰는 요청만 공유한다. 수집 저장소 Issues 요청은 price-collection.js에 둔다.
  async function dataRequest(cfg,path,options={},messages={}){
    assertDataRepo(cfg.repo);
    const networkError=error=>{
      if(error?.name==="AbortError"||error?.name==="TimeoutError")return Error("GitHub 응답이 늦어 동기화를 멈췄습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
      if(error?.name==="TypeError")return Error("네트워크 연결을 확인해 주세요.");
      return error;
    };
    let response;
    try{
      const signal=options.signal??(typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?AbortSignal.timeout(30000):undefined);
      const request={cache:"no-store",...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${cfg.token}`,...options.headers}};
      if(signal===undefined)delete request.signal;else request.signal=signal;
      response=await fetch(`https://api.github.com${path}`,request);
    }catch(error){throw networkError(error);}
    if(response.status===401)throw Error(messages.unauthorized??"GitHub 토큰이 맞지 않거나 만료됐습니다. 동기화 설정에서 새 토큰을 넣어 주세요.");
    if(response.status===403)throw Error("토큰 권한이 부족하거나 요청이 너무 많습니다. 토큰의 Contents 읽기·쓰기 권한을 확인해 주세요.");
    // 제한 신호는 본문을 읽을 때도 유지된다. 본문 전송 중 끊긴 오류도 같은 안내로 바꾼다.
    for(const method of ["json","text"]){
      const read=response[method].bind(response);
      response[method]=async(...args)=>{try{return await read(...args);}catch(error){throw networkError(error);}};
    }
    return response;
  }
  async function checkPrivateDataRepo(cfg,messages){
    const response=await dataRequest(cfg,`/repos/${cfg.repo}`,{},messages);
    if(response.status===404)throw Error(messages.notFound);
    if(!response.ok)throw Error(`저장소 확인 실패 (${response.status})`);
    if(!(await response.json()).private)throw Error(messages.publicRepo);
  }
  const decodeBase64Text=text=>new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g,"")),c=>c.charCodeAt(0)));
  // 새로 저장할 때만 fine-grained PAT(github_pat_)인지 본다. classic PAT(ghp_)·OAuth 토큰은 고른 저장소 밖
  // (공개 앱 코드·수집 저장소)까지 열 수 있다. 이미 저장된 연결은 그대로 둔다.
  const fineGrained=token=>/^github_pat_\w{20,}$/.test(token);
  function assertTokens(data,request){
    if(!fineGrained(data))throw Error("데이터 토큰은 github_pat_로 시작하는 fine-grained 토큰만 저장합니다. classic 토큰(ghp_)은 모든 저장소를 열 수 있어 저장하지 않았습니다.");
    if(request&&!fineGrained(request))throw Error("즉시수집 토큰도 github_pat_로 시작하는 fine-grained 토큰(수집 저장소 Issues만)을 넣어 주세요.");
    if(request&&request===data)throw Error("데이터 전용 토큰과 즉시수집 전용 토큰을 각각 발급해 주세요.");
  }
  function requestConfig(cfg){
    assertDataRepo(cfg.repo);
    const token=localStorage.getItem(tokenKey)||"";
    if(!token||localStorage.getItem(repoKey)!==cfg.repo)throw Error("즉시수집용 Issues 전용 토큰을 동기화 설정에 연결해 주세요. 예약수집에는 영향이 없습니다.");
    if(token===cfg.token)throw Error("데이터 토큰과 즉시수집 토큰은 서로 달라야 합니다.");
    return {repo:collector,token};
  }
  return {collector,defaultData,tokenKey,repoKey,assertDataRepo,dataRequest,checkPrivateDataRepo,decodeBase64Text,assertTokens,requestConfig};
})();
