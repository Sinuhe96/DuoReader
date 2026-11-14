import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
