// 브라우저에서 실행: 지금 화면의 #root DOM을 떠서 수신기(capture-server.js)에 보낸다.
// 넣기: eval(await (await fetch('http://127.0.0.1:3010/cap.js')).text());  쓰기: await window.__cap('dev-home')
// 입력값·체크·선택·스크롤 위치를 속성으로 옮겨 적고, 폰트를 다 받은 뒤 뜬다(덜 받은 상태로 뜨면 글줄 높이가 1px씩 다르다).
window.__cap = async (name) => {
  await Promise.all(['400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 16px Pretendard`, '가나다ABC123')));
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 300));
  const src = document.getElementById('root');
  const clone = src.cloneNode(true);
  const s = src.querySelectorAll('*');
  const d = clone.querySelectorAll('*');
  s.forEach((el, i) => {
    const c = d[i];
    if (el.scrollTop > 0) c.setAttribute('data-scroll-top', String(Math.round(el.scrollTop)));
    if (el.scrollLeft > 0) c.setAttribute('data-scroll-left', String(Math.round(el.scrollLeft)));
    if (el.tagName === 'TEXTAREA') c.textContent = el.value;
    else if (el.tagName === 'SELECT') [...c.options].forEach((o, j) => (el.options[j].selected ? o.setAttribute('selected', '') : o.removeAttribute('selected')));
    else if (el.tagName === 'INPUT') {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked ? c.setAttribute('checked', '') : c.removeAttribute('checked');
      else c.setAttribute('value', el.value);
    }
  });
  for (const img of clone.querySelectorAll('img')) {
    try {
      const b = await (await fetch(img.src)).blob();
      img.src = await new Promise((r) => {
        const f = new FileReader();
        f.onload = () => r(f.result);
        f.readAsDataURL(b);
      });
    } catch {
      // 못 읽은 이미지는 그대로 둔다
    }
  }
  clone.querySelectorAll('script').forEach((x) => x.remove());
  // 검색 화면의 들어오는 애니메이션은 리포트에서 다시 재생되지 않게 뗀다.
  const html = clone.innerHTML.replace(/ search-screen--enter/g, '');
  const de = document.documentElement;
  const payload = { name, url: location.href, theme: de.dataset.theme, fontSize: de.dataset.fontSize, w: innerWidth, h: innerHeight, html };
  const r = await fetch(`http://127.0.0.1:3010/?name=${name}`, { method: 'POST', body: JSON.stringify(payload) });
  return r.text();
};
// 인쇄 전용 시트(화면에서는 display:none, 인쇄할 때만 찍힘)를 뜬다. #root 밖(body 바로 아래)에 붙는 시트라 __cap으로는 안 잡힌다.
// 먼저 window.print = () => {} 로 인쇄 창을 막고 앱의 "PDF로 저장" 버튼을 눌러 시트가 DOM에 붙은 뒤 부른다.
// 리포트에서는 <div class="paper" data-cap="이름" data-pcss="브랜치"> 자리에 print-css.js로 만든 CSS와 함께 종이로 그린다.
window.__capPrint = async (name, selector = '.grad-print-sheet') => {
  await Promise.all(['400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 16px Pretendard`, '가나다ABC123')));
  await document.fonts.ready;
  const sheet = document.querySelector(selector);
  if (!sheet) throw new Error(`인쇄 시트가 없어요: ${selector} — 인쇄 버튼을 먼저 누르세요`);
  const payload = { name, url: location.href, theme: 'light', html: sheet.outerHTML };
  const r = await fetch(`http://127.0.0.1:3010/?name=${name}`, { method: 'POST', body: JSON.stringify(payload) });
  return r.text();
};
'cap ready';
