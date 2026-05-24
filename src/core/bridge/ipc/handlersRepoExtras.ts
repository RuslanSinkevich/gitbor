import { shell } from 'electron';
import type { HandlerTable } from './types';
import { gitActivityStore } from '../../activity/GitActivityStore';
import { runTracked, op } from './helpers';

/** LFS, worktrees, hooks, статистика, bisect, вкладки репо, оболочка ОС, SSH, настройки. */
export const ipcHandlersRepoExtras: HandlerTable = {
  getLfsStatus: async (_cmd, ctx) => {
    const data = await ctx.ch.getLfsStatus();
    ctx.send({ type: 'lfsStatus', data });
  },
  lfsTrack: async (cmd, ctx) => {
    await ctx.ch.lfsTrack(cmd.pattern);
    const data = await ctx.ch.getLfsStatus();
    ctx.send({ type: 'lfsStatus', data });
  },
  lfsUntrack: async (cmd, ctx) => {
    await ctx.ch.lfsUntrack(cmd.pattern);
    const data = await ctx.ch.getLfsStatus();
    ctx.send({ type: 'lfsStatus', data });
  },

  getWorktrees: async (_cmd, ctx) => {
    const data = await ctx.ch.getWorktrees();
    ctx.send({ type: 'worktrees', data });
  },
  addWorktree: async (cmd, ctx) => {
    await ctx.ch.addWorktree(cmd.path, cmd.branch, cmd.createBranch);
    const data = await ctx.ch.getWorktrees();
    ctx.send({ type: 'worktrees', data });
  },
  removeWorktree: async (cmd, ctx) => {
    try {
      await ctx.ch.removeWorktree(cmd.path, cmd.force);
      const data = await ctx.ch.getWorktrees();
      ctx.send({ type: 'worktrees', data });
    } catch (e: unknown) {
      ctx.send({ type: 'error', message: e instanceof Error ? e.message : 'Remove worktree failed' });
    }
  },

  getHooks: async (_cmd, ctx) => {
    const data = await ctx.ch.getHooks();
    ctx.send({ type: 'hooks', data });
  },
  toggleHook: async (cmd, ctx) => {
    await ctx.ch.toggleHook(cmd.name, cmd.enable);
    const data = await ctx.ch.getHooks();
    ctx.send({ type: 'hooks', data });
  },

  getGitignore: async (_cmd, ctx) => {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const gitignorePath = join(ctx.ch.getRepoPath(), '.gitignore');
    try {
      const content = await readFile(gitignorePath, 'utf-8');
      ctx.send({ type: 'gitignoreContent', data: content });
    } catch {
      ctx.send({ type: 'gitignoreContent', data: '' });
    }
  },

  writeGitignore: async (cmd, ctx) => {
    const { writeFile } = await import('fs/promises');
    const { join } = await import('path');
    const gitignorePath = join(ctx.ch.getRepoPath(), '.gitignore');
    await writeFile(gitignorePath, cmd.content, 'utf-8');
    ctx.send({ type: 'operationEnd', operation: 'writeGitignore', success: true });
  },

  getCommitDiff: async (cmd, ctx) => {
    const files = await ctx.ch.getCommitDiff(cmd.fromHash, cmd.toHash);
    ctx.send({ type: 'commitDiff', data: { fromHash: cmd.fromHash, toHash: cmd.toHash, files } });
  },

  getRepoStats: async (_cmd, ctx) => {
    const data = await ctx.ch.getRepoStats();
    ctx.send({ type: 'repoStats', data });
  },

  getDayCommits: async (cmd, ctx) => {
    const data = await ctx.ch.getDayCommits(cmd.author, cmd.date);
    ctx.send({ type: 'dayCommits', data });
  },

  getAuthorCodeStats: async (cmd, ctx) => {
    const data = await ctx.ch.getAuthorCodeStats(cmd.authorName, cmd.authorEmail, cmd.cacheOnly, cmd.force);
    ctx.send({ type: 'authorCodeStats', data });
  },

  getReflog: async (cmd, ctx) => {
    const data = await ctx.ch.getReflog(cmd.maxCount);
    ctx.send({ type: 'reflog', data });
  },
  restoreReflog: op('restoreReflog', (cmd, ctx) => ctx.ch.restoreReflog(cmd.hash)),

  bisectStart: async (cmd, ctx) => {
    const output = await ctx.ch.bisectStart(cmd.bad, cmd.good);
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectGood: async (_cmd, ctx) => {
    const output = await ctx.ch.bisectGood();
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectBad: async (_cmd, ctx) => {
    const output = await ctx.ch.bisectBad();
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectSkip: async (_cmd, ctx) => {
    const output = await ctx.ch.bisectSkip();
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectReset: async (_cmd, ctx) => {
    await ctx.ch.bisectReset();
    ctx.send({
      type: 'bisectStatus',
      data: { active: false, current: '', stepsLeft: 0, goodCount: 0, badCount: 0, log: [] },
    });
  },
  getBisectStatus: async (_cmd, ctx) => {
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },

  getRepoSummary: async (cmd, _ctx) => {
    const { computeRepoSummary } = await import('../../repoSummary/computeRepoSummary');
    return await computeRepoSummary(cmd.path);
  },

  openRepo: async (cmd, ctx) => {
    await ctx.ch.openRepo(cmd.path);
  },
  openRepoDialog: async (_cmd, ctx) => {
    await ctx.ch.openRepoDialog();
  },
  closeRepo: async (cmd, ctx) => {
    await ctx.ch.closeRepo(cmd.index);
  },
  switchRepo: async (cmd, ctx) => {
    await ctx.ch.switchRepo(cmd.index);
  },

  getSubmodules: async (_cmd, ctx) => {
    const subs = await ctx.ch.getSubmodules();
    ctx.send({ type: 'submodules', data: subs });
  },

  getRebaseTodo: async (cmd, ctx) => {
    const todo = await ctx.ch.getRebaseTodo(cmd.onto);
    ctx.send({ type: 'rebaseTodo', data: todo });
  },
  executeRebase: async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation: 'rebase' });
    const result = await runTracked('rebase', ctx, () => ctx.ch.executeRebase(cmd.onto, cmd.entries));
    ctx.send({ type: 'operationEnd', operation: 'rebase', success: result.success, error: result.error });
    const progress = await ctx.ch.getRebaseProgress();
    ctx.send({ type: 'rebaseProgress', data: progress });
  },

  getGitActivity: async (_cmd, ctx) => {
    ctx.send({ type: 'gitActivitySnapshot', data: gitActivityStore.getSnapshot() });
  },
  clearGitActivity: async (_cmd, ctx) => {
    gitActivityStore.clear();
    ctx.send({ type: 'gitActivitySnapshot', data: [] });
  },

  openDiff: async (cmd, ctx) => {
    const payload = ctx.ch.getDiffPayload(cmd.file, cmd.hash);
    ctx.send({ type: 'openDiff', ...payload });
  },
  openMergeEditor: async (cmd, ctx) => {
    const payload = ctx.ch.getFilePayload(cmd.file);
    ctx.send({ type: 'openMergeEditor', ...payload });
  },
  openFile: async (cmd, ctx) => {
    const { safePath } = await import('../../utils/pathSecurity');
    const repoPath = ctx.sm.getState().repoPath;
    if (repoPath) {
      const fullPath = safePath(repoPath, cmd.file);
      shell.openPath(fullPath);
    }
  },
  switchView: async (cmd, ctx) => {
    ctx.send({ type: 'showView', view: cmd.view });
  },

  openInExplorer: async (_cmd, ctx) => {
    const repoPath = ctx.sm.getState().repoPath;
    if (repoPath) shell.openPath(repoPath);
  },
  openInTerminal: async (_cmd, ctx) => {
    const repoPath = ctx.sm.getState().repoPath;
    if (!repoPath) return;
    const { spawn } = await import('child_process');
    if (process.platform === 'win32') {
      // ВАЖНО: НЕ передаём repoPath в строку команды (`cd /d "${repoPath}"`)
      // — там был shell-injection через `&`/`"` в имени папки. Вместо этого
      // запускаем cmd.exe с cwd=repoPath, чтобы новый терминал открылся уже
      // в нужной директории, и repoPath никогда не парсится cmd-парсером.
      const proc = spawn('cmd.exe', [], { cwd: repoPath, windowsHide: false, detached: true, stdio: 'ignore' });
      proc.unref();
    } else if (process.platform === 'darwin') {
      // open -a Terminal <path> — `path` идёт отдельным аргументом
      // (массив args, не shell), shell-injection невозможен.
      const proc = spawn('open', ['-a', 'Terminal', repoPath], { detached: true, stdio: 'ignore' });
      proc.unref();
    } else {
      const terminals = [
        { cmd: 'x-terminal-emulator', args: ['--working-directory', repoPath] },
        { cmd: 'gnome-terminal', args: ['--working-directory', repoPath] },
        { cmd: 'konsole', args: ['--workdir', repoPath] },
        { cmd: 'xfce4-terminal', args: ['--working-directory', repoPath] },
        { cmd: 'xterm', args: ['-e', 'bash'] },
      ];
      const tryTerminal = (index: number) => {
        if (index >= terminals.length) return;
        const t = terminals[index];
        const proc = spawn(t.cmd, t.args, { cwd: repoPath, detached: true, stdio: 'ignore' });
        proc.on('error', () => tryTerminal(index + 1));
        proc.unref();
      };
      tryTerminal(0);
    }
  },

  getRepoSettings: async (_cmd, ctx) => {
    const { GitConfig } = await import('../../git/GitConfig');
    const config = new GitConfig(ctx.sm.getGit());
    const data = await config.getRepoSettings();
    ctx.send({ type: 'repoSettings', data });
  },
  setRepoSettings: async (cmd, ctx) => {
    const { GitConfig } = await import('../../git/GitConfig');
    const config = new GitConfig(ctx.sm.getGit());
    try {
      await config.setRepoSettings({ useGlobal: cmd.useGlobal, name: cmd.name, email: cmd.email });
      const data = await config.getRepoSettings();
      ctx.send({ type: 'repoSettings', data });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  listSshKeys: async (_cmd, ctx) => {
    const { listSshKeys } = await import('../../ssh/SshKeyManager');
    const keys = await listSshKeys();
    ctx.send({ type: 'sshKeys', data: keys });
  },
  generateSshKey: async (cmd, ctx) => {
    const { generateSshKey, listSshKeys } = await import('../../ssh/SshKeyManager');
    try {
      await generateSshKey({ name: cmd.name, type: cmd.keyType, passphrase: cmd.passphrase, comment: cmd.comment });
      const keys = await listSshKeys();
      ctx.send({ type: 'sshKeys', data: keys });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },
  deleteSshKey: async (cmd, ctx) => {
    const { deleteSshKey, listSshKeys } = await import('../../ssh/SshKeyManager');
    try {
      deleteSshKey(cmd.name);
      const keys = await listSshKeys();
      ctx.send({ type: 'sshKeys', data: keys });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },
  getPublicKey: async (cmd, ctx) => {
    const { readPublicKey } = await import('../../ssh/SshKeyManager');
    try {
      const content = readPublicKey(cmd.name);
      ctx.send({ type: 'publicKey', name: cmd.name, content });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },
};
