const { PDFParse } = require('pdf-parse');
const { CATEGORY_MAP } = require('./categoryMap');

/**
 * server/services/pdfImportService.js
 * 원광대 인트라넷 "이수과목확인리스트" PDF(텍스트 레이어 보존, 브라우저 인쇄 저장 기준)를
 * 파싱해 과목명/학점/이수구분/이수학기만 추출한다. 성적(등급)은 이 문서 자체에 없으므로
 * (학점란에 '*' 표시만 F 여부를 나타냄, A+/B0 같은 등급 표기는 없음) 추출 대상에서 제외 —
 * 등급은 사용자가 과목 관리 화면에서 직접 입력한다.
 *
 * AI/OCR 없이 규칙 기반으로 처리한다: 이 문서는 브라우저가 렌더링한 표를 그대로 인쇄한
 * 텍스트 기반 PDF라 pdf-parse의 getText()가 컬럼을 탭으로 구분된 상태로 순서대로 뽑아준다.
 * 과목명이 길어 줄바꿈되는 경우에만 개행이 컬럼 경계 없이 이름 중간에 끼어드는데, 개행을
 * 전부 제거하고 통짜 텍스트로 만든 뒤 "구분코드 + 이름 + 학기(YYYY/N) + 학점" 패턴을
 * 정규식으로 찾으면 줄바꿈 위치와 무관하게 안정적으로 잡힌다 (이름 자체엔 절대 나타나지
 * 않는 "YYYY/N" 학기 표기가 자연스러운 앵커 역할을 한다).
 */

// 정규식에서 특수문자로 해석되는 문자가 코드에 없어 이스케이프 불필요(전부 완성형 한글).
const KNOWN_CODES = Object.keys(CATEGORY_MAP).sort((a, b) => b.length - a.length);
const CODE_ALT = KNOWN_CODES.join('|');

// 구분코드 + 이름 + 학기(YYYY/N) + 학점(선택적 '*' = F) — 이름 뒤 나머지 컬럼(영역/개설학과/비고)은
// 졸업요건 계산에 안 쓰여 캡처하지 않고 버린다.
const ROW_RE = new RegExp(`(${CODE_ALT})[\\t ]+([\\s\\S]+?)[\\t ]*(\\d{4})\\/([12])[\\t ]*(\\*?\\d+(?:\\.\\d+)?\\*?)`, 'g');

// "총 취득학점  101.0" — 최종 검산용 앵커.
const TOTAL_CREDITS_RE = /총\s*취득학점[\t ]*(\d+(?:\.\d+)?)/;

// "일선 취득학점  27.0"처럼 구간 소계 라벨이 구분코드로 시작하는 경우, 그 코드가 ROW_RE의
// 행 시작 앵커로 오인식되어 바로 뒤 무관한 텍스트(다음 섹션 헤더 등)를 이름으로, 그 뒤 첫
// 학기 표기를 자기 학기로 잘못 캡처하는 오탐이 생긴다 — 소계/합계 라벨은 행 인식 전에
// 전부 지운다. declaredTotalCredits는 지우기 전에 먼저 뽑아둔다.
const SUBTOTAL_LABEL_RE = new RegExp(
  `(?:${CODE_ALT}|성적|교양|전공|상담\\s*및\\s*미분류|총)\\s*취득학점[\\t ]*\\d+(?:\\.\\d+)?`,
  'g'
);

// 문서 맨 위 "이수과목확인내역" 요약 그리드(교양/전공/총계별로 이 앱이 모르는 코드까지
// 포함한 모든 구분 코드를 다단 헤더로 나열하고 그 아래 취득학점 숫자들을 나열하는 표)는
// 표를 텍스트로 뽑으면 코드들이 전부 붙어서 나온 뒤 숫자들이 붙어서 나오는 형태가 되어
// ROW_RE의 행 시작 앵커로 오인식된다(실사용 PDF로 확인 — 진짜 첫 과목까지 통째로
// 삼켜버려 100자 넘는 이름으로 등록 실패). 실제 표는 이 요약 그리드 바로 뒤에 오는 첫
// "구분 교과목명 년도/학기 학점 ... 비고" 헤더부터 시작하므로, 그 헤더가 처음 나오는
// 지점까지(요약 그리드 전체 + 문서 상단 학생정보)를 통째로 잘라낸다. 이후 섹션(전공/일선/
// 상담 및 미분류)마다 같은 헤더가 반복되지만 그건 실제 행들 사이에 끼는 것뿐이라 문제없다.
const SUMMARY_HEADER_RE = /구분[\t ]*교과목명[\t ]*년도\s*\/\s*학기[\t ]*학점[\t ]*(?:영역|개설학과\(전공\))[\t ]*비[\t ]*고/;

function parseCourseListText(rawText) {
  // 줄바꿈만 제거하고(이름 중간 개행 붕괴 목적) 그 외 탭/공백은 그대로 둔다 — ROW_RE가
  // 탭이든 공백이든 구분자로 받아들이므로 정보 손실 없이 매칭 가능.
  const withoutNewlines = rawText.replace(/\r/g, '').replace(/\n/g, '');
  const totalMatch = withoutNewlines.match(TOTAL_CREDITS_RE);
  let blob = withoutNewlines.replace(SUBTOTAL_LABEL_RE, ' ');

  const firstHeader = blob.match(SUMMARY_HEADER_RE);
  if (firstHeader) {
    blob = blob.slice(firstHeader.index + firstHeader[0].length);
  }

  const rows = [];
  let droppedSummaryRows = 0;
  let match;
  ROW_RE.lastIndex = 0;
  while ((match = ROW_RE.exec(blob)) !== null) {
    const [, rawCategory, rawName, year, semester, rawCredits] = match;

    const isFail = rawCredits.includes('*');
    const credits = Number(rawCredits.replace(/\*/g, ''));
    const name = rawName.replace(/\s+/g, ' ').trim();

    if (!name || Number.isNaN(credits)) continue;

    // 문서 상단 "구분별 이수현황" 요약 표(구분 코드들이 붙어서 나온 뒤 학점 숫자들이 붙어서
    // 나오는 그리드)와 실제 표 헤더("교과목명" 등)가 통째로 과목명으로 잘못 인식되는 경우가
    // 있다(모바일에서 저장한 PDF에서 실사용 확인 — student_courses.name VARCHAR(100)을
    // 넘겨 등록 자체가 실패했었음). 정상 과목명에는 나올 수 없는 표 헤더/합계 문구가
    // 섞여 있으면 통째로 버린다 — 그 자리에 있던 진짜 과목은 사용자가 직접 추가해야 한다.
    if (name.length > 50 || name.includes('교과목명') || name.includes('합계')) {
      droppedSummaryRows += 1;
      continue;
    }

    rows.push({
      rawCategory,
      category: CATEGORY_MAP[rawCategory] || null,
      name,
      year: Number(year),
      semester: Number(semester),
      credits,
      isFail,
    });
  }

  const declaredTotalCredits = totalMatch ? Number(totalMatch[1]) : null;
  const extractedTotalCredits = rows.filter((r) => !r.isFail).reduce((sum, r) => sum + r.credits, 0);

  const warnings = [];
  if (rows.length === 0) {
    warnings.push('과목을 하나도 못 찾았어요. 원광대 인트라넷 "이수과목확인리스트"를 PDF로 저장한 파일이 맞는지 확인해주세요.');
  }
  if (droppedSummaryRows > 0) {
    warnings.push(
      `문서 상단 요약 표가 과목으로 잘못 인식돼서 ${droppedSummaryRows}건 뺐어요. 바로 다음 과목이 함께 인식되지 못했을 수 있으니 목록을 확인하고, 빠진 과목이 있으면 "직접 입력"으로 추가해주세요.`
    );
  }
  if (declaredTotalCredits !== null && Math.abs(declaredTotalCredits - extractedTotalCredits) > 0.01) {
    warnings.push(
      `문서상 총 취득학점(${declaredTotalCredits})과 인식된 학점 합계(${extractedTotalCredits})가 달라요. 아래 목록을 원본과 대조해서 확인해주세요.`
    );
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

/**
 * "전체성적조회" 문서(#102) 파싱.
 * "이수과목확인리스트"와 달리 학기별 섹션("YYYY 년 N 학기")으로 나뉘고, 각 행이
 * 이수구분/학수번호/교과목명/학점/평점/등급(A+/B0/P 등)을 탭으로 구분해 한 줄에 담는다
 * (실제 PDF로 확인 — 과목명이 길어도 줄바꿈 없이 한 줄에 들어가 이수과목확인리스트 같은
 * 개행 처리 이슈가 없다). 페이지 전환 시 브라우저 인쇄 푸터("2026. 1. 1. 오전 0:00 ::
 * Wonkwang University :: / https://intra.wku.ac.kr/... / 1/3")가 학기 섹션 중간에
 * 끼어드는데, 행 인식이 구분코드(CODE_ALT) 앵커로 시작하므로 이 텍스트는 애초에
 * 매칭 대상이 아니라 별도 제거 없이 자연히 걸러진다.
 *
 * 문서 상단 학생 개인정보(성명/학번/학과)와 학기별 소계("취득학점"/"평균평점") 행도
 * 같은 이유로 CODE_ALT로 시작하지 않아 매칭되지 않는다 — 절대 추출 대상에 포함하지 않는다.
 */
// P(Pass)/NP(Not Pass)는 P/F 채점 과목(원어민영어인증, 오리엔테이션성 교양 등)에서만
// 나오는 값 — 일반 9등급(A+~F)과 달리 평점 자체가 없는 채점 방식이다.
const GRADE_ALT = 'A\\+|A0|B\\+|B0|C\\+|C0|D\\+|D0|F|P|NP';

// 구분코드 + 학수번호 + 교과목명 + 학점 + 평점 + 등급. 학수번호는 숫자 또는 "L00375"처럼
// 영문+숫자 조합이 온다.
const FULL_TRANSCRIPT_ROW_RE = new RegExp(
  `(${CODE_ALT})[\\t ]+([A-Za-z0-9]+)[\\t ]+([\\s\\S]+?)[\\t ]+(\\d+(?:\\.\\d+)?)[\\t ]+(\\d+(?:\\.\\d+)?)[\\t ]+(${GRADE_ALT})(?=[\\t \\n]|$)`,
  'g'
);

const SEMESTER_HEADER_RE = /(\d{4})\s*년\s*([12])\s*학기/g;

// 문서 맨 앞의 실제 제목 텍스트("전체성적조회\t전체성적조회\n" — 실사용 PDF로 확인)로
// 판별한다. 이 패턴에 안 걸리면 기존 이수과목확인리스트 경로로 그대로 처리해 회귀를 막는다.
const FULL_TRANSCRIPT_TITLE_RE = /^전체성적조회/;

function detectDocumentType(rawText) {
  return FULL_TRANSCRIPT_TITLE_RE.test(rawText.trim()) ? 'full_transcript' : 'course_list';
}

function parseFullTranscriptText(rawText) {
  const text = rawText.replace(/\r/g, '');

  const semesterBoundaries = [];
  const semRe = new RegExp(SEMESTER_HEADER_RE.source, 'g');
  let semMatch;
  while ((semMatch = semRe.exec(text)) !== null) {
    semesterBoundaries.push({ index: semMatch.index, year: Number(semMatch[1]), semester: Number(semMatch[2]) });
  }

  // 학기 헤더 뒤에 나오는 행은 다음 헤더가 나오기 전까지 그 학기 소속이다.
  function semesterAt(idx) {
    let current = null;
    for (const b of semesterBoundaries) {
      if (b.index > idx) break;
      current = b;
    }
    return current;
  }

  const rows = [];
  let droppedRows = 0;
  const rowRe = new RegExp(FULL_TRANSCRIPT_ROW_RE.source, 'g');
  let match;
  while ((match = rowRe.exec(text)) !== null) {
    const [, rawCategory, , rawName, rawCredits, , letterGrade] = match;
    const sem = semesterAt(match.index);
    if (!sem) continue;

    const name = rawName.replace(/\s+/g, ' ').trim();
    const credits = Number(rawCredits);
    if (!name || Number.isNaN(credits)) continue;

    if (name.length > 50 || name.includes('교과목명')) {
      droppedRows += 1;
      continue;
    }

    rows.push({
      rawCategory,
      category: CATEGORY_MAP[rawCategory] || null,
      name,
      year: sem.year,
      semester: sem.semester,
      credits,
      isFail: letterGrade === 'F' || letterGrade === 'NP',
      letterGrade,
    });
  }

  const warnings = [];
  if (rows.length === 0) {
    warnings.push('과목을 하나도 못 찾았어요. 원광대 인트라넷 "전체성적조회"를 PDF로 저장한 파일이 맞는지 확인해주세요.');
  }
  if (droppedRows > 0) {
    warnings.push(
      `일부 행을 과목으로 잘못 인식해서 ${droppedRows}건 뺐어요. 목록을 확인하고 빠진 과목이 있으면 "직접 입력"으로 추가해주세요.`
    );
  }
  const unmapped = rows.filter((r) => !r.category);
  if (unmapped.length > 0) {
    warnings.push(`이수구분을 자동으로 판별하지 못한 과목 ${unmapped.length}건이 있습니다. 직접 선택해주세요.`);
  }

  return { rows, warnings };
}

async function parseCourseListPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const rawText = result.text;
    const docType = detectDocumentType(rawText);

    if (docType === 'full_transcript') {
      const { rows, warnings } = parseFullTranscriptText(rawText);
      return {
        docType,
        rows,
        declaredTotalCredits: null,
        extractedTotalCredits: null,
        warnings,
      };
    }

    const courseListResult = parseCourseListText(rawText);
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
