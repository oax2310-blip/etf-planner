// 검증된 분할·병합 대기 안내와 사용자 확인. 계산은 split-auto.js, 실제 보정은 기존 split-dialog.js 흐름을 사용한다.
const splitNotices = (()=>{
  const plannerKey="etf-exit-planner-standalone-v1"; // core.js STORAGE_KEY. 자산 화면에서는 같은 기기의 플래너 이력만 읽는다.
  const byId=id=>document.getElementById(id),assetsPage=()=>document.body.classList.contains("assets-page");
  let ready=false,locationReady=false,opening=false,queued=null;
  function planner(){if(!assetsPage())return state;try{return JSON.parse(localStorage.getItem(plannerKey)||"null")||{};}catch{return {};}}
  function waiting(){return splitAuto.pending(assetsPage()?assetStore.corporateActions:plannerCorporateActions(),planner().splitLog);}
  function busy(){return !assetsPage()&&(sync.busy||sync.blocked||priceRefreshBusy||assetStore.status.busy||assetStore.status.choice||assetStore.priceRefreshing);}
  const name=a=>stockNames.lookup(a.ticker)||a.ticker;
  const summary=a=>`${name(a)} ${a.from}→${a.to} ${a.kind==="split"?"액면분할":"액면병합"} 감지 (${Number(a.exDate.slice(5,7))}/${Number(a.exDate.slice(8,10))})`;
  function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function openAction(action){
    const fresh=waiting().find(a=>a.id===action.id);if(!fresh||busy())return false;
    return splitDialog.openAuto(fresh);
  }
  function updateDismiss(){
    const confirm=byId("splitDismissConfirm");if(confirm)confirm.disabled=busy()||!queued||!waiting().some(a=>a.id===queued.id);
  }
  function render(){
    if(!ready)return;
    const host=byId("splitNotices"),rows=waiting(),nodes=[];
    for(const action of rows){
      const row=node("div","split-notice"),body=node("div","split-notice-body");
      body.append(node("strong","",summary(action)));
      if(!assetsPage())body.append(node("p","","보유 수량·체결가 반영이 필요합니다."));
      const buttons=node("div","split-notice-actions");
      if(assetsPage()){
        const link=node("a","btn mini","플래너에서 확인");link.href=`index.html?split=${encodeURIComponent(action.id)}`;buttons.append(link);
      }else{
        const check=node("button","btn primary mini","확인"),skip=node("button","btn ghost mini","해당 없음");
        check.type=skip.type="button";check.disabled=skip.disabled=!!busy();check.onclick=()=>openAction(action);skip.onclick=()=>dismiss(action);buttons.append(check,skip);
      }
      row.append(body,buttons);nodes.push(row);
    }
    host.replaceChildren(...nodes);host.hidden=!nodes.length;updateDismiss();
    if(!assetsPage()&&locationReady&&!opening&&!busy()){
      const action=splitAuto.locationAction(location.search,rows);
      if(action&&!document.querySelector("dialog[open]")){
        opening=true;
        try{if(openAction(action)){const url=new URL(location.href);url.searchParams.delete("split");history.replaceState(null,"",url.pathname+url.search+url.hash);}}finally{opening=false;}
      }
    }
  }
  // 미리보기 0건 또는 '해당 없음'도 별도 확인 버튼을 누른 뒤에만 처리 이력을 만든다.
  function dismiss(action,noChanges=false){
    const fresh=waiting().find(a=>a.id===action.id);if(!fresh||busy())return false;
    queued=fresh;byId("splitDismissSummary").textContent=summary(fresh);
    byId("splitDismissReason").textContent=noChanges?"이 종목에서 바뀔 칸이 없습니다. 해당 없음으로 기록하고 안내를 닫을까요?":"이미 직접 반영했거나 보유 기록에 해당하지 않으면 안내를 닫을 수 있습니다.";
    byId("splitDismissFeedback").textContent="";
    if(byId("splitDialog").open)byId("splitDialog").close();
    byId("splitDismissDialog").showModal();updateDismiss();return true;
  }
  function confirmDismiss(){
    if(!queued||busy())return;
    try{
      absorbPlanner();assetStore.absorbLocal?.();
      const action=waiting().find(a=>a.id===queued.id);if(!action){render();byId("splitDismissDialog").close();return;}
      const entry={id:id(),ticker:action.ticker,from:action.from,to:action.to,exDate:action.exDate,appliedAt:new Date().toISOString(),actionId:action.id,source:"auto",planner:false,assets:false,dismissed:true};
      const next=appendSplitLog(state,entry);externalData.planner(next);
      if(save(next)!==true)throw Error("이 기기에 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도하세요.");
      queued=null;byId("splitDismissDialog").close();render();
    }catch(error){byId("splitDismissFeedback").textContent=error.message;updateDismiss();}
  }
  function initialize(){
    if(ready)return;ready=true;
    if(!assetsPage()){
      byId("splitDismissCancel").onclick=()=>byId("splitDismissDialog").close();byId("splitDismissConfirm").onclick=confirmDismiss;
      byId("splitDismissDialog").addEventListener("close",()=>{queued=null;});
    }
    assetStore.subscribe(render);
    addEventListener("storage",event=>{if(event.key===plannerKey||event.key===null)render();});
    addEventListener("pageshow",render);setInterval(()=>{if(!document.hidden)render();},60000);render();
  }
  function openLocation(){locationReady=true;render();}
  return {initialize,render,dismiss,openLocation};
})();
