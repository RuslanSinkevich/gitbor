import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

/** Dev URL port; keep in sync with `VITE_DEV_PORT` in root `package.json` and `main.ts` default. */
const SKYFORK_DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5188;

const DEV_CSP = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*;`;
// PROD CSP: deny unsafe-eval/unsafe-inline для script (XSS-defence-in-depth);
// connect-src содержит `https:` потому что динамический whitelist AI-URL'ов
// в meta-CSP технически невозможен (meta нельзя менять после загрузки), а
// провайдеры (OpenAI/Qwen/etc.) живут на разных доменах. Всё-таки renderer
// сам HTTP в AI не дёргает — это делает main, поэтому `https:` — задел на
// будущее и страховка.
const PROD_CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none';`;

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

// SKYFORK_ANALYZE=1 — добавляем rollup-plugin-visualizer и кладём отчёт
// в docs/audit/bundle-<today>.html. Используется через `npm run analyze`.
const ANALYZE = process.env.SKYFORK_ANALYZE === '1';
const today = new Date().toISOString().slice(0, 10);
const analyzeOut = path.resolve(__dirname, '../../docs/audit', `bundle-${today}.html`);

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cspPlugin(),
    ...(ANALYZE
      ? [
          visualizer({
            filename: analyzeOut,
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }) as Plugin,
        ]
      : []),
  ],
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
