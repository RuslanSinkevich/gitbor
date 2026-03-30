import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Dev URL port; keep in sync with `VITE_DEV_PORT` in root `package.json` and `main.ts` default. */
const SKYFORK_DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5188;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : './',
  server: {
    host: '127.0.0.1',
    port: SKYFORK_DEV_PORT,
    strictPort: true,
    hmr: {
      host: '127.0.0.1',
      port: SKYFORK_DEV_PORT,
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@core': path.resolve(__dirname, '../core'),
    },
  },
}));
