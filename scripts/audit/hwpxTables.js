#!/usr/bin/env node
/**
 * scripts/audit/hwpxTables.js
 * 한글(HWPX) 규정 원본에서 표를 "구조 그대로" 읽어, 학칙 [별표 4](졸업학점별 대학·이수학점)의 학번 구간별 졸업학점표를 뽑는다.
 *
 * 왜 필요한가: 레포의 `_전문.txt`는 HWPX를 텍스트로 변환한 것이라 표가 한 줄로 뭉개져 있다(칸 경계가 사라짐). 표의 "어느 학과가
 * 몇 학점 칸에 있는가"를 변환본으로 판독하면 오판독 가능성이 있어, 원본 HWPX의 표 구조(행·열 위치·병합)로 직접 확인한다.
 * HWPX는 zip 안의 XML이다. 레포에 zip/XML 라이브러리가 없어서 Node 내장 zlib으로 zip을 읽고 필요한 태그만 훑는 최소 구현이다.
 *
 * 사용법:
 *   node scripts/audit/hwpxTables.js            # [별표 4] 표를 읽어 요약 출력
 *   node scripts/audit/hwpxTables.js --write    # db/regulation-engine/schedule4_credits.json + schedule1_colleges.json 갱신
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HWPX_PATH = path.join(REPO_ROOT, 'db', 'regulations', '_source', '원광대학교_학칙_20260626.hwpx');
const OUT_PATH = path.join(REPO_ROOT, 'db', 'regulation-engine', 'schedule4_credits.json');
const COLLEGES_OUT_PATH = path.join(REPO_ROOT, 'db', 'regulation-engine', 'schedule1_colleges.json');
const SCHEDULE4_TITLE_RE = /졸업학점별 대학, 이수학점 및 수료인정학점\(([^)]*)\)/;

// --- zip 읽기(중앙 디렉터리) ---------------------------------------------------

function readZipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip 끝 레코드(EOCD)를 찾지 못했어요');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 중앙 디렉터리가 깨졌어요');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === wanted) {
      const lh = localOffset;
      const dataStart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
      const data = buf.slice(dataStart, dataStart + compSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip 안에 ${wanted}가 없어요`);
}

// --- XML 훑기: 표(hp:tbl) → 행(hp:tr) → 칸(hp:tc: cellAddr, cellSpan, 문단 텍스트) ---

const decodeEntities = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`${name}="(\\d+)"`).exec(tag); return m ? Number(m[1]) : null; };

/**
 * section XML 문자열 → { tables: [{ index, depth, title, rows: [[{ col, row, colSpan, rowSpan, text: string[] }]] }] }.
 * index는 문서에서 표가 열린 순서(0부터), title은 그 표 바로 앞 표 밖 문단 중 [별표 4] 제목 문단(없으면 null).
 */
function parseTables(xml) {
  const tables = [];
  const stack = []; // 열린 표들
  let lastTitle = null;
  let para = null; // 현재 문단 텍스트 조각
  let inT = false;
  const re = /<(\/?)hp:(tbl|tr|tc|p|t|cellAddr|cellSpan|lineBreak|tab)\b([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[5] !== undefined) { if (inT && para !== null) para.push(decodeEntities(m[5])); continue; }
    const closing = m[1] === '/';
    const tag = m[2];
    const raw = m[0];
    const top = stack[stack.length - 1];
    if (tag === 'tbl') {
      if (!closing) {
        const t = { index: tables.length, depth: stack.length, title: stack.length === 0 ? lastTitle : null, rows: [] };
        tables.push(t); stack.push(t);
        if (stack.length === 1) lastTitle = null; // 제목은 바로 다음 표 하나만 쓴다(뒤따르는 다른 표가 물려받지 않게)
      } else stack.pop();
    } else if (tag === 'tr' && top) {
      if (!closing) top.rows.push([]);
    } else if (tag === 'tc' && top) {
      if (!closing && top.rows.length) top.rows[top.rows.length - 1].push({ col: 0, row: 0, colSpan: 1, rowSpan: 1, text: [] });
    } else if (tag === 'cellAddr' && top) {
      const row = top.rows[top.rows.length - 1]; const cell = row && row.slice(-1)[0];
      if (cell) { cell.col = attr(raw, 'colAddr'); cell.row = attr(raw, 'rowAddr'); }
    } else if (tag === 'cellSpan' && top) {
      const row = top.rows[top.rows.length - 1]; const cell = row && row.slice(-1)[0];
      if (cell) { cell.colSpan = attr(raw, 'colSpan') || 1; cell.rowSpan = attr(raw, 'rowSpan') || 1; }
    } else if (tag === 'p') {
      if (!closing && !m[4]) para = [];
      else if (closing && para !== null) {
        const text = para.join('').trim();
        para = null;
        if (text) {
          if (top) { const row = top.rows[top.rows.length - 1]; const cell = row && row.slice(-1)[0]; if (cell) cell.text.push(text); } // 행 밖 문단(캡션 등)은 건너뜀
          else if (SCHEDULE4_TITLE_RE.test(text)) lastTitle = text;
        }
      }
    } else if (tag === 't') {
      if (!closing && !m[4]) inT = true; else if (closing) inT = false;
    } else if ((tag === 'lineBreak' || tag === 'tab') && inT && para !== null) para.push(tag === 'tab' ? ' ' : '\n');
  }
  return { tables };
}

// --- [별표 4] 해석 ---------------------------------------------------------------

/** 제목 "(2026학년도 입학생 이후)" 등 → { min, max } 학번 범위. */
function cohortRangeFromTitle(title) {
  const inner = SCHEDULE4_TITLE_RE.exec(title)[1].replace(/\s+/g, '');
  let m;
  if ((m = /^(\d{4})학년도~(\d{4})학년도입학생$/.exec(inner))) return { min: Number(m[1]), max: Number(m[2]) };
  if ((m = /^(\d{4})학년도입학생이후$/.exec(inner))) return { min: Number(m[1]), max: null };
  if ((m = /^(\d{4})학년도입학생$/.exec(inner))) return { min: Number(m[1]), max: Number(m[1]) };
  if ((m = /^~(\d{4})학년도입학생$/.exec(inner))) return { min: null, max: Number(m[1]) };
  throw new Error(`학번 범위를 읽지 못한 제목: ${title}`);
}

/**
 * 칸 하나의 텍스트 줄들 → 항목들. 쉼표로 나누고, 이름 뒤 괄호는 note로 분리한다.
 * 첫 줄의 "(한의예과, 치의예과, 의예과 80학점이상)"처럼 괄호 전체가 한 줄이면 그 안의 학과들은 별도 80학점 항목(PRECOURSE)이다.
 */
function entriesFromCell(lines) {
  const entries = [];
  const flat = lines.join(' ').replace(/\s+/g, ' ').trim();
  const pre = /\(([^()]*?)\s*(\d+)학점\s*이상\)/.exec(flat);
  const main = pre ? flat.replace(pre[0], '') : flat;
  for (const part of main.split(/[,，]/)) {
    const raw = part.trim();
    if (!raw) continue;
    const m = /^([^()]+?)\s*(?:\(([^)]*)\))?$/.exec(raw);
    const name = m[1].trim();
    entries.push({ name, kind: /(대학|계열|학부)$/.test(name) ? 'UNIT' : 'DEPARTMENT', note: m[2] ? m[2].trim() : null });
  }
  if (pre) for (const n of pre[1].split(/[,，]/)) if (n.trim()) entries.push({ name: n.trim(), kind: 'PRECOURSE', note: `${pre[2]}학점 이상`, credits: Number(pre[2]) });
  return entries;
}

/** 표 하나(머리글 행 + 대학·학과 행) → { cohort, tiers: [{ credits, entries }] }. */
function readSchedule4Table(table) {
  const [header, units] = table.rows;
  const tiers = [];
  for (const h of header) {
    const m = /(\d+)\s*학점/.exec(h.text.join(' '));
    if (!m) continue;
    const cells = units.filter((c) => c.col >= h.col && c.col < h.col + h.colSpan);
    tiers.push({ credits: Number(m[1]), entries: cells.flatMap((c) => entriesFromCell(c.text)) });
  }
  return { cohort: cohortRangeFromTitle(table.title), title: table.title.replace(/^[^\s]*\s*/, '').trim(), tiers };
}

/** 원본 HWPX → [별표 4] 학번 구간별 졸업학점표(4개). */
function extractSchedule4(hwpxPath = HWPX_PATH) {
  const xml = readZipEntry(fs.readFileSync(hwpxPath), 'Contents/section0.xml').toString('utf8');
  const { tables } = parseTables(xml);
  const found = tables.filter((t) => t.depth === 0 && t.title && SCHEDULE4_TITLE_RE.test(t.title));
  return {
    source: path.relative(REPO_ROOT, hwpxPath).replace(/\\/g, '/'),
    note: '학칙 [별표 4] 졸업학점별 대학·이수학점 표에서 졸업학점 칸(이상)별 소속 항목만 옮김. 항목 kind: DEPARTMENT(학과) / UNIT(대학·계열·학부 — 학과 소속 자료가 없어 대조하지 않음) / PRECOURSE(예과, 80학점). 이 파일은 scripts/audit/hwpxTables.js가 만든다 — 손으로 고치지 말 것.',
    tables: found.map(readSchedule4Table),
  };
}

// --- [별표 1] 해석: 대학(광역계열) → 모집단위·학과 소속 ----------------------------------

const cellName = (c) => c.text.join('').replace(/\s+/g, '');
const covers = (cell, row) => cell.row <= row && row < cell.row + cell.rowSpan;

/** 한 칸의 문단들 → 이름 목록. 문단마다 하나, 앞의 '-'(계열 아래 세부 전공 표시)와 공백 제거. */
const namesOfCell = (c) => c.text.map((t) => t.replace(/^-/, '').replace(/\s+/g, '')).filter((t) => t && t !== '-');

/** 열 위치(col)에 있는 칸들 중 그 행(row)을 덮는 칸. 병합 칸은 첫 행에만 적혀 있어 rowSpan으로 덮는 행을 계산한다. */
function cellCovering(cells, col, row) {
  return cells.find((c) => c.col === col && covers(c, row)) || null;
}

/**
 * [별표 1](학과·전공 및 광역계열 입학정원) 표 → "대학(또는 광역계열) → 소속 학과·모집단위 이름들".
 * 병합 칸 구조(행·열 위치와 rowSpan)로 읽는다: 대학 칸이 덮는 행 안에 있는 학과 칸이 그 대학 소속이다 — 변환 텍스트로 추측하지 않는다.
 *  - GLOCAL(2026·2027학년도 이후 표): 대학=열 1, 모집단위=열 3~4(계열 칸이 2칸을 차지하면 열 4).
 *  - YEARS(2025 이전 표): 2025학년도 = 대학 열 0, 학과(부)·전공 열 2 / 2024학년도 = 대학 열 4, 학과 열 6. 2023·2022학년도 칸에는 대학 열이 없어 읽지 않는다.
 */
function readColleges(table, spec) {
  const cells = table.rows.flat();
  const maxRow = Math.max(...cells.map((c) => c.row + c.rowSpan));
  const byCollege = new Map();
  for (let r = 2; r < maxRow; r++) {
    const college = cellCovering(cells, spec.collegeCol, r);
    if (!college) continue;
    const collegeName = cellName(college);
    if (!collegeName) continue;
    const unitCells = cells.filter((c) => spec.unitCols.includes(c.col) && c.row === r);
    for (const u of unitCells) {
      const names = namesOfCell(u);
      if (!names.length) continue;
      if (!byCollege.has(collegeName)) byCollege.set(collegeName, new Set());
      for (const n of names) if (n !== '소계') byCollege.get(collegeName).add(n);
    }
  }
  return [...byCollege.entries()].map(([college, units]) => ({ college, units: [...units] }));
}

/** 원본 HWPX → [별표 1] 학번별 대학 소속(2027 이후·2026·2025·2024). 머리글이 기대와 다르면 던진다(조용히 잘못 읽는 것보다 낫다). */
function extractSchedule1Colleges(hwpxPath = HWPX_PATH) {
  const xml = readZipEntry(fs.readFileSync(hwpxPath), 'Contents/section0.xml').toString('utf8');
  const { tables } = parseTables(xml);
  const header = (t) => t.rows.slice(0, 2).flat().map((c) => c.text.join('')).join('|');
  const top = tables.filter((t) => t.depth === 0 && t.rows.length > 10 && /대학/.test(header(t)) && /(입학정원)/.test(header(t)));
  if (top.length !== 3) throw new Error(`[별표 1] 표 3개를 기대했는데 ${top.length}개예요(HWPX 구조가 바뀜?)`);
  const [t2027, t2026, tOld] = top;
  if (!/2027/.test(header(t2027)) || !/2026/.test(header(t2026)) || !/2025학년도/.test(header(tOld)) || !/2024학년도/.test(header(tOld))) throw new Error('[별표 1] 표 머리글의 학년도가 기대와 달라요');
  const glocal = { collegeCol: 1, unitCols: [3, 4] };
  const out = [
    { cohort: { min: 2027, max: null }, source: '[별표 1] 입학정원(2027학년도 이후)', colleges: readColleges(t2027, glocal) },
    { cohort: { min: 2026, max: 2026 }, source: '[별표 1] 입학정원(2026학년도 이후)', colleges: readColleges(t2026, glocal) },
    { cohort: { min: 2025, max: 2025 }, source: '[별표 1] 입학정원(2025학년도 이전) 2025학년도 칸', colleges: readColleges(tOld, { collegeCol: 0, unitCols: [2] }) },
    { cohort: { min: 2024, max: 2024 }, source: '[별표 1] 입학정원(2025학년도 이전) 2024학년도 칸', colleges: readColleges(tOld, { collegeCol: 4, unitCols: [6] }) },
  ];
  return {
    source: path.relative(REPO_ROOT, hwpxPath).replace(/\\/g, '/'),
    note: '학칙 [별표 1]에서 "대학(광역계열) 칸이 덮는 행 안의 학과·모집단위"를 병합 칸 구조로 읽어 옮김. 2023학년도 이전은 [별표 1]에 대학 열이 없어 포함하지 않는다(그 학번은 학과→대학을 알 수 없다). 이 파일은 scripts/audit/hwpxTables.js가 만든다 — 손으로 고치지 말 것.',
    tables: out,
  };
}

if (require.main === module) {
  const result = extractSchedule4();
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`저장: ${path.relative(REPO_ROOT, OUT_PATH)}`);
    fs.writeFileSync(COLLEGES_OUT_PATH, `${JSON.stringify(extractSchedule1Colleges(), null, 2)}\n`);
    console.log(`저장: ${path.relative(REPO_ROOT, COLLEGES_OUT_PATH)}`);
  }
  for (const t of result.tables) {
    console.log(`\n[별표 4] ${t.title} — 학번 ${t.cohort.min ?? ''}~${t.cohort.max ?? ''}`);
    for (const tier of t.tiers) console.log(`  ${tier.credits}학점: ${tier.entries.map((e) => e.name + (e.note ? `(${e.note})` : '')).join(', ') || '(없음)'}`);
  }
}

module.exports = { readZipEntry, parseTables, extractSchedule4, extractSchedule1Colleges, COLLEGES_OUT_PATH, readSchedule4Table, entriesFromCell, cohortRangeFromTitle, HWPX_PATH, OUT_PATH };
