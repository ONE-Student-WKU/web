// App.jsx의 테마 초기화 로직과 동일 — React가 첫 렌더링 후 useEffect에서 data-theme을
// 적용하면 그 사이(1프레임)에 CSS 기본값인 다크 테마 배경이 잠깐 그려지는 깜빡임이 생겨서,
// 마운트 전에 동기적으로 먼저 적용해둔다.
// index.html 안의 인라인 <script>로 두면 콘텐츠 보안 정책(CSP, client/vercel.json)에서 인라인 스크립트를 허용해야 해서
// (XSS가 생겼을 때 막아 주는 가장 중요한 장치가 꺼진다) 같은 출처의 별도 파일로 뺐다. async/defer 없이 <head>에서 읽어 동작은 같다.
(function () {
  try {
    var theme = localStorage.getItem('theme') || 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.fontSize = localStorage.getItem('fontSize') || 'medium';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.fontSize = 'medium';
  }
})();
