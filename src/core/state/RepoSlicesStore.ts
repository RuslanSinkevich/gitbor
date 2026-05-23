import { basename } from 'path';
import type { AppState, RepoInfo } from '../git/types';
import {
  emptyRepoSlice,
  mirrorRepoSliceToAppState,
  type RepoSlice,
} from './repoSlice';

/**
 * Хранилище per-repo срезов состояния. Source of truth для всех данных,
 * относящихся к конкретному репо (commits, branches, status, cache hashes,
 * token). Активный slice зеркалируется в `state` для совместимости
 * с публичным `getState()` фасада.
 *
 * НЕ содержит ссылок на git/queue/registry — это чистое хранилище состояния.
 * Refresh-логику делает `RepoStateRefresher`, события — `RepoEventBus`.
 */
export class RepoSlicesStore {
  private state: AppState = this.emptyState();
  private readonly slicesByRepo = new Map<string, RepoSlice>();

  getState(): AppState {
    return this.state;
  }

  /** Получить или создать slice для конкретного репо. */
  getOrCreateSlice(repoPath: string): RepoSlice {
    let s = this.slicesByRepo.get(repoPath);
    if (!s) {
      s = emptyRepoSlice();
      this.slicesByRepo.set(repoPath, s);
    }
    return s;
  }

  /** Получить slice без создания (нужно для clear/invalidate путей). */
  getSlice(repoPath: string): RepoSlice | undefined {
    return this.slicesByRepo.get(repoPath);
  }

  /**
   * Удалить slice (после notifyRepoClose). Бампит token, чтобы все
   * inflight refresh операции этого slice тихо вышли через token-check.
   */
  removeSlice(repoPath: string): void {
    const slice = this.slicesByRepo.get(repoPath);
    if (slice) slice.token++;
    this.slicesByRepo.delete(repoPath);
  }

  /**
   * Освободить тяжёлые поля графа в slice неактивного репо
   * (commits + graphLayout). Сам slice (branches/status/remotes/...)
   * остаётся: они лёгкие и нужны для быстрого восстановления при
   * возврате на таб. Token БАМПИМ — все inflight refreshGraph этого
   * slice тихо выйдут, иначе только что освобождённые массивы
   * перезапишутся старыми из inflight git log.
   *
   * На большом монорепо это и есть главный source утечек: 5-50 MB
   * commits[] + 5-20 MB graphLayout.nodes[] на каждый неактивный таб.
   * Fork отдаёт память при switch — у нас теперь тоже.
   */
  evictGraphData(repoPath: string): void {
    const slice = this.slicesByRepo.get(repoPath);
    if (!slice) return;
    slice.token++;
    slice.commits = [];
    slice.graphLayout = { nodes: [], maxColumns: 0, mergeLinks: [] };
    slice.cachedHeadHash = null;
    slice.cachedLogHash = null;
    slice.cachedLogLimit = 0;
  }

  /** Список путей всех трекаемых репо (active + openRepos). */
  trackedRepoPaths(): string[] {
    const paths = new Set<string>();
    if (this.state.repoPath) paths.add(this.state.repoPath);
    for (const r of this.state.openRepos) paths.add(r.path);
    return [...paths];
  }

  /**
   * Репо «трекается» если оно либо активное, либо в openRepos.
   * После closeRepo путь вылетает из openRepos и активный сменяется —
   * этот гард не даёт фоновому refresh-у пересоздать slice/services
   * закрытого репо.
   */
  isRepoTracked(repoPath: string): boolean {
    if (this.state.repoPath === repoPath) return true;
    return this.state.openRepos.some(r => r.path === repoPath);
  }

  activeSlice(): RepoSlice | null {
    if (!this.state.repoPath) return null;
    return this.slicesByRepo.get(this.state.repoPath) ?? null;
  }

  /**
   * Зеркалирование slice → активный this.state. Вызывается после refresh
   * активного репо, чтобы getState()/subscribe видели свежие данные.
   * Если slice не активного репо — звать НЕ нужно (см. refresher).
   */
  mirrorSliceToState(slice: RepoSlice): void {
    mirrorRepoSliceToAppState(this.state, slice);
  }

  /**
   * Установить активный путь репо (плюс зарегистрировать его в openRepos
   * если ещё нет). Не зеркалит slice — это делает `activateRepo` или
   * вызывающая сторона.
   */
  setRepoPath(repoPath: string): void {
    this.state.repoPath = repoPath;
    this.state.repoName = basename(repoPath);

    if (!this.state.openRepos.some(r => r.path === repoPath)) {
      this.state.openRepos = [
        ...this.state.openRepos,
        { name: basename(repoPath), path: repoPath },
      ];
      this.state.activeRepoIndex = this.state.openRepos.length - 1;
    }
  }

  setOpenRepos(repos: RepoInfo[]): void {
    this.state.openRepos = repos;
  }

  /**
   * Полный сброс активного state и инвалидация active slice token.
   * Используется при clearRepo (закрытие последнего репо).
   */
  clearRepo(): void {
    const active = this.activeSlice();
    if (active) active.token++;
    this.state = this.emptyState();
  }

  /**
   * Активировать репо для switchRepo: гарантировать наличие slice,
   * выставить repoPath/repoName, обновить activeRepoIndex по openRepos
   * и зеркалить slice → state. Возвращает активированный slice.
   */
  activateRepo(repoPath: string): RepoSlice {
    const slice = this.getOrCreateSlice(repoPath);
    this.state.repoPath = repoPath;
    this.state.repoName = basename(repoPath);
    const idx = this.state.openRepos.findIndex(r => r.path === repoPath);
    if (idx !== -1) {
      this.state.activeRepoIndex = idx;
      this.state.openRepos = [...this.state.openRepos];
    }
    this.mirrorSliceToState(slice);
    return slice;
  }

  emptyState(): AppState {
    return {
      repoPath: '',
      repoName: '',
      currentBranch: '',
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      stagedFiles: [],
      unstagedFiles: [],
      conflicts: [],
      ahead: 0,
      behind: 0,
      commits: [],
      graphLayout: { nodes: [], maxColumns: 0, mergeLinks: [] },
      selectedCommitHash: null,
      isOperationRunning: false,
      currentOperation: null,
      openRepos: [],
      activeRepoIndex: 0,
    };
  }
}
