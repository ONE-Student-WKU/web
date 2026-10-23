const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const noticeService = require('../services/noticeService');

/**
 * server/test/community.notice.test.js
 * 커뮤니티 공지(2026-10-22 피드백): 운영팀이 쓰고 학생은 읽기만 한다. 학생이 아직 열어 보지 않은 공지가 "새 공지"다(2026-10-23,
 * 예전에는 목록을 한 번 열면 전부 읽은 것이 됐다).
 * 로컬 DB에 학생 하나와 공지를 만들고 끝나면 지운다.
 */

let studentId;
const created = [];

before(async () => {
  const stamp = Date.now();
  const [r] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`notice-${stamp}@example.test`, `notice${stamp}`]);
  studentId = r.insertId;
});

after(async () => {
  if (created.length) await pool.query('DELETE FROM community_notices WHERE id IN (?)', [created]);
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

test('normalizeNoticeInput: 앞뒤 공백을 떼고, 비었거나 너무 긴 제목·본문은 받지 않는다', () => {
  assert.deepEqual(noticeService.normalizeNoticeInput({ title: '  점검 안내 ', body: ' 내용 ' }), { title: '점검 안내', body: '내용' });
  assert.equal(noticeService.normalizeNoticeInput({ title: ' ', body: '내용' }), null);
  assert.equal(noticeService.normalizeNoticeInput({ title: '제목', body: '' }), null);
  assert.equal(noticeService.normalizeNoticeInput({ title: 'a'.repeat(noticeService.NOTICE_TITLE_MAX_LENGTH + 1), body: '내용' }), null);
  assert.equal(noticeService.normalizeNoticeInput({ title: '제목', body: 'a'.repeat(noticeService.NOTICE_BODY_MAX_LENGTH + 1) }), null);
  assert.equal(noticeService.normalizeNoticeInput(null), null);
});

test('한 번도 안 본 학생에게는 모든 공지가 새 공지이고, 상세를 연 공지만 새 공지에서 빠진다. 수정해도 다시 새 공지가 되지 않는다', async () => {
  const before = await noticeService.countUnseen(studentId);
  const a = await noticeService.createNotice(null, { title: '테스트 공지 A', body: '본문' });
  const b = await noticeService.createNotice(null, { title: '테스트 공지 B', body: '본문' });
  created.push(a, b);
  assert.equal(await noticeService.countUnseen(studentId), before + 2);
  const isNew = async (id) => (await noticeService.listNotices(studentId)).find((n) => n.id === id).isNew;
  assert.equal(await isNew(a), true);

  // 하나를 열면 그 공지만 읽은 것이 된다(예전에는 목록을 열면 전부 읽은 것이 됐다)
  assert.equal(await noticeService.markRead(studentId, a), true);
  assert.equal(await noticeService.markRead(studentId, a), true); // 두 번 열어도 그대로
  assert.equal(await isNew(a), false);
  assert.equal(await isNew(b), true);
  assert.equal(await noticeService.countUnseen(studentId), before + 1);

  assert.equal(await noticeService.updateNotice(a, { title: '고친 공지', body: '고친 본문' }), true);
  assert.equal(await isNew(a), false);
  const updated = (await noticeService.listNotices(studentId)).find((n) => n.id === a);
  assert.equal(updated.title, '고친 공지');
  assert.ok(updated.updatedAt);
});

test('모두 읽음으로 표시하면 안 읽은 공지가 0이 되고, 그 뒤에 올라온 공지는 다시 새 공지다', async () => {
  const a = await noticeService.createNotice(null, { title: '모두 읽음 전', body: '본문' });
  created.push(a);
  await noticeService.markAllRead(studentId);
  assert.equal(await noticeService.countUnseen(studentId), 0);
  const b = await noticeService.createNotice(null, { title: '모두 읽음 뒤', body: '본문' });
  created.push(b);
  assert.equal(await noticeService.countUnseen(studentId), 1);
  assert.equal((await noticeService.listNotices(studentId)).find((n) => n.id === b).isNew, true);
});

test('예전 방식으로 목록을 본 시각보다 먼저 올라온 공지는 읽은 것으로 치고, 그 뒤 공지만 새 공지다', async () => {
  const [r] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`notice-old-${Date.now()}@example.test`, `noticeold${Date.now()}`]);
  const oldViewer = r.insertId;
  try {
    const older = await noticeService.createNotice(null, { title: '예전 공지', body: '본문' });
    created.push(older);
    await pool.query('UPDATE community_notices SET created_at = NOW() - INTERVAL 2 DAY WHERE id = ?', [older]);
    await pool.query('INSERT INTO community_notice_seen (student_id, seen_at) VALUES (?, NOW() - INTERVAL 1 DAY)', [oldViewer]);
    const newer = await noticeService.createNotice(null, { title: '새 공지', body: '본문' });
    created.push(newer);
    const list = await noticeService.listNotices(oldViewer);
    assert.equal(list.find((n) => n.id === older).isNew, false);
    assert.equal(list.find((n) => n.id === newer).isNew, true);
  } finally {
    await pool.query('DELETE FROM students WHERE id = ?', [oldViewer]);
  }
});

test('자기가 쓴 공지는 자기에게 새 공지로 세지 않는다(관리자)', async () => {
  const mine = await noticeService.createNotice(studentId, { title: '내가 쓴 공지', body: '본문' });
  created.push(mine);
  assert.equal((await noticeService.listNotices(studentId)).find((n) => n.id === mine).isNew, false);
});

test('없는 공지는 읽음으로 기록하지 않는다', async () => {
  assert.equal(await noticeService.markRead(studentId, 99999999), false);
});

test('없는 공지는 수정·삭제할 수 없고, 지운 공지는 목록에서 빠진다', async () => {
  const id = await noticeService.createNotice(null, { title: '지울 공지', body: '본문' });
  created.push(id);
  assert.equal(await noticeService.deleteNotice(id), true);
  assert.equal(await noticeService.deleteNotice(id), false);
  assert.equal(await noticeService.updateNotice(id, { title: 't', body: 'b' }), false);
  assert.ok(!(await noticeService.listNotices(studentId)).some((n) => n.id === id));
});
