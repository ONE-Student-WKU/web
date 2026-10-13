const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildDatasets, parseTimeRaw } = require('../scripts/seedCourseOfferings');

/**
 * server/test/seedCourseOfferings.datasets.test.js
 * 개설과목 시드의 두 원본(컴소공·공학3계열 2017~2026 / 전 학과 2026-2)을 묶음 목록으로 만드는 규칙과,
 * 전 학과 원본 파일(db/curriculum/_source/전공시간표_2026-2_전학과.json) 자체의 형식을 DB 없이 검사한다.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const ALL = require(path.join(ROOT, 'db', 'curriculum', '_source', '전공시간표_2026-2_전학과.json'));
const DEPARTMENTS = require(path.join(ROOT, 'db', 'seed', 'departments.json'));

const row = (courseCode, section = '01') => ({ grade: '1', category: '기전', courseCode, courseName: courseCode, section, credits: '3.0', time: '월12' });

test('같은 학과·학기가 전 학과 원본에 있으면 옛 원본은 건너뛰고(새 자료가 대체), 없는 학기는 옛 원본을 쓴다', () => {
  const legacy = { '컴퓨터·소프트웨어공학과_2026_2': [row('OLD2')], '컴퓨터·소프트웨어공학과_2026_1': [row('OLD1')] };
  const all = { entries: [{ department: '컴퓨터·소프트웨어공학과', track: null, college: '창의공과대학', printedName: '컴퓨터·소프트웨어공학과', year: 2026, semester: 2, rows: [row('NEW2')] }] };
  const ds = buildDatasets(legacy, all);
  // 원본 학기 번호(1·2)는 DB 학기 코드(1=1학기, 3=2학기)로 바뀐다.
  const bySem = Object.fromEntries(ds.map((d) => [d.semester, d.rows.map((r) => r.courseCode)]));
  assert.deepEqual(bySem, { 3: ['NEW2'], 1: ['OLD1'] });
});

test('앱 학과로 연결되지 않은 항목(department 없음)은 넣지 않고, 트랙은 항목에 적힌 그대로 넘긴다', () => {
  const all = {
    entries: [
      { department: '공학2계열', track: '전기공학전공', college: '공과대학', printedName: '공학2계열 전기공학전공', year: 2026, semester: 2, rows: [row('M05001')] },
      { department: null, track: null, college: 'JST공유대학', printedName: '에너지신산업학부 이차전지전공', year: 2026, semester: 2, rows: [row('X1')] },
    ],
  };
  const ds = buildDatasets({}, all);
  assert.equal(ds.length, 1);
  assert.equal(ds[0].departmentName, '공학2계열');
  assert.equal(ds[0].trackName, '전기공학전공');
});

test('전 학과 원본: 모든 항목의 학과·트랙이 앱 학과 목록에 있고, 행 형식(학년·학수번호·분반·학점)이 맞다', () => {
  const list = Array.isArray(DEPARTMENTS) ? DEPARTMENTS : DEPARTMENTS.departments || Object.values(DEPARTMENTS)[0];
  const tracks = new Map(list.map((d) => [d.name, new Set((d.tracks || []).map((t) => t.name || t))]));
  assert.ok(ALL.entries.length >= 100, `${ALL.entries.length}개`);
  for (const e of ALL.entries) {
    const label = `${e.college} > ${e.printedName}`;
    assert.ok(tracks.has(e.department), `${label}: 앱에 없는 학과 ${e.department}`);
    if (e.track) assert.ok(tracks.get(e.department).has(e.track), `${label}: ${e.department}에 없는 트랙 ${e.track}`);
    assert.equal(e.year, 2026, label);
    assert.equal(e.semester, 2, label);
    assert.ok(e.rows.length > 0, `${label}: 빈 표`);
    for (const r of e.rows) {
      assert.match(r.grade, /^[1-6]$/, `${label} ${r.courseName}`);
      assert.match(r.courseCode, /^[A-Z0-9]{5,7}$/, `${label} ${r.courseName}`);
      assert.match(r.section, /^\d{2}$/, `${label} ${r.courseName}`);
      assert.match(r.credits, /^\d+\.\d$/, `${label} ${r.courseName}`);
      assert.ok(r.courseName, `${label}: 과목명 없음`);
    }
  }
  for (const e of ALL.unmapped) assert.equal(e.department, null);
});

test('시간 표기: 10교시부터는 "10" 다음에 끝자리만 찍힌다("9101" = 9·10·11) — 한 글자씩 읽어 1교시가 두 번 나오면 안 된다', () => {
  const slots = (t) => parseTimeRaw(t).map((s) => `${s.day}${s.period}`).join(',');
  assert.equal(slots('월34화56'), '월3,월4,화5,화6');
  assert.equal(slots('수3목12'), '수3,목1,목2', '10이 없으면 12는 1·2교시');
  assert.equal(slots('월910'), '월9,월10');
  assert.equal(slots('월9101'), '월9,월10,월11');
  assert.equal(slots('월1012'), '월10,월11,월12');
  assert.equal(slots('금12345678910'), '금1,금2,금3,금4,금5,금6,금7,금8,금9,금10');
  assert.equal(slots('토9101'), '', '토·일은 앱 시간표(월~금)에 칸이 없어 나누지 않는다');
});

test('전 학과 원본의 모든 시간 값은 같은 요일·교시가 두 번 나오지 않는다(uq_course_offering_schedules)', () => {
  for (const e of ALL.entries) {
    for (const r of e.rows) {
      const s = parseTimeRaw(r.time).map((x) => `${x.day}${x.period}`);
      assert.equal(new Set(s).size, s.length, `${e.printedName} ${r.courseName} [${r.time}]`);
    }
  }
});
