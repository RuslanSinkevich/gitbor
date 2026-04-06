import { postCommand } from '../../api';
import { t, tpl } from '../../i18n';
import type { MergeState } from '../../types';
import s from './Merge.module.css';

interface Props {
  mergeState: MergeState;
}

export function MergeBanner({ mergeState }: Props) {
  if (!mergeState.inProgress) return null;

  const loc = t();
  const conflicted = mergeState.conflictFiles.filter(f => f.status === 'conflicted').length;

  return (
    <div className={s.banner}>
      <span className={s.bannerIcon}>⚠</span>
      <span className={s.bannerText}>
        {loc.mergeBanner.merging}{' '}
        <span className={s.bannerBranch}>{mergeState.sourceBranch}</span>{' '}
        {loc.mergeBanner.into}{' '}
        <span className={s.bannerBranch}>{mergeState.targetBranch}</span>.
        {conflicted > 0
          ? ` ${tpl(loc.mergeBanner.fixConflicts, { count: conflicted })}`
          : ` ${loc.mergeBanner.allResolved}`}
      </span>
      <button className={s.bannerAbort} onClick={() => postCommand({ type: 'abortMerge' })}>
        {loc.mergeBanner.abort}
      </button>
    </div>
  );
}
