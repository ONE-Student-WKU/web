# HANDOFF — 다음 파트가 알아야 할 것

마지막 갱신: **파트 2/3 종료 (2026-10-05, 브랜치 `feature/regulation-engine-rules`)** — 아래 P2절부터 읽을 것 · 이전: 데이터 검수 세션, Part 1(엔진 코어) — 둘 다 develop 머지 완료(#274·#275·#276)

> 다음 파트는 **이 브랜치 위에서** 이어서 작업한다(Part 1 PR이 develop에 머지되기 전이라면). 먼저 [DESIGN.md](DESIGN.md) → [DECISIONS.md](DECISIONS.md) → [RULE_AUDIT.md](RULE_AUDIT.md) 순으로 읽을 것.

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
4. `LATER_CHANGE_NOTICE`(첫 커밋)는 임시 문구다. 파트 3에서 챗봇 컨텍스트를 엔진 결과(`rules`의 제13조 항목)로 바꾸면 지운다.

### P2-3. 사용자 확인이 필요한 해석(결과가 갈림 — 구조는 둘 다 지원, 기본값만 정함)
- **제13조③ "재학 중인 학년"**: 개편 시점 학년(기본) vs 기준일 학년. 로컬 데이터에서 실제로 갈리는 과목 있음(원예산업학과 2023학번). → 학사지원과 질문.
- **신설 필수과목**: 입학 후 새로 생긴 필수과목을 재학생이 들어야 하는지 제13조에 규정 없음(①만 보면 이수). 지금은 "확인 필요".
- **전공기초·전공심화·전공응용**(2026 광역계열 등): 필수/선택 중 무엇인지 원문 정의 없음 → 제13조②③ 판단 안 함.
- **학칙 [별표 4] 개정 전 표**: 2026년 8월 이전 졸업자(2013~2024학번)에게 적용되는 개정 전 값 미보유.

## 0. 최신 갱신 (2026-10-05, 데이터 검수 세션) — 먼저 읽을 것

**번호 체계 주의**: 이 문서의 아래 1~6절은 이전 세션(= "엔진 코어 파트")이 쓴 것이고, 이번 세션은 다른 지침("파트 1/3: 현황 확인·리스크 레지스터·교육과정 데이터 검수")을 받았다. 두 세션 모두 같은 브랜치/PR(#273)에 쌓였다가 이후 세 PR로 분리됐다(DECISIONS D-16). **엔진 코드는 이번에 바꾸지 않았다.**

이번 세션 산출물: [ANALYSIS](ANALYSIS.md)(현황 재확인·정정) · [RISKS](RISKS.md)(리스크 15개) · [DATA_AUDIT](DATA_AUDIT.md)(연도별 검수 현황·오류 건수·신뢰도 등급·문의 목록) · `scripts/audit/`(재실행 가능한 검수 도구 + `data/summary2018·2020.json`) · 데이터 정정 8행(커밋 `ac3e86d`, `bb0108c`) · `server/test/auditTools.test.js`.

### 파트 2·3 권고안 (순서와 범위)

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

## 2. 사용법

```js
const { resolveRegulation, inputFromStudentRow } = require('./services/regulationEngine');

// 학생 DB 행(students) → 엔진 입력 (편입 학년은 컬럼이 없어 비워둠 → 가정 플래그)
const result = await resolveRegulation(inputFromStudentRow(student, { asOfDate: '2026-10-05' }));

result.confidence;                         // 'CONFIRMED' | 'ESTIMATED' | 'NO_DATA'
result.rules.find(r => r.id === 'REQUIREMENTS').value;   // { categories, totalRequiredCredits, certifications, adjustments }
result.flags.map(f => f.message);          // 사용자에게 보여줄 한국어 사유(가정/불확실성)
```

- 항상 객체를 돌려준다(예외 없음). 입력 오류 → `NO_DATA` + `INVALID_INPUT`.
- `asOfDate` 생략 시 오늘(KST). 테스트에서는 `opts.today` 또는 `asOfDate`로 고정.
- 데이터 소스 교체: `resolveRegulation(input, { loadData })`.
- `rules[].alternatives`: 해석이 갈리는 규칙(교양 29 컷오프, 교양 상한)의 다른 해석 결과. UI/챗봇은 신뢰도가 `ESTIMATED`일 때 **단정하지 말고 flags 문구와 alternatives를 함께 안내**해야 한다.

## 3. 다음 파트 제안 (우선순위 순)

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
- `db/schema.sql`은 건드리지 않았다. 스키마를 바꾸면 `check-schema-idempotent` 대상.

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

CI/운영에서 같은 테스트가 어떻게 통과하는지(어떤 시드 상태를 가정하는지)는 이번에 확인하지 못했다(워크플로에는 테스트 실행 단계가 없음 — `vercel-deploy.yml`, `db-reseed*.yml`만 확인).

## 6. 남은 리스크 · 내가(사용자가) 확인해야 할 외부 정보

RULE_AUDIT D절 7개 질문이 전부다. 특히 결과가 바뀌는 순서대로:
1. 전과 교양 29학점 컷오프 기준(전과 시점 vs 학사구조조정 시점)과 컷오프 이전 실제 사례 (D-08)
2. 교양 52학점 상한이 2021학번 이하·편입생에게 적용되는지 (D-09, B-2) — **현재 운영 중인 졸업 진단 숫자와 직결**
3. 소속변경 vs 전과 구분 (A-5) — 개편 학과 재학생 전체에 영향 가능
4. 편입생의 기준 학번·총 졸업학점 (A-6)
5. 종전(2025-08-29자) 학칙 부칙·2026 이전 판본·[별표 4] 개정 전 내용 (A-1, A-8)
