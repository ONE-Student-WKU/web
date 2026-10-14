const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateHomeLayout, parseHomeLayout } = require('../services/homeLayout');

/**
 * server/test/homeLayout.test.js
 * 홈 화면 편집 설정 검증(DB 없음): 하단 바는 정해진 후보 중 정확히 3칸·중복 없음, 카드는 아는 이름만, 숨긴 카드는 순서 목록 안에서만, 메뉴는 숨길 수 없음.
 * null은 기본 배치로 되돌리기.
 */

const ok = { tabs: ['graduation', 'career', 'community'], cards: { order: ['progress', 'shortfall', 'menu'], hidden: [] } };

test('정상 설정과 null(기본 배치)은 받는다', () => {
  assert.deepEqual(validateHomeLayout(ok), { layout: ok });
  assert.deepEqual(validateHomeLayout(null), { layout: null });
  const custom = { tabs: ['inquiry', 'courses', 'career'], cards: { order: ['menu', 'progress', 'shortfall'], hidden: ['shortfall'] } };
  assert.deepEqual(validateHomeLayout(custom), { layout: custom });
});

test('하단 바가 3칸이 아니거나, 중복이거나, 모르는 이름이면 거부한다', () => {
  const bad = (tabs) => validateHomeLayout({ ...ok, tabs }).error;
  assert.equal(bad(['graduation', 'career']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['graduation', 'career', 'community', 'courses']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['graduation', 'graduation', 'career']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['home', 'career', 'community']), 'INVALID_HOME_LAYOUT', '홈은 고정 칸이라 고를 수 없다');
  assert.equal(bad(['chat', 'career', 'community']), 'INVALID_HOME_LAYOUT', '챗봇은 고정 칸이라 고를 수 없다');
});

test('카드 이름이 틀리거나, 중복이거나, 순서에 없는 카드를 숨기면 거부한다', () => {
  const bad = (cards) => validateHomeLayout({ ...ok, cards }).error;
  assert.equal(bad({ order: ['progress', 'unknown'], hidden: [] }), 'INVALID_HOME_LAYOUT');
  assert.equal(bad({ order: ['progress', 'progress'], hidden: [] }), 'INVALID_HOME_LAYOUT');
  assert.equal(bad({ order: ['progress'], hidden: ['shortfall'] }), 'INVALID_HOME_LAYOUT');
  assert.equal(bad({ order: ['progress', 'shortfall', 'menu'], hidden: ['menu'] }), 'INVALID_HOME_LAYOUT', '메뉴는 숨길 수 없다');
  assert.equal(bad(null), 'INVALID_HOME_LAYOUT');
  assert.equal(validateHomeLayout('x').error, 'INVALID_HOME_LAYOUT');
  assert.equal(validateHomeLayout([]).error, 'INVALID_HOME_LAYOUT');
});

test('parseHomeLayout: NULL·깨진 값은 null, 문자열 JSON은 객체로', () => {
  assert.equal(parseHomeLayout(null), null);
  assert.equal(parseHomeLayout('not json'), null);
  assert.equal(parseHomeLayout('[1]'), null);
  assert.deepEqual(parseHomeLayout(JSON.stringify(ok)), ok);
});
