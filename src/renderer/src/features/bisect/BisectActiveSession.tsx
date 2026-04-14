import { tpl } from '../../i18n';
import s from './BisectDialog.module.css';

interface BisectStatus {
  current: string;
  stepsLeft: number;
  goodCount: number;
  badCount: number;
}

interface Props {
  status: BisectStatus;
  output: string;
  labels: {
    currentCommit: string; stepsLeft: string; found: string;
    markGood: string; markBad: string; skip: string; reset: string; output: string;
  };
  onGood: () => void;
  onBad: () => void;
  onSkip: () => void;
  onReset: () => void;
}

/** UI for an active bisect session — shows status, action buttons, and output log. */
export function BisectActiveSession({ status, output, labels, onGood, onBad, onSkip, onReset }: Props) {
  const isFinished = status.stepsLeft === 0 && status.goodCount > 0 && status.badCount > 0;

  return (
    <>
      <div className={s.statusBox}>
        <div className={s.statusLine}>
          ⎇ {tpl(labels.currentCommit, { hash: '' })}
          <span className={s.statusHash}>{status.current}</span>
        </div>
        <div className={s.statusMeta}>
          {isFinished ? labels.found : tpl(labels.stepsLeft, { count: status.stepsLeft })}
        </div>
      </div>

      {!isFinished && (
        <div className={s.actionGroup}>
          <button className={s.btnGood} onClick={onGood}>✓ {labels.markGood}</button>
          <button className={s.btnBad} onClick={onBad}>✗ {labels.markBad}</button>
          <button className={s.btnSkip} onClick={onSkip}>{labels.skip}</button>
        </div>
      )}

      {output && (
        <>
          <span className={s.outputLabel}>{labels.output}</span>
          <div className={s.output}>{output}</div>
        </>
      )}

      <button className={s.btnDanger} onClick={onReset}>{labels.reset}</button>
    </>
  );
}
