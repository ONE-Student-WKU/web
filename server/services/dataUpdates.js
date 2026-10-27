/**
 * server/services/dataUpdates.js
 * 학생의 졸업요건 진단 결과를 바꿀 수 있는 자료·규칙 갱신 기록. 바뀐 자료 알림(changeNoticeService.js)이
 * 학생이 마지막으로 확인한 날 이후의 항목을 "반영된 갱신" 목록으로 보여 준다.
 *
 * 규정·교육과정 문서, 요건 시드, 진단 규칙(graduationService·regulationEngine 등)을 고쳐 학생 결과가 달라질 수 있으면
 * 여기에 한 줄 추가한다. 날짜는 main에 반영되는 날(KST, 'YYYY-MM-DD'), note는 학생이 읽을 짧은 한 마디다
 * (예: '2027학년도 책자 반영', '교육혁신과 답변 반영'). 적지 않아도 알림은 뜨고, 목록만 비어 보인다.
 */
const DATA_UPDATES = [];

// sinceDate('YYYY-MM-DD') 이후(같은 날 포함) 항목을 날짜순으로. 같은 날 갱신이 기준을 맞춘 뒤였는지는 알 수 없어 포함한다.
function updatesSince(sinceDate, updates = DATA_UPDATES) {
  return updates.filter((u) => u.date >= sinceDate).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { DATA_UPDATES, updatesSince };
