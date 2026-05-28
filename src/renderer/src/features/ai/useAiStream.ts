import { useCallback, useEffect, useRef, useState } from 'react';
import { onMainEvent, postCommand } from '../../api';
import type { MainEvent, RendererCommand } from '../../types';

interface AiStreamState {
  text: string;
  busy: boolean;
  error: string | null;
  errorKind: string | null;
}

/**
 * Хук-обёртка над общим Tier-2 streaming-протоколом (aiChunk / aiDone /
 * aiError + aiCancelGenerate по requestId). Принимает фабрику команды
 * (renderer командует main: «начать explain»), возвращает текущее
 * накопленное состояние + start/cancel/reset.
 *
 * Зачем хук: 3 фичи (Commit Explainer, Reflog Explainer, Conflict
 * Helper) шлют разные команды (aiExplainCommit/aiExplainReflog/
 * aiAnalyzeConflict), но handshake одинаков — поэтому подписку на
 * MainEvent держим один раз здесь, а не клонируем в каждом компоненте.
 */
export function useAiStream() {
  const [state, setState] = useState<AiStreamState>({
    text: '',
    busy: false,
    error: null,
    errorKind: null,
  });
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = onMainEvent((msg: MainEvent) => {
      const current = requestIdRef.current;
      if (!current) return;
      if ((msg.type === 'aiChunk' || msg.type === 'aiDone' || msg.type === 'aiError') && msg.requestId !== current) {
        return;
      }
      if (msg.type === 'aiChunk') {
        setState((prev) => ({ ...prev, text: prev.text + msg.delta }));
      } else if (msg.type === 'aiDone') {
        /* Если стрим был включён, текст уже накоплен через aiChunk; финальный
           msg.text может содержать полностью переписанный (postProcess)
           результат — берём его как авторитет, иначе оставляем накопленный. */
        setState((prev) => ({ text: msg.text || prev.text, busy: false, error: null, errorKind: null }));
        requestIdRef.current = null;
      } else if (msg.type === 'aiError') {
        setState({ text: '', busy: false, error: msg.message, errorKind: msg.kind });
        requestIdRef.current = null;
      }
    });
    return unsub;
  }, []);

  /* Отменяем in-flight генерацию при размонтировании владельца хука
     (закрытие диалога / переключение коммита). */
  useEffect(() => () => {
    if (requestIdRef.current) {
      postCommand({ type: 'aiCancelGenerate', requestId: requestIdRef.current });
      requestIdRef.current = null;
    }
  }, []);

  const start = useCallback((makeCommand: (requestId: string) => RendererCommand) => {
    /* Если уже что-то в работе — отменяем; повторный клик == «перегенерировать». */
    if (requestIdRef.current) {
      postCommand({ type: 'aiCancelGenerate', requestId: requestIdRef.current });
    }
    const id = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requestIdRef.current = id;
    setState({ text: '', busy: true, error: null, errorKind: null });
    postCommand(makeCommand(id));
  }, []);

  const cancel = useCallback(() => {
    if (!requestIdRef.current) return;
    postCommand({ type: 'aiCancelGenerate', requestId: requestIdRef.current });
    requestIdRef.current = null;
    setState((prev) => ({ ...prev, busy: false }));
  }, []);

  const reset = useCallback(() => {
    if (requestIdRef.current) {
      postCommand({ type: 'aiCancelGenerate', requestId: requestIdRef.current });
      requestIdRef.current = null;
    }
    setState({ text: '', busy: false, error: null, errorKind: null });
  }, []);

  return { ...state, start, cancel, reset };
}
