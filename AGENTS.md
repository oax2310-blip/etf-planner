# 작업 진입점

- 이 파일 → 관련 파일 머리 → 필요한 함수·호출부·테스트 순서. README는 필요한 절만 읽는다.
- 점검·수정 요청에서는 보고된 증상뿐 아니라 관련 기능의 다른 오류와 회귀도 함께 확인한다.
- 공개 소스·기본값에 개인 보유 종목·금액·수량·손익·메모·토큰·기기 구독 정보를 넣지 않는다. 기록은 브라우저와 비공개 데이터 저장소에만 둔다.
- 저장 키·필드·옛 기록 호환 유지(변경 시 이전 코드). normalize·불러오기에서 새 필드 생성 금지; 입력 때만 저장, 비운 선택 필드는 delete.
- main 최신 상태 기준으로 관련 부분만 수정. 요청은 한 브랜치, 마지막에 PR→병합(Pages 자동 게시).
- 화면 변경은 병합 전 바뀐 화면 캡처만으로 사용자 확인. 글자만 바꾸는 작은 변경은 캡처 생략.
- 사용자에게 보여 주는 시안은 항상 다크 화면. 폰 시안은 393×852·터치·sRGB·기존 Pretendard 글꼴로 캡처 조건을 고정하고 마우스 호버를 해제한다. 사이트의 다크 테마와 삼성 인터넷의 웹페이지 다크 색 변환을 구분해 확인한다. 기본 시안은 대기 회차로 상태를 맞추고, 부분 체결·기준가 도달 예시는 따로 표시한다.
- 빌드·외부 라이브러리 추가 금지(기존 Pretendard CSS 제외). 일반 script 전역 이름은 중복 금지.
- CSS·JS 변경 시 세 HTML의 로컬 참조 ?v=를 함께 +1. 로딩 순서는 script 태그·tests/files.test.cjs가 기준. theme.js만 head의 CSS 앞에서 바로 실행, 나머지 script는 defer(CSP meta가 미리 받기를 꺼서), 인라인 script 금지.
- 검증: node --test --test-reporter=dot tests/*.cjs(성공은 점, 실패만 상세. 파일만 집계되면 --experimental-test-isolation=none 추가). 수정 중에는 grep -l 파일명 tests/*.cjs로 찾은 관련 테스트부터. 계산 규칙은 담당 함수 주석에만 두고 변경 시 같이 수정.
- 수집기 고정 실행 파일(js/ma-ladder.js·prices.js·rebuy.js·trade-alerts.js·assets-calc.js)은 이름·위치·분리를 바꾸지 않고, DOM 없는 최상위 실행과 전역 진입점 buildTradeAlertRules·purchaseAlertRules를 유지. 수정하면 CLAUDE.md의 SHA 갱신 검토 대상.
- 큰 파일은 통째로 읽지 않는다: README는 grep -n '^## ' README.md로 절 위치부터, Actions가 갱신하는 data/currency-pressure.json(검색 제외: .ignore)·sp500-tr.json은 필요한 키만.
- 날짜별 변경 기록은 git log/PR에만. 자료 조회일·출처는 유지.

## 파일 지도
- 뼈대: index.html(초기화 js/start.js); 상태·입력: js/core.js; 동기화: js/sync.js; 시세: js/prices.js.
- 매매: js/plans.js·futures.js·rebuy.js·purchases.js; 공통 회차: js/ma-ladder.js. 달러선물은 계산·화면 futures.js, 분할매수 계획 창 futures-plan.js, 신저점 손절 후 재매수 화면 futures-rebuy.js(계산은 rebuy.js).
- 계획 창 종목 검색(분할매수·분할매도·재매수 공통): js/item-search.js; 체결 연동 UI: js/alloc-link.js; 자산·매수 계산: js/assets-calc.js; 공유 저장: js/assets-store.js.
- 자산 배분 종목의 분할매수·분할매도·재매수 편입·매수중/매도중 표시: js/member-link.js(읽기 전용 계산·이동 주소), 플래너 도착 이동: js/member-go.js.
- 자산 화면: assets.html·js/assets.js(공통·탭·자산 배분), 탭별 js/assets-ledger.js(월별 손익)·assets-savings.js(저축)·assets-installments.js(할부), 동기화 표시·첫 화면 js/assets-start.js; 월별 손익 S&P 500 비교: js/ledger-benchmark.js(월말 자료 수집 scripts/collect-sp500.cjs → data/sp500-tr.json, 금 collect-gold.cjs → data/gold-etf.json, 끝난 달 판정 month-close.cjs); 시나리오: valuation.html(본문)·css/valuation.css·js/valuation.js(계산, ASSUMPTION_KEY 이후 가정 저장·동기화), 원·달러 js/currency-pressure.js.
- 알림: js/trade-alerts.js·alerts.js·push.js·alert-target.js·push-sw.js. 서버 공유 계약은 계산 함수 주석 확인.
- 종목 표시 이름(목록·제목·푸시·알림내역 글자, 기록은 코드 그대로): js/stock-names.js(페이지·push-sw.js 공용).
- 디자인: css/app.css·assets.css·purchases.css; 화면 모드: js/theme.js.
