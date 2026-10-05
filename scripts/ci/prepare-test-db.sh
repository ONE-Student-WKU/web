#!/usr/bin/env bash
# scripts/ci/prepare-test-db.sh
# 서버 테스트(npm test --workspace=server)가 전제하는 DB 상태를 빈 MySQL에서 만든다 — CI와 로컬 검증이 같은 절차를 쓴다.
#
# 왜 필요한가: 서버 테스트 상당수는 시드된 DB(학과·교육과정·변경 이력·규정 조문)를 읽는다(R-12). 이 절차는
#  - 시크릿이 필요 없다: 규정 임베딩만 결정적 가짜로 바꾼 래퍼(seed-regulations-stub.js)를 쓴다
#  - 운영 시드 크론과 같은 스크립트를 쓰되 가짜 학생 계정(seed.js 전체)은 만들지 않는다
#  - 로컬/CI DB에서만 돈다(DB_HOST가 localhost/127.0.0.1이 아니면 거부)
# 환경변수: DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME (server/db.js와 같은 이름)
set -euo pipefail

HOST="${DB_HOST:-localhost}"
case "$HOST" in
  localhost|127.0.0.1|::1) ;;
  *) echo "[prepare-test-db] DB_HOST=$HOST — 로컬/CI DB에서만 실행할 수 있어요. 중단합니다." >&2; exit 1 ;;
esac

cd "$(dirname "$0")/../.."
run() { echo "▶ $*"; "$@"; }

# 1) 스키마(멱등). 주의: db/schema.sql이 "CREATE DATABASE wku_ai_chat; USE wku_ai_chat;"를 고정하고 있어 migrate.js는 DB_NAME과
#    상관없이 wku_ai_chat에 적용된다 — CI 서비스 DB 이름을 wku_ai_chat으로 맞춘다. 다른 이름의 DB에서 이 절차를 시험할 때만
#    SKIP_MIGRATE=1로 건너뛰고 스키마를 직접 적용한다(로컬 검증용).
if [ "${SKIP_MIGRATE:-}" != "1" ]; then
  run node db/migrate.js
fi

# 2) 기준 데이터: 학과·졸업요건 + 기본 시드 학생 2명(hong/kim) + 학과별 교육과정.
#    seed.js 전체를 쓰는 이유: 일부 테스트(courseService.ownership, pdfImportQuota)가 student_id=1·2의 시드 학생을 전제로 한다.
#    ⚠ seed.js는 가짜 학생 계정을 만든다 — 운영에서는 절대 실행 금지(db-reseed.yml 머리 주석). 이 스크립트는 위의 DB_HOST 가드로
#    로컬/CI DB에서만 돈다. 시드는 학생 ID가 1·2가 되도록 테스트보다 먼저(깨끗한 DB에서) 실행해야 한다.
run npm run seed --workspace=server --silent
run npm run seed:curriculum --workspace=server --silent
for y in 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026; do
  run npm run "seed:curriculum-$y" --workspace=server --silent
done
run npm run seed:linked-majors --workspace=server --silent

# 3) 학과 계보 → 교육과정 변경 이력(계보가 있어야 개편 학과 변경이 올바르게 기록된다)
run npm run seed:lineage --workspace=server --silent
run npm run generate:curriculum-changes --workspace=server --silent

# 4) 개설 과목, 규정 원문 청크(가짜 임베딩), 규정 조문·적용범위
run npm run seed:course-offerings --workspace=server --silent
run node scripts/ci/seed-regulations-stub.js
run npm run seed:regulation-articles --workspace=server --silent

echo "✔ 테스트 DB 준비 완료 (${DB_NAME:-wku_ai_chat})"
