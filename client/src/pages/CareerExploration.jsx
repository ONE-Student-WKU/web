import React, { useEffect, useRef, useState } from 'react';
import {
  getLatestCareerSession,
  createCareerSession,
  submitCareerFixedAnswers,
  updateCareerFixedAnswers,
  sendCareerMessage,
  generateCareerCandidates,
  confirmCareer,
} from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import ChatBubble from '../components/ChatBubble.jsx';
import ChatInput from '../components/ChatInput.jsx';
import CareerRoadmapList from '../components/CareerRoadmapList.jsx';
import { IconChevronLeft, IconEdit } from '../components/icons.jsx';

// 전공/개발 경험 무관하게 답할 수 있는 일반적인 성향·관심사 질문 — 자유 대화를 뭘로
// 시작할지 막막한 진입장벽을 낮추고, 아주 대략적인 분야를 먼저 잡아두는 용도(합의된 설계).
// 개발 프로젝트 경험을 전제로 한 문구는 피한다 — 진로를 못 정한 학생일수록 그런 경험이
// 없는 경우가 더 많을 수 있어서다. multi:true인 성향 질문은 복수 선택을 허용하고(선택지가
// 하나로 딱 떨어지지 않을 수 있음), 마지막 개발 경험 수준 질문만 단일 선택 — 이후 자유
// 대화에서 AI가 학생 수준에 맞춰 설명하도록 참고 정보로 흘러들어간다.
const FIXED_QUESTIONS = [
  {
    question: '새로운 걸 배울 때 더 끌리는 쪽은?',
    multi: true,
    options: [
      '직접 해보면서 몸으로 익히는 것',
      '원리를 깊이 파고들어 이해하는 것',
      '다른 사람과 이야기하며 함께 배우는 것',
      '자료를 찾아보고 비교해보는 것',
    ],
  },
  {
    question: '여러 명이 같이 무언가를 할 때 자연스럽게 맡게 되는 역할은?',
    multi: true,
    options: [
      '전체 일정과 역할을 조율하는 역할',
      '어려운 부분을 깊이 파고드는 역할',
      '결과물을 보기 좋게 다듬는 역할',
      '자료를 조사하고 정리하는 역할',
    ],
  },
  {
    question: '무언가를 할 때 더 중요하게 여기는 가치는?',
    multi: true,
    options: [
      '눈에 보이는 결과물을 빠르게 만드는 것',
      '깊이 있게 파고들어 전문성을 쌓는 것',
      '사람들에게 실질적으로 도움이 되는 것',
      '안정적이고 예측 가능한 환경',
    ],
  },
  {
    question: '몰입해서 시간 가는 줄 몰랐던 경험에 가까운 건?',
    multi: true,
    options: [
      '무언가의 원인을 끝까지 파고들어 알아냈을 때',
      '무언가를 보기 좋게 다듬고 완성했을 때',
      '사람들을 설득하거나 의견을 조율했을 때',
      '자료를 분석해서 새로운 걸 찾아냈을 때',
    ],
  },
  {
    question: '지금까지 개발(코딩) 경험은 어느 정도인가요?',
    multi: false,
    options: [
      '전혀 해본 적 없어요',
      '수업에서 배운 정도예요',
      '개인 프로젝트나 과제를 몇 번 해봤어요',
      '실무나 대회 수준으로 다뤄봤어요',
    ],
  },
];

const FIXED_MESSAGE_COUNT = FIXED_QUESTIONS.length * 2;

function toChatMessages(messages) {
  // 고정 질문 구간(질문+답변 쌍)은 채팅창에 다시 그리지 않는다 — 사용자가 실제로 입력한
  // 적 없는 turn까지 이미 나눈 대화처럼 보여서 "이게 뭐지" 하고 다시 읽게 되는 문제가
  // 실사용 피드백으로 확인됨. 서버로 보내는 history에는 그대로 남아 AI 컨텍스트로 쓰인다.
  return messages.slice(FIXED_MESSAGE_COUNT).map((m) => ({ sender: m.role, text: m.content }));
}

// 채팅 시작 시 저장된 고정 질문 답변(질문/답변 쌍)을 "처음 답변 수정" 화면에 미리 채워
// 넣기 위해 역파싱한다. 저장된 답변은 advanceQuestion에서 선택지를 ', '로 이어붙인
// 문자열이라, 그 질문의 실제 선택지 목록과 대조해 다시 배열로 되돌린다.
function parseFixedAnswersFromMessages(messages) {
  return FIXED_QUESTIONS.map((q, i) => {
    const answerText = messages[i * 2 + 1]?.content;
    if (!answerText || answerText === '(잘 모르겠어요, 건너뜀)') return [];
    return answerText.split(', ').filter((opt) => q.options.includes(opt));
  });
}

/**
 * CareerExploration Page
 * 고정 질문(진입장벽 낮추기) → 자유 대화(AI 상담) → 진로 후보 → 확정 → 과목 로드맵.
 *
 * Props:
 * - user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile
 * - onInputFocusChange: function(boolean) — optional, 대화 단계 입력창 포커스 상태를 상위(App)에
 *   전달해 모바일 키보드가 떠 있는 동안 하단 탭바를 같이 숨길 수 있게 한다.
 */
function CareerExploration({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onInputFocusChange }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [stage, setStage] = useState('questions'); // questions | chat | candidates | roadmap
  const [sessionId, setSessionId] = useState(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [fixedAnswers, setFixedAnswers] = useState([]); // [{question, selected: string[]}]
  const [draftAnswer, setDraftAnswer] = useState([]); // 현재 질문에서 선택 중인 옵션들
  const [startingChat, setStartingChat] = useState(false);

  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const [candidates, setCandidates] = useState([]);
  const [confirmingCareer, setConfirmingCareer] = useState(null);

  const [roadmap, setRoadmap] = useState([]);
  const [confirmedCareer, setConfirmedCareer] = useState(null);

  const [editDrafts, setEditDrafts] = useState([]); // FIXED_QUESTIONS와 같은 순서의 string[] 배열
  const [savingEdit, setSavingEdit] = useState(false);
  // 모바일에서 입력창에 포커스가 가면(키보드가 뜨면) 화면이 좁아지므로, 입력창 자체를
  // 제외한 주변 UI(하단 탭바)를 잠깐 접어 입력 공간을 확보한다 — Chat.jsx와 동일한 패턴.
  const [inputFocused, setInputFocused] = useState(false);
  const handleInputFocusChange = (focused) => {
    setInputFocused(focused);
    onInputFocusChange?.(focused);
  };

  const bottomRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    getLatestCareerSession()
      .then((session) => {
        if (!session) return;

        // 재진입 시 항상 채팅방으로 들어간다 — 후보/로드맵까지 다 나온 세션이어도 대화
        // 자체를 이어보거나 다시 들여다보고 싶을 수 있어서다(실사용 피드백). 이미 만들어둔
        // 결과는 버리지 않고 함께 불러와 채팅방 상단 배너로 바로 갈 수 있게 해둔다.
        setSessionId(session.id);
        setMessages(session.messages);
        setCandidates(session.candidates || []);
        setRoadmap(session.roadmap || []);
        setConfirmedCareer(session.confirmedCareer || null);
        if (session.messages.length > 0) setStage('chat');
      })
      .catch((err) => {
        if (err.code === 'ONBOARDING_REQUIRED') setOnboardingRequired(true);
        else setError('진로 탐색 정보를 불러오지 못했어요.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, stage]);

  // 입력창 포커스(모바일 키보드가 뜨는 시점)에도 다시 스크롤 — Chat.jsx와 동일한 이유.
  useEffect(() => {
    if (!inputFocused) return;
    const timer = setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 300);
    return () => clearTimeout(timer);
  }, [inputFocused]);

  // 채팅에서 답변 수정 화면으로 넘어오면 채팅창의 "맨 아래로 스크롤" 상태가 그대로
  // 이어져서, 맨 위 제목 없이 질문·선택된 답만 불쑥 보이는 문제가 있었다(실사용 피드백).
  // 이 화면으로 들어올 때는 맨 위로 강제로 스크롤해 안내 문구부터 보이게 한다.
  useEffect(() => {
    if (stage === 'editAnswers') bodyRef.current?.scrollTo({ top: 0 });
  }, [stage]);

  function toggleOption(option) {
    const question = FIXED_QUESTIONS[stepIndex];
    if (!question.multi) {
      setDraftAnswer([option]);
      return;
    }
    setDraftAnswer((prev) => (prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]));
  }

  async function advanceQuestion(selected) {
    const nextAnswers = [...fixedAnswers, { question: FIXED_QUESTIONS[stepIndex].question, selected }];
    setFixedAnswers(nextAnswers);
    setDraftAnswer([]);

    if (stepIndex + 1 < FIXED_QUESTIONS.length) {
      setStepIndex(stepIndex + 1);
      return;
    }

    setStartingChat(true);
    setError(null);
    try {
      let sid = sessionId;
      if (!sid) {
        const created = await createCareerSession();
        sid = created.id;
        setSessionId(sid);
      }
      const payload = nextAnswers.map((a) => ({
        question: a.question,
        answer: a.selected.length > 0 ? a.selected.join(', ') : '(잘 모르겠어요, 건너뜀)',
      }));
      const res = await submitCareerFixedAnswers(sid, payload);
      setMessages(res.messages);
      setStage('chat');
    } catch (err) {
      if (err.code === 'ONBOARDING_REQUIRED') setOnboardingRequired(true);
      else setError('진로 탐색을 시작하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setStartingChat(false);
    }
  }

  function goBackQuestion() {
    if (stepIndex === 0) return;
    const prevAnswers = fixedAnswers.slice(0, -1);
    setFixedAnswers(prevAnswers);
    setDraftAnswer(fixedAnswers[stepIndex - 1]?.selected || []);
    setStepIndex(stepIndex - 1);
  }

  function openEditAnswers() {
    setEditDrafts(parseFixedAnswersFromMessages(messages));
    setStage('editAnswers');
  }

  function toggleEditOption(questionIndex, option) {
    const question = FIXED_QUESTIONS[questionIndex];
    setEditDrafts((prev) =>
      prev.map((selected, i) => {
        if (i !== questionIndex) return selected;
        if (!question.multi) return [option];
        return selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option];
      })
    );
  }

  async function handleSaveEditAnswers() {
    setSavingEdit(true);
    setError(null);
    try {
      const payload = FIXED_QUESTIONS.map((q, i) => ({
        question: q.question,
        answer: editDrafts[i]?.length > 0 ? editDrafts[i].join(', ') : '(잘 모르겠어요, 건너뜀)',
      }));
      const res = await updateCareerFixedAnswers(sessionId, payload);
      setMessages(res.messages);
      setStage('chat');
    } catch {
      setError('답변을 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSendMessage(text) {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setSending(true);
    setError(null);
    try {
      const res = await sendCareerMessage(sessionId, text);
      setMessages(res.messages);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '오류가 발생했어요. 잠시 후 다시 시도해주세요.' }]);
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmRecommend() {
    // 확인 모달을 바로 닫지 않고 로딩 화면으로 바꿔서 그대로 띄워둔다 — 응답을 기다리는
    // 동안 화면이 거의 그대로라 "눌렀나?" 싶어 헤더의 추천받기를 다시 누르는 문제가
    // 있었다(실사용 피드백). 오버레이가 화면 전체를 덮고 있는 동안은 뒤쪽 버튼을 아예
    // 누를 수 없어서, 로딩 상태를 명확히 보여주는 동시에 중복 요청도 막힌다.
    setLoadingCandidates(true);
    setError(null);
    try {
      const res = await generateCareerCandidates(sessionId);
      setCandidates(res.candidates);
      setStage('candidates');
    } catch (err) {
      if (err.code === 'CAREER_CANDIDATES_EMPTY') {
        setError('아직 판단할 만한 이야기가 부족해요. 조금 더 대화한 뒤 다시 시도해주세요.');
      } else {
        setError('진로 후보를 만들지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setLoadingCandidates(false);
      setShowConfirmModal(false);
    }
  }

  async function handleChooseCareer(careerName) {
    setConfirmingCareer(careerName);
    setError(null);
    try {
      const res = await confirmCareer(sessionId, careerName);
      setRoadmap(res.roadmap);
      setConfirmedCareer(res.confirmedCareer);
      setStage('roadmap');
    } catch {
      setError('로드맵을 만들지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setConfirmingCareer(null);
    }
  }

  function handleRestart() {
    setSessionId(null);
    setMessages([]);
    setFixedAnswers([]);
    setStepIndex(0);
    setDraftAnswer([]);
    setCandidates([]);
    setRoadmap([]);
    setConfirmedCareer(null);
    setError(null);
    setStage('questions');
  }

  const headerTitle =
    stage === 'roadmap' && confirmedCareer ? `${confirmedCareer} 로드맵` : stage === 'editAnswers' ? '답변 수정' : '진로 탐색';
  const currentQuestion = FIXED_QUESTIONS[stepIndex];

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
          </button>
          {stage !== 'questions' && <span className="screen-title">{headerTitle}</span>}
        </div>
        {stage === 'questions' && (
          <div className="onb-dots">
            {FIXED_QUESTIONS.map((_, i) => (
              <div key={i} className={'onb-dot' + (i === stepIndex ? ' active' : i < stepIndex ? ' done' : '')} />
            ))}
          </div>
        )}
        <div className="screen-header-right">
          {stage === 'chat' && (
            <>
              <button type="button" className="career-edit-icon-btn" onClick={openEditAnswers} aria-label="처음 답변 수정">
                <IconEdit />
              </button>
              <button
                type="button"
                className="career-recommend-btn"
                onClick={() => setShowConfirmModal(true)}
                disabled={sending || loadingCandidates}
              >
                추천받기
              </button>
            </>
          )}
          <AccountMenu user={user} onLogout={onLogout} onOpenSettings={onOpenSettings} onOpenOnboarding={onOpenOnboarding} onOpenProfile={onOpenProfile} />
        </div>
      </header>

      <div className="courses-body" ref={bodyRef}>
        {error && <p className="home-error">{error}</p>}
        {onboardingRequired && <p className="home-error">학과·학번 정보를 먼저 등록해야 진로를 탐색할 수 있어요.</p>}

        {loading && (
          <>
            <div className="skeleton skeleton-text skeleton-label" />
            <div className="home-card skeleton-card">
              <div className="skeleton skeleton-text skeleton-row" />
              <div className="skeleton skeleton-text skeleton-row" />
            </div>
          </>
        )}

        {!loading && !onboardingRequired && stage === 'questions' && currentQuestion && (
          <>
            <h2 className="onb-q-title">{currentQuestion.question}</h2>
            <p className="onb-q-sub">{currentQuestion.multi ? '해당하는 걸 모두 골라보세요.' : '하나를 골라주세요.'}</p>
            <div className="onb-option-list">
              {currentQuestion.options.map((option) => (
                <button
                  key={option}
                  className={'onb-option-card' + (draftAnswer.includes(option) ? ' selected' : '')}
                  onClick={() => toggleOption(option)}
                >
                  <span className="onb-option-title">{option}</span>
                </button>
              ))}
            </div>
            <button className="onb-skip-link" onClick={() => advanceQuestion([])} disabled={startingChat}>
              잘 모르겠어요, 다음으로
            </button>
            <button
              className="auth-submit-btn"
              onClick={() => advanceQuestion(draftAnswer)}
              disabled={draftAnswer.length === 0 || startingChat}
            >
              {startingChat ? '준비하는 중…' : stepIndex + 1 < FIXED_QUESTIONS.length ? '다음' : '대화 시작하기'}
            </button>
            {stepIndex > 0 && (
              <button className="onb-skip-link" onClick={goBackQuestion} disabled={startingChat}>
                이전 질문으로
              </button>
            )}
          </>
        )}

        {!loading && stage === 'editAnswers' && (
          <>
            <h2 className="onb-q-title">답변 수정</h2>
            <p className="career-edit-intro-body">
              진로 탐색을 시작할 때 답했던 질문들이에요. 답을 바꿔서 저장하면 지금까지 나눈 대화는 그대로 남고, 이후 대화부터 새 답변이 반영돼요.
            </p>
            {FIXED_QUESTIONS.map((q, qIndex) => (
              <div key={q.question} className="career-edit-question">
                <span className="career-edit-question-title">{q.question}</span>
                <div className="onb-option-list">
                  {q.options.map((option) => (
                    <button
                      key={option}
                      className={'onb-option-card' + ((editDrafts[qIndex] || []).includes(option) ? ' selected' : '')}
                      onClick={() => toggleEditOption(qIndex, option)}
                    >
                      <span className="onb-option-title">{option}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="auth-submit-btn" onClick={handleSaveEditAnswers} disabled={savingEdit}>
              {savingEdit ? '저장하는 중…' : '저장하기'}
            </button>
            <button className="onb-skip-link" onClick={() => setStage('chat')} disabled={savingEdit}>
              취소
            </button>
          </>
        )}

        {!loading && stage === 'chat' && (
          <div className="career-chat-wrap">
            {confirmedCareer ? (
              <button type="button" className="career-result-banner" onClick={() => setStage('roadmap')}>
                {confirmedCareer} 로드맵 보기
              </button>
            ) : (
              candidates.length > 0 && (
                <button type="button" className="career-result-banner" onClick={() => setStage('candidates')}>
                  만들어둔 진로 후보 보기
                </button>
              )
            )}
            <div className="career-chat-messages">
              {toChatMessages(messages).map((msg, index) => (
                <ChatBubble key={index} message={msg} />
              ))}
              {sending && (
                <div className="chat-bubble assistant">
                  <div className="message-sender">ONE Student</div>
                  <div className="typing-dots" aria-label="다음 질문을 준비하고 있어요">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        )}

        {!loading && stage === 'candidates' && (
          <>
            <p className="onb-q-sub">나눈 대화를 바탕으로 이런 진로들을 찾았어요.</p>
            <div className="career-candidate-list">
              {candidates.map((c) => (
                <div key={c.careerName} className="career-candidate-card">
                  <span className="career-candidate-title">{c.careerName}</span>
                  <p className="career-candidate-reasoning">{c.reasoning}</p>
                  <button
                    className="auth-submit-btn"
                    onClick={() => handleChooseCareer(c.careerName)}
                    disabled={confirmingCareer !== null}
                  >
                    {confirmingCareer === c.careerName ? '로드맵 만드는 중…' : '이 진로로 정할게요'}
                  </button>
                </div>
              ))}
            </div>
            <button className="onb-skip-link" onClick={() => setStage('chat')} disabled={confirmingCareer !== null}>
              더 이야기해볼게요
            </button>
          </>
        )}

        {!loading && stage === 'roadmap' && (
          <>
            <CareerRoadmapList roadmap={roadmap} />
            <button className="onb-skip-link" onClick={handleRestart}>
              다시 진단하기
            </button>
          </>
        )}
      </div>

      {stage === 'chat' && (
        <ChatInput onSendMessage={handleSendMessage} disabled={sending} onFocusChange={handleInputFocusChange} />
      )}

      {(showConfirmModal || loadingCandidates) && (
        <div
          className="career-confirm-overlay"
          onClick={() => {
            if (!loadingCandidates) setShowConfirmModal(false);
          }}
        >
          <div className="career-confirm-modal" onClick={(e) => e.stopPropagation()}>
            {loadingCandidates ? (
              <div className="career-confirm-loading">
                <div className="career-spinner" aria-hidden="true" />
                <span className="career-confirm-title">진로 후보를 만들고 있어요</span>
                <p className="career-confirm-body">대화 내용을 분석하고 있어요. 10~20초 정도 걸려요.</p>
              </div>
            ) : (
              <>
                <span className="career-confirm-title">진로를 추천해드릴까요?</span>
                <p className="career-confirm-body">
                  지금까지 나눈 대화를 바탕으로 진로 후보를 만들어드려요. 더 이야기하고 싶으면 취소하고 계속 대화할 수 있어요.
                </p>
                <button className="auth-submit-btn" onClick={handleConfirmRecommend}>
                  네, 추천받을게요
                </button>
                <button className="career-confirm-cancel" onClick={() => setShowConfirmModal(false)}>
                  더 이야기할게요
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CareerExploration;
