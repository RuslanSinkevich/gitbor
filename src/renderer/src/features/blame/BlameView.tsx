import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BlameLine, BlameResult } from '../../types';
import { postCommand, onMainEvent, copyToClipboard } from '../../api';
import { t } from '../../i18n';
import s from './BlameView.module.css';

interface Props {
  file: string;
  hash?: string;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Поповер с информацией о коммите строки. Позицию клампим во вьюпорт. */
function CommitInfoPopover({ line, x, y, onClose }: { line: BlameLine; x: number; y: number; onClose: () => void }) {
  const loc = t();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = Math.max(4, window.innerWidth - rect.width - 4);
    if (top + rect.height > window.innerHeight) top = Math.max(4, window.innerHeight - rect.height - 4);
    setPos({ left, top });
  }, [x, y]);

  const isUncommitted = /^0+$/.test(line.hash);

  return (
    <div ref={ref} className={s.popover} style={{ left: pos.left, top: pos.top }}>
      {isUncommitted ? (
        <div className={s.popRow}>{loc.blame.notCommitted}</div>
      ) : (
        <>
          <div className={s.popSummary}>{line.summary}</div>
          <div className={s.popRow}>
            <span className={s.popLabel}>{loc.blame.commit}</span>
            <span
              className={s.popHash}
              title={loc.details.clickToCopy}
              onClick={() => copyToClipboard(line.hash)}
            >
              {line.hash.substring(0, 8)}
            </span>
          </div>
          <div className={s.popRow}>
            <span className={s.popLabel}>{loc.blame.author}</span>
            <span>{line.author}</span>
          </div>
          <div className={s.popRow}>
            <span className={s.popLabel}>{loc.blame.date}</span>
            <span>{formatDate(line.authorDate)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Blame по файлу: слева метаданные коммита (hash/author/date), справа код.
 * Клик по метаданным строки открывает поповер с полной информацией о коммите
 * (тема, полный short-hash, автор, дата) — поведение одинаково везде, откуда
 * бы blame ни был открыт. Никакой навигации/скачков: только сведения о том,
 * кто и когда изменил строку.
 */
export function BlameView({ file, hash }: Props) {
  const loc = t();
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [popover, setPopover] = useState<{ line: BlameLine; x: number; y: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    setBlame(null);
    setPopover(null);

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileBlame' && msg.file === file) {
        setBlame(msg.data);
        setLoading(false);
      }
    });

    postCommand({ type: 'getFileBlame', file, hash });

    return unsub;
  }, [file, hash]);

  if (loading) return <div className={s.empty}>{loc.blame.loading}</div>;
  if (!blame || blame.lines.length === 0) return <div className={s.empty}>{loc.blame.noData}</div>;

  let prevHash = '';

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={s.filePath}>{file}</span>
        <span className={s.toolbarHint}>{loc.blame.clickHint}</span>
      </div>
      <div className={s.lines}>
        <table className={s.blameTable}>
          <tbody>
            {blame.lines.map((line, i) => {
              const isNewBlock = line.hash !== prevHash;
              prevHash = line.hash;
              return (
                <tr key={i} className={`${s.blameRow} ${isNewBlock ? s.blockStart : ''}`}>
                  {isNewBlock ? (
                    <td
                      className={`${s.blameMeta} ${s.blameMetaClickable}`}
                      onClick={(e) => setPopover({ line, x: e.clientX, y: e.clientY })}
                      title={line.summary}
                    >
                      <span className={s.blameHash}>{line.hash.substring(0, 7)}</span>
                      <span className={s.blameAuthor}>{line.author}</span>
                      <span className={s.blameDate}>{formatDate(line.authorDate)}</span>
                    </td>
                  ) : (
                    <td className={s.blameMeta} aria-hidden="true" />
                  )}
                  <td className={s.lineNo}>{line.lineNo}</td>
                  <td className={s.lineContent}>{line.content}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {popover && (
        <CommitInfoPopover
          line={popover.line}
          x={popover.x}
          y={popover.y}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
