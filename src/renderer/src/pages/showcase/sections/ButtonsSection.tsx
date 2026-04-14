import { SgButton, SgIconButton } from '../../../ui';
import { t } from '../../../i18n';

export function ButtonsSection() {
  const loc = t();
  return (
    <div className="sg-showcase-section">
      <h3>Variants</h3>
      <div className="sg-showcase-row">
        <SgButton variant="primary">Primary</SgButton>
        <SgButton variant="secondary">Secondary</SgButton>
        <SgButton variant="danger">{loc.dialog.delete}</SgButton>
        <SgButton variant="ghost">Ghost</SgButton>
      </div>
      <h3>Sizes</h3>
      <div className="sg-showcase-row">
        <SgButton size="sm">Small</SgButton>
        <SgButton size="md">Medium</SgButton>
        <SgButton size="lg">Large</SgButton>
      </div>
      <h3>Disabled</h3>
      <div className="sg-showcase-row">
        <SgButton disabled>Disabled Primary</SgButton>
        <SgButton variant="secondary" disabled>Disabled Secondary</SgButton>
      </div>
      <h3>Icon Buttons</h3>
      <div className="sg-showcase-row">
        <SgIconButton tooltip={loc.toolbar.fetch} size="sm">&#8635;</SgIconButton>
        <SgIconButton tooltip={loc.menu.repoSettings} size="md">&#9881;</SgIconButton>
        <SgIconButton tooltip={loc.dialog.close} size="lg">&times;</SgIconButton>
      </div>
    </div>
  );
}
