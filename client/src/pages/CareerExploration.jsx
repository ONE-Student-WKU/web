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
import { useI18n } from '../i18n/I18nContext.jsx';

// 고정 질문의 question/options는 서버에 저장되고 AI 컨텍스트로 쓰이는 원문(한국어)이라 화면 언어와 무관하게 그대로 보낸다.
// 화면에 보이는 문구는 i18n 사전(career.q.N.title / career.q.N.opt.M)에서 같은 순서로 가져온다 — 이 배열의 순서나 개수를
// 바꾸면 사전도 같이 바꿔야 한다.
// 설계 의도: 진로를 못 정한 학생일수록 "뭘 좋아하는지"는 잘 못 느끼고 "뭐가 싫은지"만 잘 느낀다. 그래서 성향·가치나 좋아하는 것을
// 묻지 않고, 이미 겪은 일(행동·사건)에서 싫었거나 힘들었던 것을 골라 걸러내는 제외법으로 묻는다(마지막 질문만 사실을 묻는다).
// 선택지는 한 줄에 활동 하나만 쓰고 좋고 나쁨이 없게 쓴다. "딱히 없어요"는 건너뜀이 아니라 정식 답("특별히 싫은 게 없다")이라
// 선택지로 두되(exclusive) 다른 선택지와 같이 고를 수 없다. 복수 선택은 max개까지. 서버 프롬프트(aiClient.js)가 이 답들을 "피할 것"으로 읽는다.
// 선택지 문구에 ', '(쉼표+공백)를 쓰지 않는다 — 답을 ', '로 이어붙여 저장하고 parseFixedAnswersFromMessages가 그걸로 다시 쪼갠다.
const FIXED_QUESTIONS = [
  {
    question: '솔직히 하루 종일 하라면 가장 하기 싫은 일은?',
    multi: true,
    max: 2,
    exclusive: ['딱히 없어요'],
    options: [
      '계속 사람을 상대하는 일',
      '혼자 오래 집중해서 하는 일',
      '매번 새로운 상황에 대응해야 하는 일',
      '정해진 절차를 반복하는 일',
      '숫자와 자료를 꼼꼼히 다루는 일',
      '사람들 앞에서 말하거나 발표하는 일',
      '딱히 없어요',
    ],
  },
  {
    question: '최근 한두 학기 동안 해본 일 중 하다가 가장 지치거나 지루했던 건?',
    multi: true,
    max: 2,
    exclusive: ['딱히 없어요'],
    options: [
      '무언가를 직접 만들거나 고치거나 실습해본 일',
      '자료를 조사하고 원인을 따져본 일',
      '글·그림·영상·디자인으로 나를 표현해본 일',
      '다른 사람의 이야기를 들어주거나 가르쳐주거나 도와준 일',
      '사람들을 모아 일을 나누고 이끌어본 일',
      '정리·계획·기록처럼 체계를 잡아본 일',
      '딱히 없어요',
    ],
  },
  {
    question: '조별과제에서 가장 맡기 싫었거나 힘들었던 역할은?',
    multi: true,
    max: 2,
    exclusive: ['딱히 없어요', '조별과제 경험이 없어요'],
    options: [
      '자료를 찾고 정리하는 일',
      '아이디어를 내는 일',
      '일정과 역할을 조율하는 일',
      '결과물을 보기 좋게 다듬는 일',
      '막힌 부분을 해결하는 일',
      '딱히 없어요',
      '조별과제 경험이 없어요',
    ],
  },
  {
    question: '지금까지 들은 수업 중 과제가 가장 힘들게 느껴졌던 유형은?',
    multi: true,
    max: 2,
    exclusive: ['딱히 없어요', '아직 들은 수업이 많지 않아요'],
    options: [
      '개념과 이론을 이해하는 수업',
      '실습·실험·제작 수업',
      '토론·발표 중심 수업',
      '글쓰기·보고서 수업',
      '암기·시험 중심 수업',
      '딱히 없어요',
      '아직 들은 수업이 많지 않아요',
    ],
  },
  {
    question: '전공과 관련해 수업 밖에서 해본 활동은?',
    multi: false,
    options: [
      '수업 밖에서는 해본 적 없어요',
      '수업 과제나 실습 정도예요',
      '동아리·스터디·공모전·대외활동을 해봤어요',
      '인턴·현장실습·관련 일을 해봤어요',
    ],
  },
];

const FIXED_MESSAGE_COUNT = FIXED_QUESTIONS.length * 2;

// "모르겠어요" 답변의 저장값 — 서버 저장과 parseFixedAnswersFromMessages의 역파싱이 같은 문자열에 의존하므로 화면 언어와 무관하게 고정.
const SKIPPED_ANSWER = '(잘 모르겠어요, 건너뜀)';

// 선택 규칙 — 복수 선택 질문은 max개까지만 고를 수 있고(넘기면 가장 먼저 고른 것이 빠진다), exclusive에 든 선택지("딱히 없어요" 등)는
// 다른 선택지와 같이 고를 수 없다(고르면 나머지가 해제되고, 다른 걸 고르면 exclusive가 해제된다).
function toggledSelection(question, selected, option) {
  if (!question.multi) return [option];
  if (selected.includes(option)) return selected.filter((o) => o !== option);
  const exclusive = question.exclusive || [];
  if (exclusive.includes(option)) return [option];
  const next = [...selected.filter((o) => !exclusive.includes(o)), option];
  return question.max && next.length > question.max ? next.slice(next.length - question.max) : next;
}

// 불러오기 실패처럼 이펙트 안에서 세팅되는 오류는 번역 함수에 의존하지 않도록 문구 대신 키를 담고, 렌더에서 번역한다.
const LOAD_ERROR = { key: 'career.err.load' };

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
    if (!answerText || answerText === SKIPPED_ANSWER) return [];
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
function CareerExploration({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenAdmin, onOpenInquiry, onInputFocusChange }) {
  const { t, lang } = useI18n();
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
        else setError(LOAD_ERROR);
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
    setDraftAnswer((prev) => toggledSelection(question, prev, option));
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
        answer: a.selected.length > 0 ? a.selected.join(', ') : SKIPPED_ANSWER,
      }));
      const res = await submitCareerFixedAnswers(sid, payload, lang);
      setMessages(res.messages);
      setStage('chat');
    } catch (err) {
      if (err.code === 'ONBOARDING_REQUIRED') setOnboardingRequired(true);
      else setError(t('career.err.start'));
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
    setEditDrafts((prev) => prev.map((selected, i) => (i === questionIndex ? toggledSelection(question, selected, option) : selected)));
  }

  async function handleSaveEditAnswers() {
    setSavingEdit(true);
    setError(null);
    try {
      const payload = FIXED_QUESTIONS.map((q, i) => ({
        question: q.question,
        answer: editDrafts[i]?.length > 0 ? editDrafts[i].join(', ') : SKIPPED_ANSWER,
      }));
      const res = await updateCareerFixedAnswers(sessionId, payload);
      setMessages(res.messages);
      setStage('chat');
    } catch {
      setError(t('career.err.saveAnswers'));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSendMessage(text) {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setSending(true);
    setError(null);
    try {
      const res = await sendCareerMessage(sessionId, text, lang);
      setMessages(res.messages);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: t('chat.error') }]);
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
      const res = await generateCareerCandidates(sessionId, lang);
      setCandidates(res.candidates);
      setStage('candidates');
    } catch (err) {
      if (err.code === 'CAREER_CANDIDATES_EMPTY') {
        setError(t('career.err.candidatesEmpty'));
      } else {
        setError(t('career.err.candidates'));
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
      const res = await confirmCareer(sessionId, careerName, lang);
      setRoadmap(res.roadmap);
      setConfirmedCareer(res.confirmedCareer);
      setStage('roadmap');
    } catch {
      setError(t('career.err.roadmap'));
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
    stage === 'roadmap' && confirmedCareer
      ? t('career.roadmapTitle', { career: confirmedCareer })
      : stage === 'editAnswers'
        ? t('career.editTitle')
        : t('nav.career');
  const errorText = error && (typeof error === 'object' ? t(error.key) : error);
  const currentQuestion = FIXED_QUESTIONS[stepIndex];
  // 자유 대화를 몇 번 나눴는데도 "추천받기"가 있는 걸 못 알아채는 경우를 위한 안내 —
  // 과목 추가의 "한 번에 채우려면?" 말풍선과 같은 패턴. 자유 대화 메시지 4개(사용자+AI
  // 2턴) 이상 쌓이면 보여주고, 후보를 이미 받았으면(chat 단계를 벗어나면) 자연히 사라진다.
  const showRecommendHint = stage === 'chat' && messages.length - FIXED_MESSAGE_COUNT >= 4;

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label={t('common.backHome')}>
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
              <button type="button" className="career-edit-icon-btn" onClick={openEditAnswers} aria-label={t('career.editAria')}>
                <IconEdit />
              </button>
              <div className="career-recommend-hint-wrap">
                {showRecommendHint && (
                  <span className="career-recommend-hint-bubble">{t('career.recommendHint')}</span>
                )}
                <button
                  type="button"
                  className="career-recommend-btn"
                  onClick={() => setShowConfirmModal(true)}
                  disabled={sending || loadingCandidates}
                >
                  {t('career.recommend')}
                </button>
              </div>
            </>
          )}
          <AccountMenu
            user={user}
            onLogout={onLogout}
            onOpenSettings={onOpenSettings}
            onOpenOnboarding={onOpenOnboarding}
            onOpenProfile={onOpenProfile}
            onOpenAdmin={onOpenAdmin}
            onOpenInquiry={onOpenInquiry}
          />
        </div>
      </header>

      <div className="courses-body" ref={bodyRef}>
        {errorText && <p className="home-error">{errorText}</p>}
        {onboardingRequired && <p className="home-error">{t('career.needOnboarding')}</p>}

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
            <h2 className="onb-q-title">{t(`career.q.${stepIndex}.title`)}</h2>
            <p className="onb-q-sub">{currentQuestion.multi ? (currentQuestion.max ? t('career.q.multiMaxHint', { max: currentQuestion.max }) : t('career.q.multiHint')) : t('career.q.singleHint')}</p>
            <div className="onb-option-list">
              {currentQuestion.options.map((option, optIndex) => (
                <button
                  key={option}
                  className={'onb-option-card' + (draftAnswer.includes(option) ? ' selected' : '')}
                  onClick={() => toggleOption(option)}
                >
                  <span className="onb-option-title">{t(`career.q.${stepIndex}.opt.${optIndex}`)}</span>
                </button>
              ))}
            </div>
            <button className="onb-skip-link" onClick={() => advanceQuestion([])} disabled={startingChat}>
              {t('career.q.skip')}
            </button>
            <button
              className="auth-submit-btn"
              onClick={() => advanceQuestion(draftAnswer)}
              disabled={draftAnswer.length === 0 || startingChat}
            >
              {startingChat ? t('career.q.preparing') : stepIndex + 1 < FIXED_QUESTIONS.length ? t('onb.next') : t('career.q.startChat')}
            </button>
            {stepIndex > 0 && (
              <button className="onb-skip-link" onClick={goBackQuestion} disabled={startingChat}>
                {t('career.q.prev')}
              </button>
            )}
          </>
        )}

        {!loading && stage === 'editAnswers' && (
          <>
            <h2 className="onb-q-title">{t('career.editTitle')}</h2>
            <p className="career-edit-intro-body">
              {t('career.edit.intro')}
            </p>
            {FIXED_QUESTIONS.map((q, qIndex) => (
              <div key={q.question} className="career-edit-question">
                <span className="career-edit-question-title">{t(`career.q.${qIndex}.title`)}</span>
                <div className="onb-option-list">
                  {q.options.map((option, optIndex) => (
                    <button
                      key={option}
                      className={'onb-option-card' + ((editDrafts[qIndex] || []).includes(option) ? ' selected' : '')}
                      onClick={() => toggleEditOption(qIndex, option)}
                    >
                      <span className="onb-option-title">{t(`career.q.${qIndex}.opt.${optIndex}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="auth-submit-btn" onClick={handleSaveEditAnswers} disabled={savingEdit}>
              {savingEdit ? t('career.edit.saving') : t('career.edit.save')}
            </button>
            <button className="onb-skip-link" onClick={() => setStage('chat')} disabled={savingEdit}>
              {t('onb.cancel')}
            </button>
          </>
        )}

        {!loading && stage === 'chat' && (
          <div className="career-chat-wrap">
            {confirmedCareer ? (
              <button type="button" className="career-result-banner" onClick={() => setStage('roadmap')}>
                {t('career.banner.roadmap', { career: confirmedCareer })}
              </button>
            ) : (
              candidates.length > 0 && (
                <button type="button" className="career-result-banner" onClick={() => setStage('candidates')}>
                  {t('career.banner.candidates')}
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
                  <div className="typing-dots" aria-label={t('career.typing')}>
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
            <p className="onb-q-sub">{t('career.candidates.intro')}</p>
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
                    {confirmingCareer === c.careerName ? t('career.candidates.building') : t('career.candidates.choose')}
                  </button>
                </div>
              ))}
            </div>
            <button className="onb-skip-link" onClick={() => setStage('chat')} disabled={confirmingCareer !== null}>
              {t('career.candidates.more')}
            </button>
          </>
        )}

        {!loading && stage === 'roadmap' && (
          <>
            <CareerRoadmapList roadmap={roadmap} />
            <button className="onb-skip-link" onClick={handleRestart}>
              {t('career.restart')}
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
                <span className="career-confirm-title">{t('career.modal.loadingTitle')}</span>
                <p className="career-confirm-body">{t('career.modal.loadingBody')}</p>
              </div>
            ) : (
              <>
                <span className="career-confirm-title">{t('career.modal.title')}</span>
                <p className="career-confirm-body">
                  {t('career.modal.body')}
                </p>
                <button className="auth-submit-btn" onClick={handleConfirmRecommend}>
                  {t('career.modal.yes')}
                </button>
                <button className="career-confirm-cancel" onClick={() => setShowConfirmModal(false)}>
                  {t('career.modal.no')}
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
