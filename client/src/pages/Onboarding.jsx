import React, { useEffect, useState } from 'react';
import { getDepartments, getTracks, submitOnboarding, updateProfile } from '../api/chatApi.js';
import { IconChevronLeft, IconEdit } from '../components/icons.jsx';

const NOW_YEAR = new Date().getFullYear();
const ENROLLMENT_TYPE_LABEL = { GENERAL: '일반 재학생', TRANSFER_ADMISSION: '편입생', MAJOR_CHANGE: '전과생' };

function getYearRange(department, enrollmentType) {
  const min = department.minAdmissionYear ?? NOW_YEAR - 15;
  let max = department.maxAdmissionYear ?? NOW_YEAR;
  // 편입생은 기존 학점을 인정받아 들어오는 전형이라 정의상 "계산상 1학년"이 되는 올해
  // 학번으로는 편입할 수 없다 — 그 해는 편입생 기준 학번 범위에서 뺀다.
  if (enrollmentType === 'TRANSFER_ADMISSION') max = Math.min(max, NOW_YEAR - 1);
  return { min, max };
}

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
  const valueEl = (
    <span className={value ? 'onb-summary-val' : 'onb-summary-val onb-summary-val-warning'}>{value || '선택 필요'}</span>
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
 * 학과 → (세부전공) → 입학유형 → 학번 → (전과 시점) → 확인 → 완료.
 *
 * Props:
 * - user: object (onboardingCompleted 여부로 최초 등록(POST)/재설정(PATCH) 분기)
 * - onDone: function
 * - onSkip: function
 * - highlightLeaveSemesters: boolean — 홈의 "학년이 다르신가요?" 링크로 들어왔을 때만 true,
 *   요약 화면의 휴학 학기 수 항목에 강조 애니메이션을 준다.
 */
function Onboarding({ user, onDone, onSkip, highlightLeaveSemesters }) {
  // 최초 온보딩(회원가입 직후)은 처음부터 순서대로 걷지만, 이미 완료한 사용자가 "학적정보
  // 수정"으로 재진입하면 기존 값이 채워진 요약 화면으로 바로 들어가 필요한 항목만 고쳐서
  // 저장한다 — 매번 학과부터 다시 고르게 하던 문제(실사용 피드백) 해결.
  const editMode = !!user?.onboardingCompleted;

  const [departments, setDepartments] = useState(cachedDepartments || []);
  const [departmentsLoading, setDepartmentsLoading] = useState(cachedDepartments === null);
  const [tracks, setTracks] = useState([]);
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
    trackId: editMode ? user.trackId : null,
    enrollmentType: editMode ? user.enrollmentType : null,
    admissionYear: editMode ? user.admissionYear : null,
    majorChangeYear: editMode ? user.majorChangeYear : null,
    majorChangeSemester: editMode ? user.majorChangeSemester : null,
    majorChangeGrade: editMode ? user.majorChangeGrade : null,
  });

  useEffect(() => {
    getDepartments()
      .then((data) => {
        setDepartments(data);
        cachedDepartments = data;
      })
      .catch(() => setLoadError('학과 목록을 불러오지 못했어요.'))
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

  const path = ['department'];
  if (hasTracks) path.push('track');
  path.push('enrollmentType', 'year');
  if (answers.enrollmentType === 'MAJOR_CHANGE') path.push('majorChange');
  path.push('summary', 'done');

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

  // 학과가 바뀌어 편입생 조합이 더 이상 성립하지 않게 되면 선택을 되돌린다.
  useEffect(() => {
    if (answers.enrollmentType === 'TRANSFER_ADMISSION' && selectedDepartment && !isTransferAvailable(selectedDepartment)) {
      setAnswers((a) => ({ ...a, enrollmentType: null, admissionYear: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartment]);

  const yearRange = selectedDepartment ? getYearRange(selectedDepartment, answers.enrollmentType) : null;
  const yearOptions = yearRange ? range(yearRange.min, yearRange.max) : [];

  // 학번 선택지가 하나뿐이면(예: 공학3계열은 2026학번만 존재) 사용자가 그 하나를 굳이 직접
  // 눌러 고르게 하지 않고 자동으로 채운다 — 유일한 선택지를 누르게 하는 것 자체가 불필요한
  // 클릭이라는 실사용 피드백 반영.
  useEffect(() => {
    if (yearOptions.length === 1 && answers.admissionYear !== yearOptions[0]) {
      setAnswers((a) => ({ ...a, admissionYear: yearOptions[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartment, answers.enrollmentType]);

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
    }));
    setTracks([]);
    getTracks(dept.id)
      .then(setTracks)
      .catch(() => setTracks([]));
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
      return {
        ...a,
        enrollmentType: type,
        admissionYear: admissionYearStillValid ? a.admissionYear : null,
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
  function goBack() {
    if (editingFromSummary) {
      setManualStep('summary');
      return;
    }
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // 휴학 학기 수는 학과/학번 등과 서로 의존하는 값이 아니라 완전히 독립적이라, 마법사
  // 흐름에 끼워 넣지 않고 요약 화면에서 바로 입력받아 그 자리에서 저장한다(개인정보
  // 수정 페이지의 기존 UI/저장 방식을 그대로 재사용 — 신규 온보딩 POST는 이 필드를
  // 받지 않아 요약 화면 재진입(editMode) 때만 노출한다).
  const [leaveSemesters, setLeaveSemesters] = useState(String(user?.leaveSemesters ?? 0));
  const [leaveSemestersSaved, setLeaveSemestersSaved] = useState(false);
  const [leaveSemestersError, setLeaveSemestersError] = useState(null);

  async function handleSaveLeaveSemesters() {
    setLeaveSemestersError(null);
    setLeaveSemestersSaved(false);
    const value = Number(leaveSemesters);
    if (!Number.isInteger(value) || value < 0) {
      setLeaveSemestersError('0 이상의 정수를 입력해주세요.');
      return;
    }
    try {
      await updateProfile({ leaveSemesters: value });
      setLeaveSemestersSaved(true);
    } catch {
      setLeaveSemestersError('저장에 실패했어요.');
    }
  }

  const summaryIncomplete =
    !answers.departmentId ||
    !answers.admissionYear ||
    !answers.enrollmentType ||
    (hasTracks && !answers.trackId) ||
    (answers.enrollmentType === 'MAJOR_CHANGE' &&
      !(answers.majorChangeYear && answers.majorChangeSemester && answers.majorChangeGrade));

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    const isMajorChange = answers.enrollmentType === 'MAJOR_CHANGE';
    const payload = {
      departmentId: answers.departmentId,
      admissionYear: answers.admissionYear,
      enrollmentType: answers.enrollmentType,
      trackId: hasTracks ? answers.trackId : null,
      majorChangeGrade: isMajorChange ? answers.majorChangeGrade : null,
      majorChangeYear: isMajorChange ? answers.majorChangeYear : null,
      majorChangeSemester: isMajorChange ? answers.majorChangeSemester : null,
    };
    try {
      if (user?.onboardingCompleted) {
        await updateProfile(payload);
      } else {
        await submitOnboarding(payload);
      }
      setManualStep(null);
      setStepIndex(path.indexOf('done'));
    } catch {
      setSubmitError('저장에 실패했어요. 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  const nextDisabled =
    (current === 'department' && !answers.departmentId) ||
    (current === 'track' && !answers.trackId) ||
    (current === 'enrollmentType' && !answers.enrollmentType) ||
    (current === 'year' && !answers.admissionYear) ||
    (current === 'majorChange' && !(answers.majorChangeYear && answers.majorChangeSemester && answers.majorChangeGrade));

  const transferAvailable = selectedDepartment ? isTransferAvailable(selectedDepartment) : true;

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          {(stepIndex > 0 || editingFromSummary) && current !== 'done' && (
            <button className="back-btn" onClick={goBack} aria-label={editingFromSummary ? '요약으로 돌아가기' : '이전 질문'}>
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
        {loadError && <p className="home-error">{loadError}</p>}
        {submitError && <p className="home-error">{submitError}</p>}

        {current === 'department' && (
          <>
            <h2 className="onb-q-title">어느 학과 소속이에요?</h2>
            <p className="onb-q-sub">선택한 학과와 학번을 기준으로 졸업요건을 계산해요.</p>
            {departmentsLoading && departments.length === 0 && (
              <div className="onb-option-list">
                <div className="skeleton skeleton-text skeleton-row" style={{ height: 52 }} />
                <div className="skeleton skeleton-text skeleton-row" style={{ height: 52 }} />
              </div>
            )}
            <div className="onb-option-list">
              {departments.map((d) => (
                <button
                  key={d.id}
                  className={'onb-option-card' + (answers.departmentId === d.id ? ' selected' : '')}
                  onClick={() => selectDepartment(d)}
                >
                  <span className="onb-option-title">{d.name}</span>
                  <span className="onb-option-caption">
                    {d.maxAdmissionYear
                      ? `${d.minAdmissionYear ?? ''}~${d.maxAdmissionYear}학번`
                      : `${d.minAdmissionYear ?? ''}학번`}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {current === 'track' && (
          <>
            <h2 className="onb-q-title">희망하는 세부전공을 선택하세요</h2>
            <p className="onb-q-sub">2학년 진급 시 확정되는 세부전공이에요. 아직 정식으로 선택하기 전이라도, 지금 희망하는 쪽을 골라주세요.</p>
            <div className="onb-option-list">
              {tracks.map((t) => (
                <button
                  key={t.id}
                  className={'onb-option-card' + (answers.trackId === t.id ? ' selected' : '')}
                  onClick={() => setAnswers((a) => ({ ...a, trackId: t.id }))}
                >
                  <span className="onb-option-title">{t.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {current === 'enrollmentType' && (
          <>
            <h2 className="onb-q-title">어떤 유형으로 재학 중이에요?</h2>
            <p className="onb-q-sub">전형에 따라 최소 전공 이수 학점이 달라질 수 있어요.</p>
            <div className="onb-option-list">
              <button
                className={'onb-option-card' + (answers.enrollmentType === 'GENERAL' ? ' selected' : '')}
                onClick={() => selectEnrollmentType('GENERAL')}
              >
                <span className="onb-option-title">일반 재학생</span>
                <span className="onb-option-caption">신입학으로 입학해 재학 중</span>
              </button>
              <button
                className={'onb-option-card' + (answers.enrollmentType === 'TRANSFER_ADMISSION' ? ' selected' : '')}
                disabled={!transferAvailable}
                onClick={() => selectEnrollmentType('TRANSFER_ADMISSION')}
              >
                <span className="onb-option-title">편입생</span>
                <span className="onb-option-caption">
                  {transferAvailable
                    ? '타 대학·전문학사에서 편입'
                    : (selectedDepartment?.name || '') + '은(는) 아직 편입 가능한 학번이 없어요'}
                </span>
              </button>
              <button
                className={'onb-option-card' + (answers.enrollmentType === 'MAJOR_CHANGE' ? ' selected' : '')}
                onClick={() => selectEnrollmentType('MAJOR_CHANGE')}
              >
                <span className="onb-option-title">전과생</span>
                <span className="onb-option-caption">다른 학과에서 전과해 옴</span>
              </button>
            </div>
          </>
        )}

        {current === 'year' && (
          <>
            <h2 className="onb-q-title">몇 학번이에요?</h2>
            <p className="onb-q-sub">
              {selectedDepartment?.name}은(는) {yearRange?.min}
              {yearRange?.max ? `~${yearRange.max}` : ''}학번만 이 이수구조를 따라요.
            </p>
            <div className="onb-field-group">
              <label className="onb-field-label">입학년도</label>
              <select
                className="onb-select"
                value={answers.admissionYear ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, admissionYear: Number(e.target.value) }))}
              >
                <option value="" disabled>
                  선택
                </option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}학번
                  </option>
                ))}
              </select>
              {answers.enrollmentType === 'TRANSFER_ADMISSION' && (
                <p className="onb-hint">편입생은 올해 학번으로는 들어올 수 없어 그 해는 빠져 있어요.</p>
              )}
            </div>
          </>
        )}

        {current === 'majorChange' && (
          <>
            <h2 className="onb-q-title">전과 시점을 알려주세요</h2>
            <p className="onb-q-sub">교양 이수기준이 전과 시점(연도·학기) 기준으로 갈려서 필요해요.</p>
            <div className="onb-field-group">
              <label className="onb-field-label">전과한 연도</label>
              <select
                className="onb-select"
                value={answers.majorChangeYear ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, majorChangeYear: Number(e.target.value) }))}
              >
                <option value="" disabled>
                  선택
                </option>
                {mcYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </div>
            <div className="onb-field-group">
              <label className="onb-field-label">전과한 학기</label>
              <div className="onb-chip-row">
                {[1, 2].map((s) => (
                  <button
                    key={s}
                    className={'onb-chip' + (answers.majorChangeSemester === s ? ' selected' : '')}
                    disabled={s === 1 && firstSemesterBlocked}
                    onClick={() => setAnswers((a) => ({ ...a, majorChangeSemester: s }))}
                  >
                    {s}학기
                  </button>
                ))}
              </div>
              {firstSemesterBlocked && (
                <p className="onb-hint">입학한 해에는 최소 한 학기를 다녀야 전과할 수 있어 1학기는 고를 수 없어요.</p>
              )}
            </div>
            <div className="onb-field-group">
              <label className="onb-field-label">전과 당시 학년</label>
              <div className="onb-chip-row">
                {gradeOptions.map((g) => (
                  <button
                    key={g}
                    className={'onb-chip' + (answers.majorChangeGrade === g ? ' selected' : '')}
                    onClick={() => setAnswers((a) => ({ ...a, majorChangeGrade: g }))}
                  >
                    {g}학년
                  </button>
                ))}
              </div>
              {gradeRange && (
                <p className="onb-hint">
                  선택하신 학번·전과 시점 기준으로 정상 진급 학년은 {gradeRange.naive}학년이에요. 휴학 등으로 늦어졌을
                  경우까지만 골라둘 수 있어요.
                </p>
              )}
            </div>
          </>
        )}

        {current === 'summary' && (
          <>
            <h2 className="onb-q-title">입력한 정보를 확인해주세요</h2>
            <p className="onb-q-sub">
              {editMode ? '고칠 항목을 눌러서 바로 수정할 수 있어요.' : '틀린 항목은 뒤로 가서 다시 고를 수 있어요.'}
            </p>
            <div className="onb-summary-list">
              <SummaryRow
                label="학과"
                value={selectedDepartment?.name}
                editable={editMode}
                onClick={() => setManualStep('department')}
              />
              <SummaryRow
                label="학번"
                value={answers.admissionYear ? `${answers.admissionYear}학번` : null}
                editable={editMode}
                onClick={() => setManualStep('year')}
              />
              <SummaryRow
                label="입학 유형"
                value={ENROLLMENT_TYPE_LABEL[answers.enrollmentType]}
                editable={editMode}
                onClick={() => setManualStep('enrollmentType')}
              />
              {hasTracks && (
                <SummaryRow
                  label="세부전공"
                  value={tracks.find((t) => t.id === answers.trackId)?.name}
                  editable={editMode}
                  onClick={() => setManualStep('track')}
                />
              )}
              {answers.enrollmentType === 'MAJOR_CHANGE' && (
                <SummaryRow
                  label="전과 시점"
                  value={
                    answers.majorChangeYear && answers.majorChangeSemester && answers.majorChangeGrade
                      ? `${answers.majorChangeGrade}학년 · ${answers.majorChangeYear}년 ${answers.majorChangeSemester}학기`
                      : null
                  }
                  editable={editMode}
                  onClick={() => setManualStep('majorChange')}
                />
              )}
              {editMode && (
                <div
                  className={
                    'onb-summary-row' + (leaveHighlightArmed ? ' settings-highlight' : '')
                  }
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                >
                  <span className="onb-summary-key">휴학 학기 수</span>
                  <div className="settings-inline-field">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="onb-select"
                      value={leaveSemesters}
                      onChange={(e) => {
                        setLeaveSemesters(e.target.value);
                        setLeaveSemestersSaved(false);
                      }}
                    />
                    <button type="button" className="settings-theme-btn" onClick={handleSaveLeaveSemesters}>
                      저장
                    </button>
                  </div>
                  {leaveSemestersError && <p className="home-error">{leaveSemestersError}</p>}
                  {leaveSemestersSaved && <p className="settings-field-hint">저장했어요.</p>}
                </div>
              )}
            </div>
          </>
        )}

        {current === 'done' && (
          <div className="onb-done-wrap">
            <div className="onb-done-circle">✓</div>
            <p className="onb-done-title">설정이 끝났어요</p>
            <p className="onb-done-sub">이제 내 학사정보를 바로 확인할 수 있어요.</p>
          </div>
        )}

        {current === 'summary' ? (
          <button className="auth-submit-btn" onClick={handleSubmit} disabled={submitting || summaryIncomplete}>
            {submitting ? '저장 중…' : editMode ? '저장' : '시작하기'}
          </button>
        ) : current === 'done' ? (
          <button className="auth-submit-btn" onClick={onDone}>
            홈으로 가기
          </button>
        ) : (
          <button className="auth-submit-btn" onClick={goNext} disabled={nextDisabled}>
            {editingFromSummary ? '확인' : '다음'}
          </button>
        )}

        {current !== 'done' && !editingFromSummary && (
          <button className="onb-skip-link" onClick={onSkip}>
            {editMode ? '취소' : '나중에 선택하기'}
          </button>
        )}
      </div>
    </div>
  );
}

export default Onboarding;
