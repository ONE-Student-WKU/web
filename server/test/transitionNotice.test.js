const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
const { LATER_CHANGE_NOTICE } = require('../services/curriculumContextService');

/**
 * server/test/transitionNotice.test.js
 * "이 학번 이후 변경은 적용되지 않는다"는 고정 단정 문구를 경과조치 조건부 문구로 바꾼 것에 대한 회귀 테스트(DB 쿼리 없음).
 *  1) 근거 청크·AI 프롬프트에 단정 문구가 다시 들어오지 않는다
 *  2) 문구가 인용하는 학칙시행규칙 제5조·제13조①~④·제118조의 핵심 구절이 실제 원문에 있다(조문을 지어내지 않았는지)
 */

after(async () => {
  await pool.end();
});

const RULES = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'regulations', '_source', '원광대학교_학칙시행규칙_전문.txt'), 'utf8');
const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');

test('근거 청크 문구: 단정하지 않고 경과조치·제13조를 인용한다', () => {
  assert.doesNotMatch(LATER_CHANGE_NOTICE, /적용되지 않는다/);
  assert.match(LATER_CHANGE_NOTICE, /경과조치에 따라 달라질 수 있어 단정할 수 없다/);
  for (const n of ['①', '②', '③', '④']) assert.ok(LATER_CHANGE_NOTICE.includes(n), `제13조${n} 인용`);
  assert.match(LATER_CHANGE_NOTICE, /제118조/);
});

test('인용한 조문 구절이 학칙시행규칙 원문에 실제로 있다', () => {
  const quotes = [
    '교육과정은 입학 당시의 기준에 따라 이수하되', // 제5조
    '개편된 신 교육과정은 개정 공포일로부터 전 학년에 적용 및 시행한다', // 제13조①
    '필수과목이 선택과목으로 변경되었거나 폐설된 경우 이수하지 않아도 된다', // 제13조②
    '재학 중인 학년보다 저학년에 개설된 경우 이수하지 않아도 된다', // 제13조③
    '수강신청한 학년도 및 학기의 이수구분에 따른다', // 제13조④
    '학번별 경과조치는 「원광대학교 학칙」의 부칙을 따른다', // 제118조
  ];
  for (const q of quotes) assert.ok(norm(RULES).includes(norm(q)), `원문에 없음: ${q}`);
});

test('AI 시스템 프롬프트에도 "자동 적용되지 않는다" 단정이 남아 있지 않다', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'services', 'aiClient.js'), 'utf8');
  assert.doesNotMatch(src, /자동 적용되지 않는다/);
  assert.doesNotMatch(src, /이 학번에는 적용되지 않는다고 분명히 설명하라/);
  assert.match(src, /단정하지 마라/);
});
