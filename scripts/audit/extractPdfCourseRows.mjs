#!/usr/bin/env node
/**
 * scripts/audit/extractPdfCourseRows.mjs
 * 교육과정 책자 PDF(텍스트가 있는 판)에서 "전공과목 이수" 표의 과목 행을 프로그램으로 다시 뽑는다.
 * db/curriculum/_source/YYYY_학과별_전공과목_원본.json과 자동 대조(diffPdfVsJson.js)하기 위한 독립 재추출이다.
 *
 * 왜 PDF 텍스트를 직접 다시 뽑는가: JSON은 사람이/AI가 옮긴 결과라 전사 오류가 섞일 수 있다. 같은 책자를 기계가 다른
 * 방법으로 읽어 두 결과가 갈라지는 행만 사람이 확인하면, 전수 육안 확인 없이도 오류 후보를 좁힐 수 있다.
 *
 * 사용법: node scripts/audit/extractPdfCourseRows.mjs <pdf경로> [--out rows.json]
 *   - PDF는 레포에 넣지 않는다(레포 밖 짧은 경로, 예: C:\tmp\curriculum-pdf\2023.pdf). 근거는 파일명과 쪽수로만 남긴다.
 *   - 스캔본(텍스트 없음, 2018·2020)과 글자 코드가 깨진 판(2017)은 추출 행이 거의 없다 — 결과의 pagesWithRows로 판단.
 *   - pdfjs-dist는 server의 pdf-parse가 끌고 오는 의존성을 그대로 쓴다(별도 설치 없음).
 *
 * 출력 행: { page, tableIndex, majorTable, grade, semester, categoryRaw, courseCode, courseName, credits, hours }
 *   page는 PDF 뷰어 쪽(1부터). 책자 인쇄 쪽과의 차이는 연도마다 다르다(이슈 #260 상단 쪽수 규칙 참고).
 */

import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// 책자 이수구분 표기(전기/전필/전선/교직/교필/교선/기전/선전/계필 …). 코드 6자리 앞에 오는 짧은 한글 토큰.
const CATEGORY_RE = /^[가-힣]{1,3}$/;
// 학수번호: 6자리 숫자(대부분), 2026 광역계열·보건계열의 영숫자 5~6자(예: M02001, 11J001, L0005, H03016).
// 영문 대문자 단어(예: "MSC")를 코드로 오인하지 않도록 숫자가 3개 이상 들어간 것만 코드로 본다.
const isCode = (s) => /^[0-9A-Z]{5,6}$/.test(s) && (s.match(/\d/g) || []).length >= 3;
const NUM_RE = /^\d+(\.\d+)?$/;
const LINE_TOL = 2.5; // 같은 줄로 볼 y 오차(pt)

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
    line.items.push({ x, s });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

// 머리글 줄 = '구분'과 '학점'이 같은 줄에 있는 줄. 그 줄 앞뒤 몇 줄에서 열 x좌표(구분·학점·학년·학기)를 읽는다.
// 한 쪽 안에 표가 둘 이상일 수도, 학과 소개 뒤 쪽 중간에서 표가 시작할 수도 있어 줄 단위로 처리한다.
function isHeaderLine(line) {
  // 판마다 머리글 조각 방식이 달라('구분 학수번호'가 한 조각인 판도 있음) 부분 일치로 찾는다.
  return line.items.some((i) => i.s.includes('구분')) && line.items.some((i) => i.s === '학점');
}

function readHeader(lines, headerIdx) {
  const cols = {};
  let hasGrade = false;
  for (const l of lines.slice(Math.max(0, headerIdx - 3), headerIdx + 4)) {
    for (const it of l.items) {
      if (it.s === '학점') cols.credit = it.x;
      if (it.s.includes('구분')) cols.category = it.x;
      // 머리글이 '학' '년' / '학' '기'로 쪼개진 판과 '학년' '학기'가 한 조각인 판(2025 광역계열)이 있다.
      if (it.s === '년' || it.s === '학년') { cols.grade = it.x; hasGrade = true; }
      if (it.s === '기' || it.s === '학기') cols.semester = it.x;
    }
  }
  return { cols, hasGrade };
}

async function extract(file) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const rows = [];
  const pagesWithRows = new Set();
  // 표 구조와 무관하게 PDF 어디든 학수번호 모양의 조각이 나온 쪽(코드 → 쪽 목록). 불일치 행이 추출기 누락인지 진짜 차이인지
  // 가르는 독립 근거로 쓴다(JSON에만 있는 코드가 PDF 어디에도 없으면 "초과" 의심, 어딘가 있으면 추출기가 놓쳤을 가능성).
  const codePages = {};
  let cols = {};
  let deptTitle = null; // 학과 소개 쪽 머리의 "학과명 Department of …" 줄에서 읽은 가장 최근 학과명(보고서에 붙일 뿐 비교에는 쓰지 않는다)
  let tableIndex = 0; // 머리글이 나올 때마다 새 표. 머리글 없는 이어진 쪽은 같은 표(학과 표는 첫 쪽에만 머리글이 있다).
  let majorTable = false; // 학년 열이 있는 표 = 학과 "전공과목 이수" 표. 교양 개설현황 표는 학년 열이 없어 false.
  // 학년/학기는 병합 셀이라 첫 행에만 나온다 — 쪽을 넘어 이어받는다.
  let grade = null;
  let semester = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const lines = await loadLines(page);
    for (const l of lines) for (const it of l.items) if (isCode(it.s)) (codePages[it.s] ||= []).push(p);
    for (const l of lines) {
      const [a, b] = l.items;
      if (a && b && a.x < 80 && /^[가-힣·()]+$/.test(a.s) && /^(Department|Division|School|College|Faculty|Major|Program)/.test(b.s)) deptTitle = a.s;
    }

    const pageRowLines = []; // { y, row } — 이름이 줄바꿈된 줄을 붙일 대상
    const handledLines = new Set();
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (isHeaderLine(line)) {
        handledLines.add(li);
        const h = readHeader(lines, li);
        cols = h.cols;
        majorTable = h.hasGrade;
        tableIndex++; // 학년/학기는 이어받는다(같은 학과 표가 머리글을 반복하며 다음 쪽으로 이어질 수 있고, 새 학과는 첫 행에 학년·학기 셀이 있다)
        continue;
      }
      const catX = cols.category ?? 103;
      const creditX = cols.credit ?? 249;
      // 구분 칸(catX) 위치의 이수구분 토큰. 학수번호가 바로 뒤에 오는 행이 대부분이지만, 학수번호가 없는 행(예: "영역별자유선택1")도
      // 있다 — 이 경우 학점 칸에 숫자가 있을 때만 행으로 본다(본문 줄을 행으로 오인하지 않기 위함).
      const nameLeft = catX + 40;
      let idx = line.items.findIndex((it, i) => CATEGORY_RE.test(it.s) && line.items[i + 1] && isCode(line.items[i + 1].s) && Math.abs(it.x - catX) < 5);
      let hasCode = idx !== -1;
      if (idx === -1) {
        idx = line.items.findIndex((it, i) => CATEGORY_RE.test(it.s) && Math.abs(it.x - catX) < 5 && line.items[i + 1] && line.items[i + 1].x >= nameLeft - 12
          && line.items.some((c) => (NUM_RE.test(c.s) || /^[PF]$/.test(c.s)) && Math.abs(c.x - creditX) < 12));
      }
      if (idx === -1) continue;

      // 구분 앞의 숫자 셀 = 학년/학기(병합 셀이 시작되는 행의 맨 앞에 있고, 학수번호가 없는 행에도 붙을 수 있다).
      const lead = line.items.slice(0, idx).filter((it) => NUM_RE.test(it.s));
      if (lead.length >= 2) { grade = Number(lead[0].s); semester = Number(lead[1].s); }
      else if (lead.length === 1) {
        const midGrade = ((cols.grade ?? 75) + (cols.semester ?? 89)) / 2;
        if (lead[0].x < midGrade) { grade = Number(lead[0].s); } else { semester = Number(lead[0].s); }
      }

      const categoryRaw = line.items[idx].s;
      const courseCode = hasCode ? line.items[idx + 1].s : '';
      const rest = line.items.slice(idx + (hasCode ? 2 : 1));
      // 과목명: 학점 열 왼쪽까지의 모든 조각(이름 중간의 숫자가 따로 떨어져 나오는 경우 포함).
      const nameParts = rest.filter((it) => it.x < creditX - 8).map((it) => it.s);
      const afterName = rest.filter((it) => it.x >= creditX - 8);
      // 학점은 학점 열(creditX) 근처의 숫자/P·F만 인정한다(영문 과목명 끝의 숫자 등을 학점으로 오인하지 않기 위함).
      const creditItem = afterName.find((it) => (NUM_RE.test(it.s) || /^[PF]$/.test(it.s)) && Math.abs(it.x - creditX) < 12);
      const hourItems = afterName.filter((it) => NUM_RE.test(it.s) && it.x > (creditItem ? creditItem.x : creditX) && it.x < creditX + 70);

      const row = {
        page: p,
        tableIndex,
        deptTitle,
        majorTable,
        grade,
        semester,
        categoryRaw,
        courseCode,
        courseName: nameParts.join(''),
        credits: creditItem ? creditItem.s : null,
        hours: hourItems.map((h) => h.s),
      };
      rows.push(row);
      pageRowLines.push({ y: line.y, row, nameParts: [{ y: line.y, s: nameParts.join('') }], creditX });
      handledLines.add(li);
      pagesWithRows.add(p);
    }

    // 셀이 세로 중앙정렬이라 긴 과목명은 학수번호 줄 위·아래 줄로 나뉘어 나온다(예: "식품품질관리실무실습" / "( 미생물 )").
    // 학년·구분·학수번호 칸이 비어 있고 이름 칸에만 글자가 있는 줄을 가장 가까운(≤14pt) 과목 행의 이름에 이어 붙인다.
    for (let li = 0; li < lines.length; li++) {
      if (handledLines.has(li) || pageRowLines.length === 0) continue;
      const line = lines[li];
      const catX = cols.category ?? 103;
      const creditX = cols.credit ?? 249;
      const nameLeft = catX + 40;
      if (line.items.some((it) => it.x < nameLeft - 12)) continue; // 왼쪽 칸에 글자가 있으면 본문/다른 표
      // (a) 학점·시간 숫자가 과목 행 아래/위 줄에 따로 찍히는 표(공학인증 학과 등): 학점 열의 숫자만 있는 줄을 가장 가까운 행에 붙인다.
      const creditOnly = line.items.every((it) => (NUM_RE.test(it.s) || /^[PF]$/.test(it.s)) && it.x >= creditX - 12);
      if (creditOnly && line.items.some((it) => Math.abs(it.x - creditX) < 12)) {
        let nearestRow = null;
        for (const r of pageRowLines) {
          const d = Math.abs(r.y - line.y);
          if (r.row.credits == null && d <= 14 && (!nearestRow || d < nearestRow.d)) nearestRow = { r, d };
        }
        if (nearestRow) {
          const c = line.items.find((it) => Math.abs(it.x - creditX) < 12);
          nearestRow.r.row.credits = c.s;
          nearestRow.r.row.hours = line.items.filter((it) => it !== c).map((it) => it.s);
        }
        continue;
      }
      const nameItems = line.items.filter((it) => it.x >= nameLeft - 12 && it.x < creditX - 8);
      // 한글이 하나도 없는 줄은 영문 과목명(영문명이 이름 칸 아래에 쌓이는 공학인증 학과 표 등)이므로 붙이지 않는다.
      // 닫는 괄호·숫자만 있는 줄("…(캡스톤디자인" 다음 줄의 ")")은 이름의 이어짐이다.
      const punctOnly = nameItems.length > 0 && nameItems.every((it) => /^[\d)\]\[(.,·\-/&]+$/.test(it.s));
      if (nameItems.length === 0 || !(punctOnly || nameItems.some((it) => /[가-힣]/.test(it.s)))) continue;
      let nearest = null;
      for (const r of pageRowLines) {
        const d = Math.abs(r.y - line.y);
        if (d <= 14 && (!nearest || d < nearest.d)) nearest = { r, d };
      }
      if (nearest) nearest.r.nameParts.push({ y: line.y, s: nameItems.map((it) => it.s).join('') });
    }
    for (const r of pageRowLines) {
      r.row.courseName = r.nameParts.sort((a, b) => b.y - a.y).map((n) => n.s).join('');
    }
  }
  return { file, numPages: doc.numPages, pagesWithRows: [...pagesWithRows].length, tables: tableIndex, codePages, rows };
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
if (!file) {
  console.error('사용법: node extractPdfCourseRows.mjs <pdf경로> [--out rows.json]');
  process.exit(2);
}
const result = await extract(file);
if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], JSON.stringify(result));
console.log(`${file}: ${result.numPages}쪽 중 과목 행이 있는 쪽 ${result.pagesWithRows}개, 표 ${result.tables}개, 행 ${result.rows.length}개`);
