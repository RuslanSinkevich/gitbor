import { useState, useCallback, useMemo } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import type { AppState } from '../../types';
import { loadRecent, removeRecentRepo } from './recentRepos';
import { extractSummary } from './repoSummary';
import { RepoDetail } from './RepoDetail';
import s from './RepoManager.module.css';

export { addRecentRepo, loadLastActiveRepo, saveLastActiveRepo, sameRepoPath } from './recentRepos';

type Panel = 'none' | 'clone' | 'init';

interface Props {
  state: AppState;
}

export function RepoManager({ state }: Props) {
  const rm = t().repoManager;
  const [recentRepos, setRecentRepos] = useState(loadRecent);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [cloneUrl, setCloneUrl] = useState('');
  const [clonePath, setClonePath] = useState('');
  const [initPath, setInitPath] = useState('');

  const summary = useMemo(() => extractSummary(state), [state]);

  const handleOpen = useCallback((path: string) => postCommand({ type: 'openRepo', path }), []);
  const handleOpenDialog = useCallback(() => postCommand({ type: 'openRepoDialog' }), []);

  const handleRemove = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentRepos(removeRecentRepo(path));
    if (selectedPath === path) setSelectedPath(null);
  }, [selectedPath]);

  const handleClone = useCallback(() => {
    if (!cloneUrl.trim() || !clonePath.trim()) return;
    postCommand({ type: 'cloneRepo', url: cloneUrl.trim(), path: clonePath.trim() });
    setPanel('none');
    setCloneUrl('');
    setClonePath('');
  }, [cloneUrl, clonePath]);

  const handleInit = useCallback(() => {
    if (!initPath.trim()) return;
    postCommand({ type: 'initRepo', path: initPath.trim() });
    setPanel('none');
    setInitPath('');
  }, [initPath]);

  const selected = recentRepos.find(r => r.path === selectedPath);

  return (
    <div className={s.root}>
      <div className={s.listPanel}>
        <div className={s.listHeader}>
          <span className={s.listTitle}>{rm.title}</span>
        </div>

        <div className={s.actionButtons}>
          <button className={s.openBtn} onClick={handleOpenDialog}>{rm.openRepo}</button>
          <button className={`${s.openBtn} ${s.openBtnSecondary}`} onClick={() => setPanel(panel === 'clone' ? 'none' : 'clone')}>{rm.cloneRepo}</button>
          <button className={`${s.openBtn} ${s.openBtnSecondary}`} onClick={() => setPanel(panel === 'init' ? 'none' : 'init')}>{rm.initRepo}</button>
        </div>

        {panel === 'clone' && (
          <div className={s.inlineForm}>
            <input className={s.formInput} type="text" placeholder={rm.cloneUrl} value={cloneUrl} onChange={e => setCloneUrl(e.target.value)} autoFocus />
            <input className={s.formInput} type="text" placeholder={rm.clonePath} value={clonePath} onChange={e => setClonePath(e.target.value)} />
            <button className={s.formBtn} onClick={handleClone} disabled={!cloneUrl.trim() || !clonePath.trim()}>{rm.cloneStart}</button>
          </div>
        )}

        {panel === 'init' && (
          <div className={s.inlineForm}>
            <input className={s.formInput} type="text" placeholder={rm.initPath} value={initPath} onChange={e => setInitPath(e.target.value)} autoFocus />
            <button className={s.formBtn} onClick={handleInit} disabled={!initPath.trim()}>{rm.initStart}</button>
          </div>
        )}

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

      <RepoDetail selected={selected} summary={summary} state={state} />
    </div>
  );
}
