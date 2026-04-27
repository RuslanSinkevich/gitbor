import { MergeDialog, MergeEditor } from './features/merge';
import { RebaseEditor } from './features/rebase';
import { SgContextMenu } from './ui/SgContextMenu';
import { SgToastContainer } from './ui/SgToast';
import { SgPromptDialog } from './ui/SgPromptDialog';
import { AboutDialog } from './ui/AboutDialog';
import { SshKeysDialog } from './features/ssh';
import { RepoSettingsDialog } from './features/settings';
import { ReflogDialog } from './features/reflog';
import { BisectDialog } from './features/bisect';
import { HooksDialog } from './features/hooks';
import { WorktreesDialog } from './features/worktrees';
import { LfsDialog } from './features/lfs';
import { GitignoreDialog } from './features/gitignore';
import { StatisticsDialog } from './features/statistics';
import { GitActivityDialog } from './features/git-activity';
import { AiSettingsDialog } from './features/ai';
import type { MergeState } from './types';
import type { useDialogs } from './hooks/useDialogs';
import type { useContextMenu } from './hooks/useContextMenu';
import type { usePromptDialog } from './ui/SgPromptDialog';
import type { useToasts } from './hooks/useToasts';
import s from './App.module.css';

interface AppDialogsProps {
  contextMenu: ReturnType<typeof useContextMenu>['contextMenu'];
  closeContextMenu: () => void;
  rebaseOnto: string | null;
  setRebaseOnto: (v: string | null) => void;
  mergeEditorFile: string | null;
  setMergeEditorFile: (v: string | null) => void;
  mergeState: MergeState | null;
  handleConflictResolved: (path: string) => void;
  mergeDialogSource: string | null;
  setMergeDialogSource: (v: string | null) => void;
  currentBranch: string;
  prompt: ReturnType<typeof usePromptDialog>['prompt'];
  closePrompt: () => void;
  toasts: ReturnType<typeof useToasts>['toasts'];
  dismissToast: (id: string) => void;
  dlg: ReturnType<typeof useDialogs>;
  showPrompt: ReturnType<typeof usePromptDialog>['showPrompt'];
  loc: ReturnType<typeof import('./i18n').t>;
}

export function AppDialogs(props: AppDialogsProps) {
  const {
    contextMenu, closeContextMenu,
    rebaseOnto, setRebaseOnto,
    mergeEditorFile, setMergeEditorFile,
    mergeState, handleConflictResolved,
    mergeDialogSource, setMergeDialogSource, currentBranch,
    prompt, closePrompt,
    toasts, dismissToast,
    dlg, showPrompt, loc,
  } = props;

  return (
    <>
      {contextMenu && (
        <SgContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />
      )}

      {rebaseOnto && (
        <div className={s.overlay}>
          <div className={s.overlayContent}>
            <RebaseEditor onto={rebaseOnto} onClose={() => setRebaseOnto(null)} />
          </div>
        </div>
      )}

      {mergeEditorFile && (
        <MergeEditor
          file={mergeEditorFile}
          sourceBranch={mergeState?.sourceBranch || ''} targetBranch={mergeState?.targetBranch || ''}
          onResolved={() => { setMergeEditorFile(null); handleConflictResolved(mergeEditorFile); }}
          onCancel={() => setMergeEditorFile(null)}
        />
      )}

      {mergeDialogSource && (
        <MergeDialog source={mergeDialogSource} target={currentBranch} onClose={() => setMergeDialogSource(null)} />
      )}

      <SgPromptDialog prompt={prompt} onClose={closePrompt} />
      <SgToastContainer toasts={toasts} onDismiss={dismissToast} />
      {dlg.showAbout && <AboutDialog onClose={() => dlg.setShowAbout(false)} loc={loc} />}
      {dlg.showSshKeys && <SshKeysDialog onClose={() => dlg.setShowSshKeys(false)} />}
      {dlg.showRepoSettings && <RepoSettingsDialog onClose={() => dlg.setShowRepoSettings(false)} />}
      {dlg.showReflog && <ReflogDialog onClose={() => dlg.setShowReflog(false)} showPrompt={showPrompt} />}
      {dlg.showBisect && <BisectDialog onClose={() => dlg.setShowBisect(false)} />}
      {dlg.showHooks && <HooksDialog onClose={() => dlg.setShowHooks(false)} />}
      {dlg.showWorktrees && <WorktreesDialog onClose={() => dlg.setShowWorktrees(false)} showPrompt={showPrompt} />}
      {dlg.showLfs && <LfsDialog onClose={() => dlg.setShowLfs(false)} />}
      {dlg.showGitignore && <GitignoreDialog onClose={() => dlg.setShowGitignore(false)} />}
      {dlg.showRepoStats && <StatisticsDialog onClose={() => dlg.setShowRepoStats(false)} />}
      {dlg.showGitActivity && <GitActivityDialog onClose={() => dlg.setShowGitActivity(false)} />}
      {dlg.showAiSettings && <AiSettingsDialog onClose={() => dlg.setShowAiSettings(false)} />}
    </>
  );
}
