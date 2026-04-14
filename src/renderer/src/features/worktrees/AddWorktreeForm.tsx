import { useState } from 'react';
import s from './WorktreesDialog.module.css';

interface Props {
  labels: { newPath: string; branchName: string; createBranch: string; add: string };
  onAdd: (path: string, branch: string, createBranch: boolean) => void;
}

/** Form for adding a new worktree. */
export function AddWorktreeForm({ labels, onAdd }: Props) {
  const [path, setPath] = useState('');
  const [branch, setBranch] = useState('');
  const [create, setCreate] = useState(true);

  const canAdd = path.trim().length > 0 && branch.trim().length > 0;

  return (
    <div className={s.addForm}>
      <div className={s.formRow}>
        <input className={s.input} value={path} onChange={(e) => setPath(e.target.value)} placeholder={labels.newPath} />
        <input className={s.input} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={labels.branchName} />
      </div>
      <div className={s.formRow}>
        <label className={s.checkLabel}>
          <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} />
          {labels.createBranch}
        </label>
        <button className={s.addBtn} disabled={!canAdd} onClick={() => { onAdd(path.trim(), branch.trim(), create); setPath(''); setBranch(''); }}>
          {labels.add}
        </button>
      </div>
    </div>
  );
}
