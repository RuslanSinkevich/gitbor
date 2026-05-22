import { useState, useCallback, useEffect } from 'react';
import { t } from '../../i18n';
import { postCommand, onMainEvent } from '../../api';
import { SgDialog } from '../../ui/SgDialog';
import { TEMPLATES } from './templates';
import s from './GitignoreDialog.module.css';

interface Props {
  onClose: () => void;
}

/** Dialog for creating/editing .gitignore with predefined templates. */
export function GitignoreDialog({ onClose }: Props) {
  const loc = t();
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [existingContent, setExistingContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'gitignoreContent') {
        setExistingContent(msg.data);
        setContent(msg.data);
        setLoading(false);
      }
    });
    postCommand({ type: 'getGitignore' });
    return unsub;
  }, []);

  const toggleTemplate = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      const tpl = TEMPLATES.find(t => t.name === name);
      if (!tpl) return prev;

      if (next.has(name)) {
        next.delete(name);
        const lines = content.split('\n');
        const tplLines = new Set(tpl.content.split('\n').map(l => l.trim()));
        setContent(lines.filter(l => !tplLines.has(l.trim())).join('\n'));
      } else {
        next.add(name);
        const existing = new Set(content.split('\n').map(l => l.trim()));
        const newLines = tpl.content.split('\n').filter(l => !existing.has(l.trim()));
        if (newLines.length) {
          setContent(prev => (prev.trim() ? prev.trim() + '\n\n# ' + name + '\n' : '# ' + name + '\n') + newLines.join('\n'));
        }
      }
      return next;
    });
  }, [content]);

  const handleSave = useCallback(() => {
    postCommand({ type: 'writeGitignore', content: content.trim() + '\n' });
    onClose();
  }, [content, onClose]);

  if (loading) return null;

  return (
    <SgDialog
      open
      title={loc.gitignore?.title ?? '.gitignore Editor'}
      onClose={onClose}
      size="lg"
      onConfirm={handleSave}
      confirmLabel={loc.gitignore.save}
      cancelLabel={loc.gitignore.cancel}
    >
      <div className={s.subtitle}>{loc.gitignore?.subtitle ?? 'Select templates or edit manually'}</div>

      <div className={s.templates}>
        {TEMPLATES.map(tpl => (
          <button
            key={tpl.name}
            className={`${s.templateBtn} ${selected.has(tpl.name) ? s.templateBtnActive : ''}`}
            onClick={() => toggleTemplate(tpl.name)}
          >
            {tpl.name}
          </button>
        ))}
      </div>

      {existingContent !== null && existingContent.trim() !== '' && (
        <div className={s.warning}>{loc.gitignore?.existsWarning ?? 'Existing .gitignore will be overwritten'}</div>
      )}

      <textarea
        className={s.editor}
        value={content}
        onChange={e => setContent(e.target.value)}
        spellCheck={false}
      />
    </SgDialog>
  );
}
