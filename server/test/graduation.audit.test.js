const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveRequirementsForStudent } = require('../services/regulationEngine');
const { computeCreditStatus, evaluateCertifications, requirementRowsFromJudgment, liberalArtsCapForDiagnosis } = require('../services/graduationService');

/**
 * server/test/graduation.audit.test.js
 * 전 학과 졸업요건 점검(docs/regulation-engine/GRADUATION_AUDIT_2026-10-12.md)에서 찾은 구조적 오류의 회귀 테스트. DB 없이 돈다.
 *  - 레포의 시드(db/seed/curriculum_requirements.json)를 엔진에 그대로 넣고, 학과 × 학번(2017~2026) × 입학유형 갈래를 전수로 돌려
 *    "카테고리 중복 없음 / 요구학점 ≥ 0 / 전과생 총량 보존 / 요건을 정확히 채운 학생은 총계 충족"을 확인한다.
 *  - 졸업진단의 순수 계산부(computeCreditStatus, evaluateCertifications)를 직접 검증한다.
 */

const SEED = require(path.resolve(__dirname, '..', '..', 'db', 'seed', 'curriculum_requirements.json'));
const TODAY = '2026-10-12';
const DEPT_NAMES = [...new Set(SEED.map((r) => r.departmentName))];
const ROWS_BY_DEPT = new Map(DEPT_NAMES.map((name) => [name, []]));
SEED.forEach((r, i) => ROWS_BY_DEPT.get(r.departmentName).push({ id: i + 1, ...r, requiredCourses: r.requiredCourses || [] }));
const LATEST_DATA_YEAR = Math.max(...SEED.map((r) => Math.max(r.minAdmissionYear || 0, r.maxAdmissionYear || 0)));
const deptId = (name) => DEPT_NAMES.indexOf(name) + 1;

const loadData = async (ctx) => {
  const name = DEPT_NAMES[ctx.departmentId - 1];
  return { department: name ? { id: ctx.departmentId, name } : null, rows: name ? ROWS_BY_DEPT.get(name) : [], latestDataYear: LATEST_DATA_YEAR, candidates: [], history: null };
};

async function judge(departmentName, admissionYear, enrollmentType = 'GENERAL', extra = {}) {
  return resolveRequirementsForStudent({ departmentId: deptId(departmentName), admissionYear, enrollmentType, asOfDate: TODAY, ...extra }, { loadData, today: TODAY });
}

/** 엔진 판단 → 졸업진단과 같은 방식으로 요건 행·교양 상한을 꺼낸다(graduationService.getGraduationStatus와 같은 변환). */
function diagnosisInputs(regulation) {
  const rows = requirementRowsFromJudgment((regulation.rules || []).find((r) => r.id === 'REQUIREMENTS'));
  return {
    creditRows: rows.filter((r) => r.min_course_count === null),
    certificationRows: rows.filter((r) => r.min_course_count !== null),
    cap: liberalArtsCapForDiagnosis((regulation.rules || []).find((r) => r.id === 'LIBERAL_ARTS_CAP')),
  };
}

const applies = (r, y) => (r.minAdmissionYear == null || y >= r.minAdmissionYear) && (r.maxAdmissionYear == null || y <= r.maxAdmissionYear);
const CORE = ['교양필수', '교양선택', '전공필수', '전공선택', '전공'];
function generalTotal(departmentName, year) {
  const rows = ROWS_BY_DEPT.get(departmentName).filter((r) => applies(r, year) && r.enrollmentType == null && r.minCourseCount == null);
  return rows.some((r) => CORE.includes(r.category)) ? rows.reduce((s, r) => s + r.requiredCredits, 0) : null;
}

const flagCodes = (regulation) => regulation.flags.map((f) => f.code);

// ---------------------------------------------------------------- 전수 불변식

test('전 학과 × 학번 × 입학유형: 카테고리 중복 없음, 요구학점 ≥ 0, 전과생 총량 보존, 요건을 채운 학생은 총계 충족', async () => {
  const scenarios = (y) => [
    { label: '일반', type: 'GENERAL' },
    { label: '2학년 전과(컷오프 전)', type: 'MAJOR_CHANGE', majorChange: { grade: 2, year: y + 1, semester: 1 }, when: y + 1 <= 2022 },
    { label: '3학년 전과(컷오프 전)', type: 'MAJOR_CHANGE', majorChange: { grade: 3, year: y + 2, semester: 1 }, when: y + 2 <= 2022 },
    { label: '3학년 전과(컷오프 후)', type: 'MAJOR_CHANGE', majorChange: { grade: 3, year: Math.max(y + 2, 2023), semester: 1 }, when: Math.max(y + 2, 2023) <= 2026 },
    { label: '편입', type: 'TRANSFER_ADMISSION' },
  ];
  const problems = [];
  let checked = 0;
  for (const dept of DEPT_NAMES) {
    for (let y = 2017; y <= 2026; y++) {
      const total = generalTotal(dept, y);
      if (total == null) continue;
      for (const sc of scenarios(y)) {
        if (sc.when === false) continue;
        const regulation = await judge(dept, y, sc.type, sc.majorChange ? { majorChange: sc.majorChange } : {});
        const { creditRows, cap } = diagnosisInputs(regulation);
        if (creditRows.length === 0) continue; // 자료없음(자율전공학부 등)은 별도 테스트
        checked++;
        const where = `${dept} ${y}학번 ${sc.label}`;
        const cats = creditRows.map((r) => r.category);
        const dup = cats.filter((c, i) => cats.indexOf(c) !== i);
        if (dup.length) problems.push(`${where}: 카테고리 중복 ${dup.join(',')}`);
        const negative = creditRows.filter((r) => Number(r.required_credits) < 0);
        if (negative.length) problems.push(`${where}: 음수 요구학점 ${negative.map((r) => `${r.category}${r.required_credits}`).join(',')}`);
        const sum = creditRows.reduce((s, r) => s + Number(r.required_credits), 0);
        if (sc.type === 'MAJOR_CHANGE') {
          // 총량은 일반 재학생과 같아야 한다. 늘어나는 건 교양 29학점 고정이 학번표보다 많아 일반선택이 0으로 막힌 경우뿐이고, 그때는 추정 플래그가 붙는다.
          const raised = flagCodes(regulation).includes('LIBERAL_FIXED_29_ABOVE_COHORT');
          if (sum < total || (sum > total && !raised)) problems.push(`${where}: 전과생 총 요구학점 ${sum} ≠ 일반 ${total}`);
        }
        // 요건 행만큼 정확히 이수한 학생은 총계가 요구학점과 같아야 한다(통합 "전공" 행은 전공선택으로 채운다).
        const earned = {};
        for (const r of creditRows) {
          const cat = r.category === '전공' ? '전공선택' : r.category;
          earned[cat] = (earned[cat] || 0) + Number(r.required_credits);
        }
        const status = computeCreditStatus(creditRows, earned, cap);
        if (status.totalEarnedCredits !== status.totalRequiredCredits) problems.push(`${where}: 요건을 채웠는데 ${status.totalEarnedCredits}/${status.totalRequiredCredits}`);
      }
    }
  }
  assert.ok(checked > 2000, `검사한 조합이 너무 적어요(${checked}) — 시드 경로나 엔진 입력을 확인하세요`);
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------- 건축학과(통합 "전공" 행 학과)의 완화

test('건축학과 2020학번 3학년 전과(2022-1): 전공 요건은 완화 행(66) 하나, 일반선택이 나머지를 흡수해 총 160', async () => {
  const regulation = await judge('건축학과', 2020, 'MAJOR_CHANGE', { majorChange: { grade: 3, year: 2022, semester: 1 } });
  const { creditRows, cap } = diagnosisInputs(regulation);
  const major = creditRows.filter((r) => ['전공', '전공필수', '전공선택'].includes(r.category));
  assert.deepEqual(major.map((r) => [r.category, Number(r.required_credits)]), [['전공', 66]]);
  assert.equal(creditRows.reduce((s, r) => s + Number(r.required_credits), 0), 160);
  // 전공 70 + 교양 29 + 일반 61 = 160학점을 들은 학생은 충족이다(예전: 105/160, 확정).
  const status = computeCreditStatus(creditRows, { 전공선택: 70, 교양필수: 5, 교양선택: 24, 일반선택: 61 }, cap);
  assert.equal(status.totalEarnedCredits, 160);
  assert.equal(status.totalRequiredCredits, 160);
});

test('건축학과 2020학번 편입: 전공 요건은 66 하나(예전: 전공 129 + 66, 총 226)', async () => {
  const regulation = await judge('건축학과', 2020, 'TRANSFER_ADMISSION');
  const { creditRows } = diagnosisInputs(regulation);
  assert.deepEqual(creditRows.filter((r) => r.category === '전공').map((r) => Number(r.required_credits)), [66]);
});

test('4학년 편입(통합 "전공" 행 학과): 최소전공 21이 한 번만 잡힌다', async () => {
  const regulation = await judge('간호학과', 2023, 'TRANSFER_ADMISSION', { transfer: { grade: 4 } });
  const { creditRows } = diagnosisInputs(regulation);
  assert.deepEqual(creditRows.filter((r) => r.category === '전공').map((r) => Number(r.required_credits)), [21]);
});

// ---------------------------------------------------------------- 전과 교양 29학점 고정

test('간호학과 2019학번 2021-1 전과: 일반선택은 음수가 아니라 0, 29학점이 학번표(23)보다 많아 추정(학교 확인 중)', async () => {
  const regulation = await judge('간호학과', 2019, 'MAJOR_CHANGE', { majorChange: { grade: 3, year: 2021, semester: 1 } });
  const { creditRows } = diagnosisInputs(regulation);
  assert.equal(Number(creditRows.find((r) => r.category === '일반선택').required_credits), 0);
  // 컴소공 학과 공지가 학번표 23학점인 학번의 전과생에게도 29를 요구한다(SOURCE_VERIFICATION_2026-10-12). 다만 29가 2026 책자 학번별 표보다
  // 우선하는지는 학교 확인 중이라(3차 문의 E-1 ④) 값이 갈리는 이 경우는 추정이다(2026-10-24).
  const flag = regulation.flags.find((f) => f.code === 'LIBERAL_FIXED_29_ABOVE_COHORT');
  assert.equal(flag.level, 'ESTIMATED');
});

test('29학점 고정 알림은 학번표 교양이 29보다 적을 때만 붙는다(컴소공 2021학번 23 → 붙음, 전기공학과 2022학번 39 → 안 붙음)', async () => {
  const raised = await judge('컴퓨터·소프트웨어공학과', 2021, 'MAJOR_CHANGE', { majorChange: { grade: 2, year: 2022, semester: 1 } });
  assert.ok(flagCodes(raised).includes('LIBERAL_FIXED_29_ABOVE_COHORT'));
  // 2017~2021학번은 2026 책자 학번별 표로 교양이 23이 됐으므로(아래 "최신 책자" 절) 29보다 많은 학번은 2022학번(5+34=39)으로 본다.
  const lowered = await judge('전기공학과', 2022, 'MAJOR_CHANGE', { majorChange: { grade: 2, year: 2023, semester: 1 } });
  assert.ok(!flagCodes(lowered).includes('LIBERAL_FIXED_29_ABOVE_COHORT'));
});

// ---------------------------------------------------------------- 최신 책자(2026)의 학번별 이수기준표가 전 학번에 적용 (교육혁신과 면담 2026-10-12)

test('시드는 2026 책자 학번별 이수기준표와 어긋나지 않는다(정렬 스크립트가 고칠 행 0, 졸업학점 불일치 0)', () => {
  const { main } = require(path.resolve(__dirname, '..', '..', 'scripts', 'audit', 'applyLatestBookletCohortTables.js'));
  const report = main({ apply: false, out: null, quiet: true });
  assert.equal(report.counts.changes, 0, JSON.stringify(report.changes.slice(0, 5)));
  assert.equal(report.counts.gradMismatch, 0, JSON.stringify(report.gradMismatch.slice(0, 5)));
});

test('2025학번 이하: 2026 책자 학번별 표 값(전기공학과 2019학번 교양 5+18=23, 옛 2019 책자의 40이 아님) + 안내 플래그(INFO, 확정 유지)', async () => {
  const r = await judge('전기공학과', 2019);
  const { creditRows } = diagnosisInputs(r);
  const credit = (c) => Number(creditRows.find((x) => x.category === c).required_credits);
  assert.equal(credit('교양필수'), 5);
  assert.equal(credit('교양선택'), 18);
  assert.equal(credit('일반선택'), 38);
  assert.equal(creditRows.reduce((s, x) => s + Number(x.required_credits), 0), 136, '졸업학점 총계는 바뀌지 않는다');
  const codes = flagCodes(r);
  assert.ok(codes.includes('LATEST_BOOKLET_COHORT_TABLE'));
  // 전기공학과는 2026 책자에 학과 단위 행이 없다(개편) — 과목 편성은 구 교육과정일 수 있다는 안내
  assert.ok(codes.includes('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET'));
  assert.equal(r.flags.find((f) => f.code === 'LATEST_BOOKLET_COHORT_TABLE').level, 'INFO');
  assert.equal(r.confidence, 'CONFIRMED', `INFO 플래그는 신뢰도를 낮추지 않는다: ${codes.join(',')}`);
  const basis = r.rules.find((x) => x.id === 'REQUIREMENTS').basis.map((b) => b.key || b);
  assert.ok(JSON.stringify(basis).includes('BOOKLET_2026_COHORT_TABLES'), `근거에 학번별 표가 있어야 한다: ${JSON.stringify(basis)}`);
});

test('최신 책자 안내 플래그의 범위: 2026 책자에 있는 학과의 2025학번 이하에는 "학과 없음" 안내가 붙지 않고, 2026학번·자료 없음에는 둘 다 없다', async () => {
  const nursing2019 = flagCodes(await judge('간호학과', 2019));
  assert.ok(nursing2019.includes('LATEST_BOOKLET_COHORT_TABLE'));
  assert.ok(!nursing2019.includes('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET'));
  const nursing2026 = flagCodes(await judge('간호학과', 2026));
  assert.ok(!nursing2026.includes('LATEST_BOOKLET_COHORT_TABLE'));
  assert.ok(!nursing2026.includes('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET'));
  const noRows = flagCodes(await judge('공학3계열', 2018));
  assert.ok(noRows.includes('NO_CURRICULUM_ROWS'));
  assert.ok(!noRows.includes('LATEST_BOOKLET_COHORT_TABLE'));
});

test('"학과 없음" 안내는 학번 범위가 열린 보조 행(교직기본이수·전과/편입 완화·졸업논문)만 있는 학과에도 붙는다', async () => {
  // 세 학과 모두 2026 책자에 학과 행이 없지만 범위가 열린 보조 행이 있어, 예전에는 "2026에도 있음"으로 오판돼 안내가 빠졌다.
  for (const [name, year] of [['경영학과', 2023], ['국어국문학과', 2020], ['컴퓨터·소프트웨어공학과', 2019]]) {
    const codes = flagCodes(await judge(name, year));
    assert.ok(codes.includes('LATEST_BOOKLET_COHORT_TABLE'), `${name} ${year}: ${codes.join(',')}`);
    assert.ok(codes.includes('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET'), `${name} ${year}: ${codes.join(',')}`);
  }
});

// ---------------------------------------------------------------- 자율전공학부

test('자율전공학부: 1학년 과정 행으로 졸업요건을 진단하지 않는다(자료없음 + 배정 학과 안내)', async () => {
  const regulation = await judge('자율전공학부', 2024);
  assert.equal(regulation.confidence, 'NO_DATA');
  assert.ok(flagCodes(regulation).includes('NON_DEGREE_DEPARTMENT'));
  assert.deepEqual(diagnosisInputs(regulation).creditRows, []);
});

// ---------------------------------------------------------------- 기본전공 풀(기존 동작 고정)

test('기본전공 9 + 선택전공 66: 서버는 기본전공 이수학점을 그대로 내려 화면이 하한 부족을 표시할 수 있다', () => {
  const rows = [
    { category: '전공필수', required_credits: 19, requiredCourses: [], min_course_count: null },
    { category: '전공선택', required_credits: 56, requiredCourses: [], min_course_count: null },
  ];
  const status = computeCreditStatus(rows, { 전공필수: 9, 전공선택: 66 }, null);
  assert.deepEqual(status.categories.map((c) => [c.category, c.earnedCredits, c.requiredCredits]), [['전공필수', 9, 19], ['전공선택', 66, 56]]);
  assert.equal(status.totalEarnedCredits, 75);
});

// ---------------------------------------------------------------- 졸업논문·졸업인증제·교직기본이수 판정

const cert = (category, requiredCourses, min = 1) => ({ category, description: null, min_course_count: min, requiredCourses });
const course = (name, letterGrade = 'A0') => ({ name, letter_grade: letterGrade });
const satisfied = (row, courses) => evaluateCertifications([row], courses)[0].satisfied;

test('졸업논문: P든 A·B·C든 F가 아닌 성적이면 합격, 성적 미입력(진행 중)·F·NP는 미충족', () => {
  const thesis = cert('졸업논문', ['졸업(시험·작품)논문']);
  assert.equal(satisfied(thesis, [course('졸업(시험.작품)논문', 'P')]), true);
  assert.equal(satisfied(thesis, [course('졸업(시험,작품)논문', 'B0')]), true, '제124조②: 졸업논문 판정은 A·B·C');
  assert.equal(satisfied(thesis, [course('졸업(시험.작품)논문', null)]), false);
  assert.equal(satisfied(thesis, [course('졸업(시험.작품)논문', 'F')]), false);
  assert.equal(satisfied(thesis, [course('졸업(시험.작품)논문', 'NP')]), false);
  assert.equal(satisfied(thesis, [course('졸업(시험.작품)논문', 'F'), course('졸업(시험.작품)논문', 'P')]), true, '재수강 전 F가 있어도 합격 기록이 있으면 충족');
});

test('졸업인증제: 분류 이름(캡스톤디자인·종합설계·전공현장실습)을 포함한 실제 과목명으로 충족된다', () => {
  const groupA = cert('졸업인증제', ['전공현장실습', '캡스톤디자인', '사회봉사']);
  assert.equal(satisfied(groupA, [course('캡스톤디자인1')]), true, '식품영양학과 편성표 과목명');
  assert.equal(satisfied(groupA, [course('회계실무(캡스톤디자인)')]), true, '회계세무학과 편성표 과목명');
  assert.equal(satisfied(groupA, [course('전공현장실습2')]), true);
  assert.equal(satisfied(groupA, [course('캡스톤디자인1', 'F')]), false);
  assert.equal(satisfied(groupA, [course('거꾸로캡스톤1')]), false, '분류 이름 전체를 포함하지 않으면 인정하지 않는다');
  const groupB = cert('졸업인증제', ['캡스톤디자인', '기업연계프로젝트', '종합설계']);
  assert.equal(satisfied(groupB, [course('전기공학종합설계1')]), true);
});

test('졸업인증제 2과목 필수: 같은 요구 항목을 채우는 과목 두 개로는 충족되지 않는다', () => {
  const twoKinds = cert('졸업인증제', ['전공현장실습', '캡스톤디자인'], 2);
  assert.equal(satisfied(twoKinds, [course('캡스톤디자인1'), course('캡스톤디자인2')]), false);
  assert.equal(satisfied(twoKinds, [course('캡스톤디자인1'), course('전공현장실습2')]), true);

  const cse = cert('졸업인증제', ['기업연계프로젝트1(종합설계1)', '기업연계프로젝트2(종합설계2)'], 2);
  assert.equal(satisfied(cse, [course('기업연계프로젝트1(종합설계1)'), course('기연프2')]), true, '끝 괄호를 뗀 이름·등록된 약칭도 인정(기존 동작)');
  assert.equal(satisfied(cse, [course('기업연계프로젝트1'), course('기연프1')]), false, '1만 두 번 들은 것은 2과목이 아니다');
});

test('컴소공 졸업인증제는 학번과 관계없이(2017~2025) 학과 규칙 — 기업연계프로젝트1·2 둘 다, 2026 책자 공통 표(셋 중 1)로 덮지 않는다', async () => {
  for (const year of [2017, 2019, 2022, 2025]) {
    const certs = diagnosisInputs(await judge('컴퓨터·소프트웨어공학과', year)).certificationRows.filter((r) => r.category === '졸업인증제');
    assert.equal(certs.length, 1, `${year}: 졸업인증제 행이 하나여야 한다`);
    assert.equal(certs[0].min_course_count, 2, `${year}`);
    assert.deepEqual(certs[0].requiredCourses, ['기업연계프로젝트1(종합설계1)', '기업연계프로젝트2(종합설계2)'], `${year}`);
  }
});

test('교직기본이수: optional로 표시하고, 과목명은 완전일치로만 본다(포함 비교로 다른 과목과 섞이지 않게)', () => {
  const teaching = cert('교직기본이수', ['국어교육론', '국어사'], 2);
  const [result] = evaluateCertifications([teaching], [course('국어교육론'), course('국어사회언어학')]);
  assert.equal(result.optional, true);
  assert.equal(result.satisfied, false);
  assert.equal(evaluateCertifications([cert('졸업논문', ['졸업(시험·작품)논문'])], [])[0].optional, undefined);
});

test('교직기본이수: 교직 "이수 중"이면 실제 요건, "이수 안 함"이면 결과에서 빠지고, 답하지 않았으면 참고(optional)로 남는다(D-67)', () => {
  const rows = [cert('교직기본이수', ['국어교육론'], 1), cert('졸업논문', ['졸업(시험·작품)논문'])];
  const taking = evaluateCertifications(rows, [], { teachingCourse: true });
  assert.equal(taking.find((c) => c.category === '교직기본이수').optional, undefined);
  const notTaking = evaluateCertifications(rows, [], { teachingCourse: false });
  assert.deepEqual(notTaking.map((c) => c.category), ['졸업논문']);
  const unanswered = evaluateCertifications(rows, [], { teachingCourse: null });
  assert.equal(unanswered.find((c) => c.category === '교직기본이수').optional, true);
});

// ---------------------------------------------------------------- 편입생(SOURCE_VERIFICATION_2026-10-12 3·4절)

test('컴소공 2023학번 3학년 편입: 본교 이수 68 = 전공 48 + 자유 20, 교양은 "종교와원불교"만, 학과 지정 졸업인증(기업연계1·2)은 면제 안내 없음', async () => {
  const regulation = await judge('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION');
  const { creditRows, certificationRows, cap } = diagnosisInputs(regulation);
  assert.deepEqual(creditRows.map((r) => [r.category, Number(r.required_credits)]), [['전공', 48], ['일반선택', 20]]);
  assert.ok(certificationRows.some((r) => r.category === '종교와원불교'));
  const cse = certificationRows.find((r) => r.category === '졸업인증제');
  assert.equal(cse.conditionalExemption, null, '학과 공지상 편입생도 기업연계프로젝트1·2 필수');
  assert.ok(!flagCodes(regulation).includes('TRANSFER_TOTAL_UNRESOLVED'));
  // 본교에서 들은 교양은 자유선택으로 센다: 전공 48 + 교양 20 = 68/68.
  const status = computeCreditStatus(creditRows, { 전공선택: 48, 교양선택: 20 }, cap);
  assert.equal(status.totalEarnedCredits, 68);
  assert.equal(status.totalRequiredCredits, 68);
});

test('국어국문학과 2022학번 3학년 편입: 인정학점 64(일반계열), 대학 공통 졸업인증제에는 학사편입 면제 안내', async () => {
  const regulation = await judge('국어국문학과', 2022, 'TRANSFER_ADMISSION');
  const { creditRows, certificationRows } = diagnosisInputs(regulation);
  assert.equal(creditRows.reduce((s, r) => s + Number(r.required_credits), 0), 130 - 64);
  const cert = certificationRows.find((r) => r.category === '졸업인증제');
  assert.equal(cert.conditionalExemption, 'BACHELOR_TRANSFER');
  assert.ok(flagCodes(regulation).includes('CERTIFICATION_BACHELOR_TRANSFER_EXEMPT'));
  const [evaluated] = evaluateCertifications([cert], []);
  assert.equal(evaluated.conditionalExemption, 'BACHELOR_TRANSFER');
  assert.equal(evaluated.satisfied, false, '편입 종류를 모르므로 미충족은 그대로 둔다');
});

test('2학년 편입은 교양 충족 간주(제10조②) 대상이 아니다: 학번표 교양 그대로, 총량 미해결', async () => {
  const regulation = await judge('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION', { transfer: { grade: 2 } });
  const { creditRows } = diagnosisInputs(regulation);
  assert.ok(creditRows.some((r) => r.category === '교양선택'));
  assert.ok(flagCodes(regulation).includes('TRANSFER_TOTAL_UNRESOLVED'));
  assert.ok(!flagCodes(regulation).includes('TRANSFER_LIBERAL_DEEMED_MET'));
});

test('완화 행이 없는 학과(간호학과) 편입: 인정학점을 알아도 전공 인정 범위를 몰라 총량은 단정하지 않는다', async () => {
  const regulation = await judge('간호학과', 2023, 'TRANSFER_ADMISSION');
  assert.ok(flagCodes(regulation).includes('TRANSFER_TOTAL_UNRESOLVED'));
  assert.ok(!flagCodes(regulation).includes('TRANSFER_RECOGNIZED_CREDITS_ASSUMED'));
});

test('편입 학번 기준의 근거는 교육과정 운영에 관한 규정 제14조③으로 남긴다', async () => {
  const regulation = await judge('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION');
  const majorRule = regulation.rules.find((r) => r.id === 'MAJOR_MINIMUM');
  assert.ok(majorRule.basis.some((b) => b.key === 'REG_CURRICULUM_OP_ART14_TRANSFER_COHORT'));
});

// ---------------------------------------------------------------- 건축학과 2025학번(책자에 최소전공 숫자 없음)

test('건축학과 2025학번 3학년 전과: 책자에 숫자가 없어도 시행규칙 제6조①5호의 66학점으로 완화, 총 160 유지', async () => {
  const regulation = await judge('건축학과', 2025, 'MAJOR_CHANGE', { majorChange: { grade: 3, year: 2026, semester: 2 } });
  const { creditRows } = diagnosisInputs(regulation);
  assert.deepEqual(creditRows.filter((r) => r.category === '전공').map((r) => Number(r.required_credits)), [66]);
  assert.equal(creditRows.reduce((s, r) => s + Number(r.required_credits), 0), 160);
  assert.ok(flagCodes(regulation).includes('MAJOR_MINIMUM_FROM_REGULATION'));
  assert.ok(!flagCodes(regulation).includes('MAJOR_RELAXATION_ROW_MISSING'));
});

// ---------------------------------------------------------------- 편입 학년 입력(제14조③)

test('편입 학년을 입력한 편입생은 학번의 의미가 확실해 "학번 미확정"·"학년 가정" 플래그가 없고, 옛 계정(학년 없음)은 둘 다 남는다', async () => {
  const known = await judge('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION', { transfer: { grade: 3 } });
  assert.ok(!flagCodes(known).includes('TRANSFER_COHORT_YEAR_UNVERIFIED'));
  assert.ok(!flagCodes(known).includes('TRANSFER_GRADE_ASSUMED'));
  assert.ok(flagCodes(known).includes('TRANSFER_RECOGNIZED_CREDITS_ASSUMED'), '인정학점은 여전히 가정이다');
  const legacy = await judge('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION');
  assert.ok(flagCodes(legacy).includes('TRANSFER_COHORT_YEAR_UNVERIFIED'));
  assert.ok(flagCodes(legacy).includes('TRANSFER_GRADE_ASSUMED'));
});

test('편입 4학년: 학생이 4학년 편입이라고 입력하면 최소전공 21학점으로 판정된다(예전에는 항상 3학년 가정)', async () => {
  const regulation = await judge('컴퓨터·소프트웨어공학과', 2022, 'TRANSFER_ADMISSION', { transfer: { grade: 4 } });
  const { creditRows } = diagnosisInputs(regulation);
  assert.deepEqual(creditRows.filter((r) => r.category === '전공').map((r) => Number(r.required_credits)), [21]);
});

test('학생 행 → 엔진 입력: 편입생의 transfer_grade·transfer_recognized_credits가 transfer로 넘어가고, 다른 유형은 null이다', () => {
  const { inputFromStudentRow } = require('../services/regulationEngine');
  const base = { admission_year: 2024, department_id: 1 };
  assert.deepEqual(inputFromStudentRow({ ...base, enrollment_type: 'TRANSFER_ADMISSION', transfer_grade: 3, transfer_recognized_credits: 65 }).transfer, { grade: 3, recognizedCredits: 65 });
  assert.deepEqual(inputFromStudentRow({ ...base, enrollment_type: 'TRANSFER_ADMISSION', transfer_grade: null }).transfer, { grade: null, recognizedCredits: null });
  assert.equal(inputFromStudentRow({ ...base, enrollment_type: 'GENERAL', transfer_grade: 3, transfer_recognized_credits: 65 }).transfer, null);
});

test('편입 인정학점을 입력하면 그 값으로 총량을 계산하고 "가정" 대신 "입력값" 안내(INFO)가 붙는다(D-67)', async () => {
  const assumed = await judge('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION', { transfer: { grade: 3 } });
  const entered = await judge('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION', { transfer: { grade: 3, recognizedCredits: 60 } });
  assert.ok(flagCodes(entered).includes('TRANSFER_RECOGNIZED_CREDITS_ENTERED'));
  assert.ok(!flagCodes(entered).includes('TRANSFER_RECOGNIZED_CREDITS_ASSUMED'));
  const total = (r) => diagnosisInputs(r).creditRows.reduce((s, row) => s + Number(row.required_credits), 0);
  const elective = (r) => diagnosisInputs(r).creditRows.find((row) => row.category === '일반선택');
  const assumedRecognized = assumed.flags.find((f) => f.code === 'TRANSFER_RECOGNIZED_CREDITS_ASSUMED').recognized;
  // 인정학점이 줄어든 만큼 본교에서 이수할 일반선택이 늘어난다(전공 최소학점은 그대로).
  assert.equal(Number(elective(entered).required_credits) - Number(elective(assumed).required_credits), assumedRecognized - 60);
  assert.equal(total(entered) - total(assumed), assumedRecognized - 60);
});

// ---------------------------------------------------------------- 학교 답변 반영(교육혁신과 2026-10-14)

test('A-5: 학과 내규 학과(의·치·한·약·건축)는 전공 과목 학과 확인 안내(INFO)만 붙고, 다른 학과에는 붙지 않는다', async () => {
  for (const [name, year] of [['의학과', 2026], ['약학과', 2024], ['건축학과', 2026], ['한약학과', 2023]]) {
    const r = await judge(name, year);
    const f = r.flags.find((x) => x.code === 'DEPARTMENT_BYLAW_MAJOR');
    assert.ok(f, `${name} ${year}: ${flagCodes(r).join(',')}`);
    assert.equal(f.level, 'INFO');
  }
  const med = await judge('의학과', 2026);
  assert.equal(med.confidence, 'CONFIRMED', `INFO 안내는 신뢰도를 낮추지 않는다: ${flagCodes(med).join(',')}`);
  assert.ok(!flagCodes(await judge('경영학과', 2024)).includes('DEPARTMENT_BYLAW_MAJOR'));
});

test('A-5: 건축학과 2024·2025학번 전공 학점은 학교 확인 전 추정값이라 판단 보류(추정)로 낮춘다', async () => {
  for (const year of [2024, 2025]) {
    const r = await judge('건축학과', year);
    const hold = r.flags.find((x) => x.code === 'DATA_PENDING_HOLD');
    assert.ok(hold && JSON.stringify(hold).includes('A-5-architecture'), `${year}: ${flagCodes(r).join(',')}`);
    assert.notEqual(r.confidence, 'CONFIRMED');
  }
  const r2026 = await judge('건축학과', 2026);
  assert.ok(!JSON.stringify(r2026.flags).includes('A-5-architecture'));
});
