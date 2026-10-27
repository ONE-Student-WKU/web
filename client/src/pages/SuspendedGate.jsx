import React from 'react';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import BrandTitle from '../components/BrandTitle.jsx';
import AccountDeleteSection from '../components/AccountDeleteSection.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

// 이의 제기를 받는 문의 이메일 — 약관 10항·개인정보처리방침의 CONTACT_EMAIL과 같은 주소다(바꾸면 셋 다 바꾼다).
const CONTACT_EMAIL = 'sicnro3241@gmail.com';

// 정지가 끝나는 시각 — 날짜만 쓰면 "오늘까지"인지 헷갈려서 시:분까지 보여준다(제재는 건 시각부터 n일 뒤에 끝난다).
function formatEndsAt(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * SuspendedGate Page
 * 서비스 전체 이용 정지(#457) 중인 계정이 로그인하면 다른 화면 대신 이 화면만 본다(App.jsx — 동의 화면보다 먼저).
 * 약관 6항대로 정지 사유·기간 확인, 로그아웃, 계정 삭제만 할 수 있고, 서버도 그 밖의 요청을 막는다
 * (server/middleware/accountSuspension.js). 사유는 관리자가 쓴 글이라 번역하지 않고 그대로 보여준다.
 *
 * Props:
 * - user: object — 계정 삭제 재인증 방식 판단용(hasGoogleAccount)
 * - suspension: { reason, endsAt } — endsAt이 null이면 영구 정지
 * - onLogout / onAccountDeleted: function
 * - justReauthenticated: boolean — Google 재인증 왕복 직후면 계정 삭제를 펼친 채로 보여준다
 */
function SuspendedGate({ user, suspension, onLogout, onAccountDeleted, justReauthenticated }) {
  const { t, tRich } = useI18n();
  const permanent = !suspension.endsAt;

  return (
    <div className="auth-page">
      <header className="screen-header">
        <BrandTitle />
        <LanguageSwitcher />
      </header>

      <div className="auth-body">
        <h2 className="auth-heading">{t('suspended.title')}</h2>
        <p className="auth-subheading">{permanent ? t('suspended.bodyPermanent') : t('suspended.body')}</p>

        <dl className="post-facts suspended-facts">
          <div className="post-fact post-fact--wide">
            <dt>{t('suspended.reason')}</dt>
            <dd>{suspension.reason}</dd>
          </div>
          <div className="post-fact post-fact--wide">
            <dt>{t('suspended.period')}</dt>
            <dd>{permanent ? t('suspended.permanent') : t('suspended.until', { date: formatEndsAt(suspension.endsAt) })}</dd>
          </div>
        </dl>
        <p className="settings-help suspended-appeal">{tRich('suspended.appeal', { email: CONTACT_EMAIL })}</p>

        <button type="button" className="auth-submit-btn" onClick={onLogout}>
          {t('suspended.logout')}
        </button>
        <div className="settings-list suspended-delete">
          <AccountDeleteSection
            user={user}
            justReauthenticated={justReauthenticated}
            onAccountDeleted={onAccountDeleted}
            notice={t('suspended.deleteNotice')}
          />
        </div>
      </div>
    </div>
  );
}

export default SuspendedGate;
