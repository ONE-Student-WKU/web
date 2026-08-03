# API 설계 (초안 v3.5)

> [Home](Home)의 기능 리스트 + 화면 목업을 근거로 작성했습니다.
> 이 프로젝트는 **mock 데이터 기반의 예시 시스템**입니다. "신청" 버튼을 누르면 실제 인트라넷에 신청되는 게 아니라, 이 시스템 DB 안에서 마치 신청이 접수된 것처럼 상태만 바뀝니다. **승인자가 존재하지 않으므로 승인/반려 액션은 설계에 포함하지 않습니다.**
> 이번 버전부터 **실제 회원가입/로그인** 기능이 이 문서 범위에 들어왔습니다. 신규 가입 학생 데이터는 "템플릿 배정" 방식(컴퓨터·소프트웨어공학과 10개 과목)으로 확정했습니다 (`0.7` 참고).

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
- `status` : HTTP 상태 코드와 동일한 값
- `code` : SCREAMING_SNAKE_CASE. 화면/상황별로 고유하게 부여해서 프론트가 이 값만 보고 분기 처리
- `message` : 사람이 읽는 문구. 프론트가 `code → 안내 문구` 매핑을 갖고 있으면 `null`로 내려도 됨
- `data` : 성공 시 payload, 실패 시 보통 `null`

> "환불대상자가 아닙니다", "수업 평가 기간이 아닙니다" 같은 안내는 사용자 잘못이 아닌 상태 안내이므로 `status:200` + 상황별 `code`로 표현합니다.

### 0.2 공통 에러 코드
아래는 모든 API에 공통 적용되며, 이후 각 엔드포인트 표에서는 생략합니다.
| status | code | 설명 |
|---|---|---|
| 401 | UNAUTHORIZED | 로그인 필요 |
| 500 | INTERNAL_SERVER_ERROR | 서버 오류 |

필수값 검증은 **필드별로 세분화된 코드**(`REQUIRED_REASON`, `REQUIRED_CHANGE_TYPE` 등)를 사용합니다 (`VALIDATION_ERROR` 하나로 뭉치지 않음 — 확정).

### 0.3 인증
세션 기반 (`req.session.userId`), `requireAuth` 미들웨어 적용. **회원가입/로그인은 이 앱의 실제 기능**이라 이 문서에 포함합니다 (자세한 내용은 [1. 인증](#1-인증)). 단, "비밀번호 변경"만 외부 사이트 클론 영역이라 제외.

### 0.4 첨부파일
**이번 스코프에서 제외 (후순위 기능).** 휴복학/자퇴/공결/환불 신청 모두 첨부파일 없이 텍스트 사유만 받습니다.

### 0.5 "신청" 계열 공통 규칙
- 승인자가 없는 mock 환경이므로, 신청 API는 상태를 `PENDING`으로 바꾸는 것까지만 처리합니다. `APPROVED`로 바뀌는 승인 액션은 만들지 않습니다.
- 동일 유형으로 이미 `PENDING`인 신청이 있으면 재신청은 `409 ALREADY_PENDING_REQUEST` (**1건만 허용, 확정**).
- 취소(신청철회)는 정해진 신청기간 내 + `PENDING` 상태일 때만 가능하며, 취소 흐름 자체는 데모에서 보여줄 예정이라 DELETE API를 유지합니다 (**확정**).
- **기간 판단**: `GET` 목록/조회 API는 기간과 무관하게 있는 데이터를 그대로 반환합니다. "지금 신청 가능한 기간인지"는 프론트가 [0.6의 `academic_calendar`](#06-새로-필요한-데이터-모델)를 별도로 조회해서 배너/버튼 비활성화로 안내합니다. 실제 `POST`(신청) 시점에는 서버가 한 번 더 검증해서 기간이 아니면 `200 NOT_IN_XXX_PERIOD`로 막습니다.
- **학기 파라미터(`year`/`semester`)**: 이번 1차 스코프에서는 로그인 학생의 **현재 학기 기준으로 고정**해서 응답합니다. 과거 학기를 자유롭게 선택 조회하는 기능은 추후 지원 예정이며, API 시그니처에는 파라미터를 남겨두되 서버가 무시하고 현재 학기로 응답해도 무방합니다.

### 0.6 새로 필요한 데이터 모델
현재 `db/schema.sql`은 `students / notices / courses / student_courses / grades`뿐입니다.

**공유 카탈로그 (모든 학생이 공통으로 참조)**
- `colleges` / `departments` : 단과대/학과 마스터 (시간표 검색, 회원가입 학과 선택에도 사용)
- `professors` : 교수 마스터. 0.7에서 확정된 10개 과목 기준 **9명** 시드 (이상원 교수가 이산수학·빅데이터 2과목 담당이라 10과목이지만 9명)
- `courses` : 과목 마스터(courseCode, courseName, credits, category) — 시간/분반과 분리
- `course_offerings` : **학기별 개설강좌**. `offeringId`(surrogate PK) + `UNIQUE(courseCode, year, semester, section)` 복합 유니크 제약. 요일/교시/강의실/담당교수를 여기에 저장.
  > "복합키 구조"로 진행하되, 실제 구현은 자동증가 PK + 복합 UNIQUE 인덱스 조합을 추천합니다. `attendance_records`, `student_courses`, `grades` 등 자식 테이블이 4개 컬럼을 전부 FK로 들고 다니지 않고 `offeringId` 하나만 참조하면 되어 관리가 훨씬 쉬워집니다. 순수 다중 컬럼 PK를 원하시면 말씀해주세요.
- `academic_calendar` : 학사일정 mock (`type`: LEAVE_APPLICATION / WITHDRAWAL_APPLICATION / OFFICIAL_LEAVE_APPLICATION / COURSE_EVALUATION / GRADE_CORRECTION / TUITION_INVOICE 등, `year`, `semester`, `startDate`, `endDate`)

**학생 개인 데이터 (가입 시 생성)**
- `students` 확장 : `email`(로그인용, UNIQUE), `college`, `department`, `grade`, `admissionYear`, `advisorProfessorId`, `templateId`
- `student_courses`, `grades`, `attendance_records`, `academic_status_requests`, `official_leave_requests`, `course_evaluations`, `grade_correction_requests`, `completed_course_summary`/`completed_course_items`, `tuition_invoices`, `refund_requests`
- `home_shortcuts` : 학생별 홈 화면 바로가기 커스터마이징
- `chat_conversations` / `chat_messages` : 챗봇 대화 이력

### 0.7 신규 가입 학생 데이터 채우기 전략 (확정)
**템플릿 배정 방식으로 진행합니다.** 1차 스코프는 템플릿 1개, **컴퓨터·소프트웨어공학과 · 개설과목 10개**로 시작합니다.

- 템플릿의 과목/시간표/성적/출결 데이터를 회원가입 시 **그 학생 소유의 행(row)으로 복사**합니다 (원본을 공유 참조하면 한 학생의 수업평가 제출/성적정정 요청이 다른 학생에게도 보이는 문제가 생기므로 반드시 복사).
- 회원가입 시 학과는 템플릿이 1개뿐이므로 **컴퓨터·소프트웨어공학과로 고정**됩니다. 선택 UI를 굳이 보여줄 필요 없이 서버가 자동 배정해도 됩니다. `GET /api/common/departments`는 템플릿이 늘어날 때를 대비해 남겨두되, 현재는 1건만 반환합니다.
- `professors`는 이 10개 과목에 배정된 9명(이상원 교수가 2과목 담당)만 시드.
- 10개 과목은 **"현재 학기 개설강좌"**(`course_offerings`) 기준입니다. [7.3 이수과목 확인 리스트](#73-이수과목-확인-리스트)나 [7.4 전체 성적 조회](#74-전체-성적-조회)처럼 **과거 학기 누적 이력**을 보여주는 화면은 이 10개와 별도의 mock 시드로 취급하기로 **확정**했습니다 (예: "이수과목확인리스트" 화면의 이산수학·데이터구조 등은 현재 개설 10과목과 안 겹쳐도 됨). 과거 이력에 들어갈 전체 과목 리스트는 별도로 전달 예정 (확정되면 이 문서에 반영).
- **10개 과목 시드 확정**: 6, 4, 8, 10번은 이전에 전달받은 화면 목업(출결조회/교수시간표조회)에 실제로 나온 과목이라 코드·시간·강의실까지 그대로 재사용했습니다. 나머지 4개(2,3,5,7,9번 일부)는 화면에 없던 과목이라 동일한 코드 체계(`374xxx`)와 패턴으로 임시값을 채웠습니다. **`(가정)` 표시된 시간/강의실/이수구분·학수번호는 우선 이대로 두고, 추후 확정되면 반영합니다.**

| offeringId | courseCode | courseName | professor | credits | category | section | dayPeriod | room |
|---|---|---|---|---|---|---|---|---|
| 101 | 374038 | 운영체제 | 복경수 | 3.0 | 선전 | 02 | 수2금12 | [프라임관]104소강의실 |
| 102 | 374065 | Java와객체지향프로그래밍 | 정석태 | 3.0 | 기전 | 01 | 월34 `(가정)` | [프라임관]전산실1 `(가정)` |
| 103 | 374006 | 이산수학 | 이상원 | 3.0 | 기전 | 02 | 화34 `(가정)` | [프라임관]전산실2 `(가정)` |
| 104 | 374025 | 컴퓨터그래픽스 | 정성태 | 3.0 | 선전 | 03 | 화78목5 | [프라임관]302종강실 |
| 105 | 374030 `(가정)` | 컴퓨터조직 | 이종민 | 3.0 `(가정)` | 기전 `(가정)` | 01 | 수34 `(가정)` | [프라임관]전산실1 `(가정)` |
| 106 | 374026 | 데이터통신 | 정영지 | 3.0 | 선전 | 01 | 화12목4 | [프라임관]105소강의실 |
| 107 | 374090 `(가정)` | 고급프로그래밍언어 | 이완범 | 3.0 `(가정)` | 선전 `(가정)` | 01 | 목34 `(가정)` | [프라임관]전산실2 `(가정)` |
| 108 | 374079 | 인공지능 | 오강한 | 3.0 | 선전 | 01 | 화1목12 | [프라임관]화공 및 탄소융합 전산실 |
| 109 | 374095 `(가정)` | 윈도우프로그래밍 | 김용운 | 3.0 `(가정)` | 선전 `(가정)` | 01 | 금34 `(가정)` | [프라임관]전산실1 `(가정)` |
| 110 | 374124 | 빅데이터 | 이상원 | 3.0 | 선전 | 01 | 월12화12 | [프라임관]컴퓨터소프트웨어공학 전산실2 |

이 10개가 `course_offerings`(현재 학기 개설강좌) 테이블의 1차 시드 전체이며, [4~6번 섹션](#4-정보서비스-시간표관리)의 시간표/수강신청/출결/수업평가/강의계획서 API가 전부 이 목록을 기준으로 동작합니다.

---

## 1. 인증

### 1.1 회원가입
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/auth/signup` | `email: String, password: String, name: String` | 로그인은 **이메일 기준**(확정). `studentId`는 서버가 자동 발급해서 프로필/학사정보 식별용으로만 사용 (형식: `입학년도4자리+순번4자리`, 예: `20260001`). 학과는 템플릿이 1개(컴퓨터·소프트웨어공학과)뿐이라 자동 배정 |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"SIGNUP_SUCCESS", "message":null, "data":{ "email":"hong@example.com", "studentId":"20260001", "name":"홍길동", "department":"컴퓨터·소프트웨어공학과" } }` |
| 400 | `{ "status":400, "code":"REQUIRED_EMAIL", "message":null, "data":null }` |
| 400 | `{ "status":400, "code":"REQUIRED_PASSWORD", "message":null, "data":null }` |
| 400 | `{ "status":400, "code":"REQUIRED_NAME", "message":null, "data":null }` |
| 409 | `{ "status":409, "code":"EMAIL_ALREADY_EXISTS", "message":null, "data":null }` |

가입 성공 시 서버 내부적으로 0.7의 템플릿 데이터 복사가 함께 일어납니다.

### 1.2 로그인 / 로그아웃
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/auth/login` | `email: String, password: String` | 세션 발급 |
| POST | `/api/auth/logout` | - | 세션 종료 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"LOGIN_SUCCESS", "message":null, "data":{ "email":"hong@example.com", "studentId":"20260001", "name":"홍길동" } }` |
| 401 | `{ "status":401, "code":"INVALID_CREDENTIALS", "message":null, "data":null }` |

> 비밀번호 변경은 여전히 외부 사이트 클론 영역이라 제외합니다.

---

## 2. 공용 정보 (`/api/me`, `/api/common`)

### 2.1 내 프로필 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/me` | - | 로그인한 학생의 기본 프로필 + 지도교수. 홈 화면 좌측 하단 프로필 위젯 등 **전역적으로 재사용**되는 공용 엔드포인트 (MyPage 전용 API였던 것을 여기로 이동) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"ME_SUCCESS", "message":null, "data":{ "studentId":"20232338", "email":"hong@example.com", "name":"홍길동", "college":"창의공과대학", "department":"컴퓨터·소프트웨어공학과", "grade":2, "advisorProfessor":{ "professorId":"P1023", "name":"이상원" } } }` |

### 2.2 단과대/학과 목록 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/common/departments` | - | 학과별시간표 검색창 등에서 사용. 현재는 템플릿이 1개라 컴퓨터·소프트웨어공학과 1건만 반환 (템플릿 추가 시 확장) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"DEPARTMENT_LIST_SUCCESS", "message":null, "data":[ { "college":"창의공과대학", "department":"컴퓨터·소프트웨어공학과" } ] }` |

### 2.3 학사일정 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/common/academic-calendar?year=&semester=` | - | 신청형 기능들의 기간 배너 표시용 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"ACADEMIC_CALENDAR_SUCCESS", "message":null, "data":[ { "type":"COURSE_EVALUATION", "year":2026, "semester":1, "startDate":"2026-06-01", "endDate":"2026-06-14" } ] }` |

### 2.4 홈 화면 바로가기
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/home/shortcuts` | - | 내가 설정한 바로가기 목록 |
| PUT | `/api/home/shortcuts` | `shortcuts: [{ key: String, order: Number }]` | 바로가기 구성 전체 교체 (추가/삭제/순서변경 모두 이 API로 처리) |
| GET | `/api/home/shortcuts/available` | - | "+" 버튼으로 추가할 때 고를 수 있는 **전체 후보 목록** (확정) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"SHORTCUTS_SUCCESS", "message":null, "data":[ { "key":"timetable", "label":"시간표", "icon":"calendar", "path":"/timetable/registration", "order":1 } ] }` |
| 200 | `{ "status":200, "code":"AVAILABLE_SHORTCUTS_SUCCESS", "message":null, "data":[ { "key":"timetable", "label":"시간표", "icon":"calendar" }, { "key":"notice", "label":"공지사항", "icon":"bell" }, { "key":"grade", "label":"성적조회", "icon":"chart" }, { "key":"registration", "label":"수강신청", "icon":"book" } ] }` |

---

## 3. 정보서비스 › 학적관리

### 3.1 휴·복학 신청 내역 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/academic-status/leave` | - | 학적 변동(휴학/복학) 내역 목록 (하나의 표로 통합 조회) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"LEAVE_LIST_SUCCESS", "message":null, "data":[ { "requestId":1, "requestYear":2026, "requestSemester":2, "submittedAt":"2026-07-18", "changeType":"GENERAL_LEAVE", "reason":"가사휴학", "returnYear":2027, "returnSemester":2, "status":"PENDING" } ] }` |

### 3.2 휴·복학 신청
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/academic-status/leave` | `changeType: String, reason: String, returnYear?: Number, returnSemester?: Number` | `changeType`: GENERAL_LEAVE\|MILITARY_LEAVE\|STARTUP_LEAVE\|PARENTAL_LEAVE\|RETURN. `returnYear/returnSemester`는 휴학 신청 시에만 필수, 복학(`RETURN`) 신청 시에는 생략 가능 (신청 자체가 그 학기 복학 의미) |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"LEAVE_REQUEST_SUCCESS", "message":null, "data":{ "requestId":12, "status":"PENDING", "changeType":"GENERAL_LEAVE", "submittedAt":"2026-07-29" } }` |
| 400 | `{ "status":400, "code":"REQUIRED_CHANGE_TYPE", "message":null, "data":null }` |
| 400 | `{ "status":400, "code":"REQUIRED_REASON", "message":null, "data":null }` |
| 409 | `{ "status":409, "code":"ALREADY_PENDING_REQUEST", "message":null, "data":null }` |
| 200 | `{ "status":200, "code":"NOT_IN_LEAVE_APPLICATION_PERIOD", "message":null, "data":null }` |

### 3.3 휴·복학 신청 취소
| Request method | url | body | 설명 |
|---|---|---|---|
| DELETE | `/api/academic-status/leave/:requestId` | - | 신청 취소 (`PENDING` 상태만 가능) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"LEAVE_CANCEL_SUCCESS", "message":null, "data":null }` |
| 404 | `{ "status":404, "code":"REQUEST_NOT_FOUND", "message":null, "data":null }` |
| 400 | `{ "status":400, "code":"NOT_CANCELABLE_STATUS", "message":null, "data":null }` |

### 3.4 자퇴 신청 내역 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/academic-status/withdrawal` | - | 자퇴 신청 내역 목록 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"WITHDRAWAL_LIST_SUCCESS", "message":null, "data":[ { "requestId":7, "requestYear":2026, "requestSemester":2, "submittedAt":"2026-07-20", "reason":"개인사정", "status":"PENDING", "refundRequestId":null } ] }` |

### 3.5 자퇴 신청
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/academic-status/withdrawal` | `reason: String` | 승인단계 없이 신청 시 즉시 `PENDING` 상태로 저장 |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"WITHDRAWAL_REQUEST_SUCCESS", "message":null, "data":{ "requestId":7, "status":"PENDING", "submittedAt":"2026-07-29" } }` |
| 400 | `{ "status":400, "code":"REQUIRED_REASON", "message":null, "data":null }` |
| 409 | `{ "status":409, "code":"ALREADY_PENDING_REQUEST", "message":null, "data":null }` |
| 200 | `{ "status":200, "code":"NOT_IN_WITHDRAWAL_APPLICATION_PERIOD", "message":null, "data":null }` |

### 3.6 자퇴 신청 취소
| Request method | url | body | 설명 |
|---|---|---|---|
| DELETE | `/api/academic-status/withdrawal/:requestId` | - | 신청 취소 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"WITHDRAWAL_CANCEL_SUCCESS", "message":null, "data":null }` |
| 400 | `{ "status":400, "code":"NOT_CANCELABLE_STATUS", "message":null, "data":null }` |

> 자퇴 확정 후 노출되는 "환불신청" 버튼은 [8.3 환불 신청](#83-환불-신청)으로 연결됩니다.

---

## 4. 정보서비스 › 시간표관리

### 4.1 학과별(영역별) 시간표 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/timetable/department?year=&semester=&college=&department=` | - | `course_offerings`를 그대로 리스트업 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"DEPARTMENT_TIMETABLE_SUCCESS", "message":null, "data":[ { "offeringId":101, "grade":3, "category":"선전", "courseCode":"374038", "courseName":"운영체제", "section":"02", "credits":3.0, "dayPeriod":"수2금12", "professor":"복경수", "room":"[프라임관]104소강의실" } ] }` |

전공시간표가 없는 학과는 `data:[]`로 응답, 안내 문구는 프론트 고정 텍스트.

### 4.2 교수 시간표 검색
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/timetable/professor/search?year=&semester=&name=` | - | 교수명 검색 (동명이인 대비 목록 반환) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"PROFESSOR_SEARCH_SUCCESS", "message":null, "data":[ { "professorId":"P0512", "college":"공과대학", "department":"공학3계열 컴퓨터·소프트웨어공학전공", "professorName":"박혁규" } ] }` |

### 4.3 교수 시간표 상세
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/timetable/professor/:professorId?year=&semester=` | - | 특정 교수의 주간 시간표 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"PROFESSOR_TIMETABLE_SUCCESS", "message":null, "data":{ "department":"공학3계열 컴퓨터·소프트웨어공학전공", "professorName":"이상원", "weekly":[ { "day":"월", "period":1, "courseName":"빅데이터", "courseCode":"374124", "section":"01", "room":"[프라임관]컴퓨터소프트웨어공학 전산실2" } ] } }` |
| 404 | `{ "status":404, "code":"PROFESSOR_NOT_FOUND", "message":null, "data":null }` |

---

## 5. 정보서비스 › 수업관리

### 5.1 강의계획서 검색
화면 스크린샷 기준: 년도/학기 입력 + "교과목 검색" 조건 드롭다운(교과목명/교과목코드 중 선택) + 검색어 입력.

| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/courses/syllabus/search?year=&semester=&searchType=&keyword=` | - | `searchType`: `COURSE_NAME`(교과목명) \| `COURSE_CODE`(교과목코드) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"SYLLABUS_SEARCH_SUCCESS", "message":null, "data":[ { "offeringId":104, "year":2026, "semester":2, "courseName":"컴퓨터그래픽스", "courseCode":"374025", "section":"03", "professor":"정성태" } ] }` |

### 5.2 강의계획서 상세
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/courses/:offeringId/syllabus` | - | `offeringId`는 `course_offerings`의 surrogate PK (년도/학기/분반까지 이미 포함된 값이라 별도 쿼리 파라미터 불필요) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"SYLLABUS_SUCCESS", "message":null, "data":{ "courseName":"...", "courseCode":"...", "professor":"...", "credits":3.0, "objective":"...", "weeklyPlan":[ { "week":1, "content":"..." } ], "evaluationMethod":"...", "textbook":"..." } }` |
| 404 | `{ "status":404, "code":"SYLLABUS_NOT_FOUND", "message":null, "data":null }` |

### 5.3 수강신청 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/courses/registration?year=&semester=` | - | 이 시스템 DB에 저장된 **확정된** 수강신청 결과 조회 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"REGISTRATION_SUCCESS", "message":null, "data":{ "studentId":"20232338", "name":"홍길동", "year":2026, "semester":2, "totalCredits":21.0, "courses":[ { "offeringId":110, "courseCode":"374124", "courseName":"빅데이터", "section":"01", "credits":3.0, "dayPeriod":"월12,화12", "professor":"이상원", "isRetake":false } ], "weekly":[ ] } }` |

> "수강신청관리"(신청/변경/취소 자체)는 외부 `course.wku.ac.kr` 클론 대상이라 제외.

### 5.4 수업평가 대상 목록
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/courses/evaluation?year=&semester=` | - | 과목별 `submitted` 여부 포함. **문항 자체는 프론트 고정 텍스트**이며 API로 내려주지 않음 (모든 과목이 동일 문항이라 서버 관리 불필요로 확정) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"EVALUATION_LIST_SUCCESS", "message":null, "data":[ { "offeringId":110, "courseCode":"374124", "courseName":"빅데이터", "section":"01", "credits":3.0, "professor":"이상원", "isRetake":false, "remark":null, "submitted":false } ] }` |

### 5.5 수업평가 제출
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/courses/evaluation/:offeringId` | `answers: Array` | 제출 시 `submitted:true`로 전환 → 프론트는 "제출" 버튼을 "제출완료" 비활성 버튼으로 전환 |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"EVALUATION_SUBMIT_SUCCESS", "message":null, "data":{ "offeringId":110, "submitted":true, "submittedAt":"2026-07-29" } }` |
| 409 | `{ "status":409, "code":"ALREADY_SUBMITTED", "message":null, "data":null }` |
| 200 | `{ "status":200, "code":"NOT_IN_COURSE_EVALUATION_PERIOD", "message":null, "data":null }` |

---

## 6. 정보서비스 › 전자출결관리

### 6.1 출결 대상 과목 목록
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/attendance?year=&semester=` | - | 수강 과목별 출결 진입 목록 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"ATTENDANCE_COURSE_LIST_SUCCESS", "message":null, "data":[ { "offeringId":104, "courseCode":"374025", "courseName":"컴퓨터그래픽스", "category":"선전", "section":"03", "credits":3.0, "dayPeriod":"화78목5", "professor":"정성태", "room":"[프라임관]302종강실" } ] }` |

### 6.2 출결 상세
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/attendance/:offeringId` | - | 과목별 출결 요약 + 확인 필요 목록 (mock 시드) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"ATTENDANCE_DETAIL_SUCCESS", "message":null, "data":{ "courseName":"컴퓨터그래픽스", "summary":{ "present":42, "late":1, "officialAbsence":2, "absence":3 }, "needsCheck":[ { "week":5, "date":"2026-04-02", "period":5, "status":"LATE" }, { "week":9, "date":"2026-04-30", "period":7, "status":"OFFICIAL_ABSENCE", "category":"예비군" }, { "week":12, "date":"2026-05-19", "period":5, "status":"ABSENCE" } ] } }` |
| 404 | `{ "status":404, "code":"COURSE_NOT_FOUND", "message":null, "data":null }` |

### 6.3 공결 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/attendance/official-leave?year=&semester=` | - | 공결 신청 내역 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"OFFICIAL_LEAVE_LIST_SUCCESS", "message":null, "data":[ { "requestId":3, "offeringId":104, "appliedDate":"2026-04-28", "absenceDate":"2026-04-30", "approvalStatus":"PENDING", "reason":"예비군훈련", "courseCode":"374025", "courseName":"컴퓨터그래픽스", "section":"03", "period":7 } ] }` |

> `approvalStatus`는 화면 표시용 필드로만 존재하며, 승인 주체가 없어 API로 값을 바꾸는 기능은 만들지 않습니다.

### 6.4 공결 신청
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/attendance/official-leave` | `offeringId: Number, absenceDate: Date, period: Number, reason: String` | 신청 기간 내에만 가능 |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"OFFICIAL_LEAVE_REQUEST_SUCCESS", "message":null, "data":{ "requestId":9, "approvalStatus":"PENDING" } }` |
| 400 | `{ "status":400, "code":"REQUIRED_REASON", "message":null, "data":null }` |
| 200 | `{ "status":200, "code":"NOT_IN_OFFICIAL_LEAVE_APPLICATION_PERIOD", "message":null, "data":null }` |

### 6.5 공결 신청 취소
| Request method | url | body | 설명 |
|---|---|---|---|
| DELETE | `/api/attendance/official-leave/:requestId` | - | 신청 취소 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"OFFICIAL_LEAVE_CANCEL_SUCCESS", "message":null, "data":null }` |

---

## 7. 정보서비스 › 성적관리

### 7.1 성적 단표 내역 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/grades/semester?year=&semester=` | - | 학기별 성적 상세표 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"SEMESTER_GRADE_SUCCESS", "message":null, "data":{ "basicInfo":{ "college":"창의공과대학", "department":"컴퓨터·소프트웨어공학과", "studentId":"20232338", "name":"홍길동", "year":2026, "semester":2 }, "records":[ { "recordId":123, "offeringId":103, "category":"기전", "courseCode":"374006", "courseName":"이산수학", "credits":3.0, "midterm":30.0, "final":35.0, "attendance":20.0, "assignment":10.0, "etc":5.0, "gpa":4.0, "letterGrade":"A0", "alreadyRequested":false } ] } }` |

> `alreadyRequested`는 "이 과목에 대해 정정요청을 이미 보냈는지"만 의미합니다 (기간 여부와 무관 — 0.5 규칙에 따라 기간 판단은 프론트가 학사일정 API로 별도 확인).

### 7.2 성적 정정 요청
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/grades/semester/:recordId/correction-request` | `reason: String` | 신청만 하고 결과 처리는 범위 밖. 과목당 1회 제한 |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"CORRECTION_REQUEST_SUCCESS", "message":null, "data":{ "recordId":123, "requestedAt":"2026-07-29" } }` |
| 409 | `{ "status":409, "code":"ALREADY_REQUESTED", "message":null, "data":null }` |
| 200 | `{ "status":200, "code":"NOT_IN_GRADE_CORRECTION_PERIOD", "message":null, "data":null }` |

### 7.3 이수과목 확인 리스트
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/grades/completed-courses` | - | 전 항목 mock으로 미리 계산되어 저장된 값을 그대로 조회 (서버 계산 로직 없음) |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"COMPLETED_COURSES_SUCCESS", "message":null, "data":{ "studentInfo":{ "college":"창의공과대학", "department":"컴퓨터·소프트웨어공학과", "major":null, "admissionType":"일반 신입학", "grade":3, "completedSemesters":5, "studentId":"20238215", "name":"홍길동", "transferType":null, "transferYear":null, "previousDepartment":null }, "summary":{ "liberal":{ "교필":5.0, "교선":26.0, "교기":3.0, "계열":0.0, "계기":0.0, "학필":0.0, "subtotal":34.0 }, "major":{ "전기":0.0, "전필":0.0, "전선":0.0, "기전":39.0, "선전":21.0, "융전":0.0, "subtotal":60.0 }, "etc":{ "학석":0.0, "융전":0.0, "복수전공":0.0, "부전공":0.0, "교직":0.0, "일선":0.0, "편입":0.0, "subtotal":0.0 }, "total":94.0 }, "categories":{ "liberal":[ { "type":"교필", "courseName":"건학이념과공동체정신", "yearSemester":"2024/1", "credits":3.0, "area":"소양_건학이념", "note":null } ], "liberalSubtotal":34.0, "major":[ { "type":"기전", "courseName":"컴퓨터공학입문", "yearSemester":"2024/2", "credits":3.0, "department":"컴퓨터·소프트웨어공학과", "note":null } ], "majorSubtotal":60.0, "counselingUncategorized":[ { "courseName":"자기계발심층상담", "yearSemester":"2024/2", "credits":0.0, "department":null, "note":null } ], "counselingSubtotal":0.0 }, "notices":[ "본 자료는 참고용이며 자세한 내용은 지도교수나 학과(부)장과 상담하시기 바랍니다.", "학점란에 *표시가 있는 과목은 F과목입니다.", "졸업인증제는 2013학번부터 적용되며 이수내용은 학과(부)에 문의하시기 바랍니다." ] } }` |

### 7.4 전체 성적 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/grades/overall` | - | 전 학기 누적 성적 요약 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"OVERALL_GRADE_SUCCESS", "message":null, "data":{ "basicInfo":{ "college":"창의공과대학", "department":"컴퓨터·소프트웨어공학과", "studentId":"20232338", "name":"홍길동" }, "bySemester":[ { "year":2023, "grade":1, "semester":1, "appliedCredits":17.0, "earnedCredits":17.0, "totalScore":65.0, "gpa":3.60 } ], "summary":{ "appliedCredits":76.0, "earnedCredits":76.0, "gpa":3.90 } } }` |

---

## 8. 정보서비스 › 등록관리

### 8.1 등록고지서 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/tuition/invoice?year=&semester=` | - | 납부일정 안내와 고지서는 **서로 독립된 두 개의 빈 상태**를 가질 수 있어 별도 코드 없이 `schedule`/`invoice`를 각각 빈 값으로 내려주고 프론트가 판단합니다. **출력은 브라우저 인쇄만 사용, PDF 생성 API 없음** |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"INVOICE_SUCCESS", "message":null, "data":{ "schedule":[ ], "invoice":null } }` |
| 200 | `{ "status":200, "code":"INVOICE_SUCCESS", "message":null, "data":{ "schedule":[ { "targetGroup":"...", "period":"...", "printPeriod":"...", "availableBanks":"..." } ], "invoice":{ "totalAmount":0, "items":[ ] } } }` |

### 8.2 환불 신청 내역 조회
| Request method | url | body | 설명 |
|---|---|---|---|
| GET | `/api/tuition/refund?year=&semester=` | - | 환불 신청 내역 |

| Response status | data |
|---|---|
| 200 | `{ "status":200, "code":"REFUND_LIST_SUCCESS", "message":null, "data":[ { "requestId":5, "applyYear":2026, "applySemester":2, "regYear":2026, "regSemester":2, "reason":"자퇴로 인한 환불", "personalInfoConsent":true, "refundAccount":{ "bank":"전북은행", "accountNumber":"110123456789", "holderName":"홍길동" }, "refundBaseDate":"2026-07-20", "submittedAt":"2026-07-20", "refundedAt":null, "refundAmount":null, "result":"PENDING" } ] }` |

### 8.3 환불 신청
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/tuition/refund` | `reason: String, personalInfoConsent: Boolean, refundAccount: { bank: String, accountNumber: String, holderName: String }, withdrawalRequestId?: Number` | 환불 대상자가 아니면 신청 자체가 거부됨 (목업의 "환불대상자가 아닙니다" 알럿). `withdrawalRequestId`는 자퇴로 인한 환불일 때만 전달(선택), 등록금 과오납 등 자퇴와 무관한 환불도 있을 수 있어 선택값으로 둠 |

| Response status | data |
|---|---|
| 201 | `{ "status":201, "code":"REFUND_REQUEST_SUCCESS", "message":null, "data":{ "requestId":5, "withdrawalRequestId":7, "result":"PENDING" } }` |
| 400 | `{ "status":400, "code":"REQUIRED_PERSONAL_INFO_CONSENT", "message":null, "data":null }` |
| 200 | `{ "status":200, "code":"NOT_REFUND_TARGET", "message":null, "data":null }` |

> `withdrawalRequestId`가 전달되면 서버는 해당 자퇴신청 레코드의 `refundRequestId`도 함께 채워서 [3.4 자퇴 신청 내역 조회](#34-자퇴-신청-내역-조회)에서 역참조할 수 있게 합니다.

---

## 9. AI 챗봇 (`/api/chat`)

기존 `server/services/aiClient.js`의 `getAIChatResponse(userMessage, academicContext)` 스텁을, 위에서 만든 학사정보 API들을 **"함수 호출(function calling)" 도구**로 모델에 연결하는 구조로 확장합니다 (**확정**). 홈 화면 상단 검색바("무엇을 찾고 계신가요?")도 별도 검색 API 없이 **이 채팅 API의 입력창**으로 취급합니다 (확정).

### 9.1 동작 흐름 (확정)
1. 사용자가 "이번 학기 내 시간표 알려줘" 입력
2. `POST /api/chat` 호출
3. 서버는 해당 `conversationId`의 **기존 대화 이력(`chat_messages`)을 전부 불러와** 이번 메시지와 함께 모델에 전달 (같은 대화 안에서는 이전에 답한 내용을 다시 안 물어도 되는 이유가 이것 — 별도 "기억 저장소"는 만들지 않음, **확정**)
4. 서버가 Gemini에 메시지+이력 + "사용 가능한 도구 목록"(아래 표)을 함께 전달
5. 모델이 "시간표 조회가 필요하다"고 판단하면 `tool_call`로 `getMyRegistration` 요청
6. 서버는 실제로 [5.3 수강신청 조회](#53-수강신청-조회) 로직을 호출해 결과를 모델에 다시 전달
7. 모델이 결과를 바탕으로 자연어 답변을 생성 → `reply`로 응답

**대화(conversation) 생명주기 (확정)**: 학생당 "현재 진행 중인 대화" 1개를 기본으로 계속 이어갑니다. `conversationId`를 안 보내면 서버가 그 학생의 **가장 최근 활성 대화**를 자동으로 이어서 씁니다(없으면 새로 생성). 완전히 새로 시작하고 싶을 때만 `newConversation:true`를 보내 새 대화를 만듭니다. 대화가 길어질수록 매번 전체 이력을 모델에 보내 비용이 늘어나는 점은 인지하고 있으며, 실사용 후 필요하면 오래된 메시지 요약/절단을 추후 검토합니다 (지금은 대응 불필요).

### 9.2 챗봇에 연결할 도구(tool) 예시
**도구 개수 관련**: 도구가 너무 많으면(20~30개) 모델이 비슷한 이름의 도구 중 무엇을 호출할지 헷갈려 정확도가 떨어질 수 있습니다. 처음엔 학생들이 실제로 자주 물어볼 법한 것(시간표/성적/출결/신청) 위주로 8개만 연결하고, 필요할 때 확장하는 방식으로 **확정**했습니다. 아래 `✅`가 1차 우선순위입니다.
| 도구 이름 | 내부적으로 재사용하는 API | 1차 우선순위 |
|---|---|---|
| `getMyProfile` | `GET /api/me` | ✅ |
| `getMyRegistration` | `GET /api/courses/registration` | ✅ |
| `getMySemesterGrades` | `GET /api/grades/semester` | ✅ |
| `getMyOverallGrades` | `GET /api/grades/overall` | |
| `getMyAttendance` | `GET /api/attendance` / `GET /api/attendance/:offeringId` | ✅ |
| `getMyAcademicStatusHistory` | `GET /api/academic-status/leave`, `GET /api/academic-status/withdrawal` | |
| `getMyOfficialLeaveHistory` | `GET /api/attendance/official-leave` | |
| `getAcademicCalendar` | `GET /api/common/academic-calendar` | ✅ |

**실행(쓰기) 도구 — 챗봇이 직접 신청/제출까지 처리 (확정)**
| 도구 이름 | 내부적으로 재사용하는 API | 1차 우선순위 |
|---|---|---|
| `applyLeave` / `applyReturn` | `POST /api/academic-status/leave` | ✅ |
| `cancelLeave` | `DELETE /api/academic-status/leave/:requestId` | |
| `applyWithdrawal` | `POST /api/academic-status/withdrawal` | |
| `cancelWithdrawal` | `DELETE /api/academic-status/withdrawal/:requestId` | |
| `applyOfficialLeave` | `POST /api/attendance/official-leave` | ✅ |
| `cancelOfficialLeave` | `DELETE /api/attendance/official-leave/:requestId` | |
| `submitCourseEvaluation` | `POST /api/courses/evaluation/:offeringId` | ✅ |
| `requestGradeCorrection` | `POST /api/grades/semester/:recordId/correction-request` | |
| `applyRefund` | `POST /api/tuition/refund` | |

1차 우선순위 8개: `getMyProfile`, `getMyRegistration`, `getMySemesterGrades`, `getMyAttendance`, `getAcademicCalendar`, `applyLeave`/`applyReturn`, `applyOfficialLeave`, `submitCourseEvaluation`. 나머지는 필요성이 확인되면 2차로 추가.

> **안전장치 (확정)**: 쓰기 도구는 모델이 사용자 메시지만 보고 바로 실행하지 않고, **"이 내용으로 접수할까요?" 한 번 되묻고 사용자가 확인하면 그다음 턴에 실제로 tool_call을 실행**하는 2단계 확인 플로우로 진행합니다. 이 확인 플로우 자체는 프롬프트 설계 영역이라 API 스펙에는 영향 없고, 아래 응답의 `actions` 필드로 결과만 프론트에 알려주면 됩니다.

### 9.3 API
| Request method | url | body | 설명 |
|---|---|---|---|
| POST | `/api/chat` | `message: String, conversationId?: String, newConversation?: Boolean` | 대화 1턴 처리. `conversationId` 생략 시 가장 최근 활성 대화를 이어감(없으면 새로 생성). `newConversation:true`면 무조건 새 대화 시작. 모델이 쓰기 도구를 호출했다면 그 결과를 `actions`에 함께 반환 |
| GET | `/api/chat/history?conversationId=` | - | 이전 대화 조회. `conversationId` 생략 시 최근 활성 대화 기준 |
| DELETE | `/api/chat/:conversationId` | - | 대화 삭제 |

| Response status | data |
|---|---|
| 200 (조회만) | `{ "status":200, "code":"CHAT_REPLY_SUCCESS", "message":null, "data":{ "conversationId":"c_9f21", "reply":"이번 학기 시간표는 월요일 1,2교시 빅데이터...", "usedTools":["getMyRegistration"], "actions":[] } }` |
| 200 (신청 실행) | `{ "status":200, "code":"CHAT_REPLY_SUCCESS", "message":null, "data":{ "conversationId":"c_9f21", "reply":"휴학 신청이 접수되었어요. 상태는 학적관리 메뉴에서 확인할 수 있어요.", "usedTools":["applyLeave"], "actions":[ { "tool":"applyLeave", "resultCode":"LEAVE_REQUEST_SUCCESS", "data":{ "requestId":12, "status":"PENDING" } } ] } }` |

프론트는 `actions` 배열이 있으면 "휴학 신청이 접수되었습니다" 같은 카드 UI를 자연어 답변과 별도로 렌더링할 수 있습니다.

---

## 10. 범위 제외 (외부 시스템 클론 영역)
- 개인정보관리 › 비밀번호 변경
- 수업관리 › 수강신청관리(신청/변경/취소 자체)
- 증명발급 › 인터넷발급 / 우편발급
- 연결 서비스 › 웹메일 / 웹정보서비스 / LLM 서비스 / 봉황 BBS

---

## 남은 확인 사항
- [ ] 이수과목확인리스트/전체성적조회 등 **과거 학기 이력에 들어갈 전체 과목 리스트** (전달 예정)
- [ ] 휴복학/자퇴/공결 등 유형별 신청 **취소 가능 기간의 구체적인 날짜** (학사일정 확정되면 반영)
- [ ] 템플릿 1개뿐이라 모든 가입자의 과거 성적/이수내역이 완전히 동일한 값을 갖는 문제 — 1차는 그대로 진행하기로 함, 추후 개선 필요 시 재논의
- [ ] 추가로 전달 예정인 화면 목업 반영
