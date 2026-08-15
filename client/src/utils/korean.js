/**
 * client/src/utils/korean.js
 * 받침 유무에 따라 조사(이/가, 은/는, 을/를 등)를 골라준다.
 */
function hasBatchim(char) {
  const code = char.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false; // 한글 완성형이 아니면 받침 없는 쪽을 기본값으로.
  return (code - 0xac00) % 28 !== 0;
}

// pair: [받침 있을 때, 받침 없을 때] — 예: pickJosa('졸업인증제', ['이', '가']) → '가'
export function pickJosa(word, pair) {
  if (!word) return pair[1];
  const lastChar = word[word.length - 1];
  return hasBatchim(lastChar) ? pair[0] : pair[1];
}
