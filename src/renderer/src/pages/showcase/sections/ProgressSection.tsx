import { SgProgressBar } from '../../../ui';

export function ProgressSection() {
  return (
    <div className="sg-showcase-section">
      <SgProgressBar value={0} label="0%" />
      <SgProgressBar value={35} label="35%" />
      <SgProgressBar value={75} label="75%" />
      <SgProgressBar value={100} label="100%" />
    </div>
  );
}
