// 화면 없는 분할 미리보기·선택 적용·이력. 저장·시각·id 생성은 호출부가 맡는다.
const {splitPreview, applySplit, appendSplitLog} = (()=>{
  const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
  const list=v=>Array.isArray(v)?v:[];
  const entries=v=>object(v)?Object.entries(v):[];
  const copy=v=>Array.isArray(v)?v.map(copy):object(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])):v;
  const code=v=>String(v??"").trim().toUpperCase();
  const reference=v=>typeof planTicker==="function"?planTicker(v):code(v)==="비트코인"?"BTC-USD":code(v);
  const actual=it=>typeof assetTradeTicker==="function"?assetTradeTicker(it):code(it?.tradeTicker||it?.ticker);
  const excluded=t=>["BTC-USD","KS200"].includes(reference(t));
  const number=v=>(typeof v==="number"||typeof v==="string"&&v.trim()!=="")&&Number.isFinite(Number(v))&&Math.abs(Number(v))<=Number.MAX_SAFE_INTEGER?Number(v):null;
  const round=(v,d)=>Number(v.toFixed(d));
  const day=v=>typeof v==="string"&&/^(?!0000)\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  const stamp=v=>typeof v==="string"&&v.length<=40&&day(v.slice(0,10))&&/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)&&Number.isFinite(Date.parse(v));
  function options(value){
    if(!object(value)||typeof value.ticker!=="string")throw Error("분할 종목을 확인하세요.");
    const ticker=reference(value.ticker),{from,to,exDate}=value;
    if(!/^[A-Z0-9][A-Z0-9.\/-]{0,31}$/.test(ticker)||![from,to].every(n=>Number.isInteger(n)&&n>=1&&n<=1000)||from===to||!day(exDate))throw Error("분할 비율·기준일을 확인하세요.");
    return {ticker,from,to,exDate};
  }
  function autoName(name){
    if(typeof autoMark==="function")return autoMark(name);
    const text=String(name),m=/(\d{1,3})\s*(일|주|개월|월|달)\s*선/.exec(text),h=/^\s*([1-9]\d{0,2})\s*(?:선|시선|분봉)\s*$/.exec(text);
    return m&&Number(m[1])>=1?`${Number(m[1])}${{일:"일선",주:"주선",개월:"개월선",월:"개월선",달:"개월선"}[m[2]]}`:h?`${Number(h[1])}선`:text;
  }
  const autoValue=(obj,key,value)=>object(obj?.auto)&&Object.hasOwn(obj.auto,key)&&number(value)!==null&&number(obj.auto[key])===number(value);
  const bucket=(document,group,id,label,path)=>({document,group,id:String(id??JSON.stringify(path)),key:JSON.stringify([document,...path]),label:String(label||group),changes:[],trades:[],skipped:[]});

  // from주→to주: 가격 ×from/to(4자리), 수량 ×to/from(6자리). 금액·비율·환율·계약·날짜·auto는 순회하지 않는다.
  // path는 각 원본 문서부터의 키 배열이다. 없는 칸·null·빈 문자열은 만들지 않고, 수치가 실제 바뀐 칸만 숫자로 저장한다.
  // plans의 바깥 fill·sourcePrice/referencePrice/sourceQty는 기준 ETF, execution.price/qty는 고정된 실제 ETF 단위다.
  // group execution의 qty/plannedQty는 여러 실제 ETF 행의 합: 해당 종목 행의 증감만 합계에 더한다. 한 회차를 하나의 체결 선택으로 취급한다.
  // allocation.base는 금액 입력 시점의 원화 환산 1주 가격이고 amount는 만원 금액이다. base만 실제 ETF 기준으로 보정한다.
  // 분할매수 price/lines.end/sourceShares·미체결 직접 입력 shares는 기준 ETF, 체결 shares/plannedShares/tradePrice는 당시 실제 ETF 기준이다.
  // 반영 내역 exact는 shares가 있는 행에서만 수량이다. amount만 있는 행의 exact는 금액이므로 그대로 둔다.
  // 자동값은 기록된 auto 값과 현재 숫자가 같은 칸만 건너뛴다(startPrice는 startAuto=true일 때만). 수동 덮어쓰기는 보정한다.
  // 반환 {ticker,from,to,exDate,items,duplicate,excluded}. 같은 종목·exDate 이력은 경고만 하며 입력·이력을 만들거나 바꾸지 않는다.
  function preview(plannerData, assetsDoc, input){
    if(!object(plannerData)||assetsDoc!=null&&!object(assetsDoc))throw Error("기록 형식을 확인하세요.");
    const opt=options(input),items=[],match=t=>!!reference(t)&&!excluded(t)&&reference(t)===opt.ticker;
    const out={...opt,items,duplicate:list(plannerData.splitLog).some(r=>reference(r?.ticker)===opt.ticker&&r.exDate===opt.exDate),excluded:excluded(opt.ticker)};
    if(out.excluded)return out;
    const alloc=assetsDoc?.allocation,assetItems=list(alloc?.groups).flatMap(g=>list(g?.items)),assetById=new Map(assetItems.filter(object).map(it=>[it.id,it]));
    const rebuys=Array.isArray(plannerData.rebuy?.items)?plannerData.rebuy.items:object(plannerData.rebuy)?[plannerData.rebuy]:[];
    const skip=(item,path,reason)=>item.skipped.push({path:[...path],reason});
    function change(item,target,obj,path,key,kind,basis,{automatic=false,after}={}){
      if(!object(obj)&&!Array.isArray(obj)||!Object.hasOwn(obj,key))return;
      const before=obj[key];if(before===null||before===undefined||typeof before==="string"&&!before.trim())return;
      const full=[...path,key];
      if(!basis){skip(item,full,"종목 연결 확인 불가");return;}
      if(!match(basis))return;
      if(automatic){skip(item,full,"시세 자동 채움");return;}
      const n=number(before);if(n===null){skip(item,full,"숫자 형식 확인 필요");return;}
      const value=after===undefined?n*(kind==="price"?opt.from/opt.to:opt.to/opt.from):after;
      if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error("분할 결과가 숫자 범위를 벗어납니다.");
      const next=round(value,kind==="price"?4:6);
      if(next!==n)target.push({path:full,kind,before,after:next});
    }
    function fields(item,target,obj,path,prices,quantities,basis){
      for(const key of prices)change(item,target,obj,path,key,"price",basis);
      for(const key of quantities)change(item,target,obj,path,key,"qty",basis);
    }
    function trade(item,key,label,visit){
      const t={key,label:String(label),changes:[]};visit(t.changes);if(t.changes.length)item.trades.push(t);
    }
    const add=item=>{if(item.changes.length||item.trades.length||item.skipped.length)items.push(item);};
    const resolvedExecution=e=>reference(e?.ticker)||(e?.targetId?actual(assetById.get(e.targetId)):"");
    function execution(item,target,e,path,basis){
      if(!object(e))return;
      fields(item,target,e,path,["sourcePrice","referencePrice"],["sourceQty"],basis);
      if(e.group===true&&Array.isArray(e.rows)){
        for(const [i,row] of e.rows.entries())fields(item,target,row,[...path,"rows",i],["price","execPrice"],["qty","plannedQty","shares","plannedShares"],resolvedExecution(row));
        for(const key of ["qty","plannedQty"]){
          const n=number(e[key]);if(n===null)continue;
          const delta=e.rows.reduce((sum,row)=>{
            const v=number(row?.[key]);return sum+(match(resolvedExecution(row))&&v!==null?round(v*opt.to/opt.from,6)-v:0);
          },0);
          if(delta)change(item,target,e,path,key,"qty",opt.ticker,{after:n+delta});
        }
      }else fields(item,target,e,path,["price","execPrice"],["qty","plannedQty","shares","plannedShares"],resolvedExecution(e));
    }
    for(const [i,p] of list(plannerData.plans).entries()){
      if(!object(p))continue;
      const path=["plans",i],basis=reference(p.ticker),item=bucket("planner","plans",p.id,p.title||"분할매도",path);
      for(const key of ["startPrice","endPrice"]){
        change(item,item.changes,p,path,key,"price",basis,{automatic:(key!=="startPrice"||p.startAuto===true)&&autoValue(p,key,p[key])});
      }
      fields(item,item.changes,p,path,["valueBase","basisPrice","currentPrice"],[],basis);
      fields(item,item.changes,p.fullSell,[...path,"fullSell"],["price"],[],basis);
      for(const [j,h] of list(p.holdings).entries())fields(item,item.changes,h,[...path,"holdings",j],[],["shares"],basis);
      for(const [key,f] of entries(p.fills))trade(item,`sell:${p.id??`#${i}`}:${key}`,`${Number(key)+1}회 매도`,target=>{
        const fp=[...path,"fills",key];
        fields(item,target,f,fp,["price","execPrice"],["qty","plannedQty","shares","plannedShares"],basis);
        execution(item,target,f?.execution,[...fp,"execution"],basis);
      });
      add(item);
    }
    for(const [i,r] of rebuys.entries()){
      if(!object(r))continue;
      const path=Array.isArray(plannerData.rebuy?.items)?["rebuy","items",i]:["rebuy"],basis=reference(r.ticker),item=bucket("planner","rebuy",r.id,r.name||"재매수",path);
      fields(item,item.changes,r,path,["lowPrice","finalPrice","endPrice"],["shares"],basis);
      for(const key of ["currentPrice","floorPrice"])change(item,item.changes,r,path,key,"price",basis,{automatic:autoValue(r,key,r[key])});
      for(const [j,c] of list(r.cuts).entries())trade(item,`cut:${r.id??`#${i}`}:${j}`,`손절 ${j+1}회`,target=>fields(item,target,c,[...path,"cuts",j],["price","execPrice"],["shares","plannedShares","qty","plannedQty"],basis));
      for(const [j,s] of list(r.stages).entries()){
        if(!object(s))continue;
        const sp=[...path,"stages",j];
        change(item,item.changes,s,sp,"price","price",basis,{automatic:autoValue(r,autoName(s.name),s.price)});
        for(const k of list(s.prices).keys())change(item,item.changes,s.prices,[...sp,"prices"],k,"price",basis);
        trade(item,`rebuy:${r.id??`#${i}`}:${s.name}:0`,`${s.name||j+1} 옛 체결`,target=>fields(item,target,s,sp,["execPrice"],["shares","plannedShares","qty","plannedQty"],basis));
        for(const [k,b] of list(s.buys).entries())trade(item,`rebuy:${r.id??`#${i}`}:${s.name}:${k}`,`${s.name||j+1} ${k+1}차`,target=>fields(item,target,b,[...sp,"buys",k],["price","execPrice"],["shares","plannedShares","qty","plannedQty"],basis));
      }
      add(item);
    }
    // 당시 tradeTicker가 있으면 현재 연결보다 우선한다. 삭제된 명시적 반영 계좌는 현재 종목으로 추정하지 않는다.
    function buyTicker(it,b,key){
      if(reference(b?.tradeTicker))return reference(b.tradeTicker);
      if(b?.tradeTargetId)return actual(assetById.get(b.tradeTargetId));
      const rows=list(alloc?.trades?.[key]?.items),tickers=new Set(rows.map(r=>actual(assetById.get(r?.id))));
      if(rows.length)return tickers.size===1?[...tickers][0]:"";
      return actual(it);
    }
    for(const [g,group] of list(alloc?.groups).entries())for(const [i,it] of list(group?.items).entries()){
      if(!object(it))continue;
      const path=["allocation","groups",g,"items",i],basis=reference(it.ticker),item=bucket("assets","allocation",it.id,it.name||"자산",path),bp=it.buyPlan;
      fields(item,item.changes,it,path,["averagePrice","base"],["shares"],actual(it));
      fields(item,item.changes,it,path,["tradePrice"],[],reference(it.tradeTicker));
      fields(item,item.changes,bp?.lines,[...path,"buyPlan","lines"],["end"],[],basis);
      function buy(b,key,where,recorded){
        if(!object(b))return;
        const target=recorded?[]:item.changes,bt=recorded?buyTicker(it,b,key):basis;
        const visit=changes=>{
          fields(item,changes,b,where,["price","execPrice"],["sourceShares"],basis);
          fields(item,changes,b,where,[],["shares","plannedShares","qty","plannedQty"],bt);
          fields(item,changes,b,where,["tradePrice"],[],buyTicker(it,b,key));
        };
        if(recorded)trade(item,key,"분할매수 체결",visit);else visit(target);
      }
      for(const [j,s] of list(bp?.stages).entries())buy(s,`buy:${it.id}:`+(s?.id||`#${j}`),[...path,"buyPlan","stages",j],!!(s?.done||s?.partial||Object.hasOwn(s||{},"plannedShares")||Object.hasOwn(s||{},"sourceShares")));
      for(const [key,b] of entries(bp?.buys))buy(b,`buy:${it.id}:${key}`,[...path,"buyPlan","buys",key],true);
      add(item);
    }
    // 반영 기록의 바깥 price/qty는 출처 체결 단위, items[].shares/exact는 연결 자산의 실제 ETF 단위다.
    // 출처를 잃은 기록은 명시 ticker 또는 converted 없는 동일 종목 연결만 사용한다. 불명확한 칸은 skipped로 남긴다.
    function source(key,rec){
      for(const p of list(plannerData.plans).filter(p=>p?.id).sort((a,b)=>String(b.id).length-String(a.id).length))if(key.startsWith(`sell:${p.id}:`)){
        const f=p.fills?.[key.slice(`sell:${p.id}:`.length)],e=f?.execution;
        return e?.group?{execution:e}: {ticker:e?resolvedExecution(e):reference(p.ticker)};
      }
      for(const r of rebuys.filter(r=>r?.id).sort((a,b)=>String(b.id).length-String(a.id).length))if(["cut","rebuy"].some(prefix=>key.startsWith(`${prefix}:${r.id}:`)))return {ticker:reference(r.ticker)};
      for(const it of assetItems.filter(it=>it?.id).sort((a,b)=>String(b.id).length-String(a.id).length))if(key.startsWith(`buy:${it.id}:`)){
        const tail=key.slice(`buy:${it.id}:`.length),b=it.buyPlan?.buys?.[tail]||list(it.buyPlan?.stages).find((s,i)=>(s?.id||`#${i}`)===tail);
        return {ticker:buyTicker(it,b,key)};
      }
      if(reference(rec?.ticker))return {ticker:reference(rec.ticker)};
      const rows=list(rec?.items),tickers=new Set(rows.map(r=>actual(assetById.get(r?.id))));
      return {ticker:rows.length&&rows.every(r=>!r?.converted)&&tickers.size===1?[...tickers][0]:""};
    }
    for(const [key,rec] of entries(alloc?.trades)){
      if(!object(rec))continue;
      const path=["allocation","trades",key],item=bucket("assets","trades",key,rec.label||"자산 반영",path),s=source(key,rec);
      trade(item,key,rec.label||"자산 반영 체결",target=>{
        if(s.execution){
          const n=number(rec.qty),delta=list(s.execution.rows).reduce((sum,row)=>{
            const v=number(row?.qty);return sum+(match(resolvedExecution(row))&&v!==null?round(v*opt.to/opt.from,6)-v:0);
          },0);
          if(n!==null&&delta)change(item,target,rec,path,"qty","qty",opt.ticker,{after:n+delta});
        }else fields(item,target,rec,path,["price","execPrice"],["qty","plannedQty","shares","plannedShares"],s.ticker);
        for(const [i,row] of list(rec.items).entries()){
          const rp=[...path,"items",i],ticker=reference(row?.ticker)||actual(assetById.get(row?.id));
          fields(item,target,row,rp,["price","execPrice"],["qty","plannedQty","shares","plannedShares"],ticker);
          if(number(row?.shares)!==null)fields(item,target,row,rp,[],["exact"],ticker);
        }
      });
      add(item);
    }
    return out;
  }

  // selection={groups:{plans|rebuy|allocation|trades:false},items:{[item.key]:false},trades:{[trade.key]:false}}; 생략은 전체 선택이다.
  // 같은 출처 key의 플래너 체결·자산 반영 기록을 함께 제외할 수 있다. 그룹/항목 제외는 그 안의 체결도 제외한다.
  // 원본에서 다시 만든 미리보기와 일치해야 하며, 변경 경로를 임의로 주입하거나 미리보기 이후 바뀐 칸에 덮어쓸 수 없다.
  // 두 문서를 깊게 복사해 {plannerData,assetsDoc,changedFields,plannerChanged,assetsChanged}를 반환한다. 0건 적용도 새 사본이며 이력은 만들지 않는다.
  // 시간·id 없는 순수 계산을 유지한다. 실제 저장 호출부는 changedFields>0을 확인하고 appendSplitLog에 시각·id·변경 문서 플래그를 명시해 한 번 기록한다.
  function apply(plannerData,assetsDoc,shown,selection={}){
    const expected=preview(plannerData,assetsDoc,shown);
    if(JSON.stringify(expected)!==JSON.stringify(shown))throw Error("미리보기 이후 기록이 변경되었습니다. 다시 확인하세요.");
    if(!object(selection)||["groups","items","trades"].some(k=>selection[k]!==undefined&&(!object(selection[k])||Object.values(selection[k]).some(v=>typeof v!=="boolean"))))throw Error("분할 적용 선택을 확인하세요.");
    const result={plannerData:copy(plannerData),assetsDoc:copy(assetsDoc),changedFields:0,plannerChanged:false,assetsChanged:false};
    const written=new Set();
    for(const item of expected.items){
      if(selection.groups?.[item.group]===false||selection.items?.[item.key]===false)continue;
      const changes=[...item.changes,...item.trades.filter(t=>selection.trades?.[t.key]!==false).flatMap(t=>t.changes)];
      for(const c of changes){
        const id=JSON.stringify([item.document,...c.path]);if(written.has(id))continue;
        let at=item.document==="planner"?result.plannerData:result.assetsDoc;
        for(const key of c.path.slice(0,-1)){
          if(!at||!Object.hasOwn(at,key))throw Error("분할 적용 경로를 확인하세요.");at=at[key];
        }
        const last=c.path.at(-1);if(!at||!Object.hasOwn(at,last)||at[last]!==c.before)throw Error("분할 적용 칸을 확인하세요.");
        at[last]=c.after;written.add(id);result.changedFields++;result[item.document==="planner"?"plannerChanged":"assetsChanged"]=true;
      }
    }
    return result;
  }

  // 사용자 반영·제외 확인 때만 호출: id·appliedAt·실제 변경 문서와 선택 actionId/source/dismissed를 보존한다. 둘 다 변경 없으면 dismissed:true가 필수다.
  // 같은 종목·exDate의 재적용은 미리보기 경고로 판단하고, 같은 id나 200개 초과는 거부한다. 불러오기·normalize에서는 호출하지 않는다.
  function append(plannerData,entry){
    if(!object(plannerData)||!object(entry))throw Error("분할 이력을 확인하세요.");
    const opt=options(entry),old=plannerData.splitLog;
    if(excluded(opt.ticker)||typeof entry.id!=="string"||!entry.id.trim()||entry.id.length>128||!stamp(entry.appliedAt)||typeof entry.planner!=="boolean"||typeof entry.assets!=="boolean"||!entry.planner&&!entry.assets&&entry.dismissed!==true||old!==undefined&&!Array.isArray(old)||list(old).length>=200||list(old).some(r=>r?.id===entry.id)||entry.actionId!==undefined&&entry.actionId!==`${opt.ticker}:${opt.exDate}:${opt.from}:${opt.to}`||entry.source!==undefined&&!["auto","manual"].includes(entry.source)||entry.dismissed!==undefined&&typeof entry.dismissed!=="boolean")throw Error("분할 이력 형식·개수를 확인하세요.");
    const optional=Object.fromEntries(["actionId","source","dismissed"].filter(k=>entry[k]!==undefined).map(k=>[k,entry[k]]));
    const result=copy(plannerData);result.splitLog=[...copy(old||[]),{id:entry.id,...opt,appliedAt:entry.appliedAt,planner:entry.planner,assets:entry.assets,...optional}];return result;
  }
  return {splitPreview:preview,applySplit:apply,appendSplitLog:append};
})();
