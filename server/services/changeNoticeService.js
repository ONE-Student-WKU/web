const crypto = require('crypto');
const pool = require('../db');
const { updatesSince } = require('./dataUpdates');

/**
 * server/services/changeNoticeService.js
 * 바뀐 자료 알림 — 학교 기준·자료가 갱신돼 "내 진단 결과가 실제로 바뀐" 학생에게만 홈에서 알린다.
 *
 * 학생마다 마지막으로 확인한 진단 요약과 그때의 입력 지문을 한 줄 둔다(db/schema.sql 14, graduation_snapshots).
 * 진단을 계산할 때마다(GET /api/graduation/status) 지금 요약과 비교한다:
 *  - 기준이 없음(처음) → 기준만 저장
 *  - 입력이 바뀜(학생이 과목·학과를 고침) → 알리지 않고 기준만 갱신
 *  - 입력은 그대로인데 요약이 다름 → 알림(기준 → 지금). 알림 목록을 쌓지 않아서 여러 번 바뀌어도 한 장으로 합쳐지고,
 *    바뀌었다가 돌아온 항목은 저절로 빠진다
 * 학생이 [확인]하면 지금 요약이 새 기준이 된다.
 */

// 진단에 쓰는 학생 정보만 지문에 넣는다 — 접속 시각·언어·동의처럼 진단과 무관하게 바뀌는 칸이 들어가면 "입력이 바뀜"으로 읽혀 알림이 뜨지 않는다.
const STUDENT_INPUT_FIELDS = [
  'department_id', 'track_id', 'admission_year', 'enrollment_type',
  'major_change_grade', 'major_change_year', 'major_change_semester', 'major_change_recognition',
  'transfer_grade', 'transfer_recognized_credits', 'teaching_course', 'major_track_type',
  'second_department_id', 'second_major_type', 'second_linked_major', 'leave_semesters', 'leave_periods',
];

function inputHash(student, courses) {
  const picked = Object.fromEntries(STUDENT_INPUT_FIELDS.map((f) => [f, student[f] ?? null]));
  picked.micro_degrees = student.micro_degrees || [];
  const sorted = [...courses].sort((a, b) => a.id - b.id);
  return crypto.createHash('sha256').update(JSON.stringify({ student: picked, courses: sorted })).digest('hex');
}

/**
 * 진단 결과에서 비교할 값만 뽑는다. 날짜에 따라 바뀌는 값(수강 중 학점, 등록 학기 수)은 넣지 않는다 — 학기가 넘어갈 때마다
 * 모든 학생에게 알림이 뜬다. 일반선택은 전공·교양 초과분이 채우는 항목이라 화면처럼 목표로 보지 않는다.
 * 반환: { key: { kind, category?, unit, value } }
 */
function summarize(status) {
  const items = {};
  const put = (key, item) => {
    items[key] = item;
  };
  put('total', { kind: 'total', unit: 'credits', value: Number(status.totalRequiredCredits) || 0 });
  put('remaining', {
    kind: 'remaining',
    unit: 'credits',
    value: Math.max(0, (Number(status.totalRequiredCredits) || 0) - (Number(status.totalEarnedCredits) || 0)),
  });
  for (const c of status.categories || []) {
    if (c.category === '일반선택') continue;
    put(`required:${c.category}`, { kind: 'required', category: c.category, unit: 'credits', value: Number(c.requiredCredits) || 0 });
  }
  for (const c of status.certifications || []) {
    put(`certRequired:${c.category}`, { kind: 'certRequired', category: c.category, unit: 'courses', value: Number(c.minCourseCount) || 0 });
    put(`certRemaining:${c.category}`, {
      kind: 'certRemaining',
      category: c.category,
      unit: 'courses',
      value: Math.max(0, (Number(c.minCourseCount) || 0) - (c.completedCourses || []).length),
    });
  }
  return items;
}

// 남은 양(remaining)은 없던 항목을 0으로 본다. 필요 양은 없던 항목이면 "없음"(null)이다.
const isRemaining = (kind) => kind === 'remaining' || kind === 'certRemaining';
const ORDER = ['total', 'required', 'certRequired', 'remaining', 'certRemaining'];

/**
 * 두 요약에서 달라진 항목만 [{ key, kind, category?, unit, before, after }]로. 요건 자료가 없던(졸업 학점 0) 쪽이 있으면
 * 비교하지 않는다 — 자료가 처음 들어온 학과는 모든 항목이 "새로 생겼어요"가 된다.
 */
function diffSummaries(before, after) {
  if (!before || !after) return [];
  if (!(before.total && before.total.value > 0) || !(after.total && after.total.value > 0)) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes = [];
  for (const key of keys) {
    const base = after[key] || before[key];
    const zero = isRemaining(base.kind) ? 0 : null;
    const from = before[key] ? before[key].value : zero;
    const to = after[key] ? after[key].value : zero;
    if (from === to) continue;
    changes.push({ key, kind: base.kind, ...(base.category ? { category: base.category } : {}), unit: base.unit, before: from, after: to });
  }
  return changes.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

function kstDate(date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(date));
}

function parseJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function loadInputs(studentId) {
  const [[student]] = await pool.query(`SELECT ${STUDENT_INPUT_FIELDS.join(', ')} FROM students WHERE id = ?`, [studentId]);
  if (!student) return null;
  const [micro] = await pool.query('SELECT micro_degree_name FROM student_micro_degrees WHERE student_id = ? ORDER BY id', [studentId]);
  const [courses] = await pool.query(
    `SELECT id, course_id, name, credits, category, major_area, counted_major, course_code, offering_department_id, year, semester,
            midterm, final, attendance_score, assignment, etc, gpa, letter_grade
     FROM student_courses WHERE student_id = ?`,
    [studentId]
  );
  return { student: { ...student, micro_degrees: micro.map((r) => r.micro_degree_name) }, courses };
}

/**
 * 진단을 계산한 뒤 부른다. 알릴 게 있으면 { since, items, updates }, 없으면 null.
 * since: 기준을 맞춘 날(KST 'YYYY-MM-DD'), updates: 그날 이후 반영된 갱신 [{ date, note }](dataUpdates.js)
 */
async function observe(studentId, status) {
  const inputs = await loadInputs(studentId);
  if (!inputs) return null;
  const hash = inputHash(inputs.student, inputs.courses);
  const current = summarize(status);
  const [[row]] = await pool.query('SELECT input_hash, summary, pending_summary, seen_at FROM graduation_snapshots WHERE student_id = ?', [studentId]);

  const resetBaseline = () =>
    pool.query(
      `INSERT INTO graduation_snapshots (student_id, input_hash, summary, pending_summary, seen_at) VALUES (?, ?, ?, NULL, NOW())
       ON DUPLICATE KEY UPDATE input_hash = VALUES(input_hash), summary = VALUES(summary), pending_summary = NULL, seen_at = NOW()`,
      [studentId, hash, JSON.stringify(current)]
    );

  // 처음이거나 학생이 입력을 바꿨으면 어느 쪽 때문에 달라졌는지 가를 수 없다 — 알리지 않고 지금 결과를 기준으로 삼는다.
  if (!row || row.input_hash !== hash) {
    await resetBaseline();
    return null;
  }

  const items = diffSummaries(parseJson(row.summary), current);
  if (items.length === 0) {
    // 바뀐 게 없으면 기준 시각만 오늘로 맞춘다(하루 한 번) — "지난 접속" 날짜와 갱신 목록의 시작점이 된다.
    // 알림이 떠 있다가 원래대로 돌아왔으면 알림도 지운다.
    if (row.pending_summary != null || kstDate(row.seen_at) !== kstDate(new Date())) await resetBaseline();
    return null;
  }

  const pending = JSON.stringify(current);
  if (JSON.stringify(parseJson(row.pending_summary)) !== pending) {
    await pool.query('UPDATE graduation_snapshots SET pending_summary = ? WHERE student_id = ?', [pending, studentId]);
  }
  const since = kstDate(row.seen_at);
  return { since, items, updates: updatesSince(since) };
}

// 학생이 [확인]·[진단 보기]를 누르면 지금 요약이 새 기준이 된다. 알림이 없었으면 false.
async function acknowledge(studentId) {
  const [result] = await pool.query(
    `UPDATE graduation_snapshots SET summary = pending_summary, pending_summary = NULL, seen_at = NOW()
     WHERE student_id = ? AND pending_summary IS NOT NULL`,
    [studentId]
  );
  return result.affectedRows > 0;
}

module.exports = { observe, acknowledge, summarize, diffSummaries, inputHash, STUDENT_INPUT_FIELDS };
