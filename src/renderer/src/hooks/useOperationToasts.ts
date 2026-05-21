import { useEffect } from 'react';
import { t, tpl } from '../i18n';
import { postCommand } from '../api';
import type { GitErrorClass, RendererCommand } from '../types';
import type { OperationResult } from './useAppState';
import type { SgToastAction } from '../ui/SgToast';

const SILENT_OPS = [
  'createBranch', 'deleteBranch', 'renameBranch', 'createTag', 'deleteTag',
  'addRemote', 'removeRemote', 'renameRemote', 'submoduleInit', 'submoduleUpdate',
  'clone', 'init',
];

/**
 * Классы, по которым SafetyDialog возьмёт показ на себя — toast НЕ
 * нужен (он будет дублировать модал). Совпадает с SUPPRESS_TOAST_CLASSES
 * в useSafetyDialog.
 */
const HIDDEN_BY_DIALOG: GitErrorClass[] = [
  'lock_held', 'conflict', 'dirty_tree', 'merge_in_progress', 'rebase_in_progress',
  'cherry_pick_in_progress', 'revert_in_progress', 'unmerged_paths',
  'preflight_blocked', 'untracked_overwrite',
];

export function useOperationToasts(
  lastOpResult: OperationResult | null,
  clearLastOpResult: () => void,
  addToast: (
    msg: string,
    type: 'success' | 'error' | 'info' | 'warning',
    action?: SgToastAction,
  ) => void,
  lastCommandRef?: { current: RendererCommand | null },
) {
  useEffect(() => {
    if (!lastOpResult) return;
    clearLastOpResult();
    const { operation, success, error, errorClass } = lastOpResult;
    if (SILENT_OPS.includes(operation)) return;

    const ops = t().operations;
    if (success) {
      const msg: Record<string, string> = {
        fetch: ops.fetchSuccess, pull: ops.pullSuccess, push: ops.pushSuccess,
        stash: ops.stashSuccess, stashPop: ops.stashPopSuccess,
        commit: ops.commitSuccess, merge: ops.mergeSuccess, rebase: ops.rebaseSuccess,
        'cherry-pick': ops.cherryPickSuccess, revert: ops.revertSuccess,
        reset: ops.resetSuccess, checkout: ops.genericSuccess,
      };
      addToast(msg[operation] || tpl(ops.genericSuccess, { operation }), 'success');
      return;
    }

    // SafetyDialog уже видит errorClass и сам откроется — не дублируем.
    if (errorClass && HIDDEN_BY_DIALOG.includes(errorClass)) return;

    // network/auth — лёгкий путь: action-toast с Retry, не модал.
    if ((errorClass === 'network' || errorClass === 'auth') && lastCommandRef?.current) {
      const cmd = lastCommandRef.current;
      addToast(
        error || tpl(ops.genericError, { operation }),
        'error',
        { label: t().safety.toastRetry, onClick: () => postCommand(cmd) },
      );
      return;
    }

    addToast(error || tpl(ops.genericError, { operation }), 'error');
  }, [lastOpResult, clearLastOpResult, addToast, lastCommandRef]);
}
