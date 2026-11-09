import { useEffect, useRef, useState } from 'react';
import { getReviewPrompt, markReviewPromptShown } from '../api/chatApi.js';

// 접속할 때 기준을 못 채웠던 학생은, 이번 접속에서 앱을 이만큼 보고 있었을 때만 다시 물어본다(그사이 과목을 넣었을 수 있다).
export const ACTIVE_MS_BEFORE_RECHECK = 3 * 60 * 1000;
// 다시 물어보는 간격 — 홈을 자주 오가도 서버에 매번 묻지 않는다.
const RECHECK_INTERVAL_MS = 60 * 1000;

/**
 * useReviewPrompt
 * 후기 창(ReviewPrompt)을 언제 띄울지 정한다. 깊게 써 봤는지·몇 번 띄웠는지는 서버(services/reviewService.js)가 판단하고,
 * 여기서는 "언제"만 정한다:
 *  - 다른 화면에서 홈으로 돌아올 때만 띄운다(무언가 하는 도중이나 들어오자마자 막지 않는다).
 *  - 접속할 때 이미 기준을 채웠으면(지난 접속에서 써 봤으면) 첫 귀환 때 바로 띄운다.
 *  - 아니면 이번 접속에서 앱을 3분 이상 보고 있었을 때 서버에 다시 묻는다. 탭이 숨어 있던 시간은 세지 않는다.
 *  - 한 접속에 한 번. 띄우는 순간 서버에 알린다(띄운 채 앱을 닫아도 "다음에"와 같게 친다).
 * 사용 시간은 화면에서만 세고 저장하지 않는다.
 *
 * @param {object} p
 * @param {number|null} p.studentId — 후기를 물을 학생(온보딩을 마친 학생). 없으면 아무것도 하지 않는다.
 * @param {string} p.view — 지금 화면(App.jsx의 view)
 * @param {boolean} p.blocked — 다른 창(경고·동의·정지 등)이 떠 있으면 true
 * @returns {[boolean, function]} [창을 띄울지, 닫기]
 */
export default function useReviewPrompt({ studentId, view, blocked }) {
  const [open, setOpen] = useState(false);
  const visit = useRef(null);

  // 로그인한 학생이 바뀌면 이번 접속 기록을 새로 시작한다.
  useEffect(() => {
    setOpen(false);
    if (!studentId) {
      visit.current = null;
      return undefined;
    }
    const v = {
      dueAtStart: false,
      shown: false,
      checking: false,
      lastCheckAt: 0,
      activeMs: 0,
      visibleSince: document.visibilityState === 'visible' ? Date.now() : null,
    };
    visit.current = v;
    getReviewPrompt()
      .then((due) => {
        v.dueAtStart = !!due;
      })
      .catch(() => {});

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        v.visibleSince = Date.now();
      } else if (v.visibleSince) {
        v.activeMs += Date.now() - v.visibleSince;
        v.visibleSince = null;
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [studentId]);

  const prevView = useRef(view);
  useEffect(() => {
    const cameHome = prevView.current !== 'home' && view === 'home';
    prevView.current = view;
    const v = visit.current;
    if (!cameHome || blocked || !v || v.shown || v.checking) return;

    const show = () => {
      v.shown = true;
      setOpen(true);
      markReviewPromptShown().catch(() => {});
    };
    if (v.dueAtStart) {
      show();
      return;
    }
    const activeMs = v.activeMs + (v.visibleSince ? Date.now() - v.visibleSince : 0);
    if (activeMs < ACTIVE_MS_BEFORE_RECHECK || Date.now() - v.lastCheckAt < RECHECK_INTERVAL_MS) return;
    v.checking = true;
    v.lastCheckAt = Date.now();
    getReviewPrompt()
      .then((due) => {
        if (due && visit.current === v) show();
      })
      .catch(() => {})
      .finally(() => {
        v.checking = false;
      });
  }, [view, blocked]);

  return [open, () => setOpen(false)];
}
