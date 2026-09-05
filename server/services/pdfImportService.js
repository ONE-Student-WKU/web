const { PDFParse } = require('pdf-parse');
const { CATEGORY_MAP } = require('./categoryMap');
const { extractCourseListRows, extractFullTranscriptRows } = require('./aiClient');

/**
 * server/services/pdfImportService.js
 * 원광대 인트라넷 "이수과목확인리스트"/"전체성적조회" PDF(텍스트 레이어 보존, 브라우저
 * 인쇄 저장 기준)를 파싱해 과목명/학점/이수구분/이수학기(+등급)를 추출한다.
 *
 * 과목 행 추출은 Claude(aiClient.js)에게 맡긴다 — 기기/브라우저마다 인쇄 시 표 레이아웃
 * 간격이 미묘하게 달라져(모바일에서 특히 심함, 실사용 확인) 위치·간격 기반 정규식이
 * 기기가 바뀔 때마다 계속 깨졌던 문제를 근본적으로 줄이기 위함이다. 대신 문서 자체에
 * 이미 찍혀 있는 소계 숫자(이수과목확인리스트는 구분코드별 취득학점, 전체성적조회는
 * 학기별 취득학점)와 AI 추출 결과를 대조해, AI가 놓치거나 잘못 읽은 경우를 경고로
 * 알려준다 — "파싱을 완벽하게 만들기"가 아니라 "틀렸을 때 사용자가 알아챌 수 있게
 * 만들기"가 목표. 최종 확정은 사용자가 미리보기 화면에서 검토 후 눌러야 하므로, 이
 * 대조는 그 검토를 도와주는 보조 신호다.
 */

const KNOWN_CODES = Object.keys(CATEGORY_MAP).sort((a, b) => b.length - a.length);
const CODE_ALT = KNOWN_CODES.join('|');

// student_courses.name은 VARCHAR(100) — AI가 표 헤더나 요약 문구를 과목명으로 잘못 끼워
// 넣는 극단적인 경우를 대비한 방어선(정규식 시절 실사용에서 반복 확인된 문제).
const MAX_NAME_LENGTH = 50;

// ── 이수과목확인리스트 ──────────────────────────────────────────────

// "총 취득학점  101.0" — 최종 검산용 앵커.
const TOTAL_CREDITS_RE = /총\s*취득학점[\t ]*(\d+(?:\.\d+)?)/;

// 구분코드별 소계는 "교필취득학점"처럼 코드가 라벨에 붙는 게 아니라, 같은 구분코드가
// 연속된 구간마다 고정 문구 "성적취득학점 N"이 반복해서 나온다(실제 PDF로 확인 — 예:
// 교필 2과목 뒤 "성적취득학점 5.0", 그다음 교선 여러 과목 뒤 "성적취득학점 27.0").
// 라벨 자체엔 코드가 없으니 "그 소계 바로 앞에 마지막으로 나온 구분코드가 뭐였는지"를
// 위치로 대응시켜야 한다 — extractGroupSubtotals가 이 역할을 한다.
// "교양"/"전공"/"상담및미분류" 같은 상위 그룹 합계는 정확히 어떤 코드들의 합인지 문서
// 구조를 더 깊이 가정해야 해서(잘못 짐작하면 없는 오류를 만들어낼 위험) 대조에서 제외.
const ROW_CODE_ANCHOR_RE = new RegExp(
  `(${CODE_ALT})[\\t ]+[\\s\\S]+?[\\t ]*\\d{4}\\/[12][\\t ]*\\*?\\d+(?:\\.\\d+)?\\*?`,
  'g'
);
const GROUP_SUBTOTAL_RE = /성적취득학점[\t ]*(\d+(?:\.\d+)?)/g;
// "상담 및 미분류" 구간(예: 자기계발심층상담)은 구분코드가 아예 비어있는 행들이라, 이
// 구간에 들어서면 직전 구분코드에 소계가 잘못 합쳐지지 않도록 대응을 초기화한다.
const UNCATEGORIZED_SECTION_RE = /상담\s*및\s*미분류/g;

function extractGroupSubtotals(text) {
  const markers = [];

  const rowRe = new RegExp(ROW_CODE_ANCHOR_RE.source, 'g');
  let m;
  while ((m = rowRe.exec(text)) !== null) markers.push({ index: m.index, type: 'row', code: m[1] });

  const subtotalRe = new RegExp(GROUP_SUBTOTAL_RE.source, 'g');
  while ((m = subtotalRe.exec(text)) !== null) markers.push({ index: m.index, type: 'subtotal', value: Number(m[1]) });

  const resetRe = new RegExp(UNCATEGORIZED_SECTION_RE.source, 'g');
  while ((m = resetRe.exec(text)) !== null) markers.push({ index: m.index, type: 'reset' });

  markers.sort((a, b) => a.index - b.index);

  const declared = new Map();
  let lastCode = null;
  for (const marker of markers) {
    if (marker.type === 'row') lastCode = marker.code;
    else if (marker.type === 'reset') lastCode = null;
    else if (marker.type === 'subtotal' && lastCode) declared.set(lastCode, marker.value);
  }
  return declared;
}

// 소계/합계 라벨이 구분코드로 시작해서 AI에게 과목 행처럼 보일 수 있으니, 위 두 값을
// 먼저 뽑아둔 뒤 본문에서는 전부 지운다(코드값 뒤에 오는 숫자만 있는 짧은 줄이라
// 실제 과목 행 — 코드+이름+연도/학기+학점 4요소 — 과는 형태가 뚜렷이 달라 안전하게 구분됨).
const SUBTOTAL_LABEL_RE = new RegExp(
  `(?:${CODE_ALT}|성적|교양|전공|상담\\s*및\\s*미분류|총)\\s*취득학점[\\t ]*\\d+(?:\\.\\d+)?`,
  'g'
);

// 문서 맨 위 "이수과목확인내역" 요약 그리드 — 표를 텍스트로 뽑으면 구분 코드들이 붙어서
// 나온 뒤 숫자들이 붙어서 나오는 형태가 되어 AI에게도 혼란을 줄 수 있어 미리 잘라낸다.
// 실제 표는 이 헤더 바로 뒤부터 시작한다.
const SUMMARY_HEADER_RE = /구분[\t ]*교과목명[\t ]*년도\s*\/\s*학기[\t ]*학점[\t ]*(?:영역|개설학과\(전공\))[\t ]*비[\t ]*고/;

async function parseCourseListText(rawText) {
  // 줄바꿈만 제거(이름 중간 개행 붕괴 방지 목적) — 모바일 인쇄본에서 과목명이 길어
  // 줄바꿈되면 AI에게도 한 과목이 두 줄로 쪼개져 보일 수 있어 이 전처리는 방식과
  // 무관하게 여전히 유효하다.
  const withoutNewlines = rawText.replace(/\r/g, '').replace(/\n/g, '');
  const totalMatch = withoutNewlines.match(TOTAL_CREDITS_RE);
  const codeSubtotals = extractGroupSubtotals(withoutNewlines);

  let blob = withoutNewlines.replace(SUBTOTAL_LABEL_RE, ' ');
  const firstHeader = blob.match(SUMMARY_HEADER_RE);
  if (firstHeader) {
    blob = blob.slice(firstHeader.index + firstHeader[0].length);
  }

  const warnings = [];
  let extracted = [];
  try {
    extracted = await extractCourseListRows(blob);
  } catch (err) {
    warnings.push('과목을 인식하는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
  }

  const rows = [];
  let droppedRows = 0;
  for (const item of extracted) {
    const rawCategory = item.rawCategory;
    const name = String(item.name || '').replace(/\s+/g, ' ').trim();
    const credits = Number(item.credits);
    if (!name || Number.isNaN(credits) || !item.year || !item.semester) continue;

    if (name.length > MAX_NAME_LENGTH) {
      droppedRows += 1;
      continue;
    }

    rows.push({
      rawCategory,
      category: CATEGORY_MAP[rawCategory] || null,
      name,
      year: Number(item.year),
      semester: Number(item.semester),
      credits,
      isFail: Boolean(item.isFail),
    });
  }

  const declaredTotalCredits = totalMatch ? Number(totalMatch[1]) : null;
  const extractedTotalCredits = rows.filter((r) => !r.isFail).reduce((sum, r) => sum + r.credits, 0);

  if (rows.length === 0) {
    warnings.push('과목을 하나도 못 찾았어요. 원광대 인트라넷 "이수과목확인리스트"를 PDF로 저장한 파일이 맞는지 확인해주세요.');
  }
  if (droppedRows > 0) {
    warnings.push(
      `일부 행을 과목으로 잘못 인식해서 ${droppedRows}건 뺐어요. 목록을 확인하고 빠진 과목이 있으면 "직접 입력"으로 추가해주세요.`
    );
  }
  if (declaredTotalCredits !== null && Math.abs(declaredTotalCredits - extractedTotalCredits) > 0.01) {
    warnings.push(
      `문서상 총 취득학점은 ${declaredTotalCredits}학점인데 리스트에는 ${extractedTotalCredits}학점이 있어요. 아래 목록을 원본과 대조해서 확인해주세요.`
    );
  }

  // 구분코드별 소계 대조 — 총합은 맞아도 특정 이수구분에서만 과목이 빠지거나 다른
  // 구분으로 잘못 인식된 경우(카테고리 오분류)를 잡아낸다. 총 취득학점 검증만으로는
  // 놓치는 케이스라 별도로 필요하다.
  for (const [code, declaredValue] of codeSubtotals) {
    const extractedValue = rows
      .filter((r) => r.rawCategory === code && !r.isFail)
      .reduce((sum, r) => sum + r.credits, 0);
    if (Math.abs(declaredValue - extractedValue) > 0.01) {
      warnings.push(
        `"${code}" 이수구분은 ${declaredValue}학점인데 리스트에는 ${extractedValue}학점이 있어요. 해당 구분 과목을 원본과 대조해서 확인해주세요.`
      );
    }
  }

  const unmapped = rows.filter((r) => !r.category);
  if (unmapped.length > 0) {
    warnings.push(`이수구분을 자동으로 판별하지 못한 과목 ${unmapped.length}건이 있습니다. 직접 선택해주세요.`);
  }

  return {
    rows,
    declaredTotalCredits,
    extractedTotalCredits,
    warnings,
  };
}

// ── 전체성적조회 ────────────────────────────────────────────────────

const SEMESTER_HEADER_RE = /(\d{4})\s*년\s*([12])\s*학기/g;

// 학기 소계("취득학점 평균평점" 다음 줄에 숫자 두 개, 예: "17.00 4.30") — 학기별 대조용.
// 이 문서엔 전체 합계 표기가 따로 없어(학기 소계만 있음, 실제 PDF로 확인) 총합 대조
// 대신 학기 단위로 대조한다 — 오히려 어느 학기에서 틀렸는지까지 짚어줄 수 있어 더 유용함.
const SEMESTER_SUBTOTAL_RE = /취득학점[\t\n ]*평균평점[\t\n ]*(\d+(?:\.\d+)?)[\t ]*(\d+(?:\.\d+)?)/g;

// 문서 맨 앞의 실제 제목 텍스트("전체성적조회\t전체성적조회\n" — 실사용 PDF로 확인)로
// 판별한다. 이 패턴에 안 걸리면 기존 이수과목확인리스트 경로로 그대로 처리해 회귀를 막는다.
const FULL_TRANSCRIPT_TITLE_RE = /^전체성적조회/;

function detectDocumentType(rawText) {
  return FULL_TRANSCRIPT_TITLE_RE.test(rawText.trim()) ? 'full_transcript' : 'course_list';
}

async function parseFullTranscriptText(rawText) {
  const text = rawText.replace(/\r/g, '');

  const semesterBoundaries = [];
  const semRe = new RegExp(SEMESTER_HEADER_RE.source, 'g');
  let semMatch;
  while ((semMatch = semRe.exec(text)) !== null) {
    semesterBoundaries.push({ index: semMatch.index, year: Number(semMatch[1]), semester: Number(semMatch[2]) });
  }

  // 학기 헤더 뒤에 나오는 위치는 다음 헤더가 나오기 전까지 그 학기 소속이다 — 학기
  // 소계도 같은 방식으로 가장 가까운 앞쪽 학기 헤더에 붙인다.
  function semesterAt(idx) {
    let current = null;
    for (const b of semesterBoundaries) {
      if (b.index > idx) break;
      current = b;
    }
    return current;
  }

  const declaredBySemester = new Map();
  const subtotalRe = new RegExp(SEMESTER_SUBTOTAL_RE.source, 'g');
  let subtotalMatch;
  while ((subtotalMatch = subtotalRe.exec(text)) !== null) {
    const sem = semesterAt(subtotalMatch.index);
    if (!sem) continue;
    declaredBySemester.set(`${sem.year}-${sem.semester}`, Number(subtotalMatch[1]));
  }

  const warnings = [];
  let extracted = [];
  try {
    extracted = await extractFullTranscriptRows(text);
  } catch (err) {
    warnings.push('과목을 인식하는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
  }

  const rows = [];
  let droppedRows = 0;
  for (const item of extracted) {
    const rawCategory = item.rawCategory;
    const name = String(item.name || '').replace(/\s+/g, ' ').trim();
    const credits = Number(item.credits);
    const letterGrade = item.letterGrade || null;
    if (!name || Number.isNaN(credits) || !item.year || !item.semester) continue;

    if (name.length > MAX_NAME_LENGTH) {
      droppedRows += 1;
      continue;
    }

    rows.push({
      rawCategory,
      category: CATEGORY_MAP[rawCategory] || null,
      name,
      year: Number(item.year),
      semester: Number(item.semester),
      credits,
      isFail: letterGrade === 'F' || letterGrade === 'NP',
      letterGrade,
    });
  }

  if (rows.length === 0) {
    warnings.push('과목을 하나도 못 찾았어요. 원광대 인트라넷 "전체성적조회"를 PDF로 저장한 파일이 맞는지 확인해주세요.');
  }
  if (droppedRows > 0) {
    warnings.push(
      `일부 행을 과목으로 잘못 인식해서 ${droppedRows}건 뺐어요. 목록을 확인하고 빠진 과목이 있으면 "직접 입력"으로 추가해주세요.`
    );
  }

  // 학기별 소계 대조 — 특정 학기에서 과목이 빠지거나 중복 인식된 경우를 그 학기까지
  // 짚어서 잡아낸다. 카테고리(이수구분) 오분류는 같은 학기 안에서는 학점 합계가 안
  // 바뀌므로 이 대조로는 못 잡는다 — 이수구분 코드가 2글자 그대로 옮기는 작업이라
  // 다른 필드보다 오류 가능성이 낮다고 보고, 최종적으로는 사용자 검토 단계(미리보기
  // 화면)가 이 부분의 마지막 안전망 역할을 한다.
  for (const [key, declaredValue] of declaredBySemester) {
    const extractedValue = rows
      .filter((r) => `${r.year}-${r.semester}` === key && !r.isFail)
      .reduce((sum, r) => sum + r.credits, 0);
    if (Math.abs(declaredValue - extractedValue) > 0.01) {
      const [year, semester] = key.split('-');
      warnings.push(
        `${year}년 ${semester}학기에서 취득학점은 ${declaredValue}학점인데 리스트에는 ${extractedValue}학점이 있어요. 해당 학기 과목을 원본과 대조해서 확인해주세요.`
      );
    }
  }

  const extractedTotalCredits = rows.filter((r) => !r.isFail).reduce((sum, r) => sum + r.credits, 0);

  const unmapped = rows.filter((r) => !r.category);
  if (unmapped.length > 0) {
    warnings.push(`이수구분을 자동으로 판별하지 못한 과목 ${unmapped.length}건이 있습니다. 직접 선택해주세요.`);
  }

  return { rows, extractedTotalCredits, warnings };
}

async function parseCourseListPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const rawText = result.text;
    const docType = detectDocumentType(rawText);

    if (docType === 'full_transcript') {
      const { rows, warnings } = await parseFullTranscriptText(rawText);
      return {
        docType,
        rows,
        declaredTotalCredits: null,
        extractedTotalCredits: null,
        warnings,
      };
    }

    const courseListResult = await parseCourseListText(rawText);
    return {
      docType,
      ...courseListResult,
      rows: courseListResult.rows.map((r) => ({ ...r, letterGrade: null })),
    };
  } finally {
    await parser.destroy();
  }
}

module.exports = { parseCourseListPdf, parseCourseListText, parseFullTranscriptText, detectDocumentType };
