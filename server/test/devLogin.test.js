const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unsafeReason, roleFromPath, ACCOUNTS } = require('../../scripts/dev/dev-login.js');

/**
 * server/test/devLogin.test.js
 * npm run dev:login(로컬 개발 전용 로그인 도우미)의 안전장치: 운영·원격 DB에서는 시작하지 않는다.
 */

test('로컬 DB(localhost·127.0.0.1·::1·미설정)에서는 시작을 허용한다', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', undefined]) {
    assert.equal(unsafeReason({ DB_HOST: host }), null, String(host));
  }
});

test('원격·운영 DB 주소면 시작을 거부한다(테스트 계정이 운영 DB에 생기는 사고 방지)', () => {
  for (const host of ['db.example.com', '10.0.0.5', 'mysql.railway.internal', 'localhost.evil.com']) {
    assert.match(unsafeReason({ DB_HOST: host }), /로컬이 아니에요/, host);
  }
});

test('NODE_ENV=production이면 DB가 로컬이어도 거부한다', () => {
  assert.match(unsafeReason({ NODE_ENV: 'production', DB_HOST: 'localhost' }), /production/);
});

test('주소 → 계정 종류: /, /onboarded, /admin만 허용하고 쿼리·끝 슬래시는 무시, 그 밖은 null', () => {
  assert.equal(roleFromPath('/'), 'student');
  assert.equal(roleFromPath('/?x=1'), 'student');
  assert.equal(roleFromPath('/onboarded/'), 'onboarded');
  assert.equal(roleFromPath('/admin?next=/'), 'admin');
  assert.equal(roleFromPath('/api/me'), null);
  assert.equal(roleFromPath('/admin/../x'), null);
});

test('테스트 계정은 example.test 이메일이라 실제 사용자와 섞이지 않고, 관리자만 admin 역할이다', () => {
  for (const a of Object.values(ACCOUNTS)) assert.match(a.email, /@example\.test$/);
  assert.deepEqual(Object.entries(ACCOUNTS).filter(([, a]) => a.role === 'admin').map(([k]) => k), ['admin']);
});
