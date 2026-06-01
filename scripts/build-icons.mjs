// Генератор иконок для GitBor (Electron) и gitbor-web (favicon).
//
// Использование:
//   node scripts/build-icons.mjs                          — из resources/icon-source.png
//   node scripts/build-icons.mjs --source path/to/img.png — из произвольного файла
//   node scripts/build-icons.mjs --favicon path/to/favi.png --web-dir ../gitbor-web/public
//
// Результат (Electron):
//   resources/icon.png  (1024×1024)
//   resources/icon.ico  (multi-size)
//   resources/icon.icns (multi-size)
//
// Результат (Web, если передан --favicon):
//   {web-dir}/favicon.ico          (48×48)
//   {web-dir}/favicon-16x16.png    (16×16)
//   {web-dir}/favicon-32x32.png    (32×32)
//   {web-dir}/apple-touch-icon.png (180×180)
//   {web-dir}/icon-192.png         (192×192)
//   {web-dir}/icon-512.png         (512×512)
//
// Зависимости: pngjs + png2icons (уже в devDependencies).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const RESOURCES = resolve(ROOT, 'resources');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { source: null, favicon: null, webDir: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) opts.source = resolve(args[++i]);
    if (args[i] === '--favicon' && args[i + 1]) opts.favicon = resolve(args[++i]);
    if (args[i] === '--web-dir' && args[i + 1]) opts.webDir = resolve(args[++i]);
  }
  return opts;
}

function loadPng(filePath) {
  const buf = readFileSync(filePath);
  return PNG.sync.read(buf);
}

function removeOrangeDots(png) {
  const d = png.data;
  const len = d.length;
  const treeR = 0x1e, treeG = 0x3a, treeB = 0x3a;
  for (let i = 0; i < len; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const isTree = (r < 50 && g < 70 && b < 70);
    const isWhite = (r > 240 && g > 240 && b > 240);
    if (!isTree && !isWhite && d[i + 3] > 0) {
      d[i] = treeR; d[i + 1] = treeG; d[i + 2] = treeB;
    }
  }
  return png;
}

function removeWhiteBg(png) {
  const d = png.data;
  const len = d.length;
  const threshold = 240;
  for (let i = 0; i < len; i += 4) {
    if (d[i] >= threshold && d[i + 1] >= threshold && d[i + 2] >= threshold) {
      d[i + 3] = 0;
    }
  }
  return png;
}

function unifyTreeColors(png) {
  const d = png.data;
  const treeR = 0x1e, treeG = 0x3a, treeB = 0x3a;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 60 && r < 140 && g > 80 && g < 160 && b > 80 && b < 160 &&
        Math.abs(g - b) < 30) {
      d[i] = treeR; d[i + 1] = treeG; d[i + 2] = treeB;
    }
  }
  return png;
}

function padToSquare(srcPng) {
  const { width, height, data } = srcPng;
  if (width === height) return srcPng;

  const side = Math.max(width, height);
  const dst = new PNG({ width: side, height: side, fill: true });
  const dd = dst.data;
  dd.fill(0);

  const ox = Math.floor((side - width) / 2);
  const oy = Math.floor((side - height) / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = ((y + oy) * side + (x + ox)) * 4;
      dd[di] = data[si];
      dd[di + 1] = data[si + 1];
      dd[di + 2] = data[si + 2];
      dd[di + 3] = data[si + 3];
    }
  }
  return dst;
}

const TREE_COLOR = { r: 0x1e, g: 0x3a, b: 0x3a }; // #1e3a3a — dark teal
const OUTLINE_COLOR = { r: 0x1e, g: 0x3a, b: 0x3a };
const TRUNK_COLOR = { r: 0x1e, g: 0x3a, b: 0x3a };
const BG_COLOR = { r: 0xff, g: 0xff, b: 0xff, a: 0xff };

function renderTreeIcon(size) {
  const png = new PNG({ width: size, height: size });
  const d = png.data;
  const S = size;

  const cx = Math.floor(S / 2);
  const trunkW = Math.round(S * 0.02);
  const trunkTop = Math.round(S * 0.76);
  const trunkBot = Math.round(S * 0.88);

  const triangles = [
    { tipY: S * 0.12, baseY: S * 0.35, halfW: S * 0.14 },
    { tipY: S * 0.30, baseY: S * 0.55, halfW: S * 0.24 },
    { tipY: S * 0.48, baseY: S * 0.76, halfW: S * 0.34 },
  ];

  function inTree(x, y) {
    for (const tri of triangles) {
      if (y >= tri.tipY && y <= tri.baseY) {
        const frac = (y - tri.tipY) / (tri.baseY - tri.tipY);
        if (Math.abs(x - cx) <= frac * tri.halfW) return true;
      }
    }
    if (y >= trunkTop && y <= trunkBot && Math.abs(x - cx) <= trunkW) return true;
    return false;
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (inTree(x, y)) {
        d[i] = TREE_COLOR.r; d[i+1] = TREE_COLOR.g; d[i+2] = TREE_COLOR.b; d[i+3] = 255;
      } else {
        d[i] = BG_COLOR.r; d[i+1] = BG_COLOR.g; d[i+2] = BG_COLOR.b; d[i+3] = 255;
      }
    }
  }

  addRoundedOutline(png);
  return png;
}

function addRoundedOutline(png) {
  const S = png.width;
  const d = png.data;
  const thick = Math.max(Math.round(S * 0.02), 1);
  const pad = Math.round(S * 0.02);
  const radius = Math.round(S * 0.18);
  const x0 = pad, y0 = pad, x1 = S - 1 - pad, y1 = S - 1 - pad;

  function distToRoundedRect(px, py) {
    let cx = px, cy = py;
    cx = Math.max(x0 + radius, Math.min(x1 - radius, cx));
    cy = Math.max(y0 + radius, Math.min(y1 - radius, cy));

    if (px < x0 + radius && py < y0 + radius) {
      const dx = px - (x0 + radius), dy = py - (y0 + radius);
      return Math.sqrt(dx * dx + dy * dy) - radius;
    }
    if (px > x1 - radius && py < y0 + radius) {
      const dx = px - (x1 - radius), dy = py - (y0 + radius);
      return Math.sqrt(dx * dx + dy * dy) - radius;
    }
    if (px < x0 + radius && py > y1 - radius) {
      const dx = px - (x0 + radius), dy = py - (y1 - radius);
      return Math.sqrt(dx * dx + dy * dy) - radius;
    }
    if (px > x1 - radius && py > y1 - radius) {
      const dx = px - (x1 - radius), dy = py - (y1 - radius);
      return Math.sqrt(dx * dx + dy * dy) - radius;
    }

    const dLeft = px - x0, dRight = x1 - px;
    const dTop = py - y0, dBottom = y1 - py;
    if (dLeft < 0) return -dLeft;
    if (dRight < 0) return -dRight;
    if (dTop < 0) return -dTop;
    if (dBottom < 0) return -dBottom;
    return -Math.min(dLeft, dRight, dTop, dBottom);
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dist = distToRoundedRect(x, y);
      const halfT = thick / 2;
      const edgeDist = Math.abs(dist) - halfT;

      if (edgeDist <= 0) {
        const i = (y * S + x) * 4;
        d[i]     = OUTLINE_COLOR.r;
        d[i + 1] = OUTLINE_COLOR.g;
        d[i + 2] = OUTLINE_COLOR.b;
        d[i + 3] = 255;
      }
    }
  }
  return png;
}

function resizePng(srcPng, targetSize) {
  const dst = new PNG({ width: targetSize, height: targetSize });
  const sw = srcPng.width;
  const sh = srcPng.height;
  const sd = srcPng.data;
  const dd = dst.data;
  const xRatio = sw / targetSize;
  const yRatio = sh / targetSize;

  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const srcX0 = x * xRatio;
      const srcY0 = y * yRatio;
      const srcX1 = Math.min((x + 1) * xRatio, sw);
      const srcY1 = Math.min((y + 1) * yRatio, sh);

      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(srcY0); sy < Math.ceil(srcY1); sy++) {
        for (let sx = Math.floor(srcX0); sx < Math.ceil(srcX1); sx++) {
          const overlapX = Math.min(sx + 1, srcX1) - Math.max(sx, srcX0);
          const overlapY = Math.min(sy + 1, srcY1) - Math.max(sy, srcY0);
          const w = overlapX * overlapY;
          const si = (sy * sw + sx) * 4;
          r += sd[si] * w;
          g += sd[si + 1] * w;
          b += sd[si + 2] * w;
          a += sd[si + 3] * w;
          area += w;
        }
      }

      const di = (y * targetSize + x) * 4;
      dd[di] = Math.round(r / area);
      dd[di + 1] = Math.round(g / area);
      dd[di + 2] = Math.round(b / area);
      dd[di + 3] = Math.round(a / area);
    }
  }
  return dst;
}

function writePngFile(png, filePath) {
  const buf = PNG.sync.write(png);
  writeFileSync(filePath, buf);
  console.log(`  → ${filePath} (${buf.length} bytes)`);
  return buf;
}

function buildIcoManual(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  const dirSize = headerSize + count * entrySize;

  let dataOffset = dirSize;
  const entries = pngBuffers.map(buf => {
    const png = PNG.sync.read(buf);
    const w = png.width >= 256 ? 0 : png.width;
    const h = png.height >= 256 ? 0 : png.height;
    const entry = { w, h, buf, offset: dataOffset };
    dataOffset += buf.length;
    return entry;
  });

  const totalSize = dataOffset;
  const ico = Buffer.alloc(totalSize);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(count, 4);

  entries.forEach((e, i) => {
    const off = headerSize + i * entrySize;
    ico.writeUInt8(e.w, off);
    ico.writeUInt8(e.h, off + 1);
    ico.writeUInt8(0, off + 2);
    ico.writeUInt8(0, off + 3);
    ico.writeUInt16LE(1, off + 4);
    ico.writeUInt16LE(32, off + 6);
    ico.writeUInt32LE(e.buf.length, off + 8);
    ico.writeUInt32LE(e.offset, off + 12);
  });

  entries.forEach(e => {
    e.buf.copy(ico, e.offset);
  });

  return ico;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function buildElectronIcons(sourcePath, smallSourcePath) {
  ensureDir(RESOURCES);

  console.log(`[build-icons] source: ${sourcePath}`);
  const rawPng = loadPng(sourcePath);
  console.log(`[build-icons] loaded ${rawPng.width}×${rawPng.height}`);
  const srcPng = unifyTreeColors(removeWhiteBg(padToSquare(rawPng)));

  let smallPng = null;
  if (smallSourcePath && existsSync(smallSourcePath)) {
    console.log(`[build-icons] small icon source: ${smallSourcePath}`);
    smallPng = removeWhiteBg(padToSquare(loadPng(smallSourcePath)));
  }

  const icon1024 = srcPng.width === 1024 && srcPng.height === 1024
    ? srcPng
    : resizePng(srcPng, 1024);

  console.log('[build-icons] writing resources/icon.png (1024×1024)...');
  const pngBuffer = writePngFile(icon1024, resolve(RESOURCES, 'icon.png'));

  // Linux: electron-builder ставит linux.icon как есть. Один размер 1024×1024
  // ломает by-name lookup (`Icon=gitbor`) в GNOME/KDE -> generic-заглушка
  // («шестерёнка»). Отдаём директорию со стандартными размерами hicolor —
  // тогда electron-builder ставит весь набор и иконка резолвится у всех.
  console.log('[build-icons] generating Linux icon set (resources/icons/)...');
  const linuxDir = resolve(RESOURCES, 'icons');
  ensureDir(linuxDir);
  const linuxSizes = [16, 32, 48, 64, 128, 256, 512];
  for (const s of linuxSizes) {
    const src = (s <= 16 && smallPng) ? smallPng : srcPng;
    writePngFile(resizePng(src, s), resolve(linuxDir, `${s}x${s}.png`));
  }

  console.log('[build-icons] generating ICO (manual multi-size)...');
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBufs = icoSizes.map(s => {
    const src = (s <= 16 && smallPng) ? smallPng : srcPng;
    return PNG.sync.write(resizePng(src, s));
  });
  const icoBuffer = buildIcoManual(pngBufs);
  const icoPath = resolve(RESOURCES, 'icon.ico');
  writeFileSync(icoPath, icoBuffer);
  console.log(`  → ${icoPath} (${icoBuffer.length} bytes, ${icoSizes.length} sizes)`);

  console.log('[build-icons] generating ICNS...');
  const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC2, 0);
  if (!icnsBuffer) throw new Error('png2icons.createICNS returned null');
  const icnsPath = resolve(RESOURCES, 'icon.icns');
  writeFileSync(icnsPath, icnsBuffer);
  console.log(`  → ${icnsPath} (${icnsBuffer.length} bytes)`);
}

function buildWebFavicons(faviconSourcePath, webDir, mainSourcePath) {
  ensureDir(webDir);

  const rawFavi = loadPng(faviconSourcePath);
  console.log(`[build-icons] favicon small source: ${rawFavi.width}×${rawFavi.height}`);
  const smallPng = removeWhiteBg(padToSquare(rawFavi));

  const rawMain = loadPng(mainSourcePath);
  console.log(`[build-icons] favicon main source: ${rawMain.width}×${rawMain.height}`);
  const srcPng = unifyTreeColors(removeWhiteBg(padToSquare(rawMain)));

  const sizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
  ];

  console.log('[build-icons] generating web favicons...');
  for (const { name, size } of sizes) {
    const src = (size <= 32) ? smallPng : srcPng;
    const resized = resizePng(src, size);
    writePngFile(resized, resolve(webDir, name));
  }

  const faviIcoSizes = [16, 32, 48];
  const faviBufs = faviIcoSizes.map(s => PNG.sync.write(resizePng(smallPng, s)));
  const icoBuffer = buildIcoManual(faviBufs);
  const icoPath = resolve(webDir, 'favicon.ico');
  writeFileSync(icoPath, icoBuffer);
  console.log(`  → ${icoPath} (${icoBuffer.length} bytes)`);
}

function main() {
  const opts = parseArgs();

  const appSource = opts.source || resolve(RESOURCES, 'icon-source.png');
  if (!existsSync(appSource)) {
    console.error(`[build-icons] source not found: ${appSource}`);
    console.error('  Copy your icon to resources/icon-source.png or pass --source path/to/icon.png');
    process.exit(1);
  }
  const smallSource = opts.favicon || null;
  buildElectronIcons(appSource, smallSource);

  if (opts.webDir) {
    const webDir = opts.webDir;
    const faviSource = smallSource || appSource;
    buildWebFavicons(faviSource, webDir, appSource);
  }

  console.log('[build-icons] done.');
}

main();
