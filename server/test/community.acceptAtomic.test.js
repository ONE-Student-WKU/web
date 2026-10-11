const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// communityService는 EMAIL_PROXY_DOMAIN을 모듈 로드 시점에 한 번 읽는다. 로컬 .env에는 있지만 CI에는 없어서
// (수락은 프록시를 만들 때 이 값이 필요하다) require보다 먼저 채운다. 이미 설정돼 있으면 그 값을 그대로 쓴다.
process.env.EMAIL_PROXY_DOMAIN = process.env.EMAIL_PROXY_DOMAIN || 'relay.example.test';

const pool = require('../db');
const communityService = require('../services/communityService');

/**
 * server/test/community.acceptAtomic.test.js
 * 신청 수락(decideApplication 'accepted')이 "프록시 2개 생성 + 상태 변경"을 한 덩어리로 처리하는지 확인한다.
 * 탭 2개·기기 2대에서 같은 신청을 동시에 수락하면 둘 다 'pending' 확인을 통과해 프록시가 중복 생성되고,
 * 그 결과 신청자 목록의 LEFT JOIN이 같은 신청을 여러 줄로 부풀렸다. 로컬 DB 전용 — 임시 학생을 만들고 끝나면 지운다(CASCADE).
 */

const run = Date.now();
let authorId;
let applicantId;

async function makeStudent(tag) {
  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`aa-${tag}-${run}@example.test`, `aa${tag}${run}`]);
  return r.insertId;
}

async function makePendingApplication(title) {
  const postId = await communityService.createPost(authorId, { title, body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [postId]);
  const applied = await communityService.applyToPost(postId, applicantId, '신청합니다');
  assert.ok(applied.ok, '테스트 준비: 신청 생성 실패');
  return applied;
}

before(async () => {
  authorId = await makeStudent('author');
  applicantId = await makeStudent('applicant');
});

after(async () => {
  for (const id of [authorId, applicantId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  await pool.end();
});

test('같은 신청을 동시에 수락해도 프록시는 신청자·글쓴이 몫으로 정확히 2개이고, 성공은 한 번뿐이다', async () => {
  const application = await makePendingApplication('동시 수락');

  const results = await Promise.all([
    communityService.decideApplication(application.id, authorId, 'accepted'),
    communityService.decideApplication(application.id, authorId, 'accepted'),
    communityService.decideApplication(application.id, authorId, 'accepted'),
  ]);

  assert.equal(results.filter(Boolean).length, 1, '동시 수락 중 성공은 한 번뿐이어야 한다');
  const [proxies] = await pool.query('SELECT owner_id FROM community_email_proxies WHERE application_id = ?', [application.id]);
  assert.equal(proxies.length, 2, '프록시는 정확히 2개');
  assert.deepEqual(proxies.map((p) => p.owner_id).sort(), [authorId, applicantId].sort());
});

test('동시 수락 뒤 신청자 목록에 같은 신청이 한 줄로만 나온다', async () => {
  const application = await makePendingApplication('목록 중복');
  await Promise.all([
    communityService.decideApplication(application.id, authorId, 'accepted'),
    communityService.decideApplication(application.id, authorId, 'accepted'),
  ]);

  const [[{ post_id: postId }]] = await pool.query('SELECT post_id FROM community_applications WHERE id = ?', [application.id]);
  const applicants = await communityService.getApplicantsForPost(postId);
  assert.equal(applicants.length, 1);
  assert.equal(applicants[0].status, 'accepted');
});

test('이미 수락된 신청을 다시 수락하면 false이고 프록시가 늘지 않는다', async () => {
  const application = await makePendingApplication('재수락');
  assert.equal(await communityService.decideApplication(application.id, authorId, 'accepted'), true);
  assert.equal(await communityService.decideApplication(application.id, authorId, 'accepted'), false);
  const [proxies] = await pool.query('SELECT id FROM community_email_proxies WHERE application_id = ?', [application.id]);
  assert.equal(proxies.length, 2);
});

test('글쓴이가 아닌 사람은 수락할 수 없고 프록시도 생기지 않는다', async () => {
  const application = await makePendingApplication('남의 글');
  assert.equal(await communityService.decideApplication(application.id, applicantId, 'accepted'), false);
  const [proxies] = await pool.query('SELECT id FROM community_email_proxies WHERE application_id = ?', [application.id]);
  assert.equal(proxies.length, 0);
});

test('수락과 반려가 동시에 들어와도 하나만 이기고, 프록시는 수락이 이겼을 때만 2개다', async () => {
  // 한 번만 돌리면 한쪽이 항상 먼저 도착해 경쟁이 안 생길 수 있어서 여러 신청으로 반복한다.
  let acceptedWins = 0;
  let rejectedWins = 0;
  for (let i = 0; i < 10; i++) {
    const application = await makePendingApplication(`수락 반려 경쟁 ${i}`);
    const [accepted, rejected] = await Promise.all([
      communityService.decideApplication(application.id, authorId, 'accepted'),
      communityService.decideApplication(application.id, authorId, 'rejected', '사유'),
    ]);
    assert.equal(Number(accepted) + Number(rejected), 1, '둘 중 정확히 하나만 성공해야 한다');

    const [[row]] = await pool.query('SELECT status FROM community_applications WHERE id = ?', [application.id]);
    const [proxies] = await pool.query('SELECT id FROM community_email_proxies WHERE application_id = ?', [application.id]);
    if (accepted) {
      acceptedWins++;
      assert.equal(row.status, 'accepted');
      assert.equal(proxies.length, 2);
    } else {
      rejectedWins++;
      assert.equal(row.status, 'rejected');
      assert.equal(proxies.length, 0, '반려가 이겼는데 프록시가 남으면 안 된다');
    }
  }
  assert.equal(acceptedWins + rejectedWins, 10);
});

test('프록시 생성이 중간에 실패하면 전부 롤백돼 상태는 pending, 프록시는 0개이고 다시 수락할 수 있다', async () => {
  const application = await makePendingApplication('중간 실패');

  // 두 번째 프록시 INSERT에서만 실패시킨다(첫 번째는 이미 들어간 상태) — 부분 생성이 남는지 보려는 것.
  const realGetConnection = pool.getConnection.bind(pool);
  mock.method(pool, 'getConnection', async () => {
    const conn = await realGetConnection();
    const realQuery = conn.query.bind(conn);
    let proxyInserts = 0;
    conn.query = async (sql, ...rest) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO community_email_proxies') && ++proxyInserts === 2) {
        throw new Error('두 번째 프록시 생성 실패(테스트용)');
      }
      return realQuery(sql, ...rest);
    };
    return conn;
  });

  await assert.rejects(() => communityService.decideApplication(application.id, authorId, 'accepted'), /두 번째 프록시 생성 실패/);
  mock.restoreAll();

  const [[row]] = await pool.query('SELECT status FROM community_applications WHERE id = ?', [application.id]);
  const [proxies] = await pool.query('SELECT id FROM community_email_proxies WHERE application_id = ?', [application.id]);
  assert.equal(row.status, 'pending', '실패하면 상태가 바뀌지 않아야 한다');
  assert.equal(proxies.length, 0, '첫 번째 프록시도 롤백돼야 한다');

  // 되돌아간 상태에서 다시 수락하면 정상으로 끝나고 프록시는 2개다.
  assert.equal(await communityService.decideApplication(application.id, authorId, 'accepted'), true);
  const [after2] = await pool.query('SELECT id FROM community_email_proxies WHERE application_id = ?', [application.id]);
  assert.equal(after2.length, 2);
});
