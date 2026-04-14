import s from './WorktreesDialog.module.css';

interface WorktreeInfo {
  path: string;
  branch: string;
  hash: string;
  isMain: boolean;
}

interface Props {
  wt: WorktreeInfo;
  labels: { main: string; remove: string };
  onRemove: (path: string) => void;
}

/** Single worktree row with branch, path, and remove button. */
export function WorktreeItem({ wt, labels, onRemove }: Props) {
  return (
    <div className={s.item}>
      <div className={s.itemInfo}>
        <span className={s.itemBranch}>
          ⎇ {wt.branch}
          {wt.isMain && <span className={s.mainBadge}>{labels.main}</span>}
        </span>
        <span className={s.itemPath}>{wt.path}</span>
      </div>
      <span className={s.itemHash}>{wt.hash}</span>
      {!wt.isMain && (
        <button className={s.removeBtn} onClick={() => onRemove(wt.path)}>
          {labels.remove}
        </button>
      )}
    </div>
  );
}
