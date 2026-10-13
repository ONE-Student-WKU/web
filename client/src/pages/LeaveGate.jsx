import React, { useState } from 'react';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import LeavePeriodsEditor, { draftFromPeriods, periodsFromDraft, leaveErrorKey } from '../components/LeavePeriodsEditor.jsx';
import { saveLeavePeriods } from '../api/chatApi.js';
import { transferYearOf } from '../utils/onboardingYears.js';
import { useI18n } from '../i18n/I18nContext.jsx';

const NOW_YEAR = new Date().getFullYear();
// 휴학은 다음 학기 것까지 받는다(Onboarding.jsx와 같은 기준).
const LEAVE_LAST_YEAR = new Date().getMonth() >= 8 ? NOW_YEAR + 1 : NOW_YEAR;

/**
 * LeaveGate Page
 * 휴학 기간을 받기 전에 온보딩을 마친 계정에게 로그인 직후 한 번 보여주는 질문 화면(App.jsx — user.leaveAnswerRequired).
 * 새 계정은 온보딩의 휴학 단계에서 답하므로 이 화면을 보지 않는다. "휴학한 적 없어요"도 답이라 한 번 누르면 끝난다.
 * 예전에 휴학 학기 수만 입력해 둔 계정에는 그 수를 보여주고 시기를 묻는다.
 *
 * Props:
 * - user: 현재 학생(admissionYear, enrollmentType, transferGrade, leaveSemesters)
 * - onSaved(student): 저장된 뒤 서버가 돌려준 학생 정보로 호출
 */
function LeaveGate({ user, onSaved }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(draftFromPeriods(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isTransfer = user.enrollmentType === 'TRANSFER_ADMISSION' && user.transferGrade != null;
  const firstYear = (isTransfer ? transferYearOf(user.admissionYear, user.transferGrade) : user.admissionYear) || NOW_YEAR;
  const periods = periodsFromDraft(draft);

  const handleSave = async () => {
    if (periods === null) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveLeavePeriods(periods));
    } catch (err) {
      setError(leaveErrorKey(err.code));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="screen-header">
        <span className="screen-title">ONE Student</span>
        <LanguageSwitcher />
      </header>

      <div className="auth-body">
        <h2 className="auth-heading">{t('leave.gate.title')}</h2>
        <p className="auth-subheading">{t('leave.gate.body')}</p>
        {user.leaveSemesters > 0 && <p className="onb-q-sub">{t('leave.gate.previous', { count: user.leaveSemesters })}</p>}

        <h3 className="onb-q-title">{t('leave.title')}</h3>
        <LeavePeriodsEditor draft={draft} onChange={setDraft} firstYear={firstYear} lastYear={LEAVE_LAST_YEAR} />

        {error && <p className="auth-error">{t(error)}</p>}

        <button type="button" className="auth-submit-btn" onClick={handleSave} disabled={saving || periods === null}>
          {saving ? t('leave.gate.saving') : t('leave.gate.save')}
        </button>
      </div>
    </div>
  );
}

export default LeaveGate;
