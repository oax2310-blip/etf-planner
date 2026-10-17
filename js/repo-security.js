// 저장소 권한 경계. 실제 접근 제한은 GitHub의 서로 다른 fine-grained PAT가 시행한다.
// 이 가드는 전환 중 남은 옛 연결이 수집 저장소로 데이터 토큰을 보내는 실수를 막는다.
const repoSecurity=(()=>{
  const collector="oax2310-blip/etf-planner-data",defaultData="oax2310-blip/etf-planner-records";
  const tokenKey="etf-planner-collection-request-token",repoKey="etf-planner-collection-data-repo";
  function assertDataRepo(repo){
    if(typeof repo!=="string"||! /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)||[".",".."].includes(repo.split("/")[1]))throw Error("데이터 저장소 이름을 확인해 주세요.");
    if(repo.toLowerCase().replace(/\.git$/,"")===collector)throw Error("기존 저장소는 KIS 수집 전용입니다. 분리된 데이터 저장소와 새 데이터 전용 토큰을 연결해 주세요. 이 기기의 기록은 유지됩니다.");
  }
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
  return {collector,defaultData,tokenKey,repoKey,assertDataRepo,assertTokens,requestConfig};
})();
