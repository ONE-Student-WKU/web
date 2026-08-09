# API 설계 (v4.0 — 피벗판)

> 기존 v3.5는 원광대 인트라넷 전 영역(학적/시간표/수업/출결/성적/등록)을 mock으로 재현하는 설계였습니다.
> 실제 학교 데이터를 가져올 수 없어 전부 허구였던 한계 때문에, **학생이 직접 입력한 자기 학사정보 + 원광대 실제 학칙·이수규정을 근거로 답하는 AI**로 방향을 바꿨습니다 (에브리타임 + 학칙 RAG 챗봇).
> 완성해야 할 화면은 **4개**뿐입니다: 로그인, 홈(AI 챗봇), 과목 관리(목록형·시간표형·성적요약 통합), 졸업요건 진단.

## 0. 공통 규칙

### 0.1 응답 포맷
```json
{
  "status": 200,
  "code": "STRING_CODE",
  "message": null,
  "data": { }
}
```
- `status`: HTTP 상태 코드와 동일
- `code`: SCREAMING_SNAKE_CASE, 화면별 고유값
- `data`: 성공 시 payload, 실패 시 보통 `null`

### 0.2 공통 에러 코드
| status | code | 설명 |
|---|---|---|
| 401 | UNAUTHORIZED | 로그인 필요 |
| 500 | INTERNAL_SERVER_ERROR | 서버 오류 |

### 0.3 인증
세션 기반 (`req.session.userId`), `requireAuth` 미들웨어 적용. 로그인은 **이메일 + 비밀번호** 방식 (원광대 웹정보 로그인과 동일한 느낌).

### 0.4 스코프 밖 (다루지 않음)
휴학/복학, 자퇴, 환불, 등록금 고지서, 전자출결관리, 공결 신청, 수업평가, 교수 시간표 검색, 강의계획서 검색, 홈 바로가기 커스터마이징, 공지사항 — 전부 이번 설계에서 제외합니다. mock 신청 플로우 자체가 무의미하다고 판단했습니다.

### 0.5 AI 챗봇 답변 원칙 (확정)
- **근거 문서(학칙/이수규정 청크)에 없는 내용은 "정확히 모른다"고 답합니다.** 임의 해석 금지.
- 답변에는 근거가 된 `regulation_chunks`를 인용 형태로 함께 반환합니다 (화면에 "출처: 학칙 O조" 형태로 표시).
- 학생 개인 데이터(수강과목/성적)가 필요한 질문은 `student_courses`, `curriculum_requirements`를 함께 조회해 답변에 반영합니다.
- 이 서비스는 비공식 참고용이며, 확정적 의사결정(휴학 등)은 반드시 학교 공식 채널로 재확인하도록 안내 문구를 포함합니다.

---

## 1. 인증

### 1.1 회원가입
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/auth/signup` | `email, password, name` | 이메일 UNIQUE. 가입은 최소 정보만 받고, 학과/입학년도/편입여부는 가입 후 [1.3 온보딩](#13-온보딩)에서 별도로 받음 |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"SIGNUP_SUCCESS", "data":{ "id":1, "email":"hong@example.com", "name":"홍길동", "onboardingCompleted":false } }` |
| 409 | `{ "status":409, "code":"EMAIL_ALREADY_EXISTS", "data":null }` |
| 400 | `{ "status":400, "code":"REQUIRED_EMAIL", "data":null }` / `REQUIRED_PASSWORD` / `REQUIRED_NAME` |

### 1.2 로그인 / 로그아웃
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/auth/login` | `email, password` | 성공 시 세션 발급. `onboardingCompleted:false`면 프론트가 온보딩 화면으로 보냄 |
| POST | `/api/auth/logout` | - | 세션 종료 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"LOGIN_SUCCESS", "data":{ "id":1, "email":"hong@example.com", "name":"홍길동", "onboardingCompleted":true } }` |
| 401 | `{ "status":401, "code":"INVALID_CREDENTIALS", "data":null }` |
| 200 | `{ "status":200, "code":"LOGOUT_SUCCESS", "data":null }` |

### 1.3 온보딩
> 가입 직후 1회 진행하는 추가 정보 입력. 학과는 현재 1개(컴퓨터·소프트웨어공학과)뿐이지만, 학과가 늘어날 걸 대비해 고정 텍스트 대신 드롭다운 선택형으로 둠. 입학년도/편입 여부는 학번별로 이수규정이 갈리는 경우가 있어 [졸업요건 진단](#4-졸업요건-진단)에서 사용.

| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/onboarding/departments` | - | 학과 선택 드롭다운용 목록 (현재 1건) |
| POST | `/api/onboarding` | `departmentId, admissionYear, enrollmentType` | `enrollmentType`: `GENERAL`(일반재학생) / `TRANSFER_ADMISSION`(편입생) / `MAJOR_CHANGE`(전과생). `requireAuth` 필요 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"DEPARTMENTS_SUCCESS", "data":[ { "id":1, "name":"컴퓨터·소프트웨어공학과" } ] }` |
| 200 | `{ "status":200, "code":"ONBOARDING_SUCCESS", "data":{ "departmentId":1, "admissionYear":2023, "enrollmentType":"GENERAL" } }` |
| 400 | `REQUIRED_DEPARTMENT_ID` / `REQUIRED_ADMISSION_YEAR` / `REQUIRED_ENROLLMENT_TYPE` / `INVALID_ENROLLMENT_TYPE` |
| 409 | `{ "status":409, "code":"ONBOARDING_ALREADY_COMPLETED", "data":null }` — 이미 온보딩 끝낸 계정이 재요청한 경우 (**확정 필요** — 수정 허용할지 논의 필요) |

---

## 2. 홈 · AI 챗봇

### 2.1 내 프로필 조회
| Request method | url | 설명 |
|---|---|---|
| GET | `/api/me` | 홈 화면 인사말/헤더용 기본 정보 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"ME_SUCCESS", "data":{ "id":1, "name":"홍길동", "department":"컴퓨터·소프트웨어공학과", "onboardingCompleted":true, "admissionYear":2023, "enrollmentType":"GENERAL" } }` |

### 2.2 챗봇 대화
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/chat/conversations/current` | - | 가장 최근 대화(`last_active_at` 기준) 이어서 조회, 없으면 새로 생성 |
| POST | `/api/chat/messages` | `conversationId, message` | 질문 전송. 서버는 (1) 질문을 임베딩 → `regulation_chunks` 유사도 검색, (2) 필요 시 `student_courses`/`curriculum_requirements` 조회, (3) Claude API 호출 후 응답 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"CHAT_MESSAGE_SUCCESS", "data":{ "role":"assistant", "content":"전공필수 3과목이 더 필요해요.", "citedChunks":[ { "chunkId":12, "documentTitle":"컴퓨터·소프트웨어공학과 이수규정", "excerpt":"..." } ] } }` |
| 200 | `{ "status":200, "code":"NO_GROUNDING_FOUND", "data":{ "role":"assistant", "content":"관련 규정을 찾지 못했어요. 학사지원과에 직접 확인해주세요." } }` — 근거 문서에서 못 찾았을 때 (0.5 원칙) |

---

## 3. 과목 관리 (목록형 · 시간표형 · 성적요약 통합)

### 3.1 개설과목 카탈로그 검색
| Request method | url | query | 설명 |
|---|---|---|---|
| GET | `/api/courses/catalog?keyword=` | `keyword` | 과목 추가 시 검색해서 담기용. 실제 개설과목 카탈로그(현재 51건) 기준 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"CATALOG_SEARCH_SUCCESS", "data":[ { "courseId":"374124-01", "name":"빅데이터", "professor":"이상원", "credits":3, "schedule":[{"day":"월","period":1},{"day":"월","period":2}] } ] }` |

> ~~카탈로그의 요일/교시 데이터는 아직 미수집 상태~~ → `course_schedules` 테이블에 133건 시딩 완료되어 있어 `schedule` 필드는 이 테이블과 조인해서 채웁니다 (해결됨).

### 3.2 내 수강·성적 목록 조회 / 추가 / 수정 / 삭제
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/my-courses?year=&semester=` | - | 목록형 화면. 생략 시 전체 학기 반환 |
| POST | `/api/my-courses` | `courseId, year, semester` | 카탈로그에서 검색한 과목을 내 목록에 추가 |
| PATCH | `/api/my-courses/:id` | `midterm?, final?, attendanceScore?, assignment?, etc?, letterGrade?` | 성적 직접 입력/수정 |
| DELETE | `/api/my-courses/:id` | - | 잘못 추가한 과목 삭제 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"MY_COURSES_SUCCESS", "data":[ { "id":10, "courseId":"374124-01", "name":"빅데이터", "professor":"이상원", "credits":3, "year":2026, "semester":2, "midterm":38.0, "final":40.0, "letterGrade":"A+" } ] }` |
| 201 | `{ "status":201, "code":"MY_COURSE_ADD_SUCCESS", "data":{ "id":10 } }` |
| 400 | `REQUIRED_COURSE_ID` / `REQUIRED_YEAR` / `REQUIRED_SEMESTER` (POST) |
| 404 | `{ "status":404, "code":"COURSE_NOT_FOUND", "data":null }` — POST 시 카탈로그에 없는 `courseId` |
| 409 | `{ "status":409, "code":"COURSE_ALREADY_ADDED", "data":null }` — 같은 학기 같은 과목 중복 추가 (POST) |
| 404 | `{ "status":404, "code":"MY_COURSE_NOT_FOUND", "data":null }` — PATCH/DELETE 대상이 없거나 본인 소유가 아님 |
| 200 | `{ "status":200, "code":"MY_COURSE_UPDATE_SUCCESS", "data":{ "id":10 } }` (PATCH) |
| 200 | `{ "status":200, "code":"MY_COURSE_DELETE_SUCCESS", "data":null }` (DELETE) |
| 400 | `{ "status":400, "code":"INVALID_LETTER_GRADE", "data":null }` — 정의된 학점 값(`A+/A0/B+/B0/C+/C0/D+/D0/F`) 밖의 값 |

### 3.3 시간표형 조회
| Request method | url | query | 설명 |
|---|---|---|---|
| GET | `/api/my-courses/timetable?year=&semester=` | `year, semester` | 3.2의 같은 데이터를 요일/교시 그리드 형태로 재구성해서 반환 (3.1의 `schedule` 필드 활용) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"TIMETABLE_SUCCESS", "data":[ { "day":"월", "period":1, "courseId":"374124-01", "name":"빅데이터" } ] }` |

### 3.4 전체 성적 요약
| Request method | url | 설명 |
|---|---|---|
| GET | `/api/my-courses/summary` | 학기별 취득학점/평균평점. 3.2 데이터를 `year, semester` 기준 집계 (별도 테이블 없이 계산) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"GRADE_SUMMARY_SUCCESS", "data":{ "bySemester":[ { "year":2026, "semester":2, "earnedCredits":15, "gpa":4.1 } ], "total":{ "earnedCredits":15, "gpa":4.1 } } }` |

---

## 4. 졸업요건 진단

### 4.1 졸업요건 진단 조회
| Request method | url | 설명 |
|---|---|---|
| GET | `/api/graduation-check` | 내 수강 이력(3.2)을 `curriculum_requirements`와 대조해서 카테고리별 진행률 계산 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"GRADUATION_CHECK_SUCCESS", "data":{ "categories":[ { "category":"전공필수", "requiredCredits":42, "earnedCredits":30, "remainingCredits":12, "missingCourses":["운영체제","데이터통신"] } ], "totalRemainingCredits":12 } }` |

> 이수규정 자체가 아직 미수집 상태입니다 — `curriculum_requirements`/`curriculum_required_courses` 시드는 컴퓨터·소프트웨어공학과 이수규정 원문 확보 후 채웁니다.

---

## 5. 남은 확인 사항
- 카탈로그 51개 과목의 요일/교시 데이터 재수집 필요 (3.1 참고)
- 컴퓨터·소프트웨어공학과 이수규정 원문 확보 필요 (4.1 참고)
- 학칙 원문 확보 및 청크 분할 방식 확정 필요 (`regulation_chunks`, ERD 설계 참고)
- Claude API 모델 티어(Haiku/Sonnet) 및 임베딩 모델 선정
