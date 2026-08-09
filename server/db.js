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
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
