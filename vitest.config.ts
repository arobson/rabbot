import { defineConfig } from 'vitest/config';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

// Plugin to prefer .ts over .js when both exist (for in-place migration)
function preferTsPlugin() {
  return {
    name: 'prefer-ts-over-js',
    enforce: 'pre' as const,
    resolveId(id: string, importer?: string) {
      if (id.endsWith('.js') && importer && !id.startsWith('\0')) {
        const importerDir = dirname(importer);
        const tsPath = resolve(importerDir, id.replace(/\.js$/, '.ts'));
        if (existsSync(tsPath)) {
          return tsPath;
        }
      }
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [preferTsPlugin()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./spec/setup.ts'],
    include: ['spec/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
    },
  },
});
