import { useEffect, useRef } from 'react';
import type { MergeState, CommitDetail } from '../types';
import type { OpenDiffEvent, OpenMergeEditorEvent, MenuActionEvent } from './useAppState';
import type { SgToastData } from '../ui/SgToast';
import type { ShowPrompt } from '../features/graph/commitMenuItems';
import { postCommand } from '../api';

type ViewMode = 'changes' | 'commits';

interface UseAppEffectsParams {
  error: string | null;
  clearError: () => void;
  viewOverride: ViewMode | null;
  clearViewOverride: () => void;
  pendingOpenDiff: OpenDiffEvent | null;
  clearPendingOpenDiff: () => void;
  pendingOpenMergeEditor: OpenMergeEditorEvent | null;
  clearPendingOpenMergeEditor: () => void;
  pendingMenuAction: MenuActionEvent | null;
  clearPendingMenuAction: () => void;
  mergeState: MergeState | null;
  commitDetail: CommitDetail | null;
  currentBranch: string;
  branches: { name: string; isCurrent: boolean }[];

  setViewMode: (v: ViewMode) => void;
  setToasts: React.Dispatch<React.SetStateAction<SgToastData[]>>;
  setConflictFile: (f: string | null) => void;
  setMergeEditorFile: (f: string | null) => void;
  setRightPanel: (p: 'diff' | 'history' | 'blame') => void;
  openDiff: (file: string, hash: string) => void;
  showPrompt: ShowPrompt;
  handleOpenMergeDialog: (source: string) => void;
  loc: any;
  viewMode: ViewMode;
}

export function useAppEffects(p: UseAppEffectsParams) {
  useEffect(() => {
    if (!p.error) return;
    const id = Date.now().toString();
    p.setToasts(prev => {
      if (prev.some(t => t.message === p.error)) return prev;
      return [...prev, { id, message: p.error!, type: 'error' as const }];
    });
    p.clearError();
  }, [p.error, p.clearError]);

  useEffect(() => {
    if (p.viewOverride) {
      p.setViewMode(p.viewOverride);
      p.clearViewOverride();
    }
  }, [p.viewOverride, p.clearViewOverride]);

  useEffect(() => {
    if (p.pendingOpenDiff) {
      p.openDiff(p.pendingOpenDiff.file, p.pendingOpenDiff.hash);
      p.setRightPanel('diff');
      p.clearPendingOpenDiff();
    }
  }, [p.pendingOpenDiff, p.openDiff, p.clearPendingOpenDiff]);

  useEffect(() => {
    if (p.pendingOpenMergeEditor) {
      p.setConflictFile(p.pendingOpenMergeEditor.file);
      p.setMergeEditorFile(null);
      p.setViewMode('changes');
      p.clearPendingOpenMergeEditor();
    }
  }, [p.pendingOpenMergeEditor, p.clearPendingOpenMergeEditor]);

  const prevMergeRef = useRef(false);
  useEffect(() => {
    if (p.mergeState?.inProgress && !prevMergeRef.current) {
      const hasConflicts = p.mergeState.conflictFiles.some(f => f.status === 'conflicted');
      if (hasConflicts) p.setViewMode('changes');
    }
    prevMergeRef.current = !!p.mergeState?.inProgress;
  }, [p.mergeState]);

  useEffect(() => {
    if (p.pendingMenuAction) {
      const { action } = p.pendingMenuAction;
      p.clearPendingMenuAction();
      if (action === 'newBranch') {
        p.showPrompt({
          title: p.loc.menu.newBranch,
          placeholder: 'branch-name',
          onConfirm: (name: string) => postCommand({ type: 'createBranch', name, from: p.currentBranch }),
        });
      } else if (action === 'merge') {
        if (p.branches.length > 0) {
          p.handleOpenMergeDialog(p.branches.find(b => !b.isCurrent)?.name || '');
        }
      } else if (action === 'about') {
        p.setToasts(prev => [...prev, { id: Date.now().toString(), message: `SkyFork v0.1 — Git Client`, type: 'info' as const }]);
      }
    }
  }, [p.pendingMenuAction, p.clearPendingMenuAction, p.showPrompt, p.currentBranch, p.branches, p.handleOpenMergeDialog, p.loc]);

  const prevCommitHashRef = useRef<string | null>(null);
  useEffect(() => {
    const newHash = p.commitDetail?.hash ?? null;
    if (newHash && newHash !== prevCommitHashRef.current) {
      prevCommitHashRef.current = newHash;
      if (p.viewMode === 'commits' && p.commitDetail!.files.length > 0) {
        p.openDiff(p.commitDetail!.files[0].path, p.commitDetail!.hash);
      }
    }
  }, [p.commitDetail, p.viewMode, p.openDiff]);
}
