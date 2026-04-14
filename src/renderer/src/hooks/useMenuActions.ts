import { useCallback } from 'react';
import { postCommand } from '../api';
import { t } from '../i18n';
import type { AppState } from '../types';

interface Deps {
  state: AppState;
  setViewMode: (v: 'changes' | 'commits') => void;
  setShowAbout: (v: boolean) => void;
  setShowSshKeys: (v: boolean) => void;
  setShowRepoSettings: (v: boolean) => void;
  showPrompt: (opts: { title: string; placeholder: string; onConfirm: (v: string) => void }) => void;
  handleOpenMergeDialog: (source: string) => void;
}

export function useMenuActions({
  state, setViewMode, setShowAbout, setShowSshKeys, setShowRepoSettings, showPrompt,
  handleOpenMergeDialog,
}: Deps) {
  return useCallback((action: string) => {
    const loc = t();
    switch (action) {
      case 'fetch': postCommand({ type: 'fetch' }); break;
      case 'pull': postCommand({ type: 'pull' }); break;
      case 'push': postCommand({ type: 'push' }); break;
      case 'stash': postCommand({ type: 'stash' }); break;
      case 'stashPop': postCommand({ type: 'stashPop' }); break;
      case 'refresh': postCommand({ type: 'refreshAll' }); break;
      case 'viewChanges': setViewMode('changes'); break;
      case 'viewCommits': setViewMode('commits'); break;
      case 'newBranch':
        showPrompt({
          title: loc.menu.newBranch,
          placeholder: 'branch-name',
          onConfirm: (name) => postCommand({ type: 'createBranch', name, from: state.currentBranch }),
        });
        break;
      case 'merge':
        if (state.branches.length > 0) {
          handleOpenMergeDialog(state.branches.find(b => !b.isCurrent)?.name || '');
        }
        break;
      case 'about': setShowAbout(true); break;
      case 'sshKeys': setShowSshKeys(true); break;
      case 'repoSettings': setShowRepoSettings(true); break;
      case 'closeRepo':
        if (state.openRepos.length > 0) {
          postCommand({ type: 'closeRepo', index: state.activeRepoIndex });
        }
        break;
      case 'openInExplorer':
        if (state.repoPath) postCommand({ type: 'openInExplorer' });
        break;
      case 'openInTerminal':
        if (state.repoPath) postCommand({ type: 'openInTerminal' });
        break;
    }
  }, [state.currentBranch, state.branches, state.openRepos, state.activeRepoIndex, state.repoPath, setViewMode, setShowAbout, setShowSshKeys, setShowRepoSettings, showPrompt, handleOpenMergeDialog]);
}
