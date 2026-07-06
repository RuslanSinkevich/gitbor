import { DiffPanel } from '../diff';

interface Props {
  diffTarget: { file: string; hash: string };
  onExpandDiff?: (file: string, hash: string) => void;
}

/**
 * Правая (нижняя) панель просмотра: всегда diff выбранного файла.
 * История файла и Blame открываются отдельными модалками
 * (FileHistoryModal / BlameModal) из контекстных меню — единый механизм
 * для всех точек вызова, без дублирующей inline-панели.
 */
export function RightPanelContent({ diffTarget, onExpandDiff }: Props) {
  return <DiffPanel file={diffTarget.file} hash={diffTarget.hash} onExpand={onExpandDiff} />;
}
