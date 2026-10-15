import React, { useEffect, useState } from 'react';
import { getDepartments, getTracks, submitOnboarding, updateProfile, saveLeavePeriods } from '../api/chatApi.js';
import { IconChevronLeft, IconEdit } from '../components/icons.jsx';
import { getYearRange, describeSuccessors, transferCohortYear, transferYearOf, TRANSFER_GRADES } from '../utils/onboardingYears.js';
import DepartmentPicker from '../components/DepartmentPicker.jsx';
import LeavePeriodsEditor, { draftFromPeriods, periodsFromDraft, describeLeave, leaveErrorKey } from '../components/LeavePeriodsEditor.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

const NOW_YEAR = new Date().getFullYear();
// 휴학은 다음 학기 것까지 받는다 — 2학기(9월~)에는 다음 학기가 다음 학년도 1학기다.
const LEAVE_LAST_YEAR = new Date().getMonth() >= 8 ? NOW_YEAR + 1 : NOW_YEAR;

function isTransferAvailable(department) {
  const range = getYearRange(department, 'TRANSFER_ADMISSION');
  return range.min <= range.max;
}

// 전과연도-입학년도 차이로 "정상 진급 학년"(naive)을 구하고, 휴학 등으로 실제 학년이
// 계산보다 늦어질 수는 있어도(최대 2년) 앞설 수는 없다는 원칙으로 선택지를 좁힌다.
function getMajorChangeGradeRange(admissionYear, majorChangeYear) {
  const naive = majorChangeYear - admissionYear + 1;
  return { min: Math.max(1, naive - 2), max: Math.min(4, naive), naive };
}

// 교직과정 질문을 보일지: 학과에 교직기본이수 요건이 있는 학번이고, 편입생·3학년 이상 전과생이 아니어야 한다(책자 교직과정 이수 안내,
// 서버 services/teachingCourse.js와 같은 규칙, DECISIONS D-67).
function isTeachingCourseAvailable(department, { enrollmentType, majorChangeGrade, admissionYear }) {
  const years = department?.teachingCourseYears;
  if (!years || admissionYear == null) return false;
  if ((years.min != null && admissionYear < years.min) || (years.max != null && admissionYear > years.max)) return false;
  if (enrollmentType === 'TRANSFER_ADMISSION') return false;
  if (enrollmentType === 'MAJOR_CHANGE' && majorChangeGrade >= 3) return false;
  return true;
}

// 편입 인정학점 입력칸(선택). 비워 두면 학교 기준 인정학점으로 계산한다. 0~160 정수만 받는다(서버 MAX_TRANSFER_RECOGNIZED_CREDITS).
function parseRecognizedCredits(text) {
  if (text === '') return { value: null, valid: true };
  if (!/^\d+$/.test(text) || Number(text) > 160) return { value: null, valid: false };
  return { value: Number(text), valid: true };
}

function range(min, max) {
  if (max < min) return [];
  return Array.from({ length: max - min + 1 }, (_, i) => max - i);
}

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 캐시해둔다.
// 학과 목록은 자주 안 바뀌는 참조 데이터라 세션 내내 캐시해도 안전하다.
let cachedDepartments = null;

// 요약 화면의 한 줄 — editable이면 탭해서 해당 질문으로 이동할 수 있다. value가 비어있으면
// (앞선 항목을 고치면서 연쇄적으로 지워진 경우 등) 값 대신 "선택 필요"를 강조색으로 보여줘서,
// 무효해진 조합이 조용히 남아있지 않고 반드시 눈에 띄게 한다.
function SummaryRow({ label, value, editable, onClick }) {
  const { t } = useI18n();
  const valueEl = (
    <span className={value ? 'onb-summary-val' : 'onb-summary-val onb-summary-val-warning'}>{value || t('onb.required')}</span>
  );
  if (!editable) {
    return (
      <div className="onb-summary-row">
        <span className="onb-summary-key">{label}</span>
        {valueEl}
      </div>
    );
  }
  return (
    <button type="button" className="onb-summary-row onb-summary-row-editable" onClick={onClick}>
      <span className="onb-summary-key">{label}</span>
      <span className="onb-summary-row-right">
        {valueEl}
        <IconEdit size={15} />
      </span>
    </button>
  );
}

/**
 * Onboarding Page
 * 회원가입 직후 자동 진입하거나, 계정 메뉴의 "학과, 학번 수정"에서 재진입.
 * 학과 → (세부전공) → 입학유형 → 학번(편입생은 편입 연도·학년) → (전과 시점) → 확인 → 완료.
 *
 * Props:
 * - user: object (onboardingCompleted 여부로 최초 등록(POST)/재설정(PATCH) 분기)
 * - onDone: function
 * - onSkip: function
 * - highlightLeaveSemesters: boolean — 홈의 "학년이 다르신가요?" 링크로 들어왔을 때만 true,
 *   요약 화면의 휴학 학기 수 항목에 강조 애니메이션을 준다.
 */

// 세부전공 "없음"이 뜻을 갖는 학과. 약학과는 세부전공이 "2+4년제" 하나뿐인데, 2022학번부터의 6년제 과목은 세부전공 없이(track 없음) 들어 있다.
// 그래서 "6년제(세부전공 없음)"을 따로 고르게 하고, 고르면 trackId를 null로 보낸다(이슈 #352, DECISIONS D-63).
const NO_TRACK = 'NONE';
const NO_TRACK_DEPARTMENTS = {
  약학과: {
    nameKey: 'onb.track.pharm6',
    captionKey: 'onb.track.pharm6.caption',
    titleKey: 'onb.track.pharm.title',
    subKey: 'onb.track.pharm.sub',
    trackCaptionKeys: { '2+4년제': 'onb.track.pharm24.caption' },
    noTrackFromYear: 2022,
    checkKey: 'onb.track.pharm24.check',
  },
};

function Onboarding({ user, onDone, onSkip, highlightLeaveSemesters }) {
  const { t } = useI18n();
  // 최초 온보딩(회원가입 직후)은 처음부터 순서대로 걷지만, 이미 완료한 사용자가 "학적정보
  // 수정"으로 재진입하면 기존 값이 채워진 요약 화면으로 바로 들어가 필요한 항목만 고쳐서
  // 저장한다 — 매번 학과부터 다시 고르게 하던 문제(실사용 피드백) 해결.
  const editMode = !!user?.onboardingCompleted;

  const [departments, setDepartments] = useState(cachedDepartments || []);
  const [departmentsLoading, setDepartmentsLoading] = useState(cachedDepartments === null);
  const [tracks, setTracks] = useState([]);
  const [confirmNoDepartment, setConfirmNoDepartment] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  // null이면 평소처럼 stepIndex로 진행되는 선형 흐름. 요약 화면에서 항목을 탭하면 그 질문의
  // 이름으로 설정되어 해당 화면을 보여주고, "확인"을 누르면 선형 흐름을 이어가지 않고 다시
  // 요약 화면으로 돌아간다 — 필드 하나만 고치려고 나머지 질문을 전부 다시 걷지 않게 하기 위함.
  const [manualStep, setManualStep] = useState(editMode ? 'summary' : null);

  const [answers, setAnswers] = useState({
    departmentId: editMode ? user.departmentId : null,
    // 세부전공 없음이 뜻을 갖는 학과(약학과 6년제)는 저장된 null을 "없음을 골랐다"로 되살린다.
    trackId: editMode ? user.trackId ?? (NO_TRACK_DEPARTMENTS[user.department] ? NO_TRACK : null) : null,
    enrollmentType: editMode ? user.enrollmentType : null,
    admissionYear: editMode ? user.admissionYear : null,
    majorChangeYear: editMode ? user.majorChangeYear : null,
    majorChangeSemester: editMode ? user.majorChangeSemester : null,
    majorChangeGrade: editMode ? user.majorChangeGrade : null,
    // 편입생 전용. 학번(admissionYear)은 편입 연도 − 편입 학년 + 1로 정해지고(제14조③), 편입 연도는 저장하지 않고 학번 + 학년 − 1로 되돌린다.
    // 옛 방식으로 입력한 편입생은 transferGrade가 없어 둘 다 null — 요약 화면에서 "선택 필요"로 보여 다시 입력하게 한다.
    transferGrade: editMode ? user.transferGrade ?? null : null,
    transferYear: editMode ? transferYearOf(user.admissionYear, user.transferGrade) : null,
    // 편입할 때 인정받은 학점(선택, 입력칸 글자 그대로). 교직과정 이수 여부(true/false/null = 답하지 않음).
    transferRecognizedInput: editMode && user.transferRecognizedCredits != null ? String(user.transferRecognizedCredits) : '',
    teachingCourse: editMode ? user.teachingCourse ?? null : null,
    // 휴학 기간(LeavePeriodsEditor의 draft). 기능 도입 전 계정은 user.leavePeriods가 null이라 "선택 필요"로 시작한다.
    leaveDraft: draftFromPeriods(editMode ? user.leavePeriods : null),
  });

  useEffect(() => {
    getDepartments()
      .then((data) => {
        setDepartments(data);
        cachedDepartments = data;
      })
      .catch(() => setLoadError('onb.err.departments'))
      .finally(() => setDepartmentsLoading(false));
  }, []);

  // 재진입 시 기존에 선택돼 있던 학과의 세부전공 목록을 불러온다(있어야 hasTracks가 맞게
  // 계산되고, 요약 화면에 세부전공 이름을 보여줄 수 있다). selectDepartment와 달리 기존
  // 선택값(trackId 등)은 이미 유효한 값이라 건드리지 않는다.
  useEffect(() => {
    if (!editMode || !user?.departmentId) return;
    getTracks(user.departmentId)
      .then(setTracks)
      .catch(() => setTracks([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedDepartment = departments.find((d) => d.id === answers.departmentId) || null;
  const hasTracks = tracks.length > 0;
  const noTrackOption = selectedDepartment ? NO_TRACK_DEPARTMENTS[selectedDepartment.name] || null : null;
  const trackChoices = noTrackOption
    ? [{ id: NO_TRACK, name: t(noTrackOption.nameKey), captionKey: noTrackOption.captionKey }, ...tracks.map((tr) => ({ ...tr, captionKey: noTrackOption.trackCaptionKeys[tr.name] || null }))]
    : tracks;
  const selectedTrackName = trackChoices.find((tr) => tr.id === answers.trackId)?.name;
  // 약학과 2022학번 이후 일반 입학인데 2+4년제를 골랐으면 한 번 더 확인하게 한다(막지는 않는다 — 예외가 있을 수 있다, DECISIONS D-63).
  const trackCheckKey =
    noTrackOption && answers.trackId != null && answers.trackId !== NO_TRACK && answers.enrollmentType === 'GENERAL' &&
    answers.admissionYear >= noTrackOption.noTrackFromYear
      ? noTrackOption.checkKey
      : null;

  const path = ['department'];
  if (hasTracks) path.push('track');
  const isTransfer = answers.enrollmentType === 'TRANSFER_ADMISSION';
  path.push('enrollmentType', isTransfer ? 'transfer' : 'year');
  if (answers.enrollmentType === 'MAJOR_CHANGE') path.push('majorChange');
  const teachingAvailable = isTeachingCourseAvailable(selectedDepartment, answers);
  if (teachingAvailable) path.push('teaching');
  path.push('leave', 'summary', 'done');
  const recognized = parseRecognizedCredits(answers.transferRecognizedInput);

  // manualStep이 있으면(요약 화면에서 특정 질문으로 점프한 상태) 선형 stepIndex보다 우선한다.
  const current = manualStep || path[Math.min(stepIndex, path.length - 1)];
  // 요약 화면 자체로의 점프('summary')는 "선형 흐름 재시작"이 아니라 "필드 하나만 고치고
  // 돌아가는 중"인 다른 상태와 구분해야 다음/뒤로 버튼 동작을 다르게 줄 수 있다.
  const editingFromSummary = manualStep !== null && manualStep !== 'summary';

  // highlightLeaveSemesters는 Onboarding 화면에 머무는 동안 계속 true로 유지되는데, 요약
  // 화면은 다른 질문으로 점프했다 돌아올 때마다 새로 마운트된다 — CSS 애니메이션은 새로
  // 마운트된 엘리먼트에 클래스가 처음 붙는 것으로 취급해 재방문할 때마다 강조가 다시
  // 재생되는 문제가 있었다(실사용 확인). 이번 화면 진입에서 딱 한 번만 재생되도록, 처음
  // 요약 화면에 도달한 시점에 "다 썼다"고 표시해서 이후 재마운트에는 더 이상 안 켜지게 한다.
  const [leaveHighlightArmed, setLeaveHighlightArmed] = useState(highlightLeaveSemesters);
  useEffect(() => {
    if (current !== 'summary' || !leaveHighlightArmed) return;
    const timer = setTimeout(() => setLeaveHighlightArmed(false), 2100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // 사범대학은 선발 없이 교직과정을 이수하므로 "이수하고 있어요"를 미리 골라 둔다. 교직을 포기한 학생은 직접 바꾼다(D-67).
  useEffect(() => {
    if (teachingAvailable && selectedDepartment?.teacherCollege && answers.teachingCourse === null) {
      setAnswers((a) => ({ ...a, teachingCourse: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teachingAvailable, selectedDepartment]);

  // 학과가 바뀌어 편입생 조합이 더 이상 성립하지 않게 되면 선택을 되돌린다.
  useEffect(() => {
    if (answers.enrollmentType === 'TRANSFER_ADMISSION' && selectedDepartment && !isTransferAvailable(selectedDepartment)) {
      setAnswers((a) => ({ ...a, enrollmentType: null, admissionYear: null, transferYear: null, transferGrade: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartment]);

  const yearRange = selectedDepartment ? getYearRange(selectedDepartment, answers.enrollmentType) : null;
  const yearOptions = yearRange ? range(yearRange.min, yearRange.max) : [];

  // 학번 선택지가 하나뿐이면(예: 공학3계열은 2026학번만 존재) 사용자가 그 하나를 굳이 직접
  // 눌러 고르게 하지 않고 자동으로 채운다 — 유일한 선택지를 누르게 하는 것 자체가 불필요한
  // 클릭이라는 실사용 피드백 반영.
  // (편입생은 학번을 직접 고르지 않고 편입 연도·학년에서 계산하므로 제외한다.)
  useEffect(() => {
    if (!isTransfer && yearOptions.length === 1 && answers.admissionYear !== yearOptions[0]) {
      setAnswers((a) => ({ ...a, admissionYear: yearOptions[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartment, answers.enrollmentType]);

  // 편입생: 편입 연도·학년을 고르면 적용 학번(= 편입 연도 − 학년 + 1)을 계산해 학번 답으로 쓴다. 그 학번의 졸업요건 자료가 이 학과에 없으면
  // (예: 너무 옛날에 편입) 학번을 비워 다음으로 못 넘어가게 하고 안내를 보여 준다.
  const transferCohort = transferCohortYear(answers.transferYear, answers.transferGrade);
  const transferCohortValid =
    transferCohort != null && yearRange != null && transferCohort >= yearRange.min && transferCohort <= yearRange.max;
  const transferYearOptions = yearRange ? range(yearRange.min + 1, NOW_YEAR) : [];

  useEffect(() => {
    if (!isTransfer || (answers.transferYear == null && answers.transferGrade == null)) return;
    const next = transferCohortValid ? transferCohort : null;
    if (answers.admissionYear !== next) setAnswers((a) => ({ ...a, admissionYear: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransfer, answers.transferYear, answers.transferGrade, transferCohortValid, transferCohort]);

  const mcYearOptions = answers.admissionYear ? range(answers.admissionYear, NOW_YEAR) : [];

  // 입학한 바로 그 해에는 최소 한 학기(1학기)를 다녀야 전과할 수 있어, 전과연도가
  // 입학년도와 같으면 1학기 전과는 불가능하고 2학기부터만 가능하다.
  const firstSemesterBlocked = answers.majorChangeYear != null && answers.majorChangeYear === answers.admissionYear;

  // 위 규칙으로 1학기가 막혔는데 이미 1학기가 선택돼 있으면(연도를 되돌린 경우 등) 지운다.
  useEffect(() => {
    if (firstSemesterBlocked && answers.majorChangeSemester === 1) {
      setAnswers((a) => ({ ...a, majorChangeSemester: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstSemesterBlocked]);

  const gradeRange =
    answers.admissionYear && answers.majorChangeYear
      ? getMajorChangeGradeRange(answers.admissionYear, answers.majorChangeYear)
      : null;
  const gradeOptions = gradeRange ? range(gradeRange.min, gradeRange.max) : [];

  // 전과 연도가 바뀌어 이전에 고른 학년이 더 이상 선택지에 없으면 지운다.
  useEffect(() => {
    if (gradeRange && answers.majorChangeGrade && (answers.majorChangeGrade < gradeRange.min || answers.majorChangeGrade > gradeRange.max)) {
      setAnswers((a) => ({ ...a, majorChangeGrade: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers.majorChangeYear, answers.admissionYear]);

  // 학번 자동선택과 동일한 이유 — 전과 당시 학년 선택지가 하나뿐이면(예: 입학 그 해에 바로
  // 전과) 직접 누르게 하지 않고 자동으로 채운다.
  useEffect(() => {
    if (gradeOptions.length === 1 && answers.majorChangeGrade !== gradeOptions[0]) {
      setAnswers((a) => ({ ...a, majorChangeGrade: gradeOptions[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers.majorChangeYear, answers.admissionYear]);

  // 학번이 바뀌면 전과연도 선택지(mcYearOptions = admissionYear~현재) 범위도 같이 바뀐다 —
  // 이전에 고른 전과연도가 새 학번보다 이르면 더 이상 유효하지 않은 조합이라 통째로 지운다
  // (연도가 지워지면 그 아래 종속인 학기·학년도 자연히 다시 골라야 함).
  useEffect(() => {
    if (answers.majorChangeYear != null && answers.admissionYear != null && answers.majorChangeYear < answers.admissionYear) {
      setAnswers((a) => ({ ...a, majorChangeYear: null, majorChangeSemester: null, majorChangeGrade: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers.admissionYear]);

  function selectDepartment(dept) {
    // 학과가 바뀌면 세부전공·학번뿐 아니라 그 아래 종속인 전과 시점(연도/학기/학년)도 전부
    // 무효해진다 — 학번이 지워지는데 전과연도만 남아있으면 "2024학번인데 전과는 2021년에
    // 했다"처럼 앞뒤가 안 맞는 조합이 그대로 남는 문제(실사용 우려사항)가 생기기 때문에
    // 한 번에 같이 지운다.
    setAnswers((a) => ({
      ...a,
      departmentId: dept.id,
      trackId: null,
      admissionYear: null,
      majorChangeYear: null,
      majorChangeSemester: null,
      majorChangeGrade: null,
      transferYear: null,
      transferGrade: null,
      // 교직 답은 학과마다 다르다(사범대학이면 위 이펙트가 다시 "이수 중"을 골라 둔다).
      teachingCourse: null,
    }));
    setTracks([]);
    return getTracks(dept.id)
      .then(setTracks)
      .catch(() => setTracks([]));
  }

  // 검색 결과에서 학과를 고르거나 목록에서 엔터로 고르면 바로 다음 질문으로 넘어간다("다음"을 따로 누르지 않게). 세부전공 목록을 받은 뒤에 넘어가야
  // 세부전공이 있는 학과(공학3계열 등)가 "입학 유형"을 잠깐 보였다가 "세부전공"으로 바뀌지 않는다. 요약에서 고치러 왔으면 요약으로 돌아간다.
  function selectDepartmentAndContinue(dept) {
    selectDepartment(dept).then(goNext);
  }

  // 입학유형을 바꿔도 학번 범위가 실제로는 안 바뀌는 경우가 많다(편입생만 올해 학번이 빠지는
  // 정도) — 그런데도 무조건 학번을 지워버리면, 이미 유효한 학번을 고른 뒤 유형만 다시
  // 고쳐도 학번을 처음부터 다시 골라야 하는 불필요한 되돌림이 생긴다(실사용 확인). 새
  // 유형 기준으로 지금 학번이 여전히 유효한 범위인지 직접 계산해서, 무효할 때만 지운다.
  function selectEnrollmentType(type) {
    setAnswers((a) => {
      const newRange = selectedDepartment ? getYearRange(selectedDepartment, type) : null;
      const admissionYearStillValid =
        newRange && a.admissionYear != null && a.admissionYear >= newRange.min && a.admissionYear <= newRange.max;
      const isMajorChange = type === 'MAJOR_CHANGE';
      const toTransfer = type === 'TRANSFER_ADMISSION';
      const wasTransfer = a.enrollmentType === 'TRANSFER_ADMISSION';
      return {
        ...a,
        enrollmentType: type,
        // 편입생의 학번은 편입 연도·학년에서 계산되는 값이라, 다른 유형에서 직접 고른 학번을 이어받지 않는다.
        admissionYear: admissionYearStillValid && !(toTransfer && !wasTransfer) ? a.admissionYear : null,
        // 편입생이 아닌 유형으로 바뀌면 편입 연도·학년 답변은 의미가 없으니 같이 지운다.
        transferYear: toTransfer ? a.transferYear : null,
        transferGrade: toTransfer ? a.transferGrade : null,
        // 전과생이 아닌 유형으로 바뀌면 전과 시점 답변은 더 이상 의미가 없으니 같이 지운다.
        majorChangeYear: isMajorChange ? a.majorChangeYear : null,
        majorChangeSemester: isMajorChange ? a.majorChangeSemester : null,
        majorChangeGrade: isMajorChange ? a.majorChangeGrade : null,
      };
    });
  }

  function goNext() {
    // 요약 화면에서 항목을 탭해 들어온 질문이면, 선형 흐름을 계속 이어가지 않고 요약
    // 화면으로 돌아간다 — 이 필드 하나만 고치러 온 것이지 전체 흐름을 다시 걷는 게 아니다.
    if (editingFromSummary) {
      setManualStep('summary');
      return;
    }
    setStepIndex((i) => Math.min(i + 1, path.length - 1));
  }
  // 학과 단계의 "다음"은 고르기 전에도 누를 수 있다(비활성 버튼이 목록 위에 붕 떠 보였다). 학과 없이 누르면 그대로 넘어갈지 묻는다 —
  // 뒤의 질문(세부전공·학번·입학 유형 등)은 모두 학과 기준이라 학과 없이는 의미가 없어, 넘어가면 "나중에 선택하기"와 같다(onSkip).
  function handleNext() {
    if (current === 'department' && !answers.departmentId) {
      setConfirmNoDepartment(true);
      return;
    }
    goNext();
  }

  // 학과 없이 넘어갈지 묻는 창에서 ESC는 "학과 고르기"와 같다 — 창을 닫고 학과 목록으로 돌아간다.
  useEffect(() => {
    if (!confirmNoDepartment) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setConfirmNoDepartment(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmNoDepartment]);

  function goBack() {
    if (editingFromSummary) {
      setManualStep('summary');
      return;
    }
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const summaryIncomplete =
    !answers.departmentId ||
    !answers.admissionYear ||
    !answers.enrollmentType ||
    (hasTracks && !answers.trackId) ||
    (answers.enrollmentType === 'MAJOR_CHANGE' &&
      !(answers.majorChangeYear && answers.majorChangeSemester && answers.majorChangeGrade)) ||
    (isTransfer && !(answers.transferYear && answers.transferGrade && recognized.valid)) ||
    (teachingAvailable && answers.teachingCourse === null) ||
    periodsFromDraft(answers.leaveDraft) === null;

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    const isMajorChange = answers.enrollmentType === 'MAJOR_CHANGE';
    const payload = {
      departmentId: answers.departmentId,
      admissionYear: answers.admissionYear,
      enrollmentType: answers.enrollmentType,
      trackId: hasTracks && answers.trackId !== NO_TRACK ? answers.trackId : null,
      majorChangeGrade: isMajorChange ? answers.majorChangeGrade : null,
      majorChangeYear: isMajorChange ? answers.majorChangeYear : null,
      majorChangeSemester: isMajorChange ? answers.majorChangeSemester : null,
      transferGrade: isTransfer ? answers.transferGrade : null,
      transferRecognizedCredits: isTransfer ? recognized.value : null,
      teachingCourse: teachingAvailable ? answers.teachingCourse : null,
    };
    try {
      if (user?.onboardingCompleted) {
        await updateProfile(payload);
      } else {
        await submitOnboarding(payload);
      }
    } catch {
      setSubmitError(t('onb.err.save'));
      setSubmitting(false);
      return;
    }
    // 휴학 기간은 학번·편입 학년이 저장된 뒤에 보낸다(서버가 "입학 전 학기인지"를 그 값으로 검사한다).
    try {
      await saveLeavePeriods(periodsFromDraft(answers.leaveDraft));
      setManualStep(null);
      setStepIndex(path.indexOf('done'));
    } catch (err) {
      setSubmitError(t(leaveErrorKey(err.code)));
    } finally {
      setSubmitting(false);
    }
  }

  const nextDisabled =
    (current === 'track' && !answers.trackId) ||
    (current === 'enrollmentType' && !answers.enrollmentType) ||
    (current === 'year' && !answers.admissionYear) ||
    (current === 'transfer' && !(answers.transferYear && answers.transferGrade && transferCohortValid && recognized.valid)) ||
    (current === 'teaching' && answers.teachingCourse === null) ||
    (current === 'majorChange' && !(answers.majorChangeYear && answers.majorChangeSemester && answers.majorChangeGrade)) ||
    (current === 'leave' && periodsFromDraft(answers.leaveDraft) === null);

  const transferAvailable = selectedDepartment ? isTransferAvailable(selectedDepartment) : true;

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          {(stepIndex > 0 || editingFromSummary) && current !== 'done' && (
            <button className="back-btn" onClick={goBack} aria-label={editingFromSummary ? t('onb.backToSummary') : t('onb.prevQuestion')}>
              <IconChevronLeft />
            </button>
          )}
        </div>
        {current !== 'done' && current !== 'summary' && !editingFromSummary && (
          <div className="onb-dots">
            {path
              .filter((s) => s !== 'done')
              .map((s, i) => (
                <div key={s} className={'onb-dot' + (i === stepIndex ? ' active' : i < stepIndex ? ' done' : '')} />
              ))}
          </div>
        )}
        <div style={{ width: 28, flexShrink: 0 }} />
      </header>

      <div className="courses-body">
        {loadError && <p className="home-error">{t(loadError)}</p>}
        {submitError && <p className="home-error">{submitError}</p>}
        {current !== 'done' && !editingFromSummary && (
          // 홈의 "학년이 다르신가요?"와 같은 모양. 바로 뒤에 오는 질문 제목과 같은 줄 오른쪽에 붙는다(float).
          <button className="home-grade-fix-link onb-later-link" onClick={onSkip}>
            {editMode ? t('onb.cancel') : t('onb.later')}
          </button>
        )}

        {current === 'department' && (
          <>
            <h2 className="onb-q-title">{t('onb.dept.title')}</h2>
            <p className="onb-q-sub">{t('onb.dept.sub')}</p>
            {departmentsLoading && departments.length === 0 && (
              <div className="onb-option-list">
                <div className="skeleton skeleton-text skeleton-row" style={{ height: 52 }} />
                <div className="skeleton skeleton-text skeleton-row" style={{ height: 52 }} />
              </div>
            )}
            {departments.length > 0 && (
              <DepartmentPicker
                departments={departments}
                selectedId={answers.departmentId}
                onSelect={selectDepartment}
                onSelectAndContinue={selectDepartmentAndContinue}
              />
            )}
          </>
        )}

        {current === 'track' && (
          <>
            <h2 className="onb-q-title">{t(noTrackOption ? noTrackOption.titleKey : 'onb.track.title')}</h2>
            <p className="onb-q-sub">{t(noTrackOption ? noTrackOption.subKey : 'onb.track.sub')}</p>
            <div className="onb-option-list">
              {trackChoices.map((tr) => (
                <button
                  key={tr.id}
                  className={'onb-option-card' + (answers.trackId === tr.id ? ' selected' : '')}
                  onClick={() => setAnswers((a) => ({ ...a, trackId: tr.id }))}
                >
                  <span className="onb-option-title">{tr.name}</span>
                  {tr.captionKey && <span className="onb-option-caption">{t(tr.captionKey)}</span>}
                </button>
              ))}
            </div>
          </>
        )}

        {current === 'enrollmentType' && (
          <>
            <h2 className="onb-q-title">{t('onb.type.title')}</h2>
            <p className="onb-q-sub">{t('onb.type.sub')}</p>
            <div className="onb-option-list">
              <button
                className={'onb-option-card' + (answers.enrollmentType === 'GENERAL' ? ' selected' : '')}
                onClick={() => selectEnrollmentType('GENERAL')}
              >
                <span className="onb-option-title">{t('onb.type.GENERAL')}</span>
                <span className="onb-option-caption">{t('onb.type.GENERAL.caption')}</span>
              </button>
              <button
                className={'onb-option-card' + (answers.enrollmentType === 'TRANSFER_ADMISSION' ? ' selected' : '')}
                disabled={!transferAvailable}
                onClick={() => selectEnrollmentType('TRANSFER_ADMISSION')}
              >
                <span className="onb-option-title">{t('onb.type.TRANSFER_ADMISSION')}</span>
                <span className="onb-option-caption">
                  {transferAvailable
                    ? t('onb.type.TRANSFER_ADMISSION.caption')
                    : t('onb.type.TRANSFER_ADMISSION.unavailable', { dept: selectedDepartment?.name || '' })}
                </span>
              </button>
              <button
                className={'onb-option-card' + (answers.enrollmentType === 'MAJOR_CHANGE' ? ' selected' : '')}
                onClick={() => selectEnrollmentType('MAJOR_CHANGE')}
              >
                <span className="onb-option-title">{t('onb.type.MAJOR_CHANGE')}</span>
                <span className="onb-option-caption">{t('onb.type.MAJOR_CHANGE.caption')}</span>
              </button>
            </div>
          </>
        )}

        {current === 'year' && (
          <>
            <h2 className="onb-q-title">{t('onb.year.title')}</h2>
            <p className="onb-q-sub">
              {t('onb.year.sub', {
                dept: selectedDepartment?.name,
                range: `${yearRange?.min}${yearRange?.max ? `~${yearRange.max}` : ''}`,
              })}
            </p>
            {describeSuccessors(selectedDepartment, t) && (
              <p className="onb-q-sub onb-q-sub-note">{describeSuccessors(selectedDepartment, t)}</p>
            )}
            {/* 개편 전 학과: 폐지·통합돼도 소속변경을 하지 않았으면 그 학과 소속이 유지된다(학칙 부칙·학교 소속변경 안내, 교육혁신과 답변 A-3).
                학생에게는 "학적" 같은 행정 용어 대신 풀어 쓴다. */}
            {selectedDepartment?.former && <p className="onb-q-sub onb-q-sub-note">{t('onb.year.formerHint')}</p>}
            <div className="onb-field-group">
              <label className="onb-field-label">{t('onb.year.label')}</label>
              <select
                className="onb-select"
                value={answers.admissionYear ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, admissionYear: Number(e.target.value) }))}
              >
                <option value="" disabled>
                  {t('onb.select')}
                </option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {t('onb.cohort', { year: y })}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {current === 'transfer' && (
          <>
            <h2 className="onb-q-title">{t('onb.transfer.title')}</h2>
            <p className="onb-q-sub">{t('onb.transfer.sub')}</p>
            <div className="onb-field-group">
              <label className="onb-field-label">{t('onb.transfer.year')}</label>
              <select
                className="onb-select"
                value={answers.transferYear ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, transferYear: Number(e.target.value) }))}
              >
                <option value="" disabled>
                  {t('onb.select')}
                </option>
                {transferYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {t('onb.transfer.yearN', { year: y })}
                  </option>
                ))}
              </select>
            </div>
            <div className="onb-field-group">
              <label className="onb-field-label">{t('onb.transfer.grade')}</label>
              <div className="onb-chip-row">
                {TRANSFER_GRADES.map((g) => (
                  <button
                    key={g}
                    className={'onb-chip' + (answers.transferGrade === g ? ' selected' : '')}
                    onClick={() => setAnswers((a) => ({ ...a, transferGrade: g }))}
                  >
                    {t('home.gradeLevel', { grade: g })}
                  </button>
                ))}
              </div>
              {transferCohort != null && transferCohortValid && (
                <p className="onb-hint">{t('onb.transfer.applied', { year: transferCohort })}</p>
              )}
              {transferCohort != null && !transferCohortValid && (
                <p className="onb-hint">
                  {t('onb.transfer.outOfRange', {
                    dept: selectedDepartment?.name,
                    year: transferCohort,
                    range: `${yearRange?.min}~${yearRange?.max}`,
                  })}
                </p>
              )}
            </div>
            <div className="onb-field-group">
              <label className="onb-field-label" htmlFor="onb-recognized">{t('onb.transfer.recognized')}</label>
              <input
                id="onb-recognized"
                className="onb-select"
                type="text"
                inputMode="numeric"
                placeholder={t('onb.transfer.recognizedPlaceholder')}
                value={answers.transferRecognizedInput}
                onChange={(e) => setAnswers((a) => ({ ...a, transferRecognizedInput: e.target.value.trim() }))}
              />
              <p className="onb-hint">{t(recognized.valid ? 'onb.transfer.recognizedHint' : 'onb.transfer.recognizedInvalid')}</p>
            </div>
          </>
        )}

        {current === 'teaching' && (
          <>
            <h2 className="onb-q-title">{t('onb.teaching.title')}</h2>
            <p className="onb-q-sub">{t(selectedDepartment?.teacherCollege ? 'onb.teaching.subTeacherCollege' : 'onb.teaching.sub')}</p>
            <div className="onb-option-list">
              <button
                className={'onb-option-card' + (answers.teachingCourse === true ? ' selected' : '')}
                onClick={() => setAnswers((a) => ({ ...a, teachingCourse: true }))}
              >
                <span className="onb-option-title">{t('onb.teaching.yes')}</span>
                <span className="onb-option-caption">{t('onb.teaching.yes.caption')}</span>
              </button>
              <button
                className={'onb-option-card' + (answers.teachingCourse === false ? ' selected' : '')}
                onClick={() => setAnswers((a) => ({ ...a, teachingCourse: false }))}
              >
                <span className="onb-option-title">{t('onb.teaching.no')}</span>
                <span className="onb-option-caption">
                  {t(selectedDepartment?.teacherCollege ? 'onb.teaching.no.captionTeacherCollege' : 'onb.teaching.no.caption')}
                </span>
              </button>
            </div>
          </>
        )}

        {current === 'majorChange' && (
          <>
            <h2 className="onb-q-title">{t('onb.mc.title')}</h2>
            <p className="onb-q-sub">{t('onb.mc.sub')}</p>
            <div className="onb-field-group">
              <label className="onb-field-label">{t('onb.mc.year')}</label>
              <select
                className="onb-select"
                value={answers.majorChangeYear ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, majorChangeYear: Number(e.target.value) }))}
              >
                <option value="" disabled>
                  {t('onb.select')}
                </option>
                {mcYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {t('onb.mc.yearN', { year: y })}
                  </option>
                ))}
              </select>
            </div>
            <div className="onb-field-group">
              <label className="onb-field-label">{t('onb.mc.semester')}</label>
              <div className="onb-chip-row">
                {[1, 2].map((s) => (
                  <button
                    key={s}
                    className={'onb-chip' + (answers.majorChangeSemester === s ? ' selected' : '')}
                    disabled={s === 1 && firstSemesterBlocked}
                    onClick={() => setAnswers((a) => ({ ...a, majorChangeSemester: s }))}
                  >
                    {t('courses.semesterN', { n: s })}
                  </button>
                ))}
              </div>
              {firstSemesterBlocked && (
                <p className="onb-hint">{t('onb.mc.firstBlocked')}</p>
              )}
            </div>
            <div className="onb-field-group">
              <label className="onb-field-label">{t('onb.mc.grade')}</label>
              <div className="onb-chip-row">
                {gradeOptions.map((g) => (
                  <button
                    key={g}
                    className={'onb-chip' + (answers.majorChangeGrade === g ? ' selected' : '')}
                    onClick={() => setAnswers((a) => ({ ...a, majorChangeGrade: g }))}
                  >
                    {t('home.gradeLevel', { grade: g })}
                  </button>
                ))}
              </div>
              {gradeRange && (
                <p className="onb-hint">{t('onb.mc.gradeHint', { naive: gradeRange.naive })}</p>
              )}
            </div>
          </>
        )}

        {current === 'leave' && (
          <>
            <h2 className="onb-q-title">{t('leave.title')}</h2>
            <p className="onb-q-sub">{t('leave.sub')}</p>
            <LeavePeriodsEditor
              draft={answers.leaveDraft}
              onChange={(leaveDraft) => setAnswers((a) => ({ ...a, leaveDraft }))}
              firstYear={(isTransfer ? answers.transferYear : answers.admissionYear) || NOW_YEAR}
              lastYear={LEAVE_LAST_YEAR}
            />
          </>
        )}

        {current === 'summary' && (
          <>
            <h2 className="onb-q-title">{t('onb.summary.title')}</h2>
            <p className="onb-q-sub">
              {editMode ? t('onb.summary.editHint') : t('onb.summary.backHint')}
            </p>
            <div className="onb-summary-list">
              <SummaryRow
                label={t('onb.summary.department')}
                value={selectedDepartment?.name}
                editable={editMode}
                onClick={() => setManualStep('department')}
              />
              <SummaryRow
                label={t('onb.summary.cohort')}
                value={answers.admissionYear ? t('onb.cohort', { year: answers.admissionYear }) : null}
                editable={editMode}
                onClick={() => setManualStep(isTransfer ? 'transfer' : 'year')}
              />
              <SummaryRow
                label={t('onb.summary.type')}
                value={answers.enrollmentType ? t(`onb.type.${answers.enrollmentType}`) : null}
                editable={editMode}
                onClick={() => setManualStep('enrollmentType')}
              />
              {isTransfer && (
                <SummaryRow
                  label={t('onb.summary.transfer')}
                  value={
                    answers.transferYear && answers.transferGrade
                      ? t('onb.summary.transferValue', { year: answers.transferYear, grade: answers.transferGrade })
                      : null
                  }
                  editable={editMode}
                  onClick={() => setManualStep('transfer')}
                />
              )}
              {isTransfer && (
                <SummaryRow
                  label={t('onb.summary.recognized')}
                  value={
                    recognized.value != null
                      ? t('onb.summary.recognizedValue', { credits: recognized.value })
                      : recognized.valid ? t('onb.summary.recognizedNone') : null
                  }
                  editable={editMode}
                  onClick={() => setManualStep('transfer')}
                />
              )}
              {hasTracks && (
                <SummaryRow
                  label={t('onb.summary.track')}
                  value={selectedTrackName}
                  editable={editMode}
                  onClick={() => setManualStep('track')}
                />
              )}
              {trackCheckKey && <p className="onb-hint">{t(trackCheckKey)}</p>}
              {answers.enrollmentType === 'MAJOR_CHANGE' && (
                <SummaryRow
                  label={t('onb.summary.majorChange')}
                  value={
                    answers.majorChangeYear && answers.majorChangeSemester && answers.majorChangeGrade
                      ? t('onb.summary.majorChangeValue', {
                          grade: answers.majorChangeGrade,
                          year: answers.majorChangeYear,
                          semester: answers.majorChangeSemester,
                        })
                      : null
                  }
                  editable={editMode}
                  onClick={() => setManualStep('majorChange')}
                />
              )}
              {teachingAvailable && (
                <SummaryRow
                  label={t('onb.summary.teaching')}
                  value={answers.teachingCourse === null ? null : t(answers.teachingCourse ? 'onb.teaching.yes' : 'onb.teaching.no')}
                  editable={editMode}
                  onClick={() => setManualStep('teaching')}
                />
              )}
              <div className={leaveHighlightArmed ? 'settings-highlight' : undefined}>
                <SummaryRow
                  label={t('onb.summary.leave')}
                  value={describeLeave(periodsFromDraft(answers.leaveDraft), t)}
                  editable={editMode}
                  onClick={() => setManualStep('leave')}
                />
              </div>
            </div>
          </>
        )}

        {current === 'done' && (
          <div className="onb-done-wrap">
            <div className="onb-done-circle">✓</div>
            <p className="onb-done-title">{t('onb.done.title')}</p>
            <p className="onb-done-sub">{t('onb.done.sub')}</p>
          </div>
        )}

        {/* 주 버튼(다음·저장 등)은 내용이 길어도 화면 아래에 떠 있게 한다 — 학과 목록처럼 길어지면 맨 끝까지 내려가야 눌렀다. */}
        <div className="onb-float-action">
          {current === 'summary' ? (
            <button className="auth-submit-btn" onClick={handleSubmit} disabled={submitting || summaryIncomplete}>
              {submitting ? t('onb.saving') : editMode ? t('profile.save') : t('onb.start')}
            </button>
          ) : current === 'done' ? (
            <button className="auth-submit-btn" onClick={onDone}>
              {t('onb.done.home')}
            </button>
          ) : (
            <button className="auth-submit-btn" onClick={handleNext} disabled={nextDisabled}>
              {editingFromSummary ? t('onb.confirm') : t('onb.next')}
            </button>
          )}
        </div>
      </div>

      {confirmNoDepartment && (
        <div className="career-confirm-overlay" onClick={() => setConfirmNoDepartment(false)}>
          <div className="career-confirm-modal" role="dialog" aria-modal="true" aria-label={t('onb.noDept.title')} onClick={(e) => e.stopPropagation()}>
            <span className="career-confirm-title">{t('onb.noDept.title')}</span>
            <p className="career-confirm-body">{t('onb.noDept.body', { menu: t('account.editDepartment') })}</p>
            <button className="auth-submit-btn" onClick={onSkip}>
              {t('onb.noDept.skip')}
            </button>
            <button className="career-confirm-cancel" onClick={() => setConfirmNoDepartment(false)}>
              {t('onb.noDept.choose')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Onboarding;
