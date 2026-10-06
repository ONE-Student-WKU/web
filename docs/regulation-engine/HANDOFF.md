# HANDOFF — 다음 파트가 알아야 할 것

## P4. 학교 홈페이지 확인 반영 (2026-10-06, 브랜치 `feature/school-site-verified-facts`) · 가장 먼저 읽을 것

Claude in Chrome으로 학교 홈페이지(wku.ac.kr)·조회시스템(intra.wku.ac.kr)을 직접 확인한 결과를 엔진·데이터에 반영했다. 확인 내용 전체와 근거 링크는 [`docs/school-inquiry/확인결과_문의제외.md`](../school-inquiry/확인결과_문의제외.md), 학교에 보낼 문의문은 [`학교문의_발송용.md`](../school-inquiry/학교문의_발송용.md). 홈페이지 원문 보관본은 `docs/school-inquiry/근거_학교홈페이지/`(엔진 근거 레지스트리 `SITE_*`가 이 파일을 인용하고, 근거 무결성 테스트가 문장을 검사한다).

| 결정 | 내용 | 동작이 바뀐 곳 |
|---|---|---|
| D-51 | 2021학번 이하 교양 인정 상한 **없음** 확정(홈페이지 "2022년 3월 1일 입학자부터 52학점"+책자). 진단도 따름 | 교양 52학점 넘게 이수한 2021학번 이하 학생의 인정 학점·신뢰도 |
| D-52 | 교양 29학점 컷오프는 **전과 시점** 기준으로 확정(홈페이지 "2022-1학기 전과생까지") | 컷오프 이전 전과생의 교양 판단 신뢰도 추정→확정 |
| D-53 | 약학과(6년제) 2022학번 졸업학점 **232**(전공 207)로 정정, 책자 인쇄 240은 오기로 봄 | 2022학번 약학과 총 요구학점 240→232 |
| D-54 | 학과 개편 이력 4건 확정(DOC) + 응용수학부→빅데이터·금융통계학부 통합 간선 추가 | 무역·화학·생명환경·인공지능융합 학번의 `LINEAGE_NAME_MATCH` 표시 |

### P4-1. 운영 반영 (승인 필요 — 이번 파트에서 하지 않음)
1. PR 머지 후 재시딩 크론이 `seed:reference-data`(약학과 2022 요건)와 `seed:lineage` → `generate:curriculum-changes`(개편 이력)를 돌리는지 확인한다. `db/seed/department_lineage.json`은 `db-reseed.yml` 경로 필터에 없을 수 있다(`scripts/ci/check-db-reseed-paths.js`는 "새로 추가된" 파일만 검사).
2. 코드 변경(교양 상한·컷오프)은 배포만으로 반영된다(DB 변경 없음).

### P4-2. 아래 P3-4 문의 목록(15개)의 현재 상태
| # | 상태 | 비고 |
|---|---|---|
| 1 엑셀 export | 문의 유지 | 발송용 문의 1-1 |
| 2·3 판단 보류(총괄표 숫자) | 문의 유지 | 발송용 문의 5(○/정정값 표). **웹으로는 확인 불가** |
| 4 학수번호 도구 vs 책자 | 문의 유지(기준 질문) | 발송용 문의 2. 정산사상1은 책자 3해 일관 3학점이라 데이터 변경 안 함 |
| 5·6·7 경과조치 해석 | 문의 유지 | 발송용 문의 4-1~4-3. 시행규칙 원문만으로 결정 불가 |
| 8 총량표 적용 | 문의 4-4로 흡수 | |
| 9 개편 학과 재학생 | **일부 해결** — 동일과목 조회 화면 존재(`course_equivalences` 원천), 기존 교육과정 유지 기간은 문의 4-4 | |
| 10 교양 29학점 기준 | **해결(D-52)** | 전과 시점 |
| 11 소속변경 | **해결** — 폐지·통합 학과 재학생만 하는 별도 제도, 미신청 시 옛 소속 졸업 가능, −6/−12/−18은 책자 해설에 있음 | 소속변경 입학유형 추가는 미구현 |
| 12 52학점 상한 | **일부 해결(D-51)** — 일반 재학생은 2022학번부터. 편입생 적용만 문의 7 | |
| 13 편입생 | **일부 해결** — 편입한 학년의 당초 입학자와 동일 이수, 졸업이수학점은 대학별 기준(홈페이지 편입생 교육과정). `TRANSFER_COHORT_YEAR_UNVERIFIED`·`TRANSFER_TOTAL_UNRESOLVED`는 **아직 풀지 않음**(온보딩의 편입생 학번 입력 의미를 화면에서 확인한 뒤 풀 것) | |
| 14 구버전 학칙 | 문의 유지 | 발송용 문의 1-3 |
| 15 2027 개편 | 문의 유지 | 발송용 문의 1-4 |


마지막 갱신: **파트 3/3 종료 (2026-10-05, 브랜치 `feature/regulation-engine-integration`)** — 아래 P3절부터 읽을 것 · 이전: 파트 2(PR #277, 미머지), 파트 1·데이터 검수(develop 머지 완료 #274·#275·#276)

> 다음 파트는 **이 브랜치 위에서** 이어서 작업한다(Part 1 PR이 develop에 머지되기 전이라면). 먼저 [DESIGN.md](DESIGN.md) → [DECISIONS.md](DECISIONS.md) → [RULE_AUDIT.md](RULE_AUDIT.md) 순으로 읽을 것.

## P3. 파트 3/3 종료 — 챗봇·졸업진단 연결, 평가 세트 (2026-10-05) · 가장 먼저 읽을 것

브랜치 `feature/regulation-engine-integration`. 파트 2 브랜치(`feature/regulation-engine-rules`, PR #277 미머지) 위에 쌓았다 → **#277이 develop에 머지되면 이 PR의 base를 develop으로 바꾼다.**

| 커밋 | 내용 | 결정 |
|---|---|---|
| `221ba45` | 챗봇: RAG 전에 규정 판단 → 최우선 근거 청크(신뢰도·답변 지침·조문 원문), 근거 우선순위, 중복 조문 제거. 엔진 가드(적용범위 0행 = 자료없음) | D-31 |
| `eb228ed` `16714fc` | 졸업진단: 요건·교양 상한을 엔진 결과로, 하드코딩 분기 제거, 응답에 `regulation` 추가. 9,828개 조합 전후 비교 | D-32 |
| `3e479d1` | 평가 세트 30개 + 평가 세트가 찾은 챗봇 단정 문제 수정 | D-33 |

### P3-1. 동작이 바뀐 기존 기능 (요약 — 상세 표는 DECISIONS D-31·D-32)
1. **졸업진단 총 요구학점**: 1·2학년 전과 + 전과 시점 2022-2학기 이전 → 같은 학번 일반 재학생 총량으로(예: 컴소공 2021 142→136). 학과에 따라 늘거나 준다(조합 317개: 증가 168, 감소 149).
2. **졸업진단 자료 없는 학과·학번**: 다른 범위의 행(졸업인증제·전공 48)만 보이던 것 → 요건 0개 + `regulation.confidence = NO_DATA`(조합 1,313개, 대부분 온보딩에서 고를 수 없는 조합).
3. **졸업진단 응답**: `regulation` 필드 추가(기존 필드는 그대로).
4. **챗봇 근거 순서·내용**: 규정 질문이면 근거 맨 앞에 "○○학과 20XX학번 적용 규정 판단 (신뢰도: …)" 청크와 조문 원문 청크가 들어가고, RAG가 같은 조문을 또 가져오면 뺀다. 시스템 프롬프트에 근거 우선순위·진단 신뢰도 문구가 추가됐다.
5. **챗봇 응답 저장**: `citedChunkIds`에 판단 청크 id(문자열)가 함께 저장된다. 다음 턴의 `findChunksByIds`는 숫자 id만 찾으므로 판단 청크는 이어받지 않고 매 턴 새로 계산한다(기존 `graduation-…` 청크와 같은 동작).

### P3-2. 클라이언트 확인 지점 (코드 변경 없음 — 화면에서 직접 확인할 것)
| 화면 | 확인할 것 | 이유 |
|---|---|---|
| 챗봇 `ChatBubble` 출처 목록 | 출처 맨 앞에 "적용 규정 판단 (신뢰도: …)" 제목과 판단 요약 앞 150자가 보인다. 출처가 길어 보이는지, 신뢰도 문구가 학생에게 자연스러운지 | `citedChunks`가 근거 청크 전체를 내려준다(routes/chat.js) |
| 챗봇 답변 | 신뢰도가 확정이 아닌 학생(예: 컴소공 2017~2022학번, 사범대 2024학번)에게 "추정/확인 필요"와 학사지원과 안내가 실제로 나오는지 | 테스트는 근거·지시까지만 검증(AI 호출 없음, D-33) |
| 졸업요건 `GraduationStatus.jsx`·`Home.jsx` | 1·2학년 전과(2022-1학기 이전) 학생의 총 요구학점 변화. 자료 없는 조합에서 `totalRequiredCredits = 0`이면 진행률이 `0/0`(NaN) — **예전에도 같은 경로가 있었고** 이번에 새로 생긴 건 아님 | D-32 #1·#2 |
| 졸업요건 화면(제안) | `regulation.confidenceLabel` 배지와 `flags[].message` 표시, 편입생은 `totalDefinitive=false`일 때 "총학점 확정 아님" 표시 | 지금은 서버만 내려주고 화면은 안 쓴다 |

### P3-3. 운영 반영 순서 (승인 필요 — 이번 파트에서 하지 않음)
1. PR #277 → develop 머지 → 이 PR base를 develop으로 변경 → 머지.
2. 운영 DB에 `db/migrate.js`(새 테이블 6개) → `npm run seed:regulation-articles --workspace server`. **2를 빼고 배포하면** 챗봇 판단 청크가 "적용범위 자료 없음(자료없음)"으로 나가고(가드, R-16) 졸업진단은 영향 없다(요건은 기존 테이블).
3. Railway 재시딩 크론 Start Command에 `seed:regulation-articles` 추가 여부 결정(원문 txt가 바뀔 때만 필요).

### P3-4. 학사지원과 문의 목록 (전체 프로젝트, 한곳에 모음)
RULE_AUDIT D절, DATA_AUDIT §8, HANDOFF P2-3을 합쳤다. 답을 받으면 바꿀 곳을 같이 적었다.

| # | 분류 | 질문 | 답을 받으면 |
|---|---|---|---|
| 1 | 교육과정 원본 | 학년도별 교육과정(학과·학년·학기·구분·학수번호·과목명·학점)과 총괄표의 **엑셀/DB export**를 받을 수 있는가? 특히 2017·2018·2020 스캔본 | DATA_AUDIT §4 등급 상향 → `dataQuality.js` |
| 2 | 판단 보류 | 2024 사범대 10개 학과 자유선택 32인가 34인가(N-6) — 변경 이력 "교양 39→37"이 진짜 개정인가 | 시드 정정 또는 보류 해제(평가 세트 E14) |
| 3 | 판단 보류 | 2018·2019 수학교육과 일반선택 42/44, 2020·2021 패션디자인산업학과 35/32, 2021 SW융합학과 구조, 2025·2026 중등특수교육과, 2026 의생명공학·그린바이오·스마트농업·푸드테크·디자인융합·창의문화융합·국방기술·보건의료 7개 학과·한의학과 교양(이슈 #260) | 같음(E10~E17) |
| 4 | 판단 보류 | 2022 탄소융합공학과 376046 창업현장실습·376044 소자/소재(N-1), 학수번호 도구 기준 vs 책자(N-3·N-4) — 성적 시스템은 어느 쪽을 쓰는가 | 과목 자료 정정(E18) |
| 5 | 경과조치 해석 | 시행규칙 제13조③ "재학 중인 학년" = 개편 시점 학년인가 기준일(현재) 학년인가 | `policy.transitionGradeBasis` 기본값(E23) |
| 6 | 경과조치 해석 | 입학 후 새로 생긴 필수과목은 재학생도 이수해야 하는가 | `ELECTIVE_BECAME_REQUIRED` 해석기 |
| 7 | 경과조치 해석 | 전공기초·전공심화·전공응용(광역계열)은 제13조의 필수/선택 중 무엇인가 | `REQUIRED_CATEGORIES`/`ELECTIVE_CATEGORIES` |
| 8 | 경과조치 해석 | 교육과정 개편 시 학번별 총량표가 재학생에게 공식 적용 방식인가(제13조①과의 관계) | RULE_AUDIT A-2 |
| 9 | 경과조치 해석 | 개편 학과(컴소공 → 공학3계열 등) 재학생에게 기존 교육과정을 몇 년 유지하는가, 동일과목 지정 목록이 있는가(제14·15조) | `course_equivalences` 입력(E25) |
| 10 | 전과 | 교양 29학점 고정의 기준 = 학생의 전과 시점인가 학과의 학사구조조정 시점인가, 2022-2 이전 실제 사례(D-1) | `policy.liberalArtsCutoffTrigger`(E20) |
| 11 | 전과 | 개편 학과 학생이 옮기는 건 전과인가 소속변경인가, 소속변경 −6/−12/−18 규칙(D-2) | 입학유형 추가(미구현) |
| 12 | 교양 상한 | 2021학번 이하 교양 52학점 상한 적용 여부, 편입생 적용 여부(D-3) | 진단은 지금 52(보수적, E24) |
| 13 | 편입 | 편입생이 따르는 학번(편입 연도 vs 편입 학년 당초 입학자), 학과별 총 졸업학점(D-4) | `totalDefinitive`(E22) |
| 14 | 구버전 학칙 | 종전 2025.08.29.자 학칙 부칙, 2026 이전 판본 학칙·시행규칙, **개정 전 학칙 [별표 4]**(2026년 8월 이전 졸업자용) 사본 | `regulation_versions` 행 추가, 기준일 판단 "추정"→"확정"(E04) |
| 15 | 2027 개편 | 2027학번 학과·계열 개편(AI공학계열 등) 졸업요건 자료 시기 | 새 학번 시드(E27) |

## P2. 파트 2/3 종료 (2026-10-05, 규정 판단 엔진: 충돌 제거·스키마·시드·판단 함수) — 가장 먼저 읽을 것

브랜치 `feature/regulation-engine-rules`(develop d709532 기준). 커밋 순서 = 작업 순서:

| 커밋 | 내용 | 결정 |
|---|---|---|
| `b28920a` | 챗봇 컨텍스트의 "이후 변경은 이 학번에 적용되지 않는다" 단정 → 경과조치 조건부 + 시행규칙 제5·13·118조 인용(`curriculumContextService.LATER_CHANGE_NOTICE`, aiClient 시스템 프롬프트) | — |
| `a9db341` | 신규 테이블 6개(`regulation_versions/articles/applicability/relations`, `course_equivalences`, `course_category_overrides`) | D-24, D-25 |
| `c03d5a2` | 조문 파서·시드(`articleParser.js`, `regulationSeed.js`, `npm run seed:regulation-articles`), 적용범위 원천 `db/regulation-engine/applicability.json` | D-26 |
| `7d40e07` | 순수 판단 함수 `resolveApplicableRules` + DB 로더 + 데이터 등급(`dataQuality.js`, 신뢰도 `INSUFFICIENT`) | D-27~D-29 |
| `e6e680a` | `yearContext`에 기준일(`asOfDate/asOfSource/asOfTerm`) | D-30 |

**챗봇·졸업진단에는 아직 연결하지 않았다**(파트 3 범위). 기존 동작이 바뀐 곳은 첫 커밋(문구)뿐이다.

### P2-1. 파트 3가 쓸 인터페이스

```js
const { resolveApplicableRulesForStudent, inputFromStudentRow } = require('../services/regulationEngine');
const { resolveYearContext } = require('../services/yearContext');

const yc = resolveYearContext({ message, previousUserMessage, profileCohort, availableBookYears });
const result = await resolveApplicableRulesForStudent({
  ...inputFromStudentRow(student),          // admissionYear, enrollmentType, departmentId, trackId, majorChange
  asOfDate: yc.asOfDate,                     // 생략하면 오늘(KST)
  policy: { transitionGradeBasis: 'AT_REVISION' }, // 제13조③ 해석. 'AT_AS_OF'도 가능(D-28)
}, { withRequirements: true });              // false면 파트 1 졸업요건 계산 생략(빠름)
```

- 테스트·배치에서는 순수 함수 `require('../services/regulationEngine/applicability').resolveApplicableRules(input, data)`를 쓰고 `data`는 `dbProvider.loadApplicabilityData(ctx)` 모양(파일 머리 주석)으로 만든다.
- 입력 오류도 예외 없이 `{ confidence: 'NO_DATA', flags: [INVALID_INPUT] }`로 온다.

**결과 형태**

| 필드 | 뜻 | 파트 3 사용법 |
|---|---|---|
| `confidence` / `confidenceLabel` | 전체 신뢰도: `CONFIRMED` 확정 · `ESTIMATED` 추정 · `INSUFFICIENT` 자료 불충분(확인 필요) · `NO_DATA` 자료없음 | 답변 톤 결정. 확정 외에는 단정 금지 + `flags[].message`로 사유, INSUFFICIENT·NO_DATA는 학과/학사지원과(063-850-5228) 안내 |
| `rules[]` | 적용범위 규칙별 판단: `ruleCode`, `scope`(COHORT_ONLY/ALL_ENROLLED/TRANSITIONAL), `status`(APPLIES/NOT_APPLICABLE/CONDITIONAL/UNKNOWN), `reason`, `effect`, `basis.articleRef`·`paragraph`·`versionLabel`·`lastAmendedOn`, `details`, `alternatives`, `flags`, `critical` | `status !== 'NOT_APPLICABLE'`만 보여준다. 근거 인용은 `basis.articleRef`로 `regulation_articles.body`를 조회해 원문 그대로 |
| `rules[].details` (제13조②③④) | `exempt[]`/`unclassified[]`/`courses[]`/`newRequired[]` — 과목별 `courseName`, `toYear`, `exempt`(true/false/null), `confidence`, `flags`, ③은 `alternatives`(다른 해석의 결과) | 수백 개일 수 있다 → 요약(개수)만 기본으로, 특정 과목 질문일 때 해당 항목만. `exempt: null`은 "모름"이지 "아니오"가 아님 |
| `history.years[]` | 입학 후 학년도별 `{ requirements, courses }: { count, status, label }` | **`label`을 그대로 쓸 것** — C 등급 구간은 `기록 없음(검증 안 됨)`이지 "변경 없음"이 아니다 |
| `requirements` | 파트 1 `evaluate()` 결과 + 칸별 `confidence`(교양필수/교양선택 분할 = 추정, 졸업논문·인증제 = 추정) | 졸업진단 교체 시 이 값을 쓰고 칸별 배지 표시 |
| `dataQuality` | 졸업요건·전공과목 등급(A/B/C), 걸린 판단 보류 id, 미검증 학년도 | 디버그·관리자 화면 |
| `flags[]` | 적용되는 규칙의 플래그 모음(code·level·message) | 사용자 문구는 `message` 그대로(카탈로그: `flags.js`) |

**`categoryAtRegistration({ courseKey, year, semester }, changes, overrides)`**(applicability.js export): 제13조④ — 학생이 그 과목을 들은 학년도·학기의 이수구분. 졸업진단에서 수강 이력 과목을 분류할 때 쓴다.

### P2-2. 운영 반영 전제(파트 3에서 승인받고 할 일 — 이번 파트는 하지 않음)
1. **스키마**: `db/migrate.js`가 운영에서 언제 실행되는지 레포에 없다(Railway 설정). 새 테이블 6개는 `CREATE TABLE IF NOT EXISTS`라 migrate를 한 번 돌리면 생긴다.
2. **시드**: `npm run seed:regulation-articles --workspace server`는 Railway 재시딩 크론 목록(course-offerings/curriculum/regulations/reference-data)에 **없다**. 운영 DB에 적용범위 행이 없으면 `rules: []`가 되고 과목 경과조치 판단이 통째로 빠진다 → 파트 3에서 크론 Start Command에 추가하거나 일회성 실행(승인 필요). 원천 `db/regulation-engine/`은 재시딩 워크플로 경로 필터 밖이라 수정해도 자동 재시딩되지 않는다(의도, D-24).
3. **로컬 테스트 전제**: §5의 시드 + `npm run seed:regulation-articles --workspace server`. 안 하면 `regulationEngine.applicabilityDb.test.js` 첫 테스트가 "seed:regulation-articles를 다시 실행" 메시지로 실패한다.
4. `LATER_CHANGE_NOTICE`(첫 커밋)는 파트 3에서 **지우지 않기로 했다**(D-31): 판단 청크가 없는 경로(학과를 모르는 변경 이력 질문 등)에서도 "이후 변경은 적용 안 된다" 단정이 되살아나지 않게 `curriculumContextService.js`에 남겨 둔다.

### P2-3. 사용자 확인이 필요한 해석(결과가 갈림 — 구조는 둘 다 지원, 기본값만 정함)
- **제13조③ "재학 중인 학년"**: 개편 시점 학년(기본) vs 기준일 학년. 로컬 데이터에서 실제로 갈리는 과목 있음(원예산업학과 2023학번). → 학사지원과 질문.
- **신설 필수과목**: 입학 후 새로 생긴 필수과목을 재학생이 들어야 하는지 제13조에 규정 없음(①만 보면 이수). 지금은 "확인 필요".
- **전공기초·전공심화·전공응용**(2026 광역계열 등): 필수/선택 중 무엇인지 원문 정의 없음 → 제13조②③ 판단 안 함.
- **학칙 [별표 4] 개정 전 표**: 2026년 8월 이전 졸업자(2013~2024학번)에게 적용되는 개정 전 값 미보유.

## 0. 최신 갱신 (2026-10-05, 데이터 검수 세션) — 먼저 읽을 것

**번호 체계 주의**: 이 문서의 아래 1~6절은 이전 세션(= "엔진 코어 파트")이 쓴 것이고, 이번 세션은 다른 지침("파트 1/3: 현황 확인·리스크 레지스터·교육과정 데이터 검수")을 받았다. 두 세션 모두 같은 브랜치/PR(#273)에 쌓였다가 이후 세 PR로 분리됐다(DECISIONS D-16). **엔진 코드는 이번에 바꾸지 않았다.**

이번 세션 산출물: [ANALYSIS](ANALYSIS.md)(현황 재확인·정정) · [RISKS](RISKS.md)(리스크 15개) · [DATA_AUDIT](DATA_AUDIT.md)(연도별 검수 현황·오류 건수·신뢰도 등급·문의 목록) · `scripts/audit/`(재실행 가능한 검수 도구 + `data/summary2018·2020.json`) · 데이터 정정 8행(커밋 `ac3e86d`, `bb0108c`) · `server/test/auditTools.test.js`.

### 파트 2·3 권고안 (순서와 범위) — ✅ 파트 2·3에서 대부분 구현됨(2026-10-05 갱신). 아래는 당시 계획이며 현재 상태는 P3절·FINAL_REVIEW를 볼 것

순서 원칙: **데이터 신뢰 → 엔진 연결 → 소비자(챗봇·화면) 교체 → UX**. 앞 단계가 안 끝나면 뒤 단계가 틀린 숫자를 더 그럴듯하게 만든다(RISKS R-05).

**파트 2 — 판단 함수를 실제 경로에 연결 (코드)**
1. **선결 결정(사용자)**: ① 교양 52학점 상한을 2021학번 이하에 적용할지(RULE_AUDIT B-2·D-09), ② 편입생 총 요구학점을 `null`로 둘지(B-3), ③ 자료 없는 학번 처리(B-4), ④ 2024 사범대 자유선택 32/34(DATA_AUDIT N-6). 이 숫자들이 바뀌면 학생에게 보이는 졸업진단이 바뀐다.
2. **데이터 신뢰도 등급을 엔진 입력으로**: DATA_AUDIT §4 표를 `server/services/regulationEngine/dataGrades.js` 상수로 옮기고, C 등급 연도·영역(전공과목 2017·2018·2020, 컴소공 2017~2022)에서는 과목 단위 판단 플래그를 `ESTIMATED`로 낮춘다. 졸업요건 총괄표 수치는 A지만 **교양 분할·졸업논문/인증제 행·requiredCourses는 검증 안 됨** — 이 값에는 A를 주지 말 것.
3. **`graduationService`를 엔진으로 교체**(본 문서 §3 항목 1). 패리티 테스트를 안전망으로 쓰고, 교체 PR에서 "의도된 차이" 테스트를 새 동작 기준으로 갱신.
4. **`curriculumContextService.js:187`의 고정 문구 정정**(ANALYSIS §1 #3): "이 학번에는 적용되지 않는다"를 조건부로(시행규칙 제13조 근거) 바꾸고, 변경 이력 청크를 엔진 결과(`CURRICULUM_REVISIONS`)로 생성.
5. API: `GET /api/me/regulation?asOf=` (본 문서 §3 항목 2).

**파트 3 — 소비자와 UX, 남은 데이터**
1. 챗봇: 엔진 결과를 1순위 근거로, RAG 학칙 조문은 인용용으로(RISKS R-06). 신뢰도가 `ESTIMATED/NO_DATA`면 단정 금지 지시 + 응답 후처리 가드(R-05).
2. 화면: 신뢰도 배지·사유(flags)·대안 해석(alternatives).
3. 온보딩 보강: 편입 학년, 소속변경 여부, 전과 시점 필수화(스키마 변경 → `check-schema-idempotent`).
4. 데이터 후속: **컴소공 전공과목 학년도별 분리**(RISKS R-13, #272 선례), 2020 미확인 후보 13건 이미지 확인(DATA_AUDIT §6), N-1·N-2 보충, 규정 판본 구조(학교에서 2025-08-29자 학칙·구판본을 받으면 `regulation_versions` 설계).

**PR 구성(분리 완료)**: 세 PR로 나눴다 — **A 엔진**(`feature/regulation-engine-engine`: 테스트 기준선 복구 + 엔진 코어 + 설계·결정·감사 문서, base develop), **B 검수 도구·문서**(`feature/regulation-engine-audit-tools`: `scripts/audit`, ANALYSIS·RISKS·DATA_AUDIT, 도구 테스트; A 위에 쌓은 스택 PR이라 **A가 머지되면 base를 develop으로 바꾼다**), **C 데이터 정정**(`feature/regulation-engine-data-fix`: 2020·2021 JSON 8행, base develop, 독립). 이전 단일 PR #273은 이 셋으로 대체되어 닫았다. **C는 `db/curriculum/**` 변경이라 main 승격 시 재시딩 워크플로 트리거 대상**이므로 승격 시점을 따로 정할 것(RISKS R-04). 되돌리기는 PR 단위 revert.

**로컬 환경 갱신(다른 PC/CI)**: 2020·2021 JSON이 바뀌었으므로 `npm run seed:curriculum-2020 --workspace=server`, `…-2021`, `generate:curriculum-changes`를 다시 실행해야 `scripts/audit/dbVsJson.js`가 일치로 나온다.

**사용자가 확인해야 할 외부 정보**: DATA_AUDIT §8(교육과정 원본 데이터 제공 가능 여부 포함) + RULE_AUDIT D절 7개.

---

## 1. Part 1에서 끝난 것

| 항목 | 상태 |
|---|---|
| 엔진 코어 `server/services/regulationEngine/` (순수 판정 + 읽기 전용 DB 어댑터) | 완료 |
| 입력: 입학년도·입학유형·학과(id/이름)·기준일 + 전과(학년/연도/학기)·편입(학년)·구조조정 시점·해석 정책 | 완료 |
| 출력: 규칙별 값 + 근거 + 변경 이력 + 신뢰도(확정/추정/자료없음) + 플래그 + 대안 해석 | 완료 |
| 기준일별 원문 판본 보유 여부 판단(2026 이전/중간/최신본 이후) | 완료 |
| 근거 인용문이 원문 파일에 실재하는지 검증하는 테스트 | 완료 |
| `graduationService`와 요건 행·총량 패리티 검증 테스트 | 완료 |
| 규정 사실 감사(RULE_AUDIT) · 결정 기록(DECISIONS) · 설계(DESIGN) | 완료 |
| 테스트 기준선 복구(develop에서 이미 17건 실패 중이었음) | 완료(D-14) |

**미완료/의도적으로 안 한 것**: API 엔드포인트, 챗봇 연동, UI, `graduationService` 교체, 소속변경 모델, 편입 학년·소속변경 온보딩 입력, 이수(earned) 판단, 자기계발심층상담 등 (아래 3절).

> 2026-10-05 현재: 챗봇 연동·`graduationService` 교체는 파트 3에서 완료, 졸업요건 화면의 신뢰도 표시는 보정 라운드 A에서 완료. **여전히 미완료**: API 엔드포인트, 소속변경 모델, 편입 학년·소속변경 온보딩 입력, 이수(earned) 판단 일부.

## 2. 사용법

```js
const { resolveRegulation, inputFromStudentRow } = require('./services/regulationEngine');

// 학생 DB 행(students) → 엔진 입력 (편입 학년은 컬럼이 없어 비워둠 → 가정 플래그)
const result = await resolveRegulation(inputFromStudentRow(student, { asOfDate: '2026-10-05' }));

result.confidence;                         // 'CONFIRMED' | 'ESTIMATED' | 'INSUFFICIENT'(파트 2 추가) | 'NO_DATA'
result.rules.find(r => r.id === 'REQUIREMENTS').value;   // { categories, totalRequiredCredits, certifications, adjustments }
result.flags.map(f => f.message);          // 사용자에게 보여줄 한국어 사유(가정/불확실성)
```

- 항상 객체를 돌려준다(예외 없음). 입력 오류 → `NO_DATA` + `INVALID_INPUT`.
- `asOfDate` 생략 시 오늘(KST). 테스트에서는 `opts.today` 또는 `asOfDate`로 고정.
- 데이터 소스 교체: `resolveRegulation(input, { loadData })`.
- `rules[].alternatives`: 해석이 갈리는 규칙(교양 29 컷오프, 교양 상한)의 다른 해석 결과. UI/챗봇은 신뢰도가 `ESTIMATED`일 때 **단정하지 말고 flags 문구와 alternatives를 함께 안내**해야 한다.

## 3. 다음 파트 제안 (우선순위 순) — ⚠ 파트 1 종료 시점의 제안(2026-10-05 갱신: 1·3은 파트 3에서 완료, 5 중 졸업요건 화면 배지는 보정 라운드 A에서 완료, 2·4·6과 관리자 화면은 미완료)

1. **`graduationService`를 엔진으로 교체** — `getGraduationStatus`의 요건 행 조립(`fetchApplicableRequirements`~`applyMajorChange*`)을 `resolveRegulation(...).rules.REQUIREMENTS`로 대체하고 중복 코드를 삭제. 이때 `regulationEngine.parity.test.js`는 필요 없어지지만 "의도된 차이" 테스트(B-1)는 새 동작 기준으로 갱신. **교체 전에 B-2(교양 상한)·B-3(편입 총량)·B-4(자료 없는 학번 0학점) 처리 방침을 정할 것** — 사용자에게 보이는 숫자가 바뀐다.
2. **API**: 예) `GET /api/me/regulation?asOf=YYYY-MM-DD` → 로그인 학생의 `inputFromStudentRow` 결과. 신뢰도/플래그/근거를 그대로 내려주고, 서버 쪽에서 해석을 가공하지 않는다.
3. **챗봇 연동**: `chatContextService`의 "졸업요건" 구조화 청크를 엔진 결과로 만들고, `ESTIMATED`/`NO_DATA`일 때는 AI 프롬프트에 "확정 아님 — 확인 필요" 지시와 플래그 문구를 함께 전달. 현재 챗봇은 학번만 보고 요건을 고른다(전과 시점·입학유형 미반영).
4. **온보딩 입력 보강**: 편입 학년(`transfer.grade`), 소속변경 여부(RULE_AUDIT A-5), 전과 시점 필수화. (스키마 변경이면 `schema.sql` 멱등성 규칙 — 새 CREATE TABLE은 `IF NOT EXISTS`, 컬럼 추가는 `db/migrate.js` 패턴 확인.)
5. **관리자/UI 표시**: 신뢰도 배지(확정/추정/자료없음)와 "왜 추정인가" 펼침.
6. 모델링 확장: 소속변경, 복수전공, 자기계발심층상담, 과목 단위 경과조치(시행규칙 제13조) — RULE_AUDIT E절.

## 4. 지켜야 할 것 / 지뢰

- 신뢰도를 **손으로 지정하지 말 것.** 새 가정은 `flags.js` 카탈로그에 등록하고 `makeFlag`로 남긴다(D-02).
- 새 근거는 `constants.js` `CITATIONS`에 **원문 quote와 함께** 등록 — 원문이 없는 근거는 `ref`가 있는 CASE/BOOKLET 종류로만(테스트가 강제).
- 열린 범위(`max=NULL`) 행은 `latestDataYear` 이후로 외삽하지 않는다. 새 학년도 시드를 넣으면 자동으로 `latestDataYear`가 올라간다.
- 새 파일을 `db/regulations/**`, `db/curriculum/**`, `db/seed/**`(워크플로 필터에 걸리는 경로)에 추가하면 main 푸시 시 **운영 재시딩 워크플로가 트리거**된다. Part 1은 해당 경로에 아무 파일도 추가하지 않았다(`check-db-reseed-paths` 통과). 문서는 `docs/`에 두었다.
- (Part 1 당시) `db/schema.sql`은 건드리지 않았다. **파트 2에서 7.5절에 새 테이블 6개를 `CREATE TABLE IF NOT EXISTS`로 추가했다**(D-24) — 스키마를 바꾸면 `check-schema-idempotent` 대상.

## 5. 로컬 테스트 환경 만들기 (develop에서도 `npm test`는 이 전제가 필요하다)

`npm test`(= `server` 워크스페이스 `node --test`)는 **로컬 MySQL에 시드가 들어 있어야** 통과한다. 시작 시점에 로컬 DB가 낡아 17건이 실패했다. 아래를 로컬 DB(`DB_HOST=localhost`)에 실행하면 91건 → 전부 통과(Part 1 이후 총 132건):

```bash
npm run seed:lineage --workspace=server
npm run seed:curriculum-2023 --workspace=server   # 2023~2026 (2017~2022는 이미 있었음)
npm run seed:curriculum-2024 --workspace=server
npm run seed:curriculum-2025 --workspace=server
npm run seed:curriculum-2026 --workspace=server
npm run generate:curriculum-changes --workspace=server
npm run seed:course-offerings --workspace=server
npm run seed:regulations --workspace=server        # ← Voyage 임베딩(VOYAGE_API_KEY, 비용·시크릿)이 필요
```

`seed:regulations`는 임베딩 API 키가 필요하다. **시크릿 없이** 테스트용으로만 돌릴 때는 임베딩을 결정적 가짜로 바꾸는 래퍼를 스크래치(레포 밖)에 두고 실행했다(테스트는 임베딩/AI 호출을 mock하고 청크 "존재"만 필요). 이렇게 만든 로컬 DB의 청크는 **실제 검색 품질과 무관**하니 로컬 챗봇 품질 확인에는 쓰지 말 것:

```js
// 레포 밖(예: 스크래치패드)에 둔 seedRegLocalStub.js — 프로젝트 파일은 수정하지 않는다
const emb = require('<repo>/server/services/embeddingClient');
emb.getEmbeddings = async (texts) => texts.map((t, i) => { const v = new Array(8).fill(0); v[(t.length + i) % 8] = 1; return v; });
process.chdir('<repo>/server');
require('<repo>/server/scripts/seedRegulations.js');
```

CI: 보정 라운드 A에서 `.github/workflows/test.yml`이 추가돼 PR마다 서버(임시 MySQL 컨테이너 + `scripts/ci/prepare-test-db.sh`)와 클라이언트(vitest) 테스트를 돈다(D-40). 로컬에서 같은 절차를 시험하려면 `bash scripts/ci/prepare-test-db.sh`(빈 DB 전제 — 가짜 학생 계정을 만들므로 운영 DB 금지). 루트 `npm test`는 클라이언트 vitest도 실행하므로 로컬에서 `npm install`로 devDependencies가 설치돼 있어야 한다.

## 6. 남은 리스크 · 내가(사용자가) 확인해야 할 외부 정보

RULE_AUDIT D절 7개 질문이 전부다. 특히 결과가 바뀌는 순서대로:
1. 전과 교양 29학점 컷오프 기준(전과 시점 vs 학사구조조정 시점)과 컷오프 이전 실제 사례 (D-08)
2. 교양 52학점 상한이 2021학번 이하·편입생에게 적용되는지 (D-09, B-2) — **현재 운영 중인 졸업 진단 숫자와 직결**
3. 소속변경 vs 전과 구분 (A-5) — 개편 학과 재학생 전체에 영향 가능
4. 편입생의 기준 학번·총 졸업학점 (A-6)
5. 종전(2025-08-29자) 학칙 부칙·2026 이전 판본·[별표 4] 개정 전 내용 (A-1, A-8)
