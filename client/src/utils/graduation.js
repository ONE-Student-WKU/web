/**
 * client/src/utils/graduation.js
 * getGraduationStatus() 응답(categories/certifications)에서 "부족 요건" 문구를 조립.
 * Home.jsx의 요약 카드와 GraduationStatus.jsx의 요약 박스가 동일 로직을 공유한다.
 */
export function summarizeShortfalls(categories, certifications) {
  const items = [];

  for (const c of categories || []) {
    const missing = c.requiredCredits - c.earnedCredits;
    if (missing > 0) items.push(`${c.category} ${missing}학점`);
  }

  for (const cert of certifications || []) {
    if (!cert.satisfied) items.push(cert.category);
  }

  return items;
}
