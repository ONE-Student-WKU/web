const express = require('express');
const { MAJOR_CHANGE_CLOSED_DEPARTMENTS } = require('../services/regulationEngine/constants');
const { PREMED_DEPARTMENTS } = require('../services/regulationEngine/profileCaveats');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const studentService = require('../services/studentService');
const { isIntInRange, isValidAdmissionYear } = require('../services/inputValidation');
const { validateTeachingAndTransferCredits } = require('../services/teachingCourse');
const { validateMajorTrackType } = require('../services/majorTrackType');

/**
 * Routes for Onboarding (/api/onboarding)
 * 근거: 위키 API-설계 1.3 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

const { VALID_ENROLLMENT_TYPES, VALID_MAJOR_CHANGE_GRADES, VALID_MAJOR_CHANGE_SEMESTERS, VALID_TRANSFER_GRADES } = studentService;

// GET /api/onboarding/departments
router.get('/departments', async (req, res, next) => {
  try {
    const departments = await studentService.listDepartments();
    res.status(200).json({ status: 200, code: 'DEPARTMENTS_SUCCESS', message: null, data: departments });
  } catch (err) {
    next(err);
  }
});

// GET /api/onboarding/tracks?departmentId=
// 광역단위 학과(공학3계열)만 결과가 있고, 그 외 학과는 빈 배열 반환.
router.get('/tracks', async (req, res, next) => {
  try {
    const { departmentId } = req.query;
    if (!departmentId) return res.status(400).json({ status: 400, code: 'REQUIRED_DEPARTMENT_ID', message: null, data: null });

    const tracks = await studentService.listTracks(departmentId);
    res.status(200).json({ status: 200, code: 'TRACKS_SUCCESS', message: null, data: tracks });
  } catch (err) {
    next(err);
  }
});

// POST /api/onboarding
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      departmentId, admissionYear, enrollmentType, trackId, majorChangeGrade, majorChangeYear, majorChangeSemester, transferGrade,
      transferRecognizedCredits, teachingCourse, majorTrackType, majorChangeRecognition,
    } = req.body;

    if (!departmentId) return res.status(400).json({ status: 400, code: 'REQUIRED_DEPARTMENT_ID', message: null, data: null });
    if (!admissionYear) return res.status(400).json({ status: 400, code: 'REQUIRED_ADMISSION_YEAR', message: null, data: null });
    if (!enrollmentType) return res.status(400).json({ status: 400, code: 'REQUIRED_ENROLLMENT_TYPE', message: null, data: null });
    if (!VALID_ENROLLMENT_TYPES.includes(enrollmentType)) {
      return res.status(400).json({ status: 400, code: 'INVALID_ENROLLMENT_TYPE', message: null, data: null });
    }
    // 학과·학번은 졸업요건 진단의 기준이 되는 값이다. 타입/범위를 안 보면 없는 학과 id는 DB 오류(500)로, 엉뚱한 학번은 그대로 저장된다.
    const department = isIntInRange(departmentId, 1, 2147483647) ? await studentService.findDepartmentById(departmentId) : null;
    if (!department) {
      return res.status(400).json({ status: 400, code: 'INVALID_DEPARTMENT_ID', message: null, data: null });
    }
    if (!isValidAdmissionYear(admissionYear)) {
      return res.status(400).json({ status: 400, code: 'INVALID_ADMISSION_YEAR', message: null, data: null });
    }
    // 의·치·한의예(학)과·약학대학으로는 전과할 수 없다(학칙시행규칙 제111조 제4호).
    if (enrollmentType === 'MAJOR_CHANGE' && MAJOR_CHANGE_CLOSED_DEPARTMENTS.includes(department.name)) {
      return res.status(400).json({ status: 400, code: 'MAJOR_CHANGE_CLOSED_DEPARTMENT', message: null, data: null });
    }
    // 2년 과정인 예과에는 편입학이 없다(학칙 제36조).
    if (enrollmentType === 'TRANSFER_ADMISSION' && PREMED_DEPARTMENTS.includes(department.name)) {
      return res.status(400).json({ status: 400, code: 'TRANSFER_INTO_PREMED', message: null, data: null });
    }

    // majorChangeGrade/Year/Semester: 전과생(MAJOR_CHANGE)만 필수, 그 외 유형이면 애초에 의미가 없는 값이므로 거부.
    // 교양 이수기준이 "전과 학년"이 아니라 "전과 시점"(연도+학기, 2022-2학기 기준)으로 갈리므로
    // 셋 다 필요함 (db/regulations/전공선택/전과.md 참고).
    if (enrollmentType === 'MAJOR_CHANGE') {
      if (!majorChangeGrade) {
        return res.status(400).json({ status: 400, code: 'REQUIRED_MAJOR_CHANGE_GRADE', message: null, data: null });
      }
      if (!VALID_MAJOR_CHANGE_GRADES.includes(Number(majorChangeGrade))) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_GRADE', message: null, data: null });
      }
      if (!majorChangeYear) {
        return res.status(400).json({ status: 400, code: 'REQUIRED_MAJOR_CHANGE_YEAR', message: null, data: null });
      }
      if (!majorChangeSemester) {
        return res.status(400).json({ status: 400, code: 'REQUIRED_MAJOR_CHANGE_SEMESTER', message: null, data: null });
      }
      if (!VALID_MAJOR_CHANGE_SEMESTERS.includes(Number(majorChangeSemester))) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_SEMESTER', message: null, data: null });
      }
    } else {
      if (majorChangeRecognition !== undefined && majorChangeRecognition !== null) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_RECOGNITION', message: null, data: null });
      }
      if (majorChangeGrade !== undefined && majorChangeGrade !== null) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_GRADE', message: null, data: null });
      }
      if (majorChangeYear !== undefined && majorChangeYear !== null) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_YEAR', message: null, data: null });
      }
      if (majorChangeSemester !== undefined && majorChangeSemester !== null) {
        return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_SEMESTER', message: null, data: null });
      }
    }

    // 전과생 전공학점 인정 신청 여부(선택, true/false — D-77).
    if (majorChangeRecognition !== undefined && majorChangeRecognition !== null && typeof majorChangeRecognition !== 'boolean') {
      return res.status(400).json({ status: 400, code: 'INVALID_MAJOR_CHANGE_RECOGNITION', message: null, data: null });
    }

    // transferGrade: 편입생(TRANSFER_ADMISSION)만 필수. 이때 admissionYear는 "편입 연도 − 편입 학년 + 1"(편입한 학년의 당초 입학자 학번)이다
    // (교육과정 운영에 관한 규정 제14조③). 그 외 유형이면 의미 없는 값이라 거부한다.
    if (enrollmentType === 'TRANSFER_ADMISSION') {
      if (transferGrade === undefined || transferGrade === null) {
        return res.status(400).json({ status: 400, code: 'REQUIRED_TRANSFER_GRADE', message: null, data: null });
      }
      if (!VALID_TRANSFER_GRADES.includes(Number(transferGrade))) {
        return res.status(400).json({ status: 400, code: 'INVALID_TRANSFER_GRADE', message: null, data: null });
      }
    } else if (transferGrade !== undefined && transferGrade !== null) {
      return res.status(400).json({ status: 400, code: 'INVALID_TRANSFER_GRADE', message: null, data: null });
    }

    // 교직과정 이수 여부(편입생·3학년 이상 전과생은 이수 불가)와 편입 인정학점(편입생만). 둘 다 선택 항목이다.
    const extrasError = validateTeachingAndTransferCredits({ teachingCourse, transferRecognizedCredits }, { enrollmentType, majorChangeGrade });
    if (extrasError) return res.status(400).json({ status: 400, code: extrasError, message: null, data: null });
    // 광역 계열전공 이수유형(계열 학과의 2025학번 이후만, 선택 항목 — 아직 안 정했으면 UNDECIDED).
    const trackTypeError = validateMajorTrackType(majorTrackType, { departmentName: department.name, admissionYear });
    if (trackTypeError) return res.status(400).json({ status: 400, code: trackTypeError, message: null, data: null });

    // trackId: 광역단위 학과(공학3계열)에서만 선택 가능 — 선택한 학과 소속 트랙인지 검증.
    if (trackId !== undefined && trackId !== null) {
      const track = await studentService.findTrackById(trackId);
      if (!track || String(track.department_id) !== String(departmentId)) {
        return res.status(400).json({ status: 400, code: 'INVALID_TRACK_ID', message: null, data: null });
      }
    }

    const student = await studentService.findById(req.session.userId);
    if (student.onboarding_completed_at) {
      return res.status(409).json({ status: 409, code: 'ONBOARDING_ALREADY_COMPLETED', message: null, data: null });
    }

    await studentService.completeOnboarding(req.session.userId, {
      departmentId, admissionYear, enrollmentType, trackId, majorChangeGrade, majorChangeYear, majorChangeSemester, transferGrade,
      transferRecognizedCredits, teachingCourse, majorTrackType, majorChangeRecognition,
    });

    return res.status(200).json({
      status: 200,
      code: 'ONBOARDING_SUCCESS',
      message: null,
      data: {
        departmentId, admissionYear, enrollmentType, trackId: trackId ?? null,
        majorChangeGrade: majorChangeGrade ?? null,
        majorChangeYear: majorChangeYear ?? null,
        majorChangeSemester: majorChangeSemester ?? null,
        transferGrade: transferGrade ?? null,
        transferRecognizedCredits: transferRecognizedCredits ?? null,
        teachingCourse: teachingCourse ?? null,
        majorTrackType: majorTrackType ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
