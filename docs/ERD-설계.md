# ERD 설계 (v4.0 — 피벗판)

> [API 설계](./API-설계.md) v4.0의 각 섹션 번호를 근거로 작성했습니다.
> 기존 v3.5(colleges/departments/professors/templates/course_offerings 등 20여 개 테이블, 인트라넷 전 영역)는 전부 폐기합니다.
> 컴퓨터·소프트웨어공학과 1개 학과, 화면 4개(로그인/홈/과목 관리/졸업요건 진단) 스코프에 맞춰 **10개 테이블**로 대폭 축소했습니다. MySQL 문법 기준.

## 1. 전체 구조 개요

| 테이블 | 설명 | 관계 |
|---|---|---|
| `students` | 학생 계정 | 아래 개인 데이터 전체(1:N) |
| `courses` | 개설과목 카탈로그 (분반 단위, 현재 51건) | course_schedules(1:N), student_courses(1:N) |
| `course_schedules` | 과목별 요일/교시 | courses(N:1) |
| `student_courses` | 내 수강·성적 (통합) | students/courses(N:1) |
| `curriculum_requirements` | 졸업 이수요건 카테고리·기준학점 | curriculum_required_courses(1:N) |
| `curriculum_required_courses` | 카테고리별 필수 지정 과목 | curriculum_requirements(N:1) |
| `regulation_documents` | 학칙·이수규정 원문 메타 | regulation_chunks(1:N) |
| `regulation_chunks` | RAG 검색 대상 텍스트 조각 | regulation_documents(N:1) |
| `chat_conversations` | 챗봇 대화방 | students(N:1), chat_messages(1:N) |
| `chat_messages` | 챗봇 대화 메시지 (근거 인용 포함) | chat_conversations(N:1) |

`colleges`/`departments`/`professors`/`templates`/`course_offerings`/`leave_requests`/`withdrawal_requests`/`refund_requests`/`tuition_*`/`attendance_records`/`official_leave_requests`/`course_evaluations`/`completed_course_items`/`home_shortcuts`/`shortcut_catalog`/`academic_calendar`는 전부 폐기 — 스코프에서 빠진 기능(학적변동/출결/등록금/교수시간표검색/수업평가/홈바로가기/공지사항)에만 쓰이던 테이블입니다.

---

## 2. 학생 계정

```sql
CREATE TABLE students (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  password      VARCHAR(255) NOT NULL,
  name          VARCHAR(50) NOT NULL,
  department    VARCHAR(100) DEFAULT '컴퓨터·소프트웨어공학과',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_students_email UNIQUE (email)
);
```
- API 명세: 1.1(회원가입), 1.2(로그인), 2.1(`/api/me`)
- `department`는 현재 학과가 1개뿐이라 별도 마스터 테이블 없이 고정 텍스트로 저장 (v3.5의 `colleges`/`departments`/`departments_id` FK 구조 폐기)
- 로그인은 `email` 기준(UNIQUE) — 학번 자동발급 로직도 폐기 (더 이상 학번 식별이 필요한 학적 관련 화면이 없음)

---

## 3. 과목 카탈로그

```sql
CREATE TABLE courses (
  id         VARCHAR(20) PRIMARY KEY,  -- "374124-01" (학수번호-분반)
  name       VARCHAR(100) NOT NULL,
  professor  VARCHAR(50),
  credits    DECIMAL(2,1) NOT NULL,
  category   VARCHAR(20)  -- 기전/선전/교필/교선 등
);

CREATE TABLE course_schedules (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  course_id   VARCHAR(20) NOT NULL,
  day         VARCHAR(10) NOT NULL,  -- 월/화/수/목/금
  period      INT NOT NULL,

  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
```
- API 명세: 3.1(카탈로그 검색), 3.3(시간표형 조회)
- `courses.id`: v3.5의 `course_offerings` surrogate PK + 복합 UNIQUE 구조 대신, 기존 `db/seed/courses.json`에서 이미 쓰던 `학수번호-분반` 문자열 PK를 그대로 사용 (학기별 개설강좌 버전 관리가 더 이상 필요 없어서 단순화)
- `course_schedules`: 한 과목이 주 2회 이상 수업하면 행이 여러 개 (`"월34화2"` 같은 문자열 대신 행 단위 분리)
- **미수집 상태**: 현재 `courses.json`(51건)에는 `professor`/`credits`만 있고 `day`/`period`가 없음 — 원본 화면 캡처에서 요일/교시를 다시 옮겨야 시드 가능

---

## 4. 내 수강·성적 (통합)

```sql
CREATE TABLE student_courses (
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
  FOREIGN KEY (course_id) REFERENCES courses(id)
);
```
- API 명세: 3.2(목록 조회/추가/수정/삭제), 3.4(전체 성적 요약)
- v3.5의 `student_courses`(등록 여부만) + `grades`(점수) 두 테이블을 **한 테이블로 통합** — Figma에서 "과목 관리" 화면 자체를 하나로 합치기로 한 결정과 대응
- 점수 컬럼은 전부 NULL 허용 — 학기 초 과목만 추가하고 성적은 나중에 입력하는 경우 지원
- 학기별 집계(3.4)는 이 테이블을 `year`/`semester`로 `GROUP BY`해서 계산, 별도 요약 테이블 없음

---

## 5. 졸업 이수요건

```sql
CREATE TABLE curriculum_requirements (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  category          VARCHAR(30) NOT NULL,  -- 전공필수/전공선택/교양필수/교양선택/일반선택
  required_credits  DECIMAL(4,1) NOT NULL,
  description       VARCHAR(255)
);

CREATE TABLE curriculum_required_courses (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  requirement_id INT NOT NULL,
  course_name    VARCHAR(100) NOT NULL,

  FOREIGN KEY (requirement_id) REFERENCES curriculum_requirements(id) ON DELETE CASCADE
);
```
- API 명세: 4.1(졸업요건 진단)
- `curriculum_required_courses.course_name`을 과목명 텍스트로 둔 이유: 이수규정 원문이 학수번호 대신 과목명으로 필수과목을 지정하는 경우가 많아서. 원문 확보 후 학수번호 매칭이 가능하면 `courses.id` FK로 바꾸는 것 검토
- **미수집 상태**: 컴퓨터·소프트웨어공학과 이수규정 원문 확보 전까지 이 두 테이블은 빈 상태

---

## 6. 학칙·규정 문서 (AI 챗봇 RAG)

```sql
CREATE TABLE regulation_documents (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  title          VARCHAR(255) NOT NULL,
  category       VARCHAR(30),  -- 학칙 / 이수규정 등
  source_url     VARCHAR(500),
  effective_date DATE
);

CREATE TABLE regulation_chunks (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  document_id   INT NOT NULL,
  chunk_index   INT NOT NULL,
  content       TEXT NOT NULL,

  FOREIGN KEY (document_id) REFERENCES regulation_documents(id) ON DELETE CASCADE
);
```
- API 명세: 2.2(챗봇 대화), 0.5(근거 없으면 모른다고 답하기 원칙)
- `regulation_documents.effective_date`: 원문 개정 시 수동 갱신하는 걸 감안해 "이 데이터가 언제 기준인지" 표시용 (기획서에서 논의한 데이터 최신성 리스크 대응)
- 임베딩 벡터 저장 방식(별도 컬럼 vs 파일/외부 스토어)은 구현 단계에서 결정 — 이 문서는 텍스트 원본 구조까지만 확정

---

## 7. 챗봇 대화

```sql
CREATE TABLE chat_conversations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  student_id      INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id   INT NOT NULL,
  role              VARCHAR(20) NOT NULL,  -- user / assistant
  content           TEXT,
  cited_chunk_ids   JSON,  -- regulation_chunks.id 배열, 근거 표시 UI용

  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);
```
- API 명세: 2.2(챗봇 대화)
- `cited_chunk_ids`: 답변마다 근거로 쓴 청크를 기록해서, 화면에서 "출처 보기" 클릭 시 원문을 다시 보여줄 수 있게 함

---

## 8. 남은 확인 사항
- 과목 카탈로그 51건의 요일/교시 재수집
- 컴퓨터·소프트웨어공학과 이수규정 원문 확보 및 `curriculum_requirements`/`curriculum_required_courses` 시드
- 학칙 원문 확보, 청크 분할 기준(조항 단위 등) 확정, `regulation_documents`/`regulation_chunks` 시드
- 임베딩 저장/검색 방식 확정 (구현 단계)
- 실제 마이그레이션(`db/schema.sql`)은 위 미수집 데이터가 어느 정도 채워진 뒤 별도로 작성 — 이 문서는 구조 확정용
