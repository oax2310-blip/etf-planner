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
// 이탈 전 주수 = amount(국내 만원/미국 달러)÷신저점 가격을 내림, 또는 직접 shares. 둘 다 있으면 금액 우선.
const holdShares = r => Number(r.amount)>0 ? (Number(r.lowPrice)>0 ? Math.floor(Number(r.amount)*(rebuyUsd(r)?1:10000)/Number(r.lowPrice)+1e-9) : 0) : wholeShares(r.shares);
// 보유 단위: 수량만 있으면 "shares"(주), 아니면 "amount"(국내 만원/미국 달러). 단위만 바꾼 rebuyUnit은 메모리 전용.
const holdUnit = r => !(Number(r.amount)>0) && wholeShares(r.shares)>0 ? "shares" : "amount";
let rebuyUnit = null;
// 보유 입력칸 저장: 고른 단위로 넣은 값만 남기고 다른 단위 값은 지운다(수량은 정수 주). 0·빈칸이면 둘 다 지움. 잘못된 값이면 false
function setHold(r, unit, text){
  let v=text===""?0:Number(text); if(!(v>=0))return false;
  const [key,other]=unit==="shares"?["shares","amount"]:["amount","shares"]; if(key==="shares")v=Math.floor(v);
  if(v>0){r[key]=v;delete r[other];}else{delete r.amount;delete r.shares;}
}
// k회 가격=신저점×(1−k×stepPct%), 주수=round(이탈 전 주수×sellPct%×k)의 인접 차이(정수 균등 배분).
// cuts[i]={shares,price} 체결은 기록량을 사용. 체결량 수정은 다음 예정량을 바꾸지 않으며 남은 보유량이 한도.
function cutPlan(r){
  const low=Number(r.lowPrice)||0, step=Number(r.stepPct)>0?Number(r.stepPct):1, pct=Math.min(Math.max(Number(r.sellPct)||0,0),100), cuts=Array.isArray(r.cuts)?r.cuts:[];
  const lastDone=cuts.reduce((m,c,i)=>c?i+1:m,0), n=Math.max(1,lastDone,Math.min(60,Math.floor(Number(r.steps)||30),Math.ceil(100/step)-1));
  const hold=holdShares(r), goal=k=>Math.round(hold*pct*k/100); // k회까지 누적 예정 수량(정수 주)
  let left=hold;
  return Array.from({length:n},(_,i)=>{
    const k=i+1, rec=cuts[i], price=Math.max(0,low*(1-k*step/100));
    if(rec){const qty=wholeShares(rec.shares);left=Math.max(0,left-qty);return {k,drop:k*step,price,qty,left,done:true,execPrice:Number(rec.price)>0?Number(rec.price):null};}
    const qty=Math.min(left,goal(k)-goal(k-1));left-=qty;
    return {k,drop:k*step,price,qty,left,done:false,execPrice:null};
  });
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
// 대상 단계 수: 첫 단계(기본 25선)부터 연속한 평균 손절가(avg) 이하 단계, 별도 상한 없음. 최소 1(첫 단계가 위면 첫 단계만 후보).
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
// 회차 계획 [[i, t]…]: 대상 단계(rebuySplits)의 회차 중 실제 기준가에서 나온 회차 가격이 평균 손절가 이하인 회차. 없으면 첫 단계 1차 하나.
function rebuyPlanned(stages,est,avg){
  if(!stages.length)return [];
  const out=[],n=rebuySplits(stages,avg);
  for(let i=0;i<n;i++)for(const x of stageCandidates(stages,est,i))if(x.price>0&&!x.est&&x.price<=avg)out.push([i,x.t]);
  return out.length?out:[[0,0]]; // 평균 손절가 이하 회차가 없으면 첫 단계 1차에서 한 번에(2·3차는 더 비싸다)
}
// 재매수 회차 목록 [{i, t, price, est, step, done, qty, execPrice, amount}]: 체결한 회차 + 계획 회차. 계획을 다 샀는데 남았으면 계획 뒤 첫 안 산 단계의 1회차.
// 남은 수량(rest)은 안 산 회차에 split(수량, 회차 수)로 나눈다. 산 회차의 amount는 부르는 쪽이 채운다.
function rebuyTranches(stages,est,fills,planned,rest,split){
  const list=[], seen=new Set(), add=(i,t,rec)=>{const k=`${i}:${t}`;if(!stages[i]||seen.has(k))return;seen.add(k);list.push({i,t,...trancheLevels(stages,est,i)[t],done:!!rec,qty:rec?.qty??0,execPrice:rec?.price??null,amount:0});};
  fills.forEach((f,i)=>f.forEach(rec=>add(i,rec.t,rec)));
  planned.forEach(([i,t])=>{if(!stages[i]?.done)add(i,t,null);});
  if(rest>0&&!list.some(x=>!x.done)){const last=Math.max(-1,...list.map(x=>x.i)),j=stages.findIndex((x,i)=>i>last&&!stageTouched(x));if(j>=0)add(j,0,null);}
  list.sort((a,b)=>a.i-b.i||a.t-b.t);
  const open=list.filter(x=>!x.done), parts=rest>0&&open.length?split(rest,open.length):[];
  open.forEach((x,k)=>{x.amount=parts[k]??0;});
  return list;
}
// 표시용: 계획이 있는 단계에서 평균 손절가 위(또는 추정 가격)라 사지 않는 회차
const rebuySkipped = (stages,est,list) => [...new Set(list.map(x=>x.i))].filter(i=>!stages[i].done).flatMap(i=>stageCandidates(stages,est,i).filter(x=>!list.some(y=>y.i===i&&y.t===x.t)).map(x=>({i,...x})));
// 첫 재매수 때 고정한 r.planned=[[단계 이름,회차]…]를 현재 [i,t]로 읽음. 모든 체크 해제/초기화 때 지움; 기한 없음.
function storedPlan(r,stages){
  const list=(Array.isArray(r.planned)?r.planned:[]).map(x=>Array.isArray(x)?[stages.findIndex(y=>y.name===stageName(x[0])),Number(x[1])]:null).filter(x=>x&&x[0]>=0&&Number.isInteger(x[1])&&x[1]>=0&&x[1]<TRANCHES);
  return list.length?list:null;
}
// n회로 나누기: 금액은 똑같이, 계약은 누적 반올림 차이로 고르게 흩는다(3계약 5회면 1·0·1·0·1 — 앞 회차에만 몰리지 않게).
const splitValue = (v,n) => Array(n).fill(v/n);
const splitWhole = (v,n) => Array.from({length:n},(_,k)=>Math.round(v*(k+1)/n)-Math.round(v*k/n));
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
  if(valid&&rest>0&&Array.from({length:n},(_,i)=>records[i]).every(Boolean))n++;
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
// 손절 금액(수량×실제 체결가, 없으면 계획가)만 복원; 평균 손절가=금액÷주수, 미매수 회차에 splitValue로 균등 금액.
// 배분 대상/3분할/고정 계획은 rebuyPlanned·trancheLevels·storedPlan. 재매수를 하나라도 기록하면 남은 손절 중단.
function rebuySummary(r){
  const cuts=cutPlan(r), stages=stagesOf(r), done=cuts.filter(c=>c.done), cur=Number(r.currentPrice)||0, fills=stages.map(x=>stageFills(x,"shares")), all=fills.flat(), started=all.length>0;
  const sellAt=c=>c.execPrice||c.price, sold=done.reduce((a,c)=>a+c.qty,0), sellValue=done.reduce((a,c)=>a+sellAt(c)*c.qty,0), sellAvg=sold?sellValue/sold:null;
  const buyAt=x=>x.price>0?x.price:sellAvg||0, rebought=all.reduce((a,x)=>a+x.qty,0), buyValue=all.reduce((a,x)=>a+x.qty*buyAt(x),0);
  const priced=all.filter(x=>x.price>0&&x.qty>0), pq=priced.reduce((a,x)=>a+x.qty,0), buyAvg=pq?priced.reduce((a,x)=>a+x.qty*x.price,0)/pq:null;
  // 남은 재매수 금액. 반 주(평균 손절가의 절반) 미만 자투리는 정수 주로 살 수 없으니 다 산 것으로 본다.
  const left=sellValue-buyValue, rest=sold&&left>=sellAvg/2?left:0;
  const lastBuy=[...all].reverse().find(x=>x.price>0), start=cur>0?cur:lastBuy?lastBuy.price:sellAvg||0, est=stageEstimates(stages,start);
  const planned=started&&storedPlan(r,stages)||rebuyPlanned(stages,est,sellAvg);
  const tranches=rebuyTranches(stages,est,fills,planned,rest,splitValue); // 회차별 금액(원)
  tranches.forEach(x=>{if(x.done)x.amount=x.qty*(x.execPrice>0?x.execPrice:sellAvg||0);}); // 산 회차는 체결가(없으면 손절 평균가)로
  const plan=stages.map((x,i)=>tranches.reduce((a,y)=>y.i===i?a+y.amount:a,0)); // 단계별 금액(원)
  return {cuts,stages,plan,est,tranches,skipped:rebuySkipped(stages,est,tranches),planKeys:planned.map(([i,t])=>[stages[i].name,t]),sold,rebought,sellValue,buyValue,rest,sellAvg,buyAvg,started,doneCuts:done.length,doneTranches:tranches.filter(x=>x.done).length,held:Math.max(0,holdShares(r)-sold+rebought)};
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
  return r;
}
// 상태 글자: [화면 '현재 상태', 목록 카드 오른쪽 짧은 글자]
function rebuyStatus(r,s){
  const low=Number(r.lowPrice)||0, cur=Number(r.currentPrice)||0, fromLow=low>0&&cur>0?(cur/low-1)*100:null;
  if(!(low>0&&holdShares(r)>0))return ["입력 필요","입력 필요"];
  if(s.started&&!s.rest)return ["재매수 완료","완료"];
  if(s.started)return [`재매수 ${s.doneTranches}/${s.tranches.length}회`,`재매수 ${s.doneTranches}/${s.tranches.length}`];
  if(s.doneCuts)return [`손절 ${s.doneCuts}회 진행`,`손절 ${s.doneCuts}회`];
  return fromLow!=null&&fromLow<0?["신저점 이탈","신저점 이탈"]:fromLow!=null?["신저점 위","대기"]:["손절 대기","대기"];
}
// 종목 추가·이름/코드 수정 창(rebuyDialog). 이 파일은 테스트가 DOM 없이 불러오므로 창 처리는 이 함수 안에서 연결한다.
// 새 종목은 기본 규칙·단계로 만든다. 종목 코드를 바꾸면 auto를 지워 다음 동기화 때 새 종목 시세로 채운다.
// 종목 삭제는 실제 체결인 자산 배분을 그대로 둔다(초기화의 forget와 다름).
function openRebuyDialog(edit){
  const dialog=$("rebuyDialog"), form=$("rebuyForm"), f=form.elements;
  form.reset();$("rebuyTitle").textContent=edit?`${String(edit.name||"").trim()||"종목"} 수정`:"새 재매수 종목";$("deleteRebuyBtn").classList.toggle("hidden",!edit);
  if(edit){f.name.value=edit.name||"";f.ticker.value=edit.ticker||"";}
  form.onsubmit=e=>{e.preventDefault();const name=f.name.value.trim().slice(0,40), ticker=f.ticker.value.trim().toUpperCase().slice(0,80);if(!name)return;
    let r;if(edit)r=editRebuy();else{r={id:id(),...defaultRebuy()};editRebuyList().push(r);state.selectedRebuy=r.id;rebuyUnit=null;}
    r.name=name;if(ticker!==(r.ticker||"")){if(ticker)r.ticker=ticker;else delete r.ticker;delete r.auto;}
    save();dialog.close();renderRebuy();};
  $("deleteRebuyBtn").onclick=()=>{const r=rebuyPick();if(!r||!confirm(`${String(r.name||"").trim()||"이 종목"} 재매수 기록을 삭제할까요?\n손절·재매수 체크와 메모도 함께 지워집니다.`))return;
    const gone=editRebuy();state.rebuy.items=state.rebuy.items.filter(x=>x!==gone);state.selectedRebuy=state.rebuy.items[0]?.id||null;rebuyUnit=null;save();dialog.close();renderRebuy();};
  dialog.querySelectorAll("[data-close-rebuy]").forEach(b=>b.onclick=()=>dialog.close());
  dialog.showModal();f.name.focus();
}
// 화면: 왼쪽(모바일은 위) 종목 목록(분할매도 '저장된 계획'과 같은 카드 — 종목 이름, 오른쪽 짧은 상태, 아래 종목 코드(PC), 막대는 재매수 금액/손절 금액)
// + 고른 종목. 제목은 작은 글씨 '손절 후 재매수 · 종목 코드' 아래 종목 이름(크게), 옆 연필로 이름·코드 수정·종목 삭제 창.
// 이름·코드는 기준 입력에 넣지 않음; 짧은 상태는 PC 오른쪽/모바일 이름 아래. 계산 요약·메모는 두 칸 유지.
function renderRebuy(){
  const items=rebuyItems(state), r=rebuyPick();
  $("rebuyList").innerHTML=items.length?items.map((x,i)=>{const s=rebuySummary(x), [,short]=rebuyStatus(x,s), name=String(x.name||"").trim()||"이름 없음", code=String(x.ticker||"").trim(), done=s.sellValue?Math.min(100,Math.round(s.buyValue/s.sellValue*100)):0;
    return `<button class="plan-item ${x===r?"active":""}" type="button" data-rebuy="${i}" title="${esc(name)}${code?` (${esc(code)})`:""} · ${esc(short)}"><span class="plan-row"><strong>${esc(name)}</strong><span class="plan-count">${esc(short)}</span></span><span class="plan-title">${esc(code)}</span><span class="plan-bar"><i style="width:${done}%"></i></span></button>`;}).join(""):"<div class='empty'>종목 없음</div>";
  $$("#rebuyList [data-rebuy]").forEach(b=>b.onclick=()=>{const x=rebuyItems(state)[Number(b.dataset.rebuy)];if(!x||x===rebuyPick())return;state.selectedRebuy=x.id||null;rebuyUnit=null;save();renderRebuy();});
  $("addRebuyBtn").onclick=()=>openRebuyDialog();
  if(!r){$("rebuyMain").innerHTML="<div class='card empty'><h2>재매수 종목을 추가하세요</h2></div>";return;}
  const s=rebuySummary(r), low=Number(r.lowPrice)||0, cur=Number(r.currentPrice)||0, shares=holdShares(r), amount=Number(r.amount)>0?Number(r.amount):0, qtyIn=amount?0:wholeShares(r.shares), unit=rebuyUnit||holdUnit(r), inQty=unit==="shares";
  const step=Number(r.stepPct)>0?Number(r.stepPct):1, sellPct=Number(r.sellPct)||0, first=s.stages[0]?.name||"첫 단계", lastStage=s.stages[s.stages.length-1], lastName=lastStage?.name||"마지막 단계", finalPrice=Number(lastStage?.price)||0, ready=low>0&&shares>0;
  const opt=v=>Number(v)>0?shown(v):"", fromLow=low>0&&cur>0?(cur/low-1)*100:null;
  // 종목 코드를 넣으면 현재가·N일선·N선 단계 기준가를 시세 파일로 채운다(prices.js, 국내·미국 종목). 없거나 다른 종류(비트코인)면 기준 입력 아래에 알림
  const ticker=String(r.ticker||""), re=stockEntry(priceData,ticker), rp=re?.kind===(rebuyUsd(r)?"해외":"국내")?re:null;
  const priceHint=!ticker||!priceData?"":re&&!rp?"국내·미국 종목 코드만 시세로 채웁니다.":!re?"시세 수집 후 (장중 30분마다) 현재가·시선·일선·주선·월선 기준가를 채웁니다.":"";
  // 현재가·자동 단계 이름 옆에 작고 흐린 '(자동)'(.auto-tag): 국내/미국 코드 + 시세 파일을 읽었을 때(아직 파일에 없는 코드 포함).
  const autoTag=label=>ticker&&priceData&&(!re||rp)&&(!label||autoKey(label))?`<small class="auto-tag">(자동)</small>`:"";
  const complete=s.started&&!s.rest, nextCut=s.cuts.find(c=>!c.done&&c.qty>0), nextTr=s.tranches.find(x=>!x.done&&x.amount>0);
  const [status]=rebuyStatus(r,s), title=String(r.name||"").trim()||"이름 없음";
  // 자산 배분 보유량 가져오기(alloc-link.js holding): 손절·재매수 체크 전에만(체크 뒤 자산 배분은 손절이 반영된 보유량). 수량 합 또는 평가액(만원 — 미국 종목은 달러로 환산).
  const allocHold=!s.doneCuts&&!s.started&&ticker?rebuyLink("holding",ticker):null;
  // 통화: 미국 종목은 가격 $123.45·금액 $1,235·보유 금액 달러, 그 밖은 가격 원·금액 만원
  const usdMode=rebuyUsd(r), unitWord=usdMode?"달러":"원", P=v=>priceText(v,usdMode?"USD":"KRW"), cents=v=>usdMode?Math.round(v*100)/100:Math.round(v);
  const manwon=v=>usdMode?`$${won.format(Math.round(v))}`:`${decimal.format(v)}만원`, holdScale=usdMode?1:10000, holdWord=usdMode?"달러":"만원";
  const wonShort=v=>usdMode?`$${won.format(Math.round(v))}`:v>=10000?manwon(Math.round(v/1000)/10):money(v), amt=(qty,price)=>price>0&&qty>0?`약 ${wonShort(qty*price)}`:"", approx=(qty,price)=>amt(qty,price)&&` · ${amt(qty,price)}`;
  // 이탈 전 보유: 고른 단위로 저장한 값이 있으면 그 값, 다른 단위로 저장돼 있으면 빈칸에 환산값을 흐리게 보여 준다
  const holdValue=inQty?qtyIn||"":amount?shown(amount):"", holdPlaceholder=inQty?(amount&&low>0?`≈${won.format(shares)}주`:"예: 500"):(qtyIn&&low>0?`≈${manwon(qtyIn*low/holdScale)}`:"예: 1000");
  const holdHint=(amount&&low>0?`${manwon(amount)} ÷ 신저점 ${P(low)} ≈ ${won.format(shares)}주로 계산합니다.`:qtyIn?`보유 수량 ${won.format(qtyIn)}주로 계산합니다.`:amount?"신저점 가격을 넣으면 보유 금액을 신저점 가격으로 나눈 주 수(정수)로 계산합니다.":`보유 금액(${holdWord})을 넣으면 신저점 가격으로 나눈 주 수(정수)로, 수량(주)을 넣으면 그 주 수로 손절 수량을 계산합니다.`)
    +(inQty&&amount?" 주 수를 넣으면 수량 기준으로 바뀝니다.":!inQty&&qtyIn?" 금액을 넣으면 금액 기준으로 바뀝니다.":"");
  // 분할 안내: 회차 수와 범위, 평균 손절가 기준. 예: 5분할 (25선 1차~32선 2차, 평균 손절가 10,000원 이하 회차)
  // 회차 이름: 단계 이름 뒤에 작은 회차 번호 칩(css .tr-no). 화면 읽기용 이름(trText)은 '25선 2회차'
  const trName=x=>`<span class="tr-name">${esc(s.stages[x.i].name)}${s.stages[x.i].done?"":`<span class="tr-no">${x.t+1}</span>`}</span>`, trText=x=>`${esc(s.stages[x.i].name)}${s.stages[x.i].done?"":` ${x.t+1}회차`}`, firstTr=s.tranches[0], lastTr=s.tranches.at(-1), firstPx=Number(s.stages[0]?.price)||0;
  const splitText=!s.sellAvg||!firstTr?"":`${s.tranches.length>1?`${s.tranches.length}분할 (${trName(firstTr)}~${trName(lastTr)}`:`한 번에 (${trName(firstTr)}`}, ${!firstPx?`${esc(first)} 기준가 없음`:firstPx<=s.sellAvg?`평균 손절가 ${P(s.sellAvg)} 이하 회차`:`평균 손절가 ${P(s.sellAvg)}보다 ${esc(first)} 기준가가 높음`})`;
  const trAt=x=>x.price>0?` · ${x.est?"≈":""}${P(x.price)} 이상`:"";
  const next=!ready?"신저점 가격과 이탈 전 보유 금액(또는 수량)을 입력하면 손절 회차가 계산됩니다."
    :complete?`재매수 완료 · 손절 ${P(s.sellValue)} → 재매수 ${P(s.buyValue)} (${won.format(s.sold)}주 → ${won.format(s.rebought)}주)`
    :!s.started?`다음 손절 <b>${nextCut?`${nextCut.k}회 · ${P(nextCut.price)} 이하에서 ${won.format(nextCut.qty)}주${approx(nextCut.qty,nextCut.price)}`:"없음"}</b>${s.sold?` · ${esc(first)} 반등 신호가 나오면 재매수 시작 <b>약 ${wonShort(nextTr?.amount??0)}</b> · ${splitText}`:""}`
    :nextTr?`다음 재매수 <b>${trName(nextTr)}${trAt(nextTr)}에서 약 ${wonShort(nextTr.amount)}</b> · 남은 약 ${wonShort(s.rest)} · 손절은 멈춤`
    :`모든 단계를 체크했지만 약 ${wonShort(s.rest)}이 남았습니다 · 단계 편집으로 단계를 추가하세요`;
  const cutRow=c=>{const due=!c.done&&cur>0&&cur<=c.price;return `<div class="sale-row ${c.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-cut="${c.k-1}" ${c.done?"checked":""}>${c.k}회</label><div class="stage-price"><span class="price">${P(c.price)}</span><span class="krw">신저점 −${shown(c.drop)}%</span>${typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeRebuyEnabled(r,"cuts",c.k-1),`data-rebuy-alert="cuts" data-alert-index="${c.k-1}"`,`${c.k}회 손절`,c.done):""}</div><div class="shares">${c.done?`<span class="exec-fields"><input class="qty" data-cut-qty="${c.k-1}" type="number" min="0" step="1" value="${c.qty}" aria-label="${c.k}회 손절 수량">주 <input data-cut-price="${c.k-1}" type="number" min="0" step="any" value="${opt(c.execPrice)}" placeholder="체결가" aria-label="${c.k}회 체결가">${unitWord}</span>`:`<span>${won.format(c.qty)}주</span><div class="sub">${amt(c.qty,c.price)}<span class="hide-mobile">${amt(c.qty,c.price)&&" · "}남은 약 ${won.format(c.left)}주</span></div>`}</div><div class="status ${c.done?"done":due?"due":""}">${c.done?"손절 완료":due?"손절 시점":"대기"}</div></div>`;};
  const cutRows=!ready&&!s.doneCuts?"<div class='empty'>기준 입력에 신저점 가격과 이탈 전 보유 금액(또는 수량)을 넣으세요.</div>":(s.started?s.cuts.filter(c=>c.done):s.cuts).map(cutRow).join("")+(s.started?`<div class="stop-note">재매수를 시작해 남은 손절 회차는 멈췄습니다. 재매수 체크를 모두 풀면 다시 보입니다.</div>`:"");
  // 단계별 재매수: 분할 범위 단계(또는 산 단계)는 회차마다 한 줄(첫 줄에 단계 기준가·알림), 나머지 단계는 기준가만 한 줄.
  const stageRows=(st,i)=>{
    const own=s.tranches.filter(x=>x.i===i), rows=[...own,...s.skipped.filter(x=>x.i===i).map(x=>({...x,skip:true}))].sort((a,b)=>a.t-b.t), px=Number(st.price)||0, nextName=esc(s.stages[i+1]?.name||"");
    const alert=typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeRebuyEnabled(r,"buys",i),`data-rebuy-alert="buys" data-alert-index="${i}"`,`${st.name} 재매수`,own.length>0&&own.every(x=>x.done)):"";
    const priceInput=`<span class="exec-fields">기준 <input data-stage-price="${i}" type="number" min="0" step="any" value="${opt(px)}" placeholder="${s.est[i]?`≈${usdMode?usd.format(s.est[i]):won.format(Math.round(s.est[i]))}`:"선택"}" aria-label="${esc(st.name)} 기준가">${unitWord}${autoTag(st.name)}</span>${alert}`;
    if(!own.length)return `<div class="sale-row"><label class="check"><input type="checkbox" data-tranche-done="${i}:0">${esc(st.name)}</label><div class="stage-price">${priceInput}</div><div class="shares">${s.sold?"—":"손절 후 계산"}</div><div class="status">대기</div></div>`;
    return rows.map((x,k)=>{
      const due=!x.skip&&!x.done&&x.amount>0&&cur>0&&x.price>0&&cur>=x.price, nextUp=x===nextTr, ref=x.price||cur;
      const where=x.step?`${esc(st.name)}→${nextName} ${x.t}/${TRANCHES}`:x.t?"단계 가격과 같음":"";
      const pricePart=k===0?priceInput:`<span class="price">${x.price>0?`${x.est?"≈":""}${P(x.price)}`:"—"}</span><span class="krw">${where}</span>`;
      // 계획 밖 회차(평균 손절가 위·추정 가격)는 사지 않는다
      if(x.skip)return `<div class="sale-row"><label class="check"><input type="checkbox" disabled>${trName(x)}</label><div class="stage-price">${pricePart}</div><div class="shares">—<div class="sub">${x.est?"추정 가격이라 제외":s.sellAvg&&x.price>s.sellAvg?"평균 손절가 위":"계획 밖"}</div></div><div class="status">안 삼</div></div>`;
      const shares=x.done?`<span class="exec-fields"><input class="qty" data-tranche-qty="${i}:${x.t}" type="number" min="0" step="1" value="${x.qty}" aria-label="${trText(x)} 재매수 수량">주 <input data-tranche-exec="${i}:${x.t}" type="number" min="0" step="any" value="${opt(x.execPrice)}" placeholder="체결가" aria-label="${trText(x)} 체결가">${unitWord}</span><div class="sub">${amt(1,x.amount)}</div>`
        :!s.sold?"손절 후 계산":x.amount>0?`<span>약 ${wonShort(x.amount)}</span><div class="sub">${ref?`약 ${won.format(Math.max(1,Math.round(x.amount/ref)))}주`:"현재가 넣으면 수량"}</div>`:"—";
      return `<div class="sale-row ${x.done?"done":""} ${due?"due":""}"><label class="check"><input type="checkbox" data-tranche-done="${i}:${x.t}" ${x.done?"checked":""}>${trName(x)}</label><div class="stage-price">${pricePart}</div><div class="shares">${shares}</div><div class="status ${x.done?"done":due||nextUp?"due":""}">${x.done?"매수 완료":due?"재매수 시점":nextUp?"다음 신호":"대기"}</div></div>`;
    }).join("");
  };
  $("rebuyMain").innerHTML=`<div class="heading"><div><div class="eyebrow">손절 후 재매수${ticker?` · ${esc(ticker)}`:""}${rp?` · ${priceStamp(rp)}`:""}</div><div class="title-row"><h1>${esc(title)}</h1><button class="btn icon-btn" id="rEdit" type="button" aria-label="종목 이름·코드 수정" title="종목 이름·코드 수정">${PENCIL}</button></div><p>신저점 이탈 뒤 ${shown(step)}% 내려갈 때마다 이탈 전 보유의 ${shown(sellPct)}%씩 손절하고, 손절한 금액만큼 되삽니다. 단계마다 다음 단계 가격까지 ${TRANCHES}번으로 나눈 회차 중 평균 손절가 이하인 회차에 똑같이 나눠 삽니다(없으면 ${esc(first)} 1회차에서 한 번에).</p>${rebuyLink("line",ticker)}</div><button class="btn" id="rSave">변경 저장</button></div><div class="card progress-line">${next}</div>${rp?priceWarning(rp,esc(title)):""}
    <div class="metrics card"><div class="metric"><label>현재 상태</label><strong>${esc(status)}</strong><small>${ready?`현재 보유 약 ${won.format(s.held)}주 · 이탈 전 ${amount?manwon(amount):`${won.format(shares)}주`}${fromLow!=null?` · 신저점 대비 ${fromLow>0?"+":""}${fromLow.toFixed(1)}%`:""}`:"기준 입력에 신저점·보유 금액(또는 수량)을 넣으세요"}</small></div><div class="metric"><label>손절</label><strong>${won.format(s.sold)}주</strong><small>${s.doneCuts}회${s.sellValue?` · ${P(s.sellValue)}`:""} · 평균 ${s.sellAvg?P(s.sellAvg):"—"}</small></div><div class="metric"><label>재매수 (금액)</label><strong>${usdMode?`${wonShort(s.buyValue)} / ${wonShort(s.sellValue)}`:`${decimal.format(s.buyValue/10000)} / ${decimal.format(s.sellValue/10000)}만원`}</strong><small>${won.format(s.rebought)}주 (판 ${won.format(s.sold)}주) · 평균 ${s.buyAvg?P(s.buyAvg):"—"}${s.buyAvg&&s.sellAvg?` · 손절 평균 대비 ${s.buyAvg>s.sellAvg?"+":""}${((s.buyAvg/s.sellAvg-1)*100).toFixed(1)}%`:""}</small></div></div>
    <div class="control-grid"><section class="card panel"><div class="panel-head"><h2>기준 입력</h2>${typeof tradeAlertToggle==="function"?tradeAlertToggle(tradeRebuyEnabled(r,"breakdown"),'data-rebuy-alert="breakdown"',"신저점 이탈",s.started,"신저점 이탈"):""}</div><p>${usdMode?"가격은 미국 시세(달러)입니다.":"가격은 국내 상장 ETF 가격(원)입니다."} 현재가는 선택 — 넣으면 도달한 손절 회차와 재매수 시점을 표시합니다. 종목 이름 옆 연필에서 종목 코드를 넣으면 현재가·시선·일선·주선·월선 기준가를 시세로 자동으로 채웁니다.</p><div class="inline-fields"><label class="field"><span>현재가 (${unitWord})${autoTag()}</span><input id="rCurrent" type="number" min="0" step="any" value="${opt(cur)}" placeholder="선택"></label><label class="field"><span>신저점 가격 (${unitWord})</span><input id="rLow" type="number" min="0" step="any" value="${opt(low)}"></label><label class="field"><span>이탈 전 보유</span><div class="hold-input"><input id="rHold" type="number" min="0" step="${inQty?1:"any"}" value="${holdValue}" placeholder="${holdPlaceholder}" aria-label="이탈 전 보유 ${inQty?"수량(주)":`금액(${holdWord})`}"><select id="rHoldUnit" aria-label="보유 입력 단위"><option value="amount"${inQty?"":" selected"}>${holdWord}</option><option value="shares"${inQty?" selected":""}>주</option></select></div></label><label class="field"><span>${esc(lastName)} 가격 (${unitWord})${lastStage?autoTag(lastName):""}</span><input id="rFinal" type="number" min="0" step="any" value="${opt(finalPrice)}" placeholder="선택 · 빈 단계 추정용"></label></div><p class="hint" style="margin:10px 0 0">${holdHint}${allocHold?`<br>자산 배분 ${esc(allocHold.text)} · <button class="text-link" type="button" id="rHoldLink">이탈 전 보유로 가져오기</button>`:""}${priceHint?`<br>${priceHint}`:""}</p></section><section class="card panel"><h2>손절 규칙</h2><p>신저점 대비 ${shown(step)}% 내려갈 때마다 이탈 전 보유의 ${shown(sellPct)}%를 팝니다. 재매수를 체크하면 남은 손절은 멈춥니다.</p><div class="inline-fields"><label class="field"><span>하락 간격 (%)</span><input id="rStep" type="number" min="0.1" max="50" step="0.1" value="${shown(step)}"></label><label class="field"><span>회당 손절 (기존 수량의&nbsp;%)</span><input id="rSell" type="number" min="0.1" max="100" step="0.1" value="${shown(sellPct)}"></label><label class="field"><span>표시 회차</span><input id="rSteps" type="number" min="1" max="60" step="1" value="${Math.floor(Number(r.steps)||30)}"></label></div></section></div>
    <div class="section-heading"><h2>1. 신저점 이탈 손절</h2>${typeof tradeRebuyAllButtons==="function"?tradeRebuyAllButtons("cuts"):""}<span>${s.doneCuts}회 · ${won.format(s.sold)}주 손절</span></div><section class="card table-card"><div class="table-head"><span>회차</span><span>손절가</span><span>손절 수량 · 금액</span><span>상태</span></div><div>${cutRows}</div></section>
    <div class="section-heading"><h2>2. 단계별 재매수</h2>${typeof tradeRebuyAllButtons==="function"?tradeRebuyAllButtons("buys"):""}<span>${s.doneTranches} / ${s.tranches.length}회 · 평균 손절가 이하 회차에 나눔${s.started?"(고정)":""} · 비운 기준가는 추정(배분 제외)</span><button class="btn mini" id="rStages" type="button">단계 편집</button><button class="btn mini ghost" id="rTimeframes" type="button">시·일·주·월선 추가</button></div><section class="card table-card stage-table"><div class="table-head"><span>단계 · 회차</span><span>기준가 · 회차 가격</span><span>재매수 금액 · 수량</span><span>상태</span></div><div>${s.stages.map(stageRows).join("")}</div></section>
    <div class="reset-row"><button class="btn ghost mini" id="rReset" type="button" ${s.doneCuts||s.started?"":"disabled"}>체크 기록 초기화</button></div>
    <section class="card panel memo" style="margin-top:16px"><div class="memo-head"><h2>메모</h2><span id="rNoteCount">${memoCount(r.note)}</span></div><textarea id="rNote" maxlength="4000" style="min-height:100px">${esc(r.note||"")}</textarea></section>
    <p class="footnote">실제 주문은 증권사에서 직접 실행하세요. 체크하면 손절가·예정 수량이 먼저 기록되니 실제 체결가·수량으로 고치세요. 자산 배분에 같은 종목 코드가 있으면 체크할 때 그 계좌 보유량도 줄이거나 늘리고(계좌가 여럿이면 고름), 체결 수량·가격을 고치면 같이 맞추며, 체크를 풀면 되돌립니다. 재매수 시점은 현재가를 넣어야 표시됩니다. 수량은 정수 주로 나누며 수수료·세금은 빼지 않았습니다.</p>`;
  if(typeof bindTradeRebuyAlerts==="function")bindTradeRebuyAlerts();
  const setField=(id,key,parse)=>onEdit("#"+id,v=>{v=parse(v.trim());if(v===undefined)return false;editRebuy()[key]=v;},renderRebuy);
  const nonNeg=v=>v===""?0:Number(v)>=0?Number(v):undefined;
  $("rEdit").onclick=()=>openRebuyDialog(r);
  setField("rCurrent","currentPrice",nonNeg);setField("rLow","lowPrice",nonNeg);
  onEdit("#rHold",v=>{if(setHold(editRebuy(),unit,v.trim())===false)return false;rebuyUnit=unit;},renderRebuy);
  $("rHoldUnit").onchange=e=>{rebuyUnit=e.target.value==="shares"?"shares":"amount";renderRebuy();$("rHold").focus();}; // 단위만 바꿈(값은 새로 넣을 때 바뀜)
  if(allocHold)$("rHoldLink").onclick=()=>{const unit=allocHold.shares>0?"shares":"amount", v=unit==="shares"?allocHold.shares:usdMode?(allocHold.fx?Math.round(allocHold.value*1e4/allocHold.fx):0):allocHold.value;
    if(!(v>0)||setHold(editRebuy(),unit,String(v))===false)return;rebuyUnit=unit;save();renderRebuy();};
  onEdit("#rFinal",v=>{v=nonNeg(v.trim());if(v===undefined)return false;const st=editRebuy().stages;if(!st.length)return false;st[st.length-1].price=v;},renderRebuy);
  setField("rStep","stepPct",v=>Number(v)>0&&Number(v)<=50?Number(v):undefined);setField("rSell","sellPct",v=>Number(v)>0&&Number(v)<=100?Number(v):undefined);setField("rSteps","steps",v=>Number(v)>=1&&Number(v)<=60?Math.floor(Number(v)):undefined);
  // 손절·재매수 체크·체결 수정은 자산 배분 보유량과 연동(rebuyLink — 규칙은 rebuyFill 위 주석)
  $$("[data-cut]").forEach(input=>input.onchange=()=>{const i=Number(input.dataset.cut);
    if(input.checked){const src=rebuyPick(), c=cutPlan(src)[i], rec={shares:c.qty,price:rebuyUsd(src)?Math.round(c.price*100)/100:Math.round(c.price)};
      rebuyLink("check",{ticker:src.ticker,trade:rebuyFill(src,rec,-1),label:`${String(src.name||"").trim()||"재매수"} 손절 ${i+1}회`,prefer:[`cut:${src.id}:`],redraw:renderRebuy,
        commit:()=>{const x=editRebuy();while(x.cuts.length<i)x.cuts.push(null);x.cuts[i]=rec;save();return `cut:${x.id}:${i}`;}});return;}
    const x=editRebuy();x.cuts[i]=null;while(x.cuts.length&&!x.cuts[x.cuts.length-1])x.cuts.pop();save();rebuyLink("uncheck",`cut:${x.id}:${i}`);renderRebuy();});
  const cutEdit=(key,set)=>onEdit(`[data-cut-${key}]`,(v,el)=>{const i=Number(el.dataset[key==="qty"?"cutQty":"cutPrice"]), x=editRebuy(), rec=x.cuts[i];if(!rec||set(rec,v.trim())===false)return false;rebuyLink("rescale",`cut:${x.id}:${i}`,rebuyFill(x,rec,-1));},renderRebuy);
  cutEdit("qty",(rec,v)=>{if(v===""||!(Number(v)>=0))return false;rec.shares=Math.floor(Number(v));});
  cutEdit("price",(rec,v)=>{rec.price=Number(v)>0?Number(v):null;});
  $$("[data-tranche-done]").forEach(input=>input.onchange=()=>{const [i,t]=input.dataset.trancheDone.split(":").map(Number);
    if(input.checked){const src=rebuyPick(),view=rebuySummary(src),tr=view.tranches.find(x=>x.i===i&&x.t===t),cur=Number(src.currentPrice)||0;
      const px=tr&&tr.price>0&&!tr.est?cents(tr.price):cur>0?cur:cents(tr?.price||0); // 회차 가격(추정치면 현재가)으로 기록, 원 단위(달러는 센트)
      if(!(view.sold>0)){alert("손절한 수량이 없습니다. 먼저 손절 회차를 체크하세요.");input.checked=false;return;}
      if(!(tr?.amount>0)){alert(view.rest>0?"이 회차에는 배분된 금액이 없습니다.":"손절한 금액을 모두 재매수했습니다.");input.checked=false;return;}
      if(!(px>0)){alert("현재가(또는 이 단계의 기준가)를 먼저 넣으세요. 그 가격으로 재매수 수량을 계산합니다.");input.checked=false;return;}
      const rec={shares:Math.max(1,Math.round(tr.amount/px)),price:px}, name=view.stages[i].name;
      rebuyLink("check",{ticker:src.ticker,trade:rebuyFill(src,rec,1),label:`${String(src.name||"").trim()||"재매수"} ${name} ${t+1}차 재매수`,prefer:[`rebuy:${src.id}:`,`cut:${src.id}:`],redraw:renderRebuy,
        commit:()=>{const r=editRebuy(),st=r.stages[i];if(!st)return false;if(!view.started)r.planned=view.planKeys; // 첫 재매수 때 회차 계획을 고정
          if(!Array.isArray(st.buys))st.buys=[];while(st.buys.length<t)st.buys.push(null);st.buys[t]=rec;save();return `rebuy:${r.id}:${st.name}:${t}`;}});return;}
    const r=editRebuy(),st=r.stages[i];
    if(st.done)Object.assign(st,{done:false,shares:null,execPrice:null}); // 옛 통째 기록
    else if(Array.isArray(st.buys)){st.buys[t]=null;while(st.buys.length&&!st.buys.at(-1))st.buys.pop();if(!st.buys.length)delete st.buys;}
    if(!r.stages.some(stageTouched))delete r.planned;
    save();rebuyLink("uncheck",`rebuy:${r.id}:${st.name}:${t}`);renderRebuy();});
  // 회차 체결 수량·가격: 옛 통째 기록은 단계의 shares·execPrice, 새 기록은 buys[t]의 shares·price
  const fillOf=(key,el)=>{const [i,t]=el.dataset[key].split(":").map(Number),st=editRebuy().stages[i];return !st?null:st.done?[st,"execPrice"]:st.buys?.[t]?[st.buys[t],"price"]:null;};
  onEdit("[data-stage-price]",(v,el)=>{v=nonNeg(v.trim());if(v===undefined)return false;editRebuy().stages[Number(el.dataset.stagePrice)].price=v;},renderRebuy);
  const fillKey=(key,el)=>{const [i,t]=el.dataset[key].split(":").map(Number),x=editRebuy();return `rebuy:${x.id}:${x.stages[i]?.name}:${t}`;};
  onEdit("[data-tranche-exec]",(v,el)=>{v=Number(v);const rec=fillOf("trancheExec",el);if(!rec||!(v>0))return false;rec[0][rec[1]]=v;rebuyLink("rescale",fillKey("trancheExec",el),rebuyFill(rebuyPick(),rec[0],1));},renderRebuy);
  onEdit("[data-tranche-qty]",(v,el)=>{v=v.trim();const rec=fillOf("trancheQty",el);if(!rec||v===""||!(Number(v)>=0))return false;rec[0].shares=Math.floor(Number(v));rebuyLink("rescale",fillKey("trancheQty",el),rebuyFill(rebuyPick(),rec[0],1));},renderRebuy);
  $("rTimeframes").onclick=()=>{const r=editRebuy(),stages=completeMovingStages(r.stages);if(stages.length>80){alert("재매수 단계는 80개까지 설정할 수 있습니다.");return;}r.stages=stages;if(priceData)fillPrices({rebuy:r},priceData);save();renderRebuy();};
  $("rStages").onclick=()=>{const list=s.stages,text=prompt("재매수 단계를 짧은 봉부터 쉼표로 구분해 적으세요.\n60분봉은 '25선'(또는 '25시선'), 일봉은 '25일선', 주봉은 '25주선', 월봉은 '25개월선'(또는 '25월선')으로 적습니다.\n마지막 단계 가격은 기준 입력에서 넣습니다.",list.map(x=>x.name).join(", "));
    if(text==null)return;const names=[...new Set(text.split(/[,，]/).map(x=>stageName(x.trim().slice(0,20))).filter(Boolean))].slice(0,80);
    if(!names.length){alert("단계를 하나 이상 적어 주세요.");return;}
    const lost=list.filter(x=>stageTouched(x)&&!names.includes(x.name));if(lost.length){alert(`재매수를 체크한 단계(${lost.map(x=>x.name).join(", ")})는 뺄 수 없습니다. 먼저 체크를 푸세요.`);return;}
    const r=editRebuy();r.stages=names.map(name=>r.stages.find(x=>x.name===name)||{name,price:0,done:false,execPrice:null,shares:null});save();renderRebuy();};
  // 초기화: 자산 배분에 반영한 손절·재매수가 있으면 되돌릴지 한 번 더 묻는다(취소하면 자산 배분은 그대로 두고 반영 기록만 지움 — 새로 체크할 때 겹치지 않게).
  $("rReset").onclick=()=>{if(!confirm(`${title} 손절·재매수 체크 기록을 모두 지울까요?\n신저점·보유 금액(수량)·규칙·단계·메모는 남깁니다.`))return;const r=editRebuy();
    const keys=r.cuts.map((c,i)=>c&&`cut:${r.id}:${i}`).concat(r.stages.flatMap(x=>(Array.isArray(x.buys)?x.buys:[]).map((b,t)=>b&&`rebuy:${r.id}:${x.name}:${t}`))).filter(Boolean);
    r.cuts=[];r.stages.forEach(x=>{Object.assign(x,{done:false,shares:null,execPrice:null});delete x.buys;});delete r.planned;save();rebuyLink("forget",keys,`${title} 손절·재매수`);renderRebuy();};
  const note=$("rNote");note.oninput=()=>$("rNoteCount").textContent=memoCount(note.value);
  onEdit("#rNote",v=>{editRebuy().note=v;});
  $("rSave").onclick=()=>{if(note.value!==(r.note||""))editRebuy().note=note.value;save();renderRebuy();};
}
