# ERD 설계 (SQL 스크립트)

> [API 설계](./API-설계.md)의 각 섹션 번호를 근거로 작성했습니다. 세부 데이터 값(과거 이력 과목, 학사일정 날짜 등)이 아직 안 정해진 것과 무관하게, **구조(테이블/컬럼/관계)는 이 문서로 확정**합니다.
> 현재 `db/schema.sql`의 `students / notices / courses / student_courses / grades`는 아래 구조로 대체·확장됩니다. MySQL 문법 기준.

## 1. 전체 구조 개요

### 1-1. 공용 카탈로그 (모든 학생이 공통 참조)
| 테이블 | 설명 | 관계 |
|---|---|---|
| `colleges` | 단과대 마스터 | departments(1:N) |
| `departments` | 학과 마스터 | colleges(N:1), professors/templates/courses/students(1:N) |
| `professors` | 교수 마스터 | departments(N:1), course_offerings/students(1:N) |
| `templates` | 신규가입 시드 템플릿 | departments(N:1), students(1:N) |
| `courses` | 과목 마스터 | departments(N:1), course_offerings(1:N) |
| `course_offerings` | 학기별 개설강좌 | courses/professors(N:1), course_offering_schedules 외 다수(1:N) |
| `course_offering_schedules` | 개설강좌 요일/교시 | course_offerings(N:1) |
| `academic_calendar` | 학사일정 mock | 참조용, FK 없음 |
| `shortcut_catalog` | 홈 바로가기 후보 목록 | home_shortcuts(1:N) |

### 1-2. 학생 개인 데이터
| 테이블 | 설명 | 관계 |
|---|---|---|
| `students` | 학생 계정/프로필 | 아래 전체 테이블(1:N) |
| `student_courses` | 확정 수강신청 | students/course_offerings(N:1) |
| `grades` | 현재 학기 성적 | students/course_offerings(N:1), grade_correction_requests(1:1) |
| `grade_correction_requests` | 성적 정정요청 | grades(1:1) |
| `attendance_records` | 출결 기록 | students/course_offerings(N:1) |
| `official_leave_requests` | 공결 신청 | students/course_offerings(N:1) |
| `course_evaluations` | 수업평가 제출 | students/course_offerings(N:1) |
| `leave_requests` | 휴학/복학 신청 | students(N:1) |
| `withdrawal_requests` | 자퇴 신청 | students(N:1), refund_requests(1:N) |
| `refund_requests` | 환불 신청 | students(N:1), withdrawal_requests(N:1, optional) |
| `tuition_invoices` | 등록고지서 | students(N:1), tuition_invoice_items(1:N) |
| `tuition_invoice_items` | 고지서 항목 | tuition_invoices(N:1) |
| `tuition_schedules` | 등록 일정 안내 | 참조용, FK 없음 |
| `completed_course_items` | 과거 이수과목 이력 (mock) | students(N:1) |
| `home_shortcuts` | 학생별 바로가기 설정 | students/shortcut_catalog(N:1) |
| `chat_conversations` | 챗봇 대화방 | students(N:1), chat_messages(1:N) |
| `chat_messages` | 챗봇 대화 메시지 | chat_conversations(N:1) |

---

## 2. 공용 카탈로그

### 2-1. `colleges` / `departments`
```sql
CREATE TABLE colleges (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL
);

CREATE TABLE departments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  college_id   INT NOT NULL,
  name         VARCHAR(100) NOT NULL,

  FOREIGN KEY (college_id) REFERENCES colleges(id)
);
```
- API 명세: 2-2(단과대/학과 목록 조회), 4-1(학과별시간표 검색조건) 반영
- 지금은 컴퓨터·소프트웨어공학과 1건뿐이지만, 템플릿이 늘어날 걸 대비해 처음부터 마스터 테이블로 분리

### 2-2. `professors`
```sql
CREATE TABLE professors (
  id             VARCHAR(20) PRIMARY KEY,
  department_id  INT NOT NULL,
  name           VARCHAR(50) NOT NULL,

  FOREIGN KEY (department_id) REFERENCES departments(id)
);
```
- API 명세: 2-1(`/api/me`의 advisorProfessor), 4-2/4-3(교수시간표 검색/상세) 반영
- 0.7 기준 9명 시드 (이상원 교수가 이산수학·빅데이터 2과목 담당)

### 2-3. `templates`
```sql
CREATE TABLE templates (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  department_id  INT NOT NULL,
  name           VARCHAR(100) NOT NULL,

  FOREIGN KEY (department_id) REFERENCES departments(id)
);
```
- API 명세: 0.7(신규 가입 학생 데이터 채우기 전략) 반영
- 1차 스코프는 1행("컴퓨터·소프트웨어공학과 템플릿")만 시드. `students.template_id`가 이 테이블을 참조

### 2-4. `courses` / `course_offerings` / `course_offering_schedules`
```sql
CREATE TABLE courses (
  code           VARCHAR(20) PRIMARY KEY,
  department_id  INT NOT NULL,
  name           VARCHAR(100) NOT NULL,
  credits        DECIMAL(2,1) NOT NULL,
  category       VARCHAR(20),  -- 기전/선전/교필/교선 등

  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE course_offerings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  course_code    VARCHAR(20) NOT NULL,
  year           INT NOT NULL,
  semester       TINYINT NOT NULL,
  section        VARCHAR(10) NOT NULL,
  professor_id   VARCHAR(20),
  room           VARCHAR(100),

  FOREIGN KEY (course_code) REFERENCES courses(code),
  FOREIGN KEY (professor_id) REFERENCES professors(id),
  CONSTRAINT uq_offering UNIQUE (course_code, year, semester, section)
);

CREATE TABLE course_offering_schedules (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  offering_id  INT NOT NULL,
  day          VARCHAR(10) NOT NULL,  -- 월/화/수/목/금/토
  period       INT NOT NULL,

  FOREIGN KEY (offering_id) REFERENCES course_offerings(id) ON DELETE CASCADE
);
```
- API 명세: 0.6/0.7(과목 마스터·개설강좌 분리, 복합키), 4-1(시간표), 5-1~5-5(강의계획서/수강신청/수업평가), 6-1~6-2(출결) 전부 이 세 테이블 기반
- `course_offerings`: surrogate PK(`id`=offeringId) + `UNIQUE(course_code, year, semester, section)`으로 복합키 요건 충족. 자식 테이블은 전부 `offering_id` 하나만 참조
- `course_offering_schedules`: 요일/교시를 `"화78목5"`처럼 문자열로 뭉치면 조회가 어려워서 행 단위로 분리 (한 과목이 주 2회 이상이면 행이 여러 개)
- `courses.department_id`: 4-1이 학과 단위로 필터링하므로 필요

### 2-5. `academic_calendar`
```sql
CREATE TABLE academic_calendar (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  type        VARCHAR(50) NOT NULL,  -- LEAVE_APPLICATION / WITHDRAWAL_APPLICATION / OFFICIAL_LEAVE_APPLICATION / COURSE_EVALUATION / GRADE_CORRECTION / TUITION_INVOICE 등
  year        INT NOT NULL,
  semester    TINYINT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL
);
```
- API 명세: 2-3(학사일정 조회), 0.5("기간이 아님" 판단 기준) 반영

### 2-6. `shortcut_catalog`
```sql
CREATE TABLE shortcut_catalog (
  key_name  VARCHAR(30) PRIMARY KEY,
  label     VARCHAR(50) NOT NULL,
  icon      VARCHAR(30)
);
```
- API 명세: 2-4(`GET /api/home/shortcuts/available`) 반영. `key`는 예약어라 `key_name`으로 사용

---

## 3. 학생 기본정보

### 3-1. `students`
```sql
CREATE TABLE students (
  id                    VARCHAR(20) PRIMARY KEY,  -- 학번, 서버 자동발급 (입학년도4자리+순번4자리)
  email                 VARCHAR(255) NOT NULL,
  password              VARCHAR(255) NOT NULL,
  name                  VARCHAR(50) NOT NULL,
  college_id            INT NOT NULL,
  department_id         INT NOT NULL,
  grade                 INT,
  admission_year        INT,
  completed_semesters   INT,
  admission_type        VARCHAR(50),
  advisor_professor_id  VARCHAR(20),
  template_id           INT,
  transfer_type         VARCHAR(50),
  transfer_year         INT,
  previous_department   VARCHAR(100),
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_students_email UNIQUE (email),
  FOREIGN KEY (college_id) REFERENCES colleges(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (advisor_professor_id) REFERENCES professors(id),
  FOREIGN KEY (template_id) REFERENCES templates(id)
);
```
- API 명세: 1-1(회원가입), 1-2(로그인), 2-1(`/api/me`) 반영
- `email`: UNIQUE → 1-1의 `409 EMAIL_ALREADY_EXISTS` 응답 근거. 로그인은 이 값 기준(확정)
- `id`(학번)는 로그인 값이 아니라 프로필/학사정보 식별용으로만 사용
- `completed_semesters`/`admission_type`/`transfer_*`/`previous_department`: 7-3 이수과목확인리스트의 studentInfo 표시용 (과거 이력이 완전 관계형이 아니라 별도 저장 필요)
- `template_id`: 0.7 템플릿 배정 전략 반영, 가입 시 이 템플릿의 시드 데이터를 아래 테이블들에 학생 소유 행으로 복사

---

## 4. 정보서비스 › 학적관리

### 4-1. `leave_requests` (휴학/복학)
```sql
CREATE TABLE leave_requests (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        VARCHAR(20) NOT NULL,
  change_type       VARCHAR(20) NOT NULL,  -- GENERAL_LEAVE / MILITARY_LEAVE / STARTUP_LEAVE / PARENTAL_LEAVE / RETURN
  reason            VARCHAR(255) NOT NULL,
  request_year      INT NOT NULL,
  request_semester  TINYINT NOT NULL,
  return_year       INT,
  return_semester   TINYINT,
  status            VARCHAR(20) DEFAULT 'PENDING',  -- PENDING / CANCELLED
  submitted_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
```
- API 명세: 3-1(내역조회), 3-2(신청), 3-3(취소) 반영
- 휴학·복학은 `change_type`으로 구분해 한 테이블에서 통합 조회 (API 설계에서 이미 확정한 단일 엔드포인트 구조와 대응)
- 승인 단계가 없으므로 `status`는 `PENDING`/`CANCELLED`만 존재 (`APPROVED` 없음)

### 4-2. `withdrawal_requests` (자퇴)
```sql
CREATE TABLE withdrawal_requests (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_id    VARCHAR(20) NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  status        VARCHAR(20) DEFAULT 'PENDING',
  submitted_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
```
- API 명세: 3-4(내역조회), 3-5(신청), 3-6(취소) 반영
- 자퇴는 휴학과 필드가 달라서(`changeType`/`returnYear` 없음) 별도 테이블로 분리
- 환불과의 연결은 이 테이블이 아니라 [6-4 `refund_requests`](#6-4-refund_requests)의 `withdrawal_request_id`에서 한쪽으로만 참조 (양방향 FK 중복 제거)

---

## 5. 정보서비스 › 수업관리

### 5-1. `student_courses`
```sql
CREATE TABLE student_courses (
  student_id   VARCHAR(20) NOT NULL,
  offering_id  INT NOT NULL,
  is_retake    BOOLEAN DEFAULT FALSE,

  PRIMARY KEY (student_id, offering_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES course_offerings(id)
);
```
- API 명세: 5-3(수강신청 조회) 반영 — 이 시스템 DB에 저장된 확정 결과

### 5-2. `course_evaluations`
```sql
CREATE TABLE course_evaluations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_id    VARCHAR(20) NOT NULL,
  offering_id   INT NOT NULL,
  submitted     BOOLEAN DEFAULT FALSE,
  submitted_at  TIMESTAMP NULL,
  answers       JSON,

  CONSTRAINT uq_evaluation UNIQUE (student_id, offering_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES course_offerings(id)
);
```
- API 명세: 5-4(대상목록), 5-5(제출) 반영
- `UNIQUE(student_id, offering_id)`: "과목당 1회 제출" 강제. 문항 자체는 프론트 고정이라 별도 문항 테이블 없음
- `student_id`가 남아있어 완전 익명은 아님 — 중복제출 방지를 위한 최소 식별로 확정 (API 설계 5-5 트레이드오프 참고)

---

## 6. 정보서비스 › 전자출결관리 · 성적관리 · 등록관리

### 6-1. `attendance_records`
```sql
CREATE TABLE attendance_records (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  student_id   VARCHAR(20) NOT NULL,
  offering_id  INT NOT NULL,
  week         INT NOT NULL,
  date         DATE NOT NULL,
  period       INT NOT NULL,
  status       VARCHAR(20) NOT NULL,  -- PRESENT / LATE / OFFICIAL_ABSENCE / ABSENCE
  category     VARCHAR(50),  -- 공결 사유 (예비군 등)

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES course_offerings(id)
);
```
- API 명세: 6-1(목록), 6-2(상세) 반영. mock 시드로 직접 생성, 실시간 출결체크 기능 없음(확정)

### 6-2. `official_leave_requests`
```sql
CREATE TABLE official_leave_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  student_id       VARCHAR(20) NOT NULL,
  offering_id      INT NOT NULL,
  applied_date     DATE NOT NULL,
  absence_date     DATE NOT NULL,
  period           INT NOT NULL,
  reason           VARCHAR(255) NOT NULL,
  approval_status  VARCHAR(20) DEFAULT 'PENDING',

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES course_offerings(id)
);
```
- API 명세: 6-3(조회), 6-4(신청), 6-5(취소) 반영
- `approval_status`: 화면 표시용 필드. 승인 주체가 없어 API로 값이 바뀌지 않음(기본값 고정)

### 6-3. `grades` / `grade_correction_requests`
```sql
CREATE TABLE grades (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        VARCHAR(20) NOT NULL,
  offering_id       INT NOT NULL,
  midterm           DECIMAL(5,2),
  final             DECIMAL(5,2),
  attendance_score  DECIMAL(5,2),
  assignment        DECIMAL(5,2),
  etc               DECIMAL(5,2),
  gpa               DECIMAL(3,2),
  letter_grade      VARCHAR(5),

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES course_offerings(id)
);

CREATE TABLE grade_correction_requests (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  grade_id      INT NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  requested_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_correction_grade UNIQUE (grade_id),
  FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE
);
```
- API 명세: 7-1(성적단표조회), 7-2(정정요청) 반영
- 점수 컬럼(`midterm`~`etc`)은 NULL 허용 — "성적 미입력"(담당교수가 아직 안 넣음)과 "진짜 0점"을 구분하기 위함 `(확인 필요)`
- `grade_correction_requests`에 `UNIQUE(grade_id)`를 걸어서 "과목당 1회 제한"을 DB 레벨에서 강제

### 6-4. `refund_requests` / `tuition_invoices` / `tuition_invoice_items` / `tuition_schedules`
```sql
CREATE TABLE refund_requests (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  student_id             VARCHAR(20) NOT NULL,
  withdrawal_request_id  INT NULL,
  apply_year             INT NOT NULL,
  apply_semester         TINYINT NOT NULL,
  reg_year               INT,
  reg_semester           TINYINT,
  reason                 VARCHAR(255) NOT NULL,
  personal_info_consent  BOOLEAN NOT NULL,
  refund_bank            VARCHAR(50),
  refund_account_number  VARCHAR(50),
  refund_holder_name     VARCHAR(50),
  refund_base_date       DATE,
  submitted_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  refunded_at            TIMESTAMP NULL,
  refund_amount          DECIMAL(10,2),
  result                 VARCHAR(20) DEFAULT 'PENDING',

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (withdrawal_request_id) REFERENCES withdrawal_requests(id)
);

CREATE TABLE tuition_invoices (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_id    VARCHAR(20) NOT NULL,
  year          INT NOT NULL,
  semester      TINYINT NOT NULL,
  total_amount  DECIMAL(10,2),

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE tuition_invoice_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id  INT NOT NULL,
  name        VARCHAR(100) NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,

  FOREIGN KEY (invoice_id) REFERENCES tuition_invoices(id) ON DELETE CASCADE
);

CREATE TABLE tuition_schedules (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  year              INT NOT NULL,
  semester          TINYINT NOT NULL,
  target_group      VARCHAR(100),
  period            VARCHAR(100),
  print_period      VARCHAR(100),
  available_banks   VARCHAR(255)
);
```
- API 명세: 8-1(등록고지서), 8-2(환불내역조회), 8-3(환불신청) 반영
- `refund_requests.withdrawal_request_id`: 자퇴로 인한 환불이면 채우고, 등록금 과오납 등 무관한 환불이면 NULL (선택값, 확정)
- `tuition_schedules`: 학생 개인 데이터가 아니라 공용 안내용이라 `student_id` 없음

### 6-5. `completed_course_items`
```sql
CREATE TABLE completed_course_items (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  student_id           VARCHAR(20) NOT NULL,
  group_type           VARCHAR(20) NOT NULL,  -- 교양/전공/기타
  type                 VARCHAR(20) NOT NULL,  -- 교필/교선/기전/선전 등
  course_name          VARCHAR(100) NOT NULL,
  year_semester        VARCHAR(10) NOT NULL,
  credits              DECIMAL(2,1) NOT NULL,
  area_or_department   VARCHAR(100),
  note                 VARCHAR(100),

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
```
- API 명세: 7-3(이수과목확인리스트), 7-4(전체성적조회) 반영
- `course_offerings`를 참조하지 않는 독립 테이블 — 과거 학기는 애초에 개설강좌로 모델링된 적 없는 mock 이력이라 플랫하게 저장 (0.7에서 확정한 "현재 10과목과 과거 이력은 별개" 결정)
- 교양/전공/기타 학점 합계는 별도 저장 없이 이 테이블을 `group_type`/`type` 기준 `SUM(credits)`로 집계 (정적 데이터라 매번 계산해도 무방, 원본과 어긋날 위험만 없앰)

---

## 7. 홈 화면 · AI 챗봇

### 7-1. `home_shortcuts`
```sql
CREATE TABLE home_shortcuts (
  student_id      VARCHAR(20) NOT NULL,
  shortcut_key    VARCHAR(30) NOT NULL,
  display_order   INT NOT NULL,

  PRIMARY KEY (student_id, shortcut_key),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (shortcut_key) REFERENCES shortcut_catalog(key_name)
);
```
- API 명세: 2-4(홈 화면 바로가기 조회/교체) 반영

### 7-2. `chat_conversations` / `chat_messages`
```sql
CREATE TABLE chat_conversations (
  id               VARCHAR(30) PRIMARY KEY,
  student_id       VARCHAR(20) NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id  VARCHAR(30) NOT NULL,
  role             VARCHAR(20) NOT NULL,  -- user / assistant / tool
  content          TEXT,
  tool_calls       JSON,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);
```
- API 명세: 9-1(동작흐름), 9-3(`/api/chat` API) 반영
- 별도 "기억 저장소" 없이 `chat_messages`만으로 같은 대화 내 문맥을 유지하기로 확정 (9-1)
- 학생당 "현재 진행 중인 대화"를 이어가는 방식이라, `chat_conversations`에서 학생별 `last_active_at`이 가장 최신인 행을 기본으로 사용

---

## 8. 기존 테이블 (변경 없음)
`notices`(공지사항)는 이번 설계 범위에서 다루지 않아 `db/schema.sql` 그대로 유지합니다.

---

## 기존 `db/schema.sql`과의 관계
현재 구현된 `courses`(id/name/professor/credits 단일 테이블), `student_courses`(student_id+course_id만 있는 단순 조인 테이블), `grades`(semester를 문자열로만 가짐)는 위 구조로 완전히 대체됩니다. 실제 마이그레이션(스키마 변경 SQL)은 구현 단계에서 별도로 작성합니다 — 이 문서는 설계 확정용입니다.
