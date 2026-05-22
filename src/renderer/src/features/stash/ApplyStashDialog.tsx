import { useState } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { postCommand } from '../../api';
import { t } from '../../i18n';

interface Props {
  stashIndex: string;
  stashMessage: string;
  onClose(): void;
}

/**
 * Fork-стиль диалог Apply Stash:
 *  - чекбокс «delete after apply» = git stash pop;
 *  - если выключен — git stash apply, stash остаётся;
 *  - drop в pop'е не сработает при конфликте (поведение git'а), подсказка в UI.
 */
export function ApplyStashDialog({ stashIndex, stashMessage, onClose }: Props) {
  const loc = t().stashDialog;
  const [drop, setDrop] = useState(false);

  const handleApply = () => {
    if (drop) postCommand({ type: 'stashPopIndex', index: stashIndex });
    else postCommand({ type: 'stashApply', index: stashIndex });
    onClose();
  };

  return (
    <SgDialog
      open
      title={loc.applyTitle}
      onClose={onClose}
      size="sm"
      onConfirm={handleApply}
      confirmLabel={loc.applyConfirm}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--sg-foreground-muted)' }}>{loc.applyTo}</div>
          <div
            title={stashMessage}
            style={{
              fontSize: 13,
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {stashMessage || `stash@{${stashIndex}}`}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            aria-label={loc.deleteAfter}
            checked={drop}
            onChange={(e) => setDrop(e.target.checked)}
          />
          {loc.deleteAfter}
        </label>
        <div style={{ fontSize: 11, color: 'var(--sg-foreground-muted)' }}>
          {loc.conflictNote}
        </div>
      </div>
    </SgDialog>
  );
}
