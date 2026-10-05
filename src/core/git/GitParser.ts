import {
  Branch,
  Commit,
  FileChange,
  FileStatus,
  RefInfo,
  Remote,
  Stash,
  Tag,
} from './types';

const NUL = '\x00';

/**
 * Снимает C-style quoting с путей из git status/diff, когда
 * `core.quotePath=true` (или git всё же процитировал путь с пробелами).
 * Без этого `"database/foo bar/file.sql"` попадает в UI и в git diff как
 * буквальные кавычки → ls-files/diff не находят файл → ложный stat-dirty.
 */
export function unquoteGitPath(path: string): string {
  if (path.length < 2 || path[0] !== '"' || path[path.length - 1] !== '"') {
    return path;
  }
  return path
    .slice(1, -1)
    .replace(/\\([\\"nt])/g, '$1')
    .replace(/\\([0-3][0-7]{2})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function lines(stdout: string): string[] {
  if (!stdout.trim()) return [];
  return stdout.split('\n').filter(l => l.length > 0);
}

function nulFields(line: string): string[] {
  return line.replace(/\r$/, '').split(NUL);
}

// ─── Refs (from --format=%D --decorate=full) ───

/**
 * Классифицирует полностью-квалифицированный ref (`refs/heads/…`,
 * `refs/remotes/…`, `refs/tags/…`) от `--decorate=full`.
 *
 * Именно префикс позволяет отличить локальную ветку со слэшами
 * (`refs/heads/feature/x`) от remote-ветки (`refs/remotes/origin/x`) БЕЗ
 * угадывания по списку remote'ов. Угадывание по слэшу было корнем бага: любая
 * `feature/...` метилась как remote, и подпись зависела от того, успел ли
 * прийти список remote'ов.
 *
 * Возвращает `null`, если это не full-ref (короткий `%D`) — тогда вызывающий
 * код применяет фолбэк.
 */
function classifyFullRef(ref: string): RefInfo | null {
  if (ref.startsWith('refs/heads/')) return { name: ref.slice('refs/heads/'.length), type: 'branch' };
  if (ref.startsWith('refs/remotes/')) {
    // refs/remotes/<remote>/HEAD — символический указатель на дефолтную ветку
    // remote'а; дублирует одноимённый бейдж, поэтому отбрасываем как шум.
    if (ref.endsWith('/HEAD')) return null;
    return { name: ref.slice('refs/remotes/'.length), type: 'remote' };
  }
  if (ref.startsWith('refs/tags/')) return { name: ref.slice('refs/tags/'.length), type: 'tag' };
  return null;
}

export function parseRefs(refString: string): RefInfo[] {
  if (!refString.trim()) return [];

  const out: RefInfo[] = [];
  for (const raw of refString.split(',')) {
    const r = raw.trim();
    if (!r) continue;

    if (r.startsWith('HEAD -> ')) {
      const target = r.slice(8);
      const full = classifyFullRef(target);
      out.push({ name: full ? full.name : target, type: 'head' });
      continue;
    }
    if (r === 'HEAD') {
      out.push({ name: 'HEAD', type: 'head' });
      continue;
    }
    if (r.startsWith('tag: ')) {
      const tag = r.slice(5);
      out.push({ name: tag.startsWith('refs/tags/') ? tag.slice('refs/tags/'.length) : tag, type: 'tag' });
      continue;
    }

    const full = classifyFullRef(r);
    if (full) {
      out.push(full);
      continue;
    }

    // Фолбэк для короткого `%D` (без --decorate=full): слэш = remote. Оставлен
    // для совместимости; с --decorate=full сюда локальные ветки не доходят.
    if (r.includes('/')) {
      if (r.endsWith('/HEAD')) continue;
      out.push({ name: r, type: 'remote' });
      continue;
    }
    out.push({ name: r, type: 'branch' });
  }
  return out;
}

// ─── Commits (from git log --format=%H%x00%P%x00...) ───

export function parseCommits(stdout: string): Commit[] {
  const result: Commit[] = [];
  for (const raw of lines(stdout)) {
    const parts = nulFields(raw);
    if (parts.length < 7) continue;

    const [hash, parents, authorName, authorEmail, authorDate, refs, subject, gpg] = parts;
    const ts = parseInt(authorDate, 10);

    const commit: Commit = {
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName,
      authorEmail,
      authorDate: Number.isNaN(ts) ? 0 : ts * 1000,
      refs: refs ? parseRefs(refs) : [],
      subject,
      isRemoteOnly: false,
    };

    // 'N' — нет подписи (норма для большинства коммитов).
    // 'E' — подпись есть, но проверить нельзя (нет ключа в keyring) —
    // это типично для чужих репо (vscode, chromium и т.п.) и заваливает
    // экран бейджами "? Err". Считаем 'E' тоже шумом и не показываем.
    if (gpg && gpg !== 'N' && gpg !== 'E') commit.gpgStatus = gpg;

    result.push(commit);
  }
  return result;
}

// ─── Branches (from git for-each-ref --format=...%00...) ───

export function parseBranches(stdout: string, isRemote = false): Branch[] {
  const result: Branch[] = [];
  for (const raw of lines(stdout)) {
    const parts = nulFields(raw);
    if (parts.length < 2) continue;

    const [name, hash] = parts;
    if (!name) continue;

    result.push({
      name,
      hash,
      upstream: parts[2] || undefined,
      isCurrent: (parts[3] || '').trim() === '*',
      isRemote,
    });
  }
  return result;
}

// ─── Tags (from git for-each-ref --format=...%00...) ───

export function parseTags(stdout: string): Tag[] {
  const result: Tag[] = [];
  for (const raw of lines(stdout)) {
    const parts = nulFields(raw);
    if (parts.length < 2 || !parts[0]) continue;
    result.push({ name: parts[0], hash: parts[1] });
  }
  return result;
}

// ─── Stashes (from git stash list --format=%gd%x00%H%x00%gs%x00%P) ───

export function parseStashes(stdout: string): Stash[] {
  const result: Stash[] = [];
  for (const raw of lines(stdout)) {
    const parts = nulFields(raw);
    if (parts.length < 3) continue;
    const stash: Stash = { index: parts[0], hash: parts[1], message: parts[2] };
    // %P отдаёт всех родителей через пробел; база stash — первый родитель.
    const firstParent = parts[3]?.trim().split(/\s+/)[0];
    if (firstParent) stash.parentHash = firstParent;
    result.push(stash);
  }
  return result;
}

// ─── Remotes (from git remote -v) ───

export function parseRemotes(stdout: string): Remote[] {
  const map = new Map<string, { fetchUrl: string; pushUrl: string }>();

  for (const raw of lines(stdout)) {
    // URL может быть локальным путём с пробелами (`D:/My Repos/x`) — не `\S+`.
    const match = raw.replace(/\r$/, '').match(/^(\S+)\t(.+?)\s+\((fetch|push)\)$/);
    if (!match) continue;

    const [, name, url, kind] = match;
    let entry = map.get(name);
    if (!entry) {
      entry = { fetchUrl: '', pushUrl: '' };
      map.set(name, entry);
    }
    if (kind === 'fetch') entry.fetchUrl = url;
    else entry.pushUrl = url;
  }

  return Array.from(map.entries()).map(([name, urls]) => ({
    name,
    fetchUrl: urls.fetchUrl,
    pushUrl: urls.pushUrl,
  }));
}

// ─── Status (from git status --porcelain=v1) ───
// Format: XY PATH  (X=staged, Y=unstaged, positions 0,1,2=space,3+=path)
// IMPORTANT: do NOT trim() stdout before split — leading space is part of format

const STATUS_MAP: Record<string, FileStatus['status']> = {
  M: 'M', A: 'A', D: 'D', R: 'R', U: 'U', '?': '?',
};

function splitPorcelainRenamePath(pathSpec: string): [string, string] | null {
  let inQuote = false;
  let escaped = false;

  for (let i = 0; i < pathSpec.length; i++) {
    const ch = pathSpec[i];

    if (inQuote && escaped) {
      escaped = false;
      continue;
    }
    if (inQuote && ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && pathSpec.startsWith(' -> ', i)) {
      return [pathSpec.slice(0, i), pathSpec.slice(i + 4)];
    }
  }

  return null;
}

function parseStatusPath(x: string, y: string, pathSpec: string): string {
  if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
    const renamed = splitPorcelainRenamePath(pathSpec);
    if (renamed) return unquoteGitPath(renamed[1]);
  }
  return unquoteGitPath(pathSpec);
}

export function parseStatus(stdout: string): FileStatus[] {
  if (!stdout.trim()) return [];

  const results: FileStatus[] = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length < 4 || line[2] !== ' ') continue;

    const x = line[0];
    const y = line[1];
    const filePath = parseStatusPath(x, y, line.slice(3));

    // UU, AA, DD, AU, UA, DU, UD — unmerged (conflict), show only as unstaged
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      results.push({ path: filePath, status: 'U', staged: false });
      continue;
    }

    if (x !== ' ' && x !== '?') {
      results.push({ path: filePath, status: STATUS_MAP[x] || 'M', staged: true });
    }
    if (y !== ' ') {
      results.push({ path: filePath, status: STATUS_MAP[y] || 'M', staged: false });
    }
  }

  return results;
}

// ─── File changes (from git diff --name-status) ───

export function parseFileChanges(stdout: string): FileChange[] {
  const result: FileChange[] = [];
  for (const raw of lines(stdout)) {
    const parts = raw.replace(/\r$/, '').split('\t');
    if (parts.length < 2) continue;

    const status = parts[0].trim()[0];
    // Даже при `core.quotePath=false` git C-quotes пути с `"`, `\`, `\n`, `\t`.
    // Без unquoteGitPath такие пути попадают в UI с буквальными кавычками
    // и ломают последующие git-вызовы по ним (тот же баг, что чинили в parseStatus).
    if (parts.length >= 3 && (status === 'R' || status === 'C')) {
      result.push({
        status,
        path: unquoteGitPath(parts[2].trim()),
        oldPath: unquoteGitPath(parts[1].trim()),
      });
    } else {
      result.push({ status, path: unquoteGitPath(parts[1].trim()) });
    }
  }
  return result;
}

// ─── Tree snapshot (from git ls-tree -r --name-only -z) ───

/**
 * Парсит NUL-разделённый вывод `git ls-tree -r --name-only -z <hash>` в
 * плоский список путей файлов на снимке коммита. `-z` отдаёт пути без
 * C-quoting, поэтому достаточно разбить по NUL и отбросить пустые хвосты.
 */
export function parseTreePaths(stdout: string): string[] {
  if (!stdout) return [];
  return stdout.split(NUL).filter((p) => p.length > 0);
}
