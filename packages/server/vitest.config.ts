import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Sets a real test-only JWT_SECRET before any module is imported so the
    // server app (which now fails closed without one) can load in tests.
    setupFiles: ['./src/__tests__/global-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
