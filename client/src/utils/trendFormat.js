// 관리자 추이 그래프(AdminTrendView·TrendChart)의 시간·날짜 표시 규칙. 서버 getTrend의 점(at)을 사람이 읽는 글자로 바꾼다.
// - 시간 단위(24h): at이 구간 시작 시각(ISO)이라 보는 사람의 시계(로컬 시)로 읽는다.
// - 일 단위(30d·1y·all): at이 한국 날짜 'YYYY-MM-DD'라 시간대 변환 없이 그대로 읽는다.

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 막대가 이 개수 이하면 막대 그래프, 넘으면 선(면적) 그래프 — 막대 폭이 3px 밑으로 가늘어지기 전까지만 막대를 쓴다.
export const MAX_BAR_POINTS = 62;

function parseDay(at) {
  const [y, m, d] = at.split('-').map(Number);
  return { y, m, d, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

/** 읽는 줄·표·화면 낭독에 쓰는 한 점의 이름. 마지막 점은 아직 끝나지 않은 구간이라 표시한다. */
export function pointLabel(point, unit, isLast) {
  if (unit === 'hour') {
    const from = new Date(point.at).getHours();
    return `${from}시~${(from + 1) % 24}시${isLast ? ' (진행 중)' : ''}`;
  }
  const { y, m, d, weekday } = parseDay(point.at);
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} (${weekday})${isLast ? ' (오늘)' : ''}`;
}

/**
 * x축에 글자를 쓸 점의 위치와 글자. 글자끼리 겹치지 않게 개수를 제한한다.
 * - 시간 단위: 6시간마다 + 마지막.
 * - 일 단위 62일 이하: 마지막 날에서 거꾸로 7일(2주 이하로 짧으면 2일)마다, 'M/D'.
 * - 일 단위 62일 초과: 매달 1일, 'YY.M'. 6개를 넘으면 건너뛰며 줄인다.
 */
export function axisTicks(points, unit) {
  const last = points.length - 1;
  if (unit === 'hour') {
    const ticks = [];
    for (let i = 0; i <= last; i += 6) ticks.push({ index: i, label: `${new Date(points[i].at).getHours()}시` });
    if (last % 6 !== 0) ticks.push({ index: last, label: `${new Date(points[last].at).getHours()}시` });
    return ticks;
  }
  if (points.length <= MAX_BAR_POINTS) {
    const step = points.length <= 14 ? 2 : 7;
    const ticks = [];
    for (let i = last; i >= 0; i -= step) {
      const { m, d } = parseDay(points[i].at);
      ticks.unshift({ index: i, label: `${m}/${d}` });
    }
    return ticks;
  }
  const monthStarts = [];
  points.forEach((p, i) => {
    const { y, m, d } = parseDay(p.at);
    if (d === 1) monthStarts.push({ index: i, label: `${String(y).slice(2)}.${m}` });
  });
  const skip = Math.ceil(monthStarts.length / 6);
  return monthStarts.filter((_, i) => i % skip === 0);
}
