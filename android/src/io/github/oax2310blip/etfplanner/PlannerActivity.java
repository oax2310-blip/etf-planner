package io.github.oax2310blip.etfplanner;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsAnimation;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// 안드로이드 표준 API만 사용하는 선택형 실행 앱. WebView의 기존 저장 형식·시세·동기화 코드는 수정하지 않는다.
public final class PlannerActivity extends Activity {
    private static final int OPEN_FILE = 10, SAVE_FILE = 11;
    private static final String PENDING_EXPORT_STATE = "pending-export";
    private WebView web;
    private FrameLayout root;
    private ChromeState chrome;
    private boolean touching, keyboardVisible, barsVisible = true, animating, adjustingInsets;
    private boolean gestureDragged, gestureScrolled, flinging, programmaticScroll;
    private int surface, restoreY, activePointerId = MotionEvent.INVALID_POINTER_ID;
    private int touchSlop, minFlingVelocity, maxFlingVelocity;
    private float downY, downOffsetX, downOffsetY;
    private VelocityTracker velocity;
    private WindowInsets targetInsets;
    private ValueCallback<Uri[]> fileCallback;
    private PendingExport pendingDownload;
    private boolean readingDownload;
    private int downloadSequence;
    private final Runnable stopFling = () -> flinging = false;
    private final Runnable clearAdjusting = () -> { if (!animating) adjustingInsets = false; };
    private final Runnable postClearAdjusting = () -> { if (root != null) root.post(clearAdjusting); };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        restoreDownload(state);
        surface = getResources().getColor(R.color.planner_background, getTheme());
        chrome = new ChromeState(Math.round(12 * getResources().getDisplayMetrics().density));
        ViewConfiguration config = ViewConfiguration.get(this);
        touchSlop = config.getScaledTouchSlop();
        minFlingVelocity = config.getScaledMinimumFlingVelocity();
        maxFlingVelocity = config.getScaledMaximumFlingVelocity();
        configureWindow(getWindow());
        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        setSurface(surface);
        configureInsets();
        configureWebView();
        root.post(() -> { applyBars(); root.requestApplyInsets(); });
        restoreY = state == null ? 0 : state.getInt("page-scroll", 0);
        if (getPreferences(MODE_PRIVATE).getBoolean("startup-acknowledged", false)) openPlanner(state);
        else new AlertDialog.Builder(this).setTitle("안드로이드 앱에서 시작하기")
            .setMessage("이 앱의 기록은 기존 브라우저와 별도입니다. 먼저 기존 화면의 동기화 완료나 JSON 백업을 확인한 뒤, 이 앱에서 동기화하거나 복원해 주세요.\n\n웹 푸시는 이 앱에서 지원되지 않습니다. 알림을 받던 기존 홈 화면 앱과 구독은 유지해 주세요.")
            .setPositiveButton("확인 후 앱 열기", (dialog, which) -> {
                // 사용자가 안내를 확인했을 때만 Android UI 설정을 저장한다. 웹앱의 저장 키와 기록에는 접근하지 않는다.
                getPreferences(MODE_PRIVATE).edit().putBoolean("startup-acknowledged", true).apply();
                openPlanner(state);
            }).setNegativeButton("기존 웹앱 열기", (dialog, which) -> { openBrowser(ChromeState.START_URL); finish(); })
            .setOnCancelListener(dialog -> finish()).show();
    }

    @SuppressWarnings("deprecation") private void configureWindow(Window window) {
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) window.setStatusBarContrastEnforced(false);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(params);
        }
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        else window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    private void openPlanner(Bundle state) {
        if (state == null || web.restoreState(state) == null) web.loadUrl(ChromeState.START_URL);
    }

    private void restoreDownload(Bundle state) {
        pendingDownload = PendingExport.restore(getCacheDir(), state == null ? null : state.getString(PENDING_EXPORT_STATE));
    }

    @SuppressWarnings("deprecation") private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // OS 파일 선택기로 허용한 JSON URI를 FileReader가 읽을 수 있게 한다. 저장소 권한은 요청하지 않는다.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        else if (Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return routeNavigation(view, request.getUrl().toString(), request.isForMainFrame() && request.hasGesture());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (!routeNavigation(view, url, false)) return false;
                // API 23에는 요청의 gesture/main-frame 정보가 없다. 선택한 링크 대상과 일치할 때만 외부로 보낸다.
                WebView.HitTestResult hit = view.getHitTestResult();
                if (hit != null && hit.getType() == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
                    // 이미지 hit의 extra는 src다. href는 별도로 받아 이전 페이지·종료 뒤 늦은 응답을 무시한다.
                    final String page = view.getUrl();
                    view.requestFocusNodeHref(new Handler(getMainLooper(), message -> {
                        if (!isFinishing() && !isDestroyed() && page != null && page.equals(view.getUrl()) && url != null && url.equals(message.getData().getString("url"))) routeNavigation(view, url, true);
                        return true;
                    }).obtainMessage());
                    return true;
                }
                boolean link = hit != null && hit.getType() == WebView.HitTestResult.SRC_ANCHOR_TYPE;
                return routeNavigation(view, url, link && url != null && url.equals(hit.getExtra()));
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                handlePageStarted(url);
            }
            @Override public void onPageCommitVisible(WebView view, String url) {
                handlePageCommitVisible(url);
            }
            @Override public void onPageFinished(WebView view, String url) {
                handlePageFinished(url);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) { callback.onReceiveValue(null); return true; }
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
                try { startActivityForResult(intent, OPEN_FILE); }
                catch (ActivityNotFoundException ignored) { fileCallback.onReceiveValue(null); fileCallback = null; notice("JSON 파일을 선택할 앱이 없습니다."); }
                return true;
            }
        });
        web.setOnTouchListener((view, event) -> handleTouch(event));
        web.setOnScrollChangeListener((view, x, y, oldX, oldY) -> handleScroll(y, oldY));
        web.setDownloadListener((url, agent, disposition, mime, length) -> prepareDownload(url, disposition, mime));
    }

    private void handlePageStarted(String url) {
        if (ChromeState.isAppBlob(url)) return; // 다운로드는 현재 문서를 바꾸지 않고 DownloadListener가 처리한다.
        if (!ChromeState.isPlannerPage(url)) { web.stopLoading(); return; }
        readingDownload = false; downloadSequence++;
        clearTouchGesture(); chrome.reveal(0); barsVisible = true; applyBars();
    }

    private void handlePageCommitVisible(String url) {
        if (ChromeState.isPlannerPage(url)) readSurface();
    }

    private void handlePageFinished(String url) {
        if (ChromeState.isPlannerPage(url)) readSurface();
        applyRestoreScroll();
    }

    private void applyRestoreScroll() {
        if (restoreY <= 0) return;
        final int y = restoreY;
        restoreY = 0;
        web.post(() -> {
            programmaticScroll = true;
            try { web.scrollTo(0, y); }
            finally { programmaticScroll = false; }
        });
    }

    private float pointerScreenY(MotionEvent event, int index) {
        return event.getY(index) + (event.getRawY() - event.getY());
    }

    private void trackVelocity(MotionEvent event) {
        if (velocity == null) velocity = VelocityTracker.obtain();
        MotionEvent tracked = MotionEvent.obtain(event);
        try {
            tracked.offsetLocation(event.getRawX() - event.getX(), event.getRawY() - event.getY());
            velocity.addMovement(tracked);
        } finally {
            tracked.recycle();
        }
    }

    private void endFling() {
        flinging = false;
        if (web != null) web.removeCallbacks(stopFling);
    }

    private void scheduleStopFling() {
        if (web == null) return;
        web.removeCallbacks(stopFling);
        web.postDelayed(stopFling, 180);
    }

    private void scheduleClearAdjusting() {
        if (root == null) return;
        root.removeCallbacks(postClearAdjusting);
        root.removeCallbacks(clearAdjusting);
        root.postOnAnimation(postClearAdjusting);
    }

    private void clearTouchGesture() {
        touching = false;
        activePointerId = MotionEvent.INVALID_POINTER_ID;
        gestureDragged = false;
        gestureScrolled = false;
        endFling();
    }

    protected void releaseTouch() {
        clearTouchGesture();
        adjustingInsets = false;
        if (root != null) {
            root.removeCallbacks(postClearAdjusting);
            root.removeCallbacks(clearAdjusting);
        }
        if (velocity != null) { velocity.recycle(); velocity = null; }
    }

    private boolean handleTouch(MotionEvent event) {
        int action = event.getActionMasked();
        if (action != MotionEvent.ACTION_DOWN && !touching) return false;
        float dx = 0f, dy = 0f;
        if (action != MotionEvent.ACTION_DOWN) {
            dx = (event.getRawX() - event.getX()) - downOffsetX;
            dy = (event.getRawY() - event.getY()) - downOffsetY;
        }
        switch (action) {
            case MotionEvent.ACTION_DOWN:
                endFling();
                if (velocity != null) velocity.clear();
                touching = true;
                gestureDragged = false;
                gestureScrolled = false;
                activePointerId = event.getPointerId(0);
                downY = pointerScreenY(event, 0);
                downOffsetX = event.getRawX() - event.getX();
                downOffsetY = event.getRawY() - event.getY();
                trackVelocity(event);
                chrome.beginGesture(web.getScrollY());
                break;
            case MotionEvent.ACTION_MOVE: {
                trackVelocity(event);
                int index = activePointerId == MotionEvent.INVALID_POINTER_ID ? -1 : event.findPointerIndex(activePointerId);
                if (index >= 0 && Math.abs(pointerScreenY(event, index) - downY) >= touchSlop) gestureDragged = true;
                break;
            }
            case MotionEvent.ACTION_POINTER_UP: {
                trackVelocity(event);
                int liftedIndex = event.getActionIndex();
                if (event.getPointerId(liftedIndex) == activePointerId && event.getPointerCount() > 1) {
                    int nextIndex = liftedIndex == 0 ? 1 : 0;
                    activePointerId = event.getPointerId(nextIndex);
                    downY = pointerScreenY(event, nextIndex);
                }
                break;
            }
            case MotionEvent.ACTION_UP: {
                trackVelocity(event);
                int index = activePointerId == MotionEvent.INVALID_POINTER_ID ? -1 : event.findPointerIndex(activePointerId);
                if (index >= 0 && Math.abs(pointerScreenY(event, index) - downY) >= touchSlop) gestureDragged = true;
                float vy = 0f;
                if (velocity != null && activePointerId != MotionEvent.INVALID_POINTER_ID) {
                    velocity.computeCurrentVelocity(1000, maxFlingVelocity);
                    vy = velocity.getYVelocity(activePointerId);
                    velocity.clear();
                }
                touching = false;
                activePointerId = MotionEvent.INVALID_POINTER_ID;
                if (!keyboardVisible && (gestureScrolled || gestureDragged) && Math.abs(vy) >= minFlingVelocity) {
                    flinging = true;
                    scheduleStopFling();
                } else {
                    endFling();
                }
                break;
            }
            case MotionEvent.ACTION_CANCEL:
                clearTouchGesture();
                break;
            default:
                trackVelocity(event);
                break;
        }
        if (dx != 0f || dy != 0f) event.offsetLocation(dx, dy);
        return false;
    }

    private void handleScroll(int y, int oldY) {
        if (keyboardVisible || y <= 0) {
            endFling();
            chrome.reveal(y);
        } else {
            if (programmaticScroll) endFling();
            if (y == oldY) return;
            boolean resizing = animating || adjustingInsets;
            if (touching && !resizing && !programmaticScroll) gestureScrolled = true;
            if (flinging) scheduleStopFling();
            chrome.scroll(y, !programmaticScroll && (touching || flinging), resizing);
        }
        if (barsVisible != chrome.isVisible()) { barsVisible = chrome.isVisible(); applyBars(); }
    }

    private boolean routeNavigation(WebView view, String url, boolean externalAllowed) {
        if (ChromeState.isPlannerPage(url)) return false;
        if (ChromeState.isPlannerPage(view.getUrl()) && ChromeState.isAppBlob(url)) return false;
        String scheme = url == null ? null : Uri.parse(url).getScheme();
        if (externalAllowed && ("https".equals(scheme) || "http".equals(scheme))) openBrowser(url);
        return true;
    }

    // Android 15 이상에서도 투명한 OS 상태바 아래를 root 배경으로 칠한다. 카메라·키보드는 안전 영역 안에 둔다.
    private void configureInsets() {
        root.setOnApplyWindowInsetsListener((view, insets) -> applyInsets(insets));
        if (Build.VERSION.SDK_INT >= 30) root.setWindowInsetsAnimationCallback(new WindowInsetsAnimation.Callback(WindowInsetsAnimation.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            private final Set<WindowInsetsAnimation> running = new HashSet<>();
            @Override public void onPrepare(WindowInsetsAnimation animation) { running.add(animation); animating = true; }
            @Override public WindowInsets onProgress(WindowInsets insets, List<WindowInsetsAnimation> animations) { applyPadding(insets); return insets; }
            @Override public void onEnd(WindowInsetsAnimation animation) { endInsetsAnimation(animation, running); }
        });
    }

    @SuppressWarnings("deprecation") private WindowInsets applyInsets(WindowInsets insets) {
        targetInsets = insets;
        keyboardVisible = Build.VERSION.SDK_INT >= 30
            ? insets.isVisible(WindowInsets.Type.ime())
            : root.getHeight() > 0 && insets.getSystemWindowInsetBottom() > root.getHeight() / 4;
        if (keyboardVisible && !barsVisible) { endFling(); chrome.reveal(web.getScrollY()); barsVisible = true; applyBars(); }
        if (!animating) applyPadding(insets);
        return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
    }

    private void endInsetsAnimation(WindowInsetsAnimation animation, Set<WindowInsetsAnimation> running) {
        running.remove(animation);
        animating = !running.isEmpty();
        if (!animating && targetInsets != null) applyPadding(targetInsets);
        if (!animating && adjustingInsets) scheduleClearAdjusting();
    }

    @SuppressWarnings("deprecation") private void applyPadding(WindowInsets insets) {
        int left, top, right, bottom;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            left = safe.left; top = safe.top; right = safe.right;
            bottom = Math.max(safe.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
        } else {
            left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = insets.getDisplayCutout();
                if (cutout != null) { left = Math.max(left, cutout.getSafeInsetLeft()); top = Math.max(top, cutout.getSafeInsetTop()); right = Math.max(right, cutout.getSafeInsetRight()); bottom = Math.max(bottom, cutout.getSafeInsetBottom()); }
            }
        }
        if (root.getPaddingLeft()!=left || root.getPaddingTop()!=top || root.getPaddingRight()!=right || root.getPaddingBottom()!=bottom) {
            adjustingInsets = true;
            root.setPadding(left, top, right, bottom);
            if (!animating) scheduleClearAdjusting();
        }
    }

    @SuppressWarnings("deprecation") private void applyBars() {
        boolean darkIcons = ChromeState.useDarkStatusIcons(surface);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) return;
            controller.setSystemBarsAppearance(darkIcons ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (barsVisible) controller.show(WindowInsets.Type.statusBars());
            else controller.hide(WindowInsets.Type.statusBars());
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            if (darkIcons) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (!barsVisible) flags |= View.SYSTEM_UI_FLAG_FULLSCREEN;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void setSurface(int color) {
        surface = color;
        root.setBackgroundColor(color);
        web.setBackgroundColor(color);
        applyBars();
    }

    private void readSurface() {
        if (!ChromeState.isPlannerPage(web.getUrl())) return;
        try { web.evaluateJavascript(asset("read-surface.js"), result -> {
            if (!ChromeState.isPlannerPage(web.getUrl())) return;
            try {
                JSONArray colors = new JSONArray(result);
                Integer color = ChromeState.opaqueColor(colors.optString(0));
                if (color == null) color = ChromeState.opaqueColor(colors.optString(1));
                if (color != null) setSurface(color);
            } catch (Exception ignored) { /* 페이지 로딩 중에는 기본 배경색을 유지한다. */ }
        }); } catch (Exception ignored) { notice("화면의 배경색을 읽지 못했습니다."); }
    }

    private String asset(String name) throws Exception {
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString("UTF-8");
        }
    }

    private void prepareDownload(String url, String disposition, String mime) {
        if (!ChromeState.isPlannerPage(web.getUrl()) || !ChromeState.isAppBlob(url)) { notice("이 앱에서 만든 백업 파일만 저장할 수 있습니다."); return; }
        final String type = mime == null ? "application/json" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (!"application/json".equals(type) && !"text/csv".equals(type)) { notice("JSON·CSV 파일만 저장할 수 있습니다."); return; }
        if (pendingDownload != null || readingDownload) { notice("열려 있는 파일 저장을 먼저 마쳐 주세요."); return; }
        readingDownload = true;
        final int sequence = ++downloadSequence;
        final String page = web.getUrl();
        final String name = disposition == null || disposition.isEmpty() ? "etf-planner-" + ("text/csv".equals(type) ? "export.csv" : "backup.json") : URLUtil.guessFileName(url, disposition, type);
        try { web.evaluateJavascript(asset("read-download.js").replace("__PLANNER_BLOB_URL__", JSONObject.quote(url)), result -> {
            pollDownload(sequence, page, type, name, 0);
        }); } catch (Exception ignored) { readingDownload = false; notice("파일을 읽지 못했습니다. 다시 백업해 주세요."); }
    }

    private void pollDownload(int sequence, String page, String type, String name, int attempts) {
        if (sequence != downloadSequence || !readingDownload || isFinishing()) return;
        if (!ChromeState.isPlannerPage(web.getUrl()) || !page.equals(web.getUrl())) { readingDownload = false; return; }
        try { web.evaluateJavascript(asset("take-download.js"), result -> {
            if (sequence != downloadSequence || !readingDownload || isFinishing()) return;
            try {
                JSONObject job = new JSONObject(result);
                if ("pending".equals(job.optString("status")) && attempts < 300) {
                    web.postDelayed(() -> pollDownload(sequence, page, type, name, attempts+1), 100);
                    return;
                }
                readingDownload = false;
                if (!"ready".equals(job.optString("status"))) throw new IllegalArgumentException();
                pendingDownload = PendingExport.create(getCacheDir(), Base64.decode(job.getString("base64"), Base64.DEFAULT));
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type).putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(intent, SAVE_FILE);
            } catch (Exception ignored) { readingDownload = false; if (pendingDownload != null) pendingDownload.discard(); pendingDownload = null; notice("파일을 저장할 수 없습니다. 다시 백업해 주세요."); }
        }); } catch (Exception ignored) { readingDownload = false; notice("파일을 읽지 못했습니다. 다시 백업해 주세요."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        } else if (request == SAVE_FILE) {
            final PendingExport download = pendingDownload; pendingDownload = null;
            if (result != RESULT_OK) { if (download != null) download.discard(); return; }
            if (data == null || data.getData() == null || download == null) {
                if (download != null) download.discard();
                notice("백업 내용을 복원하지 못했습니다. 다시 백업해 주세요.");
                return;
            }
            final Uri target = data.getData();
            new Thread(() -> {
                try {
                    // 원문을 먼저 연다. 캐시가 없어졌다면 대상 문서를 열거나 성공으로 알리지 않는다.
                    try (InputStream input = download.open(); OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                        if (output == null) throw new IllegalStateException();
                        byte[] buffer = new byte[8192]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    runOnUiThread(() -> notice("파일을 저장했습니다."));
                } catch (Exception ignored) { runOnUiThread(() -> notice("저장하지 못했습니다. 원래 기록은 앱에 남아 있습니다. 다시 백업해 주세요.")); }
                finally { download.discard(); }
            }).start();
        }
    }

    private void openBrowser(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException ignored) { notice("페이지를 열 브라우저가 없습니다."); }
    }
    private void notice(String message) { if (!isFinishing()) Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused && web != null) { applyBars(); readSurface(); } }
    @Override protected void onPause() { releaseTouch(); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putString(PENDING_EXPORT_STATE, pendingDownload == null ? null : pendingDownload.id()); web.saveState(state); state.putInt("page-scroll", web.getScrollY()); super.onSaveInstanceState(state); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (fileCallback != null) fileCallback.onReceiveValue(null); if (isFinishing() && pendingDownload != null) pendingDownload.discard(); pendingDownload = null; readingDownload = false; downloadSequence++; releaseTouch(); web.destroy(); super.onDestroy(); }
}
