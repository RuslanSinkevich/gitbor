import { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import { AiGenerateButton, localizeAiError } from '../ai';
import type { MergeState } from '../../types';
import s from './CommitBar.module.css';

const DESC_MIN_PX = 29;
const DESC_MAX_PX = 260;
const AI_ERROR_AUTO_DISMISS_MS = 20_000;

interface Props {
  stagedCount: number;
  isOperationRunning: boolean;
  onOpenAiSettings: () => void;
  mergeState?: MergeState | null;
}

export function CommitBar({ stagedCount, isOperationRunning, onOpenAiSettings, mergeState }: Props) {
  const loc = t();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [amend, setAmend] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const prefilledRef = useRef(false);
  const prevRunningRef = useRef(false);

  // Спиннер на кнопке коммита держим, пока идёт операция, и снимаем, когда
  // isOperationRunning сменился с true на false (операция завершилась).
  useEffect(() => {
    if (prevRunningRef.current && !isOperationRunning) setSubmitting(false);
    prevRunningRef.current = isOperationRunning;
  }, [isOperationRunning]);

  // Предзаполнение subject для merge-commit'а в стиле git/Fork:
  // `Merge branch 'source' into target`. Делаем только если поля пустые
  // и юзер ничего не вводил (prefilledRef защищает от перезаписи после
  // того как юзер начал печатать). После завершения merge (mergeState=null)
  // флаг сбрасывается — следующий merge снова предзаполнится.
  useEffect(() => {
    if (!mergeState?.inProgress) {
      prefilledRef.current = false;
      return;
    }
    if (prefilledRef.current) return;
    if (subject || description || amend) return;
    if (mergeState.kind !== 'merge') return;
    if (!mergeState.sourceBranch || !mergeState.targetBranch) return;
    setSubject(`Merge branch '${mergeState.sourceBranch}' into ${mergeState.targetBranch}`);
    prefilledRef.current = true;
  }, [mergeState, subject, description, amend]);

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

  useEffect(() => {
    if (!aiError) return;
    const id = window.setTimeout(() => setAiError(null), AI_ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [aiError]);

  function doCommit() {
    if (!canCommit) return;
    const subj = subject.trim();
    const desc = description.trim();
    const msg = desc ? `${subj}\n\n${desc}` : subj;
    setAiError(null);
    setSubmitting(true);
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
        <div className={s.errorBanner} role="alert">
          <span className={s.errorBannerText}>{aiError}</span>
          <button
            type="button"
            className={s.errorDismiss}
            aria-label={loc.changes.dismissAiError}
            title={loc.changes.dismissAiError}
            onClick={() => setAiError(null)}
          >
            <span className={s.errorDismissMark} aria-hidden="true">
              ✕
            </span>
          </button>
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
        <button className={s.button} disabled={!canCommit || submitting} onClick={doCommit}>
          <span className="sg-button-content">
            {submitting && <span className="sg-button-spinner" aria-hidden="true" />}
            {loc.changes.commit}
            {stagedCount > 0 && <span className={s.count}>({stagedCount})</span>}
          </span>
        </button>
      </div>
    </div>
  );
}
