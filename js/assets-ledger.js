// 자산 현황 › 월별 손익 탭(S&P 500·금 비교 표시 포함). 공통 도구·render·saveSection은 assets.js, 계산은 assets-calc.js·ledger-benchmark.js.
// 잔액을 넣은 달에 비어 있는 계좌 중, 같은 해 앞 달에 0이 아닌 잔액이 있고 뒤 달에도 잔액이 있는 계좌({account, index} 목록).
// 빈칸은 monthTotals에서 0원으로 더해져 그달 수익률이 높게 나오므로 입력이 빠졌는지 표시만 한다. 아직 열지 않았거나 해지 뒤 비운 계좌는 앞·뒤 조건으로 뺀다. 기록은 바꾸지 않는다.
function ledgerBalanceGaps(y, m){
  const bal=Array.isArray(m?.balances)?m.balances:[], accounts=ledgerAccounts(y), at=(x,i)=>finite(x?.balances?.[i]);
  if(!accounts.some(({index})=>finite(bal[index])!==null))return [];
  return accounts.filter(({index})=>finite(bal[index])===null&&(y.months||[]).some(x=>x.m<m.m&&at(x,index))&&(y.months||[]).some(x=>x.m>m.m&&at(x,index)!==null));
}
// 맨 위 카드 누적 그래프(HTML 글자). 너비는 그릴 때의 카드 안쪽 너비라 PC에서도 낮고 넓게 그린다. 자료는 ledger-benchmark.js ledgerChartData.
// 선·영역·점만 SVG로 그리고 눈금선·축·월 글자는 HTML로 얹는다(삼성 인터넷 등 웹페이지 다크 색 변환이 SVG 글자·선 색을 바꾸지 않아도 읽히게).
// won이면 월 손익 누적(원)만, 아니면 내 누적 수익률과 선택한 지수를 그린다. 두 지수 모두 1월부터 이어진 값은 선, 그 밖의 값은 점으로 표시한다.
// 선물·옵션은 따로 그리지 않는다. 월별 값은 그 달에, 달을 모르는 연 합계는 마지막 기록 달에 들어 있어 선 끝(점)이 선물·옵션 포함 누적이다.
const ledgerAxisWon=v=>v===0?"0":Math.abs(v)>=1e8?`${nf1.format(v/1e8)}억`:`${nf0.format(v/1e4)}만`;
function ledgerChartHtml(c, won, width, benchmarks=[]){
  const line=won?c.won:c.rate||[], shown=won?[]:benchmarks, end=line[line.length-1];
  if(!end)return "";
  const vals=[0,...line.map(p=>p.v),...shown.flatMap(b=>b.points.map(p=>p.v))];
  let lo=Math.min(...vals), hi=Math.max(...vals);const pad=(hi-lo||Math.abs(hi)||1)*.08;lo-=pad;hi+=pad;
  const raw=(hi-lo)/5, mag=10**Math.floor(Math.log10(raw)), step=Math.max(won?1e4:0,[1,2,5,10].map(f=>f*mag).find(s=>s>=raw));
  const W=width, H=104, left=won?40:28, px=m=>left+m/12*(W-left-4), py=v=>H-4-(v-lo)/(hi-lo)*(H-10), at=p=>`${px(p.m).toFixed(1)},${py(p.v).toFixed(1)}`;
  const ticks=[];for(let v=Math.ceil(lo/step)*step;v<=hi;v+=step)ticks.push(Math.round(v/step)*step||0);
  const label=v=>won?ledgerAxisWon(v):`${(step<1?nf1:nf0).format(v)}%`, path=pts=>pts.map((p,i)=>`${i?"L":"M"}${at(p)}`).join("");
  const mine=[{m:c.from,v:0},...line], series=shown.map(b=>({...b,line:b.points.length&&b.points[0].m===1?[{m:0,v:0},...b.points]:[],end:b.points.find(p=>p.m===end.m)||(b.points[b.points.length-1]?.m===12?b.points[b.points.length-1]:null)}));
  const top=v=>`${(py(v)/(H+16)*100).toFixed(2)}%`, x=m=>`${(px(m)/W*100).toFixed(2)}%`;
  return `<div class="ledger-chart" role="img" aria-label="${won?"월 손익 누적":`내 누적 수익률과 ${shown.map(b=>b.name).join("·")} 누적 수익률`} 그래프">
    ${ticks.map(v=>`<i class="grid${v===0?" zero":""}" style="top:${top(v)};left:${x(0)}"></i><span class="axis" style="top:${top(v)}">${label(v)}</span>`).join("")}
    <svg viewBox="0 0 ${W} ${H+16}" aria-hidden="true"><defs><linearGradient id="ledgerChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="fill-top"/><stop offset="1" class="fill-end"/></linearGradient></defs>
    <line x1="${px(end.m).toFixed(1)}" x2="${px(end.m).toFixed(1)}" y1="0" y2="${H}" class="guide"/>
    <path d="${path(mine)}L${px(end.m).toFixed(1)},${py(lo).toFixed(1)}L${px(c.from).toFixed(1)},${py(lo).toFixed(1)}Z" class="area"/>
    ${series.filter(b=>b.line.length).map(b=>`<path d="${path(b.line)}" class="${b.key}"/>`).join("")}<path d="${path(mine)}" class="me"/>
    ${series.map(b=>(b.line.length?[b.end].filter(Boolean):b.points).map(p=>`<circle cx="${px(p.m).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="3" class="${b.key}-dot"/>`).join("")).join("")}
    <circle cx="${px(end.m).toFixed(1)}" cy="${py(end.v).toFixed(1)}" r="4" class="end"/>
    </svg>${Array.from({length:12},(_,i)=>`<span class="month${i+1===end.m?" on":""}" style="left:${x(i+1)}">${i+1}</span>`).join("")}</div>`;
}
// 맨 위: 연도 칩 한 줄(가로로 밀기, 끝에 연도 추가) + 카드(선택한 지수 비교 또는 실현손익 금액, 그래프, 요약 2칸). 누적·실현손익은 선물·옵션 포함이며 따로 나눠 보이지 않는다.
// 수익률/금액 선택은 화면 설정(ui.ledgerChart)이라 이 기기에만 기억하고 기록에 넣지 않는다.
// 제목과 높은 쪽의 비교 대상은 그해 수익률(올해는 기록한 마지막 달 말 누적)으로 고른다. 둘 다에서도 제목은 같은 기간의 높은 지수를 쓴다.
// 그 기간의 두 지수 값이 모두 없을 때만 연도별 요약의 bestBenchmark 결과를 쓴다.
let ledgerChartWidth=0, ledgerResizeTimer=0;
function ledgerTopHtml(y, ys, years, c){
  const won=ui.ledgerChart==="won", view=el("ledgerView");
  const today=new Date(), winner=periodBenchmark(c.spAt,c.goldAt,bestBenchmark(sp500Comparison(years,today,sp500Data),goldComparison(years,today,goldData)));
  const benchmarks=[{key:"sp",id:"sp500",name:"S&amp;P 500",points:c.sp,at:c.spAt,diff:c.diff},{key:"gold",id:"gold",name:"금",points:c.gold,at:c.goldAt,diff:c.goldDiff}];
  const picked=benchmarks.find(b=>b.id===winner), both=ui.ledgerBench==="both", shown=won?[]:both?benchmarks:[picked];
  ledgerChartWidth=Math.round(Math.min(1000,Math.max(280,(Number(view.clientWidth)||361)-34)));
  const first=c.from+1, span=c.month?`${first<c.month?`${first}~`:""}${c.month}월`:"", noRate=!won&&c.month&&!c.rate;
  const em=(text,good)=>`<em class="${good?"up":"down"}">${text}</em>`;
  const title=!c.month?"아직 기록한 달이 없습니다":noRate?(c.unrated.length?`${c.unrated.join("·")}월 총자산이 없어 수익률을 계산하지 못했습니다`:"수익률을 계산할 수 없습니다")
    :won?`실현손익 ${em(wonA(c.pnl),c.pnl>=0)}`
    :picked.diff===null?`내 누적 ${em(pct2(c.total),c.total>=0)}`
    :Math.abs(picked.diff)<.005?`${picked.name}과 같아요`:`${picked.name}보다 ${em(`${pct2(Math.abs(picked.diff),"%p").replace("+","")} ${picked.diff>0?"높아요":"낮아요"}`,picked.diff>0)}`;
  const keys=!c.month||noRate?"":won?`<span class="ledger-key"><i></i>월 손익 누적</span>`
    :`<span class="ledger-key"><i></i>내 누적<b>${pct2(c.total)}</b></span>${shown.map(b=>`<span class="ledger-key"><i class="${b.key}"></i>${b.name}<b>${b.at!==null?pct2(b.at):Number(y.year)>today.getFullYear()?"—":"반영 전"}</b></span>`).join("")}`;
  const info=!c.month?"달마다 실현손익과 계좌 잔액을 넣으면 누적 그래프를 그립니다."
    :noRate?(c.unrated.length?"아래 표에서 그 달 계좌 잔액을 넣으면 그래프를 그립니다. ‘금액’에서는 실현손익 누적을 볼 수 있습니다.":"아래 표의 실현손익·선물·옵션과 총자산을 확인해 주세요. ‘금액’에서는 실현손익 누적을 볼 수 있습니다.")
    :won?"달마다 실현손익(선물·옵션 포함)을 더한 누적입니다."
    :`${shown.some(b=>b.key==="sp")?"S&amp;P 500은 달러·배당 재투자, ":""}${shown.some(b=>b.key==="gold")?"금은 금 ETF GLDM 종가 기준(달러·보수 0.10%), ":""}내 수익률은 원화 실현손익(선물·옵션 포함) 기준 월 복리 누적${!both?` · ${Number(y.year)===today.getFullYear()?`올해는 ${c.month}월 말까지`:"그해"} 수익률이 더 높은 지수 표시`:""}${shown.some(b=>b.points.length&&b.points[0].m!==1)?" · 1월부터 이어지지 않는 지수 값은 점으로 표시":""}`;
  const cell=(label,value,neg)=>`<div><span>${label}</span><b class="${neg?"neg":""}">${value}</b></div>`;
  return `<h1 class="sr-only">월별 손익</h1>
    <div class="ledger-years" role="group" aria-label="연도 선택">${years.map(x=>`<button class="chip${x===y?" active":""}" type="button" data-pick-year="${escA(x.year)}" aria-pressed="${x===y}">${escA(x.year)}</button>`).join("")}<button class="chip add" id="addYear" type="button" aria-label="연도 추가" title="연도 추가">＋</button></div>
    <section class="card ledger-card">
      <div class="ledger-card-head"><span>${escA(y.year)}년${span?` ${span}`:""} ${won?"누적 실현손익":"누적 수익률"}</span><div class="ledger-seg" role="group" aria-label="그래프 단위"><button type="button" data-ledger-chart="rate" aria-pressed="${!won}">수익률</button><button type="button" data-ledger-chart="won" aria-pressed="${won}">금액</button></div></div>
      <h2 class="${noRate?"warn":""}">${title}</h2>
      ${keys?`<div class="ledger-keys${!won&&both?" both":""}">${keys}</div>`:""}
      ${noRate?"":ledgerChartHtml(c,won,ledgerChartWidth,shown)}
      <p class="ledger-info">${info}</p>
      <div class="ledger-cells">${cell("실현손익",c.month||ys.futures!==null?eok(ys.pnl):"—",ys.pnl<0)}${cell(ys.last?`총자산 ${ys.last.m}월 말`:"총자산",ys.last?eok(ys.last.total):"—")}</div>
    </section>`;
}
// 화면 너비가 크게 바뀌면(가로 전환·창 크기) 그래프를 새 너비로 다시 그린다.
addEventListener("resize",()=>{clearTimeout(ledgerResizeTimer);ledgerResizeTimer=setTimeout(()=>{const v=el("ledgerView");if(ui.tab==="ledger"&&ledgerChartWidth&&v?.clientWidth&&Math.abs(v.clientWidth-34-ledgerChartWidth)>40)redrawIdle();},200);});
function renderLedger(){
  const L=doc.ledger, view=el("ledgerView");
  if(!L||!L.years.length){ view.innerHTML=emptyCard("월별 손익 기록이 없습니다","데이터 저장소에 etf-planner-assets.json이 있으면 동기화할 때 불러옵니다.",`<button class="btn primary" id="startLedger" type="button">올해부터 시작</button>`);
    el("startLedger").onclick=()=>{ doc.ledger={savedAt:"",years:[{year:new Date().getFullYear(),accounts:[],months:[]}]}; saveSection("ledger"); render(); }; return; }
  const years=[...L.years].sort((a,b)=>a.year-b.year), y=years.find(x=>x.year===ui.year)||years[years.length-1], ys=yearSummary(y);
  const accounts=ledgerAccounts(y), compound=compoundYearReturn(years);
  const compoundHint=compound.partial?`올해 1~${compound.month}월 누적 · 1년 미만은 연환산하지 않음`
    :compound.years?`${compound.from}~${compound.to}년${compound.month?` ${compound.month}월`:""} · ${nf2.format(compound.period)}년`:"계산할 수 있는 연도가 없습니다";
  // 잔액이 전달과 똑같은 달(엑셀에서 전달 값을 그대로 둔 것일 수 있음)은 작게 표시
  const sameAsPrev=m=>{ const prev=y.months.find(x=>x.m===m.m-1), values=r=>accounts.map(x=>finite(r?.balances?.[x.index]));return Array.isArray(m.balances)&&values(m).some(v=>v!==null)&&JSON.stringify(values(m))===JSON.stringify(values(prev)); };
  // 달 줄의 실현손익·수익률은 그달 선물·옵션을 더한 값이다(맨 위 그래프의 달 값과 같다). 입력 창에서는 따로 넣는다.
  // 선물·옵션을 월별로 넣는 해(한 달이라도 넣음)만 기록한 달 중 비어 있는 달에 '선물·옵션 미입력'을 표시한다. 넣은 값(0원 포함)은 줄에 표시하지 않는다.
  const monthRow=n=>{ const m=y.months.find(x=>x.m===n), t=m?monthTotals(y,m):{}, pnl=monthPnl(m), f=finite(m?.futures), p=pnl===null&&f===null?null:(pnl||0)+(f||0), r=p!==null&&t.total>0?p/t.total*100:null, gaps=m?ledgerBalanceGaps(y,m).length:0, blanks=ledgerPnlBlanks(m);
    return `<button class="ledger-row${m?"":" blank"}" type="button" data-month="${n}"><span>${n}월</span><span class="${p<0?"neg":""}">${p!==null?wonA(p):"—"}${blanks?`<small class="same-tag">빈칸 ${blanks}개 · 확인</small>`:""}${m&&monthFutures&&finite(m.futures)===null?`<small class="same-tag">선물·옵션 미입력</small>`:""}</span><span class="${r<0?"neg":""}">${pc(r)}</span><span>${t.total!==null&&t.total!==undefined?wonA(t.total):"—"}${gaps?`<small class="same-tag">빈 계좌 ${gaps}개 · 확인</small>`:m&&sameAsPrev(m)?`<small class="same-tag">잔액이 전달과 같음</small>`:""}</span></button>`; };
  const summaryRows=years.map(x=>{const t=yearSummary(x);return `<button class="ledger-row${x===y?" active":""}" type="button" data-pick-year="${escA(x.year)}"><span>${escA(x.year)}</span><span class="${t.pnl<0?"neg":""}">${wonA(t.pnl)}</span><span class="${t.rate<0?"neg":""}">${pc(t.rate)}</span><span>${t.last?wonA(t.last.total):"—"}<small>${t.last?`${t.last.m}월`:""}</small></span></button>`;}).join("");
  loadSp500();loadGold();
  // 달을 모르는 선물·옵션(연도 설정)이 있는 해만 표에 그 줄을 둔다. 금액 합계와 월 복리 수익률은 yearSummary를 따른다.
  const chart=ledgerChartData(y,new Date(),sp500Data,goldData), monthFutures=y.months.filter(m=>finite(m.futures)!==null).length, restRate=ys.futuresYear!==null&&ys.last?.total>0?ys.futuresYear/ys.last.total*100:null;
  view.innerHTML=`${ledgerTopHtml(y,ys,years,chart)}
    <div class="section-heading ledger-sec"><h2>${escA(y.year)}년 월별</h2><span>줄을 누르면 그 달 기록을 고칩니다 · 계좌 ${accounts.length}개</span><button class="btn mini" type="button" id="editYear">연도 설정</button></div>
    <section class="card ledger-table"><div class="ledger-row head"><span>월</span><span>실현손익</span><span>수익률</span><span>총자산</span></div>
      ${Array.from({length:12},(_,i)=>monthRow(i+1)).join("")}
      ${ys.futuresYear!==null?`<button class="ledger-row foot" type="button" id="editFutures" aria-label="${escA(y.year)}년 달을 모르는 선물·옵션 손익 수정"><span>선물·<wbr>옵션<small>수정</small></span><span class="${ys.futuresYear<0?"neg":""}">${wonA(ys.futuresYear)}<small>달을 모르는 금액</small></span><span>${pc(restRate)}</span><span></span></button>`:""}
      <div class="ledger-row foot total"><span>합계</span><span class="${ys.pnl<0?"neg":""}">${wonA(ys.pnl)}</span><span>${pc(ys.rate)}<small>월 복리</small></span><span>${ys.annual!==null?`<small>연환산 ${pc(ys.annual)}</small>`:""}</span></div></section>
    ${y.note?`<p class="footnote">${escA(y.note)}</p>`:""}
    <div class="section-heading"><h2>연도별 요약</h2><span>연 수익률(월 복리) · 선물·옵션 포함</span></div>
    <section class="card ledger-table years"><div class="ledger-row head"><span>연도</span><span>실현손익</span><span>수익률</span><span>총자산</span></div>${summaryRows}<div class="year-average"><span>연복리 수익률 <small>${compoundHint}</small></span><strong class="${compound.rate<0?"neg":""}">${pc(compound.rate)}</strong></div>${sp500Block(years)}</section>`;
  all("[data-pick-year]").forEach(b=>b.onclick=()=>{ setUi({year:Number(b.dataset.pickYear)}); renderLedger(); });
  all("[data-ledger-chart]").forEach(b=>b.onclick=()=>{ setUi({ledgerChart:b.dataset.ledgerChart}); renderLedger(); });
  all("[data-ledger-bench]").forEach(b=>b.onclick=()=>{ setUi({ledgerBench:b.dataset.ledgerBench==="both"?"both":"best"}); renderLedger(); });
  // 고른 연도 칩이 가운데(끝 연도면 연도 추가까지) 보이게 연도 줄을 가로로 민다(세로 스크롤은 건드리지 않는다).
  const yearRow=view.querySelector(".ledger-years"), picked=yearRow?.querySelector(".chip.active");
  if(picked&&typeof picked.offsetLeft==="number")yearRow.scrollLeft=Math.max(0,picked.offsetLeft-(yearRow.clientWidth-picked.offsetWidth)/2);
  all("[data-month]").forEach(b=>b.onclick=()=>openMonth(y,Number(b.dataset.month)));
  el("editYear").onclick=()=>openYear(y);
  if(ys.futuresYear!==null)el("editFutures").onclick=()=>{openYear(y);el("yearForm").futures.focus();};
  el("addYear").onclick=()=>{ const next=Math.max(...years.map(x=>x.year))+1, last=years[years.length-1];
    if(!confirm(`${next}년을 추가할까요? 계좌 목록은 ${last.year}년과 같게 시작합니다.`)) return;
    L.years.push({year:next,accounts:ledgerAccounts(last).map(x=>({...x.account})),months:[]}); setUi({year:next}); saveSection("ledger"); render(); };
}
// 연도별 요약 아래 지수 연복리 비교. 계산 기준은 ledger-benchmark.js의 비교 함수·bestBenchmark 주석.
// 세 값은 소수 둘째 자리로 표시한다. 표시 선택은 화면 설정(ui.ledgerBench)이라 이 기기에만 기억하고 기록에 넣지 않는다.
const nfFixed2 = new Intl.NumberFormat("ko-KR",{minimumFractionDigits:2,maximumFractionDigits:2});
const pct2 = (v, unit="%") => v===null||v===undefined||!Number.isFinite(Number(v)) ? "—" : `${unit==="%p"&&v>0?"+":""}${nfFixed2.format(Number(v))}${unit}`;
// S&P 500 연말·월말 종가(공개 data/sp500-tr.json, 매월 자동 수집: scripts/collect-sp500.cjs). 페이지마다 한 번 읽고, 못 읽으면 공표치만으로 비교한다.
let sp500Data=null, sp500Requested=false;
function loadSp500(){
  if(sp500Requested||typeof fetch!=="function")return;sp500Requested=true;
  fetch("data/sp500-tr.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(raw=>{sp500Data=cleanSp500Data(raw);if(sp500Data&&ui.tab==="ledger")redrawIdle();}).catch(()=>{});
}
// GLDM 연말·월말 종가도 페이지마다 한 번 읽는다. 실패하면 연말 상수만으로 비교하며 기록은 바꾸지 않는다.
let goldData=null, goldRequested=false;
function loadGold(){
  if(goldRequested||typeof fetch!=="function")return;goldRequested=true;
  fetch("data/gold-etf.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(raw=>{goldData=cleanGoldData(raw);if(goldData&&ui.tab==="ledger")redrawIdle();}).catch(()=>{});
}
// 양쪽에 연간 자료가 있으면 표시할 완료 연도를 공통 연도로 맞춘다. 한 개의 내 연복리와 두 차이가 같은 기간을 가리키게 한다.
// 원래 비교 결과는 지수별 제외·반영 전 안내에 쓰고, 올해 누적은 완료 연도 필터에서 빼지 않는다.
function sp500Block(years){
  loadSp500();loadGold();
  const today=new Date(), sp=sp500Comparison(years,today,sp500Data), gold=goldComparison(years,today,goldData);
  const choices=[{key:"sp",id:"sp500",name:"S&amp;P 500",c:sp},{key:"gold",id:"gold",name:"금",c:gold}], winner=bestBenchmark(sp,gold);
  const common=new Set(sp.rows.filter(r=>gold.rows.some(g=>g.year===r.year)).map(r=>r.year));
  const annualYears=years.filter(y=>Number(y.year)>=today.getFullYear()||common.has(Number(y.year)));
  const display=sp.rows.length&&gold.rows.length?choices.map(x=>({...x,c:x.id==="gold"?goldComparison(annualYears,today,goldData):sp500Comparison(annualYears,today,sp500Data)})):choices;
  const picked=display.find(x=>x.id===winner), other=display.find(x=>x!==picked), c=picked.c, both=ui.ledgerBench==="both", notes=[];
  const sameList=(a,b)=>JSON.stringify(a)===JSON.stringify(b), period=x=>`${x.from}~${x.to}년 완료 ${x.years}개 연도`;
  if(sameList(sp.missing,gold.missing)){
    if(sp.missing.length)notes.push(`${sp.missing.join("·")}년은 내 연 수익률이 없어 제외`);
  }else for(const x of choices)if(x.c.missing.length)notes.push(`${x.name}: ${x.c.missing.join("·")}년은 내 연 수익률이 없어 제외`);
  for(const x of choices)if(x.c.pending.length)notes.push(`${x.name}: ${x.c.pending.join("·")}년 값 반영 전`);
  if(!sameList(sp.rows.map(r=>r.year),gold.rows.map(r=>r.year)))for(const x of choices)if(x.c.years)notes.push(`${x.name} 자료: ${period(x.c)}`);
  const cell=(label,value,neg,hint,high=false)=>`<div><span>${label}</span><strong class="${neg?"neg":""}">${value}</strong><small>${hint}</small>${high?'<small class="benchmark-best">연복리 높음</small>':""}</div>`;
  const indexCell=x=>cell(`${x.name} 연복리`,pct2(x.c[x.key]),x.c[x.key]<0,`차이 ${pct2(x.c.diff,"%p")}`,x.id===winner&&display.every(x=>x.c[x.key]!==null)&&display[0].c.sp!==display[1].c.gold);
  const grid=cell("내 연복리",pct2(c.mine),c.mine<0,"원화 · 실현손익")+(both?display.map(indexCell).join(""):
    cell(`${picked.name} 연복리`,pct2(c[picked.key]),c[picked.key]<0,picked.id==="gold"?"달러 · GLDM 종가":"달러 · 배당 재투자")+cell("차이",pct2(c.diff,"%p"),c.diff<0,`내 연복리 − ${picked.name}`));
  const hint=`${c.years?`${period(c)} · `:""}같은 연도 연복리${!both?` · 연복리가 더 높은 ${picked.name} 표시 · ${other.name} ${pct2(other.c[other.key])}`:""}${notes.length?` · ${notes.join(" · ")}`:""}`;
  const currentPicked=choices.find(x=>x.id===periodBenchmark(sp.current?.sp,gold.current?.gold,winner));
  return `<div class="benchmark"><div class="benchmark-head"><b>지수 비교</b><div class="ledger-seg" role="group" aria-label="지수 비교 표시"><button type="button" data-ledger-bench="best" aria-pressed="${!both}">높은 쪽</button><button type="button" data-ledger-bench="both" aria-pressed="${both}">둘 다</button></div><small>${hint}</small></div>
    ${c.years?`<div class="benchmark-grid">${grid}</div>`:'<p class="benchmark-empty">비교할 완료 연도가 아직 없습니다.</p>'}
    ${c.current&&c.current.rate!==null&&c.current.month?ledgerBenchmarkYtdRow(choices,currentPicked,both):""}
  </div>`;
}
// 올해는 기록한 마지막 달 말까지 월 단위로 같은 기간을 비교한다. 위 세 칸과 같은 열에 맞춘다.
function ledgerBenchmarkYtdRow(choices,picked,both){
  const now=picked.c.current, span=now.month>1?`1~${now.month}월`:"1월";
  const item=(label,value,neg,hint="")=>`<span><small>${label}</small><b class="${neg?"neg":""}">${value}</b>${hint?`<small>${hint}</small>`:""}</span>`;
  const indexCell=x=>{const row=x.c.current;return item(`${x.name} 누적`,row[x.key]===null?"반영 전":pct2(row[x.key]),row[x.key]<0,both?`차이 ${pct2(row.diff,"%p")}`:"");};
  const shown=both?choices:[picked], status=shown.map(x=>`${x.name}${x.c.current[x.key]!==null?`은 ${now.month}월 말 기준`:` ${now.month}월 말 값 반영 전`}`).join(" · ");
  return `<div class="benchmark-ytd"><div class="benchmark-ytd-head">올해 ${now.year}년 ${span} 누적<small>${!both?`누적이 더 높은 ${picked.name} 표시 · `:""}${status} · 연간 확정 후 연복리에 포함</small></div>
    <div class="benchmark-ytd-cells">${item("내 누적",pct2(now.rate),now.rate<0)}${both?choices.map(indexCell).join(""):indexCell(picked)+item("차이",pct2(now.diff,"%p"),now.diff<0)}</div></div>`;
}
// 자주 적는 손익 항목은 빈 전용 칸으로 보여 준다. 실제 금액을 넣은 항목만 pnlEntries에 저장하고, 열기만 해서는 기록을 만들지 않는다.
let updateLedgerDividendFx=null;
const LEDGER_PNL_FIELDS=[{broker:"신한",label:"기본계좌+ISA"},{broker:"신한",label:"연금저축"},{broker:"신한",label:"배당"},
  {broker:"키움(영웅문)",label:"실현손익"},{broker:"키움(영웅문)",label:"배당",currency:"USD"}];
// 저장된 pnlEntries를 전용 칸(증권사·구분·통화가 같은 항목, 옛 이름 포함)과 추가 내역으로 나눈 사본. 빈 전용 칸은 이름만 남는다.
function ledgerPnlSlots(m){
  const fixed=LEDGER_PNL_FIELDS.map(p=>({...p})), extra=[], matched=new Set();
  const brokerKey=v=>String(v||"").replace(/\s|\(영웅문\)|증권/g,""), labelKey=v=>String(v||"").replace(/\s/g,"").replace(/·/g,"+").replace(/^배당입금내역$/, "배당");
  for(const entry of Array.isArray(m?.pnlEntries)?m.pnlEntries:[]){
    const i=LEDGER_PNL_FIELDS.findIndex((p,i)=>!matched.has(i)&&brokerKey(p.broker)===brokerKey(entry.broker)&&labelKey(p.label)===labelKey(entry.label)&&(p.currency||"KRW")===(entry.currency||"KRW"));
    if(i<0)extra.push({...entry});else{fixed[i]={...entry};matched.add(i);}
  }
  return {fixed,extra};
}
// 항목별로 적은 달(pnlEntries 있음)에서 비어 있는 전용 칸 수. 0원을 넣은 칸은 채운 것으로 보고, 합계만 적은 달은 0이다.
const ledgerPnlBlanks=m=>Array.isArray(m?.pnlEntries)&&m.pnlEntries.length?ledgerPnlSlots(m).fixed.filter(r=>finite(r.amount)===null&&finite(r.krw)===null).length:0;
function openMonth(y, n){
  const f=el("monthForm"), m=y.months.find(x=>x.m===n)||{m:n}, bal=m.balances||[], accounts=ledgerAccounts(y);
  const {fixed,extra}=ledgerPnlSlots(m);
  const gaps=new Set(ledgerBalanceGaps(y,m).map(x=>x.index)); // 입력이 빠졌을 수 있는 계좌 칸(ledgerBalanceGaps)
  const fxLine="125개월선", savedDividend=finite(fixed[4].amount)!==null&&finite(fixed[4].krw)!==null;
  let dividendFx=pnlDollarFx(fixed[4],assetDividendFx(prices)), dividendBasis=savedDividend?fixed[4].fxBasis:fxLine;
  let dividendFxAt=savedDividend?fixed[4].fxAt:prices?.fx?.maAsOf||prices?.fx?.asOf;
  if(finite(fixed[4].amount)!==null&&finite(fixed[4].krw)===null){const won=pnlDollarKrw(fixed[4].amount,dividendFx);if(won!==null){fixed[4].krw=won;if(dividendFx)fixed[4].fx=dividendFx;}}
  const input=(i,label,signed=false)=>{const attrs=`data-pnl-fixed="${i}" data-k="amount" value="${moneyText(fixed[i].amount)}" placeholder="미입력"`;return `<label class="field"><span>${label}</span><input ${attrs} ${signed?signedMoneyAttrs:moneyAttrs}></label>`;}; // 손익 칸만 정수 키패드('-' 키), 배당은 양수
  el("monthTitle").textContent=`${y.year}년 ${n}월`;
  el("monthFields").innerHTML=`<label class="field dialog-wide"><span>실현손익 합계 (원)</span><input name="pnl" ${signedMoneyAttrs} value="${moneyText(monthPnl(m))}"><small class="field-hint" id="pnlTotalHint"></small></label>
    <div class="dialog-wide pnl-broker-grid"><section class="pnl-broker"><h3>신한</h3>${input(0,"기본계좌+ISA (원)",true)}${input(1,"연금저축 (원)",true)}${input(2,"배당 (원)")}</section>
      <section class="pnl-broker"><h3>키움증권</h3>${input(3,"실현손익 (원)",true)}${input(4,"배당 (달러)")}<label class="field"><span id="dividendFxLabel"></span><input name="dividendFx" ${moneyAttrs} readonly placeholder="평균선 필요"><small class="field-hint" id="dividendFxHint"></small></label><div class="pnl-conversion"><span>배당 원화 환산액</span><output id="kiwoomDividendWon"></output></div><button class="btn mini ghost" type="button" id="refreshDividendFx">125개월 평균선 갱신</button></section></div>
    <details class="dialog-wide pnl-other" id="pnlOther"${extra.length?" open":""}><summary>다른 증권사·항목 추가</summary><div id="pnlEntryRows"></div><button class="btn mini" type="button" id="addPnlEntry">＋ 내역</button></details>
    <label class="field dialog-wide"><span>선물·옵션 손익 (원)</span><input name="futures" ${signedMoneyAttrs} value="${moneyText(m.futures)}" placeholder="미입력"><small class="field-hint">그달 선물·옵션 실현손익입니다. 실현손익 합계와 따로 더해 그래프·연 수익률·연환산에 반영합니다.${finite(y.futures)!==null?` 연도 설정에 달을 모르는 선물·옵션 ${escA(wonA(y.futures))}이 따로 있어 마지막 기록 달에 더합니다. 달마다 나눠 넣었다면 그 값은 비워 주세요.`:""}</small></label>
    <h3 class="dialog-wide pnl-balance-title">계좌 잔액 (원)</h3>
    ${accounts.map(({account,index})=>`<label class="field"><span>${escA(account.name)}</span><input name="bal${index}" ${moneyAttrs} value="${moneyText(bal[index])}"${gaps.has(index)?` placeholder="입력 빠짐?"`:""}>${gaps.has(index)?`<small class="field-hint same-tag">앞뒤 달에는 잔액이 있습니다. 비워 두면 0원으로 더해 이달 수익률이 높게 나옵니다(해지했으면 0).</small>`:""}</label>`).join("")}
    ${!y.accounts.length?`<label class="field"><span>총자산 (원)</span><input name="total" ${moneyAttrs} value="${moneyText(m.total)}"></label>`:""}
    <p class="hint dialog-wide">${accounts.length?"총자산은 계좌 잔액 합계입니다. 계좌는 ‘연도 설정’에서 더하거나 뺍니다.":y.accounts.length?"‘연도 설정’에서 계좌를 추가한 뒤 잔액을 입력해 주세요.":"계좌가 없는 해는 총자산만 넣습니다. ‘연도 설정’에서 계좌를 더하면 계좌별로 적을 수 있습니다."}</p>`;
  let manualPnl=f.pnl.value;
  const entries=()=>[...fixed.filter(r=>finite(r.amount)!==null||finite(r.krw)!==null),...extra];
  const update=()=>{
    const rows=entries(), wasAuto=f.pnl.readOnly;f.pnl.readOnly=!!rows.length;
    if(rows.length){f.pnl.value=assetNumberText(pnlEntriesTotal(rows));f.pnl.setCustomValidity("");}
    else if(wasAuto)f.pnl.value=manualPnl;
    el("pnlTotalHint").textContent=rows.length?"입력한 손익과 배당의 원화 합계입니다.":"아래 항목을 입력하면 자동 합산합니다. 합계만 직접 기록할 수도 있습니다.";
    const amount=finite(fixed[4].amount);f.dividendFx.value=assetNumberText(dividendFx);
    el("dividendFxLabel").textContent=dividendBasis===fxLine?"125개월 평균 환율 (원/달러)":"기록된 환율 (원/달러)";
    el("dividendFxHint").textContent=dividendBasis!==fxLine?"기존 기록의 환율입니다. 새 배당은 125개월 평균선을 적용합니다.":dividendFx?`${dividendFxAt?`${dividendFxAt} 기준 · `:""}자동 적용${prices?.fx?.maStale?" · 갱신 필요":""}`:"125개월 평균선을 불러오면 자동 적용됩니다.";
    el("kiwoomDividendWon").textContent=amount!==null?(finite(fixed[4].krw)!==null?wonA(fixed[4].krw):"평균선 필요"):"—";
  };
  const convertDividend=()=>{
    const row=fixed[4], won=pnlDollarKrw(row.amount,dividendFx);delete row.krw;delete row.fx;delete row.fxBasis;delete row.fxAt;
    if(finite(row.amount)!==null){if(plus(dividendFx)){row.fx=dividendFx;if(dividendBasis===fxLine){row.fxBasis=fxLine;if(dividendFxAt)row.fxAt=dividendFxAt;}}if(won!==null)row.krw=won;}
  };
  const useAverage=()=>{dividendFx=assetDividendFx(prices);dividendBasis=fxLine;dividendFxAt=prices?.fx?.maAsOf||prices?.fx?.asOf;};
  all("[data-pnl-fixed]").forEach(x=>x.oninput=()=>{setNum(fixed[Number(x.dataset.pnlFixed)],x.dataset.k,x.value);if(Number(x.dataset.pnlFixed)===4){if(dividendBasis!==fxLine||!plus(fixed[4].fx))useAverage();convertDividend();}update();});
  const fxButton=el("refreshDividendFx");
  updateLedgerDividendFx=()=>{if(!fxButton.isConnected||!dlg("monthDialog").open||dividendBasis!==fxLine||(finite(fixed[4].amount)!==null&&finite(fixed[4].krw)!==null))return;useAverage();convertDividend();update();};
  fxButton.onclick=async()=>{fxButton.disabled=true;fxButton.textContent="평균선 불러오는 중…";try{await refreshAssetPrices();if(!fxButton.isConnected||!dlg("monthDialog").open)return;useAverage();convertDividend();update();if(!dividendFx)el("dividendFxHint").textContent=assetConfig()?"125개월 평균선을 받지 못했습니다. 잠시 후 다시 불러와 주세요.":"동기화를 연결해 125개월 평균선을 불러와 주세요.";}finally{fxButton.disabled=false;fxButton.textContent="125개월 평균선 갱신";}};
  const draw=()=>{
    el("pnlEntryRows").innerHTML=extra.map((r,i)=>`<div class="pnl-entry"><div class="pnl-entry-head"><span>추가 내역 ${i+1}</span><button class="remove" type="button" data-pnl-del="${i}" aria-label="추가 내역 ${i+1} 삭제">삭제</button></div><div class="pnl-entry-grid">
      <label class="field"><span>증권사</span><input data-pnl-entry="${i}" data-k="broker" maxlength="40" required value="${escA(r.broker)}" placeholder="증권사 이름"></label>
      <label class="field"><span>구분 (선택)</span><input data-pnl-entry="${i}" data-k="label" maxlength="80" value="${escA(r.label)}" placeholder="계좌·배당 등"></label>
      <label class="field"><span>금액${r.currency==="USD"?" (달러)":" (원)"}</span><input data-pnl-entry="${i}" data-k="amount" ${signedMoneyAttrs} required value="${moneyText(r.amount)}"></label>
      <label class="field"><span>통화</span><select data-pnl-entry="${i}" data-k="currency"><option value="KRW"${r.currency!=="USD"?" selected":""}>원화</option><option value="USD"${r.currency==="USD"?" selected":""}>달러</option></select></label>
      ${r.currency==="USD"?`<label class="field dialog-wide"><span>원화 입금액 (원)</span><input data-pnl-entry="${i}" data-k="krw" ${signedMoneyAttrs} required value="${moneyText(r.krw)}"></label>`:""}</div></div>`).join("");
    all("[data-pnl-entry]").forEach(x=>{
      const change=()=>{const r=extra[Number(x.dataset.pnlEntry)],k=x.dataset.k;
        if(k==="currency"){if(x.value==="USD")r.currency="USD";else{delete r.currency;delete r.krw;}draw();return;}
        if(k==="amount"||k==="krw")setNum(r,k,x.value);else setText(r,k,x.value);update();};
      if(x.tagName==="SELECT")x.onchange=change;else x.oninput=change;
    });
    all("[data-pnl-del]").forEach(b=>b.onclick=()=>{extra.splice(Number(b.dataset.pnlDel),1);draw();});update();
  };
  f.pnl.oninput=()=>{manualPnl=f.pnl.value;};
  el("addPnlEntry").onclick=()=>{extra.push({broker:""});draw();el("pnlEntryRows").querySelector(`[data-pnl-entry="${extra.length-1}"][data-k="broker"]`).focus();};
  draw();
  el("monthClear").onclick=()=>{ if(!confirm(`${y.year}년 ${n}월 기록을 지울까요?`)) return; y.months=y.months.filter(x=>x.m!==n); saveSection("ledger"); dlg("monthDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault();update();if(!f.reportValidity())return;if(finite(fixed[4].amount)&&!dividendFx){alert("원·달러 125개월 평균선을 먼저 불러와 주세요.");return;}
    const t={...m,m:n}; setNum(t,"pnl",f.pnl.value);setNum(t,"futures",f.futures.value);delete t.pnlEntries;delete t.balances;delete t.total;
    const rows=entries();
    if(rows.length){if(rows.some(r=>!String(r.broker||"").trim())){alert("내역의 증권사 이름을 넣어 주세요.");return;}if(pnlEntriesTotal(rows)===null){alert("내역의 금액과 원화 입금액을 모두 넣어 주세요.");return;}t.pnlEntries=rows.map(r=>({...r}));t.pnl=pnlEntriesTotal(rows);}
    if(y.accounts.length){ const b=y.accounts.map((acc,i)=>acc.loan?finite(bal[i]):numIn(f[`bal${i}`].value)); while(b.length&&b[b.length-1]===null) b.pop(); if(b.length) t.balances=b; }
    else setNum(t,"total",f.total.value);
    y.months=y.months.filter(x=>x.m!==n); if(Object.keys(t).length>1){ y.months.push(t); y.months.sort((a,b)=>a.m-b.m); }
    saveSection("ledger"); dlg("monthDialog").close(); render(); };
  dlg("monthDialog").showModal();
}
function openYear(y){
  const f=el("yearForm"); el("yearTitle").textContent=`${y.year}년 설정`;
  f.futures.value=assetNumberText(y.futures); f.futures.setCustomValidity(""); f.note.value=y.note||"";
  // 월별 선물·옵션(월 입력 창)과 달을 모르는 연 합계(이 칸)는 함께 더한다(assets-calc.js yearSummary).
  const monthly=y.months.filter(m=>finite(m.futures)!==null);
  el("yearFuturesHint").textContent=`달마다 넣으려면 월 입력 창의 선물·옵션 칸을 쓰세요. 이 칸 금액은 마지막 기록 달에 더합니다.${monthly.length?` 월별 입력 ${monthly.length}개월 합계 ${wonA(monthly.reduce((t,m)=>t+Number(m.futures),0))}.`:""}`;
  // 숨긴 옛 계좌·잔액은 저장 호환을 위해 보존한다. 새 계좌에는 loan 필드를 만들지 않는다.
  const hidden=y.accounts.map((a,i)=>({from:i,name:a.name})).filter(r=>y.accounts[r.from].loan);
  let rows=ledgerAccounts(y).map(({account,index})=>({from:index,name:account.name}));
  const draw=()=>{ el("accountRows").innerHTML=rows.map((r,i)=>`<div class="account-row"><input data-acc-name="${i}" value="${escA(r.name)}" maxlength="40" aria-label="계좌 이름"><button class="remove" type="button" data-acc-del="${i}" aria-label="계좌 삭제">삭제</button></div>`).join("")||`<p class="hint">계좌 없음 · 총자산만 적습니다</p>`;
    all("[data-acc-name]").forEach(x=>x.oninput=()=>{rows[Number(x.dataset.accName)].name=x.value;});
    all("[data-acc-del]").forEach(x=>x.onclick=()=>{const r=rows[Number(x.dataset.accDel)];if(r.from!==null&&y.months.some(m=>finite(m.balances?.[r.from])!==null)&&!confirm(`'${r.name}' 계좌를 지우면 이 해의 그 계좌 잔액도 지워집니다. 계속할까요?`))return;rows.splice(Number(x.dataset.accDel),1);draw();}); };
  draw(); el("addAccount").onclick=()=>{ rows.push({from:null,name:""}); draw(); el("accountRows").querySelector(`[data-acc-name="${rows.length-1}"]`)?.focus(); };
  el("yearDelete").onclick=()=>{ if(!confirm(`${y.year}년 손익 기록을 모두 지울까요?`)) return; doc.ledger.years=doc.ledger.years.filter(x=>x!==y); setUi({year:null}); saveSection("ledger"); dlg("yearDialog").close(); render(); };
  f.onsubmit=e=>{ e.preventDefault(); if(!f.reportValidity())return;setNum(y,"futures",f.futures.value); setText(y,"note",f.note.value);
    rows=[...rows.filter(r=>r.name.trim()),...hidden];y.accounts=rows.map(r=>({...y.accounts[r.from],name:r.name.trim()}));
    y.months.forEach(m=>{ if(!Array.isArray(m.balances)) return; const b=rows.map(r=>r.from===null?null:m.balances[r.from]??null); while(b.length&&b[b.length-1]===null) b.pop(); if(b.length) m.balances=b; else delete m.balances; });
    saveSection("ledger"); dlg("yearDialog").close(); render(); };
  dlg("yearDialog").showModal();
}
