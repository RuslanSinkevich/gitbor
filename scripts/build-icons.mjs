// Идемпотентный генератор placeholder-иконок для SkyFork.
// Создаёт resources/icon.png (1024x1024), resources/icon.ico, resources/icon.icns.
// Зависимости: pngjs (pure-JS PNG writer) + png2icons (ICO/ICNS из PNG-буфера).

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const RESOURCES = resolve(ROOT, 'resources');

const SIZE = 1024;

// Палитра.
const BG = { r: 0x1e, g: 0x40, b: 0xaf, a: 0xff }; // #1E40AF
const FG = { r: 0xf8, g: 0xfa, b: 0xfc, a: 0xff }; // #F8FAFC

// Скруглённый внутренний квадрат.
const INNER_RATIO = 0.6;
const innerSize = Math.round(SIZE * INNER_RATIO);
const innerOffset = Math.round((SIZE - innerSize) / 2);
const innerX0 = innerOffset;
const innerY0 = innerOffset;
const innerX1 = innerOffset + innerSize;
const innerY1 = innerOffset + innerSize;
const cornerRadius = Math.round(innerSize * 0.18);

// Треугольник внутри квадрата (вершина сверху).
const triPad = Math.round(innerSize * 0.18);
const triTopX = (innerX0 + innerX1) / 2;
const triTopY = innerY0 + triPad;
const triLeftX = innerX0 + triPad;
const triLeftY = innerY1 - triPad;
const triRightX = innerX1 - triPad;
const triRightY = innerY1 - triPad;

function inRoundedRect(x, y) {
  if (x < innerX0 || x > innerX1 - 1 || y < innerY0 || y > innerY1 - 1) return false;
  const r = cornerRadius;
  // Проверяем 4 угла.
  const corners = [
    { cx: innerX0 + r, cy: innerY0 + r, qx: x < innerX0 + r, qy: y < innerY0 + r },
    { cx: innerX1 - 1 - r, cy: innerY0 + r, qx: x > innerX1 - 1 - r, qy: y < innerY0 + r },
    { cx: innerX0 + r, cy: innerY1 - 1 - r, qx: x < innerX0 + r, qy: y > innerY1 - 1 - r },
    { cx: innerX1 - 1 - r, cy: innerY1 - 1 - r, qx: x > innerX1 - 1 - r, qy: y > innerY1 - 1 - r },
  ];
  for (const c of corners) {
    if (c.qx && c.qy) {
      const dx = x - c.cx;
      const dy = y - c.cy;
      return dx * dx + dy * dy <= r * r;
    }
  }
  return true;
}

// Знаковая площадь / barycentric для точки относительно треугольника.
function inTriangle(x, y) {
  const sign = (ax, ay, bx, by, cx, cy) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = sign(x, y, triTopX, triTopY, triLeftX, triLeftY);
  const d2 = sign(x, y, triLeftX, triLeftY, triRightX, triRightY);
  const d3 = sign(x, y, triRightX, triRightY, triTopX, triTopY);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function setPixel(buf, idx, c) {
  buf[idx] = c.r;
  buf[idx + 1] = c.g;
  buf[idx + 2] = c.b;
  buf[idx + 3] = c.a;
}

function renderPng() {
  const png = new PNG({ width: SIZE, height: SIZE });
  const data = png.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;
      if (inRoundedRect(x, y)) {
        if (inTriangle(x, y)) {
          setPixel(data, idx, BG);
        } else {
          setPixel(data, idx, FG);
        }
      } else {
        setPixel(data, idx, BG);
      }
    }
  }
  return PNG.sync.write(png);
}

function main() {
  if (!existsSync(RESOURCES)) {
    mkdirSync(RESOURCES, { recursive: true });
  }

  console.log('[build-icons] rendering 1024x1024 PNG...');
  const pngBuffer = renderPng();
  const pngPath = resolve(RESOURCES, 'icon.png');
  writeFileSync(pngPath, pngBuffer);
  console.log(`[build-icons] wrote ${pngPath} (${pngBuffer.length} bytes)`);

  console.log('[build-icons] generating ICO...');
  const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BICUBIC2, 0, false);
  if (!icoBuffer) {
    throw new Error('png2icons.createICO returned null');
  }
  const icoPath = resolve(RESOURCES, 'icon.ico');
  writeFileSync(icoPath, icoBuffer);
  console.log(`[build-icons] wrote ${icoPath} (${icoBuffer.length} bytes)`);

  console.log('[build-icons] generating ICNS...');
  const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC2, 0);
  if (!icnsBuffer) {
    throw new Error('png2icons.createICNS returned null');
  }
  const icnsPath = resolve(RESOURCES, 'icon.icns');
  writeFileSync(icnsPath, icnsBuffer);
  console.log(`[build-icons] wrote ${icnsPath} (${icnsBuffer.length} bytes)`);

  console.log('[build-icons] done.');
}

main();
