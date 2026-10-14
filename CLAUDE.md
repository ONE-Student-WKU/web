# 프로젝트 지침

## 배포·DB 재시딩 (먼저 읽을 것)

규정·교육과정 문서(`db/regulations/**` 등)를 운영 챗봇에 반영하는 길은 코드 배포와 **따로** 있다. 자세한 내용과 확인하지 못한 항목은 [docs/deployment.md](docs/deployment.md).

- **운영 서버에서 `seed` 명령을 직접 실행하라고 안내하지 않는다.** `main`에 `db/regulations/**`, `db/curriculum/**`, `db/seed/*.json`(일부) 변경이 push되면 `.github/workflows/db-reseed.yml`이 자동으로 시작되고, Actions 탭에서 `db-reseed` 환경을 **승인**하면 Railway Cron Job이 재시딩한다. 승인자 목록은 GitHub 환경 설정(Settings → Environments → `db-reseed`)에서 확인한다. 승인자에 포함된 BE 담당자는 운영 담당자에게 따로 요청할 필요가 없다.
- 반영 시점은 `develop` 머지가 아니라 **`main` 반영**이다. `db-reseed` 환경은 `main` 브랜치만 허용한다.
- 재시딩은 `seed:regulations -- --force`라서 **새 문서 하나만 추가하는 게 아니라 규정 문서 전체를 다시 임베딩**한다(Voyage 비용·시간, 실행 중 일부 문서가 잠깐 검색에서 빈다).
- Railway Cron Job의 Start Command에 `npm run seed --workspace=server`(`seed.js` 전체)를 **절대 넣지 않는다.** 가짜 학생 계정이 운영 DB에 들어간다.
- 새 파일을 `db/` 아래 새 경로에 추가하면 `db-reseed.yml`의 `paths:` 필터에 걸리는지 확인한다(PR의 `DB Reseed Guard`가 경고).

## 교육과정 적용 원칙 — 최신 책자가 모든 학번에 적용된다

원광대는 다른 대학과 달리 **교육과정이 개편되면 그 전 학번에게도 최신 교육과정이 적용**되고, 학번별로 달라지는 부분(졸업학점·교양·전공 학점)은 **최신 책자에 실린 학번별 이수기준표(경과조치)**로 정한다(2026 책자 15쪽 경과조치 가, 교육혁신과 면담 2026-10-12). 그래서 "2019학번이면 2019학년도 책자"가 아니다 — 2019학번의 지금 기준은 2026 책자의 2019~2021학번 표다. 자세한 설명은 [docs/regulation-engine/LATEST_CURRICULUM_2026-10-12.md](docs/regulation-engine/LATEST_CURRICULUM_2026-10-12.md).

- `db/seed/curriculum_requirements.json`의 2025학번 이하 일반 요건 행(교양·일반선택·전공·졸업인증제)은 `db/curriculum/_source/2026_학번별_이수기준.json`(2026 책자 학번별 표)로 정렬돼 있다. **옛 학년도 책자를 보고 이 값을 "원래대로" 고치지 않는다.** 옛 책자의 숫자는 그때 기준(이력)이다.
- 시드를 손으로 고치지 말고 표 JSON을 고친 뒤 `node scripts/audit/applyLatestBookletCohortTables.js --apply`를 돌린다. `server/test/graduation.audit.test.js`가 시드와 표가 어긋나면 실패한다.
- 새 학년도 책자가 들어오면: 그 책자의 학번별 표를 JSON·`db/regulations/교육과정/YYYY_학번별_이수기준표.md`로 옮기고, `server/services/regulationEngine/constants.js`의 `LATEST_BOOKLET_YEAR`를 올리고, 스크립트를 다시 돌린다.
- 예외: 통폐합·학부 분리로 재학생이 남은 학과는 과목 편성을 구 교육과정으로 운영할 수 있다(경과조치 가 단서). 학점 기준(학번별 표)은 그래도 적용된다. 엔진은 2026 책자에 학과 행이 없는 학과에 `DEPARTMENT_ABSENT_IN_LATEST_BOOKLET`(INFO)을 붙인다.
- 과목 목록도 같다: 앞으로 들을 과목(진로 로드맵, 챗봇의 "내 학번 기준" 과목 질문)은 입학한 해가 아니라 학과·세부전공의 **가장 최근 편성**(`curriculumService.resolveCourseListYear`)에서 고른다. 통폐합 학과는 그 학과의 마지막 편성이다(같은 이름의 전공이 새 계열에 있으면 학적 기준 — 아래 학교 답변 A-3). 특정 학년도·이력 질문과 이수구분 판정(수강신청 당시 기준)은 학번별 편성을 그대로 쓴다(DECISIONS D-56).

## 학교 답변으로 정해진 기준 (교육혁신과 2026-10-14)

이슈 #332 문의에 교육혁신과가 서면으로 답했다. 항목별 원문·해석·반영은 [docs/school-inquiry/교육혁신과_답변_2026-10-14.md](docs/school-inquiry/교육혁신과_답변_2026-10-14.md). B(졸업사정)는 학사지원과 담당이라 교육혁신과가 학사지원과에 대신 문의해 주기로 했다 — 따로 보내지 않고 그 답을 기다린다.

학교에는 앞으로도 문의를 보내고, 답변이 오면 같은 방식으로 넣는다: `docs/school-inquiry/<부서>_답변_YYYY-MM-DD.md`에 항목 ID별로 답변(원문 그대로)·해석·반영을 나눠 적고, 확정된 기준은 이 절에 한 줄씩 추가한다. 답이 없거나 모호한 항목은 다음 문의 후보로 남긴다.

- 위 "교육과정 적용 원칙"(학번별 표, 앞으로 들을 과목은 최신 편성, 이수구분은 수강 당시)은 학교가 맞다고 확인했다(A-1).
- **책자와 웹정보서비스 조회시스템이 다르면 조회시스템이 기준이다**(C-1, A-6). 책자는 학년도 초 기준이고 조회는 실시간이다. 학기 중 변경은 웹정보서비스 → 정보서비스 → 교육과정조회 → 교육과정조회(학과별)에서 확인한다(A-7).
- 2026 책자에 같은 이름의 전공이 있는 통폐합 학과(28곳)의 과목 편성은 **학생의 학적에 적힌 이름**(구 학과 / 새 계열 전공)을 따른다. 같은 이름의 전공이 없는 37곳은 그 학과의 마지막 편성이 맞다(A-3).
- **학교 사이트(통합규정관리시스템·웹정보서비스 등)에 자동으로 접근하는 코드를 만들거나 실행하지 않는다**(C-4, 현재 불허). 사람이 조회해 저장한다. `server/scripts/scrapeTimetable.js`도 실행하지 않는다.
- 학과 내규를 따르는 학과(건축학과, 의학 계열)의 숫자는 교육혁신과도 바로 알 수 없다. 해당 학과에 확인해야 한다(A-5).

## 화면 언어(i18n)

화면에 보이는 문구는 한국어를 코드에 직접 쓰지 않고 번역 사전을 거친다. 언어는 설정 화면과 로그인 화면 헤더에서 바꾸며, 현재 지원 언어는 한국어(`ko`, 기준)와 영어(`en`)다. 당분간은 영어만 진행하고, 일본어와 중국어(간체/번체 미정)는 급하지 않아 보류 중이다. 나중에 추가할 때도 같은 방식을 쓴다.

선택한 언어는 브라우저(`localStorage`의 `language`)와 계정(`students.language`)에 저장된다. 로그인 직후 App.jsx가 "로그인 화면에서 방금 고른 언어 → 계정 값 → 브라우저 값" 순서로 따른다. 챗봇 답변 언어는 요청마다 현재 화면 언어를 `language`로 보내고, 서버(`routes/chat.js`)가 허용 목록(`ko`/`en`)으로 검증한다. 새 언어를 지원하면 `studentService.VALID_LANGUAGES`와 `aiClient.js`의 답변 언어 지시도 같이 추가한다.

### 문구를 추가하거나 고칠 때
- 사전은 `client/src/i18n/locales/ko.js`(원문, 기준)와 `en.js`다. **키는 두 파일에 같이 추가하고, 문구를 고칠 때도 두 파일을 같이 고친다.**
- 컴포넌트에서는 `const { t } = useI18n();`(`client/src/i18n/I18nContext.jsx`)로 가져와 `t('화면.항목')`을 쓴다. 값 안의 `{name}`은 `t(key, { name })`으로 치환된다.
- 문장 중간에 굵은 글씨가 끼면 사전에 `<b>강조</b>`로 쓰고 `tRich(key)`로 렌더한다. 문장을 쪼개 `<strong>`을 직접 끼우지 않는다(언어마다 어순이 다르다).
- 키 이름은 `화면.항목` 형태(`home.greeting`, `courses.err.load`)로 짓는다.
- 컴포넌트 밖의 순수 함수에서는 `translate(lang, key, params)`를 쓰거나 `t`를 인자로 받는다(`utils/graduation.js` 참고).
- 이펙트처럼 번역 함수에 의존시키고 싶지 않은 곳은 문구 대신 사전 키를 상태에 담고 렌더에서 번역한다(`GraduationStatus.jsx`의 `error`).
- 번역이 없는 키는 한국어로 폴백되므로 화면이 깨지지는 않는다. 그래도 영어 모드에서 한국어가 남지 않게 한다.

### 번역하지 않는 것
- 서버·DB가 내려주는 데이터(학과명, 과목명, 챗봇 답변, 요건 설명, 서버가 만든 사유 문장)는 화면에서 번역하지 않는다.
- 서버와 주고받는 값은 한국어 그대로 둔다(예: 이수구분 `전공필수`, 요일 `월`). 표시할 때만 `translateCategory()`나 `courses.day.*` 같은 사전으로 바꾼다.
- 커뮤니티의 글 제목·본문, 신청 메시지, 닉네임, 신고·반려·제재·처리 사유처럼 사람이 쓴 글은 번역하지 않고 쓴 그대로 보여준다(화면 문구만 번역). 문구 사이에 이런 값을 끼울 때는 `tRich`의 `{값}` 자리에 넣는다 — 템플릿의 `<b>`만 굵게 해석하고 값에 들어 있는 `<b>`는 글자 그대로 둔다.
- 진로 탐색의 고정 질문·답변(`CareerExploration.jsx`의 `FIXED_QUESTIONS`)처럼 서버에 저장되고 AI 컨텍스트로 쓰이는 문구는 화면 언어와 무관하게 한국어 원문 그대로 보내고(`SKIPPED_ANSWER` 포함), 화면에는 사전(`career.q.N.*`)의 번역만 보여준다. 이 배열의 순서나 개수를 바꾸면 사전도 같이 바꾼다.
- 챗봇·진로 탐색 AI 답변 언어는 요청마다 `language`를 보내고 서버가 `services/language.js`의 `parseLanguage`로 검증한다. 영어일 때만 프롬프트에 답변 언어 지시를 덧붙이며, 진로 로드맵의 `courseName`은 교육과정 목록과 글자 그대로 대조하므로 번역하지 않게 한다(`aiClient.js`).
- 원광대 인트라넷의 한국어 메뉴·버튼 이름은 영어 문구에서 한국어 원문을 남기고 괄호로 뜻을 붙인다(예: `전체성적조회 (Full Grade Inquiry)`).

### 확인
- `cd client && npm test`: `I18nContext.test.jsx`가 영어 사전에 빠진 키와 한국어에 없는 영어 키를 잡아낸다. 한국어를 코드에 직접 쓴 경우는 못 잡으므로 영어 모드에서 화면을 직접 확인한다.
- 새 언어를 추가할 때는 `locales/<code>.js`를 만들고 `I18nContext.jsx`의 `DICTIONARIES`와 `SUPPORTED_LANGUAGES`에 등록한 뒤, 위 완전성 테스트를 그 언어에도 적용한다.

## 약관·개인정보 동의

로그인 폼의 필수 동의 체크(`client/src/pages/Login.jsx`)와 로그인 직후 동의 화면(`ConsentGate.jsx`)은 이용약관·개인정보 수집·이용의 **버전**으로 동의를 받는다. 동의 시각과 버전은 `students.consented_at` / `consent_version`에 기록된다.

- 이용약관(`TermsOfService.jsx`)이나 개인정보처리방침(`PrivacyPolicy.jsx`)을 의미 있게 고치면(수집 항목, 위탁·해외 이전, 보관 기간, 이용 규칙 등) **`server/services/consent.js`의 `CURRENT_CONSENT_VERSION`과 `client/src/utils/consent.js`의 `CONSENT_VERSION`을 같은 값으로 올린다.** 서버는 두 값이 같을 때만 동의로 인정한다. 올리면 이미 동의한 계정도 다음 접속 때 동의 화면을 한 번 더 본다.
- 오탈자 수정처럼 의미가 바뀌지 않는 수정은 버전을 올리지 않는다.
- 새 로그인 수단을 추가하면 계정을 만들기 전에 서버에서 `isCurrentConsent`를 검사한다(`routes/auth.js` 참고).
