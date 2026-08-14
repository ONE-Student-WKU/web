import React, { useEffect, useState } from 'react';
import { getDepartments, getTracks, submitOnboarding, updateProfile } from '../api/chatApi.js';

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

/**
 * Onboarding Page
 * 회원가입 직후 자동 진입하거나, 계정 메뉴의 "학적정보 수정"에서 재진입.
 * 학과 → (세부전공) → 입학유형 → 학번 → (전과 시점) → 확인 → 완료.
 *
 * Props:
 * - user: object (onboardingCompleted 여부로 최초 등록(POST)/재설정(PATCH) 분기)
 * - onDone: function
 * - onSkip: function
 */
function Onboarding({ user, onDone, onSkip }) {
  const [departments, setDepartments] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const [answers, setAnswers] = useState({
    departmentId: null,
    trackId: null,
    enrollmentType: null,
    admissionYear: null,
    majorChangeYear: null,
    majorChangeSemester: null,
    majorChangeGrade: null,
  });

  useEffect(() => {
    getDepartments()
      .then(setDepartments)
      .catch(() => setLoadError('학과 목록을 불러오지 못했어요.'));
  }, []);

  const selectedDepartment = departments.find((d) => d.id === answers.departmentId) || null;
  const hasTracks = tracks.length > 0;

  const path = ['department'];
  if (hasTracks) path.push('track');
  path.push('enrollmentType', 'year');
  if (answers.enrollmentType === 'MAJOR_CHANGE') path.push('majorChange');
  path.push('summary', 'done');

  const current = path[Math.min(stepIndex, path.length - 1)];

  // 학과가 바뀌어 편입생 조합이 더 이상 성립하지 않게 되면 선택을 되돌린다.
  useEffect(() => {
    if (answers.enrollmentType === 'TRANSFER_ADMISSION' && selectedDepartment && !isTransferAvailable(selectedDepartment)) {
      setAnswers((a) => ({ ...a, enrollmentType: null, admissionYear: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartment]);

  const yearRange = selectedDepartment ? getYearRange(selectedDepartment, answers.enrollmentType) : null;
  const yearOptions = yearRange ? range(yearRange.min, yearRange.max) : [];

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

  function selectDepartment(dept) {
    setAnswers((a) => ({ ...a, departmentId: dept.id, trackId: null, admissionYear: null }));
    setTracks([]);
    getTracks(dept.id)
      .then(setTracks)
      .catch(() => setTracks([]));
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, path.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

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
          {stepIndex > 0 && current !== 'done' && (
            <button className="back-btn" onClick={goBack} aria-label="이전 질문">
              ‹
            </button>
          )}
        </div>
        {current !== 'done' && (
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
            <div className="onb-option-list">
              {departments.map((d) => (
                <button
                  key={d.id}
                  className={'onb-option-card' + (answers.departmentId === d.id ? ' selected' : '')}
                  onClick={() => selectDepartment(d)}
                >
                  <span className="onb-option-title">{d.name}</span>
                  <span className="onb-option-caption">
                    {d.minAdmissionYear ?? ''}
                    {d.maxAdmissionYear ? `~${d.maxAdmissionYear}` : '~'}학번
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {current === 'track' && (
          <>
            <h2 className="onb-q-title">세부전공을 선택하세요</h2>
            <p className="onb-q-sub">2학년 진급 시 선택하는 세부전공이에요.</p>
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
                onClick={() => setAnswers((a) => ({ ...a, enrollmentType: 'GENERAL', admissionYear: null }))}
              >
                <span className="onb-option-title">일반 재학생</span>
                <span className="onb-option-caption">신입학으로 입학해 재학 중</span>
              </button>
              <button
                className={'onb-option-card' + (answers.enrollmentType === 'TRANSFER_ADMISSION' ? ' selected' : '')}
                disabled={!transferAvailable}
                onClick={() => setAnswers((a) => ({ ...a, enrollmentType: 'TRANSFER_ADMISSION', admissionYear: null }))}
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
                onClick={() => setAnswers((a) => ({ ...a, enrollmentType: 'MAJOR_CHANGE', admissionYear: null }))}
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
                  {answers.admissionYear}학번 · {answers.majorChangeYear}년 전과 기준 정상 진급 학년은 {gradeRange.naive}
                  학년이에요. 휴학 등으로 늦어졌을 경우까지만 골라둘 수 있어요.
                </p>
              )}
            </div>
          </>
        )}

        {current === 'summary' && (
          <>
            <h2 className="onb-q-title">입력한 정보를 확인해주세요</h2>
            <p className="onb-q-sub">틀린 항목은 뒤로 가서 다시 고를 수 있어요.</p>
            <div className="onb-summary-list">
              <div className="onb-summary-row">
                <span className="onb-summary-key">학과</span>
                <span className="onb-summary-val">{selectedDepartment?.name}</span>
              </div>
              <div className="onb-summary-row">
                <span className="onb-summary-key">학번</span>
                <span className="onb-summary-val">{answers.admissionYear}학번</span>
              </div>
              <div className="onb-summary-row">
                <span className="onb-summary-key">입학 유형</span>
                <span className="onb-summary-val">{ENROLLMENT_TYPE_LABEL[answers.enrollmentType]}</span>
              </div>
              {hasTracks && (
                <div className="onb-summary-row">
                  <span className="onb-summary-key">세부전공</span>
                  <span className="onb-summary-val">{tracks.find((t) => t.id === answers.trackId)?.name}</span>
                </div>
              )}
              {answers.enrollmentType === 'MAJOR_CHANGE' && (
                <div className="onb-summary-row">
                  <span className="onb-summary-key">전과 시점</span>
                  <span className="onb-summary-val">
                    {answers.majorChangeGrade}학년 · {answers.majorChangeYear}년 {answers.majorChangeSemester}학기
                  </span>
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
          <button className="auth-submit-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '저장 중…' : '시작하기'}
          </button>
        ) : current === 'done' ? (
          <button className="auth-submit-btn" onClick={onDone}>
            홈으로 가기
          </button>
        ) : (
          <button className="auth-submit-btn" onClick={goNext} disabled={nextDisabled}>
            다음
          </button>
        )}

        {current !== 'done' && (
          <button className="onb-skip-link" onClick={onSkip}>
            나중에 선택하기
          </button>
        )}
      </div>
    </div>
  );
}

export default Onboarding;
