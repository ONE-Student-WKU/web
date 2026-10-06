/**
 * server/test-helpers/regulationEvalSet.js (test/ 밖에 두는 이유: node --test가 test/ 아래 .js를 전부 테스트 파일로 실행한다)
 * 규정 판단 평가 세트(파트 3) — 학번·학과·입학유형 시나리오별 "정답"(회귀 테스트 기대값).
 * 실행: server/test/regulationEngine.evalSet.test.js. 사람이 읽는 표: docs/regulation-engine/EVAL_SET.md.
 *
 * 기대값을 정하는 원칙:
 *  - confidence: 그 시나리오에서 엔진이 내야 하는 전체 신뢰도. 근거(why)에 어느 규칙·검수 등급 때문인지 적었다.
 *  - review: 'NEEDS_HUMAN_REVIEW' = 정답 자체가 규정 원문·검수 자료로 확정되지 않는 경우(DATA_AUDIT 판단 보류·이슈 #260,
 *    RULE_AUDIT D절 문의 항목). 이런 시나리오는 "정답 숫자"가 아니라 **단정하지 않는 것**(확정이 아님 + 확인 안내)을 검증한다.
 *  - chat: 챗봇 근거 조립(assembleStructuredChunks)까지만 본다(AI 호출 없음). 판단 청크에 신뢰도·답변 지침이 실리는지.
 *  - graduation: 졸업진단(getGraduationStatus) 결과 — 총 요구학점과 진단 신뢰도.
 *  - 기준일은 따로 적지 않으면 2026-10-05.
 *
 * 숫자(총 요구학점)는 DATA_AUDIT §4에서 졸업요건 총괄표가 전 연도 등급 A(책자와 전수 대조)인 값만 기대값으로 쓴다.
 */

const NEEDS_HUMAN_REVIEW = 'NEEDS_HUMAN_REVIEW';

const SCENARIOS = [
  // --- 확정 가능한 기준 시나리오 ---
  {
    id: 'E01', title: '간호학과 2026학번 일반 — 입학 학년도 = 기준 학년도, 경과조치 대상 없음',
    input: { department: '간호학과', admissionYear: 2026, enrollmentType: 'GENERAL' },
    expected: { confidence: 'CONFIRMED', rules: { ACAD_SCHED4_1_FROM_2026: 'APPLIES', ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED: 'NOT_APPLICABLE' } },
    question: '내 졸업요건이 뭐야?', graduation: { total: 130, confidence: 'CONFIRMED' },
    why: '학칙 [별표 4] ①(2026학년도 입학생 이후) + 2026 총괄표 A, 입학 후 개편 없음',
  },
  {
    id: 'E02', title: '공학3계열 2026학번 일반 — 130학점',
    input: { department: '공학3계열', admissionYear: 2026, enrollmentType: 'GENERAL' },
    expected: { confidence: 'CONFIRMED', rules: { ACAD_SCHED4_1_FROM_2026: 'APPLIES' } },
    question: '졸업하려면 몇 학점 들어야 해?', graduation: { total: 130, confidence: 'CONFIRMED' },
    why: '2026 총괄표 A(공학3계열 130), 경과조치 대상 없음',
  },
  {
    id: 'E03', title: '간호학과 2025학번 일반 — [별표 4] ②, 2026 개편이 아직 이 학번 교육과정을 바꾸지 않음',
    input: { department: '간호학과', admissionYear: 2025, enrollmentType: 'GENERAL' },
    expected: { confidence: 'CONFIRMED', rules: { ACAD_SCHED4_2_2025: 'APPLIES', ACAD_SCHED4_3_2013_2024: 'NOT_APPLICABLE' } },
    question: '내 졸업학점 기준 알려줘', graduation: { total: 130 },
    why: '학칙 [별표 4] ②(2025학년도 입학생), 간호학과 2025→2026 과목 변경 없음',
  },
  {
    id: 'E04', title: '간호학과 2022학번, 기준일 2026-05-01 — 부칙(2026.04.10.) ② 졸업 시기에 따라 갈림',
    input: { department: '간호학과', admissionYear: 2022, enrollmentType: 'GENERAL', asOfDate: '2026-05-01' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, rules: { ACAD_ADD_20260410_SCHED4_BY_GRADUATION: 'CONDITIONAL' }, flags: ['SCHEDULE4_PRE_AMENDMENT_NOT_HELD', 'TEXT_INTERMEDIATE_VERSION'] },
    question: '졸업학점이 바뀐다던데 나도 적용돼?',
    why: '2026년 8월 이전 졸업이면 개정 전 [별표 4](미보유) — RULE_AUDIT D-5',
  },

  // --- 데이터 검수 등급 C 구간(DATA_AUDIT §4) ---
  {
    id: 'E05', title: '간호학과 2017학번, 기준일 2019-10-01 — 전공과목 2017·2018 등급 C',
    input: { department: '간호학과', admissionYear: 2017, enrollmentType: 'GENERAL', asOfDate: '2019-10-01' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['HISTORY_NOT_VERIFIED', 'TEXT_VERSION_NOT_HELD'], historyNotVerified: [2018] },
    question: '내가 입학한 뒤로 교육과정이 바뀐 적 있어?',
    why: 'DATA_AUDIT §4 전공과목 2017·2018 = C(책자 대조 불가) → "변경 없음" 대신 "기록 없음(검증 안 됨)". 기준일이 보유 원문 판본(2026-03-01) 이전',
  },
  {
    id: 'E06', title: '간호학과 2019학번 — 2020 전공과목 등급 C 구간을 지남',
    input: { department: '간호학과', admissionYear: 2019, enrollmentType: 'GENERAL' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['HISTORY_NOT_VERIFIED'], historyNotVerified: [2020, 2021] },
    question: '필수과목이 선택으로 바뀌면 안 들어도 돼?', graduation: { total: 140 },
    why: 'DATA_AUDIT §4 전공과목 2020 = C(이웃 이상치 11건 미확인) — 2019→2020, 2020→2021 비교 모두 미검증',
  },
  {
    id: 'E07', title: '컴소공 2018학번 — 컴소공 전공과목 등급 C(2017~2019·2021·2022)',
    input: { department: '컴퓨터·소프트웨어공학과', admissionYear: 2018, enrollmentType: 'GENERAL' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['HISTORY_NOT_VERIFIED', 'DATA_PENDING_HOLD'] },
    question: '내 졸업요건이 뭐야?', graduation: { total: 136, confidence: 'ESTIMATED' },
    why: 'DATA_AUDIT §4 컴소공 열 C + N-8(2017~2022학번 전공과목이 2026 기준 md), #260 컴소공 교양 분할 보류. 졸업 총학점 136은 총괄표 A',
  },
  {
    id: 'E08', title: '컴소공 2021학번 — 컴소공 C 구간',
    input: { department: '컴퓨터·소프트웨어공학과', admissionYear: 2021, enrollmentType: 'GENERAL' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['HISTORY_NOT_VERIFIED'] },
    question: '전공필수 바뀐 거 나한테도 적용돼?', graduation: { total: 136 },
    why: 'DATA_AUDIT §4 컴소공 2021·2022 = C(일치 33/52, 36/45)',
  },
  {
    id: 'E09', title: '컴소공 2023학번 — 컴소공 B 구간(부분 검증)',
    input: { department: '컴퓨터·소프트웨어공학과', admissionYear: 2023, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', flags: ['COURSE_DATA_GRADE_B'], notFlags: ['HISTORY_NOT_VERIFIED'] },
    question: '교육과정 개편되면 나는 어떻게 돼?', graduation: { total: 136, confidence: 'CONFIRMED' },
    why: 'DATA_AUDIT §4 컴소공 2023~2026 = B → 추정(자료 불충분은 아님). 졸업요건 총괄표는 A',
  },

  // --- 판단 보류(DATA_AUDIT §2-3, 이슈 #260) ---
  {
    id: 'E10', title: '수학교육과 2018학번 — 일반선택 책자 42 vs 시드 44(#260)',
    input: { department: '수학교육과', admissionYear: 2018, enrollmentType: 'GENERAL' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    question: '졸업하려면 일반선택 몇 학점이야?', graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: '책자 산술 불일치(27+69+42=138≠140) — 어느 값이 맞는지 학교 확인 전',
  },
  {
    id: 'E11', title: '수학교육과 2019학번 — 같은 보류(#260)',
    input: { department: '수학교육과', admissionYear: 2019, enrollmentType: 'GENERAL' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: '2019 자동 대조에서 책자값 재현, 시드 44 유지 — 판단 보류',
  },
  {
    id: 'E12', title: '패션디자인산업학과 2020학번 — 자유선택 책자 35 vs 시드 32(#260)',
    input: { department: '패션디자인산업학과', admissionYear: 2020, enrollmentType: 'GENERAL' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD', 'LINEAGE_NAME_MATCH'] },
    question: '내 졸업요건 알려줘', graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: '책자 산술 불일치(29+69+35=133≠130) + 2020 전공과목 C + 디자인융합계열 개편 계보가 이름 일치 추정',
  },
  {
    id: 'E13', title: 'SW융합학과 2021학번 — 교양·전공·자유 구조 보류(#260)',
    input: { department: 'SW융합학과', admissionYear: 2021, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    question: '졸업요건이 어떻게 돼?', graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: 'SW연계 학점이 포함된 구조(교양 31·전공 54·자유 3) 판단 보류',
  },
  {
    id: 'E14', title: '국어교육과 2024학번 — 사범대 자유선택 32 vs 34, 변경 이력 가짜 변경(N-6)',
    input: { department: '국어교육과', admissionYear: 2024, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    question: '2023학번이랑 졸업요건이 달라진 이유가 뭐야?', graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: '책자 37+69+32=138≠140, 시드가 잔여값 34로 보정 → 2023→2024 "교양 39→37, 일반선택 32→34"가 실제 개정인지 미확인',
  },
  {
    id: 'E15', title: '중등특수교육과 2025학번 — 전공·자유선택 보류(#260)',
    input: { department: '중등특수교육과', admissionYear: 2025, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: '#260 [2025·2026] 중등특수교육과 전공·자유선택',
  },
  {
    id: 'E16', title: '한의학과 2026학번 — 교양 25 vs 0(#260 [2026] 1)',
    input: { department: '한의학과', admissionYear: 2026, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    question: '한의학과 교양 몇 학점 들어야 해?', graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: '2026 총괄표 대조에서 책자와 도구 값 불일치 — 학교 확인 전',
  },
  {
    id: 'E17', title: '의생명공학계열 2026학번 — 자유선택 33→21(#260 [2026] 1)',
    input: { department: '의생명공학계열', admissionYear: 2026, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    graduation: { confidence: 'ESTIMATED', holdFlag: true },
    why: '#260 [2026] 1 표의 의생명공학계열 항목',
  },
  {
    id: 'E18', title: '탄소융합공학과 2021학번 — 2022 과목 누락·이름 차이(N-1)',
    input: { department: '탄소융합공학과', admissionYear: 2021, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'] },
    question: '창업현장실습 없어졌어? 안 들어도 돼?',
    why: 'N-1: 2022 JSON에 376046 창업현장실습 없음(책자에는 있음) → 2022 "폐설"이 전사 누락일 수 있음',
  },
  {
    id: 'E19', title: '인공지능융합학과 2022학번 편입 — 편입 최소전공 행 없음(N-5)',
    input: { department: '인공지능융합학과', admissionYear: 2022, enrollmentType: 'TRANSFER_ADMISSION' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['MAJOR_RELAXATION_ROW_MISSING', 'DATA_PENDING_HOLD', 'TRANSFER_TOTAL_UNRESOLVED'] },
    question: '편입생은 전공 몇 학점 들어야 돼?',
    why: 'N-5 총괄표에 최소전공(54)이 있는데 시드에 편입 행 없음 + 편입 학년·학번 기준 미확인(RULE_AUDIT D-4)',
  },

  // --- 규정 해석이 확정되지 않은 경우(RULE_AUDIT D절, DECISIONS D-28) ---
  {
    id: 'E20', title: '컴소공 2021학번, 2022-1학기 2학년 전과 — 교양 29학점 고정 갈래',
    input: { department: '컴퓨터·소프트웨어공학과', admissionYear: 2021, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 2, year: 2022, semester: 1 } },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['HISTORY_NOT_VERIFIED'], notFlags: ['LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS'] },
    question: '전과했는데 교양 몇 학점 들어야 해?', graduation: { total: 136, confidence: 'ESTIMATED' },
    why: 'D-52: 교양 29학점 컷오프 기준은 학교 전과 안내(10항 "2022-1학기 전과생까지")로 전과 시점이 확정됨. 신뢰도가 낮은 이유는 컴소공 C등급 구간(HISTORY_NOT_VERIFIED). 총량 136은 D-07(재배분)',
  },
  {
    id: 'E21', title: '컴소공 2022학번, 2024-2학기 3학년 전과 — 최소전공 완화',
    input: { department: '컴퓨터·소프트웨어공학과', admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2024, semester: 2 } },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, flags: ['HISTORY_NOT_VERIFIED'] },
    graduation: { total: 136, confidence: 'CONFIRMED' },
    why: '요건(전공 완화, 시행규칙 제8조①)은 확정이지만 컴소공 2022 과목 자료 C → 과목 경과조치는 자료 불충분',
  },
  {
    id: 'E22', title: '컴소공 2023학번 편입 — 편입 학년·총학점 미확정',
    input: { department: '컴퓨터·소프트웨어공학과', admissionYear: 2023, enrollmentType: 'TRANSFER_ADMISSION' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['TRANSFER_GRADE_ASSUMED', 'TRANSFER_TOTAL_UNRESOLVED'] },
    question: '편입생 졸업까지 몇 학점 남았어?', graduation: { confidence: 'ESTIMATED', totalDefinitive: false },
    why: 'RULE_AUDIT D-4: 편입생 적용 학번·총학점 미확인, 편입 학년 미저장(3학년 가정)',
  },
  {
    id: 'E23', title: '원예산업학과 2023학번 — 제13조③ "재학 중인 학년" 해석에 따라 결과가 갈리는 과목',
    input: { department: '원예산업학과', admissionYear: 2023, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['TRANSITION_GRADE_BASIS_AMBIGUOUS', 'LINEAGE_NAME_MATCH'], rules: { ENF13_3_ELECTIVE_TO_REQUIRED_LOWER_GRADE: 'APPLIES', ENF14_1_REORG_EQUIVALENT_COURSES: 'APPLIES' } },
    question: '선택과목이 필수로 바뀌었는데 나도 들어야 해?',
    why: 'DECISIONS D-28: 개편 시점 학년 vs 기준일 학년 — 원문에 없음. 농생명바이오계열 개편(이름 일치 계보)',
  },
  {
    id: 'E24', title: '간호학과 2021학번 — 교양 52학점 상한 없음(2022.3.1. 입학자부터 적용)',
    input: { department: '간호학과', admissionYear: 2021, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['LIBERAL_CAP_PRE_2022_ARTICLE_SILENT'] },
    question: '교양 52학점 넘게 들으면 졸업학점에 안 들어가?', graduation: { total: 140, confidence: 'ESTIMATED', liberalCapApplied: null },
    why: 'D-51: 학교 홈페이지(학사학위수여)와 2026 책자가 "2022년 3월 1일 입학자부터 52학점"으로 일치 → 2021학번 이하 상한 없음(진단도 동일). 신뢰도가 추정인 이유는 상한이 아니라 다른 플래그(별표 4 불일치 등)',
  },
  {
    id: 'E25', title: '컴소공 2022학번 — 2026 공학3계열 개편(제14조)',
    input: { department: '컴퓨터·소프트웨어공학과', admissionYear: 2022, enrollmentType: 'GENERAL' },
    expected: { confidence: 'INSUFFICIENT', review: NEEDS_HUMAN_REVIEW, rules: { ENF14_1_REORG_EQUIVALENT_COURSES: 'APPLIES', ENF14_2_REORG_KEEP_OLD_CURRICULUM: 'APPLIES', ENF15_EQUIVALENT_COURSE_DESIGNATION: 'UNKNOWN' }, flags: ['EQUIVALENCE_LIST_NOT_HELD'] },
    question: '학과가 공학3계열로 바뀌면 내 전공과목은 어떻게 인정돼?',
    why: '제14조는 재량("할 수 있다"), 동일과목 지정 목록 미보유, 소속변경 여부 미확인(RULE_AUDIT D-2)',
  },
  {
    id: 'E26', title: '작업치료학과 2024학번 전과 — 이 학과로의 전과는 2026 입학생부터(시행규칙 부칙)',
    input: { department: '작업치료학과', admissionYear: 2024, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 2, year: 2025, semester: 1 } },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, rules: { ENF_ADD_20260205_MAJOR_CHANGE_OT_EMT: 'NOT_APPLICABLE' }, ruleFlags: { ENF_ADD_20260205_MAJOR_CHANGE_OT_EMT: ['MAJOR_CHANGE_TARGET_NOT_ALLOWED_FOR_COHORT'] } },
    why: '부칙(2026.02.05.) 제2조: 2026.3.1. 입학생부터 — 2024학번의 이 학과 전과 기록은 입력 오류이거나 다른 경로(학교 확인)',
  },

  // --- 학칙 [별표 4] 졸업학점 ↔ 책자 불일치(보정 라운드 A, D-34) — 숫자는 그대로, 신뢰도만 추정 + 두 값 표시 ---
  {
    id: 'E31', title: '간호학과 2023학번 — 학칙 [별표 4] ③은 130학점, 책자는 140학점',
    input: { department: '간호학과', admissionYear: 2023, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['SCHEDULE4_CREDIT_MISMATCH'], rules: { ACAD_SCHED4_3_2013_2024: 'APPLIES' }, ruleFlags: { ACAD_SCHED4_3_2013_2024: ['SCHEDULE4_CREDIT_MISMATCH'] } },
    question: '졸업하려면 몇 학점이야?', graduation: { total: 140, confidence: 'ESTIMATED', schedule4: [130, 140] },
    why: 'FINAL_REVIEW F-1: 원본 HWPX [별표 4] ③ 130학점 칸에 간호학과, 책자 총괄표 140. 어느 쪽이 맞는지는 학교 확인(숫자는 바꾸지 않음)',
  },
  {
    id: 'E32', title: '작업치료학과 2022학번 — [별표 4] ③ 130 vs 책자 140',
    input: { department: '작업치료학과', admissionYear: 2022, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['SCHEDULE4_CREDIT_MISMATCH'] },
    graduation: { total: 140, confidence: 'ESTIMATED', schedule4: [130, 140] },
    why: '[별표 4] ③ 130학점 칸에 작업치료학과(2017~2024학번 책자는 140). 2025학번부터는 책자도 130으로 일치',
  },
  {
    id: 'E33', title: '약학과 2022학번 — [별표 4] ③ 232(6년제)와 요건 데이터 일치(책자 총괄표 인쇄 240은 오기)',
    input: { department: '약학과', admissionYear: 2022, enrollmentType: 'GENERAL' },
    expected: { confidence: 'ESTIMATED', review: NEEDS_HUMAN_REVIEW, flags: ['DATA_PENDING_HOLD'], notFlags: ['SCHEDULE4_CREDIT_MISMATCH'] },
    question: '약학과 졸업학점 몇이야?', graduation: { total: 232, confidence: 'CONFIRMED' },
    why: 'D-53: [별표 4] ③·학교 홈페이지(학사학위수여 "232학점이상 2022학번~ 약학과(6년제)")가 232 → 요건 데이터를 232(전공 207)로 정정. 2022 책자 총괄표 인쇄 240은 오기로 봄. 신뢰도 추정은 과목 자료 B등급·판단 보류 때문',
  },

  // --- 자료 없음 ---
  {
    id: 'E27', title: '공학3계열 2027학번 — 최신 자료(2026) 이후 학번',
    input: { department: '공학3계열', admissionYear: 2027, enrollmentType: 'GENERAL', asOfDate: '2027-04-01' },
    expected: { confidence: 'NO_DATA', flags: ['COHORT_BEYOND_LATEST_DATA'], rules: { ACAD_ADD_20260410_SCHED1_FROM_2027: 'APPLIES' } },
    question: '내 졸업요건 알려줘', graduation: { total: 0, confidence: 'NO_DATA' },
    why: '2027학번부터 학과·계열 개편(학칙 부칙 2026.04.10. 제2조①) — 2027 교육과정 자료 없음, 2026 값을 외삽하지 않음',
  },
  {
    id: 'E28', title: '경영학과 2016학번 — 지원 범위(2017학번~) 밖',
    input: { department: '경영학과', admissionYear: 2016, enrollmentType: 'GENERAL' },
    expected: { confidence: 'NO_DATA', flags: ['ADMISSION_YEAR_UNSUPPORTED'] },
    question: '졸업요건 알려줘', graduation: { total: 0, confidence: 'NO_DATA' },
    why: 'docs/regulations 총괄표 7절: 2017학번 이상만 지원',
  },
  {
    id: 'E29', title: '공학3계열 2018학번 — 그 학번에 학과가 없음',
    input: { department: '공학3계열', admissionYear: 2018, enrollmentType: 'GENERAL' },
    expected: { confidence: 'NO_DATA', flags: ['NO_CURRICULUM_ROWS', 'DEPARTMENT_IS_SUCCESSOR_OF_COHORT'] },
    question: '졸업학점 몇이야?', graduation: { total: 0, confidence: 'NO_DATA' },
    why: '공학3계열은 2026학번부터. 다른 학과(컴소공) 값으로 대신 단정하지 않음',
  },
  {
    id: 'E30', title: '없는 학과 — 판단 대상 없음',
    input: { department: '없는학과', admissionYear: 2023, enrollmentType: 'GENERAL' },
    expected: { confidence: 'NO_DATA', flags: ['DEPARTMENT_NOT_FOUND'] },
    why: '학과를 모르면 어느 규정도 단정하지 않음(챗봇은 판단 청크 자체를 넣지 않음)',
  },
];

module.exports = { SCENARIOS, NEEDS_HUMAN_REVIEW };
