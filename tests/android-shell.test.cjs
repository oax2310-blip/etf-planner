const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const {options} = require('../android/build.cjs');
let classes;
const javaTool = name => process.env.ETF_ANDROID_JDK ? path.join(process.env.ETF_ANDROID_JDK, 'bin', name) : name;
function run(command, args) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout:30000});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
before(() => {
  classes = fs.mkdtempSync(path.join(os.tmpdir(), 'etf-native-state-'));
  run(javaTool('javac'), ['-encoding','UTF-8','-d',classes,
    path.join(root,'android/src/io/github/oax2310blip/etfplanner/ChromeState.java'), path.join(root,'android/test/ChromeStateCheck.java')]);
});
after(() => { if (classes) fs.rmSync(classes, {recursive:true, force:true}); });
for (const [name, check] of [
  ['아래로 12dp 움직인 뒤 상태바를 숨기며 작은 움직임·정지에서는 깜빡이지 않는다','down'],
  ['위로 12dp 올리면 상태바를 보이고 방향 전환에도 누적 임계값을 지킨다','up'],
  ['새 드래그는 직전 제스처의 누적 이동을 이어받지 않는다','new-gesture'],
  ['프로그램 스크롤은 숨김을 바꾸지 않고 맨 위 복귀는 항상 표시한다','programmatic'],
  ['상태바 전환으로 뷰 높이가 바뀌어도 새 드래그로 판단하지 않는다','resizing'],
  ['키보드·화면 복귀의 표시 요청 뒤 크기 변화가 다시 상태바를 숨기지 않는다','keyboard'],
  ['음수 바운스·큰 좌표와 잘못된 임계값에서도 정상 판단한다','bounds'],
  ['세 페이지와 기존 쿼리·해시만 앱 안에서 연다','pages'],
  ['이웃 Pages·위장 출처·다른 포트·파일·스크립트 주소는 앱 문서로 승인하지 않는다','reject-pages'],
  ['파일 내보내기는 현재 출처에서 만든 정상 blob 주소만 받는다','blobs'],
  ['실제 불투명 CSS 배경색의 RGB 값을 손실 없이 읽는다','colors'],
  ['투명·범위 밖·비정상 색상은 기본 배경을 덮어쓰지 않는다','reject-colors'],
  ['밝은·어두운 배경과 대비 경계에서 읽기 쉬운 상태바 아이콘을 고른다','contrast'],
]) test(`Android 상태바: ${name}`, () => run(javaTool('java'), ['-cp',classes,'io.github.oax2310blip.etfplanner.ChromeStateCheck',check]));

test('Android 화면 연결은 native 표식과 배경색만 읽고 저장소에는 접근하지 않는다', () => {
  const html = {dataset:{}}, body = {}, colors = new Map([[html,'rgb(10, 12, 16)'],[body,'rgba(0, 0, 0, 0)']]);
  const result = vm.runInNewContext(source('android/assets/read-surface.js'), {
    document:{documentElement:html, body}, getComputedStyle:node => ({backgroundColor:colors.get(node)}),
    localStorage:new Proxy({}, {get(){throw Error('저장소 접근 금지');},set(){throw Error('저장소 변경 금지');}}),
  });
  assert.equal(html.dataset.nativeApp, 'android');
  assert.deepEqual([...result], ['rgba(0, 0, 0, 0)','rgb(10, 12, 16)']);
});

async function download(bytes, status=200) {
  const url='blob:https://oax2310-blip.github.io/12345678-1234-1234-1234-123456789abc',window={};
  const context=vm.createContext({window,Uint8Array,btoa,fetch:async requested=>{
    assert.equal(requested,url);
    return {ok:status>=200&&status<300,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
  }});
  const result=await vm.runInContext(source('android/assets/read-download.js').replace('__PLANNER_BLOB_URL__',JSON.stringify(url)),context);
  const job=vm.runInContext(source('android/assets/take-download.js'),context);
  assert.equal(job.status,result===null?'error':'ready');
  assert.equal(window[Symbol.for('etf-planner.android.download')],undefined,'완료·실패 결과는 메모리에서 제거');
  return result===null?null:Buffer.from(result,'base64');
}
test('Android JSON 백업은 한국어·빈 선택 필드·줄바꿈을 포함한 원래 바이트를 유지한다', async () => {
  const bytes=Buffer.from(JSON.stringify({plans:[],note:'가상 "메모"',old:null},null,2)+'\n');
  assert.doesNotThrow(()=>JSON.parse(bytes.toString('utf8')));
  assert.deepEqual(await download(bytes),bytes);
});
test('Android CSV 내보내기는 UTF-8 BOM·CRLF와 모든 바이트를 유지한다', async () => {
  const csv=Buffer.from('\ufeff"가상","0"\r\n');
  assert.deepEqual(csv.subarray(0,3),Buffer.from([0xef,0xbb,0xbf]));
  for(const bytes of [csv,Buffer.from(Array.from({length:256},(_,i)=>i))])assert.deepEqual(await download(bytes),bytes);
});
test('Android blob 읽기에 실패하면 빈 파일을 성공 결과로 반환하지 않는다', async () => {
  assert.equal(await download(Buffer.from(''),404),null);
});
test('이전 비동기 읽기가 늦게 끝나도 새 다운로드 결과를 덮어쓰지 않는다', async () => {
  const resolvers=[],window={},context=vm.createContext({window,Uint8Array,btoa,fetch:()=>new Promise(resolve=>resolvers.push(resolve))});
  const run=()=>vm.runInContext(source('android/assets/read-download.js').replace('__PLANNER_BLOB_URL__','"blob:test"'),context);
  const old=run(),current=run();
  resolvers[0]({ok:true,arrayBuffer:async()=>Uint8Array.of(1).buffer});await old;
  assert.equal(vm.runInContext(source('android/assets/take-download.js'),context).status,'pending');
  resolvers[1]({ok:true,arrayBuffer:async()=>Uint8Array.of(2).buffer});await current;
  const result=vm.runInContext(source('android/assets/take-download.js'),context);
  assert.equal(result.status,'ready');assert.equal(result.base64,'Ag==');
});
test('Android 비동기 백업은 세 페이지에서 메모리 blob만 추가로 읽을 수 있다', () => {
  for(const page of ['index.html','assets.html','valuation.html']){
    const targets=source(page).match(/connect-src\s+([^;]+);/)[1].trim().split(/\s+/);
    assert.deepEqual(targets,["'self'",'https://api.github.com','blob:']);
  }
});

test('Android 최초 배경은 웹앱의 낮·밤 배경색과 같고 두 테마를 구분한다', () => {
  const css=source('css/app.css');
  for(const [directory,color] of [['values',css.match(/:root\{[^}]*--bg:([^;]+)/)[1]],['values-night',css.match(/:root\[data-theme=dark\]\{[^}]*--bg:([^;]+)/)[1]]])
    assert.equal(source(`android/res/${directory}/styles.xml`).match(/<color name="planner_background">([^<]+)<\/color>/)[1],color);
});
test('Android는 상태바만 제어하고 강제 다크·자동 백업·임의 JS 브리지를 사용하지 않는다', () => {
  const activity=source('android/src/io/github/oax2310blip/etfplanner/PlannerActivity.java'),manifest=source('android/AndroidManifest.xml');
  assert.match(activity,/setAlgorithmicDarkeningAllowed\(false\)/);
  assert.match(activity,/setForceDark\(WebSettings\.FORCE_DARK_OFF\)/);
  assert.match(activity,/controller\.hide\(WindowInsets\.Type\.statusBars\(\)\)/);
  assert.doesNotMatch(activity,/hide\(WindowInsets\.Type\.(systemBars|navigationBars)/);
  assert.match(activity,/setStatusBarContrastEnforced\(false\)/);
  assert.doesNotMatch(activity,/addJavascriptInterface|onReceivedSslError|clearHistory|clearCache|deleteAllData/);
  assert.match(manifest,/android:allowBackup="false"/);assert.match(manifest,/android:usesCleartextTraffic="false"/);
  assert.deepEqual([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(m=>m[1]),['android.permission.INTERNET']);
});
test('Android 빌드는 SDK를 자동 설치하지 않고 명시한 경로·개발용 옵션만 사용한다', () => {
  assert.throws(()=>options([],{}),/SDK 경로/);
  assert.throws(()=>options(['--sdk','sdk','--unknown'],{}),/사용법/);
  assert.deepEqual(options(['--sdk','가상 SDK','--jdk','가상 JDK','--out','가상 출력','--debug'],{}),{sdk:'가상 SDK',jdk:'가상 JDK',out:'가상 출력',debug:true});
  assert.equal(options(['--sdk','sdk'],{}).debug,false);
});
