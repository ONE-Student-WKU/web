#!/usr/bin/env node
/**
 * db-reseed-guard: 경로 필터 누락 감지
 *
 * .github/workflows/db-reseed.yml 은 db/regulations/**, db/curriculum/**,
 * db/seed/curriculum_requirements.json 경로가 push 될 때만 트리거된다. 이 스크립트는
 * "PR에서 새로 추가된 db/regulations|curriculum|seed 하위 파일이 그 paths: 필터에
 * 안 걸려 있는지"만 정적으로 검사한다.
 *
 * 절대 하지 않는 것: 워크플로우 실행, git commit/push, DB/Railway 접근. 순수 읽기 전용
 * git 조회 + 텍스트 분석뿐이다.
 *
 * 사용법:
 *   node scripts/ci/check-db-reseed-paths.js --base <ref> --head <ref>
 * 예:
 *   node scripts/ci/check-db-reseed-paths.js --base origin/main --head HEAD
 *   node scripts/ci/check-db-reseed-paths.js --base main --head HEAD   (로컬 테스트)
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'db-reseed.yml');

// db-reseed 워크플로우가 관심 갖는 최상위 디렉토리들. 여기 아래에 새 파일이 추가되면
// paths: 필터가 그걸 커버하는지 확인한다. 필요하면 여기에 새 대상 디렉토리를 추가하면 됨.
const WATCHED_DIRS = ['db/regulations/', 'db/curriculum/', 'db/seed/'];

function parseArgs(argv) {
  const args = { base: null, head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--head') args.head = argv[++i];
  }
  if (!args.base) {
    console.error('사용법: node check-db-reseed-paths.js --base <ref> [--head <ref>]');
    process.exit(2);
  }
  return args;
}

// execSync(셸 문자열)가 아니라 execFileSync(인자 배열)를 쓴다 — 커밋 ref에 포함될 수
// 있는 특수문자(^, ~ 등)가 셸에 의해 잘못 해석되는 것을 막기 위함. 그리고 항상
// -c core.quotepath=false 를 붙인다 — 안 붙이면 비-ASCII(한글 등) 파일명이 8진수로
// 이스케이프되어 나와서, 아래 glob 매칭이 실제로는 커버되는 파일도 전부 "누락"으로
// 오탐하게 된다. (이 저장소는 db/curriculum, db/regulations 파일명이 대부분 한글이라
// 이 옵션이 없으면 이 체크 자체가 사실상 항상 오탐만 낸다.)
function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function getAddedFiles(base, head) {
  const out = git(['diff', '--name-status', '--diff-filter=A', `${base}...${head}`]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return tab === -1 ? null : line.slice(tab + 1);
    })
    .filter(Boolean);
}

// 워크플로우 파일이 PR head 쪽에서 이미 바뀌었을 수 있으므로, base가 아니라 head 버전을
// 읽는다 — "이 PR이 제안하는 최종 필터 상태" 기준으로 판단해야 맞다.
function getWorkflowTextAtHead(head) {
  try {
    return git(['show', `${head}:.github/workflows/db-reseed.yml`]);
  } catch {
    // head 커밋에 아직 워크플로우 파일이 없다면(과거 이력 등) 작업 트리의 현재 내용으로 폴백.
    return fs.readFileSync(WORKFLOW_PATH, 'utf8');
  }
}

// on.push.paths: 블록의 "- '...'" 리스트 항목만 추출한다. 저장소에 YAML 파서 의존성이
// 없어서(일부러 안 추가함, plan 참고) 정식 파싱 대신 들여쓰기 기반 단순 추출을 쓴다 —
// db-reseed.yml의 실제 구조(2-space 들여쓰기, 단순 스칼라 리스트)에서는 충분히 견고하다.
function extractPathPatterns(yamlText) {
  const lines = yamlText.split('\n');
  const patterns = [];
  let inPaths = false;
  for (const line of lines) {
    if (!inPaths) {
      if (/^\s*paths:\s*$/.test(line)) inPaths = true;
      continue;
    }
    const m = line.match(/^\s*-\s*['"]([^'"]+)['"]\s*$/);
    if (m) {
      patterns.push(m[1]);
      continue;
    }
    // 리스트가 아닌 첫 줄을 만나면 paths: 블록 종료.
    break;
  }
  return patterns;
}

const GLOB_SPECIAL = '.+^$()|[]\\';
function escapeGlobChar(c) {
  return GLOB_SPECIAL.indexOf(c) >= 0 ? '\\' + c : c;
}

// 최소한의 자체 glob -> RegExp 변환기 (minimatch 등 외부 의존성 없이). 이 워크플로우가
// 실제로 쓰는 패턴 형태(`dir/**`, `dir/file.ext`)만 지원하면 충분하다:
//  - `**` : 디렉토리 경계 포함 임의 문자열
//  - `*`  : `/`를 제외한 임의 문자열
//  - 그 외 문자는 리터럴(정규식 특수문자는 이스케이프)
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
    } else if (glob[i] === '*') {
      re += '[^/]*';
    } else {
      re += escapeGlobChar(glob[i]);
    }
  }
  return new RegExp('^' + re + '$');
}

function main() {
  const { base, head } = parseArgs(process.argv.slice(2));

  const patterns = extractPathPatterns(getWorkflowTextAtHead(head));
  if (patterns.length === 0) {
    console.error(
      '[check-db-reseed-paths] 경고: db-reseed.yml에서 paths: 항목을 하나도 못 찾았습니다. ' +
        '워크플로우 구조가 바뀌었을 수 있으니 이 스크립트의 extractPathPatterns()를 확인하세요.'
    );
    process.exitCode = 1;
    return;
  }

  const regexes = patterns.map(globToRegExp);
  const addedFiles = getAddedFiles(base, head);

  const watchedAdded = addedFiles.filter((f) => WATCHED_DIRS.some((dir) => f.startsWith(dir)));
  const uncovered = watchedAdded.filter((f) => !regexes.some((re) => re.test(f)));

  console.log(`[check-db-reseed-paths] db-reseed.yml paths 필터: ${JSON.stringify(patterns)}`);
  console.log(
    `[check-db-reseed-paths] 대상 디렉토리(${WATCHED_DIRS.join(', ')}) 아래 새로 추가된 파일: ${watchedAdded.length}개`
  );

  if (uncovered.length === 0) {
    console.log('[check-db-reseed-paths] OK — 새로 추가된 파일이 모두 paths 필터에 걸립니다.');
    return;
  }

  console.error('');
  console.error(
    '[check-db-reseed-paths] 다음 새 파일(들)이 .github/workflows/db-reseed.yml 의 paths: ' +
      '필터에 걸리지 않는 것 같습니다 — 재시딩 파이프라인이 이 변경으로 자동 트리거되지 ' +
      '않을 수 있습니다:'
  );
  for (const f of uncovered) console.error(`  - ${f}`);
  console.error('');
  console.error(
    '이게 의도한 것이라면(예: 자동 재시딩 대상이 아닌 데이터) 무시해도 되지만, 그렇지 ' +
      '않다면 db-reseed.yml의 paths: 목록을 업데이트하세요.'
  );

  process.exitCode = 1;
}

main();
