import { useState, useRef, useEffect } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import { GitActivityIndicator } from '../git-activity';
import s from './Toolbar.module.css';

interface Props {
  isOperationRunning: boolean;
  hasUpstream?: boolean;
  /** Commits ahead of upstream for the current branch (push counter). */
  ahead?: number;
  /** Commits behind upstream for the current branch (pull counter). */
  behind?: number;
  onPull?: (rebase?: boolean) => void;
  onPush?: (force?: boolean) => void;
  /**
   * Stash без message — fallback. Если задан, кнопка stash в Toolbar открывает
   * модалку имени стэша (рендерится снаружи через showPrompt из App.tsx).
   */
  onStash?: () => void;
  onOpenActivity?: () => void;
  /** Путь активного репо — для фильтрации индикатора git-активности. */
  repoPath?: string | null;
}

function formatBadgeCount(n: number): string {
  return n > 99 ? '99+' : String(n);
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
const IconDropdown = () => (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 2.5l3 3 3-3" /></svg>
);

function DropdownButton({ label, icon, disabled, mainAction, items, badge, tooltip }: {
  label: string; icon: React.ReactNode; disabled: boolean;
  mainAction: () => void;
  items: { label: string; action: () => void }[];
  /** Counter rendered as a pill in the top-right corner of the button. */
  badge?: number;
  /** Override the default button tooltip (label by default). */
  tooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = t();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className={s.dropdownWrap}>
      <button className={s.action} onClick={mainAction} disabled={disabled} title={tooltip ?? label}>
        {icon}
        <span className={s.actionLabel}>{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className={s.badge} aria-hidden="true">{formatBadgeCount(badge)}</span>
        )}
      </button>
      <button
        className={s.dropdownToggle}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-label={`${label}: ${loc.toolbar.moreOptions}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconDropdown />
      </button>
      {open && (
        <div className={s.dropdownMenu} role="menu">
          {items.map((item, i) => (
            <button
              type="button"
              key={i}
              className={s.dropdownItem}
              role="menuitem"
              onClick={() => { item.action(); setOpen(false); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar(props: Props) {
  const { isOperationRunning, hasUpstream, onPull, onPush, onStash, onOpenActivity } = props;
  const ahead = props.ahead ?? 0;
  const behind = props.behind ?? 0;
  const loc = t();
  const runPull = (rebase?: boolean) => {
    if (onPull) onPull(rebase);
    else postCommand({ type: 'pull', rebase });
  };
  const runPush = (force?: boolean) => {
    if (onPush) onPush(force);
    else postCommand({ type: 'push', force });
  };
  const runStash = () => {
    if (onStash) onStash();
    else postCommand({ type: 'stash' });
  };

  const pullTooltip = behind > 0
    ? `${loc.toolbar.pull} — ${loc.toolbar.pullBadge.replace('{n}', String(behind))}`
    : loc.toolbar.pull;
  const pushTooltip = ahead > 0
    ? `${loc.toolbar.push} — ${loc.toolbar.pushBadge.replace('{n}', String(ahead))}`
    : loc.toolbar.push;

  return (
    <div className={s.root}>
      <div className={s.left}>
        <button className={s.action} onClick={() => postCommand({ type: 'fetch' })} disabled={isOperationRunning} title={loc.toolbar.fetch}>
          <IconFetch />
          <span className={s.actionLabel}>{loc.toolbar.fetch}</span>
        </button>

        <DropdownButton
          label={loc.toolbar.pull}
          icon={<IconPull />}
          disabled={isOperationRunning}
          mainAction={() => runPull(false)}
          badge={behind}
          tooltip={pullTooltip}
          items={[
            { label: loc.toolbar.pull, action: () => runPull(false) },
            { label: loc.toolbar.pullRebase, action: () => runPull(true) },
          ]}
        />

        <DropdownButton
          label={loc.toolbar.push}
          icon={<IconPush />}
          disabled={isOperationRunning}
          mainAction={() => runPush(false)}
          badge={ahead}
          tooltip={pushTooltip}
          items={[
            { label: loc.toolbar.push, action: () => runPush(false) },
            { label: loc.toolbar.pushForce, action: () => runPush(true) },
            ...(!hasUpstream ? [{ label: loc.toolbar.pushSetUpstream, action: () => runPush(false) }] : []),
          ]}
        />

        <div className={s.separator} />

        <button className={s.action} onClick={runStash} disabled={isOperationRunning} title={loc.toolbar.stash}>
          <IconStash />
          <span className={s.actionLabel}>{loc.toolbar.stash}</span>
        </button>
        <button className={s.action} onClick={() => postCommand({ type: 'stashPop' })} disabled={isOperationRunning} title={loc.toolbar.stashPop}>
          <IconStash />
          <span className={s.actionLabel}>{loc.toolbar.stashPop}</span>
        </button>
      </div>

      {onOpenActivity && (
        <div className={s.right}>
          <GitActivityIndicator onOpen={onOpenActivity} repoPath={props.repoPath} />
        </div>
      )}
    </div>
  );
}
