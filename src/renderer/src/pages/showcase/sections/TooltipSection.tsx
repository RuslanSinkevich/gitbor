import { SgButton, SgTooltip } from '../../../ui';
import { t } from '../../../i18n';

export function TooltipSection() {
  const loc = t();
  return (
    <div className="sg-showcase-section">
      <div className="sg-showcase-row">
        <SgTooltip text={loc.toolbar.fetch} position="top"><SgButton variant="secondary">Top</SgButton></SgTooltip>
        <SgTooltip text={loc.toolbar.pull} position="bottom"><SgButton variant="secondary">Bottom</SgButton></SgTooltip>
        <SgTooltip text={loc.toolbar.push} position="left"><SgButton variant="secondary">Left</SgButton></SgTooltip>
        <SgTooltip text={loc.toolbar.stash} position="right"><SgButton variant="secondary">Right</SgButton></SgTooltip>
      </div>
    </div>
  );
}
