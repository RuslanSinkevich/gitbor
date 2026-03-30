import { SgTabs } from '../../../ui';
import { t } from '../../../i18n';

export function TabsSection() {
  const loc = t();
  return (
    <div className="sg-showcase-section">
      <SgTabs tabs={[
        { id: 'changes', label: loc.details.changes, content: <p>{loc.changes.noChanges}</p> },
        { id: 'graph', label: loc.graph.graph, content: <p>{loc.details.selectCommit}</p> },
        { id: 'merge', label: loc.merge.title, content: <p>{loc.merge.warningConflicts}</p> },
        { id: 'disabled', label: 'Disabled', content: <p>...</p>, disabled: true },
      ]} />
    </div>
  );
}
