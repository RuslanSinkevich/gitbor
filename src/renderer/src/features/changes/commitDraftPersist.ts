import { buildStorageKey, loadStoredJson, saveStoredJson, removeStoredValue } from '../../shared/uiPersist';

const DRAFT_BASE_KEY = 'gitbor.commitDraft';
/** Ключ старых версий (до переименования). Читаем один раз и переносим. */
const LEGACY_DRAFT_BASE_KEY = 'skycode.commitDraft';

export interface CommitDraft {
  subject: string;
  description: string;
}

function draftKey(repoPath: string): string {
  return buildStorageKey(DRAFT_BASE_KEY, repoPath);
}

function legacyDraftKey(repoPath: string): string {
  return buildStorageKey(LEGACY_DRAFT_BASE_KEY, repoPath);
}

export function loadCommitDraft(repoPath: string): CommitDraft | null {
  if (!repoPath) return null;
  let stored = loadStoredJson<Partial<CommitDraft>>(draftKey(repoPath));
  if (!stored) {
    // Черновик из версии со старым ключом — переносим, чтобы не потерять текст.
    stored = loadStoredJson<Partial<CommitDraft>>(legacyDraftKey(repoPath));
    if (stored) {
      saveStoredJson(draftKey(repoPath), stored);
      removeStoredValue(legacyDraftKey(repoPath));
    }
  }
  if (!stored) return null;
  const subject = typeof stored.subject === 'string' ? stored.subject : '';
  const description = typeof stored.description === 'string' ? stored.description : '';
  if (!subject && !description) return null;
  return { subject, description };
}

export function saveCommitDraft(repoPath: string, draft: CommitDraft): void {
  if (!repoPath) return;
  // Пустой черновик не храним — удаляем запись, чтобы стор не разрастался.
  if (!draft.subject && !draft.description) {
    removeStoredValue(draftKey(repoPath));
    return;
  }
  saveStoredJson(draftKey(repoPath), draft);
}

export function clearCommitDraft(repoPath: string): void {
  if (!repoPath) return;
  removeStoredValue(draftKey(repoPath));
  removeStoredValue(legacyDraftKey(repoPath));
}
