const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const noticeService = require('../services/noticeService');

/**
 * server/test/community.notice.test.js
 * 커뮤니티 공지(2026-10-22 피드백): 운영자가 쓰고 학생은 읽기만 한다. 학생이 목록을 본 뒤 올라온 공지만 "새 공지"로 센다.
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

test('한 번도 안 본 학생에게는 모든 공지가 새 공지이고, 목록을 본 뒤에는 0이 된다. 수정해도 다시 새 공지가 되지 않는다', async () => {
  const before = await noticeService.countUnseen(studentId);
  const id = await noticeService.createNotice(null, { title: '테스트 공지', body: '본문' });
  created.push(id);
  assert.equal(await noticeService.countUnseen(studentId), before + 1);
  const listed = (await noticeService.listNotices(studentId)).find((n) => n.id === id);
  assert.equal(listed.isNew, true);
  assert.equal(listed.title, '테스트 공지');

  await noticeService.markSeen(studentId);
  assert.equal(await noticeService.countUnseen(studentId), 0);
  assert.equal((await noticeService.listNotices(studentId)).find((n) => n.id === id).isNew, false);

  assert.equal(await noticeService.updateNotice(id, { title: '고친 공지', body: '고친 본문' }), true);
  assert.equal(await noticeService.countUnseen(studentId), 0);
  const updated = (await noticeService.listNotices(studentId)).find((n) => n.id === id);
  assert.equal(updated.title, '고친 공지');
  assert.ok(updated.updatedAt);
});

test('없는 공지는 수정·삭제할 수 없고, 지운 공지는 목록에서 빠진다', async () => {
  const id = await noticeService.createNotice(null, { title: '지울 공지', body: '본문' });
  created.push(id);
  assert.equal(await noticeService.deleteNotice(id), true);
  assert.equal(await noticeService.deleteNotice(id), false);
  assert.equal(await noticeService.updateNotice(id, { title: 't', body: 'b' }), false);
  assert.ok(!(await noticeService.listNotices(studentId)).some((n) => n.id === id));
});
