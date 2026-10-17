# ONE Student (wku-ai-chat)

원광대학교 학생을 위한 학사 정보 서비스입니다. 학생이 입력한 자기 학사정보와 원광대 실제 학칙·교육과정을 근거로 **"졸업까지 무엇이 남았는지"**를 알려주고, 학칙 질문에 근거를 들어 답합니다.

- 운영 주소: **https://onestudent.io.kr**
- 비공식 참고용 서비스입니다. 정확한 사항은 웹정보서비스나 학과·학사지원과에서 확인하도록 안내합니다.

## 소개

처음에는 인트라넷 화면을 허구 데이터로 흉내 내는 방식으로 시작했지만, 실제 학교 데이터에 접근할 수 없는 한계 때문에 **"학생이 직접 입력한 학사정보 + 실제 학칙·교육과정 근거"** 방식으로 방향을 바꿨습니다(v4.0 피벗). 컴퓨터·소프트웨어공학과에서 시작해 지금은 **전 학과(옛 학과 포함 126개)·2017~2026학번**의 졸업요건을 판정합니다.

원광대는 교육과정이 개편되면 그 전 학번에게도 최신 교육과정을 적용하고, 학번별 차이는 최신 책자의 학번별 이수기준표로 정합니다. 이 서비스도 그 원칙(교육혁신과 확인)을 따릅니다. 자세한 기준은 [CLAUDE.md](CLAUDE.md)와 [docs/school-inquiry](docs/school-inquiry)에 있습니다.

## 주요 기능

**시작하기**
- **로그인**: Google 로그인과 이메일 인증코드(OTP) 로그인. 이용약관·개인정보 수집 동의를 버전으로 관리하고, 바뀌면 다시 동의를 받습니다.
- **온보딩·학과 수정**: 학과(세부전공), 학번, 입학 유형(일반·편입·전과), 전과 시점·학년, 편입 학년·인정학점, 교직과정, 다전공(복수전공·부전공), 휴학 기간, 광역 계열전공 이수유형을 입력받습니다. 규정상 불가능한 조합(예: 의·치·한·약으로의 전과)은 입력 단계에서 막습니다.

**학사 관리**
- **과목 관리**: 개설과목 카탈로그 검색(내 학과 과목 우선), 직접 입력, 학기별 시간표·평균 학점, 재수강 가능 과목 안내.
- **성적표 PDF 가져오기**: 웹정보서비스의 전체성적조회·이수과목확인리스트 PDF를 올리면 AI가 과목·학점·성적을 읽어 한 번에 등록하고, 문서의 합계와 다르면 알려줍니다.
- **졸업요건 진단**: 규정 판단 엔진이 학과·학번·입학 유형에 맞는 졸업요건(전공·교양·일반선택, 졸업논문·졸업인증제, 교양 영역, 다전공, 등록 학기)을 계산합니다. 자료가 불확실하면 "추정"과 이유를, 자료가 없으면 "자료 없음"을 표시합니다.

**AI**
- **학칙 기반 챗봇**: 학칙·교육과정 문서를 검색(RAG)하고, 규정 판단 엔진의 결과와 학생의 이수 현황을 함께 근거로 답합니다. 근거에 없는 내용은 모른다고 답하고, 학생이 입력한 프로필(전과 시점, 편입 인정학점, 휴학 등)을 그대로 씁니다.
- **진로 탐색**: 질문과 대화로 진로 후보를 찾고, 아직 듣지 않은 과목으로 로드맵을 만듭니다.

**커뮤니티·운영**
- **커뮤니티**: 스터디·팀 활동 모집 글, 신청·수락·반려, 모집 마감, 신고·제재, 관리자 승인 후 공개.
- **문의하기**: 화면에서 버그·문의를 보내고 처리 상태를 확인합니다.
- **관리자**: 게시글 검수, 신고·제재 처리, 문의 처리, 이용 통계.
- **화면 언어**: 한국어·영어. 홈 화면 메뉴와 하단 바를 학생이 편집할 수 있습니다.

## 기술 스택

| 영역 | 스택 |
|---|---|
| Client | React 18, Vite 6, Vitest |
| Server | Node.js, Express 4, express-session(MySQL 세션 스토어), express-rate-limit, Google OAuth, 이메일 OTP(Resend), Sentry |
| DB | MySQL(운영: Railway), mysql2 |
| AI | Claude Haiku 4.5(답변 생성·PDF 인식·진로 탐색), Voyage AI 임베딩 기반 RAG |
| 규정 판단 엔진 | 학칙·학칙시행규칙 원문, 교육과정 책자 2017~2026(학번별 이수기준표)을 근거로 졸업요건과 신뢰도(확정·추정·자료 없음)를 계산(`server/services/regulationEngine`) |
| CI/CD | GitHub Actions(서버·클라이언트 테스트, Vercel 배포), DB 재시딩 워크플로(`db-reseed` 환경 승인 후 실행) |
| 배포 | 프론트엔드 Vercel, 백엔드 Railway |

## 프로젝트 구조

모노레포입니다.
- `client/`: React 프론트엔드(`pages`, `components`, `utils`, `i18n` 번역 사전)
- `server/`: Express 백엔드(`routes` API, `services` 비즈니스 로직·규정 판단 엔진, `scripts` 시딩, `test` node:test 테스트)
- `db/`: 스키마(`schema.sql`, `migrate.js`), 시드 데이터(`seed/`), 교육과정 원본(`curriculum/`), 학칙·안내 문서(`regulations/`, 챗봇 검색 대상)
- `docs/`: 배포, 자료 갱신 절차, 규정 판단 엔진 설계·결정 기록, 학교 문의·답변

## Getting Started

1. **의존성 설치**
   ```bash
   npm install
   ```
2. **환경 변수**: `.env.example`을 `.env`로 복사해 채웁니다. DB 접속 정보, Anthropic·Voyage AI API 키, Google OAuth 클라이언트, Resend API 키가 필요합니다.
3. **DB 준비**(로컬, 최초 1회)
   ```bash
   npm run db:migrate
   ```
   ```bash
   npm run seed
   ```
   `seed`는 로컬 전용입니다(가짜 학생 계정이 들어갑니다). 운영 DB에는 직접 실행하지 않습니다 — 아래 "운영 원칙" 참고.
4. **개발 서버**(client + server 동시 실행)
   ```bash
   npm run dev
   ```
5. **로컬에서 로그인 없이 화면 확인**(로컬 DB 전용)
   ```bash
   npm run dev:login
   ```
   `http://localhost:3001/`을 열면 자동 로그인됩니다. `/` 온보딩 전 계정, `/onboarded` 온보딩을 마친 계정, `/admin` 관리자 계정. `NODE_ENV=production`이거나 DB가 로컬이 아니면 시작하지 않습니다.
6. **테스트**
   ```bash
   npm test
   ```

## 운영 원칙

- **운영 DB 재시딩**: `main`에 `db/regulations/**`, `db/curriculum/**`, `db/seed/*.json` 변경이 반영되면 `db-reseed` 워크플로가 시작되고, Actions에서 승인하면 재시딩합니다. 운영 서버에서 `seed`를 직접 실행하지 않습니다. 자세한 절차: [docs/deployment.md](docs/deployment.md)
- **학교 자료 갱신**: 학교가 규정관리시스템·웹정보서비스의 자동 수집을 허락하지 않아, 학기마다 사람이 조회해 반영합니다(시간표, 교육과정 조회, 규정 개정, 새 책자). 절차: [docs/data-maintenance.md](docs/data-maintenance.md)
- **판단 기준**: 학교 답변으로 정해진 기준과 규정 판단 엔진의 결정 기록은 [CLAUDE.md](CLAUDE.md), [docs/regulation-engine/DECISIONS.md](docs/regulation-engine/DECISIONS.md)에 있습니다.

## Docs

- [API 설계](https://github.com/ONE-Student-WKU/web/wiki/API-설계)
- [ERD 설계](https://github.com/ONE-Student-WKU/web/wiki/ERD-설계)
- [규정 판단 엔진 설계](docs/regulation-engine/DESIGN.md)
