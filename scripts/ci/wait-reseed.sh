#!/usr/bin/env bash
# scripts/ci/wait-reseed.sh
# 재시딩 크론(Railway)이 끝날 때까지 로그를 다시 받아 보며 기다리고, 성공·실패를 종료 코드로 알린다(.github/workflows/db-reseed.yml).
#
# 왜 필요한가: CI처럼 터미널이 아닌 곳에서 `railway logs`는 실시간으로 따라가지 않고 "그 순간까지의 로그"만 받고 끝난다.
# 예전 워크플로는 크론 시작 직후 한 번만 받아서 몇 줄만 남기고 항상 성공으로 끝났고, 개설과목 단계 실패로 규정 재임베딩이
# 2026-10-13부터 멈춘 사실이 세 번 연속 "success"로 가려졌다(#376, #378).
#
# 판단(크론 명령은 저장소 밖 Railway 설정에 있어서, 각 시딩 스크립트가 찍는 문구로 본다):
#  - 실패: 어떤 단계든 "…실패:"(시딩 실패:, 규정 시딩 실패:, [db:migrate] 실패: 등) 또는 npm의 "npm error"가 보이면 → 종료 코드 1
#  - 성공: "규정 임베딩 시딩 완료"가 보인 뒤, 뒤 단계가 실패하지 않는지 GRACE_POLLS번 더 확인하고 → 종료 코드 0
#  - 시간 초과: TIMEOUT_SECONDS 안에 둘 다 없으면 → 종료 코드 1
#
# 환경변수: RAILWAY_SERVICE(필수), LOG_FILE(기본 reseed.log), TIMEOUT_SECONDS(기본 3300), POLL_SECONDS(기본 30), GRACE_POLLS(기본 4),
#           RAILWAY_BIN(기본 railway — 테스트에서 가짜 명령으로 바꾼다)
set -uo pipefail

: "${RAILWAY_SERVICE:?RAILWAY_SERVICE가 필요합니다}"
LOG_FILE="${LOG_FILE:-reseed.log}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-3300}"
POLL_SECONDS="${POLL_SECONDS:-30}"
GRACE_POLLS="${GRACE_POLLS:-4}"
RAILWAY_BIN="${RAILWAY_BIN:-railway}"

SUCCESS_MARKER='규정 임베딩 시딩 완료'
FAILURE_PATTERN='실패:|npm error'

fetch_logs() {
  # --latest: 방금 `railway up`으로 만든 가장 새 배포(아직 실행 중이어도). --lines: 받아올 줄 수(지정하면 스트리밍하지 않고 받고 끝난다).
  "$RAILWAY_BIN" logs --service "$RAILWAY_SERVICE" --latest --lines 5000 > "$LOG_FILE" 2>&1 || true
}

has_failure() { grep -Eq "$FAILURE_PATTERN" "$LOG_FILE"; }
has_success() { grep -Fq "$SUCCESS_MARKER" "$LOG_FILE"; }

start=$(date +%s)
grace_left=-1
while :; do
  fetch_logs
  if has_failure; then
    echo "::error::재시딩 크론에서 실패가 기록됐습니다(아래 줄)."
    grep -En "$FAILURE_PATTERN" "$LOG_FILE" | head -20
    exit 1
  fi
  if has_success; then
    if [ "$grace_left" -lt 0 ]; then
      grace_left=$GRACE_POLLS
      echo "규정 임베딩 완료를 확인했습니다. 뒤 단계가 실패하지 않는지 ${GRACE_POLLS}번 더 확인합니다."
    fi
    if [ "$grace_left" -eq 0 ]; then
      echo "재시딩 성공: 규정 임베딩 완료, 실패 기록 없음."
      exit 0
    fi
    grace_left=$((grace_left - 1))
  fi
  elapsed=$(( $(date +%s) - start ))
  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    echo "::error::${TIMEOUT_SECONDS}초 안에 '${SUCCESS_MARKER}'가 나오지 않았습니다. 크론 명령에 규정 단계가 있는지, 아직 실행 중인지 확인하세요."
    exit 1
  fi
  echo "기다리는 중… (${elapsed}초 경과, 로그 $(wc -l < "$LOG_FILE")줄)"
  sleep "$POLL_SECONDS"
done
