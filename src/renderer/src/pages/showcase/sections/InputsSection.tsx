import { SgInput, SgTextArea } from '../../../ui';
import { t } from '../../../i18n';

export function InputsSection() {
  const loc = t();
  return (
    <div className="sg-showcase-section">
      <SgInput label={loc.sidebar.branches} placeholder="feature/my-branch" />
      <SgInput label="Error" placeholder="..." error={loc.changes.noChanges} />
      <SgInput placeholder={loc.sidebar.filter} />
      <SgTextArea label={loc.changes.commitMessage} placeholder="..." />
    </div>
  );
}
