module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.3' } },
  plugins: ['react-refresh'],
  rules: {
    // 이 코드베이스는 컴포넌트 props를 PropTypes가 아니라 JSDoc 주석으로 문서화한다
    // (TypeScript도 안 씀) — PropTypes 도입은 이 설정 파일 추가와는 별개의 작업.
    'react/prop-types': 'off',
    // JSX 텍스트 안의 " ' 를 &quot;/&apos; 로 바꾸라는 규칙 — 렌더링 결과에 차이가 없는
    // 순수 스타일 규칙이라, 실제 UI 문구에 따옴표를 그대로 쓰는 이 코드베이스 관례와
    // 충돌한다. 기존 문구를 바꾸기보다 규칙을 끈다.
    'react/no-unescaped-entities': 'off',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
};
