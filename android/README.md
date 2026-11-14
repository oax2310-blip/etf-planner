# 안드로이드 실행 앱

기존 GitHub Pages 플래너를 Android WebView로 여는 선택형 앱입니다. 웹앱의 빌드·운영 주소는 그대로 두며, 외부 앱 라이브러리·Gradle·npm 패키지를 추가하지 않습니다. Android 6(API 23) 이상이 대상이고, 최신 Android System WebView가 필요합니다.

## 상태바 동작

- 페이지의 실제 불투명 배경을 읽어 OS 상태바 뒤를 같은 색으로 칠합니다. 밝기 대비에 따라 시계·배터리 아이콘 색도 고릅니다. WebView의 자동 다크 변환은 끄고 사이트의 다크 테마를 사용합니다.
- 아래로 12dp 이상 드래그하면 OS 상태바를 숨기고 위로 12dp 올리면 표시합니다. 맨 위에 도착하면 항상 표시합니다. 웹 Fullscreen API의 권한이나 사용자 활성화에 의존하지 않습니다.
- Android 11(API 30) 이상은 WindowInsetsController와 OS 여백 애니메이션을 함께 사용합니다. Android 6~10은 기존 System UI API를 사용하며 같은 애니메이션 품질을 보장하지 않습니다.
- 내비게이션 막대는 숨기지 않습니다. 카메라 영역과 키보드 여백은 유지하며, 화면 크기 변화 때문에 상태바가 반복해서 열리고 닫히지 않도록 해당 스크롤은 판단에서 제외합니다.

## 기존 기록과 알림

이 앱은 기존 브라우저·PWA와 **별도 저장 공간**을 사용합니다. 자동 이전이나 기존 기록 삭제는 하지 않습니다. 먼저 기존 화면의 동기화 완료나 JSON 백업을 확인하고, 앱을 연 뒤 기존 동기화 기능 또는 JSON 복원으로 이어 사용하세요. 최초 안내 확인 여부만 Android UI 설정에 저장하며 웹앱 저장 키·기록·JSON 형식은 바꾸지 않습니다.

WebView는 웹 푸시를 지원하지 않습니다. **기존 홈 화면 PWA와 알림 구독은 유지하세요.** 기존 알림을 누르면 기존 웹앱으로 열립니다. 네이티브 푸시 구현이나 서버·구독 변경은 이 앱에 포함하지 않습니다.

JSON 복원은 OS 파일 선택기를 사용하고, JSON·CSV 내보내기는 OS 저장 위치 선택기로 원래 바이트를 저장합니다. UTF-8 BOM도 유지합니다. 파일 접근용 전체 저장소 권한은 요청하지 않습니다.

앱 안에서는 기존 플래너·자산·시나리오의 HTTPS 주소만 엽니다. 이웃 Pages·다른 사이트는 사용자 클릭 때 브라우저로 열며, 임의 JavaScript 인터페이스나 SSL 오류 우회는 제공하지 않습니다. Android 자동 백업은 끕니다. 실제 계좌·토큰·구독 정보는 APK에 넣지 않습니다.

## APK 준비

JDK 21과 공식 Android SDK의 `platforms;android-35`, `build-tools;35.0.0`을 먼저 준비합니다. 스크립트는 도구를 자동 설치하지 않습니다. 기본 출력은 `/tmp/etf-planner-android`이며, 기존 웹사이트 배포와 연결하지 않습니다.

```sh
node android/build.cjs --sdk /경로/Android/Sdk --jdk /경로/JDK --out /tmp/etf-planner-android
```

기본 산출물은 **서명하지 않은 APK**입니다. 실제 사용할 배포 서명키는 사용자가 로컬에서 관리하고 백업해야 합니다. 향후 업데이트는 같은 앱 ID와 서명키를 사용해야 기존 Android 앱 기록을 유지할 수 있습니다. 서명키·APK·도구·빌드 출력은 저장소에 커밋하지 않습니다.

화면 검증용 APK는 `--debug`로 만듭니다. 개발 키는 출력 폴더의 `private/debug.keystore`에 보관하고 재사용합니다. 개발용 APK는 WebView 디버깅을 허용하므로 **실제 토큰·투자 기록을 넣지 마세요.** 검증 APK를 실사용 배포로 간주하지 않습니다.

```sh
node android/build.cjs --sdk /경로/Android/Sdk --jdk /경로/JDK --out /tmp/etf-planner-android --debug
```

## 검증

기존 전체 Node 테스트에는 JDK의 `javac`·`java`로 실제 `ChromeState`를 실행하는 검증이 포함됩니다. JDK가 PATH에 없으면 `ETF_ANDROID_JDK`로 지정할 수 있습니다. 테스트 라이브러리는 추가하지 않습니다.

Android 11 이상에서 OS 상태바·실제 WebView 파일 입출력을 확인할 별도 Instrumentation APK도 준비합니다. 가상 화면·공급자는 테스트 APK에만 들어갑니다. `--font`에는 사이트에서 이미 사용하는 Pretendard 1.3.9의 `PretendardVariable.woff2`를 지정합니다.

```sh
node android/test/build.cjs --sdk /경로/Android/Sdk --jdk /경로/JDK --out /tmp/etf-planner-android --font /경로/PretendardVariable.woff2
adb install -r /tmp/etf-planner-android/etf-planner-debug.apk
adb install -r /tmp/etf-planner-android/etf-planner-test.apk
adb shell am instrument -w io.github.oax2310blip.etfplanner.tests/io.github.oax2310blip.etfplanner.ChromeInstrumentation
```

이 검증은 가상 종목·대기 회차만 사용하고 실제 투자 기록을 읽지 않습니다. 캡처는 테스트 기기의 앱 전용 외부 파일 폴더에 저장합니다. 실제 삼성 기기·OS 버전에서의 결과와 에뮬레이터 결과는 PR에서 구분합니다.
