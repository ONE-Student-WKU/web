/**
 * sessionCache.js
 * Home/GraduationStatus/CourseManagement/Community가 쓰는 모듈 스코프 캐시를
 * sessionStorage에도 같이 저장한다. 모듈 스코프 캐시만으로는 SPA 내 화면 전환에서만
 * 효과가 있고, 탭이 살아있는 채로 페이지가 다시 로드되는 경우(모바일에서 오래 백그라운드에
 * 있다가 돌아와 브라우저가 조용히 다시 로드하는 경우, PC에서 새로고침하는 경우 등)엔
 * 캐시가 통째로 사라져 매번 처음부터 로딩 화면을 보게 된다 — sessionStorage는 탭이 닫히기
 * 전까지 유지되므로 이 경우에도 마지막으로 본 값을 즉시 보여줄 수 있다.
 *
 * 시크릿 모드 등에서 접근이 막힐 수 있어 모든 호출을 try/catch로 감싼다 — 실패해도
 * 캐시가 없는 것과 동일하게(처음부터 로딩) 동작하면 되므로 에러를 삼켜도 안전하다.
 */
const PREFIX = 'wku_cache_';

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 저장 실패(용량 초과, 시크릿 모드 등)해도 무시 — 모듈 스코프 캐시는 정상 동작하므로
    // 이번 세션 내 SPA 화면 전환에는 지장 없다.
  }
}

function clearCache(key) {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

export { readCache, writeCache, clearCache };
