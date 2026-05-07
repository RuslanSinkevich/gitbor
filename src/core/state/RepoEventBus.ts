import type { AppState } from '../git/types';

export type StateListener = (state: AppState) => void;
export type RepoSwitchListener = (newPath: string) => void;
export type RepoCloseListener = (closedPath: string) => void;

/**
 * Шина событий StateManager. Три независимых канала:
 *
 * - `subscribe` / `notify`           — изменение AppState (любой refresh,
 *   switch, clear). Получают snapshot top-level state.
 * - `onRepoSwitch` / `notifyRepoSwitch` — переключение активного репо.
 *   Слушают FileWatcher и т.п. (не путать с обычным state-change).
 * - `onRepoClose` / `notifyRepoClose` — репо удалено из openRepos.
 *   Подписчики освобождают связанные ресурсы (сервисы, watcher'ы, IPC dedup).
 *
 * Listener-ошибки изолированы: исключение одного слушателя не валит
 * остальных и не валит StateManager.
 */
export class RepoEventBus {
  private readonly stateListeners = new Set<StateListener>();
  private readonly switchListeners = new Set<RepoSwitchListener>();
  private readonly closeListeners = new Set<RepoCloseListener>();

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onRepoSwitch(listener: RepoSwitchListener): () => void {
    this.switchListeners.add(listener);
    return () => {
      this.switchListeners.delete(listener);
    };
  }

  onRepoClose(listener: RepoCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /** Размер пула state-подписчиков (для perfLog). */
  get stateListenerCount(): number {
    return this.stateListeners.size;
  }

  notify(snapshot: AppState): void {
    for (const listener of this.stateListeners) {
      try {
        listener(snapshot);
      } catch {
        // listener error — don't crash state manager
      }
    }
  }

  notifyRepoSwitch(newPath: string): void {
    for (const listener of this.switchListeners) {
      try {
        listener(newPath);
      } catch {
        // listener error — don't crash state manager
      }
    }
  }

  notifyRepoClose(closedPath: string): void {
    for (const listener of this.closeListeners) {
      try {
        listener(closedPath);
      } catch {
        // listener error — don't crash state manager
      }
    }
  }
}
