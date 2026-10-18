// 종목 표시 이름(화면·알림 글자 전용). 종목 코드는 기록 식별·알림 규칙·이동에 그대로 쓰고, 이 파일은 기록을 바꾸거나 새 필드를 만들지 않는다.
// 플래너 화면과 알림 서비스 워커(push-sw.js)가 함께 불러온다. 페이지 함수(lookup·planName·alertMap·remember)는 부를 때만 state·assetStore를 읽는다.
// 이름을 찾지 못하면 종목 코드를 보인다. 같은 이름이 다른 코드에도 쓰이면 이름 옆에 코드를 함께 보인다.
const stockNames = (()=>{
const text = v => typeof v==="string"||typeof v==="number" ? String(v).trim() : "";
// assets-calc.js linkTicker와 같은 규칙(서비스 워커는 assets-calc.js를 불러오지 않는다): 대문자·국내 'A' 접두 무시·'비트코인'=BTC-USD.
const code = t => { const s=text(t).toUpperCase(); return s==="비트코인"?"BTC-USD":s.replace(/^A(\d[0-9A-Z]{5})$/,"$1"); };
const nameKey = name => text(name).normalize("NFKC").toLowerCase().replace(/\s+/g," ");
const obj = v => !!v&&typeof v==="object"&&!Array.isArray(v);
// 이동평균선 이름 글자: ma-ladder.js movingLineText와 같은 규칙(서비스 워커는 ma-ladder.js를 불러오지 않는다). 받은 알림·기록의 'N개월선'은 그대로 두고 보일 때만 'N월선'.
const lineText = v => String(v??"").replace(/(\d)\s*개월선/g,"$1월선");
const allocItems = () => { const groups=typeof assetStore==="object"?assetStore.doc?.allocation?.groups:null;
  return (Array.isArray(groups)?groups:[]).flatMap(g=>obj(g)&&Array.isArray(g.items)?g.items.filter(obj):[]); };
const planList = () => typeof state==="object"&&Array.isArray(state?.plans)?state.plans.filter(obj):[];
const rebuyList = () => typeof rebuyItems==="function"&&typeof state==="object"?rebuyItems(state):[];
// 종목 코드 → 이름(못 찾으면 ""). 자산 배분에서 그 코드를 실제로 거래하는 종목(실제 거래 코드, 없으면 기준 코드) → 재매수 종목 이름 → 분할매도 계획 이름 순.
// 기준 코드만 같은 추종 ETF는 다른 종목이므로 그 이름을 쓰지 않는다.
function lookup(ticker){
  const c=code(ticker);if(!c)return "";
  const it=allocItems().find(it=>code(text(it.tradeTicker)||it.ticker)===c&&text(it.name));if(it)return text(it.name);
  const r=rebuyList().find(r=>code(r.ticker)===c&&text(r.name));if(r)return text(r.name);
  const p=planList().find(p=>code(p.ticker)===c&&text(p.title));return p?text(p.title):"";
}
// 분할매도 카드 이름이 없을 때 보일 이름: 계획 이름(자산 배분에서 고르면 종목 이름) → 같은 코드의 종목 이름 → 종목 코드.
const planName = p => text(p?.title)||lookup(p?.ticker)||text(p?.ticker);
// 분할매도·분할매수 화면 제목: 이름 끝 괄호(예: '(연저펀)')를 {main,tag}로 나눠 꼬리표로 보인다. 화면 글자만 바꾸고 저장한 이름은 그대로 둔다.
// 괄호 안 1~12자·중첩 없음·앞 이름이 있을 때만 나눈다. 환헤지·합성 표기 (H)·(합성)·(합성 H)는 종목 이름이므로 나누지 않는다.
const TITLE_TAG = /^(.*\S)\s*[(（]([^()（）]{1,12})[)）]$/, NAME_MARK = /^(합성\s*)?H$|^합성$/i;
function titleParts(name){ const s=text(name),m=TITLE_TAG.exec(s),tag=m?m[2].trim():""; return tag&&!NAME_MARK.test(tag)?{main:m[1],tag}:{main:s,tag:""}; }
// 목록 카드: rows=[{name,code}] 중 같은 이름이 다른 코드에도 있으면 true를 돌려주는 판정(모바일은 코드 줄을 숨기므로 이름 옆에 코드를 붙인다).
function clashes(rows){
  const seen=new Map();
  for(const r of rows){const k=nameKey(r.name),c=code(r.code);if(!k||!c)continue;if(!seen.has(k))seen.set(k,new Set());seen.get(k).add(c);}
  return name=>(seen.get(nameKey(name))?.size||0)>1;
}
// 알림 서비스 워커가 읽을 이름표 {rules: {규칙 ID 앞부분: [이름, 코드]}, codes: {코드: 이름}}.
// 규칙 ID 앞부분은 trade-alerts.js·assets-calc.js 규칙 ID, 수집 저장소 webpush_alerts.py alert_history_names와 같다.
// 금액·수량·메모·토큰·구독은 넣지 않으며 이 기기 IndexedDB에만 둔다.
function alertMap(){
  const rules={},codes={},put=(prefix,name,c)=>{name=text(name);if(name)rules[prefix]=[name.slice(0,200),code(c)];};
  for(const p of planList())if(text(p.id))put(`trade:plan:${text(p.id)}:`,text(p.cardName)||planName(p),p.ticker);
  rebuyList().forEach((r,i)=>put(`trade:rebuy:${text(r.id)||`legacy-${i}`}:`,text(r.name)||lookup(r.ticker),r.ticker));
  const items=allocItems();
  for(const it of items)if(obj(it.buyPlan)&&text(it.id))put(`trade:buy:${text(it.id)}:`,it.name,text(it.tradeTicker)||it.ticker);
  const lines=typeof alertRules==="function"?alertRules():[]; // 직접 추가한 기준선 알림(alerts.js)
  for(const t of [...planList().map(p=>p.ticker),...rebuyList().map(r=>r.ticker),...items.flatMap(it=>[it.ticker,it.tradeTicker]),...lines.map(r=>r.ticker)]){
    const c=code(t);if(c&&!(c in codes)){const name=lookup(c);if(name)codes[c]=name.slice(0,200);}
  }
  return {rules,codes};
}
// 같은 이름을 쓰는 서로 다른 코드가 이름표에 둘 이상이면 이름만으로 구분하기 어렵다.
function ambiguous(map,name){
  const k=nameKey(name),found=new Set();if(!k)return false;
  for(const value of Object.values(obj(map?.rules)?map.rules:{}))if(Array.isArray(value)&&nameKey(value[0])===k&&text(value[1]))found.add(text(value[1]));
  for(const [c,value] of Object.entries(obj(map?.codes)?map.codes:{}))if(nameKey(value)===k)found.add(c);
  return found.size>1;
}
// 알림 종류: 규칙 ID로, 없거나 모르는 ID(직접 추가 기준선)는 옛 알림처럼 기준선 글자로 정한다(push.js pushAlertTab과 같은 구분).
function alertKind(data){
  const rule=text(data?.ruleId),line=text(data?.line),has=p=>rule.startsWith(p);
  const menu=has("trade:plan:")?"분할매도":has("trade:buy:")?"분할매수":has("trade:rebuy:")?"재매수":has("trade:future:")||has("trade:future-rebuy:")?"달러선물":
    line.startsWith("분할매도 ")?"분할매도":line.startsWith("분할매수 ")||line.startsWith("매수대기 ")?"분할매수":line.startsWith("재매수 ")?"재매수":line.startsWith("달러선물 ")?"달러선물":"이동평균선";
  const detail=menu==="분할매수"&&line.startsWith("매수대기 ")?"매수대기":menu==="재매수"&&/손절|신저점 이탈/.test(line)?"손절":
    menu==="달러선물"?/손절/.test(line)?"손절":/재매수/.test(line)?"재매수":"매수":"";
  return {menu,detail,text:detail?`${menu} · ${detail}`:menu};
}
// 알림의 종목 이름: 발송 때 이름(코드와 다를 때) → 이 기기 이름표의 규칙 ID → 종목 코드 → 코드 그대로.
// 분할매도는 카드 이름이 있을 때만 발송 이름이 오고, 직접 추가 기준선은 코드만 온다.
function alertName(data,map){
  const ticker=text(data?.ticker).toUpperCase(),sent=text(data?.name),rule=text(data?.ruleId);
  if(sent&&sent.toUpperCase()!==ticker)return sent;
  for(const [prefix,value] of Object.entries(rule&&obj(map?.rules)?map.rules:{}))if(rule.startsWith(prefix)&&Array.isArray(value)&&text(value[0]))return text(value[0]);
  return text(obj(map?.codes)?map.codes[code(ticker)]:"")||ticker;
}
// 알림 제목에 붙일 대상: 달러선물은 월물, 그 밖은 종목 이름(구분이 어려우면 '이름 (코드)').
function alertSubject(data,map){
  const ticker=text(data?.ticker).toUpperCase();
  if(alertKind(data).menu==="달러선물"&&/^\d{4}(0[1-9]|1[0-2])$/.test(ticker))return `${ticker.slice(0,4)}.${ticker.slice(4)}월물`;
  const name=alertName(data,map);
  return name!==ticker&&ambiguous(map,name)?`${name} (${ticker})`:name;
}
// 발송 제목(수집 저장소 webpush_alerts.py event_payload) → 종류 뒤에 붙일 말. 모르는 제목이면 발송 글자를 그대로 보인다.
const NOTICE_WORDS = {"":"알림","매매 기준 알림":"알림","이동평균선 알림":"알림","매매 기준 재알림":"재알림","한국장 재알림":"한국장 재알림"};
// 휴대폰·PC 알림 글자: 제목 '종류 알림 · 종목 이름', 본문은 발송 본문 앞의 종목 코드만 뺀다(기준선·조건·가격·재알림 정보는 그대로).
function notice(data,map){
  const clip=(v,max)=>typeof v==="string"?v.slice(0,max):"";
  const title=clip(data?.title,100),body=clip(data?.body,400),raw=typeof data?.ticker==="string"?data.ticker:"";
  const plain={title:lineText(title)||"매매 플래너 알림",body:lineText(body)||"설정한 기준선 알림을 확인해 주세요."};
  if(!text(raw)||!Object.hasOwn(NOTICE_WORDS,title))return plain;
  const rest=raw&&body.startsWith(`${raw} `)?body.slice(raw.length+1):body;
  return {title:`${alertKind(data).menu} ${NOTICE_WORDS[title]} · ${alertSubject(data,map)}`.slice(0,100),body:lineText(rest)||plain.body};
}
// 이름표 저장소: 알림 수신함과 따로 둔다(수신함 DB 버전을 올리지 않는다). 실패하면 이름표 없이 발송 글자로 보인다.
const DB_NAME="etf-planner-stock-names",STORE="names",KEY="alerts";
function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error("blocked"));
  });
}
async function use(mode,action){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);let result=null;action(tx.objectStore(STORE),v=>result=v);tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error);});}
  finally{db.close();}
}
// 서비스 워커: 늦어져도 알림 표시를 막지 않게 wait ms 뒤에는 이름표 없이 진행한다.
function recall(wait=1500){
  if(typeof indexedDB==="undefined")return Promise.resolve(null);
  const read=use("readonly",(store,done)=>{const request=store.get(KEY);request.onsuccess=()=>done(obj(request.result)?request.result:null);}).catch(()=>null);
  return Promise.race([read,new Promise(done=>setTimeout(()=>done(null),wait))]);
}
// 페이지: 기록·자산이 바뀌면 잠시 뒤 이름표를 다시 만들고 달라졌을 때만 저장한다.
let lastSaved="",timer=0;
function remember(){
  if(typeof indexedDB==="undefined"||typeof state!=="object")return;
  clearTimeout(timer);
  timer=setTimeout(()=>{
    timer=0;let map;try{map=alertMap();}catch{return;}
    const json=JSON.stringify(map);if(json===lastSaved)return;lastSaved=json;
    use("readwrite",store=>store.put(map,KEY)).catch(()=>{lastSaved="";});
  },400);
}
return {code,lineText,lookup,planName,titleParts,clashes,alertMap,ambiguous,alertKind,alertName,alertSubject,notice,recall,remember};
})();
