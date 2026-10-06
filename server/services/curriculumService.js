const pool = require('../db');
const { extractAskedYears } = require('./yearContext');
const historyService = require('./curriculumHistoryService');

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
//
// department/track이 있으면 그 학과·트랙 과목명만 후보로 놓는다(모르면 lookupFromMessage와
// 동일하게 전체를 대상으로 함) — 아래 findCourses(baseFilter) 호출이 어차피 학과/트랙으로
// 다시 걸러내므로 결과는 동일하고, 학과가 늘어날수록 커지는 전체 스캔만 피하는 효과.
async function findMentionedCourseNames(message, { departmentId, trackId } = {}) {
  const conditions = [];
  const params = [];
  if (departmentId) {
    conditions.push('department_id = ?');
    params.push(departmentId);
  }
  if (trackId) {
    conditions.push('track_id = ?');
    params.push(trackId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(`SELECT DISTINCT course_name FROM curriculum_courses ${where}`, params);
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
async function lookupRequirementsFromMessage(text, student, yearContext = null) {
  // 요건도 질문의 학번/학년도(yearContext)를 따른다. 예전에는 메시지에서 말한 학번을 무시하고 프로필 학번만 썼다
  // (lookupFromMessage는 메시지 학번을 쓰는 불일치). 프로필 학번은 yearContext.applicableCohort가 폴백으로 이미 포함한다.
  const years = yearContext
    ? resolveQueryYears(text, student, yearContext)
    : [student?.admission_year || null];
  const rowsByYear = await Promise.all(
    years.map((year) =>
      findRequirementRows({ departmentId: student?.department_id || undefined, admissionYear: year || undefined })
    )
  );
  const seenIds = new Set();
  const allRequirementRows = rowsByYear.flat().filter((r) => !seenIds.has(r.id) && seenIds.add(r.id));

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
    // 학번 범위(버전)까지 chunkId에 넣는다 — 같은 과목이 2024·2025·2026에 각각 있을 때 서로 다른 청크로 구분돼야 하고,
    // 인용 출처(chunkId)가 어느 해 자료인지도 남는다.
    chunkId: `curriculum-${row.departmentName}-${row.trackName || ''}-${row.minAdmissionYear ?? ''}~${row.maxAdmissionYear ?? ''}-${row.grade}-${row.semester}-${row.courseCode || row.courseName}`,
    documentTitle: `${row.departmentName}${trackLabel} 교육과정${cohortLabel}`,
    content: `${row.grade}학년 ${row.semester}학기 — 구분: ${row.category}, 교과목: ${row.courseName}${codeLabel}${enLabel}, ${creditsLabel}${remarksLabel}`,
  };
}

// 구조화 조회(과목/요건)에서 "어느 학번·학년도 기준으로 조회할지" 목록을 정한다.
//  - yearContext가 있으면 그것을 따른다(질문의 학년도/학번, 비교면 여러 해, 아무것도 없으면 프로필 학번).
//  - 없으면(옛 호출) 예전처럼 메시지 학번 → 프로필 학번 하나.
// null은 "연도를 모른다"는 뜻이고, 그때는 학과·세부전공마다 가장 최신 버전 하나만 쓴다(collapseToLatestVersion).
const MAX_QUERY_YEARS = 3;

function resolveQueryYears(message, student, yearContext) {
  if (yearContext) {
    const years = yearContext.targetYears.length > 0 ? yearContext.targetYears : [yearContext.applicableCohort ?? null];
    return years.slice(0, MAX_QUERY_YEARS);
  }
  return [extractAdmissionYear(message) || student?.admission_year || null];
}

// 연도를 모르면 같은 학과·세부전공의 서로 다른 해 자료가 한꺼번에 섞여 나오므로 가장 최신 버전(학번 범위의 하한이
// 가장 큰 것)만 남긴다. 예전에는 전부 보여주되 중복 제거 키에 연도가 없어서 임의로 하나만 남는 문제가 있었다.
function collapseToLatestVersion(rows) {
  const latest = new Map();
  for (const r of rows) {
    const k = `${r.departmentName}|${r.trackName || ''}`;
    const v = r.minAdmissionYear ?? 0;
    if (!latest.has(k) || v > latest.get(k)) latest.set(k, v);
  }
  return rows.filter((r) => (r.minAdmissionYear ?? 0) === latest.get(`${r.departmentName}|${r.trackName || ''}`));
}

// 학과 개편으로 그 학번에 이 학과 자료가 없으면(예: 2018학번 컴소공이 2026학번 자료를 물음) 개편 전후의 이어지는
// 학과에서 찾는다. 세부전공은 따라가지 않는다(학과 단위로만 이어짐).
async function findCoursesWithLineage(filter) {
  const rows = await findCourses(filter);
  if (rows.length > 0 || !filter.departmentId || !filter.admissionYear) return rows;

  const chain = await historyService.getDepartmentChain(filter.departmentId);
  const related = chain.departmentIds.filter((id) => id !== filter.departmentId);
  const collected = [];
  for (const departmentId of related) {
    collected.push(...(await findCourses({ ...filter, departmentId, trackId: undefined })));
  }
  return collected;
}

// 메시지에서 과목명/학년+학기를 감지하면 조건에 맞는 행을 전부 조회해 근거 청크로 변환한다.
// student의 학과/트랙/입학년도를 알면 그 학생에게 실제로 해당하는 커리큘럼으로 좁히고,
// 모르면(온보딩 전 등) 학과 전체를 대상으로 하되 가장 최신 버전만 보여준다.
// yearContext(server/services/yearContext.js)가 있으면 질문의 학번/학년도(비교면 여러 해)를 따른다.
//
// 중복 제거는 "같은 해 안의 같은 과목"만 합친다. 연도가 다른 같은 과목은 별도 청크로 유지해야 비교/이력 질문에
// 연도별 값(학점, 이수구분, 학기)이 보존된다(키에 학번 범위를 포함).
async function lookupFromMessage(message, student, yearContext = null) {
  const mentionedCourseNames = await findMentionedCourseNames(message, {
    departmentId: student?.department_id,
    trackId: student?.track_id,
  });
  const gradeSemester = extractGradeSemester(message);
  if (mentionedCourseNames.length === 0 && !gradeSemester) return [];

  const years = resolveQueryYears(message, student, yearContext);
  const results = [];
  for (const year of years) {
    const baseFilter = {
      departmentId: student?.department_id || undefined,
      trackId: student?.track_id || undefined,
      admissionYear: year || undefined,
    };
    const queries = mentionedCourseNames.map((courseName) => findCoursesWithLineage({ courseName, ...baseFilter }));
    if (gradeSemester) {
      queries.push(findCoursesWithLineage({ grade: gradeSemester.grade, semester: gradeSemester.semester, ...baseFilter }));
    }
    const rows = (await Promise.all(queries)).flat();
    results.push(...(year ? rows : collapseToLatestVersion(rows)));
  }

  const seen = new Set();
  const deduped = results.filter((r) => {
    const key = `${r.departmentName}-${r.trackName}-${r.minAdmissionYear}~${r.maxAdmissionYear}-${r.grade}-${r.semester}-${r.courseCode || r.courseName}`;
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
async function lookupOfferingsFromMessage(text, student, yearContext = null) {
  // 연도가 나왔다고 다 개설 이력 질문은 아니다 — "2024학년도 졸업요건"에는 그 해 개설과목 수백 행이 필요 없고
  // 근거 문서만 부풀린다. 개설/수강 의도가 있거나, 요건·이력·비교 의도가 없는 연도 질문일 때만 조회한다.
  // 연도는 첫 번째 것만이 아니라 질문에 나온 것 전부(최대 MAX_QUERY_YEARS개) 조회한다.
  if (yearContext) {
    const { offering, requirement, history, compare } = yearContext.intents;
    if (!offering && (requirement || history || compare)) return [];
  }
  // 직전 질문에서 이어받은 연도가 아니라 이번 질문에 직접 나온 연도만 쓴다.
  const years = (yearContext ? yearContext.explicitAskedYears : extractAskedYears(text)).slice(0, MAX_QUERY_YEARS);
  const targetYears = years.length > 0 ? years : [extractYear(text)].filter(Boolean);
  if (targetYears.length === 0) return [];

  const semester = extractSemester(text);
  const baseFilter = {
    departmentId: student?.department_id || undefined,
    trackId: student?.track_id || undefined,
  };

  const rows = (await Promise.all(targetYears.map((year) => findOfferings({ year, semester, ...baseFilter })))).flat();
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

// ---------------------------------------------------------------------------
// 연계·복합전공 / 마이크로디그리 (linked_majors, micro_degrees)
//
// 위 curriculum_courses/curriculum_requirements와 달리 department_id에 안 묶이는
// 부가 전공 프로그램이라(어떤 학과 학생이든 신청 가능) student 필터링이 없다 — 메시지에
// 프로그램명이 언급되는지만 본다.
//
// 프로그램명이 "JST 농생명바이오학부 메디컬바이오전공"처럼 사업단 접두어가 붙어 있어
// 학생은 보통 뒷부분("메디컬바이오전공")만 말한다. 접두어를 뗀 핵심명도 같이 후보로 둔다.
// ---------------------------------------------------------------------------
// 마지막 공백 구분 토큰(보통 "OOO전공"/"OOO마이크로디그리")만 후보로 추가한다. 앞의 사업단
// 접두어를 전부 떼는 방식(예: "융합전공")은 남은 조각이 너무 짧고 흔해서 "스마트헬스케어SW
// 융합전공" 같은 다른 프로그램명의 부분 문자열로 우연히 걸리는 오탐이 실측으로 확인됨 —
// 최소 길이(5자)로 그런 일반적인 잔여 조각을 걸러낸다.
//
// 마지막 토큰이 "마이크로디그리"/"전공"처럼 카테고리 통칭어 그 자체인 경우(K-치유힐링
// 공동체혁신 5개 마이크로디그리가 전부 "...마이크로디그리"로 끝남)도 구분력이 없어 같은
// 방식으로 오탐이 남으므로, 그럴 땐 바로 앞 토큰까지 묶어서 후보로 삼는다.
const MIN_CORE_NAME_LENGTH = 5;
const GENERIC_SUFFIX_WORDS = new Set(['전공', '마이크로디그리', '분야', '트랙']);

function coreProgramName(name) {
  const tokens = name.trim().split(/\s+/);
  let last = tokens[tokens.length - 1];
  if (GENERIC_SUFFIX_WORDS.has(last) && tokens.length >= 2) {
    last = `${tokens[tokens.length - 2]} ${last}`;
  }
  return last.length >= MIN_CORE_NAME_LENGTH ? last : null;
}

// 세부 과정이 붙은 프로그램("지방대활성화 반려동물 창업분야 창업기초 과정")과 사업단 접두어 뒤의
// 주제어("JST 농생명바이오학부 메디컬바이오 융합" → "메디컬바이오")는 학생이 분야/주제 단위로 물을 때가
// 많아, 전체 이름·핵심명 외에 이 키들도 후보로 둔다. 주제어 키는 이름이 구체적일 때만(최소 4자)
// 쓰고, 마이크로디그리와 연계전공이 같은 주제어를 공유하면 둘 다 조회돼도 무방하다(둘 다 실제로 있는 과정).
function programMatchKeys(name) {
  const keys = new Set([name]);
  const core = coreProgramName(name);
  if (core) keys.add(core);

  const tokens = name.trim().split(/\s+/);
  // 세부 과정: "지방대활성화 <분야명> XXX 과정" → 분야명(접두어 제외)과 "XXX 과정"
  const fieldIdx = tokens.findIndex((t) => t.endsWith('분야'));
  if (tokens[tokens.length - 1] === '과정' && fieldIdx > 0) {
    keys.add(tokens.slice(fieldIdx + 1).join(' '));
    const field = tokens.slice(1, fieldIdx + 1).join(' '); // 예: "반려동물 창업분야"
    keys.add(field);
    keys.add(field.replace(/분야$/, ''));
  }
  // K-치유힐링: 5개 전공/5개 마이크로디그리가 사업단명으로 통칭되는 경우가 많다
  if (tokens[0] === 'K-치유힐링') keys.add(tokens[0]);
  // JST: "JST XX학부 주제어 [융합|실무|전공]" → 주제어
  const collegeIdx = tokens.findIndex((t) => /학부$/.test(t));
  if (tokens[0] === 'JST' && collegeIdx >= 0 && tokens[collegeIdx + 1]) {
    const topic = tokens[collegeIdx + 1].replace(/전공$/, '');
    if (topic.length >= 4) keys.add(topic);
  }
  return [...keys].filter((k) => k.length >= 4);
}

async function findProgramsByMessage(table, message) {
  const [rows] = await pool.query(`SELECT id, name FROM ${table}`);
  return rows.filter((r) => programMatchKeys(r.name).some((k) => message.includes(k)));
}

function summarizeProgramCourses(courseRows) {
  const byCategory = new Map();
  for (const c of courseRows) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(`${c.course_name}(${Number(c.credits)}학점)`);
  }
  return [...byCategory.entries()].map(([category, names]) => `${category}: ${names.join(', ')}`).join('\n');
}

async function lookupLinkedMajorsFromMessage(message) {
  const matched = await findProgramsByMessage('linked_majors', message);
  if (matched.length === 0) return [];

  const chunks = [];
  for (const program of matched) {
    const [[meta]] = await pool.query(
      `SELECT name, program_group, required_credits, minor_required_credits, lead_professor, participating_departments
       FROM linked_majors WHERE id = ?`,
      [program.id]
    );
    const [courseRows] = await pool.query(
      `SELECT category, course_name, credits FROM linked_major_courses
       WHERE linked_major_id = ? ORDER BY category, course_name`,
      [program.id]
    );
    const professorLabel = meta.lead_professor ? `, 지도교수: ${meta.lead_professor}` : '';
    const deptLabel = meta.participating_departments ? `, 참여학과: ${meta.participating_departments}` : '';
    const minorLabel = meta.minor_required_credits != null
      ? ` (연계·복합 부전공으로 이수 시 ${Number(meta.minor_required_credits)}학점 이상)`
      : '';
    const creditsLabel = meta.required_credits != null
      ? `복수전공 이수 시 ${Number(meta.required_credits)}학점 이상${minorLabel}`
      : '이수학점 정보 없음';

    chunks.push({
      chunkId: `linked-major-${program.id}`,
      documentTitle: `연계·복합전공 — ${meta.name}`,
      content:
        `${meta.name}(연계·복합전공, 소속 학과 무관하게 복수전공/부전공으로 추가 이수 가능). ` +
        `${creditsLabel}${professorLabel}${deptLabel}. 개설 과목:\n${summarizeProgramCourses(courseRows)}`,
    });
  }
  return chunks;
}

async function lookupMicroDegreesFromMessage(message) {
  const matched = await findProgramsByMessage('micro_degrees', message);
  if (matched.length === 0) return [];

  const chunks = [];
  for (const program of matched) {
    const [[meta]] = await pool.query(
      `SELECT name, program_group, required_credits, lead_professor FROM micro_degrees WHERE id = ?`,
      [program.id]
    );
    const [courseRows] = await pool.query(
      `SELECT category, course_name, credits FROM micro_degree_courses
       WHERE micro_degree_id = ? ORDER BY category, course_name`,
      [program.id]
    );
    const professorLabel = meta.lead_professor ? `, 지도교수: ${meta.lead_professor}` : '';
    const creditsLabel = meta.required_credits != null
      ? `이수학점 ${Number(meta.required_credits)}학점`
      : '이수학점 정보 없음(자세한 기준은 해당 사업단 문의)';

    chunks.push({
      chunkId: `micro-degree-${program.id}`,
      documentTitle: `마이크로디그리 — ${meta.name}`,
      content:
        `${meta.name}(마이크로디그리, 소속 학과 무관하게 추가 이수 가능). ` +
        `${creditsLabel}${professorLabel}. 개설 과목:\n${summarizeProgramCourses(courseRows)}`,
    });
  }
  return chunks;
}

module.exports = {
  findCourses,
  extractGradeSemester,
  lookupFromMessage,
  findMentionedCourseNames,
  lookupRequirementsFromMessage,
  lookupOfferingsFromMessage,
  lookupLinkedMajorsFromMessage,
  lookupMicroDegreesFromMessage,
};
