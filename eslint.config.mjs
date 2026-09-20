import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'app/src/shared/*.d.ts',
      'examples/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
];
