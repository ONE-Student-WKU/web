/**
 * server/services/courseNameMatch.js
 * 과목명 표기 차이를 흡수해서 같은 과목인지 비교한다(순수 함수). 졸업요건 진단(graduationService)과
 * 챗봇의 "개설 − 이수" 근거(curriculumService)가 같은 기준을 쓰도록 한 곳에 둔다.
 */

// curriculum_required_courses(학과 문서 기준 요구과목명)와 course_offerings(실제 개설과목
// 카탈로그) 표기가 구두점만 다른 경우가 있다 — 예: "졸업(시험·작품)논문"(가운뎃점, 학과
// 문서) vs "졸업(시험.작품)논문"(마침표, 카탈로그. 학생이 카탈로그에서 선택하면 이 표기가
// 그대로 student_courses.name에 저장됨). SQL 완전일치로는 두 표기가 영원히 안 맞는다 —
// 구두점·공백을 지우고 비교해 표기 차이를 흡수한다.
function normalizeCourseName(name) {
  return name.replace(/[·.,\s]/g, '');
}

// "기업연계프로젝트2(종합설계2)"처럼 뒤에 괄호로 옛 과목명/별칭을 병기하는 요구과목이 있다
// (학칙 원문 자체가 두 이름을 병기 — db/seed/curriculum_requirements.json 165행 note 참고).
// 학생이 직접입력으로 등록할 때 괄호 안쪽 별칭을 안 쓰고 "기업연계프로젝트2"까지만 적어도
// (실사용 확인 — 카탈로그에 해당 학기 항목이 안 잡혀 직접입력으로 우회한 경우) 똑같은
// 과목으로 인정해야 한다. 괄호를 통째로 지우는 게 아니라 "끝에 붙은 괄호"만 벗겨서 별도
// 변형으로 추가하는 이유: normalizeCourseName처럼 무조건 괄호를 지워버리면 "건학이념"/
// "대학생활"같이 부분 문자열로 흔한 다른 과목명(예: "대학생활과자기혁신")과 뒤섞일 위험이
// 있는 임의 부분일치보다, 요구과목명 쪽에서 "알려진 표기 변형"만 명시적으로 허용하는 편이
// 안전하다.
// 임의 약칭까지 다 받아주진 않는다(위 주석 참고 — 부분일치는 다른 과목과 오매칭 위험).
// 대신 "이 학과 학생들이 실제로 흔히 쓰고, 다른 과목과 헷갈릴 여지가 없는" 약칭만 화이트
// 리스트로 명시 등록한다. 새 약칭이 필요하면 여기 추가할 것 — 요구과목명(정식 표기) 키를
// 정확히 맞춰야 한다(courseNameVariants가 이 목록을 정식 표기 원문 기준으로 조회함).
const KNOWN_COURSE_ALIASES = {
  '기업연계프로젝트1(종합설계1)': ['기연프1'],
  '기업연계프로젝트2(종합설계2)': ['기연프2'],
};

function courseNameVariants(name) {
  const full = normalizeCourseName(name);
  const variants = new Set([full]);

  const withoutTrailingParen = normalizeCourseName(name.replace(/\([^)]*\)\s*$/, ''));
  if (withoutTrailingParen && withoutTrailingParen !== full) variants.add(withoutTrailingParen);

  for (const alias of KNOWN_COURSE_ALIASES[name] || []) variants.add(normalizeCourseName(alias));

  return [...variants];
}

/** 학생이 이수한 과목명들 → 비교용 정규화 이름 집합. */
function buildCompletedNameSet(completedNames) {
  return new Set((completedNames || []).map(normalizeCourseName));
}

/**
 * 개설(정식) 과목명이 이수한 과목 집합에 이미 들어 있나. 정식 표기의 변형(끝 괄호 뗀 이름, 알려진 약칭)으로도 비교한다.
 * 번호가 다른 과목(기업연계프로젝트1 ↔ 2)은 서로 같은 과목으로 보지 않는다.
 */
function isCompleted(courseName, completedNameSet) {
  return courseNameVariants(courseName).some((v) => completedNameSet.has(v));
}

module.exports = { normalizeCourseName, courseNameVariants, KNOWN_COURSE_ALIASES, buildCompletedNameSet, isCompleted };
