import { t, tpl } from '../../i18n';
import { postCommand } from '../../api';
import s from './BranchStatus.module.css';

interface Props {
  currentBranch: string;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  isOperationRunning: boolean;
  currentOperation: string | null;
}

export function BranchStatus({
  currentBranch, ahead, behind,
  stagedCount, unstagedCount,
  isOperationRunning, currentOperation,
}: Props) {
  const loc = t();
  const totalChanges = stagedCount + unstagedCount;

  return (
    <div className={s.root}>
      <div className={s.left}>
        <span className={s.icon}>⎇</span>
        <span className={s.name}>{currentBranch || loc.statusbar.noRepo}</span>
        {ahead > 0 && (
          <span className={s.ahead} title={tpl(loc.statusbar.ahead, { count: ahead })}>↑{ahead}</span>
        )}
        {behind > 0 && (
          <span className={s.behind} title={tpl(loc.statusbar.behind, { count: behind })}>↓{behind}</span>
        )}
      </div>

      <div className={s.right}>
        {isOperationRunning && currentOperation && (
          <span className={s.operation}>{currentOperation}…</span>
        )}

        {totalChanges > 0 ? (
          <span className={s.changes}>{tpl(loc.statusbar.modified, { count: totalChanges })}</span>
        ) : (
          <span className={s.clean}>{loc.statusbar.clean}</span>
        )}

        {(ahead > 0 || behind > 0) && (
          <div className={s.syncActions}>
            {behind > 0 && (
              <button className={s.syncBtn} onClick={() => postCommand({ type: 'pull' })} disabled={isOperationRunning} title={loc.toolbar.pull}>
                ↓ {loc.toolbar.pull}
              </button>
            )}
            {ahead > 0 && (
              <button className={s.syncBtn} onClick={() => postCommand({ type: 'push' })} disabled={isOperationRunning} title={loc.toolbar.push}>
                ↑ {loc.toolbar.push}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
