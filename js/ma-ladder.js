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

// 자동 분할매수: 시작선 가격 이상·종료가격 미만의 시·일·주·월선 0·⅓·⅔ 회차를 가격순으로 모으고 종료가를 한 번 붙인다.
// 소수 넷째 자리 표시가 같은 가격은 시작선을 우선해 합치며 종료가와 겹치면 종료가만 둔다.
// 완료한 회차는 제외하되 같은 회차의 미체결 계약은 계속 배분한다.
// 총 계약 수에는 이 계획의 완료 계약을 포함한다(별도로 입력한 보유 월물은 제외). 남은 계약보다 회차가 많으면
// 첫·끝을 포함해 회차 순서상 고르게 고른다(1계약이면 끝 회차). 적으면 같은 수량씩, 나머지는 앞 회차부터 1계약씩 배분한다.
// 시작선 시세가 없거나 종료가보다 높아지면 미매수 회차를 만들지 않는다. 읽기·미리보기는 저장 기록을 바꾸지 않는다.
function futureAutoBuyPlan(f, input=f?.buyPlan){
  const startLine=movingLineName(input?.startLine),endPrice=Number(input?.endPrice),contracts=Number(input?.contracts);
  const units=MA_UNITS.filter(unit=>Array.isArray(input?.units)&&input.units.includes(unit));
  if(!startLine||!Number.isFinite(endPrice)||endPrice<=0||!Number.isInteger(contracts)||contracts<1||contracts>100||!units.length)
    return {error:"시작선, 종료가격, 총 계약 수(1~100), 사용할 시간축을 확인하세요.",rows:[]};
  if(!units.includes(movingLineUnit(startLine)))units.push(movingLineUnit(startLine));
  const config={startLine,endPrice,contracts,units:MA_UNITS.filter(unit=>units.includes(unit))};
  const levels=Array.isArray(f?.levels)?f.levels:[],startIndex=levels.findIndex(l=>futureLineName(l)===startLine);
  const startPrice=Number(levels[startIndex]?.price)||0;
  const completed=levels.reduce((n,l)=>n+(l.tranches||[]).filter(t=>t.completed).length,0),remaining=contracts-completed;
  if(remaining<0)return {error:`이미 매수한 ${completed}계약보다 총 계약 수를 줄일 수 없습니다.`,rows:[]};
  const result={config,startPrice,completed,remaining,rows:[],available:0};
  if(!remaining)return result;
  if(!(startPrice>0))return {...result,waiting:"시작 기준선의 시세를 기다립니다."};
  if(startPrice>endPrice)return {...result,waiting:"시작 기준가가 종료가격보다 높아 추가 매수를 기다립니다."};
  const roundKey=(l,slot)=>l.planEnd?"end":`${futureLineName(l)}:${slot}`;
  const filled=new Set(),pending=new Set();
  levels.forEach(l=>(l.tranches||[]).forEach((t,i)=>{const key=roundKey(l,futureTrancheSlot(l,t,i));(t.completed?filled:pending).add(key);}));
  const finished=key=>filled.has(key)&&!pending.has(key);
  const candidates=[];
  levels.forEach((l,li)=>{
    const name=futureLineName(l),unit=movingLineUnit(name),price=Number(l.price);
    if(!name||!config.units.includes(unit)||price<startPrice||price>=endPrice)return;
    futureBuyPrices(levels,li).forEach((p,slot)=>{
      const price=Number(p),key=roundKey(l,slot);
      if(price>=startPrice&&price<endPrice&&Math.round(price*1e4)!==Math.round(endPrice*1e4)&&!finished(key))candidates.push({li,line:name,slot,price,key});
    });
  });
  candidates.sort((a,b)=>a.price-b.price||Number(b.line===startLine)-Number(a.line===startLine)||a.li-b.li||a.slot-b.slot);
  if(!finished("end"))candidates.push({li:levels.findIndex(l=>l.planEnd),line:"종료가",slot:0,price:endPrice,key:"end"});
  const seen=new Set(),unique=candidates.filter(row=>{const price=Math.round(row.price*1e4);if(seen.has(price))return false;seen.add(price);return true;});
  const count=Math.min(remaining,unique.length);result.available=unique.length;
  result.rows=Array.from({length:count},(_,i)=>{
    const at=count===1?unique.length-1:Math.round(i*(unique.length-1)/(count-1));
    return {...unique[at],contracts:Math.floor(remaining/count)+(i<remaining%count?1:0)};
  });
  if(remaining&&!count)result.waiting="남은 계약을 배분할 새 기준선을 기다립니다.";
  return result;
}

// 자동 설정을 저장하거나 새 시세를 반영할 때만 호출한다. levels 순서·완료 계약·편입 월물·개별 알림은 유지한다.
// 미매수 계약은 같은 선·회차의 기록을 먼저 재사용하고, 직접 가격 예외는 자동 가격으로 돌린다.
// buyPlan 없는 옛 기록은 그대로 두며, 실패하면 어떤 필드도 바꾸지 않는다.
function applyFutureAutoBuyPlan(f, input=f?.buyPlan){
  if(!input)return false;
  const plan=futureAutoBuyPlan(f,input);if(plan.error)return false;
  const levels=JSON.parse(JSON.stringify(f.levels)),byLevel=new Map();
  if(!levels.some(l=>futureLineName(l)===plan.config.startLine))levels.push({days:parseInt(plan.config.startLine),unit:movingLineUnit(plan.config.startLine),price:0,confirmed:false,contracts:0,tranches:[]});
  if(levels.length>80)return false;
  let endIndex=levels.findIndex(l=>l.planEnd);
  if(endIndex<0){if(levels.length>=80)return false;endIndex=levels.length;levels.push({days:0,unit:"",label:"종료가",planEnd:true,price:plan.config.endPrice,confirmed:true,contracts:0,tranches:[]});}
  levels[endIndex].price=plan.config.endPrice;
  for(const row of plan.rows){const li=row.key==="end"?endIndex:row.li;if(!byLevel.has(li))byLevel.set(li,[]);byLevel.get(li).push(row);}
  levels.forEach((l,li)=>{
    const old=l.tranches||[],done=old.filter(t=>t.completed),open=[];
    old.forEach((t,i)=>{if(t.completed)t.slot=futureTrancheSlot(l,t,i);});
    const pools=new Map();old.forEach((t,i)=>{if(t.completed)return;const slot=futureTrancheSlot(l,t,i);if(!pools.has(slot))pools.set(slot,[]);pools.get(slot).push(t);});
    for(const row of byLevel.get(li)||[])for(let n=0;n<row.contracts;n++){
      const t=pools.get(row.slot)?.shift()||{completed:false,executionPrice:null};
      delete t.priceOverride;t.slot=row.slot;t.price=row.price;open.push(t);
    }
    l.tranches=[...done,...open];l.contracts=l.tranches.length;
  });
  if(JSON.stringify(f.buyPlan)===JSON.stringify(plan.config)&&JSON.stringify(f.levels)===JSON.stringify(levels))return false;
  f.buyPlan=plan.config;f.levels=levels;return true;
}
