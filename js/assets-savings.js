// 자산 현황 › 저축 계획 탭. 공통 도구·render·saveSection은 assets.js, 계산은 assets-calc.js.
function savingsMilestoneHtml(record){
  const n=ymNum(record?.ym);if(n===null)return "";
  const age=finite(record.age);return `${Math.floor(n/12)}.${String(n%12+1).padStart(2,"0")}${age!==null?` <span class="savings-milestone-age">· ${age}세</span>`:""}`;
}
function savingsCompactWon(value){return eok(value).replace(/만원$/,"만 원").replace(/억원$/,"억 원");}
const savingsIcon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
let savingsTab=null; // 처음 열 때 실제 기록 유무로 선택하고, 이후 선택은 메모리에만 유지한다.
const savingsOpenDetails=new Set();
const KEY_AGES = [35,40,45,50,60,70,80,90];
let savingsAllYears = false; // 모든 연도를 표시하는지(화면 상태, 저장 안 함)
let savingsPastOpen = false; // 지난 연도 묶음은 메모리에만 유지한다.
let savingsCurrentYear = new Date().getFullYear();
// 현재 연도만 기본 펼침. 수동 상태는 메모리에만 유지하고 새로고침·연도 변경 때 초기화한다.
const savingsOpenYears = new Set([savingsCurrentYear]);
function syncSavingsCurrentYear(){
  const year=new Date().getFullYear();
  if(year!==savingsCurrentYear){savingsCurrentYear=year;savingsPastOpen=false;savingsOpenYears.clear();savingsOpenYears.add(year);}
  return year;
}
// 열린 화면에서도 해가 바뀌면 갱신한다. 입력 중이면 기존 redrawIdle로 다시 그리기를 미룬다.
function refreshSavingsCurrentYear(){if(ui.tab==="savings"&&new Date().getFullYear()!==savingsCurrentYear)redrawIdle();}
setInterval(refreshSavingsCurrentYear,60000);
addEventListener("focus",refreshSavingsCurrentYear);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshSavingsCurrentYear();});
function savingsSpendingContext(sv){
  const months=(sv.actual||[]).filter(a=>finite(a.total)!==null).map(a=>ymNum(a.ym)).filter(n=>n!==null);
  const startYear=finite(sv.startYear)??(months.length?Math.floor(Math.min(...months)/12):new Date().getFullYear()), startAge=finite(sv.startAge)??0;
  return {startYear,startAge,lastYear:months.length?Math.floor(Math.max(...months)/12):startYear};
}
// 빈 단계 칸의 적용값과 올해 사용금액은 계산의 조회 함수를 공유하며 저장하지 않는다.
function savingsStageApplied(sv,sc,st){
  const stageAge=finite(st.age);if(stageAge===null)return null;
  const {startYear,startAge,lastYear}=savingsSpendingContext(sv);
  const year=Math.ceil(startYear+stageAge-startAge), age=startAge+year-startYear;
  return {...savingsStage(sc,age),spending:savingsSpending(sc,startYear,startAge,lastYear)(year)};
}
function savingsCurrentSpending(sv,sc,year=savingsCurrentYear){
  const {startYear,startAge,lastYear}=savingsSpendingContext(sv),age=startAge+year-startYear;
  const readOnly=year>=(finite(sc.spendingYear)??lastYear)&&(sc.stages||[]).some(st=>finite(st.age)===age&&finite(st.spending)!==null);
  return {year,age,readOnly,value:Math.round(savingsSpending(sc,startYear,startAge,lastYear)(year))};
}
let savingsInputSaving=false;
let savingsStageViews=[]; // 화면 위치와 별개인 단계 객체 연결. 저장 데이터에는 넣지 않는다.
function savingsYearHtml(r,{simulated,actualByMonth,missing,currentYear}){
    const open=savingsOpenYears.has(r.year), predicted=simulated.has(r.year)&&!r.actual, hintId=`savings-year-hint-${r.year}`;
    // 본문은 정확한 원 금액, 요약 행은 한 줄 축약 금액을 표시한다.
    const compact=value=>savingsCompactWon(value).replace(/ 원$/,"\u00a0원");
    const months=Array.from({length:12},(_,i)=>{const ym=ymText(r.year*12+i), a=actualByMonth.get(ym);return `<label class="field savings-month"><span>${i+1}월 <small data-savings-result="month-status-${ym}">${finite(a?.total)!==null?"실제":"미기록"}</small></span><input data-actual="${ym}" ${moneyAttrs} value="${moneyText(a?.total)}" placeholder="저축총액 (원)" aria-label="${r.year}년 ${i+1}월 실제 저축총액 (원)" aria-describedby="${hintId}"><small class="field-hint" data-savings-result="month-hint-${ym}"${finite(a?.total)!==null?"":" hidden"}>${finite(a?.total)!==null?eok(a.total):""}</small></label>`;}).join("");
    const totals=`<div class="savings-year-totals" data-savings-result="year-totals-${r.year}"${predicted?"":" hidden"}>${[["월급",r.salary],["사용금액",r.spending],["월급 기부",r.salaryGiving],["투자수익 기부",r.returnGiving]].map(([label,value])=>`<div><span>${label}</span><b>${wonA(value)}</b></div>`).join("")}</div>`;
    const giving=(summary=false)=>`<span class="savings-year-giving"><small class="savings-column-label">기부금</small><b>${predicted?(summary?compact(r.giving):wonA(r.giving)):"—"}</b></span>`;
    const results=`<span class="savings-year-return"><small class="savings-column-label">투자수익</small><b>${predicted?compact(r.returns+r.returnGiving):"—"}</b></span>${giving(true)}`;
    const balanceNote=predicted?(r.recordCount?`실제 ${r.recordCount}개월 + 예상`:"예상 · 12월"):r.actual?`실제 · ${Number(r.endYm.slice(5))}월까지`:"기록 없음";
    const balance=r.end!==null?wonA(r.end):"—", yearLabel=`${r.year}년 · ${r.age}세 · 연말 저축총액 ${balance} · ${balanceNote}`;
    const gaps=missing.filter(ym=>ym.startsWith(`${r.year}-`));
    return `<section class="savings-year${r.year===currentYear?" savings-year-current":""}"><button class="savings-year-toggle${predicted?" savings-year-predicted":""}" type="button" data-savings-year="${r.year}" data-savings-result="year-head-${r.year}" aria-expanded="${open}" aria-controls="savings-year-${r.year}" aria-label="${yearLabel} · 월별 기록 ${open?"접기":"펼치기"}">
      <span class="savings-year-label"><span class="savings-year-title"><b>${r.year}년</b><small class="savings-year-age">${r.age}세</small></span></span>
      <span class="savings-year-balance"><b>${r.end!==null?compact(r.end):"—"}</b></span>${results}</button>
      <div class="savings-year-body" id="savings-year-${r.year}"${open?"":" hidden"}><p class="savings-year-exact" data-savings-result="year-exact-${r.year}"><span>연말 저축총액 <b>${balance}</b></span><span>· ${balanceNote}</span></p><div class="savings-year-results" data-savings-result="year-giving-${r.year}">${giving()}</div>${totals}<div class="savings-record-heading"><h3>월별 실제 저축총액</h3><span>원 단위 · 입력 후 자동 저장</span></div>
        <p class="hint" id="${hintId}" data-savings-result="year-hint-${r.year}">빈칸은 미기록이며, 입력한 값을 비우면 그 달 기록이 삭제됩니다.${predicted&&r.recordCount?" 수익·기부·지출은 마지막 실제 기록 다음 달부터의 예상입니다.":!predicted&&r.actual?" 실제 기록 기간의 수익·기부·지출은 추정하지 않습니다.":""}</p>
        <p class="hint missing-note" data-savings-result="year-gaps-${r.year}"${gaps.length?"":" hidden"}>기록 사이에 빠진 달: ${gaps.map(ym=>`${Number(ym.slice(5))}월`).join(", ")}</p><div class="savings-month-grid">${months}</div></div></section>`;
}
function savingsSummaryHtml({sim,fill,percent,progress,milestone}){
  return `      <div class="savings-balance"><span>최근 기록 자산</span><strong data-savings-result="last-balance" title="${sim?wonA(sim.last.total):"실제 기록 없음"}">${sim?savingsCompactWon(sim.last.total):"—"}</strong><small data-savings-result="last-date"${sim?"":" hidden"}>${sim?`${sim.last.ym.replace("-",".")} 실제 기록`:""}</small><button class="btn mini" id="enterSavingsRecord" type="button" data-savings-result="enter-record"${sim?" hidden":""}>기록 입력</button></div>
      <div data-savings-result="goal" class="savings-goal" role="progressbar" aria-label="목표 5억 진행률" aria-describedby="savingsGoalDescription" aria-valuemin="0" aria-valuemax="100"${progress===null?"":` aria-valuenow="${fill}"`} aria-valuetext="${progress===null?"실제 기록 없음":percent}">
        <span class="savings-goal-fill" style="width:${fill}%" aria-hidden="true"></span><span class="savings-goal-label-group" style="width:${Math.min(fill,50)}%"><b>목표 5억</b><span class="savings-goal-percent">${percent}</span></span>
        <span class="savings-goal-date" title="${milestone?.actual?"실제 월말 기록 · 이미 달성":"현재 시나리오 · 월말 자산 기준"}">${milestone?savingsMilestoneHtml(milestone):sim?"기간 내 미도달":"실제 기록 없음"}</span>
      </div><span class="sr-only" id="savingsGoalDescription" data-savings-result="goal-description">${milestone?`${milestone.actual?"실제 목표 도달":"예상 목표 시점"}: ${savingsMilestoneHtml(milestone)}`:sim?"현재 가정의 예측 기간 내에 목표에 도달하지 않습니다.":"실제 기록을 입력하면 목표 진행률과 예상 시점을 계산합니다."}</span>`;
}
function savingsArrivalHtml(scenarios,sc){
  const current=scenarios.find(x=>x.scenario===sc)?.milestone;
  const reached=scenarios.map(x=>ymNum(x.milestone?.ym)).filter(n=>n!==null),fastest=reached.length?Math.min(...reached):null;
  return scenarios.map(({scenario,sim,milestone},i)=>{
    const month=ymNum(milestone?.ym),delta=current&&month!==null?month-ymNum(current.ym):null;
    const diff=scenario!==sc&&delta!==null?(delta===0?"같은 시점":`${Math.floor(Math.abs(delta)/12)}년 ${Math.abs(delta)%12}개월 ${delta<0?"빠름":"늦음"}`):"";
    const age=finite(milestone?.age),date=milestone?`${milestone.actual?"달성 ":""}${Math.floor(month/12)}.${String(month%12+1).padStart(2,"0")}`:sim?"종료 나이까지 미도달":"실제 기록 없음";
    return `<li><button class="savings-arrival${scenario===sc?" savings-arrival-current":""}" type="button" data-savings-scenario="${escA(scenario.id)}" data-savings-result="arrival-${i}" aria-pressed="${scenario===sc}"><span class="savings-arrival-name" title="${escA(scenario.name)}">${escA(scenario.name)}</span><strong class="savings-arrival-date${milestone?"":" savings-arrival-unreached"}"><span>${date}</span><span class="savings-milestone-age"${age===null?" hidden":""}> · ${age??""}세</span></strong><span class="savings-arrival-meta"><small class="savings-arrival-fastest"${month!==null&&month===fastest?"":" hidden"}>가장 빠름</small><span>${diff}</span></span></button></li>`;
  }).join("");
}
function savingsOverviewHtml({endRow,ages,compare,best,canSave,scenarios,sc}){
  return `      <div class="section-heading"><h2>5억 도달 시점</h2></div><ul class="card savings-arrivals" aria-label="시나리오별 5억 도달 시점">${savingsArrivalHtml(scenarios,sc)}</ul>
      <div class="section-heading"><h2>시나리오 비교</h2><span>나이별 연말 저축총액</span></div><div class="card savings-compare"><div class="table-scroll" tabindex="0" role="region" aria-label="시나리오별 나이별 연말 저축총액" data-savings-result="compare"><table class="data-table"><thead><tr><th scope="col">시나리오</th>${ages.map(a=>`<th scope="col">${a}세</th>`).join("")}</tr></thead><tbody>${compare}</tbody></table></div></div>
      <div class="card savings-future" data-savings-result="future"><h2>장기 예상 자산</h2><span>${endRow?`${endRow.age}세 말 · ${endRow.year}.12`:"종료 나이"}</span><strong title="${endRow?wonA(endRow.end):""}">${endRow?savingsCompactWon(endRow.end):"실제 기록 없음"}</strong><small>현재 시나리오의 월말 자산 기준</small></div>
      <div class="card savings-milestone-record"><h2>목표 도달 최단 기록</h2><div data-savings-result="milestone"><b>${best?savingsMilestoneHtml(best):"저장된 기록 없음"}</b><small>저장된 시점</small></div><button class="btn mini" id="saveSavingsMilestone" type="button" data-savings-result="save-milestone"${canSave?"":" hidden"}>최단 기록 저장</button><p>지금 예상이 저장된 시점보다 빠를 때 저장할 수 있습니다</p></div>`;
}
function savingsMarkup(S,sc,stages){
  const currentYear=savingsCurrentYear,scenarios=S.scenarios.map(scenario=>{const sim=simulateSavings(S,scenario);return {scenario,sim,milestone:savingsMilestone(sim)};}),sim=scenarios.find(x=>x.scenario===sc)?.sim??null;
  const field=(key,label,unit,attrs="")=>`<label class="field"><span>${label}</span><span class="unit-input"><input data-param="${key}" ${unit==="원"?moneyAttrs:key==="growth"||key==="returnRate"?signedNumAttrs:'type="number" step="any" inputmode="decimal"'} value="${unit==="원"?moneyText(sc[key]):escA(sc[key]??"")}" ${attrs}><em>${unit}</em></span>${unit==="원"?`<small class="field-hint" data-savings-result="param-${key}"${finite(sc[key])?"":" hidden"}>${finite(sc[key])?eok(sc[key]):""}</small>`:""}</label>`;
  const spending=sc?savingsCurrentSpending(S,sc):null;
  const spendingField=spending?`<label class="field savings-current-spending"><span data-savings-result="spending-label">월 사용금액 (${currentYear}년)</span><span class="unit-input"><input data-param="spending" ${moneyAttrs} value="${moneyText(spending.value)}"${spending.readOnly?' readonly aria-describedby="savingsSpendingHelp"':""}><em>원</em></span><small class="field-hint" data-savings-result="param-spending"${spending.value?"":" hidden"}>${spending.value?eok(spending.value):""}</small><small class="savings-spending-help" id="savingsSpendingHelp" data-savings-result="spending-help"${spending.readOnly?"":" hidden"}>올해는 ${spending.age}세 단계 사용금액이 적용됩니다</small></label>`:"";
  const stageRow=(st,i)=>{
    const applied=savingsStageApplied(S,sc,st);
    const input=(key,label,money=false)=>{
      const value=applied?.[key], hint=value===null||value===undefined?"—":money?nf0.format(Math.round(value)):moneyInputText(value);
      const detail=finite(st[key])===null&&applied?` title="적용값: ${escA(moneyInputText(value))}${money?"원":"%"}"`:"";
      return `<label><span>${label}</span><input data-stage="${i}" data-k="${key}" ${money?moneyAttrs:signedNumAttrs} value="${money?moneyText(st[key]):escA(st[key]??"")}" placeholder="${escA(hint)}"${detail}></label>`;
    };
    const age=finite(st.age), title=age===null?`${i+1}번째 단계`:`${age}세부터`, remove=age===null?`${i+1}번째 단계 삭제`:`${age}세 단계 삭제`;
    return `<div class="plan-line" role="group" aria-labelledby="savings-stage-${i}"><div class="plan-line-head"><strong id="savings-stage-${i}" data-savings-result="stage-title-${i}">${title}</strong><button class="remove" type="button" data-stage-del="${i}" data-savings-result="stage-delete-${i}" aria-label="${remove}">삭제</button></div><div class="plan-line-fields"><label><span>나이</span><input data-stage="${i}" data-k="age" type="number" step="1" value="${escA(st.age??"")}"></label>${input("salary","월급 (원)",true)}${input("spending","사용금액 (원)",true)}${input("growth","증가율 (%)")}${input("returnRate","수익률 (%)")}</div></div>`;
  };
  const maxAge=Math.max(...S.scenarios.map(x=>finite(x.endAge)||0)), ages=KEY_AGES.filter(a=>a<=maxAge&&a>=(finite(S.startAge)||0));
  const compare=scenarios.map(({scenario:x,sim:r})=>`<tr${x===sc?' class="active"':""}><th scope="row">${escA(x.name)}</th>${ages.map(a=>{
    const value=r&&a<=(finite(x.endAge)||0)?r.at(a):null;
    return value===null?"<td>—</td>":`<td aria-label="${wonA(value)}">${savingsCompactWon(value)}</td>`;
  }).join("")}</tr>`).join("");
  const actual=[...S.actual].filter(a=>ymNum(a.ym)!==null).sort((a,b)=>String(a.ym).localeCompare(String(b.ym))), actualByMonth=new Map(actual.map(a=>[a.ym,a]));
  const actualYears=[...new Set(actual.map(a=>Math.floor(ymNum(a.ym)/12)))], missing=missingActual(S);
  const startYear=finite(S.startYear)??new Date().getFullYear(), startAge=finite(S.startAge)??0;
  const firstYear=Math.min(startYear,...actualYears), lastYear=Math.max(startYear,startYear+Math.round((finite(sc?.endAge)??startAge)-startAge),...actualYears), simulated=new Map((sim?.rows||[]).map(r=>[r.year,r]));
  const yearData=Array.from({length:lastYear-firstYear+1},(_,i)=>{
    const year=firstYear+i, records=actual.filter(a=>Math.floor(ymNum(a.ym)/12)===year&&finite(a.total)!==null), last=records[records.length-1];
    return {...(simulated.get(year)||{year,age:startAge+year-startYear,actual:!!last,end:last?.total??null,endYm:last?.ym}),recordCount:records.length};
  });
  const past=yearData.filter(r=>r.year<currentYear),future=yearData.filter(r=>r.year>currentYear);
  const shownFuture=future.filter((r,i)=>savingsAllYears||r.recordCount||savingsOpenYears.has(r.year)||i<10||i===future.length-1||r.age%5===0);
  const yearRows=yearData.filter(r=>r.year===currentYear||shownFuture.includes(r)).map(r=>savingsYearHtml(r,{simulated,actualByMonth,missing,currentYear})).join("");
  const pastGaps=missing.filter(ym=>Math.floor(ymNum(ym)/12)<currentYear).length,lastPast=past[past.length-1];
  const pastRange=past.length?`${past[0].year}–${lastPast.year} · ${past.length}년`:"";
  const pastSummary=`<span class="savings-past-summary"><span class="savings-past-label"><b>지난 기록</b><span>${pastRange}</span></span><b class="savings-past-balance">${lastPast?.end!==null&&lastPast?.end!==undefined?savingsCompactWon(lastPast.end):"—"}</b></span>`;
  const pastRows=`<div class="savings-past"${past.length?"":" hidden"}><button class="savings-past-toggle" id="toggleSavingsPast" type="button" data-savings-result="past-head" aria-expanded="${savingsPastOpen}" aria-controls="savingsPastYears" aria-label="지난 기록 ${pastRange} · 빠진 달 ${pastGaps} · ${savingsPastOpen?"접기":"펼치기"}">${pastSummary}<span class="savings-past-missing"${pastGaps?"":" hidden"}>빠진 달 ${pastGaps}</span></button><div class="savings-past-years" id="savingsPastYears"${savingsPastOpen?"":" hidden"}>${past.map(r=>savingsYearHtml(r,{simulated,actualByMonth,missing,currentYear})).join("")}</div></div>`;
  const endRow=sim?.rows[sim.rows.length-1], milestone=savingsMilestone(sim), best=earlierSavingsRecord(S.milestoneRecord);
  const canSave=milestone&&(!best||ymNum(milestone.ym)<ymNum(best.ym));
  const progress=sim?sim.last.total/5e8*100:null, fill=progress===null?0:Math.max(0,Math.min(100,progress));
  const percent=progress===null?"—":`${nf1.format(progress)}%`, activeTab=sc?savingsTab:"records";
  const tabs=[["overview","Overview","개요"],["records","Records","기록"],["assumptions","Assumptions","가정"]];
  return `<div class="savings-heading"><h1>저축 계획</h1></div>
    <section class="card savings-summary" aria-label="저축 요약">
      <div class="savings-summary-head">${sc?`<select id="savingsScenarioSelect" data-savings-result="scenario-options" aria-label="저축 시나리오">${S.scenarios.map(x=>`<option value="${escA(x.id)}"${x===sc?" selected":""}>${escA(x.name)} 계획</option>`).join("")}</select>`:'<span>저축 기록</span>'}<button class="btn icon-btn" id="copyScenario" type="button" aria-label="시나리오 복사" title="시나리오 복사">${savingsIcon('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>')}</button></div>
      ${savingsSummaryHtml({sim,fill,percent,progress,milestone})}
    </section>
    <div class="card savings-tabs" role="tablist" aria-label="저축 계획 상세">${tabs.map(([key,id,label])=>`<button type="button" role="tab" id="savingsTab${id}" aria-controls="savingsPane${id}" aria-selected="${activeTab===key}" tabindex="${activeTab===key?0:-1}">${label}</button>`).join("")}</div>
    <section id="savingsPaneOverview" class="savings-pane" role="tabpanel" aria-labelledby="savingsTabOverview"${activeTab==="overview"?"":" hidden"}>
      ${savingsOverviewHtml({endRow,ages,compare,best,canSave,scenarios,sc})}
    </section>
    <section id="savingsPaneAssumptions" class="savings-pane" role="tabpanel" aria-labelledby="savingsTabAssumptions"${activeTab==="assumptions"?"":" hidden"}>
      ${sc?`<div class="card savings-assumptions-body" id="savingsAssumptionsBody">
      <h2 class="savings-group-title">기본</h2><div class="param-grid"><label class="field"><span>시나리오 이름</span><input data-param="name" maxlength="40" value="${escA(sc.name)}"></label><label class="field"><span>시작 연도</span><input data-base="startYear" type="number" step="1" value="${escA(S.startYear??"")}"></label><label class="field"><span>그해 나이</span><input data-base="startAge" type="number" step="1" value="${escA(S.startAge??"")}"></label>${field("endAge","종료 나이","세",'step="1"')}</div>
      <h2 class="savings-group-title">월급·지출</h2><div class="param-grid">${field("salary","월급","원")}${field("giving","기부 (월급·수익의 %)","%")}${spendingField}${field("growth","사용금액 연 증가율","%")}</div>
      <h2 class="savings-group-title">수익</h2><div class="param-grid">${field("returnRate","연 수익률","%")}</div>
      <h3 class="sub-title">나이별 변경</h3><p class="savings-stage-help">그 나이(그해)부터 적용 · 회색은 적용값<br>사용금액은 그해 월 사용금액으로 적용</p><div class="plan-lines">${stages.map(({stage},i)=>stageRow(stage,i)).join("")||`<p class="hint">없음</p>`}</div><button class="btn mini" type="button" id="addStage">＋ 단계</button>
      <label class="field scenario-note"><span>메모</span><textarea data-param="note" maxlength="2000">${escA(sc.note||"")}</textarea></label>
      <div class="savings-details"><details data-savings-detail="method"${savingsOpenDetails.has("method")?" open":""}><summary>계산 방식<i aria-hidden="true"></i></summary><p>매달 월급 − 기부 − 사용금액을 더하고, 12월에 전년 12월 저축총액 × 연 수익률(수익의 기부 뺌)을 더합니다. 마지막 실제 기록 다음 달부터 계산합니다.</p></details></div>
      ${S.scenarios.length>=2?'<button class="btn mini danger" type="button" id="deleteScenario">시나리오 삭제</button>':""}</div>`:""}
    </section>
    <section id="savingsPaneRecords" class="savings-pane" role="tabpanel" aria-labelledby="savingsTabRecords"${activeTab==="records"?"":" hidden"}>
      <div class="section-heading"><h2>연도별 기록</h2><span>흐린 금액은 예상</span></div>
      <div class="card savings-years"><div class="savings-years-head"><span>연도</span><span>연말 저축총액</span><span>투자수익</span><span title="월급 기부 + 투자수익 기부">기부금</span></div>${pastRows}${yearRows}<div class="group-foot"${future.length>shownFuture.length||savingsAllYears?"":" hidden"}><button class="btn mini ghost" type="button" id="toggleYears" data-savings-result="all-years">${savingsAllYears?"줄여 보기":`모든 연도 보기 (${future.length}년)`}</button></div></div>
    </section>`;
}
// 로컬 저장의 change 알림도 renderSavings를 호출한다. 입력 저장 중에만 전체 그리기를 막고,
// 이미 보류 중이던 외부 동기화의 redrawLater는 유지한다.
function savingsOnChange(selector,set,read){
  const bound=doc.savings,scenarioId=(bound.scenarios.find(s=>s.id===ui.scenario)||bound.scenarios[0])?.id;
  all(selector).forEach(x=>x.onchange=()=>{
    if(!x.validity.valid)return;
    // 입력 중 동기화가 문서를 교체했어도 최신 문서의 같은 시나리오·단계에 값을 반영한다.
    if(bound!==doc.savings){
      const sc=doc.savings?.scenarios.find(s=>s.id===scenarioId);if(!sc)return;
      savingsReconnectStages(bound.scenarios.find(s=>s.id===scenarioId)?.stages||[],sc.stages||[]);
      bindSavings(doc.savings,sc);x.onchange();return;
    }
    const changed=set(x.value,x)!==false, value=read(x);
    x.value=x.hasAttribute("data-money")?moneyInputText(value):String(value??"");
    if(changed){
      const scenario=doc.savings.scenarios.find(s=>s.id===ui.scenario)||doc.savings.scenarios[0];
      const before=[...(scenario?.stages||[])], pending=redrawLater;
      savingsInputSaving=true;
      try{saveSection("savings");}finally{savingsInputSaving=false;redrawLater=pending;}
      // saveSection이 복사한 문서의 단계 객체에 다시 연결한다. 정렬 직후의 객체 순서를
      // 기준으로 연결하며, 입력칸의 화면 위치를 저장 배열 인덱스로 쓰지 않는다.
      const saved=doc.savings.scenarios.find(s=>s.id===scenario?.id)?.stages||[];
      savingsReconnectStages(before,saved);
    }
    updateSavingsResults(x);
  });
}
function savingsReconnectStages(before,saved){
  const used=new Set();
  savingsStageViews.forEach(ref=>{
    const index=before.indexOf(ref.stage),same=st=>st&&JSON.stringify(st)===JSON.stringify(ref.stage);
    let stage=same(saved[index])?saved[index]:saved.find(st=>!used.has(st)&&same(st));
    // 외부 갱신으로 단계의 다른 값만 달라졌으면, 양쪽에서 유일한 같은 나이로 연결한다.
    if(!stage&&finite(ref.stage.age)!==null&&before.filter(st=>st.age===ref.stage.age).length===1){
      const matches=saved.filter(st=>!used.has(st)&&st.age===ref.stage.age);if(matches.length===1)stage=matches[0];
    }
    if(stage){ref.stage=stage;used.add(stage);}
  });
}
function updateSavingsResults(changedInput){
  const S=doc.savings,sc=S.scenarios.find(s=>s.id===ui.scenario)||S.scenarios[0],view=el("savingsView");
  const next=document.createElement("div");next.innerHTML=savingsMarkup(S,sc,savingsStageViews);
  // 결과 표시만 바꾼다. 기존 input·textarea·select·button과 그 이벤트 대상은 그대로 둔다.
  for(const source of next.querySelectorAll("[data-savings-result]")){
    const target=view.querySelector(`[data-savings-result="${source.dataset.savingsResult}"]`);if(!target)continue;
    savingsPatchResult(target,source,target.tagName==="BUTTON");
  }
  all("[data-stage]").forEach(x=>{
    const source=next.querySelector(`[data-stage="${x.dataset.stage}"][data-k="${x.dataset.k}"]`);
    for(const key of ["placeholder","title"]){if(source.hasAttribute(key))x.setAttribute(key,source.getAttribute(key));else x.removeAttribute(key);}
  });
  const spending=view.querySelector('[data-param="spending"]'),nextSpending=next.querySelector('[data-param="spending"]');
  if(spending&&nextSpending){
    if(document.activeElement!==spending)spending.value=nextSpending.value;
    for(const key of ["readonly","aria-describedby"]){if(nextSpending.hasAttribute(key))spending.setAttribute(key,nextSpending.getAttribute(key));else spending.removeAttribute(key);}
  }
  // 시작/종료 나이로 연도 범위가 바뀌어도 기존 연도의 입력·버튼은 교체하지 않는다.
  const years=view.querySelector(".savings-years"),shown=new Set();
  const past=years.querySelector(".savings-past"),pastYears=years.querySelector(".savings-past-years");
  past.hidden=next.querySelector(".savings-past").hidden;
  pastYears.hidden=next.querySelector(".savings-past-years").hidden;
  for(const source of next.querySelectorAll("[data-savings-year]")){
    const year=source.dataset.savingsYear;shown.add(year);
    const current=years.querySelector(`[data-savings-year="${year}"]`);
    const list=source.closest(".savings-past-years")?pastYears:years;
    if(current){current.closest("section").hidden=false;if(current.closest("section").parentElement===list)continue;}
    const after=[...list.querySelectorAll("[data-savings-year]")].find(b=>b.closest("section").parentElement===list&&Number(b.dataset.savingsYear)>Number(year));
    list.insertBefore((current||source).closest("section"),after?.closest("section")||(list===years?years.querySelector(".group-foot"):null));
  }
  for(const button of years.querySelectorAll("[data-savings-year]")){
    const row=button.closest("section");
    if(!shown.has(button.dataset.savingsYear)&&!row.contains(changedInput)&&!row.contains(document.activeElement))row.hidden=true;
  }
  years.querySelector(".group-foot").hidden=next.querySelector(".group-foot").hidden;
  bindSavings(S,sc);
}
function savingsPatchResult(target,source,keepChildren=false){
  // 터치 대상은 버튼 안의 b/span일 수도 있다. 그 요소도 남겨 pointerdown 뒤 click이 이어지게 한다.
  if(target.innerHTML!==source.innerHTML){
    if(keepChildren&&target.children.length===source.children.length&&[...target.children].every((x,i)=>x.tagName===source.children[i].tagName)){
      if(!target.children.length)target.textContent=source.textContent;
      else [...target.children].forEach((child,i)=>savingsPatchResult(child,source.children[i],true));
    }else target.innerHTML=source.innerHTML;
  }
  for(const attr of [...target.attributes])if(!source.hasAttribute(attr.name))target.removeAttribute(attr.name);
  for(const attr of source.attributes)target.setAttribute(attr.name,attr.value);
}
function savingsSortStageRows(){
  const view=el("savingsView"),list=view.querySelector(".plan-lines");if(!list||list.contains(document.activeElement))return;
  const sc=doc.savings?.scenarios.find(s=>s.id===ui.scenario)||doc.savings?.scenarios[0];
  const rows=(sc?.stages||[]).map(stage=>{
    const i=savingsStageViews.findIndex(ref=>ref.stage===stage);
    return view.querySelector(`[data-stage="${i}"]`)?.closest(".plan-line");
  }).filter(Boolean);
  if(rows.every((row,i)=>row===list.children[i]))return;
  rows.forEach(row=>list.appendChild(row));
}
function renderSavings(){
  if(savingsInputSaving)return;
  syncSavingsCurrentYear();
  const S=doc.savings, view=el("savingsView");
  if(!S){ view.innerHTML=emptyCard("저축 계획을 시작하세요","매달 말 저축총액을 기록하면 목표 5억 도달 시점을 예상합니다. 다른 기기에서 쓰던 기록은 동기화하면 불러옵니다.",`<button class="btn primary" id="startSavings" type="button">새로 시작</button>`);
    el("startSavings").onclick=()=>{ const y=new Date().getFullYear(); doc.savings={savedAt:"",startYear:y,startAge:30,actual:[],scenarios:[{id:newId(),name:"기본",salary:0,giving:0,spending:0,spendingYear:y,growth:2,returnRate:5,endAge:60,stages:[]}]}; savingsTab="records";savingsAllYears=false;savingsPastOpen=false;savingsOpenYears.clear();savingsOpenYears.add(y);saveSection("savings"); render(); }; return; }
  if(savingsTab===null)savingsTab=S.actual.some(a=>ymNum(a.ym)!==null&&finite(a.total)!==null)?"overview":"records";
  const sc=S.scenarios.find(x=>x.id===ui.scenario)||S.scenarios[0];
  if(ui.scenario&&!S.scenarios.some(x=>x.id===ui.scenario))setUi({scenario:sc?.id??null});
  savingsStageViews=(sc?.stages||[]).map(stage=>({stage}));
  view.innerHTML=savingsMarkup(S,sc,savingsStageViews);
  const list=view.querySelector(".plan-lines");
  if(list)list.addEventListener("focusout",e=>{if(list.contains(e.relatedTarget))return;setTimeout(()=>{if(!list.contains(document.activeElement))savingsSortStageRows();},0);});
  bindSavings(S,sc);
}
function bindSavings(S,sc){
  const tabs=[["overview","Overview","개요"],["records","Records","기록"],["assumptions","Assumptions","가정"]];
  const chooseScenario=id=>{setUi({scenario:id});renderSavings();};
  const select=el("savingsScenarioSelect");if(sc)select.onchange=()=>chooseScenario(select.value);
  all("[data-savings-scenario]").forEach(b=>b.onclick=()=>chooseScenario(b.dataset.savingsScenario));
  const showTab=(key,focus=false)=>{
    savingsTab=key;
    tabs.forEach(([name,id])=>{const button=el(`savingsTab${id}`),active=name===key;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;el(`savingsPane${id}`).hidden=!active;if(active&&focus)button.focus();});
  };
  const bindTabChoice=(button,key)=>{
    const editing=()=>document.activeElement?.matches?.("#savingsView input,#savingsView textarea");
    button.onclick=()=>{savingsTab=key;if(editing())document.activeElement.blur();showTab(key,true);};
  };
  if(el("enterSavingsRecord"))bindTabChoice(el("enterSavingsRecord"),"records");
  tabs.forEach(([key,id],index)=>{
    const button=el(`savingsTab${id}`);bindTabChoice(button,key);
    button.onkeydown=e=>{let next;if(e.key==="ArrowRight")next=(index+1)%tabs.length;else if(e.key==="ArrowLeft")next=(index+tabs.length-1)%tabs.length;else if(e.key==="Home")next=0;else if(e.key==="End")next=tabs.length-1;else return;e.preventDefault();showTab(tabs[next][0],true);};
  });
  all("[data-savings-detail]").forEach(detail=>detail.ontoggle=()=>{if(detail.open)savingsOpenDetails.add(detail.dataset.savingsDetail);else savingsOpenDetails.delete(detail.dataset.savingsDetail);});
  if(el("saveSavingsMilestone"))el("saveSavingsMilestone").onclick=()=>{
    const savings=doc.savings, scenario=savings.scenarios.find(x=>x.id===ui.scenario)||savings.scenarios[0];
    const current=savingsMilestone(simulateSavings(savings,scenario));if(current)assetStore.saveSavingsMilestone(current);renderSavings();
  };
  if(el("toggleYears")) el("toggleYears").onclick=()=>{ savingsAllYears=!savingsAllYears; renderSavings(); };
  if(el("toggleSavingsPast"))el("toggleSavingsPast").onclick=()=>{
    savingsPastOpen=!savingsPastOpen;el("savingsPastYears").hidden=!savingsPastOpen;
    const button=el("toggleSavingsPast");button.setAttribute("aria-expanded",String(savingsPastOpen));
    button.setAttribute("aria-label",button.getAttribute("aria-label").replace(/(펼치기|접기)$/,savingsPastOpen?"접기":"펼치기"));
  };
  all("[data-savings-year]").forEach(b=>b.onclick=()=>{
    const year=Number(b.dataset.savingsYear), open=!savingsOpenYears.has(year);if(open)savingsOpenYears.add(year);else savingsOpenYears.delete(year);
    el(b.getAttribute("aria-controls")).hidden=!open;b.setAttribute("aria-expanded",String(open));
    b.setAttribute("aria-label",b.getAttribute("aria-label").replace(/월별 기록 (펼치기|접기)$/,`월별 기록 ${open?"접기":"펼치기"}`));
  });
  el("copyScenario").onclick=()=>{ const base=sc||{}; const copy=JSON.parse(JSON.stringify({...base,id:newId(),name:`${base.name||"시나리오"} 복사`})); S.scenarios.push(copy); setUi({scenario:copy.id}); saveSection("savings"); render(); };
  savingsOnChange("[data-base]",(v,x)=>{ const n=numIn(v); if(n===null) return false; S[x.dataset.base]=Math.round(n); },x=>S[x.dataset.base]);
  savingsOnChange("[data-actual]",(v,x)=>setSavingsActual(S,x.dataset.actual,v),x=>S.actual.find(a=>a.ym===x.dataset.actual)?.total);
  if(!sc) return;
  savingsOnChange("[data-param]",(v,x)=>{ const k=x.dataset.param; if(k==="name"){ sc.name=v.trim()||sc.name; return; } if(k==="note"){ setText(sc,"note",v); return; }
    const n=numIn(v); if(n===null) return false;
    if(k==="spending"){
      const current=savingsCurrentSpending(S,sc,new Date().getFullYear());
      if(current.readOnly||n===current.value)return false;
      sc.spending=n;sc.spendingYear=current.year;return;
    }
    sc[k]=k==="endAge"?Math.round(n):n;
  },x=>x.dataset.param==="spending"?savingsCurrentSpending(S,sc).value:sc[x.dataset.param]);
  savingsOnChange("[data-stage]",(v,x)=>{ const st=savingsStageViews[Number(x.dataset.stage)]?.stage;if(!st||!sc.stages.includes(st))return false; if(x.dataset.k==="age"&&numIn(v)===null) return false; setNum(st,x.dataset.k,v); sc.stages.sort((a,b)=>a.age-b.age); },x=>savingsStageViews[Number(x.dataset.stage)]?.stage?.[x.dataset.k]);
  all("[data-stage-del]").forEach(b=>b.onclick=()=>{ const st=savingsStageViews[Number(b.dataset.stageDel)]?.stage,index=sc.stages.indexOf(st);if(index<0)return;sc.stages.splice(index,1); saveSection("savings"); render(); });
  el("addStage").onclick=()=>{ sc.stages=sc.stages||[]; const last=sc.stages[sc.stages.length-1]; sc.stages.push({age:(finite(last?.age)??(finite(S.startAge)||30))+5}); saveSection("savings"); render(); };
  if(el("deleteScenario"))el("deleteScenario").onclick=()=>{ if(!confirm(`'${sc.name}' 시나리오를 삭제할까요?`)) return; S.scenarios=S.scenarios.filter(x=>x!==sc); setUi({scenario:S.scenarios[0]?.id||null}); saveSection("savings"); render(); };
}
