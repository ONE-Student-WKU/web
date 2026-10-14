const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateHomeLayout, parseHomeLayout } = require('../services/homeLayout');

/**
 * server/test/homeLayout.test.js
 * 홈 화면 편집 설정 검증(DB 없음): 하단 바는 4자리(빈 자리는 null)·정해진 후보(홈 포함)·중복 없음, showTabBar는 true/false.
 * 챗봇은 가운데 고정이라 고를 수 없다. null은 기본 배치로 되돌리기.
 */

const ok = { tabs: ['home', 'graduation', 'career', 'community'], showTabBar: true };

test('정상 설정과 null(기본 배치)은 받는다 — 홈을 빼거나 하단 바를 끈 설정도 받는다', () => {
  assert.deepEqual(validateHomeLayout(ok), { layout: ok });
  assert.deepEqual(validateHomeLayout(null), { layout: null });
  const custom = { tabs: ['inquiry', 'courses', 'career', 'graduation'], showTabBar: false };
  assert.deepEqual(validateHomeLayout(custom), { layout: custom });
});

test('4자리를 다 채우지 않아도 받는다 — 빈 자리는 null로 위치를 지키고, 모두 비우면 챗봇 버튼만 남는 설정', () => {
  const partial = { tabs: ['home', null, 'career', null], showTabBar: true };
  assert.deepEqual(validateHomeLayout(partial), { layout: partial });
  const empty = { tabs: [null, null, null, null], showTabBar: true };
  assert.deepEqual(validateHomeLayout(empty), { layout: empty });
});

test('하단 바가 4자리가 아니거나, 중복이거나, 모르는 이름(챗봇 포함)이면 거부한다', () => {
  const bad = (tabs) => validateHomeLayout({ ...ok, tabs }).error;
  assert.equal(bad(['home', 'graduation', 'career']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['home', 'graduation', 'career', 'community', 'courses']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['home', 'home', 'career', 'community']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['chat', 'graduation', 'career', 'community']), 'INVALID_HOME_LAYOUT', '챗봇은 가운데 고정이라 고를 수 없다');
  assert.equal(bad(['home', null, 'home', null]), 'INVALID_HOME_LAYOUT', '빈 자리가 있어도 같은 기능은 한 번만');
  assert.equal(bad(['home', '', 'career', null]), 'INVALID_HOME_LAYOUT', '빈 자리는 null로만');
});

test('메뉴(menu)는 홈을 뺀 기능 중 0~5개, 중복 없이 — 없으면 기본 메뉴라 그대로 받는다', () => {
  const menu = ['inquiry', 'community', 'career', 'graduation', 'courses'];
  assert.deepEqual(validateHomeLayout({ ...ok, menu }), { layout: { ...ok, menu } });
  assert.deepEqual(validateHomeLayout({ ...ok, menu: ['career'] }), { layout: { ...ok, menu: ['career'] } }, '카드를 뺄 수 있다');
  assert.deepEqual(validateHomeLayout({ ...ok, menu: [] }), { layout: { ...ok, menu: [] } }, '모두 빼면 메뉴가 없다');
  assert.deepEqual(validateHomeLayout(ok), { layout: ok }, 'menu가 없으면 저장값에도 없다');
  const bad = (m) => validateHomeLayout({ ...ok, menu: m }).error;
  assert.equal(bad(['inquiry', 'community', 'career', 'graduation', 'graduation']), 'INVALID_HOME_LAYOUT');
  assert.equal(bad(['home', 'community', 'career', 'graduation', 'courses']), 'INVALID_HOME_LAYOUT', '홈은 메뉴에 없다');
  assert.equal(bad(null), 'INVALID_HOME_LAYOUT');
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
