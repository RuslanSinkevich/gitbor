interface SgProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}

export function SgProgressBar({ value, max = 100, label, className = '' }: SgProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={`sg-progress ${className}`.trim()}>
      {label && <span className="sg-progress-label">{label}</span>}
      <div className="sg-progress-track">
        <div className="sg-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
