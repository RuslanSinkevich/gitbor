import { useEffect, useState } from 'react';
import type { Branch } from '../../types';
import { t, tpl } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';

interface Props {
  open: boolean;
  branch: Branch | null;
  initialNote: string;
  onSave: (text: string) => void;
  onClose: () => void;
}

/**
 * Заметки по ветке (Fork-style branch description). Не путать с git
 * `config branch.<name>.description` — нам важно работать одинаково на
 * всех ветках и не трогать репо: данные хранятся в localStorage
 * (см. `branchPrefsPersist`).
 *
 * Содержимое модалки — одна textarea. По сохранению вызываем `onSave`
 * (родитель пушит в `useBranchPrefs.setNote`); пустой/whitespace-only
 * текст удаляет запись.
 *
 * Подгрузку коммита/upstream намеренно убрали: модалка отвечает только
 * за заметку юзера. Sha и last-commit видны в правой панели графа при
 * клике на ветку, дублировать не нужно.
 */
export function BranchInfoDialog({ open, branch, initialNote, onSave, onClose }: Props) {
  const loc = t();
  const [text, setText] = useState(initialNote);

  useEffect(() => {
    if (open) setText(initialNote);
  }, [open, initialNote, branch]);

  if (!branch) return null;

  const handleSave = () => {
    onSave(text);
    onClose();
  };

  const title = tpl(loc.sidebar.branchNoteTitle, { branch: branch.name });

  return (
    <SgDialog
      open={open}
      title={title}
      onClose={onClose}
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <button
            type="button"
            className="sg-button sg-button--ghost sg-button--sm"
            onClick={onClose}
          >
            {loc.dialog.cancel}
          </button>
          <button
            type="button"
            className="sg-button sg-button--primary sg-button--sm"
            onClick={handleSave}
          >
            {loc.sidebar.branchNoteSave}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: 'var(--sg-foreground-muted)', fontSize: 11, textTransform: 'uppercase' }}>
          {loc.sidebar.branchNote}
        </span>
        <textarea
          className="sg-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={loc.sidebar.branchNotePlaceholder}
          rows={8}
          autoFocus
          spellCheck={false}
          style={{ resize: 'vertical', minHeight: 140, fontFamily: 'var(--sg-font-mono)', fontSize: 12 }}
        />
        <span style={{ color: 'var(--sg-foreground-muted)', fontSize: 11 }}>
          {loc.sidebar.branchNoteHint}
        </span>
      </div>
    </SgDialog>
  );
}
