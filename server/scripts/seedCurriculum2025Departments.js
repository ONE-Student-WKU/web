const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const pool = require('../db');
const rawData = require('../../db/curriculum/_source/2025_학과별_전공과목_원본.json');

/**
 * server/scripts/seedCurriculum2025Departments.js
 * db/curriculum/_source/2025_학과별_전공과목_원본.json(2025학년도 교육과정 책자에서 학과별
 * "전공과목 이수" 표를 추출한 원본 데이터)을 curriculum_courses에 시딩한다.
 *
 * 컴퓨터·소프트웨어공학과처럼 여러 학번 구간을 손으로 교차검증한 자료가 아니라, 이 책자
 * 하나에서만 뽑은 2025학번 단독 스냅샷이라 min/max_admission_year를 2025로 한정한다 —
 * 다른 학번에도 그대로 적용된다고 확정할 근거가 없음.
 *
 * "복지·보건학부(사회복지학)"/"복지·보건학부(보건행정학)" 두 키는 하나의 학과(복지·보건학부)
 * 아래 트랙 두 개로 매핑한다.
 */
const ADMISSION_YEAR = 2025;

const TRACK_KEY_MAP = {
  '복지·보건학부(사회복지학)': { department: '복지·보건학부', track: '사회복지학전공' },
  '복지·보건학부(보건행정학)': { department: '복지·보건학부', track: '보건행정학전공' },
};

async function findDepartmentId(name) {
  const [rows] = await pool.query('SELECT id FROM departments WHERE name = ?', [name]);
  return rows[0]?.id || null;
}

async function findTrackId(departmentId, name) {
  if (!name) return null;
  const [rows] = await pool.query('SELECT id FROM tracks WHERE department_id = ? AND name = ?', [departmentId, name]);
  return rows[0]?.id || null;
}

async function seedOne(key, rows) {
  const { department, track } = TRACK_KEY_MAP[key] || { department: key, track: null };

  const departmentId = await findDepartmentId(department);
  if (!departmentId) {
    console.warn(`[SKIP] ${key}: 학과를 찾을 수 없음 (${department}) — seed.js를 먼저 실행하세요`);
    return 0;
  }
  const trackId = await findTrackId(departmentId, track);
  if (track && !trackId) {
    console.warn(`[SKIP] ${key}: 트랙을 찾을 수 없음 (${track})`);
    return 0;
  }

  await pool.query(
    trackId
      ? 'DELETE FROM curriculum_courses WHERE department_id = ? AND track_id = ? AND min_admission_year = ?'
      : 'DELETE FROM curriculum_courses WHERE department_id = ? AND track_id IS NULL AND min_admission_year = ?',
    trackId ? [departmentId, trackId, ADMISSION_YEAR] : [departmentId, ADMISSION_YEAR]
  );

  for (const row of rows) {
    await pool.query(
      `INSERT INTO curriculum_courses
        (department_id, track_id, min_admission_year, max_admission_year, grade, semester,
         category, course_code, course_name, course_name_en, credits, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        departmentId,
        trackId,
        ADMISSION_YEAR,
        ADMISSION_YEAR,
        Number(row.grade),
        row.semester,
        row.category,
        row.courseCode,
        row.courseName,
        null,
        Number(row.credits) || null,
        null,
      ]
    );
  }
  return rows.length;
}

async function run() {
  try {
    let total = 0;
    for (const [key, rows] of Object.entries(rawData)) {
      total += await seedOne(key, rows);
    }
    console.log(`2025학년도 학과별 전공과목 시딩 완료: 총 ${total}개 행`);
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
