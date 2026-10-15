import React from 'react';
import { MAJOR_TRACK_TYPES } from '../utils/majorTrackType.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * 광역 계열전공 이수유형 선택 카드 4개(복수전공형·전공심화형·전공융합형·아직 안 정했어요).
 * 온보딩의 이수유형 단계와 기존 계정용 한 번 질문 화면(TrackTypeGate)이 같이 쓴다.
 */
function MajorTrackTypeOptions({ value, onChange }) {
  const { t } = useI18n();
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
          <span className="onb-option-caption">{t(`trackType.${type}.caption`)}</span>
        </button>
      ))}
    </div>
  );
}

export default MajorTrackTypeOptions;
