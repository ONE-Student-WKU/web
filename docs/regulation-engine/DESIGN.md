# 규정 판단 엔진 — 설계

> 한 줄 요약: **과거 학번 문서를 "찾아주는" 시스템이 아니라, 특정 학생에게 지금 실제로 적용되는 규정을 "판단"하는 시스템.**

- 입력: 입학년도 · 입학유형(`GENERAL` / `TRANSFER_ADMISSION` / `MAJOR_CHANGE`) · 학과 · 기준일 (+ 전과 시점·학년, 편입 학년 같은 보조 정보)
- 출력: 적용 규정(규칙별 값) + 근거(조문/책자/사례) + 변경 이력 + **신뢰도(확정 / 추정 / 자료없음)** + 플래그(어떤 가정을 했는지)
- 코드: `server/services/regulationEngine/` · 상태·진행: [HANDOFF.md](HANDOFF.md) · 결정 이력: [DECISIONS.md](DECISIONS.md) · 규정 사실 감사: [RULE_AUDIT.md](RULE_AUDIT.md)

## 1. 왜 이런 구조인가 (핵심 3가지)

**① 신뢰도는 "도출"한다.** 규칙 코드가 `confidence: CONFIRMED`를 손으로 쓰면, 나중에 가정이 하나 추가될 때 그 줄을 고치는 걸 잊는 순간 추정이 확정처럼 나간다. 그래서 규칙은 "이런 가정을 했다"는 **플래그**만 남기고(`flags.js`), 신뢰도는 플래그 중 가장 나쁜 level이 자동으로 정한다(플래그 없음·INFO만 = 확정 / ESTIMATED = 추정 / NO_DATA 하나라도 = 자료없음). 여러 규칙을 합칠 때도 가장 나쁜 쪽을 따른다.

**② 판정(조문 해석)과 수치(책자 데이터)를 분리한다.** 어느 갈래의 규정이 적용되는지는 `decisions.js`(조문 해석)가 정하고, 학점 숫자는 `curriculum_requirements`(책자에서 옮긴 시드)에서 온다. 둘은 바뀌는 이유가 다르다 — 개정이 생기면 해석을 고치고, 새 학번 자료는 시드만 고치면 된다.

**③ 근거는 검증 가능해야 한다.** 근거는 `constants.js`의 `CITATIONS` 레지스트리 한 곳에만 있고 각 인용문(`quote`)은 **테스트가 실제 원문 파일에서 찾아본다**(`regulationEngine.citations.test.js`). 존재하지 않는 조문 문구를 코드에 쓰면 테스트가 실패한다. "규정 내용을 만들어내지 않는다"를 사람의 주의가 아니라 테스트로 지킨다.

## 2. 처리 흐름

```
raw input ──normalizeInput──▶ ctx ──(loadData: DB 읽기 전용)──▶ data ──evaluate(순수 함수)──▶ result
 (context.js)                       (dbProvider.js)                    (evaluate.js + decisions.js)
```

`evaluate` 안에서:

1. **자격 점검** `checkEligibility` — 지원 학번(≥2017) 밖, 기준일이 입학 이전, 기준일이 전과 이전, 전과 시점이 입학 이전이면 값 없이 **NO_DATA**.
2. **자료 점검** — 학과 없음 / 그 학번 핵심 행(교양·전공) 없음 / 시스템 최신 학번 이후(열린 범위 외삽 금지) → **NO_DATA** (다른 해·다른 학과 값으로 대신 채우지 않고, 개편 관계 후보만 안내).
3. **갈래 판정** `decisions.js`
   - `decideMajorRelaxation` — 전공 최소학점 완화 여부(시행규칙 제6·8조): 전과 1·2학년=없음, 3·4학년=최소전공 행 / 편입 2학년=없음, 3학년=최소전공 행, 4학년=21학점(제6조③)
   - `decideLiberalArtsBasis` — 교양 이수기준: 학번표(`COHORT_TABLE`) vs 전과 29학점 고정(`FIXED_29`, 컷오프 2022-2학기)
   - `decideLiberalArtsCap` — 교양 인정 상한(52학점, 학번 분기)
   - `checkTextVersion` — 기준일 당시 시행 중이던 학칙·시행규칙 원문을 보유하는가
4. **행 조립** `buildRequirementRows` — 갈래 판정대로 책자 행을 고르고(`MAJOR_RELAXATION`, `LIBERAL_FIXED_29`) 일반선택을 재배분(`GENERAL_ELECTIVE_REBALANCE`)해 총 요구학점을 만든다.
5. **변경 이력** — 이 학번 이후/이전의 요건 변경(`curriculum_changes`). 참고 정보라 신뢰도 계산에서 제외(`critical: false`).

## 3. 출력 형태 (요약)

```js
{
  input: { admissionYear, enrollmentType, departmentId, asOfDate, asOfTerm, majorChange, transfer, ... },
  department: { id, name } | null,
  confidence: 'CONFIRMED' | 'ESTIMATED' | 'NO_DATA',   // critical 규칙 중 가장 나쁜 것
  confidenceLabel: '확정' | '추정' | '자료없음',
  rules: [{
    id: 'REQUIREMENTS' | 'MAJOR_MINIMUM' | 'LIBERAL_ARTS_BASIS' | 'LIBERAL_ARTS_CAP' | 'CURRICULUM_REVISIONS',
    critical: boolean, confidence, value,
    flags:  [{ code, level: 'INFO'|'ESTIMATED'|'NO_DATA', message(한국어), ...세부 }],
    basis:  [{ key, kind: 'ARTICLE'|'BOOKLET'|'CASE', doc, article }],
    alternatives: [...]   // 다른 해석을 택했을 때의 결과(해석이 갈리는 규칙만)
  }],
  flags: [...]            // 모든 규칙 플래그의 합집합(중복 제거)
}
```

`resolveRegulation(rawInput, { loadData?, today? })`은 **예외를 던지지 않는다**. 입력 오류는 `confidence: NO_DATA` + `INVALID_INPUT` 플래그로 돌려준다 — 호출자(API/챗봇)가 try/catch 없이 신뢰도만 보고 "확인 필요" 안내로 분기하게 하려는 것.

## 4. "기준일"의 의미 (가장 헷갈리기 쉬운 부분)

기준일은 두 곳에만 영향을 준다. 책자의 학번별 학점 값은 **기준일과 무관하게 학번으로 고정**된다(시행규칙 제5조: 교육과정은 입학 당시 기준).

| 영향 | 내용 |
|---|---|
| 규정 원문 보유 여부 | 우리 레포의 학칙·시행규칙 원문은 2026-06-26 개정본(시행규칙 최초 시행 2026-03-01)뿐이다. 조문(ARTICLE)에 기대는 판단은 기준일이 `2026-03-01` 이전이면 `TEXT_VERSION_NOT_HELD`, `2026-03-01 ≤ 기준일 < 2026-06-26`이면 `TEXT_INTERMEDIATE_VERSION`(둘 다 추정), 이후면 `TEXT_SNAPSHOT_MAY_BE_OLDER`(INFO) |
| 학생 상태 존재 여부 | 기준일이 입학 학기 이전 / 전과 학기 이전이면 "그 시점의 이 학생"에 대한 규정을 알 수 없어 NO_DATA |

학기는 학칙 제22조대로 3/1~8/31=1학기, 9/1~다음해 2월 말=2학기(1~2월은 전년도 2학기)로 계산한다.

## 5. 유지보수 가이드

- **새 학번 자료**: 시드(`db/seed/curriculum_requirements.json`)만 추가하면 된다. 단, 열린 범위(`max=NULL`) 행은 시스템 최신 학번(`latestDataYear`)까지만 유효하다.
- **새 규칙/가정**: `flags.js` 카탈로그에 코드·level·한국어 문구를 먼저 등록 → `decisions.js`에서 `makeFlag` → 근거는 `constants.js` `CITATIONS`에 quote와 함께 등록. 미등록 코드·근거 키는 실행 시점과 테스트(소스 스캔) 양쪽에서 실패한다.
- **규정 개정(새 원문)**: `TEXT_SOURCES`의 판본 날짜를 갱신하고 `citations` 테스트를 돌린다 — quote가 바뀐 조문은 여기서 걸린다.
- **`graduationService.js`와의 관계**: Part 1에서는 건드리지 않았다. 같은 규칙이 두 곳에 있으므로 `regulationEngine.parity.test.js`가 일치를 보장한다. Part 2에서 `graduationService`가 엔진을 쓰도록 교체한다(HANDOFF 참고).

## 6. 파트 2 추가: 적용범위 판단 (`resolveApplicableRules`)

파트 1이 "이 학번의 졸업요건 값"을 계산했다면, 파트 2는 그 위에 "어느 **조문**이 이 학생에게 기준일에 적용되나"를 얹는다.

```
원문 txt ──articleParser──▶ 조문·개정 표시·부칙(판본)
                              │  + db/regulation-engine/applicability.json(사람이 쓴 적용범위, 인용문은 테스트가 원문 대조)
                              ▼
                     regulationSeed (순수) ──seed:regulation-articles──▶ regulation_* 테이블
                                                                            │
curriculum_changes · department_lineage · curriculum_requirements ──────────┤ dbProvider.loadApplicabilityData (읽기 전용)
                                                                            ▼
                      resolveApplicableRules(input, data)  ← 순수 함수, dataQuality(검수 등급) 반영
                        ├─ rules[]: 조문별 status(APPLIES/NOT_APPLICABLE/CONDITIONAL/UNKNOWN) + 근거 + 과목 목록
                        ├─ history: 학년도별 "변경 있음 / 변경 없음 / 기록 없음(검증 안 됨)"
                        └─ requirements: 파트 1 evaluate() + 칸별 신뢰도
```

**두 개의 "연도 범위"를 섞지 않는다**(D-25): `curriculum_requirements`의 학번 범위는 "그 학번 책자에 적힌 값"(스냅샷, 제5조), `regulation_applicability.scope`는 "개정이 이미 입학한 학생에게도 미치나"(소급·경과조치, 제13조).

**신뢰도 4단계**: 확정 < 추정 < 자료 불충분(확인 필요) < 자료없음. 검수 등급 C 구간의 판단은 자료 불충분, 그 구간에서 변경이 안 보이는 것은 "기록 없음(검증 안 됨)"(D-27). 조문 판본은 조문별 개정 표시로 판단한다 — 기준일 뒤에 개정 표시가 없는 조문은 기준일 당시에도 같은 문구(D-28).

## 7. 파트 3 추가: 소비자 연결

```
질문 ─ yearContext(학번·학년도·기준일) ─┬─ regulationContextService.lookupRegulationJudgment   ← RAG보다 먼저
                                         │     resolveApplicableRulesForStudent(요건 포함) → 판단 청크 + 조문 원문 청크
                                         ├─ RAG 검색 + 구조화 조회(assembleStructuredChunks)
                                         └─ mergeChunks: ① 판단 ② 구조화 ③ 직전 턴 ④ RAG(같은 조문 원문 제외)
                                               → aiClient: 근거 우선순위 + 신뢰도별 답변 지침

졸업진단 graduationService ─ resolveRequirementsForStudent(evaluate + 데이터 등급) → 요건 행·교양 상한 → 이수 현황 + regulation
```

- 판단은 코드가, 설명은 모델이: 모델은 "이 조문이 이 학생에게 적용되나"를 추측하지 않고, 엔진이 정한 결과·신뢰도를 설명한다.
- 신뢰도 문구는 청크 본문에 들어간다 → AI 없이 테스트 가능(평가 세트, EVAL_SET.md).
