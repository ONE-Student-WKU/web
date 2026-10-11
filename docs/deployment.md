# 배포·DB 재시딩 가이드

이 저장소는 코드를 올리는 것만으로 끝나지 않는다. **규정·교육과정 문서(`db/regulations/**` 등)를 운영 챗봇에 반영하는 길이 코드 배포와 따로 있다.** 이 문서는 그 길을 처음 보는 사람(또는 AI)도 따라올 수 있게 정리한 것이다.

> **확인 기준일: 2026-10-11.** 워크플로우 파일과 GitHub API(환경 설정, 최근 실행 기록)로 확인한 내용이다. Railway·Vercel 대시보드 설정은 저장소에서 볼 수 없어서 **"대시보드 확인 필요"**로 표시했다. 설정을 바꾸면 이 문서도 같이 고친다.

## 한눈에 보기

| 무엇 | 언제 자동으로 시작되나 | 어디서 | 사람이 할 일 |
|---|---|---|---|
| 테스트 | PR을 `main`/`develop`으로 열거나 갱신 | `.github/workflows/test.yml` | 없음 (결과 확인) |
| 프론트 미리보기 | PR을 `main`/`develop`으로 열거나 갱신 | `vercel-deploy.yml` → Vercel preview, URL을 PR 댓글로 남김 | 없음 |
| 프론트 운영 배포 | PR이 **`main`으로 머지**됨 | `vercel-deploy.yml` → Vercel production | 없음 |
| 백엔드 배포 | 머지(Railway GitHub 연동 자동배포) | Railway | 없음. 설정은 대시보드 확인 필요 |
| **DB 재시딩** (규정·교육과정 반영) | **`main` push**에 아래 경로가 포함됨 | `db-reseed.yml` → Railway Cron Job | **승인 클릭 1번** |
| DB 스키마 반영 | 배포 시 `db/migrate.js` (Railway Pre-Deploy Command로 알려져 있음) | Railway | 없음. 설정은 대시보드 확인 필요 |

브랜치 역할: `main`이 운영, `develop`이 통합 브랜치다. 운영 배포와 재시딩은 둘 다 **`main`** 기준이라, `develop`에만 머지된 변경은 운영에 반영되지 않는다.

## 가장 자주 하는 일: 문서를 운영 챗봇에 반영하기

운영 담당자에게 따로 요청하거나 운영 서버에서 명령을 직접 칠 필요가 없다.

1. `db/regulations/**` 등의 파일을 고치는 PR을 `develop`에 머지한다.
2. 그 변경이 `main`에 들어가면(보통 `develop` → `main` 릴리스 머지) **DB Reseed** 워크플로우가 자동으로 시작된다.
3. GitHub → Actions 탭 → **DB Reseed** 실행 → **Review deployments** 버튼으로 `db-reseed` 환경을 **승인**한다. 승인자는 `GitDaema`, `ChildrenAon`이다(2026-10-11 조회).
4. 실행이 끝나면 같은 실행 화면의 Summary에 재시딩 로그가 남는다. 로그에서 `[OK] 문서 제목: N개 청크`가 보이면 반영된 것이다.

수동으로 돌리고 싶으면 Actions 탭 → **DB Reseed** → **Run workflow**. 다만 `db-reseed` 환경이 **`main` 브랜치만 허용**하도록 설정돼 있어서(2026-10-11 조회) 다른 브랜치를 골라 돌리면 환경 규칙에 막힌다. 수동 실행도 `main`에서 한다.

최근 정상 실행 기록: 2026-10-07 `push main` 성공.

### 자동 시작되는 경로

`db/regulations/**`, `db/curriculum/**`, `db/seed/curriculum_requirements.json`, `db/seed/linked_majors.json`, `db/seed/micro_degrees.json`, `db/seed/department_lineage.json`, `db/seed/course_lineage.json` (정확한 목록은 `db-reseed.yml`의 `paths:`).

새 파일을 이 경로 밖에 추가하면 재시딩이 **조용히 안 돈다.** PR에서 `DB Reseed Guard`가 이걸 경고해 준다(아래).

## 재시딩이 실제로 하는 일 — 주의할 점

Railway Cron Job `reseed-SAFE-ONLY-no-seed-js`가 아래 4개를 실행한다(`db-reseed.yml` 주석 기준).

```
seed:course-offerings
seed:curriculum
seed:regulations -- --force
seed:reference-data
```

- **`--force`는 새 문서 하나만 추가하는 게 아니다.** 정리 문서(`db/regulations/**/*.md`)와 학칙 원문 **전체를 지우고 다시 임베딩**한다. Voyage API 호출량과 시간이 문서 전체만큼 든다. (`--force` 없이 `npm run seed:regulations`를 돌리면 이미 임베딩된 문서는 건너뛴다.)
- 코드상 문서 단위로 **지운 뒤 임베딩하고 다시 넣기** 때문에(`server/scripts/seedRegulations.js`의 `seedDocument`), 실행 중에는 일부 문서가 잠깐 검색에서 비어 있을 수 있다. 사용자가 적은 시간대를 고르는 편이 안전하다.
- **절대 하지 말 것:** Cron Job의 Start Command에 `npm run seed --workspace=server`(`seed.js` 전체)를 넣지 않는다. 가짜 학생 계정(`seedStudents`/`seedStudentCourses`)이 승인자도 모르는 채 **운영 DB에 들어간다.** 서비스 이름의 `SAFE-ONLY-no-seed-js`가 이 경고다.
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

## 시크릿 위치

`RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`는 GitHub Secrets에 있다. 코드·문서·PR 본문에 값을 적지 않는다.

## 이 저장소에서 확인하지 못한 것 (대시보드 확인 필요)

- Railway Cron Job의 **Start Command**가 위 4개와 정확히 일치하는지. (`db-reseed.yml` 주석에는 학과별 교육과정 시드(`seed:curriculum-2025` 등)와 연계전공 시드가 파이프라인 목록에 없다는 "미해결" 메모가 있다. 현재 `server/package.json`에는 해당 npm script가 있으니, 목록에 들어갔는지 확인이 필요하다.)
- 백엔드 서비스의 자동배포 연동 브랜치와 Pre-Deploy Command(`db/migrate.js`)가 실제로 설정돼 있는지. (README와 이슈 #226의 설명을 따른 것이다.)
- `develop`을 `main`에 올리는 릴리스 절차(PR 방식인지 직접 머지인지).
