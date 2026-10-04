// 화면 모드: PC(마우스·트랙패드)는 윗줄 버튼으로 기기 설정 따름·밝게·어둡게를 고르고, 휴대폰·태블릿(터치)은 고른 값과 상관없이 기기 설정을 따른다.
// 고른 값은 이 브라우저 localStorage(THEME_KEY)에만 — 동기화 기록(state) 밖. index.html·valuation.html 둘 다 head에서 먼저 불러 첫 화면부터 맞는 색으로 그린다.
// CSS는 <html data-theme="dark">일 때 어두운 토큰(app.css·valuation.html 맨 위). 버튼은 [data-theme-pick] 자리에 그린다. themeOf만 화면 없이 테스트한다.
const THEME_KEY = "etf-planner-theme";
// choice: 고른 값(auto·light·dark), desktop: 마우스 기기, systemDark: 기기가 어두운 모드 → "light" 또는 "dark"
function themeOf(choice, desktop, systemDark){ return desktop && (choice === "light" || choice === "dark") ? choice : systemDark ? "dark" : "light"; }
(function(){
  if (typeof document === "undefined" || typeof matchMedia !== "function") return;
  const desktopQ = matchMedia("(hover:hover) and (pointer:fine)"), darkQ = matchMedia("(prefers-color-scheme: dark)"), CHOICES = ["auto","light","dark"];
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {auto:svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'), light:svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'), dark:svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>')};
  const LABEL = {auto:"기기 설정 따름", light:"밝게", dark:"어둡게"};
  const read = () => { try { const v = localStorage.getItem(THEME_KEY); return CHOICES.includes(v) ? v : "auto"; } catch { return "auto"; } };
  let picks = [];
  function apply(){ const choice = read(); document.documentElement.dataset.theme = themeOf(choice, desktopQ.matches, darkQ.matches); picks.forEach(p => p(choice)); }
  apply();
  desktopQ.addEventListener?.("change", apply); darkQ.addEventListener?.("change", apply);
  addEventListener("storage", e => { if (e.key === THEME_KEY) apply(); }); // 다른 탭(플래너↔시나리오)에서 바꾸면 같이
  // 버튼 + 고르는 메뉴(popover: 화면 맨 위 층에 떠서 윗줄 overflow에 잘리지 않음). popover를 모르는 옛 브라우저는 버튼 없이 기기 설정만.
  function build(slot, i){
    const id = `themeMenu${i}`;
    slot.classList.add("theme-pick");
    slot.innerHTML = `<button class="btn mini theme-btn" type="button" popovertarget="${id}" aria-haspopup="menu"></button><div class="theme-menu" id="${id}" popover role="menu" aria-label="화면 모드">${CHOICES.map(c => `<button type="button" role="menuitemradio" data-theme-choice="${c}">${ICON[c]}<span>${LABEL[c]}</span></button>`).join("")}</div>`;
    const btn = slot.firstElementChild, menu = slot.lastElementChild, open = () => menu.matches(":popover-open");
    menu.addEventListener("beforetoggle", e => { if (e.newState !== "open") return; const r = btn.getBoundingClientRect(); menu.style.top = `${Math.round(r.bottom + 6)}px`; menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`; });
    addEventListener("scroll", () => { if (open()) menu.hidePopover(); }, {passive:true});
    menu.querySelectorAll("[data-theme-choice]").forEach(b => b.onclick = () => {
      try { if (b.dataset.themeChoice === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, b.dataset.themeChoice); } catch {}
      apply(); menu.hidePopover(); btn.focus();
    });
    return choice => { btn.innerHTML = ICON[choice]; btn.title = `화면 모드: ${LABEL[choice]}`; btn.setAttribute("aria-label", btn.title); menu.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.themeChoice === choice))); };
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!HTMLElement.prototype.hasOwnProperty("popover")) return;
    picks = [...document.querySelectorAll("[data-theme-pick]")].map(build); apply();
  });
})();
