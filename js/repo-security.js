// 저장소 권한 경계. 실제 접근 제한은 GitHub의 서로 다른 fine-grained PAT가 시행한다.
// 이 가드는 전환 중 남은 옛 연결이 수집 저장소로 데이터 토큰을 보내는 실수를 막는다.
const repoSecurity=(()=>{
  const collector="oax2310-blip/etf-planner-data",defaultData="oax2310-blip/etf-planner-records";
  const tokenKey="etf-planner-collection-request-token",repoKey="etf-planner-collection-data-repo";
  function assertDataRepo(repo){
    if(typeof repo!=="string"||! /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)||[".",".."].includes(repo.split("/")[1]))throw Error("데이터 저장소 이름을 확인해 주세요.");
    if(repo.toLowerCase().replace(/\.git$/,"")===collector)throw Error("기존 저장소는 KIS 수집 전용입니다. 분리된 데이터 저장소와 새 데이터 전용 토큰을 연결해 주세요. 이 기기의 기록은 유지됩니다.");
  }
  function requestConfig(cfg){
    assertDataRepo(cfg.repo);
    const token=localStorage.getItem(tokenKey)||"";
    if(!token||localStorage.getItem(repoKey)!==cfg.repo)throw Error("즉시수집용 Issues 전용 토큰을 동기화 설정에 연결해 주세요. 예약수집에는 영향이 없습니다.");
    if(token===cfg.token)throw Error("데이터 토큰과 즉시수집 토큰은 서로 달라야 합니다.");
    return {repo:collector,token};
  }
  return {collector,defaultData,tokenKey,repoKey,assertDataRepo,requestConfig};
})();
