import type { ReflogEntry } from './types';

const REFLOG_SEP = '<<SEP>>';
const REFLOG_FORMAT = `%H${REFLOG_SEP}%h${REFLOG_SEP}%gs${REFLOG_SEP}%gd${REFLOG_SEP}%ci`;

/** Returns git args for reflog with structured format. */
export function reflogArgs(maxCount: number): string[] {
  return ['reflog', `--format=${REFLOG_FORMAT}`, `-n`, String(maxCount)];
}

/** Parses raw `git reflog --format=...` output into ReflogEntry[]. */
export function parseReflog(raw: string): ReflogEntry[] {
  if (!raw.trim()) return [];
  const entries: ReflogEntry[] = [];

  for (const line of raw.trim().split('\n')) {
    const parts = line.split(REFLOG_SEP);
    if (parts.length < 5) continue;

    const [hash, shortHash, gsRaw, gd, date] = parts;
    const { action, message } = splitReflogMessage(gsRaw);
    const index = parseReflogIndex(gd);

    entries.push({ hash, shortHash, action, message, date, index });
  }

  return entries;
}

/**
 * Splits a reflog subject (e.g. "checkout: moving from main to dev")
 * into action ("checkout") and message ("moving from main to dev").
 */
function splitReflogMessage(gs: string): { action: string; message: string } {
  const colonIdx = gs.indexOf(':');
  if (colonIdx === -1) return { action: gs, message: '' };
  return {
    action: gs.substring(0, colonIdx).trim(),
    message: gs.substring(colonIdx + 1).trim(),
  };
}

/** Extracts numeric index from reflog descriptor like "HEAD@{3}". */
function parseReflogIndex(gd: string): number {
  const m = gd.match(/\{(\d+)\}/);
  return m ? parseInt(m[1], 10) : 0;
}
