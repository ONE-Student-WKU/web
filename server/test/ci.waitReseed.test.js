const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * server/test/ci.waitReseed.test.js
 * 재시딩 크론 대기 스크립트(scripts/ci/wait-reseed.sh)가 성공·실패·시간 초과를 종료 코드로 구분하는지 확인한다(#378).
 * 진짜 Railway 대신, 부를 때마다 준비한 로그를 차례로 돌려주는 가짜 `railway` 명령을 쓴다(네트워크·토큰 불필요).
 */

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'ci', 'wait-reseed.sh');

// snapshots[i] = i번째로 로그를 받았을 때의 전체 로그(크론이 진행되며 줄이 늘어난다). 마지막 것은 이후 호출에도 계속 돌려준다.
function run(snapshots, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wait-reseed-'));
  snapshots.forEach((text, i) => fs.writeFileSync(path.join(dir, `log${i}.txt`), text));
  const fake = path.join(dir, 'railway');
  fs.writeFileSync(
    fake,
    [
      '#!/usr/bin/env bash',
      `dir="${dir.replace(/\\/g, '/')}"`,
      'n=$(cat "$dir/count" 2>/dev/null || echo 0)',
      `last=${snapshots.length - 1}`,
      'i=$(( n < last ? n : last ))',
      'echo $((n + 1)) > "$dir/count"',
      'cat "$dir/log$i.txt"',
    ].join('\n'),
    { mode: 0o755 }
  );
  const res = spawnSync('bash', [SCRIPT.replace(/\\/g, '/')], {
    env: {
      ...process.env,
      RAILWAY_SERVICE: 'reseed-test',
      RAILWAY_BIN: fake.replace(/\\/g, '/'),
      LOG_FILE: path.join(dir, 'reseed.log').replace(/\\/g, '/'),
      POLL_SECONDS: '0',
      GRACE_POLLS: '2',
      TIMEOUT_SECONDS: '3600',
      ...env,
    },
    encoding: 'utf8',
  });
  const calls = Number(fs.readFileSync(path.join(dir, 'count'), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: res.status, out: `${res.stdout}${res.stderr}`, calls };
}

const START = ['Starting Container', '[db:migrate] 완료 — 모든 테이블이 최신 상태입니다.', 'npm warn config production Use `--omit=dev` instead.', 'departments: 126건 처리'].join('\n');
const OFFERINGS_OK = `${START}\ncourse_offerings 시딩 완료`;
const REGULATIONS_OK = `${OFFERINGS_OK}\n[OK] 등록금과 장학금: 10개 청크\n규정 임베딩 시딩 완료 (정리 문서 900청크, 원문 400청크)`;

test('규정 임베딩 완료가 나오고 뒤 단계 실패가 없으면 성공(0) — 진행 중인 로그는 기다린다', () => {
  const r = run([START, OFFERINGS_OK, REGULATIONS_OK]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /재시딩 성공/);
  assert.ok(r.calls >= 5, `완료 뒤에도 몇 번 더 확인해야 한다(호출 ${r.calls}번)`);
});

test('10/13~10/15의 실제 증상: 개설과목 단계가 실패하면 규정 단계 전이라도 실패(1)', () => {
  const failed = `${START}\n시딩 실패: Error: Duplicate entry '2026-3-006128-...' for key 'course_offerings.uq_course_offerings'\nnpm error Lifecycle script \`seed:course-offerings\` failed with error:`;
  const r = run([START, failed]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /실패가 기록됐습니다/);
  assert.match(r.out, /Duplicate entry/);
});

test('규정 임베딩은 끝났지만 그 뒤 단계가 실패하면 실패(1)', () => {
  const later = `${REGULATIONS_OK}\n시딩 실패: Error: something`;
  const r = run([REGULATIONS_OK, later]);
  assert.equal(r.code, 1, r.out);
});

test('규정 임베딩 완료가 끝내 나오지 않으면 시간 초과로 실패(1) — 크론 명령에 규정 단계가 없을 때', () => {
  const r = run([OFFERINGS_OK], { TIMEOUT_SECONDS: '0' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /나오지 않았습니다/);
});

test('npm warn 같은 경고나 [db:migrate] 안내는 실패로 보지 않는다', () => {
  const r = run([`${START}\n[db:migrate] students.name 중복이 2개 있어 uq_students_name 제약을 건너뜁니다(닉네임 값은 개인정보라 출력하지 않음).\n규정 임베딩 시딩 완료 (정리 문서 1청크, 원문 1청크)`]);
  assert.equal(r.code, 0, r.out);
});
