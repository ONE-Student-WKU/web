# 현황 분석 (2026-10-05, develop `16c203e` 기준 + 이 브랜치)

지침 §1의 "사전 분석 결과"를 코드로 다시 확인했다. 맞는 것은 근거 위치를 달고, 틀리거나 달라진 것은 **정정**으로 표시한다. 이 문서의 모든 줄 번호는 이 브랜치(`feature/regulation-engine-core`) 기준이다.

## 1. 사전 분석 재확인

| # | 사전 분석의 주장 | 확인 | 근거 / 정정 |
|---|---|---|---|
| 1 | `curriculum_requirements`/`curriculum_courses`가 `min/max_admission_year`, `enrollment_type`, `rule_key`, `course_key`를 가진다 | ✅ | `db/schema.sql:288`(요건), 6.5절(과목). 같은 `rule_key` 행들은 학번 범위가 겹치지 않는 시간순 버전(`curriculumKeys.js` 주석) |
| 2 | `curriculum_changes`의 `from_year/to_year`는 입학학번이며 공포일이 아니다 | ✅ | `db/schema.sql:409~436` 주석: "from_year = 변경 전 값이 마지막으로 적용된 입학학번, to_year = 변경 후 값이 처음 적용된 입학학번". **함의**: 이 표는 "어느 학번부터 값이 달라졌나"만 답한다. "개정이 언제(공포일/학기) 재학생에게 효력이 생겼나"는 이 표로 답할 수 없다 — 시행규칙 제13조 판단에 필요한 날짜 축이 없다 |
| 3 | `curriculumContextService.js` ~187행 고정 문구가 시행규칙 제5조·제13조①~④와 충돌한다 | ✅ **확인** | `server/services/curriculumContextService.js:187`: "이 학번 이후의 변경(**이 학번에는 적용되지 않는다** — 규정이 바뀌어도 ${cohort}학번의 적용 규정은 위 값 그대로)". 시행규칙 제13조①은 "개편된 신 교육과정은 개정 공포일로부터 **전 학년에 적용 및 시행**"이고 ②③④는 필수→선택/폐설 면제, 선택→필수 저학년 면제, 이수구분은 수강신청 당시 기준이다(`db/regulations/_source/원광대학교_학칙시행규칙_전문.txt` 제5조·제13조). 즉 이 문구는 "항상 적용 안 된다"고 **단정**하는데 원문은 조건부다. 그 문구가 LLM 근거에 들어가므로 챗봇이 틀린 단정을 반복할 수 있다. 이 브랜치의 엔진은 이 상황을 `CURRICULUM_REVISION_AFTER_COHORT`(INFO, 시행규칙 제13조 근거)로 다루지만 챗봇 문구는 당시 안 바뀜 → 파트 2 첫 커밋 `b28920a`에서 조건부 문구로 정정됨 |
| 4 | 학칙·시행규칙·수업관리규정은 최신본 1건뿐, 버전/조문/개정일/적용범위/문서 간 관계 저장 구조가 없다 | ✅ | 원문은 `db/regulations/_source/*.txt` 3개(학칙 2026.06.26, 시행규칙 2026.06.26, 수업관리규정 2026.04.10). `regulation_documents`에는 `effective_date`(단일 DATE)와 `book_year`뿐이다(`db/schema.sql:526`). `seedRegulations.js:29`의 `VERBATIM_EFFECTIVE_DATE = '2026-06-26'`을 학칙·시행규칙·수업관리규정 **세 문서 모두에** 적용한다(수업관리규정의 실제 최신 개정은 2026-04-10 — 상수 한 개로는 표현 불가) |
| 5 | 적용 규정을 계산하는 함수가 없다 | ⚠ **정정** | develop에는 없다. 그러나 이 브랜치(PR #273)에는 엔진 코어 `server/services/regulationEngine/`가 이미 있다(이전 세션 산출물 — 아래 §4). 다만 **어디서도 호출되지 않는다**. 파트 2에서 연결해야 한다 *(2026-10-05 갱신: 파트 3에서 챗봇·졸업진단에 연결됨)* |
| 6 | 학칙류는 RAG 유사도 검색뿐이다 | ✅ | `regulationService.findRelevantChunks`(`regulationService.js:~66`)는 코사인 유사도 + `MIN_SIMILARITY = 0.4`(14행) + 책자 학년도 필터(`selectChunksByYear`, 81행). 학칙은 `book_year = NULL`이라 모든 질문에서 유사도만으로 경쟁한다. 조문 번호·개정일·적용 범위로 찾는 경로가 없다 |
| 7 | `graduationService.js`의 전과생 로직은 하드코딩이다 | ✅ | `LIBERAL_ARTS_CREDIT_CAP = 52`(13행), `MAJOR_CHANGE_LIBERAL_ARTS_CUTOFF = {2022, 2}`(52행), `resolveEffectiveEnrollmentType`(29행), `applyMajorChangeLiberalArtsOverride`(66행), `applyMajorChangeGeneralElectiveOverride`(81행). 상수·조문 근거가 코드 주석에만 있고 데이터로 분리돼 있지 않다 |
| 8 | 재사용 가능: `yearContext.js`, `curriculumHistoryService.js`, `curriculumContextService.js`, `department_lineage`, `course_lineage` | ✅ | `yearContext.resolveYearContext`(74행)는 질문에서 학번/학년도를 가려내는 순수 함수(모드 COHORT/SPECIFIC_YEAR/COMPARE/HISTORY/DEFAULT). `curriculumHistoryService.describeRuleForCohort`는 엔진 `dbProvider`가 이미 재사용 중. 단 `yearContext`는 **입학유형·전과 시점·기준일을 전혀 모른다**(학번만) |

## 2. 사전 분석에 없던 사실 (이번에 새로 확인)

1. **챗봇은 두 개의 근거 경로를 따로 쓴다.** `routes/chat.js`는 RAG 청크(`regulationService`)와 구조화 근거(`chatContextService.assembleStructuredChunks` → `curriculumContextService`)를 합쳐 AI에 넘기고(`mergeChunks`), 졸업진단 결과(`graduationService.getGraduationStatus`, `chat.js:106`)를 별도 인자로 또 넘긴다. 세 근거가 서로 다른 계산 경로(학번만 vs 전과 시점까지 vs 문서 유사도)라 **같은 질문에 서로 다른 숫자가 근거로 들어갈 수 있다** → RISKS R-06.
2. **운영 재시딩 파이프라인이 `seed:curriculum-YYYY`를 실행하지 않는다.** `.github/workflows/db-reseed.yml` 머리 주석(5~12행)대로 Railway 크론은 `seed:course-offerings / seed:curriculum / seed:regulations --force / seed:reference-data`만 돈다. 학년도별 전공과목 시드(`seed:curriculum-2017`~`2026`)와 `seed:lineage`, `generate:curriculum-changes`는 **운영에 자동 반영되지 않는다**. 이번 검수에서 고친 `2020·2021` 전공과목 JSON은 로컬 DB에서만 검증됐다 → RISKS R-04.
3. **`db/regulations/**`·`db/curriculum/**`·`db/seed/**`에 파일이 추가/변경돼 main에 push되면 재시딩 워크플로가 트리거된다**(`on.push.paths`). 이번 검수에서 수정한 `db/curriculum/_source/2020·2021_*.json`도 이 경로라, 이 브랜치가 main으로 승격되면 워크플로가 (승인 게이트 뒤에서) 실행 대상이 된다. 이번 작업에서는 트리거하지 않았다.
4. **`students`에 입학유형 보조 정보가 모자란다.** 편입 학년·편입 연도·소속변경 여부 컬럼이 없다(`db/schema.sql:80~`). 전과 정보(`major_change_grade/year/semester`)만 있다 → 엔진이 편입생을 항상 "추정"으로 낼 수밖에 없는 근본 원인.
5. **데이터 출처가 연도마다 다르다**(이슈 #260 상단 표 + 각 연도 절): 2017·2018은 학교 조회 도구 값 + 책자 이미지, 2019·2021~2026은 텍스트 PDF 추출 + 도구 대조, 2020은 스캔본 이미지 읽기. 컴퓨터·소프트웨어공학과(컴소공)는 `_source` JSON이 아니라 `db/curriculum/*.md`(2026 책자 기준)로 시드된다(2020만 #272에서 분리). 검수 전략이 연도별로 달라지는 이유.
6. **develop은 이미 `npm test` 17건이 실패하던 상태였다**(로컬 시드 의존, DECISIONS D-14). 테스트가 "시드 상태를 가정한다"는 사실이 문서화돼 있지 않았다.

## 3. 데이터 흐름 (규정 판단 관점)

```
원문(학칙/시행규칙/수업관리규정 txt, 책자 md) ──seedRegulations──▶ regulation_documents/chunks ──RAG 유사도──▶ 챗봇
교육과정 책자 PDF ─(사람/AI 전사)▶ db/curriculum/_source/*.json ──seedCurriculumYYYY──▶ curriculum_courses
                              └▶ db/seed/curriculum_requirements.json ──seed.js──▶ curriculum_requirements
curriculum_* ──generateCurriculumChanges──▶ curriculum_changes(AUTO, 학번 단위)
students(학번·학과·입학유형·전과정보) + curriculum_requirements ──graduationService──▶ 졸업진단(챗봇·화면)
students + curriculum_* + curriculum_changes ──(이 브랜치) regulationEngine──▶ 적용 규정+근거+신뢰도 (파트 3에서 챗봇·졸업진단에 연결됨)
```

가장 약한 고리: **전사 단계(책자 → JSON/seed)**. 이 단계의 정확성은 코드로 보장되지 않고, 이번 검수(DATA_AUDIT.md)가 처음으로 책자와 기계 대조를 했다.

## 4. 이 브랜치에 이미 있는 것 (이전 세션 산출물)

지침은 "이번 파트는 판단 로직을 구현하지 않는다"고 했으나, 이 브랜치에는 이전 세션이 만든 규정 판단 엔진 코어(PR #273, 미머지)가 있다. **이번 세션은 엔진 코드를 수정하지 않았다**(데이터 검수·문서·검수 스크립트만). 엔진의 설계와 한계는 [DESIGN.md](DESIGN.md), 결정은 [DECISIONS.md](DECISIONS.md) D-01~D-15, 규정 사실 감사는 [RULE_AUDIT.md](RULE_AUDIT.md)에 있다. 이번 검수 결과 중 엔진 입력(데이터 신뢰도 등급)이 되는 부분은 [DATA_AUDIT.md](DATA_AUDIT.md) 4절에 정리했다.
