// ETF(종목별)·달러선물 손절/재매수 계산과 ETF 화면. 시세는 prices.js, 선물 화면은 futures.js, 체결 연동은 alloc-link.js.
// 서버·DOM 없는 테스트에서도 읽으므로 함수 밖에서 화면을 건드리지 않는다.
const defaultRebuy = () => ({name:"니프티50 ETF",lowPrice:0,amount:0,currentPrice:0,stepPct:1,sellPct:0.5,steps:30,cuts:[],stages:MA_LINES.map(name=>({name,price:0,done:false,execPrice:null,shares:null})),note:""});
// 손대지 않은 옛 기본 단계(25분봉·60분봉·240분봉·일봉·주봉)는 MA_LINES 기본으로 읽고 editRebuy 때만 저장.
const untouchedOldStages = st => Array.isArray(st) && st.map(x=>x.name).join()==="25분봉,60분봉,240분봉,일봉,주봉" && st.every(x=>!x.done&&!(Number(x.price)>0));
// 옛 단계 이름 'N분봉'은 60분봉 N이평선을 뜻했다 — 읽을 때 'N선'으로 보고, 처음 고칠 때 editRebuy·editFutureRebuy가 저장한다
// (불러올 때 바꾸면 기록이 바뀌어 기록 차이 창이 뜸). 바꿀 이름이 있으면 사본을 돌려주므로 단계를 고칠 때는 저장된 r.stages에 쓸 것.
const stageName = name => movingLineName(name)||name;
const renamedStages = st => st.some(x=>stageName(x?.name)!==x?.name) ? st.map(x=>stageName(x?.name)!==x?.name?{...x,name:stageName(x.name)}:x) : st;
const stagesOf = r => untouchedOldStages(r.stages) ? defaultRebuy().stages : Array.isArray(r.stages) ? renamedStages(r.stages) : [];
const wholeShares = v => Math.max(0,Math.floor(Number(v)||0));
// 재매수 통화: 미국 종목 코드(영문 심볼, prices.js usTicker)면 달러 — 가격은 미국 시세(달러, 센트까지), 보유 금액은 달러.
// 그 밖(국내 6자리 코드·코드 없음)은 원화(보유 금액은 만원).
const rebuyUsd = r => usTicker(r?.ticker);
// 이탈 전 보유는 입력칸 없이 자산 배분에서 불러온다. 플래너 화면(allocLink 있음)에서 손절·재매수 기록이 없으면 같은 종목 코드 계좌의 지금 보유(rebuyLiveHold),
// 그 밖(기록 뒤·자산 배분에 없는 종목·수집 작업)은 저장한 amount(국내 만원/미국 달러)·shares. 저장값은 입력 때 editRebuy가 맞추고(syncRebuyHold), 첫 손절 기록부터 고정된다.
const rebuyRecorded = r => Array.isArray(r?.cuts)&&r.cuts.some(Boolean) || stagesOf(r||{}).some(stageTouched);
const rebuyLiveHold = r => typeof allocLink==="object"&&r?.ticker&&!rebuyRecorded(r) ? rebuyHoldFromAlloc(allocLink.holding(r.ticker),rebuyUsd(r)) : null;
const holdOf = r => { const h=rebuyLiveHold(r); return h?{amount:h.unit==="amount"?h.value:0,shares:h.unit==="shares"?h.value:0}:{amount:Number(r.amount)||0,shares:r.shares}; };
// 이탈 전 주수 = 보유 금액÷신저점 가격을 내림, 또는 보유 수량. 둘 다 있으면 금액 우선.
const holdShares = r => { const {amount,shares}=holdOf(r); return amount>0 ? (Number(r.lowPrice)>0 ? Math.floor(amount*(rebuyUsd(r)?1:10000)/Number(r.lowPrice)+1e-9) : 0) : wholeShares(shares); };
// 보유 저장: 고른 단위의 값만 남기고 다른 단위 값은 지운다(수량은 정수 주). 0·빈칸이면 둘 다 지움. 잘못된 값이면 false
function setHold(r, unit, text){
  let v=text===""?0:Number(text); if(!(v>=0))return false;
  const [key,other]=unit==="shares"?["shares","amount"]:["amount","shares"]; if(key==="shares")v=Math.floor(v);
  if(v>0){r[key]=v;delete r[other];}else{delete r.amount;delete r.shares;}
}
// k회 가격=신저점×(1−k×stepPct%), 주수=round(이탈 전 주수×sellPct%×k)의 인접 차이(정수 균등 배분).
// cuts[i]={shares,price} 체결은 기록량을 사용. 부분 체결만 partial·plannedShares로 잔량을 고정한다(입력 때 생성).
// 체결량 수정은 다음 예정량을 바꾸지 않으며 남은 보유량이 한도. 옛 기록은 계속 완료로 읽는다.
// 표시 회차에는 수치 상한을 두지 않는다. 신저점 대비 누적 하락이 100% 미만인 회차만 만들되, 이미 기록한 회차는 유지한다.
// 재매수를 시작한 뒤 마지막 기록 뒤의 회차는 run(rebuyCutRun)의 기준 보유로 같은 비율을 나누고 그 보유가 한도다.
function cutPlan(r,run=rebuyCutRun(r)){
  const low=Number(r.lowPrice)||0, step=Number(r.stepPct)>0?Number(r.stepPct):1, pct=Math.min(Math.max(Number(r.sellPct)||0,0),100), cuts=Array.isArray(r.cuts)?r.cuts:[];
  const lastDone=cuts.reduce((m,c,i)=>c?i+1:m,0), n=Math.max(1,lastDone,Math.min(Math.floor(Number(r.steps)||30),Math.ceil(100/step)-1));
  const hold=holdShares(r), goal=(h,k)=>Math.round(h*pct*k/100); // k회까지 누적 예정 수량(정수 주)
  let left=hold, runLeft=run?.left??0;
  return Array.from({length:n},(_,i)=>{
    const k=i+1, rec=cuts[i], price=Math.max(0,low*(1-k*step/100));
    if(rec){const qty=wholeShares(rec.shares);left=Math.max(0,left-qty);return {k,drop:k*step,price,qty,left,done:!rec.partial,recorded:true,plannedQty:wholeShares(rec.plannedShares??qty),execPrice:Number(rec.price)>0?Number(rec.price):null};}
    if(run&&i>=lastDone){const qty=Math.min(runLeft,goal(run.base,k)-goal(run.base,k-1));runLeft-=qty;return {k,drop:k*step,price,qty,left:runLeft,done:false,execPrice:null};}
    const qty=Math.min(left,goal(hold,k)-goal(hold,k-1));left-=qty;
    return {k,drop:k*step,price,qty,left,done:false,execPrice:null};
  });
}
const rebuyBought = r => stagesOf(r).reduce((n,x)=>n+stageFills(x,"shares").reduce((m,f)=>m+f.qty,0),0);
// 재매수 뒤 남은 손절(재이탈)의 기준 보유 {base, left, cont, start}: 다음 손절은 그때 보유(이탈 전 보유 − 손절 + 재매수)의 sellPct%씩, 그 보유가 한도.
// 재이탈 손절을 기록한 뒤 그 재이탈의 재매수가 아직 없으면 같은 재이탈로 보고 재이탈 직전 보유를 유지한다(cont: true, 한도는 그 뒤 손절을 뺀 값).
// start: 이 기준으로 파는 첫 손절 회차의 위치(cuts 인덱스, 이어지는 재이탈은 그 첫 손절, 아니면 마지막 기록 다음).
// 재매수 전이거나 손절 기록이 없으면 null(이탈 전 보유 기준 그대로). 조회만 하며 기록을 바꾸지 않는다.
function rebuyCutRun(r,hold=holdShares(r)){
  const cuts=Array.isArray(r?.cuts)?r.cuts:[],bought=rebuyBought(r);
  if(!bought||!cuts.some(Boolean))return null;
  const shares=list=>list.reduce((n,c)=>n+wholeShares(c?.shares),0),cycle=etfRebuyResume(r,stagesOf(r));
  if(cycle&&!cycle.bought){const base=Math.max(0,hold-shares(cuts.slice(0,cycle.start))+bought);return {base,left:Math.max(0,base-shares(cuts.slice(cycle.start))),cont:true,start:cycle.start};}
  const base=Math.max(0,hold-shares(cuts)+bought);return {base,left:base,cont:false,start:cuts.reduce((m,c,i)=>c?i+1:m,0)};
}
// 손절 규칙 미리보기: 재매수 전에는 실제 체결을 제외한 cutPlan의 정수 배분에서 원래 보유의 50%·100% 이상을 처음 파는 회차(계획 기준, base: null).
// 회차 상한 없이 round(보유×회당 비중×k/100)이 목표 주수 이상인 첫 k를 직접 찾고, 반올림 경계의 오차를 보정한다.
// 재매수를 시작한 뒤에는 rebuyCutRun의 기준 보유(base)의 50%·100%를 이 기준으로 이미 판 손절과 화면의 남은 회차 수량으로 처음 넘기는 회차다.
// 이미 넘었으면 넘긴 기록 회차를 reached로 표시한다. sold는 이 기준으로 판(팔) 누적 수량.
// 손절가가 0원 이하인 기준은 미도달로 표시한다. 표시 회차 밖 기준은 실행 계획에 포함되지 않는다고 표시한다.
// 조회만 하며 기존 기준·체결 기록·계산을 바꾸지 않는다.
function cutMilestones(r){
  const hold=holdShares(r),ready=Number.isFinite(Number(r.lowPrice))&&Number(r.lowPrice)>0&&Number.isFinite(hold)&&hold>0;
  if(!ready)return {ready:false,points:[]};
  const step=Number(r.stepPct)>0?Number(r.stepPct):1,pct=Math.min(Math.max(Number(r.sellPct)||0,0),100),low=Number(r.lowPrice),maxRounds=Math.max(0,Math.ceil(100/step)-1);
  const run=rebuyCutRun(r,hold),point=(targetPct,k,sold)=>{const drop=k*step,price=low*(1-drop/100);return {pct:targetPct,drop,price,sold,ok:Number.isSafeInteger(k)&&price>0};};
  if(run&&run.base>0){
    const base=run.base,rows=cutPlan(r,run),cuts=Array.isArray(r.cuts)?r.cuts:[],lastDone=cuts.reduce((m,c,i)=>c?i+1:m,0),already=base-run.left;
    const g=k=>Math.round(base*pct*k/100),from=g(lastDone),sold=k=>already+Math.min(run.left,g(k)-from);
    return {ready:true,rounds:rows.length,sold:rows.slice(run.start).reduce((n,c)=>n+c.qty,0),hold,base:{hold:base,cont:run.cont},
      points:[50,100].map(targetPct=>{
        const target=Math.ceil(base*targetPct/100);let k,reached=false,total;
        if(already>=target){total=0;k=run.start;while(k<lastDone&&total<target)total+=wholeShares(cuts[k++]?.shares);reached=true;}
        else{const need=target-already+from;k=pct>0?Math.max(lastDone+1,Math.ceil((need-0.5)*100/(base*pct))):Infinity;
          if(Number.isSafeInteger(k)){if(k>lastDone+1&&g(k-1)>=need)k--;if(g(k)<need)k++;}total=Number.isSafeInteger(k)?sold(k):0;}
        const p=point(targetPct,k,total);
        return {pct:targetPct,cut:p.ok?{k,drop:p.drop,price:p.price,sold:total,...(reached?{reached:true}:{})}:null,inPlan:p.ok&&k<=rows.length,maxRounds};
      })};
  }
  const planned=cutPlan({...r,cuts:[]}),goal=k=>Math.min(hold,Math.round(hold*pct*k/100));
  return {ready:true,rounds:planned.length,sold:planned.reduce((n,c)=>n+c.qty,0),hold,base:null,
    points:[50,100].map(targetPct=>{
      const target=Math.ceil(hold*targetPct/100);let k=pct>0?Math.max(1,Math.ceil((target-0.5)*100/(hold*pct))):Infinity;
      if(Number.isSafeInteger(k)){if(k>1&&goal(k-1)>=target)k--;if(goal(k)<target)k++;}
      const p=point(targetPct,k,goal(k)),cut=p.ok?{k,drop:p.drop,price:p.price,sold:goal(k)}:null;
      return {pct:targetPct,cut,inPlan:!!cut&&k<=planned.length,maxRounds};
    })};
}
// 단계별 예상 가격: 산 단계는 체결가, 기준가가 있는 단계(마지막 포함)는 그 값, 나머지는 앞뒤 값 사이를 고르게 채운다.
// 아직 안 산 첫 단계 바로 앞에 start(현재가 등)를 둔다. 뒤쪽에 아는 값이 없는 단계는 추정하지 않는다(null).
function stageEstimates(stages,start){
  const est=stages.map(x=>x.done?(Number(x.execPrice)>0?Number(x.execPrice):null):(Number(x.price)>0?Number(x.price):null)), first=stages.findIndex(x=>!x.done);
  if(first<0)return est;
  const anchors=[[first-1,start>0?start:null],...est.map((v,i)=>[i,v]).filter(([i,v])=>i>=first&&v!=null)].filter(([,v])=>v!=null);
  for(let i=first;i<stages.length;i++){
    if(est[i]!=null)continue;
    const prev=anchors.filter(([j])=>j<i).pop(), next=anchors.find(([j])=>j>i);
    est[i]=prev&&next?prev[1]+(next[1]-prev[1])*(i-prev[0])/(next[0]-prev[0]):null;
  }
  return est;
}
const TRANCHES = 3; // 단계마다 다음 단계 가격까지 나눠 사는 횟수
// 단계의 회차별 체결 [{t, qty, price}]. 새 기록은 buys[t] = {shares|contracts, price}.
// 옛 기록(단계를 통째로 체크한 done·shares|contracts·execPrice)은 1회차 하나로 보고 그 단계를 끝난 것으로 본다(나머지 회차 없음).
function stageFills(x,key){
  const qty=v=>Math.max(0,Math.floor(Number(v)||0)), px=v=>Number(v)>0?Number(v):null;
  if(x.done)return [{t:0,qty:qty(x[key]),price:px(x.execPrice)}];
  return (Array.isArray(x.buys)?x.buys:[]).map((b,t)=>b&&typeof b==="object"?{t,qty:qty(b[key]),price:px(b.price)}:null).filter(Boolean);
}
const stageTouched = x => !!x?.done || Array.isArray(x?.buys) && x.buys.some(Boolean);
// 달러선물 대상 단계 수: 첫 단계(기본 25선)부터 연속한 평균 손절가(avg) 이하 단계, 별도 상한 없음. 최소 1(첫 단계가 위면 첫 단계만 후보).
// 기준가가 없는 단계에서 끊는다. 산 단계는 이어진 것으로 본다(회차 계획 r.planned가 없는 옛 기록용).
function rebuySplits(stages,avg){
  let n=0;while(n<stages.length&&(stageTouched(stages[n])||Number(stages[n].price)>0&&Number(stages[n].price)<=avg))n++;
  return Math.max(1,n);
}
// 단계 i의 회차 가격: 단계 가격에서 다음 단계 가격까지 t/3 지점(t = 0·1·2, step: true).
// 다음 단계 가격을 모르거나 단계 가격 이하면 나눌 구간이 없어 그 단계는 1회(단계 가격)로 산다(2·3회차 step: false).
// 비운 가격은 앞뒤 기준 사이 추정치(est: true)로 표시/수량 어림만; 배분·알림은 제외(rebuyPlanned fallback 제외).
function trancheLevels(stages,est,i){
  const own=Number(stages[i]?.price)>0, p=own?Number(stages[i].price):est[i]??null, n=stages[i+1], nextOwn=Number(n?.price)>0, q=!n?null:nextOwn?Number(n.price):est[i+1]??null;
  const prices=lineThirds(p,q);
  return Array.from({length:TRANCHES},(_,t)=>{
    if(p==null)return {price:null,est:true,step:false};
    const step=t>0&&prices.length>t;
    return {price:step?prices[t]:p,est:!own||step&&!nextOwn,step};
  });
}
// 단계 i에서 살 수 있는 회차 [{t, price, est, step}]: 1회차와 나눌 구간이 있는 2·3회차. 옛 통째 기록 단계는 1회차만.
const stageCandidates = (stages,est,i) => trancheLevels(stages,est,i).map((x,t)=>({t,...x})).filter(x=>x.t===0||x.step&&!stages[i].done);
// 달러선물 회차 계획 [[i, t]…]: 대상 단계(rebuySplits)의 실제 회차 가격이 평균 손절가 이하인 회차. 없으면 첫 단계 1차 하나.
function rebuyPlanned(stages,est,avg){
  if(!stages.length)return [];
  const out=[],n=rebuySplits(stages,avg);
  for(let i=0;i<n;i++)for(const x of stageCandidates(stages,est,i))if(x.price>0&&!x.est&&x.price<=avg)out.push([i,x.t]);
  return out.length?out:[[0,0]]; // 평균 손절가 이하 회차가 없으면 첫 단계 1차에서 한 번에(2·3차는 더 비싸다)
}
// 재매수 회차 목록 [{i, t, price, est, step, done, qty, execPrice, amount}]: 체결한 회차 + 계획 회차. 계획을 다 샀는데 남았으면 계획 뒤 첫 안 산 단계의 1회차.
// 남은 수량(rest)은 안 산 회차에 split(수량, 회차 수)로 나눈다. 산 회차의 amount는 부르는 쪽이 채운다.
// ETF 부분 회차는 고정 예정 주수의 잔량×체결가를 먼저 남겨 두고, 나머지 금액만 새 회차에 나눈다. 선물은 기존 정수 계약 배분 그대로.
function rebuyTranches(stages,est,fills,planned,rest,split,levels=trancheLevels,allowNext=true){
  const list=[], seen=new Set(), add=(i,t,rec)=>{const k=`${i}:${t}`;if(!stages[i]||seen.has(k))return;seen.add(k);list.push({i,t,...levels(stages,est,i)[t],done:!!rec&&!rec.partial,qty:rec?.qty??0,execPrice:rec?.price??null,amount:0,...(rec?.partial?{partial:true,plannedQty:rec.plannedQty}: {})});};
  fills.forEach((f,i)=>f.forEach(rec=>add(i,rec.t,rec)));
  planned.forEach(([i,t])=>{if(!stages[i]?.done)add(i,t,null);});
  if(allowNext&&rest>0&&!list.some(x=>!x.done)){const last=Math.max(-1,...list.map(x=>x.i)),j=stages.findIndex((x,i)=>i>last&&!stageTouched(x));if(j>=0)add(j,0,null);}
  list.sort((a,b)=>a.i-b.i||a.t-b.t);
  const partial=list.filter(x=>x.partial);let available=rest;
  partial.forEach(x=>{x.amount=Math.min(available,Math.max(0,x.plannedQty-x.qty)*(x.execPrice||x.price||0));available=Math.max(0,available-x.amount);});
  const open=list.filter(x=>!x.done&&!x.partial), parts=available>0&&open.length?split(available,open.length):[];
  open.forEach((x,k)=>{x.amount=parts[k]??0;});
  return list;
}
// 달러선물 표시용: 계획이 있는 단계에서 평균 손절가 위(또는 추정 가격)라 사지 않는 회차
const rebuySkipped = (stages,est,list) => [...new Set(list.map(x=>x.i))].filter(i=>!stages[i].done).flatMap(i=>stageCandidates(stages,est,i).filter(x=>!list.some(y=>y.i===i&&y.t===x.t)).map(x=>({i,...x})));
// 첫 재매수 때 고정한 r.planned=[[단계 이름,회차]…]를 현재 [i,t]로 읽음. 모든 체크 해제/초기화 때 지움; 기한 없음.
function storedPlan(r,stages){
  const list=(Array.isArray(r.planned)?r.planned:[]).map(x=>Array.isArray(x)?[stages.findIndex(y=>y.name===stageName(x[0])),Number(x[1])]:null).filter(x=>x&&x[0]>=0&&Number.isInteger(x[1])&&x[1]>=0&&x[1]<TRANCHES);
  return list.length?list:null;
}
// n회로 나누기: 금액은 똑같이, 계약은 누적 반올림 차이로 고르게 흩는다(3계약 5회면 1·0·1·0·1 — 앞 회차에만 몰리지 않게).
const splitValue = (v,n) => Array(n).fill(v/n);
const splitWhole = (v,n) => Array.from({length:n},(_,k)=>Math.round(v*(k+1)/n)-Math.round(v*k/n));
// ETF는 평균 손절가로 실제 마지막 평균선을 고르되, 같은 평균선의 후속 회차는 손절가로 자르지 않는다.
// rounds(1~3)를 직접 고르면 그 회차까지 유지하며, prices[t]는 해당 회차의 직접 기준가(1차는 단계 price).
// 다음 선을 모르는 직접 설정 회차는 가격 입력 대기; 추정가로 매수·알림을 실행하지 않는다.
const etfRebuyRounds = x => Number.isInteger(x?.rounds)&&x.rounds>=1&&x.rounds<=TRANCHES?x.rounds:null;
const etfRebuyCondition = x => x?.buyCondition==="down"?"down":"up";
const etfRangeOf = r => r?.range&&typeof r.range==="object"&&!Array.isArray(r.range)?r.range:null;
const etfRebuyTargetPct = r => {const n=Number(etfRangeOf(r)?.targetPct);return n>0&&n<=100?n:100;};
function etfRangeNames(stages,range){
  if(!range)return null;
  const names=Array.isArray(range.names)?range.names:stages.map(x=>movingLineName(x.name)).filter(Boolean);
  return movingLineRange([...new Set([range.startLine,...names])],range.startLine,range.lastLine);
}
// 저장 범위는 최대 범위다. 시작선부터 실제 기준가가 평균 손절가 이하로 이어지는 선까지만 배분한다.
// 시작선이 이미 위거나 가격이 없으면 시작선만 유지한다. 그 뒤 가격이 다시 낮아져도 매수를 재개하지 않는다.
// 체결·부분 체결은 이 선택과 별도로 rebuyTranches에서 보존한다. 실제 매수 입력 때 고정한 종료선은 시세가 변해도 유지한다.
// 범위 없는 옛 기록의 단계 선택은 그대로다. 고정 필드는 조회·복원 때 만들지 않는다.
// 재이탈(from = etfRebuyResume().from)은 시작선 대신 from부터 같은 규칙을 쓴다. from이 범위 밖이면 그 선 하나, 범위가 없으면 저장 순서 끝까지 이어 보며 -1이면 없음.
function etfRebuyStageIndices(stages,avg=Infinity,range=null,lastLine=null,from=null){
  if(from!=null&&from<0)return [];
  if(!range&&from==null)return stages.map((_,i)=>i).slice(0,rebuySplits(stages,avg));
  const indices=range?etfRangeNames(stages,range).map(name=>stages.findIndex(st=>st.name===name)).filter(i=>i>=0):stages.map((_,i)=>i);
  const at=from==null?0:indices.indexOf(from),seq=at<0?[from]:indices.slice(at);
  const fixed=seq.findIndex(i=>stages[i].name===lastLine);if(fixed>=0)return seq.slice(0,fixed+1);
  let n=0;while(n<seq.length&&Number(stages[seq[n]].price)>0&&Number(stages[seq[n]].price)<=avg)n++;
  return seq.slice(0,Math.max(1,n));
}
// 재이탈: 재매수를 시작한 뒤 기존 기록보다 깊은 새 손절은 그 손절 기록에 그때까지 재매수한 마지막 단계 이름(afterLine)과,
// 그 단계에 계획 회차가 남았으면 산 마지막 회차 번호(afterRound, 1부터)를 남긴다(입력 때만, etfResumeMark·rebuyCutRecord).
// afterRound가 있으면 그 단계의 다음 회차부터(round = afterRound, 0부터 센 회차), 없으면 다음 선(round = 0)부터 다시 배분하고,
// 그 앞의 회차·선은 가격이 다시 와도 새로 사지 않는다. 선 순서는 범위가 있으면 범위의 다음 선(마지막 선 뒤면 다음 평균선), 없으면 저장 순서.
// 다음 선이 없으면 from = -1(새 배분 없음). 표시가 가리키는 단계가 없거나 그 체결이 지워졌으면 그 앞 손절의 표시를 본다.
// 손절 기록을 지우면 표시도 같이 지워져 이전 계획으로 돌아간다. start: 이번 재이탈의 첫 손절 기록(같은 표시가 이어진 시작).
// bought: 재개 지점 뒤에 체결이 있음 — 이번 재매수의 종료선(범위는 resumeEndLine, 범위 없으면 r.planned)은 그 첫 체결 때 고정한다.
const etfRebuyRank = (stages,i,range) => {const n=range&&movingLineName(stages[i]?.name);return n?MA_UNITS.indexOf(movingLineUnit(n))*500+parseInt(n):i;};
function etfResumeMark(r,s=rebuySummary(r)){
  const stages=s.stages,range=etfRangeOf(r);let at=-1;
  stages.forEach((st,i)=>{if(stageTouched(st)&&(at<0||etfRebuyRank(stages,i,range)>etfRebuyRank(stages,at,range)))at=i;});
  if(at<0)return null;
  const last=Math.max(...stageFills(stages[at],"shares").map(f=>f.t));
  return {afterLine:stages[at].name,...(s.tranches.some(x=>x.i===at&&x.t>last)?{afterRound:last+1}:{})};
}
// 재이탈 안내 글자(화면·범위 창 공통, 이스케이프는 호출부): 건너뛴 부분과 다시 시작할 회차.
const etfSkipText = (after,round,done) => round?`${after} ${round}회차까지 ${done?"건너뜀":"건너뛰고"}`:`${after}까지 산 선${done?"은 건너뜀":"을 건너뛰고"}`;
const etfResumeName = s => !s.cycle||s.cycle.from<0?"":s.cycle.round?`${s.cycle.after} ${s.cycle.round+1}회차`:s.stages[s.cycle.from].name;
function etfRebuyResume(r,stages){
  const cuts=Array.isArray(r?.cuts)?r.cuts:[],marked=c=>typeof c?.afterLine==="string"&&c.afterLine?stages.findIndex(st=>st.name===stageName(c.afterLine)&&stageTouched(st)):-1;
  let cut=cuts.length-1;while(cut>=0&&marked(cuts[cut])<0)cut--;if(cut<0)return null;
  const mark=cuts[cut],at=marked(mark),round=Number.isInteger(mark.afterRound)&&mark.afterRound>=1&&mark.afterRound<TRANCHES?mark.afterRound:0;
  let start=cut;while(start>0&&(!cuts[start-1]||cuts[start-1].afterLine===mark.afterLine&&cuts[start-1].afterRound===mark.afterRound))start--;
  const range=etfRangeOf(r),line=range?etfRangeNames(stages,range).map(n=>stages.findIndex(st=>st.name===n)).filter(i=>i>=0):null,k=line?line.indexOf(at):-1;
  const from=round?at:line?(k>=0&&k+1<line.length?line[k+1]:etfNextStage(stages,at,true)):at+1<stages.length?at+1:-1;
  const after=(i,st)=>etfRebuyRank(stages,i,range)>etfRebuyRank(stages,at,range)||round>0&&i===at&&stageFills(st,"shares").some(f=>f.t>=round);
  return {after:stages[at].name,at,round,from,start,bought:stages.some((st,i)=>stageTouched(st)&&after(i,st))};
}
// 범위 밖의 다음 평균선은 회차 가격 계산용으로 남긴다. 순서를 바꿔도 다음 기간으로 연결한다.
const etfRangeNextKey = Symbol("etfRangeNext");
function etfNextStage(stages,i,ordered=false){
  if(!ordered)return Number.isInteger(stages[i]?.[etfRangeNextKey])?stages[i][etfRangeNextKey]:i+1<stages.length?i+1:-1;
  const name=movingLineName(stages[i]?.name);if(!name)return i+1<stages.length?i+1:-1;
  const order=n=>MA_UNITS.indexOf(movingLineUnit(n))*500+parseInt(n),after=stages.map((st,j)=>({j,name:movingLineName(st.name)})).filter(x=>x.name&&order(x.name)>order(name)).sort((a,b)=>order(a.name)-order(b.name));
  return after[0]?.j??-1;
}
// 범위 조건과 실제 마지막 선의 지정 회차를 계산용 사본에 적용한다. 저장된 단계별 조건·비중·기록은 고치지 않는다.
// 재이탈 중에는 범위 밖 다음 선에도 같은 조건을 적용하고, 앞 재매수의 고정 종료선(체결한 plannedEndLine·resumeEndLine)도 지정 회차를 유지한다.
function etfRangeStages(r,stages,avg=Infinity){
  const range=etfRangeOf(r),names=etfRangeNames(stages,range);if(!range)return stages;
  const cycle=etfRebuyResume(r,stages),indices=cycle?etfRebuyStageIndices(stages,avg,range,cycle.bought?r.resumeEndLine:null,cycle.from):etfRebuyStageIndices(stages,avg,range,stages.some(stageTouched)?r.plannedEndLine:null);
  const prev=cycle?[r.plannedEndLine,r.resumeEndLine].map(name=>stages.findIndex(st=>st.name===name&&stageTouched(st))).filter(i=>i>=0&&!indices.includes(i)):[],ends=new Set([indices.at(-1),...prev]);
  // 같은 선의 다음 회차부터 재개하면 그 회차는 지정 회차가 작아도 남긴다.
  const rounds=i=>i===cycle?.from&&cycle.round?Math.max(range.lastRound||3,cycle.round+1):range.lastRound||3;
  return stages.map((st,i)=>names.includes(st.name)||indices.includes(i)?{...st,[etfRangeNextKey]:etfNextStage(stages,i,true),...(["up","down"].includes(range.condition)?{buyCondition:range.condition}:{}),...(ends.has(i)?{rounds:rounds(i)}:{})}:st);
}
function etfTrancheLevels(stages,est,i){
  const st=stages[i],rounds=etfRebuyRounds(st),j=etfNextStage(stages,i),next=stages[j],base=trancheLevels([st,next],[est[i],est[j]],0);
  if(etfRebuyCondition(st)==="down"){
    const p=Number(st.price)>0?Number(st.price):est[i],q=Number(next?.price)>0?Number(next.price):est[j],prices=lineThirds(p,q,"down");
    base.forEach((x,t)=>{if(t){x.step=prices.length>t;x.price=x.step?prices[t]:p;x.est=!(Number(st.price)>0)||x.step&&!(Number(next?.price)>0);}});
  }
  return base.map((x,t)=>{
    const override=t>0&&Number(st.prices?.[t])>0&&Number.isFinite(Number(st.prices[t]));
    if(override)return {...x,price:Number(st.prices[t]),est:false,step:true,manual:true};
    return rounds&&t>0&&!x.step?{price:null,est:true,step:true}:x;
  });
}
const etfStageCandidates = (stages,est,i) => etfTrancheLevels(stages,est,i).map((x,t)=>({t,...x})).filter(x=>stages[i].done?x.t===0:etfRebuyRounds(stages[i])?x.t<stages[i].rounds:x.t===0||x.step);
// 최대 범위 안에서 평균 손절가로 고른 실제 마지막 선의 lastRound까지 배분한다. 그 선의 후속 회차는 손절가와 무관하게 유지한다.
// 다음 평균선의 도달 회차는 별도 단계이므로 포함하지 않는다. 조회 때 단계·기록을 삭제하거나 저장하지 않는다.
function etfRebuyPlanned(stages,est,avg=Infinity,range=null,lastLine=null,from=null,round=0){
  const out=[];
  for(const i of etfRebuyStageIndices(stages,avg,range,lastLine,from))for(const x of etfStageCandidates(stages,est,i))if(!(i===from&&x.t<round)&&(range||x.price>0&&!x.est||etfRebuyRounds(stages[i])))out.push([i,x.t]);
  return out.length||range?out:from==null?(stages.length?[[0,0]]:[]):from>=0?[[from,round]]:[];
}
// 옛 고정 계획의 단계 선택은 유지하되 평균 손절가 때문에 빠진 같은 단계의 후속 회차를 복구한다. 저장 기록은 변경하지 않는다.
// 재이탈 중에는 재개 지점 앞의 고정 계획을 쓰지 않고, 재이탈 뒤 첫 체결 때 고정한 계획(범위 없음: 재개 지점 이후 r.planned)만 따른다.
const etfResumeAfter = (cycle,i,t) => i>cycle.from||i===cycle.from&&t>=cycle.round; // 범위 없는 기록(저장 순서)의 재개 지점 이후 회차
function etfRebuyPlan(r,stages,est,started,avg=Infinity){
  const range=etfRangeOf(r),cycle=etfRebuyResume(r,stages);
  const allowed=etfRebuyPlanned(stages,est,avg,range,cycle?(cycle.bought?r.resumeEndLine:null):started?r.plannedEndLine:null,cycle?cycle.from:null,cycle?.round||0);
  const saved=cycle?cycle.bought&&cycle.from>=0&&storedPlan(r,stages)?.filter(([i,t])=>etfResumeAfter(cycle,i,t)):started&&storedPlan(r,stages);
  if(!saved?.length||range)return allowed;
  const out=[...saved]; // 고정한 옛 범위는 시세가 움직여도 줄이지 않는다. 새 범위를 저장하면 allowed만 적용한다.
  for(const i of new Set(out.map(x=>x[0])))for(const x of etfStageCandidates(stages,est,i))if((x.price>0&&!x.est||etfRebuyRounds(stages[i]))&&!out.some(([j,t])=>j===i&&t===x.t))out.push([i,x.t]);
  return out.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}
// 비중은 단계별 상대 비중을 100%로 환산하고 그 단계의 회차에 균등 배분한다.
// 비중 없는 옛 설정은 회차 수에 비례(회차별 같은 금액). 완료·부분 체결에 예약한 금액은 재배분하지 않는다.
function etfRebuyWeights(stages,planned){
  const count=stages.map((_,i)=>planned.filter(x=>x[0]===i).length),total=count.reduce((n,v)=>n+v,0)||1;
  return stages.map((st,i)=>Number(st.weight)>0&&Number.isFinite(Number(st.weight))?Number(st.weight):count[i]*100/total);
}
function weightEtfRebuyTranches(stages,planned,list){
  if(!stages.some(st=>Number(st.weight)>0))return;
  const weights=etfRebuyWeights(stages,planned),open=list.filter(x=>!x.done&&!x.partial),available=open.reduce((n,x)=>n+x.amount,0);
  const w=x=>(weights[x.i]||100/Math.max(1,planned.length))/Math.max(1,planned.filter(([i])=>i===x.i).length),total=open.reduce((n,x)=>n+w(x),0);
  open.forEach(x=>{x.amount=total?available*w(x)/total:0;});
}
const futureRebuyQty = v => Number.isFinite(Number(v)) ? Math.max(0,Math.floor(Number(v))) : 0;
const futureRebuyOf = f => f?.rebuy&&typeof f.rebuy==="object"&&!Array.isArray(f.rebuy)?f.rebuy:{};
// 예전 '손절 환율 복귀' 방식(buyMode·returns[손절 회차])으로 체크한 재매수는 환율 복귀 때 다음 반등 단계에서 산 것과 같다.
// 읽을 때는 첫 미완료 단계에 합쳐 보여 주기만 하고(기록은 그대로), 처음 고칠 때 editFutureRebuy가 stages로 옮긴다. 옛 단계 이름 'N분봉'도 같은 방식(renamedStages).
function futureRebuyStages(r){
  const stages=Array.isArray(r.stages)?renamedStages(r.stages):defaultRebuy().stages,old=(Array.isArray(r.returns)?r.returns:[]).filter(x=>x?.done&&futureRebuyQty(x.contracts)>0);
  if(!old.length)return stages;
  const qty=old.reduce((n,x)=>n+futureRebuyQty(x.contracts),0),priced=old.filter(x=>Number(x.execPrice)>0),pq=priced.reduce((n,x)=>n+futureRebuyQty(x.contracts),0);
  const rec={done:true,contracts:qty,execPrice:pq?priced.reduce((n,x)=>n+futureRebuyQty(x.contracts)*Number(x.execPrice),0)/pq:null},i=stages.findIndex(x=>!x.done);
  return i<0?[...stages,{name:"손절 환율 복귀",price:0,...rec}]:stages.map((x,j)=>j===i?{...x,...rec}:x);
}
function futureRebuyHold(f){
  const r=futureRebuyOf(f);if(Object.hasOwn(r,"contracts"))return futureRebuyQty(r.contracts);
  const held=(Array.isArray(f?.positions)?f.positions:[]).reduce((n,p)=>n+futureRebuyQty(p.contracts),0);
  return held+(Array.isArray(f?.levels)?f.levels:[]).flatMap(l=>Array.isArray(l.tranches)?l.tranches:[]).filter(t=>t.completed&&!t.mergedMonth).length;
}
// 손절 목표 = floor(고정 이탈 전 계약 × sellPct/100). 비중은 0~100%, 옛 기록·빈 입력은 50%; 읽을 때 필드를 만들지 않는다.
const futureRebuySellPct = f => {const raw=futureRebuyOf(f).sellPct,v=Number(raw);return raw==null||raw===""||!Number.isFinite(v)||v<0||v>100?50:v;};
const futureCutGoal = (f,pct=futureRebuySellPct(f)) => Math.floor(futureRebuyHold(f)*pct/100+1e-9);
// 신저점~직접 하단을 고르게 나눠 손절 목표 계약만 손절. 회차 수≤목표 계약, 1회면 하단.
// 체결량 수정 후 남은 목표는 미완료 회차의 원래 비중으로 재배분; 기존 체결은 유지.
// 모든 회차 체결 뒤 목표를 늘렸으면 남은 수량을 하단의 추가 회차에 배정한다.
function futureCutPlan(f){
  const r=futureRebuyOf(f),low=Number(r.lowPrice)||0,floor=Number(r.floorPrice)||0,hold=futureRebuyHold(f),goal=futureCutGoal(f),records=Array.isArray(r.cuts)?r.cuts:[];
  const valid=Number.isFinite(low)&&Number.isFinite(floor)&&low>floor&&floor>0&&goal>0;
  const lastDone=records.reduce((n,c,i)=>c?i+1:n,0),sold=records.reduce((n,c)=>n+futureRebuyQty(c?.contracts),0),rest=Math.max(0,goal-sold);
  let n=Math.max(lastDone,valid?Math.min(60,Math.max(1,futureRebuyQty(r.steps)||10),goal):0);
  const finished=lastDone>0&&Number(records[lastDone-1]?.targetPrice)===floor&&Array.from({length:lastDone},(_,i)=>records[i]).every(Boolean);
  if(valid&&rest>0){if(finished)n=lastDone+1;else if(Array.from({length:n},(_,i)=>records[i]).every(Boolean))n++;}
  const nominal=i=>Math.round(goal*(i+1)/n)-Math.round(goal*i/n),weights=Array.from({length:n},(_,i)=>records[i]?0:nominal(i)),openWeight=weights.reduce((a,b)=>a+b,0);
  let pending=0,left=hold;
  return Array.from({length:n},(_,i)=>{
    const rec=records[i],target=valid?(n===1?floor:low-(low-floor)*i/(n-1)):0,price=Number(rec?.targetPrice)>0?Number(rec.targetPrice):target;
    const before=pending;pending+=weights[i];
    const qty=rec?futureRebuyQty(rec.contracts):valid&&openWeight?Math.round(rest*pending/openWeight)-Math.round(rest*before/openWeight):0;
    left=Math.max(0,left-qty);
    return {k:i+1,price,qty,left,done:!!rec,execPrice:Number(rec?.price)>0?Number(rec.price):null};
  });
}
// 판 계약만 복원. 평균 손절 환율은 실제 체결(없으면 회차 환율)의 계약 가중평균.
// ETF와 같은 rebuyPlanned·rebuyTranches, 계약은 splitWhole로 배분. 재매수 시작 후 손절 중단; 보유 월물/정산손익은 건드리지 않음.
function futureRebuySummary(f){
  const r=futureRebuyOf(f),hold=futureRebuyHold(f),sellPct=futureRebuySellPct(f),goal=futureCutGoal(f),cuts=futureCutPlan(f),done=cuts.filter(c=>c.done),cur=Number(r.currentPrice)||0;
  const stages=futureRebuyStages(r),fills=stages.map(x=>stageFills(x,"contracts")),all=fills.flat(),started=all.length>0;
  const sold=done.reduce((n,c)=>n+c.qty,0),rebought=all.reduce((n,x)=>n+x.qty,0),rest=Math.max(0,sold-rebought);
  const sellAvg=sold?done.reduce((n,c)=>n+(c.execPrice||c.price)*c.qty,0)/sold:null;
  const lastBuy=[...all].reverse().find(x=>x.price>0),start=cur>0?cur:lastBuy?lastBuy.price:sellAvg||0,est=stageEstimates(stages,start);
  const planned=started&&storedPlan(r,stages)||rebuyPlanned(stages,est,sellAvg);
  const tranches=rebuyTranches(stages,est,fills,planned,rest,splitWhole);
  tranches.forEach(x=>{if(x.done)x.amount=x.qty;});
  const plan=stages.map((x,i)=>tranches.reduce((n,y)=>y.i===i?n+y.amount:n,0));
  return {hold,sellPct,goal,cuts,stages,est,plan,tranches,skipped:rebuySkipped(stages,est,tranches),planKeys:planned.map(([i,t])=>[stages[i].name,t]),sold,rebought,rest,sellAvg,started,held:Math.max(0,hold-sold+rebought),doneCuts:done.length,doneTranches:tranches.filter(x=>x.done).length,
    ready:Number(r.lowPrice)>Number(r.floorPrice)&&Number(r.floorPrice)>0&&goal>0,overSold:sold>goal,overBought:rebought>sold};
}
// futures.rebuy는 최초 입력 때만 생성하고 이탈 전 계약 수를 고정(읽기/normalize는 생성·이전 안 함).
function editFutureRebuy(f){
  const hold=futureRebuyHold(f);
  if(f.rebuy!==futureRebuyOf(f))f.rebuy={};
  const r=f.rebuy;if(!Object.hasOwn(r,"contracts"))r.contracts=hold;
  if(!Array.isArray(r.cuts))r.cuts=[];
  r.stages=futureRebuyStages(r);delete r.returns;delete r.buyMode; // 예전 환율 복귀 방식 기록을 반등 단계로, 옛 이름 'N분봉'을 'N선'으로 옮김
  return r;
}
function futureRebuyBought(f){return futureRebuyStages(futureRebuyOf(f)).some(stageTouched);}
function futureRebuyLocked(f){const r=futureRebuyOf(f);return (Array.isArray(r.cuts)?r.cuts:[]).some(Boolean)||futureRebuyBought(f);}
// 비중은 손절 체결 뒤에도 이미 판 계약 이상으로 변경 가능(기존 체결 유지, 예정 회차만 재배분). 재매수 시작 뒤에는 고정.
// 비중을 비우면 필드를 지워 기본 50%로 돌아간다; 이 경우에도 이미 판 수량보다 목표가 작아지면 거절한다.
function setFutureRebuyField(f,key,text){
  if(!["lowPrice","floorPrice","contracts","sellPct","steps","currentPrice"].includes(key)||(key==="sellPct"?futureRebuyBought(f):key!=="currentPrice"&&futureRebuyLocked(f)))return false;
  const empty=text.trim()==="",v=empty?0:Number(text);if(!Number.isFinite(v)||v<0)return false;
  const r=futureRebuyOf(f);
  if(key==="sellPct"&&(v>100||futureCutGoal(f,empty?50:v)<(Array.isArray(r.cuts)?r.cuts:[]).reduce((n,c)=>n+futureRebuyQty(c?.contracts),0)))return false;
  if(key==="lowPrice"&&v>0&&Number(r.floorPrice)>0&&v<=Number(r.floorPrice)||key==="floorPrice"&&v>0&&Number(r.lowPrice)>0&&v>=Number(r.lowPrice))return false;
  if(key==="steps"&&(!Number.isInteger(v)||v<1||v>60)||key==="contracts"&&!Number.isInteger(v))return false;
  const edited=editFutureRebuy(f);if(v>0||key==="contracts"||key==="sellPct"&&!empty)edited[key]=v;else delete edited[key];
}
function setFutureCutDone(f,i,on){
  const s=futureRebuySummary(f),c=s.cuts[i];if(!c)return false;
  if(on){if(s.started||c.done||c.qty<1||s.sold+c.qty>s.goal)return false;editFutureRebuy(f).cuts[i]={contracts:c.qty,price:c.price,targetPrice:c.price};}
  else{if(!c.done||s.sold-c.qty<s.rebought)return false;editFutureRebuy(f).cuts[i]=null;}
}
function setFutureCutQty(f,i,text){
  const qty=Number(text),s=futureRebuySummary(f),c=s.cuts[i];
  if(!c?.done||text.trim()===""||!Number.isInteger(qty)||qty<1||s.sold-c.qty+qty>s.goal||s.sold-c.qty+qty<s.rebought)return false;
  editFutureRebuy(f).cuts[i].contracts=qty;
}
// 회차 체결 기록(옛 통째 기록은 단계 자체 — contracts·execPrice, 새 기록은 buys[t] — contracts·price). 고칠 수 있게 저장된 기록을 돌려준다.
function futureFillRec(f,i,t){const x=editFutureRebuy(f).stages[i];return !x?null:x.done?(t===0?[x,"execPrice"]:null):Array.isArray(x.buys)&&x.buys[t]?[x.buys[t],"price"]:null;}
// 회차 t를 체크하면 회차 가격(추정치면 현재 환율, 없으면 추정치)으로 기록한다. 첫 재매수 때 회차 계획(r.planned)을 고정한다.
function setFutureBuyDone(f,i,t,on){
  const s=futureRebuySummary(f),x=s.stages[i];if(!x)return false;
  if(on){
    const tr=s.tranches.find(y=>y.i===i&&y.t===t),qty=tr?.amount||0,cur=Number(futureRebuyOf(f).currentPrice)||0,round=v=>Math.round(v*100)/100,price=tr&&tr.price>0&&!tr.est?round(tr.price):cur>0?cur:tr?.price>0?round(tr.price):0;
    if(!tr||tr.done||qty<1||qty>s.rest||!(price>0)||!Number.isFinite(price))return false;
    const r=editFutureRebuy(f),st=r.stages[i];if(!s.started)r.planned=s.planKeys; // 첫 재매수 때 회차 계획을 고정
    if(!Array.isArray(st.buys))st.buys=[];while(st.buys.length<t)st.buys.push(null);st.buys[t]={contracts:qty,price};
  }else{
    const r=editFutureRebuy(f),st=r.stages[i];
    if(st.done&&t===0)Object.assign(st,{done:false,contracts:null,execPrice:null});
    else if(Array.isArray(st.buys)&&st.buys[t]){st.buys[t]=null;while(st.buys.length&&!st.buys.at(-1))st.buys.pop();if(!st.buys.length)delete st.buys;}
    else return false;
    if(!r.stages.some(stageTouched))delete r.planned;
  }
}
function setFutureBuyQty(f,i,t,text){
  const qty=Number(text),s=futureRebuySummary(f),tr=s.tranches.find(y=>y.i===i&&y.t===t);
  if(!tr?.done||text.trim()===""||!Number.isInteger(qty)||qty<1||s.rebought-tr.qty+qty>s.sold)return false;
  futureFillRec(f,i,t)[0].contracts=qty;
}
function setFutureBuyPrice(f,i,t,text){
  const n=Number(text),rec=futureFillRec(f,i,t);if(!rec||!Number.isFinite(n)||n<=0)return false;rec[0][rec[1]]=n;
}
// 손절 금액(수량×실제 체결가, 없으면 계획가)만 복원; 평균 손절가=금액÷주수(실제 마지막 평균선 선택용, 같은 선의 회차 가격 상한 아님).
// ETF 배분·회차·조건은 etfRebuyPlan·etfTrancheLevels·weightEtfRebuyTranches. 재매수를 시작해도 남은 손절 회차는 유지한다(재이탈 — etfRebuyResume).
// cycle: 재이탈 정보(없으면 null). fixPlan: 다음 재매수 체결 때 이번 재이탈 범위를 고정해야 함(applyRebuyBuy). skipped[].passed: 재이탈로 건너뛴 앞 회차.
// cutBase: 재매수 뒤 남은 손절의 기준 보유(rebuyCutRun, 재매수 전이면 null).
function rebuySummary(r){
  const run=rebuyCutRun(r),cuts=cutPlan(r,run),done=cuts.filter(c=>c.done||c.recorded),cur=Number(r.currentPrice)||0;
  const sellAt=c=>c.execPrice||c.price, sold=done.reduce((a,c)=>a+c.qty,0), sellValue=done.reduce((a,c)=>a+sellAt(c)*c.qty,0), sellAvg=sold?sellValue/sold:null;
  const stages=etfRangeStages(r,stagesOf(r),sellAvg),fills=stages.map(x=>stageFills(x,"shares").map(f=>{const rec=x.done?x:x.buys[f.t];return rec.partial?{...f,partial:true,plannedQty:wholeShares(rec.plannedShares)}:f;})),all=fills.flat(),started=all.length>0;
  const buyAt=x=>x.price>0?x.price:sellAvg||0, rebought=all.reduce((a,x)=>a+x.qty,0), buyValue=all.reduce((a,x)=>a+x.qty*buyAt(x),0);
  const priced=all.filter(x=>x.price>0&&x.qty>0), pq=priced.reduce((a,x)=>a+x.qty,0), buyAvg=pq?priced.reduce((a,x)=>a+x.qty*x.price,0)/pq:null;
  // 남은 재매수 금액. 반 주(평균 손절가의 절반) 미만 자투리는 다 산 것으로 보되, 부분 회차의 양수 잔액은 남겨 둔다.
  const buyTarget=sellValue*etfRebuyTargetPct(r)/100,left=buyTarget-buyValue, rest=sold&&(all.some(x=>x.partial)&&left>0||left>=sellAvg/2)?Math.max(0,left):0;
  const lastBuy=[...all].reverse().find(x=>x.price>0), start=cur>0?cur:lastBuy?lastBuy.price:sellAvg||0, est=stageEstimates(stages,start);
  const planned=etfRebuyPlan(r,stages,est,started,sellAvg);
  const tranches=rebuyTranches(stages,est,fills,planned,rest,splitValue,etfTrancheLevels,false); // 범위 다음 단계로 남은 금액을 자동 배정하지 않는다.
  weightEtfRebuyTranches(stages,planned,tranches);
  tranches.forEach(x=>{if(x.done)x.amount=x.qty*(x.execPrice>0?x.execPrice:sellAvg||0);}); // 산 회차는 체결가(없으면 손절 평균가)로
  const plan=stages.map((x,i)=>tranches.reduce((a,y)=>y.i===i?a+y.amount:a,0)); // 단계별 금액(원)
  const cycle=etfRebuyResume(r,stages),range=etfRangeOf(r),rank=i=>etfRebuyRank(stages,i,range);
  const passed=(i,t)=>!!cycle&&(rank(i)<rank(cycle.at)||i===cycle.at&&(!cycle.round||t<cycle.round));
  const skipped=stages.flatMap((st,i)=>stageTouched(st)||planned.some(([j])=>j===i)?etfStageCandidates(stages,est,i).filter(x=>!tranches.some(y=>y.i===i&&y.t===x.t)).map(x=>({i,...x,...(passed(i,x.t)?{passed:true}:{})})):[]);
  const planKeys=planned.map(([i,t])=>[stages[i].name,t]),fixPlan=!!cycle&&planKeys.length>0&&(!cycle.bought||(range?r.resumeEndLine!==planKeys.at(-1)[0]:!(storedPlan(r,stages)||[]).some(([i,t])=>etfResumeAfter(cycle,i,t))));
  return {cuts,stages,plan,est,tranches,skipped,planKeys,cycle,fixPlan,cutBase:run,sold,rebought,sellValue,buyTarget,buyValue,rest,sellAvg,buyAvg,started,doneCuts:cuts.filter(c=>c.done).length,filledCuts:done.length,doneTranches:tranches.filter(x=>x.done).length,held:Math.max(0,holdShares(r)-sold+rebought)};
}
// 실제 누적 체결: 수량 입력은 정수 주만, 0이면 기록 삭제. 체크는 고정 잔량까지 완료한다.
// 기존 완료 기록에는 partial을 만들지 않는다. 수량을 고친 회차만 예정량을 고정하며 조회·복원에서는 저장하지 않는다.
// 재매수를 시작한 뒤 기록된 손절보다 깊은 새 손절은 재이탈로 보고 재개 표시(afterLine·afterRound, etfResumeMark)를 함께 저장한다.
// 이미 지난 회차를 다시 체크하는 것(기록 정정)은 재이탈로 보지 않는다. 손절 합계 한도는 이탈 전 보유 + 재매수 수량.
function rebuyCutRecord(r,i,text,complete=false){
  const qty=Number(text),c=cutPlan(r)[i],old=r.cuts?.[i];
  if(!c||!Number.isSafeInteger(qty)||qty<0||String(text).trim()==="")return false;
  const sold=(r.cuts||[]).reduce((n,x,j)=>n+(j===i?0:wholeShares(x?.shares)),0);
  if(sold+qty>holdShares(r)+rebuyBought(r))return false;
  const planned=wholeShares(old?.plannedShares??(old?Math.max(c.qty,Math.round(holdShares(r)*(Number(r.sellPct)||0)/100)):c.qty));
  if(!qty)return null;
  const mark=!old&&rebuyBought(r)>0&&(r.cuts||[]).every((x,j)=>!x||j<i)?etfResumeMark(r):null;
  const rec={...old,shares:qty,...(!old?{price:rebuyUsd(r)?Math.round(c.price*100)/100:Math.round(c.price)}:{}),...(mark||{}),...(!complete||old?.plannedShares!==undefined?{plannedShares:Math.max(planned,qty)}:{})};
  delete rec.partial;if(!complete&&qty<planned)rec.partial=true;
  return rec;
}
// 1주 값에도 못 미치는 배분에는 최소 1주를 강제로 만들지 않는다. 기존 체결은 금액과 무관하게 보존한다.
const rebuyPendingShares = (amount,price) => price>0&&amount+1e-9>=price?Math.round(amount/price):0;
function rebuyBuyRecord(r,i,t,text,complete=false){
  const qty=Number(text),s=rebuySummary(r),x=s.stages[i],tr=s.tranches.find(y=>y.i===i&&y.t===t),old=x?.done?t===0?x:null:x?.buys?.[t];
  if(!tr||!Number.isSafeInteger(qty)||qty<0||String(text).trim()===""||!old&&(!(s.sold>0&&tr.amount>0)||!!(etfRangeOf(r)||etfRebuyRounds(x))&&tr.est))return false;
  if(!qty)return null;
  const price=old?(Number(x.done?old.execPrice:old.price)||s.sellAvg):tr.price>0&&!tr.est?(rebuyUsd(r)?Math.round(tr.price*100)/100:Math.round(tr.price)):Number(r.currentPrice)||tr.price;
  if(!(price>0&&Number.isFinite(price)))return false;
  if(!old&&!rebuyPendingShares(tr.amount,price))return false;
  const planned=wholeShares(old?.plannedShares??(old?tr.qty:rebuyPendingShares(tr.amount,price)));
  const rec={...old,shares:qty,...(!complete||old?.plannedShares!==undefined?{plannedShares:Math.max(planned,qty)}:{})};
  delete rec.partial;if(!complete&&qty<planned)rec.partial=true;
  if(!old)rec.price=price;
  return rec;
}
// 자산 배분 연동(js/alloc-link.js — 플래너 화면에서만 불러옴): 손절·재매수 체크를 같은 종목 코드 계좌의 보유량에 반영하고, 체결 수량·가격을 고치면 같은 비율로 맞추며, 풀면 되돌린다.
// 취소에 쓰는 키 'cut:종목 id:회차'·'rebuy:종목 id:단계 이름:회차' 유지(id는 editRebuy 뒤 정함). 체결은 수량·가격(미국은 달러).
// allocLink가 없으면(테스트·수집 작업) 체크만 한다.
const rebuyFill = (r, rec, sign) => ({sign,qty:Number(rec?.shares)||null,price:Number(rec?.price)||null,currency:rebuyUsd(r)?"USD":"KRW"});
function rebuyLink(fn, ...args){
  if(typeof allocLink==="object")return allocLink[fn](...args);
  if(fn==="check"){args[0].commit();args[0].redraw?.();}
  return fn==="line"?"":null;
}
// 완료 회차 접기는 분할매수·분할매도와 같은 화면 상태. 저장 기록에 넣지 않으며, 전체 재매수 완료로 바뀔 때 다시 자동 접는다.
const rebuyFolds=new Map();
function rebuyFoldState(r,s){
  const key=r.id||r,fold=rebuyFolds.get(key)||{cuts:false,buys:false,complete:false};
  const complete=s.started&&(!s.rest||s.tranches.every(x=>x.done))&&!s.tranches.some(x=>x.partial)&&!s.cuts.some(x=>x.recorded&&!x.done);
  if(complete&&!fold.complete){fold.cuts=false;fold.buys=false;}
  fold.complete=complete;rebuyFolds.set(key,fold);return fold;
}
// rebuy={items:[{id,…}]}(객체를 유지해 옛 화면/수집과 호환). 옛 단일 종목은 목록처럼 읽기만 한다.
const rebuyItems = d => { const r=d?.rebuy; return !r||typeof r!=="object"?[]:Array.isArray(r.items)?r.items.filter(x=>x&&typeof x==="object"):[r]; };
const rebuyPick = () => { const list=rebuyItems(state); return list.find(x=>x.id&&x.id===state.selectedRebuy)||list[0]||null; }; // 화면에 보이는 종목
// 입력 때만 생성·단일 기록→목록 이전(id 부여). 불러올 때 바꾸면 기기마다 id가 달라 충돌 창이 뜬다.
// 전부 삭제해도 {items:[]} 유지(필드 삭제는 applyRemote 병합 때문에 다른 기기에 반영되지 않음).
function editRebuyList(){
  const rb=state.rebuy;
  if(!rb||typeof rb!=="object")state.rebuy={items:[]};
  else if(!Array.isArray(rb.items))state.rebuy={items:[{id:id(),...rb}]};
  return state.rebuy.items;
}
// 고칠 종목(화면에 보이는 종목)을 돌려준다. 종목이 없으면 기본값으로 하나 만든다.
function editRebuy(){
  const items=editRebuyList();
  let r=rebuyPick();
  if(!r){r={id:id(),...defaultRebuy()};items.push(r);}
  if(!r.id)r.id=id();
  state.selectedRebuy=r.id;
  if(!Array.isArray(r.cuts))r.cuts=[];if(!Array.isArray(r.stages)||untouchedOldStages(r.stages))r.stages=defaultRebuy().stages;
  r.stages.forEach(x=>{if(stageName(x?.name)!==x?.name)x.name=stageName(x.name);}); // 옛 이름 'N분봉' → 'N선'
  syncRebuyHold(r);
  return r;
}
// 기록 전이면 저장한 이탈 전 보유를 자산 배분 보유(rebuyLiveHold)에 맞춘다 — 수집 작업의 알림은 저장값을 쓴다. 입력 때만 부른다(editRebuy·종목 창 저장).
function syncRebuyHold(r){
  const h=rebuyLiveHold(r);if(!h)return false;
  const value=h.unit==="shares"?Math.floor(h.value):h.value;
  if(h.unit==="shares"?!(Number(r.amount)>0)&&wholeShares(r.shares)===value:Number(r.amount)===value&&r.shares==null)return false;
  return setHold(r,h.unit,String(value))!==false;
}
// 새 체결은 계좌 선택 흐름으로 반영하고, 누적량 수정은 같은 출처 키로 재계산한다. 0·체크 해제는 자산 반영까지 되돌린다.
function applyRebuyCut(i,rec){
  if(rec===false)return false;
  const src=rebuyPick(),had=!!src?.cuts?.[i];if(!rec&&!had)return false;
  const commit=()=>{const r=editRebuy();while(r.cuts.length<i)r.cuts.push(null);r.cuts[i]=rec;while(r.cuts.length&&!r.cuts.at(-1))r.cuts.pop();save();return `cut:${r.id}:${i}`;};
  if(rec&&!had)rebuyLink("check",{ticker:src.ticker,trade:rebuyFill(src,rec,-1),label:`${src.name||"재매수"} 손절 ${i+1}회`,prefer:[`cut:${src.id}:`],commit,redraw:renderRebuy});
  else{const key=commit();rebuyLink(rec?"rescale":"uncheck",key,...(rec?[rebuyFill(src,rec,-1)]:[]));renderRebuy();}
  return false; // 저장은 commit에서 수행(계좌 선택 취소 때 저장하지 않음)
}
function applyRebuyBuy(i,t,rec){
  if(rec===false)return false;
  const src=rebuyPick(),view=rebuySummary(src),stage=view.stages[i];if(!stage)return false;
  const had=!!(stage.done||stage.buys?.[t]);if(!rec&&!had)return false;
  const commit=()=>{
    const r=editRebuy(),st=r.stages[i];if(!st)return false;
    if(rec){
      // 재이탈 뒤 첫 재매수 때 이번 범위를 고정한다. 앞 재매수의 고정값(plannedEndLine)은 남겨 둔다.
      if(view.cycle){if(view.fixPlan){if(etfRangeOf(r))r.resumeEndLine=view.planKeys.at(-1)[0];else r.planned=view.planKeys;}}
      else{
        if(!view.started||etfRangeOf(r)&&!r.plannedEndLine)r.planned=view.planKeys;
        if(etfRangeOf(r)&&!r.plannedEndLine&&view.planKeys.length)r.plannedEndLine=view.planKeys.at(-1)[0];
      }
      if(st.done){Object.assign(st,rec);if(!rec.partial)delete st.partial;}
      else{if(!Array.isArray(st.buys))st.buys=[];while(st.buys.length<t)st.buys.push(null);st.buys[t]=rec;}
    }else if(st.done){Object.assign(st,{done:false,shares:null,execPrice:null});delete st.partial;delete st.plannedShares;}
    else if(Array.isArray(st.buys)){st.buys[t]=null;while(st.buys.length&&!st.buys.at(-1))st.buys.pop();if(!st.buys.length)delete st.buys;}
    if(!r.stages.some(stageTouched)){delete r.planned;delete r.plannedEndLine;delete r.resumeEndLine;}
    save();return `rebuy:${r.id}:${st.name}:${t}`;
  };
  if(rec&&!had)rebuyLink("check",{ticker:src.ticker,trade:rebuyFill(src,rec,1),label:`${src.name||"재매수"} ${stage.name} ${t+1}차 재매수`,prefer:[`rebuy:${src.id}:`,`cut:${src.id}:`],commit,redraw:renderRebuy});
  else{const key=commit();rebuyLink(rec?"rescale":"uncheck",key,...(rec?[rebuyFill(src,{shares:rec.shares,price:stage.done?rec.execPrice:rec.price},1)]:[]));renderRebuy();}
  return false;
}
// 상태 글자: [화면 '현재 상태', 목록 카드 오른쪽 짧은 글자]
function rebuyStatus(r,s){
  const low=Number(r.lowPrice)||0, cur=Number(r.currentPrice)||0, fromLow=low>0&&cur>0?(cur/low-1)*100:null;
  if(!(low>0&&holdShares(r)>0))return ["입력 필요","입력 필요"];
  if(s.started&&(!s.rest||s.tranches.every(x=>x.done))&&!s.tranches.some(x=>x.partial)&&!s.cuts.some(x=>x.recorded&&!x.done))return ["재매수 완료","완료"];
  if(s.started)return [`재매수 ${s.doneTranches}/${s.tranches.length}회`,`재매수 ${s.doneTranches}/${s.tranches.length}`];
  if(s.filledCuts)return [`손절 ${s.doneCuts}회 진행${s.filledCuts>s.doneCuts?" · 부분 체결":""}`,`손절 ${s.doneCuts}회${s.filledCuts>s.doneCuts?" · 부분":""}`];
  return fromLow!=null&&fromLow<0?["신저점 이탈","신저점 이탈"]:fromLow!=null?["신저점 위","대기"]:["손절 대기","대기"];
}
// 보유 종목 목록 = 분할매도와 같은 출처(자산 배분 항목, assetStore.doc.allocation)에서 읽기만 한다 — 재매수 쪽에 따로 저장하지 않는다.
// 재매수가 시세로 다루는 국내·미국 거래 코드이고 보유(수량 또는 금액)가 있는 항목만. 호출할 때마다 읽으므로 자산 쪽 변경이 바로 보인다.
function rebuyHoldingChoices(alloc){
  return (alloc?.groups||[]).flatMap(g=>(g.items||[]).filter(it=>["국내","해외"].includes(purchaseQuoteKind(assetTradeTicker(it)))&&(finite(it.shares)!==null?finite(it.shares)>0:finite(it.amount)>0)).map(it=>({g,it})));
}
// 자산 배분 보유량(alloc-link.js holding) → '이탈 전 보유' {unit, value}. 수량 합이 있으면 주, 없으면 평가액(국내 만원 / 미국 달러로 환산). 가져올 값이 없으면 null.
function rebuyHoldFromAlloc(allocHold, usd){
  if(!allocHold)return null;
  const unit=allocHold.shares>0?"shares":"amount", value=unit==="shares"?allocHold.shares:usd?(allocHold.fx?Math.round(allocHold.value*1e4/allocHold.fx):0):allocHold.value;
  return value>0?{unit,value}:null;
}
// 종목 추가·이름/코드 수정 창(rebuyDialog). 이 파일은 테스트가 DOM 없이 불러오므로 창 처리는 이 함수 안에서 연결한다.
// 새 종목은 기본 규칙·단계로 만든다. 종목 코드를 바꾸면 auto를 지워 다음 동기화 때 새 종목 시세로 채운다.
// '재매수할 보유 종목' 검색(item-search.js, 분할매수 창과 공통 — f.holding에 고른 자산 항목 id): 고르면 이름·코드를 채우고 코드 칸은 '변경' 전까지 잠근다.
// 저장할 때 손절·재매수 기록이 없으면 종목 코드의 자산 배분 보유를 이탈 전 보유로 채운다(syncRebuyHold). 다른 종목 코드로 바꾸면 이전 종목의 보유는 지운다.
// 목록에 없는 종목은 이름·코드를 직접 입력하며, 맞는 종목이 없을 때 검색어를 종목 이름으로 넘길 수 있다.
// 종목 삭제는 실제 체결인 자산 배분을 그대로 둔다(초기화의 forget와 다름).
let rebuyPickerUi=null, rebuyChoices=[], editRebuyTarget=null;
const rebuyChoiceInfo=({g,it})=>[g.name,it.section,assetTradeTicker(it),finite(it.shares)!==null?`보유 ${won.format(it.shares)}주`:""].filter(Boolean).join(" · ");
function rebuyPicker(){
  if(rebuyPickerUi)return rebuyPickerUi;
  const f=$("rebuyForm").elements, chosen=()=>rebuyChoices.find(c=>c.it.id===f.holding.value)||null;
  // 고른 종목의 보유량 안내(저장 때 채울 값과 같은 계산).
  const holdHint=c=>{const h=c?rebuyHoldFromAlloc(typeof allocLink==="object"?allocLink.holding(assetTradeTicker(c.it)):null,usTicker(assetTradeTicker(c.it))):null;
    return !c?"":h?`자산 배분 보유 ${h.unit==="shares"?`${won.format(h.value)}주`:usTicker(assetTradeTicker(c.it))?`$${won.format(h.value)}`:`${decimal.format(h.value)}만원`}를 이탈 전 보유로 채웁니다(손절·재매수 기록이 없을 때).`:"가져올 보유량이 없어 이름·코드만 채웁니다.";};
  const setHint=text=>{const hint=$("rebuyHoldingHint");hint.textContent=text;hint.hidden=!text;};
  return rebuyPickerUi=itemSearch.create($("rebuyItemSearch"),{id:"rebuy",label:"rebuyItemLabel",empty:"자산 배분에 보유 종목이 없습니다. 아래에 직접 입력하세요.",
    rows:()=>{if(!rebuyChoices.length)return [];const listed=new Set((state.rebuy?.items||[]).filter(r=>r!==editRebuyTarget).map(r=>linkTicker(r.ticker)).filter(Boolean));
      return rebuyChoices.map(c=>({id:c.it.id,name:c.it.name,info:rebuyChoiceInfo(c),badge:listed.has(linkTicker(assetTradeTicker(c.it)))?"등록됨":"",words:[c.it.name,c.g.name,c.it.section,c.it.ticker,c.it.tradeTicker]}));},
    current:()=>{const c=chosen();return c?{name:c.it.name,info:rebuyChoiceInfo(c)}:null;},
    pick:itemId=>{const c=rebuyChoices.find(x=>x.it.id===itemId);if(!c)return;f.holding.value=itemId;f.name.value=c.it.name.slice(0,40);f.ticker.value=assetTradeTicker(c.it);f.ticker.readOnly=true;setHint(holdHint(c));},
    repick:()=>{f.holding.value="";f.ticker.readOnly=false;setHint("");},
    manual:{label:q=>`‘${q}’ 종목 이름으로 직접 입력`,fill:q=>{f.name.value=q.slice(0,40);f.ticker.focus();}}});
}
function openRebuyDialog(edit){
  const dialog=$("rebuyDialog"), form=$("rebuyForm"), f=form.elements;
  form.reset();$("rebuyTitle").textContent=edit?`${String(edit.name||"").trim()||"종목"} 수정`:"새 재매수 종목";$("deleteRebuyBtn").classList.toggle("hidden",!edit);
  if(edit){f.name.value=edit.name||"";f.ticker.value=edit.ticker||"";}
  editRebuyTarget=edit||null;rebuyChoices=typeof assetStore==="object"?rebuyHoldingChoices(assetStore.doc?.allocation):[];
  const same=edit?.ticker?rebuyChoices.filter(c=>linkTicker(assetTradeTicker(c.it))===linkTicker(edit.ticker)):[];
  const initial=same.length===1?same[0].it.id:"", picker=rebuyPicker();
  f.holding.value=initial;f.ticker.readOnly=!!initial;$("rebuyHoldingHint").textContent="";$("rebuyHoldingHint").hidden=true;picker.clear();picker.render();
  form.onsubmit=e=>{e.preventDefault();const name=f.name.value.trim().slice(0,40), ticker=f.ticker.value.trim().toUpperCase().slice(0,80);if(!name)return;
    let r;if(edit)r=editRebuy();else{r={id:id(),...defaultRebuy()};editRebuyList().push(r);state.selectedRebuy=r.id;}
    const old=r.ticker||"";r.name=name;
    if(ticker!==old){if(ticker)r.ticker=ticker;else delete r.ticker;delete r.auto;if(old&&!rebuyRecorded(r)){delete r.amount;delete r.shares;}}
    syncRebuyHold(r);
    save();dialog.close();renderRebuy();};
  $("deleteRebuyBtn").onclick=()=>{const r=rebuyPick();if(!r||!confirm(`${String(r.name||"").trim()||"이 종목"} 재매수 기록을 삭제할까요?\n손절·재매수 체크와 메모도 함께 지워집니다.`))return;
    const gone=editRebuy();state.rebuy.items=state.rebuy.items.filter(x=>x!==gone);state.selectedRebuy=state.rebuy.items[0]?.id||null;save();dialog.close();renderRebuy();};
  dialog.querySelectorAll("[data-close-rebuy]").forEach(b=>b.onclick=()=>dialog.close());
  dialog.showModal();
  if(edit)f.name.focus();else if(typeof matchMedia==="function"&&matchMedia("(hover:hover) and (pointer:fine)").matches)picker.focus(); // 새 종목은 분할매수 창처럼 PC에서만 검색 칸에
}
// 분할매수와 같은 시작선·마지막선 범위 편집. 열기·취소는 사본만 다루고 저장 때 범위를 적용한다.
// 범위 밖 평균선·체결·손절·개별 비중/조건은 삭제하지 않고 다음 평균선은 회차 가격 계산에만 사용한다.
let rebuyStageDraft=null;
function setRebuyStageDraftField(st,key,text){
  text=String(text).trim();
  if(key==="name"){if(stageTouched(st))return false;st.name=stageName(text.slice(0,20));return;}
  if(key==="buyCondition"){if(!["up","down"].includes(text))return false;if(text==="up")delete st.buyCondition;else st.buyCondition=text;return;}
  if(!["price","rounds","weight","price1","price2"].includes(key))return false;
  const v=Number(text);
  if(text&&(!Number.isFinite(v)||v<0||key==="rounds"&&(!Number.isInteger(v)||v<1||v>TRANCHES)||key==="weight"&&(v<=0||v>100)))return false;
  if(key.startsWith("price")&&key!=="price"){
    const t=Number(key.slice(5));
    if(text&&v>0){if(!Array.isArray(st.prices))st.prices=[];while(st.prices.length<t)st.prices.push(null);st.prices[t]=v;}
    else if(Array.isArray(st.prices)){st.prices[t]=null;while(st.prices.length&&!st.prices.at(-1))st.prices.pop();if(!st.prices.length)delete st.prices;}
  }else if(key==="price")st.price=v;
  else if(text)st[key]=v;else delete st[key];
}
function rebuyStageDraftError(original,stages){
  if(!stages.length||stages.length>80)return "단계는 1~80개로 설정하세요.";
  const names=stages.map(x=>stageName(String(x.name||"").trim()));
  if(names.some(x=>!x)||new Set(names).size!==names.length)return "단계 이름과 같은 평균선의 중복을 확인하세요.";
  for(const st of original.filter(stageTouched))if(!stages.some(x=>x.name===st.name&&JSON.stringify(stageFills(x,"shares"))===JSON.stringify(stageFills(st,"shares"))))return "체결한 단계와 매수 기록은 삭제하거나 바꿀 수 없습니다.";
  return "";
}
function rebuyRangeDraftError(range,stages){
  if(!range)return "";
  if(!movingLineName(range.startLine)||!movingLineName(range.lastLine))return "시작·마지막 평균선 기간은 1~400의 정수로 입력하세요.";
  if(!etfRangeNames(stages,range).length)return "마지막 평균선은 시작선과 같거나 뒤에 있어야 합니다.";
  if(!Number.isInteger(range.lastRound)||range.lastRound<1||range.lastRound>3)return "마지막 회차는 1~3으로 선택하세요.";
  if(!(range.targetPct>0&&range.targetPct<=100))return "재매수 비중은 0보다 크고 100 이하로 입력하세요.";
  return "";
}
function saveRebuyStageDraft(){
  const draft=rebuyStageDraft,src=rebuyPick();if(!draft)return false;
  if(src!==draft.source){$("rebuyStagesError").textContent="동기화에서 종목 기록이 변경되었습니다. 닫고 다시 열어 주세요.";return false;}
  if(draft.invalid?.size){$("rebuyStagesError").textContent="잘못 입력한 값을 먼저 수정하세요.";return false;}
  const conflict=JSON.stringify(stagesOf(src))!==draft.base||draft.rangeBase!==undefined&&JSON.stringify(etfRangeOf(src))!==draft.rangeBase;
  const error=conflict?"동기화에서 설정·기록이 변경되었습니다. 닫고 다시 열어 주세요.":rebuyStageDraftError(draft.original,draft.stages)||rebuyRangeDraftError(draft.range,draft.stages);
  if(error){$("rebuyStagesError").textContent=error;return false;}
  if(draft.range){const view=rebuySummary({...src,range:draft.range,stages:draft.stages});if(view.buyValue>view.buyTarget){$("rebuyStagesError").textContent="이미 재매수한 금액보다 목표를 작게 설정할 수 없습니다.";return false;}}
  const changed=JSON.stringify(draft.stages)!==draft.base||draft.range!==undefined&&JSON.stringify(draft.range)!==draft.rangeBase;
  if(changed){
    // 재이탈 중에는 앞 재매수의 고정 종료선을 두고 이번 재이탈 범위만 다시 고른다(이미 체결했으면 새 범위로 고정).
    const r=editRebuy();r.stages=draft.stages;if(draft.range){r.range=draft.range;delete r.resumeEndLine;if(!etfRebuyResume(r,stagesOf(r)))delete r.plannedEndLine;}
    if(r.stages.some(stageTouched)){
      const view=rebuySummary(r),last=view.planKeys.at(-1)?.[0];
      if(view.cycle){if(view.cycle.bought&&last){if(etfRangeOf(r))r.resumeEndLine=last;else r.planned=view.planKeys;}}
      else{r.planned=view.planKeys;if(etfRangeOf(r)&&last)r.plannedEndLine=last;}
    }
    save();
  }
  $("rebuyStagesDialog").close();rebuyStageDraft=null;renderRebuy();return true;
}
function prepareRebuyRangeDraft(){
  const draft=rebuyStageDraft,f=$("rebuyStagesForm").elements,line=key=>{const n=Number(f[key+"Period"].value);return Number.isInteger(n)?movingLineName(`${n}${f[key+"Unit"].value}`):"";};
  const start=line("start"),last=line("last"),sets={all:MA_LINES,hour:MA_LINES.filter(n=>movingLineUnit(n)==="선"),day:MA_LINES.filter(n=>movingLineUnit(n)==="일선"),week:MA_LINES.filter(n=>movingLineUnit(n)==="주선"),month:MA_LINES.filter(n=>movingLineUnit(n)==="개월선")};
  const base=sets[f.lineSet.value]||draft.originalRange?.names||draft.original.map(x=>movingLineName(x.name)).filter(Boolean),names=movingLineRange([...new Set([start,...base])],start,last);
  const range={startLine:start,lastLine:last,names,lastRound:Number(f.lastRound.value),targetPct:Number(f.targetPct.value)};if(f.condition.value)range.condition=f.condition.value;
  draft.range=range;
  const previous=draft.stages,selected=names.map(name=>previous.find(x=>x.name===name)||{name,price:0});
  draft.stages=[...selected,...previous.filter(st=>!names.includes(st.name)&&draft.original.some(x=>x.name===st.name))];
  if(last&&etfNextStage(draft.stages,draft.stages.findIndex(x=>x.name===last),true)<0){
    const follow=MA_LINES.find(n=>movingLineUnit(n)===movingLineUnit(last)&&parseInt(n)>parseInt(last));
    if(follow)draft.stages.push(previous.find(st=>st.name===follow)||{name:follow,price:0});
  }
  return rebuyRangeDraftError(range,draft.stages);
}
function renderRebuyStageDraft(){
  const draft=rebuyStageDraft;if(!draft)return;
  const error=prepareRebuyRangeDraft();$("rebuyStagesError").textContent=error;
  if(error){$("rebuyRangePreview").innerHTML="";return;}
  const r={...draft.source,stages:draft.stages,range:draft.range};if(JSON.stringify(draft.stages)!==draft.base||JSON.stringify(draft.range)!==draft.rangeBase){delete r.resumeEndLine;if(!etfRebuyResume(r,stagesOf(r)))delete r.plannedEndLine;}
  const s=rebuySummary(r),f=$("rebuyStagesForm").elements,usdMode=rebuyUsd(r),P=v=>priceText(v,usdMode?"USD":"KRW"),range=draft.range;
  draft.lastLine=s.planKeys.at(-1)?.[0]||range.startLine;
  const stage=name=>draft.stages.find(x=>x.name===name),first=stage(range.startLine),last=stage(draft.lastLine),nextIndex=etfNextStage(draft.stages,draft.stages.indexOf(last),true),next=draft.stages[nextIndex];
  for(const [key,st] of [["startPrice",first],["lastPrice",last],["nextPrice",next]])if(f[key]!==document.activeElement){f[key].value=Number(st?.price)>0?shown(st.price):"";draft.invalid.delete(key);}
  $("rebuyNextPriceLabel").textContent=next?`${movingLineText(next.name)} 기준가 (${usdMode?"달러":"원"} · 계산용)`:`다음 평균선 기준가`;
  f.nextPrice.disabled=!next;$("rebuyNextPriceField").hidden=!next;$("rebuySamePriceField").hidden=range.startLine===draft.lastLine;
  f.lastPrice.closest("label").querySelector("span").textContent=`${movingLineText(draft.lastLine)} 기준가 (실제 마지막 선)`;
  for(const key of ["price1","price2"]){const t=Number(key.slice(5));f[key].closest("label").querySelector("span").textContent=`${movingLineText(draft.lastLine)} ${t+1}회차 가격`;if(f[key]!==document.activeElement){const level=etfTrancheLevels(s.stages,s.est,s.stages.findIndex(x=>x.name===draft.lastLine))[t];f[key].value=Number(last.prices?.[t])>0?shown(last.prices[t]):"";f[key].placeholder=level.price>0?`${shown(level.price)} · 자동`:"직접 입력";f[key].disabled=t>=range.lastRound;draft.invalid.delete(key);}}
  const resume=etfResumeName(s);
  $("rebuyRangeBudget").innerHTML=movingLineText(`<p><b>최대 ${esc(range.startLine)} → ${esc(range.lastLine)} · ${s.cycle?resume?`재이탈 ${esc(resume)}부터 `:"재이탈 · 다음 선 없음 · ":""}실제 ${esc(draft.lastLine)} ${(s.planKeys.at(-1)?.[1]??range.lastRound-1)+1}회차까지</b></p><p>목표 ${P(s.buyTarget)} · 남은 ${P(s.rest)} · ${s.planKeys.length}회</p>`);
  const rows=s.tranches.filter(x=>range.names.includes(s.stages[x.i].name)||x.i===s.cycle?.from);
  $("rebuyRangePreview").innerHTML=rows.map(x=>`<span${x.done?' class="done"':''}><b>${esc(movingLineText(s.stages[x.i].name))} ${x.t+1}회차</b> ${x.price>0?P(x.price):"가격 대기"} · ${x.done?`체결 ${won.format(x.qty)}주`:x.amount>0?`배분 ${P(x.amount)}`:"손절 후 계산"}</span>`).join("");
  $("rebuyRangeHint").textContent=movingLineText(s.cycle?resume?`재이탈: ${etfSkipText(s.cycle.after,s.cycle.round)} ${s.cycle.round||range.names.includes(resume)?`${resume}부터 평균 손절가 기준 ${draft.lastLine}까지`:`범위 밖 다음 선 ${resume}에만`} 배분합니다.`:`재이탈: ${s.cycle.after} 다음 평균선이 없어 새 매수 수량을 배정하지 않습니다.`
    :`평균 손절가 기준 ${draft.lastLine}까지 배분합니다. 이후 평균선에는 새 매수 수량을 배정하지 않습니다.`);
}
function openRebuyStages(index=null){
  const src=rebuyPick();if(!src)return;
  const original=JSON.parse(JSON.stringify(stagesOf(src))),dialog=$("rebuyStagesDialog"),f=$("rebuyStagesForm").elements,s=rebuySummary(src),range=etfRangeOf(src);
  const automatic=etfRebuyPlanned(s.stages,s.est,s.sellAvg),names=[...new Set(automatic.map(([i])=>movingLineName(s.stages[i]?.name)).filter(Boolean))],start=range?.startLine||names[0]||movingLineName(original[0]?.name)||"25선",last=range?.lastLine||names.at(-1)||start;
  rebuyStageDraft={source:src,original,base:JSON.stringify(original),originalRange:range?JSON.parse(JSON.stringify(range)):null,rangeBase:JSON.stringify(range),stages:JSON.parse(JSON.stringify(original)),invalid:new Set()};
  f.startPeriod.value=parseInt(start);f.startUnit.value=movingLineUnit(start);f.lastPeriod.value=parseInt(last);f.lastUnit.value=movingLineUnit(last);f.lineSet.value="custom";f.lastRound.value=range?.lastRound||etfRebuyRounds(original.find(st=>st.name===last))||3;f.targetPct.value=etfRebuyTargetPct(src);f.condition.value=range?.condition||"";
  $("rebuyStagesTitle").textContent="재매수 범위 편집";$("rebuyStagesForm").onsubmit=e=>{e.preventDefault();saveRebuyStageDraft();};
  dialog.querySelectorAll("[data-close-rebuy-stages]").forEach(b=>b.onclick=()=>{rebuyStageDraft=null;dialog.close();});
  for(const key of ["startPeriod","lastPeriod","targetPct"])f[key].oninput=renderRebuyStageDraft;
  for(const key of ["startUnit","lastUnit","lineSet","lastRound","condition"])f[key].onchange=renderRebuyStageDraft;
  f.lineSet.onchange=()=>{const unit={hour:"선",day:"일선",week:"주선",month:"개월선"}[f.lineSet.value];if(unit)f.startUnit.value=f.lastUnit.value=unit;renderRebuyStageDraft();};
  for(const key of ["startPrice","lastPrice","nextPrice","price1","price2"])f[key].oninput=()=>{
    const draft=rebuyStageDraft,range=draft.range,lastLine=draft.lastLine||range.lastLine,lastIndex=draft.stages.findIndex(st=>st.name===lastLine),name=key==="startPrice"?range.startLine:key==="nextPrice"?draft.stages[etfNextStage(draft.stages,lastIndex,true)]?.name:lastLine,st=draft.stages.find(x=>x.name===name);
    if(!st||setRebuyStageDraftField(st,key==="price1"||key==="price2"?key:"price",f[key].value)===false){draft.invalid.add(key);$("rebuyStagesError").textContent="기준가는 0 이상의 숫자로 입력하세요.";return;}
    draft.invalid.delete(key);renderRebuyStageDraft();
  };
  renderRebuyStageDraft();dialog.showModal();if(index!==null)f.lastPeriod.focus();
}

// 화면: 왼쪽(모바일은 위) 종목 목록(분할매도 '저장된 계획'과 같은 카드 — 종목 이름, 오른쪽 짧은 상태, 아래 종목 코드(PC), 막대는 재매수 금액/손절 금액)
// + 고른 종목. 제목은 작은 글씨 '손절 후 재매수 · 종목 코드' 아래 종목 이름(크게), 옆 연필로 이름·코드 수정·종목 삭제 창.
// 이름·코드는 기준 입력에 넣지 않음; 짧은 상태는 PC 오른쪽/모바일 이름 아래. 계산 요약·메모는 두 칸 유지.
function renderRebuy(){
  const L=v=>esc(movingLineText(v)); // 단계 이름 화면 글자: N개월선 → N월선(기록·계산 이름은 그대로)
  const items=rebuyItems(state), r=rebuyPick();
  $("rebuyList").innerHTML=items.length?items.map((x,i)=>{const s=rebuySummary(x), [,short]=rebuyStatus(x,s), name=String(x.name||"").trim()||"이름 없음", code=String(x.ticker||"").trim(), done=s.sellValue?Math.min(100,Math.round(s.buyValue/s.sellValue*100)):0;
    return `<button class="plan-item ${x===r?"active":""}" type="button" data-rebuy="${i}" title="${esc(name)}${code?` (${esc(code)})`:""} · ${esc(short)}"><span class="plan-row"><strong>${esc(name)}</strong><span class="plan-count">${esc(short)}</span></span><span class="plan-title">${esc(code)}</span><span class="plan-bar"><i style="width:${done}%"></i></span></button>`;}).join(""):"<div class='empty'>종목 없음</div>";
  $$("#rebuyList [data-rebuy]").forEach(b=>b.onclick=()=>{const x=rebuyItems(state)[Number(b.dataset.rebuy)];if(!x||x===rebuyPick())return;state.selectedRebuy=x.id||null;save();renderRebuy();});
  if(typeof keepPlanListView==="function")keepPlanListView($("rebuyList"),r?.id||null); // PC 목록 스크롤 위치 유지(core.js)
  $("addRebuyBtn").onclick=()=>openRebuyDialog();
  if(!r){$("rebuyMain").innerHTML="<div class='card empty'><h2>재매수 종목을 추가하세요</h2></div>";return;}
  const s=rebuySummary(r), low=Number(r.lowPrice)||0, cur=Number(r.currentPrice)||0, shares=holdShares(r), amount=holdOf(r).amount, live=rebuyLiveHold(r);
  const step=Number(r.stepPct)>0?Number(r.stepPct):1, sellPct=Number(r.sellPct)||0, first=s.stages[0]?.name||"첫 단계", ready=low>0&&shares>0;
  const opt=v=>Number(v)>0?shown(v):"", fromLow=low>0&&cur>0?(cur/low-1)*100:null;
  // 종목 코드를 넣으면 현재가·N일선·N선 단계 기준가를 시세 파일로 채운다(prices.js, 국내·미국 종목). 없거나 다른 종류(비트코인)면 기준 입력 아래에 알림
  const ticker=String(r.ticker||""), re=stockEntry(priceData,ticker), rp=re?.kind===(rebuyUsd(r)?"해외":"국내")?re:null;
  const priceHint=!ticker||!priceData?"":re&&!rp?"국내·미국 종목 코드만 시세로 채웁니다.":!re?"시세 수집 후 (장중 30분마다) 현재가·시선·일선·주선·월선 기준가를 채웁니다.":"";
  // 현재가·자동 단계 이름 옆에 작고 흐린 '(자동)'(.auto-tag): 국내/미국 코드 + 시세 파일을 읽었을 때(아직 파일에 없는 코드 포함).
  const autoTag=label=>ticker&&priceData&&(!re||rp)&&(!label||autoKey(label))?`<small class="auto-tag">(자동)</small>`:"";
  const fold=rebuyFoldState(r,s),complete=fold.complete, nextCut=s.cuts.find(c=>!c.done&&(c.recorded?c.plannedQty-c.qty:c.qty)>0), nextTr=s.tranches.find(x=>!x.done&&x.amount>0);
  const [status]=rebuyStatus(r,s), title=String(r.name||"").trim()||"이름 없음";
  // 자산 배분 보유(alloc-link.js holding): 손절·재매수 기록 전에만 따라간다(체크 뒤 자산 배분은 손절이 반영된 보유량). 수량 합 또는 평가액(만원 — 미국 종목은 달러로 환산).
  const allocHold=live?rebuyLink("holding",ticker):null;
  // 통화: 미국 종목은 가격 $123.45·금액 $1,235·보유 금액 달러, 그 밖은 가격 원·금액 만원
  const usdMode=rebuyUsd(r), unitWord=usdMode?"달러":"원", P=v=>priceText(v,usdMode?"USD":"KRW"), cents=v=>usdMode?Math.round(v*100)/100:Math.round(v);
  const manwon=v=>usdMode?`$${won.format(Math.round(v))}`:`${decimal.format(v)}만원`;
  const milestones=cutMilestones(r),milestoneHtml=`<div class="cut-milestones" id="rCutMilestones"><div class="cut-milestones-head"><b>손절 도달 기준</b><span>신저점 대비 · ${milestones.base?`${milestones.base.cont?"재이탈 직전":"지금"} 보유 ${won.format(milestones.base.hold)}주 기준`:"계획 기준"}</span></div>${milestones.ready?`<dl>${milestones.points.map(x=>`<div data-cut-milestone="${x.pct}"><dt>${x.pct===50?"절반 매도":"전액 매도"}<small>${x.pct===50?"50% 이상":"100%"}</small></dt><dd>${x.cut?`<strong>−${shown(x.cut.drop)}% · ${P(x.cut.price)}</strong><small>${x.cut.k}회차 · 누적 ${won.format(x.cut.sold)}주${x.cut.reached?" · 도달":x.inPlan?"":` · 현재 ${milestones.rounds}회 밖`}</small>`:`<strong>0원 이전에 미도달</strong><small>하락 간격·회당 손절 확인</small>`}</dd></div>`).join("")}</dl>`:'<p class="hint">신저점 가격과 이탈 전 보유가 있으면 계산됩니다.</p>'}</div>`;
  const wonShort=v=>usdMode?`$${won.format(Math.round(v))}`:v>=10000?manwon(Math.round(v/1000)/10):money(v), amt=(qty,price)=>price>0&&qty>0?`약 ${wonShort(qty*price)}`:"", approx=(qty,price)=>amt(qty,price)&&` · ${amt(qty,price)}`;
  // 이탈 전 보유(읽기 전용): 기록 전에는 자산 배분 보유, 기록 뒤에는 고정한 저장값. 금액이면 신저점으로 나눈 주 수를 같이 보인다.
  const fixed=!live&&(s.filledCuts>0||s.started), holdText=amount?`${manwon(amount)}${low>0?` ≈ ${won.format(shares)}주`:""}`:shares?`${won.format(shares)}주`:"";
  const holdHint=(live?`자산 배분 보유(${esc(allocHold?.text||"")})를 불러옵니다. 첫 손절을 기록하면 그때 보유로 고정합니다.`
    :fixed&&holdText?"손절을 시작해 기록할 때의 보유로 고정했습니다."
    :!ticker?"종목 이름 옆 연필에서 자산 배분의 보유 종목을 고르면 보유를 불러옵니다."
    :`자산 배분에 이 종목 코드의 보유가 없어 ${holdText?"저장된 보유로 계산합니다":"손절 수량을 계산할 수 없습니다"}. 자산 배분에 등록하면 자동으로 불러옵니다.`)
    +(amount&&!(low>0)?" 신저점 가격을 넣으면 보유 금액을 주 수로 나눕니다.":"");
  // 분할 안내: 평균 손절가로 선택한 평균선의 지정 회차까지. 같은 선의 회차 가격은 손절가로 제한하지 않는다.
  // 회차 이름: 단계 이름 뒤에 작은 회차 번호 칩(css .tr-no). 화면 읽기용 이름(trText)은 '25선 2회차'
  const trName=x=>`<span class="tr-name">${L(s.stages[x.i].name)}${s.stages[x.i].done?"":`<span class="tr-no">${x.t+1}</span>`}</span>`, trText=x=>`${L(s.stages[x.i].name)}${s.stages[x.i].done?"":` ${x.t+1}회차`}`, firstTr=s.tranches[0], lastTr=s.tranches.at(-1);
  const splitText=!firstTr?"":`${s.tranches.length>1?`${s.tranches.length}분할 (${trName(firstTr)}~${trName(lastTr)}`:`한 번에 (${trName(firstTr)}`}) · 설정한 매수 조건 기준`;
  const trAt=x=>x.price>0?` · ${x.est?"≈":""}${P(x.price)} ${etfRebuyCondition(s.stages[x.i])==="down"?"이하":"이상"}`:"";
  // 재매수 뒤에도 남은 손절은 이어진다(재이탈). 재이탈 손절을 기록하면 이미 산 회차 다음(resumeName)부터 다시 배분한다.
  const cutTail=s.started&&nextCut?` · 다시 ${P(nextCut.price)} 이하면 손절 ${nextCut.k}회`:"", resumeName=etfResumeName(s);
  const next=!ready?"신저점 가격을 넣고 자산 배분에 이 종목 보유가 있으면 손절 회차가 계산됩니다."
    :complete?`재매수 완료 · 손절 ${P(s.sellValue)} → 재매수 ${P(s.buyValue)} (${won.format(s.sold)}주 → ${won.format(s.rebought)}주)${s.rest>0?` · 잔액 ${P(s.rest)}`:""}${cutTail}`
    :!s.started?`다음 손절 <b>${nextCut?`${nextCut.k}회 · ${P(nextCut.price)} 이하에서 ${won.format(nextCut.recorded?nextCut.plannedQty-nextCut.qty:nextCut.qty)}주${approx(nextCut.recorded?nextCut.plannedQty-nextCut.qty:nextCut.qty,nextCut.price)}`:"없음"}</b>${s.sold?` · ${L(nextTr?s.stages[nextTr.i].name:first)} 매수 조건에 도달하면 재매수 시작 <b>약 ${wonShort(nextTr?.amount??0)}</b> · ${splitText}`:""}`
    :nextTr?`${s.cycle?`재이탈 · ${L(etfSkipText(s.cycle.after,s.cycle.round,true))} · `:""}다음 재매수 <b>${trName(nextTr)}${trAt(nextTr)}에서 약 ${wonShort(nextTr.amount)}</b> · 남은 약 ${wonShort(s.rest)}${cutTail}`
    :s.cycle&&!resumeName?`재이탈 · ${L(s.cycle.after)} 다음 평균선이 없어 남은 약 ${wonShort(s.rest)}을 배정하지 않습니다${cutTail}`
    :`선택 범위의 재매수를 마쳤습니다 · 남은 약 ${wonShort(s.rest)}은 다음 평균선에 자동 배정하지 않습니다${cutTail}`;
  const cutRow=c=>{
    const partial=c.recorded&&!c.done,planned=c.recorded?c.plannedQty:c.qty,remaining=Math.max(0,planned-(c.recorded?c.qty:0)),due=!c.done&&cur>0&&cur<=c.price,blocked=!c.recorded&&!c.qty;
    const check=`<label class="check rebuy-cut-check" title="잔량까지 손절 완료"><input type="checkbox" data-cut="${c.k-1}" ${c.done?"checked":""}${partial?' aria-checked="mixed"':''}${blocked?" disabled":""} aria-label="${c.k}회 손절 완료"><span class="rebuy-cut-name"><span class="tr-name">손절<span class="tr-no">${c.k}</span></span><small class="rebuy-cut-drop">신저점 −${shown(c.drop)}%</small></span></label>`;
    const alert=typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeRebuyEnabled(r,"cuts",c.k-1),`data-rebuy-alert="cuts" data-alert-index="${c.k-1}"`,`${c.k}회 손절`,c.done):"";
    const price=`<span class="price">${P(c.price)}</span><div class="rebuy-stage-tools">${alert}</div>`;
    const shares=`<div class="rebuy-stage-summary"><strong class="rebuy-stage-plan">${c.done?"손절":"계획"} ${won.format(c.done?c.qty:planned)}주<small class="sub rebuy-stage-amount">${c.done?amt(c.qty,c.execPrice||c.price):amt(planned,c.price)}</small></strong></div><label class="exec-fields rebuy-exec"><span>누적</span><input class="qty" data-cut-qty="${c.k-1}" type="number" min="0" step="1" inputmode="numeric" value="${c.recorded?c.qty:""}" placeholder="0"${blocked?" disabled":""} aria-label="${c.k}회 누적 손절 수량">주</label>${c.recorded?`<label class="exec-fields rebuy-exec"><span>체결가</span><input data-cut-price="${c.k-1}" type="number" min="0" step="any" inputmode="decimal" value="${opt(c.execPrice)}" placeholder="계획가" aria-label="${c.k}회 손절 체결가">${unitWord}</label>`:""}${partial?`<div class="sub rebuy-partial-note">부분 손절 · 남은 ${won.format(remaining)}주${approx(c.qty,c.execPrice||c.price)}</div>`:""}`;
    return tradeStageRow(check,price,shares,c.done?"손절 완료":partial?"부분 손절":due?"손절 시점":"대기",`${c.done?"done":partial?"partial":""} ${due?"due":""}`,c.done?"done":partial?"partial":due?"due":"");
  };
  // 남은 손절의 기준 보유(cutBase): 재매수 뒤 다음 손절은 그때 보유의 회당 비율, 재이탈 손절 뒤 재매수 전에는 재이탈 직전 보유.
  const base=s.cutBase,mark=s.started&&!s.cycle?etfResumeMark(r,s):null,baseText=base?`${base.cont?"재이탈 직전":"지금"} 보유 ${won.format(base.base)}주의 ${shown(sellPct)}%씩`:"";
  const stopNote=!s.started?"":s.cycle?(resumeName?`재이탈 손절을 기록해 재매수는 ${L(etfSkipText(s.cycle.after,s.cycle.round))} ${L(resumeName)}부터 다시 합니다.`:`재이탈 손절을 기록했지만 ${L(s.cycle.after)} 다음 평균선이 없어 새 재매수를 배정하지 않습니다.`)+(base?` ${base.cont?`남은 손절은 ${baseText}입니다.`:`다시 내려가면 ${baseText} 손절합니다.`}`:"")
    :`재매수 중에도 남은 손절 회차는 이어집니다. 다시 내려가면 ${baseText?`${baseText} 손절하고, `:""}재매수는 ${L(mark?etfSkipText(mark.afterLine,mark.afterRound):"")} ${mark?.afterRound?`${L(mark.afterLine)} ${mark.afterRound+1}회차부터`:"다음 선부터"} 합니다.`;
  const cutRows=!ready&&!s.filledCuts?"<div class='empty'>기준 입력에 신저점 가격을 넣고, 자산 배분에 이 종목 보유를 등록하세요.</div>":(stopNote?`<div class="stop-note">${stopNote}</div>`:"")+s.cuts.map(cutRow).join("");
  // 단계별 재매수: 체크·평균선 / 가격(자동)·알림 / 계획 주수(금액)·누적 수량. 보조 글씨는 단위 옆에 두고, 기준가는 눌러 수정한다.
  const stageRows=(st,i)=>{
    const own=s.tranches.filter(x=>x.i===i), rows=[...own,...s.skipped.filter(x=>x.i===i).map(x=>({...x,skip:true}))].sort((a,b)=>a.t-b.t), px=Number(st.price)||0, nextName=L(s.stages[etfNextStage(s.stages,i)]?.name||"");
    const alert=typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeRebuyEnabled(r,"buys",i),`data-rebuy-alert="buys" data-alert-index="${i}"`,movingLineText(`${st.name} 재매수`),own.length>0&&own.every(x=>x.done)):"";
    const priceInput=`<label class="exec-fields rebuy-base" title="${L(st.name)} 기준가 수정"><span class="price rebuy-price-value" aria-hidden="true">${px>0?P(px):s.est[i]?`≈${P(s.est[i])}`:"—"}</span><input data-stage-price="${i}" type="number" min="0" step="any" inputmode="decimal" value="${opt(px)}" placeholder="${s.est[i]?`≈${usdMode?usd.format(s.est[i]):won.format(Math.round(s.est[i]))}`:"선택"}" aria-label="${L(st.name)} 기준가"><span class="rebuy-price-unit" aria-hidden="true">${unitWord}</span>${autoTag(st.name)?`<span class="rebuy-base-label">${autoTag(st.name)}</span>`:""}</label>`;
    const tools=`<div class="rebuy-stage-tools">${alert}<button class="btn icon-btn rebuy-stage-edit" type="button" data-rebuy-stage-edit="${i}" aria-label="${L(st.name)} 단계 편집" title="단계 편집">${PENCIL}</button></div>`;
    if(!own.length)return tradeStageRow(`<label class="check"><input type="checkbox" data-tranche-done="${i}:0" disabled>${L(st.name)}</label>`,`${priceInput}${tools}`,'<strong class="rebuy-stage-plan">—</strong><div class="sub rebuy-range-note">매수 범위 밖 · 가격만 유지</div>',"범위 밖");
    return rows.map((x,k)=>{
      const due=!x.skip&&!x.done&&!x.est&&x.amount>0&&cur>0&&x.price>0&&(etfRebuyCondition(st)==="down"?cur<=x.price:cur>=x.price), nextUp=x===nextTr, ref=x.price||cur;
      const where=x.manual?"직접 설정":x.step&&x.price>0?`${L(st.name)}→${nextName} ${x.t}/${TRANCHES}`:x.t?"가격 입력 대기":"";
      const showBase=k===0||!x.done&&rows.slice(0,k).every(y=>y.done),pricePart=k===0?priceInput:`${showBase?priceInput:""}<span class="price">${x.price>0?`${x.est?"≈":""}${P(x.price)}`:"—"}</span><span class="krw">${where}</span>`;
      // 실제 기준가가 없는 추정 회차만 배분에서 제외한다.
      if(x.skip)return tradeStageRow(`<label class="check"><input type="checkbox" disabled>${trName(x)}</label>`,`${pricePart}${showBase?tools:""}`,`<strong class="rebuy-stage-plan">—</strong><div class="sub rebuy-range-note">${x.passed?"재이탈로 건너뜀":x.est?"추정 가격이라 제외":"계획 밖"}</div>`,x.passed?"건너뜀":"가격 대기");
      const planned=x.partial?x.plannedQty:x.done?x.qty:ref>0&&x.amount>0?rebuyPendingShares(x.amount,ref):0,filled=x.done||x.partial,remaining=Math.max(0,planned-x.qty),blocked=!filled&&(!(s.sold>0&&planned>0&&ref>0)||!!(etfRangeOf(r)||etfRebuyRounds(st))&&x.est);
      const amount=filled?amt(x.qty,x.execPrice||s.sellAvg):x.amount>0?`약 ${wonShort(x.amount)}`:"손절 후 계산";
      const shares=`<div class="rebuy-stage-summary"><strong class="rebuy-stage-plan">${x.done?"재매수":"계획"} ${planned?`${won.format(planned)}주`:"—"}<small class="sub rebuy-stage-amount">${amount}</small></strong></div><label class="exec-fields rebuy-exec"><span>누적</span><input class="qty" data-tranche-qty="${i}:${x.t}" type="number" min="0" step="1" inputmode="numeric" value="${filled?x.qty:""}" placeholder="0"${blocked?" disabled":""} aria-label="${trText(x)} 누적 재매수 수량">주</label>${filled?`<label class="exec-fields rebuy-exec"><span>체결가</span><input data-tranche-exec="${i}:${x.t}" type="number" min="0" step="any" value="${opt(x.execPrice)}" placeholder="체결가" aria-label="${trText(x)} 재매수 체결가">${unitWord}</label>`:""}${x.partial?`<div class="sub rebuy-partial-note">부분 재매수 · 남은 ${won.format(remaining)}주</div>`:""}`;
      const check=`<label class="check" title="잔량까지 재매수 완료"><input type="checkbox" data-tranche-done="${i}:${x.t}" ${x.done?"checked":""}${x.partial?' aria-checked="mixed"':''}${blocked?" disabled":""}>${trName(x)}</label>`;
      return tradeStageRow(check,`${pricePart}${showBase?tools:""}`,shares,x.done?"매수 완료":x.partial?"부분 재매수":due?"재매수 시점":nextUp?"다음 신호":"대기",`${x.done?"done":x.partial?"partial":""} ${due?"due":""}`,x.done?"done":x.partial?"partial":due||nextUp?"due":"");
    }).join("");
  };
  const head=typeof stockNames==="object"?stockNames.titleParts(title):{main:title,tag:""}; // 이름 끝 괄호는 제목 꼬리표로(규칙은 stock-names.js titleParts)
  $("rebuyMain").innerHTML=`<div class="heading rebuy-heading"><div><div class="eyebrow">손절 후 재매수${ticker?` · ${esc(ticker)}`:""}${rp?` · ${priceStamp(rp)}`:""}</div><div class="title-row"><h1>${esc(head.main)}${head.tag?` <span class="title-tag">${esc(head.tag)}</span>`:""}</h1><button class="btn icon-btn" id="rEdit" type="button" aria-label="종목 이름·코드 수정" title="종목 이름·코드 수정">${PENCIL}</button></div></div>${tradeQuoteLine({now:cur>0?P(cur):"",state:esc(status),gap:fromLow!=null?{label:"신저점 대비",text:`${fromLow>0?"+":""}${fromLow.toFixed(1)}%`,dir:fromLow>0?"up":fromLow<0?"down":""}:null})}${rebuyLink("line",ticker)}</div><div class="card progress-line">${next}</div>${rp?priceWarning(rp,esc(title)):""}
    <div class="metrics card"><div class="metric"><label>현재 상태</label><strong>${esc(status)}</strong><small>${ready?`현재 보유 약 ${won.format(s.held)}주 · 이탈 전 ${amount?manwon(amount):`${won.format(shares)}주`}${fromLow!=null?` · 신저점 대비 ${fromLow>0?"+":""}${fromLow.toFixed(1)}%`:""}`:"신저점 가격과 자산 배분 보유가 있어야 계산합니다"}</small></div><div class="metric"><label>손절</label><strong>${won.format(s.sold)}주</strong><small>${s.doneCuts}회${s.sellValue?` · ${P(s.sellValue)}`:""} · 평균 ${s.sellAvg?P(s.sellAvg):"—"}</small></div><div class="metric"><label>재매수 (금액)</label><strong>${usdMode?`${wonShort(s.buyValue)} / ${wonShort(s.sellValue)}`:`${decimal.format(s.buyValue/10000)} / ${decimal.format(s.sellValue/10000)}만원`}</strong><small>${won.format(s.rebought)}주 (판 ${won.format(s.sold)}주) · 평균 ${s.buyAvg?P(s.buyAvg):"—"}${s.buyAvg&&s.sellAvg?` · 손절 평균 대비 ${s.buyAvg>s.sellAvg?"+":""}${((s.buyAvg/s.sellAvg-1)*100).toFixed(1)}%`:""}</small></div></div>
    <div class="control-grid"><section class="card panel"><div class="panel-head"><h2>기준 입력</h2>${typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeRebuyEnabled(r,"breakdown"),'data-rebuy-alert="breakdown"',"신저점 이탈",s.started,"신저점 이탈"):""}</div><p>${usdMode?"가격은 미국 시세(달러)입니다.":"가격은 국내 상장 ETF 가격(원)입니다."} 현재가와 시선·일선·주선·월선 기준가는 종목 코드의 시세로, 이탈 전 보유는 자산 배분의 같은 종목 보유로 자동으로 채웁니다. 종목 코드는 종목 이름 옆 연필에서 바꿉니다.</p><div class="inline-fields"><label class="field"><span>현재가 (${unitWord})${autoTag()}</span><input id="rCurrent" type="number" value="${opt(cur)}" placeholder="${ticker?"시세 대기":"종목 코드 필요"}" readonly tabindex="-1"></label><label class="field"><span>신저점 가격 (${unitWord})</span><input id="rLow" type="number" min="0" step="any" value="${opt(low)}"></label><label class="field" style="grid-column:1/-1"><span>이탈 전 보유${live?'<small class="auto-tag">(자산 배분)</small>':fixed&&holdText?'<small class="auto-tag">(고정)</small>':""}</span><input id="rHold" type="text" value="${holdText}" placeholder="자산 배분 보유 없음" readonly tabindex="-1"></label></div><p class="hint" style="margin:10px 0 0">${holdHint}${priceHint?`<br>${priceHint}`:""}</p></section><section class="card panel" id="rCutRules"><h2>손절 규칙</h2><p>신저점 대비 ${shown(step)}% 내려갈 때마다 이탈 전 보유의 ${shown(sellPct)}%를 팝니다. 재매수 뒤 다시 내려가면 그때 보유(재매수 포함)의 ${shown(sellPct)}%씩 이어서 손절하고, 그다음 재매수는 이미 산 회차의 다음부터 합니다.</p><div class="inline-fields"><label class="field"><span>하락 간격 (%)</span><input id="rStep" type="number" min="0.1" max="50" step="0.1" value="${shown(step)}"></label><label class="field"><span title="이탈 전 보유 수량 기준">회당 손절 (%)</span><input aria-label="회당 손절 비율 (이탈 전 보유 수량의 %)" id="rSell" type="number" min="0.1" max="100" step="0.1" value="${shown(sellPct)}"></label><label class="field"><span>표시 회차</span><input id="rSteps" type="number" min="1" step="1" value="${Math.floor(Number(r.steps)||30)}"></label></div>${milestoneHtml}</section></div>
    <div class="section-heading"><h2>1. 신저점 이탈 손절</h2>${typeof tradeRebuyAllButtons==="function"?tradeRebuyAllButtons("cuts"):""}<span>${s.doneCuts}회 · ${won.format(s.sold)}주 손절</span></div><section class="card table-card sale-table rebuy-trade-table${fold.cuts?"":" hide-completed"}" id="rebuyCutTable"><div class="table-head"><span>회차</span><span>손절가</span><span>손절 수량 · 금액</span><span>상태</span></div>${s.doneCuts?`<button class="completed-fold-bar" id="toggleRebuyCuts" type="button" aria-expanded="${fold.cuts}" aria-controls="rebuyCutRows"><span>손절 완료 <b>${s.doneCuts}회 · ${won.format(s.cuts.filter(c=>c.done).reduce((n,c)=>n+c.qty,0))}주</b></span><span class="completed-fold-action">${fold.cuts?"접기":"펼치기"}</span></button>`:""}<div class="rebuy-trade-rows" id="rebuyCutRows">${cutRows}</div></section>
    <div class="section-heading"><h2>2. 단계별 재매수</h2>${typeof tradeRebuyAllButtons==="function"?tradeRebuyAllButtons("buys"):""}<span>${s.doneTranches} / ${s.tranches.length}회 · 설정한 마지막 회차까지${s.started?" · 진행 중":""} · 비운 기준가는 추정(배분 제외)</span><button class="btn mini" id="rStages" type="button">단계 편집</button><button class="btn mini ghost" id="rTimeframes" type="button">시·일·주·월선 추가</button></div><section class="card table-card stage-table sale-table rebuy-trade-table${fold.buys?"":" hide-completed"}" id="rebuyBuyTable"><div class="table-head"><span>단계 · 회차</span><span>기준가 · 회차 가격</span><span>재매수 수량 · 금액</span><span>상태</span></div>${s.doneTranches?`<button class="completed-fold-bar" id="toggleRebuyBuys" type="button" aria-expanded="${fold.buys}" aria-controls="rebuyBuyRows"><span>재매수 완료 <b>${s.doneTranches}회 · ${won.format(s.tranches.filter(x=>x.done).reduce((n,x)=>n+x.qty,0))}주</b></span><span class="completed-fold-action">${fold.buys?"접기":"펼치기"}</span></button>`:""}<div class="rebuy-trade-rows" id="rebuyBuyRows"${complete&&!fold.buys?" hidden":""}>${s.stages.map(stageRows).join("")}</div>${complete?'<div class="completed-fold-empty">손절과 재매수가 완료되었습니다.</div>':""}</section>
    <div class="reset-row"><button class="btn ghost mini" id="rReset" type="button" ${s.filledCuts||s.started?"":"disabled"}>체크 기록 초기화</button></div>
    <section class="card panel memo" style="margin-top:16px"><div class="memo-head"><h2>메모</h2><span id="rNoteCount" class="memo-count">${memoCount(r.note)}</span><button class="btn mini" id="rSave" type="button">저장</button></div><textarea id="rNote" maxlength="4000" style="min-height:100px">${esc(r.note||"")}</textarea></section>
    <p class="footnote">실제 주문은 증권사에서 직접 실행하세요. 누적 손절·재매수 수량을 입력하면 실제 체결량만 기록하고 잔량을 표시합니다. 체크하면 해당 회차의 잔량까지 완료합니다. 완료 회차는 펼쳐서 수량·체결가를 수정할 수 있습니다. 자산 배분에 같은 종목 코드가 있으면 체크할 때 그 계좌 보유량도 줄이거나 늘리고(계좌가 여럿이면 고름), 체결 수량·가격을 고치면 같이 맞추며, 체크를 풀면 되돌립니다. 재매수 시점은 현재가 시세가 있어야 표시됩니다. 수량은 정수 주로 나누며 수수료·세금은 빼지 않았습니다.</p>`;
  for(const [key,buttonId] of [["cuts","toggleRebuyCuts"],["buys","toggleRebuyBuys"]])if($(buttonId))$(buttonId).onclick=()=>{fold[key]=!fold[key];renderRebuy();$(buttonId)?.focus?.({preventScroll:true});};
  $$("#rebuyMain [aria-checked=mixed]").forEach(input=>{input.indeterminate=true;});
  if(typeof bindTradeRebuyAlerts==="function")bindTradeRebuyAlerts();
  const setField=(id,key,parse)=>onEdit("#"+id,v=>{v=parse(v.trim());if(v===undefined)return false;editRebuy()[key]=v;},renderRebuy);
  const nonNeg=v=>v===""?0:Number(v)>=0?Number(v):undefined;
  $("rEdit").onclick=()=>openRebuyDialog(r);
  setField("rLow","lowPrice",nonNeg); // 현재가(시세)·이탈 전 보유(자산 배분)는 읽기 전용
  setField("rStep","stepPct",v=>Number(v)>0&&Number(v)<=50?Number(v):undefined);setField("rSell","sellPct",v=>Number(v)>0&&Number(v)<=100?Number(v):undefined);setField("rSteps","steps",v=>Number(v)>=1&&Number.isSafeInteger(Math.floor(Number(v)))?Math.floor(Number(v)):undefined);
  // 손절·재매수 체크·체결 수정은 자산 배분 보유량과 연동(rebuyLink — 규칙은 rebuyFill 위 주석)
  $$("[data-cut]").forEach(input=>input.onchange=()=>{const i=Number(input.dataset.cut),src=rebuyPick(),c=cutPlan(src)[i];
    const rec=input.checked?rebuyCutRecord(src,i,String(c.recorded?Math.max(c.plannedQty,c.qty):c.qty),true):null;
    if(rec===false){renderRebuy();return;}applyRebuyCut(i,rec);
  });
  onEdit("[data-cut-qty]",(v,el)=>applyRebuyCut(Number(el.dataset.cutQty),rebuyCutRecord(rebuyPick(),Number(el.dataset.cutQty),v)),renderRebuy);
  onEdit("[data-cut-price]",(v,el)=>{const i=Number(el.dataset.cutPrice),src=rebuyPick(),old=src.cuts?.[i],text=v.trim(),price=text===""?null:Number(text);if(!old||price!==null&&!(Number.isFinite(price)&&price>0))return false;return applyRebuyCut(i,{...old,price});},renderRebuy);
  $$("[data-tranche-done]").forEach(input=>input.onchange=()=>{const [i,t]=input.dataset.trancheDone.split(":").map(Number),src=rebuyPick(),view=rebuySummary(src),tr=view.tranches.find(x=>x.i===i&&x.t===t);
    if(!input.checked){applyRebuyBuy(i,t,null);return;}
    const px=tr?.execPrice||((tr?.price>0&&!tr.est)?cents(tr.price):Number(src.currentPrice)||tr?.price),qty=tr?.partial?tr.plannedQty:tr?.done?tr.qty:px>0?rebuyPendingShares(tr?.amount,px):0;
    const rec=rebuyBuyRecord(src,i,t,String(qty),true);
    if(rec===false){alert(!view.sold?"손절한 수량이 없습니다. 먼저 손절 수량을 입력하세요.":!(px>0)?"현재가 시세나 이 단계의 기준가가 있어야 합니다.":"이 회차에는 배분된 금액이 없습니다.");renderRebuy();return;}
    applyRebuyBuy(i,t,rec);
  });
  // 회차 체결 수량·가격: 옛 통째 기록은 단계의 shares·execPrice, 새 기록은 buys[t]의 shares·price
  const fillOf=(key,el)=>{const [i,t]=el.dataset[key].split(":").map(Number),st=editRebuy().stages[i];return !st?null:st.done?[st,"execPrice"]:st.buys?.[t]?[st.buys[t],"price"]:null;};
  onEdit("[data-stage-price]",(v,el)=>{v=nonNeg(v.trim());if(v===undefined)return false;editRebuy().stages[Number(el.dataset.stagePrice)].price=v;},renderRebuy);
  const fillKey=(key,el)=>{const [i,t]=el.dataset[key].split(":").map(Number),x=editRebuy();return `rebuy:${x.id}:${x.stages[i]?.name}:${t}`;};
  onEdit("[data-tranche-exec]",(v,el)=>{v=Number(v);if(!(Number.isFinite(v)&&v>0))return false;const rec=fillOf("trancheExec",el);if(!rec)return false;rec[0][rec[1]]=v;rebuyLink("rescale",fillKey("trancheExec",el),rebuyFill(rebuyPick(),{shares:rec[0].shares,price:rec[0][rec[1]]},1));},renderRebuy);
  onEdit("[data-tranche-qty]",(v,el)=>{const [i,t]=el.dataset.trancheQty.split(":").map(Number);return applyRebuyBuy(i,t,rebuyBuyRecord(rebuyPick(),i,t,v));},renderRebuy);
  $("rTimeframes").onclick=()=>{const r=editRebuy(),stages=completeMovingStages(r.stages);if(stages.length>80){alert("재매수 단계는 80개까지 설정할 수 있습니다.");return;}r.stages=stages;if(priceData)fillPrices({rebuy:r},priceData);save();renderRebuy();};
  $("rStages").onclick=()=>openRebuyStages();
  $$("[data-rebuy-stage-edit]").forEach(b=>b.onclick=()=>openRebuyStages(Number(b.dataset.rebuyStageEdit)));
  // 초기화: 자산 배분에 반영한 손절·재매수가 있으면 되돌릴지 한 번 더 묻는다(취소하면 자산 배분은 그대로 두고 반영 기록만 지움 — 새로 체크할 때 겹치지 않게).
  $("rReset").onclick=()=>{if(!confirm(`${title} 손절·재매수 체크 기록을 모두 지울까요?\n신저점·규칙·단계·메모는 남기고, 이탈 전 보유는 다시 자산 배분에서 불러옵니다.`))return;const r=editRebuy();
    const keys=r.cuts.map((c,i)=>c&&`cut:${r.id}:${i}`).concat(r.stages.flatMap(x=>(Array.isArray(x.buys)?x.buys:[]).map((b,t)=>b&&`rebuy:${r.id}:${x.name}:${t}`))).filter(Boolean);
    r.cuts=[];r.stages.forEach(x=>{Object.assign(x,{done:false,shares:null,execPrice:null});delete x.buys;delete x.partial;delete x.plannedShares;});delete r.planned;delete r.plannedEndLine;delete r.resumeEndLine;save();rebuyLink("forget",keys,`${title} 손절·재매수`);renderRebuy();};
  const note=$("rNote");note.oninput=()=>$("rNoteCount").textContent=memoCount(note.value);
  onEdit("#rNote",v=>{editRebuy().note=v;});
  $("rSave").onclick=()=>{const x=editRebuy();if(note.value!==(x.note||""))x.note=note.value;save();renderRebuy();}; // 메모 저장(분할매도·분할매수와 같은 자리). editRebuy가 이탈 전 보유도 자산 배분에 맞춘다
}
// 자산 페이지에서 보유 종목·수량·시세가 바뀌면 재매수 탭의 '자산 배분' 줄·보유 가져오기에도 바로 반영한다. 입력 중에는 다시 그리지 않는다.
if(typeof assetStore==="object"&&typeof assetStore.subscribe==="function")assetStore.subscribe(type=>{
  if(!["change","prices"].includes(type)||state.tab!=="rebuy")return;
  const active=document.activeElement;if(active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)&&active.type!=="checkbox"&&!active.readOnly)return;
  renderRebuy();
});
