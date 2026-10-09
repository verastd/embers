// @ts-check
import js from '@eslint/js';
import embers from '@embers/eslint-plugin';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Every Next build dir (.next, the e2e ones, any local FORGE_DIST_DIR) is output, not source.
  { ignores: ['.next*/**', 'next-env.d.ts', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        // Browser + Next runtime globals used by client components.
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        console: 'readonly',
        process: 'readonly',
        AbortController: 'readonly',
        HTMLElement: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // PRD 5.9 + 6.5: AsyncButton for async clicks, no raw fetch in components, tokens only.
  { files: ['src/**/*.{ts,tsx}'], ...embers.configs.feature },
);
