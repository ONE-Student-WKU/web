#!/usr/bin/env node
/**
 * scripts/import/buildTimetableSource.js
 * parseTimetablePdfs.py의 출력(PDF별 머리글 + 행)을 앱 학과·트랙에 연결해 개설과목 시드 원본
 * (db/curriculum/_source/전공시간표_<연도>-<학기>_전학과.json)으로 만든다. seedCourseOfferings.js가 이 파일을 읽는다.
 *
 * 사용법: node scripts/import/buildTimetableSource.js <parse 출력.json> [--overrides <파일.json>] [--collected-at YYYY-MM-DD]
 *   --overrides: { "PDF 파일명": "학과 트랙" } — 머리글 이름이 잘려 자동 연결이 안 되는 PDF를 손으로 연결한다
 *                (예: 2026-2의 242.pdf는 "공학1계열"로만 찍혔지만 학수번호 M02로 "공학1계열 건설환경공학전공").
 *
 * 연결 규칙(db/seed/departments.json 기준):
 *  1) 학과 이름이 그대로 있으면 그 학과(트랙 없음)
 *  2) "학과 트랙"으로 나뉘면 그 학과의 그 트랙
 *  3) 머리글이 잘렸으면(사이트 학과 칸 폭) "학과 트랙" 전체 이름 중 앞부분이 하나로만 맞는 것
 *  4) 그래도 안 되면 MANUAL(사이트 표기가 다른 것) → 없으면 unmapped(앱 학과 목록에 없는 과정 — 시딩하지 않음)
 * 빈 표(학과가 없거나 과목이 없는 조회)는 넣지 않는다. 같은 머리글이 두 번 나오면 실패한다(중복 저장 확인).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MANUAL = { '파인아트전공': ['디자인융합계열', '파인아트전공'], '약학과(2+4년)': ['약학과', '2+4년제'] };

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function main() {
  const parsed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const overrides = arg('--overrides') ? JSON.parse(fs.readFileSync(arg('--overrides'), 'utf8')) : {};
  const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'seed', 'departments.json'), 'utf8'));
  const list = Array.isArray(deps) ? deps : deps.departments || Object.values(deps)[0];
  const tracks = new Map(list.map((d) => [d.name, new Set((d.tracks || []).map((t) => t.name || t))]));
  const fullNames = list.flatMap((d) => (d.tracks || []).map((t) => `${d.name} ${t.name || t}`));
  const compact = (s) => s.replace(/\s/g, '');

  function resolve(name) {
    if (MANUAL[name]) return MANUAL[name];
    if (tracks.has(name)) return [name, null];
    const i = name.indexOf(' ');
    if (i > 0 && tracks.get(name.slice(0, i))?.has(name.slice(i + 1))) return [name.slice(0, i), name.slice(i + 1)];
    const cands = fullNames.filter((f) => compact(f).startsWith(compact(name)) && compact(f) !== compact(name));
    if (cands.length === 1 && name.includes(' ')) return resolve(cands[0]);
    return [null, null];
  }

  const errors = parsed.filter((p) => p.error || !p.header);
  if (errors.length) throw new Error(`읽지 못한 PDF: ${errors.map((p) => p.file).join(', ')}`);
  const seen = new Map();
  const entries = [];
  const unmapped = [];
  for (const p of parsed) {
    if (p.rows.length === 0) continue;
    const name = (overrides[p.file] || p.header.dept).replace(/\(2년제\)$/, '').trim();
    const key = `${p.header.college}|${name}`;
    if (seen.has(key)) throw new Error(`같은 조회가 두 번 저장됨: ${key} (${seen.get(key)}, ${p.file})`);
    seen.set(key, p.file);
    const [department, track] = resolve(name);
    const item = {
      department, track,
      college: p.header.college === ':::대학명선택:::' ? null : p.header.college,
      printedName: p.header.dept,
      ...(overrides[p.file] ? { note: `머리글 이름이 잘려 손으로 연결(--overrides): ${overrides[p.file]}` } : {}),
      year: p.header.year, semester: p.header.term,
      rows: p.rows.map((r) => ({ grade: r.grade, category: r.category, courseCode: r.code, courseName: r.name, section: r.section, credits: r.credits, time: r.time, professor: r.professor, room: r.room })),
    };
    (department ? entries : unmapped).push(item);
  }
  const { year, semester } = entries[0];
  const out = {
    source: '원광대 웹정보서비스 "학과/부/계열별 시간표 조회"(공개 화면)를 사람이 직접 조회해 "화면 출력"으로 저장한 PDF를 읽어 정리',
    collectedAt: arg('--collected-at') || new Date().toISOString().slice(0, 10),
    term: `${year}학년도 ${semester}학기`,
    note: '학교 사이트에서 이번 학기만 조회되므로 다음 학기에는 같은 방식으로 새로 모은다. 교수 이름은 화면에 공개된 그대로 둔다. unmapped는 앱 학과 목록에 없는 과정(시딩하지 않음).',
    entries,
    unmapped,
  };
  const target = path.join(ROOT, 'db', 'curriculum', '_source', `전공시간표_${year}-${semester}_전학과.json`);
  fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
  console.log(`${target}: 연결 ${entries.length}개(${entries.reduce((s, e) => s + e.rows.length, 0)}행), 미연결 ${unmapped.length}개`);
}

main();
