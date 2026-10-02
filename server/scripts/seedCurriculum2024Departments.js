const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const pool = require('../db');
const rawData = require('../../db/curriculum/_source/2024_학과별_전공과목_원본.json');

/**
 * server/scripts/seedCurriculum2024Departments.js
 * db/curriculum/_source/2024_학과별_전공과목_원본.json(2024학년도 교육과정 책자에서 학과·전공별
 * "전공과목 이수" 표를 추출한 원본 데이터)을 curriculum_courses에 시딩한다.
 *
 * 2024학번 단독 스냅샷이라 min/max_admission_year를 2024로 한정한다(2025 스크립트와 동일한 방침).
 * 컴퓨터·소프트웨어공학과는 db/curriculum/*.md를 읽는 seedCurriculum.js가 2017~2025학번을
 * 이미 관리하므로 이 JSON에 넣지 않는다.
 *
 * 키 규칙: "학과명" 또는 "계열(전공명)". 괄호 앞이 departments.name, 괄호 안이 tracks.name이다.
 * 예: "행정·언론학부(행정학전공)" → 학과 행정·언론학부, 트랙 행정학전공 / "약학과(2+4년제)" → 학과 약학과, 트랙 2+4년제.
 */
const ADMISSION_YEAR = 2024;

function splitKey(key) {
  const m = key.match(/^(.+?)\((.+)\)$/);
  return m ? { department: m[1], track: m[2] } : { department: key, track: null };
}

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
  const { department, track } = splitKey(key);

  const departmentId = await findDepartmentId(department);
  if (!departmentId) {
    console.warn(`[SKIP] ${key}: 학과를 찾을 수 없음 (${department}) — seed:reference-data를 먼저 실행하세요`);
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
        row.courseCode || null,
        row.courseName,
        row.courseNameEn || null,
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
    console.log(`2024학년도 학과별 전공과목 시딩 완료: 총 ${total}개 행`);
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
