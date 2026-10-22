/**
 * server/services/nicknamePolicy.js
 * 닉네임으로 다른 사람에게 혼선을 주는 것을 막는 규칙(2026-10-22 피드백 — "가능한 넓게").
 * 커뮤니티 글·신청·신고 화면에서 닉네임만 보고 상대를 판단하므로, 아래처럼 보이는 닉네임은 쓸 수 없게 한다.
 *  1. 쓸 수 있는 글자: 한글·영어·숫자·한자·일본어 가나와 공백 · - _ . 만. 키릴·그리스 문자처럼 영어와 똑같이 생긴 글자,
 *     보이지 않는 글자, 기호·이모지로 겉보기만 같은 닉네임을 만들 수 없게 한다(전각 글자는 NFKC로 반각으로 바꿔 본다).
 *  2. 운영·학교·학과 사칭: "관리자1", "학과관리자", "adm1n", "학사지원과", "김교수"처럼 운영진·교직원·학교 부서로 보이는 이름.
 *  3. 화면 문구·자동 이름 사칭: "user12"(닉네임 미설정 계정 표시), "탈퇴한 사용자", "익명", "작성자", 숫자만(학번처럼 보임).
 *  4. 연락처·링크처럼 보이는 이름: 이메일·전화번호·URL — 서비스 밖으로 연락을 유도하거나 공식 연락처로 오인하게 한다.
 *  5. 다른 학생 닉네임과 헷갈리는 이름: 대소문자·공백·기호·비슷한 글자(I·l·1, O·0)만 다른 닉네임(nicknameKey가 같으면 같은 닉네임으로 본다).
 * 학과 이름 그대로인 닉네임은 DB의 학과 목록과 비교해야 해서 호출부(routes/me.js)가 따로 본다.
 * 이미 저장된 닉네임은 바꾸지 않는다 — 닉네임을 새로 정하거나 바꿀 때만 검사한다.
 */

const ALLOWED_CHARS = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9一-鿿぀-ゟ゠-ヿ _.\-]+$/;
// 비교할 때 무시하는 구분 기호. "·"는 닉네임에 쓸 수 없지만 학과 이름(컴퓨터·소프트웨어공학과)과 비교할 때 필요하다.
const SEPARATORS = /[\s_.\-·]+/g;

// 영어 예약어를 숫자·기호로 바꿔 쓰는 경우(adm1n, 0wner, $taff)와 생김새가 같은 글자(I·l·1, O·0)를 한 글자로 모은다.
const LOOKALIKE = { 0: 'o', 1: 'i', l: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };

/** 비교용 열쇠 — 보이는 모양이 같으면 같은 값이 되게 줄인다. 저장값은 바꾸지 않는다. */
function nicknameKey(name) {
  return String(name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(SEPARATORS, '')
    .replace(/[0134578l]/g, (c) => LOOKALIKE[c]);
}

// 이 말이 닉네임 어디에든 들어 있으면 막는다(nicknameKey 기준). 운영진·교직원·학교 부서·서비스 이름처럼 일반 닉네임에 쓸 일이 거의 없는 말.
const CONTAINS_BLOCKED = [
  'admin', 'moderator', 'onestudent', 'official', 'helpdesk', 'chatbot', 'wku',
  '관리자', '운영자', '운영진', '운영팀', '관리팀', '개발자', '개발팀', '원스튜던트', '고객센터', '헬프데스크', '챗봇',
  '원광대', '학사지원', '교육혁신', '교무처', '학생처', '학생지원', '입학처', '장학팀', '사무실', '교학과',
  '총장', '학장', '학과장', '처장', '교수', '조교', '교직원', '총학생회', '학생회', '과대표',
  '탈퇴', '삭제된', '알수없', '공지사항',
].map(nicknameKey);

// 이 말과 똑같으면 막는다. 일부만 들어간 닉네임은 흔해서(예: "공지영", "ecosystem") 통째로 같을 때만 본다.
const EXACT_BLOCKED = [
  'system', '시스템', 'root', 'bot', 'mod', 'owner', 'master', '마스터', 'manager', '매니저', 'staff', '스태프', 'support',
  'help', 'dev', 'developer', 'team', '공지', 'notice', '알림', '안내', '공식', '운영', '관리',
  '익명', 'anonymous', 'unknown', 'guest', '손님', 'null', 'undefined', 'nan', 'test', '테스트',
  '나', 'me', '글쓴이', '작성자', '신청자', '사용자', '회원', '학생', '선생님', '교직', '학교', '학과', '대학교',
].map(nicknameKey);

// 자동 배정 이름(user{id})과 그 변형 — "user 12", "us3r12", "유저12", "사용자12", "회원12".
const AUTO_NAME = /^(user|유저|사용자|회원|학생|member)\d+$/;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /(https?:|www\.|\.(com|net|org|kr|io|me|co|ac)(\b|$))/i;

/**
 * 문제가 있으면 오류 코드를, 괜찮으면 null.
 * INVALID_NAME — 쓸 수 없는 글자, RESERVED_NAME — 운영·학교·화면 문구·자동 이름 사칭, NAME_CONTACT_INFO — 연락처·링크처럼 보임.
 */
function checkNicknamePolicy(name) {
  const normalized = String(name).normalize('NFKC').trim();
  // 연락처 모양을 글자 검사보다 먼저 본다 — "@"·":"는 허용 글자가 아니어서 순서가 바뀌면 이유를 "쓸 수 없는 글자"로 잘못 알린다.
  if (EMAIL.test(normalized) || URL_LIKE.test(normalized)) return 'NAME_CONTACT_INFO';
  if (!ALLOWED_CHARS.test(normalized)) return 'INVALID_NAME';
  const digits = normalized.replace(/\D/g, '');
  // 숫자만인 닉네임은 학번처럼 보이고, 숫자가 8개 이상이면 전화번호·학번을 담은 것으로 본다.
  if (/^[\d\s_.\-]+$/.test(normalized)) return 'RESERVED_NAME';
  if (digits.length >= 8) return 'NAME_CONTACT_INFO';

  const compact = normalized.toLowerCase().replace(SEPARATORS, '');
  if (AUTO_NAME.test(compact)) return 'RESERVED_NAME';
  const key = nicknameKey(normalized);
  if (AUTO_NAME.test(key.replace(/o/g, '0').replace(/i/g, '1'))) return 'RESERVED_NAME';
  if (EXACT_BLOCKED.includes(key)) return 'RESERVED_NAME';
  if (CONTAINS_BLOCKED.some((word) => key.includes(word))) return 'RESERVED_NAME';
  return null;
}

module.exports = { checkNicknamePolicy, nicknameKey };
