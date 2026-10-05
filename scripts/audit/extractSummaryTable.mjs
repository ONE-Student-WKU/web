#!/usr/bin/env node
/**
 * scripts/audit/extractSummaryTable.mjs
 * 교육과정 책자 PDF의 "학과(부)별 이수학점 기준 총괄표" 행(학과명 + 숫자열)을 위치 기반으로 뽑는다.
 * auditRequirements.js가 이 행을 db/seed/curriculum_requirements.json의 졸업요건과 학과 단위로 대조한다.
 *
 * 왜 이 표가 최우선인가: 졸업요건 시드는 앞 학년도 값을 틀로 복제한 뒤 책자와 다른 값만 고치는 방식으로 만들어졌다(복제 오염 위험).
 * 총괄표는 학과당 한 줄의 작은 표라서 전수 대조가 가능하고, 틀린 값이 하나만 남아도 규정 판단 엔진이 그 값을 "확정"으로 내보낸다.
 *
 * 사용법: node scripts/audit/extractSummaryTable.mjs <pdf경로> [--out rows.json] [--pages 28-30]
 *   --pages를 안 주면 제목("이수학점 기준 총괄표")이 있는 쪽부터 이어지는 쪽을 자동으로 찾는다.
 * 출력 행: { page, name, tokens: [{ x, s }] } — tokens는 학과명 이후의 조각을 x좌표 순으로. 열 의미는 연도마다 달라서
 *   (표 머리가 연도별로 다름) 해석은 auditRequirements.js의 연도별 설정이 맡는다.
 */

import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const LINE_TOL = 2.5;

async function loadLines(page) {
  const tc = await page.getTextContent();
  const lines = [];
  for (const it of tc.items) {
    const s = it.str.trim();
    if (s === '') continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) < LINE_TOL);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    // 2026 판처럼 "P/F 130" 두 칸이 한 조각으로 합쳐 나오는 경우가 있다 — 숫자/P·F로만 된 조각은 공백으로 나누고 x는 글자 수 비율로 추정한다.
    const parts = s.split(/\s+/);
    if (parts.length > 1 && parts.every((p) => /^(P\/F|\d+(\.\d+)?)$/.test(p))) {
      let offset = 0;
      for (const p of parts) {
        line.items.push({ x: x + (it.width * offset) / s.length, s: p });
        offset += p.length + 1;
      }
    } else {
      line.items.push({ x, s });
    }
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

const joined = (lines) => lines.map((l) => l.items.map((i) => i.s).join('')).join('').replace(/\s+/g, '');

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('사용법: node extractSummaryTable.mjs <pdf경로> [--out rows.json] [--pages 28-30]'); process.exit(2); }
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;

  let pageRange;
  const pi = args.indexOf('--pages');
  if (pi !== -1) {
    const [a, b] = args[pi + 1].split('-').map(Number);
    pageRange = [a, b ?? a];
  } else {
    // 제목 쪽 찾기: 앞쪽(목차 이후 80쪽 이내)에서 "이수학점기준총괄표"가 들어간 쪽부터, 학과명 행이 계속 나오는 쪽까지.
    let start = null;
    let end = null;
    for (let p = 1; p <= Math.min(doc.numPages, 90); p++) {
      const lines = await loadLines(await doc.getPage(p));
      const text = joined(lines);
      const isTitle = text.includes('이수학점기준총괄표') && /학과\(부\)별|학과별/.test(text.slice(0, 40)) ;
      if (start === null && isTitle) start = p;
      if (start !== null) {
        const deptRows = lines.filter((l) => l.items[0] && l.items[0].x < 80 && /^[가-힣·()]{3,}$/.test(l.items[0].s) && l.items.filter((i) => /^\d+$/.test(i.s)).length >= 5).length;
        if (deptRows >= 3) end = p; else if (p > start + 1 && end !== null) break;
      }
    }
    if (start === null) { console.error('총괄표 제목 쪽을 찾지 못했습니다(--pages로 지정).'); process.exit(1); }
    pageRange = [start, end ?? start];
  }

  const rows = [];
  const NUM = /^\d+(\.\d+)?$/;
  for (let p = pageRange[0]; p <= pageRange[1]; p++) {
    const lines = await loadLines(await doc.getPage(p));
    // 학과명 칸의 오른쪽 끝 = 이 쪽 표에서 가장 왼쪽 숫자 칸(교양 첫 칸)의 x. 그보다 왼쪽 조각이 학과명(글자 단위로 쪼개진 이름도
    // 이어 붙인다), 그 오른쪽이 숫자열/서술이다. (같은 줄에 학과명과 "4개 영역 중 3개" 같은 서술이 같이 있어도 이름이 안 오염된다.)
    const numXs = lines.flatMap((l) => l.items.filter((t) => NUM.test(t.s) && t.x >= 100).map((t) => t.x)).sort((a, b) => a - b);
    const nameMaxX = (numXs.length ? numXs[Math.floor(numXs.length * 0.05)] : 120) - 2;
    const split = (l) => {
      const nameItems = l.items.filter((t) => t.x < nameMaxX);
      const rest = l.items.filter((t) => t.x >= nameMaxX);
      return { name: nameItems.map((t) => t.s).join(''), tokens: rest, y: l.y };
    };
    const parsed = lines.map(split);
    const isNum = (t) => /^[\d.]+$/.test(t.s) || /^(P\/F|이상)$/.test(t.s) || /^\d+이상$/.test(t.s);
    const numRows = parsed.filter((r) => r.tokens.filter(isNum).length >= 5);
    // 학과명이 숫자 줄과 다른 줄에 있거나 여러 줄로 나뉜 경우(복지·보건학부 + "( 사회복지학 )", "컴퓨터·소프트웨어" + "공학과" 등):
    // 숫자가 없는 이름 줄을 세로로 가장 가까운(≤14pt) 숫자 줄에 붙이고, 위쪽 줄 → 같은 줄 → 아래쪽 줄 순서로 이어 붙인다.
    const extra = new Map(numRows.map((r) => [r, []]));
    const extraNums = new Map(numRows.map((r) => [r, []]));
    for (let li = 0; li < lines.length; li++) {
      const l = parsed[li];
      if (numRows.includes(l)) continue;
      // 이름 줄: 학과명 칸(x<120)에서 시작하고 숫자가 없는 줄.  숫자 줄: 모든 조각이 숫자/이상(2025·2026 표에서 기본전공 "19"와 "이상"이
      // 본 숫자 줄 위·아래 줄에 따로 찍힌다).  그 밖의 줄(서술 문구 등)은 무시한다.
      // 한 줄에 이름 조각(왼쪽), 서술 문구, 숫자 조각이 섞여 있을 수 있다(예: "철도시스템 | 4개 영역 중 3개 | 19").
      // 이름 칸의 글자는 이름에, 숫자·이상 조각은 숫자에 붙이고 서술 문구는 버린다.
      const nameStr = l.name;
      const numItems = l.tokens.filter((t) => isNum(t));
      if (!nameStr && numItems.length === 0) continue;
      let nearest = null;
      for (const r of numRows) {
        const d = Math.abs(r.y - l.y);
        if (d <= 14 && (!nearest || d < nearest.d)) nearest = { r, d };
      }
      if (!nearest) continue;
      if (nameStr) extra.get(nearest.r).push({ name: nameStr, y: l.y });
      if (numItems.length) extraNums.get(nearest.r).push(...numItems);
    }
    for (const r of numRows) {
      const parts = [...extra.get(r).filter((l) => l.y > r.y).sort((a, b) => b.y - a.y).map((l) => l.name), r.name,
        ...extra.get(r).filter((l) => l.y <= r.y).sort((a, b) => b.y - a.y).map((l) => l.name)];
      const name = parts.join('');
      if (!name || !/[가-힣]/.test(name)) continue;
      const tokens = [...r.tokens, ...extraNums.get(r)].sort((a, b) => a.x - b.x);
      rows.push({ page: p, name, tokens });
    }
  }
  const oi = args.indexOf('--out');
  const result = { file, pages: pageRange, rows };
  if (oi !== -1) fs.writeFileSync(args[oi + 1], JSON.stringify(result));
  console.log(`${file}: 총괄표 쪽 ${pageRange[0]}~${pageRange[1]}, 학과 행 ${rows.length}개`);
}

await main();
