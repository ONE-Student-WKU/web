/**
 * client/src/utils/consent.js
 * 이용약관·개인정보 수집·이용 동의의 현재 버전과, 이 브라우저에서 이미 동의했는지의 기억.
 *
 * CONSENT_VERSION은 server/services/consent.js의 CURRENT_CONSENT_VERSION과 같은 값이어야 한다 — 서버는 이 값이 같을 때만
 * 동의로 인정한다. 약관이나 방침을 의미 있게 고치면 두 값을 같이 올린다(올리면 이미 동의한 사람도 다시 동의 화면을 본다).
 */
export const CONSENT_VERSION = '2026-10-26';

const STORAGE_KEY = 'consent_version';

// 이 브라우저에서 현재 버전에 이미 동의했는지 — 다시 로그인할 때마다 같은 체크를 반복하지 않게 하려는 편의일 뿐이고,
// 서버 기록(students.consent_version)을 대신하지 않는다. 버전이 올라가면 자동으로 해제된다.
export function readStoredConsent() {
  try {
    return localStorage.getItem(STORAGE_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function storeConsent(checked) {
  try {
    if (checked) localStorage.setItem(STORAGE_KEY, CONSENT_VERSION);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장소를 못 쓰는 환경 — 이번 방문 동안만 체크 상태가 유지된다.
  }
}

// 로그인 폼의 "[필수] 학교 공식 서비스가 아님" 확인 — 동의와 같은 이유로 이 브라우저에서 한 번 체크하면 기억한다.
// 서버 기록(students.unofficial_notice_at)을 대신하지 않는다.
const NOTICE_STORAGE_KEY = 'unofficial_notice_ack';

export function readStoredNoticeAck() {
  try {
    return localStorage.getItem(NOTICE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeNoticeAck(checked) {
  try {
    if (checked) localStorage.setItem(NOTICE_STORAGE_KEY, '1');
    else localStorage.removeItem(NOTICE_STORAGE_KEY);
  } catch {
    // 저장소를 못 쓰는 환경 — 이번 방문 동안만 체크 상태가 유지된다.
  }
}
