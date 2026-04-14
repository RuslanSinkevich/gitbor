import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import { BisectStartForm } from './BisectStartForm';
import { BisectActiveSession } from './BisectActiveSession';
import s from './BisectDialog.module.css';

interface BisectStatus {
  active: boolean;
  current: string;
  stepsLeft: number;
  goodCount: number;
  badCount: number;
  log: string[];
}

interface Props {
  onClose: () => void;
}

/** Dialog for managing a git bisect session — start, mark good/bad, skip, abort. */
export function BisectDialog({ onClose }: Props) {
  const loc = t();
  const bl = loc.bisect;
  const [status, setStatus] = useState<BisectStatus | null>(null);
  const [output, setOutput] = useState('');

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'bisectStatus') setStatus(msg.data);
      if (msg.type === 'bisectOutput') setOutput(msg.output);
    });
    postCommand({ type: 'getBisectStatus' });
    return unsub;
  }, []);

  const handleStart = useCallback((bad: string, good: string) => {
    postCommand({ type: 'bisectStart', bad, good });
  }, []);

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <h3 className={s.title}>{bl.title}</h3>
          <p className={s.subtitle}>{bl.subtitle}</p>
        </div>

        <div className={s.body}>
          {status?.active ? (
            <BisectActiveSession
              status={status}
              output={output}
              labels={bl}
              onGood={() => postCommand({ type: 'bisectGood' })}
              onBad={() => postCommand({ type: 'bisectBad' })}
              onSkip={() => postCommand({ type: 'bisectSkip' })}
              onReset={() => { postCommand({ type: 'bisectReset' }); setOutput(''); }}
            />
          ) : status ? (
            <BisectStartForm labels={bl} onStart={handleStart} />
          ) : null}
        </div>

        <div className={s.footer}>
          <button className={s.btnSecondary} onClick={onClose}>{bl.close}</button>
        </div>
      </div>
    </div>
  );
}
