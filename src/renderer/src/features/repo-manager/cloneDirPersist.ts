/**
 * Per-machine persist для базовой папки clone/init. Хранится в `localStorage`,
 * не в `ai-config.json` или другом репо-локальном месте — это «где юзер
 * любит держать репозитории» (типа `~/repos`), не привязано к
 * конкретному проекту.
 *
 * Никакого fallback на main-side `app.getPath('home')`: native picker
 * без `defaultPath` сам открывается в разумном месте на каждой OS
 * (последний выбранный путь / home / Desktop). Поэтому пустая строка —
 * валидное значение.
 */

const KEY_CLONE_BASE = 'sg-clone-base-dir';
const KEY_INIT_BASE = 'sg-init-base-dir';

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function save(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* localStorage недоступен в SSR/strict-privacy — носить с собой ошибку
       не имеет смысла, просто молча игнорируем. */
  }
}

export function loadCloneBaseDir(): string {
  return load(KEY_CLONE_BASE);
}

export function saveCloneBaseDir(path: string): void {
  save(KEY_CLONE_BASE, path);
}

export function loadInitBaseDir(): string {
  return load(KEY_INIT_BASE);
}

export function saveInitBaseDir(path: string): void {
  save(KEY_INIT_BASE, path);
}

/**
 * Достаём имя репозитория из git-URL. Поддерживает:
 *   https://github.com/user/repo.git  -> repo
 *   git@github.com:user/repo.git      -> repo
 *   ssh://git@host/team/repo          -> repo
 *   /local/path/to/repo               -> repo
 * Возвращает пустую строку, если ничего адекватного не нашлось.
 */
export function extractRepoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const match = /([^/:\\]+?)(?:\.git)?$/.exec(trimmed);
  if (!match) return '';
  return match[1] ?? '';
}

const URL_HEURISTICS = [
  /^https?:\/\//i,
  /^git@[^:]+:/,
  /^ssh:\/\//i,
  /^git:\/\//i,
  /^[a-z]:[/\\]/i, // Windows local path "C:/..."
  /^\//,           // POSIX absolute path
  /^[~.]?\//,
];

/** «Похоже на git URL»? Используется как подсказка, не как блок сабмита. */
export function looksLikeGitUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  return URL_HEURISTICS.some((re) => re.test(u));
}

/**
 * Соединить два сегмента пути через тот же разделитель, что в `parent`
 * (главное — не подставлять `\` на POSIX). Реальный `path.join` нам
 * недоступен в renderer без node, поэтому держим маленький helper.
 */
export function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  if (!name) return parent;
  const trimmed = parent.replace(/[/\\]+$/, '');
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return `${trimmed}${sep}${name}`;
}
