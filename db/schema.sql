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
-- 로그인은 Google OAuth만 지원(비밀번호 로그인 폐지 — password 컬럼은 과거 호환용으로만
-- nullable 유지, 신규 계정은 항상 NULL). oauth_provider/oauth_id로 최초 로그인 시 신규
-- 생성되거나 기존 email 매칭 행에 연결(link)된다. 가입과 온보딩(department/admission_year/
-- enrollment_type)은 분리된 2단계 플로우 — 온보딩 관련 컬럼은 가입 직후 비어있을 수 있어
-- 전부 NULL 허용하고, onboarding_completed_at으로 온보딩 완료 여부를 명시적으로 구분한다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  email                     VARCHAR(255) NOT NULL,
  password                  VARCHAR(255) NULL,  -- Google OAuth 전환 이후 사용 안 함(레거시 비밀번호 계정 호환용으로만 컬럼 유지)
  name                      VARCHAR(50) NULL,  -- 가입 시 값 없음(자동 배정: user{id}) — 표시 시 name || `user${id}`로 계산(studentService.serializeStudent).
                                                -- UNIQUE라 닉네임 사칭/도용 방지 — NULL끼리는 서로 다른 값으로 취급되므로 미설정 계정들끼리는 충돌 없음.
  oauth_provider            VARCHAR(20) NULL,   -- 예: 'google' (추후 다른 provider 추가 가능하도록 provider-agnostic하게 설계)
  oauth_id                  VARCHAR(255) NULL,  -- provider가 발급한 고유 식별자(Google이면 ID 토큰의 sub)
  role                      VARCHAR(20) NOT NULL DEFAULT 'student',  -- 'student' | 'admin' — 커뮤니티 승인 등 관리 기능 접근 권한

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
  -- oauth_provider/oauth_id 조합 UNIQUE. MySQL은 UNIQUE에서 NULL끼리는 서로 다른 값으로
  -- 취급하므로, 아직 OAuth 연결이 안 된(둘 다 NULL) 레거시 행이 여러 개 있어도 위반되지 않음.
  CONSTRAINT uq_students_oauth UNIQUE (oauth_provider, oauth_id),
  -- 닉네임 사칭/도용 방지용 UNIQUE. 테이블 기본 collation(utf8mb4_unicode_ci)이 대소문자를
  -- 구분하지 않으므로 "admin"과 "Admin"도 같은 값으로 취급되어 충돌한다 — 의도된 동작.
  CONSTRAINT uq_students_name UNIQUE (name),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL,
  FOREIGN KEY (second_department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 3-1. 세션 저장소 (express-mysql-session)
-- 기존 express-session 기본값(MemoryStore)은 프로세스 메모리에만 세션을 들고 있어
-- 서버 재시작/재배포마다 전체 사용자가 강제 로그아웃되는 문제가 있었다. 세션을 DB 행으로
-- 영속화해서 프로세스 생명주기와 로그인 상태를 분리한다. 컬럼 구성은 express-mysql-session
-- 기본 스키마 그대로(createDatabaseTable: false로 자동 생성을 끄고 여기서 직접 관리 — 다른
-- 테이블처럼 schema.sql + db/migrate.js 컨벤션을 따르기 위함).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires INT(11) UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin
);

-- ---------------------------------------------------------------------------
-- 3-2. 이메일 인증코드 로그인 토큰
-- 구글 OAuth의 두 번째 로그인 수단(PR #142 후속) — 도메인 제한 없이 어떤 이메일이든 인증코드로
-- 로그인/가입 가능(이슈 #137 결정: 학교 이메일 인증 기각). 1회용 코드는 평문 저장하지 않고
-- SHA-256 해시로만 저장한다(server/services/emailAuthService.js).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_login_tokens (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(255) NOT NULL,
  code_hash    VARCHAR(64) NOT NULL,   -- SHA-256(코드) — 평문 코드는 어디에도 저장 안 함
  purpose      VARCHAR(20) NOT NULL DEFAULT 'login',
  attempts     INT NOT NULL DEFAULT 0,  -- 코드 대입 시도 횟수(무차별 대입 방지용 상한)
  expires_at   DATETIME NOT NULL,
  consumed_at  DATETIME NULL,           -- 이미 사용된 코드 재사용 방지
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_email_login_tokens_email (email)
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
  semester          TINYINT NOT NULL,  -- 학사력 시간순 코드: 1=1학기, 2=여름 계절학기, 3=2학기,
                                        -- 4=겨울 계절학기(2026-09 계절학기 지원 도입, db/migrate.js의
                                        -- ensureSeasonSemesterRenumbering 참고). student_courses.semester와
                                        -- 반드시 같은 체계를 써야 카탈로그 검색(연도/학기 매칭)이 안 깨진다.
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
  semester          TINYINT NOT NULL,  -- 학사력 시간순 코드: 1=1학기, 2=여름 계절학기, 3=2학기,
                                        -- 4=겨울 계절학기. course_offerings.semester 주석 참고 —
                                        -- 재수강 판정(courseService.js의 listRetakeEligibleCourses)이
                                        -- "연도,학기 오름차순 정렬 후 마지막 = 최신 성적"으로 판단하므로
                                        -- 이 숫자가 실제 학사력 순서와 어긋나면 그 판정이 틀어진다.

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
  -- 학년도가 달라도 "같은 규정"이면 같은 값 — "학과|카테고리코드|입학유형(없으면 GENERAL)".
  -- 같은 rule_key의 행들은 min/max_admission_year 범위가 겹치지 않는 시간순 버전들이다
  -- (server/services/curriculumKeys.js buildRuleKey). 재시딩하면 id는 바뀌지만 이 값은 그대로.
  rule_key            VARCHAR(150),

  FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_curriculum_requirements_rule_key (rule_key)
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
  -- 학년도가 달라도 "같은 과목"이면 같은 값 — 학수번호가 있으면 "C:학수번호", 없으면
  -- "N:정규화한 과목명" (server/services/curriculumKeys.js buildCourseKey). 과목명·학점·구분이
  -- 바뀌어도 학수번호가 같으면 같은 과목으로 이어진다.
  course_key          VARCHAR(120),

  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id),
  INDEX idx_curriculum_courses_course_key (course_key),
  INDEX idx_curriculum_courses_dept_track_year (department_id, track_id, min_admission_year)
);

-- ---------------------------------------------------------------------------
-- 6.55. 학과·과목 계보 (lineage) — 개편으로 이름/소속이 바뀐 대상의 "이전 → 이후" 관계
--
-- departments는 이름이 UNIQUE인 평면 마스터라 "2025 경영학과가 2026 경영계열 경영학전공이 됐다"는
-- 관계를 담을 곳이 없었다. 학과(+선택적으로 세부전공) 단위의 이전→이후 간선(edge)만 저장한다.
-- 이름이 그대로 이어지는 학과(예: 원불교학과)는 같은 department_id라 간선이 필요 없다.
--
-- relation: RENAME(이름변경) / REORG(개편: 다른 학과·계열의 전공으로 편입) / MERGE(통합: 여러 학과가
--   한 곳으로) / SPLIT(분리: 한 곳이 여러 곳으로) / ABOLISH(폐지: to가 NULL) / REPLACE(대체)
-- effective_year: "이후" 구조가 처음 적용되는 입학학번(예: 2026학번부터 경영계열 → 2026).
-- source: DOC(교육과정 책자·학칙 문서에 명시) / NAME_MATCH(전공명이 학과명과 같아 이름으로 이은 것 — 추정) /
--   MANUAL(사람이 확인해 입력). NAME_MATCH는 챗봇이 "추정"으로 안내해야 한다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_lineage (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  from_department_id INT NULL,   -- NULL이면 신설
  from_track_id      INT NULL,
  to_department_id   INT NULL,   -- NULL이면 폐지
  to_track_id        INT NULL,
  relation           ENUM('RENAME', 'REORG', 'MERGE', 'SPLIT', 'ABOLISH', 'REPLACE') NOT NULL,
  effective_year     INT NOT NULL,
  source             ENUM('DOC', 'NAME_MATCH', 'MANUAL') NOT NULL,
  note               VARCHAR(255),

  FOREIGN KEY (from_department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (from_track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  FOREIGN KEY (to_department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (to_track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  INDEX idx_department_lineage_from (from_department_id, effective_year),
  INDEX idx_department_lineage_to (to_department_id, effective_year)
);

-- 과목 단위 계보. 이름만 바뀐 과목은 course_key(학수번호)가 같아서 간선이 필요 없고
-- curriculum_changes의 course_name 변경으로 남는다. 키 자체가 달라진 경우만 여기에 둔다.
--
-- relation: RENAME(학수번호만 바뀜, 과목명 동일 — 자동 감지) / REPLACE(다른 과목으로 대체) /
--   MERGE(여러 과목 → 하나) / SPLIT(하나 → 여러 과목) / ABOLISH(폐지: to가 NULL)
-- department_id: 이 변경이 일어난 학과(없으면 전체). effective_year는 department_lineage와 같은 의미.
CREATE TABLE IF NOT EXISTS course_lineage (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  from_course_key VARCHAR(120) NULL,   -- NULL이면 신설
  to_course_key   VARCHAR(120) NULL,   -- NULL이면 폐지
  from_name       VARCHAR(100),
  to_name         VARCHAR(100),
  department_id   INT NULL,
  relation        ENUM('RENAME', 'REPLACE', 'MERGE', 'SPLIT', 'ABOLISH') NOT NULL,
  effective_year  INT NOT NULL,
  source          ENUM('AUTO', 'MANUAL') NOT NULL,
  note            VARCHAR(255),

  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  INDEX idx_course_lineage_from (from_course_key),
  INDEX idx_course_lineage_to (to_course_key)
);

-- ---------------------------------------------------------------------------
-- 6.56. 교육과정 변경 이력 — "무엇이 언제 바뀌었나"
--
-- 학년도별 스냅샷(curriculum_requirements/curriculum_courses)을 인접 학번 구간끼리 비교해서
-- 만든다(server/scripts/generateCurriculumChanges.js, source=AUTO — 재실행하면 AUTO 행만 다시 만든다).
-- from_year = 변경 전 값이 마지막으로 적용된 입학학번, to_year = 변경 후 값이 처음 적용된 입학학번.
-- 연속된 학번이 아니어도 된다(예: 2019학번 이후 값이 같다가 2022에 바뀌면 from_year=2021, to_year=2022).
--
-- subject_type/subject_key:
--   REQUIREMENT — rule_key (예: "경영학과|MAJOR_REQUIRED|GENERAL") 또는 합산 키
--                 ("경영학과|GRAD_TOTAL|GENERAL" = 졸업학점 총계, MAJOR_TOTAL, LIBERAL_TOTAL)
--   COURSE      — course_key (예: "C:169041")
--   DEPARTMENT  — 학과 개편(department_lineage 한 건당 한 행)
-- field: required_credits / course_name / credits / category / grade / semester / course_code /
--   existence(ADDED·REMOVED) / structure(학과 개편)
-- successor_*: 학과 개편을 건너 이어진 변경일 때 "이후" 쪽 학과(subject는 "이전" 쪽 학과 기준).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_changes (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  subject_type            ENUM('REQUIREMENT', 'COURSE', 'DEPARTMENT') NOT NULL,
  subject_key             VARCHAR(160) NOT NULL,
  display_name            VARCHAR(150),
  department_id           INT NULL,
  track_id                INT NULL,
  successor_department_id INT NULL,
  successor_track_id      INT NULL,
  from_year               INT NULL,   -- ADDED(신설)이면 NULL
  to_year                 INT NULL,   -- REMOVED(폐지)이면 마지막으로 있던 학번 다음 해(처음 없어진 학번)
  field                   VARCHAR(40) NOT NULL,
  change_type             ENUM('CHANGED', 'ADDED', 'REMOVED') NOT NULL,
  old_value               VARCHAR(255),
  new_value               VARCHAR(255),
  note                    VARCHAR(255),
  source                  ENUM('AUTO', 'MANUAL') NOT NULL,

  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  FOREIGN KEY (successor_department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (successor_track_id) REFERENCES tracks(id) ON DELETE SET NULL,
  INDEX idx_curriculum_changes_subject (subject_type, subject_key),
  INDEX idx_curriculum_changes_dept_year (department_id, to_year)
);

-- ---------------------------------------------------------------------------
-- 6.6. 연계·복합전공 / 마이크로디그리전공 (department_id에 안 묶이는 부가 전공 프로그램)
--
-- 정규 학과 커리큘럼(curriculum_courses)과 달리, 이 두 프로그램은 특정 학과 소속이
-- 아니라 여러 학과가 공동 편성하며 어떤 학과 학생이든 복수전공/부전공(연계·복합전공)
-- 또는 그 자체(마이크로디그리)로 추가 이수할 수 있다. department_id FK를 쓰지 않고
-- 프로그램 단위 독립 테이블로 둔 이유.
--
-- minor_required_credits(연계·복합 부전공 21학점)는 프로그램마다 다르지 않고 전 프로그램
-- 공통(2025_교육과정.pdf 71p "라. 연계·복합 부전공 이수학점은 자기전공 이외의 교과목으로
-- 21학점 이상") - 행마다 반복 저장하지만 애플리케이션에서 하드코딩 상수로 둬도 무방함.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS linked_majors (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  name                      VARCHAR(100) NOT NULL,
  program_group             VARCHAR(50),   -- 일반 / 글로벌K-컬처사업단 / JST공유대학 / K-치유힐링융합인재양성사업단
  required_credits          DECIMAL(4,1),  -- 복수전공으로 이수 시 필요 학점(영역별 이수방법표 기준)
  minor_required_credits    DECIMAL(4,1),  -- 연계·복합 부전공으로 이수 시 필요 학점(자기 전공 외 과목, 전 프로그램 공통 21)
  lead_professor            VARCHAR(50),
  participating_departments VARCHAR(255)   -- 참여학과 목록(자유 텍스트 나열, 구조화 안 함)
);

CREATE TABLE IF NOT EXISTS linked_major_courses (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  linked_major_id      INT NOT NULL,
  semester             VARCHAR(5),
  category             VARCHAR(20) NOT NULL,
  course_code          VARCHAR(20),
  course_name          VARCHAR(100) NOT NULL,
  credits              DECIMAL(3,1),
  offering_department  VARCHAR(50),  -- 주관학부(과)

  FOREIGN KEY (linked_major_id) REFERENCES linked_majors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS micro_degrees (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  program_group     VARCHAR(50),   -- 지방대학활성화사업단 / JST공유대학 / K-치유힐링융합인재양성사업단 / 글로벌K-컬처선도융합인재양성사업단
  required_credits  DECIMAL(4,1),
  lead_professor    VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS micro_degree_courses (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  micro_degree_id      INT NOT NULL,
  semester             VARCHAR(5),
  category             VARCHAR(20) NOT NULL,
  course_code          VARCHAR(20),
  course_name          VARCHAR(100) NOT NULL,
  credits              DECIMAL(3,1),
  offering_department  VARCHAR(50),

  FOREIGN KEY (micro_degree_id) REFERENCES micro_degrees(id) ON DELETE CASCADE
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
  effective_date  DATE,
  -- 교육과정 책자 학년도(예: 2025_교육과정.pdf에서 만든 문서는 2025). 학칙·수강신청 안내처럼 특정 해의 책자가 아닌
  -- "현행 규정" 문서는 NULL. 검색(regulationService.findRelevantChunks)이 질문의 학번/학년도에 맞는 책자만
  -- 고르는 데 쓴다 — 해마다 소제목이 같은 문서가 쌓이면 서로 다른 해의 비슷한 청크가 섞이기 때문.
  book_year       INT NULL,
  INDEX idx_regulation_documents_book_year (book_year)
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
-- 7.5. 규정 판단 엔진 — 조문·판본·적용범위 (server/services/regulationEngine)
--
-- 위 regulation_documents/chunks는 "검색용" 저장소(RAG)라 문서를 청크로 쪼개 임베딩만 갖고, 매 재시딩(--force)마다
-- 통째로 지워졌다 다시 만들어진다. 여기 테이블들은 "판단용" — 어떤 조문이 언제부터 누구에게 적용되는지를 행으로 둔다.
-- 둘을 섞지 않은 이유는 docs/regulation-engine/DECISIONS.md D-24(재시딩 주기·키가 다르고, 섞으면 한쪽 재시딩이 다른 쪽을 지움).
--
-- 시드: server/scripts/seedRegulationArticles.js (npm run seed:regulation-articles). 원문 txt + db/regulation-engine/*.json을
-- 읽어 이 테이블들만 지우고 다시 넣는다(멱등). 레포에는 현행 원문만 있으므로 과거 판본 행은 text_held=0, 날짜는 원문에서
-- 직접 읽은 것만 채우고 모르면 NULL + date_confidence='UNKNOWN'이다(규정 내용을 만들어내지 않기 위함).
-- ---------------------------------------------------------------------------

-- 규정 판본. "학칙 2026-06-26 개정본"처럼 문서(doc_code) × 판본(version_label) 한 건당 한 행.
-- supersedes_version_id: 이 판본이 대체한 직전 판본(원문 부칙으로 확인될 때만). 공포일과 시행일을 따로 두는 이유는
-- 시행규칙(2026.02.05. 공포 → 2026.03.01. 시행)처럼 둘이 다른 경우가 있고, 경과조치 판단은 시행일 기준이기 때문.
CREATE TABLE IF NOT EXISTS regulation_versions (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  doc_code              VARCHAR(40) NOT NULL,   -- ACADEMIC_REGULATIONS / ENFORCEMENT_RULES / CLASS_MANAGEMENT
  title                 VARCHAR(150) NOT NULL,
  version_label         VARCHAR(40) NOT NULL,   -- 부칙 날짜 그대로(예: '2026.06.26.')
  promulgated_on        DATE NULL,
  effective_from        DATE NULL,
  effective_to          DATE NULL,              -- 다음 판본 시행 전날. 현행이면 NULL
  supersedes_version_id INT NULL,
  text_held             TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = 이 판본 본문을 레포에 보유(현행 최종본만 1)
  source_file           VARCHAR(255),
  date_confidence       ENUM('CONFIRMED', 'ESTIMATED', 'UNKNOWN') NOT NULL,
  note                  VARCHAR(255),

  FOREIGN KEY (supersedes_version_id) REFERENCES regulation_versions(id) ON DELETE SET NULL,
  CONSTRAINT uq_regulation_versions UNIQUE (doc_code, version_label)
);

-- 조문 단위 본문. article_key는 판본 안에서 유일한 사람이 읽을 수 있는 키:
--   본문 조문 '제13조', 부칙 조문 '부칙(2026.04.10.)제2조', 별표 하위표 '별표4-3'.
-- amendment_markers: 조문 안의 <개정 YYYY. M. D.>/<신설 ...> 표시를 파싱한 배열([{kind, dates:[...]}, ...]).
-- 표시는 "그 날 이 조문이 바뀌었다"만 알려주고 이전 문구는 알려주지 않으므로, 이전 문구가 필요하면 UNKNOWN으로 다룬다.
CREATE TABLE IF NOT EXISTS regulation_articles (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  version_id        INT NOT NULL,
  article_key       VARCHAR(60) NOT NULL,
  article_no        INT NULL,                -- 본문·부칙 조문 번호(별표는 NULL)
  section           ENUM('BODY', 'ADDENDUM', 'SCHEDULE') NOT NULL,
  title             VARCHAR(200),
  chapter           VARCHAR(100),            -- '제2장 교육과정' 같은 소속 장(본문만)
  body              MEDIUMTEXT NOT NULL,
  amendment_markers JSON,
  last_amended_on   DATE NULL,               -- markers 중 가장 늦은 날짜(없으면 NULL — "개정 없음"이 아니라 "표시 없음")
  ord               INT NOT NULL,            -- 원문 등장 순서

  FOREIGN KEY (version_id) REFERENCES regulation_versions(id) ON DELETE CASCADE,
  CONSTRAINT uq_regulation_articles UNIQUE (version_id, article_key)
);

-- 적용범위. "이 규칙이 누구에게, 언제부터 적용되나"를 조문과 분리해 데이터로 둔다.
-- scope:
--   COHORT_ONLY  — 특정 학번 범위에만(예: 학칙 [별표 4]의 학번별 졸업학점표, 학칙시행규칙 제5조 "입학 당시의 기준")
--   ALL_ENROLLED — 시행일 이후 재학생 전원(예: 제13조① 개편된 신 교육과정은 전 학년 적용)
--   TRANSITIONAL — 경과조치: 조건부로 위 둘 사이를 조정(예: 제13조②~④, 부칙의 "졸업자부터")
-- curriculum_requirements의 min/max_admission_year와 역할이 다르다: 그쪽은 "그 학번 책자에 적힌 값"(스냅샷),
-- 여기는 "개정이 이미 입학한 학번에 소급되는지"(소급·경과조치). DECISIONS.md D-25.
-- condition_code/params: 판단 함수(resolveApplicableRules)가 해석하는 조건 이름과 인자. 새 코드는 함수에 구현이 있어야 한다.
CREATE TABLE IF NOT EXISTS regulation_applicability (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  rule_code          VARCHAR(80) NOT NULL,
  article_id         INT NULL,               -- 시드가 article_ref로 찾아 채운다(못 찾으면 NULL로 두고 경고)
  article_ref        VARCHAR(120) NOT NULL,  -- 'ENFORCEMENT_RULES:제13조' 형식
  paragraph          VARCHAR(20),            -- '①' 등. 조 전체면 NULL
  scope              ENUM('COHORT_ONLY', 'ALL_ENROLLED', 'TRANSITIONAL') NOT NULL,
  applies_from       DATE NULL,              -- 이 규칙이 효력을 갖는 날(모르면 NULL)
  min_admission_year INT NULL,
  max_admission_year INT NULL,
  enrollment_type    ENUM('GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE') NULL,  -- NULL이면 전체
  condition_code     VARCHAR(60),
  condition_params   JSON,
  effect             VARCHAR(255) NOT NULL,  -- 사람이 읽는 효과 요약(원문 인용이 아니라 요약)
  confidence         ENUM('CONFIRMED', 'ESTIMATED', 'UNKNOWN') NOT NULL,
  -- 0이면 결과에 보여주되 전체 신뢰도 계산에서 뺀다(예: 원문을 보유하지 않은 종전 부칙 — 모든 2025학번 이전을
  -- "자료없음"으로 만들지 않고, 학번별 값은 책자 행으로 판단했다는 안내만 남기기 위함).
  critical           TINYINT(1) NOT NULL DEFAULT 1,
  note               VARCHAR(255),

  FOREIGN KEY (article_id) REFERENCES regulation_articles(id) ON DELETE SET NULL,
  CONSTRAINT uq_regulation_applicability_rule UNIQUE (rule_code)
);

-- 문서·조문 사이 관계. REFERS(단순 참조 "제N조에 따른다") / DELEGATES_TO(위임: 학칙 → 시행규칙·별표) /
-- OVERRIDES(특칙이 일반 규정을 덮음) / AMENDS(부칙·개정이 다른 조문을 바꿈).
-- to_article_id로 못 잇는 대상(보유하지 않은 종전 부칙, 다른 규정집)은 to_ref 문자열로만 남긴다.
CREATE TABLE IF NOT EXISTS regulation_relations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  from_article_id INT NOT NULL,
  relation        ENUM('REFERS', 'DELEGATES_TO', 'OVERRIDES', 'AMENDS') NOT NULL,
  to_article_id   INT NULL,
  to_ref          VARCHAR(160),
  source          ENUM('PARSED', 'MANUAL') NOT NULL,
  note            VARCHAR(255),

  FOREIGN KEY (from_article_id) REFERENCES regulation_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (to_article_id) REFERENCES regulation_articles(id) ON DELETE CASCADE,
  INDEX idx_regulation_relations_from (from_article_id),
  INDEX idx_regulation_relations_to (to_article_id)
);

-- 동일과목 지정(학칙시행규칙 제15조). course_lineage(자동 추정한 학수번호 변경)와 분리한 이유: 동일과목은 "학교가 지정한
-- 사실"이라 출처가 문서여야 하고, 자동 추정과 섞이면 추정이 공식 지정처럼 보인다(D-24). 지금은 지정 목록 자료가 없어 비어 있다.
CREATE TABLE IF NOT EXISTS course_equivalences (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  department_id     INT NULL,
  from_course_key   VARCHAR(120) NOT NULL,
  to_course_key     VARCHAR(120) NOT NULL,
  designated_year   INT NULL,
  basis_article_ref VARCHAR(120) NOT NULL DEFAULT 'ENFORCEMENT_RULES:제15조',
  source            ENUM('DOC', 'MANUAL') NOT NULL,
  note              VARCHAR(255),

  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  INDEX idx_course_equivalences_from (from_course_key),
  INDEX idx_course_equivalences_to (to_course_key)
);

-- 이수구분 override(학칙시행규칙 제13조④: 이수구분이 바뀐 과목은 "수강신청한 학년도·학기"의 이수구분을 따른다).
-- 교육과정 스냅샷(curriculum_courses)은 학번 기준이라 "그 과목을 들은 학기의 이수구분"을 직접 표현하지 못해 따로 둔다.
-- 학과가 개별 공지한 예외만 넣는 용도(자동 생성 금지). 지금은 비어 있고, 기본 판단은 curriculum_changes의 category 변경 + 수강 학기로 한다.
CREATE TABLE IF NOT EXISTS course_category_overrides (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  department_id     INT NULL,
  course_key        VARCHAR(120) NOT NULL,
  academic_year     INT NOT NULL,
  semester          TINYINT NULL,           -- NULL이면 그 학년도 전체
  category          VARCHAR(30) NOT NULL,
  basis_article_ref VARCHAR(120) NOT NULL DEFAULT 'ENFORCEMENT_RULES:제13조④',
  source            ENUM('DOC', 'MANUAL') NOT NULL,
  note              VARCHAR(255),

  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  INDEX idx_course_category_overrides_course (course_key, academic_year)
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
-- 9. 진로 탐색 (상담형 진로 추천)
-- 고정 질문 답변을 대화 이력의 앞부분으로 흡수하고, 그 뒤로 자유 대화를 이어 붙이는 단일
-- 트랜스크립트 구조(chat_conversations/chat_messages와 동일 패턴)로 설계 — 고정 질문 자체는
-- 프론트에 하드코딩된 정적 문항이라 별도 테이블이 필요 없다.
--
-- status: IN_PROGRESS(대화 중) → CANDIDATES_READY(후보 제시됨) → CONFIRMED(진로 확정 + 로드맵 생성됨)
-- confirmed_career: 확정 시 career_candidates 중 선택된 진로명을 그대로 복사(간단 참조용)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS career_sessions (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        INT NOT NULL,
  status            ENUM('IN_PROGRESS', 'CANDIDATES_READY', 'CONFIRMED') NOT NULL DEFAULT 'IN_PROGRESS',
  confirmed_career  VARCHAR(100),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS career_messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NOT NULL,
  role        VARCHAR(20) NOT NULL,  -- user / assistant
  content     TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id) REFERENCES career_sessions(id) ON DELETE CASCADE
);

-- AI가 대화를 종합해 제시하는 진로 후보. sort_order로 제시 순서(가장 적합한 순) 유지.
CREATE TABLE IF NOT EXISTS career_candidates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NOT NULL,
  career_name VARCHAR(100) NOT NULL,
  reasoning   TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,

  FOREIGN KEY (session_id) REFERENCES career_sessions(id) ON DELETE CASCADE
);

-- 확정된 진로에 맞춰 추천하는, 아직 안 들은 과목 로드맵. course_name은 curriculum_courses에
-- 실제로 존재하는 값만 저장(서버에서 그라운딩 검증 후 필터링) — AI가 지어낸 과목명이 섞이지 않게 함.
CREATE TABLE IF NOT EXISTS career_roadmap_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  session_id   INT NOT NULL,
  grade        TINYINT NOT NULL,
  semester     TINYINT NOT NULL,
  course_name  VARCHAR(100) NOT NULL,
  reason       TEXT,
  sort_order   INT NOT NULL DEFAULT 0,

  FOREIGN KEY (session_id) REFERENCES career_sessions(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 10. 커뮤니티 게시판 (스터디/프로젝트 모집, 관리자 승인제)
-- 닉네임만 공개하고(students.name 폴백 재사용), 매칭 성사 시에만 서로 연락처를 공개해
-- 이후 소통은 당사자끼리 한다 — 1:1 채팅 없음. 연락처는 실제 이메일이 아니라 프록시 주소다
-- (community_email_proxies 참고, #182). 글은 관리자 승인 전엔 비공개(status=
-- 'pending')이고, 승인 후에도 글쓴이가 "모집 마감"(closed_at)으로 직접 닫을 수 있다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_posts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  author_id    INT NOT NULL,
  title        VARCHAR(100) NOT NULL,
  body         TEXT NOT NULL,
  category     VARCHAR(20) NOT NULL DEFAULT 'study',  -- study(스터디) / project(프로젝트)
  capacity     INT NULL,  -- 모집 인원(선택, 정보 표시용 — 자동 마감 등 강제 로직은 없음)
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
  closed_at    DATETIME NULL,  -- NULL = 모집 중, 값 있음 = 글쓴이가 마감
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decided_at   DATETIME NULL,  -- 관리자가 승인/반려한 시각
  reject_reason TEXT NULL,  -- 반려 시 관리자가 남긴 사유(선택, decidePost가 매 결정마다 덮어씀 —
                            -- 승인 시 NULL). status가 pending/approved일 땐 화면에서 안 보여주므로
                            -- 수정 후 재검토 대기 중에 이전 반려 사유가 남아있어도 노출되지 않는다.
  -- 모집 마감일(선택, 날짜 단위). NULL이면 기간 없이 글쓴이가 직접 마감할 때까지 모집. 마감일이 지나면(마감일 당일까지는 모집)
  -- 신청 불가·목록에서 "마감"으로 표시된다("기간 마감" — 글쓴이가 따로 마감하지 않아도 판정만 달라지고 closed_at은
  -- 건드리지 않는다). 글 작성·수정 시 오늘부터 1년 이내만 받는다(routes/community.js). 마감일을 바꾸는 수정은 글 수정이라
  -- 관리자 재승인 대상이다(editPost). DATETIME이 아니라 DATE인 이유: 화면이 날짜만 받고, 서버 DB 시간대(UTC)와 한국
  -- 날짜가 어긋나는 문제를 피하려고 "오늘"을 앱(KST)에서 계산해 넘기기 때문이다.
  recruit_end_date   DATE NULL,

  FOREIGN KEY (author_id) REFERENCES students(id) ON DELETE CASCADE,
  -- status는 FK가 아니라 자동 인덱스가 안 붙는다. listApprovedPosts/listPostsForAdmin이
  -- status 단독으로 필터링하는데 게시글이 늘어나면 풀스캔이 되므로 명시적으로 인덱스를 건다.
  INDEX idx_community_posts_status (status)
);

-- 신청 메시지는 글쓴이만 볼 수 있음(비공개).
CREATE TABLE IF NOT EXISTS community_applications (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  post_id        INT NOT NULL,
  applicant_id   INT NOT NULL,
  message        TEXT NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / accepted / rejected
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decided_at     DATETIME NULL,
  reject_reason  TEXT NULL,  -- 거부 시 글쓴이가 남긴 메시지(선택). 수락 시엔 항상 NULL.

  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (applicant_id) REFERENCES students(id) ON DELETE CASCADE
);

-- 신청 수락(매칭 성사) 시 신청자·글쓴이 각각을 위해 한 쌍(2행)으로 생성되는 프록시 이메일
-- (#182). owner_id는 "이 프록시로 온 메일을 실제로 받을 사람" — 신청자에게 보여줄
-- 프록시는 owner_id=글쓴이, 글쓴이에게 보여줄 프록시는 owner_id=신청자다. proxy_email은
-- 실제 주소와 무관한 무작위 토큰(communityService.generateProxyEmail)이라 역추적 단서가
-- 되지 않는다. Resend 인바운드 웹훅(server/routes/emailRelay.js, 2단계)이 이 매핑으로
-- 실제 수신자를 찾아 forward한다.
CREATE TABLE IF NOT EXISTS community_email_proxies (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  owner_id       INT NOT NULL,
  proxy_email    VARCHAR(255) NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_community_email_proxies_email (proxy_email),
  FOREIGN KEY (application_id) REFERENCES community_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES students(id) ON DELETE CASCADE
);

-- 커뮤니티 글/신청 메시지 신고(#187). target_type으로 대상 테이블을 구분하는 다형(polymorphic)
-- 참조라 target_id에 DB 레벨 FK를 걸 수 없다(한 컬럼이 서로 다른 두 테이블을 가리켜야 함) —
-- 대상 존재 여부/유효성은 communityService.createReport가 애플리케이션 레벨에서 검증한다.
CREATE TABLE IF NOT EXISTS community_reports (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id          INT NOT NULL,
  target_type          VARCHAR(20) NOT NULL,  -- 'post' / 'application'
  target_id            INT NOT NULL,
  -- 신고 접수 시점에 찍어두는 스냅샷(#201) — 원본 글/신청이 나중에 삭제(제재 조치 등)돼도
  -- "누구를, 무엇 때문에" 신고했는지 계속 확인할 수 있어야 해서 target_id의 실시간 JOIN에
  -- 의존하지 않는다. reported_student_id는 글 신고면 작성자, 신청 신고면 신청자.
  reported_student_id  INT NULL,
  target_title         VARCHAR(50) NULL,  -- 글 제목(신청 신고면 그 신청이 달린 글의 제목)
  target_body          TEXT NULL,          -- 글 본문 또는 신청 메시지
  reason               TEXT NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / resolved
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at          DATETIME NULL,
  -- 관리자가 처리 완료할 때 신고자에게 남기는 안내(선택). 신고자 본인 화면("내 신고 내역")에만 보인다. 신고 대상자에게는
  -- 나가지 않는다. NULL이면 화면이 기본 안내 문구를 보여준다.
  resolution_note      TEXT NULL,
  -- 신고자가 처리 결과를 확인한 시각. status='resolved'인데 NULL이면 "읽지 않은 처리 결과"(커뮤니티 탭 점 표시).
  resolution_seen_at   DATETIME NULL,

  FOREIGN KEY (reporter_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_student_id) REFERENCES students(id) ON DELETE SET NULL,
  -- community_posts.status와 동일한 이유 — listReportsForAdmin이 status 단독으로 필터링함.
  INDEX idx_community_reports_status (status)
);

-- ---------------------------------------------------------------------------
-- 10-1. 사용자 제재 (#201) — 커뮤니티 신고에서 이어지는 계정 단위 조치(정지).
-- students 컬럼이 아니라 별도 테이블로 둔 이유: 이력이 남아야 하고(관리자가 신고와 무관하게
-- 직접 내리는 조치도 있을 수 있음), 한 계정에 여러 번 제재가 쌓일 수 있어서다. "지금 유효한
-- 제재"는 lifted_at이 비어있고 ends_at이 지나지 않은 것 중 가장 최근 것 하나로 판단한다
-- (server/services/sanctionService.js).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_sanctions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_id    INT NOT NULL,
  reason        TEXT NOT NULL,
  scope         VARCHAR(20) NOT NULL,  -- 'post_apply'(글쓰기·신청만 금지) / 'full'(커뮤니티 진입 자체 차단)
  starts_at     DATETIME NOT NULL,
  ends_at       DATETIME NULL,          -- NULL = 영구정지
  lifted_at     DATETIME NULL,          -- 관리자가 조기 해제한 시각
  created_by    INT NOT NULL,           -- 제재를 건 관리자 id
  report_id     INT NULL,               -- 신고함에서 이어진 조치면 그 신고 id
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES students(id),
  FOREIGN KEY (report_id) REFERENCES community_reports(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 11. 문의하기 (#166 — 버그/문제 제보, 커뮤니티와 무관한 범용 채널)
-- 스크린샷 등 첨부파일은 1차 스코프에서 제외(텍스트만) — Railway 파일시스템이 재배포마다
-- 초기화되는 임시 저장소라 별도 스토리지 연동 없이는 첨부를 못 남긴다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inquiries (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  student_id   INT NOT NULL,
  title        VARCHAR(50) NOT NULL,
  content      TEXT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'open',  -- open / resolved
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at  DATETIME NULL,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 12. 계정별 최근 활동 시각 (관리자 대시보드 "현재 접속자")
-- sessions 테이블(3-1)의 만료 안 된 행 개수는 최근 30일 내 로그인 세션 수일 뿐 실시간 접속
-- 여부와 무관해서(SESSION_MAX_AGE_MS 30일), "현재 접속자"라는 라벨과 실제 값이 크게 어긋나는
-- 문제가 있었다. 계정별로 마지막 요청 시각만 별도로 기록해두고, 최근 N분 내 값이 있는 계정
-- 수를 세는 방식으로 바꾼다(server/middleware/activityTracker.js).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_activity (
  student_id    INT PRIMARY KEY,
  last_seen_at  DATETIME NOT NULL,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 13. PDF 가져오기 사용 로그 (학기당 5회 한도 판정용)
-- /api/my-courses/import/pdf가 pdfImportService(Claude API 호출)로 파싱할 때마다 한 행씩
-- 남긴다 — 실제 학점 반영은 /import/confirm에서 별도로 하지만, 비용이 드는 지점은 파싱
-- 단계라 여기서 카운트한다. period는 server/services/courseService.js의
-- getCurrentAcademicPeriod()가 만드는 값('YYYY-1'/'YYYY-2', 3~8월=1학기·9~12월=2학기·
-- 1~2월=전년도 2학기)과 반드시 같은 형식이어야 한다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pdf_import_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  student_id  INT NOT NULL,
  period      VARCHAR(10) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
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
