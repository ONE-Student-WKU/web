const path = require('path');
const Sentry = require('@sentry/node');

// app.js보다 먼저 require돼야 한다(Sentry 공식 가이드) — 그래야 이후에 require되는
// 모듈들의 계측이 제대로 걸린다. 루트 .env 로드도 app.js와 동일한 이유로 여기서 한 번
// 더 해준다: npm workspace로 실행하면 cwd가 server/로 바뀌어 기본 dotenv 탐색이
// 리포지토리 루트의 .env를 못 찾는다.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// SENTRY_DSN을 안 채워도(로컬 개발 등) Sentry SDK가 조용히 아무 것도 안 보내는 채로
// 초기화만 된다 — 에러를 던지지 않으므로 별도 if 분기 없이 항상 호출해도 안전하다.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  // 요청 트레이싱(APM)까지는 지금 스코프 밖 — "에러가 나면 알 수 있게" 하는 게 목적이라
  // tracesSampleRate는 설정하지 않는다(설정 시 매 요청마다 성능 데이터까지 보내게 됨).
});

module.exports = Sentry;
