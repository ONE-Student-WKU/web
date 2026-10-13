// 온보딩에서 학과별로 고를 수 있는 입학학번 범위.
//
// 서버(studentService.listDepartments)가 범위를 두 벌 내려준다.
//  - core*: 교양·전공 요건 행이 있는 학번. 일반·편입 학생은 이 범위만 고를 수 있다 — 졸업인증제 같은
//    부가 행 때문에 넓어진 범위를 쓰면 전공 요건이 없는 학번이 선택지로 열려 졸업진단이 "진단할 수 없어요"가 된다.
//    (옛 학번 학생은 개편 전 학과 이름으로 들어 있다 — 예: 2020~2022학번 경영학과 학생은 경영학부.)
//  - min/max: 모든 요건 행 기준의 넓은 범위. 전과생용 — 전과생은 입학학번이 새 학과의 요건 시작 학번보다
//    옛날일 수 있다(예: 2021학번이 2024년에 경영학과로 전과).
// core 값이 없으면(요건 행의 학번 값이 모두 비어 있는 학과) 넓은 범위로 되돌린다.
export function getYearRange(department, enrollmentType, nowYear = new Date().getFullYear()) {
  const useCore = enrollmentType !== 'MAJOR_CHANGE';
  const minBound = (useCore ? department.coreMinAdmissionYear : null) ?? department.minAdmissionYear;
  const maxBound = (useCore ? department.coreMaxAdmissionYear : null) ?? department.maxAdmissionYear;
  const min = minBound ?? nowYear - 15;
  let max = maxBound ?? nowYear;
  // 편입생은 기존 학점을 인정받아 들어오는 전형이라 정의상 "계산상 1학년"이 되는 올해
  // 학번으로는 편입할 수 없다 — 그 해는 편입생 기준 학번 범위에서 뺀다.
  if (enrollmentType === 'TRANSFER_ADMISSION') max = Math.min(max, nowYear - 1);
  return { min, max };
}

// 편입생이 고를 수 있는 편입 학년. 1학년 편입은 입력 화면에서 받지 않는다(학칙상 의학계열 예외뿐이고 규정 엔진도 2~4를 쓴다).
export const TRANSFER_GRADES = [2, 3, 4];

// 편입생의 적용 학번 = 편입한 학년의 당초 입학자 학번 = 편입 연도 − 편입 학년 + 1.
// 근거: 교육과정 운영에 관한 규정 제14조③ "편입학생은 편입학한 학년의 입학년도 교육과정을 적용받는다"
// (예: 2026년에 3학년으로 편입 → 2024학번). 값이 없으면 null.
export function transferCohortYear(transferYear, transferGrade) {
  if (!transferYear || !transferGrade) return null;
  return transferYear - transferGrade + 1;
}

// 편입 연도 = 저장된 학번 + 편입 학년 − 1 (transferCohortYear의 역). 옛 방식으로 입력해 편입 학년이 없으면 null.
export function transferYearOf(admissionYear, transferGrade) {
  if (!admissionYear || !transferGrade) return null;
  return admissionYear + transferGrade - 1;
}

// 개편으로 이름이 바뀐 옛 학과에 붙이는 안내 문구. 옛 학번 학생은 옛 이름을 골라야 하는데 학교 공식 소속명과
// 달라 헷갈리지 않게 "이후 학과"를 보여준다. 개편 이력이 이름 유사 추정(confirmed=false)이면 "(추정)"을 붙인다.
// 조사(으로/로)는 받침에 따라 달라 쓰지 않는다. 후속 학과가 없으면 null.
// t(화면 언어 번역 함수)를 넘기면 그 언어로 만들고, 안 넘기면 기존 한국어 문구 그대로다. 학과 이름은 서버 데이터라 번역하지 않는다.
export function describeSuccessors(department, t = null) {
  const successors = department?.successors || [];
  if (successors.length === 0) return null;
  const names = successors.map((s) => s.name).join(', ');
  const confirmed = successors.every((s) => s.confirmed);
  if (t) return t(confirmed ? 'dept.successors' : 'dept.successorsEstimated', { names });
  return `이후 학과${confirmed ? '' : '(추정)'}: ${names}`;
}
