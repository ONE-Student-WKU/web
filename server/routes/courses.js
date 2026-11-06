// 개설 과목을 검색하는 라우터 파일: 연도와 학기, 검색어를 받아 과목 목록을 돌려준다

// express라는 외부 라이브러리를 가져와서 사용하기 위해 express라는 이름으로 상수에 저장한다
const express = require('express');

// express.Router()를 호출해 만든 빈 라우터를 router라는 이름으로 저장한다
const router = express.Router();

// 한 단계 위 폴더의 middleware 폴더에서 auth.js가 공개한 것 중 requireAuth 함수만 꺼내 똑같은 이름으로 저장한다
const { requireAuth } = require('../middleware/auth');

// 한 단계 위 폴더의 services 폴더에서 courseService.js가 공개한 것 전부를 courseService라는 상수에 저장한다
// 나중에 courseService.searchCatalog처럼 점으로 꺼내 사용한다
const courseService = require('../services/courseService');

// courseService와 같은 구조
const studentService = require('../services/studentService');

// 개설 과목 검색 함수: 메서드와 주소를 기반으로 GET + /api/courses/catalog 요청을 처리한다
// requireAuth를 router.use가 아니라 이 주소에만 넣었다. 파일 전체에 필요하면 router.use, 일부 주소에만 필요하면 주소마다 넣는다
// GET + /catalog로 오면 로그인을 먼저 확인하고, 통과하면 오른쪽 함수를 실행한다
router.get('/catalog', requireAuth, async (req, res, next) => {
  try {
    // 요청의 질의(req.query)를 풀어서 keyword, year, semester로 선언한다
    const { keyword, year, semester } = req.query;

    // 연도가 없으면 400번 응답코드와 함께 json을 보내고 끝낸다. 값이 맞는지는 여기서 보지 않는다
    if (!year) return res.status(400).json({ status: 400, code: 'REQUIRED_YEAR', message: null, data: null });

    // 학기(semester)가 없을 때도 같은 구조
    if (!semester) return res.status(400).json({ status: 400, code: 'REQUIRED_SEMESTER', message: null, data: null });

    // studentService에서 찾아보는 기능으로 로그인한 사용자 ID의 학생을 찾고, 기다렸다가 결과를 student에 저장한다
    // 학생이 없거나 조회에 실패하면 null이 들어가고 다음 줄로 계속 간다
    const student = await studentService.findById(req.session.userId).catch(() => null);

    // 학생의 소속 학과를 scope(범위)에 저장한다. 내 학과 과목을 검색 결과 앞에 두는 데 쓴다
    // student와 마찬가지로 학과 정보가 없거나 실패하면 null이고, 다음 줄로 계속 간다
    const scope = await courseService.catalogScopeFor(student).catch(() => null);

    // 검색 결과를 data에 저장한다. 위 둘과 달리 .catch가 없어서 실패하면 바로 아래 catch로 간다
    const data = await courseService.searchCatalog(keyword, year, semester, scope);

    // 검색 결과가 없어도 실패가 아니라서 빈 배열과 함께 200번을 보낸다
    res.status(200).json({ status: 200, code: 'CATALOG_SEARCH_SUCCESS', message: null, data });
  } catch (err) {
    // 에러가 나면 next(err)로 공통 에러 처리 함수로 보낸다
    next(err);
  }
});

// 다른 파일에서 접근할 수 있게 router를 내보낸다. app.js가 받아서 /api/courses에 연결한다
module.exports = router;
