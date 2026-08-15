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

function parseCourseListText(rawText) {
  // 줄바꿈만 제거하고(이름 중간 개행 붕괴 목적) 그 외 탭/공백은 그대로 둔다 — ROW_RE가
  // 탭이든 공백이든 구분자로 받아들이므로 정보 손실 없이 매칭 가능.
  const withoutNewlines = rawText.replace(/\r/g, '').replace(/\n/g, '');
  const totalMatch = withoutNewlines.match(TOTAL_CREDITS_RE);
  const blob = withoutNewlines.replace(SUBTOTAL_LABEL_RE, ' ');

  const rows = [];
  let match;
  ROW_RE.lastIndex = 0;
  while ((match = ROW_RE.exec(blob)) !== null) {
    const [, rawCategory, rawName, year, semester, rawCredits] = match;

    const isFail = rawCredits.includes('*');
    const credits = Number(rawCredits.replace(/\*/g, ''));
    const name = rawName.replace(/\s+/g, ' ').trim();

    if (!name || Number.isNaN(credits)) continue;

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
    warnings.push('과목 행을 하나도 인식하지 못했습니다. 문서 형식이 예상과 다를 수 있습니다.');
  }
  if (declaredTotalCredits !== null && Math.abs(declaredTotalCredits - extractedTotalCredits) > 0.01) {
    warnings.push(
      `문서상 총 취득학점(${declaredTotalCredits})과 인식된 학점 합계(${extractedTotalCredits})가 일치하지 않습니다. 아래 목록을 원본과 대조해 확인해주세요.`
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

async function parseCourseListPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return parseCourseListText(result.text);
  } finally {
    await parser.destroy();
  }
}

module.exports = { parseCourseListPdf, parseCourseListText };
