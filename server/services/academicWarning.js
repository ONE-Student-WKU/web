const pool = require('../db');
const { programYearsOf } = require('./studentProgress');

/**
 * server/services/academicWarning.js
 * 학기 성적으로 학사경고·유급 "대상일 수 있는" 학기를 찾는다(#412, 설계 메모 #462). 실제 판정은 학기 말 성적사정과 학교·단과대학
 * 통보가 기준이라, 화면은 늘 "대상일 수 있어요"로만 알린다.
 *
 * 규정(학칙시행규칙 2026.6.26. 현행, db/regulations/_source/원광대학교_학칙시행규칙_전문.txt)
 *  - 학사경고(제68조): 수업연한(학칙 제25조) 이내 재학생으로 해당 학기 평균평점 1.75 미만. 계속 4회·통산 6회면 제적(학칙 제45조).
 *  - 유급(제100조): 의과·치과·한의과·약학·간호대학 학생은 학사경고 대신 유급(작업치료·응급구조학과 제외). ② 다음 중 하나면 유급
 *      1. 의예과·치의예과·한의예과·간호학과·약학과·한약학과: 해당 학기 평균평점 2.0 미만
 *      2. 의학과·치의학과·한의학과: 해당 학기 전공교과목 평균평점 2.0 미만
 *      3. 의과·치과·한의과·간호대학: 해당 학기 전공필수 F
 *      4. 약학과: 해당 학기 전공 교과목 F
 *    ③ 교양(·전공기초) 미취득은 진급하되 재학 중 꼭 취득. 연속 4회·통산 6회 유급하면 제적(제102조).
 *
 * 이 서비스가 정한 기본값(#462 "정해야 할 것" — 2026-10-27, 학교 확인 전 가정)
 *  - 정규 학기(1·2학기)만 판정한다. 계절학기는 "정규학기와 별도의 수업기간"(제74조)이라 학기 평균에 넣지 않는다.
 *  - 재수강으로 나중에 대체된 기록도 그 학기 판정에 넣는다 — 학사경고·유급은 그 학기 말에 당시 성적으로 정해졌다.
 *  - 성적이 없는 과목(수강 중·미입력)이 하나라도 있는 학기는 판정하지 않는다. P/NP는 평균평점에서 뺀다(courseService.getSummary와 같다).
 *  - 전공필수·전공 교과목은 학생이 저장한 이수구분(전공필수·전공선택)으로 본다.
 *  - 수업연한 이내인지는 이수 기록이 있는 정규 학기 순서로 센다(편입생은 편입 학년 앞의 학기를 더한다). 넘긴 학기는 학사경고를 판정하지 않는다.
 *  - 본과(의학과·치의학과·한의학과) 학생의 예과 시절 학기(처음 4개 정규 학기, 편입생 제외)는 예과 기준(1호)으로 본다.
 */

const WARNING_GPA = 1.75;
const REPEAT_GPA = 2.0;
const DISMISSAL = Object.freeze({ consecutive: 4, total: 6 });

// 제100조 ② 각 호의 학과. 작업치료학과·응급구조학과는 ① 단서로 학사경고 쪽이다.
const OVERALL_GPA_DEPARTMENTS = new Set(['의예과', '치의예과', '한의예과', '간호학과', '약학과', '한약학과']);
const MAJOR_GPA_DEPARTMENTS = new Set(['의학과', '치의학과', '한의학과']);
const REQUIRED_MAJOR_F_DEPARTMENTS = new Set(['의예과', '의학과', '치의예과', '치의학과', '한의예과', '한의학과', '간호학과']);
const ANY_MAJOR_F_DEPARTMENTS = new Set(['약학과']);
const REPEAT_DEPARTMENTS = new Set([...OVERALL_GPA_DEPARTMENTS, ...MAJOR_GPA_DEPARTMENTS]);
const PREMED_TERMS = 4;

const REGULAR_SEMESTER = { 1: 1, 3: 2 }; // DB 학기 코드(1=1학기, 2=여름, 3=2학기, 4=겨울) → 정규 학기 번호
const MAJOR_CATEGORIES = new Set(['전공필수', '전공선택']);
const LIBERAL_CATEGORIES = new Set(['교양필수', '교양선택']);

function average(courses) {
  const graded = courses.filter((c) => c.gpa !== null && c.gpa !== undefined);
  const credits = graded.reduce((s, c) => s + Number(c.credits), 0);
  if (credits === 0) return null;
  const points = graded.reduce((s, c) => s + Number(c.credits) * Number(c.gpa), 0);
  return Math.round((points / credits) * 100) / 100;
}

/**
 * @param {Array<{name, year, semester, credits, gpa, letter_grade, category}>} rows 학생의 모든 수강 기록(재수강으로 대체된 것 포함)
 * @param {{ departmentName: string, enrollmentType?: string, transferGrade?: number|null }} student
 * @returns {{ regime: 'WARNING'|'REPEAT', threshold: number, terms: Array, flaggedCount: number, consecutiveCount: number, dismissal: object }}
 */
function assessAcademicWarnings(rows, { departmentName, enrollmentType = 'GENERAL', transferGrade = null } = {}) {
  const regime = REPEAT_DEPARTMENTS.has(departmentName) ? 'REPEAT' : 'WARNING';
  const isTransfer = enrollmentType === 'TRANSFER_ADMISSION';
  const startGrade = isTransfer ? (transferGrade != null ? Number(transferGrade) : 3) : 1;
  const termLimit = programYearsOf(departmentName) * 2;

  const byTerm = new Map();
  for (const row of rows) {
    const semester = REGULAR_SEMESTER[row.semester];
    if (!semester) continue;
    const key = `${row.year}-${semester}`;
    if (!byTerm.has(key)) byTerm.set(key, { year: row.year, semester, courses: [] });
    byTerm.get(key).courses.push(row);
  }
  const ordered = [...byTerm.values()].sort((a, b) => a.year - b.year || a.semester - b.semester);

  const terms = ordered.map((term, i) => {
    const enrolledTermNumber = i + 1 + (startGrade - 1) * 2;
    const ungraded = term.courses.some((c) => !c.letter_grade);
    const gpa = average(term.courses);
    const base = { year: term.year, semester: term.semester, gpa, judged: false, flagged: false, reasons: [], liberalArtsF: [] };
    if (ungraded || gpa === null) return { ...base, pending: ungraded };

    if (regime === 'WARNING') {
      if (enrolledTermNumber > termLimit) return { ...base, beyondProgramYears: true };
      const flagged = gpa < WARNING_GPA;
      return { ...base, judged: true, flagged, reasons: flagged ? ['GPA_BELOW'] : [] };
    }

    const majorCourses = term.courses.filter((c) => MAJOR_CATEGORIES.has(c.category));
    const failed = (c) => c.letter_grade === 'F';
    const asPremed = MAJOR_GPA_DEPARTMENTS.has(departmentName) && !isTransfer && i < PREMED_TERMS;
    const reasons = [];
    let majorGpa = null;
    if (OVERALL_GPA_DEPARTMENTS.has(departmentName) || asPremed) {
      if (gpa < REPEAT_GPA) reasons.push('GPA_BELOW');
    } else {
      majorGpa = average(majorCourses);
      if (majorGpa !== null && majorGpa < REPEAT_GPA) reasons.push('MAJOR_GPA_BELOW');
    }
    const requiredF = REQUIRED_MAJOR_F_DEPARTMENTS.has(departmentName) ? term.courses.filter((c) => c.category === '전공필수' && failed(c)) : [];
    const majorF = ANY_MAJOR_F_DEPARTMENTS.has(departmentName) ? majorCourses.filter(failed) : [];
    if (requiredF.length) reasons.push('MAJOR_REQUIRED_F');
    if (majorF.length) reasons.push('MAJOR_F');
    return {
      ...base,
      judged: true,
      majorGpa,
      flagged: reasons.length > 0,
      reasons,
      failedCourses: [...requiredF, ...majorF].map((c) => c.name),
      // 제100조 ③: 교양 미취득은 진급하되 재학 중 꼭 취득해야 한다(유급 사유는 아니다).
      liberalArtsF: term.courses.filter((c) => LIBERAL_CATEGORIES.has(c.category) && failed(c)).map((c) => c.name),
    };
  });

  // 연속 횟수는 판정한 학기만 이어서 센다(판정하지 않은 학기는 건너뛴다). 화면은 가장 최근까지 이어진 연속 횟수를 보여 준다.
  const judged = terms.filter((t) => t.judged);
  let consecutiveCount = 0;
  for (let i = judged.length - 1; i >= 0 && judged[i].flagged; i--) consecutiveCount++;

  return {
    regime,
    threshold: regime === 'WARNING' ? WARNING_GPA : REPEAT_GPA,
    terms,
    flaggedCount: judged.filter((t) => t.flagged).length,
    consecutiveCount,
    dismissal: DISMISSAL,
  };
}

async function getAcademicWarnings(studentId, student) {
  if (!student || !student.department_name) return null;
  const [rows] = await pool.query(
    'SELECT name, year, semester, credits, gpa, letter_grade, category FROM student_courses WHERE student_id = ?',
    [studentId]
  );
  return assessAcademicWarnings(rows, {
    departmentName: student.department_name,
    enrollmentType: student.enrollment_type,
    transferGrade: student.transfer_grade,
  });
}

module.exports = { assessAcademicWarnings, getAcademicWarnings, WARNING_GPA, REPEAT_GPA };
