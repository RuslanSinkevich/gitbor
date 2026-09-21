import type { Commit, RefInfo } from '@core/git/types';

export type FocusTarget =
  | { kind: 'local'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'tag'; name: string };

function isNamedHead(ref: RefInfo): boolean {
  return ref.type === 'head' && ref.name !== 'HEAD';
}

/** Выбрать ref на самом коммите: current → local → remote → tag. Checkout не делается. */
export function pickFocusRef(refs: RefInfo[], currentBranch: string): FocusTarget | null {
  const locals = refs.filter(r => r.type === 'branch' || isNamedHead(r));
  const remotes = refs.filter(r => r.type === 'remote');
  const tags = refs.filter(r => r.type === 'tag');

  const current = locals.find(r => r.name === currentBranch);
  if (current) return { kind: 'local', name: current.name };
  if (locals[0]) return { kind: 'local', name: locals[0].name };
  if (remotes[0]) return { kind: 'remote', name: remotes[0].name };
  if (tags[0]) return { kind: 'tag', name: tags[0].name };
  return null;
}

/**
 * Ближайший именованный ref для фокуса в сайдбаре.
 * На tip — берём его плашки; иначе BFS к потомкам до первого уровня с ref.
 */
export function nearestFocusRef(
  hash: string,
  commits: Commit[],
  currentBranch: string,
): FocusTarget | null {
  const byHash = new Map<string, Commit>();
  const children = new Map<string, string[]>();
  for (const c of commits) {
    byHash.set(c.hash, c);
    for (const p of c.parents) {
      const list = children.get(p);
      if (list) list.push(c.hash);
      else children.set(p, [c.hash]);
    }
  }

  const start = byHash.get(hash);
  if (start) {
    const direct = pickFocusRef(start.refs, currentBranch);
    if (direct) return direct;
  }

  const seen = new Set<string>([hash]);
  let queue = [hash];
  while (queue.length > 0) {
    const next: string[] = [];
    const found: RefInfo[] = [];
    for (const h of queue) {
      for (const child of children.get(h) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        const commit = byHash.get(child);
        if (!commit) continue;
        if (commit.refs.length > 0) found.push(...commit.refs);
        next.push(child);
      }
    }
    if (found.length > 0) return pickFocusRef(found, currentBranch);
    queue = next;
  }
  return null;
}
