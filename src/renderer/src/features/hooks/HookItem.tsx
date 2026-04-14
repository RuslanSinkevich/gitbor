import { useState } from 'react';
import s from './HooksDialog.module.css';

interface HookInfo {
  name: string;
  enabled: boolean;
  content: string;
}

interface Props {
  hook: HookInfo;
  labels: { enabled: string; disabled: string; content: string };
  onToggle: (name: string, enable: boolean) => void;
}

/** Single hook row with expandable content preview and enable/disable toggle. */
export function HookItem({ hook, labels, onToggle }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={s.hookItem}>
      <div className={s.hookHeader} onClick={() => setExpanded((v) => !v)}>
        <span className={s.hookName}>{hook.name}</span>
        <span className={`${s.hookBadge} ${hook.enabled ? s.hookEnabled : s.hookDisabled}`}>
          {hook.enabled ? labels.enabled : labels.disabled}
        </span>
        <button
          className={`${s.toggle} ${hook.enabled ? s.toggleOn : s.toggleOff}`}
          onClick={(e) => { e.stopPropagation(); onToggle(hook.name, !hook.enabled); }}
          title={hook.enabled ? labels.disabled : labels.enabled}
        />
      </div>
      {expanded && hook.content && (
        <div className={s.hookContent}>
          <div className={s.codeBlock}>{hook.content}</div>
        </div>
      )}
    </div>
  );
}
