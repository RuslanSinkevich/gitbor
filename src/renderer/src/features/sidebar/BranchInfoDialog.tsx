import { useEffect, useState } from 'react';
import type { Branch, CommitDetail } from '../../types';
import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { postCommand, onMainEvent, copyToClipboard } from '../../api';

interface Props {
  open: boolean;
  branch: Branch | null;
  onClose: () => void;
}

/**
 * Read-only диалог-сводка по ветке (Fork-style branch details).
 *
 * Источники данных:
 *   - имя, tip SHA, upstream, current/remote — поля `Branch` из стейта (без IPC);
 *   - последний коммит (author + date + subject) — `getCommitDetails(branch.hash)`
 *     через существующий IPC. Делаем prosto subscribe на `commitDetail`-events.
 *
 * Расширение (вне текущего scope): `git config branch.<name>.description` и
 * ahead/behind per branch — потребовало бы нового IPC `getBranchInfo`. Пока
 * показываем то, что уже есть в renderer-state — этого достаточно для MVP.
 */
export function BranchInfoDialog({ open, branch, onClose }: Props) {
  const loc = t();
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !branch) {
      setDetail(null);
      setLoading(false);
      return;
    }
    setDetail(null);
    setLoading(true);
    postCommand({ type: 'getCommitDetails', hash: branch.hash });

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'commitDetails' && msg.hash === branch.hash) {
        setDetail(msg.data);
        setLoading(false);
      }
    });
    return () => unsub();
  }, [open, branch]);

  if (!branch) return null;

  const tipShort = branch.hash.slice(0, 8);
  const title = `${loc.sidebar.branchInfo.replace(/[.…]+$/, '')} — ${branch.name}`;
  const date = detail ? new Date(detail.authorDate * 1000) : null;

  return (
    <SgDialog open={open} title={title} onClose={onClose} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <InfoRow label={loc.worktrees.branchName} value={branch.name} mono />
        <InfoRow
          label="SHA"
          value={
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <code>{tipShort}</code>
              <button
                type="button"
                className="sg-button sg-button--sm sg-button--ghost"
                onClick={() => copyToClipboard(branch.hash)}
                title={loc.contextMenu.copySha}
              >{loc.contextMenu.copyShaShort}</button>
            </span>
          }
        />
        {branch.upstream && <InfoRow label="Upstream" value={branch.upstream} mono />}
        <InfoRow label={loc.sidebar.current} value={branch.isCurrent ? '✓' : '—'} />
        <InfoRow label="Remote" value={branch.isRemote ? '✓' : '—'} />

        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--sg-border)', margin: '6px 0' }} />

        {loading && <div style={{ color: 'var(--sg-foreground-muted)' }}>{loc.app.loading}</div>}

        {!loading && detail && (
          <>
            <InfoRow label={loc.graph.author} value={`${detail.authorName} <${detail.authorEmail}>`} />
            <InfoRow label={loc.graph.date} value={date ? date.toLocaleString() : '—'} />
            <div>
              <div style={{ color: 'var(--sg-foreground-muted)', fontSize: 11, textTransform: 'uppercase', marginBottom: 2 }}>
                {loc.changes.commitMessage}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--sg-font-mono)', fontSize: 12 }}>
                {detail.subject}
                {detail.body ? `\n\n${detail.body}` : ''}
              </div>
            </div>
          </>
        )}
      </div>
    </SgDialog>
  );
}

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function InfoRow({ label, value, mono }: InfoRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'baseline' }}>
      <div style={{ color: 'var(--sg-foreground-muted)', fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: mono ? 'var(--sg-font-mono)' : undefined, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}
