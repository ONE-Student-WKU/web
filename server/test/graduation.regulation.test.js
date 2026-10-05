const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getGraduationStatus } = require('../services/graduationService');

/**
 * server/test/graduation.regulation.test.js
 * 졸업진단이 규정 판단 엔진에 연결된 뒤(파트 3, DECISIONS D-32)의 동작:
 *  - 응답에 근거 신뢰도(regulation)가 붙는다(기존 필드 모양은 그대로)
 *  - 교양 인정 상한: 근거가 갈리는 2021학번 이하도 더 엄격한 52를 적용하고(보수적), 엔진의 "상한 없음(추정)"은 플래그로만 남긴다
 *  - 자료 없는 학과·학번은 다른 행으로 채우지 않고 빈 요건 + 자료없음
 *  - 판단 보류 학과·편입생은 "추정"
 * 전제: 로컬 시드. 임시 학생 1명을 만들고 끝나면 지운다(이수 과목은 학생 삭제 시 CASCADE).
 */

let studentId;
const D = {};

before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
  const [r] = await pool.query("INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())", [`grad-reg-${Date.now()}@example.test`, `gradreg${Date.now()}`]);
  studentId = r.insertId;
});

after(async () => {
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

async function setStudent(department, admissionYear, enrollmentType = 'GENERAL', mc = null) {
  await pool.query(
    'UPDATE students SET department_id = ?, admission_year = ?, enrollment_type = ?, major_change_grade = ?, major_change_year = ?, major_change_semester = ? WHERE id = ?',
    [D[department], admissionYear, enrollmentType, mc ? mc.grade : null, mc ? mc.year : null, mc ? mc.semester : null, studentId]
  );
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
}

const codes = (s) => s.regulation.flags.map((f) => f.code);

test('응답 모양: 기존 필드 + regulation(신뢰도·플래그·교양 상한), 2026학번 간호학과 일반 = 확정', async () => {
  await setStudent('간호학과', 2026);
  const s = await getGraduationStatus(studentId);
  for (const k of ['totalRequiredCredits', 'totalEarnedCredits', 'categories', 'certifications']) assert.ok(k in s, k);
  assert.ok(s.totalRequiredCredits > 0);
  assert.equal(s.regulation.confidence, 'CONFIRMED');
  assert.equal(s.regulation.confidenceLabel, '확정');
  assert.deepEqual(s.regulation.liberalArtsCap, { applied: 52, engineValue: 52 });
  assert.equal(s.regulation.totalDefinitive, true);
});

test('교양 상한: 2021학번은 근거가 갈려 엔진은 "상한 없음(추정)"이지만 진단은 더 엄격한 52를 적용한다(예전과 같은 숫자)', async () => {
  await setStudent('컴퓨터·소프트웨어공학과', 2021);
  // 교양선택 60학점 이수 → 52까지만 인정되면 교양 요구학점을 다 채우고 초과분(52-요구)만 일반선택으로 흐른다.
  for (let i = 0; i < 20; i++) {
    await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, ?, 3, '교양선택', 2021, 1)", [studentId, `교양테스트${i}`]);
  }
  const s = await getGraduationStatus(studentId);
  assert.deepEqual(s.regulation.liberalArtsCap, { applied: 52, engineValue: null });
  assert.ok(codes(s).includes('LIBERAL_CAP_PRE_2022_SINGLE_SOURCE'));
  assert.equal(s.regulation.confidence, 'ESTIMATED');
  const liberalRequired = s.categories.filter((c) => c.category === '교양필수' || c.category === '교양선택').reduce((a, c) => a + c.requiredCredits, 0);
  const general = s.categories.find((c) => c.category === '일반선택');
  // 상한 52 적용: 일반선택으로 넘어가는 교양 초과분 = 52 - 교양 요구학점(상한이 없었다면 60 - 교양 요구학점)
  assert.equal(general.earnedCredits, Math.min(general.requiredCredits, 52 - liberalRequired));
});

test('1·2학년 전과 + 컷오프 이전: 총 요구학점이 일반 재학생과 같다(예전 142 → 136)', async () => {
  await setStudent('컴퓨터·소프트웨어공학과', 2021, 'MAJOR_CHANGE', { grade: 2, year: 2022, semester: 1 });
  const mc = await getGraduationStatus(studentId);
  await setStudent('컴퓨터·소프트웨어공학과', 2021);
  const general = await getGraduationStatus(studentId);
  assert.equal(mc.totalRequiredCredits, general.totalRequiredCredits);
  assert.equal(mc.totalRequiredCredits, 136);
  assert.ok(codes(mc).includes('LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS'), '29학점 갈래는 추정 플래그');
});

test('자료 없는 학과·학번: 다른 행으로 채우지 않고 빈 요건 + 자료없음(예전: 인증제 행만 보임)', async () => {
  await setStudent('공학3계열', 2018);
  const s = await getGraduationStatus(studentId);
  assert.deepEqual([s.totalRequiredCredits, s.categories, s.certifications], [0, [], []]);
  assert.equal(s.regulation.confidence, 'NO_DATA');
  assert.ok(codes(s).includes('NO_CURRICULUM_ROWS'));
});

test('판단 보류 학과(2024 국어교육과 자유선택 32 vs 34, 이슈 #260): 숫자는 그대로, 신뢰도는 추정', async () => {
  await setStudent('국어교육과', 2024);
  const s = await getGraduationStatus(studentId);
  assert.ok(s.totalRequiredCredits > 0);
  assert.equal(s.regulation.confidence, 'ESTIMATED');
  assert.ok(codes(s).includes('DATA_PENDING_HOLD'));
});

test('편입생: 카테고리 합은 보여주되 총량은 확정 아님(totalDefinitive=false)', async () => {
  await setStudent('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION');
  const s = await getGraduationStatus(studentId);
  assert.equal(s.regulation.totalDefinitive, false);
  assert.ok(codes(s).includes('TRANSFER_TOTAL_UNRESOLVED'));
  assert.equal(s.regulation.confidence, 'ESTIMATED');
});

test('챗봇 시스템 프롬프트: 진단 신뢰도가 확정이 아니면 "남은 학점" 단정 금지, 자료없음이면 추정 금지', async () => {
  const { buildSystemPrompt } = require('../services/aiClient');
  await setStudent('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION');
  const transfer = buildSystemPrompt(null, await getGraduationStatus(studentId));
  assert.match(transfer, /요건 신뢰도는 "추정"이다\. 아래 숫자를 확정처럼 말하지 말고/);
  assert.match(transfer, /분모는 확정값이 아니다/);

  await setStudent('간호학과', 2026);
  const confirmed = buildSystemPrompt(null, await getGraduationStatus(studentId));
  assert.doesNotMatch(confirmed, /확정처럼 말하지 말고/);

  await setStudent('공학3계열', 2018);
  const none = buildSystemPrompt(null, await getGraduationStatus(studentId));
  assert.match(none, /졸업요건 자료가 시스템에 없다/);
  assert.doesNotMatch(none, /졸업까지 \d+학점 남음/);
});
