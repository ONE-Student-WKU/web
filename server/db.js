const path = require('path');
const mysql = require('mysql2/promise');

// npm workspace로 실행하면 cwd가 server/로 바뀌어 기본 dotenv 탐색(cwd 기준)이
// 리포지토리 루트의 .env를 못 찾는다. 항상 루트 .env를 절대경로로 지정해서 로드.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * server/db.js
 * Configures the database connection pool using connection options from environment variables.
 */

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wku_ai_chat',
  charset: 'utf8mb4',
  waitForConnections: true,
  // Railway MySQL max_connections=151 확인됨(이슈 #226) — 서버 앱 외에 db-reseed 크론,
  // Pre-Deploy Command(db/migrate.js)도 커넥션을 나눠 쓰지만 둘 다 짧게 열었다 닫는
  // 별도 연결이라 20이면 여유가 충분하다. 지금 트래픽(CPU 0에 수렴, 최근 한 달 실측)엔
  // 10으로도 압박이 없었지만, 전체 학과 확장 대비 약간의 여유를 미리 둔다.
  connectionLimit: 20,
  // 0(무제한 대기열)이면 DB가 막혀도 요청을 거절하지 않고 계속 쌓이기만 해서, 과부하 시
  // "빠른 에러" 대신 "느린 무한 대기"로 체감된다 — 커넥션 풀 크기의 1.5배 정도만 대기를
  // 허용하고 그 이상은 바로 실패시켜 원인 파악과 사용자 경험 둘 다 낫게 한다.
  queueLimit: 30,
  // 명시하지 않으면 mysql2 기본값(무기한에 가까움)에 의존하게 되어, DB 연결 자체가 안 되는
  // 상황에서 요청이 얼마나 오래 걸릴지 예측할 수 없었다.
  connectTimeout: 10000,

  // [Cloud] 로컬 개발 접속 거부 방지를 위해 Vercel 배포 환경 전용 SSL 설정 및 CA 인증서 적용
  ssl: process.env.DB_SSL === 'true' ? { ca: process.env.DB_CA, rejectUnauthorized: true } : undefined
});

module.exports = pool;
