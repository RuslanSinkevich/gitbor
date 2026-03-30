import { useState } from 'react';
import { CommitGraph } from '../../../features/graph/CommitGraph';
import { DEMO_GRAPH } from '../data';

export function GraphPreviewSection() {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  return (
    <div className="sg-showcase-section" style={{ height: 'calc(100vh - 120px)' }}>
      <CommitGraph
        commits={DEMO_GRAPH.commits}
        graphNodes={DEMO_GRAPH.graphNodes}
        maxColumns={DEMO_GRAPH.maxColumns}
        mergeLinks={DEMO_GRAPH.mergeLinks}
        selectedHash={selectedHash}
        onSelect={setSelectedHash}
        currentBranch="main"
        onContextMenu={(e) => { e.preventDefault(); }}
        showPrompt={() => {}}
      />
    </div>
  );
}
