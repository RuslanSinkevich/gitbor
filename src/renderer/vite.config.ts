import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Dev URL port; keep in sync with `VITE_DEV_PORT` in root `package.json` and `main.ts` default. */
const SKYFORK_DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5188;

const DEV_CSP = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*;`;
const PROD_CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self';`;

function cspPlugin(): Plugin {
  return {
    name: 'skyfork-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.bundle) {
          return html.replace(DEV_CSP, PROD_CSP);
        }
        return html;
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), cspPlugin()],
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
