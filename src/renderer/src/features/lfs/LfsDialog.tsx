import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { LfsPatternList } from './LfsPatternList';
import { LfsFileList } from './LfsFileList';
import s from './LfsDialog.module.css';

interface LfsStatus {
  installed: boolean;
  patterns: { pattern: string }[];
  files: { name: string; size: string; oid: string }[];
}

interface Props {
  onClose: () => void;
}

/** Dialog for managing Git LFS — patterns, tracked files, track/untrack. */
export function LfsDialog({ onClose }: Props) {
  const loc = t();
  const ll = loc.lfs;
  const [status, setStatus] = useState<LfsStatus | null>(null);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'lfsStatus') setStatus(msg.data);
    });
    postCommand({ type: 'getLfsStatus' });
    return unsub;
  }, []);

  const handleTrack = useCallback((pattern: string) => {
    postCommand({ type: 'lfsTrack', pattern });
  }, []);

  const handleUntrack = useCallback((pattern: string) => {
    postCommand({ type: 'lfsUntrack', pattern });
  }, []);

  return (
    <SgDialog
      open
      title={ll.title}
      onClose={onClose}
      size="lg"
      footer={<button className="sg-button sg-button--ghost sg-button--md" onClick={onClose}>{ll.close}</button>}
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{ll.subtitle}</p>
      {!status ? (
        <div className={s.empty}>{t().app.loading}</div>
      ) : !status.installed ? (
        <div className={s.warning}>{ll.notInstalled}</div>
      ) : (
        <>
          <LfsPatternList patterns={status.patterns} labels={ll} onTrack={handleTrack} onUntrack={handleUntrack} />
          <LfsFileList files={status.files} labels={ll} />
        </>
      )}
    </SgDialog>
  );
}
