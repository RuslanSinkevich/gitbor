import { useEffect } from 'react';
import { t, tpl } from '../i18n';
import type { OperationResult } from './useAppState';

const SILENT_OPS = [
  'createBranch', 'deleteBranch', 'renameBranch', 'createTag', 'deleteTag',
  'addRemote', 'removeRemote', 'renameRemote', 'submoduleInit', 'submoduleUpdate',
  'clone', 'init',
];

export function useOperationToasts(
  lastOpResult: OperationResult | null,
  clearLastOpResult: () => void,
  addToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void,
) {
  useEffect(() => {
    if (!lastOpResult) return;
    clearLastOpResult();
    const { operation, success } = lastOpResult;
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
    }
  }, [lastOpResult, clearLastOpResult, addToast]);
}
