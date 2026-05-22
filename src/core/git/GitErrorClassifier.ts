import { classToSeverity } from '../errors/severity';
import type { ClassifiedError, GitErrorClass } from './types';

/**
 * Стateless классификатор stderr git-команд по `GitErrorClass`.
 *
 * Принцип: первый матч выигрывает; порядок паттернов важен (специфичные
 * сверху, общие снизу). Локализованный stderr (LANG=ru_RU и т.п.)
 * мы НЕ покрываем — fallback на 'unknown'. В проекте git везде запускается
 * с дефолтным english messages (наследник от системного env), русские
 * сообщения встречаются только если юзер сам выставил LANG в шелле.
 */

interface Pattern {
  class: GitErrorClass;
  re: RegExp;
  hint?: string;
  recoverable: boolean;
}

const PATTERNS: Pattern[] = [
  {
    class: 'lock_held',
    re: /Unable to create '.+index\.lock': File exists/i,
    hint: 'Another git process is holding the index.lock.',
    recoverable: true,
  },
  {
    class: 'lock_held',
    re: /Another git process seems to be running in this repository/i,
    hint: 'Another git process is currently running in this repository.',
    recoverable: true,
  },
  {
    class: 'conflict',
    re: /CONFLICT \(/i,
    hint: 'Merge conflicts detected. Resolve them in the editor.',
    recoverable: true,
  },
  {
    class: 'conflict',
    re: /Automatic merge failed/i,
    hint: 'Automatic merge failed; manual resolution required.',
    recoverable: true,
  },
  {
    class: 'conflict',
    re: /after resolving the conflicts/i,
    hint: 'There are unresolved conflicts.',
    recoverable: true,
  },
  {
    class: 'untracked_overwrite',
    re: /(?:The following )?untracked working tree files would be (?:overwritten|clobbered)/i,
    hint: 'Untracked files would be overwritten. Move or remove them first.',
    recoverable: true,
  },
  {
    class: 'dirty_tree',
    re: /Your local changes to the following files would be overwritten/i,
    hint: 'Stash or commit your local changes first.',
    recoverable: true,
  },
  {
    class: 'dirty_tree',
    re: /would be overwritten by (?:merge|checkout|rebase|cherry-pick|revert)/i,
    hint: 'Local changes would be overwritten by the operation.',
    recoverable: true,
  },
  {
    class: 'dirty_tree',
    re: /Please commit your changes or stash them before you/i,
    hint: 'Local changes would be overwritten by the operation.',
    recoverable: true,
  },
  {
    class: 'dirty_tree',
    re: /(?:would be )?clobbered by/i,
    hint: 'Local changes would be clobbered by the operation.',
    recoverable: true,
  },
  {
    class: 'merge_in_progress',
    re: /You have not concluded your merge/i,
    hint: 'A merge is already in progress; complete or abort it first.',
    recoverable: true,
  },
  {
    class: 'merge_in_progress',
    re: /MERGE_HEAD exists/i,
    hint: 'A merge is already in progress.',
    recoverable: true,
  },
  {
    class: 'rebase_in_progress',
    re: /rebase in progress/i,
    hint: 'A rebase is in progress; continue or abort it first.',
    recoverable: true,
  },
  {
    class: 'rebase_in_progress',
    re: /It seems that there is already a (?:rebase-apply|rebase-merge) directory/i,
    hint: 'A previous rebase did not finish; continue or abort it first.',
    recoverable: true,
  },
  {
    class: 'cherry_pick_in_progress',
    re: /CHERRY_PICK_HEAD exists|cherry-pick(?:\s+is)? in progress/i,
    hint: 'A cherry-pick is in progress; continue or abort it first.',
    recoverable: true,
  },
  {
    class: 'revert_in_progress',
    re: /REVERT_HEAD exists|revert(?:\s+is)? in progress/i,
    hint: 'A revert is in progress; continue or abort it first.',
    recoverable: true,
  },
  {
    class: 'unmerged_paths',
    re: /(?:You have unmerged (?:files|paths)|unmerged files|needs merge)/i,
    hint: 'There are unmerged paths in the index; resolve them first.',
    recoverable: true,
  },
  {
    class: 'disk_full',
    re: /no space left on device|disk quota exceeded|cannot write.*disk/i,
    hint: 'Disk is full. Free space before continuing.',
    recoverable: false,
  },
  {
    class: 'repo_corrupt',
    re: /bad object|object file .* is empty|loose object .* is corrupt|repository corrupt/i,
    hint: 'The repository may be corrupt. Run git fsck.',
    recoverable: false,
  },
  {
    class: 'hook_failed',
    re: /hook (?:declined|failed)|pre-commit hook failed|pre-push hook failed|commit-msg hook failed/i,
    hint: 'A git hook rejected the operation. See hook output below.',
    recoverable: true,
  },
  {
    class: 'gpg_failed',
    re: /gpg failed to sign|secret key not available|gpg: signing failed/i,
    hint: 'GPG signing failed. Check your signing key.',
    recoverable: true,
  },
  {
    class: 'branch_unmerged',
    re: /branch .+ is not fully merged/i,
    hint: 'The branch is not fully merged. Use force delete if intended.',
    recoverable: true,
  },
  {
    class: 'tag_not_found',
    re: /tag .+ not found/i,
    hint: 'Tag does not exist.',
    recoverable: false,
  },
  {
    class: 'branch_not_found',
    re: /branch .+ not found|not a valid object name/i,
    hint: 'Branch or ref does not exist.',
    recoverable: false,
  },
  {
    class: 'stash_empty',
    re: /No stash entries found|No stash found/i,
    hint: 'There is nothing in the stash list.',
    recoverable: false,
  },
  {
    class: 'proxy_tls',
    re: /SSL_ERROR|SSL connect error|certificate verify failed|self signed certificate/i,
    hint: 'TLS/SSL error — check proxy or corporate MITM settings.',
    recoverable: true,
  },
  {
    class: 'auth',
    re: /Authentication failed/i,
    hint: 'Authentication failed. Check your credentials or SSH key.',
    recoverable: true,
  },
  {
    class: 'auth',
    re: /Permission denied \(publickey\)/i,
    hint: 'SSH key was rejected by the remote.',
    recoverable: true,
  },
  {
    class: 'auth',
    re: /could not read Username/i,
    hint: 'Missing username for HTTPS git. Configure a credential helper.',
    recoverable: true,
  },
  {
    class: 'auth',
    re: /fatal: Authentication/i,
    hint: 'Authentication failed.',
    recoverable: true,
  },
  {
    class: 'network',
    re: /Could not resolve host/i,
    hint: 'DNS lookup failed. Check internet connection.',
    recoverable: true,
  },
  {
    class: 'network',
    re: /Connection (?:timed out|refused|reset)/i,
    hint: 'Connection to the remote failed.',
    recoverable: true,
  },
  {
    class: 'network',
    re: /fatal: unable to access/i,
    hint: 'Cannot reach the remote.',
    recoverable: true,
  },
  {
    class: 'network',
    re: /SSL_ERROR|SSL connect error/i,
    hint: 'TLS/SSL error talking to the remote.',
    recoverable: true,
  },
  {
    class: 'network',
    re: /Operation timed out/i,
    hint: 'Network operation timed out.',
    recoverable: true,
  },
  {
    class: 'non_fast_forward',
    re: /\(non-fast-forward\)/i,
    hint: 'Remote branch has diverged; pull or rebase before pushing.',
    recoverable: true,
  },
  {
    class: 'non_fast_forward',
    re: /Updates were rejected/i,
    hint: 'Remote rejected updates; pull or rebase first.',
    recoverable: true,
  },
  {
    class: 'non_fast_forward',
    re: /rejected\s+\S+\s+->\s+\S+\s+\(non-fast-forward\)/i,
    hint: 'Remote rejected updates as non-fast-forward.',
    recoverable: true,
  },
];

function buildClassified(p: Pattern, raw: string): ClassifiedError {
  const hookOutput = p.class === 'hook_failed' ? raw : undefined;
  return {
    class: p.class,
    recoverable: p.recoverable,
    hint: p.hint,
    rawStderr: raw,
    severity: classToSeverity(p.class),
    hookOutput,
  };
}

export class GitErrorClassifier {
  static classify(stderr: string): ClassifiedError {
    const raw = stderr ?? '';
    if (!raw.trim()) {
      return { class: 'unknown', recoverable: false, rawStderr: raw, severity: 'critical' };
    }

    for (const p of PATTERNS) {
      if (p.re.test(raw)) {
        return buildClassified(p, raw);
      }
    }

    return { class: 'unknown', recoverable: false, rawStderr: raw, severity: 'critical' };
  }
}

/** Удобный free-function wrapper (используется в SafetyNet/PreflightChecks). */
export function classifyGitError(stderr: string): ClassifiedError {
  return GitErrorClassifier.classify(stderr);
}
