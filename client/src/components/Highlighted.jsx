import React from 'react';
import { splitByMatch } from '../utils/departmentTree.js';

// 검색어와 일치한 글자를 칠한다(검색 결과에서만 — 목록에서는 query가 비어 그대로). 학과 검색과 마이크로디그리 검색이 같이 쓴다.
function Highlighted({ text, query }) {
  if (!query) return text;
  return splitByMatch(text, query).map((part, i) =>
    part.hit ? (
      <mark key={i} className="search-hit">
        {part.text}
      </mark>
    ) : (
      <React.Fragment key={i}>{part.text}</React.Fragment>
    )
  );
}

export default Highlighted;
