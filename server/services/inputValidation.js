/**
 * server/services/inputValidation.js
 * 라우트 여러 곳(프로필 수정, 온보딩)이 같이 쓰는 입력값 검사. 값이 "문자열/숫자 하나"인지, 범위 안인지를 본다.
 * 타입을 안 보고 DB에 넘기면 배열·객체가 mysql2에서 SQL 조각으로 펼쳐져 500 오류나 의도하지 않은 쿼리가 된다.
 */

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

// 제어문자·보이지 않는 글자(너비 0 공백, 방향 제어 등)는 겉보기에 같은 닉네임을 만들거나 "user12" 예약어 검사를 피하는 데 쓸 수 있다.
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARS = new RegExp(
  '[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\u3164\ufeff\ufff9-\ufffb]'
);

// 운영자를 사칭하기 쉬운 이름 — 커뮤니티 글·신청에서 운영진이 쓴 것처럼 보이게 하는 데 쓰인다. 공백/대소문자는 무시하고 비교한다.
const RESERVED_NICKNAMES = ['admin', 'administrator', 'moderator', 'system', 'onestudent', '관리자', '운영자', '운영진', '시스템', '관리팀', '운영팀'];

// 문제가 있으면 오류 코드를, 괜찮으면 null을 돌려준다. 호출부가 name이 문자열임을 먼저 확인한다.
function validateNickname(name) {
  const trimmed = name.trim();
  if ([...trimmed].length > NICKNAME_MAX_LENGTH) return 'NAME_TOO_LONG';
  if (INVISIBLE_CHARS.test(trimmed)) return 'INVALID_NAME';
  const compact = trimmed.replace(/\s+/g, '').toLowerCase();
  if (RESERVED_NICKNAMES.includes(compact)) return 'INVALID_NAME';
  return null;
}

module.exports = { isIntInRange, isValidAdmissionYear, validateNickname, NICKNAME_MAX_LENGTH };
