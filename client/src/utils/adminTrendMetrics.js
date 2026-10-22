// 관리자 대시보드에서 추이 그래프로 볼 수 있는 지표. key는 서버(getTrend)가 구간별로 내려주는 필드 이름과 같다.
// 방문자는 하루 방문 기록(student_daily_visits)으로만 세서 하루 단위 기간에서만 볼 수 있다(dailyOnly).
export const TREND_METRICS = [
  { key: 'visitors', tab: '방문자', unit: '명', hint: '하루에 한 번이라도 접속한 사람 수예요. 방문 기록은 이 기능을 배포한 날부터 쌓여요.', dailyOnly: true },
  { key: 'signups', tab: '신규 가입', unit: '명', hint: '새로 가입한 계정 수예요.' },
  { key: 'chatQuestions', tab: '챗봇 질문', unit: '건', hint: 'AI 호출 비용(크레딧 소진 같은 일)을 미리 보는 신호예요.' },
  { key: 'chatNotFound', tab: '답 못 찾은 질문', unit: '건', hint: '근거 자료를 못 찾아 고정 안내로만 답한 횟수예요. 규정 문서가 모자란 곳을 찾는 신호예요.' },
];

// 추이 그래프의 기간. key는 서버(getTrend)의 range 값과 같다. 24시간은 1시간 단위, 나머지는 하루 단위다.
export const TREND_RANGES = [
  { key: '24h', tab: '24시간' },
  { key: '7d', tab: '7일' },
  { key: '30d', tab: '30일' },
  { key: '1y', tab: '1년' },
  { key: 'all', tab: '전체' },
];

// 처음 열었을 때의 기간 — 흐름이 보이는 30일.
export const DEFAULT_TREND_RANGE = '30d';
