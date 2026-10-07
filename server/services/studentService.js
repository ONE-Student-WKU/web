const pool = require('../db');
const { CURRENT_CONSENT_VERSION } = require('./consent');
const { attachColleges } = require('./departmentColleges');

/**
 * server/services/studentService.js
 * 학생 계정(인증/온보딩) 관련 DB 접근 계층.
 */

// onboarding.js / me.js에서 공통으로 쓰는 검증값 (courseService.VALID_CATEGORIES와 동일한 패턴)
const VALID_ENROLLMENT_TYPES = ['GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE'];
// 화면·챗봇 답변 언어(students.language). client/src/i18n/I18nContext.jsx의 SUPPORTED_LANGUAGES와 같은 코드.
const VALID_LANGUAGES = ['ko', 'en'];
const VALID_MAJOR_CHANGE_GRADES = [1, 2, 3, 4];
const VALID_MAJOR_CHANGE_SEMESTERS = [1, 2];

async function findByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM students WHERE email = ?', [email]);
  return rows[0] || null;
}

// 닉네임 중복 확인용(PATCH /api/me) — students.name의 UNIQUE 제약(db/schema.sql)과 같은
// collation(utf8mb4_unicode_ci, 대소문자 구분 안 함)으로 비교되므로 결과가 서로 일치한다.
async function findByName(name) {
  const [rows] = await pool.query('SELECT id FROM students WHERE name = ?', [name]);
  return rows[0] || null;
}

// 클라이언트에 내려주는 학생 프로필 형태로 변환 — /api/auth/login과 /api/me가 같은
// 모양의 데이터를 줘야 한다(로그인 응답에 departmentId/admissionYear 등이 빠져있으면,
// 그 값을 그대로 믿는 화면(Onboarding.jsx 등)이 이미 등록된 정보를 "선택 필요"로 잘못
// 표시하는 문제가 실사용으로 확인됨 — 로그인 직후 재진입 시 재현).
function serializeStudent(student) {
  return {
    id: student.id,
    // 가입 시 닉네임은 자동 배정하지 않고 name을 NULL로 남겨두므로(2-2 참고), 표시 시점에
    // user{id} 폴백을 계산한다. id는 기본키라 절대 중복이 안 나 별도 카운터/중복체크가 불필요.
    name: student.name || `user${student.id}`,
    // 관리자 페이지 진입점 노출 여부(client/src/components/AccountMenu.jsx)를 클라이언트가
    // 스스로 판단할 수 있어야 해서 포함— 지금까지는 role이 서버 내부(requireAdmin)에서만
    // 쓰이고 클라이언트로 전혀 안 내려가서, 관리자 계정도 "관리자" 메뉴가 안 보이는 문제가
    // 있었음. 실제 권한 검사는 여전히 requireAdmin(server/middleware/auth.js)이 서버에서
    // 매번 다시 하므로, 이 값은 UI 노출용일 뿐 보안 경계가 아니다.
    role: student.role,
    // 계정 삭제 재인증 수단(Google 재로그인 vs 이메일 인증코드) 분기용 — 이메일 OTP로만
    // 가입한 계정은 oauth_id가 항상 NULL(createEmailStudent).
    hasGoogleAccount: !!student.oauth_id,
    department: student.department_name,
    departmentId: student.department_id,
    track: student.track_name,
    trackId: student.track_id,
    onboardingCompleted: !!student.onboarding_completed_at,
    admissionYear: student.admission_year,
    enrollmentType: student.enrollment_type,
    majorChangeGrade: student.major_change_grade,
    majorChangeYear: student.major_change_year,
    majorChangeSemester: student.major_change_semester,
    secondDepartment: student.second_department_name,
    secondDepartmentId: student.second_department_id,
    careerCounselingCount: student.career_counseling_count,
    leaveSemesters: student.leave_semesters,
    // 화면·챗봇 답변 언어. null이면 계정에 저장된 적이 없다는 뜻이라 클라이언트가 브라우저 값을 따른다.
    language: student.language || null,
    // 이용약관·개인정보 수집·이용 동의가 현재 버전으로 돼 있지 않으면 true — 클라이언트가 로그인 직후 동의 화면을 보여준다.
    consentRequired: student.consent_version !== CURRENT_CONSENT_VERSION,
  };
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT s.*, d.name AS department_name, t.name AS track_name, sd.name AS second_department_name
     FROM students s
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN tracks t ON t.id = s.track_id
     LEFT JOIN departments sd ON sd.id = s.second_department_id
     WHERE s.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Google OAuth 등 provider가 발급한 식별자로 계정을 찾는다. provider별로 스코프가 다른
// 식별자라(예: Google sub) 항상 provider+id 쌍으로 조회한다.
async function findByOauth(provider, oauthId) {
  const [rows] = await pool.query(
    'SELECT * FROM students WHERE oauth_provider = ? AND oauth_id = ?',
    [provider, oauthId]
  );
  return rows[0] || null;
}

// OAuth로 처음 로그인한 사용자 신규 생성 — 비밀번호가 없으므로 password는 NULL로 남는다.
// 닉네임은 구글 실명을 가져오지 않고 자동 배정(user{id})하므로 name은 항상 NULL로 INSERT —
// serializeStudent가 표시 시점에 user{id}로 계산해 내려준다.
async function createOauthStudent({ email, provider, oauthId }) {
  const [result] = await pool.query(
    'INSERT INTO students (email, name, oauth_provider, oauth_id) VALUES (?, NULL, ?, ?)',
    [email, provider, oauthId]
  );
  return result.insertId;
}

// 이메일 인증코드(OTP)로 처음 로그인한 사용자 신규 생성 — oauth_provider/oauth_id는 구글
// 전용으로 남겨두고 건드리지 않는다(NULL 유지). 닉네임은 createOauthStudent와 동일하게 자동 배정.
async function createEmailStudent({ email }) {
  const [result] = await pool.query(
    'INSERT INTO students (email, name) VALUES (?, NULL)',
    [email]
  );
  return result.insertId;
}

// 이메일이 일치하는 기존 계정(과거 비밀번호 로그인으로 만들어졌거나 아직 OAuth 미연결인
// 계정)에 OAuth 식별자를 연결(link)한다.
async function linkOauthToStudent(studentId, { provider, oauthId }) {
  await pool.query(
    'UPDATE students SET oauth_provider = ?, oauth_id = ? WHERE id = ?',
    [provider, oauthId, studentId]
  );
}

// 온보딩 화면이 학과별로 실제 입력 가능한 학번 범위를 알아야 해서(예: 컴퓨터·소프트웨어공학과는
// 2017~2025학번만, 공학3계열은 2026학번부터), curriculum_requirements의 공통 요건
// (enrollment_type IS NULL — 전과/편입 특례 행은 학과의 "기본 학번 범위"가 아니므로 제외) 행에서
// 학번 범위를 집계해 함께 내려준다. 프론트에 학번 범위를 하드코딩하지 않기 위함.
//
// 범위를 두 벌 내려준다.
//  - min/maxAdmissionYear: 모든 카테고리 행 기준(졸업인증제·교직 등 부가 행 포함). 전과생용 —
//    전과생은 학번이 새 학과의 요건 시작 학번보다 옛날일 수 있다(예: 2021학번이 2024년에 경영학과로 전과).
//  - coreMin/MaxAdmissionYear: 교양·전공 요건 행 기준. 일반·편입 학생용 — 졸업인증제 행 하나가
//    2020학번부터 일괄로 들어 있어 전공 요건이 2023학번부터인 학과도 2020학번이 선택지로 열리던 문제.
//    규정 엔진이 "자료 있음"으로 보는 기준(evaluate.js CORE_CATEGORIES)과 같다. 핵심 행의 학번 값이
//    모두 NULL이면 NULL(프론트가 기존 범위로 되돌린다).
const CORE_REQUIREMENT_CATEGORIES = ['교양필수', '교양선택', '전공필수', '전공선택', '전공'];

async function listDepartments() {
  const [rows] = await pool.query(
    `SELECT d.id, d.name,
            MIN(cr.min_admission_year) AS min_admission_year,
            MAX(cr.max_admission_year) AS max_admission_year,
            MIN(CASE WHEN cr.category IN (?) THEN cr.min_admission_year END) AS core_min_admission_year,
            MAX(CASE WHEN cr.category IN (?) THEN cr.max_admission_year END) AS core_max_admission_year
     FROM departments d
     LEFT JOIN curriculum_requirements cr ON cr.department_id = d.id AND cr.enrollment_type IS NULL
     GROUP BY d.id, d.name
     ORDER BY d.id`,
    [CORE_REQUIREMENT_CATEGORIES, CORE_REQUIREMENT_CATEGORIES]
  );

  // 개편으로 이름이 바뀐 옛 학과는 "지금은 무슨 학과로 이어졌는지"를 같이 내려준다 — 옛 학번 학생이 옛 이름을
  // 골라야 하는데(요건 범위를 좁힌 결과), 학교 공식 소속명과 달라 헷갈리지 않게 화면이 안내 문구를 붙인다.
  // 개편 이력은 대부분 이름이 비슷해서 이은 추정(NAME_MATCH)이라 confirmed(전부 DOC 근거)도 함께 준다 — 확정이
  // 아니면 화면이 "이어진 것으로 보여요"로 완곡하게 쓴다. 후속 학과가 여럿이면(분리) 이름을 모두 내려준다.
  const [lineageRows] = await pool.query(
    `SELECT dl.from_department_id AS from_id, td.name AS to_name, dl.effective_year, dl.source
     FROM department_lineage dl
     JOIN departments td ON td.id = dl.to_department_id
     WHERE dl.from_department_id IS NOT NULL AND dl.to_department_id <> dl.from_department_id
     ORDER BY dl.effective_year, td.name`
  );
  const successorsByFrom = new Map();
  for (const e of lineageRows) {
    const list = successorsByFrom.get(e.from_id) || [];
    const found = list.find((x) => x.name === e.to_name);
    if (found) found.confirmed = found.confirmed && e.source !== 'NAME_MATCH';
    else list.push({ name: e.to_name, effectiveYear: e.effective_year, confirmed: e.source !== 'NAME_MATCH' });
    successorsByFrom.set(e.from_id, list);
  }

  const departments = rows.map((r) => ({
    id: r.id,
    name: r.name,
    minAdmissionYear: r.min_admission_year,
    maxAdmissionYear: r.max_admission_year,
    coreMinAdmissionYear: r.core_min_admission_year,
    coreMaxAdmissionYear: r.core_max_admission_year,
    successors: successorsByFrom.get(r.id) || [],
  }));
  // 소속 대학(트리 화면용). 학칙 [별표 1] 2026학년도 표 기준이고, 자료를 못 읽으면 college=null로 평평한 목록이 된다.
  return attachColleges(departments);
}

async function findDepartmentById(id) {
  const [rows] = await pool.query('SELECT id, name FROM departments WHERE id = ?', [id]);
  return rows[0] || null;
}

// 광역단위 학과(공학3계열)만 결과가 있고, 그 외 학과는 빈 배열이 정상 응답.
async function listTracks(departmentId) {
  const [rows] = await pool.query('SELECT id, name FROM tracks WHERE department_id = ? ORDER BY id', [departmentId]);
  return rows;
}

async function findTrackById(id) {
  const [rows] = await pool.query('SELECT id, department_id, name FROM tracks WHERE id = ?', [id]);
  return rows[0] || null;
}

async function completeOnboarding(studentId, { departmentId, admissionYear, enrollmentType, trackId, majorChangeGrade, majorChangeYear, majorChangeSemester }) {
  await pool.query(
    `UPDATE students
     SET department_id = ?, admission_year = ?, enrollment_type = ?, track_id = ?, major_change_grade = ?,
         major_change_year = ?, major_change_semester = ?, onboarding_completed_at = NOW()
     WHERE id = ?`,
    [departmentId, admissionYear, enrollmentType, trackId ?? null, majorChangeGrade ?? null,
      majorChangeYear ?? null, majorChangeSemester ?? null, studentId]
  );
}

// 이용약관·개인정보 수집·이용 동의를 기록한다(동의 시각 + 동의한 버전).
async function recordConsent(studentId, version) {
  await pool.query('UPDATE students SET consented_at = NOW(), consent_version = ? WHERE id = ?', [version, studentId]);
}

// 프로필 수정(PATCH /api/me) 전용 — 넘어온 필드만 부분 갱신 (courseService.updateMyCourse와 동일한 패턴)
async function updateProfile(studentId, updates) {
  const columnMap = {
    name: 'name',
    departmentId: 'department_id',
    trackId: 'track_id',
    admissionYear: 'admission_year',
    enrollmentType: 'enrollment_type',
    majorChangeGrade: 'major_change_grade',
    majorChangeYear: 'major_change_year',
    majorChangeSemester: 'major_change_semester',
    secondDepartmentId: 'second_department_id',
    careerCounselingCount: 'career_counseling_count',
    leaveSemesters: 'leave_semesters',
    language: 'language',
  };

  const fields = [];
  const params = [];

  for (const [key, column] of Object.entries(columnMap)) {
    if (updates[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(updates[key]);
    }
  }

  if (fields.length === 0) return;

  params.push(studentId);
  await pool.query(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`, params);
}

// 계정 삭제 — students.id를 참조하는 student_courses/chat_conversations는 스키마에
// ON DELETE CASCADE로 걸려있어(db/schema.sql) 별도 정리 없이 이 한 줄로 연쇄 삭제된다.
async function deleteStudent(studentId) {
  await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
}

// 관리자 대시보드 가입 이메일 수 — 탈퇴 계정은 DELETE로 완전히 지워지는 정책이라
// (deleteStudent) 이 COUNT가 곧 "현재 가입돼 있는 계정 수"와 같다.
async function countAll() {
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM students');
  return count;
}

// 이메일 형식만 맞으면 가입되던 옛 로그인 폼 시절에 만들어진 테스트(가짜) 계정 수 — 개발에 참여한 4명이 그때 가입한 계정을
// 세어 추정한 값이다. 운영 DB에서 계정을 직접 지우는 대신(운영 DB를 건드리는 부담이 크다) 관리자 화면의 "가입 수"에서만 이만큼 뺀다.
// 계정 자체는 그대로 있으므로 countAll()이나 다른 기능에는 영향이 없다. 그 계정들을 정리하면 이 상수는 0으로 바꾸거나 지운다.
const LEGACY_TEST_ACCOUNT_COUNT = 10;

// 관리자 대시보드에 보여줄 "실제 가입 수" = 전체 계정 수 - 옛 테스트 계정 수(0 밑으로는 내려가지 않는다).
function excludeLegacyTestAccounts(total) {
  return Math.max(0, total - LEGACY_TEST_ACCOUNT_COUNT);
}

module.exports = {
  LEGACY_TEST_ACCOUNT_COUNT,
  excludeLegacyTestAccounts,
  VALID_ENROLLMENT_TYPES,
  VALID_MAJOR_CHANGE_GRADES,
  VALID_MAJOR_CHANGE_SEMESTERS,
  VALID_LANGUAGES,
  serializeStudent,
  recordConsent,
  findByEmail,
  findByName,
  findById,
  findByOauth,
  createOauthStudent,
  createEmailStudent,
  linkOauthToStudent,
  listDepartments,
  findDepartmentById,
  listTracks,
  findTrackById,
  completeOnboarding,
  updateProfile,
  deleteStudent,
  countAll,
};
