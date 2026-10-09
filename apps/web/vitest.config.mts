// Unit tests for the web app's server and lib code (plain TS, node env).
// Component behavior is covered in @embers/ui; pages in Playwright.
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'json'], include: ['src/server/**', 'src/lib/**'] },
  },
});
