# wku-ai-chat (ONE)

원광대학교(WKU) 학생을 위한 학사 정보 관리 서비스 + 학칙 기반 AI 챗봇.

## 소개

처음에는 실제 학교 데이터에 접근할 수 없어 인트라넷 화면 전체를 허구 데이터로 흉내 내는 방식으로 시작했지만, 그 한계 때문에 **"학생이 직접 입력한 자기 학사정보 + 원광대 실제 학칙·이수규정을 근거로 답하는 AI"**로 방향을 크게 틀었습니다 (v4.0 피벗). 대상 학과는 컴퓨터·소프트웨어공학과와 공학3계열(컴퓨터·소프트웨어공학전공 / 게임콘텐츠학전공)로 시작했고, 학사 관리를 중심으로 AI 챗봇·진로 탐색·커뮤니티까지 기능을 넓혀가며 개발 중입니다.

## 주요 기능

**학사 관리**
- **회원가입 / 로그인 / 온보딩**: 이메일 OTP 로그인과 Google OAuth 로그인을 함께 지원하며, 가입 후 학과·입학년도·편입생/전과생/일반재학생 구분을 입력받아 개인별 이수규정 판단에 활용
- **과목 관리**: 과목 카탈로그 검색 후 수강 추가, 내 수강·성적 직접 입력(학점 등급 선택) 및 삭제, 시간표·성적요약 조회
- **성적표 PDF 가져오기**: 원광대 인트라넷에서 내려받은 이수과목확인리스트 / 전체성적조회 PDF를 업로드하면 Claude 기반 AI가 과목·학점·성적을 추출해 자동 입력하고, 문서상 총 취득학점과 인식된 합계를 대조해 불일치를 안내
- **졸업요건 진단**: 내 수강 이력과 이수규정을 비교해 영역별 부족 학점·과목을 안내
- **재수강 안내**: 재수강 가능한(C+ 이하) 과목을 과목 관리 화면에서 바로 표시

**AI**
- **학칙 기반 AI 챗봇**: 학칙·이수규정 원문을 임베딩 검색(RAG)한 뒤 근거를 인용해 답변하고, 근거 문서에 없는 내용은 추측하지 않고 모른다고 답함
- **진로 탐색**: 고정 질문과 자유 대화를 이어가며 진로 후보를 함께 찾고, 확정된 진로에 맞춰 아직 듣지 않은 과목으로 로드맵을 구성

**커뮤니티**
- 스터디 · 프로젝트 모집 게시판 (모집 인원 표시, 신청/수락·반려, 모집 마감, 글 수정·삭제)
- 관리자 승인 후 공개되는 게시글 검수 플로우

**기타**
- **관리자 페이지**: 커뮤니티 게시글 승인/반려/삭제 등 운영 기능
- 프로필 · 설정, 개인정보처리방침 · 이용약관 페이지

## 기술 스택

| 영역 | 스택 |
|---|---|
| Client | React 18, Vite 6 |
| Server | Node.js, Express, express-session(MySQL 세션 스토어), Google OAuth, 이메일 OTP(Resend) |
| DB | MySQL (Railway), mysql2 |
| AI | Claude Haiku 4.5(응답 생성·PDF 파싱) + Voyage AI(임베딩) 기반 RAG 챗봇 |
| 인프라 | DB 자동 재시딩 파이프라인(GitHub Actions, `db-reseed` 환경 승인 게이트) |
| 배포 | 프론트엔드: Vercel (GitHub Actions CI/CD) · 백엔드: Railway (GitHub 연동 자동배포) |

## 프로젝트 구조

이 프로젝트는 다음을 포함하는 모노레포입니다:
- `/client`: Vite + React로 만든 프론트엔드
- `/server`: 학사 정보 API와 AI 챗봇 API를 제공하는 Node.js + Express 백엔드 (`routes` API 엔드포인트, `services` 비즈니스 로직, `scripts` 시딩/스크래핑 스크립트)
- `/db`: DB 스키마(`schema.sql`), ERD(`ERD.md`), 커리큘럼·학칙 원문·시드 데이터, 시딩 스크립트

## Getting Started

1. **의존성 설치**:
   ```bash
   npm install
   ```

2. **환경 변수 설정**:
   `.env.example`을 `.env`로 복사한 뒤 값을 채워주세요. DB 접속 정보 외에 AI 응답/임베딩용 API 키(Anthropic, Voyage AI), Google OAuth 클라이언트 정보, 이메일 OTP 발송용 Resend API 키가 필요합니다.

3. **DB 시드 데이터 적재** (최초 1회):
   ```bash
   npm run seed
   ```

4. **개발 서버 실행** (client + server 동시 실행):
   ```bash
   npm run dev
   ```

## Docs

설계 문서는 [GitHub Wiki](https://github.com/ONE-Student-WKU/web/wiki)에서 관리합니다.
- [API 설계](https://github.com/ONE-Student-WKU/web/wiki/API-설계)
- [ERD 설계](https://github.com/ONE-Student-WKU/web/wiki/ERD-설계)
