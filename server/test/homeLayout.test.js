const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateHomeLayout, parseHomeLayout } = require('../services/homeLayout');

/**
 * server/test/homeLayout.test.js
 * 홈 화면 편집 설정 검증(DB 없음): 하단 바는 정해진 후보(홈 포함) 중 정확히 4칸·중복 없음, showTabBar는 true/false.
 * 챗봇은 가운데 고정이라 고를 수 없다. null은 기본 배치로 되돌리기.
 */

const ok = { tabs: ['home', 'graduation', 'career', 'community'], showTabBar: true };

test('정상 설정과 null(기본 배치)은 받는다 — 홈을 빼거나 하단 바를 끈 설정도 받는다', () => {
  assert.deepEqual(validateHomeLayout(ok), { layout: ok });
  assert.deepEqual(validateHomeLayout(null), { layout: null });
  const custom = { tabs: ['inquiry', 'courses', 'career', 'graduation'], showTabBar: false };
  assert.deepEqual(validateHomeLayout(custom), { layout: custom });
});

test('하단 바가 4칸이 아니거나, 중복이거나, 모르는 이름(챗봇 포함)이면 거부한다', () => {
  const bad = (tabs) => validateHomeLayout({ ...ok, tabs }).error;
  assert.equal(bad(['home', 'graduation', 'career']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['home', 'graduation', 'career', 'community', 'courses']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['home', 'home', 'career', 'community']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['chat', 'graduation', 'career', 'community']), 'INVALID_HOME_LAYOUT', '챗봇은 가운데 고정이라 고를 수 없다');
});

test('showTabBar가 true/false가 아니거나 형식이 틀리면 거부한다', () => {
  assert.equal(validateHomeLayout({ ...ok, showTabBar: 'yes' }).error, 'INVALID_HOME_LAYOUT');
  assert.equal(validateHomeLayout({ tabs: ok.tabs }).error, 'INVALID_HOME_LAYOUT');
  assert.equal(validateHomeLayout('x').error, 'INVALID_HOME_LAYOUT');
  assert.equal(validateHomeLayout([]).error, 'INVALID_HOME_LAYOUT');
});

test('parseHomeLayout: NULL·깨진 값은 null, 문자열 JSON은 객체로', () => {
  assert.equal(parseHomeLayout(null), null);
  assert.equal(parseHomeLayout('not json'), null);
  assert.equal(parseHomeLayout('[1]'), null);
  assert.deepEqual(parseHomeLayout(JSON.stringify(ok)), ok);
});
