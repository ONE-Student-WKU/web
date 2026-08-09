-- Database schema for wku-ai-chat (v4.0 피벗판)
-- 근거: docs/API-설계.md, docs/ERD-설계.md (v4.0)
-- v3.5에서 폐기된 테이블: colleges / professors / templates / course_offerings /
--   leave_requests / withdrawal_requests / refund_requests / tuition_* /
--   attendance_records / official_leave_requests / course_evaluations /
--   completed_course_items / home_shortcuts / shortcut_catalog / academic_calendar / notices
--
-- ERD 문서 대비 추가된 부분 (회원가입/온보딩 논의 반영, 팀 확인 필요):
--   - departments 테이블 신설 (학과 선택 UI 확장성 대비, 현재는 1건만 시드)
--   - students.department_id / admission_year / enrollment_type / onboarding_completed_at
--     (회원가입은 email/password/name만 받고, 온보딩에서 별도로 채움 → 전부 NULL 허용)
--   - curriculum_requirements.department_id / min_admission_year / max_admission_year
--     (학과·입학년도별로 이수규정이 갈리는 경우 대응)

CREATE DATABASE IF NOT EXISTS wku_ai_chat;
USE wku_ai_chat;

-- ---------------------------------------------------------------------------
-- 1. 학과 마스터
-- 현재는 컴퓨터·소프트웨어공학과 1건만 시드. 고정 텍스트 대신 테이블로 분리해서
-- 회원가입/온보딩 화면의 학과 선택 드롭다운이 나중에 다른 학과로 확장 가능하게 함.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,

  CONSTRAINT uq_departments_name UNIQUE (name)
);

-- ---------------------------------------------------------------------------
-- 2. 학생 계정
-- 회원가입(email/password/name)과 온보딩(department/admission_year/enrollment_type)이
-- 분리된 2단계 플로우. 온보딩 관련 컬럼은 가입 직후 비어있을 수 있어 전부 NULL 허용하고,
-- onboarding_completed_at으로 온보딩 완료 여부를 명시적으로 구분한다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  email                     VARCHAR(255) NOT NULL,
  password                  VARCHAR(255) NOT NULL,
  name                      VARCHAR(50) NOT NULL,

  department_id             INT,
  admission_year            INT,
  enrollment_type           ENUM('GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE'),  -- 일반재학생 / 편입생 / 전과생
  onboarding_completed_at   TIMESTAMP NULL,

  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_students_email UNIQUE (email),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 3. 과목 카탈로그 (분반 단위, 현재 51건)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id         VARCHAR(20) PRIMARY KEY,  -- "374124-01" (학수번호-분반)
  name       VARCHAR(100) NOT NULL,
  professor  VARCHAR(50),
  credits    DECIMAL(2,1) NOT NULL,
  category   VARCHAR(20)  -- 기전/선전/교필/교선 등
);

-- 과목별 요일/교시. 주 2회 이상 수업이면 행이 여러 개.
CREATE TABLE IF NOT EXISTS course_schedules (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  course_id  VARCHAR(20) NOT NULL,
  day        VARCHAR(10) NOT NULL,  -- 월/화/수/목/금
  period     INT NOT NULL,

  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT uq_course_schedules UNIQUE (course_id, day, period)  -- 재시딩 시 중복 삽입 방지
);

-- ---------------------------------------------------------------------------
-- 4. 내 수강·성적 (통합) — v3.5의 student_courses(등록 여부) + grades(점수)를 병합
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_courses (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        INT NOT NULL,
  course_id         VARCHAR(20) NOT NULL,
  year              INT NOT NULL,
  semester          TINYINT NOT NULL,

  midterm           DECIMAL(5,2),
  final             DECIMAL(5,2),
  attendance_score  DECIMAL(5,2),
  assignment        DECIMAL(5,2),
  etc               DECIMAL(5,2),
  gpa               DECIMAL(3,2),
  letter_grade      VARCHAR(5),

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id),
  CONSTRAINT uq_student_courses UNIQUE (student_id, course_id, year, semester)  -- 같은 학기 같은 과목 중복 등록 방지
);

-- ---------------------------------------------------------------------------
-- 5. 졸업 이수요건
-- min/max_admission_year로 학번별 적용 범위 표현 (둘 다 NULL이면 전체 학번 공통 적용).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_requirements (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  department_id       INT NOT NULL,
  category            VARCHAR(30) NOT NULL,  -- 전공필수/전공선택/교양필수/교양선택/일반선택
  required_credits    DECIMAL(4,1) NOT NULL,
  description         VARCHAR(255),

  min_admission_year  INT,  -- NULL이면 하한 없음
  max_admission_year  INT,  -- NULL이면 상한 없음

  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS curriculum_required_courses (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  requirement_id  INT NOT NULL,
  course_name     VARCHAR(100) NOT NULL,

  FOREIGN KEY (requirement_id) REFERENCES curriculum_requirements(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 6. 학칙·규정 문서 (AI 챗봇 RAG 근거)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regulation_documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  category        VARCHAR(30),  -- 학칙 / 이수규정 등
  source_url      VARCHAR(500),
  effective_date  DATE
);

CREATE TABLE IF NOT EXISTS regulation_chunks (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  document_id   INT NOT NULL,
  chunk_index   INT NOT NULL,
  content       TEXT NOT NULL,

  FOREIGN KEY (document_id) REFERENCES regulation_documents(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 7. 챗봇 대화
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_conversations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  student_id      INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id  INT NOT NULL,
  role             VARCHAR(20) NOT NULL,  -- user / assistant
  content          TEXT,
  cited_chunk_ids  JSON,  -- regulation_chunks.id 배열, 근거 인용 표시용

  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 학과 마스터 초기 시드
-- ---------------------------------------------------------------------------
INSERT INTO departments (name) VALUES ('컴퓨터·소프트웨어공학과')
  ON DUPLICATE KEY UPDATE name = name;
