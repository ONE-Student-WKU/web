/**
 * y축 최댓값을 1·2·5 × 10^n 중 가장 가까운 큰 값으로 올린다(눈금이 깔끔한 숫자로 떨어지게). 데이터가 적어도 최소 4까지 보여
 * 한두 건짜리 막대가 꽉 차 보이지 않게 한다.
 */
export function niceMax(max) {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}
