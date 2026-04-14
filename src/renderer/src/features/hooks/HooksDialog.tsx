import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
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
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <h3 className={s.title}>{hl.title}</h3>
          <p className={s.subtitle}>{hl.subtitle}</p>
        </div>

        <div className={s.body}>
          {loading ? (
            <div className={s.empty}>Loading...</div>
          ) : hooks.length === 0 ? (
            <div className={s.empty}>{hl.empty}</div>
          ) : (
            hooks.map((hook) => (
              <HookItem key={hook.name} hook={hook} labels={hl} onToggle={handleToggle} />
            ))
          )}
        </div>

        <div className={s.footer}>
          <button className={s.btnSecondary} onClick={onClose}>{hl.close}</button>
        </div>
      </div>
    </div>
  );
}
