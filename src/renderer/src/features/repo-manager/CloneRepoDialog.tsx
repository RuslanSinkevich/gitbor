import { useState, useCallback, useEffect, useRef } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { t, tpl } from '../../i18n';
import { invokeCommand, onMainEvent, postCommand } from '../../api';
import type { MainEvent } from '../../types';
import {
  loadCloneBaseDir, saveCloneBaseDir,
  extractRepoNameFromUrl, looksLikeGitUrl, joinPath,
} from './cloneDirPersist';

const ERROR_BOX_STYLE: React.CSSProperties = {
  fontSize: 12, color: 'var(--sg-danger)', wordBreak: 'break-word',
  padding: 8,
  background: 'color-mix(in srgb, var(--sg-danger) 12%, transparent)',
  borderRadius: 4,
};

interface Props {
  onClose: () => void;
}

/**
 * Clone Repository диалог. Два поля (парент-папка + имя), кнопка
 * «Обзор...», live-preview итогового пути, AI-агностичная валидация
 * URL.
 *
 * Поведение:
 *  1. URL → авто-генерация имени из URL (`pathDirty=false` пока юзер
 *     САМ не отредактировал имя — этот флаг блокирует перезапись
 *     введённого вручную имени).
 *  2. Базовая папка хранится в localStorage `sg-clone-base-dir`, чтобы
 *     второй и последующий клоны не требовали повторного выбора.
 *  3. Сабмит ждёт `operationEnd` с `operation === 'clone'`. На success
 *     закрываем диалог и сохраняем базовую папку. На fail оставляем
 *     открытым и показываем ошибку, чтобы юзер мог поправить путь/URL.
 */
export function CloneRepoDialog({ onClose }: Props) {
  const rm = t().repoManager;

  const [url, setUrl] = useState('');
  const [parent, setParent] = useState(loadCloneBaseDir);
  const [name, setName] = useState('');
  const [nameDirty, setNameDirty] = useState(false);
  const [urlWarning, setUrlWarning] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  /* Авто-имя из URL. Не трогаем поле «имя», если юзер его уже редактировал. */
  useEffect(() => {
    if (nameDirty) return;
    setName(extractRepoNameFromUrl(url));
  }, [url, nameDirty]);

  /* Подписка на финал операции клонирования: закрываем модалку при
     success, оставляем открытой при failure. operationStart/End
     приходят на ВСЕ операции, фильтруем по operation==='clone' +
     внутренний флаг startedRef, чтобы не закрыться от чужого
     operationEnd, проходящего в параллели. */
  useEffect(() => {
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'operationStart' && msg.operation === 'clone') {
        startedRef.current = true;
        setCloning(true);
        return;
      }
      if (msg.type !== 'operationEnd' || msg.operation !== 'clone') return;
      if (!startedRef.current) return;
      startedRef.current = false;
      setCloning(false);
      if (msg.success) {
        saveCloneBaseDir(parent.trim());
        onClose();
      } else {
        setError(msg.error ?? 'clone failed');
      }
    });
    return unsub;
  }, [onClose, parent]);

  const handleBrowse = useCallback(async () => {
    const result = await invokeCommand({
      type: 'pickDirectory',
      title: rm.cloneParent,
      defaultPath: parent || undefined,
    });
    if (typeof result === 'string' && result) {
      setParent(result);
    }
  }, [parent, rm.cloneParent]);

  const handleUrlBlur = useCallback(() => {
    setUrlWarning(url.trim().length > 0 && !looksLikeGitUrl(url));
  }, [url]);

  const finalPath = parent && name ? joinPath(parent.trim(), name.trim()) : '';

  const canClone =
    url.trim().length > 0 &&
    parent.trim().length > 0 &&
    name.trim().length > 0 &&
    !cloning;

  const handleSubmit = useCallback(() => {
    if (!canClone) return;
    setError(null);
    setCloning(true);
    postCommand({ type: 'cloneRepo', url: url.trim(), path: finalPath });
  }, [canClone, url, finalPath]);

  return (
    <SgDialog
      open
      title={rm.cloneTitle}
      onClose={cloning ? () => {} : onClose}
      size="md"
      onConfirm={handleSubmit}
      confirmLabel={cloning ? rm.cloneInProgress : rm.cloneStart}
      confirmDisabled={!canClone}
      confirmLoading={cloning}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{rm.cloneUrl}</span>
          <input
            autoFocus
            className="sg-input"
            value={url}
            placeholder="https://github.com/user/repo.git"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={handleUrlBlur}
            spellCheck={false}
          />
          {urlWarning && (
            <span style={{ fontSize: 11, color: '#d29922' }}>{rm.cloneInvalidUrl}</span>
          )}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{rm.cloneParent}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="sg-input"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              placeholder="C:/repos"
              spellCheck={false}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="sg-button sg-button--ghost sg-button--sm"
              onClick={handleBrowse}
              disabled={cloning}
            >
              {rm.cloneBrowse}
            </button>
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{rm.cloneName}</span>
          <input
            className="sg-input"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameDirty(true); }}
            placeholder="my-project"
            spellCheck={false}
          />
        </label>

        {finalPath && (
          <div style={{ fontSize: 12, color: 'var(--sg-foreground-muted)' }}>
            <span>{rm.clonePreview}</span>{' '}
            <span style={{ fontFamily: 'var(--sg-font-mono)' }}>{finalPath}</span>
          </div>
        )}

        {error && (
          <div style={ERROR_BOX_STYLE}>
            {tpl(rm.cloneFailed, { error })}
          </div>
        )}
      </div>
    </SgDialog>
  );
}
