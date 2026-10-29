// 자산 현황 › 저축 계획 탭. 공통 도구·render·saveSection은 assets.js, 계산은 assets-calc.js.
function savingsMilestoneHtml(record){
  const n=ymNum(record?.ym);if(n===null)return "";
  const age=finite(record.age);return `${Math.floor(n/12)}.${String(n%12+1).padStart(2,"0")}${age!==null?` <span class="savings-milestone-age">· ${age}세</span>`:""}`;
}
function savingsCompactWon(value){return eok(value).replace(/만원$/,"만 원").replace(/억원$/,"억 원");}
const savingsIcon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
let savingsTab="assumptions"; // 화면 선택만 유지하며 저축 기록에는 저장하지 않는다.
const savingsOpenDetails=new Set();
const KEY_AGES = [35,40,45,50,60,70,80,90];
let savingsAllYears = false; // 모든 연도를 표시하는지(화면 상태, 저장 안 함)
let savingsCurrentYear = new Date().getFullYear();
// 현재 연도만 기본 펼침. 수동 상태는 메모리에만 유지하고 새로고침·연도 변경 때 초기화한다.
const savingsOpenYears = new Set([savingsCurrentYear]);
function syncSavingsCurrentYear(){
  const year=new Date().getFullYear();
  if(year!==savingsCurrentYear){savingsCurrentYear=year;savingsOpenYears.clear();savingsOpenYears.add(year);}
  return year;
}
// 열린 화면에서도 해가 바뀌면 갱신한다. 입력 중이면 기존 redrawIdle로 다시 그리기를 미룬다.
function refreshSavingsCurrentYear(){if(ui.tab==="savings"&&new Date().getFullYear()!==savingsCurrentYear)redrawIdle();}
setInterval(refreshSavingsCurrentYear,60000);
addEventListener("focus",refreshSavingsCurrentYear);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshSavingsCurrentYear();});
let savingsAssumptionsOpen = false; // 가정창은 기본 접기. 화면을 다시 그려도 접힘을 유지하며 설정·저장 기록은 바꾸지 않는다.
// 빈 입력칸에만 쓰는 적용값. 계산과 같은 조회 함수를 사용하고, 입력값·저장 필드는 채우지 않는다.
function savingsStageApplied(sv,sc,st){
  const stageAge=finite(st.age);if(stageAge===null)return null;
  const months=(sv.actual||[]).filter(a=>finite(a.total)!==null).map(a=>ymNum(a.ym)).filter(n=>n!==null);
  const startYear=finite(sv.startYear)??(months.length?Math.floor(Math.min(...months)/12):new Date().getFullYear()), startAge=finite(sv.startAge)??0;
  const year=Math.ceil(startYear+stageAge-startAge), age=startAge+year-startYear;
  return {...savingsStage(sc,age),spending:savingsSpending(sc,startYear,startAge,months.length?Math.floor(Math.max(...months)/12):startYear)(year)};
}
function renderSavings(){
  const currentYear=syncSavingsCurrentYear();
  const S=doc.savings, view=el("savingsView");
  if(!S){ view.innerHTML=emptyCard("저축 계획 기록이 없습니다","데이터 저장소에 etf-planner-assets.json이 있으면 동기화할 때 불러옵니다.",`<button class="btn primary" id="startSavings" type="button">새로 시작</button>`);
    el("startSavings").onclick=()=>{ const y=new Date().getFullYear(); doc.savings={savedAt:"",startYear:y,startAge:30,actual:[],scenarios:[{id:newId(),name:"기본",salary:0,giving:0,spending:0,spendingYear:y,growth:2,returnRate:5,endAge:60,stages:[]}]}; saveSection("savings"); render(); }; return; }
  const sc=S.scenarios.find(x=>x.id===ui.scenario)||S.scenarios[0], sim=sc?simulateSavings(S,sc):null;
  if(ui.scenario&&!S.scenarios.some(x=>x.id===ui.scenario))setUi({scenario:sc?.id??null});
  const field=(key,label,unit,attrs="")=>`<label class="field"><span>${label}</span><span class="unit-input"><input data-param="${key}" ${unit==="원"?moneyAttrs:key==="growth"||key==="returnRate"?signedNumAttrs:'type="number" step="any" inputmode="decimal"'} value="${unit==="원"?moneyText(sc[key]):escA(sc[key]??"")}" ${attrs}><em>${unit}</em></span>${unit==="원"&&finite(sc[key])?`<small class="field-hint">${eok(sc[key])}</small>`:""}</label>`;
  const stageRow=(st,i)=>{
    const applied=savingsStageApplied(S,sc,st);
    const input=(key,label,money=false)=>{
      const value=applied?.[key], hint=value===null||value===undefined?"—":money?nf0.format(Math.round(value)):assetNumberText(value);
      const detail=finite(st[key])===null&&applied?` title="적용값: ${escA(assetNumberText(value))}${money?"원":"%"}"`:"";
      return `<label><span>${label}</span><input data-stage="${i}" data-k="${key}" ${money?moneyAttrs:signedNumAttrs} value="${money?moneyText(st[key]):escA(st[key]??"")}" placeholder="${escA(hint)}"${detail}></label>`;
    };
    return `<div class="plan-line"><label><span>나이</span><input data-stage="${i}" data-k="age" type="number" step="1" value="${escA(st.age??"")}"></label>${input("salary","월급 (원)",true)}${input("spending","사용금액 (원)",true)}${input("growth","증가율 (%)")}${input("returnRate","수익률 (%)")}<button class="remove" type="button" data-stage-del="${i}" aria-label="단계 삭제">삭제</button></div>`;
  };
  const maxAge=Math.max(...S.scenarios.map(x=>finite(x.endAge)||0)), ages=KEY_AGES.filter(a=>a<=maxAge&&a>=(finite(S.startAge)||0));
  const compare=S.scenarios.map(x=>{const r=simulateSavings(S,x);return `<tr${x===sc?' class="active"':""}><th scope="row">${escA(x.name)}</th>${ages.map(a=>`<td>${r&&a<=(finite(x.endAge)||0)?wonA(r.at(a)):"—"}</td>`).join("")}</tr>`;}).join("");
  const actual=[...S.actual].filter(a=>ymNum(a.ym)!==null).sort((a,b)=>String(a.ym).localeCompare(String(b.ym))), actualByMonth=new Map(actual.map(a=>[a.ym,a]));
  const actualYears=[...new Set(actual.map(a=>Math.floor(ymNum(a.ym)/12)))], missing=missingActual(S);
  const startYear=finite(S.startYear)??new Date().getFullYear(), startAge=finite(S.startAge)??0;
  const firstYear=Math.min(startYear,...actualYears), lastYear=Math.max(startYear,startYear+Math.round((finite(sc?.endAge)??startAge)-startAge),...actualYears), simulated=new Map((sim?.rows||[]).map(r=>[r.year,r]));
  const yearData=Array.from({length:lastYear-firstYear+1},(_,i)=>{
    const year=firstYear+i, records=actual.filter(a=>Math.floor(ymNum(a.ym)/12)===year&&finite(a.total)!==null), last=records[records.length-1];
    return {...(simulated.get(year)||{year,age:startAge+year-startYear,actual:!!last,end:last?.total??null,endYm:last?.ym}),recordCount:records.length};
  });
  const shownRows=yearData.filter((r,i)=>savingsAllYears||r.year===currentYear||r.recordCount||savingsOpenYears.has(r.year)||i<10||i===yearData.length-1||r.age%5===0);
  const yearRows=shownRows.map(r=>{
    const open=savingsOpenYears.has(r.year), predicted=simulated.has(r.year)&&!r.actual, hintId=`savings-year-hint-${r.year}`;
    const months=Array.from({length:12},(_,i)=>{const ym=ymText(r.year*12+i), a=actualByMonth.get(ym);return `<label class="field savings-month"><span>${i+1}월 <small>${finite(a?.total)!==null?"실제":"미기록"}</small></span><input data-actual="${ym}" ${moneyAttrs} value="${moneyText(a?.total)}" placeholder="저축총액 (원)" aria-label="${r.year}년 ${i+1}월 실제 저축총액 (원)" aria-describedby="${hintId}">${finite(a?.total)!==null?`<small class="field-hint">${eok(a.total)}</small>`:""}</label>`;}).join("");
    const totals=predicted?`<div class="savings-year-totals">${[["월급",r.salary],["사용금액",r.spending],["월급 기부",r.salaryGiving],["투자수익 기부",r.returnGiving]].map(([label,value])=>`<div><span>${label}</span><b>${wonA(value)}</b></div>`).join("")}</div>`:"";
    const giving=`<span class="savings-year-giving"><small class="savings-column-label">기부금</small><b>${predicted?wonA(r.giving):"—"}</b></span>`;
    const results=`<span class="savings-year-return"><small class="savings-column-label">투자수익</small><b>${predicted?wonA(r.returns+r.returnGiving):"—"}</b></span>${giving}`;
    const balanceNote=predicted?`예상 12월${r.recordCount?` · 실제 ${r.recordCount}개월`:""}`:r.actual?`실제 ${Number(r.endYm.slice(5))}월 · ${r.recordCount}개월`:"기록 없음";
    const gaps=missing.filter(ym=>ym.startsWith(`${r.year}-`));
    return `<section class="savings-year${r.year===currentYear?" savings-year-current":""}"><button class="savings-year-toggle" type="button" data-savings-year="${r.year}" aria-expanded="${open}" aria-controls="savings-year-${r.year}" aria-label="${r.year}년 월별 저축 기록">
      <span class="savings-year-label"><span class="savings-year-title"><b>${r.year}년</b><small class="savings-year-age">${r.age}세</small></span></span>
      <span class="savings-year-balance"><b title="${balanceNote}">${r.end!==null?wonA(r.end):"—"}</b></span>${results}</button>
      <div class="savings-year-body" id="savings-year-${r.year}"${open?"":" hidden"}><div class="savings-year-results">${giving}</div>${totals}<div class="savings-record-heading"><h3>월별 실제 저축총액</h3><span>원 단위 · 입력 후 자동 저장</span></div>
        <p class="hint" id="${hintId}">빈칸은 미기록이며, 입력한 값을 비우면 그 달 기록이 삭제됩니다.${predicted&&r.recordCount?" 수익·기부·지출은 마지막 실제 기록 다음 달부터의 예상입니다.":!predicted&&r.actual?" 실제 기록 기간의 수익·기부·지출은 추정하지 않습니다.":""}</p>
        ${gaps.length?`<p class="hint missing-note">기록 사이에 빠진 달: ${gaps.map(ym=>`${Number(ym.slice(5))}월`).join(", ")}</p>`:""}<div class="savings-month-grid">${months}</div></div></section>`;
  }).join("");
  const endRow=sim?.rows[sim.rows.length-1], milestone=savingsMilestone(sim), best=earlierSavingsRecord(S.milestoneRecord);
  const canSave=milestone&&(!best||ymNum(milestone.ym)<ymNum(best.ym));
  const progress=sim?sim.last.total/5e8*100:null, fill=progress===null?0:Math.max(0,Math.min(100,progress));
  const percent=progress===null?"—":`${nf1.format(progress)}%`, activeTab=sc?savingsTab:"records";
  const tabs=[["overview","Overview","개요"],["assumptions","Assumptions","가정"],["records","Records","기록"]];
  const setting=(key,label,icon)=>`<button class="savings-setting" type="button" data-savings-setting="${key}">${savingsIcon(icon)}<span>${label}</span><small>설정</small><i aria-hidden="true"></i></button>`;
  view.innerHTML=`<div class="savings-heading"><h1>저축 계획</h1></div>
    <section class="card savings-summary" aria-label="저축 요약">
      <div class="savings-summary-head">${sc?`<select id="savingsScenarioSelect" aria-label="저축 시나리오">${S.scenarios.map(x=>`<option value="${escA(x.id)}"${x===sc?" selected":""}>${escA(x.name)} 계획</option>`).join("")}</select>`:'<span>저축 기록</span>'}<button class="btn icon-btn" id="copyScenario" type="button" aria-label="시나리오 복사" title="시나리오 복사">${savingsIcon('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>')}</button></div>
      <div class="savings-balance"><span>최근 기록 자산</span><strong title="${sim?wonA(sim.last.total):"실제 기록 없음"}">${sim?savingsCompactWon(sim.last.total):"—"}</strong><small>${sim?`${sim.last.ym.replace("-",".")} 실제 기록`:"기록 탭에서 실제 저축액을 입력하세요"}</small></div>
      <div class="savings-goal" role="progressbar" aria-label="목표 5억 진행률" aria-describedby="savingsGoalDescription" aria-valuemin="0" aria-valuemax="100"${progress===null?"":` aria-valuenow="${fill}"`} aria-valuetext="${progress===null?"실제 기록 없음":percent}">
        <span class="savings-goal-fill" style="width:${fill}%" aria-hidden="true"></span><span class="savings-goal-label-group" style="width:${Math.min(fill,50)}%"><b>목표 5억</b><span class="savings-goal-percent">${percent}</span></span>
        <span class="savings-goal-date" title="${milestone?.actual?"실제 월말 기록 · 이미 달성":"현재 시나리오 · 월말 자산 기준"}">${milestone?savingsMilestoneHtml(milestone):sim?"기간 내 미도달":"실제 기록 없음"}</span>
      </div><span class="sr-only" id="savingsGoalDescription">${milestone?`${milestone.actual?"실제 목표 도달":"예상 목표 시점"}: ${savingsMilestoneHtml(milestone)}`:sim?"현재 가정의 예측 기간 내에 목표에 도달하지 않습니다.":"실제 기록을 입력하면 목표 진행률과 예상 시점을 계산합니다."}</span>
    </section>
    <div class="card savings-tabs" role="tablist" aria-label="저축 계획 상세">${tabs.map(([key,id,label])=>`<button type="button" role="tab" id="savingsTab${id}" aria-controls="savingsPane${id}" aria-selected="${activeTab===key}" tabindex="${activeTab===key?0:-1}">${label}</button>`).join("")}</div>
    <section id="savingsPaneOverview" class="savings-pane" role="tabpanel" aria-labelledby="savingsTabOverview"${activeTab==="overview"?"":" hidden"}>
      <div class="section-heading"><h2>시나리오 비교</h2><span>나이별 연말 저축총액</span></div><div class="card table-scroll"><table class="data-table"><thead><tr><th>시나리오</th>${ages.map(a=>`<th>${a}세</th>`).join("")}</tr></thead><tbody>${compare}</tbody></table></div>
    </section>
    <section id="savingsPaneAssumptions" class="savings-pane" role="tabpanel" aria-labelledby="savingsTabAssumptions"${activeTab==="assumptions"?"":" hidden"}>
      ${sc?`<div class="card savings-settings">${setting("salary","매월 월급",'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/>')}${setting("giving","기부·사용금액",'<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6"/>')}${setting("returnRate","연 수익률",'<path d="M3 21h18M5 21V13h4v8M10 21V8h4v13M15 21V3h4v18"/>')}</div>
      <div class="card savings-assumptions-body" id="savingsAssumptionsBody"${savingsAssumptionsOpen?"":" hidden"}>
      <div class="param-grid"><label class="field"><span>시나리오 이름</span><input data-param="name" maxlength="40" value="${escA(sc.name)}"></label><label class="field"><span>시작 연도</span><input data-base="startYear" type="number" step="1" value="${escA(S.startYear??"")}"></label><label class="field"><span>그해 나이</span><input data-base="startAge" type="number" step="1" value="${escA(S.startAge??"")}"></label>${field("salary","월급","원")}${field("giving","기부 (월급·수익의 %)","%")}${field("spending","월 사용금액","원")}${field("spendingYear","사용금액 기준 연도","년",'step="1"')}${field("growth","사용금액 연 증가율","%")}${field("returnRate","연 수익률","%")}${field("endAge","종료 나이","세",'step="1"')}</div>
      <h3 class="sub-title">나이별 변경 <small>그 나이(그해)부터 적용 · 회색은 적용값 · 사용금액은 그해 월 사용금액을 그 값으로 바꿈</small></h3><div class="plan-lines">${(sc.stages||[]).map(stageRow).join("")||`<p class="hint">없음</p>`}</div><button class="btn mini" type="button" id="addStage">＋ 단계</button>
      <label class="field scenario-note"><span>메모</span><textarea data-param="note" maxlength="2000">${escA(sc.note||"")}</textarea></label><button class="btn mini danger" type="button" id="deleteScenario"${!savingsAssumptionsOpen||S.scenarios.length<2?" hidden":""}>시나리오 삭제</button></div>`:""}
    </section>
    <section id="savingsPaneRecords" class="savings-pane" role="tabpanel" aria-labelledby="savingsTabRecords"${activeTab==="records"?"":" hidden"}>
      <div class="section-heading"><h2>연도별 기록</h2><span>연도를 펼쳐 월별 실제 저축액 수정</span></div>
      <div class="card savings-years"><div class="savings-years-head"><span>연도</span><span>저축총액</span><span>투자수익</span><span title="월급 + 투자수익">기부금</span></div>${yearRows}${yearData.length>shownRows.length||savingsAllYears?`<div class="group-foot"><button class="btn mini ghost" type="button" id="toggleYears">${savingsAllYears?"줄여 보기":`모든 연도 보기 (${yearData.length}년)`}</button></div>`:""}</div>
    </section>
    <div class="card savings-details">
      <details data-savings-detail="future"${savingsOpenDetails.has("future")?" open":""}><summary>장기 예상 자산<i aria-hidden="true"></i></summary><div><span>${endRow?`${endRow.age}세 말 · ${endRow.year}.12`:"종료 나이"}</span><strong title="${endRow?wonA(endRow.end):""}">${endRow?savingsCompactWon(endRow.end):"실제 기록 없음"}</strong><small>현재 시나리오의 월말 자산 기준</small></div></details>
      <details data-savings-detail="method"${savingsOpenDetails.has("method")?" open":""}><summary>계산 방식<i aria-hidden="true"></i></summary><p>매달 월급 − 기부 − 사용금액을 더하고, 12월에 전년 12월 저축총액 × 연 수익률(수익의 기부 뺌)을 더합니다. 마지막 실제 기록 다음 달부터 계산합니다.</p></details>
    </div>
    <div class="card savings-milestone-record"><span>과거 최단 기록</span><div><b>${best?savingsMilestoneHtml(best):"저장된 기록 없음"}</b><small>이전 계산 결과</small></div>${canSave?'<button class="btn mini" id="saveSavingsMilestone" type="button">최단 기록 저장</button>':""}</div>
    ${sc?`<button class="btn savings-edit" type="button" id="toggleSavingsAssumptions" aria-controls="savingsAssumptionsBody" aria-expanded="${savingsAssumptionsOpen}"><span data-savings-assumptions-action>${savingsAssumptionsOpen?"가정 접기":"가정 수정하기"}</span></button>`:""}`;
  const select=el("savingsScenarioSelect");if(sc)select.onchange=()=>{setUi({scenario:select.value});renderSavings();};
  const showTab=(key,focus=false)=>{
    savingsTab=key;
    tabs.forEach(([name,id])=>{const button=el(`savingsTab${id}`),active=name===key;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;el(`savingsPane${id}`).hidden=!active;if(active&&focus)button.focus();});
  };
  tabs.forEach(([key,id],index)=>{
    const button=el(`savingsTab${id}`), editing=()=>document.activeElement?.matches?.("#savingsView input,#savingsView textarea");
    // 입력의 change가 화면을 다시 그리기 전에 탭 선택을 확정해 첫 터치를 잃지 않는다.
    button.onpointerdown=e=>{if(e.button===0&&editing())e.preventDefault();};
    button.onclick=()=>{savingsTab=key;if(editing())document.activeElement.blur();showTab(key,true);};
    button.onkeydown=e=>{let next;if(e.key==="ArrowRight")next=(index+1)%tabs.length;else if(e.key==="ArrowLeft")next=(index+tabs.length-1)%tabs.length;else if(e.key==="Home")next=0;else if(e.key==="End")next=tabs.length-1;else return;e.preventDefault();showTab(tabs[next][0],true);};
  });
  all("[data-savings-detail]").forEach(detail=>detail.ontoggle=()=>{if(detail.open)savingsOpenDetails.add(detail.dataset.savingsDetail);else savingsOpenDetails.delete(detail.dataset.savingsDetail);});
  if(el("saveSavingsMilestone"))el("saveSavingsMilestone").onclick=()=>{
    const savings=doc.savings, scenario=savings.scenarios.find(x=>x.id===ui.scenario)||savings.scenarios[0];
    const current=savingsMilestone(simulateSavings(savings,scenario));if(current)assetStore.saveSavingsMilestone(current);renderSavings();
  };
  if(el("toggleYears")) el("toggleYears").onclick=()=>{ savingsAllYears=!savingsAllYears; renderSavings(); };
  all("[data-savings-year]").forEach(b=>b.onclick=()=>{
    const year=Number(b.dataset.savingsYear), open=!savingsOpenYears.has(year);if(open)savingsOpenYears.add(year);else savingsOpenYears.delete(year);
    el(b.getAttribute("aria-controls")).hidden=!open;b.setAttribute("aria-expanded",String(open));
  });
  el("copyScenario").onclick=()=>{ const base=sc||{}; const copy=JSON.parse(JSON.stringify({...base,id:newId(),name:`${base.name||"시나리오"} 복사`})); S.scenarios.push(copy); setUi({scenario:copy.id}); saveSection("savings"); render(); };
  onChange("[data-base]","savings",(v,x)=>{ const n=numIn(v); if(n===null) return false; S[x.dataset.base]=Math.round(n); });
  onChange("[data-actual]","savings",(v,x)=>setSavingsActual(S,x.dataset.actual,v));
  if(!sc) return;
  const showAssumptions=open=>{
    savingsAssumptionsOpen=open;showTab("assumptions");
    const button=el("toggleSavingsAssumptions"), action=open?"가정 접기":"가정 수정하기";
    el("savingsAssumptionsBody").hidden=!open;button.setAttribute("aria-expanded",String(open));button.querySelector("[data-savings-assumptions-action]").textContent=action;
    el("deleteScenario").hidden=!open||S.scenarios.length<2;
  };
  el("toggleSavingsAssumptions").onclick=()=>{
    showAssumptions(!savingsAssumptionsOpen);
    if(savingsAssumptionsOpen)el("savingsAssumptionsBody").scrollIntoView?.({block:"start",behavior:"instant"});
  };
  all("[data-savings-setting]").forEach(button=>button.onclick=()=>{showAssumptions(true);const input=view.querySelector(`[data-param="${button.dataset.savingsSetting}"]`);input?.focus();});
  onChange("[data-param]","savings",(v,x)=>{ const k=x.dataset.param; if(k==="name"){ sc.name=v.trim()||sc.name; return; } if(k==="note"){ setText(sc,"note",v); return; }
    const n=numIn(v); if(n===null) return false; sc[k]=["spendingYear","endAge"].includes(k)?Math.round(n):n; });
  onChange("[data-stage]","savings",(v,x)=>{ const st=sc.stages[Number(x.dataset.stage)]; if(x.dataset.k==="age"&&numIn(v)===null) return false; setNum(st,x.dataset.k,v); sc.stages.sort((a,b)=>a.age-b.age); });
  all("[data-stage-del]").forEach(b=>b.onclick=()=>{ sc.stages.splice(Number(b.dataset.stageDel),1); saveSection("savings"); render(); });
  el("addStage").onclick=()=>{ sc.stages=sc.stages||[]; const last=sc.stages[sc.stages.length-1]; sc.stages.push({age:(finite(last?.age)??(finite(S.startAge)||30))+5}); saveSection("savings"); render(); };
  el("deleteScenario").onclick=()=>{ if(!confirm(`'${sc.name}' 시나리오를 삭제할까요?`)) return; S.scenarios=S.scenarios.filter(x=>x!==sc); setUi({scenario:S.scenarios[0]?.id||null}); saveSection("savings"); render(); };
}
