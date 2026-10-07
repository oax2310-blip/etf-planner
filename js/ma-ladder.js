// 시선(60분봉)·일선·주선·월선의 공통 이름과 가격 구간 계산. DOM·저장·주문 없이 서버에서도 사용한다.
const MA_PERIODS = [25,32,42,60,80,125,150];
const MA_UNITS = ["선","일선","주선","개월선"];
const MA_LINES = MA_UNITS.flatMap(unit=>MA_PERIODS.map(n=>`${n}${unit}`));
function movingLineName(name){
  const m=/^\s*([1-9]\d{0,2})\s*(선|시선|분봉|일선|주선|개월선|월선|달선)\s*$/.exec(String(name??""));
  if(!m||Number(m[1])>400)return "";
  const unit={시선:"선",분봉:"선",월선:"개월선",달선:"개월선"}[m[2]]||m[2];
  return `${Number(m[1])}${unit}`;
}
const movingLineUnit = name => movingLineName(name).replace(/^\d+/,"");
function completeMovingStages(stages){
  const names=new Set(stages.map(x=>movingLineName(x.name)));
  return [...stages,...MA_LINES.filter(name=>!names.has(name)).map(name=>({name,price:0,done:false,execPrice:null,shares:null}))];
}
// 끝선은 이 구간의 3차가 아니라 다음 선의 도달 회차다. 0·⅓·⅔만 돌려준다.
// 가격이 없거나 진행 방향과 반대이면 중간 회차를 만들지 않는다.
function lineThirds(start,end,direction="up"){
  const p=Number(start),q=Number(end);
  if(!Number.isFinite(p)||p<=0)return [];
  if(!Number.isFinite(q)||q<=0||(direction==="down"?q>=p:q<=p))return [p];
  return [p,p+(q-p)/3,p+(q-p)*2/3];
}
function futureLineName(level){
  const named=movingLineName(level?.name||level?.label);
  if(named)return named;
  return movingLineName(`${level?.days||""}${level?.unit||"일선"}`);
}
function ensureFutureMovingLines(f){
  if(!Array.isArray(f.levels))f.levels=[];
  const names=new Set(f.levels.map(futureLineName));
  for(const name of MA_LINES)if(!names.has(name))f.levels.push({days:parseInt(name),unit:movingLineUnit(name),price:0,confirmed:false,contracts:0,tranches:[]});
}
// 같은 시간축의 다음 기간을 찾는다. 빈 기준선을 건너뛰어 추정 회차를 만들지 않는다.
function nextFutureLine(levels,index){
  const name=futureLineName(levels[index]),unit=movingLineUnit(name),period=parseInt(name);
  if(!name)return null;
  return levels.map((level,i)=>({level,i,name:futureLineName(level)}))
    .filter(x=>movingLineUnit(x.name)===unit&&parseInt(x.name)>period)
    .sort((a,b)=>parseInt(a.name)-parseInt(b.name))[0]||null;
}
function futureBuyPrices(levels,index){
  const level=levels[index],next=nextFutureLine(levels,index);
  return lineThirds(level?.price,next?.level.price);
}
// 계약 수는 늘리지 않는다. 세 가격에 가능한 한 고르게 배분하고 이미 체결한 계약은 보존한다.
function futureTrancheSlot(level,tranche,index){
  if(Number.isInteger(tranche?.slot)&&tranche.slot>=0&&tranche.slot<3)return tranche.slot;
  const n=Math.max(1,(level?.tranches||[]).length);
  return Math.min(2,Math.floor(index*3/n));
}
function rebalanceFutureTranches(level){
  if(!futureLineName(level))return;
  const tranches=level.tranches,counts=[0,0,0],bought=[0,0,0];
  tranches.forEach((t,i)=>{counts[Math.min(2,Math.floor(i*3/tranches.length))]++;if(t.completed)bought[futureTrancheSlot(level,t,i)]++;});
  const slots=counts.flatMap((n,slot)=>Array(Math.max(0,n-bought[slot])).fill(slot));
  tranches.filter(t=>!t.completed).forEach(t=>{t.slot=slots.shift()??0;});
}
function futureTranchePrice(levels,index,tranche,ti){
  if(tranche?.completed)return Number(tranche.executionPrice??tranche.price)||0;
  if(!futureLineName(levels[index]))return Number(tranche?.price)||0;
  if(Number(tranche?.priceOverride)>0)return Number(tranche.priceOverride);
  const prices=futureBuyPrices(levels,index);
  return prices[futureTrancheSlot(levels[index],tranche,ti)]??prices[0]??0;
}
function refreshFutureBuyPrices(f,changedNames=null){
  const levels=Array.isArray(f?.levels)?f.levels:[];
  levels.forEach((level,i)=>{
    const name=futureLineName(level),next=nextFutureLine(levels,i)?.name;
    if(changedNames&&!changedNames.includes(name)&&!changedNames.includes(next))return;
    (Array.isArray(level.tranches)?level.tranches:[]).forEach((tranche,ti)=>{
      if(!Number.isInteger(tranche.slot)||tranche.slot<0||tranche.slot>2)tranche.slot=futureTrancheSlot(level,tranche,ti);
      if(tranche.completed)return;
      if(changedNames)delete tranche.priceOverride;
      tranche.price=futureTranchePrice(levels,i,tranche,ti);
    });
  });
}
