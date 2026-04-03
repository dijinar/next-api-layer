/// <reference types="node" />
import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'fs';

// Add 'use client' directive to client files after build
function addUseClientDirective() {
  const files = ['dist/client.js', 'dist/client.cjs'];
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      if (!content.startsWith('"use client"')) {
        writeFileSync(file, `"use client";\n${content}`);
      }
    } catch {
      // File might not exist yet
    }
  }
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    api: 'src/api/index.ts',
    client: 'src/client/index.ts',
    server: 'src/server/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: true,
  external: [
    'react',
    'react-dom',
    'next',
    'next/server',
    'next/headers',
    'next/navigation',
    'next-intl',
    'swr',
  ],
  onSuccess: async () => {
    addUseClientDirective();
  },
});
