#!/usr/bin/env node
/**
 * scripts/dev/screen-report/scope-css.js
 * 앱 App.css를 리포트의 Shadow DOM 안에서 375×812 모바일 화면과 똑같이 쓰도록 바꾼다(README.md).
 *  - :root·html → .app-root, body → .app-body (폰마다 그 안에서만 적용)
 *  - 375px에 맞는 width 미디어 조건은 풀어 넣고, 안 맞는 것·print·prefers-color-scheme은 뺀다
 *  - vh/dvh·vw는 812px·375px 기준 px로 바꾼다
 * 사용: node scripts/dev/screen-report/scope-css.js <입력 App.css> <출력 css>
 */
const fs = require('node:fs');
const path = require('node:path');
const postcss = require(require.resolve('postcss', { paths: [path.resolve(__dirname, '..', '..', '..')] }));

const WIDTH = 375;
const HEIGHT = 812;
const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('사용: node scope-css.js <입력 App.css> <출력 css>');
  process.exit(1);
}
const root = postcss.parse(fs.readFileSync(input, 'utf8'));

function mediaVerdict(params) {
  const p = params.trim();
  if (/^print$/.test(p)) return 'drop';
  if (/prefers-reduced-motion|hover|pointer/.test(p)) return 'keep';
  if (/prefers-color-scheme/.test(p)) return 'drop';
  const max = p.match(/^\(max-width:\s*(\d+)px\)$/);
  if (max) return WIDTH <= Number(max[1]) ? 'unwrap' : 'drop';
  const min = p.match(/^\(min-width:\s*(\d+)px\)$/);
  if (min) return WIDTH >= Number(min[1]) ? 'unwrap' : 'drop';
  // 모르는 조건이 새로 생기면 조용히 틀리게 그리지 않고 멈춘다 — 여기에 규칙을 더한다.
  throw new Error(`알 수 없는 미디어 조건: ${p}`);
}

root.walkAtRules('media', (at) => {
  const v = mediaVerdict(at.params);
  if (v === 'drop') at.remove();
  else if (v === 'unwrap') at.replaceWith(at.nodes);
});

const TYPE = (name) => new RegExp(`(^|[\\s,>+~(])${name}(?=[\\s,.:#\\[>+~)]|$)`, 'g');
root.walkRules((rule) => {
  if (rule.parent && rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
  rule.selectors = rule.selectors.map((s) => s.replace(/:root/g, '.app-root').replace(TYPE('html'), '$1.app-root').replace(TYPE('body'), '$1.app-body'));
});

root.walkDecls((d) => {
  d.value = d.value
    .replace(/(\d*\.?\d+)d?vh\b/g, (_, n) => `${(Number(n) * HEIGHT) / 100}px`)
    .replace(/(\d*\.?\d+)vw\b/g, (_, n) => `${(Number(n) * WIDTH) / 100}px`);
});

fs.writeFileSync(output, root.toString());
// 검증(verify.js)은 원본 CSS로 그린 같은 DOM과 대조하므로, <이름>.scoped.css 옆에 원본을 <이름>.App.css로 둔다.
if (output.endsWith('.scoped.css')) fs.copyFileSync(input, output.replace(/\.scoped\.css$/, '.App.css'));
console.log('ok', output);
