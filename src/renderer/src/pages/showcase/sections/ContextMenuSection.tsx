import { useState } from 'react';
import { SgButton, SgContextMenu } from '../../../ui';
import type { SgContextMenuItem } from '../../../ui/SgContextMenu';
import { t } from '../../../i18n';

export function ContextMenuSection() {
  const loc = t();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const items: SgContextMenuItem[] = [
    { label: loc.contextMenu.checkout.replace('{branch}', 'develop'), action: () => {} },
    { label: loc.contextMenu.mergeInto.replace('{source}', 'develop').replace('{target}', 'main'), action: () => {} },
    { divider: true },
    { label: loc.contextMenu.rename.replace('{name}', 'develop'), shortcut: 'F2', action: () => {} },
    { label: loc.contextMenu.delete.replace('{name}', 'develop'), danger: true, action: () => {} },
    { label: loc.contextMenu.discard, disabled: true },
  ];

  return (
    <div className="sg-showcase-section">
      <SgButton
        variant="secondary"
        onContextMenu={(e) => { e.preventDefault(); setPos({ x: e.clientX, y: e.clientY }); }}
      >
        {loc.showcase.contextMenu} (right-click)
      </SgButton>
      {pos && <SgContextMenu x={pos.x} y={pos.y} items={items} onClose={() => setPos(null)} />}
    </div>
  );
}
