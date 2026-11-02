/**
 * DB에 저장된 요건 설명에서 개발·검수용 메모(예: "신설 커리큘럼 원문 검증됨")와 출처 메모(책자 쪽수·조문·졸업인증제 그룹)를
 * 걷어 내고 학생에게 보여 줄 문구만 남긴다. 출처는 인쇄본·챗봇이 설명한다.
 */
const SOURCE_WORDS = '(?:시행규칙|학칙|책자|뷰어|교육혁신과|안내|졸업인증제 "[가-다]" 그룹)';
export function cleanRequirementNote(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s*[,，]\s*[^,，()]*검증됨/g, '')
    // 괄호 안 "— 출처" 꼬리: "(…은 제외 — 학교 편입생 교육과정 안내, 시행규칙 제10조 제2항)" → "(…은 제외)"
    .replace(new RegExp(`\\s*—\\s*[^()]*${SOURCE_WORDS}[^()]*(?=\\))`, 'g'), '')
    // 출처만 담은 괄호: "(졸업인증제 "나" 그룹, 2020학번부터)", "(2026 교육과정 책자 졸업인증제 공통)"
    .replace(new RegExp(`\\s*\\([^()]*${SOURCE_WORDS}[^()]*\\)`, 'g'), '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
