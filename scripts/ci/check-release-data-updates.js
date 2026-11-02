#!/usr/bin/env node
/**
 * scripts/ci/check-release-data-updates.js
 * main으로 올리는 릴리스 PR에서 "바뀐 자료 알림"의 갱신 기록(server/services/dataUpdates.js)이 제대로 들어갔는지 본다.
 * 날짜는 main에 반영되는 날(KST)이라, develop에서 미리 적은 날짜가 릴리스 때 이미 지나 있는 경우가 있었다(#485: 10-29로 적고 11-03 반영).
 *
 *  - 실패: 이번 릴리스로 새로 들어가는 항목(main에 없는 date·note 쌍)의 날짜가 오늘(KST)보다 앞서거나 형식이 틀림
 *  - 경고(실패 아님): 학생 진단 결과를 바꿀 수 있는 파일(규정·교육과정 문서, 요건 시드, 진단 규칙)이 바뀌었는데 새 항목이 없음 —
 *    결과가 바뀌지 않는 변경(문구만 등)일 수 있어 사람이 판단한다(CLAUDE.md "배포·DB 재시딩")
 * 검사는 PR을 열거나 갱신할 때 돈다. 머지가 날짜를 넘기면 Actions에서 다시 돌리고(Re-run), 실패하면 날짜를 반영일로 고친다.
 *
 * 사용: node scripts/ci/check-release-data-updates.js [기준 ref, 기본 origin/main]
 *   환경변수 TODAY=YYYY-MM-DD로 오늘을 바꿔 볼 수 있다(테스트용).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FILE = 'server/services/dataUpdates.js';
// 학생의 졸업요건 진단 결과를 바꿀 수 있는 경로(CLAUDE.md: 규정·교육과정 문서, 요건 시드, graduationService·regulationEngine).
const RESULT_PATHS = [
  /^db\/regulations\//,
  /^db\/curriculum\//,
  /^db\/seed\/[^/]+\.json$/,
  /^db\/regulation-engine\//,
  /^server\/services\/graduationService\.js$/,
  /^server\/services\/regulationEngine\//,
];

/** KST 기준 오늘 'YYYY-MM-DD'. */
function todayKst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 순수 함수 — 기준(main)과 이번 릴리스의 갱신 기록을 비교한다.
 * @param {{ base: {date, note}[], head: {date, note}[], today: string, changedFiles?: string[] }} input
 * @returns {{ added: {date, note}[], errors: string[], warnings: string[] }}
 */
function checkReleaseDataUpdates({ base, head, today, changedFiles = [] }) {
  const key = (u) => `${u.date}|${u.note}`;
  const baseKeys = new Set(base.map(key));
  const added = head.filter((u) => !baseKeys.has(key(u)));
  const errors = [];
  for (const u of added) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date || '')) errors.push(`날짜 형식이 'YYYY-MM-DD'가 아니에요: '${u.date}' (${u.note})`);
    else if (u.date < today) errors.push(`이미 지난 날짜예요: ${u.date} < 오늘 ${today} — main 반영일로 고쳐 주세요 (${u.note})`);
  }
  const warnings = [];
  const resultFiles = changedFiles.filter((f) => RESULT_PATHS.some((re) => re.test(f)));
  if (added.length === 0 && resultFiles.length > 0) {
    warnings.push(`진단 결과를 바꿀 수 있는 파일이 바뀌었는데 새 갱신 기록이 없어요(${resultFiles.length}개, 예: ${resultFiles.slice(0, 3).join(', ')}). 결과가 바뀌면 ${FILE}에 한 줄 추가해 주세요.`);
  }
  return { added, errors, warnings };
}

// 그 ref의 dataUpdates.js를 임시 파일로 꺼내 DATA_UPDATES를 읽는다(파일이 다른 모듈을 require하지 않는다).
function loadAt(ref) {
  let src;
  try {
    src = execFileSync('git', ['show', `${ref}:${FILE}`], { encoding: 'utf8' });
  } catch {
    return []; // 기준 브랜치에 아직 파일이 없으면 모든 항목이 새 항목이다
  }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'data-updates-')), 'dataUpdates.js');
  fs.writeFileSync(tmp, src);
  return require(tmp).DATA_UPDATES;
}

function main() {
  const baseRef = process.argv[2] || 'origin/main';
  const today = process.env.TODAY || todayKst();
  const base = loadAt(baseRef);
  const head = require(path.resolve(__dirname, '..', '..', FILE)).DATA_UPDATES;
  const changedFiles = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const { added, errors, warnings } = checkReleaseDataUpdates({ base, head, today, changedFiles });

  console.log(`기준 ${baseRef}, 오늘(KST) ${today}, 이번 릴리스의 새 갱신 기록 ${added.length}개`);
  for (const u of added) console.log(`  - ${u.date} ${u.note}`);
  for (const w of warnings) console.log(`::warning title=바뀐 자료 알림 갱신 기록::${w}`);
  for (const e of errors) console.log(`::error title=바뀐 자료 알림 갱신 날짜::${e}`);
  if (errors.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { checkReleaseDataUpdates, todayKst, RESULT_PATHS };
