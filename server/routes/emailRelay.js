// 메일 중계 라우터 파일
//   - 매칭된 학생끼리 실제 이메일을 숨긴 채 메일을 주고받게 한다
//   - Resend가 받은 메일을 전달한다

const express = require('express');
const router = express.Router();
const communityService = require('../services/communityService');
const emailRelayService = require('../services/emailRelayService');

// 메일 도착 알림을 받는 함수
//   - 메일이 오면 Resend가 이 주소로 알려 주는 웹훅 요청이다
//   - 요청을 보내는 쪽이 학생이 아니라 Resend라서 로그인 확인이 없다
router.post('/inbound', async (req, res, next) => {
  try {

    // 확인을 통과한 알림 내용을 담을 변수
    // 아래에서도 쓰므로 try 바깥에 선언한다
    let event;
    try {

      // 웹훅 요청이 진짜 Resend에서 왔는지 서명으로 확인한다
      //   - 넘기는 값: 요청의 바디(rawBody)와 헤더(headers)
      //   - 유효하면: 돌려받은 값을 event에 넣는다
      //   - 유효하지 않으면: 에러가 나서 아래 catch로 간다
      //
      // event에 담기는 값
      //   - 요청 바디를 객체로 바꾼 것이라 event.type, event.data.to처럼 꺼내 쓸 수 있다
      //   - 메일 내용이 아니라 메일이 도착했다는 알림이다
      //   - 실제 메일은 나중에 event.data.email_id로 가져온다
      event = emailRelayService.verifyWebhook(req.rawBody, req.headers);
    } catch {

      // 서명이 유효하지 않을 때 온다
      // 400으로 응답하고 끝내므로 메일을 중계하지 않는다
      return res.status(400).json({ status: 400, code: 'INVALID_SIGNATURE', message: null, data: null });
    }

    // 알림 종류가 메일 받음(email.received)인지 확인한다
    //   - 아니면: 200과 IGNORED를 Resend에 보내고 끝낸다
    //   - 맞으면: 이 if를 건너뛰고 바로 아래로 넘어간다
    // 잘못된 요청이 아니라 처리할 일이 없을 뿐이라 200이다
    if (event.type !== 'email.received') {
      return res.status(200).json({ status: 200, code: 'IGNORED', message: null, data: null });
    }

    const toAddress = event.data.to?.[0];
    const target = toAddress ? await communityService.findEmailRelayTarget(toAddress) : null;
    if (!target) {
      return res.status(200).json({ status: 200, code: 'PROXY_NOT_FOUND', message: null, data: null });
    }
    if (target.blocked) {
      return res.status(200).json({ status: 200, code: target.blocked, message: null, data: null });
    }

    await emailRelayService.relayInboundEmail({
      emailId: event.data.email_id,
      to: target.recipientEmail,
      from: target.senderProxyEmail,
    });

    res.status(200).json({ status: 200, code: 'RELAYED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
