import { postCommand } from '../../api';
import type { MergeState } from '../../types';
import s from './Merge.module.css';

interface Props {
  mergeState: MergeState;
}

export function MergeBanner({ mergeState }: Props) {
  if (!mergeState.inProgress) return null;

  const conflicted = mergeState.conflictFiles.filter(f => f.status === 'conflicted').length;

  return (
    <div className={s.banner}>
      <span className={s.bannerIcon}>⚠</span>
      <span className={s.bannerText}>
        Merging <span className={s.bannerBranch}>{mergeState.sourceBranch}</span> into{' '}
        <span className={s.bannerBranch}>{mergeState.targetBranch}</span>.
        {conflicted > 0
          ? ` Fix ${conflicted} conflict${conflicted > 1 ? 's' : ''} and then continue.`
          : ' All conflicts resolved — ready to commit.'}
      </span>
      <button className={s.bannerAbort} onClick={() => postCommand({ type: 'abortMerge' })}>
        Abort
      </button>
    </div>
  );
}
