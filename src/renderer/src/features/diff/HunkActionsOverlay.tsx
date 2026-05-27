import { postCommand } from '../../api';
import { t } from '../../i18n';
import s from './DiffView.module.css';

/**
 * Floating action panel над hunk-блоком (Fork-style hover overlay).
 *
 * Видимость управляется CSS-классом `.hunkOverlay` родителя `.hunkBlock`:
 * opacity 0 → 1 при `:hover` / `:focus-within`. Здесь только разметка
 * + handlers; никакого собственного hover-state в JS — это позволяет
 * inline и split версиям делить одну точку правды без дублирования
 * confirm/postCommand-логики.
 *
 * Условия показа кнопок повторяют исходный DiffHunkView:
 *   - `isWorkingCopy` → Stage + Discard (с confirm)
 *   - `isStaged`      → Unstage
 *   - commit diff     → компонент не рендерится (file/флаги не переданы)
 */
interface Props {
  file: string;
  hunkIndex: number;
  isWorkingCopy: boolean;
  isStaged: boolean;
}

export function HunkActionsOverlay({ file, hunkIndex, isWorkingCopy, isStaged }: Props) {
  const loc = t();

  if (!isWorkingCopy && !isStaged) return null;

  const stage = () => postCommand({ type: 'stageHunk', file, hunkIndex });
  const unstage = () => postCommand({ type: 'stageHunk', file, hunkIndex, reverse: true });
  const discard = () => {
    // Нативный confirm — без проброса showPrompt через DiffPanel →
    // RightPanelContent. Текст из i18n, чтобы Discard на всех экранах
    // звучал одинаково.
    if (!window.confirm(`${loc.diff.discardHunkTitle}\n\n${loc.diff.discardHunkMessage}`)) return;
    postCommand({ type: 'discardHunk', file, hunkIndex });
  };

  return (
    <div className={s.hunkOverlay}>
      {isWorkingCopy && (
        <>
          <button
            type="button"
            className={s.hunkAction}
            onClick={stage}
            title={loc.diff.stageHunk}
          >
            {loc.diff.stageHunkShort}
          </button>
          <button
            type="button"
            className={`${s.hunkAction} ${s.hunkActionDanger}`}
            onClick={discard}
            title={loc.diff.discardHunk}
          >
            {loc.diff.discardHunkShort}
          </button>
        </>
      )}
      {isStaged && (
        <button
          type="button"
          className={s.hunkAction}
          onClick={unstage}
          title={loc.diff.unstageHunk}
        >
          {loc.diff.unstageHunkShort}
        </button>
      )}
    </div>
  );
}
