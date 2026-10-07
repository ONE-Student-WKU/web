import React from 'react';
import { IconChevronLeft } from '../components/icons.jsx';

/**
 * Privacy Policy Page — 개인정보처리방침. Google OAuth 동의 화면/앱 검증(브랜딩 > 개인정보처리방침 URL) 제출용이기도 하다.
 *
 * 로그인 상태와 무관하게 접근 가능해야 한다(Google이 로그인 없이 이 URL을 그대로 방문해서
 * 확인함) — App.jsx가 pathname('/privacy')만으로 이 화면을 초기 렌더링하도록 구성돼 있다.
 *
 * 2026-10-07 전면 개정: 이메일 인증코드 로그인, 커뮤니티·문의, 성적 입력, 해외 사업자(위탁·국외 이전)처럼
 * 서비스가 실제로 하는 일에 맞췄다. 정식 법률 검토를 거친 문서는 아니므로 사용자가 늘기 전에 팀 검토를 거칠 것.
 * 의미 있게 고치면(수집 항목, 위탁·국외 이전, 보관 기간 등) 동의 버전을 같이 올려야 한다 — CLAUDE.md "약관·개인정보 동의" 참고
 * (server/services/consent.js, client/src/utils/consent.js).
 * 법적 문서라 아직 번역하지 않고 한국어로만 제공한다.
 */
const CONTACT_EMAIL = 'sicnro3241@gmail.com';

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
        <p className="settings-field-hint">시행일: 2026년 10월 7일</p>
        <p className="settings-field-hint">
          ONE Student(이하 "서비스")는 이용자의 개인정보를 소중히 다루며, 아래와 같이 어떤 정보를 왜 수집하고 어디에서
          처리하는지 알려드립니다. 로그인 화면에서 이 방침과 이용약관에 동의하면 아래 내용(위탁과 국외 이전 포함)에
          동의한 것으로 봅니다.
        </p>

        <section className="home-card">
          <p className="home-card-label">1. 수집하는 개인정보 항목</p>
          <p className="settings-field-hint">
            <strong>로그인할 때 (필수)</strong>
            <br />· Google 로그인: Google 계정의 이메일 주소와 Google 계정 고유 식별자. Google 계정의 이름과 프로필
            사진은 저장하지 않습니다.
            <br />· 이메일 인증코드 로그인: 입력한 이메일 주소. 인증코드는 암호화(해시)해서 저장하며 일정 시간이 지나면
            쓸 수 없게 됩니다.
            <br />· 이용약관과 개인정보 수집·이용에 동의한 시각과 동의한 문서 버전
          </p>
          <p className="settings-field-hint">
            <strong>이용자가 직접 입력하는 정보</strong>
            <br />· 닉네임(처음에는 자동으로 정해지며, 직접 바꿀 수 있습니다)
            <br />· 학과, 세부전공, 복수전공 학과, 입학년도, 입학 유형(일반·편입·전과)과 전과 시점, 누적 휴학 학기 수,
            자기계발심층상담 참여 횟수
            <br />· 수강 이력: 과목, 학점, 이수구분, 이수 학기, 성적 등급, 시간표
            <br />· 챗봇과 진로 탐색에서 입력한 질문과 답변, 진로 탐색 결과(후보와 수강 로드맵)
            <br />· 커뮤니티 글, 참여 신청 메시지, 신고 내용
            <br />· 문의하기에 작성한 제목과 내용
            <br />· 화면 언어 설정
          </p>
          <p className="settings-field-hint">
            <strong>성적표 가져오기</strong>
            <br />· 업로드한 PDF나 붙여넣은 성적 텍스트는 분석하는 동안 서버 메모리에서만 처리하며 파일 자체는 저장하지
            않습니다. 이름과 학번은 저장하지 않고, 확인 후 등록을 선택한 과목, 학점, 이수구분, 성적 등급만 저장합니다.
            <br />· 가져오기 횟수 한도를 계산하기 위해 가져오기를 사용한 시각과 학기를 기록합니다.
          </p>
          <p className="settings-field-hint">
            <strong>서비스를 이용하는 동안 자동으로 생기는 정보</strong>
            <br />· 마지막 접속 시각(운영자가 현재 접속자 수를 보기 위한 용도)
            <br />· 로그인 상태를 유지하기 위한 세션 쿠키(최대 30일, "로그인 상태 유지"를 끄면 브라우저를 닫을 때까지)
            <br />· 이용자의 브라우저 저장소에 보관되는 설정(테마, 글자 크기, 언어, 동의 기록 유무)과 일부 화면의 임시
            캐시
            <br />· 접속 기록(IP 주소 등): 서비스를 운영하는 호스팅 사업자의 서버 로그에 남을 수 있으며, 서비스가 이를
            별도로 저장하거나 이용하지 않습니다.
            <br />· 오류가 발생했을 때의 오류 정보(오류 내용, 요청 경로 등)
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">2. 수집·이용 목적</p>
          <p className="settings-field-hint">
            · 회원 식별, 로그인과 로그인 상태 유지, 부정 이용 방지
            <br />· 학과·학번별 졸업요건 진단, 수강 관리, 학기별 시간표 제공
            <br />· 학사 규정 챗봇과 진로 탐색의 답변 생성(개인 맞춤 답변을 위해 학과·학번·입학 유형·학년, 이수 현황을
            함께 사용합니다)
            <br />· 커뮤니티 운영: 글 승인, 참여 신청 전달, 신고와 제재 처리, 매칭 후 연락 중계
            <br />· 문의 답변과 서비스 오류 대응
            <br />· 서비스 이용 통계(가입 수, 현재 접속자 수) 확인과 서비스 개선
          </p>
          <p className="settings-field-hint">별도의 마케팅·광고 목적으로는 사용하지 않습니다.</p>
        </section>

        <section className="home-card">
          <p className="home-card-label">3. 다른 이용자와 운영자에게 보이는 정보</p>
          <p className="settings-field-hint">
            · 커뮤니티에 승인되어 공개된 글의 제목, 내용, 닉네임은 다른 이용자에게 보입니다. 글에 이름, 연락처 등 개인
            정보를 쓰지 마세요.
            <br />· 참여 신청 메시지는 해당 글을 쓴 이용자에게만 전달됩니다. 다만 신고가 접수되면 신고 처리에 필요한 범위에서
            운영자가 볼 수 있습니다.
            <br />· 신청이 수락되면 서로의 실제 이메일 주소 대신 서비스가 만든 중계 이메일 주소가 전달되며, 그 주소로
            보낸 메일은 상대방에게 전달됩니다. 메일 내용은 서비스가 저장하지 않습니다.
            <br />· 운영자는 글 승인, 신고와 제재 처리, 문의 답변을 위해 해당 글, 신고, 문의 내용과 작성자의 계정
            정보를 볼 수 있습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">4. 보유 기간과 파기</p>
          <p className="settings-field-hint">
            · 계정을 삭제하기 전까지 보관합니다.
            <br />· 계정을 삭제하면(계정 메뉴 &gt; 계정 정보 수정 &gt; 계정 삭제) 계정 정보, 수강 이력, 챗봇·진로 탐색
            기록, 커뮤니티 글과 신청, 내가 한 신고, 문의, 제재 이력, 접속 시각이 즉시 삭제되며 복구할 수 없습니다.
            <br />· 다만 다른 이용자가 신고한 내 게시글의 제목·본문이나 신청 메시지의 사본은 신고 처리 기록으로 남을 수
            있습니다. 이 기록은 내 계정과의 연결이 삭제됩니다.
            <br />· 호스팅 사업자의 백업에 삭제된 정보가 일정 기간 남아 있을 수 있으며, 백업 주기에 따라 순차적으로
            사라집니다.
            <br />· 관련 법령에 따라 보관해야 하는 정보가 있으면 그 기간 동안 보관합니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">5. 처리 위탁과 국외 이전</p>
          <p className="settings-field-hint">
            서비스를 운영하기 위해 아래 외부 사업자의 서버와 서비스를 이용하며, 이용자의 정보가 대한민국 밖(주로
            미국)으로 전송되어 처리될 수 있습니다. 이전은 서비스를 이용하는 시점에 네트워크를 통해 이루어지고, 각
            사업자는 아래 목적 범위에서만 정보를 처리하도록 서비스를 구성했습니다. 국외 이전을 원하지 않으면 서비스를
            이용할 수 없으며, 동의를 철회하려면 계정을 삭제해 주세요.
          </p>
          <p className="settings-field-hint">
            · <strong>Railway</strong> (미국 등 서비스 설정에 따른 지역): 서버와 데이터베이스 호스팅 — 서비스가 보관하는
            모든 정보
            <br />· <strong>Vercel</strong> (미국 등 전 세계 전송망): 웹사이트 제공과 요청 전달 — 이용자가 서비스와 주고받는
            모든 정보
            <br />· <strong>Anthropic</strong> (미국): 챗봇·진로 탐색 답변 생성, 검색어 정리, 성적표 분석 — 질문과 대화
            내용, 학과·학번·입학 유형·학년, 이수 현황, 성적표 PDF 또는 붙여넣은 성적 텍스트의 내용
            <br />· <strong>Voyage AI</strong> (미국): 챗봇 질문과 관련된 규정을 찾기 위한 문장 변환 — 챗봇 질문 문장
            <br />· <strong>Resend</strong> (미국): 인증코드 메일 발송, 커뮤니티 매칭 연락 중계 — 이메일 주소, 중계되는
            메일 내용
            <br />· <strong>Sentry</strong> (미국): 오류 모니터링 — 오류 정보(오류 내용, 요청 경로 등)
            <br />· <strong>Google</strong> (미국): Google 로그인 인증 — Google 계정 이메일과 고유 식별자
          </p>
          <p className="settings-field-hint">
            위 사업자 외에 이용자의 개인정보를 제3자에게 판매하거나 제공하지 않습니다. 다만 법령에 따라 수사기관 등이
            적법한 절차로 요구하는 경우는 예외입니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">6. 이용자의 권리와 행사 방법</p>
          <p className="settings-field-hint">
            · 열람과 수정: 설정, 학과·학번 수정, 계정 정보 수정, 과목 관리 화면에서 직접 확인하고 고칠 수 있습니다.
            <br />· 삭제와 동의 철회: 계정 삭제 기능으로 언제든지 모든 정보의 삭제를 요청할 수 있으며 즉시
            처리됩니다.
            <br />· 위에서 직접 할 수 없는 요청(처리 정지, 정정, 삭제 확인 등)은 아래 이메일로 보내 주세요. 본인
            확인 후 지체 없이 처리합니다.
            <br />· 만 14세 미만은 서비스를 이용할 수 없습니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">7. 안전하게 보관하기 위한 조치</p>
          <p className="settings-field-hint">
            · 이용자와 서버 사이의 통신은 HTTPS로 암호화됩니다.
            <br />· 로그인 세션은 스크립트가 읽을 수 없는 쿠키(HttpOnly)로 유지하며, 인증코드는 해시로 저장합니다.
            <br />· 관리자 기능은 관리자 권한이 있는 계정만 사용할 수 있습니다.
            <br />· 이용자의 입력이 서비스 운영 목적 외로 사용되지 않도록 접근을 최소한으로 제한합니다.
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">8. 개인정보 보호책임자와 문의</p>
          <p className="settings-field-hint">
            개인정보 보호책임자: ONE Student 운영팀
            <br />
            문의: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <section className="home-card">
          <p className="home-card-label">9. 방침의 변경</p>
          <p className="settings-field-hint">
            수집 항목, 위탁·국외 이전, 보관 기간 등 중요한 내용이 바뀌면 서비스 안에서 알리고 다시 동의를 받습니다.
          </p>
          <p className="settings-field-hint">
            · 2026년 10월 7일: 이메일 인증코드 로그인, 커뮤니티·문의·성적 입력, 해외 사업자(위탁·국외 이전)를 포함해 현재
            서비스에 맞게 전면 개정
            <br />· 2026년 9월 7일: 최초 시행(Google 로그인만 지원하던 시기)
          </p>
        </section>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
