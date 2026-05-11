import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
      $app: path.resolve('./node_modules/@sveltejs/kit/src/runtime/app')
    }
  },
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'src/**/*.test.ts'
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/server/db/migrations/**', '**/*.test.ts']
    }
  }
});
