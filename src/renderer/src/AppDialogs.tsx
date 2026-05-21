import { lazy, Suspense } from 'react';
import { SgContextMenu } from './ui/SgContextMenu';
import { SgToastContainer } from './ui/SgToast';
import { SgPromptDialog } from './ui/SgPromptDialog';
import type { MergeState } from './types';
import type { useDialogs } from './hooks/useDialogs';
import type { useContextMenu } from './hooks/useContextMenu';
import type { usePromptDialog } from './ui/SgPromptDialog';
import type { useToasts } from './hooks/useToasts';
import type { UseSafetyDialog } from './hooks/useSafetyDialog';
import s from './App.module.css';

// Тяжёлые модалки/редакторы — отложенная загрузка. Пока пользователь не
// откроет соответствующий диалог, бандлер не тянет код, его deps и стили.
// SgContextMenu/SgToastContainer/SgPromptDialog оставлены eagerly: первый
// показывается на любом ПКМ, второй — на каждый toast (включая авто), третий
// — на любой prompt; задержка лоадера у них была бы заметна.
const MergeDialog = lazy(() => import('./features/merge').then(m => ({ default: m.MergeDialog })));
const MergeEditor = lazy(() => import('./features/merge').then(m => ({ default: m.MergeEditor })));
const RebaseEditor = lazy(() => import('./features/rebase').then(m => ({ default: m.RebaseEditor })));
const AboutDialog = lazy(() => import('./ui/AboutDialog').then(m => ({ default: m.AboutDialog })));
const SshKeysDialog = lazy(() => import('./features/ssh').then(m => ({ default: m.SshKeysDialog })));
const RepoSettingsDialog = lazy(() => import('./features/settings').then(m => ({ default: m.RepoSettingsDialog })));
const ReflogDialog = lazy(() => import('./features/reflog').then(m => ({ default: m.ReflogDialog })));
const BisectDialog = lazy(() => import('./features/bisect').then(m => ({ default: m.BisectDialog })));
const HooksDialog = lazy(() => import('./features/hooks').then(m => ({ default: m.HooksDialog })));
const WorktreesDialog = lazy(() => import('./features/worktrees').then(m => ({ default: m.WorktreesDialog })));
const LfsDialog = lazy(() => import('./features/lfs').then(m => ({ default: m.LfsDialog })));
const GitignoreDialog = lazy(() => import('./features/gitignore').then(m => ({ default: m.GitignoreDialog })));
const StatisticsDialog = lazy(() => import('./features/statistics').then(m => ({ default: m.StatisticsDialog })));
const GitActivityDialog = lazy(() => import('./features/git-activity').then(m => ({ default: m.GitActivityDialog })));
const AiSettingsDialog = lazy(() => import('./features/ai').then(m => ({ default: m.AiSettingsDialog })));
const SafetyDialog = lazy(() => import('./features/safety').then(m => ({ default: m.SafetyDialog })));

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
  /** Путь активного репо — используется журналом git-активности. */
  repoPath?: string | null;
  /** Safety-диалог: current/onAction/close. */
  safety?: UseSafetyDialog;
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
    repoPath,
    safety,
  } = props;

  return (
    <>
      {contextMenu && (
        <SgContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />
      )}

      <Suspense fallback={null}>
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
        {dlg.showGitActivity && <GitActivityDialog onClose={() => dlg.setShowGitActivity(false)} repoPath={repoPath} />}
        {dlg.showAiSettings && <AiSettingsDialog onClose={() => dlg.setShowAiSettings(false)} />}

        {safety?.current && (
          <SafetyDialog
            payload={safety.current}
            onAction={safety.onAction}
            onClose={safety.close}
          />
        )}
      </Suspense>

      <SgPromptDialog prompt={prompt} onClose={closePrompt} />
      <SgToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
