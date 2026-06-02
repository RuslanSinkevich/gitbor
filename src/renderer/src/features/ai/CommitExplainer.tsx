import { useCallback, useEffect } from 'react';
import { t, tpl } from '../../i18n';
import { useAiConfig } from './useAiConfig';
import { useAiStream } from './useAiStream';
import { AiIcon } from './AiIcon';
import { AiSections } from './AiSections';
import s from './CommitExplainer.module.css';

export interface SharedState {
  hash: string;
  onOpenSettings: () => void;
  loaded: boolean;
  configMissing: boolean;
  hidden: boolean;
  stream: ReturnType<typeof useAiStream>;
  start: () => void;
}

/**
 * Лифтит состояние CommitExplainer на уровень родителя: кнопка-триггер
 * рисуется в одном месте интерфейса (строка табов CommitDetails — всегда
 * видна), а раскрывающаяся панель результата — в другом (под заголовком
 * коммита, на всю ширину). Один общий useAiStream — нельзя дублировать,
 * иначе получим два независимых стрима.
 */
export function useCommitExplainer(hash: string, onOpenSettings: () => void): SharedState {
  const { config, loaded } = useAiConfig();
  const stream = useAiStream();

  /* Reset при переключении коммита, иначе под свежим subject покажется
     объяснение от предыдущего. `stream.reset` стабилен сам по себе. */
  const streamReset = stream.reset;
  useEffect(() => {
    streamReset();
  }, [hash, streamReset]);

  const hidden = loaded && !!config && (config.aiEnabled === false || config.features?.explainCommit === false);
  const configMissing = loaded && !config;

  const start = useCallback(() => {
    if (!loaded) return;
    if (!config) {
      onOpenSettings();
      return;
    }
    stream.start((requestId) => ({ type: 'aiExplainCommit', requestId, hash }));
  }, [config, loaded, hash, stream, onOpenSettings]);

  return { hash, onOpenSettings, loaded, configMissing, hidden, stream, start };
}

interface ButtonProps {
  state: SharedState;
  /** При клике сначала переключить фокус на вкладку «Коммит». */
  onFocusCommitTab?: () => void;
}

/**
 * Маленькая кнопка-триггер в строке табов CommitDetails.
 *
 * При клике: фокусирует вкладку «Коммит» (результат там), затем
 * запускает/отменяет генерацию. Во время генерации — просто синяя,
 * без спиннера.
 */
export function CommitExplainerButton({ state, onFocusCommitTab }: ButtonProps) {
  const loc = t().aiTier2;
  if (state.hidden) return null;
  const { stream, start, loaded } = state;

  const handleClick = () => {
    onFocusCommitTab?.();
    if (stream.busy) stream.cancel();
    else start();
  };

  return (
    <button
      type="button"
      className={`sg-ai-button ${s.runBtn} ${stream.busy ? s.runBtnBusy : ''}`}
      onClick={handleClick}
      title={stream.busy ? loc.cancel : loc.explainCommitTooltip}
      aria-label={stream.busy ? loc.cancel : loc.explainCommit}
      disabled={!loaded}
    >
      <AiIcon size={14} />
    </button>
  );
}

interface OutputProps {
  state: SharedState;
}

/**
 * Раскрывающаяся панель с результатом — текстом стрима или ошибкой.
 * Рендерится под subject коммита, занимает всю доступную ширину. Если
 * стрим в idle и нет текста — компонент ничего не показывает.
 */
export function CommitExplainerOutput({ state }: OutputProps) {
  const loc = t().aiTier2;
  if (state.hidden) return null;
  const { stream, start } = state;

  if (stream.busy) {
    return (
      <div className={s.panel}>
        <button
          type="button"
          className={s.aiClose}
          onClick={stream.reset}
          title={loc.hide}
          aria-label={loc.hide}
        >
          ×
        </button>
        <div className={s.headerRow}>
          <span className={s.spinner} />
          <span className={s.title}>{loc.explaining}</span>
        </div>
        {stream.text && <AiSections text={stream.text} />}
      </div>
    );
  }

  if (stream.error) {
    return (
      <div className={s.panel}>
        <div className={s.errorRow}>
          <span className={s.errorText}>{stream.error}</span>
          <button type="button" className="sg-button sg-button--ghost sg-button--sm" onClick={start}>
            {tpl(loc.explainCommit, {})}
          </button>
        </div>
      </div>
    );
  }

  if (stream.text) {
    return (
      <div className={s.panel}>
        <button
          type="button"
          className={s.aiClose}
          onClick={stream.reset}
          title={loc.hide}
          aria-label={loc.hide}
        >
          ×
        </button>
        <AiSections text={stream.text} />
        <div className={s.disclaimer}>{loc.disclaimer}</div>
      </div>
    );
  }

  return null;
}

/**
 * Совместимость со старым импортом `CommitExplainer` — пока никто из
 * клиентов не перешёл на split-версию. Использует хук + оба под-компонента.
 */
interface Props {
  hash: string;
  onOpenSettings: () => void;
}

export function CommitExplainer({ hash, onOpenSettings }: Props) {
  const state = useCommitExplainer(hash, onOpenSettings);
  return (
    <>
      <CommitExplainerButton state={state} />
      <CommitExplainerOutput state={state} />
    </>
  );
}
