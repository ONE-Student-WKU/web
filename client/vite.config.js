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
    // userEvent로 여러 화면을 오가는 테스트(예: 커뮤니티 신고, 진로 탐색 고정 질문 5개)는 전체 스위트를 병렬로 돌릴 때
    // 기본 5초를 넘겨 간헐적으로 실패했다 — 로직 문제가 아니라 CPU 경쟁이라 여유를 둔다.
    testTimeout: 15000,
  },
});
