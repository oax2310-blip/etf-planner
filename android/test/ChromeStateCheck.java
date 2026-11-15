package io.github.oax2310blip.etfplanner;

// Android/JUnit 없이 실제 상태바 판단 클래스를 실행한다. 가상 좌표·색·주소만 사용한다.
public final class ChromeStateCheck {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        ChromeState state = new ChromeState(12);
        switch (args[0]) {
            case "down":
                check(state.isVisible()); state.beginGesture(0);
                check(state.scroll(11, true, false)); check(!state.scroll(12, true, false)); check(!state.scroll(12, true, false)); break;
            case "up":
                state.beginGesture(0); check(!state.scroll(100, true, false));
                check(!state.scroll(89, true, false)); check(state.scroll(88, true, false));
                check(state.scroll(99, true, false)); check(!state.scroll(100, true, false)); break;
            case "new-gesture":
                state.beginGesture(0); state.scroll(100, true, false); state.beginGesture(100);
                check(!state.scroll(95, true, false)); check(!state.scroll(90, true, false)); check(state.scroll(88, true, false)); break;
            case "programmatic":
                check(state.scroll(500, false, false)); state.beginGesture(500); check(!state.scroll(512, true, false));
                check(!state.scroll(100, false, false)); check(state.scroll(0, false, false)); break;
            case "resizing":
                state.beginGesture(0); check(!state.scroll(100, true, false));
                check(!state.scroll(76, true, true)); check(state.scroll(0, true, true)); break;
            case "keyboard":
                state.beginGesture(0); state.scroll(100, true, false); state.reveal(100);
                check(state.isVisible()); check(state.scroll(150, false, false)); check(state.scroll(145, true, false)); break;
            case "bounds":
                state.beginGesture(0); check(!state.scroll(Integer.MAX_VALUE, true, false));
                check(state.scroll(1, true, false)); check(state.scroll(-100, false, false));
                ChromeState minimum = new ChromeState(0); minimum.beginGesture(0); check(!minimum.scroll(1, true, false)); break;
            case "pages":
                for (String page : new String[]{"", "index.html", "assets.html", "valuation.html"})
                    check(ChromeState.isPlannerPage(ChromeState.START_URL + page + "?split=TEST#section"));
                check(ChromeState.isPlannerPage("https://oax2310-blip.github.io:443/etf-planner/")); break;
            case "reject-pages":
                for (String url : new String[]{"http://oax2310-blip.github.io/etf-planner/", "https://oax2310-blip.github.io/other/", "https://oax2310-blip.github.io/", "https://evil.test/etf-planner/", "https://oax2310-blip.github.io.evil.test/etf-planner/", "https://user@oax2310-blip.github.io/etf-planner/", "https://oax2310-blip.github.io:444/etf-planner/", "https://oax2310-blip.github.io/etf-planner/%2e%2e/index.html", "https://oax2310-blip.github.io/etf-planner/%2findex.html", "file:///etf-planner/index.html", "javascript:alert(1)", "intent://etf-planner/", "data:text/html,test", "", null})
                    check(!ChromeState.isPlannerPage(url)); break;
            case "blobs":
                String blob = "blob:https://oax2310-blip.github.io/12345678-1234-1234-1234-123456789abc";
                check(ChromeState.isAppBlob(blob)); check(!ChromeState.isAppBlob(blob.replace("oax2310-blip.github.io", "evil.test")));
                check(!ChromeState.isAppBlob(blob+"/../file")); check(!ChromeState.isAppBlob("javascript:alert(1)")); check(!ChromeState.isAppBlob(null)); break;
            case "colors":
                check(ChromeState.opaqueColor("rgb(245, 246, 248)") == 0xfff5f6f8);
                check(ChromeState.opaqueColor("rgba(10, 12, 16, 1)") == 0xff0a0c10);
                check(ChromeState.opaqueColor(" rgba(10,12,16,1.00) ") == 0xff0a0c10);
                check(ChromeState.opaqueColor("#F5F6F8") == 0xfff5f6f8); break;
            case "reject-colors":
                for (String color : new String[]{"transparent", "rgba(10,12,16,0)", "rgba(10,12,16,.82)", "rgb(256,0,0)", "rgb(-1,0,0)", "rgb(1,2)", "rgb(0,0,0,1)", "rgba(0,0,0)", "#000", "rgb(NaN,0,0)", "rgb(1e2,0,0)", "red", null})
                    check(ChromeState.opaqueColor(color) == null); break;
            case "contrast":
                check(ChromeState.useDarkStatusIcons(0xfff5f6f8)); check(!ChromeState.useDarkStatusIcons(0xff0a0c10));
                check(!ChromeState.useDarkStatusIcons(0xff202020));
                check(!ChromeState.useDarkStatusIcons(0xff757575)); check(ChromeState.useDarkStatusIcons(0xff767676)); break;
            default: throw new AssertionError("알 수 없는 테스트");
        }
    }
}
