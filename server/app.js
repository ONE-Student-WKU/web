const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');

// npm workspace로 실행하면 cwd가 server/로 바뀌어 기본 dotenv 탐색(cwd 기준)이
// 리포지토리 루트의 .env를 못 찾는다. 항상 루트 .env를 절대경로로 지정해서 로드.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const onboardingRoutes = require('./routes/onboarding');
const meRoutes = require('./routes/me');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'wku-default-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // set to true if using https
  })
);

// Routes mounting
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api', meRoutes);
app.use('/api/chat', chatRoutes);

// Base Route
app.get('/', (req, res) => {
  res.send('Wonkwang University AI Chat Server is Running');
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
