const express = require('express');
const router = express.Router();
const communityService = require('../services/communityService');
const emailRelayService = require('../services/emailRelayService');

/**
 * server/routes/emailRelay.js
 * 커뮤니티 매칭 이메일 프록시(#182) 2단계 — Resend 인바운드 웹훅 수신.
 * 로그인 세션이 아니라 Resend 서버가 직접 호출하는 엔드포인트라 requireAuth를 안 걸고,
 * 대신 서명 검증(emailRelayService.verifyWebhook)으로 요청 출처를 확인한다.
 */

// POST /api/email-relay/inbound — app.js의 express.json({ verify })이 req.rawBody에
// 원문 바이트를 담아둔다(서명 검증은 파싱된 JSON이 아니라 원문 바이트 기준이라야 함).
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
      // 우리가 모르는(만료됐거나 애초에 존재한 적 없는) 프록시 주소 — 조용히 무시하고
      // Resend가 실패로 보고 재시도하지 않도록 200으로 응답한다.
      return res.status(200).json({ status: 200, code: 'PROXY_NOT_FOUND', message: null, data: null });
    }

    await emailRelayService.forwardToRecipient({
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
