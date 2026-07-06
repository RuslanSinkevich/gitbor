import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { BlameView } from './BlameView';

interface Props {
  file: string;
  /** Ревизия, на которой считаем blame. Для коммита — его hash. */
  hash?: string;
  onClose: () => void;
}

/**
 * Модалка blame по файлу (в стиле FileHistoryModal): полноэкранный <dialog>
 * с обычным BlameView внутри. Состояние open/close держит вызывающий, blame
 * считается на переданной ревизии (для деталей коммита — hash коммита).
 * Поведение blame одинаково во всех точках вызова: клик по строке показывает
 * поповер с информацией о коммите (см. BlameView).
 */
export function BlameModal({ file, hash, onClose }: Props) {
  const loc = t();
  const title = `${loc.contextMenu.blame}: ${file.split('/').pop() || file}`;

  return (
    <SgDialog open title={title} onClose={onClose} size="fullscreen" noPadding>
      <BlameView file={file} hash={hash} />
    </SgDialog>
  );
}
