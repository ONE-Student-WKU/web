const pool = require('../db');

/**
 * server/services/courseOrigin.js
 * 성적표 PDF로 가져온 과목이 어느 학과 과목인지(개설 학과) 찾는다(#253 설계안 1).
 * 개설과목에서 고른 과목은 course_id로 학과를 알지만, PDF·직접 입력 과목은 이름으로만 맞춰 왔다 — 전과 전 과목,
 * 다전공 배정 판정(courseCounting.js·priorMajorCourses.js·secondMajorCredits.js)이 이름이 같은 다른 학과 과목에 틀릴 수 있었다.
 *
 * 찾는 순서(먼저 하나로 정해지는 것을 쓴다. 여러 학과로 갈리면 비워 두고 판정은 지금처럼 이름으로 맞춘다):
 *  1) 전체성적조회의 학수번호 → 그 학기 개설과목(course_offerings)의 학과
 *  2) 학수번호 → 다른 학기 개설과목 중 가장 가까운 해의 학과
 *  3) 학수번호 → 교육과정(curriculum_courses)의 학과
 *  4) 이수과목확인리스트의 "개설학과(전공)" 글자 → 학과 이름, 없으면 세부전공 이름의 학과
 */

// 학수번호 모양 — 숫자·영문 대문자(예: 003308, L00316). 이상한 값은 버린다(AI가 다른 칸을 옮겨 적은 경우).
const COURSE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

function normalizeCourseCode(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const code = String(value).trim().toUpperCase();
  return COURSE_CODE_RE.test(code) ? code : null;
}

// 개설학과 글자 정리 — 길이를 묶고, 빈 값은 null.
function normalizeDepartmentText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= 100 ? text : null;
}

// 이름 비교용 — 띄어쓰기·가운뎃점·괄호를 지운다("컴퓨터·소프트웨어공학과" = "컴퓨터소프트웨어공학과").
function nameKey(value) {
  return String(value || '').replace(/[\s·ㆍ・.()（）\-_/]/g, '');
}

// "공학3계열(컴퓨터·소프트웨어공학전공)" → ["공학3계열(컴퓨터·소프트웨어공학전공)", "공학3계열", "컴퓨터·소프트웨어공학전공"]
function departmentCandidates(text) {
  const out = [text];
  const m = text.match(/^(.+?)[(（](.+?)[)）]$/);
  if (m) out.push(m[1].trim(), m[2].trim());
  return out;
}

function uniqueOrNull(ids) {
  const set = new Set(ids.map(Number));
  return set.size === 1 ? [...set][0] : null;
}

/**
 * 과목 여러 개의 개설 학과를 한 번에 찾는다. rows: [{ courseCode, offeringDepartment, year, semester }]
 * 반환: rows와 같은 순서의 학과 id 배열(못 찾으면 null).
 */
async function resolveOfferingDepartments(rows) {
  const codes = [...new Set(rows.map((r) => normalizeCourseCode(r.courseCode)).filter(Boolean))];
  const texts = rows.some((r) => normalizeDepartmentText(r.offeringDepartment));

  const offeringsByCode = new Map();
  const curriculumByCode = new Map();
  if (codes.length) {
    const [offerings] = await pool.query('SELECT course_code, year, semester, department_id FROM course_offerings WHERE course_code IN (?)', [codes]);
    for (const o of offerings) {
      const key = String(o.course_code).toUpperCase();
      if (!offeringsByCode.has(key)) offeringsByCode.set(key, []);
      offeringsByCode.get(key).push(o);
    }
    const [curriculum] = await pool.query('SELECT DISTINCT course_code, department_id FROM curriculum_courses WHERE course_code IN (?)', [codes]);
    for (const c of curriculum) {
      const key = String(c.course_code).toUpperCase();
      if (!curriculumByCode.has(key)) curriculumByCode.set(key, []);
      curriculumByCode.get(key).push(c.department_id);
    }
  }

  let departmentsByKey = null;
  let tracksByKey = null;
  if (texts) {
    const [departments] = await pool.query('SELECT id, name FROM departments');
    const [tracks] = await pool.query('SELECT department_id, name FROM tracks');
    departmentsByKey = new Map(departments.map((d) => [nameKey(d.name), d.id]));
    tracksByKey = new Map();
    for (const t of tracks) {
      const key = nameKey(t.name);
      if (!tracksByKey.has(key)) tracksByKey.set(key, []);
      tracksByKey.get(key).push(t.department_id);
    }
  }

  return rows.map((row) => {
    // 교양은 학과가 여는 과목이 아니다 — 학과 교육과정표에 교양 행이 실려 있어 그 학과로 잘못 잡히므로(실물 성적표 확인 2026-10-28) 찾지 않는다.
    // 판정(전과 전 과목·다전공·D-88)도 전공·일반선택만 개설 학과를 본다.
    if (String(row.category || '').startsWith('교양')) return null;
    const code = normalizeCourseCode(row.courseCode);
    if (code) {
      const offerings = offeringsByCode.get(code) || [];
      const sameTerm = uniqueOrNull(offerings.filter((o) => o.year === Number(row.year) && o.semester === Number(row.semester)).map((o) => o.department_id));
      if (sameTerm != null) return sameTerm;
      if (offerings.length) {
        // 다른 학기 개설과목 — 그 과목을 들은 해에 가장 가까운 해의 학과가 하나로 정해질 때만.
        const nearest = Math.min(...offerings.map((o) => Math.abs(o.year - Number(row.year))));
        const near = uniqueOrNull(offerings.filter((o) => Math.abs(o.year - Number(row.year)) === nearest).map((o) => o.department_id));
        if (near != null) return near;
      }
      const fromCurriculum = uniqueOrNull(curriculumByCode.get(code) || []);
      if (fromCurriculum != null) return fromCurriculum;
    }
    const text = normalizeDepartmentText(row.offeringDepartment);
    if (text && departmentsByKey) {
      const candidates = departmentCandidates(text);
      for (const candidate of candidates) {
        const id = departmentsByKey.get(nameKey(candidate));
        if (id != null) return id;
      }
      for (const candidate of candidates) {
        const id = uniqueOrNull(tracksByKey.get(nameKey(candidate)) || []);
        if (id != null) return id;
      }
    }
    return null;
  });
}

module.exports = { normalizeCourseCode, normalizeDepartmentText, nameKey, departmentCandidates, resolveOfferingDepartments };
