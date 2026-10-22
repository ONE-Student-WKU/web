const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { checkNicknamePolicy, nicknameKey } = require('../services/nicknamePolicy');
const studentService = require('../services/studentService');

/**
 * server/test/nicknamePolicy.test.js
 * 닉네임으로 다른 사람에게 혼선을 주는 것을 막는 규칙(2026-10-22 피드백). 규칙은 services/nicknamePolicy.js 한곳에 있다.
 * 마지막 두 테스트는 로컬 DB에 학생을 만들고 끝나면 지운다.
 */

const expectCode = (code, names) => {
  for (const name of names) assert.equal(checkNicknamePolicy(name), code, name);
};

test('평범한 닉네임은 쓸 수 있다(한글·영어·숫자·한자·가나, 공백·-·_·.)', () => {
  expectCode(null, ['홍길동', 'kim_99', 'Jane Doe', '알고리즘러버', '李明', 'たなか', 'k.m-lee', '공지영', 'ecosystem', '교양왕']);
});

test('운영진·서비스·학교 부서·교직원으로 보이는 닉네임은 일부만 들어가도 막는다(숫자·기호로 바꿔 쓴 것 포함)', () => {
  expectCode('RESERVED_NAME', [
    '관리자', '관리자1', '학과관리자', '운 영 자', '운영진_kim', 'adm1n', 'ADMIN', 'Admln', 'ａｄｍｉｎ', 'super-admin',
    '원스튜던트', 'ONE-Student', 'wku_kim', '원광대학생', '학사지원과', '교육혁신과', '김교수', '조교님', '총학생회', '과대표김', '학과사무실',
  ]);
});

test('화면 문구·자동 이름·학번처럼 보이는 닉네임은 막는다', () => {
  expectCode('RESERVED_NAME', ['user12', 'user 12', 'USER_12', 'us3r12', '유저12', '사용자7', '탈퇴한 사용자', '알 수 없음', '익명', '작성자', '나', 'ME', 'system', '시스템', '2022', '2022-1234']);
});

test('이메일·전화번호·링크처럼 보이는 닉네임은 막는다', () => {
  expectCode('NAME_CONTACT_INFO', ['kim@wku.ac.kr', 'www.naver.com', 'naver.com', 'kim01012345678', 'id.co']);
});

test('영어와 똑같이 생긴 다른 문자·보이지 않는 글자·기호·이모지는 쓸 수 없다', () => {
  expectCode('INVALID_NAME', ['Кim', 'Αdmin', 'a​dmin', 'kim‮', 'kim!', 'kim😀', '★kim']);
});

test('nicknameKey: 대소문자·공백·기호·비슷한 글자(I·l·1, O·0)만 다르면 같은 열쇠다', () => {
  assert.equal(nicknameKey('Ian'), nicknameKey('lan'));
  assert.equal(nicknameKey('kim01'), nicknameKey('KIMOl'));
  assert.equal(nicknameKey('홍 길동'), nicknameKey('홍길동.'));
  assert.equal(nicknameKey('ｋｉｍ'), nicknameKey('kim'));
  assert.notEqual(nicknameKey('홍길동'), nicknameKey('홍길순'));
});

let studentId;
let otherId;
const run = Date.now() % 100000;

before(async () => {
  const [a] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`nick-a-${run}@example.test`, `Ian${run}`]);
  const [b] = await pool.query('INSERT INTO students (email) VALUES (?)', [`nick-b-${run}@example.test`]);
  studentId = a.insertId;
  otherId = b.insertId;
});

after(async () => {
  for (const id of [studentId, otherId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  await pool.end();
});

test('findConfusableName: 다른 학생 닉네임과 헷갈리는 닉네임을 찾고, 자기 닉네임은 빼고 본다', async () => {
  assert.equal((await studentService.findConfusableName(`lan${run}`, otherId)).id, studentId, '대문자 I 대신 소문자 l');
  assert.equal((await studentService.findConfusableName(`I a n ${run}`, otherId)).id, studentId, '띄어쓰기만 다름');
  assert.equal(await studentService.findConfusableName(`Ian${run}`, studentId), null, '자기 닉네임은 중복이 아니다');
  assert.equal(await studentService.findConfusableName(`Iam${run}`, otherId), null);
});

test('isDepartmentName: 학과 이름 그대로인 닉네임(가운뎃점·공백 무시)을 찾는다', async () => {
  const [[dept]] = await pool.query("SELECT name FROM departments WHERE name LIKE '%·%' LIMIT 1");
  if (dept) assert.equal(await studentService.isDepartmentName(dept.name.replace(/·/g, '')), true, dept.name);
  assert.equal(await studentService.isDepartmentName('알고리즘러버'), false);
});
