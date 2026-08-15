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
--   - students.leave_semesters (누적 휴학 학기 수. 입학년도만으로 학년을 계산하면 군복무 등
--     휴학한 학생의 학년이 실제보다 높게 나오는 문제가 실사용으로 확인되어, 학생이 직접
--     보정할 수 있도록 설정 화면에서 입력받음)
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

CREATE DATABASE IF NOT EXISTS wku_ai_chat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
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
  leave_semesters           INT NOT NULL DEFAULT 0,  -- 누적 휴학 학기 수. 입학년도만으로는 휴학 여부를 알 수 없어
                                                       -- 홈 화면 학년 표시가 실제보다 높게 나오는 문제(실사용 확인,
                                                       -- 군복무 등)가 있어 학생이 직접 보정할 수 있게 둠 — 2학기당
                                                       -- 1년으로 환산해 client/src/utils/academic.js에서 학년 계산에 반영.
  onboarding_completed_at   TIMESTAMP NULL,

  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_students_email UNIQUE (email),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL,
  FOREIGN KEY (second_department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 4. 전공 과목 카탈로그 (학기별 실제 개설 분반 단위)
-- 교양은 카탈로그를 두지 않고 student_courses에 자유 입력한다 (아래 5번 참고).
--
-- 2026-08-15 전면 교체: 기존 courses/course_schedules(학기 구분 없는 단일 스냅샷 —
-- "지금 학기"만 대표해서 과거·미래 학기 카탈로그 검색이 아예 막혀 있었음, CourseManagement.jsx의
-- isCurrentTerm 게이트 참고)를 폐기하고, 원광대 공개 전공시간표 조회(intra.wku.ac.kr,
-- 로그인 불요 — db/curriculum/_source/전공시간표_2017-2026.json)에서 학기별로 실제 수집한
-- 데이터로 대체. 이제 course_id가 "특정 학기에 실제 개설된 분반"을 가리키게 되어 의미가
-- 더 정확해지고, 카탈로그 검색을 과거 학기(2017-1~)까지 확장할 수 있다.
--
-- raw_category: 원문 "구분" 코드(교필/기전/선전/계필/기초 등)를 그대로 보존 — AI 챗봇 답변
-- 등에서 원문 그대로 유용할 수 있어 트리밍하지 않고 다 저장하기로 함. category는 그걸
-- student_courses.category(졸업요건 계산에 쓰는 5종 ENUM)로 정규화한 값
-- (server/scripts/seedCourseOfferings.js의 CATEGORY_MAP 참고 — 계필/계기/기초/응용/심화/교직처럼
-- 5종에 깔끔히 안 맞는 코드는 보수적으로 매핑한 추정치이니 주의).
--
-- (year, semester, course_code, course_name, section, professor, time_raw)를 자연키로 잡아
-- 재시딩 시 idempotent하게 만든다. professor/time_raw까지 넣은 이유: 실제 원문에 같은
-- 분반 번호를 공유하는 서로 다른 실제 개설 건(교수/시간이 다름 — 예: 2018-1 "종교와원불교"
-- 25분반이 담당교수가 다른 두 행으로 존재)이 확인되어, 이를 진짜 중복으로 오인해 하나를
-- 잃지 않도록 함.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_offerings (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  department_id     INT NOT NULL,
  track_id          INT,      -- 공학3계열처럼 트랙별로 갈리는 3·4학년 과목만, 계열공통/구학과는 NULL
  year              INT NOT NULL,
  semester          TINYINT NOT NULL,
  grade             TINYINT,  -- 조회 화면 기준 권장 학년, 없을 수 있어 NULL 허용
  raw_category      VARCHAR(10),   -- 원문 "구분" 코드 그대로 (교필/기전/선전/계필/기초 등)
  category          ENUM('전공필수', '전공선택', '교양필수', '교양선택', '일반선택'),  -- raw_category 정규화값
  course_code       VARCHAR(20),
  course_name       VARCHAR(100) NOT NULL,
  section           VARCHAR(10),
  credits           DECIMAL(3,1),
  professor         VARCHAR(50),
  room              VARCHAR(150),
  competency        VARCHAR(50),   -- 역량 태그(SW실무역량 등), 원문 그대로 보존
  time_raw          VARCHAR(50),   -- 원문 "시간" 압축 표기(예: "월34화56") 그대로 보존

  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id),
  CONSTRAINT uq_course_offerings UNIQUE (year, semester, course_code, course_name, section, professor, time_raw)
);

-- 과목별 요일/교시(course_offerings.time_raw를 파싱한 구조화 값). 주 2회 이상 수업이면 행이 여러 개.
-- 시간이 확정 안 된 항목(time_raw가 비어있는 저학년 필수과목 등)은 행이 없을 수 있음.
CREATE TABLE IF NOT EXISTS course_offering_schedules (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  offering_id  INT NOT NULL,
  day          VARCHAR(10) NOT NULL,  -- 월/화/수/목/금
  period       INT NOT NULL,

  FOREIGN KEY (offering_id) REFERENCES course_offerings(id) ON DELETE CASCADE,
  CONSTRAINT uq_course_offering_schedules UNIQUE (offering_id, day, period)
);

-- ---------------------------------------------------------------------------
-- 5. 내 수강·성적 (통합) — v3.5의 student_courses(등록 여부) + grades(점수)를 병합
--
-- 전공: 카탈로그(course_offerings)에서 학기별로 검색·선택 → course_id가 채워지고,
--       name/credits/category는 선택 시점에 카탈로그 값을 그대로 복사해 저장(스냅샷).
--       카탈로그가 나중에 바뀌어도 이미 등록한 학생의 이수 기록은 안 변함.
-- 교양: 카탈로그 없이 자유 입력 → course_id는 NULL, name/credits/category를 학생이 직접 입력.
--       과목명은 자유 텍스트, category는 course_offerings와 동일한 ENUM으로 드롭다운 선택.
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
  FOREIGN KEY (course_id) REFERENCES course_offerings(id) ON DELETE SET NULL,
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
