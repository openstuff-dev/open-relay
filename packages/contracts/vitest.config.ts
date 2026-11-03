import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Types only; the server and web app test how they're used.
  test: { include: ['test/**/*.test.ts'], passWithNoTests: true },
});
