# 원·달러 상대 통화강도

시나리오의 **원·달러** 항목에 표시한다. 계산 규칙은 `js/currency-pressure.js` 담당 함수 주석이 기준이며 임의 점수·가중치는 없다. 개인 거래 기록이나 시나리오 저장 필드는 추가하지 않는다.

## 현재 데이터 연결 상태

2026-10-12에 공식 FRED 데이터 표에서 확인한 2015년 이후 미국 GDP·M2, 한국 실질 GDP(IMF/FRED), 실제 환율 월평균을 공개 캐시에 넣었다. 한국 M2는 미연결이다. 값·강약·상관·방향 일치율은 만들지 않았으며 화면에서 자료 대기로 표시한다. FRED의 한국 M2 `MYAGM2KRM189S`는 2017년 5월까지만 있어 최신 판단에 사용할 수 없다. OECD/FRED의 M3·광의통화 계열로 M2를 대체하지 않는다.

한국은행은 2025년 말 통화지표를 개편하고 2026년부터 신·구 M2를 병행 발표한다. 신지표 기준으로 소급한 **계절조정 평잔 M2 수준**을 확인해야 한다. 구지표와 신지표를 연결하면 기준 변경이 통화 증가로 오인될 수 있다.

- [한국은행 통화지표 개편 설명](https://www.bok.or.kr/portal/bbs/B0000168/view.do?menuNo=200058&nttId=10096090)
- [한국은행 유동성과 환율 해설](https://www.bok.or.kr/portal/bbs/B0000347/view.do?menuNo=201106&nttId=10095141)
- [FRED 미국 M2](https://fred.stlouisfed.org/series/M2SL)
- [FRED 미국 실질 GDP](https://fred.stlouisfed.org/series/GDPC1)
- [FRED 한국 실질 GDP](https://fred.stlouisfed.org/series/NGDPRSAXDCKRQ)
- [FRED 실제 원·달러 월평균](https://fred.stlouisfed.org/series/EXKOUS)
- [중단된 한국 M2](https://fred.stlouisfed.org/series/MYAGM2KRM189S)

## 자동 수집 연결

브라우저에는 인증키를 넣지 않는다. GitHub 저장소 **Settings → Secrets and variables → Actions**에서 `ECOS_API_KEY`를 등록한다. `FRED_API_KEY`는 선택 사항이며 FRED의 출처 갱신일 확인에 사용한다. FRED 원자료 CSV는 키 없이 조회한다. 키를 소스·이슈·PR·채팅에 쓰지 않는다.

`data/currency-sources.json`의 `krM2`는 개편 계열을 확인하기 전까지 `null`이다. ECOS의 공식 통계표와 항목 코드를 확인한 뒤 아래 형식으로 지정한다. 예시의 자리표시는 실제 코드가 아니므로 그대로 실행할 수 없다.

```json
{
  "krM2": {
    "table": "확인한_통계표코드",
    "items": ["확인한_항목코드"],
    "frequency": "M",
    "kind": "money",
    "definitionId": "bok-m2-2025-revision",
    "basis": "period-average",
    "seasonalAdjustment": "SA",
    "verifiedAt": "YYYY-MM-DD",
    "unit": "공식 원자료 단위"
  },
  "krRate": null
}
```

공식 M2 개편 기준·평잔·계절조정·소급 기간을 모두 검토하고 `verifiedAt`에 확인일을 넣는다. 인증키가 있는 로컬 또는 서버에서 `node scripts/collect-currency-pressure.cjs --discover`로 ECOS M2/기준금리 통계표 후보를 조회할 수 있다. 조회 결과와 ECOS 통계검색에서 항목을 확인해야 하며, 프로그램이 구지표를 임의 선택하지 않는다. 한국 기준금리는 선택적으로 같은 방식으로 연결한다(`frequency: "M"`, `kind: "rate"`, `definitionId`와 원자료 코드·단위 필요).

`node scripts/collect-currency-pressure.cjs`는 최근 11년 원자료를 조회한다. 10년 추이의 전년 대비 계산에 이전 1년이 필요하다. `.github/workflows/currency-pressure.yml`은 평일 UTC 22:20(한국 다음 날 07:20)에 수집하며 Actions에서 수동 실행도 가능하다. 기본 브랜치 병합 후 예약이 활성화된다. 공개 경제통계 JSON만 커밋하고 Pages 빌드를 요청한다. 저장소의 Actions 쓰기 권한·브랜치 보호 규칙·Pages 설정에 따라 첫 실행을 확인해야 한다.

현재 개발 환경의 네트워크 정책에는 FRED·ECOS 호스트가 허용되어 있지 않고 ECOS 인증키도 없다. 실제 수집 API의 종단간 연결은 이 환경에서 검증하지 못했다. 초기 FRED 캐시는 공식 데이터 표를 별도로 조회해 확보한 값이며, 자동 수집 성공을 뜻하지 않는다.

## 발표 지연·개정 처리

`releaseDate`(공식 발표일), `sourceUpdatedAt`(출처 갱신일), `fetchedAt`(성공한 조회), `lastAttemptAt`(마지막 시도)을 구분한다. CSV와 ECOS StatisticSearch에서 발표일을 제공하지 않으면 `releaseDate`는 `null`로 유지한다. FRED API의 `last_updated`도 공식 발표일로 바꾸지 않는다. ECOS 발표 캘린더·공식 발표문을 추가 연결하면 실제 발표일을 채울 수 있다.

수집 실패 시 같은 정의·코드의 마지막 원자료만 유지하고 상태를 `error`로 표시한다. 계열 설정이 바뀌면 이전 계열을 재사용하지 않는다. 성공 시 전 기간을 다시 조회해 수정값을 반영하며 `revisedPeriods`·`lastRevisionAt`에 수정 감지 시점을 남긴다. `firstSeenAt`은 수집기가 처음 확인한 시각으로 실제 공식 발표 시각과 다르다. 이전 원자료는 Git 이력에 남는다. 초기 공개 캐시의 조회일은 날짜 단위다.

자료 연결 후 최신 공통 분기가 없으면 마지막 계산 가능한 분기를 표시하고, 최근 분기의 대기·결측 지표를 함께 안내한다. 공개 캐시 갱신이 8일 이상 늦으면 지연을 표시한다. 통계 자체의 최신 대상 기간과 캐시의 조회일은 다른 개념이다.

## 신뢰성 검토

MV = PY에서 유통속도와 통화수요가 안정적이라는 조건 아래 통화량 증가와 실질성장의 차이는 물가압력과 관련될 수 있다. 이를 양국 차이로 비교하는 것은 장기 상대가격 압력을 살펴보는 휴리스틱이다. 구매력평가가 단·중기 환율을 보장하지 않으며, 통화량과 환율은 역인과·공통 충격을 갖는다. 한국 M2와 미국 M2의 상품 범위·만기 기준은 동일하지 않다. 미국 실효 연방기금금리와 한국 기준금리도 동일 종류의 금리가 아니다.

화면의 검증은 최신 수정자료에 대한 사후 비교다. 유효 표본 수·상관계수·표본 내 R²·방향 일치의 분자/분모를 드러낸다. 표본 부족·상수열·결측이면 결과를 유보한다. 이번 초기 상태는 한국 M2가 없으므로 설명력이 있었다는 결론을 낼 수 없다.

실제 예측력 검증에는 발표 당시 사용 가능한 GDP·M2의 빈티지와 발표 시각이 필요하다. ALFRED 미국 자료와 한국은행 과거 발표본을 확보한 후 시간순으로 학습·검증하고, 3·6·12개월 환율 변화에 대해 환율 유지·단순 추세 기준모형과 비교해야 한다. 중립 구간이나 금리차의 가중치는 훈련 구간에서만 결정하고 표본 밖 성능으로 검증한다. 겹치는 전년 대비 기간의 자기상관·구조 변화도 고려해야 한다. 금리차·경상수지·위험지표를 추가한 모형은 별도 검증 전까지 핵심 계산에 합산하지 않는다.
