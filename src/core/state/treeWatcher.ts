import { watch as fsWatch, statSync, type FSWatcher as NodeFSWatcher } from 'fs';
import { EventEmitter } from 'events';
import * as path from 'path';
import { watch as chokidarWatch } from 'chokidar';

/**
 * Наблюдение за деревом папок: одна системная подписка на весь репозиторий.
 *
 * chokidar 4 на macOS и Windows вешает отдельный fs.watch на КАЖДУЮ папку
 * worktree — на большом репо тысячи подписок: долго создаются, держат ресурсы,
 * а при выходе Node снимает их по одному десятки секунд (GitBor «висел» в доке
 * после Cmd+Q). Fork и VS Code слушают дерево одной подпиской — так и здесь:
 * `fs.watch(root, { recursive: true })` — один поток FSEvents на macOS, один
 * ReadDirectoryChangesW на Windows. Лишние папки (`node_modules`, `.git` внутри
 * worktree…) отсекаем по пути события.
 *
 * Linux остаётся на chokidar: там встроенный recursive ставит inotify на каждую
 * папку подряд, включая node_modules, и упирается в лимит inotify; chokidar
 * такие папки по `ignored` не обходит вовсе.
 */
export interface TreeWatcher {
  on(event: 'change' | 'add' | 'unlink', listener: (path: string) => void): this;
  on(event: 'error', listener: (err: unknown) => void): this;
  removeAllListeners(): this;
  close(): Promise<void>;
}

export interface TreeWatchOptions {
  /** true — событие по этому абсолютному пути не нужно. */
  ignored?: (absPath: string) => boolean;
  /** Только для chokidar (Linux): дождаться, пока файл допишут. */
  awaitWriteFinish?: { stabilityThreshold: number; pollInterval: number } | false;
}

export function usesNativeRecursiveWatch(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

export function watchTree(targets: string | string[], opts: TreeWatchOptions = {}): TreeWatcher {
  const list = Array.isArray(targets) ? targets : [targets];
  if (!usesNativeRecursiveWatch()) {
    return chokidarWatch(list, {
      ignoreInitial: true,
      ignored: opts.ignored,
      awaitWriteFinish: opts.awaitWriteFinish ?? false,
    }) as unknown as TreeWatcher;
  }
  return new NativeTreeWatcher(list, opts.ignored);
}

/**
 * fs.watch без разделения add/change/unlink: всё отдаём как 'change' —
 * FileWatcher реагирует на любое событие одинаково (debounced refresh).
 */
class NativeTreeWatcher extends EventEmitter implements TreeWatcher {
  private watchers: NodeFSWatcher[] = [];

  constructor(targets: string[], private readonly ignored?: (absPath: string) => boolean) {
    super();
    for (const target of targets) this.watchTarget(target);
  }

  private watchTarget(target: string): void {
    let isDir = false;
    try { isDir = statSync(target).isDirectory(); } catch { /* ещё не создан — слушаем родителя */ }
    // Файл (например, packed-refs) или ещё не созданный путь: слушаем папку
    // над ним без рекурсии и пропускаем всё, кроме этого имени.
    const dir = isDir ? target : path.dirname(target);
    const onlyName = isDir ? null : path.basename(target);
    try {
      const w = fsWatch(dir, { recursive: isDir, persistent: true }, (_event, filename) => {
        const rel = filename ? filename.toString() : '';
        if (onlyName && rel && rel !== onlyName) return;
        const abs = rel ? path.join(dir, rel) : dir;
        if (this.ignored?.(abs)) return;
        this.emit('change', abs);
      });
      // Например, папку удалили: подписка умирает — сообщаем, но не роняем процесс.
      w.on('error', (err) => this.emit('error', err));
      this.watchers.push(w);
    } catch (err) {
      // Слушатель 'error' FileWatcher вешает сразу после создания — отдаём в следующий тик.
      setImmediate(() => this.emit('error', err));
    }
  }

  async close(): Promise<void> {
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
  }
}
