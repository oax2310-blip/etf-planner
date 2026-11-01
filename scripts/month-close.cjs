// 미국 거래소 종가로 ‘끝난 달’을 정하는 기준일(collect-sp500.cjs·collect-gold.cjs 공용). 네트워크·개인 기록·토큰을 쓰지 않는다.
// 수집기의 summarize는 이 기준일이 속한 달보다 앞선 달만 월말 종가로 남긴다.
// 기준일 = 거래소 시간대의 오늘. 단, 그달에 남은 거래일이 없으면 다음 달 1일이다:
//  - 그달 마지막 평일(월~금)을 지났다(주말로 끝나는 달, 예: 2026-10-31 토요일 → 2026-11-01).
//  - 오늘이 그 마지막 평일이고 거래소 시각 CLOSE_HOUR시(16시 장 마감 1시간 뒤) 이후이며 오늘 종가를 받았다.
// 마지막 평일이 휴장이거나 그날 종가가 아직 없으면 다음 날(다음 달)까지 기다린다. 12월이면 다음 해 1월 1일이다.
const CLOSE_HOUR=17;
function zoned(now, timeZone){
  const part=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${part.year}-${part.month}-${part.day}`,hour:Number(part.hour)};
}
// y년 m월(1~12)의 마지막 평일(YYYY-MM-DD). 휴장일은 따지지 않는다.
function lastWeekday(y, m){
  let d=new Date(Date.UTC(y,m,0));
  while(d.getUTCDay()===0||d.getUTCDay()===6)d=new Date(d.getTime()-864e5);
  return d.toISOString().slice(0,10);
}
function closedMonthCutoff(now, timeZone, points=[]){
  const {date,hour}=zoned(now,timeZone), y=Number(date.slice(0,4)), m=Number(date.slice(5,7)), last=lastWeekday(y,m);
  const closed=date>last||(date===last&&hour>=CLOSE_HOUR&&points.some(p=>p?.date===date));
  if(!closed)return date;
  return m===12?`${y+1}-01-01`:`${y}-${String(m+1).padStart(2,'0')}-01`;
}
module.exports={CLOSE_HOUR,lastWeekday,closedMonthCutoff};
