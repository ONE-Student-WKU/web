const express = require('express');
const { MAJOR_CHANGE_CLOSED_DEPARTMENTS } = require('../services/regulationEngine/constants');
const { PREMED_DEPARTMENTS } = require('../services/regulationEngine/profileCaveats');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const studentService = require('../services/studentService');
const { isCurrentConsent, CURRENT_CONSENT_VERSION } = require('../services/consent');
const { validateLeavePeriods } = require('../services/leavePeriods');
const { validateHomeLayout } = require('../services/homeLayout');
const { validateTeachingAndTransferCredits, canTakeTeachingCourse } = require('../services/teachingCourse');
const { validateMajorTrackType, isBroadSeriesStudent } = require('../services/majorTrackType');
const { validateSecondMajor } = require('../services/secondMajor');
const { findLinkedMajor, microDegreesExist, validateMicroDegreeList, setStudentMicroDegrees } = require('../services/linkedMajors');

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
      majorChangeGrade, majorChangeYear, majorChangeSemester, majorChangeRecognition, transferGrade, transferRecognizedCredits, teachingCourse, majorTrackType,
      secondDepartmentId, secondMajorType, secondLinkedMajor, microDegrees, careerCounselingCount, leaveSemesters, language, homeLayout,
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
    // "user{id}"(닉네임 미설정 계정의 표시용 대체값)와 그 변형은 validateNickname(nicknamePolicy.js)이 이미 막았다.
    if (name !== undefined) {
      const trimmedName = name.trim();
      // 학과 이름 그대로인 닉네임은 학과 사무실이 쓴 글처럼 보여서 막는다.
      if (await studentService.isDepartmentName(trimmedName)) {
        return res.status(400).json({ status: 400, code: 'RESERVED_NAME', message: null, data: null });
      }
      // 다른 학생 닉네임과 똑같거나 대소문자·공백·기호·비슷한 글자만 다르면 같은 닉네임으로 본다.
      const existing = await studentService.findConfusableName(trimmedName, student.id);
      if (existing) {
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
    // 전과생 전공학점 인정 신청 여부(true/false/null, D-77). 전과생이 아니면 받지 않는다.
    if (majorChangeRecognition !== undefined && majorChangeRecognition !== null
      && (typeof majorChangeRecognition !== 'boolean' || effectiveEnrollmentType !== 'MAJOR_CHANGE')) {
      return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_RECOGNITION', message: null, data: null });
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

    // 교직과정 이수 여부·편입 인정학점 — 이번 요청으로 확정되는 입학 유형·전과 학년 기준으로 검증한다.
    const effectiveMajorChangeGrade = majorChangeGrade !== undefined ? majorChangeGrade : student.major_change_grade;
    const extrasError = validateTeachingAndTransferCredits(
      { teachingCourse, transferRecognizedCredits },
      { enrollmentType: effectiveEnrollmentType, majorChangeGrade: effectiveMajorChangeGrade }
    );
    if (extrasError) return res.status(400).json({ status: 400, code: extrasError, message: null, data: null });
    // 학과나 유형이 바뀌어 교직을 이수할 수 없게 되거나 학과가 바뀌면, 함께 보내지 않은 이전 답은 남기지 않는다(다시 묻는다).
    const clearTeaching = teachingCourse === undefined
      && ((departmentId !== undefined && String(departmentId) !== String(student.department_id)) || !canTakeTeachingCourse({ enrollmentType: effectiveEnrollmentType, majorChangeGrade: effectiveMajorChangeGrade }));

    let effectiveDepartmentName = student.department_name;
    if (departmentId !== undefined) {
      const dept = await studentService.findDepartmentById(departmentId);
      if (!dept) return res.status(400).json({ status: 400, code: 'INVALID_DEPARTMENT_ID', message: null, data: null });
      effectiveDepartmentName = dept.name;
    }
    // 의·치·한의예(학)과·약학대학으로는 전과할 수 없다(학칙시행규칙 제111조 제4호) — 학과나 유형을 바꿔 그 조합이 되면 거절한다.
    if ((departmentId !== undefined || enrollmentType !== undefined) && effectiveEnrollmentType === 'MAJOR_CHANGE' && MAJOR_CHANGE_CLOSED_DEPARTMENTS.includes(effectiveDepartmentName)) {
      return res.status(400).json({ status: 400, code: 'MAJOR_CHANGE_CLOSED_DEPARTMENT', message: null, data: null });
    }
    // 2년 과정인 예과에는 편입학이 없다(학칙 제36조) — 학과나 유형을 바꿔 그 조합이 되면 거절한다.
    if ((departmentId !== undefined || enrollmentType !== undefined) && effectiveEnrollmentType === 'TRANSFER_ADMISSION' && PREMED_DEPARTMENTS.includes(effectiveDepartmentName)) {
      return res.status(400).json({ status: 400, code: 'TRANSFER_INTO_PREMED', message: null, data: null });
    }
    // 광역 계열전공 이수유형 — 이번 요청으로 확정되는 학과·학번 기준. 계열 학생이 아니게 되거나 학과가 바뀌면 함께 보내지 않은 이전 답은 지운다(다시 묻는다).
    const trackTypeTarget = { departmentName: effectiveDepartmentName, admissionYear: admissionYear !== undefined ? admissionYear : student.admission_year };
    const trackTypeError = validateMajorTrackType(majorTrackType, trackTypeTarget);
    if (trackTypeError) return res.status(400).json({ status: 400, code: trackTypeError, message: null, data: null });
    const clearTrackType = majorTrackType === undefined
      && ((departmentId !== undefined && String(departmentId) !== String(student.department_id)) || !isBroadSeriesStudent(trackTypeTarget));
    if (secondDepartmentId !== undefined && secondDepartmentId !== null) {
      const dept = await studentService.findDepartmentById(secondDepartmentId);
      if (!dept) return res.status(400).json({ status: 400, code: 'INVALID_SECOND_DEPARTMENT_ID', message: null, data: null });
    }
    // 다전공(복수전공·부전공, #378 G-1) — 이번 요청으로 확정되는 주전공·제2전공 기준으로 검사한다. 제2전공은 학과나 연계·복합전공(#412) 중 하나라,
    // 한쪽을 새로 고르면 다른 쪽은 지운다. 둘 다 지우면 구분도 지운다.
    const linkedGiven = secondLinkedMajor !== undefined;
    const departmentGiven = secondDepartmentId !== undefined;
    const effectiveSecondDepartmentId = departmentGiven ? secondDepartmentId : linkedGiven && secondLinkedMajor ? null : student.second_department_id;
    const effectiveSecondLinkedMajor = linkedGiven ? secondLinkedMajor : departmentGiven && secondDepartmentId != null ? null : student.second_linked_major;
    const secondMajorError = validateSecondMajor(
      { secondDepartmentId, secondMajorType, secondLinkedMajor },
      { departmentId: departmentId !== undefined ? departmentId : student.department_id, secondDepartmentId: effectiveSecondDepartmentId, secondLinkedMajor: effectiveSecondLinkedMajor }
    );
    if (secondMajorError) return res.status(400).json({ status: 400, code: secondMajorError, message: null, data: null });
    if (secondLinkedMajor != null && !(await findLinkedMajor(secondLinkedMajor))) {
      return res.status(400).json({ status: 400, code: 'INVALID_SECOND_LINKED_MAJOR', message: null, data: null });
    }
    // 학과·연계전공만 새로 고르고 구분을 안 보내면 복수전공으로 둔다(이전 화면·옛 클라이언트).
    const hasEffectiveSecond = effectiveSecondDepartmentId != null || Boolean(effectiveSecondLinkedMajor);
    let effectiveSecondMajorType; // undefined = 바꾸지 않음
    if (!hasEffectiveSecond) effectiveSecondMajorType = null;
    else if (secondMajorType !== undefined) effectiveSecondMajorType = secondMajorType || 'DOUBLE';
    else if (departmentGiven || linkedGiven) effectiveSecondMajorType = student.second_major_type || 'DOUBLE';
    // 마이크로디그리(#412) — 이름 목록 전체를 바꾼다.
    const microDegreeError = validateMicroDegreeList(microDegrees);
    if (microDegreeError) return res.status(400).json({ status: 400, code: microDegreeError, message: null, data: null });
    if (microDegrees !== undefined && !(await microDegreesExist(microDegrees))) {
      return res.status(400).json({ status: 400, code: 'INVALID_MICRO_DEGREES', message: null, data: null });
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
      // 전과생이 아닌 유형으로 바꾸면 인정 신청 답도 지운다.
      majorChangeRecognition: enrollmentType !== undefined && enrollmentType !== 'MAJOR_CHANGE'
        ? null
        : majorChangeRecognition === undefined || majorChangeRecognition === null ? majorChangeRecognition : Number(majorChangeRecognition),
      // 편입생이 아닌 유형으로 바꾸면 이전 편입 학년이 남지 않게 비운다.
      transferGrade: enrollmentType !== undefined && enrollmentType !== 'TRANSFER_ADMISSION' ? null : transferGrade,
      transferRecognizedCredits: enrollmentType !== undefined && enrollmentType !== 'TRANSFER_ADMISSION' ? null : transferRecognizedCredits,
      teachingCourse: clearTeaching ? null : teachingCourse,
      majorTrackType: clearTrackType ? null : majorTrackType,
      // 연계전공을 고르면 학과 칸을, 학과를 고르면 연계전공 칸을 비운다(제2전공은 하나).
      secondDepartmentId: effectiveSecondDepartmentId !== student.second_department_id || departmentGiven ? effectiveSecondDepartmentId : undefined,
      secondLinkedMajor: effectiveSecondLinkedMajor !== student.second_linked_major || linkedGiven ? effectiveSecondLinkedMajor ?? null : undefined,
      secondMajorType: effectiveSecondMajorType,
      careerCounselingCount,
      leaveSemesters,
      language,
      homeLayout: validHomeLayout,
    });
    if (admissionYear !== undefined || enrollmentType !== undefined || transferGrade !== undefined) {
      await studentService.revalidateLeavePeriods(req.session.userId);
    }
    if (microDegrees !== undefined) await setStudentMicroDegrees(req.session.userId, microDegrees);

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
