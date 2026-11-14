package io.github.oax2310blip.etfplanner;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicReference;

// Android 표준 Instrumentation으로 실제 Activity·WebView·OS 상태바를 확인한다. JUnit/외부 테스트 라이브러리는 쓰지 않는다.
public final class ChromeInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    private FrameLayout root;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private Object field(String name) throws Exception { java.lang.reflect.Field f=activity.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(activity); }
    private void waitUntil(java.util.function.BooleanSupplier predicate, String message) {
        long limit=SystemClock.uptimeMillis()+20000;
        while(SystemClock.uptimeMillis()<limit) { AtomicReference<Boolean> ok=new AtomicReference<>(false); runOnMainSync(()->ok.set(predicate.getAsBoolean())); if(ok.get())return; SystemClock.sleep(100); }
        throw new AssertionError(message);
    }
    private String javascript(String script) throws Exception {
        AtomicReference<String> result=new AtomicReference<>();
        runOnMainSync(()->web.evaluateJavascript(script,result::set));
        long limit=SystemClock.uptimeMillis()+15000;
        while(result.get()==null && SystemClock.uptimeMillis()<limit)SystemClock.sleep(50);
        check(result.get()!=null,"JavaScript 응답 시간 초과");return result.get();
    }
    private String asset(android.content.Context context,String name) throws Exception {
        try(InputStream input=context.getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)out.write(buffer,0,n);return out.toString("UTF-8");
        }
    }
    private void screenshot(String name) throws Exception {
        SystemClock.sleep(500);
        Bitmap bitmap=getUiAutomation().takeScreenshot();
        int expected=((ColorDrawable)root.getBackground()).getColor();
        File file=new File(getTargetContext().getExternalFilesDir(null),name+".png");
        try(FileOutputStream out=new FileOutputStream(file)){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}
        check(bitmap.getColorSpace()!=null&&bitmap.getColorSpace().isSrgb(),"sRGB 캡처");
        check(bitmap.getPixel(5,5)==expected,"실제 OS 상태바 배경과 본문 색 일치: "+Integer.toHexString(bitmap.getPixel(5,5))+" / "+Integer.toHexString(expected));
        check(bitmap.getPixel(5,200)==expected,"WebView가 본문을 별도 다크 색으로 변환하지 않음");
        bitmap.recycle();
    }
    private void swipe(int from,int to) {
        long start=SystemClock.uptimeMillis();
        sendPointerSync(MotionEvent.obtain(start,start,MotionEvent.ACTION_DOWN,300,from,0));
        for(int i=1;i<=20;i++) { SystemClock.sleep(35); sendPointerSync(MotionEvent.obtain(start,SystemClock.uptimeMillis(),MotionEvent.ACTION_MOVE,300,from+(to-from)*i/20f,0)); }
        sendPointerSync(MotionEvent.obtain(start,SystemClock.uptimeMillis(),MotionEvent.ACTION_UP,300,to,0));
        SystemClock.sleep(600);
    }
    private void tapImport() throws Exception {
        JSONArray point=new JSONArray(javascript("(function(){var r=document.querySelector('#importFile').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()"));
        int[] origin=new int[2];runOnMainSync(()->web.getLocationOnScreen(origin));
        float x=origin[0]+(float)point.getDouble(0),y=origin[1]+(float)point.getDouble(1);long time=SystemClock.uptimeMillis();
        sendPointerSync(MotionEvent.obtain(time,time,MotionEvent.ACTION_DOWN,x,y,0));
        sendPointerSync(MotionEvent.obtain(time,SystemClock.uptimeMillis()+50,MotionEvent.ACTION_UP,x,y,0));
    }
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            getTargetContext().getSharedPreferences("PlannerActivity",0).edit().putBoolean("startup-acknowledged",true).commit();
            Intent launch=new Intent().setComponent(new ComponentName(getTargetContext(),"io.github.oax2310blip.etfplanner.PlannerActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=startActivitySync(launch);web=(WebView)field("web");root=(FrameLayout)field("root");
            final String html=asset(getContext(),"fixture.html");
            runOnMainSync(()->{
                web.stopLoading();
                WebViewClient original=web.getWebViewClient();
                web.setWebViewClient(new WebViewClient(){
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                        if(request.isForMainFrame()&&request.getUrl().toString().equals("https://oax2310-blip.github.io/etf-planner/"))
                            return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                        return original.shouldInterceptRequest(view,request);
                    }
                    @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){original.onPageStarted(view,url,icon);}
                    @Override public void onPageFinished(WebView view,String url){original.onPageFinished(view,url);}
                    @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return original.shouldOverrideUrlLoading(view,request);}
                });
                web.loadUrl("https://oax2310-blip.github.io/etf-planner/");
            });
            long pageLimit=SystemClock.uptimeMillis()+20000;
            while(!"true".equals(javascript("window.fixtureReady===true&&document.documentElement.dataset.nativeApp==='android'"))&&SystemClock.uptimeMillis()<pageLimit)SystemClock.sleep(100);
            check("true".equals(javascript("window.fixtureReady===true")),"가상 페이지 초기화");
            waitUntil(()->((ColorDrawable)root.getBackground()).getColor()==0xff0a0c10,"페이지와 상태바의 어두운 배경색 일치");
            javascript("document.fonts.ready.then(function(){window.fontReady=true;});true");
            long fontLimit=SystemClock.uptimeMillis()+20000;while(!"true".equals(javascript("window.fontReady===true"))&&SystemClock.uptimeMillis()<fontLimit)SystemClock.sleep(100);
            check("true".equals(javascript("document.fonts.check('15px \"Pretendard Variable\"')")),"기존 Pretendard 글꼴 로딩");
            check("\"relative\"".equals(javascript("getComputedStyle(document.querySelector('.top')).position")),"native 표식의 상단바 스크롤 CSS: "+javascript("JSON.stringify({width:innerWidth,coarse:matchMedia('(pointer:coarse)').matches,hover:matchMedia('(hover:hover)').matches,native:document.documentElement.dataset.nativeApp,position:getComputedStyle(document.querySelector('.top')).position,url:location.href})"));
            waitUntil(()->root.getRootWindowInsets().isVisible(WindowInsets.Type.statusBars()),"맨 위 상태바 표시");
            screenshot("native-dark-top");
            check((activity.getWindow().getInsetsController().getSystemBarsAppearance()&WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)==0,"어두운 배경의 밝은 아이콘");
            swipe(680,220);
            waitUntil(()->web.getScrollY()>100&&!root.getRootWindowInsets().isVisible(WindowInsets.Type.statusBars()),"아래로 스크롤하면 OS 상태바 숨김");
            check("false".equals(javascript("Boolean(document.fullscreenElement)")),"웹 Fullscreen API를 사용하지 않음");
            screenshot("native-dark-down");
            swipe(220,680);
            waitUntil(()->root.getRootWindowInsets().isVisible(WindowInsets.Type.statusBars()),"위로 스크롤하면 OS 상태바 표시");
            for(int i=0;i<6&&web.getScrollY()>0;i++)swipe(180,720);
            waitUntil(()->web.getScrollY()==0&&root.getRootWindowInsets().isVisible(WindowInsets.Type.statusBars()),"맨 위 복귀 표시");
            screenshot("native-dark-returned");
            check("true".equals(javascript("matchMedia('(pointer:coarse)').matches&&!matchMedia('(hover:hover)').matches")),"터치·hover 해제");
            result.putString("viewport",javascript("JSON.stringify({width:innerWidth,height:innerHeight,deviceWidth:screen.width,deviceHeight:screen.height,dpr:devicePixelRatio,theme:document.documentElement.dataset.theme})"));
            String url=(String)new JSONTokener(javascript("URL.createObjectURL(new Blob([new Uint8Array([239,187,191,234,176,128,13,10])],{type:'text/csv;charset=utf-8'}))")).nextValue();
            String download=asset(getTargetContext(),"read-download.js").replace("__PLANNER_BLOB_URL__",JSONObject.quote(url));
            javascript(download);
            JSONObject downloadJob=null;long downloadLimit=SystemClock.uptimeMillis()+15000;
            while(SystemClock.uptimeMillis()<downloadLimit){
                downloadJob=new JSONObject(javascript(asset(getTargetContext(),"take-download.js")));
                if(!"pending".equals(downloadJob.optString("status")))break;SystemClock.sleep(100);
            }
            check(downloadJob!=null&&"ready".equals(downloadJob.optString("status")),"비동기 파일 읽기 완료");
            String encoded=downloadJob.getString("base64");
            check(Arrays.equals(android.util.Base64.decode(encoded,0),new byte[]{(byte)239,(byte)187,(byte)191,(byte)234,(byte)176,(byte)128,13,10}),"실제 WebView의 CSV BOM·UTF-8 보존");
            Intent picked=new Intent().setData(Uri.parse("content://io.github.oax2310blip.etfplanner.test-backup/record.json"));
            ActivityMonitor picker=addMonitor(new IntentFilter(Intent.ACTION_OPEN_DOCUMENT),new ActivityResult(Activity.RESULT_OK,picked),true);
            tapImport();
            long fileLimit=SystemClock.uptimeMillis()+15000;
            while(!"true".equals(javascript("window.imported===true"))&&SystemClock.uptimeMillis()<fileLimit)SystemClock.sleep(100);
            removeMonitor(picker);
            String imported=(String)new JSONTokener(javascript("window.importedText||''")).nextValue();
            check(Arrays.equals(imported.getBytes(StandardCharsets.UTF_8),TestBackupProvider.BYTES),"OS 파일 선택기의 JSON 원문 전달");
            javascript("document.documentElement.dataset.theme='light';true");
            java.lang.reflect.Method read=activity.getClass().getDeclaredMethod("readSurface");read.setAccessible(true);
            runOnMainSync(()->{try{read.invoke(activity);}catch(Exception error){throw new RuntimeException(error);}});
            waitUntil(()->((ColorDrawable)root.getBackground()).getColor()==0xfff5f6f8,"밝은 배경과 상태바 일치");
            check((activity.getWindow().getInsetsController().getSystemBarsAppearance()&WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)!=0,"밝은 배경의 어두운 아이콘");
            screenshot("native-light-check");
            result.putString("stream","OS 상태바 숨김·복귀, 낮/밤 색·아이콘, JSON 복원, CSV 바이트 검증 통과\n화면 조건: "+result.getString("viewport")+"\n");
            finish(Activity.RESULT_OK,result);
        } catch(Throwable error) {
            result.putString("stream","검증 실패: "+error.toString()+"\n");finish(Activity.RESULT_CANCELED,result);
        }
    }
}
