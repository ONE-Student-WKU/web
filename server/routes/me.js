const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const studentService = require('../services/studentService');
const { isCurrentConsent, CURRENT_CONSENT_VERSION } = require('../services/consent');
const { validateLeavePeriods } = require('../services/leavePeriods');
const { validateHomeLayout } = require('../services/homeLayout');

/**
 * Routes for the current logged-in student (/api/me)
 * 근거: 위키 API-설계 2.1, 2.2 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 * (※ 이 문서는 PATCH /me/password가 있던 시절 기준 — 로그인이 Google OAuth로 대체되면서
 *   비밀번호 변경 엔드포인트는 폐지됐고 DELETE /me의 재확인 방식도 바뀜. 위키 갱신 필요)
 */

const { isIntInRange, validateNickname, isValidAdmissionYear } = require('../services/inputValidation');
const { VALID_ENROLLMENT_TYPES, VALID_MAJOR_CHANGE_GRADES, VALID_MAJOR_CHANGE_SEMESTERS, VALID_TRANSFER_GRADES, VALID_LANGUAGES, serializeStudent } = studentService;

// GET /api/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }

    return res.status(200).json({ status: 200, code: 'ME_SUCCESS', message: null, data: serializeStudent(student) });
  } catch (err) {
    next(err);
  }
});

// POST /api/me/consent — 이용약관·개인정보 수집·이용 동의(로그인 직후 동의 화면). 클라이언트가 보낸 버전이 현재 버전일 때만
// 기록한다(약관이 바뀌었는데 옛 화면에서 동의가 들어오는 일을 막는다).
router.post('/me/consent', requireAuth, async (req, res, next) => {
  try {
    if (!isCurrentConsent(req.body.version)) {
      return res.status(400).json({ status: 400, code: 'INVALID_CONSENT_VERSION', message: null, data: null });
    }
    await studentService.recordConsent(req.session.userId, CURRENT_CONSENT_VERSION);
    const updated = await studentService.findById(req.session.userId);
    return res.status(200).json({ status: 200, code: 'CONSENT_RECORDED', message: null, data: serializeStudent(updated) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/me
// 가벼운 필드(secondDepartmentId, careerCounselingCount)는 독립적으로 갱신되고,
// 무거운 필드(departmentId/admissionYear/enrollmentType/majorChangeGrade/trackId)는
// 졸업요건 진단(curriculum_requirements) 재산정 대상이라 프론트에서 신중히 다뤄야 함.
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }

    const {
      name, departmentId, admissionYear, enrollmentType, trackId,
      majorChangeGrade, majorChangeYear, majorChangeSemester, transferGrade,
      secondDepartmentId, careerCounselingCount, leaveSemesters, language, homeLayout,
    } = req.body;

    // name은 문자열이어야 한다(숫자·객체가 오면 아래 .trim()에서 서버가 500으로 터졌다).
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_NAME', message: null, data: null });
    }
    if (name !== undefined) {
      const nameError = validateNickname(name);
      if (nameError) return res.status(400).json({ status: 400, code: nameError, message: null, data: null });
    }
    if (admissionYear !== undefined && !isValidAdmissionYear(admissionYear)) {
      return res.status(400).json({ status: 400, code: 'INVALID_ADMISSION_YEAR', message: null, data: null });
    }
    if (careerCounselingCount !== undefined && !isIntInRange(careerCounselingCount, 0, 1000)) {
      return res.status(400).json({ status: 400, code: 'INVALID_CAREER_COUNSELING_COUNT', message: null, data: null });
    }

    // 닉네임 사칭/도용 방지 — students.name의 UNIQUE 제약(db/schema.sql)이 최종 방어선이고,
    // 이건 그 전에 사용자에게 원인을 알려주기 위한 사전 확인이다(동시 요청 경합 시 UNIQUE
    // 위반이 실제로 날 수 있어 아래 catch에서도 ER_DUP_ENTRY를 한 번 더 처리한다).
    if (name !== undefined) {
      const trimmedName = name.trim();
      // "user{id}"는 닉네임 미설정 계정의 표시용 대체값(studentService.serializeStudent)일
      // 뿐 실제 저장되는 값이 아니라서, name 컬럼 UNIQUE 제약이나 findByName 비교로는 안
      // 걸린다 — 이 형식을 직접 자기 닉네임으로 쓰면 아직 닉네임을 안 정한 다른 계정을 화면에서
      // 구분 못 하게 사칭할 수 있다(실사용 확인). 존재하는 id인지와 무관하게 형식 자체를 막는다.
      if (/^user\d+$/i.test(trimmedName)) {
        return res.status(400).json({ status: 400, code: 'RESERVED_NAME', message: null, data: null });
      }
      const existing = await studentService.findByName(trimmedName);
      if (existing && existing.id !== student.id) {
        return res.status(409).json({ status: 409, code: 'DUPLICATE_NAME', message: null, data: null });
      }
    }

    if (enrollmentType !== undefined && !VALID_ENROLLMENT_TYPES.includes(enrollmentType)) {
      return res.status(400).json({ status: 400, code: 'INVALID_ENROLLMENT_TYPE', message: null, data: null });
    }

    // 화면·챗봇 답변 언어 — 지원하는 언어 코드만 받는다(null로 "정한 적 없음"으로 되돌리는 건 지원하지 않음).
    if (language !== undefined && !VALID_LANGUAGES.includes(language)) {
      return res.status(400).json({ status: 400, code: 'INVALID_LANGUAGE', message: null, data: null });
    }

    if (leaveSemesters !== undefined && !isIntInRange(leaveSemesters, 0, 30)) {
      return res.status(400).json({ status: 400, code: 'INVALID_LEAVE_SEMESTERS', message: null, data: null });
    }
    // 홈 화면 편집 설정 — 하단 바 4칸은 정해진 목록에서만, 하단 바 켜기/끄기는 true/false만 받는다. null은 기본 배치로 되돌리기.
    let validHomeLayout;
    if (homeLayout !== undefined) {
      const { layout, error } = validateHomeLayout(homeLayout);
      if (error) return res.status(400).json({ status: 400, code: error, message: null, data: null });
      validHomeLayout = layout;
    }

    // 휴학 기간을 입력한 계정의 휴학 학기 수는 그 기간의 합계라 따로 고칠 수 없다(PUT /api/me/leave-periods로 기간을 고친다).
    if (leaveSemesters !== undefined && student.leave_periods != null) {
      return res.status(400).json({ status: 400, code: 'USE_LEAVE_PERIODS', message: null, data: null });
    }

    // majorChangeGrade/Year/Semester는 전과생(MAJOR_CHANGE)일 때만 의미가 있음 — 이번 요청에서
    // 확정되는 enrollmentType(요청에 없으면 기존 값) 기준으로 검증. 교양 이수기준이 "전과 시점"
    // (연도+학기)으로 갈리므로 셋 다 같은 방식으로 검증한다 (db/regulations/전공선택/전과.md 참고).
    const effectiveEnrollmentType = enrollmentType !== undefined ? enrollmentType : student.enrollment_type;

    if (majorChangeGrade !== undefined && majorChangeGrade !== null) {
      if (effectiveEnrollmentType !== 'MAJOR_CHANGE') {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_GRADE', message: null, data: null });
      }
      if (!VALID_MAJOR_CHANGE_GRADES.includes(Number(majorChangeGrade))) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_GRADE', message: null, data: null });
      }
    }
    if (effectiveEnrollmentType === 'MAJOR_CHANGE' && majorChangeGrade === undefined && student.major_change_grade === null) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_MAJOR_CHANGE_GRADE', message: null, data: null });
    }

    if (majorChangeYear !== undefined && majorChangeYear !== null && effectiveEnrollmentType !== 'MAJOR_CHANGE') {
      return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_YEAR', message: null, data: null });
    }
    if (effectiveEnrollmentType === 'MAJOR_CHANGE' && majorChangeYear === undefined && student.major_change_year === null) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_MAJOR_CHANGE_YEAR', message: null, data: null });
    }

    if (majorChangeSemester !== undefined && majorChangeSemester !== null) {
      if (effectiveEnrollmentType !== 'MAJOR_CHANGE') {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_SEMESTER', message: null, data: null });
      }
      if (!VALID_MAJOR_CHANGE_SEMESTERS.includes(Number(majorChangeSemester))) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_SEMESTER', message: null, data: null });
      }
    }
    if (effectiveEnrollmentType === 'MAJOR_CHANGE' && majorChangeSemester === undefined && student.major_change_semester === null) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_MAJOR_CHANGE_SEMESTER', message: null, data: null });
    }

    // transferGrade는 편입생(TRANSFER_ADMISSION)일 때만 의미가 있다. 유형을 편입생으로 바꾸는 요청에는 반드시 같이 보내야 하고(학번을
    // "편입 연도 − 학년 + 1"로 다시 계산해야 하므로), 이미 편입생이면서 옛 방식으로 입력해 값이 없는 계정이 다른 항목만 고칠 때는
    // 요구하지 않는다(그 계정의 판정은 그대로 "3학년 편입 가정" 추정이다).
    if (transferGrade !== undefined && transferGrade !== null) {
      if (effectiveEnrollmentType !== 'TRANSFER_ADMISSION') {
        return res.status(400).json({ status: 400, code: 'INVALID_TRANSFER_GRADE', message: null, data: null });
      }
      if (!VALID_TRANSFER_GRADES.includes(Number(transferGrade))) {
        return res.status(400).json({ status: 400, code: 'INVALID_TRANSFER_GRADE', message: null, data: null });
      }
    }
    if (enrollmentType === 'TRANSFER_ADMISSION' && student.enrollment_type !== 'TRANSFER_ADMISSION' && (transferGrade === undefined || transferGrade === null)) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_TRANSFER_GRADE', message: null, data: null });
    }

    if (departmentId !== undefined) {
      const dept = await studentService.findDepartmentById(departmentId);
      if (!dept) return res.status(400).json({ status: 400, code: 'INVALID_DEPARTMENT_ID', message: null, data: null });
    }
    if (secondDepartmentId !== undefined && secondDepartmentId !== null) {
      const dept = await studentService.findDepartmentById(secondDepartmentId);
      if (!dept) return res.status(400).json({ status: 400, code: 'INVALID_SECOND_DEPARTMENT_ID', message: null, data: null });
    }

    // trackId: 이번 요청에서 확정되는 departmentId(요청에 없으면 기존 값) 소속 트랙인지 검증.
    if (trackId !== undefined && trackId !== null) {
      const effectiveDepartmentId = departmentId !== undefined ? departmentId : student.department_id;
      const track = await studentService.findTrackById(trackId);
      if (!track || String(track.department_id) !== String(effectiveDepartmentId)) {
        return res.status(400).json({ status: 400, code: 'INVALID_TRACK_ID', message: null, data: null });
      }
    }

    await studentService.updateProfile(req.session.userId, {
      name: name !== undefined ? name.trim() : undefined,
      departmentId,
      admissionYear,
      enrollmentType,
      trackId,
      majorChangeGrade,
      majorChangeYear,
      majorChangeSemester,
      // 편입생이 아닌 유형으로 바꾸면 이전 편입 학년이 남지 않게 비운다.
      transferGrade: enrollmentType !== undefined && enrollmentType !== 'TRANSFER_ADMISSION' ? null : transferGrade,
      secondDepartmentId,
      careerCounselingCount,
      leaveSemesters,
      language,
      homeLayout: validHomeLayout,
    });
    if (admissionYear !== undefined || enrollmentType !== undefined || transferGrade !== undefined) {
      await studentService.revalidateLeavePeriods(req.session.userId);
    }

    const updated = await studentService.findById(req.session.userId);
    return res.status(200).json({ status: 200, code: 'ME_UPDATE_SUCCESS', message: null, data: serializeStudent(updated) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' && err.sqlMessage?.includes('uq_students_name')) {
      return res.status(409).json({ status: 409, code: 'DUPLICATE_NAME', message: null, data: null });
    }
    next(err);
  }
});

// PUT /api/me/leave-periods — 휴학 기간 저장. { periods: [] }는 "휴학한 적 없음"이다.
// 온보딩 필수 질문과, 기능 도입 전 계정에게 한 번 보여주는 질문 화면이 이 경로를 쓴다(server/services/leavePeriods.js).
router.put('/me/leave-periods', requireAuth, async (req, res, next) => {
  try {
    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }
    const { periods, error } = validateLeavePeriods(req.body && req.body.periods, {
      admissionYear: student.admission_year, enrollmentType: student.enrollment_type, transferGrade: student.transfer_grade,
    });
    if (error) return res.status(400).json({ status: 400, code: error, message: null, data: null });

    await studentService.saveLeavePeriods(req.session.userId, periods);
    const updated = await studentService.findById(req.session.userId);
    return res.status(200).json({ status: 200, code: 'LEAVE_PERIODS_SAVED', message: null, data: serializeStudent(updated) });
  } catch (err) {
    next(err);
  }
});

// 재인증 유효 시간 — /api/auth/google/reauth/callback이 세션에 남긴 deleteReauthAt이
// 이 시간 이내여야 계정 삭제를 허용한다(구글 재로그인 없이 세션만으로는 삭제 불가하게).
const REAUTH_WINDOW_MS = 5 * 60 * 1000;

// DELETE /api/me — Google 재인증(step-up) 확인 후 계정 완전 삭제(하드 삭제). 수강 이력/대화
// 기록은 students FK의 ON DELETE CASCADE로 함께 지워진다(db/schema.sql). 비밀번호가 없어진
// 이후 재확인 수단은 세션 쿠키만으로는 부족하므로(이미 로그인 상태와 같은 신뢰수준) GET
// /api/auth/google/reauth 왕복으로 Google 계정 소유를 다시 증명하게 한다.
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    const reauthAt = req.session.deleteReauthAt;
    if (!reauthAt || Date.now() - reauthAt > REAUTH_WINDOW_MS) {
      return res.status(401).json({ status: 401, code: 'REAUTH_REQUIRED', message: null, data: null });
    }

    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }

    await studentService.deleteStudent(req.session.userId);

    req.session.destroy((err) => {
      if (err) return next(err);
      res.status(200).json({ status: 200, code: 'ACCOUNT_DELETE_SUCCESS', message: null, data: null });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
