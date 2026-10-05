# HANDOFF — 다음 파트가 알아야 할 것

마지막 갱신: **Part 1 종료 (2026-10-05)** · 브랜치 `feature/regulation-engine-core` (develop 기준, PR 미머지) · 이전 파트 없음(Part 1이 첫 파트)

> 다음 파트는 **이 브랜치 위에서** 이어서 작업한다(Part 1 PR이 develop에 머지되기 전이라면). 먼저 [DESIGN.md](DESIGN.md) → [DECISIONS.md](DECISIONS.md) → [RULE_AUDIT.md](RULE_AUDIT.md) 순으로 읽을 것.

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
