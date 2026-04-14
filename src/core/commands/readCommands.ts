import { GitExecutor } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import { parseDiff } from '../git/DiffParser';
import { parseBlame } from '../git/BlameParser';
import { parseFileHistory, FILE_HISTORY_FORMAT } from '../git/FileHistoryParser';
import { parseSubmoduleStatus, parseGitmodules } from '../git/SubmoduleParser';
import { CommitDetail, CommitGraphData, FileDiff, BlameResult, FileHistoryResult, Submodule } from '../git/types';
import { OperationQueue } from '../safety/OperationQueue';
import { StateManager } from '../state/StateManager';

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

export async function getFileDiff(
  queue: OperationQueue, git: GitExecutor, file: string, hash: string,
  ignoreWhitespace?: boolean,
): Promise<FileDiff[]> {
  return queue.enqueueRead('getFileDiff', async () => {
    const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf899d15d4cef8de1';
    const wsFlag = ignoreWhitespace ? ['-w'] : [];

    if (hash === 'WORKING') {
      const result = await git.exec(['diff', ...wsFlag, '--', file]);
      if (result.stdout.trim()) return parseDiff(result.stdout);

      const nullDev = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const untrackedResult = await git.exec(
        ['diff', '--no-index', ...wsFlag, '--', nullDev, file]
      );
      return parseDiff(untrackedResult.stdout);
    }

    if (hash === 'STAGED') {
      const result = await git.exec(['diff', '--cached', ...wsFlag, '--', file]);
      if (result.stdout.trim()) return parseDiff(result.stdout);

      const newResult = await git.exec(['diff', '--cached', ...wsFlag, EMPTY_TREE, '--', file]);
      return parseDiff(newResult.stdout);
    }

    const parentCheck = await git.exec(['rev-list', '--parents', '-1', hash]);
    const parentParts = parentCheck.stdout.trim().split(/\s+/);

    if (parentParts.length > 1) {
      const result = await git.exec(['diff', ...wsFlag, `${hash}^`, hash, '--', file]);
      return parseDiff(result.stdout);
    }

    const result = await git.exec(['diff', ...wsFlag, EMPTY_TREE, hash, '--', file]);
    return parseDiff(result.stdout);
  });
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
