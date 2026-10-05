import { useState, useCallback, useEffect, useRef } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { t, tpl } from '../../i18n';
import { postCommand, onMainEvent } from '../../api';
import type { MainEvent } from '../../types';
import { useAiConfig } from '../ai/useAiConfig';
import { AiIcon } from '../ai';
import { AI_ENABLED } from '@core/buildFlags';
import { loadStoredString, saveStoredString } from '../../shared/uiPersist';

/** Последний выбор «включить новые файлы»; по умолчанию — да, как у auto-stash. */
const INCLUDE_UNTRACKED_KEY = 'gitbor.stash.includeUntracked';

interface Props {
  onClose: () => void;
  onSubmit: (message: string, includeUntracked: boolean) => void;
}

/**
 * Диалог создания stash с AI-кнопкой «Предложить имя».
 *
 * Заменяет старый универсальный `usePromptDialog` для stash-флоу: туда
 * вписать кнопку рядом с input было невозможно (SgPromptDialog принимает
 * `kind: 'input' | 'confirm'`, и расширять его под one-off-фичу хуже,
 * чем сделать отдельный диалог).
 *
 * AI-кнопка скрыта, если фича выключена в Settings (`features.stashName=
 * false` или `aiEnabled=false`) либо провайдер вообще не настроен. Это
 * UI-gate; финальный gate всё равно в main (см. `runFeatureOnce`).
 */
export function StashCreateDialog({ onClose, onSubmit }: Props) {
  const loc = t().stashDialog;
  const tier2 = t().aiTier2;
  const { config, loaded } = useAiConfig();
  const [value, setValue] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(
    () => loadStoredString(INCLUDE_UNTRACKED_KEY) !== '0',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undoStackRef = useRef<string[]>([]);

  /* Подписка на одноразовый ответ `aiStashNameResult`. Сразу же снимается
     после прихода success/fail или unmount. Подписка ставится на каждом
     открытии диалога; main всегда шлёт ровно один ответ на команду. */
  useEffect(() => {
    if (!busy) return;
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type !== 'aiStashNameResult') return;
      setBusy(false);
      if (msg.success && msg.name) {
        undoStackRef.current.push(value);
        setValue(msg.name);
        setError(null);
      } else {
        setError(msg.error ?? 'unknown error');
      }
    });
    return unsub;
  }, [busy, value]);

  const aiAvailable =
    AI_ENABLED && loaded && !!config &&
    config.aiEnabled !== false &&
    config.features?.stashName !== false;

  const handleSuggest = useCallback(() => {
    if (!aiAvailable) return;
    setError(null);
    setBusy(true);
    postCommand({ type: 'aiSuggestStashName' });
  }, [aiAvailable]);

  const handleSubmit = useCallback(() => {
    saveStoredString(INCLUDE_UNTRACKED_KEY, includeUntracked ? '1' : '0');
    onSubmit(value.trim(), includeUntracked);
    onClose();
  }, [value, includeUntracked, onSubmit, onClose]);

  return (
    <SgDialog
      open
      title={loc.title}
      onClose={onClose}
      size="sm"
      onConfirm={handleSubmit}
      confirmLabel={loc.confirm}
    >
      <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
        {loc.label}
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          autoFocus
          className="sg-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={loc.placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          style={{ flex: 1 }}
          disabled={busy}
        />
        {aiAvailable && (
          <button
            type="button"
            className="sg-ai-button"
            onClick={handleSuggest}
            disabled={busy}
            title={busy ? tier2.stashSuggesting : tier2.stashSuggestTooltip}
            aria-label={busy ? tier2.stashSuggesting : tier2.stashSuggest}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, width: 30, height: 28, flexShrink: 0 }}
          >
            <AiIcon size={14} />
          </button>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={includeUntracked}
          onChange={(e) => setIncludeUntracked(e.target.checked)}
          disabled={busy}
        />
        {loc.includeUntracked}
      </label>
      {error && (
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--sg-danger)' }}>
          {tpl(tier2.stashSuggestFailed, { error })}
        </p>
      )}
    </SgDialog>
  );
}
