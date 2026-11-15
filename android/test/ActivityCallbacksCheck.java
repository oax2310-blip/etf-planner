package io.github.oax2310blip.etfplanner;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ExpressionStatementTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

// 실제 Activity의 콜백 본문을 JDK 파서로 가져와 실행한다. 아래 프레임워크 대역은 OS 실행 검증이 아니다.
public final class ActivityCallbacksCheck {
    public static void compile(Path root, Path out) throws Exception {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        try (javax.tools.StandardJavaFileManager manager = compiler.getStandardFileManager(null, null, null)) {
            Path source = root.resolve("android/src/io/github/oax2310blip/etfplanner/PlannerActivity.java");
            JavacTask parser = (JavacTask)compiler.getTask(null, manager, null, Arrays.asList("-proc:none"), null,
                    manager.getJavaFileObjects(source.toFile()));
            CompilationUnitTree unit = parser.parse().iterator().next();
            ClassTree activity = (ClassTree)unit.getTypeDecls().get(0);
            StringBuilder body = new StringBuilder();
            StringBuilder navigation = new StringBuilder();
            for (Tree member : activity.getMembers()) {
                if (member instanceof VariableTree && ((VariableTree)member).getName().contentEquals("PENDING_EXPORT_STATE")) body.append(member).append(';');
                if (!(member instanceof MethodTree)) continue;
                MethodTree method = (MethodTree)member;
                String name = method.getName().toString();
                if (Arrays.asList("restoreDownload", "pollDownload", "onSaveInstanceState", "onActivityResult", "onDestroy").contains(name)) body.append(method);
                if (name.equals("routeNavigation")) navigation.append(method);
                if (name.equals("configureWebView")) new TreeScanner<Void,Void>() {
                    @Override public Void visitMethod(MethodTree callback, Void unused) {
                        if (callback.getName().contentEquals("shouldOverrideUrlLoading")) navigation.append(callback);
                        return super.visitMethod(callback, unused);
                    }
                }.scan(method, null);
                if (name.equals("onCreate")) {
                    body.append("public void initialize(Bundle state) {");
                    for (Tree statement : method.getBody().getStatements()) {
                        if (!(statement instanceof ExpressionStatementTree)) continue;
                        Tree expression = ((ExpressionStatementTree)statement).getExpression();
                        if (expression instanceof MethodInvocationTree && ((MethodInvocationTree)expression).getMethodSelect().toString().equals("restoreDownload")) body.append(statement);
                    }
                    body.append('}');
                }
            }
            Path generated = out.resolve("ActivityUnderTest.java");
            Files.writeString(generated, "package io.github.oax2310blip.etfplanner; import java.io.*; import io.github.oax2310blip.etfplanner.ActivityCallbacksCheck.*; public class ActivityUnderTest extends Host {" + body + "}");
            check(compiler.run(null, null, null, "-encoding", "UTF-8", "-cp", out.toString(), "-d", out.toString(), generated.toString()) == 0, "콜백 컴파일");
            Path links = out.resolve("NavigationUnderTest.java");
            Files.writeString(links, "package io.github.oax2310blip.etfplanner; import io.github.oax2310blip.etfplanner.ActivityCallbacksCheck.*; public class NavigationUnderTest extends Host {" + navigation + "}");
            check(compiler.run(null, null, null, "-encoding", "UTF-8", "-cp", out.toString(), "-d", out.toString(), links.toString()) == 0, "탐색 콜백 컴파일");
        }
    }

    public static final class Bundle {
        final Map<String,Object> values = new HashMap<>();
        public String getString(String key) { return (String)values.get(key); }
        public void putString(String key, String value) { values.put(key, value); }
        public void putInt(String key, int value) { values.put(key, value); }
    }
    public interface MessageCallback { boolean handle(Message message); }
    public static final class Message {
        final MessageCallback callback;
        final Bundle data = new Bundle();
        Message(MessageCallback callback) { this.callback = callback; }
        public Bundle getData() { return data; }
    }
    public static final class Handler {
        final MessageCallback callback;
        public Handler(Object looper, MessageCallback callback) { this.callback = callback; }
        public Message obtainMessage() { return new Message(callback); }
    }
    public static final class Uri {
        final String value;
        Uri() { value = "content://test/backup.csv"; }
        Uri(String value) { this.value = value; }
        public static Uri parse(String value) { return new Uri(value); }
        public String getScheme() { int colon = value.indexOf(':'); return colon < 0 ? null : value.substring(0, colon); }
        @Override public String toString() { return value; }
    }
    public static final class WebView {
        public static final class HitTestResult {
            public static final int SRC_ANCHOR_TYPE = 7, SRC_IMAGE_ANCHOR_TYPE = 8;
            final int type; final String extra;
            HitTestResult(int type, String extra) { this.type = type; this.extra = extra; }
            public int getType() { return type; }
            public String getExtra() { return extra; }
        }
        String url = ChromeState.START_URL;
        String href, src = "https://example.test/image.png";
        HitTestResult hit;
        Message pending;
        public String getUrl() { return url; }
        public HitTestResult getHitTestResult() { return hit; }
        public void requestFocusNodeHref(Message message) { pending = message; }
        void deliverHref() {
            check(pending != null, "이미지 href를 별도로 요청");
            pending.data.putString("url", href); pending.data.putString("src", src);
            pending.callback.handle(pending); pending = null;
        }
    }
    public static final class WebResourceRequest {
        final Uri url; final boolean mainFrame, gesture;
        WebResourceRequest(String url, boolean mainFrame, boolean gesture) { this.url = Uri.parse(url); this.mainFrame = mainFrame; this.gesture = gesture; }
        public Uri getUrl() { return url; }
        public boolean isForMainFrame() { return mainFrame; }
        public boolean hasGesture() { return gesture; }
    }
    public static final class Intent {
        public static final String ACTION_CREATE_DOCUMENT = "create", CATEGORY_OPENABLE = "openable", EXTRA_TITLE = "title";
        private Uri uri;
        Intent(Uri uri) { this.uri = uri; }
        public Intent(String action) {}
        public Intent addCategory(String category) { return this; }
        public Intent setType(String type) { return this; }
        public Intent putExtra(String key, String value) { return this; }
        public Uri getData() { return uri; }
    }
    public static final class Base64 {
        public static final int DEFAULT = 0;
        public static byte[] decode(String value, int flags) { return java.util.Base64.getDecoder().decode(value); }
    }
    // JSON 해석 자체는 기존 WebView/JS 검사 대상이다. 여기서는 ready 응답 값만 대역으로 공급한다.
    public static final class JSONObject {
        final String result;
        public JSONObject(String result) { this.result = result; }
        public String optString(String key) { return result.substring(0, result.indexOf('|')); }
        public String getString(String key) { return result.substring(result.indexOf('|') + 1); }
    }
    public interface Callback { void onReceiveValue(Uri[] values); }
    public interface JavascriptCallback { void result(String value); }
    public static final class Web {
        String job;
        public void saveState(Bundle state) {}
        public int getScrollY() { return 100; }
        public void destroy() {}
        public String getUrl() { return ChromeState.START_URL; }
        public void evaluateJavascript(String script, JavascriptCallback callback) { callback.result(job); }
        public void postDelayed(Runnable task, long delay) { task.run(); }
    }
    public static final class Resolver {
        int opened;
        boolean failWrite, failClose, closed;
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        public OutputStream openOutputStream(Uri uri, String mode) throws IOException {
            check(mode.equals("wt"), "기존 문서의 꼬리 바이트를 남기지 않는 모드");
            opened++;
            return new OutputStream() {
                @Override public void write(int value) throws IOException { if (failWrite) throw new IOException("가상 쓰기 실패"); bytes.write(value); }
                @Override public void write(byte[] buffer, int offset, int length) throws IOException { if (failWrite) throw new IOException("가상 쓰기 실패"); bytes.write(buffer, offset, length); }
                @Override public void close() throws IOException { closed = true; if (failClose) throw new IOException("가상 닫기 실패"); }
            };
        }
    }
    public static class Framework {
        protected void onSaveInstanceState(Bundle state) {}
        protected void onActivityResult(int request, int result, Intent data) {}
        protected boolean destroyed;
        protected void onDestroy() { destroyed = true; }
        public boolean shouldOverrideUrlLoading(WebView view, String url) { return false; }
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return false; }
    }
    public static class Host extends Framework {
        protected static final int OPEN_FILE = 10, SAVE_FILE = 11, RESULT_OK = -1;
        protected PendingExport pendingDownload;
        protected Callback fileCallback;
        protected boolean readingDownload;
        protected int downloadSequence;
        protected final Web web = new Web();
        final Resolver resolver = new Resolver();
        final BlockingQueue<String> notices = new LinkedBlockingQueue<>();
        final List<String> browser = new ArrayList<>();
        File cache;
        boolean finishing, pickerUnavailable;
        int pickerLaunches;
        protected File getCacheDir() { return cache; }
        protected boolean isFinishing() { return finishing; }
        protected boolean isDestroyed() { return destroyed; }
        protected Object getMainLooper() { return this; }
        protected Resolver getContentResolver() { return resolver; }
        protected void runOnUiThread(Runnable task) { task.run(); }
        protected void notice(String message) { notices.add(message); }
        protected void openBrowser(String url) { browser.add(url); }
        protected String asset(String name) { return name; }
        protected void startActivityForResult(Intent intent, int request) throws IOException {
            pickerLaunches++;
            check(pendingDownload != null, "선택기를 열기 전에 임시 바이트를 보관");
            if (pickerUnavailable) throw new IOException("가상 저장 앱 없음");
        }
        public void initialize(Bundle state) {}
        void launchExport(byte[] bytes) throws Exception {
            web.job = "ready|" + java.util.Base64.getEncoder().encodeToString(bytes);
            readingDownload = true;
            java.lang.reflect.Method poll = getClass().getDeclaredMethod("pollDownload", int.class, String.class, String.class, String.class, int.class);
            poll.setAccessible(true); poll.invoke(this, 0, ChromeState.START_URL, "text/csv", "test.csv", 0);
        }
    }
    private static Host fresh(File cache, Bundle state) throws Exception {
        Host host = (Host)Class.forName("io.github.oax2310blip.etfplanner.ActivityUnderTest").getConstructor().newInstance();
        // Android가 재생성 인스턴스에도 같은 앱 캐시를 주는 계약만 대역으로 제공한다.
        host.cache = cache;
        host.initialize(state); return host;
    }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static String finish(Host host) throws Exception {
        String message = host.notices.poll(5, TimeUnit.SECONDS); check(message != null, "결과를 조용히 버리지 않고 안내");
        return message;
    }
    private static void gone(PendingExport export) throws Exception {
        long limit = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (System.nanoTime() < limit) {
            try (java.io.InputStream ignored = export.open()) { Thread.sleep(5); }
            catch (java.io.FileNotFoundException expected) { return; }
        }
        throw new AssertionError("종료된 작업의 임시 파일 정리");
    }
    private static void navigation(String scenario) throws Exception {
        Host host = (Host)Class.forName("io.github.oax2310blip.etfplanner.NavigationUnderTest").getConstructor().newInstance();
        WebView view = new WebView();
        String external = "https://example.test/source", blob = "blob:https://oax2310-blip.github.io/12345678-1234-1234-1234-123456789abc";
        switch (scenario) {
            case "legacy-links":
                for (String url : new String[]{external, "http://example.test/source", "https://oax2310-blip.github.io/other/"}) {
                    for (int type : new int[]{7,8}) {
                        view.hit = new WebView.HitTestResult(type, type == 8 ? view.src : url); view.href = url;
                        check(host.shouldOverrideUrlLoading(view, url), "외부 링크를 WebView에 남기지 않음");
                        if (type == 8) { check(host.browser.isEmpty(), "이미지 src로 즉시 이동하지 않음"); view.deliverHref(); }
                        check(host.browser.remove(0).equals(url), "API 23 String 콜백이 외부 브라우저로 전달");
                    }
                }
                break;
            case "stale-image-links":
                view.hit = new WebView.HitTestResult(8, view.src);
                for (int kind = 0; kind < 5; kind++) {
                    view.url = ChromeState.START_URL; view.href = external; host.finishing = false; host.destroyed = false;
                    check(host.shouldOverrideUrlLoading(view, external), "이미지 링크 응답 대기");
                    if (kind == 0) view.href = "https://example.test/different";
                    if (kind == 1) view.href = null;
                    if (kind == 2) view.url = ChromeState.START_URL + "assets.html";
                    if (kind == 3) host.finishing = true;
                    if (kind == 4) host.destroyed = true;
                    view.deliverHref(); check(host.browser.isEmpty(), "다른 href·페이지 변경·종료 뒤 응답은 무시");
                }
                break;
            case "internal-links":
                for (String page : new String[]{"", "index.html?split=TEST#section", "assets.html", "valuation.html"}) {
                    String url = ChromeState.START_URL + page;
                    check(!host.shouldOverrideUrlLoading(view, url), "API 23 앱 문서는 WebView에 유지");
                    check(!host.shouldOverrideUrlLoading(view, new WebResourceRequest(url, true, true)), "API 24 이상 앱 문서는 WebView에 유지");
                }
                check(!host.shouldOverrideUrlLoading(view, blob), "API 23 정상 앱 blob은 다운로드 경로 유지");
                check(!host.shouldOverrideUrlLoading(view, new WebResourceRequest(blob, true, true)), "API 24 이상 정상 앱 blob 유지");
                check(host.browser.isEmpty(), "내부 링크를 브라우저로 보내지 않음"); break;
            case "blocked-links":
                check(host.shouldOverrideUrlLoading(view, external), "링크 선택 없는 외부 이동 차단");
                view.hit = new WebView.HitTestResult(7, external + "/other");
                check(host.shouldOverrideUrlLoading(view, external), "이전 링크와 다른 목적지 차단");
                view.hit = new WebView.HitTestResult(0, external);
                check(host.shouldOverrideUrlLoading(view, external), "링크가 아닌 터치 차단");
                for (String url : new String[]{"javascript:alert(1)", "file:///test.json", "intent://test", "blob:https://example.test/12345678-1234-1234-1234-123456789abc"}) {
                    view.hit = new WebView.HitTestResult(7, url);
                    check(host.shouldOverrideUrlLoading(view, url), "비 HTTP 외부 이동 차단");
                    check(host.shouldOverrideUrlLoading(view, new WebResourceRequest(url, true, true)), "신형 콜백도 비 HTTP 외부 이동 차단");
                }
                view.url = "https://example.test/";
                check(host.shouldOverrideUrlLoading(view, blob), "앱 외부 문서의 blob 차단");
                check(host.browser.isEmpty(), "거부한 이동은 브라우저도 실행하지 않음"); break;
            case "modern-links":
                check(host.shouldOverrideUrlLoading(view, new WebResourceRequest(external, true, false)), "자동 외부 이동 차단");
                check(host.shouldOverrideUrlLoading(view, new WebResourceRequest(external, false, true)), "서브프레임 외부 이동 차단");
                check(host.browser.isEmpty(), "자동/서브프레임은 브라우저 미실행");
                check(host.shouldOverrideUrlLoading(view, new WebResourceRequest(external, true, true)), "주 프레임 클릭 처리");
                check(host.browser.equals(Arrays.asList(external)), "실제 클릭만 외부 브라우저 실행"); break;
            default: throw new AssertionError("알 수 없는 탐색 검사");
        }
    }
    public static void main(String[] args) throws Exception {
        if (args[0].equals("compile")) { compile(Path.of(args[1]), Path.of(args[2])); return; }
        if (args[0].endsWith("-links")) { navigation(args[0]); return; }
        Path cache = Files.createTempDirectory("planner-export-check-");
        try {
            byte[] bytes = new byte[3 * 1024 * 1024 + 3];
            for (int i = 0; i < bytes.length; i++) bytes[i] = (byte)i;
            bytes[0] = (byte)239; bytes[1] = (byte)187; bytes[2] = (byte)191;
            Host original = fresh(cache.toFile(), null);
            if (args[0].equals("picker-unavailable")) {
                original.pickerUnavailable = true; original.launchExport(bytes);
                check(!finish(original).equals("파일을 저장했습니다.") && original.pendingDownload == null, "선택기 실행 실패 안내·대기 해제");
                File[] files = new File(cache.toFile(), "planner-exports").listFiles();
                check(files == null || files.length == 0, "선택기 실행 실패 후 임시 바이트 정리"); return;
            }
            original.launchExport(bytes);
            check(original.pickerLaunches == 1 && original.pendingDownload != null && original.notices.isEmpty(), "원문을 보관한 뒤 선택기 실행");
            PendingExport staged = original.pendingDownload;
            Bundle saved = new Bundle(); original.onSaveInstanceState(saved);
            for (Object value : saved.values.values()) check(value == null || value instanceof Integer || value instanceof String && ((String)value).length() < 100, "큰 백업 바이트는 Bundle에 넣지 않음");
            original.onDestroy();
            Host restored = fresh(cache.toFile(), saved);
            switch (args[0]) {
                case "recreate":
                    restored.onActivityResult(11, -1, new Intent(new Uri()));
                    check(finish(restored).equals("파일을 저장했습니다."), "복원 후 성공");
                    check(restored.resolver.closed && Arrays.equals(bytes, restored.resolver.bytes.toByteArray()), "닫기까지 끝난 원문 BOM·전체 바이트"); gone(staged); break;
                case "cancel":
                    restored.onActivityResult(11, 0, null); gone(staged);
                    check(restored.resolver.opened == 0 && restored.pendingDownload == null && restored.notices.isEmpty(), "취소 시 쓰기·성공 안내 없음"); break;
                case "missing":
                    staged.discard(); restored.onActivityResult(11, -1, new Intent(new Uri()));
                    check(!finish(restored).equals("파일을 저장했습니다.") && restored.resolver.opened == 0, "캐시 유실 시 문서를 열기 전에 실패 안내"); break;
                case "lost-state":
                    Host lost = fresh(cache.toFile(), null); lost.onActivityResult(11, -1, new Intent(new Uri()));
                    check(!finish(lost).equals("파일을 저장했습니다.") && lost.resolver.opened == 0, "식별자 유실을 조용히 무시하지 않음"); break;
                case "missing-uri":
                    restored.onActivityResult(11, -1, new Intent((Uri)null));
                    check(!finish(restored).equals("파일을 저장했습니다.") && restored.resolver.opened == 0, "대상 없는 결과는 실패 안내"); gone(staged); break;
                case "write-failure": case "close-failure":
                    restored.resolver.failWrite = args[0].equals("write-failure"); restored.resolver.failClose = args[0].equals("close-failure");
                    restored.onActivityResult(11, -1, new Intent(new Uri()));
                    check(!finish(restored).equals("파일을 저장했습니다."), "쓰기·닫기 실패는 성공으로 알리지 않음"); gone(staged); break;
                case "separate":
                    PendingExport other = PendingExport.create(cache.toFile(), new byte[]{42});
                    restored.onActivityResult(11, -1, new Intent(new Uri())); finish(restored); gone(staged);
                    try (java.io.InputStream input = other.open()) { check(input.read() == 42, "다른 대기 작업의 바이트 보존"); }
                    other.discard(); break;
                case "finish":
                    restored.finishing = true; restored.onDestroy(); gone(staged); break;
                case "invalid-id":
                    for (String id : new String[]{"../secret", "/tmp/secret", "export-1.bin/../secret", "export-test.bin", ""}) check(PendingExport.restore(cache.toFile(), id) == null, "외부 경로 식별자 거부"); break;
                default: throw new AssertionError("알 수 없는 검사");
            }
        } finally {
            try (java.util.stream.Stream<Path> paths = Files.walk(cache)) { paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> path.toFile().delete()); }
        }
    }
}
