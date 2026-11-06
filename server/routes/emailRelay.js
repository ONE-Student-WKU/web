// 메일 중계 라우터 파일: 매칭된 학생끼리 실제 이메일을 숨긴 채 메일을 주고받도록, Resend가 받은 메일을 전달한다

const express = require('express');
const router = express.Router();
const communityService = require('../services/communityService');
const emailRelayService = require('../services/emailRelayService');

router.post('/inbound', async (req, res, next) => {
  try {
    let event;
    try {
      event = emailRelayService.verifyWebhook(req.rawBody, req.headers);
    } catch {
      return res.status(400).json({ status: 400, code: 'INVALID_SIGNATURE', message: null, data: null });
    }

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
