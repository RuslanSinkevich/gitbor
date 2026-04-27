import { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import { AiGenerateButton, localizeAiError } from '../ai';
import s from './CommitBar.module.css';

const DESC_MIN_PX = 29;
const DESC_MAX_PX = 260;

interface Props {
  stagedCount: number;
  isOperationRunning: boolean;
  onOpenAiSettings: () => void;
}

export function CommitBar({ stagedCount, isOperationRunning, onOpenAiSettings }: Props) {
  const loc = t();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [amend, setAmend] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const canCommit = (subject.trim().length > 0 || amend) && stagedCount > 0 && !isOperationRunning;

  // Авто-рост description: высота по scrollHeight, с ограничением сверху.
  // Делаем в layout-фазе, чтобы не было визуального «прыжка» при вставке
  // длинного AI-текста.
  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.max(DESC_MIN_PX, Math.min(DESC_MAX_PX, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [description]);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const onResize = () => {
      el.style.height = 'auto';
      const next = Math.max(DESC_MIN_PX, Math.min(DESC_MAX_PX, el.scrollHeight));
      el.style.height = `${next}px`;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function doCommit() {
    if (!canCommit) return;
    const subj = subject.trim();
    const desc = description.trim();
    const msg = desc ? `${subj}\n\n${desc}` : subj;
    postCommand({ type: 'commit', message: msg, amend: amend || undefined });
    setSubject('');
    setDescription('');
    setAmend(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doCommit();
    }
  }

  function onSubjectKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      descRef.current?.focus();
      return;
    }
    onKeyDown(e);
  }

  // AI streaming: первая строка → subject, остальное → description.
  const applyAiText = useCallback((text: string) => {
    setAiError(null);
    const [firstLine, ...rest] = text.split('\n');
    setSubject(firstLine ?? '');
    const body = rest.join('\n').replace(/^\n+/, '');
    setDescription(body);
  }, []);

  const handleAiError = useCallback((message: string, kind: string) => {
    setAiError(localizeAiError(kind, message).full);
  }, []);

  return (
    <div className={s.root}>
      {aiError && (
        <div className={s.errorBanner} onClick={() => setAiError(null)}>
          {aiError}
        </div>
      )}
      <div className={s.fields}>
        <input
          className={s.subject}
          type="text"
          placeholder={loc.changes.commitSubject}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={onSubjectKeyDown}
        />
        <textarea
          ref={descRef}
          className={s.description}
          placeholder={loc.changes.commitDescription}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
      </div>
      <div className={s.actions}>
        <div className={s.leftActions}>
          <label className={s.amend}>
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            <span>{loc.changes.amend}</span>
          </label>
          <AiGenerateButton
            stagedCount={stagedCount}
            disabled={isOperationRunning}
            onChunk={applyAiText}
            onDone={applyAiText}
            onError={handleAiError}
            onOpenSettings={onOpenAiSettings}
          />
        </div>
        <button className={s.button} disabled={!canCommit} onClick={doCommit}>
          {loc.changes.commit}
          {stagedCount > 0 && <span className={s.count}>({stagedCount})</span>}
        </button>
      </div>
    </div>
  );
}
