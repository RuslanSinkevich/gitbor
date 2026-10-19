import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import { GitExecutor, GitError } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import {
  ConflictFile,
  MergeOptions,
  MergeResult,
  MergeState,
  OperationResult,
} from '../git/types';
import { resolveGitDir } from '../git/gitDir';

/** Маркеры конфликта git: строки, начинающиеся с 7 символов `<`/`>` (и `|` для diff3). */
export function hasConflictMarkers(content: string): boolean {
  return /^(<{7}|>{7}|\|{7})( |$)/m.test(content);
}

export class ConflictManager {
  constructor(
    private readonly git: GitExecutor,
  ) {}

  async predictConflicts(source: string, target: string): Promise<string[]> {
    try {
      const baseResult = await this.git.exec(['merge-base', source, target]);
      if (baseResult.exitCode !== 0) return [];

      const base = baseResult.stdout.trim();
      const treeResult = await this.git.exec(['merge-tree', base, target, source]);

      const conflicts: string[] = [];
      const lines = treeResult.stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('+<<<<<<<') || line.includes('changed in both')) {
          const fileMatch = line.match(/(\S+)$/);
          if (fileMatch) conflicts.push(fileMatch[1]);
        }
      }
      return [...new Set(conflicts)];
    } catch {
      return [];
    }
  }

  async merge(source: string, options: MergeOptions): Promise<MergeResult> {
    const args = ['merge'];
    if (options.noCommit) args.push('--no-commit');
    if (options.squash) args.push('--squash');
    if (options.ffOnly) args.push('--ff-only');
    if (options.noFf) args.push('--no-ff');
    args.push(source);

    const result = await this.git.exec(args);

    if (result.exitCode === 0) {
      return { success: true, conflicts: [] };
    }

    const conflicts = await this.getConflictFileNames();
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    throw new GitError(
      `Merge failed: ${result.stderr}`,
      'merge',
      result.exitCode,
      result.stderr
    );
  }

  async getConflictFiles(): Promise<ConflictFile[]> {
    const statusResult = await this.git.exec(['status', '--porcelain=v1']);
    const allFiles = GitParser.parseStatus(statusResult.stdout);
    const unmergedDetails = this.parseUnmergedStatus(statusResult.stdout);

    const conflictPaths = new Set(allFiles.filter(f => f.status === 'U').map(f => f.path));
    const stagedPaths = new Set(allFiles.filter(f => f.staged && f.status === 'M').map(f => f.path));

    const result: ConflictFile[] = [];
    for (const path of conflictPaths) {
      const detail = unmergedDetails.get(path);
      result.push({
        path,
        status: 'conflicted',
        oursModified: detail?.oursModified ?? true,
        theirsModified: detail?.theirsModified ?? true,
      });
    }
    for (const path of stagedPaths) {
      if (!conflictPaths.has(path)) {
        result.push({ path, status: 'resolved', oursModified: true, theirsModified: true });
      }
    }
    return result;
  }

  async getMergeState(): Promise<MergeState> {
    const detected = await this.detectConflictResolution();
    if (!detected.inProgress) {
      return {
        inProgress: false,
        sourceBranch: '',
        targetBranch: '',
        totalConflicts: 0,
        resolvedConflicts: 0,
        conflictFiles: [],
        kind: 'none',
      };
    }

    const conflictFiles = await this.getConflictFiles();
    const conflicted = conflictFiles.filter(f => f.status === 'conflicted').length;
    const total = conflictFiles.length;

    // targetBranch — сторона «ours», sourceBranch — «theirs»: UI подписывает
    // ими «Принять версию …». При rebase git меняет стороны местами: ours —
    // ветка, НА которую переносим, theirs — ваш переносимый коммит. Раньше
    // тут было «HEAD» и пусто, и «нашей» выглядела чужая версия.
    let targetBranch = (await this.git.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    let sourceBranch = '';
    if (detected.kind === 'merge') {
      sourceBranch = await this.nameOf('MERGE_HEAD');
    } else if (detected.kind === 'cherry-pick') {
      sourceBranch = await this.shortHash('CHERRY_PICK_HEAD');
    } else if (detected.kind === 'revert') {
      sourceBranch = await this.shortHash('REVERT_HEAD');
    } else if (detected.kind === 'rebase') {
      const names = await this.rebaseSides();
      targetBranch = names.onto;
      sourceBranch = names.branch;
    }

    const state: MergeState = {
      inProgress: true,
      sourceBranch,
      targetBranch,
      totalConflicts: total,
      resolvedConflicts: total - conflicted,
      conflictFiles,
      kind: detected.kind,
    };

    if (detected.kind === 'cherry-pick') {
      const progress = await this.getSequencerProgress();
      if (progress && progress.total > 1) {
        state.sequencerDone = progress.done;
        state.sequencerTotal = progress.total;
      }
    }

    return state;
  }

  /** Имя ветки, указывающей на ref, иначе короткий хеш. */
  private async nameOf(ref: string): Promise<string> {
    const hash = (await this.git.exec(['rev-parse', '--verify', '-q', ref])).stdout.trim();
    if (!hash) return '';
    const r = await this.git.exec(['branch', '--points-at', hash, '--format=%(refname:short)']);
    // «(no branch, rebasing …)» — отсоединённый HEAD, а не ветка.
    const branches = r.stdout.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('('));
    return branches[0] || hash.substring(0, 7);
  }

  private async shortHash(ref: string): Promise<string> {
    return (await this.git.exec(['rev-parse', '--verify', '-q', '--short', ref])).stdout.trim();
  }

  /** rebase-merge/ (или rebase-apply/): head-name — ваша ветка, onto — куда переносим. */
  private async rebaseSides(): Promise<{ onto: string; branch: string }> {
    const gitDir = resolveGitDir(this.git.getCwd());
    const dir = existsSync(join(gitDir, 'rebase-merge')) ? join(gitDir, 'rebase-merge') : join(gitDir, 'rebase-apply');
    const read = async (f: string) => {
      try { return (await readFile(join(dir, f), 'utf-8')).trim(); } catch { return ''; }
    };
    const branch = (await read('head-name')).replace(/^refs\/heads\//, '');
    const ontoHash = await read('onto');
    const onto = ontoHash ? await this.nameOf(ontoHash) : '';
    return { onto: onto || 'HEAD', branch };
  }

  /**
   * Прогресс git-секвенсера cherry-pick-серии. Путь берём через
   * `git rev-parse --git-path sequencer` (учитывает worktree и `.git`-файл).
   * `done` — pick-строки уже обработанных коммитов, `todo` — оставшиеся.
   * total = done + todo. Возвращает null, если секвенсер отсутствует
   * (одиночный cherry-pick секвенсер не создаёт).
   */
  async getSequencerProgress(): Promise<{ done: number; total: number } | null> {
    try {
      const pathResult = await this.git.exec(['rev-parse', '--git-path', 'sequencer']);
      const rel = pathResult.stdout.trim();
      if (!rel) return null;
      const seqDir = isAbsolute(rel) ? rel : join(this.git.getCwd(), rel);
      if (!existsSync(seqDir)) return null;

      // У cherry-pick-серии файла `done` нет: в todo — текущий (конфликтный)
      // и оставшиеся коммиты, в `head` — HEAD до начала серии. Применённые =
      // коммиты от него до текущего HEAD. Раньше баннер показывал «0 из 2»
      // вместо «1 из 3».
      let done = await this.countPickLines(join(seqDir, 'done'));
      if (done === 0) done = await this.countSinceSequencerHead(join(seqDir, 'head'));
      const todo = await this.countPickLines(join(seqDir, 'todo'));
      const total = done + todo;
      if (total === 0) return null;
      return { done, total };
    } catch {
      return null;
    }
  }

  private async countSinceSequencerHead(headFile: string): Promise<number> {
    try {
      const head = (await readFile(headFile, 'utf-8')).trim();
      if (!head) return 0;
      const r = await this.git.exec(['rev-list', '--count', `${head}..HEAD`]);
      return r.exitCode === 0 ? Number(r.stdout.trim()) || 0 : 0;
    } catch {
      return 0;
    }
  }

  private async countPickLines(file: string): Promise<number> {
    try {
      const content = await readFile(file, 'utf-8');
      return content
        .split('\n')
        .filter(l => /^(pick|p|revert)\b/.test(l.trim()))
        .length;
    } catch {
      return 0;
    }
  }

  /**
   * Расширенный детектор «есть ли активный merge/conflict-flow». Учитывает:
   *   - MERGE_HEAD (классический merge)
   *   - CHERRY_PICK_HEAD (cherry-pick с конфликтом)
   *   - REVERT_HEAD (revert с конфликтом)
   *   - rebase-apply / rebase-merge (rebase в процессе)
   *   - UU files в индексе без всех вышеперечисленных
   *     (повреждённое состояние после ручного reset --keep / краш и т.п.)
   */
  async detectConflictResolution(): Promise<
    { inProgress: false } | { inProgress: true; kind: 'merge' | 'cherry-pick' | 'revert' | 'rebase' | 'unmerged-paths' }
  > {
    const gitDir = resolveGitDir(this.git.getCwd());
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) return { inProgress: true, kind: 'merge' };
    if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return { inProgress: true, kind: 'cherry-pick' };
    if (existsSync(join(gitDir, 'REVERT_HEAD'))) return { inProgress: true, kind: 'revert' };
    if (existsSync(join(gitDir, 'rebase-apply')) || existsSync(join(gitDir, 'rebase-merge'))) {
      return { inProgress: true, kind: 'rebase' };
    }
    const uu = await this.getConflictFileNames();
    if (uu.length > 0) return { inProgress: true, kind: 'unmerged-paths' };
    return { inProgress: false };
  }

  async resolveWithOurs(file: string): Promise<void> {
    await this.checkoutSideAndStage('ours', file);
  }

  async resolveWithTheirs(file: string): Promise<void> {
    await this.checkoutSideAndStage('theirs', file);
  }

  /**
   * «Пометить как разрешённый». Если в файле остались маркеры конфликта,
   * не помечаем — иначе `<<<<<<<`/`>>>>>>>` молча уезжают в коммит.
   */
  async stageResolved(file: string): Promise<void> {
    const full = join(this.git.getCwd(), file);
    if (existsSync(full) && hasConflictMarkers(await readFile(full, 'utf-8'))) {
      throw new GitError(
        `"${file}" still has conflict markers (<<<<<<< / >>>>>>>). Resolve them or pick a version first.`,
        'resolve', 1, '',
      );
    }
    const add = await this.git.exec(['add', '--', file]);
    if (add.exitCode !== 0) throw new GitError(`Resolve failed: ${add.stderr}`, 'resolve', add.exitCode, add.stderr);
  }

  async completeMerge(message?: string): Promise<OperationResult> {
    const unresolved = await this.getConflictFileNames();
    if (unresolved.length > 0) {
      return {
        success: false,
        error: 'Not all conflicts are resolved',
        rollbackAvailable: false,
      };
    }

    const conflictFiles = await this.getConflictFiles();
    const resolvedPaths = conflictFiles
      .filter(f => f.status === 'resolved')
      .map(f => f.path);

    if (resolvedPaths.length > 0) {
      await this.git.exec(['add', '--', ...resolvedPaths]);
    }

    const commitResult = message
      ? await this.git.exec(['commit', '-m', message])
      : await this.git.exec(['commit', '--no-edit']);

    if (commitResult.exitCode !== 0) {
      return { success: false, error: `Commit failed: ${commitResult.stderr}`, rollbackAvailable: false };
    }

    return { success: true, rollbackAvailable: true };
  }

  /**
   * Универсальный «отменить текущую конфликтную операцию». Команда зависит
   * от типа активного состояния (MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD /
   * rebase-apply|rebase-merge). Имя метода историческое — оставлено для
   * совместимости с IPC и SafetyNet.
   *
   * Для редкого случая «UU без state-файлов» (повреждённое состояние) делаем
   * `reset --merge` — он совместим с index.lock-аналогами и не трогает
   * untracked файлы.
   */
  async abortMerge(): Promise<void> {
    const detected = await this.detectConflictResolution();
    if (!detected.inProgress) return;
    switch (detected.kind) {
      case 'merge':
        await this.git.exec(['merge', '--abort']);
        return;
      case 'cherry-pick':
        await this.git.exec(['cherry-pick', '--abort']);
        return;
      case 'revert':
        await this.git.exec(['revert', '--abort']);
        return;
      case 'rebase':
        await this.git.exec(['rebase', '--abort']);
        return;
      case 'unmerged-paths':
        await this.git.exec(['reset', '--merge']);
        return;
    }
  }

  /**
   * Legacy: только MERGE_HEAD. Используется по старому коду. Для полной
   * проверки см. `detectConflictResolution()` — он покрывает все state-файлы
   * и UU.
   */
  async isMergeInProgress(): Promise<boolean> {
    const gitDir = resolveGitDir(this.git.getCwd());
    return existsSync(join(gitDir, 'MERGE_HEAD'));
  }

  private async getConflictFileNames(): Promise<string[]> {
    try {
      const result = await this.git.exec(['diff', '--name-only', '--diff-filter=U']);
      if (!result.stdout.trim()) return [];
      return result.stdout.trim().split('\n');
    } catch {
      return [];
    }
  }

  private parseUnmergedStatus(stdout: string): Map<string, Pick<ConflictFile, 'oursModified' | 'theirsModified'>> {
    const result = new Map<string, Pick<ConflictFile, 'oursModified' | 'theirsModified'>>();
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.length < 4 || line[2] !== ' ') continue;
      const x = line[0];
      const y = line[1];
      const isUnmerged = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
      if (!isUnmerged) continue;
      const path = GitParser.unquoteGitPath(line.slice(3));
      result.set(path, {
        oursModified: this.sideHasFile(x, y),
        theirsModified: this.sideHasFile(y, x),
      });
    }
    return result;
  }

  /**
   * Есть ли файл у стороны: в XY-коде porcelain `D` — сторона его удалила,
   * любая другая буква (U/A) — файл у неё есть. Раньше для `DU` (мы удалили,
   * они изменили) обе стороны выходили «удалён».
   */
  private sideHasFile(side: string, _other: string): boolean {
    return side !== 'D';
  }

  /**
   * Взять версию стороны. Если сторона файл удалила, `checkout --ours/--theirs`
   * падает («does not have our version»), и раньше в индекс уходило то, что
   * лежит на диске, — версия ДРУГОЙ стороны, ровно наоборот выбору. Теперь
   * удалённое стороной — удаляем; любая другая ошибка — наружу.
   */
  private async checkoutSideAndStage(side: 'ours' | 'theirs', file: string): Promise<void> {
    const co = await this.git.exec(['checkout', `--${side}`, '--', file]);
    if (co.exitCode !== 0) {
      if (!/does not have (our|their) version/i.test(co.stderr)) {
        throw new GitError(`Resolve failed: ${co.stderr}`, 'resolve', co.exitCode, co.stderr);
      }
      const rm = await this.git.exec(['rm', '-q', '-f', '--', file]);
      if (rm.exitCode !== 0) throw new GitError(`Resolve failed: ${rm.stderr}`, 'resolve', rm.exitCode, rm.stderr);
      return;
    }
    const add = await this.git.exec(['add', '--', file]);
    if (add.exitCode !== 0) throw new GitError(`Resolve failed: ${add.stderr}`, 'resolve', add.exitCode, add.stderr);
  }
}
