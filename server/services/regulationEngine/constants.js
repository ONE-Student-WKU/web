/**
 * server/services/regulationEngine/constants.js
 * 규정 판단 엔진이 공유하는 상수: 신뢰도 단계, 근거(citation) 레지스트리, 규정 문서 버전 정보.
 *
 * 왜 근거를 코드에 "레지스트리"로 두는가: 판단 결과마다 "어느 조문/책자 문구에 근거했는지"를 내려줘야 하는데,
 * 조문 번호를 코드 곳곳에 문자열로 흩어 쓰면 오타나 잘못된 인용이 조용히 섞인다. 한 곳에 모으고
 * quote(원문 일부)를 같이 적어두면, 테스트(regulationEngine.citations.test.js)가 그 문장이 실제 원문 파일에
 * 존재하는지 기계적으로 검사한다 — "규정 내용을 만들어내지 않는다"를 사람의 주의가 아니라 테스트로 지킨다.
 */

// 신뢰도: 확정 / 추정 / 자료 불충분 / 자료없음. 숫자가 클수록 나쁘다(여러 근거를 합칠 때 가장 나쁜 쪽을 따른다).
// INSUFFICIENT(파트 2 추가): 자료는 있지만 검수 등급 C(미검증·오염 의심)라 값을 그대로 믿으면 안 되는 경우.
// "자료없음"과 나눈 이유 — 값을 보여주되 "확인 필요"로 표시할 수 있어야 하고, 아예 없는 것과는 안내 문구가 달라서.
const CONFIDENCE = Object.freeze({ CONFIRMED: 'CONFIRMED', ESTIMATED: 'ESTIMATED', INSUFFICIENT: 'INSUFFICIENT', NO_DATA: 'NO_DATA' });
const CONFIDENCE_RANK = Object.freeze({ CONFIRMED: 0, ESTIMATED: 1, INSUFFICIENT: 2, NO_DATA: 3 });
const CONFIDENCE_LABEL_KO = Object.freeze({ CONFIRMED: '확정', ESTIMATED: '추정', INSUFFICIENT: '자료 불충분(확인 필요)', NO_DATA: '자료없음' });

// 플래그 level: 신뢰도를 낮추는 ESTIMATED/INSUFFICIENT/NO_DATA, 낮추지 않고 알리기만 하는 INFO.
const FLAG_LEVEL = Object.freeze({ INFO: 'INFO', ESTIMATED: 'ESTIMATED', INSUFFICIENT: 'INSUFFICIENT', NO_DATA: 'NO_DATA' });

const ENROLLMENT_TYPES = Object.freeze(['GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE']);

// 지원하는 가장 이른 학번. docs/regulations 총괄표 7절 — "2017학번 이상만 정식 지원, 이하는 무시"(2026-08-11 결정).
const MIN_SUPPORTED_ADMISSION_YEAR = 2017;

// 전과생 교양 고정학점 컷오프(전과 시점이 2022학년도 2학기 "이전"이면 교양필수 5 + 교양선택 24 = 29 고정).
// graduationService.js의 MAJOR_CHANGE_LIBERAL_ARTS_CUTOFF/FIXED와 같은 값이다(패리티 테스트가 어긋남을 잡는다).
const LIBERAL_ARTS_CUTOFF = Object.freeze({ year: 2022, semester: 2 });
const LIBERAL_ARTS_FIXED_CREDITS = Object.freeze({ 교양필수: 5, 교양선택: 24 });

// 교양 인정 상한(교양필수+교양선택 합산). graduationService.LIBERAL_ARTS_CREDIT_CAP과 같은 값.
const LIBERAL_ARTS_CREDIT_CAP = 52;
// 책자(2026 교육과정 해설 5절): "2021학번까지는 제한이 없고, 2022학번부터는 52학점".
const LIBERAL_ARTS_CAP_FIRST_COHORT = 2022;

// 4학년 편입생 최소전공 인정학점(학칙시행규칙 제6조③). 학과/계열과 무관한 고정값이다.
const TRANSFER_4TH_YEAR_MAJOR_MINIMUM = 21;
// 정원내 학사 편입 학년은 3학년이 원칙(학칙 제36조②). 편입 학년을 모를 때의 기본 가정.
const DEFAULT_TRANSFER_GRADE = 3;

/**
 * 우리 레포가 "원문"으로 보유한 규정 문서와 그 버전 정보.
 * - file: 레포 루트 기준 경로(citations 테스트가 읽는다)
 * - heldVersionEffective: 이 파일이 담고 있는 판본의 시행일. 이보다 이른 기준일의 조문은 레포에 없다.
 * - amendments: 개정 이력 중 레포 원문 부칙/표지에서 확인되는 시행일(오름차순). 중간 판본 본문은 없고 "최종본"만 있다.
 * 여기에 적힌 날짜는 전부 원문 파일에서 직접 읽은 값이다(2026-10-05 확인). 모르는 날짜는 적지 않는다.
 */
const TEXT_SOURCES = Object.freeze({
  ACADEMIC_REGULATIONS: {
    title: '원광대학교 학칙',
    file: 'db/regulations/_source/원광대학교_학칙_전문.txt',
    // 부칙(2026.02.05.) 제1조: 2026-02-05부터 시행(전부개정). 부칙(2026.04.10.), 부칙(2026.06.26.)은 이후 일부개정.
    firstHeldEffective: '2026-02-05',
    latestHeldEffective: '2026-06-26',
    amendments: ['2026-02-05', '2026-04-10', '2026-06-26'],
  },
  ENFORCEMENT_RULES: {
    title: '원광대학교 학칙시행규칙',
    file: 'db/regulations/_source/원광대학교_학칙시행규칙_전문.txt',
    // 부칙(2026.02.05.) 제1조: "본 시행규칙은 2026년 3월 1일부터 시행한다"(전부개정본). 이후 2026-04-10, 2026-06-26 일부개정.
    firstHeldEffective: '2026-03-01',
    latestHeldEffective: '2026-06-26',
    amendments: ['2026-03-01', '2026-04-10', '2026-06-26'],
  },
});

/**
 * 근거 레지스트리. kind: ARTICLE(규정 조문) | BOOKLET(교육과정 책자 문구) | CASE(실제 학교 안내 사례) | CONVENTION(앱의 가정).
 * quote는 CITATION 테스트가 file 원문에서 찾는 문장(공백 무시)이다. CASE/CONVENTION은 원문 파일이 없어 quote를 두지 않는다.
 */
const CITATIONS = Object.freeze({
  ENF_ART5_COHORT_BASIS: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제5조',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '교육과정은 입학 당시의 기준에 따라 이수하되',
  },
  ENF_ART6_1_MIN_MAJOR: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제6조 제1항 제4호',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '자연계열, 공학계열 및 예·체능계열: 48학점',
  },
  ENF_ART6_3_TRANSFER_4TH: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제6조 제3항',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '4학년 편입 학생의 최소전공 인정학점은 21학점으로 한다',
  },
  ENF_ART8_1_RELAXATION: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제8조 제1항',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '전과(부)생(학사과정의 1학년, 2학년 전과 제외), 편입학생(2학년 편입학 제외), 복수전공 이수학생은 전공 교육과정 이수 시 최소전공 인정학점 이상을 이수하여야 한다',
  },
  ENF_ART8_2_EXCLUDED: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제8조 제2항',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '학사과정의 1·2학년 전과(부)생, 학사과정의 2학년 편입학생의 경우 제1항의 기준을 적용하지 않는다',
  },
  ENF_ART10_1_LIBERAL_CAP: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제10조 제1항',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '교양 교과목 이수학점이 52학점을 초과하는 경우 초과된 학점에 대하여는 졸업학점으로 인정하지 아니한다',
  },
  ENF_ART10_2_TRANSFER_LIBERAL: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제10조 제2항',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '편입학생(1·2학년 편입학 제외)은 “종교와 원불교”를 제외한 영역별 교양 이수기준을 충족한 것으로 본다',
  },
  ENF_ART13_TRANSITION: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제13조',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '교육과정의 개편으로 필수과목이 선택과목으로 변경되었거나 폐설된 경우 이수하지 않아도 된다',
  },
  ENF_ART116_MAJOR_CHANGE: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제116조 제1항',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '전과(부)생의 교육과정 이수는 본 시행규칙 제8조 및 제10조에 따른다',
  },
  ENF_ART118_COHORT_TRANSITION: {
    kind: 'ARTICLE', doc: '학칙시행규칙', article: '제118조 제1항 제2호',
    file: TEXT_SOURCES.ENFORCEMENT_RULES.file,
    quote: '학번별 경과조치는 「원광대학교 학칙」의 부칙을 따른다',
  },
  ACAD_ART22_SEMESTER: {
    kind: 'ARTICLE', doc: '학칙', article: '제22조',
    file: TEXT_SOURCES.ACADEMIC_REGULATIONS.file,
    quote: '제1학기: 3월 1일부터 8월 31일까지',
  },
  ACAD_ART36_2_TRANSFER_GRADE: {
    kind: 'ARTICLE', doc: '학칙', article: '제36조 제2항',
    file: TEXT_SOURCES.ACADEMIC_REGULATIONS.file,
    quote: '정원내편입학 학년은 3학년(의학과, 치의학과, 한의학과는 1학년)을 원칙으로 하며',
  },
  ACAD_ADDENDUM_2026_02_05_ART3: {
    kind: 'ARTICLE', doc: '학칙 부칙(2026.02.05.)', article: '제3조',
    file: TEXT_SOURCES.ACADEMIC_REGULATIONS.file,
    quote: '종전 2025년 8월 29일자 학칙의 부칙에 정한 경과조치를 적용한다',
  },
  ACAD_ADDENDUM_2026_04_10_ART2_REORG_2027: {
    kind: 'ARTICLE', doc: '학칙 부칙(2026.04.10.)', article: '제2조 제1항',
    file: TEXT_SOURCES.ACADEMIC_REGULATIONS.file,
    quote: '[별표 1] 학과(부), 전공 및 광역계열 입학정원(2027학년도 이후)은 2027년 3월 1일 입학자부터 적용한다',
  },
  BOOKLET_2026_LIBERAL_CAP: {
    kind: 'BOOKLET', doc: '2026학년도 교육과정 책자(해설)', article: '30쪽 교양 이수학점 상한',
    file: 'db/regulations/교육과정/2026_교육과정_해설.md',
    quote: '교양제한학점: 2021학번까지는 제한이 없고, **2022학번부터는 52학점**까지 인정한다',
  },
  BOOKLET_2026_RESTRUCTURING_LIBERAL: {
    kind: 'BOOKLET', doc: '2026학년도 교육과정 책자(해설)', article: '소속변경 학생 안내',
    file: 'db/regulations/교육과정/2026_교육과정_해설.md',
    quote: '학사구조조정이 2022학년도 2학기 이전에 이루어진 경우 교양필수 5학점, 교양선택 24학점(영역 구분 없음)을 이수한다',
  },
  CASE_MAJOR_CHANGE_AFTER_CUTOFF: {
    kind: 'CASE', doc: '학교(학사지원과) 안내 사례',
    article: '2022학번이 2025-2학기에 전과 → 교양필수5+교양선택34(=39학점), 학사지원과 회신으로 정상 적용 확인',
    ref: 'db/regulations/전공선택/전과.md 10절',
  },
  BOOKLET_ROWS: {
    kind: 'BOOKLET', doc: '학년도별 교육과정 책자 이수학점 총괄표(curriculum_requirements 시드)',
    article: '학과·학번 범위별 졸업요건 행',
    ref: 'db/seed/curriculum_requirements.json',
  },
});

module.exports = {
  CONFIDENCE,
  CONFIDENCE_RANK,
  CONFIDENCE_LABEL_KO,
  FLAG_LEVEL,
  ENROLLMENT_TYPES,
  MIN_SUPPORTED_ADMISSION_YEAR,
  LIBERAL_ARTS_CUTOFF,
  LIBERAL_ARTS_FIXED_CREDITS,
  LIBERAL_ARTS_CREDIT_CAP,
  LIBERAL_ARTS_CAP_FIRST_COHORT,
  TRANSFER_4TH_YEAR_MAJOR_MINIMUM,
  DEFAULT_TRANSFER_GRADE,
  TEXT_SOURCES,
  CITATIONS,
};
