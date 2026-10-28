const path = require('path');

// server/db.js는 dotenv를 직접 로드하지 않고 호출자(app.js/instrument.js)가 이미
// 로드해뒀다고 가정한다 — 테스트는 그 호출자를 거치지 않으므로 여기서 직접 로드한다.
// npm test/워크스페이스 실행 시 cwd가 server/로 바뀌므로 루트 .env를 절대경로로 지정한다.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

// 로컬 .env에 Discord 웹훅 주소가 있어도 테스트(문의·글·신고 라우트)가 실제 채널에 알림을 보내지 않게 한다(adminAlertService.js).
process.env.DISCORD_WEBHOOK_URL = '';
process.env.DISCORD_MENTION_USER_ID = '';
// 같은 이유로 AI 키도 비운다 — 글·신고·문의를 만드는 라우트 테스트가 뒤에서 실제 AI 사전 분류(moderationLabelService.js)를 부르지 않게.
// AI를 쓰는 테스트는 aiClient를 mock하고, 분류 테스트(moderationLabel.test.js)는 가짜 키를 직접 넣는다.
process.env.AI_API_KEY = '';
