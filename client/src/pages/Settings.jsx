import React, { useEffect, useState } from 'react';
import { getMe, updateProfile } from '../api/chatApi.js';

/**
 * Settings Page
 * 다크/라이트 테마 선택, 휴학 학기 수 조정(학년 계산 보정용).
 *
 * Props:
 * - theme: 'dark' | 'light'
 * - onSetTheme: function
 * - onGoHome: function
 * - highlightLeaveSemesters: boolean — 홈의 "학년이 다르신가요?" 링크로 들어왔을 때만 true,
 *   휴학 학기 수 카드에 강조 애니메이션을 준다.
 */
function Settings({ theme, onSetTheme, onGoHome, highlightLeaveSemesters }) {
  const [leaveSemesters, setLeaveSemesters] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMe()
      .then((data) => setLeaveSemesters(String(data.leaveSemesters ?? 0)))
      .catch(() => setError('정보를 불러오지 못했어요.'));
  }, []);

  async function handleSaveLeaveSemesters() {
    setError(null);
    setSaved(false);
    const value = Number(leaveSemesters);
    if (!Number.isInteger(value) || value < 0) {
      setError('0 이상의 정수를 입력해주세요.');
      return;
    }
    try {
      await updateProfile({ leaveSemesters: value });
      setSaved(true);
    } catch {
      setError('저장에 실패했어요.');
    }
  }

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            ‹
          </button>
          <span className="screen-title">설정</span>
        </div>
      </header>

      <div className="courses-body">
        {error && <p className="home-error">{error}</p>}

        <section className="home-card">
          <p className="home-card-label">테마</p>
          <div className="settings-theme-options">
            <button
              className={theme === 'dark' ? 'settings-theme-btn active' : 'settings-theme-btn'}
              onClick={() => onSetTheme('dark')}
            >
              다크
            </button>
            <button
              className={theme === 'light' ? 'settings-theme-btn active' : 'settings-theme-btn'}
              onClick={() => onSetTheme('light')}
            >
              라이트
            </button>
          </div>
        </section>

        <section className={highlightLeaveSemesters ? 'home-card settings-highlight' : 'home-card'}>
          <p className="home-card-label">휴학 학기 수</p>
          <p className="settings-field-hint">
            입학년도만으로는 휴학 여부를 알 수 없어 홈 화면의 학년 표시가 실제보다 높게 나올 수 있어요.
            누적 휴학 학기 수를 입력하면 보정해요.
          </p>
          <div className="settings-inline-field">
            <input
              type="number"
              min="0"
              step="1"
              className="onb-select"
              value={leaveSemesters}
              onChange={(e) => {
                setLeaveSemesters(e.target.value);
                setSaved(false);
              }}
            />
            <button className="settings-theme-btn" onClick={handleSaveLeaveSemesters}>
              저장
            </button>
          </div>
          {saved && <p className="settings-field-hint">저장했어요.</p>}
        </section>
      </div>
    </div>
  );
}

export default Settings;
