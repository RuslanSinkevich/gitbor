import { useState, useRef, useEffect } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import s from './Toolbar.module.css';

interface Props {
  isOperationRunning: boolean;
  hasUpstream?: boolean;
  onPull?: (rebase?: boolean) => void;
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

function DropdownButton({ label, icon, disabled, mainAction, items }: {
  label: string; icon: React.ReactNode; disabled: boolean;
  mainAction: () => void;
  items: { label: string; action: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
      <button className={s.action} onClick={mainAction} disabled={disabled} title={label}>
        {icon}
        <span className={s.actionLabel}>{label}</span>
      </button>
      <button className={s.dropdownToggle} onClick={() => setOpen(o => !o)} disabled={disabled}>
        <IconDropdown />
      </button>
      {open && (
        <div className={s.dropdownMenu}>
          {items.map((item, i) => (
            <div key={i} className={s.dropdownItem} onClick={() => { item.action(); setOpen(false); }}>
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar({ isOperationRunning, hasUpstream, onPull }: Props) {
  const loc = t();
  const runPull = (rebase?: boolean) => {
    if (onPull) onPull(rebase);
    else postCommand({ type: 'pull', rebase });
  };

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
          items={[
            { label: loc.toolbar.pull, action: () => runPull(false) },
            { label: loc.toolbar.pullRebase, action: () => runPull(true) },
          ]}
        />

        <DropdownButton
          label={loc.toolbar.push}
          icon={<IconPush />}
          disabled={isOperationRunning}
          mainAction={() => postCommand({ type: 'push' })}
          items={[
            { label: loc.toolbar.push, action: () => postCommand({ type: 'push' }) },
            { label: loc.toolbar.pushForce, action: () => postCommand({ type: 'push', force: true }) },
            ...(!hasUpstream ? [{ label: loc.toolbar.pushSetUpstream, action: () => postCommand({ type: 'push', setUpstream: true }) }] : []),
          ]}
        />

        <div className={s.separator} />

        <button className={s.action} onClick={() => postCommand({ type: 'stash' })} disabled={isOperationRunning} title={loc.toolbar.stash}>
          <IconStash />
          <span className={s.actionLabel}>{loc.toolbar.stash}</span>
        </button>
        <button className={s.action} onClick={() => postCommand({ type: 'stashPop' })} disabled={isOperationRunning} title={loc.toolbar.stashPop}>
          <IconStash />
          <span className={s.actionLabel}>{loc.toolbar.stashPop}</span>
        </button>
      </div>
    </div>
  );
}
