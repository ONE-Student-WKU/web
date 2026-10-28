#!/usr/bin/env node
/**
 * scripts/dev/screen-report/capture-server.js
 * 화면 비교 리포트(README.md) 작업 폴더의 로컬 수신기·정적 서버 — 127.0.0.1에서만 받는다.
 *  - POST /?name=<이름>  브라우저에서 뜬 화면 DOM(cap.js)을 <작업 폴더>/cap/<이름>.json으로 저장
 *  - GET  /cap.js, /verify.js  브라우저에 넣을 스크립트
 *  - GET  그 밖의 경로  작업 폴더의 파일(빌드한 리포트, cap/*.json, cap/*.App.css) — 검증할 때 리포트를 여기서 연다
 * 사용: node scripts/dev/screen-report/capture-server.js [작업 폴더]  (기본: SCREEN_REPORT_DIR 또는 OS 임시 폴더/wku-screen-report)
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3010;
const DIR = path.resolve(process.argv[2] || process.env.SCREEN_REPORT_DIR || path.join(os.tmpdir(), 'wku-screen-report'));
const CAP = path.join(DIR, 'cap');
fs.mkdirSync(CAP, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return res.end();
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST') {
      const name = url.searchParams.get('name');
      if (!/^[a-z0-9-]+$/.test(name || '')) {
        res.statusCode = 400;
        return res.end('name은 영문 소문자·숫자·-만');
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        fs.writeFileSync(path.join(CAP, `${name}.json`), body);
        res.end(`saved ${name} ${body.length}`);
      });
      return;
    }

    if (url.pathname === '/cap.js' || url.pathname === '/verify.js') {
      res.setHeader('content-type', TYPES['.js']);
      return res.end(fs.readFileSync(path.join(__dirname, url.pathname.slice(1)), 'utf8'));
    }
    const file = path.join(DIR, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end('없음');
    }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`screen-report: http://127.0.0.1:${PORT}/  작업 폴더 ${DIR}`));
