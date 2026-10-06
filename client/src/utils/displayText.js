/**
 * DB에 저장된 요건 설명에서 개발·검수용 메모(예: "신설 커리큘럼 원문 검증됨")를 걷어 내고
 * 학생에게 보여 줄 문구만 남긴다.
 */
export function cleanRequirementNote(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s*[,，]\s*[^,，()]*검증됨/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
