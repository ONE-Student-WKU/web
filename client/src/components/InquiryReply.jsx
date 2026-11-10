import React from 'react';
import MessageText from './MessageText.jsx';

/**
 * 운영팀이 쓴 문의 답변을 학생에게 보여 주는 본문. 챗봇 답변과 같은 간단한 마크다운(제목 #, 목록 -, 굵게 **, 구분선, 표)을 그리고,
 * 빈 줄은 문단 간격으로 남긴다. HTML은 넣지 않는다(MessageText). 학생 "내 문의", 정지 화면의 이의 답변, 관리자 미리보기가 같이 쓴다 —
 * 관리자가 미리보기에서 본 모양이 학생 화면과 같아야 해서 한곳에 둔다.
 */
function InquiryReply({ text }) {
  return (
    <div className="inquiry-reply">
      <MessageText text={text} keepBlankLines />
    </div>
  );
}

export default InquiryReply;
