// 시선(60분봉)·일선·주선·월선의 공통 이름과 가격 구간 계산. DOM·저장·주문 없이 서버에서도 사용한다.
const MA_PERIODS = [25,32,42,60,80,125,150];
const MA_UNITS = ["선","일선","주선","개월선"];
const MA_LINES = MA_UNITS.flatMap(unit=>MA_PERIODS.map(n=>`${n}${unit}`));
// 분할매수·재매수의 단계 편집 카드. 필드와 버튼은 호출부가 만들고 같은 배치·반응형 스타일을 쓴다.
function tradeStageEditorCard(title,fields,actions,className="",attrs=""){
  return `<div class="purchase-stage${className?` ${className}`:""}"${attrs?` ${attrs}`:""}><b>${title}</b>${fields}${actions}</div>`;
}
// 손절·재매수 회차의 공통 가로 카드. 판정·계산·입력 속성은 호출부에 두고 표시 틀만 공유한다.
function tradeStageRow(check,price,shares,status,rowClass="",statusClass=""){
  return `<div class="sale-row${rowClass?` ${rowClass}`:""}">${check}<div class="stage-price">${price}</div><div class="shares">${shares}</div><div class="status${statusClass?` ${statusClass}`:""}">${status}</div></div>`;
}
// 분할매도·분할매수·재매수 제목 아래의 공통 시세 줄: 현재가(크게) → 상태 → 회차 → 방향 있는 %(gap = {label, text, dir:"up"|"down"|""}).
// 값과 문구는 호출부가 이스케이프해 만들고, 여기서는 순서와 모양만 맞춘다. 빈 값은 건너뛴다.
function tradeQuoteLine({now="",state="",round="",gap=null}={}){
  const parts=[now&&`<strong class="quote-now">${now}</strong>`,state&&`<span class="quote-state">${state}</span>`,round&&`<span class="quote-round">${round}</span>`,
    gap&&`<span class="quote-gap${gap.dir?` ${gap.dir}`:""}">${gap.label} <b>${gap.text}</b></span>`].filter(Boolean);
  return parts.length?`<p class="quote-line">${parts.join("")}</p>`:"";
}
function movingLineName(name){
  const m=/^\s*([1-9]\d{0,2})\s*(선|시선|분봉|일선|주선|개월선|월선|달선)\s*$/.exec(String(name??""));
  if(!m||Number(m[1])>400)return "";
  const unit={시선:"선",분봉:"선",월선:"개월선",달선:"개월선"}[m[2]]||m[2];
  return `${Number(m[1])}${unit}`;
}
const movingLineUnit = name => movingLineName(name).replace(/^\d+/,"");
// 화면 글자 전용: 기록·시세·알림 규칙 이름의 'N개월선'을 'N월선'으로 보인다(문장 안 여러 개도). 저장·계산·규칙 이름은 그대로 'N개월선'.
// 입력의 '월선'·'달선'은 movingLineName이 'N개월선'으로 저장한다. 알림 서비스 워커는 stock-names.js에 같은 규칙을 둔다.
const movingLineText = text => String(text??"").replace(/(\d)\s*개월선/g,"$1월선");
// 분할매수·재매수 공통 범위: 시작·마지막 선을 포함하고 시·일·주·월 순으로 그 사이의 선택 단계만 남긴다.
// 없는 경계선은 포함하되 앞서는 종료선은 거절한다. 입력 목록의 순서는 유지하고 조회 때 저장하지 않는다.
function movingLineRange(names,start,last=null){
  const line=movingLineName(start),unit=movingLineUnit(line),at=MA_UNITS.indexOf(unit);
  if(!line||!names.some(n=>movingLineUnit(n)===unit))return [];
  const after=names.filter(n=>MA_UNITS.indexOf(movingLineUnit(n))>at||movingLineUnit(n)===unit&&parseInt(n)>parseInt(line));
  if(last===null)return [line,...after];
  const end=movingLineName(last),endUnit=movingLineUnit(end),endAt=MA_UNITS.indexOf(endUnit);
  if(!end||endAt<at||endAt===at&&parseInt(end)<parseInt(line))return [];
  if(end===line)return [line];
  return [line,...after.filter(n=>MA_UNITS.indexOf(movingLineUnit(n))<endAt||movingLineUnit(n)===endUnit&&parseInt(n)<parseInt(end)),end];
}
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
  // 이동평균 종료 계획은 검증 후 배분한 가격(직접 수정 예외 포함)을 그대로 사용한다.
  if(f?.buyPlan?.endLine)return;
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

// 이동평균 종료 계획에서 보존할 직접 수정가. 0으로 비운 값도 자동 가격으로 되돌리지 않고 검증한다.
function futureFixedBuyPrice(level,tranche){return tranche.priceOverride!=null?Number(tranche.priceOverride):!futureLineName(level)&&!level.planEnd?Number(tranche.price):null;}

// 자동 분할매수: 시작선 가격 이상·종료가격 미만의 시·일·주·월선 0·⅓·⅔ 회차를 가격순으로 모으고 종료가를 한 번 붙인다.
// 소수 넷째 자리 표시가 같은 가격은 시작선을 우선해 합치며 종료가와 겹치면 종료가만 둔다.
// 총 계약 수에는 이 계획의 완료 계약을 포함한다(별도로 입력한 보유 월물은 제외). 다 산 회차도 순서에 남겨 간격을 잡는다:
// 첫·끝을 포함해 회차 순서상 고르게 고른 회차 중 아직 안 끝난 회차가 남은 계약 수 이하인 가장 많은 회차 수를 쓰고(1계약이면 끝 회차),
// 고른 안 끝난 회차의 완료 계약까지 합친 수를 같은 수량씩(나머지는 앞 회차부터 1계약) 나눈 뒤 완료 계약을 뺀다(같은 회차의 미체결 계약은 계속 배분).
// 그래서 회차를 체결해도 시세가 같으면 남은 회차의 가격·계약 수가 바뀌지 않는다. 완료 계약이 그 회차 몫보다 많으면 앞 회차부터 줄인다.
// 시작선 시세가 없거나 종료가보다 높아지면 미매수 회차를 만들지 않는다. 읽기·미리보기는 저장 기록을 바꾸지 않는다.
// endLine을 선택한 계획만 종료가<=시작가·시세 없음·직접 수정가의 범위 이탈을 오류로 막고 기존 회차를 보존한다.
// 직접 수정한 미매수 계약은 남은 수량에서 먼저 확보하며, 완료된 회차와 같은 가격의 새 회차는 만들지 않는다.
function futureAutoBuyPlan(f, input=f?.buyPlan){
  const startLine=movingLineName(input?.startLine),endPrice=Number(input?.endPrice),contracts=Number(input?.contracts);
  const endLine=input?.endLine?movingLineName(input.endLine):"";
  const units=MA_UNITS.filter(unit=>Array.isArray(input?.units)&&input.units.includes(unit));
  const levels=Array.isArray(f?.levels)?f.levels:[],startIndex=levels.findIndex(l=>futureLineName(l)===startLine),startPrice=Number(levels[startIndex]?.price)||0;
  if(input?.endLine&&(!endLine||!Number.isFinite(endPrice)||endPrice<=0))return {error:"종료 이동평균선의 기간(1~400)과 시세를 확인하세요. 기존 수집 데이터에 시세가 없으면 배분하지 않습니다.",startPrice,rows:[]};
  if(!startLine||!Number.isFinite(endPrice)||endPrice<=0||!Number.isInteger(contracts)||contracts<1||contracts>100||!units.length)
    return {error:"시작선, 종료가격, 총 계약 수(1~100), 사용할 시간축을 확인하세요.",rows:[]};
  if(!units.includes(movingLineUnit(startLine)))units.push(movingLineUnit(startLine));
  const config={...input,startLine,endPrice,contracts,units:MA_UNITS.filter(unit=>units.includes(unit))};
  if(endLine)config.endLine=endLine;else{delete config.endLine;delete config.manualEndPrice;}
  const completed=levels.reduce((n,l)=>n+(l.tranches||[]).filter(t=>t.completed).length,0),remaining=contracts-completed;
  if(remaining<0)return {error:`이미 매수한 ${completed}계약보다 총 계약 수를 줄일 수 없습니다.`,rows:[]};
  const result={config,startPrice,completed,remaining,rows:[],available:0};
  if(endLine&&startPrice>0&&endPrice<=startPrice)return {...result,error:"종료 이동평균선 가격은 시작 기준가보다 높아야 합니다. 기존 계획을 유지하며 추가 매수를 중지합니다."};
  if(!remaining)return result;
  if(endLine&&!(startPrice>0))return {...result,error:"시작 기준선의 시세가 없어 추가 매수를 중지합니다. 기존 계획은 유지합니다."};
  if(!(startPrice>0))return {...result,waiting:"시작 기준선의 시세를 기다립니다."};
  if(startPrice>endPrice)return {...result,waiting:"시작 기준가가 종료가격보다 높아 추가 매수를 기다립니다."};
  const roundKey=(l,slot)=>l.planEnd?"end":`${futureLineName(l)}:${slot}`;
  const filled=new Set(),pending=new Set(),filledPrices=new Set(),fixed=[],bought=new Map();
  levels.forEach((l,li)=>(l.tranches||[]).forEach((t,i)=>{
    const slot=futureTrancheSlot(l,t,i),key=roundKey(l,slot);(t.completed?filled:pending).add(key);
    if(t.completed){filledPrices.add(Math.round(Number(t.price)*1e4));bought.set(key,(bought.get(key)||0)+1);}
    else if(endLine&&futureFixedBuyPrice(l,t)!==null)fixed.push({li,line:futureLineName(l)||l.label,slot,price:futureFixedBuyPrice(l,t),key,contracts:1,fixed:true});
  }));
  if(fixed.length>remaining)return {...result,error:"직접 수정한 미매수 계약 수보다 총 계약 수를 줄일 수 없습니다. 직접 수정값을 먼저 확인하세요."};
  if(fixed.some(r=>!Number.isFinite(r.price)||r.price<startPrice||r.price>endPrice))return {...result,error:"직접 수정한 매수가가 시작·종료 범위를 벗어납니다. 직접 수정값을 확인하세요. 기존 계획은 유지합니다."};
  const finished=key=>filled.has(key)&&!pending.has(key);
  const candidates=[];
  levels.forEach((l,li)=>{
    const name=futureLineName(l),unit=movingLineUnit(name),price=Number(l.price);
    if(!name||!config.units.includes(unit)||price<startPrice||price>=endPrice)return;
    futureBuyPrices(levels,li).forEach((p,slot)=>{
      const price=Number(p),key=roundKey(l,slot),done=finished(key);
      if(price>=startPrice&&price<endPrice&&Math.round(price*1e4)!==Math.round(endPrice*1e4)&&(done||!(endLine&&filledPrices.has(Math.round(price*1e4))&&!pending.has(key))))candidates.push({li,line:name,slot,price,key,done});
    });
  });
  // 같은 가격이면 다 산 회차를 남겨 그 가격에 새 계약을 두지 않는다.
  candidates.sort((a,b)=>a.price-b.price||Number(b.done)-Number(a.done)||Number(b.line===startLine)-Number(a.line===startLine)||a.li-b.li||a.slot-b.slot);
  if(finished("end")||!(endLine&&filledPrices.has(Math.round(endPrice*1e4))&&!pending.has("end")))candidates.push({li:levels.findIndex(l=>l.planEnd),line:"종료가",slot:0,price:endPrice,key:"end",done:finished("end")});
  const seen=new Set(),unique=candidates.filter(row=>{const price=Math.round(row.price*1e4);if(seen.has(price))return false;seen.add(price);return true;});
  const toAllocate=remaining-fixed.length;result.available=unique.filter(r=>!r.done).length;
  const spread=(list,count)=>Array.from({length:count},(_,i)=>list[count===1?list.length-1:Math.round(i*(list.length-1)/(count-1))]);
  let picked=[];
  for(let count=unique.length;count>0&&toAllocate>0;count--){
    const open=spread(unique,count).filter(r=>!r.done);
    if(open.length&&open.length<=toAllocate){picked=open;break;}
  }
  // 고른 회차가 모두 다 산 회차뿐이면 안 끝난 회차끼리 고르게 고른다.
  if(!picked.length&&toAllocate>0){const open=unique.filter(r=>!r.done);picked=open.length?spread(open,Math.min(toAllocate,open.length)):[];}
  const total=toAllocate+picked.reduce((n,r)=>n+(bought.get(r.key)||0),0);
  const rows=picked.map(({done,...r},i)=>({...r,contracts:Math.max(0,Math.floor(total/picked.length)+(i<total%picked.length?1:0)-(bought.get(r.key)||0))}));
  let over=rows.reduce((n,r)=>n+r.contracts,0)-toAllocate;
  for(const r of rows){if(over<=0)break;const cut=Math.min(r.contracts,over);r.contracts-=cut;over-=cut;}
  result.rows=rows.filter(r=>r.contracts>0);
  result.rows.push(...fixed);
  if(toAllocate&&!result.rows.some(r=>!r.fixed))result.waiting="남은 계약을 배분할 새 기준선을 기다립니다.";
  return result;
}

// 자동 설정을 저장하거나 새 시세를 반영할 때만 호출한다. levels 순서·완료 계약·편입 월물·개별 알림은 유지한다.
// 미매수 계약은 같은 선·회차의 기록을 먼저 재사용한다. 직접 종료 계획의 가격 예외는 기존대로 자동 가격으로 돌린다.
// 이동평균 종료 계획은 직접 가격 예외를 보존하고 회차 이동 때도 월물·알림을 재사용한다. 오류·대기 중에는 기존 회차를 유지한다.
// buyPlan 없는 옛 기록은 그대로 두며, 실패하면 어떤 필드도 바꾸지 않는다.
function applyFutureAutoBuyPlan(f, input=f?.buyPlan){
  if(!input)return false;
  const plan=futureAutoBuyPlan(f,input);if(plan.error)return false;
  if(plan.config.endLine&&plan.waiting)return false;
  const levels=JSON.parse(JSON.stringify(f.levels)),byLevel=new Map();
  if(!levels.some(l=>futureLineName(l)===plan.config.startLine))levels.push({days:parseInt(plan.config.startLine),unit:movingLineUnit(plan.config.startLine),price:0,confirmed:false,contracts:0,tranches:[]});
  if(levels.length>80)return false;
  let endIndex=levels.findIndex(l=>l.planEnd);
  if(endIndex<0){if(levels.length>=80)return false;endIndex=levels.length;levels.push({days:0,unit:"",label:"종료가",planEnd:true,price:plan.config.endPrice,confirmed:true,contracts:0,tranches:[]});}
  levels[endIndex].price=plan.config.endPrice;
  for(const row of plan.rows){if(row.fixed)continue;const li=row.key==="end"?endIndex:row.li;if(!byLevel.has(li))byLevel.set(li,[]);byLevel.get(li).push(row);}
  if(plan.config.endLine){
    const pool=levels.flatMap((l,li)=>(l.tranches||[]).map((t,i)=>({t,li,slot:futureTrancheSlot(l,t,i)}))).filter(x=>!x.t.completed&&futureFixedBuyPrice(levels[x.li],x.t)===null);
    const allocated=new Map();
    // 모든 행의 같은 회차를 먼저 확보해 뒤 회차의 설정까지 앞에서 사용하지 않는다.
    for(const [li,rows] of byLevel)for(const row of rows)for(let n=0;n<row.contracts;n++){
      const at=pool.findIndex(x=>x.li===li&&x.slot===row.slot),record=at<0?null:pool.splice(at,1)[0];
      if(!allocated.has(li))allocated.set(li,[]);allocated.get(li).push({row,record});
    }
    for(const [li,items] of allocated)for(const item of items){
      if(!item.record){const at=pool.findIndex(x=>x.li===li);item.record=pool.splice(at<0?0:at,1)[0]||{t:{completed:false,executionPrice:null},li};}
      const {t,li:oldLi}=item.record;
      if(oldLi!==li&&t.notify===undefined){
        const enabled=l=>typeof l.notify==="boolean"?l.notify:f.notify?.levels===true;
        if(enabled(levels[oldLi])!==enabled(levels[li]))t.notify=enabled(levels[oldLi]);
      }
      t.slot=item.row.slot;t.price=item.row.price;
    }
    levels.forEach((l,li)=>{l.tranches=[...(l.tranches||[]).filter(t=>t.completed||futureFixedBuyPrice(l,t)!==null),...(allocated.get(li)||[]).map(x=>x.record.t)];l.contracts=l.tranches.length;});
  }else{
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
  }
  if(JSON.stringify(f.buyPlan)===JSON.stringify(plan.config)&&JSON.stringify(f.levels)===JSON.stringify(levels))return false;
  f.buyPlan=plan.config;f.levels=levels;return true;
}
