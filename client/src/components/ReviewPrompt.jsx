import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

const STARS = [1, 2, 3, 4, 5];

/**
 * ReviewPrompt
 * 서비스를 써 본 학생에게 한 번 띄우는 후기 창. 별점(필수)과 한 줄 후기(선택)를 받는다.
 * 후기는 계정과 연결하지 않고 학과만 함께 저장해, 소개 자료에 익명으로 쓴다(답장하지 않는다).
 * 보내면 같은 창이 "고마워요" 상태로 바뀌고, [닫기]로 끝난다. [다음에]는 아무것도 저장하지 않고 닫는다.
 *
 * Props:
 * - onSubmit: async function({ rating, content })
 * - onClose: function() — 다음에·닫기
 */
function ReviewPrompt({ onSubmit, onClose }) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!rating) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ rating, content: content.trim() });
      setDone(true);
    } catch {
      setError(t('review.err.send'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="career-confirm-overlay">
        <div className="career-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="review-done-title">
          <span className="career-confirm-title" id="review-done-title">
            {t('review.done.title')}
          </span>
          <p className="career-confirm-body">{t('review.done.body')}</p>
          <button type="button" className="auth-submit-btn" onClick={onClose}>
            {t('review.done.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="career-confirm-overlay">
      <form className="career-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" onSubmit={handleSubmit}>
        <span className="career-confirm-title" id="review-title">
          {t('review.title')}
        </span>
        <p className="career-confirm-body">{t('review.body')}</p>
        <div className="review-stars" role="radiogroup" aria-label={t('review.ratingLabel')}>
          {STARS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={t('review.star', { n })}
              className={`review-star${n <= rating ? ' is-on' : ''}`}
              onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
        </div>
        <div className="auth-field">
          <textarea
            rows={3}
            maxLength={500}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('review.placeholder')}
            aria-label={t('review.placeholder')}
          />
        </div>
        {error && <p className="home-error">{error}</p>}
        <button type="submit" className="auth-submit-btn" disabled={!rating || submitting}>
          {t('review.send')}
        </button>
        <button type="button" className="career-confirm-cancel" onClick={onClose}>
          {t('review.later')}
        </button>
      </form>
    </div>
  );
}

export default ReviewPrompt;
