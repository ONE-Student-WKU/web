module.exports = {
  apps: [
    {
      name: 'wku-ai-chat-server',
      script: './server/app.js',
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
