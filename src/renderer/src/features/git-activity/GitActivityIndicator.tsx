import { t } from '../../i18n';
import { useGitActivity } from './useGitActivity';
import s from './GitActivity.module.css';

interface Props {
  onOpen: () => void;
  /**
   * Путь активного репо. Индикатор фильтруется по нему — иначе на репо A
   * пользователь видел бы spinner от операции репо B. `null` = глобальный
   * режим (legacy / нет открытых репо).
   */
  repoPath?: string | null;
}

/**
 * Компактный индикатор в тулбаре: показывает spinner + имя текущей операции,
 * если что-то выполняется. Когда очередь пуста — точка состояния последней
 * операции и нейтральный лейбл. Клик открывает журнал.
 */
export function GitActivityIndicator({ onOpen, repoPath }: Props) {
  const loc = t();
  const { entries, runningCount, currentRunning } = useGitActivity(repoPath);

  const lastStatus = entries[0]?.status ?? null;
  const isRunning = runningCount > 0;

  const label = isRunning
    ? `${loc.gitActivity.indicatorRunning}: ${currentRunning?.operation ?? ''}`
    : loc.gitActivity.indicatorIdle;

  const cls = [
    s.indicator,
    isRunning ? s.indicatorRunning : '',
    !isRunning && lastStatus === 'error' ? s.indicatorError : '',
  ].filter(Boolean).join(' ');

  const renderIcon = (): React.ReactNode => {
    if (isRunning) return <span className={s.spinner} />;
    if (lastStatus === 'success') return <span className={`${s.dot} ${s.dotSuccess}`} />;
    if (lastStatus === 'error') return <span className={`${s.dot} ${s.dotError}`} />;
    return <span className={`${s.dot} ${s.dotIdle}`} />;
  };

  return (
    <button className={cls} onClick={onOpen} title={loc.gitActivity.open}>
      {renderIcon()}
      <span className={s.indicatorLabel}>{label}</span>
    </button>
  );
}
