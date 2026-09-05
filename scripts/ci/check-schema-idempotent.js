#!/usr/bin/env node
/**
 * db-reseed-guard: schema.sql 멱등성 체크
 *
 * db/migrate.js는 db/schema.sql을 그대로 실행하며, 이 파일의 모든 CREATE TABLE은
 * `IF NOT EXISTS`를 사용해 몇 번을 재실행해도 안전(멱등)하게 되어 있다. 이 스크립트는
 * PR에서 db/schema.sql에 `IF NOT EXISTS` 없는 CREATE TABLE이 새로 추가/수정됐는지만
 * 정적으로(diff 텍스트만 보고) 검사한다.
 *
 * 절대 하지 않는 것: DB 접속/쿼리, db/migrate.js 호출, 워크플로우 실행. 완벽한 SQL
 * 파서가 아니라 휴리스틱 정적 검사임에 유의 — 아주 특이한 포맷팅(줄 하나에 여러
 * statement 등)은 놓칠 수 있다.
 *
 * 사용법:
 *   node scripts/ci/check-schema-idempotent.js --base <ref> --head <ref>
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_RELPATH = 'db/schema.sql';

function parseArgs(argv) {
  const args = { base: null, head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--head') args.head = argv[++i];
  }
  if (!args.base) {
    console.error('사용법: node check-schema-idempotent.js --base <ref> [--head <ref>]');
    process.exit(2);
  }
  return args;
}

// check-db-reseed-paths.js와 동일한 이유로 execFileSync(인자 배열) + core.quotepath=false
// 를 쓴다 (셸 인용 문제 방지 / 비-ASCII 경로 오탐 방지 — schema.sql 경로 자체는 ASCII지만
// 두 스크립트의 git 호출 방식을 통일해 둔다).
function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function getSchemaDiff(base, head) {
  try {
    // --unified=3 : 문맥 줄을 좀 남겨서, 여러 줄에 걸친 CREATE TABLE( ... ) 선언이
    // hunk 경계에서 잘려 statement 조립이 깨지는 걸 줄인다 (unified=0은 너무 타이트함).
    return git(['diff', '--unified=3', `${base}...${head}`, '--', SCHEMA_RELPATH]);
  } catch (err) {
    console.error(`[check-schema-idempotent] git diff 실패: ${err.message}`);
    process.exit(2);
  }
}

// diff 텍스트에서 "추가된" 줄(+ 로 시작, +++ 헤더 제외)만 뽑아 이어붙인다.
// 이러면 여러 줄짜리 `CREATE TABLE foo (\n  col ...\n);` 선언도 하나의 문자열로 재구성된다.
function extractAddedText(diffText) {
  return diffText
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .join('\n');
}

// 세미콜론 기준으로 대략적인 statement 단위로 쪼갠 뒤, 각 statement 안에서
// "CREATE TABLE"이 나오는데 바로 뒤에 "IF NOT EXISTS"가 없으면 문제로 기록한다.
// 완벽한 SQL 파서가 아니라 휴리스틱임 — 이 저장소 schema.sql의 실제 스타일
// (statement마다 세미콜론으로 끝남, 한 statement = 한 CREATE TABLE)에 맞춰져 있다.
function findNonIdempotentCreateTables(addedText) {
  const statements = addedText.split(';');
  const problems = [];
  const re = /CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)(\S+)/i;
  for (const stmt of statements) {
    const m = stmt.match(re);
    if (m) {
      const firstLine = stmt.trim().split('\n')[0];
      problems.push({ tableRef: m[1], snippet: firstLine });
    }
  }
  return problems;
}

function main() {
  const { base, head } = parseArgs(process.argv.slice(2));

  const diffText = getSchemaDiff(base, head);
  if (!diffText.trim()) {
    console.log(`[check-schema-idempotent] OK — 이 PR에서 ${SCHEMA_RELPATH} 변경 없음.`);
    return;
  }

  const addedText = extractAddedText(diffText);
  const problems = findNonIdempotentCreateTables(addedText);

  if (problems.length === 0) {
    console.log(
      `[check-schema-idempotent] OK — ${SCHEMA_RELPATH}에 추가된 CREATE TABLE은 모두 IF NOT EXISTS를 사용합니다.`
    );
    return;
  }

  console.error('');
  console.error(
    `[check-schema-idempotent] ${SCHEMA_RELPATH}에 IF NOT EXISTS 없이 추가/수정된 CREATE TABLE이 있습니다 ` +
      '(db/migrate.js가 재실행될 때 에러가 나거나 멱등성이 깨질 수 있습니다):'
  );
  for (const p of problems) {
    console.error(`  - ${p.snippet}`);
  }
  console.error('');
  console.error('CREATE TABLE 뒤에 IF NOT EXISTS를 추가하세요 (예: CREATE TABLE IF NOT EXISTS foo (...)).');
  console.error(
    '(이 체크는 diff 텍스트만 보는 휴리스틱 정적 검사입니다 — DB 접속이나 실제 마이그레이션 실행은 하지 않습니다.)'
  );

  process.exitCode = 1;
}

main();
