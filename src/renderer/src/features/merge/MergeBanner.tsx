import { postCommand } from '../../api';
import { t, tpl } from '../../i18n';
import type { MergeState } from '../../types';
import type { ShowPrompt } from '../graph/commitMenuItems';
import s from './MergeBanner.module.css';

interface Props {
  mergeState: MergeState;
  showPrompt?: ShowPrompt;
}

/**
 * Скрываем баннер, если все конфликты уже резолвнуты — юзер видит
 * чистый список stage'д файлов и сам поймёт что merge готов к commit.
 * Жёлтый alarm-баннер с "all resolved" дублирует ту же информацию
 * и постоянно отвлекает (раздражение из исходного фидбэка).
 *
 * Если конфликтов НЕ было изначально (fast-forward отменён, ручной
 * merge без них) — баннер тоже не нужен.
 */
export function shouldShowMergeBanner(mergeState: MergeState | null): boolean {
  if (!mergeState || !mergeState.inProgress) return false;
  const conflicted = mergeState.conflictFiles.filter(f => f.status === 'conflicted').length;
  if (mergeState.totalConflicts === 0) return false;
  if (conflicted === 0) return false;
  return true;
}

export function MergeBanner({ mergeState, showPrompt }: Props) {
  if (!shouldShowMergeBanner(mergeState)) return null;

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

  // Заголовок в зависимости от kind (merge / cherry-pick / revert / rebase / unmerged-paths).
  const kindLabel =
    mergeState.kind === 'cherry-pick' ? loc.mergeBanner.cherryPicking
    : mergeState.kind === 'revert' ? loc.mergeBanner.reverting
    : mergeState.kind === 'rebase' ? loc.mergeBanner.rebasing
    : mergeState.kind === 'unmerged-paths' ? loc.mergeBanner.unmergedPaths
    : loc.mergeBanner.merging;

  return (
    <div className={s.banner}>
      <span className={s.bannerIcon}>⚠</span>
      <span className={s.bannerText}>
        {kindLabel}
        {mergeState.sourceBranch && (
          <>
            {' '}
            <span className={s.bannerBranch}>{mergeState.sourceBranch}</span>{' '}
            {loc.mergeBanner.into}{' '}
            <span className={s.bannerBranch}>{mergeState.targetBranch}</span>.
          </>
        )}
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
