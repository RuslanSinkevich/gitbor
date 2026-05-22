import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { BisectStartForm } from './BisectStartForm';
import { BisectActiveSession } from './BisectActiveSession';

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
    <SgDialog
      open
      title={bl.title}
      onClose={onClose}
      size="md"
      footer={<button className="sg-button sg-button--ghost sg-button--md" onClick={onClose}>{bl.close}</button>}
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{bl.subtitle}</p>
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
    </SgDialog>
  );
}
