import s from './CommitGraph.module.css';

const GPG_LABELS: Record<string, { label: string; cls: string }> = {
  G: { label: '✓ Signed', cls: s.gpgGood },
  U: { label: '✓ Untrusted', cls: s.gpgUntrusted },
  B: { label: '✗ Bad sig', cls: s.gpgBad },
  X: { label: '✓ Expired', cls: s.gpgUntrusted },
  Y: { label: '✓ Exp.key', cls: s.gpgUntrusted },
  R: { label: '✗ Revoked', cls: s.gpgBad },
  // 'E' (signature cannot be verified — no key) намеренно отброшено в
  // GitParser, чтобы не засорять граф чужих репо «? Err» бейджами.
};

/** Small inline badge showing GPG/SSH signature verification status. */
export function GpgBadge({ status }: { status: string }) {
  const info = GPG_LABELS[status];
  if (!info) return null;
  return <span className={`${s.gpgBadge} ${info.cls}`}>{info.label}</span>;
}
