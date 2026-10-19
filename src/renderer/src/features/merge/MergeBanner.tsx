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
/** Cherry-pick-серия с непройденным остатком секвенсера. */
export function isCherryPickSeries(mergeState: MergeState): boolean {
  const done = mergeState.sequencerDone ?? 0;
  const total = mergeState.sequencerTotal ?? 0;
  return mergeState.kind === 'cherry-pick' && total > done;
}

export function shouldShowMergeBanner(mergeState: MergeState | null): boolean {
  if (!mergeState || !mergeState.inProgress) return false;
  // Cherry-pick-серия: держим баннер пока идёт секвенсер, даже когда текущие
  // конфликты уже разрешены — нужна кнопка Continue, чтобы продвинуть серию
  // к следующему коммиту (обычный commit секвенсер не двигает).
  if (isCherryPickSeries(mergeState)) return true;
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
        kind: 'confirm',
        title: loc.merge.abort,
        message: loc.mergeBanner.abortConfirm,
        confirmLabel: loc.mergeBanner.abort,
        danger: true,
        onConfirm: () => postCommand({ type: 'abortMerge' }),
      });
    } else {
      postCommand({ type: 'abortMerge' });
    }
  };

  // Cherry-pick-серия: свой баннер с прогрессом и Continue/Skip/Abort.
  if (isCherryPickSeries(mergeState)) {
    const done = mergeState.sequencerDone ?? 0;
    const total = mergeState.sequencerTotal ?? 0;
    return (
      <div className={s.banner}>
        <span className={s.bannerIcon}>⚠</span>
        <span className={s.bannerText}>
          {loc.mergeBanner.cherryPicking}
          {' '}
          {tpl(loc.mergeBanner.cherryPickProgress, { done, total })}
          {conflicted > 0
            ? ` ${tpl(loc.mergeBanner.fixConflicts, { count: conflicted })}`
            : ` ${loc.mergeBanner.continueHint}`}
        </span>
        <button
          className={s.bannerBtn}
          disabled={conflicted > 0}
          onClick={() => postCommand({ type: 'cherryPickContinue' })}
        >
          {loc.mergeBanner.continue}
        </button>
        <button className={s.bannerBtn} onClick={() => postCommand({ type: 'cherryPickSkip' })}>
          {loc.mergeBanner.skip}
        </button>
        <button className={s.bannerAbort} onClick={handleAbort}>
          {loc.mergeBanner.abort}
        </button>
      </div>
    );
  }

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
            {mergeState.kind === 'rebase' ? loc.mergeBanner.onto : loc.mergeBanner.into}{' '}
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
