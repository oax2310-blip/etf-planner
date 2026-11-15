package io.github.oax2310blip.etfplanner;

import java.net.URI;
import java.util.Locale;

// Android 의존성이 없는 상태바 판단. 저장·계산·웹앱의 기록에는 접근하지 않는다.
public final class ChromeState {
    public static final String START_URL = "https://oax2310-blip.github.io/etf-planner/";
    private final int threshold;
    private int lastY, anchor, direction;
    private boolean visible = true;

    public ChromeState(int threshold) { this.threshold = Math.max(1, threshold); }
    public boolean isVisible() { return visible; }
    public void beginGesture(int y) { lastY = anchor = Math.max(0, y); direction = 0; }
    public void reveal(int y) { visible = true; beginGesture(y); }

    // 12dp 누적 이동 뒤 아래로 스크롤하면 숨기고 위로 올리면 보인다. 맨 위는 제스처와 무관하게 보인다.
    // 상태바/키보드 크기 변화·앵커 이동 같은 프로그램 스크롤은 숨김 판단에 쓰지 않는다.
    public boolean scroll(int y, boolean fromTouch, boolean viewResizing) {
        y = Math.max(0, y);
        if (y == 0) { reveal(0); return visible; }
        int previous = lastY;
        lastY = y;
        if (!fromTouch || viewResizing) { anchor = y; direction = 0; return visible; }
        int nextDirection = Integer.compare(y, previous);
        if (nextDirection == 0) return visible;
        if (direction != nextDirection) { direction = nextDirection; anchor = previous; }
        if (Math.abs((long)y - anchor) >= threshold) visible = direction < 0;
        return visible;
    }

    public static boolean isPlannerPage(String url) {
        if (url == null) return false;
        try {
            URI uri = new URI(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"oax2310-blip.github.io".equalsIgnoreCase(uri.getHost())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443) return false;
            String path = uri.getPath();
            return "/etf-planner/".equals(path) || "/etf-planner/index.html".equals(path)
                    || "/etf-planner/assets.html".equals(path) || "/etf-planner/valuation.html".equals(path);
        } catch (Exception ignored) { return false; }
    }

    public static boolean isAppBlob(String url) {
        return url != null && url.matches("blob:https://oax2310-blip\\.github\\.io/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    }

    // 본문이 투명하면 html 배경을 대신 읽는다. 불투명 rgb/rgba와 6자리 hex만 받아 OS에 임의 문자열을 넘기지 않는다.
    public static Integer opaqueColor(String css) {
        if (css == null) return null;
        String value = css.trim().toLowerCase(Locale.ROOT);
        try {
            if (value.matches("#[0-9a-f]{6}")) return (int)(0xff000000L | Long.parseLong(value.substring(1), 16));
            boolean rgba = value.startsWith("rgba(");
            if (!rgba && !value.startsWith("rgb(")) return null;
            if (!value.endsWith(")")) return null;
            String[] channels = value.substring(rgba ? 5 : 4, value.length()-1).split(",", -1);
            if (channels.length != (rgba ? 4 : 3) || rgba && !channels[3].trim().matches("1(?:\\.0+)?")) return null;
            int rgb = 0xff000000;
            for (int i = 0; i < 3; i++) {
                if (!channels[i].trim().matches("[0-9]{1,3}")) return null;
                int channel = Integer.parseInt(channels[i].trim());
                if (channel > 255) return null;
                rgb |= channel << (16-i*8);
            }
            return rgb;
        } catch (RuntimeException ignored) { return null; }
    }

    // WCAG 상대 휘도로 흰색/검정 아이콘 중 대비가 큰 쪽을 고른다.
    public static boolean useDarkStatusIcons(int color) {
        double luminance = 0;
        double[] weights = {.2126, .7152, .0722};
        for (int i = 0; i < 3; i++) {
            double channel = ((color >> (16-i*8)) & 255) / 255.0;
            luminance += weights[i] * (channel <= .04045 ? channel / 12.92 : Math.pow((channel+.055)/1.055, 2.4));
        }
        return (luminance+.05)/.05 >= 1.05/(luminance+.05);
    }
}
