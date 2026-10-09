import { useEffect, useState } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { invokeCommand } from '../../api';
import { t, tpl } from '../../i18n';
import type { Branch, Commit } from '../../types';

interface Props {
  commit: Commit | null;
  branches: Branch[];
  onClose: () => void;
}

interface Containing { local: string[]; remote: string[] }

/** Основные ветки процесса — их показываем первыми с ✓/✗. */
const KEY_BRANCH_RE = /^(develop|dev|stage|staging|test|prod|production|main|master|release(?:[/-].*)?)$/i;

/** Ветка-«основная» по короткому имени: `origin/develop` → `develop`. */
function keyName(b: Branch): string | null {
  const name = b.isRemote ? b.name.slice(b.name.indexOf('/') + 1) : b.name;
  return KEY_BRANCH_RE.test(name) ? name : null;
}

/**
 * «В каких ветках есть коммит» — отвечает на «уже попало в develop/stage/prod?».
 * Основная ветка считается содержащей коммит, если он есть в локальной ИЛИ в
 * любой remote-копии (локальная может отставать).
 */
export function BranchesContainingDialog({ commit, branches, onClose }: Props) {
  const loc = t().commitMenu;
  const [data, setData] = useState<Containing | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!commit) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    invokeCommand({ type: 'getBranchesContaining', hash: commit.hash })
      .then((r) => {
        if (cancelled) return;
        if (r && typeof r === 'object') setData(r as Containing);
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [commit]);

  if (!commit) return null;

  const keys = Array.from(new Set(branches.map(keyName).filter((n): n is string => !!n)));
  const contains = new Set([...(data?.local ?? []), ...(data?.remote ?? []).map(r => r.slice(r.indexOf('/') + 1))]);
  const all = [...(data?.local ?? []), ...(data?.remote ?? [])];

  return (
    <SgDialog
      open
      title={tpl(loc.containingTitle, { hash: commit.hash.slice(0, 7) })}
      onClose={onClose}
      size="md"
    >
      <div style={{ fontSize: 12, color: 'var(--sg-foreground-muted)', marginBottom: 10, overflowWrap: 'anywhere' }}>
        {commit.subject}
      </div>
      {failed && <div style={{ fontSize: 13 }}>{loc.containingFailed}</div>}
      {!failed && !data && <div style={{ fontSize: 13 }}>{t().diff.loading}</div>}
      {data && (
        <>
          {keys.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 13, marginBottom: 12 }}>
              {keys.map(k => {
                const yes = contains.has(k);
                return (
                  <div key={k} style={{ display: 'contents' }}>
                    <span style={{ color: yes ? 'var(--sg-success, #3fb950)' : 'var(--sg-danger)', fontWeight: 600 }}>{yes ? '✓' : '✗'}</span>
                    <span title={yes ? loc.containingYes : loc.containingNo}>{k}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {tpl(loc.containingAll, { count: String(all.length) })}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', fontSize: 12, fontFamily: 'var(--sg-font-mono, monospace)' }}>
            {all.length === 0 && <div style={{ color: 'var(--sg-foreground-muted)' }}>{loc.containingNone}</div>}
            {all.map(name => (
              <div key={name} title={name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {name}
              </div>
            ))}
          </div>
        </>
      )}
    </SgDialog>
  );
}
