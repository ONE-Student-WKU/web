/**
 * server/services/searchAliases.js
 * 과목 검색용 약칭·표기 차이 사전 — 학생들이 실제로 쓰는 줄임말이나 흔한 표기 차이를 정식 과목명 조각으로 바꿔 준다.
 * 검색어가 약칭으로 "시작"할 때만 적용한다(예: "기연프", "기연프1" → "기업연계프로젝트1"). 중간 일치까지 받으면 "os" 같은
 * 짧은 약칭이 다른 단어에 걸리기 쉽다.
 *
 * 새 약칭이 필요하면 여기에 추가한다. 키는 normalizeForSearch를 거친 모양(공백·문장부호 없음, 소문자)이어야 한다.
 * 값은 정식 과목명의 "일부"여도 된다 — 검색은 부분 일치다. 서로 다른 과목과 헷갈릴 여지가 있는 약칭은 넣지 않는다.
 * (courseNameMatch.js의 KNOWN_COURSE_ALIASES는 졸업요건 매칭용 별도 목록이다.)
 */

const COURSE_SEARCH_ALIASES = {
  기연프: '기업연계프로젝트',
  종설: '종합설계',
  알고리듬: '알고리즘',
  디비: '데이터베이스',
  운체: '운영체제',
  os: '운영체제',
  컴네: '컴퓨터네트워크',
  컴구: '컴퓨터구조',
  자구: '자료구조',
  이산: '이산수학',
  선대: '선형대수',
  미적: '미적분',
};

/**
 * 정규화된 검색어가 약칭으로 시작하면, 그 약칭을 정식 표기로 바꾼 검색어 목록을 돌려준다(없으면 빈 배열).
 * 약칭 뒤에 붙은 글자는 그대로 이어 붙는다 — "기연프2" → "기업연계프로젝트2".
 */
function expandAliases(normalizedQuery, aliases = COURSE_SEARCH_ALIASES) {
  const out = [];
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (normalizedQuery.startsWith(alias)) out.push(canonical + normalizedQuery.slice(alias.length));
  }
  return out;
}

module.exports = { COURSE_SEARCH_ALIASES, expandAliases };
