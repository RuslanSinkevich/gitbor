import { DiffPanel } from '../diff';
import { FileHistory } from '../file-history';
import { BlameView } from '../blame';

export type RightPanel = 'diff' | 'history' | 'blame';

interface Props {
  rightPanel: RightPanel;
  setRightPanel: (p: RightPanel) => void;
  diffTarget: { file: string; hash: string };
  selectCommit: (hash: string) => void;
  openDiff: (file: string, hash: string) => void;
}

export function RightPanelContent({ rightPanel, setRightPanel, diffTarget, selectCommit, openDiff }: Props) {
  if (rightPanel === 'history') {
    return <FileHistory file={diffTarget.file} onOpenDiff={(f, h) => { openDiff(f, h); setRightPanel('diff'); }} />;
  }
  if (rightPanel === 'blame') {
    return <BlameView file={diffTarget.file} hash={diffTarget.hash} onSelectCommit={selectCommit} />;
  }
  return <DiffPanel file={diffTarget.file} hash={diffTarget.hash} />;
}
