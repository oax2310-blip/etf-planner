/* 시나리오 전용. 공개 경제통계만 읽고 개인 기록·가정 저장·시세에는 쓰지 않는다. */
(function () {
  'use strict';
  const labels = {krGdp:'한국 실질 GDP', usGdp:'미국 실질 GDP', krM2:'한국 M2', usM2:'미국 M2', fx:'원·달러 환율', krRate:'한국 기준금리', usRate:'미국 실효 연방기금금리'};
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const quarterIndex = period => {
    const match = /^(\d{4})-Q([1-4])$/.exec(period || '');
    return match ? Number(match[1])*4 + Number(match[2])-1 : null;
  };
  const quarterName = index => `${Math.floor(index/4)}-Q${index%4+1}`;
  const periodQuarter = period => {
    if (quarterIndex(period) !== null) return period;
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period || '');
    return match ? `${match[1]}-Q${Math.ceil(Number(match[2])/3)}` : null;
  };
  const average = values => values.reduce((sum, value) => sum+value, 0)/values.length;

  // 월 자료는 분기의 3개월이 모두 있을 때만 단순 평균. 보간·이전값 채우기 금지.
  // GDP는 실질 수준(t)/실질 수준(t-4)-1, M2는 분기 평균(t)/분기 평균(t-4)-1의 백분율.
  // 다른 definitionId 원계열은 연결하지 않는다. 한국 M2는 2025년 개편 기준 소급계열만 사용.
  function quarterly(series) {
    const result = new Map();
    if (!series || !['M','Q'].includes(series.frequency)) return result;
    const groups = new Map(), seen = new Set();
    for (const point of series.observations || []) {
      const q = periodQuarter(point.period);
      if (!q) continue;
      const valid = finite(point.value) && (series.kind === 'rate' || point.value > 0);
      if (seen.has(point.period)) { result.set(q, null); continue; }
      seen.add(point.period);
      if (series.frequency === 'Q') {
        if (quarterIndex(point.period) !== null) result.set(q, valid ? point.value : null);
      } else if (/^\d{4}-\d{2}$/.test(point.period)) {
        if (!groups.has(q)) groups.set(q, []);
        groups.get(q).push(valid ? point.value : null);
      }
    }
    for (const [q, values] of groups) {
      if (!result.has(q)) result.set(q, values.length === 3 && values.every(finite) ? average(values) : null);
    }
    return result;
  }
  function yoy(map, q) {
    const now = map.get(q), prev = map.get(quarterName(quarterIndex(q)-4));
    return finite(now) && finite(prev) && prev > 0 ? (now/prev-1)*100 : null;
  }
  function buildRows(data, years = 10, now = new Date()) {
    const series = data?.series || {};
    const maps = Object.fromEntries(Object.keys(labels).map(key => [key, quarterly(series[key])]));
    // 개편 M2 확인 전에는 값이 있어도 판단에서 제외(구지표·M3의 자동 대체 방지).
    if (series.krM2?.definitionId !== 'bok-m2-2025-revision') maps.krM2.clear();
    const current = now.getUTCFullYear()*4 + Math.floor(now.getUTCMonth()/3);
    const rows = [];
    for (let i = current-years*4; i < current; i++) {
      const q = quarterName(i), row = {quarter:q};
      for (const key of ['krGdp','usGdp','krM2','usM2']) row[key] = yoy(maps[key], q);
      row.krPressure = finite(row.krM2) && finite(row.krGdp) ? row.krM2-row.krGdp : null;
      row.usPressure = finite(row.usM2) && finite(row.usGdp) ? row.usM2-row.usGdp : null;
      row.pressure = finite(row.krPressure) && finite(row.usPressure) ? row.krPressure-row.usPressure : null;
      row.fx = maps.fx.get(q) ?? null;
      row.fxYoy = yoy(maps.fx, q);
      const krRate = maps.krRate.get(q), usRate = maps.usRate.get(q);
      row.rateGap = finite(krRate) && finite(usRate) ? usRate-krRate : null;
      row.missing = ['krGdp','usGdp','krM2','usM2'].filter(key => !finite(row[key]));
      rows.push(row);
    }
    return rows;
  }
  // 부호는 반올림 전에 판단. 중립은 정확히 0(임의의 ±0.5 같은 구간 없음).
  function direction(value) {
    return !finite(value) ? '자료 대기' : value > 0 ? '달러 강세 압력' : value < 0 ? '달러 약세 압력' : '중립';
  }
  // 최신 수정치의 사후 비교. 상관은 환율 수준 대신 같은 분기의 환율 전년 대비와 비교.
  // 1·4분기 뒤는 (t+h)/t-1. 발표 당시 자료가 없어 예측 성과로 부르지 않는다.
  // 중립·환율 보합은 방향 일치 분모에서 제외. n<12·분산 0이면 상관/R² 미산출.
  function validate(rows, horizon = 0) {
    const byQuarter = new Map(rows.map(row => [row.quarter, row])), pairs = [];
    for (const row of rows) {
      const later = byQuarter.get(quarterName(quarterIndex(row.quarter)+horizon));
      const change = horizon === 0 ? row.fxYoy : finite(row.fx) && row.fx > 0 && finite(later?.fx) ? (later.fx/row.fx-1)*100 : null;
      if (finite(row.pressure) && finite(change)) pairs.push([row.pressure, change]);
    }
    const n = pairs.length, directional = pairs.filter(([x,y]) => x !== 0 && y !== 0);
    const hits = directional.filter(([x,y]) => Math.sign(x) === Math.sign(y)).length;
    let r = null;
    if (n >= 12) {
      const mx = average(pairs.map(p=>p[0])), my = average(pairs.map(p=>p[1]));
      const xy = pairs.reduce((s,[x,y]) => s+(x-mx)*(y-my), 0);
      const xx = pairs.reduce((s,[x]) => s+(x-mx)**2, 0), yy = pairs.reduce((s,[,y]) => s+(y-my)**2, 0);
      if (xx > 0 && yy > 0) r = Math.max(-1, Math.min(1, xy/Math.sqrt(xx*yy)));
    }
    return {n, r, r2:finite(r) ? r*r : null, hits, directionalN:directional.length,
      hitRate:n >= 12 && directional.length >= 12 ? hits/directional.length*100 : null};
  }
  const api = {quarterIndex, quarterName, quarterly, yoy, buildRows, direction, validate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;
  const root = document.getElementById('currency-pressure');
  if (!root) return;
  const el = id => document.getElementById(id);
  const fmt = (value, unit='%', signed=true) => !finite(value) ? '—' : `${signed && value>0 ? '+' : ''}${value.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})}${unit}`;
  const qLabel = q => q?.replace('-Q','년 ')+'분기';
  const dateLabel = date => !date ? '확인 안 됨' : date.includes('T') && Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date)) : date.slice(0,10);
  let dataset = null, rows = [], years = 10, selectedQuarter = null;
  const svgNode = (tag, attrs={}) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
    return node;
  };
  function drawChart() {
    const svg = el('cpChart'); svg.replaceChildren();
    const w=Math.min(720,Math.max(300,svg.clientWidth || 720)), h=230, left=49, right=el('cpCompareFx').checked?65:22, top=25, bottom=30;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const x = i => left+i*(w-left-right)/Math.max(1,rows.length-1);
    const values = rows.map(r=>r.pressure).filter(finite), extent=Math.max(2,...values.map(Math.abs))*1.15;
    const y = value => top+(extent-value)/(extent*2)*(h-top-bottom);
    const text = (tx,ty,value,cls,anchor='start') => { const n=svgNode('text',{x:tx,y:ty,class:cls,'text-anchor':anchor});n.textContent=value;svg.append(n); };
    for (const value of [-extent/1.15,0,extent/1.15]) {
      svg.append(svgNode('line',{x1:left,x2:w-right,y1:y(value),y2:y(value),class:value===0?'cp-zero':'cp-grid'}));
      text(left-7,y(value)+4,value.toFixed(0),'cp-axis','end');
    }
    text(left,14,'%p','cp-axis');
    const path = (key,toY,cls) => {
      let d='', previous=false;
      rows.forEach((row,i)=>{ if(finite(row[key])){d+=`${previous?'L':'M'}${x(i).toFixed(2)},${toY(row[key]).toFixed(2)} `;previous=true;}else previous=false; });
      if (d) svg.append(svgNode('path',{d,class:cls,fill:'none'}));
    };
    path('pressure',y,'cp-line');
    if (el('cpCompareFx').checked) {
      const fx = rows.map(r=>r.fx).filter(finite);
      if (fx.length) {
        const min=Math.min(...fx)*.97, max=Math.max(...fx)*1.03, fy=v=>top+(max-v)/(max-min)*(h-top-bottom);
        path('fx',fy,'cp-fx-line');
        text(w-right+8,top+4,Math.round(max).toLocaleString('ko-KR'),'cp-fx-axis');
        text(w-right+8,h-bottom,Math.round(min).toLocaleString('ko-KR'),'cp-fx-axis');
        text(w-right+8,14,'원/$','cp-fx-axis');
      }
    }
    [0,Math.floor((rows.length-1)/2),rows.length-1].forEach(i=>text(x(i),h-8,rows[i]?.quarter.replace('-Q',' Q')||'','cp-axis',i===0?'start':i===rows.length-1?'end':'middle'));
    const si = rows.findIndex(row=>row.quarter===selectedQuarter);
    if (si >= 0) {
      svg.append(svgNode('line',{x1:x(si),x2:x(si),y1:top,y2:h-bottom,class:'cp-cursor'}));
      if (finite(rows[si].pressure)) svg.append(svgNode('circle',{cx:x(si),cy:y(rows[si].pressure),r:4,class:'cp-point'}));
    }
    el('cpChartEmpty').hidden=values.length>0;
    el('cpChartEmpty').textContent=el('cpCompareFx').checked && rows.some(r=>finite(r.fx)) ? '통화압력은 공통 분기 자료 확인 후 표시됩니다. 환율은 공식 월평균 자료입니다.' : '공통 분기 자료 확인 후 통화압력 추이가 표시됩니다.';
  }
  function renderSelected() {
    const row=rows.find(r=>r.quarter===selectedQuarter);
    el('cpSelected').textContent=row ? `${qLabel(row.quarter)} · 압력 ${fmt(row.pressure,'%p')} · 환율 ${fmt(row.fx,'원',false)}` : '비교할 자료 없음';
    el('cpQuarter').value=selectedQuarter || '';
    drawChart();
  }
  function render() {
    rows=buildRows(dataset,years);
    const latest=[...rows].reverse().find(r=>finite(r.pressure));
    const reference=latest || [...rows].reverse().find(r=>finite(r.usGdp)&&finite(r.krGdp)) || rows.at(-1);
    el('cpDirection').textContent=direction(latest?.pressure);
    root.dataset.direction=!latest?'pending':latest.pressure>0?'strong':latest.pressure<0?'weak':'neutral';
    el('cpValue').textContent=fmt(latest?.pressure,'',true);
    el('cpPeriod').textContent=latest ? `최신 공통 비교 · ${qLabel(latest.quarter)}` : '같은 분기 GDP·M2 자료 대기';
    el('cpSummary').textContent=latest ? latest.pressure===0?'양국의 통화압력이 같습니다.':'한국의 통화압력이 미국보다 '+(latest.pressure>0?'높습니다.':'낮습니다.') : '네 가지 성장률이 같은 분기로 확인되어야 강약을 판단합니다.';
    el('cpComparePeriod').textContent=reference?`${qLabel(reference.quarter)} · 전년 동기 대비`:'동일 분기 비교 대기';
    for (const key of ['krGdp','usGdp','krM2','usM2','krPressure','usPressure']) el('cp'+key[0].toUpperCase()+key.slice(1)).textContent=fmt(reference?.[key],key.endsWith('Pressure')?'%p':'%');
    el('cpEquation').textContent=latest ? `(${fmt(latest.krM2,'')} − ${fmt(latest.krGdp,'')}) − (${fmt(latest.usM2,'')} − ${fmt(latest.usGdp,'')}) = ${fmt(latest.pressure,'%p')}` : '(한국 M2 − 한국 GDP) − (미국 M2 − 미국 GDP)';
    const missing=rows.at(-1)?.missing || [], failures=Object.values(dataset?.series||{}).some(s=>s.status==='error');
    const old=latest && latest.quarter!==rows.at(-1)?.quarter;
    const cacheOld=dataset?.generatedAt && Date.now()-Date.parse(dataset.generatedAt)>8*86400000;
    el('cpDataNote').textContent=[missing.length ? `${qLabel(rows.at(-1).quarter)} 대기·결측: ${missing.map(k=>labels[k]).join(', ')}.` : '',old?'마지막으로 계산 가능한 공통 분기를 표시합니다.':'',failures?'일부 수집에 실패하여 마지막 확인 자료를 유지합니다.':'',cacheOld?'공개 자료 갱신이 8일 이상 지연되었습니다.':'',!latest?'빈 값은 0으로 계산하지 않습니다.':''].filter(Boolean).join(' ');
    el('cpRate').textContent=finite(reference?.rateGap)?`같은 분기 금리차 · 미국 − 한국 ${fmt(reference.rateGap,'%p')}`:'보조 금리차 · 같은 분기 금리 자료 대기';
    el('cpQuarter').replaceChildren(...rows.map(row=>{const option=document.createElement('option');option.value=row.quarter;option.textContent=qLabel(row.quarter)+(finite(row.pressure)?'':' · 압력 결측');return option;}));
    if (!rows.some(row=>row.quarter===selectedQuarter)) selectedQuarter=reference?.quarter;
    renderSelected(); renderValidation(); renderSources();
    el('cpFetched').textContent='공개 자료 확인 · '+dateLabel(dataset?.generatedAt);
  }
  function renderValidation() {
    const horizon=Number(el('cpHorizon').value), result=validate(rows,horizon);
    el('cpValidation').textContent=result.n<12 ? `검증 대기 · 유효 ${result.n}분기 / 최소 12분기` : `유효 ${result.n}분기 · 상관계수 ${fmt(result.r,'',false)} · R² ${fmt(result.r2,'',false)} · 방향 일치 ${fmt(result.hitRate,'%',false)} (${result.hits}/${result.directionalN})`;
    el('cpValidationNote').textContent=(horizon?'압력과 이후 '+(horizon===1?'3':'12')+'개월의 분기 평균 환율 변화율을 비교합니다.':'압력과 같은 분기 환율의 전년 동기 대비 변화율을 비교합니다.')+' 최신 수정자료의 사후 비교이며, 당시 발표 시차를 반영한 실시간 예측 성과가 아닙니다. 상관계수·R²는 분산이 0이면 산출하지 않습니다.';
  }
  function renderSources() {
    const body=el('cpSources');body.replaceChildren();
    for (const [key,label] of Object.entries(labels)) {
      const s=dataset?.series?.[key], tr=document.createElement('tr');
      const link=document.createElement('a'); link.textContent=(s?.sourceName || (key.startsWith('kr')?'한국은행 ECOS':'FRED'))+(s?.code?' · '+s.code:'');
      const source=s?.sourceUrl;
      link.href=source && /^https:\/\/(fred\.stlouisfed\.org|ecos\.bok\.or\.kr)(\/|$)/.test(source)?source:'https://ecos.bok.or.kr/';
      link.target='_blank';link.rel='noopener noreferrer';
      const point=s?.observations?.at(-1), latest=point?.period;
      for(const content of [label,latest || '자료 대기',dateLabel(s?.releaseDate),dateLabel(s?.sourceUpdatedAt),dateLabel(s?.fetchedAt),link,s?.status==='error'?'수집 실패 · 마지막 자료':s?.status==='ready'?(point && !finite(point.value)?'최근 값 결측':'확인'):s?.message || '미연결']) {
        const td=document.createElement('td');if(typeof content==='string')td.textContent=content;else td.append(content);tr.append(td);
      }
      body.append(tr);
    }
  }
  async function refresh() {
    const button=el('cpRefresh');button.disabled=true;el('cpLoadStatus').textContent='공개 자료 확인 중…';
    try {
      const response=await fetch('data/currency-pressure.json',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('자료 파일을 읽지 못했습니다.');
      const data=await response.json();
      const valid=data?.schemaVersion===1 && data.series && typeof data.series==='object' && !Array.isArray(data.series) && typeof data.generatedAt==='string' && Number.isFinite(Date.parse(data.generatedAt)) &&
        Object.values(data.series).every(s=>s && typeof s==='object' && (s.observations===undefined || Array.isArray(s.observations) && s.observations.every(point=>point && typeof point.period==='string' && periodQuarter(point.period) && (point.value===null || finite(point.value)))));
      if(!valid)throw Error('자료 형식을 확인할 수 없습니다.');
      if(!dataset)selectedQuarter=null; // 첫 수집 완료 시에는 최신 공통 분기로 맞춘다.
      dataset=data;render();el('cpLoadStatus').textContent='';
    } catch (_) { el('cpLoadStatus').textContent=dataset?'자료 확인 실패 · 마지막으로 확인한 자료 유지':'자료를 불러오지 못했습니다. 다시 확인해 주세요.'; }
    finally {button.disabled=false;}
  }
  el('cpRefresh').addEventListener('click',refresh);
  root.querySelectorAll('[data-cp-years]').forEach(button=>button.addEventListener('click',()=>{years=Number(button.dataset.cpYears);root.querySelectorAll('[data-cp-years]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
  el('cpCompareFx').addEventListener('change',drawChart);
  el('cpHorizon').addEventListener('change',renderValidation);
  el('cpQuarter').addEventListener('change',()=>{selectedQuarter=el('cpQuarter').value;renderSelected();});
  el('cpChart').addEventListener('pointerdown',event=>{
    const rect=el('cpChart').getBoundingClientRect(), width=el('cpChart').viewBox.baseVal.width, x=(event.clientX-rect.left)/rect.width*width;
    const i=Math.max(0,Math.min(rows.length-1,Math.round((x-49)/(width-49-(el('cpCompareFx').checked?65:22))*(rows.length-1))));
    selectedQuarter=rows[i]?.quarter;renderSelected();
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('resize',drawChart);
  setInterval(()=>{if(!document.hidden)refresh();},3600000);
  render();refresh();
})();
