import React, { useEffect, useState } from 'react';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import MajorTrackTypeOptions from '../components/MajorTrackTypeOptions.jsx';
import { getDepartments, updateProfile } from '../api/chatApi.js';
import { intensiveMajorCredits } from '../utils/majorTrackType.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * TrackTypeGate Page
 * 이수유형을 받기 전에 온보딩을 마친 광역 계열전공 계정에게 로그인 직후 한 번 보여주는 질문 화면(App.jsx — user.trackTypeAnswerRequired).
 * 새 계정은 온보딩의 이수유형 단계에서 답하므로 이 화면을 보지 않는다. "아직 안 정했어요"도 답이라 한 번 고르면 끝난다(#378 결정 3-4 A).
 *
 * Props:
 * - user: 로그인한 학생(departmentId·admissionYear로 전공심화형 학점을 찾는다)
 * - onSaved(student): 저장된 뒤 서버가 돌려준 학생 정보로 호출
 */
function TrackTypeGate({ user, onSaved }) {
  const { t } = useI18n();
  const [value, setValue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  // 학생 학과·학번의 전공심화형 학점. 학과 목록을 못 받으면 null이라 선택지가 계열별 범위로 보인다.
  const [intensiveCredits, setIntensiveCredits] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDepartments()
      .then((departments) => {
        const department = departments.find((d) => d.id === user?.departmentId);
        if (!cancelled) setIntensiveCredits(intensiveMajorCredits(department, user?.admissionYear));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.departmentId, user?.admissionYear]);

  const handleSave = async () => {
    if (!value) return;
    setSaving(true);
    setError(false);
    try {
      onSaved(await updateProfile({ majorTrackType: value }));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="screen-header">
        <span className="screen-title screen-title-brand">ONE Student</span>
        <LanguageSwitcher />
      </header>

      <div className="auth-body">
        <h2 className="auth-heading">{t('trackType.gate.title')}</h2>
        <p className="auth-subheading">{t('trackType.gate.body')}</p>
        <h3 className="onb-q-title">{t('trackType.title')}</h3>
        <p className="onb-q-sub">{t('trackType.sub')}</p>
        <MajorTrackTypeOptions value={value} onChange={setValue} intensiveCredits={intensiveCredits} />

        {error && <p className="auth-error">{t('trackType.gate.error')}</p>}

        <button type="button" className="auth-submit-btn" onClick={handleSave} disabled={saving || !value}>
          {saving ? t('leave.gate.saving') : t('leave.gate.save')}
        </button>
      </div>
    </div>
  );
}

export default TrackTypeGate;
