#!/usr/bin/env node
/**
 * scripts/audit/regulationSnapshot.js
 * 규정 판단·졸업진단·챗봇 근거의 "출력 스냅샷"을 JSON으로 저장하고, 두 스냅샷을 비교해 바뀐 항목을 목록으로 보여준다.
 *
 * 왜 필요한가: 졸업진단·챗봇 코드를 고칠 때마다 "학생에게 보이는 숫자가 어디서 바뀌었나"를 사람이 눈으로 찾을 수 없다.
 * 이전 파트(D-32)의 9,828개 조합 비교는 스크립트가 레포에 없어 재현이 안 됐다 — 같은 일이 반복되지 않게 도구로 남긴다.
 * 스냅샷 파일은 재생성할 수 있으므로 레포에 커밋하지 않는다(레포 밖 경로에 저장할 것).
 *
 * 사용법 (로컬 DB 전용 — DB_HOST가 localhost가 아니면 거부한다):
 *   node scripts/audit/regulationSnapshot.js snap <out.json>
 *   node scripts/audit/regulationSnapshot.js diff <before.json> <after.json>
 *
 * 스냅샷 내용
 *  - grid: (학과 × 대표 학번 × 입학유형)별 졸업진단(getGraduationStatus) — 총 요구학점, 카테고리별 요구학점, 졸업논문·인증제 수, 신뢰도, 플래그
 *  - scenarios: FINAL_REVIEW §4-2 시나리오(S1~S6c, X1~X3)의 챗봇 근거 청크 요약 — 제목, 판단 신뢰도, 졸업요건·이력 청크의 핵심 줄
 * 임시 학생 1명을 로컬 DB에 만들고 끝나면 지운다(다른 테스트 스크립트와 같은 방식).
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

// ---------------------------------------------------------------------------
// 순수 함수(테스트 대상): 스냅샷 비교
// ---------------------------------------------------------------------------

/** 두 스냅샷의 같은 키 값을 JSON으로 비교해 [{ section, key, before, after }]를 돌려준다. 한쪽에만 있는 키는 before/after가 undefined. */
function diffSnapshots(before, after) {
  const out = [];
  for (const section of ['grid', 'scenarios']) {
    const b = (before && before[section]) || {};
    const a = (after && after[section]) || {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) out.push({ section, key, before: b[key], after: a[key] });
    }
  }
  return out;
}

/** grid 항목 변경을 "무엇이 바뀌었나" 한 줄 문자열 목록으로(총학점·카테고리·신뢰도·플래그 단위). */
function describeGridChange(before, after) {
  const parts = [];
  if (!before || !after) return [before ? '조합 삭제' : '조합 추가'];
  if (before.total !== after.total) parts.push(`총학점 ${before.total}→${after.total}`);
  if (before.cats.join(',') !== after.cats.join(',')) parts.push(`카테고리 ${before.cats.join(',') || '(없음)'}→${after.cats.join(',') || '(없음)'}`);
  if (before.certs !== after.certs) parts.push(`졸업논문·인증제 ${before.certs}→${after.certs}`);
  if (before.confidence !== after.confidence) parts.push(`신뢰도 ${before.confidence}→${after.confidence}`);
  const added = after.flags.filter((f) => !before.flags.includes(f));
  const removed = before.flags.filter((f) => !after.flags.includes(f));
  if (added.length) parts.push(`플래그+ ${added.join(',')}`);
  if (removed.length) parts.push(`플래그- ${removed.join(',')}`);
  if (before.totalDefinitive !== after.totalDefinitive) parts.push(`totalDefinitive ${before.totalDefinitive}→${after.totalDefinitive}`);
  return parts;
}

/** 변경 목록을 사람이 읽는 요약으로: grid는 "변경 종류"별 건수 + 예시, scenarios는 항목별 전후. */
function summarizeDiff(changes, { examples = 3 } = {}) {
  const lines = [];
  const grid = changes.filter((c) => c.section === 'grid');
  const kinds = new Map();
  for (const c of grid) {
    const kind = describeGridChange(c.before, c.after).map((p) => p.replace(/[-0-9→]+.*$/, '').trim() || p).join(' + ') || '기타';
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind).push(c);
  }
  lines.push(`grid 변경 ${grid.length}건`);
  for (const [kind, list] of kinds) {
    lines.push(`  - [${kind}] ${list.length}건`);
    for (const c of list.slice(0, examples)) lines.push(`      ${c.key}: ${describeGridChange(c.before, c.after).join(' | ')}`);
  }
  const sc = changes.filter((c) => c.section === 'scenarios');
  lines.push(`scenarios 변경 ${sc.length}건`);
  for (const c of sc) {
    lines.push(`  - ${c.key}`);
    const keys = new Set([...Object.keys(c.before || {}), ...Object.keys(c.after || {})]);
    for (const k of keys) {
      if (JSON.stringify((c.before || {})[k]) !== JSON.stringify((c.after || {})[k])) {
        lines.push(`      ${k}: ${JSON.stringify((c.before || {})[k])} → ${JSON.stringify((c.after || {})[k])}`);
      }
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 스냅샷 생성 (DB 필요)
// ---------------------------------------------------------------------------

const GRID_YEARS = [2017, 2019, 2020, 2022, 2024, 2026, 2027];
const GRID_TYPES = [
  ['GENERAL', null],
  ['MAJOR_CHANGE', { grade: 3, year: null, semester: null }],
  ['MAJOR_CHANGE', { grade: 2, year: 2022, semester: 1 }],
  ['TRANSFER_ADMISSION', null],
];

// FINAL_REVIEW §4-2 시나리오. [id, 학과, 학번, 입학유형, 전과정보, 질문, 기준일]
const SCENARIOS = [
  ['S1', '컴퓨터·소프트웨어공학과', 2020, 'GENERAL', null, '20학번인데 졸업요건이 뭐야?'],
  ['S2', '컴퓨터·소프트웨어공학과', 2020, 'GENERAL', null, '20학번인데 이후에 바뀐 규정도 나한테 적용돼?'],
  ['S3', '컴퓨터·소프트웨어공학과', 2020, 'GENERAL', null, '필수였던 과목이 선택으로 바뀌었는데 나는 들어야 해?'],
  ['S4a', '컴퓨터·소프트웨어공학과', 2022, 'MAJOR_CHANGE', { grade: 3, year: 2024, semester: 2 }, '전과생인데 졸업요건이 어떻게 돼?'],
  ['S4b', '컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION', null, '편입생인데 졸업하려면 몇 학점 들어야 해?'],
  ['S5', '공학3계열', 2026, 'GENERAL', null, '내 졸업요건이 뭐야?'],
  ['S6a', '공학3계열', 2018, 'GENERAL', null, '졸업요건 알려줘'],
  ['S6b', '간호학과', 2017, 'GENERAL', null, '졸업요건 알려줘'],
  ['S6c', '공학3계열', 2027, 'GENERAL', null, '내 졸업요건이 뭐야?', '2027-04-01'],
  ['X1', '간호학과', 2023, 'GENERAL', null, '졸업하려면 몇 학점이야?'],
  ['X2', '국어교육과', 2023, 'GENERAL', null, '졸업학점이 언제 바뀌었어?'],
  ['X3', '국어교육과', 2023, 'GENERAL', null, '교양 학점이 언제 바뀌었어?'],
  ['X4', '간호학과', 2017, 'GENERAL', null, '전공 학점이 언제 바뀌었어?'],
  ['X5', '컴퓨터·소프트웨어공학과', 2022, 'GENERAL', null, '2025년 9월 1일 기준으로 내 졸업요건이 뭐였어?'],
  ['X6', '컴퓨터·소프트웨어공학과', 2022, 'MAJOR_CHANGE', { grade: 3, year: 2024, semester: 2 }, '22학번인데 졸업요건이 뭐야?'],
];
const BOOK_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

async function makeSnapshot() {
  const root = path.resolve(__dirname, '..', '..');
  require('dotenv').config({ path: path.join(root, '.env') });
  if ((process.env.DB_HOST || 'localhost') !== 'localhost') throw new Error('로컬 DB(DB_HOST=localhost)에서만 실행할 수 있어요.');

  const pool = require(path.join(root, 'server', 'db'));
  const { getGraduationStatus } = require(path.join(root, 'server', 'services', 'graduationService'));
  const { resolveYearContext } = require(path.join(root, 'server', 'services', 'yearContext'));
  const { assembleStructuredChunks, mergeChunks } = require(path.join(root, 'server', 'services', 'chatContextService'));

  const snapshot = { createdAt: new Date().toISOString(), grid: {}, scenarios: {} };
  const [created] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`snapshot-${Date.now()}@example.test`, `snapshot${Date.now()}`]);
  const sid = created.insertId;
  const setStudent = (deptId, year, type, mc) => pool.query(
    'UPDATE students SET department_id=?, admission_year=?, enrollment_type=?, major_change_grade=?, major_change_year=?, major_change_semester=? WHERE id=?',
    [deptId, year, type, mc ? mc.grade : null, mc ? mc.year : null, mc ? mc.semester : null, sid]
  );
  try {
    const [depts] = await pool.query('SELECT id, name FROM departments ORDER BY id');
    for (const d of depts) {
      for (const year of GRID_YEARS) {
        for (const [type, mc] of GRID_TYPES) {
          if (mc && mc.year != null && mc.year < year) continue; // 입학 전 전과는 불가능한 조합
          await setStudent(d.id, year, type, mc);
          const s = await getGraduationStatus(sid);
          const reg = s.regulation || {};
          snapshot.grid[`${d.name}|${year}|${type}|${mc ? `${mc.grade}-${mc.year}-${mc.semester}` : ''}`] = {
            total: s.totalRequiredCredits,
            cats: s.categories.map((c) => `${c.category}:${c.requiredCredits}`).sort(),
            certs: s.certifications.length,
            confidence: reg.confidence ?? null,
            flags: (reg.flags || []).filter((f) => f.level !== 'INFO').map((f) => f.code).sort(),
            totalDefinitive: reg.totalDefinitive ?? null,
            liberalArtsCap: reg.liberalArtsCap ? reg.liberalArtsCap.applied : null,
          };
        }
      }
    }

    for (const [id, dept, year, type, mc, question, asOf] of SCENARIOS) {
      const [[d]] = await pool.query('SELECT id FROM departments WHERE name = ?', [dept]);
      await setStudent(d.id, year, type, mc);
      const [[student]] = await pool.query('SELECT * FROM students WHERE id = ?', [sid]);
      const yc = resolveYearContext({ message: question, profileCohort: year, availableBookYears: BOOK_YEARS, today: asOf || '2026-10-05' });
      const structured = await assembleStructuredChunks({ message: question, searchText: question, student, yearContext: yc });
      const merged = mergeChunks({ structured, yearContext: yc });
      const g = await getGraduationStatus(sid).catch((e) => ({ error: e.message }));
      const lineOf = (c, re) => c.content.split('\n').filter((l) => re.test(l)).map((l) => l.trim().slice(0, 160));
      snapshot.scenarios[id] = {
        question: `${dept} ${year} ${type}: ${question}`,
        yearContext: { mode: yc.mode, targetYears: yc.targetYears, asOfDate: yc.asOfDate },
        judgmentConfidence: structured.judgment ? structured.judgment.confidence : null,
        chunkTitles: merged.map((c) => c.documentTitle),
        judgmentLines: merged.filter((c) => String(c.chunkId).startsWith('regulation-judgment')).flatMap((c) => lineOf(c, /^(전체 신뢰도|졸업요건 값|※|학칙 \[별표 4\]|\[별표 4\])/)),
        requirementChunks: merged.filter((c) => String(c.chunkId).startsWith('graduation-')).map((c) => ({ title: c.documentTitle, lines: c.content.split('\n').slice(0, 8).map((l) => l.trim().slice(0, 140)) })),
        historyChunks: merged.filter((c) => String(c.chunkId).startsWith('history-rule')).map((c) => ({ title: c.documentTitle, lines: c.content.split('\n').map((l) => l.trim().slice(0, 140)) })),
        diagnosis: g.error ? { error: g.error } : { total: g.totalRequiredCredits, cats: g.categories.map((c) => `${c.category}:${c.requiredCredits}`), confidence: g.regulation.confidence },
      };
    }
  } finally {
    await pool.query('DELETE FROM students WHERE id = ?', [sid]);
    await pool.end();
  }
  return snapshot;
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'snap' && a) {
    const snap = await makeSnapshot();
    fs.writeFileSync(a, JSON.stringify(snap));
    console.log(`저장: ${a} (grid ${Object.keys(snap.grid).length}개, scenarios ${Object.keys(snap.scenarios).length}개)`);
  } else if (cmd === 'diff' && a && b) {
    const changes = diffSnapshots(JSON.parse(fs.readFileSync(a, 'utf8')), JSON.parse(fs.readFileSync(b, 'utf8')));
    console.log(summarizeDiff(changes));
    if (process.argv.includes('--json')) console.log(JSON.stringify(changes));
  } else {
    console.error('사용법: node scripts/audit/regulationSnapshot.js snap <out.json> | diff <before.json> <after.json>');
    process.exit(2);
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { diffSnapshots, describeGridChange, summarizeDiff, GRID_YEARS, GRID_TYPES, SCENARIOS };
