const pool = require('../db');

/**
 * server/services/curriculumService.js
 * curriculum_courses(학년/학기별 교육과정 편성표)를 조건 조회하는 정형 데이터 계층.
 * RAG 임베딩 검색과 달리 조건에 맞는 행을 빠짐없이 보장한다.
 */

// 하나도 조건이 없으면 테이블 전체가 반환돼버리므로 최소 한 개는 있어야 함.
async function findCourses({ courseName, grade, semester, departmentId, trackId, admissionYear } = {}) {
  const conditions = [];
  const params = [];

  if (courseName) {
    conditions.push('cc.course_name LIKE ?');
    params.push(`%${courseName}%`);
  }
  if (grade) {
    conditions.push('cc.grade = ?');
    params.push(grade);
  }
  if (semester) {
    conditions.push('FIND_IN_SET(?, cc.semester)');
    params.push(semester);
  }
  if (departmentId) {
    conditions.push('cc.department_id = ?');
    params.push(departmentId);
  }
  if (trackId) {
    conditions.push('cc.track_id = ?');
    params.push(trackId);
  }
  if (admissionYear) {
    conditions.push('(cc.min_admission_year IS NULL OR cc.min_admission_year <= ?)');
    conditions.push('(cc.max_admission_year IS NULL OR cc.max_admission_year >= ?)');
    params.push(admissionYear, admissionYear);
  }

  if (conditions.length === 0) return [];

  const [rows] = await pool.query(
    `SELECT cc.grade, cc.semester, cc.category, cc.course_code, cc.course_name, cc.course_name_en,
            cc.credits, cc.remarks, cc.min_admission_year, cc.max_admission_year,
            d.name AS department_name, t.name AS track_name
     FROM curriculum_courses cc
     JOIN departments d ON d.id = cc.department_id
     LEFT JOIN tracks t ON t.id = cc.track_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.name, t.name, cc.grade, cc.semester, cc.category, cc.course_name`,
    params
  );

  return rows.map((r) => ({
    grade: r.grade,
    semester: r.semester,
    category: r.category,
    courseCode: r.course_code,
    courseName: r.course_name,
    courseNameEn: r.course_name_en,
    credits: r.credits,
    remarks: r.remarks,
    minAdmissionYear: r.min_admission_year,
    maxAdmissionYear: r.max_admission_year,
    departmentName: r.department_name,
    trackName: r.track_name,
  }));
}

const GRADE_RE = /(\d)\s*학년|학년[:\s]*(\d)/;
const SEMESTER_RE = /(\d)\s*학기|학기[:\s]*(\d)/;
const ADMISSION_YEAR_RE = /(\d{2,4})\s*학번/;

function extractGradeSemester(text) {
  const g = text.match(GRADE_RE);
  const s = text.match(SEMESTER_RE);
  const grade = g ? Number(g[1] || g[2]) : null;
  const semester = s ? s[1] || s[2] : null;
  return grade && semester ? { grade, semester } : null;
}

// "26학번인데..."처럼 사용자가 채팅에 직접 학번을 말하는 경우를 잡는다. 온보딩을 안 끝낸
// 계정(student.admission_year가 NULL)은 이게 없으면 학번을 전혀 못 읽어서, 구조화 조회
// 대신 AI가 대화 맥락만으로 즉흥적으로 추론하게 되고 그 추론이 불완전한 근거로 이어지는
// 문제가 실측으로 확인됨. 2자리("26")는 이 학교 재학생 학번 범위가 전부 20xx라 2000을 더한다.
function extractAdmissionYear(text) {
  const m = text.match(ADMISSION_YEAR_RE);
  if (!m) return null;
  const raw = m[1];
  if (raw.length === 4) return Number(raw);
  if (raw.length === 2) return 2000 + Number(raw);
  return null;
}

// 메시지 자유 텍스트에서 바로 과목명을 추출하기는 어려우니, DB에 실제로 존재하는 과목명
// 목록을 거꾸로 메시지에 포함되는지 검사한다(옛 COURSE_NAME_RE 정확매칭과 같은 방식).
async function findMentionedCourseNames(message) {
  const [rows] = await pool.query('SELECT DISTINCT course_name FROM curriculum_courses');
  return rows.map((r) => r.course_name).filter((name) => message.includes(name));
}

function formatChunk(row) {
  const trackLabel = row.trackName ? ` · ${row.trackName}` : '';
  const codeLabel = row.courseCode ? ` (${row.courseCode})` : '';
  const enLabel = row.courseNameEn ? ` / ${row.courseNameEn}` : '';
  const creditsLabel = row.credits != null ? `${row.credits}학점` : '학점 정보 없음';
  const remarksLabel = row.remarks ? `, 비고: ${row.remarks}` : '';
  const cohortLabel = row.minAdmissionYear || row.maxAdmissionYear
    ? ` [${row.minAdmissionYear ?? ''}~${row.maxAdmissionYear ?? ''}학번]`
    : '';

  return {
    chunkId: `curriculum-${row.departmentName}-${row.trackName || ''}-${row.grade}-${row.semester}-${row.courseCode || row.courseName}`,
    documentTitle: `${row.departmentName}${trackLabel} 교육과정${cohortLabel}`,
    content: `${row.grade}학년 ${row.semester}학기 — 구분: ${row.category}, 교과목: ${row.courseName}${codeLabel}${enLabel}, ${creditsLabel}${remarksLabel}`,
  };
}

// 메시지에서 과목명/학년+학기를 감지하면 조건에 맞는 행을 전부 조회해 근거 청크로 변환한다.
// student의 학과/트랙/입학년도를 알면 그 학생에게 실제로 해당하는 커리큘럼으로 좁히고,
// 모르면(온보딩 전 등) 전체를 다 보여줘 사용자가 스스로 판단할 수 있게 한다.
async function lookupFromMessage(message, student) {
  const mentionedCourseNames = await findMentionedCourseNames(message);
  const gradeSemester = extractGradeSemester(message);
  if (mentionedCourseNames.length === 0 && !gradeSemester) return [];

  // 메시지에서 직접 언급된 학번이 있으면 그걸 우선한다 — 온보딩 프로필보다 지금 대화
  // 맥락이 더 구체적/최신 정보이고, 온보딩을 안 끝낸 계정은 프로필에 학번 자체가 없다.
  const messageAdmissionYear = extractAdmissionYear(message);
  const baseFilter = {
    departmentId: student?.department_id || undefined,
    trackId: student?.track_id || undefined,
    admissionYear: messageAdmissionYear || student?.admission_year || undefined,
  };

  const queries = mentionedCourseNames.map((courseName) => findCourses({ courseName, ...baseFilter }));
  if (gradeSemester) {
    queries.push(findCourses({ grade: gradeSemester.grade, semester: gradeSemester.semester, ...baseFilter }));
  }

  const results = (await Promise.all(queries)).flat();
  const seen = new Set();
  const deduped = results.filter((r) => {
    const key = `${r.departmentName}-${r.trackName}-${r.grade}-${r.semester}-${r.courseCode || r.courseName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.map(formatChunk);
}

module.exports = {
  findCourses,
  extractGradeSemester,
  lookupFromMessage,
};
