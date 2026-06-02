import { useState, useCallback } from 'react';
import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { SgIconButton } from '../../ui/SgIconButton';
import { DiffWholeFile } from './DiffWholeFile';
import { DiffSideBySide } from './DiffSideBySide';
import { ImageDiff, isImageFile } from './ImageDiff';
import { useFileDiff } from './useFileDiff';
import { WhitespaceIcon } from './diffIcons';
import s from './DiffView.module.css';

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

  const file = target?.file ?? '';
  const hash = target?.hash ?? '';
  const open = target !== null;
  const isImage = open && isImageFile(file);
  const { diffs, loading, error } = useFileDiff(file, hash, ignoreWs, true, open && !isImage);

  const toggleWs = useCallback(() => setIgnoreWs((p) => !p), []);

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
      <div className={s.modalDiff}>
        <div className={s.wholeBanner}>{loc.diff.tooLargeForWhole}</div>
        <DiffSideBySide hunks={firstDiff.hunks} file={file} />
      </div>
    );
  } else {
    body = (
      <div className={s.modalDiff}>
        <DiffWholeFile hunks={firstDiff.hunks} />
      </div>
    );
  }

  return (
    <SgDialog
      open={open}
      title={title}
      onClose={onClose}
      size="fullscreen"
      noPadding
      headerExtra={
        <SgIconButton
          size="sm"
          tooltip={loc.diff.ignoreWhitespace}
          aria-pressed={ignoreWs}
          className={ignoreWs ? s.iconBtnActive : ''}
          onClick={toggleWs}
        >
          <WhitespaceIcon />
        </SgIconButton>
      }
    >
      {body}
    </SgDialog>
  );
}
