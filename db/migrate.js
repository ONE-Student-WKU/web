const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

// 로컬 테스트 편의를 위해서만 루트 .env를 로드 (server/db.js와 동일한 경로 패턴).
// Railway Pre-Deploy Command로 실행될 때는 서비스 환경변수가 이미 주입돼 있어 이 로드는
// 아무 효과가 없다(.env 파일 자체가 배포 환경에 없음).
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// server/db.js, server/services/* 등 server/ 안의 어떤 모듈도 참조하지 않는다 —
// server/는 자체 의존성을 가진 독립 워크스페이스이고, 이 스크립트는 순수 db/schema.sql +
// mysql2만으로 동작하는 root-level 스크립트다.
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

// schema.sql은 CREATE TABLE IF NOT EXISTS만 써서, 이미 배포된 운영 테이블(예: students)에는
// 새로 추가되는 컬럼/제약이 반영되지 않는다(테이블이 이미 존재하면 그 CREATE TABLE 문 자체가
// 통째로 no-op). 그래서 기존 테이블을 바꾸는 변경은 여기서 INFORMATION_SCHEMA로 현재 상태를
// 확인한 뒤 필요한 경우에만 ALTER TABLE을 실행하는 방식으로 직접 idempotent하게 만든다 —
// 매 배포(Pre-Deploy Command)마다 재실행돼도 두 번째부터는 전부 no-op이어야 안전하다.
//
// Google OAuth 전환(students.password nullable화 + oauth_provider/oauth_id 추가)용 guard.
async function ensureOauthColumns(connection) {
  const [cols] = await connection.query(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students'
       AND COLUMN_NAME IN ('oauth_provider', 'oauth_id', 'password')`
  );
  const byName = Object.fromEntries(cols.map((c) => [c.COLUMN_NAME, c]));

  // password: 이미 존재하는 컬럼이므로 CREATE TABLE IF NOT EXISTS로는 nullable화가 안 됨.
  // MODIFY COLUMN은 이미 nullable이어도 재실행 시 에러가 나지 않아(자연히 idempotent) 별도
  // 존재 여부 가드가 필요 없음 — NOT NULL일 때만 실행해서 불필요한 ALTER를 줄인다.
  if (byName.password && byName.password.IS_NULLABLE === 'NO') {
    console.log('[db:migrate] students.password를 NULL 허용으로 변경...');
    await connection.query('ALTER TABLE students MODIFY COLUMN password VARCHAR(255) NULL');
  }

  // ADD COLUMN은 이미 존재하는 컬럼에 재실행하면 에러가 나므로(MySQL은 IF NOT EXISTS를
  // ADD COLUMN에 이식성 있게 지원하지 않음) 존재 여부를 먼저 확인해야 idempotent해진다.
  if (!byName.oauth_provider) {
    console.log('[db:migrate] students.oauth_provider 컬럼 추가...');
    await connection.query('ALTER TABLE students ADD COLUMN oauth_provider VARCHAR(20) NULL');
  }
  if (!byName.oauth_id) {
    console.log('[db:migrate] students.oauth_id 컬럼 추가...');
    await connection.query('ALTER TABLE students ADD COLUMN oauth_id VARCHAR(255) NULL');
  }

  const [idx] = await connection.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND INDEX_NAME = 'uq_students_oauth'`
  );
  if (idx.length === 0) {
    console.log('[db:migrate] uq_students_oauth 제약 추가...');
    await connection.query(
      'ALTER TABLE students ADD CONSTRAINT uq_students_oauth UNIQUE (oauth_provider, oauth_id)'
    );
  }
}

// 닉네임 자동 배정(user{id}) 전환용 guard — 기존 운영 테이블에는 CREATE TABLE IF NOT EXISTS로
// 반영이 안 되므로, name을 NULL 허용으로 직접 ALTER한다. 신규 계정은 name을 NULL로 INSERT하고
// (studentService.createOauthStudent/createEmailStudent) 표시 시점에 `user${id}`로 폴백한다
// (studentService.serializeStudent) — 기본키 기반이라 동명이인 중복이 원천적으로 발생하지 않는다.
async function ensureNameNullable(connection) {
  const [cols] = await connection.query(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'name'`
  );
  if (cols[0] && cols[0].IS_NULLABLE === 'NO') {
    console.log('[db:migrate] students.name을 NULL 허용으로 변경...');
    await connection.query('ALTER TABLE students MODIFY COLUMN name VARCHAR(50) NULL');
  }
}

// 커뮤니티 게시판(관리자 승인) 도입용 guard — 기존 운영 테이블엔 CREATE TABLE IF NOT
// EXISTS로 반영이 안 되므로 role 컬럼을 직접 ALTER한다. 관리자 지정 자체는 배포 후
// 수동 UPDATE 1회로 처리(마이그레이션에 특정 계정을 하드코딩하지 않음).
async function ensureRoleColumn(connection) {
  const [cols] = await connection.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'role'`
  );
  if (cols.length === 0) {
    console.log('[db:migrate] students.role 컬럼 추가...');
    await connection.query("ALTER TABLE students ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'student'");
  }
}

// 계절학기 지원(2026-09) — student_courses/course_offerings의 semester 값 체계를
// (1=1학기, 2=2학기)에서 학사력 시간순(1=1학기, 2=여름 계절학기, 3=2학기, 4=겨울 계절학기)으로
// 재배정한다. 재수강 판정(server/services/courseService.js의 listRetakeEligibleCourses)이나
// 학기 탭 정렬처럼 "semester 오름차순 = 학사력 순서"를 전제하는 코드가 여러 곳 있는데, 여름
// 계절학기(6~7월)가 2학기(9~12월)보다 시간상 먼저 일어나므로 값을 단순히 이어붙이면(2학기=2,
// 여름=3) 그 전제가 깨진다(db/schema.sql의 semester 컬럼 주석 참고).
//
// 이건 "기존 2학기(값 2) 데이터를 값 3으로 바꾼다"는 데이터 변경이라, 컬럼 존재 여부 확인만으론
// 재실행 안전성을 보장할 수 없다 — 이미 재배정된 뒤에 앱이 새로 여름 계절학기(값 2)를 정상
// 저장한 상태에서 이 UPDATE를 또 실행하면 그 정상 데이터를 값 3(2학기)으로 잘못 덮어써버린다.
// 그래서 컬럼 코멘트를 "이미 재배정했다"는 표식으로 남겨 테이블당 딱 한 번만 실행되게 막는다.
const SEASON_SEMESTER_MARKER = 'season_semester_renumbered_v1';
async function ensureSeasonSemesterRenumbering(connection) {
  const [cols] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'semester'
       AND TABLE_NAME IN ('student_courses', 'course_offerings')`
  );
  const commentByTable = Object.fromEntries(cols.map((c) => [c.TABLE_NAME, c.COLUMN_COMMENT]));

  for (const table of ['student_courses', 'course_offerings']) {
    if (commentByTable[table] === SEASON_SEMESTER_MARKER) continue; // 이미 재배정 완료

    console.log(`[db:migrate] ${table}.semester 재배정(2학기: 2 → 3)...`);
    await connection.query(`UPDATE ${table} SET semester = 3 WHERE semester = 2`);
    // 재배정 완료 표식 — 다음 배포부터는 위 UPDATE를 건너뛰어서, 재배정 이후 정상적으로 쌓인
    // 여름 계절학기(값 2) 데이터가 실수로 다시 3으로 밀리지 않는다.
    await connection.query(
      `ALTER TABLE ${table} MODIFY COLUMN semester TINYINT NOT NULL COMMENT '${SEASON_SEMESTER_MARKER}'`
    );
  }
}

// 카테고리(스터디/프로젝트)·모집 인원 도입용 guard — 기존 운영 테이블엔 CREATE TABLE IF
// NOT EXISTS로 반영이 안 되므로 컬럼을 직접 ALTER한다.
async function ensureCommunityCategoryCapacityColumns(connection) {
  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts'
       AND COLUMN_NAME IN ('category', 'capacity')`
  );
  const existing = new Set(cols.map((c) => c.COLUMN_NAME));
  if (!existing.has('category')) {
    console.log('[db:migrate] community_posts.category 컬럼 추가...');
    await connection.query("ALTER TABLE community_posts ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'study'");
  }
  if (!existing.has('capacity')) {
    console.log('[db:migrate] community_posts.capacity 컬럼 추가...');
    await connection.query('ALTER TABLE community_posts ADD COLUMN capacity INT NULL');
  }
}

async function migrate() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wku_ai_chat',
    charset: 'utf8mb4',
    multipleStatements: true, // schema.sql에 CREATE TABLE/INSERT 문이 여러 개 있어 필요

    // [Cloud] server/db.js와 동일: 배포 환경 전용 SSL 설정 및 CA 인증서 적용
    ssl: process.env.DB_SSL === 'true' ? { ca: process.env.DB_CA, rejectUnauthorized: true } : undefined,
  });

  try {
    console.log('[db:migrate] schema.sql 적용 시작...');
    // schema.sql 전체(CREATE DATABASE/USE 포함, 전부 IF NOT EXISTS)를 그대로 실행.
    // 몇 번을 실행해도 안전(멱등) — 이미 존재하는 테이블은 건드리지 않고 새 테이블만 생성한다.
    await connection.query(schema);

    // 이미 존재하는 테이블에 대한 변경(신규 컬럼/제약)은 위 스키마 재실행만으로는 반영되지
    // 않으므로 별도 idempotent guard로 처리.
    await ensureOauthColumns(connection);
    await ensureNameNullable(connection);
    await ensureRoleColumn(connection);
    await ensureSeasonSemesterRenumbering(connection);
    await ensureCommunityCategoryCapacityColumns(connection);

    console.log('[db:migrate] 완료 — 모든 테이블이 최신 상태입니다.');
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('[db:migrate] 실패:', err);
  process.exitCode = 1;
});
