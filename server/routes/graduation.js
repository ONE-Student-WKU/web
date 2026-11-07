// 졸업요건 진단 라우터 파일
//   - 학생의 졸업 현황을 돌려준다
//   - 바뀐 자료 알림을 확인 처리한다

// 설치된 express를 가져와 express라는 이름으로 저장한다
const express = require('express');

// express의 Router 기능을 호출해 이 파일 전용 빈 라우터를 만들어 router라는 이름으로 저장한다
// 아래의 use, get, post가 이 라우터를 채운다
const router = express.Router();

// auth.js가 공개한 것 중 requireAuth 함수만 꺼내 똑같은 이름으로 저장한다
const { requireAuth } = require('../middleware/auth');

// graduationService.js가 공개한 것 전부를 graduationService라는 이름으로 저장한다
// 점으로 꺼내 쓴다
const graduationService = require('../services/graduationService');

// graduationService와 같은 구조
const changeNoticeService = require('../services/changeNoticeService');

// 이 파일의 모든 주소는 로그인 확인을 먼저 거친다
//   - 세션에 사용자 ID가 있으면: 다음 줄로 넘어간다
//   - 없으면: 401로 응답하고 끝난다
// 괄호가 없으므로 지금 실행하는 게 아니라 요청이 올 때마다 실행하도록 등록한다
router.use(requireAuth);

// 졸업 현황 조회 함수
//   - 처리하는 요청: GET + /api/graduation/status
//   - 서비스에서 받은 졸업 현황에 바뀐 자료 알림을 붙여 보낸다
router.get('/status', async (req, res, next) => {
  try {

    // 사용자 ID를 서비스에 넘겨 졸업 현황을 받고, 기다렸다가 data에 저장한다
    const data = await graduationService.getGraduationStatus(req.session.userId);

    // 지난번 졸업 현황 요약과 이번 결과를 비교해 data.changeNotice에 넣는다
    //   - 달라졌으면: 알림 객체
    //   - 같거나 처음이면: null
    //   - 비교에 실패하면: .catch가 로그를 찍고 null
    // .catch의 return은 함수를 끝내지 않고 결과 자리에 null을 넣는다
    // 그래서 비교가 실패해도 졸업 현황은 그대로 보낸다
    data.changeNotice = await changeNoticeService.observe(req.session.userId, data).catch((err) => {
      console.error('[changeNotice] 비교 실패:', err.message);
      return null;
    });

    // 200번과 함께 졸업 현황을 json으로 보낸다
    // code는 응답에 다는 이름표다
    res.status(200).json({ status: 200, code: 'GRADUATION_STATUS_SUCCESS', message: null, data });
  } catch (err) {

    // 학생 정보나 학과가 아직 없어서 서비스가 던진 에러면 400으로 직접 응답하고 끝낸다
    if (err.code === 'ONBOARDING_REQUIRED') {
      return res.status(400).json({ status: 400, code: 'ONBOARDING_REQUIRED', message: null, data: null });
    }

    // 그 외 에러는 응답하지 않고 app.js의 공통 에러 처리기로 넘긴다
    // 500 응답은 공통 에러 처리기가 만든다
    next(err);
  }
});

// 알림 확인 처리 함수
//   - 처리하는 요청: POST + /api/graduation/change-notice/acknowledge
//   - 알림을 확인하면 지금 졸업 현황이 다음 비교의 기준이 된다
router.post('/change-notice/acknowledge', async (req, res, next) => {
  try {

    // 사용자 ID를 넘겨 알림을 확인 처리하고, 결과를 acknowledged에 저장한다
    //   - true: 알림이 떠 있던 학생. 지금 졸업 현황을 새 기준으로 DB에 저장한다
    //   - false: 확인할 알림이 원래 없던 학생. DB에 저장하지 않는다
    const acknowledged = await changeNoticeService.acknowledge(req.session.userId);

    // true와 false 둘 다 정상 결과라 200번을 보낸다
    res.status(200).json({ status: 200, code: 'CHANGE_NOTICE_ACKNOWLEDGED', message: null, data: { acknowledged } });
  } catch (err) {

    // 이 요청의 목적이 확인 처리라서 실패를 삼키지 않고 공통 에러 처리기로 넘긴다
    next(err);
  }
});

// 다른 파일에서 쓸 수 있게 router를 내보낸다
// app.js가 받아서 /api/graduation에 연결한다
module.exports = router;
