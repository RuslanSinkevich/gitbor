import s from './ReflogDialog.module.css';

const ACTION_STYLES: Record<string, string> = {
  checkout: s.badgeCheckout,
  commit: s.badgeCommit,
  merge: s.badgeMerge,
  rebase: s.badgeRebase,
  reset: s.badgeReset,
  pull: s.badgePull,
  'cherry-pick': s.badgeCommit,
  revert: s.badgeReset,
  'initial': s.badgeCommit,
  clone: s.badgePull,
};

/** Colored badge showing the reflog action type (checkout, commit, etc.). */
export function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_STYLES[action] ?? s.badgeOther;
  return <span className={`${s.badge} ${cls}`}>{action}</span>;
}
