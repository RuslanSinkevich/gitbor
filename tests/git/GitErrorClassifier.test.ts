import { describe, it, expect } from 'vitest';
import { GitErrorClassifier, classifyGitError } from '../../src/core/git/GitErrorClassifier';
import type { GitErrorClass } from '../../src/core/git/types';

interface Fixture {
  name: string;
  stderr: string;
  expected: GitErrorClass;
}

/**
 * Реальные фикстуры stderr git (en-локаль). Брались из:
 *  - живого git 2.45 на Windows / Linux;
 *  - issue-репортов в репозитории;
 *  - симуляции на тестовых репо.
 */
const FIXTURES: Fixture[] = [
  // lock_held
  {
    name: 'index.lock from parallel git process',
    stderr: "error: Unable to create 'C:/Users/Admin/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository, e.g.\nan editor opened by 'git commit'.\nfatal: Unable to write index.\n",
    expected: 'lock_held',
  },
  {
    name: 'just "another git process"',
    stderr: 'Another git process seems to be running in this repository, e.g. an editor opened by `git commit`',
    expected: 'lock_held',
  },

  // conflict
  {
    name: 'merge with single conflict',
    stderr: 'Auto-merging src/index.ts\nCONFLICT (content): Merge conflict in src/index.ts\nAutomatic merge failed; fix conflicts and then commit the result.\n',
    expected: 'lock_held' as GitErrorClass, // placeholder, will check below
  },
  {
    name: 'rebase conflict',
    stderr: 'CONFLICT (modify/delete): src/old.ts deleted in HEAD and modified in stage~1.\nAutomatic merge failed; fix conflicts and then commit the result.\n',
    expected: 'conflict',
  },
  {
    name: 'cherry-pick conflict',
    stderr: 'error: could not apply abc1234... feat: foo\nhint: after resolving the conflicts, mark the corrected paths\nhint: with \'git add <paths>\' or \'git rm <paths>\'\nhint: and commit the result with \'git commit\'\n',
    expected: 'conflict',
  },

  // dirty_tree
  {
    name: 'checkout would overwrite',
    stderr: 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/index.ts\nPlease commit your changes or stash them before you switch branches.\nAborting\n',
    expected: 'dirty_tree',
  },
  {
    name: 'merge would overwrite',
    stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\tsrc/file.ts\nPlease commit your changes or stash them before you merge.\n',
    expected: 'dirty_tree',
  },
  {
    name: 'pull would overwrite',
    stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\tREADME.md\n',
    expected: 'dirty_tree',
  },
  {
    name: 'clobbered by checkout',
    stderr: 'error: The following untracked working tree files would be clobbered by checkout:\n\tnewfile.ts\n',
    expected: 'untracked_overwrite',
  },

  // untracked_overwrite
  {
    name: 'untracked would be overwritten',
    stderr: 'error: The following untracked working tree files would be overwritten by merge:\n\tnewfile.ts\nPlease move or remove them before you merge.\nAborting\n',
    expected: 'untracked_overwrite',
  },

  // merge_in_progress
  {
    name: 'pull while merge in progress',
    stderr: 'error: You have not concluded your merge (MERGE_HEAD exists).\nhint: Please, commit your changes before you merge.\nfatal: Exiting because of unfinished merge.\n',
    expected: 'merge_in_progress',
  },

  // rebase_in_progress
  {
    name: 'rebase while another rebase running',
    stderr: 'fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.\n',
    expected: 'rebase_in_progress',
  },
  {
    name: 'plain rebase in progress',
    stderr: 'fatal: rebase in progress; on c0ffee\n',
    expected: 'rebase_in_progress',
  },

  // cherry_pick_in_progress
  {
    name: 'CHERRY_PICK_HEAD exists',
    stderr: 'error: cherry-pick is in progress; CHERRY_PICK_HEAD exists.\nhint: try "git cherry-pick (--continue | --skip | --abort | --quit)"\n',
    expected: 'cherry_pick_in_progress',
  },

  // revert_in_progress
  {
    name: 'REVERT_HEAD exists',
    stderr: 'error: revert is in progress; REVERT_HEAD exists.\nhint: try "git revert (--continue | --skip | --abort | --quit)"\n',
    expected: 'revert_in_progress',
  },

  // unmerged_paths
  {
    name: 'stash on unmerged paths',
    stderr: 'error: cannot stash when in middle of merge\nerror: You have unmerged paths.\n',
    expected: 'unmerged_paths',
  },
  {
    name: 'commit with needs merge',
    stderr: 'src/conflict.ts: needs merge\nerror: Committing is not possible because you have unmerged files.\nfatal: Exiting because of an unresolved conflict.\n',
    expected: 'unmerged_paths',
  },

  // auth
  {
    name: 'ssh key rejected',
    stderr: 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n',
    expected: 'auth',
  },
  {
    name: 'https authentication failed',
    stderr: "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/owner/repo.git/'\n",
    expected: 'auth',
  },
  {
    name: 'no credential helper',
    stderr: 'fatal: could not read Username for \'https://github.com\': No such device or address\n',
    expected: 'auth',
  },

  // network
  {
    name: 'dns lookup fail',
    stderr: 'fatal: unable to access \'https://gitlab.example.com/foo.git/\': Could not resolve host: gitlab.example.com\n',
    expected: 'network',
  },
  {
    name: 'connection timeout',
    stderr: 'ssh: connect to host github.com port 22: Connection timed out\nfatal: Could not read from remote repository.\n',
    expected: 'network',
  },
  {
    name: 'connection refused',
    stderr: 'fatal: unable to access \'http://localhost:3000/repo.git/\': Failed to connect to localhost port 3000: Connection refused\n',
    expected: 'network',
  },
  {
    name: 'ssl error',
    stderr: 'fatal: unable to access \'https://corp.example.com/repo.git/\': SSL_ERROR_SYSCALL\n',
    expected: 'network',
  },

  // non_fast_forward
  {
    name: 'push rejected non-fast-forward',
    stderr: "To github.com:owner/repo.git\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'github.com:owner/repo.git'\nhint: Updates were rejected because the tip of your current branch is behind\n",
    expected: 'non_fast_forward',
  },

  // unknown
  {
    name: 'truly unknown error',
    stderr: 'error: something completely unexpected happened in git internals\n',
    expected: 'unknown',
  },
  {
    name: 'empty stderr',
    stderr: '',
    expected: 'unknown',
  },
  {
    name: 'whitespace only stderr',
    stderr: '   \n  \n',
    expected: 'unknown',
  },
];

describe('GitErrorClassifier.classify', () => {
  for (const fx of FIXTURES) {
    if (fx.name === 'merge with single conflict') {
      it(`recognizes "${fx.name}" → conflict`, () => {
        const result = GitErrorClassifier.classify(fx.stderr);
        expect(result.class).toBe('conflict');
      });
      continue;
    }
    it(`recognizes "${fx.name}" → ${fx.expected}`, () => {
      const result = GitErrorClassifier.classify(fx.stderr);
      expect(result.class).toBe(fx.expected);
      expect(result.rawStderr).toBe(fx.stderr);
    });
  }

  it('marks recoverable=true for transient classes', () => {
    const r = GitErrorClassifier.classify('Connection timed out');
    expect(r.recoverable).toBe(true);
  });

  it('marks recoverable=false for unknown', () => {
    const r = GitErrorClassifier.classify('total garbage stderr xyzzy');
    expect(r.recoverable).toBe(false);
  });

  it('hint is set for known classes', () => {
    const r = GitErrorClassifier.classify('Authentication failed for https://...');
    expect(r.hint).toBeTruthy();
  });

  it('exposed as classifyGitError helper', () => {
    const r = classifyGitError('CONFLICT (content)');
    expect(r.class).toBe('conflict');
  });
});
