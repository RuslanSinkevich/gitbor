import { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { t } from '../../i18n';
import { postCommand, onMainEvent } from '../../api';
import { AiGenerateButton, localizeAiError } from '../ai';
import { AI_ENABLED } from '@core/buildFlags';
import {
  CONVENTIONAL_TYPES,
  applyConventionalType,
  isConventionalCommitSubject,
  parseConventionalType,
  type ConventionalType,
} from '@core/git/commitMessageFormat';
import type { MergeState } from '../../types';
import { CommitTypeSelect } from './CommitTypeSelect';
import { loadCommitDraft, saveCommitDraft, clearCommitDraft } from './commitDraftPersist';
import s from './CommitBar.module.css';

const DESC_MIN_PX = 29;
const DESC_MAX_PX = 260;
const AI_ERROR_AUTO_DISMISS_MS = 20_000;
const DRAFT_SAVE_DEBOUNCE_MS = 300;

interface Props {
  repoPath: string;
  stagedCount: number;
  isOperationRunning: boolean;
  onOpenAiSettings: () => void;
  mergeState?: MergeState | null;
}

export function CommitBar({ repoPath, stagedCount, isOperationRunning, onOpenAiSettings, mergeState }: Props) {
  const loc = t();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [amend, setAmend] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [conventionalCommits, setConventionalCommits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formatHelpOpen, setFormatHelpOpen] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const prefilledRef = useRef(false);
  const prevRunningRef = useRef(false);
  // Актуальный repoPath для обработчиков с пустым deps (operationEnd),
  // чтобы не тащить stale-замыкание.
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;

  // Cherry-pick-серия: обычный commit не двигает секвенсер — только Continue в баннере.
  const cherryPickSeriesBlocked = isCherryPickSeriesInProgress(mergeState);

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

  useEffect(() => {
    setConventionalCommits(false);
    if (repoPath) postCommand({ type: 'getConventionalCommits' });
  }, [repoPath]);

  // Восстановление черновика per-repo при монтировании и смене репозитория.
  // Применяем только при наличии сохранённого текста: при отсутствии черновика
  // поля не трогаем, чтобы не затирать merge-предзаполнение. Смена вкладки репо
  // пересоздаёт компонент (поля стартуют пустыми), так что явный сброс не нужен.
  useEffect(() => {
    const draft = loadCommitDraft(repoPath);
    if (!draft) return;
    setSubject(draft.subject);
    setDescription(draft.description);
  }, [repoPath]);

  // Сохранение черновика per-repo с debounce. Пустой черновик стирает запись
  // (см. saveCommitDraft). При смене repoPath таймер старого значения
  // отменяется в cleanup до срабатывания, так что кросс-репо запись исключена.
  useEffect(() => {
    const repo = repoPath;
    const id = window.setTimeout(() => {
      saveCommitDraft(repo, { subject, description });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [repoPath, subject, description]);

  useEffect(() => onMainEvent((event) => {
    if (event.type === 'conventionalCommits') setConventionalCommits(event.active);
  }), []);

  const canCommit =
    (subject.trim().length > 0 || amend)
    && stagedCount > 0
    && !isOperationRunning
    && !cherryPickSeriesBlocked;
  const subjectPlaceholder = conventionalCommits ? loc.changes.commitSubjectConventional : loc.changes.commitSubject;

  const currentType = parseConventionalType(subject);
  const selectType = useCallback((type: ConventionalType) => {
    setSubject((prev) => applyConventionalType(prev, type));
  }, []);

  // Conventional-режим: тема считается «требует префикс», когда репо
  // включил CC, это не amend, и тема непустая, но не проходит проверку
  // формата. Тогда показываем подсказку и селектор типа. Префикс не
  // подставляется молча — пользователь либо выбирает тип, либо правит
  // тему вручную, либо коммитит как есть (хук решит).
  const needsPrefix =
    conventionalCommits && !amend && subject.trim().length > 0 && !isConventionalCommitSubject(subject);

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

  // Очистка полей темы/описания строго после УСПЕШНОГО коммита. Слушаем
  // operationEnd: при провале (hook/lock/empty) текст остаётся, чтобы юзер
  // не вводил его заново.
  useEffect(() => {
    return onMainEvent((event) => {
      if (event.type !== 'operationEnd' || event.operation !== 'commit') return;
      setSubmitting(false);
      if (event.success) {
        setSubject('');
        setDescription('');
        setAmend(false);
        setAiError(null);
        clearCommitDraft(repoPathRef.current);
      }
    });
  }, []);

  function doCommit() {
    if (!canCommit) return;
    const subj = subject.trim();
    const desc = description.trim();
    const msg = desc ? `${subj}\n\n${desc}` : subj;
    setAiError(null);
    setSubmitting(true);
    // Поля НЕ чистим здесь: при провале коммита (hook отклонил, lock и т.п.)
    // юзер должен сохранить введённый текст. Очистка — только по успешному
    // operationEnd для 'commit' (см. effect ниже).
    postCommand({ type: 'commit', message: msg, amend: amend || undefined });
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

  const hasMessageText = subject.length > 0 || description.length > 0;
  const clearMessage = useCallback(() => {
    setSubject('');
    setDescription('');
    setAiError(null);
    clearCommitDraft(repoPathRef.current);
    descRef.current?.focus();
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
      {needsPrefix && (
        <div className={s.formatHint} role="status">
          <div className={s.formatHintRow}>
            <span className={s.formatHintText}>{loc.changes.commitFormatError}</span>
            <button
              type="button"
              className={s.formatHintToggle}
              onClick={() => setFormatHelpOpen((v) => !v)}
              aria-expanded={formatHelpOpen}
            >
              {formatHelpOpen ? loc.changes.commitFormatHelpHide : loc.changes.commitFormatHelpShow}
            </button>
          </div>
          {formatHelpOpen && (
            <div className={s.formatHintDetails}>{loc.changes.commitFormatHelpText}</div>
          )}
        </div>
      )}
      <div className={s.fields}>
        <div className={s.subjectRow}>
          {needsPrefix && (
            <CommitTypeSelect
              types={CONVENTIONAL_TYPES}
              current={currentType}
              onSelect={selectType}
            />
          )}
          <input
            className={s.subject}
            type="text"
            placeholder={subjectPlaceholder}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={onSubjectKeyDown}
          />
        </div>
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
          {AI_ENABLED && (
            <AiGenerateButton
              stagedCount={stagedCount}
              disabled={isOperationRunning}
              onChunk={applyAiText}
              onDone={applyAiText}
              onError={handleAiError}
              onOpenSettings={onOpenAiSettings}
            />
          )}
          {hasMessageText && (
            <button
              type="button"
              className={s.clearMessage}
              aria-label={loc.changes.clearCommitMessage}
              title={loc.changes.clearCommitMessage}
              onClick={clearMessage}
            >
              ✕
            </button>
          )}
        </div>
        <button
          className={s.button}
          disabled={!canCommit || submitting}
          onClick={doCommit}
          title={cherryPickSeriesBlocked ? loc.changes.commitBlockedCherryPick : undefined}
        >
          <span className="sg-button-content">
            {submitting && <span className="sg-button-spinner" aria-hidden="true" />}
            {loc.changes.commit}
            {stagedCount > 0 && <span className={s.count}>({stagedCount})</span>}
          </span>
        </button>
      </div>
      {cherryPickSeriesBlocked && (
        <div className={s.seriesHint} role="status">
          {loc.changes.commitBlockedCherryPick}
        </div>
      )}
    </div>
  );
}

/** Серия batch cherry-pick ещё не дошла до конца — обычный commit запрещён. */
function isCherryPickSeriesInProgress(mergeState?: MergeState | null): boolean {
  if (!mergeState?.inProgress || mergeState.kind !== 'cherry-pick') return false;
  const done = mergeState.sequencerDone ?? 0;
  const total = mergeState.sequencerTotal ?? 0;
  return total > done;
}
