import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { HookItem } from './HookItem';
import s from './HooksDialog.module.css';

interface HookInfo {
  name: string;
  enabled: boolean;
  content: string;
}

interface Props {
  onClose: () => void;
}

/** Dialog listing all git hooks with toggle and content preview. */
export function HooksDialog({ onClose }: Props) {
  const loc = t();
  const hl = loc.hooks;
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'hooks') {
        setHooks(msg.data);
        setLoading(false);
      }
    });
    postCommand({ type: 'getHooks' });
    return unsub;
  }, []);

  const handleToggle = useCallback((name: string, enable: boolean) => {
    postCommand({ type: 'toggleHook', name, enable });
  }, []);

  return (
    <SgDialog
      open
      title={hl.title}
      onClose={onClose}
      size="md"
      footer={<button className="sg-button sg-button--ghost sg-button--md" onClick={onClose}>{hl.close}</button>}
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{hl.subtitle}</p>
      {loading ? (
        <div className={s.empty}>{t().app.loading}</div>
      ) : hooks.length === 0 ? (
        <div className={s.empty}>{hl.empty}</div>
      ) : (
        hooks.map((hook) => (
          <HookItem key={hook.name} hook={hook} labels={hl} onToggle={handleToggle} />
        ))
      )}
    </SgDialog>
  );
}
