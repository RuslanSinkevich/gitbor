import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { t } from '../../i18n';
import { postCommand, invokeCommand } from '../../api';
import type { AppState, RepoSummaryDto } from '../../types';
import { loadRecent, removeRecentRepo, sameRepoPath } from './recentRepos';
import { extractSummary, dtoToSummary, type RepoSummary } from './repoSummary';
import { RepoDetail } from './RepoDetail';
import { CloneRepoDialog } from './CloneRepoDialog';
import { InitRepoDialog } from './InitRepoDialog';
import s from './RepoManager.module.css';

export { addRecentRepo, loadLastActiveRepo, saveLastActiveRepo } from './recentRepos';

interface Props {
  state: AppState;
}

interface CacheEntry {
  summary: RepoSummary | null;
  invalid: boolean;
}

const SELECT_DEBOUNCE_MS = 80;
const LOADING_INDICATOR_DELAY_MS = 200;

export function RepoManager({ state }: Props) {
  const rm = t().repoManager;
  const [recentRepos, setRecentRepos] = useState(loadRecent);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState<'none' | 'clone' | 'init'>('none');

  const [currentSummary, setCurrentSummary] = useState<RepoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(false);

  /**
   * Кеш summary на сессию RepoManager. По требованию — только в памяти,
   * никакого localStorage. Ключ — путь, нормализованный через `normalizeKey`
   * (lower-case, прямые слэши), чтобы клик на «c:/repo» и «C:\repo» не дёргал
   * IPC дважды.
   */
  const summariesCache = useRef(new Map<string, CacheEntry>());

  const liveSummary = useMemo(() => extractSummary(state), [state]);

  const normalizeKey = useCallback((p: string) => p.replace(/\\/g, '/').toLowerCase(), []);

  const isActiveRepoPath = useCallback((p: string): boolean => {
    return !!state.repoPath && sameRepoPath(p, state.repoPath);
  }, [state.repoPath]);

  /**
   * Активный репо — освежаем кеш на каждый меняющийся state, чтобы
   * branches/tags/uncommitted не отставали от sidebar'а. Для остальных
   * путей кеш живёт до закрытия менеджера.
   */
  useEffect(() => {
    if (!state.repoPath || !liveSummary) return;
    summariesCache.current.set(normalizeKey(state.repoPath), { summary: liveSummary, invalid: false });
  }, [state.repoPath, liveSummary, normalizeKey]);

  /**
   * Дебаунс выбора 80мс — защита от быстрых пробежек по списку клавиатурой
   * или хаотичных кликов: дёргаем git-команды только когда юзер «остановился».
   */
  useEffect(() => {
    if (!selectedPath) {
      setCurrentSummary(null);
      setLoading(false);
      setInvalid(false);
      return;
    }

    if (isActiveRepoPath(selectedPath)) {
      setCurrentSummary(liveSummary);
      setLoading(false);
      setInvalid(false);
      return;
    }

    const cached = summariesCache.current.get(normalizeKey(selectedPath));
    if (cached) {
      setCurrentSummary(cached.summary);
      setInvalid(cached.invalid);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setCurrentSummary(null);
    setInvalid(false);
    setLoading(false);

    const debounceTimer = setTimeout(() => {
      if (cancelled) return;
      const loadingTimer = setTimeout(() => {
        if (!cancelled) setLoading(true);
      }, LOADING_INDICATOR_DELAY_MS);

      void invokeCommand({ type: 'getRepoSummary', path: selectedPath })
        .then(result => {
          clearTimeout(loadingTimer);
          if (cancelled) return;
          const dto = result as RepoSummaryDto | undefined;
          if (!dto || !dto.valid) {
            const entry: CacheEntry = { summary: null, invalid: true };
            summariesCache.current.set(normalizeKey(selectedPath), entry);
            setCurrentSummary(null);
            setInvalid(true);
            setLoading(false);
            return;
          }
          const summary = dtoToSummary(dto);
          summariesCache.current.set(normalizeKey(selectedPath), { summary, invalid: false });
          setCurrentSummary(summary);
          setInvalid(false);
          setLoading(false);
        })
        .catch(() => {
          clearTimeout(loadingTimer);
          if (cancelled) return;
          const entry: CacheEntry = { summary: null, invalid: true };
          summariesCache.current.set(normalizeKey(selectedPath), entry);
          setCurrentSummary(null);
          setInvalid(true);
          setLoading(false);
        });
    }, SELECT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [selectedPath, liveSummary, isActiveRepoPath, normalizeKey]);

  const handleOpen = useCallback((path: string) => postCommand({ type: 'openRepo', path }), []);
  const handleOpenDialog = useCallback(() => postCommand({ type: 'openRepoDialog' }), []);

  const handleRemove = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentRepos(removeRecentRepo(path));
    summariesCache.current.delete(normalizeKey(path));
    if (selectedPath === path) setSelectedPath(null);
  }, [selectedPath, normalizeKey]);

  const handleRemoveFromDetail = useCallback((path: string) => {
    setRecentRepos(removeRecentRepo(path));
    summariesCache.current.delete(normalizeKey(path));
    if (selectedPath === path) setSelectedPath(null);
  }, [selectedPath, normalizeKey]);

  const selected = recentRepos.find(r => r.path === selectedPath);

  return (
    <div className={s.root}>
      <div className={s.listPanel}>
        <div className={s.listHeader}>
          <span className={s.listTitle}>{rm.title}</span>
        </div>

        <div className={s.actionButtons}>
          <button className={s.openBtn} onClick={handleOpenDialog}>{rm.openRepo}</button>
          <button className={`${s.openBtn} ${s.openBtnSecondary}`} onClick={() => setOpenDialog('clone')}>{rm.cloneRepo}</button>
          <button className={`${s.openBtn} ${s.openBtnSecondary}`} onClick={() => setOpenDialog('init')}>{rm.initRepo}</button>
        </div>

        <div className={s.sectionLabel}>{rm.recent}</div>

        <div className={s.repoList}>
          {recentRepos.length === 0 && <div className={s.emptyList}>{rm.noRecent}</div>}
          {recentRepos.map(repo => (
            <div
              key={repo.path}
              className={`${s.repoItem} ${selectedPath === repo.path ? s.repoItemActive : ''}`}
              onClick={() => setSelectedPath(repo.path)}
              onDoubleClick={() => handleOpen(repo.path)}
            >
              <div className={s.repoIcon}>⌥</div>
              <div className={s.repoInfo}>
                <div className={s.repoName}>{repo.name}</div>
                <div className={s.repoPath}>{repo.path}</div>
              </div>
              <button className={s.removeBtn} onClick={(e) => handleRemove(repo.path, e)} title={rm.remove}>×</button>
            </div>
          ))}
        </div>
      </div>

      <RepoDetail
        selected={selected}
        summary={currentSummary}
        loading={loading}
        invalid={invalid}
        state={state}
        onRemove={handleRemoveFromDetail}
      />

      {openDialog === 'clone' && (
        <CloneRepoDialog onClose={() => setOpenDialog('none')} />
      )}
      {openDialog === 'init' && (
        <InitRepoDialog onClose={() => setOpenDialog('none')} />
      )}
    </div>
  );
}
