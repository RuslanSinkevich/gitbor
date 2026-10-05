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

  // Лёгкий признак «репо использует LFS» — для контекстного показа пункта
  // меню. Читаем только `.gitattributes` (без git lfs subprocess), ищем
  // `filter=lfs`. Дёшево, без сканирования дерева как `lfs ls-files`.
  getLfsActive: async (_cmd, ctx) => {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    try {
      const content = await readFile(join(ctx.ch.getRepoPath(), '.gitattributes'), 'utf-8');
      ctx.send({ type: 'lfsActive', active: /filter=lfs/.test(content) });
    } catch {
      ctx.send({ type: 'lfsActive', active: false });
    }
  },

  getConventionalCommits: async (_cmd, ctx) => {
    const { detectConventionalCommits } = await import('../../git/CommitMessageRules');
    const active = await detectConventionalCommits(ctx.ch.getRepoPath());
    ctx.send({ type: 'conventionalCommits', active });
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
      // `exists: true` даже для пустого файла. Баннер появляется только
      // когда файла НЕТ; пустой `.gitignore` — это осознанный выбор юзера.
      ctx.send({ type: 'gitignoreContent', data: content, exists: true });
    } catch {
      ctx.send({ type: 'gitignoreContent', data: '', exists: false });
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

  compareBranches: async (cmd, ctx) => {
    const r = await ctx.ch.compareBranches(cmd.base, cmd.branch);
    if (!r) return;
    const { fromHash, toHash, files, ahead, behind } = r;
    ctx.send({
      type: 'commitDiff',
      data: { fromHash, toHash, files, branchCompare: { base: cmd.base, branch: cmd.branch, ahead, behind } },
    });
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
  pickDirectory: async (cmd, ctx) => {
    /* Возвращает путь (string | null) через invoke — НЕ через `send`.
       Соответственно renderer ждёт результат от invokeCommand, а не
       подписывается на отдельный event. См. api.ts/NON_RETRYABLE_TYPES. */
    return await ctx.ch.pickDirectory({ title: cmd.title, defaultPath: cmd.defaultPath });
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
      // Открываем НОВОЕ окно терминала через `cmd /c start`. Без `start`
      // cmd.exe запускается невидимо (у Electron-GUI нет консоли), и юзер
      // видит «ничего не произошло».
      //
      // Безопасность: repoPath НЕ попадает в строку команды (там был бы
      // shell-injection через `&`/`"` в имени папки) — он идёт только как
      // cwd процесса, поэтому новый терминал стартует в нужной директории,
      // а cmd-парсер repoPath никогда не видит. Пустые кавычки "" — это
      // обязательный пустой title для команды `start`.
      const proc = spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe'], {
        cwd: repoPath, windowsHide: false, detached: true, stdio: 'ignore',
      });
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

  getCredentialInfo: async (_cmd, ctx) => {
    const { CredentialHelper } = await import('../../git/CredentialHelper');
    const helper = new CredentialHelper(ctx.sm.getGit());
    try {
      const target = await helper.getCredentialTarget();
      const helperConfigured = await helper.hasCredentialHelper();
      ctx.send({ type: 'credentialInfo', data: { target, helperConfigured } });
    } catch {
      ctx.send({ type: 'credentialInfo', data: { target: null, helperConfigured: false } });
    }
  },
  updateCredentials: async (cmd, ctx) => {
    const { CredentialHelper } = await import('../../git/CredentialHelper');
    const helper = new CredentialHelper(ctx.sm.getGit());
    try {
      const target = await helper.getCredentialTarget();
      if (!target) {
        ctx.send({ type: 'credentialUpdated', success: false, error: 'No HTTPS remote' });
        return;
      }
      await helper.storeCredentials(target, cmd.username, cmd.password);
      ctx.send({ type: 'credentialUpdated', success: true });
    } catch (err) {
      ctx.send({ type: 'credentialUpdated', success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
  clearCredentials: async (_cmd, ctx) => {
    const { CredentialHelper } = await import('../../git/CredentialHelper');
    const helper = new CredentialHelper(ctx.sm.getGit());
    try {
      const target = await helper.getCredentialTarget();
      if (!target) {
        ctx.send({ type: 'credentialUpdated', success: false, error: 'No HTTPS remote' });
        return;
      }
      await helper.clearCredentials(target);
      ctx.send({ type: 'credentialUpdated', success: true, cleared: true });
    } catch (err) {
      ctx.send({ type: 'credentialUpdated', success: false, error: err instanceof Error ? err.message : String(err) });
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
