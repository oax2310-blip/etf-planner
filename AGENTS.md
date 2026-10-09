# 작업 진입점

- 이 파일 → 관련 파일 머리 → 필요한 함수·호출부·테스트 순서. README는 필요한 절만 읽는다.
- 점검·수정 요청에서는 보고된 증상뿐 아니라 관련 기능의 다른 오류와 회귀도 함께 확인한다.
- 공개 소스·기본값에 개인 보유 종목·금액·수량·손익·메모·토큰·기기 구독 정보를 넣지 않는다. 기록은 브라우저와 비공개 데이터 저장소에만 둔다.
- 저장 키·필드·옛 기록 호환 유지(변경 시 이전 코드). normalize·불러오기에서 새 필드 생성 금지; 입력 때만 저장, 비운 선택 필드는 delete.
- main 최신 상태 기준으로 관련 부분만 수정. 요청은 한 브랜치, 마지막에 PR→병합(Pages 자동 게시).
- 화면 변경은 병합 전 바뀐 화면 캡처만으로 사용자 확인. 글자만 바꾸는 작은 변경은 캡처 생략.
- 사용자에게 보여 주는 시안은 항상 다크 화면. 폰 시안은 393×852·터치·sRGB·기존 Pretendard 글꼴로 캡처 조건을 고정하고 마우스 호버를 해제한다. 사이트의 다크 테마와 삼성 인터넷의 웹페이지 다크 색 변환을 구분해 확인한다. 기본 시안은 대기 회차로 상태를 맞추고, 부분 체결·기준가 도달 예시는 따로 표시한다.
- 빌드·외부 라이브러리 추가 금지(기존 Pretendard CSS 제외). 일반 script 전역 이름은 중복 금지.
- CSS·JS 변경 시 세 HTML의 로컬 참조 ?v=를 함께 +1. 로딩 순서는 script 태그·tests/files.test.cjs가 기준.
- 검증: node --test tests/*.cjs(파일만 집계되면 --experimental-test-isolation=none 추가). 계산 규칙은 담당 함수 주석에만 두고 변경 시 같이 수정.
- 날짜별 변경 기록은 git log/PR에만. 자료 조회일·출처는 유지.

## 파일 지도
- 뼈대: index.html; 상태·입력: js/core.js; 동기화: js/sync.js; 시세: js/prices.js.
- 매매: js/plans.js·futures.js·rebuy.js·purchases.js; 공통 회차: js/ma-ladder.js.
- 체결 연동 UI: js/alloc-link.js; 자산·매수 계산: js/assets-calc.js; 공유 저장: js/assets-store.js.
- 자산 화면: assets.html·js/assets.js; 시나리오: valuation.html의 필요한 구간.
- 알림: js/trade-alerts.js·alerts.js·push.js·alert-target.js·push-sw.js. 서버 공유 계약은 계산 함수 주석 확인.
- 디자인: css/app.css·assets.css·purchases.css; 화면 모드: js/theme.js.
