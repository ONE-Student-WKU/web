# 프로젝트 지침

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
- 원광대 인트라넷의 한국어 메뉴·버튼 이름은 영어 문구에서 한국어 원문을 남기고 괄호로 뜻을 붙인다(예: `전체성적조회 (Full Grade Inquiry)`).

### 확인
- `cd client && npm test`: `I18nContext.test.jsx`가 영어 사전에 빠진 키와 한국어에 없는 영어 키를 잡아낸다. 한국어를 코드에 직접 쓴 경우는 못 잡으므로 영어 모드에서 화면을 직접 확인한다.
- 새 언어를 추가할 때는 `locales/<code>.js`를 만들고 `I18nContext.jsx`의 `DICTIONARIES`와 `SUPPORTED_LANGUAGES`에 등록한 뒤, 위 완전성 테스트를 그 언어에도 적용한다.

## 약관·개인정보 동의

로그인 폼의 필수 동의 체크(`client/src/pages/Login.jsx`)와 로그인 직후 동의 화면(`ConsentGate.jsx`)은 이용약관·개인정보 수집·이용의 **버전**으로 동의를 받는다. 동의 시각과 버전은 `students.consented_at` / `consent_version`에 기록된다.

- 이용약관(`TermsOfService.jsx`)이나 개인정보처리방침(`PrivacyPolicy.jsx`)을 의미 있게 고치면(수집 항목, 위탁·해외 이전, 보관 기간, 이용 규칙 등) **`server/services/consent.js`의 `CURRENT_CONSENT_VERSION`과 `client/src/utils/consent.js`의 `CONSENT_VERSION`을 같은 값으로 올린다.** 서버는 두 값이 같을 때만 동의로 인정한다. 올리면 이미 동의한 계정도 다음 접속 때 동의 화면을 한 번 더 본다.
- 오탈자 수정처럼 의미가 바뀌지 않는 수정은 버전을 올리지 않는다.
- 새 로그인 수단을 추가하면 계정을 만들기 전에 서버에서 `isCurrentConsent`를 검사한다(`routes/auth.js` 참고).
