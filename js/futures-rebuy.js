// 달러선물 신저점 손절 후 재매수 화면. 계산은 rebuy.js(futureRebuySummary 등), 달러선물 화면은 futures.js.
// 손절·재매수 계산은 rebuy.js에 둔다(비공개 시세 수집 작업도 같은 함수를 사용). 아래 보유 반영은 화면 쪽에서만 하며 계산 함수는 기록만 읽는다.
// 손절은 특수한 상황이라 실행 전·진행 중·완료 모두 섹션 전체를 한 줄로 접어 두고(futureRebuyFoldLine), 매매 시점(futureCutDue·futureBuyDue)이나
// 보유 미반영·체결 초과 경고가 새로 생기면 펼친다(futureRebuyOpenNow). 펼치기·접기로 고른 상태는 다음에 새 매매 시점·경고가 생길 때까지 유지한다.
// 접힌 줄 전체와 펼친 제목(왼쪽 화살표)을 누르면 펼치고 접는다. 접힌 줄은 '보유·계산 기준'과 같은 details 카드다(배경 있는 button은 삼성 인터넷 다크 색 변환에서 혼자 밝아짐). 화면 상태라 저장·동기화하지 않는다(페이지를 새로 열면 다시 접힘). 손절·재매수 알림으로 이동하면 push.js가 펼친다.
let futureRebuyExpanded=false,futureRebuySeen=[];
// 펼친 화면의 '1. 분할 손절'·'2. 반등 단계별 재매수' 표도 그 표의 회차가 매매 시점(futureCutDue·futureBuyDue)일 때만 기본으로 펼친다. 사용자가 기본과 다르게 열거나 접은 상태와
// 표 안에서 체크·입력한 뒤의 열린 상태는 다시 그려도 유지하고(화면 상태, 저장·동기화 안 함), 다른 회차가 새로 매매 시점이 되면 기본으로 돌린다.
const futureTableState={cuts:{open:null,due:""},buys:{open:null,due:""}};
let futureCutsOpen=false,futureBuysOpen=false,futureBuyStagesOpen=false; // 손절 완료·재매수 완료 회차와 '다른 단계' 펼침(화면 상태, 저장·동기화 안 함)
// 손절 시점인 다음 손절 회차(현재 환율 ≤ 회차 환율). 기준 미입력·재매수 시작 뒤·현재 환율 없음이면 null.
function futureCutDue(s,cur){const c=s.ready&&!s.started?s.cuts.find(x=>futureCutRest(x)>0):null;return c&&cur>0&&cur<=c.price?c:null;}
// 재매수 시점인 첫 재매수 회차(현재 환율 ≥ 회차 환율, 표의 '재매수 시점'과 같은 조건). 손절 전·현재 환율 없음이면 null.
function futureBuyDue(s,cur){return s.tranches.find(y=>!y.done&&y.amount>0&&!y.est&&cur>0&&y.price>0&&cur>=y.price)||null;}
// 섹션을 지금 펼칠지(keys: 지금의 매매 시점 회차·경고 키). 앞 화면에 없던 키가 생기면 접어 둔 상태보다 우선해 펼친다.
function futureRebuyOpenNow(keys){if(keys.some(k=>!futureRebuySeen.includes(k)))futureRebuyExpanded=true;futureRebuySeen=keys;return futureRebuyExpanded;}
// kind 표를 지금 펼칠지(key: 매매 시점 회차, 없으면 ""). bindFutureTable은 그 표의 열기·접기와 표 안 체크·입력을 기억한다.
function futureTableOpen(kind,key){const t=futureTableState[kind];if(key&&key!==t.due)t.open=null;t.due=key;return t.open??!!key;}
function bindFutureTable(kind,box,key){
  const t=futureTableState[kind];box.ontoggle=()=>{t.open=box.open===!!key?null:box.open;};
  box.addEventListener("change",()=>{t.open=true;},true); // 체크·입력 처리(다시 그리기)보다 먼저 열린 상태를 남긴다
}

// 손절·재매수 체크는 보유 월물·누적 정산손익에 반영한다(분할매수 체크의 월물 편입과 같은 방식).
// 손절: 판 계약 수 이상 남은 가장 가까운 월물에서 빼고, 남은 계약의 단순평균가는 그대로 둔다.
//   실현 손익 round((체결 환율 − 판 시점 단순평균가) × 계약 × 1만)을 누적 정산손익에 더하고 기록에 month·settlementPrice를 남긴다.
// 재매수: 시세 월물(prices.js priceMonth — 보유 근월물, 없으면 마지막 손절 월물이며 그 최종거래일부터 다음 월물)에 체결 환율로 편입(가중평균)하고 기록에 month를 남긴다.
// 해제·계약 수·체결 환율 수정은 기록한 월물에서 같은 계산으로 되돌린다(손절로 다 판 월물은 되살린다).
// 손절 계약을 늘리다 다른 월물에서도 팔면 기록에 월물별 내역 legs [{month, contracts, settlementPrice}]를 남기고(입력 때만, 한 월물이면 만들지 않음),
// 줄이거나 해제할 때 마지막에 판 월물부터 그 월물의 판 시점 단순평균가로 되돌린다. month는 마지막에 판 월물, settlementPrice는 계약 가중평균이다.
// 손절 계약 수는 분할매도처럼 회차의 누적 체결(체결 칸)이고, 회차 계획보다 적으면 부분 체결로 남은 계약을 그 회차에 둔다(futureCutPlan).
// month 없는 기록(연동 전 체크·보유 월물이 없을 때 체크)은 계산에 넣지 않고 '보유 월물에 반영'을 누를 때만 반영한다(직접 고친 보유와 중복 방지).
// '직접 반영함'을 누르면 그 기록에 manual을 남겨 안내·반영 대상에서 뺀다(보유 월물·누적 정산손익은 그대로). 체크를 해제하면 기록과 함께 지운다.
const futureRebuyOpen=x=>!!x&&typeof x==="object"&&!x.month&&!x.manual&&futureRebuyQty(x.contracts)>0;
const futureCutPnl=rec=>Math.round(((Number(rec.price)||Number(rec.targetPrice))-Number(rec.settlementPrice))*futureRebuyQty(rec.contracts)*contractSize);
const addFuturePnl=(f,v)=>{f.baselinePnl=(Number(f.baselinePnl)||0)+v;};
// 손절 기록이 판 월물별 계약(사본): legs가 있으면 legs, 없으면 month·settlementPrice 하나.
const futureCutLegs=rec=>Array.isArray(rec?.legs)&&rec.legs.length?rec.legs.map(l=>({month:String(l.month),contracts:futureRebuyQty(l.contracts),settlementPrice:Number(l.settlementPrice)}))
  :rec?.month?[{month:String(rec.month),contracts:futureRebuyQty(rec.contracts),settlementPrice:Number(rec.settlementPrice)}]:[];
// 되돌릴 n계약을 마지막에 판 월물부터 고른다(사본).
const futureCutBack=(rec,n)=>futureCutLegs(rec).reverse().map(l=>{const take=Math.min(l.contracts,n);n-=take;return {...l,contracts:take};}).filter(l=>l.contracts>0);
// 기록에 월물별 계약을 맞춘다: 남은 월물이 둘 이상이면 legs, 하나면 legs를 지운다. month는 마지막에 판 월물(시세 월물 prices.js priceMonth도 이 값을 쓴다).
function setFutureCutLegs(rec,legs){
  const left=legs.filter(l=>l.contracts>0),qty=left.reduce((n,l)=>n+l.contracts,0);
  if(qty)rec.settlementPrice=left.reduce((n,l)=>n+l.settlementPrice*l.contracts,0)/qty;
  if(left.length)rec.month=left.at(-1).month;
  if(left.length>1)rec.legs=left;else delete rec.legs;
}
const futureHeld=(f,month)=>f.positions.some(p=>String(p.month)===month);
// qty계약 이상 남은 보유 월물(prefer 우선, 없으면 가장 가까운 월물). 없으면 "".
function futureHeldMonth(f,qty,prefer){
  const months=f.positions.filter(p=>monthOk(String(p.month))&&(Number(p.contracts)||0)>=qty).map(p=>String(p.month)).sort();
  return months.includes(prefer)?prefer:months[0]||"";
}
function sellFromPosition(f,month,qty){
  const i=f.positions.findIndex(p=>String(p.month)===month),c=Number(f.positions[i]?.contracts)||0;if(i<0||c<qty)return false;
  if(c===qty)f.positions.splice(i,1);else f.positions[i].contracts=c-qty;
  return true;
}
function linkFutureCut(f,rec){
  const qty=futureRebuyQty(rec.contracts),month=qty?futureHeldMonth(f,qty):"",avg=Number(f.positions.find(p=>String(p.month)===month)?.settlementPrice);
  if(!month||!(avg>0))return false;
  rec.month=month;rec.settlementPrice=avg;sellFromPosition(f,month,qty);addFuturePnl(f,futureCutPnl(rec));
  return true;
}
// detach: 되돌릴 월물이 보유에 없을 때(월물교체 등) 그 월물에는 판 계약을 되돌리지 않고 손익만 되돌린다(보유는 직접 수정). 보유에 있는 월물은 되돌린다.
function unlinkFutureCut(f,rec,detach=false){for(const l of futureCutLegs(rec))if(!detach||futureHeld(f,l.month))addToPosition(f,l.month,l.contracts,l.settlementPrice);addFuturePnl(f,-futureCutPnl(rec));}
// fill = [기록, 가격 필드](futureFillRec): 새 기록 buys[t].price, 옛 통째 기록은 단계의 execPrice.
function linkFutureRebuy(f,[rec,key]){
  const qty=futureRebuyQty(rec.contracts),price=Number(rec[key]),month=priceMonth(f,typeof priceData==="object"?priceData:null);
  if(!qty||!(price>0)||!month)return false;
  addToPosition(f,month,qty,price);rec.month=month;
  return true;
}
// 화면 확인용 읽기 전용 재매수 기록(futureFillRec와 같은 위치, 기록을 옮기거나 만들지 않음).
function futureFillOf(f,i,t){const x=futureRebuyStages(futureRebuyOf(f))[i];return !x?null:x.done?(t===0?[x,"execPrice"]:null):Array.isArray(x.buys)&&x.buys[t]?[x.buys[t],"price"]:null;}
// 손절 체크·해제: false = 기록 규칙 위반, "unlinked" = 판 계약 수만큼 남은 보유 월물이 없어 기록만 함.
// 부분 체결 회차를 체크하면 계획 계약까지 채운다(setFutureCutCount와 같은 반영). detach는 unlinkFutureCut 주석.
function setFutureCutChecked(f,i,on,detach=false){
  const cuts=futureRebuyOf(f).cuts,old=Array.isArray(cuts)?cuts[i]:null;
  if(on&&old){const s=futureRebuySummary(f),c=s.cuts[i];return s.started||!c||c.done||setFutureCutCount(f,i,String(c.plannedQty))===false?false:old.month?true:"unlinked";}
  if(setFutureCutDone(f,i,on)===false)return false;
  if(on)return linkFutureCut(f,f.rebuy.cuts[i])||"unlinked";
  if(old?.month)unlinkFutureCut(f,old,detach);
}
// 체결 칸(회차 누적 체결 계약) 수정: 0·빈칸은 체크 해제, 기록 없는 회차는 새 체결(부분 체결 포함)로 근월물에 반영한다(linkFutureCut).
// 늘린 계약은 기록의 month(마지막에 판 월물, 모자라면 늘린 계약 수만큼 남은 가장 가까운 월물)에서 그 월물 단순평균가로 빼고 그 월물의 판 계약에 더한다(다른 월물이면 legs).
// 줄인 계약은 마지막에 판 월물부터 그 월물의 판 시점 단순평균가로 되돌린다(detach면 보유에 없는 월물은 손익만, unlinkFutureCut 주석).
// 기록의 settlementPrice는 월물별 계약 가중평균으로 고쳐 실현 손익을 맞춘다.
function setFutureCutCount(f,i,text,detach=false){
  const rec=(futureRebuyOf(f).cuts||[])[i],old=futureRebuyQty(rec?.contracts),t=String(text).trim(),qty=t===""?0:Number(t);
  if(!Number.isInteger(qty)||qty<0)return false;
  if(!qty)return rec?setFutureCutChecked(f,i,false,detach):undefined;
  if(!rec){if(setFutureCutQty(f,i,t)===false)return false;return linkFutureCut(f,f.rebuy.cuts[i])||"unlinked";}
  if(!rec.month)return setFutureCutQty(f,i,t);
  const legs=futureCutLegs(rec),back=qty<old?futureCutBack(rec,old-qty):[];
  const sell=qty>old?futureHeldMonth(f,qty-old,rec.month):"",avg=Number(f.positions.find(p=>String(p.month)===sell)?.settlementPrice),before=futureCutPnl(rec);
  if(qty>old&&!(avg>0)||setFutureCutQty(f,i,t)===false)return false;
  if(qty>old){
    sellFromPosition(f,sell,qty-old);const leg=legs.find(l=>l.month===sell);
    if(leg){leg.settlementPrice=(leg.settlementPrice*leg.contracts+avg*(qty-old))/(leg.contracts+qty-old);leg.contracts+=qty-old;}else legs.push({month:sell,contracts:qty-old,settlementPrice:avg});
  }else for(const b of back){
    if(!detach||futureHeld(f,b.month))addToPosition(f,b.month,b.contracts,b.settlementPrice);
    legs.find(l=>l.month===b.month).contracts-=b.contracts;
  }
  if(qty!==old)setFutureCutLegs(rec,legs);
  addFuturePnl(f,futureCutPnl(rec)-before);
}
function setFutureCutPrice(f,i,text){
  const n=Number(text),rec=editFutureRebuy(f).cuts[i];if(!rec||!Number.isFinite(n)||n<=0)return false;
  const before=rec.month?futureCutPnl(rec):0;rec.price=n;
  if(rec.month)addFuturePnl(f,futureCutPnl(rec)-before);
}
// 재매수 체크·해제. 해제할 때 보유에서 뺄 월물이 없으면 detach일 때만 체크만 푼다(보유는 직접 수정).
// 부분 체결 회차를 체크하면 남은 계약까지 채운다(setFutureBuyCount와 같은 반영 — 보유에는 더한 계약만 넣는다).
function setFutureBuyChecked(f,i,t,on,detach=false){
  if(on){
    const part=futureRebuySummary(f).tranches.find(y=>y.i===i&&y.t===t&&y.partial);
    if(part)return part.amount<1||setFutureBuyCount(f,i,t,String(part.qty+part.amount))===false?false:futureFillOf(f,i,t)?.[0]?.month?true:"unlinked";
    if(setFutureBuyDone(f,i,t,true)===false)return false;return linkFutureRebuy(f,futureFillRec(f,i,t))||"unlinked";
  }
  const fill=futureFillOf(f,i,t),rec=fill?.[0],qty=futureRebuyQty(rec?.contracts),price=Number(rec?.[fill?.[1]]),month=rec?.month?futureHeldMonth(f,qty,rec.month):"";
  if(rec?.month&&!month&&!detach||setFutureBuyDone(f,i,t,false)===false)return false;
  if(month)removeFromPosition(f,month,qty,price);
  const st=futureRebuyOf(f).stages[i];delete st.month;delete st.manual; // 옛 통째 기록은 해제 후에도 단계가 남는다
}
function setFutureBuyCount(f,i,t,text){
  const fill=futureFillOf(f,i,t),rec=fill?.[0],old=futureRebuyQty(rec?.contracts),qty=Number(text);
  if(!rec?.month)return setFutureBuyQty(f,i,t,text);
  const take=qty<old?futureHeldMonth(f,old-qty,rec.month):"",price=Number(rec[fill[1]]);
  if(qty<old&&!take||setFutureBuyQty(f,i,t,text)===false)return false;
  if(qty>old)addToPosition(f,rec.month,qty-old,price);else if(qty<old)removeFromPosition(f,take,old-qty,price);
}
function setFutureBuyExec(f,i,t,text){
  const fill=futureFillOf(f,i,t),rec=fill?.[0],n=Number(text);
  if(!rec?.month)return setFutureBuyPrice(f,i,t,text);
  const qty=futureRebuyQty(rec.contracts),old=Number(rec[fill[1]]),month=futureHeldMonth(f,qty,rec.month);
  if(!month||setFutureBuyPrice(f,i,t,text)===false)return false;
  removeFromPosition(f,month,qty,old);addToPosition(f,month,qty,n);
}
// month·manual 없는 손절·재매수 계약 수(화면 안내용, 읽기 전용).
function futureRebuyUnlinked(f){
  const r=futureRebuyOf(f),qty=x=>futureRebuyOpen(x)?futureRebuyQty(x.contracts):0;
  return {cuts:(Array.isArray(r.cuts)?r.cuts:[]).reduce((n,c)=>n+qty(c),0),buys:futureRebuyStages(r).reduce((n,x)=>n+(x.done?qty(x):(Array.isArray(x.buys)?x.buys:[]).reduce((m,b)=>m+qty(b),0)),0)};
}
// month·manual 없는 기록을 손절 → 재매수 순서로 반영한 사본. 하나라도 반영할 수 없으면 null(원본은 그대로).
function futureRebuyLinked(f){
  const g=JSON.parse(JSON.stringify(f)),r=editFutureRebuy(g);
  if(!r.cuts.every(c=>!futureRebuyOpen(c)||linkFutureCut(g,c)))return null;
  const fills=r.stages.flatMap(x=>x.done?[[x,"execPrice"]]:(Array.isArray(x.buys)?x.buys:[]).map(b=>[b,"price"]));
  return fills.every(fill=>!futureRebuyOpen(fill[0])||linkFutureRebuy(g,fill))?g:null;
}
// '직접 반영함': month·manual 없는 기록에 manual만 남긴다.
function markFutureRebuyManual(f){
  const r=editFutureRebuy(f);
  [...r.cuts,...r.stages.flatMap(x=>x.done?[x]:Array.isArray(x.buys)?x.buys:[])].forEach(x=>{if(futureRebuyOpen(x))x.manual=true;});
}
// 손절 기준 수정 창(제목 옆 연필)에서 바꾼 칸 {키: 입력 글자}만 setFutureRebuyField로 저장한다(안 바꾼 칸은 필드를 만들지 않음).
// 신저점>하단, 손절 목표(이탈 전 계약 × 비중)≥판 계약은 칸끼리 서로 검사하므로 사본에 순서를 바꿔 적용해 보고 처음 통과한 사본을 돌려준다.
// 하나도 통과하지 못하면 null(원본은 그대로). 호출하는 쪽이 f.rebuy를 사본의 rebuy로 바꾼다.
// 하단선(floorLine)은 먼저 적용한다(새 선을 고르면 하단 가격을 지워 시세를 기다리므로 신저점 검사가 옛 하단에 걸리지 않음).
function applyFutureRebuyEdits(f,edits){
  for(const prices of [["lowPrice","floorPrice"],["floorPrice","lowPrice"]])for(const goal of [["contracts","sellPct"],["sellPct","contracts"]]){
    const g=JSON.parse(JSON.stringify(f));
    if(["floorLine",...prices,...goal,"steps","currentPrice"].every(key=>!Object.hasOwn(edits,key)||setFutureRebuyField(g,key,String(edits[key]))!==false))return g;
  }
  return null;
}
// 저장할 수 없을 때 창에 보일 이유(values = 창의 모든 칸 글자, 하단선을 골랐으면 floorLine과 그 선의 시세 floorPrice).
function futureRebuyEditError(f,values){
  const n=key=>Number(values[key])||0,cuts=futureRebuyOf(f).cuts,sold=(Array.isArray(cuts)?cuts:[]).reduce((m,c)=>m+futureRebuyQty(c?.contracts),0);
  if(futureRebuyBought(f))return "재매수 시작 후 손절 기준은 재매수 체크를 모두 해제한 뒤 바꿀 수 있습니다.";
  if(n("lowPrice")>0&&n("floorPrice")>0&&n("lowPrice")<=n("floorPrice"))return values.floorLine?futureFloorAbove(values.floorLine,n("floorPrice")):"손절 하단은 신저점 환율보다 낮게 입력하세요.";
  const pct=String(values.sellPct??"").trim()===""?50:Number(values.sellPct);
  if(sold&&futureCutGoal(f,pct,n("contracts"))<sold)return `손절 목표(이탈 전 계약 수 × 손절 비중)가 이미 손절한 ${sold}계약보다 작아집니다.`;
  return "이탈 전 계약 수는 정수로, 분할 횟수는 1~60으로, 손절 비중은 0~100%로 입력하세요.";
}
// 하단선 시세가 신저점 환율 이상일 때 창에 보일 이유(line = 하단선 이름, floor = 그 선의 시세).
const futureFloorAbove=(line,floor)=>`손절 하단 ${movingLineText(line)}(${fmtPrice(floor)}원)이 신저점 환율 이상입니다. 더 긴 선이나 직접 가격을 고르세요.`;
// 손절 하단 칸: 숫자 + 단위(원 = 직접 가격, 일선·주선·월선 = 그 기간의 하단선). 선을 고르면 숫자는 기간(1~400)이고 아래 작은 글씨에 그 선의 지금 시세를 보인다.
// 하단선은 setFutureRebuyField('floorLine')로 저장하며, 직접 가격 칸은 선을 고른 동안 비활성이라 바꾼 칸에 들어가지 않는다.
function openFutureRebuyDialog(){
  const f=state.futures,r=futureRebuyOf(f),s=futureRebuySummary(f),fe=futuresEntry(priceData,f),locked=futureRebuyLocked(f),dialog=$("futureRebuyDialog"),opt=v=>Number(v)>0?futureShown(v):"";
  const field=(key,label,value,attrs,off=s.started)=>`<label class="field"><span>${label}</span><input data-fr-field="${key}" type="number" ${attrs} value="${value}"${off?" disabled":""}></label>`;
  const floorLine=futureFloorLine(r.floorLine),lock=s.started?" disabled":"",floorUnits=[["","원"],["일선","일선"],["주선","주선"],["개월선","월선"]];
  const floorField=`<div class="field future-floor"><span>손절 하단</span><div class="hold-input"><input data-fr-field="floorPrice" type="number" min="0" step="any" inputmode="decimal" value="${opt(r.floorPrice)}" aria-label="손절 하단 (원)"${floorLine?" hidden disabled":lock}><input id="frFloorPeriod" type="number" min="1" max="400" step="1" inputmode="numeric" value="${parseInt(floorLine)||60}" required aria-label="손절 하단 이동평균 기간"${floorLine?lock:" hidden disabled"}><select id="frFloorUnit" aria-label="손절 하단 단위"${lock}>${floorUnits.map(([v,label])=>`<option value="${v}"${movingLineUnit(floorLine)===v?" selected":""}>${label}</option>`).join("")}</select></div><small id="frFloorPrice"></small></div>`;
  const hint=s.started?"재매수 시작 후 손절 기준은 재매수 체크를 모두 해제한 뒤 바꿀 수 있습니다.":locked?"기준을 바꿔도 체크한 손절의 계약 수·환율은 그대로 두고 남은 회차만 다시 나눕니다. 손절 목표(이탈 전 계약 수 × 손절 비중)는 이미 손절한 계약 수 이상이어야 합니다.":"손절 비중은 0~100%로 입력합니다(기본 50%). 손절 계약 수보다 많은 분할 횟수는 자동으로 줄입니다.";
  dialog.innerHTML=`<form id="futureRebuyForm" class="dialog-inner" novalidate><div class="dialog-head"><h2 id="futureRebuyTitle">손절 기준 수정</h2><button class="btn ghost" type="button" data-close-future-rebuy>닫기</button></div>
    <p class="hint">신저점부터 정한 하단까지 환율을 고르게 나눕니다. 설정한 비중만큼 손절하고, 하단 아래의 손절 회차는 만들지 않습니다. 하단은 직접 가격(원)이나 일선·주선·월선으로 정하며, 선을 고르면 그 선의 시세를 따라 남은 회차가 다시 나뉩니다.</p>
    <div class="dialog-grid">${field("lowPrice","신저점 환율 (원)",opt(r.lowPrice),'min="0" step="any" inputmode="decimal"')}${floorField}${field("contracts","이탈 전 계약 수",s.hold||"",'min="0" step="1" inputmode="numeric"')}${field("sellPct","손절 비중 (%)",shown(s.sellPct),'min="0" max="100" step="any" inputmode="decimal"')}${field("steps","분할 횟수",futureRebuyQty(r.steps)||10,'min="1" max="60" step="1" inputmode="numeric"')}${fe?"":field("currentPrice","현재 환율 (원)",opt(r.currentPrice),'min="0" step="any" inputmode="decimal" placeholder="시세 없음"',false)}</div>
    <p class="hint">${hint}${s.cuts.length===1?" 한 번만 손절하는 계획은 하단에서 실행합니다.":""}${fe?"":" 보유 근월물 시세가 없어 현재 환율은 직접 넣습니다."}</p>
    <p class="future-plan-error" id="futureRebuyError" role="alert"></p><div class="dialog-foot"><button class="btn" type="button" data-close-future-rebuy>취소</button><button class="btn primary" type="submit">저장</button></div></form>`;
  const inputs=[...dialog.querySelectorAll("[data-fr-field]")],initial=Object.fromEntries(inputs.map(el=>[el.dataset.frField,el.value])),error=$("futureRebuyError");
  const price=dialog.querySelector('[data-fr-field="floorPrice"]'),period=$("frFloorPeriod"),unit=$("frFloorUnit"),floorNote=$("frFloorPrice");
  const chosenLine=()=>unit.value?futureFloorLine(`${Number(period.value)}${unit.value}`):"";
  const lineValue=line=>priceRound(maValue(fe,line),2)||(line===floorLine?Number(r.floorPrice)||0:0); // 시세 파일 값, 없으면 저장한 같은 선의 하단
  const syncFloor=()=>{
    const ma=!!unit.value,line=chosenLine(),v=line?lineValue(line):0;
    price.hidden=ma;price.disabled=ma||s.started;period.hidden=!ma;period.disabled=!ma||s.started;
    const last=v>0&&!(priceRound(maValue(fe,line),2)>0)&&!!priceData; // 시세 파일에 선 값이 없어 저장한 마지막 하단을 보이는 중
    floorNote.textContent=!ma?"":!line?"기간은 1~400으로 입력하세요.":v>0?`${movingLineText(line)} ${last?"시세 없음 · 마지막 값 ":""}${fmtPrice(v)}원`:`${movingLineText(line)} 시세 대기`;floorNote.classList.toggle("warn",last);
  };
  syncFloor();
  dialog.querySelectorAll("[data-close-future-rebuy]").forEach(b=>b.onclick=()=>dialog.close());
  inputs.forEach(el=>el.oninput=()=>{error.textContent="";});
  period.oninput=unit.onchange=()=>{error.textContent="";syncFloor();};
  $("futureRebuyForm").onsubmit=e=>{
    e.preventDefault();
    const open=inputs.filter(el=>!el.disabled),invalid=[...open,period].find(el=>!el.disabled&&!el.checkValidity());if(invalid){invalid.reportValidity();return;}
    const edits=Object.fromEntries(open.filter(el=>el.value!==initial[el.dataset.frField]).map(el=>[el.dataset.frField,el.value])),line=chosenLine();
    if(!s.started&&line!==floorLine)edits.floorLine=line;
    if(!Object.keys(edits).length){dialog.close();return;}
    const latest=state.futures,g=applyFutureRebuyEdits(latest,edits);
    if(!g){error.textContent=futureRebuyEditError(latest,{...Object.fromEntries(inputs.map(el=>[el.dataset.frField,el.value])),...(line?{floorLine:line,floorPrice:String(lineValue(line)||"")}:{})});return;}
    const priced=priceData&&Object.keys(edits).some(key=>key!=="currentPrice");if(priced)fillPrices({futures:g},priceData);
    const gl=futureFloorLine(g.rebuy.floorLine),floor=Number(g.rebuy.floorPrice)||0; // 새로 고른 하단선·신저점은 지금 시세로 하단이 신저점보다 낮은지 확인한다
    if(gl&&(Object.hasOwn(edits,"floorLine")||Object.hasOwn(edits,"lowPrice"))&&floor>0&&Number(g.rebuy.lowPrice)>0&&floor>=Number(g.rebuy.lowPrice)){error.textContent=futureFloorAbove(gl,floor);return;}
    latest.rebuy=g.rebuy;if(priced)fillPrices({futures:latest},priceData);
    save();dialog.close();renderFutures();
  };
  dialog.showModal();
}
// 분할매수와 같은 기간·시간축 입력 및 회차 미리보기. 초안은 사본에만 적용하고 저장할 때 최신 체결 기록에 시작선·종료가격만 반영한다.
const futureRebuyStageText = stage => stage.rebuyEnd?"종료가격":movingLineText(stage.name);
const futureRebuyLineText = name => movingLineUnit(name)==="선"?`${parseInt(name)}시간선`:movingLineText(name);
function openFutureRebuyStartDialog(){
  const dialog=$("futureRebuyStartDialog"),f=state.futures,r=futureRebuyOf(f),initial=movingLineName(r.startLine)||movingLineName(futureRebuyStages(r)[0]?.name)||"25선";
  const initialLine=movingLineName(r.endLine),initialEnd=initialLine||(Number(r.endPrice)>0?String(r.endPrice):""),kind=initialLine?movingLineUnit(initialLine):initialEnd?"direct":"auto";
  const units=[["선","시선 · 60분봉"],["일선","일선"],["주선","주선"],["개월선","월선"]],endUnits=[["direct","직접 가격"],...units,["auto","평균 손절 환율 · 자동"]];
  const options=(list,value)=>list.map(([key,label])=>`<option value="${key}"${value===key?" selected":""}>${label}</option>`).join("");
  dialog.innerHTML=`<form id="futureRebuyStartForm" class="dialog-inner" novalidate><div class="dialog-head"><h2 id="futureRebuyStartTitle">재매수 기준 수정</h2><button class="btn mini ghost" type="button" data-close-rebuy-start>닫기</button></div>
    <div class="future-auto-grid"><div class="field future-auto-start"><span>시작 기준선</span><div class="hold-input"><input id="futureRebuyStartPeriod" type="number" min="1" max="400" step="1" inputmode="numeric" value="${parseInt(initial)}" required aria-label="재매수 시작 이동평균 기간"><select id="futureRebuyStartUnit" aria-label="재매수 시작 이동평균 시간축">${options(units,movingLineUnit(initial))}</select></div><small id="futureRebuyStartPrice"></small></div>
    <div class="field future-auto-start"><span>종료 기준</span><div class="hold-input"><input id="futureRebuyEndPrice" type="number" inputmode="decimal" value="${initialLine?parseInt(initialLine):esc(initialEnd)}" aria-label="재매수 종료 기준 값"><select id="futureRebuyEndUnit" aria-label="재매수 종료 기준 단위">${options(endUnits,kind)}</select></div><small id="futureRebuyStartLimit"></small></div></div>
    <p class="hint future-auto-hint">종료 기준을 직접 가격 또는 시선·일선·주선·월선으로 고르세요. 선택한 종료선의 도달 회차까지 남은 계약을 나누고, 종료 기준 뒤의 회차는 제외합니다. 기존 체결은 그대로 둡니다.</p>
    <div id="futureRebuyStartPreview" class="future-auto-preview" aria-live="polite"></div>
    <p class="future-plan-error" id="futureRebuyStartError" role="alert"></p><div class="dialog-foot"><button class="btn" type="button" data-close-rebuy-start>취소</button><button class="btn primary" type="submit">저장</button></div></form>`;
  const period=$("futureRebuyStartPeriod"),unit=$("futureRebuyStartUnit"),end=$("futureRebuyEndPrice"),endUnit=$("futureRebuyEndUnit"),error=$("futureRebuyStartError");
  let lastKind=kind,directValue=initialLine?"":initialEnd,lineValue=String(parseInt(initialLine)||Math.max(25,parseInt(initial)));
  const line=()=>movingLineName(`${Number(period.value)}${unit.value}`);
  const endChoice=()=>endUnit.value==="auto"?"":endUnit.value==="direct"?end.value:`${Number(end.value)}${endUnit.value}`;
  const syncEnd=()=>{
    const mode=endUnit.value,direct=mode==="direct",auto=mode==="auto";
    end.disabled=auto;end.required=!direct&&!auto;end.min=direct?"0.0001":"1";end.step=direct?"any":"1";
    if(direct||auto)end.removeAttribute("max");else end.max="400";
    end.placeholder=auto?"자동":direct?"가격 (원)":"기간 (1~400)";end.setAttribute("aria-label",direct?"재매수 종료가격 (원)":"재매수 종료 이동평균 기간");
  };
  const update=()=>{
    error.textContent="";
    const latest=state.futures,g=futureRebuyWithStart(latest,line(),futuresEntry(priceData,latest),endChoice());
    if(!g){$("futureRebuyStartPreview").innerHTML='<p class="hint">기간은 1~400으로, 종료선은 시작선과 같거나 뒤로 선택하세요. 종료 기준가는 시작 기준가 이상이어야 합니다.</p>';return;}
    const s=futureRebuySummary(g),start=s.stages[s.active[0]],rows=s.tranches.filter(x=>!x.done&&x.amount>0);
    $("futureRebuyStartPrice").textContent=Number(start?.price)>0?`시작 기준가 ${fmtPrice(start.price)}원`:"시작 기준선 시세 대기";
    $("futureRebuyStartLimit").textContent=s.endLine?s.waitingEnd?`${futureRebuyLineText(s.endLine)} 시세 대기`:`종료 기준가 ${fmtPrice(s.endPrice)}원`:s.endPrice?"직접 입력한 가격에서 종료":s.sellAvg>0?`자동 기준 ${fmtPrice(s.sellAvg)}원`:"손절 체결 후 자동 계산";
    const hint=s.rangeError|| (s.waitingStart?"선택한 시작선의 시세를 기다립니다.":s.waitingEnd?"선택한 종료선의 시세를 기다립니다. 시세가 채워지면 해당 선의 도달 회차까지 계산합니다.":!s.sold?"손절하면 판 계약만큼 선택한 범위에 재매수 회차를 나눕니다.":!s.rest?"판 계약을 모두 재매수했습니다.":"");
    $("futureRebuyStartPreview").innerHTML=`<div class="future-auto-preview-head"><strong>${esc(futureRebuyLineText(line()))}${s.endLine?` → ${esc(futureRebuyLineText(s.endLine))}`:"부터 재매수"}</strong><span>${rows.length}회 · 남은 ${s.rest}계약</span></div>${hint?`<p class="hint">${hint}</p>`:`<div class="future-auto-preview-table"><div class="future-auto-preview-row head"><span>기준선 · 회차</span><span>재매수 환율</span><span>계약 수</span></div>${rows.map(x=>`<div class="future-auto-preview-row"><span>${esc(s.stages[x.i].rebuyEnd?"종료가격":futureRebuyLineText(s.stages[x.i].name))}${x.i===s.endIndex?' <small>종료</small>':` <small>${x.t+1}차</small>`}</span><span>${x.price>0?`${x.est?"≈":""}${fmtPrice(x.price)}원`:"시세 대기"}</span><strong>${x.amount}계약</strong></div>`).join("")}</div>`}`;
  };
  period.oninput=end.oninput=unit.onchange=update;
  endUnit.onchange=()=>{if(lastKind==="direct")directValue=end.value;else if(lastKind!=="auto")lineValue=end.value;lastKind=endUnit.value;end.value=lastKind==="auto"?"":lastKind==="direct"?directValue:lineValue;syncEnd();update();};
  dialog.querySelectorAll("[data-close-rebuy-start]").forEach(b=>b.onclick=()=>dialog.close());
  $("futureRebuyStartForm").onsubmit=e=>{
    e.preventDefault();const invalid=[period,end].find(el=>!el.checkValidity());if(invalid){invalid.reportValidity();return;}
    const latest=state.futures,summary=futureRebuySummary(latest);
    if(line()===initial&&endChoice()===initialEnd&&!summary.rangeError&&!summary.waitingEnd){dialog.close();return;}
    const g=futureRebuyWithStart(latest,line(),futuresEntry(priceData,latest),endChoice());
    if(!g){error.textContent="기간은 1~400, 종료선은 시작선과 같거나 뒤로 선택하세요. 종료 기준가는 시작 기준가 이상이어야 합니다.";return;}
    latest.rebuy=g.rebuy;save();dialog.close();futureRebuyExpanded=true;futureTableState.buys.open=true;renderFutures();
  };
  syncEnd();update();dialog.showModal();
}
// 맨 위 보유 카드(화면 표시만, 기록을 바꾸지 않음): 이탈 전 계약 수만큼 칸(1칸 = 1계약)을 처음 보유(초록) · 재매수로 다시 채운 칸(파랑) · 손절로 빈 칸 순서로 그린다.
// 손절하면 오른쪽부터 비고 재매수하면 빈 칸이 다시 채워진다(빈 칸·파랑은 판 계약 수까지). 손절 목표 밖(최소 유지) 칸은 흐리게 둔다.
// 말풍선은 다음에 비거나 채워질 칸(그 회차 계약 수만큼)을 가리킨다: 재매수 시작 전에는 다음 손절 회차, 손절 목표를 다 팔았거나 재매수를 시작했으면 다음 재매수 회차.
// 손절 시점(현재 환율 ≤ 회차 환율)·재매수 시점(현재 환율 ≥ 회차 환율)은 주황. toggle은 신저점 이탈 알림 스위치, trText는 재매수 회차 이름(이스케이프됨).
function futureRebuyTrack(r,s,cur,toggle,trText){
  const hold=s.hold,sold=Math.min(s.sold,hold),back=Math.min(s.rebought,sold),green=hold-sold,filled=green+back,keep=Math.max(0,hold-s.goal),low=Number(r.lowPrice)||0;
  const cutPx=v=>`${decimal.format(v)}원`,px2=v=>`${fmtPrice(v)}원`;
  const pct=p=>{const g=(p/cur-1)*100;return `${g>0?"+":""}${new Intl.NumberFormat("ko-KR",{maximumFractionDigits:Math.abs(g)<1?2:1}).format(g)}%`;},gap=p=>cur>0&&p>0?pct(p):"";
  const nextCut=s.ready&&!s.started?s.cuts.find(c=>futureCutRest(c)>0):null,cutQty=nextCut?futureCutRest(nextCut):0,nextTr=s.tranches.find(x=>!x.done&&x.amount>0);
  const trPx=x=>Number(x.price)>0?`${x.est?"≈":""}${px2(Number(x.price))}`:"기준가 없음";
  let from=-1,to=-1,bub="",due=false,buy=false;
  if(nextCut){from=Math.max(0,filled-cutQty);to=filled;due=cur>0&&cur<=nextCut.price;
    bub=due?`손절 시점 · ${nextCut.k}회 <b>${cutPx(nextCut.price)}</b> ${cutQty}계약`:`${nextCut.k===1&&!nextCut.recorded?"신저점 이탈 시 1회":`다음 손절 ${nextCut.k}회`} <b>${cutPx(nextCut.price)}</b>${cutQty>1||nextCut.partial?` · ${nextCut.partial?"남은 ":""}${cutQty}계약`:""} ${gap(nextCut.price)}`;}
  else if(nextTr&&filled<hold){buy=true;from=filled;to=Math.min(hold,filled+nextTr.amount);const p=Number(nextTr.price)||0;due=!nextTr.est&&cur>0&&p>0&&cur>=p;
    bub=`${due?"재매수 시점":"다음 재매수"} ${trText(nextTr)} <b>${trPx(nextTr)}</b> ${due?`${nextTr.amount}계약`:gap(p)}`;}
  const [chipCls,chipText]=!s.ready?["muted","기준 확인 필요"]:s.started&&!s.rest?["done","재매수 완료"]:due?["warn",buy?"재매수 시점":"손절 시점"]
    :s.started?["","재매수 진행 중"]:s.sold?nextCut?["","손절 진행 중"]:["","재매수 대기"]:cur>0&&cur<low?["warn","신저점 이탈"]:["muted",cur>0?"신저점 위 대기":"손절 대기"];
  const cell=i=>`<i class="${i<green?i<keep?"h keep":"h":i<filled?"r":"s"}${!buy&&due&&i>=from&&i<to?" due":""}"></i>`,cells=Array.from({length:hold},(_,i)=>i);
  // 다음 회차 칸은 한 묶음(.fr-next)으로 감싸 테두리(손절)·점선(재매수)을 한 번만 그린다(계약이 많아 칸이 좁아도 겹치지 않음).
  const strip=from<0?cells.map(cell).join(""):`${cells.slice(0,from).map(cell).join("")}<span class="fr-next${buy?" buy":""}${due?" due":""}" style="flex:${to-from}">${cells.slice(from,to).map(cell).join("")}</span>${cells.slice(to).map(cell).join("")}`;
  const x=from<0?0:Math.round((from+to)/2/hold*1e4)/100,dense=hold>60?" tight":hold>30?" dense":"";
  const gapChip=p=>gap(p)?` <span class="fr-gap${p>cur?" up":""}">${gap(p)}</span>`:"";
  const bought=s.tranches.filter(t=>t.done&&t.qty>0&&t.execPrice>0),bq=bought.reduce((n,t)=>n+t.qty,0),buyAvg=bq?bought.reduce((n,t)=>n+t.qty*t.execPrice,0)/bq:0,sellAvg=s.sellAvg?px2(s.sellAvg):"";
  const floorWait=s.goal>0?futureFloorWait(r):null;
  const note=!s.ready?floorWait?floorWait.long:"신저점 환율·손절 하단·이탈 전 계약 수·손절 비중을 제목 옆 연필에서 확인하세요."
    :s.started&&!s.rest?`손절 ${s.sold}계약 → 재매수 ${s.rebought}계약${sellAvg?` · 평균 손절 ${sellAvg}`:""}${buyAvg?` → 재매수 ${px2(buyAvg)}`:""}`
    :s.started||s.sold&&!nextCut?`손절 ${s.sold}계약 완료${sellAvg?` · 평균 ${sellAvg}`:""}${s.started&&s.cuts.some(c=>futureCutRest(c)>0)?" · 남은 손절 멈춤":""}`
    :s.sold?`재매수: ${nextTr?`${trText(nextTr)} <b>${trPx(nextTr)}</b> 이상 ${nextTr.amount}계약${gapChip(Number(nextTr.price)||0)}`:"반등 신호가 나오면 판 계약만 되삽니다"}`
    :"손절하면 칸이 오른쪽부터 비고, 재매수하면 빈 칸이 다시 채워집니다.";
  const legend=`<div class="fr-legend"><span>처음 보유 <b>${green}</b>${keep&&green?`<small> · 최소 유지 ${Math.min(keep,green)}</small>`:""}</span><span class="r">재매수 <b>${back}</b></span><span class="s">손절로 빈 칸 <b>${sold-back}</b></span></div>`;
  const track=hold?`${bub?`<div class="fr-bub-row" style="--x:${x}%"><span class="fr-bub${due?" due":""}">${bub}</span><span class="fr-arrow${due?" due":""}"></span></div>`:""}<div class="fr-cells${dense}" role="img" aria-label="이탈 전 ${hold}계약 중 보유 ${s.held}계약 · 손절 ${sold}계약 · 재매수 ${back}계약">${strip}</div>${legend}`:"";
  return `<section class="card fr-track" aria-label="보유 계약"><div class="fr-track-body"><div class="fr-track-top"><div><strong>보유 계약</strong><span class="buy-track-chip${chipCls?` ${chipCls}`:""}">${chipText}</span></div><div class="fr-count"><b>${s.held}</b><span>/ ${hold}계약</span></div></div>${track}<p class="fr-note">${hold?note:"이탈 전 계약 수를 넣으면 보유 계약 칸이 생깁니다."}</p></div>
    <div class="fr-track-foot"><span>손절 평균가 <b>${sellAvg||"—"}</b></span>${toggle}</div></section>`;
}
// 하단선(floorLine)을 골랐지만 손절 회차를 나눌 수 없는 이유 {short 짧은 글자, long 안내 문장}. 신저점이 없거나 나눌 수 있으면 null. 화면 글자만 만든다.
// 선 이름은 futureFloorLine이 '숫자+일선·주선·개월선'으로 정규화한 값만 쓰므로 HTML에 그대로 넣어도 된다(접힌 줄·보유 카드도 같음).
function futureFloorWait(r){
  const line=futureFloorLine(r.floorLine),floor=Number(r.floorPrice)||0,low=Number(r.lowPrice)||0,name=movingLineText(line);
  if(!line||!(low>0)||floor>0&&floor<low)return null;
  return floor>0?{short:`하단 ${name}이 신저점 이상`,long:`손절 하단 ${name}(${fmtPrice(floor)}원)이 신저점 환율 이상이라 손절 회차를 나눌 수 없습니다. 제목 옆 연필에서 하단을 다시 정하세요.`}
    :{short:`하단 ${name} 시세 대기`,long:`손절 하단 ${name}의 시세를 기다립니다. 보유 근월물 시세가 채워지면 손절 회차를 나눕니다.`};
}
// 하단선을 고른 기록인데 받은 시세 파일에 그 선 값이 없으면 true(시세를 받기 전·직접 하단은 false). 손절 회차·알림은 저장한 마지막 하단을 그대로 쓰고 화면에만 알린다.
function futureFloorStale(f,r){
  const line=futureFloorLine(r.floorLine);
  return !!line&&Number(r.floorPrice)>0&&typeof priceData==="object"&&!!priceData&&!(priceRound(maValue(futuresEntry(priceData,f),line),2)>0);
}
// 접힌 한 줄 {text, due}: 상태 · 다음 손절·재매수 환율 · 보유 계약(실행 뒤). 폰(393px) 한 줄에 들도록 회차·단계 이름·계약 수·현재 환율은 넣지 않는다
// (펼치면 보이고, 현재 환율은 화면 맨 위에 있음). 손절·재매수 시점과 실행 전 신저점 이탈은 주황(due). 진행 상태 이름은 보유 계약 카드 칩과 같다.
function futureRebuyFoldLine(r,s,cur,locked,cutDue,buyDue){
  const px=v=>Number(v)>0?`${fmtPrice(v)}원`:"—",cutAt=c=>`${decimal.format(c.price)}원 이하`;
  const trAt=x=>Number(x.price)>0?`${x.est?"≈":""}${fmtPrice(x.price)}원 이상`:"기준가 없음";
  const low=Number(r.lowPrice)||0,broken=!locked&&s.ready&&cur>0&&cur<low,nextCut=s.ready&&!s.started?s.cuts.find(c=>futureCutRest(c)>0):null,nextTr=s.tranches.find(x=>!x.done&&x.amount>0);
  const held=locked&&s.hold?` · 보유 ${s.held}/${s.hold}`:"",floorLine=futureFloorLine(r.floorLine),floorWait=s.goal>0?futureFloorWait(r):null;
  const line=cutDue?`<b>손절 시점</b> · ${cutAt(cutDue)}`:buyDue?`<b>재매수 시점</b> · ${trAt(buyDue)}`
    :!s.goal&&s.hold>0?"손절 목표 0계약 · 펼쳐서 비중을 확인하세요":!s.ready?floorWait?`${floorWait.short} · 펼쳐서 확인하세요`:"기준 미입력 · 펼쳐서 기준을 넣으세요"
    :broken?`<b>신저점 이탈</b> · 다음 손절 ${nextCut?cutAt(nextCut):"없음"}`
    :!locked?`실행 전 · ${px(low)} → ${floorLine?movingLineText(floorLine):px(r.floorPrice)} · 최대 ${s.goal}계약`
    :s.started&&!s.rest?"재매수 완료"
    :nextCut?`손절 진행 중 · ${cutAt(nextCut)}`
    :`${s.started?"재매수 진행 중":"재매수 대기"} · ${nextTr?trAt(nextTr):`남은 ${s.rest}계약`}`;
  return {text:line+held,due:!!(cutDue||buyDue||broken)};
}
function renderFutureRebuy(f){
  const r=futureRebuyOf(f),s=futureRebuySummary(f),locked=futureRebuyLocked(f),cur=Number(r.currentPrice)||0,pctText=shown(s.sellPct),opt=v=>Number(v)>0?futureShown(v):"",px=v=>Number(v)>0?`${fmtPrice(v)}원`:"—";
  const cutPx=v=>Number(v)>0?`${decimal.format(v)}원`:"—";
  const nextTr=s.tranches.find(x=>!x.done&&x.amount>0);
  const trName=x=>`<span class="tr-name">${esc(futureRebuyStageText(s.stages[x.i]))}${s.stages[x.i].done||s.stages[x.i].rebuyEnd?"":`<span class="tr-no">${x.t+1}</span>`}</span>`,trText=x=>`${esc(futureRebuyStageText(s.stages[x.i]))}${s.stages[x.i].done||s.stages[x.i].rebuyEnd?"":` ${x.t+1}회차`}`;
  const cutDue=futureCutDue(s,cur),buyDue=futureBuyDue(s,cur),cutKey=cutDue?String(cutDue.k):"",buyKey=buyDue?`${buyDue.i}:${buyDue.t}`:"";
  const un=futureRebuyUnlinked(f),unText=[un.cuts?`손절 ${un.cuts}계약`:"",un.buys?`재매수 ${un.buys}계약`:""].filter(Boolean).join("·");
  if(!futureRebuyOpenNow([cutKey&&`cut:${cutKey}`,buyKey&&`buy:${buyKey}`,unText&&`unlinked:${unText}`,(s.overSold||s.overBought)&&"over",s.rangeError&&"range"].filter(Boolean))){
    const {text,due}=futureRebuyFoldLine(r,s,cur,locked,cutDue,buyDue);
    $("futureRebuyPanel").innerHTML=`<section class="future-rebuy folded"><details class="card rebuy-fold${due?" due":""}"><summary id="frToggle"><strong>신저점 손절<span class="hide-mobile"> 후 재매수</span></strong><span class="fold-summary" title="${esc(text.replace(/<[^>]+>/g,""))}">${text}</span></summary></details></section>`;
    $("frToggle").onclick=e=>{e.preventDefault();futureRebuyExpanded=true;renderFutures();};
    return;
  }
  // 재매수 계산은 futureRebuySummary와 공유한다. 선택한 시작선·시간축 순서와 보존한 체결 인덱스로 표·알림을 연결한다.
  const notify=(kind,key,label,done,lead)=>typeof futureRebuyAlertEnabled==="function"?tradeAlertToggle(futureRebuyAlertEnabled(f,kind,key),`data-frebuy-alert="${kind}"${key==null?"":` data-alert-key="${esc(key)}"`}`,label,done,lead):"";
  const all=kind=>typeof futureRebuyAllButtons==="function"?futureRebuyAllButtons(kind):"";
  // 분할 손절 표는 분할매도 회차표(purchases.css .purchase-table)와 같다: 회차(아래 남은 계약·도달) · 손절 환율 · 계약(회차 계획) · 체결(누적 체결 계약 입력) · 알림 · 상태(PC만).
  // 체크는 남은 계약까지 완료, 체결 칸은 실제 누적 체결이며 계획보다 적으면 부분 체결(체크 '−')로 그 회차에 남는다.
  // 회차마다 한 줄: 체결한 회차의 손절 환율 칸은 실제 체결 환율(점선, 눌러서 그 자리에서 수정)이다. 반영한 월물은 '손절 완료' 띠에 모아 보이고,
  // 기록한 월물이 지금 보유에 없거나(월물교체 등) 보유에 반영하지 못한 회차만 환율 아래 작은 주황 줄을 둔다. 직접 반영함은 표시하지 않는다.
  // 완료 회차는 '손절 완료' 띠로 접는다(futureCutsOpen, 화면 상태). 재매수를 시작하면 체결 기록이 있는 회차만 보인다.
  const cutRecs=Array.isArray(r.cuts)?r.cuts:[],heldMonth=m=>futureHeld(f,m);
  const cutWarn=rec=>{if(!rec?.month)return rec&&!rec.manual?"보유 미반영":"";const gone=futureCutLegs(rec).map(l=>l.month).filter(m=>!heldMonth(m));return gone.length?`${esc(gone.join("·"))} 보유 없음`:"";};
  // 점선 환율(눌러서 그 자리에서 수정): attrs = 입력칸 data 속성, value = 기록한 값(빈 칸이면 글자 text만 보임)
  const tapPrice=(text,attrs,value,label)=>`<label class="future-tap-price" title="${label} 수정"><span class="price" aria-hidden="true">${text}</span><input ${attrs} type="number" min="0" step="any" inputmode="decimal" value="${value}" aria-label="${label}"></label>`;
  const cutAlerts=typeof futureRebuyAlertEnabled==="function",cutDone=s.cuts.filter(c=>c.done);
  const cutMonths=[...new Set(s.cuts.filter(c=>c.recorded).flatMap(c=>futureCutLegs(cutRecs[c.k-1]).map(l=>l.month)).filter(m=>m&&heldMonth(m)))].sort();
  const cutRows=(s.started?s.cuts.filter(c=>c.recorded):s.cuts).map(c=>{
    const i=c.k-1,rest=futureCutRest(c),due=!s.started&&rest>0&&cur>0&&cur<=c.price,state=c.done?"done":c.partial?"partial":due?"due":"",blocked=!c.recorded&&(s.started||!c.qty);
    const flag=c.partial?`남은 ${rest}`:due?"도달":"",rec=cutRecs[i],warn=c.recorded?cutWarn(rec):"";
    const price=c.recorded?`${tapPrice(cutPx(c.execPrice||c.price),`data-fcut-price="${i}"`,opt(c.execPrice),`${c.k}회 손절 체결 환율`)}${warn?`<span class="krw future-row-warn">${warn}</span>`:""}`:`<span class="price">${cutPx(c.price)}</span>`;
    return `<div class="purchase-row${state?` ${state}`:""}"><label class="check" title="남은 계약까지 손절 완료"><input type="checkbox" data-fcut="${i}"${c.done?" checked":""}${c.partial?' data-fcut-partial="true" aria-checked="mixed"':""}${blocked||c.partial&&s.started?" disabled":""} aria-label="${c.k}회 손절 완료"><span class="purchase-round"><b>${c.k}회</b>${flag?`<small>${flag}</small>`:""}</span></label>
      <div class="stage-price">${price}</div><div class="purchase-qty">${c.recorded?c.plannedQty:c.qty}계약</div><div class="purchase-fill"><input type="number" min="0" step="1" inputmode="numeric" data-fcut-qty="${i}" value="${c.recorded?c.qty:""}" placeholder="0"${blocked?" disabled":""} aria-label="${c.k}회 손절 누적 체결 계약 수"></div>${cutAlerts?`<div class="purchase-alert">${notify("cuts",i,`${c.k}회 손절`,c.done)}</div>`:""}
      <div class="status${state?` ${state}`:""}">${c.done?"손절 완료":c.partial?"부분 체결":due?"손절 시점":"대기"}</div></div>`;
  }).join("")||'<div class="empty">기준을 입력하면 손절 회차가 계산됩니다.</div>';
  // 반등 단계별 재매수 표도 분할 손절 표와 같다: 회차마다 한 줄(단계·회차 · 재매수 환율 · 계약 · 체결 · 알림 · 상태(PC만)).
  // 배분한(또는 산) 회차가 있는 단계만 표에 두고, 단계 첫 회차 줄의 환율(점선)이 그 단계 기준 환율이며 알림 스위치도 그 줄에 둔다.
  // 평균 손절 환율 위·추정 환율·계획 밖 회차는 흐린 '제외' 줄, 배정 0인 회차는 흐린 줄. 산 회차는 환율 칸이 체결 환율(점선)이고 체결 칸에서 계약 수를 고친다.
  // 반영 월물은 '재매수 완료' 띠에 모으고 보유에 없는 월물·미반영만 작은 주황 줄. 배분 없는 단계와 첫 회차를 산 단계의 기준 환율·알림은
  // 맨 아래 '다른 단계' 띠를 펼쳐 고친다(futureBuyStagesOpen). 완료 회차 접기(futureBuysOpen)와 함께 화면 상태라 저장·동기화하지 않는다.
  const buyAlerts=cutAlerts,buyDone=s.tranches.filter(x=>x.done),fillRec=x=>futureFillOf(f,x.i,x.t)?.[0];
  const buyMonths=[...new Set(buyDone.map(x=>fillRec(x)?.month).filter(m=>m&&heldMonth(m)))].sort();
  const stageName=i=>esc(futureRebuyStageText(s.stages[i])),basePx=i=>Number(s.stages[i].price)>0?px(s.stages[i].price):s.est[i]?`≈${px(s.est[i])}`:"기준가";
  const baseInput=i=>s.stages[i].rebuyEnd?`<span class="price">${basePx(i)}</span>`:tapPrice(basePx(i),`data-fbuy-price="${i}"`,opt(s.stages[i].price),`${stageName(i)} 기준 환율`);
  const stageAlert=(i,own)=>notify("buys",`stage:${i}`,movingLineText(`${s.stages[i].name} 재매수`),!s.active.includes(i)||own.length>0&&own.every(y=>y.done));
  const order=[...s.stageOrder,...s.stages.map((_,i)=>i).filter(i=>!s.stageOrder.includes(i))];
  const groups=order.map(i=>{const own=s.tranches.filter(y=>y.i===i);return {i,own,rows:[...own,...s.skipped.filter(y=>y.i===i).map(y=>({...y,skip:true}))].sort((a,b)=>a.t-b.t)};});
  const used=s.sold?groups.filter(g=>g.own.some(y=>y.done||y.amount>0)):[],others=groups.filter(g=>!used.includes(g)||g.rows[0]?.done);
  const buyRow=(g,y,k)=>{
    const i=g.i,due=!y.skip&&!y.done&&y.amount>0&&!y.est&&cur>0&&y.price>0&&cur>=y.price,nextUp=y===nextTr,dim=y.skip||!y.done&&!y.partial&&!y.amount,state=y.done?"done":y.partial?"partial":due?"due":"",bought=y.done||y.partial,rec=bought?fillRec(y):null,warn=rec?cutWarn(rec):"";
    const price=bought?`${tapPrice(px(y.execPrice||y.price),`data-fbuy-exec="${i}:${y.t}"`,opt(y.execPrice),`${trText(y)} 재매수 체결 환율`)}${warn?`<span class="krw future-row-warn">${warn}</span>`:""}`
      :k===0?baseInput(i):`<span class="price">${y.price>0?`${y.est?"≈":""}${px(y.price)}`:"—"}</span>`;
    const why=y.skip?y.est?"추정 환율이라 제외":s.endPrice&&y.price>=s.endPrice?"종료가격 범위 밖":!s.endPrice&&s.sellAvg&&y.price>s.sellAvg?"평균 손절 환율 위":"계획 밖":"";
    return `<div class="purchase-row${state?` ${state}`:""}${dim?" future-buy-dim":""}"${why?` title="${why}"`:""}><label class="check" title="재매수 완료"><input type="checkbox" data-fbuy="${i}:${y.t}"${y.done?" checked":""}${y.partial?' data-fbuy-partial="true" aria-checked="mixed"':""}${dim?" disabled":""} aria-label="${trText(y)} 재매수 완료"><span class="purchase-round"><b>${trName(y)}</b>${y.skip?'<small class="future-buy-skip">제외</small>':y.partial?`<small>남은 ${y.amount}</small>`:due?"<small>도달</small>":""}</span></label>
      <div class="stage-price">${price}</div><div class="purchase-qty">${dim?"—":`${y.done?y.qty:y.partial?y.qty+y.amount:y.amount}계약`}</div><div class="purchase-fill">${bought?`<input type="number" min="1" step="1" inputmode="numeric" data-fbuy-qty="${i}:${y.t}" value="${y.qty}" aria-label="${trText(y)} 재매수 계약 수">`:""}</div>${buyAlerts?`<div class="purchase-alert">${k===0?stageAlert(i,g.own):""}</div>`:""}
      <div class="status${state?` ${state}`:due||nextUp?" due":""}">${y.done?"재매수 완료":y.partial?"부분 체결":due?"재매수 시점":nextUp?"다음 신호":y.skip?"안 삼":dim?"배분 없음":"대기"}</div></div>`;
  };
  const otherRow=g=>`<div class="purchase-row future-buy-dim"><label class="check"><input type="checkbox" disabled aria-label="${stageName(g.i)} 배분 없음"><span class="purchase-round"><b><span class="tr-name">${stageName(g.i)}</span></b></span></label><div class="stage-price">${baseInput(g.i)}</div><div class="purchase-qty">—</div><div class="purchase-fill"></div>${buyAlerts?`<div class="purchase-alert">${stageAlert(g.i,g.own)}</div>`:""}<div class="status">${used.includes(g)?"진행 중":"배분 없음"}</div></div>`;
  const buyRows=used.map(g=>g.rows.map((y,k)=>buyRow(g,y,k)).join("")).join("")||`<div class="empty">${s.sold?"재매수할 회차가 없습니다.":"손절하면 판 계약만큼 재매수 회차를 나눕니다."}</div>`;
  // 제목 아래 기준 한 줄: 신저점 → 하단 · 이탈 전 계약 · 비중 · 실제 회차 수(손절 목표보다 많은 분할은 줄어듦) · 최소 유지(있을 때만)
  // 기준 입력은 제목 옆 연필(openFutureRebuyDialog). 현재 환율은 화면 맨 위 시세·보유 카드에 보이므로, 입력 칸은 보유 근월물 시세가 없을 때만 그 창에 둔다.
  // 하단선(floorLine)을 고르면 하단 자리에 선 이름과 시세로 채운 하단 환율을 보인다(시세 대기·신저점 이상이면 그 이유). 나중에 그 선 시세가 빠지면 마지막 값임을 주황 글자로 알린다.
  const floorLine=futureFloorLine(r.floorLine),floorWait=s.goal>0?futureFloorWait(r):null,floorPx=floorLine?`${esc(movingLineText(floorLine))} ${cutPx(r.floorPrice)}`:cutPx(r.floorPrice);
  const basis=s.ready?`<span class="quote-state">${cutPx(r.lowPrice)} → ${floorPx}</span>${futureFloorStale(f,r)?'<span class="future-floor-stale">시세 없음 · 마지막 값</span>':""}<span>이탈 전 ${s.hold}계약 · ${pctText}% · ${s.cuts.length}분할${s.hold>s.goal?` · 최소 ${s.hold-s.goal}계약 유지`:""}</span>`:`<span>${floorWait?.short||"기준 미입력"} · 이탈 전 ${s.hold}계약 · ${pctText}%</span>`;
  $("futureRebuyPanel").innerHTML=`<section class="future-rebuy"><div class="section-heading"><div class="title-row"><h2><button class="fr-fold-title" type="button" id="frToggle" aria-expanded="true">신저점 손절 후 재매수</button></h2><button class="btn icon-btn" id="frEdit" type="button" aria-label="손절 기준 수정" title="손절 기준 수정">${PENCIL}</button></div><span class="future-rebuy-basis">${basis}</span></div>
    ${futureRebuyTrack(r,s,cur,notify("breakdown",null,"신저점 손절 시작",s.started,"신저점 이탈"),trText)}
    ${s.rangeError?`<div class="warning">${esc(s.rangeError)}</div>`:""}${s.overSold||s.overBought?'<div class="warning">체결 기록이 손절 목표 또는 판 계약 수를 넘습니다. 실제 체결 수량을 확인하세요.</div>':""}${unText?`<div class="warning">${unText}이 보유 월물·누적 정산손익에 반영되지 않았습니다(연동 전 체크 또는 반영할 보유 월물이 없던 체크). 계좌 기준으로 이미 직접 고쳤다면 '직접 반영함'을 누르세요. <button class="btn mini" type="button" id="frLink">보유 월물에 반영</button> <button class="btn mini" type="button" id="frManual">직접 반영함</button></div>`:""}
    <details class="future-rebuy-details" id="frCuts"${futureTableOpen("cuts",cutKey)?" open":""}><summary><h2>1. 분할 손절</h2><span>${s.doneCuts} / ${s.cuts.length}회 완료</span>${all("cuts")}</summary><section class="card table-card purchase-table sale-table future-cut-table${futureCutsOpen?"":" hide-completed"}${cutAlerts?"":" no-alert"}" id="frCutTable"><div class="purchase-table-head"><span>회차</span><span>손절 환율</span><span>계약</span><span>체결</span>${cutAlerts?"<span>알림</span>":""}<span>상태</span></div>${cutDone.length?`<button class="completed-fold-bar" id="toggleFutureCuts" type="button" aria-expanded="${futureCutsOpen}" aria-controls="frCutRows"><span>손절 완료 <b>${cutDone.length}회 · ${cutDone.reduce((n,c)=>n+c.qty,0)}계약</b>${cutMonths.length?` · ${cutMonths.map(esc).join("·")} 반영`:""}</span><span class="completed-fold-action" data-completed-action>${futureCutsOpen?"접기":"펼치기"}</span></button>`:""}<div id="frCutRows">${cutRows}</div>${cutDone.length&&cutDone.length===s.cuts.length?'<div class="completed-fold-empty">모든 회차의 손절이 완료되었습니다.</div>':""}${s.started?'<div class="stop-note">재매수를 시작해 남은 손절 회차는 멈췄습니다.</div>':""}</section></details>
    <details class="future-rebuy-details" id="frBuys"${futureTableOpen("buys",buyKey)?" open":""}><summary><h2>2. 반등 단계별 재매수</h2><button class="btn icon-btn" id="frBuyEdit" type="button" aria-label="재매수 기준 수정" title="재매수 기준 수정">${PENCIL}</button><span>잔여 ${s.rest}계약 · ${s.doneTranches} / ${s.tranches.length}회</span>${all("buys")}</summary><section class="card table-card purchase-table sale-table future-rebuy-table${futureBuysOpen?"":" hide-completed"}${buyAlerts?"":" no-alert"}" id="frBuyTable"><div class="future-rebuy-start"><span>시작 기준선 <b>${esc(futureRebuyLineText(movingLineName(r.startLine)||movingLineName(s.stages[0]?.name)||"25선"))}</b></span>${s.endLine?`<span>종료 기준 <b>${esc(futureRebuyLineText(s.endLine))}</b> · ${s.waitingEnd?"시세 대기":px(s.endPrice)}</span>`:s.endPrice?`<span>종료가격 <b>${px(s.endPrice)}</b></span>`:""}<span>${s.waitingStart?"시작선 시세 대기":"이전 단계 미체결 제외"}</span></div><div class="purchase-table-head"><span>회차</span><span>재매수 환율</span><span>계약</span><span>체결</span>${buyAlerts?"<span>알림</span>":""}<span>상태</span></div>${buyDone.length?`<button class="completed-fold-bar" id="toggleFutureBuys" type="button" aria-expanded="${futureBuysOpen}" aria-controls="frBuyRows"><span>재매수 완료 <b>${buyDone.length}회 · ${buyDone.reduce((n,x)=>n+x.qty,0)}계약</b>${buyMonths.length?` · ${buyMonths.map(esc).join("·")} 반영`:""}</span><span class="completed-fold-action" data-completed-action>${futureBuysOpen?"접기":"펼치기"}</span></button>`:""}<div id="frBuyRows">${buyRows}</div>${buyDone.length&&!s.rest&&s.tranches.every(x=>x.done||!x.amount)?'<div class="completed-fold-empty">판 계약을 모두 재매수했습니다.</div>':""}${others.length?`<button class="completed-fold-bar future-stage-bar" id="toggleFutureStages" type="button" aria-expanded="${futureBuyStagesOpen}" aria-controls="frStageRows"><span>다른 단계 <b>${others.length}개</b> · 기준 환율${buyAlerts?"·알림":""}</span><span class="completed-fold-action" data-completed-action>${futureBuyStagesOpen?"접기":"펼치기"}</span></button><div id="frStageRows"${futureBuyStagesOpen?"":" hidden"}>${others.map(otherRow).join("")}</div>`:""}<div class="future-rebuy-foot"><button class="btn mini ghost" id="frTimeframes" type="button">＋ 시·일·주·월선 추가</button></div></section></details></section>`;
  if(typeof bindFutureRebuyAlerts==="function")bindFutureRebuyAlerts(f);
  $("frTimeframes").onclick=()=>{const r=editFutureRebuy(f),stages=completeMovingStages(r.stages);if(stages.length>80){alert("재매수 단계는 80개까지 설정할 수 있습니다.");return;}r.stages=stages;if(priceData)fillPrices({futures:f},priceData);save();renderFutures();};

  $("frToggle").onclick=()=>{futureRebuyExpanded=false;renderFutures();};
  bindFutureTable("cuts",$("frCuts"),cutKey);bindFutureTable("buys",$("frBuys"),buyKey);
  for(const id of ["frCuts","frBuys"])$(id).querySelector("summary").addEventListener("click",e=>{if(e.target.closest("button"))e.preventDefault();}); // 제목 줄의 알림 버튼은 표를 접지 않는다
  const buyFold=$("toggleFutureBuys");if(buyFold)buyFold.onclick=()=>{futureBuysOpen=!futureBuysOpen;$("frBuyTable").classList.toggle("hide-completed",!futureBuysOpen);buyFold.setAttribute("aria-expanded",String(futureBuysOpen));buyFold.querySelector("[data-completed-action]").textContent=futureBuysOpen?"접기":"펼치기";};
  const stageFold=$("toggleFutureStages");if(stageFold)stageFold.onclick=()=>{futureBuyStagesOpen=!futureBuyStagesOpen;$("frStageRows").hidden=!futureBuyStagesOpen;stageFold.setAttribute("aria-expanded",String(futureBuyStagesOpen));stageFold.querySelector("[data-completed-action]").textContent=futureBuyStagesOpen?"접기":"펼치기";};
  const cutFold=$("toggleFutureCuts");if(cutFold)cutFold.onclick=()=>{futureCutsOpen=!futureCutsOpen;$("frCutTable").classList.toggle("hide-completed",!futureCutsOpen);cutFold.setAttribute("aria-expanded",String(futureCutsOpen));cutFold.querySelector("[data-completed-action]").textContent=futureCutsOpen?"접기":"펼치기";};
  $("frEdit").onclick=openFutureRebuyDialog;$("frBuyEdit").onclick=openFutureRebuyStartDialog;
  // 판 계약을 되돌릴 때(체크 해제·체결 칸 줄임) 되돌릴 월물(마지막에 판 월물부터, futureCutBack) 확인: false = 그 월물로 되돌림,
  // true = 보유에 없는 월물은 두고 기록·누적 정산손익만(unlinkFutureCut 주석), null = 취소.
  // 월물이 모두 보유에 있으면 해제만 묻는다. 없는 월물이 있으면 손절로 모두 판 월물인지(되살림) 월물교체인지(보유는 직접 수정) 차례로 묻는다.
  const cutBack=(i,qty)=>{
    const rec=futureRebuyOf(f).cuts?.[i],back=futureRebuyQty(rec?.contracts)-qty;if(!rec?.month||back<=0)return false;
    const legs=futureCutBack(rec,back),sell=Number(rec.price)||Number(rec.targetPrice),pnl=money(Math.round(legs.reduce((n,l)=>n+(sell-l.settlementPrice)*l.contracts,0)*contractSize));
    const list=legs.map(l=>`${l.month} ${l.contracts}계약(단순평균가 ${fmtPrice(l.settlementPrice)}원)`).join(", "),gone=legs.filter(l=>!heldMonth(l.month)).map(l=>l.month).join("·");
    if(!gone)return qty>0||confirm(`${list}을 보유분에 되돌리고 누적 정산손익에서 이 손절 손익 ${pnl}을 뺄까요?\n그 사이 보유 월물·누적 정산손익을 직접 고쳤다면 되돌린 뒤 값을 확인하세요.`)?false:null;
    if(confirm(`${gone} 월물이 지금 보유에 없습니다.\n손절로 이 월물을 모두 팔았다면 확인을 누르세요. ${list}을 보유에 되돌리고(없는 월물은 다시 만들고) 누적 정산손익에서 이 손절 손익 ${pnl}을 뺍니다.`))return false;
    return confirm(`월물을 교체했다면 확인을 누르세요. 보유에 없는 ${gone}은 그대로 두고 손절 기록과 누적 정산손익(이 손절 손익 ${pnl}을 뺌)만 고칩니다.\n교체한 월물의 계약 수·단순평균가는 계좌를 보고 직접 고치세요.`)?true:null;
  };
  const cutFail="계약 수는 0 이상 정수로, 손절 목표와 재매수 기록 사이에서 입력하세요. 재매수 시작 후에는 새 손절을 기록할 수 없고, 보유 월물에 더 뺄 계약이 없으면 늘릴 수 없습니다.";
  const cutUnlinked="판 계약 수만큼 남은 보유 월물(단순평균가 포함)이 없어 손절 기록만 했습니다. 보유 월물을 확인한 뒤 '보유 월물에 반영'을 누르세요.";
  $$("[data-fcut-partial],[data-fbuy-partial]").forEach(input=>{input.indeterminate=true;});
  $$("[data-fcut]").forEach(input=>input.onchange=()=>{const i=Number(input.dataset.fcut),detach=input.checked?false:cutBack(i,0);
    if(detach===null){renderFutures();return;}
    const done=setFutureCutChecked(f,i,input.checked,detach);
    if(done===false)alert(cutFail);else{save();if(done==="unlinked")alert(cutUnlinked);}
    renderFutures();});
  onEdit("[data-fcut-qty]",(v,el)=>{const i=Number(el.dataset.fcutQty),t=v.trim(),qty=t===""?0:Number(t);
    if(!Number.isInteger(qty)||qty<0){alert(cutFail);return false;}
    const detach=cutBack(i,qty);if(detach===null)return false;
    const done=setFutureCutCount(f,i,t,detach);if(done===false){alert(cutFail);return false;}if(done==="unlinked")alert(cutUnlinked);},renderFutures);
  onEdit("[data-fcut-price]",(v,el)=>setFutureCutPrice(f,Number(el.dataset.fcutPrice),v),renderFutures);
  const trKey=v=>String(v).split(":").map(Number);
  $$("[data-fbuy]").forEach(input=>input.onchange=()=>{const [i,t]=trKey(input.dataset.fbuy),fill=futureFillOf(f,i,t),rec=fill?.[0];let detach=false;
    if(!input.checked&&rec?.month){const qty=futureRebuyQty(rec.contracts),month=futureHeldMonth(f,qty,rec.month);
      if(month?!confirm(`${month} 보유분에서 재매수 ${qty}계약(체결 환율 ${fmtPrice(rec[fill[1]])}원)을 빼고 단순평균가를 되돌릴까요?\n그 사이 이 월물의 단순평균가를 직접 고쳤다면, 되돌린 뒤 값을 확인하세요.`):!(detach=confirm(`보유 월물에 재매수 ${qty}계약을 뺄 ${rec.month}이(가) 없습니다(교체·삭제된 것으로 보입니다).\n체크만 해제하고 보유 월물은 직접 고칠까요?`))){renderFutures();return;}}
    const done=setFutureBuyChecked(f,i,t,input.checked,detach);
    if(done===false)alert("손절한 계약과 배분된 재매수 수량·환율을 먼저 확인하세요. 판 계약 수를 넘겨 재매수할 수 없습니다.");
    else{save();if(done==="unlinked")alert("보유 월물이 없어 재매수 기록만 했습니다. 보유 월물을 입력한 뒤 '보유 월물에 반영'을 누르세요.");}
    renderFutures();});
  onEdit("[data-fbuy-qty]",(v,el)=>{if(setFutureBuyCount(f,...trKey(el.dataset.fbuyQty),v)===false){alert("계약 수는 1 이상 정수로, 판 계약 수 안에서 입력하세요. 보유 월물에서 뺄 계약이 없으면 줄일 수 없습니다.");return false;}},renderFutures);
  onEdit("[data-fbuy-price]",(v,el)=>{const n=v.trim()===""?0:Number(v);if(!Number.isFinite(n)||n<0)return false;editFutureRebuy(f).stages[Number(el.dataset.fbuyPrice)].price=n;},renderFutures);
  onEdit("[data-fbuy-exec]",(v,el)=>setFutureBuyExec(f,...trKey(el.dataset.fbuyExec),v),renderFutures);
  if($("frLink"))$("frLink").onclick=()=>{const g=futureRebuyLinked(f),held=x=>x.positions.reduce((n,p)=>n+(Number(p.contracts)||0),0);
    if(!g){alert("반영할 보유 월물 계약이 부족하거나 단순평균가·체결 환율이 없습니다. 보유 월물과 체결 기록을 확인하세요.");return;}
    if(!confirm(`보유 ${held(f)}계약 → ${held(g)}계약, 누적 정산손익 ${money(Number(f.baselinePnl)||0)} → ${money(g.baselinePnl)}으로 고칩니다.\n계좌 기준으로 이미 직접 고쳤다면 취소하고 '직접 반영함'을 누르세요.`))return;
    f.positions=g.positions;f.baselinePnl=g.baselinePnl;f.rebuy=g.rebuy;save();renderFutures();};
  if($("frManual"))$("frManual").onclick=()=>{if(!confirm(`${unText}을 계좌 기준으로 직접 고친 것으로 표시하고 이 안내를 닫을까요?\n보유 월물·누적 정산손익은 바꾸지 않습니다.`))return;markFutureRebuyManual(f);save();renderFutures();};
}
