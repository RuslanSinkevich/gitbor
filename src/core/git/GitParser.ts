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

// ─── Refs (from --format=%D) ───

export function parseRefs(refString: string): RefInfo[] {
  if (!refString.trim()) return [];

  return refString.split(',').map(raw => {
    const r = raw.trim();

    if (r.startsWith('HEAD -> ')) {
      return { name: r.slice(8), type: 'head' as const };
    }
    if (r === 'HEAD') {
      return { name: 'HEAD', type: 'head' as const };
    }
    if (r.startsWith('tag: ')) {
      return { name: r.slice(5), type: 'tag' as const };
    }
    if (r.includes('/')) {
      return { name: r, type: 'remote' as const };
    }
    return { name: r, type: 'branch' as const };
  });
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

// ─── Stashes (from git stash list --format=%gd%x00%H%x00%gs) ───

export function parseStashes(stdout: string): Stash[] {
  const result: Stash[] = [];
  for (const raw of lines(stdout)) {
    const parts = nulFields(raw);
    if (parts.length < 3) continue;
    result.push({ index: parts[0], hash: parts[1], message: parts[2] });
  }
  return result;
}

// ─── Remotes (from git remote -v) ───

export function parseRemotes(stdout: string): Remote[] {
  const map = new Map<string, { fetchUrl: string; pushUrl: string }>();

  for (const raw of lines(stdout)) {
    const match = raw.match(/^(\S+)\t(\S+)\s+\((fetch|push)\)$/);
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

export function parseStatus(stdout: string): FileStatus[] {
  if (!stdout.trim()) return [];

  const results: FileStatus[] = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length < 4 || line[2] !== ' ') continue;

    const x = line[0];
    const y = line[1];
    const filePath = unquoteGitPath(line.slice(3));

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
    if (parts.length >= 3 && (status === 'R' || status === 'C')) {
      result.push({ status, path: parts[2].trim(), oldPath: parts[1].trim() });
    } else {
      result.push({ status, path: parts[1].trim() });
    }
  }
  return result;
}
