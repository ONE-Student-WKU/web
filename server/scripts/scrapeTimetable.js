const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

/**
 * server/scripts/scrapeTimetable.js
 * 원광대 공개 "전공시간표 조회"(intra.wku.ac.kr, 로그인 불요, 학사지원과 확인됨)에서
 * 컴퓨터·소프트웨어공학과(구, 2017~)/공학3계열(신, 2026~)의 연도·학기별 실제 개설 정보를
 * 긁어 db/curriculum/_source/전공시간표_2017-2026.json으로 저장한다.
 *
 * course_offerings(server/scripts/seedCourseOfferings.js)의 원본 데이터 — 매 학기 수강신청이
 * 끝나고 시간표가 확정되면 이 스크립트를 다시 돌려 원본을 갱신하고, seedCourseOfferings.js로
 * DB에 반영하면 된다. 서버 부하 방지를 위해 요청 사이 400ms 딜레이를 둔다.
 */

const BASE_URL = 'https://intra.wku.ac.kr/SWupis/V005/Service/Stud/Capab/timeTableByDept.jsp';
const OUT_FILE = path.resolve(__dirname, '..', '..', 'db', 'curriculum', '_source', '전공시간표_2017-2026.json');

const CURRENT_YEAR = new Date().getFullYear();

const TARGETS = [
  // 구 컴퓨터·소프트웨어공학과 (창의공과대학, college=1961/codeRegiment=1979) — 2025학번까지만
  // 신입생을 받았지만 재학생이 남아있는 한 계속 강좌가 개설된다(2026년도 확인됨).
  ...Array.from({ length: CURRENT_YEAR - 2017 + 1 }, (_, i) => 2017 + i).flatMap((year) =>
    [1, 2].map((term) => ({ year, term, college: 1961, codeRegiment: 1979, dept: '컴퓨터·소프트웨어공학과' }))
  ),
  // 신 공학3계열 (공과대학, college=55/codeRegiment=2634) — 2026학번부터 신설.
  ...Array.from({ length: CURRENT_YEAR - 2026 + 1 }, (_, i) => 2026 + i).flatMap((year) =>
    [1, 2].map((term) => ({ year, term, college: 55, codeRegiment: 2634, dept: '공학3계열' }))
  ),
];

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseRows(html) {
  const tableMatch = html.match(/<table class="table table-bordered">([\s\S]*?)<\/table>/);
  if (!tableMatch) return [];

  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const rows = [];
  let m;
  let first = true;
  while ((m = rowRe.exec(tableMatch[1]))) {
    if (first) {
      first = false; // 헤더 행 skip
      continue;
    }
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(m[1]))) cells.push(stripTags(cm[1]));
    if (cells.length < 10) continue;

    const [grade, category, courseCode, courseName, section, credits, time, professor, room, competency] = cells;
    if (!grade && !courseName) continue; // 빈 placeholder 행(데이터 없음) skip

    rows.push({ grade, category, courseCode, courseName, section, credits, time, professor, room, competency });
  }
  return rows;
}

async function fetchOne(target) {
  const url = `${BASE_URL}?year=${target.year}&term=${target.term}&college=${target.college}&codeRegiment=${target.codeRegiment}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // 이 JSP는 EUC-KR로 응답하는데 Content-Type 헤더에 charset이 없어서 fetch().text()가
  // UTF-8로 잘못 디코딩(mojibake)한다 — 바이트 그대로 받아 iconv-lite로 직접 디코딩.
  const buf = Buffer.from(await res.arrayBuffer());
  const html = iconv.decode(buf, 'euc-kr');
  return parseRows(html);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const all = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8')) : {};

  for (const target of TARGETS) {
    const key = `${target.dept}_${target.year}_${target.term}`;
    try {
      const rows = await fetchOne(target);
      all[key] = rows;
      console.log(`[OK] ${key}: ${rows.length}행`);
    } catch (err) {
      console.error(`[FAIL] ${key}: ${err.message}`);
    }
    await sleep(400); // 서버 부하 방지용 딜레이
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), 'utf-8');
  console.log(`\n완료. ${OUT_FILE}에 저장됨.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
