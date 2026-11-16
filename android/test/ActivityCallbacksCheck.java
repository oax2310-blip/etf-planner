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
import java.util.HashSet;
import java.util.Map;
import java.util.List;
import java.util.Set;
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
            StringBuilder chromeBody = new StringBuilder();
            java.util.Set<String> chromeFields = new java.util.HashSet<>(Arrays.asList(
                "chrome", "touching", "keyboardVisible", "barsVisible", "animating", "adjustingInsets",
                "gestureDragged", "gestureScrolled", "flinging", "programmaticScroll", "surface", "restoreY",
                "downOffsetX", "downOffsetY", "activePointerId", "touchSlop", "minFlingVelocity", "maxFlingVelocity",
                "downY", "velocity", "targetInsets", "stopFling", "clearAdjusting", "postClearAdjusting"
            ));
            java.util.Set<String> chromeMethods = new java.util.HashSet<>(Arrays.asList(
                "configureWindow", "openPlanner", "handlePageStarted", "handlePageCommitVisible",
                "handlePageFinished", "applyRestoreScroll", "pointerScreenY", "trackVelocity", "endFling",
                "scheduleStopFling", "scheduleClearAdjusting", "clearTouchGesture", "releaseTouch",
                "handleTouch", "handleScroll", "applyInsets", "endInsetsAnimation", "applyPadding",
                "applyBars", "setSurface", "readSurface", "onPause"
            ));
            for (Tree member : activity.getMembers()) {
                if (member instanceof VariableTree) {
                    String varName = ((VariableTree)member).getName().toString();
                    if (varName.equals("PENDING_EXPORT_STATE")) body.append(member).append(';');
                    if (chromeFields.contains(varName)) chromeBody.append(member).append(';');
                    continue;
                }
                if (!(member instanceof MethodTree)) continue;
                MethodTree method = (MethodTree)member;
                String name = method.getName().toString();
                if (Arrays.asList("restoreDownload", "pollDownload", "onSaveInstanceState", "onActivityResult", "onDestroy").contains(name)) body.append(method);
                if (chromeMethods.contains(name)) chromeBody.append(method);
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
            Path chromeFile = out.resolve("ChromeUnderTest.java");
            Files.writeString(chromeFile, "package io.github.oax2310blip.etfplanner; import java.util.*; import io.github.oax2310blip.etfplanner.ActivityCallbacksCheck.*; public class ChromeUnderTest extends ChromeHost {" + chromeBody + "}");
            check(compiler.run(null, null, null, "-encoding", "UTF-8", "-cp", out.toString(), "-d", out.toString(), chromeFile.toString()) == 0, "상태바·스크롤 콜백 컴파일");
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
    public static final class JSONArray {
        final List<String> items = new ArrayList<>();
        public JSONArray(String json) {
            if (json == null) return;
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"([^\"]*)\"").matcher(json);
            while (m.find()) items.add(m.group(1));
        }
        public String optString(int index) { return index >= 0 && index < items.size() ? items.get(index) : ""; }
    }
    public interface Callback { void onReceiveValue(Uri[] values); }
    public interface ValueCallback<T> { void onReceiveValue(T value); }
    public interface JavascriptCallback { void result(String value); }
    public static final class Build {
        public static final class VERSION { public static int SDK_INT = 35; }
    }
    public static final class Color { public static final int TRANSPARENT = 0; }
    public static final class View {
        public static final int SYSTEM_UI_FLAG_LAYOUT_STABLE = 0x00000100;
        public static final int SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN = 0x00000400;
        public static final int SYSTEM_UI_FLAG_FULLSCREEN = 0x00000004;
        public static final int SYSTEM_UI_FLAG_LIGHT_STATUS_BAR = 0x00002000;
        int systemUiVisibility;
        public void setSystemUiVisibility(int visibility) { systemUiVisibility = visibility; }
    }
    public static final class WindowManager {
        public static final class LayoutParams {
            public static final int FLAG_TRANSLUCENT_STATUS = 0x04000000;
            public static final int FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS = 0x80000000;
            public static final int LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES = 1;
            public static final int LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS = 3;
            public int layoutInDisplayCutoutMode;
        }
    }
    public static final class WindowInsetsController {
        public static final int APPEARANCE_LIGHT_STATUS_BARS = 8;
        public static final int BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE = 2;
        int appearance, behavior, hideCount, showCount;
        Boolean visibleState;
        public void setSystemBarsAppearance(int appearance, int mask) { this.appearance = (this.appearance & ~mask) | (appearance & mask); }
        public void setSystemBarsBehavior(int behavior) { this.behavior = behavior; }
        public void show(int types) { showCount++; visibleState = true; }
        public void hide(int types) { hideCount++; visibleState = false; }
    }
    public static final class Window {
        int flags = WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS;
        int statusBarColor = 0xff000000;
        boolean contrastEnforced = true, decorFits = true;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams();
        final View decor = new View();
        final WindowInsetsController controller = new WindowInsetsController();
        public void clearFlags(int f) { flags &= ~f; }
        public void addFlags(int f) { flags |= f; }
        public void setStatusBarColor(int c) { statusBarColor = c; }
        public void setStatusBarContrastEnforced(boolean b) { contrastEnforced = b; }
        public WindowManager.LayoutParams getAttributes() { return params; }
        public void setAttributes(WindowManager.LayoutParams p) { params = p; }
        public void setDecorFitsSystemWindows(boolean b) { decorFits = b; }
        public View getDecorView() { return decor; }
        public WindowInsetsController getInsetsController() { return controller; }
    }
    public static final class Insets {
        public final int left, top, right, bottom;
        Insets(int left, int top, int right, int bottom) { this.left = left; this.top = top; this.right = right; this.bottom = bottom; }
        public static Insets of(int l, int t, int r, int b) { return new Insets(l, t, r, b); }
    }
    public static final class DisplayCutout {
        final int left, top, right, bottom;
        DisplayCutout(int l, int t, int r, int b) { left = l; top = t; right = r; bottom = b; }
        public int getSafeInsetLeft() { return left; }
        public int getSafeInsetTop() { return top; }
        public int getSafeInsetRight() { return right; }
        public int getSafeInsetBottom() { return bottom; }
    }
    public static final class WindowInsets {
        public static final WindowInsets CONSUMED = new WindowInsets();
        public static final class Type {
            public static int statusBars() { return 1; }
            public static int systemBars() { return 2; }
            public static int displayCutout() { return 4; }
            public static int ime() { return 8; }
        }
        boolean imeVisible;
        Insets barInsets = Insets.of(0, 0, 0, 0), cutoutInsets = Insets.of(0, 0, 0, 0), imeInsets = Insets.of(0, 0, 0, 0);
        int sysL, sysT, sysR, sysB;
        DisplayCutout cutout;
        public boolean isVisible(int type) { return (type & Type.ime()) != 0 && imeVisible; }
        public Insets getInsets(int mask) {
            int l = 0, t = 0, r = 0, b = 0;
            if ((mask & Type.systemBars()) != 0) { l = Math.max(l, barInsets.left); t = Math.max(t, barInsets.top); r = Math.max(r, barInsets.right); b = Math.max(b, barInsets.bottom); }
            if ((mask & Type.displayCutout()) != 0) { l = Math.max(l, cutoutInsets.left); t = Math.max(t, cutoutInsets.top); r = Math.max(r, cutoutInsets.right); b = Math.max(b, cutoutInsets.bottom); }
            if ((mask & Type.ime()) != 0) { l = Math.max(l, imeInsets.left); t = Math.max(t, imeInsets.top); r = Math.max(r, imeInsets.right); b = Math.max(b, imeInsets.bottom); }
            return Insets.of(l, t, r, b);
        }
        public int getSystemWindowInsetLeft() { return sysL; }
        public int getSystemWindowInsetTop() { return sysT; }
        public int getSystemWindowInsetRight() { return sysR; }
        public int getSystemWindowInsetBottom() { return sysB; }
        public DisplayCutout getDisplayCutout() { return cutout; }
        public WindowInsets consumeSystemWindowInsets() { return this; }
    }
    public static final class WindowInsetsAnimation {}
    public static final class MotionEvent {
        public static final int INVALID_POINTER_ID = -1;
        public static final int ACTION_DOWN = 0, ACTION_UP = 1, ACTION_MOVE = 2, ACTION_CANCEL = 3, ACTION_POINTER_DOWN = 5, ACTION_POINTER_UP = 6;
        final int actionMasked, actionIndex;
        final int[] ids;
        final float[] xs, ys;
        float offsetX, offsetY;
        final long timeMs;
        MotionEvent(int actionMasked, int actionIndex, int[] ids, float[] xs, float[] ys, float rawOffsetY, long timeMs) {
            this.actionMasked = actionMasked; this.actionIndex = actionIndex; this.ids = ids; this.xs = xs.clone(); this.ys = ys.clone();
            this.offsetX = 0f; this.offsetY = rawOffsetY; this.timeMs = timeMs;
        }
        static MotionEvent single(int action, float x, float y, float offsetY, long timeMs) {
            return new MotionEvent(action, 0, new int[]{0}, new float[]{x}, new float[]{y}, offsetY, timeMs);
        }
        static MotionEvent singleXY(int action, float x, float y, float offsetX, float offsetY, long timeMs) {
            MotionEvent event = single(action, x, y, offsetY, timeMs);
            event.offsetX = offsetX;
            return event;
        }
        static MotionEvent multi(int actionMasked, int actionIndex, int[] ids, float[] xs, float[] ys, float offsetY, long timeMs) {
            return new MotionEvent(actionMasked, actionIndex, ids, xs, ys, offsetY, timeMs);
        }
        public static MotionEvent obtain(MotionEvent src) {
            MotionEvent copy = new MotionEvent(src.actionMasked, src.actionIndex, src.ids, src.xs, src.ys, src.offsetY, src.timeMs);
            copy.offsetX = src.offsetX;
            return copy;
        }
        public void offsetLocation(float dx, float dy) {
            for (int i = 0; i < xs.length; i++) { xs[i] += dx; ys[i] += dy; }
            offsetX -= dx; offsetY -= dy;
        }
        public void recycle() {}
        public int getActionMasked() { return actionMasked; }
        public int getActionIndex() { return actionIndex; }
        public int getPointerCount() { return ids.length; }
        public int getPointerId(int idx) { return ids[idx]; }
        public int findPointerIndex(int id) { for (int i = 0; i < ids.length; i++) if (ids[i] == id) return i; return -1; }
        public float getX() { return xs[0]; }
        public float getY() { return ys[0]; }
        public float getX(int idx) { return xs[idx]; }
        public float getY(int idx) { return ys[idx]; }
        public float getRawX() { return xs[0] + offsetX; }
        public float getRawY() { return ys[0] + offsetY; }
    }
    public static final class VelocityTracker {
        static int obtainedCount, recycledCount;
        final List<float[]> samples = new ArrayList<>();
        final Map<Integer, Float> computed = new HashMap<>();
        public static VelocityTracker obtain() { obtainedCount++; return new VelocityTracker(); }
        public void clear() { samples.clear(); computed.clear(); }
        public void recycle() { recycledCount++; clear(); }
        public void addMovement(MotionEvent event) {
            for (int i = 0; i < event.getPointerCount(); i++) samples.add(new float[]{event.getPointerId(i), event.getY(i), event.timeMs});
        }
        public void computeCurrentVelocity(int units, float maxVelocity) {
            computed.clear();
            Map<Integer, List<float[]>> byPointer = new HashMap<>();
            for (float[] s : samples) byPointer.computeIfAbsent((int)s[0], k -> new ArrayList<>()).add(s);
            for (Map.Entry<Integer, List<float[]>> entry : byPointer.entrySet()) {
                List<float[]> list = entry.getValue();
                float v = 0f;
                if (list.size() >= 2) {
                    float[] first = list.get(0), last = list.get(list.size() - 1);
                    float dt = last[2] - first[2];
                    if (dt > 0f) v = (last[1] - first[1]) * units / dt;
                }
                v = Math.max(-maxVelocity, Math.min(maxVelocity, v));
                computed.put(entry.getKey(), v);
            }
        }
        public float getYVelocity(int pointerId) { Float v = computed.get(pointerId); return v == null ? 0f : v; }
    }
    public static final class FrameLayout {
        int height, padL, padT, padR, padB, backgroundColor;
        final List<Runnable> animQueue = new ArrayList<>();
        final List<Runnable> postQueue = new ArrayList<>();
        public int getHeight() { return height; }
        public int getPaddingLeft() { return padL; }
        public int getPaddingTop() { return padT; }
        public int getPaddingRight() { return padR; }
        public int getPaddingBottom() { return padB; }
        public void setPadding(int l, int t, int r, int b) { padL = l; padT = t; padR = r; padB = b; }
        public void setBackgroundColor(int color) { backgroundColor = color; }
        public void postOnAnimation(Runnable r) { animQueue.add(r); }
        public void post(Runnable r) { postQueue.add(r); }
        public void removeCallbacks(Runnable r) { animQueue.remove(r); postQueue.remove(r); }
        void runAnimationsOnly() {
            List<Runnable> current = new ArrayList<>(animQueue); animQueue.clear();
            for (Runnable r : current) r.run();
        }
        void runPosts() {
            List<Runnable> current = new ArrayList<>(postQueue); postQueue.clear();
            for (Runnable r : current) r.run();
        }
        void flushFrame() { runAnimationsOnly(); runPosts(); }
    }
    public static final class ChromeWeb {
        String url = ChromeState.START_URL;
        int scrollY, backgroundColor, loadCount, stopCount, evalCount, scrollToCount;
        boolean hasRestoredState;
        String evalResult = "[\"rgba(0,0,0,0)\",\"rgb(10, 12, 16)\"]";
        final List<Runnable> postQueue = new ArrayList<>();
        final List<Runnable> delayedQueue = new ArrayList<>();
        java.util.function.IntConsumer scrollHook;
        public String getUrl() { return url; }
        public int getScrollY() { return scrollY; }
        public void setBackgroundColor(int color) { backgroundColor = color; }
        public Object restoreState(Bundle state) { return hasRestoredState && state != null ? this : null; }
        public void loadUrl(String u) { url = u; loadCount++; }
        public void stopLoading() { stopCount++; }
        public void scrollTo(int x, int y) { scrollToCount++; int old = scrollY; scrollY = y; if (scrollHook != null) scrollHook.accept(old); }
        public void evaluateJavascript(String script, ValueCallback<String> callback) { evalCount++; callback.onReceiveValue(evalResult); }
        public void post(Runnable r) { postQueue.add(r); }
        public void postDelayed(Runnable r, long delay) { delayedQueue.add(r); }
        public void removeCallbacks(Runnable r) { postQueue.remove(r); delayedQueue.remove(r); }
        void flushPosts() { List<Runnable> q = new ArrayList<>(postQueue); postQueue.clear(); for (Runnable r : q) r.run(); }
        void flushDelayed() { List<Runnable> q = new ArrayList<>(delayedQueue); delayedQueue.clear(); for (Runnable r : q) r.run(); }
    }
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
    public static class ChromeHost {
        protected final FrameLayout root = new FrameLayout();
        protected final ChromeWeb web = new ChromeWeb();
        protected final Window window = new Window();
        protected boolean readingDownload;
        protected int downloadSequence;
        final List<String> notices = new ArrayList<>();
        protected Window getWindow() { return window; }
        protected String asset(String name) { return name; }
        protected void notice(String msg) { notices.add(msg); }
        protected void onPause() {}
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
        protected void releaseTouch() {}
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
    private static Object fieldValue(Object target, String name) throws Exception {
        Class<?> c = target.getClass();
        while (c != null) {
            try { java.lang.reflect.Field f = c.getDeclaredField(name); f.setAccessible(true); return f.get(target); }
            catch (NoSuchFieldException ignored) { c = c.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }
    private static void setFieldValue(Object target, String name, Object value) throws Exception {
        Class<?> c = target.getClass();
        while (c != null) {
            try { java.lang.reflect.Field f = c.getDeclaredField(name); f.setAccessible(true); f.set(target, value); return; }
            catch (NoSuchFieldException ignored) { c = c.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }
    private static Object invokeChrome(ChromeHost host, String name, Class<?>[] types, Object... args) throws Exception {
        java.lang.reflect.Method m = host.getClass().getDeclaredMethod(name, types);
        m.setAccessible(true);
        return m.invoke(host, args);
    }
    private static ChromeHost newChrome() throws Exception {
        ChromeHost host = (ChromeHost)Class.forName("io.github.oax2310blip.etfplanner.ChromeUnderTest").getConstructor().newInstance();
        setFieldValue(host, "chrome", new ChromeState(36));
        setFieldValue(host, "touchSlop", 24);
        setFieldValue(host, "minFlingVelocity", 150);
        setFieldValue(host, "maxFlingVelocity", 24000);
        setFieldValue(host, "surface", 0xff0a0c10);
        host.web.scrollHook = oldY -> {
            try { invokeChrome(host, "handleScroll", new Class<?>[]{int.class, int.class}, host.web.scrollY, oldY); }
            catch (Exception error) { throw new RuntimeException(error); }
        };
        return host;
    }
    private static void scrollStep(ChromeHost host, int y) throws Exception {
        int oldY = host.web.scrollY;
        host.web.scrollY = y;
        invokeChrome(host, "handleScroll", new Class<?>[]{int.class, int.class}, y, oldY);
    }
    private static void chrome(String scenario) throws Exception {
        Build.VERSION.SDK_INT = 35;
        VelocityTracker.obtainedCount = VelocityTracker.recycledCount = 0;
        ChromeHost host = newChrome();
        switch (scenario) {
            case "chrome-flick-hide":
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 96, 0));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 672, 96, 12));
                scrollStep(host, 20);
                check((Boolean)fieldValue(host, "barsVisible"), "12dp 미만 드래그 중에는 상태바 유지");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 668, 96, 14));
                check((Boolean)fieldValue(host, "flinging") && !(Boolean)fieldValue(host, "touching"), "빠른 플릭 해제 뒤 관성 상태 유지");
                scrollStep(host, 60);
                check(!(Boolean)fieldValue(host, "barsVisible"), "손가락을 뗀 뒤 관성 스크롤이 12dp를 넘으면 상태바 숨김");
                check(host.window.controller.hideCount == 1 && Boolean.FALSE.equals(host.window.controller.visibleState), "WindowInsetsController hide 호출");
                check(!host.web.delayedQueue.isEmpty(), "플릭 종료 타이머 예약");
                host.web.flushDelayed();
                check(!(Boolean)fieldValue(host, "flinging"), "플릭 종료 타이머 만료 뒤 관성 해제");
                break;
            case "chrome-flick-nopre-hide":
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 96, 0));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 660, 96, 12));
                check((Boolean)fieldValue(host, "flinging"), "터치 중 스크롤 전 손가락을 떼어도 touchSlop 이상 빠른 플릭 감지");
                scrollStep(host, 15);
                check((Boolean)fieldValue(host, "barsVisible"), "12dp 도달 전 상태바 유지");
                scrollStep(host, 50);
                check(!(Boolean)fieldValue(host, "barsVisible"), "후속 관성 스크롤만으로 상태바 숨김");
                break;
            case "chrome-flick-show":
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 96, 0));
                scrollStep(host, 500);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 700, 96, 200));
                check(!(Boolean)fieldValue(host, "barsVisible"), "숨김 상태에서 시작");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 300, 0, 300));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 330, 0, 315));
                scrollStep(host, 490);
                check(!(Boolean)fieldValue(host, "barsVisible"), "반대 방향 12dp 전에는 숨김 유지");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 340, 0, 320));
                scrollStep(host, 440);
                check((Boolean)fieldValue(host, "barsVisible") && Boolean.TRUE.equals(host.window.controller.visibleState), "반대 방향 플릭 관성 스크롤이 12dp를 넘으면 상태바 복귀");
                break;
            case "chrome-tap-programmatic":
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 500, 96, 0));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 502, 96, 50));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 502, 96, 80));
                check(!(Boolean)fieldValue(host, "flinging"), "단순 탭에서는 플릭 시작 금지");
                scrollStep(host, 400);
                scrollStep(host, 800);
                check((Boolean)fieldValue(host, "barsVisible"), "단순 탭 뒤 JS scrollTo는 상태바를 숨기지 않음");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 500, 96, 100));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 480, 96, 105));
                check(!(Boolean)fieldValue(host, "flinging"), "touchSlop(24px) 미만 빠른 미세 떨림도 플릭 시작 금지");
                scrollStep(host, 900);
                check((Boolean)fieldValue(host, "barsVisible"), "미세 떨림 탭 뒤 프로그램 스크롤도 상태바 유지");
                break;
            case "chrome-insets-clear":
                host.root.padT = 96;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 96, 0));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 620, 96, 30));
                scrollStep(host, 500);
                check(host.web.delayedQueue.isEmpty(), "플릭이 아닌 일반 드래그 중에는 플릭 종료 타이머를 예약하지 않음");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 620, 96, 150));
                check(!(Boolean)fieldValue(host, "barsVisible"), "상태바 숨김 완료");
                WindowInsets collapsed = new WindowInsets();
                collapsed.barInsets = Insets.of(0, 0, 0, 120);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, collapsed);
                check((Boolean)fieldValue(host, "adjustingInsets"), "패딩 변경 직후 여백 조정 플래그 설정");
                host.root.runAnimationsOnly();
                check((Boolean)fieldValue(host, "adjustingInsets"), "레이아웃 traversal 전에는 여백 조정 플래그 유지");
                scrollStep(host, 420);
                check(!(Boolean)fieldValue(host, "barsVisible"), "여백 조정 프레임 중 크기 변화 스크롤은 상태바를 다시 열지 않음");
                host.root.runPosts();
                check(!(Boolean)fieldValue(host, "adjustingInsets"), "프레임 완료 뒤 adjustingInsets 자동 해제");
                // 드래그(touching=true) 도중 패딩 변경 뒤 레이아웃 전 ACTION_MOVE가 와도 adjustingInsets가 조기 해제되면 안 됨
                host.root.padT = 0;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 160));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 600, 0, 175));
                scrollStep(host, 500);
                check(!(Boolean)fieldValue(host, "barsVisible"), "재드래그 숨김 완료");
                WindowInsets bottomGrow = new WindowInsets();
                bottomGrow.barInsets = Insets.of(0, 0, 0, 180);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, bottomGrow);
                check((Boolean)fieldValue(host, "adjustingInsets"), "드래그 중 여백 변경 시 adjustingInsets 설정");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 590, 0, 180));
                check((Boolean)fieldValue(host, "adjustingInsets"), "레이아웃 전 ACTION_MOVE가 adjustingInsets를 조기 해제하면 안 됨");
                scrollStep(host, 420);
                check(!(Boolean)fieldValue(host, "barsVisible"), "드래그 중 레이아웃 리사이즈 스크롤(500->420)로 상태바가 다시 열리지 않음");
                host.root.flushFrame();
                check(!(Boolean)fieldValue(host, "adjustingInsets"), "드래그 중 여백 변경도 프레임 완료 뒤 해제");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 590, 0, 260));
                // 이전 예약 clearAdjusting가 애니메이션 시작(animating=true) 뒤 실행돼도 조기 해제 금지
                WindowInsets preAnimPad = new WindowInsets();
                preAnimPad.barInsets = Insets.of(0, 0, 0, 200);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, preAnimPad);
                setFieldValue(host, "animating", true);
                host.root.flushFrame();
                check((Boolean)fieldValue(host, "adjustingInsets"), "animating 중에는 이전 예약 clearAdjusting이 adjustingInsets를 끄지 않음");
                setFieldValue(host, "animating", false);
                // 애니메이션 종료 뒤 패딩 변화가 없더라도 adjustingInsets가 남아 있으면 해제 예약 확인
                setFieldValue(host, "animating", true);
                setFieldValue(host, "adjustingInsets", true);
                Set<WindowInsetsAnimation> running = new HashSet<>();
                WindowInsetsAnimation anim = new WindowInsetsAnimation();
                running.add(anim);
                invokeChrome(host, "endInsetsAnimation", new Class<?>[]{WindowInsetsAnimation.class, Set.class}, anim, running);
                host.root.flushFrame();
                check(!(Boolean)fieldValue(host, "adjustingInsets"), "애니메이션 종료 뒤에도 adjustingInsets 자동 해제");
                // 레이아웃 전 ACTION_DOWN도 adjustingInsets를 조기 해제하면 안 됨 (scrollY: 420 -> 380 리사이즈 보정)
                WindowInsets preDownGrow = new WindowInsets();
                preDownGrow.barInsets = Insets.of(0, 0, 0, 220);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, preDownGrow);
                check((Boolean)fieldValue(host, "adjustingInsets"), "ACTION_DOWN 테스트 전 여백 변경 시 adjustingInsets 설정");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 300, 0, 280));
                check((Boolean)fieldValue(host, "adjustingInsets"), "레이아웃 전 ACTION_DOWN이 adjustingInsets를 조기 해제하면 안 됨");
                scrollStep(host, 380);
                check(!(Boolean)fieldValue(host, "barsVisible"), "ACTION_DOWN 직후 레이아웃 리사이즈 스크롤(420->380)로 상태바가 다시 열리지 않음");
                host.root.flushFrame();
                check(!(Boolean)fieldValue(host, "adjustingInsets"), "ACTION_DOWN 후 여백 변경도 프레임 완료 뒤 해제");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_CANCEL, 300, 300, 0, 285));
                // 즉시 반대 방향 플릭 (중간 ACTION_MOVE 없음)도 정상 작동해야 함
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 300, 0, 300));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 345, 0, 312));
                scrollStep(host, 320);
                check((Boolean)fieldValue(host, "barsVisible"), "여백 해제 뒤 후속 플릭으로 상태바 복귀");
                host.web.flushDelayed();
                // 터치 중 resizing 스크롤이 발생해도 gestureScrolled가 true로 오염되지 않아 미세 떨림 탭이 flinging을 켜지 않아야 함
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 350));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 620, 0, 365));
                scrollStep(host, 500);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 620, 0, 380));
                check(!(Boolean)fieldValue(host, "barsVisible"), "미세 탭 전 상태바 재숨김");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 400));
                WindowInsets touchResize = new WindowInsets();
                touchResize.barInsets = Insets.of(0, 0, 0, 260);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, touchResize);
                scrollStep(host, 480);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 680, 0, 412));
                check(!(Boolean)fieldValue(host, "gestureScrolled") && !(Boolean)fieldValue(host, "flinging"), "resizing 중 스크롤만으로는 gestureScrolled·flinging을 켜지 않음");
                host.root.flushFrame();
                scrollStep(host, 400);
                check(!(Boolean)fieldValue(host, "barsVisible"), "resizing 중 미세 탭 뒤 프로그램 스크롤로 상태바를 열지 않음");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 420));
                setFieldValue(host, "animating", true);
                scrollStep(host, 350);
                check(!(Boolean)fieldValue(host, "barsVisible"), "animating 단독 상태의 리사이즈 스크롤도 상태바를 다시 열지 않음");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_CANCEL, 300, 700, 0, 425));
                setFieldValue(host, "animating", false);
                break;
            case "chrome-prelayout-ime-api29":
                Build.VERSION.SDK_INT = 29;
                setFieldValue(host, "barsVisible", false);
                host.root.height = 0;
                WindowInsets preLayout = new WindowInsets();
                preLayout.sysT = 96; preLayout.sysB = 120;
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, preLayout);
                check(!(Boolean)fieldValue(host, "keyboardVisible"), "root 높이 0일 때 하단 내비게이션 여백을 키보드로 오인하지 않음");
                check(!(Boolean)fieldValue(host, "barsVisible"), "오인으로 숨김 상태바를 열지 않음");
                host.root.flushFrame();
                check(!(Boolean)fieldValue(host, "adjustingInsets"), "API 29 패딩 변경도 프레임 뒤 adjustingInsets 해제");
                host.root.height = 1920;
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, preLayout);
                check(!(Boolean)fieldValue(host, "keyboardVisible"), "레이아웃 뒤에도 120px 하단 내비게이션은 키보드 아님");
                WindowInsets imeOpen = new WindowInsets();
                imeOpen.sysT = 96; imeOpen.sysB = 700;
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, imeOpen);
                check((Boolean)fieldValue(host, "keyboardVisible") && (Boolean)fieldValue(host, "barsVisible"), "실제 키보드 여백(700 > 1920/4)에서는 상태바 복원");
                break;
            case "chrome-horizontal-ignored":
                host.web.scrollY = 400;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 500, 96, 0));
                scrollStep(host, 400);
                check(!(Boolean)fieldValue(host, "gestureScrolled"), "Y가 같은 가로 스크롤은 세로 스크롤 이력으로 기록하지 않음");
                scrollStep(host, 420);
                check((Boolean)fieldValue(host, "barsVisible"), "임계값(36) 미만 세로 이동 중에는 상태바 표시 유지");
                setFieldValue(host, "adjustingInsets", true);
                scrollStep(host, 420);
                setFieldValue(host, "adjustingInsets", false);
                scrollStep(host, 438);
                check(!(Boolean)fieldValue(host, "barsVisible"), "resizing 중 가로 틱(y==oldY)은 직전 anchor(400)를 덮어쓰지 않고 누적(438)으로 숨김");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 470, 96, 12));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 465, 96, 15));
                check(host.web.delayedQueue.size() == 1, "초기 플릭 타이머 1건");
                host.web.delayedQueue.clear();
                scrollStep(host, 438);
                check(host.web.delayedQueue.isEmpty(), "가로 스크롤 틱은 플릭 타이머를 연장하지 않음");
                scrollStep(host, 480);
                check(host.web.delayedQueue.size() == 1, "플릭 중 세로 이동 틱은 종료 타이머를 재연장함");
                check(!(Boolean)fieldValue(host, "barsVisible"), "가로·세로 플릭 틱 뒤 숨김 상태 유지");
                host.web.scrollY = 0;
                scrollStep(host, 0);
                check(!(Boolean)fieldValue(host, "flinging"), "y==0 정착 가로 틱에서도 잔여 flinging을 종료");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 300, 96, 20));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 360, 96, 30));
                check((Boolean)fieldValue(host, "flinging") && (Boolean)fieldValue(host, "barsVisible"), "맨 위(y==0, barsVisible==true) 플릭 직후 상태 확인");
                scrollStep(host, 0);
                check(!(Boolean)fieldValue(host, "flinging"), "barsVisible==true인 맨 위 가로 틱(y==0, oldY==0)에서도 잔여 flinging을 종료");
                break;
            case "chrome-window-and-surface":
                Build.VERSION.SDK_INT = 35;
                invokeChrome(host, "configureWindow", new Class<?>[]{Window.class}, host.window);
                check((host.window.flags & WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS) == 0, "투명 상태바 구형 반투명 플래그 제거");
                check((host.window.flags & WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS) != 0, "시스템 바 직접 그리기 플래그 설정");
                check(host.window.statusBarColor == Color.TRANSPARENT, "상태바 색 투명 설정");
                check(!host.window.contrastEnforced && !host.window.decorFits, "API 29 대비 강제 해제 및 edge-to-edge");
                check(host.window.params.layoutInDisplayCutoutMode == WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS, "API 30 이상 컷아웃 ALWAYS 모드");
                Build.VERSION.SDK_INT = 28;
                invokeChrome(host, "configureWindow", new Class<?>[]{Window.class}, host.window);
                check(host.window.params.layoutInDisplayCutoutMode == WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES, "API 28~29 SHORT_EDGES 유지");
                Build.VERSION.SDK_INT = 35;
                host.web.evalResult = "[\"rgba(0,0,0,0)\",\"rgb(245, 246, 248)\"]";
                invokeChrome(host, "handlePageCommitVisible", new Class<?>[]{String.class}, "https://evil.test/");
                check(host.web.evalCount == 0, "외부 페이지는 표면 색 읽기 안 함");
                invokeChrome(host, "handlePageCommitVisible", new Class<?>[]{String.class}, ChromeState.START_URL);
                check(host.web.evalCount == 1 && (Integer)fieldValue(host, "surface") == 0xfff5f6f8, "커밋 시점부터 페이지 실제 배경색 동기화");
                check((host.window.controller.appearance & WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) != 0, "밝은 배경에서 어두운 아이콘 전환");
                // A. 복원 직후 로드 전에는 loadUrl·선스크롤(restoreY 소비)·표면 색 읽기를 실행하지 않음
                host.web.hasRestoredState = true;
                host.web.evalResult = "[\"rgba(0,0,0,0)\",\"rgb(10, 12, 16)\"]";
                setFieldValue(host, "restoreY", 500);
                Bundle saved = new Bundle();
                saved.putString("web-state", "1");
                int evalBeforeRestore = host.web.evalCount;
                invokeChrome(host, "openPlanner", new Class<?>[]{Bundle.class}, saved);
                host.web.flushPosts();
                host.web.flushPosts();
                check(host.web.loadCount == 0 && host.web.scrollToCount == 0
                    && (Integer)fieldValue(host, "restoreY") == 500 && host.web.evalCount == evalBeforeRestore,
                    "복원 직후 로드 완료 전에는 loadUrl·선스크롤(restoreY 소비)·표면 색 읽기를 실행하지 않음");
                // B. 복원 페이지 로드: 커밋 시 배경색 동기화, 로드 완료 뒤 flushPosts 전에는 scrollY 유지
                invokeChrome(host, "handlePageStarted", new Class<?>[]{String.class}, ChromeState.START_URL);
                invokeChrome(host, "handlePageCommitVisible", new Class<?>[]{String.class}, ChromeState.START_URL);
                check((Integer)fieldValue(host, "surface") == 0xff0a0c10, "복원 페이지 커밋 시 다크 표면 배경 동기화");
                invokeChrome(host, "handlePageFinished", new Class<?>[]{String.class}, ChromeState.START_URL);
                check(host.web.scrollY == 0 && host.web.scrollToCount == 0, "handlePageFinished 뒤 flushPosts 전에는 scrollY 유지");
                // C. 플릭 중 복원: scrollTo 실행 직전에 사용자가 플릭 중이더라도 복원 스크롤(programmaticScroll=true)은 상태바를 유지하고 플릭을 멈춤
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 96, 0));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 650, 96, 10));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 640, 96, 15));
                check((Boolean)fieldValue(host, "flinging") && (Boolean)fieldValue(host, "barsVisible"), "복원 직전 플릭 활성화 상태에서 확인");
                host.web.flushPosts();
                check(host.web.scrollY == 500 && host.web.scrollToCount == 1
                    && (Integer)fieldValue(host, "restoreY") == 0 && (Boolean)fieldValue(host, "barsVisible"),
                    "로드 완료 뒤 복원 스크롤은 scrollY=500으로 복원하고 restoreY를 0으로 비우며 상태바 표시 유지");
                check(!(Boolean)fieldValue(host, "flinging"), "복원 프로그램 스크롤은 잔여 flinging을 종료");
                // D. 한 번만 복원: handlePageFinished를 다시 불러도 복원 스크롤을 중복 실행하지 않음
                int scrollToBeforeRepeat = host.web.scrollToCount;
                invokeChrome(host, "handlePageFinished", new Class<?>[]{String.class}, ChromeState.START_URL);
                host.web.flushPosts();
                check(host.web.scrollToCount == scrollToBeforeRepeat && (Integer)fieldValue(host, "restoreY") == 0,
                    "handlePageFinished 재호출 뒤에도 복원 스크롤은 한 번만 실행");
                // 손가락을 댄(touching=true) 상태에서 지연된 복원 스크롤이 실행되어도 programmaticScroll 가드로 상태바·gestureScrolled를 오염시키지 않아야 함
                host.web.scrollY = 0;
                setFieldValue(host, "restoreY", 300);
                invokeChrome(host, "applyRestoreScroll", new Class<?>[0]);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 96, 20));
                check((Boolean)fieldValue(host, "touching"), "복원 스크롤 실행 중 터치 상태 확인");
                host.web.flushPosts();
                check(host.web.scrollY == 300 && (Boolean)fieldValue(host, "barsVisible"), "터치 중 실행된 복원 스크롤(programmaticScroll=true)도 상태바 표시 유지");
                check(!(Boolean)fieldValue(host, "gestureScrolled"), "터치 중 프로그램 스크롤은 gestureScrolled를 켜지 않음");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 680, 96, 32));
                check(!(Boolean)fieldValue(host, "flinging"), "터치 중 프로그램 스크롤 뒤 미세 떨림 UP은 플릭을 켜지 않음");
                scrollStep(host, 600);
                check((Boolean)fieldValue(host, "barsVisible"), "프로그램 스크롤 뒤 미세 탭 후속 스크롤도 상태바 유지");
                break;
            case "chrome-mid-drag-resize-offset":
                // 1. 패딩 변경 직후 레이아웃 전(rawOffset 유지)에는 과보정하지 않고,
                //    실제 뷰 오프셋이 줄어든(48->0, 96->0) 뒤에만 touchSlop 전·후·UP 전체를 일관되게 보정해야 함
                host.root.padL = 48;
                host.root.padT = 96;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.singleXY(MotionEvent.ACTION_DOWN, 300, 604, 48, 96, 0));
                host.root.padL = 0;
                host.root.padT = 0;
                MotionEvent preLayoutMove = MotionEvent.singleXY(MotionEvent.ACTION_MOVE, 300, 594, 48, 96, 4);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, preLayoutMove);
                check(Math.abs(preLayoutMove.getX() - 300f) < 0.01f && Math.abs(preLayoutMove.getY() - 594f) < 0.01f,
                    "레이아웃 전(rawOffset 유지) ACTION_MOVE는 root padding만 보고 조기 과보정하지 않음");
                MotionEvent subSlopMove = MotionEvent.singleXY(MotionEvent.ACTION_MOVE, 348, 684, 0, 0, 8);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, subSlopMove);
                check(!(Boolean)fieldValue(host, "gestureDragged"), "touchSlop(16<24) 미만에서는 gestureDragged 미설정");
                check(Math.abs(subSlopMove.getX() - 300f) < 0.01f && Math.abs(subSlopMove.getY() - 588f) < 0.01f
                    && Math.abs(subSlopMove.getRawX() - 348f) < 0.01f && Math.abs(subSlopMove.getRawY() - 684f) < 0.01f,
                    "touchSlop 미만에서도 레이아웃 뒤 가로·세로 오프셋 변화를 즉시 보정해 점프 방지");
                MotionEvent midMove = MotionEvent.singleXY(MotionEvent.ACTION_MOVE, 348, 604, 0, 0, 12);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, midMove);
                check(Math.abs(midMove.getX() - 300f) < 0.01f && Math.abs(midMove.getY() - 508f) < 0.01f
                    && Math.abs(midMove.getRawX() - 348f) < 0.01f && Math.abs(midMove.getRawY() - 604f) < 0.01f,
                    "드래그 중 X·Y 오프셋 변화 시 WebView 로컬 좌표를 -48, -96 연속 보정");
                MotionEvent midUp = MotionEvent.singleXY(MotionEvent.ACTION_UP, 348, 604, 0, 0, 15);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, midUp);
                check((Boolean)fieldValue(host, "flinging"), "중간 오프셋 축소에도 screenY 기준 플릭 감지 유지");
                check(Math.abs(midUp.getX() - 300f) < 0.01f && Math.abs(midUp.getY() - 508f) < 0.01f, "ACTION_UP 시에도 X·Y 로컬 좌표 연속 보정 유지");
                // 2. 새 ACTION_DOWN이 들어오면 직전 flinging·타이머를 종료하고 미완성 제스처의 VelocityTracker 샘플을 초기화
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 500, 0, 20));
                check(!(Boolean)fieldValue(host, "flinging") && host.web.delayedQueue.isEmpty(), "새 ACTION_DOWN 시 직전 flinging·타이머 즉시 종료");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 300, 0, 25));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 300, 0, 30));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 270, 0, 250));
                check(!(Boolean)fieldValue(host, "flinging"), "ACTION_UP 없는 연속 ACTION_DOWN 시 직전 고속 MOVE 속도 샘플을 이어받지 않음");
                // 3. 단순 탭(변위 0) 도중 뷰 오프셋이 바뀌어도 DOWN·UP 로컬 좌표를 연속 유지해 클릭을 지키고 플릭은 시작하지 않음
                host.root.padT = 96;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 500, 96, 300));
                host.root.padT = 0;
                MotionEvent tapUp = MotionEvent.single(MotionEvent.ACTION_UP, 300, 596, 0, 315);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, tapUp);
                check(Math.abs(tapUp.getY() - 500f) < 0.01f && Math.abs(tapUp.getRawY() - 596f) < 0.01f
                    && !(Boolean)fieldValue(host, "flinging"), "단순 탭 중 오프셋 변경도 로컬 좌표를 -96px 보정해 클릭(500)을 유지하고 플릭 미시작");
                // 4. ACTION_CANCEL은 X·Y 오프셋 축소 상태에서도 로컬 좌표를 보정하고 터치·스크롤·플릭 상태를 모두 초기화함
                host.root.padL = 48;
                host.root.padT = 96;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.singleXY(MotionEvent.ACTION_DOWN, 300, 604, 48, 96, 348));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.singleXY(MotionEvent.ACTION_MOVE, 300, 560, 48, 96, 350));
                scrollStep(host, host.web.scrollY + 50);
                check((Boolean)fieldValue(host, "gestureScrolled"), "CANCEL 전 터치 스크롤 상태 확인");
                host.root.padL = 0;
                host.root.padT = 0;
                setFieldValue(host, "flinging", true);
                invokeChrome(host, "scheduleStopFling", new Class<?>[0]);
                MotionEvent cancel = MotionEvent.singleXY(MotionEvent.ACTION_CANCEL, 348, 656, 0, 0, 352);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, cancel);
                check(Math.abs(cancel.getX() - 300f) < 0.01f && Math.abs(cancel.getY() - 560f) < 0.01f,
                    "오프셋 축소 상태의 ACTION_CANCEL도 가로·세로 로컬 좌표를 -48, -96 보정");
                check(!(Boolean)fieldValue(host, "flinging") && host.web.delayedQueue.isEmpty() && !(Boolean)fieldValue(host, "touching")
                    && !(Boolean)fieldValue(host, "gestureDragged") && !(Boolean)fieldValue(host, "gestureScrolled")
                    && (Integer)fieldValue(host, "activePointerId") == MotionEvent.INVALID_POINTER_ID,
                    "ACTION_CANCEL 시 터치·플릭 상태·타이머 전체 초기화");
                // 5. 멀티터치 ACTION_POINTER_DOWN·ACTION_POINTER_UP 오프셋 보정 및 포인터 핸드오프
                host.root.padT = 96;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.multi(MotionEvent.ACTION_DOWN, 0, new int[]{0}, new float[]{300}, new float[]{604}, 96, 400));
                MotionEvent ptrDown = MotionEvent.multi(MotionEvent.ACTION_POINTER_DOWN, 1, new int[]{0, 1}, new float[]{300, 350}, new float[]{700, 500}, 0, 405);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, ptrDown);
                check(Math.abs(ptrDown.getY(0) - 604f) < 0.01f && Math.abs(ptrDown.getY(1) - 404f) < 0.01f,
                    "ACTION_POINTER_DOWN 시에도 뷰 오프셋 축소(-96px) 보정 적용");
                MotionEvent ptrUp = MotionEvent.multi(MotionEvent.ACTION_POINTER_UP, 0, new int[]{0, 1}, new float[]{300, 350}, new float[]{700, 500}, 0, 410);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, ptrUp);
                check(Math.abs(ptrUp.getY(1) - 404f) < 0.01f, "ACTION_POINTER_UP 시에도 남은 포인터 로컬 Y 보정 유지");
                check((Integer)fieldValue(host, "activePointerId") == 1, "활성 포인터 해제 시 다음 포인터(1)로 기준 전환");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.multi(MotionEvent.ACTION_MOVE, 0, new int[]{1}, new float[]{350}, new float[]{446}, 0, 418));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.multi(MotionEvent.ACTION_UP, 0, new int[]{1}, new float[]{350}, new float[]{426}, 0, 422));
                check((Boolean)fieldValue(host, "flinging"), "오프셋 변화 뒤 남은 두 번째 손가락 플릭도 screenY 기준으로 정상 감지");
                // 6. ACTION_MOVE 중 touchSlop 이상 이동 뒤 UP 지점이 downY 근처(<touchSlop)여도 MOVE의 gestureDragged를 유지
                host.web.flushDelayed();
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 500));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 760, 0, 506));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 710, 0, 512));
                check((Boolean)fieldValue(host, "flinging"), "ACTION_MOVE에서 touchSlop 이상 이동 뒤 UP 지점이 downY 근처(<touchSlop)여도 빠른 플릭 감지");
                invokeChrome(host, "releaseTouch", new Class<?>[0]);
                check(VelocityTracker.obtainedCount == 1 && VelocityTracker.recycledCount == 1, "VelocityTracker 누수 없이 반환");
                check(!(Boolean)fieldValue(host, "flinging") && !(Boolean)fieldValue(host, "touching"), "releaseTouch 후 터치·플릭 상태 초기화");
                break;
            case "chrome-lifecycle-and-ime":
                // 1. 숨김+플릭 중 키보드 표시 시 상태바 복구·플릭 종료 및 키보드 표시 중 스크롤 가드
                setFieldValue(host, "barsVisible", false);
                setFieldValue(host, "flinging", true);
                WindowInsets imeShown = new WindowInsets();
                imeShown.imeVisible = true;
                imeShown.imeInsets = Insets.of(0, 0, 0, 700);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, imeShown);
                check((Boolean)fieldValue(host, "keyboardVisible") && (Boolean)fieldValue(host, "barsVisible"), "키보드 표시 시 상태바 즉시 복원");
                check(!(Boolean)fieldValue(host, "flinging"), "키보드 표시 시 진행 중이던 flinging 종료");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 0));
                setFieldValue(host, "flinging", true);
                scrollStep(host, 200);
                check((Boolean)fieldValue(host, "barsVisible") && !(Boolean)fieldValue(host, "flinging"), "키보드 표시 중 y>0 스크롤에서도 상태바를 숨기지 않고 플릭 종료");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_CANCEL, 300, 700, 0, 1));
                setFieldValue(host, "keyboardVisible", false);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, new WindowInsets());
                host.root.flushFrame();
                // 2. 드래그/스크롤/플릭 중 새 페이지 로드(handlePageStarted) 시 상태 초기화 및 잔여 터치·비터치 스크롤 차단
                host.root.padT = 96;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 96, 10));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 620, 96, 12));
                scrollStep(host, 250);
                setFieldValue(host, "flinging", true);
                invokeChrome(host, "scheduleStopFling", new Class<?>[0]);
                check((Boolean)fieldValue(host, "gestureDragged") && (Boolean)fieldValue(host, "gestureScrolled"), "handlePageStarted 전 드래그·스크롤 상태 확인");
                invokeChrome(host, "handlePageStarted", new Class<?>[]{String.class}, ChromeState.START_URL + "assets.html");
                check(!(Boolean)fieldValue(host, "touching") && !(Boolean)fieldValue(host, "flinging") && host.web.delayedQueue.isEmpty()
                    && !(Boolean)fieldValue(host, "gestureDragged") && !(Boolean)fieldValue(host, "gestureScrolled")
                    && (Integer)fieldValue(host, "activePointerId") == MotionEvent.INVALID_POINTER_ID,
                    "handlePageStarted 시 터치·포인터·스크롤·플릭·타이머 전체 초기화");
                scrollStep(host, 300);
                check(!(Boolean)fieldValue(host, "gestureScrolled"), "비터치(!touching) 상태의 스크롤은 gestureScrolled를 켜지 않음");
                host.root.padT = 0;
                int beforeObtained = VelocityTracker.obtainedCount;
                MotionEvent pageResidualMove = MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 580, 0, 16);
                MotionEvent pageResidualUp = MotionEvent.single(MotionEvent.ACTION_UP, 300, 560, 0, 20);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, pageResidualMove);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, pageResidualUp);
                check(Math.abs(pageResidualMove.getY() - 580f) < 0.01f && Math.abs(pageResidualUp.getY() - 560f) < 0.01f,
                    "handlePageStarted 뒤 잔여 MOVE·UP은 오프셋 보정·처리를 하지 않고 무시");
                check(!(Boolean)fieldValue(host, "touching") && !(Boolean)fieldValue(host, "flinging")
                    && !(Boolean)fieldValue(host, "gestureDragged") && VelocityTracker.obtainedCount == beforeObtained,
                    "페이지 전환 뒤 남은 MOVE·UP으로 속도 추적이나 플릭을 재시작하지 않음");
                // 3. onPause 시 VelocityTracker·플릭·adjustingInsets·root 콜백 정리 및 후속 잔여 이벤트 차단
                host.web.scrollY = 0;
                host.root.padT = 0;
                setFieldValue(host, "barsVisible", true);
                WindowInsets pauseAnimPad = new WindowInsets();
                pauseAnimPad.barInsets = Insets.of(0, 120, 0, 0);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, pauseAnimPad);
                check((Boolean)fieldValue(host, "adjustingInsets") && !host.root.animQueue.isEmpty(), "onPause 전 postClearAdjusting 예약 확인");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 30));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 640, 0, 40));
                scrollStep(host, 20);
                setFieldValue(host, "flinging", true);
                invokeChrome(host, "scheduleStopFling", new Class<?>[0]);
                invokeChrome(host, "onPause", new Class<?>[0]);
                check(!(Boolean)fieldValue(host, "touching") && !(Boolean)fieldValue(host, "flinging") && host.web.delayedQueue.isEmpty()
                    && !(Boolean)fieldValue(host, "gestureDragged") && !(Boolean)fieldValue(host, "gestureScrolled")
                    && !(Boolean)fieldValue(host, "adjustingInsets")
                    && (Integer)fieldValue(host, "activePointerId") == MotionEvent.INVALID_POINTER_ID,
                    "onPause 시 터치·플릭·adjustingInsets 상태 전체 정리");
                check(host.root.animQueue.isEmpty(), "onPause 시 대기 중이던 postClearAdjusting 콜백 제거");
                check(VelocityTracker.obtainedCount >= 1 && VelocityTracker.recycledCount == VelocityTracker.obtainedCount,
                    "onPause 후 VelocityTracker 반환 완료");
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 600, 0, 45));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 540, 0, 48));
                check(VelocityTracker.obtainedCount == VelocityTracker.recycledCount,
                    "onPause 뒤 잔여 MOVE·UP으로 VelocityTracker를 재할당·누수하지 않음");
                check(!(Boolean)fieldValue(host, "touching") && !(Boolean)fieldValue(host, "flinging")
                    && !(Boolean)fieldValue(host, "gestureDragged") && (Integer)fieldValue(host, "activePointerId") == MotionEvent.INVALID_POINTER_ID,
                    "onPause 뒤 잔여 MOVE·UP으로 플릭이나 드래그 상태를 켜지 않음");
                invokeChrome(host, "handlePageStarted", new Class<?>[]{String.class}, ChromeState.START_URL);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_MOVE, 300, 520, 0, 50));
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 480, 0, 52));
                check(VelocityTracker.obtainedCount == VelocityTracker.recycledCount && !(Boolean)fieldValue(host, "flinging"),
                    "handlePageStarted 직후 잔여 MOVE·UP에서도 VelocityTracker 획득·플릭 시작 금지");
                host.web.scrollY = 0;
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_DOWN, 300, 700, 0, 60));
                scrollStep(host, 100);
                invokeChrome(host, "handleTouch", new Class<?>[]{MotionEvent.class}, MotionEvent.single(MotionEvent.ACTION_UP, 300, 620, 0, 75));
                check(!(Boolean)fieldValue(host, "barsVisible"), "onPause 뒤 복귀 드래그가 adjustingInsets 잔존에 막히지 않고 상태바 숨김");
                host.web.flushDelayed();
                // postQueue(clearAdjusting) 단계에서 onPause 시 postQueue 콜백도 함께 제거되는지 검증
                WindowInsets pausePostPad = new WindowInsets();
                pausePostPad.barInsets = Insets.of(0, 160, 0, 0);
                invokeChrome(host, "applyInsets", new Class<?>[]{WindowInsets.class}, pausePostPad);
                host.root.runAnimationsOnly();
                check(!host.root.postQueue.isEmpty(), "runAnimationsOnly 후 clearAdjusting이 postQueue로 이동");
                invokeChrome(host, "onPause", new Class<?>[0]);
                check(host.root.postQueue.isEmpty(), "onPause 시 postQueue에 대기 중인 clearAdjusting 콜백도 제거");
                check(VelocityTracker.obtainedCount == VelocityTracker.recycledCount, "최종 VelocityTracker 누수 0건");
                break;
            default: throw new AssertionError("알 수 없는 상태바 검사: " + scenario);
        }
    }
    public static void main(String[] args) throws Exception {
        if (args[0].equals("compile")) { compile(Path.of(args[1]), Path.of(args[2])); return; }
        if (args[0].endsWith("-links")) { navigation(args[0]); return; }
        if (args[0].startsWith("chrome-")) { chrome(args[0]); return; }
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
