import { pickJosa } from './korean.js';

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

// summarizeShortfalls 결과를 "OO, OO가 부족해요." 문장으로 조립 — 마지막 항목의 받침 유무에
// 맞춰 이/가를 고른다(항상 "이"로 고정하면 "졸업인증제이 부족해요"처럼 어색해짐).
export function formatShortfallSentence(shortfalls) {
  if (!shortfalls || shortfalls.length === 0) return null;
  const last = shortfalls[shortfalls.length - 1];
  return `${shortfalls.join(', ')}${pickJosa(last, ['이', '가'])} 부족해요.`;
}
