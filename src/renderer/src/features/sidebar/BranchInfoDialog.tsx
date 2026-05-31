import { lazy, Suspense, useEffect, useState } from 'react';
import type { Branch } from '../../types';
import { t, tpl } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';

const Markdown = lazy(() => import('../../ui/Markdown').then(m => ({ default: m.Markdown })));

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
 * Два режима:
 *   - view: красиво отрендеренный Markdown (с кликабельными ссылками),
 *     показывается когда заметка уже заполнена;
 *   - edit: textarea, активируется сразу если заметка пустая, либо по
 *     кнопке «Редактировать».
 *
 * Пустой/whitespace-only текст по сохранению удаляет запись.
 */
export function BranchInfoDialog({ open, branch, initialNote, onSave, onClose }: Props) {
  const loc = t();
  const [text, setText] = useState(initialNote);
  const [editing, setEditing] = useState(initialNote.trim().length === 0);

  useEffect(() => {
    if (open) {
      setText(initialNote);
      setEditing(initialNote.trim().length === 0);
    }
  }, [open, initialNote, branch]);

  if (!branch) return null;

  const handleSave = () => {
    onSave(text);
    onClose();
  };

  const title = tpl(loc.sidebar.branchNoteTitle, { branch: branch.name });
  const hasNote = text.trim().length > 0;

  const footer = editing ? (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
      <button type="button" className="sg-button sg-button--ghost sg-button--sm" onClick={onClose}>
        {loc.dialog.cancel}
      </button>
      <button type="button" className="sg-button sg-button--primary sg-button--sm" onClick={handleSave}>
        {loc.sidebar.branchNoteSave}
      </button>
    </div>
  ) : (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
      <button type="button" className="sg-button sg-button--ghost sg-button--sm" onClick={onClose}>
        {loc.dialog.close}
      </button>
      <button type="button" className="sg-button sg-button--primary sg-button--sm" onClick={() => setEditing(true)}>
        {loc.sidebar.branchNoteEdit}
      </button>
    </div>
  );

  return (
    <SgDialog open={open} title={title} onClose={onClose} size="md" footer={footer}>
      {editing ? (
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
          <span style={{ color: 'var(--sg-foreground-muted)', fontSize: 11 }}>{loc.sidebar.branchNoteHint}</span>
        </div>
      ) : (
        <div
          style={{ minHeight: 80, cursor: 'text' }}
          onDoubleClick={() => setEditing(true)}
          title={loc.sidebar.branchNoteEdit}
        >
          {hasNote ? (
            <Suspense fallback={null}>
              <Markdown text={text} />
            </Suspense>
          ) : (
            <span style={{ color: 'var(--sg-foreground-muted)', fontSize: 12 }}>
              {loc.sidebar.branchNoteEmpty}
            </span>
          )}
        </div>
      )}
    </SgDialog>
  );
}
