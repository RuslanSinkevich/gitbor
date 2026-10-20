import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { watchTree, usesNativeRecursiveWatch, type TreeWatcher } from '../../src/core/state/treeWatcher';

/**
 * Настоящая файловая система: одна подписка на дерево (macOS/Windows — fs.watch
 * recursive, Linux — chokidar). Ждём события через vi.waitFor-подобный цикл.
 */
let root: string;
let watcher: TreeWatcher | null = null;

afterEach(async () => {
  await watcher?.close();
  watcher = null;
  rmSync(root, { recursive: true, force: true });
});

async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 25));
  }
}

const ready = () => new Promise(r => setTimeout(r, usesNativeRecursiveWatch() ? 100 : 400));

describe('watchTree', () => {
  it('вложенный файл на любой глубине даёт событие, ignored — нет', async () => {
    root = mkdtempSync(join(realpathSync(tmpdir()), 'gitbor-tw-'));
    mkdirSync(join(root, 'src', 'deep', 'er'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    const seen: string[] = [];
    watcher = watchTree(root, { ignored: p => /node_modules/.test(p) });
    watcher.on('change', p => seen.push(p)).on('add', p => seen.push(p)).on('error', () => {});
    await ready();
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'x');
    writeFileSync(join(root, 'src', 'deep', 'er', 'file.ts'), 'x');
    await until(() => seen.some(p => p.endsWith('file.ts')));
    expect(seen.some(p => /node_modules/.test(p))).toBe(false);
  });

  it('цель-файл (packed-refs): событие по нему, соседние файлы — нет', async () => {
    root = mkdtempSync(join(realpathSync(tmpdir()), 'gitbor-tw-'));
    writeFileSync(join(root, 'packed-refs'), '');
    const seen: string[] = [];
    watcher = watchTree(join(root, 'packed-refs'));
    watcher.on('change', p => seen.push(p)).on('add', p => seen.push(p)).on('error', () => {});
    await ready();
    writeFileSync(join(root, 'other'), 'x');
    writeFileSync(join(root, 'packed-refs'), 'abc refs/heads/main\n');
    await until(() => seen.some(p => p.endsWith('packed-refs')));
    expect(seen.some(p => p.endsWith('other'))).toBe(false);
  });

  it('папку внутри можно удалить, пока идёт наблюдение', async () => {
    root = mkdtempSync(join(realpathSync(tmpdir()), 'gitbor-tw-'));
    mkdirSync(join(root, 'release', 'win-unpacked'), { recursive: true });
    writeFileSync(join(root, 'release', 'win-unpacked', 'app.asar'), 'x');
    watcher = watchTree(root);
    watcher.on('error', () => {});
    await ready();
    expect(() => rmSync(join(root, 'release'), { recursive: true })).not.toThrow();
  });
});
