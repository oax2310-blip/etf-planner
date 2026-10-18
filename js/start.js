// index.html 초기화. 본문 script는 모두 defer라 문서를 다 읽은 뒤 태그 순서대로 실행되고 이 파일이 마지막이다.
// CSP가 인라인 script를 막으므로 index.html 안에 두지 않는다. 순서 기준은 tests/files.test.cjs.
allocLink.initialize(); purchasePlanner.initialize(); startSync(); openPlannerLocation(); save(); initializeAlerts(); initializeAlertHistory(); initializePush();
