import { useState } from 'react';
import { SgTree } from '../../../ui';
import { DEMO_TREE } from '../data';

export function TreeSection() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="sg-showcase-section">
      <div style={{ maxWidth: 300, border: '1px solid var(--sg-border)', borderRadius: 'var(--sg-radius)', padding: 8 }}>
        <SgTree
          nodes={DEMO_TREE}
          selectedId={selected}
          onSelect={(node) => setSelected(node.id)}
        />
      </div>
      <p style={{ marginTop: 8, fontSize: 12, color: 'var(--sg-foreground-muted)' }}>
        Selected: {selected || 'none'}
      </p>
    </div>
  );
}
