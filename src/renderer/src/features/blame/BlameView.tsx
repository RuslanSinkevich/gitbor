import { useEffect, useState } from 'react';
import type { BlameResult } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import s from './BlameView.module.css';

interface Props {
  file: string;
  hash?: string;
  onSelectCommit?: (hash: string) => void;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function BlameView({ file, hash, onSelectCommit }: Props) {
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setBlame(null);

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileBlame') {
        setBlame(msg.data);
        setLoading(false);
      }
    });

    postCommand({ type: 'getFileBlame', file, hash });

    return unsub;
  }, [file, hash]);

  if (loading) return <div className={s.empty}>Loading blame...</div>;
  if (!blame || blame.lines.length === 0) return <div className={s.empty}>No blame data</div>;

  let prevHash = '';

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={s.filePath}>{file}</span>
      </div>
      <div className={s.lines}>
        <table className={s.blameTable}>
          <tbody>
            {blame.lines.map((line, i) => {
              const isNewBlock = line.hash !== prevHash;
              prevHash = line.hash;
              return (
                <tr key={i} className={`${s.blameRow} ${isNewBlock ? s.blockStart : ''}`}>
                  <td
                    className={s.blameMeta}
                    onClick={() => onSelectCommit?.(line.hash)}
                    title={line.summary}
                  >
                    {isNewBlock && (
                      <>
                        <span className={s.blameHash}>{line.hash.substring(0, 7)}</span>
                        <span className={s.blameAuthor}>{line.author}</span>
                        <span className={s.blameDate}>{formatDate(line.authorDate)}</span>
                      </>
                    )}
                  </td>
                  <td className={s.lineNo}>{line.lineNo}</td>
                  <td className={s.lineContent}>{line.content}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
