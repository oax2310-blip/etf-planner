// 백업·동기화의 JSON 경계. 검증만 하며 기본값·id·필드를 만들거나 원본을 고치지 않는다.
// 옛 숫자 문자열·빈 선택값과 알 수 없는 호환 필드는 보존한다. 오류에는 입력값을 넣지 않는다.
const externalData = (()=>{
  const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
  const absent=v=>v===undefined||v===null;
  const fail=path=>{throw Error(`기록 형식이 맞지 않습니다 (${path}). 기존 기록은 변경하지 않았습니다.`);};
  function tree(value){
    let count=0;
    function visit(v,depth){
      if(++count>250000||depth>40)fail("기록 크기·구조");
      if(typeof v==="number"&&(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER))fail("숫자 범위");
      if(typeof v==="string"&&v.length>1000000)fail("문자열 길이");
      if(!v||typeof v!=="object")return;
      if(Array.isArray(v)){if(v.length>10000)fail("목록 길이");for(const x of v)visit(x,depth+1);}
      else for(const key of Object.keys(v)){
        if(["__proto__","constructor","prototype"].includes(key))fail("예약된 필드");
        visit(v[key],depth+1);
      }
    }
    visit(value,0);
  }
  function record(v,path){if(!object(v))fail(path);}
  function list(v,path,each,nullable=false){
    if(absent(v))return;
    if(!Array.isArray(v))fail(path);
    v.forEach((x,i)=>{if(nullable&&x===null)return;if(each)each(x,`${path}[${i}]`);});
  }
  function strings(v,keys,path){for(const k of keys)if(!absent(v[k])&&typeof v[k]!=="string")fail(`${path}.${k}`);}
  function numbers(v,keys,path,min=-Number.MAX_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER,integer=false){
    for(const k of keys){const x=v[k];if(absent(x)||x==="")continue;
      if(!["number","string"].includes(typeof x)||typeof x==="string"&&!x.trim())fail(`${path}.${k}`);
      const n=Number(x);if(!Number.isFinite(n)||n<min||n>max||integer&&!Number.isInteger(n))fail(`${path}.${k}`);
    }
  }
  function flags(v,keys,path){for(const k of keys)if(!absent(v[k])&&typeof v[k]!=="boolean")fail(`${path}.${k}`);}
  function child(v,k,path,check){if(!absent(v[k])){record(v[k],`${path}.${k}`);check?.(v[k],`${path}.${k}`);}}
  function records(v,path,check,nullable=false){list(v,path,(x,p)=>{record(x,p);check?.(x,p);},nullable);}
  function recordMap(v,path,check){if(absent(v))return;record(v,path);for(const x of Object.values(v))if(x!==null){record(x,path);check?.(x,path);}}
  function trade(v,path){
    numbers(v,["price","execPrice","executionPrice","priceOverride","shares","contracts","qty","plannedQty","plannedShares","plannedValue","value","amount","actual","plannedActual","targetPrice","settlementPrice"],path);
    flags(v,["completed","done","notify","partial"],path);
    child(v,"execution",path,(e,p)=>{
      numbers(e,["price","fx","sourceQty","sourcePrice","referencePrice","plannedQty","qty"],p);
      strings(e,["targetId","ticker","account","name","currency"],p);records(e.rows,`${p}.rows`,trade);
    });
  }
  function stages(v,path,keys=[],flagKeys=[]){records(v,path,(x,p)=>{
    trade(x,p);strings(x,["name","id","condition",...keys],p);flags(x,flagKeys,p);
    records(x.buys,`${p}.buys`,(b,q)=>{trade(b,q);strings(b,keys,q);flags(b,flagKeys,q);},true);
  });}
  function rebuy(v,path){
    record(v,path);strings(v,["id","name","ticker","note","currency","endLine","plannedEndLine","resumeEndLine"],path);
    numbers(v,["lowPrice","floorPrice","currentPrice","finalPrice","amount","shares","contracts","stepPct","sellPct","targetPct"],path);
    numbers(v,["steps"],path,1,10000,true);
    // month: 달러선물 손절·재매수를 반영한 보유 월물, manual: 보유를 직접 고친 기록(futures-rebuy.js). 손절의 partial·plannedQty(부분 체결)는 trade에서 검사한다(rebuy.js futureCutPlan).
    records(v.cuts,`${path}.cuts`,(x,p)=>{trade(x,p);strings(x,["afterLine","month"],p);flags(x,["manual"],p);},true);stages(v.stages,`${path}.stages`,["month"],["manual"]);
    child(v,"notify",path);child(v,"auto",path);
  }
  function planner(data){
    record(data,"플래너");tree(data);
    if(!Array.isArray(data.plans))fail("plans");record(data.futures,"futures");
    records(data.plans,"plans",(p,path)=>{
      strings(p,["id","ticker","title","cardName","currency","startLabel","endLabel","note","sellTargetId"],path);
      // UI의 최대 250회와 기존 1회 기록을 함께 허용한다. 누락된 옛 필드는 그대로 둔다.
      if(p.stages!==undefined&&(p.stages===null||p.stages===""))fail(`${path}.stages`);
      numbers(p,["stages"],path,1,250,true);
      numbers(p,["startPrice","endPrice","valueKrw","valueBase","basisPrice","fx"],path);
      numbers(p,["salePct"],path,1,100,true);numbers(p,["endPct"],path,0,100);flags(p,["startAuto"],path);
      list(p.checked,`${path}.checked`,(v,k)=>{if(v!==null&&typeof v!=="boolean")fail(k);});
      records(p.holdings,`${path}.holdings`,(h,k)=>{strings(h,["name"],k);numbers(h,["shares"],k);});
      recordMap(p.fills,`${path}.fills`,trade);child(p,"auto",path);child(p,"notify",path);child(p,"fullSell",path,(v,k)=>{numbers(v,["price"],k,0);strings(v,["condition"],k);}); // 이전 전액매도 기준가 입력(현재 화면에서 쓰지 않음) 기록 호환
      list(p.sellPriority,`${path}.sellPriority`,(v,k)=>{if(typeof v!=="string")fail(k);});
    });
    const f=data.futures;
    numbers(f,["targetPrice","baselinePnl","targetProfit","lossPrice","rollSpread"],"futures");strings(f,["note"],"futures");
    records(f.positions,"futures.positions",(v,p)=>{trade(v,p);if(!absent(v.month)&&!["string","number"].includes(typeof v.month))fail(`${p}.month`);});
    records(f.levels,"futures.levels",(v,p)=>{trade(v,p);strings(v,["unit","label","name"],p);numbers(v,["days"],p,0,400,true);numbers(v,["contracts"],p,0,10000);records(v.tranches,`${p}.tranches`,trade);});
    records(f.rolls,"futures.rolls");child(f,"buyPlan","futures",(v,p)=>{numbers(v,["endPrice"],p);numbers(v,["contracts"],p,1,100,true);strings(v,["startLine"],p);list(v.units,`${p}.units`,(x,k)=>{if(typeof x!=="string")fail(k);});});
    child(f,"rebuy","futures",rebuy);child(data,"actions","플래너",(v,p)=>{records(v.buys,`${p}.buys`,trade);records(v.adobeSales,`${p}.adobeSales`,trade);});
    child(data,"rebuy","플래너",(v,p)=>{if(v.items!==undefined)records(v.items,`${p}.items`,rebuy);else rebuy(v,p);});
    child(data,"alerts","플래너",(v,p)=>{
      records(v.rules,`${p}.rules`,(r,k)=>{strings(r,["id","ticker","unit"],k);numbers(r,["period"],k,1,400,true);numbers(r,["tolerancePct"],k,0,10);flags(r,["enabled"],k);});
      records(v.subscriptions,`${p}.subscriptions`,(s,k)=>{strings(s,["id"],k);child(s,"subscription",k,(x,q)=>{strings(x,["endpoint"],q);child(x,"keys",q,(keys,t)=>strings(keys,["auth","p256dh"],t));});});
      flags(v,["krOpenReminder"],p);
    });
    child(data,"alertHistory","플래너",(v,p)=>{records(v.items,`${p}.items`);list(v.deletedIds,`${p}.deletedIds`,(x,k)=>{if(typeof x!=="string")fail(k);});});
    strings(data,["selectedPlan","selectedRebuy","tab"],"플래너");
    return data;
  }
  function assets(data){
    record(data,"자산");tree(data);
    child(data,"allocation","자산",(a,p)=>{
      numbers(a,["total","cashFx"],p);strings(a,["memo","savedAt"],p);
      for(const key of ["classes","cash"])records(a[key],`${p}.${key}`,(v,k)=>{strings(v,["id","name","region","currency"],k);numbers(v,["target","amount"],k);});
      records(a.groups,`${p}.groups`,(g,k)=>{
        strings(g,["id","name","classId"],k);numbers(g,["target"],k);
        records(g.sections,`${k}.sections`,(v,q)=>{strings(v,["name"],q);numbers(v,["target"],q);});
        records(g.items,`${k}.items`,(v,q)=>{
          strings(v,["id","name","ticker","tradeTicker","section","note"],q);numbers(v,["target","amount","shares","base","tradePrice"],q);
          child(v,"buyPlan",q,(b,t)=>{stages(b.stages,`${t}.stages`);recordMap(b.buys,`${t}.buys`,trade);child(b,"lines",t);child(b,"wait",t);});
        });
      });
      recordMap(a.trades,`${p}.trades`,v=>records(v.items,`${p}.trades.items`,trade));
    });
    child(data,"ledger","자산",(v,p)=>records(v.years,`${p}.years`,(y,k)=>{
      numbers(y,["year"],k,1,9999,true);records(y.accounts,`${k}.accounts`,(a,q)=>strings(a,["id","name"],q));
      records(y.months,`${k}.months`,(m,q)=>{numbers(m,["m"],q,1,12,true);numbers(m,["pnl","total"],q);records(m.pnlEntries,`${q}.pnlEntries`);});
    }));
    child(data,"savings","자산",(v,p)=>{
      numbers(v,["startYear"],p,1,9999,true);numbers(v,["startAge"],p,0,200);
      records(v.actual,`${p}.actual`,(r,q)=>{strings(r,["ym","note"],q);numbers(r,["total"],q);});
      records(v.scenarios,`${p}.scenarios`,(s,k)=>{
        strings(s,["id","name"],k);numbers(s,["salary","giving","spending","growth","returnRate"],k);
        numbers(s,["spendingYear"],k,1,9999,true);numbers(s,["endAge"],k,0,200);
        records(s.stages,`${k}.stages`,(r,q)=>{numbers(r,["age"],q,0,200);numbers(r,["salary","giving","spending","growth","returnRate"],q);});
      });
    });
    child(data,"installments","자산");
    return data;
  }
  return {planner,assets};
})();
