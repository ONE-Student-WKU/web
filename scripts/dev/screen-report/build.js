#!/usr/bin/env node
/**
 * scripts/dev/screen-report/build.js
 * 리포트 템플릿 + 캡처한 화면 DOM + 브랜치별 변환 CSS + Pretendard를 한 HTML로 묶는다(README.md).
 * 사용: node scripts/dev/screen-report/build.js <템플릿.html> <출력.html> [--full-font]
 *  - 작업 폴더: SCREEN_REPORT_DIR(기본 OS 임시 폴더/wku-screen-report) — cap/, font/, patches/를 여기서 읽는다
 *  - 템플릿의 {{FONTS}}(<style> 안), {{CSS}}, {{CAPTURES}}, {{RUNTIME}} 자리를 채운다
 *  - 폰 자리: <div class="phone" data-cap="이름" data-css="develop"></div>  (예시는 template.example.html)
 *  - 폰트: font/Pretendard-{Regular,Medium,SemiBold,Bold,ExtraBold}.woff2. Python fontTools가 있으면(PYTHONPATH) 페이지에 쓰인
 *    글자만 남겨 줄이고, 없거나 --full-font면 원본을 그대로 넣는다(1MB → 5MB 정도로 커질 뿐 화면은 같다)
 *  - <출력>.local.html도 만든다 — 게시할 때 붙는 doctype·viewport를 붙인 확인용 사본(없으면 호환 모드로 그려져 줄 높이가 다르다)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DIR = path.resolve(process.env.SCREEN_REPORT_DIR || path.join(os.tmpdir(), 'wku-screen-report'));
const CAP = path.join(DIR, 'cap');
const FONT = path.join(DIR, 'font');
const [, , templatePath, outPath, flag] = process.argv;
if (!templatePath || !outPath) {
  console.error('사용: node build.js <템플릿.html> <출력.html> [--full-font]');
  process.exit(1);
}
let html = fs.readFileSync(templatePath, 'utf8');
const esc = (s) => s.replace(/<\/(script|template)/gi, '<\\/$1');

const used = [...new Set([...html.matchAll(/data-cap="([a-z0-9-]+)"/g)].map((m) => m[1]))];
let captures = '';
const missing = [];
for (const name of used) {
  const file = path.join(CAP, `${name}.json`);
  if (!fs.existsSync(file)) {
    missing.push(name);
    continue;
  }
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  captures += `<template id="cap-${name}" data-theme="${c.theme || 'light'}">${c.html.replace(/<\/template/gi, '&lt;/template')}</template>\n`;
}
if (missing.length) console.warn('없는 캡처:', missing.join(', '));

const css = fs
  .readdirSync(CAP)
  .filter((f) => f.endsWith('.scoped.css'))
  .map((f) => `<script type="text/plain" id="css-${f.replace(/\.scoped\.css$/, '')}">${esc(fs.readFileSync(path.join(CAP, f), 'utf8'))}</script>`)
  .join('\n');

const patchesDir = path.join(DIR, 'patches');
let patches = '';
if (fs.existsSync(patchesDir)) {
  for (const f of fs.readdirSync(patchesDir).filter((x) => x.endsWith('.js'))) {
    patches += `PATCHES[${JSON.stringify(f.replace(/\.js$/, ''))}] = function (root) {\n${fs.readFileSync(path.join(patchesDir, f), 'utf8')}\n};\n`;
  }
}

const WEIGHTS = [
  ['Regular', 400],
  ['Medium', 500],
  ['SemiBold', 600],
  ['Bold', 700],
  ['ExtraBold', 800],
];
const chars =
  [...new Set([...(html + captures + patches + css).replace(/<[^>]+>/g, ' ')])].join('') +
  ' 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,:;!?()[]{}<>/\\|-_=+*&^%$#@~`\'"·…→←↑↓▾▴▸▲▼✓✕⚠';
fs.writeFileSync(path.join(FONT, 'chars.txt'), chars);
let fonts = '';
for (const [file, weight] of WEIGHTS) {
  const src = path.join(FONT, `Pretendard-${file}.woff2`);
  if (!fs.existsSync(src)) {
    console.error(`폰트가 없어요: ${src} — README.md의 "폰트 받기"를 보세요.`);
    process.exit(1);
  }
  let buf = fs.readFileSync(src);
  if (flag !== '--full-font') {
    const out = path.join(FONT, `sub-${file}.woff2`);
    try {
      execFileSync('python', ['-m', 'fontTools.subset', src, `--text-file=${path.join(FONT, 'chars.txt')}`, '--flavor=woff2', '--layout-features=*', `--output-file=${out}`], { stdio: 'pipe' });
      buf = fs.readFileSync(out);
    } catch {
      if (weight === 400) console.warn('fontTools를 못 써서 폰트를 줄이지 않고 넣어요(화면은 같고 파일만 커져요).');
    }
  }
  fonts += `@font-face{font-family:'Pretendard';font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');}\n`;
}

const runtime = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
html = html
  .replace('{{FONTS}}', () => fonts)
  .replace('{{CSS}}', () => css)
  .replace('{{CAPTURES}}', () => captures)
  .replace('{{RUNTIME}}', () => `<script>\nconst PATCHES = {};\n${patches}\n${runtime}\n</script>`);
fs.writeFileSync(outPath, html);
const local = outPath.replace(/\.html$/, '') + '.local.html';
fs.writeFileSync(local, `<!doctype html>\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${html}`);
console.log('built', outPath, `${(fs.statSync(outPath).size / 1024).toFixed(0)}KB`, 'captures', `${used.length - missing.length}/${used.length}`, '· 확인용', local);
