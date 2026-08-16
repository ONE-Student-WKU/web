import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getMe,
  getMyCourses,
  getTimetable,
  getCourseSummary,
  getGraduationStatus,
  getSemesters,
  searchCatalog,
  addMyCourse,
  updateMyCourse,
  deleteMyCourse,
  importCoursesFromPdf,
  confirmImportedCourses,
} from '../api/chatApi.js';
import { IconPlus, IconTrash, IconSearch, IconX, IconChevronLeft } from '../components/icons.jsx';
import AccountMenu from '../components/AccountMenu.jsx';

const DAYS = ['월', '화', '수', '목', '금'];
const GRADES = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F'];
const CATEGORIES = ['전공필수', '전공선택', '교양필수', '교양선택', '일반선택'];

// 여름/겨울방학 중엔 다음 학기가 없으니, 학사력 기준으로 "현재 학기"를 추정.
// 8월은 수업 자체는 방학이지만 2학기 수강신청이 이미 시작되는 시기라 2학기로 친다
// (실제 사용자 확인: 8월 중순에 1학기로 뜨는 건 오답이었음).
function getCurrentYearSemester() {
  const now = new Date();
  const month = now.getMonth() + 1;
  if (month <= 2) return { year: now.getFullYear() - 1, semester: 2 };
  if (month <= 7) return { year: now.getFullYear(), semester: 1 };
  return { year: now.getFullYear(), semester: 2 };
}

function semesterKey(year, semester) {
  return `${year}-${semester}`;
}

// 입학년도 1학기부터 현재 학기까지 전체 범위를 생성 — 휴학 학기도 그냥 빈 탭으로 포함된다
// (정확히 어느 학기가 휴학이었는지는 students.leave_semesters가 누적 "개수"만 저장해서
// 알 수 없음 — 정교하게 제외하는 대신 전부 깔아두고 비어있는 채로 두기로 함, 2026-08-15 결정).
// 이러면 학생이 매번 "+학기 추가"를 누를 필요 없이 자기 재학 기간의 모든 학기 탭이 미리 보인다.
function generateSemesterRange(startYear, endYear, endSemester) {
  const range = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const s of [1, 2]) {
      if (y === endYear && s > endSemester) break;
      range.push({ year: y, semester: s });
    }
  }
  return range;
}

// 카탈로그 검색 결과에 과목명·교수만 있으면 같은 과목의 여러 분반을 구분할 수가 없어서,
// "수1 목78" 같은 압축 표기로 시간을 같이 보여준다 (요일별로 교시를 묶어 붙임).
function formatSchedule(schedule) {
  if (!schedule || schedule.length === 0) return '';
  const byDay = new Map();
  for (const s of schedule) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day).push(s.period);
  }
  return DAYS.filter((d) => byDay.has(d))
    .map((d) => `${d}${byDay.get(d).sort((a, b) => a - b).join('')}`)
    .join(' ');
}

/**
 * CourseManagement Page
 * 학기별 시간표/수강목록 조회, 과목 추가(카탈로그 검색 또는 직접입력 — 전공도 포함), 성적 입력, 삭제.
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onLogout: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenProfile: function
 */
function CourseManagement({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile }) {
  const [current, setCurrent] = useState(getCurrentYearSemester);
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState(null);
  const [semesters, setSemesters] = useState([]);
  const [myCourses, setMyCourses] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState('catalog'); // 'catalog' | 'manual' | 'pdf'
  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [manualFields, setManualFields] = useState({ name: '', credits: '', category: '전공선택' });
  const [manualSchedule, setManualSchedule] = useState([]); // [{day, period}] — 선택 입력, 직접입력/시간표 없는 카탈로그 과목 공용
  // 시간표가 없는 카탈로그 과목(교수/시간 미확보)을 선택했을 때만 세팅 — 확정된 시간표가
  // 있는 과목은 바로 추가되고 이 상태를 거치지 않는다.
  const [catalogSelection, setCatalogSelection] = useState(null);
  // PDF 가져오기: 업로드 즉시 저장하지 않고 파싱 결과를 검토·수정할 수 있게 보여준 뒤
  // 사용자가 확정해야 등록된다 — 성적(등급)은 이 문서에 없어 절대 자동 채우지 않는다.
  const [pdfRows, setPdfRows] = useState(null); // null = 아직 업로드 전
  const [pdfWarnings, setPdfWarnings] = useState([]);
  const [pdfCreditsCheck, setPdfCreditsCheck] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfSubmitting, setPdfSubmitting] = useState(false);
  const addFormRef = useRef(null);
  const searchResultsRef = useRef(null);

  // "과목 추가"를 누르면 폼이 화면 아래쪽에 새로 생기는데 스크롤 위치는 그대로라 매번 직접
  // 내려야 했다 — 폼이 열리는 순간 자동으로 보이는 위치까지 스크롤한다.
  useEffect(() => {
    if (showAddForm) addFormRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, [showAddForm]);

  // 검색어를 입력해 결과 목록이 새로 생겨도 스크롤 위치는 그대로라 목록을 보려면 또 내려야
  // 했다 — 결과가 생기면 목록이 보이는 위치까지 자동으로 맞춘다. 이미 보이고 있으면
  // block: 'nearest'라 매 타이핑마다 점프하지 않는다.
  useEffect(() => {
    if (searchResults.length > 0) searchResultsRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }, [searchResults]);

  useEffect(() => {
    getMe()
      .then(setProfile)
      .catch(() => {});
    getCourseSummary()
      .then(setSummary)
      .catch(() => setError('정보를 불러오지 못했어요.'));
    getSemesters()
      .then(setSemesters)
      .catch(() => setError('정보를 불러오지 못했어요.'));
    // "전체 이수학점"은 getCourseSummary()의 상한 없는 raw 합계가 아니라 이 값(졸업요건 계산과
    // 동일한 상한 적용 총계)을 써야 홈/졸업요건 진단 화면과 숫자가 일치한다 — 온보딩 전이면
    // 실패할 수 있는 부가 정보라 조용히 무시(그러면 아래에서 raw 합계로 폴백).
    getGraduationStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const loadSemesterData = (year, semester) => {
    Promise.all([getMyCourses(year, semester), getTimetable(year, semester)])
      .then(([courses, table]) => {
        setMyCourses(courses);
        setTimetable(table);
      })
      .catch(() => setError('정보를 불러오지 못했어요.'));
  };

  useEffect(() => {
    loadSemesterData(current.year, current.semester);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const tabs = useMemo(() => {
    const actualCurrentTerm = getCurrentYearSemester();
    const generated = profile?.admissionYear
      ? generateSemesterRange(profile.admissionYear, actualCurrentTerm.year, actualCurrentTerm.semester)
      : [];
    // semesters(서버, 실제 수강 기록 있는 학기라 courseCount 포함)를 먼저 두어 겹치는 키에서
    // 우선하게 하고, generated(입학년도~현재 전체 범위, 휴학 학기 포함 빈 탭)로 나머지를 채운다.
    const all = [...semesters, ...generated, current];
    const seen = new Set();
    const deduped = [];
    for (const t of all) {
      const key = semesterKey(t.year, t.semester);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(t);
    }
    return deduped.sort((a, b) => a.year - b.year || a.semester - b.semester);
  }, [semesters, current, profile]);

  // 학기 탭을 전부 가로 스크롤 한 줄로 늘어놓으면(입학년도~현재라 8개+) 피로도가 높아서,
  // 연도 탭(적은 개수, 스크롤 없이 다 보임) + 그 안에서 1/2학기 토글 + 인접 학기 이동
  // 화살표로 재구성함 (2026-08-15 결정).
  const years = useMemo(() => [...new Set(tabs.map((t) => t.year))].sort((a, b) => a - b), [tabs]);
  const semestersInCurrentYear = useMemo(
    () => tabs.filter((t) => t.year === current.year).sort((a, b) => a.semester - b.semester),
    [tabs, current.year]
  );
  const currentTabIndex = tabs.findIndex((t) => t.year === current.year && t.semester === current.semester);

  const handleSelectYear = (year) => {
    const semestersOfYear = tabs.filter((t) => t.year === year).sort((a, b) => a.semester - b.semester);
    const keepSameSemester = semestersOfYear.find((t) => t.semester === current.semester);
    setCurrent(keepSameSemester || semestersOfYear[0]);
  };

  const goToPrevSemester = () => {
    if (currentTabIndex > 0) setCurrent(tabs[currentTabIndex - 1]);
  };
  const goToNextSemester = () => {
    if (currentTabIndex >= 0 && currentTabIndex < tabs.length - 1) setCurrent(tabs[currentTabIndex + 1]);
  };

  const currentSemesterSummary = summary?.bySemester?.find(
    (s) => s.year === current.year && s.semester === current.semester
  );
  const registeredCredits = myCourses.reduce((sum, c) => sum + c.credits, 0);

  // 카탈로그(course_offerings)는 학기별 실제 개설 정보라 지금 보고 있는 탭(current.year/semester)
  // 그대로 카탈로그 검색에 넘긴다 — 2017-1~2026-2 범위의 실제 분반/교수/시간이 그대로 나온다.
  // 그 범위 밖(수집 전/이후 학기)은 검색해도 결과가 없을 뿐이라 별도 게이트가 필요 없다
  // (저학년 필수과목처럼 아직 실제 개설 전이라 시간표를 확보 못 한 항목은 검색 결과에
  // 교수/시간이 비어있고, 추가 시 사용자가 직접 시간표를 입력할 수 있다 — courseService.addMyCourse 참고).

  const maxPeriod = Math.max(6, ...timetable.map((t) => t.period));
  const cellAt = (day, period) => timetable.find((t) => t.day === day && t.period === period);

  // 시간표 칸이 전부 같은 파란 톤이면 붙어있는 서로 다른 과목이 구분이 안 됐다는 피드백 —
  // 과목(이름 기준)마다 8색 팔레트를 순서대로 배정해 칸 색으로 구분한다.
  const courseColorIndex = useMemo(() => {
    const map = new Map();
    for (const t of timetable) {
      if (!map.has(t.name)) map.set(t.name, map.size % 8);
    }
    return map;
  }, [timetable]);

  async function refreshAfterChange() {
    loadSemesterData(current.year, current.semester);
    const [s, sems] = await Promise.all([getCourseSummary(), getSemesters()]);
    setSummary(s);
    setSemesters(sems);
    getGraduationStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }

  const handleGradeChange = async (courseId, letterGrade) => {
    setError(null);
    try {
      await updateMyCourse(courseId, { letterGrade: letterGrade || null });
      await refreshAfterChange();
    } catch {
      setError('성적 저장에 실패했어요.');
    }
  };

  const handleDelete = async (courseId) => {
    if (!window.confirm('이 과목을 삭제할까요?')) return;
    setError(null);
    try {
      await deleteMyCourse(courseId);
      await refreshAfterChange();
    } catch {
      setError('삭제에 실패했어요.');
    }
  };

  const handleSearch = async (value) => {
    setKeyword(value);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await searchCatalog(value, current.year, current.semester);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  };

  const closeAddForm = () => {
    setShowAddForm(false);
    setKeyword('');
    setSearchResults([]);
    setManualFields({ name: '', credits: '', category: '전공선택' });
    setManualSchedule([]);
    setCatalogSelection(null);
    setPdfRows(null);
    setPdfWarnings([]);
    setPdfCreditsCheck(null);
  };

  // 카탈로그(시간표 없는 항목)/직접입력 두 경로가 같은 에러 코드를 쓰므로 메시지 문구를 공용으로 뺐다.
  const describeAddCourseError = (err) => {
    if (err.code === 'COURSE_ALREADY_ADDED') return '이미 추가된 과목이에요.';
    if (err.code === 'DUPLICATE_SCHEDULE_SLOT') return '같은 시간을 두 번 입력했어요.';
    if (err.code === 'SCHEDULE_CONFLICT') {
      const { day, period, conflictCourseName } = err.data || {};
      return `${day}요일 ${period}교시는 이미 "${conflictCourseName}"와 겹쳐요.`;
    }
    return '과목 추가에 실패했어요.';
  };

  const handleSelectCatalogResult = (r) => {
    if (formatSchedule(r.schedule)) {
      handleAddFromCatalog(r.courseId);
    } else {
      setManualSchedule([]);
      setCatalogSelection(r);
    }
  };

  const handleAddFromCatalog = async (courseId, schedule) => {
    setError(null);
    try {
      const validSchedule = (schedule || []).filter((s) => s.day && s.period);
      await addMyCourse({
        courseId,
        year: current.year,
        semester: current.semester,
        schedule: validSchedule.length > 0 ? validSchedule : undefined,
      });
      closeAddForm();
      await refreshAfterChange();
    } catch (err) {
      setError(describeAddCourseError(err));
    }
  };

  const handleAddManual = async (e) => {
    e.preventDefault();
    if (!manualFields.name.trim() || !manualFields.credits) return;
    setError(null);
    try {
      const validSchedule = manualSchedule.filter((s) => s.day && s.period);
      await addMyCourse({
        name: manualFields.name,
        credits: Number(manualFields.credits),
        category: manualFields.category,
        year: current.year,
        semester: current.semester,
        schedule: validSchedule.length > 0 ? validSchedule : undefined,
      });
      closeAddForm();
      await refreshAfterChange();
    } catch (err) {
      setError(describeAddCourseError(err));
    }
  };

  const addScheduleRow = () => setManualSchedule((prev) => [...prev, { day: '월', period: 1 }]);
  const updateScheduleRow = (index, field, value) =>
    setManualSchedule((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  const removeScheduleRow = (index) => setManualSchedule((prev) => prev.filter((_, i) => i !== index));

  const handlePdfFileSelect = async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // 같은 파일을 다시 선택해도 onChange가 또 뜨도록.
    if (!file) return;

    setError(null);
    setPdfLoading(true);
    try {
      const result = await importCoursesFromPdf(file);
      setPdfRows(
        result.rows.map((r, i) => ({
          tempId: i,
          include: true,
          name: r.name,
          credits: r.credits,
          category: r.category || '',
          year: r.year,
          semester: r.semester,
          isFail: r.isFail,
        }))
      );
      setPdfWarnings(result.warnings);
      setPdfCreditsCheck({ declared: result.declaredTotalCredits, extracted: result.extractedTotalCredits });
    } catch {
      setError('PDF를 분석하지 못했어요. 원광대 인트라넷 "이수과목확인리스트"를 PDF로 저장한 파일이 맞는지 확인해주세요.');
    } finally {
      setPdfLoading(false);
    }
  };

  const updatePdfRow = (tempId, field, value) =>
    setPdfRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r)));
  const removePdfRow = (tempId) => setPdfRows((prev) => prev.filter((r) => r.tempId !== tempId));

  const describePdfConfirmError = (err) => {
    if (err.code === 'REQUIRED_ROWS') return '등록할 과목을 선택해주세요.';
    if (err.code === 'INVALID_ROW') return '과목 이름·학점·이수구분·연도·학기 중 비어있는 값이 있어요. 각 행을 확인해주세요.';
    if (err.code === 'INVALID_CATEGORY') return '이수구분 값이 올바르지 않아요. 다시 선택해주세요.';
    if (err.code === 'ROW_NAME_TOO_LONG') {
      const name = err.data?.name || '';
      return `과목명이 너무 길어요(100자 제한, 현재 ${name.length}자). 아래 행을 표에서 직접 줄여주세요. PDF 표 레이아웃이 깨져 여러 과목명이 합쳐진 경우일 수 있어요.\n\n"${name}"`;
    }
    if (err.code === 'INVALID_CREDITS') return '학점 값이 올바르지 않아요. 표에서 해당 과목의 학점을 확인해주세요.';
    if (err.status === 401) return '로그인이 만료됐어요. 다시 로그인한 뒤 시도해주세요.';
    return '등록에 실패했어요.';
  };

  const handlePdfConfirm = async () => {
    const included = pdfRows.filter((r) => r.include);
    if (included.length === 0) return;
    if (included.some((r) => !r.category)) {
      setError('이수구분을 선택하지 않은 과목이 있어요.');
      return;
    }

    setError(null);
    setPdfSubmitting(true);
    try {
      await confirmImportedCourses(
        included.map((r) => ({
          name: r.name,
          credits: Number(r.credits),
          category: r.category,
          year: Number(r.year),
          semester: Number(r.semester),
        }))
      );
      closeAddForm();
      await refreshAfterChange();
    } catch (err) {
      setError(describePdfConfirmError(err));
    } finally {
      setPdfSubmitting(false);
    }
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">과목 관리</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
          onOpenProfile={onOpenProfile}
        />
      </header>

      <div className="courses-body">
        {error && !showAddForm && <p className="home-error">{error}</p>}

        <div className="courses-year-tabs">
          {years.map((y) => (
            <button
              key={y}
              className={`courses-year-tab ${y === current.year ? 'active' : ''}`}
              onClick={() => handleSelectYear(y)}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="courses-semester-row">
          <button
            className="courses-semester-nav"
            onClick={goToPrevSemester}
            disabled={currentTabIndex <= 0}
            aria-label="이전 학기"
          >
            ‹
          </button>
          <div className="courses-semester-toggle">
            {semestersInCurrentYear.map((t) => (
              <button
                key={semesterKey(t.year, t.semester)}
                className={`courses-semester-btn ${t.semester === current.semester ? 'active' : ''}`}
                onClick={() => setCurrent(t)}
              >
                {t.semester}학기
              </button>
            ))}
          </div>
          <button
            className="courses-semester-nav"
            onClick={goToNextSemester}
            disabled={currentTabIndex < 0 || currentTabIndex >= tabs.length - 1}
            aria-label="다음 학기"
          >
            ›
          </button>
        </div>

        <div className="courses-summary-row">
          <div className="courses-summary-stat">
            <p className="home-card-label">신청학점</p>
            <p className="courses-summary-value">{registeredCredits}학점</p>
          </div>
          <div className="courses-summary-stat">
            <p className="home-card-label">평균 학점</p>
            <p className="courses-summary-value">{currentSemesterSummary ? currentSemesterSummary.gpa : '-'}</p>
          </div>
        </div>

        <div className="courses-summary-row courses-summary-row-total">
          <div className="courses-summary-stat">
            <p className="home-card-label">전체 이수학점</p>
            <p className="courses-summary-value">
              {status ? status.totalEarnedCredits : summary ? summary.total.earnedCredits : 0}학점
            </p>
          </div>
          <div className="courses-summary-stat">
            <p className="home-card-label">전체 평균 학점</p>
            <p className="courses-summary-value">{summary && summary.total.gpa > 0 ? summary.total.gpa : '-'}</p>
          </div>
        </div>

        <p className="courses-section-label">시간표</p>
        <div className="courses-timetable">
          <div className="courses-timetable-grid" style={{ gridTemplateRows: `repeat(${maxPeriod + 1}, auto)` }}>
            <div className="courses-timetable-corner" />
            {DAYS.map((d) => (
              <div key={d} className="courses-timetable-daylabel">
                {d}
              </div>
            ))}
            {Array.from({ length: maxPeriod }, (_, i) => i + 1).map((period) => (
              <React.Fragment key={period}>
                <div className="courses-timetable-periodlabel">{period}</div>
                {DAYS.map((d) => {
                  const cell = cellAt(d, period);
                  const colorClass = cell ? `tt-c${courseColorIndex.get(cell.name)}` : '';
                  return (
                    <div key={d} className={`courses-timetable-cell ${cell ? `filled ${colorClass}` : ''}`}>
                      {cell?.name}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        <p className="courses-section-label">수강 목록</p>
        <div className="courses-list">
          {myCourses.length === 0 && <p className="courses-empty">아직 등록된 과목이 없어요.</p>}
          {myCourses.map((c) => (
            <div key={c.id} className="courses-list-item">
              <div className="courses-list-item-info">
                <p className="courses-list-item-name">{c.name}</p>
                <p className="courses-list-item-meta">
                  {c.category} · {c.credits}학점
                </p>
              </div>
              <select
                className="courses-grade-select"
                value={c.letterGrade || ''}
                onChange={(e) => handleGradeChange(c.id, e.target.value)}
              >
                <option value="">미입력</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <button className="courses-delete-btn" onClick={() => handleDelete(c.id)} aria-label="삭제">
                <IconTrash />
              </button>
            </div>
          ))}
        </div>

        {!showAddForm && (
          <button
            className="courses-add-btn"
            onClick={() => {
              setError(null);
              setShowAddForm(true);
            }}
          >
            <IconPlus />
            과목 추가
          </button>
        )}

        {showAddForm && (
          <div className="courses-add-form" ref={addFormRef}>
            {error && <p className="home-error courses-form-error">{error}</p>}
            <div className="courses-add-form-header">
              <div className="courses-add-mode-toggle">
                <button
                  className={addMode === 'catalog' ? 'active' : ''}
                  onClick={() => setAddMode('catalog')}
                  type="button"
                >
                  카탈로그 검색
                </button>
                <button
                  className={addMode === 'manual' ? 'active' : ''}
                  onClick={() => setAddMode('manual')}
                  type="button"
                >
                  직접입력
                </button>
                <button
                  className={addMode === 'pdf' ? 'active' : ''}
                  onClick={() => setAddMode('pdf')}
                  type="button"
                >
                  PDF 가져오기
                </button>
              </div>
              <button className="courses-close-btn" onClick={closeAddForm} aria-label="닫기">
                <IconX />
              </button>
            </div>

            {addMode === 'pdf' && (
              <div className="courses-pdf-import">
                <p className="courses-manual-hint">
                  원광대 인트라넷의 "이수과목확인리스트"를 PDF로 저장해 올리면 과목명·학점·이수구분·이수학기를
                  자동으로 채워드려요. 성적(등급)은 이 문서에 없어 채워지지 않으니, 등록 후 과목 목록에서 직접
                  입력해주세요.
                </p>

                {!pdfRows && (
                  <>
                    <details className="courses-pdf-help">
                      <summary>어떤 PDF를 올려야 하나요?</summary>
                      <ol className="courses-pdf-help-steps">
                        <li>원광대 인트라넷 로그인 → <strong>이수과목확인리스트</strong> 메뉴로 이동하세요.</li>
                        <li>
                          브라우저 인쇄(Ctrl+P) 화면에서 프린터 대상을 <strong>"PDF로 저장"</strong>으로 바꿔 저장하세요.
                          화면을 캡처한 사진이 아니라 이 방식으로 저장한 PDF여야 정확히 인식돼요.
                        </li>
                        <li>저장한 PDF 파일을 아래 "PDF 파일 선택"으로 올려주세요.</li>
                      </ol>
                      <p className="courses-pdf-help-note">
                        성적증명서·수강신청내역·시간표 화면은 표 형식이 달라 인식되지 않아요. 반드시
                        "이수과목확인리스트" 화면으로 저장한 PDF를 사용해주세요.
                      </p>
                    </details>

                    <label className="courses-pdf-upload-btn">
                      {pdfLoading ? '분석 중...' : 'PDF 파일 선택'}
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={handlePdfFileSelect}
                        disabled={pdfLoading}
                        hidden
                      />
                    </label>
                  </>
                )}

                {pdfRows && (
                  <>
                    {pdfWarnings.length > 0 && (
                      <div className="courses-pdf-warnings">
                        {pdfWarnings.map((w, i) => (
                          <p key={i} className="home-error courses-form-error">
                            {w}
                          </p>
                        ))}
                      </div>
                    )}
                    {pdfCreditsCheck && (
                      <p className="courses-manual-hint">
                        문서상 총 취득학점 {pdfCreditsCheck.declared} · 인식된 학점 합계 {pdfCreditsCheck.extracted}
                      </p>
                    )}

                    <div className="courses-pdf-table">
                      {pdfRows.map((r) => (
                        <div key={r.tempId} className={`courses-pdf-row ${r.include ? '' : 'excluded'}`}>
                          <div className="courses-pdf-row-main">
                            <input
                              type="checkbox"
                              checked={r.include}
                              onChange={(e) => updatePdfRow(r.tempId, 'include', e.target.checked)}
                              aria-label="가져오기 포함"
                            />
                            <input
                              type="text"
                              className="courses-pdf-name"
                              value={r.name}
                              onChange={(e) => updatePdfRow(r.tempId, 'name', e.target.value)}
                            />
                            <button
                              type="button"
                              className="courses-schedule-remove"
                              onClick={() => removePdfRow(r.tempId)}
                              aria-label="목록에서 제외"
                            >
                              <IconX />
                            </button>
                          </div>
                          <div className="courses-pdf-row-meta">
                            <label className="courses-pdf-meta-field courses-pdf-meta-category">
                              <span className="courses-pdf-meta-label">이수구분</span>
                              <select
                                className={!r.category ? 'courses-pdf-category-missing' : ''}
                                value={r.category}
                                onChange={(e) => updatePdfRow(r.tempId, 'category', e.target.value)}
                              >
                                <option value="">선택 안 됨</option>
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="courses-pdf-meta-field courses-pdf-meta-credits">
                              <span className="courses-pdf-meta-label">학점</span>
                              <input
                                type="number"
                                step="0.5"
                                value={r.credits}
                                onChange={(e) => updatePdfRow(r.tempId, 'credits', e.target.value)}
                              />
                            </label>
                            <label className="courses-pdf-meta-field courses-pdf-meta-year">
                              <span className="courses-pdf-meta-label">이수년도</span>
                              <input
                                type="number"
                                value={r.year}
                                onChange={(e) => updatePdfRow(r.tempId, 'year', e.target.value)}
                              />
                            </label>
                            <label className="courses-pdf-meta-field courses-pdf-meta-semester">
                              <span className="courses-pdf-meta-label">학기</span>
                              <select
                                value={r.semester}
                                onChange={(e) => updatePdfRow(r.tempId, 'semester', Number(e.target.value))}
                              >
                                <option value={1}>1학기</option>
                                <option value={2}>2학기</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="auth-submit-btn"
                      onClick={handlePdfConfirm}
                      disabled={pdfSubmitting || pdfRows.every((r) => !r.include)}
                    >
                      {pdfSubmitting
                        ? '등록 중...'
                        : `선택한 ${pdfRows.filter((r) => r.include).length}개 과목 등록`}
                    </button>
                    <button
                      type="button"
                      className="courses-manual-only-note courses-catalog-back"
                      onClick={() => {
                        setPdfRows(null);
                        setPdfWarnings([]);
                        setPdfCreditsCheck(null);
                      }}
                    >
                      ‹ 다시 업로드
                    </button>
                  </>
                )}
              </div>
            )}

            {addMode !== 'pdf' && (addMode === 'catalog' ? (
              catalogSelection ? (
                <div className="courses-manual-fields">
                  <p className="courses-manual-hint">
                    "{catalogSelection.name}"은 아직 시간표가 등록되어 있지 않아요. 알고 있다면 아래에서
                    입력해주세요 — 몰라도 등록은 되고, 나중에 다시 채울 수 있습니다.
                  </p>
                  <div className="auth-field">
                    <label>시간표 (선택)</label>
                    {manualSchedule.map((s, i) => (
                      <div className="courses-schedule-row" key={i}>
                        <select value={s.day} onChange={(e) => updateScheduleRow(i, 'day', e.target.value)}>
                          {DAYS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                        <select
                          value={s.period}
                          onChange={(e) => updateScheduleRow(i, 'period', Number(e.target.value))}
                        >
                          {Array.from({ length: 10 }, (_, p) => p + 1).map((p) => (
                            <option key={p} value={p}>
                              {p}교시
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="courses-schedule-remove"
                          onClick={() => removeScheduleRow(i)}
                          aria-label="시간 삭제"
                        >
                          <IconX />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="courses-schedule-add" onClick={addScheduleRow}>
                      <IconPlus />
                      교시 추가
                    </button>
                  </div>
                  <button
                    type="button"
                    className="auth-submit-btn"
                    onClick={() => handleAddFromCatalog(catalogSelection.courseId, manualSchedule)}
                  >
                    추가하기
                  </button>
                  <button type="button" className="courses-manual-only-note courses-catalog-back" onClick={() => setCatalogSelection(null)}>
                    ‹ 검색으로 돌아가기
                  </button>
                </div>
              ) : (
                <>
                  <p className="courses-manual-hint">
                    전공 과목 위주로 검색돼요 — 교양 과목은 학기에 따라 카탈로그에 없을 수 있어요.
                    검색 결과가 없으면 "직접입력" 탭을 이용해주세요.
                  </p>
                  <div className="courses-search-box">
                    <IconSearch />
                    <input
                      type="text"
                      placeholder="과목명 검색"
                      value={keyword}
                      onChange={(e) => handleSearch(e.target.value)}
                    />
                  </div>
                  <div className="courses-search-results" ref={searchResultsRef}>
                    {searchResults.map((r) => (
                      <button
                        key={r.courseId}
                        className="courses-search-result"
                        onClick={() => handleSelectCatalogResult(r)}
                      >
                        <span className="courses-list-item-name">{r.name}</span>
                        <span className="courses-list-item-meta">
                          {r.category} · {r.credits}학점{r.professor ? ` · ${r.professor}` : ''}
                          {formatSchedule(r.schedule) ? ` · ${formatSchedule(r.schedule)}` : ' · 시간표 미등록'}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )
            ) : (
              <form className="courses-manual-fields" onSubmit={handleAddManual}>
                <p className="courses-manual-hint">
                  전공·교양 상관없이 과목명/학점/이수구분만 입력하면 등록돼요. 시간표는 선택사항이라 몰라도
                  괜찮습니다 — 아는 경우에만 아래에서 추가하면 시간표에도 표시돼요.
                </p>
                <div className="auth-field">
                  <label>과목명</label>
                  <input
                    type="text"
                    value={manualFields.name}
                    onChange={(e) => setManualFields({ ...manualFields, name: e.target.value })}
                    required
                  />
                </div>
                <div className="auth-field">
                  <label>학점</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualFields.credits}
                    onChange={(e) => setManualFields({ ...manualFields, credits: e.target.value })}
                    required
                  />
                </div>
                <div className="auth-field">
                  <label>이수구분</label>
                  <select
                    className="courses-category-select"
                    value={manualFields.category}
                    onChange={(e) => setManualFields({ ...manualFields, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="auth-field">
                  <label>시간표 (선택)</label>
                  {manualSchedule.map((s, i) => (
                    <div className="courses-schedule-row" key={i}>
                      <select value={s.day} onChange={(e) => updateScheduleRow(i, 'day', e.target.value)}>
                        {DAYS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <select
                        value={s.period}
                        onChange={(e) => updateScheduleRow(i, 'period', Number(e.target.value))}
                      >
                        {Array.from({ length: 10 }, (_, p) => p + 1).map((p) => (
                          <option key={p} value={p}>
                            {p}교시
                          </option>
                        ))}
                      </select>
                      <button type="button" className="courses-schedule-remove" onClick={() => removeScheduleRow(i)} aria-label="시간 삭제">
                        <IconX />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="courses-schedule-add" onClick={addScheduleRow}>
                    <IconPlus />
                    교시 추가
                  </button>
                </div>

                <button type="submit" className="auth-submit-btn">
                  추가하기
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CourseManagement;
