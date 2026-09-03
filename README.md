# wku-ai-chat

원광대학교(WKU) 인트라넷을 모사한 학사 정보 서비스 + 학칙 기반 AI 챗봇.

## 소개

처음에는 실제 학교 데이터에 접근할 수 없어 인트라넷 화면 전체를 허구 데이터로 흉내 내는 방식으로 시작했지만, 그 한계 때문에 **"학생이 직접 입력한 자기 학사정보 + 원광대 실제 학칙·이수규정을 근거로 답하는 AI"**로 방향을 크게 틀었습니다 (v4.0 피벗). 지금은 컴퓨터·소프트웨어공학과 1개 학과, 화면 4개(로그인 / 홈 / 과목 관리 / 졸업요건 진단) 스코프로 좁혀 개발 중입니다.

## 주요 기능

- **회원가입 / 로그인 / 온보딩**: 가입 후 학과, 입학년도, 편입생·전과생·일반재학생 구분을 입력받아 개인별 이수규정 판단에 활용
- **과목 관리**: 과목 카탈로그 검색 후 수강 추가, 내 수강·성적 직접 입력(학점 등급 선택) 및 삭제, 시간표·성적요약 조회
- **AI 챗봇**: 학칙·이수규정 원문을 임베딩 검색(RAG)한 뒤 근거를 인용해 답변 — 근거 문서에 없는 내용은 추측하지 않고 모른다고 답함 (Claude API 연동, 구현 진행 중)
- **졸업요건 진단**: 내 수강 이력과 이수규정을 비교해 부족한 요건을 안내 (예정)

## 기술 스택

| 영역 | 스택 |
|---|---|
| Client | React 18, Vite 6 |
| Server | Node.js, Express, express-session, bcryptjs |
| DB | MySQL (Railway), mysql2 |
| AI | Claude API 기반 RAG 챗봇 |
| 배포 | 프론트엔드: Vercel (GitHub Actions CI/CD) · 백엔드: Railway (GitHub 연동 자동배포) |

## 프로젝트 구조

이 프로젝트는 다음을 포함하는 모노레포입니다:
- `/client`: Vite + React로 만든 프론트엔드
- `/server`: 목업 인트라넷 DB와 AI 챗봇 API를 제공하는 Node.js + Express 백엔드
- `/db`: DB 스키마(`schema.sql`), 시드 데이터, 시딩 스크립트

## Getting Started

1. **의존성 설치**:
   ```bash
   npm install
   ```

2. **환경 변수 설정**:
   `.env.example`을 `.env`로 복사한 뒤 값을 채워주세요.

3. **DB 시드 데이터 적재** (최초 1회):
   ```bash
   npm run seed
   ```

4. **개발 서버 실행** (client + server 동시 실행):
   ```bash
   npm run dev
   ```

## Docs

설계 문서는 [GitHub Wiki](https://github.com/ONE-Student-wku/web/wiki)에서 관리합니다.
- [API 설계](https://github.com/ONE-Student-wku/web/wiki/API-설계)
- [ERD 설계](https://github.com/ONE-Student-wku/web/wiki/ERD-설계)
