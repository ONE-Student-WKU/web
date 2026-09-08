import React from 'react';
import { IconChevronLeft } from '../components/icons.jsx';

/**
 * Terms of Service Page — Google OAuth 동의 화면/앱 검증 제출용 정적 페이지.
 *
 * PrivacyPolicy.jsx와 동일하게 로그인 상태와 무관하게 접근 가능해야 한다.
 *
 * 최초 배포용 초안 — 정식 법률 검토를 거친 문서는 아니며, 실사용자가 늘어나기 전에 팀 검토를
 * 거쳐 다듬을 것을 전제로 최소 요건만 채운 버전.
 */
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
        <p className="settings-field-hint">시행일: 2026년 9월 7일</p>

        <section className="home-card">
          <p className="home-card-label">1. 서비스 소개</p>
          <p className="settings-field-hint">
            ONE Student(이하 "서비스")는 원광대 학생을 위해 입학부터 졸업까지 학업(수강 관리, 졸업요건 진단)과
            진로(챗봇 기반 진로 탐색)를 지원하는 학생 생활 통합 서비스입니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">2. 계정 및 로그인</p>
          <p className="settings-field-hint">
            서비스 이용을 위해 Google 계정으로 로그인해야 합니다. 계정은 본인만 이용해야 하며, 계정 정보(수강 이력,
            대화 기록 등)에 대한 관리 책임은 이용자 본인에게 있습니다. 계정 삭제는 설정 화면에서 언제든 직접 할 수
            있고, 삭제 시 관련 데이터가 즉시 완전히 삭제되어 복구할 수 없습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">3. 서비스 이용</p>
          <p className="settings-field-hint">
            서비스가 제공하는 졸업요건 진단, 수강 정보, 챗봇 응답은 참고용이며 학교의 공식 학사 안내를 대체하지
            않습니다. 실제 졸업 요건, 수강신청, 학적 처리 등은 반드시 학교의 공식 시스템 및 학과 사무실을 통해
            최종 확인해야 합니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">4. 금지 행위</p>
          <p className="settings-field-hint">
            타인 계정 도용, 서비스 정상 운영을 방해하는 행위, 관련 법령을 위반하는 행위를 해서는 안 됩니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">5. 면책</p>
          <p className="settings-field-hint">
            서비스는 학생이 만든 프로젝트로, 제공 정보의 정확성을 위해 노력하지만 완전성을 보장하지 않습니다.
            서비스 이용 또는 이용 중단으로 발생하는 손해에 대해 관련 법령이 허용하는 범위에서 책임을 지지
            않습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">6. 약관 변경 및 문의</p>
          <p className="settings-field-hint">
            서비스 내용/약관은 필요 시 변경될 수 있으며, 중요한 변경 시 서비스 내 공지로 안내합니다. 문의사항은{' '}
            <a href="mailto:bedelj3@gmail.com">bedelj3@gmail.com</a>으로 연락해주세요.
          </p>
        </section>
      </div>
    </div>
  );
}

export default TermsOfService;
