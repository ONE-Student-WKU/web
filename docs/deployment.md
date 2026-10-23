# 배포·DB 재시딩 가이드

이 저장소는 코드를 올리는 것만으로 끝나지 않는다. **규정·교육과정 문서(`db/regulations/**` 등)를 운영 챗봇에 반영하는 길이 코드 배포와 따로 있다.** 이 문서는 그 길을 처음 보는 사람(또는 AI)도 따라올 수 있게 정리한 것이다.

> **확인 기준일: 2026-10-23** (배포 담당 인수 직후. 워크플로 파일, GitHub API의 환경 설정·실행 기록, Railway·Vercel 커넥터와 대시보드). 2026-10-22~23에 모든 운영 서비스를 새 배포 담당 명의로 옮겼다(이슈 #375). 계정·서비스 구성은 아래 "운영 계정과 외부 서비스"에 있다. 설정을 바꾸면 이 문서도 같이 고친다. 특히 Start Command는 저장소 밖에 있어 코드 리뷰에 보이지 않으니, 바꾸면 반드시 아래 표를 같이 고친다.

## 한눈에 보기

| 무엇 | 언제 자동으로 시작되나 | 어디서 | 사람이 할 일 |
|---|---|---|---|
| 테스트 | PR을 `main`/`develop`으로 열거나 갱신 | `.github/workflows/test.yml` | 없음 (결과 확인) |
| 프론트 미리보기 | PR을 `main`/`develop`으로 열거나 갱신 | `vercel-deploy.yml` → Vercel preview, URL을 PR 댓글로 남김 | 없음. 미리보기 주소는 Vercel 로그인(배포 담당 계정)이 있어야 열린다 |
| 프론트 운영 배포 | PR이 **`main`으로 머지**됨 | `vercel-deploy.yml` → Vercel production | 없음 |
| 백엔드 배포 | PR이 **`main`으로 머지**됨 | Railway `web` 서비스가 GitHub `main`을 따라 자동 배포(2026-10-23 확인) | 없음 |
| **DB 재시딩** (규정·교육과정 반영) | **`main` push**에 아래 경로가 포함됨 | `db-reseed.yml` → Railway Cron Job | **승인 클릭 1번** |
| DB 스키마 반영 | 백엔드 배포 시 `db/migrate.js` (Railway Pre-Deploy Command, 2026-10-15 확인). 재시딩 때도 맨 처음 한 번 더 돈다 | Railway | 없음 |

브랜치 역할: `main`이 운영, `develop`이 통합 브랜치다. 운영 배포와 재시딩은 둘 다 **`main`** 기준이라, `develop`에만 머지된 변경은 운영에 반영되지 않는다.

## 가장 자주 하는 일: 문서를 운영 챗봇에 반영하기

운영 담당자에게 따로 요청하거나 운영 서버에서 명령을 직접 칠 필요가 없다.

1. `db/regulations/**` 등의 파일을 고치는 PR을 `develop`에 머지한다.
2. 그 변경이 `main`에 들어가면(보통 `develop` → `main` 릴리스 머지) **DB Reseed** 워크플로우가 자동으로 시작된다.
3. GitHub → Actions 탭 → **DB Reseed** 실행 → **Review deployments** 버튼으로 `db-reseed` 환경을 **승인**한다. 승인자는 `ChildrenAon`이다(2026-10-23 조회. 예전 배포 담당은 인수 때 뺐다).
4. 워크플로가 크론이 끝날 때까지 기다린다(`scripts/ci/wait-reseed.sh`, 최대 약 1시간). 크론 로그에 마지막 단계(19번 `seed:regulation-articles`)의 완료 문구 `regulation_versions … 건 시딩`이 나오고 실패 기록이 없으면 **성공**, 어느 단계든 `…실패:`나 `npm error`가 나오거나 시간 안에 완료되지 않으면 **실패(빨간색)**로 끝난다. 결과 로그는 같은 실행 화면의 Summary에 남는다.
   - 2026-10-13~15에는 예전 워크플로가 크론 시작 직후 로그만 받고 항상 성공으로 끝나서, 개설과목 단계 실패로 규정 재임베딩이 멈춘 것을 놓쳤다(#376, #378). 실패로 끝나면 Summary의 실패 줄부터 본다.

수동으로 돌리고 싶으면 Actions 탭 → **DB Reseed** → **Run workflow**. 다만 `db-reseed` 환경이 **`main` 브랜치만 허용**하도록 설정돼 있어서(2026-10-23 조회) 다른 브랜치를 골라 돌리면 환경 규칙에 막힌다. 수동 실행도 `main`에서 한다.

최근 정상 실행 기록: 2026-10-23 수동 실행(인수 후 새 `RAILWAY_TOKEN` 확인용, 승인부터 19번 완료까지 약 8분). 2026-10-15 수동 실행(#376 반영 후) — 새 규정 문서가 챗봇 출처에 나오는 것으로 확인. 그 전 2026-10-13·10-15(두 번)은 워크플로는 성공이었지만 규정 재임베딩이 실행되지 않았다.

### 자동 시작되는 경로

`db/regulations/**`, `db/curriculum/**`, `db/seed/curriculum_requirements.json`, `db/seed/linked_majors.json`, `db/seed/micro_degrees.json`, `db/seed/department_lineage.json`, `db/seed/course_lineage.json` (정확한 목록은 `db-reseed.yml`의 `paths:`).

새 파일을 이 경로 밖에 추가하면 재시딩이 **조용히 안 돈다.** PR에서 `DB Reseed Guard`가 이걸 경고해 준다(아래).

## 재시딩이 실제로 하는 일 — 주의할 점

Railway Cron Job `reseed-SAFE-ONLY-no-seed-js`의 Start Command는 아래와 같다(2026-10-15 대시보드 확인). **Cron Schedule은 비어 있다.** 그래서 정해진 시각에 저절로 돌지 않고, `db-reseed.yml`이 `railway up`으로 새로 배포할 때 한 번만 실행된다.

```
node db/migrate.js && npm run seed:reference-data --workspace=server && npm run seed:curriculum --workspace=server && npm run seed:curriculum-2017 --workspace=server && npm run seed:curriculum-2018 --workspace=server && npm run seed:curriculum-2019 --workspace=server && npm run seed:curriculum-2020 --workspace=server && npm run seed:curriculum-2021 --workspace=server && npm run seed:curriculum-2022 --workspace=server && npm run seed:curriculum-2023 --workspace=server && npm run seed:curriculum-2024 --workspace=server && npm run seed:curriculum-2025 --workspace=server && npm run seed:curriculum-2026 --workspace=server && npm run seed:linked-majors --workspace=server && npm run seed:lineage --workspace=server && npm run generate:curriculum-changes --workspace=server && npm run seed:course-offerings --workspace=server && npm run seed:regulations --workspace=server -- --force && npm run seed:regulation-articles --workspace=server
```

### 실행 순서와 각 단계의 완료 문구

단계는 `&&`로 이어져 있다. 모든 스크립트가 실패하면 종료 코드 1로 끝나므로, **한 단계가 실패하면 그 뒤 단계는 하나도 실행되지 않는다.**

| # | 명령 | 완료 문구(코드 기준) | 실패 문구 |
|---|---|---|---|
| 1 | `node db/migrate.js` | `[db:migrate] 완료 — 모든 테이블이 최신 상태입니다.` | `[db:migrate] 실패:` |
| 2 | `seed:reference-data` | `참조 데이터(departments, curriculum_requirements) 갱신 완료` | `참조 데이터 갱신 실패:` |
| 3 | `seed:curriculum` | `curriculum_courses 시딩 완료: 총 N개 과목` | `시딩 실패:` |
| 4–13 | `seed:curriculum-2017` … `seed:curriculum-2026` (10개) | `20XX학년도 학과별 전공과목 시딩 완료: 총 N개 행` (연도마다 한 줄) | `시딩 실패:` |
| 14 | `seed:linked-majors` | `micro_degrees: N개 프로그램, M개 과목 시딩 완료` | `시딩 실패:` |
| 15 | `seed:lineage` | `course_lineage(MANUAL): N/M건 시딩` | `시딩 실패:` |
| 16 | `generate:curriculum-changes` | `course_lineage(AUTO, 학수번호 변경): N건` | `생성 실패:` |
| 17 | `seed:course-offerings` | `course_offerings 시딩 완료` | `시딩 실패:` |
| 18 | `seed:regulations -- --force` | `규정 임베딩 시딩 완료 (정리 문서 N청크, 원문 M청크)` | `규정 시딩 실패:` |
| 19 | `seed:regulation-articles` | `regulation_versions N / regulation_articles N / regulation_relations N / regulation_applicability N건 시딩` | `seedRegulationArticles 실패:` |

**재시딩 전체가 끝났다는 표시는 19번 문구(`regulation_versions … 건 시딩`)다.** 18번의 "규정 임베딩 시딩 완료"는 마지막 단계가 아니다. 완료·실패 문구는 실제 로그가 아니라 각 스크립트의 `console.log`·`console.error`에서 가져왔다(2026-10-15 `develop` 코드 기준). 2026-10-15 정상 실행의 Railway 로그에서도 이 완료 문구가 모두 나오는 것을 확인했다. 스크립트 출력을 바꾸거나 Start Command를 바꾸면 이 표도 같이 고친다. 19번 문구는 `scripts/ci/wait-reseed.sh`의 성공 기준이기도 해서, 바꾸면 그 스크립트도 같이 고친다(`server/test/ci.waitReseed.test.js`가 어긋나면 실패한다).

### 어디서 실패하느냐에 따라 운영 챗봇에 생기는 일

- **1–17번 중 하나에서 실패:** 규정 단계(18·19)가 아예 돌지 않는다. 운영 챗봇은 **옛 문서 그대로** 답한다. 데이터가 비지는 않지만, 새 문서가 반영되지 않은 사실을 아무도 모르게 된다. 2026-10-13~15 상황이 이것이었다(17번 실패, #376).
- **18번 도중에 실패:** 가장 위험하다. `--force`는 문서마다 **기존 문서를 먼저 지우고, 임베딩(Voyage 호출)이 성공하면 다시 넣는다**(`server/scripts/seedRegulations.js`의 `seedDocument`). 그래서 임베딩 도중 실패하면 **그 문서는 운영에서 빠진 채로** 남는다. 그보다 앞의 문서는 새 버전, 뒤의 문서는 옛 버전이다. 바로 원인을 고치고 다시 돌린다.
- **19번에서 실패:** 임베딩 문서(챗봇 검색)는 반영됐다. 조문 구조 데이터(`regulation_articles` 등)만 옛것이다. 이 단계는 트랜잭션으로 묶여 있어서 실패하면 롤백되고, 반쯤 쓰인 상태로 남지 않는다.

### 재시딩이 끝났는지 확인하는 법

Railway 로그로 직접 확인할 때:

1. Railway → 서비스 `reseed-SAFE-ONLY-no-seed-js` → **Deployments** → 맨 위(방금 실행된 것) → **View Logs**를 연다.
   - CLI로 볼 때는 **배포 ID를 꼭 붙인다:** `railway logs <배포 ID> --service reseed-SAFE-ONLY-no-seed-js`. ID를 빼면 "가장 최근에 **성공한** 배포"의 로그가 나온다. 이번 실행이 실패했으면 지난번 성공 로그를 보고 잘못 판단하게 된다.
   - 18번(전체 재임베딩)은 몇 분 걸린다(2026-10-15 실측: 실행 전체 약 4분). 마지막 줄이 더 이상 바뀌지 않을 때까지 기다린다.
2. 로그를 **`실패`로 검색**해서 한 줄도 없는지 본다. (`[WARN]` 줄은 19번이 남기는 경고라 실패가 아니다.)
3. **마지막 줄 근처에 19번 문구(`regulation_versions … 건 시딩`)가 있는지** 본다.
4. 판정한다.
   - 2·3번이 모두 정상이면 끝났다. 바꾼 문서에 해당하는 질문을 챗봇에 해서 출처에 새 문서가 나오는지 확인한다.
   - 실패 문구가 있으면 위 표에서 몇 번 단계인지 찾는다. 실패 줄 앞뒤 로그를 복사해 이슈로 남기고, 원인을 고친 뒤 **Run workflow**로 다시 돌린다. 18번 실패라면 서두른다.

### 그 밖의 주의점

- **`--force`는 새 문서 하나만 추가하는 게 아니다.** 정리 문서(`db/regulations/**/*.md`)와 학칙 원문 **전체를 지우고 다시 임베딩**한다. Voyage API 호출량과 시간이 문서 전체만큼 든다. (`--force` 없이 `npm run seed:regulations`를 돌리면 이미 임베딩된 문서는 건너뛴다.)
- 정상적으로 끝나더라도 실행 중에는 문서마다 잠깐 검색에서 빠져 있다(위의 "지우고 다시 넣기"). 사용자가 적은 시간대를 고르는 편이 안전하다.
- 1번(`db/migrate.js`)의 출력도 Railway 로그에 그대로 남는다. 재시딩 로그는 GitHub Actions 로그·Summary(저장소를 볼 수 있는 누구나 봄)에 옮겨질 수 있으니, 마이그레이션·시드 스크립트에서 **학생 개인정보(닉네임 등)를 출력하지 않는다.**
- **절대 하지 말 것:** Cron Job의 Start Command에 `npm run seed --workspace=server`(`seed.js` 전체)를 넣지 않는다. 가짜 학생 계정(`seedStudents`/`seedStudentCourses`)이 승인자도 모르는 채 **운영 DB에 들어간다.** 서비스 이름의 `SAFE-ONLY-no-seed-js`가 이 경고다.
- **재시딩 서비스의 변수만 바꿀 때는 Railway 화면의 Deploy 버튼을 Alt 키를 누른 채로 누른다(저장만, 배포 안 함).** 그냥 Deploy를 누르면 이 서비스가 새로 배포되면서 Start Command가 실행돼 **전체 재시딩이 승인 없이 한 번 돈다.** 변수 변경 화면의 Deploy는 같은 환경의 바뀐 서비스를 한꺼번에 반영하므로, `web`과 같이 바꿀 때도 Alt+Deploy로 저장한 뒤 `web`만 따로 Redeploy한다.
- 승인 게이트(`db-reseed` 환경, Required reviewers)가 있는 이유는 재임베딩처럼 되돌리기 번거로운 작업이라서다. 승인하기 전에 승인 화면에서 어떤 커밋·실행인지 확인한다. 이 파이프라인은 승인 후 **그 실행의 체크아웃 커밋**(`Deploying commit <sha>`)을 Cron Job으로 새로 올려 실행한다.

## PR에서 자동으로 돌아가는 검사

- **Tests** (`test.yml`): 클라이언트(vitest)와 서버 테스트를 돌린다. 서버 테스트는 job 안의 임시 MySQL 컨테이너에 스키마·시드를 만들어 돌리며, 규정 임베딩은 가짜 벡터로 대체한다(`scripts/ci/seed-regulations-stub.js`). **시크릿을 쓰지 않고 운영 DB·Railway와 무관하다.**
- **DB Reseed Guard** (`db-reseed-guard.yml`): ① 새로 추가된 `db/regulations|curriculum|seed` 파일이 재시딩 `paths:` 필터에 걸리는지, ② `db/schema.sql`의 `CREATE TABLE`이 `IF NOT EXISTS`인지 정적으로 본다. **실행을 막지 않고 경고만** 한다. 어떤 형태로도 Railway·DB에 접근하지 않는다.
- **Vercel** (`vercel-deploy.yml`): 미리보기 URL을 PR 댓글로 달아 준다.

## 로컬에서 같은 작업을 해볼 때

```bash
node db/migrate.js                      # 스키마·컬럼 가드를 로컬 DB에 적용(멱등)
npm run seed:regulations --workspace=server   # 로컬 DB에 문서 임베딩(Voyage 호출, 이미 있으면 건너뜀)
```

로컬 `.env`의 `DB_*`가 로컬 Docker DB를 가리키는지 먼저 확인한다. `db/migrate.js`는 `DB_NAME`과 무관하게 `wku_ai_chat`에 적용된다(`DECISIONS D-50`).

## 운영 계정과 외부 서비스 (2026-10-23 인수 후)

모든 서비스가 배포 담당 한 명의 명의다. 계정은 공유하지 않는다. 로그인 정보·키 값은 이 문서에 적지 않는다.

| 서비스 | 쓰는 곳 | 메모 |
|---|---|---|
| **Railway** (Hobby, 월 $5 + 초과 사용량) | 프로젝트 `adventurous-perception`: `web`(백엔드), `MySQL`(운영 DB), `reseed-SAFE-ONLY-no-seed-js`(재시딩) | `web` 공개 주소는 `web-production-afdfe.up.railway.app`(Vercel rewrite 대상)와 `api.onestudent.io.kr`. MySQL은 외부 접속(TCP proxy) 없이 내부망으로만 붙는다. Hobby를 해지하면 60일 뒤 DB 볼륨이 지워진다 |
| **Vercel** (Hobby) | 프로젝트 `onestudent-web`(Root Directory `client`, Git 연결 없음) | 배포는 GitHub Actions(`vercel-deploy.yml`)만 한다. 프로젝트의 "Connect Git Repository"를 누르면 이중 배포가 되니 누르지 않는다. 화면 코드는 환경변수를 읽지 않는다 |
| **가비아** | 도메인 `onestudent.io.kr`, DNS | **만료 2027-09-02, 자동 연장은 일부러 꺼 두었다 → 만료 전에 직접 연장한다.** 만료되면 사이트·로그인·메일이 모두 멈춘다 |
| **Resend** | `mail.onestudent.io.kr`(인증코드 발신), `relay.onestudent.io.kr`(이메일 프록시 수신·재발송), 두 도메인 모두 Tokyo(ap-northeast-1) | 수신은 Resend Forge라 `relay` MX는 `receive-apne1.forge.rmta.net.`(우선순위 10)이다. 웹훅은 `https://onestudent.io.kr/api/email-relay/inbound`, 이벤트 `email.received` 하나. API 키는 Full access여야 프록시가 받은 메일 내용을 가져올 수 있다 |
| **Sentry** | 백엔드 오류 추적(Express, Error Monitoring만, US 리전) | DSN은 `web`의 `SENTRY_DSN` |
| **Google Cloud** | 프로젝트 `onestudent-auth`의 OAuth 클라이언트(Google 로그인) | 동의 화면의 지원 이메일·개발자 연락처도 배포 담당 계정 |
| **Anthropic, Voyage AI** | 챗봇 답변, 규정 임베딩 | Anthropic 크레딧은 자동 충전이 꺼져 있어 **잔액이 0이 되면 챗봇이 멈춘다.** 달마다 잔액을 본다 |

### DB 접속 변수는 참조로 이어져 있다

`reseed`의 `DB_PASSWORD` = `${{web.DB_PASSWORD}}`, `web`의 `DB_PASSWORD` = `${{MySQL.MYSQLPASSWORD}}`이고, `MYSQLPASSWORD`·`MYSQL_URL`은 `MYSQL_ROOT_PASSWORD`를 따른다. 그래서 DB 비밀번호는 **MySQL 서비스 → Database → Config → Regenerate**로만 바꾼다. 이 버튼이 DB 안의 비밀번호와 `MYSQL_ROOT_PASSWORD`를 함께 바꾼다. 변수를 손으로 고치거나 `ALTER USER`를 직접 실행하면 둘이 어긋나서 모든 접속이 실패한다(Railway 공식 안내). Regenerate는 MySQL만 다시 시작하므로, 끝나면 `web`을 Redeploy한다. `reseed`는 다음 재시딩 때 자동으로 새 값을 쓴다.

### 키를 바꿀 때 (2026-10-23 Railway 보안 사고 대응 때 한 순서)

새 키 발급 → Railway 변수 교체 → `web` 배포 → 로그인·챗봇으로 확인 → 옛 키 삭제. 옛 키를 먼저 지우면 그 사이 서비스가 멈춘다.

| 변수 (`web`) | 새로 만드는 곳 |
|---|---|
| `AI_API_KEY` | Anthropic Console → API Keys |
| `VOYAGE_API_KEY` (재시딩 서비스에도 있음 → Alt+Deploy로 저장) | Voyage AI 대시보드 → API Keys |
| `GOOGLE_CLIENT_SECRET` | Google Cloud → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 → 보안 비밀 추가. 새 비밀로 확인한 뒤 옛 비밀을 사용 중지 → 삭제 |
| `SESSION_SECRET` | 로컬에서 `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. 바꾸면 모든 사용자가 한 번 로그아웃된다 |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Resend → API Keys(Full access), Webhooks의 Signing Secret |
| DB 비밀번호 | 위의 Regenerate |

## 시크릿 위치

- 저장소 시크릿: `VERCEL_TOKEN`(Vercel 계정 토큰. 만료일을 정해 두었다면 만료 전에 새로 만든다), `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- `db-reseed` 환경 시크릿: `RAILWAY_TOKEN`(Railway 프로젝트 토큰, production 환경). 저장소 시크릿이 아니라 Settings → Environments → `db-reseed` 안에 있다
- 코드·문서·PR 본문에 값을 적지 않는다. 예전 GCP VM 배포용 `DEPLOY_SSH_*`는 2026-10-23에 지웠다.

## 이 저장소에서 확인하지 못한 것

- 없음. 2026-10-23에 백엔드 자동배포 브랜치(`main`)와 릴리스 절차(`develop` → `main` PR, 예: #417)를 확인했다.

2026-10-15에 확인해서 위로 옮긴 것: 재시딩 Start Command(학과별 교육과정 시드 `seed:curriculum-2017`~`2026`, `seed:linked-majors`, `seed:lineage` → `generate:curriculum-changes` 모두 포함), Pre-Deploy Command. Pre-Deploy Command 원문은 아래와 같다. 파일이 없을 때 건너뛰는 분기는 DB 파이프라인 도입 전에 넣은 것이고, 지금은 항상 `node db/migrate.js`가 실행된다.

```
if [ -f db/migrate.js ]; then node db/migrate.js; else echo "[pre-deploy] db/migrate.js not found yet — skipping until the DB pipeline PR merges"; fi
```
