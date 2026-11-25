// index.html·valuation.html·assets.html의 화면 모드. 플래너 제목은 화면 설정 창을 열고, [data-theme-pick]은 PC용 메뉴 자리다.
const THEME_KEY = "etf-planner-theme";
// themeOf는 DOM 없이 검증하는 화면 모드 계산 함수로 유지한다.
function themeOf(choice, systemDark){ return choice === "light" || choice === "dark" ? choice : systemDark ? "dark" : "light"; }
// 각 페이지 head에서 먼저 불러 첫 화면 색을 맞춘다. <html data-theme>가 CSS의 밝은·어두운 토큰을 고른다.
(function(){
  if (typeof document === "undefined" || typeof matchMedia !== "function") return;
  const desktopQ = matchMedia("(hover:hover) and (pointer:fine)"), darkQ = matchMedia("(prefers-color-scheme: dark)"), CHOICES = ["auto","light","dark"];
  // 삼성 인터넷의 터치 화면은 사용자가 직접 고르기 전까지 자체 다크 테마로 연다.
  const samsung = /\bSamsungBrowser\//i.test(globalThis.navigator?.userAgent || "");
  const TOUCH_THEME_KEY = "etf-planner-touch-theme";
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {auto:svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'), light:svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'), dark:svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>')};
  const LABEL = {auto:"기기 설정 따름", light:"밝게", dark:"어둡게"};
  // 기존 PC 설정과 터치에서 고른 값은 따로 저장한다. 삼성 터치의 "auto"는 기본값인 "dark"와 구분해 저장한다.
  const choiceKey = () => desktopQ.matches ? THEME_KEY : TOUCH_THEME_KEY;
  const defaultChoice = () => !desktopQ.matches && samsung ? "dark" : "auto";
  function read(){
    try { const value = localStorage.getItem(choiceKey()); if (CHOICES.includes(value)) return value; } catch {}
    return defaultChoice();
  }
  function select(choice){
    if (!CHOICES.includes(choice)) return;
    const key = choiceKey();
    try { if (choice === defaultChoice()) localStorage.removeItem(key); else localStorage.setItem(key, choice); } catch {}
    apply();
  }
  let picks = [];
  // 설치 앱의 상태바에 실제 화면 모드의 본문 배경색을 요청한다. OS의 최종 색 적용·스크롤에 따른 숨김은 웹앱이 제어하지 못한다.
  function apply(){ const choice = read(), theme = themeOf(choice, darkQ.matches);
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.content = theme === "dark" ? "#0a0c10" : "#f5f6f8");
    picks.forEach(p => p(choice)); }
  apply();
  desktopQ.addEventListener?.("change", apply); darkQ.addEventListener?.("change", apply);
  addEventListener("storage", e => { if (e.key === choiceKey() || e.key === null) apply(); });
  // [data-theme-pick] 버튼은 CSS에서 PC에만 보인다. 메뉴 popover는 윗줄 overflow 위에 떠서 잘리지 않는다.
  // popover를 모르는 옛 브라우저는 이 버튼을 표시하지 않는다.
  function build(slot, i){
    const id = `themeMenu${i}`;
    slot.classList.add("theme-pick");
    slot.innerHTML = `<button class="btn mini theme-btn" type="button" popovertarget="${id}" aria-haspopup="menu"></button><div class="theme-menu" id="${id}" popover role="menu" aria-label="화면 모드">${CHOICES.map(c => `<button type="button" role="menuitemradio" data-theme-choice="${c}">${ICON[c]}<span>${LABEL[c]}</span></button>`).join("")}</div>`;
    const btn = slot.firstElementChild, menu = slot.lastElementChild, open = () => menu.matches(":popover-open");
    menu.addEventListener("beforetoggle", e => { if (e.newState !== "open") return; const r = btn.getBoundingClientRect(); menu.style.top = `${Math.round(r.bottom + 6)}px`; menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`; });
    addEventListener("scroll", () => { if (open()) menu.hidePopover(); }, {passive:true});
    menu.querySelectorAll("[data-theme-choice]").forEach(b => b.onclick = () => {
      select(b.dataset.themeChoice); menu.hidePopover(); btn.focus();
    });
    return choice => { btn.innerHTML = ICON[choice]; btn.title = `화면 모드: ${LABEL[choice]}`; btn.setAttribute("aria-label", btn.title); menu.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.themeChoice === choice))); };
  }
  function buildDialog(dialog){
    const trigger = document.getElementById("themeSettingsBtn");
    const options = [...dialog.querySelectorAll('[name="themeMode"]')];
    document.getElementById("themeSettingsSamsungHint").hidden = !samsung;
    trigger.addEventListener("click", () => {
      dialog.showModal();
      options.find(input => input.checked)?.focus();
    });
    options.forEach(input => input.addEventListener("change", () => { if (input.checked) select(input.value); }));
    return choice => { options.forEach(input => input.checked = input.value === choice); };
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (HTMLElement.prototype.hasOwnProperty("popover")) picks = [...document.querySelectorAll("[data-theme-pick]")].map(build);
    const dialog = document.getElementById("themeSettingsDialog");
    if (dialog?.showModal) picks.push(buildDialog(dialog));
    apply();
  });
})();
