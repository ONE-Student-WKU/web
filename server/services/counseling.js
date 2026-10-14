/**
 * server/services/counseling.js
 * 졸업인증제의 자기계발심층상담 기준(학생별). 이 서비스는 이수 여부를 판정하지 않고 기준과 확인 경로만 안내한다(DECISIONS D-65).
 * 상담 기록은 웹정보서비스(로그인 후) 상담관리 > 지도교수 상담 > 상담일지(오프라인)에만 있고, 그 화면은 읽지 않는다.
 * 세는 방법(학기마다 1회인지 합계 횟수인지, 휴학 학기)은 학사지원과에 문의 중이다(후속 문의 B-5, 2026-10-14) — 답이 오면
 * 학생 입력(학기별 체크 또는 횟수)과 판정을 붙인다(#367 3번).
 *
 * 기준(2026 책자 17·18·21쪽, 학교 홈페이지 학사학위수여): 2020학번부터 8학기(회) 이상, 2016~2019학번 6학기(회) 이상,
 * 편입생 3회 이상, 전과생은 당초 입학 학번을 따른다. 광역단위 계열전공은 Hug 심층진로상담으로 대체한다.
 * 화면(client GraduationStatus)과 챗봇(aiClient.buildGraduationStatusNote)이 이 결과 하나를 같이 쓴다.
 */

function counselingRequirement(student) {
  if (!student || !student.admission_year) return null;
  const isTransfer = student.enrollment_type === 'TRANSFER_ADMISSION';
  const cohort = isTransfer ? 'TRANSFER' : student.admission_year >= 2020 ? 'FROM_2020' : 'BEFORE_2020';
  const required = cohort === 'TRANSFER' ? 3 : cohort === 'FROM_2020' ? 8 : 6;
  const departmentName = student.department_name || '';
  return {
    required,
    cohort,
    replacement: departmentName.endsWith('계열') ? 'HUG' : null,
    // 세는 방법이 학교 확인 전이라 판정하지 않는다.
    judged: false,
  };
}

module.exports = { counselingRequirement };
