import { useMemo, useState } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { t } from '../../i18n';
import { copyToClipboard } from '../../api';
import { useGitActivity } from './useGitActivity';
import type { GitActivityCommand, GitActivityEntry } from '../../types';
import s from './GitActivity.module.css';

interface Props {
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${m}m ${sec}s`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function totalDuration(entry: GitActivityEntry): number {
  if (entry.finishedAt) return entry.finishedAt - entry.startedAt;
  return Date.now() - entry.startedAt;
}

function buildCommandLine(cmd: GitActivityCommand): string {
  return `git ${cmd.args.join(' ')}`;
}

export function GitActivityDialog({ onClose }: Props) {
  const loc = t();
  const { entries, clear } = useGitActivity();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedCmdIdx, setCopiedCmdIdx] = useState<number | null>(null);

  const selected = useMemo(
    () => entries.find(e => e.id === selectedId) ?? entries[0] ?? null,
    [selectedId, entries],
  );

  const handleCopy = (idx: number, cmd: GitActivityCommand): void => {
    copyToClipboard(buildCommandLine(cmd));
    setCopiedCmdIdx(idx);
    window.setTimeout(() => setCopiedCmdIdx(c => (c === idx ? null : c)), 1500);
  };

  const statusClass = (status: GitActivityEntry['status']): string => {
    if (status === 'running') return s.statusRunning;
    if (status === 'success') return s.statusSuccess;
    return s.statusError;
  };
  const statusLabel = (status: GitActivityEntry['status']): string => {
    if (status === 'running') return loc.gitActivity.statusRunning;
    if (status === 'success') return loc.gitActivity.statusSuccess;
    return loc.gitActivity.statusError;
  };
  const dotClass = (status: GitActivityEntry['status']): string => {
    if (status === 'running') return `${s.dot} ${s.dotRunning}`;
    if (status === 'success') return `${s.dot} ${s.dotSuccess}`;
    return `${s.dot} ${s.dotError}`;
  };

  return (
    <SgDialog
      open
      title={loc.gitActivity.title}
      onClose={onClose}
      width={900}
      footer={
        <div className={s.footerBar}>
          <button className="sg-btn" onClick={clear} disabled={entries.length === 0}>
            {loc.gitActivity.clear}
          </button>
          <button className="sg-btn sg-btn-primary" onClick={onClose}>
            {loc.gitActivity.close}
          </button>
        </div>
      }
    >
      <div className={s.dialogBody}>
        <div className={s.list}>
          {entries.length === 0 && (
            <div className={s.listEmpty}>{loc.gitActivity.empty}</div>
          )}
          {entries.map(entry => {
            const active = selected?.id === entry.id;
            return (
              <div
                key={entry.id}
                className={`${s.listItem} ${active ? s.listItemActive : ''}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className={dotClass(entry.status)} />
                <div className={s.listItemBody}>
                  <div className={s.listItemTitle}>{entry.operation}</div>
                  <div className={s.listItemMeta}>
                    {formatTime(entry.startedAt)} · {formatDuration(totalDuration(entry))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={s.detail}>
          {!selected && <div className={s.detailEmpty}>{loc.gitActivity.empty}</div>}
          {selected && (
            <>
              <div className={s.detailHeader}>
                <span className={s.detailTitle}>{selected.operation}</span>
                <span className={`${s.detailStatus} ${statusClass(selected.status)}`}>
                  {statusLabel(selected.status)}
                </span>
                <span className={s.detailMeta}>
                  {formatTime(selected.startedAt)} · {formatDuration(totalDuration(selected))}
                </span>
                {selected.error && (
                  <span className={s.detailMeta} style={{ color: '#e06060' }}>
                    {selected.error}
                  </span>
                )}
              </div>

              <div className={s.commandsScroll}>
                {selected.commands.length === 0 && (
                  <div className={s.commandEmpty}>{loc.gitActivity.noCommandsYet}</div>
                )}
                {selected.commands.map((cmd, idx) => {
                  const exitFail = cmd.exitCode !== 0;
                  return (
                    <div key={idx} className={s.command}>
                      <div className={s.commandHeader}>
                        <span className={s.commandText}>$ {buildCommandLine(cmd)}</span>
                        <span className={`${s.commandExit} ${exitFail ? s.commandExitFail : ''}`}>
                          {loc.gitActivity.exit}: {cmd.exitCode} · {formatDuration(cmd.durationMs)}
                        </span>
                        <button
                          className={s.copyBtn}
                          onClick={() => handleCopy(idx, cmd)}
                          title={loc.gitActivity.copyCommand}
                        >
                          {copiedCmdIdx === idx ? loc.gitActivity.copied : loc.gitActivity.copyCommand}
                        </button>
                      </div>
                      {cmd.stdout && (
                        <>
                          <div className={s.outputLabel}>{loc.gitActivity.stdout}</div>
                          <pre className={s.outputBlock}>{cmd.stdout}</pre>
                        </>
                      )}
                      {cmd.stderr && (
                        <>
                          <div className={s.outputLabel}>{loc.gitActivity.stderr}</div>
                          <pre className={`${s.outputBlock} ${s.outputStderr}`}>{cmd.stderr}</pre>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </SgDialog>
  );
}
