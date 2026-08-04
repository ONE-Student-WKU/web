const mysql = require('mysql2/promise');
require('dotenv').config();

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
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  // [Cloud] 로컬 개발 접속 거부 방지를 위해 Vercel 배포 환경 전용 SSL 설정 적용
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

module.exports = pool;
