import { useEffect, useState, useRef } from 'react';
import type { FileDiff } from '../../types';
import { postCommand, onMainEvent, isElectron } from '../../api';
import { DiffView } from './DiffView';
import { ImageDiff, isImageFile } from './ImageDiff';
import s from './DiffView.module.css';

interface Props {
  file: string;
  hash: string;
}

const DIFF_TIMEOUT_MS = 15_000;

export function DiffPanel({ file, hash }: Props) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef({ file, hash });

  const isImage = isImageFile(file);

  useEffect(() => {
    if (isImage) {
      setLoading(false);
      return;
    }

    if (!isElectron) {
      setLoading(false);
      setError('IPC bridge not available (running outside Electron)');
      return;
    }

    setLoading(true);
    setDiffs(null);
    setError(null);
    requestRef.current = { file, hash };

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileDiff') {
        const isMatch = ('file' in msg && 'hash' in msg)
          ? msg.file === file && msg.hash === hash
          : requestRef.current.file === file && requestRef.current.hash === hash;
        if (isMatch) {
          setDiffs(msg.data);
          setLoading(false);
        }
      }
    });

    postCommand({ type: 'getFileDiff', file, hash });

    const timeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) setError('Diff request timed out');
        return false;
      });
    }, DIFF_TIMEOUT_MS);

    return () => { unsub(); clearTimeout(timeout); };
  }, [file, hash, isImage]);

  if (isImage) {
    return <ImageDiff file={file} hash={hash} />;
  }

  if (loading) {
    return <div className={s.empty}>Loading diff...</div>;
  }

  if (error) {
    return <div className={s.empty}>{error}</div>;
  }

  if (!diffs || diffs.length === 0) {
    return <div className={s.empty}>No diff available</div>;
  }

  return (
    <>
      {diffs.map((d, i) => (
        <DiffView key={`${d.path}-${i}`} diff={d} file={file} hash={hash} />
      ))}
    </>
  );
}
