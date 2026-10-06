/** 챗봇 답변 텍스트를 제목·목록·구분선·문단 블록으로 나눈다. */
export function parseBlocks(text) {
  const blocks = [];
  let list = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = { type: 'list', items: [] };
        blocks.push(list);
      }
      list.items.push(bullet[1]);
      continue;
    }
    list = null;
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) blocks.push({ type: 'heading', text: heading[1] });
    else if (/^\s*-{3,}\s*$/.test(line)) blocks.push({ type: 'rule' });
    else if (line.trim() === '') continue;
    else blocks.push({ type: 'paragraph', text: line });
  }
  return blocks;
}
