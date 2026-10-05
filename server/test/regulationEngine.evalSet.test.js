const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { resolveApplicableRulesForStudent } = require('../services/regulationEngine');
const { resolveYearContext } = require('../services/yearContext');
const { assembleStructuredChunks, mergeChunks } = require('../services/chatContextService');
const { getGraduationStatus } = require('../services/graduationService');
const { buildSystemPrompt } = require('../services/aiClient');
const { SCENARIOS, NEEDS_HUMAN_REVIEW } = require('../test-helpers/regulationEvalSet');

/**
 * server/test/regulationEngine.evalSet.test.js
 * 평가 세트(test-helpers/regulationEvalSet.js) 실행. 시나리오마다 세 층을 본다:
 *  1) 엔진: 전체 신뢰도, 규칙별 status, 플래그, C등급 구간의 "기록 없음(검증 안 됨)"
 *  2) 챗봇 근거(AI 호출 없음): 판단 청크가 맨 앞에 오고, 신뢰도와 그에 맞는 답변 지침(확정이 아니면 단정 금지 + 학사지원과)이 실린다
 *  3) 졸업진단: 총 요구학점과 진단 신뢰도
 * NEEDS_HUMAN_REVIEW 시나리오는 정답 숫자 대신 "확정이라고 말하지 않는다"를 검증한다.
 * 전제: 로컬 시드 + seed:lineage + generate:curriculum-changes + seed:regulation-articles. 임시 학생 1명을 만들고 지운다.
 */

const DEFAULT_AS_OF = '2026-10-05';
const BOOKS = [2024, 2025, 2026];
const NOT_CONFIRMED_GUIDE = /단정하지 마|단정하지 말|추정해 답하지 말/;
const D = {};
let studentId;

before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
  const [r] = await pool.query("INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())", [`evalset-${Date.now()}@example.test`, `evalset${Date.now()}`]);
  studentId = r.insertId;
});

after(async () => {
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const engineInput = (s) => ({
  departmentName: s.input.department,
  admissionYear: s.input.admissionYear,
  enrollmentType: s.input.enrollmentType,
  majorChange: s.input.majorChange,
  asOfDate: s.input.asOfDate || DEFAULT_AS_OF,
});
// students 테이블 행 모양(챗봇·졸업진단은 학생 행을 받는다)
const studentRow = (s) => ({
  id: studentId,
  department_id: D[s.input.department] ?? null,
  admission_year: s.input.admissionYear,
  enrollment_type: s.input.enrollmentType,
  major_change_grade: s.input.majorChange ? s.input.majorChange.grade : null,
  major_change_year: s.input.majorChange ? s.input.majorChange.year : null,
  major_change_semester: s.input.majorChange ? s.input.majorChange.semester : null,
});

test('평가 세트 구성: 20~35개, 판단 보류(#260)·C등급 구간·자료 없음 포함, EVAL_SET.md에 전부 기록', () => {
  assert.ok(SCENARIOS.length >= 20 && SCENARIOS.length <= 35, `${SCENARIOS.length}개`);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length, 'id 중복');
  assert.ok(SCENARIOS.filter((s) => (s.expected.flags || []).includes('DATA_PENDING_HOLD')).length >= 8, '판단 보류 시나리오');
  assert.ok(SCENARIOS.filter((s) => s.expected.confidence === 'INSUFFICIENT').length >= 4, 'C등급(자료 불충분) 시나리오');
  assert.ok(SCENARIOS.filter((s) => s.expected.confidence === 'NO_DATA').length >= 3, '자료 없음 시나리오');
  for (const s of SCENARIOS) assert.ok(s.why, `${s.id}: 기대값 근거(why) 필요`);
  const md = fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'regulation-engine', 'EVAL_SET.md'), 'utf8');
  for (const s of SCENARIOS) assert.match(md, new RegExp(`\\| ${s.id} \\|`), `EVAL_SET.md에 ${s.id} 없음`);
});

for (const s of SCENARIOS) {
  test(`${s.id} ${s.title}`, async () => {
    const e = s.expected;

    // 1) 엔진
    const j = await resolveApplicableRulesForStudent(engineInput(s));
    assert.equal(j.confidence, e.confidence, `${s.id} 전체 신뢰도 (플래그: ${j.flags.map((f) => f.code).join(',')})`);
    if (e.review === NEEDS_HUMAN_REVIEW) assert.notEqual(j.confidence, 'CONFIRMED', `${s.id}: 사람 확인이 필요한 시나리오를 확정으로 내면 안 된다`);
    const codes = new Set(j.flags.map((f) => f.code));
    for (const f of e.flags || []) assert.ok(codes.has(f), `${s.id}: 플래그 ${f} 없음`);
    for (const f of e.notFlags || []) assert.ok(!codes.has(f), `${s.id}: 플래그 ${f}가 있으면 안 됨`);
    for (const [code, status] of Object.entries(e.rules || {})) {
      const r = j.rules.find((x) => x.ruleCode === code);
      assert.ok(r, `${s.id}: 규칙 ${code} 없음`);
      assert.equal(r.status, status, `${s.id}: ${code} status`);
    }
    for (const [code, flags] of Object.entries(e.ruleFlags || {})) {
      const r = j.rules.find((x) => x.ruleCode === code);
      for (const f of flags) assert.ok(r.flags.some((x) => x.code === f), `${s.id}: ${code}의 플래그 ${f} 없음`);
    }
    // C등급 구간의 학년도는 "변경 없음"(확인됨)이 아니라 "기록 없음(검증 안 됨)" 또는 "변경 있음(자료 검증 안 됨…)"이어야 한다.
    for (const y of e.historyNotVerified || []) {
      const row = j.history.years.find((x) => x.year === y);
      assert.match(row.courses.label, /검증 안 됨/, `${s.id}: ${y}학년도`);
      assert.notEqual(row.courses.status, 'NO_CHANGE', `${s.id}: ${y}학년도`);
    }

    // 2) 챗봇 근거(질문이 있는 시나리오)
    if (s.question) {
      const student = studentRow(s);
      const yearContext = resolveYearContext({ message: s.question, profileCohort: student.admission_year, availableBookYears: BOOKS, today: s.input.asOfDate || DEFAULT_AS_OF });
      const structured = await assembleStructuredChunks({ message: s.question, searchText: s.question, student, yearContext });
      if (!student.department_id) {
        assert.deepEqual(structured.regulation, [], `${s.id}: 학과를 모르면 판단 청크를 만들지 않는다`);
      } else {
        const merged = mergeChunks({ structured, yearContext });
        const top = merged[0];
        assert.match(top.chunkId, /^regulation-judgment-/, `${s.id}: 판단 청크가 맨 앞`);
        assert.equal(top.confidence, e.confidence, `${s.id}: 챗봇 판단 신뢰도 = 엔진 신뢰도`);
        assert.ok(top.content.includes(`전체 신뢰도: ${j.confidenceLabel}`), `${s.id}: 신뢰도 표시`);
        if (e.confidence === 'CONFIRMED') {
          assert.match(top.content, /근거 조문을 함께 밝혀 답하라/);
        } else {
          assert.match(top.content, NOT_CONFIRMED_GUIDE, `${s.id}: 단정 금지 지시`);
          assert.match(top.content, /학사지원과\(063-850-5228\)/, `${s.id}: 확인처 안내`);
        }
        if ((e.historyNotVerified || []).length) {
          assert.match(top.content, /검증 안 됨/, `${s.id}: C등급 구간 표시`);
          if (j.history.years.some((y) => y.courses.status === 'NOT_VERIFIED')) assert.match(top.content, /"변경 없다"고 답하지 마라/, `${s.id}: C등급 구간 경고`);
        }
        // 예전 고정 문구(이후 변경은 이 학번에 적용되지 않는다)가 다시 들어가면 안 된다
        assert.ok(!merged.some((c) => /이 학번에는 적용되지 않는다/.test(c.content)), `${s.id}: 단정 문구`);
      }
    }

    // 3) 졸업진단
    if (s.graduation) {
      const g = s.graduation;
      const row = studentRow(s);
      await pool.query(
        'UPDATE students SET department_id = ?, admission_year = ?, enrollment_type = ?, major_change_grade = ?, major_change_year = ?, major_change_semester = ? WHERE id = ?',
        [row.department_id, row.admission_year, row.enrollment_type, row.major_change_grade, row.major_change_year, row.major_change_semester, studentId]
      );
      const status = await getGraduationStatus(studentId);
      if (g.total !== undefined) assert.equal(status.totalRequiredCredits, g.total, `${s.id}: 총 요구학점`);
      if (g.confidence) assert.equal(status.regulation.confidence, g.confidence, `${s.id}: 진단 신뢰도 (${status.regulation.flags.map((f) => f.code).join(',')})`);
      if (g.holdFlag) assert.ok(status.regulation.flags.some((f) => f.code === 'DATA_PENDING_HOLD'), `${s.id}: 판단 보류 플래그`);
      if (g.schedule4) assert.deepEqual([status.regulation.schedule4.schedule4Credits, status.regulation.schedule4.bookCredits], g.schedule4, `${s.id}: [별표 4] 대조`);
      if (g.totalDefinitive !== undefined) assert.equal(status.regulation.totalDefinitive, g.totalDefinitive);
      if (g.liberalCapApplied !== undefined) assert.equal(status.regulation.liberalArtsCap.applied, g.liberalCapApplied);
      if (status.regulation.confidence !== 'CONFIRMED') {
        // 챗봇에 넘어가는 졸업 현황 노트도 단정하지 않게 바뀌어야 한다
        assert.match(buildSystemPrompt(null, status), /확정처럼 말하지 말고|자료가 시스템에 없다/, `${s.id}: 진단 노트`);
      }
    }
  });
}
