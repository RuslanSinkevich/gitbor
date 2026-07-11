import { DiffPanel, FileContentPanel } from '../diff';

interface Props {
  diffTarget: { file: string; hash: string };
  /** `content` — снимок файла на ревизии (вкладка «Дерево файлов»). */
  mode?: 'diff' | 'content';
  onExpandDiff?: (file: string, hash: string) => void;
}

/**
 * Правая (нижняя) панель просмотра: diff изменённого файла или содержимое
 * снимка на ревизии. История / Blame — отдельные модалки из контекстного меню.
 */
export function RightPanelContent({ diffTarget, mode = 'diff', onExpandDiff }: Props) {
  if (mode === 'content') {
    return <FileContentPanel file={diffTarget.file} hash={diffTarget.hash} />;
  }
  return <DiffPanel file={diffTarget.file} hash={diffTarget.hash} onExpand={onExpandDiff} />;
}
