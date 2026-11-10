const pool = require('../db');
const studentService = require('./studentService');
const { getGraduationStatus } = require('./graduationService');
const { getSupersededCourseIds } = require('./courseService');

/**
 * server/services/inquiryDiagnosisSnapshot.js
 * 문의에 "진단 결과 같이 보내기"(2026-11) — 학생이 고르면 보낸 순간의 졸업요건 진단 요약과 과목 목록을 문의에 붙여 저장한다.
 * 학생이 나중에 과목을 고쳐도 "문의할 때 무엇을 보고 이상하다고 했는지"가 남아야 원인을 찾을 수 있어서, 그때 모습을 그대로 둔다.
 *
 * 담는 것(개인정보처리방침 "문의" 항목과 같게): 학과·세부전공·학번·입학 유형, 총·영역별 학점, 신뢰도와 추정 사유, 직접 바꾼 이수구분,
 * 과목마다 과목명·학점·이수구분(직접 바꿨으면 원래 값)·수강 학기·넣은 방법·재수강으로 대체됐는지.
 * 담지 않는 것: 성적(등급)·세부 점수·평점, 이름·이메일. AI 답변 초안에도 넣지 않는다(위탁 범위 그대로, inquiryDraftService.js).
 */

const SNAPSHOT_VERSION = 1;

// 과목을 넣은 방법. 개설과목 검색은 course_id로, 성적표는 학수번호·개설 학과로 안다. 직접입력과 이수과목확인리스트(학수번호 없음)는
// 구분할 수 없어 UNKNOWN이다 — 저장할 때 출처를 따로 남기지 않았기 때문이다.
function courseOrigin(row) {
  if (row.course_id != null) return 'CATALOG';
  if (row.course_code || row.offering_department_id != null) return 'TRANSCRIPT';
  return 'UNKNOWN';
}

/** 진단 응답 → 스냅샷의 요약(순수 함수). 성적 관련 값은 응답에 없다. */
function summarizeStatus(status) {
  if (!status) return null;
  const regulation = status.regulation || {};
  return {
    totalEarnedCredits: Number(status.totalEarnedCredits) || 0,
    totalRequiredCredits: Number(status.totalRequiredCredits) || 0,
    confidence: regulation.confidence || null,
    // 화면에 보이던 추정 사유(참고 플래그는 빼고).
    reasons: (regulation.flags || []).filter((f) => f.level !== 'INFO' && f.message).map((f) => ({ code: f.code, message: f.message })),
    categories: (status.categories || []).map((c) => ({ category: c.category, earnedCredits: Number(c.earnedCredits) || 0, requiredCredits: Number(c.requiredCredits) || 0 })),
    certifications: (status.certifications || []).map((c) => ({ category: c.category, satisfied: Boolean(c.satisfied) })),
    editedCategoryCourses: status.editedCategoryCourses || [],
  };
}

/** 과목 행 → 스냅샷 과목(순수 함수). 성적 칸은 읽지도 않는다. */
function snapshotCourse(row, supersededIds) {
  return {
    name: row.name,
    credits: Number(row.credits),
    category: row.category,
    originalCategory: row.category_original ?? null,
    year: row.year,
    semester: row.semester,
    origin: courseOrigin(row),
    supersededByRetake: supersededIds.has(row.id),
  };
}

async function buildDiagnosisSnapshot(studentId) {
  const student = await studentService.findById(studentId);
  if (!student) return null;
  let status = null;
  try {
    status = await getGraduationStatus(studentId);
  } catch (err) {
    // 온보딩 전(학과 없음)이면 진단이 없다 — 과목 목록만 보낸다.
    if (err.code !== 'ONBOARDING_REQUIRED') throw err;
  }
  const [rows] = await pool.query(
    `SELECT id, course_id, name, credits, category, category_original, year, semester, course_code, offering_department_id
     FROM student_courses WHERE student_id = ? ORDER BY year, semester, id`,
    [studentId]
  );
  const supersededIds = await getSupersededCourseIds(studentId);
  return {
    version: SNAPSHOT_VERSION,
    takenAt: new Date().toISOString(),
    student: {
      department: student.department_name || null,
      track: student.track_name || null,
      admissionYear: student.admission_year ?? null,
      enrollmentType: student.enrollment_type || null,
    },
    summary: summarizeStatus(status),
    courses: rows.map((r) => snapshotCourse(r, supersededIds)),
  };
}

module.exports = { buildDiagnosisSnapshot, summarizeStatus, snapshotCourse, courseOrigin, SNAPSHOT_VERSION };
