import React from 'react';
import { MAJOR_TRACK_TYPES } from '../utils/majorTrackType.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * 광역 계열전공 이수유형 선택 카드 4개(복수전공형·전공심화형·전공융합형·아직 안 정했어요).
 * 온보딩의 이수유형 단계와 기존 계정용 한 번 질문 화면(TrackTypeGate)이 같이 쓴다.
 * intensiveCredits: 학생 학과·학번의 전공심화형 전공 학점(utils/majorTrackType.js intensiveMajorCredits). null이면 계열별 범위로 보여 준다.
 */
function MajorTrackTypeOptions({ value, onChange, intensiveCredits = null }) {
  const { t } = useI18n();
  const caption = (type) =>
    type === 'INTENSIVE' && intensiveCredits != null
      ? t('trackType.INTENSIVE.captionCredits', { credits: intensiveCredits })
      : t(`trackType.${type}.caption`);
  return (
    <div className="onb-option-list">
      {MAJOR_TRACK_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className={'onb-option-card' + (value === type ? ' selected' : '')}
          onClick={() => onChange(type)}
        >
          <span className="onb-option-title">{t(`trackType.${type}`)}</span>
          <span className="onb-option-caption">{caption(type)}</span>
        </button>
      ))}
    </div>
  );
}

export default MajorTrackTypeOptions;
