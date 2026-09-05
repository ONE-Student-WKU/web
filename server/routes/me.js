const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const studentService = require('../services/studentService');

const BCRYPT_ROUNDS = 10;

/**
 * Routes for the current logged-in student (/api/me)
 * 근거: 위키 API-설계 2.1, 2.2 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

const { VALID_ENROLLMENT_TYPES, VALID_MAJOR_CHANGE_GRADES, VALID_MAJOR_CHANGE_SEMESTERS, serializeStudent } = studentService;

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
      majorChangeGrade, majorChangeYear, majorChangeSemester,
      secondDepartmentId, careerCounselingCount, leaveSemesters,
    } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_NAME', message: null, data: null });
    }

    if (enrollmentType !== undefined && !VALID_ENROLLMENT_TYPES.includes(enrollmentType)) {
      return res.status(400).json({ status: 400, code: 'INVALID_ENROLLMENT_TYPE', message: null, data: null });
    }

    if (leaveSemesters !== undefined && (!Number.isInteger(Number(leaveSemesters)) || Number(leaveSemesters) < 0)) {
      return res.status(400).json({ status: 400, code: 'INVALID_LEAVE_SEMESTERS', message: null, data: null });
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
      secondDepartmentId,
      careerCounselingCount,
      leaveSemesters,
    });

    const updated = await studentService.findById(req.session.userId);
    return res.status(200).json({ status: 200, code: 'ME_UPDATE_SUCCESS', message: null, data: serializeStudent(updated) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/me/password
router.patch('/me/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_CURRENT_PASSWORD', message: null, data: null });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ status: 400, code: 'INVALID_NEW_PASSWORD', message: null, data: null });
    }

    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }

    const matches = await bcrypt.compare(currentPassword, student.password);
    if (!matches) {
      return res.status(401).json({ status: 401, code: 'INVALID_CURRENT_PASSWORD', message: null, data: null });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await studentService.updatePassword(req.session.userId, passwordHash);

    return res.status(200).json({ status: 200, code: 'PASSWORD_UPDATE_SUCCESS', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/me — 비밀번호 재확인 후 계정 완전 삭제(하드 삭제). 수강 이력/대화 기록은
// students FK의 ON DELETE CASCADE로 함께 지워진다(db/schema.sql).
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_PASSWORD', message: null, data: null });
    }

    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }

    const matches = await bcrypt.compare(password, student.password);
    if (!matches) {
      return res.status(401).json({ status: 401, code: 'INVALID_PASSWORD', message: null, data: null });
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
