// S&P 500·금 수집기 공용 ‘끝난 달’ 기준일(scripts/month-close.cjs)을 네트워크 없이 검증한다.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CLOSE_HOUR,lastWeekday,closedMonthCutoff}=require('../scripts/month-close.cjs');
const NY='America/New_York';
const at=iso=>new Date(iso);
const bar=date=>({date,close:100});

test('그달 마지막 평일은 주말을 건너뛰고 휴장일은 따지지 않는다',()=>{
  assert.equal(lastWeekday(2026,10),'2026-10-30','10월 31일 토요일 → 30일 금요일');
  assert.equal(lastWeekday(2026,5),'2026-05-29','5월 31일 일요일 → 29일 금요일');
  assert.equal(lastWeekday(2026,9),'2026-09-30');
  assert.equal(lastWeekday(2027,2),'2027-02-26','2월 28일 일요일');
  assert.equal(lastWeekday(2027,5),'2027-05-31','휴장(메모리얼 데이)이어도 평일');
});

test('주말로 끝나는 달은 마지막 금요일이 지나면 다음 달 1일을 기준일로 준다',()=>{
  const points=[bar('2026-10-29'),bar('2026-10-30')];
  assert.equal(closedMonthCutoff(at('2026-10-31T22:40:00Z'),NY,points),'2026-11-01','뉴욕 10월 31일 토요일 저녁');
  assert.equal(closedMonthCutoff(at('2026-10-31T04:10:00Z'),NY,points),'2026-11-01','뉴욕 10월 31일 0시 10분');
  assert.equal(closedMonthCutoff(at('2026-10-31T04:10:00Z'),NY,[]),'2026-11-01','주말이면 종가 목록과 관계없다');
  assert.equal(closedMonthCutoff(at('2027-12-31T23:00:00Z'),NY,[bar('2027-12-30'),bar('2027-12-31')]),'2028-01-01','12월 31일 금요일 장 마감 뒤 → 다음 해');
  assert.equal(closedMonthCutoff(at('2022-12-31T15:00:00Z'),NY,[]),'2023-01-01','12월 31일 토요일 → 다음 해 1월 1일');
});

test('마지막 평일은 장 마감 1시간 뒤이고 그날 종가가 있을 때만 끝난 달로 본다',()=>{
  const day=[bar('2026-09-29'),bar('2026-09-30')], before=[bar('2026-09-29')];
  assert.equal(CLOSE_HOUR,17);
  assert.equal(closedMonthCutoff(at('2026-09-30T22:40:00Z'),NY,day),'2026-10-01','뉴욕 18시 40분(서머타임)');
  assert.equal(closedMonthCutoff(at('2026-09-30T20:59:00Z'),NY,day),'2026-09-30','뉴욕 16시 59분은 기다린다');
  assert.equal(closedMonthCutoff(at('2026-09-30T21:00:00Z'),NY,day),'2026-10-01','뉴욕 17시 정각');
  assert.equal(closedMonthCutoff(at('2026-09-30T22:40:00Z'),NY,before),'2026-09-30','그날 종가가 아직 없으면 기다린다');
  assert.equal(closedMonthCutoff(at('2027-05-31T22:40:00Z'),NY,[bar('2027-05-28')]),'2027-05-31','휴장한 마지막 평일은 다음 날까지');
  assert.equal(closedMonthCutoff(at('2026-12-31T22:40:00Z'),NY,[bar('2026-12-31')]),'2027-01-01','겨울 22시 40분 UTC는 뉴욕 17시 40분 → 다음 해');
  assert.equal(closedMonthCutoff(at('2026-12-31T21:40:00Z'),NY,[bar('2026-12-31')]),'2026-12-31','겨울 뉴욕 16시 40분은 기다린다');
});

test('그 밖의 날은 거래소 시간대의 오늘이며, 한국 날짜가 넘어가도 뉴욕 날짜를 쓴다',()=>{
  assert.equal(closedMonthCutoff(at('2026-10-16T22:40:00Z'),NY,[bar('2026-10-16')]),'2026-10-16');
  assert.equal(closedMonthCutoff(at('2026-10-29T22:40:00Z'),NY,[bar('2026-10-29')]),'2026-10-29','마지막 평일 전날');
  assert.equal(closedMonthCutoff(at('2026-10-01T06:00:00Z'),NY,[bar('2026-09-30')]),'2026-10-01','뉴욕도 이미 다음 달');
  assert.equal(closedMonthCutoff(at('2026-09-30T15:30:00Z'),NY,[bar('2026-09-29')]),'2026-09-30','한국은 10월 1일 0시 30분이어도 뉴욕은 9월 30일 장중');
  assert.equal(closedMonthCutoff(at('2026-09-30T16:00:00Z'),NY,[bar('2026-09-30')]),'2026-09-30','장중은 기다린다');
});
