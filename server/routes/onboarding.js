const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const studentService = require('../services/studentService');

/**
 * Routes for Onboarding (/api/onboarding)
 * 근거: 위키 API-설계 1.3 - https://github.com/wku-ai-chat/web/wiki/API-설계
 */

const { VALID_ENROLLMENT_TYPES, VALID_MAJOR_CHANGE_GRADES, VALID_MAJOR_CHANGE_SEMESTERS } = studentService;

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
    const { departmentId, admissionYear, enrollmentType, trackId, majorChangeGrade, majorChangeYear, majorChangeSemester } = req.body;

    if (!departmentId) return res.status(400).json({ status: 400, code: 'REQUIRED_DEPARTMENT_ID', message: null, data: null });
    if (!admissionYear) return res.status(400).json({ status: 400, code: 'REQUIRED_ADMISSION_YEAR', message: null, data: null });
    if (!enrollmentType) return res.status(400).json({ status: 400, code: 'REQUIRED_ENROLLMENT_TYPE', message: null, data: null });
    if (!VALID_ENROLLMENT_TYPES.includes(enrollmentType)) {
      return res.status(400).json({ status: 400, code: 'INVALID_ENROLLMENT_TYPE', message: null, data: null });
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
      departmentId, admissionYear, enrollmentType, trackId, majorChangeGrade, majorChangeYear, majorChangeSemester,
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
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
