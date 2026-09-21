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
// 이 [12]는 우리 앱 내부 semester 코드가 아니라 원광대 문서 자체에 인쇄된 "YYYY/N" 표기의
// N을 그대로 가리킨다(문서 원문을 정규식으로 스캔하는 단계라 우리 DB 값 체계와 무관함).
// 계절학기 지원(2026-09) 도입 시점에 실물 계절학기 PDF 샘플이 아직 없어 원광대가 계절학기
// 행을 "YYYY/N"에 어떤 숫자(혹은 "하계"/"여름" 같은 비숫자 표기)로 찍는지 확인이 안 됨 —
// 그래서 숫자라면 몇이든 넓게 잡아두는 정도로만 방어적으로 대응한다. 실제로 비숫자 표기라면
// 이 앵커가 계절학기 행을 못 잡아 소계 대조 없이 넘어갈 뿐, 이 대조 자체가 "틀렸을 때
// 알려주는 보조 신호"일 뿐이라(파일 상단 주석 참고) import 자체가 깨지진 않는다. 실물 PDF를
// 확보하면 실제 표기에 맞게 이 정규식을 다듬을 것.
const ROW_CODE_ANCHOR_RE = new RegExp(
  `(${CODE_ALT})[\\t ]+[\\s\\S]+?[\\t ]*\\d{4}\\/[1-9][\\t ]*\\*?\\d+(?:\\.\\d+)?\\*?`,
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

// 위 정규식이 캡처하는 건 원광대 문서에 찍힌 학기 숫자(1/2)이지, 우리 내부 semester 코드가
// 아니다. aiClient.js의 FULL_TRANSCRIPT_EXTRACT_SYSTEM_PROMPT가 이미 AI 추출 결과의 semester를
// 학사력 시간순 내부 코드(1=1학기, 3=2학기)로 바꿔서 내놓으므로, 아래 학기 소계 대조가 그
// 값과 같은 체계로 비교되려면 여기서도 반드시 같은 변환을 거쳐야 한다 — 안 그러면 원문 "2학기"
// 헤더는 키 "2024-2"로, AI가 낸 같은 학기 과목은 "2024-3"으로 남아 서로 다른 키 취급되어
// 대조가 전부 어긋난다. 계절학기 섹션 헤더가 실제로 이 "YYYY 년 N 학기" 패턴을 따르는지,
// 따른다면 N이 몇으로 찍히는지 확인된 바 없어([12]로 제한해둔 이유) 여기서는 정규학기만
// 다룬다 — 계절학기 소계 대조는 실물 PDF 확보 후 다듬을 것(못 잡아도 import 자체는 정상 동작).
const RAW_SEMESTER_TO_CODE = { 1: 1, 2: 3 };
const SEMESTER_DISPLAY_LABELS = { 1: '1학기', 2: '여름 계절학기', 3: '2학기', 4: '겨울 계절학기' };

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

// iOS에서 "전체성적조회"를 PDF로 저장하면(실사용 확인, 2026-09) 브라우저가 그 페이지를 PDF로
// 인코딩하는 과정에서 한글 글자만 통째로 텍스트 레이어에서 빠지는 경우가 있다(영어/숫자/기호는
// 멀쩡히 남음 — 예: 제목 "전체성적조회", "년"/"학기", 이수구분 코드, 과목명의 한글 부분이 전부
// 사라지고 "iOS", "AI", "Java" 같은 과목명 속 영단어 조각만 남는 패턴으로 확인됨). 이 경우
// 이수구분·과목명 데이터 자체가 파일 안에 없어 정규식/AI 어느 쪽으로도 복구가 불가능하므로,
// 파싱을 시도하는 대신 원인과 해결책을 바로 안내한다. 정상 문서라면 제목만으로도 한글이 여러
// 글자 있어야 하니 "전혀 없음"은 이 문제의 안전한 신호다.
const HANGUL_RE = /[가-힣]/;

function hasNoHangulText(rawText) {
  return !HANGUL_RE.test(rawText);
}

// "첫 학기 헤더 이전 잘라내기"(아래 contentForAi)는 학생정보 블록이 표보다 위에 있다는
// 위치 가정에 의존한다 — PDF 인쇄본은 이게 항상 성립함을 확인했지만(iOS 디버그로도 재확인),
// 사용자가 "복사해서 붙여넣기"를 쓸 때는 원문 그대로 페이지 전체(네비게이션 포함)를 선택해
// 붙여넣을 수도 있어 위치를 더는 보장할 수 없다. 위치에 기대지 않고, 어디에 있든 학번/이름
// 패턴이면 가리는 마지막 방어선이 필요하다. 학수번호(예: 003308, L00316)는 6자 이하라
// 7자리 이상 연속 숫자만 가리는 이 기준에 걸리지 않는다(실사용 PDF로 학번 8자리 확인).
const STUDENT_ID_RE = /\d{7,}/g;
const STUDENT_NAME_RE = /((?:성명|이름)[\t ]*)[가-힣]{2,4}/g;

function redactStudentIdentifiers(text) {
  return text.replace(STUDENT_ID_RE, (m) => 'X'.repeat(m.length)).replace(STUDENT_NAME_RE, '$1XXX');
}

// 학기 헤더/소계 위치를 한 번만 스캔해 parseFullTranscriptText(AI 경로)와
// parseFullTranscriptTextRuleBased(규칙 기반 경로) 둘 다에서 같은 방식으로 쓴다 — 두 경로가
// "몇 학점이 맞는 답인지" 서로 다른 기준으로 대조하면 안 되므로 이 계산 자체를 공유한다.
function computeSemesterSubtotals(text) {
  const semesterBoundaries = [];
  const semRe = new RegExp(SEMESTER_HEADER_RE.source, 'g');
  let semMatch;
  while ((semMatch = semRe.exec(text)) !== null) {
    const code = RAW_SEMESTER_TO_CODE[Number(semMatch[2])];
    if (!code) continue; // [12]로 제한된 캡처라 항상 존재하지만 방어적으로.
    semesterBoundaries.push({ index: semMatch.index, year: Number(semMatch[1]), semester: code });
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

  return { semesterBoundaries, declaredBySemester };
}

// AI(또는 규칙 기반)가 뽑아낸 항목 배열을 rows/warnings로 다듬는 마무리 단계 — 이름 정리,
// MAX_NAME_LENGTH 방어, 학기별 소계 대조, 이수구분 매핑까지 두 파싱 경로가 완전히 동일한
// 기준으로 검증받게 한다. leadingWarnings는 이 단계 이전에 이미 발생한 경고(예: AI 호출
// 자체가 실패한 경우)를 맨 앞에 끼워 넣기 위한 것.
function finalizeFullTranscriptRows(extracted, declaredBySemester, leadingWarnings = []) {
  const warnings = [...leadingWarnings];
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
  let hasSubtotalMismatch = false;
  for (const [key, declaredValue] of declaredBySemester) {
    const extractedValue = rows
      .filter((r) => `${r.year}-${r.semester}` === key && !r.isFail)
      .reduce((sum, r) => sum + r.credits, 0);
    if (Math.abs(declaredValue - extractedValue) > 0.01) {
      hasSubtotalMismatch = true;
      const [year, semesterCode] = key.split('-');
      const semesterLabel = SEMESTER_DISPLAY_LABELS[Number(semesterCode)] || `${semesterCode}학기`;
      warnings.push(
        `${year}년 ${semesterLabel}에서 취득학점은 ${declaredValue}학점인데 리스트에는 ${extractedValue}학점이 있어요. 해당 학기 과목을 원본과 대조해서 확인해주세요.`
      );
    }
  }

  const extractedTotalCredits = rows.filter((r) => !r.isFail).reduce((sum, r) => sum + r.credits, 0);

  const unmapped = rows.filter((r) => !r.category);
  if (unmapped.length > 0) {
    warnings.push(`이수구분을 자동으로 판별하지 못한 과목 ${unmapped.length}건이 있습니다. 직접 선택해주세요.`);
  }

  // isClean: 규칙 기반 경로가 "이 결과를 그대로 신뢰해도 되는지" 판단하는 데만 쓴다(AI
  // 경로는 이 값을 쓰지 않음) — 소계가 하나라도 안 맞거나, 이름이 비정상적으로 길어 버려진
  // 행이 있거나, 애초에 한 줄도 못 뽑았으면 규칙 기반을 신뢰하지 않고 AI로 다시 시도한다.
  const isClean = rows.length > 0 && droppedRows === 0 && !hasSubtotalMismatch;

  return { rows, extractedTotalCredits, warnings, isClean };
}

async function parseFullTranscriptText(rawText) {
  const text = rawText.replace(/\r/g, '');
  const { semesterBoundaries, declaredBySemester } = computeSemesterSubtotals(text);

  // 문서 맨 위 학생 개인정보(학과/학번/성명) 블록은 첫 학기 섹션 헤더보다 앞에 있다
  // (FULL_TRANSCRIPT_EXTRACT_SYSTEM_PROMPT 주석 참고) — parseCourseListText가 이수과목확인
  // 리스트 헤더 이전을 잘라내는 것과 동일한 이유로, AI에는 첫 학기 섹션부터만 보내서
  // 애초에 이름·학번이 API 호출에 실리지 않게 한다. 소계 대조(위 declaredBySemester)는
  // 원문 전체 기준 인덱스가 필요하므로 이 자르기는 AI로 보낼 사본에만 적용한다.
  const firstSemesterIndex = semesterBoundaries[0]?.index;
  const sliced = firstSemesterIndex != null ? text.slice(firstSemesterIndex) : text;
  // 위치 기반으로 앞부분을 잘라내도 안심할 수 없는 경로(페이지 전체 선택해 붙여넣기 등)를
  // 대비해, 어디에 있든 학번/이름 패턴이면 한 번 더 가린 뒤에만 API로 보낸다.
  const contentForAi = redactStudentIdentifiers(sliced);

  const leadingWarnings = [];
  let extracted = [];
  try {
    extracted = await extractFullTranscriptRows(contentForAi);
  } catch (err) {
    leadingWarnings.push('과목을 인식하는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
  }

  const { isClean, ...result } = finalizeFullTranscriptRows(extracted, declaredBySemester, leadingWarnings);
  return result;
}

// 붙여넣기 텍스트 전용 규칙 기반 1차 파서 — Claude API를 호출하지 않는다. 실제 붙여넣기
// 샘플(2026-09 확인)이 "이수구분/학수번호/교과목명/학점/평점/등급" 6칸 + "YYYY 년 N 학기"
// 헤더 + "취득학점/평균평점" 소계 2칸+숫자 2칸으로만 구성돼 있어 정규식으로도 안전하게
// 처리할 수 있다고 판단했다. 다만 PDF 파싱을 정규식에서 AI로 옮긴 이유(기기마다 인쇄 레이아웃이
// 미묘하게 달라 계속 깨졌던 문제, 파일 상단 주석 참고)가 재발하지 않도록, 아는 패턴 어디에도
// 안 걸리는 내용이 나오면 즉시 포기하고 null을 반환한다 — 추측성 파싱을 하지 않고, 호출부가
// AI 경로로 폴백하게 한다.
//
// 필드 구분자가 항상 탭(\t)인 건 아니다 — 같은 표를 복사해도 붙여넣는 대상(우리 textarea,
// 다른 텍스트 입력창 등)에 따라 탭이 줄바꿈으로 바뀌어 들어오는 경우가 실사용으로 확인됐다
// (2026-09, "이수구분\t학수번호\t..." 한 줄이 "이수구분"/"학수번호"/... 여러 줄로 쪼개짐).
// 그래서 줄 단위가 아니라 \t와 \n을 전부 같은 구분자로 보고 토큰 스트림으로 납작하게 편 뒤,
// 그 토큰 나열이 "6칸짜리 데이터 행/헤더" 또는 "4칸짜리 소계"인지를 앞에서부터 그리디하게
// 소비하며 확인한다 — 탭 구분이든 줄바꿈 구분이든 같은 로직으로 처리된다.
const FULL_TRANSCRIPT_SEMESTER_LINE_RE = /^(\d{4})\s*년\s*([12])\s*학기$/;
const NUMBER_TOKEN_RE = /^\d+(?:\.\d+)?$/;
const GRADE_TOKENS = new Set(['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F', 'P', 'NP']);
const CODE_TOKENS = new Set(KNOWN_CODES);

function tryParseFullTranscriptLines(text) {
  const tokens = text
    .split(/[\t\n]/)
    .map((t) => t.trim())
    .filter((t) => t !== '');

  const items = [];
  let currentYear = null;
  let currentSemester = null;
  let sawSemesterHeader = false;
  // inTable: 지금 "학기 헤더 ~ 그 학기 소계" 사이(진짜 과목 데이터 구간)에 있는지. 이 구간 밖은
  // 제목("전체성적조회"), 학생정보(대학명/학과/학번/성명), "화면출력/돌아가기" 버튼처럼 전체
  // 페이지를 그대로 선택해 복사했을 때 앞뒤로 섞여 들어오는 장식 텍스트일 수 있어(실사용 확인,
  // 2026-09) 낯선 토큰이 나와도 무시하고 다음 학기 헤더를 기다린다. 반대로 이 구간 "안"에서
  // 낯선 토큰이 나오면 진짜 과목 데이터가 깨진 것일 수 있으니 그때는 여전히 즉시 포기한다 —
  // 관대함을 장식 텍스트 구간에만 국한해 오탐을 막는다.
  let inTable = false;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    const semMatch = token.match(FULL_TRANSCRIPT_SEMESTER_LINE_RE);
    if (semMatch) {
      currentYear = Number(semMatch[1]);
      currentSemester = RAW_SEMESTER_TO_CODE[Number(semMatch[2])];
      sawSemesterHeader = true;
      inTable = true;
      i += 1;
      continue;
    }

    // 표 헤더 6칸: 이수구분/학수번호/교과목명/학점/평점/(점수 또는 등급) — 그대로 건너뛴다.
    if (
      token === '이수구분' &&
      tokens[i + 1] === '학수번호' &&
      tokens[i + 2] === '교과목명' &&
      tokens[i + 3] === '학점' &&
      tokens[i + 4] === '평점'
    ) {
      i += 6;
      continue;
    }

    // 소계 4칸: 취득학점/평균평점/숫자/숫자 — 이 학기 표는 여기서 끝, 다음 학기 헤더가 나올
    // 때까지는 다시 장식 텍스트 관대 구간으로 돌아간다.
    if (
      token === '취득학점' &&
      tokens[i + 1] === '평균평점' &&
      NUMBER_TOKEN_RE.test(tokens[i + 2] || '') &&
      NUMBER_TOKEN_RE.test(tokens[i + 3] || '')
    ) {
      i += 4;
      inTable = false;
      continue;
    }

    // 데이터 행 6칸: 이수구분코드/학수번호/교과목명/학점/평점/등급
    if (CODE_TOKENS.has(token)) {
      const [code, courseNo, name, credits, avg, grade] = tokens.slice(i, i + 6);
      const shapeOk =
        courseNo !== undefined &&
        name !== undefined &&
        NUMBER_TOKEN_RE.test(credits || '') &&
        NUMBER_TOKEN_RE.test(avg || '') &&
        GRADE_TOKENS.has(grade);
      if (shapeOk && currentYear && currentSemester) {
        items.push({ rawCategory: code, name, year: currentYear, semester: currentSemester, credits: Number(credits), letterGrade: grade });
        i += 6;
        continue;
      }
      // 표 구간 안인데 이수구분 코드로 시작하고도 뒤 구조가 안 맞으면 진짜 데이터가 깨진
      // 것일 수 있으니 신뢰하지 않는다. 표 구간 밖이면(장식 텍스트가 우연히 코드 두 글자와
      // 같을 가능성, 극히 드묾) 그냥 한 토큰만 무시하고 넘어간다.
      if (inTable) return null;
      i += 1;
      continue;
    }

    if (inTable) return null; // 표 구간 안에서 낯선 토큰 — 신뢰할 수 없어 즉시 포기.
    i += 1; // 표 구간 밖의 장식 텍스트 — 무시하고 다음 토큰으로.
  }

  if (!sawSemesterHeader || items.length === 0) return null;
  return items;
}

// null이면 "규칙 기반으로 신뢰할 수 있게 못 읽었다"는 뜻 — 호출부가 parseFullTranscriptText(AI)로
// 폴백해야 한다.
function parseFullTranscriptTextRuleBased(rawText) {
  const text = rawText.replace(/\r/g, '');
  const { declaredBySemester } = computeSemesterSubtotals(text);

  const items = tryParseFullTranscriptLines(text);
  if (!items) return null;

  const { isClean, ...result } = finalizeFullTranscriptRows(items, declaredBySemester);
  return isClean ? result : null;
}

async function parseCourseListPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const rawText = result.text;

    if (hasNoHangulText(rawText)) {
      return {
        docType: null,
        rows: [],
        declaredTotalCredits: null,
        extractedTotalCredits: null,
        warnings: [
          '이 PDF에서 한글 글자를 전혀 인식하지 못했어요. 기기나 브라우저에 따라 "전체성적조회"를 PDF로 ' +
            '저장할 때 한글이 텍스트로 저장되지 않는 경우가 있어요. "텍스트 붙여넣기로 다시 시도하기"를 ' +
            '이용해주세요.',
        ],
      };
    }

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

module.exports = {
  parseCourseListPdf,
  parseCourseListText,
  parseFullTranscriptText,
  parseFullTranscriptTextRuleBased,
  detectDocumentType,
};
