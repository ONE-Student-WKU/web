import React, { useEffect, useState } from 'react';
import { getCareerHistory } from '../api/chatApi.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import CareerRoadmapList from './CareerRoadmapList.jsx';

/**
 * 진로를 확정한 지난 진단을 다시 여는 목록. "다시 진단하기"를 해도 지난 세션은 서버에 남아 있어 그대로 보여 준다.
 * - excludeId: 지금 화면에 이미 보이는 세션은 뺀다(진로 탐색 결과 화면)
 * - skipLatest: 가장 최근 확정은 뺀다(프로필은 그 진로를 바로 위에 보여 준다)
 * 지난 진단이 없으면 아무것도 그리지 않는다.
 */
function CareerHistoryList({ excludeId = null, skipLatest = false }) {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    getCareerHistory()
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch(() => {
        if (alive) setHistory([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = (skipLatest ? history.slice(1) : history).filter((h) => h.id !== excludeId);
  if (rows.length === 0) return null;

  return (
    <section className="career-history">
      <h3 className="career-history-title">{t('career.history.title')}</h3>
      <ul className="career-history-list">
        {rows.map((h) => (
          <li key={h.id}>
            <button type="button" className="career-history-row" aria-expanded={openId === h.id} onClick={() => setOpenId((id) => (id === h.id ? null : h.id))}>
              <span className="career-history-name">{h.confirmedCareer}</span>
              <span className="career-history-date">{new Date(h.confirmedAt).toLocaleDateString(lang === 'en' ? 'en-CA' : 'ko-KR')}</span>
            </button>
            {openId === h.id && <CareerRoadmapList roadmap={h.roadmap} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default CareerHistoryList;
