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

// (?<!\d): "2022학년도"의 마지막 '2'가 "2학년"으로 오매칭되는 걸 막는다 — 4자리 연도 표기
// ("YYYY학년도")와 "N학년"이 글자만 보면 구분이 안 돼서, 앞에 다른 숫자가 붙어있으면(=연도의
// 일부) 학년으로 보지 않는다.
const GRADE_RE = /(?<!\d)(\d)\s*학년|학년[:\s]*(\d)/;
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

// "기업연계프로젝트1(종합설계1)" → "기업연계프로젝트" — 번호/괄호를 뗀 기본형으로도 매칭되게
// 한다. 졸업인증제 같은 min_course_count 요건은 과목이 1/2로 나뉘어 있어도 실제로는
// "이 중 1개만 이수하면 충족"인 경우가 있는데, 학생이 번호 없이 뭉뚱그려 묻는 경우가 많다.
function stripCourseSuffix(name) {
  return name.replace(/\d+(\([^)]*\))?$/, '').trim();
}

// min_course_count가 있는 요건(졸업인증제/졸업논문 등)과 그 대상 과목 목록을 함께 가져온다.
async function findRequirementRows({ departmentId, admissionYear } = {}) {
  const conditions = ['cr.min_course_count IS NOT NULL'];
  const params = [];
  if (departmentId) {
    conditions.push('cr.department_id = ?');
    params.push(departmentId);
  }
  if (admissionYear) {
    conditions.push('(cr.min_admission_year IS NULL OR cr.min_admission_year <= ?)');
    conditions.push('(cr.max_admission_year IS NULL OR cr.max_admission_year >= ?)');
    params.push(admissionYear, admissionYear);
  }

  const [rows] = await pool.query(
    `SELECT cr.id, cr.category, cr.description, cr.min_course_count,
            cr.min_admission_year, cr.max_admission_year, d.name AS department_name
     FROM curriculum_requirements cr
     JOIN departments d ON d.id = cr.department_id
     WHERE ${conditions.join(' AND ')}`,
    params
  );

  const results = [];
  for (const row of rows) {
    const [courseRows] = await pool.query(
      'SELECT course_name FROM curriculum_required_courses WHERE requirement_id = ?',
      [row.id]
    );
    results.push({
      id: row.id,
      category: row.category,
      description: row.description,
      minCourseCount: row.min_course_count,
      minAdmissionYear: row.min_admission_year,
      maxAdmissionYear: row.max_admission_year,
      departmentName: row.department_name,
      requiredCourses: courseRows.map((c) => c.course_name),
    });
  }
  return results;
}

function formatRequirementChunk(row) {
  const cohortLabel = row.minAdmissionYear || row.maxAdmissionYear
    ? ` (${row.minAdmissionYear ?? ''}~${row.maxAdmissionYear ?? ''}학번)`
    : '';
  const courseList = row.requiredCourses.join(', ') || '해당 없음';
  // "N개 중 M개만 충족"이던 예전 가정을 그대로 고정 문구로 박아뒀었는데, 컴퓨터·소프트웨어공학과
  // 졸업인증제처럼 minCourseCount가 대상 과목 전체 개수와 같아지는 경우(2개 중 2개 필수)엔
  // "전부 이수할 필요는 없음"이 자기모순이 된다 — 실제 개수를 비교해서 문구를 분기한다.
  const satisfactionNote =
    row.minCourseCount >= row.requiredCourses.length
      ? '대상 과목을 전부 이수해야 이 요건이 충족된다.'
      : `이 중 최소 ${row.minCourseCount}과목만 이수하면 이 요건이 충족된다(대상 과목을 전부 이수할 필요는 없음).`;

  return {
    chunkId: `requirement-${row.departmentName}-${row.category}-${row.id}`,
    documentTitle: `${row.departmentName} 졸업요건 — ${row.category}${cohortLabel}`,
    content: `${row.description} 대상 과목: ${courseList}. ${satisfactionNote}`,
  };
}

// 졸업인증제/졸업논문처럼 "여러 과목 중 N개만 이수하면 충족"인 요건은 RAG 원문(학칙 프로즈)만
// 봐서는 학생이 언급한 구체적 과목명(예: "기업연계프로젝트1")이 그 OR 조건의 일부라는 걸
// 모델이 확신 있게 연결하지 못해 "명확하지 않다"며 답을 회피하는 문제가 실측으로 확인됐다.
// curriculum_courses 조회(findMentionedCourseNames)와 같은 패턴으로 curriculum_requirements를
// 구조화 조회해 min_course_count와 전체 대상 과목 목록을 명시적으로 근거에 포함시킨다.
async function lookupRequirementsFromMessage(text, student) {
  const baseFilter = {
    departmentId: student?.department_id || undefined,
    admissionYear: student?.admission_year || undefined,
  };
  const allRequirementRows = await findRequirementRows(baseFilter);

  const matched = allRequirementRows.filter(
    (row) =>
      text.includes(row.category) ||
      row.requiredCourses.some((name) => text.includes(name) || text.includes(stripCourseSuffix(name)))
  );

  return matched.map(formatRequirementChunk);
}

function formatChunk(row) {
  const trackLabel = row.trackName ? ` · ${row.trackName}` : '';
  const codeLabel = row.courseCode ? ` (${row.courseCode})` : '';
  const enLabel = row.courseNameEn ? ` / ${row.courseNameEn}` : '';
  const creditsLabel = row.credits != null ? `${Number(row.credits)}학점` : '학점 정보 없음';
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

// course_offerings(실제 개설 이력)를 연도 조건으로 조회한다. curriculum_courses(편성 계획)와
// 달리 학기당 50~90행이 나올 수 있어, 학기까지 특정 안 된 "연도만" 질문은 두 학기 합쳐 100행을
// 넘기기 쉽다 — 근거 청크가 그대로 비대해지지 않도록 (연도, 학기, 학년) 단위로 묶어 카테고리별
// 과목명만 나열한 요약 청크로 만든다(개별 분반/교수/시간은 생략).
// "2022학년도"(학사 관용 표현)와 "2022년"/"2022년도"를 모두 잡는다. "학년도"를 먼저 시도해야
// GRADE_RE와 별개로 이 정규식 자체도 "학" 유무에 안 걸리고 바로 연도를 뽑아낸다.
const YEAR_RE = /(\d{4})\s*(?:학년도|년도|년)/;

// ADMISSION_YEAR_RE("NN학번")와 겹치지 않도록 "년"/"년도"/"학년도" 접미사가 있을 때만 매칭한다.
function extractYear(text) {
  const m = text.match(YEAR_RE);
  return m ? Number(m[1]) : null;
}

function extractSemester(text) {
  const m = text.match(SEMESTER_RE);
  return m ? Number(m[1] || m[2]) : null;
}

async function findOfferings({ departmentId, trackId, year, semester } = {}) {
  const conditions = ['co.year = ?'];
  const params = [year];

  if (semester) {
    conditions.push('co.semester = ?');
    params.push(semester);
  }
  if (departmentId) {
    conditions.push('co.department_id = ?');
    params.push(departmentId);
  }
  if (trackId) {
    conditions.push('co.track_id = ?');
    params.push(trackId);
  }

  const [rows] = await pool.query(
    `SELECT co.year, co.semester, co.grade, co.category, co.course_name, co.credits,
            d.name AS department_name, t.name AS track_name
     FROM course_offerings co
     JOIN departments d ON d.id = co.department_id
     LEFT JOIN tracks t ON t.id = co.track_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY co.semester, co.grade, co.category, co.course_name`,
    params
  );

  return rows;
}

function formatOfferingChunk(group) {
  const trackLabel = group.trackName ? ` · ${group.trackName}` : '';
  const gradeLabel = group.grade != null ? `${group.grade}학년` : '학년 미지정';
  const categoryLines = [...group.categories.entries()]
    .map(([category, names]) => `${category}: ${[...names].join(', ')}`)
    .join('\n');

  return {
    chunkId: `offering-${group.departmentName}-${group.trackName || ''}-${group.year}-${group.semester}-${group.grade ?? 'x'}`,
    documentTitle: `${group.departmentName}${trackLabel} ${group.year}학년도 ${group.semester}학기 ${gradeLabel} 개설과목`,
    content: `${group.year}년 ${group.semester}학기에 실제 개설된 과목 목록(${gradeLabel}):\n${categoryLines}`,
  };
}

// 메시지에서 연도(및 있으면 학기)를 감지하면 그 학기에 실제 개설된 과목을 조회해 근거 청크로
// 변환한다. student의 학과/트랙을 알면 그 학생 소속으로 좁히고, 모르면(온보딩 전 등) 전체를
// 반환한다 — lookupFromMessage와 동일한 방침.
async function lookupOfferingsFromMessage(text, student) {
  const year = extractYear(text);
  if (!year) return [];

  const semester = extractSemester(text);
  const baseFilter = {
    departmentId: student?.department_id || undefined,
    trackId: student?.track_id || undefined,
  };

  const rows = await findOfferings({ year, semester, ...baseFilter });
  if (rows.length === 0) return [];

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.department_name}-${row.track_name || ''}-${row.year}-${row.semester}-${row.grade ?? 'x'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        departmentName: row.department_name,
        trackName: row.track_name,
        year: row.year,
        semester: row.semester,
        grade: row.grade,
        categories: new Map(),
      });
    }
    const group = groups.get(key);
    if (!group.categories.has(row.category)) group.categories.set(row.category, new Set());
    group.categories.get(row.category).add(`${row.course_name}(${Number(row.credits)}학점)`);
  }

  return [...groups.values()].map(formatOfferingChunk);
}

module.exports = {
  findCourses,
  extractGradeSemester,
  lookupFromMessage,
  lookupRequirementsFromMessage,
  lookupOfferingsFromMessage,
};
