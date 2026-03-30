import { SgSplitPane } from '../../../ui';
import { t } from '../../../i18n';

export function SplitPaneSection() {
  const loc = t();
  return (
    <div className="sg-showcase-section" style={{ height: 200 }}>
      <SgSplitPane
        left={<div style={{ padding: 12, background: 'var(--sg-surface)' }}>{loc.sidebar.branches}</div>}
        right={<div style={{ padding: 12 }}>{loc.details.selectCommit}</div>}
        defaultSize={200}
      />
    </div>
  );
}
