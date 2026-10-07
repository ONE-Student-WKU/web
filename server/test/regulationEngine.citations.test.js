const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CITATIONS, TEXT_SOURCES } = require('../services/regulationEngine/constants');
const { FLAG_CATALOG } = require('../services/regulationEngine/flags');

/**
 * server/test/regulationEngine.citations.test.js
 * 규정 판단 엔진의 "근거 무결성" 검사 — DB 없이 파일만 읽는다.
 *  1) 근거 레지스트리의 quote가 실제 원문 파일에 존재하는가(조문을 지어내지 않았는가)
 *  2) 코드가 참조하는 근거 키·플래그 코드가 전부 등록돼 있는가(실행되지 않는 분기의 오타까지 잡는다)
 *  3) 원문 부칙/표지에서 읽은 판본 시행일이 TEXT_SOURCES와 일치하는가
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENGINE_DIR = path.resolve(__dirname, '..', 'services', 'regulationEngine');

// 공백 차이(줄바꿈·연속 공백)와 전각/반각 따옴표 차이는 무시하고 비교한다.
const normalize = (s) => s.normalize('NFKC').replace(/\s+/g, '');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('근거 레지스트리: ARTICLE/BOOKLET의 quote가 원문 파일에 실제로 있다', () => {
  for (const [key, c] of Object.entries(CITATIONS)) {
    if (!c.quote) continue;
    assert.ok(c.file, `${key}: quote가 있으면 file이 필요해요`);
    const text = normalize(read(c.file));
    assert.ok(text.includes(normalize(c.quote)), `${key}: "${c.quote}" 가 ${c.file} 에서 발견되지 않았어요`);
  }
});

test('근거 레지스트리: 원문이 없는 근거(CASE/CONVENTION/표 데이터)는 ref로 출처를 남긴다', () => {
  for (const [key, c] of Object.entries(CITATIONS)) {
    if (c.quote) continue;
    assert.ok(c.ref, `${key}: quote도 ref도 없는 근거는 허용하지 않아요`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, c.ref.split(' ')[0])), `${key}: ref 경로가 실제로 있어야 해요 (${c.ref})`);
  }
});

test('코드가 참조하는 근거 키와 플래그 코드는 전부 등록돼 있다', () => {
  const files = fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js') && f !== 'constants.js' && f !== 'flags.js');
  const usedFlags = new Set();
  const usedCitations = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    for (const m of src.matchAll(/makeFlag\('([A-Z0-9_]+)'/g)) usedFlags.add(m[1]);
    for (const m of src.matchAll(/'((?:ENF|ACAD|BOOKLET|CASE|SITE)_[A-Z0-9_]+)'/g)) usedCitations.add(m[1]);
  }
  assert.ok(usedFlags.size > 10 && usedCitations.size > 5, '스캔이 동작해야 해요');
  for (const code of usedFlags) assert.ok(FLAG_CATALOG[code], `플래그 ${code} 가 카탈로그에 없어요`);
  for (const key of usedCitations) assert.ok(CITATIONS[key], `근거 키 ${key} 가 레지스트리에 없어요`);
});

test('규정 문서 판본 시행일: 원문 부칙에서 읽은 값과 일치한다', () => {
  const acad = read(TEXT_SOURCES.ACADEMIC_REGULATIONS.file);
  assert.match(acad, /부\s*칙\(2026\.02\.05\.\)\s*\n제1조\(시행일\) 이 학칙은 2026년 2월 5일부터 시행한다/);
  assert.match(acad, /부\s*칙\(2026\.04\.10\.\)\s*\n제1조\(시행일\) 이 학칙은 2026년 4월 10일부터 시행한다/);
  assert.match(acad, /부\s*칙\(2026\.06\.26\.\)\s*\n제1조\(시행일\) 이 학칙은 공포한 날로부터 시행한다/);
  assert.deepEqual(TEXT_SOURCES.ACADEMIC_REGULATIONS.amendments, ['2026-02-05', '2026-04-10', '2026-06-26']);

  const enf = read(TEXT_SOURCES.ENFORCEMENT_RULES.file);
  assert.match(enf, /부\s*칙\(2026\.02\.05\.\)\s*\n제1조\(시행일\) 본 시행규칙은 2026년 3월 1일부터 시행한다/);
  assert.match(enf, /본 시행규칙은 2026년 4월 10일부터 시행한다/);
  assert.match(enf, /본 시행규칙은 2026년 6월 26일부터 시행한다/);
  assert.deepEqual(TEXT_SOURCES.ENFORCEMENT_RULES.amendments, ['2026-03-01', '2026-04-10', '2026-06-26']);
});
