import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent, copyToClipboard } from '../../api';
import { t, tpl } from '../../i18n';
import type { ReflogEntry } from '../../types';
import type { ShowPrompt } from '../graph/commitMenuItems';
import { SgDialog } from '../../ui/SgDialog';
import { ReflogTable } from './ReflogTable';
import { useAiConfig } from '../ai/useAiConfig';
import { useAiStream } from '../ai/useAiStream';
import { AiIcon, AiSections } from '../ai';
import { AI_ENABLED } from '@core/buildFlags';
import s from './ReflogDialog.module.css';

interface Props {
  onClose: () => void;
  showPrompt: ShowPrompt;
}

/** Dialog showing git reflog with ability to restore (hard reset) to any entry. */
export function ReflogDialog({ onClose, showPrompt }: Props) {
  const loc = t();
  const tier2 = loc.aiTier2;
  const rl = loc.reflog;
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { config, loaded: aiLoaded } = useAiConfig();
  const stream = useAiStream();

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'reflog') {
        setEntries(msg.data);
        setLoading(false);
      }
    });
    postCommand({ type: 'getReflog', maxCount: 100 });
    return unsub;
  }, []);

  /* AI-кнопка видна только если фича включена в Settings. UI-gate, финальная
     проверка в main (см. AiHandlers.runFeature). */
  const aiAvailable =
    AI_ENABLED && aiLoaded && !!config &&
    config.aiEnabled !== false &&
    config.features?.explainReflog !== false;

  const handleExplain = useCallback(() => {
    stream.start((requestId) => ({ type: 'aiExplainReflog', requestId, maxCount: 100 }));
  }, [stream]);

  const handleCopyHash = useCallback((hash: string) => {
    copyToClipboard(hash);
  }, []);

  const handleRestore = useCallback((entry: ReflogEntry) => {
    showPrompt({
      kind: 'confirm',
      title: rl.restoreTitle,
      message: tpl(rl.restoreConfirm, { hash: entry.shortHash }),
      confirmLabel: rl.restore,
      danger: true,
      onConfirm: () => {
        postCommand({ type: 'restoreReflog', hash: entry.hash });
        onClose();
      },
    });
  }, [rl, showPrompt, onClose]);

  return (
    <SgDialog
      open
      title={rl.title}
      onClose={onClose}
      size="xl"
      footer={<button className="sg-button sg-button--ghost sg-button--md" onClick={onClose}>{loc.dialog.close}</button>}
    >
      <div className={s.toolbar}>
        <p className={s.toolbarHint}>{rl.subtitle}</p>
        {aiAvailable && (
          <button
            type="button"
            className={`sg-ai-button ${s.aiButton}`}
            onClick={stream.busy ? stream.cancel : handleExplain}
            disabled={!stream.busy && entries.length === 0}
            title={stream.busy ? tier2.cancel : tier2.explainReflogTooltip}
            aria-label={stream.busy ? tier2.cancel : tier2.explainReflog}
          >
            <AiIcon size={14} />
          </button>
        )}
      </div>

      {stream.error && (
        <div className={s.aiError}>{stream.error}</div>
      )}
      {(stream.busy || stream.text) && (
        <div className={s.aiPanel}>
          <button
            type="button"
            className={s.aiClose}
            onClick={stream.reset}
            title={tier2.hide}
            aria-label={tier2.hide}
          >
            ×
          </button>
          {stream.busy && !stream.text && <div className={s.aiBusy}>{tier2.explainingReflog}</div>}
          {stream.text && <AiSections text={stream.text} />}
          {!stream.busy && stream.text && (
            <div className={s.aiDisclaimer}>{tier2.disclaimer}</div>
          )}
        </div>
      )}

      {loading ? (
        <div className={s.loading}>{loc.app.loading}</div>
      ) : entries.length === 0 ? (
        <div className={s.empty}>{rl.empty}</div>
      ) : (
        <ReflogTable
          entries={entries}
          headerLabels={{ hash: rl.hash, action: rl.action, message: rl.message, date: rl.date }}
          restoreLabel={rl.restore}
          onCopyHash={handleCopyHash}
          onRestore={handleRestore}
        />
      )}
    </SgDialog>
  );
}
