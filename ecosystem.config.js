module.exports = {
  apps: [
    {
      name: 'wku-ai-chat-server',
      script: './server/app.js',
      // 세션 미공유 방지를 위한 fork 모드 단일 인스턴스 고정, 크래시 시 자동 재시작 설정
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'wku-ai-chat-client',
      script: 'npm',
      args: 'run dev --workspace=client',
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
