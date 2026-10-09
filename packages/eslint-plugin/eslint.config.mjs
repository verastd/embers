// @ts-check
import js from '@eslint/js';

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  { languageOptions: { globals: { console: 'readonly' } } },
];
