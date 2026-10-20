import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import type { FileDiff } from '../../types';
import { t } from '../../i18n';
import { SgIconButton } from '../../ui/SgIconButton';
import { DiffHunkView } from './DiffHunkView';
import { DiffSideBySide } from './DiffSideBySide';
import { useDiffCopyMenu } from './useDiffCopyMenu';
import { isOneSidedDiff } from './diffRows';

// Полоса-обзор изменений (overview ruler) для inline/split — некритичный chrome,
// грузим отдельным чанком. До загрузки контент уже виден в обычном скроллере
// (fallback), затем рядом появляется миникарта.
const DiffScrollMinimap = lazy(() => import('./DiffScrollMinimap').then((m) => ({ default: m.DiffScrollMinimap })));

/**
 * Оборачивает diff-контент в ленивую полосу-обзор. Пока чанк миникарты грузится
 * (или если он недоступен) — те же `children` показываются в обычном скроллере,
 * поэтому контент виден сразу, без мигания. Один и тот же React-элемент
 * переиспользуется в fallback и в активном дереве (монтируется только одно).
 */
function MinimapScroll({ version, children }: { version: string; children: ReactNode }) {
  return (
    <Suspense fallback={<div className={s.wholeWrap}><div className={s.diffScroll}>{children}</div></div>}>
      <DiffScrollMinimap version={version}>{children}</DiffScrollMinimap>
    </Suspense>
  );
}
import { InlineIcon, SplitIcon, WholeFileIcon, WhitespaceIcon, ExpandIcon, MarkdownIcon } from './diffIcons';
import s from './DiffView.module.css';

// Whole-file вид + миникарта нужны по требованию (режим «весь файл» /
// модалка), а не на каждый diff — выносим в отдельный чанк, чтобы не
// раздувать главный бандл.
const DiffWholeFile = lazy(() => import('./DiffWholeFile').then((m) => ({ default: m.DiffWholeFile })));

/** Раскладка diff: одна колонка (unified) или две (оригинал/изменённый). */
export type DiffLayout = 'inline' | 'split';

interface Props {
  diff: FileDiff;
  file: string;
  hash: string;
  ignoreWs?: boolean;
  onToggleWs?: () => void;
  layout: DiffLayout;
  onLayoutChange: (layout: DiffLayout) => void;
  /**
   * «Весь файл» — независимый переключатель поверх раскладки: показывает файл
   * целиком (full-context) в выбранной раскладке, а не только изменённые hunks.
   */
  wholeFile: boolean;
  onToggleWholeFile: () => void;
  /** Открыть текущий файл в полноэкранной модалке. Скрыто, если не задано. */
  onExpand?: () => void;
  /**
   * Открыть рендер Markdown-файла в отдельной модалке. Кнопка появляется
   * в тулбаре только когда `onPreviewMarkdown` задан (т.е. файл .md/.markdown).
   */
  onPreviewMarkdown?: () => void;
}

const STATUS_CLS: Record<string, string> = {
  added: s.statusAdded,
  deleted: s.statusDeleted,
  modified: s.statusModified,
  renamed: s.statusRenamed,
  copied: s.statusRenamed,
};

export function DiffView({
  diff, file, hash, ignoreWs, onToggleWs,
  layout, onLayoutChange, wholeFile, onToggleWholeFile,
  onExpand, onPreviewMarkdown,
}: Props) {
  const loc = t();
  const isWorkingCopy = hash === 'WORKING';
  // Новый файл в рабочей копии — «Отбросить» кусок убирает его в Корзину.
  const isNewFile = isWorkingCopy && diff.status === 'added';
  const isStaged = hash === 'STAGED';
  // Новый/удалённый файл: одна сторона пустая → две колонки не нужны ни в
  // split, ни в «весь файл». Выбор пользователя не трогаем, просто не применяем.
  const oneSided = useMemo(() => isOneSidedDiff(diff), [diff]);
  const split = layout === 'split' && !oneSided;
  const showWhole = wholeFile && !diff.tooLargeForWhole;

  // ПКМ-меню «Копировать»: либо текущее выделение, либо строка под курсором.
  // Меню локальное — не дёргает host-level useContextMenu из App.
  const { onContextMenu, menuNode } = useDiffCopyMenu(s.toolbar);
  const statusLabel =
    diff.status === 'added' ? loc.diff.statusAdded
    : diff.status === 'deleted' ? loc.diff.statusDeleted
    : diff.status === 'modified' ? loc.diff.statusModified
    : diff.status === 'renamed' ? loc.diff.statusRenamed
    : diff.status === 'copied' ? loc.diff.statusCopied
    : diff.status;

  // Сводка изменений (как в VS «Изменений N, −M, +K»): считаем строки по типу.
  const { adds, dels } = useMemo(() => {
    let a = 0, d = 0;
    for (const h of diff.hunks) {
      for (const l of h.lines) {
        if (l.type === 'add') a++;
        else if (l.type === 'remove') d++;
      }
    }
    return { adds: a, dels: d };
  }, [diff.hunks]);

  return (
    <div className={s.root} onContextMenu={onContextMenu}>
      {menuNode}
      <div className={s.toolbar}>
        <span className={`${s.fileStatus} ${STATUS_CLS[diff.status] || ''}`}>
          {statusLabel}
        </span>
        <span className={s.filePath}>
          {diff.oldPath && diff.oldPath !== diff.path
            ? `${diff.oldPath} → ${diff.path}`
            : diff.path}
        </span>
        {!diff.isBinary && (adds > 0 || dels > 0) && (
          <span className={s.diffStat} aria-label={`+${adds} −${dels}`}>
            {adds > 0 && <span className={s.diffStatAdd}>+{adds}</span>}
            {dels > 0 && <span className={s.diffStatDel}>−{dels}</span>}
          </span>
        )}
        {onToggleWs && (
          <SgIconButton
            size="sm"
            tooltip={loc.diff.ignoreWhitespace}
            aria-pressed={ignoreWs}
            className={ignoreWs ? s.iconBtnActive : ''}
            onClick={onToggleWs}
          >
            <WhitespaceIcon />
          </SgIconButton>
        )}
        <div className={s.modeToggle}>
          <SgIconButton
            size="sm"
            tooltip={loc.diff.inline}
            aria-pressed={!split}
            className={!split ? s.iconBtnActive : ''}
            onClick={() => onLayoutChange('inline')}
          >
            <InlineIcon />
          </SgIconButton>
          <SgIconButton
            size="sm"
            tooltip={oneSided ? loc.diff.splitOneSided : loc.diff.split}
            aria-pressed={split}
            className={split ? s.iconBtnActive : ''}
            disabled={oneSided}
            onClick={() => onLayoutChange('split')}
          >
            <SplitIcon />
          </SgIconButton>
        </div>
        <SgIconButton
          size="sm"
          tooltip={loc.diff.wholeFile}
          aria-pressed={wholeFile}
          className={wholeFile ? s.iconBtnActive : ''}
          onClick={onToggleWholeFile}
        >
          <WholeFileIcon />
        </SgIconButton>
        {onPreviewMarkdown && (
          <SgIconButton size="sm" tooltip={loc.diff.previewMarkdown} onClick={onPreviewMarkdown}>
            <MarkdownIcon />
          </SgIconButton>
        )}
        {onExpand && (
          <SgIconButton size="sm" tooltip={loc.diff.expand} onClick={onExpand}>
            <ExpandIcon />
          </SgIconButton>
        )}
      </div>

      {diff.isBinary ? (
        <div className={s.binary}>{loc.diff.binaryFile}</div>
      ) : diff.hunks.length === 0 ? (
        <div className={s.empty}>{loc.diff.noChanges}</div>
      ) : showWhole ? (
        <Suspense fallback={<div className={s.empty}>{loc.diff.loading}</div>}>
          <DiffWholeFile hunks={diff.hunks} unified={!split} />
        </Suspense>
      ) : (
        <>
          {wholeFile && diff.tooLargeForWhole && (
            <div className={s.wholeBanner}>{loc.diff.tooLargeForWhole}</div>
          )}
          {split ? (
            <MinimapScroll version={`${diff.path}|${ignoreWs}|split`}>
              <DiffSideBySide hunks={diff.hunks} file={file} isWorkingCopy={isWorkingCopy} isStaged={isStaged} isNewFile={isNewFile} />
            </MinimapScroll>
          ) : (
            <MinimapScroll version={`${diff.path}|${ignoreWs}|inline`}>
              <div className={s.hunks}>
                {diff.hunks.map((hunk, i) => (
                  <DiffHunkView key={i} hunk={hunk} hunkIndex={i} file={file} isWorkingCopy={isWorkingCopy} isStaged={isStaged} isNewFile={isNewFile} />
                ))}
              </div>
            </MinimapScroll>
          )}
        </>
      )}
    </div>
  );
}
