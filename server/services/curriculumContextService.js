const pool = require('../db');
const historyService = require('./curriculumHistoryService');
const { DERIVED_RULE_CODES } = require('./curriculumKeys');
const dq = require('./regulationEngine/dataQuality');
const { loadLatestDataYear } = require('./regulationEngine/dbProvider');

/**
 * server/services/curriculumContextService.js
 * 챗봇 근거 청크 중 "연도에 따라 달라지는 교육과정 정보"를 만든다:
 *  - 졸업요건: 질문의 학번/학년도(여러 개면 각각)별로 적용되는 요건
 *  - 변경 이력: 규정·과목이 언제 어떻게 바뀌었는지, 이 학번의 기준표 값, 그리고 이후 변경의 적용 여부는 경과조치(시행규칙 제13조)에 따름
 *  - 학과 개편 관계
 * 청크마다 어느 학번/학년도 기준인지 제목과 본문에 명시해서 모델이 서로 다른 해를 섞지 않게 한다.
 * 연도 판단은 yearContext.js, 변경 이력 데이터는 curriculumHistoryService.js(curriculum_changes 등)를 쓴다.
 */

const MAX_YEARS = 3;
const MAX_COURSES = 3;
const MAX_VERSION_LINES = 12;

const RULE_LABEL = { GRAD_TOTAL: '졸업학점 총계', MAJOR_TOTAL: '전공 이수학점 합계', LIBERAL_TOTAL: '교양 이수학점 합계' };
const SOURCE_LABEL = { NAME_MATCH: '이름 일치로 추정한 개편 관계', DOC: '교육과정 문서에 명시된 개편 관계', MANUAL: '확인된 개편 관계' };
const ACADEMIC_OFFICE = '학사지원과(063-850-5228)';
const ENROLLMENT_HEADER = {
  GENERAL: '일반 재학생 기준',
  MAJOR_CHANGE: '전과생 기준 — 전과 학년·시점에 따른 완화·고정 반영',
  TRANSFER_ADMISSION: '편입생 기준 — 편입 학년 가정, 총량 미확정',
};
const CONFIDENCE_LABEL = { CONFIRMED: '확정', ESTIMATED: '추정', INSUFFICIENT: '자료 불충분(확인 필요)', NO_DATA: '자료없음' };

/** 학칙 [별표 4]와 책자의 졸업학점이 다를 때의 안내 — 두 값을 모두 밝히고 어느 한쪽을 단정하지 않게 한다(DECISIONS D-34). */
function schedule4Line(s) {
  const table = s.tableTitle.replace(/^졸업학점별 대학, 이수학점 및 수료인정학점/, '').replace(/<[^>]*>/g, '');
  return `※ 졸업학점이 서로 다른 두 자료에 있다: 학칙 [별표 4] ${table}은 ${s.entryName} ${s.schedule4Credits}학점 이상, 교육과정 책자 기준은 ${s.bookCredits}학점이다. ` +
    `어느 쪽이 이 학생에게 적용되는지 확인되지 않았다(학칙은 2026.04.10. 개정이고 2026년 8월 졸업자부터 적용). 한쪽이 맞다고 단정하지 말고 두 값을 모두 밝힌 뒤 학과 또는 ${ACADEMIC_OFFICE} 확인을 안내하라.`;
}

// ---------------------------------------------------------------------------
// 학과 판정
// ---------------------------------------------------------------------------

// 메시지에 학과 이름이 있으면 그 학과(가장 긴 이름 우선), 없으면 프로필 학과.
async function resolveDepartment(message, student) {
  const [rows] = await pool.query('SELECT id, name FROM departments');
  const mentioned = rows
    .filter((d) => d.name.length >= 3 && message.includes(d.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (mentioned) return { id: mentioned.id, name: mentioned.name, source: 'message' };
  if (student?.department_id) {
    const own = rows.find((d) => d.id === student.department_id);
    if (own) return { id: own.id, name: own.name, source: 'profile' };
  }
  return null;
}

async function creditRequirementRows(departmentId, year) {
  const [rows] = await pool.query(
    `SELECT category, required_credits, description, min_course_count, id
     FROM curriculum_requirements
     WHERE department_id = ? AND enrollment_type IS NULL
       AND (min_admission_year IS NULL OR ? >= min_admission_year)
       AND (max_admission_year IS NULL OR ? <= max_admission_year)`,
    [departmentId, year, year]
  );
  return rows;
}

// 그 학번에 이 학과 요건이 없으면 학과 개편으로 이어지는 학과(이전·이후)에서 찾는다.
async function departmentForYear(departmentId, year) {
  const own = await creditRequirementRows(departmentId, year);
  if (own.some((r) => r.min_course_count == null)) return { departmentId, rows: own, viaLineage: null };

  const chain = await historyService.getDepartmentChain(departmentId);
  for (const id of chain.departmentIds.filter((x) => x !== departmentId)) {
    const rows = await creditRequirementRows(id, year);
    if (rows.some((r) => r.min_course_count == null)) {
      const edge = chain.edges.find((e) => e.fromDepartmentId === id || e.toDepartmentId === id || e.fromDepartmentId === departmentId || e.toDepartmentId === departmentId);
      return { departmentId: id, rows, viaLineage: edge || true };
    }
  }
  return { departmentId, rows: [], viaLineage: null };
}

async function dataCoverage(departmentId) {
  const chain = await historyService.getDepartmentChain(departmentId);
  const [[r]] = await pool.query(
    `SELECT MIN(min_admission_year) AS lo, MAX(COALESCE(max_admission_year, min_admission_year)) AS hi
     FROM curriculum_requirements
     WHERE department_id IN (?) AND enrollment_type IS NULL AND min_course_count IS NULL
       AND category IN ('전공필수', '전공선택', '전공', '교양필수', '교양선택', '일반선택')
       AND (min_admission_year IS NOT NULL OR max_admission_year IS NOT NULL)`,
    [chain.departmentIds]
  );
  return r;
}

async function deptName(id) {
  const [[d]] = await pool.query('SELECT name FROM departments WHERE id = ?', [id]);
  return d?.name || `학과#${id}`;
}

// ---------------------------------------------------------------------------
// 졸업요건 (학번/학년도별)
// ---------------------------------------------------------------------------

function formatRequirementLines(rows) {
  const by = Object.fromEntries(rows.filter((r) => r.min_course_count == null).map((r) => [r.category, Number(r.required_credits)]));
  const lines = [];
  const liberal = (by.교양필수 ?? 0) + (by.교양선택 ?? 0);
  if ('교양필수' in by || '교양선택' in by) {
    lines.push(`교양: 교양필수 ${by.교양필수 ?? 0}학점 + 교양선택 ${by.교양선택 ?? 0}학점 = ${liberal}학점`);
  }
  const major = (by.전공필수 ?? 0) + (by.전공선택 ?? 0) + (by.전공 ?? 0);
  if ('전공필수' in by || '전공선택' in by) {
    lines.push(`전공: 전공필수(기본전공) ${by.전공필수 ?? 0}학점 이상 + 전공선택 ${by.전공선택 ?? 0}학점 = ${major}학점(하나의 풀)`);
  } else if ('전공' in by) {
    lines.push(`전공: ${by.전공}학점(전공필수·전공선택 구분 없이 합산 요건)`);
  }
  if ('일반선택' in by) lines.push(`일반선택: ${by.일반선택}학점`);
  const total = liberal + major + (by.일반선택 ?? 0);
  lines.push(`졸업학점 합계(교양+전공+일반선택): ${total}학점`);
  for (const r of rows.filter((x) => x.min_course_count != null)) {
    lines.push(`${r.category}: ${r.description}`);
  }
  return lines;
}

// 자료 없음 청크. extraNote: 왜 없는지(2027 개편 등) 한 줄.
async function noRequirementChunk(department, year, extraNote = '') {
  const cov = await dataCoverage(department.id);
  return {
    chunkId: `graduation-${department.id}-${year}`,
    documentTitle: `${department.name} ${year}학번 졸업요건 (자료 없음)`,
    content:
      `${department.name}의 ${year}학번 졸업요건 자료는 이 시스템에 아직 입력되어 있지 않다.` +
      (cov?.lo ? ` 현재 입력된 학번 범위는 ${cov.lo}~${cov.hi}학번이다.` : '') +
      (extraNote ? ` ${extraNote}` : '') +
      ` 입력되지 않은 학번의 요건을 다른 학번·다른 학과 기준으로 추정해서 단정하지 말고, 자료가 없다고 밝힌 뒤 ${ACADEMIC_OFFICE} 확인을 안내하라.`,
  };
}

/**
 * 규정 판단 엔진이 이 학생(같은 학과·같은 학번)에 대해 이미 판단했으면 그 결과를 졸업요건 청크의 값으로 쓴다.
 * 왜 엔진 결과인가: 예전 청크는 요건 행을 직접 읽어 "일반 재학생" 숫자만 냈다. 그래서 같은 답 안에서 진단(전과생 전공 48)·판단과 숫자가
 * 갈렸고(F-4), 자료 없는 학번(2027)에는 이전 값을 그대로 내보냈다(F-2). 판단과 같은 계산에서 나온 값만 보여 주면 근거끼리 어긋나지 않는다.
 */
function judgmentFor(judgment, department, year) {
  if (!judgment || !judgment.requirements || !judgment.department || !judgment.input) return null;
  return judgment.department.id === department.id && judgment.input.admissionYear === year ? judgment : null;
}

function engineRequirementChunk(department, year, judgment) {
  const rule = judgment.requirements.rules.find((r) => r.id === 'REQUIREMENTS');
  const enrollmentType = judgment.input.enrollmentType;
  const rows = [
    ...rule.value.categories.map((c) => ({ category: c.category, required_credits: c.requiredCredits, min_course_count: null })),
    ...rule.value.certifications.map((c) => ({ category: c.category, description: c.description, required_credits: 0, min_course_count: c.minCourseCount })),
  ];
  let lines = formatRequirementLines(rows);
  if (enrollmentType === 'TRANSFER_ADMISSION') {
    // 편입생은 전적대학 인정학점 때문에 총량을 단정할 수 없다(엔진 totalRequiredCredits = null) — 카테고리 합을 "합계"로 내지 않는다.
    lines = lines.filter((l) => !l.startsWith('졸업학점 합계'));
    lines.push('졸업학점 합계: 편입생은 전적대학 인정학점에 따라 달라 확정할 수 없다(위 카테고리별 기준은 참고값).');
  }
  if (rule.confidence !== 'CONFIRMED') {
    const reasons = (rule.flags || []).filter((f) => f.level !== 'INFO').slice(0, 3).map((f) => f.message);
    lines.push(`※ 이 요건 값의 신뢰도: ${CONFIDENCE_LABEL[rule.confidence]}${reasons.length ? ` — ${reasons.join(' / ')}` : ''}`);
  }
  if (rule.value.schedule4) lines.push(schedule4Line(rule.value.schedule4));
  const suffix = enrollmentType === 'GENERAL' ? '' : enrollmentType === 'MAJOR_CHANGE' ? ' (전과생 기준)' : ' (편입생 기준)';
  return {
    chunkId: `graduation-${department.id}-${year}`,
    documentTitle: `${department.name} ${year}학번 졸업요건${suffix}`,
    content: `[${year}학번 적용 요건 — ${ENROLLMENT_HEADER[enrollmentType] || ENROLLMENT_HEADER.GENERAL}]\n${lines.join('\n')}`,
  };
}

async function graduationRequirementChunk(department, year, judgment = null) {
  const own = judgmentFor(judgment, department, year);
  if (own) {
    const rule = own.requirements.rules.find((r) => r.id === 'REQUIREMENTS');
    if (rule && rule.value) return engineRequirementChunk(department, year, own);
    // 엔진이 "이 학과·학번 요건 자료 없음"으로 판단했다 — 열린 범위 행이나 개편 전후 학과 값으로 대신 채우지 않는다.
    const codes = new Set((rule ? rule.flags : []).map((f) => f.code));
    return noRequirementChunk(department, year, codes.has('COHORT_BEYOND_LATEST_DATA')
      ? `${year}학번부터는 학과·계열 개편이 예정되어 있어(학칙 부칙 2026.04.10. 제2조①) 이전 학번의 값을 대신 쓸 수 없다.`
      : '');
  }

  // 판단이 없는 학번(학년도 질문, 연도 비교의 다른 해 등)은 "그 해 교육과정" 질문이라 요건 행을 직접 읽는다. 개편으로 다른 학과로 이어진
  // 해는 그 사실을 밝혀 보여 주되(기존 동작), 자료 범위 밖 학번(2027~)은 열린 범위 행으로 외삽하지 않는다(F-2).
  const latest = await loadLatestDataYear();
  if (latest != null && year > latest) {
    return noRequirementChunk(department, year, `${year}학번부터는 학과·계열 개편이 예정되어 있어(학칙 부칙 2026.04.10. 제2조①) 이전 학번의 값을 대신 쓸 수 없다.`);
  }
  const resolved = await departmentForYear(department.id, year);
  if (resolved.rows.length === 0) return noRequirementChunk(department, year);

  const resolvedName = await deptName(resolved.departmentId);
  const lines = formatRequirementLines(resolved.rows);
  let lineageNote = '';
  if (resolved.departmentId !== department.id) {
    const src = resolved.viaLineage && resolved.viaLineage.source ? SOURCE_LABEL[resolved.viaLineage.source] : '학과 개편 관계';
    lineageNote = `\n※ ${year}학번에는 ${department.name}이(가) 아니라 개편된 ${resolvedName}로 편성되어 있다(${src}).`;
  }
  return {
    chunkId: `graduation-${department.id}-${year}`,
    documentTitle: `${resolvedName} ${year}학번 졸업요건`,
    content: `[${year}학번 적용 요건 — 일반 재학생 기준]\n${lines.join('\n')}${lineageNote}`,
  };
}

async function lookupGraduationRequirements({ message, student, yearContext, judgment = null }) {
  if (!yearContext.intents.requirement) return [];
  const department = await resolveDepartment(message, student);
  if (!department) return [];

  let years = yearContext.targetYears.slice(0, MAX_YEARS);
  if (years.length === 0 && yearContext.applicableCohort) years = [yearContext.applicableCohort];
  if (years.length === 0) {
    const cov = await dataCoverage(department.id);
    if (cov?.hi) years = [cov.hi];
  }
  const chunks = [];
  for (const year of years) chunks.push(await graduationRequirementChunk(department, year, judgment));
  return chunks;
}

// ---------------------------------------------------------------------------
// 변경 이력
// ---------------------------------------------------------------------------

function describeChange(c, caveat = '') {
  const unit = c.field === 'required_credits' ? '학점' : '';
  const base =
    c.changeType === 'ADDED' ? `${c.toYear}학번부터 신설(${c.newValue}${unit})`
      : c.changeType === 'REMOVED' ? `${c.toYear}학번부터 없음(마지막으로 있던 학번 ${c.fromYear})`
        : `${c.toYear}학번부터 ${c.oldValue}${unit} → ${c.newValue}${unit} (변경 전 마지막 학번 ${c.fromYear})`;
  return `${c.note ? `${base} — ${c.note}` : base}${caveat}`;
}

// ---------------------------------------------------------------------------
// 변경 이력의 데이터 신뢰도 (보정 라운드 A, DECISIONS D-36)
//
// 변경 이력은 학년도별 스냅샷을 비교해 만든 것이라, 비교한 해의 자료가 틀렸으면 "없던 변경"이 생기고(N-6: 책자 산술 불일치를 시드가
// 잔여값으로 보정해 생긴 가짜 변경), 검증 안 된 해(등급 C)의 "변경 없음"은 확인된 사실이 아니다. 판단 함수는 이미 이를 반영하는데
// 이 청크만 등급을 무시하고 있었다(F-5). dataQuality의 같은 등급표·판단 보류 목록을 쓴다 — 두 경로의 판정이 어긋나지 않게.
// ---------------------------------------------------------------------------

/** 요건 변경 하나에 붙일 단서(없으면 ''). dqModule은 테스트에서 가짜 등급표를 주입하는 용도. */
function requirementChangeCaveat(change, departmentName, dqModule = dq) {
  const years = [change.fromYear, change.toYear].filter((y) => y != null);
  const holds = years.flatMap((y) => dqModule.pendingHoldsFor(y, departmentName, 'REQUIREMENTS'));
  const grades = years.map((y) => dqModule.dataGrade('REQUIREMENTS', y, departmentName).grade);
  const parts = [];
  if (holds.length) {
    parts.push(`확인 필요 — 이 변경에 걸린 학번의 자료가 판단 보류 항목이다(${[...new Set(holds.map((h) => h.note))].join('; ')}). 실제 개정이 아니라 자료 보정 때문에 생긴 변경일 수 있다`);
  }
  if (grades.some((g) => g == null || g === 'C')) parts.push('이 학번의 요건 자료는 검증되지 않았다');
  else if (grades.includes('B')) parts.push('이 학번의 요건 자료는 부분 검증(B등급)이다');
  return parts.length ? ` ⚠ ${parts.join('; ')}` : '';
}

/** (area, from~to 학년도) 중 그 해 또는 앞해 자료가 검증 안 된(C·없음) 학년도 목록. "변경 없음" 판정이 가능한지 보는 데 쓴다. */
function unverifiedYearsIn(area, from, to, departmentName, dqModule = dq) {
  const out = [];
  for (let y = from; y <= to; y++) {
    const grades = [y - 1, y].map((yy) => dqModule.dataGrade(area, yy, departmentName).grade);
    if (grades.some((g) => g == null || g === 'C')) out.push(y);
  }
  return out;
}

// 학번 이후 변경이 이 학생에게 적용되는지는 "항상 아니다"가 아니다. 학칙시행규칙 제5조는 입학 당시 기준을 원칙으로 하되
// 개편 시 제2절 경과조치를 따르게 하고, 제13조①은 신 교육과정을 공포일부터 전 학년에 적용한다(②~④는 과목 단위 예외).
// 그래서 근거 문서에는 단정 대신 조건과 조문을 그대로 적는다 — LLM이 "적용 안 됨"을 단정하지 않게 하기 위함.
// 조문 내용은 db/regulations/_source/원광대학교_학칙시행규칙_전문.txt 제5조·제13조·제118조를 요약한 것이다.
const LATER_CHANGE_NOTICE =
  '학번별 이수기준표에 따른 이 학번의 값은 위와 같다. 아래 이후 변경이 이 학번에도 적용되는지는 경과조치에 따라 달라질 수 있어 단정할 수 없다 — ' +
  '학칙시행규칙 제5조(교육과정은 입학 당시의 기준에 따라 이수하되 재학 중 개편되면 제2절 경과조치를 따름), ' +
  '제13조(①개편된 신 교육과정은 개정 공포일로부터 전 학년에 적용 ②필수과목이 선택과목으로 바뀌거나 폐설되면 이수하지 않아도 됨 ' +
  '③선택과목이 필수과목으로 바뀌었을 때 재학 중인 학년보다 저학년에 개설된 경우 이수하지 않아도 됨 ④이수구분이 바뀐 과목은 수강신청한 학년도·학기의 이수구분을 따름), ' +
  '제118조(졸업 이수학점의 학번별 경과조치는 학칙 부칙을 따름 — 해당 종전 부칙 원문은 확인되지 않음). 확정이 필요하면 학과 또는 학사지원과 확인이 필요하다';

async function ruleHistoryChunk(department, code, cohort) {
  const r = await historyService.describeRuleForCohort({ departmentId: department.id, category: code, admissionYear: cohort });
  if (!r) return null;
  const label = RULE_LABEL[code] || code;
  const lines = [];
  // 이 학번 값 자체가 판단 보류 항목이면(예: 2024 사범대 자유선택 32 vs 34) 값에도 단서를 붙인다.
  const ownHolds = dq.pendingHoldsFor(cohort, department.name, 'REQUIREMENTS');
  const ownCaveat = ownHolds.length ? ` ⚠ 확인 필요 — 이 학번의 자료가 판단 보류 항목이다(${[...new Set(ownHolds.map((h) => h.note))].join('; ')}).` : '';
  lines.push(
    r.applied
      ? `${cohort}학번에 적용되는 ${label}: ${r.applied.requiredCredits}학점 — 이것이 이 학번의 적용 규정이다.${ownCaveat}`
      : `${cohort}학번의 ${label} 자료는 입력되어 있지 않다.`
  );
  const field = (list) => list.filter((c) => c.field === 'required_credits' || c.changeType !== 'CHANGED');
  const earlier = field(r.earlierChanges);
  const later = field(r.laterChanges);
  const latest = await loadLatestDataYear();
  // "변경 없음"은 비교한 해의 자료가 검증됐을 때만 말할 수 있다 — 검증 안 된 학년도가 끼면 "기록 없음(검증 안 됨)".
  const noChange = (from, to, text) => {
    const bad = from <= to ? unverifiedYearsIn('REQUIREMENTS', from, to, department.name) : [];
    return bad.length ? `${text.replace(/: 없음$/, '')}: 기록 없음(검증 안 됨 — ${bad.join('·')}학년도 요건 자료가 검증되지 않아 "변경 없음"을 확인할 수 없다)` : text;
  };
  lines.push(earlier.length
    ? `이 학번 이전의 변경:\n${earlier.map((c) => `- ${describeChange(c, requirementChangeCaveat(c, department.name))}`).join('\n')}`
    : noChange(2018, cohort, '이 학번 이전에 기록된 변경: 없음'));
  lines.push(
    later.length
      ? `이 학번 이후의 변경(${LATER_CHANGE_NOTICE}):\n${later.map((c) => `- ${describeChange(c, requirementChangeCaveat(c, department.name))}`).join('\n')}`
      : noChange(cohort + 1, latest ?? cohort, '이 학번 이후에 기록된 변경: 없음')
  );
  return {
    chunkId: `history-rule-${department.id}-${code}-${cohort}`,
    documentTitle: `${department.name} ${label} 변경 이력 (${cohort}학번 기준)`,
    content: lines.join('\n'),
  };
}

function ruleCodesFor(message, yearContext) {
  const codes = ['GRAD_TOTAL'];
  const wantsAll = yearContext.mode === 'COMPARE';
  if (wantsAll || /전공/.test(message)) codes.push('MAJOR_TOTAL');
  if (wantsAll || /교양/.test(message)) codes.push('LIBERAL_TOTAL');
  return codes.filter((c) => DERIVED_RULE_CODES[c]);
}

// 메시지(+직전 질문)에 나온 과목명 — 긴 이름 우선, 다른 과목명의 일부인 짧은 이름은 버린다.
async function mentionedCourseNames(text, departmentId) {
  const [all] = await pool.query(
    departmentId
      ? 'SELECT DISTINCT course_name FROM curriculum_courses WHERE department_id = ?'
      : 'SELECT DISTINCT course_name FROM curriculum_courses',
    departmentId ? [departmentId] : []
  );
  const picked = [];
  for (const name of all.map((r) => r.course_name).filter((n) => n.length >= 3 && text.includes(n)).sort((a, b) => b.length - a.length)) {
    if (!picked.some((p) => p.includes(name))) picked.push(name);
  }
  return picked.slice(0, MAX_COURSES);
}

function versionLine(v) {
  const years = v.minAdmissionYear === v.maxAdmissionYear ? `${v.minAdmissionYear}학번` : `${v.minAdmissionYear ?? ''}~${v.maxAdmissionYear ?? ''}학번`;
  const where = `${v.departmentName}${v.trackName ? `(${v.trackName})` : ''}`;
  return `- ${years} ${where}: ${v.category}, ${v.grade}학년 ${v.semester}학기, ${v.credits ?? '?'}학점${v.courseCode ? `, 학수번호 ${v.courseCode}` : ''}`;
}

async function courseHistoryChunks(courseName, department, cohort) {
  let histories = await historyService.findCourseHistory({ courseName, exact: true, departmentId: department?.id });
  if (histories.length === 0 && department) histories = await historyService.findCourseHistory({ courseName, exact: true });
  const chunks = [];
  for (const h of histories) {
    const lines = [`과목 "${courseName}" (과목 식별자 ${h.courseKey}) — 연도별 편성:`];
    lines.push(...h.versions.slice(0, MAX_VERSION_LINES).map(versionLine));
    if (h.versions.length > MAX_VERSION_LINES) lines.push(`- (이하 ${h.versions.length - MAX_VERSION_LINES}건 생략)`);

    if (cohort) {
      const applied = h.versions.find((v) => (v.minAdmissionYear == null || v.minAdmissionYear <= cohort) && (v.maxAdmissionYear == null || v.maxAdmissionYear >= cohort));
      lines.push(applied ? `${cohort}학번에 적용되는 편성: ${applied.category}, ${applied.grade}학년 ${applied.semester}학기, ${applied.credits ?? '?'}학점.` : `${cohort}학번 자료에는 이 과목이 편성되어 있지 않다.`);
    }
    const changes = h.changes;
    // 과목 자료 검수 등급(전공과목 2017·2018·2020, 컴소공 2017~2019·2021·2022 = C). 검증 안 된 해가 낀 구간의 "변경 없음"은 확인된 사실이 아니고,
    // 그 해의 변경은 자료 오류일 수 있다(판단 함수와 같은 등급표, D-36).
    const years = [...h.versions.flatMap((v) => [v.minAdmissionYear, v.maxAdmissionYear]), ...changes.flatMap((c) => [c.fromYear, c.toYear])].filter((y) => y != null);
    const bad = years.length ? unverifiedYearsIn('MAJOR_COURSES', Math.min(...years) + 1, Math.max(...years), department?.name) : [];
    const courseCaveat = (c) => ([c.fromYear, c.toYear].some((y) => bad.includes(y) || bad.includes(y + 1)) ? ' ⚠ 이 학년도의 과목 자료는 검증되지 않아 자료 오류일 수 있다' : '');
    if (changes.length) lines.push(`변경 이력:\n${changes.map((c) => `- ${c.field === 'existence' ? '' : `[${c.field}] `}${describeChange(c, courseCaveat(c))}`).join('\n')}`);
    else if (bad.length) lines.push(`변경 이력: 기록 없음(검증 안 됨 — ${bad.join('·')}학년도 과목 자료가 검증되지 않아 "변경 없음"을 확인할 수 없다)`);
    else lines.push('변경 이력: 기록된 변경 없음');
    if (h.removed) {
      lines.push(`폐지 여부: ${h.lastSeenYear}학번 자료까지 편성되어 있고 그 이후 학번 자료에는 없다(폐지이거나 학과 개편으로 다른 과목·학과로 옮겨졌을 수 있어 단정하지 말 것).`);
    }
    for (const l of h.lineage) {
      lines.push(`계보: ${l.fromName ?? '(없음)'}(${l.fromCourseKey ?? '-'}) → ${l.toName ?? '(없음)'}(${l.toCourseKey ?? '-'}) ${l.effectiveYear}학번부터, ${l.relation}${l.source === 'AUTO' ? ' (자동 감지)' : ''}`);
    }
    lines.push('※ 변경 이유는 이 자료에 기록되어 있지 않다. 이유가 근거에 없으면 모른다고 답하라.');
    chunks.push({ chunkId: `history-course-${h.courseKey}-${cohort ?? 'x'}`, documentTitle: `${courseName} 연도별 편성·변경 이력`, content: lines.join('\n') });
  }
  return chunks;
}

async function departmentLineageChunk(department) {
  const chain = await historyService.getDepartmentChain(department.id);
  if (chain.edges.length === 0) return null;
  const lines = chain.edges.map((e) => {
    const from = `${e.fromDepartmentName}${e.fromTrackId ? `(트랙#${e.fromTrackId})` : ''}`;
    return `- ${e.effectiveYear}학번부터: ${from} → ${e.toDepartmentName} [${e.relation}, ${SOURCE_LABEL[e.source] || e.source}]${e.note ? ` ${e.note}` : ''}`;
  });
  return { chunkId: `history-dept-${department.id}`, documentTitle: `${department.name} 학과 개편 이력`, content: lines.join('\n') };
}

async function lookupChangeHistory({ message, contextText, student, yearContext }) {
  const wantsHistory = yearContext.intents.history || yearContext.mode === 'COMPARE';
  if (!wantsHistory) return [];

  const department = await resolveDepartment(message, student);
  const cohort = yearContext.applicableCohort;
  const chunks = [];

  const courseNames = await mentionedCourseNames(`${message}\n${contextText || ''}`, department?.id);
  for (const name of courseNames) chunks.push(...(await courseHistoryChunks(name, department, cohort)));

  // 과목이 특정되면 과목 이력이 답이고, 아니면(졸업학점/전공/교양 등) 규정 이력을 만든다. 연도 비교 질문은 연도별
  // 졸업요건 청크가 이미 각 해 값을 주므로, 변경 이력을 묻는 표현("언제 바뀌었어")이 있을 때만 규정 이력을 더한다.
  if (department && yearContext.intents.history && (courseNames.length === 0 || yearContext.intents.requirement)) {
    const baseCohort = cohort ?? yearContext.latestBookYear;
    if (baseCohort) {
      for (const code of ruleCodesFor(message, yearContext)) {
        const chunk = await ruleHistoryChunk(department, code, baseCohort);
        if (chunk) chunks.push(chunk);
      }
    }
  }
  if (department) {
    const lineage = await departmentLineageChunk(department);
    if (lineage) chunks.push(lineage);
  }
  return chunks;
}

module.exports = {
  resolveDepartment,
  lookupGraduationRequirements,
  lookupChangeHistory,
  mentionedCourseNames,
  LATER_CHANGE_NOTICE,
  schedule4Line,
  requirementChangeCaveat,
  unverifiedYearsIn,
};
