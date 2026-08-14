-- Database schema for wku-ai-chat (v4.0 피벗판)
-- 근거: 위키 API-설계, ERD-설계 (v4.0) - https://github.com/ONE-Student-wku/web/wiki
-- v3.5에서 폐기된 테이블: colleges / professors / templates / course_offerings /
--   leave_requests / withdrawal_requests / refund_requests / tuition_* /
--   attendance_records / official_leave_requests / course_evaluations /
--   completed_course_items / home_shortcuts / shortcut_catalog / academic_calendar / notices
--
-- ERD 문서 대비 추가된 부분 (회원가입/온보딩 논의 반영, 팀 확인 필요):
--   - departments 테이블 신설 (학과 선택 UI 확장성 대비, "컴퓨터·소프트웨어공학과"(~2025학번)와
--     "공학3계열"(2026학번~)을 별개 행으로 시드 — 2026학번부터 광역단위 개편되어 완전히 다른
--     이수구조를 가지므로 같은 학과로 취급하면 안 됨)
--   - tracks 테이블 신설 (공학3계열처럼 광역단위 학과가 2학년 진급 시 세부전공을 선택하는
--     구조 대응. departments처럼 확장 가능한 테이블로 분리 — 2027학번부터 트랙이 또
--     바뀔 예정이라는 것까지 이미 확인됨)
--   - students.department_id / admission_year / enrollment_type / onboarding_completed_at
--     (회원가입은 email/password/name만 받고, 온보딩에서 별도로 채움 → 전부 NULL 허용)
--   - students.track_id (공학3계열 학생만 해당, 2학년 진급 시 세부전공 선택)
--   - students.major_change_grade (전과생만 해당 — 1·2학년 전과는 전공 전액 부담, 3·4학년
--     전과만 최소전공 48학점으로 완화되므로 몇 학년에 전과했는지 알아야 함)
--   - students.major_change_year / major_change_semester (전과생만 해당 — 교양 이수기준은
--     학년이 아니라 "전과 시점"(2022학년도 2학기 기준 이전/이후)으로 갈리므로
--     major_change_grade만으로는 판별 불가. 웹정보서비스 실사례로 확인됨, 2026-08-12)
--   - students.second_department_id (복수전공 대상 학과. 복수전공+부전공 동시 케이스는
--     스코프 제외하고 컬럼 하나로 단순화하기로 함)
--   - students.career_counseling_count (자기계발심층상담 누적 참여 횟수. 학칙/시행규칙
--     원문엔 없고 교육과정 책자 각주에만 있는 요건 — 세션별 로그는 안 남기고 총 횟수만 카운트)
--   - curriculum_requirements.department_id / min_admission_year / max_admission_year
--     (학과·입학년도별로 이수규정이 갈리는 경우 대응)
--   - curriculum_requirements.enrollment_type (전과/편입/복수전공생의 완화된 최소전공
--     48학점 기준을 별도 행으로 표현하기 위함, NULL이면 전체 공통 적용)
--   - curriculum_requirements.min_course_count (졸업인증제처럼 "여러 과목 중 최소 N개"
--     식 OR 조건을 표현하기 위함 — required_credits만으로는 표현이 안 됨)
--   - courses.category / student_courses.category를 ENUM으로 제한 (학과·트랙과 같은 이유:
--     통제된 값이라 자유입력이면 오타 위험, 과목명은 자유입력 유지)
--   - regulation_documents.source_type / regulation_chunks.embedding (RAG 하이브리드 소스
--     전략 및 임베딩 저장 방식 확정 — 자세한 이유는 7번 섹션 주석 참고)

CREATE DATABASE IF NOT EXISTS wku_ai_chat;
USE wku_ai_chat;

-- ---------------------------------------------------------------------------
-- 1. 학과 마스터
-- "컴퓨터·소프트웨어공학과"(~2025학번, 136점 체계)와 "공학3계열"(2026학번~, 130점 체계
-- + 세부전공 선택제)을 별개 행으로 시드. 2026학번부터 광역단위로 개편되며 이수구조
-- 자체가 달라져서 같은 학과 취급하면 학번 분기 로직이 꼬임.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,

  CONSTRAINT uq_departments_name UNIQUE (name)
);

-- ---------------------------------------------------------------------------
-- 2. 세부전공(트랙) 마스터
-- 공학3계열처럼 광역단위로 모집해 2학년 진급 시 세부전공을 선택하는 학과에서만 쓰임.
-- departments와 마찬가지로 확장 가능한 테이블로 분리 (2027학번부터 "AI공학계열"로
-- 다시 개편되며 트랙이 바뀔 예정인 것도 이미 확인됨 — 그때 행만 추가하면 되게).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracks (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  department_id  INT NOT NULL,
  name           VARCHAR(100) NOT NULL,

  FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT uq_tracks_department_name UNIQUE (department_id, name)
);

-- ---------------------------------------------------------------------------
-- 3. 학생 계정
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
  track_id                  INT,     -- 공학3계열 등 광역단위 학과만 해당, 2학년 진급 시 선택. 그 외 NULL
  admission_year            INT,
  enrollment_type           ENUM('GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE'),  -- 일반재학생 / 편입생 / 전과생
  major_change_grade        TINYINT,  -- 전과생만 해당(몇 학년에 전과했는지, 1~4). 1·2학년 전과는 전공 전액,
                                       -- 3·4학년 전과만 최소전공 48학점으로 완화되므로 필요. 그 외 NULL
  major_change_year         INT,      -- 전과생만 해당(전과한 연도). 교양 이수기준이 전과 "시점"(2022학년도
                                       -- 2학기 기준 이전/이후)으로 갈리므로 학년만으론 판별 불가. 그 외 NULL
  major_change_semester     TINYINT,  -- 전과생만 해당(전과한 학기, 1 또는 2). 그 외 NULL
  second_department_id      INT,      -- 복수전공 대상 학과. 복수전공 안 하면 NULL (복수전공+부전공 동시는 스코프 제외)
  career_counseling_count   INT NOT NULL DEFAULT 0,  -- 자기계발심층상담 누적 참여 횟수(세션별 로그는 안 남김)
  onboarding_completed_at   TIMESTAMP NULL,

  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_students_email UNIQUE (email),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL,
  FOREIGN KEY (second_department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 4. 전공 과목 카탈로그 (분반 단위)
-- 교양은 카탈로그를 두지 않고 student_courses에 자유 입력한다 (아래 5번 참고).
-- 학수번호는 저장하지 않음 — 단순 구분 코드일 뿐이라 앱 내부에서는 자동증가 id로 충분하고,
-- 학수번호를 모르는 과목(예: 구학과 "기업연계프로젝트2")도 등록 가능해야 하기 때문.
-- 분반은 같은 과목이 다른 시간대에 개설되는 경우를 구분하기 위해 유지.
-- category는 학과/트랙과 같은 이유로 ENUM 고정(통제된 값, 오타 방지). 과목명(name)은
-- 다양해서 자유입력이지만 이수구분은 다섯 가지 뿐이라 자유입력으로 둘 이유가 없음.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  section    VARCHAR(10),  -- 분반 (예: "01", "02"), 없으면 NULL
  professor  VARCHAR(50),
  credits    DECIMAL(2,1) NOT NULL,
  category   ENUM('전공필수', '전공선택', '교양필수', '교양선택', '일반선택'),

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
-- 5. 내 수강·성적 (통합) — v3.5의 student_courses(등록 여부) + grades(점수)를 병합
--
-- 전공: 카탈로그(courses)에서 검색·선택 → course_id가 채워지고, name/credits/category는
--       선택 시점에 카탈로그 값을 그대로 복사해 저장(스냅샷). 카탈로그가 나중에 바뀌어도
--       이미 등록한 학생의 이수 기록은 안 변함.
-- 교양: 카탈로그 없이 자유 입력 → course_id는 NULL, name/credits/category를 학생이 직접 입력.
--       과목명은 자유 텍스트, category는 courses와 동일한 ENUM으로 드롭다운 선택.
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
  category          ENUM('전공필수', '전공선택', '교양필수', '교양선택', '일반선택') NOT NULL,
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
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  INDEX idx_student_courses_course_id (course_id),  -- course_id 단독 인덱스. name UNIQUE만 있으면
                                                      -- course_id FK를 지원할 인덱스가 없어 MySQL이 거부함
  -- 과목명 기준으로 같은 학기에 중복 등록을 막는다. course_id 기준(분반 단위)이었다가,
  -- 같은 과목의 "다른 분반"을 추가하면 안 걸리는 문제(course_id가 분반마다 다름)가
  -- 실측으로 확인되어 name 기준으로 바꿈 — 카탈로그로 추가하든 직접입력하든 동일 과목명은
  -- 한 학기에 하나만 허용.
  CONSTRAINT uq_student_courses_name UNIQUE (student_id, name, year, semester)
);

-- 교양/직접입력 과목(course_id가 NULL)은 course_schedules에 연결할 방법이 없어서 시간표에
-- 절대 안 뜬다. 과거 학기 기록처럼 시간을 몰라도 괜찮아야 하니 필수는 아니지만, 이번
-- 학기처럼 실제 시간을 아는 경우엔 직접 넣어서 시간표에도 보이게 하고 싶을 수 있다 —
-- 그래서 student_courses 행에 딸린 선택적 시간표를 별도 테이블로 둔다.
CREATE TABLE IF NOT EXISTS student_course_schedules (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  student_course_id  INT NOT NULL,
  day                VARCHAR(10) NOT NULL,  -- 월/화/수/목/금
  period             INT NOT NULL,

  FOREIGN KEY (student_course_id) REFERENCES student_courses(id) ON DELETE CASCADE,
  CONSTRAINT uq_student_course_schedules UNIQUE (student_course_id, day, period)
);

-- ---------------------------------------------------------------------------
-- 6. 졸업 이수요건
-- min/max_admission_year로 학번별 적용 범위 표현 (둘 다 NULL이면 전체 학번 공통 적용).
--
-- enrollment_type: 전과(3·4학년)/편입/복수전공생은 일반 재학생과 다른(완화된) 최소전공
-- 학점을 적용받으므로(학칙시행규칙 제7·8조), 같은 department_id/학번 구간에 대해
-- enrollment_type별로 별도 행을 둘 수 있게 함. NULL이면 특정 enrollment_type 무관하게
-- 공통 적용되는 일반 요건.
--
-- min_course_count: required_credits(학점 총량) 방식으로 표현이 안 되는 "졸업인증제"류
-- 요건 대응 — curriculum_required_courses에 연결된 과목들 중 최소 몇 개(예: 1개)만
-- 이수하면 되는 OR 조건을 표현. NULL이면 목록에 없고 required_credits만 본다는 뜻.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_requirements (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  department_id       INT NOT NULL,
  category            VARCHAR(30) NOT NULL,  -- 전공필수/전공선택/교양필수/교양선택/일반선택
  required_credits    DECIMAL(4,1) NOT NULL,
  description         VARCHAR(255),

  min_admission_year  INT,  -- NULL이면 하한 없음
  max_admission_year  INT,  -- NULL이면 상한 없음
  enrollment_type     ENUM('GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE'),  -- NULL이면 전체 공통
  min_course_count    INT,  -- "이 중 최소 N개" 식 OR 조건 (졸업인증제 등). NULL이면 미적용

  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS curriculum_required_courses (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  requirement_id  INT NOT NULL,
  course_name     VARCHAR(100) NOT NULL,

  FOREIGN KEY (requirement_id) REFERENCES curriculum_requirements(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 6.5. 학과별 학년/학기 교육과정 편성표 ("1학년 2학기에 무슨 과목 있어?" 같은 나열형 질문용)
--
-- db/curriculum/*.md 원문 표를 그대로 구조화한 테이블. 예전에는 이 표를 텍스트로 쪼개 RAG
-- 임베딩 검색으로 답했는데, "특정 학기 과목 전부 나열" 같은 질문은 유사도 top-K 특성상 일부가
-- 누락되는 문제가 실측으로 반복 확인되어(regulationService.js 개편 이력 참고) 조건 조회가
-- 보장되는 이 테이블로 옮겼다. RAG는 학칙처럼 진짜 비정형 프로즈 문서에만 남긴다.
--
-- semester: "1", "2", 또는 "1,2"(두 학기 모두 개설, 예: 컴퓨터개론) — FIND_IN_SET으로 조회.
-- min/max_admission_year: 파일(구학과 vs 공학3계열) 단위로 적용 범위가 갈려서 행 단위로 채움.
-- track_id: 공학3계열처럼 트랙별로 편성이 갈리는 경우만, 구학과처럼 트랙이 없으면 NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_courses (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  department_id       INT NOT NULL,
  track_id            INT,
  min_admission_year  INT,
  max_admission_year  INT,
  grade               TINYINT NOT NULL,
  semester            VARCHAR(5) NOT NULL,
  category            VARCHAR(20) NOT NULL,
  course_code         VARCHAR(20),
  course_name         VARCHAR(100) NOT NULL,
  course_name_en      VARCHAR(150),
  credits             DECIMAL(3,1),
  remarks             VARCHAR(100),

  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

-- ---------------------------------------------------------------------------
-- 7. 학칙·규정 문서 (AI 챗봇 RAG 근거)
--
-- 하이브리드 소스 전략: db/regulations/*.md(주제별 정리 문서, 학생 질문 형태에 가까움)를
-- 주 소스로, db/regulations/_source/*.txt(학칙·시행규칙 원문)를 보조 소스로 함께
-- 임베딩한다. 정리 문서만 쓰면 우리가 다루지 않은 주제는 원문에 답이 있어도 챗봇이
-- 불필요하게 "모른다"고 답하게 되고, 원문만 쓰면 조항 간 상호참조가 많아 청크 하나만
-- 봐서는 맥락이 끊기는 경우가 많아서 둘을 같이 둔다.
--
-- source_type으로 두 소스를 구분한다 (정리 문서가 질문 형태에 더 가까워 검색 시 우선
-- 매칭될 가능성이 높고, 원문은 커버리지 안전망 역할).
--
-- 청크 분할 기준: 정리 문서는 "###" 소제목 단위, 원문은 "제N조(...)" 패턴 기준 조 단위로
-- 코드에서 결정론적으로 분할한다(LLM이 매번 판단하지 않음).
--
-- 임베딩 저장: 지금 규모(수백 개 청크)에서는 외부 벡터 DB가 오버킬이라, 벡터를
-- regulation_chunks.embedding(JSON)에 그대로 저장하고 검색 시 서버(Node.js)에서
-- 코사인 유사도를 직접 계산한다. 청크가 수만 개 이상으로 커지면 재검토 필요.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regulation_documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  category        VARCHAR(30),  -- 학칙 / 이수규정 등
  source_type     ENUM('CURATED', 'VERBATIM') NOT NULL,  -- 정리 문서 / 원문
  source_url      VARCHAR(500),
  effective_date  DATE
);

CREATE TABLE IF NOT EXISTS regulation_chunks (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  document_id   INT NOT NULL,
  chunk_index   INT NOT NULL,
  content       TEXT NOT NULL,
  embedding     JSON,  -- 임베딩 벡터. 서버에서 코사인 유사도 계산용

  FOREIGN KEY (document_id) REFERENCES regulation_documents(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 8. 챗봇 대화
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
-- 학과·트랙 마스터 초기 시드
-- "컴퓨터·소프트웨어공학과"는 ~2025학번(136점 체계, 트랙 없음), "공학3계열"은
-- 2026학번~(130점 체계, 아래 두 트랙 중 하나를 2학년 진급 시 선택)에 대응.
-- ---------------------------------------------------------------------------
INSERT INTO departments (name) VALUES ('컴퓨터·소프트웨어공학과')
  ON DUPLICATE KEY UPDATE name = name;
INSERT INTO departments (name) VALUES ('공학3계열')
  ON DUPLICATE KEY UPDATE name = name;

INSERT INTO tracks (department_id, name)
  SELECT id, '컴퓨터·소프트웨어공학전공' FROM departments WHERE name = '공학3계열'
  ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO tracks (department_id, name)
  SELECT id, '게임콘텐츠학전공' FROM departments WHERE name = '공학3계열'
  ON DUPLICATE KEY UPDATE name = VALUES(name);
