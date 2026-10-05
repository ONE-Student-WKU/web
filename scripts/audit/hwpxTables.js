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
 *   node scripts/audit/hwpxTables.js --write    # db/regulation-engine/schedule4_credits.json 갱신
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HWPX_PATH = path.join(REPO_ROOT, 'db', 'regulations', '_source', '원광대학교_학칙_20260626.hwpx');
const OUT_PATH = path.join(REPO_ROOT, 'db', 'regulation-engine', 'schedule4_credits.json');
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

if (require.main === module) {
  const result = extractSchedule4();
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`저장: ${path.relative(REPO_ROOT, OUT_PATH)}`);
  }
  for (const t of result.tables) {
    console.log(`\n[별표 4] ${t.title} — 학번 ${t.cohort.min ?? ''}~${t.cohort.max ?? ''}`);
    for (const tier of t.tiers) console.log(`  ${tier.credits}학점: ${tier.entries.map((e) => e.name + (e.note ? `(${e.note})` : '')).join(', ') || '(없음)'}`);
  }
}

module.exports = { readZipEntry, parseTables, extractSchedule4, readSchedule4Table, entriesFromCell, cohortRangeFromTitle, HWPX_PATH, OUT_PATH };
