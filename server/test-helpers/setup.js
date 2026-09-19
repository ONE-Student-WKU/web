const path = require('path');

// server/db.js는 dotenv를 직접 로드하지 않고 호출자(app.js/instrument.js)가 이미
// 로드해뒀다고 가정한다 — 테스트는 그 호출자를 거치지 않으므로 여기서 직접 로드한다.
// npm test/워크스페이스 실행 시 cwd가 server/로 바뀌므로 루트 .env를 절대경로로 지정한다.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
