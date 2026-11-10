import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // une base de test partagée, réinitialisée par fichier
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
