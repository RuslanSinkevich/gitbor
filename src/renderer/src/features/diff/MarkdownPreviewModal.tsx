import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { invokeCommand } from '../../api';
import { SgDialog } from '../../ui/SgDialog';
import { Markdown } from '../../ui/Markdown';
import s from './DiffView.module.css';

export interface MarkdownPreviewTarget {
  file: string;
  hash: string;
}

interface Props {
  target: MarkdownPreviewTarget | null;
  onClose: () => void;
}

/**
 * Модалка с нормальным рендером Markdown-файла (без diff +/−). Открывается
 * из тулбара DiffView для `.md`/`.markdown`. Содержимое подтягивается одним
 * IPC `getFileText` → main процесс читает либо рабочую копию, либо
 * `git show <hash>:<file>`. Кодировка определяется heuristic'ой
 * `decodeGitText`, поэтому CP1251-комментарии в diff больше не кракозябры.
 */
export function MarkdownPreviewModal({ target, onClose }: Props) {
  const loc = t();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const open = target !== null;

  useEffect(() => {
    if (!target) {
      setContent(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setContent(null);
    void invokeCommand({ type: 'getFileText', file: target.file, hash: target.hash })
      .then((result) => {
        if (cancelled) return;
        setContent(typeof result === 'string' ? result : null);
      })
      .catch(() => { if (!cancelled) setContent(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target]);

  const title = target ? (target.file.split('/').pop() || target.file) : loc.diff.previewMarkdownTitle;

  let body: React.ReactNode;
  if (!open) {
    body = null;
  } else if (loading) {
    body = <div className={s.empty}>{loc.diff.loading}</div>;
  } else if (content === null || content === '') {
    body = <div className={s.empty}>{loc.diff.previewMarkdownEmpty}</div>;
  } else {
    body = (
      <div className={s.markdownPreview}>
        <Markdown text={content} />
      </div>
    );
  }

  return (
    <SgDialog open={open} title={title} onClose={onClose} size="lg">
      {body}
    </SgDialog>
  );
}
