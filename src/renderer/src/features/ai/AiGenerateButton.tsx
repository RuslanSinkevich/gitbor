import { useCallback, useEffect, useRef, useState } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t, tpl } from '../../i18n';
import type { MainEvent } from '../../types';
import { useAiConfig } from './useAiConfig';
import s from './AiGenerateButton.module.css';

interface Props {
  stagedCount: number;
  disabled?: boolean;
  /** Колбек пишет потоковый текст в subject (первая строка) + description (остальное). */
  onChunk: (textSoFar: string) => void;
  onDone: (fullText: string) => void;
  /**
   * Сообщает об ошибке. `message` — сырой текст (обычно английский),
   * `kind` — классификация ошибки из main-процесса для локализации в UI.
   */
  onError: (message: string, kind: string) => void;
  /** Открыть AI Settings, если провайдер не настроен. */
  onOpenSettings: () => void;
}

/**
 * Кнопка «Сгенерировать commit message» в CommitBar. Управляет стримом:
 * посылает aiGenerateCommitMessage, слушает aiChunk/aiDone/aiError по
 * совпадающему requestId. Во время генерации показывает Cancel.
 */
export function AiGenerateButton({
  stagedCount,
  disabled,
  onChunk,
  onDone,
  onError,
  onOpenSettings,
}: Props) {
  const loc = t().changes;
  const locAi = t().ai;
  const { config, loaded } = useAiConfig();
  const [isGenerating, setIsGenerating] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const accumulatedRef = useRef('');

  useEffect(() => {
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'aiChunk' && msg.requestId === requestIdRef.current) {
        accumulatedRef.current += msg.delta;
        onChunk(accumulatedRef.current);
      } else if (msg.type === 'aiDone' && msg.requestId === requestIdRef.current) {
        setIsGenerating(false);
        requestIdRef.current = null;
        onDone(msg.text);
      } else if (msg.type === 'aiError' && msg.requestId === requestIdRef.current) {
        setIsGenerating(false);
        requestIdRef.current = null;
        onError(msg.message, msg.kind);
      }
    });
    return unsub;
  }, [onChunk, onDone, onError]);

  useEffect(() => () => {
    // Отменяем in-flight генерацию при unmount'е (смена репо/закрытие вида).
    if (requestIdRef.current) {
      postCommand({ type: 'aiCancelGenerate', requestId: requestIdRef.current });
      requestIdRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (!loaded) return;
    if (!config) {
      onOpenSettings();
      return;
    }
    if (stagedCount === 0) {
      onError('Nothing is staged', 'nothingStaged');
      return;
    }
    const id = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requestIdRef.current = id;
    accumulatedRef.current = '';
    setIsGenerating(true);
    postCommand({ type: 'aiGenerateCommitMessage', requestId: id });
  }, [config, loaded, stagedCount, onError, onOpenSettings]);

  const handleCancel = useCallback(() => {
    if (!requestIdRef.current) return;
    postCommand({ type: 'aiCancelGenerate', requestId: requestIdRef.current });
    requestIdRef.current = null;
    setIsGenerating(false);
  }, []);

  if (isGenerating) {
    return (
      <button
        className={s.root}
        onClick={handleCancel}
        type="button"
        title={loc.aiCancel}
        aria-label={loc.aiCancel}
        data-state="generating"
      >
        <span className={s.spinner} />
      </button>
    );
  }

  const title = config
    ? loc.aiGenerate
    : tpl('{generate} ({notConfigured})', { generate: loc.aiGenerate, notConfigured: locAi.notConfigured });

  return (
    <button
      className={s.root}
      onClick={handleClick}
      disabled={disabled || !loaded}
      type="button"
      title={title}
      aria-label={loc.aiGenerate}
    >
      <AiSparkle />
    </button>
  );
}

function AiSparkle() {
  return (
    <svg className={s.icon} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5L9.6 6.4L14.5 8L9.6 9.6L8 14.5L6.4 9.6L1.5 8L6.4 6.4L8 1.5Z" fill="currentColor" />
      <path d="M12.5 11L13.1 12.4L14.5 13L13.1 13.6L12.5 15L11.9 13.6L10.5 13L11.9 12.4L12.5 11Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
