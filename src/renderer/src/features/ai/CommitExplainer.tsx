import { useCallback, useEffect } from 'react';
import { t, tpl } from '../../i18n';
import { useAiConfig } from './useAiConfig';
import { useAiStream } from './useAiStream';
import s from './CommitExplainer.module.css';

interface Props {
  hash: string;
  /** Открыть AI Settings, если конфиг отсутствует/disabled — родитель открывает существующий диалог. */
  onOpenSettings: () => void;
}

/**
 * Inline-панель «Объяснить коммит». Кнопка «Объяснить», по клику запускается
 * streaming через aiExplainCommit; результат рендерится прямо под кнопкой,
 * с возможностью отменить и повторить. При смене коммита (`hash` меняется)
 * предыдущий результат сбрасывается.
 *
 * Скрывает себя если фича выключена в Settings (features.explainCommit ===
 * false) ИЛИ глобальный aiEnabled=false. Если просто провайдер не настроен —
 * кнопка остаётся, по клику открываем Settings.
 */
export function CommitExplainer({ hash, onOpenSettings }: Props) {
  const loc = t().aiTier2;
  const { config, loaded } = useAiConfig();
  const stream = useAiStream();

  /* Reset при переключении коммита. Без этого юзер увидел бы объяснение
     от предыдущего коммита поверх свежего, до того как обновятся данные.
     `stream.reset` сам по себе стабилен (useCallback с пустым deps). */
  const streamReset = stream.reset;
  useEffect(() => {
    streamReset();
  }, [hash, streamReset]);

  const featureDisabled = loaded && config && (config.aiEnabled === false || config.features?.explainCommit === false);
  if (featureDisabled) return null;

  const handleClick = useCallback(() => {
    if (!loaded) return;
    if (!config) {
      onOpenSettings();
      return;
    }
    stream.start((requestId) => ({ type: 'aiExplainCommit', requestId, hash }));
  }, [config, loaded, hash, stream, onOpenSettings]);

  if (stream.busy) {
    return (
      <div className={s.panel}>
        <div className={s.headerRow}>
          <span className={s.spinner} />
          <span className={s.title}>{loc.explaining}</span>
          <button type="button" className="sg-button sg-button--ghost sg-button--sm" onClick={stream.cancel}>
            {loc.cancel}
          </button>
        </div>
        {stream.text && <div className={s.text}>{stream.text}</div>}
      </div>
    );
  }

  if (stream.error) {
    return (
      <div className={s.panel}>
        <div className={s.errorRow}>
          <span className={s.errorText}>{stream.error}</span>
          <button type="button" className="sg-button sg-button--ghost sg-button--sm" onClick={handleClick}>
            {loc.explainCommit}
          </button>
        </div>
      </div>
    );
  }

  if (stream.text) {
    return (
      <div className={s.panel}>
        <div className={s.text}>{stream.text}</div>
        <div className={s.disclaimer}>{loc.disclaimer}</div>
        <button type="button" className="sg-button sg-button--ghost sg-button--sm" onClick={handleClick} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
          {tpl(loc.explainCommit, {})}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`sg-button sg-button--ghost sg-button--sm ${s.runBtn}`}
      onClick={handleClick}
      title={loc.explainCommitTooltip}
      disabled={!loaded}
    >
      <AiIcon />
      <span>{loc.explainCommit}</span>
    </button>
  );
}

function AiIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 4 }}>
      <path
        d="M8 1.5L9.3 5.2L13 6.5L9.3 7.8L8 11.5L6.7 7.8L3 6.5L6.7 5.2L8 1.5ZM12.5 10L13 11.5L14.5 12L13 12.5L12.5 14L12 12.5L10.5 12L12 11.5L12.5 10Z"
        fill="currentColor"
      />
    </svg>
  );
}
