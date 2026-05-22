import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t, tpl } from '../../i18n';
import type { ShowPrompt } from '../graph/commitMenuItems';
import { SgDialog } from '../../ui/SgDialog';
import { WorktreeItem } from './WorktreeItem';
import { AddWorktreeForm } from './AddWorktreeForm';
import s from './WorktreesDialog.module.css';

interface WorktreeInfo {
  path: string;
  branch: string;
  hash: string;
  isBare: boolean;
  isMain: boolean;
}

interface Props {
  onClose: () => void;
  showPrompt: ShowPrompt;
}

/** Dialog for managing git worktrees — list, add, remove. */
export function WorktreesDialog({ onClose, showPrompt }: Props) {
  const loc = t();
  const wl = loc.worktrees;
  const [items, setItems] = useState<WorktreeInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'worktrees') {
        setItems(msg.data);
        setLoading(false);
      }
    });
    postCommand({ type: 'getWorktrees' });
    return unsub;
  }, []);

  const handleRemove = useCallback((path: string) => {
    showPrompt({
      kind: 'confirm',
      title: wl.remove,
      message: tpl(wl.removeConfirm, { path }),
      confirmLabel: wl.remove,
      danger: true,
      onConfirm: () => postCommand({ type: 'removeWorktree', path, force: false }),
    });
  }, [wl, showPrompt]);

  const handleAdd = useCallback((path: string, branch: string, createBranch: boolean) => {
    postCommand({ type: 'addWorktree', path, branch, createBranch });
  }, []);

  return (
    <SgDialog
      open
      title={wl.title}
      onClose={onClose}
      size="lg"
      footer={<button className="sg-button sg-button--ghost sg-button--md" onClick={onClose}>{wl.close}</button>}
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{wl.subtitle}</p>
      <div className={s.body}>
        {loading ? (
          <div className={s.empty}>{t().app.loading}</div>
        ) : items.length === 0 ? (
          <div className={s.empty}>{wl.empty}</div>
        ) : (
          items.map((wt) => (
            <WorktreeItem key={wt.path} wt={wt} labels={wl} onRemove={handleRemove} />
          ))
        )}
      </div>
      <AddWorktreeForm labels={wl} onAdd={handleAdd} />
    </SgDialog>
  );
}
