// 액면분할 입력·미리보기·기존 저장 흐름 연결. 계산은 split-adjust.js, 시각·이력 생성은 반영 버튼을 누를 때만 한다.
const splitDialog = (()=>{
  let ready=false,shown=null,applying=false,appliedCount=null;
  const picks=new Map(),byId=key=>document.getElementById(key);
  const store=()=>typeof assetStore==="object"?assetStore:null;
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  const format=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:6});
  const fieldNames={startPrice:"시작 기준가",endPrice:"종료 기준가",valueBase:"평가액 기준 가격",basisPrice:"이전 기준 가격",currentPrice:"현재가",lowPrice:"신저점 가격",floorPrice:"손절 하단가",finalPrice:"마지막 가격",price:"가격",execPrice:"체결 가격",referencePrice:"기준 ETF 현재가",sourcePrice:"기준 ETF 가격",tradePrice:"실제 ETF 가격",averagePrice:"평균 매수가",base:"평가 기준 가격",shares:"수량",plannedShares:"계획 수량",qty:"체결 수량",plannedQty:"계획 수량",sourceQty:"기준 ETF 수량",sourceShares:"원래 기준 수량",exact:"반올림 전 수량",end:"목표 가격"};
  function assets(){try{return object(store()?.doc)?store().doc:{};}catch{return {};}}
  function readable(){try{return object(store()?.doc);}catch{return false;}}
  function writable(){try{return !!store()&&object(store().doc)&&typeof store().saveSection==="function"&&!store().localSaveFailed;}catch{return false;}}
  function blocked(){
    try{return !!(sync.busy||priceRefreshBusy||sync.blocked||store()?.status?.busy||store()?.status?.choice||store()?.priceRefreshing);}catch{return true;}
  }
  function absorb(){if(typeof absorbPlanner==="function")absorbPlanner();store()?.absorbLocal?.();}
  const selection=(plannerOnly=false)=>({trades:Object.fromEntries(picks),groups:plannerOnly||!writable()?{allocation:false,trades:false}:{}});
  function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;}
  function field(path){
    const last=path.at(-1);
    if(path.includes("holdings")&&last==="shares")return "보유 수량";
    if(path.includes("prices")&&typeof last==="number")return `${last+1}차 기준가`;
    if(path.includes("fullSell")&&last==="price")return "전액매도 기준가";
    if(path.includes("execution")&&last==="price")return "실제 ETF 가격";
    return fieldNames[last]||"기록 값";
  }
  function changeRow(change){
    const row=node("div","split-change"),values=node("span","split-values");
    values.append(node("span","split-before",format.format(Number(change.before))),node("span","split-arrow","→"),node("strong","",format.format(change.after)));
    row.append(node("span","",field(change.path)),values);return row;
  }
  // 표시 그룹은 분할매도·재매수·자산 배분·분할매수로 나누되 선택은 계산 모듈의 원래 항목·체결 key를 유지한다.
  // 같은 key의 플래너 체결과 자산 반영 체크를 함께 바꾼다. 사용자 글자는 DOM textContent로만 넣는다.
  function renderPreview(){
    const groups=new Map([ ["plans",{label:"분할매도 계획",rows:[]}],["rebuy",{label:"재매수",rows:[]}],["allocation",{label:"자산 배분",rows:[]}],["purchases",{label:"분할매수",rows:[]}] ]);
    for(const item of shown.items){
      const sections=item.group==="allocation"?[false,true]:[false];
      for(const purchase of sections){
        const belongs=path=>item.group!=="allocation"||path.includes("buyPlan")===purchase;
        const changes=item.changes.filter(c=>belongs(c.path)),skipped=item.skipped.filter(s=>belongs(s.path)),trades=item.trades.map(t=>({...t,changes:t.changes.filter(c=>belongs(c.path))})).filter(t=>t.changes.length);
        if(!changes.length&&!skipped.length&&!trades.length)continue;
        const group=groups.get(purchase?"purchases":item.group==="trades"?"allocation":item.group);
        if(!group)continue;
        const card=node("div","split-item"),disabled=item.document==="assets"&&!writable();
        if(disabled)card.classList.add("split-unavailable");
        card.append(node("strong","split-item-title",item.label));
        changes.forEach(c=>card.append(changeRow(c)));
        skipped.forEach(s=>card.append(node("p","split-skipped",`${field(s.path)} · ${s.reason} — 변경 안 함`)));
        for(const t of trades){
          if(!picks.has(t.key))picks.set(t.key,true);
          const box=node("div","split-trade"),label=node("label","split-trade-label"),input=node("input");
          input.type="checkbox";input.dataset.splitTrade=t.key;input.disabled=disabled;input.checked=!disabled&&picks.get(t.key)!==false;
          label.append(input,node("span","",/^NaN/.test(t.label)?"매도 체결":t.label));box.append(label);
          t.changes.forEach(c=>box.append(changeRow(c)));
          input.onchange=()=>{
            picks.set(t.key,input.checked);
            byId("splitGroups").querySelectorAll("[data-split-trade]").forEach(other=>{if(other.dataset.splitTrade===t.key){other.checked=!other.disabled&&input.checked;other.closest(".split-trade").classList.toggle("split-unselected",!other.checked);}});
            updateStatus();
          };
          if(!input.checked)box.classList.add("split-unselected");card.append(box);
        }
        group.rows.push(card);
      }
    }
    const nodes=[];
    for(const group of groups.values())if(group.rows.length){const section=node("section","split-group");section.append(node("h3","",group.label),...group.rows);nodes.push(section);}
    if(!nodes.length)nodes.push(node("p","split-empty","이 종목에서 바뀔 기록이 없습니다."));
    byId("splitGroups").replaceChildren(...nodes);
    byId("splitSubject").textContent=`${shown.ticker} · ${shown.from} → ${shown.to}`;
    byId("splitDay").textContent=`적용일 ${shown.exDate}`;
    byId("splitDuplicate").hidden=!shown.duplicate;
  }
  function message(text,good=false){byId("splitFeedback").textContent=text;byId("splitFeedback").className=`split-feedback${good?" good":""}`;}
  function updateStatus(){
    if(!ready||!byId("splitDialog").open)return;
    const busy=blocked();byId("splitBusy").textContent=busy?"동기화·시세 갱신 또는 기록 차이 확인이 끝난 뒤 반영할 수 있습니다.":"";
    byId("splitAssetsNotice").textContent=writable()?"":"자산 기록을 저장할 수 없는 상태입니다. 플래너 기록만 반영하며 자산 기록은 변경하지 않습니다.";
    byId("splitAssetsBackup").disabled=!readable();
    const apply=byId("splitApply");apply.disabled=true;
    byId("splitPreviewBtn").disabled=busy||applying;byId("splitClose").disabled=applying;
    if(applying){byId("splitCount").textContent="반영 중…";return;}
    if(appliedCount!==null){byId("splitCount").textContent=`${appliedCount}칸 반영 완료`;return;}
    if(!shown){byId("splitCount").textContent="미리보기 후 반영할 수 있습니다";return;}
    try{
      const result=applySplit(state,assets(),shown,selection()),count=result.changedFields;
      byId("splitCount").textContent=count?`선택한 ${count}칸 변경`:"바뀔 칸이 없습니다";
      apply.disabled=busy||count===0||shown.duplicate&&!byId("splitDuplicateConfirm").checked;
    }catch{byId("splitCount").textContent="미리보기를 다시 확인하세요";message("미리보기 이후 기록이 바뀌었습니다. 조건 수정에서 미리보기를 다시 확인하세요.");}
  }
  function edit(){shown=null;appliedCount=null;picks.clear();byId("splitInputs").hidden=false;byId("splitPreviewSection").hidden=true;byId("splitDuplicateConfirm").checked=false;message("");updateStatus();}
  function preview(){
    if(blocked()||applying)return;
    try{
      absorb();
      shown=splitPreview(state,assets(),{ticker:byId("splitTicker").value,from:Number(byId("splitFrom").value),to:Number(byId("splitTo").value),exDate:byId("splitDate").value});
      picks.clear();appliedCount=null;byId("splitDuplicateConfirm").checked=false;message("");renderPreview();
      byId("splitInputs").hidden=true;byId("splitPreviewSection").hidden=false;
      if(shown.excluded)message("비트코인·코스피200은 액면분할 반영 대상이 아닙니다.");
    }catch(error){shown=null;message(error.message);}
    updateStatus();
  }
  // 자산 구역 교체는 saveSection의 원자 저장으로 먼저 확인한 뒤 실제 성공 플래그를 이력에 넣어 save(next)한다.
  // 자산 저장 실패는 플래너만 선택해 다시 계산한다. 플래너 저장 실패는 먼저 저장한 자산 구역을 되돌린다.
  // 두 저장은 동기적으로 끝나므로 기존 1.5초 동기화 예약은 최종 기록만 읽는다. 실패하거나 0건이면 이력을 만들지 않는다.
  function apply(){
    if(!shown||applying||blocked()||shown.duplicate&&!byId("splitDuplicateConfirm").checked)return;
    applying=true;let assetsSaved=false,committed=false,oldAllocation,oldAssets,before,notice="";
    try{
      absorb();before=state;oldAssets=assets();
      let result=applySplit(before,oldAssets,shown,selection());if(!result.changedFields)return;
      const entry={id:id(),ticker:shown.ticker,from:shown.from,to:shown.to,exDate:shown.exDate,appliedAt:new Date().toISOString(),planner:result.plannerChanged,assets:result.assetsChanged};
      externalData.planner(appendSplitLog(result.plannerData,entry));
      if(result.assetsChanged){
        oldAllocation=copy(oldAssets.allocation);
        try{externalData.assets(result.assetsDoc);assetsSaved=store().saveSection("allocation",result.assetsDoc.allocation)===true;}catch{assetsSaved=false;}
        if(!assetsSaved){result=applySplit(before,oldAssets,shown,selection(true));notice="자산 기록을 저장하지 못해 플래너 기록만 반영했습니다. 자산 기록은 변경하지 않았습니다.";}
      }else if(!writable())notice="자산 기록을 저장할 수 없어 플래너 기록만 반영했습니다. 자산 기록은 변경하지 않았습니다.";
      if(!result.changedFields){shown=null;message("자산 기록을 저장하지 못해 반영하지 않았습니다. 기록은 변경하지 않았습니다.");return;}
      const next=appendSplitLog(result.plannerData,{...entry,planner:result.plannerChanged,assets:assetsSaved});externalData.planner(next);
      if(save(next)!==true)throw Error("플래너 기록을 이 기기에 저장하지 못해 반영하지 않았습니다. 저장 공간을 확인하세요.");
      committed=true;
      appliedCount=result.changedFields;shown=null;
      message(`${appliedCount}칸을 반영하고 이력을 저장했습니다.${notice?` ${notice}`:""}`,true);
      render();
    }catch(error){
      if(committed)message(`${appliedCount}칸을 저장했습니다. 화면을 다시 열어 반영 결과를 확인하세요.`,true);
      else{
        let rolledBack=true;if(assetsSaved){try{rolledBack=store().saveSection("allocation",oldAllocation)===true;}catch{rolledBack=false;}}
        message(rolledBack?error.message:"플래너 저장과 자산 기록 되돌리기에 실패했습니다. JSON 백업을 내려받고 기록을 확인하세요.");
      }
    }finally{applying=false;updateStatus();}
  }
  function open(ticker=""){
    for(const key of ["syncDialog","planDialog","rebuyDialog"])if(byId(key).open)byId(key).close();
    byId("splitTicker").value=planTicker(ticker);byId("splitFrom").value="1";byId("splitTo").value="3";
    const today=new Date();byId("splitDate").value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    edit();byId("splitDialog").showModal();updateStatus();
  }
  function initialize(){
    if(ready)return;ready=true;
    byId("syncSplitOpen").onclick=()=>open();
    byId("planSplitOpen").onclick=()=>open(byId("planForm").elements.ticker.value);
    byId("rebuySplitOpen").onclick=()=>open(byId("rebuyForm").elements.ticker.value);
    byId("splitForm").onsubmit=event=>{event.preventDefault();preview();};
    byId("splitClose").onclick=()=>byId("splitDialog").close();byId("splitEdit").onclick=edit;
    byId("splitApply").onclick=apply;byId("splitDuplicateConfirm").onchange=updateStatus;
    byId("splitPlannerBackup").onclick=()=>byId("exportBtn").click();byId("splitAssetsBackup").onclick=()=>byId("purchaseExport").click();
    byId("splitDialog").addEventListener("cancel",event=>{if(applying)event.preventDefault();});
    store()?.subscribe(()=>{if(!applying)updateStatus();});
  }
  return {initialize,open,updateStatus};
})();
