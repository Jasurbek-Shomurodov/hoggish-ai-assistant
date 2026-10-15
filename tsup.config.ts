import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: ['react', 'exceljs', 'zod', 'ai', '@ai-sdk/anthropic', '@ai-sdk/google'],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      server: 'src/server.ts',
      markdown: 'src/markdown.ts',
      excel: 'src/excel.ts',
      supabase: 'src/supabase.ts',
    },
    splitting: true,
    clean: false,
  },
  {
    ...shared,
    entry: { react: 'src/react.tsx' },
    // Next.js App Router needs the directive on the client entry.
    banner: { js: "'use client';" },
    treeshake: false,
  },
]);
