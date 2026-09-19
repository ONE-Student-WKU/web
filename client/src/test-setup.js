// Vitest 전역 셋업 — toBeInTheDocument() 등 jest-dom matcher를 expect에 등록한다.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// globals: true를 안 쓰기로 해서(vite.config.js) React Testing Library의 자동 정리가
// 감지를 못 한다 — 안 붙이면 같은 파일의 이전 테스트에서 렌더한 DOM이 남아있어 여러
// 테스트에서 같은 텍스트/역할(role)을 가진 엘리먼트가 중복으로 잡히는 문제가 생긴다.
afterEach(cleanup);
