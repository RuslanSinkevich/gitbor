import { lazy, Suspense, useState, useCallback } from 'react';
import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { SgIconButton } from '../../ui/SgIconButton';
import { DiffWholeFile } from './DiffWholeFile';
import { DiffSideBySide } from './DiffSideBySide';
import { DiffHunkView } from './DiffHunkView';
import { isOneSidedDiff } from './diffRows';
import { ImageDiff, isImageFile } from './ImageDiff';
import type { MarkdownPreviewTarget } from './MarkdownPreviewModal';
import { useFileDiff } from './useFileDiff';
import { useDiffCopyMenu } from './useDiffCopyMenu';
import { WhitespaceIcon, MarkdownIcon } from './diffIcons';
import s from './DiffView.module.css';

const MarkdownPreviewModal = lazy(() => import('./MarkdownPreviewModal').then(m => ({ default: m.MarkdownPreviewModal })));

function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

export interface CompareTarget {
  file: string;
  hash: string;
}

interface Props {
  target: CompareTarget | null;
  onClose: () => void;
}

/**
 * Полноэкранная модалка сравнения: весь файл в две колонки + полоса-обзор
 * изменений справа. Открывается иконкой «развернуть» из diff-панели.
 * Переиспользует useFileDiff/DiffWholeFile — единое поведение с панелью.
 */
export function CompareModal({ target, onClose }: Props) {
  const loc = t();
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [mdPreview, setMdPreview] = useState<MarkdownPreviewTarget | null>(null);

  const file = target?.file ?? '';
  const hash = target?.hash ?? '';
  const open = target !== null;
  const isImage = open && isImageFile(file);
  const isMarkdown = open && isMarkdownFile(file);
  const { diffs, loading, error } = useFileDiff(file, hash, ignoreWs, true, open && !isImage);

  const toggleWs = useCallback(() => setIgnoreWs((p) => !p), []);
  const { onContextMenu, menuNode } = useDiffCopyMenu();

  const firstDiff = diffs?.[0];
  const title = file ? file.split('/').pop() || file : loc.diff.compareTitle;

  let body: React.ReactNode;
  if (!open) {
    body = null;
  } else if (isImage) {
    body = <ImageDiff file={file} hash={hash} />;
  } else if (loading) {
    body = <div className={s.empty}>{loc.diff.loading}</div>;
  } else if (error) {
    body = <div className={s.empty}>{error}</div>;
  } else if (!firstDiff || diffs!.length === 0) {
    body = <div className={s.empty}>{loc.diff.noDiff}</div>;
  } else if (firstDiff.isBinary) {
    body = <div className={s.binary}>{loc.diff.binaryFile}</div>;
  } else if (firstDiff.hunks.length === 0) {
    body = <div className={s.empty}>{loc.diff.noChanges}</div>;
  } else if (firstDiff.tooLargeForWhole) {
    body = (
      <div className={s.modalDiff} onContextMenu={onContextMenu}>
        {menuNode}
        <div className={s.wholeBanner}>{loc.diff.tooLargeForWhole}</div>
        {isOneSidedDiff(firstDiff) ? (
          <div className={s.diffScroll}>
            <div className={s.hunks}>
              {firstDiff.hunks.map((hunk, i) => (
                <DiffHunkView key={i} hunk={hunk} hunkIndex={i} file={file} isWorkingCopy={false} />
              ))}
            </div>
          </div>
        ) : (
          <DiffSideBySide hunks={firstDiff.hunks} file={file} />
        )}
      </div>
    );
  } else {
    // Новый/удалённый файл — вторая колонка была бы пустой, показываем одну.
    body = (
      <div className={s.modalDiff} onContextMenu={onContextMenu}>
        {menuNode}
        <DiffWholeFile hunks={firstDiff.hunks} unified={isOneSidedDiff(firstDiff)} />
      </div>
    );
  }

  return (
    <>
      <SgDialog
        open={open}
        title={title}
        onClose={onClose}
        size="fullscreen"
        noPadding
        headerExtra={
          <>
            {isMarkdown && (
              <SgIconButton
                size="sm"
                tooltip={loc.diff.previewMarkdown}
                onClick={() => setMdPreview({ file, hash })}
              >
                <MarkdownIcon />
              </SgIconButton>
            )}
            <SgIconButton
              size="sm"
              tooltip={loc.diff.ignoreWhitespace}
              aria-pressed={ignoreWs}
              className={ignoreWs ? s.iconBtnActive : ''}
              onClick={toggleWs}
            >
              <WhitespaceIcon />
            </SgIconButton>
          </>
        }
      >
        {body}
      </SgDialog>
      {mdPreview && (
        <Suspense fallback={null}>
          <MarkdownPreviewModal target={mdPreview} onClose={() => setMdPreview(null)} />
        </Suspense>
      )}
    </>
  );
}
