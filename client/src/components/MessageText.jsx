import React from 'react';
import { parseBlocks } from '../utils/messageMarkdown.js';

/**
 * 챗봇 답변의 간단한 마크다운(제목 #, 목록 -, 구분선 ---, 굵게 **, 표 |...|)을 화면용 요소로 바꾼다.
 * 외부 라이브러리 없이 React 요소로만 만들어 HTML을 직접 주입하지 않는다(XSS 안전).
 * 지원하지 않는 문법은 글자 그대로 둔다.
 */
function renderInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
    ),
  );
}

function MessageText({ text }) {
  return (
    <div className="message-text md">
      {parseBlocks(text).map((b, i) => {
        if (b.type === 'heading') return <p key={i} className="md-heading">{renderInline(b.text, i)}</p>;
        if (b.type === 'rule') return <hr key={i} className="md-rule" />;
        if (b.type === 'table') {
          // 휴대폰에서 넘치지 않게 표만 가로로 스크롤한다. 칸 수는 머리 줄 기준(모자란 칸은 빈칸).
          return (
            <div key={i} className="md-table-wrap">
              <table className="md-table">
                <thead>
                  <tr>{b.header.map((h, j) => <th key={j}>{renderInline(h, `${i}-h-${j}`)}</th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>{b.header.map((_, c) => <td key={c}>{renderInline(row[c] ?? '', `${i}-${r}-${c}`)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'list') {
          return (
            <ul key={i} className="md-list">
              {b.items.map((item, j) => <li key={j}>{renderInline(item, `${i}-${j}`)}</li>)}
            </ul>
          );
        }
        return <p key={i} className="md-p">{renderInline(b.text, i)}</p>;
      })}
    </div>
  );
}

export default MessageText;
