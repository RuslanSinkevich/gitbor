import { spawnSync } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const err = new Error(`${command} ${args.join(' ')} failed`);
    err.exitCode = result.status ?? 1;
    throw err;
  }
}

let exitCode = 0;

try {
  run(npmCmd, ['run', 'dist:win']);
  run(npmCmd, ['run', 'dist:win:no-ai']);
} catch (err) {
  exitCode =
    err && typeof err === 'object' && typeof err.exitCode === 'number'
      ? err.exitCode
      : 1;
  console.error(err instanceof Error ? err.message : err);
} finally {
  run(process.execPath, ['scripts/write-build-flags.mjs'], { GITBOR_AI: '1' });
}

process.exit(exitCode);
