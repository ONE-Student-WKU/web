import React from 'react';
import { IconChevronLeft } from '../components/icons.jsx';

/**
 * Privacy Policy Page — Google OAuth 동의 화면/앱 검증(브랜딩 > 홈페이지/개인정보처리방침
 * URL) 제출용 정적 페이지.
 *
 * 로그인 상태와 무관하게 접근 가능해야 한다(Google이 로그인 없이 이 URL을 그대로 방문해서
 * 확인함) — App.jsx가 pathname('/privacy')만으로 이 화면을 초기 렌더링하도록 구성돼 있다.
 *
 * 최초 배포용 초안 — 정식 법률 검토를 거친 문서는 아니며, 실사용자가 늘어나기 전에 팀 검토를
 * 거쳐 다듬을 것을 전제로 최소 요건(수집 항목/목적/보관/제3자 제공/삭제/문의)만 채운 버전.
 */
function PrivacyPolicy({ onGoBack }) {
  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoBack} aria-label="뒤로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">개인정보처리방침</span>
        </div>
      </header>

      <div className="courses-body">
        <p className="settings-field-hint">시행일: 2026년 9월 7일</p>

        <section className="home-card">
          <p className="home-card-label">수집하는 개인정보 항목</p>
          <p className="settings-field-hint">
            ONE Student는 Google 로그인만을 통해 회원가입/로그인을 처리하며, 아래 정보를 수집합니다.
          </p>
          <p className="settings-field-hint">
            · Google 계정으로부터: 이메일 주소, 이름, Google 계정 고유 식별자(sub)
            <br />· 온보딩 입력으로부터(선택 입력): 학과, 입학년도, 편입/전과 여부 등 학적 정보
            <br />· 서비스 이용 중 자동 생성: 수강 이력, 챗봇 대화 기록, 진로 탐색 세션 기록
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">수집 목적</p>
          <p className="settings-field-hint">
            회원 식별 및 로그인 상태 유지, 학과별 졸업요건 진단, 수강 관리, 진로 탐색 챗봇 응답 생성을 위해서만
            사용합니다. 별도 마케팅·광고 목적으로는 사용하지 않습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">보관 기간</p>
          <p className="settings-field-hint">
            계정을 삭제하기 전까지 보관하며, 계정 삭제 시(설정 &gt; 계정 정보 수정 &gt; 계정 삭제) 관련 데이터(수강
            이력, 대화 기록 포함)가 즉시 완전히 삭제됩니다. 삭제된 데이터는 복구할 수 없습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">제3자 제공 및 위탁</p>
          <p className="settings-field-hint">
            수집한 개인정보를 외부에 제공하지 않습니다. 다만 서비스 운영을 위해 아래 외부 사업자의 서버 인프라를
            이용하며, 이들은 저장/전송 경로로만 관여하고 별도 목적으로 개인정보를 이용하지 않습니다: 데이터베이스/백엔드
            호스팅(Railway), 프론트엔드 호스팅(Vercel), 챗봇 응답 생성(Anthropic).
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">이용자의 권리</p>
          <p className="settings-field-hint">
            언제든지 설정 화면에서 이름 등 프로필 정보를 직접 수정할 수 있고, 계정 삭제 기능을 통해 본인의 모든
            데이터에 대한 삭제를 요청(즉시 처리)할 수 있습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">문의</p>
          <p className="settings-field-hint">
            개인정보 관련 문의는 <a href="mailto:bedelj3@gmail.com">bedelj3@gmail.com</a>으로 연락해주세요.
          </p>
        </section>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
