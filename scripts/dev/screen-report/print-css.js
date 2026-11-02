#!/usr/bin/env node
/**
 * scripts/dev/screen-report/print-css.js
 * 인쇄 전용 화면(졸업요건 진단 PDF 시트처럼 화면에는 안 보이고 인쇄할 때만 찍히는 것)을 리포트에서 종이 한 장으로 그리기 위한 CSS.
 * 그 브랜치 App.css의 `@media print` 규칙만 꺼내 그대로 쓴다(README.md "인쇄본 비교").
 *  - `body.<인쇄 클래스>` → `.paper`(종이 한 장). "인쇄할 때 나머지를 숨기는" `body.x > *:not(...)` 규칙은 뺀다
 *  - @page 여백은 .paper의 padding으로 옮긴다(A4 210mm, 여백 14mm 14mm 12mm — App.css의 @page와 맞춘다)
 *  - 글꼴·줄바꿈은 앱 body와 같게 둔다. 화면용 규칙은 넣지 않는다(인쇄할 때도 시트에는 적용되지 않으므로)
 * 사용: node scripts/dev/screen-report/print-css.js <입력 App.css> <출력 cap/<이름>.print.css>
 */
const fs = require('node:fs');
const path = require('node:path');
const postcss = require(require.resolve('postcss', { paths: [path.resolve(__dirname, '..', '..', '..')] }));

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('사용: node print-css.js <입력 App.css> <출력 .print.css>');
  process.exit(1);
}
const root = postcss.parse(fs.readFileSync(input, 'utf8'));
const out = postcss.root();
let page = '14mm 14mm 12mm';
root.walkAtRules('media', (at) => {
  if (at.params.trim() !== 'print') return;
  at.each((node) => {
    if (node.type === 'atrule' && node.name === 'page') {
      node.walkDecls('margin', (d) => (page = d.value));
      return;
    }
    out.append(node.clone());
  });
});
out.walkRules((rule) => {
  const kept = rule.selectors.filter((s) => !/>\s*\*:not/.test(s)).map((s) => s.replace(/body\.[\w-]+/g, '.paper'));
  if (!kept.length) rule.remove();
  else rule.selectors = kept;
});
const head = `.paper { box-sizing: border-box; width: 210mm; min-height: 297mm; padding: ${page}; background: #fff;
  font-family: 'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; -webkit-font-smoothing: antialiased;
  word-break: keep-all; overflow-wrap: break-word; }
.paper *, .paper *::before, .paper *::after { box-sizing: border-box; }
`;
fs.writeFileSync(output, head + out.toString());
console.log('ok', output);
