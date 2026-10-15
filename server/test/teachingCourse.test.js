const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  canTakeTeachingCourse, validateTeachingAndTransferCredits, parseTeachingCourse, isTeacherCollegeDepartment,
} = require('../services/teachingCourse');

/**
 * server/test/teachingCourse.test.js
 * 교직과정 이수 여부·편입 인정학점 입력 규칙(2026 책자 Ⅳ장 교직과정 이수 안내, DECISIONS D-67). DB 없이 돈다.
 */

test('편입생·3학년 이상 전과생은 교직과정을 이수할 수 없고, 일반 재학생·1·2학년 전과생은 할 수 있다', () => {
  assert.equal(canTakeTeachingCourse({ enrollmentType: 'GENERAL' }), true);
  assert.equal(canTakeTeachingCourse({ enrollmentType: 'TRANSFER_ADMISSION' }), false);
  assert.equal(canTakeTeachingCourse({ enrollmentType: 'MAJOR_CHANGE', majorChangeGrade: 2 }), true);
  assert.equal(canTakeTeachingCourse({ enrollmentType: 'MAJOR_CHANGE', majorChangeGrade: 3 }), false);
  assert.equal(canTakeTeachingCourse({ enrollmentType: 'MAJOR_CHANGE', majorChangeGrade: 4 }), false);
});

test('교직 여부는 true/false/null만, 이수할 수 없는 유형이 true·false를 보내면 거절한다', () => {
  const general = { enrollmentType: 'GENERAL' };
  assert.equal(validateTeachingAndTransferCredits({ teachingCourse: true }, general), null);
  assert.equal(validateTeachingAndTransferCredits({ teachingCourse: false }, general), null);
  assert.equal(validateTeachingAndTransferCredits({ teachingCourse: null }, general), null);
  assert.equal(validateTeachingAndTransferCredits({ teachingCourse: 1 }, general), 'INVALID_TEACHING_COURSE');
  assert.equal(validateTeachingAndTransferCredits({ teachingCourse: true }, { enrollmentType: 'TRANSFER_ADMISSION' }), 'TEACHING_COURSE_NOT_ALLOWED');
  assert.equal(validateTeachingAndTransferCredits({ teachingCourse: false }, { enrollmentType: 'MAJOR_CHANGE', majorChangeGrade: 3 }), 'TEACHING_COURSE_NOT_ALLOWED');
});

test('편입 인정학점은 편입생만, 0~160 정수만 받는다', () => {
  const transfer = { enrollmentType: 'TRANSFER_ADMISSION' };
  assert.equal(validateTeachingAndTransferCredits({ transferRecognizedCredits: 65 }, transfer), null);
  assert.equal(validateTeachingAndTransferCredits({ transferRecognizedCredits: null }, transfer), null);
  for (const bad of [-1, 161, 65.5, '65']) {
    assert.equal(validateTeachingAndTransferCredits({ transferRecognizedCredits: bad }, transfer), 'INVALID_TRANSFER_RECOGNIZED_CREDITS', String(bad));
  }
  assert.equal(validateTeachingAndTransferCredits({ transferRecognizedCredits: 65 }, { enrollmentType: 'GENERAL' }), 'INVALID_TRANSFER_RECOGNIZED_CREDITS');
});

test('DB 값 해석과 사범대학 학과 판정', () => {
  assert.equal(parseTeachingCourse(1), true);
  assert.equal(parseTeachingCourse(0), false);
  assert.equal(parseTeachingCourse(null), null);
  assert.equal(isTeacherCollegeDepartment('국어교육과'), true);
  assert.equal(isTeacherCollegeDepartment('교육학과'), true, '개편 전 학과지만 책자 교직 표의 사범대학 학과');
  assert.equal(isTeacherCollegeDepartment('국어국문학과'), false, '교직과정 설치 학과(선발)는 사범대학이 아니다');
});
