-- Database schema for wku-ai-chat (v4.0 피벗판)
-- 근거: 위키 API-설계, ERD-설계 (v4.0) - https://github.com/wku-ai-chat/web/wiki
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
-- 3. 전공 과목 카탈로그 (분반 단위)
-- 교양은 카탈로그를 두지 않고 student_courses에 자유 입력한다 (아래 4번 참고).
-- 학수번호는 저장하지 않음 — 단순 구분 코드일 뿐이라 앱 내부에서는 자동증가 id로 충분하고,
-- 학수번호를 모르는 과목(예: 구학과 "기업연계프로젝트2")도 등록 가능해야 하기 때문.
-- 분반은 같은 과목이 다른 시간대에 개설되는 경우를 구분하기 위해 유지.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  section    VARCHAR(10),  -- 분반 (예: "01", "02"), 없으면 NULL
  professor  VARCHAR(50),
  credits    DECIMAL(2,1) NOT NULL,
  category   VARCHAR(20),  -- 기전/선전 등 (전공 이수구분만 다룸)

  -- id가 자동증가라 재시딩 시 INSERT IGNORE만으로는 중복을 못 걸러서, (name, section)을
  -- 자연키로 잡아 idempotent하게 만든다. 학수번호 없이도 과목을 구분할 수 있어야 하므로
  -- section이 NULL인 경우(분반 정보 없음)도 있을 수 있음 — 이 경우 name만으로 구분됨에 유의.
  CONSTRAINT uq_courses_name_section UNIQUE (name, section)
);

-- 과목별 요일/교시. 주 2회 이상 수업이면 행이 여러 개.
CREATE TABLE IF NOT EXISTS course_schedules (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  course_id  INT NOT NULL,
  day        VARCHAR(10) NOT NULL,  -- 월/화/수/목/금
  period     INT NOT NULL,

  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT uq_course_schedules UNIQUE (course_id, day, period)  -- 재시딩 시 중복 삽입 방지
);

-- ---------------------------------------------------------------------------
-- 4. 내 수강·성적 (통합) — v3.5의 student_courses(등록 여부) + grades(점수)를 병합
--
-- 전공: 카탈로그(courses)에서 검색·선택 → course_id가 채워지고, name/credits/category는
--       선택 시점에 카탈로그 값을 그대로 복사해 저장(스냅샷). 카탈로그가 나중에 바뀌어도
--       이미 등록한 학생의 이수 기록은 안 변함.
-- 교양: 카탈로그 없이 자유 입력 → course_id는 NULL, name/credits/category를 학생이 직접 입력.
--
-- 즉 course_id는 "카탈로그에서 골랐다는 참고용 연결고리"일 뿐, 실제 이수 기록에 필요한
-- 값(name/credits/category)은 항상 이 테이블 자체에 저장되어 course_id 유무와 무관하게
-- 조회/학점계산이 가능하다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_courses (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        INT NOT NULL,
  course_id         INT,              -- 전공(카탈로그 선택)만 채워짐, 교양 자유입력이면 NULL
  name              VARCHAR(100) NOT NULL,
  credits           DECIMAL(2,1) NOT NULL,
  category          VARCHAR(20) NOT NULL,  -- 전공필수/전공선택/교양필수/교양선택/일반선택 등
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
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
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
