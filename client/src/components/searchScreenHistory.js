/**
 * 열려 있는 검색 화면(SearchScreen)을 히스토리째 닫는다 — 시스템 뒤로가기를 누른 것과 같다(popstate → SearchScreen의 onClose).
 * 부모가 검색 결과를 골라 다른 입력 단계로 넘어가는 경우처럼 스스로 검색 화면을 닫을 때 쓴다.
 */
export function closeSearchScreen() {
  if (window.history.state?.searchScreen) window.history.back();
}
