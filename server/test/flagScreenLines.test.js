const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { FLAG_CATALOG } = require('../services/regulationEngine/flags');

/**
 * server/test/flagScreenLines.test.js
 * 졸업요건 화면은 추정 사유를 사전(client/src/i18n/locales/*.js)의 grad.flag.<코드> 한 줄로 보여 준다. 엔진에 사유 코드를 새로 만들면
 * 화면용 짧은 문구도 ko·en 사전에 같이 넣어야 한다 — 빠지면 화면에 조문이 든 긴 서버 문장이 그대로(영어 모드에서도 한국어로) 보인다.
 * 화면 문구에는 조문 번호·이슈 번호를 넣지 않는다(근거는 인쇄본·챗봇이 설명한다).
 */

const locale = (lang) => import(pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'i18n', 'locales', `${lang}.js`)).href).then((m) => m.default);
const screenCodes = Object.keys(FLAG_CATALOG).filter((code) => FLAG_CATALOG[code][0] !== 'INFO');

test('화면에 뜨는 사유 코드마다 ko·en 짧은 문구가 있다', async () => {
  for (const lang of ['ko', 'en']) {
    const dict = await locale(lang);
    const missing = screenCodes.filter((code) => !dict[`grad.flag.${code}`]);
    assert.deepEqual(missing, [], `${lang} 사전에 없는 사유: ${missing.join(', ')}`);
  }
});

test('짧은 문구에는 조문·이슈 번호를 쓰지 않는다', async () => {
  const dict = await locale('ko');
  const cited = screenCodes.filter((code) => /제\s?\d+조|별표|#\d|DATA_AUDIT/.test(dict[`grad.flag.${code}`] || ''));
  assert.deepEqual(cited, []);
});
