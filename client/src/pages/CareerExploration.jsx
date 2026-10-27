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
import LoadError from '../components/LoadError.jsx';
import CareerRoadmapList, { groupRoadmapBySemester } from '../components/CareerRoadmapList.jsx';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';
import useChatAutoScroll from '../hooks/useChatAutoScroll.js';
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
// 상담 한 번의 자유 대화 상한 — 서버(server/services/careerService.js MAX_FREE_TURNS)와 같은 값. 다 쓰면 입력창 대신 추천받기 안내를 보여준다.
const MAX_FREE_TURNS = 15;

// 진로 추천 칸이 진하게 바뀌는 자유 대화 횟수 — 이 정도 이야기하면 추천이 쓸 만해진다고 보고 정한 값(2026-10-22 사용자 결정, 3번).
// 그 전에도 "지금 받기"로 언제든 누를 수 있다. 남은 대화가 TURNS_LEFT_WARNING번 이하면 남은 횟수를 같이 알린다.
const READY_TURNS = 3;
const TURNS_LEFT_WARNING = 3;
// 대화 위 "내 답변" 칩은 이 개수를 넘으면 두 줄까지만 보이고 펼치기 버튼을 둔다.
const ANSWER_CHIPS_FOLDED = 4;

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

// 처음 답변을 고친 기록(서버 services/careerAnswerUpdates.js와 같은 표식). 원래 답은 대화 맨 앞에 그대로 두고, 바뀐 내용을
// 학생 메시지 하나로 남긴다 — 내용은 화면 언어와 무관한 표식 + JSON이라 화면은 번역해서 보여 준다(이슈 #245).
const ANSWERS_UPDATE_MARKER = '[[FIXED_ANSWERS_UPDATE]]';
function parseAnswersUpdate(message) {
  if (!message || message.role !== 'user' || typeof message.content !== 'string' || !message.content.startsWith(ANSWERS_UPDATE_MARKER)) return null;
  try {
    const value = JSON.parse(message.content.slice(ANSWERS_UPDATE_MARKER.length));
    return value && Array.isArray(value.answers) && Array.isArray(value.changes) ? value : null;
  } catch {
    return null;
  }
}

function toChatMessages(messages) {
  // 고정 질문 구간(질문+답변 쌍)은 채팅창에 다시 그리지 않는다 — 사용자가 실제로 입력한
  // 적 없는 turn까지 이미 나눈 대화처럼 보여서 "이게 뭐지" 하고 다시 읽게 되는 문제가
  // 실사용 피드백으로 확인됨. 서버로 보내는 history에는 그대로 남아 AI 컨텍스트로 쓰인다.
  // "처음부터 다시"로 고쳤으면 그 기록부터 보여 준다(이전 대화는 서버에 남지만 화면·AI에서는 감춘다).
  const rest = messages.slice(FIXED_MESSAGE_COUNT);
  const lastRestart = rest.map((m) => parseAnswersUpdate(m)).map((u) => u && u.mode === 'RESTART').lastIndexOf(true);
  return rest.slice(Math.max(0, lastRestart)).map((m) => {
    const update = parseAnswersUpdate(m);
    return update ? { sender: 'note', update } : { sender: m.role, text: m.content };
  });
}

// 채팅 시작 시 저장된 고정 질문 답변(질문/답변 쌍)을 "처음 답변 수정" 화면에 미리 채워
// 넣기 위해 역파싱한다. 저장된 답변은 advanceQuestion에서 선택지를 ', '로 이어붙인
// 문자열이라, 그 질문의 실제 선택지 목록과 대조해 다시 배열로 되돌린다.
function parseFixedAnswersFromMessages(messages) {
  // 고친 기록이 있으면 마지막 기록의 답이 지금 답이다(대화 맨 앞의 원래 답은 덮어쓰지 않는다).
  const latest = messages.slice(FIXED_MESSAGE_COUNT).map(parseAnswersUpdate).filter(Boolean).at(-1);
  return FIXED_QUESTIONS.map((q, i) => {
    const answerText = latest ? latest.answers[i] : messages[i * 2 + 1]?.content;
    if (!answerText || answerText === SKIPPED_ANSWER) return [];
    return answerText.split(', ').filter((opt) => q.options.includes(opt));
  });
}

// 고친 기록을 채팅창 안내 한 줄로 — "질문: 이전 → 새". 저장값은 한국어 선택지라 화면 언어의 선택지 이름으로 바꾼다.
function describeAnswerChanges(changes, t) {
  const answerLabel = (index, text) => {
    if (!text || text === SKIPPED_ANSWER) return t('career.answerSkipped');
    const question = FIXED_QUESTIONS[index];
    return text
      .split(', ')
      .map((opt) => {
        const optIndex = question ? question.options.indexOf(opt) : -1;
        return optIndex >= 0 ? t(`career.q.${index}.opt.${optIndex}`) : opt;
      })
      .join(', ');
  };
  return changes.map((c) => `${t(`career.q.${c.index}.title`)}: ${answerLabel(c.index, c.before)} → ${answerLabel(c.index, c.after)}`).join(' / ');
}

// "내 답변" 칩 — 질문마다 고른 선택지를 화면 언어로. 건너뛴 질문은 뺀다.
function answerChips(drafts, t) {
  return drafts.flatMap((selected, qIndex) =>
    selected.map((option) => {
      const optIndex = FIXED_QUESTIONS[qIndex].options.indexOf(option);
      return optIndex >= 0 ? t(`career.q.${qIndex}.opt.${optIndex}`) : option;
    })
  );
}

// 진로 탐색이 질문 → 대화 → 진로 추천 → 과목 로드맵으로 이어진다는 걸 대화 중에도 보여준다 — 대화 다음에 추천이 온다는 걸 몰라
// 추천받기를 찾지 못하던 문제(2026-10-22) 때문에 넣었다.
const CAREER_STEPS = ['questions', 'chat', 'candidates', 'roadmap'];
function CareerSteps({ stage }) {
  const { t } = useI18n();
  const current = CAREER_STEPS.indexOf(stage);
  return (
    <ol className="career-steps" aria-label={t('career.steps.aria')}>
      {CAREER_STEPS.map((step, i) => (
        <React.Fragment key={step}>
          {i > 0 && <li className="career-steps-line" aria-hidden="true" />}
          <li className={'career-step' + (i < current ? ' done' : i === current ? ' now' : '')} aria-current={i === current ? 'step' : undefined}>
            <span className="career-step-num" aria-hidden="true">
              {i < current ? <IconCheck size={9} /> : i + 1}
            </span>
            {t(`career.steps.${step}`)}
          </li>
        </React.Fragment>
      ))}
    </ol>
  );
}

/**
 * CareerExploration Page
 * 고정 질문(진입장벽 낮추기) → 자유 대화(AI 상담) → 진로 후보 → 확정 → 과목 로드맵.
 *
 * Props:
 * - user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile
 */
function CareerExploration({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenAdmin, onOpenInquiry }) {
  const { t, tRich, lang } = useI18n();
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

  // 대화 위 "내 답변" 칩을 다 펼쳤는지.
  const [answersExpanded, setAnswersExpanded] = useState(false);
  const [editDrafts, setEditDrafts] = useState([]); // FIXED_QUESTIONS와 같은 순서의 string[] 배열
  const [savingEdit, setSavingEdit] = useState(false);

  const bodyRef = useRef(null);

  // 지난 세션을 못 불러오면 질문 화면을 숨기고 다시 시도만 보여 준다 — 예전에는 오류 문구 아래에 1번 질문이 그대로 나와,
  // 이미 대화한 학생도 처음부터 다시 답하게 됐다(2026-10-27 화면 점검).
  const [loadFailed, setLoadFailed] = useState(false);
  const sessionUnavailable = onboardingRequired || loadFailed;
  const loadSession = () => {
    setLoadFailed(false);
    setLoading(true);
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
        else setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 진로 대화도 챗봇과 같은 규칙으로 스크롤한다 — 기다리는 동안은 맨 아래, 답이 오면 답의 첫 줄(UX 점검 2-1·2-2).
  // 같은 스크롤 영역(bodyRef)을 후보·로드맵 화면도 쓰므로 대화 화면일 때만 움직인다.
  // 키보드로 목록 높이가 바뀌는 것도 훅이 따라간다(입력창 포커스 때 따로 스크롤하지 않는 이유는 Chat.jsx 주석).
  useChatAutoScroll(bodyRef, {
    count: messages.length,
    lastSender: messages[messages.length - 1]?.role,
    waiting: sending,
    enabled: stage === 'chat',
  });

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
      else if (err.code === 'CAREER_DAILY_SESSION_LIMIT') setError(t('career.err.dailySessionLimit'));
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

  async function handleSaveEditAnswers(mode) {
    setSavingEdit(true);
    setError(null);
    try {
      const payload = FIXED_QUESTIONS.map((q, i) => ({
        question: q.question,
        answer: editDrafts[i]?.length > 0 ? editDrafts[i].join(', ') : SKIPPED_ANSWER,
      }));
      const res = await updateCareerFixedAnswers(sessionId, payload, mode, lang);
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
    } catch (err) {
      if (err.code === 'CAREER_TURN_LIMIT') {
        setMessages((prev) => prev.slice(0, -1));
        setError(t('career.turnLimit'));
        return;
      }
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
      } else if (err.code === 'CAREER_CANDIDATE_LIMIT') {
        setError(t('career.err.candidateLimit'));
      } else if (err.code === 'CAREER_CRISIS_DETECTED') {
        // 위기 신호가 있는 대화는 후보 대신 도움 안내를 보여준다(서버가 AI를 부르지 않고 막음).
        setError({ key: 'career.err.crisis', support: true });
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

  const errorText = error && (typeof error === 'object' ? t(error.key) : error);
  const currentQuestion = FIXED_QUESTIONS[stepIndex];
  const turnLimitReached = messages.filter((m) => m.role === 'user').length >= FIXED_QUESTIONS.length + MAX_FREE_TURNS;
  // 화면에 보이는 자유 대화 중 학생이 보낸 횟수("처음부터 다시"를 했으면 그 뒤부터) — 진로 추천 칸의 "n번 남았어요"와 바뀌는 시점에 쓴다.
  const freeTurns = toChatMessages(messages).filter((m) => m.sender === 'user').length;
  const turnsLeft = Math.max(0, FIXED_QUESTIONS.length + MAX_FREE_TURNS - messages.filter((m) => m.role === 'user').length);
  const recommendReady = freeTurns >= READY_TURNS;
  // 기능 사용 횟수에서 진로 추천을 몇 번째 대화에서 눌렀는지 본다(utils/track.js) — 10번부터는 한 칸으로 묶는다.
  const recommendTrack = `career.recommend.turn_${freeTurns >= 10 ? '10plus' : freeTurns}`;
  const fixedAnswerChips = stage === 'chat' ? answerChips(parseFixedAnswersFromMessages(messages), t) : [];

  // 머리글 뒤로가기 — 질문은 이전 질문으로, 답변 수정·후보·로드맵은 대화로, 그 밖에는 홈으로 한 단계씩 돌아간다.
  const handleHeaderBack = () => {
    if (stage === 'questions' && stepIndex > 0 && !startingChat) goBackQuestion();
    else if ((stage === 'editAnswers' && !savingEdit) || (stage === 'candidates' && confirmingCareer === null) || (stage === 'roadmap' && sessionId)) setStage('chat');
    else onGoHome();
  };
  const backToChat = stage === 'editAnswers' || stage === 'candidates' || (stage === 'roadmap' && sessionId);

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button
            className="back-btn"
            onClick={handleHeaderBack}
            aria-label={stage === 'questions' && stepIndex > 0 ? t('career.q.prev') : backToChat ? t('career.backToChat') : t('common.backHome')}
          >
            <IconChevronLeft />
          </button>
          <span className="screen-title">{stage === 'editAnswers' ? t('career.editTitle') : t('nav.career')}</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
          onOpenProfile={onOpenProfile}
          onOpenAdmin={onOpenAdmin}
          onOpenInquiry={onOpenInquiry}
        />
      </header>

      {!loading && stage === 'questions' && currentQuestion && !sessionUnavailable && (
        <div className="career-progress" aria-label={t('career.q.progressAria', { n: stepIndex + 1, total: FIXED_QUESTIONS.length })}>
          <div className="career-progress-bar">
            <i style={{ width: `${((stepIndex + 1) / FIXED_QUESTIONS.length) * 100}%` }} />
          </div>
          <span className="career-progress-step">
            {stepIndex + 1} / {FIXED_QUESTIONS.length}
          </span>
        </div>
      )}
      {!loading && (stage === 'chat' || stage === 'candidates' || stage === 'roadmap') && <CareerSteps stage={stage} />}

      <div className="courses-body career-body" ref={bodyRef}>
        {errorText && <p className={error.support ? 'career-support-note' : 'home-error'} role={error.support ? 'status' : undefined}>{errorText}</p>}
        {onboardingRequired && <p className="home-error">{t('career.needOnboarding')}</p>}
        {!loading && loadFailed && <LoadError message={t('career.err.load')} onRetry={loadSession} />}

        {loading && (
          <>
            <div className="skeleton skeleton-text skeleton-label" />
            <div className="home-card skeleton-card">
              <div className="skeleton skeleton-text skeleton-row" />
              <div className="skeleton skeleton-text skeleton-row" />
            </div>
          </>
        )}

        {!loading && !sessionUnavailable && stage === 'questions' && currentQuestion && (
          <div className="career-question">
            <h2 className="career-q-title">{t(`career.q.${stepIndex}.title`)}</h2>
            <p className="career-q-sub">{currentQuestion.multi ? (currentQuestion.max ? t('career.q.multiMaxHint', { max: currentQuestion.max }) : t('career.q.multiHint')) : t('career.q.singleHint')}</p>
            <div className="career-options">
              {currentQuestion.options.map((option, optIndex) => (
                <button
                  key={option}
                  type="button"
                  className={'career-option' + (draftAnswer.includes(option) ? ' active' : '')}
                  aria-pressed={draftAnswer.includes(option)}
                  onClick={() => toggleOption(option)}
                >
                  <span>{t(`career.q.${stepIndex}.opt.${optIndex}`)}</span>
                  <span className="career-option-check" aria-hidden="true">
                    <IconCheck size={11} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && stage === 'editAnswers' && (
          <div className="career-edit">
            <p className="career-edit-intro-body">{t('career.edit.intro')}</p>
            {FIXED_QUESTIONS.map((q, qIndex) => (
              <div key={q.question} className="career-edit-question">
                <span className="career-edit-question-title">{t(`career.q.${qIndex}.title`)}</span>
                <div className="career-chips">
                  {q.options.map((option, optIndex) => (
                    <button
                      key={option}
                      type="button"
                      className={'career-pick' + ((editDrafts[qIndex] || []).includes(option) ? ' active' : '')}
                      aria-pressed={(editDrafts[qIndex] || []).includes(option)}
                      onClick={() => toggleEditOption(qIndex, option)}
                    >
                      {t(`career.q.${qIndex}.opt.${optIndex}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && stage === 'chat' && (
          <div className="career-chat-wrap">
            {messages.length >= FIXED_MESSAGE_COUNT && (
              <div className="career-answers">
                <div className="career-answers-head">
                  <span>{t('career.answers.title')}</span>
                  <button type="button" onClick={openEditAnswers} aria-label={t('career.editAria')}>
                    {t('career.answers.edit')}
                  </button>
                </div>
                {fixedAnswerChips.length === 0 && <p className="career-answers-none">{t('career.answers.none')}</p>}
                <div className={answersExpanded ? 'career-chips' : 'career-chips career-chips--clamp'}>
                  {fixedAnswerChips.map((chip) => (
                    <span key={chip} className="career-chip">
                      {chip}
                    </span>
                  ))}
                </div>
                {fixedAnswerChips.length > ANSWER_CHIPS_FOLDED && (
                  <button type="button" className="career-answers-toggle" aria-expanded={answersExpanded} onClick={() => setAnswersExpanded((v) => !v)}>
                    {answersExpanded ? t('career.answers.fold') : t('career.answers.unfold', { n: fixedAnswerChips.length })}
                  </button>
                )}
              </div>
            )}
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
              {toChatMessages(messages).map((msg, index) =>
                msg.sender === 'note' ? (
                  <p key={index} className="career-support-note career-answers-note" role="status">
                    {msg.update.mode === 'RESTART'
                      ? t('career.answersRestarted', { items: describeAnswerChanges(msg.update.changes, t) })
                      : t('career.answersChanged', { items: describeAnswerChanges(msg.update.changes, t) })}
                  </p>
                ) : (
                  <ChatBubble key={index} message={msg} />
                )
              )}
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
            </div>
          </div>
        )}

        {!loading && stage === 'candidates' && (
          <div className="career-candidates">
            <h2 className="career-q-title">{t('career.candidates.title')}</h2>
            <p className="career-q-sub">{t('career.candidates.intro')}</p>
            <ol className="career-candidate-list">
              {candidates.map((c, index) => (
                <li key={c.careerName} className="career-candidate">
                  <span className="career-candidate-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="career-candidate-main">
                    <h3 className="career-candidate-title">{c.careerName}</h3>
                    <p className="career-candidate-reasoning">{c.reasoning}</p>
                    <button type="button" className="post-btn post-btn--outline" onClick={() => handleChooseCareer(c.careerName)} disabled={confirmingCareer !== null}>
                      {confirmingCareer === c.careerName ? t('career.candidates.building') : t('career.candidates.choose')}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <button className="career-text-link" onClick={() => setStage('chat')} disabled={confirmingCareer !== null}>
              {t('career.candidates.more')}
            </button>
          </div>
        )}

        {!loading && stage === 'roadmap' && (
          <div className="career-roadmap">
            {confirmedCareer && (
              <>
                <p className="career-roadmap-hero">{t('career.roadmap.mine')}</p>
                <h2 className="career-roadmap-title">{confirmedCareer}</h2>
                {roadmap.length > 0 && (
                  <p className="career-roadmap-stats">
                    {tRich('career.roadmap.stats', { terms: groupRoadmapBySemester(roadmap).length, courses: roadmap.length })}
                  </p>
                )}
              </>
            )}
            <CareerRoadmapList roadmap={roadmap} />
            <button className="career-text-link" onClick={handleRestart}>
              {t('career.restart')}
            </button>
          </div>
        )}
      </div>

      {/* 화면 아래에 붙는 버튼 — 질문(건너뛰기·다음), 답변 수정(이어서·처음부터), 대화(진로 추천 칸 + 입력창). */}
      {!loading && !sessionUnavailable && stage === 'questions' && currentQuestion && (
        <div className="career-dock">
          <div className="career-dock-row">
            <button type="button" className="career-text-btn" onClick={() => advanceQuestion([])} disabled={startingChat}>
              {t('career.q.skip')}
            </button>
            <button type="button" className="post-btn post-btn--ink post-btn--lg career-dock-main" onClick={() => advanceQuestion(draftAnswer)} disabled={draftAnswer.length === 0 || startingChat}>
              {startingChat ? t('career.q.preparing') : stepIndex + 1 < FIXED_QUESTIONS.length ? t('onb.next') : t('career.q.startChat')}
            </button>
          </div>
        </div>
      )}

      {!loading && stage === 'editAnswers' && (
        <div className="career-dock">
          <button type="button" className="post-btn post-btn--ink post-btn--lg post-btn--block" onClick={() => handleSaveEditAnswers('CONTINUE')} disabled={savingEdit}>
            {savingEdit ? t('career.edit.saving') : t('career.edit.continue')}
          </button>
          <button type="button" className="post-btn post-btn--outline post-btn--block" onClick={() => handleSaveEditAnswers('RESTART')} disabled={savingEdit}>
            {t('career.edit.restart')}
          </button>
          <p className="career-dock-hint">{t('career.edit.choiceHint')}</p>
        </div>
      )}

      {!loading && stage === 'chat' &&
        (turnLimitReached ? (
          <div className="career-dock">
            <p className="career-dock-hint">{t('career.turnLimit')}</p>
            <button type="button" className="post-btn post-btn--ink post-btn--lg post-btn--block" onClick={() => setShowConfirmModal(true)} disabled={sending || loadingCandidates} data-track="career.recommend.limit">
              {t('career.recommend')}
            </button>
          </div>
        ) : (
          <>
            {/* 진로 추천 칸 — 머리글의 작은 버튼은 대화 중에 눈에 안 띄어서(사용자 피드백 2026-10-22) 입력창 바로 위에 둔다.
                자유 대화 READY_TURNS번 전에는 회색으로 몇 번 남았는지만, 그 뒤에는 진하게 눌러 달라고 한다. 처음부터 언제든 누를 수 있다. */}
            <div className="career-recommend-bar">
              <div className={recommendReady ? 'career-recommend-card ready' : 'career-recommend-card'}>
                <div className="career-recommend-text">
                  <b>{recommendReady ? t('career.recommend.readyTitle') : t('career.recommend.waitTitle', { n: READY_TURNS - freeTurns })}</b>
                  <span>
                    {recommendReady
                      ? turnsLeft <= TURNS_LEFT_WARNING
                        ? t('career.recommend.readyLeft', { n: turnsLeft })
                        : t('career.recommend.readySub')
                      : t('career.recommend.waitSub')}
                  </span>
                </div>
                <button type="button" className="career-recommend-btn" onClick={() => setShowConfirmModal(true)} disabled={sending || loadingCandidates} data-track={recommendTrack}>
                  {recommendReady ? t('career.recommend') : t('career.recommend.now')}
                </button>
              </div>
            </div>
            <ChatInput onSendMessage={handleSendMessage} disabled={sending} placeholder={recommendReady ? t('career.input.more') : undefined} />
          </>
        ))}

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
                <button className="auth-submit-btn" onClick={handleConfirmRecommend} data-track="career.recommend.confirm">
                  {t('career.modal.yes')}
                </button>
                <button className="career-confirm-cancel" onClick={() => setShowConfirmModal(false)} data-track="career.recommend.cancel">
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
