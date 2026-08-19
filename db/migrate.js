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
    console.log('[db:migrate] 완료 — 모든 테이블이 최신 상태입니다.');
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('[db:migrate] 실패:', err);
  process.exitCode = 1;
});
