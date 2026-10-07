import React from 'react';
import { IconChevronLeft } from '../components/icons.jsx';

/**
 * Terms of Service Page — 이용약관. Google OAuth 동의 화면/앱 검증 제출용이기도 하다.
 *
 * PrivacyPolicy.jsx와 동일하게 로그인 상태와 무관하게 접근 가능해야 한다.
 *
 * 2026-10-07 전면 개정: 이메일 인증코드 로그인, 커뮤니티(승인·신고·제재), 이용 한도, AI 답변의 한계처럼 서비스가
 * 실제로 하는 일에 맞췄다. 정식 법률 검토를 거친 문서는 아니므로 사용자가 늘기 전에 팀 검토를 거칠 것.
 * 의미 있게 고치면 동의 버전을 같이 올려야 한다 — CLAUDE.md "약관·개인정보 동의" 참고
 * (server/services/consent.js, client/src/utils/consent.js).
 * 법적 문서라 아직 번역하지 않고 한국어로만 제공한다.
 */
const CONTACT_EMAIL = 'sicnro3241@gmail.com';

function TermsOfService({ onGoBack }) {
  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoBack} aria-label="뒤로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">이용약관</span>
        </div>
      </header>

      <div className="courses-body">
        <p className="settings-field-hint">시행일: 2026년 10월 7일</p>

        <section className="home-card">
          <p className="home-card-label">1. 서비스 소개</p>
          <p className="settings-field-hint">
            ONE Student(이하 "서비스")는 원광대 학생이 입학부터 졸업까지 학업과 진로를 챙길 수 있도록 만든 학생 생활
            통합 서비스입니다. 졸업요건 진단, 수강 이력과 시간표 관리, 학사 규정 챗봇, 진로 탐색, 스터디·프로젝트
            커뮤니티, 문의하기를 제공합니다. 서비스는 학생들이 만든 프로젝트이며 원광대학교의 공식 서비스가
            아닙니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">2. 계정과 로그인</p>
          <p className="settings-field-hint">
            · Google 계정 또는 이메일 인증코드로 로그인할 수 있습니다. 이메일 인증코드는 이용자가 직접 사용하는 본인의
            이메일로만 받아야 합니다.
            <br />· 로그인하려면 이 약관과 개인정보처리방침에 동의해야 합니다. 약관이나 방침이 크게 바뀌면 다시 동의를
            요청하며, 동의하지 않으면 서비스를 이용할 수 없습니다.
            <br />· 만 14세 이상만 이용할 수 있습니다.
            <br />· 계정은 본인만 이용해야 하며, 계정에 담긴 정보(수강 이력, 대화 기록 등)의 관리 책임은 이용자 본인에게
            있습니다.
            <br />· 계정 삭제는 계정 메뉴의 "계정 정보 수정"에서 언제든 할 수 있고, 삭제하면 관련 정보가 즉시 삭제되어
            복구할 수 없습니다. 삭제되는 정보의 범위는 개인정보처리방침에 적혀 있습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">3. 서비스 이용과 정보의 한계</p>
          <p className="settings-field-hint">
            · 졸업요건 진단, 수강 정보, 챗봇과 진로 탐색의 답변은 참고용이며 학교의 공식 학사 안내를 대체하지
            않습니다. 실제 졸업요건, 수강신청, 학적 처리는 반드시 학교의 공식 시스템과 학과 사무실에서 최종
            확인해야 합니다.
            <br />· 챗봇과 진로 탐색의 답변은 AI가 만들기 때문에 틀리거나 최신 규정을 반영하지 못할 수 있습니다. 규정
            자료가 없거나 불확실한 경우 서비스는 "추정" 또는 "확인 필요"로 표시하며, 이런 표시가 있는 내용은 확정으로
            받아들이지 마세요.
            <br />· 졸업요건 진단은 이용자가 입력한 학과, 학번, 수강 이력을 기준으로 계산하므로, 입력이 실제와 다르면
            결과도 달라집니다.
            <br />· 비용과 안정성을 위해 챗봇 하루 질문 수, 성적표 가져오기 횟수 등에 이용 한도를 둘 수 있습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">4. 이용자의 의무와 금지 행위</p>
          <p className="settings-field-hint">
            다음 행위는 할 수 없습니다.
            <br />· 타인의 계정이나 이메일을 도용하는 행위
            <br />· 실제와 다른 학적, 성적, 수강 정보를 입력해 다른 사람을 속이려는 행위
            <br />· 자동화된 방법으로 과도하게 요청하거나, 이용 한도를 우회하거나, 서비스의 정상 운영을 방해하는 행위
            <br />· 서비스의 보안 취약점을 악용하거나 다른 이용자의 정보에 접근하려는 행위
            <br />· 관련 법령을 위반하는 행위
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">5. 커뮤니티 이용 규칙</p>
          <p className="settings-field-hint">
            · 커뮤니티는 스터디와 프로젝트 팀원을 구하는 공간입니다. 글은 작성하면 운영자의 승인을 받은 뒤에 공개되며,
            승인되지 않거나 반려될 수 있습니다.
            <br />· 다음 내용은 올릴 수 없습니다: 욕설·비방·차별 표현, 광고와 홍보, 허위 정보, 자신이나 타인의 개인정보
            (실명, 전화번호 등), 불법 정보, 모집과 관계없는 글
            <br />· 문제가 있는 글이나 신청 메시지는 신고할 수 있습니다. 운영자는 신고 내용을 확인해 글을 삭제하거나
            이용자에게 글쓰기·신청 제한 또는 커뮤니티 이용 정지(기간 또는 영구)를 줄 수 있으며, 제재할 때는 사유를
            안내합니다.
            <br />· 신청이 수락되면 서로의 실제 이메일 대신 중계 이메일 주소가 전달됩니다. 이후 연락과 모임에서 생기는
            일은 당사자들이 책임지며, 개인정보나 금전을 요구받으면 응하지 말고 신고해 주세요.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">6. 게시물과 입력 정보의 권리</p>
          <p className="settings-field-hint">
            이용자가 쓴 글, 신청 메시지, 문의 내용의 권리는 이용자에게 있습니다. 다만 서비스를 운영하기 위해 필요한
            범위(게시, 승인 심사, 신고와 문의 처리)에서는 서비스가 이를 이용할 수 있습니다. 계정을 삭제하면 이용자의 글과
            신청은 함께 삭제됩니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">7. 서비스의 변경과 중단</p>
          <p className="settings-field-hint">
            서비스는 학생들이 운영하는 프로젝트라 기능이 바뀌거나 일부 또는 전체가 중단될 수 있습니다. 가능하면
            서비스 안에서 미리 알리겠지만, 서버 점검이나 장애처럼 불가피한 경우에는 사전 공지 없이 중단될 수
            있습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">8. 책임의 한계</p>
          <p className="settings-field-hint">
            서비스는 정보의 정확성을 위해 노력하지만 완전성을 보장하지 않습니다. 관련 법령이 허용하는 범위에서, 서비스의
            정보를 믿고 행동해서 생긴 불이익(수강신청 누락, 졸업 지연 등), 이용 중단으로 생긴 손해, 이용자 사이의 연락과
            모임에서 생긴 분쟁에 대해 서비스는 책임지지 않습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">9. 약관의 변경과 문의</p>
          <p className="settings-field-hint">
            약관은 필요하면 바뀔 수 있습니다. 중요한 내용이 바뀌면 서비스 안에서 알리고 다시 동의를 받습니다. 이 약관은
            대한민국 법령에 따라 해석됩니다.
          </p>
          <p className="settings-field-hint">
            문의: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
          <p className="settings-field-hint">
            · 2026년 10월 7일: 이메일 인증코드 로그인, 커뮤니티 이용 규칙, AI 답변의 한계, 이용 한도를 포함해 현재
            서비스에 맞게 전면 개정
            <br />· 2026년 9월 7일: 최초 시행(Google 로그인만 지원하던 시기)
          </p>
        </section>
      </div>
    </div>
  );
}

export default TermsOfService;
