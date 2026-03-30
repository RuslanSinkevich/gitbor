import { t } from '../../i18n';
import { postCommand } from '../../api';
import s from './Toolbar.module.css';

interface Props {
  isOperationRunning: boolean;
}

const IconFetch = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 2v10M4 8l4 4 4-4" /><path d="M2 14h12" />
  </svg>
);
const IconPull = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 2v10M4 8l4 4 4-4" />
  </svg>
);
const IconPush = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 14V4M4 8l4-4 4 4" />
  </svg>
);
const IconStash = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="2" width="10" height="4" rx="1" /><rect x="3" y="8" width="10" height="4" rx="1" />
  </svg>
);

export function Toolbar({ isOperationRunning }: Props) {
  const loc = t();

  const actions = [
    { key: 'fetch', label: loc.toolbar.fetch, icon: <IconFetch />, action: () => postCommand({ type: 'fetch' }) },
    { key: 'pull', label: loc.toolbar.pull, icon: <IconPull />, action: () => postCommand({ type: 'pull' }) },
    { key: 'push', label: loc.toolbar.push, icon: <IconPush />, action: () => postCommand({ type: 'push' }) },
    { key: 'sep1', separator: true },
    { key: 'stash', label: loc.toolbar.stash, icon: <IconStash />, action: () => postCommand({ type: 'stash' }) },
    { key: 'stashPop', label: loc.toolbar.stashPop, icon: <IconStash />, action: () => postCommand({ type: 'stashPop' }) },
  ] as const;

  return (
    <div className={s.root}>
      <div className={s.left}>
        {actions.map(a =>
          'separator' in a ? (
            <div key={a.key} className={s.separator} />
          ) : (
            <button
              key={a.key}
              className={s.action}
              onClick={a.action}
              disabled={isOperationRunning}
              title={a.label}
            >
              {a.icon}
              <span className={s.actionLabel}>{a.label}</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
