const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const javaTool = name => process.env.ETF_ANDROID_JDK ? path.join(process.env.ETF_ANDROID_JDK, 'bin', name) : name;
let classes;
function run(name, args) {
  const result = spawnSync(javaTool(name), args, {encoding:'utf8', timeout:30000});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
before(() => {
  classes = fs.mkdtempSync(path.join(os.tmpdir(), 'etf-native-callbacks-'));
  run('javac', ['-encoding', 'UTF-8', '-d', classes,
    path.join(root, 'android/src/io/github/oax2310blip/etfplanner/PendingExport.java'),
    path.join(root, 'android/src/io/github/oax2310blip/etfplanner/ChromeState.java'),
    path.join(root, 'android/test/ActivityCallbacksCheck.java')]);
  run('java', ['-cp', classes, 'io.github.oax2310blip.etfplanner.ActivityCallbacksCheck', 'compile', root, classes]);
});
after(() => { if (classes) fs.rmSync(classes, {recursive:true, force:true}); });
for (const [check, title] of [
  ['recreate', 'Activity 재생성 뒤 큰 백업의 BOM·전체 바이트를 복원하고 닫은 뒤 성공을 알린다'],
  ['cancel', '재생성 뒤 취소해도 대상 파일을 쓰지 않고 임시 바이트를 정리한다'],
  ['missing', '임시 캐시가 사라졌으면 대상 파일을 열기 전에 실패를 알린다'],
  ['lost-state', '저장 결과에 대기 식별자가 없어도 조용히 건너뛰지 않고 실패를 알린다'],
  ['missing-uri', '저장 결과에 대상 URI가 없으면 실패를 알리고 임시 파일을 정리한다'],
  ['picker-unavailable', '저장 선택기를 실행하지 못하면 실패를 알리고 대기 바이트를 정리한다'],
  ['write-failure', '파일 쓰기에 실패하면 성공으로 알리지 않고 임시 파일을 정리한다'],
  ['close-failure', '파일 닫기에 실패하면 성공으로 알리지 않고 임시 파일을 정리한다'],
  ['separate', '복원 작업 정리는 다른 대기 백업의 바이트를 지우지 않는다'],
  ['finish', '앱을 완전히 종료하면 대기 임시 파일을 정리한다'],
  ['invalid-id', '복원 식별자로 캐시 밖 경로나 임의 파일을 열지 않는다'],
]) test(`Android 백업 콜백: ${title}`, () => run('java', ['-cp', classes, 'io.github.oax2310blip.etfplanner.ActivityCallbacksCheck', check]));

for (const [check, title] of [
  ['legacy-links', 'API 23 String 콜백도 선택한 HTTP·HTTPS 링크를 외부 브라우저로 보낸다'],
  ['stale-image-links', '이미지의 src와 href를 구분하고 다른 대상·페이지 변경·종료 뒤 응답을 무시한다'],
  ['internal-links', '구형·신형 콜백 모두 앱 문서·쿼리·해시와 정상 blob을 앱에 유지한다'],
  ['blocked-links', '구형 콜백은 선택 대상과 다른 주소·임의 스킴·외부 blob을 열지 않는다'],
  ['modern-links', '신형 콜백의 주 프레임·사용자 동작 제한을 유지한다'],
]) test(`Android 탐색 콜백: ${title}`, () => run('java', ['-cp', classes, 'io.github.oax2310blip.etfplanner.ActivityCallbacksCheck', check]));
