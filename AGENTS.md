# 작업 진입점

- 사용자에게 보내는 답·요약·질문·파일 캡션은 모두 한국어로 쓴다(코드·명령·파일 이름·오류 원문은 그대로).
- 이 파일 → 관련 파일 머리 → 필요한 함수·호출부·테스트 순서. README는 필요한 절만 읽는다.
- 점검·수정 요청에서는 보고된 증상뿐 아니라 관련 기능의 다른 오류와 회귀도 함께 확인한다. 고치는 작업은 아래 "수정·보완 자가 점검"을 거친다.
- 점검에서 발견 사항이 하나라도 있으면 최종 답변에 전체 항목을 담은 복사용 보완 프롬프트를 코드 블록 하나로 함께 제공한다. 항목마다 파일·줄, 재현 방법, 기대 결과와 확인 방법을 적는다. 미확인 가설은 검증을 요청하는 항목으로 표시한다.
- 공개 소스·기본값에 개인 보유 종목·금액·수량·손익·메모·토큰·기기 구독 정보를 넣지 않는다. 기록은 브라우저와 비공개 데이터 저장소에만 둔다.
- 저장 키·필드·옛 기록 호환 유지(변경 시 이전 코드). normalize·불러오기에서 새 필드 생성 금지; 입력 때만 저장, 비운 선택 필드는 delete.
- main 최신 상태 기준으로 관련 부분만 수정. 요청은 한 브랜치, 마지막에 PR→병합(Pages 자동 게시).
- PR이 있는 작업은 최종 답변과 PR 본문에 병합 전 PR 전체 검토를 요청하는 복사용 코드 블록을 넣는다. 프롬프트에는 저장소·PR 번호·주소와 발견 사항의 보고 형식을 적는다. 마지막 줄에는 `[PR #번호](PR 주소) · 검토 요청 — 병합 전 PR 전체 검토`를 적는다. 검토 지적을 반영해 다시 올린 PR은 반영할 때마다 차수를 1씩 올려(첫 PR은 표시 없음) 마지막 줄을 `[PR #번호](PR 주소) · 검토 요청 — N차 보완 · 병합 전 PR 전체 검토`로 적고, 프롬프트에 직전 검토 뒤 커밋과 '새 커밋만 보지 말고 PR 전체와 이전 지적 반영 여부를 확인'을 적는다. [검토 프롬프트 양식](docs/gemini-delegation.md#pr-검토-프롬프트)
- 화면 변경은 병합 전 바뀐 화면 캡처만으로 사용자 확인. 글자만 바꾸는 작은 변경은 캡처 생략. 캡처는 대화로만 보여 주고 저장소·PR에 커밋하지 않는다.
- 사용자에게 보여 주는 시안은 항상 다크 화면. 폰 시안은 393×852·터치·sRGB·기존 Pretendard 글꼴로 캡처 조건을 고정하고 마우스 호버를 해제한다. 폰 화면의 점검 판정(줄바꿈·겹침·넘침 등)도 이 크기로 하고, 다른 폭은 사용자가 요청할 때만 확인한다. 금액 표시(줄바꿈·넘침·자리 맞춤)는 플래너(index.html)에서 100억 원 미만(99억 9,999만 원까지), 자산(assets.html)에서 1,000억 원 미만(999억 9,999만 원까지)만 점검한다. 그보다 큰 금액은 점검·지적하지 않고, 그 길이에 맞추려고 수정 범위를 넓히거나 디자인을 바꾸지 않는다. 사이트의 다크 테마와 삼성 인터넷의 웹페이지 다크 색 변환을 구분해 확인한다. 기본 시안은 대기 회차로 상태를 맞추고, 부분 체결·기준가 도달 예시는 따로 표시한다.
- 실기기 검증은 사실상 불가능하므로 하지 않는다. 화면·동작 확인은 위 조건의 브라우저 재현까지로 하고, 실기기에서만 드러나는 동작(홈 화면 앱 설치·갱신, 상태바·펀치홀 표시, 삼성 인터넷 강제 다크, 실제 푸시 수신 등)은 점검 보고·PR에 미검증으로 적는다. 실기기 확인을 요청받아도 기기 연결을 시도하지 않고 같은 방식으로 보고한다.
- 빌드·외부 라이브러리 추가 금지(기존 Pretendard CSS 제외). 일반 script 전역 이름은 중복 금지.
- CSS·JS 변경 시 세 HTML의 로컬 참조 ?v=를 함께 +1. push-sw.js의 importScripts ?v=도 같은 값으로 맞춘다. node scripts/bump-asset-version.cjs로 올린다. 로딩 순서는 script 태그·tests/files.test.cjs가 기준. theme.js만 head의 CSS 앞에서 바로 실행, 나머지 script는 defer(CSP meta가 미리 받기를 꺼서), 인라인 script 금지.
- 검증: node --test --test-reporter=dot tests/*.cjs(성공은 점, 실패만 상세. 파일만 집계되면 --experimental-test-isolation=none 추가). 수정 중에는 grep -l 파일명 tests/*.cjs로 찾은 관련 테스트부터. 계산 규칙은 담당 함수 주석에만 두고 변경 시 같이 수정.
- 수집기 고정 실행 파일(js/ma-ladder.js·prices.js·rebuy.js·trade-alerts.js·assets-calc.js)은 이름·위치·분리를 바꾸지 않고, DOM 없는 최상위 실행과 전역 진입점 buildTradeAlertRules·purchaseAlertRules를 유지. 수정하면 CLAUDE.md의 SHA 갱신 검토 대상.
- 큰 파일은 통째로 읽지 않는다: README는 grep -n '^## ' README.md로 절 위치부터, Actions가 갱신하는 data/currency-pressure.json(검색 제외: .ignore)·sp500-tr.json은 필요한 키만.
- 날짜별 변경 기록은 git log/PR에만. 자료 조회일·출처는 유지.

## 수정·보완 자가 점검
지적받은 곳만 고치고 끝내지 않는다. PR을 올리거나 보완을 다시 올리기 전에 스스로 확인한다.
- 같은 원인: 바꾼 함수·필드·조건·문구를 저장소 전체에서 grep해, 같은 값을 따로 계산하거나 같은 실수를 되풀이한 곳이 남았는지 본다.
- 짝 경로: 입력↔표시, 기기 저장↔동기화(js/sync.js)·백업 불러오기, 계산↔화면·알림·푸시(push-sw.js), 플래너↔자산↔시나리오 화면, 다크↔라이트, 성공↔실패·취소 경로가 함께 맞는지 본다.
- 경계·조합: 빈 값·0·경계 금액·경계 시각, 옛 기록, 연속 입력·재시도·새로고침에서 고친 보호가 풀리지 않는지 본다.
- 보완 PR이면 이전 차수의 지적이 이번 수정으로 다시 깨지지 않았는지 본다.
- 새 테스트가 다른 조건 때문에 우연히 통과하지 않는지, 고친 판단을 일부러 고장 내면 실패하는지 확인한다.
- 처리: 같은 원인으로 같은 기능에 남은 누락은 지시 범위로 보고 함께 고친다. 다른 기능, 설계 판단이 필요하거나 범위가 큰 것, 보안 경계·저장 형식·수집기 고정 실행 파일(작업이 이미 바꾸는 파일 제외)은 고치지 말고 PR 발견 사항에 적는다. 필요 없는 리팩터링은 하지 않는다.
- 보고: PR 본문의 "자가 점검" 절에 확인한 항목과 찾은 문제·처리(함께 수정/보고만)를 적는다. 찾은 것이 없으면 "없음"과 확인한 범위를 적는다.

## 파일 지도
- 뼈대: index.html(초기화 js/start.js); 상태·입력: js/core.js; 동기화: js/sync.js; 시세: js/prices.js.
- 매매: js/plans.js·futures.js·rebuy.js·purchases.js; 공통 회차: js/ma-ladder.js. 달러선물은 계산·화면 futures.js, 분할매수 계획 창 futures-plan.js, 신저점 손절 후 재매수 화면 futures-rebuy.js(계산은 rebuy.js).
- 액면분할·병합 미리보기·선택 적용·이력 계산(화면 없음): js/split-adjust.js.
- 액면분할 입력·미리보기·선택 반영 창(index.html, 동기화·계획 수정 창에서 열기): js/split-dialog.js.
- 수집 감지 분할·병합 검증·대기 판정·별도 시세 메타 캐시(화면 없음): js/split-auto.js. 플래너·자산 대기 배너·해당 없음 확인·?split= 진입: js/split-notices.js.
- 계획 창 종목 검색(분할매수·분할매도·재매수 공통): js/item-search.js; 체결 연동 UI: js/alloc-link.js; 자산·매수 계산: js/assets-calc.js; 공유 저장: js/assets-store.js.
- 자산 배분 종목의 분할매수·분할매도·재매수 편입·매수중/매도중 표시: js/member-link.js(읽기 전용 계산·이동 주소), 플래너 도착 이동: js/member-go.js.
- 자산 화면: assets.html·js/assets.js(공통·탭·자산 배분), 탭별 js/assets-ledger.js(월별 손익)·assets-savings.js(저축)·assets-installments.js(할부), 동기화 표시·첫 화면 js/assets-start.js; 월별 손익 S&P 500 비교: js/ledger-benchmark.js(월말 자료 수집 scripts/collect-sp500.cjs → data/sp500-tr.json, 금 collect-gold.cjs → data/gold-etf.json, 끝난 달 판정 month-close.cjs); 시나리오: valuation.html(본문)·css/valuation.css·js/valuation.js(계산, ASSUMPTION_KEY 이후 가정 저장·동기화), 원·달러 js/currency-pressure.js.
- 알림: js/trade-alerts.js·alerts.js·push.js·alert-target.js·push-sw.js. 서버 공유 계약은 계산 함수 주석 확인.
- 종목 표시 이름(목록·제목·푸시·알림내역 글자, 기록은 코드 그대로): js/stock-names.js(페이지·push-sw.js 공용).
- 디자인: css/app.css·assets.css·purchases.css; 공통 상단 안전 여백 전환: css/safe-area.css; 화면 모드: js/theme.js.
