const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const courseOrigin = require('../services/courseOrigin');
const courseService = require('../services/courseService');

/**
 * server/test/courseOrigin.test.js
 * 성적표 PDF 과목의 학수번호·개설 학과(#253 설계안 1):
 *  - 학수번호 → 그 학기 개설과목 → 가까운 해의 개설과목 → 교육과정 순으로 학과를 찾고, 여러 학과로 갈리면 비워 둔다
 *  - 학수번호가 없는 이수과목확인리스트는 "개설학과(전공)" 글자로 학과·세부전공 이름을 맞춘다(띄어쓰기·가운뎃점 무시)
 *  - 저장할 때 새 과목에 넣고, PDF를 다시 올리면 예전에 가져온 과목에도 채운다(개설과목에서 고른 과목은 두지 않는다)
 * DB는 mock이다.
 */

let data;
let queries;

beforeEach(() => {
  queries = [];
  data = {
    offerings: [],
    curriculum: [],
    departments: [
      { id: 1, name: '컴퓨터·소프트웨어공학과' },
      { id: 2, name: '공학3계열' },
      { id: 3, name: '경영학부' },
    ],
    tracks: [{ department_id: 2, name: '컴퓨터·소프트웨어공학전공' }],
    existing: [],
  };
  mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM course_offerings')) return [data.offerings.filter((o) => params[0].includes(o.course_code))];
    if (sql.includes('FROM curriculum_courses')) return [data.curriculum.filter((c) => params[0].includes(c.course_code))];
    if (sql.includes('FROM departments')) return [data.departments];
    if (sql.includes('FROM tracks')) return [data.tracks];
    if (sql.startsWith('SELECT id, course_id, name')) return [data.existing];
    if (sql.startsWith('INSERT')) return [{ insertId: 100 + queries.length }];
    return [{ affectedRows: 1 }];
  });
});

afterEach(() => mock.restoreAll());

describe('학수번호·개설학과 글자 정리', () => {
  test('학수번호 모양이 아니면 버리고, 영문은 대문자로', () => {
    assert.equal(courseOrigin.normalizeCourseCode(' l00316 '), 'L00316');
    assert.equal(courseOrigin.normalizeCourseCode('003308'), '003308');
    assert.equal(courseOrigin.normalizeCourseCode('가상과목'), null);
    assert.equal(courseOrigin.normalizeCourseCode(''), null);
  });

  test('학과(세부전공) 글자는 학과와 괄호 속 세부전공으로도 나눠 본다', () => {
    assert.deepEqual(courseOrigin.departmentCandidates('공학3계열(컴퓨터·소프트웨어공학전공)'), [
      '공학3계열(컴퓨터·소프트웨어공학전공)',
      '공학3계열',
      '컴퓨터·소프트웨어공학전공',
    ]);
    assert.equal(courseOrigin.nameKey('컴퓨터 · 소프트웨어공학과'), courseOrigin.nameKey('컴퓨터소프트웨어공학과'));
  });
});

describe('개설 학과 찾기', () => {
  test('학수번호: 그 학기 개설과목의 학과가 먼저', async () => {
    data.offerings = [
      { course_code: '900001', year: 2024, semester: 1, department_id: 1 },
      { course_code: '900001', year: 2025, semester: 1, department_id: 2 },
    ];
    assert.deepEqual(await courseOrigin.resolveOfferingDepartments([{ courseCode: '900001', year: 2024, semester: 1 }]), [1]);
  });

  test('그 학기가 없으면 가장 가까운 해, 그것도 갈리면 교육과정, 그래도 갈리면 비운다', async () => {
    data.offerings = [
      { course_code: '900001', year: 2026, semester: 1, department_id: 2 },
      { course_code: '900002', year: 2025, semester: 1, department_id: 1 },
      { course_code: '900002', year: 2025, semester: 3, department_id: 2 },
    ];
    data.curriculum = [
      { course_code: '900003', department_id: 3 },
      { course_code: '900004', department_id: 1 },
      { course_code: '900004', department_id: 3 },
    ];
    const ids = await courseOrigin.resolveOfferingDepartments([
      { courseCode: '900001', year: 2022, semester: 1 },
      { courseCode: '900002', year: 2022, semester: 1 },
      { courseCode: '900003', year: 2022, semester: 1 },
      { courseCode: '900004', year: 2022, semester: 1 },
    ]);
    assert.deepEqual(ids, [2, null, 3, null]);
  });

  test('이수과목확인리스트: 개설학과 글자로 학과, 없으면 세부전공의 학과', async () => {
    const ids = await courseOrigin.resolveOfferingDepartments([
      { offeringDepartment: '컴퓨터소프트웨어공학과', year: 2023, semester: 1 },
      { offeringDepartment: '공학3계열(컴퓨터·소프트웨어공학전공)', year: 2024, semester: 1 },
      { offeringDepartment: '컴퓨터·소프트웨어공학전공', year: 2024, semester: 1 },
      { offeringDepartment: '인문학적 사고와 표현', year: 2024, semester: 1 },
    ]);
    assert.deepEqual(ids, [1, 2, 2, null]);
  });

  test('교양 과목은 학과 교육과정표에 실려 있어도 개설 학과를 찾지 않는다', async () => {
    data.curriculum = [{ course_code: '001111', department_id: 1 }];
    const ids = await courseOrigin.resolveOfferingDepartments([
      { courseCode: '001111', category: '교양필수', year: 2022, semester: 1 },
      { courseCode: '001111', category: '일반선택', year: 2022, semester: 1 },
    ]);
    assert.deepEqual(ids, [null, 1]);
  });

  test('학수번호도 글자도 없으면 DB를 부르지 않고 비운다', async () => {
    assert.deepEqual(await courseOrigin.resolveOfferingDepartments([{ year: 2024, semester: 1 }]), [null]);
    assert.equal(queries.length, 0);
  });
});

describe('가져온 과목 저장', () => {
  const row = (over) => ({ name: '가상전공과목A', credits: 3, category: '전공선택', year: 2024, semester: 1, letterGrade: 'A0', ...over });

  test('새 과목에 학수번호와 찾은 개설 학과를 넣는다', async () => {
    data.offerings = [{ course_code: '900001', year: 2024, semester: 1, department_id: 1 }];
    await courseService.bulkAddMyCourses(7, [row({ courseCode: '900001' })]);
    const insert = queries.find((q) => q.sql.startsWith('INSERT INTO student_courses'));
    assert.deepEqual(insert.params.slice(-2), ['900001', 1]);
  });

  test('PDF를 다시 올리면 예전에 가져온 과목에도 채우고, 개설과목에서 고른 과목은 두지 않는다', async () => {
    data.offerings = [{ course_code: '900001', year: 2024, semester: 1, department_id: 1 }];
    data.existing = [
      { id: 5, course_id: null, name: '가상전공과목A', year: 2024, semester: 1, letter_grade: 'A0', course_code: null, offering_department_id: null },
      { id: 6, course_id: 44, name: '가상전공과목B', year: 2024, semester: 1, letter_grade: 'A0', course_code: null, offering_department_id: null },
    ];
    await courseService.bulkAddMyCourses(7, [row({ courseCode: '900001' }), row({ name: '가상전공과목B', courseCode: '900001' })]);
    const updates = queries.filter((q) => q.sql.startsWith('UPDATE student_courses SET course_code'));
    assert.deepEqual(updates.map((q) => q.params), [['900001', 1, 5]]);
  });
});
