// 기존 매매 기준의 알림 ON/OFF·규칙 계산. 기준가·배분은 prices.js·rebuy.js, 분할매수 규칙은 assets-calc.js와 연결된다.
// 추가 기준선 설정은 alerts.js, 수신·종목 이동은 push.js.
// 읽을 때 notify를 만들지 않는다. 아래 수정 함수는 알림 버튼을 누를 때만 호출한다.
const tradeNotify = obj => obj?.notify&&typeof obj.notify==="object"&&!Array.isArray(obj.notify)?obj.notify:{};
function tradePlanEnabled(p,i){const n=tradeNotify(p);return i===0?n.start===true:typeof n.saleOverrides?.[i]==="boolean"?n.saleOverrides[i]:n.sales===true;}
function tradeLevelEnabled(f,l){return typeof l?.notify==="boolean"?l.notify:tradeNotify(f).levels===true;}
function tradeFutureTrancheEnabled(f,l,t){return typeof t?.notify==="boolean"?t.notify:tradeLevelEnabled(f,l);}
function tradeRebuyEnabled(r,kind,i){
  const n=tradeNotify(r);
  if(kind==="buys"){const s=stagesOf(r)[i];return typeof s?.notify==="boolean"?s.notify:n.buys===true;}
  return i==null?n[kind]===true:typeof n[kind+"Overrides"]?.[i]==="boolean"?n[kind+"Overrides"][i]:n[kind]===true;
}
function editTradeNotify(obj){if(obj.notify!==tradeNotify(obj))obj.notify={};return obj.notify;}
// plans[].notify: 첫 매도 start, 나머지 전체 sales, 회차별 saleOverrides. 전체 설정은 개별 예외를 지운다.
function setTradePlanAlert(p,i,on){const n=editTradeNotify(p);if(i===0)n.start=on;else(n.saleOverrides??={})[i]=on;}
function setTradePlanAll(p,on){Object.assign(editTradeNotify(p),{start:on,sales:on});delete p.notify.saleOverrides;}
// futures.notify.levels는 전체, levels[].notify는 기준선, tranches[].notify는 회차별 선택(우선 적용).
// 전체 설정은 기준선·회차별 예외를 지운다. 입력하기 전에는 필드를 만들지 않는다.
function setTradeFutureTrancheAlert(l,i,on){const t=l?.tranches?.[i];if(t)t.notify=on;}
function setTradeLevelAll(f,on){editTradeNotify(f).levels=on;f.levels.forEach(l=>{delete l.notify;(l.tranches||[]).forEach(t=>delete t.notify);});}
// rebuy.items[].notify: 이탈 breakdown·손절 cuts·재매수 buys와 손절 cutsOverrides.
// stages[].notify 하나는 그 단계의 1·2·3차 모두에 적용한다. 옛 deadlines는 읽지 않는다.
function setTradeRebuyAlert(r,kind,i,on){
  if(kind==="buys"){const s=Array.isArray(r.stages)?r.stages[i]:null;if(s)s.notify=on;return;} // 저장된 단계에(stagesOf는 옛 이름이면 사본) — r은 editRebuy()로 이름을 바꾼 기록
  const n=editTradeNotify(r);if(i==null)n[kind]=on;else(n[kind+"Overrides"]??={})[i]=on;
}
function setTradeRebuyAll(r,kind,on){
  editTradeNotify(r)[kind]=on;delete r.notify[kind+"Overrides"];
  if(kind==="buys"&&Array.isArray(r.stages))r.stages.forEach(s=>delete s.notify);
}
// lead: 가격 칸 옆이 아닌 곳(카드 제목 줄 등)에 둘 때 글자 앞에 붙일 이름(예: "신저점 이탈" → "신저점 이탈 알림 OFF")
// showState=false면 ON/OFF 글자 없이 체크박스 자체로 켜짐·꺼짐을 나타낸다.
function tradeAlertToggle(on,attrs,name,done=false,lead="",showState=true){
  return `<label class="trade-alert-toggle${done?" completed":""}" title="${esc(name)} 알림"><input type="checkbox" ${attrs} ${on&&!done?"checked":""} ${done?"disabled":""} aria-label="${esc(name)} 알림"><span>${lead?`${esc(lead)} `:""}${done?"완료":`알림${showState?` ${on?"ON":"OFF"}`:""}`}</span></label>`;
}
function tradeAlertAllButtons(attrs){return `<span class="trade-alert-actions"><span>알림</span><button class="btn mini ghost" type="button" ${attrs}="on">전체 ON</button><button class="btn mini ghost" type="button" ${attrs}="off">OFF</button></span>`;}
function bindTradePlanAlerts(p){
  onEdit("[data-sale-alert]",(v,el)=>setTradePlanAlert(p,Number(el.dataset.saleAlert),el.checked),renderPlans);
  $$("[data-sale-alert-all]").forEach(b=>b.onclick=()=>{setTradePlanAll(p,b.dataset.saleAlertAll==="on");save();renderPlans();});
}
function bindTradeFuturesAlerts(f){
  onEdit("[data-tranche-alert]",(v,el)=>{const [li,ti]=el.dataset.trancheAlert.split(":").map(Number);setTradeFutureTrancheAlert(f.levels[li],ti,el.checked);},renderFutures);
  $$("[data-level-alert-all]").forEach(b=>b.onclick=()=>{setTradeLevelAll(f,b.dataset.levelAlertAll==="on");save();renderFutures();});
}
function bindTradeRebuyAlerts(){
  onEdit("[data-rebuy-alert]",(v,el)=>setTradeRebuyAlert(editRebuy(),el.dataset.rebuyAlert,el.dataset.alertIndex==null?null:Number(el.dataset.alertIndex),el.checked),renderRebuy);
  $$("[data-rebuy-alert-all]").forEach(b=>b.onclick=()=>{setTradeRebuyAll(editRebuy(),b.dataset.rebuyAlertAll,b.dataset.alertOn==="on");save();renderRebuy();});
}
function tradeRebuyAllButtons(kind){return `<span class="trade-alert-actions"><span>알림</span><button class="btn mini ghost" type="button" data-rebuy-alert-all="${kind}" data-alert-on="on">전체 ON</button><button class="btn mini ghost" type="button" data-rebuy-alert-all="${kind}" data-alert-on="off">OFF</button></span>`;}
// futures.rebuy.notify는 입력할 때만 저장한다. buysOverrides['stage:i']는 해당 단계의 1·2·3차 모두이며 옛 deadlines는 읽지 않는다.
function futureRebuyAlertEnabled(f,kind,key){const n=tradeNotify(futureRebuyOf(f));return key==null?n[kind]===true:typeof n[kind+"Overrides"]?.[key]==="boolean"?n[kind+"Overrides"][key]:n[kind]===true;}
function bindFutureRebuyAlerts(f){
  onEdit("[data-frebuy-alert]",(v,el)=>{const n=editTradeNotify(editFutureRebuy(f)),kind=el.dataset.frebuyAlert,key=el.dataset.alertKey;if(key==null)n[kind]=el.checked;else(n[kind+"Overrides"]??={})[key]=el.checked;},renderFutures);
  $$("[data-frebuy-alert-all]").forEach(b=>b.onclick=()=>{const n=editTradeNotify(editFutureRebuy(f)),kind=b.dataset.frebuyAlertAll;n[kind]=b.dataset.alertOn==="on";delete n[kind+"Overrides"];save();renderFutures();});
}
function futureRebuyAllButtons(kind){return `<span class="trade-alert-actions"><span>알림</span><button class="btn mini ghost" type="button" data-frebuy-alert-all="${kind}" data-alert-on="on">전체 ON</button><button class="btn mini ghost" type="button" data-frebuy-alert-all="${kind}" data-alert-on="off">OFF</button></span>`;}
// 기준가 변경은 같은 시세 채우기 규칙을 사용한다. 자동으로 채운 값은 fingerprint에 넣지 않는다.
function tradePriceBasis(obj,key,label,auto){
  const value=Number(obj[key]),mark=Number(obj.auto?.[key]);
  return auto&&maKey(label)?["line",maKey(label),value>0&&mark>0&&value!==mark?value:null]:["price",value];
}
// 재매수 단계의 알림 이름: N일선·N주선·N개월선, N선(60분봉, 옛 이름 N분봉도)은 그대로, 직접 정한 다른 이름은 'N단계'.
// 단계 안 회차는 1차가 단계 이름 그대로(예전 단계 알림과 같은 id·이력), 2·3차는 ' 2차'·' 3차'를 붙인다.
// 라벨 형식은 비공개 데이터 저장소 ma_alerts.py의 TRADE_LABEL_RE와 같아야 한다(buildTradeAlertRules 참조).
const tradeStageName = (name,i) => autoKey(name)||`${i+1}단계`;
// 회차 알림 기준: 단계 기준가(시세로 채운 이평선은 이름, 직접 고친 값만) + 2·3차는 회차와 다음 단계 기준. 이평선만 움직이면 같은 알림 이력.
function tradeStageBasis(r,x){const mark=Number(r.auto?.[autoMark(x.name)]);return autoKey(x.name)?[x.name,Number(x.price)>0&&mark>0&&Number(x.price)!==mark?Number(x.price):null]:[x.name,Number(x.price)];}
const tradeTrancheBasis = (r,s,x,next=s.stages[s.nextStages?.[x.i]??x.i+1]) => x.t?[...tradeStageBasis(r,s.stages[x.i]),x.t,...(next?tradeStageBasis(r,next):[])]:tradeStageBasis(r,s.stages[x.i]);
// ETF 직접 회차 가격·하락 도달 조건은 알림 이력에도 반영한다. 옛 자동 반등 기준의 이력은 유지한다.
function tradeEtfTrancheBasis(r,s,x){
  const basis=tradeTrancheBasis(r,s,x,s.stages[etfNextStage(s.stages,x.i)]),st=s.stages[x.i];
  return st.buyCondition||x.manual?[...basis,etfRebuyCondition(st),x.manual?x.price:null]:basis;
}
// 알림을 보낼 회차: 안 샀고 배분이 있고 가격이 실제 기준가에서 나온 것(추정치 제외).
const tradeTranchesToSend = s => s.tranches.filter(x=>!x.done&&x.amount>0&&x.price>0&&!x.est);
// 비공개 수집 작업도 이 함수와 prices.js·rebuy.js를 실행해 화면과 같은 기준가·배분을 사용한다. 원본 기록은 바꾸지 않는다.
// 완료 회차·단계와 배분 없는 회차는 제외한다. 시세·기준가가 있어야 발송되며 표시용 추정가는 쓰지 않는다.
// quiet=true(수집 작업만)면 알림을 끈 미완료 매매 회차도 notify:false 규칙으로 더한다. 수집 작업은 그 회차에 도달 알림 없이 미체결 재알림만 보낸다.
// 신저점 이탈·계약 수 없는 옛 기준선처럼 체결로 끝나지 않는 알림은 켤 때만 넣는다. 화면의 알림 개수는 quiet 없이 센다.
// 수집 작업 ma_alerts.py _rule은 quoteGroup·quoteKind·label을 재검증하고 하나라도 거부하면 연결 알림 전체를 보내지 않는다.
// 새 시세 kind·알림 라벨을 만들면 데이터 저장소의 검증과 TRADE_LABEL_RE도 함께 고친다.
function buildTradeAlertRules(data,priceDoc,quiet=false){
  const d=JSON.parse(JSON.stringify(data||{})),prices=priceDoc?(priceDoc.format===PRICE_FORMAT?priceDoc:slimPrices(priceDoc)):null;
  if(prices)fillPrices(d,prices);
  const rules=[],add=(key,ticker,label,price,condition,basis,group="stocks",kind="국내",on=true)=>{
    price=Number(price);if(!on&&!quiet||!Number.isFinite(price)||price<=0||!ticker)return;
    rules.push({id:key,kind:"trade",ticker:String(ticker).trim().toUpperCase(),label,targetPrice:price,condition,quoteGroup:group,quoteKey:String(ticker).trim().toUpperCase(),quoteKind:kind,enabled:true,revision:JSON.stringify(basis),...(on?{}:{notify:false})});
  };
  for(const p of Array.isArray(d.plans)?d.plans:[]){
    if(!p?.id||!Number.isInteger(Number(p.stages))||p.stages<2||p.stages>250)continue;
    const count=Number(p.stages),ticker=planTicker(p.ticker),kind=planQuoteKind(ticker,p.currency),q=stockEntry(prices,ticker);
    if(q&&q.kind!==kind)continue;
    const basis=[count,tradePriceBasis(p,"startPrice",p.startLabel,p.startAuto===true),tradePriceBasis(p,"endPrice",p.endLabel,true)];
    for(let i=0;i<count;i++)if(p.checked?.[i]!==true){
      const price=Number(p.fills?.[i]?.price)>0?Number(p.fills[i].price):Number(p.startPrice)>0&&Number(p.endPrice)>0?Number(p.startPrice)-(Number(p.startPrice)-Number(p.endPrice))*i/Math.max(count-1,1):null;
      add(`trade:plan:${p.id}:${i}`,ticker,i===0?"분할매도 첫 매도":"분할매도 "+(i+1)+"회",price,Number(p.endPrice)>Number(p.startPrice)?"up":"down",basis,"stocks",kind,tradePlanEnabled(p,i));
    }
  }
  const f=d.futures,month=priceMonth(f,prices);
  const maEndPlan=f?.buyPlan?.endLine?futureAutoBuyPlan(f):null;
  if(f&&month)for(const [i,l] of (Array.isArray(f.levels)?f.levels:[]).entries()){
    if(maEndPlan?.error||maEndPlan?.waiting)continue;
    const tr=Array.isArray(l.tranches)?l.tranches:[],done=Number(l.contracts)>0&&tr.length>=Number(l.contracts)&&tr.every(t=>t.completed===true);
    if(done||f.buyPlan&&!(Number(l.contracts)>0))continue;
    // 종료가 회차도 기존 추가매수 라벨을 유지해 수집 작업의 알림 검증과 호환한다.
    const line=futureLineName(l),name=line||`추가 ${i+1}`,next=nextFutureLine(f.levels,i),direction=line||l.planEnd?"up":"down";
    // 이동평균 종료 계획의 실제 배분가·직접 수정가를 사용한다. 같은 회차·가격의 여러 계약은 한 번만 알린다(켠 계약이 하나라도 있으면 켠 규칙으로).
    if(maEndPlan){
      const seen=new Set(),each=on=>tr.forEach((t,ti)=>{
        if(t.completed||tradeFutureTrancheEnabled(f,l,t)!==on)return;
        const slot=futureTrancheSlot(l,t,ti),price=Number(t.price),key=`${slot}:${price}`;
        if(seen.has(key))return;seen.add(key);
        const manual=futureFixedBuyPrice(l,t);
        add(`trade:future:${i}${slot?`:${slot+1}`:""}${manual?`:manual:${manual}`:""}`,month,`달러선물 ${name}${line&&slot?` ${slot+1}차`:""}`,price,"up",["up",name,slot,f.buyPlan.startLine,f.buyPlan.endLine,manual],"futures","달러선물",on);
      });
      each(true);if(quiet)each(false);
      continue;
    }
    const basisOf=level=>{const name=futureLineName(level),mark=Number(f.auto?.[name]);return name?[name,Number(level.price)>0&&(!(mark>0)||Number(level.price)!==mark)?Number(level.price):null]:[Number(level.price)];};
    const prices=line?futureBuyPrices(f.levels,i):[Number(l.price)];
    for(const [t,price] of prices.entries()){
      // 같은 가격 회차에 여러 계약이 있으면 알림을 켠 미완료 계약이 하나라도 있을 때 기존 회차 id로 한 번 알린다(모두 껐으면 quiet 규칙).
      // 계약 수가 없는 기준선의 옛 알림 설정은 그대로 유지한다.
      const open=tr.filter((x,ti)=>!x.completed&&(prices.length===1||futureTrancheSlot(l,x,ti)===t));
      const on=Number(l.contracts)>0?open.some(x=>tradeFutureTrancheEnabled(f,l,x)):tradeLevelEnabled(f,l);
      if(!on&&!(Number(l.contracts)>0&&open.length))continue;
      const basis=[direction,...basisOf(l),...(t?[t,...basisOf(next.level)]:[])];
      add(`trade:future:${i}${t?`:${t+1}`:""}`,month,`달러선물 ${name}${t?` ${t+1}차`:""}`,price,direction,basis,"futures","달러선물",on);
    }
  }
  if(f?.rebuy&&month){
    const r=futureRebuyOf(f),s=futureRebuySummary(f),addF=(key,label,price,condition,basis,on=true)=>add(`trade:future-rebuy:${key}`,month,label,price,condition,basis,"futures","달러선물",on);
    // 손절 회차 기준: 신저점·하단·회차 수·회차. 하단선(floorLine)은 선 이름이라 시세로 하단만 움직이면 같은 알림 이력이다.
    if(s.ready){
      if(!s.started&&futureRebuyAlertEnabled(f,"breakdown"))addF("breakdown","달러선물 신저점 손절 시작",r.lowPrice,"down",[r.lowPrice]);
      for(const c of s.cuts)if(futureCutRest(c)>0)addF(`cut:${c.k-1}`,`달러선물 손절 ${c.k}회`,c.price,"down",[r.lowPrice,maKey(r.floorLine)||r.floorPrice,s.cuts.length,c.k],futureRebuyAlertEnabled(f,"cuts",c.k-1));
    }
    for(const x of tradeTranchesToSend(s)){
      const stage=s.stages[x.i],basis=tradeTrancheBasis(r,s,x),condition=futureRebuyCondition(x);
      addF(`buy:stage:${x.i}${x.t?`:${x.t+1}`:""}`,`달러선물 재매수 ${stage.rebuyEnd?"종료가격":tradeStageName(stage.name,stage.directRebuy?stage.directRound-1:x.i)}${x.t?` ${x.t+1}차`:""}`,x.price,condition,s.direct?[...basis,condition]:basis,futureRebuyAlertEnabled(f,"buys",`stage:${x.i}`));
    }
  }
  for(const [ri,r] of rebuyItems(d).entries()){
    const ticker=String(r.ticker||"").trim().toUpperCase(),q=stockEntry(prices,ticker),kind=usTicker(ticker)?"해외":"국내"; // 미국 종목은 달러 시세로
    if(!ticker||q&&q.kind!==kind)continue;
    const key=String(r.id||`legacy-${ri}`),s=rebuySummary(r),ready=Number(r.lowPrice)>0&&holdShares(r)>0;
    const addR=(suffix,label,price,condition,basis,on=true)=>add(`trade:rebuy:${key}:${suffix}`,ticker,label,price,condition,basis,"stocks",kind,on);
    // 신저점 이탈은 재매수 전까지만, 남은 손절 회차는 재매수를 시작한 뒤에도(재이탈) 알린다.
    if(ready){
      if(!s.started&&tradeRebuyEnabled(r,"breakdown"))addR("breakdown","재매수 신저점 이탈",r.lowPrice,"below",[Number(r.lowPrice)]);
      for(const c of s.cuts)if(!c.done&&c.qty>0)addR(`cut:${c.k-1}`,`재매수 손절 ${c.k}회`,c.price,"down",[Number(r.lowPrice),Number(r.stepPct)||1,c.k],tradeRebuyEnabled(r,"cuts",c.k-1));
    }
    // 비운 가격은 표시용 추정값이다. 알림 기준으로 사용하지 않는다(tradeTranchesToSend).
    for(const x of tradeTranchesToSend(s)){const name=s.stages[x.i].name;
      addR(`buy:${encodeURIComponent(name)}:${x.i}${x.t?`:${x.t+1}`:""}`,`재매수 ${tradeStageName(name,x.i)}${x.t?` ${x.t+1}차`:""}`,x.price,etfRebuyCondition(s.stages[x.i]),tradeEtfTrancheBasis(r,s,x),tradeRebuyEnabled(r,"buys",x.i));}
  }
  return rules;
}
function renderTradeAlertSummary(){
  const target=$("tradeAlertsSummary");if(!target)return;
  const plans=state.plans||[],f=state.futures,items=rebuyItems(state);
  const saleCount=plans.reduce((n,p)=>n+Array.from({length:Number(p.stages)||0},(_,i)=>p.checked?.[i]!==true&&tradePlanEnabled(p,i)?1:0).reduce((a,b)=>a+b,0),0);
  const fs=futureRebuySummary(f),futureCount=f?.rebuy?(!fs.started&&fs.ready&&futureRebuyAlertEnabled(f,"breakdown")?1:0)+(fs.ready?fs.cuts.filter(c=>futureCutRest(c)>0&&futureRebuyAlertEnabled(f,"cuts",c.k-1)).length:0)+tradeTranchesToSend(fs).filter(x=>futureRebuyAlertEnabled(f,"buys",`stage:${x.i}`)).length:0;
  const levelCount=buildTradeAlertRules({futures:{...f,rebuy:undefined}},priceData).length+futureCount;
  const rebuyCount=items.reduce((n,r)=>{const s=rebuySummary(r);return n+(!s.started&&tradeRebuyEnabled(r,"breakdown")?1:0)+s.cuts.filter(c=>!c.done&&c.qty>0&&tradeRebuyEnabled(r,"cuts",c.k-1)).length+tradeTranchesToSend(s).filter(x=>tradeRebuyEnabled(r,"buys",x.i)).length;},0);
  const buyCount=typeof purchasePlanner==="object"?purchasePlanner.alertCount():0; // 분할매수는 자산 기록(assets-calc.js purchaseAlertRules)
  target.innerHTML=`<div class="trade-alert-summary"><span>분할매도 <b>${saleCount}</b></span><span>분할매수 <b>${buyCount}</b></span><span>달러선물 <b>${levelCount}</b></span><span>재매수 <b>${rebuyCount}</b></span></div><p class="hint">각 화면의 가격 옆에서 알림을 켜세요. 기준가 변경은 자동 반영되며 완료한 회차·단계는 제외됩니다. 종목 코드와 시세·기준가가 있어야 발송됩니다.</p>`;
}
