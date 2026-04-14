import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
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
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <h3 className={s.title}>{ll.title}</h3>
          <p className={s.subtitle}>{ll.subtitle}</p>
        </div>

        <div className={s.body}>
          {!status ? (
            <div className={s.empty}>Loading...</div>
          ) : !status.installed ? (
            <div className={s.warning}>{ll.notInstalled}</div>
          ) : (
            <>
              <LfsPatternList patterns={status.patterns} labels={ll} onTrack={handleTrack} onUntrack={handleUntrack} />
              <LfsFileList files={status.files} labels={ll} />
            </>
          )}
        </div>

        <div className={s.footer}>
          <button className={s.btnSecondary} onClick={onClose}>{ll.close}</button>
        </div>
      </div>
    </div>
  );
}
