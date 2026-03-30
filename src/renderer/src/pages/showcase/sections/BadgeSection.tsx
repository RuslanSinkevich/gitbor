import { SgBadge } from '../../../ui';

export function BadgeSection() {
  return (
    <div className="sg-showcase-section">
      <div className="sg-showcase-row">
        <SgBadge>default</SgBadge>
        <SgBadge variant="success">success</SgBadge>
        <SgBadge variant="warning">warning</SgBadge>
        <SgBadge variant="danger">danger</SgBadge>
        <SgBadge variant="info">info</SgBadge>
      </div>
    </div>
  );
}
