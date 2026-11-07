// 기능 사용 횟수를 받는 라우터 파일
//   - 화면과 버튼이 하루에 몇 번 쓰였는지 받아서 저장한다
//   - 누가 썼는지는 저장하지 않고 기능별 합계만 남긴다

// express라는 외부 라이브러리를 가져와서 express라는 이름으로 저장한다
const express = require('express');

// express의 Router 기능으로 빈 라우터를 만들어 router라는 이름으로 저장한다
// 라우터 자체를 저장하는 게 아니라 새로 만든 라우터를 저장한다
const router = express.Router();

// auth.js가 공개한 것 중 requireAuth 함수만 꺼내 똑같은 이름으로 저장한다
const { requireAuth } = require('../middleware/auth');

// security.js가 공개한 것 중 perUserLimiter 함수만 꺼내 똑같은 이름으로 저장한다
const { perUserLimiter } = require('../middleware/security');

// uiEventService.js가 공개한 것 전부를 uiEventService라는 상수에 저장한다
const uiEventService = require('../services/uiEventService');

// 이 파일의 모든 주소는 로그인을 먼저 통과해야 사용할 수 있다
router.use(requireAuth);

// 한 사람당 요청을 1분에 최대 12번으로 제한하는 미들웨어를 만들어 uiEventLimiter라는 이름으로 저장한다
// 클릭 횟수가 아니라 요청 횟수 제한이다
// 화면이 클릭을 모아 15초마다 요청 하나로 보낸다
const uiEventLimiter = perUserLimiter({ windowMs: 60 * 1000, max: 12 });

// 기능 사용 횟수 저장 함수
//   - 처리하는 요청: POST + /api/ui-events 하나만
//   - '/'는 모든 주소가 아니라 이 라우터의 시작 주소다
//   - 방금 만든 요청 횟수 제한을 통과하면: 오른쪽 함수를 실행한다
//   - 넘으면: 429로 끝난다
router.post('/', uiEventLimiter, async (req, res, next) => {
  try {

    // 요청의 body를 그대로 기록하지 않는다
    //   - normalizeEvents: 규칙에 맞는 값만 골라낸다
    //   - recordEvents: 골라낸 값을 기록한다
    await uiEventService.recordEvents(uiEventService.normalizeEvents(req.body));

    // 204번 응답코드만 보내고 끝낸다
    // 돌려줄 내용이 없어서 json 대신 end를 쓴다
    res.status(204).end();
  } catch (err) {

    // 그 과정에서 실패하면 next(err)로 공통 에러 처리 함수로 보낸다
    next(err);
  }
});

// 다른 파일에서 접근할 수 있게 router를 내보낸다
// app.js가 받아서 /api/ui-events에 연결한다
module.exports = router;
