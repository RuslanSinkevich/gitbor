import { postCommand } from '../../api';
import { t, tpl } from '../../i18n';
import type { MergeState } from '../../types';
import type { ShowPrompt } from '../graph/commitMenuItems';
import s from './MergeBanner.module.css';

interface Props {
  mergeState: MergeState;
  showPrompt?: ShowPrompt;
}

export function MergeBanner({ mergeState, showPrompt }: Props) {
  if (!mergeState.inProgress) return null;

  const loc = t();
  const conflicted = mergeState.conflictFiles.filter(f => f.status === 'conflicted').length;

  const handleAbort = () => {
    if (showPrompt) {
      showPrompt({
        title: loc.merge.abort,
        message: loc.dialog.resetHardMessage,
        confirmLabel: loc.mergeBanner.abort,
        danger: true,
        onConfirm: () => postCommand({ type: 'abortMerge' }),
      });
    } else {
      postCommand({ type: 'abortMerge' });
    }
  };

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
      <button className={s.bannerAbort} onClick={handleAbort}>
        {loc.mergeBanner.abort}
      </button>
    </div>
  );
}
