import { build } from 'esbuild';
import { build as buildClient } from 'vite';
await buildClient();
await build({
  entryPoints: ['server/handler.ts'],
  outfile: 'dist/serverless.cjs',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  bundle: true,
  external: ['better-sqlite3', 'pg-native', 'pdfkit'],
  define: { 'process.env.NODE_ENV': '"production"' },
});

