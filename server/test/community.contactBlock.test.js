const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// communityService는 EMAIL_PROXY_DOMAIN을 모듈 로드 시점에 읽는다(community.acceptAtomic.test.js와 같은 이유).
process.env.EMAIL_PROXY_DOMAIN = process.env.EMAIL_PROXY_DOMAIN || 'relay.example.test';

const pool = require('../db');
const communityService = require('../services/communityService');

/**
 * server/test/community.contactBlock.test.js
 * 매칭 연락 차단(2026-10-22 신고 관련 후속): 수락된 매칭은 글쓴이·신청자 누구든 연락을 차단할 수 있고, 차단하면 중계 메일을 양쪽 모두
 * 전달하지 않으며 연락 주소도 더는 내려주지 않는다. 보내는 사람이 제재 중이어도 전달하지 않는다. 로컬 DB 전용 — 끝나면 지운다(CASCADE).
 */

const run = Date.now();
let authorId;
let applicantId;
let outsiderId;

async function makeStudent(tag) {
  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`cb-${tag}-${run}@example.test`, `cb${tag}${run}`]);
  return r.insertId;
}

async function makeAcceptedMatch(title) {
  const postId = await communityService.createPost(authorId, { title, body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [postId]);
  const applied = await communityService.applyToPost(postId, applicantId, '신청합니다');
  assert.ok(applied.ok, '테스트 준비: 신청 생성 실패');
  assert.equal(await communityService.decideApplication(applied.id, authorId, 'accepted'), true);
  const [proxies] = await pool.query('SELECT owner_id, proxy_email FROM community_email_proxies WHERE application_id = ?', [applied.id]);
  const proxyOf = (ownerId) => proxies.find((p) => p.owner_id === ownerId).proxy_email;
  return { postId, applicationId: applied.id, toAuthor: proxyOf(authorId), toApplicant: proxyOf(applicantId) };
}

before(async () => {
  authorId = await makeStudent('author');
  applicantId = await makeStudent('applicant');
  outsiderId = await makeStudent('outsider');
});

after(async () => {
  for (const id of [authorId, applicantId, outsiderId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  await pool.end();
});

test('차단 전에는 양쪽으로 전달되고, 신청자가 차단하면 양쪽 모두 전달하지 않으며 연락 주소도 내려주지 않는다', async () => {
  const match = await makeAcceptedMatch('차단 테스트');
  assert.ok((await communityService.findEmailRelayTarget(match.toAuthor)).recipientEmail);
  assert.ok((await communityService.findEmailRelayTarget(match.toApplicant)).recipientEmail);

  assert.deepEqual(await communityService.blockContact(match.applicationId, applicantId), { ok: true });
  assert.deepEqual(await communityService.findEmailRelayTarget(match.toAuthor), { blocked: 'CONTACT_BLOCKED' });
  assert.deepEqual(await communityService.findEmailRelayTarget(match.toApplicant), { blocked: 'CONTACT_BLOCKED' });

  const [mine] = (await communityService.getMyApplications(applicantId)).filter((a) => a.id === match.applicationId);
  assert.equal(mine.contactEmail, null);
  assert.ok(mine.contactBlockedAt);
  const [theirs] = await communityService.getApplicantsForPost(match.postId);
  assert.equal(theirs.contactEmail, null);
  assert.ok(theirs.contactBlockedAt);
  const detail = await communityService.getPostById(match.postId, { studentId: applicantId });
  assert.equal(detail.myApplication.contactEmail, null);
  assert.ok(detail.myApplication.contactBlockedAt);

  // 다시 눌러도 같은 결과
  assert.deepEqual(await communityService.blockContact(match.applicationId, authorId), { ok: true });
});

test('수락된 신청의 글 상세는 신청자에게 글쓴이 연락 주소를 준다', async () => {
  const match = await makeAcceptedMatch('상세 연락처');
  const detail = await communityService.getPostById(match.postId, { studentId: applicantId });
  assert.equal(detail.myApplication.contactEmail, match.toAuthor);
  assert.equal(detail.myApplication.contactBlockedAt, null);
});

test('매칭 당사자가 아니면 차단할 수 없고, 수락 전 신청은 차단 대상이 아니다', async () => {
  const match = await makeAcceptedMatch('남의 매칭');
  assert.deepEqual(await communityService.blockContact(match.applicationId, outsiderId), { ok: false, reason: 'NOT_FOUND' });

  const postId = await communityService.createPost(authorId, { title: '대기 중', body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [postId]);
  const pending = await communityService.applyToPost(postId, applicantId, '신청');
  assert.deepEqual(await communityService.blockContact(pending.id, authorId), { ok: false, reason: 'NOT_ACCEPTED' });
});

test('보내는 사람이 제재 중이면 그 사람이 보내는 메일만 전달하지 않는다', async () => {
  const match = await makeAcceptedMatch('제재 중 발신');
  const [s] = await pool.query(
    "INSERT INTO student_sanctions (student_id, scope, reason, starts_at, created_by) VALUES (?, 'full', '테스트', NOW(), ?)",
    [applicantId, outsiderId]
  );
  try {
    // 신청자가 글쓴이에게 보내는 메일(글쓴이 프록시로 들어옴)은 막고, 글쓴이가 신청자에게 보내는 메일은 그대로 전달한다.
    assert.deepEqual(await communityService.findEmailRelayTarget(match.toAuthor), { blocked: 'SENDER_SANCTIONED' });
    assert.ok((await communityService.findEmailRelayTarget(match.toApplicant)).recipientEmail);
  } finally {
    await pool.query('DELETE FROM student_sanctions WHERE id = ?', [s.insertId]);
  }
});
