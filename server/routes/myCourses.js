const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const courseService = require('../services/courseService');
const { parseCourseListPdf } = require('../services/pdfImportService');

// 메모리 저장만(디스크에 남기지 않음) — 이수과목확인리스트 PDF는 학사정보라 파싱 즉시 버린다.
// mimetype만 보면 모바일에서 자주 실패한다 — 카카오톡으로 받은 파일이나 일부 앱 공유
// 경로를 거치면 브라우저가 "application/octet-stream" 등으로 잘못 보고하는 경우가 흔해서,
// 확장자(.pdf)도 같이 인정한다. 실제 PDF가 아니면 뒤에서 pdf-parse가 파싱 에러로 걸러낸다.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdfMimeType = file.mimetype === 'application/pdf';
    const isPdfExtension = /\.pdf$/i.test(file.originalname || '');
    cb(null, isPdfMimeType || isPdfExtension);
  },
});

/**
 * Routes for my registered courses (/api/my-courses)
 * 근거: 위키 API-설계 3.2, 3.3, 3.4 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

router.use(requireAuth);

// GET /api/my-courses/semesters
// 성적 입력 여부와 무관하게 수강 기록이 있는 학기 전부 반환 (화면의 학기 탭 목록용).
router.get('/semesters', async (req, res, next) => {
  try {
    const data = await courseService.listSemesters(req.session.userId);
    res.status(200).json({ status: 200, code: 'SEMESTERS_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/my-courses/timetable?year=&semester=
router.get('/timetable', async (req, res, next) => {
  try {
    const { year, semester } = req.query;
    if (!year) return res.status(400).json({ status: 400, code: 'REQUIRED_YEAR', message: null, data: null });
    if (!semester) return res.status(400).json({ status: 400, code: 'REQUIRED_SEMESTER', message: null, data: null });

    const data = await courseService.getTimetable(req.session.userId, { year, semester });
    res.status(200).json({ status: 200, code: 'TIMETABLE_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/my-courses/summary
router.get('/summary', async (req, res, next) => {
  try {
    const data = await courseService.getSummary(req.session.userId);
    res.status(200).json({ status: 200, code: 'GRADE_SUMMARY_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/my-courses?year=&semester=
router.get('/', async (req, res, next) => {
  try {
    const { year, semester } = req.query;
    const data = await courseService.listMyCourses(req.session.userId, { year, semester });
    res.status(200).json({ status: 200, code: 'MY_COURSES_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

const VALID_DAYS = ['월', '화', '수', '목', '금'];

// POST /api/my-courses
// 전공: { courseId, year, semester, schedule? } - 카탈로그에서 검색·선택
//   (카탈로그 과목에 이미 확정된 시간표가 있으면 schedule은 무시되고 그 시간표를 그대로
//    쓴다. 저학년 필수과목처럼 시간표 없이 이름만 등록된 카탈로그 과목은 직접입력과
//    동일하게 schedule을 받아준다 — courseService.addMyCourse 참고.)
// 교양/카탈로그에 없는 과목: { name, credits, category, year, semester, schedule? } - 직접 입력
// schedule([{day,period}])은 선택 입력 — 과거 학기처럼 시간을 몰라도 등록 가능해야 하므로 필수 아님.
router.post('/', async (req, res, next) => {
  try {
    const { courseId, name, credits, category, year, semester, schedule } = req.body;

    if (!year) return res.status(400).json({ status: 400, code: 'REQUIRED_YEAR', message: null, data: null });
    if (!semester) return res.status(400).json({ status: 400, code: 'REQUIRED_SEMESTER', message: null, data: null });

    if (courseId) {
      const course = await courseService.findCourseById(courseId);
      if (!course) {
        return res.status(404).json({ status: 404, code: 'COURSE_NOT_FOUND', message: null, data: null });
      }
    } else {
      if (!name) return res.status(400).json({ status: 400, code: 'REQUIRED_NAME', message: null, data: null });
      if (!credits) return res.status(400).json({ status: 400, code: 'REQUIRED_CREDITS', message: null, data: null });
      if (!category) return res.status(400).json({ status: 400, code: 'REQUIRED_CATEGORY', message: null, data: null });
      if (!courseService.VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ status: 400, code: 'INVALID_CATEGORY', message: null, data: null });
      }
    }

    if (schedule !== undefined) {
      const isValid =
        Array.isArray(schedule) &&
        schedule.every((s) => VALID_DAYS.includes(s.day) && Number.isInteger(s.period) && s.period > 0);
      if (!isValid) {
        return res.status(400).json({ status: 400, code: 'INVALID_SCHEDULE', message: null, data: null });
      }
      const seenSlots = new Set();
      for (const s of schedule) {
        const key = `${s.day}-${s.period}`;
        if (seenSlots.has(key)) {
          return res.status(400).json({ status: 400, code: 'DUPLICATE_SCHEDULE_SLOT', message: null, data: null });
        }
        seenSlots.add(key);
      }
    }

    const id = await courseService.addMyCourse(req.session.userId, {
      courseId,
      name,
      credits,
      category,
      year,
      semester,
      schedule,
    });
    return res.status(201).json({ status: 201, code: 'MY_COURSE_ADD_SUCCESS', message: null, data: { id } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 409, code: 'COURSE_ALREADY_ADDED', message: null, data: null });
    }
    if (err.code === 'SCHEDULE_CONFLICT') {
      return res.status(409).json({
        status: 409,
        code: 'SCHEDULE_CONFLICT',
        message: null,
        data: { day: err.conflictDay, period: err.conflictPeriod, conflictCourseName: err.conflictCourseName },
      });
    }
    next(err);
  }
});

// POST /api/my-courses/import/pdf
// 이수과목확인리스트 PDF를 업로드 → 과목명/학점/이수구분/이수학기만 파싱해 미리보기로 반환.
// 저장은 하지 않음 — 사용자가 검토·수정 후 /import/confirm으로 확정해야 DB에 반영된다.
router.post('/import/pdf', pdfUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_PDF_FILE', message: null, data: null });
    }

    const result = await parseCourseListPdf(req.file.buffer);
    return res.status(200).json({ status: 200, code: 'PDF_IMPORT_PARSE_SUCCESS', message: null, data: result });
  } catch (err) {
    return res.status(422).json({ status: 422, code: 'PDF_PARSE_FAILED', message: err.message, data: null });
  }
});

// POST /api/my-courses/import/confirm
// body: { rows: [{ name, credits, category, year, semester }] } — /import/pdf 결과를
// 사용자가 검토·수정한 뒤 그대로(또는 일부만) 보내면 일괄 등록. 등급 필드는 받지 않음
// (성적은 항상 과목 관리 화면에서 직접 입력).
router.post('/import/confirm', async (req, res, next) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_ROWS', message: null, data: null });
    }

    for (const row of rows) {
      if (!row.name || !row.credits || !row.category || !row.year || !row.semester) {
        return res.status(400).json({ status: 400, code: 'INVALID_ROW', message: null, data: null });
      }
      if (!courseService.VALID_CATEGORIES.includes(row.category)) {
        return res.status(400).json({ status: 400, code: 'INVALID_CATEGORY', message: null, data: null });
      }
    }

    const result = await courseService.bulkAddMyCourses(req.session.userId, rows);
    return res.status(201).json({ status: 201, code: 'PDF_IMPORT_CONFIRM_SUCCESS', message: null, data: result });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/my-courses/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { letterGrade } = req.body;
    // null은 "성적 미입력으로 되돌리기"라는 유효한 값이다 — undefined(필드 자체를 안 보냄)와
    // 구분해야 하는데, `null in GRADE_POINT_MAP`이 항상 false라 이걸 걸러내지 못하고
    // "성적 저장 실패"로 잘못 막고 있었다(실사용 확인).
    if (letterGrade !== undefined && letterGrade !== null && !(letterGrade in courseService.GRADE_POINT_MAP)) {
      return res.status(400).json({ status: 400, code: 'INVALID_LETTER_GRADE', message: null, data: null });
    }

    const existing = await courseService.findMyCourseById(req.session.userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ status: 404, code: 'MY_COURSE_NOT_FOUND', message: null, data: null });
    }

    await courseService.updateMyCourse(req.params.id, req.body);

    return res.status(200).json({
      status: 200,
      code: 'MY_COURSE_UPDATE_SUCCESS',
      message: null,
      data: { id: Number(req.params.id) },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/my-courses/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await courseService.findMyCourseById(req.session.userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ status: 404, code: 'MY_COURSE_NOT_FOUND', message: null, data: null });
    }

    await courseService.deleteMyCourse(req.params.id);
    return res.status(200).json({ status: 200, code: 'MY_COURSE_DELETE_SUCCESS', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
