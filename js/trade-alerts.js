// 기존 매매 기준에 연결된 알림. 읽을 때 notify 필드를 만들지 않고, 버튼을 누를 때만 저장한다.
// buildTradeAlertRules는 시세 수집 서버도 같은 파일과 prices.js·rebuy.js를 읽어 사용한다.
// 매매 계산을 바꾸면 연결 알림 테스트도 확인할 것. 완료·금액 없는 단계는 서버 판정에서 제외한다.
const tradeNotify = obj => obj?.notify&&typeof obj.notify==="object"&&!Array.isArray(obj.notify)?obj.notify:{};
function tradePlanEnabled(p,i){const n=tradeNotify(p);return i===0?n.start===true:typeof n.saleOverrides?.[i]==="boolean"?n.saleOverrides[i]:n.sales===true;}
function tradeLevelEnabled(f,l){return typeof l?.notify==="boolean"?l.notify:tradeNotify(f).levels===true;}
function tradeRebuyEnabled(r,kind,i){
  const n=tradeNotify(r);
  if(kind==="buys"){const s=stagesOf(r)[i];return typeof s?.notify==="boolean"?s.notify:n.buys===true;}
  return i==null?n[kind]===true:typeof n[kind+"Overrides"]?.[i]==="boolean"?n[kind+"Overrides"][i]:n[kind]===true;
}
function editTradeNotify(obj){if(obj.notify!==tradeNotify(obj))obj.notify={};return obj.notify;}
function setTradePlanAlert(p,i,on){const n=editTradeNotify(p);if(i===0)n.start=on;else(n.saleOverrides??={})[i]=on;}
function setTradePlanAll(p,on){Object.assign(editTradeNotify(p),{start:on,sales:on});delete p.notify.saleOverrides;}
function setTradeLevelAll(f,on){editTradeNotify(f).levels=on;f.levels.forEach(l=>delete l.notify);}
function setTradeRebuyAlert(r,kind,i,on){
  if(kind==="buys"){const s=Array.isArray(r.stages)?r.stages[i]:null;if(s)s.notify=on;return;} // 저장된 단계에(stagesOf는 옛 이름이면 사본) — r은 editRebuy()로 이름을 바꾼 기록
  const n=editTradeNotify(r);if(i==null)n[kind]=on;else(n[kind+"Overrides"]??={})[i]=on;
}
function setTradeRebuyAll(r,kind,on){
  editTradeNotify(r)[kind]=on;delete r.notify[kind+"Overrides"];
  if(kind==="buys"&&Array.isArray(r.stages))r.stages.forEach(s=>delete s.notify);
}
// lead: 가격 칸 옆이 아닌 곳(카드 제목 줄 등)에 둘 때 글자 앞에 붙일 이름(예: "신저점 이탈" → "신저점 이탈 알림 OFF")
function tradeAlertToggle(on,attrs,name,done=false,lead=""){
  return `<label class="trade-alert-toggle${done?" completed":""}" title="${esc(name)} 알림"><input type="checkbox" ${attrs} ${on&&!done?"checked":""} ${done?"disabled":""} aria-label="${esc(name)} 알림"><span>${lead?`${esc(lead)} `:""}${done?"완료":`알림 ${on?"ON":"OFF"}`}</span></label>`;
}
function tradeAlertAllButtons(attrs){return `<span class="trade-alert-actions"><span>알림</span><button class="btn mini ghost" type="button" ${attrs}="on">전체 ON</button><button class="btn mini ghost" type="button" ${attrs}="off">OFF</button></span>`;}
function bindTradePlanAlerts(p){
  onEdit("[data-sale-alert]",(v,el)=>setTradePlanAlert(p,Number(el.dataset.saleAlert),el.checked),renderPlans);
  $$("[data-sale-alert-all]").forEach(b=>b.onclick=()=>{setTradePlanAll(p,b.dataset.saleAlertAll==="on");save();renderPlans();});
}
function bindTradeFuturesAlerts(f){
  onEdit("[data-level-alert]",(v,el)=>{f.levels[Number(el.dataset.levelAlert)].notify=el.checked;},renderFutures);
  $$("[data-level-alert-all]").forEach(b=>b.onclick=()=>{setTradeLevelAll(f,b.dataset.levelAlertAll==="on");save();renderFutures();});
}
function bindTradeRebuyAlerts(){
  onEdit("[data-rebuy-alert]",(v,el)=>setTradeRebuyAlert(editRebuy(),el.dataset.rebuyAlert,el.dataset.alertIndex==null?null:Number(el.dataset.alertIndex),el.checked),renderRebuy);
  $$("[data-rebuy-alert-all]").forEach(b=>b.onclick=()=>{setTradeRebuyAll(editRebuy(),b.dataset.rebuyAlertAll,b.dataset.alertOn==="on");save();renderRebuy();});
}
function tradeRebuyAllButtons(kind){return `<span class="trade-alert-actions"><span>알림</span><button class="btn mini ghost" type="button" data-rebuy-alert-all="${kind}" data-alert-on="on">전체 ON</button><button class="btn mini ghost" type="button" data-rebuy-alert-all="${kind}" data-alert-on="off">OFF</button></span>`;}
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
// 수집 작업(데이터 저장소 ma_alerts.py TRADE_LABEL_RE)이 라벨을 다시 검증하고 하나라도 거부하면 연결 알림 전체를 보내지 않으므로 형식을 바꾸면 그쪽도 같이.
const tradeStageName = (name,i) => autoKey(name)||`${i+1}단계`;
// 회차 알림 기준: 단계 기준가(시세로 채운 이평선은 이름, 직접 고친 값만) + 2·3차는 회차와 다음 단계 기준. 이평선만 움직이면 같은 알림 이력.
function tradeStageBasis(r,x){const mark=Number(r.auto?.[autoMark(x.name)]);return autoKey(x.name)?[x.name,Number(x.price)>0&&mark>0&&Number(x.price)!==mark?Number(x.price):null]:[x.name,Number(x.price)];}
const tradeTrancheBasis = (r,s,x) => x.t?[...tradeStageBasis(r,s.stages[x.i]),x.t,...(s.stages[x.i+1]?tradeStageBasis(r,s.stages[x.i+1]):[])]:tradeStageBasis(r,s.stages[x.i]);
// 알림을 보낼 회차: 안 샀고 배분이 있고 가격이 실제 기준가에서 나온 것(추정치 제외).
const tradeTranchesToSend = s => s.tranches.filter(x=>!x.done&&x.amount>0&&x.price>0&&!x.est);
function buildTradeAlertRules(data,priceDoc){
  const d=JSON.parse(JSON.stringify(data||{})),prices=priceDoc?(priceDoc.format===PRICE_FORMAT?priceDoc:slimPrices(priceDoc)):null;
  if(prices)fillPrices(d,prices);
  const rules=[],add=(key,ticker,label,price,condition,basis,group="stocks",kind="국내")=>{
    price=Number(price);if(!Number.isFinite(price)||price<=0||!ticker)return;
    rules.push({id:key,kind:"trade",ticker:String(ticker).trim().toUpperCase(),label,targetPrice:price,condition,quoteGroup:group,quoteKey:String(ticker).trim().toUpperCase(),quoteKind:kind,enabled:true,revision:JSON.stringify(basis)});
  };
  for(const p of Array.isArray(d.plans)?d.plans:[]){
    if(!p?.id||!Number.isInteger(Number(p.stages))||p.stages<2||p.stages>250)continue;
    const count=Number(p.stages),ticker=planTicker(p.ticker),kind=planQuoteKind(ticker,p.currency),q=stockEntry(prices,ticker);
    if(q&&q.kind!==kind)continue;
    const basis=[count,tradePriceBasis(p,"startPrice",p.startLabel,p.startAuto===true),tradePriceBasis(p,"endPrice",p.endLabel,true)];
    for(let i=0;i<count;i++)if(p.checked?.[i]!==true&&tradePlanEnabled(p,i)){
      const price=Number(p.startPrice)-(Number(p.startPrice)-Number(p.endPrice))*i/Math.max(count-1,1);
      add(`trade:plan:${p.id}:${i}`,ticker,i===0?"분할매도 첫 매도":"분할매도 "+(i+1)+"회",price,Number(p.endPrice)>Number(p.startPrice)?"up":"down",basis,"stocks",kind);
    }
  }
  const f=d.futures,month=priceMonth(f);
  if(f&&month)for(const [i,l] of (Array.isArray(f.levels)?f.levels:[]).entries()){
    const tr=Array.isArray(l.tranches)?l.tranches:[],done=Number(l.contracts)>0&&tr.length>=Number(l.contracts)&&tr.every(t=>t.completed===true);
    if(!tradeLevelEnabled(f,l)||done)continue;
    const name=Number(l.days)>0?`${Number(l.days)}일선`:`추가 ${i+1}`;
    const mark=Number(f.auto?.[name]),basis=Number(l.days)>0?[Number(l.days),Number(l.price)>0&&mark>0&&Number(l.price)!==mark?Number(l.price):null]:[Number(l.price)];
    add(`trade:future:${i}`,month,`달러선물 ${name}`,l.price,"down",basis,"futures","달러선물");
  }
  if(f?.rebuy&&month){
    const r=futureRebuyOf(f),s=futureRebuySummary(f),addF=(key,label,price,condition,basis)=>add(`trade:future-rebuy:${key}`,month,label,price,condition,basis,"futures","달러선물");
    if(s.ready&&!s.started){
      if(futureRebuyAlertEnabled(f,"breakdown"))addF("breakdown","달러선물 신저점 손절 시작",r.lowPrice,"down",[r.lowPrice]);
      for(const c of s.cuts)if(!c.done&&c.qty>0&&futureRebuyAlertEnabled(f,"cuts",c.k-1))addF(`cut:${c.k-1}`,`달러선물 손절 ${c.k}회`,c.price,"down",[r.lowPrice,r.floorPrice,s.cuts.length,c.k]);
    }
    for(const x of tradeTranchesToSend(s))if(futureRebuyAlertEnabled(f,"buys",`stage:${x.i}`))
      addF(`buy:stage:${x.i}${x.t?`:${x.t+1}`:""}`,`달러선물 재매수 ${tradeStageName(s.stages[x.i].name,x.i)}${x.t?` ${x.t+1}차`:""}`,x.price,"up",tradeTrancheBasis(r,s,x));
  }
  for(const [ri,r] of rebuyItems(d).entries()){
    const ticker=String(r.ticker||"").trim().toUpperCase(),q=stockEntry(prices,ticker),kind=usTicker(ticker)?"해외":"국내"; // 미국 종목은 달러 시세로
    if(!ticker||q&&q.kind!==kind)continue;
    const key=String(r.id||`legacy-${ri}`),s=rebuySummary(r),ready=Number(r.lowPrice)>0&&holdShares(r)>0;
    const addR=(suffix,label,price,condition,basis)=>add(`trade:rebuy:${key}:${suffix}`,ticker,label,price,condition,basis,"stocks",kind);
    if(ready&&!s.started){
      if(tradeRebuyEnabled(r,"breakdown"))addR("breakdown","재매수 신저점 이탈",r.lowPrice,"below",[Number(r.lowPrice)]);
      for(const c of s.cuts)if(!c.done&&c.qty>0&&tradeRebuyEnabled(r,"cuts",c.k-1))addR(`cut:${c.k-1}`,`재매수 손절 ${c.k}회`,c.price,"down",[Number(r.lowPrice),Number(r.stepPct)||1,c.k]);
    }
    // 비운 가격은 표시용 추정값이다. 알림 기준으로 사용하지 않는다(tradeTranchesToSend).
    for(const x of tradeTranchesToSend(s))if(tradeRebuyEnabled(r,"buys",x.i)){const name=s.stages[x.i].name;
      addR(`buy:${encodeURIComponent(name)}:${x.i}${x.t?`:${x.t+1}`:""}`,`재매수 ${tradeStageName(name,x.i)}${x.t?` ${x.t+1}차`:""}`,x.price,"up",tradeTrancheBasis(r,s,x));}
  }
  return rules;
}
function renderTradeAlertSummary(){
  const target=$("tradeAlertsSummary");if(!target)return;
  const plans=state.plans||[],f=state.futures,items=rebuyItems(state);
  const saleCount=plans.reduce((n,p)=>n+Array.from({length:Number(p.stages)||0},(_,i)=>p.checked?.[i]!==true&&tradePlanEnabled(p,i)?1:0).reduce((a,b)=>a+b,0),0);
  const fs=futureRebuySummary(f),futureCount=f?.rebuy?(!fs.started&&fs.ready&&futureRebuyAlertEnabled(f,"breakdown")?1:0)+(!fs.started?fs.cuts.filter(c=>!c.done&&c.qty>0&&futureRebuyAlertEnabled(f,"cuts",c.k-1)).length:0)+tradeTranchesToSend(fs).filter(x=>futureRebuyAlertEnabled(f,"buys",`stage:${x.i}`)).length:0;
  const levelCount=(f?.levels||[]).filter(l=>tradeLevelEnabled(f,l)&&!levelDone(l)).length+futureCount;
  const rebuyCount=items.reduce((n,r)=>{const s=rebuySummary(r);return n+(!s.started&&tradeRebuyEnabled(r,"breakdown")?1:0)+(!s.started?s.cuts.filter(c=>!c.done&&c.qty>0&&tradeRebuyEnabled(r,"cuts",c.k-1)).length:0)+tradeTranchesToSend(s).filter(x=>tradeRebuyEnabled(r,"buys",x.i)).length;},0);
  target.innerHTML=`<div class="trade-alert-summary"><span>분할매도 <b>${saleCount}</b></span><span>달러선물 <b>${levelCount}</b></span><span>재매수 <b>${rebuyCount}</b></span></div><p class="hint">각 화면의 가격 옆에서 알림을 켜세요. 기준가 변경은 자동 반영되며 완료한 회차·단계는 제외됩니다. 종목 코드와 시세·기준가가 있어야 발송됩니다.</p>`;
}
