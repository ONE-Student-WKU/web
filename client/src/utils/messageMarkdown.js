// 표 한 줄: "|"로 시작하고 "|"로 끝난다. 구분선 줄: "|---|:---:|"처럼 |, -, :, 공백만 있고 "---"가 들어 있다.
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const isSeparator = (line) => /^[\s|:-]+$/.test(line) && /-{3,}/.test(line) && line.includes('|');
// 모델이 표 칸·목록 안에서 줄을 바꾸려고 쓰는 <br>을 글자 그대로 보이지 않게 줄바꿈 문자로 바꾼다. 말풍선은 white-space: pre-wrap이라
// 줄바꿈으로 그려진다. HTML로 주입하지 않으므로 안전하다(UX 점검 2026-10-16 2-3: 표 칸에 "<br>"이 여러 번 그대로 보였다).
const brToNewline = (text) => text.replace(/<br\s*\/?>/gi, '\n');
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => brToNewline(cell.trim()));

// i 다음에서 빈 줄을 건너뛴 첫 줄의 위치(없으면 lines.length).
function nextNonBlank(lines, i) {
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === '') j++;
  return j;
}

/**
 * 챗봇 답변 텍스트를 제목·목록·구분선·표·문단 블록으로 나눈다.
 * 표는 머리 줄 바로 다음(빈 줄은 건너뜀)에 구분선 줄이 있을 때만 표로 본다. 모델이 행 사이에 빈 줄을 넣어도 같은 표로 묶는다
 * (2026-10-15 운영 점검: 표가 "|"로 시작하는 문단으로 그대로 보였다, #378). 구분선이 없으면 예전처럼 글자 그대로 둔다.
 */
export function parseBlocks(text) {
  const lines = String(text ?? '').split('\n').map((raw) => raw.trimEnd());
  const blocks = [];
  let list = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (TABLE_ROW.test(line) && !isSeparator(line)) {
      const sep = nextNonBlank(lines, i);
      if (sep < lines.length && isSeparator(lines[sep])) {
        const rows = [];
        let k = sep + 1;
        while (k < lines.length) {
          if (lines[k].trim() === '') {
            const next = nextNonBlank(lines, k);
            if (next < lines.length && TABLE_ROW.test(lines[next])) {
              k = next;
              continue;
            }
            break;
          }
          if (!TABLE_ROW.test(lines[k])) break;
          if (!isSeparator(lines[k])) rows.push(splitRow(lines[k]));
          k++;
        }
        blocks.push({ type: 'table', header: splitRow(line), rows });
        list = null;
        i = k - 1;
        continue;
      }
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = { type: 'list', items: [] };
        blocks.push(list);
      }
      list.items.push(brToNewline(bullet[1]));
      continue;
    }
    list = null;
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) blocks.push({ type: 'heading', text: heading[1] });
    else if (/^\s*-{3,}\s*$/.test(line)) blocks.push({ type: 'rule' });
    else if (line.trim() === '') continue;
    else blocks.push({ type: 'paragraph', text: brToNewline(line) });
  }
  return blocks;
}
