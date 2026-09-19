import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // Vitest 설정 — 앱 빌드에 쓰는 이 config를 그대로 재사용해서 테스트 시 변환 결과가
  // 실제 빌드와 어긋나지 않게 한다(별도 jest.config 등을 따로 관리할 필요 없음).
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
  },
});
