import { SgTable } from '../../../ui';
import { t } from '../../../i18n';
import { DEMO_TABLE_DATA } from '../data';

export function TableSection() {
  const loc = t();
  return (
    <div className="sg-showcase-section">
      <SgTable
        columns={[
          { key: 'hash', title: loc.graph.sha, width: 80 },
          { key: 'message', title: loc.graph.description },
          { key: 'author', title: loc.graph.author, width: 100 },
          { key: 'date', title: loc.graph.date, width: 120 },
        ]}
        data={DEMO_TABLE_DATA}
        rowKey={(row) => row.hash}
      />
    </div>
  );
}
