#!/usr/bin/env node
/**
 * scripts/dev/dev-login.js  (npm run dev:login)
 * 로컬 개발·화면 검증 전용 로그인 도우미 — 이메일 인증코드나 Google 로그인 없이 로컬 앱에 로그인한다.
 *
 * 사용: 터미널에서 `npm run dev:login`을 켜 둔 채(client·server는 `npm run dev`로 따로 실행), 브라우저에서
 *   http://localhost:3001/            → 온보딩 전 계정(local-tester@example.test)으로 로그인, 온보딩을 처음부터 다시 볼 수 있게 초기화
 *   http://localhost:3001/onboarded   → 온보딩을 마친 계정(컴퓨터·소프트웨어공학과 2022학번, 일반 재학생)으로 로그인
 *   http://localhost:3001/admin       → 관리자 계정(local-admin@example.test)으로 로그인
 * 로그인 후 앱(기본 http://localhost:5173/)으로 이동한다.
 *
 * 앱 서버 코드에는 로그인 우회가 없다. 이 도우미는 앱과 같은 방식(express-mysql-session)으로 로컬 DB에 세션을 직접 만들고, 앱과 같은
 * SESSION_SECRET으로 서명한 쿠키를 심을 뿐이라, 그 DB와 시크릿에 접근할 수 없는 운영 서버에는 쓸 수 없다. 그래도 실수를 막으려고 다음을 강제한다.
 *  - NODE_ENV=production이면 시작하지 않는다.
 *  - DB_HOST가 localhost/127.0.0.1/::1이 아니면 시작하지 않는다(운영·원격 DB에 테스트 계정이 생기는 사고 방지).
 *  - 내 PC(127.0.0.1)에서만 접속을 받는다. SESSION_SECRET은 출력하지 않는다.
 */

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

/** 로컬이 아니면 이유 문자열을, 괜찮으면 null을 돌려준다. */
function unsafeReason(env) {
  if (env.NODE_ENV === 'production') return 'NODE_ENV=production 입니다. 이 도우미는 로컬 개발 전용이에요.';
  const host = env.DB_HOST || 'localhost';
  if (!LOCAL_HOSTS.includes(host)) return `DB_HOST가 로컬이 아니에요(${host}). 원격·운영 DB에는 테스트 계정을 만들지 않아요.`;
  return null;
}

function roleFromPath(urlPath) {
  const p = String(urlPath || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (p === '/admin') return 'admin';
  if (p === '/onboarded') return 'onboarded';
  if (p === '/') return 'student';
  return null;
}

const ACCOUNTS = {
  student: { email: 'local-tester@example.test', role: 'student' },
  onboarded: { email: 'local-onboarded@example.test', role: 'student' },
  admin: { email: 'local-admin@example.test', role: 'admin' },
};

// 루트·server 어느 쪽 node_modules에 있어도 찾는다(npm workspaces 호이스팅 여부와 무관).
function load(name) {
  return require(require.resolve(name, { paths: [path.join(ROOT, 'server'), ROOT] }));
}

async function createSessionCookie(pool, kind) {
  const session = load('express-session');
  const MySQLStore = load('express-mysql-session')(session);
  const signature = load('cookie-signature');
  const account = ACCOUNTS[kind];

  let [[row]] = await pool.query('SELECT id FROM students WHERE email = ?', [account.email]);
  if (!row) {
    const [r] = await pool.query('INSERT INTO students (email, role) VALUES (?, ?)', [account.email, account.role]);
    row = { id: r.insertId };
  }

  // 로컬 테스트 계정은 약관 동의를 이미 받은 것으로 둔다 — 안 그러면 로그인할 때마다 동의 화면이 먼저 떠서 화면 확인이 번거롭다.
  // (동의 화면을 보고 싶으면 `UPDATE students SET consent_version = NULL WHERE email = '...'`로 지우면 된다.)
  const { CURRENT_CONSENT_VERSION } = require(path.join(ROOT, 'server', 'services', 'consent'));
  await pool.query('UPDATE students SET consented_at = COALESCE(consented_at, NOW()), consent_version = ? WHERE id = ?', [CURRENT_CONSENT_VERSION, row.id]);

  if (kind === 'student') {
    // 온보딩 화면을 매번 처음부터 볼 수 있게 미완료 상태로 되돌린다.
    await pool.query(
      'UPDATE students SET onboarding_completed_at = NULL, department_id = NULL, track_id = NULL, admission_year = NULL, enrollment_type = NULL WHERE id = ?',
      [row.id]
    );
  } else if (kind === 'onboarded') {
    const [[dept]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과'");
    await pool.query(
      "UPDATE students SET onboarding_completed_at = NOW(), department_id = ?, admission_year = 2022, enrollment_type = 'GENERAL' WHERE id = ?",
      [dept ? dept.id : null, row.id]
    );
  }

  const store = new MySQLStore({ createDatabaseTable: false }, pool);
  const sid = crypto.randomBytes(24).toString('hex');
  const maxAge = 7 * 24 * 3600 * 1000;
  await new Promise((resolve, reject) =>
    store.set(
      sid,
      { cookie: { originalMaxAge: maxAge, expires: new Date(Date.now() + maxAge).toISOString(), httpOnly: true, path: '/', sameSite: 'lax' }, userId: row.id },
      (err) => (err ? reject(err) : resolve())
    )
  );
  // server/app.js의 세션 설정과 같은 시크릿·쿠키 이름(connect.sid)·서명 방식이어야 앱이 이 세션을 인정한다.
  const value = 's:' + signature.sign(sid, process.env.SESSION_SECRET || 'wku-default-secret');
  return `connect.sid=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge / 1000}`;
}

function start() {
  load('dotenv').config({ path: path.join(ROOT, '.env') });
  const reason = unsafeReason(process.env);
  if (reason) {
    console.error(`[dev:login] 중단: ${reason}`);
    process.exit(1);
  }
  const pool = require(path.join(ROOT, 'server', 'db'));
  const port = Number(process.env.DEV_LOGIN_PORT) || 3001;
  const appUrl = process.env.DEV_LOGIN_APP_URL || 'http://localhost:5173/';

  http
    .createServer(async (req, res) => {
      const kind = roleFromPath(req.url);
      if (!kind) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('알 수 없는 주소예요. /, /onboarded, /admin 중 하나를 쓰세요.');
        return;
      }
      try {
        const cookie = await createSessionCookie(pool, kind);
        res.writeHead(302, { 'Set-Cookie': cookie, Location: appUrl });
        res.end();
      } catch (err) {
        console.error('[dev:login] 실패:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`로그인 도우미 실패: ${err.message}`);
      }
    })
    .listen(port, '127.0.0.1', () => {
      console.log(`[dev:login] http://localhost:${port}/ 를 열면 로그인돼요 → ${appUrl}`);
      console.log('  /            온보딩 전 계정(온보딩 초기화)');
      console.log('  /onboarded   온보딩을 마친 계정(컴퓨터·소프트웨어공학과 2022학번)');
      console.log('  /admin       관리자 계정');
      console.log('  (client·server는 `npm run dev`로 따로 실행해 두세요. 끄려면 Ctrl+C)');
    });
}

if (require.main === module) start();

module.exports = { unsafeReason, roleFromPath, ACCOUNTS };
