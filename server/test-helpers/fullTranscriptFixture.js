/**
 * server/test-helpers/fullTranscriptFixture.js
 * "전체성적조회" 화면을 복사해 붙여넣은 텍스트의 테스트용 픽스처.
 *
 * 형식(학기 헤더 공백, 표 헤더 6칸, P 과목 평점 "0.0", 소계 2줄, 학기 사이 공백 줄, 페이지
 * 전체 선택 시 앞에 붙는 학생정보·버튼 텍스트)은 실제 붙여넣기 샘플(2026-09)을 그대로 따랐지만,
 * 과목명·학수번호·성적·학번·이름은 전부 지어낸 값이다 — 실제 성적 기록은 저장소에 넣지 않는다.
 */

const SEMESTERS = [
  {
    header: '2023 년   1 학기',
    rows: [
      ['교필', '009001', '가상교양과목가', '3.0', '4.0', 'A0'],
      ['교필', '009002', '가상패스과목', '1.0', '0.0', 'P'],
      ['기전', '900001', '가상전공과목A', '3.0', '3.5', 'B+'],
      ['교선', 'L09001', '가상Java실습', '2.0', '4.5', 'A+'],
    ],
    // P는 이수학점에 포함된다: 3 + 1 + 3 + 2
    subtotal: ['9.00', '3.93'],
  },
  {
    header: '2023 년   2 학기',
    rows: [
      ['기전', '900002', '가상전공과목B', '3.0', '4.5', 'A+'],
      ['선전', '900003', '가상전공과목C', '3.0', '0.0', 'F'],
      ['교선', 'L09002', '가상교양과목나', '2.0', '0.0', 'NP'],
      ['교기', 'L09003', '가상교양과목다', '3.0', '4.0', 'A0'],
    ],
    // F/NP는 제외: 3 + 3
    subtotal: ['6.00', '4.25'],
  },
];

const EXPECTED_ROW_COUNT = 8;
const EXPECTED_TOTAL_CREDITS = 15;

const FAKE_STUDENT_ID = '12345678';
const FAKE_STUDENT_NAME = '홍길동';

const PAGE_PREFIX = [
  '전체성적조회',
  '대 학 명\t가상대학\t학 과\t가상학과',
  `학 번\t${FAKE_STUDENT_ID}\t성 명\t${FAKE_STUDENT_NAME}`,
  ' 화면 출력  돌아가기',
].join('\n');

function buildTableText(semesters = SEMESTERS) {
  return semesters
    .map((s) =>
      [
        s.header,
        '이수구분\t학수번호\t교과목명\t학점\t평점\t점수',
        ...s.rows.map((r) => r.join('\t')),
        '취득학점\t평균평점',
        s.subtotal.join('\t'),
      ].join('\n')
    )
    .join('\n \n');
}

function buildFullPageText(semesters = SEMESTERS) {
  return `${PAGE_PREFIX}\n${buildTableText(semesters)}`;
}

module.exports = {
  SEMESTERS,
  EXPECTED_ROW_COUNT,
  EXPECTED_TOTAL_CREDITS,
  FAKE_STUDENT_ID,
  FAKE_STUDENT_NAME,
  buildTableText,
  buildFullPageText,
};
