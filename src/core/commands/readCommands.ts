import { GitExecutor } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import { parseDiff } from '../git/DiffParser';
import { parseBlame } from '../git/BlameParser';
import { parseFileHistory, FILE_HISTORY_FORMAT } from '../git/FileHistoryParser';
import { parseSubmoduleStatus, parseGitmodules } from '../git/SubmoduleParser';
import { CommitDetail, CommitGraphData, FileDiff, BlameResult, FileHistoryResult, Submodule } from '../git/types';
import { decodeGitText } from '../utils/textEncoding';
import type {
  RepoStats,
  AuthorStats,
  MonthlyCount,
  DayCommitEntry,
  AuthorCodeStats,
  AuthorCodeStatsResult,
} from '../bridge/messages';
import { OperationQueue } from '../safety/OperationQueue';
import { StateManager } from '../state/StateManager';
import { loadAuthorStatsCache, saveAuthorStatsCache } from '../state/AuthorStatsCache';

const COMMIT_DETAIL_FORMAT = [
  '%H', '%P', '%an', '%ae', '%at',
  '%cn', '%ce', '%ct', '%D', '%s', '%b',
].join('%x00');

export async function getGraphData(
  queue: OperationQueue, state: StateManager, maxCount: number,
): Promise<CommitGraphData> {
  return queue.enqueueRead('getGraphData', async () => {
    await state.refreshGraph(maxCount);
    const s = state.getState();
    return { commits: s.commits, layout: s.graphLayout };
  });
}

export async function getCommitDetails(
  queue: OperationQueue, git: GitExecutor, hash: string,
): Promise<CommitDetail> {
  return queue.enqueueRead('getCommitDetails', async () => {
    const showResult = await git.exec(['show', '--format=' + COMMIT_DETAIL_FORMAT, '--no-patch', hash]);
    const parts = showResult.stdout.trim().split('\x00');
    const refs = parts[8] ? GitParser.parseRefs(parts[8]) : [];

    const parents = parts[1] ? parts[1].split(' ').filter(Boolean) : [];
    const isMerge = parents.length > 1;

    let filesResult;
    if (isMerge) {
      filesResult = await git.exec(['diff', '--name-status', `${hash}^1`, hash]);
    } else {
      filesResult = await git.exec(['diff-tree', '--no-commit-id', '-r', '--name-status', hash]);
    }
    const files = GitParser.parseFileChanges(filesResult.stdout);

    const parsedAuthorDate = parseInt(parts[4], 10);
    const parsedCommitDate = parseInt(parts[7], 10);

    return {
      hash: parts[0],
      parents: parts[1] ? parts[1].split(' ').filter(Boolean) : [],
      authorName: parts[2],
      authorEmail: parts[3],
      authorDate: Number.isNaN(parsedAuthorDate) ? 0 : parsedAuthorDate * 1000,
      committerName: parts[5],
      committerEmail: parts[6],
      commitDate: Number.isNaN(parsedCommitDate) ? 0 : parsedCommitDate * 1000,
      refs,
      subject: parts[9],
      body: parts[10] || '',
      files,
    };
  });
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf899d15d4cef8de1';

/**
 * Whole-file (full-context) diff: число -U больше любого вменяемого файла,
 * git сам клампит до реального размера → один hunk на весь файл. Int32-safe.
 */
const FULL_CONTEXT_FLAG = '-U2000000000';

/**
 * Предохранитель против построчного просмотра гигантских/мусорных файлов
 * (минифицированные бандлы, lock-файлы на сотни тысяч строк): full-context
 * diff с таким числом строк не отдаём в renderer целиком, а откатываемся на
 * обычный контекст и помечаем `tooLargeForWhole`.
 */
const WHOLE_FILE_LINE_LIMIT = 60_000;

/**
 * Разрешает спец-хэш `PREV:<commit>` в диапазон `prev..commit`, где `prev` —
 * предыдущая ревизия, реально менявшая файл (а не просто родитель коммита).
 * Если такой ревизии нет (файл создан в этом коммите) — сравниваем с пустым
 * деревом. Любой обычный хэш/диапазон возвращается без изменений.
 */
async function resolveEffectiveHash(git: GitExecutor, file: string, hash: string): Promise<string> {
  if (!hash.startsWith('PREV:')) return hash;
  const target = hash.slice('PREV:'.length);
  const log = await git.exec(['log', '-2', '--format=%H', target, '--', file]);
  const hashes = log.stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean);
  const prev = hashes[1];
  return prev ? `${prev}..${target}` : `${EMPTY_TREE}..${target}`;
}

/**
 * Получает stdout `git diff` как байты и декодирует с эвристикой кодировок
 * (UTF-8 → CP1251 → CP866). Прямой `git.exec` использует Node-дефолт utf-8
 * и для файлов в legacy Windows-1251 (старые .sql, .cs) выдаёт кракозябры
 * вместо кириллицы.
 */
async function runDiff(git: GitExecutor, args: string[]): Promise<string> {
  const r = await git.execBuffer(args);
  return decodeGitText(r.stdout);
}

async function computeFileDiff(
  git: GitExecutor, file: string, hash: string,
  ignoreWhitespace?: boolean, fullContext?: boolean,
): Promise<FileDiff[]> {
  {
    const wsFlag = ignoreWhitespace ? ['-w'] : [];
    const ctxFlag = fullContext ? [FULL_CONTEXT_FLAG] : [];
    // --no-ext-diff: иначе diff.external отдаёт не unified → parseDiff → [].
    const diffFlags = ['--no-ext-diff', '--no-textconv', '--no-color', ...wsFlag, ...ctxFlag];

    if (hash === 'WORKING') {
      const stdout = await runDiff(git, ['diff', ...diffFlags, '--', file]);
      if (stdout.trim()) return parseDiff(stdout);

      // Diff пустой. Если файл tracked — это stat-dirty (mtime тронута
      // внешним инструментом, контент идентичен). Без этой ветки UI
      // рендерил бы файл как «новый/добавленный» через --no-index.
      const trackedCheck = await git.exec(['ls-files', '--error-unmatch', '--', file]);
      if (trackedCheck.exitCode === 0) {
        // Пустой diff у tracked-файла ≠ всегда stat-dirty: после
        // `update-index --refresh` файл чистый, но diff по-прежнему пуст.
        // Смотрим unstaged-колонку porcelain: ` M` / `MM` → ещё в status.
        const statusResult = await git.exec(['status', '--porcelain', '--', file]);
        const line = statusResult.stdout.trim().split('\n').find((l) => l.length > 2) ?? '';
        const unstaged = line[1];
        if (unstaged === 'M' || unstaged === 'U') {
          return [{
            path: file,
            status: 'modified',
            hunks: [],
            isBinary: false,
            statDirty: true,
          }];
        }
        return [];
      }

      const nullDev = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const untrackedStdout = await runDiff(git, ['diff', '--no-index', ...diffFlags, '--', nullDev, file]);
      return parseDiff(untrackedStdout);
    }

    if (hash.includes('..')) {
      const [fromH, toH] = hash.split('..');
      const stdout = await runDiff(git, ['diff', ...diffFlags, fromH, toH, '--', file]);
      return parseDiff(stdout);
    }

    if (hash === 'STAGED') {
      const stdout = await runDiff(git, ['diff', '--cached', ...diffFlags, '--', file]);
      if (stdout.trim()) return parseDiff(stdout);

      const newStdout = await runDiff(git, ['diff', '--cached', ...diffFlags, EMPTY_TREE, '--', file]);
      return parseDiff(newStdout);
    }

    const parentCheck = await git.exec(['rev-list', '--parents', '-1', hash]);
    const parentParts = parentCheck.stdout.trim().split(/\s+/);

    if (parentParts.length > 1) {
      const stdout = await runDiff(git, ['diff', ...diffFlags, `${hash}^`, hash, '--', file]);
      return parseDiff(stdout);
    }

    const stdout = await runDiff(git, ['diff', ...diffFlags, EMPTY_TREE, hash, '--', file]);
    return parseDiff(stdout);
  }
}

export async function getFileDiff(
  queue: OperationQueue, git: GitExecutor, file: string, hash: string,
  ignoreWhitespace?: boolean, fullContext?: boolean,
): Promise<FileDiff[]> {
  return queue.enqueueRead('getFileDiff', async () => {
    const effectiveHash = await resolveEffectiveHash(git, file, hash);
    const diffs = await computeFileDiff(git, file, effectiveHash, ignoreWhitespace, fullContext);
    if (!fullContext) return diffs;

    const totalLines = diffs.reduce(
      (n, d) => n + d.hunks.reduce((m, h) => m + h.lines.length, 0), 0,
    );
    if (totalLines <= WHOLE_FILE_LINE_LIMIT) return diffs;

    // Файл слишком большой для построчного whole-file вида — откатываемся на
    // обычный контекст и помечаем флагом, чтобы renderer показал плашку.
    const fallback = await computeFileDiff(git, file, effectiveHash, ignoreWhitespace, false);
    for (const d of fallback) d.tooLargeForWhole = true;
    return fallback;
  });
}

/**
 * Возвращает текстовое содержимое файла на указанной ревизии.
 * Для `WORKING` читаем файл напрямую с ФС, для коммита/STAGED/диапазона —
 * `git show <hash>:<file>`. Кодировка определяется эвристикой
 * `decodeGitText` (UTF-8 → CP1251 → CP866), чтобы кириллица в
 * legacy-файлах читалась корректно.
 *
 * Для бинарников возвращается `null` — рендереру нечего показывать.
 */
export async function getFileText(
  queue: OperationQueue, git: GitExecutor, file: string, hash: string,
): Promise<string | null> {
  return queue.enqueueRead('getFileText', async () => {
    if (hash === 'WORKING') {
      const { readFile } = await import('fs/promises');
      const { safePath } = await import('../utils/pathSecurity');
      const repoPath = git.getCwd();
      try {
        const buf = await readFile(safePath(repoPath, file));
        if (isLikelyBinary(buf)) return null;
        return decodeGitText(buf);
      } catch {
        return null;
      }
    }

    const ref = hash === 'STAGED'
      ? `:${file}`
      : hash.includes('..')
        ? `${hash.split('..')[1]}:${file}`
        : hash.startsWith('PREV:')
          ? `${hash.slice('PREV:'.length)}:${file}`
          : `${hash}:${file}`;

    const r = await git.execBuffer(['show', ref]);
    if (r.exitCode !== 0) return null;
    if (isLikelyBinary(r.stdout)) return null;
    return decodeGitText(r.stdout);
  });
}

/** Быстрая эвристика бинарности: NUL-байт в первых 8 КБ. */
function isLikelyBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) if (buf[i] === 0) return true;
  return false;
}

export async function getFileBlame(
  queue: OperationQueue, git: GitExecutor, file: string, hash?: string,
): Promise<BlameResult> {
  return queue.enqueueRead('getFileBlame', async () => {
    const args = ['blame', '--porcelain'];
    if (hash && hash !== 'WORKING' && hash !== 'STAGED') args.push(hash);
    args.push('--', file);
    const result = await git.exec(args);
    return parseBlame(result.stdout, file);
  });
}

export async function getFileHistory(
  queue: OperationQueue, git: GitExecutor, file: string,
): Promise<FileHistoryResult> {
  return queue.enqueueRead('getFileHistory', async () => {
    const result = await git.exec([
      'log', '--follow', `--format=${FILE_HISTORY_FORMAT}`, '--name-status', '--', file,
    ]);
    return { path: file, entries: parseFileHistory(result.stdout) };
  });
}

export async function getSubmodules(
  queue: OperationQueue, git: GitExecutor,
): Promise<Submodule[]> {
  return queue.enqueueRead('getSubmodules', async () => {
    const statusResult = await git.exec(['submodule', 'status']);
    const submodules = parseSubmoduleStatus(statusResult.stdout);

    try {
      const modulesResult = await git.exec(['config', '--file', '.gitmodules', '--list']);
      const urlMap = parseGitmodules(modulesResult.stdout);
      for (const sm of submodules) {
        const url = urlMap.get(sm.path);
        if (url) sm.url = url;
      }
    } catch {
      // .gitmodules might not exist
    }

    return submodules;
  });
}

// ─── Repository Statistics ───

interface RawCommitEntry {
  name: string;
  email: string;
  date: string;
}

export function parseRepoStats(raw: string): RepoStats {
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { totalCommits: 0, period: { from: '', to: '' }, monthlyCounts: [], authors: [] };
  }

  const entries: RawCommitEntry[] = [];
  for (const line of lines) {
    const parts = line.split('\x00');
    if (parts.length < 3) continue;
    entries.push({ name: parts[0], email: parts[1], date: parts[2] });
  }

  if (entries.length === 0) {
    return { totalCommits: 0, period: { from: '', to: '' }, monthlyCounts: [], authors: [] };
  }

  const totalCounts: Record<string, number> = {};
  const authorMap = new Map<string, {
    name: string;
    email: string;
    dates: string[];
    dailyCounts: Record<string, number>;
    monthCounts: Record<string, number>;
  }>();

  for (const entry of entries) {
    const dayKey = entry.date.slice(0, 10);
    const monthKey = entry.date.slice(0, 7);

    totalCounts[monthKey] = (totalCounts[monthKey] || 0) + 1;

    const key = `${entry.name}\x00${entry.email}`;
    let author = authorMap.get(key);
    if (!author) {
      author = { name: entry.name, email: entry.email, dates: [], dailyCounts: {}, monthCounts: {} };
      authorMap.set(key, author);
    }
    author.dates.push(dayKey);
    author.dailyCounts[dayKey] = (author.dailyCounts[dayKey] || 0) + 1;
    author.monthCounts[monthKey] = (author.monthCounts[monthKey] || 0) + 1;
  }

  const sortedMonths = Object.keys(totalCounts).sort();
  const monthlyCounts: MonthlyCount[] = sortedMonths.map(m => ({ month: m, count: totalCounts[m] }));

  const allDates = entries.map(e => e.date.slice(0, 10)).sort();
  const from = allDates[0];
  const to = allDates[allDates.length - 1];

  const totalCommits = entries.length;
  const authors: AuthorStats[] = [];

  for (const a of authorMap.values()) {
    const sortedDates = a.dates.sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const commits = a.dates.length;

    const mostActiveDay = Object.entries(a.dailyCounts).reduce(
      (best, [day, cnt]) => cnt > best[1] ? [day, cnt] : best,
      ['', 0],
    )[0];

    const firstMs = new Date(firstDate).getTime();
    const lastMs = new Date(lastDate).getTime();
    const weeks = Math.max(1, (lastMs - firstMs) / (7 * 24 * 3600 * 1000));
    const avgPerWeek = Math.round((commits / weeks) * 10) / 10;

    const authorMonthlyCounts: MonthlyCount[] = Object.keys(a.monthCounts)
      .sort()
      .map(m => ({ month: m, count: a.monthCounts[m] }));

    authors.push({
      name: a.name,
      email: a.email,
      commits,
      percentage: Math.round((commits / totalCommits) * 1000) / 10,
      firstDate,
      lastDate,
      dailyCounts: a.dailyCounts,
      monthlyCounts: authorMonthlyCounts,
      mostActiveDay,
      avgPerWeek,
    });
  }

  authors.sort((a, b) => b.commits - a.commits);

  return { totalCommits, period: { from, to }, monthlyCounts, authors };
}

export async function getRepoStats(
  queue: OperationQueue, git: GitExecutor,
): Promise<RepoStats> {
  return queue.enqueueRead('getRepoStats', async () => {
    const result = await git.exec([
      'log', '--all', '--format=%aN%x00%aE%x00%aI', '--no-merges',
    ]);
    return parseRepoStats(result.stdout);
  });
}

export async function getDayCommits(
  queue: OperationQueue, git: GitExecutor, author: string, date: string,
): Promise<DayCommitEntry[]> {
  return queue.enqueueRead('getDayCommits', async () => {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const after = date;
    const before = nextDay.toISOString().slice(0, 10);
    const result = await git.exec([
      'log', '--all', '--no-merges',
      `--author=${author}`,
      `--after=${after}`, `--before=${before}`,
      '--format=%H%x00%s%x00%aI',
    ]);
    const lines = result.stdout.split('\n').filter(Boolean);
    return lines.map(line => {
      const parts = line.split('\x00');
      return { hash: parts[0], subject: parts[1] || '', date: parts[2] || '' };
    });
  });
}

/** Parses `git log --numstat` output when each commit is prefixed with `SKYFORK%H` (see getAuthorCodeStats). */
export function parseAuthorCodeStats(
  raw: string,
  authorName: string,
  authorEmail: string,
  headHash: string,
): AuthorCodeStats {
  const touchedFiles = new Set<string>();
  let addedLines = 0;
  let deletedLines = 0;
  let binaryFiles = 0;

  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('SKYFORK')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [added, deleted, rawFilePath] = parts;
    if (!rawFilePath) continue;
    const filePath = GitParser.unquoteGitPath(rawFilePath);
    touchedFiles.add(filePath);
    if (added === '-' || deleted === '-') {
      binaryFiles++;
      continue;
    }
    const addedNum = Number.parseInt(added, 10);
    const deletedNum = Number.parseInt(deleted, 10);
    addedLines += Number.isNaN(addedNum) ? 0 : addedNum;
    deletedLines += Number.isNaN(deletedNum) ? 0 : deletedNum;
  }

  return {
    authorName,
    authorEmail,
    headHash,
    addedLines,
    deletedLines,
    netLines: addedLines - deletedLines,
    touchedFiles: touchedFiles.size,
    binaryFiles,
    calculatedAt: Date.now(),
  };
}

export async function getAuthorCodeStats(
  queue: OperationQueue,
  git: GitExecutor,
  state: StateManager,
  authorName: string,
  authorEmail: string,
  cacheOnly?: boolean,
  force?: boolean,
): Promise<AuthorCodeStatsResult> {
  return queue.enqueueRead('getAuthorCodeStats', async () => {
    const repoPath = state.getState().repoPath;
    if (!repoPath) return { authorName, authorEmail, stats: null, fromCache: false };

    const headResult = await git.exec(['rev-parse', 'HEAD']);
    const headHash = headResult.stdout.trim();
    if (!force) {
      const cached = await loadAuthorStatsCache(repoPath, authorName, authorEmail, headHash);
      if (cached) return { authorName, authorEmail, stats: cached, fromCache: true };
    }
    if (cacheOnly) return { authorName, authorEmail, stats: null, fromCache: false };

    const result = await git.exec([
      'log',
      '--all',
      '--no-merges',
      `--author=${authorName} <${authorEmail}>`,
      '--numstat',
      // Git requires at least one `%` placeholder in `--format`; plain text is rejected (fatal).
      '--format=SKYFORK%H%n',
    ], { maxBuffer: 200 * 1024 * 1024, timeout: 120_000 });

    const stats = parseAuthorCodeStats(result.stdout, authorName, authorEmail, headHash);
    await saveAuthorStatsCache(repoPath, stats);
    return { authorName, authorEmail, stats, fromCache: false };
  });
}
