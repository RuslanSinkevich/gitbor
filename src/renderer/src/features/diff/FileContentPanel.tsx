import { useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n';
import { invokeCommand } from '../../api';
import { isImageFile } from './ImageDiff';
import s from './DiffView.module.css';

interface Props {
  file: string;
  hash: string;
}

/**
 * Просмотр содержимого файла на ревизии (`git show <hash>:<file>`).
 * Нужен вкладке «Дерево файлов»: там полный снимок дерева, а не только
 * изменённые файлы — diff против родителя для большинства путей пустой.
 */
export function FileContentPanel({ file, hash }: Props) {
  const loc = t();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    void invokeCommand({ type: 'getFileText', file, hash })
      .then((result) => {
        if (cancelled) return;
        setContent(typeof result === 'string' ? result : null);
      })
      .catch(() => { if (!cancelled) setContent(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, hash]);

  const lines = useMemo(() => {
    if (content === null) return [];
    // split сохраняет финальную пустую строку только если файл кончается \n —
    // для нумерации это ок (как в редакторах).
    return content.split('\n');
  }, [content]);

  if (isImageFile(file)) {
    return (
      <div className={s.root}>
        <div className={s.toolbar}>
          <span className={s.filePath}>{file}</span>
        </div>
        <div className={s.empty}>{loc.diff.fileContentBinary}</div>
      </div>
    );
  }

  if (loading) {
    return <div className={s.empty}>{loc.diff.loadingContent}</div>;
  }

  if (content === null) {
    return <div className={s.empty}>{loc.diff.fileContentBinary}</div>;
  }

  if (content === '') {
    return (
      <div className={s.root}>
        <div className={s.toolbar}>
          <span className={`${s.fileStatus} ${s.statusModified}`}>{loc.diff.fileContent}</span>
          <span className={s.filePath}>{file}</span>
        </div>
        <div className={s.empty}>{loc.diff.fileContentEmpty}</div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={`${s.fileStatus} ${s.statusModified}`}>{loc.diff.fileContent}</span>
        <span className={s.filePath}>{file}</span>
      </div>
      <div className={s.diffScroll}>
        <table className={s.diffTable}>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td className={s.lineNo}>{i + 1}</td>
                <td className={s.lineContent}>{line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
