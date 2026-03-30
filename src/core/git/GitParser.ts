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

export function parseRefs(refString: string): RefInfo[] {
  if (!refString.trim()) return [];

  return refString.split(',').map(raw => {
    const r = raw.trim();

    if (r === 'HEAD' || r.startsWith('HEAD ->')) {
      const branchPart = r.replace('HEAD -> ', '').trim();
      if (r.startsWith('HEAD ->')) {
        return { name: branchPart, type: 'head' as const };
      }
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

export function parseCommits(stdout: string): Commit[] {
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .reduce<Commit[]>((acc, rawLine) => {
      const parts = rawLine.replace(/\r$/, '').split(NUL);
      if (parts.length < 7) return acc;

      const [hash, parents, authorName, authorEmail, authorDate, refs, subject] = parts;
      const parsedDate = parseInt(authorDate, 10);

      acc.push({
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        authorName,
        authorEmail,
        authorDate: Number.isNaN(parsedDate) ? 0 : parsedDate * 1000,
        refs: refs ? parseRefs(refs) : [],
        subject,
      });
      return acc;
    }, []);
}

export function parseBranches(stdout: string, isRemote = false): Branch[] {
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .reduce<Branch[]>((acc, line) => {
      const parts = line.split(NUL);
      if (parts.length < 2) return acc;

      const [name, hash] = parts;
      const upstream = parts[2] || '';
      const headMarker = parts[3] || '';
      if (!name) return acc;

      acc.push({
        name,
        hash,
        upstream: upstream || undefined,
        isCurrent: headMarker.trim() === '*',
        isRemote,
      });
      return acc;
    }, []);
}

export function parseTags(stdout: string): Tag[] {
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .reduce<Tag[]>((acc, line) => {
      const parts = line.split(NUL);
      if (parts.length < 2) return acc;

      const [name, hash] = parts;
      if (!name) return acc;

      acc.push({ name, hash });
      return acc;
    }, []);
}

export function parseStashes(stdout: string): Stash[] {
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .reduce<Stash[]>((acc, line) => {
      const parts = line.split(NUL);
      if (parts.length < 3) return acc;

      const [index, hash, message] = parts;
      acc.push({ index, hash, message });
      return acc;
    }, []);
}

export function parseRemotes(stdout: string): Remote[] {
  if (!stdout.trim()) return [];

  const map = new Map<string, { fetchUrl: string; pushUrl: string }>();

  for (const line of stdout.trim().split('\n')) {
    const match = line.match(/^(\S+)\t(\S+)\s+\((fetch|push)\)$/);
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

export function parseStatus(stdout: string): FileStatus[] {
  if (!stdout.trim()) return [];

  const results: FileStatus[] = [];

  for (const rawLine of stdout.trim().split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length < 4) continue;

    const x = line[0];
    const y = line[1];
    const filePath = line.slice(3);

    if (x !== ' ' && x !== '?') {
      results.push({
        path: filePath,
        status: normalizeStatusChar(x),
        staged: true,
      });
    }

    if (y !== ' ') {
      results.push({
        path: filePath,
        status: normalizeStatusChar(y),
        staged: false,
      });
    }
  }

  return results;
}

function normalizeStatusChar(c: string): FileStatus['status'] {
  switch (c) {
    case 'M': return 'M';
    case 'A': return 'A';
    case 'D': return 'D';
    case 'R': return 'R';
    case 'U': return 'U';
    case '?': return '?';
    default: return 'M';
  }
}

export function parseFileChanges(stdout: string): FileChange[] {
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .reduce<FileChange[]>((acc, line) => {
      const parts = line.split('\t');
      if (parts.length < 2) return acc;

      const [status, filePath] = parts;
      acc.push({ status: status.trim(), path: filePath.trim() });
      return acc;
    }, []);
}
