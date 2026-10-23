/**
 * server/services/inputValidation.js
 * 라우트 여러 곳(프로필 수정, 온보딩)이 같이 쓰는 입력값 검사. 값이 "문자열/숫자 하나"인지, 범위 안인지를 본다.
 * 타입을 안 보고 DB에 넘기면 배열·객체가 mysql2에서 SQL 조각으로 펼쳐져 500 오류나 의도하지 않은 쿼리가 된다.
 */

const { checkNicknamePolicy } = require('./nicknamePolicy');

// 정수(또는 정수 문자열)이고 min~max 범위 안인가. true/null/배열/객체/소수는 거절한다.
function isIntInRange(value, min, max) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= min && value <= max;
  if (typeof value === 'string') return /^\d{1,9}$/.test(value) && Number(value) >= min && Number(value) <= max;
  return false;
}

// 학번(입학년도). 우리 교육과정 자료는 2017학번 이후지만 그 전 학번 계정도 있을 수 있어 넉넉하게 열어 두고, 터무니없는 값만 거른다.
function isValidAdmissionYear(value) {
  return isIntInRange(value, 1990, new Date().getFullYear() + 1);
}

const NICKNAME_MAX_LENGTH = 50; // students.name VARCHAR(50)

// 문제가 있으면 오류 코드를, 괜찮으면 null을 돌려준다. 호출부가 name이 문자열임을 먼저 확인한다.
// 혼선을 주는 닉네임(보이지 않는·비슷하게 생긴 글자, 운영·학교 사칭, 자동 이름, 연락처 모양) 규칙은 nicknamePolicy.js 한곳에 둔다.
// 학과 이름과 같은지, 다른 학생 닉네임과 헷갈리는지는 DB를 봐야 해서 호출부(routes/me.js)가 따로 본다.
function validateNickname(name) {
  const trimmed = name.trim();
  if ([...trimmed].length > NICKNAME_MAX_LENGTH) return 'NAME_TOO_LONG';
  return checkNicknamePolicy(trimmed);
}

// 과목 학점 — 0~9.5, 0.5 단위. student_courses.credits는 DECIMAL(2,1)이라 2.3 같은 값도 저장은 되지만 학교 과목 학점은
// 전부 0.5 단위다(교육과정 자료의 학점은 0·0.5·1·1.5·2·3…뿐). 화면 입력 칸은 이미 0.5 단위만 받는다.
// 0은 졸업논문 등 P/F 과목이라 유효하다. 객체·배열·불리언은 SQL 조각으로 펼쳐질 수 있어 거절한다.
function isValidCredits(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const credits = Number(value);
  return Number.isFinite(credits) && credits >= 0 && credits <= 9.5 && Number.isInteger(credits * 2);
}

module.exports = { isIntInRange, isValidAdmissionYear, isValidCredits, validateNickname, NICKNAME_MAX_LENGTH };
