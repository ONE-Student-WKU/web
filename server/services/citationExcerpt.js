/**
 * server/services/citationExcerpt.js
 * 챗봇 답변의 근거 목록에 보일 발췌문을 만든다.
 *
 * 근거 조각은 마크다운 원문(제목 #, 목록 -, 표 |...|)이다. 예전에는 앞 150자를 글자 수로 잘라 그대로 보여 줘서 "###"·"|---|"가
 * 화면에 남고 표가 중간에 끊겼다(2026-10-16 운영 점검). 이제 줄 단위로 잘라 화면이 답변과 같은 렌더러(MessageText)로 그린다.
 *  - 표는 머리 줄·구분선을 남기고 앞 MAX_TABLE_ROWS행만 넣는다(나머지는 "…").
 *  - 근거로 의미 없는 앞머리는 뺀다: 책자 학년도 표시("[2021학년도 교육과정 책자] "), 출처 URL 줄("출처: https://...").
 *  - 화면 렌더러는 제목을 ###까지만 읽어서 더 깊은 제목은 ###로 맞춘다.
 *
 * 발췌문은 규정 문서 원문(DB 조각, chunkId가 숫자)과 조문 원문(regulation-article-*)에만 붙인다. 서버가 계산해 만든 근거(규정 판단,
 * 졸업요건, 변경 이력, 과목 목록 등)는 모델에게 주는 지시("답변 지침: … 단정하지 마라")가 섞여 있어 제목만 보인다(2026-10-16 운영 점검).
 */

const MAX_CHARS = 300;
const MAX_TABLE_ROWS = 3;
const ELLIPSIS = '…';
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const isSeparator = (line) => /^[\s|:-]+$/.test(line) && /-{3,}/.test(line) && line.includes('|');

function makeExcerpt(content) {
  const lines = String(content ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd().replace(/^#{4,}\s/, '### '))
    .filter((line) => !/^\s*출처\s*:/.test(line));
  if (lines.length) lines[0] = lines[0].replace(/^\[\d{4}학년도 [^\]]*\]\s*/, '');

  const out = [];
  let used = 0;
  let tableRows = null; // 표 안이면 지금까지 넣은 데이터 행 수, 표 밖이면 null
  let truncated = false;
  for (const line of lines) {
    if (line.trim() === '') {
      if (out.length && out[out.length - 1] !== '') out.push('');
      tableRows = null;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      if (tableRows === null) {
        // 표를 새로 시작할 자리가 없으면 표를 통째로 뺀다(머리 줄만 남기지 않는다).
        if (used >= MAX_CHARS) { truncated = true; break; }
        tableRows = 0;
      } else if (!isSeparator(line) && ++tableRows > MAX_TABLE_ROWS) {
        truncated = true;
        break;
      }
      out.push(line);
      used += line.length;
      continue;
    }
    tableRows = null;
    if (used + line.length > MAX_CHARS) {
      // 남은 자리가 넉넉하면 이 줄을 잘라 "…"를 붙이고, 아니면 줄을 빼고 끝에 "…" 한 줄을 둔다.
      const room = MAX_CHARS - used;
      if (room >= 40) out.push(`${line.slice(0, room).trimEnd()}${ELLIPSIS}`);
      else truncated = true;
      break;
    }
    out.push(line);
    used += line.length;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (truncated) out.push(ELLIPSIS);
  return out.join('\n');
}

const isSourceText = (chunkId) => typeof chunkId === 'number' || String(chunkId).startsWith('regulation-article-');

/** 근거 목록 한 줄의 발췌문 — 원문이 아니면 null(화면은 제목만 보인다). */
function citationExcerpt(chunk) {
  return isSourceText(chunk.chunkId) ? makeExcerpt(chunk.content) : null;
}

module.exports = { makeExcerpt, citationExcerpt, MAX_CHARS, MAX_TABLE_ROWS };
