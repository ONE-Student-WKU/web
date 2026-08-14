import React, { useEffect, useMemo, useState } from 'react';
import {
  getMyCourses,
  getTimetable,
  getCourseSummary,
  getSemesters,
  searchCatalog,
  addMyCourse,
  updateMyCourse,
  deleteMyCourse,
} from '../api/chatApi.js';
import { IconPlus, IconTrash, IconSearch, IconX } from '../components/icons.jsx';
import AccountMenu from '../components/AccountMenu.jsx';

const DAYS = ['월', '화', '수', '목', '금'];
const GRADES = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F'];
const CATEGORIES = ['전공필수', '전공선택', '교양필수', '교양선택', '일반선택'];

// 휴학/전과/편입 등으로 재학 기간이 늘어질 수 있어 넉넉히 8년 전까지 선택지로 제공.
const CURRENT_CALENDAR_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 9 }, (_, i) => CURRENT_CALENDAR_YEAR - i);

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
 */
function CourseManagement({ user, onGoHome, onLogout, onOpenSettings }) {
  const [current, setCurrent] = useState(getCurrentYearSemester);
  const [summary, setSummary] = useState(null);
  const [semesters, setSemesters] = useState([]);
  const [myCourses, setMyCourses] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState('catalog'); // 'catalog' | 'manual'
  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [manualFields, setManualFields] = useState({ name: '', credits: '', category: '전공선택' });
  const [manualSchedule, setManualSchedule] = useState([]); // [{day, period}] — 선택 입력
  const [showSemesterPicker, setShowSemesterPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(current.year);
  const [pickerSemester, setPickerSemester] = useState(current.semester);
  // 과목이 하나도 없는 학기는 서버 목록(listSemesters)에 안 잡혀서, 다른 학기로 넘어가면
  // 탭에서 통째로 사라진다 — "추가"라고 눌러놓고 화면에서 없어지면 "덮어씌워진" 것처럼
  // 느껴지므로, 이번 세션에서 사용자가 직접 추가한 학기는 로컬에 기억해 탭에 계속 남긴다.
  const [addedSemesters, setAddedSemesters] = useState([]);

  useEffect(() => {
    getCourseSummary()
      .then(setSummary)
      .catch(() => setError('정보를 불러오지 못했어요.'));
    getSemesters()
      .then(setSemesters)
      .catch(() => setError('정보를 불러오지 못했어요.'));
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
    const all = [...semesters, ...addedSemesters, current];
    const seen = new Set();
    const deduped = [];
    for (const t of all) {
      const key = semesterKey(t.year, t.semester);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(t);
    }
    return deduped.sort((a, b) => a.year - b.year || a.semester - b.semester);
  }, [semesters, addedSemesters, current]);

  const currentSemesterSummary = summary?.bySemester?.find(
    (s) => s.year === current.year && s.semester === current.semester
  );
  const registeredCredits = myCourses.reduce((sum, c) => sum + c.credits, 0);

  // 카탈로그(courses.json)는 "지금 실제로 개설 중인" 과목/시간표라, 과거·미래 학기
  // 기록에 갖다 쓰면 사실과 다른 교수/시간이 붙을 수 있다 — 지금 보고 있는 학기가
  // 실제 현재 학기일 때만 카탈로그 검색을 허용하고, 그 외엔 직접입력만 가능하게 한다.
  const actualCurrentTerm = getCurrentYearSemester();
  const isCurrentTerm = current.year === actualCurrentTerm.year && current.semester === actualCurrentTerm.semester;
  const effectiveAddMode = isCurrentTerm ? addMode : 'manual';

  const maxPeriod = Math.max(6, ...timetable.map((t) => t.period));
  const cellAt = (day, period) => timetable.find((t) => t.day === day && t.period === period);

  async function refreshAfterChange() {
    loadSemesterData(current.year, current.semester);
    const [s, sems] = await Promise.all([getCourseSummary(), getSemesters()]);
    setSummary(s);
    setSemesters(sems);
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
      const results = await searchCatalog(value);
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
  };

  const handleAddFromCatalog = async (courseId) => {
    setError(null);
    try {
      await addMyCourse({ courseId, year: current.year, semester: current.semester });
      closeAddForm();
      await refreshAfterChange();
    } catch (err) {
      setError(err.code === 'COURSE_ALREADY_ADDED' ? '이미 추가된 과목이에요.' : '과목 추가에 실패했어요.');
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
    } catch {
      setError('과목 추가에 실패했어요.');
    }
  };

  const addScheduleRow = () => setManualSchedule((prev) => [...prev, { day: '월', period: 1 }]);
  const updateScheduleRow = (index, field, value) =>
    setManualSchedule((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  const removeScheduleRow = (index) => setManualSchedule((prev) => prev.filter((_, i) => i !== index));

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            ‹
          </button>
          <span className="screen-title">과목 관리</span>
        </div>
        <AccountMenu user={user} onLogout={onLogout} onOpenSettings={onOpenSettings} />
      </header>

      <div className="courses-body">
        {error && !showAddForm && <p className="home-error">{error}</p>}

        <div className="courses-tabs">
          {tabs.map((t) => (
            <button
              key={semesterKey(t.year, t.semester)}
              className={`courses-tab ${t.year === current.year && t.semester === current.semester ? 'active' : ''}`}
              onClick={() => setCurrent(t)}
            >
              {t.year}-{t.semester}
              {t.courseCount > 0 && <span className="courses-tab-count">{t.courseCount}</span>}
            </button>
          ))}
          <button
            className="courses-tab courses-tab-add"
            onClick={() => {
              setPickerYear(current.year);
              setPickerSemester(current.semester);
              setShowSemesterPicker((v) => !v);
            }}
          >
            + 학기 추가
          </button>
        </div>

        {showSemesterPicker && (
          <div className="courses-semester-picker">
            <select
              className="courses-picker-year"
              value={pickerYear}
              onChange={(e) => setPickerYear(Number(e.target.value))}
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <span>년</span>
            <select
              className="courses-picker-semester"
              value={pickerSemester}
              onChange={(e) => setPickerSemester(Number(e.target.value))}
            >
              <option value={1}>1학기</option>
              <option value={2}>2학기</option>
            </select>
            <button
              className="courses-picker-go"
              onClick={() => {
                const target = { year: pickerYear, semester: pickerSemester };
                setAddedSemesters((prev) =>
                  prev.some((s) => s.year === target.year && s.semester === target.semester) ? prev : [...prev, target]
                );
                setCurrent(target);
                setShowSemesterPicker(false);
              }}
            >
              추가
            </button>
          </div>
        )}

        <div className="courses-summary-row">
          <div className="courses-summary-stat">
            <p className="home-card-label">신청학점</p>
            <p className="courses-summary-value">{registeredCredits}학점</p>
          </div>
          <div className="courses-summary-stat">
            <p className="home-card-label">평점(GPA)</p>
            <p className="courses-summary-value">{currentSemesterSummary ? currentSemesterSummary.gpa : '-'}</p>
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
                  return (
                    <div key={d} className={`courses-timetable-cell ${cell ? 'filled' : ''}`}>
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
          <div className="courses-add-form">
            {error && <p className="home-error courses-form-error">{error}</p>}
            <div className="courses-add-form-header">
              {isCurrentTerm ? (
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
                </div>
              ) : (
                <p className="courses-manual-only-note">
                  카탈로그는 현재 학기 기준이라 다른 학기에는 직접입력만 가능해요.
                </p>
              )}
              <button className="courses-close-btn" onClick={closeAddForm} aria-label="닫기">
                <IconX />
              </button>
            </div>

            {effectiveAddMode === 'catalog' ? (
              <>
                <div className="courses-search-box">
                  <IconSearch />
                  <input
                    type="text"
                    placeholder="과목명 검색"
                    value={keyword}
                    onChange={(e) => handleSearch(e.target.value)}
                  />
                </div>
                <div className="courses-search-results">
                  {searchResults.map((r) => (
                    <button key={r.courseId} className="courses-search-result" onClick={() => handleAddFromCatalog(r.courseId)}>
                      <span className="courses-list-item-name">{r.name}</span>
                      <span className="courses-list-item-meta">
                        {r.category} · {r.credits}학점{r.professor ? ` · ${r.professor}` : ''}
                        {formatSchedule(r.schedule) ? ` · ${formatSchedule(r.schedule)}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </>
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
                        {Array.from({ length: 9 }, (_, p) => p + 1).map((p) => (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CourseManagement;
