import { useCallback, useMemo, useState } from 'react';
import { postCommand } from '../api';
import { SgDialog } from '../ui/SgDialog';
import { SgSelect } from '../ui/SgSelect';
import { SgCheckbox } from '../ui/SgCheckbox';
import type { AppState } from '../types';
import type { t } from '../i18n';

interface PullDialogState {
  rebase: boolean;
  autostash: boolean;
  remote: string;
  branch: string;
}

interface PushDialogState {
  force: boolean;
  remote: string;
  branch: string;
}

interface UseSyncActionsResult {
  runPull: (rebase?: boolean) => void;
  runPush: (force?: boolean) => void;
  syncDialogs: React.ReactNode;
}

export function useSyncActions(state: AppState, loc: ReturnType<typeof t>): UseSyncActionsResult {
  const [pullDialog, setPullDialog] = useState<PullDialogState | null>(null);
  const [pushDialog, setPushDialog] = useState<PushDialogState | null>(null);

  const remoteOptions = useMemo(
    () => state.remotes.map((r) => ({ value: r.name, label: r.name })),
    [state.remotes],
  );

  const remoteBranchOptions = useCallback((remote: string) => {
    const prefix = `${remote}/`;
    const options = state.branches
      .filter((b) => b.isRemote && b.name.startsWith(prefix))
      .map((b) => {
        const shortName = b.name.slice(prefix.length);
        return { value: shortName, label: b.name };
      });
    return options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  }, [state.branches]);

  const pushBranchOptions = useCallback((remote: string) => {
    const options = remoteBranchOptions(remote);
    const currentName = state.currentBranch || '';
    if (!currentName) return options;
    if (options.some((o) => o.value === currentName)) return options;
    return [{ value: currentName, label: currentName }, ...options];
  }, [remoteBranchOptions, state.currentBranch]);

  const pickDefaultBranchForRemote = useCallback((remote: string) => {
    const options = remoteBranchOptions(remote);
    if (options.length === 0) return '';

    const currentLocal = state.branches.find((b) => b.isCurrent && !b.isRemote);
    const currentName = state.currentBranch || '';

    if (currentLocal?.upstream?.startsWith(`${remote}/`)) {
      const upstreamShort = currentLocal.upstream.slice(remote.length + 1);
      const upstreamMatch = options.find((o) => o.value === upstreamShort);
      if (upstreamMatch) return upstreamMatch.value;
    }

    const sameName = options.find((o) => o.value === currentName);
    if (sameName) return sameName.value;

    return options[0].value;
  }, [remoteBranchOptions, state.branches, state.currentBranch]);

  /**
   * Дефолтный remote для push/pull диалогов. Приоритет:
   *  1) remote из upstream текущей ветки (`<remote>/<branch>`) — самый точный
   *     сигнал;
   *  2) remote, где есть remote-tracking branch с ТЕМ ЖЕ именем, что
   *     текущая локальная ветка — если такой remote ровно один, берём его
   *     (юзер на ветке `stage`, она существует только на `tfs/stage` —
   *     дефолт `tfs`, не `origin`);
   *  3) `origin` если он есть — конвенция git;
   *  4) первый remote из списка.
   * Без шага 2 при 3 remote'ах модалка часто открывалась на `origin`,
   * хотя ветка живёт на другом remote.
   */
  const pickDefaultRemote = useCallback(() => {
    const remotes = state.remotes.map((r) => r.name);
    if (remotes.length === 0) return 'origin';

    const currentLocal = state.branches.find((b) => b.isCurrent && !b.isRemote);
    const upstream = currentLocal?.upstream;
    if (upstream) {
      const slash = upstream.indexOf('/');
      if (slash > 0) {
        const remoteFromUpstream = upstream.slice(0, slash);
        if (remotes.includes(remoteFromUpstream)) return remoteFromUpstream;
      }
    }

    const currentName = state.currentBranch || '';
    if (currentName) {
      const remotesWithBranch = remotes.filter((r) =>
        state.branches.some((b) => b.isRemote && b.name === `${r}/${currentName}`),
      );
      if (remotesWithBranch.length === 1) return remotesWithBranch[0];
      // Если ветка есть на нескольких remote — это смешанный сетап,
      // отдаём приоритет origin (или, если его нет в этом подмножестве,
      // первому remote, где она найдена). Не возвращаем «случайный» origin
      // из общего списка, на котором ветки может не быть вообще.
      if (remotesWithBranch.length > 1) {
        if (remotesWithBranch.includes('origin')) return 'origin';
        return remotesWithBranch[0];
      }
    }

    if (remotes.includes('origin')) return 'origin';
    return remotes[0];
  }, [state.remotes, state.branches, state.currentBranch]);

  /**
   * Для PUSH-диалога: если у локальной ветки нет upstream и на remote нет
   * ветки с таким же именем — НИКОГДА не подставляем чужую remote-ветку
   * (`develop`/`main`) как target. Иначе юзер по дефолту запушит свои
   * коммиты в общую ветку. Возвращаем имя локальной ветки — push создаст
   * новую remote-ветку с этим именем (через -u origin HEAD:<name>).
   */
  const pickDefaultBranchForPush = useCallback((remote: string) => {
    const options = remoteBranchOptions(remote);
    const currentLocal = state.branches.find((b) => b.isCurrent && !b.isRemote);
    const currentName = state.currentBranch || '';

    if (currentLocal?.upstream?.startsWith(`${remote}/`)) {
      const upstreamShort = currentLocal.upstream.slice(remote.length + 1);
      if (options.some((o) => o.value === upstreamShort)) return upstreamShort;
    }

    if (currentName && options.some((o) => o.value === currentName)) return currentName;

    return currentName;
  }, [remoteBranchOptions, state.branches, state.currentBranch]);

  const runPull = useCallback((rebase?: boolean) => {
    const hasUpstream = state.branches.some((b) => b.isCurrent && !!b.upstream);
    if (hasUpstream) {
      postCommand({ type: 'pull', rebase });
      return;
    }

    const defaultRemote = pickDefaultRemote();
    const defaultBranch = pickDefaultBranchForRemote(defaultRemote) || state.currentBranch || '';
    setPullDialog({ rebase: !!rebase, autostash: false, remote: defaultRemote, branch: defaultBranch });
  }, [state.branches, state.currentBranch, pickDefaultRemote, pickDefaultBranchForRemote]);

  const runPush = useCallback((force?: boolean) => {
    const hasUpstream = state.branches.some((b) => b.isCurrent && !!b.upstream);
    if (hasUpstream) {
      postCommand({ type: 'push', force });
      return;
    }

    const defaultRemote = pickDefaultRemote();
    const defaultBranch = pickDefaultBranchForPush(defaultRemote) || state.currentBranch || '';
    setPushDialog({ force: !!force, remote: defaultRemote, branch: defaultBranch });
  }, [state.branches, state.currentBranch, pickDefaultRemote, pickDefaultBranchForPush]);

  const syncDialogs = (
    <>
      {pullDialog && (
        <SgDialog
          open={true}
          title={loc.toolbar.pull}
          onClose={() => setPullDialog(null)}
          width={520}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="sg-button sg-button--md sg-button--ghost" onClick={() => setPullDialog(null)}>
                {loc.dialog.cancel}
              </button>
              <button
                className="sg-button sg-button--md sg-button--primary"
                onClick={() => {
                  postCommand({
                    type: 'pullFrom',
                    remote: pullDialog.remote,
                    branch: pullDialog.branch,
                    rebase: pullDialog.rebase || undefined,
                    autostash: pullDialog.autostash || undefined,
                  });
                  setPullDialog(null);
                }}
                disabled={!pullDialog.remote || !pullDialog.branch}
              >
                {loc.toolbar.pull}
              </button>
            </div>
          }
        >
          <SgSelect
            label={loc.toolbar.pullRemote}
            value={pullDialog.remote}
            options={remoteOptions}
            onChange={(e) => {
              const remote = e.target.value;
              setPullDialog((prev) => prev ? { ...prev, remote, branch: pickDefaultBranchForRemote(remote) } : prev);
            }}
          />
          <SgSelect
            label={loc.toolbar.pullBranch}
            value={pullDialog.branch}
            options={remoteBranchOptions(pullDialog.remote)}
            onChange={(e) => setPullDialog((prev) => prev ? { ...prev, branch: e.target.value } : prev)}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <SgCheckbox
              label={loc.toolbar.pullRebaseInsteadOfMerge}
              checked={pullDialog.rebase}
              onChange={(e) => setPullDialog((prev) => prev ? { ...prev, rebase: e.target.checked } : prev)}
            />
            <SgCheckbox
              label={loc.toolbar.pullAutostash}
              checked={pullDialog.autostash}
              onChange={(e) => setPullDialog((prev) => prev ? { ...prev, autostash: e.target.checked } : prev)}
            />
          </div>
        </SgDialog>
      )}
      {pushDialog && (
        <SgDialog
          open={true}
          title={loc.toolbar.push}
          onClose={() => setPushDialog(null)}
          width={520}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="sg-button sg-button--md sg-button--ghost" onClick={() => setPushDialog(null)}>
                {loc.dialog.cancel}
              </button>
              <button
                className="sg-button sg-button--md sg-button--primary"
                onClick={() => {
                  postCommand({
                    type: 'pushTo',
                    remote: pushDialog.remote,
                    branch: pushDialog.branch,
                    force: pushDialog.force || undefined,
                    setUpstream: true,
                  });
                  setPushDialog(null);
                }}
                disabled={!pushDialog.remote || !pushDialog.branch}
              >
                {loc.toolbar.push}
              </button>
            </div>
          }
        >
          <SgSelect
            label={loc.toolbar.pullRemote}
            value={pushDialog.remote}
            options={remoteOptions}
            onChange={(e) => {
              const remote = e.target.value;
              setPushDialog((prev) => prev ? { ...prev, remote, branch: pickDefaultBranchForPush(remote) || state.currentBranch || '' } : prev);
            }}
          />
          <SgSelect
            label={loc.toolbar.pullBranch}
            value={pushDialog.branch}
            options={pushBranchOptions(pushDialog.remote)}
            onChange={(e) => setPushDialog((prev) => prev ? { ...prev, branch: e.target.value } : prev)}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <SgCheckbox
              label={loc.toolbar.pushForce}
              checked={pushDialog.force}
              onChange={(e) => setPushDialog((prev) => prev ? { ...prev, force: e.target.checked } : prev)}
            />
          </div>
        </SgDialog>
      )}
    </>
  );

  return { runPull, runPush, syncDialogs };
}
