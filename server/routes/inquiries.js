// 문의하기 라우터 파일
//   - 학생이 문의를 보낸다
//   - 자기가 쓴 문의를 볼 수 있다

// 외부 라이브러리 express를 사용하기 위한 상수 선언
const express = require('express');

// express 중 라우터 기능을 사용하여 빈 라우터를 만들고 router라는 이름으로 저장
const router = express.Router();

// auth.js에서 공개된 함수 중 requireAuth만 골라서 같은 이름으로 저장
const { requireAuth } = require('../middleware/auth');

// inquiryService.js가 공개한 것 전부를 가져와 inquiryService라는 이름으로 저장
const inquiryService = require('../services/inquiryService');

// requireAuth와 같은 구조
// adminAlertService.js에서 notifyAdmin만 골라서 저장
const { notifyAdmin } = require('../services/adminAlertService');

// inquiryService와 같은 구조
const moderationLabelService = require('../services/moderationLabelService');

// requireAuth와 같은 구조
// security.js에서 perUserLimiter만 골라서 저장
const { perUserLimiter } = require('../middleware/security');

// 졸업 라우터 파일과 같이 이 파일의 모든 주소는 로그인이 돼있는지 먼저 거친다
router.use(requireAuth);

// 제목 최대 글자 수를 50으로 지정
const TITLE_MAX_LENGTH = 50;

// 본문 최대 글자 수를 2000으로 지정
const CONTENT_MAX_LENGTH = 2000;

// 아래 셋을 모두 만족하면 true, 아니면 false를 반환한다
//   - 제목이 문자열이다
//   - 공백을 제거한 길이가 0보다 크다
//   - 공백을 제거한 길이가 최대 글자 수 이하다
function isValidTitle(title) {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= TITLE_MAX_LENGTH;
}

// isValidTitle의 본문 버전
function isValidContent(content) {
  return typeof content === 'string' && content.trim().length > 0 && content.trim().length <= CONTENT_MAX_LENGTH;
}

// 유저마다 1시간에 최대 20번으로 문의 요청을 제한하는 미들웨어를 만들어 inquiryWriteLimiter에 저장
const inquiryWriteLimiter = perUserLimiter({ windowMs: 60 * 60 * 1000, max: 20 });

// 문의 작성 함수
//   - 처리하는 요청: POST + /api/inquiries
//   - 방금 만든 미들웨어에 걸리는지 확인하고, 안 걸리면 실행한다
router.post('/', inquiryWriteLimiter, async (req, res, next) => {
  try {

    // 제목을 title에 넣는다(삼항 연산자)
    //   - 문자열이면: 공백을 제거해서 넣는다
    //   - 아니면: 그대로 넣는다
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : req.body.title;

    // 본문도 같은 구조
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : req.body.content;

    // 제목이 올바르지 않으면 400번 응답코드와 함께 json을 보낸다
    if (!isValidTitle(title)) {
      return res.status(400).json({ status: 400, code: 'INVALID_TITLE', message: null, data: null });
    }

    // 본문이 올바르지 않을 때도 같은 구조
    if (!isValidContent(content)) {
      return res.status(400).json({ status: 400, code: 'INVALID_CONTENT', message: null, data: null });
    }

    // 사용자 아이디, 제목, 본문을 넘겨 문의를 저장하고, DB가 만들어 준 문의 번호를 id에 저장한다
    // 이 요청의 목적이라 await로 기다린다
    const id = await inquiryService.createInquiry(req.session.userId, title, content);

    // 관리자에게 Discord로 새 문의 알림을 보낸다
    // 부가 기능이라 기다리지 않아서, 실패해도 문의 작성은 성공한다
    notifyAdmin('inquiry');

    // AI가 문의의 심각도를 뒤에서 분류해 저장한다
    // 이것도 부가 기능이라 기다리지 않는다
    moderationLabelService.scheduleLabel('inquiry', id);

    // 새로 만드는 데 성공했으니 201번과 함께 만든 문의 번호를 json으로 보낸다
    res.status(201).json({ status: 201, code: 'INQUIRY_CREATED', message: null, data: { id } });
  } catch (err) {

    // 이 과정 자체에서 오류가 있으면 공통 에러 함수로 내보낸다
    next(err);
  }
});

// 내 문의 보기 함수: GET + /api/inquiries/mine 요청을 처리한다
router.get('/mine', async (req, res, next) => {
  try {

    // 세션의 사용자 아이디를 넘겨 내 문의 목록을 조회하고, 결과를 inquiries에 담는다
    const inquiries = await inquiryService.listMyInquiries(req.session.userId);

    // 성공하면 200번과 함께 문의 목록을 json으로 보낸다
    res.status(200).json({ status: 200, code: 'MY_INQUIRIES_LIST', message: null, data: inquiries });
  } catch (err) {

    // 이 과정 자체가 실패하면 공통 에러 함수로 넘긴다
    next(err);
  }
});

// 이 파일에서 공개할 것을 넣어 두는 곳
// 여기서는 router 하나를 공개하고, app.js가 받아서 /api/inquiries에 연결한다
module.exports = router;
