/**
 * server/services/consent.js
 * 이용약관·개인정보 수집·이용 동의의 현재 버전.
 *
 * 로그인 폼의 필수 동의 체크(client/src/pages/Login.jsx)와 로그인 직후 동의 화면(ConsentGate)이 이 버전으로 동의를 받고,
 * 동의 시각과 버전을 students.consented_at / consent_version에 남긴다. 약관이나 개인정보처리방침을 의미 있게 고치면
 * 이 값을 올린다 — 그러면 이전 버전에 동의한 계정은 다음 접속 때 동의 화면을 한 번 더 본다(serializeStudent의 consentRequired).
 * client/src/utils/consent.js의 CONSENT_VERSION과 같은 값이어야 한다(서버는 클라이언트가 보낸 값이 같을 때만 동의로 인정한다).
 */
const CURRENT_CONSENT_VERSION = '2026-10-07';

function isCurrentConsent(version) {
  return version === CURRENT_CONSENT_VERSION;
}

module.exports = { CURRENT_CONSENT_VERSION, isCurrentConsent };
