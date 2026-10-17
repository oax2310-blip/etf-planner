// valuation.html(시나리오) 계산과 가정 저장·동기화. 앞부분은 계산, ASSUMPTION_KEY 이후는 저장·동기화(저장 영역의 테스트 경계 안내와 SCENARIO_FILE 옆 동기화 규칙 확인).
"use strict";
const ids = ["robotM","robotKwh","evShare","robotShare","discount","carM","evPct","evKwh","robotUSD","evASP","robotASP","evMargin","robotMargin","otherOP","affiliate","pe"];
const presets = {
  low:{evShare:2,robotShare:5,evMargin:5,robotMargin:8,otherOP:.5,affiliate:.6,pe:12},
  base:{evShare:5,robotShare:15,evMargin:8,robotMargin:12,otherOP:.8,affiliate:.8,pe:16},
  high:{evShare:8,robotShare:25,evMargin:10,robotMargin:20,otherOP:1,affiliate:.9,pe:18}
};
const sdiPresetLabels={low:"보수적 시나리오",base:"기본 시나리오",high:"낙관적 시나리오"};
const names = {robotM:"만 대",robotKwh:" kWh",evShare:"%",robotShare:"%",discount:"%",carM:"만 대",evPct:"%",evKwh:" kWh",robotUSD:"천 달러",evASP:"천 원/kWh",robotASP:"천 원/kWh",evMargin:"%",robotMargin:"%",otherOP:"조 원",affiliate:"조 원",pe:"배"};
const el = id => document.getElementById(id);
const num = n => new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}).format(n);
const two = n => new Intl.NumberFormat("ko-KR",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const wonMan = v => "약 " + num(v/10000) + "만 원";
function values(){ const v={}; ids.forEach(id=>v[id]=+el(id).value); return v; }
function render(){
  const v=values();
  ids.forEach(id=>{
    let printed=v[id];
    if(id==="robotM"||id==="carM") printed=num(printed*100);
    if(id==="robotUSD") printed=num(printed);
    el(id+"out").textContent=printed+names[id];
  });
  const evGlobal=v.carM*(v.evPct/100)*v.evKwh;
  const robotGlobal=v.robotM*v.robotKwh;
  const evSdi=evGlobal*v.evShare/100;
  const robotSdi=robotGlobal*v.robotShare/100;
  const evRevenue=evSdi*v.evASP/1000;
  const robotRevenue=robotSdi*v.robotASP/1000;
  const evOP=evRevenue*v.evMargin/100;
  const robotOP=robotRevenue*v.robotMargin/100;
  const op=evOP+robotOP+v.otherOP;
  const net=op*.70+v.affiliate;
  const future=net*1e12*v.pe/82203426;
  const pv=future/Math.pow(1+v.discount/100,9);
  const contribution=robotOP*.70*1e12*v.pe/82203426/Math.pow(1+v.discount/100,9);
  const priceGateNet=521000*82203426*Math.pow(1+v.discount/100,9)/v.pe/1e12;
  const priceGateOP=(priceGateNet-v.affiliate)/.7;
  el("evMarket").textContent=num(evGlobal)+" GWh";
  el("robotMarket").textContent=num(robotGlobal)+" GWh";
  const max=Math.max(1,evGlobal,robotGlobal);
  el("evBar").style.width=(evGlobal/max*100).toFixed(1)+"%";
  el("robotBar").style.width=(robotGlobal/max*100).toFixed(1)+"%";
  el("robotRevenue").textContent="연 "+num(v.robotM*v.robotUSD/1000)+"조 달러";
  el("futurePrice").textContent=wonMan(future);
  el("pvPrice").textContent=wonMan(pv);
  el("sdiGuideFuture").textContent=wonMan(future);
  el("sdiGuidePV").textContent=wonMan(pv);
  el("evSdi").textContent=num(evSdi)+" GWh";
  el("robotSdi").textContent=num(robotSdi)+" GWh";
  el("evFigures").textContent=num(evRevenue)+"조 / "+two(evOP)+"조";
  el("robotFigures").textContent=num(robotRevenue)+"조 / "+two(robotOP)+"조";
  el("allOP").textContent=two(op)+"조 원";
  el("allNet").textContent=two(net)+"조 원";
  el("robotDelta").textContent="이 중 로봇 배터리가 2026년 환산가치에 더하는 몫: 약 "+num(contribution/10000)+"만 원";
  el("hurdle").textContent="현재 52.1만 원이 연 "+num(v.discount)+"% 수익률로 2035년까지 정당화되려면, 이 모형에서는 2035년 연 순이익 약 "+two(priceGateNet)+"조 원(영업이익 약 "+two(priceGateOP)+"조 원)이 필요합니다. 같은 조건에서 계산한 값이며 실제 주가 전망은 아닙니다.";
}
ids.forEach(id=>el(id).addEventListener("input",()=>{
  document.querySelectorAll("[data-preset]").forEach(b=>b.classList.remove("active"));
  el("presetLabel").textContent="직접 조정";
  render();
}));
document.querySelectorAll("[data-preset]").forEach(button=>button.addEventListener("click",()=>{
  const key=button.dataset.preset;
  ids.forEach(id=>{
    const defaults={robotM:80,robotKwh:2.5,discount:10,carM:80,evPct:50,evKwh:55,robotUSD:20,evASP:120,robotASP:200};
    el(id).value=(id in presets[key])?presets[key][id]:defaults[id];
  });
  document.querySelectorAll("[data-preset]").forEach(b=>b.classList.toggle("active",b===button));
  el("presetLabel").textContent=sdiPresetLabels[key];
  render();
}));
render();
// Roundhill 공개 명세 2026-09-27 조회. 반올림된 양의 44개 항목 총합은 108.68%(국채 8.11%·머니마켓 1.33% 포함).
// 완제품 관련 8개 노출(주식·스와프): 테슬라·유니트리 스와프·유비테크·레인보우·두산로보틱스·현대차·도봇·샤오펑 비중(%).
const humnMakerWeights=[5.92,4.62,4.36,4.34,3.11,2.88,2.26,1.64];
// 그 밖의 34종목 비중(%), 명세 순서. 국채·머니마켓 제외.
const humnOtherWeights=[5.49,4.17,3.25,3.01,2.86,2.80,2.51,2.46,2.33,2.22,2.19,2.04,1.97,1.97,1.96,1.95,1.89,1.89,1.80,1.70,1.68,1.64,1.57,1.55,1.55,1.47,1.44,1.42,1.37,1.35,1.33,1.32,1.26,0.70];
const humnBasePrice=29.67, humnAnnualFee=.0075;
const money=v=>"$"+new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const usdBillions=v=>num(v/1e9)+"십억 달러";
const makerWeight=humnMakerWeights.reduce((sum,w)=>sum+w/100,0);
const otherWeight=humnOtherWeights.reduce((sum,w)=>sum+w/100,0);
// The positive disclosed positions sum to >100%; cash and collateral net of the
// undisclosed balancing adjustment are the residual, not gross T-bill holdings.
const humnNetCash=1-makerWeight-otherWeight;
const humnControlIds=["humnYear","humnUnits","humnASP","humnPortfolioShare","humnRequired","humnMargin","humnNetRate","humnPER","humnMakerCap","humnExisting","humnDilution","humnRestMultiple"];
// 기본 = 페이지 기본값. 합산 시총(humnMakerCap)은 관측 근사치라 프리셋이 바꾸지 않고, 시점·요구수익률은 세 프리셋이 같다.
const humnPresetValues={
  low:{humnYear:2040,humnUnits:40,humnASP:10,humnPortfolioShare:3,humnRequired:10,humnMargin:8,humnNetRate:65,humnPER:14,humnExisting:80,humnDilution:30,humnRestMultiple:.8},
  base:{humnYear:2040,humnUnits:100,humnASP:15,humnPortfolioShare:6,humnRequired:10,humnMargin:12,humnNetRate:70,humnPER:20,humnExisting:100,humnDilution:20,humnRestMultiple:1},
  high:{humnYear:2040,humnUnits:120,humnASP:20,humnPortfolioShare:10,humnRequired:10,humnMargin:18,humnNetRate:75,humnPER:28,humnExisting:120,humnDilution:10,humnRestMultiple:1.5}
};
const humnPresetLabels={low:"보수적 시나리오",base:"기본 시나리오",high:"낙관적 시나리오"};
function renderHumn(){
  const read=id=>Number(el(id).value);
  const year=read("humnYear"), years=year-2026;
  const worldUnits=read("humnUnits")*1e6;
  const averagePrice=read("humnASP")*1e3;
  const worldRevenue=worldUnits*averagePrice;
  const makerUnits=worldUnits*read("humnPortfolioShare")/100;
  const makerRevenue=makerUnits*averagePrice;
  const operatingProfit=makerRevenue*read("humnMargin")/100;
  const netProfit=operatingProfit*read("humnNetRate")/100;
  const robotBusinessValue=netProfit*read("humnPER");
  const makerCap=read("humnMakerCap")*1e9;
  const existingBusinessValue=makerCap*read("humnExisting")/100;
  // 같은 배수가 8개 주식·스와프에 적용된다고 가정하며 ETF가 재조정되지 않는다고 본다.
  const makerStockMultiple=(existingBusinessValue+robotBusinessValue)/makerCap/(1+read("humnDilution")/100);
  const makerContribution=makerWeight*makerStockMultiple;
  const otherContribution=otherWeight*read("humnRestMultiple");
  const yearsFeeFactor=Math.pow(1-humnAnnualFee,years);
  const future=humnBasePrice*(makerContribution+otherContribution+humnNetCash)*yearsFeeFactor;
  const discountFactor=Math.pow(1+read("humnRequired")/100,years);
  const currentEquivalent=future/discountFactor;
  const hurdle=humnBasePrice*discountFactor;
  el("humnYearLabel").textContent=year;
  el("humnMarketYear").textContent=year;
  el("humnFuture").textContent=money(future);
  el("humnPV").textContent=money(currentEquivalent);
  el("humnHurdlePrice").textContent=money(hurdle);
  el("humnUnitsOut").textContent=worldUnits>=1e8?num(worldUnits/1e8)+"억 대":num(worldUnits/1e4)+"만 대";
  el("humnASPOut").textContent="$"+num(averagePrice);
  el("humnPortfolioShareOut").textContent=num(read("humnPortfolioShare"))+"%";
  el("humnRequiredOut").textContent=num(read("humnRequired"))+"%";
  ["humnMargin","humnNetRate","humnExisting","humnDilution"].forEach(id=>el(id+"Out").textContent=num(read(id))+"%");
  el("humnPEROut").textContent=num(read("humnPER"))+"배";
  el("humnMakerCapOut").textContent="$"+num(read("humnMakerCap"))+"bn";
  el("humnRestMultipleOut").textContent=num(read("humnRestMultiple"))+"배";
  el("humnMarketRevenue").textContent="$"+two(worldRevenue/1e12)+"조";
  el("humnCapturedRevenue").textContent="$"+two(makerRevenue/1e9)+"bn";
  el("humnMarketWarning").textContent="세계 "+num(worldUnits/1e4)+"만 대 × 평균 $"+num(averagePrice)+" = 시장 매출 $"+two(worldRevenue/1e12)+"조. 판매 점유율 "+num(read("humnPortfolioShare"))+"%는 관측치가 아닌 가정입니다.";
  el("humnRobotEquation").textContent="세계 "+num(worldUnits/1e4)+"만 대 × 그룹 합산 판매 점유율 "+num(read("humnPortfolioShare"))+"% = 연 "+num(makerUnits/1e4)+"만 대 → 평균 $"+num(averagePrice)+" = 그룹 매출 "+usdBillions(makerRevenue)+" → 영업이익 "+usdBillions(operatingProfit)+" × 순이익 비율 "+num(read("humnNetRate"))+"% = 주주 귀속 순이익 "+usdBillions(netProfit)+" × PER "+num(read("humnPER"))+"배 = 로봇 사업 가치 "+usdBillions(robotBusinessValue)+".";
  el("humnEquation").textContent="완제품 기업 그룹 미래 주가배수 = (현재 그룹 시총 "+usdBillions(makerCap)+" × 기존 사업 가치 "+num(read("humnExisting"))+"% + 로봇 사업 가치 "+usdBillions(robotBusinessValue)+") ÷ 현재 그룹 시총 ÷ (1 + 주식 수 증가 "+num(read("humnDilution"))+"%) = "+two(makerStockMultiple)+"배. HUMN 미래 시나리오 가격 = 기준 종가 "+money(humnBasePrice)+" × (그룹 편입 비중 "+two(makerWeight*100)+"% × "+two(makerStockMultiple)+"배 + 다른 종목 "+two(otherWeight*100)+"% × "+num(read("humnRestMultiple"))+"배 + 국채·현금 등 순 잔여 "+two(humnNetCash*100)+"%) × 연 0.75% 보수 차감 = "+money(future)+". 연 요구수익률 "+num(read("humnRequired"))+"%로 환산한 현재 가치 = "+money(currentEquivalent)+".";
  renderTer(year,worldRevenue,discountFactor);
}
// 2026 H1 Teradyne 10-Q: Semicond. Test $2,232.626m + Product Test $187.683m,
// Robotics $191.175m, June 28 common shares 156.378m. H1 x 2 is a run rate only.
const terBaseTestRevenue=(2232.626+187.683)*2*1e6;
const terShares=156.378e6;
const terControlIds=["terMarketShare","terTestGrowth","terTestMargin","terRobotMargin","terNetRate","terPE","terDilution"];
function renderTer(year,worldRevenue,discountFactor){
  const read=id=>Number(el(id).value);
  const years=year-2026;
  const robotRevenue=worldRevenue*read("terMarketShare")/100;
  const testRevenue=terBaseTestRevenue*Math.pow(1+read("terTestGrowth")/100,years);
  const afterTaxFraction=read("terNetRate")/100;
  const robotNet=robotRevenue*read("terRobotMargin")/100*afterTaxFraction;
  const testNet=testRevenue*read("terTestMargin")/100*afterTaxFraction;
  const targetShares=terShares*(1+read("terDilution")/100);
  const robotPerShare=robotNet*read("terPE")/targetShares;
  const testPerShare=testNet*read("terPE")/targetShares;
  const future=robotPerShare+testPerShare;
  document.querySelectorAll(".terYear").forEach(node=>node.textContent=year);
  el("terFuture").textContent=money(future);
  el("terPV").textContent=money(future/discountFactor);
  el("terRobotRevenue").textContent="$"+two(robotRevenue/1e9)+"bn";
  el("terTestRevenue").textContent="$"+two(testRevenue/1e9)+"bn";
  el("terRobotPerShare").textContent=money(robotPerShare);
  el("terTestPerShare").textContent=money(testPerShare);
  ["terMarketShare","terTestGrowth","terTestMargin","terRobotMargin","terNetRate","terDilution"].forEach(id=>el(id+"Out").textContent=two(read(id)).replace(/([.,]00)$/,"")+"%");
  el("terPEOut").textContent=num(read("terPE"))+"배";
  el("terEquation").textContent="로봇 사업: 세계 연간 매출 $"+two(worldRevenue/1e12)+"조 × 테라다인 매출 점유율 "+two(read("terMarketShare"))+"% = $"+two(robotRevenue/1e9)+"bn. 검사 사업: 2026년 상반기 매출 연 환산 $4.84bn × (1 + 연 성장률 "+num(read("terTestGrowth"))+"%)^"+years+" = $"+two(testRevenue/1e9)+"bn. 각 사업 매출 × 목표 이익률 × 순이익 비중 "+num(read("terNetRate"))+"% × PER "+num(read("terPE"))+"배 ÷ 미래 주식 수 "+two(targetShares/1e6)+"백만 주 = "+year+"년 주당 "+money(future)+". 연 요구수익률 "+num(read("humnRequired"))+"%로 "+years+"년 환산 = "+money(future/discountFactor)+".";
}
humnControlIds.forEach(id=>el(id).addEventListener("input",()=>{
  document.querySelectorAll("[data-humn-preset]").forEach(b=>b.classList.remove("active"));
  el("humnPresetLabel").textContent="직접 조정";
  renderHumn();
}));
terControlIds.forEach(id=>el(id).addEventListener("input",renderHumn));
document.querySelectorAll("[data-humn-preset]").forEach(button=>button.addEventListener("click",()=>{
  const key=button.dataset.humnPreset;
  for(const [id,value] of Object.entries(humnPresetValues[key])) el(id).value=value;
  document.querySelectorAll("[data-humn-preset]").forEach(b=>b.classList.toggle("active",b===button));
  el("humnPresetLabel").textContent=humnPresetLabels[key];
  renderHumn();
}));
renderHumn();
// ETF model: index weights are measured, market shares and terminal earnings are scenarios.
const batteryCompanies=[
  {id:"lg",name:"LG에너지솔루션",fund:"rise",weight:14.12,ev:8,robot:10,ess:4,cap:82.25,other:0},
  {id:"sdi",name:"삼성SDI",fund:"rise",weight:14.03,ev:5,robot:15,ess:3,cap:40.55,other:21.8},
  {id:"catl",name:"CATL",fund:"china",weight:17.58,ev:40,robot:25,ess:30,cap:286,other:0},
  {id:"byd",name:"BYD (A·H 합산)",fund:"china",weight:17.84,ev:15,robot:10,ess:10,cap:157,other:70},
  {id:"eve",name:"EVE Energy",fund:"china",weight:3.95,ev:3.5,robot:5,ess:4,cap:22,other:0}
];
// 2025 battery demand: SNE EV use 1,187 GWh and ESS shipments 550 GWh.
// Issuer/index weights and approximate September 2026 group market caps are separate from scenario shares.
const batteryRestGroups=[
  {id:"skon",name:"SK이노베이션 · SK온",fund:"rise",weight:16.28,kind:"cell",share:4.2,cap:25.3,margin:8},
  {id:"posco",name:"POSCO홀딩스 · 배터리 소재",fund:"rise",weight:14.24,kind:"material",share:2,cap:23.56,margin:7},
  {id:"krmaterial",name:"에코프로·에코프로비엠·포스코퓨처엠·엘앤에프·SKC·에코프로머티",fund:"rise",weight:40.87,kind:"material",share:20,cap:49.85,margin:8},
  {id:"cnmineral",name:"CMOC·Zangge·Qinghai Salt Lake",fund:"china",weight:21.18,kind:"mineral",share:10,cap:105,margin:12},
  {id:"cnpower",name:"Deye·Sungrow · ESS 전력기기",fund:"china",weight:7.76,kind:"equipment",share:4,cap:54,margin:12}
];
const batteryInputs=["batYear","batCarM","batEvPct","batEvKwh","batRobotM","batRobotKwh","batEssGwh","batRequired","batEvAsp","batRobotAsp","batEssAsp","batEvMargin","batRobotMargin","batEssMargin","batNetRate","batPE","batDilution","chinaFx","riseBasePrice","chinaBasePrice"];
const batteryPresetValues={
  low:{batYear:2035,batCarM:75,batEvPct:35,batEvKwh:50,batRobotM:25,batRobotKwh:2.5,batEssGwh:800,batEvAsp:100,batRobotAsp:140,batEssAsp:70,batEvMargin:5,batRobotMargin:7,batEssMargin:5,batNetRate:65,batPE:12,batRequired:10,chinaFx:0},
  base:{batYear:2035,batCarM:80,batEvPct:50,batEvKwh:55,batRobotM:80,batRobotKwh:2.5,batEssGwh:1500,batEvAsp:120,batRobotAsp:200,batEssAsp:90,batEvMargin:8,batRobotMargin:12,batEssMargin:8,batNetRate:70,batPE:16,batRequired:10,chinaFx:0},
  high:{batYear:2035,batCarM:95,batEvPct:75,batEvKwh:65,batRobotM:110,batRobotKwh:4,batEssGwh:2600,batEvAsp:130,batRobotAsp:230,batEssAsp:110,batEvMargin:11,batRobotMargin:16,batEssMargin:12,batNetRate:75,batPE:22,batRequired:10,chinaFx:0}
};
const batteryPresetLabels={low:"보수적 가정",base:"기본 가정",high:"낙관적 가정"};
const inputCell=(company,key,title,step,min,max)=>'<input type="number" id="bc-'+company.id+'-'+key+'" aria-label="'+company.name+' '+title+'" value="'+company[key]+'" min="'+min+'" max="'+max+'" step="'+step+'">';
el("batteryCompanyRows").innerHTML=batteryCompanies.map(company=>'<tr><td><strong>'+company.name+'</strong><small>'+(company.fund==="rise"?"RISE":"KODEX 지수")+'</small></td>'+
  '<td>'+inputCell(company,"weight","ETF 편입 비중",.01,0,100)+'</td><td>'+inputCell(company,"ev","전기차 점유율",.5,0,100)+'</td><td>'+inputCell(company,"robot","로봇 점유율",.5,0,100)+'</td><td>'+inputCell(company,"ess","ESS 점유율",.5,0,100)+'</td><td>'+inputCell(company,"cap","2026 시가총액",.01,.01,10000)+'</td><td>'+inputCell(company,"other","미래 기타사업 가치",.1,0,5000)+'</td><td class="company-output" id="bc-'+company.id+'-revenue">—</td><td class="company-output" id="bc-'+company.id+'-profit">—</td></tr>').join("");
const companyInputIds=batteryCompanies.flatMap(c=>["weight","ev","robot","ess","cap","other"].map(k=>"bc-"+c.id+"-"+k));
const groupInput=(g,key,title,step,min,max)=>'<input type="number" id="bg-'+g.id+'-'+key+'" aria-label="'+g.name+' '+title+'" value="'+g[key]+'" min="'+min+'" max="'+max+'" step="'+step+'">';
el("batteryRestRows").innerHTML=batteryRestGroups.map(g=>'<tr><td><strong>'+g.name+'</strong><small>'+(g.fund==="rise"?"RISE ":"KODEX ")+two(g.weight)+'%</small></td>'+
  '<td>'+groupInput(g,"share",g.kind==="equipment"?"2025 관련 매출 조원":"관련 시장 점유율",.1,0,g.kind==="equipment"?100:100)+(g.kind==="equipment"?"조":"%")+'</td><td>'+groupInput(g,"cap","현재 합산 시총 조원",.01,.01,10000)+'</td><td>'+groupInput(g,"margin","사업 영업이익률 %",.5,0,50)+'</td><td class="company-output" id="bg-'+g.id+'-finance">—</td><td class="company-output" id="bg-'+g.id+'-multiple">—</td></tr>').join("");
const groupInputIds=batteryRestGroups.flatMap(g=>["share","cap","margin"].map(k=>"bg-"+g.id+"-"+k));
const batteryMoney=n=>num(Math.round(n))+"원";
function renderBatteryEtfs(){
  const warn=el("batteryWeightsWarning");
  const allIds=[...batteryInputs,...companyInputIds,...groupInputIds];
  const invalid=allIds.find(id=>!el(id).checkValidity()||el(id).value.trim()===""||!Number.isFinite(Number(el(id).value)));
  if(invalid){ warn.textContent="입력값의 범위를 확인하면 계산이 다시 표시됩니다: "+(el(invalid).getAttribute("aria-label")?.trim()||el(invalid).labels?.[0]?.textContent||invalid); return; }
  const read=id=>Number(el(id).value);
  const year=read("batYear"),years=year-2026, discount=Math.pow(1+read("batRequired")/100,years);
  const demand={ev:read("batCarM")*read("batEvPct")/100*read("batEvKwh"),robot:read("batRobotM")*read("batRobotKwh"),ess:read("batEssGwh")};
  const asp={ev:read("batEvAsp"),robot:read("batRobotAsp"),ess:read("batEssAsp")};
  const margin={ev:read("batEvMargin")/100,robot:read("batRobotMargin")/100,ess:read("batEssMargin")/100};
  const per=read("batPE"),netRate=read("batNetRate")/100,dilution=1+read("batDilution")/100;
  const results=batteryCompanies.map(c=>{
    const shares={ev:read("bc-"+c.id+"-ev"),robot:read("bc-"+c.id+"-robot"),ess:read("bc-"+c.id+"-ess")};
    const revenues=Object.fromEntries(["ev","robot","ess"].map(k=>[k,demand[k]*shares[k]/100*asp[k]/1000]));
    const revenue=revenues.ev+revenues.robot+revenues.ess;
    const op=Object.keys(revenues).reduce((s,k)=>s+revenues[k]*margin[k],0);
    const robotOp=revenues.robot*margin.robot;
    const net=op*netRate;
    const cap=read("bc-"+c.id+"-cap"),futureCap=net*per+read("bc-"+c.id+"-other");
    const multiple=futureCap/cap/dilution;
    el("bc-"+c.id+"-revenue").textContent=two(revenue)+"조 / "+two(op)+"조";
    el("bc-"+c.id+"-profit").textContent=two(net)+"조 / "+two(futureCap)+"조";
    return {id:c.id,name:c.name,fund:c.fund,weight:read("bc-"+c.id+"-weight"),revenue,op,multiple,robotMultiple:robotOp*netRate*per/cap/dilution};
  });
  const sums={rise:results.filter(x=>x.fund==="rise").reduce((n,x)=>n+x.weight,0),china:results.filter(x=>x.fund==="china").reduce((n,x)=>n+x.weight,0)};
  const knownRest={rise:71.39,china:28.94};
  if(sums.rise+knownRest.rise>100.00001||sums.china+knownRest.china>100.00001){warn.textContent="셀 제조사 비중과 이미 알려진 나머지 종목 비중의 합이 100%를 넘었습니다. 회사별 ETF 비중을 확인하세요.";return;}
  const baselineDemand={ev:1187,robot:0,ess:550};
  // Cell-price-equivalent industry turnover (trillion KRW). Material and mineral fractions
  // use IEA cost shares only as sector revenue proxies; group shares/margins are scenarios.
  const industryRevenue=(kind,quantities)=>{
    const fractions=kind==="cell"?{ev:1,robot:1,ess:1}:kind==="material"?{ev:.30,robot:.30,ess:.275}:{ev:.25,robot:.25,ess:.25};
    return Object.fromEntries(["ev","robot","ess"].map(k=>[k,quantities[k]*asp[k]/1000*fractions[k]]));
  };
  const groupResults=batteryRestGroups.map(g=>{
    const share=read("bg-"+g.id+"-share"),cap=read("bg-"+g.id+"-cap"),margin=read("bg-"+g.id+"-margin")/100;
    const revenues=g.kind==="equipment"?{ev:0,robot:0,ess:share*demand.ess/550}:
      Object.fromEntries(Object.entries(industryRevenue(g.kind,demand)).map(([k,v])=>[k,v*share/100]));
    const baseRevenue=g.kind==="equipment"?share:
      Object.values(industryRevenue(g.kind,baselineDemand)).reduce((a,b)=>a+b,0)*share/100;
    const revenue=Object.values(revenues).reduce((a,b)=>a+b,0);
    const op=revenue*margin,baseOp=baseRevenue*margin,deltaOp=op-baseOp;
    const multiple=Math.max(0,(cap+deltaOp*netRate*per)/cap/dilution);
    const robotMultiple=revenues.robot*margin*netRate*per/cap/dilution;
    el("bg-"+g.id+"-finance").textContent=two(revenue)+"조 / "+two(op)+"조";
    el("bg-"+g.id+"-multiple").textContent=two(multiple)+"배";
    return {id:g.id,name:g.name,fund:g.fund,weight:g.weight,revenue,op,deltaOp,multiple,robotMultiple};
  });
  warn.textContent="";
  el("batEvPctOut").textContent=num(read("batEvPct"))+"%";
  el("batRobotMOut").textContent=num(read("batRobotM")*100)+"만 대";
  el("batRobotKwhOut").textContent=num(read("batRobotKwh"))+" kWh";
  el("batRequiredOut").textContent=num(read("batRequired"))+"%";
  el("batEvDemand").textContent=num(demand.ev)+" GWh";
  el("batRobotDemand").textContent=num(demand.robot)+" GWh";
  el("batEssDemand").textContent=num(demand.ess)+" GWh";
  for(const fund of ["rise","china"]){
    const cells=results.filter(x=>x.fund===fund);
    el(fund+"CellSummary").textContent=two(cells.reduce((n,x)=>n+x.revenue,0))+"조 / "+two(cells.reduce((n,x)=>n+x.op,0))+"조 원";
  }
  document.querySelectorAll(".battery-year").forEach(node=>node.textContent=year);
  const fmts={rise:{base:"riseBasePrice",fee:.0007,fx:1},china:{base:"chinaBasePrice",fee:.0025,fx:Math.pow(1+read("chinaFx")/100,years)}};
  for(const fund of ["rise","china"]){
    const f=fmts[fund],price=read(f.base),items=results.filter(x=>x.fund===fund),restWeight=100-sums[fund];
    const groups=groupResults.filter(x=>x.fund===fund),remaining=restWeight-knownRest[fund];
    // KODEX discloses the top ten securities. Impute the other 31.69% from the
    // weighted mean of the five disclosed non-cell issuers; RISE remainder is cash.
    const knownGroupWeight=groups.reduce((n,x)=>n+x.weight,0);
    const proxyMultiple=fund==="china"?groups.reduce((n,x)=>n+x.weight*x.multiple,0)/knownGroupWeight:1;
    const proxyRobotMultiple=fund==="china"?groups.reduce((n,x)=>n+x.weight*x.robotMultiple,0)/knownGroupWeight:0;
    const knownRestBasket=groups.reduce((n,x)=>n+x.weight/100*x.multiple,0);
    const restBasket=knownRestBasket+remaining/100*proxyMultiple;
    const restAverage=restBasket/(restWeight/100);
    const annualRest=(Math.pow(Math.max(0,restAverage),1/years)-1)*100;
    const deltaOp=groups.reduce((n,x)=>n+x.deltaOp,0);
    const feeMultiple=Math.pow(1-f.fee,years);
    const basket=items.reduce((n,x)=>n+x.weight/100*x.multiple,0)+restBasket;
    const future=price*basket*feeMultiple*f.fx,pv=future/discount;
    const robotBasket=items.reduce((n,x)=>n+x.weight/100*x.robotMultiple,0)+groups.reduce((n,x)=>n+x.weight/100*x.robotMultiple,0)+remaining/100*proxyRobotMultiple;
    const robotContribution=price*robotBasket*feeMultiple*f.fx;
    el(fund+"Future").textContent=batteryMoney(future);
    el(fund+"PV").textContent=batteryMoney(pv);
    el(fund+"Reference").textContent=batteryMoney(price);
    el(fund+"RestSummary").textContent=(deltaOp>=0?"+":"")+two(deltaOp)+"조 / 연 "+(annualRest>=0?"+":"")+two(annualRest)+"%";
    const rows=items.map(x=>'<tr><td>'+x.name+' · '+two(x.weight)+'% × '+two(x.multiple)+'배</td><td>'+batteryMoney(price*x.weight/100*x.multiple*feeMultiple*f.fx)+'</td></tr>');
    groups.forEach(g=>rows.push('<tr><td>'+g.name+' · '+two(g.weight)+'% × '+two(g.multiple)+'배</td><td>'+batteryMoney(price*g.weight/100*g.multiple*feeMultiple*f.fx)+'</td></tr>'));
    rows.push('<tr><td>'+(fund==="rise"?"현금성 잔여":"상위 10종목 밖 · 확인된 비셀 5곳 평균 대입")+' '+two(remaining)+'% · '+two(proxyMultiple)+'배</td><td>'+batteryMoney(price*remaining/100*proxyMultiple*feeMultiple*f.fx)+'</td></tr>');
    rows.push('<tr><td>이 중 로봇 배터리 사업의 계산상 기여</td><td>'+batteryMoney(robotContribution)+'</td></tr>');
    el(fund+"Breakdown").innerHTML=rows.join("");
  }
  el("batteryEquation").textContent="전기차 "+num(demand.ev)+" + 로봇 "+num(demand.robot)+" + ESS "+num(demand.ess)+" GWh → 기업별 셀 매출·영업이익을 계산합니다. 나머지 종목은 (시장 배터리 수요 × 소재·광물 매출 비율 × 업체 묶음 점유율) 또는 (2025년 전력기기 매출 × ESS 수요 증가배수)로 관련 매출을 구합니다. 이 매출 × 영업이익률에서 2025년 기준 이익을 뺀 추가 영업이익 "+num(read("batNetRate"))+"%를 순이익으로 보고 PER "+num(per)+"배를 적용해 현재 시총에 더합니다. 기업별 예상 주가배수 × ETF 편입 비중을 합산하고 연 보수·위안화 환율을 적용한 뒤, 연 요구수익률 "+num(read("batRequired"))+"%로 "+years+"년 할인합니다.";
}
[...batteryInputs,...companyInputIds,...groupInputIds].forEach(id=>el(id).addEventListener("input",()=>{
  document.querySelectorAll("[data-battery-preset]").forEach(b=>b.classList.remove("active"));
  el("batteryPresetLabel").textContent="직접 조정";
  renderBatteryEtfs();
}));
document.querySelectorAll("[data-battery-preset]").forEach(button=>button.addEventListener("click",()=>{
  const preset=batteryPresetValues[button.dataset.batteryPreset];
  for(const [id,value] of Object.entries(preset)) el(id).value=value;
  document.querySelectorAll("[data-battery-preset]").forEach(b=>b.classList.toggle("active",b===button));
  el("batteryPresetLabel").textContent=batteryPresetLabels[button.dataset.batteryPreset];
  renderBatteryEtfs();
}));
renderBatteryEtfs();
// AI 구독사업 계산: 금액은 원, 비교 인원은 백만 명, 연 고정비는 조 원. 결제계정은 연평균으로 둔다.
const aiControlIds=["aiPrice","aiReferenceM","aiPaidRatio","aiInference","aiOther","aiFixed","aiVat","aiFee","aiYear","aiMultiple","aiRequired"];
const aiPresetLabels={low:"고사용량 원가",base:"기준 원가",high:"효율화 원가"};
const aiBaseInputs={aiPrice:12000,aiReferenceM:125,aiPaidRatio:100,aiInference:4000,aiOther:1000,aiFixed:5,aiVat:10,aiFee:3};
const aiPresetValues={low:{...aiBaseInputs,aiInference:7000},base:{...aiBaseInputs},high:{...aiBaseInputs,aiInference:2000}};
function calculateAiSubscription(v){
  const accounts=v.aiReferenceM*1e6*v.aiPaidRatio/100,netMonthly=v.aiPrice/(1+v.aiVat/100),feeMonthly=netMonthly*v.aiFee/100;
  const contribution=netMonthly-feeMonthly-v.aiInference-v.aiOther,annualRevenue=accounts*12*netMonthly,fixedCost=v.aiFixed*1e12;
  const annualFees=accounts*12*feeMonthly,annualInference=accounts*12*v.aiInference,annualOther=accounts*12*v.aiOther;
  const profit=annualRevenue-annualFees-annualInference-annualOther-fixedCost;
  const futureValue=profit>0?profit*v.aiMultiple:null,presentValue=futureValue===null?null:futureValue/Math.pow(1+v.aiRequired/100,v.aiYear-2026);
  return {accounts,netMonthly,contribution,annualRevenue,annualGross:accounts*12*v.aiPrice,annualFees,annualInference,annualOther,fixedCost,profit,
    margin:annualRevenue>0?profit/annualRevenue:null,breakEven:contribution>0?fixedCost/(contribution*12):null,
    inferenceCap:accounts>0?netMonthly-feeMonthly-v.aiOther-fixedCost/(accounts*12):null,
    margin20Cap:accounts>0?netMonthly-feeMonthly-netMonthly*.2-v.aiOther-fixedCost/(accounts*12):null,
    minimumPrice:accounts>0?(v.aiInference+v.aiOther+fixedCost/(accounts*12))*(1+v.aiVat/100)/(1-v.aiFee/100):null,
    futureValue,presentValue};
}
// AI 구독사업 계산 함수 끝. 이익이 없거나 공헌이익이 0 이하면 양의 이익 배수·손익분기 계정을 제시하지 않는다.
const aiTrillion=value=>two(value/1e12)+"조 원";
const aiWon=value=>new Intl.NumberFormat("ko-KR",{maximumFractionDigits:0}).format(value)+"원";
const aiAccountText=value=>value>=1e8?two(value/1e8)+"억 계정":new Intl.NumberFormat("ko-KR",{maximumFractionDigits:0}).format(value/1e4)+"만 계정";
function renderAiSubscription(){
  const v={};
  for(const id of aiControlIds){ const node=el(id); if(node.value.trim()===""||!node.checkValidity()||!Number.isFinite(Number(node.value))){ el("aiInputWarning").textContent="범위에 맞는 값을 입력하세요. 결과는 마지막 유효 입력 기준입니다."; return; } v[id]=Number(node.value); }
  el("aiInputWarning").textContent="";
  const displayed={aiPrice:aiWon(v.aiPrice),aiReferenceM:aiAccountText(v.aiReferenceM*1e6).replace("계정","명"),aiPaidRatio:num(v.aiPaidRatio)+"%",aiInference:aiWon(v.aiInference),aiOther:aiWon(v.aiOther),aiFixed:num(v.aiFixed)+"조 원",aiVat:num(v.aiVat)+"%",aiFee:num(v.aiFee)+"%",aiMultiple:num(v.aiMultiple)+"배",aiRequired:num(v.aiRequired)+"%"};
  for(const [id,text] of Object.entries(displayed)){ el(id+"Out").textContent=text; el(id).setAttribute("aria-valuetext",text); }
  const result=calculateAiSubscription(v);
  el("aiProfit").textContent=aiTrillion(result.profit); el("aiProfit").classList.toggle("ai-loss",result.profit<0);
  el("aiRevenue").textContent=aiTrillion(result.annualRevenue); el("aiMargin").textContent=num(result.margin*100)+"%";
  el("aiAccounts").textContent=aiAccountText(result.accounts); el("aiGross").textContent=aiTrillion(result.annualGross);
  el("aiBreakEven").textContent=result.breakEven===null?"규모 확대만으로 불가":aiAccountText(result.breakEven);
  el("aiBreakEven").classList.toggle("ai-loss",result.breakEven===null);
  el("aiContribution").textContent=aiWon(result.contribution); el("aiCostCap").textContent=result.inferenceCap<0?"현 조건으로 불가":aiWon(result.inferenceCap);
  el("aiThresholdNote").textContent=result.margin20Cap>=0?"영업이익률 20%를 내려면 월 추론비가 "+aiWon(result.margin20Cap)+" 이하여야 합니다. 손익분기점에서는 영업이익이 0입니다.":"현재 규모에서는 추론비를 0원으로 낮춰도 영업이익률 20%를 달성하기 어렵습니다.";
  el("aiEquation").textContent="연 영업이익 = 부가세 제외 매출 "+aiTrillion(result.annualRevenue)+" − 수수료 "+aiTrillion(result.annualFees)+" − 추론비 "+aiTrillion(result.annualInference)+" − 기타 변동비 "+aiTrillion(result.annualOther)+" − 고정비 "+aiTrillion(result.fixedCost)+" = "+aiTrillion(result.profit)+". 손익분기 월 소비자 요금은 "+aiWon(result.minimumPrice)+"입니다.";
  const comparisons=[["효율화",2000,v.aiFixed],["기준 원가",4000,v.aiFixed],["고사용량",7000,v.aiFixed],["매우 높은 사용량",10000,v.aiFixed],["고정비 10조 원",v.aiInference,10]];
  el("aiScenarioRows").replaceChildren(...comparisons.map(([label,inference,fixed])=>{
    const item=calculateAiSubscription({...v,aiInference:inference,aiFixed:fixed}),row=document.createElement("tr");
    for(const value of [label,aiWon(inference),aiTrillion(item.fixedCost),aiTrillion(item.profit),num(item.margin*100)+"%",item.breakEven===null?"규모 확대만으로 불가":aiAccountText(item.breakEven)]){ const cell=document.createElement("td"); cell.textContent=value; row.append(cell); }
    return row;
  }));
  const oldContribution=30000/(1+v.aiVat/100)*(1-v.aiFee/100)-v.aiInference-v.aiOther;
  el("aiPriceComparison").textContent="월 30,000원에서 "+aiWon(v.aiPrice)+"으로 조정하면 같은 매출에 필요한 결제계정은 "+two(30000/v.aiPrice)+"배입니다. "+(result.contribution>0&&oldContribution>0?"같은 영업이익을 유지하려면 "+two(oldContribution/result.contribution)+"배의 계정이 필요합니다.":"공헌이익이 0 이하인 요금에서는 규모 확대만으로 기존 영업이익을 유지할 수 없습니다.");
  el("aiFutureValue").textContent=result.futureValue===null?"흑자 전환 후 평가":aiTrillion(result.futureValue);
  el("aiPresentValue").textContent=result.presentValue===null?"이익 배수 적용 불가":aiTrillion(result.presentValue);
  el("aiValueEquation").textContent=result.futureValue===null?"적자는 기업가치가 0이라는 뜻이 아닙니다. 다른 사업의 가치나 미래 흑자 전환을 별도로 평가해야 합니다.":v.aiYear+"년 정상 영업이익 "+aiTrillion(result.profit)+" × "+num(v.aiMultiple)+"배 = "+aiTrillion(result.futureValue)+". 이를 "+(v.aiYear-2026)+"년간 연 "+num(v.aiRequired)+"%로 할인한 값은 "+aiTrillion(result.presentValue)+"입니다.";
}
aiControlIds.forEach(id=>el(id).addEventListener("input",()=>{ document.querySelectorAll("[data-ai-preset]").forEach(button=>button.classList.toggle("active",false)); el("aiPresetLabel").textContent="직접 조정"; renderAiSubscription(); }));
document.querySelectorAll("[data-ai-preset]").forEach(button=>button.addEventListener("click",()=>{ for(const [id,value] of Object.entries(aiPresetValues[button.dataset.aiPreset])){ const node=el(id); if(node.dataset.sliderMax) node.max=node.dataset.sliderMax; node.value=value; } document.querySelectorAll("[data-ai-preset]").forEach(b=>b.classList.toggle("active",b===button)); el("aiPresetLabel").textContent=aiPresetLabels[button.dataset.aiPreset]; renderAiSubscription(); }));
renderAiSubscription();
document.querySelectorAll(".mobile-fold").forEach(button=>button.addEventListener("click",()=>{
  const expanded=button.getAttribute("aria-expanded")!=="true";
  button.setAttribute("aria-expanded",String(expanded));
  el(button.getAttribute("aria-controls")).classList.toggle("is-open",expanded);
}));
document.querySelectorAll("[data-mirror]").forEach(target=>{
  const source=el(target.dataset.mirror);
  const update=()=>{target.textContent=source.textContent.trim().replace(/^약\s*/,"").replace(/만\s*원/g,"만");};
  new MutationObserver(update).observe(source,{childList:true,characterData:true,subtree:true});
  update();
});
// 테스트 경계: tests/valuation.test.cjs는 바로 아래 시작 주석부터 script 끝까지 실행한다.
// 기존 시작 주석을 지우거나 바꾸거나 중복하지 않는다. 새 계산 코드는 이 경계 앞에 둔다.
// 가정 저장: 기본값과 다른 입력만 이 브라우저 localStorage에 저장하고, 열 때 복원한다.
// 바꾸지 않은 입력(기준 종가·시총 등)은 저장하지 않으므로 페이지 기준값이 갱신되면 새 값을 따른다.
const ASSUMPTION_KEY="etf-planner-valuation-current-v1";
const SCENARIO_LIST_KEY="etf-planner-valuation-scenarios-v1";
const DELETED_KEY="etf-planner-valuation-deleted-v1"; // 삭제한 저장본 id → 삭제 시각. 다른 기기에 삭제를 전파한다
const assumptionGroups=[["삼성SDI",ids],["배터리 ETF",[...batteryInputs,...companyInputIds,...groupInputIds]],["HUMN",[...humnControlIds,...terControlIds]],["AI 구독",aiControlIds]];
const assumptionIds=assumptionGroups.flatMap(([,list])=>list);
const assumptionIdSet=new Set(assumptionIds);
const assumptionDefaults=Object.fromEntries(assumptionIds.map(id=>{
  const node=el(id);
  return [id,node.tagName==="SELECT"?([...node.options].find(option=>option.defaultSelected)||node.options[0]).value:node.defaultValue];
}));
const presetControls={
  sdi:{selector:"[data-preset]",data:"preset",label:"presetLabel",names:sdiPresetLabels},
  battery:{selector:"[data-battery-preset]",data:"batteryPreset",label:"batteryPresetLabel",names:batteryPresetLabels},
  humn:{selector:"[data-humn-preset]",data:"humnPreset",label:"humnPresetLabel",names:humnPresetLabels},
  ai:{selector:"[data-ai-preset]",data:"aiPreset",label:"aiPresetLabel",names:aiPresetLabels}
};
const owns=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const readStored=(key,fallback)=>{ try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw):fallback; } catch (_) { return fallback; } };
const writeStored=(key,value)=>{ try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch (_) { return false; } };
const validValues=values=>values&&typeof values==="object"&&!Array.isArray(values)?values:{};
// 입력 중인 빈칸·범위 밖 값은 저장하지 않고 직전에 저장한 값을 유지한다.
function collectAssumptions(previous){
  const values={},kept=validValues(previous);
  assumptionIds.forEach(id=>{
    const node=el(id),value=Number(node.value);
    if(node.value.trim()===""||!node.checkValidity()||!Number.isFinite(value)){ if(owns(kept,id)) values[id]=kept[id]; return; }
    if(value!==Number(assumptionDefaults[id])) values[id]=value;
  });
  const presets={};
  for(const [key,control] of Object.entries(presetControls)) presets[key]=document.querySelector(control.selector+".active")?.dataset[control.data]||"";
  return {values,presets};
}
function applyAssumptions(saved){
  const values=validValues(saved?.values);
  assumptionIds.forEach(id=>{
    const node=el(id),fallback=assumptionDefaults[id],value=values[id];
    // 보통 쓰는 값은 드래그로 미세 조정하고, 예전 저장본의 큰 값은 원래 범위를 열어 그대로 복원한다.
    if(node.dataset?.sliderMax) node.max=typeof value==="number"&&Number.isFinite(value)&&value>Number(node.dataset.sliderMax)?node.dataset.savedMax:node.dataset.sliderMax;
    node.value=owns(values,id)&&typeof value==="number"&&Number.isFinite(value)?String(value):fallback;
    if(node.value===""||!node.checkValidity()) node.value=fallback;
  });
  // HUMN 프리셋 이전 저장본에는 humn이 없다. HUMN 입력이 모두 기본값이면 기본 시나리오로 본다.
  const presets={...saved?.presets};
  if(typeof presets.humn!=="string") presets.humn=humnControlIds.every(id=>Number(el(id).value)===Number(assumptionDefaults[id]))?"base":"";
  if(typeof presets.ai!=="string") presets.ai=aiControlIds.every(id=>Number(el(id).value)===Number(assumptionDefaults[id]))?"base":"";
  for(const [key,control] of Object.entries(presetControls)){
    const chosen=presets[key],known=typeof chosen==="string"&&owns(control.names,chosen);
    document.querySelectorAll(control.selector).forEach(button=>button.classList.toggle("active",known&&button.dataset[control.data]===chosen));
    el(control.label).textContent=known?control.names[chosen]:"직접 조정";
  }
  render(); renderHumn(); renderBatteryEtfs(); renderAiSubscription();
}
const changedCount=values=>assumptionIds.filter(id=>owns(values,id)).length;
function describeAssumptions(values){
  const parts=assumptionGroups.map(([name,list])=>[name,list.filter(id=>owns(values,id)).length]).filter(([,count])=>count>0).map(([name,count])=>name+" "+count+"개");
  return parts.length?parts.join(" · ")+" 변경":"모두 기본값";
}
const scenarioSync={state:"off",message:"",at:"",checked:"",busy:false,again:false,timer:null};
const numericValues=values=>{ const source=validValues(values); return Object.fromEntries(Object.keys(source).sort().filter(id=>typeof source[id]==="number"&&Number.isFinite(source[id])).map(id=>[id,source[id]])); };
// 추가 프리셋은 있을 때만 남긴다. 옛 저장본·옛 코드 기기가 올린 기록에는 없는 필드를 보태지 않는다.
const presetChoices=presets=>({sdi:typeof presets?.sdi==="string"?presets.sdi:"",battery:typeof presets?.battery==="string"?presets.battery:"",...(typeof presets?.humn==="string"?{humn:presets.humn}:{}),...(typeof presets?.ai==="string"?{ai:presets.ai}:{})});
const assumptionKey=saved=>JSON.stringify([numericValues(saved?.values),presetChoices(saved?.presets)]);
// savedAt은 값이 실제로 바뀔 때만 새로 적는다. 기기 간에는 더 나중에 바꾼 쪽의 현재 조정값을 쓰므로
// 열어 보기만 한 기기(savedAt 없음)가 다른 기기에서 바꾼 조정값을 덮어쓰지 않는다.
let currentAssumptions={...collectAssumptions({}),savedAt:""}, assumptionSaveTimer=null, assumptionStorageOk=true;
function adoptAssumptions(saved){
  applyAssumptions(saved);
  currentAssumptions={...collectAssumptions({}),savedAt:typeof saved?.savedAt==="string"?saved.savedAt:""};
}
function showAssumptionState(){
  const values=validValues(currentAssumptions.values),count=changedCount(values);
  const sync={pending:" · 동기화 대기",busy:" · 동기화 중",done:" · 동기화됨",error:" · 동기화 오류"}[scenarioSync.state]||(count?" · 자동 저장됨":"");
  el("saveState").textContent=!assumptionStorageOk?"저장 안 됨":(count?"조정 "+count+"개":"기본값")+sync;
  el("currentSummary").textContent=(assumptionStorageOk?"":"이 브라우저에 저장할 수 없습니다 · ")+describeAssumptions(values);
}
function saveAssumptions(){
  clearTimeout(assumptionSaveTimer); assumptionSaveTimer=null;
  const next=collectAssumptions(currentAssumptions.values);
  if(assumptionKey(next)!==assumptionKey(currentAssumptions)){
    currentAssumptions={...next,savedAt:new Date().toISOString()};
    assumptionStorageOk=writeStored(ASSUMPTION_KEY,currentAssumptions);
    scheduleScenarioSync(5000);
  }
  showAssumptionState();
}
function scheduleAssumptionSave(){ clearTimeout(assumptionSaveTimer); assumptionSaveTimer=setTimeout(saveAssumptions,300); }
document.addEventListener("input",event=>{ if(assumptionIdSet.has(event.target.id)) scheduleAssumptionSave(); });
document.addEventListener("change",event=>{ if(assumptionIdSet.has(event.target.id)) saveAssumptions(); });
document.addEventListener("click",event=>{ if(event.target.closest?.("[data-preset],[data-battery-preset],[data-humn-preset],[data-ai-preset]")) saveAssumptions(); });
document.addEventListener("visibilitychange",()=>{ if(document.hidden&&assumptionSaveTimer) saveAssumptions(); });
window.addEventListener("pagehide",()=>{ if(assumptionSaveTimer) saveAssumptions(); });
const storedAssumptions=readStored(ASSUMPTION_KEY,null);
if(storedAssumptions&&typeof storedAssumptions==="object"&&!Array.isArray(storedAssumptions)) adoptAssumptions(storedAssumptions);
showAssumptionState();

const readScenarios=()=>{ const list=readStored(SCENARIO_LIST_KEY,[]); return Array.isArray(list)?list.filter(item=>item&&typeof item.id==="string"&&typeof item.name==="string"):[]; };
const sameValues=(a,b)=>assumptionIds.every(id=>(owns(a,id)?a[id]:null)===(owns(b,id)?b[id]:null));
const savedTime=iso=>{ const date=new Date(iso); return Number.isNaN(date.getTime())?"":date.toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}); };
const setSavesStatus=message=>{ el("savesStatus").textContent=message; };
function renderScenarioList(){
  const list=readScenarios(),host=el("scenarioList");
  host.replaceChildren(...list.map(item=>{
    const row=document.createElement("li"),meta=document.createElement("div"),name=document.createElement("strong"),detail=document.createElement("small"),actions=document.createElement("div");
    meta.className="saves-meta"; actions.className="saves-actions";
    name.textContent=item.name;
    detail.textContent=[savedTime(item.savedAt),describeAssumptions(validValues(item.values))].filter(Boolean).join(" · ");
    meta.append(name,detail);
    for(const [action,text,extra] of [["load","불러오기",""],["delete","삭제"," danger"]]){
      const button=document.createElement("button");
      button.type="button"; button.className="btn-line"+extra; button.textContent=text;
      button.dataset.scenarioAction=action; button.dataset.scenarioId=item.id;
      button.setAttribute("aria-label",item.name+" "+text);
      actions.append(button);
    }
    row.append(meta,actions);
    return row;
  }));
  el("scenarioEmpty").hidden=list.length>0;
}
// 저장본에 없는 조정값을 덮어쓰기 전에 확인한다.
function confirmReplaceCurrent(){
  saveAssumptions();
  const values=validValues(currentAssumptions.values);
  if(!changedCount(values)||readScenarios().some(item=>sameValues(validValues(item.values),values))) return true;
  return confirm("지금 조정한 가정은 저장한 목록에 없습니다. 계속하면 현재 조정값이 바뀝니다. 계속할까요?");
}
el("openSaves").addEventListener("click",()=>{ saveAssumptions(); renderScenarioList(); setSavesStatus(""); el("savesDialog").showModal(); syncScenarios(); });
el("closeSaves").addEventListener("click",()=>el("savesDialog").close());
el("savesDialog").addEventListener("click",event=>{ if(event.target===el("savesDialog")) el("savesDialog").close(); });
el("scenarioForm").addEventListener("submit",event=>{
  event.preventDefault();
  const name=el("scenarioName").value.trim().slice(0,40);
  if(!name){ setSavesStatus("저장할 이름을 입력하세요."); el("scenarioName").focus(); return; }
  saveAssumptions();
  const list=readScenarios(),existing=list.findIndex(item=>item.name===name);
  if(existing>=0&&!confirm("'"+name+"' 저장본을 현재 가정으로 덮어쓸까요?")) return;
  const entry={id:existing>=0?list[existing].id:(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random()),name,savedAt:new Date().toISOString(),values:currentAssumptions.values,presets:currentAssumptions.presets};
  if(existing>=0) list.splice(existing,1);
  list.unshift(entry);
  if(!writeStored(SCENARIO_LIST_KEY,list)){ setSavesStatus("이 브라우저에 저장하지 못했습니다. 개인정보 보호 모드나 저장 공간을 확인하세요."); return; }
  el("scenarioName").value="";
  renderScenarioList();
  setSavesStatus("'"+name+"'(으)로 저장했습니다.");
  scheduleScenarioSync(300);
});
el("scenarioList").addEventListener("click",event=>{
  const button=event.target.closest?.("[data-scenario-action]");
  if(!button) return;
  const list=readScenarios(),item=list.find(entry=>entry.id===button.dataset.scenarioId);
  if(!item){ renderScenarioList(); return; }
  if(button.dataset.scenarioAction==="load"){
    if(!confirmReplaceCurrent()) return;
    applyAssumptions(item); saveAssumptions();
    el("savesDialog").close();
  } else {
    if(!confirm("'"+item.name+"' 저장본을 삭제할까요?")) return;
    if(!writeStored(SCENARIO_LIST_KEY,list.filter(entry=>entry.id!==item.id))||!writeStored(DELETED_KEY,{...readDeleted(),[item.id]:new Date().toISOString()})){ setSavesStatus("삭제하지 못했습니다."); return; }
    renderScenarioList();
    setSavesStatus("'"+item.name+"'을(를) 삭제했습니다.");
    scheduleScenarioSync(300);
  }
});
el("resetAssumptions").addEventListener("click",()=>{
  if(!confirmReplaceCurrent()) return;
  applyAssumptions({values:{},presets:{sdi:"base",battery:"base",humn:"base",ai:"base"}}); saveAssumptions();
  el("savesDialog").close();
});

// 기기 간 동기화: 메인 플래너(index.html)에서 연결한 GitHub 비공개 데이터 저장소를 같이 쓴다.
// 저장소·토큰은 같은 사이트 localStorage의 index.html 키를 읽기만 하고, 기록 파일과 섞지 않도록 별도 파일에 저장한다.
// 저장본은 id별로 합치고(같은 id는 나중에 저장한 쪽), 삭제는 deleted 기록으로 전파한다.
// 현재 조정값은 더 나중에 바꾼 기기의 값을 쓰므로 충돌 확인 창이 필요 없다.
const SCENARIO_FILE="etf-planner-scenarios.json";
// 두 연결 키는 js/sync.js·js/assets-store.js도 읽으므로 이름을 바꾸면 세 파일을 함께 수정한다.
const SYNC_REPO_KEY="etf-planner-data-repo", SYNC_TOKEN_KEY="etf-planner-github-token";
function cleanDeleted(value){ const source=validValues(value); return Object.fromEntries(Object.keys(source).sort().filter(id=>typeof source[id]==="string").map(id=>[id,source[id]])); }
const readDeleted=()=>cleanDeleted(readStored(DELETED_KEY,{}));
const cleanSaved=item=>({values:numericValues(item.values),presets:presetChoices(item.presets),savedAt:typeof item.savedAt==="string"?item.savedAt:""});
function cleanScenarioData(data){
  if(!data||typeof data!=="object"||Array.isArray(data)||!Array.isArray(data.scenarios)||(data.version!==undefined&&data.version!==1)) return null;
  const current=data.current&&typeof data.current==="object"&&typeof data.current.savedAt==="string"&&data.current.savedAt?cleanSaved(data.current):null;
  const scenarios=data.scenarios.filter(item=>item&&typeof item.id==="string"&&typeof item.name==="string").map(item=>({id:item.id,name:item.name.slice(0,40),...cleanSaved(item)}));
  return {version:1,current,scenarios,deleted:cleanDeleted(data.deleted)};
}
const localScenarioData=()=>cleanScenarioData({current:currentAssumptions,scenarios:readScenarios(),deleted:readDeleted()});
function mergeScenarioData(local,remote){
  const deleted={...remote.deleted};
  Object.entries(local.deleted).forEach(([id,at])=>{ if(!(deleted[id]>=at)) deleted[id]=at; });
  const byId=new Map();
  [...remote.scenarios,...local.scenarios].forEach(item=>{ const seen=byId.get(item.id); if(!seen||item.savedAt>seen.savedAt) byId.set(item.id,item); });
  const scenarios=[...byId.values()].filter(item=>!(deleted[item.id]>=item.savedAt)).sort((a,b)=>a.savedAt<b.savedAt?1:a.savedAt>b.savedAt?-1:0);
  const current=remote.current&&(!local.current||remote.current.savedAt>=local.current.savedAt)?remote.current:local.current;
  return {version:1,current,scenarios,deleted:cleanDeleted(deleted)};
}
function readSyncConfig(){
  try {
    const repo=(localStorage.getItem(SYNC_REPO_KEY)||"").trim(),token=localStorage.getItem(SYNC_TOKEN_KEY)||"";
    return token&&/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)?{repo,token}:null;
  } catch (_) { return null; }
}
const toB64=text=>{ const bytes=new TextEncoder().encode(text); let bin=""; for(let i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(bin); };
const fromB64=b64=>new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g,"")),c=>c.charCodeAt(0)));
async function scenarioGh(config,path,options={}){
  repoSecurity.assertDataRepo(config.repo);
  const response=await fetch("https://api.github.com"+path,{cache:"no-store",...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:"Bearer "+config.token,...options.headers}});
  if(response.status===401) throw Error("GitHub 토큰이 맞지 않거나 만료됐습니다. 메인 플래너의 동기화 설정에서 새 토큰을 넣어 주세요.");
  if(response.status===403) throw Error("토큰 권한이 부족하거나 요청이 너무 많습니다. 토큰의 Contents 읽기·쓰기 권한을 확인해 주세요.");
  return response;
}
async function checkScenarioRepo(config){
  const response=await scenarioGh(config,"/repos/"+config.repo);
  if(response.status===404) throw Error("저장소 "+config.repo+"를 찾을 수 없습니다. 메인 플래너의 동기화 설정을 확인해 주세요.");
  if(!response.ok) throw Error("저장소 확인 실패 ("+response.status+")");
  if(!(await response.json()).private) throw Error(config.repo+"는 공개 저장소라 가정을 올리지 않았습니다. 비공개 저장소를 지정해 주세요.");
}
async function readRemoteScenarios(config){
  const path="/repos/"+config.repo+"/contents/"+SCENARIO_FILE,response=await scenarioGh(config,path);
  if(response.status===404) return {sha:"",data:null};
  if(!response.ok) throw Error("가정 읽기 실패 ("+response.status+")");
  const meta=await response.json();
  let text=meta.encoding==="base64"&&meta.content?fromB64(meta.content):null;
  if(text===null){ const raw=await scenarioGh(config,path,{headers:{Accept:"application/vnd.github.raw+json"}}); if(!raw.ok) throw Error("가정 읽기 실패 ("+raw.status+")"); text=await raw.text(); }
  let data=null; try { data=cleanScenarioData(JSON.parse(text)); } catch (_) { data=null; }
  if(!data) throw Error("저장소의 "+SCENARIO_FILE+" 형식을 확인할 수 없어 자동으로 덮어쓰지 않았습니다.");
  return {sha:meta.sha,data};
}
async function writeRemoteScenarios(config,data,sha){
  const body={message:"시나리오 가정 동기화 "+new Date().toISOString(),content:toB64(JSON.stringify(data,null,2)+"\n"),...(sha?{sha}:{})};
  const response=await scenarioGh(config,"/repos/"+config.repo+"/contents/"+SCENARIO_FILE,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(response.status===409||response.status===422){ const error=Error("다른 기기가 먼저 저장했습니다."); error.stale=true; throw error; }
  if(!response.ok) throw Error("가정 저장 실패 ("+response.status+")");
}
function setScenarioSyncState(state,message=""){
  const config=readSyncConfig();
  scenarioSync.state=state; scenarioSync.message=message;
  if(state==="done") scenarioSync.at=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
  el("scenarioSyncStatus").textContent={off:"연결 안 됨",pending:"잠시 후 동기화",busy:"동기화 중…",done:"동기화 완료 · "+scenarioSync.at,error:"동기화 오류 · 이 기기에는 저장됨"}[state];
  el("scenarioSyncError").textContent=message; el("scenarioSyncError").hidden=!message;
  el("scenarioSyncNow").hidden=!config; el("scenarioSyncOff").hidden=!!config; el("scenarioSyncOn").hidden=!config;
  el("scenarioSyncRepo").textContent=config?config.repo:"";
  showAssumptionState();
}
function adoptMergedScenarios(merged,local){
  writeStored(SCENARIO_LIST_KEY,merged.scenarios); writeStored(DELETED_KEY,merged.deleted);
  if(merged.current&&merged.current.savedAt>(local.current?.savedAt||"")){ adoptAssumptions(merged.current); assumptionStorageOk=writeStored(ASSUMPTION_KEY,currentAssumptions); }
  if(el("savesDialog").open) renderScenarioList();
}
async function syncScenarios(){
  const config=readSyncConfig();
  if(!config){ clearTimeout(scenarioSync.timer); scenarioSync.timer=null; setScenarioSyncState("off"); return; }
  if(scenarioSync.busy){ scenarioSync.again=true; return; }
  scenarioSync.busy=true; scenarioSync.again=false; clearTimeout(scenarioSync.timer); scenarioSync.timer=null;
  setScenarioSyncState("busy");
  try {
    if(scenarioSync.checked!==config.repo){ await checkScenarioRepo(config); scenarioSync.checked=config.repo; }
    for(let attempt=1;;attempt++){
      const remote=await readRemoteScenarios(config);
      if(assumptionSaveTimer) saveAssumptions();
      const local=localScenarioData(),merged=mergeScenarioData(local,remote.data||{current:null,scenarios:[],deleted:{}});
      adoptMergedScenarios(merged,local);
      const empty=!merged.current&&!merged.scenarios.length&&!Object.keys(merged.deleted).length;
      if(remote.data?JSON.stringify(merged)===JSON.stringify(remote.data):empty) break;
      try { await writeRemoteScenarios(config,merged,remote.sha); break; }
      catch (error) { if(!error.stale||attempt>=3) throw error; }
    }
    setScenarioSyncState(scenarioSync.timer?"pending":"done");
  } catch (error) {
    setScenarioSyncState("error",error?.name==="TypeError"&&/fetch|network|load/i.test(error.message)?"네트워크 연결을 확인해 주세요.":error?.message||String(error));
  } finally {
    scenarioSync.busy=false;
    if(scenarioSync.again) scheduleScenarioSync(300);
  }
}
function scheduleScenarioSync(delay){
  if(!readSyncConfig()) return;
  clearTimeout(scenarioSync.timer);
  scenarioSync.timer=setTimeout(()=>{ scenarioSync.timer=null; syncScenarios(); },delay);
  if(!scenarioSync.busy) setScenarioSyncState("pending");
}
el("scenarioSyncNow").addEventListener("click",()=>{ scenarioSync.checked=""; syncScenarios(); });
setInterval(()=>{ if(!document.hidden&&!scenarioSync.busy&&readSyncConfig()) syncScenarios(); },45000);
document.addEventListener("visibilitychange",()=>{
  if(!readSyncConfig()) return;
  if(!document.hidden) syncScenarios();
  else if(scenarioSync.timer) syncScenarios(); // 앱 전환·탭 닫기 전에 대기 중인 변경을 바로 올린다
});
window.addEventListener("storage",event=>{ if(event.key===null||event.key===SYNC_REPO_KEY||event.key===SYNC_TOKEN_KEY){ scenarioSync.checked=""; syncScenarios(); } });
const scenarioSyncReady=syncScenarios();
