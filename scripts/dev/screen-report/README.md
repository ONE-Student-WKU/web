# 화면 비교 리포트 (실제 화면 캡처)

시안이나 브랜치 사이 화면 비교를 보여 줄 때 쓰는 도구다. 손으로 그린 목업은 위치·간격이 조금씩 달라 UI 피드백에 쓸 수 없었다(2026-10-28). 그래서 **로컬에서 띄운 앱의 실제 DOM**을 떠서, **그 브랜치의 `App.css`와 앱이 쓰는 Pretendard**로 375×812 폰 안에 다시 그린다. 폰은 리포트 스타일이 닿지 않는 Shadow DOM이다.

- 결과는 HTML 한 파일이라 Artifact로 게시한다. 폰 안은 스크롤되고 버튼은 반응하지 않는다.
- 같은 페이지 안에서 원본 CSS로 그린 같은 DOM과 요소마다 대조한다. 2026-10-28 기준 화면 52개 중 51개는 0px, 나머지 1개는 관리자 추이 차트의 SVG 막대 묶음만 1px 차이였다.
- 시안도 같은 방식으로 만든다. 가능하면 **먼저 구현하고 구현한 화면을 뜬다.** 구현 전에 보여 줘야 하면 develop 캡처를 기존 클래스로 고친 패치(`patches/*.js`)와 새 CSS 몇 줄(`proposal.scoped.css`)로 만든다. 이때 새 CSS는 App.css에 그대로 옮길 수 있는 형태로만 쓴다.

## 준비

작업 폴더는 저장소 밖에 둔다(기본: OS 임시 폴더/`wku-screen-report`, `SCREEN_REPORT_DIR`로 바꿈). 그 안에 다음을 둔다.

| 경로 | 내용 |
|---|---|
| `cap/` | 캡처(`<이름>.json`), 브랜치별 CSS(`<이름>.scoped.css` + 원본 `<이름>.App.css`) |
| `font/` | `Pretendard-{Regular,Medium,SemiBold,Bold,ExtraBold}.woff2` |
| `patches/` | (선택) 시안 패치 `<이름>.js` — 함수 본문, 인자 `root`는 폰 안의 `#root` |

**폰트 받기**: 앱이 `index.html`에서 쓰는 Pretendard v1.3.9 정적 파일이다.

```bash
for w in Regular Medium SemiBold Bold ExtraBold; do curl -sSL -o "$SCREEN_REPORT_DIR/font/Pretendard-$w.woff2" "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-$w.woff2"; done
```

Python `fontTools`(+`brotli`)가 있으면 build가 페이지에 쓰인 글자만 남겨 폰트를 줄인다. 없으면 원본을 넣는다(파일이 1MB에서 5MB대로 커질 뿐 화면은 같다).

## 순서

1. **앱 띄우기**: 로컬 DB에서 `npm run db:migrate`를 돌린다. 그다음 `.claude/launch.json`의 `server`·`client`·`dev-login`을 띄운다. 비교할 다른 브랜치는 `git worktree add ../wku-<이름>-preview <브랜치>`로 따로 꺼낸다. 그 폴더에는 **루트 `node_modules`만** junction으로 잇고, 그 클라이언트를 다른 포트(`node node_modules/vite/bin/vite.js ../wku-<이름>-preview/client --port 5174`)로 띄운다. 두 클라이언트가 같은 서버(3000)와 같은 로그인 쿠키를 쓴다.
2. **수신기**: `node scripts/dev/screen-report/capture-server.js` (127.0.0.1:3010).
3. **상태 만들기**: 로컬 테스트 계정(`dev-login`의 `/onboarded`·`/admin`)에 필요한 데이터를 넣는다. 로컬 DB(`DB_HOST`가 localhost)에만 넣고, 넣은 행은 끝나고 지운다. 실제 AI를 부르는 버튼(문의 AI 초안 등)은 누르지 않는다. AI 결과가 필요하면 저장 칸에 값을 직접 넣는다.
4. **캡처**: 브라우저 탭을 모바일(375×812)로 두고 화면을 띄운 뒤 콘솔에서 실행한다.
   ```js
   eval(await (await fetch('http://127.0.0.1:3010/cap.js')).text());
   await window.__cap('dev-home'); // 이름: 영문 소문자·숫자·-
   ```
5. **CSS 바꾸기**: 브랜치마다 한 번 실행한다. `git show origin/develop:client/src/App.css > develop.App.css` 후 `node scripts/dev/screen-report/scope-css.js develop.App.css "$SCREEN_REPORT_DIR/cap/develop.scoped.css"`. 작업 트리는 `client/src/App.css`를 그대로 넣는다.
6. **리포트 만들기**: `template.example.html`을 본떠 템플릿을 쓰고 `node scripts/dev/screen-report/build.js <템플릿> "$SCREEN_REPORT_DIR/report.html"`을 실행한다.
7. **검증**: `http://127.0.0.1:3010/report.local.html`을 모바일 탭에서 연 뒤 다음을 실행한다. 차이가 있으면 원인을 찾고, 남은 차이는 리포트에 적는다.
   ```js
   eval(await (await fetch('/verify.js')).text()); await window.__verify();
   ```
8. **게시**: `report.html`(`.local.html` 말고)을 Artifact로 게시한다.
9. **정리**: 테스트 데이터를 지운다. worktree는 **junction을 먼저 끊고**(`cmd /c rmdir ..\wku-<이름>-preview\node_modules`) 나서 `git worktree remove`를 실행한다. 연결을 둔 채 지우면 연결을 따라 들어가 프로젝트 `node_modules`를 지운다(2026-10-28에 실제로 지워져 `npm ci`로 복구했다). `.claude/launch.json`에 임시로 넣은 줄도 되돌린다.

## 맞추며 알게 된 것(어긋나면 먼저 볼 곳)

- 폰 루트는 `:host { all: initial }`로 리포트의 글꼴·줄 높이 상속을 끊는다. 또 `lang="ko"`를 단다. 앱은 `<html lang="ko">`라 한국어 기준 줄 높이로 그려지고, 이게 빠지면 글줄이 1px씩 낮다.
- 폰 안 스크롤 막대는 감춘다. 휴대폰은 겹쳐 뜨는 막대라 폭을 차지하지 않는데, 데스크톱 브라우저에서는 15px를 차지한다.
- 로컬에서 확인할 때는 doctype이 있는 `.local.html`을 연다. doctype이 없으면 호환 모드로 그려져 입력 칸 주변 줄 높이가 다르다.
- 캡처는 폰트를 다 받은 뒤에 뜬다(`cap.js`). 폰트가 덜 받아진 상태로 재면 기준값부터 틀린다.
- 탭이나 페이지를 따로 열어 잰 값끼리 비교하지 않는다. 화면 배율 반올림이 페이지마다 달라 1px씩 어긋날 수 있다. 그래서 `verify.js`는 한 페이지 안에서 비교한다.
- 앱 CSS에 모르는 미디어 조건이 새로 생기면 `scope-css.js`가 멈춘다. 375px에서 맞는지 정해 규칙을 더한다.
