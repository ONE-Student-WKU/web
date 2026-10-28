// 리포트 페이지에 들어가는 실행 코드(build.js가 넣는다, README.md).
// 폰 자리마다 Shadow DOM을 붙이고, 그 브랜치의 App.css(scope-css.js로 375×812용으로 바꾼 것)와 캡처한 화면 DOM을 넣는다.
// 폰 자리의 속성:
//   data-cap="캡처 이름"  data-css="CSS 이름(cap/<이름>.scoped.css)"  data-proposal(cap/proposal.scoped.css도 얹음)  data-patch="패치 이름(patches/<이름>.js)"
//   data-pins='[{"sel":"CSS 선택자","has":"포함할 글자(선택)","n":1}]'  — 걸리는 곳 번호
//   data-scroll-to="선택자"  — 그 요소가 화면 위쪽에 오도록 스크롤(+ data-scroll-offset)
(function () {
  const sheets = {};
  function sheetFor(branch) {
    if (!sheets[branch]) {
      const el = document.getElementById('css-' + branch);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(el ? el.textContent : '');
      sheets[branch] = sheet;
    }
    return sheets[branch];
  }
  const extra = new CSSStyleSheet();
  extra.replaceSync(`
    :host { all: initial; display: block; }
    /* 실제 폰은 겹쳐 뜨는 스크롤 막대라 폭을 차지하지 않는다 — 데스크톱에서도 같게 */
    * { scrollbar-width: none; }
    *::-webkit-scrollbar { display: none; }
    .app-body { width: 375px; height: 812px; overflow: hidden; }
    .app-root.show-marks [data-pin] { outline: 2px solid #c2410c; outline-offset: 2px; border-radius: 6px; }
    .app-root.show-marks [data-pin]::after {
      content: attr(data-pin); position: absolute; top: -11px; right: -8px; z-index: 30;
      width: 22px; height: 22px; border-radius: 50%; background: #c2410c; color: #fff;
      font: 700 12px/22px Pretendard, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; pointer-events: none;
    }
    .app-root.show-marks [data-new] { outline: 2px solid #2563eb; outline-offset: 2px; border-radius: 6px; }
    .app-root.show-marks [data-new]::after {
      content: attr(data-new); position: absolute; top: -11px; right: -8px; z-index: 30; padding: 0 7px; height: 22px; border-radius: 11px;
      background: #2563eb; color: #fff; font: 700 11px/22px Pretendard, sans-serif; white-space: nowrap; box-shadow: 0 0 0 2px #fff; pointer-events: none;
    }
    .app-root.show-marks [data-proposed] { outline: 2px dashed #0f766e; outline-offset: 2px; border-radius: 6px; }
    .app-root.show-marks [data-proposed]::after {
      content: '✓'; position: absolute; top: -11px; right: -8px; z-index: 30;
      width: 22px; height: 22px; border-radius: 50%; background: #0f766e; color: #fff;
      font: 700 12px/22px Pretendard, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; pointer-events: none;
    }
  `);

  let theme = 'light';
  let marks = true;
  try {
    theme = localStorage.getItem('phoneTheme') || 'light';
    marks = localStorage.getItem('phoneMarks') !== 'off';
  } catch (e) {}

  function findScroller(el) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  }
  // 번호·표시를 다는 요소는 ::after 자리를 잡으려고 position이 static일 때만 relative로 바꾼다(레이아웃은 그대로).
  function anchor(el) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  }

  function mount(host) {
    const name = host.dataset.cap;
    const tpl = document.getElementById('cap-' + name);
    const viewport = document.createElement('div');
    viewport.className = 'phone-viewport';
    host.appendChild(viewport);
    if (!tpl) {
      viewport.innerHTML = '<p class="phone-missing">화면을 불러오지 못했어요: ' + name + '</p>';
      return;
    }
    const shadow = viewport.attachShadow({ mode: 'open' });
    const list = [sheetFor(host.dataset.css)];
    if ('proposal' in host.dataset) list.push(sheetFor('proposal'));
    shadow.adoptedStyleSheets = [...list, extra];
    const rootEl = document.createElement('div');
    rootEl.className = 'app-root' + (marks ? ' show-marks' : '');
    rootEl.dataset.theme = theme;
    rootEl.dataset.fontSize = 'medium';
    // 실제 앱은 <html lang="ko"> — 한국어 기준 글꼴 줄 높이를 같게 쓴다
    rootEl.lang = 'ko';
    const body = document.createElement('div');
    body.className = 'app-body';
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    appRoot.appendChild(tpl.content.cloneNode(true));
    body.appendChild(appRoot);
    rootEl.appendChild(body);
    shadow.appendChild(rootEl);
    if (host.dataset.patch && PATCHES[host.dataset.patch]) PATCHES[host.dataset.patch](appRoot);
    if (host.dataset.pins) {
      for (const pin of JSON.parse(host.dataset.pins)) {
        const el = [...appRoot.querySelectorAll(pin.sel)].find((e) => !pin.has || e.textContent.includes(pin.has));
        if (el) el.setAttribute(pin.kind === 'new' ? 'data-new' : 'data-pin', String(pin.n));
        else console.warn('핀 대상 없음', name, pin);
      }
    }
    // 백그라운드 탭에서는 requestAnimationFrame이 멈추므로 바로 한 번, 폰트를 다 받은 뒤 한 번 더 맞춘다.
    const settle = () => {
      appRoot.querySelectorAll('[data-pin],[data-proposed],[data-new]').forEach(anchor);
      appRoot.querySelectorAll('[data-scroll-top]').forEach((el) => (el.scrollTop = Number(el.dataset.scrollTop)));
      appRoot.querySelectorAll('[data-scroll-left]').forEach((el) => (el.scrollLeft = Number(el.dataset.scrollLeft)));
      if (host.dataset.scrollTo) {
        const target = [...appRoot.querySelectorAll(host.dataset.scrollTo)].find((e) => !host.dataset.scrollHas || e.textContent.includes(host.dataset.scrollHas));
        const scroller = target && findScroller(target);
        if (scroller) {
          const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          scroller.scrollTop += delta - Number(host.dataset.scrollOffset || 12);
        }
      }
    };
    settle();
    document.fonts.ready.then(settle);
    // 목업이라 눌러도 아무 일도 일어나지 않게 한다(스크롤은 된다)
    shadow.addEventListener('click', (e) => e.preventDefault(), true);
    shadow.addEventListener('submit', (e) => e.preventDefault(), true);
    host._root = rootEl;
  }

  const phones = [...document.querySelectorAll('.phone[data-cap]')];
  phones.forEach(mount);

  // 좁은 화면에서는 폰을 비율대로 줄인다(375px 기준으로 그린 뒤 크기만 맞춘다).
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const host = entry.target;
      host.style.setProperty('--s', String(Math.min(1, host.clientWidth / 375)));
    }
  });
  phones.forEach((p) => ro.observe(p));
  phones.forEach((p) => p.style.setProperty('--s', String(Math.min(1, p.clientWidth / 375))));

  function sync() {
    phones.forEach((p) => {
      if (!p._root) return;
      p._root.dataset.theme = theme;
      p._root.classList.toggle('show-marks', marks);
    });
    document.querySelectorAll('[data-phone-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.phoneTheme === theme)));
    document.querySelectorAll('[data-phone-marks]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.phoneMarks === 'on') === marks)));
    try {
      localStorage.setItem('phoneTheme', theme);
      localStorage.setItem('phoneMarks', marks ? 'on' : 'off');
    } catch (e) {}
  }
  document.querySelectorAll('[data-phone-theme]').forEach((b) =>
    b.addEventListener('click', () => {
      theme = b.dataset.phoneTheme;
      sync();
    })
  );
  document.querySelectorAll('[data-phone-marks]').forEach((b) =>
    b.addEventListener('click', () => {
      marks = b.dataset.phoneMarks === 'on';
      sync();
    })
  );
  sync();
})();
