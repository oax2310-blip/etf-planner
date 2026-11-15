// 신뢰한 앱 문서에서 만든 blob을 비동기로 읽는다. 원래 바이트를 보존하며 저장소에는 접근하지 않는다.
(function(url){
  const key = Symbol.for("etf-planner.android.download"), job = {status:"pending"};
  window[key] = job;
  return fetch(url).then(response => {
    if (!response.ok) throw new Error("백업 파일을 읽지 못했습니다.");
    return response.arrayBuffer();
  }).then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    if (window[key] === job) { job.status = "ready"; job.base64 = base64; }
    return base64;
  }).catch(() => {
    if (window[key] === job) job.status = "error";
    return null;
  });
})(__PLANNER_BLOB_URL__);
