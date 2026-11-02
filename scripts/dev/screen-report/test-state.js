#!/usr/bin/env node
/**
 * scripts/dev/screen-report/test-state.js
 * 화면 비교용 상태를 로컬 DB의 dev-login 테스트 계정에 넣고, 끝나면 원래대로 되돌린다(README.md "테스트 계정 상태 만들기").
 *  - 처음 apply할 때 계정 행과 과목(student_courses)을 <작업 폴더>/state-backup.json에 저장한다. restore가 그대로 되돌리고 백업을 지운다
 *  - 로컬 DB(DB_HOST가 localhost/127.0.0.1/::1)와 example.test 계정에만 쓴다. NODE_ENV=production이면 멈춘다
 * 사용(저장소 루트에서):
 *   node --require ./server/test-helpers/setup.js scripts/dev/screen-report/test-state.js <cases.json> <케이스 이름> [ko|en]
 *   node --require ./server/test-helpers/setup.js scripts/dev/screen-report/test-state.js <cases.json> restore
 * cases.json:
 *   { "email": "local-onboarded@example.test",
 *     "cases": { "transfer": { "student": { "department_id": 1, "admission_year": 2023, "enrollment_type": "TRANSFER_ADMISSION" },
 *                              "courses": [["종교와원불교", "교양필수", 3, 2025, 1]] } } }
 *   student는 students 열 이름 그대로, courses는 [과목명, 구분, 학점, 연도, 학기코드(1=1학기, 3=2학기)].
 *   케이스에 없는 열은 백업 값으로 되돌린 뒤 적용한다(케이스끼리 값이 새지 않게). 언어 인자는 students.language에 넣는다.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const [, , casesPath, which, lang] = process.argv;
if (!casesPath || !which) {
  console.error('사용: test-state.js <cases.json> <케이스|restore> [ko|en]');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') throw new Error('NODE_ENV=production — 로컬 개발 전용이에요.');
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST || 'localhost')) throw new Error(`DB_HOST가 로컬이 아니에요(${process.env.DB_HOST}).`);

const config = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const email = config.email || 'local-onboarded@example.test';
if (!email.endsWith('@example.test')) throw new Error('example.test 테스트 계정에만 써요.');
const backupPath = path.join(path.dirname(path.resolve(casesPath)), 'state-backup.json');
const pool = require(path.join(ROOT, 'server', 'db'));

const COURSE_COLS = ['course_id', 'name', 'credits', 'category', 'major_area', 'counted_major', 'course_code', 'offering_department_id', 'year', 'semester',
  'midterm', 'final', 'attendance_score', 'assignment', 'etc', 'gpa', 'letter_grade'];

async function main() {
  const [[student]] = await pool.query('SELECT * FROM students WHERE email = ?', [email]);
  if (!student) throw new Error(`${email} 계정이 없어요 — dev-login(/onboarded)을 먼저 여세요.`);
  const cols = [...new Set(Object.values(config.cases).flatMap((c) => Object.keys(c.student || {})).concat('language'))];

  if (!fs.existsSync(backupPath)) {
    const [courses] = await pool.query(`SELECT ${COURSE_COLS.join(', ')} FROM student_courses WHERE student_id = ?`, [student.id]);
    fs.writeFileSync(backupPath, JSON.stringify({ id: student.id, row: Object.fromEntries(cols.map((c) => [c, student[c]])), courses }, null, 1));
  }
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const setRow = async (row) => {
    const keys = Object.keys(row);
    await pool.query(`UPDATE students SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => row[k]), student.id]);
  };
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [student.id]);

  if (which === 'restore') {
    await setRow(backup.row);
    for (const c of backup.courses) {
      await pool.query(`INSERT INTO student_courses (student_id, ${COURSE_COLS.join(', ')}) VALUES (?, ${COURSE_COLS.map(() => '?').join(', ')})`, [student.id, ...COURSE_COLS.map((k) => c[k])]);
    }
    fs.unlinkSync(backupPath);
    console.log('restored', email);
  } else {
    const c = config.cases[which];
    if (!c) throw new Error(`케이스가 없어요: ${which}`);
    await setRow({ ...backup.row, ...(c.student || {}), ...(lang ? { language: lang } : {}) });
    for (const [name, category, credits, year, semester] of c.courses || []) {
      await pool.query('INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, ?, ?, ?, ?, ?)', [student.id, name, credits, category, year, semester]);
    }
    console.log('applied', which, lang || '', email);
  }
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
