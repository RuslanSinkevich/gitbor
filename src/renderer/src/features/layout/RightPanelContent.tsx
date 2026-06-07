import { DiffPanel } from '../diff';
import { FileHistory } from '../file-history';
import { BlameView } from '../blame';
import type { ShowContextMenuFn } from '../../hooks/useContextMenu';

export type RightPanel = 'diff' | 'history' | 'blame';

interface Props {
  rightPanel: RightPanel;
  setRightPanel: (p: RightPanel) => void;
  diffTarget: { file: string; hash: string };
  selectCommit: (hash: string) => void;
  openDiff: (file: string, hash: string) => void;
  onExpandDiff?: (file: string, hash: string) => void;
  showContextMenu?: ShowContextMenuFn;
}

export function RightPanelContent({ rightPanel, setRightPanel, diffTarget, selectCommit, openDiff, onExpandDiff, showContextMenu }: Props) {
  if (rightPanel === 'history') {
    return (
      <FileHistory
        file={diffTarget.file}
        onOpenDiff={(f, h) => { openDiff(f, h); setRightPanel('diff'); }}
        onContextMenu={showContextMenu}
      />
    );
  }
  if (rightPanel === 'blame') {
    return <BlameView file={diffTarget.file} hash={diffTarget.hash} onSelectCommit={selectCommit} />;
  }
  return <DiffPanel file={diffTarget.file} hash={diffTarget.hash} onExpand={onExpandDiff} />;
}
