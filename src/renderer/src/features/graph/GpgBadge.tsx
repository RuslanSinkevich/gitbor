import { t } from '../../i18n';
import s from './CommitGraph.module.css';

const GPG_STATUS_KEYS = {
  G: 'signed',
  U: 'untrusted',
  B: 'bad',
  X: 'expired',
  Y: 'expiredKey',
  R: 'revoked',
} as const;

const GPG_STATUS_CLS: Record<string, string> = {
  G: s.gpgGood,
  U: s.gpgUntrusted,
  B: s.gpgBad,
  X: s.gpgUntrusted,
  Y: s.gpgUntrusted,
  R: s.gpgBad,
};

/** Small inline badge showing GPG/SSH signature verification status. */
export function GpgBadge({ status }: { status: string }) {
  const key = GPG_STATUS_KEYS[status as keyof typeof GPG_STATUS_KEYS];
  const cls = GPG_STATUS_CLS[status];
  if (!key || !cls) return null;
  const loc = t();
  const label = loc.graph.gpg[key];
  return <span className={`${s.gpgBadge} ${cls}`}>{label}</span>;
}
