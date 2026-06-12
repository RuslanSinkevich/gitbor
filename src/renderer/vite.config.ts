import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';

/** Dev URL port; keep in sync with `VITE_DEV_PORT` in root `package.json` and `main.ts` default. */
const GITBOR_DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5188;

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
    name: 'gitbor-csp',
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

// GITBOR_ANALYZE=1 — добавляем rollup-plugin-visualizer и кладём отчёт
// в bundle-analysis/bundle-<today>.html (gitignored). Через `npm run analyze`.
const ANALYZE = process.env.GITBOR_ANALYZE === '1';
const today = new Date().toISOString().slice(0, 10);
const analyzeOut = path.resolve(__dirname, '../../bundle-analysis', `bundle-${today}.html`);

// Bundle size regression gate. baseline 2026-05-28 (после Solo/Hide + AI
// settings redesign + Tier-2 фич): главный chunk ~392 KB raw / ~123 KB gzip.
// 2026-05-31: stash-мини-ветки в графе + markdown-заметки + модалка
// поддержки + персональные инсайты статистики + унификация спиннеров на
// кнопках. Тяжёлое (Markdown, SupportDialog) вынесено в lazy-чанки; в
// главный попал только код графа стэшей (часть всегда-загружаемого графа),
// поэтому gzip-порог поднят 130 → 132 KB. Raw без изменений (430).
// 2026-06-01: overview-ruler (полоса-обзор изменений) для inline/split-видов
// diff + сводка строк (+N/−M) в тулбаре. Canvas-миникарта и обёртка вынесены
// в lazy-чанк; в главный попал минимальный eager-glue (lazy()/Suspense) и
// подсчёт строк в DiffView. Пороги подняты gzip 132 → 133, raw 431 → 432 KB.
// 2026-06-03: ПКМ «Копировать» на diff (`useDiffCopyMenu` + локальный
// SgContextMenu) и кнопка «Просмотр Markdown» в diff-тулбаре. Сама модалка
// (Markdown-парсер) уехала в lazy-chunk (`Markdown-*.js`, ~3 KB), но
// eager-обёртки + `data-diff-line` атрибуты + новые i18n-строки прибавили
// ~3 KB в главный chunk. Пороги: gzip 133 → 136, raw 432 → 440 KB.
// 2026-06-06: выделение выбранной ветки в сайдбаре, повторный диалог Push при
// mismatch upstream, Track Remote Branch (меню + диалог), ПКМ-журнал истории
// файла (View/Compare). Eager-код в графе/сайдбаре/useSyncActions + i18n
// прибавили ~4 KB в главный chunk (диалоги credential/settings остались
// lazy). Пороги: gzip 136 → 138, raw 440 → 446 KB.
// 2026-06-07: фокус графа по повторному клику (focusNonce), Track по двойному
// клику, контекстный LFS (getLfsActive), submenu в MenuBar, короткие имена в
// контекстном меню веток. Eager-код прибавил ~0.7 KB raw в главный chunk
// (gzip почти не изменился). Порог raw 446 → 448 KB, gzip остаётся 138.
// При GITBOR_BUNDLE_GATE_OFF=1 чек отключается (для локальных экспериментов).
const BUNDLE_MAX_RAW_BYTES = 448 * 1024;
const BUNDLE_MAX_GZIP_BYTES = 138 * 1024;
const BUNDLE_GATE_DISABLED = process.env.GITBOR_BUNDLE_GATE_OFF === '1';

function bundleSizeGatePlugin(): Plugin {
  return {
    name: 'gitbor-bundle-size-gate',
    apply: 'build',
    closeBundle() {
      if (BUNDLE_GATE_DISABLED) {
        console.log('[bundle-gate] skipped (GITBOR_BUNDLE_GATE_OFF=1)');
        return;
      }
      const assetsDir = path.resolve(__dirname, '../../dist/renderer/assets');
      if (!fs.existsSync(assetsDir)) {
        console.warn(`[bundle-gate] assets dir not found: ${assetsDir}`);
        return;
      }
      const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
      if (jsFiles.length === 0) {
        console.warn('[bundle-gate] no .js assets found');
        return;
      }
      // Главный chunk — самый большой .js (как правило index-<hash>.js).
      let mainFile = '';
      let mainRaw = 0;
      let mainGzip = 0;
      for (const f of jsFiles) {
        const buf = fs.readFileSync(path.join(assetsDir, f));
        if (buf.length > mainRaw) {
          mainFile = f;
          mainRaw = buf.length;
          mainGzip = zlib.gzipSync(buf, { level: 9 }).length;
        }
      }
      const rawKb = (mainRaw / 1024).toFixed(2);
      const gzipKb = (mainGzip / 1024).toFixed(2);
      const rawLimitKb = (BUNDLE_MAX_RAW_BYTES / 1024).toFixed(0);
      const gzipLimitKb = (BUNDLE_MAX_GZIP_BYTES / 1024).toFixed(0);
      console.log(
        `[bundle-gate] main chunk ${mainFile}: ${rawKb} KB raw / ${gzipKb} KB gzip ` +
          `(limit ${rawLimitKb} KB raw / ${gzipLimitKb} KB gzip)`,
      );
      if (mainRaw > BUNDLE_MAX_RAW_BYTES || mainGzip > BUNDLE_MAX_GZIP_BYTES) {
        const msg =
          `[bundle-gate] FAIL: main chunk exceeds limit. ` +
          `${rawKb} KB raw (max ${rawLimitKb}) / ${gzipKb} KB gzip (max ${gzipLimitKb}). ` +
          `Investigate the regression or raise the threshold in src/renderer/vite.config.ts.`;
        console.error(msg);
        process.exit(1);
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cspPlugin(),
    bundleSizeGatePlugin(),
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
    port: GITBOR_DEV_PORT,
    strictPort: true,
    hmr: {
      host: '127.0.0.1',
      port: GITBOR_DEV_PORT,
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
