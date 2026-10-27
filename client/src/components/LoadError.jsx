import React from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * LoadError Component
 * 불러오기에 실패했을 때 목록·숫자 자리에 대신 보여 주는 안내와 "다시 시도" 버튼.
 * 실패를 빈 목록("아직 없어요")이나 0, "불러오는 중..."과 섞어 보여 주면 데이터가 없어진 것처럼 읽혀서(2026-10-27 화면 점검),
 * 실패면 이것만 보여 준다. 여러 화면이 같은 모양을 쓴다.
 *
 * Props:
 * - message: string — 이미 번역된 안내 문구
 * - onRetry: function (선택) — 없으면 버튼을 그리지 않는다
 */
function LoadError({ message, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="load-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="load-error-retry" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export default LoadError;
