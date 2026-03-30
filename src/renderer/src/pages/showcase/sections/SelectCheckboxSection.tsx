import { SgSelect, SgCheckbox } from '../../../ui';
import { t } from '../../../i18n';

export function SelectCheckboxSection() {
  const loc = t();
  return (
    <div className="sg-showcase-section">
      <SgSelect
        label={loc.merge.options}
        options={[
          { value: 'merge', label: loc.merge.mergeCommit },
          { value: 'nocommit', label: loc.merge.noCommit },
          { value: 'ff', label: loc.merge.ffOnly },
          { value: 'squash', label: loc.merge.squash },
        ]}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SgCheckbox label={loc.merge.noCommit} />
        <SgCheckbox label={loc.dialog.deleteOnRemote} defaultChecked />
        <SgCheckbox label="Disabled" disabled />
      </div>
    </div>
  );
}
