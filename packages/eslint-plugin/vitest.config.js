import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
    coverage: { provider: 'v8', reporter: ['text', 'json'], include: ['src/**/*.js'], exclude: ['src/**/*.test.js'] },
  },
});
