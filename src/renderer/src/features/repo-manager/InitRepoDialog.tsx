import { useState, useCallback } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { t } from '../../i18n';
import { invokeCommand, postCommand } from '../../api';
import { loadInitBaseDir, saveInitBaseDir, joinPath } from './cloneDirPersist';

interface Props {
  onClose: () => void;
}

/**
 * Init Repository диалог: парент-папка + имя → создать `<parent>/<name>`
 * и вызвать `git init`. UX параллелен `CloneRepoDialog` (одна и та же
 * связка «папка для репозитория + имя папки»), без AI и без подписки
 * на operationEnd — init синхронный и почти не падает.
 */
export function InitRepoDialog({ onClose }: Props) {
  const rm = t().repoManager;
  const [parent, setParent] = useState(loadInitBaseDir);
  const [name, setName] = useState('');

  const handleBrowse = useCallback(async () => {
    const result = await invokeCommand({
      type: 'pickDirectory',
      title: rm.initParent,
      defaultPath: parent || undefined,
    });
    if (typeof result === 'string' && result) setParent(result);
  }, [parent, rm.initParent]);

  const finalPath = parent && name ? joinPath(parent.trim(), name.trim()) : '';
  const canInit = parent.trim().length > 0 && name.trim().length > 0;

  const handleSubmit = useCallback(() => {
    if (!canInit) return;
    saveInitBaseDir(parent.trim());
    postCommand({ type: 'initRepo', path: finalPath });
    onClose();
  }, [canInit, parent, finalPath, onClose]);

  return (
    <SgDialog
      open
      title={rm.initTitle}
      onClose={onClose}
      size="md"
      onConfirm={handleSubmit}
      confirmLabel={rm.initStart}
      confirmDisabled={!canInit}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{rm.initParent}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus
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
            >
              {rm.initBrowse}
            </button>
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{rm.cloneName}</span>
          <input
            className="sg-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
      </div>
    </SgDialog>
  );
}
