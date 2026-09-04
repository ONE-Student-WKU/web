const path = require('path');
// server/scripts에서 실행돼도 항상 리포지토리 루트의 .env를 찾도록 절대경로로 지정.
// (npm workspace로 실행하면 cwd가 server/가 되어 기본 dotenv 탐색이 .env를 못 찾는 문제 방지)
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

/**
 * server/scripts/seedReferenceData.js
 * seed.js가 export하는 seedDepartments/seedCurriculumRequirements만 실행하는 wrapper.
 * seed.js의 seedStudents/seedStudentCourses(가짜 테스트 계정)는 이 파일에서 절대 호출하지 않는다 —
 * 운영 DB 자동 반영 파이프라인(Cron Job)이 이 스크립트만 실행하도록 만들기 위함.
 */

const { seedDepartments, seedCurriculumRequirements } = require('./seed');
// seed.js는 seedDepartments/seedCurriculumRequirements만 export하고 pool은 내보내지 않으므로,
// 실행 종료 시 커넥션을 닫기 위해 여기서 직접 가져온다(seed.js와 동일한 싱글턴 pool을 공유).
const pool = require('../db');

async function run() {
  try {
    await seedDepartments();
    await seedCurriculumRequirements();
    console.log('참조 데이터(departments, curriculum_requirements) 갱신 완료');
  } catch (err) {
    console.error('참조 데이터 갱신 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
