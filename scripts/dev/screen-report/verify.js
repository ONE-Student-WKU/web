// 브라우저에서 실행(빌드한 리포트의 .local.html을 capture-server.js로 연 탭에서): 리포트의 폰(Shadow DOM + 바꾼 CSS)을
// 같은 페이지의 375×812 iframe(원본 App.css로 그린 같은 DOM)과 요소마다 대조한다. 시안(data-patch) 폰은 대조하지 않는다.
// 같은 페이지 안에서 비교해야 한다 — 탭이나 페이지를 따로 열어 잰 값끼리는 화면 배율 반올림이 달라 1px씩 어긋날 수 있다.
// 휴대폰 배율로 맞추려면 탭을 모바일(375×812)로 둔다. 데스크톱 배율에서는 iframe 쪽에만 스크롤 막대(15px)가 생겨 폭이 다르게 나온다.
// 넣기: eval(await (await fetch('/verify.js')).text());  쓰기: await window.__verify()
window.__verify = async () => {
  const fontCss = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n').match(/@font-face\{[^}]*\}/g).join('\n');
  const cssText = {};
  const loadCss = async (b) => (cssText[b] ??= await (await fetch('cap/' + b + '.App.css')).text());
  const hosts = [...document.querySelectorAll('.phone[data-cap]')].filter((h) => !h.dataset.patch);
  const seen = new Set();
  const res = [];
  let ok = 0, n = 0;
  for (const h of hosts) {
    const name = h.dataset.cap;
    if (seen.has(name)) continue;
    seen.add(name);
    const tpl = document.getElementById('cap-' + name);
    const css = await loadCss(h.dataset.css);
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;left:-2000px;top:0;width:375px;height:812px;border:0';
    iframe.srcdoc = `<!doctype html><html lang="ko" data-theme="light" data-font-size="medium"><head><meta charset="utf-8"><style>${fontCss}\n${css}</style></head><body><div id="root">${tpl.innerHTML}</div></body></html>`;
    document.body.appendChild(iframe);
    await new Promise((r) => (iframe.onload = r));
    const idoc = iframe.contentDocument;
    await idoc.fonts.ready;
    await Promise.all(['400', '500', '600', '700', '800'].map((w) => idoc.fonts.load(w + ' 16px Pretendard', '가')));
    await new Promise((r) => setTimeout(r, 150));
    idoc.querySelectorAll('[data-scroll-top]').forEach((el) => (el.scrollTop = Number(el.dataset.scrollTop)));
    idoc.querySelectorAll('[data-scroll-left]').forEach((el) => (el.scrollLeft = Number(el.dataset.scrollLeft)));
    const ref = [...idoc.querySelectorAll('#root *')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(','); });
    const vp = h.querySelector('.phone-viewport');
    const sr = vp.shadowRoot;
    vp.style.transform = 'none';
    const saved = [];
    if (h.dataset.scrollTo) {
      sr.querySelectorAll('*').forEach((e) => e.scrollTop > 0 && saved.push([e, e.scrollTop]));
      saved.forEach(([e]) => (e.scrollTop = 0));
      sr.querySelectorAll('[data-scroll-top]').forEach((e) => (e.scrollTop = Number(e.dataset.scrollTop)));
    }
    const base = vp.getBoundingClientRect();
    const els = [...sr.querySelectorAll('#root *')];
    let diff = 0, first = '';
    els.forEach((e, i) => {
      if (e.tagName === 'OPTION' || e.tagName === 'OPTGROUP') return;
      n++;
      const r = e.getBoundingClientRect();
      const v = [r.left - base.left, r.top - base.top, r.width, r.height].map(Math.round).join(',');
      if (v !== ref[i]) { diff++; if (!first) first = i + ':' + e.tagName + '.' + String(e.className.baseVal ?? e.className).split(' ')[0] + ' got ' + v + ' want ' + ref[i]; }
    });
    saved.forEach(([e, t]) => (e.scrollTop = t));
    vp.style.transform = '';
    iframe.remove();
    if (!diff) ok++; else res.push(name + ' diff=' + diff + '/' + els.length + ' first ' + first);
  }
  return ok + '/' + seen.size + ' screens exact, elements ' + n + '\n' + res.join('\n');
};
'verify ready';
