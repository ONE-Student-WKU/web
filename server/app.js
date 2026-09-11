const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

// npm workspace로 실행하면 cwd가 server/로 바뀌어 기본 dotenv 탐색(cwd 기준)이
// 리포지토리 루트의 .env를 못 찾는다. 항상 루트 .env를 절대경로로 지정해서 로드.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('./db');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const onboardingRoutes = require('./routes/onboarding');
const meRoutes = require('./routes/me');
const coursesRoutes = require('./routes/courses');
const myCoursesRoutes = require('./routes/myCourses');
const graduationRoutes = require('./routes/graduation');
const careerRoutes = require('./routes/career');
const adminRoutes = require('./routes/admin');

const app = express();
// Railway/Render 같은 PaaS는 자체적으로 PORT를 주입하고 그 포트로 리슨해야 라우팅이
// 붙는다 — SERVER_PORT는 로컬 개발용 수동 지정 값으로 남겨두고 PORT를 우선한다.
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

// Railway 같은 리버스 프록시 뒤에서 구동되므로, 프록시가 전달하는 프로토콜(X-Forwarded-Proto)을
// 신뢰해야 세션 쿠키의 secure 판정 등이 정확히 동작한다.
app.set('trust proxy', 1);

// 어떤 프레임워크를 쓰는지 응답 헤더로 알려줄 필요 없음(불필요한 정찰 정보 노출 방지).
app.disable('x-powered-by');

// 프로덕션에서 SESSION_SECRET을 설정하지 않으면 코드에 박힌 기본값으로 세션이 서명되어
// 누구나 유효한 세션 쿠키를 위조할 수 있게 된다 — 조용히 넘어가지 않고 기동을 막는다.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET 환경변수가 설정되지 않았습니다. 프로덕션에서는 필수입니다.');
}

// Middlewares
// CLIENT_ORIGIN 미설정 시(로컬 개발 등) 기존과 동일하게 모든 origin을 허용함.
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 기존 mysql2 커넥션 풀을 그대로 재사용 — 세션 전용 DB 접속 정보를 따로 두지 않는다.
// createDatabaseTable: false — sessions 테이블은 db/schema.sql + db/migrate.js로 직접
// 관리한다(다른 테이블과 동일한 컨벤션. 라이브러리가 조용히 자체 스키마를 만들게 두지 않음).
const sessionStore = new MySQLStore({ createDatabaseTable: false }, pool);

// 로그인 상태를 기본적으로 유지시킨다 — 30일 이내 재방문이면 별도 재로그인 없이 세션이
// 살아있어야 한다(세션 저장소를 MemoryStore에서 DB로 옮긴 것과 짝을 이루는 변경 — 저장소만
// 영속화하고 maxAge를 안 늘리면 브라우저 종료 시 어차피 로그아웃되어 체감 효과가 없다).
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'wku-default-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      // 배포 환경(HTTPS)에서만 secure 쿠키를 강제하고, 로컬 http 개발 환경은 기존과 동일하게 유지.
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_MS,
    },
  })
);

// Routes mounting
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api', meRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/my-courses', myCoursesRoutes);
app.use('/api/graduation', graduationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/career', careerRoutes);
app.use('/api/admin', adminRoutes);

// Base Route
app.get('/', (req, res) => {
  res.send('Wonkwang University AI Chat Server is Running');
});

// Version — 지금 응답 중인 서버가 어느 커밋을 돌리고 있는지 Railway 대시보드 접근 권한
// 없이도 확인할 수 있게 함(PR #152 근본 원인: 배포 반영 여부를 아무도 쉽게 확인 못 함).
// RAILWAY_GIT_COMMIT_SHA/RAILWAY_GIT_BRANCH는 Railway가 GitHub 연동 배포 시 자동 주입하는
// 값 — 로컬처럼 이 값이 없는 환경에서는 'unknown'으로 대체되어 절대 예외를 던지지 않는다.
app.get('/api/version', (req, res) => {
  res.json({
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
    branch: process.env.RAILWAY_GIT_BRANCH || 'unknown',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: null, data: null });
});

// Server Initialization
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
